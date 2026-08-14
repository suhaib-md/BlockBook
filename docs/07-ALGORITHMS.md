# 07 — Algorithms

**Product:** BlockBook · **Version:** 1.0 · **Date:** 2026-08-14

> **Live contract.** Every worked example here is a test case in
> [09-TESTING-QA](09-TESTING-QA.md). If the code disagrees with this document, one of
> them is wrong — resolve it the same day.

---

## 1. Corrections to the source plan

Three numbers in [BUILD_PLAN.md](../BUILD_PLAN.md) do not survive recomputation. They
are corrected throughout this document. Recorded here so the discrepancy is not
mistaken for a bug later.

| Claim in BUILD_PLAN | Correct value | Cause |
|---|---|---|
| Bastion Portal `688 / -1926` scales to nether `86 / -240` | **`86 / -241`** | `-1926 / 8 = -240.75`. `Math.floor` → `-241`. The plan used truncation. This is exactly the pitfall in §2.2. |
| Home `221 / 374` is `14.5` blocks from Home Portal | **`13.60`** | `hypot(27−16, 46−38) = hypot(11, 8) = √185 = 13.60` |
| Trial ↔ Fortress is a tight pair (`4.1` blocks) | **`4.12` one way, `33.24` the other** | Correct, but only for the overworld→nether direction. Portal linking is asymmetric — see §4. |
| "all 14 locations" in the seed | **15 locations** | The seed array in BUILD_PLAN §4 has 15 entries. Counted, not estimated. All gates and checklists in these docs use 15. |

The `631 / 245` conflict finding — the plan's headline example — **is** correct:
62.5 blocks, well inside the link radius.

---

## 2. Nether ↔ Overworld conversion

### 2.1 The rule

Horizontal coordinates scale 8:1. **Y is never scaled.** One block travelled in the
Nether covers eight Overworld blocks on the X and Z axes. Y has no relationship
between dimensions at all.

```js
/** Overworld → Nether. Note: no Y in the signature, by design. */
const toNether = (x, z) => ({ x: Math.floor(x / 8), z: Math.floor(z / 8) });

/** Nether → Overworld. */
const toOverworld = (x, z) => ({ x: x * 8, z: z * 8 });
```

**Y is structurally absent from both signatures.** It cannot be passed in, so it
cannot be scaled by accident. This is deliberate API design, not an omission —
see [02-TRD §6.3](02-TRD.md).

The End has no scaling relationship with anything. Any location with
`dimension: "end"` is excluded from every function in this document except §5.

### 2.2 `Math.floor`, never `Math.trunc` ⚠

The single most common bug in this class of tool.

| Input | `Math.floor(x/8)` ✅ | `Math.trunc(x/8)` ❌ | `x/8 \| 0` ❌ |
|---|---|---|---|
| `2217` | `277` | `277` | `277` |
| `-4024` | `-503` | `-503` | `-503` |
| `-1926` | **`-241`** | `-240` | `-240` |
| `-495` | **`-62`** | `-61` | `-61` |
| `-1` | **`-1`** | `0` | `0` |

For positive coordinates all three agree, which is why the bug survives casual
testing. For negative coordinates truncation rounds *toward zero* and produces an
off-by-one that matches the game only by coincidence. Minecraft's portal target uses
floor semantics.

Test with a negative coordinate, always.

### 2.3 Worked examples

| From | Direction | Result |
|---|---|---|
| Overworld `2217 / -4024` | → Nether | `277 / -503` |
| Overworld `631 / 245` | → Nether | `78 / 30` |
| Overworld `221 / 374` | → Nether | `27 / 46` |
| Overworld `688 / -1926` | → Nether | `86 / -241` ⚠ |
| Nether `16 / 38` | → Overworld | `128 / 304` |
| Nether `276 / -507` | → Overworld | `2208 / -4056` |
| Nether `-495 / -394` | → Overworld | `-3960 / -3152` |

---

## 3. Portal link conflict detection ⭐

### 3.1 The game mechanic

When you enter a portal, the game computes a target position in the destination
dimension by scaling, then searches for an **existing** portal within **128 blocks
horizontally of that target, measured in destination-dimension blocks**. If it finds
one, it sends you there instead of creating a new portal. Nearest wins.

**This search radius is asymmetric in effect**, and understanding why is the key to
the whole feature:

| Direction | Search radius | Equivalent coverage in the *source* dimension |
|---|---|---|
| Overworld → Nether | 128 nether blocks | **1024** overworld blocks |
| Nether → Overworld | 128 overworld blocks | **16** nether blocks |

An Overworld portal therefore casts a very wide net — anything within 1024 Overworld
blocks of another portal's Overworld position is at risk of colliding. A Nether portal
has a much tighter window. This asymmetry is exactly why nether hubs work, and why
Overworld portals built "a few hundred blocks apart" silently merge.

### 3.2 Implementation

```js
const LINK_RADIUS = 128;   // blocks, horizontal, in the DESTINATION dimension

const horizontalDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Existing portals that would hijack the link for a proposed new portal.
 * @param {{dimension:string, x:number, z:number, id?:string}} candidate
 * @param {Location[]} all
 * @returns {{location: Location, distance: number}[]} nearest first
 */
function findLinkConflicts(candidate, all) {
  if (candidate.dimension === "end") return [];        // no scaling in the End

  const destDim = candidate.dimension === "overworld" ? "nether" : "overworld";

  const target = candidate.dimension === "overworld"
    ? toNether(candidate.x, candidate.z)
    : toOverworld(candidate.x, candidate.z);

  return all
    .filter(l => l.type === "portal"
              && l.dimension === destDim
              && l.id !== candidate.id)              // never conflict with itself
    .map(l => ({ location: l, distance: horizontalDistance(target, l) }))
    .filter(r => r.distance <= LINK_RADIUS)
    .sort((a, b) => a.distance - b.distance);
}
```

**Three details that matter:**
1. `l.id !== candidate.id` — without it, editing an existing portal reports the portal
   conflicting with itself.
2. The `end` guard — End coordinates have no counterpart, and converting them produces
   confident nonsense.
3. Sorted nearest-first — the UI names only the nearest, because that is the one you
   will actually arrive at.

### 3.3 UI contract

| Result | Colour | Message |
|---|---|---|
| 0 conflicts | `--ok` green | "Will create a new portal at ~`{target.x} / {target.z}`." |
| 1+ conflicts | `--warn` amber | "⚠ Will likely link to **{nearest.name}** ({d} blocks away). Build further out, or accept the link." |

**Never blocking.** The player may be deliberately building a hub. Warn, name the
portal, give the distance, and let them save.

### 3.4 Worked example — the flagship test case

A portal at Overworld `631 / 67 / 245`:

```
target = toNether(631, 245)
       = { x: floor(631/8), z: floor(245/8) }
       = { x: floor(78.875), z: floor(30.625) }
       = { x: 78, z: 30 }

Nether portals in the dataset:
  Home Portal (Nether side)   16 / 38   → hypot(78−16, 30−38)
                                        = hypot(62, −8) = √3908 = 62.51  ≤ 128  ⚠
  Fortress Portal (Nether)   276 / −507 → hypot(−198, 537) = 572.3       > 128  ok
  Portal @ −495/−394        −495 / −394 → hypot(573, 424)  = 712.9       > 128  ok

Result: 1 conflict.
  ⚠ "Will likely link to Home Portal (Nether side), 62.5 blocks away."
```

**This is the app's correctness gate.** The answer is already known from the real
world, independently of the code. If Phase 4 does not produce it, the maths is wrong.

### 3.5 Worked example — no conflict

A portal at Overworld `688 / 69 / -1926` (the Bastion portal):

```
target = toNether(688, −1926) = { 86, −241 }        ← floor, not trunc

  Home Portal      16 / 38    → hypot(70, −279) = 287.7   > 128
  Fortress Portal 276 / −507  → hypot(−190, 266) = 326.9  > 128
  Portal @ −495   −495 / −394 → hypot(581, 153) = 600.8   > 128

Result: 0 conflicts.
  ✅ "Will create a new portal at ~86 / −241."
```

Note that using `Math.trunc` here gives `−240` and shifts every distance by ~1 block.
It does not change this verdict, which is precisely why the bug hides.

---

## 4. Link health for existing pairs

### 4.1 Why it is bidirectional

A pair `A ↔ B` is only truly connected if **both** traversals land on the intended
portal. Because the search radius is measured in destination-dimension blocks (§3.1),
the two directions have genuinely different tolerances — and the source plan's
single-number health check hides that.

```js
/**
 * @returns {{ forward:number, backward:number, worst:number,
 *             status:"tight"|"loose"|"broken" }}
 */
function linkHealth(a, b) {
  const ow = a.dimension === "overworld" ? a : b;
  const ne = a.dimension === "overworld" ? b : a;

  // Overworld → Nether: distance measured in NETHER blocks
  const forward  = horizontalDistance(toNether(ow.x, ow.z), ne);

  // Nether → Overworld: distance measured in OVERWORLD blocks
  const backward = horizontalDistance(toOverworld(ne.x, ne.z), ow);

  const worst = Math.max(forward, backward);
  const status = worst <= 16 ? "tight" : worst <= 128 ? "loose" : "broken";
  return { forward, backward, worst, status };
}
```

**Report the worse direction.** A pair that works one way and not the other is broken
in the way that matters: you walk through and cannot get back.

### 4.2 Badge thresholds

| Worst distance | Badge | Meaning |
|---|---|---|
| ≤ 16 | ✅ **Tight** | Reliably paired in both directions. |
| 17 – 128 | 🟡 **Loose** | Both directions link, but another portal built nearby could steal it. |
| > 128 | ❌ **Broken** | At least one direction does **not** reach the partner. |

`❌ Broken` must be surfaced beyond the card — a persistent count in the status bar
and the Portals tab header. A pair the player *believes* is connected but is not is
the exact failure this app exists to catch.

### 4.3 Worked example — Trial Chamber ↔ Fortress

```
ow = Trial Chamber Portal   2217 / −4024
ne = Fortress Portal         276 / −507

forward  (OW→NE, nether blocks):
    toNether(2217, −4024) = { 277, −503 }
    hypot(277−276, −503−(−507)) = hypot(1, 4) = √17 = 4.12     ≤ 16  ✅

backward (NE→OW, overworld blocks):
    toOverworld(276, −507) = { 2208, −4056 }
    hypot(2208−2217, −4056−(−4024)) = hypot(−9, −32) = √1105 = 33.24  ≤ 128  🟡

worst = 33.24  →  status = "loose"
```

**The pair works in both directions**, so it is a good pair in practice — the source
plan's "VERIFIED GOOD PAIR" holds. But the honest badge is 🟡 **Loose**, not ✅ Tight:
a new Overworld portal built within 128 blocks of `2208 / -4056` would steal the
return trip. This is real, actionable information the single-direction check throws away.

### 4.4 Worked example — Home

The Overworld-side portal at Home is **not recorded** in the seed data. Treating the
Home base position as a proxy for it:

```
Home (base)                 221 / 374
Home Portal (Nether side)    16 / 38

forward:  toNether(221, 374) = { 27, 46 }
          hypot(27−16, 46−38) = hypot(11, 8) = √185 = 13.60   ≤ 16   ✅

backward: toOverworld(16, 38) = { 128, 304 }
          hypot(128−221, 304−374) = hypot(−93, −70) = √13549 = 116.40  ≤ 128  🟡

worst = 116.40  →  "loose"
```

Two things follow:
- The plan's "14.5 blocks" is the forward figure and is arithmetically `13.60`.
- The pairing is looser than it looks. **The actual Overworld portal at Home should be
  recorded as its own `type: "portal"` location** — see [01-PRD §8 Q7](01-PRD.md).
  Until then this figure measures the base, not the portal.

---

## 5. Distance and "nearest to"

### 5.1 Same-dimension 3D distance

```js
const dist3 = (a, b) =>
  Math.hypot(a.x - b.x, (a.y ?? 64) - (b.y ?? 64), a.z - b.z);
```

`y ?? 64` substitutes a plausible surface level for records with an unknown Y. It is a
heuristic and only affects ranking, never portal logic.

### 5.2 Cross-dimension distance

Normalise everything to Overworld scale before comparing. The End is never comparable.

```js
function normalised(loc) {
  if (loc.dimension === "nether") {
    const { x, z } = toOverworld(loc.x, loc.z);
    return { ...loc, x, z };
  }
  return loc;   // overworld unchanged; "end" must be filtered out by the caller
}

function nearestTo(point, all, { limit = 5, sameDimensionOnly = false } = {}) {
  const p = normalised(point);
  return all
    .filter(l => l.id !== point.id && l.dimension !== "end")
    .filter(l => !sameDimensionOnly || l.dimension === point.dimension)
    .map(l => ({ location: l, distance: dist3(p, normalised(l)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}
```

**Label cross-dimension results as approximate.** A Nether location 100 Overworld-
equivalent blocks away is only reachable if a portal pair actually connects there.
Displaying it as a plain distance implies a walkability that does not exist.

---

## 6. Notepad importer

### 6.1 Parsing

```js
// Three integers separated by "/" or whitespace. Global — a line may hold several.
const COORD = /(-?\d+)\s*[\/ ]\s*(-?\d+)\s*[\/ ]\s*(-?\d+)/g;

function parseLine(line) {
  const coords = [...line.matchAll(COORD)]
    .map(m => ({ x: +m[1], y: +m[2], z: +m[3] }));

  const label = line
    .replace(COORD, "")
    .replace(/[-\/]{2,}/g, " ")     // strip "----" separators
    .replace(/\s+/g, " ")
    .trim();

  return { coords, label, raw: line };
}
```

### 6.2 Row generation rules

| Coords on the line | Produces |
|---|---|
| 0 | Nothing. Line goes to a "not recognised" list, shown but not imported. |
| 1 | One candidate row. `name = label`, or `"(unnamed)"`. |
| 2+ | **N separate candidate rows.** They share the label, suffixed `(1)`, `(2)`, … |

> **Two coordinates on one line are never assumed to be a pair.** The original notes
> contain the exact trap: `631/67/245` and `-495/66/-394` sat on one line separated by
> `----` and are demonstrably *not* a pair — `631 / 8 = 78`, not `-495`. If both labels
> mention "portal", the importer may *offer* to link them, but only after running
> `findLinkConflicts` to confirm the pair is geometrically real, and only as a
> checkbox the user ticks.

### 6.3 Dimension heuristic

The heuristic exists to save typing, never to decide. Its output is always marked as
a guess and always overridable.

```js
function guessDimension({ y, label }) {
  const l = label.toLowerCase();
  if (/\bnether|fortress|bastion|wart|blaze|soul\b/.test(l)) return { d: "nether",    confident: false };
  if (/\bend\b|ender|stronghold|dragon/.test(l))             return { d: "end",       confident: false };
  if (y != null && (y < 0 || y > 127))                       return { d: "overworld", confident: true  };
  return { d: null, confident: false };   // genuinely unknowable — force a choice
}
```

Only one rule is confident: a Y outside `0–127` **cannot** be the Nether, since the
Nether is bedrock-capped at 127 and floored at 0. Everything else is a keyword guess.

Returning `null` is the correct answer far more often than it feels like it should be.
Do not reach for a default.

### 6.4 The review screen is mandatory

Per [10-DECISIONS ADR-007](10-DECISIONS-AND-RISKS.md):

- No code path commits an import without the review table.
- Guessed dimensions are visually flagged until the user touches them.
- `[Import]` stays disabled while any checked row has an unset dimension.
- Import **appends**; it never replaces.
- A backup is written before the append.

A silent bad import produces confidently wrong coordinates, which is strictly worse
than no import at all — the player will trust them and walk 2000 blocks the wrong way.

### 6.5 Worked example

Input:

```
Home - 221/65/374
Portal 631/67/245 ---- -495/66/-394
2411 22 -326
spider spawner 91/-13/200
```

Parsed:

| # | Label | Coords | Guess | Confident? |
|---|---|---|---|---|
| 1 | `Home` | `221 / 65 / 374` | — | ❌ forces a choice |
| 2 | `Portal (1)` | `631 / 67 / 245` | — | ❌ |
| 3 | `Portal (2)` | `-495 / 66 / -394` | — | ❌ |
| 4 | `(unnamed)` | `2411 / 22 / -326` | — | ❌ |
| 5 | `spider spawner` | `91 / -13 / 200` | `overworld` | ✅ Y < 0 |

Rows 2 and 3 are two independent portals, correctly separated. Row 4 is unchecked by
default because it has no name. Only row 5 gets a confident guess.

---

## 7. Search and sort

### 7.1 Search

```js
function searchLocations(all, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return all;

  return all
    .map(l => {
      const name  = l.name.toLowerCase();
      const tags  = l.tags.join(" ").toLowerCase();
      const notes = l.notes.toLowerCase();

      let score = 0;
      if (name === needle)            score = 100;
      else if (name.startsWith(needle)) score = 80;
      else if (name.includes(needle))   score = 60;
      else if (tags.includes(needle))   score = 40;
      else if (notes.includes(needle))  score = 20;

      return { l, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || a.l.name.localeCompare(b.l.name))
    .map(r => r.l);
}
```

Notes are searched last but they **must** be searched — the ocean monument in the seed
data is findable only through a note.

### 7.2 Sort

```js
const sorters = {
  name:    (a, b) => a.name.localeCompare(b.name),
  type:    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
};

// Favourites always float, regardless of the chosen sort.
const withFavourites = (list, key) =>
  [...list].sort((a, b) =>
    (b.favorite - a.favorite) || sorters[key](a, b));
```

ISO 8601 UTC strings sort lexicographically in chronological order — no `Date` parsing
needed, and no timezone hazard.

---

## 8. Complexity budget

| Operation | Complexity | n = 500 | Verdict |
|---|---|---|---|
| Search | O(n) | ~0.1 ms | Fine |
| Sort | O(n log n) | ~0.3 ms | Fine |
| `findLinkConflicts` | O(p), p = portal count | < 0.05 ms | Fine |
| Link health, all pairs | O(p) | < 0.05 ms | Fine |
| `nearestTo` | O(n log n) | ~0.3 ms | Fine |
| Full `render()` | O(n) DOM nodes | ~20–40 ms | Fine |

Nothing here needs indexing, memoisation, or virtualisation at the realistic data size
of a single survival world (tens to low hundreds of locations). **Do not optimise
before measuring.** If `render()` ever exceeds 100 ms, virtualise the list then — and
only then.
