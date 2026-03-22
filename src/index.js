/**
 * BrowserOS v2 — Boot Sequence
 * src/index.js
 *
 * Wires all modules together and boots the OS in the correct order:
 * 1. IndexedDB
 * 2. Filesystem
 * 3. Settings
 * 4. Window Manager
 * 5. Kernel
 * 6. Launcher
 * 7. Shell + Desktop
 * 8. Taskbar
 * 9. Search
 * 10. Seed inbox apps
 * 11. Restore desktop state
 */

import { DB }            from './fs/db.js';
import { FileSystem }    from './fs/fs.js';
import { Kernel }        from './kernel/kernel.js';
import { WindowManager } from './wm/wm.js';
import { Launcher }      from './apps/launcher.js';
import { Settings }      from './ui/settings.js';
import { Desktop }       from './shell/desktop.js';
import { Taskbar }       from './shell/taskbar.js';
import { Search }        from './shell/search.js';

// ─── Inbox app paths ──────────────────────────────────────────────────────────
// These .beep files must exist in the filesystem at boot.
// They are installed as protected apps on first run.

const INBOX_APPS = [
  '/Apps/filemanager.beep',
  '/Apps/texteditor.beep',
  '/Apps/terminal.beep',
  '/Apps/calculator.beep',
  '/Apps/browser.beep',
  '/Apps/paint.beep',
  '/Apps/appstore.beep',
  '/Apps/musicplayer.beep',
  '/Apps/markdownviewer.beep',
  '/Apps/sysmonitor.beep',
];

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  console.log('[bos] Booting BrowserOS v2...');

  try {

    // ── 1. IndexedDB ──────────────────────────────────────────────────────────
    console.log('[bos] Opening database...');
    const db = await DB.open();

    // ── 2. Filesystem ─────────────────────────────────────────────────────────
    console.log('[bos] Booting filesystem...');
    const fs = new FileSystem(db);
    await fs.boot(); // seeds default dirs/files on fresh install

    // ── 3. Settings ───────────────────────────────────────────────────────────
    console.log('[bos] Loading settings...');
    const settings = new Settings(db);
    await settings.boot(); // loads saved settings, applies defaults if fresh

    // ── 4. Window Manager ─────────────────────────────────────────────────────
    console.log('[bos] Booting window manager...');
    const wm = new WindowManager({
      settings,
      onStart: () => search.toggle(),
    });
    wm.boot();

    // Apply saved theme immediately
    const theme = await settings.getTheme();
    wm.applyTheme(theme);

    // ── 5. Kernel ─────────────────────────────────────────────────────────────
    console.log('[bos] Booting kernel...');
    const kernel = new Kernel({ fs, db, wm, settings, launcher: null });
    wm.setKernel(kernel);
    kernel.boot();

    // ── 6. Launcher ───────────────────────────────────────────────────────────
    console.log('[bos] Booting launcher...');
    const launcher = new Launcher({ fs, db, wm, kernel, settings });

    // Wire launcher into kernel (circular ref resolved here)
    kernel._launcher = launcher;

    // ── 7. Shell + Desktop ────────────────────────────────────────────────────
    console.log('[bos] Booting desktop...');
    const desktop = new Desktop({ fs, db, wm, launcher, kernel, settings });
    await desktop.boot();

    // ── 8. Taskbar ────────────────────────────────────────────────────────────
    console.log('[bos] Booting taskbar...');
    const taskbar = new Taskbar({ wm, db, launcher, settings, kernel });
    await taskbar.boot();

    // ── 9. Search ─────────────────────────────────────────────────────────────
    console.log('[bos] Booting search...');
    const search = new Search({ fs, db, wm, launcher, kernel });
    search.boot();

    // Ctrl+Space to toggle search
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        search.toggle();
      }
    });

    // ── 10. Seed inbox apps ───────────────────────────────────────────────────
    console.log('[bos] Seeding inbox apps...');
    await launcher.seedInboxApps(INBOX_APPS);
    await taskbar.refreshPinnedApps();

    // ── 11. Theme change broadcast ────────────────────────────────────────────
    // When settings change, broadcast to all running apps
    settings.onChange(async (newTheme) => {
      wm.applyTheme(newTheme);
      kernel.broadcast('themeChanged', newTheme);
    });

    // ── Done ──────────────────────────────────────────────────────────────────
    console.log('[bos] BrowserOS v2 ready ✓');

  } catch (err) {
    // Boot failure — show a readable error screen
    console.error('[bos] Boot failed:', err);
    document.body.innerHTML = `
      <div style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:100vh;background:#0a0010;color:#ff8888;font-family:monospace;
        gap:16px;padding:32px;text-align:center;
      ">
        <div style="font-size:48px">💥</div>
        <div style="font-size:20px;color:#fff">BrowserOS failed to boot</div>
        <pre style="
          background:rgba(255,255,255,0.05);border-radius:8px;padding:16px;
          font-size:12px;color:#ffaaaa;white-space:pre-wrap;max-width:600px;text-align:left;
        ">${err.stack || err.message}</pre>
        <button onclick="location.reload()" style="
          background:#0078d4;border:none;color:#fff;padding:10px 24px;
          border-radius:6px;cursor:pointer;font-size:14px;
        ">Retry</button>
      </div>
    `;
  }
}

boot();
