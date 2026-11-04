/**
 * D-#952 — the school switch "ক্লাস নোটে পাঠ পরিকল্পনার প্রশ্ন" (default OFF).
 *
 * Owner ruling 2026-11-04: lesson-plan progress is promoted but the class note must not change
 * this year. So:
 *  - no config row (prod) → the card's read says `applies: false` even where session plans exist,
 *    so every app build (old bundles with LP-1 included) hides the block and sends no answer;
 *  - the note publishes without an answer, and an answer sent anyway is ignored (never an error,
 *    never written) — including a lesson-only correction;
 *  - an existing LessonDelivery row stays readable;
 *  - `routine:settings` switches it (Principal + Office by default; a teacher is refused), the
 *    change is audited, and switched ON the LP-1 behaviour is back.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { graphql, type ExecutionResult } from "graphql";

jest.mock("../modules/notifications/services/emitters", () => ({
  emitClassNotePublished: jest.fn(async () => undefined),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { Audit } from "../modules/platform/models/Audit";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { LessonProgressConfig } from "../modules/lesson-progress/models/LessonProgressConfig";
import { deliveriesForNotes, lessonPlanForSlot, prepareDelivery, recordDelivery } from "../modules/lesson-progress/services/LessonDeliveryService";
import { isLessonPlanQuestionOn } from "../modules/lesson-progress/services/LessonPlanQuestionSwitch";
import "../registerResolvers";
import { builder } from "../schema";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
const TEACHER = new Types.ObjectId().toString();
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const OFFICE = { userId: new Types.ObjectId().toString(), role: "OFFICE" as const };
const TEACHER_AUTH = { userId: TEACHER, role: "TEACHER" as const };
let classId: Types.ObjectId;
let sectionId: Types.ObjectId;

const schema = builder.toSchema();
const run = (source: string, auth: Record<string, unknown> | null, variableValues?: Record<string, unknown>): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: { auth }, variableValues }) as Promise<ExecutionResult>;

async function slot(period: number) {
  const [s] = await RoutineSlot.create([
    {
      groupType: "section", groupId: sectionId, classId, dayOfWeek: "SUN", periodNumber: period, subject: "MATH", track: "general",
      teacherId: new Types.ObjectId(TEACHER), effectiveFrom: new Date("2027-01-01"), createdBy: new Types.ObjectId(),
    },
  ]);
  return s;
}

const PUBLISH = `mutation($slot: String!, $date: String!, $lp: LessonPlanInput) {
  publishClassNote(slotId: $slot, date: $date, taughtSummaryBn: "পড়ানো হলো", lessonPlan: $lp) { id }
}`;
const CARD = `query($slot: String!, $date: String!) { lessonPlanForSlot(slotId: $slot, date: $date) { applies sessions { key } } }`;
const SETTING = `{ lessonPlanQuestionSetting { on } }`;
const SET = `mutation($on: Boolean!) { setLessonPlanQuestionOn(on: $on) { on updatedAt } }`;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // registerResolvers loads every model; one partial index is not supported by the in-memory server — irrelevant here.
  await Promise.allSettled(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), current: true }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  classId = cls._id as Types.ObjectId;
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = sec._id as Types.ObjectId;
  await Student.create([{ schoolId: "SW-1", name: "Student 1", rollNumber: "1", classId: cls._id, sectionId: sec._id, active: true }]);
  // Session plans EXIST for Class 3 MATH — without the switch LP-1 would ask on every MATH note.
  await ContentArtifact.create([1, 2].map((i) => ({
    docType: "session_plan", subject: "MATH", classLevel: 3,
    address: { anchorWord: "অধ্যায়", number: 1, title: "স্থানীয় মান" },
    curationTag: "KEEP_AS_IS", reviewStatus: "reviewed", current: true, importedBy: new Types.ObjectId(),
    envelopeJson: { payload: { session_plan: { session_form: "multi_period", period_index: i, period_of: 2, session_title: `সেশন ${i}` } } },
  })));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("switch absent (prod: no config row) — the class note behaves as before LP-1", () => {
  it("reads OFF with no row", async () => {
    expect(await LessonProgressConfig.countDocuments()).toBe(0);
    expect(await isLessonPlanQuestionOn()).toBe(false);
    const r = await run(SETTING, TEACHER_AUTH);
    expect(r.errors).toBeUndefined();
    expect((r.data as any).lessonPlanQuestionSetting).toEqual({ on: false });
  });

  it("the card says applies: false although session plans exist; an answer is ignored, never an error", async () => {
    const s = await slot(1);
    const r = await run(CARD, TEACHER_AUTH, { slot: String(s._id), date: "2027-03-07" });
    expect(r.errors).toBeUndefined();
    expect((r.data as any).lessonPlanForSlot).toEqual({ applies: false, sessions: [] });
    // A bad answer would throw with the switch on; off it is simply ignored.
    expect(await prepareDelivery(s._id, {})).toBeNull();
    expect(await prepareDelivery(s._id, { sessions: [{ key: "9:9", finished: true }] })).toBeNull();
  });

  it("the note publishes without an answer; an answer sent anyway (or a lesson-only correction) writes no delivery", async () => {
    const s = await slot(2);
    const plain = await run(PUBLISH, TEACHER_AUTH, { slot: String(s._id), date: "2027-03-07" });
    expect(plain.errors).toBeUndefined();
    const s2 = await slot(3);
    const withLp = await run(PUBLISH, TEACHER_AUTH, { slot: String(s2._id), date: "2027-03-07", lp: { sessions: [{ key: "1:1", finished: true }] } });
    expect(withLp.errors).toBeUndefined();
    const noteId = (withLp.data as any).publishClassNote.id;
    const fix = await run(
      `mutation($id: String!) { updateClassNote(id: $id, lessonPlan: { sessions: [{ key: "1:2", finished: true }] }) { id } }`,
      TEACHER_AUTH,
      { id: noteId },
    );
    expect(fix.errors).toBeUndefined();
    expect(await LessonDelivery.countDocuments()).toBe(0);
  });
});

describe("toggle — routine:settings", () => {
  it("a teacher may read but not switch it", async () => {
    const r = await run(SET, TEACHER_AUTH, { on: true });
    expect(r.errors?.[0]?.message).toMatch(/অনুমতি|permission|Not authorized|Forbidden/i);
    expect(await isLessonPlanQuestionOn()).toBe(false);
  });

  it("the Principal switches it on (audited); the LP-1 card and recording are back", async () => {
    const r = await run(SET, PRINCIPAL, { on: true });
    expect(r.errors).toBeUndefined();
    expect((r.data as any).setLessonPlanQuestionOn.on).toBe(true);
    expect(await Audit.countDocuments({ eventKind: "LESSON_PLAN_QUESTION_SET", "meta.on": true })).toBe(1);

    const s = await slot(4);
    const card = await run(CARD, TEACHER_AUTH, { slot: String(s._id), date: "2027-03-14" });
    expect(card.errors).toBeUndefined();
    expect((card.data as any).lessonPlanForSlot).toEqual({ applies: true, sessions: [{ key: "1:1" }, { key: "1:2" }] });
    await expect(prepareDelivery(s._id, {})).rejects.toThrow(/বাছাই করুন/);

    const pub = await run(PUBLISH, TEACHER_AUTH, { slot: String(s._id), date: "2027-03-14", lp: { sessions: [{ key: "1:1", finished: true }] } });
    expect(pub.errors).toBeUndefined();
    expect(await LessonDelivery.countDocuments({ noteId: (pub.data as any).publishClassNote.id })).toBe(1);
  });

  it("the Office (routine:settings by default) switches it off again; old marks stay readable, the card goes quiet", async () => {
    const before = await LessonDelivery.findOne().lean();
    const r = await run(SET, OFFICE, { on: false });
    expect(r.errors).toBeUndefined();
    expect((r.data as any).setLessonPlanQuestionOn.on).toBe(false);
    // Re-sending the same value changes nothing and writes no second audit row.
    await run(SET, OFFICE, { on: false });
    expect(await Audit.countDocuments({ eventKind: "LESSON_PLAN_QUESTION_SET" })).toBe(2);

    const kept = await deliveriesForNotes([before!.noteId]);
    expect(kept.get(String(before!.noteId))?.sessions.map((x) => x.sessionIndex)).toEqual([1]);
    const s = (await RoutineSlot.findById(before!.slotId).lean())!;
    expect((await lessonPlanForSlot(s as never, new Date("2027-03-14"))).applies).toBe(false);
    // A correction while off leaves the existing row as it was.
    const note = { _id: before!.noteId, slotId: before!.slotId, groupType: "section", groupId: sectionId, date: new Date("2027-03-14"), subject: "MATH", publishedBy: new Types.ObjectId(TEACHER) };
    expect(await recordDelivery(note as never, { noneReason: "TEST" }, TEACHER)).toBeNull();
    expect((await LessonDelivery.findById(before!._id).lean())!.sessions).toHaveLength(1);
  });
});
