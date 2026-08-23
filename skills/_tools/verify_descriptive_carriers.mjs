#!/usr/bin/env node
/**
 * Conformance regression net for the `descriptive` answer-carrier branch (D-#528).
 *
 * The branch is the one place in the question payload where TWO carriers are legal
 * (`rubric` and/or `model_answer`), so an edit to the LOCKED payload schema can loosen
 * or tighten it without any typecheck or jest test noticing. This runs the real import
 * harness over committed cases and asserts each verdict.
 *
 * Convention: a case file named `pass_*.json` must be importable (harness exit 0);
 * `fail_*.json` must be rejected (exit 1). Add a case, don't edit one.
 *
 * Usage: node skills/_tools/verify_descriptive_carriers.mjs
 * Requires: python + jsonschema (the same dep the harness itself needs).
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CASES = path.join(ROOT, "server/import/cases/descriptive");
const HARNESS = path.join(ROOT, "server/import/validate_import.py");
const ENVELOPE = path.join(ROOT, "docs/import-contract.schema.json");
const PYTHON = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

const files = readdirSync(CASES).filter((f) => f.endsWith(".json")).sort();
if (files.length === 0) {
  console.error("RESULT: FAIL — no case files found in server/import/cases/descriptive");
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const want = file.startsWith("pass_") ? 0 : 1;
  const run = spawnSync(PYTHON, [HARNESS, path.join(CASES, file), "--envelope-schema", ENVELOPE], {
    encoding: "utf8",
    // The harness prints Bengali; a cp1252 console would crash it and mask the verdict.
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const crashed = out.includes("Traceback");
  const label = want === 0 ? "importable" : "rejected";

  if (run.status === want && !crashed) {
    console.log(`  PASS  ${file} — ${label}`);
  } else {
    failures += 1;
    const why = crashed ? "harness CRASHED" : `exit ${run.status}, wanted ${want}`;
    console.log(`  FAIL  ${file} — expected ${label}; ${why}`);
    console.log(out.split("\n").filter((l) => l.includes("FAIL") || l.includes("Error")).slice(0, 3)
      .map((l) => `          ${l.trim()}`).join("\n"));
  }
}

console.log("");
if (failures) {
  console.error(`RESULT: FAIL — ${failures} of ${files.length} descriptive-carrier cases did not gate as intended`);
  process.exit(1);
}
console.log(`RESULT: PASS — all ${files.length} descriptive-carrier cases gate as intended`);
