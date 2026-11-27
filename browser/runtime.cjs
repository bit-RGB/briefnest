'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { validUrl, point, boundedText, geometry, isOwnedPopup, assertNoLinks, assertTreeNoLinks, findBrowser } = require('./guards.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class Channel extends EventEmitter {
  constructor(ws) {
    super(); this.ws = ws; this.next = 0; this.pending = new Map();
    ws.addEventListener('message', event => {
      let m; try { m = JSON.parse(String(event.data)); } catch { return; }
      if (m.id) {
        const p = this.pending.get(m.id); if (!p) return;
        this.pending.delete(m.id); clearTimeout(p.timer);
        if(m.error) { const error=new Error('browser_error'); error.operation=p.method; p.reject(error); } else p.resolve(m.result || {});
      } else this.emit('event', m);
    });
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Browser disconnected')); }
      this.pending.clear(); this.emit('disconnected');
    });
  }
  call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Browser protocol timeout: ' + method)); }, 12000);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('Browser unavailable')); }
    });
  }
}

class Browser extends EventEmitter {
  constructor(root, fixtureOrigin) {
    super(); this.on('status', s => { if(s.kind !== 'site') this.status=s.kind; }); this.root = root; this.fixtureOrigin = fixtureOrigin; this.width = 900; this.height = 650;
    this.scale = 100; this.frames = 0; this.latestFrame = null; this.fixtureOnly = true; this.stopping = false;
    this.siteOrigin = ''; this.mainFrame = null;
    this.pages = []; this.epoch = 0; this.displayEpoch = 0; this.gesture = null; this.switchQueue = Promise.resolve();
    this.pendingPopups = new Set(); this.displayReady = false; this.documentReady = false; this.frameCutoff = 0; this.creatingRoot = false;
  }
  async acquireProfile() {
    if (this.profileAcquirePending) return this.profileAcquirePending;
    this.profileAcquirePending = this.acquireProfileOwned();
    try { await this.profileAcquirePending; } finally { this.profileAcquirePending = null; }
  }
  async acquireProfileOwned() {
    if (this.lockFd !== undefined) {
      if (!this.profileMutex?.alive) throw new Error('profile_locked');
      return;
    }
    if (typeof this.root !== 'string' || !path.isAbsolute(this.root)) throw new Error('unsafe_profile');
    this.root = path.resolve(this.root);
    assertNoLinks(this.root); fs.mkdirSync(this.root, { recursive: true }); assertNoLinks(this.root);
    this.profile = path.join(this.root, 'edge-profile');
    const lock = path.join(this.root, '.briefnest-browser.lock');
    assertNoLinks(lock);
    const mutex = await require('./profile_lock.cjs').acquire(this.root);
    this.profileMutex = mutex;
    mutex.exit.then(() => {
      // Losing the kernel lock must never leave a functioning browser owner.
      if (this.profileMutex === mutex) void this.stop().catch(() => {});
    });
    try {
      assertNoLinks(this.root); assertNoLinks(lock);
      // Only the OS-exclusive owner may reclaim a marker left by hard exit.
      if (fs.existsSync(lock)) {
        const stat=fs.lstatSync(lock);
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('unsafe_profile');
        fs.unlinkSync(lock);
      }
      this.lockFd = fs.openSync(lock, 'wx', 0o600);
      this.lockPath = lock;
      const marker = path.join(this.root, '.briefnest-profile-owner.json'); assertNoLinks(marker); assertNoLinks(this.profile);
      if (fs.existsSync(marker)) {
        const owner = JSON.parse(fs.readFileSync(marker, 'utf8'));
        if (owner.kind !== 'briefnest-persistent-v1' || owner.root !== this.root) throw new Error('unsafe_profile');
      } else {
        if (fs.existsSync(this.profile)) throw new Error('unsafe_profile');
        fs.writeFileSync(marker, JSON.stringify({kind:'briefnest-persistent-v1',root:this.root}), {flag:'wx',mode:0o600});
      }
      fs.mkdirSync(this.profile, { recursive:true });
    } catch(e) { await this.releaseProfile(); throw new Error('unsafe_profile'); }
  }
  async releaseProfile() {
    const mutex=this.profileMutex;
    if (!mutex) return;
    this.profileMutex=null;
    try {
      if (this.lockFd !== undefined) {
        fs.closeSync(this.lockFd); this.lockFd=undefined;
        // A lost keeper is no longer authorized to unlink another owner's marker.
        if (mutex.alive) { assertNoLinks(this.lockPath); fs.unlinkSync(this.lockPath); }
      }
    } finally { await mutex.release(); }
  }
  async assertProfileIdle() {
    const portFile=path.join(this.profile,'DevToolsActivePort'); assertNoLinks(portFile);
    let port;
    try { const first=fs.readFileSync(portFile,'utf8').split(/\r?\n/,1)[0]; if(/^\d+$/.test(first)) port=Number(first); }
    catch(e) { if(e.code!=='ENOENT') throw new Error('unsafe_profile'); }
    if(!Number.isInteger(port)||port<1||port>65535)return;
    const active=await new Promise(resolve=>{
      const socket=require('node:net').createConnection({host:'127.0.0.1',port});
      const finish=value=>{socket.destroy();resolve(value);};
      socket.setTimeout(750,()=>finish(true));
      socket.once('connect',()=>finish(true));socket.once('error',e=>finish(e.code!=='ECONNREFUSED'));
    });
    if(active)throw new Error('profile_locked');
  }
  async start() {
    if (this.child || this.stopping) throw new Error('invalid_state');
    await this.acquireProfile();
    try {
      await this.assertProfileIdle();
      const executable = findBrowser();
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => new Set([
        'PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','TMPDIR','USERPROFILE',
        'LOCALAPPDATA','APPDATA','HOME','HOMEDRIVE','HOMEPATH','LANG','LC_ALL','TZ'
      ]).has(key.toUpperCase())));
      const portFile = path.join(this.profile, 'DevToolsActivePort');
      assertNoLinks(portFile); fs.rmSync(portFile, {force:true});
      this.child = spawn(executable, ['--headless=new','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',
        `--user-data-dir=${this.profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions',
        '--disable-background-networking','--disable-sync','--disable-session-crashed-bubble','about:blank'],
        {env,stdio:'ignore',windowsHide:true});
      let spawnFailed=false; this.child.on('error',()=>{spawnFailed=true;});
      let lines;
      for(let i=0;i<240;i++) {
        if(spawnFailed || this.processExited()) throw new Error('browser_unavailable');
        try { assertNoLinks(portFile); lines=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/); if(lines.length>=2) break; } catch {}
        await delay(100);
      }
      if(!lines || !/^\d+$/.test(lines[0]) || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(lines[1])) throw new Error('browser_unavailable');
      const ws = new WebSocket(`ws://127.0.0.1:${lines[0]}${lines[1]}`);
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{ws.close();reject(new Error('browser_unavailable'));},12000);
        ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
        ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('browser_unavailable'));},{once:true});
      });
      this.cdp=new Channel(ws);
      this.cdp.on('event',event=>this.onEvent(event));
      this.cdp.on('disconnected',()=>{if(!this.stopping){this.beginView();this.status='error';this.frameWaiter?.();}});
      // Chromium's default persistent context ID is not necessarily absent or empty.
      const infos=(await this.cdp.call('Target.getTargets')).targetInfos;
      const initial=infos.find(i=>i.type==='page' && i.url==='about:blank');
      if(!initial || typeof initial.browserContextId!=='string' || !initial.browserContextId) throw new Error('browser_unavailable');
      this.context=initial.browserContextId;
      this.epoch++; this.beginView();
      // Omitting browserContextId deliberately addresses the persistent default context.
      await this.cdp.call('Browser.grantPermissions',{permissions:[]});
      await this.cdp.call('Browser.setDownloadBehavior',{behavior:'deny'});
      this.rootCandidate=initial.targetId;
      await this.cdp.call('Target.setDiscoverTargets',{discover:true});
      await this.createRoot(initial.targetId);
      for(const info of infos) if(info.type==='page' && info.browserContextId===this.context && info.targetId!==this.target)
        await this.cdp.call('Target.closeTarget',{targetId:info.targetId}).catch(()=>{});
    } catch(e) { await this.stop(); throw e; }
  }
  state(afterSeq=-1) {
    return {view:this.displayEpoch,seq:this.frames,origin:this.siteOrigin,status:this.status || 'loading',
      width:this.width,height:this.height,rememberLogin:true,
      frame:this.latestFrame && this.latestFrame.seq>afterSeq ? {...this.latestFrame} : null};
  }
  async waitForFrame(afterSeq=0, waitMs=0) {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 ||
        !Number.isInteger(waitMs) || waitMs < 0 || waitMs > 1000) throw new Error('invalid_request');
    if (waitMs && this.frameWaiter) throw new Error('busy');
    if (!waitMs || this.stopping || this.latestFrame?.seq > afterSeq) return this.state(afterSeq);
    const view = this.displayEpoch;
    return new Promise(resolve => {
      const finish = () => {
        if (this.frameWaiter !== wake) return;
        clearTimeout(timer);
        this.frameWaiter = null;
        resolve(this.state(afterSeq));
      };
      // Sample the slot, not the event payload: synchronous promotions or
      // invalidations may supersede the frame that woke us.
      let scheduled = false;
      const wake = () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (this.stopping || this.displayEpoch !== view || this.latestFrame?.seq > afterSeq) finish();
        });
      };
      const timer = setTimeout(finish, waitMs);
      this.frameWaiter = wake;
    });
  }
  async back() {
    if(!this.sid)return;
    if(this.pages.length>1) return this.returnToPreviousPage();
    const h=await this.cdp.call('Page.getNavigationHistory',{},this.sid);
    if(h.currentIndex>0) { this.beginView(); await this.cdp.call('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id},this.sid); }
  }
  async createRoot(target) {
    if (!target && (this.stopping || this.pages.length || this.pendingPopups.size || !this.autoAttachEnabled)) throw new Error('invalid_state');
    // This connection belongs only to the browser process spawned above.
    // Pause page targets before their first request; event admission below
    // never sends commands to a foreign browserContextId.
    this.rootCandidate=target;
    this.creatingRoot=!target;
    const candidates=new Map();
    this.rootAttachments=candidates;
    let timer;
    const attached=new Promise((resolve,reject)=>{
      this.rootAttached=resolve;
      timer=setTimeout(()=>reject(new Error('browser_unavailable')),12000);
    });
    // The setup command may fail before the waiter is awaited.
    void attached.catch(()=>{});
    try {
      if(!target) {
        target=(await this.cdp.call('Target.createTarget',{url:'about:blank'})).targetId;
        this.rootCandidate=target;
        if(candidates.has(target))this.rootAttached(candidates.get(target));
      }
      if(!this.autoAttachEnabled) {
        await this.cdp.call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'page'},{exclude:true}]});
        this.autoAttachEnabled=true;
      }
      const candidate=await attached;
      this.target=target;this.sid=candidate.sessionId;
      this.pages.push({target,sid:this.sid});
      await this.cdp.call('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] }, this.sid);
      if(candidate.waitingForDebugger)await this.cdp.call('Runtime.runIfWaitingForDebugger',{},this.sid);
      await this.cdp.call('Page.enable', {}, this.sid);
      await this.cdp.call('Emulation.setFocusEmulationEnabled', { enabled: true }, this.sid);
      await this.resize(this.width * this.scale / 100, this.height * this.scale / 100, this.scale);
      await this.startFrames();
    } finally {
      clearTimeout(timer);this.rootAttached=null;this.rootCandidate=null;this.creatingRoot=false;this.rootAttachments=null;
      for(const id of candidates.keys())if(id!==target)void this.cdp.call('Target.closeTarget',{targetId:id}).catch(()=>{});
    }
  }
  onEvent(m) {
    if (m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page') {
      const info=m.params.targetInfo;
      if(info.browserContextId!==this.context || info.targetId===this.rootCandidate || this.pages.some(p=>p.target===info.targetId))return;
      if(this.creatingRoot && !info.openerId)return;
      // Admission occurs only on the paused auto-attached session, never by
      // racing a manual attachment against the popup's initial request.
      if(!info.openerId)void this.cdp.call('Target.closeTarget',{targetId:info.targetId}).catch(()=>{});
    }
    if (m.method === 'Target.attachedToTarget') {
      const {targetInfo:info,sessionId,waitingForDebugger}=m.params;
      if(info.browserContextId!==this.context || info.type!=='page')return;
      if(this.creatingRoot && !info.openerId && this.rootAttachments) {
        // The createTarget response may arrive after the attached event. Keep
        // candidates paused; only the exact returned target is ever resumed.
        if(this.rootAttachments.size>=4 && !this.rootAttachments.has(info.targetId)) {
          void this.cdp.call('Target.closeTarget',{targetId:info.targetId}).catch(()=>{});return;
        }
        this.rootAttachments.set(info.targetId,{sessionId,waitingForDebugger});
        if(info.targetId===this.rootCandidate && this.rootAttached)this.rootAttached({sessionId,waitingForDebugger});
        return;
      }
      if(info.targetId===this.rootCandidate && this.rootAttached) {this.rootAttached({sessionId,waitingForDebugger});return;}
      if(this.pages.some(p=>p.target===info.targetId) || this.pendingPopups.has(info.targetId))return;
      if(waitingForDebugger && this.canFollowPopup(info)) {
        const epoch=this.epoch;this.gesture=null;
        this.pendingPopups.add(info.targetId);
        this.queueSwitch(()=>this.followPopup(info,epoch,sessionId));
      } else {
        // Never resume a denied target, even momentarily.
        void this.cdp.call('Target.closeTarget',{targetId:info.targetId}).catch(()=>{});
        this.emit('status',{kind:'limited',message:'已拦截未获近期用户操作授权的新页面'});
      }
    }
    if (m.method === 'Target.targetDestroyed') {
      const index = this.pages.findIndex(page => page.target === m.params.targetId);
      if (index >= 0) {
        const active = this.target === m.params.targetId; this.pages.splice(index, 1);
        if (active) this.clearActivePage();
        if (active && this.pages.length && !this.stopping) {
          const previous = this.pages[this.pages.length - 1], epoch = this.epoch;
          this.queueSwitch(() => this.activatePage(previous, epoch));
        }
      }
    }
    const owned = this.pages.some(page => page.sid === m.sessionId);
    if (owned && m.method === 'Fetch.requestPaused') {
      const p = m.params, allowed = validUrl(p.request.url, this.fixtureOrigin);
      void this.cdp.call(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId: p.requestId } : { requestId: p.requestId, errorReason: 'BlockedByClient' }, m.sessionId).catch(() => {});
    }
    if (owned && m.method === 'Page.screencastFrame') {
      void this.cdp.call('Page.screencastFrameAck', { sessionId: m.params.sessionId }, m.sessionId).catch(() => {});
    }
    if (m.sessionId !== this.sid) return;
    if (m.method === 'Page.frameStartedLoading' && m.params.frameId === this.mainFrame) this.beginView();
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) {
      this.beginView();
      this.mainFrame = m.params.frame.id; this.updateSite(m.params.frame.url);
      void this.seedFrame(this.displayEpoch, this.sid, m.params.frame.loaderId).catch(() => {
        this.emit('status', { kind: 'error', message: '新页面尚未完成画面确认，输入保持禁用' });
      });
    }
    if (m.method === 'Page.navigatedWithinDocument' && m.params.frameId === this.mainFrame) this.updateSite(m.params.url);
    if ((m.method === 'Page.frameStoppedLoading' || m.method === 'Page.navigatedWithinDocument') && m.params.frameId === this.mainFrame && !this.documentReady) {
      const view = this.displayEpoch, sid = this.sid;
      void this.cdp.call('Page.getFrameTree', {}, sid).then(async tree => {
        if (view !== this.displayEpoch || sid !== this.sid || !tree.frameTree) return;
        this.updateSite(tree.frameTree.frame.url);
        await this.seedFrame(view, sid, tree.frameTree.frame.loaderId);
      }).catch(() => {});
    }

    if (m.method === 'Page.screencastFrame') {
      if (this.stopping || !this.documentReady || !Number.isFinite(m.params.metadata?.timestamp) || m.params.metadata.timestamp < this.frameCutoff) return;
      this.frames++;
      this.latestFrame = { data: m.params.data, seq: this.frames, format: 'png', view: this.displayEpoch };
      this.frameWaiter?.();
      this.emit('frame', this.latestFrame);

    }
    if (m.method === 'Page.loadEventFired') this.emit('status', { kind: 'ready', message: '主页面已加载；不代表全部图片或登录已通过' });
  }
  canFollowPopup(info, now = Date.now()) {
    return !this.stopping && info.type === 'page' && info.browserContextId === this.context &&
      isOwnedPopup(info, this.target) && this.pages.length + this.pendingPopups.size < 4 && !!this.gesture &&
      this.gesture.target === this.target && now >= this.gesture.at && now - this.gesture.at <= 2000 &&
      (!info.url || info.url === 'about:blank' || validUrl(info.url, this.fixtureOrigin));
  }
  queueSwitch(action) {
    this.switchQueue = this.switchQueue.then(action).catch(() => {
      this.emit('status', { kind: 'error', message: '新页面切换未完成，不能据此判定登录已支持' });
    });
  }
  async followPopup(info, epoch, sid) {
    const parent = this.pages.find(page => page.target === this.target);
    try {
      if (this.stopping || epoch !== this.epoch || this.pages.length >= 4) throw new Error('Expired page admission');
      if(typeof sid!=='string' || !sid)throw new Error('invalid_state');
      const page = { target: info.targetId, sid };
      if (this.stopping || epoch !== this.epoch) throw new Error('Expired page admission');
      this.pages.push(page);
      // Fetch is browser-side and can be installed while a new renderer is
      // waiting. Page.enable may itself wait for that renderer to initialize.
      await this.cdp.call('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] }, sid);
      await this.cdp.call('Runtime.runIfWaitingForDebugger',{},sid);
      await this.cdp.call('Page.enable', {}, sid);
      await this.activatePage(page, epoch);
    } catch (error) {
      const selected = this.target === info.targetId;
      this.pages = this.pages.filter(page => page.target !== info.targetId);
      await this.cdp.call('Target.closeTarget', { targetId: info.targetId }).catch(() => {});
      if (selected && !this.stopping && epoch === this.epoch) {
        this.clearActivePage();
        if (parent && this.pages.includes(parent)) await this.activatePage(parent, epoch).catch(() => this.clearActivePage());
      }
      throw error;
    } finally { this.pendingPopups.delete(info.targetId); }
  }
  async activatePage(page, epoch) {
    if (this.stopping || epoch !== this.epoch || !this.pages.includes(page)) return;
    if (this.sid && this.sid !== page.sid) await this.cdp.call('Page.stopScreencast', {}, this.sid).catch(() => {});
    if (this.stopping || epoch !== this.epoch || !this.pages.includes(page)) return;
    this.sid = page.sid; this.target = page.target; this.mainFrame = null;
    this.beginView();
    await this.cdp.call('Emulation.setFocusEmulationEnabled', { enabled: true }, page.sid);
    await this.cdp.call('Emulation.setDeviceMetricsOverride', { width: this.width, height: this.height, deviceScaleFactor: 1, mobile: false }, page.sid);
    await this.cdp.call('Target.activateTarget', { targetId: page.target });
    const tree = await this.cdp.call('Page.getFrameTree', {}, page.sid);
    if (epoch !== this.epoch || page.sid !== this.sid) return;
    const frame = tree.frameTree.frame;
    if (frame.url !== 'about:blank' && !validUrl(frame.url, this.fixtureOrigin)) {
      await this.cdp.call('Target.closeTarget', { targetId: page.target }); return;
    }
    this.mainFrame = frame.id; this.updateSite(frame.url); await this.startFrames();
    await this.seedFrame(this.displayEpoch, page.sid, frame.loaderId);
  }
  async returnToPreviousPage() {
    if (this.pages.length < 2) throw new Error('No previous isolated page');
    await this.cdp.call('Target.closeTarget', { targetId: this.target });
  }
  beginView() {
    const hadFrame = this.latestFrame !== null;
    this.displayEpoch++; this.displayReady = false; this.documentReady = false;
    this.minViewSeq = this.frames + 1;
    this.frameCutoff = Date.now() / 1000; this.latestFrame = null; this.siteOrigin = ''; this.gesture = null;
    // Report invalidation of a visible frame once. Repeated loading/commit
    // transitions while empty should wait for a frame or the normal timeout.
    if (hadFrame) this.frameWaiter?.();
    this.emit('status', { kind: 'switching', view: this.displayEpoch, message: '正在确认新页面画面，输入暂时禁用' });
  }
  clearActivePage() {
    this.target = null; this.sid = null; this.mainFrame = null; this.beginView();
  }
  async seedFrame(view, sid, loaderId) {
    if (view !== this.displayEpoch || sid !== this.sid || this.stopping || this.documentReady) return;
    const before = await this.cdp.call('Page.getFrameTree', {}, sid);
    if (!before.frameTree || before.frameTree.frame.loaderId !== loaderId || view !== this.displayEpoch || sid !== this.sid) return;
    const snapshot = await this.cdp.call('Page.captureScreenshot', { format: 'png' }, sid);
    const tree = await this.cdp.call('Page.getFrameTree', {}, sid);
    if (view !== this.displayEpoch || sid !== this.sid || this.stopping || this.documentReady || !tree.frameTree || tree.frameTree.frame.loaderId !== loaderId) return;
    this.updateSite(tree.frameTree.frame.url); this.status='ready';
    this.documentReady = true; this.frames++;
    this.latestFrame = { data: snapshot.data, seq: this.frames, format: 'png', view };
    this.frameWaiter?.();
    this.emit('frame', this.latestFrame);
  }
  acknowledgePaint(view, seq) {
    if (view !== this.displayEpoch || !this.documentReady || !this.latestFrame || !Number.isInteger(seq) || seq > this.latestFrame.seq || seq < (this.minViewSeq || 1)) throw new Error('Expired rendered frame');
    this.displayReady = true;
  }
  inputSession(view) {
    if (!this.sid || !this.siteOrigin || !this.displayReady || !this.documentReady || view !== this.displayEpoch || this.stopping) throw new Error('Input belongs to an inactive view');
    return this.sid;
  }
  updateSite(url) {
    let origin = '';
    try { if (validUrl(url, this.fixtureOrigin)) origin = new URL(url).origin; } catch {}
    this.siteOrigin = origin;
    if (origin && origin !== this.fixtureOrigin) this.fixtureOnly = false;
    this.emit('status', { kind: 'site', view: this.displayEpoch, siteOrigin: origin, message: origin ? '浏览器已提交顶层导航，请核对实际站点' : '当前站点尚未确认，请勿输入凭据' });
  }
  async startFrames() {
    await this.cdp.call('Page.startScreencast', { format: 'png', everyNthFrame: 1 }, this.sid);
  }
  async pause(paused) {
    await this.cdp.call(paused ? 'Page.stopScreencast' : 'Page.startScreencast', paused ? {} : { format: 'png', everyNthFrame: 1 }, this.sid);
  }
  async navigate(url) {
    if (!validUrl(url, this.fixtureOrigin)) throw new Error('Only HTTPS and the controlled fixture are allowed');
    if (!this.sid) { await this.switchQueue; if(!this.sid)await this.createRoot(); }
    this.lastRequestedUrl=url;
    if (new URL(url).origin !== this.fixtureOrigin) this.fixtureOnly = false;
    this.beginView(); this.emit('status', { kind: 'loading' });
    const r = await this.cdp.call('Page.navigate', { url }, this.sid);
    if (r.errorText) throw new Error('Page navigation failed');
  }
  async reload() { if(!this.sid)return this.navigate(this.lastRequestedUrl); this.beginView(); await this.cdp.call('Page.reload', {}, this.sid); }
  async resize(w, h, scale = this.scale) {
    const g = geometry(w, h, scale);
    this.beginView(); this.width = g.width; this.height = g.height; this.scale = scale;
    if (this.sid) await this.cdp.call('Emulation.setDeviceMetricsOverride', {
      width: g.width, height: g.height, deviceScaleFactor: 1, mobile: false
    }, this.sid);
    if(this.sid) { const tree=await this.cdp.call('Page.getFrameTree',{},this.sid); if(tree.frameTree) await this.seedFrame(this.displayEpoch,this.sid,tree.frameTree.frame.loaderId); }
  }
  async mouse(event) {
    const sid = this.inputSession(event.view);
    const p = point(event, this.width, this.height);
    if (!['mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel'].includes(event.type)) throw new Error('Invalid pointer event');
    const params = { type: event.type, ...p, button: event.type === 'mouseWheel' ? 'none' : (event.button || 'left'), modifiers: Number(event.modifiers) & 15 };
    if (Number.isInteger(event.buttons)) params.buttons = event.buttons & 31;
    if (!['none', 'left', 'right', 'middle'].includes(params.button)) throw new Error('Invalid pointer button');
    if (event.type === 'mousePressed' && params.button === 'left') this.gesture = { target: this.target, at: Date.now() };
    if (event.type === 'mouseWheel') {
      if (![event.deltaX, event.deltaY].every(Number.isFinite)) throw new Error('Invalid wheel');
      params.deltaX = Math.max(-1200, Math.min(1200, event.deltaX)); params.deltaY = Math.max(-1200, Math.min(1200, event.deltaY));
    } else params.clickCount = event.type === 'mouseMoved' ? 0 : Math.max(1, Math.min(2, event.clickCount || 1));
    await this.cdp.call('Input.dispatchMouseEvent', params, sid);
  }
  async text(text, view) { const sid = this.inputSession(view); await this.cdp.call('Input.insertText', { text: boundedText(text) }, sid); }
  async key(event) {
    const sid = this.inputSession(event.view);
    if (!['keyDown', 'keyUp'].includes(event.type) || typeof event.key !== 'string' || event.key.length > 40) throw new Error('Invalid key');
    if (event.type === 'keyDown' && event.key === 'Enter') this.gesture = { target: this.target, at: Date.now() };
    await this.cdp.call('Input.dispatchKeyEvent', { type: event.type, key: event.key, code: String(event.code || '').slice(0, 40),
      windowsVirtualKeyCode: Number(event.windowsVirtualKeyCode) & 255, modifiers: Number(event.modifiers) & 15 }, sid);
  }
  processExited() {
    return !this.child || Number.isInteger(this.child.exitCode) || !!this.child.signalCode || !this.child.pid;
  }
  async waitForExit(timeout) {
    if (this.processExited()) return true;
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); this.child.removeListener('exit', finish); resolve(this.processExited()); };
      const timer = setTimeout(finish, timeout); this.child.once('exit', finish);
      if (this.processExited()) finish();
    });
  }
  async stop() {
    if (this.stopPending) return this.stopPending;
    this.stopPending = this.stopOwned();
    try { return await this.stopPending; } finally { this.stopPending = null; }
  }
  async stopOwned() {
    this.stopping = true;
    this.latestFrame = null;
    this.frameWaiter?.();
    if (this.cdp && !this.processExited()) {
      await this.cdp.call('Browser.close').catch(() => {});
      try { this.cdp.ws.close(); } catch {}
    }
    if (!this.processExited()) {
      await this.waitForExit(4000);
      if (!this.processExited()) { try { this.child.kill(); } catch {} await this.waitForExit(4000); }
    }
    const browserExited = this.processExited();
    if (browserExited && !this.clearing) await this.releaseProfile();
    return { phase: browserExited ? 'closed' : 'cleanup_failed', browserExited, sessionCleared:false };
  }
  async clear() {
    // Take the exclusive lock even if clear is the first operation.
    await this.acquireProfile();
    // Keep the exclusion lock through shutdown and deletion.
    this.clearing=true;
    try {
      const result=await this.stop();
      if(!result.browserExited) throw new Error('cleanup_failed');
      await this.assertProfileIdle();
      assertNoLinks(this.root); assertNoLinks(this.profile); assertTreeNoLinks(this.profile);
      fs.rmSync(this.profile,{recursive:true,force:true});
      return {cleared:true};
    } finally { this.clearing=false; if(this.processExited()) await this.releaseProfile(); }

  }
}
module.exports = { Browser, delay };
