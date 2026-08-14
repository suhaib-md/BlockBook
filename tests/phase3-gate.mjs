import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(process.argv[2], "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- DOM + localStorage stub ----------------------------------------------
function makeSandbox(store = new Map()) {
  const els = {};
  const mkEl = (id) => (els[id] ??= { id, _html: "", focus(){}, get innerHTML(){return this._html;}, set innerHTML(v){this._html=v;} });
  const sb = {
    els, store,
    crypto: { randomUUID: () => "id_" + Math.random().toString(36).slice(2, 10) },
    performance,
    setTimeout, clearTimeout,
    console: { log(){}, warn(){}, error(...a){ console.error(...a); } },
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
  vm.createContext(sb);
  vm.runInContext(script + `
;globalThis.__x = { state, activeLocations, validateLocation, searchLocations,
  filterLocations, sortLocations, visibleLocations, commitLocation, deleteLocation,
  toggleFavorite, loadData, writeNow, blankDraft, draftFrom, draftToLocation,
  parseCoordInput, parseYInput, parseTagsInput, normaliseTags, repairPortalLinks,
  buildInitialData, SEED_LOCATIONS, STORAGE_KEY, DIMENSIONS, LOCATION_TYPES,
  render, cardHTML, esc };`, sb);
  return sb;
}

let fails = 0;
const check = (ok, msg) => { console.log((ok ? "PASS  " : "FAIL  ") + msg); if (!ok) fails++; };
const sb = makeSandbox();
const X = sb.__x;
const L = () => X.activeLocations();

// ============================================================================
console.log("=== validation: errors block (docs 05 §7) ===");
const base = { id: null, name: "Test", dimension: "overworld", x: 10, y: 64, z: 20,
               type: "misc", tags: [], notes: "", linkedPortalId: null, favorite: false };
const errs = (o) => X.validateLocation({ ...base, ...o }, L()).errors.map(e => e.code);
const warns = (o) => X.validateLocation({ ...base, ...o }, L()).warnings.map(w => w.code);

check(errs({ name: "" }).includes("E1"), "V1  empty name -> E1");
check(errs({ name: "   " }).includes("E1"), "V1  whitespace-only name -> E1");
check(errs({ dimension: undefined }).includes("E2"), "V2  unset dimension -> E2");
check(errs({ dimension: "nether" }).length === 0, "V2  valid dimension passes");
check(X.parseCoordInput("12.7") === 12, "V3  '12.7' floors to 12");
check(X.parseCoordInput("-12.7") === -13, "V3  '-12.7' floors to -13 (floor, not trunc)");
check(X.parseCoordInput("") !== X.parseCoordInput(""), "V3  empty X is NaN (so E3 fires)");
check(errs({ x: NaN }).includes("E3"), "V3  NaN X -> E3");
check(errs({ y: null }).length === 0, "V4  null Y is valid");
check(errs({ y: 1.5 }).includes("E4"), "V4  fractional Y -> E4");
check(warns({ dimension: "nether", y: 200 }).includes("W1"), "V5  Y 200 in nether -> W1");
check(errs({ dimension: "nether", y: 200 }).length === 0, "V5  ...but W1 does NOT block");
check(warns({ y: -64 }).length === 0, "V6  Y -64 overworld: no warning (boundary)");
check(warns({ y: 320 }).length === 0, "V6  Y 320 overworld: no warning (boundary)");
check(warns({ y: 321 }).includes("W1"), "V7  Y 321 overworld -> W1 (boundary + 1)");
check(warns({ y: -65 }).includes("W1"), "V7  Y -65 overworld -> W1");
check(errs({ x: 30000001 }).includes("E5"), "V8  X beyond world border -> E5");
check(errs({ x: 30000000 }).length === 0, "V8  X exactly at the border is fine");
check(errs({ type: "castle" }).includes("E6"), "    unknown type -> E6");

console.log("\n=== validation: link invariants ===");
const ow = L().find(l => l.id === "loc_014");   // overworld portal
const ne = L().find(l => l.id === "loc_015");   // nether portal
const home = L().find(l => l.id === "loc_001"); // base, overworld
check(X.validateLocation({ ...base, id: "t", type: "portal", linkedPortalId: home.id }, L())
       .errors.some(e => e.code === "E7"), "V9  link to a non-portal -> E7");
check(X.validateLocation({ ...base, id: "t", dimension: "overworld", type: "portal", linkedPortalId: ow.id }, L())
       .errors.some(e => e.code === "E7"), "V10 link to a same-dimension portal -> E7");
check(X.validateLocation({ ...base, id: "t", type: "portal", linkedPortalId: "gone" }, L())
       .errors.some(e => e.code === "E7"), "    link to a missing id -> E7");
check(X.validateLocation({ ...base, id: "t", dimension: "overworld", type: "portal", linkedPortalId: ne.id }, L())
       .errors.length === 0, "    valid cross-dimension portal link passes");
check(warns({ type: "portal" }).includes("W3"), "    portal with no partner -> W3");
check(warns({ name: "Home" }).includes("W5"), "V12 duplicate name -> W5 (warning only)");
check(errs({ name: "Home" }).length === 0, "V12 ...duplicate name does NOT block");
check(warns({ type: "fortress", dimension: "overworld" }).includes("W6"), "    fortress in overworld -> W6");
check(warns({ type: "fortress", dimension: "nether" }).length === 0, "    fortress in nether: no W6");

console.log("\n=== tags (V13) ===");
check(X.parseTagsInput("Main, MAIN , main").join("|") === "main", "V13 tags trimmed, lowercased, deduped");
check(X.parseTagsInput("a,,b").join("|") === "a|b", "V13 empty tags dropped");
check(X.parseTagsInput("").length === 0, "V13 empty input -> []");

console.log("\n=== draft raw-string handling (negative coords must be typable) ===");
let d = X.blankDraft();
check(d.dimension === undefined, "blank draft has NO default dimension (ADR-005)");
for (const partial of ["-", "-4", "-40", "-402"]) {
  d.xRaw = partial;
  check(X.draftToLocation(d).x !== undefined, `typing "${partial}" does not crash`);
}
d.xRaw = "-"; check(Number.isNaN(X.draftToLocation(d).x), 'lone "-" is NaN, but the raw string survives');
check(d.xRaw === "-", 'lone "-" is NOT erased from the draft (would break negative entry)');
d = X.draftFrom(L().find(l => l.id === "loc_010"));
check(d.xRaw === "97" && d.yRaw === "-19" && d.zRaw === "468", "draftFrom round-trips coordinates");
check(X.draftToLocation(d).y === -19, "negative Y survives the round trip");
const dnull = X.draftFrom({ ...home, y: null });
check(dnull.yRaw === "" && X.draftToLocation(dnull).y === null, "null Y round-trips as empty string");
d.tagsRaw = "a,";
check(X.draftToLocation(d).tags.join("|") === "a", "trailing comma parses cleanly");
check(d.tagsRaw === "a,", "trailing comma is NOT erased while typing");

console.log("\n=== search (docs 07 §7.1) ===");
const all = L();
check(X.searchLocations(all, "spawner").length === 3, `"spawner" -> exactly 3 (got ${X.searchLocations(all,"spawner").length})`);
check(X.searchLocations(all, "SPAWNER").length === 3, "search is case-insensitive");
check(X.searchLocations(all, "monument").length >= 1, "'monument' found VIA NOTES (not in any name)");
check(X.searchLocations(all, "monument").some(l => l.name.includes("Shipwreck")), "  ...and it is the shipwreck");
check(X.searchLocations(all, "zombie").length === 2, "tag search: 'zombie' -> 2");
check(X.searchLocations(all, "").length === all.length, "empty query returns everything");
check(X.searchLocations(all, "   ").length === all.length, "whitespace query returns everything");
check(X.searchLocations(all, "zzzznope").length === 0, "no match -> empty");
const ranked = X.searchLocations(all, "home");
check(ranked[0].name === "Home", "exact name match ranks first");

console.log("\n=== filter ===");
check(X.filterLocations(all, { dimension: "nether" }).length === 3, "dimension filter -> 3 nether");
check(X.filterLocations(all, { type: "portal" }).length === 6, "type filter -> 6 portals");
check(X.filterLocations(all, { dimension: "nether", type: "portal" }).length === 3, "combined filter");
check(X.filterLocations(all, {}).length === all.length, "no filter -> everything");

console.log("\n=== pipeline: filter + search + sort ===");
const ui = { search: "", filters: { dimension: "overworld", type: null }, sort: "name" };
check(X.visibleLocations(all, ui).length === 12, "filter applies without a query");
check(X.visibleLocations(all, ui)[0].name.localeCompare(X.visibleLocations(all, ui)[1].name) <= 0, "sort applies without a query");
const ui2 = { search: "portal", filters: { dimension: "nether", type: null }, sort: "name" };
const r2 = X.visibleLocations(all, ui2);
check(r2.every(l => l.dimension === "nether"), "search respects the active filter");
check(r2.length > 0 && r2.length < X.searchLocations(all, "portal").length, "filter narrows the search result");

// ============================================================================
console.log("\n=== mutations ===");
const n0 = L().length;
X.commitLocation({ ...base, id: null, name: "Ancient Debris", dimension: "nether", x: -212, y: 14, z: 88, type: "mine", tags: ["debris"] });
check(L().length === n0 + 1, "commit adds a location");
const added = L().find(l => l.name === "Ancient Debris");
check(added && added.id && added.createdAt && added.updatedAt, "added row gets id + timestamps");
check(added.x === -212 && added.y === 14, "negative coordinate stored correctly");

const before = added.updatedAt;
X.commitLocation({ ...added, name: "Ancient Debris Vein" });
check(L().length === n0 + 1, "edit does not duplicate");
check(L().find(l => l.id === added.id).name === "Ancient Debris Vein", "edit applies");
check(L().find(l => l.id === added.id).createdAt === added.createdAt, "createdAt is preserved on edit");

X.toggleFavorite(added.id);
check(L().find(l => l.id === added.id).favorite === true, "toggleFavorite works");

// V15 — deleting a linked portal must clear the partner, not dangle
check(L().find(l => l.id === "loc_014").linkedPortalId === "loc_015", "pair linked before delete");
X.deleteLocation("loc_015");
check(L().find(l => l.id === "loc_014").linkedPortalId === null, "V15 deleting B clears A's link (no dangle)");
check(!L().some(l => l.id === "loc_015"), "V15 deleted row is gone");
check(X.deleteLocation("does-not-exist") === null, "deleting a missing id is a no-op");

// ============================================================================
console.log("\n=== persistence round trip (the Phase 3 gate) ===");
const sb2 = makeSandbox();               // fresh "browser", empty storage
const Y = sb2.__x;
check(Y.activeLocations().length === 15, "first run seeds 15 locations");
Y.commitLocation({ ...base, id: null, name: "Persisted Point", dimension: "end", x: 5, y: 70, z: -9, type: "misc" });
Y.writeNow();                            // simulate the debounce firing
check(sb2.store.has("blockbook.data"), "data written to localStorage");

// "close the browser and reopen": new sandbox, SAME storage
const sb3 = makeSandbox(sb2.store);
const Z = sb3.__x;
check(Z.activeLocations().length === 16, "reopened with 16 locations");
const persisted = Z.activeLocations().find(l => l.name === "Persisted Point");
check(Boolean(persisted), "the added location survived a full reload");
check(persisted?.x === 5 && persisted?.y === 70 && persisted?.z === -9, "its coordinates are intact");
check(persisted?.dimension === "end", "its dimension is intact");
const tp = Z.activeLocations().find(l => l.id === "loc_014");
check(tp?.linkedPortalId === "loc_015", "portal links survive the round trip, still symmetric");
check(Z.activeLocations().find(l => l.id === "loc_015")?.linkedPortalId === "loc_014", "  ...both sides");

console.log("\n=== corrupt / hostile storage (docs 02 §8) ===");
const bad = new Map([["blockbook.data", "{ this is not json"]]);
const sb4 = makeSandbox(bad);
check(sb4.__x.activeLocations().length === 15, "unparseable data falls back to seed");
check([...bad.keys()].some(k => k.startsWith("blockbook.data.corrupt-")), "corrupt data QUARANTINED, not discarded");
check(bad.get([...bad.keys()].find(k => k.includes("corrupt"))) === "{ this is not json", "quarantined copy is byte-identical");
check(sb4.__x.state.notice !== null, "a banner explains what happened");

const newer = new Map([["blockbook.data", JSON.stringify({ app: "blockbook", schemaVersion: 99, worlds: [], settings: {} })]]);
const sb5 = makeSandbox(newer);
check(sb5.__x.state.fatal === true, "S3 newer schema -> fatal, refuses to load");
check(sb5.__x.state.data === null, "S3 no data loaded");
sb5.__x.writeNow();
check(newer.get("blockbook.data").includes('"schemaVersion":99'), "S3 newer-schema file is NOT overwritten");

const foreign = new Map([["blockbook.data", JSON.stringify({ app: "some-other-app", data: 1 })]]);
const sb6 = makeSandbox(foreign);
check(sb6.__x.activeLocations().length === 15, "foreign JSON falls back to seed");
check([...foreign.keys()].some(k => k.includes("corrupt")), "foreign JSON quarantined too");

console.log("\n=== escaping in rendered cards ===");
const sb7 = makeSandbox();
sb7.__x.commitLocation({ ...base, id: null, name: '<img src=x onerror=alert(1)>', dimension: "overworld", x: 1, y: 1, z: 1, tags: ["<b>evil"] });
const cardsHTML = sb7.__x.activeLocations().map(sb7.__x.cardHTML).join("");
check(!cardsHTML.includes("<img src=x"), "hostile name is escaped in the card");
check(!/<b>evil/.test(cardsHTML), "hostile tag is escaped");

console.log(`\n${fails === 0 ? "GATE PASSED" : "GATE FAILED — " + fails + " failure(s)"}`);
process.exit(fails === 0 ? 0 : 1);
