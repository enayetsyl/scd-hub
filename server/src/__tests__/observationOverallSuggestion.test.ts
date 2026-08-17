/**
 * Classroom Observation CO-16 tests (prd-classroom-observation §CO-16, D-#503).
 *
 * The owner's reviewer asked for a place to put a suggestion that belongs to no single
 * REF-11 domain ("channel this energy into pair/group work, hands-on materials"), because
 * filing such an idea under a domain misreports it as that domain's weakness.
 *
 * ref11        — `overallSuggestion` is OPTIONAL: absent/blank/whitespace ⇒ null (never
 *                ""), trimmed when given, and its absence never blocks a valid review.
 * review write — a REF-11 row stores it; a QURAN row NEVER does (that form already asks
 *                for `quran.suggestions`, CO-5) even if a client sends the field.
 * visibility   — it travels in the row's own shape, so the observed teacher reads it
 *                exactly when the row is readable: after PUBLISH (CO-8, D-#271), not
 *                before.
 * NOT scored   — the field is descriptive only. A test pins that reviewing with vs
 *                without it produces identical domains/gates, so it can never leak into
 *                the CO-4 trend / CO-7 effectiveness inputs.
 */
import { Types } from "mongoose";
import {
  OBSERVATION_DOMAINS,
  OBSERVATION_GATES,
  QURAN_REVIEW_CRITERIA,
  QURAN_COMPLIANCE_ITEMS,
} from "@scd/shared";

const oid = () => new Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const mockFindById = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: {
    findById: (id: unknown) => mockFindById(id),
  },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

const mockEmit = jest.fn();
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (e: unknown) => mockEmit(e),
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => mockUserFind(q) },
}));

// Import AFTER mocks
import { validateRef11Payload, type Ref11PayloadInput } from "../modules/classroom-observation/ref11";
import {
  reviewObservation,
  canReadObservation,
} from "../modules/classroom-observation/services/ClassroomObservationService";

const TEACHER = oid();
const OBSERVER = oid();
const OFFICE = oid();
const SECTION = oid();

const validPayload = (): Ref11PayloadInput => ({
  domains: OBSERVATION_DOMAINS.map((d, i) => ({ domain: d, level: (i % 4) + 1, note: `note ${d}` })),
  gates: OBSERVATION_GATES.map((g) => ({ gate: g, result: "PASS" })),
  oneStrength: "Clear modelling of the worked example.",
  growthFocus: "Increase wait-time after higher-order questions.",
});

/** A mongoose-doc-like object (has .save) for the findById mutate path. */
const makeDoc = (over: Record<string, unknown> = {}) => {
  const doc: Record<string, unknown> = {
    _id: oid(),
    form: "REF11",
    subject: "MATH",
    teacherId: TEACHER,
    classDate: "2026-08-17",
    sectionId: SECTION,
    subjectGroupId: null,
    routineSlotId: null,
    periodNumber: 3,
    observerId: OBSERVER,
    state: "ASSIGNED",
    createdBy: OFFICE,
    assignedAt: new Date("2026-08-17T00:00:00Z"),
    reviewedAt: null,
    publishedAt: null,
    withheldAt: null,
    cancelledAt: null,
    domains: [],
    gates: [],
    oneStrength: null,
    growthFocus: null,
    prevObservationId: null,
    priorFocusProgress: null,
    priorFocusNote: null,
    overallSuggestion: null,
    quran: null,
    recordingId: null,
    teacherResponse: null,
    supersededById: null,
    createdAt: new Date("2026-08-17T00:00:00Z"),
    updatedAt: new Date("2026-08-17T00:00:00Z"),
    ...over,
  };
  doc.save = jest.fn(async () => doc);
  return doc;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockEmit.mockResolvedValue(undefined);
  mockUserFind.mockReturnValue({ select: () => ({ lean: async () => [{ _id: oid() }] }) });
});

// ===========================================================================
// ref11 — the optional overallSuggestion (CO-16)
// ===========================================================================

describe("validateRef11Payload — overallSuggestion (CO-16)", () => {
  test("absent ⇒ null, and the review is still valid (never required)", () => {
    const res = validateRef11Payload(validPayload());
    expect(res.overallSuggestion).toBeNull();
    // The rest of the payload is untouched by the new field.
    expect(res.domains).toHaveLength(OBSERVATION_DOMAINS.length);
    expect(res.gates).toHaveLength(OBSERVATION_GATES.length);
  });

  test("a suggestion is trimmed and round-trips", () => {
    const res = validateRef11Payload({
      ...validPayload(),
      overallSuggestion: "  পয়সার অংক হলে স্কুলের নকল টাকা দিয়ে জোড়ায় মডেল করানো যেতে পারে।  ",
    });
    expect(res.overallSuggestion).toBe("পয়সার অংক হলে স্কুলের নকল টাকা দিয়ে জোড়ায় মডেল করানো যেতে পারে।");
  });

  test("blank / whitespace-only / null ⇒ null, never an empty string", () => {
    expect(validateRef11Payload({ ...validPayload(), overallSuggestion: "" }).overallSuggestion).toBeNull();
    expect(validateRef11Payload({ ...validPayload(), overallSuggestion: "   " }).overallSuggestion).toBeNull();
    expect(validateRef11Payload({ ...validPayload(), overallSuggestion: null }).overallSuggestion).toBeNull();
  });

  test("it is independent of the carry-forward pair — any combination is accepted", () => {
    const res = validateRef11Payload({ ...validPayload(), overallSuggestion: "more pair work" });
    expect(res.overallSuggestion).toBe("more pair work");
    expect(res.priorFocusProgress).toBeNull();
    expect(res.priorFocusNote).toBeNull();
  });

  test("DESCRIPTIVE only: supplying it changes no score", () => {
    const without = validateRef11Payload(validPayload());
    const withIt = validateRef11Payload({ ...validPayload(), overallSuggestion: "use the fake money set" });
    expect(withIt.domains).toEqual(without.domains);
    expect(withIt.gates).toEqual(without.gates);
    expect(withIt.oneStrength).toBe(without.oneStrength);
    expect(withIt.growthFocus).toBe(without.growthFocus);
  });
});

// ===========================================================================
// reviewObservation — stored on REF-11, never on QURAN
// ===========================================================================

describe("reviewObservation — overallSuggestion (CO-16)", () => {
  test("a REF-11 review stores the trimmed suggestion", async () => {
    const doc = makeDoc();
    mockFindById.mockResolvedValue(doc);
    const res = await reviewObservation({
      ...validPayload(),
      observationId: String(doc._id),
      overallSuggestion: "  Channel the energy into pair work with the fake-money set.  ",
      actorId: OBSERVER.toString(),
    });
    expect(res.state).toBe("REVIEWED");
    expect(res.overallSuggestion).toBe("Channel the energy into pair work with the fake-money set.");
  });

  test("omitting it leaves the row's suggestion null", async () => {
    const doc = makeDoc();
    mockFindById.mockResolvedValue(doc);
    const res = await reviewObservation({
      ...validPayload(),
      observationId: String(doc._id),
      actorId: OBSERVER.toString(),
    });
    expect(res.overallSuggestion).toBeNull();
  });

  test("a QURAN row NEVER stores it — that form has quran.suggestions (CO-5)", async () => {
    const doc = makeDoc({ form: "QURAN", subject: "QURAN", sectionId: null, subjectGroupId: oid() });
    mockFindById.mockResolvedValue(doc);
    const res = await reviewObservation({
      domains: [],
      gates: [],
      oneStrength: "",
      growthFocus: "",
      overallSuggestion: "should be ignored on a Quran row",
      quran: {
        ratings: QURAN_REVIEW_CRITERIA.map((criterion, i) => ({ criterion, score: (i % 5) + 1, note: null })),
        compliance: QURAN_COMPLIANCE_ITEMS.map((item) => ({ item, yesNo: true })),
        strengths: "Clear tajwid modelling.",
        improvements: "Pace the revision section.",
        suggestions: "Use the homework diary at the close.",
      },
      observationId: String(doc._id),
      actorId: OBSERVER.toString(),
    });
    expect(res.state).toBe("REVIEWED");
    expect(res.overallSuggestion).toBeNull();
    expect(res.quran?.suggestions).toBe("Use the homework diary at the close.");
  });
});

// ===========================================================================
// Visibility — it rides the row's existing gate (CO-8): teacher reads it on PUBLISH
// ===========================================================================

describe("overallSuggestion visibility (CO-16 × CO-8)", () => {
  const rowFor = (publishedAt: string | null) => ({
    teacherId: TEACHER.toString(),
    observerId: OBSERVER.toString(),
    state: "REVIEWED" as const,
    publishedAt,
  });

  test("the observed teacher cannot read the row (and so the suggestion) before publish", () => {
    expect(canReadObservation({ userId: TEACHER.toString(), canManage: false }, rowFor(null))).toBe(false);
  });

  test("once published, the observed teacher can read the row — the suggestion comes with it", () => {
    expect(
      canReadObservation({ userId: TEACHER.toString(), canManage: false }, rowFor("2026-08-18T04:00:00Z")),
    ).toBe(true);
  });

  test("the observer and Principal/Office read it either way", () => {
    expect(canReadObservation({ userId: OBSERVER.toString(), canManage: false }, rowFor(null))).toBe(true);
    expect(canReadObservation({ userId: OFFICE.toString(), canManage: true }, rowFor(null))).toBe(true);
  });
});
