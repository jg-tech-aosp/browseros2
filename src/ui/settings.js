/**
 * BrowserOS v2 — Settings
 * src/ui/settings.js
 *
 * Manages OS settings stored in IndexedDB.
 * Provides getTheme(), set(), get() and an onChange() callback system
 * so the rest of the OS can react to setting changes live.
 */

const DEFAULTS = {
  accent:     '#0078d4',
  wallpaper:  'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
  font:       "'Segoe UI', system-ui, sans-serif",
  darkMode:   true,
  showClock:  true,
  pinnedApps: ['filemanager', 'texteditor', 'terminal'],
  userProfile: { name: 'User', avatar: null },
};

export class Settings {
  /** @param {import('../fs/db.js').DB} db */
  constructor(db) {
    this._db       = db;
    this._cache    = { ...DEFAULTS };
    this._handlers = []; // onChange listeners
  }

  async boot() {
    const saved = await this._db.settings.all();
    // Merge saved over defaults
    this._cache = { ...DEFAULTS, ...saved };
    console.log('[settings] Loaded');
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  get(key) {
    return this._cache[key] ?? DEFAULTS[key];
  }

  getTheme() {
    return {
      accent:    this._cache.accent,
      wallpaper: this._cache.wallpaper,
      font:      this._cache.font,
      darkMode:  this._cache.darkMode,
    };
  }

  getAll() {
    return { ...this._cache };
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  async set(key, value) {
    this._cache[key] = value;
    await this._db.settings.set(key, value);
    // Fire onChange with new theme
    const theme = this.getTheme();
    this._handlers.forEach(fn => fn(theme, key, value));
  }

  async setMany(obj) {
    for (const [key, value] of Object.entries(obj)) {
      this._cache[key] = value;
      await this._db.settings.set(key, value);
    }
    const theme = this.getTheme();
    this._handlers.forEach(fn => fn(theme, null, null));
  }

  async reset() {
    for (const [key, value] of Object.entries(DEFAULTS)) {
      await this._db.settings.set(key, value);
    }
    this._cache = { ...DEFAULTS };
    const theme = this.getTheme();
    this._handlers.forEach(fn => fn(theme, null, null));
  }

  // ─── Change listeners ──────────────────────────────────────────────────────

  onChange(fn) {
    this._handlers.push(fn);
  }

  offChange(fn) {
    this._handlers = this._handlers.filter(h => h !== fn);
  }
}
