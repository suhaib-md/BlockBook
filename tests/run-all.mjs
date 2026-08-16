/**
 * BlockBook phase gates — run every checklist in docs/09-TESTING-QA.md.
 *
 *   node tests/run-all.mjs            # summary
 *   node tests/run-all.mjs -v         # every individual check
 *   node tests/phase4-gate.mjs index.html   # one gate, full output
 *
 * There is no test framework and no dependency (ADR-009). Each gate reads
 * index.html, evaluates its <script> in a vm with a minimal DOM + localStorage
 * stub, and asserts against the REAL functions the app runs — so the tests can
 * never drift from a copy of the logic.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "index.html");
const verbose = process.argv.includes("-v");

const GATES = [
  ["1", "Data model + seed"],
  ["2", "UI shell + list rendering"],
  ["3", "CRUD + search + filter + persistence"],
  ["4", "Portal maths — golden cases G1-G9"],
  ["5", "Import / export + Notepad importer"],
  ["6", "Brewing tab + generic reftable"],
  ["7", "Keyboard, favourites, recently viewed"],
  ["8", "Module split + Tauri scaffold"],
  ["9", "Overlay: hotkey, tray, always-on-top"],
  ["10", "File storage, atomic writes, backups"],
  ["11", "Distance / nearest-to"],
];

let total = 0, failed = 0, brokenGates = 0;

for (const [n, label] of GATES) {
  const r = spawnSync(process.execPath, [join(here, `phase${n}-gate.mjs`)], { encoding: "utf8" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const passes = (out.match(/^PASS/gm) ?? []).length;
  const fails  = (out.match(/^FAIL/gm) ?? []).length;
  total += passes;
  failed += fails;

  const ok = r.status === 0;
  // A gate that CRASHES produces no FAIL lines. Counting only those would let a
  // crash print "ALL GATES PASSED" — silence must never read as success.
  if (!ok) brokenGates++;

  console.log(`${ok ? "  ok" : "FAIL"}  Phase ${n} — ${label}  (${passes} checks${fails ? `, ${fails} FAILED` : ""}${!ok && fails === 0 ? ", CRASHED" : ""})`);
  if (verbose) console.log(out.replace(/^/gm, "        "));
  else if (!ok) console.log(out.split("\n").filter(l => /^FAIL|Error|at /.test(l)).map(l => "        " + l).join("\n"));
}

console.log("─".repeat(60));
if (brokenGates === 0) {
  console.log(`ALL GATES PASSED — ${total} checks`);
} else {
  const detail = failed > 0 ? `${failed} check(s) failed` : "no check failed — a gate crashed before finishing";
  console.log(`${brokenGates} GATE(S) NOT PASSING — ${detail}`);
}
process.exit(brokenGates === 0 ? 0 : 1);
