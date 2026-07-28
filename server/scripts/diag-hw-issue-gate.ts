// READ-ONLY: for every stranded `declared` homework item, replay the four
// auto-issue gates (HomeworkAutoIssueService §5) against that class+day and say
// WHICH ONE actually blocked it.
//
//   1. coverage  — every routine-expected subject has a declaration or nil (D-#310)
//   2. ceiling   — day total <= 120 min
//   3. reconciled— day already reconciled
//   4. attendance— every active student has a marked attendance unit that day
//
// Uses the REAL buildIssueRoster for gate 4 so the attendance verdict is exact.
import { readFileSync } from "fs";
import mongoose from "mongoose";
import {
  HW_DECLARATION_EXPECTED_SUBJECTS,
  HW_DAILY_CEILING_MIN,
  DAYS_OF_WEEK,
} from "@scd/shared";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const raw = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();
// Force the prod database explicitly (repo .env defaults to the scdhub_local copy).
const URI = raw.replace(/\/(scdhub_\w+)(\?|$)/, "/scdhub_prod$2");

async function main() {
  await mongoose.connect(URI);
  console.log("DB =", mongoose.connection.db!.databaseName);

  const { HomeworkItem } = await import("../src/modules/trackers/models/HomeworkItem");
  const { HomeworkNilDeclaration } = await import("../src/modules/trackers/models/HomeworkNilDeclaration");
  const { HomeworkReconciliation } = await import("../src/modules/trackers/models/HomeworkReconciliation");
  const { RoutineSlot } = await import("../src/modules/routine/models/RoutineSlot");
  const { buildIssueRoster } = await import("../src/modules/trackers/services/HomeworkAutoIssueService");
  const { dateKeyOf } = await import("../src/modules/attendance/dates");

  const stuck = await HomeworkItem.find({
    status: "declared",
    dateGiven: { $lt: new Date("2026-07-28T00:00:00.000Z") },
  })
    .sort({ dateGiven: 1 })
    .lean();

  // One verdict per (class, day) — the gates are day-scoped, not item-scoped.
  const days = new Map<string, any[]>();
  for (const it of stuck) {
    const k = `${it.classId}|${new Date(it.dateGiven).toISOString().slice(0, 10)}`;
    if (!days.has(k)) days.set(k, []);
    days.get(k)!.push(it);
  }

  const classes = await mongoose.connection.db!.collection("classes").find({}).toArray();
  const cname = new Map(classes.map((c) => [c._id.toString(), (c.nameBn ?? c.name ?? "") as string]));

  const tally: Record<string, number> = {};

  for (const [key, items] of [...days.entries()].sort()) {
    const [classId, dk] = key.split("|");
    const date = new Date(`${dk}T06:00:00.000Z`); // midday local, avoids TZ edge
    const sectionId = items[0].sectionId;

    // All items declared for that class+day (not just the stranded ones).
    const dayStart = new Date(`${dk}T00:00:00.000Z`);
    const dayEnd = new Date(`${dk}T23:59:59.999Z`);
    const docs = await HomeworkItem.find({
      classId,
      dateGiven: { $gte: dayStart, $lte: dayEnd },
    }).lean();

    // --- gate 3: reconciled?
    const recon = await HomeworkReconciliation.findOne({ classId, reconDate: dk }).lean();
    const reconciled = (recon as any)?.reconState === "reconciled";

    // --- gate 1: coverage
    const slots = (await RoutineSlot.find({
      groupType: "section",
      groupId: sectionId,
      active: true,
      isBreak: false,
      subject: { $in: HW_DECLARATION_EXPECTED_SUBJECTS as readonly string[] },
      dayOfWeek: DAYS_OF_WEEK[date.getUTCDay()],
    })
      .select("subject effectiveFrom effectiveTo")
      .lean()) as any[];
    const expected = new Set<string>();
    for (const s of slots) {
      if (new Date(s.effectiveFrom).getTime() > dayEnd.getTime()) continue;
      if (s.effectiveTo && new Date(s.effectiveTo).getTime() < dayStart.getTime()) continue;
      expected.add(s.subject);
    }
    const covered = new Set<string>(docs.map((d: any) => d.subject));
    const nils = (await HomeworkNilDeclaration.find({ sectionId, dateKey: dk })
      .select("subject")
      .lean()) as any[];
    for (const n of nils) covered.add(n.subject);
    const missing = [...expected].filter((s) => !covered.has(s)).sort();

    // --- gate 2: ceiling
    const dayTotal = docs.reduce((sum: number, d: any) => sum + (d.timeDecl ?? 0), 0);

    // --- gate 4: attendance (the real function)
    const roster = await buildIssueRoster(String(sectionId), dateKeyOf(date));

    const blockers: string[] = [];
    if (expected.size > 0 && missing.length > 0 && !reconciled)
      blockers.push(`COVERAGE missing=[${missing.join(",")}]`);
    if (dayTotal > HW_DAILY_CEILING_MIN) blockers.push(`CEILING ${dayTotal}min`);
    if (!roster) blockers.push("ATTENDANCE not fully marked");
    if (blockers.length === 0) blockers.push("NONE — gates pass today (aged out of the same-day sweep window)");

    for (const b of blockers) {
      const tag = b.split(" ")[0];
      tally[tag] = (tally[tag] ?? 0) + items.length;
    }

    console.log(
      `\n${dk} ${DAYS_OF_WEEK[date.getUTCDay()]} ${cname.get(classId) ?? classId}  ` +
        `stranded=${items.length} (${items.map((i: any) => i.subject).join(",")})`,
    );
    console.log(`   expected=[${[...expected].sort().join(",")}] covered=[${[...covered].sort().join(",")}]`);
    console.log(`   dayTotal=${dayTotal}min recon=${(recon as any)?.reconState ?? "none"} attendanceRoster=${roster ? "complete" : "INCOMPLETE"}`);
    console.log(`   => BLOCKED BY: ${blockers.join(" | ")}`);
  }

  console.log("\n===== stranded items attributable to each gate =====");
  for (const [g, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`   ${g}: ${n}`);

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
