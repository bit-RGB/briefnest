'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const {Browser,delay}=require('./runtime.cjs');
async function until(fn) {for(let i=0;i<160;i++){if(fn())return;await delay(50);}assert.fail('fixture state timed out');}
async function paint(b) {await until(()=>b.documentReady&&!!b.latestFrame&&!!b.siteOrigin);b.acknowledgePaint(b.displayEpoch,b.latestFrame.seq);}
async function click(b,y) {await paint(b);const view=b.displayEpoch;await b.mouse({type:'mousePressed',button:'left',buttons:1,x:40,y,view});await b.mouse({type:'mouseReleased',button:'left',buttons:0,x:40,y,view});}
test('paused popup first request is filtered before network, allowed popup follows and back restores parent',{timeout:60000},async()=>{
 let forbiddenHits=0,allowedHits=0;
 const forbidden=http.createServer((q,s)=>{forbiddenHits++;s.end('<title>Forbidden synthetic fixture</title>');});
 await new Promise(r=>forbidden.listen(0,'127.0.0.1',r));
 const denied='http://127.0.0.1:'+forbidden.address().port;
 const allowed=http.createServer((q,s)=>{
   s.setHeader('Content-Type','text/html');
   if(q.url==='/child'){allowedHits++;s.end('<title>Allowed synthetic child</title><p>Child</p>');return;}
   s.end(`<!doctype html><title>Owned synthetic source</title><style>button{position:absolute;left:10px;width:200px;height:40px}</style><button style="top:10px" onclick="const p=window.open('about:blank');p.location='${denied}/blocked'">Disallowed blank popup</button><button style="top:70px" onclick="window.open('/child')">Allowed popup</button>`);
 });
 await new Promise(r=>allowed.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+allowed.address().port;
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR,'briefnest-popup-test-')),b=new Browser(root,origin);
 try {
  await b.start();await b.navigate(origin+'/');await paint(b);const parent=b.target;
  await click(b,25);await delay(1200);await b.switchQueue;
  assert.equal(forbiddenHits,0,'no forbidden HTTP request may leave the paused new target');
  if(b.target!==parent){await b.back();await until(()=>b.target===parent);}
  await click(b,85);await until(()=>b.target!==parent&&b.pages.length===2&&b.siteOrigin===origin);await paint(b);
  assert.ok(allowedHits>=1);await b.back();await until(()=>b.target===parent&&b.pages.length===1);await paint(b);
  assert.equal(forbiddenHits,0);
 } finally {await b.stop();await Promise.all([new Promise(r=>allowed.close(r)),new Promise(r=>forbidden.close(r))]);fs.rmSync(root,{recursive:true,force:true});}
});
