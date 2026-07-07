/**
 * Classroom Observation CO-3 tests — release notify + teacher response + the
 * escalation ladder + the admin-tunable cadence config.
 *
 * release    — reviewObservation emits OBSERVATION_RELEASED to the observed teacher.
 * respond    — respondToObservation: the observed teacher succeeds (→ TEACHER_RESPONDED,
 *              teacherResponse set, OBSERVATION_RESPONDED emitted to observer+Principal);
 *              a NON-observed caller refused; a non-REVIEWED row refused; scores untouched.
 * escalation — runObservationEscalation (now injected): 1st reminder ≥2d, 2nd ≥4d,
 *              Principal flag ≥7d, EACH ONCE (a 2nd run with the same now emits nothing
 *              new), and NOTHING once TEACHER_RESPONDED.
 * config     — defaults apply when absent; an observation:manage set changes thresholds;
 *              a non-manage caller can't set it (resolver-gated — exercised via the service
 *              guard + the strictly-increasing validation).
 *
 * DB-free (repo convention): the models + emit seam + audit are mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const mockFindById = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: {
    findById: (id: unknown) => mockFindById(id),
    find: (q: unknown) => ({ lean: () => mockObsFind(q) }),
    create: (d: unknown) => mockObsCreate(d),
  },
}));
const mockObsFind = jest.fn();
const mockObsCreate = jest.fn();

const mockConfigFindOne = jest.fn();
const mockConfigUpdateOne = jest.fn().mockResolvedValue({});
jest.mock("../modules/classroom-observation/models/ObservationEscalationConfig", () => ({
  ObservationEscalationConfig: {
    findOne: (q: unknown) => ({ lean: () => mockConfigFindOne(q) }),
    updateOne: (f: unknown, u: unknown, o: unknown) => mockConfigUpdateOne(f, u, o),
  },
}));

const mockDispatchFind = jest.fn();
const mockDispatchCreate = jest.fn().mockResolvedValue({});
jest.mock("../modules/classroom-observation/models/ObservationEscalationDispatch", () => {
  const actual = jest.requireActual("../modules/classroom-observation/models/ObservationEscalationDispatch");
  return {
    OBSERVATION_ESCALATION_STAGES: actual.OBSERVATION_ESCALATION_STAGES,
    ObservationEscalationDispatch: {
      find: (f: unknown) => ({ select: () => ({ lean: () => mockDispatchFind(f) }) }),
      create: (d: unknown) => mockDispatchCreate(d),
    },
  };
});

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => ({ select: () => ({ lean: () => mockUserFind(f) }) }) },
}));

const mockEmit = jest.fn();
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (input: unknown) => mockEmit(input),
}));

const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import {
  reviewObservation,
  respondToObservation,
  ClassroomObservationError,
} from "../modules/classroom-observation/services/ClassroomObservationService";
import {
  runObservationEscalation,
  getEscalationConfig,
  setEscalationConfig,
  calendarDaysBetween,
  stageForDays,
  DEFAULT_ESCALATION_CONFIG,
} from "../modules/classroom-observation/services/ObservationEscalationService";
import { OBSERVATION_DOMAINS, OBSERVATION_GATES } from "@scd/shared";

const TEACHER = oid();
const OBSERVER = oid();
const PRINCIPAL = oid();

const validPayload = () => ({
  domains: OBSERVATION_DOMAINS.map((d, i) => ({ domain: d, level: (i % 4) + 1, note: `note ${d}` })),
  gates: OBSERVATION_GATES.map((g) => ({ gate: g, result: "PASS" })),
  oneStrength: "Clear modelling.",
  growthFocus: "More wait-time.",
});

/** A mongoose-doc-like object with .save for the mutate paths. */
const makeDoc = (over: Record<string, unknown> = {}) => {
  const doc: Record<string, unknown> = {
    _id: oid(),
    form: "REF11",
    subject: "MATH",
    teacherId: TEACHER,
    classDate: "2026-06-14",
    sectionId: oid(),
    subjectGroupId: null,
    routineSlotId: null,
    periodNumber: 3,
    observerId: OBSERVER,
    state: "ASSIGNED",
    createdBy: oid(),
    assignedAt: new Date("2026-06-14T00:00:00Z"),
    reviewedAt: null,
    domains: [],
    gates: [],
    oneStrength: null,
    growthFocus: null,
    prevObservationId: null,
    priorFocusProgress: null,
    recordingId: null,
    teacherResponse: null,
    supersededById: null,
    createdAt: new Date("2026-06-14T00:00:00Z"),
    updatedAt: new Date("2026-06-14T00:00:00Z"),
    ...over,
  };
  doc.save = jest.fn(async () => doc);
  return doc;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockEmit.mockResolvedValue({ created: true, dedupeKey: "x" });
  mockConfigFindOne.mockResolvedValue(null); // no admin row → defaults
  mockConfigUpdateOne.mockResolvedValue({});
  mockDispatchFind.mockResolvedValue([]);
  mockDispatchCreate.mockResolvedValue({});
  mockUserFind.mockResolvedValue([{ _id: PRINCIPAL }]);
  mockObsFind.mockResolvedValue([]);
});

// ===========================================================================
// Pure helpers
// ===========================================================================

describe("calendarDaysBetween / stageForDays", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 5, 1) + n * 86400000);

  it("counts whole calendar days (floor)", () => {
    expect(calendarDaysBetween(day(0), day(2))).toBe(2);
    expect(calendarDaysBetween(new Date("2026-06-01T08:00:00Z"), new Date("2026-06-03T07:00:00Z"))).toBe(1);
  });

  it("maps days-since to the highest crossed rung (2/4/7 defaults)", () => {
    const cfg = DEFAULT_ESCALATION_CONFIG;
    expect(stageForDays(1, cfg)).toBeNull();
    expect(stageForDays(2, cfg)).toBe("REMINDER_1");
    expect(stageForDays(3, cfg)).toBe("REMINDER_1");
    expect(stageForDays(4, cfg)).toBe("REMINDER_2");
    expect(stageForDays(6, cfg)).toBe("REMINDER_2");
    expect(stageForDays(7, cfg)).toBe("PRINCIPAL_FLAG");
    expect(stageForDays(30, cfg)).toBe("PRINCIPAL_FLAG");
  });
});

// ===========================================================================
// Release notify
// ===========================================================================

describe("reviewObservation notify (CO-8, D-#271 — review no longer releases)", () => {
  it("nudges Principal/Office (OBSERVATION_READY_TO_PUBLISH) on REVIEWED, does NOT release to the teacher", async () => {
    const doc = makeDoc({ state: "ASSIGNED", observerId: OBSERVER });
    mockFindById.mockResolvedValue(doc);
    const res = await reviewObservation({
      observationId: String(doc._id),
      ...validPayload(),
      actorId: OBSERVER.toString(),
    });
    expect(res.state).toBe("REVIEWED");
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "OBSERVATION_READY_TO_PUBLISH" }),
    );
    // the teacher release moved to publishObservation — NOT emitted at review
    expect(mockEmit).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "OBSERVATION_RELEASED" }),
    );
  });
});

// ===========================================================================
// Teacher response
// ===========================================================================

describe("respondToObservation (CO-3)", () => {
  it("the observed teacher responds → TEACHER_RESPONDED, teacherResponse set, OBSERVATION_RESPONDED emitted", async () => {
    const doc = makeDoc({ state: "REVIEWED", observerId: OBSERVER, reviewedAt: new Date(), publishedAt: new Date() });
    mockFindById.mockResolvedValue(doc);
    const res = await respondToObservation({
      observationId: String(doc._id),
      actorId: TEACHER.toString(),
      responseText: "Seen and discussed with my mentor.",
    });
    expect(res.state).toBe("TEACHER_RESPONDED");
    expect(res.teacherResponse).toBe("Seen and discussed with my mentor.");
    // scores untouched (no domains/gates written by this path)
    expect(res.domains).toEqual([]);
    expect(res.gates).toEqual([]);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASSROOM_OBSERVATION_RESPONDED" }),
    );
    // observer + Principal notified
    const recips = mockEmit.mock.calls.map((c) => (c[0] as { recipientUserId: string }).recipientUserId);
    expect(recips).toContain(OBSERVER.toString());
    expect(recips).toContain(PRINCIPAL.toString());
    expect(mockEmit.mock.calls.every((c) => (c[0] as { kind: string }).kind === "OBSERVATION_RESPONDED")).toBe(true);
  });

  it("a NON-observed caller is refused (Bangla)", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "REVIEWED", reviewedAt: new Date() }));
    await expect(
      respondToObservation({ observationId: oid().toString(), actorId: oid().toString(), responseText: "x" }),
    ).rejects.toThrow(/সংশ্লিষ্ট শিক্ষক/);
  });

  it("responding to a non-REVIEWED observation is refused", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "ASSIGNED" }));
    await expect(
      respondToObservation({ observationId: oid().toString(), actorId: TEACHER.toString(), responseText: "x" }),
    ).rejects.toThrow(/প্রকাশিত/);
  });

  it("requires response text", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "REVIEWED", reviewedAt: new Date(), publishedAt: new Date() }));
    await expect(
      respondToObservation({ observationId: oid().toString(), actorId: TEACHER.toString(), responseText: "   " }),
    ).rejects.toThrow(/সাড়ার বিবরণ/);
  });
});

// ===========================================================================
// Escalation ladder (now injected, idempotent)
// ===========================================================================

describe("runObservationEscalation (CO-3)", () => {
  const released = new Date("2026-06-01T00:00:00Z");
  const at = (days: number) => new Date(released.getTime() + days * 86400000);
  const reviewedDoc = (over: Record<string, unknown> = {}) => ({
    _id: oid(),
    teacherId: TEACHER,
    observerId: OBSERVER,
    state: "REVIEWED",
    teacherResponse: null,
    reviewedAt: released,
    publishedAt: released, // CO-8 (D-#271): the escalation clock keys off publish
    ...over,
  });

  it("1st reminder fires at ≥2 days, to the observed teacher", async () => {
    const doc = reviewedDoc();
    mockObsFind.mockResolvedValue([doc]);
    const r = await runObservationEscalation(at(2));
    expect(r.reminder1).toBe(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: TEACHER.toString(),
        kind: "OBSERVATION_RESPONSE_REMINDER",
        dedupeKey: `OBSESC:${String(doc._id)}:REMINDER_1:${TEACHER.toString()}`,
      }),
    );
    expect(mockDispatchCreate).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "REMINDER_1" }),
    );
  });

  it("2nd reminder fires at ≥4 days", async () => {
    mockObsFind.mockResolvedValue([reviewedDoc()]);
    const r = await runObservationEscalation(at(4));
    expect(r.reminder2).toBe(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "OBSERVATION_RESPONSE_REMINDER", recipientUserId: TEACHER.toString() }),
    );
  });

  it("Principal flag fires at ≥7 days, to the Principal, audited", async () => {
    mockObsFind.mockResolvedValue([reviewedDoc()]);
    const r = await runObservationEscalation(at(7));
    expect(r.principalFlag).toBe(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: PRINCIPAL.toString(), kind: "OBSERVATION_ESCALATED" }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASSROOM_OBSERVATION_ESCALATED" }),
    );
  });

  it("nothing fires before the first threshold (<2 days)", async () => {
    mockObsFind.mockResolvedValue([reviewedDoc()]);
    const r = await runObservationEscalation(at(1));
    expect(r.reminder1 + r.reminder2 + r.principalFlag).toBe(0);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("idempotent: a rung already in the dispatch ledger is skipped (nothing new)", async () => {
    const doc = reviewedDoc();
    mockObsFind.mockResolvedValue([doc]);
    mockDispatchFind.mockResolvedValue([{ observationId: doc._id, stage: "REMINDER_1" }]);
    const r = await runObservationEscalation(at(2));
    expect(r.reminder1).toBe(0);
    expect(r.alreadyDispatched).toBe(1);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockDispatchCreate).not.toHaveBeenCalled();
  });

  it("a racing ledger insert (E11000) counts as already dispatched, no audit", async () => {
    mockObsFind.mockResolvedValue([reviewedDoc()]);
    mockDispatchCreate.mockRejectedValueOnce({ code: 11000 });
    const r = await runObservationEscalation(at(7));
    expect(r.principalFlag).toBe(0);
    expect(r.alreadyDispatched).toBe(1);
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("nothing is scanned/sent once TEACHER_RESPONDED (excluded by the state filter)", async () => {
    // The service filters {state: REVIEWED, teacherResponse: null}; a responded row
    // never returns from find — model the query contract.
    mockObsFind.mockResolvedValue([]);
    const r = await runObservationEscalation(at(30));
    expect(r.scanned).toBe(0);
    expect(mockEmit).not.toHaveBeenCalled();
    // the query asked for REVIEWED + unanswered only
    expect(mockObsFind).toHaveBeenCalledWith(
      expect.objectContaining({ state: "REVIEWED", teacherResponse: null }),
    );
  });
});

// ===========================================================================
// Escalation config (admin-tunable, read-time defaults)
// ===========================================================================

describe("escalation config (CO-3)", () => {
  it("defaults (2/4/7) apply when no admin row exists", async () => {
    mockConfigFindOne.mockResolvedValue(null);
    const cfg = await getEscalationConfig();
    expect(cfg).toMatchObject({ reminderDays1: 2, reminderDays2: 4, principalFlagDays: 7, isDefault: true });
  });

  it("an admin row overrides the defaults", async () => {
    mockConfigFindOne.mockResolvedValue({ reminderDays1: 3, reminderDays2: 6, principalFlagDays: 10 });
    const cfg = await getEscalationConfig();
    expect(cfg).toMatchObject({ reminderDays1: 3, reminderDays2: 6, principalFlagDays: 10, isDefault: false });
  });

  it("setEscalationConfig upserts the singleton + audits", async () => {
    // first call (inside set) reads null, then getEscalationConfig re-reads the new row
    mockConfigFindOne.mockResolvedValueOnce({ reminderDays1: 1, reminderDays2: 3, principalFlagDays: 5 });
    const cfg = await setEscalationConfig(
      { reminderDays1: 1, reminderDays2: 3, principalFlagDays: 5 },
      PRINCIPAL.toString(),
    );
    expect(mockConfigUpdateOne).toHaveBeenCalledWith(
      { key: "SINGLETON" },
      { $set: { reminderDays1: 1, reminderDays2: 3, principalFlagDays: 5 } },
      { upsert: true },
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "OBSERVATION_ESCALATION_CONFIG_SET" }),
    );
    expect(cfg.reminderDays1).toBe(1);
  });

  it("rejects non-increasing or sub-1 thresholds", async () => {
    await expect(
      setEscalationConfig({ reminderDays1: 4, reminderDays2: 2, principalFlagDays: 7 }, PRINCIPAL.toString()),
    ).rejects.toBeInstanceOf(ClassroomObservationError);
    await expect(
      setEscalationConfig({ reminderDays1: 0, reminderDays2: 2, principalFlagDays: 7 }, PRINCIPAL.toString()),
    ).rejects.toThrow(/≥ 1/);
    expect(mockConfigUpdateOne).not.toHaveBeenCalled();
  });
});
