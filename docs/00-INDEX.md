# 00 — Index & Glossary

**Project:** BlockBook · **Version of this doc set:** 1.0 · **Written:** 2026-08-14

---

## 1. How to use this documentation

These documents are written for a solo developer building alone. They are
**decision records, not aspirations**. If a document says "Y is never scaled",
that is a rule to implement, not a suggestion to weigh.

### Reading order for a first pass

1. [01-PRD](01-PRD.md) — 10 min. Understand the product and, more importantly, the non-goals.
2. [06-IMPLEMENTATION-PLAN](06-IMPLEMENTATION-PLAN.md) — 10 min. Understand the build order.
3. Start Phase 0. Read the other documents *when the phase points you at them.*

Do not read all eleven documents before writing code. The plan is designed so each
phase pulls in exactly the spec it needs.

### Document ownership map

| If you are... | Read |
|---|---|
| Deciding whether a feature belongs in this version | [01-PRD §4 Scope](01-PRD.md), [01-PRD §5 Non-goals](01-PRD.md) |
| Choosing a library or pattern | [02-TRD](02-TRD.md), [10-DECISIONS](10-DECISIONS-AND-RISKS.md) |
| Building a screen | [03-APP-FLOW](03-APP-FLOW.md), [04-UIUX-SPEC](04-UIUX-SPEC.md) |
| Writing or changing a data field | [05-DATA-SCHEMA](05-DATA-SCHEMA.md) — **update it in the same commit** |
| Implementing portal logic | [07-ALGORITHMS](07-ALGORITHMS.md) |
| Filling a reference tab | [08-REFERENCE-DATA](08-REFERENCE-DATA.md) |
| About to call a phase done | [09-TESTING-QA](09-TESTING-QA.md) |

### Maintenance rule

The schema document ([05](05-DATA-SCHEMA.md)) and the algorithms document ([07](07-ALGORITHMS.md))
are **live contracts**. If the code and those documents disagree, that is a bug in
one of them — fix it the same day. The PRD and the implementation plan are allowed to
drift; they are historical intent.

---

## 2. Glossary

### Minecraft domain terms

| Term | Meaning |
|---|---|
| **Dimension** | One of the three worlds: Overworld, Nether, End. Coordinates in different dimensions are unrelated numbers unless converted. |
| **Overworld** | The main world. Y range −64 to 320. |
| **Nether** | The hell dimension. Coordinates are 1/8 the scale of the Overworld horizontally. Y range 0 to 127. |
| **End** | The dragon dimension. No portal-scale relationship to anything. Y range 0 to 255. |
| **Nether scale / 8:1 ratio** | 1 block travelled in the Nether = 8 blocks in the Overworld, horizontally only. Y is never scaled. |
| **Portal** | A nether portal. Has a position in one dimension and links to a position in the other. |
| **Portal linking** | The game's algorithm for deciding which destination portal you arrive at. See [07-ALGORITHMS §3](07-ALGORITHMS.md). |
| **Link radius** | 128 blocks horizontal. The game searches this radius around the scaled target for an existing portal before creating a new one. |
| **Link collision / hijack** | When a portal you build unexpectedly connects to an existing portal instead of creating a new one, because that portal was inside the link radius. |
| **Spawner** | A monster spawner block. Fixed position, generates mobs. Valuable — becomes a farm. |
| **Awkward Potion** | Water Bottle + Nether Wart. The base for nearly every useful potion. |
| **Splash potion** | A throwable potion. Awkward chain + Gunpowder. |
| **Lingering potion** | A splash potion + Dragon's Breath. Leaves an area cloud. |
| **Fermented Spider Eye** | The "corruption" ingredient. Turns a potion into its opposite. |
| **Xaero's Minimap** | A popular minimap mod. Stores waypoints in colon-delimited text files. |
| **JourneyMap** | Alternative minimap mod. Stores waypoints as individual JSON files — much easier to parse. |
| **Borderless windowed** | A Minecraft display mode. Required for global hotkeys to reach BlockBook; exclusive fullscreen swallows them. |

### Project terms

| Term | Meaning |
|---|---|
| **Location** | The core record type. A named point with a dimension, coordinates, type, and tags. See [05-DATA-SCHEMA §3](05-DATA-SCHEMA.md). |
| **Type** (of a location) | An enum (`base`, `portal`, `spawner`, …) that drives the icon and default colour. Not free text. |
| **Link health** | A badge on a linked portal pair: ✅ Tight / 🟡 Loose / ❌ Broken. See [07-ALGORITHMS §4](07-ALGORITHMS.md). |
| **Validator** | The feature that warns you before you build a portal that will hijack an existing link. The flagship feature of v0.2. |
| **Notepad importer** | The Phase 5 parser that ingests the user's original flat text file. Always followed by a review screen. |
| **Review screen** | The mandatory confirmation table shown before any bulk import commits. Non-negotiable — see [10-DECISIONS ADR-007](10-DECISIONS-AND-RISKS.md). |
| **Portable mode** | Tauri looks for `data.json` next to the `.exe` before falling back to the app data directory. Makes the whole folder copyable to a USB stick. |
| **Reftable** | The one generic searchable-table renderer, reused by brewing and every future reference tab. Built once in Phase 6. |
| **Seed data** | The 14 real coordinates in `data/seed.json`, parsed from the user's original notes. Doubles as the correctness test fixture. |
| **NEEDS REVIEW** | A marker on seed rows that are genuinely ambiguous in the original notes and must be resolved in-game. |

### Version labels

| Label | Means |
|---|---|
| **v0.1** | Locations render, CRUD works, localStorage persists. Browser only. |
| **v0.2** | Nether math and the portal validator work. |
| **v0.3** | Import/export and brewing. **First genuinely useful build. Ship and use it for a week.** |
| **v1.0** | Real `.exe`, global hotkey, tray, portable file storage with backups. |
| **v1.1** | Xaero's sync, distance/nearest tools. |
| **v1.2** | Remaining reference tabs, multi-world. |

---

## 3. Cross-document conventions

- **Coordinates are written `x / y / z`**, always in that order, always with spaces
  around the slashes. Never `x, y, z`.
- **Distances are horizontal unless stated otherwise.** Portal logic is 2D. Only the
  "nearest to me" feature uses 3D distance.
- **Times are `M:SS`** in brewing data (`3:00`, `0:45`), matching the in-game display.
- **`null` means "deliberately unknown"**, not "zero". A `y` of `null` means "surface,
  don't care". A `y` of `0` is a real Y coordinate.
- **Checkboxes in the implementation plan are the live progress tracker.** Tick them.
