/* ==========================================================================
   BlockBook — main.js
   Bootstrap, the single render path, and all event wiring.
   ========================================================================== */

import { esc, parseJson } from "./util.js";
import { blankDraft, buildImportRows, draftFrom, draftToLocation, exportFilename, pushRecent, tpCommand, validateImportPayload, validateLocation } from "./locations.js";
import { activeLocations, commitJsonImport, commitLocation, commitTextImport, deleteLocation,
         exportPayload, flush, loadData, localStorageBackend, refreshStorageInfo, refSlice, save,
         setSaveStatusListener, setStorageBackend, state, storageBackend, toggleFavorite,
         writeNow } from "./store.js";
import { $, TABS, renderBanner, renderModal, renderPanel, renderStatusBar, renderTabs, renderToast, renderToolbar } from "./views.js";
import { applyHotkey, copyText, desktopStorage, exportDialog, hideWindow, importDialog,
         isDesktop, onWindowShown, setAlwaysOnTop } from "./desktop.js";

let toastTimer = null;

function toast(msg) {
  state.toast = msg;
  renderToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; renderToast(); }, 2500);
}

/**
 * Re-rendering blows away the focused element, which would make the search box
 * unusable. Capture what had focus and where the caret was, then restore it.
 * This keeps the single full-render path (ADR-002) without breaking typing.
 */
function withPreservedFocus(fn) {
  const el = document.activeElement;
  const id = el?.id;
  const start = el?.selectionStart, end = el?.selectionEnd;
  fn();
  if (!id) return;
  const next = document.getElementById(id);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (start != null && next.setSelectionRange) {
    try { next.setSelectionRange(start, end); } catch { /* not a text input */ }
  }
}

function render() {
  withPreservedFocus(() => {
    document.documentElement.dataset.theme = state.data?.settings?.theme ?? "dark";
    renderBanner();
    renderTabs();
    renderToolbar();
    renderPanel();
    renderStatusBar();
    renderModal();
  });
}


/* ==========================================================================
   EVENTS
   Delegated from the document so a full re-render never orphans a listener.
   ========================================================================== */

/**
 * Push the hotkey setting to the OS and report honestly if it did not take.
 * A combo owned by another app must surface as a visible message, not silence —
 * otherwise the user presses it, nothing happens, and there is no clue why.
 */
async function registerHotkey(accelerator, { announce = false } = {}) {
  const res = await applyHotkey(accelerator);
  if (!isDesktop()) return;

  if (res.ok) {
    state.notice = null;
    if (announce) {
      toast(accelerator
        ? `Summon hotkey set to ${accelerator.replace("CmdOrCtrl", "Ctrl")}`
        : "Summon hotkey disabled — use the tray icon.");
    }
  } else {
    state.notice = { kind: "error", text: esc(res.reason) };
  }
  render();
}

/** Record that a location was actually looked at. */
function noteViewed(id) {
  state.ui.recentlyViewed = pushRecent(state.ui.recentlyViewed, id);
}

/** Remember what to hand focus back to when a modal closes. */
function rememberFocus() {
  const el = document.activeElement;
  state.ui.returnFocusId = el?.id || (el?.closest?.(".card[data-id]")?.id ?? null);
}

function openAdd() {
  rememberFocus();
  state.ui.draft = blankDraft();
  state.ui.modal = "edit";
  state.ui.ignoreConflict = false;
  render();
  $("f-name")?.focus();
}

function openEdit(id) {
  const loc = activeLocations().find(l => l.id === id);
  if (!loc) return;
  rememberFocus();
  noteViewed(id);
  state.ui.draft = draftFrom(loc);
  state.ui.modal = "edit";
  state.ui.ignoreConflict = false;
  render();
  $("f-name")?.focus();
}

function closeModal() {
  const back = state.ui.returnFocusId;
  state.ui.modal = null;
  state.ui.draft = null;
  state.ui.confirmId = null;
  state.ui.ignoreConflict = false;
  state.ui.import = { rows: [], unrecognised: [] };
  state.ui.pendingImport = null;
  state.ui.returnFocusId = null;
  render();
  // Focus goes back where it came from, never to the top of the document.
  const target = back ? document.getElementById(back) : null;
  (target ?? $("search"))?.focus?.();
}

/* ---- export / import plumbing ---- */

async function doExport() {
  const text = exportPayload();
  const name = exportFilename();
  const count = activeLocations().length;

  // On desktop use a real save-as dialog; the browser gets a download.
  if (isDesktop()) {
    try {
      const path = await exportDialog(name, text);
      if (path) toast(`Exported ${count} locations to ${path}`);
      return;                                   // null = user cancelled
    } catch (err) {
      state.notice = { kind: "error", text: `Export failed: ${esc(String(err?.message ?? err))}` };
      render();
      return;
    }
  }

  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${count} locations to ${name}`);
}

/** Parse an imported payload and hand it to the merge/replace choice. */
function stageImport(text) {
  let parsed;
  try {
    parsed = parseJson(text);
  } catch (err) {
    state.notice = { kind: "error", text: `That file is not valid JSON: ${esc(err.message)}` };
    render();
    return;
  }
  const v = validateImportPayload(parsed);
  if (!v.ok) {
    state.notice = { kind: "error", text: esc(v.error) };
    render();
    return;
  }
  state.notice = null;
  state.ui.pendingImport = { locations: v.locations };
  state.ui.modal = "import-choice";
  render();
}

/** Nothing here touches state until validateImportPayload says the file is sound. */
function handleImportFile(file) {
  const reader = new FileReader();
  reader.onerror = () => {
    state.notice = { kind: "error", text: "Could not read that file." };
    render();
  };
  reader.onload = () => stageImport(String(reader.result));
  reader.readAsText(file);
}

/** Desktop import goes through the native picker instead of a hidden <input>. */
async function pickImportFile() {
  try {
    const text = await importDialog();
    if (text != null) stageImport(text);       // null = cancelled
  } catch (err) {
    state.notice = { kind: "error", text: `Import failed: ${esc(String(err?.message ?? err))}` };
    render();
  }
}

/** Read the whole form back into the draft so re-render is lossless. */
function readDraft() {
  const d = state.ui.draft;
  if (!d || !$("f-name")) return;
  d.name  = $("f-name").value;
  d.dimension = document.querySelector('input[name="f-dim"]:checked')?.value;
  d.xRaw  = $("f-x").value;
  d.yRaw  = $("f-y").value;
  d.zRaw  = $("f-z").value;
  d.type  = $("f-type").value;
  d.tagsRaw = $("f-tags").value;
  d.notes = $("f-notes").value;
  d.favorite = $("f-fav").checked;
  // The partner dropdown only exists while type === "portal".
  if ($("f-link")) d.linkedPortalId = $("f-link").value || null;
  if (d.type !== "portal") d.linkedPortalId = null;
}

document.addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  const id  = e.target.closest("[data-id]")?.dataset.id;

  // Clicking the backdrop closes; clicks inside the modal bubble to the overlay
  // but have a different target, so they are left alone.
  if (e.target.classList?.contains("overlay")) { closeModal(); return; }

  switch (act) {
    case "add":            openAdd(); return;
    case "edit":           openEdit(id); return;
    case "close":          closeModal(); return;
    case "del":
      state.ui.confirmId = id;
      state.ui.modal = "confirm-delete";
      render();
      $("focus-me")?.focus();
      return;
    case "confirm-delete": {
      const gone = deleteLocation(state.ui.confirmId);
      closeModal();
      if (gone) toast(`Deleted “${gone.name}”.`);
      return;
    }
    case "fav":            toggleFavorite(id); render(); return;
    case "clear-search":   state.ui.search = ""; render(); $("search")?.focus(); return;
    case "clear-filters":  state.ui.filters = { dimension: null, type: null }; render(); return;
    case "settings":
      state.ui.modal = "settings";
      render();
      refreshStorageInfo().then(render);   // path + backup count may have moved on
      return;
    case "select-potion":
      // Jump from a reverse-lookup hit to the expanded row in the table.
      refSlice("brewing").selectedId = id;
      refSlice("brewing").search = "";
      refSlice("brewing").filters = {};
      render();
      return;
    case "tp": {
      const loc = activeLocations().find(l => l.id === id);
      if (loc) {
        noteViewed(id);
        copyText(tpCommand(loc)).then(ok =>
          toast(ok ? `Copied ${tpCommand(loc)}` : "Could not reach the clipboard."));
      }
      return;
    }
    case "goto": {
      noteViewed(id);
      render();
      const card = document.getElementById(`card-${id}`);
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: "center" });
      return;
    }
    case "export":         doExport(); return;
    case "import-file":
      if (isDesktop()) pickImportFile(); else $("file-input")?.click();
      return;
    case "open-folder":
      storageBackend().openFolder?.().catch(() => toast("Could not open the folder."));
      return;
    case "import-text":    state.ui.modal = "import-text"; render(); $("import-text")?.focus(); return;
    case "parse-text": {
      const text = $("import-text")?.value ?? "";
      state.ui.import = buildImportRows(text);
      state.ui.modal = "import-review";
      render();
      return;
    }
    case "commit-text-import": {
      const rows = state.ui.import.rows;
      commitTextImport(rows).then(n => {
        closeModal();
        toast(`Imported ${n} location${n === 1 ? "" : "s"}.`);
      });
      return;
    }
    case "import-merge": {
      const pending = state.ui.pendingImport.locations;
      commitJsonImport(pending, "merge").then(r => {
        closeModal();
        toast(`Merged ${r.added} location${r.added === 1 ? "" : "s"}${r.skipped ? `, skipped ${r.skipped} already here` : ""}.`);
      });
      return;
    }
    case "import-replace":  state.ui.modal = "confirm-replace"; render(); return;
    case "import-replace-confirmed": {
      const pending = state.ui.pendingImport.locations;
      commitJsonImport(pending, "replace").then(r => {
        closeModal();
        toast(`Replaced everything with ${r.added} location${r.added === 1 ? "" : "s"}.`);
      });
      return;
    }
    case "link-nearest":
      state.ui.draft.linkedPortalId = id;
      state.ui.ignoreConflict = false;
      render();
      return;
    case "ignore-conflict":
      // Session-only. The condition is real and should resurface next time.
      state.ui.ignoreConflict = true;
      render();
      return;
  }

  const sortBtn = e.target.closest(".ref-sort");
  if (sortBtn) { onRefSort(sortBtn.dataset.ref, sortBtn.dataset.key); return; }

  const refRow = e.target.closest(".ref-row");
  if (refRow) { onRefSelect(refRow.dataset.ref, refRow.dataset.row); return; }

  const chip = e.target.closest("[data-filter]");
  if (chip) {
    state.ui.filters.dimension = chip.dataset.value || null;
    render();
    return;
  }

  const tab = e.target.closest("[data-tab]");
  if (tab) {
    state.ui.activeTab = tab.dataset.tab;
    render();
  }
});

/** Live bidirectional converter: whichever side is typed into becomes the source. */
function onConverterInput(el) {
  const side = el.dataset.conv;
  const axis = el.dataset.axis;
  if (state.ui.conv.src !== side) {
    // Switching sides: keep the values currently shown on that side.
    const other = axis === "x" ? "z" : "x";
    const shown = document.querySelector(`.conv-in[data-conv="${side}"][data-axis="${other}"]`)?.value ?? "";
    state.ui.conv = { src: side, x: axis === "x" ? el.value : shown, z: axis === "z" ? el.value : shown };
  } else {
    state.ui.conv[axis] = el.value;
  }
  render();
}

document.addEventListener("input", (e) => {
  if (e.target.id === "search") { state.ui.search = e.target.value; render(); return; }
  if (e.target.classList?.contains("conv-in")) { onConverterInput(e.target); return; }
  if (e.target.classList?.contains("ref-search")) {
    refSlice(e.target.dataset.ref).search = e.target.value;
    render();
    return;
  }
  if (e.target.id === "brew-have") { state.ui.brewHave = e.target.value; render(); return; }
  if (e.target.dataset?.imp === "name") { onReviewInput(e.target); return; }
  if (e.target.id === "import-text") return;   // free typing; parsed on demand
  if (state.ui.modal === "edit" && e.target.closest("#loc-form")) { readDraft(); render(); }
});

function onRefSort(id, key) {
  const s = refSlice(id);
  if (s.sortKey === key) s.sortDir = s.sortDir === "asc" ? "desc" : "asc";
  else { s.sortKey = key; s.sortDir = "asc"; }
  render();
}

function onRefSelect(id, rowId) {
  const s = refSlice(id);
  s.selectedId = s.selectedId === rowId ? null : rowId;   // click again to collapse
  render();
}

/** Review-table edits write straight back into the candidate rows. */
function onReviewInput(el) {
  const i = Number(el.dataset.i);
  const field = el.dataset.imp;
  const row = state.ui.import.rows[i];
  if (!row) return;

  if (field === "checked")   row.checked = el.checked;
  if (field === "name")      row.name = el.value;
  if (field === "type")      row.type = el.value;
  if (field === "dimension") {
    row.dimension = el.value || null;
    row.guessed = false;          // the user has now decided; drop the guess marker
    row.confident = true;
  }
  render();
}

document.addEventListener("change", (e) => {
  if (e.target.id === "sort")        { state.ui.sort = e.target.value; render(); return; }
  if (e.target.id === "type-filter") { state.ui.filters.type = e.target.value || null; render(); return; }
  if (e.target.classList?.contains("conv-in")) { onConverterInput(e.target); return; }
  if (e.target.classList?.contains("ref-filter")) {
    const s = refSlice(e.target.dataset.ref);
    s.filters = { ...s.filters, [e.target.dataset.key]: e.target.value || null };
    render();
    return;
  }
  if (e.target.dataset?.imp)         { onReviewInput(e.target); return; }
  if (e.target.id === "s-theme")     { state.data.settings.theme = e.target.value; save(); render(); return; }
  if (e.target.id === "s-coord")     { state.data.settings.coordFormat = e.target.value; save(); render(); return; }
  if (e.target.id === "s-aot") {
    state.data.settings.alwaysOnTop = e.target.checked;
    setAlwaysOnTop(e.target.checked);
    save();
    render();
    return;
  }
  if (e.target.id === "s-hotkey") {
    state.data.settings.hotkey = e.target.value;
    save();
    registerHotkey(e.target.value, { announce: true });
    render();
    return;
  }
  if (e.target.id === "file-input") {
    const f = e.target.files?.[0];
    e.target.value = "";                    // allow re-picking the same file
    if (f) handleImportFile(f);
    return;
  }
  if (state.ui.modal === "edit" && e.target.closest("#loc-form")) { readDraft(); render(); }
});

document.addEventListener("submit", (e) => {
  if (e.target.id !== "loc-form") return;
  e.preventDefault();
  readDraft();
  const loc = draftToLocation(state.ui.draft);
  const { errors } = validateLocation(loc, activeLocations());
  if (errors.length) { render(); return; }

  const what = commitLocation(loc);
  closeModal();
  toast(what === "added" ? `Added “${loc.name}”.` : `Saved “${loc.name}”.`);
});

/* --------------------------------------------------------------------------
   KEYBOARD — docs/03-APP-FLOW.md §11
   Every journey must be completable without a mouse.
   -------------------------------------------------------------------------- */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** True when the user is typing, so bare letter shortcuts must not fire. */
function isTyping(el) {
  if (!el) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}

/** Move focus between location cards; wraps into the list from the search box. */
function moveCardFocus(delta) {
  const cards = [...document.querySelectorAll(".card[data-id]")];
  if (cards.length === 0) return false;

  const current = document.activeElement?.closest?.(".card[data-id]") ?? null;
  const i = cards.indexOf(current);

  let next;
  if (i === -1) next = delta > 0 ? 0 : cards.length - 1;
  else next = Math.min(cards.length - 1, Math.max(0, i + delta));

  cards[next].focus({ preventScroll: true });
  cards[next].scrollIntoView({ block: "nearest" });
  return true;
}

/** The location a keyboard action applies to: whichever card has focus. */
function focusedLocationId() {
  return document.activeElement?.closest?.(".card[data-id]")?.dataset.id ?? null;
}

/** Keep Tab inside an open modal. docs/04-UIUX-SPEC.md §7 */
function trapTab(e) {
  const modal = document.querySelector(".modal");
  if (!modal) return;
  const items = [...modal.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
  if (items.length === 0) return;

  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
}

document.addEventListener("keydown", (e) => {
  const typing = isTyping(e.target);

  // ---- modal-scoped keys ----
  if (state.ui.modal) {
    if (e.key === "Tab") { trapTab(e); return; }
    if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && state.ui.modal === "edit") {
      e.preventDefault();
      $("loc-form")?.requestSubmit();
    }
    return;                       // nothing below applies while a modal is open
  }

  // ---- Esc cascade: modal -> search -> hide window. docs/03-APP-FLOW.md §11 ----
  if (e.key === "Escape") {
    if (state.ui.search) {
      state.ui.search = "";
      render();
      $("search")?.focus();
    } else if (isDesktop()) {
      // Flush first — a hidden window can sit for hours, and an unwritten
      // change should not wait that long.
      flush().then(hideWindow);
    } else {
      document.activeElement?.blur?.();   // a browser tab cannot hide itself
    }
    return;
  }

  // ---- focus search ----
  if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "f" && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    const box = $("search");
    if (box) { box.focus(); box.select(); }
    return;
  }

  // ---- row navigation: works from the search box too ----
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (typing && e.target.id !== "search") return;    // don't hijack other fields
    if (moveCardFocus(e.key === "ArrowDown" ? 1 : -1)) e.preventDefault();
    return;
  }

  // ---- act on the focused row ----
  if (e.key === "Enter" && !typing) {
    const id = focusedLocationId();
    if (!id) return;
    e.preventDefault();
    if (e.shiftKey) { openEdit(id); return; }
    const loc = activeLocations().find(l => l.id === id);
    if (loc) {
      noteViewed(id);
      copyText(tpCommand(loc)).then(ok =>
        toast(ok ? `Copied ${tpCommand(loc)}` : "Could not reach the clipboard."));
    }
    return;
  }

  if (typing) return;             // every shortcut below is a bare key

  // ---- new location ----
  if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    openAdd();
    return;
  }

  // ---- tabs 1-4 ----
  if (/^[1-4]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    state.ui.activeTab = TABS[Number(e.key) - 1].id;
    render();
    if (state.ui.activeTab === "coordinates") $("search")?.focus();
  }
});


/* ==========================================================================
   BOOT
   ========================================================================== */

/**
 * The seed is fetched now rather than inlined. Under file:// this would fail on
 * CORS, which is exactly why v0 inlined it — but from Phase 8 the app is served
 * by Vite in dev and by the Tauri asset protocol in the built exe, so fetch
 * works and data/seed.json becomes the single copy of record.
 * docs/02-TRD.md §6.1
 */
async function loadSeedLocations() {
  try {
    // data/ is Vite's publicDir, so its contents sit at the site root.
    const res = await fetch("./seed.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();
    return doc.worlds?.[0]?.locations ?? [];
  } catch (err) {
    // An empty seed is survivable — the app opens with no locations and says so
    // — but the user must be told why rather than silently seeing nothing.
    state.notice = {
      kind: "error",
      text: `Could not load the starter data (data/seed.json): ${esc(err.message)}. Starting empty.`,
    };
    return [];
  }
}

/**
 * One-time move from localStorage to data.json.
 *
 * Runs only when the file does not exist yet and localStorage does have data —
 * i.e. the first launch after upgrading from v0.x. The localStorage copy is
 * deliberately LEFT IN PLACE: if anything about the new path is wrong, the old
 * data is still sitting there untouched. docs/06 Phase 10.
 */
async function migrateLocalStorageToFile(fileBackend) {
  try {
    const info = await fileBackend.info();
    if (info.exists) return null;

    const legacy = await localStorageBackend.read();
    if (!legacy) return null;

    await fileBackend.write(legacy);
    return info.path;
  } catch {
    return null;   // migration is best-effort; a failure just means a fresh file
  }
}

(async function boot() {
  // store.js must not import views.js (that would cycle), so the save-status
  // indicator is wired up here instead.
  setSaveStatusListener(renderStatusBar);

  let migratedTo = null;
  const fileBackend = desktopStorage();
  if (fileBackend) {
    migratedTo = await migrateLocalStorageToFile(fileBackend);
    setStorageBackend(fileBackend);
  }

  const seed   = await loadSeedLocations();
  const loaded = await loadData(seed);

  // Refreshed AFTER the load, not before: a corrupt file gets quarantined
  // during loadData, so a pre-load snapshot would still claim the file exists
  // and the materialise step below would skip — leaving a recovered dataset in
  // memory only, with no data.json on disk at all.
  await refreshStorageInfo();

  state.data   = loaded.data;
  state.notice = loaded.notice ?? state.notice;
  state.fatal  = Boolean(loaded.fatal);

  if (migratedTo && !state.notice) {
    state.notice = { kind: "info", text: `Your data now lives in <code>${esc(migratedTo)}</code>. The old browser copy was left untouched as a safety net.` };
  }

  // Materialise the file on a first run. Saves only happen on mutation, so
  // without this `data.json` would not exist until the user edited something —
  // and "copy the folder to another PC" would carry nothing. Skipped when the
  // load was fatal, because then we must not touch storage at all.
  if (!state.fatal && state.data && state.storageInfo && !state.storageInfo.exists) {
    await writeNow();
    await refreshStorageInfo();
  }

  render();
  $("search")?.focus();   // docs/03-APP-FLOW.md §2.1 — hard requirement

  // Apply the persisted always-on-top preference to the real window.
  setAlwaysOnTop(state.data?.settings?.alwaysOnTop ?? true);

  // Nothing is registered natively at startup, so this is what brings the
  // summon hotkey into existence — from the saved setting, never a hard-coded
  // default that could fight the game.
  registerHotkey(state.data?.settings?.hotkey ?? "");

  // Ctrl+Space / tray summon: Rust raises the window, we focus the search box
  // and SELECT its contents so the next keystroke replaces the old query while
  // Esc still restores it. docs/03-APP-FLOW.md §2.2
  onWindowShown(() => {
    const box = $("search");
    if (box) { box.focus(); box.select?.(); }
  });

  console.log("%cBlockBook v0.3", "font-weight:bold");
  console.log(`locations: ${activeLocations().length}`);
  if (state.notice) console.warn(state.notice.text.replace(/<[^>]+>/g, ""));
})();
