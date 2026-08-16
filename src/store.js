/* ==========================================================================
   BlockBook — store.js
   Application state, persistence, and every mutation.
   Knows nothing about the DOM. docs/02-TRD.md §5
   ========================================================================== */

import { esc, parseJson } from "./util.js";
import { DEFAULT_SETTINGS, DIMENSIONS, SCHEMA_VERSION, UNSAFE_HOTKEYS, buildInitialData, normaliseLocation, repairPortalLinks } from "./schema.js";
import { mergeLocations } from "./locations.js";

let state = {
  data: null,          // set by boot()
  notice: null,        // {kind:"error"|"info", text} — rendered as a banner
  fatal: false,        // true = refuse to touch storage (e.g. newer schema)
  toast: null,
  // Cached backend.info(). Rendering is synchronous, so the async lookup is
  // done at boot and refreshed when Settings opens.
  storageInfo: null,
  ui: {
    activeTab:      "coordinates",   // coordinates | portals | brewing | reference
    search:         "",
    filters:        { dimension: null, type: null },
    sort:           "updated",       // name | type | updated
    editingId:      null,
    modal:          null,            // null | "edit" | "confirm-delete"
    draft:          null,            // in-progress form values
    confirmId:      null,
    ignoreConflict: false,           // per-edit-session only; never persisted
    conv:           { src: "overworld", x: "", z: "" },   // Portals tab converter
    // "What's near me?" — raw strings for the same typing reason as the draft.
    near:           { dimension: "overworld", x: "", y: "", z: "", sameOnly: false },
    import:         { rows: [], unrecognised: [] },
    pendingImport:  null,
    brewHave:       "",
    returnFocusId:  null,
    // One slice per reference table. Phase 12 adds enchanting/mobs/fuel here
    // without touching refTableHTML.
    ref: {
      brewing: { search: "", sortKey: "name", sortDir: "asc", filters: {}, selectedId: null },
    },
    recentlyViewed: [],
  },
};

/** Locations of the active world. */
function activeLocations() {
  if (!state.data) return [];
  const w = state.data.worlds.find(w => w.id === state.data.settings.activeWorldId)
         ?? state.data.worlds[0];
  return w.locations;
}


/* ==========================================================================
   STORE — docs/02-TRD.md §5, §8
   v0.x persists to localStorage. Phase 10 swaps this for data.json with atomic
   writes and rolling backups; the serialised shape is identical, so that is a
   transport change, not a schema change.
   ========================================================================== */

const STORAGE_KEY = "blockbook.data";

const SAVE_DEBOUNCE_MS = 400;

let saveTimer = null;

let saveStatus = "saved";   // saved | saving | error

/**
 * The localStorage backend — the browser default, and the v0.x behaviour.
 * Phase 10 adds a file backend with the same shape; store.js never learns which
 * one it is talking to. docs/02-TRD.md §5
 */
const localStorageBackend = {
  kind: "localStorage",
  async info() {
    return { path: STORAGE_KEY, dir: "browser localStorage", portable: false,
             exists: localStorage.getItem(STORAGE_KEY) != null, backup_count: 0 };
  },
  async read() { return localStorage.getItem(STORAGE_KEY); },
  async write(contents) { localStorage.setItem(STORAGE_KEY, contents); },
  async quarantine() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const key = `${STORAGE_KEY}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    if (raw != null) localStorage.setItem(key, raw);
    return key;
  },
  async backups() { return []; },
  async readBackup() { throw new Error("No backups in localStorage"); },
  async openFolder() { throw new Error("No folder to open"); },
};

let backend = localStorageBackend;

/** Swap the persistence layer. main.js installs the file backend on desktop. */
function setStorageBackend(next) {
  backend = next ?? localStorageBackend;
}

function storageBackend() { return backend; }

/** Refresh the cached storage info (path, portable flag, backup count). */
async function refreshStorageInfo() {
  try {
    state.storageInfo = { ...(await backend.info()), kind: backend.kind };
  } catch {
    state.storageInfo = { path: STORAGE_KEY, dir: "", portable: false, kind: backend.kind, backup_count: 0 };
  }
  return state.storageInfo;
}

/**
 * Quarantine unreadable data instead of overwriting it. The user's coordinates
 * are not reconstructible, so a bad parse must never cost them the file.
 */
async function quarantine() {
  try { return await backend.quarantine(); }
  catch { return "(could not quarantine)"; }
}

/**
 * @param {Object[]} seedLocations  the first-run fallback, fetched from
 *   data/seed.json by main.js. Passed in rather than inlined so the module has
 *   no build-time data dependency and tests can supply their own fixture.
 */
/**
 * Try the newest valid backup before giving up and seeding.
 *
 * Walks them newest-first: a backup can itself be truncated if the crash landed
 * mid-copy, so "newest" is not automatically "usable".
 * @returns {Promise<{data: Object, how: string}>}
 */
async function recoverFromBackup(seedLocations) {
  let list = [];
  try { list = await backend.backups(); } catch { /* no backups available */ }

  for (const b of list) {
    try {
      const text = await backend.readBackup(b.name);
      const doc = parseJson(text);
      if (doc?.app !== "blockbook") continue;
      if (Number(doc.schemaVersion ?? 1) > SCHEMA_VERSION) continue;
      const locs = (doc.worlds?.[0]?.locations ?? [])
        .map((l, i) => normaliseLocation(l, i, l.createdAt ?? new Date().toISOString()));
      repairPortalLinks(locs);
      doc.worlds[0].locations = locs;
      doc.settings = { ...DEFAULT_SETTINGS, ...(doc.settings ?? {}) };
      return { data: doc, how: `Recovered ${locs.length} locations from backup <code>${esc(b.name)}</code>.` };
    } catch { /* try the next one */ }
  }

  return {
    data: buildInitialData(seedLocations).data,
    how: "No usable backup was found, so the starter data was loaded instead.",
  };
}

async function loadData(seedLocations) {
  let raw = null;
  try { raw = await backend.read(); }
  catch (err) { return { data: buildInitialData(seedLocations).data,
                   notice: { kind: "error", text: `Storage is unavailable (${esc(String(err?.message ?? err))}) — changes will not persist this session.` } }; }

  if (!raw) {
    // Not an error: first run. Seed it.
    return { data: buildInitialData(seedLocations).data, notice: null };
  }

  let parsed;
  try {
    parsed = parseJson(raw);
  } catch {
    // Move it aside, then try the newest backup before falling back to seed —
    // a corrupt file should cost you the last write, not the whole world.
    const key = await quarantine();
    const rescued = await recoverFromBackup(seedLocations);
    return {
      data: rescued.data,
      notice: { kind: "error", text: `Saved data was unreadable. It has been kept at <code>${esc(key)}</code>. ${rescued.how}` },
    };
  }

  if (parsed?.app !== "blockbook") {
    const key = await quarantine();
    const rescued = await recoverFromBackup(seedLocations);
    return {
      data: rescued.data,
      notice: { kind: "error", text: `Saved data is not a BlockBook file. It has been kept at <code>${esc(key)}</code>. ${rescued.how}` },
    };
  }

  const found = Number(parsed.schemaVersion ?? 1);
  if (found > SCHEMA_VERSION) {
    // Refuse. Never migrate downward. docs/02-TRD.md §8
    return {
      data: null,
      fatal: true,
      notice: { kind: "error", text: `This data was written by a newer version of BlockBook (schema ${found}; this build understands ${SCHEMA_VERSION}). Nothing has been changed. Update the app, or open an older export.` },
    };
  }

  // found < SCHEMA_VERSION would run migrations here. There are none at v1.

  const locations = (parsed.worlds?.[0]?.locations ?? []).map((l, i) => normaliseLocation(l, i, l.createdAt ?? new Date().toISOString()));
  const repairs = repairPortalLinks(locations);
  parsed.worlds[0].locations = locations;
  parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) };

  // The original Ctrl+Space default collided with Minecraft's sprint-jump, so
  // every jump summoned the app. Saved settings keep the old value, which means
  // fixing only the default would never reach an existing install.
  const notices = [];
  if (UNSAFE_HOTKEYS.has(parsed.settings.hotkey)) {
    const old = parsed.settings.hotkey;
    parsed.settings.hotkey = DEFAULT_SETTINGS.hotkey;
    notices.push(`Summon hotkey changed from <code>${esc(old)}</code> to <code>${esc(DEFAULT_SETTINGS.hotkey)}</code> — the old one clashed with Minecraft's sprint-jump. Change it in Settings.`);
  }
  if (repairs.length) {
    notices.push(`Repaired ${repairs.length} portal link(s) on load: ${esc(repairs.join("; "))}`);
  }

  return {
    data: parsed,
    notice: notices.length ? { kind: "info", text: notices.join(" ") } : null,
  };
}

/**
 * Called after every write so the UI can reflect the save status.
 *
 * A callback, not a direct render call: store.js sits BELOW views.js in the
 * dependency graph and must not know the DOM exists. main.js installs the real
 * one at boot. docs/02-TRD.md §4
 */
let onSaveStatusChange = () => {};
function setSaveStatusListener(fn) { onSaveStatusChange = fn ?? (() => {}); }

async function writeNow() {
  if (state.fatal || !state.data) return;
  try {
    // The backend owns the write protocol: back up, temp file, fsync, atomic
    // rename, prune. docs/02-TRD.md §5.3
    await backend.write(JSON.stringify(state.data, null, 2));
    saveStatus = "saved";
    if (state.notice?.kind === "error" && /Could not save/.test(state.notice.text)) {
      state.notice = null;                 // a later write succeeded; clear the alarm
    }
  } catch (err) {
    // Keep the in-memory state and surface it. Never silently discard a change.
    saveStatus = "error";
    state.notice = { kind: "error", text: `Could not save: ${esc(String(err?.message ?? err))}. Your changes are still here, but they are not written to disk.` };
  }
  onSaveStatusChange();
}

/** Debounced so typing in a notes field does not write on every keystroke. */
function save() {
  if (state.fatal) return;
  saveStatus = "saving";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, SAVE_DEBOUNCE_MS);
}

/**
 * Flush any pending write. Called before the page goes away, and — importantly
 * on desktop — before hiding to tray, since a hidden window may sit for hours.
 */
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; return writeNow(); }
  return Promise.resolve();
}

window.addEventListener("beforeunload", flush);
window.addEventListener("pagehide", flush);


/* ==========================================================================
   MUTATIONS
   Every mutation goes through here: touch updatedAt, repair links, save,
   render. Nothing reaches into the DOM to patch a single node.
   ========================================================================== */

function newId() {
  return (crypto?.randomUUID?.() ?? `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
}

/**
 * Point `loc` at `partnerId`, writing BOTH sides and unhooking whoever either
 * side was previously paired with.
 *
 * Without the unhooking step, re-pairing leaves a third portal pointing at a
 * partner that no longer points back, and repairPortalLinks would then "repair"
 * it by flipping the new link back — an order-dependent tug of war.
 */
function setPortalLink(loc, partnerId, all) {
  const byId = (id) => (id ? all.find(l => l.id === id) : null);
  const now = new Date().toISOString();

  const myOld = byId(loc.linkedPortalId);
  if (myOld && myOld.id !== partnerId) { myOld.linkedPortalId = null; myOld.updatedAt = now; }

  const partner = byId(partnerId);
  if (partner) {
    const theirOld = byId(partner.linkedPortalId);
    if (theirOld && theirOld.id !== loc.id) { theirOld.linkedPortalId = null; theirOld.updatedAt = now; }
    partner.linkedPortalId = loc.id;
    partner.updatedAt = now;
  }

  loc.linkedPortalId = partnerId ?? null;
}

function commitLocation(draft) {
  const now = new Date().toISOString();
  const locs = activeLocations();
  const existing = locs.find(l => l.id === draft.id);
  const wantedLink = draft.linkedPortalId ?? null;

  let target;
  if (existing) {
    Object.assign(existing, draft, {
      createdAt: existing.createdAt,
      updatedAt: now,
      linkedPortalId: existing.linkedPortalId,   // handled by setPortalLink below
    });
    target = existing;
  } else {
    target = normaliseLocation(
      { ...draft, id: draft.id ?? newId(), linkedPortalId: null, createdAt: now, updatedAt: now },
      locs.length, now);
    locs.push(target);
  }

  setPortalLink(target, target.type === "portal" ? wantedLink : null, locs);
  repairPortalLinks(locs);
  save();
  return existing ? "updated" : "added";
}

function deleteLocation(id) {
  const locs = activeLocations();
  const i = locs.findIndex(l => l.id === id);
  if (i === -1) return null;
  const [gone] = locs.splice(i, 1);

  // Any portal that pointed at the deleted record now dangles — I2 clears it.
  repairPortalLinks(locs);
  save();
  return gone;
}

/**
 * Snapshot the current data before anything bulk touches it.
 * docs/10-DECISIONS-AND-RISKS.md ADR-007/ADR-008 — a backup is written before
 * every import, without exception.
 */
/**
 * Snapshot before anything bulk touches the data (ADR-007/ADR-008).
 *
 * On the file backend a normal write already creates a timestamped backup, so
 * this just forces one immediately rather than waiting for the debounce — the
 * point is that a backup exists *before* the import, not after.
 */
async function backupNow(reason) {
  if (state.fatal || !state.data) return null;
  if (backend.kind === "file") {
    await writeNow();                       // writes, and backs up the prior file
    return `${reason} (backup written)`;
  }
  const key = `${STORAGE_KEY}.backup-${reason}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try { localStorage.setItem(key, JSON.stringify(state.data)); return key; }
  catch { return null; }
}

function exportPayload() {
  return JSON.stringify(state.data, null, 2);   // 2-space indent, hand-editable
}

/**
 * Commit a JSON import. Merge appends and never overwrites; replace wipes, and
 * only ever reaches here after an explicit second confirmation.
 * @returns {{added:number, skipped:number, mode:string}}
 */
async function commitJsonImport(locations, mode) {
  // Awaited, not fired-and-forgotten: the whole point is that the backup exists
  // BEFORE the data is replaced. ADR-007.
  await backupNow(mode === "replace" ? "before-replace" : "before-merge");

  const now = new Date().toISOString();
  const incoming = locations.map((l, i) => normaliseLocation(l, i, l.createdAt ?? now));
  const world = state.data.worlds[0];

  let added = 0, skipped = 0;
  if (mode === "replace") {
    world.locations = incoming;
    added = incoming.length;
  } else {
    const r = mergeLocations(world.locations, incoming);
    world.locations.push(...r.added);
    added = r.added.length;
    skipped = r.skipped.length;
  }

  repairPortalLinks(world.locations);
  await flush();               // bulk changes are written immediately, not debounced
  return { added, skipped, mode };
}

/** Commit the reviewed Notepad rows. Always appends. */
async function commitTextImport(rows) {
  await backupNow("before-text-import");

  const now = new Date().toISOString();
  const locs = activeLocations();
  const accepted = rows.filter(r => r.checked && DIMENSIONS.includes(r.dimension));

  for (const r of accepted) {
    locs.push(normaliseLocation({
      id: newId(),
      name: r.name.trim() || "(unnamed)",
      dimension: r.dimension,
      x: r.x, y: r.y, z: r.z,
      type: r.type,
      tags: ["imported"],
      notes: `Imported from text: "${r.raw}"`,
      linkedPortalId: null,
      favorite: false,
      createdAt: now, updatedAt: now,
    }, locs.length, now));
  }

  repairPortalLinks(locs);
  await flush();
  return accepted.length;
}

function toggleFavorite(id) {
  const loc = activeLocations().find(l => l.id === id);
  if (!loc) return;
  loc.favorite = !loc.favorite;
  loc.updatedAt = new Date().toISOString();
  save();
}


/* ==========================================================================
   FORM DRAFT
   ========================================================================== */

/*
 * The draft holds the coordinate and tag fields as RAW STRINGS, not parsed
 * values. The modal re-renders on every keystroke, so if it wrote back a parsed
 * value the user could never type a lone "-" (Number("-") is NaN, so the minus
 * sign would vanish before they reached the digits) or a trailing "," in tags.
 * Parse on demand instead, via draftToLocation().
 */

/**
 * Reftable interactions. Entirely generic — the handler knows only the table id
 * from `data-ref`, never what the table contains.
 */
function refSlice(id) {
  return (state.ui.ref[id] ??= { search: "", sortKey: null, sortDir: "asc", filters: {}, selectedId: null });
}

export {
  setStorageBackend,
  storageBackend,
  refreshStorageInfo,
  localStorageBackend,
  recoverFromBackup,
  setSaveStatusListener,
  state,
  activeLocations,
  STORAGE_KEY,
  SAVE_DEBOUNCE_MS,
  saveTimer,
  saveStatus,
  quarantine,
  loadData,
  writeNow,
  save,
  flush,
  newId,
  setPortalLink,
  commitLocation,
  deleteLocation,
  backupNow,
  exportPayload,
  commitJsonImport,
  commitTextImport,
  toggleFavorite,
  refSlice,
};
