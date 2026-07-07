/**
 * Classroom Observation CO-7 tests (prd-classroom-observation §CO-7, D-#85/#231) — the
 * private reviewer-effectiveness read + the teacher fairness rating.
 *
 * Pure   — agreementWithinOne (per-domain within-one-level, shared domains only) +
 *          domainMovement (improved/declined/net on a re-review).
 * Rate   — rateReview: observed-teacher-only, released-state-only, 1–5 validation, audit.
 * Read   — reviewerEffectiveness aggregates throughput, timeliness + backlog, calibration
 *          (two observers on ONE recording), developmental impact (re-review attributed
 *          to the PRIOR observer), and the teacher fairness ratings — `now` injected.
 * RBAC   — executed against the built schema: reviewerEffectiveness is observation:manage
 *          (P/O allowed; TEACHER/GUARDIAN/unauth denied); rateObservationReview is
 *          observation:read (the observed teacher passes; GUARDIAN denied).
 *
 * DB-free (repo convention): the models + AuditService are mocked.
 */
import mongoose from "mongoose";
import { graphql } from "graphql";
import type { ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockObsFind = jest.fn();
const mockObsFindById = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: {
    find: (q: unknown) => ({ lean: async () => mockObsFind(q) }),
    findById: (id: unknown) => mockObsFindById(id),
  },
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => ({ select: () => ({ lean: async () => mockUserFind(q) }) }) },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (...a: unknown[]) => mockWriteAudit(...a),
}));

// Import AFTER mocks
import {
  agreementWithinOne,
  domainMovement,
  rateReview,
  reviewerEffectiveness,
} from "../modules/classroom-observation/services/ClassroomObservationEffectivenessService";
import { builder } from "../schema";
import "../modules/classroom-observation/resolvers/observationEffectiveness";

const dl = (pairs: [string, number][]) => pairs.map(([domain, level]) => ({ domain, level }));

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFind.mockResolvedValue([]);
});

// ===========================================================================
// Pure helpers
// ===========================================================================

describe("agreementWithinOne", () => {
  test("counts only shared domains; within one level = agree", () => {
    const a = dl([["D1", 2], ["D2", 2], ["D3", 4]]);
    const b = dl([["D1", 3], ["D2", 4], ["D3", 4]]); // D1 Δ1 ok, D2 Δ2 no, D3 Δ0 ok
    expect(agreementWithinOne(a, b)).toEqual({ compared: 3, agreed: 2, rate: 2 / 3 });
  });
  test("no shared domains ⇒ null rate", () => {
    expect(agreementWithinOne(dl([["D1", 2]]), dl([["D2", 2]])).rate).toBeNull();
  });
});

describe("domainMovement", () => {
  test("improved / declined / net over shared domains", () => {
    const prior = dl([["D1", 2], ["D2", 3], ["D3", 4]]);
    const fresh = dl([["D1", 3], ["D2", 2], ["D3", 4]]); // +1, -1, 0
    expect(domainMovement(prior, fresh)).toEqual({ improved: 1, declined: 1, net: 0 });
  });
});

// ===========================================================================
// rateReview
// ===========================================================================

describe("rateReview", () => {
  const T = oid();
  const O = oid();
  const makeDoc = (over: Record<string, unknown> = {}) => ({
    _id: oid(),
    teacherId: T,
    observerId: O,
    state: "REVIEWED",
    publishedAt: new Date("2026-06-15T00:00:00Z"), // CO-8: only a published review is ratable
    fairnessRating: null,
    usefulnessRating: null,
    fairnessRatedAt: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  test("the observed teacher rates a released review + audits", async () => {
    const doc = makeDoc();
    mockObsFindById.mockResolvedValue(doc);
    const res = await rateReview({ observationId: doc._id.toString(), actorId: T.toString(), fairnessRating: 4, usefulnessRating: 5 });
    expect(res.fairnessRating).toBe(4);
    expect(res.usefulnessRating).toBe(5);
    expect(doc.fairnessRating).toBe(4);
    expect(doc.save).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "OBSERVATION_REVIEW_RATED" }));
  });

  test("a non-observed caller is refused", async () => {
    mockObsFindById.mockResolvedValue(makeDoc());
    await expect(
      rateReview({ observationId: oid().toString(), actorId: oid().toString(), fairnessRating: 4 }),
    ).rejects.toThrow();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("an unreleased (ASSIGNED) row cannot be rated", async () => {
    mockObsFindById.mockResolvedValue(makeDoc({ state: "ASSIGNED" }));
    await expect(rateReview({ observationId: oid().toString(), actorId: T.toString(), fairnessRating: 4 })).rejects.toThrow();
  });

  test.each([0, 6, 2.5])("rejects an out-of-range fairness rating %s", async (bad) => {
    mockObsFindById.mockResolvedValue(makeDoc());
    await expect(rateReview({ observationId: oid().toString(), actorId: T.toString(), fairnessRating: bad })).rejects.toThrow();
  });
});

// ===========================================================================
// reviewerEffectiveness
// ===========================================================================

describe("reviewerEffectiveness", () => {
  test("aggregates throughput, timeliness, backlog, calibration, impact, fairness", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const O1 = oid();
    const O2 = oid();
    const R1 = oid(); // shared recording → calibration
    const A = oid();

    const t0 = new Date("2026-06-01T00:00:00Z");
    const t1 = new Date("2026-06-03T00:00:00Z");

    // O1's review (later superseded), rated by the teacher, on recording R1.
    const obsA = {
      _id: A,
      observerId: O1,
      recordingId: R1,
      form: "REF11",
      state: "SUPERSEDED",
      assignedAt: t0,
      reviewedAt: new Date(t0.getTime() + 2 * DAY), // 2-day turnaround
      domains: dl([["D1", 2], ["D2", 2]]),
      prevObservationId: null,
      fairnessRating: 4,
      usefulnessRating: 5,
    };
    // O2's re-review of A, on the same recording R1.
    const obsB = {
      _id: oid(),
      observerId: O2,
      recordingId: R1,
      form: "REF11",
      state: "REVIEWED",
      assignedAt: t1,
      reviewedAt: new Date(t1.getTime() + 1 * DAY), // 1-day turnaround
      domains: dl([["D1", 3], ["D2", 4]]),
      prevObservationId: A, // re-review → impact attributed to O1
      fairnessRating: null,
    };
    // O2 has one open assignment → backlog 1.
    const obsC = { _id: oid(), observerId: O2, form: "REF11", state: "ASSIGNED", domains: [] };

    mockObsFind.mockResolvedValue([obsA, obsB, obsC]);
    mockUserFind.mockResolvedValue([
      { _id: O1, name: "Observer One" },
      { _id: O2, name: "Observer Two" },
    ]);

    const res = await reviewerEffectiveness(now);
    const o1 = res.observers.find((o) => o.observerId === O1.toString())!;
    const o2 = res.observers.find((o) => o.observerId === O2.toString())!;

    // O1
    expect(o1.observerName).toBe("Observer One");
    expect(o1.reviewsCompleted).toBe(1);
    expect(o1.avgTurnaroundDays).toBe(2);
    expect(o1.backlog).toBe(0);
    expect(o1.calibrationPairs).toBe(1);
    expect(o1.calibrationAgreement).toBe(0.5); // D1 Δ1 ok, D2 Δ2 no → 1/2
    expect(o1.impactReReviews).toBe(1);
    expect(o1.impactAvgDomainsImproved).toBe(2); // both domains rose
    expect(o1.avgFairness).toBe(4);
    expect(o1.avgUsefulness).toBe(5);
    expect(o1.ratingsReceived).toBe(1);

    // O2
    expect(o2.reviewsCompleted).toBe(1);
    expect(o2.avgTurnaroundDays).toBe(1);
    expect(o2.backlog).toBe(1);
    expect(o2.calibrationAgreement).toBe(0.5);
    expect(o2.impactReReviews).toBe(0);
    expect(o2.avgFairness).toBeNull();
    expect(o2.ratingsReceived).toBe(0);
  });

  test("no observers ⇒ empty", async () => {
    mockObsFind.mockResolvedValue([]);
    const res = await reviewerEffectiveness(new Date("2026-07-01T00:00:00Z"));
    expect(res.observers).toEqual([]);
  });
});

// ===========================================================================
// RBAC — executed against the built schema
// ===========================================================================

const schema = builder.toSchema();
type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string | null, userId = oid().toString()): Ctx => ({ auth: role ? { role, userId } : null });
const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

describe("reviewerEffectiveness — observation:manage", () => {
  const Q = `query{ reviewerEffectiveness{ observers { observerId reviewsCompleted } } }`;
  beforeEach(() => mockObsFind.mockResolvedValue([]));

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

describe("rateObservationReview — observation:read", () => {
  const M = `mutation($id: String!){ rateObservationReview(observationId: $id, fairnessRating: 4){ fairnessRating } }`;

  test("the observed teacher (observation:read) can rate", async () => {
    const T = oid();
    const obsId = oid();
    mockObsFindById.mockResolvedValue({
      _id: obsId,
      teacherId: T,
      observerId: oid(),
      state: "REVIEWED",
      publishedAt: new Date("2026-06-15T00:00:00Z"),
      fairnessRating: null,
      usefulnessRating: null,
      fairnessRatedAt: null,
      save: jest.fn().mockResolvedValue(undefined),
    });
    const r = await graphql({ schema, source: M, contextValue: ctxOf("TEACHER", T.toString()), variableValues: { id: obsId.toString() } });
    expect(denied(r)).toBe(false);
    expect((r.data as { rateObservationReview: { fairnessRating: number } }).rateObservationReview.fairnessRating).toBe(4);
  });

  test("a GUARDIAN (no observation:read) is denied at the scope layer", async () => {
    const r = await graphql({ schema, source: M, contextValue: ctxOf("GUARDIAN"), variableValues: { id: oid().toString() } });
    expect(denied(r)).toBe(true);
  });
});
