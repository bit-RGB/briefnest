'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {Browser}=require('./runtime.cjs');
const root=()=>fs.mkdtempSync(path.join(process.env.TMPDIR,'briefnest-lock-test-'));
if(process.argv[2]==='lock-child') {
  (async()=>{
    const b=new Browser(process.argv[3]);
    try { await b.acquireProfile(); process.stdout.write('owned\n'); }
    catch(e) { process.stdout.write(e.message+'\n'); return; }
    process.stdin.resume();
    process.stdin.on('end',async()=>{await b.releaseProfile();});
  })().catch(()=>{process.exitCode=1;});
} else {
  function launch(r) {
    const child=spawn(process.execPath,[__filename,'lock-child',r],{stdio:['pipe','pipe','ignore'],windowsHide:true});
    const exit=once(child,'exit');
    const ready=new Promise((resolve,reject)=>{let s='';child.on('error',reject);child.stdout.on('data',x=>{s+=x;if(s.includes('\n'))resolve(s.trim());});child.once('exit',()=>{if(!s)reject(new Error('child exited before lock result'));});});
    return {child,exit,ready};
  }
  for(const tree of [false,true])test((tree?'hard owned-tree kill':'hard process exit')+' leaves marker but next real process reacquires same profile',{timeout:30000},async()=>{
    const r=root();let first,next;
    try {
      first=launch(r);assert.equal(await first.ready,'owned');
      if(tree) {
        const killer=spawn(path.join(process.env.SystemRoot || 'C:/Windows','System32','taskkill.exe'),['/PID',String(first.child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
        assert.equal((await once(killer,'exit'))[0],0);
      } else first.child.kill('SIGKILL');
      await first.exit;
      assert.equal(fs.existsSync(path.join(r,'.briefnest-browser.lock')),true);
      next=launch(r);assert.equal(await next.ready,'owned');
      next.child.stdin.end();await next.exit;
      assert.equal(fs.existsSync(path.join(r,'.briefnest-browser.lock')),false);
    } finally {
      for(const p of [first,next])if(p && p.child.exitCode===null && !p.child.signalCode){p.child.kill('SIGKILL');await p.exit;}
      fs.rmSync(r,{recursive:true,force:true});
    }
  });
  test('concurrent processes admit exactly one owner, release permits immediate retry',{timeout:30000},async()=>{
    const r=root(),children=[];
    try {
      for(let i=0;i<4;i++)children.push(launch(r));
      const states=await Promise.all(children.map(c=>c.ready));
      assert.equal(states.filter(s=>s==='owned').length,1);
      assert.equal(states.filter(s=>s==='profile_locked').length,3);
      const owner=children[states.indexOf('owned')];owner.child.stdin.end();await owner.exit;
      const retry=launch(r);children.push(retry);assert.equal(await retry.ready,'owned');retry.child.stdin.end();await retry.exit;
    } finally {
      for(const p of children)if(p.child.exitCode===null && !p.child.signalCode){p.child.kill('SIGKILL');await p.exit;}
      fs.rmSync(r,{recursive:true,force:true});
    }
  });
}
