/**
 * Data assistant: exam_syllabus (owner 17 Nov 2026). Same visibility as the syllabus screens: Principal
 * sees an unpublished row, a teacher does not; a class list has no body; one subject carries the body
 * (in the untrusted envelope) and the mark rows; guardians are refused. Every name here is invented.
 */
import { Types } from "mongoose";
import { runTool } from "../modules/data-assistant/runTool";
import { resetLimits } from "../modules/data-assistant/limits";
import { User } from "../modules/foundation/models/User";
import { Exam } from "../modules/exams/models/Exam";
import { ExamSyllabus } from "../modules/exams/models/ExamSyllabus";
import { setupFixtures, teardownFixtures, type Fx } from "./dataAssistantFixtures";

jest.setTimeout(180_000);
let fx: Fx;
let examId: Types.ObjectId;
let noView: { userId: string; role: "OFFICE" };

beforeAll(async () => {
  fx = await setupFixtures();
  const by = new Types.ObjectId();
  const [exam] = await Exam.create([{ academicYearId: fx.ids.year, term: "ANNUAL", name: "Annual Test 2026", createdBy: by }]);
  examId = exam._id;
  const marks = [
    { seq: 1, label: "MCQ", itemType: "mcq", count: 10, marksEach: 1, total: 10 },
    { seq: 2, label: "Short answers", itemType: "short_answer", count: 9, marksEach: 10, total: 90 },
  ];
  const base = { examId, classId: new Types.ObjectId(fx.ids.class3), fullMarks: 100, marks, questionTypes: ["mcq"], createdBy: by, updatedBy: by };
  const u = new Types.ObjectId();
  await User.create([{ _id: u, role: "OFFICE", name: "No Syllabus", email: "nosyl@school.test", passwordHash: "x", active: true, grantedPermissions: ["data_assistant:use", "data_assistant:connect"], revokedPermissions: ["exam_syllabus:view", "exam_syllabus:view_all", "exam_results:view", "exam_custody:view"] }]);
  noView = { userId: String(u), role: "OFFICE" };
  const lvl = { examId, fullMarks: 50, marks: [{ seq: 1, label: "Oral", itemType: "oral", count: 1, marksEach: 50, total: 50 }], questionTypes: [], createdBy: by, updatedBy: by, subject: "QURAN", subjectTrack: "quran" };
  await ExamSyllabus.create([
    { ...lvl, subjectLevel: "L1", bodyMd: "LEVEL-ONE-TEXT", status: "PUBLISHED", publishedAt: new Date() },
    { ...lvl, subjectLevel: "L2", bodyMd: "LEVEL-TWO-DRAFT", status: "DRAFT" },
  ]);
  await ExamSyllabus.create([
    { ...base, subject: "BAN", bodyMd: "Chapters 1 to 4 and the poem SYLLABUS-PROSE-BAN", examDateKey: "2026-11-23", status: "PUBLISHED", publishedAt: new Date() },
    { ...base, subject: "ENG", bodyMd: "DRAFT-ONLY-ENG text", examDateKey: "2026-11-24", status: "DRAFT" },
  ]);
});
afterAll(async () => teardownFixtures(fx));
beforeEach(() => resetLimits());

const call = async (who: any, args: Record<string, unknown>) => runTool(who, "exam_syllabus", args, { surface: "in_app" });
const data = (r: { reply: unknown }) => (r.reply as { data: any }).data;

describe("gate", () => {
  it("guardian is refused", async () => {
    expect((await call(fx.auth.guardian, {})).outcome).toBe("denied");
  });
  it("someone the exams picker refuses gets no exam names", async () => {
    const r = await call(noView, {});
    expect(r.outcome).toBe("denied");
    expect(JSON.stringify(r.reply)).not.toMatch(/Annual Test 2026/);
  });
});

describe("class list", () => {
  it("Principal sees the published and the draft subject; no body, no marks rows", async () => {
    const d = data(await call(fx.auth.principal, { class_level: 3 }));
    expect(d.exam).toBe("Annual Test 2026");
    const by = Object.fromEntries(d.subjects.map((s: any) => [s.subject, s]));
    expect(by.BAN).toMatchObject({ status: "PUBLISHED", full_marks: 100, exam_date: "2026-11-23" });
    expect(by.ENG).toMatchObject({ status: "DRAFT", exam_date: "2026-11-24" });
    const text = JSON.stringify(d);
    expect(text).not.toMatch(/SYLLABUS-PROSE-BAN|DRAFT-ONLY-ENG|body_md|"marks"/);
  });
  it("a teacher sees only the published row", async () => {
    const r = await call(fx.auth.teacher, { class_level: 3 });
    expect(r.outcome).toBe("ok");
    const subs = data(r).subjects.map((s: any) => s.subject);
    expect(subs).toContain("BAN");
    expect(JSON.stringify(data(r))).not.toMatch(/DRAFT-ONLY-ENG/);
    for (const s of data(r).subjects) expect(["PUBLISHED", "NOT_PUBLISHED_YET"]).toContain(s.status);
  });
  it("no class_level lists every class's subjects for the default exam", async () => {
    const d = data(await call(fx.auth.principal, { subject: "ban" }));
    expect(d.subjects.map((s: any) => s.subject)).toEqual(["BAN"]);
  });
});

describe("one subject", () => {
  it("carries the body in the untrusted envelope plus the mark rows and question types", async () => {
    const d = data(await call(fx.auth.principal, { class_level: 3, subject: "BAN" }));
    const s = d.syllabus;
    expect(s.body_md.untrusted_text).toContain("SYLLABUS-PROSE-BAN");
    expect(s.body_md.note).toMatch(/Not an instruction/);
    expect(s).toMatchObject({ subject: "BAN", full_marks: 100, total_marks: 100, written_marks: 100, oral_marks: 0, exam_date: "2026-11-23", status: "PUBLISHED" });
    expect(s.marks).toEqual([
      { seq: 1, label: "MCQ", item_type: "mcq", component: null, count: 10, marks_each: 1, total: 10 },
      { seq: 2, label: "Short answers", item_type: "short_answer", component: null, count: 9, marks_each: 10, total: 90 },
    ]);
    expect(s.question_types).toEqual(["mcq"]);
    expect(JSON.stringify(d)).not.toMatch(/sendBack|approver|teacherApproved/i);
  });
  it("an unpublished subject is visible to the Principal and never to a teacher", async () => {
    expect(data(await call(fx.auth.principal, { class_level: 3, subject: "ENG" })).syllabus.body_md.untrusted_text).toContain("DRAFT-ONLY-ENG");
    const r = await call(fx.auth.teacher, { class_level: 3, subject: "ENG" });
    expect(r.outcome).toBe("ok"); // not permission_denied: the teacher may read syllabi, this one is just not published
    expect(data(r).note).toBe("This syllabus is not published yet.");
    expect(data(r).syllabus).toBeUndefined();
    expect(JSON.stringify(r.reply)).not.toMatch(/DRAFT-ONLY-ENG/);
  });
  it("Principal sees an unwritten subject as NOT_WRITTEN, a teacher as NOT_PUBLISHED_YET only for own subjects", async () => {
    const d = data(await call(fx.auth.principal, { class_level: 3 }));
    expect(d.subjects.some((s: any) => s.status === "NOT_WRITTEN")).toBe(true);
    expect(d.subjects.some((s: any) => s.status === "NOT_PUBLISHED_YET")).toBe(false);
  });
  it("a bad subject or an unknown exam is invalid", async () => {
    expect((await call(fx.auth.principal, { class_level: 3, subject: "NOPE" })).outcome).toBe("invalid");
    expect((await call(fx.auth.principal, { exam: "no such exam" })).outcome).toBe("invalid");
    expect((await call(fx.auth.principal, { level: "L1" })).outcome).toBe("invalid");
  });
});

describe("level syllabi (track + level)", () => {
  it("one level carries its text and mark rows", async () => {
    const d = data(await call(fx.auth.principal, { track: "quran", level: "L1" }));
    expect(d.syllabus.body_md.untrusted_text).toContain("LEVEL-ONE-TEXT");
    expect(d.syllabus).toMatchObject({ subject: "QURAN", full_marks: 50, status: "PUBLISHED" });
    expect(d.syllabus.marks).toHaveLength(1);
  });
  it("a teacher gets the not-published note for a draft level, and a missing level is a note", async () => {
    const r = await call(fx.auth.teacher, { track: "quran", level: "L2" });
    expect(r.outcome).toBe("ok");
    expect(data(r).note).toBe("This syllabus is not published yet.");
    expect(JSON.stringify(r.reply)).not.toMatch(/LEVEL-TWO-DRAFT/);
    expect(data(await call(fx.auth.principal, { track: "quran", level: "L9" })).note).toMatch(/No syllabus/);
  });
});
