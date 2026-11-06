#!/usr/bin/env node
/**
 * Upload Mohammadpur's past papers to the exam paper bank (D-#1030) through the app's own API
 * (same gates, validation and audit as the screen). Idempotent: a paper whose original's sha1
 * is already loaded is skipped, so a failed run can simply be re-run.
 *
 *   SCD_IMPORT_EMAIL=office@… SCD_IMPORT_PASSWORD=… node server/scripts/exam-papers/import-reference-papers.mjs \
 *     --api https://<host> --manifest <manifest.json> [--dry-run]
 *
 * The manifest comes from build-reference-manifest.mjs (+ convert-docx-to-pdf.ps1 for docx
 * originals without a PDF twin). Needs an Office / Principal login (exam_papers:manage_reference).
 */
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const API = String(args.api ?? "http://localhost:4000").replace(/\/+$/, "").replace(/\/graphql$/, "");
const DRY = !!args["dry-run"];
if (!args.manifest) {
  console.error("--manifest <manifest.json> is required");
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(String(args.manifest), "utf8"));

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

async function login() {
  const email = process.env.SCD_IMPORT_EMAIL;
  const password = process.env.SCD_IMPORT_PASSWORD;
  if (!email || !password) throw new Error("set SCD_IMPORT_EMAIL and SCD_IMPORT_PASSWORD (an Office / Principal login)");
  token = (await gql(`mutation($e:String!,$p:String!){staffLogin(email:$e,password:$p){token}}`, { e: email, p: password })).staffLogin.token;
}

const MIME = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

async function upload(e) {
  const form = new FormData();
  const pdf = fs.readFileSync(e.pdf);
  form.append("file", new Blob([pdf], { type: "application/pdf" }), path.basename(e.pdf));
  if (path.resolve(e.source) !== path.resolve(e.pdf)) {
    const src = fs.readFileSync(e.source);
    form.append("source", new Blob([src], { type: MIME[path.extname(e.source).toLowerCase()] ?? "application/octet-stream" }), path.basename(e.source));
  }
  form.append("term", e.term);
  form.append("year", String(e.year));
  form.append("classLevel", e.classLevel === null || e.classLevel === undefined ? "" : String(e.classLevel));
  form.append("subject", e.subject);
  form.append("title", e.title);
  const r = await fetch(`${API}/files/reference-paper`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body.paperId;
}

(async () => {
  await login();
  let done = 0;
  let skipped = 0;
  let failed = 0;
  for (const e of manifest.entries) {
    const label = `${e.year} ${e.term} ${e.classLevel ?? "-"} ${e.subject} — ${path.basename(e.source)}`;
    if (!fs.existsSync(e.pdf)) {
      console.log(`MISSING PDF  ${label} (run convert-docx-to-pdf.ps1)`);
      failed++;
      continue;
    }
    const hit = (await gql(`query($h:String!){referencePaperByHash(hash:$h){id status}}`, { h: e.hash })).referencePaperByHash;
    if (hit && hit.status !== "FAILED") {
      skipped++;
      continue;
    }
    if (DRY) {
      console.log(`would upload ${label}`);
      continue;
    }
    try {
      const id = await upload(e);
      done++;
      console.log(`uploaded     ${label} → ${id}`);
    } catch (err) {
      failed++;
      console.log(`FAIL         ${label}: ${err.message}`);
    }
  }
  console.log(`\n${done} uploaded, ${skipped} already there, ${failed} failed (pages render in the background — the shelf shows them READY in a minute).`);
  if (failed) process.exitCode = 1;
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
