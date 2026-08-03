// Correct the total marks on CT-C3-ENG-0002 (Class 3 English test #2, 2026-07-30,
// Mahmudur Rahman Tazkir): recorded as 42, the paper is actually out of 32.
//
// Owner report 2026-08-03. Pass mark moves 21 -> 16 on the owner's decision: 21/42 is
// exactly 50%, deliberately set rather than the app's 40% default (which would have
// been 17), so 16/32 keeps the same 50% standard.
//
// SAFE TO CHANGE: the exam has ZERO results attached, so no entered mark, percentage
// or pass/fail flag depends on the old total. The script REFUSES if that stops being
// true — changing the denominator under existing marks would silently re-grade
// students, and published percentages would shift on guardians' screens.
//
// Read-only by default; --apply to write. Pinned by ctId, with the before/after dumped
// for the record.
import { readFileSync, writeFileSync } from "fs";
import { MongoClient } from "mongodb";

const uri = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8").match(/^MONGODB_URI=(.+)$/m)![1].trim();
const APPLY = process.argv.includes("--apply");
const CT = "CT-C3-ENG-0002";
const NEW_TOTAL = 32;
const NEW_PASS = 16;
const BACKUP = "c:/pHero/Hobby/scd/scd-hub/server/scripts/backups/marks-fix-CT-C3-ENG-0002-scdhub_prod.json";

async function main() {
  const c = new MongoClient(uri);
  await c.connect();
  console.log(`default db = ${c.db().databaseName}  (scdhub_local is NOT prod)`);
  const db = c.db("scdhub_prod");
  console.log(`TARGET db  = ${db.databaseName}`);
  console.log(`mode       = ${APPLY ? "APPLY (will write)" : "READ-ONLY (dry run)"}\n`);

  const tests = db.collection("classtests");
  const t = await tests.findOne({ ctId: CT });
  if (!t) {
    console.log(`${CT} not found — nothing to do.`);
    await c.close();
    return;
  }

  const results = await db.collection("classtestresults").countDocuments({ testId: t._id });
  console.log(
    `  ${t.ctId}  _id=${t._id}\n` +
      `     status=${t.status}  totalMarks=${t.totalMarks}  passMark=${t.passMark}\n` +
      `     results attached: ${results} (must be 0)\n` +
      `     -> totalMarks ${t.totalMarks} → ${NEW_TOTAL}, passMark ${t.passMark} → ${NEW_PASS}`,
  );

  if (results > 0) {
    console.log(`\n!! ${CT} has ${results} result(s) — changing the total would re-grade them. STOPPING.`);
    await c.close();
    return;
  }
  if (t.totalMarks === NEW_TOTAL && t.passMark === NEW_PASS) {
    console.log(`\n  already corrected — nothing to do.`);
    await c.close();
    return;
  }

  writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), before: t, after: { totalMarks: NEW_TOTAL, passMark: NEW_PASS } }, null, 2), "utf8");
  console.log(`\n  before-state written -> ${BACKUP}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.`);
    await c.close();
    return;
  }

  await tests.updateOne({ _id: t._id }, { $set: { totalMarks: NEW_TOTAL, passMark: NEW_PASS, updatedAt: new Date() } });
  await db.collection("audits").insertOne({
    eventKind: "TRACKER_WRITE",
    actorId: t.requestedBy,
    targetId: t._id,
    targetKind: "ClassTest",
    meta: {
      ctId: t.ctId,
      change: "totalMarks/passMark corrected at the owner's request",
      from: { totalMarks: t.totalMarks, passMark: t.passMark },
      to: { totalMarks: NEW_TOTAL, passMark: NEW_PASS },
      viaScript: "fix-c3-eng-0002-total-marks.ts",
    },
    eventAt: new Date(),
    createdAt: new Date(),
  });

  const after = await tests.findOne({ _id: t._id });
  console.log(`\n  READ-BACK: totalMarks=${after?.totalMarks} passMark=${after?.passMark}  (expect ${NEW_TOTAL} / ${NEW_PASS})`);

  await c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
