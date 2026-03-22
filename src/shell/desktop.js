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
    this._icons    = new Map(); // path/appId → icon element
  }

  async boot() {
    this._desktop = document.getElementById('wm-desktop');
    this._setupContextMenu();
    this._setupDropTarget();

    // Add default app shortcut icons
    await this._addDefaultAppIcons();

    // Restore user files from /Desktop/
    await this._restoreDesktopFiles();

    // Listen for app installs/uninstalls to refresh icons
    document.addEventListener('bos:appInstalled',   () => this._restoreDesktopFiles());
    document.addEventListener('bos:appUninstalled', () => this._restoreDesktopFiles());

    // Deselect icons on desktop click
    this._desktop.addEventListener('click', e => {
      if (!e.target.closest('.bos-desktop-icon')) this._deselectAll();
    });

    console.log('[desktop] Booted');
  }

  async _addDefaultAppIcons() {
    const DEFAULT_ICONS = [
      { appId: 'filemanager',    x: 20,  y: 20  },
      { appId: 'texteditor',     x: 20,  y: 120 },
      { appId: 'terminal',       x: 20,  y: 220 },
      { appId: 'calculator',     x: 20,  y: 320 },
      { appId: 'browser',        x: 20,  y: 420 },
      { appId: 'paint',          x: 110, y: 20  },
      { appId: 'appstore',       x: 110, y: 120 },
      { appId: 'musicplayer',    x: 110, y: 220 },
      { appId: 'markdownviewer', x: 110, y: 320 },
      { appId: 'sysmonitor',     x: 110, y: 420 },
    ];

    for (const { appId, x, y } of DEFAULT_ICONS) {
      const app = await this._db.apps.get(appId);
      if (!app) continue;
      this.addIcon({
        label: app.name,
        icon:  app.icon || app.emoji || '⚡',
        appId,
        x, y,
      });
    }
  }

  // ─── Icon management ───────────────────────────────────────────────────────

  addIcon({ label, icon, x, y, fspath, appId, beep }) {
    const el = document.createElement('div');
    el.className = 'bos-desktop-icon';
    el.style.cssText = `
      position:absolute; left:${x}px; top:${y}px;
      width:78px; text-align:center; cursor:pointer;
      padding:6px; border-radius:6px;
      transition: background 0.15s;
    `;
    const iconHtml = icon && icon.startsWith('data:')
      ? `<img src="${icon}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;display:block;margin:0 auto">`
      : `<span style="font-size:36px;display:block">${icon}</span>`;

    el.innerHTML = `
      ${iconHtml}
      <span style="font-size:11px;color:#fff;text-shadow:0 1px 3px #000;
        margin-top:4px;display:block;word-break:break-word">${label}</span>
    `;

    const ic = { label, icon, fspath, appId, beep, el };
    el._ic = ic;

    // Click to select
    el.onclick = e => {
      this._deselectAll();
      el.style.background = 'rgba(0,120,212,0.3)';
      el.style.outline = '1px solid rgba(0,120,212,0.5)';
      e.stopPropagation();
    };

    // Double-click to launch
    el.ondblclick = () => this._launch(ic);

    // Right-click
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      this._showIconMenu(e.clientX, e.clientY, ic);
    });

    // Drag (mouse-based, for desktop repositioning + dropping onto FM)
    this._makeDraggable(el, ic);

    this._desktop.appendChild(el);
    const key = fspath || appId || label;
    this._icons.set(key, ic);
    return el;
  }

  _deselectAll() {
    this._icons.forEach(ic => {
      ic.el.style.background = '';
      ic.el.style.outline = '';
    });
  }

  async _restoreDesktopFiles() {
    // Remove dynamically added file icons (not pinned system ones)
    this._icons.forEach((ic, key) => {
      if (ic.fspath) { ic.el.remove(); this._icons.delete(key); }
    });

    const items = await this._fs.ls('/Desktop') || [];
    let row = 0, col = 0;
    const startX = 210, startY = 20, stepX = 90, stepY = 100;

    for (const item of items) {
      const fspath = '/Desktop/' + item.name;
      let label = item.name, icon = '📄', beep = null;

      if (item.name.endsWith('.beep')) {
        try {
          const content = await this._fs.read(fspath);
          // .beep is a zip — peek at manifest via apps DB first
          const appId = item.name.replace(/\.beep$/, '');
          const app   = await this._db.apps.get(appId);
          if (app) { icon = app.icon || app.emoji || '⚡'; label = app.name; }
          else      { icon = '⚡'; label = item.name; }
          beep = fspath;
        } catch { icon = '⚡'; }
      } else if (item.type === 'dir') {
        icon = '📁';
      } else {
        icon = this._fileIcon(item.name);
      }

      this.addIcon({
        label, icon, fspath,
        beep,
        x: startX + col * stepX,
        y: startY + row * stepY,
      });

      row++;
      if (startY + row * stepY > window.innerHeight - 150) { row = 0; col++; }
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
      try { await this._launcher.launchById(ic.appId); }
      catch(e) { this._wm.notify('Failed to launch: ' + e.message); }
    } else if (ic.fspath) {
      // Open file with appropriate app
      this._openFile(ic.fspath, ic.label);
    }
  }

  async _openFile(path, name) {
    const ext = name.split('.').pop().toLowerCase();
    if (['txt','md','js','json','html','css'].includes(ext)) {
      await this._launcher.launchById('texteditor');
    } else if (['png','jpg','jpeg','gif','webp'].includes(ext)) {
      // Image viewer — launch with file context
      await this._launcher.launchById('imageviewer');
    } else {
      this._wm.notify('No app to open: ' + name);
    }
  }

  // ─── Drag (desktop repositioning + drop onto FM) ───────────────────────────

  _makeDraggable(el, ic) {
    let sx, sy, sl, st, didDrag = false;

    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      didDrag = false;
      sx = e.clientX; sy = e.clientY;
      sl = parseInt(el.style.left) || 0;
      st = parseInt(el.style.top)  || 0;

      const onMove = e2 => {
        const dx = e2.clientX - sx, dy = e2.clientY - sy;
        if (!didDrag && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        didDrag = true;
        el.style.left    = Math.max(0, sl + dx) + 'px';
        el.style.top     = Math.max(0, st + dy) + 'px';
        el.style.opacity = '0.7';

        // Highlight FM windows under cursor
        document.querySelectorAll('.bos-fm-dropzone').forEach(zone => {
          const r    = zone.getBoundingClientRect();
          const over = e2.clientX >= r.left && e2.clientX <= r.right
                    && e2.clientY >= r.top  && e2.clientY <= r.bottom;
          zone.style.outline    = over ? '2px dashed var(--wm-accent)' : '';
          zone.style.background = over ? 'rgba(0,120,212,0.08)' : '';
        });

        // Highlight desktop folder icons
        this._icons.forEach(other => {
          if (other.el === el || !other.fspath) return;
          const r    = other.el.getBoundingClientRect();
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

        // Clear highlights
        document.querySelectorAll('.bos-fm-dropzone').forEach(z => {
          z.style.outline = ''; z.style.background = '';
        });

        if (!didDrag) return;

        // Dropped onto FM?
        let droppedOnFM = false;
        document.querySelectorAll('.bos-fm-dropzone').forEach(zone => {
          const r    = zone.getBoundingClientRect();
          const over = e2.clientX >= r.left && e2.clientX <= r.right
                    && e2.clientY >= r.top  && e2.clientY <= r.bottom;
          if (!over) return;
          droppedOnFM = true;
          zone.dispatchEvent(new CustomEvent('bos-icon-drop', { detail: { ic } }));
        });

        if (droppedOnFM) return;

        // Dropped onto a desktop folder?
        for (const [, other] of this._icons) {
          if (other.el === el || !other.fspath) continue;
          const r    = other.el.getBoundingClientRect();
          const over = e2.clientX >= r.left && e2.clientX <= r.right
                    && e2.clientY >= r.top  && e2.clientY <= r.bottom;
          if (!over) continue;
          other.el.style.outline = ''; other.el.style.background = '';
          // Move file into folder
          await this._moveIntoFolder(ic, other);
          return;
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  async _moveIntoFolder(srcIc, destIc) {
    const srcPath = srcIc.fspath;
    if (!srcPath) return;
    const filename = srcPath.split('/').pop();
    const destPath = destIc.fspath.replace(/\/$/, '') + '/' + filename;
    const res = await this._fs.move(srcPath, destPath);
    if (res.ok) {
      srcIc.el.remove();
      this._icons.delete(srcPath);
      this._wm.notify(`Moved "${filename}" into "${destIc.label}"`);
    } else {
      this._wm.notify('Move failed: ' + res.error);
    }
  }

  // ─── Drop target (files from FM → desktop) ─────────────────────────────────

  _setupDropTarget() {
    this._desktop.addEventListener('bos-icon-drop', async e => {
      // From FM to desktop
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
      { label: '📂 File Manager', action: () => this._launcher.launchById('filemanager') },
      { label: '⌨️ Terminal',     action: () => this._launcher.launchById('terminal') },
      { label: '🎨 Paint',        action: () => this._launcher.launchById('paint') },
      'sep',
      { label: '⚙️ Settings',    action: () => this._wm.openSystemApp('settings') },
    ]);
  }

  _showIconMenu(x, y, ic) {
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
          if (res.ok) { ic.el.remove(); this._icons.delete(ic.fspath); }
          else this._wm.notify('Delete failed: ' + res.error);
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
