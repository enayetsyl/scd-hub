// READ-ONLY: locate the Science record for Dayeef Elahi on 2026-07-30 that was
// mistakenly walked SUBMITTED → CHECKED → RETURNED, and report exactly what a revert
// would have to pop. Checks BOTH trackers (homework and assignment) — the owner's
// description fits either lifecycle. No writes.
import { readFileSync } from "fs";
import { MongoClient, ObjectId } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const uri = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();
const DB = process.argv[2] ?? "scdhub_prod";
const id = (v: unknown) => (v ? String(v) : "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB);
  console.log(`db = ${db.databaseName}`); // memory: always confirm the plane before acting

  // --- the student -----------------------------------------------------------
  const students = await db
    .collection("students")
    .find({ $or: [{ name: /dayeef|dayef|daye/i }, { nameBn: /দায়ীফ|দাঈফ|দায়েফ/ }] })
    .toArray();
  console.log(`\n=== STUDENT MATCHES: ${students.length} ===`);
  for (const s of students as any[])
    console.log(`  ${id(s._id)}  schoolId=${s.schoolId}  ${s.name} / ${s.nameBn}  class=${id(s.classId)} section=${id(s.sectionId)} active=${s.active}`);
  if (students.length === 0) {
    console.log("  (no name match — widening to all students would be the next step)");
    await client.close();
    return;
  }

  const users = await db.collection("users").find({}).project({ name: 1 }).toArray();
  const uName = new Map(users.map((u: any) => [id(u._id), u.name]));
  const day = (d: unknown) => (d ? new Date(d as Date).toISOString().replace("T", " ").slice(0, 16) : "-");

  for (const st of students as any[]) {
    const sid = st._id as ObjectId;
    console.log(`\n########## ${st.name} (${st.schoolId}) ##########`);

    // --- homework ------------------------------------------------------------
    const hwRecs = await db.collection("homeworkstudentrecords").find({ studentId: sid }).toArray();
    const hwItems = await db
      .collection("homeworkitems")
      .find({ _id: { $in: (hwRecs as any[]).map((r) => r.hwItemId) } })
      .toArray();
    const hwById = new Map((hwItems as any[]).map((i) => [id(i._id), i]));
    const hwHits = (hwRecs as any[]).filter((r) => {
      const it: any = hwById.get(id(r.hwItemId));
      if (!it) return false;
      const given = it.dateGiven ? new Date(it.dateGiven).toISOString().slice(0, 10) : "";
      return it.subject === "SCI" || given === "2026-07-30";
    });
    console.log(`\n=== HOMEWORK records (SCI or 2026-07-30): ${hwHits.length} of ${hwRecs.length} total ===`);
    for (const r of hwHits) {
      const it: any = hwById.get(id(r.hwItemId));
      console.log(
        `\n  recordId=${id(r._id)}  hwId=${r.hwId}  subject=${it?.subject}  dateGiven=${day(it?.dateGiven)}\n` +
          `    STATE=${r.state}  result=${r.result ?? "-"}  chaseCount=${r.chaseCount}  resubOf=${id(r.resubOf) || "-"}  answerFileId=${id(r.answerFileId) || "-"}`,
      );
      console.log(`    stateDates (${(r.stateDates ?? []).length}):`);
      for (const s of r.stateDates ?? [])
        console.log(`       ${String(s.state).padEnd(18)} ${day(s.at)}  by=${uName.get(id(s.by)) ?? id(s.by) ?? "(unstamped)"}`);
      const resubs = (hwRecs as any[]).filter((x) => id(x.resubOf) === id(r._id));
      console.log(`    spawned resubmissions: ${resubs.length}${resubs.map((x) => ` [${id(x._id)} state=${x.state}]`).join("")}`);
    }

    // --- assignment ----------------------------------------------------------
    const asRecs = await db.collection("assignmentstudentrecords").find({ studentId: sid }).toArray();
    const asItems = await db
      .collection("assignmentitems")
      .find({ _id: { $in: (asRecs as any[]).map((r) => r.itemId ?? r.assignmentItemId) } })
      .toArray();
    const asById = new Map((asItems as any[]).map((i) => [id(i._id), i]));
    console.log(`\n=== ASSIGNMENT records: ${asRecs.length} total ===`);
    for (const r of asRecs as any[]) {
      const it: any = asById.get(id(r.itemId ?? r.assignmentItemId));
      const given = it?.deliveryDate ?? it?.dateGiven ?? it?.examDate;
      const isHit = it?.subject === "SCI" || (given && new Date(given).toISOString().slice(0, 10) === "2026-07-30");
      if (!isHit) continue;
      console.log(
        `\n  recordId=${id(r._id)}  subject=${it?.subject}  date=${day(given)}\n` +
          `    STATE=${r.state}  result=${r.result ?? "-"}  chaseCount=${r.chaseCount ?? "-"}`,
      );
      console.log(`    stateDates (${(r.stateDates ?? []).length}):`);
      for (const s of r.stateDates ?? [])
        console.log(`       ${String(s.state).padEnd(18)} ${day(s.at)}  by=${uName.get(id(s.by)) ?? id(s.by) ?? "(unstamped)"}`);
    }
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
