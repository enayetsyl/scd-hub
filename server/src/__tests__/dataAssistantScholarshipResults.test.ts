/**
 * Data assistant: scholarship_results (owner 17 Nov 2026). Exact marks / out-of / percent / position on a
 * 2-paper fixture, ABSENT is a status and never a zero, per_item is numbers only, the filters, the gate.
 * Every name here is invented.
 */
import { Types } from "mongoose";
import { runTool } from "../modules/data-assistant/runTool";
import { resetLimits } from "../modules/data-assistant/limits";
import { User } from "../modules/foundation/models/User";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ScholarshipPaper } from "../modules/scholarship/models/ScholarshipPaper";
import { ScholarshipScore } from "../modules/scholarship/models/ScholarshipScore";
import { ScholarshipTopic } from "../modules/scholarship/models/ScholarshipTopic";
import { setupFixtures, teardownFixtures, type Fx } from "./dataAssistantFixtures";

jest.setTimeout(180_000);
let fx: Fx;
let noView: { userId: string; role: "OFFICE" };
const ids = { cls: new Types.ObjectId(), sec: new Types.ObjectId() };
const stu: Record<string, Types.ObjectId> = { rina: new Types.ObjectId(), rima: new Types.ObjectId(), karim: new Types.ObjectId(), tina: new Types.ObjectId() };

const item = (itemNo: number, subject: string, topicCode: string, itemType: string, marks: number) => ({ itemNo, label: "SECRET QUESTION TEXT", subject, topicCode, chapters: [], itemType, marks });

beforeAll(async () => {
  fx = await setupFixtures();
  const u = new Types.ObjectId();
  await User.create([{ _id: u, role: "OFFICE", name: "No Scholar", email: "noscholar2@school.test", passwordHash: "x", active: true, grantedPermissions: ["data_assistant:use", "data_assistant:connect"], revokedPermissions: ["scholarship_practice:view"] }]);
  noView = { userId: String(u), role: "OFFICE" };
  await Class.create([{ _id: ids.cls, level: 5, nameBn: "পঞ্চম শ্রেণি", academicYearId: fx.ids.year }]);
  await Section.create([{ _id: ids.sec, classId: ids.cls, code: "A", nameBn: "ক শাখা" }]);
  const mk = (_id: Types.ObjectId, schoolId: string, name: string) => ({ _id, schoolId, name, nameBn: name, classId: ids.cls, sectionId: ids.sec, active: true });
  await Student.create([mk(stu.rina, "SCH-5-001", "Rina Sample"), mk(stu.rima, "SCH-5-002", "Rima Sample"), mk(stu.karim, "SCH-5-003", "Karim Sample"), mk(stu.tina, "SCH-5-004", "Tina Other")]);
  await ScholarshipTopic.create([
    { subject: "ENG", classLevel: 5, code: "ENG-APP", labelBn: "Application", axis: "skill", order: 1 },
    { subject: "ENG", classLevel: 5, code: "ENG-FILL", labelBn: "Fill in the blanks", axis: "skill", order: 2 },
    { subject: "MATH", classLevel: 5, code: "MATH-SHORT", labelBn: "Short questions", axis: "skill", order: 1 },
  ]);
  const base = { academicYearId: fx.ids.year, classLevel: 5, classId: ids.cls, sectionId: ids.sec, totalMarks: 100, status: "SCORED", declaredBy: new Types.ObjectId() };
  const items = [item(1, "ENG", "ENG-APP", "descriptive", 20), item(2, "ENG", "ENG-FILL", "fill_blank", 20), item(3, "MATH", "MATH-SHORT", "short_answer", 10)];
  const [p1, p2] = await ScholarshipPaper.create([
    { ...base, paperId: "SP-R-1", name: "Model Test One", paperDate: new Date("2026-10-01"), subjects: ["ENG", "MATH"], items },
    { ...base, paperId: "SP-R-2", name: "Model Test Two", paperDate: new Date("2026-11-01"), subjects: ["ENG"], items: items.slice(0, 2) },
  ]);
  const enteredBy = new Types.ObjectId();
  const sc = (paperId: Types.ObjectId, studentId: Types.ObjectId, marks: number[]) => ({
    paperId, studentId, status: "PRESENT", enteredBy, itemMarks: marks.map((m, i) => ({ itemNo: i + 1, marks: m })),
  });
  await ScholarshipScore.create([
    sc(p1._id, stu.rina, [10, 15, 5]), // 30 / 50 = 60.0
    sc(p1._id, stu.rima, [20, 10, 10]), // 40 / 50 = 80.0
    sc(p2._id, stu.rina, [20, 20]), // 40 / 40 = 100.0
    sc(p2._id, stu.rima, [10, 10]), // 20 / 40 = 50.0
    { paperId: p1._id, studentId: stu.karim, status: "ABSENT", enteredBy, itemMarks: [] },
    { paperId: p2._id, studentId: stu.karim, status: "ABSENT", enteredBy, itemMarks: [] },
    // Tina has no score row at all on either paper -> NOT_ENTERED
  ]);
});
afterAll(async () => teardownFixtures(fx));
beforeEach(() => resetLimits());

const call = async (who: any, args: Record<string, unknown>) => runTool(who, "scholarship_results", args, { surface: "in_app" });
const data = (r: { reply: unknown }) => (r.reply as { data: any }).data;

describe("gate", () => {
  it("is refused without scholarship_practice:view, naming the switch", async () => {
    const r = await call(noView, {});
    expect(r.outcome).toBe("denied");
    expect((r.reply as { needs: string[] }).needs).toEqual(["scholarship_practice:view"]);
  });
  it("guardian is refused; principal passes", async () => {
    expect((await call(fx.auth.guardian, {})).outcome).toBe("denied");
    expect((await call(fx.auth.principal, {})).outcome).toBe("ok");
  });
});

describe("rows", () => {
  it("exact marks, out-of, percent, position on both papers, newest paper first", async () => {
    const d = data(await call(fx.auth.principal, {}));
    expect(d.rows).toHaveLength(8); // 2 papers x 4 sitting students
    const get = (paper: string, name: string) => d.rows.find((r: any) => r.paper === paper && r.name === name);
    expect(get("Model Test One", "Rina Sample")).toMatchObject({ status: "PRESENT", marks_obtained: 30, marks_out_of: 50, full_marks: 50, percent: 60, position: 2, of: 2, paper_id: "SP-R-1" });
    expect(get("Model Test One", "Rima Sample")).toMatchObject({ marks_obtained: 40, percent: 80, position: 1, of: 2 });
    expect(get("Model Test Two", "Rina Sample")).toMatchObject({ marks_obtained: 40, marks_out_of: 40, full_marks: 40, percent: 100, position: 1 });
    expect(get("Model Test Two", "Rima Sample")).toMatchObject({ percent: 50, position: 2 });
    expect(d.rows[0].paper).toBe("Model Test Two"); // date desc
    expect(d.rows[0].name).toBe("Rina Sample"); // then position
    const p1 = d.papers.find((p: any) => p.paper === "Model Test One");
    expect(p1).toMatchObject({ date: "2026-10-01", full_marks: 50, sat: 2, absent: 1, class_average_percent: 70, highest_percent: 80, lowest_percent: 60 });
    expect(d.papers[0].paper).toBe("Model Test Two");
  });
  it("absent and not-entered are statuses with null marks, never zero", async () => {
    const d = data(await call(fx.auth.principal, { student: "SCH-5-003" }));
    expect(d.rows).toHaveLength(2);
    for (const r of d.rows) expect(r).toMatchObject({ status: "ABSENT", marks_obtained: null, marks_out_of: null, percent: null, position: null });
    const t = data(await call(fx.auth.principal, { student: "SCH-5-004" }));
    for (const r of t.rows) expect(r).toMatchObject({ status: "NOT_ENTERED", marks_obtained: null, percent: null });
  });
  it("per_item gives numbers and labels only, never question text", async () => {
    const d = data(await call(fx.auth.principal, { student: "SCH-5-001", paper: "SP-R-1", per_item: true }));
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].items).toEqual([
      { item_no: 1, subject: "ENG", type: "Application", marks_available: 20, marks_obtained: 10 },
      { item_no: 2, subject: "ENG", type: "Fill in the blanks", marks_available: 20, marks_obtained: 15 },
      { item_no: 3, subject: "MATH", type: "Short questions", marks_available: 10, marks_obtained: 5 },
    ]);
    expect(JSON.stringify(d)).not.toMatch(/SECRET QUESTION TEXT|untrusted|comment/i);
    expect(data(await call(fx.auth.principal, { student: "SCH-5-001" })).rows[0].items).toBeUndefined();
  });
});

describe("filters", () => {
  it("last, paper (name or id), dates and subject narrow the papers", async () => {
    expect(data(await call(fx.auth.principal, { last: 1 })).papers.map((p: any) => p.paper)).toEqual(["Model Test Two"]);
    expect(data(await call(fx.auth.principal, { paper: "test one" })).papers.map((p: any) => p.paper)).toEqual(["Model Test One"]);
    expect(data(await call(fx.auth.principal, { paper: "SP-R-2" })).papers.map((p: any) => p.paper)).toEqual(["Model Test Two"]);
    expect(data(await call(fx.auth.principal, { from: "2026-10-15" })).papers.map((p: any) => p.paper)).toEqual(["Model Test Two"]);
    expect(data(await call(fx.auth.principal, { to: "2026-10-15" })).papers.map((p: any) => p.paper)).toEqual(["Model Test One"]);
    // MATH only exists on paper one, and only its 10 marks count.
    const m = data(await call(fx.auth.principal, { subject: "math", student: "SCH-5-001" }));
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ marks_obtained: 5, marks_out_of: 10, full_marks: 10, percent: 50 });
  });
  it("student: ambiguous returns candidates, no match and a reversed range are invalid", async () => {
    const d = data(await call(fx.auth.principal, { student: "Sample" }));
    expect(d.ambiguous).toBe(true);
    expect(d.candidates).toHaveLength(3);
    expect((await call(fx.auth.principal, { student: "Nobody Here" })).outcome).toBe("invalid");
    expect((await call(fx.auth.principal, { from: "2026-11-02", to: "2026-11-01" })).outcome).toBe("invalid");
    expect((await call(fx.auth.principal, { paper: "nothing like it" })).outcome).toBe("ok");
  });
});

describe("ties and the per_item rule", () => {
  it("equal percents share the place: 1, 2, 2, 4", async () => {
    const [p3] = await ScholarshipPaper.create([{ academicYearId: fx.ids.year, classLevel: 5, classId: ids.cls, sectionId: ids.sec, totalMarks: 10, status: "SCORED", declaredBy: new Types.ObjectId(), paperId: "SP-R-3", name: "Tie Test", paperDate: new Date("2026-12-01"), subjects: ["ENG"], items: [item(1, "ENG", "ENG-APP", "descriptive", 10)] }]);
    const enteredBy = new Types.ObjectId();
    const sc = (studentId: Types.ObjectId, m: number) => ({ paperId: p3._id, studentId, status: "PRESENT", enteredBy, itemMarks: [{ itemNo: 1, marks: m }] });
    await ScholarshipScore.create([sc(stu.rina, 10), sc(stu.rima, 6), sc(stu.karim, 6), sc(stu.tina, 5)]);
    try {
      const d = data(await call(fx.auth.principal, { paper: "SP-R-3" }));
      expect(d.rows.map((r: any) => [r.percent, r.position, r.of])).toEqual([[100, 1, 4], [60, 2, 4], [60, 2, 4], [50, 4, 4]]);
    } finally {
      await ScholarshipScore.deleteMany({ paperId: p3._id });
      await ScholarshipPaper.deleteOne({ _id: p3._id });
    }
  });
  it("per_item needs a student or a paper", async () => {
    const r = await call(fx.auth.principal, { per_item: true });
    expect(r.outcome).toBe("invalid");
    expect(JSON.stringify(r.reply)).toMatch(/narrow/);
    expect((await call(fx.auth.principal, { per_item: true, paper: "SP-R-1" })).outcome).toBe("ok");
  });
  it("the paper summary names highest_percent / lowest_percent", async () => {
    const p = data(await call(fx.auth.principal, {})).papers[1];
    expect(p).toMatchObject({ highest_percent: 80, lowest_percent: 60 });
    expect(p.highest).toBeUndefined();
  });
});
