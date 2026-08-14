# 08 — Reference Data

**Product:** BlockBook · **Version:** 1.0 · **Date:** 2026-08-14

Specification for the read-only game-knowledge datasets: brewing (Phase 6) and the
reference tabs (Phase 12).

---

## 1. Principles

| # | Principle | Consequence |
|---|---|---|
| R1 | **Reference data is read-only and ships with the app** | Never written into `data.json`. Never mixed with user data. Updated by editing the file and shipping a release. |
| R2 | **Hand-typed beats imported** | ~30 potions takes 45 minutes and yields exactly the fields the UI needs. A library gives 2000 recipes to filter and a dependency to maintain. |
| R3 | **Structure is stable; numbers drift** | *What makes what* has not changed in years. Durations shift between releases. Version and flag the numbers, not the graph. |
| R4 | **One renderer for every table** | `reftable.js` contains zero domain knowledge. If a new tab needs renderer changes, the renderer is wrong. |

---

## 2. File envelope

Every reference file uses the same wrapper.

```json
{
  "schemaVersion": 1,
  "dataset": "brewing",
  "gameVersion": "1.21",
  "verified": false,
  "source": "minecraft.wiki, hand-entered 2026-08-14",
  "entries": [ ]
}
```

| Field | Purpose |
|---|---|
| `dataset` | Identifies the file. Guards against loading the wrong JSON into a tab. |
| `gameVersion` | Compared against `World.gameVersion`; a mismatch shows a hint. |
| `verified` | `false` until the values are checked against the wiki for this exact version. Drives the "unverified" badge. |
| `source` | Where the data came from and when. |

A dataset may add sibling arrays alongside `entries` where its shape genuinely needs
them. `brewing.json` adds three: `bases` (the four water-derived potions), `modifiers`
(§3.4), and `corruptions` (§3.5). These feed the persistent footer in §5 and are not
potions, so folding them into `entries` would force every consumer to filter.
**Do not add sibling arrays for anything that is merely a subtype of `entries`.**

**`data/brewing.json` currently ships with `verified: false`.** Phase 6's first task is
to check the durations against minecraft.wiki for the installed game version, then flip
the flag. Do not skip this — durations are the one thing in the file likely to be wrong.

---

## 3. Brewing — the model

### 3.1 The graph

```
                       Water Bottle
                            │
      ┌──────────────┬──────┴───────┬──────────────────┐
      │              │              │                  │
 + Nether Wart  + Ferm.Spider  + Glowstone        + Redstone
      │            Eye              │              /Sugar/…
      ▼              ▼              ▼                  ▼
  AWKWARD        Weakness        Thick             Mundane
      │                          (useless)        (useless)
      │
      │  + one of 15 ingredients
      ▼
  EFFECT POTION  ──── + Redstone ────▶  extended duration
      │          ──── + Glowstone ───▶  level II (shorter)
      │          ──── + Gunpowder ───▶  SPLASH
      │                                    │
      │                                    └── + Dragon's Breath ──▶ LINGERING
      │
      └────────── + Fermented Spider Eye ──▶ corrupted counterpart
```

**Modifier ordering matters in practice:** apply Redstone or Glowstone *before*
Gunpowder. Splashing first works, but you then need the modifier on a splash potion,
which is the same number of steps with more chances to waste an ingredient. The UI
should present the chain in the recommended order.

### 3.2 Bases

| Input | + Ingredient | Result |
|---|---|---|
| Water Bottle | Nether Wart | **Awkward Potion** — the base for nearly everything |
| Water Bottle | Fermented Spider Eye | Potion of Weakness |
| Water Bottle | Glowstone Dust | Thick Potion (no effect) |
| Water Bottle | Redstone / Sugar / Spider Eye / Magma Cream / Blaze Powder / Glistering Melon | Mundane Potion (no effect) |

### 3.3 Awkward + ingredient → effect

| Ingredient | Potion | Where to get it |
|---|---|---|
| Sugar | Swiftness | Sugar cane |
| Rabbit's Foot | Leaping | Rabbits |
| Blaze Powder | Strength | Blaze rods — nether fortress |
| Glistering Melon Slice | Healing | Melon slice + 8 gold nuggets |
| Spider Eye | Poison | Spiders |
| Ghast Tear | Regeneration | Ghasts — nether |
| Magma Cream | Fire Resistance | Blaze powder + slimeball, or magma cubes |
| Pufferfish | Water Breathing | Fishing |
| Golden Carrot | Night Vision | Carrot + 8 gold nuggets |
| Turtle Shell | Turtle Master | 5 scutes |
| Phantom Membrane | Slow Falling | Phantoms |
| Breeze Rod | Wind Charged | Breeze — **trial chamber (you have one recorded)** |
| Slime Block | Oozing | 9 slimeballs |
| Stone | Infested | Any stone |
| Cobweb | Weaving | **Spider spawner area (you have one recorded)** |

### 3.4 Modifiers

| Ingredient | Effect | Does not work on |
|---|---|---|
| **Redstone Dust** | Extends duration | Instant potions (Healing, Harming) |
| **Glowstone Dust** | Level II, usually shorter | Potions with no level II (§3.6) |
| **Gunpowder** | Converts to Splash (throwable) | — |
| **Dragon's Breath** | Splash → Lingering (area cloud) | Non-splash potions |
| **Fermented Spider Eye** | Corrupts — see §3.5 | Potions with no counterpart |

Splash potions apply ¾ of the base duration to others. Lingering clouds apply ¼.
Both figures are display-only notes; the JSON stores the base potion's duration.

### 3.5 Fermented Spider Eye corruption

| From | To |
|---|---|
| Night Vision | Invisibility |
| Swiftness | Slowness |
| Leaping | Slowness |
| Healing | Harming |
| Poison | Harming |
| Water Bottle / Awkward / Thick / Mundane | Weakness |

### 3.6 Potions with no level II

Set `"amplified": null` for these — Glowstone Dust does nothing:

Fire Resistance · Night Vision · Invisibility · Water Breathing · Slow Falling ·
Weakness · Wind Charged · Oozing · Weaving · Infested

### 3.7 Potions with no extension

Set `"extended": null` — Redstone Dust does nothing on instant potions:

Healing · Harming

### 3.8 Entry shape

```json
{
  "id": "fire_resistance",
  "name": "Potion of Fire Resistance",
  "effect": "Fire Resistance",
  "base": "awkward",
  "ingredient": "Magma Cream",
  "ingredientSource": "Blaze powder + slimeball, or magma cubes in the nether",
  "baseDuration": "3:00",
  "extended":  { "with": "Redstone Dust",  "duration": "8:00" },
  "amplified": null,
  "splashable": true,
  "lingering": true,
  "corruptsTo": null,
  "corruptsFrom": null,
  "tags": ["nether", "essential"],
  "notes": "Essential for the nether. Brew before any bastion run."
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | snake_case, stable |
| `name` | string | Full in-game display name |
| `effect` | string | The status effect, without "Potion of" |
| `base` | `"water"` \| `"awkward"` | What it is brewed from |
| `ingredient` | string | The ingredient applied to the base |
| `ingredientSource` | string | **Drives the reverse lookup.** Never leave empty. |
| `baseDuration` | `"M:SS"` \| `"instant"` | |
| `extended` | `{with, duration}` \| null | `null` for instant potions |
| `amplified` | `{with, duration}` \| null | `null` where no level II exists |
| `splashable` | boolean | Effectively always true |
| `lingering` | boolean | Requires splash first |
| `corruptsTo` | potion id \| null | Fermented Spider Eye target |
| `corruptsFrom` | potion id \| null | Inverse of the above |
| `tags` | string[] | Free-form: `combat`, `nether`, `utility`, `negative` |
| `notes` | string | Personal, practical. This is where the value is. |

### 3.9 Reverse lookup

The mid-game direction: standing at a brewing stand holding an unfamiliar drop.

```js
function whatCanIBrew(item, entries) {
  const q = item.toLowerCase();
  return {
    asIngredient: entries.filter(e => e.ingredient.toLowerCase().includes(q)),
    asModifier:   MODIFIERS.filter(m => m.name.toLowerCase().includes(q)),
    asSource:     entries.filter(e => e.ingredientSource.toLowerCase().includes(q)),
  };
}
```

`asSource` is the reason `ingredientSource` must always be populated: typing "gold"
should surface Night Vision and Healing, because both need gold nuggets even though
neither lists gold as its ingredient.

### 3.10 Where the data could come from instead

| Source | Verdict |
|---|---|
| `github.com/PrismarineJS/minecraft-data` | Per-version JSON. Accurate, but thousands of recipes to filter and a shape that does not match the UI. |
| `github.com/Articdive/ArticData` | Extracted recipes and potions. Same mismatch problem. |
| The game jar: `.minecraft/versions/<v>/<v>.jar` → `data/minecraft/recipe/` | Authoritative. Brewing entries use `"type": "minecraft:brewing"` with `input`, `ingredient`, `output`. **Best source for verifying durations.** |
| minecraft.wiki | Best for human-readable durations, per version. |

**Recommendation: hand-type it** (already done — see `data/brewing.json`), then verify
the durations against the wiki for the installed version. Total: ~45 minutes.

---

## 4. `reftable.js` — the generic renderer

Built once in Phase 6, reused by every tab in Phase 12. This is the component that
makes each later tab a two-hour job instead of a two-day one.

### 4.1 Contract

```js
/**
 * @param {HTMLElement} mount
 * @param {Object}   cfg
 * @param {Object[]} cfg.rows
 * @param {Array<{key, label, width?, align?, format?, sortable?}>} cfg.columns
 * @param {string[]} cfg.searchKeys     which fields the search box matches
 * @param {string}   [cfg.defaultSort]
 * @param {Array<{key, label, values}>} [cfg.filters]
 * @param {(row) => HTMLElement} [cfg.detail]   optional expanded view
 */
function renderRefTable(mount, cfg) { /* … */ }
```

### 4.2 Rules

- **Zero domain knowledge.** No mention of potions, enchantments, or mobs anywhere
  inside it. Everything comes from `cfg`.
- Search, sort, and filter live inside the component — a tab never reimplements them.
- Same visual language as the locations list ([04-UIUX-SPEC](04-UIUX-SPEC.md)).
- Fully keyboard-navigable: `/` focuses search, `↓`/`↑` move rows, `Enter` expands.

**Phase 12 gate:** if adding a tab requires editing `reftable.js`, the renderer is not
generic enough. Fix the renderer, not the tab. That is the whole point of building it
first.

---

## 5. Brewing tab UI

Layout detail in [04-UIUX-SPEC §4.10](04-UIUX-SPEC.md); behaviour in
[03-APP-FLOW §9](03-APP-FLOW.md).

```
┌──────────────────────────┬──────────────────────────────────────┐
│ 🔍 fire res              │  🧪 Potion of Fire Resistance        │
│ ─────────────────────────│  ──────────────────────────────────  │
│ ▸ Fire Resistance        │  Water Bottle                        │
│   Healing                │    + Nether Wart    → Awkward        │
│   Invisibility           │    + Magma Cream    → Fire Res  3:00 │
│   Leaping                │                                      │
│   Night Vision           │  + Redstone Dust    → 8:00 extended  │
│   Poison                 │  + Gunpowder        → splash  6:00   │
│   Regeneration           │  + Dragon's Breath  → lingering      │
│   …                      │                                      │
│                          │  Level II   not available            │
│ ── I have… ──────────────│  Source     blaze powder + slimeball │
│ [ magma            ]     │  Note       brew before a bastion    │
│ → Fire Resistance        │                                      │
├──────────────────────────┴──────────────────────────────────────┤
│ MODIFIERS  Redstone: longer · Glowstone: stronger ·             │
│            Gunpowder: splash · Dragon's Breath: lingering        │
│ CORRUPT    Night Vision→Invisibility · Swiftness→Slowness ·      │
│            Healing→Harming · Poison→Harming                      │
└──────────────────────────────────────────────────────────────────┘
```

The modifier and corruption tables are a **persistent footer**, not a separate view.
They are small, constantly needed, and hiding them behind a click defeats the purpose.

---

## 6. Future reference tabs (Phase 12)

Priority order. Build in this sequence; each is a JSON plus a `reftable.js` mount.

### 6.1 Enchanting — highest value

| Column | Content |
|---|---|
| Name | Sharpness, Protection, Mending… |
| Max level | I–V |
| Applies to | Sword, tools, armour, bow… |
| Conflicts with | Sharpness ⟷ Smite ⟷ Bane of Arthropods; the Protection family; Infinity ⟷ Mending; Silk Touch ⟷ Fortune |
| Source | Table, villager, loot, treasure-only |
| Notes | Anvil "Too Expensive" at 40 levels; prior-work penalty doubles per use |

### 6.2 Mob spawn conditions

Light level 0 for hostile mobs since 1.18, spawnable block types, dimension
restrictions, spawn-proofing methods. Directly useful for turning the three recorded
spawners into farms.

### 6.3 Villager trades

Profession → workstation → trade tiers → prices. The largest table; high value.
Good stress test for `reftable.js` — if it handles nested tiers cleanly, it handles
anything.

### 6.4 Fuel burn times

| Fuel | Seconds | Items smelted |
|---|---|---|
| Lava bucket | 1000 | 100 |
| Block of coal | 800 | 80 |
| Dried kelp block | 200 | 20 |
| Blaze rod | 120 | 12 |
| Coal / charcoal | 80 | 8 |
| Planks | 15 | 1.5 |

### 6.5 XP & enchanting levels

Level-to-XP table, XP sources, bookshelf count → max enchant level (15 bookshelves
for level 30).

### 6.6 Nether portal build sizes

Minimum 4×5 (10 obsidian with corners omitted), maximum 23×23. Include the corner
trick — it saves 4 obsidian per portal.

### 6.7 Beacon

Pyramid sizes 1–4, base block counts (9 / 34 / 83 / 164), range per tier, available
effects per tier, valid base blocks.

---

## 7. Maintenance

| Trigger | Action |
|---|---|
| Game updates to a new minor version | Set `verified: false` on every dataset; spot-check durations; re-flag |
| A duration looks wrong in-game | Trust the game. Fix the JSON, note it in `source`. |
| A new potion is added to the game | Append an entry; no schema change; no version bump |
| A new dataset is added | New file, same envelope, new tab. No changes to `reftable.js`. |

Reference data lives outside `data.json` precisely so that updating it never risks
user data. A bad `brewing.json` shows wrong potion times; it can never lose a
coordinate.
