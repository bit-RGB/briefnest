'use strict';
// A kernel mutex, not the on-disk marker, is the authority for ownership.
// No caller-supplied script, executable, flags, name or environment is accepted.
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
async function acquire(root) {
  if(process.platform!=='win32')throw new Error('browser_unavailable');
  const canonical=fs.realpathSync.native(root).replace(/\\/g,'/').toLowerCase();
  const digest=createHash('sha256').update(canonical).digest('hex');
  // Only a generated hex digest is interpolated; paths never enter PowerShell.
  const script=`$ErrorActionPreference='Stop'
$m=$null;$owned=$false
try {
 $m=[System.Threading.Mutex]::new($false,'Global\\BriefNest.Profile.v1.${digest}')
 try { $owned=$m.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned=$true }
 if(-not $owned) { [Console]::Out.WriteLine('locked');exit 0 }
 [Console]::Out.WriteLine('owned');[Console]::Out.Flush()
 $inputStream=[Console]::OpenStandardInput()
 while($inputStream.ReadByte() -ne -1) {}
} finally {
 if($owned) { $m.ReleaseMutex() }
 if($null -ne $m) { $m.Dispose() }
}`;
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>new Set(['SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR']).has(k.toUpperCase())));
  const executable=path.join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env,stdio:['pipe','pipe','ignore'],windowsHide:true});
  let exited=false;
  const exit=new Promise(resolve=>{child.once('exit',()=>{exited=true;resolve();});child.once('error',()=>{exited=true;resolve();});});
  child.stdin.on('error',()=>{});
  async function release() {
    if(!exited) child.stdin.end();
    // Await actual process exit: a successful EOF write is not mutex release.
    let timer;
    await Promise.race([exit,new Promise(resolve=>{timer=setTimeout(()=>{if(!exited)child.kill();resolve();},3000);})]);
    clearTimeout(timer);await exit;
  }
  try {
    const result=await new Promise((resolve,reject)=>{
      let text='';const timer=setTimeout(()=>reject(new Error('browser_unavailable')),10000);
      const finish=value=>{clearTimeout(timer);resolve(value);};
      child.stdout.on('data',chunk=>{text+=chunk;if(text.length>64){clearTimeout(timer);reject(new Error('browser_unavailable'));}else if(text.includes('\n'))finish(text.trim());});
      exit.then(()=>finish('exited'));
    });
    if(result!=='owned')throw new Error(result==='locked'?'profile_locked':'browser_unavailable');
    return {release,get alive(){return !exited;},exit};
  } catch(e) { await release();throw e; }
}
module.exports={acquire};
