/* ==========================================================================
   BlockBook — schema.js
   The data model: enums, ranges, normalisation, link invariants.
   Pure. docs/05-DATA-SCHEMA.md
   ========================================================================== */

const SCHEMA_VERSION = 1;

/** The 13 fields every Location carries. Order is the schema's order. */
const LOCATION_FIELDS = [
  "id", "name", "dimension", "x", "y", "z", "type",
  "tags", "notes", "linkedPortalId", "favorite", "createdAt", "updatedAt"
];

/** @type {Dimension[]} */
const DIMENSIONS = ["overworld", "nether", "end"];

/** @type {LocationType[]} */
const LOCATION_TYPES = [
  "base", "portal", "spawner", "structure", "biome", "mine", "farm",
  "village", "stronghold", "fortress", "bastion", "monument",
  "shipwreck", "trial_chamber", "misc"
];

/** Y validation ranges, inclusive. docs/05-DATA-SCHEMA.md §4.2 */
const Y_RANGES = {
  overworld: [-64, 320],
  nether:    [0, 127],
  end:       [0, 255],
};

const DEFAULT_SETTINGS = {
  activeWorldId: "w_main",
  coordFormat:   "x / y / z",
  alwaysOnTop:   true,
  hotkey:        "Ctrl+Space",
  theme:         "dark",
};

/** Normalise tags: lowercase, trimmed, deduped, empties dropped. */
function normaliseTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  for (const t of tags) {
    const v = String(t).trim().toLowerCase();
    if (v) seen.add(v);
  }
  return [...seen];
}

/**
 * Expand a partial seed row into a complete Location with all 13 fields.
 * Every required field is written explicitly — a missing key means a malformed
 * file, so the app never has to probe for `undefined`. docs/05-DATA-SCHEMA.md §4
 *
 * `dimension` is deliberately NOT defaulted: an absent dimension is preserved as
 * undefined so validation catches it, rather than being silently guessed.
 */
function normaliseLocation(raw, i, now) {
  return {
    id:             raw.id ?? `loc_${String(i + 1).padStart(3, "0")}`,
    name:           String(raw.name ?? "").trim(),
    dimension:      raw.dimension,
    x:              Math.floor(Number(raw.x)),
    y:              raw.y == null ? null : Math.floor(Number(raw.y)),
    z:              Math.floor(Number(raw.z)),
    type:           LOCATION_TYPES.includes(raw.type) ? raw.type : "misc",
    tags:           normaliseTags(raw.tags),
    notes:          String(raw.notes ?? ""),
    linkedPortalId: raw.linkedPortalId ?? null,
    favorite:       Boolean(raw.favorite),
    createdAt:      raw.createdAt ?? now,
    updatedAt:      raw.updatedAt ?? now,
  };
}

/**
 * Enforce the four linkedPortalId invariants and make every link symmetric.
 * docs/05-DATA-SCHEMA.md §4.4
 *
 * I1 set only when type === "portal"
 * I2 the target must exist
 * I3 the target must also be a portal
 * I4 the target must be in a DIFFERENT dimension
 * plus: a one-sided link is repaired by writing the reverse side.
 *
 * @returns {string[]} human-readable repairs made, for logging
 */
function repairPortalLinks(locations) {
  const byId = new Map(locations.map(l => [l.id, l]));
  const repairs = [];

  for (const loc of locations) {
    if (loc.linkedPortalId == null) continue;

    const drop = (why) => {
      repairs.push(`cleared link on "${loc.name}" — ${why}`);
      loc.linkedPortalId = null;
    };

    if (loc.type !== "portal")        { drop("I1: not a portal"); continue; }
    const target = byId.get(loc.linkedPortalId);
    if (!target)                      { drop("I2: target does not exist"); continue; }
    if (target.type !== "portal")     { drop("I3: target is not a portal"); continue; }
    if (target.dimension === loc.dimension) { drop("I4: target is in the same dimension"); continue; }

    // End portals never participate in pairing — no scaling relationship exists.
    if (loc.dimension === "end" || target.dimension === "end") {
      drop("End portals cannot be paired");
      continue;
    }
  }

  // Second pass: repair one-sided links now that invalid ones are gone.
  for (const loc of locations) {
    if (loc.linkedPortalId == null) continue;
    const target = byId.get(loc.linkedPortalId);
    if (target && target.linkedPortalId !== loc.id) {
      repairs.push(`made link symmetric: "${target.name}" → "${loc.name}"`);
      target.linkedPortalId = loc.id;
    }
  }

  return repairs;
}

/**
 * Build the full root document from a bare array of seed rows.
 * @param {Partial<Location>[]} seedLocations
 * @returns {{ data: BlockBookData, repairs: string[] }}
 */
function buildInitialData(seedLocations, now = new Date().toISOString()) {
  const locations = seedLocations.map((raw, i) => normaliseLocation(raw, i, now));
  const repairs = repairPortalLinks(locations);

  return {
    data: {
      schemaVersion: SCHEMA_VERSION,
      app: "blockbook",
      worlds: [{
        id:          "w_main",
        name:        "Survival World",
        edition:     "java",
        gameVersion: "1.21",
        seed:        null,          // STRING or null — never a JS number
        createdAt:   now,
        locations,
      }],
      settings: { ...DEFAULT_SETTINGS },
    },
    repairs,
  };
}

/** World border, in blocks, on the X and Z axes. */
const WORLD_BORDER = 30000000;

/* --------------------------------------------------------------------------
   PORTAL MATHS — docs/07-ALGORITHMS.md §§2–4
   -------------------------------------------------------------------------- */

/**
 * Types that only plausibly exist in certain dimensions. Drives warning W6,
 * which is advisory only — the player may be recording something unusual.
 */
const TYPE_DIMENSIONS = {
  fortress:      ["nether"],
  bastion:       ["nether"],
  village:       ["overworld"],
  monument:      ["overworld"],
  shipwreck:     ["overworld"],
  stronghold:    ["overworld"],
  trial_chamber: ["overworld"],
};

export {
  SCHEMA_VERSION,
  LOCATION_FIELDS,
  DIMENSIONS,
  LOCATION_TYPES,
  Y_RANGES,
  DEFAULT_SETTINGS,
  normaliseTags,
  normaliseLocation,
  repairPortalLinks,
  buildInitialData,
  WORLD_BORDER,
  TYPE_DIMENSIONS,
};
