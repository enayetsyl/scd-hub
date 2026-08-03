// READ-ONLY pass 4 — the numbers the recruitment call actually turns on:
//  (a) per-teacher occupancy split by the morning quran/arabic window (P1-P3) vs the
//      general afternoon (P5-P8), against the 15/20 structural caps;
//  (b) for every slot a departing teacher holds, who is genuinely FREE at that
//      (day, period) and already teaches that subject — i.e. can it be absorbed;
//  (c) deduped July cover fill-rate (duplicate leave applications double-fan-out);
//  (d) approved leave days per teacher for July 2026.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const uri = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();
const DB = process.argv[2] ?? "scdhub_prod";
const id = (v: unknown) => (v ? String(v) : "");
const DAYS = ["SUN", "MON", "TUE", "WED", "THU"];

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB);
  console.log(`db = ${db.databaseName}`);

  const [classes, sections, groups, users, staff, slots] = await Promise.all([
    db.collection("classes").find({}).toArray(),
    db.collection("sections").find({}).toArray(),
    db.collection("subjectgroups").find({}).toArray(),
    db.collection("users").find({}).toArray(),
    db.collection("staffprofiles").find({}).toArray(),
    db.collection("routineslots").find({ active: true }).toArray(),
  ]);
  const cLabel = new Map(classes.map((c: any) => [id(c._id), `${c.nameBn}(L${c.level})`]));
  const sLabel = new Map(sections.map((s: any) => [id(s._id), `${cLabel.get(id(s.classId)) ?? "?"}/${s.code}`]));
  const gLabel = new Map((groups as any[]).map((g) => [id(g._id), `${g.code}`]));
  const uName = new Map(users.map((u: any) => [id(u._id), u.name]));
  const spName = new Map(staff.map((s: any) => [id(s._id), s.name]));
  const where = (s: any) =>
    s.groupType === "section" ? sLabel.get(id(s.groupId)) ?? "?" : gLabel.get(id(s.groupId)) ?? "?";

  const live = (slots as any[]).filter((s) => !s.isBreak);

  // (a) occupancy by window ---------------------------------------------------
  console.log("\n=== OCCUPANCY BY WINDOW (morning P1-P3 cap=15/wk, afternoon P5-P8 cap=20/wk) ===");
  console.log("  teacher                  morning  free-am  afternoon  free-pm  total  subjects");
  const byT = new Map<string, any[]>();
  for (const s of live) {
    const k = id(s.teacherId);
    if (!byT.has(k)) byT.set(k, []);
    byT.get(k)!.push(s);
  }
  const rows = [...byT.entries()].map(([tid, ss]) => {
    const am = ss.filter((s) => s.periodNumber <= 3).length;
    const pm = ss.filter((s) => s.periodNumber >= 5).length;
    const subj = [...new Set(ss.map((s) => s.subject))].join("/");
    return { tid, name: uName.get(tid) ?? tid, am, pm, n: ss.length, subj };
  });
  for (const r of rows.sort((a, b) => b.n - a.n))
    console.log(
      `  ${r.name.padEnd(24)} ${String(r.am).padStart(5)}   ${String(15 - r.am).padStart(5)}   ` +
        `${String(r.pm).padStart(7)}  ${String(20 - r.pm).padStart(6)}  ${String(r.n).padStart(5)}  ${r.subj}`,
    );
  const amTot = live.filter((s) => s.periodNumber <= 3).length;
  console.log(`  -- demand: morning=${amTot}  afternoon=${live.length - amTot}  total=${live.length}`);

  // (b) can a departing teacher's slots be absorbed? --------------------------
  const busy = new Map<string, Set<string>>(); // "DAY P#" -> teacher ids
  for (const s of live) {
    const k = `${s.dayOfWeek} P${s.periodNumber}`;
    if (!busy.has(k)) busy.set(k, new Set());
    busy.get(k)!.add(id(s.teacherId));
  }
  const teaches = new Map<string, Set<string>>(); // teacherId -> subjects
  for (const s of live) {
    const t = id(s.teacherId);
    if (!teaches.has(t)) teaches.set(t, new Set());
    teaches.get(t)!.add(s.subject);
  }
  const allTeacherIds = [...byT.keys()];

  for (const who of ["Hamida Akter"]) {
    const uid = [...uName.entries()].find(([, n]) => n === who)?.[0]!;
    console.log(`\n=== ABSORBING ${who}'s SLOTS — who is free at that exact (day, period)? ===`);
    for (const s of live
      .filter((x) => id(x.teacherId) === uid)
      .sort((a, b) => DAYS.indexOf(a.dayOfWeek) - DAYS.indexOf(b.dayOfWeek) || a.periodNumber - b.periodNumber)) {
      const k = `${s.dayOfWeek} P${s.periodNumber}`;
      const free = allTeacherIds.filter((t) => t !== uid && !busy.get(k)!.has(t));
      const freeSame = free.filter((t) => teaches.get(t)!.has(s.subject));
      console.log(
        `  ${k}\t${s.subject}\t${where(s)}\n` +
          `      free that period (${free.length}): ${free.map((t) => uName.get(t)).join(", ") || "NOBODY"}\n` +
          `      ...of whom already teach ${s.subject} (${freeSame.length}): ${freeSame.map((t) => uName.get(t)).join(", ") || "NOBODY"}`,
      );
    }
  }

  console.log("\n=== FREE-SLOT MAP: how many of the 14 teaching staff are idle each period ===");
  for (const d of DAYS) {
    const line = [1, 2, 3, 5, 6, 7, 8]
      .map((p) => `P${p}:${allTeacherIds.length - (busy.get(`${d} P${p}`)?.size ?? 0)}`)
      .join(" ");
    console.log(`  ${d}\t${line}   (14 teaching staff)`);
  }

  // (c) deduped cover fill-rate ----------------------------------------------
  const covers = await db.collection("staffcoverslots").find({}).toArray();
  const seen = new Map<string, string>(); // date|period|absent|slot -> best status
  const rank: Record<string, number> = { approved: 3, proposed: 2, needs_cover: 1 };
  for (const c of covers as any[]) {
    const k = `${c.dateKey}|${c.periodNumber}|${id(c.absentTeacherUserId)}|${id(c.routineSlotId)}`;
    const prev = seen.get(k);
    if (!prev || rank[c.status] > rank[prev]) seen.set(k, c.status);
  }
  const tally: Record<string, number> = {};
  for (const st of seen.values()) tally[st] = (tally[st] ?? 0) + 1;
  console.log(
    `\n=== COVER FILL-RATE (deduped by date+period+absent+slot) ===\n` +
      `  distinct class meetings left teacherless by leave: ${seen.size}\n` +
      `  ${JSON.stringify(tally)}\n` +
      `  confirmed cover: ${tally.approved ?? 0}/${seen.size} = ${(((tally.approved ?? 0) / seen.size) * 100).toFixed(0)}%\n` +
      `  raw rows (with duplicate leave fan-out): ${covers.length}`,
  );
  const july = [...seen.entries()].filter(([k]) => k.startsWith("2026-07"));
  const jt: Record<string, number> = {};
  for (const [, st] of july) jt[st] = (jt[st] ?? 0) + 1;
  console.log(`  July-only: ${july.length} meetings, ${JSON.stringify(jt)}`);

  // (d) approved leave days, July -------------------------------------------
  const leaves = await db.collection("staffleaveapplications").find({}).toArray();
  console.log("\n=== APPROVED LEAVE, JULY 2026 (per teacher) ===");
  const perStaff = new Map<string, { days: number; apps: number; dates: string[] }>();
  let cancelled = 0;
  for (const l of leaves as any[]) {
    if (!String(l.fromKey).startsWith("2026-07")) continue;
    if (l.status !== "approved") {
      cancelled++;
      continue;
    }
    const n = spName.get(id(l.staffProfileId)) ?? "?";
    if (!perStaff.has(n)) perStaff.set(n, { days: 0, apps: 0, dates: [] });
    const e = perStaff.get(n)!;
    e.days += l.days;
    e.apps++;
    e.dates.push(`${l.fromKey}${l.toKey !== l.fromKey ? `..${l.toKey}` : ""}`);
  }
  let total = 0;
  for (const [n, e] of [...perStaff.entries()].sort((a, b) => b[1].days - a[1].days)) {
    total += e.days;
    console.log(`  ${n.padEnd(24)} ${e.days.toFixed(2).padStart(5)} days  (${e.apps} apps: ${e.dates.join(", ")})`);
  }
  console.log(`  TOTAL approved leave-days in July = ${total.toFixed(2)} across ${perStaff.size} staff`);
  console.log(`  (plus ${cancelled} cancelled/rejected July applications)`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
