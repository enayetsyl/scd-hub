/**
 * Data assistant: scholarship_analysis (owner 16 Nov 2026). Gate, class overview shape, student
 * detail (weak <= 2 per subject, insufficient never weak, ABSENT is not a zero), ambiguous name
 * -> candidates, numbers only, and the registry order of the older tools unchanged.
 * Every name here is invented.
 */
import { Types } from "mongoose";
import { runTool } from "../modules/data-assistant/runTool";
import { resetLimits } from "../modules/data-assistant/limits";
import { TOOL_REGISTRY } from "../modules/data-assistant/tools/registry";
import { practiceHintBn } from "../modules/scholarship/practiceHint";
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
const stu: Record<string, Types.ObjectId> = { rina: new Types.ObjectId(), rima: new Types.ObjectId(), karim: new Types.ObjectId() };

const item = (itemNo: number, subject: string, topicCode: string, itemType: string, marks: number) => ({ itemNo, label: topicCode, subject, topicCode, chapters: [], itemType, marks });

beforeAll(async () => {
  fx = await setupFixtures();
  const u = new Types.ObjectId();
  await User.create([{ _id: u, role: "OFFICE", name: "No Scholar", email: "noscholar@school.test", passwordHash: "x", active: true, grantedPermissions: ["data_assistant:use", "data_assistant:connect"], revokedPermissions: ["scholarship_practice:view"] }]);
  noView = { userId: String(u), role: "OFFICE" };
  await Class.create([{ _id: ids.cls, level: 5, nameBn: "পঞ্চম শ্রেণি", academicYearId: fx.ids.year }]);
  await Section.create([{ _id: ids.sec, classId: ids.cls, code: "A", nameBn: "ক শাখা" }]);
  const mk = (_id: Types.ObjectId, schoolId: string, name: string) => ({ _id, schoolId, name, nameBn: name, classId: ids.cls, sectionId: ids.sec, active: true });
  await Student.create([mk(stu.rina, "SCH-5-001", "Rina Sample"), mk(stu.rima, "SCH-5-002", "Rima Sample"), mk(stu.karim, "SCH-5-003", "Karim Sample")]);
  await ScholarshipTopic.create([
    { subject: "ENG", classLevel: 5, code: "ENG-APP", labelBn: "Application", axis: "skill", order: 1 },
    { subject: "ENG", classLevel: 5, code: "ENG-FILL", labelBn: "Fill in the blanks", axis: "skill", order: 2 },
    { subject: "ENG", classLevel: 5, code: "ENG-TINY", labelBn: "Capital letters", axis: "skill", order: 3 },
    { subject: "MATH", classLevel: 5, code: "MATH-SHORT", labelBn: "সংক্ষিপ্ত প্রশ্ন", axis: "skill", order: 1 },
  ]);
  const base = { academicYearId: fx.ids.year, classLevel: 5, classId: ids.cls, sectionId: ids.sec, totalMarks: 100, status: "SCORED", declaredBy: new Types.ObjectId() };
  const items = [item(1, "ENG", "ENG-APP", "descriptive", 20), item(2, "ENG", "ENG-FILL", "fill_blank", 20), item(3, "ENG", "ENG-TINY", "fill_blank", 2), item(4, "MATH", "MATH-SHORT", "short_answer", 30)];
  const [p1, p2] = await ScholarshipPaper.create([
    { ...base, paperId: "SP-T-1", name: "Model Test 1", paperDate: new Date("2026-10-01"), subjects: ["ENG", "MATH"], items },
    { ...base, paperId: "SP-T-2", name: "Model Test 2", paperDate: new Date("2026-11-01"), subjects: ["ENG"], items: items.slice(0, 3) },
  ]);
  const enteredBy = new Types.ObjectId();
  const sc = (paperId: Types.ObjectId, studentId: Types.ObjectId, marks: number[]) => ({
    paperId, studentId, status: "PRESENT", enteredBy, itemMarks: marks.map((m, i) => ({ itemNo: i + 1, marks: m })),
  });
  await ScholarshipScore.create([
    sc(p1._id, stu.rina, [4, 18, 0, 25]), // Application weak, Fill good, tiny item zero
    sc(p1._id, stu.rima, [16, 10, 2, 10]),
    sc(p2._id, stu.rina, [6, 19, 0]),
    sc(p2._id, stu.rima, [15, 12, 2]),
    { paperId: p2._id, studentId: stu.karim, status: "ABSENT", enteredBy, itemMarks: [] },
    { paperId: p1._id, studentId: stu.karim, status: "ABSENT", enteredBy, itemMarks: [] },
  ]);
});
afterAll(async () => teardownFixtures(fx));
beforeEach(() => resetLimits());

const call = async (who: any, args: Record<string, unknown>) => runTool(who, "scholarship_analysis", args, { surface: "in_app" });
const data = (r: { reply: unknown }) => (r.reply as { data: any }).data;

describe("gate", () => {
  it("is refused without scholarship_practice:view, naming the switch", async () => {
    const r = await call(noView, {});
    expect(r.outcome).toBe("denied");
    expect((r.reply as { needs: string[] }).needs).toEqual(["scholarship_practice:view"]);
  });
  it("guardian is refused; principal, office and teacher (screen default) pass", async () => {
    expect((await call(fx.auth.guardian, {})).outcome).toBe("denied");
    for (const w of ["principal", "office", "teacher"] as const) expect((await call(fx.auth[w], {})).outcome).toBe("ok");
  });
});

describe("class overview", () => {
  it("papers scored, class average, weakest types and one line per sitting student", async () => {
    const d = data(await call(fx.auth.principal, {}));
    expect(d.class_level).toBe(5);
    expect(d.sitting_students).toBe(3);
    const eng = d.subjects.find((s: any) => s.subject === "ENG");
    const math = d.subjects.find((s: any) => s.subject === "MATH");
    expect(eng.papers_scored).toBe(2);
    expect(math.papers_scored).toBe(1);
    expect(math.note).toMatch(/fewer than 2/);
    expect(typeof eng.class_average_percent).toBe("number");
    expect(eng.weakest_types.length).toBeLessThanOrEqual(2);
    for (const t of eng.weakest_types) expect(Object.keys(t).sort()).toEqual(["band", "class_percent", "marks_available", "type"]);
    expect(d.students).toHaveLength(3);
    const karim = d.students.find((s: any) => s.name === "Karim Sample");
    expect(karim.papers_sat).toBe(0);
    expect(karim.overall_percent).toBeNull(); // absent is not zero
    expect(Object.keys(d.students[0]).sort()).toEqual(["name", "overall_percent", "papers_sat", "school_id", "student_id", "weakest_subject"]);
  });
});

describe("student detail", () => {
  it("weak <= 2 per subject with a Bangla hint; insufficient listed apart, never weak", async () => {
    const d = data(await call(fx.auth.principal, { student: "SCH-5-001" }));
    expect(d.student.name).toBe("Rina Sample");
    expect(d.papers_sat).toBe(2);
    expect(d.paper_trend.map((p: any) => p.paper)).toEqual(["Model Test 1", "Model Test 2"]);
    // Exact marks, not only % (owner 17 Nov): 4+18+0+25 of 20+20+2+30, then 6+19+0 of 20+20+2.
    expect(d.paper_trend.map((p: any) => [p.marks_obtained, p.marks_out_of, p.full_marks])).toEqual([[47, 72, 72], [25, 42, 42]]);
    expect(d.paper_trend[0].percent).toBeCloseTo(65.3, 1);
    expect(d.paper_trend[0].note).toBeUndefined();
    const bySub: Record<string, number> = {};
    for (const w of d.weakest_types) {
      bySub[w.subject] = (bySub[w.subject] ?? 0) + 1;
      expect(w.practice_hint_bn).toMatch(/[ঀ-৿]/);
      expect(["weak", "fair"]).toContain(w.band);
    }
    for (const n of Object.values(bySub)) expect(n).toBeLessThanOrEqual(2);
    expect(d.weakest_types.find((w: any) => w.type === "Application")).toBeTruthy();
    expect(d.strengths.find((s: any) => s.type === "Fill in the blanks")).toBeTruthy();
    expect(d.subjects.find((s: any) => s.subject === "ENG")).toMatchObject({ papers_scored: 2 });
    // The 2-mark/2-paper item earned zero: a zero always earns a verdict (D-#699), so it may be weak —
    // but nothing listed as weak may be an insufficient row.
    for (const w of d.weakest_types) expect(d.not_enough_data.find((n: any) => n.type === w.type)).toBeUndefined();
  });
  it("an absent child has no numbers, not zeros", async () => {
    const d = data(await call(fx.auth.principal, { student: "SCH-5-003" }));
    expect(d.overall_percent).toBeNull();
    expect(d.papers_sat).toBe(0);
    expect(d.weakest_types).toEqual([]);
  });
  it("an ambiguous name returns candidates; no match is invalid", async () => {
    const d = data(await call(fx.auth.principal, { student: "Sample" }));
    expect(d.ambiguous).toBe(true);
    expect(d.candidates).toHaveLength(3);
    expect((await call(fx.auth.principal, { student: "Nobody Here" })).outcome).toBe("invalid");
  });
  it("returns numbers only: no item text, note or comment keys", async () => {
    const text = JSON.stringify(data(await call(fx.auth.principal, { student: "SCH-5-002" })));
    expect(text).not.toMatch(/untrusted|"note"|comment/i);
  });
  it("the chapter axis carries no practice hint", async () => {
    const d = data(await call(fx.auth.principal, { student: "SCH-5-001", axis: "chapter" }));
    for (const w of d.weakest_types) expect(w.practice_hint_bn).toBeNull();
  });
});

describe("registry and hint", () => {
  it("the older tools keep their order; the new one is last", () => {
    const names = TOOL_REGISTRY.map((t) => t.name);
    expect(names[names.length - 1]).toBe("scholarship_analysis");
    expect(names.slice(-2, -1)).toEqual(["monthly_report_status"]);
    expect(names[0]).toBe("my_access");
  });
  it("practiceHintBn maps types to rules", () => {
    expect(practiceHintBn("Application", "ENG")).toMatch(/কাঠামো/);
    expect(practiceHintBn("সংক্ষিপ্ত প্রশ্ন", "MATH")).toMatch(/দুই–তিন বাক্যে/);
    expect(practiceHintBn("অন্য কিছু", "MATH")).toMatch(/একটিই মডেল টেস্ট/);
    expect(practiceHintBn("অন্য কিছু", "SCI")).toMatch(/আলাদা খাতায়/);
  });
});
