/**
 * BrowserOS v2 — Global Search
 * src/shell/search.js
 *
 * Ctrl+Space spotlight-style search.
 * Searches: installed apps, recent files, settings keywords.
 * Keyboard driven — arrow keys to navigate, Enter to open, Escape to close.
 */

export class Search {
  constructor({ fs, db, wm, launcher, kernel }) {
    this._fs       = fs;
    this._db       = db;
    this._wm       = wm;
    this._launcher = launcher;
    this._kernel   = kernel;
    this._el       = null;
    this._results  = [];
    this._selected = 0;
  }

  boot() {
    this._buildEl();
    console.log('[search] Booted');
  }

  // ─── UI ────────────────────────────────────────────────────────────────────

  _buildEl() {
    const overlay = document.createElement('div');
    overlay.id = 'bos-search-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.5);
      backdrop-filter:blur(4px);z-index:99990;
      display:none;align-items:flex-start;justify-content:center;
      padding-top:15vh;
    `;

    overlay.innerHTML = `
      <div id="bos-search-box" style="
        width:580px;background:rgba(20,20,40,0.98);
        backdrop-filter:blur(30px);
        border:1px solid rgba(255,255,255,0.15);border-radius:14px;
        box-shadow:0 16px 48px rgba(0,0,0,0.6);overflow:hidden;
      ">
        <div style="display:flex;align-items:center;padding:14px 18px;gap:12px;
          border-bottom:1px solid rgba(255,255,255,0.08)">
          <span style="font-size:18px;opacity:0.5">🔍</span>
          <input id="bos-search-input" type="text"
            placeholder="Search apps, files, settings..."
            style="flex:1;background:transparent;border:none;outline:none;
              color:#e0e0ff;font-size:16px;font-family:inherit"
            autocomplete="off" spellcheck="false">
          <kbd style="font-size:11px;color:#8888aa;background:rgba(255,255,255,0.07);
            padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1)">esc</kbd>
        </div>
        <div id="bos-search-results" style="max-height:380px;overflow-y:auto;padding:6px"></div>
        <div id="bos-search-footer" style="
          padding:8px 18px;font-size:11px;color:#8888aa;
          border-top:1px solid rgba(255,255,255,0.06);
          display:flex;gap:16px;
        ">
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
          <span>esc Close</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._el    = overlay;
    this._input = overlay.querySelector('#bos-search-input');
    this._list  = overlay.querySelector('#bos-search-results');

    // Close on overlay click
    overlay.addEventListener('click', e => {
      if (e.target === overlay) this.close();
    });

    // Input handler
    this._input.addEventListener('input', () => this._search(this._input.value));

    // Keyboard navigation
    this._input.addEventListener('keydown', e => {
      if (e.key === 'Escape')    { this.close(); return; }
      if (e.key === 'ArrowDown') { this._move(1);  e.preventDefault(); return; }
      if (e.key === 'ArrowUp')   { this._move(-1); e.preventDefault(); return; }
      if (e.key === 'Enter')     { this._open(this._results[this._selected]); return; }
    });
  }

  // ─── Toggle ────────────────────────────────────────────────────────────────

  toggle() {
    if (this._el.style.display === 'none' || !this._el.style.display) this.open();
    else this.close();
  }

  open() {
    this._el.style.display = 'flex';
    this._input.value = '';
    this._results = [];
    this._selected = 0;
    this._list.innerHTML = '';
    setTimeout(() => this._input.focus(), 0);
    this._search(''); // show top results immediately
  }

  close() {
    this._el.style.display = 'none';
    this._input.blur();
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  async _search(query) {
    const q = query.toLowerCase().trim();
    this._results  = [];
    this._selected = 0;

    // ── Apps ──────────────────────────────────────────────────────────────────
    const apps = await this._db.apps.all();
    const matchedApps = apps
      .filter(a => !q || a.name.toLowerCase().includes(q) || a.id.includes(q))
      .slice(0, 6)
      .map(a => ({
        type:    'app',
        label:   a.name,
        sublabel: 'App',
        icon:    a.icon || '⚡',
        appId:   a.id,
      }));
    this._results.push(...matchedApps);

    // ── Recent files ──────────────────────────────────────────────────────────
    if (this._results.length < 8) {
      const recent = await this._fs.recent(20);
      const matchedFiles = recent
        .filter(f => !q || f.path.toLowerCase().includes(q))
        .slice(0, 8 - this._results.length)
        .map(f => ({
          type:     'file',
          label:    f.path.split('/').pop(),
          sublabel: f.path,
          icon:     this._fileIcon(f.path),
          path:     f.path,
        }));
      this._results.push(...matchedFiles);
    }

    // ── Settings keywords ─────────────────────────────────────────────────────
    const settingsItems = [
      { label: 'Appearance', icon: '🎨', action: 'settings:appearance' },
      { label: 'Display',    icon: '🖥️', action: 'settings:display' },
      { label: 'Apps',       icon: '📦', action: 'settings:apps' },
      { label: 'Storage',    icon: '💾', action: 'settings:storage' },
    ];
    if (q) {
      const matchedSettings = settingsItems
        .filter(s => s.label.toLowerCase().includes(q))
        .map(s => ({ type: 'setting', label: s.label, sublabel: 'Settings', icon: s.icon, action: s.action }));
      this._results.push(...matchedSettings);
    }

    this._render();
  }

  _render() {
    this._list.innerHTML = '';

    if (this._results.length === 0) {
      this._list.innerHTML = `
        <div style="padding:24px;text-align:center;color:#8888aa;font-size:13px">
          No results
        </div>
      `;
      return;
    }

    // Group by type
    let lastType = null;
    this._results.forEach((result, i) => {
      // Section header
      if (result.type !== lastType) {
        lastType = result.type;
        const header = document.createElement('div');
        header.style.cssText = `
          padding:6px 14px 3px;font-size:11px;color:#8888aa;
          text-transform:uppercase;letter-spacing:0.05em;
        `;
        header.textContent = result.type === 'app' ? 'Apps'
          : result.type === 'file' ? 'Recent Files'
          : 'Settings';
        this._list.appendChild(header);
      }

      const el = document.createElement('div');
      el.style.cssText = `
        display:flex;align-items:center;gap:12px;
        padding:9px 14px;border-radius:8px;cursor:pointer;
        transition:background 0.1s;
        background:${i === this._selected ? 'rgba(0,120,212,0.25)' : 'transparent'};
      `;
      el.dataset.idx = i;

      const iconEl = document.createElement('div');
      iconEl.style.cssText = 'width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0';

      // App icon might be a dataURL image
      if (result.icon && result.icon.startsWith('data:')) {
        const img = document.createElement('img');
        img.src = result.icon;
        img.style.cssText = 'width:28px;height:28px;border-radius:6px;object-fit:cover';
        iconEl.appendChild(img);
      } else {
        iconEl.textContent = result.icon || '📄';
      }

      const textEl = document.createElement('div');
      textEl.style.cssText = 'flex:1;overflow:hidden';
      textEl.innerHTML = `
        <div style="font-size:14px;color:#e0e0ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${result.label}</div>
        <div style="font-size:11px;color:#8888aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${result.sublabel || ''}</div>
      `;

      el.appendChild(iconEl);
      el.appendChild(textEl);

      el.onmouseenter = () => {
        this._selected = i;
        this._highlight();
      };
      el.onclick = () => this._open(result);

      this._list.appendChild(el);
    });
  }

  _highlight() {
    this._list.querySelectorAll('[data-idx]').forEach(el => {
      el.style.background = parseInt(el.dataset.idx) === this._selected
        ? 'rgba(0,120,212,0.25)' : 'transparent';
    });
    // Scroll selected into view
    const sel = this._list.querySelector(`[data-idx="${this._selected}"]`);
    sel?.scrollIntoView({ block: 'nearest' });
  }

  _move(dir) {
    this._selected = Math.max(0, Math.min(this._results.length - 1, this._selected + dir));
    this._highlight();
  }

  async _open(result) {
    if (!result) return;
    this.close();
    switch (result.type) {
      case 'app':
        try { await this._launcher.launchById(result.appId); }
        catch(e) { this._wm.notify('Failed to launch: ' + e.message); }
        break;
      case 'file':
        // Open in appropriate app
        document.dispatchEvent(new CustomEvent('bos:openFile', { detail: { path: result.path } }));
        break;
      case 'setting':
        this._wm.openSystemApp('settings');
        break;
    }
  }

  _fileIcon(path) {
    const ext = path.split('.').pop().toLowerCase();
    const map = { txt:'📄',md:'📄',js:'📜',html:'🌐',css:'🎨',json:'📋',png:'🖼️',jpg:'🖼️',mp3:'🎵',pdf:'📕' };
    return map[ext] || '📄';
  }
}
