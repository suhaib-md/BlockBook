/* Phase 10 gate — portable data.json, atomic writes, rolling backups.
   Ships v1.0. This covers R-01 (data loss), the highest-severity risk in the
   register, so the emphasis is on what happens when things go wrong. */
import { installDOM, makeChecker, seedLocations, reload, readSrc, ROOT, stripComments } from "./harness.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
installDOM();

const { check, eq, done } = makeChecker();
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const store = await import("../src/store.js");
const desktop = await import("../src/desktop.js");
const SEED = seedLocations();

/* ---------------------------------------------------------------------------
   A fake file backend. Same contract as the Rust one, so the JS side of the
   recovery logic can be exercised without a running exe.
--------------------------------------------------------------------------- */
function fakeFileBackend() {
  const fs = { data: null, backups: new Map(), quarantined: [], writes: 0, failNextWrite: false };
  let n = 0;
  return {
    fs,
    kind: "file",
    async info() {
      return { path: "C:\\app\\data.json", dir: "C:\\app", portable: true,
               exists: fs.data != null, backup_count: fs.backups.size };
    },
    async read() { return fs.data; },
    async write(contents) {
      if (fs.failNextWrite) { fs.failNextWrite = false; throw new Error("disk full"); }
      if (fs.data != null) fs.backups.set(`data-${++n}.json`, fs.data);  // back up the OLD file
      fs.data = contents;
      fs.writes++;
    },
    async quarantine() {
      fs.quarantined.push(fs.data);
      const name = `data.json.corrupt-${++n}`;
      fs.data = null;
      return name;
    },
    async backups() {
      return [...fs.backups.keys()].reverse().map(name => ({ name, bytes: 0, modified: 0 }));
    },
    async readBackup(name) {
      if (!fs.backups.has(name)) throw new Error("no such backup");
      return fs.backups.get(name);
    },
    async openFolder() {},
  };
}

console.log("=== Rust write protocol (docs/02-TRD.md §5.3) ===");
const rs = stripComments(read("src-tauri/src/storage.rs"));
check(/fn storage_write/.test(rs), "storage_write exists");
// The order of these steps IS the guarantee.
const w = rs.slice(rs.indexOf("fn storage_write"));
const iBackup = w.indexOf("fs::copy");
const iTmp    = w.indexOf("File::create(&tmp)");
const iSync   = w.indexOf("sync_all");
const iRename = w.indexOf("fs::rename");
check(iBackup >= 0 && iTmp > iBackup, "1. backs up the CURRENT file before writing anything");
check(iTmp >= 0 && iSync > iTmp, "2. writes to a temp file");
check(iSync >= 0 && iRename > iSync, "3. fsyncs before renaming — bytes are on disk first");
check(iRename >= 0, "4. atomic rename replaces the real file last");
check(/prune/.test(w.slice(iRename)), "5. prunes old backups afterwards");
check(/KEEP_BACKUPS: usize = 20/.test(rs), "keeps 20 backups");
check(/files\.sort_by_key/.test(rs) && /take\(files\.len\(\) - KEEP_BACKUPS\)/.test(rs),
      "prune removes the OLDEST, not an arbitrary set");

console.log("\n=== portable-mode resolution (docs/02-TRD.md §5.2) ===");
check(/current_exe/.test(rs), "looks next to the exe first");
check(/fn is_writable/.test(rs), "  ...but only if that folder is actually writable");
check(/File::create\(&probe\)/.test(rs), "  ...tested by creating a probe file, not assumed");
check(/app_data_dir/.test(rs), "falls back to the app data dir");
check(/portable/.test(rs), "reports which mode it is in");

console.log("\n=== nothing unreadable is destroyed ===");
check(/fn storage_quarantine/.test(rs), "quarantine command exists");
check(/fs::rename\(&path, &dest\)/.test(rs), "  ...it MOVES the file aside rather than deleting it");
check(!/fs::remove_file\(&path\)/.test(rs), "  ...and never removes the data file outright");
check(/name\.contains\("\.\."\)/.test(rs), "backup names are path-traversal checked");

console.log("\n=== capabilities stay narrow ===");
const caps = JSON.parse(read("src-tauri/capabilities/default.json"));
check(!caps.permissions.some(p => p.startsWith("fs:")),
      "NO fs: scope granted — file access goes through named Rust commands instead");
check(caps.permissions.includes("dialog:allow-save"), "dialog save allowed");
check(caps.permissions.includes("dialog:allow-open"), "dialog open allowed");

console.log("\n=== backend is pluggable; browser keeps localStorage ===");
eq(store.storageBackend().kind, "localStorage", "default backend is localStorage");
eq(desktop.desktopStorage(), null, "desktopStorage() is null outside Tauri");
const fake = fakeFileBackend();
store.setStorageBackend(fake);
eq(store.storageBackend().kind, "file", "backend can be swapped");
await store.refreshStorageInfo();
eq(store.state.storageInfo.portable, true, "storage info is cached for the (sync) renderer");
eq(store.state.storageInfo.path, "C:\\app\\data.json", "  ...including the resolved path");

console.log("\n=== round trip through the file backend ===");
await reload(store, SEED);
eq(store.activeLocations().length, 15, "first run seeds when the file is absent");
store.commitLocation({ id: null, name: "Ancient Debris", dimension: "nether", x: -212, y: 14, z: 88,
                       type: "mine", tags: [], notes: "", linkedPortalId: null, favorite: false });
await store.flush();
check(fake.fs.data != null, "data written to the file");
check(fake.fs.data.includes("\n  "), "written pretty-printed — the file stays hand-editable (P2)");
await reload(store, SEED);
eq(store.activeLocations().length, 16, "reopened with the added location");
check(store.activeLocations().some(l => l.name === "Ancient Debris"), "  ...and it is the right one");

console.log("\n=== every write leaves a backup of the PREVIOUS contents ===");
const before = fake.fs.backups.size;
store.commitLocation({ ...store.activeLocations()[0], name: "Renamed" });
await store.flush();
eq(fake.fs.backups.size, before + 1, "a backup was created");
const newest = [...fake.fs.backups.values()].pop();
check(!newest.includes("Renamed"), "the backup holds the OLD contents, not the new");

console.log("\n=== S7: a failed write never loses in-memory data ===");
const good = fake.fs.data;
fake.fs.failNextWrite = true;
store.commitLocation({ ...store.activeLocations()[0], name: "Should Not Persist" });
await store.flush();
eq(fake.fs.data, good, "the file on disk is UNCHANGED after a failed write");
check(store.activeLocations().some(l => l.name === "Should Not Persist"),
      "the change is still in memory — nothing was silently discarded");
check(/Could not save/.test(store.state.notice?.text ?? ""), "and the failure is visible to the user");

console.log("\n=== S2: corrupt file -> quarantined, recovered from backup ===");
const f2 = fakeFileBackend();
store.setStorageBackend(f2);
await reload(store, SEED);
store.commitLocation({ id: null, name: "Precious Coordinate", dimension: "overworld",
                       x: 1, y: 2, z: 3, type: "misc", tags: [], notes: "", linkedPortalId: null, favorite: false });
await store.flush();
store.commitLocation({ ...store.activeLocations()[0], name: "Another Edit" });
await store.flush();
check(f2.fs.backups.size >= 1, "backups exist before the corruption");

f2.fs.data = "{ this is not json";                    // fault injection
const rec = await reload(store, SEED);
check(f2.fs.quarantined.includes("{ this is not json"), "the corrupt file was QUARANTINED, not overwritten");
check(store.activeLocations().some(l => l.name === "Precious Coordinate"),
      "S2 the user's data came back FROM A BACKUP, not from the seed");
check(/Recovered/.test(rec.notice.text), "  ...and the banner says so");
check(/corrupt-/.test(rec.notice.text), "  ...naming where the bad file went");

console.log("\n=== recovery skips unusable backups ===");
const f3 = fakeFileBackend();
store.setStorageBackend(f3);
await reload(store, SEED);
await store.flush();
f3.fs.backups.set("data-99.json", "{ truncated");     // newest, but broken
f3.fs.backups.set("data-98.json", JSON.stringify({
  app: "blockbook", schemaVersion: 1,
  worlds: [{ id: "w_main", name: "W", edition: "java", gameVersion: "1.21", seed: null,
             createdAt: new Date().toISOString(),
             locations: [{ id: "x", name: "From Older Backup", dimension: "overworld",
                           x: 1, y: 1, z: 1, type: "misc", tags: [], notes: "",
                           linkedPortalId: null, favorite: false,
                           createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }],
  settings: {},
}));
f3.fs.data = "}}} broken";
await reload(store, SEED);
check(store.activeLocations().some(l => l.name === "From Older Backup"),
      "a truncated newest backup is skipped and an older valid one is used");

console.log("\n=== S3: a newer schema is still refused, and NOT overwritten ===");
const f4 = fakeFileBackend();
f4.fs.data = JSON.stringify({ app: "blockbook", schemaVersion: 99, worlds: [], settings: {} });
store.setStorageBackend(f4);
await reload(store, SEED);
eq(store.state.fatal, true, "refuses to load");
eq(store.state.data, null, "  ...and loads nothing");
await store.writeNow();
check(f4.fs.data.includes('"schemaVersion":99'), "  ...and never writes over it");

console.log("\n=== first run materialises the file (regression) ===");
/*
 * Caught on the real exe: a fresh install created NO data.json at all, because
 * saves only happen on mutation. Settings showed a path to a file that did not
 * exist, and "copy the folder to another PC" would have carried nothing.
 */
check(/state\.storageInfo && !state\.storageInfo\.exists/.test(mainSrc0()),
      "boot writes the file when it does not exist yet");
check(/!state\.fatal && state\.data && state\.storageInfo/.test(mainSrc0()),
      "  ...but never when the load was fatal (newer schema must not be touched)");
function mainSrc0() { return readSrc("main.js"); }

const f5 = fakeFileBackend();
store.setStorageBackend(f5);
await reload(store, SEED);
eq(f5.fs.data, null, "nothing is written merely by loading");
// Simulate what boot() now does.
await store.refreshStorageInfo();
if (!store.state.fatal && store.state.data && !store.state.storageInfo.exists) await store.writeNow();
check(f5.fs.data != null, "after boot's first-run write, the file exists");
eq(JSON.parse(f5.fs.data).worlds[0].locations.length, 15, "  ...holding the seeded locations");
eq(f5.fs.backups.size, 0, "  ...and it did not back up a file that never existed");

console.log("\n=== a UTF-8 BOM must not make the file look corrupt (regression) ===");
/*
 * Caught end-to-end: Windows Notepad writes UTF-8 WITH a BOM by default, and
 * JSON.parse throws on one. Principle P2 promises data.json is hand-editable
 * with any text editor — without BOM tolerance, saving it from Notepad would
 * get the file quarantined as corrupt. Applies to backups and imports too.
 */
const util = await import("../src/util.js");
const BOM = "﻿";
eq(util.stripBom(BOM + "{}"), "{}", "stripBom removes a leading BOM");
eq(util.stripBom("{}"), "{}", "  ...and leaves clean text alone");
eq(util.stripBom(""), "", "  ...and tolerates an empty string");
check(util.parseJson(BOM + '{"a":1}').a === 1, "parseJson accepts a BOM-prefixed document");
let threw = false;
try { util.parseJson("{ nope"); } catch { threw = true; }
check(threw, "  ...but still throws on genuinely bad JSON");

const f7 = fakeFileBackend();
store.setStorageBackend(f7);
await reload(store, SEED);
await store.writeNow();                     // flush() is a no-op with nothing pending
check(f7.fs.data != null, "sanity: the file has contents before the BOM is added");
// Simulate the user opening data.json in Notepad and saving it back.
f7.fs.data = BOM + f7.fs.data;
const withBom = await reload(store, SEED);
eq(store.activeLocations().length, 15, "a BOM-prefixed data.json still loads");
eq(f7.fs.quarantined.length, 0, "  ...and is NOT quarantined as corrupt");
eq(withBom.notice, null, "  ...with no scary banner");

// Backups written by hand get the same treatment.
const f8 = fakeFileBackend();
store.setStorageBackend(f8);
await reload(store, SEED);
store.commitLocation({ id: null, name: "BOM Survivor", dimension: "overworld", x: 4, y: 4, z: 4,
                       type: "misc", tags: [], notes: "", linkedPortalId: null, favorite: false });
await store.writeNow();
check(f8.fs.data?.includes("BOM Survivor"), "sanity: the backup source contains the marker");
f8.fs.backups.set("data-bom.json", BOM + f8.fs.data);
f8.fs.data = "{ corrupt";
await reload(store, SEED);
check(store.activeLocations().some(l => l.name === "BOM Survivor"),
      "a BOM-prefixed BACKUP is still usable for recovery");

console.log("\n=== recovery is PERSISTED, not left in memory (regression) ===");
/*
 * Caught end-to-end on the real exe: after recovering from a backup, no
 * data.json existed at all. loadData quarantines the corrupt file, so a
 * storageInfo snapshot taken BEFORE the load still said "exists: true" and the
 * materialise step skipped. The refresh must happen after the load.
 */
const bootSrc = readSrc("main.js");
const iLoad    = bootSrc.indexOf("await loadData(seed)");
const iRefresh = bootSrc.indexOf("await refreshStorageInfo()", iLoad);
const iWrite   = bootSrc.indexOf("await writeNow()", iLoad);
check(iLoad > 0 && iRefresh > iLoad, "storage info is refreshed AFTER loadData");
check(iWrite > iRefresh, "  ...and the materialise check runs after that refresh");

const f6 = fakeFileBackend();
store.setStorageBackend(f6);
await reload(store, SEED);
store.commitLocation({ id: null, name: "Survivor", dimension: "overworld", x: 7, y: 7, z: 7,
                       type: "misc", tags: [], notes: "", linkedPortalId: null, favorite: false });
await store.flush();
await store.flush();                                   // ensure a backup exists
f6.fs.backups.set("data-manual.json", f6.fs.data);
f6.fs.data = "{ corrupt";
await reload(store, SEED);
check(store.activeLocations().some(l => l.name === "Survivor"), "recovered the data");
eq(f6.fs.data, null, "the corrupt file is gone (quarantined), so nothing is on disk yet");
// Now the boot sequence, in the fixed order.
await store.refreshStorageInfo();
eq(store.state.storageInfo.exists, false, "post-load refresh sees the file is MISSING");
if (!store.state.fatal && store.state.data && !store.state.storageInfo.exists) await store.writeNow();
check(f6.fs.data != null, "recovery is written back to disk");
check(JSON.parse(f6.fs.data).worlds[0].locations.some(l => l.name === "Survivor"),
      "  ...and it is the recovered data, not the seed");

console.log("\n=== migration from localStorage happens once, non-destructively ===");
const mainSrc = readSrc("main.js");
check(/migrateLocalStorageToFile/.test(mainSrc), "a one-time migration exists");
check(/if \(info\.exists\) return null/.test(mainSrc), "  ...skipped once the file exists");
check(/left untouched|left in place/i.test(mainSrc), "  ...and the localStorage copy is NOT deleted");
check(!/localStorage\.removeItem/.test(stripComments(mainSrc)), "  ...verified: nothing removes it");

console.log("\n=== flush before the window can sit hidden for hours ===");
check(/flush\(\)\.then\(hideWindow\)/.test(mainSrc), "Esc-to-hide flushes first");
check(/beforeunload/.test(readSrc("store.js")) && /pagehide/.test(readSrc("store.js")),
      "and on page teardown");

console.log("\n=== bulk operations back up BEFORE touching data (ADR-007) ===");
const storeSrc = readSrc("store.js");
check(/await backupNow\(mode === "replace"/.test(storeSrc), "JSON import awaits its backup");
check(/await backupNow\("before-text-import"\)/.test(storeSrc), "text import awaits its backup");
check(/async function commitJsonImport/.test(storeSrc), "  ...so the commit is async");
check(/async function commitTextImport/.test(storeSrc), "  ...both of them");

console.log("\n=== Settings answers 'where is my data?' ===");
const viewsSrc = readSrc("views.js");
check(/storage-path/.test(viewsSrc), "the resolved path is shown");
check(/info\?\.portable/.test(viewsSrc), "portable mode is explained");
check(/data-act="open-folder"/.test(viewsSrc), "there is an Open folder button");
check(/backup_count/.test(viewsSrc), "the backup count is shown");

console.log("\n=== native dialogs, narrowly scoped ===");
const dlg = stripComments(read("src-tauri/src/dialogs.rs"));
check(/blocking_save_file/.test(dlg), "export uses a real save-as dialog");
check(/blocking_pick_file/.test(dlg), "import uses a real open dialog");
check(/add_filter\("JSON"/.test(dlg), "filtered to .json");
check(/return Ok\(None\)/.test(dlg), "cancelling is not an error");
check(!/read_dir|remove_file/.test(dlg), "the dialog commands cannot enumerate or delete anything");

store.setStorageBackend(null);   // leave the module as we found it
eq(store.storageBackend().kind, "localStorage", "backend resets cleanly");

done();
