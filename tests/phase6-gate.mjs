/* Phase 6 gate — brewing tab + the generic reftable. */
import { installDOM, makeChecker, seedLocations, reload, readSrc, readJSON, stripComments } from "./harness.mjs";
installDOM();

const { check, eq, done } = makeChecker();
const rt    = await import("../src/reftable.js");
const brew  = await import("../src/brewing.js");
const store = await import("../src/store.js");
const views = await import("../src/views.js");
reload(store, seedLocations());

const B = brew.BREWING;

console.log("=== reftable has ZERO domain knowledge (docs 08 §4.2) ===");
const refCode = stripComments(readSrc("reftable.js"));
const forbidden = ["potion", "brewing", "nether wart", "ingredient", "enchant",
                   "mob", "villager", "fuel", "splash", "glowstone", "redstone"];
const leaked = forbidden.filter(w => new RegExp(w, "i").test(refCode));
check(leaked.length === 0, `no domain vocabulary in reftable${leaked.length ? " — LEAKED: " + leaked.join(", ") : ""}`);
check(!/BREWING/.test(refCode), "reftable never references the BREWING dataset");
check(!/from "\.\/(brewing|views|store|main)\.js"/.test(readSrc("reftable.js")),
      "reftable imports nothing domain-specific");

console.log("\n=== reftable generic behaviour ===");
const ROWS = [
  { id: "a", name: "Beta",  n: 2,  tags: ["x", "y"] },
  { id: "b", name: "Alpha", n: 10, tags: ["y"] },
  { id: "c", name: "Gamma", n: 1,  tags: ["z"] },
];
eq(rt.refSearch(ROWS, "alp", ["name"]).length, 1, "search matches a substring");
eq(rt.refSearch(ROWS, "", ["name"]).length, 3, "empty query returns everything");
eq(rt.refSearch(ROWS, "y", ["tags"]).length, 2, "search flattens array fields");
eq(rt.refSort(ROWS, "name", "asc")[0].name, "Alpha", "sort ascending by text");
eq(rt.refSort(ROWS, "name", "desc")[0].name, "Gamma", "sort descending by text");
eq(rt.refSort(ROWS, "n", "asc")[0].n, 1, "numeric columns sort numerically, not as strings");
eq(rt.refSort(ROWS, "n", "asc")[2].n, 10, "  ...10 sorts after 2");
eq(rt.refFilter(ROWS, [{ key: "tags" }], { tags: "y" }).length, 2, "filter matches inside arrays");
eq(rt.refFilter(ROWS, [{ key: "tags" }], {}).length, 3, "no active filter passes everything");
eq(rt.refCell({ tags: ["a", "b"] }, "tags"), "a b", "refCell flattens arrays");
eq(rt.refCell({}, "missing"), "", "refCell of a missing key is empty, not undefined");

const cfg = {
  id: "t", rows: ROWS, searchKeys: ["name"],
  columns: [{ key: "name", label: "Name" }, { key: "n", label: "N", align: "right" }],
  detail: r => `<em>${r.name}</em>`,
};
let out = rt.refTableHTML(cfg, { search: "", sortKey: "name", sortDir: "asc", filters: {}, selectedId: null });
check(out.includes("Alpha") && out.includes("Gamma"), "renders all rows");
check(!out.includes("<em>"), "detail is hidden until a row is selected");
out = rt.refTableHTML(cfg, { search: "", sortKey: "name", sortDir: "asc", filters: {}, selectedId: "b" });
check(out.includes("<em>Alpha</em>"), "detail shows for the selected row");
out = rt.refTableHTML(cfg, { search: "zzz", sortKey: null, sortDir: "asc", filters: {}, selectedId: null });
check(out.includes("No match"), "empty state when nothing matches");

console.log("\n=== durations ===");
eq(brew.parseDuration("3:00"), 180, "parse 3:00");
eq(brew.parseDuration("0:45"), 45, "parse 0:45");
eq(brew.parseDuration("instant"), null, "instant has no numeric duration");
eq(brew.parseDuration(""), null, "empty parses to null");
eq(brew.formatDuration(135), "2:15", "format 135s");
eq(brew.formatDuration(360), "6:00", "format 360s");
eq(brew.scaleDuration("3:00", 0.75), "2:15", "splash = 3/4 of 3:00");
eq(brew.scaleDuration("8:00", 0.75), "6:00", "splash of extended 8:00 = 6:00");
eq(brew.scaleDuration("3:00", 0.25), "0:45", "lingering = 1/4 of 3:00");
eq(brew.scaleDuration("instant", 0.75), "instant", "scaling instant leaves it alone");

console.log("\n=== brewing data integrity ===");
const onDisk = readJSON("data/brewing.json");
eq(B.verified, onDisk.verified, "inline `verified` matches data/brewing.json");
eq(B.gameVersion, onDisk.gameVersion, "inline `gameVersion` matches data/brewing.json");
eq(B.entries.length, onDisk.entries.length, "inline potion count matches data/brewing.json");
check(B.entries.every((e, i) => e.id === onDisk.entries[i].id), "potion ids match in the same order");
check(B.entries.every((e, i) => e.baseDuration === onDisk.entries[i].baseDuration),
      "base durations match between the two copies");
check(typeof B.verified === "boolean", "verified is a boolean");
check(B.entries.length >= 19, `${B.entries.length} potions present`);
eq(B.bases.length, 4, "4 bases");
eq(B.modifiers.length, 5, "5 modifiers");
eq(B.corruptions.length, 9, "9 corruption pairs");
check(B.entries.every(e => e.id && e.name && e.effect && e.ingredient), "every potion has the core fields");
check(B.entries.every(e => e.ingredientSource), "every potion has ingredientSource (drives reverse lookup)");
check(new Set(B.entries.map(e => e.id)).size === B.entries.length, "potion ids unique");
check(B.entries.every(e => ["water", "awkward"].includes(e.base)), "every potion is based on water or awkward");
check(B.entries.filter(e => e.baseDuration === "instant").every(e => e.extended === null),
      "instant potions have extended: null (Redstone does nothing)");
for (const id of ["fire_resistance", "night_vision", "invisibility", "water_breathing", "slow_falling", "weakness"]) {
  const e = B.entries.find(x => x.id === id);
  check(e && e.amplified === null, `${id} has amplified: null (no level II exists)`);
}
const ids = new Set(B.entries.map(e => e.id));
check(B.entries.filter(e => e.corruptsTo).every(e => ids.has(e.corruptsTo)), "every corruptsTo resolves to a real potion");
check(B.corruptions.every(c => ids.has(c.to)), "every corruption target resolves");

console.log("\n=== potionChain ===");
const fr = B.entries.find(e => e.id === "fire_resistance");
const chain = brew.potionChain(fr, B);
eq(chain.steps.length, 2, "awkward-based potion has a 2-step spine");
eq(chain.steps[0].add, "Nether Wart", "step 1 is water + nether wart");
eq(chain.steps[0].out, "Awkward Potion", "  -> Awkward Potion");
eq(chain.steps[1].add, "Magma Cream", "step 2 adds the ingredient");
eq(chain.steps[1].duration, "3:00", "  base duration carried");
const kinds = chain.variants.map(v => v.kind);
check(kinds.includes("extended"), "extended variant present");
check(!kinds.includes("amplified"), "no level II offered for fire resistance");
check(kinds.includes("splash") && kinds.includes("lingering"), "splash and lingering offered");
eq(chain.variants.find(v => v.kind === "splash").duration, "2:15", "splash duration computed from base");
eq(chain.variants.find(v => v.kind === "splash").note, "6:00 if extended first", "splash notes the extended figure too");

const weakness = B.entries.find(e => e.id === "weakness");
eq(brew.potionChain(weakness, B).steps.length, 1, "water-based potion has a 1-step spine");
eq(brew.potionChain(weakness, B).steps[0].input, "Water Bottle", "  ...straight from water");
const healing = B.entries.find(e => e.id === "healing");
check(!brew.potionChain(healing, B).variants.some(v => v.kind === "extended"), "instant potion offers no extension");
eq(brew.potionChain(healing, B).corrupt?.id, "harming", "healing corrupts to harming");

console.log("\n=== reverse lookup: 'I have X' ===");
let r = brew.whatCanIBrew("magma", B);
eq(r.asIngredient.length, 1, "'magma' matches one potion by ingredient");
eq(r.asIngredient[0].id, "fire_resistance", "GATE: magma cream -> Fire Resistance");
r = brew.whatCanIBrew("gold", B);
const goldHits = [...r.asIngredient, ...r.asSource].map(e => e.id);
check(goldHits.includes("night_vision"), "'gold' finds Night Vision (via the Golden Carrot ingredient)");
check(goldHits.includes("healing"), "'gold' finds Healing (via ingredientSource — gold nuggets)");
check(r.asSource.length >= 1, "  ...ingredientSource genuinely contributes hits");
eq(brew.whatCanIBrew("gunpowder", B).asModifier.length, 1, "'gunpowder' matches a modifier");
check(brew.whatCanIBrew("nether wart", B).asBase.length >= 1, "'nether wart' matches the Awkward base");
r = brew.whatCanIBrew("blaze", B);
check(r.asIngredient.some(e => e.id === "strength"), "'blaze' -> Strength via ingredient");
check(!r.asSource.some(e => e.id === "strength"), "  ...and is not double-listed under source");
eq(brew.whatCanIBrew("", B).asIngredient.length, 0, "empty query returns nothing");
r = brew.whatCanIBrew("zzzz", B);
eq(r.asIngredient.length + r.asModifier.length + r.asSource.length + r.asBase.length, 0, "no match -> all empty");

console.log("\n=== THE GATE: 'how do I make splash Fire Resistance?' ===");
const detail = brew.chainHTML(fr);
check(detail.includes("Water Bottle"), "answer shows the starting item");
check(detail.includes("Nether Wart"), "answer shows the nether wart step");
check(detail.includes("Magma Cream"), "answer shows the ingredient");
check(detail.includes("Gunpowder"), "answer shows Gunpowder for splash");
check(detail.includes("Splash Potion of Fire Resistance"), "answer names the splash result");
check(detail.includes("2:15"), "answer gives the splash duration");
check(/blaze powder \+ slimeball|magma cube/.test(detail), "answer says where to get the ingredient");
check(detail.includes("no level II"), "answer states the level II gap honestly");

console.log("\n=== brewing panel wiring ===");
const ui = { search: "", sortKey: "name", sortDir: "asc", filters: {}, selectedId: null };
let panel = brew.brewingPanelHTML(ui, "");
check(panel.includes("unverified") === !B.verified,
      `the unverified banner shows exactly when verified is false (verified=${B.verified})`);
check(panel.includes("Fire Resistance"), "potion table rendered");
check(panel.includes("I have"), "reverse lookup present");
check(panel.includes("Fermented Spider Eye corrupts"), "corruption table in the persistent footer");
check(panel.includes("Redstone Dust"), "modifier table in the persistent footer");
check(/Dragon&#39;s Breath|Dragon's Breath/.test(panel), "lingering modifier documented");

panel = brew.brewingPanelHTML({ ...ui, search: "fire res" }, "");
check(panel.includes("Fire Resistance"), "table search finds fire resistance");
check(!panel.includes("Potion of Swiftness"), "  ...and filters the rest out");
check(brew.brewingPanelHTML({ ...ui, selectedId: "fire_resistance" }, "").includes("Gunpowder"),
      "selecting a row expands its chain");
check(brew.reverseLookupHTML("magma").includes("Fire Resistance"), "GATE: typing 'magma' surfaces Fire Resistance");

console.log("\n=== offline: no network anywhere in the app ===");
for (const f of ["util.js", "schema.js", "portals.js", "reftable.js", "locations.js",
                 "brewing.js", "store.js", "views.js"]) {
  const code = stripComments(readSrc(f));
  const found = ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"]
    .filter(api => code.includes(api));
  check(found.length === 0, `${f}: no network APIs${found.length ? " — found " + found : ""}`);
}
// main.js legitimately fetches ONE thing: the bundled seed, same-origin.
const mainCode = stripComments(readSrc("main.js"));
const fetches = [...mainCode.matchAll(/fetch\(([^)]*)\)/g)].map(m => m[1].trim());
eq(fetches.length, 1, "main.js has exactly one fetch");
check(/^"\.\/[\w.-]+"$/.test(fetches[0]), `  ...and it is a relative same-origin path (${fetches[0]})`);
check(!/https?:\/\//.test(stripComments(readSrc("style.css"))), "no external URLs in the stylesheet");

done();
