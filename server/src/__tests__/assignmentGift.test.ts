/**
 * AG-1/AG-2 tests — the assignment gift & streak rule (docs/prd-assignment-gift.md §7,
 * D-#479–#483).
 *
 * Covers every acceptance criterion:
 *   1 all on time → wins, regardless of result
 *   2 one late → does not win
 *   3 absent and never submitted → does not win (absence is no excuse)
 *   4 a resubmission on an otherwise clean week → still wins
 *   5 weeks 1–4 won → ONE streak entitlement at week 4; week 5 won → streak 5, no
 *     second entitlement (rolling counter, block-gated award)
 *   6 a no-assignment week BRIDGES a streak rather than breaking it
 *   7 the unsettled (live) week is PENDING, never a loss
 *   8 recordGiftHandover for a non-winner is refused
 * Plus: the first-SUBMITTED rule survives a SUBMITTED→CHASE re-collection, and the
 * due-day boundary is end-of-day (a submission ON the due date counts).
 *
 * DB-free: models mocked; the derivation, the Dhaka day-key helper and the calendar
 * serializer are real.
 */
import { Types } from "mongoose";

const mockItemFind = jest.fn();
const mockItemFindOne = jest.fn();
const mockRecFind = jest.fn();
const mockAwardFind = jest.fn();
const mockAwardUpsert = jest.fn();
const mockAwardDelete = jest.fn();
const mockStudentFind = jest.fn();
const mockStudentFindById = jest.fn();
const mockClassFindById = jest.fn();
const mockUserFind = jest.fn();
const mockUserFindById = jest.fn();

jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: {
    find: (q: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockItemFind(q)) }) }),
    findOne: (q: unknown) => ({
      sort: () => ({ select: () => ({ lean: () => Promise.resolve(mockItemFindOne(q)) }) }),
    }),
  },
}));
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: {
    find: (q: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockRecFind(q)) }) }),
  },
}));
jest.mock("../modules/trackers/models/AssignmentGiftAward", () => ({
  GIFT_AWARD_KINDS: ["WEEKLY", "STREAK"],
  AssignmentGiftAward: {
    find: (q: unknown) => ({ lean: () => Promise.resolve(mockAwardFind(q)) }),
    findOneAndUpdate: (f: unknown, u: unknown) => ({
      lean: () => Promise.resolve(mockAwardUpsert(f, u)),
    }),
    deleteOne: (q: unknown) => Promise.resolve(mockAwardDelete(q)),
  },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: {
    find: (q: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockStudentFind(q)) }) }),
    findById: (id: unknown) => ({
      select: () => ({ lean: () => Promise.resolve(mockStudentFindById(id)) }),
    }),
  },
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: {
    findById: (id: unknown) => ({
      select: () => ({ lean: () => Promise.resolve(mockClassFindById(id)) }),
    }),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: (q: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockUserFind(q)) }) }),
    findById: (id: unknown) => ({
      select: () => ({ lean: () => Promise.resolve(mockUserFindById(id)) }),
    }),
  },
}));

import {
  assignmentGiftReport,
  recordGiftHandover,
  undoGiftHandover,
  GIFT_STREAK_BLOCK,
  type GiftReport,
  type GiftStudentRow,
} from "../modules/trackers/services/AssignmentGiftService";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const YEAR = new Types.ObjectId().toString();
const CLASS = new Types.ObjectId();
const SECTION = new Types.ObjectId();
const ALICE = new Types.ObjectId();
const BOB = new Types.ObjectId();
const OFFICER = new Types.ObjectId();

/** Sunday due dates, one per week — week N is due 2026-01-04 + (N−1)·7. */
function dueOf(week: number): Date {
  const d = new Date(2026, 0, 4); // Sun 2026-01-04, local midnight (the stored shape)
  d.setDate(d.getDate() + (week - 1) * 7);
  return d;
}
/** An instant on a given Dhaka calendar day, mid-afternoon. */
function at(day: Date, offsetDays = 0): Date {
  const d = new Date(day);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(14, 30, 0, 0);
  return d;
}

interface ItemSpec {
  week: number;
  subject?: string;
}
interface RecSpec {
  student: Types.ObjectId;
  week: number;
  /** Days relative to the due date; null = never submitted. */
  submittedOffset: number | null;
  state?: string;
  /** Extra stamps appended after the first SUBMITTED (e.g. a re-collection). */
  extraStamps?: Array<{ state: string; at: Date }>;
  resubOf?: Types.ObjectId;
  subject?: string;
}

/** Wire the item/record mocks for a scenario. Items are one-per-(week,subject). */
function seed(items: ItemSpec[], recs: RecSpec[]): void {
  const itemDocs = items.map((i) => ({
    _id: new Types.ObjectId(),
    asId: `AS-C1-${i.subject ?? "ENG"}-${String(i.week).padStart(4, "0")}`,
    weekNumber: i.week,
    dueDate: dueOf(i.week),
    subject: i.subject ?? "ENG",
    classId: CLASS,
    sectionId: SECTION,
  }));
  const keyOf = (w: number, s?: string) => `${w}:${s ?? "ENG"}`;
  const itemByKey = new Map(itemDocs.map((d) => [keyOf(d.weekNumber, d.subject), d]));

  mockItemFind.mockImplementation((q: { weekNumber?: { $lte: number } }) => {
    const lte = q.weekNumber?.$lte ?? Infinity;
    return itemDocs.filter((d) => d.weekNumber <= lte);
  });
  mockItemFindOne.mockImplementation(() => {
    const max = itemDocs.reduce((m, d) => Math.max(m, d.weekNumber), 0);
    return max ? { weekNumber: max } : null;
  });

  const recDocs = recs.map((r) => {
    const item = itemByKey.get(keyOf(r.week, r.subject));
    if (!item) throw new Error(`test fixture: no item for week ${r.week}`);
    const stamps: Array<{ state: string; at: Date }> = [
      { state: "GIVEN", at: at(dueOf(r.week), -3) },
    ];
    if (r.submittedOffset !== null) {
      stamps.push({ state: "SUBMITTED", at: at(dueOf(r.week), r.submittedOffset) });
    }
    for (const e of r.extraStamps ?? []) stamps.push(e);
    return {
      asItemId: item._id,
      studentId: r.student,
      state: r.state ?? (r.submittedOffset === null ? "CHASE" : "SUBMITTED"),
      stateDates: stamps,
      resubOf: r.resubOf ?? null,
    };
  });

  // The service pushes the resubmission exclusion into Mongo via `resubOf: null`;
  // the mock honours that so the query itself is under test.
  mockRecFind.mockImplementation((q: { resubOf?: unknown }) =>
    "resubOf" in q ? recDocs.filter((d) => d.resubOf === null) : recDocs,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAwardFind.mockReturnValue([]);
  mockUserFind.mockReturnValue([]);
  mockStudentFind.mockImplementation(() => [
    { _id: ALICE, name: "Alice", schoolId: "0001", rollNumber: "1", classId: CLASS, sectionId: SECTION },
    { _id: BOB, name: "Bob", schoolId: "0002", rollNumber: "2", classId: CLASS, sectionId: SECTION },
  ]);
});

/** Run the report "after" the given week has fully settled. */
function reportAfter(week: number, opts: { weekFrom?: number; weekTo?: number } = {}) {
  return assignmentGiftReport({
    academicYearId: YEAR,
    weekFrom: opts.weekFrom ?? 1,
    weekTo: opts.weekTo ?? week,
    asOf: at(dueOf(week), 1),
  });
}
const rowFor = (r: GiftReport, id: Types.ObjectId): GiftStudentRow | undefined =>
  r.students.find((s) => s.studentId === id.toString());

// ---------------------------------------------------------------------------
// §7.1–7.4 — the weekly win
// ---------------------------------------------------------------------------

describe("weekly gift — the on-time rule", () => {
  it("§7.1 wins the week when every assignment is in by the due date", async () => {
    seed(
      [{ week: 1, subject: "ENG" }, { week: 1, subject: "MATH" }, { week: 1, subject: "SCI" }],
      [
        { student: ALICE, week: 1, submittedOffset: -1, subject: "ENG" },
        { student: ALICE, week: 1, submittedOffset: -2, subject: "MATH" },
        { student: ALICE, week: 1, submittedOffset: 0, subject: "SCI" },
      ],
    );
    const row = rowFor(await reportAfter(1), ALICE)!;
    expect(row.weeks[0]).toMatchObject({ issued: 3, onTime: 3, won: true, settled: true });
    expect(row.wonWeeks).toEqual([1]);
  });

  it("submitting ON the due date counts — the deadline is end-of-day, not midnight", async () => {
    seed([{ week: 1 }], [{ student: ALICE, week: 1, submittedOffset: 0 }]);
    expect(rowFor(await reportAfter(1), ALICE)!.weeks[0].won).toBe(true);
  });

  it("§7.2 one assignment submitted the day AFTER the due date loses the week", async () => {
    seed(
      [{ week: 1, subject: "ENG" }, { week: 1, subject: "MATH" }],
      [
        { student: ALICE, week: 1, submittedOffset: -1, subject: "ENG" },
        { student: ALICE, week: 1, submittedOffset: 1, subject: "MATH" },
      ],
    );
    const row = rowFor(await reportAfter(1), ALICE)!;
    expect(row.weeks[0]).toMatchObject({ issued: 2, onTime: 1, won: false });
    expect(row.weeks[0].missed).toHaveLength(1);
    expect(row.weeks[0].missed[0]).toMatchObject({ subject: "MATH", lateSubmission: true });
  });

  it("§7.3 an absent student who never submits does not win (absence is no excuse)", async () => {
    seed(
      [{ week: 1 }],
      [{ student: ALICE, week: 1, submittedOffset: null, state: "ABSENT_REDELIVER" }],
    );
    const row = rowFor(await reportAfter(1), ALICE)!;
    expect(row.weeks[0].won).toBe(false);
    expect(row.weeks[0].missed[0]).toMatchObject({ state: "ABSENT_REDELIVER", lateSubmission: false });
  });

  it("§7.4 a resubmission on an otherwise on-time week still wins", async () => {
    const original = new Types.ObjectId();
    seed(
      [{ week: 1 }],
      [
        { student: ALICE, week: 1, submittedOffset: -1 },
        // The AS-T3 resubmission: a second record on the same item, issued after
        // checking — necessarily past the due date. It must not count against her.
        { student: ALICE, week: 1, submittedOffset: 5, resubOf: original },
      ],
    );
    const row = rowFor(await reportAfter(1), ALICE)!;
    expect(row.weeks[0]).toMatchObject({ issued: 1, onTime: 1, won: true });
  });

  it("a re-collection (SUBMITTED→CHASE) does not overwrite the on-time original", async () => {
    seed(
      [{ week: 1 }],
      [
        {
          student: ALICE,
          week: 1,
          submittedOffset: -1,
          state: "SUBMITTED",
          extraStamps: [
            { state: "CHASE", at: at(dueOf(1), 2) },
            { state: "SUBMITTED", at: at(dueOf(1), 3) },
          ],
        },
      ],
    );
    expect(rowFor(await reportAfter(1), ALICE)!.weeks[0].won).toBe(true);
  });

  it("quality is ignored — the record's result never enters the derivation", async () => {
    seed([{ week: 1 }], [{ student: ALICE, week: 1, submittedOffset: -1, state: "CHECKED" }]);
    expect(rowFor(await reportAfter(1), ALICE)!.weeks[0].won).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §7.5–7.6 — the streak
// ---------------------------------------------------------------------------

describe("higher gift — the 4-week block", () => {
  const cleanWeeks = (student: Types.ObjectId, weeks: number[]): RecSpec[] =>
    weeks.map((w) => ({ student, week: w, submittedOffset: -1 }));

  it("§7.5 four clean weeks give ONE streak entitlement at week 4", async () => {
    seed([1, 2, 3, 4].map((week) => ({ week })), cleanWeeks(ALICE, [1, 2, 3, 4]));
    const row = rowFor(await reportAfter(4), ALICE)!;
    expect(row.currentStreak).toBe(4);
    expect(row.streakMilestoneWeeks).toEqual([4]);
  });

  it("§7.5 a fifth clean week rolls the counter to 5 without a second entitlement", async () => {
    seed([1, 2, 3, 4, 5].map((week) => ({ week })), cleanWeeks(ALICE, [1, 2, 3, 4, 5]));
    const row = rowFor(await reportAfter(5), ALICE)!;
    expect(row.currentStreak).toBe(5);
    expect(row.streakMilestoneWeeks).toEqual([4]);
  });

  it("eight clean weeks give exactly two entitlements, at weeks 4 and 8", async () => {
    const weeks = [1, 2, 3, 4, 5, 6, 7, 8];
    seed(weeks.map((week) => ({ week })), cleanWeeks(ALICE, weeks));
    const row = rowFor(await reportAfter(8), ALICE)!;
    expect(row.currentStreak).toBe(8);
    expect(row.streakMilestoneWeeks).toEqual([4, 8]);
    expect(GIFT_STREAK_BLOCK).toBe(4);
  });

  it("a lost week resets the counter to zero", async () => {
    seed(
      [1, 2, 3].map((week) => ({ week })),
      [
        ...cleanWeeks(ALICE, [1, 2]),
        { student: ALICE, week: 3, submittedOffset: 2 }, // late
      ],
    );
    const row = rowFor(await reportAfter(3), ALICE)!;
    expect(row.currentStreak).toBe(0);
    expect(row.bestStreak).toBe(2);
    expect(row.streakMilestoneWeeks).toEqual([]);
  });

  it("§7.6 a week with no assignments BRIDGES the streak instead of breaking it", async () => {
    // Weeks 1,2,4,5 have work; week 3 has none (vacation).
    seed(
      [1, 2, 4, 5].map((week) => ({ week })),
      cleanWeeks(ALICE, [1, 2, 4, 5]),
    );
    const row = rowFor(await reportAfter(5), ALICE)!;
    expect(row.currentStreak).toBe(4);
    expect(row.streakMilestoneWeeks).toEqual([5]);
  });

  it("the streak is derived over the whole history, not just the visible window", async () => {
    const weeks = [1, 2, 3, 4];
    seed(weeks.map((week) => ({ week })), cleanWeeks(ALICE, weeks));
    // Window starts at week 4 — the counter must still read 4, not 1.
    const row = rowFor(await reportAfter(4, { weekFrom: 4 }), ALICE)!;
    expect(row.weeks).toHaveLength(1);
    expect(row.currentStreak).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// §7.7 — the live week
// ---------------------------------------------------------------------------

describe("settled weeks only", () => {
  it("§7.7 the current week reports PENDING and produces no loss", async () => {
    seed([{ week: 1 }, { week: 2 }], [
      ...[1].map((w) => ({ student: ALICE, week: w, submittedOffset: -1 })),
      { student: ALICE, week: 2, submittedOffset: null, state: "DUE" },
    ]);
    // "Today" is the day BEFORE week 2's due date — week 2 is still live.
    const report = await assignmentGiftReport({
      academicYearId: YEAR,
      weekFrom: 1,
      weekTo: 2,
      asOf: at(dueOf(2), -1),
    });
    const row = rowFor(report, ALICE)!;
    expect(row.weeks[1]).toMatchObject({ weekNumber: 2, settled: false, won: false });
    // The unsettled week must not reset the streak earned in week 1.
    expect(row.currentStreak).toBe(1);
    expect(report.weekDueDates[1]).toMatchObject({ weekNumber: 2, settled: false });
  });
});

// ---------------------------------------------------------------------------
// Ordering + the handover ledger
// ---------------------------------------------------------------------------

describe("report shape", () => {
  it("sorts the longest current streak first", async () => {
    seed(
      [1, 2].map((week) => ({ week })),
      [
        { student: ALICE, week: 1, submittedOffset: -1 },
        { student: ALICE, week: 2, submittedOffset: -1 },
        { student: BOB, week: 1, submittedOffset: -1 },
        { student: BOB, week: 2, submittedOffset: 3 },
      ],
    );
    const report = await reportAfter(2);
    expect(report.students.map((s) => s.studentName)).toEqual(["Alice", "Bob"]);
    expect(report.students[0].currentStreak).toBe(2);
    expect(report.students[1].currentStreak).toBe(0);
  });
});

describe("handover (AG-2)", () => {
  beforeEach(() => {
    mockStudentFindById.mockReturnValue({ classId: CLASS, sectionId: SECTION });
    mockClassFindById.mockReturnValue({ level: 1 });
    mockUserFindById.mockReturnValue({ name: "Office Desk" });
  });

  it("records a WEEKLY handover for a genuine winner", async () => {
    seed([{ week: 1 }], [{ student: ALICE, week: 1, submittedOffset: -1 }]);
    mockAwardUpsert.mockReturnValue({
      _id: new Types.ObjectId(),
      kind: "WEEKLY",
      weekNumber: 1,
      handedOverAt: new Date(),
      handedOverBy: OFFICER,
    });
    const award = await recordGiftHandover({
      academicYearId: YEAR,
      studentId: ALICE.toString(),
      kind: "WEEKLY",
      weekNumber: 1,
      handedOverBy: OFFICER.toString(),
      asOf: at(dueOf(1), 1),
    });
    expect(award).toMatchObject({ kind: "WEEKLY", weekNumber: 1, handedOverByName: "Office Desk" });
    expect(mockAwardUpsert).toHaveBeenCalled();
  });

  it("§7.8 refuses a WEEKLY handover for a student who did not win that week", async () => {
    seed([{ week: 1 }], [{ student: ALICE, week: 1, submittedOffset: 2 }]); // late
    await expect(
      recordGiftHandover({
        academicYearId: YEAR,
        studentId: ALICE.toString(),
        kind: "WEEKLY",
        weekNumber: 1,
        handedOverBy: OFFICER.toString(),
        asOf: at(dueOf(1), 3),
      }),
    ).rejects.toThrow(/সময়মতো জমা দেয়নি/);
    expect(mockAwardUpsert).not.toHaveBeenCalled();
  });

  it("refuses a STREAK handover on a week that does not close a 4-block", async () => {
    seed([1, 2, 3].map((week) => ({ week })), [1, 2, 3].map((w) => ({
      student: ALICE,
      week: w,
      submittedOffset: -1,
    })));
    await expect(
      recordGiftHandover({
        academicYearId: YEAR,
        studentId: ALICE.toString(),
        kind: "STREAK",
        weekNumber: 3,
        handedOverBy: OFFICER.toString(),
        asOf: at(dueOf(3), 1),
      }),
    ).rejects.toThrow(/৪ সপ্তাহের ধারা/);
  });

  it("stamps streakLength on a STREAK handover at the block boundary", async () => {
    const weeks = [1, 2, 3, 4];
    seed(weeks.map((week) => ({ week })), weeks.map((w) => ({
      student: ALICE,
      week: w,
      submittedOffset: -1,
    })));
    mockAwardUpsert.mockReturnValue({
      _id: new Types.ObjectId(),
      kind: "STREAK",
      weekNumber: 4,
      streakLength: 4,
      handedOverAt: new Date(),
      handedOverBy: OFFICER,
    });
    await recordGiftHandover({
      academicYearId: YEAR,
      studentId: ALICE.toString(),
      kind: "STREAK",
      weekNumber: 4,
      handedOverBy: OFFICER.toString(),
      asOf: at(dueOf(4), 1),
    });
    const update = mockAwardUpsert.mock.calls[0][1] as { $setOnInsert: { streakLength?: number } };
    expect(update.$setOnInsert.streakLength).toBe(4);
  });

  it("undo removes the row and reports whether anything was deleted", async () => {
    mockAwardDelete.mockReturnValue({ deletedCount: 1 });
    await expect(undoGiftHandover(YEAR, ALICE.toString(), "WEEKLY", 1)).resolves.toBe(true);
    mockAwardDelete.mockReturnValue({ deletedCount: 0 });
    await expect(undoGiftHandover(YEAR, ALICE.toString(), "WEEKLY", 1)).resolves.toBe(false);
  });
});
