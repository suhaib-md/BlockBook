/* Phase 2 gate — UI shell + list rendering. */
import { installDOM, makeChecker, seedLocations, readSrc, reload, stripComments } from "./harness.mjs";
const dom = installDOM();

const { check, eq, done } = makeChecker();
const store = await import("../src/store.js");
const views = await import("../src/views.js");
reload(store, seedLocations());

console.log("=== tokens & structure ===");
const css = stripComments(readSrc("style.css"));
for (const t of ["--bg-0", "--fg-0", "--ow", "--nether", "--end", "--ok", "--warn",
                 "--bad", "--info", "--font-mono", "--fs-md", "--s-4", "--r-md"]) {
  if (!css.includes(t + ":")) check(false, `token ${t} declared`);
}
check(css.includes("--bg-0:"), "design tokens declared at :root");
check(css.includes('[data-theme="light"]'), "light theme tokens present");
check(/\.coord\s*\{[^}]*--font-mono/.test(css), "coordinates use --font-mono (digits align)");
check(/font-variant-numeric:\s*tabular-nums/.test(css), "tabular numerals for column alignment");
check(/\.badge\.overworld[^}]*--ow\b/.test(css), "overworld badge uses --ow (green)");
check(/\.badge\.nether[^}]*--nether\b/.test(css), "nether badge uses --nether (red)");
check(/\.badge\.end[^}]*--end\b/.test(css), "end badge uses --end (purple)");
check(/prefers-reduced-motion/.test(css), "reduced-motion honoured");
check(/prefers-reduced-motion[\s\S]*?--motion-hover:\s*0ms/.test(css), "reduced-motion zeroes the motion tokens");
check(!/!important/.test(css), "no !important in stylesheet (UIUX §7)");
check(!/transition:[^;]*\d+ms/.test(css), "no hard-coded durations — all via --motion-* tokens");

console.log("\n=== module purity (docs/02-TRD.md §4) ===");
for (const leaf of ["portals.js", "schema.js", "util.js"]) {
  const src = stripComments(readSrc(leaf));
  const impure = ["document", "localStorage", "window", "state"]
    .filter(w => new RegExp(`\\b${w}\\b`).test(src));
  check(impure.length === 0, `${leaf} touches no DOM/state/storage${impure.length ? " — found " + impure : ""}`);
  check(!/^\s*import\s/m.test(readSrc(leaf).replace(/\/\*[\s\S]*?\*\//g, "")) || leaf !== "portals.js",
        `${leaf} import discipline`);
}
check(!/from "\.\/(views|store|main)\.js"/.test(readSrc("reftable.js")), "reftable imports nothing above it");
check(!/from "\.\/views\.js"/.test(readSrc("store.js")), "store.js does NOT import views.js (no cycle)");

console.log("\n=== render() output ===");
views.renderTabs(); views.renderToolbar(); views.renderPanel(); views.renderStatusBar();
const panel = dom.els.panel.innerHTML;
const cards = panel.match(/<article class="card/g) ?? [];
eq(cards.length, 15, "15 location cards rendered");

const locs = store.activeLocations();
const missingNames = locs.filter(l => !panel.includes(l.name.replace(/&/g, "&amp;")));
check(missingNames.length === 0, `every location name appears${missingNames.length ? " — missing " + missingNames.map(l => l.name) : ""}`);

const missingCoords = locs.filter(l => l.y !== null && !panel.includes(`${l.x} / ${l.y} / ${l.z}`));
check(missingCoords.length === 0, `every x / y / z rendered${missingCoords.length ? " — missing " + missingCoords.map(l => l.id) : ""}`);

const badges = { overworld: 0, nether: 0, end: 0 };
for (const m of panel.matchAll(/class="badge (\w+)"/g)) badges[m[1]]++;
const expect = { overworld: 0, nether: 0, end: 0 };
for (const l of locs) expect[l.dimension]++;
check(badges.overworld === expect.overworld && badges.nether === expect.nether,
      `dimension badges match data (OW ${badges.overworld}/${expect.overworld}, NE ${badges.nether}/${expect.nether})`);
check((panel.match(/class="card is-favorite"/g) ?? []).length === 3, "3 favourites get the accent border");
check(panel.includes("card-icon"), "type icon rendered per card");
check((panel.match(/class="chip"/g) ?? []).length > 0, "tag chips rendered");

console.log("\n=== escaping ===");
const util = await import("../src/util.js");
check(!util.esc('<img src=x onerror=alert(1)>').includes("<img"), "esc() neutralises tags");
const nilCard = views.cardHTML({ ...locs[0], id: "x", y: null });
check(nilCard.includes("nil"), "null Y renders as a dimmed dash, not 0 or blank");
check(!nilCard.includes(">null<"), "null Y never prints the word 'null'");

console.log("\n=== sort ===");
const loc = await import("../src/locations.js");
const byName = loc.sortLocations(locs, "name").map(l => l.name);
check(byName.join("|") === [...byName].sort((a, b) => a.localeCompare(b)).join("|"), "sort by name is ordered");
const byType = loc.sortLocations(locs, "type").map(l => l.type);
check(byType.join("|") === [...byType].sort().join("|"), "sort by type is grouped");
eq(loc.sortLocations(locs, "updated").length, 15, "sort by updated returns all rows");
eq(loc.sortLocations(locs, "bogus").length, 15, "unknown sort key falls back safely");
const before = locs.map(l => l.id).join();
loc.sortLocations(locs, "name");
eq(locs.map(l => l.id).join(), before, "sort does not mutate the source array");

console.log("\n=== tabs & status bar ===");
check(/data-tab="coordinates"/.test(dom.els.tabs.innerHTML), "tab bar rendered");
eq((dom.els.tabs.innerHTML.match(/aria-selected="true"/g) ?? []).length, 1, "exactly one tab selected");
check(dom.els.statusbar.innerHTML.includes("15 locations"), "status bar counts locations");
check(dom.els.statusbar.innerHTML.includes("6 portals"), "status bar counts portals");
check(dom.els.toolbar.innerHTML.includes('id="sort"'), "sort control present on Coordinates tab");

// Portals became real in Phase 4, brewing in Phase 6. Reference waits for v1.2.
store.state.ui.activeTab = "portals";
views.renderToolbar(); views.renderPanel();
check(dom.els.panel.innerHTML.includes("Y is not converted"), "portals tab is built (Phase 4)");
eq(dom.els.toolbar.innerHTML, "", "portals tab hides the coordinates toolbar");

store.state.ui.activeTab = "brewing";
views.renderToolbar(); views.renderPanel();
check(dom.els.panel.innerHTML.includes("Fire Resistance"), "brewing tab is built (Phase 6)");

store.state.ui.activeTab = "reference";
views.renderToolbar(); views.renderPanel();
check(dom.els.panel.innerHTML.includes("Coming in"), "reference tab shows an honest stub");
store.state.ui.activeTab = "coordinates";

console.log("\n=== perf ===");
const big = Array.from({ length: 500 }, (_, i) => ({ ...locs[i % 15], id: "b" + i }));
store.state.data.worlds[0].locations = big;
const t0 = performance.now();
views.renderPanel();
const ms = performance.now() - t0;
check(ms < 100, `render at n=500: ${ms.toFixed(1)} ms (budget 100)`);

done();
