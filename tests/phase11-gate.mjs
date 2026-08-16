/* Phase 11 gate — distance / nearest-to.
   The waypoint-sync half of this phase was dropped: no minimap mod is installed,
   so there is nothing to read, nothing to write to, and no way to verify a
   format. See docs/10-DECISIONS-AND-RISKS.md ADR-017. */
import { installDOM, makeChecker, seedLocations, reload, readSrc, ROOT } from "./harness.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
installDOM();

const { check, eq, near, done } = makeChecker();
const P     = await import("../src/portals.js");
const store = await import("../src/store.js");
const views = await import("../src/views.js");

const SEED = seedLocations();
await reload(store, SEED);
const ALL = store.activeLocations();

console.log("=== dist3 ===");
eq(P.dist3({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5, "3-4-5 triangle");
eq(P.dist3({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 0, "same point is zero");
near(P.dist3({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }), 1.732, "diagonal in 3D");
// A null Y must not poison the arithmetic.
eq(P.dist3({ x: 0, y: null, z: 0 }, { x: 0, y: 64, z: 0 }), 0, "null Y is treated as 64, not NaN");
check(Number.isFinite(P.dist3({ x: 0, y: null, z: 0 }, { x: 3, y: null, z: 4 })),
      "two null Ys still yield a finite distance");
eq(P.dist3({ x: 0, y: null, z: 0 }, { x: 3, y: null, z: 4 }), 5, "  ...and the horizontal part is exact");

console.log("\n=== normalised (docs 07 §5.2) ===");
const ne = { dimension: "nether", x: 16, y: 46, z: 38 };
eq(P.normalised(ne).x, 128, "nether X is scaled up by 8");
eq(P.normalised(ne).z, 304, "nether Z is scaled up by 8");
eq(P.normalised(ne).y, 46, "Y is NOT scaled (ADR-006 holds here too)");
eq(P.normalised(ne).dimension, "nether", "the original dimension is preserved");
const ow = { dimension: "overworld", x: 100, y: 64, z: 200 };
eq(P.normalised(ow).x, 100, "overworld is left alone");

console.log("\n=== nearestTo ===");
const home = ALL.find(l => l.id === "loc_001");           // 221 / 65 / 374
let hits = P.nearestTo(home, ALL, { limit: 5 });
check(hits.length > 0, "returns results");
check(hits.every(h => h.location.id !== home.id), "never includes the origin itself");
for (let i = 1; i < hits.length; i++) {
  check(hits[i].distance >= hits[i - 1].distance, `sorted ascending (${i})`);
}
eq(P.nearestTo(home, ALL, { limit: 3 }).length, 3, "limit is honoured");

console.log("\n=== the nearest neighbour is genuinely the nearest ===");
// Home is 221/65/374. Spawner A is 97/-19/468, Spawner B is 105/-49/256.
const byHand = ALL
  .filter(l => l.id !== home.id && l.dimension !== "end")
  .map(l => ({ id: l.id, d: P.dist3(P.normalised(home), P.normalised(l)) }))
  .sort((a, b) => a.d - b.d);
eq(hits[0].location.id, byHand[0].id, "top hit matches an independent calculation");
near(hits[0].distance, byHand[0].d, "  ...and so does its distance");

console.log("\n=== cross-dimension results are flagged approximate ===");
hits = P.nearestTo(home, ALL, { limit: 20 });
const cross = hits.filter(h => h.location.dimension !== home.dimension);
check(cross.length > 0, "the seed data produces cross-dimension hits");
check(cross.every(h => h.approx === true), "every cross-dimension hit is marked approx");
check(hits.filter(h => h.location.dimension === home.dimension).every(h => h.approx === false),
      "same-dimension hits are NOT marked approx");
// A nether location must be compared on the overworld scale, not raw.
const homePortal = ALL.find(l => l.id === "loc_002");     // nether 16 / 46 / 38
const h = hits.find(x => x.location.id === homePortal.id);
near(h.distance, P.dist3(home, { x: 128, y: 46, z: 304 }),
     "nether distance is measured after scaling to overworld");

console.log("\n=== sameDimensionOnly ===");
const same = P.nearestTo(home, ALL, { limit: 20, sameDimensionOnly: true });
check(same.every(h => h.location.dimension === "overworld"), "only same-dimension results");
check(same.every(h => h.approx === false), "  ...so nothing is approximate");
check(same.length < hits.length, "  ...and it is a narrower set");

console.log("\n=== the End is excluded from cross-dimension comparison ===");
const endLoc = { id: "e1", name: "End Thing", dimension: "end", x: 100, y: 64, z: 100,
                 type: "misc", tags: [], notes: "", linkedPortalId: null, favorite: false,
                 createdAt: "", updatedAt: "" };
const withEnd = [...ALL, endLoc];
check(P.nearestTo(home, withEnd, { limit: 20 }).every(x => x.location.dimension !== "end"),
      "End locations never appear in a cross-dimension search");
// From the End, only same-dimension comparison is meaningful.
const fromEnd = P.nearestTo(endLoc, withEnd, { limit: 20 });
check(fromEnd.every(x => x.location.dimension === "end"),
      "searching FROM the End returns only End locations");

console.log("\n=== bad input is handled, not crashed on ===");
eq(P.nearestTo({ dimension: "overworld", x: NaN, z: 0 }, ALL).length, 0, "NaN X -> no results");
eq(P.nearestTo({ dimension: "overworld", x: 0, z: NaN }, ALL).length, 0, "NaN Z -> no results");
eq(P.nearestTo(null, ALL).length, 0, "null point -> no results");
eq(P.nearestTo({ dimension: "overworld", x: 0, z: 0 }, []).length, 0, "empty dataset -> no results");
check(P.nearestTo({ dimension: "overworld", x: 0, z: 0 },
      [{ ...home, x: NaN }]).length === 0, "locations with bad coordinates are skipped");

console.log("\n=== portals.js stays a pure leaf ===");
const src = readSrc("portals.js");
check(!/from "\.\//.test(src), "still imports nothing from the app");
for (const w of ["document", "window", "localStorage", "state"]) {
  check(!new RegExp(`\\b${w}\\b`).test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")),
        `  ...and does not reference ${w}`);
}

console.log("\n=== UI wiring ===");
store.state.ui.activeTab = "portals";
store.state.ui.near = { dimension: "overworld", x: "221", y: "65", z: "374", sameOnly: false };
const panel = views.portalsPanelHTML();
check(panel.includes("What's near me?"), "the Nearby panel renders");
check(/id="near-x"/.test(panel) && /id="near-z"/.test(panel), "X and Z inputs present");
check(/id="near-y"/.test(panel), "Y is optional but offered");
check(/placeholder="optional"/.test(panel), "  ...and marked optional");
check(/id="near-same"/.test(panel), "same-dimension toggle present");
check(/id="near-from"/.test(panel), "can start from a saved location");
check(panel.includes("≈"), "cross-dimension hits carry the approx marker");
check(/scale<\/strong> distance, not a walk/.test(panel),
      "and the panel explains what an approximate distance means");

// Every control needs a stable id or focus dies on re-render (Phase 7 lesson).
const controls = [...panel.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map(m => m[0]);
check(controls.length > 0, "the panel has controls");
check(controls.every(t => /\bid="/.test(t)), "every Nearby control has a stable id");

store.state.ui.near = { dimension: "overworld", x: "", y: "", z: "", sameOnly: false };
const empty = views.portalsPanelHTML();
check(empty.includes("Enter an X and a Z"), "empty input shows a prompt, not an error");
check(/F3 in game/.test(empty), "  ...and says where to read the coordinates from");
store.state.ui.near = { dimension: "overworld", x: "-", y: "", z: "", sameOnly: false };
check(views.portalsPanelHTML().includes("Enter an X and a Z"),
      'a half-typed "-" is treated as incomplete, not as a crash');

console.log("\n=== waypoint sync is deliberately absent (ADR-017) ===");
check(!existsSync(join(ROOT, "src/xaero.js")), "no xaero.js was written");
for (const m of ["portals", "locations", "store", "views", "main", "desktop"]) {
  check(!/xaero|waypoint/i.test(readSrc(`${m}.js`)), `${m}.js has no waypoint code`);
}

done();
