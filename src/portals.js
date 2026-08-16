/* ==========================================================================
   BlockBook — portals.js
   Nether maths and the portal link validator.
   Pure leaf — imports nothing from the app. docs/07-ALGORITHMS.md
   ========================================================================== */

/**
 * Horizontal blocks searched for an existing portal in the DESTINATION
 * dimension. Because it is measured in destination-dimension blocks, the two
 * traversal directions have very different reach:
 *   overworld -> nether : 128 nether blocks    (= 1024 overworld blocks)
 *   nether -> overworld : 128 overworld blocks (=   16 nether blocks)
 * That asymmetry is why nether hubs work, and why overworld portals built a
 * few hundred blocks apart silently merge.
 */
const LINK_RADIUS = 128;

/**
 * Overworld -> Nether.
 *
 * Y IS DELIBERATELY ABSENT FROM THE SIGNATURE (ADR-006). Only X and Z scale.
 * Making Y unpassable means it cannot be scaled by accident — the single most
 * common bug in this class of tool, and one that yields plausible wrong answers.
 *
 * Math.floor, never Math.trunc: for negative coordinates trunc rounds toward
 * zero and is off by one. floor(-1926/8) = -241; trunc gives -240.
 */
const toNether = (x, z) => ({ x: Math.floor(x / 8), z: Math.floor(z / 8) });

/** Nether -> Overworld. */
const toOverworld = (x, z) => ({ x: x * 8, z: z * 8 });

const horizontalDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** The dimension a portal links into. The End links nowhere. */
function destinationDimension(dim) {
  if (dim === "overworld") return "nether";
  if (dim === "nether")    return "overworld";
  return null;
}

/**
 * Where a portal lands in the other dimension.
 * @returns {{dimension, x, z}|null} null for the End, which has no scaling.
 */
function counterpart(loc) {
  const dest = destinationDimension(loc.dimension);
  if (!dest || !Number.isInteger(loc.x) || !Number.isInteger(loc.z)) return null;
  const p = loc.dimension === "overworld"
    ? toNether(loc.x, loc.z)
    : toOverworld(loc.x, loc.z);
  return { dimension: dest, x: p.x, z: p.z };
}

/**
 * Existing portals that would hijack the link for a proposed portal.
 * docs/07-ALGORITHMS.md §3.2
 * @returns {{location, distance}[]} nearest first
 */
function findLinkConflicts(candidate, all) {
  const target = counterpart(candidate);
  if (!target) return [];                       // End, or incomplete coordinates

  return all
    .filter(l => l.type === "portal"
              && l.dimension === target.dimension
              && l.id !== candidate.id          // never conflict with itself
              && Number.isInteger(l.x) && Number.isInteger(l.z))
    .map(l => ({ location: l, distance: horizontalDistance(target, l) }))
    .filter(r => r.distance <= LINK_RADIUS)
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Health of an existing pair, measured in BOTH directions.
 * docs/07-ALGORITHMS.md §4 · ADR-010
 *
 * A pair is only truly connected if both traversals land on the intended
 * portal, and the two directions have different tolerances (see LINK_RADIUS).
 * Report the worse one: a pair that works one way and not the other is broken
 * in the way that matters — you walk through and cannot get back.
 *
 * @returns {{forward, backward, worst, status}|null}
 */
function linkHealth(a, b) {
  if (!a || !b) return null;
  if (a.dimension === b.dimension) return null;
  if (a.dimension === "end" || b.dimension === "end") return null;
  if (![a, b].every(l => Number.isInteger(l.x) && Number.isInteger(l.z))) return null;

  const ow = a.dimension === "overworld" ? a : b;
  const ne = a.dimension === "overworld" ? b : a;

  // overworld -> nether, measured in NETHER blocks
  const forward  = horizontalDistance(toNether(ow.x, ow.z), ne);
  // nether -> overworld, measured in OVERWORLD blocks
  const backward = horizontalDistance(toOverworld(ne.x, ne.z), ow);

  const worst = Math.max(forward, backward);
  const status = worst <= 16 ? "tight" : worst <= LINK_RADIUS ? "loose" : "broken";
  return { forward, backward, worst, status };
}

/** One decimal place, without a trailing ".0" on whole numbers. */
function fmtDist(d) {
  return Number.isInteger(d) ? String(d) : d.toFixed(1);
}

/**
 * Portal-specific warnings W2 and W4, injected into validateLocation().
 * docs/05-DATA-SCHEMA.md §7
 */
function portalWarnings(loc, all) {
  const out = [];
  if (loc.type !== "portal") return out;
  if (!destinationDimension(loc.dimension)) return out;
  if (!Number.isInteger(loc.x) || !Number.isInteger(loc.z)) return out;

  // W2 — a portal that is NOT the chosen partner sitting inside the radius.
  // The chosen partner being nearby is the desired outcome, not a conflict.
  const hijackers = findLinkConflicts(loc, all)
    .filter(c => c.location.id !== loc.linkedPortalId);
  if (hijackers.length) {
    const n = hijackers[0];
    out.push({
      code: "W2", field: "x",
      msg: `Will likely link to “${n.location.name}” (${fmtDist(n.distance)} blocks away).`,
    });
  }

  // W4 — health of the pair that has actually been declared.
  const partner = loc.linkedPortalId ? all.find(l => l.id === loc.linkedPortalId) : null;
  const h = linkHealth(loc, partner);
  if (h && h.status === "loose") {
    out.push({ code: "W4", field: "linkedPortalId",
      msg: `This pair is ${fmtDist(h.worst)} blocks apart — another portal could steal the link.` });
  }
  if (h && h.status === "broken") {
    out.push({ code: "W4", field: "linkedPortalId",
      msg: `This pair is ${fmtDist(h.worst)} blocks apart — these two do NOT link to each other.` });
  }

  return out;
}

/* --------------------------------------------------------------------------
   DISTANCE / NEAREST — docs/07-ALGORITHMS.md §5
   -------------------------------------------------------------------------- */

/**
 * 3D distance. `y ?? 64` substitutes a plausible surface level for records with
 * an unknown Y — a heuristic that only affects ranking, never portal logic.
 */
function dist3(a, b) {
  return Math.hypot(a.x - b.x, (a.y ?? 64) - (b.y ?? 64), a.z - b.z);
}

/**
 * Put a location on the Overworld scale so cross-dimension distances are
 * comparable at all. The End has no scaling relationship with anything and must
 * be filtered out by the caller.
 */
function normalised(loc) {
  if (loc.dimension === "nether") {
    const { x, z } = toOverworld(loc.x, loc.z);
    return { ...loc, x, z };
  }
  return loc;
}

/**
 * Locations closest to a point, nearest first.
 *
 * `approx` marks a cross-dimension result. Those distances are *scale*
 * distances, not travel distances: a nether location 100 overworld-equivalent
 * blocks away is only reachable if a portal pair actually connects there.
 * Presenting it as a plain number would imply a walkability that does not exist,
 * so the UI must show the flag.
 *
 * @param {{dimension, x, y, z, id?}} point
 * @param {Location[]} all
 * @param {{limit?: number, sameDimensionOnly?: boolean}} opts
 * @returns {{location, distance, approx}[]}
 */
function nearestTo(point, all, { limit = 8, sameDimensionOnly = false } = {}) {
  if (!Number.isInteger(point?.x) || !Number.isInteger(point?.z)) return [];
  if (point.dimension === "end" && !sameDimensionOnly) {
    // The End cannot be compared to anything else; only same-dimension makes sense.
    sameDimensionOnly = true;
  }

  const origin = normalised(point);

  return all
    .filter(l => l.id !== point.id)
    .filter(l => Number.isInteger(l.x) && Number.isInteger(l.z))
    .filter(l => (sameDimensionOnly
      ? l.dimension === point.dimension
      // Without sameDimensionOnly the End is excluded: normalising it would be
      // a confident lie.
      : l.dimension !== "end" && point.dimension !== "end"))
    .map(l => ({
      location: l,
      distance: dist3(origin, normalised(l)),
      approx: l.dimension !== point.dimension,
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

/** Portals whose declared pair does not actually connect. Surfaced prominently. */
function brokenPairs(all) {
  const seen = new Set();
  const out = [];
  for (const loc of all) {
    if (loc.type !== "portal" || !loc.linkedPortalId) continue;
    const key = [loc.id, loc.linkedPortalId].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const h = linkHealth(loc, all.find(l => l.id === loc.linkedPortalId));
    if (h?.status === "broken") out.push({ a: loc, b: all.find(l => l.id === loc.linkedPortalId), health: h });
  }
  return out;
}

export {
  LINK_RADIUS,
  toNether,
  toOverworld,
  horizontalDistance,
  destinationDimension,
  counterpart,
  findLinkConflicts,
  linkHealth,
  fmtDist,
  portalWarnings,
  brokenPairs,
  dist3,
  normalised,
  nearestTo,
};
