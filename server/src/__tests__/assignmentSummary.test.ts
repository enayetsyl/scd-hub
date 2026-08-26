/**
 * AS-T5 tests — roll-ups + guardian read (PRD §5 AS-T5).
 *
 * AJ-7 — assignmentSummary: delivery rate vs scheduled (0/26 case), suspended
 *        weeks excluded from denominators, submission rate, D-#34 thresholds,
 *        checking latency, open resubmissions
 * AJ-8 — childAssignments: exactly the child's records — pending, overdue with
 *        days late, returned with marks/result/feedback — nothing else.
 *
 * DB-free: models mocked; cadence calendar + lifecycle real.
 */
import mongoose from "mongoose";

const mockScheduleFindOne = jest.fn();
const mockItemFind = jest.fn();
const mockRecFind = jest.fn();
const mockRecSkip = jest.fn();
const mockRecLimit = jest.fn();
const mockHolidayFind = jest.fn();

// GC-3: childAssignments now batch-loads each record’s guardian claim. DB-free
// suite, so the claim model is stubbed EMPTY — every row reports no claim.
// GC-3: canClaim now resolves the claim WINDOW, which reads the school calendar.
// DB-free suite — every day is a normal open day here; the window rule has its own
// tests in workClaim.test.ts.
jest.mock("../modules/routine/calendar", () => ({
  // PARTIAL: dayTypeFor and the rest are used elsewhere in this suite — only the
  // DB-touching resolveDayType is stubbed.
  ...jest.requireActual("../modules/routine/calendar"),
  resolveDayType: async () => "FULL",
}));
jest.mock("../modules/trackers/models/GuardianWorkClaim", () => ({
  GuardianWorkClaim: {
    find: () => ({ sort: () => ({ lean: () => Promise.resolve([]) }) }),
  },
}));
jest.mock("../modules/trackers/models/AssignmentSchedule", () => ({
  AssignmentSchedule: { findOne: (q: unknown) => mockScheduleFindOne(q) },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { find: (q: unknown) => ({ lean: () => mockItemFind(q) }) },
}));
// Chainable so the paged guardian read (D-#476) can be asserted: skip/limit
// record what was pushed down to Mongo rather than being sliced in JS.
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: {
    find: (q: unknown) => {
      const chain: Record<string, unknown> = {
        lean: () => mockRecFind(q),
        sort: () => chain,
        skip: (n: number) => {
          mockRecSkip(n);
          return chain;
        },
        limit: (n: number) => {
          mockRecLimit(n);
          return chain;
        },
      };
      return chain;
    },
  },
}));
jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: { find: (q: unknown) => ({ lean: () => mockHolidayFind(q) }) },
}));

import {
  assignmentSummary,
  childAssignments,
} from "../modules/trackers/services/AssignmentSummaryService";

const oid = () => new mongoose.Types.ObjectId();
const YEAR = oid().toString();
const TERM_START = new Date(2026, 0, 4); // Sunday
const AJMOL = oid();
const KAWSAR = oid();
const CLASS_A = oid();

/** Ajmol teaches one entry on every cycle week → 1 expected per week. */
function fourWeekRotation(teacherId: mongoose.Types.ObjectId) {
  return [1, 2, 3, 4].map((cw) => ({
    _id: oid(),
    cycleWeek: cw,
    classId: CLASS_A,
    classLevel: 2,
    sectionId: oid(),
    subject: "BAN",
    teacherId,
  }));
}

function schedule(entries: unknown[]) {
  return {
    academicYearId: YEAR,
    termStartDate: TERM_START,
    deliveryDayOfWeek: 4,
    dueDayOfWeek: 0,
    entries,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHolidayFind.mockResolvedValue([]);
  mockItemFind.mockResolvedValue([]);
  mockRecFind.mockResolvedValue([]);
});

// ===========================================================================
// AJ-7 — assignmentSummary
// ===========================================================================

describe("AJ-7 — assignmentSummary", () => {
  test("teacher with 26 scheduled and 0 delivered shows 0/26 (rate 0)", async () => {
    mockScheduleFindOne.mockResolvedValue(schedule(fourWeekRotation(AJMOL)));
    const s = await assignmentSummary({
      academicYearId: YEAR,
      weekFrom: 1,
      weekTo: 26,
      asOf: new Date(2026, 6, 5),
    });
    expect(s.scheduledTotal).toBe(26);
    expect(s.deliveredTotal).toBe(0);
    const ajmol = s.byTeacher.find((r) => r.key === AJMOL.toString())!;
    expect(ajmol.scheduled).toBe(26);
    expect(ajmol.delivered).toBe(0);
    expect(ajmol.deliveryRatePct).toBe(0);
  });

  test("suspended (vacation) weeks are excluded from the denominator", async () => {
    mockScheduleFindOne.mockResolvedValue(schedule(fourWeekRotation(AJMOL)));
    // Week 2 (Jan 11–17) entirely holiday → suspended
    mockHolidayFind.mockResolvedValue([
      { fromDate: new Date(2026, 0, 11), toDate: new Date(2026, 0, 17, 23, 59) },
    ]);
    const s = await assignmentSummary({ academicYearId: YEAR, weekFrom: 1, weekTo: 4 });
    expect(s.suspendedWeeks).toEqual([2]);
    expect(s.scheduledTotal).toBe(3); // 4 weeks − 1 suspended
  });

  test("class/week breakdowns + record health match the per-student records exactly", async () => {
    mockScheduleFindOne.mockResolvedValue(
      schedule([...fourWeekRotation(AJMOL), ...fourWeekRotation(KAWSAR).map((e) => ({ ...e, classId: oid(), sectionId: oid(), subject: "MATH" }))]),
    );
    const ITEM = oid();
    mockItemFind.mockResolvedValue([
      { _id: ITEM, teacherId: KAWSAR, classId: CLASS_A, weekNumber: 1, subject: "MATH" },
    ]);
    const day = (n: number, h = 9) => new Date(2026, 0, n, h);
    const sA = oid();
    const sB = oid();
    mockRecFind.mockResolvedValue([
      // delivered + submitted on time + checked 2 days later
      { _id: oid(), asItemId: ITEM, studentId: sA, state: "RETURNED", chaseCount: 0,
        stateDates: [
          { state: "GIVEN", at: day(8) }, { state: "DUE", at: day(11) },
          { state: "SUBMITTED", at: day(11) }, { state: "CHECKED", at: day(13) },
          { state: "RETURNED", at: day(14) },
        ] },
      // delivered, chased 3× — attention AND comms prompt (D-#34)
      { _id: oid(), asItemId: ITEM, studentId: sB, state: "CHASE", chaseCount: 3,
        stateDates: [{ state: "GIVEN", at: day(8) }, { state: "DUE", at: day(11) }, { state: "CHASE", at: day(12) }] },
      // open resubmission (resubOf set, non-terminal)
      { _id: oid(), asItemId: ITEM, studentId: sA, state: "GIVEN", chaseCount: 0, resubOf: oid(),
        stateDates: [{ state: "GIVEN", at: day(14) }] },
    ]);

    const s = await assignmentSummary({ academicYearId: YEAR, weekFrom: 1, weekTo: 1 });
    expect(s.deliveredTotal).toBe(1);
    const week1 = s.byWeek.find((r) => r.key === "1")!;
    expect(week1.scheduled).toBe(2); // both teachers' cw-1 entries
    expect(week1.delivered).toBe(1);
    expect(s.submissionRatePct).toBe(50); // 1 of 2 original delivered records submitted
    expect(s.chaseVolume).toBe(3);
    expect(s.attentionStudentIds).toEqual([sB.toString()]); // ≥2
    expect(s.commsPromptStudentIds).toEqual([sB.toString()]); // ≥3
    expect(s.openResubmissions).toBe(1);
    expect(s.avgCheckingLatencyDays).toBe(2);
  });

  test("teacherId filter narrows scheduled + delivered to that teacher", async () => {
    mockScheduleFindOne.mockResolvedValue(
      schedule([...fourWeekRotation(AJMOL), ...fourWeekRotation(KAWSAR)]),
    );
    const s = await assignmentSummary({
      academicYearId: YEAR, weekFrom: 1, weekTo: 4, teacherId: AJMOL.toString(),
    });
    expect(s.scheduledTotal).toBe(4);
    expect(s.byTeacher).toHaveLength(1);
    expect(s.byTeacher[0].key).toBe(AJMOL.toString());
    const itemFilter = mockItemFind.mock.calls[0][0] as Record<string, unknown>;
    expect(itemFilter.teacherId).toBe(AJMOL.toString());
  });
});

// ===========================================================================
// AJ-8 — childAssignments (guardian read)
// ===========================================================================

describe("AJ-8 — childAssignments", () => {
  test("returns exactly the child's three records with status, days late, marks, result, feedback", async () => {
    const CHILD = oid().toString();
    const itemPending = { _id: oid(), subject: "BAN", weekNumber: 3, deliveryDate: new Date(2026, 0, 22), dueDate: new Date(2026, 0, 25), totalMarks: null };
    const itemOverdue = { _id: oid(), subject: "MATH", weekNumber: 2, deliveryDate: new Date(2026, 0, 15), dueDate: new Date(2026, 0, 18), totalMarks: null };
    const itemDone = { _id: oid(), subject: "ENG", weekNumber: 1, deliveryDate: new Date(2026, 0, 8), dueDate: new Date(2026, 0, 11), totalMarks: 10 };
    mockItemFind.mockResolvedValue([itemPending, itemOverdue, itemDone]);
    mockRecFind.mockResolvedValue([
      // pending: GIVEN, due Jan 25, asOf Jan 22 → not late
      { _id: oid(), asItemId: itemPending._id, asId: "AS-C2-BAN-0003", studentId: CHILD, state: "GIVEN",
        chaseCount: 0, dueDate: itemPending.dueDate, stateDates: [{ state: "GIVEN", at: new Date(2026, 0, 22) }] },
      // overdue: CHASE since Jan 18, asOf Jan 22 → 4 days late
      { _id: oid(), asItemId: itemOverdue._id, asId: "AS-C2-MATH-0002", studentId: CHILD, state: "CHASE",
        chaseCount: 1, dueDate: itemOverdue.dueDate,
        stateDates: [{ state: "GIVEN", at: new Date(2026, 0, 15) }, { state: "DUE", at: new Date(2026, 0, 18) }, { state: "CHASE", at: new Date(2026, 0, 19) }] },
      // returned: 7/10 with feedback
      { _id: oid(), asItemId: itemDone._id, asId: "AS-C2-ENG-0001", studentId: CHILD, state: "RETURNED",
        chaseCount: 0, dueDate: itemDone.dueDate, marks: 7, result: "PARTIAL", feedback: "ভালো হয়েছে",
        stateDates: [{ state: "GIVEN", at: new Date(2026, 0, 8) }, { state: "DUE", at: new Date(2026, 0, 11) }, { state: "SUBMITTED", at: new Date(2026, 0, 11) }, { state: "CHECKED", at: new Date(2026, 0, 12) }, { state: "RETURNED", at: new Date(2026, 0, 13) }] },
    ]);

    const list = await childAssignments(CHILD, new Date(2026, 0, 22));
    expect(list).toHaveLength(3);
    // the query was scoped to THIS student — nothing about any other student
    expect((mockRecFind.mock.calls[0][0] as Record<string, unknown>).studentId).toBe(CHILD);

    const pending = list.find((e) => e.asId === "AS-C2-BAN-0003")!;
    expect(pending.pending).toBe(true);
    expect(pending.daysLate).toBe(0);

    const overdue = list.find((e) => e.asId === "AS-C2-MATH-0002")!;
    expect(overdue.pending).toBe(false);
    expect(overdue.daysLate).toBe(4); // Jan 18 → Jan 22

    const done = list.find((e) => e.asId === "AS-C2-ENG-0001")!;
    expect(done.marks).toBe(7);
    expect(done.totalMarks).toBe(10);
    expect(done.result).toBe("PARTIAL");
    expect(done.feedback).toBe("ভালো হয়েছে");
    expect(done.daysLate).toBe(0); // submitted — never counted late again
  });

  test("no records → empty list", async () => {
    mockRecFind.mockResolvedValue([]);
    expect(await childAssignments(oid().toString())).toHaveLength(0);
  });

  // D-#476 — the guardian list pages instead of loading a whole year.
  describe("paging", () => {
    test("no page argument still loads the WHOLE history — wholePicture depends on it", async () => {
      mockRecFind.mockResolvedValue([]);
      await childAssignments(oid().toString());
      expect(mockRecSkip).not.toHaveBeenCalled();
      expect(mockRecLimit).not.toHaveBeenCalled();
    });

    test("limit/offset are pushed down to the query, not sliced afterwards", async () => {
      mockRecFind.mockResolvedValue([]);
      await childAssignments(oid().toString(), new Date(2026, 0, 22), { limit: 20, offset: 40 });
      expect(mockRecSkip).toHaveBeenCalledWith(40);
      expect(mockRecLimit).toHaveBeenCalledWith(20);
    });

    test("a zero/negative page is ignored rather than returning nothing", async () => {
      mockRecFind.mockResolvedValue([]);
      await childAssignments(oid().toString(), new Date(2026, 0, 22), { limit: 0, offset: 0 });
      expect(mockRecSkip).not.toHaveBeenCalled();
      expect(mockRecLimit).not.toHaveBeenCalled();
    });
  });
});
