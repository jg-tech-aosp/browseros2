/**
 * BrowserOS v2 — App Store (Native System Component)
 * src/shell/appstore.js
 *
 * Native app — not a .beep. Needs direct binary fetch for .beep downloads.
 */

const STORE_URL = 'https://raw.githubusercontent.com/jg-tech-aosp/BrowserOS-Store/main/index.json';

export function registerAppStore({ wm, fs, db, launcher }) {

  wm.registerSystemApp('appstore', {
    title:  'App Store',
    icon:   '📦',
    width:  720,
    height: 520,
    mount(container, instanceId) {
      let apps = [];
      const installing = {};

      container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--wm-bg);color:var(--wm-text)';

      // ── Header ───────────────────────────────────────────────────────────────
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px 18px;background:rgba(0,0,0,0.2);border-bottom:1px solid var(--wm-border);flex-shrink:0';
      header.innerHTML = '<span style="font-size:20px">📦</span><span style="font-size:16px;font-weight:bold">App Store</span>';

      const searchInput = document.createElement('input');
      searchInput.placeholder = 'Search apps...';
      searchInput.style.cssText = 'flex:1;background:var(--wm-hover);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--wm-text);padding:6px 12px;font-size:13px;outline:none';
      searchInput.oninput = () => renderApps(searchInput.value.toLowerCase());
      header.appendChild(searchInput);

      const refreshBtn = document.createElement('button');
      refreshBtn.textContent = '⟳';
      refreshBtn.style.cssText = 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--wm-text);width:32px;height:32px;cursor:pointer;font-size:16px;flex-shrink:0';
      refreshBtn.onclick = loadStore;
      header.appendChild(refreshBtn);
      container.appendChild(header);

      // ── Main ─────────────────────────────────────────────────────────────────
      const main = document.createElement('div');
      main.style.cssText = 'flex:1;overflow-y:auto;padding:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;align-content:start';
      container.appendChild(main);

      // ── Status bar ────────────────────────────────────────────────────────────
      const statusEl = document.createElement('div');
      statusEl.style.cssText = 'padding:4px 16px;font-size:11px;color:var(--wm-text-dim);border-top:1px solid var(--wm-border);background:rgba(0,0,0,0.2);flex-shrink:0';
      container.appendChild(statusEl);

      // ── Render ────────────────────────────────────────────────────────────────
      function renderApps(query) {
        main.innerHTML = '';
        const filtered = query
          ? apps.filter(a => a.name.toLowerCase().includes(query) || (a.description || '').toLowerCase().includes(query))
          : apps;

        if (!filtered.length) {
          main.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--wm-text-dim);padding:40px;font-size:14px">${apps.length === 0 ? 'Loading store...' : 'No apps found'}</div>`;
          return;
        }

        filtered.forEach(app => {
          const card = document.createElement('div');
          card.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid var(--wm-border);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:8px;transition:border-color 0.15s';
          card.onmouseenter = () => card.style.borderColor = 'var(--wm-accent)';
          card.onmouseleave = () => card.style.borderColor = 'var(--wm-border)';

          const topRow = document.createElement('div');
          topRow.style.cssText = 'display:flex;align-items:center;gap:10px';
          topRow.innerHTML = `
            <span style="font-size:28px">${app.icon || app.emoji || '⚡'}</span>
            <div>
              <div style="font-size:14px;font-weight:bold;color:var(--wm-text)">${app.name}</div>
              <div style="font-size:11px;color:var(--wm-text-dim)">v${app.version || '1.0'} by ${app.author || 'unknown'}</div>
            </div>`;

          const desc = document.createElement('div');
          desc.style.cssText = 'font-size:12px;color:var(--wm-text-dim);flex:1;line-height:1.5';
          desc.textContent = app.description || '';

          const meta = document.createElement('div');
          meta.style.cssText = 'font-size:11px;color:var(--wm-text-dim);display:flex;gap:8px';
          meta.innerHTML = `<span>${app.size || '?'}</span><span>•</span><span>${app.category || 'app'}</span>`;

          const isInstalled = installing[app.id] === 'done';
          const isLoading   = installing[app.id] === 'loading';

          const installBtn = document.createElement('button');
          installBtn.textContent = isInstalled ? '✓ Installed' : isLoading ? 'Installing...' : 'Install';
          installBtn.style.cssText = `background:${isInstalled ? 'rgba(16,124,16,0.3)' : 'var(--wm-accent)'};border:none;color:#fff;border-radius:6px;padding:7px;font-size:13px;cursor:${isInstalled || isLoading ? 'default' : 'pointer'};transition:filter 0.15s`;
          if (!isInstalled && !isLoading) {
            installBtn.onmouseenter = () => installBtn.style.filter = 'brightness(1.15)';
            installBtn.onmouseleave = () => installBtn.style.filter = '';
            installBtn.onclick = () => installApp(app, installBtn);
          }

          card.appendChild(topRow);
          card.appendChild(desc);
          card.appendChild(meta);
          card.appendChild(installBtn);
          main.appendChild(card);
        });

        statusEl.textContent = filtered.length + ' app' + (filtered.length !== 1 ? 's' : '') + (query ? ' found' : ' available');
      }

      // ── Install ───────────────────────────────────────────────────────────────
      async function installApp(app, btn) {
        installing[app.id] = 'loading';
        btn.textContent = 'Downloading...';
        btn.style.background = 'rgba(255,255,255,0.1)';
        btn.disabled = true;

        try {
          // Fetch binary directly — we're native, no sandbox
          const res = await fetch(app.url);
          if (!res.ok) throw new Error('Download failed: HTTP ' + res.status);

          const arrayBuffer = await res.arrayBuffer();

          // Validate it's a real zip before saving
          const zip = await JSZip.loadAsync(arrayBuffer);
          const manifestFile = zip.file('manifest.json');
          if (!manifestFile) throw new Error('Invalid .beep: no manifest.json');

          // Convert to base64 for storage
          const bytes  = new Uint8Array(arrayBuffer);
          let binary   = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const base64 = btoa(binary);

          // Store directly in apps DB (same as seedInboxApps)
          const manifest = JSON.parse(await manifestFile.async('string'));
          const appRecord = {
            id:          app.id,
            path:        '/Apps/' + app.id + '.beep',
            name:        manifest.name,
            version:     manifest.version,
            icon:        null,
            emoji:       manifest.emoji || app.emoji || '⚡',
            permissions: manifest.permissions || [],
            events:      manifest.events      || [],
            entry:       manifest.entry,
            bos:         manifest.bos,
            width:       manifest.width  || 640,
            height:      manifest.height || 480,
            installedAt: Date.now(),
            protected:   false,
            zipData:     base64,
          };

          await db.apps.put(appRecord);

          installing[app.id] = 'done';
          btn.textContent = '✓ Installed';
          btn.style.background = 'rgba(16,124,16,0.3)';
          btn.disabled = false;
          btn.onmouseenter = null;
          btn.onmouseleave = null;

          wm.notify('Installed: ' + app.name);
          document.dispatchEvent(new CustomEvent('bos:appInstalled', { detail: { appId: app.id } }));

        } catch(e) {
          delete installing[app.id];
          btn.textContent = 'Failed — retry';
          btn.style.background = 'rgba(200,50,50,0.3)';
          btn.disabled = false;
          btn.onclick = () => installApp(app, btn);
          wm.notify('Install failed: ' + e.message);
          console.error('[appstore] Install failed:', e);
        }
      }

      // ── Load store ────────────────────────────────────────────────────────────
      async function loadStore() {
        main.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--wm-text-dim);padding:40px;font-size:14px">🔄 Loading store...</div>`;
        statusEl.textContent = 'Fetching app list...';
        try {
          const res = await fetch(STORE_URL);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          apps = await res.json();

          // Mark already installed apps
          for (const app of apps) {
            const existing = await db.apps.get(app.id);
            if (existing) installing[app.id] = 'done';
          }

          statusEl.textContent = apps.length + ' app' + (apps.length !== 1 ? 's' : '') + ' available';
          renderApps('');
        } catch(e) {
          main.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:40px">
              <div style="font-size:32px">📵</div>
              <div style="font-size:14px;color:var(--wm-text-dim);margin-top:12px">Could not reach the App Store</div>
              <div style="font-size:12px;color:#666;margin-top:6px">${e.message}</div>
            </div>`;
          statusEl.textContent = 'Store unavailable';
        }
      }

      loadStore();
    }
  });
}
