import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(process.argv[2], "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeSandbox(store = new Map()) {
  const els = {};
  const mkEl = (id) => (els[id] ??= { id, _html: "", value: "", files: [], focus(){}, click(){},
    get innerHTML(){return this._html;}, set innerHTML(v){this._html=v;} });
  const sb = {
    els, store, performance, setTimeout, clearTimeout,
    crypto: { randomUUID: () => "id_" + Math.random().toString(36).slice(2, 10) },
    console: { log(){}, warn(){}, error(...a){ console.error(...a); } },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    document: { documentElement: { dataset: {} }, activeElement: null,
                getElementById: mkEl, querySelector: () => null,
                createElement: () => ({ style: {}, remove(){}, click(){}, select(){} }),
                body: { appendChild(){} }, addEventListener: () => {} },
    window: { addEventListener: () => {} },
  };
  vm.createContext(sb);
  vm.runInContext(script + `
;globalThis.__x = { state, activeLocations, parseLine, guessDimension, guessType,
  buildImportRows, validateImportPayload, mergeLocations, tpCommand, exportFilename,
  exportPayload, commitJsonImport, commitTextImport, backupNow, normaliseLocation,
  repairPortalLinks, DIMENSIONS, STORAGE_KEY, SCHEMA_VERSION, importReviewModalHTML,
  render, flush, commitLocation };`, sb);
  return sb;
}

let fails = 0;
const check = (ok, msg) => { console.log((ok ? "PASS  " : "FAIL  ") + msg); if (!ok) fails++; };
const eq = (a, b, m) => check(a === b, `${m}${a === b ? "" : `  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);

const sb = makeSandbox();
const X = sb.__x;

console.log("=== parseLine ===");
let p = X.parseLine("Home - 221/65/374");
eq(p.coords.length, 1, "I1 one coordinate");
eq(p.label, "Home", "I1 label strips the dangling dash");
eq(p.coords[0].x, 221, "I1 x");  eq(p.coords[0].y, 65, "I1 y");  eq(p.coords[0].z, 374, "I1 z");

p = X.parseLine("2411 22 -326");
eq(p.coords.length, 1, "space-separated triple parses");
eq(p.coords[0].z, -326, "negative z parses");

p = X.parseLine("Portal 631/67/245 ---- -495/66/-394");
eq(p.coords.length, 2, "I3 TWO coordinates on one line");
eq(p.label, "Portal", "I3 separator noise stripped from the label");
eq(p.coords[0].x, 631, "I3 first coord");
eq(p.coords[1].x, -495, "I3 second coord (negative)");

eq(X.parseLine("no numbers here").coords.length, 0, "I4 line with no coordinates");
eq(X.parseLine("spider spawner 91/-13/200").coords[0].y, -13, "negative Y parses");

console.log("\n=== guessDimension (docs 07 §6.3) ===");
eq(X.guessDimension({ y: -13, label: "spider spawner" }).d, "overworld", "I5 Y<0 -> overworld");
check(X.guessDimension({ y: -13, label: "spider spawner" }).confident, "I5 ...and it is CONFIDENT");
eq(X.guessDimension({ y: 200, label: "x" }).d, "overworld", "Y>127 -> overworld (impossible in nether)");
eq(X.guessDimension({ y: 64, label: "nether hub" }).d, "nether", "I6 keyword -> nether");
check(!X.guessDimension({ y: 64, label: "nether hub" }).confident, "I6 ...but NOT confident");
eq(X.guessDimension({ y: 50, label: "cave" }).d, null, "I7 unknowable -> null, forces a choice");
eq(X.guessDimension({ y: 64, label: "stronghold" }).d, "end", "end keyword");
eq(X.guessDimension({ y: 200, label: "nether hub" }).d, "overworld",
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
const built = X.buildImportRows(TEXT);
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
eq(X.buildImportRows("").rows.length, 0, "empty text -> no rows");

console.log("\n=== I8: review screen blocks on an unset dimension (ADR-007) ===");
sb.__x.state.ui.import = built;
sb.__x.state.ui.modal = "import-review";
let review = X.importReviewModalHTML();
check(review.includes("still need a dimension"), "I8 warns that rows need a dimension");
check(/data-act="commit-text-import"[^>]*disabled/.test(review), "I8 Import button is DISABLED");
check(review.includes("Verify every row"), "review screen tells the user to verify");
check(review.includes('sup class="guessed"'), "guessed dimensions are visually flagged");

// resolve every checked row, then it should unlock
for (const r of built.rows) if (r.checked) r.dimension ??= "overworld";
review = X.importReviewModalHTML();
check(!/data-act="commit-text-import"[^>]*disabled/.test(review), "I8 unlocks once every checked row has a dimension");

console.log("\n=== I9/I10/I11: committing a text import ===");
const sbT = makeSandbox(); const T = sbT.__x;
const before = T.activeLocations().length;
const rowsT = T.buildImportRows(TEXT).rows;
for (const r of rowsT) if (r.checked) r.dimension ??= "overworld";
const n = T.commitTextImport(rowsT);
eq(n, 4, "4 checked rows imported (the unnamed one stays out)");
eq(T.activeLocations().length, before + 4, "I9 import APPENDS — existing rows untouched");
check(T.activeLocations().some(l => l.id === "loc_001"), "I9 original seed rows still present");
check([...sbT.store.keys()].some(k => k.includes("backup-before-text-import")),
      "I10 a backup was written first");
const imported = T.activeLocations().find(l => l.name === "Portal (1)");
check(imported.notes.includes('631/67/245'), "imported rows record their source line");
check(imported.tags.includes("imported"), "imported rows are tagged");

// I11 — cancel changes nothing
const sbC = makeSandbox(); const C = sbC.__x;
const beforeC = C.activeLocations().length;
C.state.ui.import = C.buildImportRows(TEXT);
C.state.ui.modal = "import-review";
C.importReviewModalHTML();               // rendering the review must not commit
eq(C.activeLocations().length, beforeC, "I11 rendering the review screen changes nothing");
eq(sbC.store.size, 0, "I11 ...and writes nothing");

console.log("\n=== export payload ===");
const sbE = makeSandbox(); const E = sbE.__x;
const payload = E.exportPayload();
check(payload.includes("\n  "), "export is pretty-printed with a 2-space indent");
const parsed = JSON.parse(payload);
eq(parsed.app, "blockbook", "export carries the app marker");
eq(parsed.schemaVersion, 1, "export carries schemaVersion");
eq(parsed.worlds[0].locations.length, 15, "export contains all 15 locations");
check(/^blockbook-\d{4}-\d{2}-\d{2}\.json$/.test(E.exportFilename(new Date("2026-08-14T00:00:00Z"))),
      "filename is blockbook-YYYY-MM-DD.json");
eq(E.exportFilename(new Date(2026, 7, 4)), "blockbook-2026-08-04.json", "single digits are zero-padded");

console.log("\n=== import payload validation (nothing touches state first) ===");
const bad = [
  [null, "null"],
  ["a string", "a bare string"],
  [{}, "object with no app marker"],
  [{ app: "other" }, "a different app's file"],
  [{ app: "blockbook", schemaVersion: 99, worlds: [{ locations: [] }] }, "a newer schema"],
  [{ app: "blockbook", schemaVersion: 1 }, "no worlds"],
  [{ app: "blockbook", schemaVersion: 1, worlds: [{}] }, "no locations array"],
];
for (const [obj, label] of bad) {
  const v = X.validateImportPayload(obj);
  check(v.ok === false && typeof v.error === "string", `rejects ${label}`);
}
check(X.validateImportPayload(parsed).ok === true, "accepts a genuine export");
check(X.validateImportPayload({ app: "blockbook", schemaVersion: 99, worlds: [{ locations: [] }] })
       .error.includes("99"), "newer-schema error names the version");

console.log("\n=== merge semantics ===");
const a = [{ id: "1" }, { id: "2" }];
const m = X.mergeLocations(a, [{ id: "2" }, { id: "3" }]);
eq(m.added.length, 1, "merge adds only new ids");
eq(m.skipped.length, 1, "merge skips ids already present");
eq(m.added[0].id, "3", "the new one is added");

console.log("\n=== THE PHASE 5 GATE: export -> wipe -> import ===");
const sbG = makeSandbox(); const G = sbG.__x;
G.commitLocation({ id: null, name: "Netherite Stash", dimension: "nether", x: -212, y: 14, z: 88,
                   type: "mine", tags: ["debris"], notes: "", linkedPortalId: null, favorite: true });
G.flush();
const exported = G.exportPayload();
eq(JSON.parse(exported).worlds[0].locations.length, 16, "exported 16 locations");

// wipe: brand-new browser, empty storage
const sbW = makeSandbox(); const W = sbW.__x;
eq(W.activeLocations().length, 15, "fresh profile re-seeds to 15");
const v = W.validateImportPayload(JSON.parse(exported));
check(v.ok, "the export validates");
const res = W.commitJsonImport(v.locations, "replace");
eq(res.added, 16, "replace installed 16");
eq(W.activeLocations().length, 16, "GATE: all 16 locations restored");

const stash = W.activeLocations().find(l => l.name === "Netherite Stash");
check(Boolean(stash), "GATE: the added location came back");
eq(stash.x, -212, "  x intact");  eq(stash.y, 14, "  y intact");  eq(stash.z, 88, "  z intact");
eq(stash.dimension, "nether", "  dimension intact");
eq(stash.favorite, true, "  favourite flag intact");
eq(stash.tags.join(), "debris", "  tags intact");
eq(W.activeLocations().find(l => l.id === "loc_014")?.linkedPortalId, "loc_015",
   "GATE: portal link restored");
eq(W.activeLocations().find(l => l.id === "loc_015")?.linkedPortalId, "loc_014",
   "GATE: ...and it is still symmetric on both sides");
check([...sbW.store.keys()].some(k => k.includes("backup-before-replace")),
      "a backup was written before replacing");

// merge into a populated profile skips duplicates rather than doubling everything
const sbM = makeSandbox(); const M = sbM.__x;
const rM = M.commitJsonImport(JSON.parse(exported).worlds[0].locations, "merge");
eq(rM.skipped, 15, "merge skipped the 15 ids already present");
eq(rM.added, 1, "merge added only the genuinely new one");
eq(M.activeLocations().length, 16, "merge did not duplicate anything");

console.log("\n=== /tp command ===");
const home = X.activeLocations().find(l => l.id === "loc_001");
eq(X.tpCommand(home), "/tp 221 65 374", "tp command format");
eq(X.tpCommand({ x: 97, y: -19, z: 468 }), "/tp 97 -19 468", "negative coordinates");
eq(X.tpCommand({ x: 1, y: null, z: 2 }), "/tp 1 ~ 2", "null Y becomes ~ (current height), never 0");

console.log(`\n${fails === 0 ? "GATE PASSED" : "GATE FAILED — " + fails + " failure(s)"}`);
process.exit(fails === 0 ? 0 : 1);
