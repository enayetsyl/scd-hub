#!/usr/bin/env node
/**
 * Help-guide verifier (prd-help-centre HC-1, D-#968–#973).
 *
 * Runs the SAME pure check the server's guide registry runs (`checkHelpGuide` in
 * shared/helpGuides.ts) over server/assets/help/, so a guide that passes here is never
 * skipped at boot, and vice versa. It fails when:
 *   - a guide is malformed (shape, markup, too many steps, box outside the picture);
 *   - a guide names a permission that is not in the catalogue (renamed or removed);
 *   - a non-draft guide's screenshot file is missing;
 *   - a screenshot file belongs to no guide (stray picture);
 *   - categories.json is malformed.
 * It also REPORTS (does not fail on) catalogue actions that no guide covers yet, so
 * D-#973 "guides move with the feature" can be seen shrinking.
 *
 * Usage:
 *   node skills/_tools/verify_help_guides.mjs [<help dir>] [--list-missing]
 * Requires the built shared package: `npm run build --workspace=shared` (CI does it first).
 * Exit 0 = ALL CHECKS PASSED; 1 = a check failed; 2 = could not run.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DIST = path.resolve(import.meta.dirname, "../../shared/dist/helpGuides.js");
if (!fs.existsSync(DIST)) {
  console.error("shared/dist/helpGuides.js not found — run: npm run build --workspace=shared");
  process.exit(2);
}
const { checkHelpGuide, checkHelpCategories, helpPermissionKeys } = require(DIST);

const args = process.argv.slice(2);
const listMissing = args.includes("--list-missing");
const dir = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.resolve(import.meta.dirname, "../../server/assets/help"));
const fail = [];

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const catPath = path.join(dir, "categories.json");
let categories = [];
if (!fs.existsSync(catPath)) fail.push("categories.json is missing");
else {
  const raw = read(catPath);
  const p = checkHelpCategories(raw);
  if (p.length) fail.push(...p.map((x) => `categories.json: ${x}`));
  else categories = raw;
}

const permissionKeys = helpPermissionKeys();
const env = {
  categoryIds: new Set(categories.map((c) => c.id)),
  permissionKeys,
  shotExists: (rel) => fs.existsSync(path.join(dir, "shots", rel)),
};

const guideDir = path.join(dir, "guides");
const files = fs.existsSync(guideDir) ? fs.readdirSync(guideDir).filter((f) => f.endsWith(".json")).sort() : [];
const covered = new Set();
const referencedShots = new Set();
let drafts = 0;
for (const file of files) {
  let raw;
  try {
    raw = read(path.join(guideDir, file));
  } catch (e) {
    fail.push(`${file}: not valid JSON (${e.message})`);
    continue;
  }
  const problems = checkHelpGuide(raw, { ...env, fileId: file.replace(/\.json$/, "") });
  fail.push(...problems.map((x) => `${file}: ${x}`));
  if (raw.draft === true) drafts += 1;
  for (const k of raw.perms ?? []) covered.add(k);
  for (const r of raw.rows ?? []) if (typeof r?.shot === "string") referencedShots.add(r.shot);
}

const shotsDir = path.join(dir, "shots");
const walk = (d, base = "") =>
  fs.existsSync(d)
    ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name), `${base}${e.name}/`) : [`${base}${e.name}`],
      )
    : [];
for (const rel of walk(shotsDir)) {
  if (!/\.(png|jpg|webp)$/.test(rel)) continue;
  if (!referencedShots.has(rel)) fail.push(`shots/${rel}: belongs to no guide (stray picture)`);
}

const missing = [...permissionKeys].filter((k) => !covered.has(k)).sort();
console.log(`help guides: ${files.length} file(s), ${drafts} draft(s), ${categories.length} categories`);
console.log(`coverage (report-only): ${permissionKeys.size - missing.length} of ${permissionKeys.size} catalogue actions have a guide`);
if (listMissing) for (const k of missing) console.log(`  no guide yet: ${k}`);

if (fail.length) {
  for (const f of fail) console.error(`FAIL ${f}`);
  console.error(`${fail.length} problem(s)`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
