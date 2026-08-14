# 09 — Testing & QA

**Product:** BlockBook · **Version:** 1.0 · **Date:** 2026-08-14

There is no test framework in v0.x. That is a deliberate choice, not an oversight —
see [10-DECISIONS ADR-009](10-DECISIONS-AND-RISKS.md). What replaces it is a set of
**golden cases with externally known answers** and a checklist per phase gate.

---

## 1. Testing strategy by phase

| Phase | Method |
|---|---|
| 0–3 | Manual checklist + browser console |
| 4 | **Golden cases** — assertions pasted into the console. Non-negotiable. |
| 5–7 | Manual checklist + round-trip tests |
| 8–10 | Manual checklist + fault injection |
| 11+ | Round-trip tests against real files, backed up first |

The portal maths is the one area where "it looked right" is not good enough, because
wrong answers are plausible-looking numbers. It gets real assertions.

---

## 2. Golden cases — portal maths ⭐

Paste this into the browser console at the end of Phase 4. **Every line must print
`PASS`.** These answers are known from the real world independently of the code.

```js
const eq  = (a, b, m) => console.log(a === b ? `PASS  ${m}` : `FAIL  ${m}: got ${a}, want ${b}`);
const near = (a, b, m, tol = 0.01) =>
  console.log(Math.abs(a - b) < tol ? `PASS  ${m}` : `FAIL  ${m}: got ${a.toFixed(2)}, want ${b}`);

// ── G1  Conversion, positive ──────────────────────────────────
eq(toNether(2217, -4024).x,  277, "G1a toNether x 2217");
eq(toNether(2217, -4024).z, -503, "G1b toNether z -4024 (exact divide)");
eq(toNether(631, 245).x,      78, "G1c toNether x 631");
eq(toNether(631, 245).z,      30, "G1d toNether z 245");
eq(toNether(221, 374).x,      27, "G1e toNether x 221");
eq(toNether(221, 374).z,      46, "G1f toNether z 374");

// ── G2  Conversion, NEGATIVE — floor vs trunc ⚠ ───────────────
eq(toNether(688, -1926).x,    86, "G2a toNether x 688");
eq(toNether(688, -1926).z,  -241, "G2b toNether z -1926  ← MUST be -241, not -240");
eq(toNether(-495, -394).x,   -62, "G2c toNether x -495   ← MUST be -62, not -61");
eq(toNether(-1, -1).x,        -1, "G2d toNether x -1     ← MUST be -1, not 0");

// ── G3  Reverse conversion ────────────────────────────────────
eq(toOverworld(16, 38).x,     128, "G3a toOverworld x 16");
eq(toOverworld(16, 38).z,     304, "G3b toOverworld z 38");
eq(toOverworld(276, -507).x, 2208, "G3c toOverworld x 276");
eq(toOverworld(276, -507).z,-4056, "G3d toOverworld z -507");

// ── G4  Y is NEVER scaled ─────────────────────────────────────
console.log(
  toNether.length === 2 && toOverworld.length === 2
    ? "PASS  G4 conversion functions take exactly (x, z) — Y cannot be passed"
    : "FAIL  G4 conversion signature accepts Y — remove it"
);

// ── G5  Conflict detection — THE flagship case ────────────────
const c5 = findLinkConflicts(
  { dimension: "overworld", x: 631, z: 245, id: "test" },
  ALL_LOCATIONS
);
eq(c5.length, 1, "G5a exactly one conflict for OW 631/245");
eq(c5[0].location.name, "Home Portal (Nether side)", "G5b nearest conflict is Home Portal");
near(c5[0].distance, 62.51, "G5c conflict distance");

// ── G6  No conflict ───────────────────────────────────────────
const c6 = findLinkConflicts(
  { dimension: "overworld", x: 688, z: -1926, id: "test" },
  ALL_LOCATIONS
);
eq(c6.length, 0, "G6 Bastion portal has no conflict");

// ── G7  Never conflicts with itself ───────────────────────────
const self = ALL_LOCATIONS.find(l => l.name === "Fortress Portal (Nether)");
const c7 = findLinkConflicts(self, ALL_LOCATIONS);
console.log(
  c7.every(r => r.location.id !== self.id)
    ? "PASS  G7 a portal never conflicts with itself"
    : "FAIL  G7 self-conflict returned"
);

// ── G8  Link health is BIDIRECTIONAL ──────────────────────────
const trial = ALL_LOCATIONS.find(l => l.name.startsWith("Trial Chamber"));
const fort  = ALL_LOCATIONS.find(l => l.name.startsWith("Fortress Portal"));
const h8 = linkHealth(trial, fort);
near(h8.forward,   4.12, "G8a forward  OW→NE (nether blocks)");
near(h8.backward, 33.24, "G8b backward NE→OW (overworld blocks)");
near(h8.worst,    33.24, "G8c worst is the backward direction");
eq(h8.status, "loose",   "G8d status is LOOSE, not tight — see 07-ALGORITHMS §4.3");

// ── G9  End dimension is excluded ─────────────────────────────
eq(
  findLinkConflicts({ dimension: "end", x: 100, z: 100, id: "t" }, ALL_LOCATIONS).length,
  0, "G9 End portals produce no conflicts"
);
```

### Why these specific cases

| Case | Catches |
|---|---|
| G2 | `Math.trunc` instead of `Math.floor` — invisible on positive coordinates |
| G4 | A Y parameter sneaking into the conversion signature |
| G5 | The core feature, against a real-world known answer |
| G7 | The self-conflict bug that appears the first time you edit an existing portal |
| G8 | Treating link health as a single direction — the source plan's error |
| G9 | Confidently converting End coordinates, which have no counterpart |

---

## 3. Validation test cases

| # | Input | Expected |
|---|---|---|
| V1 | Name `""` | **Error** E1 "Name is required." |
| V2 | Dimension unset | **Error** E2, Save disabled |
| V3 | X = `12.7` | Floored to `12`, or E3 |
| V4 | Y = `null` | Valid. Renders as `221 / — / 374` |
| V5 | Y = `200`, dimension nether | **Warning** W1 "Y 200 is outside the nether range (0–127)." Save allowed. |
| V6 | Y = `-64`, dimension overworld | Valid, no warning (boundary) |
| V7 | Y = `321`, dimension overworld | **Warning** W1 (boundary + 1) |
| V8 | X = `30000001` | **Error** E5 world border |
| V9 | `linkedPortalId` → a non-portal | **Error** E7 |
| V10 | `linkedPortalId` → a portal in the **same** dimension | **Error** E7 |
| V11 | `linkedPortalId` → a deleted id | Cleared on load, warning logged |
| V12 | Duplicate name | **Warning** W5 only. Save allowed. |
| V13 | Tags `"Main, MAIN , main"` | Stored as `["main"]` — trimmed, lowercased, deduped |
| V14 | Setting a link on A | B's `linkedPortalId` also set to A |
| V15 | Deleting B | A's `linkedPortalId` cleared, not left dangling |

---

## 4. Importer test cases

| # | Input line | Expected rows |
|---|---|---|
| I1 | `Home - 221/65/374` | 1 row, name `Home` |
| I2 | `221 65 374` | 1 row, name `(unnamed)`, unchecked by default |
| I3 | `Portal 631/67/245 ---- -495/66/-394` | **2 rows**, not a pair. Names `Portal (1)`, `Portal (2)` |
| I4 | `no numbers here` | 0 rows; line appears in "not recognised" |
| I5 | `spider spawner 91/-13/200` | 1 row, dimension guessed `overworld` (Y < 0), **confident** |
| I6 | `nether hub 42/64/17` | 1 row, guess `nether` from the keyword, **not confident** |
| I7 | `cave 100/50/200` | 1 row, guess `null` — forces a choice |
| I8 | Any row with dimension unset and checked | `[Import]` **disabled** |
| I9 | Import committed | **Appends.** Existing 15 locations still present |
| I10 | Import committed | A backup was written first |
| I11 | Cancel | Zero changes to state or storage |

**I3 is the important one.** It is the exact trap present in the real source notes.
If the importer produces one paired record, it has reintroduced the original bug.

---

## 5. Storage & data-safety tests

Run at Phase 10. These protect against the highest-severity risk in the project.

| # | Test | Expected |
|---|---|---|
| S1 | Export → `localStorage.clear()` → reload → import | All locations restored, links symmetric |
| S2 | Corrupt `data.json` (delete a `}`), launch | Newest backup loaded; **corrupt file renamed, not overwritten**; persistent banner names both files |
| S3 | Set `schemaVersion: 99`, launch | Refuses to load, shows both version numbers, changes nothing |
| S4 | Delete `data.json`, launch | Fresh dataset from seed. Not treated as an error. |
| S5 | Make `data.json` read-only, edit a location | Error banner with the path; in-memory change retained; retry on next mutation |
| S6 | 25 consecutive saves | `backups/` holds exactly 20, newest kept |
| S7 | Kill the process mid-write | `data.json` is either fully old or fully new — never truncated |
| S8 | Copy the whole folder to a USB stick, run on another PC | Every location present (**success criterion S6**) |
| S9 | Type 40 characters into a notes field | One debounced write, not 40. `backups/` grows by ≤1. |
| S10 | Hide to tray with an unsaved change | Write is flushed before hiding |

**S7 requires a real kill** (Task Manager → End Task, mid-write). It is the only way to
verify the atomic rename actually protects the file.

---

## 6. Phase gate checklists

### Gate 1 — Phase 3, ships v0.1
- [ ] All 15 seed locations render
- [ ] Add → close browser → reopen → still present
- [ ] Search "spawner" → exactly 3 results
- [ ] Search "monument" → finds the shipwreck **via its note**
- [ ] Dimension cannot be left unset
- [ ] V1–V8 pass
- [ ] Delete confirm names the location

### Gate 2 — Phase 4, ships v0.2 ⭐
- [ ] **All golden cases G1–G9 print PASS**
- [ ] Converter updates live in both directions, no button
- [ ] "Y is not converted" is permanently visible
- [ ] Every portal card shows its counterpart
- [ ] Entering OW `631 / 245` produces the amber warning naming Home Portal
- [ ] Broken-pair count appears in the status bar
- [ ] Setting a link writes both sides (V14)

**Do not proceed to Phase 5 with any G-case failing.**

### Gate 3 — Phase 6, ships v0.3 🎉
- [ ] Export → clear → import → nothing lost (S1)
- [ ] Import review screen cannot be bypassed
- [ ] I1–I11 pass
- [ ] `/tp` copy works and toasts
- [ ] **Network disconnected**, answer "how do I make splash Fire Resistance"
- [ ] Reverse lookup on "magma" → Fire Resistance
- [ ] `brewing.json` durations verified, `verified: true` set
- [ ] `reftable.js` contains zero brewing-specific code

### Gate 4 — Phase 10, ships v1.0 🎉
All six [PRD §6.1](01-PRD.md) success criteria, plus:
- [ ] S1–S10 pass
- [ ] Idle RAM < 60 MB (Task Manager, 60 s idle)
- [ ] Cold start < 1.5 s
- [ ] Installed size < 20 MB
- [ ] `Ctrl+Space` works over borderless Minecraft
- [ ] Exclusive-fullscreen caveat documented in README **and** Settings → About
- [ ] Close `[X]` hides to tray; tray Quit exits
- [ ] Storage path visible and copyable in Settings
- [ ] Every journey completable without a mouse

### Gate 5 — Phase 11, ships v1.1
- [ ] Waypoint file round-trips: import → export → functionally identical
- [ ] Original file backed up before **every** write
- [ ] "Close Minecraft first" warning shown before any waypoint write
- [ ] A malformed waypoint line aborts the import and changes nothing
- [ ] Cross-dimension distances labelled approximate

---

## 7. Performance verification

Measure, do not estimate.

```js
// Render budget
const t0 = performance.now();
render();
console.log(`render: ${(performance.now() - t0).toFixed(1)} ms  (budget 100)`);

// Search budget
const t1 = performance.now();
searchLocations(ALL_LOCATIONS, "spawn");
console.log(`search: ${(performance.now() - t1).toFixed(2)} ms  (budget 50)`);
```

To test at scale, generate 500 synthetic locations and re-run. If both stay in budget —
and at this data size they will — **do not optimise anything**.

| Metric | Budget | How |
|---|---|---|
| Hotkey → readable answer | < 3 s | Stopwatch, 5 trials, worst case counts |
| Cold start → interactive | < 1.5 s | Stopwatch |
| `render()` at n=500 | < 100 ms | `performance.now()` |
| Search keystroke | < 50 ms | `performance.now()` |
| Idle RAM | < 60 MB | Task Manager after 60 s idle |
| Installed size | < 20 MB | Explorer properties on the build output |

---

## 8. Real-world verification

Some things only the game can confirm. These close the open questions in
[01-PRD §8](01-PRD.md).

| # | In-game action | Confirms |
|---|---|---|
| R1 | **Walk through the portal at `631 / 245`.** Note where you arrive. | If you arrive at the Home Portal, the validator's flagship prediction is confirmed against reality. **This is the single best test the app will ever get.** |
| R2 | Visit `-495 / 66 / -394` and record the dimension | Resolves Q1 |
| R3 | Visit `2411 / 22 / -326` and name it | Resolves Q2 |
| R4 | Record the ocean monument near the `823 / -271` shipwreck | Resolves Q4 |
| R5 | **Record the Overworld-side portal at Home as its own location** | Resolves Q7; makes the Home link health measure the portal rather than the base |
| R6 | Read the exact game version off the title screen | Resolves Q6, gates `brewing.json` verification |
| R7 | Open a real Xaero waypoint file and count the fields | Resolves Q5; prerequisite for Phase 11 |

Fold every answer back into `data/seed.json` and clear the `NEEDS REVIEW` note.

---

## 9. Regression checklist

Run before tagging any version.

- [ ] Golden cases G1–G9 pass
- [ ] Export → import round-trip loses nothing
- [ ] All 15 seed locations still load
- [ ] Portal links symmetric in both directions
- [ ] No console errors on a clean boot
- [ ] No network request in the DevTools Network tab (**should be completely empty**)
- [ ] Dark and light themes both legible
- [ ] Keyboard-only pass through every journey
- [ ] `backups/` populated and the newest backup is valid JSON

The empty Network tab is a real test, not a formality. It is the mechanical proof of
principle P1 — offline-always. Anything appearing there is a bug.
