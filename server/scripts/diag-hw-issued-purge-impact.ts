// READ-ONLY impact survey: what breaks if we delete the 5 ISSUED-but-never-collected
// homework items (bucket B minus the 2026-07-26 / 07-27 keepers)?
//
// Issued items are protected by HomeworkService.deleteHomeworkItem — this is a raw
// DB operation that bypasses that guard, so every referencing collection is checked
// explicitly before anything is written.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const m = env.match(/^MONGODB_URI=(.+)$/m);
if (m) process.env.MONGODB_URI = m[1].trim();

/** The 5 to delete. 07-26 (HW-C2-MATH-0004) and 07-27 (HW-C5-BAN-0008) are KEPT. */
const TARGET_HWIDS = [
  "HW-C5-BAN-0001", // 2026-06-29, 0 records (the anomaly)
  "HW-C2-MATH-0001", // 2026-07-14
  "HW-C4-SCI-0002", // 2026-07-15
  "HW-C5-BAN-0004", // 2026-07-19
  "HW-C5-BAN-0003", // 2026-07-19
];

const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10);

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db("scdhub_prod");
  console.log("DB =", db.databaseName);

  const items = await db.collection("homeworkitems").find({ hwId: { $in: TARGET_HWIDS } }).toArray();
  console.log(`\nmatched items: ${items.length} / ${TARGET_HWIDS.length}`);
  const itemIds = items.map((i) => i._id);
  const idStrs = itemIds.map(String);

  // ---- 1. student records to be deleted -----------------------------------
  const recs = await db.collection("homeworkstudentrecords").find({ hwItemId: { $in: itemIds } }).toArray();
  const byState: Record<string, number> = {};
  for (const r of recs) byState[r.state] = (byState[r.state] ?? 0) + 1;
  console.log(`\n=== 1. student records: ${recs.length}  states=${JSON.stringify(byState)} ===`);
  const students = new Set(recs.map((r) => String(r.studentId)));
  console.log(`   distinct students touched: ${students.size}`);

  // Anything beyond a plain DUE record is a red flag — real work would be lost.
  const withResult = recs.filter((r) => r.result);
  const withFile = recs.filter((r) => r.answerFileId);
  const resubs = recs.filter((r) => r.resubOf);
  const topups = recs.filter((r) => r.topupFlag);
  console.log(`   carrying a RESULT: ${withResult.length}   answer files: ${withFile.length}`);
  console.log(`   resubmission records: ${resubs.length}   topups: ${topups.length}`);

  // Resubmissions that live on OTHER items but point INTO these records.
  const childResubs = await db
    .collection("homeworkstudentrecords")
    .countDocuments({ resubOf: { $in: recs.map((r) => r._id) } });
  console.log(`   records elsewhere whose resubOf -> a deleted record: ${childResubs}`);

  // ---- 2. reconciliation rows ---------------------------------------------
  console.log(`\n=== 2. reconciliation rows for the affected class-days ===`);
  for (const it of items) {
    const recon = await db
      .collection("homeworkreconciliations")
      .findOne({ classId: it.classId, reconDate: dayKey(it.dateGiven) });
    const sameDay = await db.collection("homeworkitems").countDocuments({
      classId: it.classId,
      dateGiven: it.dateGiven,
    });
    const trimHit = (recon?.trimLog ?? []).filter((t: any) => idStrs.includes(String(t.trimHw))).length;
    console.log(
      `   ${it.hwId} ${dayKey(it.dateGiven)}: recon=${recon?.reconState ?? "NONE"} ` +
        `dayTotal=${recon?.dayTotal ?? "-"} trimLogRowsPointingHere=${trimHit} otherItemsThatDay=${sameDay - 1}`,
    );
  }

  // ---- 3. notifications ----------------------------------------------------
  const notif = await db.collection("notifications").find({ hwItemId: { $in: idStrs } }).toArray();
  const nByKind: Record<string, number> = {};
  for (const n of notif) nByKind[n.kind ?? n.type ?? "?"] = (nByKind[n.kind ?? n.type ?? "?"] ?? 0) + 1;
  console.log(`\n=== 3. notifications referencing these items: ${notif.length} ===`);
  console.log(`   by kind: ${JSON.stringify(nByKind)}`);
  const read = notif.filter((n) => n.readAt || n.read).length;
  console.log(`   already read/delivered: ${read}`);

  // ---- 4. audit log --------------------------------------------------------
  const auditCols = await db.listCollections().toArray();
  const auditName = auditCols.map((c) => c.name).find((n) => /audit/i.test(n));
  if (auditName) {
    const n = await db.collection(auditName).countDocuments({
      $or: [{ targetId: { $in: idStrs } }, { "meta.hwItemId": { $in: idStrs } }, { entityId: { $in: idStrs } }],
    });
    console.log(`\n=== 4. audit entries (${auditName}) referencing these items: ${n} ===`);
  } else {
    console.log(`\n=== 4. no audit collection found ===`);
  }

  // ---- 5. attachments ------------------------------------------------------
  const files = items.reduce((n, i) => n + (i.attachmentIds?.length ?? 0) + (i.questionFileId ? 1 : 0), 0);
  console.log(`\n=== 5. attached question files that become orphaned: ${files} ===`);

  // ---- 6. any other collection carrying these ids --------------------------
  console.log(`\n=== 6. scan of all collections for these item ids ===`);
  for (const c of auditCols) {
    if (["homeworkitems", "homeworkstudentrecords", "notifications"].includes(c.name)) continue;
    const n = await db.collection(c.name).countDocuments({
      $or: [
        { hwItemId: { $in: idStrs } },
        { hwId: { $in: TARGET_HWIDS } },
        { itemId: { $in: itemIds } },
      ],
    });
    if (n > 0) console.log(`   ${c.name}: ${n}`);
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
