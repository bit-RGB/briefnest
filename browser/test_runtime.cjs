'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const http = require('node:http');
let mod; try { mod = require('./runtime.cjs'); } catch(e) { if(e.code !== 'MODULE_NOT_FOUND') throw e; }
const scratch = process.env.TMPDIR || path.join(os.homedir(),'AppData/Local/hermes/cache/scratch');
function root() { return fs.mkdtempSync(path.join(scratch, 'briefnest-production-test-')); }
function subprocess(args) {
  return new Promise((resolve,reject)=>{const c=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});let out='',err='';c.stdout.on('data',x=>out+=x);c.stderr.on('data',x=>err+=x);c.on('error',reject);c.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(new Error('Fixture child failed: '+err)));});
}
if(process.argv[2] === 'fixture-child') {
 (async()=>{const {Browser}=require('./runtime.cjs'); const [r,origin,mode]=process.argv.slice(3);const b=new Browser(r,origin);try{await b.start();await b.navigate(origin+'/');
 for(let i=0;i<100 && b.siteOrigin!==origin;i++) await new Promise(r=>setTimeout(r,50));
 // Test-only inspection of our explicitly supplied synthetic fixture, never a real account.
 if(mode==='write')await b.cdp.call('Runtime.evaluate',{expression:"document.cookie='briefnest_mock=synthetic; Max-Age=3600; SameSite=Lax';localStorage.setItem('briefnest_mock','synthetic');true",returnByValue:true},b.sid);
 const expression="({cookiePresent:document.cookie.includes('briefnest_mock=synthetic'),storagePresent:localStorage.getItem('briefnest_mock')==='synthetic',permissionDenied:Notification.permission==='denied'})";
 const result=await b.cdp.call('Runtime.evaluate',{expression,returnByValue:true},b.sid);
 assert.equal(result.exceptionDetails,undefined); const present=result.result.value;
 assert.equal(present.permissionDenied,true);delete present.permissionDenied;
 assert.equal(typeof b.context,'string');assert.ok(b.context.length>0,'default TargetInfo context must be discovered');
 await b.stop(); process.stdout.write(JSON.stringify({...present,closed:b.processExited()}));}finally{await b.stop();}})().catch(e=>{process.stderr.write('fixture assertion failed: '+e.message+' '+(e.operation || ''));process.exitCode=1;});
} else {
 test('production runtime exists and exposes no fixture inspection API',()=>{assert.ok(mod,'persistent runtime not implemented'); assert.equal(mod.Browser.prototype.fixtureEvaluate,undefined);assert.equal(mod.Browser.prototype.fixtureCookies,undefined);});
 test('exclusive lock, owned clear, and junction escape refusal',async()=>{assert.ok(mod);const r=root(),b=new mod.Browser(r);try{await b.acquireProfile();const other=new mod.Browser(r);await assert.rejects(other.acquireProfile(),/profile_locked/);await assert.rejects(other.clear(),/profile_locked/);await b.stop();fs.writeFileSync(path.join(r,'unrelated'),'keep');const c=new mod.Browser(r);assert.deepEqual(await c.clear(),{cleared:true});assert.equal(fs.readFileSync(path.join(r,'unrelated'),'utf8'),'keep');assert.equal(fs.existsSync(path.join(r,'edge-profile')),false);
 const outside=root();fs.symlinkSync(outside,path.join(r,'edge-profile'),'junction');await assert.rejects(new mod.Browser(r).clear(),/unsafe_profile/);fs.unlinkSync(path.join(r,'edge-profile'));fs.rmSync(outside,{recursive:true});}finally{await b.stop();fs.rmSync(r,{recursive:true,force:true});}});
 test('real separate processes retain expiring mock Cookie and localStorage, isolate and clear',{timeout:180000},async()=>{assert.ok(mod);const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Owned synthetic fixture</title><p>Mock only</p>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,a=root(),b=root();try{const run=(r,mode)=>subprocess([__filename,'fixture-child',r,origin,mode]);assert.deepEqual(await run(a,'read'),{cookiePresent:false,storagePresent:false,closed:true});assert.deepEqual(await run(a,'write'),{cookiePresent:true,storagePresent:true,closed:true});assert.deepEqual(await run(a,'read'),{cookiePresent:true,storagePresent:true,closed:true});assert.deepEqual(await run(b,'read'),{cookiePresent:false,storagePresent:false,closed:true});assert.deepEqual(await new mod.Browser(a).clear(),{cleared:true});assert.deepEqual(await run(a,'read'),{cookiePresent:false,storagePresent:false,closed:true});}finally{await new Promise(r=>server.close(r));fs.rmSync(a,{recursive:true,force:true});fs.rmSync(b,{recursive:true,force:true});}});
}
