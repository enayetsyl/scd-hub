// READ-ONLY pass 2: raw shapes for the collections whose field names pass 1 guessed
// wrong (subject groups, cover slots, substitutions, class-teacher assignments), plus
// section sizes, the leaving teachers' exact slots, and July cover fill-rate.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const uri = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();
const DB = process.argv[2] ?? "scdhub_prod";
const id = (v: unknown) => (v ? String(v) : "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB);
  console.log(`db = ${db.databaseName}`);

  for (const c of ["subjectgroups", "staffcoverslots", "routinesubstitutions", "classteacherassignments", "subjectgroupmemberships"]) {
    const one = await db.collection(c).findOne({});
    console.log(`\n--- RAW ${c} ---\n${JSON.stringify(one, null, 2)}`);
  }

  const [classes, sections, groups, users, staff, students, memberships] = await Promise.all([
    db.collection("classes").find({}).toArray(),
    db.collection("sections").find({}).toArray(),
    db.collection("subjectgroups").find({}).toArray(),
    db.collection("users").find({}).toArray(),
    db.collection("staffprofiles").find({}).toArray(),
    db.collection("students").find({}).toArray(),
    db.collection("subjectgroupmemberships").find({}).toArray(),
  ]);
  const cName = new Map(classes.map((c: any) => [id(c._id), c.name]));
  const sLabel = new Map(sections.map((s: any) => [id(s._id), `${cName.get(id(s.classId))}-${s.name}`]));
  const uName = new Map(users.map((u: any) => [id(u._id), u.name]));
  const spName = new Map(staff.map((s: any) => [id(s._id), s.name]));

  console.log("\n=== SECTION SIZES (active students) ===");
  const bySec = new Map<string, number>();
  for (const st of students as any[]) {
    if (st.active === false) continue;
    const k = sLabel.get(id(st.sectionId)) ?? id(st.sectionId) ?? "(none)";
    bySec.set(k, (bySec.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...bySec.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}\t${v}`);
  console.log(`  TOTAL active students = ${(students as any[]).filter((s) => s.active !== false).length}`);

  console.log("\n=== SUBJECT GROUPS (all fields) ===");
  for (const g of groups as any[]) {
    const n = memberships.filter((m: any) => id(m.subjectGroupId ?? m.groupId) === id(g._id) && m.active !== false).length;
    console.log(`  ${id(g._id)}\t${JSON.stringify({ ...g, _id: undefined })}\tmembers=${n}`);
  }

  const slots = await db.collection("routineslots").find({ active: true }).toArray();
  const gLabel = new Map(
    (groups as any[]).map((g) => [id(g._id), `${g.nameBn ?? g.label ?? g.code ?? "?"}[${g.track}]`]),
  );
  const where = (s: any) =>
    s.groupType === "section" ? sLabel.get(id(s.groupId)) ?? "?" : gLabel.get(id(s.groupId)) ?? "?";

  console.log("\n=== SLOT DETAIL for the teachers in play ===");
  const FOCUS = ["Hamida Akter", "Md Abdul Momin", "Md Abdul Kuddus", "Zarir Fazlullah", "Shah Mahfuj Ahmed"];
  for (const name of FOCUS) {
    const uid = [...uName.entries()].find(([, n]) => n === name)?.[0];
    const mine = (slots as any[]).filter((s) => id(s.teacherId) === uid && !s.isBreak);
    console.log(`\n  --- ${name}: ${mine.length} periods/week ---`);
    for (const s of mine.sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek) || a.periodNumber - b.periodNumber))
      console.log(`      ${s.dayOfWeek} P${s.periodNumber}\t${s.subject}\t${s.track}\t${where(s)}`);
  }

  console.log("\n=== SUBJECT x GROUP demand matrix (periods/week) + who teaches it ===");
  const demand = new Map<string, { n: number; who: Map<string, number> }>();
  for (const s of slots as any[]) {
    if (s.isBreak) continue;
    const k = `${s.subject}\t${where(s)}`;
    if (!demand.has(k)) demand.set(k, { n: 0, who: new Map() });
    const d = demand.get(k)!;
    d.n++;
    const t = uName.get(id(s.teacherId)) ?? "(none)";
    d.who.set(t, (d.who.get(t) ?? 0) + 1);
  }
  for (const [k, d] of [...demand.entries()].sort())
    console.log(`  ${k}\t${d.n}\t${[...d.who.entries()].map(([n, c]) => `${n}:${c}`).join(", ")}`);

  console.log("\n=== SUBJECT totals + teacher pool per subject ===");
  const bySubj = new Map<string, Map<string, number>>();
  for (const s of slots as any[]) {
    if (s.isBreak) continue;
    if (!bySubj.has(s.subject)) bySubj.set(s.subject, new Map());
    const m = bySubj.get(s.subject)!;
    const t = uName.get(id(s.teacherId)) ?? "(none)";
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  for (const [subj, m] of [...bySubj.entries()].sort((a, b) => {
    const sa = [...a[1].values()].reduce((x, y) => x + y, 0);
    const sb = [...b[1].values()].reduce((x, y) => x + y, 0);
    return sb - sa;
  })) {
    const total = [...m.values()].reduce((x, y) => x + y, 0);
    console.log(`  ${subj}\ttotal=${total}\tteachers=${m.size}\t${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}:${c}`).join(", ")}`);
  }

  // ---- July cover picture --------------------------------------------------
  const covers = await db.collection("staffcoverslots").find({}).toArray();
  console.log(`\n=== COVER SLOTS: ${covers.length} (raw status/date/assignee tallies) ===`);
  const st = new Map<string, number>();
  const byDate = new Map<string, number>();
  const byAbsent = new Map<string, number>();
  const byCover = new Map<string, number>();
  for (const c of covers as any[]) {
    st.set(c.status, (st.get(c.status) ?? 0) + 1);
    const dk = c.dateKey ?? c.date ?? "?";
    byDate.set(String(dk).slice(0, 10), (byDate.get(String(dk).slice(0, 10)) ?? 0) + 1);
    const abs =
      spName.get(id(c.absentStaffProfileId)) ??
      uName.get(id(c.absentTeacherId ?? c.teacherId)) ??
      "?";
    byAbsent.set(abs, (byAbsent.get(abs) ?? 0) + 1);
    const cov =
      uName.get(id(c.coverTeacherId ?? c.assignedTeacherId ?? c.substituteTeacherId)) ??
      spName.get(id(c.coverStaffProfileId ?? c.assignedStaffProfileId)) ??
      "(none)";
    byCover.set(cov, (byCover.get(cov) ?? 0) + 1);
  }
  console.log(`  by status: ${JSON.stringify(Object.fromEntries(st))}`);
  console.log(`  by date:   ${JSON.stringify(Object.fromEntries([...byDate.entries()].sort()))}`);
  console.log(`  absent:    ${JSON.stringify(Object.fromEntries(byAbsent))}`);
  console.log(`  cover:     ${JSON.stringify(Object.fromEntries(byCover))}`);

  const subs = await db.collection("routinesubstitutions").find({}).toArray();
  console.log(`\n=== SUBSTITUTIONS: ${subs.length} ===`);
  for (const s of subs as any[])
    console.log(
      `  ${JSON.stringify({
        date: s.dateKey ?? s.date,
        period: s.periodNumber,
        subject: s.subject,
        absent: uName.get(id(s.originalTeacherId ?? s.absentTeacherId)),
        cover: uName.get(id(s.substituteTeacherId ?? s.coverTeacherId)),
        status: s.status,
        reason: s.reason,
      })}`,
    );

  console.log("\n=== TEACHER ATTENDANCE (prod) ===");
  const att = await db.collection("teacherattendancedays").countDocuments();
  console.log(`  rows = ${att}`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
