/* ==========================================================================
   BlockBook — util.js
   Pure helpers. Imports nothing and touches nothing: no DOM, no state, no
   storage. The bottom of the dependency graph. docs/02-TRD.md §4

   The `$` DOM helper deliberately lives in views.js instead, so this module
   stays provably pure — a gate check asserts it.
   ========================================================================== */

/** Escape text before it goes anywhere near innerHTML. */
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/**
 * Strip a leading UTF-8 byte-order mark.
 *
 * `JSON.parse` throws on a BOM, and Windows Notepad writes one by default when
 * saving UTF-8. Principle P2 says data.json must be hand-editable with any text
 * editor — without this, editing it in Notepad would make the app treat the file
 * as corrupt and quarantine it. docs/02-TRD.md §1
 *
 * Applied to everything parsed from outside the app: the data file, backups,
 * and imported exports.
 */
function stripBom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** JSON.parse that tolerates a BOM. Throws exactly like JSON.parse otherwise. */
function parseJson(text) {
  return JSON.parse(stripBom(text));
}

export {
  esc,
  stripBom,
  parseJson,
};
