/**
 * Classroom Observation CO-1 tests (prd-classroom-observation §4/§5/§6, D-#146/#147/
 * #190/#191).
 *
 * Vocab     — OBSERVATION_FORMS/DOMAINS/LEVELS/GATES/GATE_RESULTS/STATES/GROWTH_PROGRESS
 *             label totality (BN + EN).
 * ref11     — the PURE validator: exactly 5 domains (1–4 + note), 2 gates, 1 strength,
 *             1 growth focus; a gate BREACH stands on its own; NO total/average.
 * Service   — uploadObservation (upload+assign → ASSIGNED; the observer ≠ observed-teacher
 *             conflict guard; anchor = exactly one of section/group; REF11 subject ∈
 *             HW_SUBJECTS); assignObserver state gate; reviewObservation (ASSIGNED-only,
 *             gated to the assigned observerId → REVIEWED releases); requestReReview
 *             (prior REVIEWED → new ASSIGNED + prior SUPERSEDED). All audited.
 * Row-scope — the pure canReadObservation predicate: observer own; observed teacher own
 *             ONLY at/after REVIEWED (blocked pre-REVIEWED, never sees other observers'
 *             inputs); Principal/Office (manage) all (§5, D-#28).
 *
 * DB-free (repo convention): the model + audit are mocked.
 */
import mongoose from "mongoose";
import {
  OBSERVATION_FORMS,
  OBSERVATION_FORM_LABELS_BN,
  OBSERVATION_FORM_LABELS_EN,
  OBSERVATION_DOMAINS,
  OBSERVATION_DOMAIN_LABELS_BN,
  OBSERVATION_DOMAIN_LABELS_EN,
  OBSERVATION_LEVELS,
  OBSERVATION_LEVEL_LABELS_BN,
  OBSERVATION_LEVEL_LABELS_EN,
  OBSERVATION_GATES,
  OBSERVATION_GATE_LABELS_BN,
  OBSERVATION_GATE_LABELS_EN,
  GATE_RESULTS,
  GATE_RESULT_LABELS_BN,
  GATE_RESULT_LABELS_EN,
  OBSERVATION_STATES,
  OBSERVATION_STATE_LABELS_BN,
  OBSERVATION_STATE_LABELS_EN,
  GROWTH_PROGRESS,
  GROWTH_PROGRESS_LABELS_BN,
  GROWTH_PROGRESS_LABELS_EN,
} from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

const mockCreate = jest.fn();
const mockFindById = jest.fn();
const mockFind = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: {
    create: (doc: unknown) => mockCreate(doc),
    findById: (id: unknown) => mockFindById(id),
    find: (q: unknown) => mockFind(q),
  },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Notifications + User are mocked so the best-effort emits (release / ready-to-publish)
// don't buffer against an absent DB (keeps these DB-free tests fast + deterministic).
const mockEmit = jest.fn();
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (e: unknown) => mockEmit(e),
}));
const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => mockUserFind(q) },
}));

// Import AFTER mocks
import { validateRef11Payload, Ref11ValidationError, type Ref11PayloadInput } from "../modules/classroom-observation/ref11";
import {
  uploadObservation,
  assignObserver,
  reviewObservation,
  publishObservation,
  respondToObservation,
  requestReReview,
  canReadObservation,
  ClassroomObservationError,
} from "../modules/classroom-observation/services/ClassroomObservationService";

const TEACHER = oid();      // the observed teacher
const OBSERVER = oid();     // the assigned senior teacher
const OFFICE = oid();       // the uploader (Principal/Office)
const SECTION = oid();

// A valid REF-11 review payload (5 domains 1–4 + note, 2 gates, 1 strength, 1 growth).
const validPayload = (): Ref11PayloadInput => ({
  domains: OBSERVATION_DOMAINS.map((d, i) => ({ domain: d, level: (i % 4) + 1, note: `note ${d}` })),
  gates: OBSERVATION_GATES.map((g) => ({ gate: g, result: "PASS" })),
  oneStrength: "Clear modelling of the worked example.",
  growthFocus: "Increase wait-time after higher-order questions.",
});

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockEmit.mockResolvedValue(undefined);
  // find().select().lean() → one manager/principal recipient by default.
  mockUserFind.mockReturnValue({ select: () => ({ lean: async () => [{ _id: oid() }] }) });
  mockCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
    _id: oid(),
    ...doc,
    domains: doc.domains ?? [],
    gates: doc.gates ?? [],
    createdAt: new Date("2026-06-14T00:00:00Z"),
    updatedAt: new Date("2026-06-14T00:00:00Z"),
  }));
});

/** A mongoose-doc-like object (has .save) for the findById mutate paths. */
const makeDoc = (over: Record<string, unknown> = {}) => {
  const doc: Record<string, unknown> = {
    _id: oid(),
    form: "REF11",
    subject: "MATH",
    teacherId: TEACHER,
    classDate: "2026-06-14",
    sectionId: SECTION,
    subjectGroupId: null,
    routineSlotId: null,
    periodNumber: 3,
    observerId: OBSERVER,
    state: "ASSIGNED",
    createdBy: OFFICE,
    assignedAt: new Date("2026-06-14T00:00:00Z"),
    reviewedAt: null,
    publishedAt: null,
    publishedBy: null,
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

// ===========================================================================
// Vocab label totality (§4)
// ===========================================================================

describe("classroom-observation vocab label totality", () => {
  const totals: [string, readonly (string | number)[], Record<string | number, string>, Record<string | number, string>][] = [
    ["OBSERVATION_FORMS", OBSERVATION_FORMS, OBSERVATION_FORM_LABELS_BN, OBSERVATION_FORM_LABELS_EN],
    ["OBSERVATION_DOMAINS", OBSERVATION_DOMAINS, OBSERVATION_DOMAIN_LABELS_BN, OBSERVATION_DOMAIN_LABELS_EN],
    ["OBSERVATION_LEVELS", OBSERVATION_LEVELS, OBSERVATION_LEVEL_LABELS_BN, OBSERVATION_LEVEL_LABELS_EN],
    ["OBSERVATION_GATES", OBSERVATION_GATES, OBSERVATION_GATE_LABELS_BN, OBSERVATION_GATE_LABELS_EN],
    ["GATE_RESULTS", GATE_RESULTS, GATE_RESULT_LABELS_BN, GATE_RESULT_LABELS_EN],
    ["OBSERVATION_STATES", OBSERVATION_STATES, OBSERVATION_STATE_LABELS_BN, OBSERVATION_STATE_LABELS_EN],
    ["GROWTH_PROGRESS", GROWTH_PROGRESS, GROWTH_PROGRESS_LABELS_BN, GROWTH_PROGRESS_LABELS_EN],
  ];
  test.each(totals)("%s has a BN + EN label for every value", (_name, keys, bn, en) => {
    for (const k of keys) {
      expect(bn[k]).toBeTruthy();
      expect(en[k]).toBeTruthy();
    }
  });
  test("states are exactly the 5 pipeline values", () => {
    expect([...OBSERVATION_STATES]).toEqual(["UPLOADED", "ASSIGNED", "REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"]);
  });
});

// ===========================================================================
// ref11 — the pure validator (§5 acceptance)
// ===========================================================================

describe("validateRef11Payload", () => {
  test("a valid payload returns the canonical shape with NO total/average", () => {
    const res = validateRef11Payload(validPayload());
    expect(res.domains).toHaveLength(5);
    expect(res.domains.map((d) => d.domain)).toEqual(["D1", "D2", "D3", "D4", "D5"]); // canonical order
    expect(res.gates).toHaveLength(2);
    expect(res.oneStrength).toBeTruthy();
    expect(res.growthFocus).toBeTruthy();
    // No total/average is ever produced.
    expect(res).not.toHaveProperty("total");
    expect(res).not.toHaveProperty("average");
  });

  test("rejects fewer than 5 domains", () => {
    const p = validPayload();
    p.domains = p.domains.slice(0, 4);
    expect(() => validateRef11Payload(p)).toThrow(/Exactly 5 domain/);
  });

  test("rejects more than 5 domains (a duplicate)", () => {
    const p = validPayload();
    p.domains = [...p.domains, { domain: "D1", level: 2, note: "dup" }];
    expect(() => validateRef11Payload(p)).toThrow(/Exactly 5 domain/);
  });

  test("rejects a duplicate domain at the right count", () => {
    const p = validPayload();
    p.domains[4] = { domain: "D1", level: 3, note: "dup at count 5" };
    expect(() => validateRef11Payload(p)).toThrow(/Duplicate domain/);
  });

  test("rejects an out-of-range level", () => {
    const p = validPayload();
    p.domains[0] = { domain: "D1", level: 5, note: "x" };
    expect(() => validateRef11Payload(p)).toThrow(/level must be one of/);
  });

  test("rejects a missing note", () => {
    const p = validPayload();
    p.domains[0] = { domain: "D1", level: 3, note: "   " };
    expect(() => validateRef11Payload(p)).toThrow(/requires a note/);
  });

  test("rejects not exactly 2 gates", () => {
    const p = validPayload();
    p.gates = [{ gate: "G1", result: "PASS" }];
    expect(() => validateRef11Payload(p)).toThrow(/Exactly 2 gate/);
  });

  test("a gate BREACH stands on its own regardless of levels (§2.1)", () => {
    const p = validPayload();
    // all domains at the top level, yet a gate BREACH is still recorded + valid
    p.domains = OBSERVATION_DOMAINS.map((d) => ({ domain: d, level: 4, note: `n ${d}` }));
    p.gates = [
      { gate: "G1", result: "BREACH", breachNote: "Left two pupils unsupervised." },
      { gate: "G2", result: "PASS" },
    ];
    const res = validateRef11Payload(p);
    expect(res.gates.find((g) => g.gate === "G1")?.result).toBe("BREACH");
    expect(res.gates.find((g) => g.gate === "G1")?.breachNote).toBeTruthy();
  });

  test("rejects a missing strength / growth focus", () => {
    expect(() => validateRef11Payload({ ...validPayload(), oneStrength: "  " })).toThrow(/strength is required/);
    expect(() => validateRef11Payload({ ...validPayload(), growthFocus: "" })).toThrow(/growth focus is required/);
  });

  test("validates the optional carry-forward when present", () => {
    expect(validateRef11Payload({ ...validPayload(), priorFocusProgress: "PARTLY" }).priorFocusProgress).toBe("PARTLY");
    expect(() => validateRef11Payload({ ...validPayload(), priorFocusProgress: "MAYBE" })).toThrow(/priorFocusProgress/);
  });
});

// ===========================================================================
// uploadObservation (J1 — upload + assign)
// ===========================================================================

describe("uploadObservation", () => {
  const base = {
    form: "REF11",
    subject: "MATH",
    teacherId: TEACHER.toString(),
    classDate: "2026-06-14",
    sectionId: SECTION.toString(),
    actorId: OFFICE.toString(),
  };

  test("upload + assign lands ASSIGNED and audits both events", async () => {
    const res = await uploadObservation({ ...base, observerId: OBSERVER.toString() });
    expect(res.state).toBe("ASSIGNED");
    expect(res.observerId).toBe(OBSERVER.toString());
    const kinds = mockWriteAudit.mock.calls.map((c) => (c[0] as { eventKind: string }).eventKind);
    expect(kinds).toContain("CLASSROOM_OBSERVATION_UPLOADED");
    expect(kinds).toContain("CLASSROOM_OBSERVATION_ASSIGNED");
  });

  test("upload without an observer stays UPLOADED (no assign audit)", async () => {
    const res = await uploadObservation(base);
    expect(res.state).toBe("UPLOADED");
    expect(res.observerId).toBeNull();
    const kinds = mockWriteAudit.mock.calls.map((c) => (c[0] as { eventKind: string }).eventKind);
    expect(kinds).toContain("CLASSROOM_OBSERVATION_UPLOADED");
    expect(kinds).not.toContain("CLASSROOM_OBSERVATION_ASSIGNED");
  });

  test("CONFLICT GUARD: refuses an observer who is the observed teacher", async () => {
    await expect(uploadObservation({ ...base, observerId: TEACHER.toString() })).rejects.toThrow(
      /cannot be assigned their own teaching/,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("requires exactly one anchor (both section + group is refused)", async () => {
    await expect(
      uploadObservation({ ...base, subjectGroupId: oid().toString() }),
    ).rejects.toThrow(/exactly one of sectionId or subjectGroupId/);
  });

  test("requires an anchor (neither section nor group is refused)", async () => {
    await expect(uploadObservation({ ...base, sectionId: undefined })).rejects.toThrow(
      /exactly one of sectionId or subjectGroupId/,
    );
  });

  test("a REF11 observation cannot carry the QURAN subject (QURAN uses the Quran form — CO-5)", async () => {
    // The form↔subject guard refuses QURAN on REF-11 in Bangla before the HW_SUBJECTS check.
    await expect(uploadObservation({ ...base, subject: "QURAN" })).rejects.toThrow(/কুরআন ফর্ম/);
  });

  test("a REF11 observation's subject must still be a HW_SUBJECT (an unknown subject is refused)", async () => {
    await expect(uploadObservation({ ...base, subject: "NOPE" })).rejects.toThrow(/must be one of/);
  });

  test("rejects a bad classDate / form", async () => {
    await expect(uploadObservation({ ...base, classDate: "14-06-2026" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(uploadObservation({ ...base, form: "NOPE" })).rejects.toThrow(/form must be one of/);
  });
});

// ===========================================================================
// assignObserver
// ===========================================================================

describe("assignObserver", () => {
  test("assigns on an UPLOADED row → ASSIGNED + audited", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "UPLOADED", observerId: null, assignedAt: null }));
    const res = await assignObserver({ observationId: oid().toString(), observerId: OBSERVER.toString(), actorId: OFFICE.toString() });
    expect(res.state).toBe("ASSIGNED");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASSROOM_OBSERVATION_ASSIGNED" }),
    );
  });

  test("CONFLICT GUARD: refuses the observed teacher as observer", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "UPLOADED", observerId: null }));
    await expect(
      assignObserver({ observationId: oid().toString(), observerId: TEACHER.toString(), actorId: OFFICE.toString() }),
    ).rejects.toThrow(/cannot be assigned their own teaching/);
  });

  test("refuses (re)assignment once REVIEWED", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "REVIEWED" }));
    await expect(
      assignObserver({ observationId: oid().toString(), observerId: OBSERVER.toString(), actorId: OFFICE.toString() }),
    ).rejects.toThrow(/uploaded\/assigned/);
  });
});

// ===========================================================================
// reviewObservation (J2 — only the assigned observer; releases at REVIEWED)
// ===========================================================================

describe("reviewObservation", () => {
  test("the assigned observer scores → REVIEWED + reviewedAt + audited", async () => {
    const doc = makeDoc({ state: "ASSIGNED", observerId: OBSERVER });
    mockFindById.mockResolvedValue(doc);
    const res = await reviewObservation({
      observationId: String(doc._id),
      ...validPayload(),
      actorId: OBSERVER.toString(),
    });
    expect(res.state).toBe("REVIEWED");
    expect(res.reviewedAt).toBeTruthy();
    expect(res.domains).toHaveLength(5);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASSROOM_OBSERVATION_REVIEWED" }),
    );
  });

  test("a DIFFERENT teacher (not the assigned observer) is refused", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "ASSIGNED", observerId: OBSERVER }));
    await expect(
      reviewObservation({ observationId: oid().toString(), ...validPayload(), actorId: oid().toString() }),
    ).rejects.toThrow(/only the assigned observer/i);
  });

  test("cannot review a non-ASSIGNED row", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "UPLOADED", observerId: null }));
    await expect(
      reviewObservation({ observationId: oid().toString(), ...validPayload(), actorId: OBSERVER.toString() }),
    ).rejects.toThrow(/only an assigned observation/i);
  });

  test("propagates the REF-11 validation (bad payload refused)", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "ASSIGNED", observerId: OBSERVER }));
    const bad = { ...validPayload(), gates: [{ gate: "G1", result: "PASS" }] };
    await expect(
      reviewObservation({ observationId: oid().toString(), ...bad, actorId: OBSERVER.toString() }),
    ).rejects.toBeInstanceOf(Ref11ValidationError);
  });
});

// ===========================================================================
// requestReReview (re-review supersedes)
// ===========================================================================

describe("requestReReview", () => {
  test("creates a NEW ASSIGNED observation + marks the prior SUPERSEDED", async () => {
    const prior = makeDoc({ state: "REVIEWED", observerId: OBSERVER });
    mockFindById.mockResolvedValue(prior);
    const newObserver = oid();
    const res = await requestReReview({
      priorObservationId: String(prior._id),
      observerId: newObserver.toString(),
      actorId: OFFICE.toString(),
    });
    // fresh row is ASSIGNED to the new observer, linked to the prior
    expect(res.state).toBe("ASSIGNED");
    expect(res.observerId).toBe(newObserver.toString());
    expect(res.prevObservationId).toBe(String(prior._id));
    // prior flipped SUPERSEDED + saved
    expect(prior.state).toBe("SUPERSEDED");
    expect((prior.save as jest.Mock)).toHaveBeenCalled();
    const kinds = mockWriteAudit.mock.calls.map((c) => (c[0] as { eventKind: string }).eventKind);
    expect(kinds).toContain("CLASSROOM_OBSERVATION_SUPERSEDED");
    expect(kinds).toContain("CLASSROOM_OBSERVATION_ASSIGNED");
  });

  test("only a REVIEWED observation can be re-reviewed", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "ASSIGNED" }));
    await expect(
      requestReReview({ priorObservationId: oid().toString(), observerId: oid().toString(), actorId: OFFICE.toString() }),
    ).rejects.toThrow(/only a reviewed observation/i);
  });

  test("CONFLICT GUARD: the new observer cannot be the observed teacher", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "REVIEWED" }));
    await expect(
      requestReReview({ priorObservationId: oid().toString(), observerId: TEACHER.toString(), actorId: OFFICE.toString() }),
    ).rejects.toThrow(/cannot be assigned their own teaching/);
  });
});

// ===========================================================================
// canReadObservation — the pure row-scope predicate (§5, D-#28)
// ===========================================================================

describe("canReadObservation row-scope", () => {
  const teacher = TEACHER.toString();
  const observer = OBSERVER.toString();
  const otherObserver = oid().toString();
  const row = (state: string, obs: string | null = observer, publishedAt: string | null = null) =>
    ({ teacherId: teacher, observerId: obs, state: state as never, publishedAt });

  test("a manager (Principal/Office) sees ALL states", () => {
    const mgr = { userId: oid().toString(), canManage: true };
    for (const s of OBSERVATION_STATES) expect(canReadObservation(mgr, row(s))).toBe(true);
  });

  test("the assigned observer sees their own row in ANY state (published or not)", () => {
    const o = { userId: observer, canManage: false };
    for (const s of OBSERVATION_STATES) expect(canReadObservation(o, row(s))).toBe(true);
  });

  test("the observed teacher is BLOCKED on any UNPUBLISHED row incl. REVIEWED-but-unpublished (CO-8)", () => {
    const tch = { userId: teacher, canManage: false };
    expect(canReadObservation(tch, row("UPLOADED"))).toBe(false);
    expect(canReadObservation(tch, row("ASSIGNED"))).toBe(false);
    expect(canReadObservation(tch, row("REVIEWED"))).toBe(false); // reviewed but publishedAt null → hidden
  });

  test("the observed teacher sees their own row ONLY once PUBLISHED (CO-8)", () => {
    const tch = { userId: teacher, canManage: false };
    const PUB = "2026-06-15T00:00:00Z";
    expect(canReadObservation(tch, row("REVIEWED", observer, PUB))).toBe(true);
    expect(canReadObservation(tch, row("TEACHER_RESPONDED", observer, PUB))).toBe(true);
    expect(canReadObservation(tch, row("SUPERSEDED", observer, PUB))).toBe(true);
  });

  test("a teacher never sees ANOTHER observer's input (not observer, not observed)", () => {
    const stranger = { userId: otherObserver, canManage: false };
    for (const s of OBSERVATION_STATES) expect(canReadObservation(stranger, row(s))).toBe(false);
    // even a published row stays hidden from a stranger.
    expect(canReadObservation(stranger, row("REVIEWED", observer, "2026-06-15T00:00:00Z"))).toBe(false);
  });
});

// ===========================================================================
// CO-8 publish gate (D-#271) — review no longer releases; a Principal/Office publish does
// ===========================================================================

describe("reviewObservation release semantics (CO-8)", () => {
  test("REVIEWED nudges Principal/Office to publish, does NOT release to the teacher", async () => {
    const doc = makeDoc({ state: "ASSIGNED", observerId: OBSERVER });
    mockFindById.mockResolvedValue(doc);
    await reviewObservation({ observationId: String(doc._id), ...validPayload(), actorId: OBSERVER.toString() });
    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "OBSERVATION_READY_TO_PUBLISH" }));
    expect(mockEmit).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "OBSERVATION_RELEASED" }));
  });
});

describe("publishObservation (CO-8)", () => {
  test("publishes a REVIEWED row → publishedAt/publishedBy set, audited, releases to the teacher", async () => {
    const doc = makeDoc({ state: "REVIEWED", publishedAt: null });
    mockFindById.mockResolvedValue(doc);
    const res = await publishObservation({ observationId: String(doc._id), actorId: OFFICE.toString() });
    expect(res.publishedAt).toBeTruthy();
    expect(res.publishedBy).toBe(OFFICE.toString());
    expect(res.state).toBe("REVIEWED"); // publish is an additive flag, not a new state
    expect(doc.save as jest.Mock).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASSROOM_OBSERVATION_PUBLISHED" }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "OBSERVATION_RELEASED", recipientUserId: TEACHER.toString() }),
    );
  });

  test("refuses a non-REVIEWED row", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "ASSIGNED", publishedAt: null }));
    await expect(
      publishObservation({ observationId: oid().toString(), actorId: OFFICE.toString() }),
    ).rejects.toThrow(/পর্যালোচিত/);
  });

  test("refuses an already-published row (no re-notify)", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "REVIEWED", publishedAt: new Date("2026-06-15T00:00:00Z") }));
    await expect(
      publishObservation({ observationId: oid().toString(), actorId: OFFICE.toString() }),
    ).rejects.toThrow(/ইতিমধ্যে প্রকাশিত/);
    expect(mockEmit).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "OBSERVATION_RELEASED" }));
  });
});

describe("respondToObservation requires publish (CO-8)", () => {
  test("refuses a response on a REVIEWED-but-unpublished row", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "REVIEWED", publishedAt: null }));
    await expect(
      respondToObservation({ observationId: oid().toString(), actorId: TEACHER.toString(), responseText: "seen" }),
    ).rejects.toThrow(/প্রকাশিত হয়নি/);
  });

  test("accepts a response once published → TEACHER_RESPONDED", async () => {
    const doc = makeDoc({ state: "REVIEWED", publishedAt: new Date("2026-06-15T00:00:00Z") });
    mockFindById.mockResolvedValue(doc);
    const res = await respondToObservation({
      observationId: String(doc._id),
      actorId: TEACHER.toString(),
      responseText: "seen & discussed",
    });
    expect(res.state).toBe("TEACHER_RESPONDED");
    expect(res.teacherResponse).toBe("seen & discussed");
  });
});
