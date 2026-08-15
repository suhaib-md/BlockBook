/* ==========================================================================
   BlockBook — store.js
   Application state, persistence, and every mutation.
   Knows nothing about the DOM. docs/02-TRD.md §5
   ========================================================================== */

import { esc } from "./util.js";
import { DEFAULT_SETTINGS, DIMENSIONS, SCHEMA_VERSION, UNSAFE_HOTKEYS, buildInitialData, normaliseLocation, repairPortalLinks } from "./schema.js";
import { mergeLocations } from "./locations.js";

let state = {
  data: null,          // set by boot()
  notice: null,        // {kind:"error"|"info", text} — rendered as a banner
  fatal: false,        // true = refuse to touch storage (e.g. newer schema)
  toast: null,
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
 * Quarantine unreadable data instead of overwriting it. The user's coordinates
 * are not reconstructible, so a bad parse must never cost them the file.
 */
function quarantine(raw, why) {
  const key = `${STORAGE_KEY}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try { localStorage.setItem(key, raw); } catch { /* storage full — nothing safe to do */ }
  return key;
}

/**
 * @param {Object[]} seedLocations  the first-run fallback, fetched from
 *   data/seed.json by main.js. Passed in rather than inlined so the module has
 *   no build-time data dependency and tests can supply their own fixture.
 */
function loadData(seedLocations) {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); }
  catch { return { data: buildInitialData(seedLocations).data,
                   notice: { kind: "error", text: "localStorage is unavailable — changes will not persist this session." } }; }

  if (!raw) {
    // Not an error: first run. Seed it.
    return { data: buildInitialData(seedLocations).data, notice: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const key = quarantine(raw);
    return {
      data: buildInitialData(seedLocations).data,
      notice: { kind: "error", text: `Saved data was unreadable. It has been kept at <code>${esc(key)}</code> and the seed data loaded instead. Nothing was overwritten.` },
    };
  }

  if (parsed?.app !== "blockbook") {
    const key = quarantine(raw);
    return {
      data: buildInitialData(seedLocations).data,
      notice: { kind: "error", text: `Saved data is not a BlockBook file. It has been kept at <code>${esc(key)}</code>.` },
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

function writeNow() {
  if (state.fatal || !state.data) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    saveStatus = "saved";
  } catch (err) {
    // Keep the in-memory state and surface it. Never silently discard a change.
    saveStatus = "error";
    state.notice = { kind: "error", text: `Could not save: ${esc(err.message)}. Your changes are still here, but they are not written to disk.` };
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

/** Flush any pending write. Called before the page goes away. */
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeNow(); }
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
function backupNow(reason) {
  if (state.fatal || !state.data) return null;
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
function commitJsonImport(locations, mode) {
  backupNow(mode === "replace" ? "before-replace" : "before-merge");

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
  flush();                     // bulk changes are written immediately, not debounced
  return { added, skipped, mode };
}

/** Commit the reviewed Notepad rows. Always appends. */
function commitTextImport(rows) {
  backupNow("before-text-import");

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
  flush();
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
