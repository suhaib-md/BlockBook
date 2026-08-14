# 02 — Technical Requirements Document

**Product:** BlockBook · **Version:** 1.0 · **Date:** 2026-08-14

Companion to [01-PRD](01-PRD.md). The PRD says what; this says how.

---

## 1. Architectural principles

These five constraints decide most arguments before they start.

| # | Principle | Consequence |
|---|---|---|
| P1 | **Local-first, offline-always** | No runtime network calls, ever. No CDN links, no web fonts, no telemetry. If a feature needs the internet at runtime, it is out of scope. |
| P2 | **The file is the product** | `data.json` must be human-readable, hand-editable, and meaningful without the app. Anyone with a text editor can recover the data. |
| P3 | **Ship without a toolchain first** | v0.x is one HTML file that opens by double-clicking. Build tooling is deferred to Phase 8, after the app is already useful. |
| P4 | **No framework until measured pain** | Vanilla JS with one full `render()`. Revisit only when a module passes ~1500 lines or a measured render exceeds 100 ms. |
| P5 | **Correctness over cleverness in portal math** | Portal logic has known-correct test fixtures from the real world. It must pass them exactly. Everything else may be approximate; this may not. |

---

## 2. Technology stack

### 2.1 v0.x — single file, zero build

| Layer | Choice | Rationale |
|---|---|---|
| Application | One `index.html`, inline `<style>` and `<script>` | Zero tooling. Edit, refresh, see the change. Buildable in one evening. |
| Language | Vanilla ES2022 JavaScript | Optional chaining, `??`, `structuredClone`, `crypto.randomUUID` all available in Edge/Chrome on Win11. |
| Storage | `localStorage` under key `blockbook.data` + manual JSON export/import | No permissions, no file dialogs, instant. |
| Styling | Hand-written CSS with custom properties | See [04-UIUX-SPEC §2](04-UIUX-SPEC.md) for the token set. |
| Framework | **None** | Per P4. |
| Dev server | Optional — VS Code Live Server | `file://` works fine except for `fetch()` of `seed.json`; see §6.1. |

### 2.2 v1.x — Tauri desktop

| Layer | Choice | Version | Rationale |
|---|---|---|---|
| Shell | **Tauri** | 2.x | Uses the OS WebView2 rather than bundling Chromium: ~10 MB app, ~30–40 MB idle RAM. Electron would cost 100 MB+ and hundreds of MB of RAM beside a running game. |
| Native backend | **Rust** (stable, via `rustup`) | latest stable | Filesystem, global hotkey, tray only. Expect ~60 lines of hand-written Rust; most work is plugin configuration. |
| Frontend | The same vanilla HTML/CSS/JS from v0 | — | The entire point of building v0 first. |
| Bundler | **Vite** | latest | Arrives with the Tauri scaffold. Optional — raw HTML can be served directly. |
| Node | **LTS 22+** | — | Scaffold and dev server only. Not a runtime dependency of the shipped app. |
| Storage | `data.json` via `@tauri-apps/plugin-fs` | — | Portable: the file sits next to the exe. |

### 2.3 Tauri plugins

| Plugin | Purpose | Introduced in |
|---|---|---|
| `@tauri-apps/plugin-fs` | Read/write `data.json`, backups | Phase 10 |
| `@tauri-apps/plugin-global-shortcut` | `Ctrl+Space` summon | Phase 9 |
| `@tauri-apps/plugin-clipboard-manager` | Copy `/tp` commands | Phase 9 |
| `@tauri-apps/plugin-dialog` | Import/export file pickers | Phase 10 |
| `@tauri-apps/plugin-opener` | Open wiki links in the system browser | Phase 12 |

Add plugins **one per phase**. Adding several at once makes a permission-manifest
error impossible to attribute.

### 2.4 Windows prerequisites for Tauri

Install before starting Phase 8, not before Phase 0.

1. **Microsoft C++ Build Tools** — "Desktop development with C++" workload. ~6 GB.
2. **WebView2** — already present on Windows 11.
3. **Rust** — via `rustup` from https://rustup.rs
4. **Node LTS 22+** — from https://nodejs.org

Scaffold: `npm create tauri-app@latest` → choose vanilla JS.

---

## 3. System architecture

### 3.1 v0.x

```
┌─────────────────────────────────────────────┐
│  Browser tab (Edge / Chrome)                │
│  ┌───────────────────────────────────────┐  │
│  │  index.html                           │  │
│  │  ┌─────────────┐   ┌───────────────┐  │  │
│  │  │  state {}   │──▶│  render()     │  │  │
│  │  │  (in-memory)│   │  (full redraw)│  │  │
│  │  └──────┬──────┘   └───────────────┘  │  │
│  │         │ save() on every mutation    │  │
│  │         ▼                             │  │
│  │  ┌─────────────┐                      │  │
│  │  │ localStorage│                      │  │
│  │  └─────────────┘                      │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 3.2 v1.x

```
┌──────────────────────────────────────────────────────────┐
│  Tauri window (WebView2)                                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Frontend — unchanged vanilla JS                   │  │
│  │  main.js · store.js · locations.js · portals.js    │  │
│  │  brewing.js · reftable.js · xaero.js               │  │
│  └───────────────────┬────────────────────────────────┘  │
│                      │ Tauri IPC                         │
│  ┌───────────────────▼────────────────────────────────┐  │
│  │  Rust core (src-tauri/src/main.rs)                 │  │
│  │  • window: always-on-top, position memory          │  │
│  │  • global shortcut: Ctrl+Space toggle              │  │
│  │  • tray: Show / Hide / Quit                        │  │
│  │  • close → hide, not quit                          │  │
│  └───────────────────┬────────────────────────────────┘  │
└──────────────────────┼───────────────────────────────────┘
                       ▼
        ┌──────────────────────────────────┐
        │  Filesystem (beside the exe)     │
        │   data.json                      │
        │   data.json.tmp   (write buffer) │
        │   backups/data-YYYYMMDD-HHMMSS   │
        └──────────────────────────────────┘
```

### 3.3 State model

One mutable module-scope object. One save path. One render path.

```js
let state = {
  data: { /* the full data.json contents — see 05-DATA-SCHEMA */ },
  ui: {
    activeTab: "coordinates",   // coordinates | portals | brewing | reference
    search: "",
    filters: { dimension: null, type: null },
    sort: "updated",            // name | type | updated
    editingId: null,
    modal: null,                // null | "add" | "edit" | "import" | "settings"
    recentlyViewed: []          // location ids, max 8
  }
};
```

**Rules:**
- `state.data` is persisted. `state.ui` is **never** persisted — except for the small
  set of durable preferences that live in `state.data.settings` (theme, always-on-top,
  hotkey, coord format, active world).
- Every mutation goes through a mutator that calls `save()` then `render()`. No
  component reaches into the DOM to patch a single node.
- `render()` rebuilds the active tab's content from `state`. At 500 locations this is
  well under the 100 ms budget; do not optimise before measuring.

---

## 4. Module design (v1.x file layout)

| Module | Responsibility | Must not |
|---|---|---|
| `main.js` | Bootstrap, tab routing, global keyboard handler, wiring | Contain business logic |
| `store.js` | Load, save, schema detection, migration, backup rotation, atomic write | Know about the DOM |
| `locations.js` | Location CRUD, search, filter, sort, validation | Know about portals' link math |
| `portals.js` | `toNether`, `toOverworld`, `findLinkConflicts`, `linkHealth`, distance | Touch storage |
| `brewing.js` | Brewing tab: tree rendering, reverse ingredient lookup | Duplicate `reftable.js` |
| `reftable.js` | **One** generic searchable/sortable table renderer | Contain any domain knowledge |
| `xaero.js` | Waypoint parse + serialise, backup-before-write | Be trusted; it is best-effort |
| `style.css` | All styling, tokens at `:root` | Use `!important` |

**Dependency rule — one direction only:**

```
main.js
  ├─▶ store.js          (no dependencies)
  ├─▶ locations.js ─────▶ portals.js
  ├─▶ brewing.js ───────▶ reftable.js
  └─▶ xaero.js ─────────▶ portals.js
```

`portals.js` and `reftable.js` are leaves. They import nothing from the app. That is
what makes them testable in isolation and reusable — keep it that way.

---

## 5. Data & storage

Full schema in [05-DATA-SCHEMA](05-DATA-SCHEMA.md). Storage mechanics here.

### 5.1 Storage backends by version

| Version | Backend | Location |
|---|---|---|
| v0.x | `localStorage["blockbook.data"]` | Browser profile |
| v1.0+ | `data.json` | Beside the exe; else `%APPDATA%\BlockBook\` |

### 5.2 Portable-mode resolution order

```
1. <exe directory>\data.json           ← portable mode; preferred
2. %APPDATA%\BlockBook\data.json       ← fallback when (1) is unwritable
3. Neither exists → create at (1); if that write fails, create at (2)
```

Show the resolved path in Settings. When the user asks "where is my data", the app
must answer without guessing.

### 5.3 Write protocol — non-negotiable

Every write, without exception:

```
1. Serialise state.data to a string.        (fail fast if this throws — write nothing)
2. Copy the current data.json →
     backups/data-YYYYMMDD-HHMMSS.json
3. Write the string to data.json.tmp
4. fsync / flush
5. Rename data.json.tmp → data.json        (atomic on NTFS)
6. Prune backups/ to the newest 20
```

**Why:** a crash between steps 3 and 5 leaves the previous `data.json` fully intact.
A crash at any point leaves at least one valid backup. This is the entire mitigation
for the project's highest-severity risk.

**Debounce writes by 400 ms** so typing in a notes field does not generate 40 backups.
Flush immediately on window close, hide-to-tray, and before any import.

### 5.4 Migration

`schemaVersion` is present from day one, starting at `1`. On load:

```
loaded.schemaVersion > CURRENT  → refuse to load, show "data written by a newer version"
loaded.schemaVersion < CURRENT  → run migrations in sequence, back up first, then save
loaded.schemaVersion missing    → treat as version 1
```

Migrations are pure functions `(data) => data`, held in an ordered array in `store.js`.
Never edit an old migration; append a new one.

---

## 6. Technical constraints & known pitfalls

### 6.1 `file://` blocks `fetch()`

Opening `index.html` directly makes `fetch("seed.json")` fail on CORS.

**Resolution:** in v0, inline the seed array directly in the script as a JS constant.
Ship `data/seed.json` as the human-readable copy of record. Once Vite or Tauri is in
play (Phase 8), switch to `fetch`.

### 6.2 Global hotkeys and exclusive fullscreen

A global shortcut does **not** reach BlockBook when Minecraft runs in exclusive
fullscreen. There is no workaround at the app level.

**Resolution:** require Windowed or Borderless mode. State this in the README, in
Settings, and in the first-run message. This is a documented limitation, not a bug.

### 6.3 Nether Y-scaling

`Y` is **never** divided or multiplied. Only X and Z scale by 8. This mistake is
extremely common and silently produces plausible-looking wrong answers.

**Resolution:** the conversion functions take and return only `{x, z}` — Y is
structurally absent from their signature so it cannot be scaled by accident.

### 6.4 Negative coordinate rounding

`Math.floor(-495 / 8)` is `-62`, while `Math.trunc` gives `-61`. Minecraft's portal
target uses floor semantics. Getting this wrong shifts every negative-coordinate
result by one block.

**Resolution:** always `Math.floor`. Covered by an explicit test case in
[09-TESTING-QA](09-TESTING-QA.md).

### 6.5 Xaero waypoint format drift

The colon-delimited field layout has changed across mod versions. Any layout written
from memory will be wrong for some installation.

**Resolution:** Phase 11 begins by opening the user's real waypoint file and counting
fields. The parser is written against that file. Always back up before writing.
The exporter is explicitly best-effort and is never on the critical path.

### 6.6 localStorage survives the Tauri wrap

WebView2 provides localStorage, so Phase 8 changes nothing about persistence.

**Resolution:** keep Phase 8 (wrap) and Phase 10 (file storage) as separate commits.
When something breaks, the cause is unambiguous.

### 6.7 Reference-data version drift

Potion durations shift between game releases.

**Resolution:** `data/brewing.json` carries a `gameVersion` field and a `verified`
boolean. The UI shows an unobtrusive "unverified for your version" hint while
`verified` is false. Graph *structure* (what makes what) is stable; only durations drift.

---

## 7. Non-functional requirements

| Category | Requirement | Verification |
|---|---|---|
| **Performance** | Hotkey → readable answer < 3 s | Stopwatch, 5 trials, worst case counts |
| | Cold start → interactive < 1.5 s | Manual timing |
| | Full render of 500 locations < 100 ms | `performance.now()` around `render()` |
| | Search keystroke → updated list < 50 ms | Same |
| **Resource** | Idle RAM < 60 MB | Task Manager, app idle 60 s |
| | Installed size < 20 MB | Explorer properties on the build output |
| **Reliability** | Zero data-loss incidents | Backup directory non-empty and valid after every session |
| | Corrupt `data.json` never blocks startup | Fault-injection test — see [09-TESTING-QA](09-TESTING-QA.md) |
| **Portability** | Folder copy fully restores state on another PC | Success criterion S6 |
| **Security** | No network egress at runtime | No `fetch`/`XHR` to remote hosts anywhere in the source |
| | No elevated permissions | App runs as a standard user |
| **Accessibility** | Fully keyboard-operable | Complete every core journey without a mouse |
| | Text contrast ≥ 4.5:1 | Contrast checker on the dark theme tokens |
| **Maintainability** | No module over ~1500 lines | Line count check at each phase gate |
| | A new reference tab takes < 2 hrs | Timed when Phase 12 starts |

---

## 8. Error handling policy

| Failure | Behaviour |
|---|---|
| `data.json` missing | Create a fresh dataset from `seed.json`. Not an error. |
| `data.json` unparseable | **Do not overwrite it.** Rename to `data.json.corrupt-<timestamp>`, load the newest valid backup, and show a persistent banner naming both files. |
| `schemaVersion` newer than the app | Refuse to load. Show the version numbers. Never migrate downward. |
| Write fails (locked, disk full) | Keep the in-memory state, show a persistent error banner with the target path, retry on the next mutation. Never silently discard a change. |
| Import file invalid | Reject before touching state. Show the parse error with a line number. |
| Y out of range for the dimension | Warn inline, allow save. The player may know something the validator does not. |
| Portal link conflict detected | Warn, allow save. Informational, never blocking. |
| Xaero waypoint parse failure | Abort the import, name the offending line, change nothing. |

**The rule underneath all of these:** a failed operation never destroys existing data,
and it never fails silently.

---

## 9. Development environment

| Tool | Purpose | Required from |
|---|---|---|
| VS Code | Editor | Phase 0 |
| Live Server extension | Auto-reload | Phase 0 (optional) |
| Edge or Chrome | v0 runtime and DevTools | Phase 0 |
| Git | Version control | Phase 0 — **`git init` before writing any code** |
| Node LTS 22+ | Tauri scaffold, Vite | Phase 8 |
| Rust (rustup) | Tauri backend | Phase 8 |
| MSVC C++ Build Tools | Rust linker on Windows | Phase 8 |

### Git conventions

- Commit at the end of every phase, minimum. Tag phase completions: `phase-4`, `v0.3`.
- One concern per commit. Phase 8 (wrap) and Phase 10 (storage) must never share one.
- `.gitignore` covers `node_modules/`, `dist/`, `target/`, `backups/`, and `data.json`
  — real world data is personal and does not belong in a repo, even a private one.
- Push to a **private** GitHub repo. It doubles as off-site backup (Phase 13).
