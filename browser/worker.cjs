'use strict';
// This process has no HTTP listener, remote scripting or profile path operation.
const path=require('node:path');
const {Browser}=require('./runtime.cjs');
const {validUrl,geometry,point,boundedText}=require('./guards.cjs');
const MAX_LINE=16384,MAX_QUEUE=32;
const FIXED_ERRORS=new Set(['invalid_request','invalid_state','profile_locked','unsafe_profile','browser_unavailable','browser_error','stale_view','cleanup_failed','busy','cancelled']);
function object(v){return v!==null && typeof v==='object' && !Array.isArray(v);}
function invalid(){throw new Error('invalid_request');}
function keys(p,allowed){if(!object(p)||Object.keys(p).some(k=>!allowed.includes(k)))invalid();}
function int(v,min=0){return Number.isSafeInteger(v)&&v>=min;}
function validate(op,p) {
 const shapes={open:['url','width','height','scale'],frame:['after_seq','wait_ms'],navigate:['url'],reload:[],back:[],resize:['width','height','scale'],mouse:['type','x','y','button','buttons','clickCount','modifiers','deltaX','deltaY','view'],text:['text','view'],key:['type','key','code','windowsVirtualKeyCode','modifiers','view'],paint:['view','seq'],close:[],clear:[]};
 if(!Object.hasOwn(shapes,op))invalid();keys(p,shapes[op]);
 if(op==='open'||op==='navigate'){if(typeof p.url!=='string'||p.url.length>8192||!validUrl(p.url))invalid();}
 if(op==='open'||op==='resize'){if(['width','height','scale'].some(k=>p[k]!==undefined&&!Number.isFinite(p[k])))invalid();try{geometry(p.width??900,p.height??650,p.scale??80);}catch{invalid();}}
 if(op==='frame' && p.after_seq!==undefined && !int(p.after_seq))invalid();
 if(op==='frame' && p.wait_ms!==undefined && (!int(p.wait_ms)||p.wait_ms>1000))invalid();
 if(['mouse','text','key','paint'].includes(op) && !int(p.view))invalid();
 if(op==='paint' && !int(p.seq,1))invalid();
 if(op==='text')try{boundedText(p.text);}catch{invalid();}
 if(op==='mouse') {
  if(!['mousePressed','mouseReleased','mouseMoved','mouseWheel'].includes(p.type))invalid();
  if(!['none','left','right','middle'].includes(p.button??'left'))invalid();
  if(![p.x,p.y].every(Number.isFinite))invalid();
  if(p.buttons!==undefined&&(!int(p.buttons)||p.buttons>31))invalid();
  if(p.clickCount!==undefined&&(!int(p.clickCount)||p.clickCount>2))invalid();
  if(p.type==='mouseWheel' && ![p.deltaX,p.deltaY].every(Number.isFinite))invalid();
 }
 if(op==='key' && (!['keyDown','keyUp'].includes(p.type)||typeof p.key!=='string'||p.key.length>40||(p.code!==undefined&&(typeof p.code!=='string'||p.code.length>40))))invalid();
 if(p.modifiers!==undefined&&(!int(p.modifiers)||p.modifiers>15))invalid();
 if(p.windowsVirtualKeyCode!==undefined&&(!int(p.windowsVirtualKeyCode)||p.windowsVirtualKeyCode>255))invalid();
}
function errorCode(e){
 if(FIXED_ERRORS.has(e?.message))return e.message;
 if(['Expired rendered frame','Input belongs to an inactive view'].includes(e?.message))return 'stale_view';
 return 'browser_error';
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--profile-root'||!path.isAbsolute(args[1])){process.exitCode=2;return;}
 const b=new Browser(args[1]); let opened=false,ending=false,framePending=false,queued=0,queue=Promise.resolve();
 function reply(v){return new Promise(resolve=>{if(process.stdout.destroyed)return resolve();process.stdout.write(JSON.stringify(v)+'\n',()=>resolve());});}
 async function finish(){if(ending)return;ending=true;await b.stop().catch(()=>{});process.stdin.pause();}
 async function dispatch(r, frameLane=false) {
  let id=object(r)&&int(r.id)?r.id:null;
  let reserved=false;
  try {
   if(!object(r)||id===null||Object.keys(r).some(k=>!['id','op','payload'].includes(k))||typeof r.op!=='string'||!object(r.payload))invalid();
   validate(r.op,r.payload);const p=r.payload;let result;
   if(r.op==='open') {
    if(opened||b.stopping)throw new Error('invalid_state');
    const g={width:p.width??900,height:p.height??650,scale:p.scale??80};
    // Validate and set geometry before launch; no page-provided paths or flags.
    await b.resize(g.width,g.height,g.scale);await b.start();await b.navigate(p.url);opened=true;result=b.state();
   } else if(r.op==='close') {
    const stopped=await b.stop();if(!stopped.browserExited)throw new Error('cleanup_failed');result={closed:true};
   } else if(r.op==='clear') result=await b.clear();
   else {
    if(frameLane&&b.stopping)throw new Error('cancelled');
    if(!opened||b.stopping)throw new Error('invalid_state');
    if(b.processExited())throw new Error('browser_unavailable');
    if(frameLane) {
     if(framePending)throw new Error('busy');
     framePending=reserved=true;
     result=await b.waitForFrame(p.after_seq??0,p.wait_ms);
    }
    else if(r.op==='frame') result=b.state(p.after_seq??0);
    else if(r.op==='paint'){b.acknowledgePaint(p.view,p.seq);result={ok:true};}
    else if(r.op==='text'){await b.text(p.text,p.view);result={ok:true};}
    else if(r.op==='key'){await b.key(p);result={ok:true};}
    else if(r.op==='mouse'){try{point(p,b.width,b.height);}catch{invalid();}await b.mouse(p);result={ok:true};}
    else {
     if(r.op==='navigate')await b.navigate(p.url);
     if(r.op==='reload')await b.reload();
     if(r.op==='back')await b.back();
     if(r.op==='resize')await b.resize(p.width??900,p.height??650,p.scale??80);
     result=b.state();
    }
   }
   await reply({id,ok:true,result});
   if(r.op==='close'||r.op==='clear'){ending=true;process.stdin.pause();process.stdin.destroy();}
  } catch(e){await reply({id,ok:false,error:errorCode(e)});}
  finally{if(reserved)framePending=false;}
 }
 let buffer=Buffer.alloc(0),discard=false;
 function line(value){
  if(ending)return;
  let r;try{r=JSON.parse(value);}catch{r=null;}
  // Only the bounded frame wait bypasses the control FIFO. Keep its slot
  // through stdout completion so it cannot build a backlog of PNG replies.
  if(r?.op==='frame'&&r.payload?.wait_ms!==undefined&&r.payload.wait_ms!==0){void dispatch(r,true);return;}
  if(queued>=MAX_QUEUE){void reply({id:null,ok:false,error:'busy'});return;}
  queued++;queue=queue.then(async()=>{if(!ending)await dispatch(r);}).catch(()=>{}).finally(()=>queued--);
 }
 process.stdin.on('data',chunk=>{
  if(ending)return;
  let offset=0;
  for(let i=0;i<chunk.length;i++)if(chunk[i]===10){const part=chunk.subarray(offset,i);if(!discard){if(buffer.length+part.length>MAX_LINE)line('');else line(Buffer.concat([buffer,part]).toString('utf8'));}buffer=Buffer.alloc(0);discard=false;offset=i+1;}
  if(!discard){const part=chunk.subarray(offset);if(buffer.length+part.length>MAX_LINE){buffer=Buffer.alloc(0);discard=true;line('');}else buffer=Buffer.concat([buffer,part]);}
 });
 process.stdin.on('end',()=>{queue=queue.then(()=>finish());});
 process.stdin.on('error',()=>{void finish();});
 process.stdout.on('error',()=>{void finish();});
 process.on('SIGTERM',()=>{queue=queue.then(()=>finish());});
 process.on('SIGINT',()=>{queue=queue.then(()=>finish());});
}
if(require.main===module)main().catch(()=>{process.exitCode=1;});
module.exports={validate,errorCode};
