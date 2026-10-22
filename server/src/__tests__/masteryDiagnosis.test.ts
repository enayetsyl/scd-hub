/**
 * Mastery M-3 — diagnosis engine, views, quality report, exclusion (docs/prd-mastery.md §5.3,
 * §6.3, §6.4; D-#779 / #782 / #808).
 *
 * computeOutcomeState (pure):
 *   - no evidence ⇒ NOT_ASSESSED; under the verdict floor ⇒ INSUFFICIENT
 *   - WEAK on low recent %, below the section mean, re-work, rubric low, LIGHT signals
 *   - WEAK → IMPROVING → MASTERED (distinct questions, separate weeks; a redo never counts)
 *   - MASTERED → REVISION_DUE at read; a revision item passes (MASTERED again) or fails (WEAK)
 * sectionOutcomeSummary / paperQuality (pure).
 * Service (in-memory Mongo, routine lookup mocked): heat-map + trigger, student view, trail,
 * quality report, exclusion (recompute, survives a correction, revoke), the row rule.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MASTERY_POLICY_DEFAULTS } from "@scd/shared";
import {
  computeOutcomeState,
  paperQuality,
  sectionOutcomeSummary,
  type EvidenceLike,
} from "../modules/mastery/diagnosis";
import { isoWeekKey } from "../modules/mastery/evidence";

const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { importCatalogue, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, saveResults } from "../modules/mastery/services/MasteryWorkService";
import {
  excludeItem,
  outcomeTrail,
  paperQualityDetail,
  qualityPapersPage,
  revokeExclusion,
  sectionHeatmap,
  studentDiagnosis,
} from "../modules/mastery/services/MasteryDiagnosisService";

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

const P = { ...MASTERY_POLICY_DEFAULTS };
const NOW = new Date("2027-03-20T00:00:00Z");
const ev = (paperId: string, date: string, earned: number, available: number, over: Partial<EvidenceLike> = {}): EvidenceLike => {
  const at = new Date(`${date}T00:00:00Z`);
  return {
    paperId, itemNo: 1, qid: `Q-${paperId}`, loCode: "LO-C3-MATH-07-03", earned, available,
    rework: false, signal: "NONE", routed: false, at, week: isoWeekKey(at), ...over,
  };
};
const state = (rows: EvidenceLike[], mean: number | null = null, now = NOW) => computeOutcomeState(rows, P, { sectionMeanPct: mean, now });

describe("computeOutcomeState (pure)", () => {
  it("no evidence ⇒ NOT_ASSESSED; one item ⇒ INSUFFICIENT (the verdict floor)", () => {
    expect(state([]).state).toBe("NOT_ASSESSED");
    const one = state([ev("p1", "2027-03-01", 0, 2)]);
    expect(one.state).toBe("INSUFFICIENT");
    expect(one.evidenceCount).toBe(1);
  });

  it("low recent % ⇒ WEAK (LOW_PCT); re-work at full marks ⇒ WEAK (REWORK) and never good", () => {
    expect(state([ev("p1", "2027-03-01", 1, 2), ev("p2", "2027-03-08", 0, 1)])).toMatchObject({ state: "WEAK", reasons: ["LOW_PCT"] });
    const rw = state([ev("p1", "2027-03-01", 2, 2), ev("p2", "2027-03-08", 2, 2, { rework: true, signal: "WEAK" })]);
    expect(rw.state).toBe("WEAK");
    expect(rw.reasons).toEqual(["REWORK"]);
    expect(rw.goodQids.map((g) => g.qid)).toEqual(["Q-p1"]);
  });

  it("below the section mean by more than the gap ⇒ WEAK (BELOW_SECTION) even above 50%", () => {
    const rows = [ev("p1", "2027-03-01", 3, 5), ev("p2", "2027-03-08", 3, 5)];
    expect(state(rows, 90)).toMatchObject({ state: "WEAK", reasons: ["BELOW_SECTION"] });
    expect(state(rows, 70).state).not.toBe("WEAK");
  });

  it("two LIGHT signals within three weeks ⇒ WEAK; a rubric step ≤ 2 ⇒ WEAK", () => {
    const light = state([
      ev("p1", "2027-03-01", 2, 2, { signal: "LIGHT" }),
      ev("p2", "2027-03-08", 2, 2, { signal: "LIGHT" }),
    ]);
    expect(light).toMatchObject({ state: "WEAK", reasons: ["LIGHT_SIGNALS"] });
    const rub = state([
      ev("r1", "2027-03-01", 3, 3, { rubricStep: 4, qid: null, itemNo: null }),
      ev("r2", "2027-03-08", 1, 3, { rubricStep: 2, qid: null, itemNo: null }),
    ]);
    expect(rub.state).toBe("WEAK");
    expect(rub.reasons).toEqual(expect.arrayContaining(["RUBRIC_LOW"]));
  });

  it("good in the same week, or the same question twice, is not mastery — INSUFFICIENT, not WEAK", () => {
    const sameWeek = state([ev("p1", "2027-03-01", 2, 2), ev("p2", "2027-03-02", 2, 2)]);
    expect(sameWeek.state).toBe("INSUFFICIENT");
    const redo = state([ev("p1", "2027-03-01", 2, 2), ev("p2", "2027-03-08", 2, 2, { qid: "Q-p1" })]);
    expect(redo.state).toBe("INSUFFICIENT");
    expect(redo.seenQids).toEqual(["Q-p1"]);
  });

  it("WEAK → IMPROVING → MASTERED, with the state path and the first revision date", () => {
    const s = state([
      ev("p1", "2027-02-15", 0, 2),
      ev("p2", "2027-02-22", 0, 2),
      ev("p3", "2027-03-01", 2, 2),
      ev("p4", "2027-03-08", 2, 2),
    ]);
    expect(s.history.map((h) => h.state)).toEqual(["INSUFFICIENT", "WEAK", "IMPROVING", "MASTERED"]);
    expect(s.state).toBe("MASTERED");
    expect(s.nextRevisionAt?.toISOString().slice(0, 10)).toBe("2027-04-05");
    expect(s.since?.toISOString().slice(0, 10)).toBe("2027-03-08");
  });

  it("MASTERED shows REVISION_DUE once the date passes; a revision item passes or fails", () => {
    const base = [ev("p1", "2027-03-01", 2, 2), ev("p2", "2027-03-08", 2, 2)];
    expect(state(base).state).toBe("MASTERED");
    expect(state(base, null, new Date("2027-04-10T00:00:00Z")).state).toBe("REVISION_DUE");
    const passed = state([...base, ev("p3", "2027-04-12", 2, 2)], null, new Date("2027-04-13T00:00:00Z"));
    expect(passed.state).toBe("MASTERED");
    expect(passed.nextRevisionAt?.toISOString().slice(0, 10)).toBe("2027-06-07");
    const failed = state([...base, ev("p3", "2027-04-12", 0, 2)], null, new Date("2027-04-13T00:00:00Z"));
    expect(failed).toMatchObject({ state: "WEAK", reasons: ["REVISION_FAILED"] });
  });
});

describe("sectionOutcomeSummary / paperQuality (pure)", () => {
  it("section % = WEAK ÷ verdicts; triggered only after enough assessments", () => {
    const states = ["WEAK", "WEAK", "MASTERED", "IMPROVING", "INSUFFICIENT", "NOT_ASSESSED"] as const;
    expect(sectionOutcomeSummary([...states], 2, P)).toEqual({ weak: 2, verdicts: 4, weakPct: 50, triggered: true });
    expect(sectionOutcomeSummary([...states], 1, P).triggered).toBe(false);
    expect(sectionOutcomeSummary(["INSUFFICIENT"], 3, P)).toMatchObject({ weakPct: null, triggered: false });
  });

  it("flags too easy, maybe unclear (top third low) and discriminating items", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const rank = new Map(ids.map((id, i) => [id, 100 - i * 10]));
    const rows = [
      ...ids.map((studentId) => ({ studentId, itemNo: 1, earned: 1, available: 1, rework: false })),
      ...ids.map((studentId) => ({ studentId, itemNo: 2, earned: 1, available: 5, rework: false })),
      ...ids.map((studentId, i) => ({ studentId, itemNo: 3, earned: i < 2 ? 2 : 0, available: 2, rework: false })),
    ];
    const q = paperQuality([1, 2, 3], rows, rank);
    expect(q.items[0]).toMatchObject({ facility: 100, signals: ["TOO_EASY"] });
    expect(q.items[1].signals).toContain("MAY_BE_UNCLEAR");
    expect(q.items[2]).toMatchObject({ discrimination: 100, signals: ["DISCRIMINATES"] });
    expect(q.flagged).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
const OTHER_TEACHER = { userId: new Types.ObjectId().toString(), role: "TEACHER" as const };
let sectionId = "";
const sids: string[] = [];
const papers: string[] = [];

const CATALOGUE = JSON.stringify({
  classToken: "C3",
  subject: "MATH",
  status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [
    { code: "LO-C3-MATH-07-02", labelBn: "ভাগফল ও ভাগশেষ", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] },
    { code: "LO-C3-MATH-07-03", labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: ["QT-WORD"], homeTipBn: "বাড়িতে একটি ভাগ খাতায় করান।" },
    { code: "LO-C3-MATH-07-04", labelBn: "ভাগের কথার অঙ্ক", assess: "QUESTION", questionTypeCodes: ["QT-WORD"] },
  ],
  questionTypes: [
    { code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 1 },
    { code: "QT-WORD", labelBn: "কথার অঙ্ক", marks: 5 },
  ],
});

const SHEET = (date: string) => ({
  sectionId,
  subject: "MATH" as const,
  source: "HW" as const,
  date,
  items: [
    { origin: "TEACHER" as const, textBn: "৪৫ ÷ ৯ = ?", loCode: "LO-C3-MATH-07-02", questionTypeCode: "QT-SHORT" },
    { origin: "TEACHER" as const, textBn: "৭৩৫ ÷ ৭", loCode: "LO-C3-MATH-07-03", questionTypeCode: "QT-WORD" },
  ],
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = String(sec._id);
  for (let i = 1; i <= 6; i++) {
    const [s] = await Student.create([{ schoolId: `M3-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
  }
  await importCatalogue(CATALOGUE, true, PRINCIPAL);
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  mockTeacher.mockResolvedValue(TEACHER_ID);
  // Two homework sheets in separate weeks: students 1–3 struggle on long division, 4–6 do not.
  for (const [date, marks] of [["2027-03-01", [1, 0, 1]], ["2027-03-08", [0, 1, 1]]] as const) {
    const p = await createPaper(SHEET(date), TEACHER);
    papers.push(p.paperId);
    await saveResults(p.paperId, marks.map((m, i) => ({ studentId: sids[i], items: [{ itemNo: 2, marks: m, rework: i === 0 }] })), TEACHER);
    await confirmPaper(p.paperId, TEACHER);
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

describe("diagnosis views (DB)", () => {
  it("heat-map: outcomes taught × students, section weak % and the trigger", async () => {
    const h = await sectionHeatmap(sectionId, "MATH", TEACHER);
    expect(h.students).toHaveLength(6);
    expect(h.outcomes.map((o) => o.loCode)).toEqual(["LO-C3-MATH-07-02", "LO-C3-MATH-07-03"]);
    expect(h.notYetAssessed).toBe(1);
    const div = h.outcomes[1];
    expect(div).toMatchObject({ assessments: 2, weak: 3, verdicts: 6, weakPct: 50, triggered: true });
    expect(div.cells.map((c) => c.state)).toEqual(["WEAK", "WEAK", "WEAK", "MASTERED", "MASTERED", "MASTERED"]);
    expect(h.outcomes[0]).toMatchObject({ weakPct: 0, triggered: false });
    expect(h.students.map((s) => s.weakCount)).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it("the row rule: a teacher off the routine is refused; edit_all passes", async () => {
    mockTeacher.mockResolvedValue(null);
    await expect(sectionHeatmap(sectionId, "MATH", OTHER_TEACHER)).rejects.toThrow(/রুটিন/);
    await expect(studentDiagnosis(sids[0], "MATH", OTHER_TEACHER)).rejects.toThrow(/রুটিন/);
    expect((await sectionHeatmap(sectionId, "MATH", PRINCIPAL)).outcomes).toHaveLength(2);
  });

  it("student view: every locked outcome with its state and why; where they stand", async () => {
    const d = await studentDiagnosis(sids[0], "MATH", TEACHER);
    expect(d.subjects).toEqual(["MATH"]);
    const by = new Map(d.outcomes.map((o) => [o.loCode, o]));
    expect(by.get("LO-C3-MATH-07-03")).toMatchObject({ state: "WEAK", earnedPct: 10, reworkCount: 2 });
    expect(by.get("LO-C3-MATH-07-03")!.reasons).toEqual(expect.arrayContaining(["LOW_PCT", "REWORK"]));
    expect(by.get("LO-C3-MATH-07-02")!.state).toBe("MASTERED");
    expect(by.get("LO-C3-MATH-07-04")!.state).toBe("NOT_ASSESSED");
    expect(d).toMatchObject({ sectionSize: 6, moreWeakThan: 3 });
  });

  it("trail: newest first, the state path, the home tip", async () => {
    const t = await outcomeTrail(sids[0], "LO-C3-MATH-07-03", TEACHER);
    expect(t.rows.map((r) => [r.paperId, r.earned, r.available, r.rework])).toEqual([
      [papers[1], 0, 5, true],
      [papers[0], 1, 5, true],
    ]);
    expect(t.history.map((h) => h.state)).toEqual(["INSUFFICIENT", "WEAK"]);
    expect(t.history[1].paperId).toBe(papers[1]);
    expect(t.outcome.homeTipBn).toMatch(/খাতায়/);
    await expect(outcomeTrail(sids[0], "LO-C4-MATH-07-03", TEACHER)).rejects.toThrow(/শ্রেণির নয়/);
  });

  it("quality: per item facility and re-work; the page lists confirmed sheets", async () => {
    const page = await qualityPapersPage(sectionId, "MATH", {}, TEACHER);
    expect(page.rows.map((r) => r.paper.paperId)).toEqual([papers[1], papers[0]]);
    const q = await paperQualityDetail(papers[1], TEACHER);
    expect(q).toMatchObject({ students: 6, rosterSize: 6 });
    expect(q.items[0]).toMatchObject({ itemNo: 1, facility: 100, signals: expect.arrayContaining(["TOO_EASY"]) });
    expect(q.items[1]).toMatchObject({ itemNo: 2, facility: 50, reworkRate: 17 });
  });

  it("exclusion: recomputes, survives a correction, refuses duplicates / no reason / QID on own questions; revoke restores", async () => {
    await expect(excludeItem(papers[1], 2, "ITEM", "  ", TEACHER)).rejects.toThrow(/কারণ/);
    await expect(excludeItem(papers[1], 2, "QID", "অস্পষ্ট", TEACHER)).rejects.toThrow(/নিজের লেখা/);
    const ex = await excludeItem(papers[1], 2, "ITEM", "প্রশ্ন অস্পষ্ট", TEACHER);
    expect(ex).toMatchObject({ scope: "ITEM", paperId: papers[1], itemNo: 2, reason: "প্রশ্ন অস্পষ্ট" });
    await expect(excludeItem(papers[1], 2, "ITEM", "আবার", TEACHER)).rejects.toThrow(/আগেই/);

    let h = await sectionHeatmap(sectionId, "MATH", TEACHER);
    expect(h.outcomes[1]).toMatchObject({ assessments: 1, triggered: false });
    expect(h.outcomes[1].cells[0].state).toBe("INSUFFICIENT");

    // A correction on the excluded sheet must not bring the item back.
    await saveResults(papers[1], [{ studentId: sids[0], items: [{ itemNo: 2, marks: 0 }] }], TEACHER);
    const t = await outcomeTrail(sids[0], "LO-C3-MATH-07-03", TEACHER);
    expect(t.rows.find((r) => r.paperId === papers[1])).toMatchObject({ excluded: true, excludeReason: "প্রশ্ন অস্পষ্ট" });
    expect((await paperQualityDetail(papers[1], TEACHER)).items[1].exclusion?.id).toBe(ex.id);

    mockTeacher.mockResolvedValue(null);
    await expect(revokeExclusion(ex.id, OTHER_TEACHER)).rejects.toThrow(/রুটিন/);
    mockTeacher.mockResolvedValue(TEACHER_ID);
    expect(await revokeExclusion(ex.id, TEACHER)).toBe(true);
    h = await sectionHeatmap(sectionId, "MATH", TEACHER);
    expect(h.outcomes[1]).toMatchObject({ assessments: 2, triggered: true });
    await expect(revokeExclusion(ex.id, TEACHER)).rejects.toThrow(/পাওয়া যায়নি/);
  });
});
