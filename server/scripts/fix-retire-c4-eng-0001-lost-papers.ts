// Retire CT-C4-ENG-0001 (Class 4 English, test #1, 2026-07-23, Mahzabin Yasmin) in
// scdhub_prod: the answer papers were LOST, so marks can never be entered and the row
// sits Overdue forever.
//
// Owner ask 2026-08-03: "lost the actual exam papers. so want to delete it with a
// backup so if needed later can recover otherwise should kept as deleted."
//
// HOW "DELETE WITH A BACKUP" IS DONE HERE — status CANCELLED, not a row delete:
//   * every dashboard / summary / report query filters `status: "PRINTED"`, and mark
//     entry refuses a non-PRINTED test, so the row leaves the Class-test dashboard and
//     stops counting as Overdue — the visible outcome asked for;
//   * the row itself stays fully intact in the database, so "recover later" is one
//     status flip, not a restore-from-file. That is a far stronger recovery guarantee
//     than deleting and keeping a JSON copy;
//   * a JSON dump is written anyway (belt and braces) before anything is touched;
//   * its PrintRequest was really DELIVERED — paper was printed and handed over — and
//     is left untouched, so the record of that work survives.
//
// `cancelClassTest` cannot do this: it refuses anything that is not REQUESTED, and has
// no app UI at all. Hence a pinned script.
//
// Read-only by default; --apply to write. Pinned by ctId; refuses if the test carries
// ANY result (that would mean marks exist and the papers were not lost after all).
import { readFileSync, writeFileSync } from "fs";
import { MongoClient } from "mongodb";

const uri = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8").match(/^MONGODB_URI=(.+)$/m)![1].trim();
const APPLY = process.argv.includes("--apply");
const TARGET = "CT-C4-ENG-0001";
const BACKUP = `c:/pHero/Hobby/scd/scd-hub/server/scripts/backups/retired-classtest-${TARGET}-scdhub_prod.json`;
const NOTE =
  "Answer papers lost — marks can never be entered, so the exam was retired rather than left Overdue forever. Retired 2026-08-03 at the owner's request. Reversible: set status back to PRINTED to restore it to the dashboard.";

const day = (d: unknown) => (d ? new Date(d as Date).toISOString().replace("T", " ").slice(0, 16) : "-");

async function main() {
  const c = new MongoClient(uri);
  await c.connect();
  console.log(`default db = ${c.db().databaseName}  (scdhub_local is NOT prod)`);
  const db = c.db("scdhub_prod");
  console.log(`TARGET db  = ${db.databaseName}`);
  console.log(`mode       = ${APPLY ? "APPLY (will write)" : "READ-ONLY (dry run)"}\n`);

  const tests = db.collection("classtests");
  const test = await tests.findOne({ ctId: TARGET });
  if (!test) {
    console.log(`${TARGET} not found — nothing to do.`);
    await c.close();
    return;
  }

  const users = await db.collection("users").find({}).project({ name: 1 }).toArray();
  const uName = new Map(users.map((u: any) => [String(u._id), u.name]));

  const results = await db.collection("classtestresults").find({ testId: test._id }).toArray();
  const prints = await db.collection("printrequests").find({ classTestId: test._id }).toArray();
  const qreqs = await db.collection("classtestquestionrequests").find({ testId: test._id }).toArray();

  console.log(
    `  ${test.ctId}  _id=${test._id}\n` +
      `     testNumber=${test.testNumber}  status=${test.status}  examDate=${day(test.examDate)}\n` +
      `     marks=${test.totalMarks}/${test.passMark}  teacher=${uName.get(String(test.teacherId)) ?? "-"}\n` +
      `     printedBy=${uName.get(String(test.printedBy)) ?? "-"}  printedAt=${day(test.printedAt)}\n` +
      `     results=${results.length} (must be 0)\n` +
      `     printRequests=${prints.length}${(prints as any[]).map((p) => ` [${p.status}]`).join("")} — LEFT AS IS\n` +
      `     questionRequests=${qreqs.length}`,
  );

  if (results.length > 0) {
    console.log(`\n!! ${TARGET} carries ${results.length} result row(s) — marks exist, so the papers were NOT lost. STOPPING.`);
    await c.close();
    return;
  }
  if (test.status !== "PRINTED") {
    console.log(`\n!! ${TARGET} is ${test.status}, expected PRINTED — STOPPING.`);
    await c.close();
    return;
  }

  // Full snapshot of everything that references this test, before any write.
  writeFileSync(
    BACKUP,
    JSON.stringify({ retiredAt: new Date().toISOString(), reason: NOTE, test, results, printRequests: prints, questionRequests: qreqs }, null, 2),
    "utf8",
  );
  console.log(`\n  backup written -> ${BACKUP}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to set status=CANCELLED + note.`);
    await c.close();
    return;
  }

  await tests.updateOne(
    { _id: test._id, status: "PRINTED" },
    { $set: { status: "CANCELLED", notes: NOTE, updatedAt: new Date() } },
  );
  await db.collection("audits").insertOne({
    eventKind: "CLASS_TEST_CANCELLED",
    actorId: test.requestedBy,
    targetId: test._id,
    targetKind: "ClassTest",
    meta: { ctId: test.ctId, reason: "answer papers lost", note: NOTE, viaScript: "fix-retire-c4-eng-0001-lost-papers.ts", priorStatus: "PRINTED" },
    eventAt: new Date(),
    createdAt: new Date(),
  });

  const after = await tests.findOne({ _id: test._id });
  console.log(`\n  READ-BACK ${TARGET}: status=${after?.status}  (expect CANCELLED)`);
  const printedLeft = await tests.countDocuments({ sectionId: test.sectionId, subject: "ENG", status: "PRINTED" });
  console.log(`  PRINTED English tests left in that section: ${printedLeft}`);
  console.log(`\n  TO RESTORE: set status back to "PRINTED" on _id=${test._id} (row never left the database).`);

  await c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
