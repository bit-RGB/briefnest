import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
const localAppData=process.env.LOCALAPPDATA||path.join(homedir(),'AppData','Local')
const hermesLocal=path.join(localAppData,'hermes')
const desktop=process.env.BRIEFNEST_DESKTOP_ROOT||path.join(hermesLocal,'hermes-agent','apps','desktop')
const require=createRequire(path.join(desktop,'package.json'))
const {build}=require('esbuild')
const root=fileURLToPath(new URL('../../',import.meta.url))
const scratch=path.join(hermesLocal,'cache','scratch')
mkdirSync(scratch,{recursive:true})
const output=mkdtempSync(path.join(scratch,'briefnest-stream-react-'))
const source=readFileSync(path.join(root,'desktop/plugin.js'),'utf8')
await build({entryPoints:[path.join(root,'tests/fixtures/stream-react-renderer.mjs')],bundle:true,platform:'browser',format:'esm',outfile:path.join(output,'renderer.js'),define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'explicit-fixture-adapters',setup(build){
 build.onResolve({filter:/^fixture-production$/},()=>({path:'production',namespace:'fixture'}))
 build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:source+'\nexport { PreviewPane, StreamSurface }',resolveDir:path.join(root,'desktop'),loader:'js'}))
 build.onResolve({filter:/^@hermes\/plugin-sdk$/},()=>({path:path.join(root,'tests/fixtures/stream-react-sdk.mjs')}))
 build.onResolve({filter:/^(react(?:\/.*)?|react-dom(?:\/.*)?|@tanstack\/react-query)$/},args=>({path:require.resolve(args.path)}))
}}]})
writeFileSync(path.join(output,'index.html'),'<!doctype html><html><body style="margin:0"><script type="module" src="renderer.js"></script></body></html>')
writeFileSync(path.join(output,'main.cjs'),`const {app,BrowserWindow}=require('electron');const fs=require('node:fs');const path=require('node:path');app.setPath('userData',path.join(__dirname,'isolated-user-data'));app.disableHardwareAcceleration();app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{offscreen:true,backgroundThrottling:false,nodeIntegration:false,contextIsolation:true,sandbox:true}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.session.webRequest.onBeforeRequest((details,cb)=>cb({cancel:!details.url.startsWith('file:')&&!details.url.startsWith('data:')}));win.webContents.on('console-message',(_e,...args)=>fs.appendFileSync(path.join(__dirname,'renderer-console.log'),args.join(' ')+'\\n'));await win.loadFile(path.join(__dirname,'index.html'));const started=Date.now();while(Date.now()-started<60000){const result=await win.webContents.executeJavaScript('window.fixtureResult||null');if(result){fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify(result,null,2));win.destroy();app.quit();return}await new Promise(r=>setTimeout(r,50))}fs.writeFileSync(path.join(__dirname,'fatal.txt'),'renderer suite timeout');app.exit(2)}).catch(e=>{fs.writeFileSync(path.join(__dirname,'fatal.txt'),String(e.stack));app.exit(2)});`)
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const execution=spawnSync(path.join(desktop,'node_modules/electron/dist/electron.exe'),[path.join(output,'main.cjs')],{env,encoding:'utf8',timeout:80000,windowsHide:true})
console.log(`Isolated React/Electron report: ${path.join(output,'report.json')}`)
assert.equal(execution.status,0,`Electron failed: ${execution.error||execution.stderr}; artifacts ${output}`)
const report=JSON.parse(readFileSync(path.join(output,'report.json'),'utf8'))
report.sourceSha256=createHash('sha256').update(source).digest('hex')
report.queryVersion=require('@tanstack/react-query/package.json').version
report.command=`${process.execPath} --test tests/test_desktop_native_browser.mjs`
report.inputEvidence='DOM MouseEvent/KeyboardEvent/CompositionEvent/ClipboardEvent dispatched into real React handlers; no OS IME or physical input claim.'
writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2))
assert.equal(report.results.length,46,'all lifecycle scenarios must execute')
console.log(report.evidence)
console.log(JSON.stringify(report.versions))
for(const result of report.results)test(result.name,()=>assert.ok(result.ok,result.error))
test('actual React DOM action envelopes satisfy the production worker schema',()=>{
  const {validate}=require(path.join(root,'browser/worker.cjs'))
  for(const kind of ['mousePressed','mouseReleased','mouseMoved','mouseWheel']) {
    assert.ok(report.wire.some(entry=>entry.op==='mouse'&&entry.payload.type===kind))
  }
  for(const entry of report.wire) assert.doesNotThrow(()=>validate(entry.op,entry.payload),`production schema rejected fixture ${entry.op}`)
})
