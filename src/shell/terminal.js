/**
 * BrowserOS v2 — Terminal (Native System Component)
 * src/shell/terminal.js
 */

export function registerTerminal({ wm, fs, launcher, kernel, settings }) {

  wm.registerSystemApp('terminal', {
    title:  'Terminal',
    icon:   '⌨️',
    width:  640,
    height: 420,
    mount(container, instanceId, args) {
      let cwd = args?.path || '/';
      const history = [];
      let histPos = -1;

      container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#0a0a14';

      // Output
      const out = document.createElement('div');
      out.style.cssText = 'flex:1;overflow-y:auto;padding:10px;font-family:monospace;font-size:13px;line-height:1.6;min-height:0';
      container.appendChild(out);

      // Input row
      const inputRow = document.createElement('div');
      inputRow.style.cssText = 'display:flex;align-items:center;padding:6px 10px;border-top:1px solid rgba(255,255,255,0.05);background:#0a0a14;flex-shrink:0;gap:6px';

      const promptEl = document.createElement('span');
      promptEl.style.cssText = 'color:#44ff88;font-family:monospace;font-size:13px;white-space:nowrap';

      const inp = document.createElement('input');
      inp.style.cssText = 'flex:1;background:transparent;border:none;color:#aaffaa;font-family:monospace;font-size:13px;outline:none';
      inp.autocomplete = 'off';
      inp.spellcheck   = false;

      inputRow.appendChild(promptEl);
      inputRow.appendChild(inp);
      container.appendChild(inputRow);

      // ── Helpers ───────────────────────────────────────────────────────────────

      function updatePrompt() {
        promptEl.textContent = 'root@bos:' + (cwd || '/') + ' $ ';
      }

      function print(text, color) {
        const line = document.createElement('div');
        line.style.color = color || '#aaffaa';
        line.style.fontFamily = 'monospace';
        line.style.fontSize = '13px';
        line.style.whiteSpace = 'pre-wrap';
        line.style.wordBreak = 'break-all';
        line.textContent = text;
        out.appendChild(line);
        out.scrollTop = out.scrollHeight;
      }

      function printHTML(html) {
        const line = document.createElement('div');
        line.style.fontFamily = 'monospace';
        line.style.fontSize = '13px';
        line.innerHTML = html;
        out.appendChild(line);
        out.scrollTop = out.scrollHeight;
      }

      function resolvePath(p) {
        if (!p || p === '~') return '/';
        if (p.startsWith('/')) return p;
        if (p === '..') {
          const parts = cwd.split('/').filter(Boolean);
          parts.pop();
          return '/' + parts.join('/') || '/';
        }
        if (p.startsWith('../')) {
          const parts = cwd.split('/').filter(Boolean);
          parts.pop();
          return resolvePath('/' + parts.join('/') + '/' + p.slice(3));
        }
        return (cwd.replace(/\/$/, '') + '/' + p).replace('//', '/');
      }

      // ── Commands ──────────────────────────────────────────────────────────────

      const CMDS = {
        help(args) {
          print('BrowserOS Terminal — Available commands:');
          print('');
          print('File system:');
          print('  ls [path]          List directory contents');
          print('  cd [path]          Change directory');
          print('  pwd                Print working directory');
          print('  mkdir <name>       Create directory');
          print('  touch <name>       Create empty file');
          print('  rm <path>          Remove file or empty directory');
          print('  cat <path>         Print file contents');
          print('  cp <src> <dst>     Copy file');
          print('  mv <src> <dst>     Move/rename file');
          print('  find [path]        List all files recursively');
          print('  wc <path>          Word/line/char count');
          print('  stat <path>        File info');
          print('  tree [path]        Directory tree');
          print('');
          print('Apps:');
          print('  open <appId>       Open a system app');
          print('  launch <path>      Launch a .beep app');
          print('  apps               List installed apps');
          print('');
          print('System:');
          print('  echo <text>        Print text');
          print('  clear              Clear terminal');
          print('  date               Print current date/time');
          print('  whoami             Print current user');
          print('  uname [-a]         System info');
          print('  version            BrowserOS version');
          print('  history            Command history');
          print('  exit               Close terminal');
        },

        async ls(args) {
          const path = args[0] ? resolvePath(args[0]) : cwd;
          const items = await fs.ls(path);
          if (!items) { print('ls: cannot access "' + path + '": No such directory', '#ff8888'); return; }
          if (items.length === 0) { print('(empty)', '#8888aa'); return; }
          const dirs  = items.filter(i => i.type === 'dir').map(i => i.name + '/');
          const files = items.filter(i => i.type !== 'dir').map(i => i.name);
          // Color dirs blue, files green
          const parts = [
            ...dirs.map(d => `<span style="color:#66aaff">${d}</span>`),
            ...files.map(f => `<span style="color:#aaffaa">${f}</span>`),
          ];
          printHTML(parts.join('  '));
        },

        async cd(args) {
          const p = resolvePath(args[0] || '~');
          const stat = await fs.stat(p);
          if (!stat || stat.type !== 'dir') { print('cd: not a directory: ' + (args[0] || '~'), '#ff8888'); return; }
          cwd = p;
          updatePrompt();
        },

        pwd() { print(cwd); },

        async mkdir(args) {
          if (!args[0]) { print('mkdir: missing operand', '#ff8888'); return; }
          const res = await fs.mkdir(resolvePath(args[0]));
          if (!res?.ok) print('mkdir: failed', '#ff8888');
        },

        async touch(args) {
          if (!args[0]) { print('touch: missing operand', '#ff8888'); return; }
          await fs.write(resolvePath(args[0]), '');
        },

        async rm(args) {
          if (!args[0]) { print('rm: missing operand', '#ff8888'); return; }
          const res = await fs.rm(resolvePath(args[0]));
          if (res?.error) print('rm: ' + res.error, '#ff8888');
        },

        async cat(args) {
          if (!args[0]) { print('cat: missing operand', '#ff8888'); return; }
          const content = await fs.read(resolvePath(args[0]));
          if (content === null) { print('cat: ' + args[0] + ': No such file', '#ff8888'); return; }
          if (content.startsWith('data:')) { print('[binary file]', '#8888aa'); return; }
          content.split('\n').forEach(l => print(l));
        },

        echo(args) { print(args.join(' ')); },

        clear() { out.innerHTML = ''; },

        date() { print(new Date().toString()); },

        whoami() { print('root'); },

        uname(args) {
          print(args[0] === '-a' ? 'BrowserOS 2.0.0 (HTML5/IndexedDB) x86_64' : 'BrowserOS');
        },

        version() {
          print('BrowserOS v2.0.0');
          print('BOS API: 2.0');
          print('Engine: HTML5 / ES Modules / IndexedDB');
        },

        async cp(args) {
          if (args.length < 2) { print('cp: missing operand', '#ff8888'); return; }
          const content = await fs.read(resolvePath(args[0]));
          if (content === null) { print('cp: source not found', '#ff8888'); return; }
          await fs.write(resolvePath(args[1]), content);
          print('Copied ' + args[0] + ' → ' + args[1]);
        },

        async mv(args) {
          if (args.length < 2) { print('mv: missing operand', '#ff8888'); return; }
          const res = await fs.move(resolvePath(args[0]), resolvePath(args[1]));
          if (res?.error) print('mv: ' + res.error, '#ff8888');
          else print('Moved ' + args[0] + ' → ' + args[1]);
        },

        async wc(args) {
          if (!args[0]) { print('wc: missing operand', '#ff8888'); return; }
          const content = await fs.read(resolvePath(args[0]));
          if (content === null) { print('wc: cannot read: ' + args[0], '#ff8888'); return; }
          const lines = content.split('\n').length;
          const words = content.trim().split(/\s+/).filter(Boolean).length;
          print(lines + '\t' + words + '\t' + content.length + '\t' + args[0]);
        },

        async stat(args) {
          if (!args[0]) { print('stat: missing operand', '#ff8888'); return; }
          const s = await fs.stat(resolvePath(args[0]));
          if (!s) { print('stat: no such file: ' + args[0], '#ff8888'); return; }
          print('  File: ' + resolvePath(args[0]));
          print('  Type: ' + s.type);
          print('  Size: ' + (s.size || 0) + ' bytes');
          if (s.modified) print('  Modified: ' + new Date(s.modified).toLocaleString());
          if (s.mime) print('  MIME: ' + s.mime);
        },

        async find(args) {
          const base = resolvePath(args[0] || '/');
          async function walk(path) {
            print(path);
            const items = await fs.ls(path);
            if (!items) return;
            for (const item of items) {
              await walk((path === '/' ? '' : path) + '/' + item.name);
            }
          }
          await walk(base);
        },

        async tree(args) {
          const base = resolvePath(args[0] || cwd);
          async function walk(path, prefix) {
            const items = await fs.ls(path);
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
              const last = i === items.length - 1;
              const item = items[i];
              const connector = last ? '└── ' : '├── ';
              const color = item.type === 'dir' ? '#66aaff' : '#aaffaa';
              printHTML(prefix + connector + `<span style="color:${color}">${item.name}${item.type === 'dir' ? '/' : ''}</span>`);
              if (item.type === 'dir') {
                await walk((path === '/' ? '' : path) + '/' + item.name, prefix + (last ? '    ' : '│   '));
              }
            }
          }
          print(base, '#66aaff');
          await walk(base, '');
        },

        open(args) {
          if (!args[0]) { print('open: missing app id', '#ff8888'); return; }
          wm.openSystemApp(args[0]);
        },

        async launch(args) {
          if (!args[0]) { print('launch: missing path', '#ff8888'); return; }
          try {
            await launcher.launch(resolvePath(args[0]));
          } catch(e) { print('launch: ' + e.message, '#ff8888'); }
        },

        async apps() {
          // Native system apps
          print('Native system apps:', '#8888aa');
          for (const [id, app] of wm._systemApps) {
            print('  ' + app.icon + ' ' + id + ' — ' + app.title);
          }
          print('');
          // Installed .beep apps
          const installed = await kernel.registry ? [] : [];
          // Use DB directly via launcher
          print('Installed .beep apps:', '#8888aa');
          // We don't have direct DB access here — show what we know
          print('  (use File Manager → /Apps to see installed .beep files)');
        },

        history() {
          if (!history.length) { print('(no history)', '#8888aa'); return; }
          history.forEach((cmd, i) => print('  ' + (i + 1) + '  ' + cmd));
        },

        exit() {
          wm.close(instanceId);
        },
      };

      // ── Input handler ─────────────────────────────────────────────────────────

      inp.addEventListener('keydown', async e => {
        if (e.key === 'Enter') {
          const raw = inp.value.trim();
          if (!raw) return;
          history.unshift(raw); histPos = -1;
          print(promptEl.textContent + raw, '#888899');
          inp.value = '';

          const parts = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
          const cmd = parts[0];
          const cmdArgs = parts.slice(1).map(a => a.replace(/^["']|["']$/g, ''));

          if (CMDS[cmd]) {
            try { await CMDS[cmd](cmdArgs); }
            catch(err) { print('Error: ' + err.message, '#ff8888'); }
          } else if (cmd) {
            print(cmd + ': command not found. Type "help" for available commands.', '#ff8888');
          }
        }
        else if (e.key === 'ArrowUp') {
          histPos = Math.min(histPos + 1, history.length - 1);
          inp.value = history[histPos] || '';
          e.preventDefault();
        }
        else if (e.key === 'ArrowDown') {
          histPos = Math.max(histPos - 1, -1);
          inp.value = histPos >= 0 ? history[histPos] : '';
          e.preventDefault();
        }
        else if (e.key === 'Tab') {
          e.preventDefault();
          const val   = inp.value;
          const parts = val.split(/\s+/);
          const last  = parts[parts.length - 1];
          const dir   = last.includes('/') ? resolvePath(last.substring(0, last.lastIndexOf('/') + 1)) : cwd;
          const prefix = last.includes('/') ? last.substring(last.lastIndexOf('/') + 1) : last;
          const items  = await fs.ls(dir) || [];
          const matches = items.filter(i => i.name.startsWith(prefix));
          if (matches.length === 1) {
            parts[parts.length - 1] = (last.includes('/') ? last.substring(0, last.lastIndexOf('/') + 1) : '') +
              matches[0].name + (matches[0].type === 'dir' ? '/' : '');
            inp.value = parts.join(' ');
          } else if (matches.length > 1) {
            print(matches.map(m => m.name + (m.type === 'dir' ? '/' : '')).join('  '));
          }
        }
        else if (e.key === 'l' && e.ctrlKey) {
          e.preventDefault();
          out.innerHTML = '';
        }
        else if (e.key === 'c' && e.ctrlKey) {
          e.preventDefault();
          print(promptEl.textContent + inp.value + '^C', '#888899');
          inp.value = '';
        }
      });

      container.addEventListener('click', () => inp.focus());

      // ── Boot message ──────────────────────────────────────────────────────────

      print('BrowserOS Terminal v2.0', '#66aaff');
      print('Type "help" for available commands. Ctrl+L to clear.', '#8888aa');
      print('');
      updatePrompt();
      inp.focus();

      // Start in specific path if launched with one
      if (args?.path) {
        fs.stat(args.path).then(stat => {
          if (stat && stat.type === 'dir') {
            cwd = args.path;
            updatePrompt();
          }
        });
      }
    }
  });
}
