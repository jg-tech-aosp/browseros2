/**
 * BrowserOS v2 — Text Editor (Native System Component)
 * src/shell/texteditor.js
 */

export function registerTextEditor({ wm, fs }) {

  wm.registerSystemApp('texteditor', {
    title:  'Text Editor',
    icon:   '📝',
    width:  680,
    height: 520,
    mount(container, instanceId, args) {
      let currentPath = null;
      let saved = true;

      container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--wm-bg);color:var(--wm-text)';

      // ── Toolbar ─────────────────────────────────────────────────────────────
      const toolbar = document.createElement('div');
      toolbar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(0,0,0,0.2);border-bottom:1px solid var(--wm-border);flex-shrink:0;flex-wrap:wrap';

      function mkBtn(label, title) {
        const b = document.createElement('button');
        b.textContent = label; b.title = title || label;
        b.style.cssText = 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:var(--wm-text);padding:4px 10px;font-size:12px;cursor:pointer;transition:background 0.1s';
        b.onmouseenter = () => b.style.background = 'rgba(255,255,255,0.15)';
        b.onmouseleave = () => b.style.background = 'rgba(255,255,255,0.07)';
        return b;
      }

      const newBtn    = mkBtn('New');
      const openBtn   = mkBtn('Open');
      const saveBtn   = mkBtn('Save');
      const saveAsBtn = mkBtn('Save As');
      const filenameEl = document.createElement('span');
      filenameEl.style.cssText = 'font-size:12px;color:var(--wm-text-dim);margin-left:8px;flex:1';
      filenameEl.textContent = 'Untitled.txt';

      [newBtn, openBtn, saveBtn, saveAsBtn, filenameEl].forEach(el => toolbar.appendChild(el));
      container.appendChild(toolbar);

      // ── Editor ───────────────────────────────────────────────────────────────
      const ta = document.createElement('textarea');
      ta.style.cssText = 'flex:1;background:transparent;border:none;color:var(--wm-text);padding:14px;font-family:monospace;font-size:13px;resize:none;outline:none;line-height:1.6;min-height:0';
      ta.spellcheck = true;
      container.appendChild(ta);

      // ── Status bar ────────────────────────────────────────────────────────────
      const status = document.createElement('div');
      status.style.cssText = 'padding:3px 10px;font-size:11px;color:var(--wm-text-dim);background:rgba(0,0,0,0.2);border-top:1px solid var(--wm-border);flex-shrink:0;display:flex;gap:16px';
      container.appendChild(status);

      // ── Helpers ───────────────────────────────────────────────────────────────

      function updateStatus() {
        const lines = ta.value.substring(0, ta.selectionStart).split('\n');
        const ln  = lines.length;
        const col = lines[lines.length - 1].length + 1;
        const words = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
        status.textContent = (saved ? 'Saved' : 'Modified') + ' • Ln ' + ln + ', Col ' + col + ' • ' + words + ' words';
      }

      function setFile(path, content) {
        currentPath = path;
        ta.value = content;
        saved = true;
        filenameEl.textContent = path.split('/').pop();
        wm.setWindowTitle(instanceId, '📝 ' + path.split('/').pop());
        updateStatus();
      }

      async function save(path) {
        if (!path) { await saveAs(); return; }
        await fs.write(path, ta.value);
        currentPath = path;
        saved = true;
        filenameEl.textContent = path.split('/').pop();
        wm.setWindowTitle(instanceId, '📝 ' + path.split('/').pop());
        updateStatus();
        wm.notify('Saved: ' + path.split('/').pop());
      }

      async function saveAs() {
        const name = prompt('Save as:', filenameEl.textContent || 'untitled.txt');
        if (!name) return;
        await save('/Documents/' + name);
      }

      // ── Events ────────────────────────────────────────────────────────────────

      ta.addEventListener('input', () => { saved = false; updateStatus(); });
      ta.addEventListener('keyup', updateStatus);
      ta.addEventListener('click', updateStatus);

      newBtn.onclick = () => {
        if (!saved && !confirm('Discard unsaved changes?')) return;
        ta.value = ''; currentPath = null; saved = true;
        filenameEl.textContent = 'Untitled.txt';
        wm.setWindowTitle(instanceId, '📝 Text Editor');
        updateStatus();
      };

      openBtn.onclick = async () => {
        const path = prompt('Open file path:', '/Documents/');
        if (!path) return;
        const content = await fs.read(path);
        if (content === null) { wm.notify('File not found: ' + path); return; }
        setFile(path, content);
      };

      saveBtn.onclick   = () => save(currentPath);
      saveAsBtn.onclick = saveAs;

      // Ctrl+S
      container.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key === 's') { e.preventDefault(); save(currentPath); }
      });

      // ── Auto-open file from args ──────────────────────────────────────────────

      if (args?.file) {
        fs.read(args.file).then(content => {
          if (content === null) { wm.notify('File not found: ' + args.file); return; }
          setFile(args.file, content);
          ta.focus();
        });
      } else {
        updateStatus();
        ta.focus();
      }
    }
  });
}
