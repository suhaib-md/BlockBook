# BlockBook

A local-first desktop companion for a Java Edition Minecraft survival world:
coordinate book, nether portal math, and offline brewing/reference tables.

**Platform:** Windows 11 · **Target user:** one player, one world · **Network:** none required.

> Press a hotkey, get any coordinate or recipe in under 3 seconds, without leaving the game.

---

## Status

| | |
|---|---|
| Current version | **`v1.0` candidate** — Phases 0–10. Native exe, portable `data.json`, atomic writes, rolling backups. |
| Before calling it v1.0 | Walk the [six success criteria](docs/01-PRD.md) and the S1–S10 data-safety tests on the real exe |
| Next milestone | `v1.2` — Phase 12: enchanting, mob, villager and fuel reference tabs |
| Tests | `npm test` — 824 checks, zero dependencies |
| Reminder | Brewing durations verified for **1.21**. Set `verified: false` in `data/brewing.json` **and** the inline copy after any game update. |
| Product name | BlockBook (internal app id: `blockbook`, data file `data.json`) |

---

## Documentation

Read these in order. Each one answers a different question.

| # | Document | Answers |
|---|---|---|
| 00 | [Index & Glossary](docs/00-INDEX.md) | What every term in these docs means |
| 01 | [PRD](docs/01-PRD.md) | **What** we are building and why. Scope, non-goals, success criteria |
| 02 | [TRD](docs/02-TRD.md) | **How** it is built. Stack, architecture, modules, constraints |
| 03 | [App Flow](docs/03-APP-FLOW.md) | Screen-by-screen navigation and every user journey |
| 04 | [UI/UX Spec](docs/04-UIUX-SPEC.md) | Layout, design tokens, components, keyboard map, states |
| 05 | [Data Schema](docs/05-DATA-SCHEMA.md) | The `data.json` contract, validation rules, migrations |
| 06 | [Implementation Plan](docs/06-IMPLEMENTATION-PLAN.md) | Phase-by-phase build order with acceptance gates |
| 07 | [Algorithms](docs/07-ALGORITHMS.md) | Nether math, portal validator, importer parser — with worked examples |
| 08 | [Reference Data](docs/08-REFERENCE-DATA.md) | Brewing + future reference tabs, sourcing, JSON shapes |
| 09 | [Testing & QA](docs/09-TESTING-QA.md) | Golden test cases, manual checklists, release gates |
| 10 | [Decisions & Risks](docs/10-DECISIONS-AND-RISKS.md) | ADR log and the risk register |

Source material: [BUILD_PLAN.md](BUILD_PLAN.md) — the original plan these docs expand on.

---

## Repo layout

```
BlockBook/
├─ README.md                 <- you are here
├─ BUILD_PLAN.md             <- original source plan
├─ .gitignore
├─ package.json              <- scripts: dev, build, tauri, test
├─ vite.config.js
├─ app-icon.png              <- source for `npx tauri icon`
├─ src/                      <- the app
│  ├─ index.html
│  ├─ style.css
│  ├─ util.js schema.js portals.js reftable.js    <- leaves: pure, import nothing
│  ├─ locations.js brewing.js                     <- domain logic
│  ├─ store.js                                    <- state + persistence
│  ├─ views.js                                    <- HTML builders
│  └─ main.js                                     <- boot, render, events
├─ src-tauri/                <- Rust shell, tauri.conf.json, icons
├─ docs/                     <- all specification documents
├─ tests/                    <- phase gates; `npm test`
└─ data/
   ├─ seed.json              <- the 15 real coordinates (Vite publicDir)
   └─ brewing.json           <- brewing reference data
```

Module dependencies run one way only, and a gate check enforces it — see
[TRD §4](docs/02-TRD.md).

---

## Quick start

```powershell
npm install
npm run dev          # Vite dev server on http://localhost:1420
npm test             # all phase gates, 824 checks

npm run tauri dev    # native window (needs Rust + MSVC Build Tools)
npm run tauri build  # .exe + installer
```

**Prerequisites for the Tauri commands only** — the browser `npm run dev` needs none:

1. **Node LTS 22+** — https://nodejs.org
2. **Rust** — `rustup` from https://rustup.rs
3. **MSVC C++ Build Tools** — "Desktop development with C++" workload (~6 GB)
4. **WebView2** — already present on Windows 11

---

## Where your data lives

The desktop app writes a single **`data.json`** next to the exe. Copy that folder to a
USB stick and everything comes with it — locations, settings, and the `backups/`
folder. Settings shows the exact resolved path with an **Open folder** button.

If the exe sits somewhere unwritable (Program Files, say), it falls back to
`%APPDATA%\BlockBook\` automatically and Settings tells you so.

**Every write** backs up the previous file first, writes to a temp file, fsyncs,
then atomically renames over the real one — so a crash mid-write leaves the old file
intact. The newest 20 backups are kept. If `data.json` is ever unreadable it is moved
aside rather than overwritten, and the newest *parseable* backup is loaded in its place.

---

## Known operational caveats

- **Global hotkeys do not reach the app when Minecraft is in exclusive fullscreen.**
  Set Minecraft to Windowed or Borderless.
- **The summon hotkey must not collide with a game control.** The default is
  `Ctrl+Shift+B`; change it in Settings, or disable it and use the tray icon.
  Avoid anything built from Minecraft's own keys — `Ctrl+Space` is sprint-jump and
  will fire constantly ([ADR-015](docs/10-DECISIONS-AND-RISKS.md)).
- Brewing durations shift between game versions. Spot-check `data/brewing.json`
  against minecraft.wiki for your version before trusting it.
- **No minimap sync.** Waypoint import/export was dropped in Phase 11 — no minimap
  mod is installed, so there is nothing to read or write and no way to verify a
  format ([ADR-017](docs/10-DECISIONS-AND-RISKS.md)). The Portals tab's
  **What's near me?** panel covers the "where am I relative to my stuff" question
  instead. If a minimap is ever reinstalled, Phase 11's original checklist still
  applies — starting with reading the real waypoint file rather than trusting any
  documented layout.
