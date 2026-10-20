#!/usr/bin/env node
/**
 * mastery_catalogue_to_json.mjs — convert a learning-outcome catalogue file
 * (docs/mastery/lo-catalogue/<CLASS>_<SUBJ>.md) into the JSON the app imports
 * (`importMasteryCatalogue`, docs/prd-mastery.md §5.1), validating it with the SAME
 * rules the server applies (server/src/modules/mastery/catalogue.ts).
 *
 * Usage:
 *   npx tsx skills/_tools/mastery_catalogue_to_json.mjs <file.md> [--out <file.json>]
 *   npx tsx skills/_tools/mastery_catalogue_to_json.mjs --check docs/mastery/lo-catalogue
 *
 * --check validates every C*.md / NUR_*.md / KG_*.md in the folder and prints one line per
 * file; exit 1 if any fails. Without --out the JSON goes to stdout.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseCatalogueImport } from "../../server/src/modules/mastery/catalogue.ts";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const toAscii = (s) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

function sections(text) {
  const out = new Map();
  let cur = "";
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      cur = m[1].trim();
      out.set(cur, []);
    } else if (cur) out.get(cur).push(line);
  }
  return out;
}

/** The first Markdown table in a section: header cells + body rows (cells trimmed). */
function firstTable(lines) {
  const rows = [];
  let started = false;
  for (const l of lines) {
    if (/^\s*\|/.test(l)) {
      started = true;
      if (/^\s*\|\s*:?-{2,}/.test(l)) continue; // separator
      rows.push(l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
    } else if (started) break;
  }
  if (rows.length === 0) return { header: [], body: [] };
  return { header: rows[0], body: rows.slice(1) };
}

function sectionByPrefix(secs, prefix) {
  for (const [k, v] of secs) if (k.toLowerCase().startsWith(prefix)) return v;
  return [];
}

const col = (header, re) => header.findIndex((h) => re.test(h));
const qtList = (cell) => (cell.match(/QT-[A-Z0-9]+(?:-[A-Z0-9]+)*/g) ?? []);
const assessOf = (cell) => (/রুব্রিক|rubric/i.test(cell) ? "RUBRIC" : "QUESTION");
const clean = (cell) => (cell === undefined || cell === "—" || cell === "-" ? "" : cell.replace(/\*\*/g, "").trim());

function marksOf(cell) {
  const c = toAscii(clean(cell));
  if (!c) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(c);
  return m ? Number(m[1]) : null;
}

function chapterNo(cell) {
  const c = toAscii(cell);
  const code = /code\s*(\d+)/i.exec(c);
  if (code) return Number(code[1]);
  const m = /^\s*(\d+)/.exec(c);
  return m ? Number(m[1]) : null;
}

export function convert(file) {
  const text = readFileSync(file, "utf8");
  const [cls, subj] = basename(file, ".md").split("_");
  const statusLine = /\*\*Status:\*\*\s*([A-Z]+)/.exec(text);
  const sourceLine = /\*\*Source:\*\*\s*`([^`]+)`/.exec(text);
  const secs = sections(text);

  const ch = firstTable(sectionByPrefix(secs, "chapters"));
  const chapters = ch.body
    .map((r) => ({ number: chapterNo(r[0] ?? ""), titleBn: clean(r[1]), termNote: clean(r[2]) || undefined }))
    .filter((c) => c.number !== null);

  const lo = firstTable(sectionByPrefix(secs, "learning outcomes"));
  const iCode = col(lo.header, /^code$/i);
  const iLabel = col(lo.header, /^label/i);
  const iWording = col(lo.header, /wording/i);
  const iNctb = col(lo.header, /nctb/i);
  const iAssess = col(lo.header, /^assess/i);
  const iQt = col(lo.header, /question types/i);
  const iTip = col(lo.header, /home tip/i);
  const outcomes = lo.body
    .filter((r) => /^LO-/.test(r[iCode] ?? ""))
    .map((r) => ({
      code: r[iCode],
      labelBn: clean(r[iLabel]),
      sourceText: clean(r[iWording]),
      nctbCode: iNctb >= 0 ? clean(r[iNctb]) || undefined : undefined,
      assess: assessOf(r[iAssess] ?? ""),
      questionTypeCodes: qtList(r[iQt] ?? ""),
      homeTipBn: iTip >= 0 ? clean(r[iTip]) || undefined : undefined,
    }));

  const sk = firstTable(sectionByPrefix(secs, "skill strands"));
  const sCode = col(sk.header, /^code$/i);
  const sLabel = col(sk.header, /^skill/i);
  const sFrom = col(sk.header, /evidence/i);
  const sAssess = col(sk.header, /^assess/i);
  for (const r of sk.body.filter((r) => /^LO-/.test(r[sCode] ?? ""))) {
    outcomes.push({
      code: r[sCode],
      labelBn: clean(r[sLabel]),
      sourceText: clean(r[sFrom]),
      assess: assessOf(r[sAssess] ?? ""),
      questionTypeCodes: qtList(r[sFrom] ?? ""),
    });
  }

  const qt = firstTable(sectionByPrefix(secs, "question types"));
  const qCode = col(qt.header, /^code$/i);
  const qLabel = col(qt.header, /question type/i);
  const qMarks = col(qt.header, /marks/i);
  const qForm = col(qt.header, /answer form/i);
  const qNotes = col(qt.header, /notes/i);
  const questionTypes = qt.body
    .filter((r) => /^QT-/.test(r[qCode] ?? ""))
    .map((r) => ({
      code: r[qCode],
      labelBn: clean(r[qLabel]) || r[qCode],
      marks: marksOf(r[qMarks]),
      answerForm: clean(r[qForm]) || undefined,
      notes: clean(r[qNotes]) || undefined,
    }));

  return {
    classToken: cls,
    subject: subj,
    status: statusLine ? statusLine[1] : "DRAFT",
    bookRef: sourceLine ? sourceLine[1] : undefined,
    chapters,
    outcomes,
    questionTypes,
  };
}

function main(argv) {
  if (argv[0] === "--check") {
    const dir = argv[1] ?? "docs/mastery/lo-catalogue";
    const files = readdirSync(dir).filter((f) => /^(C[1-6]|NUR|KG)_[A-Z]+\.md$/.test(f)).sort();
    let fails = 0;
    for (const f of files) {
      const json = convert(join(dir, f));
      const res = parseCatalogueImport(json);
      if (res.ok) {
        const c = res.catalogue;
        const sk = c.outcomes.filter((o) => o.strand).length;
        console.log(`PASS  ${f.padEnd(12)} ${c.status.padEnd(6)} chapters ${c.chapters.length}  LO ${c.outcomes.length - sk}  SK ${sk}  QT ${c.questionTypes.length}`);
      } else {
        fails += 1;
        console.log(`FAIL  ${f}`);
        for (const e of res.errors.slice(0, 20)) console.log(`      ${e}`);
      }
    }
    console.log(`\nRESULT: ${fails === 0 ? `PASS — ${files.length} catalogue files valid` : `${fails} FAILED`}`);
    process.exit(fails === 0 ? 0 : 1);
  }
  const file = argv[0];
  if (!file || !statSync(file).isFile()) {
    console.error("usage: mastery_catalogue_to_json.mjs <file.md> [--out <file.json>] | --check <dir>");
    process.exit(2);
  }
  const json = convert(file);
  const res = parseCatalogueImport(json);
  if (!res.ok) {
    console.error(`INVALID ${file}`);
    for (const e of res.errors) console.error(`  ${e}`);
    process.exit(1);
  }
  const outIdx = argv.indexOf("--out");
  const text = JSON.stringify(json, null, 2);
  if (outIdx >= 0 && argv[outIdx + 1]) {
    writeFileSync(argv[outIdx + 1], text + "\n");
    console.error(`wrote ${argv[outIdx + 1]}`);
  } else {
    process.stdout.write(text + "\n");
  }
}

main(process.argv.slice(2));
