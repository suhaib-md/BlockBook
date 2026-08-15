/* Phase 8 gate — module split + Tauri scaffold.
   The "exe runs" half of the gate cannot be asserted here; it needs a real
   build. This covers the architecture, the build output, and the config. */
import { installDOM, makeChecker, readSrc, ROOT, stripComments } from "./harness.mjs";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
installDOM();

const { check, eq, done } = makeChecker();
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const has  = (p) => existsSync(join(ROOT, p));

const MODULES = ["util", "schema", "portals", "reftable", "locations", "brewing", "store", "views", "main"];

console.log("=== module layout (docs/02-TRD.md §4, §8) ===");
for (const m of MODULES) check(has(`src/${m}.js`), `src/${m}.js exists`);
check(has("src/index.html"), "src/index.html exists");
check(has("src/style.css"), "src/style.css exists");
check(!has("src/xaero.js"), "xaero.js correctly absent (Phase 11)");

console.log("\n=== dependency graph is acyclic and one-directional ===");
const importsOf = (m) => [...read(`src/${m}.js`).matchAll(/from "\.\/([\w-]+)\.js"/g)].map(x => x[1]);
const rank = Object.fromEntries(MODULES.map((m, i) => [m, i]));
for (const m of MODULES) {
  const bad = importsOf(m).filter(dep => rank[dep] >= rank[m]);
  check(bad.length === 0, `${m}.js imports only from below${bad.length ? " — VIOLATION: " + bad.join(", ") : ""}`);
}
check(!importsOf("store").includes("views"), "store.js does NOT import views.js (the cycle Phase 8 had to break)");
check(read("src/store.js").includes("setSaveStatusListener"),
      "  ...it uses a listener callback instead");
check(read("src/main.js").includes("setSaveStatusListener(renderStatusBar)"),
      "  ...and main.js installs the real one at boot");

console.log("\n=== leaves stay pure ===");
for (const leaf of ["util", "schema", "portals"]) {
  const src = stripComments(read(`src/${leaf}.js`));
  const impure = ["document", "localStorage", "window", "navigator", "state"]
    .filter(w => new RegExp(`\\b${w}\\b`).test(src));
  check(impure.length === 0, `${leaf}.js touches no DOM/state/storage${impure.length ? " — found " + impure : ""}`);
}
eq(importsOf("util").length, 0, "util.js imports nothing at all");
eq(importsOf("schema").length, 0, "schema.js imports nothing at all");
eq(importsOf("portals").length, 0, "portals.js imports nothing at all");

console.log("\n=== every import resolves to a real export ===");
const exportsOf = (m) => {
  const src = read(`src/${m}.js`);
  const blk = src.match(/export\s*\{([\s\S]*?)\}\s*;?\s*$/);
  return new Set((blk?.[1] ?? "").split(",").map(s => s.trim()).filter(Boolean));
};
const table = Object.fromEntries(MODULES.map(m => [m, exportsOf(m)]));
let dangling = 0;
for (const m of MODULES) {
  for (const im of read(`src/${m}.js`).matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\/([\w-]+)\.js"/g)) {
    for (const sym of im[1].split(",").map(s => s.trim()).filter(Boolean)) {
      if (!table[im[2]]?.has(sym)) { console.log(`FAIL  ${m}.js imports ${sym} which ${im[2]}.js does not export`); dangling++; }
    }
  }
}
check(dangling === 0, "no import names a symbol its source does not export");

console.log("\n=== no unused imports ===");
let unused = 0;
for (const m of MODULES) {
  const src = read(`src/${m}.js`);
  // Only comments and the import lines are stripped. Template literals and
  // quoted strings are KEPT: real usage lives inside `${...}` interpolations,
  // and an attribute like title="Copy ${tpCommand(loc)}" looks like a quoted
  // string to a naive regex, so blanking either one reports false "unused".
  // Symbol names are distinctive enough that prose collisions are not a risk.
  const body = stripComments(src).replace(/^import[\s\S]*?;$/gm, "");
  for (const im of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const sym of im[1].split(",").map(s => s.trim()).filter(Boolean)) {
      const re = new RegExp(`(^|[^\\w$.])${sym.replace(/\$/g, "\\$")}(?![\\w$])`, "m");
      if (!re.test(body.replace(/\.\.\./g, " "))) { console.log(`FAIL  ${m}.js imports ${sym} but never uses it`); unused++; }
    }
  }
}
check(unused === 0, "no module imports something it never uses");

console.log("\n=== seed is fetched, not inlined (Phase 8 checklist) ===");
const mainSrc = read("src/main.js");
check(!/SEED_LOCATIONS\s*=/.test(mainSrc), "the giant inline SEED_LOCATIONS constant is gone");
check(/fetch\("\.\/seed\.json"\)/.test(mainSrc), "main.js fetches ./seed.json");
check(/loadData\(seed\)/.test(mainSrc), "the fetched seed is handed to loadData");
check(/loadData\(seedLocations\)/.test(read("src/store.js")), "store.loadData takes the seed as a parameter");
for (const m of MODULES) {
  check(!/"loc_00\d"[\s\S]{0,80}"Home"/.test(read(`src/${m}.js`)), `${m}.js holds no inlined seed rows`);
}

console.log("\n=== module sizes stay under the ADR-002 revisit trigger ===");
for (const m of MODULES) {
  const lines = read(`src/${m}.js`).split("\n").length;
  check(lines < 1500, `${m}.js is ${lines} lines (revisit at 1500)`);
}

console.log("\n=== build config ===");
const pkg = JSON.parse(read("package.json"));
eq(pkg.type, "module", "package.json declares ES modules");
check(Boolean(pkg.scripts.dev && pkg.scripts.build && pkg.scripts.tauri), "dev / build / tauri scripts present");
eq(pkg.scripts.test, "node tests/run-all.mjs", "npm test runs the gates");
check(Boolean(pkg.devDependencies["@tauri-apps/cli"]), "@tauri-apps/cli is a devDependency");

const vite = read("vite.config.js");
check(/root:\s*"src"/.test(vite), "vite root is src/");
check(/publicDir:\s*"\.\.\/data"/.test(vite), "data/ is the publicDir, so seed.json is served at the root");
check(/port:\s*1420/.test(vite) && /strictPort:\s*true/.test(vite), "dev server pinned to 1420 (Tauri expects it)");
check(/outDir:\s*"\.\.\/dist"/.test(vite), "build output goes to dist/");

console.log("\n=== Tauri scaffold ===");
for (const f of ["src-tauri/Cargo.toml", "src-tauri/build.rs", "src-tauri/src/main.rs",
                 "src-tauri/src/lib.rs", "src-tauri/tauri.conf.json"]) {
  check(has(f), `${f} exists`);
}
const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
eq(conf.productName, "BlockBook", "product name");
eq(conf.build.frontendDist, "../dist", "frontendDist points at the Vite output");
eq(conf.build.devUrl, "http://localhost:1420", "devUrl matches the Vite port");
const win = conf.app.windows[0];
eq(win.width, 900, "window width 900 (docs/04-UIUX-SPEC.md §3)");
eq(win.height, 640, "window height 640");
eq(win.minWidth, 560, "min width 560");
eq(win.minHeight, 400, "min height 400");
eq(win.title, "BlockBook", "window title");
check(conf.identifier.includes("."), "bundle identifier is reverse-DNS");
check(Array.isArray(conf.bundle.icon) && conf.bundle.icon.length > 0, "bundle declares icons");

console.log("\n=== icons generated ===");
for (const i of ["32x32.png", "128x128.png", "128x128@2x.png", "icon.ico", "icon.icns"]) {
  check(has(`src-tauri/icons/${i}`), `icons/${i}`);
}

console.log("\n=== Rust side is Phase 8 scope only ===");
const lib = read("src-tauri/src/lib.rs");
check(/tauri::Builder::default\(\)/.test(lib), "lib.rs builds a Tauri app");
// Strip Rust comments — the doc comment explains what is deferred, which is
// not the same as the code doing it.
const libCode = lib.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
check(!/global_shortcut|tray|TrayIcon/i.test(libCode), "no hotkey/tray yet — that is Phase 9");
check(!/plugin_fs|plugin-fs/i.test(libCode), "no filesystem plugin yet — that is Phase 10");
check(/windows_subsystem = "windows"/.test(read("src-tauri/src/main.rs")), "release build hides the console window");

console.log("\n=== built output ===");
if (!has("dist/index.html")) {
  check(false, "dist/ missing — run `npm run build` first");
} else {
  check(has("dist/seed.json"), "dist/seed.json present — fetch('./seed.json') will resolve");
  check(has("dist/brewing.json"), "dist/brewing.json present");
  const assets = readdirSync(join(ROOT, "dist", "assets"));
  check(assets.some(f => f.endsWith(".js")), "a JS bundle was emitted");
  check(assets.some(f => f.endsWith(".css")), "a CSS bundle was emitted");
  const html = read("dist/index.html");
  check(/type="module"/.test(html), "the bundle is loaded as a module");
  check(!/<script>[\s\S]*BLOCKBOOK LOGIC/.test(html), "no inline app script remains in the built HTML");
  const js = readFileSync(join(ROOT, "dist", "assets", assets.find(f => f.endsWith(".js"))), "utf8");
  check(js.length < 200_000, `bundle is ${(js.length / 1024).toFixed(0)} KB (well under budget)`);
  check(!/http:\/\/|https:\/\//.test(js.replace(/sourceMappingURL[\s\S]*$/, "")),
        "no external URLs in the shipped bundle (offline-always, P1)");
}

done();
