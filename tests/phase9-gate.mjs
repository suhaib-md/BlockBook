/* Phase 9 gate — overlay behaviour: always-on-top, Ctrl+Space, tray,
   close-to-tray, clipboard, window-state persistence.

   The Rust half is asserted by reading src-tauri (it cannot be executed here).
   The JS half is executed: desktop.js must degrade safely outside Tauri, which
   is the property that keeps `npm run dev` and every other gate working. */
import { installDOM, makeChecker, readSrc, ROOT, settle, stripComments } from "./harness.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const dom = installDOM();

const { check, eq, done } = makeChecker();
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const rust = stripComments(read("src-tauri/src/lib.rs"));
const conf = JSON.parse(read("src-tauri/tauri.conf.json"));

console.log("=== window config ===");
const win = conf.app.windows[0];
eq(win.label, "main", "window is labelled 'main' (capabilities target it by label)");
eq(win.alwaysOnTop, true, "alwaysOnTop defaults to true");
eq(win.width, 900, "width still 900");
eq(win.minWidth, 560, "min width still 560");
eq(win.skipTaskbar, false, "stays in the taskbar so it is findable when hidden");

console.log("\n=== global shortcut ===");
check(/global_shortcut/.test(rust), "global-shortcut plugin wired in");
check(/ShortcutState::Pressed/.test(rust), "fires on PRESS only — release would toggle straight back");
check(!/\.register\([^)]*\)\.unwrap\(\)/.test(rust), "no unwrap() on registration");
check(/fn apply_hotkey/.test(rust), "hotkey is settable at runtime, not baked in");
check(/unregister_all/.test(rust), "  ...and the previous binding is cleared first");
check(/map_err/.test(rust), "  ...registration errors are returned, not panicked");
check(/generate_handler!\[[\s\S]*?apply_hotkey/.test(rust), "  ...and the command is exposed to the webview");
// The frontend owns the setting, so Rust must NOT register anything at startup.
const setupBlock = rust.slice(rust.indexOf(".setup("), rust.indexOf(".on_window_event("));
check(!/register\("/.test(setupBlock), "nothing is registered at startup — no hard-coded default can fire");

console.log("\n=== the hotkey must not fight Minecraft (regression) ===");
/*
 * Reported bug: the planned Ctrl+Space default IS sprint-jump — Ctrl is sprint,
 * Space is jump. Every jump summoned the app and stole focus from the game.
 * Nothing in the defaults may collide with a Minecraft control again.
 */
const schema = await import("../src/schema.js");
const MC_DEFAULT_KEYS = ["Space", "Shift", "Control", "Ctrl", "Tab", "Escape",
                         "KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyQ", "KeyT", "KeyF"];
eq(schema.DEFAULT_SETTINGS.hotkey, "CmdOrCtrl+Shift+B", "default hotkey is Ctrl+Shift+B");
check(!/\bSpace\b/.test(schema.DEFAULT_SETTINGS.hotkey), "default does NOT involve Space (jump)");
for (const opt of schema.HOTKEY_OPTIONS) {
  if (opt.value === "") continue;                       // "disabled" is always safe
  const keys = opt.value.split("+").map(k => k.trim());
  const bare = keys[keys.length - 1];                   // the non-modifier key
  check(!/^(Space|Tab|Escape|W|A|S|D|E|Q|T|F)$/i.test(bare),
        `option "${opt.value}" does not bind a Minecraft control key`);
  check(keys.length >= 2 || /^F\d+$/.test(bare),
        `option "${opt.value}" is a multi-key combo or an unbound function key`);
}
check(schema.HOTKEY_OPTIONS.some(o => o.value === ""), "the hotkey can be disabled entirely");
check(schema.UNSAFE_HOTKEYS.has("Ctrl+Space"), "Ctrl+Space is recorded as unsafe");
check(schema.UNSAFE_HOTKEYS.has("CmdOrCtrl+Space"), "  ...in both spellings");

console.log("\n=== existing installs are migrated off the bad hotkey ===");
// Fixing only the default would leave saved settings on Ctrl+Space forever.
const store2 = await import("../src/store.js");
const { seedLocations, reload } = await import("./harness.mjs");
const SEED = seedLocations();
const disk = new Map([["blockbook.data", JSON.stringify({
  app: "blockbook", schemaVersion: 1,
  worlds: [{ id: "w_main", name: "W", edition: "java", gameVersion: "1.21", seed: null,
             createdAt: new Date().toISOString(), locations: [] }],
  settings: { activeWorldId: "w_main", coordFormat: "x / y / z", alwaysOnTop: true,
              hotkey: "Ctrl+Space", theme: "dark" },
})]]);
installDOM({ store: disk });
const loaded = await reload(store2, SEED);
eq(store2.state.data.settings.hotkey, "CmdOrCtrl+Shift+B", "a saved Ctrl+Space is migrated away on load");
check(loaded.notice !== null, "  ...and the user is told it changed");
check(/sprint-jump/.test(loaded.notice.text), "  ...with the reason");
installDOM();

console.log("\n=== toggle semantics ===");
check(/fn toggle_main/.test(rust), "toggle_main exists");
check(/is_visible/.test(rust), "toggle checks visibility rather than tracking its own flag");
check(/fn show_main[\s\S]*?set_focus/.test(rust), "showing the window also focuses it");
check(/fn show_main[\s\S]*?unminimize/.test(rust), "  ...and unminimises it");
check(/fn show_main[\s\S]*?emit\(SHOWN_EVENT/.test(rust),
      "  ...and emits an event so the webview can focus the search box");

console.log("\n=== system tray ===");
check(/TrayIconBuilder/.test(rust), "tray icon built");
for (const item of ["show", "hide", "quit"]) {
  check(new RegExp(`"${item}"`).test(rust), `tray menu has ${item}`);
}
check(/app\.exit\(0\)/.test(rust), "Quit actually exits the process");
check(/tray-icon/.test(read("src-tauri/Cargo.toml")), "tauri crate has the tray-icon feature");

console.log("\n=== close hides to tray, never quits ===");
check(/WindowEvent::CloseRequested/.test(rust), "close is intercepted");
check(/api\.prevent_close\(\)/.test(rust), "  ...and prevented");
check(/CloseRequested[\s\S]*?window\.hide\(\)/.test(rust), "  ...the window hides instead");
check(/window\.label\(\) == MAIN/.test(rust), "  ...only for the main window");

console.log("\n=== window position/size persistence ===");
check(/window_state/.test(rust), "window-state plugin wired in");
check(/tauri-plugin-window-state/.test(read("src-tauri/Cargo.toml")), "  ...and declared in Cargo.toml");

console.log("\n=== capabilities are narrow ===");
check(existsSync(join(ROOT, "src-tauri/capabilities/default.json")), "capabilities file exists");
const caps = JSON.parse(read("src-tauri/capabilities/default.json"));
eq(caps.windows.join(), "main", "capability targets the main window");
const perms = caps.permissions;
for (const p of ["core:window:allow-show", "core:window:allow-hide",
                 "core:window:allow-set-always-on-top", "clipboard-manager:allow-write-text",
                 "global-shortcut:default", "core:event:allow-listen"]) {
  check(perms.includes(p), `grants ${p}`);
}
// P1: offline-always. Nothing here should open the door to the network or shell.
for (const bad of ["http:", "shell:", "fs:"]) {
  check(!perms.some(p => p.startsWith(bad)), `does NOT grant ${bad}* (offline-always, no filesystem until Phase 10)`);
}

console.log("\n=== desktop.js degrades outside Tauri ===");
const desktop = await import("../src/desktop.js");
eq(desktop.isDesktop(), false, "isDesktop() is false under the test harness");
// None of these may throw when Tauri is absent — that is what keeps the browser
// build and every other gate working.
eq(await desktop.setAlwaysOnTop(true), false, "setAlwaysOnTop is a safe no-op outside Tauri");
eq(await desktop.hideWindow(), false, "hideWindow is a safe no-op outside Tauri");
eq(typeof (await desktop.onWindowShown(() => {})), "function", "onWindowShown returns an unsubscribe stub");
eq(await desktop.copyText("/tp 1 2 3"), true, "copyText falls back to the browser clipboard");

console.log("\n=== Tauri imports are DYNAMIC (static ones break the browser build) ===");
const dsrc = readSrc("desktop.js");
check(!/^\s*import\s+.*@tauri-apps/m.test(dsrc), "no top-level import of any @tauri-apps package");
check(/await import\("@tauri-apps\/plugin-clipboard-manager"\)/.test(dsrc), "clipboard loaded dynamically");
check(/await import\("@tauri-apps\/api\/window"\)/.test(dsrc), "window API loaded dynamically");
check(/await import\("@tauri-apps\/api\/event"\)/.test(dsrc), "event API loaded dynamically");
// desktop.js must be the ONLY module that mentions Tauri.
for (const m of ["util", "schema", "portals", "reftable", "locations", "brewing", "store", "views", "main"]) {
  check(!/@tauri-apps/.test(readSrc(`${m}.js`)), `${m}.js does not reference Tauri directly`);
}

console.log("\n=== frontend wiring ===");
const main = readSrc("main.js");
check(/from "\.\/desktop\.js"/.test(main), "main.js imports the desktop bridge");
check(/setAlwaysOnTop\(state\.data\?\.settings\?\.alwaysOnTop/.test(main),
      "the persisted always-on-top preference is applied at boot");
check(/onWindowShown\(/.test(main), "main.js reacts to the summon event");
check(/registerHotkey\(state\.data\?\.settings\?\.hotkey/.test(main),
      "the hotkey is registered from the SAVED SETTING at boot, not a constant");
check(/id === "s-hotkey"/.test(main), "changing the hotkey in Settings re-registers it");
check(/state\.notice = \{ kind: "error", text: esc\(res\.reason\)/.test(main),
      "a failed registration surfaces visibly instead of failing silently");
check(/box\.select\?\.\(\)/.test(main), "  ...selecting the existing query, so the next keystroke replaces it");
check(/isDesktop\(\)[\s\S]{0,160}hideWindow/.test(main), "Esc's third stage hides the window on desktop");

const views = readSrc("views.js");
check(/id="s-hotkey"/.test(views), "Settings has a hotkey picker");
check(/id="s-aot"/.test(views), "Settings has an always-on-top toggle");
check(/s\.hotkey/.test(views), "Settings shows the summon hotkey");
check(/tray/i.test(views), "Settings explains close-to-tray");

console.log("\n=== the fullscreen caveat is still documented (R-08) ===");
check(/exclusive[\s\S]{0,40}fullscreen/i.test(views), "Settings warns about exclusive fullscreen");
check(/exclusive fullscreen/i.test(read("README.md")), "README warns about exclusive fullscreen");

console.log("\n=== clipboard now goes through the bridge ===");
check(!/navigator\.clipboard/.test(stripComments(main)), "main.js no longer calls navigator.clipboard directly");
check(/copyText/.test(main), "  ...it uses desktop.copyText");

done();
