import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(process.argv[2], "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const store = new Map();
const mkEl = () => ({ _html: "", focus() {}, set textContent(v) { sandbox.__boot = v; },
  get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; } });
const sandbox = {
  console: { log: () => {}, warn: () => {}, table: () => {} },
  setTimeout, clearTimeout, performance,
  crypto: { randomUUID: () => "id_" + Math.random().toString(36).slice(2, 10) },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  document: {
    documentElement: { dataset: {} },
    activeElement: null,
    getElementById: mkEl,
    querySelector: () => null,
    addEventListener: () => {},
  },
  window: { addEventListener: () => {} },
};
vm.createContext(sandbox);
// top-level `const` is lexical and never lands on the sandbox object, so ask the
// script itself to hand the bindings over.
vm.runInContext(script + `
;globalThis.__exports = {
  LOCATION_FIELDS, DIMENSIONS, LOCATION_TYPES, Y_RANGES, SCHEMA_VERSION, state
};`, sandbox);
const { LOCATION_FIELDS: __F, DIMENSIONS: __D, LOCATION_TYPES: __T, state: __state } = sandbox.__exports;
sandbox.LOCATION_FIELDS = __F;
sandbox.DIMENSIONS = __D;
sandbox.LOCATION_TYPES = __T;
sandbox.state = __state;

// ---- independent assertions against the real objects the app built ----
const locs = sandbox.activeLocations();
const FIELDS = sandbox.LOCATION_FIELDS;
let fails = 0;
const check = (ok, msg) => { console.log((ok ? "PASS  " : "FAIL  ") + msg); if (!ok) fails++; };

console.log("\n=== Phase 1 gate ===");
check(locs.length === 15, `15 locations (got ${locs.length})`);
check(FIELDS.length === 13, `contract lists 13 fields (got ${FIELDS.length})`);

const missing = locs.flatMap(l => FIELDS.filter(f => !(f in l)).map(f => `${l.id}.${f}`));
check(missing.length === 0, `every location has all 13 fields${missing.length ? " — missing " + missing.join(", ") : ""}`);

const extra = locs.flatMap(l => Object.keys(l).filter(k => !FIELDS.includes(k)).map(k => `${l.id}.${k}`));
check(extra.length === 0, `no stray fields${extra.length ? " — found " + extra.join(", ") : ""}`);

const byId = new Map(locs.map(l => [l.id, l]));
const trial = byId.get("loc_014"), fort = byId.get("loc_015");
check(trial?.linkedPortalId === "loc_015", "Trial Chamber → Fortress");
check(fort?.linkedPortalId === "loc_014", "Fortress → Trial Chamber (symmetric)");
check(trial.dimension !== fort.dimension, "linked pair is cross-dimension (invariant I4)");

const asym = locs.filter(l => l.linkedPortalId && byId.get(l.linkedPortalId)?.linkedPortalId !== l.id);
check(asym.length === 0, `no asymmetric links${asym.length ? " — " + asym.map(l => l.id) : ""}`);

check(locs.every(l => sandbox.DIMENSIONS.includes(l.dimension)), "every dimension is a valid enum value");
check(locs.every(l => sandbox.LOCATION_TYPES.includes(l.type)), "every type is a valid enum value");
check(locs.every(l => Number.isInteger(l.x) && Number.isInteger(l.z)), "x and z are integers");
check(locs.every(l => l.y === null || Number.isInteger(l.y)), "y is an integer or null");
check(locs.every(l => Array.isArray(l.tags)), "tags is always an array");
check(new Set(locs.map(l => l.id)).size === locs.length, "all ids unique");
check(sandbox.state.data.schemaVersion === 1 && sandbox.state.data.app === "blockbook", "root envelope correct");
check(sandbox.state.data.worlds[0].seed === null, "world seed is null, not a number");

// invariant repair actually works
const rigged = sandbox.buildInitialData([
  { id: "a", name: "A", dimension: "overworld", x: 0, y: 0, z: 0, type: "portal", linkedPortalId: "b" },
  { id: "b", name: "B", dimension: "nether",    x: 0, y: 0, z: 0, type: "portal" },
  { id: "c", name: "C", dimension: "overworld", x: 0, y: 0, z: 0, type: "base",   linkedPortalId: "b" },
  { id: "d", name: "D", dimension: "overworld", x: 0, y: 0, z: 0, type: "portal", linkedPortalId: "zz" },
  { id: "e", name: "E", dimension: "overworld", x: 0, y: 0, z: 0, type: "portal", linkedPortalId: "a" },
]);
const r = new Map(rigged.data.worlds[0].locations.map(l => [l.id, l]));
console.log("\n=== link-invariant repair ===");
check(r.get("b").linkedPortalId === "a", "one-sided link repaired to symmetric");
check(r.get("c").linkedPortalId === null, "I1: link on a non-portal cleared");
check(r.get("d").linkedPortalId === null, "I2: link to a missing id cleared");
check(r.get("e").linkedPortalId === null, "I4: same-dimension link cleared");

console.log(`\n${fails === 0 ? "GATE PASSED" : "GATE FAILED — " + fails + " failure(s)"}`);
process.exit(fails === 0 ? 0 : 1);
