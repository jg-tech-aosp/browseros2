/**
 * BrowserOS v2 — IndexedDB Wrapper
 * src/fs/db.js
 *
 * Abstracts all IndexedDB transaction boilerplate into clean async methods.
 * Never use IndexedDB directly elsewhere — always go through this.
 */

const DB_NAME    = 'BrowserOS';
const DB_VERSION = 2;

// ─── Internal helpers ────────────────────────────────────────────────────────

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    t.onerror = () => reject(t.error);
    resolve(fn(t));
  });
}

// ─── Schema setup ────────────────────────────────────────────────────────────

function onUpgrade(db) {
  // fs store — one record per filesystem node
  if (!db.objectStoreNames.contains('fs')) {
    const fs = db.createObjectStore('fs', { keyPath: 'path' });
    fs.createIndex('modified', 'modified', { unique: false });
    fs.createIndex('type',     'type',     { unique: false });
  }

  // apps store — installed .beep app registry
  if (!db.objectStoreNames.contains('apps')) {
    db.createObjectStore('apps', { keyPath: 'id' });
  }

  // settings store — key/value OS settings
  if (!db.objectStoreNames.contains('settings')) {
    db.createObjectStore('settings', { keyPath: 'key' });
  }
}

// ─── Store wrappers ──────────────────────────────────────────────────────────

function makeFsStore(db) {
  return {
    /** Get a single node by exact path */
    async get(path) {
      return tx(db, ['fs'], 'readonly', t =>
        request(t.objectStore('fs').get(path))
      );
    },

    /** Insert or overwrite a node */
    async put(node) {
      return tx(db, ['fs'], 'readwrite', t =>
        request(t.objectStore('fs').put(node))
      );
    },

    /** Delete a node by path */
    async delete(path) {
      return tx(db, ['fs'], 'readwrite', t =>
        request(t.objectStore('fs').delete(path))
      );
    },

    /**
     * List all direct children of a directory path.
     * e.g. list('/Documents') returns nodes whose paths match /Documents/name
     * with no further slashes — direct children only.
     */
    async list(dirPath) {
      const prefix = dirPath.replace(/\/$/, '') + '/';
      const results = [];

      return new Promise((resolve, reject) => {
        const t     = db.transaction(['fs'], 'readonly');
        const store = t.objectStore('fs');
        const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
        const cursor = store.openCursor(range);

        cursor.onsuccess = e => {
          const c = e.target.result;
          if (!c) { resolve(results); return; }
          const childPath = c.value.path;
          // Only direct children — no further slashes after the prefix
          const remainder = childPath.slice(prefix.length);
          if (!remainder.includes('/')) results.push(c.value);
          c.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
    },

    /**
     * List all nodes under a path recursively.
     * Used by rm() to check if a directory is empty,
     * and by global search.
     */
    async listAll(dirPath) {
      const prefix = dirPath.replace(/\/$/, '') + '/';
      const results = [];

      return new Promise((resolve, reject) => {
        const t     = db.transaction(['fs'], 'readonly');
        const store = t.objectStore('fs');
        const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
        const cursor = store.openCursor(range);

        cursor.onsuccess = e => {
          const c = e.target.result;
          if (!c) { resolve(results); return; }
          results.push(c.value);
          c.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
    },

    /**
     * Get the N most recently modified files.
     * Used by global search and history.
     */
    async recent(limit = 20) {
      const results = [];

      return new Promise((resolve, reject) => {
        const t      = db.transaction(['fs'], 'readonly');
        const index  = t.objectStore('fs').index('modified');
        const cursor = index.openCursor(null, 'prev'); // descending

        cursor.onsuccess = e => {
          const c = e.target.result;
          if (!c || results.length >= limit) { resolve(results); return; }
          if (c.value.type === 'file') results.push(c.value);
          c.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
    },

    /** Delete all nodes whose path starts with a prefix. Used by rmdir -rf equivalent. */
    async deleteAll(dirPath) {
      const all = await this.listAll(dirPath);
      return tx(db, ['fs'], 'readwrite', t => {
        const store = t.objectStore('fs');
        return Promise.all(all.map(n => request(store.delete(n.path))));
      });
    },
  };
}

function makeAppsStore(db) {
  return {
    async get(id) {
      return tx(db, ['apps'], 'readonly', t =>
        request(t.objectStore('apps').get(id))
      );
    },

    async put(app) {
      return tx(db, ['apps'], 'readwrite', t =>
        request(t.objectStore('apps').put(app))
      );
    },

    async delete(id) {
      return tx(db, ['apps'], 'readwrite', t =>
        request(t.objectStore('apps').delete(id))
      );
    },

    async all() {
      return tx(db, ['apps'], 'readonly', t =>
        request(t.objectStore('apps').getAll())
      );
    },
  };
}

function makeSettingsStore(db) {
  return {
    async get(key) {
      const record = await tx(db, ['settings'], 'readonly', t =>
        request(t.objectStore('settings').get(key))
      );
      return record ? record.value : undefined;
    },

    async set(key, value) {
      return tx(db, ['settings'], 'readwrite', t =>
        request(t.objectStore('settings').put({ key, value }))
      );
    },

    async delete(key) {
      return tx(db, ['settings'], 'readwrite', t =>
        request(t.objectStore('settings').delete(key))
      );
    },

    async all() {
      const records = await tx(db, ['settings'], 'readonly', t =>
        request(t.objectStore('settings').getAll())
      );
      // Return as a plain object { key: value }
      return Object.fromEntries(records.map(r => [r.key, r.value]));
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class DB {
  constructor(idb) {
    this.fs       = makeFsStore(idb);
    this.apps     = makeAppsStore(idb);
    this.settings = makeSettingsStore(idb);
  }

  /**
   * Open the BrowserOS IndexedDB database.
   * Call once at OS boot — pass the returned instance everywhere.
   *
   * @returns {Promise<DB>}
   */
  static open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => onUpgrade(e.target.result);
      req.onsuccess       = e => resolve(new DB(e.target.result));
      req.onerror         = e => reject(e.target.error);
      req.onblocked       = () => reject(new Error('IndexedDB blocked — close other BrowserOS tabs'));
    });
  }
}
