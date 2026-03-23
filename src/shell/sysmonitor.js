/**
 * BrowserOS v2 — System Monitor (Native System Component)
 * src/shell/sysmonitor.js
 */

export function registerSysMonitor({ wm, db, kernel, settings, fs }) {

  wm.registerSystemApp('sysmonitor', {
    title:  'System Monitor',
    icon:   '📊',
    width:  500,
    height: 460,
    mount(container, instanceId) {
      let interval = null;

      container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--wm-bg);color:var(--wm-text);padding:20px;gap:16px;box-sizing:border-box';

      const title = document.createElement('div');
      title.style.cssText = 'font-size:18px;font-weight:bold;flex-shrink:0';
      title.textContent = '📊 System Monitor';
      container.appendChild(title);

      // OS Info
      const infoGrid = document.createElement('div');
      infoGrid.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid var(--wm-border);border-radius:8px;padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px;flex-shrink:0';
      container.appendChild(infoGrid);

      function stat(label, value) {
        const el = document.createElement('div');
        el.innerHTML = '<div style="font-size:11px;color:var(--wm-text-dim);margin-bottom:2px">' + label + '</div>' +
          '<div style="font-size:14px;color:var(--wm-text)" class="stat-val">' + value + '</div>';
        return el;
      }

      const theme = settings.getTheme();
      infoGrid.appendChild(stat('OS Version', 'BrowserOS 2.0.0'));
      infoGrid.appendChild(stat('BOS API', '2.0'));
      infoGrid.appendChild(stat('Screen', window.innerWidth + ' × ' + window.innerHeight));
      infoGrid.appendChild(stat('Locale', navigator.language || 'en-US'));
      infoGrid.appendChild(stat('Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone));
      infoGrid.appendChild(stat('Theme', theme.darkMode ? 'Dark' : 'Light'));

      // Live stats section
      const liveTitle = document.createElement('div');
      liveTitle.style.cssText = 'font-size:14px;font-weight:bold;flex-shrink:0';
      liveTitle.textContent = 'Live Stats';
      container.appendChild(liveTitle);

      const liveGrid = document.createElement('div');
      liveGrid.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid var(--wm-border);border-radius:8px;overflow-y:auto;flex:1';
      container.appendChild(liveGrid);

      const refreshBtn = document.createElement('button');
      refreshBtn.textContent = '⟳ Refresh';
      refreshBtn.style.cssText = 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--wm-text);padding:6px 14px;cursor:pointer;font-size:13px;flex-shrink:0;align-self:flex-start;transition:background 0.15s';
      refreshBtn.onmouseenter = () => refreshBtn.style.background = 'rgba(255,255,255,0.15)';
      refreshBtn.onmouseleave = () => refreshBtn.style.background = 'rgba(255,255,255,0.07)';
      container.appendChild(refreshBtn);

      function row(label, value) {
        const el = document.createElement('div');
        el.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:9px 14px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:13px;gap:16px';
        el.innerHTML = '<span style="color:var(--wm-text-dim)">' + label + '</span>' +
          '<span style="color:var(--wm-text);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px">' + value + '</span>';
        return el;
      }

      function getMemory() {
        if (performance && performance.memory) {
          const used  = (performance.memory.usedJSHeapSize  / 1024 / 1024).toFixed(1);
          const total = (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(1);
          const limit = (performance.memory.jsHeapSizeLimit  / 1024 / 1024).toFixed(0);
          return used + ' MB / ' + total + ' MB (limit: ' + limit + ' MB)';
        }
        return 'N/A (not supported in this browser)';
      }

      async function getStorageUsage() {
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          const used  = (est.usage  / 1024 / 1024).toFixed(1);
          const quota = (est.quota  / 1024 / 1024).toFixed(0);
          const pct   = est.quota ? Math.round((est.usage / est.quota) * 100) : 0;
          return used + ' MB / ' + quota + ' MB (' + pct + '%)';
        }
        return 'N/A';
      }

      async function getRunningApps() {
        const instances = kernel.registry.all();
        if (!instances.length) return 'None';
        return instances.map(i => i.name).join(', ');
      }

      async function getInstalledApps() {
        const beepApps   = await db.apps.all();
        const nativeApps = wm._systemApps.size;
        return beepApps.length + ' .beep + ' + nativeApps + ' native = ' + (beepApps.length + nativeApps) + ' total';
      }

      async function renderLive() {
        liveGrid.innerHTML = '';
        const storage = await getStorageUsage();
        const running = await getRunningApps();
        const installed = await getInstalledApps();

        liveGrid.appendChild(row('Memory (JS Heap)', getMemory()));
        liveGrid.appendChild(row('Storage Used', storage));
        liveGrid.appendChild(row('Running Apps', running));
        liveGrid.appendChild(row('Installed Apps', installed));
        liveGrid.appendChild(row('Online', navigator.onLine ? '✅ Yes' : '❌ No'));
        liveGrid.appendChild(row('Language', navigator.language));
        liveGrid.appendChild(row('Platform', navigator.platform || 'Unknown'));
        liveGrid.appendChild(row('User Agent', navigator.userAgent.split(')')[0] + ')'));
        liveGrid.appendChild(row('Cookies', navigator.cookieEnabled ? 'Enabled' : 'Disabled'));
      }

      refreshBtn.onclick = renderLive;
      renderLive();
      interval = setInterval(renderLive, 3000);

      // Return cleanup
      return function() {
        clearInterval(interval);
      };
    }
  });
}
