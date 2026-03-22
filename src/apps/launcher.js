/**
 * BrowserOS v2 — .beep Launcher
 * src/apps/launcher.js
 *
 * Handles installing and launching .beep apps.
 *
 * Install: unzip .beep, validate manifest, store in apps DB
 * Launch:  load from apps DB, build iframe srcdoc, create window,
 *          register with kernel, send boot payload
 *
 * Depends on: JSZip (loaded via CDN in index.html)
 */

// BOS client source — read at build time and inlined into every iframe.
// We fetch it once and cache it.
let _bosClientSrc = null;

async function getBosClientSrc() {
  if (_bosClientSrc) return _bosClientSrc;
  const res = await fetch('/src/bos/client.js');
  _bosClientSrc = await res.text();
  return _bosClientSrc;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateInstanceId(appId) {
  return `${appId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function deriveAppId(path) {
  // /Apps/paint.beep → paint
  return path.split('/').pop().replace(/\.beep$/, '');
}

/** Extract icon from zip as a data URL */
async function extractIcon(zip, iconPath) {
  try {
    const file = zip.file(iconPath);
    if (!file) return null;
    const blob = await file.async('blob');
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Validate a parsed manifest object */
function validateManifest(manifest, path) {
  const required = ['name', 'version', 'bos', 'permissions', 'events', 'entry'];
  for (const field of required) {
    if (manifest[field] === undefined) {
      throw new Error(`.beep manifest missing required field: "${field}" (${path})`);
    }
  }
  if (!Array.isArray(manifest.permissions)) {
    throw new Error('.beep manifest "permissions" must be an array');
  }
  if (!Array.isArray(manifest.events)) {
    throw new Error('.beep manifest "events" must be an array');
  }
  // BOS version check
  const required_bos = parseFloat(manifest.bos);
  const current_bos  = 2.0;
  if (required_bos > current_bos) {
    throw new Error(
      `App requires BOS ${manifest.bos} but this OS runs BOS ${current_bos}. Update BrowserOS.`
    );
  }
}

/** Build the srcdoc HTML injected into the sandboxed iframe */
function buildSrcdoc(bosClientSrc, appMainSrc, manifest) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    color: #e0e0ff;
    background: transparent;
    width: 100%; height: 100%;
    overflow: hidden;
  }
  /* CSS variables — overwritten by theme on boot */
  :root {
    --accent:     #0078d4;
    --bg:         #1e1e2e;
    --border:     #3a3a5c;
    --text:       #e0e0ff;
    --text-dim:   #8888aa;
    --input-bg:   #2a2a3e;
    --sidebar-bg: #15152a;
    --hover:      #2d2d4e;
    --win-border: #3a3a5c;
    --win-bg:     #1e1e2e;
    --font:       'Segoe UI', system-ui, sans-serif;
  }
</style>
</head>
<body>
<script>
// ── BOS Client Library ──────────────────────────────────────────────────
${bosClientSrc}
</script>
<script>
// ── App: ${manifest.name} v${manifest.version} ──────────────────────────
(async function() {
  // Wait for boot payload so BOS.os.* is ready
  await BOS.ready();
  // Apply theme CSS variables immediately
  const theme = BOS.os.theme();
  if (theme) {
    const r = document.documentElement;
    if (theme.accent)    r.style.setProperty('--accent',     theme.accent);
    if (theme.font)      r.style.setProperty('--font',       theme.font);
    if (theme.darkMode !== undefined) {
      r.style.setProperty('--bg',         theme.darkMode ? '#1e1e2e' : '#f0f0f5');
      r.style.setProperty('--text',       theme.darkMode ? '#e0e0ff' : '#111');
      r.style.setProperty('--text-dim',   theme.darkMode ? '#8888aa' : '#666');
      r.style.setProperty('--sidebar-bg', theme.darkMode ? '#15152a' : '#d8d8ec');
      r.style.setProperty('--hover',      theme.darkMode ? '#2d2d4e' : '#c8c8e8');
      r.style.setProperty('--win-bg',     theme.darkMode ? '#1e1e2e' : '#f0f0f5');
      r.style.setProperty('--input-bg',   theme.darkMode ? '#2a2a3e' : '#e8e8f0');
      r.style.setProperty('--win-border', theme.darkMode ? '#3a3a5c' : '#ccc');
    }
  }
  // Listen for theme changes
  BOS.on('themeChanged', (t) => {
    const r = document.documentElement;
    if (t.accent) r.style.setProperty('--accent', t.accent);
    if (t.font)   r.style.setProperty('--font',   t.font);
  });
  // Run app
  try {
${appMainSrc}
  } catch(e) {
    console.error('[beep] App error:', e);
    document.body.innerHTML =
      '<div style="padding:20px;color:#ff8888;font-family:monospace;font-size:13px">'
      + '<b>Runtime error:</b><br><br>' + e.message + '</div>';
  }
})();
</script>
</body>
</html>`;
}

// ─── Launcher class ───────────────────────────────────────────────────────────

export class Launcher {
  /**
   * @param {object} opts
   * @param {import('../fs/fs.js').FileSystem} opts.fs
   * @param {import('../fs/db.js').DB}         opts.db
   * @param {import('../wm/wm.js').WindowManager} opts.wm
   * @param {import('../kernel/kernel.js').Kernel} opts.kernel
   * @param {object} opts.settings
   */
  constructor({ fs, db, wm, kernel, settings }) {
    this._fs       = fs;
    this._db       = db;
    this._wm       = wm;
    this._kernel   = kernel;
    this._settings = settings;
  }

  // ─── Install ───────────────────────────────────────────────────────────────

  /**
   * Install a .beep app from a filesystem path.
   * Reads the zip, validates manifest, stores in apps DB.
   *
   * @param {string} fspath - e.g. '/Apps/paint.beep'
   * @param {object} opts
   * @param {boolean} opts.protected - Mark as protected inbox app
   */
  async install(fspath, { protected: isProtected = false } = {}) {
    const content = await this._fs.read(fspath);
    if (!content) throw new Error(`File not found: ${fspath}`);

    // Decode base64 if needed
    let zipData;
    try {
      zipData = content.startsWith('data:')
        ? await fetch(content).then(r => r.arrayBuffer())
        : Uint8Array.from(atob(content), c => c.charCodeAt(0)).buffer;
    } catch {
      throw new Error(`Failed to decode .beep zip: ${fspath}`);
    }

    const zip = await JSZip.loadAsync(zipData);

    // Parse manifest
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error(`No manifest.json in ${fspath}`);
    const manifest = JSON.parse(await manifestFile.async('string'));
    validateManifest(manifest, fspath);

    // Extract icon — use image file if present, fall back to emoji
    const iconDataUrl = (manifest.icon && zip.file(manifest.icon))
      ? await extractIcon(zip, manifest.icon)
      : null;
    const iconEmoji = manifest.emoji || '⚡';

    const appId = deriveAppId(fspath);

    const appRecord = {
      id:          appId,
      path:        fspath,
      name:        manifest.name,
      version:     manifest.version,
      icon:        iconDataUrl,   // null if no image — use emoji instead
      emoji:       iconEmoji,     // always set, used as text fallback
      permissions: manifest.permissions,
      events:      manifest.events,
      entry:       manifest.entry,
      bos:         manifest.bos,
      width:       manifest.width  || 640,
      height:      manifest.height || 480,
      installedAt: Date.now(),
      protected:   isProtected,
    };

    await this._db.apps.put(appRecord);
    console.log(`[launcher] Installed: ${manifest.name} (${appId})`);

    // Notify shell to refresh app list
    document.dispatchEvent(new CustomEvent('bos:appInstalled', { detail: { appId } }));

    return appRecord;
  }

  // ─── Launch ────────────────────────────────────────────────────────────────

  /**
   * Launch an installed .beep app by its app ID.
   * @param {string} appId
   */
  async launchById(appId) {
    const app = await this._db.apps.get(appId);
    if (!app) throw new Error(`App not installed: ${appId}`);
    return this._boot(app);
  }

  /**
   * Launch a .beep app directly from a filesystem path.
   * Installs temporarily if not already in the app DB.
   * @param {string} fspath
   */
  async launch(fspath) {
    const appId = deriveAppId(fspath);
    let app = await this._db.apps.get(appId);
    if (!app) {
      // Install on the fly (not protected, not persisted permanently)
      app = await this.install(fspath);
    }
    return this._boot(app);
  }

  // ─── Internal boot ─────────────────────────────────────────────────────────

  async _boot(app) {
    // Load zip fresh from filesystem for the entry point source
    const content = await this._fs.read(app.path);
    if (!content) throw new Error(`App file missing: ${app.path}`);

    let zipData;
    try {
      zipData = content.startsWith('data:')
        ? await fetch(content).then(r => r.arrayBuffer())
        : Uint8Array.from(atob(content), c => c.charCodeAt(0)).buffer;
    } catch {
      throw new Error(`Failed to decode .beep zip: ${app.path}`);
    }

    const zip        = await JSZip.loadAsync(zipData);
    const entryFile  = zip.file(app.entry);
    if (!entryFile) throw new Error(`Entry point not found in .beep: ${app.entry}`);
    const appMainSrc = await entryFile.async('string');

    const bosClientSrc = await getBosClientSrc();
    const srcdoc       = buildSrcdoc(bosClientSrc, appMainSrc, app);
    const instanceId   = generateInstanceId(app.id);

    // Create window + iframe — use image icon or emoji fallback
    const windowIcon = app.icon || app.emoji || '⚡';
    const iframe = this._wm.createAppWindow({
      instanceId,
      title:  app.name,
      icon:   windowIcon,
      width:  app.width,
      height: app.height,
      srcdoc,
      onClose: (id) => this._kernel.unregisterApp(id),
    });

    // Register with kernel
    this._kernel.registerApp({
      instanceId,
      appId:         app.id,
      name:          app.name,
      version:       app.version,
      path:          app.path,
      permissions:   app.permissions,
      events:        app.events,
      contentWindow: iframe.contentWindow,
    });

    // Handle crash reports from iframe
    const crashHandler = (e) => {
      if (e.source !== iframe.contentWindow) return;
      if (e.data?.type !== 'bos.error') return;
      this._wm.showCrash(instanceId, e.data.payload);
    };
    window.addEventListener('message', crashHandler);

    // Build and send boot payload
    const theme = await this._settings.getTheme();
    await this._kernel.sendBootPayload(instanceId, {
      version: '2.0.0',
      theme,
      env: {
        locale:   navigator.language || 'en-US',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen:   { width: window.innerWidth, height: window.innerHeight },
      },
      manifest: {
        name:        app.name,
        version:     app.version,
        permissions: app.permissions,
        events:      app.events,
      },
    });

    console.log(`[launcher] Launched: ${app.name} (${instanceId})`);
    return instanceId;
  }

  // ─── Seed inbox apps ───────────────────────────────────────────────────────

  /**
   * Seed inbox apps on first boot.
   * Fetches each .beep from /apps/{name}.beep, writes to virtual FS, installs as protected.
   * On subsequent boots the apps are already in IndexedDB so this is a no-op.
   *
   * @param {string[]} appIds - e.g. ['calculator', 'texteditor', ...]
   */
  async seedInboxApps(appIds) {
    for (const appId of appIds) {
      const existing = await this._db.apps.get(appId);
      if (existing) continue; // already installed

      const url      = `/apps/${appId}.beep`;
      const fspath   = `/Apps/${appId}.beep`;

      try {
        console.log(`[launcher] Seeding ${appId} from ${url}...`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // Store as base64 dataURL in virtual FS
        const blob      = await res.blob();
        const dataUrl   = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        await this._fs.write(fspath, dataUrl);
        await this.install(fspath, { protected: true });
        console.log(`[launcher] Seeded: ${appId}`);
      } catch (e) {
        console.warn(`[launcher] Failed to seed ${appId}:`, e.message);
      }
    }
  }
}
