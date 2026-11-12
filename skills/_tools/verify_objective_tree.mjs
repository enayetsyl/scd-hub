#!/usr/bin/env node
/**
 * Structural verifier for a learning-objective tree (prd-objective-tree §10 item 1, D-#921/#922).
 *
 * Runs the SAME pure function the app's tree import runs (`checkTreeInvariants` in
 * shared/objectiveTree.ts, FILE mode), so a file that passes here is not refused by the
 * import for a structural reason, and vice versa.
 *
 * Usage:
 *   node skills/_tools/verify_objective_tree.mjs <tree.json> <domains.json> [--inventory <inventory.json>]
 *
 * `--inventory` (optional; the drafting session's exercise inventory {exercises[{ref}], activities[{ref}]})
 * adds two checks: every cited ref exists in the book, and exercisesTotal equals the inventory count.
 *
 * Requires the built shared package: `npm run build --workspace=shared` (CI does it first).
 * Exit 0 = ALL CHECKS PASSED; 1 = a check failed (each failing row printed with its rule and code).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DIST = path.resolve(import.meta.dirname, "../../shared/dist/objectiveTree.js");
if (!fs.existsSync(DIST)) {
  console.error(`shared/dist/objectiveTree.js not found — run: npm run build --workspace=shared`);
  process.exit(2);
}
const { checkTreeInvariants, readTreeFile, readDomainsFile, expandExerciseRef, TREE_RULES, formatTreeViolation } = require(DIST);
const { masteryPartnerSubject } = require(path.resolve(import.meta.dirname, "../../shared/dist/masteryPartners.js"));
const { parseMasteryLoCode } = require(path.resolve(import.meta.dirname, "../../shared/dist/vocab.js"));

const args = process.argv.slice(2);
const invAt = args.indexOf("--inventory");
const inventoryPath = invAt >= 0 ? args[invAt + 1] : null;
const [treePath, domainsPath] = args.filter((a, i) => a !== "--inventory" && (invAt < 0 || i !== invAt + 1));
if (!treePath || !domainsPath) {
  console.error("usage: node skills/_tools/verify_objective_tree.mjs <tree.json> <domains.json> [--inventory <inventory.json>]");
  process.exit(2);
}

const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const treeRead = readTreeFile(load(treePath));
const domRead = readDomainsFile(load(domainsPath));
const shapeErrors = [...(treeRead.ok ? [] : treeRead.errors), ...(domRead.ok ? [] : domRead.errors)];
if (shapeErrors.length > 0) {
  console.log("file shape                                                             FAIL");
  for (const e of shapeErrors) console.log(`  ${e}`);
  process.exit(1);
}
const tree = treeRead.tree;
const domains = domRead.domains;
if (domains.subject !== tree.subject) {
  console.log(`domains file is for ${domains.subject}, tree is ${tree.subject} — FAIL`);
  process.exit(1);
}

// A 2nd-paper tree (BAN2 / ENG2) may name partner-paper (BAN / ENG) codes. The file cannot see the
// live catalogue, so those are accepted as external here; the import resolves them (PR-P).
const partner = masteryPartnerSubject(tree.subject);
const inTree = new Set(tree.nodes.map((n) => n.code));
const externalCodes = partner
  ? [...new Set(tree.nodes.flatMap((n) => n.prereqCodes))].filter((c) => !inTree.has(c) && parseMasteryLoCode(c)?.subject === partner)
  : [];

const violations = checkTreeInvariants({
  externalCodes,
  classToken: tree.classToken,
  subject: tree.subject,
  nodes: tree.nodes,
  domainCodes: domains.domains.map((d) => d.code),
  mode: "FILE",
  questionTypeCodes: tree.questionTypes.map((q) => q.code),
  coverage: tree.coverage,
});

// Optional inventory checks (drafting session only; the app has no inventory).
const extra = [];
if (inventoryPath) {
  const inv = load(inventoryPath);
  const invEx = new Set((inv.exercises ?? []).map((e) => e.ref));
  const invAct = new Set((inv.activities ?? []).map((a) => a.ref));
  for (const n of tree.nodes) {
    for (const r of n.exercises) {
      if (r.endsWith("/—")) {
        if (!invAct.has(r)) extra.push({ rule: "INVENTORY", code: n.code, detail: `${r} not an activity in the inventory` });
        continue;
      }
      for (const x of expandExerciseRef(r)) if (!invEx.has(x)) extra.push({ rule: "INVENTORY", code: n.code, detail: `${x} not in the book inventory` });
    }
  }
  if (tree.coverage.exercisesTotal !== invEx.size) {
    extra.push({ rule: "INVENTORY", code: null, detail: `exercisesTotal ${tree.coverage.exercisesTotal} != inventory ${invEx.size}` });
  }
}

const all = [...violations, ...extra];
const rows = Object.entries(TREE_RULES).map(([rule, def]) => [def.text, all.filter((v) => v.rule === rule).length]);
if (inventoryPath) rows.push(["every cited ref exists in the book inventory; total matches", extra.length]);
for (const [name, n] of rows) console.log(`${name.padEnd(90)} ${n === 0 ? "OK" : `FAIL (${n})`}`);

const objectives = tree.nodes.filter((n) => n.level === "OBJECTIVE" && !n.strand);
console.log("---");
console.log(`domains in ladder: ${domains.domains.length} · used by ${tree.classToken}: ${new Set(tree.nodes.map((n) => n.domainCode)).size}`);
console.log(
  `objectives: ${objectives.length} · subs: ${tree.nodes.filter((n) => n.level === "SUB").length} · strands: ${tree.nodes.filter((n) => n.strand && n.level === "OBJECTIVE").length} · tagged rows: ${tree.nodes.filter((n) => n.tagged).length}`,
);
console.log(`coverage: ${tree.coverage.mapped} / ${tree.coverage.exercisesTotal} exercises mapped, ${tree.coverage.unmapped.length} unmapped`);
if (all.length > 0) {
  for (const v of all) console.log(formatTreeViolation(v));
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
