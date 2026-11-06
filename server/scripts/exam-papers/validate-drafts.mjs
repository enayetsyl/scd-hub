#!/usr/bin/env node
/**
 * Validate generated exam-paper drafts (format `scd.exam-paper-draft/v1`,
 * docs/prd-exam-paper-bank.md §6) before they are imported.
 *
 *   node server/scripts/exam-papers/validate-drafts.mjs [dir-or-file ...]
 *
 * Default dir: server/assets/exam-papers/annual-2026. Exit 1 on any error.
 * Checks, per paper:
 *   - required fields + enums;
 *   - every section maps to one syllabus row (syllabusRowSeq) and copies its
 *     count × marksEach = total;
 *   - every syllabus row is covered exactly once (component rows excepted);
 *   - Σ section totals = fullMarks = Σ syllabus row totals;
 *   - a WRITTEN section has ≥ count items; item keys unique;
 *   - item source is one of the known sources; MP-sourced items carry sourceRef.
 */
import fs from "node:fs";
import path from "node:path";

const SOURCES = new Set(["MP2026", "MP2026_ADAPTED", "MP_OTHER", "MP_OTHER_ADAPTED", "NEW"]);
const SUBJECTS = new Set(["BAN", "ENG", "MATH", "ISLAM", "SCI", "BGS", "ARABIC"]);
const KINDS = new Set(["WRITTEN", "ORAL"]);

function listFiles(args) {
  const targets = args.length ? args : ["server/assets/exam-papers/annual-2026"];
  const out = [];
  for (const t of targets) {
    if (!fs.existsSync(t)) {
      console.error(`missing: ${t}`);
      process.exitCode = 1;
      continue;
    }
    if (fs.statSync(t).isDirectory()) {
      for (const f of fs.readdirSync(t)) if (f.endsWith(".json")) out.push(path.join(t, f));
    } else out.push(t);
  }
  return out.sort();
}

const near = (a, b) => Math.abs(a - b) < 1e-6;

export function validatePaper(p) {
  const errors = [];
  const warn = [];
  const e = (m) => errors.push(m);
  if (p.schema !== "scd.exam-paper-draft/v1") e(`schema must be scd.exam-paper-draft/v1`);
  if (typeof p.key !== "string" || !/^[a-z0-9-]+$/i.test(p.key)) e(`key missing/invalid`);
  if (!Number.isInteger(p.classLevel) || p.classLevel < -1 || p.classLevel > 5) e(`classLevel must be -1..5`);
  if (!SUBJECTS.has(p.subject)) e(`subject ${p.subject} unknown`);
  if (!(p.fullMarks > 0)) e(`fullMarks missing`);
  if (!p.exam || p.exam.term !== "ANNUAL" || !Number.isInteger(p.exam.year)) e(`exam {term:"ANNUAL", year} missing`);
  if (typeof p.titleBn !== "string" || !p.titleBn.trim()) e(`titleBn missing`);
  const rows = Array.isArray(p.syllabusRows) ? p.syllabusRows : [];
  if (!rows.length) e(`syllabusRows (copy of the published মানবন্টন) missing`);
  const sections = Array.isArray(p.sections) ? p.sections : [];
  if (!sections.length) e(`sections missing`);

  const rowBySeq = new Map(rows.map((r) => [r.seq, r]));
  const rowTotal = rows.filter((r) => !r.component).reduce((s, r) => s + (r.total || 0), 0);
  if (rows.length && !near(rowTotal, p.fullMarks)) e(`syllabus rows sum ${rowTotal} ≠ fullMarks ${p.fullMarks}`);

  const covered = new Map();
  let sum = 0;
  const keys = new Set();
  sections.forEach((s, i) => {
    const where = `section ${s.seq ?? i + 1}`;
    if (!Number.isInteger(s.seq)) e(`${where}: seq missing`);
    if (!KINDS.has(s.kind)) e(`${where}: kind must be WRITTEN|ORAL`);
    if (typeof s.instructionBn !== "string" || !s.instructionBn.trim()) e(`${where}: instructionBn missing`);
    const rowSeqs = Array.isArray(s.syllabusRowSeq) ? s.syllabusRowSeq : [s.syllabusRowSeq];
    for (const rs of rowSeqs) {
      const row = rowBySeq.get(rs);
      if (!row) e(`${where}: syllabusRowSeq ${rs} not in syllabusRows`);
      covered.set(rs, (covered.get(rs) || 0) + 1);
    }
    if (!(s.total >= 0)) e(`${where}: total missing`);
    if (s.count != null && s.marksEach != null && !near(s.count * s.marksEach, s.total)) {
      e(`${where}: count ${s.count} × marksEach ${s.marksEach} ≠ total ${s.total}`);
    }
    if (rowSeqs.length === 1) {
      const row = rowBySeq.get(rowSeqs[0]);
      if (row && !near(row.total, s.total)) e(`${where}: total ${s.total} ≠ syllabus row ${row.seq} total ${row.total}`);
    }
    sum += s.total || 0;
    const items = Array.isArray(s.items) ? s.items : [];
    if (s.kind === "WRITTEN" && s.splitMarks) {
      // A count-1 row (e.g. "নামতা লেখ 1 × 10") split into reviewable parts.
      if (!items.length) e(`${where}: no items`);
      const m = items.reduce((n, it) => n + (Number(it.marks) || 0), 0);
      if (!near(m, s.total)) e(`${where}: splitMarks items sum ${m} ≠ total ${s.total}`);
    } else if (s.kind === "WRITTEN") {
      if (!items.length) e(`${where}: no items`);
      if (s.count != null && items.length < s.count) e(`${where}: ${items.length} items < count ${s.count}`);
      if (s.count != null && items.length > s.count && !s.choiceNoteBn) {
        warn.push(`${where}: ${items.length} items for count ${s.count} but no choiceNoteBn`);
      }
    }
    items.forEach((it, j) => {
      const iw = `${where} item ${j + 1}`;
      if (typeof it.key !== "string" || !it.key) e(`${iw}: key missing`);
      else if (keys.has(it.key)) e(`${iw}: duplicate key ${it.key}`);
      else keys.add(it.key);
      if (typeof it.text !== "string" || !it.text.trim()) e(`${iw}: text missing`);
      if (!SOURCES.has(it.source)) e(`${iw}: source ${it.source} unknown`);
      if (it.source !== "NEW" && !it.sourceRef) e(`${iw}: MP-sourced item needs sourceRef`);
    });
  });
  for (const r of rows) {
    if (r.component) continue;
    const c = covered.get(r.seq) || 0;
    if (c === 0) e(`syllabus row ${r.seq} "${r.label}" not covered by any section`);
    if (c > 1) e(`syllabus row ${r.seq} covered by ${c} sections`);
  }
  if (!near(sum, p.fullMarks)) e(`sections sum ${sum} ≠ fullMarks ${p.fullMarks}`);
  return { errors, warn };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("validate-drafts.mjs")) {
  const files = listFiles(process.argv.slice(2));
  let bad = 0;
  for (const f of files) {
    let p;
    try {
      p = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (err) {
      console.log(`FAIL ${f}: not JSON (${err.message})`);
      bad++;
      continue;
    }
    const { errors, warn } = validatePaper(p);
    const items = (p.sections || []).reduce((n, s) => n + (s.items || []).length, 0);
    const bySrc = {};
    for (const s of p.sections || []) for (const it of s.items || []) bySrc[it.source] = (bySrc[it.source] || 0) + 1;
    if (errors.length) {
      bad++;
      console.log(`FAIL ${path.basename(f)}`);
      errors.forEach((m) => console.log(`   - ${m}`));
    } else {
      console.log(`ok   ${path.basename(f)}  sections=${(p.sections || []).length} items=${items} ${JSON.stringify(bySrc)}`);
    }
    warn.forEach((m) => console.log(`   ~ ${m}`));
  }
  console.log(`${files.length - bad}/${files.length} valid`);
  if (bad) process.exitCode = 1;
}
