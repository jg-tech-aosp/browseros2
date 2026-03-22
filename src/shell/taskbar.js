/**
 * BrowserOS v2 — Taskbar
 * src/shell/taskbar.js
 *
 * Manages the taskbar:
 * - Pinned apps (with running indicators)
 * - Active window buttons
 * - System tray (clock, notifications bell, quick settings)
 * - Notification center panel
 */

export class Taskbar {
  constructor({ wm, db, launcher, settings, kernel }) {
    this._wm       = wm;
    this._db       = db;
    this._launcher = launcher;
    this._settings = settings;
    this._kernel   = kernel;
    this._notifications = []; // history
    this._unread        = 0;
  }

  async boot() {
    this._buildTray();
    await this.refreshPinnedApps();

    // Listen for notification events from WM
    document.addEventListener('bos:notify', e => {
      this._addNotification(e.detail.message);
    });

    console.log('[taskbar] Booted');
  }

  // ─── Pinned apps ───────────────────────────────────────────────────────────

  async refreshPinnedApps() {
    const pinned  = this._settings.get('pinnedApps') || [];
    const allApps = await this._db.apps.all();
    const container = document.getElementById('wm-taskbar-apps');
    if (!container) return;

    container.querySelectorAll('.wm-pinned-btn').forEach(b => b.remove());

    for (const appId of pinned) {
      // Check DB first, then fall back to native system app
      let app = allApps.find(a => a.id === appId);
      if (!app) {
        const sysApp = this._wm._systemApps.get(appId);
        if (sysApp) app = { id: appId, name: sysApp.title, icon: null, emoji: sysApp.icon };
      }
      if (!app) continue;
      const btn = this._makePinnedBtn(app);
      const firstWin = container.querySelector('.wm-taskbar-btn:not(.wm-pinned-btn)');
      container.insertBefore(btn, firstWin || null);
    }
  }

  _makePinnedBtn(app) {
    const btn = document.createElement('button');
    btn.className = 'wm-taskbar-btn wm-pinned-btn';
    btn.dataset.appId = app.id;
    btn.title  = app.name;
    btn.innerHTML = `
      <span>${app.icon || app.emoji || '⚡'}</span>
      <span class="wm-tb-label">${app.name}</span>
    `;

    // Show running dot if any instance is running
    this._updateRunningDot(btn, app.id);

    btn.onclick = async () => {
      const running = this._kernel.registry.allOf(app.id);
      if (running.length === 0) {
        try {
          // Check if it's a native system app first
          if (this._wm._systemApps.has(app.id)) {
            this._wm.openSystemApp(app.id);
          } else {
            await this._launcher.launchById(app.id);
          }
        } catch(e) { this._wm.notify('Failed to launch: ' + e.message); }
      } else if (running.length === 1) {
        // Toggle minimize/focus
        const id = running[0].instanceId;
        const w  = this._wm._windows.get(id);
        if (!w) return;
        if (w.state.minimized)               { this._wm.minimize(id); this._wm.focus(id); }
        else if (this._wm._activeId === id)  { this._wm.minimize(id); }
        else                                  { this._wm.focus(id); }
      } else {
        // Multiple instances — focus the next one in rotation
        const ids = running.map(r => r.instanceId);
        const cur = ids.indexOf(this._wm._activeId);
        const next = ids[(cur + 1) % ids.length];
        this._wm.focus(next);
      }
    };

    btn.addEventListener('contextmenu', e => {
      e.preventDefault();
      this._showPinnedMenu(e.clientX, e.clientY, app, btn);
    });

    return btn;
  }

  _updateRunningDot(btn, appId) {
    btn.querySelector('.wm-running-dot')?.remove();
    const running = this._kernel?.registry.isRunning(appId);
    if (running) {
      const dot = document.createElement('span');
      dot.className = 'wm-running-dot';
      btn.appendChild(dot);
    }
  }

  _showPinnedMenu(x, y, app, btn) {
    const running = this._kernel.registry.allOf(app.id);
    const items   = [];

    if (running.length > 0) {
      items.push({ label: '📂 Show all windows', action: () => {
        running.forEach(r => { this._wm.minimize(r.instanceId); this._wm.focus(r.instanceId); });
      }});
      items.push({ label: '✕ Close all', action: () => {
        running.forEach(r => this._wm.close(r.instanceId));
      }});
      items.push('sep');
    }

    const pinned = this._settings.get('pinnedApps') || [];
    const isPinned = pinned.includes(app.id);
    items.push({ label: isPinned ? '📌 Unpin from taskbar' : '📌 Pin to taskbar', action: async () => {
      const newPinned = isPinned
        ? pinned.filter(id => id !== app.id)
        : [...pinned, app.id];
      await this._settings.set('pinnedApps', newPinned);
      await this.refreshPinnedApps();
    }});

    this._showMenu(x, y, items);
  }

  // ─── System tray ───────────────────────────────────────────────────────────

  _buildTray() {
    const clock = document.getElementById('wm-clock');
    if (!clock) return;

    // Insert tray before clock
    const tray = document.createElement('div');
    tray.id = 'wm-tray';
    tray.style.cssText = 'display:flex;align-items:center;gap:4px;padding:0 8px;flex-shrink:0';

    // Notification bell
    this._bellBtn = document.createElement('button');
    this._bellBtn.style.cssText = `
      background:none;border:none;color:#e0e0ff;cursor:pointer;
      font-size:16px;position:relative;width:32px;height:32px;
      display:flex;align-items:center;justify-content:center;
      border-radius:6px;transition:background 0.15s;
    `;
    this._bellBtn.textContent = '🔔';
    this._bellBtn.title = 'Notifications';
    this._bellBtn.onmouseenter = () => this._bellBtn.style.background = 'rgba(255,255,255,0.1)';
    this._bellBtn.onmouseleave = () => this._bellBtn.style.background = '';
    this._bellBtn.onclick = () => this._toggleNotificationCenter();

    this._badgeEl = document.createElement('span');
    this._badgeEl.style.cssText = `
      position:absolute;top:2px;right:2px;
      background:#c42b1c;color:#fff;border-radius:50%;
      width:14px;height:14px;font-size:9px;
      display:none;align-items:center;justify-content:center;
    `;
    this._bellBtn.appendChild(this._badgeEl);
    tray.appendChild(this._bellBtn);

    // Quick settings button
    const qsBtn = document.createElement('button');
    qsBtn.style.cssText = `
      background:none;border:none;color:#e0e0ff;cursor:pointer;
      font-size:16px;width:32px;height:32px;
      display:flex;align-items:center;justify-content:center;
      border-radius:6px;transition:background 0.15s;
    `;
    qsBtn.textContent = '⚙️';
    qsBtn.title = 'Quick Settings';
    qsBtn.onmouseenter = () => qsBtn.style.background = 'rgba(255,255,255,0.1)';
    qsBtn.onmouseleave = () => qsBtn.style.background = '';
    qsBtn.onclick = () => this._toggleQuickSettings();
    tray.appendChild(qsBtn);

    clock.parentNode.insertBefore(tray, clock);
  }

  // ─── Notification center ───────────────────────────────────────────────────

  _addNotification(message) {
    this._notifications.unshift({ message, ts: Date.now() });
    if (this._notifications.length > 50) this._notifications.pop();
    this._unread++;
    this._updateBadge();

    // Refresh panel if open
    const panel = document.getElementById('bos-notif-panel');
    if (panel) this._renderNotifPanel(panel);
  }

  _updateBadge() {
    if (!this._badgeEl) return;
    if (this._unread > 0) {
      this._badgeEl.style.display = 'flex';
      this._badgeEl.textContent   = this._unread > 9 ? '9+' : this._unread;
    } else {
      this._badgeEl.style.display = 'none';
    }
  }

  _toggleNotificationCenter() {
    const existing = document.getElementById('bos-notif-panel');
    if (existing) { existing.remove(); return; }

    this._unread = 0;
    this._updateBadge();

    const panel = document.createElement('div');
    panel.id = 'bos-notif-panel';
    panel.style.cssText = `
      position:fixed;bottom:calc(var(--wm-taskbar-h) + 8px);right:8px;
      width:320px;max-height:400px;
      background:rgba(20,20,40,0.97);backdrop-filter:blur(20px);
      border:1px solid rgba(255,255,255,0.12);border-radius:12px;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);
      z-index:9100;display:flex;flex-direction:column;overflow:hidden;
    `;
    this._renderNotifPanel(panel);
    document.body.appendChild(panel);

    setTimeout(() => {
      const close = e => {
        if (!panel.contains(e.target) && e.target !== this._bellBtn) {
          panel.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  }

  _renderNotifPanel(panel) {
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.08)">
        <span style="font-weight:bold;font-size:14px">Notifications</span>
        <button id="bos-notif-clear" style="background:none;border:none;color:#8888aa;
          cursor:pointer;font-size:12px">Clear all</button>
      </div>
      <div id="bos-notif-list" style="overflow-y:auto;flex:1;padding:8px"></div>
    `;

    const list = panel.querySelector('#bos-notif-list');
    if (this._notifications.length === 0) {
      list.innerHTML = '<div style="padding:16px;color:#8888aa;font-size:13px;text-align:center">No notifications</div>';
    } else {
      this._notifications.forEach(n => {
        const el = document.createElement('div');
        el.style.cssText = `
          padding:10px 12px;border-radius:6px;font-size:13px;
          border-bottom:1px solid rgba(255,255,255,0.05);
          display:flex;justify-content:space-between;gap:12px;
        `;
        el.innerHTML = `
          <span>${n.message}</span>
          <span style="color:#8888aa;font-size:11px;flex-shrink:0">
            ${new Date(n.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
          </span>
        `;
        list.appendChild(el);
      });
    }

    panel.querySelector('#bos-notif-clear').onclick = () => {
      this._notifications = [];
      this._renderNotifPanel(panel);
    };
  }

  // ─── Quick settings panel ──────────────────────────────────────────────────

  _toggleQuickSettings() {
    const existing = document.getElementById('bos-qs-panel');
    if (existing) { existing.remove(); return; }

    const panel = document.createElement('div');
    panel.id = 'bos-qs-panel';
    panel.style.cssText = `
      position:fixed;bottom:calc(var(--wm-taskbar-h) + 8px);right:8px;
      width:300px;background:rgba(20,20,40,0.97);backdrop-filter:blur(20px);
      border:1px solid rgba(255,255,255,0.12);border-radius:12px;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);z-index:9100;padding:16px;
    `;

    const theme = this._settings.getAll();

    panel.innerHTML = `
      <div style="font-weight:bold;font-size:14px;margin-bottom:14px">Quick Settings</div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font-size:13px">Dark Mode</span>
        <div class="qs-toggle ${theme.darkMode ? 'on' : ''}" id="qs-darkmode"
          style="width:44px;height:24px;border-radius:12px;cursor:pointer;
          background:${theme.darkMode ? '#0078d4' : '#444'};position:relative;transition:background 0.2s">
          <div style="position:absolute;width:18px;height:18px;background:#fff;border-radius:50%;
            top:3px;transition:left 0.2s;left:${theme.darkMode ? '23px' : '3px'}"></div>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <div style="font-size:13px;margin-bottom:8px">Accent Color</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${['#0078d4','#e81123','#107c10','#ff8c00','#8764b8','#00b294'].map(c =>
            `<div data-color="${c}" style="width:26px;height:26px;border-radius:50%;
              background:${c};cursor:pointer;border:2px solid ${c === theme.accent ? '#fff' : 'transparent'};
              transition:border 0.15s"></div>`
          ).join('')}
        </div>
      </div>

      <div style="font-size:12px;color:#8888aa;text-align:center;cursor:pointer" id="qs-open-settings">
        Open full Settings →
      </div>
    `;

    // Dark mode toggle
    panel.querySelector('#qs-darkmode').onclick = async () => {
      await this._settings.set('darkMode', !this._settings.get('darkMode'));
      panel.remove();
      this._toggleQuickSettings(); // re-render
    };

    // Accent swatches
    panel.querySelectorAll('[data-color]').forEach(el => {
      el.onclick = async () => {
        await this._settings.set('accent', el.dataset.color);
        panel.remove();
      };
    });

    // Open full settings
    panel.querySelector('#qs-open-settings').onclick = () => {
      this._wm.openSystemApp('settings');
      panel.remove();
    };

    document.body.appendChild(panel);

    setTimeout(() => {
      const close = e => {
        if (!panel.contains(e.target)) {
          panel.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  }

  // ─── Generic menu ─────────────────────────────────────────────────────────

  _showMenu(x, y, items) {
    document.getElementById('bos-ctx-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'bos-ctx-menu';
    menu.style.cssText = `
      position:fixed;left:${Math.min(x, window.innerWidth - 200)}px;
      top:${Math.min(y, window.innerHeight - items.length * 36 - 60)}px;
      background:rgba(20,20,40,0.97);backdrop-filter:blur(20px);
      border:1px solid rgba(255,255,255,0.12);border-radius:8px;
      padding:4px;z-index:99999;min-width:200px;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);
    `;
    items.forEach(item => {
      if (item === 'sep') {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin:4px 0';
        menu.appendChild(sep);
      } else {
        const el = document.createElement('div');
        el.style.cssText = 'padding:7px 14px;border-radius:4px;font-size:13px;cursor:pointer;color:#e0e0ff';
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
}
