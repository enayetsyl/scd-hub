/**
 * Lesson-plan progress LP-1 — marking the session plan on the class note
 * (docs/prd-lesson-progress.md §2 + §6, D-#820–#822).
 *
 *  - the plan: current session plans in book order, standalone = 1 of 1, newest import wins
 *  - no plan for the class × subject → applies: false and the input is ignored
 *  - the suggestion: a started session first, else the first unfinished one; the note's own
 *    marks are left out so re-opening a card suggests the same session
 *  - validation: unknown / duplicate session, neither sessions nor reason
 *  - the roster snapshot, the flip sessions ⇄ reason clears the other side, delete
 *  - updateClassNote with only lesson marks is allowed (author) and changes nothing else
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

jest.mock("../modules/notifications/services/emitters", () => ({
  emitClassNotePublished: jest.fn(async () => undefined),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { publishClassNote, updateClassNote } from "../modules/routine/services/RoutineTriggerService";
import {
  deleteDeliveryForNote,
  lessonPlanForSlot,
  nextSessionKey,
  prepareDelivery,
  recordDelivery,
  sessionPlansFor,
} from "../modules/lesson-progress/services/LessonDeliveryService";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
const TEACHER = new Types.ObjectId().toString();
const OTHER = new Types.ObjectId().toString();
let classId: Types.ObjectId;
let sectionId: Types.ObjectId;
const sids: string[] = [];

async function plan(chapter: number, period: number | null, of: number | null, title: string, over: Record<string, unknown> = {}) {
  const session_plan: Record<string, unknown> = period
    ? { session_form: "multi_period", period_index: period, period_of: of, session_title: title }
    : { session_form: "single_period_standalone" };
  await ContentArtifact.create([
    {
      docType: "session_plan",
      subject: "MATH",
      classLevel: 3,
      address: { anchorWord: "অধ্যায়", number: chapter, title: `অধ্যায়-শিরোনাম ${chapter}` },
      curationTag: "KEEP_AS_IS",
      reviewStatus: "reviewed",
      current: true,
      importedBy: new Types.ObjectId(),
      envelopeJson: { payload: { session_plan } },
      ...over,
    },
  ]);
}

async function slot(subject: string, period: number) {
  const [s] = await RoutineSlot.create([
    {
      groupType: "section", groupId: sectionId, classId, dayOfWeek: "SUN", periodNumber: period, subject, track: "general",
      teacherId: new Types.ObjectId(TEACHER), effectiveFrom: new Date("2027-01-01"), createdBy: new Types.ObjectId(),
    },
  ]);
  return s;
}

const publish = (slotId: Types.ObjectId, date: string) =>
  publishClassNote({ slotId: String(slotId), date: new Date(date), taughtSummaryBn: "পড়ানো হলো", actorId: TEACHER, canManage: false });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  classId = cls._id as Types.ObjectId;
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = sec._id as Types.ObjectId;
  for (let i = 1; i <= 3; i++) {
    const [s] = await Student.create([{ schoolId: `LP-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
  }
  // Out of order on purpose: chapter 10 must sort after chapter 2.
  await plan(10, null, null, "");
  await plan(2, 2, 2, "ভাগ — অনুশীলন");
  await plan(2, 1, 2, "ভাগ — ধারণা");
  await plan(1, 1, 1, "পুরনো সংস্করণ", { current: false });
  await plan(1, 1, 1, "স্থানীয় মান");
  // Another class level and subject must not leak in.
  await plan(4, 1, 1, "অন্য শ্রেণি", { classLevel: 4 });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("the plan", () => {
  it("is the current session plans of the class × subject in book order", async () => {
    const p = await sessionPlansFor(3, "MATH");
    expect(p.map((s) => `${s.key}/${s.sessionOf}`)).toEqual(["1:1/1", "2:1/2", "2:2/2", "10:1/1"]);
    expect(p[0].titleBn).toBe("স্থানীয় মান");
    // A standalone plan without a session title falls back to the chapter title.
    expect(p[3].titleBn).toBe("অধ্যায়-শিরোনাম 10");
  });

  it("the suggestion prefers a started session, else the first unfinished", () => {
    const p = [{ key: "1:1" }, { key: "2:1" }, { key: "2:2" }] as never;
    const st = (m: Record<string, [string[], string[]]>) =>
      new Map(Object.entries(m).map(([k, [f, s]]) => [k, { finishedOn: f, startedOn: s }]));
    expect(nextSessionKey(p, st({}))).toBe("1:1");
    expect(nextSessionKey(p, st({ "1:1": [["2027-03-01"], []] }))).toBe("2:1");
    expect(nextSessionKey(p, st({ "1:1": [["2027-03-01"], []], "2:2": [[], ["2027-03-02"]] }))).toBe("2:2");
  });
});

describe("marking on the class note (DB)", () => {
  it("a class × subject with no plan: applies false, the answer is ignored", async () => {
    const s = await slot("BAN", 1);
    const view = await lessonPlanForSlot(s, new Date("2027-03-07"));
    expect(view.applies).toBe(false);
    expect(await prepareDelivery(s._id, { noneReason: "nonsense" })).toBeNull();
  });

  it("validates: unknown session, duplicate, neither sessions nor a reason", async () => {
    const s = await slot("MATH", 2);
    await expect(prepareDelivery(s._id, { sessions: [{ key: "9:1", finished: true }] })).rejects.toThrow(/পাঠ পরিকল্পনায় নেই/);
    await expect(prepareDelivery(s._id, { sessions: [{ key: "1:1", finished: true }, { key: "1:1", finished: false }] })).rejects.toThrow(/দুবার/);
    await expect(prepareDelivery(s._id, {})).rejects.toThrow(/বাছাই করুন/);
    await expect(prepareDelivery(s._id, { noneReason: "HOLIDAY" })).rejects.toThrow(/বাছাই করুন/);
  });

  it("records sessions with the roster; the next card suggests the following session; re-open keeps its own suggestion", async () => {
    const s = await slot("MATH", 3);
    const day1 = await publish(s._id, "2027-03-07");
    let view = await lessonPlanForSlot(s, new Date("2027-03-07"));
    expect(view).toMatchObject({ applies: true, suggestedKey: "1:1", delivery: null });

    await recordDelivery(day1, { sessions: [{ key: "1:1", finished: true }, { key: "2:1", finished: false }] }, TEACHER);
    const row = await LessonDelivery.findOne({ noteId: day1._id }).lean();
    expect(row).toMatchObject({ classLevel: 3, subject: "MATH", dateKey: "2027-03-07" });
    expect(row!.rosterStudentIds.map(String).sort()).toEqual([...sids].sort());
    expect(row!.sessions.map((x) => `${x.chapter}:${x.sessionIndex}:${x.finished}`)).toEqual(["1:1:true", "2:1:false"]);

    // Re-opening day 1 still suggests 1:1 (its own marks are left out) and shows them.
    view = await lessonPlanForSlot(s, new Date("2027-03-07"));
    expect(view.suggestedKey).toBe("1:1");
    expect(view.delivery?.sessions.map((x) => x.key)).toEqual(["1:1", "2:1"]);

    // Day 2: the started 2:1 is suggested; progress shows on the plan rows.
    view = await lessonPlanForSlot(s, new Date("2027-03-14"));
    expect(view.suggestedKey).toBe("2:1");
    expect(view.sessions.find((x) => x.key === "1:1")).toMatchObject({ finishedOn: ["2027-03-07"], startedOn: [] });
    expect(view.sessions.find((x) => x.key === "2:1")).toMatchObject({ finishedOn: [], startedOn: ["2027-03-07"] });
  });

  it("a correction flips sessions ⇄ reason and clears the other side; lesson-only update leaves the note alone", async () => {
    const s = await slot("MATH", 4);
    const note = await publish(s._id, "2027-03-21");
    await recordDelivery(note, { noneReason: "TEST", noneNote: "ক্লাস টেস্ট ২" }, TEACHER);
    expect(await LessonDelivery.findOne({ noteId: note._id }).lean()).toMatchObject({ noneReason: "TEST", noneNote: "ক্লাস টেস্ট ২", sessions: [] });

    // Another teacher may not touch it; the author may, with marks only.
    await expect(updateClassNote({ id: String(note._id), actorId: OTHER, canManage: false, lessonOnly: true })).rejects.toThrow(/own class note/);
    await expect(updateClassNote({ id: String(note._id), actorId: TEACHER, canManage: false })).rejects.toThrow(/Nothing to update/);
    const same = await updateClassNote({ id: String(note._id), actorId: TEACHER, canManage: false, lessonOnly: true });
    expect(same.taughtSummaryBn).toBe("পড়ানো হলো");
    await recordDelivery(same, { sessions: [{ key: "10:1", finished: true }] }, TEACHER);
    const row = await LessonDelivery.findOne({ noteId: note._id }).lean();
    expect(row!.noneReason).toBeUndefined();
    expect(row!.noneNote).toBeUndefined();
    expect(row!.sessions).toHaveLength(1);

    await deleteDeliveryForNote(String(note._id));
    expect(await LessonDelivery.countDocuments({ noteId: note._id })).toBe(0);
  });
});
