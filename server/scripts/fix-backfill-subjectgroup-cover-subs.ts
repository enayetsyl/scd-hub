// Backfill the RoutineSubstitution rows that approved SUBJECTGROUP (Quran/Arabic) leave
// covers never got, because CoverService wrote the substitution inside its section-only
// branch (owner report 2026-08-03; fixed in the same change as this script).
//
// Without the substitution the covering teacher is invisible to every routine-based
// consumer: the class-note report keeps naming the ABSENT teacher, and publishClassNote
// refuses the cover outright ("Only the slot's teacher (or cover) may publish its class
// note"), because its gate reads RoutineSubstitution.
//
// SCOPE: today onward only. Backfilling history would rewrite who was recorded as
// owing/posting a class note on days already reported and chased — that is a different
// decision and is deliberately not taken here.
//
// Read-only by default; --apply to write. Idempotent: it only creates a row where none
// exists for (routineSlotId, date, coverTeacherId).
import { readFileSync, writeFileSync } from "fs";
import { MongoClient, ObjectId } from "mongodb";

const uri = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8").match(/^MONGODB_URI=(.+)$/m)![1].trim();
const APPLY = process.argv.includes("--apply");
const FROM = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? "2026-08-03";
const BACKUP = `c:/pHero/Hobby/scd/scd-hub/server/scripts/backups/backfilled-subjectgroup-cover-subs-scdhub_prod.json`;
const id = (v: unknown) => (v ? String(v) : "");

async function main() {
  const c = new MongoClient(uri);
  await c.connect();
  const db = c.db("scdhub_prod");
  console.log(`default db = ${c.db().databaseName}  (scdhub_local is NOT prod)`);
  console.log(`TARGET db  = ${db.databaseName}   from dateKey >= ${FROM}`);
  console.log(`mode       = ${APPLY ? "APPLY (will write)" : "READ-ONLY (dry run)"}\n`);

  const users = await db.collection("users").find({}).project({ name: 1 }).toArray();
  const uName = new Map(users.map((u: any) => [id(u._id), u.name]));
  const groups = await db.collection("subjectgroups").find({}).toArray();
  const gName = new Map(groups.map((g: any) => [id(g._id), g.code]));

  const covers = await db
    .collection("staffcoverslots")
    .find({ dateKey: { $gte: FROM }, status: "approved", finalCoverTeacherUserId: { $ne: null } })
    .sort({ dateKey: 1, periodNumber: 1 })
    .toArray();
  console.log(`approved covers with a named teacher from ${FROM}: ${covers.length}`);

  const missing: any[] = [];
  for (const cs of covers as any[]) {
    if (!cs.routineSlotId) {
      console.log(`  !! ${cs.dateKey} P${cs.periodNumber} has no routineSlotId — skipped`);
      continue;
    }
    const d0 = new Date(`${cs.dateKey}T00:00:00.000Z`);
    const d1 = new Date(`${cs.dateKey}T23:59:59.999Z`);
    const existing = await db.collection("routinesubstitutions").findOne({
      slotId: cs.routineSlotId,
      coverTeacherId: cs.finalCoverTeacherUserId,
      date: { $gte: d0, $lte: d1 },
    });
    if (existing) continue;
    missing.push(cs);
    console.log(
      `  MISSING  ${cs.dateKey} P${cs.periodNumber}  ${cs.groupType}` +
        `  absent=${uName.get(id(cs.absentTeacherUserId))}  cover=${uName.get(id(cs.finalCoverTeacherUserId))}` +
        `  group=${cs.groupType === "subjectgroup" ? gName.get(id(cs.subjectGroupId)) : id(cs.sectionId)}`,
    );
  }

  console.log(`\n  substitutions to create: ${missing.length}`);
  if (missing.length === 0) {
    await c.close();
    return;
  }
  writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), from: FROM, coverSlots: missing }, null, 2), "utf8");
  console.log(`  source cover slots dumped -> ${BACKUP}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply.`);
    await c.close();
    return;
  }

  for (const cs of missing) {
    // Mirrors the (now fixed) CoverService write: proxyGrantId stays null for a
    // subjectgroup — recorded and notified, no scope granted.
    const doc = {
      slotId: cs.routineSlotId as ObjectId,
      date: new Date(`${cs.dateKey}T00:00:00.000Z`),
      coverTeacherId: cs.finalCoverTeacherUserId as ObjectId,
      absentTeacherId: cs.absentTeacherUserId ?? null,
      proxyGrantId: cs.proxyGrantId ?? null,
      active: true,
      createdBy: cs.absentTeacherUserId as ObjectId,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    };
    await db.collection("routinesubstitutions").insertOne(doc as never);
    console.log(`  created  ${cs.dateKey} P${cs.periodNumber}  cover=${uName.get(id(cs.finalCoverTeacherUserId))}`);
  }

  // Read back: no approved cover from FROM onward should still be missing.
  let stillMissing = 0;
  for (const cs of covers as any[]) {
    if (!cs.routineSlotId) continue;
    const d0 = new Date(`${cs.dateKey}T00:00:00.000Z`);
    const d1 = new Date(`${cs.dateKey}T23:59:59.999Z`);
    const ex = await db.collection("routinesubstitutions").findOne({
      slotId: cs.routineSlotId,
      coverTeacherId: cs.finalCoverTeacherUserId,
      date: { $gte: d0, $lte: d1 },
    });
    if (!ex) stillMissing++;
  }
  console.log(`\n  READ-BACK: approved covers still without a substitution = ${stillMissing} (expect 0)`);

  await c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
