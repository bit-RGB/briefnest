'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const {Browser,delay}=require('./runtime.cjs');
async function until(predicate){for(let i=0;i<200;i++){if(await predicate())return;await delay(50);}throw new Error('Owned fixture condition timed out');}
test('real persistent default-context popup follows painted pointer gesture, returns, navigates, backs and reloads',{timeout:60000},async()=>{
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR,'briefnest-real-navigation-'));
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Synthetic own fixture</title><a href="/child" target="_blank" style="position:absolute;left:10px;top:10px;width:200px;height:60px">Open mock popup</a>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;const b=new Browser(root,origin);
 try{
  await b.resize(800,600,100);await b.start();await b.navigate(origin+'/first');await until(()=>b.latestFrame&&b.siteOrigin===origin);await delay(100);
  const parent=b.target,oldView=b.displayEpoch;b.acknowledgePaint(b.displayEpoch,b.latestFrame.seq);
  await b.mouse({type:'mousePressed',x:30,y:30,view:b.displayEpoch});await b.mouse({type:'mouseReleased',x:30,y:30,view:b.displayEpoch});
  await until(()=>b.pages.length===2&&b.target!==parent&&b.latestFrame&&b.siteOrigin===origin);
  assert.ok(b.displayEpoch>oldView);await assert.rejects(b.text('old synthetic input',oldView));
  await b.back();await until(()=>b.target===parent&&b.pages.length===1&&b.latestFrame&&b.siteOrigin===origin);
  const beforeNav=b.displayEpoch;await b.navigate(origin+'/second');await until(()=>b.latestFrame&&b.displayEpoch>beforeNav&&b.siteOrigin===origin);
  await b.back();await until(async()=>{const t=await b.cdp.call('Page.getFrameTree',{},b.sid);return t.frameTree.frame.url===origin+'/first'&&!!b.latestFrame;});
  const beforeReload=b.displayEpoch;await b.reload();await until(()=>b.displayEpoch>beforeReload&&!!b.latestFrame&&b.siteOrigin===origin);
  const result=await b.clear();assert.deepEqual(result,{cleared:true});assert.equal(b.processExited(),true);assert.equal(fs.existsSync(path.join(root,'edge-profile')),false);
 }finally{await b.stop();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
