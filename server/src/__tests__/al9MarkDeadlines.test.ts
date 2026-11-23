/**
 * AL-9 - marking deadlines on the mark ladder (docs/prd-academic-loop-2027.md section 7, R3, R30, B10).
 * ACs: AC-M1, AC-S2, AC-P1, AC-E3, AC-R1 (and "one reminder per teacher per day").
 *
 *   OFF      the release switch off -> no late paper, no pop-up item, no snapshot row, no mistake row (2026 unchanged)
 *   HW       an OPEN homework paper is late the day AFTER its same-day deadline; the teacher's pop-up carries it once a day
 *   AS       an OPEN assignment paper is late after Tuesday, not on Tuesday
 *   S2       a substitute who confirmed it counts (confirmed = not late); approved leave on the deadline moves it back
 *   P1       HOMEWORK_REQUIRED stops the homework stage, ASSIGNMENT_CHASE the assignment stage, and their days do not count
 *   E3       a child on ABSENT_REDELIVER never holds a confirmed paper late
 *   M1       the 09:30 snapshot lists it (stage MARKS); term 1 writes NO mistake row, term 2 writes one quiet row, once
 *
 * In-memory MongoDB, real services. Unlike most suites this one OPTS OUT of the global "never paused" stub so pauses are real.
 */
jest.unmock("../modules/academic-pause/services/AcademicPauseService");

// A call-through wrapper so a test can make the late-paper read throw once (fallback test).
jest.mock("../modules/trackers/services/MarkDeadlineService", () => {
  const actual = jest.requireActual("../modules/trackers/services/MarkDeadlineService");
  return { ...actual, latePapers: jest.fn(actual.latePapers) };
});

const mockProfile = jest.fn<Promise<unknown>, unknown[]>();
jest.mock("../modules/hr/services/staffMatch", () => ({ resolveStaffProfileForUser: (...a: unknown[]) => mockProfile(...a) }));

import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { AssignmentItem } from "../modules/trackers/models/AssignmentItem";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../modules/trackers/models/HomeworkStudentRecord";
import { MarkEscalation, MarkReminderAck } from "../modules/trackers/models/MarkReminder";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { MasteryPolicy } from "../modules/mastery/models/MasteryPolicy";
import { AcademicPause } from "../modules/academic-pause/models/AcademicPause";
import { StaffLeaveApplication } from "../modules/hr/models/StaffLeaveApplication";
import { StaffMistakeNote } from "../modules/staff-mistakes/models/StaffMistakeNote";
import { StaffMistake } from "../modules/staff-mistakes/models/StaffMistake";
import { Notification } from "../modules/notifications/models/Notification";
import { savePolicy } from "../modules/mastery/services/MasteryCatalogueService";
import { latePapers } from "../modules/trackers/services/MarkDeadlineService";
import { termOfDate } from "../lib/academicTerm";
import { AssignmentStudentRecord } from "../modules/trackers/models/AssignmentStudentRecord";
import {
  acknowledgeMarkReminder,
  markEscalationDays,
  markEscalationFor,
  myMarkEscalation,
  myMarkReminder,
  resetLateMarkCache,
  runMarkEscalation,
} from "../modules/trackers/services/MarkReminderService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let seq = 0;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
let yearT2 = new Types.ObjectId(); // Nov 2026 is in its second half
let yearT1 = new Types.ObjectId(); // Nov 2026 is in its first half

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [a, b] = await AcademicYear.create([
    { label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") },
    { label: "2026-27", startDate: new Date("2026-10-01"), endDate: new Date("2027-04-01") },
  ]);
  yearT2 = a!._id;
  yearT1 = b!._id;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  resetLateMarkCache();
  (latePapers as unknown as jest.Mock).mockClear();
  mockProfile.mockReset();
  mockProfile.mockResolvedValue(null);
  await Promise.all(
    [
      User, Class, Section, AssignmentItem, AssignmentStudentRecord, HomeworkItem, HomeworkStudentRecord, MarkEscalation, MarkReminderAck, MasteryPaper,
      MasteryPolicy, AcademicPause, StaffLeaveApplication, StaffMistakeNote, StaffMistake, Notification,
    ].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})),
  );
  await setLoop(true);
});

const setLoop = (on: boolean) => savePolicy(null, null, { academicLoop2027On: on }, PRINCIPAL);
const at = (hhmm: string, day: string) => new Date(`${day}T${hhmm}:00+06:00`);
const SUN = new Date(2026, 10, 8); // local midnight - the date-only anchor convention
const D = { sun: "2026-11-08", mon: "2026-11-09", tue: "2026-11-10", wed: "2026-11-11", thu: "2026-11-12" };

async function user(name: string, role = "TEACHER", granted: string[] = []): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, active: true, phone: `8801700001${seq}`, passwordHash: "x",
    grantedPermissions: granted, revokedPermissions: [], additionalTemplates: [],
  });
  return r.insertedId.toString();
}

async function where(): Promise<{ classId: Types.ObjectId; sectionId: Types.ObjectId }> {
  seq += 1;
  const c = await Class.collection.insertOne({ level: 3, nameBn: "তৃতীয় শ্রেণি", academicYearId: new Types.ObjectId(), active: true });
  const s = await Section.collection.insertOne({ classId: c.insertedId, code: `S${seq}`, nameBn: "বালক", active: true });
  return { classId: c.insertedId, sectionId: s.insertedId };
}

interface Made { itemId: string; paperId: string; code: string }

/** A homework item given on Sunday with its linked, still-OPEN HW paper. */
async function hwPaper(teacher: string, opts: { year?: Types.ObjectId; confirmed?: boolean; given?: Date; due?: Date } = {}): Promise<Made> {
  seq += 1;
  const w = await where();
  const item = await HomeworkItem.create({
    hwId: `HW-C3-MATH-${String(seq).padStart(4, "0")}`, academicYearId: new Types.ObjectId(), classId: w.classId, classLevel: 3,
    sectionId: w.sectionId, subject: "MATH", dateGiven: opts.given ?? SUN, topTags: ["PRACTICE"], qCount: 1, status: "issued",
    declaredBy: new Types.ObjectId(teacher),
  });
  // The day it COMES IN is the records' due date (set at issue); the default is the day it was given.
  await HomeworkStudentRecord.collection.insertOne({
    hwItemId: item._id, hwId: item.hwId, studentId: new Types.ObjectId(), sectionId: w.sectionId, classId: w.classId, state: "GIVEN",
    stateDates: [], dueDate: opts.due ?? opts.given ?? SUN, chaseCount: 0, topupFlag: false, topupQids: [], issuedBy: new Types.ObjectId(teacher),
  });
  const paper = await MasteryPaper.create({
    paperId: `MP-HW-${seq}`, source: "HW", sectionId: w.sectionId, classId: w.classId, academicYearId: opts.year ?? yearT2,
    classToken: "C3", subject: "MATH", date: new Date("2026-11-08T00:00:00Z"), links: { hwItemId: item._id }, trackerLinked: true,
    items: [{ itemNo: 1, origin: "BANK", marks: 2 }], entryState: opts.confirmed ? "CONFIRMED" : "OPEN",
  });
  await HomeworkItem.updateOne({ _id: item._id }, { $set: { paperId: paper._id } });
  return { itemId: String(item._id), paperId: String(paper._id), code: item.hwId };
}

/** An assignment handed in on Sunday with its linked, still-OPEN AS paper (deadline: Tuesday). */
async function asPaper(teacher: string): Promise<Made> {
  seq += 1;
  const w = await where();
  const item = await AssignmentItem.create({
    asId: `AS-C3-MATH-${String(seq).padStart(4, "0")}`, academicYearId: new Types.ObjectId(), scheduleEntryId: new Types.ObjectId(),
    weekNumber: seq, cycleWeek: 1, classId: w.classId, classLevel: 3, sectionId: w.sectionId, subject: "MATH",
    teacherId: new Types.ObjectId(teacher), deliveryDate: new Date(2026, 10, 5), dueDate: SUN, estMinutes: 20, status: "ISSUED",
    deliveredBy: new Types.ObjectId(teacher), deliveredAt: at("10:00", "2026-11-05"),
  });
  const paper = await MasteryPaper.create({
    paperId: `MP-AS-${seq}`, source: "AS", sectionId: w.sectionId, classId: w.classId, academicYearId: yearT2, classToken: "C3",
    subject: "MATH", date: new Date("2026-11-05T00:00:00Z"), links: { asItemId: item._id }, trackerLinked: true,
    items: [{ itemNo: 1, origin: "BANK", marks: 2 }], entryState: "OPEN",
  });
  return { itemId: String(item._id), paperId: String(paper._id), code: item.asId };
}

const confirm = (paperId: string, by: string) =>
  MasteryPaper.updateOne({ _id: paperId }, { $set: { entryState: "CONFIRMED", confirmedAt: new Date(), confirmedBy: new Types.ObjectId(by) } });
const lateIds = async (now: Date) => (await latePapers(now)).map((l) => l.itemId).sort();
const MARKS_KINDS = ["HOMEWORK_MARKS_LATE", "ASSIGNMENT_MARKS_LATE"];
const notes = (refKey: string) => StaffMistakeNote.find({ kind: { $in: MARKS_KINDS }, refKey }).lean();

describe("AC-R1 - switch OFF: the 2026 ladder is untouched", () => {
  it("an unconfirmed paper past its deadline is invisible: no late list, no pop-up item, no snapshot, no mistake", async () => {
    await setLoop(false);
    const t = await user("Rahima");
    await user("Office", "OFFICE");
    await hwPaper(t);
    await asPaper(t);
    const now = at("09:30", D.wed);
    expect(await latePapers(now)).toEqual([]);
    expect(await myMarkReminder(t, now)).toBeNull();
    expect(await runMarkEscalation(now)).toBe(0);
    expect(await MarkEscalation.countDocuments({})).toBe(0);
    expect(await StaffMistakeNote.countDocuments({})).toBe(0);
  });
});

describe("homework: same-day deadline", () => {
  it("not late on the day it came in, late the next day; confirmed (by anyone) = never late", async () => {
    const t = await user("Rahima");
    const sub = await user("Sub");
    const a = await hwPaper(t);
    const b = await hwPaper(t);
    expect(await lateIds(at("18:00", D.sun))).toEqual([]); // the deadline day itself
    expect(await lateIds(at("09:30", D.mon))).toEqual([a.itemId, b.itemId].sort());
    await confirm(b.paperId, sub); // a substitute who marked it counts (AC-S2)
    expect(await lateIds(at("09:30", D.mon))).toEqual([a.itemId]);
    const late = (await latePapers(at("09:30", D.mon)))[0]!;
    expect(late).toMatchObject({ tracker: "HOMEWORK", code: a.code, teacherIds: [t], deadlineKey: D.sun });
  });

  it("a declared (not issued) homework and a hand-made (not tracker-linked) paper are never late", async () => {
    const t = await user("Rahima");
    const a = await hwPaper(t);
    await HomeworkItem.updateOne({ _id: a.itemId }, { $set: { status: "declared" } });
    const b = await hwPaper(t);
    await MasteryPaper.updateOne({ _id: b.paperId }, { $unset: { trackerLinked: 1 } });
    expect(await lateIds(at("09:30", D.mon))).toEqual([]);
  });

  it("one reminder per teacher per day: both late papers ride one pop-up; NINE then the ack ends the day", async () => {
    const t = await user("Rahima");
    const other = await user("Other");
    const a = await hwPaper(t);
    const b = await hwPaper(t);
    const r = await myMarkReminder(t, at("07:30", D.mon));
    expect(r?.stage).toBe("MORNING");
    expect(r?.items.map((i) => [i.asItemId, i.stage, i.tracker, i.marked]).sort()).toEqual(
      [[a.itemId, "MARKS", "HOMEWORK", false], [b.itemId, "MARKS", "HOMEWORK", false]].sort(),
    );
    expect(await myMarkReminder(other, at("07:30", D.mon))).toBeNull();
    expect((await myMarkReminder(t, at("09:05", D.mon)))?.stage).toBe("NINE");
    await acknowledgeMarkReminder(t, "NINE", at("09:06", D.mon));
    expect(await myMarkReminder(t, at("10:00", D.mon))).toBeNull();
    // tomorrow it rings again while the paper is still open
    expect((await myMarkReminder(t, at("07:30", D.tue)))?.stage).toBe("MORNING");
    await confirm(a.paperId, t);
    await confirm(b.paperId, t);
    expect(await myMarkReminder(t, at("07:30", D.wed))).toBeNull();
  });
});

describe("assignment: Tuesday deadline", () => {
  it("not late on Tuesday, late on Wednesday", async () => {
    const t = await user("Rahima");
    const a = await asPaper(t);
    expect(await lateIds(at("09:30", D.mon))).toEqual([]);
    expect(await lateIds(at("09:30", D.tue))).toEqual([]);
    expect(await lateIds(at("09:30", D.wed))).toEqual([a.itemId]);
    expect((await latePapers(at("09:30", D.wed)))[0]).toMatchObject({ tracker: "ASSIGNMENT", deadlineKey: D.tue });
  });

  it("the policy day moves it: asMarkDeadlineDow 1 (Monday) makes Tuesday late", async () => {
    const t = await user("Rahima");
    const a = await asPaper(t);
    await savePolicy(null, null, { asMarkDeadlineDow: 1 }, PRINCIPAL);
    expect(await lateIds(at("09:30", D.tue))).toEqual([a.itemId]);
  });
});

describe("AC-S2 - approved leave moves the deadline to the first school day back", () => {
  it("leave Sun-Mon: not late Mon or Tue, late Wed; a leave that starts after the deadline changes nothing", async () => {
    const t = await user("Rahima");
    const a = await hwPaper(t);
    const profileId = new Types.ObjectId();
    mockProfile.mockResolvedValue({ _id: profileId });
    const leave = (fromKey: string, toKey: string, status = "approved") =>
      StaffLeaveApplication.collection.insertOne({
        staffProfileId: profileId, status, fromKey, toKey, leaveType: "casual", dayPart: "full", days: 2, reason: "x", appliedBy: new Types.ObjectId(),
      });
    await leave(D.sun, D.mon, "pending"); // a pending leave excuses nobody
    expect(await lateIds(at("09:30", D.mon))).toEqual([a.itemId]);
    await StaffLeaveApplication.deleteMany({});
    await leave(D.sun, D.mon);
    expect(await lateIds(at("09:30", D.mon))).toEqual([]);
    expect(await lateIds(at("09:30", D.tue))).toEqual([]); // the first school day back is itself still on time
    expect(await lateIds(at("09:30", D.wed))).toEqual([a.itemId]);
    await StaffLeaveApplication.deleteMany({});
    await leave(D.mon, D.tue); // leave starts AFTER the Sunday deadline
    expect(await lateIds(at("09:30", D.mon))).toEqual([a.itemId]);
  });
});

describe("AC-P1 - pauses (D-#1655)", () => {
  const pause = (pauses: string[], fromKey: string, toKey: string) =>
    AcademicPause.create({ fromKey, toKey, pauses, label: "t", active: true, createdBy: new Types.ObjectId() } as never);

  it("HOMEWORK_REQUIRED silences the homework stage (not the assignment one); paused days do not count", async () => {
    const t = await user("Rahima");
    const hw = await hwPaper(t);
    const as = await asPaper(t);
    await pause(["HOMEWORK_REQUIRED"], D.sun, D.mon);
    expect(await lateIds(at("09:30", D.mon))).toEqual([]);
    expect(await lateIds(at("09:30", D.tue))).toEqual([]); // first unpaused day is still on time
    expect(await lateIds(at("09:30", D.wed))).toEqual([as.itemId, hw.itemId].sort()); // as: Tuesday has passed
  });

  it("ASSIGNMENT_CHASE silences the assignment stage and leaves homework alone", async () => {
    const t = await user("Rahima");
    const hw = await hwPaper(t);
    const as = await asPaper(t);
    await pause(["ASSIGNMENT_CHASE"], D.wed, D.wed);
    expect(await lateIds(at("09:30", D.wed))).toEqual([hw.itemId]);
    expect(await lateIds(at("09:30", D.thu))).toEqual([as.itemId, hw.itemId].sort());
  });
});

describe("AC-E3 - an ABSENT_REDELIVER child never holds a paper late", () => {
  it("a confirmed paper with a child still on ABSENT_REDELIVER is not late (the check is per paper)", async () => {
    const t = await user("Rahima");
    const a = await hwPaper(t, { confirmed: true });
    const item = await HomeworkItem.findById(a.itemId).lean();
    await HomeworkStudentRecord.collection.insertOne({
      hwItemId: item!._id, hwId: item!.hwId, studentId: new Types.ObjectId(), sectionId: item!.sectionId, classId: item!.classId,
      state: "ABSENT_REDELIVER", stateDates: [], chaseCount: 0, topupFlag: false, topupQids: [], issuedBy: new Types.ObjectId(t),
    });
    expect(await lateIds(at("09:30", D.mon))).toEqual([]);
    expect(await runMarkEscalation(at("09:30", D.mon))).toBe(0);
  });
});

describe("AC-M1 / R30 - the 09:30 list, then the quiet mistake record only from term 2", () => {
  it("term 2: snapshot row (stage MARKS) + ONE quiet mistake row per teacher x paper, never repeated", async () => {
    const t = await user("Rahima");
    const office = await user("Office", "OFFICE");
    const a = await hwPaper(t, { year: yearT2 });
    expect(await runMarkEscalation(at("09:30", D.mon))).toBeGreaterThanOrEqual(0);
    const snap = await markEscalationFor(D.mon);
    expect(snap?.rows).toHaveLength(1);
    expect(snap?.rows[0]).toMatchObject({ asItemId: a.itemId, stage: "MARKS", tracker: "HOMEWORK", markedNow: false, teacherNames: ["Rahima"] });
    const mine = await myMarkEscalation(office, at("09:31", D.mon));
    expect(mine?.rows[0]?.stage).toBe("MARKS");
    const refKey = `AL9:HOMEWORK:${a.itemId}`;
    expect(await notes(refKey)).toHaveLength(1);
    expect(await StaffMistake.countDocuments({ kind: "HOMEWORK_MARKS_LATE", staffUserId: new Types.ObjectId(t) })).toBe(1);
    // quiet: the teacher is told nothing about it (D-#1020)
    expect(await Notification.countDocuments({ recipientUserId: new Types.ObjectId(t) })).toBe(0);
    // the next day lists it again but writes no second row
    await runMarkEscalation(at("09:30", D.tue));
    expect(await notes(refKey)).toHaveLength(1);
    // marking it later flips the live flag and the day picker's open count
    await confirm(a.paperId, t);
    expect((await markEscalationFor(D.mon))?.rows[0]?.markedNow).toBe(true);
    const days = await markEscalationDays();
    expect(days.find((d) => d.dateKey === D.mon)).toMatchObject({ itemCount: 1, openCount: 0 });
  });

  it("term 1: the list and the Principal's alert, but NO mistake row", async () => {
    const t = await user("Rahima");
    const office = await user("Office", "OFFICE");
    const a = await hwPaper(t, { year: yearT1 });
    await runMarkEscalation(at("09:30", D.mon));
    expect((await markEscalationFor(D.mon))?.rows.map((r) => r.asItemId)).toEqual([a.itemId]);
    expect(await Notification.countDocuments({ recipientUserId: new Types.ObjectId(office), kind: "MARK_SUBMISSION_ESCALATION" })).toBe(1);
    expect(await StaffMistakeNote.countDocuments({})).toBe(0);
    expect(await StaffMistake.countDocuments({})).toBe(0);
  });

  it("lateMarksMistakeFromTerm 3 keeps even term 2 clean; 1 makes term 1 write a row", async () => {
    const t = await user("Rahima");
    await user("Office", "OFFICE");
    const a = await hwPaper(t, { year: yearT2 });
    await savePolicy(null, null, { lateMarksMistakeFromTerm: 3 }, PRINCIPAL);
    await runMarkEscalation(at("09:30", D.mon));
    expect(await StaffMistakeNote.countDocuments({})).toBe(0);
    await savePolicy(null, null, { lateMarksMistakeFromTerm: 1 }, PRINCIPAL);
    await runMarkEscalation(at("09:30", D.tue));
    expect(await notes(`AL9:HOMEWORK:${a.itemId}`)).toHaveLength(1);
  });

  it("nothing late = nothing written; a late paper is one MARKS row in the snapshot", async () => {
    const t = await user("Rahima");
    await user("Office", "OFFICE");
    expect(await runMarkEscalation(at("09:30", D.mon))).toBe(0);
    expect(await MarkEscalation.countDocuments({})).toBe(0);
    await hwPaper(t);
    await runMarkEscalation(at("09:30", D.mon));
    const doc = await MarkEscalation.findOne({ dateKey: D.mon }).lean();
    expect(doc?.rows.map((r) => r.stage ?? "RECORDS")).toEqual(["MARKS"]);
  });
});

// ---------------------------------------------------------------------------
// Review round: the homework clock, closed days, stage-keyed flags, quiet record, fallbacks
// ---------------------------------------------------------------------------
const THU = new Date(2026, 10, 12);
const MON = new Date(2026, 10, 9);
const D2 = { fri: "2026-11-13", sat: "2026-11-14", sun2: "2026-11-15", mon2: "2026-11-16" };

describe("homework deadline starts the day it COMES IN (the records due date), not the day it was given", () => {
  it("given Sunday, due Monday: not late Monday, late Tuesday", async () => {
    const t = await user("Rahima");
    const a = await hwPaper(t, { given: SUN, due: MON });
    expect(await lateIds(at("09:30", D.mon))).toEqual([]);
    expect(await lateIds(at("09:30", D.tue))).toEqual([a.itemId]);
    expect((await latePapers(at("09:30", D.tue)))[0]).toMatchObject({ deadlineKey: D.mon });
  });

  it("given Thursday, due Sunday: not late Fri / Sat (closed) nor Sunday itself; late Monday", async () => {
    const t = await user("Rahima");
    const a = await hwPaper(t, { given: THU, due: new Date(2026, 10, 15) });
    expect(await lateIds(at("09:30", D2.fri))).toEqual([]);
    expect(await lateIds(at("09:30", D2.sat))).toEqual([]);
    expect(await lateIds(at("09:30", D2.sun2))).toEqual([]);
    expect(await lateIds(at("09:30", D2.mon2))).toEqual([a.itemId]);
  });

  it("hwMarkDeadlineDays 1 adds one OPEN day after the due day", async () => {
    const t = await user("Rahima");
    const a = await hwPaper(t);
    await savePolicy(null, null, { hwMarkDeadlineDays: 1 }, PRINCIPAL);
    expect(await lateIds(at("09:30", D.mon))).toEqual([]);
    expect(await lateIds(at("09:30", D.tue))).toEqual([a.itemId]);
  });
});

describe("the marks stage is silent on a closed day (lead decision)", () => {
  it("Friday / Saturday: no late list, no snapshot, no teacher pop-up; Sunday it is back", async () => {
    const t = await user("Rahima");
    await user("Office", "OFFICE");
    const a = await hwPaper(t);
    expect(await lateIds(at("09:30", D.thu))).toEqual([a.itemId]);
    for (const day of [D2.fri, D2.sat]) {
      expect(await latePapers(at("09:30", day))).toEqual([]);
      expect(await runMarkEscalation(at("09:30", day))).toBe(0);
      expect(await MarkEscalation.countDocuments({ dateKey: day })).toBe(0);
      expect(await myMarkReminder(t, at("07:30", day))).toBeNull();
    }
    expect(await lateIds(at("09:30", D2.sun2))).toEqual([a.itemId]);
  });
});

describe("the snapshot open flag is keyed by stage + id", () => {
  it("one id in both stages: confirming the paper flips only the MARKS row", async () => {
    const t = await user("Rahima");
    const a = await asPaper(t);
    const item = await AssignmentItem.findById(a.itemId).lean();
    await AssignmentStudentRecord.collection.insertOne({
      asItemId: item!._id, asId: item!.asId, studentId: new Types.ObjectId(), sectionId: item!.sectionId, classId: item!.classId,
      state: "GIVEN", stateDates: [], chaseCount: 0, issuedBy: new Types.ObjectId(t),
    });
    const base = { asItemId: item!._id, asId: item!.asId, sectionId: item!.sectionId, subject: "MATH", teacherIds: [new Types.ObjectId(t)] };
    await MarkEscalation.collection.insertOne({
      dateKey: D.wed, createdAt: new Date(),
      rows: [{ ...base }, { ...base, stage: "MARKS", tracker: "ASSIGNMENT", paperId: new Types.ObjectId(a.paperId) }],
    });
    const before = (await markEscalationFor(D.wed))!.rows;
    expect(before.map((r) => [r.stage, r.markedNow])).toEqual([["RECORDS", false], ["MARKS", false]]);
    await confirm(a.paperId, t);
    const after = (await markEscalationFor(D.wed))!.rows;
    expect(after.map((r) => [r.stage, r.markedNow])).toEqual([["RECORDS", false], ["MARKS", true]]);
    expect((await markEscalationDays())[0]).toMatchObject({ itemCount: 2, openCount: 1 });
  });
});

describe("the AL-9 mistake row: its own kinds, quiet, leave read on the deadline day", () => {
  it("homework -> HOMEWORK_MARKS_LATE, assignment -> ASSIGNMENT_MARKS_LATE; a teacher holding view_own is told nothing and asked nothing", async () => {
    const t = await user("Rahima", "TEACHER", ["staff_mistakes:view_own"]);
    await user("Office", "OFFICE");
    const h = await hwPaper(t);
    const a = await asPaper(t);
    await runMarkEscalation(at("09:30", D.wed));
    expect((await notes(`AL9:HOMEWORK:${h.itemId}`))[0]?.kind).toBe("HOMEWORK_MARKS_LATE");
    expect((await notes(`AL9:ASSIGNMENT:${a.itemId}`))[0]?.kind).toBe("ASSIGNMENT_MARKS_LATE");
    const rows = await StaffMistake.find({ staffUserId: new Types.ObjectId(t) }).lean();
    expect(rows.map((r) => [r.kind, r.status]).sort()).toEqual([["ASSIGNMENT_MARKS_LATE", "COUNTED"], ["HOMEWORK_MARKS_LATE", "COUNTED"]]);
    expect(await Notification.countDocuments({ recipientUserId: new Types.ObjectId(t) })).toBe(0);
  });

  it("an approved leave AFTER the deadline does not excuse the row (the leave is read on the deadline day, not today)", async () => {
    const t = await user("Rahima");
    await user("Office", "OFFICE");
    await hwPaper(t);
    const profileId = new Types.ObjectId();
    mockProfile.mockResolvedValue({ _id: profileId });
    await StaffLeaveApplication.collection.insertOne({
      staffProfileId: profileId, status: "approved", fromKey: D.tue, toKey: D.wed, leaveType: "casual", dayPart: "full", days: 2, reason: "x", appliedBy: new Types.ObjectId(),
    });
    await runMarkEscalation(at("09:30", D.wed)); // today is on leave, the Sunday deadline was not
    const row = await StaffMistake.findOne({ kind: "HOMEWORK_MARKS_LATE", staffUserId: new Types.ObjectId(t) }).lean();
    expect(row?.status).toBe("COUNTED");
    expect((await latePapers(at("09:30", D.wed)))[0]?.effectiveKeys[t]).toBe(D.sun);
  });
});

describe("the late-paper read can never break the 2026 RECORDS path", () => {
  it("a throw reads as nothing late: the records row is still snapshotted and the pop-up still shows it", async () => {
    const t = await user("Rahima");
    await user("Office", "OFFICE");
    const a = await asPaper(t); // its Sunday records are GIVEN -> the 2026 stage
    const item = await AssignmentItem.findById(a.itemId).lean();
    await AssignmentStudentRecord.collection.insertOne({
      asItemId: item!._id, asId: item!.asId, studentId: new Types.ObjectId(), sectionId: item!.sectionId, classId: item!.classId,
      state: "GIVEN", stateDates: [], chaseCount: 0, issuedBy: new Types.ObjectId(t),
    });
    const spy = latePapers as unknown as jest.Mock;
    spy.mockRejectedValueOnce(new Error("boom"));
    expect((await myMarkReminder(t, at("07:30", D.sun)))?.items.map((i) => i.stage ?? "RECORDS")).toEqual(["RECORDS"]);
    spy.mockRejectedValueOnce(new Error("boom"));
    expect(await runMarkEscalation(at("09:30", D.sun))).toBeGreaterThanOrEqual(0);
    expect((await MarkEscalation.findOne({ dateKey: D.sun }).lean())?.rows).toHaveLength(1);
  });
});

describe("a missing academic year reads as term 1 for late marks (no mistake row); the integrity default stays term 2", () => {
  it("termOfDate", async () => {
    const ghost = new Types.ObjectId();
    expect(await termOfDate(ghost, at("09:30", D.mon))).toBe(1);
    expect(await termOfDate(ghost, at("09:30", D.mon), new Map(), 2)).toBe(2);
    expect(await termOfDate(yearT2, at("09:30", D.mon))).toBe(2);
  });

  it("a paper whose year is gone writes no mistake row", async () => {
    const t = await user("Rahima");
    await user("Office", "OFFICE");
    await hwPaper(t, { year: new Types.ObjectId() });
    await runMarkEscalation(at("09:30", D.mon));
    expect(await MarkEscalation.countDocuments({})).toBe(1);
    expect(await StaffMistakeNote.countDocuments({})).toBe(0);
  });
});

describe("polling: the live-clock reminder reads the late papers once per 30 s, an explicit clock always fresh", () => {
  it("two live polls = one read; explicit times are never cached", async () => {
    const t = await user("Rahima");
    await hwPaper(t);
    const spy = latePapers as unknown as jest.Mock;
    await myMarkReminder(t);
    await myMarkReminder(t);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await myMarkReminder(t, at("07:30", D.mon));
    await myMarkReminder(t, at("07:31", D.mon));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
