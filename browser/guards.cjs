'use strict';
exports.isOwnedPopup = (info, owner) => typeof owner === 'string' && owner.length > 0 && info.openerId === owner;
exports.validUrl = (value, fixtureOrigin) => {
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === 'https:' || url.origin === fixtureOrigin);
  } catch { return false; }
};
exports.point = (value, width, height) => {
  const { x, y } = value || {};
  if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > width || y > height) throw new Error('Invalid pointer');
  return { x, y };
};
exports.boundedText = value => {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid text');
  return value;
};
exports.geometry = (w, h, scale) => {
  if (![w, h, scale].every(Number.isFinite) || w < 100 || h < 100 || w > 2400 || h > 1800 || scale < 40 || scale > 150) throw new Error('Invalid viewport');
  return { width: Math.min(3200, Math.round(w * 100 / scale)), height: Math.min(2400, Math.round(h * 100 / scale)), scale };
};

const fs=require('node:fs'); const path=require('node:path');
exports.assertNoLinks=function assertNoLinks(value) {
  const full=path.resolve(value); let current=path.parse(full).root;
  for(const part of full.slice(current.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    try { if(fs.lstatSync(current).isSymbolicLink()) throw new Error('unsafe_profile'); }
    catch(e) { if(e.code!=='ENOENT') throw e; }
  }
};
exports.assertTreeNoLinks=function scan(dir) {
  if(!fs.existsSync(dir)) return;
  if(fs.lstatSync(dir).isSymbolicLink()) throw new Error('unsafe_profile');
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const p=path.join(dir,entry.name);
    if(entry.isSymbolicLink()) throw new Error('unsafe_profile');
    if(entry.isDirectory()) scan(p);
  }
};
exports.findBrowser=()=>{
  const candidates=process.platform==='win32' ? [
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || 'C:/Program Files','Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe')
  ] : ['/usr/bin/microsoft-edge','/usr/bin/chromium','/usr/bin/chromium-browser','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  const found=candidates.find(p=>fs.existsSync(p)); if(!found) throw new Error('browser_unavailable'); return found;
};
