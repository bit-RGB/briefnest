'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Browser } = require('./runtime.cjs');
function make() {
  const b = new Browser('.', 'http://127.0.0.1:54321');
  b.context='ctx'; b.target='parent'; b.sid='sid'; b.mainFrame='root'; b.pages=[{target:'parent',sid:'sid'}];
  b.cdp={call:async()=>({}),ws:{close(){}}}; return b;
}
test('unowned opener-less pages in this context are rejected, foreign contexts are untouched', async()=>{
  const b=make(), closed=[]; b.cdp.call=async(method,p)=>{if(method==='Target.closeTarget')closed.push(p.targetId);return{}};
  for(const [targetId,browserContextId] of [['unexpected','ctx'],['foreign','other']]) b.onEvent({method:'Target.targetCreated',params:{targetInfo:{targetId,browserContextId,type:'page',url:'https://example.test/'}}});
  await Promise.resolve(); assert.deepEqual(closed,['unexpected']);
});
test('popup admission reserves queued capacity synchronously',()=>{
  const b=make(); b.pages.push({target:'p2',sid:'s2'},{target:'p3',sid:'s3'}); b.gesture={target:'parent',at:Date.now()};
  b.queueSwitch=()=>{};
  b.onEvent({method:'Target.attachedToTarget',params:{sessionId:'pending-sid',waitingForDebugger:true,targetInfo:{targetId:'pending',browserContextId:'ctx',type:'page',openerId:'parent',url:'https://example.test/'}}});
  assert.equal(b.pendingPopups.size,1);
  b.gesture={target:'parent',at:Date.now()};
  assert.equal(b.canFollowPopup({targetId:'extra',browserContextId:'ctx',type:'page',openerId:'parent',url:'https://example.test/'}),false);
});
test('foreign attached contexts receive no commands and owned admission never manually reattaches',async()=>{
 const b=make(),calls=[];b.gesture={target:'parent',at:Date.now()};
 b.cdp.call=async(m,p,sid)=>{calls.push({m,sid});return{};};
 b.onEvent({method:'Target.attachedToTarget',params:{sessionId:'foreign-sid',waitingForDebugger:true,targetInfo:{type:'page',targetId:'foreign',openerId:'parent',browserContextId:'other',url:'about:blank'}}});
 await Promise.resolve();assert.equal(calls.length,0);
 b.activatePage=async()=>{};
 b.onEvent({method:'Target.attachedToTarget',params:{sessionId:'child-sid',waitingForDebugger:true,targetInfo:{type:'page',targetId:'child',openerId:'parent',browserContextId:'ctx',url:'about:blank'}}});
 await b.switchQueue;
 assert.equal(calls.some(c=>c.m==='Target.attachToTarget'),false);
 const methods=calls.map(c=>c.m);
 assert.ok(methods.indexOf('Fetch.enable')<methods.indexOf('Runtime.runIfWaitingForDebugger'));
 assert.equal(calls.filter(c=>c.m==='Runtime.runIfWaitingForDebugger').length,1);
 assert.equal(calls.some(c=>c.sid==='foreign-sid'),false);
});
test('failed Fetch installation never resumes a waiting popup',async()=>{
 const b=make(),calls=[];
 b.cdp.call=async(m)=>{calls.push(m);if(m==='Fetch.enable')throw new Error('synthetic refusal');return{};};
 await assert.rejects(b.followPopup({targetId:'child',browserContextId:'ctx'},b.epoch,'child-sid'));
 assert.equal(calls.includes('Runtime.runIfWaitingForDebugger'),false);
 assert.equal(calls.includes('Target.closeTarget'),true);
});
test('document navigation invalidates painted input generation and stale inputs never dispatch',async()=>{
  const b=make(), calls=[]; b.seedFrame=async()=>{}; b.cdp.call=async(m)=>{calls.push(m);return{}};
  b.displayEpoch=4; b.displayReady=true; b.documentReady=true;
  b.onEvent({method:'Page.frameNavigated',sessionId:'sid',params:{frame:{id:'root',loaderId:'new-loader',url:'https://example.test/new'}}});
  assert.ok(b.displayEpoch>4); assert.equal(b.displayReady,false); assert.equal(b.latestFrame,null);
  await assert.rejects(b.text('old text',4));
  await assert.rejects(b.key({type:'keyDown',key:'Enter',view:4}));
  assert.equal(calls.includes('Input.insertText'),false); assert.equal(calls.includes('Input.dispatchKeyEvent'),false);
});
test('last target destruction enters a clean non-interactive empty state',()=>{
  const b=make(); b.latestFrame={data:'synthetic'}; b.siteOrigin='https://example.test'; b.displayReady=true;
  b.onEvent({method:'Target.targetDestroyed',params:{targetId:'parent'}});
  assert.equal(b.sid,null); assert.equal(b.target,null); assert.equal(b.siteOrigin,''); assert.equal(b.latestFrame,null); assert.equal(b.displayReady,false);
});
test('failed popup preparation closes the candidate without losing its live parent',async()=>{
  const b=make(), closed=[];
  b.cdp.call=async(method,p)=>{if(method==='Target.attachToTarget')return{sessionId:'child-session'};if(method==='Page.enable')throw new Error('injected initialization failure');if(method==='Target.closeTarget')closed.push(p.targetId);return{}};
  await assert.rejects(b.followPopup({targetId:'child',browserContextId:'ctx'},b.epoch,'child-session'));
  assert.deepEqual(closed,['child']); assert.equal(b.target,'parent'); assert.equal(b.pages.some(p=>p.target==='child'),false);
});
test('stream frames captured before the document generation are acknowledged but not displayed',()=>{
  const b=make(), shown=[]; b.displayEpoch=2; b.documentReady=true; b.frameCutoff=100;
  b.on('frame',frame=>shown.push(frame));
  for(const timestamp of [99,101])b.onEvent({method:'Page.screencastFrame',sessionId:'sid',params:{data:'synthetic',sessionId:1,metadata:{timestamp}}});
  assert.equal(shown.length,1); assert.equal(shown[0].view,2);
});
test('failure after selecting a child restores the surviving parent and releases the reservation',async()=>{
  const b=make(), closed=[]; b.pendingPopups.add('child'); b.seedFrame=async()=>{};
  b.cdp.call=async(method,p,sid)=>{
    if(method==='Target.attachToTarget')return{sessionId:'child-session'};
    if(method==='Page.getFrameTree'&&sid==='child-session')throw new Error('injected selected-child failure');
    if(method==='Page.getFrameTree')return{frameTree:{frame:{id:'root',loaderId:'parent-loader',url:'https://example.test/'}}};
    if(method==='Target.closeTarget')closed.push(p.targetId);
    return{};
  };
  await assert.rejects(b.followPopup({targetId:'child',browserContextId:'ctx'},b.epoch,'child-session'));
  assert.deepEqual(closed,['child']); assert.equal(b.target,'parent'); assert.equal(b.sid,'sid');
  assert.equal(b.pendingPopups.size,0); assert.equal(b.pages.length,1);
});
