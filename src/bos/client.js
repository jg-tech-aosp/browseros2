/**
 * BrowserOS v2 — BOS Client Library
 * src/bos/client.js
 *
 * This code runs INSIDE every app iframe, not in the OS.
 * It wraps postMessage into the clean async BOS API defined in SPEC.md §5.
 *
 * Injected by the launcher as a <script> before the app's own entry point.
 * The app never calls postMessage directly — always through BOS.*.
 *
 * NOTE: This file is serialized to a string and injected via srcdoc.
 * Do NOT import anything from outside this file — it runs in isolation.
 */

(function () {
  'use strict';

  // ─── Request/response plumbing ─────────────────────────────────────────────

  let _reqId = 0;
  const _pending = new Map(); // reqId → { resolve, reject }

  // Boot data injected by the kernel via 'bos.boot' message
  let _bootData = null;
  const _bootReady = new Promise(resolve => {
    window.addEventListener('message', function onBoot(e) {
      if (e.source !== window.parent) return;
      if (e.data?.type !== 'bos.boot') return;
      _bootData = e.data.payload;
      window.removeEventListener('message', onBoot);
      resolve();
    });
  });

  // Main message listener — routes responses to pending promises
  // and OS events to BOS.on handlers
  window.addEventListener('message', e => {
    if (e.source !== window.parent) return;
    const msg = e.data;
    if (!msg) return;

    // Response to a request
    if (typeof msg.reqId === 'number') {
      const pending = _pending.get(msg.reqId);
      if (!pending) return;
      _pending.delete(msg.reqId);
      if (msg.ok) pending.resolve(msg.result);
      else        pending.reject(new Error(msg.error || 'BOS error'));
      return;
    }

    // OS event (no reqId, type starts with 'event.')
    if (typeof msg.type === 'string' && msg.type.startsWith('event.')) {
      const eventName = msg.type.slice('event.'.length);
      const handlers  = _eventHandlers.get(eventName) || [];
      handlers.forEach(fn => fn(msg.payload));
    }
  });

  /**
   * Send a message to the OS kernel and return a Promise for the response.
   */
  function send(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const reqId = _reqId++;
      _pending.set(reqId, { resolve, reject });
      window.parent.postMessage({ reqId, type, payload }, '*');
    });
  }

  // ─── Event system ──────────────────────────────────────────────────────────

  const _eventHandlers = new Map(); // eventName → [fn, ...]

  // ─── BOS API ───────────────────────────────────────────────────────────────

  const BOS = {

    // ── BOS.fs ───────────────────────────────────────────────────────────────

    fs: {
      read:   (path)              => send('fs.read',   { path }),
      stat:   (path)              => send('fs.stat',   { path }),
      ls:     (path)              => send('fs.ls',     { path }),
      write:  (path, content)     => send('fs.write',  { path, content }),
      mkdir:  (path)              => send('fs.mkdir',  { path }),
      rm:     (path)              => send('fs.rm',     { path }),
      rename: (path, newName)     => send('fs.rename', { path, newName }),
      move:   (src,  dest)        => send('fs.move',   { src, dest }),
    },

    // ── BOS.ui ───────────────────────────────────────────────────────────────

    ui: {
      // Passive
      notify:      (message)          => send('ui.notify',      { message }),
      setTitle:    (title)            => send('ui.setTitle',    { title }),
      setIcon:     (icon)             => send('ui.setIcon',     { icon }),
      setProgress: (value)            => send('ui.setProgress', { value }),

      // Interactive
      alert:   (message)              => send('ui.alert',   { message }),
      confirm: (message)              => send('ui.confirm', { message }),
      prompt:  (message, def = '')    => send('ui.prompt',  { message, default: def }),
    },

    // ── BOS.app ──────────────────────────────────────────────────────────────

    app: {
      open:      (appId) => send('app.open',      { appId }),
      launch:    (path)  => send('app.launch',    { path }),
      install:   (path)  => send('app.install',   { path }),
      uninstall: (id)    => send('app.uninstall', { id }),
      self:      ()      => send('app.self',      {}),
    },

    // ── BOS.net ──────────────────────────────────────────────────────────────

    net: {
      fetch: (url, options = {}) => send('net.fetch', { url, options }),
    },

    // ── BOS.os ───────────────────────────────────────────────────────────────
    // Synchronous — data is available from boot payload, no postMessage needed.

    os: {
      version: () => _bootData?.version  ?? '2.0.0',
      theme:   () => _bootData?.theme    ?? {},
      env:     () => _bootData?.env      ?? {},
    },

    // ── BOS.on ───────────────────────────────────────────────────────────────

    /**
     * Listen for OS events declared in the app manifest.
     * @param {string}   event    - 'themeChanged' | 'focus' | 'blur'
     * @param {Function} callback - Called with event payload
     */
    on(event, callback) {
      if (!_eventHandlers.has(event)) _eventHandlers.set(event, []);
      _eventHandlers.get(event).push(callback);
    },

    /**
     * Remove an event listener.
     * @param {string}   event
     * @param {Function} callback - Must be the same reference passed to BOS.on
     */
    off(event, callback) {
      const handlers = _eventHandlers.get(event) || [];
      _eventHandlers.set(event, handlers.filter(fn => fn !== callback));
    },

    /**
     * Wait for the OS boot payload to arrive before accessing BOS.os.*.
     * Call this at the top of your app if you need theme/env on first render.
     *
     * Usage:
     *   await BOS.ready();
     *   const theme = BOS.os.theme();
     */
    ready: () => _bootReady,
  };

  // ─── Expose globally ───────────────────────────────────────────────────────

  window.BOS = BOS;

  // ─── Unhandled error reporting ─────────────────────────────────────────────
  // Forward uncaught errors to the OS so it can show a crash UI.

  window.addEventListener('error', e => {
    window.parent.postMessage({
      type: 'bos.error',
      payload: {
        message: e.message,
        filename: e.filename,
        line: e.lineno,
        col: e.colno,
      }
    }, '*');
  });

  window.addEventListener('unhandledrejection', e => {
    window.parent.postMessage({
      type: 'bos.error',
      payload: {
        message: e.reason?.message || String(e.reason),
      }
    }, '*');
  });

})();
