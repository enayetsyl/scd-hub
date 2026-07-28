// Recheck the reconciliation state with a CORRECT Date match (reconDate is a Date at
// local midnight = 18:00Z the prior day, Dhaka UTC+6 — a string key never matches).
//
// Two questions:
//   A) the 24 items already deleted — were any of their days actually reconciled
//      (i.e. did the purge violate the frozen-day rule it claimed to enforce)?
//   B) the 5 issued items proposed for deletion — what is their real recon state?
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
process.env.MONGODB_URI = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();

const TZ_OFFSET_H = 6; // Asia/Dhaka
/** Local (Dhaka) calendar day of any stored Date. */
const localDay = (d: Date | string) =>
  new Date(new Date(d).getTime() + TZ_OFFSET_H * 3_600_000).toISOString().slice(0, 10);

const TARGET_HWIDS = [
  "HW-C5-BAN-0001",
  "HW-C2-MATH-0001",
  "HW-C4-SCI-0002",
  "HW-C5-BAN-0004",
  "HW-C5-BAN-0003",
];

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!);
  await c.connect();
  const db = c.db("scdhub_prod");
  console.log("DB =", db.databaseName);

  // Index every reconciliation row by classId|localDay.
  const recons = await db.collection("homeworkreconciliations").find({}).toArray();
  const reconBy = new Map<string, any>();
  for (const r of recons) reconBy.set(`${String(r.classId)}|${localDay(r.reconDate)}`, r);
  console.log(`recon rows indexed: ${reconBy.size}`);

  // ---- A) the 24 already deleted, from the backup -------------------------
  const backup = JSON.parse(
    readFileSync("c:/pHero/Hobby/scd/scd-hub/server/scripts/backups/hw-declared-purge-scdhub_prod.json", "utf8"),
  ) as any[];
  console.log(`\n===== A) the ${backup.length} deleted items — real recon state =====`);
  let frozen = 0;
  for (const it of backup) {
    const key = `${String(it.classId)}|${localDay(it.dateGiven)}`;
    const r = reconBy.get(key);
    const state = r?.reconState ?? "none";
    if (state === "reconciled") {
      frozen += 1;
      console.log(`   FROZEN-DAY  ${it.hwId} ${localDay(it.dateGiven)} reconState=${state} autoIssued=${r.autoIssued}`);
    }
  }
  console.log(`   => deleted from a RECONCILED (frozen) day: ${frozen} of ${backup.length}`);
  console.log(`   => deleted from an unreconciled day:       ${backup.length - frozen}`);

  // ---- B) the 5 issued items proposed for deletion -------------------------
  console.log(`\n===== B) the 5 issued items — real recon state =====`);
  const items = await db.collection("homeworkitems").find({ hwId: { $in: TARGET_HWIDS } }).toArray();
  for (const it of items) {
    const key = `${String(it.classId)}|${localDay(it.dateGiven)}`;
    const r = reconBy.get(key);
    const trimHit = (r?.trimLog ?? []).filter((t: any) => String(t.trimHw) === String(it._id)).length;
    console.log(
      `   ${it.hwId.padEnd(18)} ${localDay(it.dateGiven)} recon=${r?.reconState ?? "NONE"} ` +
        `dayTotal=${r?.dayTotal ?? "-"} autoIssued=${r?.autoIssued ?? "-"} trimLogRowsPointingHere=${trimHit}`,
    );
  }

  await c.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
