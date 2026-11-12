/**
 * PR-C — the class test and its question sheet are one entry (docs/prd-mastery-class-test-link.md,
 * D-#1317–#1320).
 *
 * 1. With no linked sheet the class-test path is unchanged (the guard answers null).
 * 2. A sheet whose items total 18 on a 20-mark test is refused at creation.
 * 3. Confirming writes PRESENT + total for present students and ABSENT for absent ones, and keeps
 *    the comments (and AI-check stamp) typed earlier.
 * 4. Direct mark entry on a linked test is refused; saving comments with the same mark succeeds.
 * 5. A total-changing correction after submit is refused; a tag-only correction is accepted.
 * 6. A second sheet for the same test, and a sheet for a group test, are refused.
 * +  NOT_SUBMITTED refused on a linked sheet; confirm waits for PRINTED; options + link read; a
 *    mismatch left by another flow is listed; deleting an OPEN sheet frees the test.
 *
 * In-memory MongoDB, real services (mastery + class-test); only the routine lookup is stubbed.
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
import { ClassTest } from "../modules/trackers/models/ClassTest";
import { ClassTestResult } from "../modules/trackers/models/ClassTestResult";
import { enterResult } from "../modules/trackers/services/ClassTestResultService";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { importCatalogue, saveTag, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import {
  classTestLinkOptions,
  classTestSheetLink,
  confirmPaper,
  createPaper,
  deletePaper,
  paperDetail,
  saveResults,
} from "../modules/mastery/services/MasteryWorkService";
import { classTestEntryGuard, ctOutcomeOf } from "../modules/mastery/classTestLink";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
let yearId: Types.ObjectId;
let sectionId = "";
let otherSectionId = "";
const sids: string[] = [];
let seq = 0;

const LO = "LO-C3-MATH-07-02";
const CATALOGUE = JSON.stringify({
  classToken: "C3",
  subject: "MATH",
  status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [{ code: LO, labelBn: "ভাগফল ও ভাগশেষ", assess: "QUESTION", questionTypeCodes: ["QT-WORD", "QT-SHORT"] }],
  questionTypes: [
    { code: "QT-WORD", labelBn: "কথার অঙ্ক", marks: 5 },
    { code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 1 },
  ],
});

async function classTest(over: Record<string, unknown> = {}) {
  seq += 1;
  return ClassTest.create({
    ctId: `CT-C3-MATH-${String(seq).padStart(4, "0")}`, academicYearId: yearId, sectionId: new Types.ObjectId(sectionId),
    subject: "MATH", testNumber: seq, examDate: new Date("2026-10-01T00:00:00Z"), totalMarks: 20, passMark: 8,
    source: "UPLOADED_PAPER", status: "PRINTED", requestedBy: new Types.ObjectId(TEACHER_ID), teacherId: new Types.ObjectId(TEACHER_ID),
    ...over,
  });
}

const word = (n: number) => ({ origin: "TEACHER" as const, textBn: `প্রশ্ন ${n}`, loCode: LO, questionTypeCode: "QT-WORD" });
const short = (n: number) => ({ origin: "TEACHER" as const, textBn: `ছোট ${n}`, loCode: LO, questionTypeCode: "QT-SHORT" });
const sheet = (classTestId: string | null, items = [word(1), word(2), word(3), word(4)], source: "CT" | "HW" = "CT") =>
  createPaper({ sectionId, subject: "MATH", source, date: "2026-11-01", classTestId, items }, TEACHER);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") }]);
  yearId = year._id as Types.ObjectId;
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  const [sec2] = await Section.create([{ classId: cls._id, code: "G", nameBn: "বালিকা" }]);
  sectionId = String(sec._id);
  otherSectionId = String(sec2._id);
  for (let i = 1; i <= 3; i++) {
    const [s] = await Student.create([{ schoolId: `CTL-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
  }
  const r = await importCatalogue(CATALOGUE, true, PRINCIPAL);
  if (!r.ok) throw new Error(r.errors.join("; "));
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  await saveTag({
    code: "MESSY", labelBn: "অগোছালো", appliesTo: "ITEM", effect: "LIGHT", allScopes: true, scopes: [], active: true,
  } as never, PRINCIPAL);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

describe("ctOutcomeOf (pure)", () => {
  const paper = { items: [{ itemNo: 1, marks: 5 }, { itemNo: 2, marks: 5 }] } as never;
  it("absent → ABSENT, no row → full marks, exceptions → the earned total", () => {
    expect(ctOutcomeOf(paper, { status: "ABSENT" })).toEqual({ status: "ABSENT", marks: null });
    expect(ctOutcomeOf(paper, null)).toEqual({ status: "PRESENT", marks: 10 });
    expect(ctOutcomeOf(paper, { items: [{ itemNo: 2, marks: 2.5 }] })).toEqual({ status: "PRESENT", marks: 7.5 });
    expect(ctOutcomeOf(paper, { status: "VOID", items: [{ itemNo: 1, marks: 0 }] })).toEqual({ status: "PRESENT", marks: 5 });
  });
});

describe("creating a linked sheet", () => {
  it("acceptance 1: with no sheet the class-test entry guard says nothing", async () => {
    const t = await classTest();
    expect(await classTestEntryGuard(String(t._id), sids[0], "PRESENT", 12)).toBeNull();
    const r = await enterResult({ testId: String(t._id), studentId: sids[0], status: "PRESENT", marks: 12, actorId: TEACHER_ID });
    expect(r.marks).toBe(12);
  });

  it("acceptance 2 + 6: totals must match; group test, other section, HW source and a second sheet are refused", async () => {
    const t = await classTest();
    await expect(sheet(String(t._id), [word(1), word(2), word(3), short(4), short(5), short(6)])).rejects.toThrow(/১৮.*২০/);
    await expect(sheet(String(t._id), [word(1), word(2), word(3), word(4)], "HW")).rejects.toThrow(/ক্লাস টেস্টের শিট/);
    const group = await classTest({ sectionId: null, subjectGroupId: new Types.ObjectId() });
    await expect(sheet(String(group._id))).rejects.toThrow(/দলভিত্তিক/);
    const other = await classTest({ sectionId: new Types.ObjectId(otherSectionId) });
    await expect(sheet(String(other._id))).rejects.toThrow(/শাখা ও বিষয়ের নয়/);

    const p = await sheet(String(t._id));
    expect(p.classTestId).toBe(String(t._id));
    expect(p.date).toBe("2026-10-01"); // the test's exam date, not the date typed
    expect(p.totalMarks).toBe(20);
    await expect(sheet(String(t._id))).rejects.toThrow(/আগেই তৈরি/);
  });

  it("options list the section's unlinked section tests; deleting an OPEN sheet frees the test", async () => {
    await ClassTest.deleteMany({});
    await MasteryPaper.deleteMany({});
    const recent = { examDate: new Date() }; // the options window is the last 30 days onwards
    const free = await classTest(recent);
    const linked = await classTest(recent);
    await classTest({ ...recent, sectionId: null, subjectGroupId: new Types.ObjectId() });
    await classTest({ ...recent, status: "CANCELLED" });
    await classTest({ examDate: new Date(Date.now() - 45 * 86_400_000) }); // too old
    const p = await sheet(String(linked._id));
    let opts = await classTestLinkOptions(sectionId, "MATH", TEACHER);
    expect(opts.map((o) => o.classTestId)).toEqual([String(free._id)]);
    const link = await classTestSheetLink(String(linked._id));
    expect(link).toMatchObject({ enabled: true, paperId: p.paperId, entryState: "OPEN", sectionId, classLevel: 3 });

    expect(await deletePaper(p.paperId, TEACHER)).toBe(true);
    opts = await classTestLinkOptions(sectionId, "MATH", TEACHER);
    expect(opts.map((o) => o.classTestId).sort()).toEqual([String(free._id), String(linked._id)].sort());
    expect((await sheet(String(linked._id))).classTestId).toBe(String(linked._id));
  });
});

describe("confirming and correcting a linked sheet", () => {
  it("confirm waits for a PRINTED test", async () => {
    const t = await classTest({ status: "REQUESTED" });
    const p = await sheet(String(t._id));
    await expect(confirmPaper(p.paperId, TEACHER)).rejects.toThrow(/ছাপা হয়নি/);
  });

  it("acceptance 3 / 4 / 5 + mismatch warning", async () => {
    const t = await classTest();
    const testId = String(t._id);
    const [a, b, c] = sids;
    // Comments typed on the class test earlier, with an AI-check stamp (a draft result).
    await ClassTestResult.create({
      testId: t._id, studentId: new Types.ObjectId(a), status: "PRESENT", marks: 9, enteredBy: new Types.ObjectId(TEACHER_ID),
      weakness: "ভাগশেষ ভুলে যায়", teacherAction: "আলাদা অনুশীলন", guardianAction: "বাসায় পাঁচটি ভাগ",
      aiCheck: { status: "CHECKED", at: new Date() },
    });

    const p = await sheet(testId);
    // Before confirmation the class-test path takes no marks at all.
    expect(await classTestEntryGuard(testId, a, "PRESENT", 9)).toMatch(/আগে প্রশ্নভিত্তিক শিট নিশ্চিত করুন/);
    // NOT_SUBMITTED is not a class-test state.
    await expect(saveResults(p.paperId, [{ studentId: c, status: "NOT_SUBMITTED" }], TEACHER)).rejects.toThrow(/জমা দেয়নি/);
    await saveResults(p.paperId, [
      { studentId: a, items: [{ itemNo: 1, marks: 2 }] }, // 17
      { studentId: b, status: "ABSENT" },
    ], TEACHER);
    await confirmPaper(p.paperId, TEACHER);

    // 3: PRESENT + total, ABSENT, full marks with no row; the comments and stamp survive.
    const rows = new Map((await ClassTestResult.find({ testId: t._id }).lean()).map((r) => [String(r.studentId), r]));
    expect(rows.get(a)).toMatchObject({ status: "PRESENT", marks: 17, weakness: "ভাগশেষ ভুলে যায়", teacherAction: "আলাদা অনুশীলন", guardianAction: "বাসায় পাঁচটি ভাগ" });
    expect(rows.get(a)!.aiCheck?.status).toBe("CHECKED");
    expect(rows.get(b)).toMatchObject({ status: "ABSENT" });
    expect(rows.get(b)!.marks).toBeUndefined();
    expect(rows.get(c)).toMatchObject({ status: "PRESENT", marks: 20 });

    // 4: a different mark / status through the class-test path is refused; the same mark with comments saves.
    expect(await classTestEntryGuard(testId, a, "PRESENT", 15)).toMatch(/শিট/);
    expect(await classTestEntryGuard(testId, a, "ABSENT", null)).toMatch(/শিট/);
    expect(await classTestEntryGuard(testId, a, "PRESENT", 17)).toBeNull();
    const saved = await enterResult({ testId, studentId: a, status: "PRESENT", marks: 17, weakness: "নতুন মন্তব্য", actorId: TEACHER_ID });
    expect(saved.weakness).toBe("নতুন মন্তব্য");

    // A correction before submit re-writes that student's total.
    await saveResults(p.paperId, [{ studentId: a, items: [{ itemNo: 1, marks: 1 }] }], TEACHER);
    expect((await ClassTestResult.findOne({ testId: t._id, studentId: new Types.ObjectId(a) }).lean())).toMatchObject({ marks: 16, weakness: "নতুন মন্তব্য" });

    // 5: after submit, a total-changing correction is refused; a tag-only one goes through.
    await ClassTestResult.updateOne({ testId: t._id, studentId: new Types.ObjectId(c) }, { $set: { submittedAt: new Date() } });
    await expect(saveResults(p.paperId, [{ studentId: c, items: [{ itemNo: 2, marks: 3 }] }], TEACHER)).rejects.toThrow(/submitted for approval/);
    await saveResults(p.paperId, [{ studentId: c, items: [{ itemNo: 2, tags: ["MESSY"] }] }], TEACHER);
    expect((await ClassTestResult.findOne({ testId: t._id, studentId: new Types.ObjectId(c) }).lean())).toMatchObject({ marks: 20 });
    await ClassTestResult.updateOne({ testId: t._id, studentId: new Types.ObjectId(c) }, { $set: { publishedAt: new Date() } });
    await expect(saveResults(p.paperId, [{ studentId: c, status: "ABSENT" }], TEACHER)).rejects.toThrow(/published/);

    // Another flow (recheck / published correction) left a different mark: the sheet page warns.
    await ClassTestResult.updateOne({ testId: t._id, studentId: new Types.ObjectId(c) }, { $set: { marks: 18 } });
    const d = await paperDetail(p.paperId, TEACHER);
    expect(d.classTest).toMatchObject({ classTestId: testId, totalMarks: 20, examDate: "2026-10-01" });
    expect(d.classTestMismatches).toEqual([
      expect.objectContaining({ studentId: c, sheetStatus: "PRESENT", sheetMarks: 20, classTestStatus: "PRESENT", classTestMarks: 18 }),
    ]);
  });
});
