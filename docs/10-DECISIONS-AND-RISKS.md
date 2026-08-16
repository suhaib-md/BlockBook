# 10 — Decisions & Risks

**Product:** BlockBook · **Date:** 2026-08-14

Part 1 is the ADR log — decisions, with the reasoning, so they are not relitigated
every time they feel inconvenient. Part 2 is the risk register.

---

# Part 1 — Architecture Decision Records

---

## ADR-001 — Local-first, no backend

**Status:** Accepted · **Phase:** 0

**Context.** One user, one world, one machine. The obvious "modern" shape would be an
account, a database, and sync.

**Decision.** No server, no account, no cloud sync, ever. A JSON file is the sync layer;
copying it is the sync mechanism.

**Consequences.** Zero infrastructure, zero cost, zero latency, works with the
internet down. No cross-device sync beyond copying a file — acceptable, because there
is one device. Adding a backend later would cost more than the entire rest of the app.

**Rejected:** Firebase/Supabase (adds auth, network dependency, an account for a
single user); a local SQLite file (loses hand-editability, adds a dependency, gains
nothing at this data size).

---

## ADR-002 — Vanilla JS, no framework

**Status:** Accepted · **Phase:** 0

**Context.** The app is roughly 600 lines of logic over one list, one form, and a few
tables.

**Decision.** Vanilla ES2022 with a single `render()` that rebuilds the active tab
from state.

**Consequences.** No build step in v0. No dependency updates. No framework idioms to
learn while also learning Tauri. Manual DOM work — which is fine at this size and is
what makes the "open the file and refresh" workflow possible.

**Revisit when:** a single module passes ~1500 lines, or a measured `render()` exceeds
100 ms. Not before. Both are objective triggers, deliberately.

---

## ADR-003 — Tauri, not Electron

**Status:** Accepted · **Phase:** 8

**Context.** The app must run as a native window beside Minecraft, which wants every
byte of RAM available.

**Decision.** Tauri 2.x, using the OS WebView2.

| | Tauri | Electron |
|---|---|---|
| Bundle | ~10 MB | ~100 MB+ |
| Idle RAM | ~30–40 MB | ~200 MB+ |
| Runtime | OS WebView2 (present on Win11) | Bundled Chromium |
| Backend | Rust | Node |

**Consequences.** Meets the < 60 MB RAM and < 20 MB size budgets comfortably. Costs a
~6 GB C++ Build Tools install and some Rust exposure — mitigated by ADR-004. WebView2
is guaranteed present on Windows 11; a Windows-only app is fine for a Windows-only user.

---

## ADR-004 — Ship a browser app before touching the toolchain

**Status:** Accepted · **Phase:** 0

**Context.** The Tauri prerequisites are a multi-gigabyte download. Hobby projects die
during setup far more often than during development.

**Decision.** v0.1 through v0.3 are a single `index.html` opened by double-clicking.
The toolchain is installed at Phase 8, after the app is already genuinely useful.

**Consequences.** A working, valuable tool exists at hour 11 with zero installs.
Phase 8 becomes a packaging step for something proven rather than a prerequisite to
starting. This single decision is the strongest mitigation for R-05 (never finishing).

---

## ADR-005 — `dimension` is mandatory, with no default

**Status:** Accepted · **Phase:** 1

**Context.** Every ambiguity in the original Notepad file traces to one absent fact:
which dimension a coordinate belongs to. `-495 / 66 / -394` is unanswerable without it.

**Decision.** `dimension` is required on every location. The Add form preselects
nothing, Save is disabled until a choice is made, and the import review screen blocks
on any unset row.

**Consequences.** Slightly more friction per entry — one click. In exchange, the data
is never ambiguous, and every downstream feature (conversion, validator, filtering)
becomes possible. A defaulted `"overworld"` would silently produce confidently wrong
coordinates, which is worse than friction by a wide margin.

---

## ADR-006 — Y is structurally absent from the conversion functions

**Status:** Accepted · **Phase:** 4

**Context.** Nether scaling applies to X and Z only. Scaling Y is the most common bug
in this class of tool, and it produces plausible-looking wrong answers.

**Decision.** `toNether(x, z)` and `toOverworld(x, z)` accept and return `{x, z}` only.
Y cannot be passed in. The converter UI has no Y field, and carries permanent text
saying so.

**Consequences.** The bug is impossible to write rather than merely discouraged.
Callers must pass coordinates explicitly instead of spreading a location object — a
small cost for eliminating an entire failure class. Test G4 enforces the signature.

---

## ADR-007 — Bulk imports always pass a review screen

**Status:** Accepted · **Phase:** 5

**Context.** The Notepad importer must guess dimensions, and guessing is frequently
impossible. A wrong guess yields a confident, wrong coordinate.

**Decision.** No code path commits an import without the review table. No "import all"
shortcut exists. Guessed dimensions are visually flagged; `[Import]` is disabled while
any checked row is unset. Imports append, never replace.

**Consequences.** Importing takes a minute instead of a second. In exchange, silently
wrong data cannot enter the dataset. **A silent bad import is worse than no import** —
the player trusts it and walks 2000 blocks the wrong way. This is the highest-friction
decision in the document and the one most worth keeping.

---

## ADR-008 — Atomic writes with rolling backups

**Status:** Accepted · **Phase:** 10

**Context.** Data loss is the highest-severity risk. The dataset represents years of
in-game exploration and is not reconstructible.

**Decision.** Every write: serialise → back up the current file → write `.tmp` →
flush → atomic rename → prune to 20 backups. Writes debounce at 400 ms and flush on
hide and on quit.

**Consequences.** A crash at any point leaves either the old file intact or the new
file complete, plus at least one valid backup. Costs a little disk and some code.
Ships in the same phase that introduces file storage — never a phase later.

---

## ADR-009 — No test framework; golden cases instead

**Status:** Accepted · **Phase:** 4

**Context.** A solo hobby project. A test runner means a build step, a dependency, and
config — in a project whose defining feature is having none.

**Decision.** No framework. Instead: a set of console-pasteable assertions covering
the portal maths, whose expected answers are known from the real world independently
of the code ([09-TESTING-QA §2](09-TESTING-QA.md)), plus manual checklists at each
phase gate.

**Consequences.** The one area where correctness genuinely matters is covered by
externally-verified fixtures. Everything else is verified by using the app, which is
adequate for a single-user tool. **Revisit if** logic modules grow past ~800 lines,
or after the first bug that a unit test would have caught.

---

## ADR-010 — Link health is measured in both directions

**Status:** Accepted · **Phase:** 4 · **Supersedes** BUILD_PLAN §3.3

**Context.** The source plan computed a single distance for a portal pair. But the
game's 128-block search radius is measured in *destination-dimension* blocks, so the
two traversal directions have genuinely different tolerances. Trial Chamber ↔ Fortress
is 4.12 blocks one way and 33.24 the other.

**Decision.** `linkHealth()` computes both directions and reports the worse one.
Thresholds (≤16 tight, ≤128 loose, >128 broken) apply to the worse figure.

**Consequences.** More honest badges. Some pairs the single-direction check called
"Tight" are correctly "Loose". A pair that works one way and not the other is now
caught — that is the failure where you walk through and cannot get back, which is
exactly what this feature exists to prevent.

---

## ADR-011 — Emoji instead of an icon pack

**Status:** Accepted · **Phase:** 2

**Decision.** All icons are emoji.

**Consequences.** Zero bytes, zero build step, zero licensing, already themed by the
OS, instantly recognisable. Rendering varies slightly across platforms — irrelevant
for a Windows-only, single-user app. An icon pack would be the app's first asset
pipeline for no functional gain.

---

## ADR-012 — Reference data ships separately from user data

**Status:** Accepted · **Phase:** 6

**Decision.** `brewing.json` and future reference datasets are read-only files shipped
with the app. They are never merged into `data.json`.

**Consequences.** Updating game knowledge can never risk user coordinates. A bad
`brewing.json` shows wrong potion times; it cannot lose a location. Each file carries
`gameVersion` and `verified` so drift is visible rather than silent.

---

## ADR-013 — One generic table renderer, built before it is needed twice

**Status:** Accepted · **Phase:** 6

**Context.** Seven reference tabs are planned. Written individually, that is seven
copies of search, sort, and filter.

**Decision.** Build `reftable.js` in Phase 6 for the brewing tab, with **zero domain
knowledge** inside it. Every later tab is a JSON plus a mount call.

**Consequences.** Phase 6 costs slightly more; Phase 12 costs dramatically less.
Enforced by a gate: if a new tab needs renderer changes, fix the renderer, not the tab.

---

## ADR-016 — File I/O lives in Rust, not behind `plugin-fs`

**Status:** Accepted · **Phase:** 10 · **Refines** ADR-008

**Context.** The plan called for `@tauri-apps/plugin-fs` to read and write
`data.json`. Doing that means granting the webview an `fs:` capability scope — a
general "you may touch files matching this pattern" permission — to accomplish
something entirely specific: read one known file, write one known file, list one
known folder.

**Decision.** No `fs:` scope. Seven named Rust commands instead
(`storage_read`, `storage_write`, `storage_quarantine`, `storage_backups`,
`storage_read_backup`, `storage_info`, `storage_open_folder`), plus two for the
native dialogs. The capability file grants no filesystem permission at all, and a
gate check asserts it stays that way.

**Consequences.**

- The webview cannot address an arbitrary path even if its JS were compromised or
  a dependency turned hostile. Each command hard-codes what it will touch, and
  `storage_read_backup` rejects any name containing `/`, `\` or `..`.
- **The write protocol becomes real.** `fs::rename` is an atomic replace at the
  filesystem level and `sync_all` genuinely flushes to disk — neither guarantee is
  available from the JS side. A crash between the temp write and the rename leaves
  the previous `data.json` untouched, which is the entire point of ADR-008.
- Cost: ~200 lines of Rust and an async boundary through the whole persistence
  layer. Worth it for the highest-severity risk in the register.

**Also decided here:** portable mode **probes** the exe folder by creating a test
file rather than assuming it is writable. Installed under Program Files a standard
user cannot write beside the exe, and silently failing every save there would be the
worst possible outcome for R-01.

---

## ADR-015 — The summon hotkey must not be a game control

**Status:** Accepted · **Phase:** 9 · **Supersedes** the `Ctrl+Space` default named
throughout the original plan

**Context.** Every document specified `Ctrl+Space` as the summon hotkey. In Minecraft,
**Ctrl is sprint and Space is jump** — so `Ctrl+Space` is *sprint-jump*, one of the
most frequent inputs in the game. Shipped, it summoned the app and stole focus from
the game on almost every jump, making it actively unusable during play. This was
caught by playing, not by any gate.

**Decision.**

1. The default becomes **`Ctrl+Shift+B`** — three keys, and `B` is unbound in vanilla.
2. The hotkey is **user-configurable** in Settings, from a preset list where every
   option avoids Minecraft's default controls.
3. It can be **disabled entirely**, leaving the tray icon as the way in.
4. Nothing is registered natively at startup. The frontend owns the setting and calls
   `apply_hotkey` after loading it, so no hard-coded default can ever fire.
5. Saved settings containing a known-unsafe combo are **migrated on load**, with a
   banner saying why. Fixing only the default would never have reached an existing
   install — the bad value was already persisted.

**Consequences.** A three-key default is slightly less convenient to press and less
guessable, which is the correct trade against firing during combat. The preset list
is enforced by a gate check that rejects any option binding a Minecraft control key
(`Space`, `Shift`, `Tab`, `W/A/S/D/E/Q/T/F`, …) or any single-key combo that is not an
unbound function key.

**The general lesson.** This app runs *alongside* a program that owns the keyboard.
Any global input it claims must be checked against that program's bindings first.
The original spec chose a hotkey on ergonomics alone and never asked what the game
already used it for.

---

## ADR-014 — Mandatory one-week pause after v0.3

**Status:** Accepted · **Phase:** between 6 and 7

**Decision.** Do not start Phase 7 until v0.3 has been used for a week of real play.

**Consequences.** The remaining phases get reordered by evidence rather than by
prediction, and the prediction is never quite right. This is the cheapest and
highest-value item in the plan — and the easiest to skip, which is why it is an ADR
and not a suggestion.

---

# Part 2 — Risk register

Severity × Likelihood, with the mitigation and its owning phase.

| ID | Risk | Sev | Lik | Score |
|---|---|:--:|:--:|:--:|
| R-01 | Data loss | 🔴 High | 🟡 Med | **9** |
| R-02 | Scope creep into a map renderer | 🟡 Med | 🔴 High | **9** |
| R-03 | Never finishing | 🔴 High | 🟡 Med | **9** |
| R-04 | Wrong portal maths shipped as correct | 🔴 High | 🟡 Med | **9** |
| R-05 | Tauri toolchain friction stalls the project | 🟡 Med | 🟡 Med | **4** |
| R-06 | Xaero format drift breaks the exporter | 🟢 Low | 🔴 High | **3** |
| R-07 | Reference data goes stale | 🟢 Low | 🔴 High | **3** |
| R-08 | Hotkey unusable in exclusive fullscreen | 🟡 Med | 🔴 High | **6** |
| R-09 | Import silently corrupts the dataset | 🔴 High | 🟢 Low | **3** |
| R-10 | Single-file app becomes unmaintainable | 🟢 Low | 🟡 Med | **2** |

---

### R-01 — Data loss 🔴

The dataset is years of exploration and is not reconstructible.

**Mitigation**
- Atomic write protocol, every write, no exceptions (ADR-008, Phase 10)
- Rolling backups, newest 20 retained
- Corrupt file is **quarantined, never overwritten**; newest valid backup loaded
- Export to JSON available from v0.3, before file storage exists
- Private GitHub repo as off-site backup (Phase 13)

**Trigger to act:** any write failure, ever. **Owner phase:** 10 — same day as file
storage, never a phase later.

---

### R-02 — Scope creep 🟡×🔴

The most likely specific failure is building a map renderer. It is fun, it is
visible, and it is a month of work that Xaero's already does better inside the game.

**Mitigation**
- Explicit non-goals list ([01-PRD §5](01-PRD.md)) — *rejected*, not deferred
- The six v1.0 success criteria are the definition of done
- Anti-metrics ([01-PRD §6.3](01-PRD.md)) as early warnings
- A phase overrunning 2× triggers a scope check

**Trigger to act:** any work that does not map to a numbered feature in
[01-PRD §4](01-PRD.md).

---

### R-03 — Never finishing 🔴

The default outcome for solo hobby projects.

**Mitigation**
- Ship something genuinely useful at hour 11 (v0.3), not hour 32
- Every phase is ≤ 3 hours — always finishable in one sitting
- Hard gates prevent half-finished parallel phases
- ADR-004: no toolchain install before the app is useful
- ADR-014: the one-week pause makes "using it" an explicit project stage

**Trigger to act:** two weeks with no commit → drop to the next shippable gate and
release there.

---

### R-04 — Wrong portal maths 🔴

The flagship feature produces plausible-looking numbers. A wrong one sends the player
2000 blocks in the wrong direction with no error message.

**Specific failure modes**
- `Math.trunc` instead of `Math.floor` — correct for positives, wrong for negatives
- Scaling Y
- Conflicting with self when editing an existing portal
- Single-direction link health hiding a broken return trip
- Converting End coordinates

**Mitigation**
- Golden cases G1–G9 with externally-known answers ([09-TESTING-QA §2](09-TESTING-QA.md))
- Y structurally absent from the conversion signature (ADR-006)
- Bidirectional link health (ADR-010)
- Phase 4 gate: **do not proceed with any G-case failing**
- Real-world verification R1: walk through the `631 / 245` portal

**Trigger to act:** any G-case failure. **Owner phase:** 4.

---

### R-08 — Exclusive fullscreen blocks the hotkey 🟡×🔴

Windows does not deliver global shortcuts to background apps while another app holds
exclusive fullscreen. There is no application-level fix.

**Mitigation**
- Document it in the README, in Settings → About, and in the first-run message
- Recommend Borderless — visually identical, negligible performance cost on modern hardware
- The tray icon remains a working fallback

**Accepted limitation, not a bug.** Do not spend time attempting a workaround; there
isn't one.

---

### R-06 / R-07 — Xaero drift and stale reference data 🟢×🔴

Both are high-likelihood, low-severity: annoying, never destructive.

**Mitigation (R-06)**
- Phase 11 starts by reading the *user's actual file* and counting fields
- **Always back up before writing.** Non-negotiable.
- Exporter is explicitly best-effort and never on the critical path
- JourneyMap (per-waypoint JSON) is the easier target if the mod ever changes

**Mitigation (R-07)**
- `gameVersion` and `verified` on every reference file (ADR-012)
- UI hint while `verified: false`
- Reference data is isolated from user data — it can be wrong without being dangerous

---

### R-09 — Import corruption 🔴×🟢

High severity, low likelihood *because* of the mitigation. Remove the mitigation and
the likelihood becomes high.

**Mitigation**
- Mandatory review screen, no bypass (ADR-007)
- Imports append, never replace; replacement requires a separate double confirm
- Backup written before any import
- Guessed dimensions visually flagged
- `[Import]` disabled while any checked row is unset

---

### R-05 / R-10 — Toolchain friction and single-file sprawl 🟡 / 🟢

**R-05:** deferred entirely to Phase 8 by ADR-004. By the time the 6 GB download
matters, there is a working app to package — a much stronger motivation than an empty
folder.

**R-10:** ADR-002 gives objective revisit triggers (1500 lines, 100 ms render). Phase 8
splits the single file into modules anyway, at which point the concern largely evaporates.

---

## Risk review cadence

| When | Review |
|---|---|
| Every phase gate | R-02 (scope), R-03 (progress) |
| Phase 4 gate | R-04 — golden cases |
| Phase 10 gate | R-01 — fault-injection tests S1–S10 |
| Phase 11 gate | R-06 — waypoint round-trip |
| Every game update | R-07 — set `verified: false`, re-check |
| Every version tag | Full regression checklist ([09-TESTING-QA §9](09-TESTING-QA.md)) |
