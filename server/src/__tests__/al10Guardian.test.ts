/**
 * AL-10 — the guardian side of the 2027 loop (docs/prd-academic-loop-2027.md §5 B5/B9/D5/E1-E3, R11, R13, R31, R32;
 * D-#1674; ACs AC-B6, AC-B18, AC-D3, AC-D5, AC-E1).
 *
 *  - hints reach the questions of a CLASS homework paper (the text as printed), one step at a time, never an answer
 *  - GWSUM: ONE message PER CHILD per guardian (marks + level words + topics + what to practise), a child with no confirmed
 *    marks that week gets nothing, a re-run sends nothing new, the dedupe key carries week + child + guardian; the D-#452
 *    digest key is a different key
 *  - "ক্লাস মিস": a missed objective with no evidence since the missed day; the normal state after the first evidence
 *  - release switch OFF: no message, no card, no "ক্লাস মিস" (AC-R1)
 *  - no guardian type gains an answer field; no rank, no other child, no শাখা average (AC-D3)
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { GraphQLObjectType, graphql, type ExecutionResult, type GraphQLSchema } from "graphql";

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../modules/trackers/models/HomeworkStudentRecord";
import { AssignmentItem } from "../modules/trackers/models/AssignmentItem";
import { AssignmentStudentRecord } from "../modules/trackers/models/AssignmentStudentRecord";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { MasteryEvidence } from "../modules/mastery/models/MasteryEvidence";
import { MasteryPolicy } from "../modules/mastery/models/MasteryPolicy";
import { MasteryEnablement } from "../modules/mastery/models/MasteryEnablement";
import { QuestionHint } from "../modules/guardian-help/models/QuestionHint";
import { HolidayException } from "../modules/routine/models/HolidayException";
import { Notification } from "../modules/notifications/models/Notification";
import { savePolicy } from "../modules/mastery/services/MasteryCatalogueService";
import { childAssignedQuestions, openQuestionHint } from "../modules/guardian-help/services/GuardianHintService";
import { CLASS_MISSED_STATES, classMissedCodes, isClassMissed } from "../modules/mastery/classMissed";
import { GuardianSummaryRun } from "../modules/mastery/models/GuardianSummaryRun";
import {
  buildWeeklyBody,
  childWeeklySummary,
  guardianSummaryReady,
  lastDueSlot,
  runGuardianWeeklySummary,
  schoolWeekOf,
  totalsBySubject,
  type ChildWeeklySummary,
} from "../modules/mastery/services/GuardianWeeklySummaryService";
import { childMasteryProgress } from "../modules/mastery/services/MasteryGuardianService";
import { childAssignments } from "../modules/trackers/services/AssignmentSummaryService";
import { builder } from "../schema";
import "../modules/mastery/resolvers/masteryGuardian";
import "../modules/guardian-help/resolvers/questionHints";
import "../modules/lesson-progress/resolvers/lessonObjectives";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
let yearId = new Types.ObjectId();
let classId = new Types.ObjectId();
let sectionId = new Types.ObjectId();
let sidA = "";
let sidB = "";
let sidC = "";
let gBoth = ""; // linked to A and B
let gOnlyA = "";
const setLoop = (on: boolean) => savePolicy(null, null, { academicLoop2027On: on }, PRINCIPAL);
const WED = new Date(2027, 0, 13, 18, 5); // Wed 13 Jan 2027, 18:05 local — the Sunday of its week is 10 Jan
const WEEK = "2027-01-10";
const at = (day: string) => new Date(`${day}T10:00:00+06:00`);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  yearId = year!._id as Types.ObjectId;
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: yearId }]);
  classId = cls!._id as Types.ObjectId;
  const [sec] = await Section.create([{ classId, code: "B", nameBn: "বালক" }]);
  sectionId = sec!._id as Types.ObjectId;
  const mk = async (n: number) => String((await Student.create([{ schoolId: `AL10-${n}`, name: `Child ${n}`, rollNumber: String(n), classId, sectionId, active: true }]))[0]!._id);
  sidA = await mk(1);
  sidB = await mk(2);
  sidC = await mk(3);
  const [g1] = await Guardian.create([{ identifierKind: "phone", identifier: "01700000101", phone: "01700000101", name: "Both", loginEnabled: true, active: true }]);
  const [g2] = await Guardian.create([{ identifierKind: "phone", identifier: "01700000102", phone: "01700000102", name: "OnlyA", loginEnabled: true, active: true }]);
  gBoth = String(g1!._id);
  gOnlyA = String(g2!._id);
  await GuardianLink.create([
    { guardianId: g1!._id, studentId: new Types.ObjectId(sidA), relation: "FATHER" },
    { guardianId: g1!._id, studentId: new Types.ObjectId(sidB), relation: "FATHER" },
    { guardianId: g2!._id, studentId: new Types.ObjectId(sidA), relation: "MOTHER" },
  ]);
  await MasteryEnablement.create([{ academicYearId: yearId, classToken: "C3", subject: "MATH", enabled: true }]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

let seq = 0;
/** A homework item with one record per child, CHECKED at `checkedAt` with the given marks. */
async function hwWithMarks(subject: "MATH" | "BAN", checkedAt: Date, marks: Record<string, [number, number]>): Promise<void> {
  seq += 1;
  const item = await HomeworkItem.create({
    hwId: `HW-C3-${subject}-${String(seq).padStart(4, "0")}`, academicYearId: yearId, classId, classLevel: 3, sectionId, subject,
    dateGiven: new Date(2027, 1, seq), topTags: ["PRACTICE"], qCount: 1, status: "issued", declaredBy: new Types.ObjectId(),
  });
  for (const [sid, [earned, available]] of Object.entries(marks)) {
    await HomeworkStudentRecord.collection.insertOne({
      hwItemId: item._id, hwId: item.hwId, studentId: new Types.ObjectId(sid), sectionId, classId, state: "CHECKED",
      stateDates: [{ state: "CHECKED", at: checkedAt }], chaseCount: 0, topupFlag: false, topupQids: [], issuedBy: new Types.ObjectId(),
      earnedMarks: earned, availableMarks: available,
    });
  }
}
async function asWithMarks(subject: "MATH" | "BAN", checkedAt: Date, marks: Record<string, [number, number]>): Promise<void> {
  seq += 1;
  const item = await AssignmentItem.create({
    asId: `AS-C3-${subject}-${String(seq).padStart(4, "0")}`, academicYearId: yearId, scheduleEntryId: new Types.ObjectId(), weekNumber: seq, cycleWeek: 1,
    classId, classLevel: 3, sectionId, subject, teacherId: new Types.ObjectId(), deliveryDate: new Date(2027, 0, 7), dueDate: new Date(2027, 0, 10),
    estMinutes: 20, status: "ISSUED", deliveredBy: new Types.ObjectId(), deliveredAt: new Date(2027, 0, 7),
  });
  for (const [sid, [earned, available]] of Object.entries(marks)) {
    await AssignmentStudentRecord.collection.insertOne({
      asItemId: item._id, asId: item.asId, studentId: new Types.ObjectId(sid), sectionId, classId, state: "CHECKED",
      stateDates: [{ state: "CHECKED", at: checkedAt }], chaseCount: 0, issuedBy: new Types.ObjectId(), marks: earned, availableMarks: available,
    });
  }
}

describe("pure rules", () => {
  it("isClassMissed: needs MISSED and no evidence on / after the first missed day", () => {
    const l = { status: "MISSED", absentOn: ["2027-01-12", "2027-01-05"] };
    expect(isClassMissed(l, [])).toBe(true);
    expect(isClassMissed(l, ["2027-01-04"])).toBe(true); // before the missed day - does not count
    expect(isClassMissed(l, ["2027-01-05"])).toBe(false); // the first confirmed item on / after it
    expect(isClassMissed({ status: "TAUGHT", absentOn: [] }, [])).toBe(false);
    expect(isClassMissed({ status: "UNKNOWN", absentOn: [] }, [])).toBe(false);
    expect(isClassMissed({ status: "MISSED", absentOn: [] }, [])).toBe(false);
  });

  it("schoolWeekOf: the Sun-Sat week, keyed by its Sunday", () => {
    expect(schoolWeekOf(WED).weekKey).toBe(WEEK);
    expect(schoolWeekOf(new Date(2027, 0, 10, 8)).weekKey).toBe(WEEK); // Sunday itself
    expect(schoolWeekOf(new Date(2027, 0, 16, 8)).weekKey).toBe(WEEK); // Saturday
    expect(schoolWeekOf(new Date(2027, 0, 17, 8)).weekKey).toBe("2027-01-17");
  });

  it("totalsBySubject sums per subject in subject order (never by marks: no ranking); zero-available rows drop out", () => {
    expect(totalsBySubject([
      { subject: "MATH", earned: 4, available: 5 }, { subject: "BAN", earned: 3, available: 5 }, { subject: "MATH", earned: 4, available: 5 },
      { subject: "ENG", earned: 0, available: 0 },
    ])).toEqual([{ subject: "BAN", earned: 3, available: 5 }, { subject: "MATH", earned: 8, available: 10 }]);
  });

  it("the weekly body: marks + level word, kind lines, no rank / other child / average / answer wording (AC-D3, AC-B6)", () => {
    const s: ChildWeeklySummary = {
      studentId: "x", weekKey: WEEK,
      subjects: [{
        subject: "MATH", subjectBn: "গণিত", earned: 8, available: 10, pct: 80, levelBn: "ভালো",
        attentionBn: ["ভাগ"], improvingBn: ["যোগ"], practiseBn: ["ভাগ — রোজ একটি করে অঙ্ক করুন"], classMissedBn: ["গুণ"],
      }],
    };
    const body = buildWeeklyBody("Child 1", s);
    expect(body).toContain("গণিত — ৮/১০ — ভালো");
    expect(body).toContain("ক্লাস মিস");
    expect(body).toContain("ধন্যবাদ");
    expect(body).not.toMatch(/র‍্যাঙ্ক|ranking|গড়|average|অন্য শিক্ষার্থী|দুর্বল|উত্তর:/i);
    expect(body.length).toBeLessThanOrEqual(900);
    // a very long list is clamped, never silently dropped mid-word
    const long = buildWeeklyBody("Child 1", { ...s, subjects: Array.from({ length: 12 }, (_, i) => ({ ...s.subjects[0]!, subject: `S${i}`, practiseBn: ["ক".repeat(120)] })) });
    expect(long.length).toBeLessThanOrEqual(900);
  });
});

describe("hints reach class homework papers (B5)", () => {
  it("the paper's questions show as printed, hints one step at a time, never an answer; only the child with a record sees them", async () => {
    await ContentArtifact.create([{
      docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 }, curationTag: "KEEP_AS_IS", current: true,
      importedBy: new Types.ObjectId(), reviewStatus: "gold",
      envelopeJson: { payload: { qid: "Q-AL10-0001", question_text: "ব্যাংকের লেখা", options: [{ text: "পাঁচ", is_correct: true }, { text: "সাত", is_correct: false }] } },
    }]);
    await QuestionHint.create([{
      qid: "Q-AL10-0001", classToken: "C3", subject: "MATH", language: "bn", source: "agent", version: 1, updatedBy: new Types.ObjectId(),
      steps: [{ n: 1, textBn: "প্রশ্নটি পড়ো।" }, { n: 2, textBn: "কী চাওয়া হয়েছে?" }, { n: 3, textBn: "যেমন: ২ + ২ — চার।" }],
    }]);
    const item = await HomeworkItem.create({
      hwId: "HW-C3-MATH-9001", academicYearId: yearId, classId, classLevel: 3, sectionId, subject: "MATH", dateGiven: new Date("2027-01-11T00:00:00.000Z"),
      topTags: ["t"], timeDecl: 10, qCount: 1, selectedQids: [], declaredBy: new Types.ObjectId(), status: "issued",
    });
    const paper = await MasteryPaper.create({
      paperId: "MP-AL10-HW1", source: "HW", sectionId, classId, academicYearId: yearId, classToken: "C3", subject: "MATH", date: new Date("2027-01-11T00:00:00.000Z"),
      links: { hwItemId: item._id }, extra: false,
      items: [
        { itemNo: 1, origin: "BANK", qid: "Q-AL10-0001", textBn: "ছাপা প্রশ্ন: ১২ ÷ ৩ কত?", marks: 2 },
        { itemNo: 2, origin: "TEACHER", textBn: "শিক্ষকের নিজের প্রশ্ন", marks: 1 },
      ],
    });
    await HomeworkItem.updateOne({ _id: item._id }, { $set: { paperId: paper._id } });
    await HomeworkStudentRecord.create([{ hwItemId: item._id, hwId: item.hwId, studentId: new Types.ObjectId(sidA), sectionId, classId, state: "GIVEN", issuedBy: new Types.ObjectId() }]);

    const a = await childAssignedQuestions(gOnlyA, sidA);
    expect(a.map((q) => q.qid)).toEqual(["Q-AL10-0001"]); // the teacher's own question has no bank id → no hints, not listed
    expect(a[0]).toMatchObject({ source: "HOMEWORK", subject: "MATH", textBn: "ছাপা প্রশ্ন: ১২ ÷ ৩ কত?", hintCount: 3, opened: [] });
    expect(JSON.stringify(a)).not.toMatch(/is_correct|পাঁচ/);
    expect(await childAssignedQuestions(gBoth, sidB)).toEqual([]); // B has no record for it
    await expect(openQuestionHint(gBoth, sidB, "Q-AL10-0001", 1)).rejects.toThrow(/দেওয়া হয়নি/);
    await expect(openQuestionHint(gOnlyA, sidA, "Q-AL10-0001", 2)).rejects.toThrow(/আগের ইঙ্গিত/);
    const s1 = await openQuestionHint(gOnlyA, sidA, "Q-AL10-0001", 1);
    expect(s1).toMatchObject({ step: 1, textBn: "প্রশ্নটি পড়ো।", hasNext: true });
    expect(Object.keys(s1).sort()).toEqual(["hasNext", "qid", "step", "textBn"]);
  });

  it("an EXTRA paper is not read as class homework (it has its own, per-child source)", async () => {
    const before = (await childAssignedQuestions(gOnlyA, sidA)).length;
    const item = await HomeworkItem.create({
      hwId: "HW-C3-MATH-9002", academicYearId: yearId, classId, classLevel: 3, sectionId, subject: "MATH", dateGiven: new Date("2027-01-12T00:00:00.000Z"),
      topTags: ["t"], timeDecl: 10, qCount: 1, selectedQids: [], declaredBy: new Types.ObjectId(), status: "issued",
    });
    const extra = await MasteryPaper.create({
      paperId: "MP-AL10-EXTRA", source: "HW", sectionId, classId, academicYearId: yearId, classToken: "C3", subject: "MATH", date: new Date("2027-01-12T00:00:00.000Z"),
      extra: true, perStudentItems: [{ studentId: new Types.ObjectId(sidB), itemNos: [1] }], links: {},
      items: [{ itemNo: 1, origin: "BANK", qid: "Q-AL10-EXTRA", textBn: "অন্য শিশুর", marks: 1 }],
    });
    await HomeworkItem.updateOne({ _id: item._id }, { $set: { paperId: extra._id } });
    await HomeworkStudentRecord.create([{ hwItemId: item._id, hwId: item.hwId, studentId: new Types.ObjectId(sidA), sectionId, classId, state: "GIVEN", issuedBy: new Types.ObjectId() }]);
    expect((await childAssignedQuestions(gOnlyA, sidA)).length).toBe(before);
  });
});

describe("GWSUM - the weekly message per child (D5, R31)", () => {
  beforeEach(async () => {
    await GuardianSummaryRun.deleteMany({});
    await Promise.all([Notification, HomeworkItem, HomeworkStudentRecord, AssignmentItem, AssignmentStudentRecord, HolidayException].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
    await setLoop(true);
  });

  const msgs = () => Notification.find({ kind: "GUARDIAN_WEEKLY_SUMMARY" }).sort({ createdAt: 1 }).lean();

  it("one message PER CHILD per guardian; a child with no confirmed marks this week gets nothing; a re-run adds nothing", async () => {
    // A: HW MATH 8/10 + AS BAN 3/5 this week; B: HW MATH 5/10 this week; C: marks only LAST week.
    await hwWithMarks("MATH", at("2027-01-11"), { [sidA]: [8, 10], [sidB]: [5, 10] });
    await asWithMarks("BAN", at("2027-01-12"), { [sidA]: [3, 5] });
    await hwWithMarks("MATH", at("2027-01-05"), { [sidC]: [9, 10] });
    const res = await runGuardianWeeklySummary(WED);
    // gBoth gets A and B (two messages), gOnlyA gets A (one); nothing for C.
    expect(res).toEqual({ students: 2, notified: 3 });
    const rows = await msgs();
    expect(rows).toHaveLength(3);
    const keys = rows.map((r) => r.dedupeKey).sort();
    expect(keys).toEqual([`GWS:${WEEK}:${sidA}:${gBoth}`, `GWS:${WEEK}:${sidA}:${gOnlyA}`, `GWS:${WEEK}:${sidB}:${gBoth}`].sort());
    const forA = rows.find((r) => r.dedupeKey === `GWS:${WEEK}:${sidA}:${gOnlyA}`)!;
    expect(forA.titleBn).toContain("Child 1");
    expect(forA.bodyBn).toContain("গণিত — ৮/১০ — ভালো"); // 80 %
    expect(forA.bodyBn).toContain("বাংলা — ৩/৫ — মোটামুটি"); // 60 %
    expect(forA.bodyBn).not.toContain("Child 2"); // never another child
    expect(forA.bodyBn).not.toContain("৫/১০");
    const forB = rows.find((r) => r.dedupeKey === `GWS:${WEEK}:${sidB}:${gBoth}`)!;
    expect(forB.bodyBn).toContain("গণিত — ৫/১০ — মোটামুটি");
    expect(rows.every((r) => r.kind === "GUARDIAN_WEEKLY_SUMMARY" && !String(r.dedupeKey).startsWith("HWWD:"))).toBe(true);
    // idempotent
    await runGuardianWeeklySummary(WED);
    expect(await msgs()).toHaveLength(3);
  });

  it("the window is since the PREVIOUS RUN: marks confirmed after a send go in the next message - nothing lost, nothing twice", async () => {
    await GuardianSummaryRun.deleteMany({});
    await hwWithMarks("MATH", at("2027-01-11"), { [sidA]: [8, 10] });
    const first = await runGuardianWeeklySummary(WED); // Wed 13 Jan 18:05
    expect(first).toEqual({ students: 1, notified: 2 }); // gBoth + gOnlyA for child A
    expect((await GuardianSummaryRun.findOne({ key: "GWSUM" }).lean())!.lastRunAt.getTime()).toBe(WED.getTime());
    // Thursday after the send: a homework confirmed, plus a second one on Saturday.
    await hwWithMarks("BAN", at("2027-01-14"), { [sidA]: [4, 5] });
    await asWithMarks("MATH", at("2027-01-16"), { [sidA]: [1, 2] });
    // a re-run on the same Wednesday (restart) finds an empty window: nothing twice
    expect(await runGuardianWeeklySummary(new Date(2027, 0, 13, 18, 20))).toEqual({ students: 0, notified: 0 });
    expect(await msgs()).toHaveLength(2);
    // next Wednesday: exactly the Thu/Sat marks, keyed by the NEW school week
    const next = new Date(2027, 0, 20, 18, 5);
    expect(await runGuardianWeeklySummary(next)).toEqual({ students: 1, notified: 2 });
    const rows = await msgs();
    expect(rows).toHaveLength(4);
    const later = rows.filter((r) => String(r.dedupeKey).startsWith("GWS:2027-01-17:"));
    expect(later).toHaveLength(2);
    expect(later[0]!.bodyBn).toContain("বাংলা — ৪/৫ — ভালো");
    expect(later[0]!.bodyBn).toContain("গণিত — ১/২ — মোটামুটি");
    expect(later[0]!.bodyBn).not.toContain("৮/১০"); // the earlier marks are not repeated
    // and the week after has nothing left to send
    expect(await runGuardianWeeklySummary(new Date(2027, 0, 27, 18, 5))).toEqual({ students: 0, notified: 0 });
    await GuardianSummaryRun.deleteMany({});
  });

  it("the first run reaches back one slot: from the previous due day and hour", () => {
    expect(lastDueSlot(WED, 3, 18).getTime()).toBe(new Date(2027, 0, 13, 18, 0).getTime());
    expect(lastDueSlot(new Date(2027, 0, 13, 17, 0), 3, 18).getTime()).toBe(new Date(2027, 0, 6, 18, 0).getTime());
    expect(lastDueSlot(new Date(2027, 0, 14, 18, 5), 3, 18).getTime()).toBe(new Date(2027, 0, 13, 18, 0).getTime()); // rolled Thursday
  });

  it("a week with no confirmed marks sends nothing at all", async () => {
    await hwWithMarks("MATH", at("2027-01-05"), { [sidA]: [8, 10] }); // last week
    expect(await runGuardianWeeklySummary(WED)).toEqual({ students: 0, notified: 0 });
    expect(await msgs()).toHaveLength(0);
  });

  it("a hand-checked record without a paper total (no availableMarks) is not a confirmed mark", async () => {
    seq += 1;
    const item = await HomeworkItem.create({
      hwId: `HW-C3-MATH-${seq}`, academicYearId: yearId, classId, classLevel: 3, sectionId, subject: "MATH", dateGiven: new Date(2027, 1, seq),
      topTags: ["PRACTICE"], qCount: 1, status: "issued", declaredBy: new Types.ObjectId(),
    });
    await HomeworkStudentRecord.collection.insertOne({
      hwItemId: item._id, hwId: item.hwId, studentId: new Types.ObjectId(sidA), sectionId, classId, state: "CHECKED",
      stateDates: [{ state: "CHECKED", at: at("2027-01-11") }], chaseCount: 0, topupFlag: false, topupQids: [], issuedBy: new Types.ObjectId(), result: "CORRECT",
    });
    expect(await runGuardianWeeklySummary(WED)).toEqual({ students: 0, notified: 0 });
  });

  it("the card reads the same content for one child; null with nothing confirmed", async () => {
    expect(await childWeeklySummary(sidA, WED)).toBeNull();
    await hwWithMarks("MATH", at("2027-01-11"), { [sidA]: [9, 10] });
    const c = await childWeeklySummary(sidA, WED);
    expect(c).toMatchObject({ studentId: sidA, weekKey: WEEK });
    expect(c!.subjects).toEqual([expect.objectContaining({ subject: "MATH", earned: 9, available: 10, pct: 90, levelBn: "খুব ভালো" })]);
    expect(await childWeeklySummary(sidB, WED)).toBeNull();
    expect(await childWeeklySummary("not-an-id", WED)).toBeNull();
  });

  it("AC-R1: with the release switch OFF nothing is sent and the card is empty", async () => {
    await hwWithMarks("MATH", at("2027-01-11"), { [sidA]: [8, 10] });
    await setLoop(false);
    expect(await guardianSummaryReady(WED)).toBe(false);
    expect(await runGuardianWeeklySummary(WED)).toEqual({ students: 0, notified: 0 });
    expect(await childWeeklySummary(sidA, WED)).toBeNull();
    expect(await msgs()).toHaveLength(0);
  });

  it("the gate: Wednesday from 18:00 only; a Thursday only when Wednesday was a holiday; policy day / hour are honoured", async () => {
    expect(await guardianSummaryReady(new Date(2027, 0, 13, 17, 59))).toBe(false);
    expect(await guardianSummaryReady(new Date(2027, 0, 13, 18, 0))).toBe(true);
    expect(await guardianSummaryReady(new Date(2027, 0, 12, 20, 0))).toBe(false); // Tuesday
    expect(await guardianSummaryReady(new Date(2027, 0, 14, 18, 0))).toBe(false); // Thursday, Wednesday was open
    expect(await guardianSummaryReady(new Date(2027, 0, 13, 22, 0))).toBe(true); // 240 minutes after the due time is the last minute
    expect(await guardianSummaryReady(new Date(2027, 0, 13, 22, 1))).toBe(false);
    expect(await guardianSummaryReady(new Date(2027, 0, 13, 23, 50))).toBe(false); // a late-night restart sends nothing
    expect(await guardianSummaryReady(new Date(2027, 0, 14, 0, 0))).toBe(false);
    await HolidayException.create({ fromDate: new Date(2027, 0, 13), toDate: new Date(2027, 0, 13), type: "special", nameBn: "ছুটি", active: true });
    expect(await guardianSummaryReady(new Date(2027, 0, 13, 18, 30))).toBe(false); // the due day itself is a holiday: nothing
    expect(await guardianSummaryReady(new Date(2027, 0, 14, 9, 0))).toBe(false); // the rolled day waits for the same hour
    expect(await guardianSummaryReady(new Date(2027, 0, 14, 18, 0))).toBe(true); // rolled to the first open day, 18:00
    expect(await guardianSummaryReady(new Date(2027, 0, 14, 23, 50))).toBe(false); // restart at 23:50: no send
    await savePolicy(null, null, { guardianSummaryDow: 2, guardianSummaryHour: 9 }, PRINCIPAL);
    await HolidayException.deleteMany({});
    expect(await guardianSummaryReady(new Date(2027, 0, 12, 9, 0))).toBe(true);
    expect(await guardianSummaryReady(new Date(2027, 0, 12, 8, 59))).toBe(false);
    await savePolicy(null, null, { guardianSummaryDow: 3, guardianSummaryHour: 18 }, PRINCIPAL);
  });
});

describe('"ক্লাস মিস" (E3, AC-E1)', () => {
  const ev = (code: string, day: string) => MasteryEvidence.create({
    studentId: new Types.ObjectId(sidA), sectionId, academicYearId: yearId, classToken: "C3", subject: "MATH", loCode: code, chapterNumber: 7,
    source: "HW", paperId: new Types.ObjectId(), earned: 1, available: 1, at: at(day), week: "2027-W02", signal: "NONE", routed: false,
  });
  const lesson = (code: string, absentOn: string[]) => ({ loCode: code, status: absentOn.length ? "MISSED" : "TAUGHT", absentOn });

  beforeEach(async () => {
    await MasteryEvidence.deleteMany({});
    await setLoop(true);
  });

  it("a missed objective with no evidence since the missed day reads ক্লাস মিস; after the first live evidence the normal state shows", async () => {
    const lessons = [lesson("LO-C3-MATH-07-01", ["2027-01-05"]), lesson("LO-C3-MATH-07-02", ["2027-01-05"]), lesson("LO-C3-MATH-07-03", [])];
    expect([...(await classMissedCodes(sidA, lessons))].sort()).toEqual(["LO-C3-MATH-07-01", "LO-C3-MATH-07-02"]);
    await ev("LO-C3-MATH-07-01", "2027-01-06"); // practised after the missed day
    expect([...(await classMissedCodes(sidA, lessons))]).toEqual(["LO-C3-MATH-07-02"]);
    await ev("LO-C3-MATH-07-02", "2027-01-01"); // before the missed day: does not clear it
    expect([...(await classMissedCodes(sidA, lessons))]).toEqual(["LO-C3-MATH-07-02"]);
  });

  it("a superseded or excluded row does not count; a sub-objective's evidence counts for its objective", async () => {
    const lessons = [lesson("LO-C3-MATH-07-02", ["2027-01-05"])];
    const row = await ev("LO-C3-MATH-07-02", "2027-01-06");
    await MasteryEvidence.updateOne({ _id: row._id }, { $set: { supersededAt: new Date() } });
    expect([...(await classMissedCodes(sidA, lessons))]).toEqual(["LO-C3-MATH-07-02"]);
    await ev("LO-C3-MATH-07-02.1", "2027-01-07");
    expect([...(await classMissedCodes(sidA, lessons, (c) => (c === "LO-C3-MATH-07-02" ? ["LO-C3-MATH-07-02.1"] : [])))]).toEqual([]);
  });

  it("the state rule: only WEAK / NOT_ASSESSED / INSUFFICIENT can read ক্লাস মিস; IMPROVING / MASTERED / REVISION_DUE keep their state", async () => {
    expect([...CLASS_MISSED_STATES].sort()).toEqual(["INSUFFICIENT", "NOT_ASSESSED", "WEAK"]);
    const lessons = ["A", "B", "C", "D", "E", "F"].map((x) => lesson(`LO-C3-MATH-07-0${x}`, ["2027-01-05"]));
    const states: Record<string, string> = {
      "LO-C3-MATH-07-0A": "WEAK", "LO-C3-MATH-07-0B": "NOT_ASSESSED", "LO-C3-MATH-07-0C": "INSUFFICIENT",
      "LO-C3-MATH-07-0D": "IMPROVING", "LO-C3-MATH-07-0E": "MASTERED", "LO-C3-MATH-07-0F": "REVISION_DUE",
    };
    const out = await classMissedCodes(sidA, lessons, undefined, (c) => states[c]);
    expect([...out].sort()).toEqual(["LO-C3-MATH-07-0A", "LO-C3-MATH-07-0B", "LO-C3-MATH-07-0C"]);
    // without a state function (the pure evidence rule) all six are candidates
    expect((await classMissedCodes(sidA, lessons)).size).toBe(6);
  });

  it("routed strand evidence clears ক্লাস মিস too (same as the diagnosis)", async () => {
    const lessons = [lesson("LO-C3-MATH-07-02", ["2027-01-05"])];
    expect([...(await classMissedCodes(sidA, lessons))]).toEqual(["LO-C3-MATH-07-02"]);
    await MasteryEvidence.create({
      studentId: new Types.ObjectId(sidA), sectionId, academicYearId: yearId, classToken: "C3", subject: "MATH", loCode: "LO-C3-MATH-07-02", chapterNumber: 7,
      source: "HW", paperId: new Types.ObjectId(), earned: 1, available: 1, at: at("2027-01-06"), week: "2027-W01", signal: "NONE", routed: true,
    });
    expect([...(await classMissedCodes(sidA, lessons))]).toEqual([]);
  });

  it("AC-R1: with the release switch OFF nothing reads ক্লাস মিস and the guardian progress carries none", async () => {
    await setLoop(false);
    expect((await classMissedCodes(sidA, [lesson("LO-C3-MATH-07-01", ["2027-01-05"])])).size).toBe(0);
    for (const s of await childMasteryProgress(sidA)) expect(s.counts.classMissed).toBe(0);
  });
});

describe("guardian assignment rows carry the sheet total (item 4, R32 / R35)", () => {
  it("availableMarks is on the row when the paper wrote it (the app shows marks + level word, no result word); null for a 2026 row", async () => {
    await Promise.all([AssignmentItem, AssignmentStudentRecord].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
    await asWithMarks("MATH", at("2027-01-12"), { [sidA]: [3.5, 5] });
    const [row] = await childAssignments(sidA);
    expect(row).toMatchObject({ marks: 3.5, availableMarks: 5 });
    await AssignmentStudentRecord.updateMany({ studentId: sidA }, { $unset: { availableMarks: "" } });
    const [old] = await childAssignments(sidA);
    expect(old!.availableMarks).toBeNull();
    expect(old!.marks).toBe(3.5);
  });
});

describe("childWeekSummary resolver - the guardian link gate (item 6)", () => {
  const schema = builder.toSchema();
  const Q = `query($s: String!) { childWeekSummary(studentId: $s) { weekKey subjects { subject earned available levelBn } } }`;
  const run = (guardianId: string, s: string): Promise<ExecutionResult> =>
    graphql({ schema, source: Q, contextValue: { auth: { userId: guardianId, role: "GUARDIAN" } }, variableValues: { s } }) as Promise<ExecutionResult>;

  it("refuses an unlinked child, refuses an active:false link, allows a link with no active field", async () => {
    await setLoop(true);
    // gOnlyA is linked to A only; B belongs to someone else's family
    const other = await run(gOnlyA, sidB);
    expect(other.errors?.[0]?.message).toMatch(/অনুমতি নেই/);
    expect(other.data?.childWeekSummary ?? null).toBeNull();
    // a link with active: false is refused
    const [gOff] = await Guardian.create([{ identifierKind: "phone", identifier: "01700000103", phone: "01700000103", name: "Off", loginEnabled: true, active: true }]);
    await GuardianLink.create([{ guardianId: gOff!._id, studentId: new Types.ObjectId(sidA), relation: "UNCLE", active: false }]);
    const off = await run(String(gOff!._id), sidA);
    expect(off.errors?.[0]?.message).toMatch(/অনুমতি নেই/);
    // an older link row carries no `active` field at all and is allowed (written raw: the schema would default it)
    const [gOld] = await Guardian.create([{ identifierKind: "phone", identifier: "01700000104", phone: "01700000104", name: "Old", loginEnabled: true, active: true }]);
    await GuardianLink.collection.insertOne({ guardianId: gOld!._id, studentId: new Types.ObjectId(sidA), relation: "AUNT" });
    expect(await GuardianLink.countDocuments({ guardianId: gOld!._id, active: { $exists: false } })).toBe(1);
    const ok = await run(String(gOld!._id), sidA);
    expect(ok.errors).toBeUndefined();
    expect(ok.data?.childWeekSummary ?? null).toBeNull(); // linked, but nothing confirmed this week
  });
});

describe("no answer field, no rank, no other child (AC-D3, AC-B6)", () => {
  it("the new guardian GraphQL types carry plain text only", () => {
    const schema: GraphQLSchema = builder.toSchema();
    for (const n of ["ChildWeekSummary", "ChildWeekSubject", "ChildMasteryClassMissed"]) {
      const t = schema.getType(n) as GraphQLObjectType;
      expect(t).toBeDefined();
      for (const f of Object.keys(t.getFields())) expect(f).not.toMatch(/answer|correct|option|accepted|blank|rank|average|avg|other|student(id)?$|section/i);
    }
    const q = schema.getQueryType()!.getFields()["childWeekSummary"];
    expect(q).toBeDefined();
    // staff display flag on the lesson row
    expect(Object.keys((schema.getType("StudentObjectiveLesson") as GraphQLObjectType).getFields())).toContain("classMissed");
  });

  it("the hint payload types are unchanged: no answer / options / correctness field", () => {
    const schema: GraphQLSchema = builder.toSchema();
    for (const n of ["ChildAssignedQuestion", "ChildHintStep", "OpenedQuestionHint"]) {
      const t = schema.getType(n) as GraphQLObjectType;
      for (const f of Object.keys(t.getFields())) expect(f).not.toMatch(/answer|correct|option|accepted|blank|pair|key|tf/i);
    }
  });
});

afterEach(async () => {
  // keep the policy collection tidy between describes that flip the switch
  await MasteryPolicy.updateOne({ scopeKey: "SCHOOL" }, { $set: { "values.academicLoop2027On": true } }).catch(() => undefined);
});
