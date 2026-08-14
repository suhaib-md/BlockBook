# BlockBook

A local-first desktop companion for a Java Edition Minecraft survival world:
coordinate book, nether portal math, and offline brewing/reference tables.

**Platform:** Windows 11 · **Target user:** one player, one world · **Network:** none required.

> Press a hotkey, get any coordinate or recipe in under 3 seconds, without leaving the game.

---

## Status

| | |
|---|---|
| Current version | `v0.0` — documentation complete, no code yet |
| Next milestone | `v0.1` — Phase 0–3 (see [Implementation Plan](docs/06-IMPLEMENTATION-PLAN.md)) |
| First shippable | `v0.3` — browser app, fully usable, ~11 hrs |
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
├─ docs/                     <- all specification documents
└─ data/
   ├─ seed.json              <- the 14 real coordinates, pre-parsed
   └─ brewing.json           <- brewing reference data (verify before shipping)
```

Application source (`index.html`, later `src/` and `src-tauri/`) arrives in Phase 0.

---

## Quick start (once Phase 0 is done)

```powershell
# v0.x — no build step
start index.html

# v1.x — Tauri
npm install
npm run tauri dev
```

---

## Known operational caveats

- **Global hotkeys do not reach the app when Minecraft is in exclusive fullscreen.**
  Set Minecraft to Windowed or Borderless.
- Brewing durations shift between game versions. Spot-check `data/brewing.json`
  against minecraft.wiki for your version before trusting it.
- Xaero's waypoint file format has changed across mod versions. Never write to a
  waypoint file without backing it up first.
