import { readFileSync } from "node:fs";
import vm from "node:vm";

const path = process.argv[2];
const html = readFileSync(path, "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- minimal DOM stub: captures innerHTML per element id ----
const els = {};
const mkEl = (id) => (els[id] ??= { id, _html: "", focus() {},
  get innerHTML() { return this._html; },
  set innerHTML(v) { this._html = v; } });

const store = new Map();
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: (...a) => console.error(...a) },
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
vm.runInContext(script + `
;globalThis.__x = { state, activeLocations, render, sortLocations, SORTERS,
                    TYPE_ICONS, LOCATION_TYPES, DIM_LABEL, esc, coordHTML };`, sandbox);
const X = sandbox.__x;

let fails = 0;
const check = (ok, msg) => { console.log((ok ? "PASS  " : "FAIL  ") + msg); if (!ok) fails++; };

// ============ static checks on the file ============
console.log("=== tokens & structure ===");
const cssRaw = html.match(/<style>([\s\S]*?)<\/style>/)[1];
// Strip CSS comments — prose about !important is not a use of !important.
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");
for (const t of ["--bg-0","--fg-0","--ow","--nether","--end","--ok","--warn","--bad","--info",
                 "--font-mono","--fs-md","--s-4","--r-md"]) {
  if (!css.includes(t + ":")) { check(false, `token ${t} declared`); }
}
check(css.includes("--bg-0:"), "design tokens declared at :root");
check(css.includes('[data-theme="light"]'), "light theme tokens present");
check(/\.coord\s*\{[^}]*--font-mono/.test(css), "coordinates use --font-mono (digits align)");
check(/font-variant-numeric:\s*tabular-nums/.test(css), "tabular numerals for column alignment");
check(/\.badge\.overworld[^}]*--ow\b/.test(css), "overworld badge uses --ow (green)");
check(/\.badge\.nether[^}]*--nether\b/.test(css), "nether badge uses --nether (red)");
check(/\.badge\.end[^}]*--end\b/.test(css), "end badge uses --end (purple)");
check(/prefers-reduced-motion/.test(css), "reduced-motion honoured");
check(/prefers-reduced-motion[\s\S]*?--motion-hover:\s*0ms/.test(css),
      "reduced-motion zeroes the motion tokens");
check(!/!important/.test(css), "no !important in stylesheet (UIUX §7)");
check(!/transition:[^;]*\d+ms/.test(css), "no hard-coded durations — all via --motion-* tokens");

// pure fence must stay pure
// The START/END markers live INSIDE comment blocks, so the captured region
// begins with the tail of one comment and ends with the head of another.
// Trim those, then strip every remaining comment — prose like "the full root
// document" is not a reference to `document`.
const fence = script.match(/BLOCKBOOK LOGIC START([\s\S]*?)BLOCKBOOK LOGIC END/)[1]
  .replace(/^[\s\S]*?\*\//, "")     // drop tail of the opening marker comment
  .replace(/\/\*[\s\S]*$/, "")      // drop head of the closing marker comment
  .replace(/\/\*[\s\S]*?\*\//g, "") // strip remaining block comments
  .replace(/\/\/.*$/gm, "");        // strip line comments
const impure = ["document", "localStorage", "sessionStorage", "window", "state"]
  .filter(w => new RegExp(`\\b${w}\\b`).test(fence));
check(impure.length === 0,
      `pure-logic fence references no DOM / state / storage${impure.length ? " — found " + impure.join(", ") : ""}`);

// ============ render output ============
console.log("\n=== render() output ===");
X.render();

const panel = els.panel.innerHTML;
const cards = panel.match(/<article class="card/g) ?? [];
check(cards.length === 15, `15 location cards rendered (got ${cards.length})`);

const locs = X.activeLocations();
const missingNames = locs.filter(l => !panel.includes(X.esc(l.name)));
check(missingNames.length === 0,
      `every location name appears${missingNames.length ? " — missing " + missingNames.map(l=>l.name) : ""}`);

// every coordinate present
const missingCoords = locs.filter(l => {
  const s = `${l.x} / ${l.y === null ? "" : l.y}`;
  return l.y !== null && !panel.includes(`${l.x} / ${l.y} / ${l.z}`);
});
check(missingCoords.length === 0,
      `every x / y / z rendered${missingCoords.length ? " — missing " + missingCoords.map(l=>l.id) : ""}`);

const badges = { overworld: 0, nether: 0, end: 0 };
for (const m of panel.matchAll(/class="badge (\w+)"/g)) badges[m[1]]++;
const expect = { overworld: 0, nether: 0, end: 0 };
for (const l of locs) expect[l.dimension]++;
check(badges.overworld === expect.overworld && badges.nether === expect.nether,
      `dimension badges match data (OW ${badges.overworld}/${expect.overworld}, NE ${badges.nether}/${expect.nether})`);

check((panel.match(/class="card is-favorite"/g) ?? []).length === 3, "3 favourites get the accent border");
check(panel.includes("card-icon"), "type icon rendered per card");
check((panel.match(/class="chip"/g) ?? []).length > 0, "tag chips rendered");

// XSS / escaping — notes and names go through esc()
console.log("\n=== escaping ===");
const evil = { ...locs[0], id: "x", name: '<img src=x onerror=alert(1)>"', tags: ["<b>"], y: null };
const out = sandbox.__x.esc(evil.name);
check(!out.includes("<img"), "esc() neutralises tags in names");
check(X.coordHTML(evil).includes("nil"), "null Y renders as a dimmed dash, not 0 or blank");
check(!X.coordHTML(evil).includes("null"), "null Y never prints the word 'null'");

// ============ sort ============
console.log("\n=== sort ===");
const byName = X.sortLocations(locs, "name").map(l => l.name);
check(byName.join("|") === [...byName].sort((a,b)=>a.localeCompare(b)).join("|"), "sort by name is ordered");
const byType = X.sortLocations(locs, "type").map(l => l.type);
check(byType.join("|") === [...byType].sort().join("|"), "sort by type is grouped");
check(X.sortLocations(locs, "updated").length === 15, "sort by updated returns all rows");
check(X.sortLocations(locs, "bogus").length === 15, "unknown sort key falls back safely");
const before = locs.map(l => l.id).join();
X.sortLocations(locs, "name");
check(locs.map(l => l.id).join() === before, "sort does not mutate the source array");

// ============ tabs & status bar ============
console.log("\n=== tabs & status bar ===");
check(/data-tab="coordinates"/.test(els.tabs.innerHTML), "tab bar rendered");
check((els.tabs.innerHTML.match(/aria-selected="true"/g) ?? []).length === 1, "exactly one tab selected");
check(els.statusbar.innerHTML.includes("15 locations"), "status bar counts locations");
check(els.statusbar.innerHTML.includes("6 portals"), "status bar counts portals");
check(els.toolbar.innerHTML.includes('id="sort"'), "sort control present on Coordinates tab");

// Portals became real in Phase 4, brewing in Phase 6. Reference waits for v1.2.
X.state.ui.activeTab = "portals";
X.render();
check(els.panel.innerHTML.includes("Y is not converted"), "portals tab is built (Phase 4)");
check(els.toolbar.innerHTML === "", "portals tab hides the coordinates toolbar");

X.state.ui.activeTab = "brewing";
X.render();
check(els.panel.innerHTML.includes("Fire Resistance"), "brewing tab is built (Phase 6)");
check(els.toolbar.innerHTML === "", "brewing tab hides the coordinates toolbar");

X.state.ui.activeTab = "reference";
X.render();
check(els.panel.innerHTML.includes("Coming in"), "reference tab shows an honest stub");
check(els.toolbar.innerHTML === "", "reference tab hides the coordinates toolbar");
X.state.ui.activeTab = "coordinates";

// ============ perf ============
console.log("\n=== perf ===");
const big = Array.from({ length: 500 }, (_, i) => ({ ...locs[i % 15], id: "b" + i }));
X.state.data.worlds[0].locations = big;
const t0 = performance.now();
X.render();
const ms = performance.now() - t0;
check(ms < 100, `render at n=500: ${ms.toFixed(1)} ms (budget 100)`);

console.log(`\n${fails === 0 ? "GATE PASSED" : "GATE FAILED — " + fails + " failure(s)"}`);
process.exit(fails === 0 ? 0 : 1);
