/**
 * HW-T2 tests — daily budget reconciliation + trim log + cadence (handoff §4/§6).
 *
 * T2.1 — tallyDay: live DAY_TOTAL vs 240; over/under state; band warning (>40)
 * T2.2 — confirmHomeworkDay: over-ceiling BLOCKS issue; within-ceiling issues + reconciles
 * T2.3 — applyTrim: by question count (time follows proportionally), ranks ক/খ/গ
 * T2.4 — trim log row recorded; reconciled day rejects further trims (immutable)
 * T2.5 — band warns (>40) but never blocks; only the day-sum blocks
 * T2.6 — Fri/Sat issuing hard-blocked
 *
 * DB-free: models + the HomeworkService spawn/list helpers are mocked.
 */
import mongoose from "mongoose";

const mockList = jest.fn();
const mockIssue = jest.fn();
const mockItemFindById = jest.fn();
const mockReconFindOne = jest.fn();
const mockReconUpdate = jest.fn();

jest.mock("../modules/trackers/services/HomeworkService", () => ({
  listDailyItems: (...a: unknown[]) => mockList(...a),
  issueHomeworkItem: (...a: unknown[]) => mockIssue(...a),
  // Topic-label enrichment used by tallyDay — stub to a no-op (label tested elsewhere).
  topicLabelByCode: async () => new Map<string, string>(),
  joinTopicLabels: (tags: string[]) => (tags ?? []).join(" · "),
}));

jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { findById: (id: unknown) => mockItemFindById(id) },
}));

jest.mock("../modules/trackers/models/HomeworkReconciliation", () => ({
  HomeworkReconciliation: {
    findOne: (...a: unknown[]) => mockReconFindOne(...a),
    findOneAndUpdate: (...a: unknown[]) => mockReconUpdate(...a),
  },
  reconDayKey: (date: Date) => {
    const d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  },
}));

// Import AFTER mocks
import {
  tallyDay,
  getTrimCandidates,
  applyTrim,
  confirmHomeworkDay,
} from "../modules/trackers/services/HomeworkReconciliationService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR_ID = new mongoose.Types.ObjectId().toString();
const CLASS_ID = new mongoose.Types.ObjectId().toString();
const SECTION_ID = new mongoose.Types.ObjectId().toString();
const YEAR_ID = new mongoose.Types.ObjectId();

function dateWithDay(target: number): Date {
  const d = new Date(2026, 5, 1, 9, 0, 0);
  while (d.getDay() !== target) d.setDate(d.getDate() + 1);
  return d;
}
const A_TUESDAY = dateWithDay(2);
const A_FRIDAY = dateWithDay(5);

let idSeq = 0;
function leanItem(over: Record<string, unknown> = {}) {
  idSeq += 1;
  return {
    _id: new mongoose.Types.ObjectId(),
    hwId: `HW-C1-MATH-000${idSeq}`,
    subject: "MATH",
    timeDecl: 20,
    qCount: 10,
    revItem: false,
    status: "declared",
    dateGiven: A_TUESDAY,
    sectionId: SECTION_ID,
    classId: CLASS_ID,
    academicYearId: YEAR_ID,
    ...over,
  };
}

const leanNull = { lean: () => Promise.resolve(null) };
const leanRecon = (doc: unknown) => ({ lean: () => Promise.resolve(doc) });

beforeEach(() => {
  jest.clearAllMocks();
  idSeq = 0;
  mockReconFindOne.mockReturnValue(leanNull);
  mockReconUpdate.mockResolvedValue({});
  mockIssue.mockResolvedValue({ issuedCount: 3 });
});

// ===========================================================================
// T2.1 / T2.5 — tallyDay
// ===========================================================================

describe("T2.1/T2.5 — tallyDay (live DAY_TOTAL vs 240)", () => {
  test("sums TIME_DECL; under 240 → within_ceiling", async () => {
    mockList.mockResolvedValue([leanItem({ timeDecl: 20 }), leanItem({ timeDecl: 30 })]);
    const r = await tallyDay(CLASS_ID, A_TUESDAY);
    expect(r.dayTotal).toBe(50);
    expect(r.ceiling).toBe(240);
    expect(r.withinCeiling).toBe(true);
    expect(r.state).toBe("within_ceiling");
    expect(r.overBy).toBe(0);
  });

  test("over 240 → over_ceiling with overBy", async () => {
    mockList.mockResolvedValue([leanItem({ timeDecl: 200 }), leanItem({ timeDecl: 60 })]);
    const r = await tallyDay(CLASS_ID, A_TUESDAY);
    expect(r.dayTotal).toBe(260);
    expect(r.withinCeiling).toBe(false);
    expect(r.state).toBe("over_ceiling");
    expect(r.overBy).toBe(20);
  });

  test("a >40 subject raises a band warning but does NOT change the block decision", async () => {
    mockList.mockResolvedValue([leanItem({ timeDecl: 45, hwId: "HW-C1-MATH-0009" })]);
    const r = await tallyDay(CLASS_ID, A_TUESDAY);
    expect(r.bandWarnings).toContain("HW-C1-MATH-0009");
    expect(r.items[0].bandWarning).toBe(true);
    expect(r.withinCeiling).toBe(true); // 45 ≤ 240 day-sum → not blocked
  });

  test("a reconciled day reports state=reconciled", async () => {
    mockList.mockResolvedValue([leanItem()]);
    mockReconFindOne.mockReturnValue(leanRecon({ reconState: "reconciled" }));
    const r = await tallyDay(CLASS_ID, A_TUESDAY);
    expect(r.state).toBe("reconciled");
  });
});

// ===========================================================================
// T2.3 — getTrimCandidates (ranked ক→খ→গ)
// ===========================================================================

describe("T2.3 — getTrimCandidates", () => {
  test("rankA = revision items; rankB sorted ascending by TIME_DECL; rankC = all live", async () => {
    mockList.mockResolvedValue([
      leanItem({ timeDecl: 30, revItem: true }),
      leanItem({ timeDecl: 10 }),
      leanItem({ timeDecl: 20 }),
    ]);
    const c = await getTrimCandidates(CLASS_ID, A_TUESDAY);
    expect(c.rankA).toHaveLength(1);
    expect(c.rankA[0].revItem).toBe(true);
    expect(c.rankB.map((i) => i.timeDecl)).toEqual([10, 20, 30]); // ascending
    expect(c.rankC).toHaveLength(3);
  });

  test("excludes already-issued or zeroed items from candidates", async () => {
    mockList.mockResolvedValue([
      leanItem({ status: "issued" }),
      leanItem({ qCount: 0, timeDecl: 0 }),
      leanItem({ timeDecl: 15 }),
    ]);
    const c = await getTrimCandidates(CLASS_ID, A_TUESDAY);
    expect(c.rankC).toHaveLength(1);
    expect(c.rankC[0].timeDecl).toBe(15);
  });
});

// ===========================================================================
// T2.3 / T2.4 — applyTrim (by count, proportional time, logged, immutable)
// ===========================================================================

describe("T2.3/T2.4 — applyTrim", () => {
  function itemDoc(over: Record<string, unknown> = {}) {
    return {
      _id: new mongoose.Types.ObjectId(),
      hwId: "HW-C1-MATH-0001",
      classId: CLASS_ID,
      sectionId: SECTION_ID,
      academicYearId: YEAR_ID,
      dateGiven: A_TUESDAY,
      status: "declared",
      qCount: 10,
      timeDecl: 20,
      revItem: false,
      save: jest.fn().mockResolvedValue(true),
      ...over,
    };
  }

  test("rank খ (b): cutting Q_COUNT cuts TIME_DECL proportionally + logs a trim row", async () => {
    const item = itemDoc({ qCount: 10, timeDecl: 20 });
    mockItemFindById.mockResolvedValue(item);
    mockList.mockResolvedValue([]); // post-trim tally
    const r = await applyTrim({
      classId: CLASS_ID,
      date: A_TUESDAY,
      itemId: item._id.toString(),
      newQCount: 5,
      rank: "b",
      actorId: ACTOR_ID,
    });
    expect(item.qCount).toBe(5);
    expect(item.timeDecl).toBe(10); // 20 * 5/10
    expect(r.trimFrom).toBe(10);
    expect(r.trimTo).toBe(5);
    expect(r.trimMin).toBe(10);
    // a trim row was pushed
    const update = mockReconUpdate.mock.calls[0][1] as { $push: { trimLog: { rank: string } } };
    expect(update.$push.trimLog.rank).toBe("b");
  });

  test("rank ক (a): requires a revision item and clears it", async () => {
    const noRev = itemDoc({ revItem: false });
    mockItemFindById.mockResolvedValue(noRev);
    await expect(
      applyTrim({ classId: CLASS_ID, date: A_TUESDAY, itemId: "x", newQCount: 5, rank: "a", actorId: ACTOR_ID }),
    ).rejects.toThrow(/revision item/);

    const withRev = itemDoc({ revItem: true, qCount: 6, timeDecl: 18 });
    mockItemFindById.mockResolvedValue(withRev);
    mockList.mockResolvedValue([]);
    await applyTrim({
      classId: CLASS_ID,
      date: A_TUESDAY,
      itemId: withRev._id.toString(),
      newQCount: 5,
      rank: "a",
      actorId: ACTOR_ID,
    });
    expect(withRev.revItem).toBe(false);
    expect(withRev.timeDecl).toBe(15); // 18 * 5/6
  });

  test("rank গ (c): zeroes the subject (Q_COUNT→0, TIME_DECL→0)", async () => {
    const item = itemDoc({ qCount: 4, timeDecl: 20 });
    mockItemFindById.mockResolvedValue(item);
    mockList.mockResolvedValue([]);
    const r = await applyTrim({
      classId: CLASS_ID,
      date: A_TUESDAY,
      itemId: item._id.toString(),
      newQCount: 0,
      rank: "c",
      actorId: ACTOR_ID,
    });
    expect(item.qCount).toBe(0);
    expect(item.timeDecl).toBe(0);
    expect(r.trimMin).toBe(20);
  });

  test("rejects a non-reducing trim (never extends time)", async () => {
    const item = itemDoc({ qCount: 5 });
    mockItemFindById.mockResolvedValue(item);
    await expect(
      applyTrim({ classId: CLASS_ID, date: A_TUESDAY, itemId: "x", newQCount: 8, rank: "b", actorId: ACTOR_ID }),
    ).rejects.toThrow(/must REDUCE/);
  });

  test("rank খ (b) cannot zero a subject (that is rank গ)", async () => {
    const item = itemDoc({ qCount: 5 });
    mockItemFindById.mockResolvedValue(item);
    await expect(
      applyTrim({ classId: CLASS_ID, date: A_TUESDAY, itemId: "x", newQCount: 0, rank: "b", actorId: ACTOR_ID }),
    ).rejects.toThrow(/rank গ/);
  });

  test("T2.4 — a reconciled day rejects further trims (log immutable)", async () => {
    mockReconFindOne.mockReturnValue(leanRecon({ reconState: "reconciled" }));
    await expect(
      applyTrim({ classId: CLASS_ID, date: A_TUESDAY, itemId: "x", newQCount: 5, rank: "b", actorId: ACTOR_ID }),
    ).rejects.toThrow(/immutable/);
    expect(mockItemFindById).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// T2.2 / T2.6 — confirmHomeworkDay (the gate)
// ===========================================================================

describe("T2.2/T2.6 — confirmHomeworkDay (ceiling gate + cadence)", () => {
  test("within ceiling → issues every declared item with q>0 and reconciles", async () => {
    mockList.mockResolvedValue([
      leanItem({ timeDecl: 100 }),
      leanItem({ timeDecl: 60 }),
      leanItem({ qCount: 0, timeDecl: 0 }), // zeroed → not issued
    ]);
    const r = await confirmHomeworkDay({
      classId: CLASS_ID,
      date: A_TUESDAY,
      roster: [{ studentId: "s1", present: true }],
      actorId: ACTOR_ID,
    });
    expect(r.dayTotal).toBe(160);
    expect(r.reconState).toBe("reconciled");
    expect(r.issuedItems).toBe(2); // the zeroed one skipped
    expect(r.issuedRecords).toBe(6); // 2 items × 3 each (mockIssue)
    expect(mockIssue).toHaveBeenCalledTimes(2);
    const update = mockReconUpdate.mock.calls[0][1] as { $set: { reconState: string } };
    expect(update.$set.reconState).toBe("reconciled");
  });

  test("T2.2 — over-ceiling day is BLOCKED: nothing is issued", async () => {
    mockList.mockResolvedValue([leanItem({ timeDecl: 200 }), leanItem({ timeDecl: 60 })]);
    await expect(
      confirmHomeworkDay({ classId: CLASS_ID, date: A_TUESDAY, roster: [], actorId: ACTOR_ID }),
    ).rejects.toThrow(/exceeds the 240-min ceiling/);
    expect(mockIssue).not.toHaveBeenCalled();
    expect(mockReconUpdate).not.toHaveBeenCalled();
  });

  test("T2.6 — Fri/Sat issuing is hard-blocked", async () => {
    await expect(
      confirmHomeworkDay({ classId: CLASS_ID, date: A_FRIDAY, roster: [], actorId: ACTOR_ID }),
    ).rejects.toThrow(/weekend is blocked/);
    expect(mockList).not.toHaveBeenCalled();
  });

  test("throws when no homework is declared for the day", async () => {
    mockList.mockResolvedValue([]);
    await expect(
      confirmHomeworkDay({ classId: CLASS_ID, date: A_TUESDAY, roster: [], actorId: ACTOR_ID }),
    ).rejects.toThrow(/No homework declared/);
  });
});
