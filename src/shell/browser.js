/**
 * BrowserOS v2 — Browser (Native System Component)
 * src/shell/browser.js
 *
 * Native app — not a .beep. Registered with WM via registerSystemApp.
 * Runs in the OS page directly so its iframes have no sandbox restrictions.
 */

export function registerBrowser({ wm, fs, db }) {

  wm.registerSystemApp('browser', {
    title:  'Browser',
    icon:   '🌐',
    width:  900,
    height: 580,
    mount(container, instanceId) {
      let tabs = [], activeTab = 0;
      let bookmarks = [], history = [];
      let panel = null;

      container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--wm-bg);color:var(--wm-text)';

      // Load saved bookmarks/history
      async function loadData() {
        try {
          const bm = await fs.read('/Documents/bookmarks.json');
          if (bm) bookmarks = JSON.parse(bm);
        } catch(e) {}
        try {
          const h = await fs.read('/Documents/history.json');
          if (h) history = JSON.parse(h);
        } catch(e) {}
      }
      async function saveBookmarks() { await fs.write('/Documents/bookmarks.json', JSON.stringify(bookmarks)); }
      async function saveHistory()   { await fs.write('/Documents/history.json',   JSON.stringify(history)); }

      // ── Tab bar ─────────────────────────────────────────────────────────────
      const tabBar = document.createElement('div');
      tabBar.style.cssText = 'display:flex;align-items:flex-end;gap:2px;padding:4px 6px 0;background:rgba(0,0,0,0.2);border-bottom:1px solid var(--wm-border);flex-shrink:0;overflow-x:auto;min-height:34px';
      container.appendChild(tabBar);

      // ── Nav bar ─────────────────────────────────────────────────────────────
      const navBar = document.createElement('div');
      navBar.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 8px;background:rgba(0,0,0,0.2);border-bottom:1px solid var(--wm-border);flex-shrink:0';
      container.appendChild(navBar);

      // ── Content ─────────────────────────────────────────────────────────────
      const content = document.createElement('div');
      content.style.cssText = 'flex:1;position:relative;overflow:hidden;min-height:0';
      container.appendChild(content);

      // ── Status bar ──────────────────────────────────────────────────────────
      const statusBar = document.createElement('div');
      statusBar.style.cssText = 'padding:2px 8px;font-size:11px;color:var(--wm-text-dim);background:rgba(0,0,0,0.2);border-top:1px solid var(--wm-border);flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      statusBar.textContent = 'Ready';
      container.appendChild(statusBar);

      // ── Nav bar buttons ─────────────────────────────────────────────────────
      function mkBtn(text, title) {
        const b = document.createElement('button');
        b.textContent = text; b.title = title || text;
        b.style.cssText = 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:var(--wm-text);min-width:28px;height:28px;padding:0 6px;font-size:14px;cursor:pointer;flex-shrink:0;transition:background 0.1s';
        b.onmouseenter = () => b.style.background = 'rgba(255,255,255,0.15)';
        b.onmouseleave = () => b.style.background = 'rgba(255,255,255,0.07)';
        return b;
      }

      const homeBtn     = mkBtn('⌂', 'New Tab');
      const urlInput    = document.createElement('input');
      urlInput.placeholder = 'Enter URL or search...';
      urlInput.style.cssText = 'flex:1;background:var(--wm-hover);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:var(--wm-text);padding:4px 10px;font-size:13px;outline:none';
      urlInput.addEventListener('focus', () => urlInput.select());
      const bookmarkBtn = mkBtn('★', 'Bookmark');
      bookmarkBtn.style.color = '#aaa';
      const histBtn     = mkBtn('📖', 'History');
      const bmBtn       = mkBtn('📌', 'Bookmarks');
      const newTabBtn   = mkBtn('+', 'New Tab');

      [homeBtn, urlInput, bookmarkBtn, histBtn, bmBtn, newTabBtn].forEach(b => navBar.appendChild(b));

      // ── Tabs ────────────────────────────────────────────────────────────────
      function makeTab(url) { return { url: url || '', title: 'New Tab', iframe: null }; }

      function renderTabs() {
        tabBar.innerHTML = '';
        tabs.forEach((tab, i) => {
          const t = document.createElement('div');
          const isActive = i === activeTab;
          t.style.cssText = 'display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px 6px 0 0;cursor:pointer;font-size:12px;max-width:160px;min-width:80px;flex-shrink:0;' +
            'border:1px solid ' + (isActive ? 'var(--wm-border)' : 'transparent') + ';' +
            'border-bottom:' + (isActive ? '1px solid var(--wm-bg)' : '1px solid transparent') + ';' +
            'background:' + (isActive ? 'var(--wm-bg)' : 'rgba(255,255,255,0.04)') + ';color:var(--wm-text)';
          const lbl = document.createElement('span');
          lbl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          lbl.textContent = tab.title || 'New Tab';
          const cls = document.createElement('span');
          cls.textContent = '×'; cls.style.cssText = 'opacity:0.5;font-size:14px;cursor:pointer;flex-shrink:0';
          cls.onclick = e => { e.stopPropagation(); closeTab(i); };
          t.appendChild(lbl); t.appendChild(cls);
          t.onclick = () => switchTab(i);
          tabBar.appendChild(t);
        });
      }

      function newTab(url) {
        tabs.push(makeTab(url || ''));
        activeTab = tabs.length - 1;
        renderTabs();
        if (url) navigate(url);
        else showNewTabPage();
      }

      function closeTab(i) {
        if (tabs.length === 1) { newTab(''); return; }
        // Remove iframe from DOM
        if (tabs[i].iframe) tabs[i].iframe.remove();
        tabs.splice(i, 1);
        if (activeTab >= tabs.length) activeTab = tabs.length - 1;
        renderTabs();
        showTab(activeTab);
      }

      function switchTab(i) {
        // Hide current iframe
        if (tabs[activeTab]?.iframe) tabs[activeTab].iframe.style.display = 'none';
        activeTab = i;
        renderTabs();
        showTab(i);
      }

      function showTab(i) {
        // Hide all iframes
        content.querySelectorAll('iframe').forEach(f => f.style.display = 'none');
        const tab = tabs[i];
        if (!tab) return;
        if (tab.iframe) {
          tab.iframe.style.display = '';
          content.querySelectorAll('.browser-ntpage').forEach(p => p.remove());
        } else {
          showNewTabPage();
        }
        urlInput.value = tab.url || '';
        bookmarkBtn.style.color = isBookmarked(tab.url) ? '#ffcc00' : '#aaa';
      }

      // ── New tab page ────────────────────────────────────────────────────────
      function showNewTabPage() {
        content.querySelectorAll('.browser-ntpage').forEach(p => p.remove());
        const tab = tabs[activeTab];
        if (tab) { tab.iframe = null; tab.url = ''; tab.title = 'New Tab'; }
        urlInput.value = ''; renderTabs();

        const page = document.createElement('div');
        page.className = 'browser-ntpage';
        page.style.cssText = 'position:absolute;inset:0;overflow-y:auto;background:var(--wm-bg);padding:32px;color:var(--wm-text)';

        const logo = document.createElement('div');
        logo.style.cssText = 'text-align:center;font-size:32px;margin-bottom:24px;font-weight:bold';
        logo.textContent = '🌐 Browser';
        page.appendChild(logo);

        if (bookmarks.length) {
          const h = document.createElement('div');
          h.style.cssText = 'max-width:500px;margin:0 auto 8px;font-size:11px;color:var(--wm-text-dim);text-transform:uppercase;letter-spacing:0.05em;font-weight:bold';
          h.textContent = 'Bookmarks'; page.appendChild(h);
          const g = document.createElement('div');
          g.style.cssText = 'max-width:500px;margin:0 auto 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px';
          bookmarks.slice(0, 12).forEach(bm => {
            const tile = document.createElement('div');
            tile.style.cssText = 'padding:10px 8px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);cursor:pointer;text-align:center;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:background 0.15s';
            tile.title = bm.url; tile.textContent = bm.title || bm.url;
            tile.onmouseenter = () => tile.style.background = 'rgba(255,255,255,0.1)';
            tile.onmouseleave = () => tile.style.background = 'rgba(255,255,255,0.05)';
            tile.onclick = () => navigate(bm.url);
            g.appendChild(tile);
          });
          page.appendChild(g);
        }

        if (history.length) {
          const h = document.createElement('div');
          h.style.cssText = 'max-width:500px;margin:0 auto 8px;font-size:11px;color:var(--wm-text-dim);text-transform:uppercase;letter-spacing:0.05em;font-weight:bold';
          h.textContent = 'Recent'; page.appendChild(h);
          const list = document.createElement('div');
          list.style.cssText = 'max-width:500px;margin:0 auto;display:flex;flex-direction:column;gap:4px';
          history.slice(0, 8).forEach(h => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px;transition:background 0.15s';
            row.onmouseenter = () => row.style.background = 'rgba(255,255,255,0.06)';
            row.onmouseleave = () => row.style.background = '';
            const lbl = document.createElement('span');
            lbl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            lbl.textContent = h.title || h.url;
            const time = document.createElement('span');
            time.style.cssText = 'color:var(--wm-text-dim);font-size:10px;flex-shrink:0';
            time.textContent = new Date(h.ts).toLocaleDateString();
            row.appendChild(lbl); row.appendChild(time);
            row.onclick = () => navigate(h.url);
            list.appendChild(row);
          });
          page.appendChild(list);
        }

        if (!bookmarks.length && !history.length) {
          const empty = document.createElement('div');
          empty.style.cssText = 'text-align:center;color:var(--wm-text-dim);font-size:14px;margin-top:40px';
          empty.textContent = 'Enter a URL above to start browsing';
          page.appendChild(empty);
        }

        content.appendChild(page);
      }

      // ── Navigate ────────────────────────────────────────────────────────────
      function resolveUrl(v) {
        if (!v) return null;
        if (v.startsWith('http')) return v;
        if (v.includes('.') && !v.includes(' ')) return 'https://' + v;
        return 'https://www.google.com/search?q=' + encodeURIComponent(v);
      }

      function navigate(url) {
        if (!url) return;
        const tab = tabs[activeTab];
        tab.url   = url;
        tab.title = url.replace(/^https?:\/\//, '').split('/')[0];
        urlInput.value = url;
        bookmarkBtn.style.color = isBookmarked(url) ? '#ffcc00' : '#aaa';
        statusBar.textContent = 'Loading: ' + url;
        closePanel();

        // Remove existing new tab page
        content.querySelectorAll('.browser-ntpage').forEach(p => p.remove());

        // Reuse or create iframe
        if (!tab.iframe) {
          const iframe = document.createElement('iframe');
          iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none';
          // No sandbox — native app, full permissions
          content.appendChild(iframe);
          tab.iframe = iframe;
        }

        // Show spinner
        tab.iframe.style.display = 'none';
        const spinner = document.createElement('div');
        spinner.className = 'browser-spinner';
        spinner.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--wm-bg);font-size:28px;color:var(--wm-text-dim)';
        spinner.innerHTML = '<div style="animation:bos-spin 1s linear infinite;display:inline-block">◷</div>';
        if (!document.getElementById('bos-spin-style')) {
          const st = document.createElement('style'); st.id = 'bos-spin-style';
          st.textContent = '@keyframes bos-spin{to{transform:rotate(360deg)}}';
          document.head.appendChild(st);
        }
        content.appendChild(spinner);

        tab.iframe.onload = () => {
          spinner.remove();
          tab.iframe.style.display = '';
          tab.title = url.replace(/^https?:\/\//, '').split('/')[0];
          statusBar.textContent = url;
          renderTabs();
          wm.setWindowTitle(instanceId, 'Browser — ' + tab.title);
        };

        tab.iframe.onerror = () => {
          spinner.remove();
          tab.iframe.style.display = '';
        };

        tab.iframe.src = url;

        // Hide all other iframes
        content.querySelectorAll('iframe').forEach(f => { if (f !== tab.iframe) f.style.display = 'none'; });
        tab.iframe.style.display = '';
        renderTabs();

        // History
        history.unshift({ url, title: tab.title, ts: Date.now() });
        if (history.length > 100) history.pop();
        saveHistory();
      }

      // ── Bookmarks ───────────────────────────────────────────────────────────
      function isBookmarked(url) { return bookmarks.some(b => b.url === url); }

      async function toggleBookmark() {
        const url = tabs[activeTab]?.url;
        if (!url) return;
        const idx = bookmarks.findIndex(b => b.url === url);
        if (idx >= 0) {
          bookmarks.splice(idx, 1);
          bookmarkBtn.style.color = '#aaa';
          wm.notify('Bookmark removed');
        } else {
          const title = prompt('Bookmark name:', tabs[activeTab].title || url);
          if (title === null) return;
          bookmarks.unshift({ url, title, ts: Date.now() });
          bookmarkBtn.style.color = '#ffcc00';
          wm.notify('Bookmarked: ' + title);
        }
        await saveBookmarks();
      }

      // ── Panels ──────────────────────────────────────────────────────────────
      function closePanel() { if (panel) { panel.remove(); panel = null; } }

      function showPanel(title, renderFn) {
        closePanel();
        panel = document.createElement('div');
        panel.style.cssText = 'position:absolute;top:0;right:0;width:280px;height:100%;background:rgba(20,20,40,0.97);backdrop-filter:blur(20px);border-left:1px solid var(--wm-border);z-index:99;display:flex;flex-direction:column;overflow:hidden';
        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--wm-border);font-weight:bold;font-size:13px;flex-shrink:0';
        hdr.textContent = title;
        const cls = document.createElement('button');
        cls.textContent = '×'; cls.style.cssText = 'background:none;border:none;color:var(--wm-text);cursor:pointer;font-size:18px';
        cls.onclick = closePanel; hdr.appendChild(cls); panel.appendChild(hdr);
        const list = document.createElement('div');
        list.style.cssText = 'flex:1;overflow-y:auto;padding:8px';
        renderFn(list); panel.appendChild(list);
        content.appendChild(panel);
      }

      function showBookmarksPanel() {
        showPanel('📌 Bookmarks', list => {
          if (!bookmarks.length) { list.innerHTML = '<div style="padding:16px;color:var(--wm-text-dim);font-size:12px">No bookmarks yet.</div>'; return; }
          bookmarks.forEach((bm, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer;font-size:12px';
            row.onmouseenter = () => row.style.background = 'rgba(255,255,255,0.06)';
            row.onmouseleave = () => row.style.background = '';
            const lbl = document.createElement('span');
            lbl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--wm-text)';
            lbl.textContent = bm.title || bm.url; lbl.title = bm.url;
            const del = document.createElement('span');
            del.textContent = '🗑️'; del.style.cssText = 'opacity:0.5;cursor:pointer;flex-shrink:0';
            del.onclick = e => { e.stopPropagation(); bookmarks.splice(i, 1); saveBookmarks(); showBookmarksPanel(); };
            row.appendChild(lbl); row.appendChild(del);
            row.onclick = () => { navigate(bm.url); closePanel(); };
            list.appendChild(row);
          });
        });
      }

      function showHistoryPanel() {
        showPanel('📖 History', list => {
          const clrBtn = document.createElement('button');
          clrBtn.textContent = 'Clear all';
          clrBtn.style.cssText = 'background:rgba(200,50,50,0.15);border:1px solid rgba(200,50,50,0.3);color:#ff8888;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;margin-bottom:8px;width:100%';
          clrBtn.onclick = () => { history.length = 0; saveHistory(); showHistoryPanel(); };
          list.appendChild(clrBtn);
          if (!history.length) { list.innerHTML += '<div style="padding:16px;color:var(--wm-text-dim);font-size:12px">No history.</div>'; return; }
          history.forEach(h => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px';
            row.onmouseenter = () => row.style.background = 'rgba(255,255,255,0.06)';
            row.onmouseleave = () => row.style.background = '';
            const lbl = document.createElement('span');
            lbl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--wm-text)';
            lbl.textContent = h.title || h.url;
            const time = document.createElement('span');
            time.style.cssText = 'color:var(--wm-text-dim);font-size:10px;flex-shrink:0';
            time.textContent = new Date(h.ts).toLocaleDateString();
            row.appendChild(lbl); row.appendChild(time);
            row.onclick = () => { navigate(h.url); closePanel(); };
            list.appendChild(row);
          });
        });
      }

      // ── Wire up ─────────────────────────────────────────────────────────────
      homeBtn.onclick     = () => { closePanel(); showNewTabPage(); };
      bookmarkBtn.onclick = toggleBookmark;
      histBtn.onclick     = () => panel ? closePanel() : showHistoryPanel();
      bmBtn.onclick       = () => panel ? closePanel() : showBookmarksPanel();
      newTabBtn.onclick   = () => newTab('');

      urlInput.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        closePanel();
        const v = urlInput.value.trim();
        if (!v) return;
        const u = resolveUrl(v);
        if (u) navigate(u);
      });

      loadData().then(() => newTab(''));
    }
  });
}
