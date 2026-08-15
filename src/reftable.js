/* ==========================================================================
   BlockBook — reftable.js
   The ONE generic searchable/sortable table renderer.
   ZERO DOMAIN KNOWLEDGE. docs/08-REFERENCE-DATA.md §4
   ========================================================================== */

import { esc } from "./util.js";

/** Read a cell value, flattening arrays so search and sort treat them as text. */
function refCell(row, key) {
  const v = row[key];
  return Array.isArray(v) ? v.join(" ") : (v ?? "");
}

function refSearch(rows, q, keys) {
  const needle = String(q ?? "").trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(r =>
    keys.some(k => String(refCell(r, k)).toLowerCase().includes(needle)));
}

function refFilter(rows, filters, active) {
  return rows.filter(r => filters.every(f => {
    const want = active?.[f.key];
    if (!want) return true;
    const v = r[f.key];
    return Array.isArray(v) ? v.includes(want) : String(v ?? "") === want;
  }));
}

function refSort(rows, key, dir) {
  if (!key) return rows;
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = refCell(a, key), bv = refCell(b, key);
    const an = Number(av), bn = Number(bv);
    if (Number.isFinite(an) && Number.isFinite(bn) && av !== "" && bv !== "") return (an - bn) * sign;
    return String(av).localeCompare(String(bv)) * sign;
  });
}

/**
 * @param {Object} cfg
 * @param {string}   cfg.id           unique per table; namespaces the DOM hooks
 * @param {Object[]} cfg.rows
 * @param {Array}    cfg.columns      {key, label, align?, format?, sortable?}
 * @param {string[]} cfg.searchKeys
 * @param {Array}    [cfg.filters]    {key, label, values[]}
 * @param {Function} [cfg.detail]     row -> HTML, shown when the row is selected
 * @param {Function} [cfg.rowId]      row -> string
 * @param {string}   [cfg.placeholder]
 * @param {string}   [cfg.emptyText]
 * @param {Object}   ui               {search, sortKey, sortDir, filters, selectedId}
 */
function refTableHTML(cfg, ui) {
  const rowId = cfg.rowId ?? (r => r.id);
  const filters = cfg.filters ?? [];

  let rows = refSearch(cfg.rows, ui.search, cfg.searchKeys);
  rows = refFilter(rows, filters, ui.filters);
  rows = refSort(rows, ui.sortKey, ui.sortDir);

  const controls = `
    <div class="ref-controls">
      <span class="search-wrap">
        <span class="glass">&#128269;</span>
        <input type="text" class="ref-search" data-ref="${esc(cfg.id)}"
               id="ref-search-${esc(cfg.id)}"
               placeholder="${esc(cfg.placeholder ?? "Search…")}"
               value="${esc(ui.search)}" autocomplete="off" spellcheck="false">
      </span>
      ${filters.map(f => `
        <select class="ref-filter" data-ref="${esc(cfg.id)}" data-key="${esc(f.key)}"
                id="ref-filter-${esc(cfg.id)}-${esc(f.key)}" aria-label="${esc(f.label)}">
          <option value="">${esc(f.label)}</option>
          ${f.values.map(v => `
            <option value="${esc(v)}"${ui.filters?.[f.key] === v ? " selected" : ""}>${esc(v)}</option>`).join("")}
        </select>`).join("")}
      <span class="spacer"></span>
      <span class="count" aria-live="polite">${rows.length} of ${cfg.rows.length}</span>
    </div>`;

  if (rows.length === 0) {
    return `${controls}<div class="empty"><span class="glyph">&#128269;</span>
      <div>${esc(cfg.emptyText ?? "No match.")}</div></div>`;
  }

  const head = cfg.columns.map(c => {
    const active = ui.sortKey === c.key;
    const arrow = active ? (ui.sortDir === "desc" ? " ▾" : " ▴") : "";
    return c.sortable === false
      ? `<th style="text-align:${c.align ?? "left"}">${esc(c.label)}</th>`
      : `<th style="text-align:${c.align ?? "left"}">
           <button class="ref-sort" data-ref="${esc(cfg.id)}" data-key="${esc(c.key)}"
                   aria-sort="${active ? ui.sortDir : "none"}">${esc(c.label)}${arrow}</button>
         </th>`;
  }).join("");

  const body = rows.map(r => {
    const id = rowId(r);
    const selected = ui.selectedId === id;
    const cells = cfg.columns.map(c => {
      const raw = c.format ? c.format(r) : esc(refCell(r, c.key));
      return `<td style="text-align:${c.align ?? "left"}">${raw}</td>`;
    }).join("");

    const detail = selected && cfg.detail
      ? `<tr class="ref-detail-row"><td colspan="${cfg.columns.length}">${cfg.detail(r)}</td></tr>`
      : "";

    return `<tr class="ref-row${selected ? " is-selected" : ""}"
                data-ref="${esc(cfg.id)}" data-row="${esc(id)}"
                tabindex="0" aria-expanded="${selected}">${cells}</tr>${detail}`;
  }).join("");

  return `${controls}
    <div class="ref-scroll">
      <table class="ref"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>`;
}

/* --------------------------------------------------------------------------
   DURATIONS — docs/08-REFERENCE-DATA.md §3
   -------------------------------------------------------------------------- */

export {
  refCell,
  refSearch,
  refFilter,
  refSort,
  refTableHTML,
};
