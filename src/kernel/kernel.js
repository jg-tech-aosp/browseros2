/**
 * BrowserOS v2 — Kernel
 * src/kernel/kernel.js
 *
 * The postMessage router. Every message from every app iframe passes through here.
 * Responsibilities:
 *   - Identify which app sent a message (via registry.findByWindow)
 *   - Check permissions (via checkPermission)
 *   - Route to the correct handler
 *   - Send back a response
 *   - Broadcast OS events to subscribed apps
 *
 * Never imported by app code — apps talk to BOS client (src/bos/client.js).
 */

import { checkPermission, hasEvent } from './permissions.js';
import { Registry }                  from './registry.js';

export class Kernel {
  /**
   * @param {object} opts
   * @param {import('../fs/fs.js').FileSystem} opts.fs
   * @param {import('../fs/db.js').DB}         opts.db
   * @param {object}                           opts.wm       - Window manager instance
   * @param {object}                           opts.settings - Settings store reference
   * @param {object}                           opts.launcher - .beep launcher instance
   */
  constructor({ fs, db, wm, settings, launcher }) {
    this._fs       = fs;
    this._db       = db;
    this._wm       = wm;
    this._settings = settings;
    this._launcher = launcher;
    this.registry  = new Registry();
    this._bound    = this._onMessage.bind(this);
  }

  /** Start listening for messages */
  boot() {
    window.addEventListener('message', this._bound);
    console.log('[kernel] Booted — listening for app messages');
  }

  /** Stop listening (used in tests / teardown) */
  shutdown() {
    window.removeEventListener('message', this._bound);
  }

  // ─── Message entry point ───────────────────────────────────────────────────

  async _onMessage(e) {
    // Ignore messages not from iframes we know about
    const inst = this.registry.findByWindow(e.source);
    if (!inst) return;

    const { reqId, type, payload = {} } = e.data;

    // Validate message shape
    if (typeof reqId !== 'number' || typeof type !== 'string') {
      this._error(e.source, reqId, 'Malformed message');
      return;
    }

    // Check permissions
    const { allowed, error } = checkPermission(inst.permissions, type, payload);
    if (!allowed) {
      this._error(e.source, reqId, error || 'Permission denied');
      return;
    }

    // Route to handler
    try {
      const result = await this._route(type, payload, inst);
      this._respond(e.source, reqId, result);
    } catch (err) {
      console.error(`[kernel] Handler error for ${type}:`, err);
      this._error(e.source, reqId, err.message || 'Internal error');
    }
  }

  // ─── Response helpers ──────────────────────────────────────────────────────

  _respond(source, reqId, result) {
    source.postMessage({ reqId, ok: true, result }, '*');
  }

  _error(source, reqId, error) {
    source.postMessage({ reqId, ok: false, error }, '*');
  }

  // ─── Router ────────────────────────────────────────────────────────────────

  async _route(type, payload, inst) {
    switch (type) {

      // ── Filesystem ──────────────────────────────────────────────────────────

      case 'fs.read': {
        const content = await this._fs.read(payload.path);
        return content;
      }

      case 'fs.stat': {
        const stat = await this._fs.stat(payload.path);
        return stat;
      }

      case 'fs.ls': {
        const items = await this._fs.ls(payload.path);
        return items;
      }

      case 'fs.write': {
        const res = await this._fs.write(payload.path, payload.content);
        if (!res.ok) throw new Error(res.error);
        return null;
      }

      case 'fs.mkdir': {
        const res = await this._fs.mkdir(payload.path);
        if (!res.ok) throw new Error(res.error);
        return null;
      }

      case 'fs.rm': {
        const res = await this._fs.rm(payload.path);
        if (!res.ok) throw new Error(res.error);
        return null;
      }

      case 'fs.rename': {
        const res = await this._fs.rename(payload.path, payload.newName);
        if (!res.ok) throw new Error(res.error);
        return null;
      }

      case 'fs.move': {
        const res = await this._fs.move(payload.src, payload.dest);
        if (!res.ok) throw new Error(res.error);
        return null;
      }

      // ── UI — passive ────────────────────────────────────────────────────────

      case 'ui.notify': {
        this._wm.notify(payload.message);
        return null;
      }

      case 'ui.setTitle': {
        this._wm.setWindowTitle(inst.instanceId, payload.title);
        return null;
      }

      case 'ui.setIcon': {
        this._wm.setWindowIcon(inst.instanceId, payload.icon);
        return null;
      }

      case 'ui.setProgress': {
        this._wm.setWindowProgress(inst.instanceId, payload.value);
        return null;
      }

      case 'ui.startDrag': {
        // App is dragging a file — OS creates a drag overlay on the parent page
        this._wm.startDrag(inst.instanceId, payload.path, payload.name, payload.icon);
        return null;
      }

      case 'ui.endDrag': {
        this._wm.endDrag();
        return null;
      }

      // ── UI — interactive ────────────────────────────────────────────────────
      // These block until the user responds.
      // We use native browser dialogs for now — v2.x can do custom modal UI.

      case 'ui.alert': {
        alert(payload.message);
        return null;
      }

      case 'ui.confirm': {
        return confirm(payload.message);
      }

      case 'ui.prompt': {
        return prompt(payload.message, payload.default ?? '');
      }

      // ── App management ──────────────────────────────────────────────────────

      case 'app.open': {
        const systemApp = this._wm._systemApps.get(payload.appId);
        if (systemApp) {
          this._wm.openSystemApp(payload.appId);
        } else {
          // Try launching as a .beep app by ID
          await this._launcher.launchById(payload.appId);
        }
        return null;
      }

      case 'app.launch': {
        const beep = await this._fs.read(payload.path);
        if (!beep) throw new Error(`File not found: ${payload.path}`);
        await this._launcher.launch(payload.path, beep);
        return null;
      }

      case 'app.install': {
        await this._launcher.install(payload.path);
        return null;
      }

      case 'app.uninstall': {
        const app = await this._db.apps.get(payload.id);
        if (!app) throw new Error(`App not found: ${payload.id}`);
        if (app.protected) throw new Error(`Cannot uninstall protected app: ${payload.id}`);
        await this._db.apps.delete(payload.id);
        // Notify taskbar to update
        this._wm.onAppUninstalled(payload.id);
        return null;
      }

      case 'app.self': {
        return {
          name:        inst.name,
          version:     inst.version,
          path:        inst.path,
          permissions: inst.permissions,
          events:      inst.events,
        };
      }

      // ── Network ─────────────────────────────────────────────────────────────

      case 'net.fetch': {
        const { url, options = {} } = payload;
        const res = await fetch(url, {
          method:  options.method  || 'GET',
          headers: options.headers || {},
          body:    options.body    || undefined,
        });
        const body = await res.text();
        // Convert headers to plain object
        const headers = {};
        res.headers.forEach((value, key) => { headers[key] = value; });
        return { ok: res.ok, status: res.status, headers, body };
      }

      // ── OS info ─────────────────────────────────────────────────────────────

      case 'os.version': {
        return '2.0.0';
      }

      case 'os.theme': {
        return await this._settings.getTheme();
      }

      case 'os.env': {
        return {
          locale:   navigator.language || 'en-US',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          screen:   { width: window.innerWidth, height: window.innerHeight },
        };
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  }

  // ─── OS → App event broadcasting ──────────────────────────────────────────

  /**
   * Broadcast an OS event to all apps that declared it in their manifest.
   * Call this from the OS whenever something changes — theme, focus, etc.
   *
   * @param {string} event   - e.g. 'themeChanged'
   * @param {object} payload - Event data
   */
  broadcast(event, payload) {
    this.registry.broadcast(event, payload);
  }

  // ─── App lifecycle ─────────────────────────────────────────────────────────

  /**
   * Register a new app instance after its iframe is created.
   * Called by the launcher after booting an app.
   */
  registerApp(opts) {
    this.registry.register(opts);
  }

  /**
   * Unregister an app instance when its window is closed.
   * Called by the window manager on window close.
   */
  unregisterApp(instanceId) {
    this.registry.unregister(instanceId);
  }

  /**
   * Send the initial boot payload to a freshly launched app.
   * Injected synchronously so BOS.os.* methods work without async.
   *
   * @param {string} instanceId
   * @param {object} bootData - { theme, version, env, manifest }
   */
  async sendBootPayload(instanceId, bootData) {
    // Small delay to ensure the iframe's message listener is ready
    await new Promise(r => setTimeout(r, 50));
    this.registry.send(instanceId, {
      type:    'bos.boot',
      payload: bootData,
    });
  }
}
