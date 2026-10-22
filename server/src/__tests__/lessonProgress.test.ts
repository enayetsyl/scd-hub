/**
 * Lesson-plan progress LP-2 — tracker + Office overview (docs/prd-lesson-progress.md §3 + §6, D-#824/#826).
 *
 *  - sessionStates (pure): finished / started / skipped (unfinished before the furthest finished) / not yet
 *  - summarize (pure): pace over 28 days, projection, reasons, unanswered notes
 *  - overview (DB): only শাখা × subjects with plans AND a live routine slot; lag between parallel শাখা
 *    of the same class level only; largest lag first
 *  - row rule: routine holder / class teacher / view_all — anyone else refused
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
import { publishClassNote } from "../modules/routine/services/RoutineTriggerService";
import { recordDelivery, type PlanSession } from "../modules/lesson-progress/services/LessonDeliveryService";
import {
  myProgressRows,
  progressOverview,
  sessionStates,
  sectionTracker,
  summarize,
} from "../modules/lesson-progress/services/LessonProgressService";

jest.setTimeout(180_000);

const P = (keys: string[]): PlanSession[] =>
  keys.map((k) => {
    const [chapter, i] = k.split(":");
    return { key: k, chapter, anchorWord: "অধ্যায়", chapterTitle: null, sessionIndex: Number(i), sessionOf: 2, titleBn: k, artifactId: "x" };
  });
const D = (dateKey: string, sessions: Array<[string, boolean]>, noneReason?: "REVISION" | "TEST" | "OTHER", noteId = new Types.ObjectId()) => ({
  noteId,
  dateKey,
  teacherId: new Types.ObjectId(),
  noneReason,
  sessions: sessions.map(([k, finished]) => ({ chapter: k.split(":")[0], sessionIndex: Number(k.split(":")[1]), sessionOf: 2, titleBn: k, finished })),
});

describe("sessionStates / summarize (pure)", () => {
  const plan = P(["1:1", "1:2", "2:1", "2:2", "3:1"]);

  it("finished, started, skipped before the furthest finished, not yet after it", () => {
    const st = sessionStates(plan, [D("2027-03-01", [["1:1", true]]), D("2027-03-02", [["2:1", true], ["2:2", false]])] as never);
    expect(st.map((s) => s.status)).toEqual(["FINISHED", "SKIPPED", "FINISHED", "STARTED", "NOT_YET"]);
  });

  it("pace counts first finishes in the last 28 days; projection = remaining at that pace; reasons; unanswered", () => {
    const answered = new Types.ObjectId();
    const s = summarize(
      plan,
      [
        D("2027-01-10", [["1:1", true]]),
        D("2027-03-20", [["1:2", true]]),
        D("2027-03-25", [["2:1", true]], undefined, answered),
        D("2027-03-26", [], "TEST"),
        D("2027-03-27", [["1:2", true]]), // finished again: the first finish counts
      ] as never,
      [String(answered), String(new Types.ObjectId())],
      "2027-03-31",
    );
    expect(s).toMatchObject({ total: 5, finished: 3, pct: 60, finishedLast4Weeks: 2, pacePerWeek: 0.5, lastFinishedKey: "2027-03-27", daysSinceLastFinished: 4, skipped: 0, unansweredNotes: 1 });
    expect(s.reasons).toEqual({ REVISION: 0, TEST: 1, OTHER: 0 });
    // 2 remaining at 2 per 28 days → 28 days on.
    expect(s.projectedFinishKey).toBe("2027-04-28");
  });

  it("no finish in 4 weeks → no projection", () => {
    expect(summarize(plan, [D("2027-01-10", [["1:1", true]])] as never, [], "2027-03-31").projectedFinishKey).toBeNull();
  });
});

let mongo: MongoMemoryServer;
const T1 = new Types.ObjectId().toString();
const T2 = new Types.ObjectId().toString();
const CT = new Types.ObjectId().toString();
const OUTSIDER = new Types.ObjectId().toString();
const TEACHER = (id: string) => ({ userId: id, role: "TEACHER" as const });
const OFFICE = { userId: new Types.ObjectId().toString(), role: "OFFICE" as const };
let boys = "";
let girls = "";
let c4 = "";
const TODAY = new Date("2027-03-31T06:00:00Z");

async function plan(level: number, subject: string, keys: string[]) {
  for (const k of keys) {
    const [ch, i] = k.split(":").map(Number);
    await ContentArtifact.create([{
      docType: "session_plan", subject, classLevel: level, address: { anchorWord: "অধ্যায়", number: ch, title: `ch ${ch}` },
      curationTag: "KEEP_AS_IS", reviewStatus: "reviewed", current: true, importedBy: new Types.ObjectId(),
      envelopeJson: { payload: { session_plan: { session_form: "multi_period", period_index: i, period_of: 2, session_title: k } } },
    }]);
  }
}

async function slot(sectionId: string, classId: Types.ObjectId, subject: string, teacher: string, day = "SUN") {
  const [s] = await RoutineSlot.create([{
    groupType: "section", groupId: new Types.ObjectId(sectionId), classId, dayOfWeek: day, periodNumber: 1, subject, track: "general",
    teacherId: new Types.ObjectId(teacher), effectiveFrom: new Date("2027-01-01"), createdBy: new Types.ObjectId(),
  }]);
  return s;
}

async function teach(slotId: Types.ObjectId, teacher: string, date: string, sessions: Array<[string, boolean]>) {
  const note = await publishClassNote({ slotId: String(slotId), date: new Date(date), taughtSummaryBn: "x", actorId: teacher, canManage: false });
  await recordDelivery(note, { sessions: sessions.map(([key, finished]) => ({ key, finished })) }, teacher);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), current: true }]);
  const [cls3] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [cls4] = await Class.create([{ level: 4, nameBn: "চতুর্থ", academicYearId: year._id }]);
  const [b] = await Section.create([{ classId: cls3._id, code: "B", nameBn: "বালক", classTeacherId: new Types.ObjectId(CT) }]);
  const [g] = await Section.create([{ classId: cls3._id, code: "G", nameBn: "বালিকা" }]);
  const [f] = await Section.create([{ classId: cls4._id, code: "A", nameBn: "সম্মিলিত" }]);
  boys = String(b._id);
  girls = String(g._id);
  c4 = String(f._id);
  for (const sec of [b, g, f]) await Student.create([{ schoolId: `S-${sec.code}-${sec._id}`, name: "s", rollNumber: "1", classId: sec.classId, sectionId: sec._id, active: true }]);

  await plan(3, "MATH", ["1:1", "1:2", "2:1", "2:2"]);
  await plan(4, "MATH", ["1:1", "1:2"]);
  // C3 BAN has a slot but no plans → never a row.
  const bm = await slot(boys, cls3._id as Types.ObjectId, "MATH", T1);
  const gm = await slot(girls, cls3._id as Types.ObjectId, "MATH", T2);
  const fm = await slot(c4, cls4._id as Types.ObjectId, "MATH", T2);
  await slot(boys, cls3._id as Types.ObjectId, "BAN", T1);

  await teach(bm._id, T1, "2027-03-21", [["1:1", true], ["1:2", true]]);
  await teach(bm._id, T1, "2027-03-28", [["2:1", true]]);
  await teach(gm._id, T2, "2027-03-21", [["1:1", true]]);
  await teach(fm._id, T2, "2027-03-21", [["1:1", true]]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("overview + tracker (DB)", () => {
  it("rows only where plans and a live slot exist; lag only between parallel শাখা; largest lag first", async () => {
    const rows = await progressOverview({}, TODAY);
    expect(rows.map((r) => `${r.classLevel}/${r.sectionNameBn}/${r.subject}:${r.finished}/${r.total}:lag${r.lagSessions}`)).toEqual([
      "3/বালিকা/MATH:1/4:lag2",
      "3/বালক/MATH:3/4:lag0",
      "4/সম্মিলিত/MATH:1/2:lag0",
    ]);
    expect((await progressOverview({ classLevel: 4 }, TODAY)).map((r) => r.sectionId)).toEqual([c4]);
  });

  it("a teacher's own rows still know the leader; the class teacher sees their শাখা", async () => {
    const mine = await myProgressRows(TEACHER(T2), TODAY);
    expect(mine.map((r) => `${r.sectionNameBn}:lag${r.lagSessions}`).sort()).toEqual(["বালিকা:lag2", "সম্মিলিত:lag0"]);
    expect((await myProgressRows(TEACHER(CT), TODAY)).map((r) => r.sectionId)).toEqual([boys]);
  });

  it("tracker in book order with teacher names' slots; row rule refuses an outsider", async () => {
    const t = await sectionTracker(boys, "MATH", TEACHER(T1), TODAY);
    expect(t.sessions.map((s) => `${s.key}:${s.status}`)).toEqual(["1:1:FINISHED", "1:2:FINISHED", "2:1:FINISHED", "2:2:NOT_YET"]);
    expect(t.row).toMatchObject({ finished: 3, lagSessions: 0 });
    await expect(sectionTracker(boys, "MATH", TEACHER(CT), TODAY)).resolves.toBeTruthy();
    await expect(sectionTracker(boys, "MATH", OFFICE, TODAY)).resolves.toBeTruthy();
    await expect(sectionTracker(boys, "MATH", TEACHER(OUTSIDER), TODAY)).rejects.toThrow(/অনুমতি/);
    await expect(sectionTracker(boys, "MATH", TEACHER(T2), TODAY)).rejects.toThrow(/অনুমতি/);
  });
});
