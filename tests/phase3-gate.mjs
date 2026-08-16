/* Phase 3 gate — CRUD, validation, search, filter, persistence. */
import { installDOM, makeChecker, seedLocations, reload } from "./harness.mjs";
let dom = installDOM();

const { check, eq, done } = makeChecker();
const loc   = await import("../src/locations.js");
const store = await import("../src/store.js");
const views = await import("../src/views.js");
const util  = await import("../src/util.js");

const SEED = seedLocations();
await reload(store, SEED);
const L = () => store.activeLocations();

const base = { id: null, name: "Test", dimension: "overworld", x: 10, y: 64, z: 20,
               type: "misc", tags: [], notes: "", linkedPortalId: null, favorite: false };
const errs  = (o) => loc.validateLocation({ ...base, ...o }, L()).errors.map(e => e.code);
const warns = (o) => loc.validateLocation({ ...base, ...o }, L()).warnings.map(w => w.code);

console.log("=== validation: errors block (docs 05 §7) ===");
check(errs({ name: "" }).includes("E1"), "V1  empty name -> E1");
check(errs({ name: "   " }).includes("E1"), "V1  whitespace-only name -> E1");
check(errs({ dimension: undefined }).includes("E2"), "V2  unset dimension -> E2");
eq(errs({ dimension: "nether" }).length, 0, "V2  valid dimension passes");
eq(loc.parseCoordInput("12.7"), 12, "V3  '12.7' floors to 12");
eq(loc.parseCoordInput("-12.7"), -13, "V3  '-12.7' floors to -13 (floor, not trunc)");
check(Number.isNaN(loc.parseCoordInput("")), "V3  empty X is NaN (so E3 fires)");
check(errs({ x: NaN }).includes("E3"), "V3  NaN X -> E3");
eq(errs({ y: null }).length, 0, "V4  null Y is valid");
check(errs({ y: 1.5 }).includes("E4"), "V4  fractional Y -> E4");
check(warns({ dimension: "nether", y: 200 }).includes("W1"), "V5  Y 200 in nether -> W1");
eq(errs({ dimension: "nether", y: 200 }).length, 0, "V5  ...but W1 does NOT block");
eq(warns({ y: -64 }).length, 0, "V6  Y -64 overworld: no warning (boundary)");
eq(warns({ y: 320 }).length, 0, "V6  Y 320 overworld: no warning (boundary)");
check(warns({ y: 321 }).includes("W1"), "V7  Y 321 overworld -> W1 (boundary + 1)");
check(warns({ y: -65 }).includes("W1"), "V7  Y -65 overworld -> W1");
check(errs({ x: 30000001 }).includes("E5"), "V8  X beyond world border -> E5");
eq(errs({ x: 30000000 }).length, 0, "V8  X exactly at the border is fine");
check(errs({ type: "castle" }).includes("E6"), "    unknown type -> E6");

console.log("\n=== validation: link invariants ===");
const ow = L().find(l => l.id === "loc_014");
const ne = L().find(l => l.id === "loc_015");
const home = L().find(l => l.id === "loc_001");
check(loc.validateLocation({ ...base, id: "t", type: "portal", linkedPortalId: home.id }, L())
        .errors.some(e => e.code === "E7"), "V9  link to a non-portal -> E7");
check(loc.validateLocation({ ...base, id: "t", dimension: "overworld", type: "portal", linkedPortalId: ow.id }, L())
        .errors.some(e => e.code === "E7"), "V10 link to a same-dimension portal -> E7");
check(loc.validateLocation({ ...base, id: "t", type: "portal", linkedPortalId: "gone" }, L())
        .errors.some(e => e.code === "E7"), "    link to a missing id -> E7");
eq(loc.validateLocation({ ...base, id: "t", dimension: "overworld", type: "portal", linkedPortalId: ne.id }, L())
     .errors.length, 0, "    valid cross-dimension portal link passes");
check(warns({ type: "portal" }).includes("W3"), "    portal with no partner -> W3");
check(warns({ name: "Home" }).includes("W5"), "V12 duplicate name -> W5 (warning only)");
eq(errs({ name: "Home" }).length, 0, "V12 ...duplicate name does NOT block");
check(warns({ type: "fortress", dimension: "overworld" }).includes("W6"), "    fortress in overworld -> W6");
eq(warns({ type: "fortress", dimension: "nether" }).length, 0, "    fortress in nether: no W6");

console.log("\n=== tags (V13) ===");
eq(loc.parseTagsInput("Main, MAIN , main").join("|"), "main", "V13 tags trimmed, lowercased, deduped");
eq(loc.parseTagsInput("a,,b").join("|"), "a|b", "V13 empty tags dropped");
eq(loc.parseTagsInput("").length, 0, "V13 empty input -> []");

console.log("\n=== draft raw strings (negative coords must be typable) ===");
let d = loc.blankDraft();
eq(d.dimension, undefined, "blank draft has NO default dimension (ADR-005)");
d.xRaw = "-";
check(Number.isNaN(loc.draftToLocation(d).x), 'lone "-" parses to NaN');
eq(d.xRaw, "-", 'lone "-" is NOT erased from the draft (would break negative entry)');
d = loc.draftFrom(L().find(l => l.id === "loc_010"));
check(d.xRaw === "97" && d.yRaw === "-19" && d.zRaw === "468", "draftFrom round-trips coordinates");
eq(loc.draftToLocation(d).y, -19, "negative Y survives the round trip");
const dnull = loc.draftFrom({ ...home, y: null });
check(dnull.yRaw === "" && loc.draftToLocation(dnull).y === null, "null Y round-trips as empty string");
d.tagsRaw = "a,";
eq(loc.draftToLocation(d).tags.join("|"), "a", "trailing comma parses cleanly");
eq(d.tagsRaw, "a,", "trailing comma is NOT erased while typing");

console.log("\n=== search (docs 07 §7.1) ===");
const all = L();
eq(loc.searchLocations(all, "spawner").length, 3, '"spawner" -> exactly 3');
eq(loc.searchLocations(all, "SPAWNER").length, 3, "search is case-insensitive");
check(loc.searchLocations(all, "monument").length >= 1, "'monument' found VIA NOTES (not in any name)");
check(loc.searchLocations(all, "monument").some(l => l.name.includes("Shipwreck")), "  ...and it is the shipwreck");
eq(loc.searchLocations(all, "zombie").length, 2, "tag search: 'zombie' -> 2");
eq(loc.searchLocations(all, "").length, all.length, "empty query returns everything");
eq(loc.searchLocations(all, "   ").length, all.length, "whitespace query returns everything");
eq(loc.searchLocations(all, "zzzznope").length, 0, "no match -> empty");
eq(loc.searchLocations(all, "home")[0].name, "Home", "exact name match ranks first");

console.log("\n=== filter ===");
eq(loc.filterLocations(all, { dimension: "nether" }).length, 3, "dimension filter -> 3 nether");
eq(loc.filterLocations(all, { type: "portal" }).length, 6, "type filter -> 6 portals");
eq(loc.filterLocations(all, { dimension: "nether", type: "portal" }).length, 3, "combined filter");
eq(loc.filterLocations(all, {}).length, all.length, "no filter -> everything");

console.log("\n=== pipeline: filter + search + sort ===");
const ui = { search: "", filters: { dimension: "overworld", type: null }, sort: "name" };
eq(loc.visibleLocations(all, ui).length, 12, "filter applies without a query");
const ui2 = { search: "portal", filters: { dimension: "nether", type: null }, sort: "name" };
const r2 = loc.visibleLocations(all, ui2);
check(r2.every(l => l.dimension === "nether"), "search respects the active filter");
check(r2.length > 0 && r2.length < loc.searchLocations(all, "portal").length, "filter narrows the search result");

console.log("\n=== mutations ===");
const n0 = L().length;
store.commitLocation({ ...base, id: null, name: "Ancient Debris", dimension: "nether",
                       x: -212, y: 14, z: 88, type: "mine", tags: ["debris"] });
eq(L().length, n0 + 1, "commit adds a location");
const added = L().find(l => l.name === "Ancient Debris");
check(added && added.id && added.createdAt && added.updatedAt, "added row gets id + timestamps");
check(added.x === -212 && added.y === 14, "negative coordinate stored correctly");
store.commitLocation({ ...added, name: "Ancient Debris Vein" });
eq(L().length, n0 + 1, "edit does not duplicate");
eq(L().find(l => l.id === added.id).name, "Ancient Debris Vein", "edit applies");
eq(L().find(l => l.id === added.id).createdAt, added.createdAt, "createdAt is preserved on edit");
store.toggleFavorite(added.id);
eq(L().find(l => l.id === added.id).favorite, true, "toggleFavorite works");

eq(L().find(l => l.id === "loc_014").linkedPortalId, "loc_015", "pair linked before delete");
store.deleteLocation("loc_015");
eq(L().find(l => l.id === "loc_014").linkedPortalId, null, "V15 deleting B clears A's link (no dangle)");
check(!L().some(l => l.id === "loc_015"), "V15 deleted row is gone");
eq(store.deleteLocation("does-not-exist"), null, "deleting a missing id is a no-op");

console.log("\n=== persistence round trip (the Phase 3 gate) ===");
const disk = new Map();
dom = installDOM({ store: disk });
await reload(store, SEED);
eq(L().length, 15, "first run seeds 15 locations");
store.commitLocation({ ...base, id: null, name: "Persisted Point", dimension: "end", x: 5, y: 70, z: -9 });
await store.flush();
check(disk.has("blockbook.data"), "data written to localStorage");

// "close the browser and reopen": memory discarded, storage survives
await reload(store, SEED);
eq(L().length, 16, "reopened with 16 locations");
const persisted = L().find(l => l.name === "Persisted Point");
check(Boolean(persisted), "the added location survived a full reload");
check(persisted?.x === 5 && persisted?.y === 70 && persisted?.z === -9, "its coordinates are intact");
eq(persisted?.dimension, "end", "its dimension is intact");
eq(L().find(l => l.id === "loc_014")?.linkedPortalId, "loc_015", "portal links survive, still symmetric");
eq(L().find(l => l.id === "loc_015")?.linkedPortalId, "loc_014", "  ...both sides");

console.log("\n=== corrupt / hostile storage (docs 02 §8) ===");
const bad = new Map([["blockbook.data", "{ this is not json"]]);
installDOM({ store: bad });
let res = await reload(store, SEED);
eq(L().length, 15, "unparseable data falls back to seed");
check([...bad.keys()].some(k => k.startsWith("blockbook.data.corrupt-")), "corrupt data QUARANTINED, not discarded");
eq(bad.get([...bad.keys()].find(k => k.includes("corrupt"))), "{ this is not json", "quarantined copy is byte-identical");
check(res.notice !== null, "a banner explains what happened");

const newer = new Map([["blockbook.data", JSON.stringify({ app: "blockbook", schemaVersion: 99, worlds: [], settings: {} })]]);
installDOM({ store: newer });
res = await reload(store, SEED);
eq(store.state.fatal, true, "S3 newer schema -> fatal, refuses to load");
eq(store.state.data, null, "S3 no data loaded");
await store.writeNow();
check(newer.get("blockbook.data").includes('"schemaVersion":99'), "S3 newer-schema file is NOT overwritten");

const foreign = new Map([["blockbook.data", JSON.stringify({ app: "some-other-app", data: 1 })]]);
installDOM({ store: foreign });
await reload(store, SEED);
eq(L().length, 15, "foreign JSON falls back to seed");
check([...foreign.keys()].some(k => k.includes("corrupt")), "foreign JSON quarantined too");

console.log("\n=== escaping in rendered cards ===");
installDOM();
await reload(store, SEED);
store.commitLocation({ ...base, id: null, name: '<img src=x onerror=alert(1)>', dimension: "overworld",
                       x: 1, y: 1, z: 1, tags: ["<b>evil"] });
const cardsHTML = L().map(views.cardHTML).join("");
check(!cardsHTML.includes("<img src=x"), "hostile name is escaped in the card");
check(!/<b>evil/.test(cardsHTML), "hostile tag is escaped");
check(util.esc("&").includes("amp"), "esc handles ampersands");

done();
