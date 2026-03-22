/**
 * BrowserOS v2 — Permission Checker
 * src/kernel/permissions.js
 *
 * Validates whether an app has permission to perform a given action.
 * Called by the kernel before handling every message.
 *
 * Permission syntax (from SPEC.md §4):
 *   fs:{path}:read       read files/dirs at path and below
 *   fs:{path}:write      create, modify, delete at path and below
 *   ui.passive           notify, setTitle, setIcon, setProgress
 *   ui.interactive       alert, confirm, prompt
 *   network              BOS.net.fetch()
 */

// ─── Message type → required permission mapping ───────────────────────────────

const PERMISSION_MAP = {
  // Filesystem — path-based, checked separately
  'fs.read':   { type: 'fs', op: 'read' },
  'fs.stat':   { type: 'fs', op: 'read' },
  'fs.ls':     { type: 'fs', op: 'read' },
  'fs.write':  { type: 'fs', op: 'write' },
  'fs.mkdir':  { type: 'fs', op: 'write' },
  'fs.rm':     { type: 'fs', op: 'write' },
  'fs.rename': { type: 'fs', op: 'write' },
  'fs.move':   { type: 'fs', op: 'both' },   // needs read on src, write on dest

  // UI passive
  'ui.notify':      { type: 'static', perm: 'ui.passive' },
  'ui.setTitle':    { type: 'static', perm: 'ui.passive' },
  'ui.setIcon':     { type: 'static', perm: 'ui.passive' },
  'ui.setProgress': { type: 'static', perm: 'ui.passive' },
  'ui.startDrag':   { type: 'static', perm: 'ui.passive' },
  'ui.endDrag':     { type: 'static', perm: 'ui.passive' },

  // UI interactive
  'ui.alert':   { type: 'static', perm: 'ui.interactive' },
  'ui.confirm': { type: 'static', perm: 'ui.interactive' },
  'ui.prompt':  { type: 'static', perm: 'ui.interactive' },

  // Network
  'net.fetch': { type: 'static', perm: 'network' },

  // App management
  'app.open':      { type: 'none' },
  'app.self':      { type: 'none' },
  'app.launch':    { type: 'fs', op: 'read', pathKey: 'path' },
  'app.install':   { type: 'app.install' },
  'app.uninstall': { type: 'app.uninstall' },

  // OS info — always allowed
  'os.version': { type: 'none' },
  'os.theme':   { type: 'none' },
  'os.env':     { type: 'none' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if an app's permissions grant fs access to a path with a given op.
 * Permission fs:/Documents:read grants access to /Documents and anything below.
 */
function hasFsPermission(permissions, path, op) {
  for (const perm of permissions) {
    const match = perm.match(/^fs:(.+):(read|write)$/);
    if (!match) continue;
    const [, permPath, permOp] = match;
    if (op !== permOp) continue;
    // Root permission grants access to everything
    if (permPath === '/') return true;
    // Prefix match — permPath must be a prefix of path
    const normalized = permPath.replace(/\/$/, '');
    if (path === normalized || path.startsWith(normalized + '/')) return true;
  }
  return false;
}

function hasStaticPermission(permissions, perm) {
  return permissions.includes(perm);
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Check if an app is allowed to perform a message type with the given payload.
 *
 * @param {string[]} permissions - App's declared permissions array
 * @param {string}   type        - Message type e.g. 'fs.read'
 * @param {object}   payload     - Message payload
 * @returns {{ allowed: boolean, error?: string }}
 */
export function checkPermission(permissions, type, payload) {
  const rule = PERMISSION_MAP[type];

  if (!rule) {
    return { allowed: false, error: `Unknown message type: ${type}` };
  }

  // No permission required
  if (rule.type === 'none') {
    return { allowed: true };
  }

  // Static permission check
  if (rule.type === 'static') {
    if (hasStaticPermission(permissions, rule.perm)) return { allowed: true };
    return { allowed: false, error: `Missing permission: ${rule.perm}` };
  }

  // Filesystem permission check
  if (rule.type === 'fs') {
    const pathKey = rule.pathKey || 'path';
    const path = payload[pathKey];

    if (!path) {
      return { allowed: false, error: 'Missing path in payload' };
    }

    if (rule.op === 'read') {
      if (hasFsPermission(permissions, path, 'read')) return { allowed: true };
      return { allowed: false, error: `Missing permission: fs:${path}:read` };
    }

    if (rule.op === 'write') {
      if (hasFsPermission(permissions, path, 'write')) return { allowed: true };
      return { allowed: false, error: `Missing permission: fs:${path}:write` };
    }

    // fs.move — needs read on src, write on dest
    if (rule.op === 'both') {
      const src  = payload.src;
      const dest = payload.dest;
      if (!src || !dest) return { allowed: false, error: 'Missing src or dest in payload' };
      if (!hasFsPermission(permissions, src, 'read')) {
        return { allowed: false, error: `Missing permission: fs:${src}:read` };
      }
      if (!hasFsPermission(permissions, src, 'write')) {
        return { allowed: false, error: `Missing permission: fs:${src}:write` };
      }
      if (!hasFsPermission(permissions, dest, 'write')) {
        return { allowed: false, error: `Missing permission: fs:${dest}:write` };
      }
      return { allowed: true };
    }
  }

  // app.install — needs fs:/Apps:write + fs on the source path
  if (rule.type === 'app.install') {
    const path = payload.path;
    if (!path) return { allowed: false, error: 'Missing path in payload' };
    if (!hasFsPermission(permissions, path, 'read')) {
      return { allowed: false, error: `Missing permission: fs:${path}:read` };
    }
    if (!hasFsPermission(permissions, '/Apps', 'write')) {
      return { allowed: false, error: 'Missing permission: fs:/Apps:write' };
    }
    return { allowed: true };
  }

  // app.uninstall — needs fs:/Apps:write
  if (rule.type === 'app.uninstall') {
    if (!hasFsPermission(permissions, '/Apps', 'write')) {
      return { allowed: false, error: 'Missing permission: fs:/Apps:write' };
    }
    return { allowed: true };
  }

  return { allowed: false, error: `Unhandled permission rule for: ${type}` };
}

/**
 * Check if an app has declared a specific event in its manifest.
 * Used by the kernel to decide whether to forward OS events to an app.
 *
 * @param {string[]} events  - App's declared events array
 * @param {string}   event   - Event name e.g. 'themeChanged'
 * @returns {boolean}
 */
export function hasEvent(events, event) {
  return Array.isArray(events) && events.includes(event);
}
