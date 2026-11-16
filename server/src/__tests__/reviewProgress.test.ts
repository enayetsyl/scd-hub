/**
 * Review supervision, slice RS-3 (.claude/plans/review-supervision.md): the daily snapshot,
 * its backfill, the series and the projection.
 *
 *   projectFinish   pure: pace over the last 10 SCHOOL days (Fri/Sat/holidays skipped), days left,
 *                   finish key, status vs the target, NO_DATA when nothing was done
 *   backfill        rows from each round's submittedAt (Dhaka day), estimated, idempotent, never
 *                   over a real row
 *   capture         the scheduler's job: today's real rows, idempotent
 *   overview        doneToday / doneThisWeek / pace / status / weekly periods per reviewer
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

jest.mock("../modules/notifications/services/emitters", () => ({
  ...jest.requireActual("../modules/notifications/services/emitters"),
  emitReviewAssigned: jest.fn().mockResolvedValue(undefined),
  emitQuestionReviewAssigned: jest.fn().mockResolvedValue(undefined),
  emitReviewTaskNotice: jest.fn().mockResolvedValue(undefined),
}));

import { User } from "../modules/foundation/models/User";
import { ReviewAssignment } from "../modules/content/models/ReviewAssignment";
import { ReviewProgram } from "../modules/review-program/models/ReviewProgram";
import { ReviewTask } from "../modules/review-program/models/ReviewTask";
import { ReviewProgressSnapshot } from "../modules/review-program/models/ReviewProgressSnapshot";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { HolidayException } from "../modules/routine/models/HolidayException";
import { adoptOpenAssignments, createProgram, moveTask, updateBatch } from "../modules/review-program/services/ReviewProgramService";
import {
  addDaysKey,
  backfillReviewSnapshots,
  captureReviewSnapshots,
  dhakaDateKey,
  projectFinish,
  reviewProgressSeries,
  supervisionOverview,
} from "../modules/review-program/services/ReviewProgressService";

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

// ---------------------------------------------------------------------------
// projectFinish (pure). 2026-11-19 is a Thursday.
// ---------------------------------------------------------------------------

const TODAY = "2026-11-19";
const dow = (k: string) => new Date(`${k}T00:00:00Z`).getUTCDay();
const sunThu = (holidays: string[] = []) => (k: string) => dow(k) <= 4 && !holidays.includes(k);

/** 100 weighted minutes on each of the last 10 COMPLETED school days (Sun-Thu) before TODAY. */
function steady(per = 100, isSchoolDay = sunThu()): Map<string, number> {
  const m = new Map<string, number>();
  let n = 0;
  for (let i = 1; n < 10; i += 1) {
    const k = addDaysKey(TODAY, -i);
    if (!isSchoolDay(k)) continue;
    m.set(k, per);
    n += 1;
  }
  return m;
}

describe("projectFinish", () => {
  test("pace over school days, finish skips Friday and Saturday, status vs the target", () => {
    const base = { dailyMin: steady(), remainingMin: 500, today: TODAY, isSchoolDay: sunThu() };
    // 500 / 100 = 5 school days: Sun 22, Mon 23, Tue 24, Wed 25, Thu 26.
    const onTrack = projectFinish({ ...base, targetKey: "2026-11-26" });
    expect(onTrack).toMatchObject({ pacePerDay: 100, daysLeft: 5, projectedFinishKey: "2026-11-26", status: "ON_TRACK" });
    expect(projectFinish({ ...base, targetKey: "2026-11-25" }).status).toBe("BEHIND");
    expect(projectFinish({ ...base, targetKey: "2026-11-19" }).status).toBe("BEHIND"); // 7 days of grace
    expect(projectFinish({ ...base, targetKey: "2026-11-18" }).status).toBe("FAR_BEHIND");
  });

  test("a holiday is not a school day: neither in the pace window nor as a finish day", () => {
    const hol = sunThu(["2026-11-22"]);
    const r = projectFinish({ dailyMin: steady(100, hol), remainingMin: 500, today: TODAY, targetKey: "2026-11-26", isSchoolDay: hol });
    expect(r.projectedFinishKey).toBe("2026-11-29"); // 22 is off, so the 5th school day is Sun 29
    expect(r.status).toBe("BEHIND");
    // Work done on a Friday inside the window still counts (numerator = all minutes), over the same 10 school days.
    const withFriday = steady();
    withFriday.set("2026-11-13", 1000);
    expect(projectFinish({ dailyMin: withFriday, remainingMin: 500, today: TODAY, targetKey: null, isSchoolDay: sunThu() }).pacePerDay).toBe(200);
  });

  test("today is not in the pace; the window never starts before the batch, and needs 3 school days", () => {
    const m = steady();
    m.set(TODAY, 100000); // today is not over: ignored
    expect(projectFinish({ dailyMin: m, remainingMin: 500, today: TODAY, targetKey: null, isSchoolDay: sunThu() }).pacePerDay).toBe(100);
    // Batch started Mon 16th: completed school days are 16, 17, 18 (3) -> pace over those only.
    const young = projectFinish({ dailyMin: m, remainingMin: 300, today: TODAY, targetKey: null, isSchoolDay: sunThu(), windowStartKey: "2026-11-16" });
    expect(young.pacePerDay).toBe(100);
    // Started Tue 17th: only 2 completed school days -> no pace yet.
    const tooYoung = projectFinish({ dailyMin: m, remainingMin: 300, today: TODAY, targetKey: "2026-12-15", isSchoolDay: sunThu(), windowStartKey: "2026-11-17" });
    expect(tooYoung).toEqual({ pacePerDay: null, daysLeft: null, projectedFinishKey: null, status: "NO_DATA" });
  });

  test("NO_DATA with no recent work, or no target; nothing left is ON_TRACK today", () => {
    const none = projectFinish({ dailyMin: new Map(), remainingMin: 500, today: TODAY, targetKey: "2026-12-15", isSchoolDay: sunThu() });
    expect(none).toEqual({ pacePerDay: null, daysLeft: null, projectedFinishKey: null, status: "NO_DATA" });
    const noTarget = projectFinish({ dailyMin: steady(), remainingMin: 500, today: TODAY, targetKey: null, isSchoolDay: sunThu() });
    expect(noTarget).toMatchObject({ projectedFinishKey: "2026-11-26", status: "NO_DATA" });
    const done = projectFinish({ dailyMin: new Map(), remainingMin: 0, today: TODAY, targetKey: "2026-12-15", isSchoolDay: sunThu() });
    expect(done).toMatchObject({ projectedFinishKey: TODAY, status: "ON_TRACK" });
  });

  test("old work outside the 10-school-day window is ignored", () => {
    const m = steady();
    m.set("2026-10-01", 5000);
    expect(projectFinish({ dailyMin: m, remainingMin: 500, today: TODAY, targetKey: null, isSchoolDay: sunThu() }).pacePerDay).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const oid = () => new Types.ObjectId();
const at = (key: string) => new Date(`${key}T12:00:00+06:00`);
const NOW = at("2026-11-19");
let ACTOR: { id: string; role: string };
let SAJEDA: Types.ObjectId;
let programId: string;
let seq = 0;

async function user(name: string, role = "TEACHER"): Promise<Types.ObjectId> {
  const u = await User.create({ name, role, passwordHash: "x", phone: `0${Math.floor(Math.random() * 1e9)}${name.length}` });
  return u._id;
}

async function rounds(s: {
  reviewer: Types.ObjectId;
  docType?: string;
  chapter?: string;
  n: number;
  verdict?: "APPROVE" | "CHANGES_REQUESTED" | "APPROVE_WITH_CONDITION";
  submitted?: string | Date;
  assigned?: string;
  session?: number;
  roundNumber?: number;
  status?: string;
}): Promise<void> {
  const docs = [];
  for (let i = 0; i < s.n; i += 1) {
    seq += 1;
    const dt = s.docType ?? "session_plan";
    docs.push({
      docType: dt, subject: "BAN", classLevel: 1, anchorWord: "পাঠ", addressNumber: s.chapter ?? "1",
      qid: dt === "question" ? `Q${seq}` : undefined,
      sessionIndex: dt === "session_plan" ? (s.session ?? seq) : undefined,
      artifactId: oid(), reviewerId: s.reviewer, assignedBy: oid(), assignedAt: at(s.assigned ?? "2026-11-10"), roundNumber: s.roundNumber ?? 1,
      status: s.status ?? (s.verdict ? "submitted" : "assigned"),
      verdict: s.verdict,
      submittedAt: s.verdict && s.submitted ? (s.submitted instanceof Date ? s.submitted : at(s.submitted)) : undefined,
    });
  }
  await ReviewAssignment.insertMany(docs);
}

beforeEach(async () => {
  await Promise.all(
    [User, ReviewAssignment, ReviewProgram, ReviewTask, ReviewProgressSnapshot, RoutineSlot, HolidayException].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
  ACTOR = { id: (await user("Owner", "PRINCIPAL")).toString(), role: "PRINCIPAL" };
  SAJEDA = await user("Sajeda");
  const p = await createProgram({ name: "2027", batches: [{ batch: 1, name: "Batch 1", targetDate: "2026-12-15" }], actor: ACTOR });
  programId = p.id;
  // Chapter 1: 4 plans (2 approved Tue 17th, 1 changes Wed 18th, 1 open) + 10 questions (6 done Wed 18th).
  await rounds({ reviewer: SAJEDA, n: 2, verdict: "APPROVE", submitted: "2026-11-17" });
  await rounds({ reviewer: SAJEDA, n: 1, verdict: "CHANGES_REQUESTED", submitted: "2026-11-18" });
  await rounds({ reviewer: SAJEDA, n: 1 });
  await rounds({ reviewer: SAJEDA, docType: "question", n: 6, verdict: "APPROVE", submitted: "2026-11-18" });
  await rounds({ reviewer: SAJEDA, docType: "question", n: 4 });
  await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
});

describe("backfill", () => {
  test("rows come from submittedAt, up to yesterday, estimated, with exact done counts", async () => {
    expect(dhakaDateKey(NOW)).toBe("2026-11-19");
    const written = await backfillReviewSnapshots(programId, 1, NOW);
    expect(written).toBe(2); // 17th and 18th, one reviewer
    const rows = await ReviewProgressSnapshot.find({}).sort({ dateKey: 1 }).lean();
    expect(rows.map((r) => r.dateKey)).toEqual(["2026-11-17", "2026-11-18"]);
    expect(rows.every((r) => r.estimated)).toBe(true);
    expect(rows[0]).toMatchObject({ plansDone: 2, chapterPlansDone: 0, questionsDone: 0, cumulativeDone: 2, remaining: 12, doneWeightMin: 20, changes: 0 });
    expect(rows[1]).toMatchObject({ plansDone: 1, questionsDone: 6, cumulativeDone: 9, remaining: 5, doneWeightMin: 16, remainingWeightMin: 14, changes: 1 });
  });

  test("is idempotent and never overwrites a real row", async () => {
    await backfillReviewSnapshots(programId, 1, NOW);
    await ReviewProgressSnapshot.updateOne({ dateKey: "2026-11-18" }, { $set: { estimated: false, doneWeightMin: 999 } });
    await backfillReviewSnapshots(programId, 1, NOW);
    await backfillReviewSnapshots(programId, 1, NOW);
    expect(await ReviewProgressSnapshot.countDocuments({})).toBe(2);
    expect((await ReviewProgressSnapshot.findOne({ dateKey: "2026-11-18" }).lean())?.doneWeightMin).toBe(999);
  });

  test("the series backfills the first time a batch has no rows, and today is the live row", async () => {
    expect(await ReviewProgressSnapshot.countDocuments({})).toBe(0);
    const series = await reviewProgressSeries(programId, 1, { perReviewer: true }, NOW);
    expect(await ReviewProgressSnapshot.countDocuments({})).toBe(2);
    expect(series.map((r) => r.dateKey)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(series[2]).toMatchObject({ estimated: false, doneCount: 0, cumulativeDone: 9, remaining: 5 });
    const batchRows = await reviewProgressSeries(programId, 1, {}, NOW);
    expect(batchRows.every((r) => r.reviewerId === null)).toBe(true);
    expect(batchRows[1]).toMatchObject({ doneCount: 7, changes: 1 });
  });
});

describe("capture (the scheduler job)", () => {
  test("writes today's real row once, however often it runs", async () => {
    const at2130 = new Date("2026-11-19T21:30:00+06:00");
    const first = await captureReviewSnapshots(at2130);
    const second = await captureReviewSnapshots(at2130);
    expect(first).toBe(1);
    expect(second).toBe(1);
    const rows = await ReviewProgressSnapshot.find({}).sort({ dateKey: 1 }).lean();
    expect(rows.map((r) => [r.dateKey, r.estimated])).toEqual([
      ["2026-11-17", true],
      ["2026-11-18", true],
      ["2026-11-19", false],
    ]);
    expect(rows[2]).toMatchObject({ cumulativeDone: 9, remaining: 5, doneWeightMin: 0, remainingWeightMin: 14 });
  });

  test("a finished batch with nothing done today writes nothing", async () => {
    await ReviewAssignment.updateMany({ verdict: { $exists: false } }, { $set: { verdict: "APPROVE", status: "submitted", submittedAt: at("2026-11-18") } });
    expect(await captureReviewSnapshots(new Date("2026-11-19T21:30:00+06:00"))).toBe(0);
  });
});

describe("supervisionOverview", () => {
  test("today / this week / pace / projection / weekly periods", async () => {
    const slot = { groupType: "section", groupId: oid(), subject: "BAN", track: "general", effectiveFrom: at("2026-01-01"), createdBy: oid(), teacherId: SAJEDA };
    await RoutineSlot.create([
      { ...slot, dayOfWeek: "SUN", periodNumber: 1 },
      { ...slot, dayOfWeek: "SUN", periodNumber: 1, groupId: oid() }, // same day+period in another group: counted once
      { ...slot, dayOfWeek: "MON", periodNumber: 3 },
      { ...slot, dayOfWeek: "TUE", periodNumber: 2, isBreak: true },
      { ...slot, dayOfWeek: "WED", periodNumber: 2, active: false },
    ]);
    const o = await supervisionOverview(programId, 1, NOW);
    const r = o.reviewers[0];
    expect(r).toMatchObject({ doneToday: 0, doneThisWeek: 9, weeklyPeriods: 2, minutesRemaining: 14, status: "ON_TRACK" });
    // The batch began Tue 10th: 7 completed school days (10, 11, 12, 15, 16, 17, 18) hold 36 weighted minutes
    // -> 36/7 per day; 14 left -> 3 school days after today: 22, 23, 24.
    expect(r.pacePerDay).toBeCloseTo(36 / 7);
    expect(r.projectedFinishKey).toBe("2026-11-24");
    expect(o.batchProjection).toMatchObject({ doneThisWeek: 9, projectedFinishKey: "2026-11-24", status: "ON_TRACK" });

    await updateBatch({ programId, batch: 1, targetDate: "2026-11-20", actor: ACTOR });
    expect((await supervisionOverview(programId, 1, NOW)).reviewers[0].status).toBe("BEHIND");
    await updateBatch({ programId, batch: 1, targetDate: "2026-11-01", actor: ACTOR });
    expect((await supervisionOverview(programId, 1, NOW)).reviewers[0].status).toBe("FAR_BEHIND");
  });

  test("a holiday pushes the projected finish; no recent work is NO_DATA", async () => {
    await HolidayException.create({ fromDate: new Date(2026, 10, 22), toDate: new Date(2026, 10, 22), type: "special", nameBn: "x", active: true });
    const o = await supervisionOverview(programId, 1, NOW);
    expect(o.reviewers[0].projectedFinishKey).toBe("2026-11-25");
    // A month later the 10-school-day window holds no work.
    const later = await supervisionOverview(programId, 1, at("2026-12-20"));
    expect(later.reviewers[0]).toMatchObject({ pacePerDay: null, projectedFinishKey: null, status: "NO_DATA" });
  });
});

describe("daily done is exact (the submittedAt aggregation)", () => {
  const dayRow = (rows: { dateKey: string }[], k: string) => rows.find((r) => r.dateKey === k) as unknown as Record<string, number> | undefined;

  test("a 23:30 and a 00:30 Dhaka submit land on their own days; evening work shows in the series", async () => {
    await rounds({ reviewer: SAJEDA, n: 1, verdict: "APPROVE", submitted: new Date("2026-11-17T23:30:00+06:00") });
    await rounds({ reviewer: SAJEDA, n: 1, verdict: "APPROVE", submitted: new Date("2026-11-18T00:30:00+06:00") });
    await rounds({ reviewer: SAJEDA, n: 1, verdict: "APPROVE", submitted: new Date("2026-11-18T22:45:00+06:00") });
    const series = await reviewProgressSeries(programId, 1, { perReviewer: true }, NOW);
    expect(dayRow(series, "2026-11-17")?.plansDone).toBe(3); // 2 base + the 23:30 one
    expect(dayRow(series, "2026-11-18")?.plansDone).toBe(3); // 1 base + 00:30 + 22:45
  });

  test("only the latest round of a thread counts; a cancelled latest round does not", async () => {
    // Thread 900: round 1 decided, round 2 open -> not done. Thread 901: round 1 decided, round 2 decided -> once.
    await rounds({ reviewer: SAJEDA, n: 1, session: 900, verdict: "APPROVE", submitted: "2026-11-16", status: "superseded" });
    await rounds({ reviewer: SAJEDA, n: 1, session: 900, roundNumber: 2 });
    await rounds({ reviewer: SAJEDA, n: 1, session: 901, verdict: "CHANGES_REQUESTED", submitted: "2026-11-16", status: "superseded" });
    await rounds({ reviewer: SAJEDA, n: 1, session: 901, roundNumber: 2, verdict: "APPROVE", submitted: "2026-11-18" });
    // Thread 902: round 2 cancelled -> the thread is not counted at all.
    await rounds({ reviewer: SAJEDA, n: 1, session: 902, verdict: "APPROVE", submitted: "2026-11-16", status: "superseded" });
    await rounds({ reviewer: SAJEDA, n: 1, session: 902, roundNumber: 2, status: "cancelled" });
    const series = await reviewProgressSeries(programId, 1, { perReviewer: true }, NOW);
    expect(dayRow(series, "2026-11-16")).toBeUndefined();
    expect(dayRow(series, "2026-11-18")).toMatchObject({ plansDone: 2, changes: 1 }); // base 1 + thread 901
  });

  test("a round assigned before the batch start is not counted", async () => {
    await updateBatch({ programId, batch: 1, startAt: "2026-11-15T00:00:00+06:00", actor: ACTOR });
    await rounds({ reviewer: SAJEDA, chapter: "2", n: 1, verdict: "APPROVE", submitted: "2026-11-17", assigned: "2026-11-16" });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    const series = await reviewProgressSeries(programId, 1, { perReviewer: true }, NOW);
    expect(dayRow(series, "2026-11-17")?.plansDone).toBe(1); // not the 2 chapter-1 rounds assigned on the 10th
    expect(dayRow(series, "2026-11-18")?.doneCount).toBe(0); // nor the 7 done on the 18th
  });

  test("a chapter plan is its own kind", async () => {
    await rounds({ reviewer: SAJEDA, docType: "chapter_plan", n: 1, verdict: "APPROVE", submitted: "2026-11-18" });
    const series = await reviewProgressSeries(programId, 1, { perReviewer: true }, NOW);
    expect(dayRow(series, "2026-11-18")).toMatchObject({ plansDone: 1, chapterPlansDone: 1, questionsDone: 6, doneCount: 8, doneWeightMin: 26 });
  });

  test("after moveTask, decided rounds stay credited to the reviewer who decided them", async () => {
    const JERIN = await user("Jerin");
    const task = await ReviewTask.findOne({ chapter: "1" });
    await moveTask({ taskId: task!._id.toString(), toReviewerId: JERIN.toString(), actor: ACTOR });
    const series = await reviewProgressSeries(programId, 1, { perReviewer: true }, NOW);
    const sajeda = series.filter((r) => r.reviewerId === SAJEDA.toString());
    expect(dayRow(sajeda, "2026-11-17")?.plansDone).toBe(2);
    expect(dayRow(sajeda, "2026-11-18")).toMatchObject({ plansDone: 1, questionsDone: 6 });
    expect(series.filter((r) => r.reviewerId === JERIN.toString()).every((r) => r.doneCount === 0)).toBe(true);
  });

  test("the next night's capture re-finalises yesterday's real row with the evening work", async () => {
    await captureReviewSnapshots(new Date("2026-11-18T21:30:00+06:00"));
    const before = await ReviewProgressSnapshot.findOne({ dateKey: "2026-11-18" }).lean();
    expect(before).toMatchObject({ estimated: false, plansDone: 1, questionsDone: 6, cumulativeDone: 9 });
    await rounds({ reviewer: SAJEDA, n: 1, verdict: "APPROVE", submitted: new Date("2026-11-18T22:30:00+06:00") });
    // Seen live at once, without waiting for any capture.
    expect(dayRow(await reviewProgressSeries(programId, 1, { perReviewer: true }, NOW), "2026-11-18")?.plansDone).toBe(2);
    await captureReviewSnapshots(new Date("2026-11-19T21:30:00+06:00"));
    const after = await ReviewProgressSnapshot.findOne({ dateKey: "2026-11-18" }).lean();
    expect(after).toMatchObject({ estimated: false, plansDone: 2, questionsDone: 6, cumulativeDone: 10, doneWeightMin: 26 });
  });

  test("a missed night is filled in, and a failing batch is logged, not thrown", async () => {
    // Nothing was captured on the 17th or 18th; the capture on the 19th fills both.
    await captureReviewSnapshots(new Date("2026-11-19T21:30:00+06:00"));
    expect((await ReviewProgressSnapshot.find({}).lean()).map((r) => r.dateKey).sort()).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const bw = jest.spyOn(ReviewProgressSnapshot, "bulkWrite").mockRejectedValue(new Error("boom"));
    await expect(captureReviewSnapshots(new Date("2026-11-20T21:30:00+06:00"))).resolves.toBe(0);
    expect(err).toHaveBeenCalled();
    bw.mockRestore();
    err.mockRestore();
  });
});
