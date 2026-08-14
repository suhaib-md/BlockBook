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
];

let total = 0, failed = 0;

for (const [n, label] of GATES) {
  const r = spawnSync(process.execPath, [join(here, `phase${n}-gate.mjs`), app], { encoding: "utf8" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const passes = (out.match(/^PASS/gm) ?? []).length;
  const fails  = (out.match(/^FAIL/gm) ?? []).length;
  total += passes;
  failed += fails;

  const ok = r.status === 0;
  console.log(`${ok ? "  ok" : "FAIL"}  Phase ${n} — ${label}  (${passes} checks${fails ? `, ${fails} FAILED` : ""})`);
  if (verbose) console.log(out.replace(/^/gm, "        "));
  else if (!ok) console.log(out.split("\n").filter(l => /^FAIL|Error|at /.test(l)).map(l => "        " + l).join("\n"));
}

console.log("─".repeat(60));
console.log(failed === 0
  ? `ALL GATES PASSED — ${total} checks`
  : `${failed} CHECK(S) FAILED across ${total + failed} checks`);
process.exit(failed === 0 ? 0 : 1);
