/**
 * BrowserOS v2 — App Registry
 * src/kernel/registry.js
 *
 * Tracks all running app instances.
 * Each instance has a unique ID, an iframe contentWindow reference,
 * and the app's manifest metadata (permissions, events, etc).
 *
 * The kernel uses this to:
 * - Identify which app sent a message (by matching e.source)
 * - Check permissions for that app
 * - Broadcast OS events to subscribed apps
 * - Clean up when a window is closed
 */

export class Registry {
  constructor() {
    // Map of instanceId → AppInstance
    this._instances = new Map();
  }

  /**
   * Register a newly launched app instance.
   *
   * @param {object} opts
   * @param {string}   opts.instanceId  - Unique ID for this window instance
   * @param {string}   opts.appId       - App id from the apps store (e.g. 'paint')
   * @param {string}   opts.name        - Display name
   * @param {string}   opts.version     - App version
   * @param {string}   opts.path        - Filesystem path of the .beep file
   * @param {string[]} opts.permissions - Declared permissions
   * @param {string[]} opts.events      - Declared events
   * @param {Window}   opts.contentWindow - The iframe's contentWindow
   */
  register({ instanceId, appId, name, version, path, permissions, events, contentWindow }) {
    this._instances.set(instanceId, {
      instanceId,
      appId,
      name,
      version,
      path,
      permissions: permissions || [],
      events:      events      || [],
      contentWindow,
      launchedAt:  Date.now(),
    });
    console.log(`[registry] Registered: ${name} (${instanceId})`);
  }

  /**
   * Unregister an app instance when its window is closed.
   * @param {string} instanceId
   */
  unregister(instanceId) {
    const inst = this._instances.get(instanceId);
    if (inst) {
      console.log(`[registry] Unregistered: ${inst.name} (${instanceId})`);
      this._instances.delete(instanceId);
    }
  }

  /**
   * Find an app instance by its iframe contentWindow.
   * Used by the kernel to identify who sent a postMessage.
   *
   * @param {Window} contentWindow
   * @returns {object|null}
   */
  findByWindow(contentWindow) {
    for (const inst of this._instances.values()) {
      if (inst.contentWindow === contentWindow) return inst;
    }
    return null;
  }

  /**
   * Get an instance by its instanceId.
   * @param {string} instanceId
   * @returns {object|null}
   */
  get(instanceId) {
    return this._instances.get(instanceId) || null;
  }

  /**
   * Get all currently running instances.
   * @returns {object[]}
   */
  all() {
    return Array.from(this._instances.values());
  }

  /**
   * Get all instances of a specific app (by appId).
   * An app can have multiple windows open simultaneously.
   * @param {string} appId
   * @returns {object[]}
   */
  allOf(appId) {
    return this.all().filter(inst => inst.appId === appId);
  }

  /**
   * Check if any instance of an app is currently running.
   * @param {string} appId
   * @returns {boolean}
   */
  isRunning(appId) {
    return this.allOf(appId).length > 0;
  }

  /**
   * Get all instances that have subscribed to a given OS event.
   * Used by the kernel to broadcast events.
   * @param {string} event - e.g. 'themeChanged'
   * @returns {object[]}
   */
  subscribedTo(event) {
    return this.all().filter(inst => inst.events.includes(event));
  }

  /**
   * Send a message to a specific app instance.
   * @param {string} instanceId
   * @param {object} message
   */
  send(instanceId, message) {
    const inst = this.get(instanceId);
    if (inst && inst.contentWindow) {
      inst.contentWindow.postMessage(message, '*');
    }
  }

  /**
   * Broadcast an OS event to all instances subscribed to it.
   * @param {string} event   - Event name e.g. 'themeChanged'
   * @param {object} payload - Event payload
   */
  broadcast(event, payload) {
    const subscribers = this.subscribedTo(event);
    const message = { type: `event.${event}`, payload };
    for (const inst of subscribers) {
      inst.contentWindow.postMessage(message, '*');
    }
    if (subscribers.length > 0) {
      console.log(`[registry] Broadcast ${event} to ${subscribers.length} app(s)`);
    }
  }

  /**
   * Get a summary of running apps for the taskbar.
   * @returns {Array<{instanceId, appId, name, launchedAt}>}
   */
  taskbarSummary() {
    return this.all().map(({ instanceId, appId, name, launchedAt }) => ({
      instanceId, appId, name, launchedAt,
    }));
  }
}
