# 06 — Implementation Plan

**Product:** BlockBook · **Date:** 2026-08-14

Fourteen phases. Each has a **goal**, a **checklist**, the **docs it needs**, and a
**Done when** gate. Do not start a phase until the previous gate passes.

Time estimates assume learning as you go. They are honest, not optimistic.

---

## Progress tracker

| Phase | Name | Est. | Ships | Status |
|---|---|---|---|---|
| 0 | Setup | 0.5 h | — | ☑ |
| 1 | Data model + seed | 1 h | — | ☑ |
| 2 | UI shell + list | 2 h | — | ☑ |
| 3 | CRUD + search + filter | 2 h | **v0.1** | ☑ |
| 4 | Nether math + validator ⭐ | 1.5 h | **v0.2** | ☑ |
| 5 | Import / export | 1.5 h | — | ☑ |
| 6 | Brewing tab | 2 h | **v0.3** | ☑ durations verified 2026-08-15 |
| 7 | Polish | 1.5 h | — | ☑ |
| — | **🛑 USE IT FOR A WEEK** | 7 days | — | ☐ |
| 8 | Tauri wrap | 3 h | — | ☑ exe built &amp; launches · your visual pass pending |
| 9 | Overlay behaviour | 2 h | — | ☑ built &amp; close-to-tray verified · hotkey needs your test |
| 10 | File storage + backups | 2 h | **v1.0** | ☑ code + gates · S1–S10 on the real exe pending |
| 11 | Xaero's integration | 3 h | **v1.1** | ☐ |
| 12 | More reference tabs | 2 h each | **v1.2** | ☐ |
| 13 | Ship properly | 2 h | — | ☐ |

**Cumulative:** v0.3 ≈ 11 h · v1.0 ≈ 19 h · v1.1 ≈ 24 h · v1.2 ≈ 32 h

---

## PHASE 0 — Setup · 30 min

**Goal:** a folder and a file that opens.

- [x] `index.html` in the project root — a heading and nothing else
- [x] `git init`; commit the docs and the empty shell
- [ ] Open `index.html` in Edge. Pin the tab.
- [ ] Optional: VS Code "Live Server" extension for auto-reload
- [x] Confirm `.gitignore` covers `node_modules/`, `dist/`, `target/`, `backups/`, `data.json`
      — verified with `git check-ignore -v`, not just by reading the file

**Docs:** [02-TRD §9](02-TRD.md)

**✅ Done when:** you edit the file, hit refresh, and see the change.

**Do not:** install Node, Rust, or the C++ build tools yet. That is Phase 8. Installing
6 GB of toolchain before writing a line of code is how projects die at Phase 0.

---

## PHASE 1 — Data model + seed · 1 hr

**Goal:** the real coordinates exist as structured data.

- [x] Copy the JSDoc block from [05-DATA-SCHEMA §10](05-DATA-SCHEMA.md) to the top of the script
- [x] Inline `data/seed.json`'s array as a JS constant — **not** `fetch()`; `file://`
      blocks it (see [02-TRD §6.1](02-TRD.md))
- [x] Write `buildInitialData(seed)` producing the full root document: fills `id`,
      `tags: []`, `notes: ""`, `linkedPortalId: null`, `favorite: false`, timestamps
- [x] Set the two `linkedPortalId` values for the verified Trial ↔ Fortress pair
- [x] `console.log(state.data)` and count
- [x] **Added:** `repairPortalLinks()` enforcing invariants I1–I4 and link symmetry
      ([05-DATA-SCHEMA §4.4](05-DATA-SCHEMA.md)). The schema requires it and it is
      pure data-model work, so it belongs here rather than in Phase 4.

**Docs:** [05-DATA-SCHEMA](05-DATA-SCHEMA.md)

**✅ Done when:** the console prints all 15 locations, every one with all 13 fields
present, and the Trial ↔ Fortress link is symmetric in both directions.

---

## PHASE 2 — UI shell + list rendering · 2 hrs

**Goal:** see the coordinates on screen.

- [x] Paste the token block from [04-UIUX-SPEC §2](04-UIUX-SPEC.md) into `:root`
- [x] Tab bar: Coordinates · Portals · Brewing · Reference (last three are stubs)
- [x] One `render()` that rebuilds the active tab from `state`
- [x] Location card per [04-UIUX-SPEC §4.1](04-UIUX-SPEC.md): icon, name, coordinate, dimension badge
- [x] Coordinates in `--font-mono` so digits align down the column
      — plus `font-variant-numeric: tabular-nums`, without which "1" is narrower
      than "8" and a column of coordinates still fails to line up
- [x] Dimension badge colours: OW green, NE red, EN purple
- [x] Sort control: name · type · recently updated
- [x] Status bar: counts
- [x] **Added:** `--motion-*` duration tokens, zeroed under
      `prefers-reduced-motion`. [04-UIUX-SPEC §7](04-UIUX-SPEC.md) forbids
      `!important`, and tokens are how you honour reduced motion without it.

**Docs:** [04-UIUX-SPEC §§2–4](04-UIUX-SPEC.md)

**✅ Done when:** all 15 locations render and are readable at a glance from a metre away.

**Watch out for:** do not build a component abstraction. One `render()` that rebuilds
from state is the correct architecture at this size. A "component system" here is
pure cost.

---

## PHASE 3 — CRUD + search + filter · 2 hrs → **ships v0.1**

**Goal:** a genuine Notepad replacement.

- [x] Add modal per [04-UIUX-SPEC §4.7](04-UIUX-SPEC.md) — **dimension has no default**
- [x] `validateLocation()` implementing all errors E1–E7 from [05-DATA-SCHEMA §7](05-DATA-SCHEMA.md)
      — plus warnings W1, W3, W5, W6. W2 and W4 need portal maths and land in Phase 4;
      `validateLocation` takes an `extraWarnings` argument as their injection point.
- [x] Y range hint updates the instant a dimension is selected (W1)
- [x] Edit reuses the same modal, prefilled
- [x] Delete with a confirm that **names the location** — not "Are you sure?"
- [x] Search box: live filter on name → tags → notes, in that priority order
- [x] Filter chips: dimension (single-select) + type (dropdown)
- [x] `save()` to `localStorage["blockbook.data"]` on every mutation, 400 ms debounce
- [x] `load()` on boot; fall back to seed when absent
- [x] Autofocus the search box on load
- [x] **Added:** corrupt-data quarantine and newer-schema refusal
      ([02-TRD §8](02-TRD.md)). The error policy applies from the first storage
      backend, not from Phase 10 — a bad parse must never cost the user data.
- [x] **Added:** empty states ([04-UIUX-SPEC §6](04-UIUX-SPEC.md)) — reachable as
      soon as filters exist, so they could not wait for Phase 7.

**Decision recorded:** the draft holds coordinates and tags as **raw strings**, parsed
only on demand. The modal re-renders each keystroke; writing back a parsed value made
a lone `-` vanish before the digits arrived, so negative coordinates were untypable.

**Decision recorded:** while a search query is active, relevance ordering overrides the
sort control, which is disabled with a tooltip. [03-APP-FLOW §3](03-APP-FLOW.md)
requires the best match first.

**Docs:** [03-APP-FLOW §§3–4](03-APP-FLOW.md), [04-UIUX-SPEC §4.7](04-UIUX-SPEC.md), [05-DATA-SCHEMA §7](05-DATA-SCHEMA.md)

**✅ Done when:** you add a coordinate, close the browser entirely, reopen, and it is
still there. Search "spawner" returns exactly 3 results.

---

## PHASE 4 — Nether math + validator · 1.5 hrs ⭐ → **ships v0.2**

**Goal:** the feature that justifies the whole project.

- [x] `toNether(x, z)` and `toOverworld(x, z)` — **`{x, z}` only, no Y in the signature**
- [x] `Math.floor`, never `Math.trunc` — see [07-ALGORITHMS §2.2](07-ALGORITHMS.md)
- [x] Portals tab: live bidirectional converter, no Convert button
- [x] Permanent text under the converter: "Y is not converted."
- [x] Counterpart coordinate on every portal card
- [x] `findLinkConflicts()` per [07-ALGORITHMS §3](07-ALGORITHMS.md)
- [x] Live conflict warning in the Add form when `type == "portal"`
- [x] `linkHealth()` — **bidirectional**, per [07-ALGORITHMS §4](07-ALGORITHMS.md)
- [x] Badges ✅ / 🟡 / ❌ on portal cards; broken count in the status bar
- [x] Partner dropdown; setting it writes **both** sides of the link
- [x] **Added:** `setPortalLink()`. Re-pairing a portal that already had a partner
      left the *old* partner pointing at it one-sidedly; `repairPortalLinks` would
      then "fix" that by flipping the new link back, an order-dependent tug of war.
      `setPortalLink` unhooks both previous partners before writing the new pair.
- [x] **Added:** W2 is suppressed for the portal you have actually declared as the
      partner. A partner sitting inside the radius is the desired outcome, not a
      conflict — warning about it would train the user to ignore the warning.
- [x] **Added:** `tests/` — the four phase gates plus `run-all.mjs`. No framework
      and no dependency; see [09-TESTING-QA §1.1](09-TESTING-QA.md).

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

- [x] Export → `blockbook-YYYY-MM-DD.json`, pretty-printed, 2-space indent
- [x] Import from file → validate `app` and `schemaVersion` before touching state
- [x] Merge vs Replace choice; Replace requires a second confirm
- [x] Notepad importer: textarea + the parser from [07-ALGORITHMS §6](07-ALGORITHMS.md)
- [x] **Review screen** per [04-UIUX-SPEC §4.9](04-UIUX-SPEC.md) — mandatory, no bypass
- [x] Import blocked while any checked row has an unset dimension
- [x] Copy `/tp x y z` per location; toast on success — a `null` Y emits `~`
      (the player's current height), never `0`
- [x] **Added:** a Settings modal to host Export/Import. The gear button had
      nowhere to go, and [03-APP-FLOW §10](03-APP-FLOW.md) puts Data there.
      Display (theme, coordinate format) and About are included; Behaviour is
      Tauri-only and waits for Phase 9.
- [x] **Added:** `backupNow()` writes a snapshot before **every** bulk operation.
      ADR-007 requires a backup before import; ADR-008's protocol otherwise waits
      for Phase 10, but the import path needs it now.
- [x] **Added:** a light `guessType()` from the label, always overridable in the
      review table. It makes the review screen usable rather than 30 rows of "misc".

**Deviation from [07-ALGORITHMS §6.3](07-ALGORITHMS.md), deliberate:** in
`guessDimension` the Y-range test runs **before** the keyword test. It is the only
rule that can be confident — the Nether is bedrock-capped at 0–127, so a Y outside
that range makes "nether" impossible regardless of what the label says. The doc's
keyword alternation was also written without a group, so `\b` bound only to the
first and last alternatives; it is grouped now.

**Docs:** [03-APP-FLOW §§7–8](03-APP-FLOW.md), [07-ALGORITHMS §6](07-ALGORITHMS.md)

**✅ Done when:** export → `localStorage.clear()` → reload → import → all 15 locations
back, including both sides of the portal link. And: pasting the two-coordinates-on-one-line
case produces **two separate rows**, not one pair.

---

## PHASE 6 — Brewing tab · 2 hrs → **ships v0.3** 🎉

**Goal:** stop alt-tabbing to a wiki.

- [x] Verify `data/brewing.json` durations and set `"verified": true`
      — done by the user 2026-08-15. Both copies flipped. A gate check now pins
      the inline `BREWING` and `data/brewing.json` together (flag, version, ids
      and every base duration), so the duplication cannot drift.
      **Set this back to `false` after any game update.**
- [x] Build `reftable` — the **generic** searchable/sortable table renderer.
      Zero brewing knowledge; a gate check greps the function body for domain
      vocabulary and fails if any appears.
- [x] Potion list with search, sort, and a tag filter
- [x] Detail view: the full chain, rendered per [04-UIUX-SPEC §4.10](04-UIUX-SPEC.md)
- [x] Reverse lookup: "I have X, what can I brew?"
- [x] Modifier table + corruption table as a persistent footer
- [x] **Added:** splash and lingering durations are **computed** (×¾ and ×¼) rather
      than stored, so they cannot drift out of step with the base duration.
- [x] **Added:** the chain states its gaps explicitly — "Redstone Dust does nothing,
      this potion cannot be extended" — rather than silently omitting the row.

**Note on `reftable`:** the doc describes `renderRefTable(mount, cfg)`. Implemented as
`refTableHTML(cfg, ui)` returning a string instead, so it composes with the single
full-render path (ADR-002) rather than mounting imperatively. Per-table UI state lives
in `state.ui.ref[id]`, which is how Phase 12 adds tabs without touching the renderer.

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

- [x] Full keyboard map from [03-APP-FLOW §11](03-APP-FLOW.md)
- [x] `Esc` cascade: modal → search → hide (the third step lands in Phase 9;
      for now it blurs, since a browser tab cannot hide itself)
- [x] Favourites pinned in their own section
- [x] Type icons ([04-UIUX-SPEC §4.3](04-UIUX-SPEC.md)) — emoji only *(Phase 2)*
- [x] Empty states ([04-UIUX-SPEC §6](04-UIUX-SPEC.md)) *(Phase 3)*
- [x] Recently viewed, max 8
- [x] `↓`/`↑` row focus, `Enter` copies, `Shift+Enter` edits
- [x] **Added:** modal `Tab` trap and focus restoration to the triggering element
      ([04-UIUX-SPEC §7](04-UIUX-SPEC.md)). Without it, closing a modal dumps focus
      at the top of the document and the keyboard journey dies mid-way.
- [x] **Added:** a Keyboard section in Settings. Shortcuts nobody can discover are
      shortcuts nobody uses.

**Decision recorded:** the favourites/remainder split applies only when **not**
searching. During a search, relevance order is the requirement
([03-APP-FLOW §3](03-APP-FLOW.md) — "best match first"), and sectioning would push
the top hit below a pinned favourite.

**✅ Done when:** every journey in [03-APP-FLOW](03-APP-FLOW.md) completes without a mouse.

---

## PHASE 8 — Tauri wrap · 2–3 hrs

**Goal:** a real `.exe`. **Nothing else changes in this phase.**

- [x] Install prerequisites: Node LTS 22+ (had v24.18), Rust via rustup (1.97.1),
      C++ Build Tools (~6 GB)
- [x] Scaffold written by hand rather than `npm create tauri-app@latest` — the
      generator wants an empty directory and would have overwritten a working app.
      Same output: `package.json`, `vite.config.js`, `src-tauri/`.
- [x] Split the single file into the modules from [02-TRD §4](02-TRD.md)
- [x] Switch the inline seed constant to `fetch("./seed.json")` — `data/` is Vite's
      `publicDir`, so it is served at the site root with no duplication
- [x] Window config in `tauri.conf.json`: 900×640, min 560×400, title "BlockBook"
- [x] App icon generated (Phase 13 item pulled forward — Tauri will not build without one)
- [x] `npm run build` — Vite output verified, `dist/seed.json` resolves
- [x] All 8 gates rewritten against the modules and passing (571 checks)
- [x] `npm run tauri build` — succeeded. Artifacts:
      `blockbook.exe` **2.93 MB**, NSIS setup 1.10 MB, MSI 1.56 MB
- [x] Exe launches, window titled "BlockBook", closes cleanly
- [ ] **Yours:** open it and confirm every v0.3 feature works in the real window
      (the gate's second half — I can prove it starts, not that it looks right)

**Measured, and one budget missed:** idle RAM is **179 MB private bytes** against a
60 MB budget. The Rust host is only 4.6 MB; WebView2's six Chromium processes are the
rest. The budget was never achievable with a WebView shell — see
[02-TRD §7.1](02-TRD.md) for the correction and why ADR-003 still stands.

**PATH gotcha:** rustup persists `~/.cargo/bin` to the user PATH, but shells opened
before the install keep a stale copy and report `cargo: program not found`. Open a new
terminal, or restart VS Code if using its integrated one.

**Bug found by the Phase 8 gate:** `convertAxis()` in the Portals tab reimplemented
`n / 8` inline instead of calling `toNether`. It now delegates. Duplicating the one
piece of arithmetic the app exists to get right is exactly what ADR-006 is meant to
prevent, and the copy would have drifted silently.

**Removed:** the root `index.html`. `src/index.html` supersedes it; two copies of the
same app is a drift trap. It remains in git history at `47ddf33`.

**Docs:** [02-TRD §§2.2–2.4, §4](02-TRD.md)

**✅ Done when:** the exe runs with every v0.3 feature intact.

**Watch out for:** localStorage still works inside WebView2, so persistence does not
change here. **Keep Phase 8 and Phase 10 in separate commits.** When something breaks
you must be able to tell which change did it.

---

## PHASE 9 — Overlay behaviour · 2 hrs

**Goal:** usable *during* play.

- [x] `alwaysOnTop: true` in `tauri.conf.json` + a Settings toggle
- [x] `plugin-global-shortcut`: `Ctrl+Shift+B` toggles show/hide
- [x] On show: raise, unminimise, focus the search box, **select** existing text
- [x] Tray icon: Show · Hide · Quit, plus left-click to toggle
- [x] Close `[X]` hides to tray instead of quitting
- [x] `plugin-clipboard-manager` for the `/tp` button
- [x] Persist and restore window position and size (`plugin-window-state`)
- [ ] Optional: compact mode, 420×520 — **skipped**, revisit after a week of use
      (ADR-014's logic: build it if the week says it is needed, not before)

**Added:** `src/desktop.js` — the single module allowed to know Tauri exists. Every
entry point works in three environments and never throws in any: the exe, a plain
browser (`npm run dev`), and Node under the gates. Tauri modules load via **dynamic
`import()` inside a guard**; a static import would break the browser build and all
nine gates. A gate check greps every other module to prove none references
`@tauri-apps` directly.

**Added:** `src-tauri/capabilities/default.json`, deliberately narrow — window
show/hide/focus/always-on-top, clipboard write, global shortcut, event listen.
A gate check asserts it grants **no** `http:`, `shell:` or `fs:` permission, so
P1 (offline-always) and "no filesystem until Phase 10" are enforced, not just intended.

**Hotkey registration failure is handled, not unwrapped.** Another app may already own
`Ctrl+Shift+B`; if so BlockBook logs it and carries on — the tray and window still work.
An `.unwrap()` there would have made a common conflict a startup crash.

**Compile error worth recording:** `.emit()` on a window needs `tauri::Emitter` in
scope in Tauri 2. It is a trait, so nothing names it directly and its absence reads as
"no method named `emit`".

**Docs:** [03-APP-FLOW §2.2](03-APP-FLOW.md)

**✅ Done when:** Minecraft is running borderless-windowed; `Ctrl+Shift+B`, type
"spawner", read the coordinate — and the game never minimises.

**Verified on the real exe:** builds (3.46 MB), launches, and a `WM_CLOSE` leaves the
process alive with the window hidden — close-to-tray genuinely works rather than
merely being asserted from source.

**Not verifiable here, yours to check:** the global hotkey firing over a running game,
the tray menu items, and window position surviving a restart. Those need a human and a
running Minecraft.

**Watch out for:** global hotkeys **do not reach the app in exclusive fullscreen**.
There is no fix. Document it in the README, in Settings → About, and in the first-run
message.

---

## PHASE 10 — File storage + backups · 2 hrs → **ships v1.0** 🎉

**Goal:** true portability and zero data loss.

- [x] Read/write of `data.json` — **not** `plugin-fs`. Granting the webview `fs:`
      scope to write one known file is a wide permission for a narrow need; the
      work is done by named Rust commands instead and the capability file has no
      `fs:` entry at all. A gate check asserts that.
- [x] Portable-mode path resolution per [02-TRD §5.2](02-TRD.md) — and the exe
      folder is **probe-tested for writability**, not assumed. Under Program Files
      a standard user cannot write there, so "next to the exe" must be verified.
- [x] Show the resolved path in Settings, with "Open folder"
- [x] One-time migration: localStorage → `data.json`, and the localStorage copy is
      **deliberately left in place** as a safety net
- [x] **Atomic write**: back up current → write `.tmp` → flush → `fsync` → rename
- [x] Rolling backups in `backups/`, prune the **oldest** beyond 20
- [x] `plugin-dialog` for import/export pickers
- [x] Corrupt-file recovery: quarantine, then walk backups **newest-first until one
      parses** — a backup can itself be truncated if the crash landed mid-copy
- [x] Flush pending writes on hide-to-tray and on quit

**Refactor this phase forced:** persistence became async, so `loadData`, `writeNow`,
`flush`, `backupNow`, `commitJsonImport` and `commitTextImport` are all `async` now.
The parse/validate logic stayed synchronous, which is why every Phase 3 corrupt-data
test survived unchanged.

**Bug caught by the gate:** `commitJsonImport` was calling `backupNow()` without
awaiting it. The backup would have landed *after* the data it was meant to protect.

**Three bugs caught only by running the real exe** — none of them reachable from the
gates as they stood, which is the argument for end-to-end testing in one paragraph:

1. **First run created no file at all.** Saves happen on mutation, so a fresh install
   left `data.json` non-existent until the user edited something. Settings showed a
   path to nothing, and "copy the folder to another PC" would have carried no data.
   Boot now materialises the file once.
2. **Recovery was never persisted.** After rescuing from a backup, no `data.json`
   existed. `storageInfo` was snapshotted *before* `loadData`, so it still reported
   `exists: true` even though quarantine had just moved the file away, and the
   materialise step skipped. The refresh now happens after the load.
3. **A UTF-8 BOM made a valid file look corrupt.** `JSON.parse` throws on a BOM, and
   **Windows Notepad writes one by default**. Principle P2 promises `data.json` is
   hand-editable with any text editor — as written, editing it in Notepad and saving
   would have got the file quarantined. `parseJson()` now tolerates a BOM on the data
   file, on backups, and on imports.

**Verified end-to-end on the built exe:** first run creates the file; a corrupted
`data.json` is quarantined byte-identically, recovered from a BOM-encoded backup, and
the recovery is written back to disk; no `.tmp` is left behind.

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
