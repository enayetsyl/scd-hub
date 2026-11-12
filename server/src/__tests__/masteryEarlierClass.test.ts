/**
 * PR-B — a work sheet can carry an earlier class's objectives (docs/prd-mastery-earlier-class.md,
 * D-#1314–#1316).
 *
 * 1. A Class 2 section's sheet with a Class 1 code is created; with a Class 3 code it is refused.
 * 2. Marks are snapshotted from the Class 1 table; an earlier-only sheet is titled "ভিত্তি যাচাই".
 * 3. After confirmation, a student weak on a Class 2 row whose prerequisite is that Class 1 code
 *    sees the Class 1 step's real state (before the baseline: "no data").
 * 4. The summary lists the code with correct counts; the heat-map, the student view, the rows the
 *    assignment builder reads and the trigger are unchanged by the extra rows.
 *
 * In-memory MongoDB, real services; only the routine lookup is stubbed.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryAction } from "../modules/mastery/models/MasteryAction";
import { MasteryEvidence } from "../modules/mastery/models/MasteryEvidence";
import { importCatalogue, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, saveResults } from "../modules/mastery/services/MasteryWorkService";
import {
  earlierClassSummary,
  liveSectionRows,
  sectionHeatmap,
  studentDiagnosis,
} from "../modules/mastery/services/MasteryDiagnosisService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
let sectionId = "";
const sids: string[] = [];

const C1 = "LO-C1-MATH-03-01";
const C2 = "LO-C2-MATH-04-01";
const C3 = "LO-C3-MATH-07-02";

const catalogue = (classToken: string, code: string, word: number, short: number) =>
  JSON.stringify({
    classToken,
    subject: "MATH",
    status: "LOCKED",
    chapters: [{ number: Number(code.split("-")[3]), titleBn: "অধ্যায়" }],
    outcomes: [{ code, labelBn: `${classToken} ধাপ`, assess: "QUESTION", questionTypeCodes: ["QT-WORD", "QT-SHORT"] }],
    questionTypes: [
      { code: "QT-WORD", labelBn: "কথার অঙ্ক", marks: word },
      { code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: short },
    ],
  });

const item = (loCode: string, n: number, questionTypeCode = "QT-WORD") => ({
  origin: "TEACHER" as const, textBn: `প্রশ্ন ${loCode} ${n}`, loCode, questionTypeCode,
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  const [cls] = await Class.create([{ level: 2, nameBn: "দ্বিতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = String(sec._id);
  for (let i = 1; i <= 4; i++) {
    const [s] = await Student.create([{ schoolId: `EC-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
  }
  for (const [t, code, word, short] of [["C1", C1, 3, 1], ["C2", C2, 5, 2], ["C3", C3, 4, 1]] as const) {
    const r = await importCatalogue(catalogue(t, code, word, short), true, PRINCIPAL);
    if (!r.ok) throw new Error(r.errors.join("; "));
  }
  // The Class 2 row names the Class 1 step as its prerequisite (the D-#927 ladder).
  await MasteryOutcome.updateOne({ code: C2 }, { $set: { prereqCodes: [C1] } });
  await setEnablement(String(year._id), "C2", "MATH", true, PRINCIPAL);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

const sheet = (items: ReturnType<typeof item>[], date: string, title?: string) =>
  createPaper({ sectionId, subject: "MATH", source: "HW", date, title, items }, TEACHER);

/** Every listed student scores 0 on every item; the rest full marks by default. */
async function zeroFor(paperId: string, students: string[], itemNos: number[]): Promise<void> {
  await saveResults(paperId, students.map((studentId) => ({ studentId, items: itemNos.map((itemNo) => ({ itemNo, marks: 0 })) })), TEACHER);
  await confirmPaper(paperId, TEACHER);
}

describe("an earlier class's code on a sheet", () => {
  it("acceptance 1 + 2: a Class 1 code is accepted with Class 1 marks; a Class 3 code is refused", async () => {
    await expect(sheet([item(C3, 1)], "2027-02-01")).rejects.toThrow(/পরের শ্রেণির/);
    const mixed = await sheet([item(C2, 1), item(C1, 2), item(C1, 3, "QT-SHORT")], "2027-02-01");
    // QT-WORD is 5 in the Class 2 table and 3 in the Class 1 table; QT-SHORT 1 in Class 1.
    expect(mixed.items.map((i) => [i.loCodes[0], i.marks])).toEqual([[C2, 5], [C1, 3], [C1, 1]]);
    expect(mixed.title).toBeNull();
    const baseline = await sheet([item(C1, 4)], "2027-02-01");
    expect(baseline.title).toBe("ভিত্তি যাচাই");
    expect((await sheet([item(C1, 5)], "2027-02-01", "শুরুর পরীক্ষা")).title).toBe("শুরুর পরীক্ষা");
  });

  it("acceptance 3 + 4: the earlier step shows its real state; the summary counts it; section views ignore it", async () => {
    // Clean slate for evidence (the papers above were never confirmed — no evidence yet).
    expect(await MasteryEvidence.countDocuments({})).toBe(0);
    const [a, b, c, d] = sids;

    // Class 2 work: student a weak on the Class 2 row (two questions, 0 on both).
    const p2 = await sheet([item(C2, 10), item(C2, 11)], "2027-03-01");
    await zeroFor(p2.paperId, [a], [1, 2]);
    let diag = await studentDiagnosis(a, "MATH", TEACHER);
    let row = diag.outcomes.find((o) => o.loCode === C2)!;
    expect(row.state).toBe("WEAK");
    expect(row.earlierSteps).toEqual([expect.objectContaining({ code: C1, crossClass: true, noData: true, state: null })]);

    // Two baseline sheets on the Class 1 code: a, b, c score 0 (75% weak — over the trigger line).
    for (const [n, date] of [[20, "2027-03-02"], [21, "2027-03-09"]] as const) {
      const p = await sheet([item(C1, n)], date);
      expect(p.title).toBe("ভিত্তি যাচাই");
      await zeroFor(p.paperId, [a, b, c], [1]);
    }
    // Evidence is written on the paper's section and class, for the Class 1 code.
    const ev = await MasteryEvidence.find({ loCode: C1, supersededAt: null }).lean();
    expect(ev).toHaveLength(8);
    expect(new Set(ev.map((e) => `${e.classToken}|${String(e.sectionId)}`))).toEqual(new Set([`C2|${sectionId}`]));

    // 3: the earlier step now carries the student's real Class 1 state.
    diag = await studentDiagnosis(a, "MATH", TEACHER);
    row = diag.outcomes.find((o) => o.loCode === C2)!;
    expect(row.earlierSteps).toEqual([expect.objectContaining({ code: C1, crossClass: true, noData: false, state: "WEAK" })]);
    // The student view lists only the section's own rows and counts only them.
    expect(diag.outcomes.map((o) => o.loCode)).toEqual([C2]);

    // 4: the summary.
    const sum = await earlierClassSummary(sectionId, "MATH", {}, TEACHER);
    expect(sum.total).toBe(1);
    expect(sum.rows[0]).toMatchObject({ code: C1, classToken: "C1", labelBn: "C1 ধাপ", assessed: 4, weak: 3 });
    expect(sum.rows[0].weakStudents.map((s) => s.studentId)).toEqual([a, b, c]);
    expect(sum.rows[0].weakStudents.map((s) => s.studentId)).not.toContain(d);

    // The heat-map, the assignment builder's rows and the trigger are unchanged by the extra rows.
    const heat = await sectionHeatmap(sectionId, "MATH", TEACHER);
    expect(heat.outcomes.map((o) => o.loCode)).toEqual([C2]);
    expect(heat.students.find((s) => s.studentId === b)!.weakCount).toBe(0);
    const own = await liveSectionRows(new Types.ObjectId(sectionId), "MATH");
    expect(new Set(own.map((r) => r.loCode))).toEqual(new Set([C2]));
    const withEarlier = await liveSectionRows(new Types.ObjectId(sectionId), "MATH", undefined, { includeEarlierClasses: true });
    expect(new Set(withEarlier.map((r) => r.loCode))).toEqual(new Set([C1, C2]));
    expect(await MasteryAction.countDocuments({ loCode: C1 })).toBe(0);
  });

  it("PR-K: a child with baseline evidence shows the ভিত্তি যাচাই rows with the right states; a child without does not", async () => {
    const [a, b, c, d] = sids;
    // After the previous test: a, b, c scored 0 on the Class 1 code (WEAK); d was never assessed on it.
    const withBaseline = await studentDiagnosis(a, "MATH", TEACHER);
    expect(withBaseline.baseline).toEqual([
      expect.objectContaining({ loCode: C1, labelBn: "C1 ধাপ", classToken: "C1", state: "WEAK" }),
    ]);
    expect(withBaseline.baseline[0].lastEvidenceAt).toMatch(/^2027-03-09/);
    // Own-class rows are untouched by the extra section.
    expect(withBaseline.outcomes.map((o) => o.loCode)).toEqual([C2]);
    expect((await studentDiagnosis(b, "MATH", TEACHER)).baseline.map((r) => [r.loCode, r.state])).toEqual([[C1, "WEAK"]]);
    expect((await studentDiagnosis(c, "MATH", TEACHER)).baseline).toHaveLength(1);
    // d was on the roster, so the confirmed sheet gave them full marks by default: judged, not weak.
    const dBase = (await studentDiagnosis(d, "MATH", TEACHER)).baseline;
    expect(dBase).toHaveLength(1);
    expect(dBase[0].state).not.toBe("WEAK");
    expect(dBase[0].state).not.toBe("NOT_ASSESSED");

    // A child who joined after the baseline sheets has no evidence on an earlier-class code: the list is empty.
    const sec = await Section.findById(sectionId).lean();
    const [late] = await Student.create([{ schoolId: "EC-9", name: "Late Joiner", rollNumber: "9", classId: sec!.classId, sectionId: sec!._id, active: true }]);
    expect((await studentDiagnosis(String(late._id), "MATH", TEACHER)).baseline).toEqual([]);
  });

  it("the summary is empty for a section with no earlier-class evidence of that subject", async () => {
    const sum = await earlierClassSummary(sectionId, "BAN" as never, {}, PRINCIPAL);
    expect(sum).toMatchObject({ rows: [], total: 0 });
  });
});
