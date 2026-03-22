/**
 * BrowserOS v2 — Window Manager
 * src/wm/wm.js
 *
 * Creates and manages all OS windows.
 * Each window wraps a sandboxed iframe for app isolation.
 * Handles: create, focus, minimize, maximize, close, drag, resize.
 * Also handles OS-level UI: notify toasts, system app launching.
 */

// ─── CSS injected once into the host document ─────────────────────────────────

const WM_STYLES = `
  :root {
    --wm-accent:       #0078d4;
    --wm-bg:           #1e1e2e;
    --wm-border:       #3a3a5c;
    --wm-titlebar:     #2a2a4a;
    --wm-titlebar-txt: #e0e0ff;
    --wm-text:         #e0e0ff;
    --wm-text-dim:     #8888aa;
    --wm-hover:        #2d2d4e;
    --wm-shadow:       0 8px 32px rgba(0,0,0,0.5);
    --wm-radius:       8px;
    --wm-taskbar-h:    48px;
    --wm-font:         'Segoe UI', system-ui, sans-serif;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--wm-font);
    color: var(--wm-text);
    overflow: hidden;
    width: 100vw;
    height: 100vh;
    background: var(--wm-wallpaper, linear-gradient(135deg,#0f0c29,#302b63,#24243e));
  }

  #wm-desktop {
    position: absolute;
    inset: 0 0 var(--wm-taskbar-h) 0;
    overflow: hidden;
  }

  /* ── Windows ── */
  .wm-window {
    position: absolute;
    display: flex;
    flex-direction: column;
    background: var(--wm-bg);
    border: 1px solid var(--wm-border);
    border-radius: var(--wm-radius);
    box-shadow: var(--wm-shadow);
    min-width: 320px;
    min-height: 240px;
    overflow: hidden;
    transition: box-shadow 0.15s;
  }
  .wm-window.focused {
    box-shadow: var(--wm-shadow), 0 0 0 1px var(--wm-accent);
  }
  .wm-window.minimized { display: none; }
  .wm-window.maximized {
    top: 0 !important; left: 0 !important;
    width: 100% !important;
    height: calc(100vh - var(--wm-taskbar-h)) !important;
    border-radius: 0;
  }

  .wm-titlebar {
    height: 38px;
    background: var(--wm-titlebar);
    display: flex;
    align-items: center;
    padding: 0 10px;
    gap: 8px;
    cursor: move;
    flex-shrink: 0;
    border-bottom: 1px solid var(--wm-border);
    user-select: none;
  }
  .wm-titlebar-icon  { font-size: 16px; flex-shrink: 0; }
  .wm-titlebar-title {
    flex: 1;
    font-size: 13px;
    color: var(--wm-titlebar-txt);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .wm-titlebar-btns  { display: flex; gap: 4px; }

  .wm-btn {
    width: 26px; height: 26px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 13px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,0.08);
    color: var(--wm-text);
    transition: background 0.12s;
  }
  .wm-btn:hover         { background: rgba(255,255,255,0.18); }
  .wm-btn.wm-btn-close:hover { background: #c42b1c; color: #fff; }

  .wm-iframe {
    flex: 1;
    border: none;
    background: var(--wm-bg);
    display: block;
  }

  .wm-resize {
    position: absolute;
    right: 0; bottom: 0;
    width: 18px; height: 18px;
    cursor: se-resize;
  }

  /* Progress bar on titlebar bottom edge */
  .wm-progress {
    position: absolute;
    bottom: 0; left: 0;
    height: 2px;
    background: var(--wm-accent);
    transition: width 0.2s;
    pointer-events: none;
  }

  /* ── Taskbar ── */
  #wm-taskbar {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: var(--wm-taskbar-h);
    background: rgba(15,12,40,0.92);
    backdrop-filter: blur(20px);
    border-top: 1px solid rgba(255,255,255,0.08);
    display: flex;
    align-items: center;
    padding: 0 8px;
    gap: 4px;
    z-index: 9000;
  }

  #wm-start-btn {
    width: 38px; height: 38px;
    background: var(--wm-accent);
    border: none; border-radius: 8px;
    cursor: pointer; font-size: 20px;
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  #wm-start-btn:hover { filter: brightness(1.15); }

  #wm-taskbar-apps { display: flex; gap: 4px; flex: 1; overflow: hidden; }

  .wm-taskbar-btn {
    height: 36px;
    padding: 0 10px;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    color: var(--wm-text);
    cursor: pointer;
    font-size: 12px;
    display: flex; align-items: center; gap: 6px;
    white-space: nowrap;
    max-width: 160px;
    overflow: hidden;
    transition: background 0.12s;
    flex-shrink: 0;
  }
  .wm-taskbar-btn.active  { background: rgba(0,120,212,0.35); border-color: var(--wm-accent); }
  .wm-taskbar-btn:hover   { background: rgba(255,255,255,0.14); }
  .wm-taskbar-btn .wm-running-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--wm-accent); flex-shrink: 0;
  }

  #wm-clock {
    font-size: 12px; color: var(--wm-text);
    text-align: right; padding: 0 8px;
    white-space: nowrap; flex-shrink: 0;
    line-height: 1.4;
  }

  /* ── Toast notifications ── */
  #wm-toasts {
    position: fixed;
    bottom: calc(var(--wm-taskbar-h) + 12px);
    right: 16px;
    display: flex; flex-direction: column; gap: 8px;
    z-index: 99998;
    pointer-events: none;
  }
  .wm-toast {
    background: rgba(20,20,40,0.97);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 13px;
    color: #e0e0ff;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    animation: wm-toast-in 0.2s ease;
    pointer-events: auto;
    max-width: 300px;
  }
  @keyframes wm-toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .wm-toast.out {
    animation: wm-toast-out 0.3s ease forwards;
  }
  @keyframes wm-toast-out {
    to { opacity: 0; transform: translateY(8px); }
  }

  /* ── Crash overlay ── */
  .wm-crash {
    position: absolute; inset: 0;
    background: rgba(10,5,20,0.95);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 10px; padding: 24px; text-align: center;
    color: #ff8888; font-size: 13px;
  }
  .wm-crash-icon { font-size: 36px; }
  .wm-crash pre  {
    background: rgba(255,255,255,0.05);
    border-radius: 6px; padding: 10px;
    font-size: 11px; color: #ffaaaa;
    white-space: pre-wrap; max-width: 100%;
    text-align: left;
  }
`;

// ─── Window Manager ────────────────────────────────────────────────────────────

export class WindowManager {
  /**
   * @param {object} opts
   * @param {Kernel}   opts.kernel   - Kernel instance (set after kernel boot)
   * @param {object}   opts.settings - Settings store
   * @param {Function} opts.onStart  - Called when start button is clicked
   */
  constructor({ kernel, settings, onStart } = {}) {
    this._kernel   = kernel;
    this._settings = settings;
    this._onStart  = onStart || (() => {});
    this._windows  = new Map();   // instanceId → { el, iframe, opts, state }
    this._zIndex   = 100;
    this._activeId = null;
    this._systemApps = new Map(); // appId → mount function (for native apps)
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────

  boot() {
    this._injectStyles();
    this._buildDOM();
    this._startClock();
    console.log('[wm] Booted');
  }

  _injectStyles() {
    const style = document.createElement('style');
    style.textContent = WM_STYLES;
    document.head.appendChild(style);
  }

  _buildDOM() {
    document.body.innerHTML = `
      <div id="wm-desktop"></div>
      <div id="wm-toasts"></div>
      <div id="wm-taskbar">
        <button id="wm-start-btn" title="Start">⊞</button>
        <div id="wm-taskbar-apps"></div>
        <div id="wm-clock"></div>
      </div>
    `;
    document.getElementById('wm-start-btn').onclick = () => this._onStart();
  }

  _startClock() {
    const tick = () => {
      const now  = new Date();
      const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const date = now.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const el   = document.getElementById('wm-clock');
      if (el) el.innerHTML = `${time}<br><span style="font-size:10px">${date}</span>`;
    };
    tick();
    setInterval(tick, 1000);
  }

  // ─── System app registry ───────────────────────────────────────────────────

  /**
   * Register a native system app (non-.beep).
   * mount(container, instanceId) is called to render the app.
   */
  registerSystemApp(appId, { title, icon, width, height, mount }) {
    this._systemApps.set(appId, { title, icon, width, height, mount });
  }

  openSystemApp(appId) {
    const app = this._systemApps.get(appId);
    if (!app) { console.warn(`[wm] Unknown system app: ${appId}`); return; }
    const instanceId = this._createWindow({
      instanceId: `sys_${appId}_${Date.now()}`,
      title:  app.title,
      icon:   app.icon,
      width:  app.width  || 700,
      height: app.height || 500,
      isSystem: true,
    });
    // Mount native app into the window body (no iframe)
    const body = document.getElementById(`wm-body-${instanceId}`);
    if (body && app.mount) app.mount(body, instanceId);
    return instanceId;
  }

  // ─── .beep window creation ─────────────────────────────────────────────────

  /**
   * Create a window for a sandboxed .beep app.
   * Called by the launcher after unzipping and validating the manifest.
   *
   * @param {object} opts
   * @param {string}   opts.instanceId
   * @param {string}   opts.title
   * @param {string}   opts.icon
   * @param {number}   opts.width
   * @param {number}   opts.height
   * @param {string}   opts.srcdoc     - Full iframe HTML (BOS client + app code)
   * @param {Function} opts.onClose    - Called when window is closed
   * @returns {HTMLIFrameElement}
   */
  createAppWindow({ instanceId, title, icon, width, height, srcdoc, onClose }) {
    this._createWindow({ instanceId, title, icon, width, height, onClose });
    const body = document.getElementById(`wm-body-${instanceId}`);

    // Create sandboxed iframe
    const iframe = document.createElement('iframe');
    iframe.className  = 'wm-iframe';
    iframe.sandbox    = 'allow-scripts';
    iframe.srcdoc     = srcdoc;
    body.appendChild(iframe);

    // Store reference
    const w = this._windows.get(instanceId);
    if (w) w.iframe = iframe;

    return iframe;
  }

  // ─── Core window factory ───────────────────────────────────────────────────

  _createWindow({ instanceId, title, icon, width, height, onClose, isSystem }) {
    const offset = this._windows.size * 24;
    const x = 80 + offset;
    const y = 60 + offset;

    const el = document.createElement('div');
    el.className  = 'wm-window';
    el.id         = `wm-win-${instanceId}`;
    el.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${++this._zIndex}`;

    el.innerHTML = `
      <div class="wm-titlebar" id="wm-tb-${instanceId}">
        <span class="wm-titlebar-icon">${icon || '🪟'}</span>
        <span class="wm-titlebar-title" id="wm-title-${instanceId}">${title || 'App'}</span>
        <div class="wm-titlebar-btns">
          <button class="wm-btn wm-btn-min"   title="Minimize">─</button>
          <button class="wm-btn wm-btn-max"   title="Maximize">□</button>
          <button class="wm-btn wm-btn-close" title="Close">✕</button>
        </div>
      </div>
      <div class="wm-body" id="wm-body-${instanceId}" style="flex:1;overflow:hidden;display:flex;flex-direction:column;position:relative;"></div>
      <div class="wm-resize"></div>
    `;

    document.getElementById('wm-desktop').appendChild(el);

    // State
    const state = { minimized: false, maximized: false, prevRect: null };
    this._windows.set(instanceId, { el, iframe: null, state, onClose });

    // Wire up controls
    el.querySelector('.wm-btn-min').onclick   = e => { e.stopPropagation(); this.minimize(instanceId); };
    el.querySelector('.wm-btn-max').onclick   = e => { e.stopPropagation(); this.maximize(instanceId); };
    el.querySelector('.wm-btn-close').onclick = e => { e.stopPropagation(); this.close(instanceId); };
    el.querySelector('.wm-titlebar').ondblclick = () => this.maximize(instanceId);

    el.addEventListener('mousedown', () => this.focus(instanceId));

    this._makeDraggable(el, el.querySelector('.wm-titlebar'), instanceId);
    this._makeResizable(el, el.querySelector('.wm-resize'), instanceId);

    this.focus(instanceId);
    this._addTaskbarBtn(instanceId, title, icon);

    return instanceId;
  }

  // ─── Window controls ───────────────────────────────────────────────────────

  focus(instanceId) {
    const w = this._windows.get(instanceId);
    if (!w) return;
    this._activeId = instanceId;
    w.el.style.zIndex = ++this._zIndex;

    // Update focused class
    this._windows.forEach((win, id) => {
      win.el.classList.toggle('focused', id === instanceId);
    });

    // Update taskbar
    document.querySelectorAll('.wm-taskbar-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.instanceId === instanceId);
    });
  }

  minimize(instanceId) {
    const w = this._windows.get(instanceId);
    if (!w) return;
    w.state.minimized = !w.state.minimized;
    w.el.classList.toggle('minimized', w.state.minimized);
    const btn = document.querySelector(`.wm-taskbar-btn[data-instance-id="${instanceId}"]`);
    if (btn) btn.classList.toggle('active', !w.state.minimized);
  }

  maximize(instanceId) {
    const w = this._windows.get(instanceId);
    if (!w) return;
    if (!w.state.maximized) {
      w.state.prevRect = {
        left: w.el.style.left, top: w.el.style.top,
        width: w.el.style.width, height: w.el.style.height,
      };
      w.state.maximized = true;
      w.el.classList.add('maximized');
    } else {
      w.state.maximized = false;
      w.el.classList.remove('maximized');
      const r = w.state.prevRect;
      if (r) {
        w.el.style.left   = r.left;
        w.el.style.top    = r.top;
        w.el.style.width  = r.width;
        w.el.style.height = r.height;
      }
    }
  }

  close(instanceId) {
    const w = this._windows.get(instanceId);
    if (!w) return;
    w.el.remove();
    this._windows.delete(instanceId);
    // Remove taskbar button
    const btn = document.querySelector(`.wm-taskbar-btn[data-instance-id="${instanceId}"]`);
    if (btn) btn.remove();
    // Notify kernel
    if (this._kernel) this._kernel.unregisterApp(instanceId);
    // Call onClose callback
    if (w.onClose) w.onClose(instanceId);
  }

  // ─── UI methods called by kernel handlers ──────────────────────────────────

  setWindowTitle(instanceId, title) {
    const el = document.getElementById(`wm-title-${instanceId}`);
    if (el) el.textContent = title;
    const btn = document.querySelector(`.wm-taskbar-btn[data-instance-id="${instanceId}"] .wm-tb-label`);
    if (btn) btn.textContent = title;
  }

  setWindowIcon(instanceId, icon) {
    const tb = document.getElementById(`wm-tb-${instanceId}`);
    if (tb) tb.querySelector('.wm-titlebar-icon').textContent = icon;
  }

  setWindowProgress(instanceId, value) {
    const w = this._windows.get(instanceId);
    if (!w) return;
    let bar = w.el.querySelector('.wm-progress');
    if (value < 0) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'wm-progress';
      w.el.querySelector('.wm-titlebar').appendChild(bar);
    }
    bar.style.width = Math.min(100, Math.max(0, value)) + '%';
  }

  notify(message) {
    const container = document.getElementById('wm-toasts');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className   = 'wm-toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  showCrash(instanceId, error) {
    const body = document.getElementById(`wm-body-${instanceId}`);
    if (!body) return;
    const overlay = document.createElement('div');
    overlay.className = 'wm-crash';
    overlay.innerHTML = `
      <div class="wm-crash-icon">💥</div>
      <div><b>App crashed</b></div>
      <pre>${error.message || error}</pre>
    `;
    body.appendChild(overlay);
  }

  onAppUninstalled(appId) {
    // Notify desktop/shell to update app list
    document.dispatchEvent(new CustomEvent('bos:appUninstalled', { detail: { appId } }));
  }

  startDrag(instanceId, path, name, icon) {
    this.endDrag();
    const ghost = document.createElement('div');
    ghost.id = 'bos-drag-ghost';
    ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;display:flex;flex-direction:column;align-items:center;gap:4px;opacity:0.85;transform:translate(-50%,-50%);transition:left 0.05s,top 0.05s';
    ghost.innerHTML = '<span style="font-size:28px">' + (icon || '📄') + '</span>' +
      '<span style="font-size:11px;color:#fff;text-shadow:0 1px 3px #000;background:rgba(0,0,0,0.5);padding:2px 6px;border-radius:4px">' + (name || '') + '</span>';
    document.body.appendChild(ghost);
    this._dragState = { path, name, instanceId };
    // Start at center of the window
    ghost.style.left = '50%';
    ghost.style.top  = '50%';
  }

  moveDragGhost(x, y) {
    const ghost = document.getElementById('bos-drag-ghost');
    if (!ghost || !this._dragState) return;

    // Find the iframe element for this app instance and offset coordinates
    const w = this._windows.get(this._dragState.instanceId);
    let pageX = x, pageY = y;
    if (w && w.iframe) {
      const rect = w.iframe.getBoundingClientRect();
      pageX = x + rect.left;
      pageY = y + rect.top;
    }

    ghost.style.left = pageX + 'px';
    ghost.style.top  = pageY + 'px';
    const el = document.elementFromPoint(pageX, pageY);
    const overWindow = el?.closest('.wm-window');
    const desktop = document.getElementById('wm-desktop');
    if (desktop) desktop.style.outline = overWindow ? '' : '2px dashed var(--wm-accent)';
    this._dragState.lastX = pageX;
    this._dragState.lastY = pageY;
    this._dragState.overDesktop = !overWindow;
  }

  endDrag(fireEvent) {
    const desktop = document.getElementById('wm-desktop');
    if (desktop) desktop.style.outline = '';
    if (fireEvent && this._dragState?.overDesktop && this._dragState?.path) {
      document.dispatchEvent(new CustomEvent('bos:dropOnDesktop', {
        detail: {
          path: this._dragState.path,
          name: this._dragState.name,
          x: this._dragState.lastX || 200,
          y: this._dragState.lastY || 200,
        }
      }));
    }
    document.getElementById('bos-drag-ghost')?.remove();
    this._dragState = null;
  }

  // ─── Taskbar ───────────────────────────────────────────────────────────────

  _addTaskbarBtn(instanceId, title, icon) {
    const btn = document.createElement('button');
    btn.className = 'wm-taskbar-btn active';
    btn.dataset.instanceId = instanceId;
    btn.innerHTML = `
      <span>${icon || '🪟'}</span>
      <span class="wm-tb-label">${title || 'App'}</span>
      <span class="wm-running-dot"></span>
    `;
    btn.onclick = () => {
      const w = this._windows.get(instanceId);
      if (!w) return;
      if (w.state.minimized)        { this.minimize(instanceId); this.focus(instanceId); }
      else if (this._activeId === instanceId) { this.minimize(instanceId); }
      else                           { this.focus(instanceId); }
    };
    document.getElementById('wm-taskbar-apps').appendChild(btn);
  }

  // ─── Drag & resize ─────────────────────────────────────────────────────────

  _makeDraggable(win, handle, instanceId) {
    handle.addEventListener('mousedown', e => {
      if (e.target.closest('.wm-titlebar-btns')) return;
      const w = this._windows.get(instanceId);
      if (w?.state.maximized) return;
      const sx = e.clientX, sy = e.clientY;
      const sl = parseInt(win.style.left) || 0;
      const st = parseInt(win.style.top)  || 0;
      const onMove = e2 => {
        win.style.left = Math.max(0, sl + e2.clientX - sx) + 'px';
        win.style.top  = Math.max(0, st + e2.clientY - sy) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
      e.preventDefault();
    });
  }

  _makeResizable(win, handle) {
    handle.addEventListener('mousedown', e => {
      const sx = e.clientX, sy = e.clientY;
      const sw = win.offsetWidth, sh = win.offsetHeight;
      const onMove = e2 => {
        win.style.width  = Math.max(320, sw + e2.clientX - sx) + 'px';
        win.style.height = Math.max(240, sh + e2.clientY - sy) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
      e.preventDefault();
      e.stopPropagation();
    });
  }

  // ─── Theme ─────────────────────────────────────────────────────────────────

  applyTheme({ accent, font, darkMode, wallpaper }) {
    const r = document.documentElement;
    if (accent)    r.style.setProperty('--wm-accent', accent);
    if (font)      r.style.setProperty('--wm-font',   font);
    if (wallpaper) r.style.setProperty('--wm-wallpaper', wallpaper);
    if (darkMode !== undefined) {
      r.style.setProperty('--wm-bg',           darkMode ? '#1e1e2e' : '#f0f0f5');
      r.style.setProperty('--wm-titlebar',      darkMode ? '#2a2a4a' : '#e0e0f0');
      r.style.setProperty('--wm-text',          darkMode ? '#e0e0ff' : '#111');
      r.style.setProperty('--wm-text-dim',      darkMode ? '#8888aa' : '#666');
      r.style.setProperty('--wm-border',        darkMode ? '#3a3a5c' : '#ccc');
      r.style.setProperty('--wm-hover',         darkMode ? '#2d2d4e' : '#ddd');
    }
  }

  // ─── Kernel reference (set after kernel boots) ─────────────────────────────

  setKernel(kernel) {
    this._kernel = kernel;
  }
}
