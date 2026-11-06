#!/usr/bin/env node
/**
 * Import the generated draft papers (format scd.exam-paper-draft/v1) into the exam paper bank and,
 * optionally, assign their reviewer (D-#1031/#1032) — through the app's own API.
 *
 *   SCD_IMPORT_EMAIL=principal@… SCD_IMPORT_PASSWORD=… node server/scripts/exam-papers/import-drafts.mjs \
 *     --api https://<host> [--dir server/assets/exam-papers/annual-2026] [--reviewer "Fida"] [--dry-run]
 *
 * Idempotent: a paper whose key is already imported is left alone (its review is never
 * overwritten). --reviewer matches the reviewer by name (case-insensitive, must be ONE active
 * staff member); every paper from --dir without that reviewer gets them, in ONE call, so the
 * reviewer receives a single notification. Needs exam_papers:manage (Principal by default).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const API = String(args.api ?? "http://localhost:4000").replace(/\/+$/, "").replace(/\/graphql$/, "");
const DIR = String(args.dir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../../assets/exam-papers/annual-2026"));
const REVIEWER = args.reviewer ? String(args.reviewer) : null;
const DRY = !!args["dry-run"];

let token = null;
async function gql(query, variables = {}) {
  const r = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(`${j.errors[0].message} (${query.slice(0, 60)}…)`);
  return j.data;
}

(async () => {
  const email = process.env.SCD_IMPORT_EMAIL;
  const password = process.env.SCD_IMPORT_PASSWORD;
  if (!email || !password) throw new Error("set SCD_IMPORT_EMAIL and SCD_IMPORT_PASSWORD (a Principal login)");
  token = (await gql(`mutation($e:String!,$p:String!){staffLogin(email:$e,password:$p){token}}`, { e: email, p: password })).staffLogin.token;

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
  const existing = (await gql(`query{examPaperDrafts{id key reviewerUserId status}}`)).examPaperDrafts;
  const byKey = new Map(existing.map((p) => [p.key, p]));
  const ours = [];
  for (const f of files) {
    const json = fs.readFileSync(path.join(DIR, f), "utf8");
    const key = JSON.parse(json).key;
    if (byKey.has(key)) {
      console.log(`already there  ${key}`);
      ours.push(byKey.get(key));
      continue;
    }
    if (DRY) {
      console.log(`would import   ${key}`);
      continue;
    }
    const p = (await gql(`mutation($j:String!){importExamPaperDraft(json:$j){id key reviewerUserId status itemCount}}`, { j: json })).importExamPaperDraft;
    console.log(`imported       ${p.key} (${p.itemCount} items)`);
    ours.push(p);
  }

  if (REVIEWER) {
    const opts = (await gql(`query{examPaperReviewerOptions{id name role}}`)).examPaperReviewerOptions;
    const hits = opts.filter((o) => o.name.toLowerCase().includes(REVIEWER.toLowerCase()));
    if (hits.length !== 1) throw new Error(`--reviewer "${REVIEWER}" matched ${hits.length} staff: ${hits.map((h) => h.name).join(", ") || "none"}`);
    const r = hits[0];
    const todo = ours.filter((p) => p.reviewerUserId !== r.id && p.status !== "FINAL").map((p) => p.id);
    if (!todo.length) console.log(`\n${r.name} already reviews every paper.`);
    else if (DRY) console.log(`\nwould assign ${todo.length} papers to ${r.name}`);
    else {
      await gql(`mutation($ids:[String!]!,$r:String!){assignExamPaperReviewer(paperIds:$ids,reviewerUserId:$r){id}}`, { ids: todo, r: r.id });
      console.log(`\nassigned ${todo.length} papers to ${r.name} (one notification).`);
    }
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
