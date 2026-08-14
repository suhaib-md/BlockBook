# 06 — Implementation Plan

**Product:** BlockBook · **Date:** 2026-08-14

Fourteen phases. Each has a **goal**, a **checklist**, the **docs it needs**, and a
**Done when** gate. Do not start a phase until the previous gate passes.

Time estimates assume learning as you go. They are honest, not optimistic.

---

## Progress tracker

| Phase | Name | Est. | Ships | Status |
|---|---|---|---|---|
| 0 | Setup | 0.5 h | — | ☐ |
| 1 | Data model + seed | 1 h | — | ☐ |
| 2 | UI shell + list | 2 h | — | ☐ |
| 3 | CRUD + search + filter | 2 h | **v0.1** | ☐ |
| 4 | Nether math + validator ⭐ | 1.5 h | **v0.2** | ☐ |
| 5 | Import / export | 1.5 h | — | ☐ |
| 6 | Brewing tab | 2 h | **v0.3** | ☐ |
| — | **🛑 USE IT FOR A WEEK** | 7 days | — | ☐ |
| 7 | Polish | 1.5 h | — | ☐ |
| 8 | Tauri wrap | 3 h | — | ☐ |
| 9 | Overlay behaviour | 2 h | — | ☐ |
| 10 | File storage + backups | 2 h | **v1.0** | ☐ |
| 11 | Xaero's integration | 3 h | **v1.1** | ☐ |
| 12 | More reference tabs | 2 h each | **v1.2** | ☐ |
| 13 | Ship properly | 2 h | — | ☐ |

**Cumulative:** v0.3 ≈ 11 h · v1.0 ≈ 19 h · v1.1 ≈ 24 h · v1.2 ≈ 32 h

---

## PHASE 0 — Setup · 30 min

**Goal:** a folder and a file that opens.

- [ ] `index.html` in the project root — a heading and nothing else
- [ ] `git init`; commit the docs and the empty shell
- [ ] Open `index.html` in Edge. Pin the tab.
- [ ] Optional: VS Code "Live Server" extension for auto-reload
- [ ] Confirm `.gitignore` covers `node_modules/`, `dist/`, `target/`, `backups/`, `data.json`

**Docs:** [02-TRD §9](02-TRD.md)

**✅ Done when:** you edit the file, hit refresh, and see the change.

**Do not:** install Node, Rust, or the C++ build tools yet. That is Phase 8. Installing
6 GB of toolchain before writing a line of code is how projects die at Phase 0.

---

## PHASE 1 — Data model + seed · 1 hr

**Goal:** the real coordinates exist as structured data.

- [ ] Copy the JSDoc block from [05-DATA-SCHEMA §10](05-DATA-SCHEMA.md) to the top of the script
- [ ] Inline `data/seed.json`'s array as a JS constant — **not** `fetch()`; `file://`
      blocks it (see [02-TRD §6.1](02-TRD.md))
- [ ] Write `buildInitialData(seed)` producing the full root document: fills `id`,
      `tags: []`, `notes: ""`, `linkedPortalId: null`, `favorite: false`, timestamps
- [ ] Set the two `linkedPortalId` values for the verified Trial ↔ Fortress pair
- [ ] `console.log(state.data)` and count

**Docs:** [05-DATA-SCHEMA](05-DATA-SCHEMA.md)

**✅ Done when:** the console prints all 15 locations, every one with all 13 fields
present, and the Trial ↔ Fortress link is symmetric in both directions.

---

## PHASE 2 — UI shell + list rendering · 2 hrs

**Goal:** see the coordinates on screen.

- [ ] Paste the token block from [04-UIUX-SPEC §2](04-UIUX-SPEC.md) into `:root`
- [ ] Tab bar: Coordinates · Portals · Brewing · Reference (last three are stubs)
- [ ] One `render()` that rebuilds the active tab from `state`
- [ ] Location card per [04-UIUX-SPEC §4.1](04-UIUX-SPEC.md): icon, name, coordinate, dimension badge
- [ ] Coordinates in `--font-mono` so digits align down the column
- [ ] Dimension badge colours: OW green, NE red, EN purple
- [ ] Sort control: name · type · recently updated
- [ ] Status bar: counts

**Docs:** [04-UIUX-SPEC §§2–4](04-UIUX-SPEC.md)

**✅ Done when:** all 15 locations render and are readable at a glance from a metre away.

**Watch out for:** do not build a component abstraction. One `render()` that rebuilds
from state is the correct architecture at this size. A "component system" here is
pure cost.

---

## PHASE 3 — CRUD + search + filter · 2 hrs → **ships v0.1**

**Goal:** a genuine Notepad replacement.

- [ ] Add modal per [04-UIUX-SPEC §4.7](04-UIUX-SPEC.md) — **dimension has no default**
- [ ] `validateLocation()` implementing all errors E1–E7 from [05-DATA-SCHEMA §7](05-DATA-SCHEMA.md)
- [ ] Y range hint updates the instant a dimension is selected (W1)
- [ ] Edit reuses the same modal, prefilled
- [ ] Delete with a confirm that **names the location** — not "Are you sure?"
- [ ] Search box: live filter on name → tags → notes, in that priority order
- [ ] Filter chips: dimension (single-select) + type (dropdown)
- [ ] `save()` to `localStorage["blockbook.data"]` on every mutation, 400 ms debounce
- [ ] `load()` on boot; fall back to seed when absent
- [ ] Autofocus the search box on load

**Docs:** [03-APP-FLOW §§3–4](03-APP-FLOW.md), [04-UIUX-SPEC §4.7](04-UIUX-SPEC.md), [05-DATA-SCHEMA §7](05-DATA-SCHEMA.md)

**✅ Done when:** you add a coordinate, close the browser entirely, reopen, and it is
still there. Search "spawner" returns exactly 3 results.

---

## PHASE 4 — Nether math + validator · 1.5 hrs ⭐ → **ships v0.2**

**Goal:** the feature that justifies the whole project.

- [ ] `toNether(x, z)` and `toOverworld(x, z)` — **`{x, z}` only, no Y in the signature**
- [ ] `Math.floor`, never `Math.trunc` — see [07-ALGORITHMS §2.2](07-ALGORITHMS.md)
- [ ] Portals tab: live bidirectional converter, no Convert button
- [ ] Permanent text under the converter: "Y is not converted."
- [ ] Counterpart coordinate on every portal card
- [ ] `findLinkConflicts()` per [07-ALGORITHMS §3](07-ALGORITHMS.md)
- [ ] Live conflict warning in the Add form when `type == "portal"`
- [ ] `linkHealth()` — **bidirectional**, per [07-ALGORITHMS §4](07-ALGORITHMS.md)
- [ ] Badges ✅ / 🟡 / ❌ on portal cards; broken count in the status bar
- [ ] Partner dropdown; setting it writes **both** sides of the link

**Docs:** [07-ALGORITHMS](07-ALGORITHMS.md) — read the whole thing first

**✅ Done when — this is the correctness test, and both answers are already known:**

1. Entering a portal at Overworld `631 / 245` produces an amber warning naming
   **Home Portal (Nether side)** at **62.5 blocks**.
2. The Trial Chamber ↔ Fortress pair reports `4.1` blocks in the overworld→nether
   direction and `33.2` in the nether→overworld direction.
3. `toNether(-1926)` returns `-241`, not `-240`.

If any of the three is off, stop. Do not proceed to Phase 5 with broken portal maths —
it is the one thing in this app that must be exactly right.

---

## PHASE 5 — Import / export · 1.5 hrs

**Goal:** portability. The app becomes safe to trust with real data.

- [ ] Export → `blockbook-YYYY-MM-DD.json`, pretty-printed, 2-space indent
- [ ] Import from file → validate `app` and `schemaVersion` before touching state
- [ ] Merge vs Replace choice; Replace requires a second confirm
- [ ] Notepad importer: textarea + the parser from [07-ALGORITHMS §6](07-ALGORITHMS.md)
- [ ] **Review screen** per [04-UIUX-SPEC §4.9](04-UIUX-SPEC.md) — mandatory, no bypass
- [ ] Import blocked while any checked row has an unset dimension
- [ ] Copy `/tp x y z` per location; toast on success

**Docs:** [03-APP-FLOW §§7–8](03-APP-FLOW.md), [07-ALGORITHMS §6](07-ALGORITHMS.md)

**✅ Done when:** export → `localStorage.clear()` → reload → import → all 15 locations
back, including both sides of the portal link. And: pasting the two-coordinates-on-one-line
case produces **two separate rows**, not one pair.

---

## PHASE 6 — Brewing tab · 2 hrs → **ships v0.3** 🎉

**Goal:** stop alt-tabbing to a wiki.

- [ ] Verify `data/brewing.json` durations against minecraft.wiki for your exact game
      version; then set `"verified": true`
- [ ] Build `reftable.js` — the **generic** searchable/sortable table renderer.
      It must contain zero brewing knowledge. Every future reference tab reuses it.
- [ ] Potion list with search
- [ ] Detail view: the full chain, rendered per [04-UIUX-SPEC §4.10](04-UIUX-SPEC.md)
- [ ] Reverse lookup: "I have X, what can I brew?"
- [ ] Modifier table + corruption table as a persistent sidebar

**Docs:** [08-REFERENCE-DATA](08-REFERENCE-DATA.md), [03-APP-FLOW §9](03-APP-FLOW.md)

**✅ Done when:** with the network disconnected, you can answer "how do I make splash
Fire Resistance" entirely inside the app, and typing "magma" tells you it makes
Fire Resistance.

---

## 🛑 MANDATORY PAUSE — use v0.3 for one week

**Do not start Phase 7.** Play the game. Use the app. Keep a note of every friction
point.

The week reorders the remaining phases based on what actually annoyed you, and it is
never quite what the plan predicted. This pause is the highest-value item in this
document — it is also the easiest one to skip.

---

## PHASE 7 — Polish · 1.5 hrs

**Goal:** make it pleasant. Informed by the week.

- [ ] Full keyboard map from [03-APP-FLOW §11](03-APP-FLOW.md)
- [ ] `Esc` cascade: modal → search → hide
- [ ] Favourites pinned in their own section
- [ ] Type icons ([04-UIUX-SPEC §4.3](04-UIUX-SPEC.md)) — emoji only
- [ ] Empty states ([04-UIUX-SPEC §6](04-UIUX-SPEC.md))
- [ ] Recently viewed, max 8
- [ ] `↓`/`↑` row focus, `Enter` copies, `Shift+Enter` edits

**✅ Done when:** every journey in [03-APP-FLOW](03-APP-FLOW.md) completes without a mouse.

---

## PHASE 8 — Tauri wrap · 2–3 hrs

**Goal:** a real `.exe`. **Nothing else changes in this phase.**

- [ ] Install prerequisites: C++ Build Tools (~6 GB), Rust via rustup, Node LTS 22+
- [ ] `npm create tauri-app@latest` → vanilla JS
- [ ] Split the single file into the modules from [02-TRD §4](02-TRD.md)
- [ ] Switch the inline seed constant to `fetch("data/seed.json")` — it works now
- [ ] `npm run tauri dev`
- [ ] Window config in `tauri.conf.json`: 900×640, min 560×400, title "BlockBook"
- [ ] `npm run tauri build`

**Docs:** [02-TRD §§2.2–2.4, §4](02-TRD.md)

**✅ Done when:** the exe runs with every v0.3 feature intact.

**Watch out for:** localStorage still works inside WebView2, so persistence does not
change here. **Keep Phase 8 and Phase 10 in separate commits.** When something breaks
you must be able to tell which change did it.

---

## PHASE 9 — Overlay behaviour · 2 hrs

**Goal:** usable *during* play.

- [ ] `alwaysOnTop: true` in `tauri.conf.json` + a Settings toggle
- [ ] `plugin-global-shortcut`: `Ctrl+Space` toggles show/hide
- [ ] On show: raise, focus the search box, **select** existing text (don't clear it)
- [ ] Tray icon: Show · Hide · Quit
- [ ] Close `[X]` hides to tray instead of quitting
- [ ] `plugin-clipboard-manager` for the `/tp` button
- [ ] Persist and restore window position and size
- [ ] Optional: compact mode, 420×520, search + results only

**Docs:** [03-APP-FLOW §2.2](03-APP-FLOW.md)

**✅ Done when:** Minecraft is running borderless-windowed; `Ctrl+Space`, type
"spawner", read the coordinate — and the game never minimises.

**Watch out for:** global hotkeys **do not reach the app in exclusive fullscreen**.
There is no fix. Document it in the README, in Settings → About, and in the first-run
message.

---

## PHASE 10 — File storage + backups · 2 hrs → **ships v1.0** 🎉

**Goal:** true portability and zero data loss.

- [ ] `plugin-fs` read/write of `data.json`
- [ ] Portable-mode path resolution per [02-TRD §5.2](02-TRD.md)
- [ ] Show the resolved path in Settings, with "Open folder"
- [ ] One-time migration: localStorage has data and `data.json` does not → write it out, keep both for one release
- [ ] **Atomic write**: serialise → backup → write `.tmp` → flush → rename
- [ ] Rolling backups in `backups/`, prune to the newest 20
- [ ] `plugin-dialog` for import/export pickers
- [ ] Corrupt-file recovery: quarantine, load newest backup, persistent banner
- [ ] Flush pending writes on hide-to-tray and on quit

**Docs:** [02-TRD §§5.2–5.4, §8](02-TRD.md)

**✅ Done when all six [PRD §6.1](01-PRD.md) success criteria pass**, plus the
fault-injection test: corrupt `data.json` by hand, launch, and confirm the app recovers
from a backup **without overwriting the corrupt file**.

---

## PHASE 11 — Xaero's integration · 2–3 hrs → **ships v1.1**

**Goal:** the app and the in-game map stay in sync.

- [ ] **First, before writing any code:** open your real waypoint file and count the
      fields. Do not trust any documented layout, including the one in
      [BUILD_PLAN §9](../BUILD_PLAN.md). Write the observed layout into this file.
- [ ] Locate the files:
      `.minecraft\XaeroWaypoints\<world>\dim%0\` (OW) · `dim%-1\` (Nether) · `dim%1\` (End)
- [ ] Parser → `Location[]`
- [ ] Serialiser → one file per dimension
- [ ] **Back up the original before every write.** No exceptions.
- [ ] Warn: "Close Minecraft first — Xaero's caches waypoints in memory and will
      overwrite your changes on exit."
- [ ] Map `type` → Xaero colour index 0–15
- [ ] Generate 1–2 character initials from names
- [ ] Distance / nearest-to, cross-dimension aware ([07-ALGORITHMS §5](07-ALGORITHMS.md))

**✅ Done when:** a waypoint file round-trips — import, export, and the output is
functionally identical to the input.

**If you use JourneyMap instead:** target it first. Its waypoints are individual JSON
files under `.minecraft\journeymap\data\sp\<world>\waypoints\` — dramatically easier
and less fragile than Xaero's positional text format.

---

## PHASE 12 — More reference tabs · 2 hrs each → **ships v1.2**

Priority order from [08-REFERENCE-DATA §6](08-REFERENCE-DATA.md):
enchanting → mob spawning → villager trades → fuel → XP → portal sizes → beacon.

Each tab is: hand-type a JSON, point `reftable.js` at it, register a tab.

**✅ Done when:** a new tab takes under 2 hours. **If it takes longer, `reftable.js`
is not generic enough — stop and fix the renderer instead of the tab.** That is the
whole reason it was built in Phase 6.

Multi-world support also lands here. The schema already supports it; the work is a
world switcher in the header and scoping every query to `settings.activeWorldId`.

---

## PHASE 13 — Ship properly · 2 hrs

- [ ] App icon: `npm run tauri icon path/to/512.png`
- [ ] Installer via `npm run tauri build` (`.msi` / NSIS)
- [ ] README: how to run, where data lives, the exclusive-fullscreen caveat
- [ ] Push to a **private** GitHub repo — off-site backup as well as version control
- [ ] Tag `v1.0`
- [ ] Optional: `plugin-updater` if it ever runs on two machines

---

## Rules that apply to every phase

1. **Commit at every phase boundary.** Tag version releases.
2. **One concern per commit.** Phase 8 and Phase 10 must never share one.
3. **Update [05-DATA-SCHEMA](05-DATA-SCHEMA.md) in the same commit as any field change.**
4. **Do not skip a gate.** "I'll come back to it" is how the portal maths ships wrong.
5. **Do not start the next phase's work early.** Half-finished parallel phases are
   how a solo project becomes unshippable.
6. **When a phase overruns by 2×, stop and ask why.** Usually the answer is that
   something from the non-goals list crept in ([01-PRD §5](01-PRD.md)).
