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
;globalThis.__x = { state, BREWING, potionChain, whatCanIBrew, parseDuration,
  formatDuration, scaleDuration, refTableHTML, refSearch, refSort, refFilter, refCell,
  chainHTML, brewingPanelHTML, reverseLookupHTML, brewingFooterHTML, render,
  refSlice, LOCATION_TYPES };`, sb);
  return sb;
}

let fails = 0;
const check = (ok, msg) => { console.log((ok ? "PASS  " : "FAIL  ") + msg); if (!ok) fails++; };
const eq = (a, b, m) => check(a === b, `${m}${a === b ? "" : `  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);

const sb = makeSandbox();
const X = sb.__x;
const B = X.BREWING;

console.log("=== reftable has ZERO domain knowledge (docs 08 §4.2) ===");
// Extract the reftable region straight out of the file and prove no potion,
// enchantment or mob vocabulary leaks into the generic renderer.
const refRegion = script.slice(
  script.indexOf("REFTABLE — the ONE generic"),
  script.indexOf("DURATIONS — docs/08-REFERENCE-DATA.md")
);
check(refRegion.length > 500, "reftable region located in the source");
// The slice starts inside a block comment, so the opening /* is behind us:
// drop everything up to the first */ before stripping the rest.
const refCode = refRegion
  .replace(/^[\s\S]*?\*\//, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");
const forbidden = ["potion", "brewing", "nether wart", "ingredient", "enchant",
                   "mob", "villager", "fuel", "splash", "glowstone", "redstone"];
const leaked = forbidden.filter(w => new RegExp(w, "i").test(refCode));
check(leaked.length === 0,
      `no domain vocabulary in reftable${leaked.length ? " — LEAKED: " + leaked.join(", ") : ""}`);
check(!/BREWING/.test(refRegion), "reftable never references the BREWING dataset");

console.log("\n=== reftable generic behaviour ===");
const ROWS = [
  { id: "a", name: "Beta",  n: 2, tags: ["x", "y"] },
  { id: "b", name: "Alpha", n: 10, tags: ["y"] },
  { id: "c", name: "Gamma", n: 1, tags: ["z"] },
];
eq(X.refSearch(ROWS, "alp", ["name"]).length, 1, "search matches a substring");
eq(X.refSearch(ROWS, "", ["name"]).length, 3, "empty query returns everything");
eq(X.refSearch(ROWS, "y", ["tags"]).length, 2, "search flattens array fields");
eq(X.refSort(ROWS, "name", "asc")[0].name, "Alpha", "sort ascending by text");
eq(X.refSort(ROWS, "name", "desc")[0].name, "Gamma", "sort descending by text");
eq(X.refSort(ROWS, "n", "asc")[0].n, 1, "numeric columns sort numerically, not as strings");
eq(X.refSort(ROWS, "n", "asc")[2].n, 10, "  ...10 sorts after 2");
eq(X.refFilter(ROWS, [{ key: "tags" }], { tags: "y" }).length, 2, "filter matches inside arrays");
eq(X.refFilter(ROWS, [{ key: "tags" }], {}).length, 3, "no active filter passes everything");
eq(X.refCell({ tags: ["a", "b"] }, "tags"), "a b", "refCell flattens arrays");
eq(X.refCell({}, "missing"), "", "refCell of a missing key is empty, not undefined");

const genericCfg = {
  id: "t", rows: ROWS, searchKeys: ["name"],
  columns: [{ key: "name", label: "Name" }, { key: "n", label: "N", align: "right" }],
  detail: r => `<em>${r.name}</em>`,
};
let out = X.refTableHTML(genericCfg, { search: "", sortKey: "name", sortDir: "asc", filters: {}, selectedId: null });
check(out.includes("Alpha") && out.includes("Gamma"), "renders all rows");
check(!out.includes("<em>"), "detail is hidden until a row is selected");
out = X.refTableHTML(genericCfg, { search: "", sortKey: "name", sortDir: "asc", filters: {}, selectedId: "b" });
check(out.includes("<em>Alpha</em>"), "detail shows for the selected row");
out = X.refTableHTML(genericCfg, { search: "zzz", sortKey: null, sortDir: "asc", filters: {}, selectedId: null });
check(out.includes("No match"), "empty state when nothing matches");

console.log("\n=== durations ===");
eq(X.parseDuration("3:00"), 180, "parse 3:00");
eq(X.parseDuration("0:45"), 45, "parse 0:45");
eq(X.parseDuration("instant"), null, "instant has no numeric duration");
eq(X.parseDuration(""), null, "empty parses to null");
eq(X.formatDuration(135), "2:15", "format 135s");
eq(X.formatDuration(360), "6:00", "format 360s");
eq(X.scaleDuration("3:00", 0.75), "2:15", "splash = 3/4 of 3:00");
eq(X.scaleDuration("8:00", 0.75), "6:00", "splash of extended 8:00 = 6:00");
eq(X.scaleDuration("3:00", 0.25), "0:45", "lingering = 1/4 of 3:00");
eq(X.scaleDuration("instant", 0.75), "instant", "scaling instant leaves it alone");

console.log("\n=== brewing data integrity ===");
eq(B.verified, false, "verified is FALSE — durations not checked against a real game");
check(B.entries.length >= 19, `${B.entries.length} potions present`);
check(B.bases.length === 4, "4 bases");
check(B.modifiers.length === 5, "5 modifiers");
check(B.corruptions.length === 9, "9 corruption pairs");
check(B.entries.every(e => e.id && e.name && e.effect && e.ingredient), "every potion has the core fields");
check(B.entries.every(e => e.ingredientSource), "every potion has ingredientSource (drives reverse lookup)");
check(new Set(B.entries.map(e => e.id)).size === B.entries.length, "potion ids unique");
check(B.entries.every(e => ["water", "awkward"].includes(e.base)), "every potion is based on water or awkward");
// instant potions must not claim an extension; no-level-II potions must not claim one
check(B.entries.filter(e => e.baseDuration === "instant").every(e => e.extended === null),
      "instant potions have extended: null (Redstone does nothing)");
for (const id of ["fire_resistance", "night_vision", "invisibility", "water_breathing", "slow_falling", "weakness"]) {
  const e = B.entries.find(x => x.id === id);
  check(e && e.amplified === null, `${id} has amplified: null (no level II exists)`);
}
// corruption targets must resolve
const ids = new Set(B.entries.map(e => e.id));
check(B.entries.filter(e => e.corruptsTo).every(e => ids.has(e.corruptsTo)), "every corruptsTo resolves to a real potion");
check(B.corruptions.every(c => ids.has(c.to)), "every corruption target resolves");

console.log("\n=== potionChain ===");
const fr = B.entries.find(e => e.id === "fire_resistance");
const chain = X.potionChain(fr, B);
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
eq(chain.variants.find(v => v.kind === "splash").note, "6:00 if extended first",
   "splash notes the extended figure too");

const weakness = B.entries.find(e => e.id === "weakness");
eq(X.potionChain(weakness, B).steps.length, 1, "water-based potion has a 1-step spine");
eq(X.potionChain(weakness, B).steps[0].input, "Water Bottle", "  ...straight from water");

const healing = B.entries.find(e => e.id === "healing");
check(!X.potionChain(healing, B).variants.some(v => v.kind === "extended"),
      "instant potion offers no extension");
eq(X.potionChain(healing, B).corrupt?.id, "harming", "healing corrupts to harming");

console.log("\n=== reverse lookup: 'I have X' ===");
let r = X.whatCanIBrew("magma", B);
eq(r.asIngredient.length, 1, "'magma' matches one potion by ingredient");
eq(r.asIngredient[0].id, "fire_resistance", "GATE: magma cream -> Fire Resistance");
r = X.whatCanIBrew("gold", B);
// "gold" reaches Night Vision through its INGREDIENT (Golden Carrot) and Healing
// through its SOURCE (melon + gold nuggets). Both routes matter; check the union.
const goldHits = [...r.asIngredient, ...r.asSource].map(e => e.id);
check(goldHits.includes("night_vision"), "'gold' finds Night Vision (via the Golden Carrot ingredient)");
check(goldHits.includes("healing"), "'gold' finds Healing (via ingredientSource — gold nuggets)");
check(r.asSource.length >= 1, "  ...ingredientSource genuinely contributes hits");
r = X.whatCanIBrew("gunpowder", B);
eq(r.asModifier.length, 1, "'gunpowder' matches a modifier");
r = X.whatCanIBrew("nether wart", B);
check(r.asBase.length >= 1, "'nether wart' matches the Awkward base");
r = X.whatCanIBrew("blaze", B);
check(r.asIngredient.some(e => e.id === "strength"), "'blaze' -> Strength via ingredient");
check(!r.asSource.some(e => e.id === "strength"), "  ...and is not double-listed under source");
r = X.whatCanIBrew("", B);
eq(r.asIngredient.length, 0, "empty query returns nothing");
r = X.whatCanIBrew("zzzz", B);
eq(r.asIngredient.length + r.asModifier.length + r.asSource.length + r.asBase.length, 0, "no match -> all empty");

console.log("\n=== THE GATE: 'how do I make splash Fire Resistance?' ===");
const detail = X.chainHTML(fr);
check(detail.includes("Water Bottle"), "answer shows the starting item");
check(detail.includes("Nether Wart"), "answer shows the nether wart step");
check(detail.includes("Magma Cream"), "answer shows the ingredient");
check(detail.includes("Gunpowder"), "answer shows Gunpowder for splash");
check(detail.includes("Splash Potion of Fire Resistance"), "answer names the splash result");
check(detail.includes("2:15"), "answer gives the splash duration");
check(detail.includes("blaze powder + slimeball") || detail.includes("magma cube"),
      "answer says where to get the ingredient");
check(detail.includes("no level II"), "answer states the level II gap honestly");

console.log("\n=== brewing panel wiring ===");
sb.__x.state.ui.activeTab = "brewing";
const panel = X.brewingPanelHTML();
check(panel.includes("unverified"), "unverified durations are flagged in the UI");
check(panel.includes("Fire Resistance"), "potion table rendered");
check(panel.includes("I have"), "reverse lookup present");
check(panel.includes("Fermented Spider Eye corrupts"), "corruption table in the persistent footer");
check(panel.includes("Redstone Dust"), "modifier table in the persistent footer");
// Apostrophes are HTML-escaped on the way out, so match the name without one.
check(/Dragon&#39;s Breath|Dragon's Breath/.test(panel), "lingering modifier documented");

sb.__x.state.ui.ref.brewing.search = "fire res";
check(X.brewingPanelHTML().includes("Fire Resistance"), "table search finds fire resistance");
check(!X.brewingPanelHTML().includes("Potion of Swiftness"), "  ...and filters the rest out");
sb.__x.state.ui.ref.brewing.search = "";

sb.__x.state.ui.ref.brewing.selectedId = "fire_resistance";
check(X.brewingPanelHTML().includes("Gunpowder"), "selecting a row expands its chain");

sb.__x.state.ui.brewHave = "magma";
check(X.reverseLookupHTML().includes("Fire Resistance"), "GATE: typing 'magma' surfaces Fire Resistance");

console.log("\n=== offline: no network anywhere in the app ===");
const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
for (const api of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"]) {
  check(!code.includes(api), `no ${api} in the app`);
}
check(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "")),
      "no external URLs in markup or styles");

console.log(`\n${fails === 0 ? "GATE PASSED" : "GATE FAILED — " + fails + " failure(s)"}`);
process.exit(fails === 0 ? 0 : 1);
