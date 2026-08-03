// READ-ONLY: teacher-load picture for the recruitment assessment.
// Dumps, from scdhub_prod: the staff roster, every active routine slot grouped by
// teacher (with track + subject + group), the weekly period grid, staff leave
// applications (all, with last-month called out), cover slots / substitutions, and
// the standing non-teaching duties (class-teacher, section attendance, bell duty).
// No writes.
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
  console.log(`db = ${db.databaseName}`);

  const [staff, users, classes, sections, groups, slots, grids, windows, holidays] =
    await Promise.all([
      db.collection("staffprofiles").find({}).toArray(),
      db.collection("users").find({}).toArray(),
      db.collection("classes").find({}).toArray(),
      db.collection("sections").find({}).toArray(),
      db.collection("subjectgroups").find({}).toArray(),
      db.collection("routineslots").find({}).toArray(),
      db.collection("periodgrids").find({}).toArray(),
      db.collection("schedulewindows").find({}).toArray(),
      db.collection("holidayexceptions").find({}).toArray(),
    ]);

  const cName = new Map(classes.map((c: any) => [id(c._id), c.name ?? c.nameBn]));
  const sName = new Map(
    sections.map((s: any) => [
      id(s._id),
      `${cName.get(id(s.classId)) ?? "?"}-${s.name ?? s.code}`,
    ]),
  );
  const gName = new Map(groups.map((g: any) => [id(g._id), `${g.name} [${g.track}]`]));
  const uName = new Map(users.map((u: any) => [id(u._id), u.name]));
  const spName = new Map(staff.map((s: any) => [id(s._id), s.name]));

  console.log("\n=== STAFF ROSTER ===");
  for (const s of staff as any[]) {
    console.log(
      `  ${s.schoolId}\t${s.name}\tcat=${s.category}\tdesig=${s.designation ?? "-"}\t` +
        `type=${s.employmentType}\tstatus=${s.employmentStatus}\tactive=${s.active}\t` +
        `joined=${s.joiningDate ? new Date(s.joiningDate).toISOString().slice(0, 10) : "-"}\t_id=${id(s._id)}`,
    );
  }

  console.log("\n=== USERS (login accounts) ===");
  for (const u of users as any[]) {
    console.log(
      `  ${u.name}\trole=${u.role}\tactive=${u.active}\tstaffProfileId=${id(u.staffProfileId)}\t_id=${id(u._id)}`,
    );
  }

  console.log("\n=== PERIOD GRIDS ===");
  for (const g of grids as any[]) {
    console.log(
      `  audience=${g.audienceKey} season=${g.season} levels=${JSON.stringify(g.classLevels)} active=${g.active} periods=${g.periods?.length}`,
    );
    for (const p of g.periods ?? [])
      console.log(
        `      P${p.number} ${p.durationMin}min break=${p.isBreak} track=${p.track} ${p.nameBn ?? ""}`,
      );
  }
  console.log("\n=== SCHEDULE WINDOWS ===");
  for (const w of windows as any[])
    console.log(
      `  ${w.label} season=${w.season} ${new Date(w.fromDate).toISOString().slice(0, 10)} -> ${new Date(w.toDate).toISOString().slice(0, 10)} active=${w.active}`,
    );
  console.log("\n=== SUBJECT GROUPS ===");
  for (const g of groups as any[])
    console.log(`  ${g.name}\ttrack=${g.track}\tactive=${g.active}\t_id=${id(g._id)}`);

  console.log("\n=== SECTIONS ===");
  for (const s of sections as any[])
    console.log(`  ${sName.get(id(s._id))}\t_id=${id(s._id)}`);

  // ---- routine ------------------------------------------------------------
  const live = (slots as any[]).filter((s) => s.active !== false && !s.isBreak);
  console.log(
    `\n=== ROUTINE SLOTS: total=${slots.length} active-non-break=${live.length} ` +
      `unassigned-teacher=${live.filter((s) => !s.teacherId).length} ===`,
  );

  const perTeacher = new Map<string, any[]>();
  for (const s of live) {
    const k = id(s.teacherId) || "(none)";
    if (!perTeacher.has(k)) perTeacher.set(k, []);
    perTeacher.get(k)!.push(s);
  }

  const DAYS = ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"];
  console.log("\n--- per-teacher weekly load ---");
  const rows = [...perTeacher.entries()]
    .map(([tid, ss]) => {
      const byDay: Record<string, number> = {};
      for (const d of DAYS) byDay[d] = ss.filter((s) => s.dayOfWeek === d).length;
      const tracks: Record<string, number> = {};
      for (const s of ss) tracks[s.track] = (tracks[s.track] ?? 0) + 1;
      const subjects: Record<string, number> = {};
      for (const s of ss) subjects[s.subject] = (subjects[s.subject] ?? 0) + 1;
      const gset = new Set(
        ss.map((s) =>
          s.groupType === "section" ? sName.get(id(s.groupId)) : gName.get(id(s.groupId)),
        ),
      );
      return { tid, name: uName.get(tid) ?? tid, n: ss.length, byDay, tracks, subjects, gset };
    })
    .sort((a, b) => b.n - a.n);

  for (const r of rows) {
    console.log(
      `\n  ${r.name}  (${r.n} periods/week)  [${r.tid}]\n` +
        `      days: ${DAYS.map((d) => `${d}:${r.byDay[d]}`).join(" ")}\n` +
        `      tracks: ${JSON.stringify(r.tracks)}\n` +
        `      subjects: ${JSON.stringify(r.subjects)}\n` +
        `      groups(${r.gset.size}): ${[...r.gset].join(", ")}`,
    );
  }

  console.log("\n--- teachers on the roster with ZERO routine periods ---");
  for (const u of users as any[]) {
    if (!perTeacher.has(id(u._id)) && u.active !== false)
      console.log(`  ${u.name} (role=${u.role})`);
  }

  console.log("\n--- demand per section/group (periods/week) ---");
  const perGroup = new Map<string, number>();
  for (const s of live) {
    const k =
      s.groupType === "section" ? sName.get(id(s.groupId)) ?? id(s.groupId) : gName.get(id(s.groupId)) ?? id(s.groupId);
    perGroup.set(k, (perGroup.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...perGroup.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${k}\t${v}`);

  console.log("\n--- per (day, period) simultaneous class count ---");
  const cell = new Map<string, number>();
  for (const s of live) {
    const k = `${s.dayOfWeek} P${s.periodNumber}`;
    cell.set(k, (cell.get(k) ?? 0) + 1);
  }
  for (const d of DAYS) {
    const line = [...cell.entries()]
      .filter(([k]) => k.startsWith(d + " "))
      .sort((a, b) => Number(a[0].split("P")[1]) - Number(b[0].split("P")[1]))
      .map(([k, v]) => `${k.split(" ")[1]}:${v}`)
      .join(" ");
    if (line) console.log(`  ${d}\t${line}`);
  }

  console.log("\n--- effectiveFrom/To spread (are edits versioned?) ---");
  const eff = new Map<string, number>();
  for (const s of slots as any[]) {
    const k = `${new Date(s.effectiveFrom).toISOString().slice(0, 10)} -> ${s.effectiveTo ? new Date(s.effectiveTo).toISOString().slice(0, 10) : "open"} active=${s.active}`;
    eff.set(k, (eff.get(k) ?? 0) + 1);
  }
  for (const [k, v] of eff) console.log(`  ${k}\t${v}`);

  // ---- leave --------------------------------------------------------------
  const leaves = await db.collection("staffleaveapplications").find({}).sort({ fromKey: 1 }).toArray();
  console.log(`\n=== STAFF LEAVE APPLICATIONS: ${leaves.length} ===`);
  for (const l of leaves as any[]) {
    console.log(
      `  ${l.fromKey} -> ${l.toKey}\t${(spName.get(id(l.staffProfileId)) ?? id(l.staffProfileId)).padEnd(22)}\t` +
        `${String(l.leaveType).padEnd(12)}\tdays=${l.days}\tpart=${l.dayPart}${l.partialPeriods?.length ? `(${l.partialPeriods.join(",")})` : ""}\t` +
        `status=${l.status}\tpaid=${l.paidDays ?? "-"}/unpaid=${l.unpaidDays ?? "-"}\tcreated=${new Date(l.createdAt).toISOString().slice(0, 10)}\treason="${l.reason}"`,
    );
  }

  const entitlements = await db.collection("staffleaveentitlements").find({}).toArray();
  console.log(`\n=== LEAVE ENTITLEMENTS: ${entitlements.length} ===`);
  for (const e of entitlements as any[])
    console.log(`  ${spName.get(id(e.staffProfileId)) ?? id(e.staffProfileId)}\t${JSON.stringify(e.allowances ?? e)}`);

  // ---- cover / substitution ----------------------------------------------
  for (const coll of ["staffcoverslots", "routinesubstitutions"]) {
    const docs = await db.collection(coll).find({}).toArray();
    console.log(`\n=== ${coll.toUpperCase()}: ${docs.length} ===`);
    const byCover = new Map<string, number>();
    for (const d of docs as any[]) {
      const who =
        uName.get(id(d.coverTeacherId ?? d.substituteTeacherId)) ??
        spName.get(id(d.coverStaffProfileId)) ??
        "(unassigned)";
      byCover.set(who, (byCover.get(who) ?? 0) + 1);
      console.log(
        `  ${d.dateKey ?? ""}\tP${d.periodNumber ?? "?"}\tabsent=${uName.get(id(d.absentTeacherId)) ?? spName.get(id(d.absentStaffProfileId)) ?? "?"}\tcover=${who}\tstatus=${d.status ?? "-"}`,
      );
    }
    console.log(`  -- cover count by person: ${JSON.stringify(Object.fromEntries(byCover))}`);
  }

  // ---- standing non-teaching duties --------------------------------------
  const cta = await db.collection("classteacherassignments").find({}).toArray();
  console.log(`\n=== CLASS-TEACHER ASSIGNMENTS: ${cta.length} ===`);
  for (const a of cta as any[])
    console.log(
      `  ${sName.get(id(a.sectionId)) ?? id(a.sectionId)}\t${uName.get(id(a.teacherId)) ?? id(a.teacherId)}\tactive=${a.active ?? "-"}`,
    );

  const saa = await db.collection("sectionattendanceassignments").find({}).toArray();
  console.log(`\n=== SECTION ATTENDANCE ASSIGNMENTS: ${saa.length} ===`);
  for (const a of saa as any[])
    console.log(
      `  ${sName.get(id(a.sectionId)) ?? id(a.sectionId)}\t${uName.get(id(a.teacherId)) ?? id(a.teacherId)}\tactive=${a.active ?? "-"}`,
    );

  const bell = await db.collection("belldutyassignments").find({}).toArray();
  console.log(`\n=== BELL DUTY: ${bell.length} ===`);
  for (const b of bell as any[])
    console.log(`  ${JSON.stringify({ ...b, _id: undefined })}`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
