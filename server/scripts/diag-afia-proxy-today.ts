// READ-ONLY: why the class-note report still names Afia Loskor on a day she is on
// approved leave with an approved cover. Compares the two cover stores —
// StaffCoverSlot (written by the HR leave flow) vs RoutineSubstitution (written by the
// routine module's direct assign) — for today. No writes.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const uri = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8").match(/^MONGODB_URI=(.+)$/m)![1].trim();
const DATEKEY = process.argv[2] ?? "2026-08-03";
const id = (v: unknown) => (v ? String(v) : "");

async function main() {
  const c = new MongoClient(uri);
  await c.connect();
  const db = c.db("scdhub_prod");
  console.log(`db = ${db.databaseName}   date = ${DATEKEY}`);

  const users = await db.collection("users").find({}).project({ name: 1 }).toArray();
  const uName = new Map(users.map((u: any) => [id(u._id), u.name]));
  const staff = await db.collection("staffprofiles").find({}).project({ name: 1 }).toArray();
  const sName = new Map(staff.map((s: any) => [id(s._id), s.name]));
  const groups = await db.collection("subjectgroups").find({}).toArray();
  const gName = new Map(groups.map((g: any) => [id(g._id), `${g.code}`]));

  console.log("\n=== STAFF LEAVE covering this date ===");
  const leaves = await db
    .collection("staffleaveapplications")
    .find({ fromKey: { $lte: DATEKEY }, toKey: { $gte: DATEKEY } })
    .toArray();
  for (const l of leaves as any[])
    console.log(`  ${sName.get(id(l.staffProfileId)) ?? "?"}  ${l.fromKey}..${l.toKey}  ${l.leaveType}  status=${l.status}  id=${id(l._id)}`);

  console.log("\n=== StaffCoverSlot for this date (the HR leave flow's cover) ===");
  const covers = await db.collection("staffcoverslots").find({ dateKey: DATEKEY }).sort({ periodNumber: 1 }).toArray();
  for (const cs of covers as any[])
    console.log(
      `  P${cs.periodNumber}  absent=${(uName.get(id(cs.absentTeacherUserId)) ?? "?").padEnd(20)}` +
        `  final=${(uName.get(id(cs.finalCoverTeacherUserId)) ?? "(none)").padEnd(20)}` +
        `  status=${cs.status}  group=${cs.groupType === "subjectgroup" ? gName.get(id(cs.subjectGroupId)) : id(cs.sectionId)}` +
        `  routineSlotId=${id(cs.routineSlotId)}`,
    );

  console.log("\n=== RoutineSubstitution for this date (what the report reads) ===");
  const d0 = new Date(`${DATEKEY}T00:00:00.000Z`);
  const d1 = new Date(`${DATEKEY}T23:59:59.999Z`);
  const subs = await db
    .collection("routinesubstitutions")
    .find({ date: { $gte: d0, $lte: d1 } })
    .toArray();
  if (subs.length === 0) console.log("  (none)");
  for (const s of subs as any[])
    console.log(
      `  slotId=${id(s.slotId)}  absent=${uName.get(id(s.absentTeacherId))}  cover=${uName.get(id(s.coverTeacherId))}  active=${s.active}`,
    );

  console.log("\n=== VERDICT ===");
  const approvedCovers = (covers as any[]).filter((c) => c.status === "approved" && c.finalCoverTeacherUserId);
  const subSlotIds = new Set((subs as any[]).map((s) => id(s.slotId)));
  const missing = approvedCovers.filter((c) => !subSlotIds.has(id(c.routineSlotId)));
  console.log(`  approved StaffCoverSlots with a named cover : ${approvedCovers.length}`);
  console.log(`  RoutineSubstitution rows for the date        : ${subs.length}`);
  console.log(`  approved covers with NO matching substitution: ${missing.length}`);
  for (const m of missing as any[])
    console.log(
      `     -> P${m.periodNumber} ${uName.get(id(m.absentTeacherUserId))} covered by ${uName.get(id(m.finalCoverTeacherUserId))} ` +
        `(${m.groupType === "subjectgroup" ? gName.get(id(m.subjectGroupId)) : id(m.sectionId)}) — invisible to classNoteSubmissionReport`,
    );

  await c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
