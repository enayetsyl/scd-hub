#!/usr/bin/env node
/**
 * Import the school's storybook series into the storybook shelf (SB-1, D-#980/#986).
 *
 * Goes through the app's own API with an Office login — the same gates, validation and
 * audit as the screens — so it runs against local or production alike, from the machine
 * that holds the PDFs. Idempotent: a series is found by code, a book by its number in the
 * series; anything already there is left alone (re-run safely after a failure).
 *
 *   SCD_IMPORT_EMAIL=office@… SCD_IMPORT_PASSWORD=… node server/scripts/import-storybooks.mjs \
 *     --api https://<host> --root "C:/Users/HP/Downloads" [--manifest <dir>] [--only TRE,FRU] [--publish] [--dry-run]
 *
 * --manifest (default docs/storybooks/manifest): one JSON per folder (folder, seriesNameBn/En, seriesAboutBn, seriesLearnPointsBn,
 *   books[{ seriesNo, fileName, titleBn, titleEn, learnedPointsBn, parentTipBn, themeBn? }]) —
 *   Bangla read from the rendered covers and back pages, spot-checked by Office.
 * --publish: publish the series and every imported book (default: leave them as drafts so
 *   Office can check them in the app first).
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
const ROOT = String(args.root ?? "C:/Users/HP/Downloads");
const MANIFEST = String(args.manifest ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../../docs/storybooks/manifest"));
const ONLY = args.only ? String(args.only).split(",") : null;
const PUBLISH = !!args.publish;
const DRY = !!args["dry-run"];

/** The 12 series as the school printed them (D-#980). Band 3-6 for all of them (D-#981). */
const SERIES = [
  { folder: "Tree_Adventures", code: "TRE", order: 1, tags: ["প্রকৃতি", "রহস্য"] },
  { folder: "Fruit_Storybooks_Bangla_English", code: "FRU", order: 2, tags: ["প্রকৃতি", "রহস্য"] },
  { folder: "SCD_Animal_Books_Bangla_English", code: "ANI", order: 3, tags: ["প্রকৃতি", "প্রাণী"] },
  { folder: "SCD_Bird_Storybooks_Bangla_English", code: "BRD", order: 4, tags: ["প্রকৃতি", "প্রাণী"] },
  { folder: "SCD_Sea_Creature_Books", code: "SEC", order: 5, tags: ["প্রকৃতি", "প্রাণী"] },
  { folder: "SCD_Science_Storybooks", code: "SCI", order: 6, tags: ["বিজ্ঞান ও স্বাস্থ্য", "নিরাপত্তা"] },
  { folder: "Little_Muslim_Storybooks_Set2", code: "LMB", order: 7, tags: ["আদব"] },
  { folder: "Little_Muslim_Storybooks", code: "LMA", order: 8, tags: ["আদব", "দৈনন্দিন জীবন"] },
  { folder: "Little_Helpers_20_Books", code: "HLP", order: 9, tags: ["সাহায্য করা", "দৈনন্দিন জীবন"] },
  { folder: "SCD_Vehicle_Storybooks", code: "VEH", order: 10, tags: ["যানবাহন", "নিরাপত্তা"] },
  { folder: "Forest_Mountain_Adventures_Bangla-English", code: "FOR", order: 11, tags: ["অভিযান", "ভূগোল"] },
  { folder: "Seas_of_the_World_All_10_Books", code: "SOW", order: 12, tags: ["অভিযান", "ভূগোল"] },
];
const TAG_EN = {
  "প্রকৃতি": "Nature", "রহস্য": "Mystery", "প্রাণী": "Animals", "বিজ্ঞান ও স্বাস্থ্য": "Science & health",
  "নিরাপত্তা": "Safety", "আদব": "Manners", "দৈনন্দিন জীবন": "Daily life", "সাহায্য করা": "Helping",
  "যানবাহন": "Transport", "অভিযান": "Adventure", "ভূগোল": "Geography",
};

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

async function ensureTags(names) {
  const existing = (await gql(`query{storyTags(includeInactive:false){id nameBn}}`)).storyTags;
  const byName = new Map(existing.map((t) => [t.nameBn, t.id]));
  for (const n of names) {
    if (byName.has(n)) continue;
    if (DRY) { byName.set(n, `dry-${n}`); continue; }
    const t = (await gql(`mutation($b:String!,$e:String){createStoryTag(nameBn:$b,nameEn:$e){id}}`, { b: n, e: TAG_EN[n] ?? null })).createStoryTag;
    byName.set(n, t.id);
    console.log(`  + tag ${n}`);
  }
  return byName;
}

async function upload(pdfPath, fields) {
  const fd = new FormData();
  fd.append("file", new Blob([fs.readFileSync(pdfPath)], { type: "application/pdf" }), path.basename(pdfPath));
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  const r = await fetch(`${API}/files/storybook`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`upload ${path.basename(pdfPath)}: ${body.error ?? r.status}`);
  return body.titleId;
}

async function main() {
  await login();
  const shelf = (await gql(`query{storyShelf{id code}}`)).storyShelf;
  const seriesByCode = new Map(shelf.map((s) => [s.code, s.id]));
  const themeNames = new Set();
  const manifests = new Map();
  for (const s of SERIES) {
    if (ONLY && !ONLY.includes(s.code)) continue;
    const f = path.join(MANIFEST, `${s.folder}.json`);
    if (!fs.existsSync(f)) { console.log(`skip ${s.code}: no manifest ${f}`); continue; }
    const m = JSON.parse(fs.readFileSync(f, "utf8"));
    manifests.set(s.code, m);
    for (const b of m.books) if (b.themeBn) themeNames.add(b.themeBn);
  }
  const tagIds = await ensureTags([...new Set([...SERIES.flatMap((s) => s.tags), ...themeNames])]);
  let made = 0, skipped = 0, failed = 0;

  for (const s of SERIES) {
    const m = manifests.get(s.code);
    if (!m) continue;
    console.log(`\n${s.code} — ${m.seriesNameBn} (${m.books.length} books)`);
    let seriesId = seriesByCode.get(s.code);
    if (!seriesId && !DRY) {
      seriesId = (await gql(
        `mutation($c:String!,$b:String!,$e:String,$t:[String!],$a:String,$l:[String!],$o:Int){createStorySeries(code:$c,nameBn:$b,nameEn:$e,ageBandCode:"3-6",tagIds:$t,aboutBn:$a,learnPointsBn:$l,sortOrder:$o){id}}`,
        { c: s.code, b: m.seriesNameBn, e: m.seriesNameEn ?? null, t: s.tags.map((n) => tagIds.get(n)), a: m.seriesAboutBn ?? null, l: m.seriesLearnPointsBn ?? [], o: s.order },
      )).createStorySeries.id;
      console.log(`  + series ${s.code}`);
    }
    const have = seriesId
      ? new Set((await gql(`query($id:String!){storySeries(seriesId:$id){books{seriesNo}}}`, { id: seriesId })).storySeries.books.map((b) => b.seriesNo))
      : new Set();

    for (const b of [...m.books].sort((x, y) => x.seriesNo - y.seriesNo)) {
      if (have.has(b.seriesNo)) { skipped += 1; continue; }
      if (!b.titleBn || b.titleBn === "?" || b.unclear) { console.log(`  ! ${b.seriesNo} ${b.fileName}: no readable Bangla title — left out`); failed += 1; continue; }
      const pdf = path.join(ROOT, s.folder, b.fileName);
      if (!fs.existsSync(pdf)) { console.log(`  ! ${b.seriesNo} missing file ${pdf}`); failed += 1; continue; }
      if (DRY) { console.log(`  · would add ${b.seriesNo} ${b.titleBn}`); made += 1; continue; }
      try {
        const titleId = await upload(pdf, { seriesId, seriesNo: b.seriesNo, titleBn: b.titleBn, titleEn: b.titleEn ?? "" });
        const tags = [...s.tags, ...(b.themeBn ? [b.themeBn] : [])].map((n) => tagIds.get(n));
        await gql(
          `mutation($id:String!,$l:[String!],$p:String,$t:[String!]){updateStoryBook(titleId:$id,learnedPointsBn:$l,parentTipBn:$p,tagIds:$t){id}}`,
          { id: titleId, l: b.learnedPointsBn ?? [], p: b.parentTipBn ?? "", t: tags },
        );
        if (PUBLISH) await gql(`mutation($id:String!){setStoryBookPublished(titleId:$id,published:true){id}}`, { id: titleId });
        made += 1;
        console.log(`  + ${b.seriesNo} ${b.titleBn}`);
      } catch (e) {
        failed += 1;
        console.log(`  ! ${b.seriesNo} ${b.fileName}: ${e.message}`);
      }
    }
    if (PUBLISH && seriesId && !DRY) await gql(`mutation($id:String!){updateStorySeries(seriesId:$id,status:"PUBLISHED"){id}}`, { id: seriesId });
  }
  console.log(`\nadded ${made}, already there ${skipped}, problems ${failed}${DRY ? " (dry run — nothing written)" : ""}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
