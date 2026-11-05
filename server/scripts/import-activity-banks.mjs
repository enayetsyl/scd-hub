#!/usr/bin/env node
/**
 * Import the school's 25 activity banks (AS-1, D-#988/#989) through the API, as Office.
 * Idempotent: a bank whose code already exists is skipped (or, with --attach, given any
 * PDF it is missing). Banks land as DRAFT; --publish publishes the ones that have pages.
 *
 *   SCD_IMPORT_EMAIL=… SCD_IMPORT_PASSWORD=… node server/scripts/import-activity-banks.mjs --api https://… \
 *        [--dir "C:/Users/HP/Downloads/Activity sheets"] [--only SD,CO] [--dry-run] [--publish] [--attach]
 *
 * The Bangla names are first drafts — Office edits them in the bank manager.
 */
import { readFileSync, existsSync } from "fs";
import path from "path";

const args = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const API = (opt("api", process.env.SCD_API ?? "http://localhost:4000")).replace(/\/$/, "");
const DIR = opt("dir", "C:/Users/HP/Downloads/Activity sheets");
const ONLY = opt("only") ? opt("only").split(",").map((s) => s.trim().toUpperCase()) : null;
const DRY = flag("dry-run");

const IDX = {
  main: "SCD_Activity_Bank_Index.csv",
  b18: "SCD_Banks_18-21_Index.csv",
  b22: "SCD_Banks_22-25_Index.csv",
  letter: "SCD_Letter_Bank_Index.csv",
  number: "SCD_Number_Bank_Index.csv",
  pattern: "SCD_Pattern_Bank_Index.csv",
  picture: "SCD_Picture_Bank_Index.csv",
  shadow: "SCD_Shadow_Bank_Index.csv",
};

// code, bank no, Bangla name, skill, index CSV, sheet PDF stem (answers = stem + "_Answers.pdf")
const BANKS = [
  ["MZ", 1, "গোলকধাঁধা", "THINKING", IDX.main, "SCD_Bank_1_Mazes"],
  ["WS", 2, "শব্দ খোঁজো", "LANGUAGE", IDX.main, "SCD_Bank_2_Word_Search"],
  ["SU", 3, "সুডোকু", "MATHS", IDX.main, "SCD_Bank_3_Sudoku"],
  ["CW", 4, "শব্দজট", "LANGUAGE", IDX.main, "SCD_Bank_4_Crossword"],
  ["SC", 5, "গোপন সংকেত", "LANGUAGE", IDX.main, "SCD_Bank_5_Secret_Code"],
  ["TR", 6, "রেখা টানো", "HAND", IDX.main, "SCD_Bank_6_Tracing"],
  ["DD", 7, "বিন্দু মেলাও", "HAND", IDX.picture, "SCD_Bank_7_Dot_to_Dot"],
  ["SD", 8, "পার্থক্য খোঁজো", "THINKING", IDX.picture, "SCD_Bank_8_Spot_the_Difference"],
  ["CO", 9, "রং করো", "HAND", IDX.picture, "SCD_Bank_9_Colouring"],
  ["SY", 10, "প্রতিসাম্য", "HAND", IDX.picture, "SCD_Bank_10_Symmetry"],
  ["CM", 11, "গুনে মেলাও", "MATHS", IDX.picture, "SCD_Bank_11_Count_and_Match"],
  ["LB", 12, "বাংলা বর্ণ", "LANGUAGE", IDX.letter, "SCD_Bank_12_Bangla_Letters"],
  ["LE", 13, "ইংরেজি বর্ণ", "LANGUAGE", IDX.letter, "SCD_Bank_13_English_Letters"],
  ["LA", 14, "আরবি হরফ", "LANGUAGE", IDX.letter, "SCD_Bank_14_Arabic_Letters"],
  ["NT", 15, "সংখ্যা", "MATHS", IDX.number, "SCD_Bank_15_Numbers"],
  ["SH", 16, "ছায়া মেলাও", "THINKING", IDX.shadow, "SCD_Bank_16_Shadow_Match"],
  ["PT", 17, "এরপর কী আসবে?", "THINKING", IDX.pattern, "SCD_Bank_17_What_Comes_Next"],
  ["OO", 18, "কোনটি আলাদা?", "THINKING", IDX.b18, "SCD_Bank_18_Odd_One_Out"],
  ["PW", 19, "ছবি ও শব্দ মেলাও", "LANGUAGE", IDX.b18, "SCD_Bank_19_Picture_Word_Match"],
  ["WU", 20, "শব্দ সাজাও", "LANGUAGE", IDX.b18, "SCD_Bank_20_Word_Scramble"],
  ["CK", 21, "ঘড়ি দেখা", "MATHS", IDX.b18, "SCD_Bank_21_Clock_Reading"],
  ["TK", 22, "টাকা গোনা", "MATHS", IDX.b22, "SCD_Bank_22_Taka_Counting"],
  ["GC", 23, "ঘর দেখে আঁকো", "HAND", IDX.b22, "SCD_Bank_23_Grid_Copy"],
  ["MP", 24, "গণিতের ধাঁধা", "MATHS", IDX.b22, "SCD_Bank_24_Maths_Puzzles"],
  ["LG", 25, "যুক্তির ছক", "THINKING", IDX.b22, "SCD_Bank_25_Logic_Grids"],
];

async function gql(token, query, variables = {}) {
  const r = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors.map((e) => e.message).join("; "));
  return j.data;
}

async function login() {
  const email = process.env.SCD_IMPORT_EMAIL;
  const password = process.env.SCD_IMPORT_PASSWORD;
  if (!email || !password) throw new Error("set SCD_IMPORT_EMAIL and SCD_IMPORT_PASSWORD (an Office / Principal login)");
  const d = await gql(null, "mutation($e:String!,$p:String!){staffLogin(email:$e,password:$p){token}}", { e: email, p: password });
  return d.staffLogin.token;
}

const file = (name) => {
  const p = path.join(DIR, name);
  return existsSync(p) ? p : null;
};

function blobOf(p) {
  return new Blob([readFileSync(p)], { type: p.endsWith(".pdf") ? "application/pdf" : "text/csv" });
}

async function upload(token, route, fields, files) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined) fd.append(k, String(v));
  for (const [k, p] of Object.entries(files)) if (p) fd.append(k, blobOf(p), path.basename(p));
  const r = await fetch(`${API}/files/${route}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

async function main() {
  const list = BANKS.filter((b) => !ONLY || ONLY.includes(b[0]));
  const plan = list.map(([code, no, nameBn, skill, csv, stem]) => ({
    code, no, nameBn, skill,
    csv: file(csv),
    sheets: file(`${stem}.pdf`),
    answers: file(`${stem}_Answers.pdf`),
  }));
  for (const p of plan) {
    console.log(`${p.code.padEnd(3)} #${String(p.no).padStart(2)} ${p.skill.padEnd(9)} csv:${p.csv ? "✓" : "✗"} sheets:${p.sheets ? "✓" : "—"} answers:${p.answers ? "✓" : "—"}  ${p.nameBn}`);
  }
  if (DRY) return;
  const token = await login();
  const existing = (await gql(token, "{ activityBanks { id code status hasSheetPdf hasAnswerPdf withoutPages } }")).activityBanks;
  const byCode = new Map(existing.map((b) => [b.code, b]));
  let added = 0, skipped = 0, attached = 0, problems = 0;
  for (const p of plan) {
    try {
      const have = byCode.get(p.code);
      if (have) {
        if (flag("attach") && ((!have.hasSheetPdf && p.sheets) || (!have.hasAnswerPdf && p.answers))) {
          await upload(token, "activity-bank", { bankId: have.id }, { sheets: have.hasSheetPdf ? null : p.sheets, answers: have.hasAnswerPdf ? null : p.answers });
          console.log(`  ${p.code}: PDFs attached`);
          attached++;
        } else skipped++;
        continue;
      }
      if (!p.csv) throw new Error("index CSV missing");
      const r = await upload(token, "activity-bank", { code: p.code, bankNo: p.no, nameBn: p.nameBn, skillArea: p.skill }, { csv: p.csv, sheets: p.sheets, answers: p.answers });
      console.log(`  ${p.code}: ${r.sheets} sheets, ${r.answersFound} answers${r.warnings?.length ? " — " + r.warnings.join("; ") : ""}`);
      byCode.set(p.code, { id: r.bankId, code: p.code, status: "DRAFT", hasSheetPdf: !!p.sheets });
      added++;
    } catch (e) {
      console.error(`  ${p.code}: PROBLEM ${e.message}`);
      problems++;
    }
  }
  if (flag("publish")) {
    const now = (await gql(token, "{ activityBanks { id code status hasSheetPdf } }")).activityBanks;
    for (const b of now.filter((x) => x.status === "DRAFT" && x.hasSheetPdf && (!ONLY || ONLY.includes(x.code)))) {
      await gql(token, "mutation($id:String!){ updateActivityBank(bankId:$id,status:\"PUBLISHED\"){ id } }", { id: b.id });
      console.log(`  ${b.code}: published`);
    }
  }
  console.log(`\nadded ${added}, attached ${attached}, already there ${skipped}, problems ${problems}`);
  if (problems) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
