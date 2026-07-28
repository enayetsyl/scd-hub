// READ-ONLY: which homework items never got the teacher's FIRST lifecycle input
// (collection / "mark submitted")? Grouped by subject, class and declaring teacher.
//
// Lifecycle (shared/vocab LIFECYCLE_STATES):
//   GIVEN -> (auto sweep) DUE -> CHASE            <- no teacher input yet
//   SUBMITTED | ABSENT_REDELIVER                   <- the FIRST teacher input
//   CHECKED -> RESUBMIT / RETURNED                 <- later steps
// So an item is "never marked" when NOT ONE of its student records ever carries a
// SUBMITTED / ABSENT_REDELIVER (or later) stamp in stateDates.
import { readFileSync } from "fs";
import { MongoClient, ObjectId } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const m = env.match(/^MONGODB_URI=(.+)$/m);
if (m) process.env.MONGODB_URI = m[1].trim();

const TEACHER_TOUCH = new Set(["SUBMITTED", "ABSENT_REDELIVER", "CHECKED", "RESUBMIT", "RETURNED"]);

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db("scdhub_prod"); // explicit: repo .env defaults to the local test copy
  console.log("DB =", db.databaseName);

  const users = await db.collection("users").find({}).toArray();
  const userName = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  const classes = await db.collection("classes").find({}).toArray();
  const className = new Map(
    classes.map((c) => [c._id.toString(), (c.nameBn ?? c.name ?? String(c._id)) as string]),
  );
  const sections = await db.collection("sections").find({}).toArray();
  const sectionName = new Map(
    sections.map((s) => [s._id.toString(), (s.nameBn ?? s.name ?? String(s._id)) as string]),
  );

  const items = await db.collection("homeworkitems").find({}).sort({ dateGiven: 1 }).toArray();
  console.log(`homework items (all time) = ${items.length}`);

  // Pull every record once, bucket by item.
  const recs = await db.collection("homeworkstudentrecords").find({}).toArray();
  const byItem = new Map<string, typeof recs>();
  for (const r of recs) {
    const k = String(r.hwItemId);
    if (!byItem.has(k)) byItem.set(k, [] as typeof recs);
    byItem.get(k)!.push(r);
  }
  console.log(`homework student records = ${recs.length}`);

  type Row = {
    hwId: string;
    date: string;
    subject: string;
    cls: string;
    section: string;
    teacher: string;
    status: string;
    records: number;
    states: string;
    ageDays: number;
  };
  const rows: Row[] = [];
  const today = new Date("2026-07-28T00:00:00.000Z").getTime();

  for (const it of items) {
    const rs = byItem.get(String(it._id)) ?? [];
    const touched = rs.some((r) =>
      ((r.stateDates ?? []) as Array<{ state: string }>).some((s) => TEACHER_TOUCH.has(s.state)),
    );
    if (touched) continue;

    const byState: Record<string, number> = {};
    for (const r of rs) byState[r.state] = (byState[r.state] ?? 0) + 1;

    rows.push({
      hwId: it.hwId,
      date: new Date(it.dateGiven).toISOString().slice(0, 10),
      subject: it.subject,
      cls: className.get(String(it.classId)) ?? String(it.classId),
      section: sectionName.get(String(it.sectionId)) ?? "",
      teacher: userName.get(String(it.declaredBy)) ?? String(it.declaredBy),
      status: it.status,
      records: rs.length,
      states: rs.length ? JSON.stringify(byState) : "(never issued)",
      ageDays: Math.round((today - new Date(it.dateGiven).getTime()) / 86_400_000),
    });
  }

  console.log(`\n########## NEVER GOT THE FIRST TEACHER INPUT: ${rows.length} items ##########`);

  // Given today = not actionable yet (collection happens the next school day).
  const fresh = rows.filter((r) => r.ageDays <= 0);
  const stuck = rows.filter((r) => r.ageDays > 0);
  console.log(`  stuck (given before today) = ${stuck.length}   fresh (given today) = ${fresh.length}`);

  // --- by teacher (stuck only) ---
  const byTeacher = new Map<string, Row[]>();
  for (const r of stuck) {
    if (!byTeacher.has(r.teacher)) byTeacher.set(r.teacher, []);
    byTeacher.get(r.teacher)!.push(r);
  }
  console.log("\n===== BY TEACHER (declaredBy) — STUCK ONLY =====");
  for (const [t, list] of [...byTeacher.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const nv = list.filter((r) => r.records === 0).length;
    console.log(`\n--- ${t}: ${list.length} items  (${nv} never issued / ${list.length - nv} issued-but-uncollected) ---`);
    for (const r of list.sort((a, b) => a.date.localeCompare(b.date))) {
      console.log(
        `   ${r.date} (${r.ageDays}d)  ${r.cls}/${r.section}  ${r.subject.padEnd(6)} ${r.hwId.padEnd(22)} status=${r.status} recs=${r.records} ${r.states}`,
      );
    }
  }

  console.log("\n===== FRESH (given today — no action due yet) =====");
  for (const r of fresh) {
    console.log(`   ${r.date}  ${r.cls}/${r.section}  ${r.subject.padEnd(6)} ${r.hwId.padEnd(22)} ${r.teacher}`);
  }

  // Reference: how many items DID get collected, for a hit-rate.
  console.log(`\n===== TOTALS: ${items.length} items, ${rows.length} never collected, ${items.length - rows.length} collected =====`);

  // --- by subject ---
  const bySubject = new Map<string, number>();
  for (const r of rows) bySubject.set(r.subject, (bySubject.get(r.subject) ?? 0) + 1);
  console.log("\n===== BY SUBJECT =====");
  for (const [s, n] of [...bySubject.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${s}: ${n}`);

  // --- by class ---
  const byClass = new Map<string, number>();
  for (const r of rows) byClass.set(`${r.cls}/${r.section}`, (byClass.get(`${r.cls}/${r.section}`) ?? 0) + 1);
  console.log("\n===== BY CLASS/SECTION =====");
  for (const [c, n] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${c}: ${n}`);

  // --- by month, to see if this is a legacy tail or ongoing ---
  const byMonth = new Map<string, number>();
  for (const r of rows) byMonth.set(r.date.slice(0, 7), (byMonth.get(r.date.slice(0, 7)) ?? 0) + 1);
  console.log("\n===== BY MONTH GIVEN =====");
  for (const [mo, n] of [...byMonth.entries()].sort()) console.log(`   ${mo}: ${n}`);

  // --- never issued at all (declared, no Layer-B records) ---
  const neverIssued = rows.filter((r) => r.records === 0);
  console.log(`\n===== SUB-BUCKET: declared but NEVER ISSUED (no student records): ${neverIssued.length} =====`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
