/* Phase 7 gate — keyboard, favourites, recently viewed.
   main.js is imported so its delegated listeners register, then driven with
   synthetic events. */
import { installDOM, makeChecker, seedLocations, readSrc, settle } from "./harness.mjs";
const dom = installDOM();

const { check, eq, done } = makeChecker();
const loc   = await import("../src/locations.js");
const store = await import("../src/store.js");
const views = await import("../src/views.js");
await import("../src/main.js");          // boots asynchronously, registers listeners
await settle();

const D = () => globalThis.document;
const all = store.activeLocations();

console.log("=== boot fetched the seed ===");
eq(all.length, 15, "main.js booted with 15 locations from data/seed.json");
eq(store.state.notice, null, "no error banner — the fetch path worked");

console.log("\n=== favourites float to their own section ===");
const fav = loc.withFavourites(all, "name");
check(fav.slice(0, 3).every(l => l.favorite), "the 3 favourites sort to the front");
check(!fav[3].favorite, "non-favourites follow");
eq(fav.length, all.length, "nothing is lost by the favourites sort");
const before = all.map(l => l.id).join();
loc.withFavourites(all, "name");
eq(all.map(l => l.id).join(), before, "withFavourites does not mutate the source");

views.renderPanel();
let panel = dom.els.panel.innerHTML;
check(panel.includes("Favourites"), "a Favourites section renders");
check(panel.includes("All other locations"), "the remainder gets its own heading");
check(/Favourites[\s\S]*All other locations/.test(panel), "favourites come first in the DOM");

store.state.ui.search = "portal";
views.renderPanel();
panel = dom.els.panel.innerHTML;
check(!panel.includes("Favourites"), "searching does NOT split into sections");
check(panel.includes("Results"), "  ...it shows ranked results instead");
store.state.ui.search = "";
views.renderPanel();

console.log("\n=== recently viewed ===");
eq(loc.pushRecent([], "a").join(), "a", "first entry");
eq(loc.pushRecent(["a"], "b").join(), "b,a", "most recent first");
eq(loc.pushRecent(["a", "b"], "a").join(), "a,b", "re-viewing moves to front, no duplicate");
eq(loc.pushRecent(["a","b","c","d","e","f","g","h"], "i").length, 8, "capped at 8");
eq(loc.pushRecent(["a","b","c","d","e","f","g","h"], "i")[0], "i", "  ...newest kept");
eq(loc.pushRecent(["a","b","c","d","e","f","g","h"], "i").includes("h"), false, "  ...oldest dropped");

eq(views.recentlyViewedHTML(), "", "no strip when nothing has been viewed");
store.state.ui.recentlyViewed = ["loc_012", "loc_010"];
views.renderPanel();
check(dom.els.panel.innerHTML.includes("Recently viewed"), "strip appears once something is viewed");
check(/Recently viewed[\s\S]*Spider Spawner/.test(dom.els.panel.innerHTML), "  ...listing the viewed location");
store.state.ui.recentlyViewed = ["does-not-exist"];
eq(views.recentlyViewedHTML(), "", "a deleted location silently drops out of the strip");
store.state.ui.recentlyViewed = [];

console.log("\n=== cards are focusable and labelled ===");
views.renderPanel();
const card = views.cardHTML(all[0]);
check(/tabindex="0"/.test(card), "cards are keyboard focusable");
check(/id="card-/.test(card), "cards carry a stable id for focus restoration");
check(/aria-label="/.test(card), "cards have an accessible label");
check(/role="listitem"/.test(card), "cards are list items");
check(dom.els.panel.innerHTML.includes('role="list"'), "the list has a list role");

console.log("\n=== keyboard: navigation ===");
const cards = dom.cards();
eq(cards.length, 15, "15 focusable cards rendered");

D().activeElement = null;
dom.fire("keydown", { key: "ArrowDown", target: { tagName: "BODY" } });
eq(D().activeElement?.dataset.id, cards[0].dataset.id, "ArrowDown from nowhere focuses the first card");
dom.fire("keydown", { key: "ArrowDown", target: D().activeElement });
eq(D().activeElement?.dataset.id, cards[1].dataset.id, "ArrowDown advances");
dom.fire("keydown", { key: "ArrowUp", target: D().activeElement });
eq(D().activeElement?.dataset.id, cards[0].dataset.id, "ArrowUp goes back");
dom.fire("keydown", { key: "ArrowUp", target: D().activeElement });
eq(D().activeElement?.dataset.id, cards[0].dataset.id, "ArrowUp at the top stays put (no wrap)");
for (let i = 0; i < 40; i++) dom.fire("keydown", { key: "ArrowDown", target: D().activeElement });
eq(D().activeElement?.dataset.id, cards[14].dataset.id, "ArrowDown clamps at the last card");

console.log("\n=== keyboard: shortcuts fire ===");
D().activeElement = null;
let ev = dom.fire("keydown", { key: "n", target: { tagName: "BODY" } });
eq(store.state.ui.modal, "edit", "N opens the Add modal");
check(ev.defaultPrevented, "  ...and the key is consumed");
dom.fire("keydown", { key: "Escape", target: { tagName: "BODY" } });
eq(store.state.ui.modal, null, "Esc closes it again");

dom.fire("keydown", { key: "n", target: { tagName: "INPUT" } });
eq(store.state.ui.modal, null, "N while typing does NOT open the modal");

dom.fire("keydown", { key: "3", target: { tagName: "BODY" } });
eq(store.state.ui.activeTab, "brewing", "3 switches to the Brewing tab");
dom.fire("keydown", { key: "1", target: { tagName: "BODY" } });
eq(store.state.ui.activeTab, "coordinates", "1 returns to Coordinates");
dom.fire("keydown", { key: "2", target: { tagName: "INPUT" } });
eq(store.state.ui.activeTab, "coordinates", "digits while typing do not switch tabs");

ev = dom.fire("keydown", { key: "/", target: { tagName: "BODY" } });
check(ev.defaultPrevented, "/ is consumed (does not type a slash)");
ev = dom.fire("keydown", { key: "/", target: { tagName: "INPUT" } });
check(!ev.defaultPrevented, "/ while typing is left alone");
ev = dom.fire("keydown", { key: "f", ctrlKey: true, target: { tagName: "INPUT" } });
check(ev.defaultPrevented, "Ctrl+F works even from inside an input");

console.log("\n=== keyboard: Esc cascade (docs 03 §11) ===");
store.state.ui.search = "spawner";
store.state.ui.modal = "edit";
store.state.ui.draft = loc.blankDraft();
dom.fire("keydown", { key: "Escape", target: { tagName: "BODY" } });
eq(store.state.ui.modal, null, "Esc #1 closes the modal");
eq(store.state.ui.search, "spawner", "  ...and leaves the search text alone");
dom.fire("keydown", { key: "Escape", target: { tagName: "BODY" } });
eq(store.state.ui.search, "", "Esc #2 clears the search");
dom.fire("keydown", { key: "Escape", target: { tagName: "BODY" } });
eq(store.state.ui.search, "", "Esc #3 is harmless (window hide arrives in Phase 9)");

console.log("\n=== keyboard: acting on the focused row ===");
views.renderPanel();
dom.fire("keydown", { key: "ArrowDown", target: { tagName: "BODY" } });
const targetId = D().activeElement?.dataset.id;
dom.fire("keydown", { key: "Enter", shiftKey: true, target: D().activeElement });
eq(store.state.ui.modal, "edit", "Shift+Enter edits the focused row");
eq(store.state.ui.draft?.id, targetId, "  ...the right row");
check(store.state.ui.recentlyViewed.includes(targetId), "  ...and it counts as viewed");
dom.fire("keydown", { key: "Escape", target: { tagName: "BODY" } });

views.renderPanel();
dom.fire("keydown", { key: "ArrowDown", target: { tagName: "BODY" } });
const copyId = D().activeElement?.dataset.id;
ev = dom.fire("keydown", { key: "Enter", target: D().activeElement });
check(ev.defaultPrevented, "Enter on a focused row is consumed");
eq(store.state.ui.modal, null, "  ...and does not open a modal");
check(store.state.ui.recentlyViewed.includes(copyId), "  ...copying counts as viewing");

D().activeElement = null;
ev = dom.fire("keydown", { key: "Enter", target: { tagName: "BODY" } });
check(!ev.defaultPrevented, "Enter with nothing focused does nothing");

console.log("\n=== modal keys are scoped to the modal ===");
store.state.ui.modal = "settings";
const tabBefore = store.state.ui.activeTab;
dom.fire("keydown", { key: "3", target: { tagName: "BODY" } });
eq(store.state.ui.activeTab, tabBefore, "digits do not switch tabs while a modal is open");
dom.fire("keydown", { key: "n", target: { tagName: "BODY" } });
eq(store.state.ui.modal, "settings", "N does not stack a second modal");
dom.fire("keydown", { key: "Escape", target: { tagName: "BODY" } });

console.log("\n=== every re-rendered control keeps focus (regression) ===");
/*
 * Bug found in Phase 8: the Portals converter let you type only ONE character
 * before focus was lost. Cause — the panel re-renders on every keystroke and
 * withPreservedFocus() restores focus BY ID, but those inputs had no id, so the
 * caret vanished with the old element. The same bug affected the brewing search
 * and the import review name fields.
 *
 * Invariant: any input/select/textarea inside a region that re-renders must
 * carry a stable id, or it becomes untypable.
 */
function controlsWithoutId(html, label) {
  const bad = [];
  for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    const tag = m[0];
    if (tag.includes("type=\"hidden\"")) continue;
    if (!/\bid="/.test(tag)) bad.push(tag.replace(/\s+/g, " ").slice(0, 90));
  }
  check(bad.length === 0, `${label}: every control has a stable id${bad.length ? "\n        " + bad.join("\n        ") : ""}`);
}

store.state.ui.conv = { src: "overworld", x: "2217", z: "-4024" };
controlsWithoutId(views.portalsPanelHTML(), "Portals converter");
store.state.ui.activeTab = "coordinates";
views.renderToolbar();
controlsWithoutId(dom.els.toolbar.innerHTML, "Coordinates toolbar");

const brew = await import("../src/brewing.js");
controlsWithoutId(brew.brewingPanelHTML(
  { search: "", sortKey: "name", sortDir: "asc", filters: {}, selectedId: null }, ""), "Brewing tab");

store.state.ui.import = { rows: loc.buildImportRows("Home - 221/65/374\nPortal 631/67/245").rows, unrecognised: [] };
controlsWithoutId(views.importReviewModalHTML(), "Import review table");

store.state.ui.draft = loc.blankDraft();
store.state.ui.modal = "edit";
views.renderModal();
controlsWithoutId(dom.els["modal-root"].innerHTML, "Add/Edit modal");
store.state.ui.modal = null;
store.state.ui.draft = null;

// the four converter inputs specifically, since that is what was reported
const conv = views.portalsPanelHTML();
for (const id of ["conv-overworld-x", "conv-overworld-z", "conv-nether-x", "conv-nether-z"]) {
  check(conv.includes(`id="${id}"`), `converter input ${id} is addressable`);
}
// and prove the restore path actually finds them
globalThis.document.activeElement = { id: "conv-overworld-z", selectionStart: 3, selectionEnd: 3 };
views.renderPanel();
const restored = globalThis.document.getElementById("conv-overworld-z");
check(Boolean(restored), "withPreservedFocus can re-find the converter input after a re-render");

console.log("\n=== discoverability + a11y ===");
const settings = views.settingsModalHTML();
for (const k of ["<kbd>/</kbd>", "<kbd>N</kbd>", "<kbd>Esc</kbd>", "<kbd>Shift</kbd>"]) {
  check(settings.includes(k), `settings documents ${k.replace(/<\/?kbd>/g, "")}`);
}
check(settings.includes("aria-modal"), "modals are marked aria-modal");
const css = readSrc("style.css");
check(/\.card:focus-visible/.test(css), "focused cards get a visible ring");
check(/:focus-visible[\s\S]*outline:/.test(css), "focus outlines are never removed without replacement");
check(readSrc("main.js").includes("trapTab"), "modals trap Tab");

done();
