import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PreviewPane } from 'fixture-production'
import { setFixtureScope } from './stream-react-sdk.mjs'

window.fixtureNotifications = []
window.fixtureWire = [] // Synthetic fixture actions only; never frames or session identifiers.
const wait = ms => new Promise(resolve => setTimeout(resolve,ms))
const assert = (value,message) => { if (!value) throw Error(message) }
async function until(fn, label='condition') { for(let i=0;i<160;i++){if(fn()) return; await wait(10)} throw Error(`timeout: ${label}`) }
const deferred = () => { let resolve,reject; const promise = new Promise((a,b)=>{resolve=a;reject=b}); return {promise,resolve,reject} }
// Own synthetic image; no website, QR, credentials or network content.
const image = document.createElement('canvas'); image.width=32;image.height=24
image.getContext('2d').fillStyle='#12ab34';image.getContext('2d').fillRect(0,0,32,24)
const png=image.toDataURL('image/png').split(',')[1]
const state = (view=0,seq=1,origin='https://fixture.invalid') => ({view,seq,origin,width:800,height:600,rememberLogin:true,frame:{view,seq,format:'png',data:png}})
let serial=0, current
async function harness(options={}) {
  setFixtureScope('fixture-a',1)
  // Match the production grid's definite preview-column width; toolbar text
  // must not resize an intrinsic-width flex item after every origin update.
  const div=document.createElement('div');div.style='display:grid;grid-template-columns:minmax(0,1fr);width:900px;height:650px';document.body.append(div)
  const root=createRoot(div), qc=new QueryClient({defaultOptions:{queries:{retry:false}}})
  const calls=[], saves={}, hooks={...options.hooks}, sessions=new Map()
  let props={url:'https://fixture.invalid/a',locale:'en'}, id
  const ctx={storage:{get:(_k,d)=>d,set:(k,v)=>saves[k]=v},os:{openExternal:async()=>true},rest:async(path,opt={})=>{
    const call={path,method:opt.method||'GET',body:opt.body};calls.push(call)
    const kind=path==='/browser/status'?'status':path==='/browser/sessions'?'open':path.endsWith('/clear')?'clear':path.endsWith('/action')?opt.body.op:path.includes('/frame?')?'frame':opt.method==='DELETE'?'delete':'unknown'
    if (path.endsWith('/action')) window.fixtureWire.push(structuredClone(opt.body))
    if(hooks[kind]) return hooks[kind](call)
    if(kind==='status') return {available:options.available!==false,rememberLogin:true}
    if(kind==='open'){id=`fixture-${++serial}`;sessions.set(id,state());return {id,...state()}}
    if(kind==='frame'){const sid=path.split('/')[3],s=sessions.get(sid)||state();const after=Number(new URL(path,'https://fixture.invalid').searchParams.get('after_seq'));return {...s,frame:s.seq>after?s.frame:null}}
    if(kind==='clear')return {cleared:true}
    if(kind==='delete')return {closed:true}
    if(['navigate','reload','back','resize'].includes(kind)){const sid=path.split('/')[3],s=state((sessions.get(sid)?.view||0)+1,1);if(kind==='resize'){s.width=Math.round(opt.body.payload.width*100/opt.body.payload.scale);s.height=Math.round(opt.body.payload.height*100/opt.body.payload.scale)}sessions.set(sid,s);return s}
    return {ok:true}
  }}
  const render=(next={})=>{props={...props,...next};root.render(React.createElement(QueryClientProvider,{client:qc},React.createElement(PreviewPane,{ctx,...props,onClose:()=>render({url:null})})))}
  const actions=op=>calls.filter(c=>c.body?.op===op)
  const canvas=()=>div.querySelector('canvas')
  const click=label=>{const b=[...div.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label);assert(b,`missing ${label}`);b.click()}
  const event=(type,extra={})=>{const c=canvas();assert(c,'missing canvas');let e;if(type.startsWith('key'))e=new KeyboardEvent(type,{key:'ArrowDown',code:'ArrowDown',keyCode:40,bubbles:true,cancelable:true,...extra});else if(type.startsWith('composition'))e=new CompositionEvent(type,{bubbles:true,...extra});else e=new (type==='wheel'?WheelEvent:MouseEvent)(type,{bubbles:true,cancelable:true,clientX:100,clientY:100,button:0,buttons:0,...extra});c.dispatchEvent(e)}
  render()
  current={div,root,qc,calls,hooks,sessions,saves,render,actions,canvas,click,event,get id(){return id},async ready(){await until(()=>canvas()?.style.opacity==='1','paint acknowledged')},async dispose(){root.unmount();qc.clear();div.remove();await wait(15)}}
  return current
}
const results=[]
async function test(name,fn){try{await fn();results.push({name,ok:true})}catch(e){results.push({name,ok:false,error:e.stack})}finally{if(current){await current.dispose();current=null}}}
await test('real canvas paints synthetic PNG; displayed origin is returned origin',async()=>{const h=await harness();await h.ready();const pixel=[...h.canvas().getContext('2d').getImageData(1,1,1,1).data];assert(pixel.join(',')==='18,171,52,255',`pixel=${pixel}`);assert(h.div.textContent.includes('https://fixture.invalid'),'actual origin absent');assert(h.actions('paint').length>0,'paint missing')})
await test('paint acknowledgment gates all input',async()=>{const h=await harness(),gate=deferred();h.hooks.paint=()=>gate.promise;await until(()=>h.actions('paint').length);h.event('mousedown');h.event('keydown');h.event('wheel');assert(!h.actions('mouse').length&&!h.actions('key').length,'input before paint ACK');gate.resolve({ok:true});await h.ready();h.event('mousedown');assert(h.actions('mouse').length===1,'input not enabled')})
await test('hover sends none button and viewport coordinates; wheel and keyboard forward',async()=>{const h=await harness();await h.ready();const r=h.canvas().getBoundingClientRect();h.event('mousemove',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0,buttons:0});await until(()=>h.actions('mouse').length);const p=h.actions('mouse')[0].body.payload;assert(Math.abs(p.x-400)<1&&Math.abs(p.y-300)<1,'CSS viewport coordinates incorrect');assert(p.button==='none',`ordinary hover button=${p.button}`);h.event('wheel',{deltaY:120});h.event('keydown');h.event('keyup');assert(h.actions('mouse').at(-1).body.payload.deltaY===120,'wheel lost');assert(h.actions('key').length===2,'key pair lost')})
await test('Chinese composition commits exactly once; key Process suppressed',async()=>{const h=await harness();await h.ready();h.event('compositionstart');h.event('keydown',{key:'Process',isComposing:true});h.event('compositionend',{data:'中文输入'});await wait(20);assert(h.actions('text').length===1&&h.actions('text')[0].body.payload.text==='中文输入','IME commit wrong');assert(!h.actions('key').length,'Process forwarded')})
await test('zoom and native ResizeObserver reuse session and canvas',async()=>{const h=await harness();await h.ready();const c=h.canvas(),id=h.id;h.click('Zoom in article');await until(()=>h.actions('resize').some(c=>c.body.payload.scale===90));h.div.style.width='700px';await wait(100);assert(h.calls.filter(c=>c.path==='/browser/sessions').length===1&&h.id===id&&h.canvas()===c,'resize recreated session');assert(h.saves['settings.pageScale']===90,'scale not persisted');assert(h.actions('resize').length>=2,'ResizeObserver not exercised')})
const frameReads = h => h.calls.filter(c=>c.path.includes('/frame?'))
const noFrameCache = h => h.qc.getQueryCache().getAll().every(q=>q.queryKey[1]!=='browser-frame'&&!JSON.stringify(q.state.data)?.includes(png))
await test('close DELETE preserves login, never caches frames, reopen new lifetime',async()=>{const h=await harness();await h.ready();await until(()=>frameReads(h).length>1);assert(noFrameCache(h),'frame query existed while mounted');const old=h.id;h.click('Close preview');await until(()=>h.calls.some(c=>c.method==='DELETE'&&c.path.endsWith(old)));assert(!h.calls.some(c=>c.path.endsWith('/clear')),'close cleared login');await wait(220);assert(noFrameCache(h),'sensitive cache retained');h.render({url:'https://fixture.invalid/b'});await h.ready();assert(h.id!==old,'old instance reused')})
await test('idle long poll keeps one request pending and renews after its wait',async()=>{
  const gate=deferred(), h=await harness({hooks:{frame:()=>gate.promise}})
  try {
    await h.ready();await until(()=>frameReads(h).length===1)
    assert(frameReads(h)[0].path.endsWith('after_seq=1&wait_ms=1000'),'missing latest-frame cursor or bounded wait')
    await wait(300);assert(frameReads(h).length===1,'overlapping idle requests')
    const next=deferred();let renewedAt;h.hooks.frame=()=>{renewedAt=performance.now();return next.promise};const responseAt=performance.now();gate.resolve({...state(),frame:null})
    try {await until(()=>frameReads(h).length===2,'renewal after valid idle response');assert(renewedAt-responseAt<175,'long-wait reply incurred legacy backoff');assert(noFrameCache(h),'idle packet went through query cache')}
    finally {next.resolve({...state(),frame:null})}
  } finally {gate.resolve({...state(),frame:null})}
})
await test('legacy fast duplicate and null replies observe an idle backoff',async()=>{
  let count=0;const times=[],h=await harness({hooks:{frame:()=>{times.push(performance.now());return ++count%2?state():{...state(),frame:null}}}})
  await until(()=>times.length>=3,'legacy reader retries')
  assert(frameReads(h)[0].path.includes('wait_ms=1000'),'not requesting long polling from legacy backend')
  assert(times[1]-times[0]>=175&&times[2]-times[1]>=175,'legacy reader busy-spun')
  assert(h.actions('paint').length===1,'legacy duplicate was repainted')
})
await test('superseded navigation does not start a parallel frame request or adopt its old response',async()=>{
  const old=deferred(), next=deferred();let count=0
  const h=await harness({hooks:{frame:()=>++count===1?old.promise:next.promise}})
  try {
    await h.ready();await until(()=>count===1);h.render({url:'https://fixture.invalid/b'});await until(()=>h.actions('paint').some(c=>c.body.payload.view===1))
    await wait(250);assert(count===1,'navigation overlapped frame reads for the same session lifetime')
    old.resolve(state(9,9,'https://obsolete.invalid'));await until(()=>count===2,'reader resumed after superseded request')
    assert(!h.div.textContent.includes('obsolete.invalid'),'superseded frame changed the origin')
    assert(!h.actions('paint').some(c=>c.body.payload.view===9),'superseded frame was acknowledged')
  } finally {old.resolve({...state(),frame:null});next.resolve({...state(1),frame:null})}
})
await test('in-flight decode paints and coalesces continuous motion to the latest pending image',async()=>{
  const first=deferred(), end=deferred(), draws=[], calls=[], h=await harness();await h.ready()
  const NativeImage=window.Image, proto=CanvasRenderingContext2D.prototype, draw=proto.drawImage
  const oldWidth=h.canvas().width, attributes=new MutationObserver(entries=>calls.push(...entries))
  attributes.observe(h.canvas(),{attributeFilter:['width','height']})
  let decoded=0, sent=1
  window.Image=function(){const img=new NativeImage(),n=++decoded;Object.defineProperty(img,'onload',{set(fn){if(fn) img.addEventListener('load',()=>{if(n===1) first.promise.then(()=>fn.call(img));else fn.call(img)})}});return img}
  proto.drawImage=function(img,...args){if(this.canvas===h.canvas()) draws.push(img.src);return draw.call(this,img,...args)}
  const pixels = n=>{const ctx=image.getContext('2d');ctx.fillStyle=`rgb(${n},0,0)`;ctx.fillRect(0,0,32,24);return image.toDataURL('image/png').split(',')[1]}
  const motion=new Map(Array.from({length:9},(_,i)=>[i+2,pixels(i+2)]))
  h.hooks.frame=()=>{if(sent===10)return end.promise;const s=state(0,++sent);s.frame.data=motion.get(sent);return s}
  try {
    await until(()=>frameReads(h).at(-1)?.path.includes('after_seq=10&'),'network kept taking latest frames during decode');assert(decoded===1,'started overlapping PNG decodes');assert(!draws.length,'delayed PNG already drew')
    first.resolve();await until(()=>draws.length===2,'both in-flight and latest pending painted')
    assert(draws.every((src,i)=>src.endsWith(motion.get(i===0?2:10))),'paint order was not in-flight then latest')
    assert(h.actions('paint').length===1,'same-view motion triggered redundant paint ACKs')
    assert(h.canvas().width===oldWidth&&calls.length===0,'same-size PNG reset the canvas backing store')
    assert(frameReads(h).at(-1).path.includes('after_seq=10&'),'read cursor waited for the canvas instead of consuming responses')
    assert(noFrameCache(h),'motion pixels went through query cache')
  } finally {first.resolve();end.resolve({...state(0,10),frame:null});attributes.disconnect();window.Image=NativeImage;proto.drawImage=draw}
})
await test('busy transport retries with backoff and a new view waits for a valid ACK',async()=>{
  const gate=deferred(), end=deferred(), times=[];let n=0;const h=await harness();await h.ready()
  h.hooks.paint=()=>gate.promise
  h.hooks.frame=()=>{times.push(performance.now());if(++n===1)throw Object.assign(Error('busy'),{status:409});if(n===2)return state(2,4);return end.promise}
  try {
    await until(()=>h.actions('paint').some(c=>c.body.payload.view===2),'recovery paint');assert(times[1]-times[0]>=175,'busy response caused immediate retry')
    h.event('mousedown');assert(!h.actions('mouse').length,'new view accepted input before its ACK')
    gate.resolve({ok:true});await h.ready();h.event('mousedown');assert(h.actions('mouse').at(-1)?.body.payload.view===2,'input did not recover for acknowledged view')
  } finally {gate.resolve({ok:true});end.resolve({...state(2,4),frame:null})}
})
await test('static first paint recovers from a rejected ACK without refetching its PNG',async()=>{
  const first=deferred(), times=[], h=await harness({hooks:{paint:()=>{times.push(performance.now());return times.length===1?first.promise:{ok:true}}}})
  try {
    await until(()=>times.length===1);h.event('mousedown');assert(!h.actions('mouse').length,'pending ACK enabled input')
    first.resolve({ok:false});await h.ready()
    assert(times.length===2&&times[1]-times[0]>=175,'missing bounded static-view ACK retry')
    assert(h.actions('paint').every(c=>c.body.payload.seq===1),'static-view ACK did not use the painted ticket')
    assert(frameReads(h).every(c=>c.path.includes('after_seq=1&')),'retry re-downloaded the static frame')
  } finally {first.resolve({ok:false})}
})
await test('pending clear discards its frame and failed clear resumes a superseding navigation',async()=>{
  const old=deferred(), clear=deferred();let reads=0
  const h=await harness({hooks:{frame:()=>++reads===1?old.promise:{...state(1),frame:null},clear:()=>clear.promise}})
  try {
    await h.ready();await until(()=>reads===1);h.click('Clear login data');await until(()=>h.div.querySelector('[role=dialog]'))
    h.click('Clear and reopen');await until(()=>h.calls.some(c=>c.path.endsWith('/clear')))
    h.render({url:'https://fixture.invalid/new'});old.resolve(state(5,5,'https://obsolete.invalid'));await wait(240)
    assert(reads===1&&!h.actions('navigate').length,'reader or navigation ran while clearing')
    assert(!h.div.textContent.includes('obsolete.invalid'),'late frame displayed while clearing')
    clear.resolve({cleared:false});await until(()=>h.actions('navigate').length===1,'latest navigation after clear failure');await h.ready()
    // The fixture dialog is inline; closing it can also resize the viewport.
    const view=h.actions('paint').at(-1)?.body.payload.view;h.event('mousedown')
    assert(view>=1&&h.actions('mouse').at(-1)?.body.payload.view===view,`clear failure did not recover the acknowledged new view (${view})`)
  } finally {old.resolve({...state(),frame:null});clear.resolve({cleared:false})}
})
await test('clear requires dialog confirmation; failed result displays feedback',async()=>{const h=await harness();await h.ready();h.hooks.clear=async()=>({cleared:false});h.click('Clear login data');await until(()=>h.div.querySelector('[role=dialog]'));assert(!h.calls.some(c=>c.path.endsWith('/clear')),'unconfirmed clear');h.click('Clear and reopen');await until(()=>h.div.querySelector('[role=alert]'));assert(h.div.querySelector('[role=alert]').textContent.includes('Could not clear'),'missing failure');assert(h.calls.find(c=>c.path.endsWith('/clear')).body.confirm===true,'confirmation payload missing')})
await test('successful explicit clear reopens a distinct session',async()=>{const h=await harness();await h.ready();const old=h.id;h.click('Clear login data');await until(()=>h.div.querySelector('[role=dialog]'));h.click('Clear and reopen');await until(()=>h.id!==old);await h.ready();assert(!h.div.querySelector('[role=dialog]'),'dialog remains')})
await test('late open after close is deleted and never painted',async()=>{const h=await harness(),gate=deferred();h.hooks.open=()=>gate.promise;await until(()=>h.calls.some(c=>c.path==='/browser/sessions'));h.render({url:null});await wait(30);gate.resolve({id:'late-own',...state()});await until(()=>h.calls.some(c=>c.method==='DELETE'&&c.path.endsWith('late-own')));assert(!h.actions('paint').length,'late open painted')})
await test('profile ABA rejects old pending open',async()=>{const h=await harness(),gate=deferred();let n=0;h.hooks.open=()=>++n===1?gate.promise:Promise.resolve({id:`aba-${n}`,...state()});await until(()=>n===1);setFixtureScope('fixture-b',1);await wait(40);setFixtureScope('fixture-a',1);await wait(40);gate.resolve({id:'aba-old',...state(0,1,'https://obsolete.invalid')});await wait(80);assert(!h.div.textContent.includes('obsolete.invalid'),'ABA old open accepted');assert(h.calls.some(c=>c.method==='DELETE'&&c.path.endsWith('aba-old')),'old same-epoch session not released')})
await test('epoch change never DELETEs old connection; late old frame is inert',async()=>{const h=await harness();await h.ready();const old=h.id,gate=deferred();let pending=false;h.hooks.frame=call=>{if(call.path.includes(`/sessions/${old}/frame?`)){pending=true;return gate.promise}return Promise.resolve({...state(),frame:null})};await until(()=>pending);setFixtureScope('fixture-a',2);await wait(70);gate.resolve(state(5,2,'https://obsolete.invalid'));await wait(70);assert(!h.calls.some(c=>c.method==='DELETE'&&c.path.endsWith(old)),'old id sent to new epoch');assert(!h.div.textContent.includes('obsolete.invalid'),'old epoch frame accepted')})
await test('late rejected navigation cannot poison successful latest navigation',async()=>{const h=await harness();await h.ready();const gate=deferred();let n=0;h.hooks.navigate=()=>++n===1?gate.promise:Promise.resolve(state(2,1,'https://latest.invalid'));h.render({url:'https://fixture.invalid/b'});await until(()=>n===1);h.render({url:'https://fixture.invalid/c'});await until(()=>n===2);await h.ready();gate.reject(Error('synthetic old navigation failure'));await wait(60);assert(!h.div.textContent.includes('Browser connection failed'),'obsolete navigation failure poisoned current page')})
await test('popup generation never rolls back to a delayed old-view frame',async()=>{const h=await harness();await h.ready();let n=0;h.hooks.frame=async()=>++n===1?state(2,2,'https://popup.invalid'):state(0,3,'https://obsolete.invalid');await until(()=>h.div.textContent.includes('https://popup.invalid'));await wait(300);assert(!h.div.textContent.includes('https://obsolete.invalid'),'popup view rolled backwards')})
await test('late clear failure cannot reopen error state after closing/reopening',async()=>{const h=await harness();await h.ready();const gate=deferred();h.hooks.clear=()=>gate.promise;h.click('Clear login data');await until(()=>h.div.querySelector('[role=dialog]'));h.click('Clear and reopen');await until(()=>h.calls.some(c=>c.path.endsWith('/clear')));h.render({url:null});await wait(220);h.render({url:'https://fixture.invalid/new'});await h.ready();gate.reject(Error('old clear'));await wait(40);h.click('Clear login data');await wait(40);assert(!h.div.querySelector('[role=alert]'),'obsolete clear error leaked');assert(!h.div.querySelector('button[disabled]')?.textContent.includes('Clear and reopen'),'stale busy state')})
await test('pending hover input is not replayed after navigation',async()=>{const h=await harness();await h.ready();const gate=deferred();h.hooks.mouse=()=>gate.promise;h.event('mousemove');h.event('mousemove');h.render({url:'https://fixture.invalid/new'});await until(()=>h.actions('navigate').length);gate.resolve({ok:true});await wait(60);assert(h.actions('mouse').length===1,'old queued hover replayed')})
await test('unavailable browser keeps visible limited fallback without creating session',async()=>{const h=await harness({available:false});await until(()=>h.div.textContent.includes('Limited preview'));assert(h.div.querySelector('a'),'fallback link missing');assert(!h.calls.some(c=>c.path==='/browser/sessions'),'unavailable browser opened')})
await test('wheel, printable text, key pair and paste use current acknowledged view',async()=>{const h=await harness();await h.ready();h.event('wheel',{deltaX:7,deltaY:120});h.event('keydown');h.event('keyup');h.event('keydown',{key:'x',code:'KeyX'});const data=new DataTransfer();data.setData('text/plain','fixture paste');h.canvas().dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));assert(h.actions('mouse').at(-1).body.payload.deltaY===120,'wheel lost');assert(h.actions('key').length===2,'key pair lost');assert(h.actions('text').map(c=>c.body.payload.text).join('|')==='x|fixture paste','text/paste wrong');assert([...h.actions('mouse'),...h.actions('key'),...h.actions('text')].every(c=>c.body.payload.view===0),'input view missing')})
await test('resizing suspends input and polling without session replacement',async()=>{const h=await harness();await h.ready();const old=h.id;h.render({resizing:true});await wait(40);const count=h.calls.length;h.event('mousedown');h.event('wheel');h.event('keydown');await wait(250);assert(h.calls.length===count,'request during resize');h.render({resizing:false});await wait(40);h.event('mousedown');assert(h.actions('mouse').length===1&&h.id===old,'resize failed to recover same session')})
await test('pending clear does not disable unrelated reopened lifetime',async()=>{const h=await harness();await h.ready();const gate=deferred();h.hooks.clear=()=>gate.promise;h.click('Clear login data');await until(()=>h.div.querySelector('[role=dialog]'));h.click('Clear and reopen');await until(()=>h.calls.some(c=>c.path.endsWith('/clear')));h.render({url:null});await wait(220);h.render({url:'https://fixture.invalid/new'});await h.ready();const disabled=h.div.querySelector('button[aria-label="Clear login data"]').disabled;gate.resolve({cleared:true});await wait(30);assert(!disabled,'new lifetime inherits old clearBusy')})
await test('late paint ACK for old navigation never enables current input',async()=>{const h=await harness(),gate=deferred();let n=0;h.hooks.paint=()=>++n===1?gate.promise:Promise.resolve({ok:false});await until(()=>n===1);h.render({url:'https://fixture.invalid/new'});await until(()=>n===2);gate.resolve({ok:true});await wait(30);h.event('mousedown');assert(h.actions('mouse').length===0,'stale paint ACK enabled new view')})
await test('old composition ending after navigation does not send text',async()=>{const h=await harness();await h.ready();h.event('compositionstart');h.render({url:'https://fixture.invalid/new'});await until(()=>h.actions('navigate').length);await h.ready();h.event('compositionend',{data:'旧输入'});assert(h.actions('text').length===0,'stale composition sent')})
await test('epoch ABA drops a late open without DELETE to reactivated connection',async()=>{const h=await harness(),gate=deferred();let n=0;h.hooks.open=()=>++n===1?gate.promise:Promise.resolve({id:`epoch-${n}`,...state()});await until(()=>n===1);setFixtureScope('fixture-b',2);await wait(40);setFixtureScope('fixture-a',3);await wait(40);gate.resolve({id:'old-epoch',...state(0,1,'https://obsolete.invalid')});await wait(50);assert(!h.calls.some(c=>c.method==='DELETE'&&c.path.endsWith('old-epoch')),'old epoch DELETE on new route');assert(!h.div.textContent.includes('obsolete.invalid'),'old epoch open displayed')})
await test('late actual PNG decode callback after popup cannot paint or ACK old view',async()=>{const h=await harness();await h.ready();const NativeImage=window.Image,gate=deferred();let delayed=false,loads=0;window.Image=function(){const img=new NativeImage();Object.defineProperty(img,'onload',{set(fn){img.addEventListener('load',()=>{loads++;if(!delayed){delayed=true;gate.promise.then(()=>fn.call(img))}else fn.call(img)})}});return img};try{let n=0;h.hooks.frame=async()=>++n===1?state(1,2,'https://intermediate.invalid'):state(2,3,'https://popup.invalid');await until(()=>loads>=1);await until(()=>h.actions('paint').some(c=>c.body.payload.view===2));gate.resolve();await wait(40);assert(!h.actions('paint').some(c=>c.body.payload.view===1),'late decoded image ACKed');assert(h.div.textContent.includes('https://popup.invalid'),'late image replaced popup')}finally{gate.resolve();window.Image=NativeImage}})
await test('closed preview ignores late frame and allows no further input',async()=>{const h=await harness();await h.ready();const gate=deferred();let pending=false;h.hooks.frame=()=>{pending=true;return gate.promise};await until(()=>pending);h.render({url:null});await wait(30);const paints=h.actions('paint').length;gate.resolve(state(3,8,'https://obsolete.invalid'));await wait(40);h.event('mousedown');assert(h.actions('paint').length===paints&&h.actions('mouse').length===0,'closed life accepted frame/input')})
await test('back with unchanged view repaints valid page instead of permanent loading',async()=>{const h=await harness();await h.ready();h.hooks.back=async()=>state(0,2);h.click('Return to previous page');await until(()=>h.actions('back').length);await h.ready();h.event('mousedown');assert(h.actions('mouse').at(-1)?.body.payload.view===0,'unchanged back lost input')})
await test('late same-profile open from old source epoch never DELETEs on new scope',async()=>{const h=await harness(),gate=deferred();let n=0;h.hooks.open=()=>++n===1?gate.promise:Promise.resolve({id:'new-source-session',...state()});await until(()=>n===1);setFixtureScope('fixture-a',2);await until(()=>n===2);gate.resolve({id:'old-source-session',...state(0,1,'https://obsolete.invalid')});await wait(60);assert(!h.calls.some(c=>c.method==='DELETE'&&c.path.endsWith('old-source-session')),'late old-source id DELETEd on new scope');assert(!h.div.textContent.includes('obsolete.invalid'),'late old source accepted')})
await test('scale resize returning new generation requires new paint ACK before input',async()=>{const h=await harness();await h.ready();const gate=deferred();h.hooks.resize=async()=>state(1,2);h.hooks.paint=()=>gate.promise;h.click('Zoom in article');await until(()=>h.actions('resize').some(c=>c.body.payload.scale===90));await wait(40);h.event('mousedown');const inputCount=h.actions('mouse').length;gate.resolve({ok:true});await wait(40);assert(inputCount===0,'new-generation resize still accepts old-view input');assert(h.actions('paint').some(c=>c.body.payload.view===1),'resize result never adopted/repainted')})
await test('late open during another profile never DELETEs its id on that profile route',async()=>{const h=await harness(),gate=deferred();let n=0;h.hooks.open=()=>++n===1?gate.promise:Promise.resolve({id:'other-profile-session',...state()});await until(()=>n===1);setFixtureScope('fixture-b',1);await until(()=>n===2);gate.resolve({id:'original-profile-session',...state(0,1,'https://obsolete.invalid')});await wait(60);assert(!h.calls.some(c=>c.method==='DELETE'&&c.path.endsWith('original-profile-session')),'original-profile id DELETEd on another profile');assert(!h.div.textContent.includes('obsolete.invalid'),'late original profile accepted')})
const outsideUp = (extra={}) => document.body.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,clientX:1500,clientY:1200,button:0,buttons:0,...extra}))
const releases = h => h.actions('mouse').filter(c=>c.body.payload.type==='mouseReleased')
await test('outside mouseup releases current drag once with clamped viewport coordinates',async()=>{const h=await harness();await h.ready();h.event('mousedown',{buttons:1});outsideUp();outsideUp();assert(releases(h).length===1,'outside release missing or duplicated');const p=releases(h)[0].body.payload;assert(p.view===0&&p.button==='left'&&p.buttons===0&&p.x<=800&&p.y<=600,'invalid outside release')})
await test('canvas mouseup is exactly once despite global listener and bubbling',async()=>{const h=await harness();await h.ready();h.event('mousedown',{buttons:1});h.event('mouseup');outsideUp();assert(releases(h).length===1,'canvas release duplicated or missing')})
await test('window blur releases each held button preserving middle/right masks and clears pending hover',async()=>{const h=await harness();await h.ready();h.event('mousedown',{button:1,buttons:4});h.event('mousedown',{button:2,buttons:6});const gate=deferred();h.hooks.mouse=()=>gate.promise;h.event('mousemove',{buttons:6});h.event('mousemove',{buttons:6});window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('blur'));const rs=releases(h).map(c=>c.body.payload);assert(rs.length===2,'blur missing or duplicate releases');assert(rs[0].button==='middle'&&rs[0].buttons===2&&rs[1].button==='right'&&rs[1].buttons===0,'blur button masks wrong');const count=h.actions('mouse').length;gate.resolve({ok:true});await wait(40);outsideUp({button:1});assert(h.actions('mouse').length===count,'cancelled hover or old release replayed')})
await test('outside middle release keeps right held until its own release',async()=>{const h=await harness();await h.ready();h.event('mousedown',{button:1,buttons:4});h.event('mousedown',{button:2,buttons:6});outsideUp({button:1,buttons:2});outsideUp({button:2,buttons:0});const rs=releases(h).map(c=>c.body.payload);assert(rs.length===2&&rs[0].button==='middle'&&rs[0].buttons===2&&rs[1].button==='right'&&rs[1].buttons===0,'outside multi-button relationship wrong')})
await test('navigation never rebinds an old mouseup to repainted view',async()=>{const h=await harness();await h.ready();h.event('mousedown',{buttons:1});h.render({url:'https://fixture.invalid/new'});await until(()=>h.actions('navigate').length);await h.ready();const count=releases(h).length;outsideUp();h.event('mouseup');window.dispatchEvent(new Event('blur'));assert(releases(h).length===count,'old release sent to new view');h.event('mousedown',{buttons:1});outsideUp();assert(releases(h).length===count+1&&releases(h).at(-1).body.payload.view===1,'new drag did not recover')})
for (const [label,profile,epoch] of [['profile','fixture-b',1],['source','fixture-a',2]]) await test(`${label} change drops old drag listeners without releasing into new session`,async()=>{const h=await harness();await h.ready();h.event('mousedown',{buttons:1});const old=h.id;setFixtureScope(profile,epoch);await until(()=>h.id!==old);await h.ready();const count=releases(h).length;outsideUp();h.event('mouseup');window.dispatchEvent(new Event('blur'));assert(releases(h).length===count,'old release rebound to new scope');h.event('mousedown',{buttons:1});outsideUp();assert(releases(h).length===count+1,'new scope drag broken')})
await test('close and reopen discard previous drag even during close animation',async()=>{const h=await harness();await h.ready();h.event('mousedown',{buttons:1});h.click('Close preview');await until(()=>h.calls.some(c=>c.method==='DELETE'));const count=releases(h).length;outsideUp();window.dispatchEvent(new Event('blur'));await wait(220);h.render({url:'https://fixture.invalid/reopen'});await h.ready();h.event('mouseup');outsideUp();assert(releases(h).length===count,'closed drag rebound')})
await test('unmount removes drag window listeners and sends no late input',async()=>{const h=await harness();await h.ready();const add=window.addEventListener,remove=window.removeEventListener,tracked=new Map();window.addEventListener=function(type,fn,capture){if(type==='mouseup'||type==='blur')tracked.set(fn,type);return add.call(this,type,fn,capture)};window.removeEventListener=function(type,fn,capture){tracked.delete(fn);return remove.call(this,type,fn,capture)};try{h.event('mousedown',{buttons:1});assert(tracked.size===2,'drag listeners not installed');await h.dispose();current=null;assert(tracked.size===0,'drag listeners retained on unmount');const count=h.actions('mouse').length;outsideUp();window.dispatchEvent(new Event('blur'));assert(h.actions('mouse').length===count,'unmounted listener sent input')}finally{window.addEventListener=add;window.removeEventListener=remove}})
await test('same-view back discards the old press even when view number is reused',async()=>{const h=await harness();await h.ready();h.event('mousedown',{buttons:1});h.hooks.back=async()=>state(0,2);h.click('Return to previous page');await until(()=>h.actions('back').length);await h.ready();outsideUp();h.event('mouseup');assert(!releases(h).length,'same-view reset rebound old release')})
await test('popup paint replacement discards old drag before new-view release',async()=>{const h=await harness();await h.ready();h.event('mousedown',{buttons:1});h.hooks.frame=async()=>state(2,2,'https://popup.invalid');await until(()=>h.actions('paint').some(c=>c.body.payload.view===2));await h.ready();outsideUp();h.event('mouseup');assert(!releases(h).length,'popup inherited old drag')})
window.fixtureResult={evidence:'Real React + TanStack React Query in isolated hidden Electron; SDK, REST, session and remote pixels are explicit own-page adapters. Not real Hermes host/backend or login acceptance.',versions:{react:React.version,userAgent:navigator.userAgent},results,wire:window.fixtureWire}
