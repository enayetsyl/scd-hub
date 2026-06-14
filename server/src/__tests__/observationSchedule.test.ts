/**
 * Classroom Observation CO-6 tests (prd-classroom-observation §CO-6, D-#85) — the
 * review SCHEDULER: a "due for review" SUGGESTION list (never an assignment) + the
 * admin-tunable cadence config. All reads are DERIVED; nothing is created/assigned.
 *
 * tierForTeacher (pure) — STRONG / DEVELOPING / NEEDS_SUPPORT from representative review
 *              sets (REF-11 domains-at-≥3 / a gate BREACH / Quran avg + compliance); a
 *              no-reviews teacher ⇒ null (handled, not a crash).
 * intervalForTier (pure) — base × tier multiplier, FLOORED by the frequency cap.
 * observationDueList — ranks by tier then overdue; a never-reviewed teacher with teaching
 *              slots is most-overdue; a teacher with NO teaching slot is excluded; config
 *              multipliers change the interval/overdue; the cap floors it; the list is
 *              READ-ONLY (no model.create / save / assign occurs).
 * config     — defaults apply when absent; an observation:manage set changes intervals;
 *              a non-manage caller can't set it (resolver-gated; the service validates).
 * RBAC       — executed against the built schema with each role's context: the due list +
 *              config are denied to a plain TEACHER + GUARDIAN, allowed to Principal/Office.
 *
 * DB-free (repo convention): the models + the emit/audit seams are mocked.
 */
import mongoose from "mongoose";
import { graphql } from "graphql";
import type { ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const mockObsFind = jest.fn();
const mockObsExists = jest.fn();
const mockObsCreate = jest.fn();
const mockObsSave = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: {
    find: (q: unknown) => ({ lean: () => mockObsFind(q) }),
    exists: (q: unknown) => mockObsExists(q),
    // present so a stray write would be caught by the read-only assertions
    create: (d: unknown) => mockObsCreate(d),
  },
}));

const mockSlotDistinct = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: {
    find: (q: unknown) => ({ distinct: (field: string) => mockSlotDistinct(q, field) }),
  },
}));

const mockConfigFindOne = jest.fn();
const mockConfigUpdateOne = jest.fn().mockResolvedValue({});
jest.mock("../modules/classroom-observation/models/ObservationScheduleConfig", () => ({
  ObservationScheduleConfig: {
    findOne: (q: unknown) => ({ lean: () => mockConfigFindOne(q) }),
    updateOne: (f: unknown, u: unknown, o: unknown) => mockConfigUpdateOne(f, u, o),
  },
}));

const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import {
  tierForTeacher,
  intervalForTier,
  observationDueList,
  getScheduleConfig,
  setScheduleConfig,
  DEFAULT_SCHEDULE_CONFIG,
  type ReviewSignal,
} from "../modules/classroom-observation/services/ObservationScheduleService";
import { ClassroomObservationError } from "../modules/classroom-observation/services/ClassroomObservationService";
import { builder } from "../schema";
import "../modules/classroom-observation/resolvers/observationSchedule";

beforeEach(() => {
  jest.clearAllMocks();
  mockConfigFindOne.mockResolvedValue(null); // default: no admin row → working defaults
});

// Signal builders ----------------------------------------------------------

const ref11 = (levels: number[], gateBreach = false): ReviewSignal => ({
  form: "REF11",
  domains: levels.map((level) => ({ level })),
  gates: [{ result: gateBreach ? "BREACH" : "PASS" }, { result: "PASS" }],
  quranRatings: [],
  quranCompliance: [],
});
const quran = (ratings: number[], compliance: boolean[]): ReviewSignal => ({
  form: "QURAN",
  domains: [],
  gates: [],
  quranRatings: ratings,
  quranCompliance: compliance,
});

// ===========================================================================
// tierForTeacher (pure)
// ===========================================================================

describe("tierForTeacher", () => {
  test("no reviews ⇒ null (never-reviewed handled, not a crash)", () => {
    expect(tierForTeacher([])).toBeNull();
  });

  test("REF-11 all domains at the working standard ⇒ STRONG", () => {
    expect(tierForTeacher([ref11([4, 4, 3, 4, 3]), ref11([4, 3, 4, 4, 4])])).toBe("STRONG");
  });

  test("REF-11 mixed at/below standard ⇒ DEVELOPING", () => {
    // 5 of 10 domain levels ≥ 3 → strength 0.5 → DEVELOPING (≥0.45, <0.75).
    expect(tierForTeacher([ref11([3, 3, 3, 2, 2]), ref11([3, 3, 2, 2, 1])])).toBe("DEVELOPING");
  });

  test("REF-11 mostly below the standard ⇒ NEEDS_SUPPORT", () => {
    expect(tierForTeacher([ref11([2, 1, 2, 1, 2])])).toBe("NEEDS_SUPPORT");
  });

  test("a recent gate BREACH pulls to NEEDS_SUPPORT regardless of high levels", () => {
    expect(tierForTeacher([ref11([4, 4, 4, 4, 4], true)])).toBe("NEEDS_SUPPORT");
  });

  test("Quran high avg + full compliance ⇒ STRONG", () => {
    expect(tierForTeacher([quran([5, 5, 4, 5], [true, true, true, true])])).toBe("STRONG");
  });

  test("Quran low avg + poor compliance ⇒ NEEDS_SUPPORT", () => {
    expect(tierForTeacher([quran([2, 1, 2], [false, false, true])])).toBe("NEEDS_SUPPORT");
  });
});

// ===========================================================================
// intervalForTier (pure)
// ===========================================================================

describe("intervalForTier", () => {
  const cfg = DEFAULT_SCHEDULE_CONFIG; // base 30, ×2 / ×1 / ×0.5, cap 14
  test("base × tier multiplier", () => {
    expect(intervalForTier("STRONG", cfg)).toBe(60); // 30 × 2
    expect(intervalForTier("DEVELOPING", cfg)).toBe(30); // 30 × 1
  });
  test("the frequency cap floors a short interval", () => {
    // 30 × 0.5 = 15 ≥ cap 14 → 15; but with a smaller base the cap wins.
    expect(intervalForTier("NEEDS_SUPPORT", cfg)).toBe(15);
    expect(intervalForTier("NEEDS_SUPPORT", { ...cfg, baseIntervalDays: 20 })).toBe(14); // 20×0.5=10 → cap 14
  });
  test("a null tier (never-reviewed) uses the needs-support multiplier (soonest)", () => {
    expect(intervalForTier(null, cfg)).toBe(15);
  });
});

// ===========================================================================
// observationDueList — ranks; excludes no-slot teachers; cap/config; read-only
// ===========================================================================

const T_STRONG = oid();
const T_DEV = oid();
const T_NEEDS = oid();
const T_NEVER = oid();
const T_NOSLOT = oid();

/** A stored released observation for `teacherId` (lean shape the service reads). */
const obs = (
  teacherId: mongoose.Types.ObjectId,
  reviewedAt: string,
  over: Record<string, unknown> = {},
) => ({
  _id: oid(),
  form: "REF11",
  teacherId,
  state: "REVIEWED",
  reviewedAt: new Date(reviewedAt),
  updatedAt: new Date(reviewedAt),
  createdAt: new Date(reviewedAt),
  domains: [
    { level: 3, note: "" },
    { level: 3, note: "" },
    { level: 3, note: "" },
    { level: 3, note: "" },
    { level: 3, note: "" },
  ],
  gates: [{ result: "PASS" }, { result: "PASS" }],
  ...over,
});

/** Wire RoutineSlot.distinct → the teaching-teacher set, ClassroomObservation.find →
 *  the released observations filtered by the teacherId.$in. */
const wire = (slotTeachers: mongoose.Types.ObjectId[], releasedDocs: Array<Record<string, unknown>>) => {
  mockSlotDistinct.mockResolvedValue(slotTeachers);
  mockObsFind.mockImplementation((q: Record<string, unknown>) => {
    const inIds = ((q.teacherId as { $in?: mongoose.Types.ObjectId[] })?.$in ?? []).map((x) => String(x));
    return releasedDocs.filter((d) => inIds.includes(String((d as { teacherId: unknown }).teacherId)));
  });
};

describe("observationDueList", () => {
  const NOW = new Date("2026-06-14T00:00:00Z");

  test("ranks by tier (Needs-support first) then overdue; excludes a no-slot teacher; never-reviewed is most-overdue", async () => {
    wire(
      [T_STRONG, T_DEV, T_NEEDS, T_NEVER], // T_NOSLOT NOT in the teaching set
      [
        // STRONG: all-≥3 domains, reviewed recently
        obs(T_STRONG, "2026-06-10", { domains: [4, 4, 4, 4, 4].map((level) => ({ level, note: "" })) }),
        // DEVELOPING: mixed
        obs(T_DEV, "2026-05-01", { domains: [3, 3, 3, 2, 2].map((level) => ({ level, note: "" })) }),
        // NEEDS_SUPPORT: a breach
        obs(T_NEEDS, "2026-05-20", { gates: [{ result: "BREACH" }, { result: "PASS" }] }),
      ],
    );

    const rows = await observationDueList(NOW);

    // T_NOSLOT is excluded entirely (no teaching session).
    expect(rows.map((r) => r.teacherId)).not.toContain(T_NOSLOT.toString());
    expect(rows).toHaveLength(4);

    // Needs-support tier sorts first; never-reviewed ranks with needs-support (null
    // tier) — between them overdueDays desc, so the never-reviewed (MAX) leads.
    expect(rows[0].teacherId).toBe(T_NEVER.toString());
    expect(rows[0].neverReviewed).toBe(true);
    expect(rows[0].tier).toBeNull();
    expect(rows[1].teacherId).toBe(T_NEEDS.toString());
    expect(rows[1].tier).toBe("NEEDS_SUPPORT");
    // STRONG sorts last (longest cadence, least urgent).
    expect(rows[rows.length - 1].teacherId).toBe(T_STRONG.toString());
    expect(rows[rows.length - 1].tier).toBe("STRONG");

    // No write/assign happened — suggestion only.
    expect(mockObsCreate).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("a never-reviewed teacher with teaching slots appears with a null dueDate + most-overdue", async () => {
    wire([T_NEVER], []);
    const rows = await observationDueList(NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].neverReviewed).toBe(true);
    expect(rows[0].dueDate).toBeNull();
    expect(rows[0].lastReviewedAt).toBeNull();
    expect(rows[0].overdue).toBe(true);
  });

  test("a teacher with NO teaching slot is excluded (empty teaching set ⇒ empty list)", async () => {
    wire([], [obs(T_NOSLOT, "2026-01-01")]);
    const rows = await observationDueList(NOW);
    expect(rows).toEqual([]);
  });

  test("config multipliers change the interval/overdue; the cap floors it", async () => {
    // A DEVELOPING teacher reviewed 40 days ago.
    const reviewed = obs(T_DEV, "2026-05-05", { domains: [3, 3, 3, 2, 2].map((level) => ({ level, note: "" })) });

    // Default base 30 × dev 1 = 30 → due 2026-06-04 → overdue ~10 days.
    wire([T_DEV], [reviewed]);
    const def = await observationDueList(NOW);
    expect(def[0].intervalDays).toBe(30);
    expect(def[0].overdueDays).toBe(10);

    // Admin row: base 60 → dev interval 60 → due 2026-07-04 → NOT overdue.
    mockConfigFindOne.mockResolvedValue({
      baseIntervalDays: 60,
      strongMultiplier: 2,
      developingMultiplier: 1,
      needsSupportMultiplier: 0.5,
      frequencyCapDays: 14,
    });
    wire([T_DEV], [reviewed]);
    const tuned = await observationDueList(NOW);
    expect(tuned[0].intervalDays).toBe(60);
    expect(tuned[0].overdue).toBe(false);

    // The frequency cap floors a tiny interval: base 10 × dev 1 = 10 → cap 20 wins.
    mockConfigFindOne.mockResolvedValue({
      baseIntervalDays: 10,
      strongMultiplier: 2,
      developingMultiplier: 1,
      needsSupportMultiplier: 0.5,
      frequencyCapDays: 20,
    });
    wire([T_DEV], [reviewed]);
    const capped = await observationDueList(NOW);
    expect(capped[0].intervalDays).toBe(20);
  });
});

// ===========================================================================
// config — defaults + the manage-gated set + validation
// ===========================================================================

describe("schedule config", () => {
  test("defaults apply when no admin row exists", async () => {
    mockConfigFindOne.mockResolvedValue(null);
    const cfg = await getScheduleConfig();
    expect(cfg.isDefault).toBe(true);
    expect(cfg.baseIntervalDays).toBe(DEFAULT_SCHEDULE_CONFIG.baseIntervalDays);
  });

  test("an admin set persists + audits + returns the new cadence", async () => {
    const actor = oid().toString();
    // After updateOne, getScheduleConfig re-reads the row.
    mockConfigFindOne.mockResolvedValueOnce({
      baseIntervalDays: 21,
      strongMultiplier: 3,
      developingMultiplier: 1,
      needsSupportMultiplier: 0.5,
      frequencyCapDays: 7,
    });
    const res = await setScheduleConfig(
      {
        baseIntervalDays: 21,
        strongMultiplier: 3,
        developingMultiplier: 1,
        needsSupportMultiplier: 0.5,
        frequencyCapDays: 7,
      },
      actor,
    );
    expect(mockConfigUpdateOne).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "OBSERVATION_SCHEDULE_CONFIG_SET", actorId: actor }),
    );
    expect(res.baseIntervalDays).toBe(21);
    expect(res.isDefault).toBe(false);
  });

  test("rejects a non-positive base interval / cap", async () => {
    await expect(
      setScheduleConfig({ ...DEFAULT_SCHEDULE_CONFIG, baseIntervalDays: 0 }, oid().toString()),
    ).rejects.toThrow(ClassroomObservationError);
    await expect(
      setScheduleConfig({ ...DEFAULT_SCHEDULE_CONFIG, frequencyCapDays: 0 }, oid().toString()),
    ).rejects.toThrow(ClassroomObservationError);
  });

  test("rejects out-of-order multipliers (Strong must be ≥ Developing ≥ Needs-support)", async () => {
    await expect(
      setScheduleConfig(
        { ...DEFAULT_SCHEDULE_CONFIG, strongMultiplier: 0.5, developingMultiplier: 1 },
        oid().toString(),
      ),
    ).rejects.toThrow(ClassroomObservationError);
  });
});

// ===========================================================================
// RBAC — executed against the built schema with each role's context
// ===========================================================================

builder.mutationField("_scheduleTestNoop", (t) => t.boolean({ resolve: () => true }));
const schema = builder.toSchema();

type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string | null, userId = oid().toString()): Ctx => ({
  auth: role ? { role, userId } : null,
});
const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

describe("observationDueList — observation:read + Principal/Office/observer restriction", () => {
  const Q = `query { observationDueList { teacherId tier overdueDays neverReviewed } }`;

  test("PRINCIPAL/OFFICE (observation:manage) read the list", async () => {
    for (const role of ["PRINCIPAL", "OFFICE"]) {
      wire([T_NEVER], []);
      const r = await graphql({ schema, source: Q, contextValue: ctxOf(role) });
      expect(denied(r)).toBe(false);
    }
  });

  test("an OBSERVER teacher (holds an observation as observer) reads the list", async () => {
    mockObsExists.mockResolvedValue({ _id: oid() }); // is an observer
    wire([T_NEVER], []);
    const r = await graphql({ schema, source: Q, contextValue: ctxOf("TEACHER") });
    expect(denied(r)).toBe(false);
  });

  test("a plain TEACHER (observation:read but NOT an observer) is denied", async () => {
    mockObsExists.mockResolvedValue(null); // not an observer
    const r = await graphql({ schema, source: Q, contextValue: ctxOf("TEACHER") });
    expect(denied(r)).toBe(true);
  });

  test("GUARDIAN (no observation:read) is denied at the scope layer", async () => {
    const r = await graphql({ schema, source: Q, contextValue: ctxOf("GUARDIAN") });
    expect(denied(r)).toBe(true);
  });

  test("unauthenticated is denied", async () => {
    const r = await graphql({ schema, source: Q, contextValue: ctxOf(null) });
    expect(denied(r)).toBe(true);
  });
});

describe("observationScheduleConfig + setObservationScheduleConfig — observation:manage only", () => {
  const QGET = `query { observationScheduleConfig { baseIntervalDays isDefault } }`;
  const MSET = `mutation { setObservationScheduleConfig(baseIntervalDays: 30, strongMultiplier: 2, developingMultiplier: 1, needsSupportMultiplier: 0.5, frequencyCapDays: 14){ baseIntervalDays } }`;

  test("PRINCIPAL/OFFICE read + set", async () => {
    for (const role of ["PRINCIPAL", "OFFICE"]) {
      mockConfigFindOne.mockResolvedValue(null);
      const rg = await graphql({ schema, source: QGET, contextValue: ctxOf(role) });
      expect(denied(rg)).toBe(false);
      mockConfigFindOne.mockResolvedValueOnce(null); // re-read after updateOne
      const rs = await graphql({ schema, source: MSET, contextValue: ctxOf(role) });
      expect(denied(rs)).toBe(false);
    }
  });

  test("a plain TEACHER is denied both", async () => {
    expect(denied(await graphql({ schema, source: QGET, contextValue: ctxOf("TEACHER") }))).toBe(true);
    expect(denied(await graphql({ schema, source: MSET, contextValue: ctxOf("TEACHER") }))).toBe(true);
  });

  test("GUARDIAN + unauthenticated are denied", async () => {
    expect(denied(await graphql({ schema, source: QGET, contextValue: ctxOf("GUARDIAN") }))).toBe(true);
    expect(denied(await graphql({ schema, source: MSET, contextValue: ctxOf(null) }))).toBe(true);
  });
});
