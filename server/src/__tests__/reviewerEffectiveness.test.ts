/**
 * Classroom Observation CO-7 tests (prd-classroom-observation §CO-7, D-#85 — the LAST CO
 * slice). The PRIVATE/developmental reviewer-effectiveness reads (all DERIVED) + the one
 * new write: the OBSERVED teacher's fairness rating.
 *
 * Pure helpers — domainAgreementWithinOne (|Δlevel| ≤ 1 agrees, ≥2 disagrees; mixed →
 *              correct ratio); focusDomainOf / impactDelta (re-review focus-domain movement).
 * rateObservationFairness (service) — observed teacher succeeds (1–5, stamped, audited);
 *              non-observed refused; out-of-range refused; pre-REVIEWED refused; INDEPENDENT
 *              of teacherResponse (rate-able with or without a response).
 * reviewerEffectiveness — calibration over a double-reviewed recording; timeliness mean +
 *              backlog; throughput within the period; developmental impact links a re-review's
 *              growthFocus-domain movement to the prior observer; fairness mean aggregates only
 *              rated reviews.
 * RBAC (schema-execution) — reviewerEffectiveness denied to a plain TEACHER + GUARDIAN +
 *              unauthenticated, allowed to Principal/Office; rateClassroomObservationFairness
 *              denied to a non-observed caller (the service gate surfaces as an error).
 *
 * DB-free (repo convention): the model + audit seams are mocked.
 */
import mongoose from "mongoose";
import { graphql } from "graphql";
import type { ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const mockFind = jest.fn();
const mockFindById = jest.fn();
const mockCreate = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: {
    find: (q: unknown) => ({ lean: () => mockFind(q) }),
    findById: (id: unknown) => mockFindById(id),
    create: (d: unknown) => mockCreate(d),
  },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// rateObservationFairness does NOT notify, but ClassroomObservationService imports the
// notification + User seams at module load — stub them so the import is DB-free.
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: () => ({ select: () => ({ lean: () => Promise.resolve([]) }) }) },
}));

// Import AFTER mocks
import {
  domainAgreementWithinOne,
  focusDomainOf,
  impactDelta,
  reviewerEffectiveness,
} from "../modules/classroom-observation/services/ReviewerEffectivenessService";
import {
  rateObservationFairness,
  ClassroomObservationError,
} from "../modules/classroom-observation/services/ClassroomObservationService";
import { builder } from "../schema";
import "../modules/classroom-observation/resolvers/classroomObservation";
import "../modules/classroom-observation/resolvers/reviewerEffectiveness";

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
});

// ===========================================================================
// domainAgreementWithinOne (pure) — REF-11 §1.2
// ===========================================================================

describe("domainAgreementWithinOne", () => {
  const d = (domain: string, level: number) => ({ domain, level });

  test("|Δlevel| ≤ 1 agrees, ≥ 2 disagrees", () => {
    // D1: |3-4|=1 agree; D2: |2-4|=2 disagree.
    const r = domainAgreementWithinOne([d("D1", 3), d("D2", 2)], [d("D1", 4), d("D2", 4)]);
    expect(r.total).toBe(2);
    expect(r.agreed).toBe(1);
    expect(r.ratio).toBe(0.5);
  });

  test("identical levels ⇒ full agreement", () => {
    const r = domainAgreementWithinOne([d("D1", 3), d("D2", 2)], [d("D1", 3), d("D2", 2)]);
    expect(r.ratio).toBe(1);
  });

  test("only domains scored by BOTH count; mixed → correct ratio", () => {
    // Shared D1 (agree) + D2 (disagree); D3 present in only one ⇒ ignored.
    const r = domainAgreementWithinOne([d("D1", 4), d("D2", 1), d("D3", 4)], [d("D1", 3), d("D2", 4)]);
    expect(r.total).toBe(2);
    expect(r.agreed).toBe(1);
    expect(r.ratio).toBe(0.5);
  });

  test("no shared domain ⇒ ratio null, count 0 (not a crash, not 0%)", () => {
    const r = domainAgreementWithinOne([d("D1", 3)], [d("D2", 3)]);
    expect(r.total).toBe(0);
    expect(r.ratio).toBeNull();
  });
});

// ===========================================================================
// focusDomainOf + impactDelta (pure)
// ===========================================================================

describe("focusDomainOf / impactDelta", () => {
  test("focusDomainOf finds a word-bounded domain code, else null", () => {
    expect(focusDomainOf("Strengthen questioning in D3 next term")).toBe("D3");
    expect(focusDomainOf("no code here")).toBeNull();
    expect(focusDomainOf(null)).toBeNull();
  });

  test("impactDelta: improved / same / declined on the focus domain", () => {
    const prior = [{ domain: "D3", level: 2 }];
    expect(impactDelta("focus D3", prior, [{ domain: "D3", level: 3 }])).toBe("improved");
    expect(impactDelta("focus D3", prior, [{ domain: "D3", level: 2 }])).toBe("same");
    expect(impactDelta("focus D3", prior, [{ domain: "D3", level: 1 }])).toBe("declined");
  });

  test("impactDelta: unknown when no focus domain or the domain is missing in a review", () => {
    expect(impactDelta("no code", [{ domain: "D3", level: 2 }], [{ domain: "D3", level: 3 }])).toBe("unknown");
    expect(impactDelta("focus D3", [{ domain: "D1", level: 2 }], [{ domain: "D3", level: 3 }])).toBe("unknown");
  });
});

// ===========================================================================
// rateObservationFairness (service) — observed-teacher-only write gate
// ===========================================================================

const TEACHER = oid();
const OBSERVER = oid();

/** A mongoose-doc-like observation (has .save) for the findById mutate path. */
const makeObs = (over: Record<string, unknown> = {}) => {
  const doc: Record<string, unknown> = {
    _id: oid(),
    form: "REF11",
    subject: "MATH",
    teacherId: TEACHER,
    observerId: OBSERVER,
    classDate: "2026-06-14",
    state: "REVIEWED",
    createdBy: oid(),
    domains: [],
    gates: [],
    fairness: null,
    teacherResponse: null,
    createdAt: new Date("2026-06-14T00:00:00Z"),
    updatedAt: new Date("2026-06-14T00:00:00Z"),
    ...over,
  };
  doc.save = jest.fn().mockResolvedValue(doc);
  return doc;
};

describe("rateObservationFairness", () => {
  test("the observed teacher rates 1–5 → stamped + audited (state unchanged)", async () => {
    const doc = makeObs();
    mockFindById.mockResolvedValue(doc);
    const res = await rateObservationFairness({
      observationId: (doc._id as mongoose.Types.ObjectId).toString(),
      actorId: TEACHER.toString(),
      rating: 4,
      comment: "  fair and useful  ",
    });
    expect(res.fairness?.rating).toBe(4);
    expect(res.fairness?.comment).toBe("fair and useful"); // trimmed
    expect(res.fairness?.ratedAt).toBeTruthy();
    expect(res.state).toBe("REVIEWED"); // independent of the response loop — not changed
    expect((doc as { save: jest.Mock }).save).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "OBSERVATION_FAIRNESS_RATED",
        actorId: TEACHER.toString(),
        meta: expect.objectContaining({ rating: 4 }),
      }),
    );
  });

  test("a non-observed caller is refused (Bangla)", async () => {
    mockFindById.mockResolvedValue(makeObs());
    await expect(
      rateObservationFairness({ observationId: oid().toString(), actorId: OBSERVER.toString(), rating: 4 }),
    ).rejects.toThrow(ClassroomObservationError);
  });

  test("an out-of-range rating is refused", async () => {
    mockFindById.mockResolvedValue(makeObs());
    await expect(
      rateObservationFairness({ observationId: oid().toString(), actorId: TEACHER.toString(), rating: 6 }),
    ).rejects.toThrow(ClassroomObservationError);
    mockFindById.mockResolvedValue(makeObs());
    await expect(
      rateObservationFairness({ observationId: oid().toString(), actorId: TEACHER.toString(), rating: 0 }),
    ).rejects.toThrow(ClassroomObservationError);
  });

  test("a pre-REVIEWED (ASSIGNED) observation is refused", async () => {
    mockFindById.mockResolvedValue(makeObs({ state: "ASSIGNED" }));
    await expect(
      rateObservationFairness({ observationId: oid().toString(), actorId: TEACHER.toString(), rating: 4 }),
    ).rejects.toThrow(ClassroomObservationError);
  });

  test("fairness is INDEPENDENT of teacherResponse — rate-able with or without a response", async () => {
    // No response yet (REVIEWED) → allowed.
    mockFindById.mockResolvedValue(makeObs({ teacherResponse: null, state: "REVIEWED" }));
    await expect(
      rateObservationFairness({ observationId: oid().toString(), actorId: TEACHER.toString(), rating: 5 }),
    ).resolves.toBeTruthy();
    // Already responded (TEACHER_RESPONDED) → still allowed.
    mockFindById.mockResolvedValue(makeObs({ teacherResponse: "seen", state: "TEACHER_RESPONDED" }));
    await expect(
      rateObservationFairness({ observationId: oid().toString(), actorId: TEACHER.toString(), rating: 2 }),
    ).resolves.toBeTruthy();
  });
});

// ===========================================================================
// reviewerEffectiveness — the five DERIVED aggregates
// ===========================================================================

const REC = oid(); // a shared recording (double-reviewed)

/** A lean released observation by this observer. */
const released = (over: Record<string, unknown> = {}) => ({
  _id: oid(),
  form: "REF11",
  observerId: OBSERVER,
  teacherId: TEACHER,
  state: "REVIEWED",
  recordingId: null,
  assignedAt: new Date("2026-06-01T00:00:00Z"),
  reviewedAt: new Date("2026-06-03T00:00:00Z"),
  domains: [],
  gates: [],
  fairness: null,
  prevObservationId: null,
  growthFocus: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-03T00:00:00Z"),
  ...over,
});

/** Wire ClassroomObservation.find to answer each of the service's queries by shape. */
const wire = (opts: {
  mine: Array<Record<string, unknown>>;
  peers?: Array<Record<string, unknown>>;
  reReviews?: Array<Record<string, unknown>>;
}) => {
  mockFind.mockImplementation((q: Record<string, unknown>) => {
    // 1) this observer's own observations: { observerId }
    if (q.observerId && !q.recordingId && !q.prevObservationId && !("$ne" in (q.observerId as object))) {
      return Promise.resolve(opts.mine);
    }
    // 2) calibration peers: { recordingId: {$in}, observerId: {$ne}, state: {$in} }
    if (q.recordingId && q.observerId && (q.observerId as { $ne?: unknown }).$ne) {
      return Promise.resolve(opts.peers ?? []);
    }
    // 3) re-reviews: { prevObservationId: {$in}, state: {$in} }
    if (q.prevObservationId) {
      return Promise.resolve(opts.reReviews ?? []);
    }
    return Promise.resolve([]);
  });
};

const NOW = new Date("2026-06-14T00:00:00Z");

describe("reviewerEffectiveness", () => {
  test("calibration over a double-reviewed recording (within-one-level agreement)", async () => {
    const mine = [
      released({
        recordingId: REC,
        domains: [
          { domain: "D1", level: 3, note: "" },
          { domain: "D2", level: 2, note: "" },
        ],
      }),
    ];
    const peers = [
      // Another observer's released review of the SAME recording: D1 agree (|3-4|=1), D2 disagree (|2-4|=2).
      {
        _id: oid(),
        observerId: oid(),
        recordingId: REC,
        state: "REVIEWED",
        domains: [
          { domain: "D1", level: 4, note: "" },
          { domain: "D2", level: 4, note: "" },
        ],
      },
    ];
    wire({ mine, peers });
    const eff = await reviewerEffectiveness(OBSERVER.toString(), NOW);
    expect(eff.calibration.doubleReviewedRecordings).toBe(1);
    expect(eff.calibration.comparedDomainScores).toBe(2);
    expect(eff.calibration.agreedWithinOne).toBe(1);
    expect(eff.calibration.agreementRatio).toBe(0.5);
  });

  test("timeliness mean + backlog (oldest age)", async () => {
    const mine = [
      // reviewed: assigned 2026-06-01 → reviewed 2026-06-03 ⇒ 2 days.
      released({ assignedAt: new Date("2026-06-01T00:00:00Z"), reviewedAt: new Date("2026-06-03T00:00:00Z") }),
      // reviewed: 4 days.
      released({ assignedAt: new Date("2026-06-01T00:00:00Z"), reviewedAt: new Date("2026-06-05T00:00:00Z") }),
      // backlog: ASSIGNED 2026-06-04, not reviewed → age vs NOW(06-14) = 10 days.
      released({ state: "ASSIGNED", assignedAt: new Date("2026-06-04T00:00:00Z"), reviewedAt: null }),
    ];
    wire({ mine });
    const eff = await reviewerEffectiveness(OBSERVER.toString(), NOW);
    expect(eff.timeliness.reviewedCount).toBe(2);
    expect(eff.timeliness.meanDaysToReview).toBe(3); // (2 + 4) / 2
    expect(eff.timeliness.medianDaysToReview).toBe(3);
    expect(eff.timeliness.backlogCount).toBe(1);
    expect(eff.timeliness.oldestBacklogDays).toBe(10);
  });

  test("throughput counts reviews within the 30 / 90-day window", async () => {
    const mine = [
      released({ reviewedAt: new Date("2026-06-10T00:00:00Z") }), // 4 days ago → in 30 + 90
      released({ reviewedAt: new Date("2026-04-20T00:00:00Z") }), // ~55 days ago → in 90 only
      released({ reviewedAt: new Date("2026-01-01T00:00:00Z") }), // ~164 days ago → in neither
    ];
    wire({ mine });
    const eff = await reviewerEffectiveness(OBSERVER.toString(), NOW);
    expect(eff.throughput.reviewedLast30Days).toBe(1);
    expect(eff.throughput.reviewedLast90Days).toBe(2);
  });

  test("developmental impact links a re-review's focus-domain movement to the prior observer", async () => {
    const prior = released({
      growthFocus: "Improve questioning — focus D2 next time",
      domains: [{ domain: "D2", level: 2, note: "" }],
      state: "SUPERSEDED",
    });
    const mine = [prior];
    const reReviews = [
      // A NEWER observation (different observer) pointing back at MY prior review; D2 2→3 ⇒ improved.
      {
        _id: oid(),
        observerId: oid(),
        prevObservationId: prior._id as mongoose.Types.ObjectId,
        state: "REVIEWED",
        domains: [{ domain: "D2", level: 3, note: "" }],
      },
    ];
    wire({ mine, reReviews });
    const eff = await reviewerEffectiveness(OBSERVER.toString(), NOW);
    expect(eff.developmentalImpact.attributablePairs).toBe(1);
    expect(eff.developmentalImpact.improved).toBe(1);
    expect(eff.developmentalImpact.same).toBe(0);
    expect(eff.developmentalImpact.declined).toBe(0);
  });

  test("fairness mean aggregates ONLY rated reviews", async () => {
    const mine = [
      released({ fairness: { rating: 4, comment: null, ratedAt: new Date() } }),
      released({ fairness: { rating: 2, comment: null, ratedAt: new Date() } }),
      released({ fairness: null }), // unrated → excluded
    ];
    wire({ mine });
    const eff = await reviewerEffectiveness(OBSERVER.toString(), NOW);
    expect(eff.fairness.ratedCount).toBe(2);
    expect(eff.fairness.meanRating).toBe(3); // (4 + 2) / 2
  });
});

// ===========================================================================
// RBAC — executed against the built schema with each role's context
// ===========================================================================

builder.mutationField("_reviewerEffTestNoop", (t) => t.boolean({ resolve: () => true }));
const schema = builder.toSchema();

type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string | null, userId = oid().toString()): Ctx => ({
  auth: role ? { role, userId } : null,
});
const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

describe("reviewerEffectiveness query — observation:manage ONLY", () => {
  const Q = `query($o: String!){ reviewerEffectiveness(observerId: $o){ observerId fairness { ratedCount } } }`;

  test("PRINCIPAL/OFFICE (observation:manage) read it", async () => {
    for (const role of ["PRINCIPAL", "OFFICE"]) {
      wire({ mine: [] });
      const r = await graphql({
        schema,
        source: Q,
        variableValues: { o: OBSERVER.toString() },
        contextValue: ctxOf(role),
      });
      expect(denied(r)).toBe(false);
    }
  });

  test("a plain TEACHER (no observation:manage) is denied — no self-serve leaderboard", async () => {
    const r = await graphql({
      schema,
      source: Q,
      variableValues: { o: OBSERVER.toString() },
      contextValue: ctxOf("TEACHER", OBSERVER.toString()),
    });
    expect(denied(r)).toBe(true);
  });

  test("GUARDIAN + unauthenticated are denied", async () => {
    const rg = await graphql({ schema, source: Q, variableValues: { o: OBSERVER.toString() }, contextValue: ctxOf("GUARDIAN") });
    const ru = await graphql({ schema, source: Q, variableValues: { o: OBSERVER.toString() }, contextValue: ctxOf(null) });
    expect(denied(rg)).toBe(true);
    expect(denied(ru)).toBe(true);
  });
});

describe("rateClassroomObservationFairness mutation — observed-teacher gate", () => {
  const M = `mutation($id: String!, $r: Int!){ rateClassroomObservationFairness(observationId: $id, rating: $r){ id fairness { rating } } }`;

  test("a non-observed caller is refused (the in-service gate surfaces as an error)", async () => {
    mockFindById.mockResolvedValue(makeObs()); // teacherId = TEACHER
    const r = await graphql({
      schema,
      source: M,
      variableValues: { id: oid().toString(), r: 4 },
      contextValue: ctxOf("TEACHER", OBSERVER.toString()), // caller is the OBSERVER, not the observed teacher
    });
    expect(denied(r)).toBe(true);
  });

  test("GUARDIAN is denied at the scope layer", async () => {
    const r = await graphql({
      schema,
      source: M,
      variableValues: { id: oid().toString(), r: 4 },
      contextValue: ctxOf("GUARDIAN"),
    });
    expect(denied(r)).toBe(true);
  });
});
