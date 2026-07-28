// Generic purge for owner-selected homework items + their student records.
// Replaces the one-off purge-hw-*.ts scripts; the earlier ones are kept only as the
// record of what they removed.
//
//   npx tsx server/scripts/purge-hw-items.ts --db=scdhub_prod --ids=HW-C2-MATH-0002,HW-C2-MATH-0003
//   ... --apply                      actually delete (default is DRY-RUN)
//   ... --allow-graded=HW-X:3        authorise destroying N graded/advanced records on item X
//
// Deleting an ISSUED item bypasses two deliberate app guards (HomeworkService
// refuses issued items; reconciled days are frozen, handoff §4.5). That is an owner
// decision each time, so this script makes the consequences explicit instead of
// silent: it ABORTS if any record has moved past a pre-submit state unless that item
// is named in --allow-graded with an exact count, and it ABORTS if a resubmission
// elsewhere points into the records being removed.
import { readFileSync, writeFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
process.env.MONGODB_URI = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();

const argOf = (name: string): string | null => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};

const APPLY = process.argv.includes("--apply");
const DB_NAME = argOf("db") ?? "scdhub_local";
const IDS = (argOf("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const TAG = argOf("tag") ?? "adhoc";

/** --allow-graded=HW-A:3,HW-B:1 → { "HW-A": 3, "HW-B": 1 } */
const ALLOW_GRADED: Record<string, number> = {};
for (const part of (argOf("allow-graded") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const [hwId, n] = part.split(":");
  ALLOW_GRADED[hwId] = Number(n ?? 0);
}

const PRE_SUBMIT = new Set(["GIVEN", "ABSENT_REDELIVER", "DUE", "CHASE"]);
const TZ = 6; // Asia/Dhaka
const localDay = (d: Date | string) =>
  new Date(new Date(d).getTime() + TZ * 3_600_000).toISOString().slice(0, 10);

async function main() {
  if (IDS.length === 0) throw new Error("--ids= is required (comma-separated HW ids)");

  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`DB = ${db.databaseName}   MODE = ${APPLY ? "APPLY (DESTRUCTIVE)" : "DRY-RUN"}`);
  console.log(`targets (${IDS.length}): ${IDS.join(", ")}`);

  const items = await db.collection("homeworkitems").find({ hwId: { $in: IDS } }).toArray();
  const missing = IDS.filter((h) => !items.some((i) => i.hwId === h));
  if (missing.length) console.log(`WARNING: not found -> ${missing.join(", ")}`);

  const itemIds = items.map((i) => i._id);
  const recs = await db.collection("homeworkstudentrecords").find({ hwItemId: { $in: itemIds } }).toArray();

  const recons = await db.collection("homeworkreconciliations").find({}).toArray();
  const reconBy = new Map(recons.map((r) => [`${String(r.classId)}|${localDay(r.reconDate)}`, r]));

  // ---- guards -------------------------------------------------------------
  const problems: string[] = [];
  const advanced = new Map<string, number>();
  for (const r of recs) {
    if (PRE_SUBMIT.has(r.state)) continue;
    const it = items.find((i) => String(i._id) === String(r.hwItemId));
    const hwId = String(it?.hwId ?? r.hwId);
    advanced.set(hwId, (advanced.get(hwId) ?? 0) + 1);
  }
  for (const [hwId, n] of advanced) {
    const allowed = ALLOW_GRADED[hwId] ?? 0;
    if (n > allowed) {
      problems.push(
        `${hwId}: ${n} record(s) past pre-submit, only ${allowed} authorised ` +
          `(re-run with --allow-graded=${hwId}:${n} if that loss is intended)`,
      );
    }
  }
  // A resubmission pointing INTO these records only matters if the child itself
  // survives — then it would be orphaned. A child on an item we are also deleting
  // goes with its parent, so the chain closes cleanly and is not a problem.
  const children = await db
    .collection("homeworkstudentrecords")
    .find({ resubOf: { $in: recs.map((r) => r._id) } })
    .toArray();
  const idSet = new Set(itemIds.map(String));
  const orphaned = children.filter((c) => !idSet.has(String(c.hwItemId)));
  if (orphaned.length > 0) {
    problems.push(
      `${orphaned.length} resubmission record(s) OUTSIDE the delete list point back via resubOf ` +
        `(${orphaned.map((c) => c.hwId).join(", ")}) — they would be orphaned`,
    );
  }
  if (children.length !== orphaned.length) {
    console.log(
      `note: ${children.length - orphaned.length} resubmission record(s) point into this set but are ` +
        `themselves being deleted — chain closes cleanly.`,
    );
  }

  // ---- report -------------------------------------------------------------
  const byState: Record<string, number> = {};
  for (const r of recs) byState[r.state] = (byState[r.state] ?? 0) + 1;

  console.log(`\n=== ${items.length} items, ${recs.length} records ===`);
  for (const it of items.sort((a, b) => String(a.hwId).localeCompare(String(b.hwId)))) {
    const mine = recs.filter((r) => String(r.hwItemId) === String(it._id));
    const graded = mine.filter((r) => r.result).length;
    const rc = reconBy.get(`${String(it.classId)}|${localDay(it.dateGiven)}`);
    console.log(
      `   ${String(it.hwId).padEnd(17)} ${localDay(it.dateGiven)} ${String(it.subject).padEnd(5)} ` +
        `status=${it.status} records=${mine.length} graded=${graded} recon=${rc?.reconState ?? "none"} ` +
        `files=${(it.attachmentIds?.length ?? 0) + (it.questionFileId ? 1 : 0)}` +
        (graded ? "   <-- AUTHORISED graded loss" : ""),
    );
  }
  console.log(`   states: ${JSON.stringify(byState)}`);
  console.log(`   distinct students: ${new Set(recs.map((r) => String(r.studentId))).size}`);

  if (problems.length) {
    console.log(`\n!!! ABORT:`);
    for (const p of problems) console.log(`   ${p}`);
    await client.close();
    process.exit(1);
  }
  console.log(`\nGUARDS PASSED.`);

  if (!APPLY) {
    console.log("\nDRY-RUN — nothing deleted. Re-run with --apply.");
    await client.close();
    return;
  }

  const bi = `c:/pHero/Hobby/scd/scd-hub/server/scripts/backups/hw-purge-${TAG}-items-${DB_NAME}.json`;
  const br = `c:/pHero/Hobby/scd/scd-hub/server/scripts/backups/hw-purge-${TAG}-records-${DB_NAME}.json`;
  writeFileSync(bi, JSON.stringify(items, null, 2));
  writeFileSync(br, JSON.stringify(recs, null, 2));
  console.log(`\nBackups written:\n   ${bi}\n   ${br}`);

  const rDel = await db.collection("homeworkstudentrecords").deleteMany({ hwItemId: { $in: itemIds } });
  console.log(`DELETED ${rDel.deletedCount} student records.`);
  const iDel = await db.collection("homeworkitems").deleteMany({ _id: { $in: itemIds } });
  console.log(`DELETED ${iDel.deletedCount} homework items.`);

  const leftR = await db.collection("homeworkstudentrecords").countDocuments({ hwItemId: { $in: itemIds } });
  const leftI = await db.collection("homeworkitems").countDocuments({ _id: { $in: itemIds } });
  console.log(`READ-BACK: records left=${leftR} (expect 0)  items left=${leftI} (expect 0)`);

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
