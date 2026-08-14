# 03 — App Flow

**Product:** BlockBook · **Version:** 1.0 · **Date:** 2026-08-14

Screen inventory, navigation model, and every user journey worth specifying.
Visual detail lives in [04-UIUX-SPEC](04-UIUX-SPEC.md); this document is behaviour.

---

## 1. Navigation model

Four top-level tabs. Flat. No nesting, no back stack, no router.

```
┌──────────────────────────────────────────────────────────────┐
│  BlockBook            [Coordinates][Portals][Brewing][Ref] ⚙ │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                     active tab content                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

| Tab | Key | Purpose | Available from |
|---|---|---|---|
| **Coordinates** | `1` | The location book. Default tab. | v0.1 |
| **Portals** | `2` | Converter + portal overview + health badges | v0.2 |
| **Brewing** | `3` | Potion tree and reverse lookup | v0.3 |
| **Reference** | `4` | Enchanting, mobs, trades, fuel… | v1.2 (stub earlier) |
| **Settings** | `⚙` | Modal, not a tab | v0.3 |

**Rules:**
- Tab state is `state.ui.activeTab`. Switching tabs does not clear the search box —
  each tab keeps its own search string.
- Modals (Add/Edit, Import, Settings, Confirm) overlay the current tab. `Esc` closes.
- There is no browser history integration and no deep linking. Deliberate: the app is
  a single window, not a site.

---

## 2. Application lifecycle

### 2.1 Cold start

```
Launch (exe or browser)
   │
   ▼
Resolve storage location  ────────────────┐
   │  (v1.0+: exe dir → APPDATA)          │
   ▼                                      │
Read data                                 │
   ├─ found + valid ──────────────────┐   │
   ├─ found + unparseable ──▶ quarantine, load newest backup, show banner
   ├─ found + newer schema ──▶ refuse, show version error, stop
   └─ not found ──▶ build from seed.json ─┤
                                          ▼
                          Run migrations if schemaVersion < current
                                          │
                                          ▼
                          Render Coordinates tab
                                          │
                                          ▼
                          Focus the search box   ◀── always
```

Search focus on launch is a hard requirement. The core journey is "summon, type,
read" — a click to focus the input would break the 3-second promise.

### 2.2 Warm summon (v1.0+)

```
Ctrl+Space pressed anywhere
   │
   ├─ window hidden ──▶ show, raise, focus search, select existing search text
   └─ window visible ──▶ hide to tray
```

Selecting (not clearing) the existing search text means the next keystroke replaces
the old query, while `Esc` still restores it. Costs nothing, saves a keystroke.

### 2.3 Shutdown

```
Close button [X]      ──▶ flush pending write ──▶ hide to tray (does not quit)
Tray → Quit           ──▶ flush pending write ──▶ exit
Window close in v0.x  ──▶ localStorage already written on every mutation
```

---

## 3. Journey A — Mid-game coordinate lookup ⭐

**The primary journey.** Budget: 3 seconds. Frequency: many times per session.

```
Minecraft running (borderless windowed)
   │
   ▼
[Ctrl+Space] ──────────────▶ window appears on top, search focused
   │
   ▼
Type "spawn"  ─────────────▶ list filters live as each character lands
   │                          matches name + tags + notes
   │                          favourites still pinned above matches
   ▼
Read "Zombie Spawner A · 97 / -19 / 468"
   │
   ├─ done ──────────────▶ [Ctrl+Space] hides the window
   └─ want the tp cmd ───▶ [Enter] on the focused row copies `/tp 97 -19 468`
                             toast: "Copied"
```

**Requirements this journey imposes:**
- Search must match name, tags, **and** notes — the ocean monument is findable only
  through a note.
- The list must never require scrolling to see the top match. Best match first.
- `↓`/`↑` move a row focus; `Enter` copies. No mouse anywhere in this path.

---

## 4. Journey B — Recording a new find

Frequency: end of an expedition. Budget: ~15 seconds per location.

```
[N] or click "+ Add"
   │
   ▼
Add Location modal, name field focused
   │
   ▼
Name          "Ancient Debris Vein"
Dimension     [Overworld][Nether][End]   ← REQUIRED, no default selected
   │                                        y-range hint updates on selection
X / Y / Z     -212 / 14 / 88
   │           └─▶ live Y validation against the chosen dimension
   ▼
Type          [dropdown, defaults to "misc"]
Tags          free text, comma separated
Notes         optional
   │
   ├─ type == "portal"? ──▶ portal sub-panel expands:
   │                          • live counterpart coordinate
   │                          • live link-conflict check (Journey D)
   │                          • "links to" partner dropdown
   ▼
[Save]  ──▶ validate ──┬─ hard error (no name / no dimension) ─▶ inline error, stay open
                       └─ soft warning (Y out of range, link conflict) ─▶ allow save
   │
   ▼
Modal closes, list re-renders, new row briefly highlighted, storage written
```

**Dimension has no default.** An unset dimension is the root cause of every ambiguity
in the original notes. Forcing an explicit choice is the single highest-value
validation in the app.

---

## 5. Journey C — Nether ↔ Overworld conversion

```
[2] or click "Portals"
   │
   ▼
┌────────────────────────────────────────────────────┐
│  Overworld              │           Nether         │
│  X [ 2217 ]  Z [ -4024 ]│  X [ 277 ]  Z [ -503 ]   │
│         ▲                          ▲               │
│         └────── live, bidirectional ───────┘       │
└────────────────────────────────────────────────────┘
   │
   │  Typing in either side recomputes the other on every keystroke.
   │  No Convert button. Y is absent from this widget entirely.
   ▼
Below: "Existing portals near this target"
   • lists any portal within 128 blocks of the computed counterpart
   • each with its distance and health badge
```

**Y is deliberately not present in the converter.** It cannot be converted, and an
input box for it would imply otherwise.

---

## 6. Journey D — Portal link validation ⭐

**The flagship feature.** Runs live inside the Add/Edit modal whenever
`type == "portal"`, and on demand from the Portals tab.

```
User is entering a portal at Overworld 631 / 67 / 245
   │
   ▼
On every x/z keystroke:
   compute target = toNether(631, 245) = 78 / 30
   │
   ▼
   Scan all locations where type == "portal" AND dimension == "nether"
   Keep those within 128 blocks (horizontal) of the target
   Sort by distance ascending
   │
   ├─ 0 results ──▶ ✅ GREEN
   │                 "Will create a new portal at ~78 / 30."
   │
   └─ 1+ results ─▶ ⚠️ AMBER
                     "Will likely link to Home Portal (Nether side),
                      62.5 blocks away. Build further out, or accept the link."
                     [Link them] [Ignore]
```

**Behaviour rules:**
- The warning is **never blocking**. Save is always available. The player may be
  deliberately building a shared hub.
- `[Link them]` sets `linkedPortalId` on both records — the relationship is symmetric.
- `[Ignore]` dismisses the warning for this edit session only. It is not persisted;
  the condition is real and should resurface next time.
- The nearest conflict is named. "A conflict exists" is useless; "you will land at
  Home Portal" is actionable.

### 6.1 Link health, for pairs that already exist

Shown as a badge on every portal card carrying a `linkedPortalId`.

```
For portal A linked to portal B:
   ideal   = scale(A) into B's dimension
   actual  = B's position
   d       = horizontalDistance(ideal, actual)

   d ≤ 16    ✅ Tight    "Reliably paired."
   d ≤ 128   🟡 Loose    "Works, but another portal could steal this link."
   d > 128   ❌ Broken   "These two do NOT link to each other."
```

`❌ Broken` is the important one: it means a pair the player *believes* is connected
is not. Surface it prominently — a persistent count in the Portals tab header.

---

## 7. Journey E — Notepad import

The highest-risk flow in the app. It is the only one with a mandatory gate.

```
Settings → Import → "Paste text"
   │
   ▼
Textarea. Paste the raw Notepad contents.
   │
   ▼
[Parse]
   │  Per line: extract every (x, y, z) triple; the residue becomes the label.
   │  1 triple  → 1 candidate row
   │  2 triples → 2 candidate rows (NOT assumed to be a pair)
   │  0 triples → skipped, shown in a "not recognised" list
   ▼
╔══════════════ REVIEW SCREEN — MANDATORY ══════════════╗
║  ☑  Name          Dim ▾    X     Y     Z    Type ▾    ║
║  ☑  Home          [OW ▾]   221   65    374  [base ▾]  ║
║  ☑  Portal 631    [OW ▾]   631   67    245  [portal▾] ║
║  ☐  (unnamed)     [ ?  ▾]  2411  22   -326  [misc ▾]  ║  ← unchecked: no name
║                                                       ║
║  Dimension guessed by heuristic. VERIFY EVERY ROW.    ║
║  3 rows need a dimension.        [Cancel] [Import 12] ║
╚═══════════════════════════════════════════════════════╝
   │
   ├─ [Cancel] ──▶ nothing changes
   └─ [Import] ──▶ blocked while any checked row has dimension = "?"
                   otherwise: backup, append (never replace), re-render
```

**Rules:**
- The review screen **cannot be skipped**. No "import all" shortcut. A silent bad
  import is worse than no import; see [10-DECISIONS ADR-007](10-DECISIONS-AND-RISKS.md).
- The dimension heuristic is a *suggestion* and is visually marked as guessed.
- Import **appends**. It never replaces. Full replacement is a separate, explicitly
  confirmed action in the JSON import path.
- Two coordinates on one line are two separate locations. The original notes contain
  exactly this trap: `631/67/245` and `-495/66/-394` sat on one line and are not a pair.

---

## 8. Journey F — Export & restore

```
EXPORT                                RESTORE
Settings → Export                     Settings → Import → "From file"
   │                                     │
   ▼                                     ▼
Serialise state.data                  File picker → .json
   │                                     │
   ▼                                     ▼
Download / save as                    Parse
blockbook-YYYY-MM-DD.json                │
   │                                     ├─ invalid JSON ──▶ error, stop
   ▼                                     ├─ schemaVersion > current ──▶ refuse
Toast: "Exported 15 locations"           ├─ schemaVersion < current ──▶ migrate
                                         └─ valid
                                             │
                                             ▼
                                       [Merge] or [Replace everything]
                                             │
                                             ├─ Merge   ──▶ append; skip ids that exist
                                             └─ Replace ──▶ CONFIRM MODAL
                                                            "Replaces all 15 locations.
                                                             A backup is written first."
                                             ▼
                                       Backup → write → re-render
```

---

## 9. Journey G — Brewing lookup

Two entry directions. Both must work.

### Forward — "How do I make X?"

```
[3] Brewing → search "fire res"
   │
   ▼
Potion of Fire Resistance  ▸ selected
   │
   ▼
┌───────────────────────────────────────────────────────────┐
│ Water Bottle                                              │
│   + Nether Wart      →  Awkward Potion                    │
│   + Magma Cream      →  Fire Resistance          3:00     │
│   + Redstone Dust    →  Fire Resistance          8:00     │
│   + Gunpowder        →  Splash Fire Resistance   6:00     │
│   + Dragon's Breath  →  Lingering Fire Resistance         │
│                                                           │
│ Level II: not available for this potion.                  │
│ Ingredient source: blaze powder + slimeball, or magma      │
│ cubes in the nether.                                      │
└───────────────────────────────────────────────────────────┘
```

### Reverse — "I have X, what can I brew?"

```
Brewing → "I have…" → type "magma"
   │
   ▼
Magma Cream
   → Potion of Fire Resistance (from Awkward)
   Also craftable from: blaze powder + slimeball
```

The reverse direction is the one used mid-game, standing at a brewing stand holding
an unfamiliar drop. Do not treat it as secondary.

---

## 10. Journey H — Settings

Modal, four sections.

| Section | Controls |
|---|---|
| **Display** | Theme (dark/light), coordinate format, always-on-top toggle |
| **Behaviour** | Global hotkey (default `Ctrl+Space`), start minimised, close-to-tray |
| **Data** | Storage path (read-only, with "Open folder"), Export, Import, Backups list, "Reset to seed" (double-confirmed) |
| **About** | Version, schema version, the exclusive-fullscreen caveat, link to the README |

The storage path must be visible and copyable. "Where is my data?" should never
require reading the docs.

---

## 11. Global keyboard map

| Key | Action | Context |
|---|---|---|
| `Ctrl+Space` | Show / hide window | Global, OS-level (v1.0+) |
| `/` | Focus search | Any tab, when not already in an input |
| `N` | New location | Coordinates tab |
| `1` `2` `3` `4` | Switch tab | When not in an input |
| `↓` `↑` | Move row focus | In a list |
| `Enter` | Copy `/tp` for the focused row | In a list |
| `Shift+Enter` | Open the focused row for editing | In a list |
| `Esc` | Close modal → else clear search → else hide window | Anywhere |
| `Ctrl+F` | Same as `/` | Muscle memory |
| `Tab` | Standard focus traversal | Everywhere; modals trap focus |

`Esc` is a three-stage cascade. That ordering matters: the most common intent when a
modal is open is "close the modal", not "hide the app".

---

## 12. State transition summary

```
                    ┌──────────────┐
                    │   HIDDEN     │ ◀──── Ctrl+Space / [X] / Esc(empty)
                    └──────┬───────┘
                           │ Ctrl+Space / tray Show
                           ▼
       ┌───────────────────────────────────────┐
       │            VISIBLE                    │
       │  ┌─────────────────────────────────┐  │
       │  │ BROWSING  ◀──Esc──  MODAL       │  │
       │  │    │                  ▲         │  │
       │  │    └──N / Add / Edit──┘         │  │
       │  │                                 │  │
       │  │ Tabs 1-4 move within BROWSING   │  │
       │  └─────────────────────────────────┘  │
       └───────────────────────────────────────┘

Modal kinds: add · edit · import · import-review · settings · confirm
Only one modal at a time, except confirm, which may stack on top of another.
```
