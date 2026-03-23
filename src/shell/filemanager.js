/**
 * BrowserOS v2 — File Manager (Native System Component)
 * src/shell/filemanager.js
 *
 * Native app — not a .beep. Registered with WM via registerSystemApp.
 * Direct FS access, full drag-and-drop support.
 */

export function registerFileManager({ wm, fs, db, launcher, kernel, settings }) {

  wm.registerSystemApp('filemanager', {
    title:  'File Manager',
    icon:   '📁',
    width:  760,
    height: 520,
    mount(container, instanceId, args = {}) {
      let cwd = args.path || '/';
      const history = ['/'];
      let histIdx = 0;
      let selected = null;
      let clipboard = null;

      container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--wm-bg);color:var(--wm-text)';

      // ── Toolbar ──────────────────────────────────────────────────────────────
      const toolbar = document.createElement('div');
      toolbar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;background:rgba(0,0,0,0.2);border-bottom:1px solid var(--wm-border);flex-shrink:0';

      function mkBtn(t, title) {
        const b = document.createElement('button');
        b.textContent = t; b.title = title || t;
        b.style.cssText = 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:var(--wm-text);padding:4px 8px;font-size:12px;cursor:pointer;transition:background 0.1s';
        b.onmouseenter = () => b.style.background = 'rgba(255,255,255,0.15)';
        b.onmouseleave = () => b.style.background = 'rgba(255,255,255,0.07)';
        return b;
      }

      const backBtn     = mkBtn('◀', 'Back');
      const upBtn       = mkBtn('▲', 'Up');
      const pathInput   = document.createElement('input');
      pathInput.style.cssText = 'flex:1;background:var(--wm-hover);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:var(--wm-text);padding:4px 8px;font-size:12px;outline:none';
      pathInput.readOnly = true;
      const newFolderBtn = mkBtn('+ Folder');
      const newFileBtn   = mkBtn('+ File');
      const importBtn    = mkBtn('⬆ Import', 'Import from your computer');
      importBtn.style.cssText += ';background:rgba(0,120,212,0.2);border-color:rgba(0,120,212,0.4);color:#66aaff';
      const refreshBtn   = mkBtn('⟳', 'Refresh');
      const fileInput    = document.createElement('input');
      fileInput.type = 'file'; fileInput.multiple = true; fileInput.style.display = 'none';

      [backBtn, upBtn, pathInput, newFolderBtn, newFileBtn, importBtn, refreshBtn, fileInput].forEach(el => toolbar.appendChild(el));
      container.appendChild(toolbar);

      // ── Layout ────────────────────────────────────────────────────────────────
      const layout = document.createElement('div');
      layout.style.cssText = 'display:flex;flex:1;overflow:hidden';
      container.appendChild(layout);

      // Sidebar
      const sidebar = document.createElement('div');
      sidebar.style.cssText = 'width:160px;background:rgba(0,0,0,0.15);border-right:1px solid var(--wm-border);padding:8px;overflow-y:auto;flex-shrink:0';
      layout.appendChild(sidebar);

      const SIDEBAR_ITEMS = [
        { label: '🏠 Home',       path: '/' },
        { label: '🖥️ Desktop',    path: '/Desktop' },
        { label: '📄 Documents',  path: '/Documents' },
        { label: '🖼️ Pictures',   path: '/Pictures' },
        { label: '⬇️ Downloads',  path: '/Downloads' },
        { label: '🎵 Music',      path: '/Music' },
        { label: '⚡ Apps',       path: '/Apps' },
      ];

      function renderSidebar() {
        sidebar.innerHTML = '';
        SIDEBAR_ITEMS.forEach(item => {
          const el = document.createElement('div');
          el.style.cssText = 'padding:7px 8px;border-radius:4px;cursor:pointer;font-size:13px;transition:background 0.1s;' +
            (cwd === item.path ? 'background:rgba(0,120,212,0.2);color:var(--wm-accent)' : 'color:var(--wm-text)');
          el.textContent = item.label;
          el.onmouseenter = () => { if (cwd !== item.path) el.style.background = 'rgba(255,255,255,0.06)'; };
          el.onmouseleave = () => { if (cwd !== item.path) el.style.background = ''; };
          el.onclick = () => navigate(item.path);
          sidebar.appendChild(el);
        });
      }

      // Main area
      const mainArea = document.createElement('div');
      mainArea.style.cssText = 'flex:1;overflow:auto;display:flex;flex-direction:column;position:relative';
      layout.appendChild(mainArea);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:4px;padding:8px;align-content:start';
      mainArea.appendChild(grid);

      // Status bar
      const statusBar = document.createElement('div');
      statusBar.style.cssText = 'padding:4px 8px;font-size:11px;color:var(--wm-text-dim);border-top:1px solid var(--wm-border);background:rgba(0,0,0,0.15);flex-shrink:0';
      container.appendChild(statusBar);

      // ── Helpers ───────────────────────────────────────────────────────────────

      function fileIcon(name, type) {
        if (type === 'dir') return '📁';
        const ext = name.split('.').pop().toLowerCase();
        const map = { txt:'📄', md:'📄', js:'📜', html:'🌐', css:'🎨', json:'📋', png:'🖼️', jpg:'🖼️', jpeg:'🖼️', gif:'🖼️', mp3:'🎵', pdf:'📕', beep:'⚡' };
        return map[ext] || '📄';
      }

      function fullPath(name) { return (cwd === '/' ? '' : cwd) + '/' + name; }

      function navigate(path) {
        cwd = path;
        histIdx = history.length;
        history.push(path);
        render();
      }

      // ── Render ────────────────────────────────────────────────────────────────

      async function render() {
        pathInput.value = cwd;
        selected = null;
        grid.innerHTML = '';
        renderSidebar();

        // Special case: /Apps shows all installed apps from DB + native system apps
        if (cwd === '/Apps') {
          await renderAppsDir();
          return;
        }

        const items = await fs.ls(cwd);
        if (!items) { grid.innerHTML = '<div style="padding:16px;color:var(--wm-text-dim)">Cannot read directory</div>'; return; }
        statusBar.textContent = items.length + ' item' + (items.length !== 1 ? 's' : '');

        items.forEach(item => {
          const el = document.createElement('div');
          el.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:8px 4px;border-radius:6px;cursor:pointer;text-align:center;transition:background 0.1s;font-size:11px;width:80px;height:90px;overflow:hidden;flex-shrink:0';

          // Get beep app icon/name from DB
          let iconHtml = '<span style="font-size:30px">' + fileIcon(item.name, item.type) + '</span>';
          let label = item.name;

          if (item.name.endsWith('.beep')) {
            db.apps.get(item.name.replace(/\.beep$/, '')).then(app => {
              if (app) {
                const iconEl = el.querySelector('.fm-icon');
                const labelEl = el.querySelector('.fm-label');
                if (iconEl) {
                  if (app.icon && app.icon.startsWith('data:')) {
                    iconEl.innerHTML = '<img src="' + app.icon + '" style="width:30px;height:30px;border-radius:4px;object-fit:cover">';
                  } else {
                    iconEl.textContent = app.emoji || '⚡';
                  }
                }
                if (labelEl) labelEl.textContent = app.name;
              }
            });
          }

          el.innerHTML = '<span class="fm-icon" style="font-size:30px;display:block">' + fileIcon(item.name, item.type) + '</span>' +
            '<span class="fm-label" style="margin-top:4px;word-break:break-word;color:var(--wm-text);font-size:11px;line-height:1.2;max-height:2.4em;overflow:hidden">' + label + '</span>';

          el.onclick = e => {
            grid.querySelectorAll('[data-selected]').forEach(s => { s.style.background = ''; s.removeAttribute('data-selected'); });
            el.style.background = 'rgba(0,120,212,0.2)';
            el.setAttribute('data-selected', '1');
            selected = item.name;
            statusBar.textContent = item.name;
            e.stopPropagation();
          };

          el.ondblclick = () => {
            if (item.type === 'dir') navigate(fullPath(item.name));
            else openFile(fullPath(item.name), item.name);
          };

          el.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); showItemMenu(e.clientX, e.clientY, item); };

          // ── Drag from FM to desktop ─────────────────────────────────────────
          let dragStartX, dragStartY, didDrag = false;

          el.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            didDrag = false;
            dragStartX = e.clientX; dragStartY = e.clientY;

            const onMove = e2 => {
              if (!didDrag && Math.abs(e2.clientX - dragStartX) < 6 && Math.abs(e2.clientY - dragStartY) < 6) return;
              if (!didDrag) {
                didDrag = true;
                // Start OS-level drag — pointer events on iframes disabled, parent handles mouse
                wm.startDrag(instanceId, fullPath(item.name), item.name, fileIcon(item.name, item.type));
              }
            };

            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              // endDrag is handled by WM's own mouseup listener
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });

          // ── Drop target (folder) ────────────────────────────────────────────
          if (item.type === 'dir') {
            el.addEventListener('dragover', e => { e.preventDefault(); el.style.outline = '2px solid var(--wm-accent)'; el.style.background = 'rgba(0,120,212,0.2)'; });
            el.addEventListener('dragleave', () => { el.style.outline = ''; el.style.background = ''; });
            el.addEventListener('drop', async e => {
              e.preventDefault(); el.style.outline = ''; el.style.background = '';
              const srcPath = e.dataTransfer.getData('text/plain');
              if (!srcPath || srcPath === fullPath(item.name)) return;
              const filename = srcPath.split('/').pop();
              await fs.move(srcPath, fullPath(item.name) + '/' + filename);
              render();
              wm.notify('Moved "' + filename + '" into "' + item.name + '"');
            });
          }

          grid.appendChild(el);
        });

        // Blank area context menu
        mainArea.oncontextmenu = e => {
          if (e.target.closest('[data-selected]')) return;
          e.preventDefault();
          showBlankMenu(e.clientX, e.clientY);
        };

        // Deselect on blank click
        grid.onclick = e => {
          if (!e.target.closest('[data-selected]')) {
            grid.querySelectorAll('[data-selected]').forEach(s => { s.style.background = ''; s.removeAttribute('data-selected'); });
            selected = null;
          }
        };

        // Drop zone for host OS files and desktop drag
        mainArea.classList.add('bos-fm-dropzone');
        mainArea.addEventListener('dragover', e => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          mainArea.style.outline = '2px dashed var(--wm-accent)';
          mainArea.style.background = 'rgba(0,120,212,0.05)';
        });
        mainArea.addEventListener('dragleave', () => { mainArea.style.outline = ''; mainArea.style.background = ''; });
        mainArea.addEventListener('drop', async e => {
          e.preventDefault();
          mainArea.style.outline = ''; mainArea.style.background = '';
          const files = Array.from(e.dataTransfer.files);
          if (!files.length) return;
          statusBar.textContent = 'Importing ' + files.length + ' file(s)...';
          let done = 0;
          files.forEach(file => {
            const reader = new FileReader();
            const isText = file.type.startsWith('text/') || /\.(txt|md|js|json|html|css|csv|xml|svg|beep)$/i.test(file.name);
            reader.onload = async e2 => {
              await fs.write(fullPath(file.name), e2.target.result);
              done++;
              if (done === files.length) { render(); statusBar.textContent = 'Imported ' + done + ' file(s)'; }
            };
            if (isText) reader.readAsText(file); else reader.readAsDataURL(file);
          });
        });

        // Listen for drops from desktop via OS event
        document.addEventListener('bos:dropOnFM', async e => {
          if (!container.isConnected) { document.removeEventListener('bos:dropOnFM', arguments.callee); return; }
          const { path } = e.detail;
          if (!path) return;
          const filename = path.split('/').pop();
          const destPath = fullPath(filename);
          if (path === destPath) return;
          await fs.move(path, destPath);
          render();
          wm.notify('Moved "' + filename + '" to ' + cwd);
        });
      }

      // ── /Apps virtual directory ───────────────────────────────────────────────

      async function renderAppsDir() {
        const allApps = await db.apps.all();
        const nativeApps = [];
        for (const [id, sys] of wm._systemApps) {
          nativeApps.push({ id, name: sys.title, emoji: sys.icon, icon: null, native: true });
        }

        const combined = [
          ...nativeApps,
          ...allApps.filter(a => !nativeApps.find(n => n.id === a.id)),
        ].sort((a, b) => a.name.localeCompare(b.name));

        statusBar.textContent = combined.length + ' app' + (combined.length !== 1 ? 's' : '') + ' installed';

        if (!combined.length) {
          grid.innerHTML = '<div style="padding:16px;color:var(--wm-text-dim)">No apps installed</div>';
          return;
        }

        combined.forEach(app => {
          const el = document.createElement('div');
          el.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:8px 4px;border-radius:6px;cursor:pointer;text-align:center;transition:background 0.1s;font-size:11px;width:80px;height:90px;overflow:hidden;flex-shrink:0';

          const iconEl = document.createElement('div');
          iconEl.style.cssText = 'font-size:30px;display:flex;align-items:center;justify-content:center;width:100%';
          if (app.icon && app.icon.startsWith('data:')) {
            iconEl.innerHTML = '<img src="' + app.icon + '" style="width:30px;height:30px;border-radius:4px;object-fit:cover">';
          } else {
            iconEl.textContent = app.emoji || '⚡';
          }

          const labelEl = document.createElement('div');
          labelEl.style.cssText = 'margin-top:4px;word-break:break-word;color:var(--wm-text);font-size:11px;line-height:1.2;max-height:2.4em;overflow:hidden';
          labelEl.textContent = app.name;

          el.appendChild(iconEl);
          el.appendChild(labelEl);

          el.onmouseenter = () => el.style.background = 'rgba(255,255,255,0.08)';
          el.onmouseleave = () => { if (!el.hasAttribute('data-selected')) el.style.background = ''; };
          el.onclick = e => {
            grid.querySelectorAll('[data-selected]').forEach(s => { s.style.background = ''; s.removeAttribute('data-selected'); });
            el.style.background = 'rgba(0,120,212,0.2)';
            el.setAttribute('data-selected', '1');
            statusBar.textContent = app.name + (app.native ? ' (native)' : ' v' + (app.version || '?'));
            e.stopPropagation();
          };
          el.ondblclick = () => {
            if (app.native) wm.openSystemApp(app.id);
            else launcher.launchById(app.id);
          };

          grid.appendChild(el);
        });

        grid.onclick = e => {
          if (!e.target.closest('[data-selected]')) {
            grid.querySelectorAll('[data-selected]').forEach(s => { s.style.background = ''; s.removeAttribute('data-selected'); });
          }
        };
      }

      // ── File opening ──────────────────────────────────────────────────────────

      async function openFile(path, name) {
        const ext = name.split('.').pop().toLowerCase();
        if (name.endsWith('.beep')) {
          await launcher.launch(path);
        } else if (['txt','md','js','json','html','css'].includes(ext)) {
          wm.openSystemApp('texteditor', { file: path });
        } else if (['mp3','wav','ogg'].includes(ext)) {
          wm.openSystemApp('musicplayer', { file: path });
        } else if (['png','jpg','jpeg','gif','webp'].includes(ext)) {
          wm.notify('Image viewer coming soon');
        } else {
          wm.notify('No app to open: ' + name);
        }
      }

      // ── Context menus ─────────────────────────────────────────────────────────

      function showItemMenu(x, y, item) {
        const ext = item.name.split('.').pop().toLowerCase();
        const isImage = ['png','jpg','jpeg','gif','webp'].includes(ext);
        const items = [
          { label: '📂 Open', action: () => {
            if (item.type === 'dir') navigate(fullPath(item.name));
            else openFile(fullPath(item.name), item.name);
          }},
        ];
        if (isImage) {
          items.push({ label: '🎨 Open in Paint', action: () => launcher.launchById('paint') });
        }
        items.push('sep');
        items.push(
          { label: '✂️ Cut', action: () => {
            clipboard = { op: 'cut', path: fullPath(item.name), name: item.name };
            statusBar.textContent = 'Cut: ' + item.name;
          }},
          { label: '📋 Copy', action: () => {
            clipboard = { op: 'copy', path: fullPath(item.name), name: item.name };
            statusBar.textContent = 'Copied: ' + item.name;
          }},
          'sep',
          { label: '✏️ Rename', action: async () => {
            const nn = prompt('New name:', item.name);
            if (nn && nn !== item.name) { await fs.rename(fullPath(item.name), nn); render(); }
          }},
          { label: '🗑️ Delete', action: async () => {
            if (!confirm('Delete "' + item.name + '"?')) return;
            const res = await fs.rm(fullPath(item.name));
            if (res.ok) render(); else wm.notify('Delete failed: ' + res.error);
          }}
        );
        showMenu(x, y, items);
      }

      function showBlankMenu(x, y) {
        const items = [
          { label: '📁 New Folder', action: async () => {
            const name = prompt('Folder name:');
            if (name) { await fs.mkdir(fullPath(name)); render(); }
          }},
          { label: '📄 New File', action: async () => {
            const name = prompt('File name:', 'untitled.txt');
            if (name) { await fs.write(fullPath(name), ''); render(); }
          }},
          'sep',
        ];
        if (clipboard) {
          items.push({ label: '📋 Paste "' + clipboard.name + '"', action: async () => {
            const destPath = fullPath(clipboard.name);
            const content = await fs.read(clipboard.path);
            if (content !== null) await fs.write(destPath, content);
            if (clipboard.op === 'cut') await fs.rm(clipboard.path);
            clipboard = null; render();
          }});
          items.push('sep');
        }
        items.push({ label: '⟳ Refresh', action: render });
        showMenu(x, y, items);
      }

      function showMenu(x, y, items) {
        document.getElementById('bos-ctx-menu')?.remove();
        const menu = document.createElement('div');
        menu.id = 'bos-ctx-menu';
        menu.style.cssText = 'position:fixed;left:' + Math.min(x, window.innerWidth - 200) + 'px;' +
          'top:' + Math.min(y, window.innerHeight - items.length * 34) + 'px;' +
          'background:rgba(20,20,40,0.97);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.12);' +
          'border-radius:8px;padding:4px;z-index:99999;min-width:180px;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
        items.forEach(item => {
          if (item === 'sep') {
            const s = document.createElement('div'); s.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin:4px 0'; menu.appendChild(s);
          } else {
            const el = document.createElement('div');
            el.style.cssText = 'padding:7px 14px;border-radius:4px;font-size:13px;cursor:pointer;color:var(--wm-text)';
            el.textContent = item.label;
            el.onmouseenter = () => el.style.background = 'rgba(255,255,255,0.1)';
            el.onmouseleave = () => el.style.background = '';
            el.onclick = () => { item.action(); menu.remove(); };
            menu.appendChild(el);
          }
        });
        document.body.appendChild(menu);
        setTimeout(() => {
          const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }};
          document.addEventListener('click', close);
        }, 0);
      }

      // ── Toolbar actions ───────────────────────────────────────────────────────

      backBtn.onclick = () => { if (histIdx > 0) { histIdx--; cwd = history[histIdx]; render(); }};
      upBtn.onclick   = () => {
        if (cwd === '/') return;
        const parts = cwd.split('/').filter(Boolean); parts.pop();
        navigate('/' + parts.join('/') || '/');
      };
      newFolderBtn.onclick = async () => { const n = prompt('Folder name:'); if (n) { await fs.mkdir(fullPath(n)); render(); }};
      newFileBtn.onclick   = async () => { const n = prompt('File name:', 'untitled.txt'); if (n) { await fs.write(fullPath(n), ''); render(); }};
      refreshBtn.onclick   = render;
      importBtn.onclick    = () => fileInput.click();

      fileInput.onchange = async () => {
        const files = Array.from(fileInput.files);
        if (!files.length) return;
        statusBar.textContent = 'Importing ' + files.length + ' file(s)...';
        let done = 0;
        files.forEach(file => {
          const reader = new FileReader();
          const isText = file.type.startsWith('text/') || /\.(txt|md|js|json|html|css|csv|xml|svg|beep)$/i.test(file.name);
          reader.onload = async e => {
            await fs.write(fullPath(file.name), e.target.result);
            done++;
            if (done === files.length) { render(); statusBar.textContent = 'Imported ' + done + ' file(s)'; }
          };
          if (isText) reader.readAsText(file); else reader.readAsDataURL(file);
        });
        fileInput.value = '';
      };

      render();
    }
  });
}
