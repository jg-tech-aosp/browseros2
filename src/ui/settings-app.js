/**
 * BrowserOS v2 — Settings App
 * src/ui/settings-app.js
 *
 * Native system app — not a .beep.
 * Registered with the WM via wm.registerSystemApp('settings', ...).
 * Has direct access to the Settings store and kernel for live changes.
 */

export function registerSettingsApp({ wm, settings, kernel, db }) {

  wm.registerSystemApp('settings', {
    title:  'Settings',
    icon:   '⚙️',
    width:  720,
    height: 520,
    mount(container, instanceId) {
      container.style.cssText = 'display:flex;height:100%;overflow:hidden;background:var(--wm-bg);color:var(--wm-text)';

      // ── Sidebar ─────────────────────────────────────────────────────────────
      var sidebar = document.createElement('div');
      sidebar.style.cssText = 'width:200px;background:rgba(0,0,0,0.2);border-right:1px solid var(--wm-border);padding:8px;flex-shrink:0;overflow-y:auto';

      var SECTIONS = [
        { id:'appearance', label:'🎨 Appearance' },
        { id:'display',    label:'🖥️ Display' },
        { id:'apps',       label:'📦 Apps' },
        { id:'storage',    label:'💾 Storage' },
        { id:'system',     label:'⚙️ System' },
      ];

      var main = document.createElement('div');
      main.style.cssText = 'flex:1;overflow-y:auto;padding:24px';

      SECTIONS.forEach(function(sec) {
        var btn = document.createElement('div');
        btn.style.cssText = 'padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;margin-bottom:2px;transition:background 0.1s';
        btn.textContent = sec.label;
        btn.onclick = function() {
          sidebar.querySelectorAll('[data-active]').forEach(function(b) {
            b.removeAttribute('data-active');
            b.style.background = '';
            b.style.color = 'var(--wm-text)';
          });
          btn.setAttribute('data-active', '1');
          btn.style.background = 'rgba(0,120,212,0.25)';
          btn.style.color = 'var(--wm-accent)';
          renderSection(sec.id, main);
        };
        btn.onmouseenter = function() { if (!btn.hasAttribute('data-active')) btn.style.background = 'rgba(255,255,255,0.06)'; };
        btn.onmouseleave = function() { if (!btn.hasAttribute('data-active')) btn.style.background = ''; };
        sidebar.appendChild(btn);
      });

      container.appendChild(sidebar);
      container.appendChild(main);

      // Activate first section
      sidebar.firstChild.click();
    }
  });

  // ── Section renderers ────────────────────────────────────────────────────────

  function renderSection(id, main) {
    main.innerHTML = '';

    if (id === 'appearance') renderAppearance(main);
    else if (id === 'display')    renderDisplay(main);
    else if (id === 'apps')       renderApps(main);
    else if (id === 'storage')    renderStorage(main);
    else if (id === 'system')     renderSystem(main);
  }

  function h2(text) {
    var el = document.createElement('h2');
    el.style.cssText = 'font-size:20px;margin-bottom:20px;color:var(--wm-text)';
    el.textContent = text;
    return el;
  }

  function row(label, sub, control) {
    var el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05)';
    var left = document.createElement('div');
    var labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:14px;color:var(--wm-text)';
    labelEl.textContent = label;
    left.appendChild(labelEl);
    if (sub) {
      var subEl = document.createElement('div');
      subEl.style.cssText = 'font-size:12px;color:var(--wm-text-dim);margin-top:2px';
      subEl.textContent = sub;
      left.appendChild(subEl);
    }
    el.appendChild(left);
    if (control) el.appendChild(control);
    return el;
  }

  function toggle(value, onChange) {
    var el = document.createElement('div');
    el.style.cssText = 'width:44px;height:24px;border-radius:12px;position:relative;cursor:pointer;transition:background 0.2s;background:' + (value ? 'var(--wm-accent)' : '#444');
    var knob = document.createElement('div');
    knob.style.cssText = 'position:absolute;width:18px;height:18px;background:#fff;border-radius:50%;top:3px;transition:left 0.2s;left:' + (value ? '23px' : '3px');
    el.appendChild(knob);
    el.onclick = function() {
      value = !value;
      el.style.background = value ? 'var(--wm-accent)' : '#444';
      knob.style.left = value ? '23px' : '3px';
      onChange(value);
    };
    return el;
  }

  // ── Appearance ───────────────────────────────────────────────────────────────

  function renderAppearance(main) {
    main.appendChild(h2('Appearance'));

    var theme = settings.getAll();

    // Accent colors
    var accentRow = row('Accent Color', 'Used for highlights and active elements');
    var swatches = document.createElement('div');
    swatches.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;max-width:220px';
    var ACCENTS = ['#0078d4','#e81123','#107c10','#ff8c00','#8764b8','#00b294','#ca5010','#038387'];
    ACCENTS.forEach(function(c) {
      var sw = document.createElement('div');
      sw.style.cssText = 'width:28px;height:28px;border-radius:50%;background:' + c + ';cursor:pointer;border:2px solid ' + (theme.accent === c ? '#fff' : 'transparent') + ';transition:border 0.15s';
      sw.onclick = async function() {
        await settings.set('accent', c);
        document.documentElement.style.setProperty('--wm-accent', c);
        swatches.querySelectorAll('div').forEach(function(s) { s.style.borderColor = 'transparent'; });
        sw.style.borderColor = '#fff';
        kernel.broadcast('themeChanged', settings.getTheme());
      };
      swatches.appendChild(sw);
    });
    accentRow.appendChild(swatches);
    main.appendChild(accentRow);

    // Wallpapers
    var wpLabel = document.createElement('div');
    wpLabel.style.cssText = 'font-size:14px;color:var(--wm-text);margin:16px 0 10px';
    wpLabel.textContent = 'Wallpaper';
    main.appendChild(wpLabel);

    var WALLPAPERS = [
      { label:'Galaxy',   val:'linear-gradient(135deg,#0f0c29,#302b63,#24243e)' },
      { label:'Sunset',   val:'linear-gradient(135deg,#f093fb,#f5576c,#fda085)' },
      { label:'Ocean',    val:'linear-gradient(135deg,#2193b0,#6dd5ed)' },
      { label:'Forest',   val:'linear-gradient(135deg,#134e5e,#71b280)' },
      { label:'Midnight', val:'linear-gradient(135deg,#0a0a0a,#1a1a2e,#16213e)' },
      { label:'Neon',     val:'linear-gradient(135deg,#1a0533,#2d0d5e,#0d1b2a)' },
      { label:'Lava',     val:'linear-gradient(135deg,#200122,#6f0000)' },
      { label:'Arctic',   val:'linear-gradient(135deg,#b8d4e3,#d9ecf7)' },
    ];
    var wpGrid = document.createElement('div');
    wpGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px';
    WALLPAPERS.forEach(function(wp) {
      var el = document.createElement('div');
      el.style.cssText = 'border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid ' + (theme.wallpaper === wp.val ? 'var(--wm-accent)' : 'transparent') + ';transition:border 0.15s';
      el.innerHTML = '<div style="height:52px;background:' + wp.val + '"></div><div style="font-size:11px;text-align:center;padding:4px;color:var(--wm-text)">' + wp.label + '</div>';
      el.onclick = async function() {
        await settings.set('wallpaper', wp.val);
        document.body.style.background = wp.val;
        wpGrid.querySelectorAll('div[style*="border-radius"]').forEach(function(s) { s.style.borderColor = 'transparent'; });
        el.style.borderColor = 'var(--wm-accent)';
        kernel.broadcast('themeChanged', settings.getTheme());
      };
      wpGrid.appendChild(el);
    });
    main.appendChild(wpGrid);

    // Dark mode
    main.appendChild(row('Dark Mode', 'Switch between dark and light themes',
      toggle(theme.darkMode, async function(val) {
        await settings.set('darkMode', val);
        wm.applyTheme(settings.getTheme());
        kernel.broadcast('themeChanged', settings.getTheme());
      })
    ));

    // Transparency
    main.appendChild(row('Transparency', 'Frosted glass effect on taskbar and menus',
      toggle(settings.get('transparency') !== false, async function(val) {
        await settings.set('transparency', val);
        document.getElementById('wm-taskbar').style.backdropFilter = val ? 'blur(20px)' : 'none';
      })
    ));
  }

  // ── Display ──────────────────────────────────────────────────────────────────

  function renderDisplay(main) {
    main.appendChild(h2('Display'));

    var theme = settings.getAll();
    var FONTS = [
      { label:'Segoe UI',    val:"'Segoe UI', system-ui, sans-serif" },
      { label:'Arial',       val:'Arial, sans-serif' },
      { label:'Georgia',     val:'Georgia, serif' },
      { label:'Courier New', val:"'Courier New', monospace" },
      { label:'Verdana',     val:'Verdana, sans-serif' },
      { label:'Trebuchet',   val:"'Trebuchet MS', sans-serif" },
    ];

    var fontLabel = document.createElement('div');
    fontLabel.style.cssText = 'font-size:14px;color:var(--wm-text);margin-bottom:10px';
    fontLabel.textContent = 'UI Font';
    main.appendChild(fontLabel);

    var fontGrid = document.createElement('div');
    fontGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px';
    FONTS.forEach(function(f) {
      var el = document.createElement('div');
      var isActive = theme.font === f.val;
      el.style.cssText = 'padding:10px 14px;border-radius:6px;cursor:pointer;border:1px solid ' + (isActive ? 'var(--wm-accent)' : 'rgba(255,255,255,0.1)') + ';background:' + (isActive ? 'rgba(0,120,212,0.15)' : 'rgba(255,255,255,0.04)') + ';font-family:' + f.val + ';transition:all 0.15s';
      el.innerHTML = '<div style="font-size:15px;color:var(--wm-text)">' + f.label + '</div><div style="font-size:11px;opacity:0.5;margin-top:2px">The quick brown fox</div>';
      el.onclick = async function() {
        await settings.set('font', f.val);
        document.documentElement.style.setProperty('--wm-font', f.val);
        document.body.style.fontFamily = f.val;
        fontGrid.querySelectorAll('div').forEach(function(s) {
          s.style.borderColor = 'rgba(255,255,255,0.1)';
          s.style.background = 'rgba(255,255,255,0.04)';
        });
        el.style.borderColor = 'var(--wm-accent)';
        el.style.background = 'rgba(0,120,212,0.15)';
        kernel.broadcast('themeChanged', settings.getTheme());
      };
      fontGrid.appendChild(el);
    });
    main.appendChild(fontGrid);

    main.appendChild(row('Show Clock', 'Display clock in taskbar',
      toggle(settings.get('showClock') !== false, async function(val) {
        await settings.set('showClock', val);
        var clock = document.getElementById('wm-clock');
        if (clock) clock.style.display = val ? '' : 'none';
      })
    ));
  }

  // ── Apps ─────────────────────────────────────────────────────────────────────

  async function renderApps(main) {
    main.appendChild(h2('Installed Apps'));

    var allApps = await db.apps.all();
    if (!allApps.length) {
      main.innerHTML += '<div style="color:var(--wm-text-dim);font-size:13px">No apps installed</div>';
      return;
    }

    allApps.forEach(function(app) {
      var el = document.createElement('div');
      el.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05)';

      var icon = document.createElement('div');
      icon.style.cssText = 'width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;background:rgba(255,255,255,0.05)';
      if (app.icon && app.icon.startsWith('data:')) {
        var img = document.createElement('img');
        img.src = app.icon; img.style.cssText = 'width:28px;height:28px;border-radius:4px';
        icon.appendChild(img);
      } else {
        icon.textContent = app.emoji || '⚡';
      }

      var info = document.createElement('div');
      info.style.cssText = 'flex:1';
      info.innerHTML = '<div style="font-size:14px;color:var(--wm-text)">' + app.name + '</div>' +
        '<div style="font-size:11px;color:var(--wm-text-dim)">v' + app.version + (app.protected ? ' \u2022 \uD83D\uDD12 Protected' : '') + '</div>';

      el.appendChild(icon);
      el.appendChild(info);

      if (!app.protected) {
        var uninstallBtn = document.createElement('button');
        uninstallBtn.textContent = 'Uninstall';
        uninstallBtn.style.cssText = 'background:rgba(200,50,50,0.15);border:1px solid rgba(200,50,50,0.3);color:#ff8888;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:12px';
        uninstallBtn.onclick = async function() {
          if (!confirm('Uninstall ' + app.name + '?')) return;
          await db.apps.delete(app.id);
          el.remove();
          wm.onAppUninstalled(app.id);
        };
        el.appendChild(uninstallBtn);
      }

      main.appendChild(el);
    });
  }

  // ── Storage ──────────────────────────────────────────────────────────────────

  async function renderStorage(main) {
    main.appendChild(h2('Storage'));

    // Count IDB usage estimate
    var estimate = { usage: 0, quota: 0 };
    if (navigator.storage && navigator.storage.estimate) {
      estimate = await navigator.storage.estimate();
    }
    var usedMB  = (estimate.usage  / 1024 / 1024).toFixed(1);
    var totalMB = (estimate.quota  / 1024 / 1024).toFixed(0);
    var pct     = estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : 0;

    main.appendChild(row('IndexedDB Usage', 'Storage used by BrowserOS filesystem',
      document.createTextNode(usedMB + ' MB of ' + totalMB + ' MB')
    ));

    var bar = document.createElement('div');
    bar.style.cssText = 'height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;margin:12px 0';
    bar.innerHTML = '<div style="height:100%;background:var(--wm-accent);width:' + pct + '%;border-radius:4px;transition:width 0.3s"></div>';
    main.appendChild(bar);

    var resetBtn = document.createElement('button');
    resetBtn.textContent = '🗑️ Reset Filesystem';
    resetBtn.style.cssText = 'background:rgba(200,50,50,0.15);border:1px solid rgba(200,50,50,0.3);color:#ff8888;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:13px;margin-top:16px';
    resetBtn.onclick = async function() {
      if (!confirm('Delete ALL files? This cannot be undone.')) return;
      var req = indexedDB.deleteDatabase('BrowserOS');
      req.onsuccess = function() { location.reload(); };
    };
    main.appendChild(resetBtn);
  }

  // ── System ───────────────────────────────────────────────────────────────────

  function renderSystem(main) {
    main.appendChild(h2('System'));

    var info = [
      { label:'OS Version',  value:'BrowserOS 2.0.0' },
      { label:'BOS API',     value:'2.0' },
      { label:'Engine',      value:'HTML5 / IndexedDB / ES Modules' },
      { label:'License',     value:'AGPL-3.0' },
    ];

    info.forEach(function(item) {
      main.appendChild(row(item.label, null, document.createTextNode(item.value)));
    });

    var resetSettingsBtn = document.createElement('button');
    resetSettingsBtn.textContent = 'Reset Settings to Defaults';
    resetSettingsBtn.style.cssText = 'background:rgba(200,50,50,0.15);border:1px solid rgba(200,50,50,0.3);color:#ff8888;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:13px;margin-top:20px';
    resetSettingsBtn.onclick = async function() {
      if (!confirm('Reset all settings to defaults?')) return;
      await settings.reset();
      wm.applyTheme(settings.getTheme());
      kernel.broadcast('themeChanged', settings.getTheme());
    };
    main.appendChild(resetSettingsBtn);
  }
}
