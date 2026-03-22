/**
 * BrowserOS v2 — Filesystem
 * src/fs/fs.js
 *
 * Implements all filesystem operations defined in SPEC.md §5 BOS.fs.
 * Built on top of the IndexedDB wrapper (db.js).
 * This is the authoritative filesystem — nothing reads/writes IDB directly.
 */

import { DB } from './db.js';

// ─── Mime detection ───────────────────────────────────────────────────────────

const MIME_MAP = {
  txt:  'text/plain',
  md:   'text/markdown',
  js:   'text/javascript',
  json: 'application/json',
  html: 'text/html',
  css:  'text/css',
  csv:  'text/csv',
  xml:  'text/xml',
  svg:  'image/svg+xml',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  gif:  'image/gif',
  webp: 'image/webp',
  mp3:  'audio/mpeg',
  wav:  'audio/wav',
  ogg:  'audio/ogg',
  mp4:  'video/mp4',
  pdf:  'application/pdf',
  beep: 'application/beep',
  zip:  'application/zip',
};

function getMime(name) {
  const ext = name.split('.').pop().toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

function getEncoding(mime) {
  if (mime.startsWith('text/')) return 'utf8';
  if (mime === 'application/json') return 'utf8';
  if (mime === 'application/javascript') return 'utf8';
  if (mime === 'image/svg+xml') return 'utf8';
  if (mime === 'application/beep') return 'utf8';
  return 'base64';
}

// ─── Default filesystem seed ──────────────────────────────────────────────────

const DEFAULT_DIRS = [
  '/',
  '/Desktop',
  '/Documents',
  '/Pictures',
  '/Music',
  '/Downloads',
  '/Apps',
];

const DEFAULT_FILES = [
  {
    path:    '/Documents/Welcome.txt',
    content: [
      'Welcome to BrowserOS v2!',
      '',
      'This is a complete rewrite of BrowserOS with:',
      '- Proper app sandboxing via iframes + postMessage',
      '- IndexedDB filesystem (no more localStorage limits)',
      '- .beep v2 executable format (zip-based, permissions model)',
      '- BOS v2 async API',
      '- Tabs, bookmarks, history in Browser',
      '- App Store',
      '',
      'Have fun.',
    ].join('\n'),
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now() { return Date.now(); }

function makeDir(path) {
  return {
    path,
    type:     'dir',
    content:  null,
    encoding: null,
    size:     0,
    mime:     null,
    created:  now(),
    modified: now(),
  };
}

function makeFile(path, content, mime) {
  const enc = getEncoding(mime);
  return {
    path,
    type:     'file',
    content,
    encoding: enc,
    size:     content.length,
    mime,
    created:  now(),
    modified: now(),
  };
}

function normPath(path) {
  // Normalize slashes, remove trailing slash (except root)
  let p = path.replace(/\/+/g, '/');
  if (p !== '/' && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function parentPath(path) {
  const p = normPath(path);
  if (p === '/') return null;
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return '/' + parts.join('/') || '/';
}

function fileName(path) {
  return normPath(path).split('/').filter(Boolean).pop() || '';
}

// ─── FileSystem class ─────────────────────────────────────────────────────────

export class FileSystem {
  /** @param {import('./db.js').DB} db */
  constructor(db) {
    this._db = db;
  }

  /**
   * Boot the filesystem.
   * Seeds default structure if this is a fresh install.
   */
  async boot() {
    const root = await this._db.fs.get('/');
    if (!root) {
      console.log('[fs] Fresh install — seeding default filesystem');
      await this._seed();
    } else {
      console.log('[fs] Filesystem found — skipping seed');
    }
  }

  async _seed() {
    for (const path of DEFAULT_DIRS) {
      await this._db.fs.put(makeDir(path));
    }
    for (const { path, content } of DEFAULT_FILES) {
      const mime = getMime(path.split('/').pop());
      await this._db.fs.put(makeFile(path, content, mime));
    }
  }

  // ── Core API ────────────────────────────────────────────────────────────────

  /**
   * Read file contents.
   * @returns {Promise<string|null>}
   */
  async read(path) {
    const node = await this._db.fs.get(normPath(path));
    if (!node || node.type !== 'file') return null;
    return node.content;
  }

  /**
   * Get metadata for a file or directory.
   * @returns {Promise<{type,size,name,created,modified,mime,encoding}|null>}
   */
  async stat(path) {
    const node = await this._db.fs.get(normPath(path));
    if (!node) return null;
    const { type, size, created, modified, mime, encoding } = node;
    return { type, size, name: fileName(path), created, modified, mime, encoding };
  }

  /**
   * List direct children of a directory.
   * @returns {Promise<Array<{type,size,name,created,modified,mime}>>|null}
   */
  async ls(path) {
    const node = await this._db.fs.get(normPath(path));
    if (!node || node.type !== 'dir') return null;
    const children = await this._db.fs.list(normPath(path));
    return children.map(n => ({
      type:     n.type,
      size:     n.size,
      name:     fileName(n.path),
      created:  n.created,
      modified: n.modified,
      mime:     n.mime,
      encoding: n.encoding,
    }));
  }

  /**
   * Write a file. Creates it if it doesn't exist, overwrites if it does.
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async write(path, content) {
    path = normPath(path);
    const parent = parentPath(path);

    // Ensure parent directory exists
    const parentNode = await this._db.fs.get(parent);
    if (!parentNode || parentNode.type !== 'dir') {
      return { ok: false, error: `Parent directory does not exist: ${parent}` };
    }

    const existing = await this._db.fs.get(path);
    const mime = getMime(fileName(path));

    if (existing && existing.type === 'dir') {
      return { ok: false, error: `${path} is a directory` };
    }

    const node = existing
      ? { ...existing, content, size: content.length, modified: now() }
      : makeFile(path, content, mime);

    await this._db.fs.put(node);

    // Update parent modified time
    await this._touchDir(parent);

    return { ok: true };
  }

  /**
   * Create a directory.
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async mkdir(path) {
    path = normPath(path);
    const existing = await this._db.fs.get(path);
    if (existing) return { ok: false, error: `${path} already exists` };

    const parent = parentPath(path);
    if (parent) {
      const parentNode = await this._db.fs.get(parent);
      if (!parentNode || parentNode.type !== 'dir') {
        return { ok: false, error: `Parent directory does not exist: ${parent}` };
      }
    }

    await this._db.fs.put(makeDir(path));
    if (parent) await this._touchDir(parent);
    return { ok: true };
  }

  /**
   * Delete a file or empty directory.
   * Returns error if directory is not empty.
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async rm(path) {
    path = normPath(path);
    const node = await this._db.fs.get(path);
    if (!node) return { ok: false, error: `${path} does not exist` };

    if (node.type === 'dir') {
      const children = await this._db.fs.list(path);
      if (children.length > 0) {
        return { ok: false, error: `Directory not empty: ${path}. Delete contents first.` };
      }
    }

    await this._db.fs.delete(path);
    const parent = parentPath(path);
    if (parent) await this._touchDir(parent);
    return { ok: true };
  }

  /**
   * Rename a file or directory in place.
   * newName is just the name component, not a full path.
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async rename(path, newName) {
    path = normPath(path);
    const node = await this._db.fs.get(path);
    if (!node) return { ok: false, error: `${path} does not exist` };

    const parent  = parentPath(path);
    const newPath = (parent === '/' ? '' : parent) + '/' + newName;

    return this.move(path, newPath);
  }

  /**
   * Move a file or directory to a new path.
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async move(src, dest) {
    src  = normPath(src);
    dest = normPath(dest);

    if (src === dest) return { ok: true };

    const node = await this._db.fs.get(src);
    if (!node) return { ok: false, error: `${src} does not exist` };

    const destParent = parentPath(dest);
    const destParentNode = await this._db.fs.get(destParent);
    if (!destParentNode || destParentNode.type !== 'dir') {
      return { ok: false, error: `Destination parent does not exist: ${destParent}` };
    }

    const existing = await this._db.fs.get(dest);
    if (existing) return { ok: false, error: `${dest} already exists` };

    if (node.type === 'file') {
      // Simple file move — write to new path, delete old
      await this._db.fs.put({ ...node, path: dest, modified: now() });
      await this._db.fs.delete(src);
    } else {
      // Directory move — move all children recursively
      const all = [node, ...await this._db.fs.listAll(src)];
      for (const n of all) {
        const newPath = dest + n.path.slice(src.length);
        await this._db.fs.put({ ...n, path: newPath, modified: now() });
        await this._db.fs.delete(n.path);
      }
    }

    const srcParent = parentPath(src);
    if (srcParent) await this._touchDir(srcParent);
    if (destParent) await this._touchDir(destParent);

    return { ok: true };
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /** Update a directory's modified timestamp */
  async _touchDir(path) {
    const node = await this._db.fs.get(normPath(path));
    if (node && node.type === 'dir') {
      await this._db.fs.put({ ...node, modified: now() });
    }
  }

  // ── Utility (used by OS internals, not exposed via BOS) ────────────────────

  /** Check if a path exists */
  async exists(path) {
    const node = await this._db.fs.get(normPath(path));
    return !!node;
  }

  /** Get raw node (used by kernel for permission path matching) */
  async _raw(path) {
    return this._db.fs.get(normPath(path));
  }

  /** Get N most recently modified files (used by Ctrl+Space search) */
  async recent(limit = 20) {
    return this._db.fs.recent(limit);
  }
}
