/**
 * BrowserOS v2 — Desktop
 * src/shell/desktop.js
 *
 * Manages the desktop surface:
 * - Desktop icons (persisted, restored on boot)
 * - Right-click context menu
 * - Wallpaper
 * - Drag-and-drop between desktop and File Manager
 */

export class Desktop {
  constructor({ fs, db, wm, launcher, kernel, settings }) {
    this._fs       = fs;
    this._db       = db;
    this._wm       = wm;
    this._launcher = launcher;
    this._kernel   = kernel;
    this._settings = settings;
    this._icons    = new Map(); // key → { label, icon, appId, fspath, beep, el, gridX, gridY }

    // Grid config
    this._CELL_W   = 90;
    this._CELL_H   = 100;
    this._MARGIN_X = 16;
    this._MARGIN_Y = 16;
    this._occupiedCells = new Set(); // "col,row" strings
  }

  // ─── Grid helpers ──────────────────────────────────────────────────────────

  _cellKey(col, row) { return `${col},${row}`; }

  _pixelToCell(x, y) {
    return {
      col: Math.round((x - this._MARGIN_X) / this._CELL_W),
      row: Math.round((y - this._MARGIN_Y) / this._CELL_H),
    };
  }

  _cellToPixel(col, row) {
    return {
      x: this._MARGIN_X + col * this._CELL_W,
      y: this._MARGIN_Y + row * this._CELL_H,
    };
  }

  _nextFreeCell() {
    const maxRows = Math.floor((window.innerHeight - 100) / this._CELL_H);
    let col = 0, row = 0;
    while (this._occupiedCells.has(this._cellKey(col, row))) {
      row++;
      if (row >= maxRows) { row = 0; col++; }
    }
    return { col, row };
  }

  _occupyCell(col, row) { this._occupiedCells.add(this._cellKey(col, row)); }
  _freeCell(col, row)   { this._occupiedCells.delete(this._cellKey(col, row)); }

  // ─── Position persistence ──────────────────────────────────────────────────

  async _loadPositions() {
    try {
      const raw = await this._fs.read('/Desktop/.iconpositions');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  async _savePositions() {
    const positions = {};
    this._icons.forEach((ic, key) => {
      positions[key] = { col: ic.gridX, row: ic.gridY };
    });
    await this._fs.write('/Desktop/.iconpositions', JSON.stringify(positions));
  }

  async boot() {
    this._desktop = document.getElementById('wm-desktop');
    this._positions = await this._loadPositions();
    this._setupContextMenu();
    this._setupDropTarget();

    await this._addDefaultAppIcons();
    await this._restoreDesktopFiles();

    document.addEventListener('bos:appInstalled',   () => this._restoreDesktopFiles());
    document.addEventListener('bos:appUninstalled', () => this._restoreDesktopFiles());

    this._desktop.addEventListener('click', e => {
      if (!e.target.closest('.bos-desktop-icon')) this._deselectAll();
    });

    console.log('[desktop] Booted');
  }

  async _addDefaultAppIcons() {
    const DEFAULT_APPS = [
      { appId: 'filemanager', label: 'File Manager', icon: '📁', native: true },
      { appId: 'browser',     label: 'Browser',      icon: '🌐', native: true },
      { appId: 'settings',    label: 'Settings',     icon: '⚙️',  native: true },
      { appId: 'texteditor',     native: false },
      { appId: 'terminal',       native: false },
      { appId: 'calculator',     native: false },
      { appId: 'paint',          native: false },
      { appId: 'appstore',       native: false },
      { appId: 'musicplayer',    native: false },
      { appId: 'markdownviewer', native: false },
      { appId: 'sysmonitor',     native: false },
    ];

    for (const def of DEFAULT_APPS) {
      if (this._icons.has(def.appId)) continue; // already added
      let label = def.label, icon = def.icon;
      if (!def.native) {
        const app = await this._db.apps.get(def.appId);
        if (!app) continue;
        label = app.name;
        icon  = app.icon || app.emoji || '⚡';
      }
      const { col, row } = this._getSavedOrNextCell(def.appId);
      this._addIconEl({ label, icon, appId: def.appId, col, row });
    }
  }

  // ─── Icon management ───────────────────────────────────────────────────────

  _getSavedOrNextCell(key) {
    if (this._positions[key]) {
      const { col, row } = this._positions[key];
      if (!this._occupiedCells.has(this._cellKey(col, row))) {
        this._occupyCell(col, row);
        return { col, row };
      }
    }
    const { col, row } = this._nextFreeCell();
    this._occupyCell(col, row);
    return { col, row };
  }

  addIcon({ label, icon, fspath, appId, beep }) {
    const key = fspath || appId || label;
    if (this._icons.has(key)) return;
    const { col, row } = this._getSavedOrNextCell(key);
    return this._addIconEl({ label, icon, fspath, appId, beep, col, row });
  }

  _addIconEl({ label, icon, fspath, appId, beep, col, row }) {
    const key = fspath || appId || label;
    const { x, y } = this._cellToPixel(col, row);

    const el = document.createElement('div');
    el.className = 'bos-desktop-icon';
    el.style.cssText = `
      position:absolute; left:${x}px; top:${y}px;
      width:${this._CELL_W - 10}px; text-align:center; cursor:pointer;
      padding:6px; border-radius:6px; transition:background 0.15s;
    `;

    const iconHtml = icon && icon.startsWith('data:')
      ? `<img src="${icon}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;display:block;margin:0 auto">`
      : `<span style="font-size:36px;display:block">${icon}</span>`;

    el.innerHTML = `
      ${iconHtml}
      <span style="font-size:11px;color:#fff;text-shadow:0 1px 3px #000;
        margin-top:4px;display:block;word-break:break-word;line-height:1.3">${label}</span>
    `;

    const ic = { label, icon, fspath, appId, beep, el, gridX: col, gridY: row };
    el._ic = ic;
    this._icons.set(key, ic);

    el.addEventListener('click', e => {
      this._deselectAll();
      el.style.background = 'rgba(0,120,212,0.3)';
      el.style.outline    = '1px solid rgba(0,120,212,0.5)';
      e.stopPropagation();
    });

    el.addEventListener('dblclick', () => this._launch(ic));

    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      this._showIconMenu(e.clientX, e.clientY, ic, key);
    });

    this._makeDraggable(el, ic, key);
    this._desktop.appendChild(el);
    return el;
  }

  _deselectAll() {
    this._icons.forEach(ic => {
      ic.el.style.background = '';
      ic.el.style.outline = '';
    });
  }

  async _restoreDesktopFiles() {
    // Remove file icons (not app shortcut icons)
    this._icons.forEach((ic, key) => {
      if (ic.fspath) {
        this._freeCell(ic.gridX, ic.gridY);
        ic.el.remove();
        this._icons.delete(key);
      }
    });

    const items = await this._fs.ls('/Desktop') || [];

    for (const item of items) {
      if (item.name === '.iconpositions') continue;
      const fspath = '/Desktop/' + item.name;
      let label = item.name, icon = '📄', beep = null;

      if (item.name.endsWith('.beep')) {
        const appId = item.name.replace(/\.beep$/, '');
        const app   = await this._db.apps.get(appId);
        if (app) { icon = app.icon || app.emoji || '⚡'; label = app.name; }
        else      { icon = '⚡'; }
        beep = fspath;
      } else if (item.type === 'dir') {
        icon = '📁';
      } else {
        icon = this._fileIcon(item.name);
      }

      this.addIcon({ label, icon, fspath, beep });
    }
  }

  _fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const map = {
      txt:'📄', md:'📄', js:'📜', html:'🌐', css:'🎨',
      json:'📋', png:'🖼️', jpg:'🖼️', mp3:'🎵', pdf:'📕',
    };
    return map[ext] || '📄';
  }

  // ─── Launch ────────────────────────────────────────────────────────────────

  async _launch(ic) {
    if (ic.beep) {
      try { await this._launcher.launch(ic.beep); }
      catch(e) { this._wm.notify('Failed to launch: ' + e.message); }
    } else if (ic.appId) {
      if (this._wm._systemApps.has(ic.appId)) {
        this._wm.openSystemApp(ic.appId);
      } else {
        try { await this._launcher.launchById(ic.appId); }
        catch(e) { this._wm.notify('Failed to launch: ' + e.message); }
      }
    } else if (ic.fspath) {
      this._openFile(ic.fspath, ic.label);
    }
  }

  async _openFile(path, name) {
    const stat = await this._fs.stat(path);
    if (stat && stat.type === 'dir') {
      this._wm.openSystemApp('filemanager', { path });
      return;
    }
    const ext = name.split('.').pop().toLowerCase();
    if (['txt','md','js','json','html','css'].includes(ext)) {
      await this._launcher.launchById('texteditor');
    } else if (['mp3','wav','ogg'].includes(ext)) {
      await this._launcher.launchById('musicplayer');
    } else if (['png','jpg','jpeg','gif','webp'].includes(ext)) {
      this._wm.notify('Image viewer coming soon');
    } else {
      this._wm.notify('No app to open: ' + name);
    }
  }

  // ─── Drag (grid-snapping repositioning) ────────────────────────────────────

  _makeDraggable(el, ic, key) {
    let sx, sy, sl, st, didDrag = false;

    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      didDrag = false;
      sx = e.clientX; sy = e.clientY;
      sl = parseInt(el.style.left) || 0;
      st = parseInt(el.style.top)  || 0;

      const onMove = e2 => {
        const dx = e2.clientX - sx, dy = e2.clientY - sy;
        if (!didDrag && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        didDrag = true;
        el.style.left    = Math.max(0, sl + dx) + 'px';
        el.style.top     = Math.max(0, st + dy) + 'px';
        el.style.opacity = '0.7';
        el.style.zIndex  = '999';

        // Highlight folder icons under cursor
        this._icons.forEach(other => {
          if (other.el === el || !other.fspath) return;
          const r = other.el.getBoundingClientRect();
          const over = e2.clientX >= r.left && e2.clientX <= r.right
                    && e2.clientY >= r.top  && e2.clientY <= r.bottom;
          other.el.style.outline    = over ? '2px solid var(--wm-accent)' : '';
          other.el.style.background = over ? 'rgba(0,120,212,0.2)' : '';
        });
      };

      const onUp = async e2 => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        el.style.opacity = '';
        el.style.zIndex  = '';

        if (!didDrag) return;

        // Check if dropped onto a folder icon
        for (const [otherKey, other] of this._icons) {
          if (other.el === el || !other.fspath) continue;
          const r = other.el.getBoundingClientRect();
          const over = e2.clientX >= r.left && e2.clientX <= r.right
                    && e2.clientY >= r.top  && e2.clientY <= r.bottom;
          if (!over) continue;
          other.el.style.outline = ''; other.el.style.background = '';
          // Only move files into folders
          if (ic.fspath) {
            const filename = ic.fspath.split('/').pop();
            const destPath = other.fspath.replace(/\/$/, '') + '/' + filename;
            const res = await this._fs.move(ic.fspath, destPath);
            if (res.ok) {
              this._freeCell(ic.gridX, ic.gridY);
              ic.el.remove();
              this._icons.delete(key);
              await this._savePositions();
              this._wm.notify(`Moved "${filename}" into "${other.label}"`);
            } else {
              this._wm.notify('Move failed: ' + res.error);
              // Snap back to original position
              const { x, y } = this._cellToPixel(ic.gridX, ic.gridY);
              el.style.left = x + 'px'; el.style.top = y + 'px';
            }
          }
          return;
        }

        const curX = parseInt(el.style.left) || 0;
        const curY = parseInt(el.style.top)  || 0;

        // Snap to nearest free grid cell
        const { col: rawCol, row: rawRow } = this._pixelToCell(curX + this._CELL_W / 2, curY + this._CELL_H / 2);
        const maxRows = Math.floor((window.innerHeight - 100) / this._CELL_H);
        let col = Math.max(0, rawCol);
        let row = Math.max(0, Math.min(rawRow, maxRows - 1));

        // If target cell is occupied by another icon, find nearest free
        if (this._occupiedCells.has(this._cellKey(col, row)) &&
            !(ic.gridX === col && ic.gridY === row)) {
          const free = this._nextFreeCell();
          col = free.col; row = free.row;
        }

        // Free old cell, occupy new
        this._freeCell(ic.gridX, ic.gridY);
        this._occupyCell(col, row);
        ic.gridX = col; ic.gridY = row;

        // Snap to grid pixel position
        const { x, y } = this._cellToPixel(col, row);
        el.style.left = x + 'px';
        el.style.top  = y + 'px';

        // Save positions
        await this._savePositions();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  // ─── Drop target (files from FM → desktop) ─────────────────────────────────

  _setupDropTarget() {
    this._desktop.addEventListener('bos-icon-drop', async e => {
      const { path, name } = e.detail;
      if (!path) return;
      const filename = path.split('/').pop();
      const destPath = '/Desktop/' + filename;
      if (path === destPath) return;
      const res = await this._fs.move(path, destPath);
      if (res.ok) {
        await this._restoreDesktopFiles();
        this._wm.notify(`Moved "${filename}" to Desktop`);
      } else {
        this._wm.notify('Move failed: ' + res.error);
      }
    });

    // Receive drops from FM via OS-level drag (postMessage based)
    document.addEventListener('bos:dropOnDesktop', async e => {
      const { path, name, x, y } = e.detail;
      if (!path) return;
      const filename = path.split('/').pop();
      const destPath = '/Desktop/' + filename;
      if (path === destPath) return;
      const res = await this._fs.move(path, destPath);
      if (res.ok) {
        await this._restoreDesktopFiles();
        this._wm.notify(`Moved "${filename}" to Desktop`);
      } else {
        this._wm.notify('Move failed: ' + res.error);
      }
    });
  }

  // ─── Context menu (empty desktop space) ────────────────────────────────────

  _setupContextMenu() {
    this._desktop.addEventListener('contextmenu', e => {
      if (e.target.closest('.bos-desktop-icon') || e.target.closest('.wm-window')) return;
      e.preventDefault();
      this._showDesktopMenu(e.clientX, e.clientY);
    });
  }

  _showDesktopMenu(x, y) {
    this._showMenu(x, y, [
      { label: '📁 New Folder', action: async () => {
        const name = prompt('Folder name:');
        if (!name) return;
        await this._fs.mkdir('/Desktop/' + name);
        await this._restoreDesktopFiles();
      }},
      { label: '📄 New Text File', action: async () => {
        const name = prompt('File name:', 'untitled.txt');
        if (!name) return;
        await this._fs.write('/Desktop/' + name, '');
        await this._restoreDesktopFiles();
      }},
      'sep',
      { label: '📂 File Manager', action: () => this._wm.openSystemApp('filemanager') },
      { label: '⌨️ Terminal',     action: () => this._launcher.launchById('terminal') },
      { label: '🎨 Paint',        action: () => this._launcher.launchById('paint') },
      'sep',
      { label: '⚙️ Settings',    action: () => this._wm.openSystemApp('settings') },
    ]);
  }

  _showIconMenu(x, y, ic, key) {
    const items = [
      { label: '📂 Open', action: () => this._launch(ic) },
      'sep',
      { label: '✏️ Rename', action: async () => {
        const nn = prompt('New name:', ic.label);
        if (!nn || nn === ic.label) return;
        if (ic.fspath) {
          const res = await this._fs.rename(ic.fspath, nn);
          if (res.ok) { ic.label = nn; ic.el.querySelector('span:last-child').textContent = nn; }
          else this._wm.notify('Rename failed: ' + res.error);
        }
      }},
      { label: '🗑️ Delete', action: async () => {
        if (!confirm(`Delete "${ic.label}"?`)) return;
        if (ic.fspath) {
          const res = await this._fs.rm(ic.fspath);
          if (res.ok) {
            this._freeCell(ic.gridX, ic.gridY);
            ic.el.remove();
            this._icons.delete(key || ic.fspath);
            await this._savePositions();
          } else this._wm.notify('Delete failed: ' + res.error);
        }
      }},
    ];

    if (ic.beep) {
      items.push('sep');
      items.push({ label: '📝 Edit .beep', action: async () => {
        await this._launcher.launchById('texteditor');
      }});
    }

    this._showMenu(x, y, items);
  }

  // ─── Generic context menu renderer ────────────────────────────────────────

  _showMenu(x, y, items) {
    document.getElementById('bos-ctx-menu')?.remove();

    const menu = document.createElement('div');
    menu.id = 'bos-ctx-menu';
    menu.style.cssText = `
      position:fixed; left:${Math.min(x, window.innerWidth-200)}px;
      top:${Math.min(y, window.innerHeight - items.length*36)}px;
      background:rgba(20,20,40,0.97); backdrop-filter:blur(20px);
      border:1px solid rgba(255,255,255,0.12); border-radius:8px;
      padding:4px; z-index:99999; min-width:180px;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);
    `;

    items.forEach((item, i) => {
      if (item === 'sep') {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin:4px 0';
        menu.appendChild(sep);
      } else {
        const el = document.createElement('div');
        el.style.cssText = `
          padding:7px 14px; border-radius:4px; font-size:13px;
          cursor:pointer; color:#e0e0ff; transition:background 0.1s;
        `;
        el.textContent = item.label;
        el.onmouseenter = () => el.style.background = 'rgba(255,255,255,0.1)';
        el.onmouseleave = () => el.style.background = '';
        el.onclick = () => { item.action(); menu.remove(); };
        menu.appendChild(el);
      }
    });

    document.body.appendChild(menu);
    const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }};
    setTimeout(() => document.addEventListener('click', close), 0);
  }
}
