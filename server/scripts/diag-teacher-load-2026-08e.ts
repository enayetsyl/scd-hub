// READ-ONLY pass 5 — the full weekly grid (day x period -> group -> subject/teacher),
// so the post-Hamida / Jerin-returns allocation can be checked slot by slot, plus a
// per-period free-teacher list restricted to the people who are actually available.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const uri = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();
const DB = process.argv[2] ?? "scdhub_prod";
const id = (v: unknown) => (v ? String(v) : "");
const DAYS = ["SUN", "MON", "TUE", "WED", "THU"];
const PERIODS = [1, 2, 3, 5, 6, 7, 8];

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB);
  console.log(`db = ${db.databaseName}`);

  const [classes, sections, groups, users, slots] = await Promise.all([
    db.collection("classes").find({}).toArray(),
    db.collection("sections").find({}).toArray(),
    db.collection("subjectgroups").find({}).toArray(),
    db.collection("users").find({}).toArray(),
    db.collection("routineslots").find({ active: true }).toArray(),
  ]);
  const cLabel = new Map(classes.map((c: any) => [id(c._id), `${c.nameBn}`]));
  const sLabel = new Map(sections.map((s: any) => [id(s._id), `${cLabel.get(id(s.classId)) ?? "?"}`]));
  const gLabel = new Map((groups as any[]).map((g) => [id(g._id), g.code.replace(/_MIXED|_BOYS|_GIRLS/, "")]));
  const uName = new Map(users.map((u: any) => [id(u._id), u.name]));
  const where = (s: any) =>
    s.groupType === "section" ? sLabel.get(id(s.groupId)) ?? "?" : gLabel.get(id(s.groupId)) ?? "?";
  const short = (n: string) => n.split(" ").slice(-1)[0];

  const live = (slots as any[]).filter((s) => !s.isBreak);

  console.log("\n=== WEEKLY GRID (group | subject | teacher-surname) ===");
  for (const d of DAYS) {
    console.log(`\n--- ${d} ---`);
    for (const p of PERIODS) {
      const here = live.filter((s) => s.dayOfWeek === d && s.periodNumber === p);
      console.log(
        `  P${p}  ` +
          here
            .sort((a, b) => where(a).localeCompare(where(b)))
            .map((s) => `${where(s)}/${s.subject}/${short(uName.get(id(s.teacherId)) ?? "?")}`)
            .join("   "),
      );
    }
  }

  console.log("\n=== PER-PERIOD: who is teaching vs free (14 current teaching staff) ===");
  const all = [...new Set(live.map((s) => id(s.teacherId)))];
  for (const d of DAYS) {
    for (const p of PERIODS) {
      const busy = new Set(live.filter((s) => s.dayOfWeek === d && s.periodNumber === p).map((s) => id(s.teacherId)));
      const free = all.filter((t) => !busy.has(t)).map((t) => short(uName.get(t) ?? "?"));
      console.log(`  ${d} P${p}\tbusy=${busy.size}\tfree(${free.length}): ${free.join(", ")}`);
    }
  }

  console.log("\n=== TRACK LOAD PER PERIOD (is the Arabic P3 wall real?) ===");
  for (const p of PERIODS) {
    const here = live.filter((s) => s.periodNumber === p);
    const t: Record<string, number> = {};
    for (const s of here) t[s.track] = (t[s.track] ?? 0) + 1;
    const teachers = new Set(here.map((s) => short(uName.get(id(s.teacherId)) ?? "?")));
    console.log(`  P${p}\tper-week=${here.length}\t${JSON.stringify(t)}\tdistinct teachers=${teachers.size} [${[...teachers].join(", ")}]`);
  }

  console.log("\n=== ARABIC + QURAN slot inventory (who, which group, which period) ===");
  for (const track of ["quran", "arabic"]) {
    console.log(`\n  -- ${track} --`);
    const agg = new Map<string, number>();
    for (const s of live.filter((x) => x.track === track || x.subject === track.toUpperCase())) {
      const k = `${where(s)}\tP${s.periodNumber}\t${uName.get(id(s.teacherId))}`;
      agg.set(k, (agg.get(k) ?? 0) + 1);
    }
    for (const [k, v] of [...agg.entries()].sort()) console.log(`     ${k}\t${v}/wk`);
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
