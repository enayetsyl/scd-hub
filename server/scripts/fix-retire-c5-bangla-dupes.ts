// Retire the two duplicate Class-5 Bangla class tests CT-C5-BAN-0002 and
// CT-C5-BAN-0004 in scdhub_prod by setting them CANCELLED. Keeper = CT-C5-BAN-0003
// (test #2 — the one actually sat and published: 8 results, 8 submitted, 8 published).
//
// Owner report 2026-08-03: "these are same entry. we published exam number 2. can you
// please delete these 1 and 3."
//
// WHY RETIRE, NOT HARD DELETE — the same reasoning that retired CT-C5-BAN-0001 from this
// very family on 2026-08-02 (fix-retire-classtest-dupe.ts):
//   * every dashboard / summary / report query filters `status: "PRINTED"`, and mark
//     entry refuses a non-PRINTED test — so CANCELLED gives exactly the outcome asked
//     for: the rows leave the drill-down and the Overdue counts;
//   * BOTH rows carry a DELIVERED PrintRequest (delivered 2026-07-29 10:22) — real paper
//     was printed and handed over. Deleting the test erases the record of that work and
//     orphans a delivered queue row;
//   * it is reversible; a hard delete is not.
// The precedent already proved it works: CT-C5-BAN-0001 is CANCELLED and is absent from
// the owner's screenshot, which shows only the remaining three.
//
// Read-only by default; --apply to write. Pinned by ctId; refuses any row carrying a
// result, and refuses if the keeper is not PRINTED with its published results intact.
import { readFileSync, writeFileSync } from "fs";
import { MongoClient } from "mongodb";

const uri = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8").match(/^MONGODB_URI=(.+)$/m)![1].trim();
const APPLY = process.argv.includes("--apply");
const BACKUP =
  "C:/Users/HP/AppData/Local/Temp/claude/c--pHero-Hobby-scd-scd-hub/5ff6bedc-9f9d-4c1c-ac9e-e361f6178a97/scratchpad/retired-c5-bangla-dupes.json";

const TARGETS = ["CT-C5-BAN-0002", "CT-C5-BAN-0004"] as const;
const KEEPER = "CT-C5-BAN-0003";
const NOTE =
  "Duplicate of CT-C5-BAN-0003 (same paper re-uploaded, same exam date 2026-07-29; only #2 was sat and published). Retired 2026-08-03 at the owner's request.";

async function main() {
  const c = new MongoClient(uri);
  await c.connect();
  console.log(`default db = ${c.db().databaseName}  (scdhub_local is NOT prod)`);
  const db = c.db("scdhub_prod");
  console.log(`TARGET db  = ${db.databaseName}`);
  console.log(`mode       = ${APPLY ? "APPLY (will write)" : "READ-ONLY (dry run)"}\n`);

  const tests = db.collection("classtests");
  const results = db.collection("classtestresults");

  // ---- keeper must be intact BEFORE anything is touched ---------------------
  const keeper = await tests.findOne({ ctId: KEEPER });
  if (!keeper) {
    console.log(`!! KEEPER ${KEEPER} missing — STOPPING (never leave the class with no test).`);
    await c.close();
    return;
  }
  const keeperResults = await results.countDocuments({ testId: keeper._id });
  const keeperPublished = await results.countDocuments({ testId: keeper._id, publishedAt: { $ne: null } });
  console.log(`keeper ${KEEPER}: status=${keeper.status} results=${keeperResults} published=${keeperPublished}`);
  if (keeper.status !== "PRINTED" || keeperPublished === 0) {
    console.log(`!! keeper is not a PRINTED test with published results — STOPPING.`);
    await c.close();
    return;
  }

  // ---- validate every target before writing ANY of them ---------------------
  const doomed: any[] = [];
  for (const ctId of TARGETS) {
    const row = await tests.findOne({ ctId });
    if (!row) {
      console.log(`!! ${ctId} not found — STOPPING.`);
      await c.close();
      return;
    }
    const n = await results.countDocuments({ testId: row._id });
    const pr = await db.collection("printrequests").findOne({ classTestId: row._id });
    console.log(
      `\n  retire ${row.ctId}  _id=${row._id}  testNumber=${row.testNumber}  marks=${row.totalMarks}/${row.passMark}  status=${row.status}\n` +
        `     results=${n} (must be 0)\n` +
        `     print request ${pr?._id} status=${pr?.status} — LEFT AS IS (really delivered)`,
    );
    if (n > 0) {
      console.log(`!! ${ctId} has marks — STOPPING, nothing written.`);
      await c.close();
      return;
    }
    if (row.status !== "PRINTED") {
      console.log(`!! ${ctId} is ${row.status}, expected PRINTED — STOPPING.`);
      await c.close();
      return;
    }
    doomed.push(row);
  }

  writeFileSync(BACKUP, JSON.stringify(doomed, null, 2), "utf8");
  console.log(`\n  rows written for the record -> ${BACKUP}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to set status=CANCELLED + note on both.`);
    await c.close();
    return;
  }

  for (const row of doomed) {
    await tests.updateOne(
      { _id: row._id, status: "PRINTED" },
      { $set: { status: "CANCELLED", notes: NOTE, updatedAt: new Date() } },
    );
    await db.collection("audits").insertOne({
      eventKind: "CLASS_TEST_CANCELLED",
      actorId: row.requestedBy,
      targetId: row._id,
      targetKind: "ClassTest",
      meta: { ctId: row.ctId, reason: NOTE, viaScript: "fix-retire-c5-bangla-dupes.ts", priorStatus: "PRINTED" },
      eventAt: new Date(),
      createdAt: new Date(),
    });
    const after = await tests.findOne({ _id: row._id });
    console.log(`  READ-BACK ${row.ctId}: status=${after?.status}  (expect CANCELLED)`);
  }

  const keeperAfter = await tests.findOne({ ctId: KEEPER });
  const keeperPubAfter = await results.countDocuments({ testId: keeper._id, publishedAt: { $ne: null } });
  console.log(`\n  READ-BACK ${KEEPER}: status=${keeperAfter?.status} published=${keeperPubAfter}  (expect PRINTED / 8)`);
  const printedLeft = await tests
    .find({ sectionId: keeper.sectionId, subject: "BAN", status: "PRINTED" })
    .toArray();
  console.log(`  PRINTED BAN tests left in that section: ${printedLeft.length} -> ${printedLeft.map((t: any) => t.ctId).join(", ")}`);

  await c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
