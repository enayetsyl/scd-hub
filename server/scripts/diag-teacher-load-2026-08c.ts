// READ-ONLY pass 3: correct section labels + section sizes, the general-track demand
// per section, and the July cover picture using the real field names
// (absentTeacherUserId / proposedCoverTeacherId / finalCoverTeacherUserId).
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

  const [classes, sections, groups, users, students, slots] = await Promise.all([
    db.collection("classes").find({}).toArray(),
    db.collection("sections").find({}).toArray(),
    db.collection("subjectgroups").find({}).toArray(),
    db.collection("users").find({}).toArray(),
    db.collection("students").find({}).toArray(),
    db.collection("routineslots").find({ active: true }).toArray(),
  ]);

  console.log(`\n--- RAW section ---\n${JSON.stringify(sections[0], null, 2)}`);
  console.log(`--- RAW class ---\n${JSON.stringify(classes[0], null, 2)}`);
  console.log(`--- RAW student (name fields blanked) ---\n${JSON.stringify({ ...(students[0] as any), name: "***", nameBn: "***" }, null, 2)}`);

  const cLabel = new Map(classes.map((c: any) => [id(c._id), `${c.nameBn ?? c.name}(L${c.level})`]));
  const sLabel = new Map(
    sections.map((s: any) => [id(s._id), `${cLabel.get(id(s.classId)) ?? "?"}/${s.code ?? s.nameBn ?? s.name}`]),
  );
  const gLabel = new Map((groups as any[]).map((g) => [id(g._id), `${g.code}[${g.track}]`]));
  const uName = new Map(users.map((u: any) => [id(u._id), u.name]));
  const where = (s: any) =>
    s.groupType === "section" ? sLabel.get(id(s.groupId)) ?? "?" : gLabel.get(id(s.groupId)) ?? "?";

  console.log("\n=== SECTION SIZES (active students) ===");
  const bySec = new Map<string, number>();
  for (const st of students as any[]) {
    if (st.active === false) continue;
    const k = sLabel.get(id(st.sectionId)) ?? `(no section: ${id(st.sectionId)})`;
    bySec.set(k, (bySec.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...bySec.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}\t${v}`);

  console.log("\n=== GENERAL-TRACK DEMAND PER SECTION (periods/week, subject: teacher) ===");
  const perSec = new Map<string, Map<string, Map<string, number>>>(); // section -> subject -> teacher -> n
  for (const s of slots as any[]) {
    if (s.isBreak) continue;
    const sec = where(s);
    if (!perSec.has(sec)) perSec.set(sec, new Map());
    const bySubj = perSec.get(sec)!;
    if (!bySubj.has(s.subject)) bySubj.set(s.subject, new Map());
    const m = bySubj.get(s.subject)!;
    const t = uName.get(id(s.teacherId)) ?? "(none)";
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  for (const [sec, bySubj] of [...perSec.entries()].sort()) {
    const tot = [...bySubj.values()].reduce((a, m) => a + [...m.values()].reduce((x, y) => x + y, 0), 0);
    console.log(`\n  ${sec}  (${tot} periods/week, students=${bySec.get(sec) ?? "-"})`);
    for (const [subj, m] of [...bySubj.entries()].sort())
      console.log(`      ${subj.padEnd(8)} ${[...m.entries()].map(([n, c]) => `${n}:${c}`).join(", ")}`);
  }

  console.log("\n=== HAMIDA / departing-teacher slots, resolved ===");
  for (const name of ["Hamida Akter", "Zarir Fazlullah"]) {
    const uid = [...uName.entries()].find(([, n]) => n === name)?.[0];
    const mine = (slots as any[]).filter((s) => id(s.teacherId) === uid && !s.isBreak);
    console.log(`\n  --- ${name}: ${mine.length}/wk ---`);
    for (const s of mine.sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek) || a.periodNumber - b.periodNumber))
      console.log(`      ${s.dayOfWeek} P${s.periodNumber}\t${s.subject}\t${where(s)}`);
  }

  // ---- cover picture, real fields -----------------------------------------
  const covers = await db.collection("staffcoverslots").find({}).sort({ dateKey: 1, periodNumber: 1 }).toArray();
  console.log(`\n=== COVER SLOTS (${covers.length}) ===`);
  const absentTally = new Map<string, number>();
  const coverTally = new Map<string, number>();
  const statusByAbsent = new Map<string, Map<string, number>>();
  for (const c of covers as any[]) {
    const abs = uName.get(id(c.absentTeacherUserId)) ?? "?";
    const cov = uName.get(id(c.finalCoverTeacherUserId)) ?? "(unfilled)";
    absentTally.set(abs, (absentTally.get(abs) ?? 0) + 1);
    if (c.status !== "needs_cover") coverTally.set(cov, (coverTally.get(cov) ?? 0) + 1);
    if (!statusByAbsent.has(abs)) statusByAbsent.set(abs, new Map());
    const m = statusByAbsent.get(abs)!;
    m.set(c.status, (m.get(c.status) ?? 0) + 1);
    console.log(
      `  ${c.dateKey} P${c.periodNumber}\tabsent=${abs.padEnd(22)}\tproposed=${(uName.get(id(c.proposedCoverTeacherId)) ?? "-").padEnd(22)}\tfinal=${cov.padEnd(22)}\t${c.status}\t${c.groupType === "section" ? sLabel.get(id(c.sectionId)) ?? "?" : gLabel.get(id(c.subjectGroupId)) ?? "?"}`,
    );
  }
  console.log("\n  -- periods needing cover, by absent teacher --");
  for (const [k, v] of [...absentTally.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`     ${k.padEnd(24)} ${v}\t${JSON.stringify(Object.fromEntries(statusByAbsent.get(k)!))}`);
  console.log("\n  -- cover periods actually taken (proposed/approved), by teacher --");
  for (const [k, v] of [...coverTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${k.padEnd(24)} ${v}`);

  // substitutions resolved through slotId
  const subs = await db.collection("routinesubstitutions").find({}).toArray();
  const slotById = new Map((await db.collection("routineslots").find({}).toArray()).map((s: any) => [id(s._id), s]));
  console.log(`\n=== SUBSTITUTIONS RESOLVED (${subs.length}) ===`);
  const subTally = new Map<string, number>();
  for (const s of subs as any[]) {
    const sl: any = slotById.get(id(s.slotId));
    const cov = uName.get(id(s.coverTeacherId)) ?? "?";
    subTally.set(cov, (subTally.get(cov) ?? 0) + 1);
    console.log(
      `  ${new Date(s.date).toISOString().slice(0, 10)} ${sl ? `${sl.dayOfWeek} P${sl.periodNumber} ${sl.subject} ${where(sl)}` : "?"}\tabsent=${uName.get(id(s.absentTeacherId))}\tcover=${cov}\tactive=${s.active}`,
    );
  }
  console.log(`  -- substitution count by cover teacher: ${JSON.stringify(Object.fromEntries([...subTally.entries()].sort((a, b) => b[1] - a[1])))}`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
