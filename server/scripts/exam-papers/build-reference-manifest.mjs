#!/usr/bin/env node
/**
 * Build the upload manifest for Mohammadpur's past papers (D-#1030) from the folders the
 * Office keeps on the laptop. Nursery – Class 5 only (owner, 2026-11-06).
 *
 *   node server/scripts/exam-papers/build-reference-manifest.mjs --out <manifest.json> [--pdf-cache <dir>]
 *     --set "ANNUAL:2025:<folder>" --set "HALF_YEARLY:2025:<folder>" …
 *
 * Per file: class from the path (Nursery / KG / Class N / "1. Class One" …; ARABIC "Level n" =
 * no class), subject from the path or the file name (OVERRIDES below for the odd ones).
 * A .docx and a .pdf with the same name in one folder are ONE paper (docx = original,
 * pdf = pages). A .docx with no pdf twin gets `pdf` = <pdf-cache>/<hash>.pdf and is listed
 * in `toConvert` — run convert-docx-to-pdf.mjs on the manifest before importing.
 * Byte-identical files are kept once.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const sets = [];
let out = null;
let pdfCache = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--set") sets.push(argv[++i]);
  else if (argv[i] === "--out") out = argv[++i];
  else if (argv[i] === "--pdf-cache") pdfCache = argv[++i];
}
if (!sets.length || !out) {
  console.error('usage: --out manifest.json --set "ANNUAL:2025:<folder>" [--set …] [--pdf-cache dir]');
  process.exit(2);
}
pdfCache = pdfCache ?? path.join(path.dirname(out), "pdf-cache");

/** File-name fragments whose subject (or skip) can't be read from the name. */
const OVERRIDES = [
  // C3 HY 2026: "Untitled document.docx" is the BGS paper (header: বাংলাদেশ ও বিশ্বপরিচয়).
  // It is typed in Bijoy (SutonnyMJ): without that font Word renders it as Latin gibberish, so
  // it is skipped until it is converted to Unicode (or uploaded as a PDF from a PC with the font).
  { match: /Half Yearly Question 2026[\\/]3\. Class Three[\\/]Untitled document\.docx$/i, skip: "C3 BGS /80 half-yearly typed in Bijoy (SutonnyMJ) — pages unreadable without the font" },
  // HY 2025 C3 "Bangla Question .docx" is a Class 1 class test, not a C3 half-yearly paper.
  { match: /Half Yearly Question 2025[\\/]3\. Class Three[\\/]Bangla Question \.docx$/i, skip: "a Class 1 class test, misfiled" },
  // HY 2025 KG "KG-Eng 2025.docx" is the Final 2025 paper (its header says so), misfiled.
  { match: /Half Yearly Question 2025[\\/]KG[\\/]KG-Eng 2025\.docx$/i, skip: "the Final 2025 KG English paper, misfiled" },
];

const CLASS_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const CLASS_BN = { "-1": "নার্সারি", 0: "কেজি", 1: "প্রথম শ্রেণি", 2: "দ্বিতীয় শ্রেণি", 3: "তৃতীয় শ্রেণি", 4: "চতুর্থ শ্রেণি", 5: "পঞ্চম শ্রেণি" };
const SUBJECT_BN = { BAN: "বাংলা", ENG: "ইংরেজি", MATH: "গণিত", ISLAM: "ইসলাম শিক্ষা", SCI: "বিজ্ঞান", BGS: "বাংলাদেশ ও বিশ্বপরিচয়", ARABIC: "আরবি" };

function classOf(rel) {
  const segs = rel.split(/[\\/]/);
  for (const s of segs.slice(0, -1)) {
    if (/^nursery$/i.test(s)) return -1;
    if (/^kg$/i.test(s)) return 0;
    let m = s.match(/^class\s*([1-5])$/i);
    if (m) return Number(m[1]);
    m = s.match(/^\d+\.\s*class\s+(one|two|three|four|five)$/i);
    if (m) return CLASS_WORDS[m[1].toLowerCase()];
    m = s.match(/^\d+\.\s*class\s+(six|seven|eight|nine|ten)$/i);
    if (m) return 99; // above class 5 — skipped
  }
  return undefined;
}

function subjectOf(rel) {
  const t = rel.toLowerCase();
  if (/arabic/.test(t)) return "ARABIC";
  if (/bgs|বিজিএস|বাংলাদেশ ও বিশ্ব/.test(t)) return "BGS";
  if (/science|বিজ্ঞান/.test(t)) return "SCI";
  if (/islam|ইসলাম/.test(t)) return "ISLAM";
  if (/math|ম্যাথ|গণিত/.test(t)) return "MATH";
  if (/english|eng/.test(t)) return "ENG";
  if (/bangla|বাংলা|ban|bang/.test(t)) return "BAN";
  return null;
}

function walk(dir) {
  const outFiles = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) outFiles.push(...walk(p));
    else if (/\.(pdf|docx)$/i.test(e.name)) outFiles.push(p);
  }
  return outFiles;
}

const sha1 = (p) => crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
const stemOf = (p) => path.basename(p).replace(/\.(pdf|docx)$/i, "").replace(/(\s*\(\d+\))+$/, "").trim().toLowerCase();

const entries = [];
const skipped = [];
const seen = new Set();
for (const spec of sets) {
  const [term, year, ...rest] = spec.split(":");
  const root = rest.join(":");
  const files = walk(root).sort();
  const byKey = new Map();
  for (const f of files) {
    const rel = path.relative(path.dirname(root), f);
    const ov = OVERRIDES.find((o) => o.match.test(f));
    if (ov?.skip) {
      skipped.push({ file: f, why: ov.skip });
      continue;
    }
    const cls = classOf(path.relative(root, f)) ?? (/level\s*-?\s*\d/i.test(f) ? null : undefined);
    if (cls === 99) continue;
    if (cls === undefined) {
      skipped.push({ file: f, why: "class not recognised" });
      continue;
    }
    const subject = ov?.subject ?? subjectOf(path.relative(root, f));
    if (!subject) {
      skipped.push({ file: f, why: "subject not recognised" });
      continue;
    }
    const key = `${path.dirname(f)}|${stemOf(f)}`;
    if (!byKey.has(key)) byKey.set(key, { term, year: Number(year), classLevel: cls, subject, rel, files: [] });
    byKey.get(key).files.push(f);
  }
  for (const g of byKey.values()) {
    const docx = g.files.filter((f) => /\.docx$/i.test(f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    const pdfs = g.files.filter((f) => /\.pdf$/i.test(f));
    // Two different .docx versions of one paper (e.g. "x.docx" + "x (1).docx") are two entries.
    const originals = docx.length ? docx : pdfs.slice(0, 1);
    originals.forEach((src, idx) => {
      const hash = sha1(src);
      if (seen.has(hash)) return;
      seen.add(hash);
      const twin = idx === 0 && docx.length ? pdfs[0] : undefined;
      const level = g.classLevel === null ? (path.basename(src).match(/level\s*-?\s*(\d)/i) ?? [])[1] : null;
      const title =
        g.classLevel === null
          ? `আরবি লেভেল ${level ?? ""}`.trim()
          : `${CLASS_BN[g.classLevel]} · ${SUBJECT_BN[g.subject]}${originals.length > 1 ? ` (${idx + 1})` : ""}`;
      const isPdf = /\.pdf$/i.test(src);
      const pdf = isPdf ? src : (twin ?? path.join(pdfCache, `${hash}.pdf`));
      entries.push({
        term: g.term,
        year: g.year,
        classLevel: g.classLevel,
        subject: g.subject,
        title,
        source: src,
        pdf,
        needsConversion: !isPdf && !twin,
        hash,
      });
    });
  }
}

entries.sort((a, b) => a.year - b.year || a.term.localeCompare(b.term) || (a.classLevel ?? 9) - (b.classLevel ?? 9) || a.subject.localeCompare(b.subject));
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ pdfCache, entries, skipped }, null, 1));
const conv = entries.filter((e) => e.needsConversion).length;
console.log(`${entries.length} papers (${conv} need docx→pdf), ${skipped.length} skipped → ${out}`);
for (const s of skipped) console.log(`  skip ${s.file} — ${s.why}`);
