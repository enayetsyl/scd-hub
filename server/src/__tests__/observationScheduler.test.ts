/**
 * Classroom Observation CO-6 tests (prd-classroom-observation §CO-6, D-#85) — the
 * review-cadence SCHEDULER (suggests who's due; never auto-assigns).
 *
 * Pure     — deriveTier (REF-11 breach / level-1 ⇒ NEEDS_SUPPORT; all ≥3 ⇒ STRONG;
 *            else DEVELOPING; Quran avg-rating + compliance branches) and intervalForTier
 *            (STRONG longest, NEEDS_SUPPORT shortest, clamped up to the frequency cap).
 * Due list — dueForReview ranks never-reviewed (soonest bucket) first, then weakest tier,
 *            then most-overdue; a not-yet-due teacher is omitted. `now` injected.
 * Config   — setScheduleConfig validates the cadence (base/cap ≥1, strong ≥1,
 *            needsSupport in (0,1]) and audits; bad input throws before any write.
 * RBAC     — executed against the built schema with each role's context: observationDueList
 *            is observation:manage (Principal/Office allowed; TEACHER/GUARDIAN/unauth denied).
 *
 * DB-free (repo convention): the models + AuditService are mocked.
 */
import mongoose from "mongoose";
import { graphql } from "graphql";
import type { ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const mockObsFind = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: { find: (q: unknown) => mockObsFind(q) },
}));

const mockCfgFindOne = jest.fn();
const mockCfgUpdateOne = jest.fn();
jest.mock("../modules/classroom-observation/models/ObservationScheduleConfig", () => ({
  ObservationScheduleConfig: {
    findOne: (q: unknown) => ({ lean: async () => mockCfgFindOne(q) }),
    updateOne: (...a: unknown[]) => mockCfgUpdateOne(...a),
  },
}));

const mockSlotDistinct = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { distinct: (field: string, q: unknown) => mockSlotDistinct(field, q) },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (...a: unknown[]) => mockWriteAudit(...a),
}));

// Import AFTER mocks
import {
  deriveTier,
  intervalForTier,
  dueForReview,
  setScheduleConfig,
  DEFAULT_SCHEDULE_CONFIG,
} from "../modules/classroom-observation/services/ClassroomObservationSchedulerService";
import { builder } from "../schema";
import "../modules/classroom-observation/resolvers/observationSchedule";

const RELEASED = ["REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"];

const ref11 = (levels: number[], breach = false) => ({
  form: "REF11",
  domains: ["D1", "D2", "D3", "D4", "D5"].map((domain, i) => ({ domain, level: levels[i], note: "" })),
  gates: [
    { gate: "G1", result: breach ? "BREACH" : "PASS" },
    { gate: "G2", result: "PASS" },
  ],
  quran: null,
});

const quran = (scores: number[], compliance: boolean[]) => ({
  form: "QURAN",
  domains: [],
  gates: [],
  quran: {
    ratings: scores.map((score, i) => ({ criterion: `C${i}`, score })),
    compliance: compliance.map((yesNo, i) => ({ item: `I${i}`, yesNo })),
    strengths: "",
    improvements: "",
    suggestions: "",
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCfgFindOne.mockResolvedValue(null); // no admin row ⇒ working defaults
});

// ===========================================================================
// deriveTier (pure)
// ===========================================================================

describe("deriveTier", () => {
  test("REF-11: a gate BREACH ⇒ NEEDS_SUPPORT regardless of levels", () => {
    expect(deriveTier(ref11([4, 4, 4, 4, 4], true) as never)).toBe("NEEDS_SUPPORT");
  });
  test("REF-11: any domain at level 1 ⇒ NEEDS_SUPPORT", () => {
    expect(deriveTier(ref11([3, 3, 1, 3, 3]) as never)).toBe("NEEDS_SUPPORT");
  });
  test("REF-11: all domains ≥3 ⇒ STRONG", () => {
    expect(deriveTier(ref11([3, 3, 4, 3, 4]) as never)).toBe("STRONG");
  });
  test("REF-11: a level 2 (no 1, no breach) ⇒ DEVELOPING", () => {
    expect(deriveTier(ref11([3, 2, 3, 3, 3]) as never)).toBe("DEVELOPING");
  });
  test("Quran: avg ≥4 + full compliance ⇒ STRONG", () => {
    expect(deriveTier(quran([5, 4, 4, 4], [true, true, true]) as never)).toBe("STRONG");
  });
  test("Quran: avg ≤2.5 ⇒ NEEDS_SUPPORT", () => {
    expect(deriveTier(quran([2, 2, 3, 2], [true, true, true]) as never)).toBe("NEEDS_SUPPORT");
  });
  test("Quran: <half compliance ⇒ NEEDS_SUPPORT", () => {
    expect(deriveTier(quran([4, 4, 4, 4], [false, false, true]) as never)).toBe("NEEDS_SUPPORT");
  });
  test("Quran: middling ⇒ DEVELOPING", () => {
    expect(deriveTier(quran([3, 4, 3, 3], [true, true, false]) as never)).toBe("DEVELOPING");
  });
});

// ===========================================================================
// intervalForTier (pure)
// ===========================================================================

describe("intervalForTier", () => {
  const cfg = DEFAULT_SCHEDULE_CONFIG; // base 30, strong ×2, needs ×0.5, cap 7
  test("STRONG is the longest, NEEDS_SUPPORT the shortest, DEVELOPING the base", () => {
    expect(intervalForTier("STRONG", cfg)).toBe(60);
    expect(intervalForTier("DEVELOPING", cfg)).toBe(30);
    expect(intervalForTier("NEEDS_SUPPORT", cfg)).toBe(15);
  });
  test("the frequency cap clamps a tiny tiered interval up to minIntervalDays", () => {
    const tight = { baseIntervalDays: 4, strongMultiplier: 1, needsSupportMultiplier: 0.5, minIntervalDays: 7 };
    expect(intervalForTier("NEEDS_SUPPORT", tight)).toBe(7); // 4×0.5=2 → clamped to 7
  });
});

// ===========================================================================
// dueForReview — routine-aware ranked due list
// ===========================================================================

describe("dueForReview", () => {
  test("ranks never-reviewed first, then weakest tier, then most-overdue; not-yet-due omitted", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const reviewedAt = new Date(now.getTime() - 40 * DAY); // 40 days ago

    const T1 = oid(); // never reviewed → soonest bucket
    const T2 = oid(); // NEEDS_SUPPORT (breach), interval 15 → due 25d ago (overdue)
    const T3 = oid(); // STRONG, interval 60 → due in +20d (NOT yet due → omitted)
    const T4 = oid(); // DEVELOPING, interval 30 → due 10d ago (overdue)

    mockSlotDistinct.mockResolvedValue([T1, T2, T3, T4]);
    mockObsFind.mockReturnValue({
      lean: async () => [
        { _id: oid(), teacherId: T2, state: "REVIEWED", reviewedAt, createdAt: reviewedAt, ...ref11([3, 3, 3, 3, 3], true) },
        { _id: oid(), teacherId: T3, state: "REVIEWED", reviewedAt, createdAt: reviewedAt, ...ref11([3, 3, 3, 3, 3]) },
        { _id: oid(), teacherId: T4, state: "REVIEWED", reviewedAt, createdAt: reviewedAt, ...ref11([3, 2, 3, 3, 3]) },
      ],
    });

    const res = await dueForReview(now);
    expect(res.candidateCount).toBe(4);
    const ids = res.items.map((i) => i.teacherId);
    expect(ids).toEqual([T1.toString(), T2.toString(), T4.toString()]); // T3 omitted (not due)

    const first = res.items[0];
    expect(first.neverReviewed).toBe(true);
    expect(first.tier).toBeNull();

    const t2 = res.items.find((i) => i.teacherId === T2.toString())!;
    expect(t2.tier).toBe("NEEDS_SUPPORT");
    expect(t2.intervalDays).toBe(15);
    expect(t2.overdueDays).toBe(25);

    const t4 = res.items.find((i) => i.teacherId === T4.toString())!;
    expect(t4.tier).toBe("DEVELOPING");
    expect(t4.overdueDays).toBe(10);
  });

  test("picks the MOST RECENT released review per teacher", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const T = oid();
    const older = new Date(now.getTime() - 90 * DAY); // STRONG, would not be due
    const newer = new Date(now.getTime() - 40 * DAY); // NEEDS_SUPPORT, interval 15 → overdue
    mockSlotDistinct.mockResolvedValue([T]);
    mockObsFind.mockReturnValue({
      lean: async () => [
        { _id: oid(), teacherId: T, state: "REVIEWED", reviewedAt: older, createdAt: older, ...ref11([3, 3, 3, 3, 3]) },
        { _id: oid(), teacherId: T, state: "REVIEWED", reviewedAt: newer, createdAt: newer, ...ref11([1, 3, 3, 3, 3]) },
      ],
    });
    const res = await dueForReview(now);
    expect(res.items[0].tier).toBe("NEEDS_SUPPORT"); // from the newer review, not the older STRONG one
    expect(res.items[0].lastReviewedAt).toBe(newer.toISOString());
  });

  test("no teaching teachers ⇒ empty list", async () => {
    mockSlotDistinct.mockResolvedValue([]);
    const res = await dueForReview(new Date("2026-07-01T00:00:00Z"));
    expect(res.candidateCount).toBe(0);
    expect(res.items).toEqual([]);
    expect(mockObsFind).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// setScheduleConfig — validation + audit
// ===========================================================================

describe("setScheduleConfig", () => {
  const good = { baseIntervalDays: 30, strongMultiplier: 2, needsSupportMultiplier: 0.5, minIntervalDays: 7 };

  test("a valid cadence updates + audits", async () => {
    mockCfgUpdateOne.mockResolvedValue({});
    await setScheduleConfig(good, oid().toString());
    expect(mockCfgUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "OBSERVATION_SCHEDULE_CONFIG_SET" }),
    );
  });

  test.each([
    ["baseIntervalDays < 1", { ...good, baseIntervalDays: 0 }],
    ["non-integer base", { ...good, baseIntervalDays: 2.5 }],
    ["strongMultiplier < 1", { ...good, strongMultiplier: 0.9 }],
    ["needsSupportMultiplier > 1", { ...good, needsSupportMultiplier: 1.5 }],
    ["needsSupportMultiplier = 0", { ...good, needsSupportMultiplier: 0 }],
    ["minIntervalDays < 1", { ...good, minIntervalDays: 0 }],
  ])("rejects %s before any write", async (_label, bad) => {
    await expect(setScheduleConfig(bad as never, oid().toString())).rejects.toThrow();
    expect(mockCfgUpdateOne).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// RBAC — executed against the built schema with each role's context
// ===========================================================================

const schema = builder.toSchema();

type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string | null, userId = oid().toString()): Ctx => ({
  auth: role ? { role, userId } : null,
});
const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

describe("observationDueList — observation:manage", () => {
  const Q = `query{ observationDueList{ candidateCount items { teacherId tier overdueDays neverReviewed } } }`;

  beforeEach(() => {
    mockSlotDistinct.mockResolvedValue([]); // empty pool keeps the resolver cheap
  });

  test.each([
    ["PRINCIPAL", false],
    ["OFFICE", false],
    ["TEACHER", true],
    ["GUARDIAN", true],
    [null, true],
  ])("role %s denied=%s", async (role, expectDenied) => {
    const r = await graphql({ schema, source: Q, contextValue: ctxOf(role) });
    expect(denied(r)).toBe(expectDenied);
  });
});
