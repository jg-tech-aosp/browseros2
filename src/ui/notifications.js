/**
 * BrowserOS v2 — Notifications
 * src/ui/notifications.js
 *
 * Central notification manager.
 * Handles storing, displaying and clearing notifications.
 * The WM calls notify() which fires a 'bos:notify' event.
 * The Taskbar listens for that event to update the bell badge.
 * This module is the single source of truth for notification history.
 */

export class Notifications {
  /**
   * @param {object} opts
   * @param {import('../wm/wm.js').WindowManager} opts.wm
   */
  constructor({ wm }) {
    this._wm      = wm;
    this._history = []; // { id, message, ts, read }
    this._nextId  = 0;
  }

  boot() {
    // Patch wm.notify so every toast also goes through us
    const original = this._wm.notify.bind(this._wm);
    this._wm.notify = (message) => {
      original(message);
      this._add(message);
    };
    console.log('[notifications] Booted');
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _add(message) {
    const entry = {
      id:      this._nextId++,
      message,
      ts:      Date.now(),
      read:    false,
    };
    this._history.unshift(entry);
    if (this._history.length > 100) this._history.pop();

    // Fire event so Taskbar can update badge
    document.dispatchEvent(new CustomEvent('bos:notify', {
      detail: { message, id: entry.id }
    }));
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Get all notifications, newest first */
  getAll() {
    return [...this._history];
  }

  /** Get unread count */
  getUnreadCount() {
    return this._history.filter(n => !n.read).length;
  }

  /** Mark all as read */
  markAllRead() {
    this._history.forEach(n => { n.read = true; });
    document.dispatchEvent(new CustomEvent('bos:notificationsRead'));
  }

  /** Mark a single notification as read */
  markRead(id) {
    const n = this._history.find(n => n.id === id);
    if (n) n.read = true;
  }

  /** Clear all notifications */
  clearAll() {
    this._history = [];
    document.dispatchEvent(new CustomEvent('bos:notificationsCleared'));
  }

  /** Get unread notifications only */
  getUnread() {
    return this._history.filter(n => !n.read);
  }
}
