/* ==========================================================================
   BlockBook — views.js
   HTML builders for every tab and modal. docs/04-UIUX-SPEC.md
   ========================================================================== */

import { esc } from "./util.js";
import { DIMENSIONS, HOTKEY_OPTIONS, LOCATION_TYPES, SCHEMA_VERSION, Y_RANGES } from "./schema.js";
import { LINK_RADIUS, brokenPairs, counterpart, destinationDimension, findLinkConflicts, fmtDist, linkHealth, portalWarnings, toNether, toOverworld } from "./portals.js";
import { draftToLocation, tpCommand, validateLocation, visibleLocations } from "./locations.js";
import { brewingPanelHTML } from "./brewing.js";
import { STORAGE_KEY, activeLocations, save, saveStatus, state } from "./store.js";

/** Element lookup. Lives here, not in util.js, so util.js stays provably DOM-free. */
const $ = (id) => document.getElementById(id);

const TYPE_ICONS = {
  base: "\u{1F3E0}", portal: "\u{1F300}", spawner: "\u{1F480}",
  structure: "\u{1F3DB}", biome: "\u{1F333}", mine: "⛏",
  farm: "\u{1F33E}", village: "\u{1F3D8}", stronghold: "\u{1F3F0}",
  fortress: "\u{1F525}", bastion: "\u{1F437}", monument: "\u{1F531}",
  shipwreck: "\u{1F6A2}", trial_chamber: "⚔", misc: "\u{1F4CD}",
};

const DIM_LABEL = { overworld: "OW", nether: "NE", end: "EN" };

const DIM_NAME  = { overworld: "Overworld", nether: "Nether", end: "End" };

const TABS = [
  { id: "coordinates", label: "Coordinates" },
  { id: "portals",     label: "Portals"     },
  { id: "brewing",     label: "Brewing"     },
  { id: "reference",   label: "Reference"   },
];

const SORT_OPTIONS = [
  { id: "updated", label: "Recently updated" },
  { id: "name",    label: "Name"             },
  { id: "type",    label: "Type"             },
];


/* ==========================================================================
   STATE
   `data` is persisted. `ui` is never persisted — restoring a stale filter on
   launch would silently hide locations. docs/02-TRD.md §3.3
   ========================================================================== */

/**
 * Format a coordinate for display.
 * A null Y renders as an em dash in --fg-2, never as 0 and never blank —
 * "deliberately unknown" must not read as a real value. docs/04-UIUX-SPEC.md §6
 */
function coordHTML(loc) {
  const sep = state.data.settings.coordFormat === "x, y, z" ? ", "
            : state.data.settings.coordFormat === "x y z"   ? " "
            : " / ";
  const y = loc.y === null ? '<span class="nil">&mdash;</span>' : esc(loc.y);
  return `${esc(loc.x)}${sep}${y}${sep}${esc(loc.z)}`;
}

function cardHTML(loc) {
  const icon = TYPE_ICONS[loc.type] ?? TYPE_ICONS.misc;
  const tags = loc.tags.length
    ? `<div class="tags">${loc.tags.map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>`
    : "";

  // Show the note only when the search matched it and nothing else — otherwise
  // the user cannot see why the row is in the results.
  const q = state.ui.search.trim().toLowerCase();
  const matchedNote = q && loc.notes.toLowerCase().includes(q)
                        && !loc.name.toLowerCase().includes(q)
                        && !loc.tags.join(" ").toLowerCase().includes(q);
  const note = matchedNote
    ? `<div class="note-preview" title="${esc(loc.notes)}">${esc(loc.notes)}</div>`
    : "";

  return `
    <article class="card${loc.favorite ? " is-favorite" : ""}"
             id="card-${esc(loc.id)}" data-id="${esc(loc.id)}"
             tabindex="0" role="listitem"
             aria-label="${esc(loc.name)}, ${loc.x} ${loc.y ?? "unknown"} ${loc.z}, ${esc(DIM_NAME[loc.dimension] ?? "")}">
      <div class="card-main">
        <span class="card-icon" title="${esc(loc.type)}">${icon}</span>
        <span class="card-name" title="${esc(loc.name)}">${esc(loc.name)}</span>
        <span class="coord">${coordHTML(loc)}</span>
        <span class="badge ${esc(loc.dimension)}" title="${esc(DIM_NAME[loc.dimension] ?? "Unknown")}">${esc(DIM_LABEL[loc.dimension] ?? "??")}</span>
        <span class="card-actions">
          <button class="btn ghost" data-act="tp" data-id="${esc(loc.id)}"
                  title="Copy ${esc(tpCommand(loc))}">/tp</button>
          <button class="btn ghost" data-act="fav" data-id="${esc(loc.id)}"
                  title="${loc.favorite ? "Remove from favourites" : "Add to favourites"}">${loc.favorite ? "★" : "☆"}</button>
          <button class="btn ghost" data-act="edit" data-id="${esc(loc.id)}">Edit</button>
          <button class="btn ghost" data-act="del" data-id="${esc(loc.id)}" title="Delete">&#128465;</button>
        </span>
      </div>
      ${portalRowHTML(loc, activeLocations())}
      ${tags}
      ${note}
    </article>`;
}

function stubHTML(glyph, title, body, items) {
  return `
    <div class="stub">
      <span class="glyph">${glyph}</span>
      <h2>${esc(title)}</h2>
      <p>${esc(body)}</p>
      ${items ? `<ul>${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
    </div>`;
}

function renderTabs() {
  $("tabs").innerHTML = TABS.map(t => `
    <button class="tab" role="tab" data-tab="${t.id}"
            aria-selected="${state.ui.activeTab === t.id}">${esc(t.label)}</button>
  `).join("");
}

function renderToolbar() {
  if (state.ui.activeTab !== "coordinates" || state.fatal) { $("toolbar").innerHTML = ""; return; }

  const { dimension, type } = state.ui.filters;
  const dimChip = (id, label) => `
    <button class="fchip" data-filter="dimension" data-dim="${id}" data-value="${id}"
            aria-pressed="${(dimension ?? "") === id}">${esc(label)}</button>`;

  const shown = visibleLocations(activeLocations(), state.ui).length;
  const total = activeLocations().length;

  $("toolbar").innerHTML = `
    <div class="toolbar-rows">
      <div class="toolbar-row">
        <span class="search-wrap">
          <span class="glass">&#128269;</span>
          <input type="text" id="search" placeholder="Search locations…"
                 autocomplete="off" spellcheck="false"
                 aria-label="Search locations"
                 value="${esc(state.ui.search)}">
        </span>
        <button class="btn primary" data-act="add">+ Add</button>
      </div>
      <div class="toolbar-row">
        <span class="chips">
          ${dimChip("", "All")}
          ${dimChip("overworld", "\u{1F7E9} Overworld")}
          ${dimChip("nether", "\u{1F7E5} Nether")}
          ${dimChip("end", "\u{1F7EA} End")}
        </span>
        <select id="type-filter" aria-label="Filter by type">
          <option value="">All types</option>
          ${LOCATION_TYPES.map(t => `
            <option value="${t}"${type === t ? " selected" : ""}>${TYPE_ICONS[t]} ${esc(t.replace(/_/g, " "))}</option>
          `).join("")}
        </select>
        <span class="spacer"></span>
        <label for="sort">Sort</label>
        <select id="sort" aria-label="Sort order"${state.ui.search.trim() ? " disabled title='Relevance ordering is used while searching'" : ""}>
          ${SORT_OPTIONS.map(o => `
            <option value="${o.id}"${state.ui.sort === o.id ? " selected" : ""}>${esc(o.label)}</option>
          `).join("")}
        </select>
        <span class="count" aria-live="polite">${shown === total ? `${total} locations` : `${shown} of ${total}`}</span>
      </div>
    </div>
  `;
}

/** A compact strip of the last few locations you actually looked at. */
function recentlyViewedHTML() {
  const all = activeLocations();
  const recents = state.ui.recentlyViewed
    .map(id => all.find(l => l.id === id))
    .filter(Boolean);
  if (recents.length === 0) return "";

  return `
    <div class="section-label">Recently viewed</div>
    <div class="recents">
      ${recents.map(l => `
        <button class="recent" data-act="goto" data-id="${esc(l.id)}"
                title="${esc(l.name)} — ${l.x} / ${l.y ?? "—"} / ${l.z}">
          <span>${TYPE_ICONS[l.type] ?? TYPE_ICONS.misc}</span>
          <span class="recent-name">${esc(l.name)}</span>
        </button>`).join("")}
    </div>`;
}

function emptyStateHTML() {
  const { search, filters } = state.ui;
  if (search.trim()) {
    return `<div class="empty">
      <span class="glyph">&#128269;</span>
      <div>No match for <strong>${esc(search.trim())}</strong>.</div>
      <button class="btn" data-act="clear-search">Clear search</button>
    </div>`;
  }
  if (filters.dimension || filters.type) {
    const bits = [filters.dimension && DIM_NAME[filters.dimension],
                  filters.type && filters.type.replace(/_/g, " ")].filter(Boolean).join(" · ");
    return `<div class="empty">
      <span class="glyph">&#128269;</span>
      <div>No locations match <strong>${esc(bits)}</strong>.</div>
      <button class="btn" data-act="clear-filters">Clear filters</button>
    </div>`;
  }
  return `<div class="empty">
    <span class="glyph">&#128205;</span>
    <div>No locations yet.</div>
    <button class="btn primary" data-act="add">+ Add your first</button>
  </div>`;
}

function renderPanel() {
  const panel = $("panel");

  if (state.fatal) { panel.innerHTML = ""; return; }

  if (state.ui.activeTab === "coordinates") {
    const list = visibleLocations(activeLocations(), state.ui);
    if (list.length === 0) { panel.innerHTML = emptyStateHTML(); return; }

    const searching = Boolean(state.ui.search.trim());

    // While searching, relevance order is the whole point — do not split the
    // list into sections or the best match stops being first.
    if (searching) {
      panel.innerHTML = `
        <div class="section-label">Results &middot; ${list.length}</div>
        <div class="list" role="list">${list.map(cardHTML).join("")}</div>`;
      return;
    }

    const favs = list.filter(l => l.favorite);
    const rest = list.filter(l => !l.favorite);

    panel.innerHTML = `
      ${recentlyViewedHTML()}
      ${favs.length ? `
        <div class="section-label">&#11088; Favourites &middot; ${favs.length}</div>
        <div class="list" role="list">${favs.map(cardHTML).join("")}</div>` : ""}
      ${rest.length ? `
        <div class="section-label">${favs.length ? "All other locations" : "All locations"} &middot; ${rest.length}</div>
        <div class="list" role="list">${rest.map(cardHTML).join("")}</div>` : ""}
    `;
    return;
  }

  if (state.ui.activeTab === "portals") {
    panel.innerHTML = portalsPanelHTML();
    return;
  }

  if (state.ui.activeTab === "brewing") {
    panel.innerHTML = brewingPanelHTML(state.ui.ref.brewing, state.ui.brewHave);
    return;
  }

  panel.innerHTML = stubHTML("\u{1F4DA}", "Coming in v1.2", "Phase 12 builds these tabs.", [
    "Enchanting — max levels and conflicts",
    "Mob spawn conditions",
    "Villager trades",
    "Fuel burn times · XP table · portal sizes · beacon",
  ]);
}

function renderStatusBar() {
  const locs = activeLocations();
  const portals = locs.filter(l => l.type === "portal").length;
  const favs = locs.filter(l => l.favorite).length;
  const saveLabel = { saved: "saved", saving: "saving…", error: "NOT SAVED" }[saveStatus];
  const broken = brokenPairs(locs).length;
  $("statusbar").innerHTML = `
    <span>${locs.length} locations</span>
    <span>&middot;</span>
    <span>${portals} portals</span>
    <span>&middot;</span>
    <span>${favs} favourites</span>
    ${broken ? `<span class="health bad">&middot; &#9888; ${broken} broken pair${broken > 1 ? "s" : ""}</span>` : ""}
    <span class="spacer"></span>
    <span>v0.2 &middot; ${state.fatal ? "halted" : esc(saveLabel)}</span>
  `;
}

function renderBanner() {
  $("banner").innerHTML = state.notice
    ? `<div class="banner">${state.notice.text}</div>`   // text is pre-escaped at source
    : "";
}

/* ---- portal widgets — docs/04-UIUX-SPEC.md §4.4, §4.7, §4.8 ---- */

const HEALTH_BADGE = {
  tight:  { icon: "✅", label: "Tight",  cls: "ok",   tip: "Reliably paired in both directions." },
  loose:  { icon: "🟡", label: "Loose",  cls: "warn", tip: "Both directions link, but another portal could steal it." },
  broken: { icon: "❌", label: "Broken", cls: "bad",  tip: "At least one direction does NOT reach the partner." },
};

function healthBadgeHTML(loc, all) {
  if (loc.type !== "portal") return "";
  if (loc.dimension === "end") return `<span class="health muted">— no counterpart</span>`;

  const partner = loc.linkedPortalId ? all.find(l => l.id === loc.linkedPortalId) : null;
  if (!partner) return `<span class="health muted" title="No partner recorded.">— Unlinked</span>`;

  const h = linkHealth(loc, partner);
  if (!h) return `<span class="health muted">— Unlinked</span>`;
  const b = HEALTH_BADGE[h.status];
  return `<span class="health ${b.cls}"
    title="${esc(b.tip)} Forward ${fmtDist(h.forward)}, backward ${fmtDist(h.backward)}."
    >${b.icon} ${b.label} &rarr; ${esc(partner.name)}</span>`;
}

/** Row 2 of a portal card: where it lands, and whether the pair holds. */
function portalRowHTML(loc, all) {
  if (loc.type !== "portal") return "";
  const cp = counterpart(loc);
  const where = cp
    ? `<span class="muted">&harr; ${esc(cp.dimension)}</span> <span class="coord">${cp.x} / ${cp.z}</span>`
    : `<span class="muted">&harr; the End has no counterpart</span>`;
  return `<div class="portal-row">${where} ${healthBadgeHTML(loc, all)}</div>`;
}

/** The live panel inside the Add/Edit modal when type === "portal". */
function portalPanelHTML(loc, all) {
  const cp = counterpart(loc);
  const dest = destinationDimension(loc.dimension);

  if (!dest) {
    return `<div class="portal-panel">
      <div class="hint">End portals have no counterpart and cannot be paired.</div>
    </div>`;
  }
  if (!cp) {
    return `<div class="portal-panel">
      <div class="hint">Enter X and Z to see the counterpart and check for link conflicts.</div>
    </div>`;
  }

  const conflicts = findLinkConflicts(loc, all).filter(c => c.location.id !== loc.linkedPortalId);
  const nearest = conflicts[0];
  const ignored = state.ui.ignoreConflict;

  const verdict = !nearest
    ? `<div class="verdict ok">✅ Will create a new portal at ~<span class="coord">${cp.x} / ${cp.z}</span>.</div>`
    : ignored
      ? `<div class="verdict warn">⚠ Conflict acknowledged: “${esc(nearest.location.name)}” (${fmtDist(nearest.distance)} blocks).</div>`
      : `<div class="verdict warn">
           ⚠ Will likely link to <strong>${esc(nearest.location.name)}</strong>
           (${fmtDist(nearest.distance)} blocks away). Build further out, or accept the link.
           <div class="verdict-actions">
             <button type="button" class="btn" data-act="link-nearest" data-id="${esc(nearest.location.id)}">Link them</button>
             <button type="button" class="btn ghost" data-act="ignore-conflict">Ignore</button>
           </div>
         </div>`;

  const candidates = all.filter(l => l.type === "portal" && l.dimension === dest && l.id !== loc.id);

  return `
    <div class="portal-panel">
      <div class="cp-line">&harr; Counterpart in the ${esc(dest)}:
        <span class="coord">${cp.x} / ${cp.z}</span></div>
      ${verdict}
      <div class="field" style="margin:var(--s-3) 0 0">
        <label for="f-link">Links to</label>
        <select id="f-link">
          <option value="">— none —</option>
          ${candidates.map(c => `
            <option value="${esc(c.id)}"${loc.linkedPortalId === c.id ? " selected" : ""}>
              ${esc(c.name)} (${c.x} / ${c.z})
            </option>`).join("")}
        </select>
        ${candidates.length === 0 ? `<div class="hint">No ${esc(dest)} portals recorded yet.</div>` : ""}
      </div>
    </div>`;
}

/* ---- Portals tab converter — docs/04-UIUX-SPEC.md §4.8 ---- */

/**
 * Convert a single axis for the converter widget.
 *
 * Delegates to the real portal maths rather than repeating `n / 8` here. An
 * earlier version inlined the division, which quietly duplicated the one piece
 * of arithmetic the whole app is built to get right — and would have drifted
 * silently from portals.js. The second argument is 0 because the axes convert
 * independently. docs/07-ALGORITHMS.md §2
 *
 * Returns "" for anything not a whole number, so a half-typed "-" survives.
 */
function convertAxis(raw, dir) {
  const s = String(raw).trim();
  if (s === "" || !/^-?\d+$/.test(s)) return "";
  const n = Number(s);
  const { x } = dir === "toNether" ? toNether(n, 0) : toOverworld(n, 0);
  return String(x);
}

function converterHTML() {
  const c = state.ui.conv;
  const srcIsOW = c.src === "overworld";

  const owX = srcIsOW ? c.x : convertAxis(c.x, "toOverworld");
  const owZ = srcIsOW ? c.z : convertAxis(c.z, "toOverworld");
  const neX = srcIsOW ? convertAxis(c.x, "toNether") : c.x;
  const neZ = srcIsOW ? convertAxis(c.z, "toNether") : c.z;

  // Conflicts against the destination of whatever side is being typed into.
  const x = Number(c.x), z = Number(c.z);
  const usable = /^-?\d+$/.test(c.x.trim()) && /^-?\d+$/.test(c.z.trim());
  const probe = usable ? { dimension: c.src, x: Math.floor(x), z: Math.floor(z), id: null } : null;
  const cp = probe ? counterpart(probe) : null;
  const conflicts = probe ? findLinkConflicts(probe, activeLocations()) : [];

  // Every one of these needs a STABLE id. The panel re-renders on each
  // keystroke, and withPreservedFocus() restores focus by id — without one the
  // caret is lost after a single character and you cannot type a coordinate.
  const convInput = (side, axis, val) => `
    <label for="conv-${side}-${axis}">${axis.toUpperCase()}
      <input type="text" inputmode="numeric" class="conv-in"
             id="conv-${side}-${axis}" data-conv="${side}" data-axis="${axis}"
             value="${esc(val)}" autocomplete="off"
             aria-label="${side} ${axis}"></label>`;

  return `
    <div class="converter">
      <div class="conv-side ow">
        <div class="conv-title"><span class="badge overworld">OW</span> Overworld</div>
        ${convInput("overworld", "x", owX)}
        ${convInput("overworld", "z", owZ)}
      </div>
      <div class="conv-arrow">&harr;</div>
      <div class="conv-side ne">
        <div class="conv-title"><span class="badge nether">NE</span> Nether</div>
        ${convInput("nether", "x", neX)}
        ${convInput("nether", "z", neZ)}
      </div>
    </div>
    <p class="conv-note">Y is not converted. Nether Y and Overworld Y are unrelated.</p>
    ${cp ? `
      <div class="section-label">Portals near ${cp.x} / ${cp.z} &middot; ${esc(cp.dimension)}</div>
      ${conflicts.length === 0
        ? `<div class="verdict ok">✅ Nothing within ${LINK_RADIUS} blocks — a new portal would be created here.</div>`
        : `<div class="list">${conflicts.map(c2 => `
            <article class="card">
              <div class="card-main">
                <span class="card-icon">${TYPE_ICONS.portal}</span>
                <span class="card-name">${esc(c2.location.name)}</span>
                <span class="coord">${c2.location.x} / ${c2.location.z}</span>
                <span class="badge ${esc(c2.location.dimension)}">${DIM_LABEL[c2.location.dimension]}</span>
                <span class="health warn">${fmtDist(c2.distance)} blocks</span>
              </div>
            </article>`).join("")}</div>`}
    ` : `<p class="conv-note">Enter an X and a Z to check for link conflicts.</p>`}
  `;
}

function portalsPanelHTML() {
  const all = activeLocations();
  const portals = all.filter(l => l.type === "portal");
  const broken = brokenPairs(all);
  const unlinked = portals.filter(p => !p.linkedPortalId && p.dimension !== "end").length;

  return `
    ${converterHTML()}
    <div class="section-label" style="margin-top:var(--s-5)">
      All portals &middot; ${portals.length}
      ${broken.length ? `<span class="health bad">&middot; ${broken.length} broken pair${broken.length > 1 ? "s" : ""}</span>` : ""}
      ${unlinked ? `<span class="muted">&middot; ${unlinked} unlinked</span>` : ""}
    </div>
    ${portals.length === 0
      ? `<div class="empty"><span class="glyph">${TYPE_ICONS.portal}</span><div>No portals recorded yet.</div></div>`
      : `<div class="list">${portals.map(p => `
          <article class="card${p.favorite ? " is-favorite" : ""}">
            <div class="card-main">
              <span class="card-icon">${TYPE_ICONS.portal}</span>
              <span class="card-name">${esc(p.name)}</span>
              <span class="coord">${coordHTML(p)}</span>
              <span class="badge ${esc(p.dimension)}">${DIM_LABEL[p.dimension] ?? "??"}</span>
              <span class="card-actions">
                <button class="btn ghost" data-act="edit" data-id="${esc(p.id)}">Edit</button>
              </span>
            </div>
            ${portalRowHTML(p, all)}
          </article>`).join("")}</div>`}
  `;
}

/* ---- brewing tab — docs/08-REFERENCE-DATA.md §5 ---- */

function settingsModalHTML() {
  const s = state.data.settings;
  const locs = activeLocations();
  return `
    <div class="overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="set-title">
        <div class="modal-head">
          <h2 id="set-title">Settings</h2>
          <button class="icon-btn" data-act="close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="section-label">Display</div>
          <div class="field">
            <label for="s-theme">Theme</label>
            <select id="s-theme">
              <option value="dark"${s.theme === "dark" ? " selected" : ""}>Dark</option>
              <option value="light"${s.theme === "light" ? " selected" : ""}>Light</option>
            </select>
          </div>
          <div class="field">
            <label for="s-coord">Coordinate format</label>
            <select id="s-coord">
              ${["x / y / z", "x, y, z", "x y z"].map(f => `
                <option value="${esc(f)}"${s.coordFormat === f ? " selected" : ""}>${esc(f)}</option>`).join("")}
            </select>
          </div>

          <div class="section-label" style="margin-top:var(--s-4)">Behaviour</div>
          <div class="field checkline">
            <input type="checkbox" id="s-aot"${s.alwaysOnTop ? " checked" : ""}>
            <label for="s-aot" style="margin:0">Always on top</label>
          </div>

          <div class="field">
            <label for="s-hotkey">Summon hotkey</label>
            <select id="s-hotkey">
              ${HOTKEY_OPTIONS.map(o => `
                <option value="${esc(o.value)}"${s.hotkey === o.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}
              ${HOTKEY_OPTIONS.some(o => o.value === s.hotkey) ? "" : `
                <option value="${esc(s.hotkey)}" selected>${esc(s.hotkey)} (current)</option>`}
            </select>
            <div class="hint">
              These all avoid Minecraft's default controls. Anything using
              <kbd>Ctrl</kbd>+<kbd>Space</kbd> would fire every time you sprint-jump.
            </div>
          </div>

          <p class="hint" style="margin-top:0">
            ${s.hotkey
              ? `Press <kbd>${esc(s.hotkey.replace("CmdOrCtrl", "Ctrl"))}</kbd> to summon or dismiss BlockBook.`
              : `The hotkey is disabled — use the tray icon to show the window.`}
            Closing the window hides it to the system tray rather than quitting;
            quit from the tray menu.
          </p>

          <div class="section-label" style="margin-top:var(--s-4)">Data</div>
          <p class="hint" style="margin-top:0">
            ${locs.length} locations. Stored in this browser under
            <code>${esc(STORAGE_KEY)}</code>. Phase 10 moves this to a portable
            <code>data.json</code> next to the app.
          </p>
          <div class="verdict-actions" style="flex-wrap:wrap">
            <button class="btn" data-act="export">Export JSON</button>
            <button class="btn" data-act="import-file">Import JSON…</button>
            <button class="btn" data-act="import-text">Import from Notepad…</button>
          </div>

          <div class="section-label" style="margin-top:var(--s-4)">Keyboard</div>
          <ul class="kv">
            <li><kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>F</kbd> — focus search</li>
            <li><kbd>N</kbd> — new location</li>
            <li><kbd>1</kbd>&ndash;<kbd>4</kbd> — switch tab</li>
            <li><kbd>&darr;</kbd> <kbd>&uarr;</kbd> — move between locations</li>
            <li><kbd>Enter</kbd> — copy <code>/tp</code> for the focused location</li>
            <li><kbd>Shift</kbd>+<kbd>Enter</kbd> — edit the focused location</li>
            <li><kbd>Ctrl</kbd>+<kbd>Enter</kbd> — save from anywhere in a form</li>
            <li><kbd>Esc</kbd> — close modal, then clear search</li>
          </ul>

          <div class="section-label" style="margin-top:var(--s-4)">About</div>
          <p class="hint" style="margin-top:0">
            BlockBook v0.3 &middot; schema ${SCHEMA_VERSION}<br>
            Global hotkeys will not reach this app while Minecraft is in
            <strong>exclusive fullscreen</strong>. Use Windowed or Borderless.
          </p>
        </div>
        <div class="modal-foot">
          <button class="btn" data-act="close">Close</button>
        </div>
      </div>
    </div>`;
}

function importTextModalHTML() {
  return `
    <div class="overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="it-title" style="max-width:640px">
        <div class="modal-head">
          <h2 id="it-title">Import from Notepad</h2>
          <button class="icon-btn" data-act="close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="hint" style="margin-top:0">
            Paste your coordinates. Any line with three numbers is picked up;
            <code>/</code> and spaces both work as separators. You will confirm
            every row before anything is imported.
          </p>
          <textarea id="import-text" rows="12" spellcheck="false"
            placeholder="Home - 221/65/374&#10;Portal 631/67/245 ---- -495/66/-394&#10;spider spawner 91/-13/200"></textarea>
        </div>
        <div class="modal-foot">
          <button class="btn" data-act="close">Cancel</button>
          <button class="btn primary" data-act="parse-text">Parse</button>
        </div>
      </div>
    </div>`;
}

/**
 * The mandatory review screen. ADR-007 — no code path commits an import
 * without it, and there is no "import all" shortcut.
 */
function importReviewModalHTML() {
  const { rows, unrecognised } = state.ui.import;
  const checked = rows.filter(r => r.checked);
  const needDim = checked.filter(r => !DIMENSIONS.includes(r.dimension)).length;

  return `
    <div class="overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="ir-title" style="max-width:860px">
        <div class="modal-head">
          <h2 id="ir-title">Review import &mdash; ${rows.length} location${rows.length === 1 ? "" : "s"}</h2>
          <button class="icon-btn" data-act="close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="hint" style="margin-top:0">
            Dimensions marked <sup class="guessed">g</sup> are guesses.
            <strong>Verify every row before importing.</strong>
          </p>
          ${rows.length === 0 ? `<p class="muted">Nothing recognisable in that text.</p>` : `
          <table class="review">
            <thead>
              <tr><th></th><th>Name</th><th>Dimension</th><th>X</th><th>Y</th><th>Z</th><th>Type</th></tr>
            </thead>
            <tbody>
              ${rows.map((r, i) => `
                <tr class="${r.checked ? "" : "row-off"}">
                  <td><input type="checkbox" data-imp="checked" data-i="${i}" id="imp-checked-${i}"
                             aria-label="Import row ${i + 1}"${r.checked ? " checked" : ""}></td>
                  <td><input type="text" data-imp="name" data-i="${i}" id="imp-name-${i}"
                             aria-label="Name for row ${i + 1}" value="${esc(r.name)}"></td>
                  <td>
                    <select data-imp="dimension" data-i="${i}" id="imp-dimension-${i}"
                            aria-label="Dimension for row ${i + 1}"
                            class="${!DIMENSIONS.includes(r.dimension) ? "needs" : r.guessed && !r.confident ? "guessed-sel" : ""}">
                      <option value=""${!r.dimension ? " selected" : ""}>?</option>
                      ${DIMENSIONS.map(d => `
                        <option value="${d}"${r.dimension === d ? " selected" : ""}>${esc(DIM_NAME[d])}</option>`).join("")}
                    </select>${r.guessed && !r.confident ? '<sup class="guessed">g</sup>' : ""}
                  </td>
                  <td class="coord">${r.x}</td>
                  <td class="coord">${r.y}</td>
                  <td class="coord">${r.z}</td>
                  <td>
                    <select data-imp="type" data-i="${i}" id="imp-type-${i}"
                            aria-label="Type for row ${i + 1}">
                      ${LOCATION_TYPES.map(t => `
                        <option value="${t}"${r.type === t ? " selected" : ""}>${esc(t.replace(/_/g, " "))}</option>`).join("")}
                    </select>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>`}
          ${unrecognised.length ? `
            <div class="section-label" style="margin-top:var(--s-4)">Not recognised &middot; ${unrecognised.length}</div>
            <ul class="msg-list muted">${unrecognised.slice(0, 8).map(u => `<li>${esc(u)}</li>`).join("")}
              ${unrecognised.length > 8 ? `<li>…and ${unrecognised.length - 8} more</li>` : ""}</ul>` : ""}
        </div>
        <div class="modal-foot">
          ${needDim ? `<span class="health warn" style="margin-right:auto">&#9888; ${needDim} row${needDim === 1 ? "" : "s"} still need a dimension</span>` : ""}
          <button class="btn" data-act="close">Cancel</button>
          <button class="btn primary" data-act="commit-text-import"${needDim || checked.length === 0 ? " disabled" : ""}>
            Import ${checked.length}
          </button>
        </div>
      </div>
    </div>`;
}

function importChoiceModalHTML() {
  const p = state.ui.pendingImport;
  return `
    <div class="overlay">
      <div class="modal" role="dialog" aria-modal="true" style="max-width:460px">
        <div class="modal-head"><h2>Import ${p.locations.length} locations</h2></div>
        <div class="modal-body">
          <p style="margin-top:0">How should this file be applied?</p>
          <p class="hint"><strong>Merge</strong> appends anything whose id is not already
            here. Nothing existing is changed or removed.</p>
          <p class="hint"><strong>Replace</strong> discards all
            ${activeLocations().length} current locations. A backup is written first.</p>
        </div>
        <div class="modal-foot">
          <button class="btn" data-act="close">Cancel</button>
          <button class="btn danger" data-act="import-replace">Replace everything</button>
          <button class="btn primary" data-act="import-merge">Merge</button>
        </div>
      </div>
    </div>`;
}

function confirmReplaceModalHTML() {
  const p = state.ui.pendingImport;
  return `
    <div class="overlay">
      <div class="modal" role="dialog" aria-modal="true" style="max-width:460px">
        <div class="modal-head"><h2>Replace everything?</h2></div>
        <div class="modal-body">
          <p style="margin-top:0">This deletes all <strong>${activeLocations().length}</strong>
            current locations and installs the <strong>${p.locations.length}</strong> from the file.</p>
          <p class="hint">A backup is written to localStorage first, so this is recoverable
            &mdash; but not from inside the app.</p>
        </div>
        <div class="modal-foot">
          <button class="btn" data-act="close">Cancel</button>
          <button class="btn danger" data-act="import-replace-confirmed">Replace all ${activeLocations().length}</button>
        </div>
      </div>
    </div>`;
}

/* ---- modal — docs/04-UIUX-SPEC.md §4.7 ---- */

function renderModal() {
  if (state.ui.modal === "settings")        { $("modal-root").innerHTML = settingsModalHTML(); return; }
  if (state.ui.modal === "import-text")     { $("modal-root").innerHTML = importTextModalHTML(); return; }
  if (state.ui.modal === "import-review")   { $("modal-root").innerHTML = importReviewModalHTML(); return; }
  if (state.ui.modal === "import-choice")   { $("modal-root").innerHTML = importChoiceModalHTML(); return; }
  if (state.ui.modal === "confirm-replace") { $("modal-root").innerHTML = confirmReplaceModalHTML(); return; }
  return renderEditModals();
}

function renderEditModals() {
  const root = $("modal-root");

  if (state.ui.modal === "confirm-delete") {
    const loc = activeLocations().find(l => l.id === state.ui.confirmId);
    if (!loc) { root.innerHTML = ""; return; }
    root.innerHTML = `
      <div class="overlay" data-act="overlay">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cd-title" style="max-width:420px">
          <div class="modal-head"><h2 id="cd-title">Delete location</h2></div>
          <div class="modal-body">
            <p style="margin:0">Deletes <strong>${esc(loc.name)}</strong> at
              <span class="coord">${coordHTML(loc)}</span>. This cannot be undone.</p>
            ${loc.linkedPortalId ? `<p class="hint warn">Its portal link will also be cleared.</p>` : ""}
          </div>
          <div class="modal-foot">
            <button class="btn" data-act="close">Cancel</button>
            <button class="btn danger" data-act="confirm-delete" id="focus-me">Delete</button>
          </div>
        </div>
      </div>`;
    return;
  }

  if (state.ui.modal !== "edit") { root.innerHTML = ""; return; }

  const d = state.ui.draft;
  const isEdit = Boolean(d.id);
  const loc = draftToLocation(d);
  const all = activeLocations();
  const { errors, warnings } = validateLocation(loc, all, portalWarnings(loc, all));

  const yHint = DIMENSIONS.includes(d.dimension)
    ? (() => {
        const [min, max] = Y_RANGES[d.dimension];
        const bad = warnings.some(w => w.code === "W1");
        return `<div class="hint${bad ? " warn" : ""}">${DIM_NAME[d.dimension]}: ${min} to ${max}${bad ? " — outside range" : ""}</div>`;
      })()
    : `<div class="hint">Choose a dimension to see the valid Y range.</div>`;

  const msgs = [
    ...errors.map(e => `<li class="err">${esc(e.msg)}</li>`),
    ...warnings.map(w => `<li class="warn">${esc(w.msg)}</li>`),
  ].join("");

  root.innerHTML = `
    <div class="overlay" data-act="overlay">
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title" id="loc-form">
        <div class="modal-head">
          <h2 id="m-title">${isEdit ? "Edit location" : "Add location"}</h2>
          <button type="button" class="icon-btn" data-act="close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          ${msgs ? `<ul class="msg-list">${msgs}</ul>` : ""}

          <div class="field">
            <label for="f-name">Name <span class="req">*</span></label>
            <input type="text" id="f-name" value="${esc(d.name)}" maxlength="80" autocomplete="off">
          </div>

          <div class="field">
            <label>Dimension <span class="req">*</span></label>
            <div class="radios">
              ${DIMENSIONS.map(dim => `
                <label for="f-dim-${dim}"><input type="radio" name="f-dim" id="f-dim-${dim}"
                       value="${dim}"${d.dimension === dim ? " checked" : ""}> ${esc(DIM_NAME[dim])}</label>
              `).join("")}
            </div>
          </div>

          <div class="field">
            <label>Coordinates</label>
            <div class="row3">
              <input type="text" inputmode="numeric" id="f-x" placeholder="X" value="${esc(d.xRaw)}" autocomplete="off">
              <input type="text" inputmode="numeric" id="f-y" placeholder="Y (optional)" value="${esc(d.yRaw)}" autocomplete="off">
              <input type="text" inputmode="numeric" id="f-z" placeholder="Z" value="${esc(d.zRaw)}" autocomplete="off">
            </div>
            ${yHint}
          </div>

          <div class="field">
            <label for="f-type">Type</label>
            <select id="f-type">
              ${LOCATION_TYPES.map(t => `
                <option value="${t}"${d.type === t ? " selected" : ""}>${TYPE_ICONS[t]} ${esc(t.replace(/_/g, " "))}</option>
              `).join("")}
            </select>
          </div>

          <div class="field">
            <label for="f-tags">Tags <span class="hint" style="display:inline">comma separated</span></label>
            <input type="text" id="f-tags" value="${esc(d.tagsRaw)}" autocomplete="off">
          </div>

          <div class="field">
            <label for="f-notes">Notes</label>
            <textarea id="f-notes" rows="3">${esc(d.notes)}</textarea>
          </div>

          <div class="field checkline">
            <input type="checkbox" id="f-fav"${d.favorite ? " checked" : ""}>
            <label for="f-fav" style="margin:0">Favourite</label>
          </div>

          ${d.type === "portal" ? portalPanelHTML(loc, all) : ""}
        </div>
        <div class="modal-foot">
          <button type="button" class="btn" data-act="close">Cancel</button>
          <button type="submit" class="btn primary"${errors.length ? " disabled" : ""}>${isEdit ? "Save" : "Add"}</button>
        </div>
      </form>
    </div>`;
}

function renderToast() {
  $("toast-root").innerHTML = state.toast ? `<div class="toast">${esc(state.toast)}</div>` : "";
}

export {
  $,
  TYPE_ICONS,
  DIM_LABEL,
  DIM_NAME,
  TABS,
  SORT_OPTIONS,
  coordHTML,
  cardHTML,
  stubHTML,
  renderTabs,
  renderToolbar,
  recentlyViewedHTML,
  emptyStateHTML,
  renderPanel,
  renderStatusBar,
  renderBanner,
  HEALTH_BADGE,
  healthBadgeHTML,
  portalRowHTML,
  portalPanelHTML,
  convertAxis,
  converterHTML,
  portalsPanelHTML,
  settingsModalHTML,
  importTextModalHTML,
  importReviewModalHTML,
  importChoiceModalHTML,
  confirmReplaceModalHTML,
  renderModal,
  renderEditModals,
  renderToast,
};
