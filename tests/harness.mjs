/**
 * Shared test harness.
 *
 * Phase 8 split index.html into ES modules, so the gates now import the real
 * modules instead of eval-ing a <script> block. The DOM and localStorage stubs
 * are installed on globalThis BEFORE the modules load, because store.js and
 * main.js touch `window`/`localStorage` at module scope.
 *
 * No framework, no dependency — ADR-009 still holds.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SRC = join(ROOT, "src");

export const readSrc = (f) => readFileSync(join(SRC, f), "utf8");
export const readJSON = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

/** The 15 seed locations, straight from the copy of record. */
export const seedLocations = () => readJSON("data/seed.json").worlds[0].locations;

/* ---------------------------------------------------------------------------
   DOM stub
   Models enough for rendering and keyboard work: element identity, focus,
   closest(), and querySelectorAll over rendered card markup.
--------------------------------------------------------------------------- */
export function installDOM({ store = new Map() } = {}) {
  const els = {};
  const listeners = {};

  const mkEl = (id) => (els[id] ??= {
    id, _html: "", value: "", checked: false, files: [], tagName: "DIV",
    dataset: {}, style: {}, classList: { contains: () => false, add() {}, remove() {} },
    focus() { globalThis.document.activeElement = this; },
    blur() { globalThis.document.activeElement = null; },
    click() {}, select() {}, remove() {}, scrollIntoView() {},
    setSelectionRange() {}, requestSubmit() {},
    closest() { return null; },
    querySelectorAll: () => [],
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
  });

  // Card elements are derived from the rendered panel HTML and CACHED against
  // it: a real DOM hands back the same objects on repeated queries, and
  // moveCardFocus() compares by identity.
  let cardEls = [], cardSrc = null;
  function cards() {
    const src = els.panel?._html ?? "";
    if (src === cardSrc) return cardEls;
    cardSrc = src;
    const ids = [...src.matchAll(/<article class="card[^"]*"\s*\n?\s*id="card-([^"]+)"/g)].map(m => m[1]);
    cardEls = ids.map(id => {
      const el = {
        id: `card-${id}`, tagName: "ARTICLE", dataset: { id },
        focus() { globalThis.document.activeElement = el; },
        scrollIntoView() {},
        closest: (sel) => (sel.includes("card") ? el : null),
      };
      return el;
    });
    return cardEls;
  }

  // Some of these (navigator, crypto) are getter-only globals in Node 22+,
  // so plain assignment throws. defineProperty works for all of them.
  const def = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

  def("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });

  def("document", {
    documentElement: { dataset: {} },
    activeElement: null,
    body: { appendChild() {} },
    getElementById: (id) => (id == null ? null
      : String(id).startsWith("card-") ? (cards().find(c => c.id === id) ?? null)
      : mkEl(id)),
    querySelector: () => null,
    querySelectorAll: (sel) => (sel.includes("card") ? cards() : []),
    createElement: () => ({ style: {}, remove() {}, click() {}, select() {} }),
    addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); },
  });

  def("window", { addEventListener() {} });
  def("navigator", { clipboard: { writeText: () => Promise.resolve() } });

  // main.js boots by fetching the seed. Serve the real file so the test
  // exercises the actual boot path rather than the error branch.
  def("fetch", async (url) => {
    const name = String(url).replace(/^\.?\//, "");
    try {
      return { ok: true, status: 200, json: async () => readJSON(join("data", name)) };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  });

  if (!globalThis.crypto?.randomUUID) {
    def("crypto", { randomUUID: () => "id_" + Math.random().toString(36).slice(2, 10) });
  }

  return {
    els, store, cards,
    /** Dispatch a synthetic event at the delegated document listeners. */
    fire(type, props = {}) {
      const ev = {
        type, defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; },
        shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
        target: globalThis.document.activeElement ?? { tagName: "BODY" },
        ...props,
      };
      for (const fn of listeners[type] ?? []) fn(ev);
      return ev;
    },
  };
}

/* ---------------------------------------------------------------------------
   Assertions
--------------------------------------------------------------------------- */
export function makeChecker() {
  const s = { fails: 0 };
  const check = (ok, msg) => {
    console.log((ok ? "PASS  " : "FAIL  ") + msg);
    if (!ok) s.fails++;
  };
  const eq = (a, b, m) =>
    check(a === b, `${m}${a === b ? "" : `  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);
  const near = (a, b, m, tol = 0.01) =>
    check(Math.abs(a - b) < tol, `${m}${Math.abs(a - b) < tol ? "" : `  (got ${Number(a).toFixed(2)}, want ${b})`}`);
  const done = () => {
    console.log(`\n${s.fails === 0 ? "GATE PASSED" : "GATE FAILED — " + s.fails + " failure(s)"}`);
    process.exit(s.fails === 0 ? 0 : 1);
  };
  return { check, eq, near, done, state: s };
}

/** Let queued microtasks/timers run — main.js boots asynchronously. */
export const settle = () => new Promise(r => setTimeout(r, 5));

/**
 * Simulate closing and reopening the app: in-memory state is discarded, but
 * localStorage survives. Exactly what boot() does.
 */
export function reload(store, seed) {
  store.state.data = null;
  store.state.notice = null;
  store.state.fatal = false;
  const loaded = store.loadData(seed);
  store.state.data = loaded.data;
  store.state.notice = loaded.notice;
  store.state.fatal = Boolean(loaded.fatal);
  return loaded;
}

/** Strip comments so prose inside them cannot satisfy a source-level assertion. */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}
