# Minecraft Companion — Build Plan

> **Archived source document.** This is the original plan, preserved verbatim as the
> origin of everything in `docs/`. Where this document and `docs/` disagree, `docs/`
> wins — it is the maintained version. Product name has since become **BlockBook**.

A local-first desktop companion for a Java Edition survival world: coordinate book,
nether portal math, and offline brewing/reference tables.

Target: **you**, single player, Java Edition, Windows 11.
Written 2026-08-14.

---

## 0. Product definition

### The problem
- Coordinates live in a flat Notepad file with no structure, no search, no validation.
- Potion recipes require opening a browser mid-game.
- Nothing is portable when moving to a new PC.

### The one-line goal
> Press a hotkey, get any coordinate or recipe in under 3 seconds, without leaving the game.

### Non-goals (say no to these, they will eat the project)
- Multi-user / server / cloud sync. It's your world. A JSON file is the sync layer.
- Live game integration (reading memory, log parsing, mods). Huge effort, fragile.
- A map renderer. Xaero's already does this better than you will.
- Mobile. Later, if ever.

### Success criteria for v1.0
1. Every coordinate from the Notepad file is in the app, tagged and searchable.
2. Typing an overworld coordinate instantly shows the nether counterpart.
3. The app warns before you build a portal that will link to the wrong existing portal.
4. Full brewing tree browsable offline.
5. `Ctrl+Space` summons it over a borderless-windowed Minecraft.
6. Copying one folder to another PC restores everything.

---

## 1. Tech stack

### v0.x — single HTML file, no build step
| Layer | Choice | Why |
|---|---|---|
| Everything | One `index.html` with inline `<style>` and `<script>` | Zero tooling. Open in a browser, refresh to see changes. You can build and ship this in one evening. |
| Storage | `localStorage` + explicit Export/Import JSON | No permissions, no file dialogs, works instantly. |
| Framework | **None.** Vanilla JS. | ~600 lines total. A framework costs more than it saves at this size. |

### v1.x — Tauri desktop app
| Layer | Choice | Version |
|---|---|---|
| Shell | **Tauri 2.x** | Uses the OS WebView2 instead of bundling Chromium: ~10 MB app, ~30–40 MB RAM idle. Electron would be 100 MB+ and hundreds of MB RAM sitting next to Minecraft. |
| Backend | **Rust** (stable, via `rustup`) | Only for filesystem, hotkey, tray. You will write maybe 60 lines of it. |
| Frontend | Same vanilla HTML/JS from v0 | The whole point of building v0 first. |
| Bundler | **Vite** (latest) | Comes with the Tauri scaffold. Optional — you can serve the raw HTML. |
| Node | **LTS (22+)** | Only for the scaffold/dev server. |
| Storage | `data.json` via `@tauri-apps/plugin-fs` | Portable: file sits next to the exe. |

**Windows prerequisites for Tauri** (install before Phase 8):
1. **Microsoft C++ Build Tools** — "Desktop development with C++" workload.
2. **WebView2** — already present on Windows 11.
3. **Rust** — `rustup` from https://rustup.rs
4. **Node LTS** — https://nodejs.org

Scaffold command when you get there:
```
npm create tauri-app@latest
```

### Tauri plugins you will need
| Plugin | Purpose | Phase |
|---|---|---|
| `@tauri-apps/plugin-fs` | Read/write `data.json` | 10 |
| `@tauri-apps/plugin-global-shortcut` | `Ctrl+Space` summon | 9 |
| `@tauri-apps/plugin-clipboard-manager` | Copy `/tp` commands | 9 |
| `@tauri-apps/plugin-dialog` | Import/export file picker | 10 |
| `@tauri-apps/plugin-opener` | Open wiki links in browser | 12 |

---

## 2. Data model

One file. Versioned from day one so future-you can migrate.

```json
{
  "schemaVersion": 1,
  "app": "mc-companion",
  "worlds": [
    {
      "id": "w_main",
      "name": "Survival World",
      "edition": "java",
      "gameVersion": "1.21",
      "seed": null,
      "createdAt": "2026-08-14T00:00:00Z",
      "locations": [ /* see below */ ]
    }
  ],
  "settings": {
    "activeWorldId": "w_main",
    "coordFormat": "x / y / z",
    "alwaysOnTop": true,
    "hotkey": "Ctrl+Space",
    "theme": "dark"
  }
}
```

### Location object
```json
{
  "id": "loc_001",
  "name": "Home",
  "dimension": "overworld",
  "x": 221,
  "y": 65,
  "z": 374,
  "type": "base",
  "tags": ["main", "storage"],
  "notes": "",
  "linkedPortalId": null,
  "favorite": true,
  "createdAt": "2026-08-14T00:00:00Z",
  "updatedAt": "2026-08-14T00:00:00Z"
}
```

### Field rules
- `dimension` — enum: `"overworld" | "nether" | "end"`. **Never optional.** Every ambiguity in your current notes comes from missing dimension labels.
- `type` — enum, drives the icon and default colour:
  `base`, `portal`, `spawner`, `structure`, `biome`, `mine`, `farm`, `village`, `stronghold`, `fortress`, `bastion`, `monument`, `shipwreck`, `trial_chamber`, `misc`
- `linkedPortalId` — only for `type: "portal"`. Points at the portal in the other dimension it pairs with. This is what powers the validator.
- `y` — allow `null` for "surface, don't care".
- `id` — `crypto.randomUUID()` or a simple counter. Never reuse.

### Valid Y ranges (for input validation)
| Dimension | Min | Max |
|---|---|---|
| Overworld | −64 | 320 |
| Nether | 0 | 127 (roof bedrock at 127) |
| End | 0 | 255 |

---

## 3. Core algorithms

### 3.1 Nether ↔ Overworld conversion
Horizontal only. **Y is never scaled.**

```js
// Overworld -> Nether
const toNether = (x, z) => ({ x: Math.floor(x / 8), z: Math.floor(z / 8) });

// Nether -> Overworld
const toOverworld = (x, z) => ({ x: x * 8, z: z * 8 });
```

### 3.2 Portal link validator (the killer feature)
When you enter a portal, the game searches the destination dimension for an existing
portal within **128 blocks horizontally** of the scaled target position. If it finds one,
it sends you there instead of creating a new portal.

```js
const HORIZONTAL_LINK_RADIUS = 128;

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Given a proposed new portal, find existing portals in the destination
 * dimension that would hijack the link.
 */
function findLinkConflicts(newPortal, allLocations) {
  const destDim = newPortal.dimension === "overworld" ? "nether" : "overworld";

  const target = newPortal.dimension === "overworld"
    ? toNether(newPortal.x, newPortal.z)
    : toOverworld(newPortal.x, newPortal.z);

  return allLocations
    .filter(l => l.type === "portal" && l.dimension === destDim)
    .map(l => ({ location: l, distance: horizontalDistance(target, l) }))
    .filter(r => r.distance <= HORIZONTAL_LINK_RADIUS)
    .sort((a, b) => a.distance - b.distance);
}
```

**UI behaviour:**
- 0 conflicts → green: "Will create a new portal at ~`{target.x} / {target.z}`."
- 1+ conflicts → amber: "⚠ Will likely link to **{nearest.name}** ({distance} blocks away). Build a new portal further out, or accept the link."

### 3.3 Link health check for *existing* pairs
For every portal with a `linkedPortalId`, compute the distance between the scaled
position and the actual partner. Show a badge:

| Distance | Badge | Meaning |
|---|---|---|
| ≤ 16 | ✅ Tight | Reliably paired |
| 17–128 | 🟡 Loose | Works, but another portal could steal it later |
| > 128 | ❌ Broken | These two do **not** link to each other |

### 3.4 Distance / nearest
```js
// 3D distance, for "what's near me"
const dist3 = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 64) - (b.y ?? 64), a.z - b.z);

// Cross-dimension aware: normalise everything to overworld scale first
function normalised(loc) {
  if (loc.dimension === "nether") return { ...loc, ...toOverworld(loc.x, loc.z) };
  return loc;
}
```

### 3.5 Notepad importer
Parses your existing file. Handles both `/` and space separators, optional label
after `-`, and the `----` pair syntax.

```js
const COORD = /(-?\d+)\s*[\/ ]\s*(-?\d+)\s*[\/ ]\s*(-?\d+)/g;

function parseLine(line) {
  const coords = [...line.matchAll(COORD)].map(m => ({
    x: +m[1], y: +m[2], z: +m[3]
  }));
  const label = line.replace(COORD, "").replace(/[-\/]{2,}/g, " ").trim();
  return { coords, label };
}
```
Rules:
- 1 coord on a line → one location, name = label.
- 2 coords on a line → two locations; if both mention "portal", offer to link them
  and run the validator to confirm the pair is real.
- Dimension is **not** inferable — the importer must show a review screen where you
  set dimension per row before committing. Guess with a heuristic (`0 ≤ y ≤ 127` and
  label contains "nether" → nether) but always let the user override.

---

## 4. Seed data — your existing coordinates, pre-parsed

Drop this in as `seed.json` for Phase 1. **Rows marked `NEEDS REVIEW` are genuinely
ambiguous in the original notes — fix them in-game or in the review screen.**

```json
[
  { "name": "Home", "dimension": "overworld", "x": 221, "y": 65, "z": 374, "type": "base", "favorite": true },

  { "name": "Home Portal (Nether side)", "dimension": "nether", "x": 16, "y": 46, "z": 38, "type": "portal",
    "notes": "Scales to overworld 128 / 304. Home is at 221/374 -> nether 27/46. 14 blocks apart: tightly linked." },

  { "name": "Portal @ 631/245", "dimension": "overworld", "x": 631, "y": 67, "z": 245, "type": "portal",
    "notes": "NEEDS REVIEW. Scales to nether 78/30. Home Portal is at nether 16/38 = 63 blocks away, INSIDE the 128 link radius. This portal probably links to Home Portal, not to a new one." },

  { "name": "Portal @ -495/-394", "dimension": "nether", "x": -495, "y": 66, "z": -394, "type": "portal",
    "notes": "NEEDS REVIEW. Was written on the same line as 631/67/245 but they are NOT a pair (631/8=78, not -495). If nether, overworld side is ~-3960 / -3152." },

  { "name": "Unlabelled 2411", "dimension": "overworld", "x": 2411, "y": 22, "z": -326, "type": "misc",
    "notes": "NEEDS REVIEW - no label in original notes. Y=22, likely a cave or mine." },

  { "name": "Desert Red Cave", "dimension": "overworld", "x": 2225, "y": 63, "z": -3552, "type": "biome" },
  { "name": "Jungle Biome", "dimension": "overworld", "x": 2000, "y": 62, "z": -2000, "type": "biome" },
  { "name": "Shipwreck (north)", "dimension": "overworld", "x": 936, "y": 62, "z": -501, "type": "shipwreck" },
  { "name": "Shipwreck (near monument)", "dimension": "overworld", "x": 823, "y": 62, "z": -271, "type": "shipwreck",
    "notes": "Ocean monument nearby - get exact coords next visit." },

  { "name": "Zombie Spawner A", "dimension": "overworld", "x": 97, "y": -19, "z": 468, "type": "spawner", "tags": ["zombie"] },
  { "name": "Zombie Spawner B", "dimension": "overworld", "x": 105, "y": -49, "z": 256, "type": "spawner", "tags": ["zombie"] },
  { "name": "Spider Spawner", "dimension": "overworld", "x": 91, "y": -13, "z": 200, "type": "spawner", "tags": ["spider"] },

  { "name": "Bastion Portal (Overworld side)", "dimension": "overworld", "x": 688, "y": 69, "z": -1926, "type": "portal",
    "notes": "Scales to nether 86 / -240. Nether-side portal not yet recorded." },

  { "name": "Trial Chamber Portal (Overworld)", "dimension": "overworld", "x": 2217, "y": -5, "z": -4024, "type": "portal",
    "notes": "Scales to nether 277 / -503." },

  { "name": "Fortress Portal (Nether)", "dimension": "nether", "x": 276, "y": 45, "z": -507, "type": "portal",
    "notes": "Pairs with Trial Chamber Portal. Only 4 blocks off target: tightly linked. VERIFIED GOOD PAIR." }
]
```

### Verified findings from your data
| Pair | Status |
|---|---|
| Trial Chamber `2217/-4024` ↔ Fortress `276/-507` | ✅ 2217÷8=277, −4024÷8=−503. Actual 276/−507 is 4.1 blocks off. Correctly paired. |
| Home `221/374` ↔ Home Portal `16/38` | ✅ Target 27/46, actual 16/38 = 14.5 blocks. Correctly paired. |
| Portal `631/245` | ⚠️ Target nether 78/30 is 63 blocks from Home Portal. **Link collision risk.** |
| `631/67/245` + `-495/66/-394` on one line | ❌ Not a valid pair. Two separate portals recorded together. |
| `2411/22/-326` | ❓ No label. |

---

## 5. Reference data — brewing

Structure this as `data/brewing.json`. The **graph structure below is exact vanilla
behaviour**; spot-check the exact durations against minecraft.wiki for your game
version before shipping, since they shift between releases.

### 5.1 Bases
| Input | + Ingredient | Result |
|---|---|---|
| Water Bottle | Nether Wart | **Awkward Potion** (the base for almost everything) |
| Water Bottle | Fermented Spider Eye | Potion of Weakness |
| Water Bottle | Glowstone Dust | Thick Potion (useless) |
| Water Bottle | Redstone / Sugar / etc. | Mundane Potion (useless) |

### 5.2 Awkward Potion + ingredient → effect
| Ingredient | Potion | Ingredient source |
|---|---|---|
| Sugar | Swiftness | Sugar cane |
| Rabbit's Foot | Leaping | Rabbits |
| Blaze Powder | Strength | Blaze rods (fortress) |
| Glistering Melon Slice | Healing | Melon + gold nuggets |
| Spider Eye | Poison | Spiders |
| Ghast Tear | Regeneration | Ghasts (nether) |
| Magma Cream | Fire Resistance | Blaze powder + slimeball, or magma cubes |
| Pufferfish | Water Breathing | Fishing |
| Golden Carrot | Night Vision | Carrot + gold nuggets |
| Turtle Shell | Turtle Master (Slowness + Resistance) | 5 scutes |
| Phantom Membrane | Slow Falling | Phantoms |
| Breeze Rod | Wind Charged | Breeze (trial chamber) — **you have a trial chamber** |
| Slime Block | Oozing | Slimeballs |
| Stone | Infested | Any stone |
| Cobweb | Weaving | Spider spawner area — **you have two** |

### 5.3 Modifiers (apply to a finished potion)
| Ingredient | Effect |
|---|---|
| **Redstone Dust** | Extends duration. Does not work on instant potions (Healing, Harming). |
| **Glowstone Dust** | Increases level (II). Usually cuts duration. |
| **Gunpowder** | Converts to **Splash** potion (throwable). |
| **Dragon's Breath** | Converts a Splash potion to **Lingering** (leaves a cloud). |
| **Fermented Spider Eye** | Corrupts — see below. |

### 5.4 Fermented Spider Eye corruption table
| From | To |
|---|---|
| Night Vision | Invisibility |
| Swiftness | Slowness |
| Leaping | Slowness |
| Healing | Harming |
| Poison | Harming |
| Water Bottle / Awkward / Thick / Mundane | Weakness |

### 5.5 JSON shape
```json
{
  "potions": [
    {
      "id": "fire_resistance",
      "name": "Potion of Fire Resistance",
      "base": "awkward",
      "ingredient": "Magma Cream",
      "ingredientSource": "Blaze powder + slimeball, or magma cubes in the nether",
      "baseDuration": "3:00",
      "extended": { "with": "Redstone Dust", "duration": "8:00" },
      "amplified": null,
      "splashable": true,
      "notes": "Essential for the nether. Brew before any bastion run."
    }
  ]
}
```
Set `"amplified": null` where a level II does not exist (Fire Resistance, Night Vision,
Invisibility, Water Breathing, Slow Falling have no level II). Set `"extended": null`
for Healing and Harming (instant, cannot be extended).

### 5.6 Where to get the data if you'd rather not hand-type it
- **PrismarineJS/minecraft-data** — `github.com/PrismarineJS/minecraft-data`, JSON per game version.
- **ArticData** — `github.com/Articdive/ArticData`, extracts recipes and potions.
- **The game jar itself** — `.minecraft/versions/<ver>/<ver>.jar` → `data/minecraft/recipe/`. Brewing entries use `"type": "minecraft:brewing"` with `input`, `ingredient`, `output`.

Hand-typing ~30 potions takes 45 minutes and gives you exactly the fields your UI needs.
The libraries give you 2000 recipes you have to filter. **Recommendation: hand-type it.**

---

## 6. Reference data — other tabs (v1.2+)

Build these only after coordinates and brewing are solid. Priority order:

1. **Enchanting** — max level per enchantment, conflicts (Sharpness/Smite/Bane, Protection family, Infinity/Mending), anvil "Too Expensive" at 40 levels.
2. **Mob spawn conditions** — light level 0 for hostile mobs (1.18+), spawnable block types, dimension restrictions. Useful for making your spawners into farms.
3. **Villager trades** — profession → workstation → trade tiers. High value, big table.
4. **Fuel burn times** — coal 80s, lava bucket 1000s, blaze rod 120s, dried kelp block 200s, etc.
5. **XP table** — levels needed for enchanting (30 requires 15 bookshelves).
6. **Nether portal build sizes** — min 4×5 (10 obsidian with corners removed), max 23×23.
7. **Beacon** — pyramid sizes 1–4, ranges, effects.

Each is a static JSON + a searchable table component. Same component, different data —
build the table renderer once in Phase 6 and reuse it.

---

## 7. Feature matrix by version

| Feature | v0.1 | v0.2 | v0.3 | v1.0 | v1.1 | v1.2 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Add/edit/delete locations | ✅ | | | | | |
| Search by name | ✅ | | | | | |
| Filter by dimension + type | ✅ | | | | | |
| Nether ↔ Overworld calculator | | ✅ | | | | |
| Portal link validator | | ✅ | | | | |
| Portal pair health badges | | ✅ | | | | |
| Export / Import JSON | | | ✅ | | | |
| Notepad importer | | | ✅ | | | |
| Copy as `/tp` command | | | ✅ | | | |
| Brewing tree tab | | | ✅ | | | |
| Runs as `.exe` (Tauri) | | | | ✅ | | |
| Always-on-top | | | | ✅ | | |
| Global hotkey summon | | | | ✅ | | |
| System tray | | | | ✅ | | |
| Portable `data.json` | | | | ✅ | | |
| Auto-backup on write | | | | ✅ | | |
| Export to Xaero's waypoints | | | | | ✅ | |
| Import from Xaero's waypoints | | | | | ✅ | |
| Distance / nearest-to | | | | | ✅ | |
| Enchanting + mob + trade tabs | | | | | | ✅ |
| Multi-world support | | | | | | ✅ |

---

## 8. File structure

### v0 (single file)
```
mc-companion/
├─ index.html          <- the entire app
├─ seed.json           <- your parsed coordinates
└─ BUILD_PLAN.md       <- this file
```

### v1 (Tauri)
```
mc-companion/
├─ src/
│  ├─ index.html
│  ├─ main.js              <- app bootstrap, routing between tabs
│  ├─ store.js             <- load/save, schema migration
│  ├─ locations.js         <- CRUD, search, filter
│  ├─ portals.js           <- conversion + validator (Section 3)
│  ├─ brewing.js           <- brewing tab renderer
│  ├─ reftable.js          <- generic searchable table (reused by all ref tabs)
│  ├─ xaero.js             <- waypoint import/export
│  └─ style.css
├─ data/
│  ├─ brewing.json
│  ├─ enchantments.json
│  ├─ mobs.json
│  └─ fuel.json
├─ src-tauri/
│  ├─ src/main.rs          <- hotkey, tray, always-on-top
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  └─ icons/
├─ package.json
└─ BUILD_PLAN.md
```

---

## 9. PHASE-BY-PHASE BUILD PLAN

Each phase has a **Done when** line. Do not start the next phase until it passes.
Time estimates assume you are learning as you go.

---

### PHASE 0 — Setup (30 min)
**Goal:** a folder and a file that opens.

- [ ] Create `C:\Users\Muhammed suhaib\mc-companion\`
- [ ] `git init` — you will break things, you will want to undo them
- [ ] Create `index.html` with a heading and nothing else
- [ ] Open it in Chrome/Edge. Pin the tab.
- [ ] Optional: install the VS Code "Live Server" extension for auto-reload

**Done when:** you can edit the file, press refresh, and see the change.

---

### PHASE 1 — Data model + seed (1 hr)
**Goal:** your real coordinates exist as structured data.

- [ ] Create `seed.json` from Section 4
- [ ] Write the `Location` shape as a JSDoc comment at the top of your script — this
      is your contract, refer back to it constantly
- [ ] Load the seed into a `let state = { ... }` variable
- [ ] `console.log(state)` and confirm all 14 locations are there

**Done when:** the browser console prints your full location list.

---

### PHASE 2 — UI shell + list rendering (2 hrs)
**Goal:** see your coordinates on screen.

- [ ] Tab bar: `Coordinates | Portals | Brewing | Reference` (last two are empty stubs)
- [ ] Render locations as cards or a table: icon, name, `x / y / z`, dimension badge, tags
- [ ] Colour-code the dimension badge (overworld green, nether red, end purple)
- [ ] Dark theme — you will use this at night next to a dark game
- [ ] Sort: by name, by type, by recently updated

**Done when:** all 14 seed locations render, readable at a glance.

**Watch out for:** don't build a component framework. One `render()` function that
rebuilds the list from `state` is correct at this scale.

---

### PHASE 3 — CRUD + search + filter (2 hrs)
**Goal:** you can actually use it as a notepad replacement.

- [ ] "Add location" form: name, dimension (required), x/y/z, type, tags, notes
- [ ] Validate Y against the dimension's range (Section 2)
- [ ] Edit in place, delete with a confirm
- [ ] Search box — filters as you type, matches name + tags + notes
- [ ] Filter chips: dimension, type
- [ ] Persist to `localStorage` on every change
- [ ] Auto-focus the search box on load

**Done when:** you add a new coordinate, close the browser, reopen, and it's still there.

---

### PHASE 4 — Nether math + validator (1.5 hrs) ⭐
**Goal:** the feature that makes this worth building.

- [ ] Implement `toNether` / `toOverworld` (Section 3.1)
- [ ] Portals tab: two input boxes, live bidirectional conversion as you type
- [ ] On every location card in a portal type, show the counterpart coordinate
- [ ] Implement `findLinkConflicts` (Section 3.2)
- [ ] In the Add form, when `type = portal`, show the live conflict warning
- [ ] Implement pair health badges (Section 3.3) — ✅ / 🟡 / ❌
- [ ] `linkedPortalId` — dropdown to pick a partner portal

**Done when:** the app independently flags that Portal `631/245` collides with
Home Portal, and marks the Trial Chamber ↔ Fortress pair as tightly linked.
**That is your correctness test — you already know both answers.**

---

### PHASE 5 — Import / Export (1.5 hrs)
**Goal:** portability. The app is now safe to trust with real data.

- [ ] Export button → downloads `mc-companion-YYYY-MM-DD.json`
- [ ] Import button → file input, parse, validate `schemaVersion`, replace or merge
- [ ] Notepad importer (Section 3.5): paste a blob of text into a textarea
- [ ] Review screen for the import: a table where you set dimension per row before
      committing. **Do not skip the review screen** — a silent bad import is worse
      than no import.
- [ ] Copy-to-clipboard button per location: `/tp 221 65 374`

**Done when:** you export, clear localStorage, import, and nothing is lost.

---

### PHASE 6 — Brewing tab (2 hrs)
**Goal:** stop alt-tabbing to a wiki.

- [ ] Hand-type `data/brewing.json` from Section 5 (~30 entries, 45 min)
- [ ] Build the generic searchable table renderer (`reftable.js`) — reuse it later
- [ ] Potion list with search
- [ ] Detail view: full brewing chain rendered as steps
      `Water → +Nether Wart → Awkward → +Magma Cream → Fire Resistance → +Redstone → 8:00`
- [ ] "I have X, what can I brew?" — reverse lookup by ingredient
- [ ] Show the modifier table (Section 5.3) as a persistent sidebar

**Done when:** you can answer "how do I make splash fire resistance" without leaving the app.

**→ Ship v0.3. Use it for a week before Phase 8. You will find out what's actually missing.**

---

### PHASE 7 — Polish (1.5 hrs)
- [ ] Keyboard shortcuts: `/` focus search, `N` new location, `Esc` close modal, `1-4` tabs
- [ ] Favourites — pinned to the top
- [ ] Icons per location type (emoji is fine, do not download an icon pack)
- [ ] Empty states with a helpful message
- [ ] Recently viewed list

---

### PHASE 8 — Tauri wrap (2–3 hrs)
**Goal:** a real `.exe`.

- [ ] Install prerequisites (Section 1)
- [ ] `npm create tauri-app@latest` — choose vanilla JS
- [ ] Copy your `index.html` / JS / CSS into `src/`
- [ ] `npm run tauri dev` — confirm it launches as a native window
- [ ] Set window size, min size, and title in `tauri.conf.json`
- [ ] `npm run tauri build` → get an `.exe`

**Done when:** the exe runs on your machine with all v0.3 features intact.

**Watch out for:** localStorage still works in the webview, so nothing breaks at this
step. Storage migration is Phase 10 — keep the two changes separate so you know
which one broke things.

---

### PHASE 9 — Overlay behaviour (2 hrs)
**Goal:** usable *during* play.

- [ ] `alwaysOnTop: true` in `tauri.conf.json`, plus a toggle in settings
- [ ] `plugin-global-shortcut` → `Ctrl+Space` shows/hides the window
- [ ] System tray icon: Show / Hide / Quit
- [ ] Close button minimises to tray instead of quitting
- [ ] `plugin-clipboard-manager` for the `/tp` copy button
- [ ] Remember window position and size between launches
- [ ] Optional: a compact mode — small window, just search + results

**Done when:** Minecraft is running borderless-windowed, you hit `Ctrl+Space`, type
"spawner", and read the coordinate without the game minimising.

**Watch out for:** global hotkeys do not reach an app when Minecraft is **exclusive
fullscreen**. Set Minecraft to windowed or borderless. Note this in your own README.

---

### PHASE 10 — File-based storage (2 hrs)
**Goal:** true portability.

- [ ] `plugin-fs` — read/write `data.json`
- [ ] Portable mode: look for `data.json` next to the exe first; fall back to app data dir
- [ ] One-time migration: if localStorage has data and `data.json` doesn't, write it out
- [ ] **Auto-backup**: before every write, copy the current file to
      `backups/data-YYYYMMDD-HHMMSS.json`. Keep the last 20.
- [ ] Write atomically: write to `data.json.tmp`, then rename. Prevents corruption
      on a crash mid-write.
- [ ] `plugin-dialog` for import/export file pickers

**Done when:** you copy the whole folder to a USB stick, run it on another PC, and
every coordinate is there.

**→ Ship v1.0.**

---

### PHASE 11 — Xaero's integration (2–3 hrs)
**Goal:** the desktop app and your in-game map stay in sync.

**Find your waypoint files first:**
```
.minecraft\XaeroWaypoints\<world folder>\dim%0\mw$default_1.txt     <- overworld
.minecraft\XaeroWaypoints\<world folder>\dim%-1\mw$default_1.txt    <- nether
.minecraft\XaeroWaypoints\<world folder>\dim%1\mw$default_1.txt     <- end
```
Singleplayer folders are named after the world (sometimes with a hash suffix).

**Critical step: open one of your own waypoint files first and count the fields.**
The line format is colon-delimited and roughly:
```
waypoint:<name>:<initials>:<x>:<y>:<z>:<colour 0-15>:<disabled>:<type>:<set>:<rotate_on_tp>:<yaw>:<visibility>:<destination>
```
but the trailing fields have changed across Xaero versions. **Do not trust the layout
above — copy the exact field count and ordering from your real file.** Write your
exporter to match your installed version.

- [ ] Parse an existing waypoint file into location objects
- [ ] Export locations to a waypoint file, one per dimension
- [ ] **Always back up the original waypoint file before writing.** Xaero's caches
      waypoints in memory — close Minecraft before importing, or your changes get
      overwritten on exit.
- [ ] Map your `type` enum to Xaero colours (0–15)
- [ ] Generate sensible 1–2 char initials from the name

**JourneyMap alternative** (if you switch): waypoints are individual JSON files under
`.minecraft\journeymap\data\sp\<world>\waypoints\` — far easier to parse than
Xaero's text format. If you use both mods, target JourneyMap for import/export first.

---

### PHASE 12 — More reference tabs (2 hrs each)
Work down the priority list in Section 6. Each one is: hand-type a JSON, point the
`reftable.js` renderer at it, add a tab. If it takes more than 2 hours, the table
renderer isn't generic enough — go fix that instead.

---

### PHASE 13 — Ship it properly (2 hrs)
- [ ] App icon (`src-tauri/icons/`) — `npm run tauri icon path/to/512.png` generates all sizes
- [ ] Build an installer (`.msi` / NSIS) via `npm run tauri build`
- [ ] A `README.md`: how to run, where data lives, the fullscreen hotkey caveat
- [ ] Push to a private GitHub repo — this is also your off-site backup
- [ ] Optional: `plugin-updater` if you ever run it on two machines

---

## 10. Risk list

| Risk | Mitigation |
|---|---|
| **Data loss** — a bad write wipes your coordinates | Atomic writes + rolling backups (Phase 10). Do this the same day you switch to file storage. |
| **Scope creep** — you start building a map renderer | The v1.0 success criteria in Section 0 are the definition of done. Everything else is v1.1+. |
| **Tauri setup friction** — C++ build tools are a 6 GB download | This is exactly why v0 is a plain HTML file. You get a working, useful app *before* touching the toolchain. |
| **Xaero format drift** — a mod update breaks your exporter | Never write to the waypoint file without backing it up. Treat the exporter as best-effort. |
| **Never finishing** | Phase 6 ships something genuinely useful. Everything after that is upgrades to a working tool, not a march to a distant v1. |

---

## 11. Quick reference card

```
NETHER MATH
  Overworld -> Nether:  divide X and Z by 8
  Nether -> Overworld:  multiply X and Z by 8
  Y is NEVER scaled
  Portal link search radius: 128 blocks horizontal

Y RANGES
  Overworld  -64 .. 320
  Nether       0 .. 127
  End          0 .. 255

BREWING SPINE
  Water + Nether Wart          -> Awkward
  Awkward + <ingredient>       -> effect potion
  + Redstone                   -> longer
  + Glowstone                  -> stronger
  + Gunpowder                  -> splash
  Splash + Dragon's Breath     -> lingering
  + Fermented Spider Eye       -> corrupt (see table)

XAERO'S WAYPOINT FILES
  .minecraft\XaeroWaypoints\<world>\dim%0\   overworld
  .minecraft\XaeroWaypoints\<world>\dim%-1\  nether
  .minecraft\XaeroWaypoints\<world>\dim%1\   end
```

---

## 12. Total time estimate

| Milestone | Cumulative |
|---|---|
| v0.3 (browser app, fully usable) | ~11 hrs |
| v1.0 (real exe, hotkey, portable) | ~19 hrs |
| v1.1 (Xaero sync, distance tools) | ~24 hrs |
| v1.2 (all reference tabs) | ~32 hrs |

**Ship v0.3 first. Use it for a week. Then decide if you still want the rest.**
