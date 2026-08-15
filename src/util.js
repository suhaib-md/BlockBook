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

export {
  esc,
};
