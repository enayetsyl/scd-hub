/**
 * HW-T4 tests — roll-ups + thresholds + question-usage feed (handoff §7/§8).
 *
 * T4.1/T4.2 — homeworkSummary: chase list + attention/comms thresholds, open
 *             resubmissions, completion health, touches per TOP-tag
 * T4.3 — resubmissionWatchList: ≥3 open/recent resubmissions in a 2-week window
 * T4.4 — trimPatternFlags: subject trimmed on >30% of the month's school days
 * T4.5 — questionUsageFeed: de-identified per-question Pool usage counts
 *
 * DB-free: the three models' find().lean() are mocked; lifecycle is real.
 */
import mongoose from "mongoose";

const mockRecordFind = jest.fn();
const mockItemFind = jest.fn();
const mockReconFind = jest.fn();

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { find: (q: unknown) => ({ lean: () => mockRecordFind(q) }) },
}));
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { find: (q: unknown) => ({ lean: () => mockItemFind(q) }) },
}));
jest.mock("../modules/trackers/models/HomeworkReconciliation", () => ({
  HomeworkReconciliation: { find: (q: unknown) => ({ lean: () => mockReconFind(q) }) },
}));

import {
  homeworkSummary,
  homeworkClassOverview,
  resubmissionWatchList,
  trimPatternFlags,
  questionUsageFeed,
} from "../modules/trackers/services/HomeworkSummaryService";

const CLASS = new mongoose.Types.ObjectId().toString();
const DAY = 86_400_000;
const oid = () => new mongoose.Types.ObjectId();

beforeEach(() => jest.clearAllMocks());

// ===========================================================================
// T4.1 / T4.2 — homeworkSummary
// ===========================================================================

describe("T4.1/T4.2 — homeworkSummary", () => {
  test("chase thresholds, open resubmissions, completion health, topic touches", async () => {
    const day0 = new Date(2026, 5, 1, 9);
    mockRecordFind.mockResolvedValue([
      { _id: oid(), hwId: "HW-C1-MATH-0001", studentId: oid(), state: "CHASE", chaseCount: 3, stateDates: [{ state: "GIVEN", at: day0 }] },
      { _id: oid(), hwId: "HW-C1-MATH-0001", studentId: oid(), state: "CHASE", chaseCount: 2, stateDates: [{ state: "GIVEN", at: day0 }] },
      { _id: oid(), hwId: "HW-C1-MATH-0001", studentId: oid(), state: "GIVEN", chaseCount: 0, resubOf: oid(), stateDates: [{ state: "GIVEN", at: day0 }] }, // open resubmission
      { _id: oid(), hwId: "HW-C1-ENG-0001", studentId: oid(), state: "SUBMITTED", chaseCount: 0, stateDates: [{ state: "GIVEN", at: day0 }, { state: "SUBMITTED", at: day0 }] }, // on time
      { _id: oid(), hwId: "HW-C1-ENG-0001", studentId: oid(), state: "RETURNED", chaseCount: 0, stateDates: [{ state: "GIVEN", at: day0 }, { state: "RETURNED", at: new Date(day0.getTime() + 2 * DAY) }] }, // latency 2d
    ]);
    mockItemFind.mockResolvedValue([
      { topTags: ["TOP-MATH-C1-01", "TOP-MATH-C1-02"] },
      { topTags: ["TOP-MATH-C1-01"] },
    ]);

    const s = await homeworkSummary(CLASS);
    expect(s.chaseList).toHaveLength(2);
    expect(s.chaseList[0].chaseCount).toBe(3); // sorted desc
    expect(s.attentionCount).toBe(2); // both ≥2
    expect(s.commsPromptCount).toBe(1); // only the ≥3
    expect(s.openResubmissions).toBe(1);
    expect(s.pendingChecking).toBe(1); // the one SUBMITTED record awaiting check
    expect(s.submittedOnTimePct).toBe(100); // 1 reached SUBMITTED, chaseCount 0
    expect(s.chaseVolume).toBe(5); // 3+2
    expect(s.avgReturnLatencyDays).toBe(2);
    expect(s.topicTouches).toEqual([
      { topTag: "TOP-MATH-C1-01", count: 2 },
      { topTag: "TOP-MATH-C1-02", count: 1 },
    ]);
  });

  test("empty class → null health metrics, no crashes", async () => {
    mockRecordFind.mockResolvedValue([]);
    mockItemFind.mockResolvedValue([]);
    const s = await homeworkSummary(CLASS);
    expect(s.chaseList).toHaveLength(0);
    expect(s.submittedOnTimePct).toBeNull();
    expect(s.avgReturnLatencyDays).toBeNull();
    expect(s.chaseVolume).toBe(0);
  });
});

// ===========================================================================
// homeworkClassOverview — per-class dashboard badges (point 4)
// ===========================================================================

describe("homeworkClassOverview (per-class cumulative counts)", () => {
  test("aggregates pending checking / chases / resubmissions / on-time% / over-ceiling per class", async () => {
    const C1 = "class-1";
    const C2 = "class-2";
    const day0 = new Date(2026, 5, 1, 9);
    mockRecordFind.mockResolvedValue([
      { classId: C1, state: "SUBMITTED", chaseCount: 0, stateDates: [{ state: "GIVEN", at: day0 }, { state: "SUBMITTED", at: day0 }] },
      { classId: C1, state: "SUBMITTED", chaseCount: 1, stateDates: [{ state: "GIVEN", at: day0 }, { state: "SUBMITTED", at: day0 }] }, // chased → not on-time
      { classId: C1, state: "CHASE", chaseCount: 2, stateDates: [{ state: "GIVEN", at: day0 }] },
      { classId: C1, state: "DUE", chaseCount: 0, resubOf: oid(), stateDates: [{ state: "GIVEN", at: day0 }] }, // open resubmission
      // C2 has no records
    ]);
    mockItemFind.mockResolvedValue([
      { classId: C1, dateGiven: new Date(2026, 5, 1), timeDecl: 200 }, // day A …
      { classId: C1, dateGiven: new Date(2026, 5, 1), timeDecl: 50 }, // … = 250 > 120 → over
      { classId: C1, dateGiven: new Date(2026, 5, 2), timeDecl: 100 }, // day B = 100, under
    ]);

    const res = await homeworkClassOverview([C1, C2], new Date(2026, 5, 3).getTime());
    const c1 = res.find((r) => r.classId === C1)!;
    const c2 = res.find((r) => r.classId === C2)!;

    expect(c1.pendingChecking).toBe(2);
    expect(c1.activeChases).toBe(1);
    expect(c1.openResubmissions).toBe(1);
    expect(c1.onTimePct).toBe(50); // 2 reached SUBMITTED, 1 with no chase
    expect(c1.overCeilingDaysThisWeek).toBe(1); // only day A (250) over the 120 ceiling

    // every requested class is returned, zeroed when it has no data
    expect(c2.pendingChecking).toBe(0);
    expect(c2.activeChases).toBe(0);
    expect(c2.openResubmissions).toBe(0);
    expect(c2.onTimePct).toBeNull();
    expect(c2.overCeilingDaysThisWeek).toBe(0);
  });

  test("no classIds → [] (no DB hit)", async () => {
    const res = await homeworkClassOverview([], Date.now());
    expect(res).toEqual([]);
  });
});

// ===========================================================================
// T4.3 — resubmissionWatchList
// ===========================================================================

describe("T4.3 — resubmissionWatchList (≥3 open/recent per rolling 2 weeks)", () => {
  test("counts open + recent-terminal; excludes old-terminal; flags ≥3", async () => {
    const asOf = new Date(2026, 5, 15).getTime();
    const sA = oid().toString();
    const sB = oid().toString();
    mockRecordFind.mockResolvedValue([
      { studentId: sA, state: "GIVEN", createdAt: new Date(asOf - 1 * DAY) }, // open
      { studentId: sA, state: "DUE", createdAt: new Date(asOf - 2 * DAY) }, // open
      { studentId: sA, state: "RETURNED", createdAt: new Date(asOf - 3 * DAY) }, // terminal but within 14d
      { studentId: sB, state: "GIVEN", createdAt: new Date(asOf - 1 * DAY) }, // open
      { studentId: sB, state: "RETURNED", createdAt: new Date(asOf - 30 * DAY) }, // terminal + old → excluded
    ]);
    const r = await resubmissionWatchList(CLASS, asOf);
    expect(r.threshold).toBe(3);
    expect(r.windowDays).toBe(14);
    expect(r.watchList).toEqual([{ studentId: sA, resubmissionCount: 3 }]); // sB has only 1 relevant
  });
});

// ===========================================================================
// T4.4 — trimPatternFlags
// ===========================================================================

describe("T4.4 — trimPatternFlags (>30% of school days)", () => {
  test("flags a subject trimmed on >30% of the month's reconciled days", async () => {
    mockReconFind.mockResolvedValue([
      { reconDate: new Date(2026, 5, 1), trimLog: [{ hwId: "HW-C-1-MATH-0001" }] },
      { reconDate: new Date(2026, 5, 2), trimLog: [{ hwId: "HW-C1-MATH-0002" }, { hwId: "HW-C1-ENG-0001" }] },
      { reconDate: new Date(2026, 5, 3), trimLog: [{ hwId: "HW-C1-MATH-0003" }] },
      { reconDate: new Date(2026, 5, 4), trimLog: [] },
    ]);
    const r = await trimPatternFlags(CLASS, new Date(2026, 5, 1).getTime(), new Date(2026, 5, 30).getTime());
    expect(r.schoolDays).toBe(4);
    const math = r.flags.find((f) => f.subject === "MATH")!;
    const eng = r.flags.find((f) => f.subject === "ENG")!;
    expect(math.trimmedDays).toBe(3);
    expect(math.ratio).toBe(0.75);
    expect(math.flagged).toBe(true);
    expect(eng.trimmedDays).toBe(1);
    expect(eng.ratio).toBe(0.25);
    expect(eng.flagged).toBe(false); // 0.25 ≤ 0.30
    expect(r.flags[0].subject).toBe("MATH"); // sorted by ratio desc
  });
});

// ===========================================================================
// T4.5 — questionUsageFeed (de-identified)
// ===========================================================================

describe("T4.5 — questionUsageFeed (de-identified)", () => {
  test("counts qids across items + top-ups; sorted desc; no identity fields", async () => {
    mockItemFind.mockResolvedValue([
      { selectedQids: ["q1", "q2"] },
      { selectedQids: ["q1"] },
    ]);
    mockRecordFind.mockResolvedValue([{ topupQids: ["q1", "q3"] }]);
    const r = await questionUsageFeed(CLASS);
    expect(r.feed[0]).toEqual({ qid: "q1", count: 3 }); // 2 items + 1 top-up
    const q2 = r.feed.find((f) => f.qid === "q2")!;
    const q3 = r.feed.find((f) => f.qid === "q3")!;
    expect(q2.count).toBe(1);
    expect(q3.count).toBe(1);
    // de-identified: entries carry only qid + count
    expect(Object.keys(r.feed[0]).sort()).toEqual(["count", "qid"]);
  });
});
