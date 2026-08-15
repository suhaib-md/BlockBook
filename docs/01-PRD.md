# 01 — Product Requirements Document

**Product:** BlockBook · **Version:** 1.0 · **Date:** 2026-08-14 · **Status:** Approved

---

## 1. Summary

BlockBook is a local-first Windows desktop companion for a single-player Minecraft
Java Edition survival world. It replaces a flat Notepad file of coordinates with a
structured, searchable, validated coordinate book; adds nether portal mathematics
that the game itself refuses to explain; and keeps brewing and reference tables
available offline so the player never alt-tabs to a browser mid-session.

**The one-line goal:**

> Press a hotkey, get any coordinate or recipe in under 3 seconds, without leaving the game.

---

## 2. Problem statement

### 2.1 Current state

The player keeps world knowledge in a single `.txt` file. Observed from the real file:

| Problem | Evidence from the actual notes |
|---|---|
| **No dimension labels** | `-495 / 66 / -394` — is that Overworld or Nether? The number is meaningless without knowing. Every ambiguity in the existing data traces to this one missing field. |
| **No structure** | Two unrelated portals written on one line separated by `----`, later misread as a linked pair. |
| **No labels** | `2411 / 22 / -326` has no name at all. The knowledge is lost. |
| **No validation** | A portal at `631 / 245` sits 62.5 blocks inside the radius where it hijacks the Home portal link. Nothing in a text file could ever have told the player that. |
| **No search** | Finding "the spider spawner" means visually scanning the file. |
| **Not portable** | Moving PCs means remembering to copy a file whose location is not obvious. |

### 2.2 Cost of the problem

- **Time:** ~10–30 seconds per lookup, several times a session, plus alt-tab context loss.
- **Correctness:** at least one portal in the existing world is at risk of an
  unintended link. Discovering this in-game costs an obsidian rebuild and possibly
  a long walk.
- **Attrition:** unlabelled coordinates become permanently useless. The file is
  actively losing information.

### 2.3 Why existing tools do not solve it

| Alternative | Why it fails here |
|---|---|
| Xaero's / JourneyMap waypoints | Excellent for *seeing* points on a map. Cannot do portal-link validation, has no notes field worth using, and is only accessible while the game is running. |
| A wiki in a browser tab | Requires alt-tab; exclusive fullscreen makes this expensive. No personal data. |
| A spreadsheet | No validation, no nether math, no keyboard-summon overlay. |
| Existing companion apps | Either server/multiplayer-oriented, cloud-dependent, or bundled with mod managers. Overkill and not offline-first. |

---

## 3. Users & context

### 3.1 The user

There is exactly one user. Design accordingly — no onboarding flows, no account
system, no permissions model, no empty-state tutorials beyond one line of text.

| Attribute | Value |
|---|---|
| Count | 1 |
| Platform | Windows 11 Home |
| Game | Minecraft Java Edition, 1.21.x |
| World | One long-running survival world |
| Technical level | Comfortable editing JSON and HTML by hand |
| Play context | Often at night, in a dark room, next to a dark game |

### 3.2 Primary usage contexts

| Context | Frequency | Dominant need |
|---|---|---|
| **Mid-game lookup** — game running, need a coordinate now | Many times per session | Speed. Hotkey, type, read, dismiss. Under 3 seconds. |
| **Mid-game reference** — "what does Magma Cream make?" | A few times per session | Offline brewing tree, searchable by ingredient. |
| **Planning** — deciding where to build a portal | Occasionally, high stakes | The validator. Correctness matters more than speed here. |
| **Bookkeeping** — after an expedition, recording finds | End of session | Fast entry. Dimension required, everything else optional. |

---

## 4. Scope

### 4.1 In scope for v1.0

| # | Capability | Detail |
|---|---|---|
| F1 | **Location CRUD** | Create, edit, delete named coordinates with dimension, x/y/z, type, tags, notes, favourite flag. |
| F2 | **Search** | Live filter as you type across name, tags, and notes. |
| F3 | **Filter** | Chips for dimension and type. Combinable with search. |
| F4 | **Sort** | By name, type, or recently updated. Favourites pinned to top. |
| F5 | **Y validation** | Reject or warn on Y values outside the dimension's legal range. |
| F6 | **Nether ↔ Overworld calculator** | Live bidirectional conversion, two input boxes. |
| F7 | **Counterpart display** | Every portal card shows its scaled counterpart coordinate. |
| F8 | **Portal link validator** | Before saving a new portal, warn if an existing portal in the destination dimension is within 128 blocks of the scaled target. |
| F9 | **Pair health badges** | For linked pairs: ✅ ≤16 / 🟡 17–128 / ❌ >128 blocks from ideal. |
| F10 | **Portal pairing** | Dropdown to set `linkedPortalId` on a portal. |
| F11 | **Export JSON** | Download the full dataset, date-stamped filename. |
| F12 | **Import JSON** | File picker, schema version check, replace-or-merge choice. |
| F13 | **Notepad importer** | Paste raw text, parse coordinates, **mandatory review screen** for dimension assignment, then commit. |
| F14 | **Copy as `/tp`** | One click puts `/tp 221 65 374` on the clipboard. |
| F15 | **Brewing tab** | Full offline brewing tree: bases, effect potions, modifiers, corruption table. Searchable. |
| F16 | **Reverse ingredient lookup** | "I have Magma Cream — what can I brew?" |
| F17 | **Native app** | Runs as a Windows `.exe` via Tauri. No browser required. |
| F18 | **Always-on-top** | Toggleable. Default on. |
| F19 | **Global hotkey** | `Ctrl+Shift+B` shows/hides the window from anywhere. |
| F20 | **System tray** | Show / Hide / Quit. Close button minimises rather than quits. |
| F21 | **Portable file storage** | `data.json` beside the exe; app data dir as fallback. |
| F22 | **Atomic writes + rolling backups** | Temp-file-then-rename. Last 20 backups retained. |
| F23 | **Keyboard shortcuts** | `/` search, `N` new, `Esc` close, `1`–`4` tabs. |
| F24 | **Dark theme** | Default and primary. |

### 4.2 In scope for v1.1+

| # | Capability | Version |
|---|---|---|
| F25 | Export to Xaero's waypoint files (with mandatory backup of the original) | v1.1 |
| F26 | Import from Xaero's waypoint files | v1.1 |
| F27 | Distance / "nearest to this point", cross-dimension aware | v1.1 |
| F28 | Enchanting reference tab | v1.2 |
| F29 | Mob spawn conditions tab | v1.2 |
| F30 | Villager trades tab | v1.2 |
| F31 | Fuel burn times, XP table, portal sizes, beacon tabs | v1.2 |
| F32 | Multi-world support (the schema already allows it) | v1.2 |

---

## 5. Non-goals

These are **rejected**, not deferred. Each one has eaten a hobby project before.

| Non-goal | Why rejected |
|---|---|
| **Multi-user, server, or cloud sync** | One user, one world. A JSON file *is* the sync layer. Adding accounts adds auth, conflict resolution, and a backend — an order of magnitude more work than the entire rest of the app. |
| **Live game integration** (memory reading, log parsing, mod bridge) | Enormous effort, fragile across game updates, and it breaks the "works offline with the game closed" property. The player types the coordinates; that takes two seconds. |
| **A map renderer** | Xaero's already does this, better, and inside the game where it belongs. This is the single most likely scope-creep trap in the project. |
| **Mobile app** | Different platform, different input model, different storage story. Not before v2, if ever. |
| **Modifying the Minecraft world or save files** | Read-only relationship with the game. The only files BlockBook may write outside its own folder are Xaero waypoint files in v1.1, and only after backing them up. |
| **Auto-updating reference data from the wiki** | Requires network, a scraper, and ongoing maintenance against a site that changes. Hand-typed JSON, updated when the player updates their game, is correct at this scale. |
| **A component framework (React/Vue/Svelte)** | The app is ~600 lines. A framework costs more setup, build tooling, and mental overhead than it saves. Revisit only if a single file exceeds ~1500 lines. |
| **Electron** | 100 MB+ binary, hundreds of MB of RAM, running next to a game that wants all of it. Tauri uses the OS WebView2 for ~10 MB and ~30–40 MB idle. |

---

## 6. Success criteria

### 6.1 v1.0 definition of done

All six must pass. These are the contract.

| # | Criterion | How it is verified |
|---|---|---|
| S1 | Every coordinate from the original Notepad file is in the app, tagged and searchable. | All 15 seed locations present; the 3 `NEEDS REVIEW` rows are resolved or explicitly flagged. |
| S2 | Typing an Overworld coordinate instantly shows the Nether counterpart. | Type `2217 / -4024` → app shows `277 / -503` with no button press. |
| S3 | The app warns before building a portal that will link to the wrong existing portal. | Enter a portal at Overworld `631 / 245` → amber warning naming "Home Portal (Nether side)" at ~63 blocks. |
| S4 | The full brewing tree is browsable offline. | Disconnect the network. Answer "how do I make splash Fire Resistance" entirely inside the app. |
| S5 | `Ctrl+Shift+B` summons the app over borderless-windowed Minecraft. | Game running borderless. Hotkey. Type "spawner". Read a coordinate. Game never minimises. |
| S6 | Copying one folder to another PC restores everything. | Copy folder to USB, run the exe on a second machine, all locations present. |

### 6.2 Quality bars

| Metric | Target | Notes |
|---|---|---|
| Hotkey → readable answer | **< 3 seconds** | The core promise. Includes window show, typing, and render. |
| Cold start to interactive | < 1.5 s | Tauri + WebView2 makes this easy; do not squander it. |
| Idle RAM | < 60 MB | It sits next to a game. Measure in Task Manager, not by feel. |
| Installed size | < 20 MB | Tauri baseline is ~10 MB. |
| Render for 500 locations | < 100 ms | Full re-render is acceptable at this scale. If it is not, virtualise then. |
| Data loss incidents | **0** | Non-negotiable. Atomic writes and backups exist for this line. |

### 6.3 Anti-metrics — signals the project has gone wrong

- The build takes longer than 10 seconds.
- `index.html` (or any single module) exceeds 1500 lines.
- Any feature requires network access at runtime.
- A reference tab takes more than 2 hours to add. (That means `reftable.js` is not
  generic enough — fix the renderer, not the tab.)
- A phase is skipped because "we'll come back to it."

---

## 7. Release plan

| Version | Contents | Cumulative effort | Gate |
|---|---|---|---|
| **v0.1** | F1–F5 | ~5.5 hrs | Add a coordinate, reload the browser, it persists |
| **v0.2** | F6–F10 | ~7 hrs | App independently flags the `631/245` collision |
| **v0.3** | F11–F16 | ~11 hrs | Export, wipe storage, import, nothing lost. **Ship. Use for one week.** |
| **v1.0** | F17–F24 | ~19 hrs | All six success criteria pass |
| **v1.1** | F25–F27 | ~24 hrs | Waypoints round-trip without corrupting the originals |
| **v1.2** | F28–F32 | ~32 hrs | — |

**The mandatory pause is after v0.3.** Use the app for a real week of play before
touching the Tauri toolchain. The week decides what v1.0 actually needs, and it is
never quite what was planned.

---

## 8. Open questions

Tracked here, resolved in-game, then folded back into the data.

| # | Question | Blocks | Resolution path |
|---|---|---|---|
| Q1 | Is `-495 / 66 / -394` Overworld or Nether? | Accuracy of one seed row | Visit it in-game. If Nether, its Overworld side is ~`-3960 / -3152`. |
| Q2 | What is `2411 / 22 / -326`? | One seed row's usefulness | Visit it. Y=22 suggests a cave or mine. |
| Q3 | Does the portal at `631 / 245` actually link to Home Portal? | Confirms the validator's real-world accuracy | Walk through it. **This is the single best test the app will ever get.** |
| Q4 | Exact coordinates of the ocean monument near the `823 / -271` shipwreck | Completeness | Next visit. |
| Q5 | Which minimap mod is installed, and what is its exact waypoint field layout? | Phase 11 only | Open the real waypoint file and count fields before writing any parser. |
| Q6 | Exact game version for brewing duration verification | Brewing data accuracy | Read it off the title screen; check durations against minecraft.wiki for that version. |
| Q7 | Where exactly is the **Overworld-side portal at Home**? | Accuracy of the Home link health badge | It is not recorded as its own location — the seed only has the Home *base*. Until it exists as a `type: "portal"` record, the Home pair's health is measured against the base and reads as 🟡 Loose (116.4 blocks backward). Record it next session. |
