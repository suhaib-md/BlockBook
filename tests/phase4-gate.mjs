import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(process.argv[2], "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeSandbox(store = new Map()) {
  const els = {};
  const mkEl = (id) => (els[id] ??= { id, _html: "", focus(){}, get innerHTML(){return this._html;}, set innerHTML(v){this._html=v;} });
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
                getElementById: mkEl, querySelector: () => null, addEventListener: () => {} },
    window: { addEventListener: () => {} },
  };
  vm.createContext(sb);
  vm.runInContext(script + `
;globalThis.__x = { state, activeLocations, toNether, toOverworld, horizontalDistance,
  counterpart, destinationDimension, findLinkConflicts, linkHealth, brokenPairs,
  portalWarnings, validateLocation, commitLocation, deleteLocation, setPortalLink,
  LINK_RADIUS, fmtDist, render, portalsPanelHTML, portalPanelHTML, cardHTML,
  draftToLocation, blankDraft, convertAxis };`, sb);
  return sb;
}

const sb = makeSandbox();
const X = sb.__x;
const ALL = X.activeLocations();

let fails = 0;
const check = (ok, msg) => { console.log((ok ? "PASS  " : "FAIL  ") + msg); if (!ok) fails++; };
const eq   = (a, b, m) => check(a === b, `${m}${a === b ? "" : `  (got ${a}, want ${b})`}`);
const near = (a, b, m, tol = 0.01) =>
  check(Math.abs(a - b) < tol, `${m}${Math.abs(a-b) < tol ? "" : `  (got ${Number(a).toFixed(2)}, want ${b})`}`);

console.log("=== G1  conversion, positive ===");
eq(X.toNether(2217, -4024).x,  277, "G1a toNether x 2217");
eq(X.toNether(2217, -4024).z, -503, "G1b toNether z -4024 (exact divide)");
eq(X.toNether(631, 245).x,      78, "G1c toNether x 631");
eq(X.toNether(631, 245).z,      30, "G1d toNether z 245");
eq(X.toNether(221, 374).x,      27, "G1e toNether x 221");
eq(X.toNether(221, 374).z,      46, "G1f toNether z 374");

console.log("\n=== G2  conversion, NEGATIVE — floor vs trunc ===");
eq(X.toNether(688, -1926).x,    86, "G2a toNether x 688");
eq(X.toNether(688, -1926).z,  -241, "G2b toNether z -1926  <- MUST be -241, not -240");
eq(X.toNether(-495, -394).x,   -62, "G2c toNether x -495   <- MUST be -62, not -61");
eq(X.toNether(-1, -1).x,        -1, "G2d toNether x -1     <- MUST be -1, not 0");
eq(X.toNether(-8, -8).x,        -1, "G2e toNether x -8 (exact)");
eq(X.toNether(-9, -9).x,        -2, "G2f toNether x -9");

console.log("\n=== G3  reverse conversion ===");
eq(X.toOverworld(16, 38).x,     128, "G3a toOverworld x 16");
eq(X.toOverworld(16, 38).z,     304, "G3b toOverworld z 38");
eq(X.toOverworld(276, -507).x, 2208, "G3c toOverworld x 276");
eq(X.toOverworld(276, -507).z,-4056, "G3d toOverworld z -507");
eq(X.toOverworld(-495, -394).x, -3960, "G3e toOverworld x -495");
eq(X.toOverworld(-495, -394).z, -3152, "G3f toOverworld z -394");

console.log("\n=== G4  Y is NEVER scaled ===");
check(X.toNether.length === 2 && X.toOverworld.length === 2,
      "G4a conversion functions take exactly (x, z) — Y cannot be passed");
check(!("y" in X.toNether(100, 100)) && !("y" in X.toOverworld(100, 100)),
      "G4b conversion result carries no y");
const cpY = X.counterpart(ALL.find(l => l.id === "loc_014"));
check(!("y" in cpY), "G4c counterpart() carries no y either");

console.log("\n=== G5  conflict detection — THE flagship case ===");
const c5 = X.findLinkConflicts({ dimension: "overworld", x: 631, z: 245, id: "test" }, ALL);
eq(c5.length, 1, "G5a exactly one conflict for OW 631 / 245");
eq(c5[0]?.location.name, "Home Portal (Nether side)", "G5b nearest conflict is Home Portal");
near(c5[0]?.distance, 62.51, "G5c conflict distance");
check(c5[0]?.distance <= X.LINK_RADIUS, "G5d it is inside the 128-block radius");

console.log("\n=== G6  no conflict ===");
const c6 = X.findLinkConflicts({ dimension: "overworld", x: 688, z: -1926, id: "test" }, ALL);
eq(c6.length, 0, "G6a Bastion portal has no conflict");
const t6 = X.counterpart({ dimension: "overworld", x: 688, z: -1926 });
eq(`${t6.x} / ${t6.z}`, "86 / -241", "G6b its target is 86 / -241 (floor, not trunc)");

console.log("\n=== G7  never conflicts with itself ===");
const self = ALL.find(l => l.name === "Fortress Portal (Nether)");
const c7 = X.findLinkConflicts(self, ALL);
check(c7.every(r => r.location.id !== self.id), "G7a a portal never conflicts with itself");
for (const p of ALL.filter(l => l.type === "portal")) {
  const bad = X.findLinkConflicts(p, ALL).filter(r => r.location.id === p.id);
  if (bad.length) check(false, `G7b ${p.name} self-conflicted`);
}
check(true, "G7b no seed portal self-conflicts");

console.log("\n=== G8  link health is BIDIRECTIONAL (ADR-010) ===");
const trial = ALL.find(l => l.name.startsWith("Trial Chamber"));
const fort  = ALL.find(l => l.name.startsWith("Fortress Portal"));
const h8 = X.linkHealth(trial, fort);
near(h8.forward,   4.12, "G8a forward  OW->NE (nether blocks)");
near(h8.backward, 33.24, "G8b backward NE->OW (overworld blocks)");
near(h8.worst,    33.24, "G8c worst is the backward direction");
eq(h8.status, "loose", "G8d status is LOOSE, not tight (07-ALGORITHMS §4.3)");
const h8r = X.linkHealth(fort, trial);
check(h8r.forward === h8.forward && h8r.backward === h8.backward,
      "G8e linkHealth is order-independent");

console.log("\n=== G9  End dimension excluded ===");
eq(X.findLinkConflicts({ dimension: "end", x: 100, z: 100, id: "t" }, ALL).length, 0,
   "G9a End portals produce no conflicts");
eq(X.counterpart({ dimension: "end", x: 100, z: 100 }), null, "G9b End has no counterpart");
eq(X.destinationDimension("end"), null, "G9c End links nowhere");
eq(X.linkHealth({ dimension: "end", x: 0, z: 0 }, trial), null, "G9d End pair health is null");

console.log("\n=== health thresholds ===");
const mk = (dim, x, z) => ({ dimension: dim, x, z, type: "portal", id: dim + x + z });
eq(X.linkHealth(mk("overworld", 0, 0), mk("nether", 0, 0)).status, "tight", "0 blocks -> tight");
eq(X.linkHealth(mk("overworld", 128, 0), mk("nether", 0, 0)).status, "loose",
   "128 OW blocks apart -> loose (backward = 128, boundary)");
eq(X.linkHealth(mk("overworld", 136, 0), mk("nether", 0, 0)).status, "broken",
   "136 OW blocks apart -> broken (backward > 128)");
check(X.linkHealth(mk("overworld", 0, 0), mk("overworld", 0, 0)) === null,
      "same-dimension pair -> null");

console.log("\n=== W2 / W4 warnings feed validation ===");
const probe = { id: "new", name: "New Portal", dimension: "overworld", x: 631, y: 67, z: 245,
                type: "portal", tags: [], notes: "", linkedPortalId: null, favorite: false };
const pw = X.portalWarnings(probe, ALL);
check(pw.some(w => w.code === "W2"), "W2 raised for the 631 / 245 conflict");
check(pw.find(w => w.code === "W2").msg.includes("Home Portal"), "W2 NAMES the hijacking portal");
check(pw.find(w => w.code === "W2").msg.includes("62.5"), "W2 gives the distance");
const full = X.validateLocation(probe, ALL, pw);
check(full.warnings.some(w => w.code === "W2"), "W2 reaches validateLocation");
check(full.errors.length === 0, "W2 is a WARNING — it never blocks the save");

const pairW = X.portalWarnings(trial, ALL);
check(pairW.some(w => w.code === "W4"), "W4 raised for the loose Trial/Fortress pair");
check(!pairW.some(w => w.code === "W2"),
      "the declared partner is NOT reported as a conflict against itself");

console.log("\n=== counterpart on cards ===");
sb.__x.state.ui.activeTab = "coordinates";
const cards = ALL.map(X.cardHTML).join("");
check(cards.includes("&harr; nether") || cards.includes("↔ nether"), "portal cards show their counterpart");
check(cards.includes("Tight") || cards.includes("Loose") || cards.includes("Broken"), "health badge rendered");
check(cards.includes("Unlinked"), "unpaired portals marked Unlinked");
const nonPortalCard = X.cardHTML(ALL.find(l => l.type === "base"));
check(!nonPortalCard.includes("portal-row"), "non-portals get no portal row");

console.log("\n=== converter ===");
eq(X.convertAxis("2217", "toNether"), "277", "converter: 2217 -> 277");
eq(X.convertAxis("-1926", "toNether"), "-241", "converter: -1926 -> -241 (floor)");
eq(X.convertAxis("276", "toOverworld"), "2208", "converter: 276 -> 2208");
eq(X.convertAxis("-", "toNether"), "", 'converter: lone "-" yields empty, not NaN');
eq(X.convertAxis("", "toNether"), "", "converter: empty stays empty");
eq(X.convertAxis("abc", "toNether"), "", "converter: junk yields empty");

sb.__x.state.ui.conv = { src: "overworld", x: "631", z: "245" };
sb.__x.state.ui.activeTab = "portals";
const panel = X.portalsPanelHTML();
check(panel.includes("Y is not converted"), "permanent 'Y is not converted' note present");
check(panel.includes("Home Portal"), "converter lists the nearby conflicting portal");
check(panel.includes("62.5"), "converter shows the conflict distance");
check(panel.includes("78 / 30"), "converter shows the computed nether target");

console.log("\n=== re-pairing does not orphan a third portal ===");
const sb2 = makeSandbox(); const Y = sb2.__x; const L2 = () => Y.activeLocations();
// Trial(loc_014, OW) <-> Fortress(loc_015, NE). Now pair Fortress with a different OW portal.
Y.commitLocation({ ...L2().find(l => l.id === "loc_015"), linkedPortalId: "loc_003" });
eq(L2().find(l => l.id === "loc_015").linkedPortalId, "loc_003", "Fortress now points at Portal 631");
eq(L2().find(l => l.id === "loc_003").linkedPortalId, "loc_015", "  ...and it points back");
eq(L2().find(l => l.id === "loc_014").linkedPortalId, null, "old partner Trial was unhooked, not left dangling");
const asym = L2().filter(l => l.linkedPortalId &&
  L2().find(p => p.id === l.linkedPortalId)?.linkedPortalId !== l.id);
eq(asym.length, 0, "no asymmetric links anywhere after re-pairing");

console.log("\n=== broken-pair surfacing ===");
const sb3 = makeSandbox(); const Z = sb3.__x; const L3 = () => Z.activeLocations();
eq(Z.brokenPairs(L3()).length, 0, "seed data has no broken pairs");
// Move the Fortress portal far away -> the declared pair can no longer connect.
Z.commitLocation({ ...L3().find(l => l.id === "loc_015"), x: 9000, z: 9000 });
eq(Z.brokenPairs(L3()).length, 1, "moving a partner far away yields exactly 1 broken pair");
check(Z.brokenPairs(L3())[0].health.status === "broken", "  ...and it is flagged broken");

console.log(`\n${fails === 0 ? "GATE PASSED" : "GATE FAILED — " + fails + " failure(s)"}`);
process.exit(fails === 0 ? 0 : 1);
