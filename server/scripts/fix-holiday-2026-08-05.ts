// Record 2026-08-05 as a government holiday in scdhub_prod (owner, 2026-08-04).
//
// WHY A SCRIPT: `createHolidayException` exists server-side (routine:manage) but is
// wired into NO app screen — there is no way to add a holiday from the UI, and prod
// currently holds ZERO holiday rows. The screen is being built separately; this gets
// tomorrow right in the meantime.
//
// WHAT IT CHANGES: HolidayException OVERRIDES the day type (D-#50) — on that date there
// is no routine, attendance is not expected, and homework/assignment expectations for
// the day fall away. Nothing is deleted; removing the row restores the normal day.
//
// Read-only by default; --apply to write. Idempotent: refuses to add a second row for
// the same date.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const uri = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8").match(/^MONGODB_URI=(.+)$/m)![1].trim();
const APPLY = process.argv.includes("--apply");
const DATE = "2026-08-05";
const TYPE = "govt";
const NAME_BN = "সরকারি ছুটি";

async function main() {
  const c = new MongoClient(uri);
  await c.connect();
  console.log(`default db = ${c.db().databaseName}  (scdhub_local is NOT prod)`);
  const db = c.db("scdhub_prod");
  console.log(`TARGET db  = ${db.databaseName}`);
  console.log(`mode       = ${APPLY ? "APPLY (will write)" : "READ-ONLY (dry run)"}\n`);

  const col = db.collection("holidayexceptions");
  // Day bounds in Dhaka (UTC+6): the whole local day, stored as instants.
  const from = new Date(`${DATE}T00:00:00.000+06:00`);
  const to = new Date(`${DATE}T23:59:59.999+06:00`);

  const clash = await col.findOne({ fromDate: { $lte: to }, toDate: { $gte: from } });
  if (clash) {
    console.log(`already covered by: ${clash.nameBn} (${new Date(clash.fromDate).toISOString()} → ${new Date(clash.toDate).toISOString()}) — nothing to do.`);
    await c.close();
    return;
  }

  const doc = {
    fromDate: from,
    toDate: to,
    type: TYPE,
    nameBn: NAME_BN,
    note: "Added 2026-08-04 at the owner's request; no holiday UI exists yet.",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    __v: 0,
  };
  console.log(`  would insert: ${DATE}  type=${TYPE}  nameBn=${NAME_BN}`);
  console.log(`    fromDate=${from.toISOString()}\n    toDate  =${to.toISOString()}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.`);
    await c.close();
    return;
  }

  await col.insertOne(doc as never);
  const after = await col.find({}).sort({ fromDate: 1 }).toArray();
  console.log(`\n  READ-BACK: ${after.length} holiday row(s) now in prod`);
  for (const h of after as any[])
    console.log(`    ${new Date(h.fromDate).toISOString()} → ${new Date(h.toDate).toISOString()}  ${h.type}  ${h.nameBn}  active=${h.active}`);

  await c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
