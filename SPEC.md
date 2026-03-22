# BrowserOS v2 — Technical Specification

> This document defines the complete architecture, APIs, and design decisions for BrowserOS 2.0.
> It is the authoritative reference for the v2 build. Nothing gets built that isn't in here.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [postMessage Protocol](#2-postmessage-protocol)
3. [.beep v2 Format](#3-beep-v2-format)
4. [Permissions Model](#4-permissions-model)
5. [BOS v2 API](#5-bos-v2-api)
6. [IndexedDB Schema](#6-indexeddb-schema)
7. [Native vs .beep Split](#7-native-vs-beep-split)
8. [Build Order](#8-build-order)

---

## 1. Architecture Overview

### The core shift from v1

In v1, `.beep` apps run directly in the same JavaScript scope as the OS. They can access `OS`, `document`, `localStorage` — everything. There is no isolation.

In v2, every `.beep` app runs in its own `<iframe sandbox="allow-scripts">`. This creates a hard security boundary — the app's JS literally cannot reach outside its own scope. The only communication channel is `postMessage`.

```
┌─────────────────────────────────────┐
│           BrowserOS v2 Core         │
│  ┌─────────┐  ┌─────────────────┐   │
│  │   WM    │  │  postMsg Kernel │   │
│  └─────────┘  └────────┬────────┘   │
│  ┌─────────┐           │            │
│  │   IDB   │           │            │
│  └─────────┘           │            │
└──────────────────────── │ ───────────┘
                          │ postMessage
        ┌─────────────────┼──────────────┐
        │                 │              │
   ┌────┴────┐      ┌─────┴───┐   ┌─────┴───┐
   │paint.beep│     │calc.beep│   │ fm.beep │
   │ (iframe) │     │(iframe) │   │(iframe) │
   └──────────┘     └─────────┘   └─────────┘
```

### Key principles

- **Trust nothing** — every app message is validated and permission-checked before the OS acts on it
- **Declare everything** — apps declare permissions and events upfront in their manifest
- **Crash isolation** — a crashed app cannot affect the OS or other apps
- **Consistent API** — app developers write against `BOS.*`, never raw `postMessage`

### Technology decisions

- **Zip library** — JSZip for unpacking `.beep` files in memory
- **Storage** — IndexedDB (replacing localStorage)
- **App isolation** — `<iframe sandbox="allow-scripts">`
- **IPC** — `window.postMessage` / `window.addEventListener('message')`

---

## 2. postMessage Protocol

### Message envelope

Every message from an app to the OS follows this format:

```json
{
  "reqId": 42,
  "type": "category.method",
  "payload": {}
}
```

Every response from the OS to an app:

```json
{
  "reqId": 42,
  "ok": true,
  "result": {}
}
```

On error:

```json
{
  "reqId": 42,
  "ok": false,
  "error": "Permission denied"
}
```

### reqId

- Incrementing integer, per app instance
- Each app keeps its own counter starting at 0
- OS identifies the sender via `e.source` (the iframe's `contentWindow`)
- Together `appId + reqId` form a unique key: `"paint:42"`
- Simple, readable, zero collision risk

```js
// Inside every app iframe
let reqId = 0;
function nextReqId() { return reqId++; }
```

### Events (OS → App, no reqId)

Events are fire-and-forget from OS to app. No response expected.

```json
{
  "type": "event.themeChanged",
  "payload": { "accent": "#0078d4", "font": "...", "darkMode": true }
}
```

The OS only sends events to apps that declared them in their manifest. No runtime subscribe/unsubscribe.

### All message types

```
fs.read          path → { content, encoding }
fs.stat          path → { type, size, name, created, modified, mime }
fs.ls            path → [{ type, size, name, created, modified, mime }]
fs.write         path, content, encoding → ok
fs.mkdir         path → ok
fs.rm            path → ok
fs.rename        path, newName → ok
fs.move          src, dest → ok

ui.notify        message → ok
ui.setTitle      title → ok
ui.setIcon       icon → ok
ui.setProgress   value → ok
ui.alert         message → ok
ui.confirm       message → bool
ui.prompt        message, default → string | null

app.open         appId → ok
app.launch       path → ok
app.install      path → ok
app.uninstall    id → ok
app.self         → { name, version, path, permissions, events }

net.fetch        url, options → { ok, status, headers, body }

os.version       → string
os.theme         → { accent, font, darkMode, wallpaper }
os.env           → { locale, timezone, screen: { width, height } }
```

---

## 3. .beep v2 Format

A `.beep` file is a standard zip archive with the following structure:

```
myapp.beep  (zip)
├── manifest.json    ← required
├── main.js          ← entry point (or whatever entry specifies)
├── icon.png         ← app icon, referenced in manifest
└── assets/          ← optional
    └── any files
```

### manifest.json

```json
{
  "name": "Paint",
  "version": "2.0",
  "icon": "icon.png",
  "author": "jg-tech-aosp",
  "bos": "2.0",
  "width": 820,
  "height": 560,
  "permissions": [
    "fs:/Pictures:read",
    "fs:/Pictures:write",
    "ui.passive"
  ],
  "events": [
    "themeChanged"
  ],
  "entry": "main.js"
}
```

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Display name |
| `version` | string | ✅ | App version (semver recommended) |
| `icon` | string | ✅ | Path to icon image inside the zip |
| `author` | string | — | Author name |
| `bos` | string | ✅ | Minimum BOS version required. OS refuses to launch if incompatible |
| `width` | number | — | Initial window width in px (default: 640) |
| `height` | number | — | Initial window height in px (default: 480) |
| `permissions` | string[] | ✅ | Declared permissions (see §4) |
| `events` | string[] | ✅ | OS events this app receives |
| `entry` | string | ✅ | JS file to execute as app entry point |

### How the OS launches a .beep

1. Fetch the `.beep` file from the filesystem
2. Unzip in memory using JSZip
3. Parse `manifest.json`
4. Check `bos` version compatibility — abort if incompatible
5. Extract and cache `icon.png`
6. Register app in `apps` IndexedDB store
7. Create a window via the window manager
8. Create `<iframe sandbox="allow-scripts">` inside the window
9. Inject BOS client library into the iframe
10. Inject `main.js` (or `entry`) into the iframe
11. Begin handling postMessage from the iframe

### Protected apps

Inbox apps (shipped with the OS) have `protected: true` in the `apps` store. This is set by the OS at install time, not declared in the manifest. Protected apps cannot be uninstalled via `BOS.app.uninstall()`.

---

## 4. Permissions Model

### Syntax

```
fs:{path}:read       read files/dirs at path and below
fs:{path}:write      create, modify, delete at path and below
ui.passive           notify, setTitle, setIcon, setProgress
ui.interactive       alert, confirm, prompt
network              BOS.net.fetch() — any URL, body always string
```

### Examples

```json
// Paint — reads and writes pictures only
"permissions": [
  "fs:/Pictures:read",
  "fs:/Pictures:write",
  "ui.passive",
  "ui.interactive"
]

// Weather app — network only
"permissions": [
  "network",
  "ui.passive"
]

// File Manager inbox app — full filesystem
"permissions": [
  "fs:/:read",
  "fs:/:write",
  "ui.passive",
  "ui.interactive"
]

// Text Editor — documents only
"permissions": [
  "fs:/Documents:read",
  "fs:/Documents:write",
  "fs:/Desktop:read",
  "fs:/Desktop:write",
  "ui.passive",
  "ui.interactive"
]
```

### Enforcement

The postMessage kernel checks permissions before handling every message:

```
App sends fs.read for /Pictures/drawing.png
→ OS checks: does this app have fs:/Pictures:read or fs:/:read?
→ Yes → proceed
→ No  → respond { ok: false, error: 'Permission denied' }
```

Path permission matching is prefix-based — `fs:/Documents:read` grants access to `/Documents/notes.txt`, `/Documents/work/report.txt`, etc.

### Events

Events are declared separately from permissions:

```json
"events": ["themeChanged", "focus", "blur"]
```

Available events:
| Event | Payload | Description |
|-------|---------|-------------|
| `themeChanged` | `{ accent, font, darkMode, wallpaper }` | OS theme was changed |
| `focus` | `{}` | App window gained focus |
| `blur` | `{}` | App window lost focus |

---

## 5. BOS v2 API

The BOS client library is injected into every app iframe at launch. It wraps all postMessage communication into a clean async API.

### BOS.fs — Filesystem

```js
// Read file contents
const content = await BOS.fs.read(path)
// → string | null
// Requires: fs:{path}:read

// Get file/dir metadata
const info = await BOS.fs.stat(path)
// → { type, size, name, created, modified, mime } | null
// Requires: fs:{path}:read

// List directory contents
const items = await BOS.fs.ls(path)
// → [{ type, size, name, created, modified, mime }] | null
// Requires: fs:{path}:read

// Write file (creates or overwrites)
await BOS.fs.write(path, content)
// → ok | error
// Requires: fs:{path}:write

// Create directory
await BOS.fs.mkdir(path)
// → ok | error
// Requires: fs:{path}:write

// Delete file or empty directory
await BOS.fs.rm(path)
// → ok | error
// Non-empty directories return error — rm each item first
// Requires: fs:{path}:write

// Rename in place
await BOS.fs.rename(path, newName)
// newName is just the name, not a full path
// → ok | error
// Requires: fs:{path}:write

// Move to new location
await BOS.fs.move(src, dest)
// → ok | error
// Requires: fs:{src}:read, fs:{src}:write, fs:{dest}:write
```

### BOS.ui — User Interface

```js
// Passive (requires ui.passive)
await BOS.ui.notify(message)        // toast notification → ok
await BOS.ui.setTitle(title)        // update window title → ok
await BOS.ui.setIcon(icon)          // update window icon → ok
await BOS.ui.setProgress(value)     // taskbar progress 0-100, -1 to clear → ok

// Interactive (requires ui.interactive)
await BOS.ui.alert(message)         // → ok
await BOS.ui.confirm(message)       // → bool
await BOS.ui.prompt(message, default) // → string | null
```

### BOS.app — App Management

```js
await BOS.app.open(appId)
// Open a built-in system app by ID
// → ok | error
// No permission required

await BOS.app.launch(path)
// Launch a .beep app by filesystem path
// → ok | error
// Requires: fs:{path}:read

await BOS.app.install(path)
// Install a .beep from path into /Apps/
// → ok | error
// Requires: fs:{path}:read, fs:/Apps:write

await BOS.app.uninstall(id)
// Uninstall an app by id
// → ok | error
// Blocked if app is protected
// Requires: fs:/Apps:write

await BOS.app.self()
// Get info about the current running app
// → { name, version, path, permissions, events }
// No permission required
```

### BOS.net — Networking

```js
await BOS.net.fetch(url, options)
// Wraps native fetch()
// options: { method, headers, body } — mirrors standard fetch API
// → { ok, status, headers, body }
// body is always a string
// Requires: network
```

### BOS.os — System Info

```js
// Synchronous — data injected at iframe launch time
BOS.os.version()
// → "2.0.0"

BOS.os.theme()
// → { accent, font, darkMode, wallpaper }

BOS.os.env()
// → { locale, timezone, screen: { width, height } }
```

### BOS.on — Event Listener

```js
BOS.on(event, callback)
// Listen for OS events declared in manifest
// No permission required — gated by manifest events[] instead

BOS.on('themeChanged', ({ accent, font, darkMode, wallpaper }) => {
  // update app UI to match new theme
});

BOS.on('focus', () => { /* window gained focus */ });
BOS.on('blur',  () => { /* window lost focus  */ });
```

---

## 6. IndexedDB Schema

Database name: `BrowserOS`
Database version: `2`

### Object Store: `fs`

Primary key: `path`
Indexes: `modified` (for recent files queries)

```js
{
  path:     '/Documents/notes.txt',  // primary key
  type:     'file',                  // 'file' | 'dir'
  content:  'hello world',           // string, null for dirs
  encoding: 'utf8',                  // 'utf8' | 'base64'
  size:     11,                      // bytes
  mime:     'text/plain',            // optional
  created:  1700000000000,           // unix ms timestamp
  modified: 1700000000000,           // unix ms timestamp
}
```

For directories, `content` is `null` and `encoding` is `null`.

`ls(path)` is implemented as an IndexedDB range query on `path` — all records where path starts with `{path}/` and contains no further `/`. Fast, no children array needed.

Binary files use `encoding: 'base64'`. The OS auto-detects at write time based on mime type. `BOS.fs.read()` always returns a string — apps that need binary data decode base64 themselves.

### Object Store: `apps`

Primary key: `id`

```js
{
  id:          'paint',
  path:        '/Apps/paint.beep',
  name:        'Paint',
  version:     '2.0',
  icon:        'data:image/png;base64,...',  // extracted from zip at install
  permissions: ['fs:/Pictures:read', 'fs:/Pictures:write', 'ui.passive'],
  events:      ['themeChanged'],
  entry:       'main.js',
  bos:         '2.0',
  installedAt: 1700000000000,
  protected:   false,   // true for inbox apps, set by OS not manifest
}
```

### Object Store: `settings`

Primary key: `key`

```js
{ key: 'accent',      value: '#0078d4' }
{ key: 'darkMode',    value: true }
{ key: 'font',        value: "'Segoe UI', sans-serif" }
{ key: 'wallpaper',   value: 'linear-gradient(...)' }
{ key: 'pinnedApps',  value: ['filemanager', 'texteditor', 'terminal'] }
{ key: 'userProfile', value: { name: 'John', avatar: null } }
```

---

## 7. Native vs .beep Split

Modelled after the Windows NT architecture — true system components are native, inbox apps are `.beep` with broad permissions.

### Native system components

Cannot be removed. Run outside the sandbox. Direct access to OS internals.

| Component | Description |
|-----------|-------------|
| Kernel | postMessage router, permission enforcer |
| Window Manager | Drag, resize, z-index, focus |
| IndexedDB Filesystem | Storage layer |
| Shell / Desktop | Wallpaper, desktop icons, right-click |
| Taskbar | Pinned apps, window buttons, system tray |
| Login Screen | User profiles |
| Settings | Touches OS internals directly |

### Inbox `.beep` apps

Ship with the OS, `protected: true` in the apps store. Cannot be uninstalled. Run inside the sandbox like any third party app, just with broader permissions declared in their manifests.

| App | Key Permissions |
|-----|----------------|
| File Manager | `fs:/:read`, `fs:/:write` |
| Text Editor | `fs:/Documents:read`, `fs:/Documents:write` |
| Terminal | `fs:/:read`, `fs:/:write` |
| Calculator | `ui.passive`, `ui.interactive` |
| Browser | `network`, `ui.passive` |
| Paint | `fs:/Pictures:read`, `fs:/Pictures:write` |
| App Store | `network`, `fs:/Apps:write`, `ui.passive`, `ui.interactive` |
| Music Player | `fs:/Music:read`, `ui.passive` |
| Markdown Viewer | `fs:/Documents:read`, `ui.passive` |
| System Monitor | `ui.passive` |

---

## 8. Build Order

### Evening 1 — The invisible foundation

| Step | Component | Est. Time |
|------|-----------|-----------|
| 1 | IndexedDB wrapper class | 30 min |
| 2 | Filesystem (all fs.* methods, default seed) | 30 min |
| 3 | postMessage kernel (router, permission enforcer, app registry) | 45 min |
| 4 | BOS client library (injected into iframes) | 30 min |
| 5 | Window manager (rewrite from v1, now wraps iframes) | 45 min |
| 6 | .beep launcher (JSZip unpack, manifest parse, iframe boot) | 30 min |

### Evening 2 — The visible OS

| Step | Component | Est. Time |
|------|-----------|-----------|
| 7 | Shell + Desktop (wallpaper, icons, right-click, restore from IDB) | 30 min |
| 8 | Taskbar (pinned apps, window buttons, system tray, clock, bell) | 45 min |
| 9 | Notification center (history, unread count) | 20 min |
| 10 | Ctrl+Space switcher (apps + files + settings, keyboard driven) | 30 min |
| 11 | Settings app (native, accent/wallpaper/font/darkmode/permissions) | 30 min |
| 12 | Port inbox apps to async BOS v2 API | 45 min |
| 13 | New apps (Markdown Viewer, Music Player, System Monitor) | 30 min |
| 14 | App Store (fetch index.json, display, install via BOS.app.install) | 30 min |

**Total: ~7 hours across two evenings**

Risk items:
- Step 3 (postMessage kernel) — most complex single component
- Step 12 (porting apps) — tedious, async BOS may surface unexpected issues

---

## Appendix: Version History

| Version | Notes |
|---------|-------|
| 2.0.0 | Initial v2 release |

---

*BrowserOS v2 Spec — authored during design phase, March 2026*
*Licensed under AGPL-3.0*
