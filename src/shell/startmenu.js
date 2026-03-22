/**
 * BrowserOS v2 — Start Menu
 * src/shell/startmenu.js
 *
 * Opens anchored to the taskbar start button.
 * Shows pinned apps, all apps, recent files.
 * Typing immediately searches — no separate search needed.
 */

export class StartMenu {
  constructor({ fs, db, wm, launcher, kernel, settings }) {
    this._fs       = fs;
    this._db       = db;
    this._wm       = wm;
    this._launcher = launcher;
    this._kernel   = kernel;
    this._settings = settings;
    this._el       = null;
    this._open     = false;
  }

  boot() {
    this._build();
    // Ctrl+Space still works as alias
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); this.toggle(); }
      if (e.key === 'Escape' && this._open) this.close();
    });
    console.log('[startmenu] Booted');
  }

  toggle() { this._open ? this.close() : this.openMenu(); }

  // ─── Build DOM ─────────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.id = 'bos-startmenu';
    el.style.cssText = `
      position:fixed;
      bottom:calc(var(--wm-taskbar-h) + 8px);
      left:8px;
      width:380px;
      max-height:560px;
      background:rgba(15,12,35,0.97);
      backdrop-filter:blur(30px);
      border:1px solid rgba(255,255,255,0.12);
      border-radius:14px;
      box-shadow:0 16px 48px rgba(0,0,0,0.6);
      z-index:9200;
      display:none;
      flex-direction:column;
      overflow:hidden;
    `;

    // Search bar
    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'padding:14px 14px 10px;flex-shrink:0';
    const searchInput = document.createElement('input');
    searchInput.id = 'bos-startmenu-search';
    searchInput.placeholder = 'Search apps, files...';
    searchInput.style.cssText = `
      width:100%;background:rgba(255,255,255,0.08);
      border:1px solid rgba(255,255,255,0.12);border-radius:8px;
      color:#e0e0ff;padding:8px 12px;font-size:14px;outline:none;
      font-family:inherit;
    `;
    searchInput.addEventListener('input', () => this._onSearch(searchInput.value));
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter') this._launchFirst();
      if (e.key === 'ArrowDown') { e.preventDefault(); this._moveSelection(1); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); this._moveSelection(-1); }
    });
    searchWrap.appendChild(searchInput);
    el.appendChild(searchWrap);

    // Body (scrollable)
    const body = document.createElement('div');
    body.id = 'bos-startmenu-body';
    body.style.cssText = 'flex:1;overflow-y:auto;padding:0 8px 12px';
    el.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid rgba(255,255,255,0.07);flex-shrink:0';

    const userEl = document.createElement('div');
    userEl.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;color:#e0e0ff';
    userEl.innerHTML = '<span style="font-size:20px">👤</span><span>User</span>';

    const powerBtn = document.createElement('button');
    powerBtn.textContent = '⏻';
    powerBtn.title = 'Power';
    powerBtn.style.cssText = 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e0e0ff;width:32px;height:32px;cursor:pointer;font-size:16px;transition:background 0.15s';
    powerBtn.onmouseenter = () => powerBtn.style.background = 'rgba(200,50,50,0.3)';
    powerBtn.onmouseleave = () => powerBtn.style.background = 'rgba(255,255,255,0.07)';
    powerBtn.onclick = () => {
      if (confirm('Reload BrowserOS?')) location.reload();
    };

    const settingsBtn = document.createElement('button');
    settingsBtn.textContent = '⚙️';
    settingsBtn.title = 'Settings';
    settingsBtn.style.cssText = 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e0e0ff;width:32px;height:32px;cursor:pointer;font-size:16px;transition:background 0.15s';
    settingsBtn.onmouseenter = () => settingsBtn.style.background = 'rgba(255,255,255,0.15)';
    settingsBtn.onmouseleave = () => settingsBtn.style.background = 'rgba(255,255,255,0.07)';
    settingsBtn.onclick = () => { this._wm.openSystemApp('settings'); this.close(); };

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:6px';
    btnGroup.appendChild(settingsBtn);
    btnGroup.appendChild(powerBtn);

    footer.appendChild(userEl);
    footer.appendChild(btnGroup);
    el.appendChild(footer);

    document.body.appendChild(el);
    this._el          = el;
    this._searchInput = searchInput;
    this._body        = body;
  }

  // ─── Open / close ──────────────────────────────────────────────────────────

  async openMenu() {
    this._open = true;
    this._el.style.display = 'flex';
    this._searchInput.value = '';
    await this._renderDefault();
    setTimeout(() => {
      this._searchInput.focus();
      const close = e => {
        if (!this._el.contains(e.target) && e.target.id !== 'wm-start-btn') {
          this.close();
          document.removeEventListener('mousedown', close);
        }
      };
      document.addEventListener('mousedown', close);
    }, 0);
  }

  close() {
    this._open = false;
    this._el.style.display = 'none';
    this._searchInput.blur();
  }

  // ─── Default view ──────────────────────────────────────────────────────────

  async _renderDefault() {
    this._body.innerHTML = '';
    this._selectedIdx = -1;

    const pinned = this._settings.get('pinnedApps') || [];
    const allApps = await this._db.apps.all();

    // Pinned apps
    if (pinned.length) {
      this._section('Pinned');
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:4px 0 10px';
      for (const appId of pinned) {
        let app = allApps.find(a => a.id === appId);
        let label, icon;
        if (app) {
          label = app.name; icon = app.icon || app.emoji || '⚡';
        } else {
          const sys = this._wm._systemApps.get(appId);
          if (!sys) continue;
          label = sys.title; icon = sys.icon || '🪟';
        }
        const tile = this._makeTile(label, icon, () => this._launchApp(appId));
        grid.appendChild(tile);
      }
      this._body.appendChild(grid);
    }

    // All apps
    this._section('All Apps');
    const appsToShow = [...allApps];
    // Add native apps
    for (const [id, sys] of this._wm._systemApps) {
      if (!appsToShow.find(a => a.id === id)) {
        appsToShow.push({ id, name: sys.title, emoji: sys.icon, icon: null });
      }
    }
    appsToShow.sort((a, b) => a.name.localeCompare(b.name));

    for (const app of appsToShow) {
      const row = this._makeRow(
        app.icon || app.emoji || '⚡',
        app.name,
        'App',
        () => this._launchApp(app.id)
      );
      this._body.appendChild(row);
    }

    // Recent files
    const recent = await this._getRecentFiles();
    if (recent.length) {
      this._section('Recent Files');
      for (const f of recent) {
        const row = this._makeRow(
          this._fileIcon(f.path),
          f.path.split('/').pop(),
          f.path,
          () => { this.close(); }
        );
        this._body.appendChild(row);
      }
    }
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  async _onSearch(query) {
    this._body.innerHTML = '';
    this._selectedIdx = -1;
    const q = query.toLowerCase().trim();
    if (!q) { await this._renderDefault(); return; }

    const allApps = await this._db.apps.all();
    // Add native apps
    for (const [id, sys] of this._wm._systemApps) {
      if (!allApps.find(a => a.id === id)) {
        allApps.push({ id, name: sys.title, emoji: sys.icon, icon: null });
      }
    }

    const matchedApps = allApps.filter(a =>
      a.name.toLowerCase().includes(q) || a.id.includes(q)
    );

    if (matchedApps.length) {
      this._section('Apps');
      for (const app of matchedApps) {
        const row = this._makeRow(
          app.icon || app.emoji || '⚡',
          app.name,
          'App',
          () => this._launchApp(app.id)
        );
        row.dataset.searchResult = '1';
        this._body.appendChild(row);
      }
    }

    // File search
    const recent = await this._getRecentFiles();
    const matchedFiles = recent.filter(f => f.path.toLowerCase().includes(q));
    if (matchedFiles.length) {
      this._section('Files');
      for (const f of matchedFiles) {
        const row = this._makeRow(
          this._fileIcon(f.path),
          f.path.split('/').pop(),
          f.path,
          () => { this.close(); }
        );
        row.dataset.searchResult = '1';
        this._body.appendChild(row);
      }
    }

    if (!matchedApps.length && !matchedFiles.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:32px;text-align:center;color:rgba(255,255,255,0.3);font-size:13px';
      empty.textContent = 'No results for "' + query + '"';
      this._body.appendChild(empty);
    }
  }

  // ─── Keyboard navigation ───────────────────────────────────────────────────

  _moveSelection(dir) {
    const rows = [...this._body.querySelectorAll('[data-search-result], .sm-row')];
    if (!rows.length) return;
    rows.forEach(r => r.style.background = '');
    this._selectedIdx = Math.max(0, Math.min(rows.length - 1, this._selectedIdx + dir));
    rows[this._selectedIdx].style.background = 'rgba(0,120,212,0.25)';
    rows[this._selectedIdx].scrollIntoView({ block: 'nearest' });
  }

  _launchFirst() {
    const rows = [...this._body.querySelectorAll('[data-search-result], .sm-row')];
    if (rows.length > 0) {
      const idx = this._selectedIdx >= 0 ? this._selectedIdx : 0;
      rows[idx]?.click();
    }
  }

  // ─── Launch ────────────────────────────────────────────────────────────────

  async _launchApp(appId) {
    this.close();
    if (this._wm._systemApps.has(appId)) {
      this._wm.openSystemApp(appId);
    } else {
      try { await this._launcher.launchById(appId); }
      catch(e) { this._wm.notify('Failed to launch: ' + e.message); }
    }
  }

  // ─── UI helpers ────────────────────────────────────────────────────────────

  _section(title) {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.06em;font-weight:bold;padding:10px 6px 4px';
    el.textContent = title;
    this._body.appendChild(el);
  }

  _makeTile(label, icon, onClick) {
    const tile = document.createElement('div');
    tile.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 6px;border-radius:8px;cursor:pointer;text-align:center;transition:background 0.15s';
    tile.onmouseenter = () => tile.style.background = 'rgba(255,255,255,0.1)';
    tile.onmouseleave = () => tile.style.background = '';
    tile.onclick = onClick;

    const iconEl = document.createElement('div');
    iconEl.style.cssText = 'width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:24px;border-radius:8px;background:rgba(255,255,255,0.07)';
    if (icon && icon.startsWith('data:')) {
      iconEl.innerHTML = `<img src="${icon}" style="width:28px;height:28px;border-radius:4px;object-fit:cover">`;
    } else {
      iconEl.textContent = icon || '⚡';
    }

    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:11px;color:#e0e0ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%';
    labelEl.textContent = label;

    tile.appendChild(iconEl);
    tile.appendChild(labelEl);
    return tile;
  }

  _makeRow(icon, label, sublabel, onClick) {
    const row = document.createElement('div');
    row.className = 'sm-row';
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:8px;cursor:pointer;transition:background 0.15s';
    row.onmouseenter = () => row.style.background = 'rgba(255,255,255,0.07)';
    row.onmouseleave = () => { if (row.style.background !== 'rgba(0,120,212,0.25)') row.style.background = ''; };
    row.onclick = onClick;

    const iconEl = document.createElement('div');
    iconEl.style.cssText = 'width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0';
    if (icon && icon.startsWith('data:')) {
      iconEl.innerHTML = `<img src="${icon}" style="width:28px;height:28px;border-radius:4px;object-fit:cover">`;
    } else {
      iconEl.textContent = icon;
    }

    const text = document.createElement('div');
    text.style.cssText = 'flex:1;overflow:hidden';
    text.innerHTML = `
      <div style="font-size:13px;color:#e0e0ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sublabel}</div>
    `;

    row.appendChild(iconEl);
    row.appendChild(text);
    return row;
  }

  _fileIcon(path) {
    const ext = path.split('.').pop().toLowerCase();
    const map = { txt:'📄',md:'📄',js:'📜',html:'🌐',css:'🎨',json:'📋',png:'🖼️',jpg:'🖼️',mp3:'🎵',pdf:'📕' };
    return map[ext] || '📄';
  }

  async _getRecentFiles() {
    try {
      // Walk Documents, Desktop, Downloads for recently modified files
      const dirs = ['/Documents', '/Desktop', '/Downloads', '/Pictures'];
      const files = [];
      for (const dir of dirs) {
        const items = await this._fs.ls(dir) || [];
        for (const item of items) {
          if (item.type !== 'dir' && !item.name.startsWith('.')) {
            files.push({ path: dir + '/' + item.name, modified: item.modified || 0 });
          }
        }
      }
      return files.sort((a, b) => b.modified - a.modified).slice(0, 8);
    } catch { return []; }
  }
}
