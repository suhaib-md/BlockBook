/* Phase 1 gate — data model + seed. docs/06-IMPLEMENTATION-PLAN.md */
import { installDOM, makeChecker, seedLocations, readJSON } from "./harness.mjs";
installDOM();

const { check, eq, done } = makeChecker();
const schema = await import("../src/schema.js");

const SEED = seedLocations();
const built = schema.buildInitialData(SEED);
const locs = built.data.worlds[0].locations;
const FIELDS = schema.LOCATION_FIELDS;

console.log("=== Phase 1 gate ===");
eq(locs.length, 15, "15 locations");
eq(FIELDS.length, 13, "contract lists 13 fields");

const missing = locs.flatMap(l => FIELDS.filter(f => !(f in l)).map(f => `${l.id}.${f}`));
check(missing.length === 0, `every location has all 13 fields${missing.length ? " — missing " + missing.join(", ") : ""}`);

const extra = locs.flatMap(l => Object.keys(l).filter(k => !FIELDS.includes(k)).map(k => `${l.id}.${k}`));
check(extra.length === 0, `no stray fields${extra.length ? " — found " + extra.join(", ") : ""}`);

const byId = new Map(locs.map(l => [l.id, l]));
const trial = byId.get("loc_014"), fort = byId.get("loc_015");
eq(trial?.linkedPortalId, "loc_015", "Trial Chamber → Fortress");
eq(fort?.linkedPortalId, "loc_014", "Fortress → Trial Chamber (symmetric)");
check(trial.dimension !== fort.dimension, "linked pair is cross-dimension (invariant I4)");

const asym = locs.filter(l => l.linkedPortalId && byId.get(l.linkedPortalId)?.linkedPortalId !== l.id);
check(asym.length === 0, `no asymmetric links${asym.length ? " — " + asym.map(l => l.id) : ""}`);

check(locs.every(l => schema.DIMENSIONS.includes(l.dimension)), "every dimension is a valid enum value");
check(locs.every(l => schema.LOCATION_TYPES.includes(l.type)), "every type is a valid enum value");
check(locs.every(l => Number.isInteger(l.x) && Number.isInteger(l.z)), "x and z are integers");
check(locs.every(l => l.y === null || Number.isInteger(l.y)), "y is an integer or null");
check(locs.every(l => Array.isArray(l.tags)), "tags is always an array");
check(new Set(locs.map(l => l.id)).size === locs.length, "all ids unique");
check(built.data.schemaVersion === 1 && built.data.app === "blockbook", "root envelope correct");
eq(built.data.worlds[0].seed, null, "world seed is null, not a number");

console.log("\n=== data/seed.json is the copy of record ===");
const doc = readJSON("data/seed.json");
eq(doc.app, "blockbook", "seed file carries the app marker");
eq(doc.schemaVersion, 1, "seed file carries schemaVersion");
eq(doc.worlds[0].locations.length, 15, "seed file holds 15 locations");

console.log("\n=== link-invariant repair ===");
const rigged = schema.buildInitialData([
  { id: "a", name: "A", dimension: "overworld", x: 0, y: 0, z: 0, type: "portal", linkedPortalId: "b" },
  { id: "b", name: "B", dimension: "nether",    x: 0, y: 0, z: 0, type: "portal" },
  { id: "c", name: "C", dimension: "overworld", x: 0, y: 0, z: 0, type: "base",   linkedPortalId: "b" },
  { id: "d", name: "D", dimension: "overworld", x: 0, y: 0, z: 0, type: "portal", linkedPortalId: "zz" },
  { id: "e", name: "E", dimension: "overworld", x: 0, y: 0, z: 0, type: "portal", linkedPortalId: "a" },
]);
const r = new Map(rigged.data.worlds[0].locations.map(l => [l.id, l]));
eq(r.get("b").linkedPortalId, "a", "one-sided link repaired to symmetric");
eq(r.get("c").linkedPortalId, null, "I1: link on a non-portal cleared");
eq(r.get("d").linkedPortalId, null, "I2: link to a missing id cleared");
eq(r.get("e").linkedPortalId, null, "I4: same-dimension link cleared");

done();
