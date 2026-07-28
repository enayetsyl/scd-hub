// Purge 5 ISSUED-but-never-collected homework items + their student records.
//
// DRY-RUN by default; --apply writes. Target DB via --db= (default scdhub_local).
//
// This BYPASSES two deliberate app guards (HomeworkService.deleteHomeworkItem refuses
// issued items; reconciled days are frozen, handoff §4.5). Owner-authorised: the records
// are uncollectable now and show as জমা দেওয়া হয়নি on 34 student reports. So the
// safety here is explicit rather than inherited:
//   - a fixed hwId allow-list (the 2026-07-26 / 07-27 items can never be caught)
//   - ABORT if any record carries real work (result / answer file / resubmission / top-up)
//     or has advanced past a pre-submit state since the impact survey
//   - both items AND records backed up before any write, then read back
import { readFileSync, writeFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
process.env.MONGODB_URI = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();

const APPLY = process.argv.includes("--apply");
const dbArg = process.argv.find((a) => a.startsWith("--db="));
const DB_NAME = dbArg ? dbArg.slice(5) : "scdhub_local";

/** The ONLY items this script may touch. 07-26 + 07-27 are deliberately excluded. */
const TARGET_HWIDS = [
  "HW-C5-BAN-0001", // 2026-06-29  C5 BAN   Mahfuj    (0 records — the issued/no-records anomaly)
  "HW-C2-MATH-0001", // 2026-07-14 C2 MATH  Mahfuj
  "HW-C4-SCI-0002", // 2026-07-15  C4 SCI   Tamany
  "HW-C5-BAN-0003", // 2026-07-19  C5 BAN   Enayet
  "HW-C5-BAN-0004", // 2026-07-19  C5 BAN   Mahfuj
];
/** Must never be deleted — asserted below as a tripwire. */
const KEEP_HWIDS = ["HW-C2-MATH-0004", "HW-C5-BAN-0008"];

/** States that mean "no teacher collection input yet" — anything else = real work. */
const PRE_SUBMIT = new Set(["GIVEN", "ABSENT_REDELIVER", "DUE", "CHASE"]);

const TZ_OFFSET_H = 6; // Asia/Dhaka
const localDay = (d: Date | string) =>
  new Date(new Date(d).getTime() + TZ_OFFSET_H * 3_600_000).toISOString().slice(0, 10);

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`DB = ${db.databaseName}   MODE = ${APPLY ? "APPLY (DESTRUCTIVE)" : "DRY-RUN"}`);

  // Tripwire: the keepers must exist and must not be in the target list.
  for (const k of KEEP_HWIDS) {
    if (TARGET_HWIDS.includes(k)) throw new Error(`REFUSING: keeper ${k} is in the target list`);
  }
  const keepers = await db.collection("homeworkitems").find({ hwId: { $in: KEEP_HWIDS } }).toArray();
  console.log(`keepers present (must stay ${KEEP_HWIDS.length}): ${keepers.length} -> ${keepers.map((k) => k.hwId).join(", ")}`);

  const items = await db.collection("homeworkitems").find({ hwId: { $in: TARGET_HWIDS } }).toArray();
  if (items.length !== TARGET_HWIDS.length) {
    console.log(`WARNING: matched ${items.length} of ${TARGET_HWIDS.length} targets`);
  }
  const itemIds = items.map((i) => i._id);
  const recs = await db.collection("homeworkstudentrecords").find({ hwItemId: { $in: itemIds } }).toArray();

  // ---- refuse to destroy real work ---------------------------------------
  const problems: string[] = [];
  for (const r of recs) {
    if (!PRE_SUBMIT.has(r.state)) problems.push(`${r.hwId} record ${r._id} advanced to ${r.state}`);
    if (r.result) problems.push(`${r.hwId} record ${r._id} carries RESULT=${r.result}`);
    if (r.answerFileId) problems.push(`${r.hwId} record ${r._id} has an answer file`);
    if (r.resubOf) problems.push(`${r.hwId} record ${r._id} is a resubmission`);
    if (r.topupFlag) problems.push(`${r.hwId} record ${r._id} carries a top-up`);
  }
  const children = await db
    .collection("homeworkstudentrecords")
    .countDocuments({ resubOf: { $in: recs.map((r) => r._id) } });
  if (children > 0) problems.push(`${children} record(s) elsewhere point back via resubOf`);

  const byState: Record<string, number> = {};
  for (const r of recs) byState[r.state] = (byState[r.state] ?? 0) + 1;

  console.log(`\n=== TARGETS: ${items.length} items, ${recs.length} student records ===`);
  const recons = await db.collection("homeworkreconciliations").find({}).toArray();
  const reconBy = new Map(recons.map((r) => [`${String(r.classId)}|${localDay(r.reconDate)}`, r]));
  for (const it of items) {
    const n = recs.filter((r) => String(r.hwItemId) === String(it._id)).length;
    const rc = reconBy.get(`${String(it.classId)}|${localDay(it.dateGiven)}`);
    console.log(
      `   ${it.hwId.padEnd(18)} ${localDay(it.dateGiven)} ${String(it.subject).padEnd(5)} ` +
        `status=${it.status} records=${n} recon=${rc?.reconState ?? "none"} files=${(it.attachmentIds?.length ?? 0) + (it.questionFileId ? 1 : 0)}`,
    );
  }
  console.log(`   record states: ${JSON.stringify(byState)}`);
  console.log(`   distinct students affected: ${new Set(recs.map((r) => String(r.studentId))).size}`);

  if (problems.length > 0) {
    console.log(`\n!!! ABORT — ${problems.length} record(s) carry real work:`);
    for (const p of problems.slice(0, 20)) console.log(`   ${p}`);
    await client.close();
    process.exit(1);
  }
  console.log(`\nSAFETY CHECK PASSED — every record is pre-submit, no results/files/resubmissions.`);

  if (!APPLY) {
    console.log("\nDRY-RUN — nothing deleted. Re-run with --apply.");
    await client.close();
    return;
  }

  const stamp = `${DB_NAME}`;
  const bi = `c:/pHero/Hobby/scd/scd-hub/server/scripts/backups/hw-issued-purge-items-${stamp}.json`;
  const br = `c:/pHero/Hobby/scd/scd-hub/server/scripts/backups/hw-issued-purge-records-${stamp}.json`;
  writeFileSync(bi, JSON.stringify(items, null, 2));
  writeFileSync(br, JSON.stringify(recs, null, 2));
  console.log(`\nBackups written:\n   ${bi}\n   ${br}`);

  const rDel = await db.collection("homeworkstudentrecords").deleteMany({ hwItemId: { $in: itemIds } });
  console.log(`DELETED ${rDel.deletedCount} student records.`);
  const iDel = await db.collection("homeworkitems").deleteMany({ _id: { $in: itemIds } });
  console.log(`DELETED ${iDel.deletedCount} homework items.`);

  const leftR = await db.collection("homeworkstudentrecords").countDocuments({ hwItemId: { $in: itemIds } });
  const leftI = await db.collection("homeworkitems").countDocuments({ _id: { $in: itemIds } });
  const keptStill = await db.collection("homeworkitems").countDocuments({ hwId: { $in: KEEP_HWIDS } });
  console.log(`READ-BACK: records left=${leftR} (expect 0)  items left=${leftI} (expect 0)`);
  console.log(`READ-BACK: keepers still present=${keptStill} (expect ${KEEP_HWIDS.length})`);

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
