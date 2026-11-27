'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {Browser}=require('./runtime.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<120;i++){if(fn())return;await wait(25);}throw Error('owned recovery condition timed out');}
test('last page can be recreated in the same persistent context without disabling popup admission', {timeout:60000}, async()=>{
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><body>Owned root fixture<script>if(location.pathname==="/set"){document.cookie="mock=1; Max-Age=3600; Path=/";localStorage.setItem("mock","1")}</script></body>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR,'briefnest-root-recovery-'));
 const b=new Browser(root,origin);
 try{
  await b.start();await b.navigate(origin+'/set');await until(()=>b.documentReady&&b.latestFrame);
  const pid=b.child.pid;
  await b.cdp.call('Target.closeTarget',{targetId:b.target});await until(()=>!b.sid);
  assert.equal(b.state().frame,null);
  await b.navigate(origin+'/read');await until(()=>b.documentReady&&b.latestFrame&&b.siteOrigin===origin);
  assert.equal(b.child.pid,pid,'recovery must not discard the browser session');
  const result=await b.cdp.call('Runtime.evaluate',{expression:'document.cookie.includes("mock=1") && localStorage.getItem("mock")==="1"',returnByValue:true},b.sid);
  assert.equal(result.result.value,true,'own mock login state was lost');
  b.acknowledgePaint(b.displayEpoch,b.latestFrame.seq);
  await b.mouse({type:'mouseMoved',x:20,y:20,button:'none',buttons:0,clickCount:0,view:b.displayEpoch});
  await b.cdp.call('Target.closeTarget',{targetId:b.target});await until(()=>!b.sid);
  await b.reload();await until(()=>b.documentReady&&b.latestFrame&&b.siteOrigin===origin);
  assert.equal(b.child.pid,pid);
 }finally{await b.stop();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
