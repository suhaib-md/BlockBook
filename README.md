# BlockBook

A local-first desktop companion for a Java Edition Minecraft survival world:
coordinate book, nether portal math, and offline brewing/reference tables.

**Platform:** Windows 11 · **Target user:** one player, one world · **Network:** none required.

> Press a hotkey, get any coordinate or recipe in under 3 seconds, without leaving the game.

---

## Status

| | |
|---|---|
| Current version | **`v0.3`** — Phases 0–9. Native exe with `Ctrl+Space` summon, tray, always-on-top. |
| Next milestone | `v1.0` — Phase 10: portable `data.json`, atomic writes, rolling backups |
| Tests | `npm test` — 652 checks, zero dependencies |
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
npm test             # all phase gates, 571 checks

npm run tauri dev    # native window (needs Rust + MSVC Build Tools)
npm run tauri build  # .exe + installer
```

**Prerequisites for the Tauri commands only** — the browser `npm run dev` needs none:

1. **Node LTS 22+** — https://nodejs.org
2. **Rust** — `rustup` from https://rustup.rs
3. **MSVC C++ Build Tools** — "Desktop development with C++" workload (~6 GB)
4. **WebView2** — already present on Windows 11

---

## Known operational caveats

- **Global hotkeys do not reach the app when Minecraft is in exclusive fullscreen.**
  Set Minecraft to Windowed or Borderless.
- Brewing durations shift between game versions. Spot-check `data/brewing.json`
  against minecraft.wiki for your version before trusting it.
- Xaero's waypoint file format has changed across mod versions. Never write to a
  waypoint file without backing it up first.
