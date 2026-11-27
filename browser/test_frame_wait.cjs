'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {Browser, delay} = require('./runtime.cjs');
const {validate} = require('./worker.cjs');

function statusOnly(s) { return {view:s.view, seq:s.seq, hasFrame:!!s.frame}; }
function publish(b) {
  b.onEvent({sessionId:b.sid, method:'Page.screencastFrame',
    params:{data:'synthetic',sessionId:1,metadata:{timestamp:Date.now()/1000}}});
}

test('wait wraps only the latest slot and does not spin on an empty new view', async () => {
  const b = new Browser();
  b.sid = 'active'; b.documentReady = true;
  publish(b); publish(b);
  assert.deepEqual(statusOnly(await b.waitForFrame(0, 1000)), {view:0,seq:2,hasFrame:true});
  const old = b.waitForFrame(2, 1000);
  await assert.rejects(b.waitForFrame(2, 1000), {message:'busy'});
  b.beginView();
  assert.deepEqual(statusOnly(await old), {view:1,seq:2,hasFrame:false});
  const start = performance.now();
  const idle = b.waitForFrame(2, 55);
  b.beginView(); b.beginView(); // StartedLoading/FrameNavigated can follow local navigation.
  assert.equal((await idle).frame, null);
  assert.ok(performance.now() - start >= 40);
  const fresh = b.waitForFrame(2, 1000);
  b.documentReady = true;
  publish(b); publish(b);
  assert.deepEqual(statusOnly(await fresh), {view:3,seq:4,hasFrame:true});
  const stopping = b.waitForFrame(4, 1000);
  await b.stop();
  assert.deepEqual(statusOnly(await stopping), {view:3,seq:4,hasFrame:false});
  assert.equal(b.listenerCount('frame'), 0);
});

test('worker wait is strictly a bounded integer', () => {
  for (const wait_ms of [undefined, 0, 1000]) validate('frame', wait_ms === undefined ? {} : {wait_ms});
  for (const wait_ms of [null, false, -1, 1001, 0.5, '1000']) {
    assert.throws(() => validate('frame', {wait_ms}), {message:'invalid_request'});
  }
});

test('a late seed cannot replace an already promoted document frame', async () => {
  const b = new Browser();
  b.sid = 'active';
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  let captures = 0;
  b.cdp = {call: async method => {
    if (method === 'Page.getFrameTree') return {frameTree:{frame:{loaderId:'loader',url:'about:blank'}}};
    if (method === 'Page.captureScreenshot') return ++captures === 1 ? delayed : {data:'seed'};
    return {};
  }};
  const older = b.seedFrame(0, 'active', 'loader');
  await b.seedFrame(0, 'active', 'loader');
  publish(b);
  const current = b.state().seq;
  release({data:'obsolete'});
  await older;
  assert.equal(b.state().seq, current);
});

test('loopback Edge worker: one waiter, live controls, newest PNG and close cleanup', {
  skip: process.env.BRIEFNEST_FRAME_WAIT_TEST !== '1', timeout:60_000
}, async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><style>body {margin:0}</style><canvas width=1150 height=730></canvas>' +
      (req.url === '/moving' ? '<script>const c=document.querySelector("canvas").getContext("2d");let i=0;setInterval(()=>{c.fillStyle=`hsl(${i++%360} 80% 50%)`;c.fillRect(0,0,1150,730)},30)</script>' : ''));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR, 'briefnest-frame-wait-'));
  // Test process only: enable the same exact owned fixture origin in validation
  // and Browser. The production worker has no fixture switch or extra RPC.
  const preload = path.join(root, 'fixture.cjs');
  const guards = path.join(__dirname, 'guards.cjs'), runtime = path.join(__dirname, 'runtime.cjs');
  fs.writeFileSync(preload, `const g=require(${JSON.stringify(guards)}),v=g.validUrl,o=${JSON.stringify(origin)};g.validUrl=(url,fixture)=>v(url,fixture??o);const r=require(${JSON.stringify(runtime)});r.Browser=class extends r.Browser{constructor(root){super(root,o)}};`);
  const child = spawn(process.execPath, ['--require', preload, path.join(__dirname, 'worker.cjs'), '--profile-root', root], {stdio:['pipe','pipe','ignore']});
  const exited = new Promise(resolve => child.once('exit', resolve));
  const pending = new Map(); let id = 0, replies = 0;
  readline.createInterface({input:child.stdout}).on('line', line => {
    const {id, ok, result, error} = JSON.parse(line);
    ++replies;
    const deliver = pending.get(id);
    if (deliver) { pending.delete(id); deliver({ok, error, ...(result && {state:statusOnly(result), format:result.frame?.format})}); }
  });
  function send(op,payload={}) {
    const serial = ++id;
    return new Promise(resolve => {
      pending.set(serial, resolve);
      child.stdin.write(JSON.stringify({id:serial, op, payload})+'\n');
    });
  }
  const frame = (after_seq,wait_ms=1000) => send('frame',{after_seq,wait_ms});
  try {
    assert.equal((await frame(0)).error,'invalid_state');
    assert.equal((await send('open',{url:origin+'/still',width:1150,height:730,scale:100})).ok,true);
    let first = await frame(0);
    for (let i=0; !first.state?.hasFrame && i<4; i++) first = await frame(0);
    assert.equal(first.format,'png');
    await delay(300);
    const settled = await frame(0);
    const idle = frame(settled.state.seq, 800);
    const duplicate = await frame(settled.state.seq);
    assert.equal(duplicate.error,'busy');
    const paint = await Promise.race([send('paint',{view:settled.state.view,seq:settled.state.seq}), idle.then(()=>null)]);
    assert.equal(paint?.ok,true,'paint must respond before the idle waiter');
    const mouse = await Promise.race([send('mouse',{type:'mouseMoved',x:20,y:20,view:settled.state.view}), idle.then(()=>null)]);
    assert.equal(mouse?.ok,true,'input must respond before the idle waiter');
    assert.equal((await idle).state.hasFrame,false);
    const viewWait = frame(settled.state.seq,1000);
    assert.equal((await send('navigate',{url:origin+'/moving'})).ok,true);
    const switched = await viewWait;
    assert.ok(switched.state.view > settled.state.view);
    const animation = await frame(settled.state.seq);
    assert.equal(animation.format,'png');
    const count = replies;
    await delay(300);
    assert.equal(replies,count,'no PNGs queued or sent without a request');
    const newest = await frame(animation.state.seq);
    assert.ok(newest.state.seq > animation.state.seq + 1,'skip intermediate frames');
    const closing = frame(Number.MAX_SAFE_INTEGER,1000);
    assert.equal((await send('close')).ok,true);
    assert.equal((await closing).state.hasFrame,false);
    assert.equal(await exited,0);
    assert.equal(pending.size,0);
    assert.equal(fs.existsSync(path.join(root,'.briefnest-browser.lock')),false);
  } finally {
    if (child.exitCode === null) { child.stdin.end(); await exited; }
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
