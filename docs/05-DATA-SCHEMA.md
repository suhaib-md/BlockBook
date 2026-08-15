# 05 — Data Schema

**Product:** BlockBook · **Schema version:** 1 · **Date:** 2026-08-14

> **This document is a live contract.** If the code and this document disagree, one of
> them is a bug. Fix it the same day. Change a field here in the same commit that
> changes it in code.

---

## 1. Storage overview

| Version | Backend | Path |
|---|---|---|
| v0.x | `localStorage` key `blockbook.data` | Browser profile |
| v1.0+ | `data.json` | `<exe dir>\data.json`, fallback `%APPDATA%\BlockBook\data.json` |

The serialised form is identical in both. Moving from localStorage to a file is a
transport change, not a schema change.

**Encoding:** UTF-8, no BOM. **Formatting:** pretty-printed with 2-space indent — the
file must be readable and editable by hand (principle P2 in [02-TRD](02-TRD.md)).

---

## 2. Root document

```json
{
  "schemaVersion": 1,
  "app": "blockbook",
  "worlds": [ /* World[] */ ],
  "settings": { /* Settings */ }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | integer | ✅ | Currently `1`. Bump on any breaking change. Drives migration. |
| `app` | string | ✅ | Always `"blockbook"`. Guards against importing an unrelated JSON file. |
| `worlds` | `World[]` | ✅ | v1.0 uses exactly one. The array exists so multi-world in v1.2 is not a migration. |
| `settings` | `Settings` | ✅ | Application-level preferences. |

**Do not add top-level fields.** Anything world-specific belongs in `World`;
anything user-specific belongs in `Settings`. A flat sprawl at the root is how
schemas rot.

---

## 3. World

```json
{
  "id": "w_main",
  "name": "Survival World",
  "edition": "java",
  "gameVersion": "1.21",
  "seed": null,
  "createdAt": "2026-08-14T00:00:00Z",
  "locations": [ /* Location[] */ ]
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | string | ✅ | `"w_main"` | Stable, never reused. |
| `name` | string | ✅ | `"Survival World"` | Display name. |
| `edition` | `"java"` \| `"bedrock"` | ✅ | `"java"` | Bedrock is unsupported in v1.0 but the field is reserved — the two editions differ in Y ranges and portal behaviour. |
| `gameVersion` | string | ✅ | `"1.21"` | Free-form. Used to warn when brewing data may not match. |
| `seed` | string \| null | — | `null` | String, not number — Java seeds exceed `Number.MAX_SAFE_INTEGER`. |
| `createdAt` | ISO 8601 UTC | ✅ | now | |
| `locations` | `Location[]` | ✅ | `[]` | |

> **`seed` is a string.** A Java world seed is a signed 64-bit integer. Parsing one as
> a JS number silently corrupts it. This has bitten every Minecraft tool ever written.

---

## 4. Location — the core record

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

| Field | Type | Required | Default | Rules |
|---|---|---|---|---|
| `id` | string | ✅ | generated | `crypto.randomUUID()` or `loc_NNN`. **Never reused, never renumbered** — `linkedPortalId` points at it. |
| `name` | string | ✅ | — | 1–80 chars. Trimmed. Empty is a hard validation failure. |
| `dimension` | enum | ✅ | **none** | `"overworld"` \| `"nether"` \| `"end"`. **Never optional, never defaulted.** See §4.1. |
| `x` | integer | ✅ | — | −30,000,000 … 30,000,000. Floor any decimal input. |
| `y` | integer \| null | ✅ | — | `null` means "surface, don't care". Range depends on dimension — see §4.2. |
| `z` | integer | ✅ | — | Same range as `x`. |
| `type` | enum | ✅ | `"misc"` | 15 values, §4.3. Drives icon and default colour. |
| `tags` | string[] | ✅ | `[]` | Lowercase, trimmed, deduplicated. No commas inside a tag. |
| `notes` | string | ✅ | `""` | Free text. Searchable. No length limit in practice. |
| `linkedPortalId` | string \| null | ✅ | `null` | Only meaningful when `type == "portal"`. §4.4. |
| `favorite` | boolean | ✅ | `false` | Pins to the top of the list. US spelling — matches the code. |
| `createdAt` | ISO 8601 UTC | ✅ | now | Never modified after creation. |
| `updatedAt` | ISO 8601 UTC | ✅ | now | Touched on every mutation. Drives "recently updated" sort. |

Required fields are always **present in the JSON**, using their default value where
the user supplied nothing. No optional-key handling, no `undefined` checks scattered
through the code. `null` means "deliberately unknown"; a missing key means the file
is malformed.

### 4.1 `dimension` — why it is mandatory

```
"overworld" | "nether" | "end"
```

Every ambiguity in the original Notepad data traces to this one absent field.
`-495 / 66 / -394` is unanswerable without it — it is either a real place or a place
8× further away.

**Enforcement:**
- No default in the Add form. Save disabled until chosen.
- The import review screen blocks on any row with an unset dimension.
- A loaded record missing `dimension` is quarantined, not guessed.

### 4.2 `y` validation ranges

| Dimension | Min | Max | Note |
|---|---|---|---|
| `overworld` | −64 | 320 | Build limit since 1.18 |
| `nether` | 0 | 127 | Roof bedrock at 127 |
| `end` | 0 | 255 | |

Out-of-range is a **soft warning**, not a hard block. The player may be recording
something the validator does not know about. `null` is always valid.

### 4.3 `type` enum

| Value | Icon | Meaning |
|---|---|---|
| `base` | 🏠 | Player-built home or outpost |
| `portal` | 🌀 | Nether portal — **unlocks all portal logic** |
| `spawner` | 💀 | Monster spawner block |
| `structure` | 🏛 | Generated structure, unclassified |
| `biome` | 🌳 | A notable biome location |
| `mine` | ⛏ | Mine, branch mine, ore vein |
| `farm` | 🌾 | Player-built farm |
| `village` | 🏘 | |
| `stronghold` | 🏰 | End portal room |
| `fortress` | 🔥 | Nether fortress |
| `bastion` | 🐷 | Bastion remnant |
| `monument` | 🔱 | Ocean monument |
| `shipwreck` | 🚢 | |
| `trial_chamber` | ⚔ | 1.21 structure |
| `misc` | 📍 | Default. Anything else. |

Adding a value is a **non-breaking** change: append to the enum, add an icon, done.
Removing or renaming one requires a migration.

### 4.4 `linkedPortalId` — the pairing rule

Points at the `id` of the portal in the **other** dimension that this portal pairs with.

**Invariants — enforce all four:**

| # | Invariant | On violation |
|---|---|---|
| I1 | Set only when `type == "portal"` | Clear the field |
| I2 | The target must exist | Clear the field, log a warning |
| I3 | The target must have `type == "portal"` | Clear the field |
| I4 | The target must be in a **different** dimension | Reject the link at the UI level |

**Symmetry:** the link is conceptually mutual. Setting A→B must also set B→A. On load,
a one-sided link is repaired by writing the reverse side; the UI must never create one.

**End dimension:** the End has no portal scaling. A location with `dimension: "end"`
and `type: "portal"` may exist (an end portal / gateway) but must never carry a
`linkedPortalId`, and it is excluded from all conversion and conflict math.

---

## 5. Settings

```json
{
  "activeWorldId": "w_main",
  "coordFormat": "x / y / z",
  "alwaysOnTop": true,
  "hotkey": "CmdOrCtrl+Shift+B",
  "theme": "dark"
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `activeWorldId` | string | `"w_main"` | Must match a `World.id`. Falls back to `worlds[0]` if stale. |
| `coordFormat` | string | `"x / y / z"` | Also `"x, y, z"` and `"x y z"`. Display only — storage is always three integers. |
| `alwaysOnTop` | boolean | `true` | Tauri only; ignored in the browser. |
| `hotkey` | string | `"CmdOrCtrl+Shift+B"` | Tauri global-shortcut syntax. Tauri only. |
| `theme` | `"dark"` \| `"light"` | `"dark"` | |

UI state — search text, active filters, sort order, the active tab — is **never**
persisted. It lives in `state.ui` and dies with the session. Restoring a stale filter
on launch would silently hide locations, which is worse than any convenience it buys.

---

## 6. Reference data files

Reference data ships **separately** from user data. It is read-only, versioned with
the app, and never written to `data.json`. Full content spec in
[08-REFERENCE-DATA](08-REFERENCE-DATA.md).

```
data/
  brewing.json        Phase 6
  enchantments.json   Phase 12
  mobs.json           Phase 12
  fuel.json           Phase 12
```

Every reference file carries the same envelope:

```json
{
  "schemaVersion": 1,
  "dataset": "brewing",
  "gameVersion": "1.21",
  "verified": false,
  "source": "minecraft.wiki, hand-entered",
  "entries": [ /* dataset-specific */ ]
}
```

`verified: false` makes the UI show an unobtrusive "unverified for your game version"
hint. Flip it to `true` only after checking the values against the wiki for the exact
version in `World.gameVersion`.

---

## 7. Validation rules — consolidated

Implement as one `validateLocation(loc) → { errors[], warnings[] }`. Errors block the
save; warnings do not.

### Errors (block)

| # | Rule | Message |
|---|---|---|
| E1 | `name` non-empty after trim | "Name is required." |
| E2 | `dimension` is one of the three | "Choose a dimension." |
| E3 | `x`, `z` are integers | "X and Z must be whole numbers." |
| E4 | `y` is an integer or `null` | "Y must be a whole number, or left blank." |
| E5 | `x`, `z` within ±30,000,000 | "Coordinate outside the world border." |
| E6 | `type` is in the enum | "Unknown location type." |
| E7 | `linkedPortalId` target exists and is a portal in another dimension | "That portal cannot be linked." |

### Warnings (allow)

| # | Rule | Message |
|---|---|---|
| W1 | `y` within the dimension's range | "Y {v} is outside the {dim} range ({min}–{max})." |
| W2 | No portal conflict within 128 blocks | "Will likely link to **{name}** ({d} blocks away)." |
| W3 | `type == "portal"` and `linkedPortalId == null` | "No partner portal recorded." |
| W4 | Link health ≤ 128 blocks | "This pair is {d} blocks apart — another portal could steal the link." |
| W5 | Name is not already used | "Another location is also called '{name}'." |
| W6 | `type` matches the dimension's plausibility | "A fortress in the Overworld is unusual." |

W6 is advisory only. Fortresses in the Overworld do not exist, but the player might
be recording something in a modded or unusual context.

---

## 8. Migration policy

```js
const CURRENT_SCHEMA = 1;

const migrations = [
  // index 0 → migrates v1 to v2, when v2 exists
];
```

**On load:**

| Condition | Action |
|---|---|
| `schemaVersion` absent | Treat as `1` |
| `schemaVersion === CURRENT` | Load directly |
| `schemaVersion < CURRENT` | Back up the file, run migrations in order, save, notify |
| `schemaVersion > CURRENT` | **Refuse.** Show both version numbers. Never downgrade. |

**Rules:**
1. Migrations are pure `(data) => data`. No I/O, no side effects.
2. **Never edit a shipped migration.** Append a new one.
3. Always back up before migrating. The backup filename records the old version:
   `backups/data-v1-YYYYMMDD-HHMMSS.json`.
4. Every migration needs a test fixture in `docs/fixtures/` before it ships.

### Changes that require a version bump

| Change | Bump? |
|---|---|
| Add an optional field with a default | ❌ No |
| Add a `type` enum value | ❌ No |
| Add a settings key | ❌ No |
| Rename any field | ✅ Yes |
| Remove a field | ✅ Yes |
| Change a field's type | ✅ Yes |
| Change the meaning of an existing value | ✅ Yes |
| Remove or rename an enum value | ✅ Yes |

---

## 9. Complete worked example

A minimal but fully valid `data.json` with one linked portal pair:

```json
{
  "schemaVersion": 1,
  "app": "blockbook",
  "worlds": [
    {
      "id": "w_main",
      "name": "Survival World",
      "edition": "java",
      "gameVersion": "1.21",
      "seed": null,
      "createdAt": "2026-08-14T00:00:00Z",
      "locations": [
        {
          "id": "loc_013",
          "name": "Trial Chamber Portal (Overworld)",
          "dimension": "overworld",
          "x": 2217, "y": -5, "z": -4024,
          "type": "portal",
          "tags": ["trial"],
          "notes": "Scales to nether 277 / -503.",
          "linkedPortalId": "loc_014",
          "favorite": false,
          "createdAt": "2026-08-14T00:00:00Z",
          "updatedAt": "2026-08-14T00:00:00Z"
        },
        {
          "id": "loc_014",
          "name": "Fortress Portal (Nether)",
          "dimension": "nether",
          "x": 276, "y": 45, "z": -507,
          "type": "portal",
          "tags": ["fortress"],
          "notes": "Only 4 blocks off target — tightly linked. VERIFIED GOOD PAIR.",
          "linkedPortalId": "loc_013",
          "favorite": false,
          "createdAt": "2026-08-14T00:00:00Z",
          "updatedAt": "2026-08-14T00:00:00Z"
        }
      ]
    }
  ],
  "settings": {
    "activeWorldId": "w_main",
    "coordFormat": "x / y / z",
    "alwaysOnTop": true,
    "hotkey": "CmdOrCtrl+Shift+B",
    "theme": "dark"
  }
}
```

Note the symmetric `linkedPortalId` on both records. That is the required shape.

---

## 10. JSDoc contract

Paste this at the top of the script in Phase 1 and keep it accurate. It is the
in-code copy of this document.

```js
/**
 * @typedef {"overworld"|"nether"|"end"} Dimension
 *
 * @typedef {"base"|"portal"|"spawner"|"structure"|"biome"|"mine"|"farm"
 *          |"village"|"stronghold"|"fortress"|"bastion"|"monument"
 *          |"shipwreck"|"trial_chamber"|"misc"} LocationType
 *
 * @typedef {Object} Location
 * @property {string}       id              Stable, never reused
 * @property {string}       name            1-80 chars, required
 * @property {Dimension}    dimension       REQUIRED, never defaulted
 * @property {number}       x               Integer
 * @property {number|null}  y               Integer, or null for "don't care"
 * @property {number}       z               Integer
 * @property {LocationType} type            Defaults to "misc"
 * @property {string[]}     tags            Lowercase, deduped
 * @property {string}       notes           Free text, searchable
 * @property {string|null}  linkedPortalId  Portal pairing; symmetric
 * @property {boolean}      favorite
 * @property {string}       createdAt       ISO 8601 UTC
 * @property {string}       updatedAt       ISO 8601 UTC
 *
 * @typedef {Object} World
 * @property {string}     id
 * @property {string}     name
 * @property {"java"|"bedrock"} edition
 * @property {string}     gameVersion
 * @property {string|null} seed            STRING - 64-bit, do not parse as number
 * @property {string}     createdAt
 * @property {Location[]} locations
 *
 * @typedef {Object} Settings
 * @property {string}  activeWorldId
 * @property {string}  coordFormat
 * @property {boolean} alwaysOnTop
 * @property {string}  hotkey
 * @property {"dark"|"light"} theme
 *
 * @typedef {Object} BlockBookData
 * @property {number}   schemaVersion
 * @property {"blockbook"} app
 * @property {World[]}  worlds
 * @property {Settings} settings
 */
```
