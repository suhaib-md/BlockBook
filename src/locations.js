/* ==========================================================================
   BlockBook — locations.js
   Validation, search, filter, sort, and the text importer.
   All pure. docs/05-DATA-SCHEMA.md §7, docs/07-ALGORITHMS.md §§6-7
   ========================================================================== */

import { DIMENSIONS, LOCATION_TYPES, SCHEMA_VERSION, TYPE_DIMENSIONS, WORLD_BORDER, Y_RANGES, normaliseTags } from "./schema.js";

/**
 * Validate a location. docs/05-DATA-SCHEMA.md §7
 * Errors block the save; warnings never do — the player may know something the
 * validator does not.
 *
 * W2 (portal link conflict) and W4 (pair health) need portal maths and arrive
 * in Phase 4; `extraWarnings` is where they get injected.
 *
 * @returns {{errors: {code,field,msg}[], warnings: {code,field,msg}[]}}
 */
function validateLocation(loc, all = [], extraWarnings = []) {
  const errors = [];
  const warnings = [];
  const others = all.filter(l => l.id !== loc.id);
  const name = String(loc.name ?? "").trim();

  // ---- errors ----
  if (!name) {
    errors.push({ code: "E1", field: "name", msg: "Name is required." });
  } else if (name.length > 80) {
    errors.push({ code: "E1", field: "name", msg: "Name must be 80 characters or fewer." });
  }

  if (!DIMENSIONS.includes(loc.dimension)) {
    errors.push({ code: "E2", field: "dimension", msg: "Choose a dimension." });
  }

  if (!Number.isInteger(loc.x) || !Number.isInteger(loc.z)) {
    errors.push({ code: "E3", field: "x", msg: "X and Z must be whole numbers." });
  }

  if (!(loc.y === null || Number.isInteger(loc.y))) {
    errors.push({ code: "E4", field: "y", msg: "Y must be a whole number, or left blank." });
  }

  if ((Number.isInteger(loc.x) && Math.abs(loc.x) > WORLD_BORDER) ||
      (Number.isInteger(loc.z) && Math.abs(loc.z) > WORLD_BORDER)) {
    errors.push({ code: "E5", field: "x", msg: "Coordinate outside the world border." });
  }

  if (!LOCATION_TYPES.includes(loc.type)) {
    errors.push({ code: "E6", field: "type", msg: "Unknown location type." });
  }

  if (loc.linkedPortalId != null) {
    const target = others.find(l => l.id === loc.linkedPortalId);
    const ok = loc.type === "portal"
            && target
            && target.type === "portal"
            && target.dimension !== loc.dimension
            && loc.dimension !== "end"
            && target.dimension !== "end";
    if (!ok) {
      errors.push({ code: "E7", field: "linkedPortalId", msg: "That portal cannot be linked." });
    }
  }

  // ---- warnings ----
  if (DIMENSIONS.includes(loc.dimension) && Number.isInteger(loc.y)) {
    const [min, max] = Y_RANGES[loc.dimension];
    if (loc.y < min || loc.y > max) {
      warnings.push({
        code: "W1", field: "y",
        msg: `Y ${loc.y} is outside the ${loc.dimension} range (${min} to ${max}).`,
      });
    }
  }

  if (loc.type === "portal" && loc.linkedPortalId == null && loc.dimension !== "end") {
    warnings.push({ code: "W3", field: "linkedPortalId", msg: "No partner portal recorded." });
  }

  if (name && others.some(l => l.name.trim().toLowerCase() === name.toLowerCase())) {
    warnings.push({ code: "W5", field: "name", msg: `Another location is also called “${name}”.` });
  }

  const allowed = TYPE_DIMENSIONS[loc.type];
  if (allowed && DIMENSIONS.includes(loc.dimension) && !allowed.includes(loc.dimension)) {
    warnings.push({
      code: "W6", field: "type",
      msg: `A ${loc.type.replace(/_/g, " ")} in the ${loc.dimension} is unusual.`,
    });
  }

  return { errors, warnings: [...warnings, ...extraWarnings] };
}

/**
 * Live search. docs/07-ALGORITHMS.md §7.1
 * Priority: exact name > name prefix > name substring > tags > notes.
 * Notes MUST be searched — the ocean monument in the seed data is findable
 * only through its note.
 */
function searchLocations(all, q) {
  const needle = String(q ?? "").trim().toLowerCase();
  if (!needle) return [...all];

  return all
    .map(l => {
      const name  = l.name.toLowerCase();
      const tags  = l.tags.join(" ").toLowerCase();
      const notes = l.notes.toLowerCase();

      let score = 0;
      if (name === needle)              score = 100;
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

/** Dimension + type filter chips. Both null means "no filter". */
function filterLocations(all, filters = {}) {
  return all.filter(l =>
    (!filters.dimension || l.dimension === filters.dimension) &&
    (!filters.type      || l.type      === filters.type));
}

/* --------------------------------------------------------------------------
   IMPORT / EXPORT — docs/07-ALGORITHMS.md §6
   -------------------------------------------------------------------------- */

/** Three integers separated by "/" or whitespace. Global: a line may hold several. */
const COORD = /(-?\d+)\s*[\/ ]\s*(-?\d+)\s*[\/ ]\s*(-?\d+)/g;

/**
 * Pull every coordinate triple off a line; whatever is left becomes the label.
 * `matchAll` clones the regex internally, so the shared /g literal carries no
 * lastIndex state between calls.
 */
function parseLine(line) {
  const coords = [...String(line).matchAll(COORD)]
    .map(m => ({ x: +m[1], y: +m[2], z: +m[3] }));

  const label = String(line)
    .replace(COORD, " ")
    .replace(/[-\/]{2,}/g, " ")            // "----" style separators
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:,.]+|[\s\-–—:,.]+$/g, "")   // dangling "Home - " punctuation
    .trim();

  return { coords, label, raw: String(line) };
}

/**
 * Guess a dimension from Y and the label. docs/07-ALGORITHMS.md §6.3
 *
 * Returning null is the correct answer far more often than it feels like it
 * should be. The guess is a typing shortcut, never a decision — the review
 * screen flags it and the user confirms every row.
 *
 * Deviation from the doc: the Y-range test runs FIRST. It is the only rule that
 * can be confident, because the Nether is bedrock-capped at 0..127 — a Y outside
 * that range makes "nether" impossible no matter what the label says.
 * The doc also wrote the keyword alternation without a group, so `\b` bound only
 * to the first and last alternatives; grouped here.
 */
function guessDimension({ y, label }) {
  const l = String(label ?? "").toLowerCase();

  if (y != null && Number.isFinite(y) && (y < 0 || y > 127)) {
    return { d: "overworld", confident: true };
  }
  if (/\b(nether|fortress|bastion|wart|blaze|soul|ghast|piglin)\b/.test(l)) {
    return { d: "nether", confident: false };
  }
  if (/\b(end|ender|stronghold|dragon|shulker|chorus)\b/.test(l)) {
    return { d: "end", confident: false };
  }
  return { d: null, confident: false };
}

/** A light type guess from the label. Always overridable in the review table. */
function guessType(label) {
  const l = String(label ?? "").toLowerCase();
  const rules = [
    [/\bportal\b/, "portal"], [/\bspawner\b/, "spawner"], [/\bfortress\b/, "fortress"],
    [/\bbastion\b/, "bastion"], [/\bmonument\b/, "monument"], [/\bshipwreck\b/, "shipwreck"],
    [/\bvillage\b/, "village"], [/\bstronghold\b/, "stronghold"], [/\btrial\b/, "trial_chamber"],
    [/\bbiome\b|\bjungle\b|\bdesert\b|\bforest\b/, "biome"], [/\bfarm\b/, "farm"],
    [/\bmine\b|\bcave\b/, "mine"], [/\bbase\b|\bhome\b/, "base"],
  ];
  for (const [re, t] of rules) if (re.test(l)) return t;
  return "misc";
}

/**
 * Turn pasted text into candidate rows for the review screen.
 *
 * TWO COORDINATES ON ONE LINE ARE NEVER A PAIR. The original notes contain
 * exactly that trap: 631/67/245 and -495/66/-394 shared a line separated by
 * "----" and are demonstrably not a pair (631 / 8 = 78, not -495).
 * docs/07-ALGORITHMS.md §6.2
 */
function buildImportRows(text) {
  const rows = [];
  const unrecognised = [];

  for (const raw of String(text ?? "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const { coords, label } = parseLine(raw);

    if (coords.length === 0) { unrecognised.push(raw.trim()); continue; }

    coords.forEach((c, i) => {
      const named = Boolean(label);
      const base = named ? label : "(unnamed)";
      const g = guessDimension({ y: c.y, label });
      rows.push({
        name: coords.length > 1 ? `${base} (${i + 1})` : base,
        x: c.x, y: c.y, z: c.z,
        dimension: g.d,
        guessed: g.d !== null,
        confident: g.confident,
        type: guessType(label),
        checked: named,          // unnamed rows are unchecked by default
        raw: raw.trim(),
      });
    });
  }

  return { rows, unrecognised };
}

/** Validate a parsed JSON export BEFORE any of it touches state. */
function validateImportPayload(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "That file is not a JSON object." };
  }
  if (obj.app !== "blockbook") {
    return { ok: false, error: 'Not a BlockBook export — the file has no `"app": "blockbook"` marker.' };
  }
  const v = Number(obj.schemaVersion ?? 1);
  if (!Number.isFinite(v)) {
    return { ok: false, error: "The file has no readable schemaVersion." };
  }
  if (v > SCHEMA_VERSION) {
    return { ok: false, error: `Written by a newer version of BlockBook (schema ${v}; this build understands ${SCHEMA_VERSION}). Nothing has been changed.` };
  }
  const locations = obj.worlds?.[0]?.locations;
  if (!Array.isArray(locations)) {
    return { ok: false, error: "The file contains no locations." };
  }
  return { ok: true, locations, schemaVersion: v };
}

/** Merge is append-only: an id that already exists is skipped, never overwritten. */
function mergeLocations(existing, incoming) {
  const have = new Set(existing.map(l => l.id));
  const added = [], skipped = [];
  for (const l of incoming) (have.has(l.id) ? skipped : added).push(l);
  return { added, skipped };
}

/** `/tp 221 65 374`. A null Y becomes `~` — the player's current height. */
function tpCommand(loc) {
  return `/tp ${loc.x} ${loc.y === null ? "~" : loc.y} ${loc.z}`;
}

/** blockbook-YYYY-MM-DD.json */
function exportFilename(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `blockbook-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/* --------------------------------------------------------------------------
   REFTABLE — the ONE generic searchable/sortable table renderer.
   docs/08-REFERENCE-DATA.md §4

   ZERO DOMAIN KNOWLEDGE LIVES HERE. No potions, no enchantments, no mobs.
   Everything arrives through `cfg`. Phase 12's gate is that a new reference tab
   takes under two hours; if one ever needs this function changed, the function
   is wrong, not the tab.

   Returns HTML rather than mounting into an element, so it composes with the
   single full-render path (ADR-002). renderRefTable() wraps it for the
   mount-style signature the doc describes.
   -------------------------------------------------------------------------- */

/**
 * Sort comparators. docs/07-ALGORITHMS.md §7.2
 * ISO 8601 UTC strings sort lexicographically in chronological order, so
 * `updated` needs no Date parsing and carries no timezone hazard.
 */
const SORTERS = {
  name:    (a, b) => a.name.localeCompare(b.name),
  type:    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name),
};

function sortLocations(list, key) {
  return [...list].sort(SORTERS[key] ?? SORTERS.updated);
}

/** Favourites float above everything else, whatever sort is chosen. */
function withFavourites(list, key) {
  return [...list].sort((a, b) =>
    (Number(b.favorite) - Number(a.favorite)) || (SORTERS[key] ?? SORTERS.updated)(a, b));
}

/** Most-recent-first, deduped, capped. Used for the recently-viewed strip. */
function pushRecent(list, id, max = 8) {
  return [id, ...list.filter(x => x !== id)].slice(0, max);
}

/**
 * The display pipeline: filter, then search, then sort.
 *
 * When a search query is present, relevance wins over the sort control.
 * Journey A requires "best match first" and the list must never need scrolling
 * to reach the top hit; honouring the sort control mid-search would break that.
 * The sort control governs the unsearched list. docs/03-APP-FLOW.md §3
 */
function visibleLocations(all, ui) {
  const filtered = filterLocations(all, ui.filters);
  return String(ui.search ?? "").trim()
    ? searchLocations(filtered, ui.search)
    : sortLocations(filtered, ui.sort);
}

/* ── BLOCKBOOK LOGIC END ──────────────────────────────────────────────────── */


/* ==========================================================================
   SEED DATA
   Inlined as a JS constant rather than fetched: opening this file over
   file:// makes fetch() fail on CORS. docs/02-TRD.md §6.1
   The copy of record is data/seed.json — keep the two in step until Phase 8
   switches this over to fetch().
   ========================================================================== */

/** Blank draft. `dimension` is deliberately undefined — ADR-005. */
function blankDraft() {
  return {
    id: null, name: "", dimension: undefined,
    xRaw: "", yRaw: "", zRaw: "",
    type: "misc", tagsRaw: "", notes: "",
    linkedPortalId: null, favorite: false,
  };
}

function draftFrom(loc) {
  return {
    id: loc.id, name: loc.name, dimension: loc.dimension,
    xRaw: String(loc.x), yRaw: loc.y === null ? "" : String(loc.y), zRaw: String(loc.z),
    type: loc.type, tagsRaw: loc.tags.join(", "), notes: loc.notes,
    linkedPortalId: loc.linkedPortalId, favorite: loc.favorite,
  };
}

/** Draft (raw strings) -> Location shape, for validation and commit. */
function draftToLocation(d) {
  return {
    id:   d.id,
    name: d.name.trim(),
    dimension: d.dimension,
    x: parseCoordInput(d.xRaw),
    y: parseYInput(d.yRaw),
    z: parseCoordInput(d.zRaw),
    type: d.type,
    tags: parseTagsInput(d.tagsRaw),
    notes: d.notes,
    linkedPortalId: d.linkedPortalId,
    favorite: d.favorite,
  };
}

/** "12.7" -> 12 (V3). "" -> NaN so E3 fires. */
function parseCoordInput(v) {
  const s = String(v).trim();
  if (s === "") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? Math.floor(n) : NaN;
}

/** "" -> null ("surface, don't care"). Never 0. */
function parseYInput(v) {
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.floor(n) : NaN;
}

function parseTagsInput(v) {
  return normaliseTags(String(v).split(","));
}


/* ==========================================================================
   RENDER — docs/02-TRD.md §3.3
   ONE render() that rebuilds the active tab from state. No component
   framework, no partial DOM patching: at this data size a full rebuild is
   well inside the 100 ms budget, and simplicity is worth more than the
   microseconds. Measure before optimising.
   ========================================================================== */

export {
  validateLocation,
  searchLocations,
  filterLocations,
  COORD,
  parseLine,
  guessDimension,
  guessType,
  buildImportRows,
  validateImportPayload,
  mergeLocations,
  tpCommand,
  exportFilename,
  SORTERS,
  sortLocations,
  withFavourites,
  pushRecent,
  visibleLocations,
  blankDraft,
  draftFrom,
  draftToLocation,
  parseCoordInput,
  parseYInput,
  parseTagsInput,
};
