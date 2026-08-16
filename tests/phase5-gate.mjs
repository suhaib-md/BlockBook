/* Phase 5 gate — import / export + the Notepad importer. */
import { installDOM, makeChecker, seedLocations, reload } from "./harness.mjs";
installDOM();

const { check, eq, done } = makeChecker();
const loc   = await import("../src/locations.js");
const store = await import("../src/store.js");
const views = await import("../src/views.js");

const SEED = seedLocations();
await reload(store, SEED);

console.log("=== parseLine ===");
let p = loc.parseLine("Home - 221/65/374");
eq(p.coords.length, 1, "I1 one coordinate");
eq(p.label, "Home", "I1 label strips the dangling dash");
eq(p.coords[0].x, 221, "I1 x"); eq(p.coords[0].y, 65, "I1 y"); eq(p.coords[0].z, 374, "I1 z");

p = loc.parseLine("2411 22 -326");
eq(p.coords.length, 1, "space-separated triple parses");
eq(p.coords[0].z, -326, "negative z parses");

p = loc.parseLine("Portal 631/67/245 ---- -495/66/-394");
eq(p.coords.length, 2, "I3 TWO coordinates on one line");
eq(p.label, "Portal", "I3 separator noise stripped from the label");
eq(p.coords[0].x, 631, "I3 first coord");
eq(p.coords[1].x, -495, "I3 second coord (negative)");

eq(loc.parseLine("no numbers here").coords.length, 0, "I4 line with no coordinates");
eq(loc.parseLine("spider spawner 91/-13/200").coords[0].y, -13, "negative Y parses");

console.log("\n=== guessDimension (docs 07 §6.3) ===");
eq(loc.guessDimension({ y: -13, label: "spider spawner" }).d, "overworld", "I5 Y<0 -> overworld");
check(loc.guessDimension({ y: -13, label: "spider spawner" }).confident, "I5 ...and it is CONFIDENT");
eq(loc.guessDimension({ y: 200, label: "x" }).d, "overworld", "Y>127 -> overworld (impossible in nether)");
eq(loc.guessDimension({ y: 64, label: "nether hub" }).d, "nether", "I6 keyword -> nether");
check(!loc.guessDimension({ y: 64, label: "nether hub" }).confident, "I6 ...but NOT confident");
eq(loc.guessDimension({ y: 50, label: "cave" }).d, null, "I7 unknowable -> null, forces a choice");
eq(loc.guessDimension({ y: 64, label: "stronghold" }).d, "end", "end keyword");
eq(loc.guessDimension({ y: 200, label: "nether hub" }).d, "overworld",
   "Y outside 0..127 beats the 'nether' keyword — nether is impossible there");

console.log("\n=== buildImportRows ===");
const TEXT = [
  "Home - 221/65/374",
  "Portal 631/67/245 ---- -495/66/-394",
  "2411 22 -326",
  "no numbers here",
  "spider spawner 91/-13/200",
  "",
].join("\n");
const built = loc.buildImportRows(TEXT);
eq(built.rows.length, 5, "5 candidate rows from 5 usable coordinates");
eq(built.unrecognised.length, 1, "I4 unusable line collected separately");
eq(built.unrecognised[0], "no numbers here", "I4 ...verbatim");

const names = built.rows.map(r => r.name);
check(names.includes("Portal (1)") && names.includes("Portal (2)"),
      "I3 two coords on one line -> TWO rows, suffixed — NOT a pair");
eq(built.rows.filter(r => r.name.startsWith("Portal")).length, 2, "I3 ...exactly two");
const unnamed = built.rows.find(r => r.name === "(unnamed)");
check(Boolean(unnamed), "I2 unlabelled line becomes (unnamed)");
eq(unnamed.checked, false, "I2 ...and is UNCHECKED by default");
eq(built.rows.find(r => r.name === "Home").checked, true, "named rows are checked");
eq(built.rows.find(r => r.name === "Home").type, "base", "type guessed from the label");
eq(built.rows.find(r => r.name === "Portal (1)").type, "portal", "portal type guessed");
eq(built.rows.find(r => r.name.startsWith("spider")).dimension, "overworld", "I5 confident guess applied");
eq(built.rows.find(r => r.name === "Home").dimension, null, "Y=65 is unknowable -> null");
eq(loc.buildImportRows("").rows.length, 0, "empty text -> no rows");

console.log("\n=== I8: review screen blocks on an unset dimension (ADR-007) ===");
store.state.ui.import = built;
store.state.ui.modal = "import-review";
let review = views.importReviewModalHTML();
check(review.includes("still need a dimension"), "I8 warns that rows need a dimension");
check(/data-act="commit-text-import"[^>]*disabled/.test(review), "I8 Import button is DISABLED");
check(review.includes("Verify every row"), "review screen tells the user to verify");
check(review.includes('sup class="guessed"'), "guessed dimensions are visually flagged");
for (const r of built.rows) if (r.checked) r.dimension ??= "overworld";
review = views.importReviewModalHTML();
check(!/data-act="commit-text-import"[^>]*disabled/.test(review), "I8 unlocks once every checked row has a dimension");

console.log("\n=== I9/I10/I11: committing a text import ===");
const disk = new Map();
installDOM({ store: disk });
await reload(store, SEED);
const before = store.activeLocations().length;
const rowsT = loc.buildImportRows(TEXT).rows;
for (const r of rowsT) if (r.checked) r.dimension ??= "overworld";
eq(await store.commitTextImport(rowsT), 4, "4 checked rows imported (the unnamed one stays out)");
eq(store.activeLocations().length, before + 4, "I9 import APPENDS — existing rows untouched");
check(store.activeLocations().some(l => l.id === "loc_001"), "I9 original seed rows still present");
check([...disk.keys()].some(k => k.includes("backup-before-text-import")), "I10 a backup was written first");
const imported = store.activeLocations().find(l => l.name === "Portal (1)");
check(imported.notes.includes("631/67/245"), "imported rows record their source line");
check(imported.tags.includes("imported"), "imported rows are tagged");

const clean = new Map();
installDOM({ store: clean });
await reload(store, SEED);
const beforeC = store.activeLocations().length;
store.state.ui.import = loc.buildImportRows(TEXT);
views.importReviewModalHTML();
eq(store.activeLocations().length, beforeC, "I11 rendering the review screen changes nothing");
eq(clean.size, 0, "I11 ...and writes nothing");

console.log("\n=== export payload ===");
const payload = store.exportPayload();
check(payload.includes("\n  "), "export is pretty-printed with a 2-space indent");
const parsed = JSON.parse(payload);
eq(parsed.app, "blockbook", "export carries the app marker");
eq(parsed.schemaVersion, 1, "export carries schemaVersion");
eq(parsed.worlds[0].locations.length, 15, "export contains all 15 locations");
check(/^blockbook-\d{4}-\d{2}-\d{2}\.json$/.test(loc.exportFilename(new Date("2026-08-14T00:00:00Z"))),
      "filename is blockbook-YYYY-MM-DD.json");
eq(loc.exportFilename(new Date(2026, 7, 4)), "blockbook-2026-08-04.json", "single digits are zero-padded");

console.log("\n=== import payload validation (nothing touches state first) ===");
for (const [obj, label] of [
  [null, "null"], ["a string", "a bare string"], [{}, "object with no app marker"],
  [{ app: "other" }, "a different app's file"],
  [{ app: "blockbook", schemaVersion: 99, worlds: [{ locations: [] }] }, "a newer schema"],
  [{ app: "blockbook", schemaVersion: 1 }, "no worlds"],
  [{ app: "blockbook", schemaVersion: 1, worlds: [{}] }, "no locations array"],
]) {
  const v = loc.validateImportPayload(obj);
  check(v.ok === false && typeof v.error === "string", `rejects ${label}`);
}
check(loc.validateImportPayload(parsed).ok === true, "accepts a genuine export");
check(loc.validateImportPayload({ app: "blockbook", schemaVersion: 99, worlds: [{ locations: [] }] })
        .error.includes("99"), "newer-schema error names the version");

console.log("\n=== merge semantics ===");
const m = loc.mergeLocations([{ id: "1" }, { id: "2" }], [{ id: "2" }, { id: "3" }]);
eq(m.added.length, 1, "merge adds only new ids");
eq(m.skipped.length, 1, "merge skips ids already present");
eq(m.added[0].id, "3", "the new one is added");

console.log("\n=== THE PHASE 5 GATE: export -> wipe -> import ===");
const d1 = new Map();
installDOM({ store: d1 });
await reload(store, SEED);
store.commitLocation({ id: null, name: "Netherite Stash", dimension: "nether", x: -212, y: 14, z: 88,
                       type: "mine", tags: ["debris"], notes: "", linkedPortalId: null, favorite: true });
await store.flush();
const exported = store.exportPayload();
eq(JSON.parse(exported).worlds[0].locations.length, 16, "exported 16 locations");

const d2 = new Map();                 // brand-new profile, empty storage
installDOM({ store: d2 });
await reload(store, SEED);
eq(store.activeLocations().length, 15, "fresh profile re-seeds to 15");
const v = loc.validateImportPayload(JSON.parse(exported));
check(v.ok, "the export validates");
// Parens matter: `await x().added` would read .added off the Promise.
eq((await store.commitJsonImport(v.locations, "replace")).added, 16, "replace installed 16");
eq(store.activeLocations().length, 16, "GATE: all 16 locations restored");

const stash = store.activeLocations().find(l => l.name === "Netherite Stash");
check(Boolean(stash), "GATE: the added location came back");
eq(stash.x, -212, "  x intact"); eq(stash.y, 14, "  y intact"); eq(stash.z, 88, "  z intact");
eq(stash.dimension, "nether", "  dimension intact");
eq(stash.favorite, true, "  favourite flag intact");
eq(stash.tags.join(), "debris", "  tags intact");
eq(store.activeLocations().find(l => l.id === "loc_014")?.linkedPortalId, "loc_015", "GATE: portal link restored");
eq(store.activeLocations().find(l => l.id === "loc_015")?.linkedPortalId, "loc_014", "GATE: ...symmetric on both sides");
check([...d2.keys()].some(k => k.includes("backup-before-replace")), "a backup was written before replacing");

const d3 = new Map();
installDOM({ store: d3 });
await reload(store, SEED);
const rM = await store.commitJsonImport(JSON.parse(exported).worlds[0].locations, "merge");
eq(rM.skipped, 15, "merge skipped the 15 ids already present");
eq(rM.added, 1, "merge added only the genuinely new one");
eq(store.activeLocations().length, 16, "merge did not duplicate anything");

console.log("\n=== /tp command ===");
eq(loc.tpCommand({ x: 221, y: 65, z: 374 }), "/tp 221 65 374", "tp command format");
eq(loc.tpCommand({ x: 97, y: -19, z: 468 }), "/tp 97 -19 468", "negative coordinates");
eq(loc.tpCommand({ x: 1, y: null, z: 2 }), "/tp 1 ~ 2", "null Y becomes ~ (current height), never 0");

done();
