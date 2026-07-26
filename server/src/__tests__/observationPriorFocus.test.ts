/**
 * Classroom Observation CO-10 + CO-11 tests (prd-classroom-observation §5, D-#363).
 *
 * ref11        — the new optional `priorFocusNote`: trimmed, null when blank/absent,
 *                independent of the progress enum.
 * CO-10 read   — `priorObservationContext`: `prevObservationId` short-circuits the
 *                search; otherwise the newest settled REF-11 row of the same teacher
 *                BEFORE this one, with a same-subject prior chosen OUTRIGHT over a more
 *                recent other-subject one; null for a first-ever observation and for a
 *                QURAN row; a dangling prev link falls back to the date search.
 * VISIBILITY   — the payload's FIELD SET is the decision (a narrow slice of ANOTHER
 *                observer's row): a test pins the exact keys so nobody quietly adds
 *                `domains` / `observerId` / `teacherResponse` / a fairness rating.
 *                `canReadPriorContext` gates it to the assigned observer or a manager —
 *                the observed teacher has NO path.
 * CO-11 read   — `observerReviewsPaged` FORCES observerId to the caller (a peer id in
 *                the input is overridden, not merged), and the new `sectionId` filter
 *                reaches the query.
 *
 * DB-free (repo convention): the model + audit are mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

/** findById(...).lean() and findOne(...).sort(...).lean() both resolve to `val`. */
const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.sort = () => o;
  o.skip = () => o;
  o.limit = () => o;
  o.lean = async () => val;
  return o;
};

const mockFindById = jest.fn();
const mockFindOne = jest.fn();
const mockFind = jest.fn();
const mockCount = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: {
    findById: (id: unknown) => mockFindById(id),
    findOne: (q: unknown) => mockFindOne(q),
    find: (q: unknown) => mockFind(q),
    countDocuments: (q: unknown) => mockCount(q),
  },
}));

jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn() }));
jest.mock("../modules/notifications/services/NotificationService", () => ({ emit: jest.fn() }));
const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => mockUserFind(q) },
}));

// Import AFTER mocks
import { validateRef11Payload, type Ref11PayloadInput } from "../modules/classroom-observation/ref11";
import {
  priorObservationContext,
  canReadPriorContext,
  observerReviewsPaged,
  allObservationsPaged,
} from "../modules/classroom-observation/services/ClassroomObservationService";
import { OBSERVATION_DOMAINS, OBSERVATION_GATES } from "@scd/shared";

const TEACHER = oid();
const OBSERVER = oid();
const OTHER_OBSERVER = oid();
const SECTION = oid();

const CURRENT_ID = oid();
const PRIOR_ID = oid();

/** A plain (lean) observation row. */
const row = (over: Record<string, unknown> = {}) => ({
  _id: oid(),
  form: "REF11",
  subject: "MATH",
  teacherId: TEACHER,
  classDate: "2026-06-20",
  sectionId: SECTION,
  subjectGroupId: null,
  observerId: OBSERVER,
  state: "ASSIGNED",
  prevObservationId: null,
  growthFocus: null,
  oneStrength: null,
  priorFocusProgress: null,
  priorFocusNote: null,
  domains: [],
  gates: [],
  teacherResponse: null,
  fairnessRating: null,
  ...over,
});

const validPayload = (): Ref11PayloadInput => ({
  domains: OBSERVATION_DOMAINS.map((d, i) => ({ domain: d, level: (i % 4) + 1, note: `note ${d}` })),
  gates: OBSERVATION_GATES.map((g) => ({ gate: g, result: "PASS" })),
  oneStrength: "Clear modelling of the worked example.",
  growthFocus: "Increase wait-time after higher-order questions.",
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOne.mockReturnValue(leanChain(null));
  mockUserFind.mockReturnValue({ select: () => ({ lean: async () => [] }) });
});

// ===========================================================================
// ref11 — the optional priorFocusNote (CO-10)
// ===========================================================================

describe("validateRef11Payload — priorFocusNote (CO-10)", () => {
  test("absent ⇒ null (an observation with no prior carries neither field)", () => {
    const res = validateRef11Payload(validPayload());
    expect(res.priorFocusNote).toBeNull();
    expect(res.priorFocusProgress).toBeNull();
  });

  test("a note is trimmed and round-trips", () => {
    const res = validateRef11Payload({ ...validPayload(), priorFocusNote: "  wait-time is visibly longer  " });
    expect(res.priorFocusNote).toBe("wait-time is visibly longer");
  });

  test("blank / whitespace-only ⇒ null, never an empty string", () => {
    expect(validateRef11Payload({ ...validPayload(), priorFocusNote: "" }).priorFocusNote).toBeNull();
    expect(validateRef11Payload({ ...validPayload(), priorFocusNote: "   " }).priorFocusNote).toBeNull();
    expect(validateRef11Payload({ ...validPayload(), priorFocusNote: null }).priorFocusNote).toBeNull();
  });

  test("the note is independent of the verdict — either may stand alone", () => {
    const noteOnly = validateRef11Payload({ ...validPayload(), priorFocusNote: "partly, in group work" });
    expect(noteOnly.priorFocusNote).toBe("partly, in group work");
    expect(noteOnly.priorFocusProgress).toBeNull();

    const verdictOnly = validateRef11Payload({ ...validPayload(), priorFocusProgress: "PARTLY" });
    expect(verdictOnly.priorFocusProgress).toBe("PARTLY");
    expect(verdictOnly.priorFocusNote).toBeNull();
  });
});

// ===========================================================================
// CO-10 — priorObservationContext resolution
// ===========================================================================

describe("priorObservationContext — resolution order (CO-10)", () => {
  test("a re-review resolves via prevObservationId and does NOT search by date", async () => {
    const current = row({ _id: CURRENT_ID, prevObservationId: PRIOR_ID, classDate: "2026-06-20" });
    const prior = row({
      _id: PRIOR_ID,
      classDate: "2026-06-20",
      state: "SUPERSEDED",
      growthFocus: "Increase wait-time.",
      oneStrength: "Strong modelling.",
    });
    mockFindById.mockImplementation((id: unknown) =>
      leanChain(String(id) === String(CURRENT_ID) ? current : prior),
    );

    const res = await priorObservationContext(CURRENT_ID.toString());

    expect(res?.observationId).toBe(PRIOR_ID.toString());
    expect(res?.isReReview).toBe(true);
    expect(res?.growthFocus).toBe("Increase wait-time.");
    expect(mockFindOne).not.toHaveBeenCalled(); // the link answers it outright
  });

  test("no earlier observation ⇒ null (the form then hides both carry-forward fields)", async () => {
    mockFindById.mockReturnValue(leanChain(row({ _id: CURRENT_ID })));
    mockFindOne.mockReturnValue(leanChain(null));

    expect(await priorObservationContext(CURRENT_ID.toString())).toBeNull();
    // Both passes were attempted: same-subject, then any-subject.
    expect(mockFindOne).toHaveBeenCalledTimes(2);
  });

  test("a QURAN row returns null without any lookup — it has no growth focus", async () => {
    mockFindById.mockReturnValue(leanChain(row({ _id: CURRENT_ID, form: "QURAN", subject: "QURAN" })));

    expect(await priorObservationContext(CURRENT_ID.toString())).toBeNull();
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  test("a SAME-SUBJECT prior wins outright over a more recent other-subject one", async () => {
    const current = row({ _id: CURRENT_ID, subject: "MATH", classDate: "2026-06-20" });
    const sameSubjectOlder = row({
      _id: PRIOR_ID,
      subject: "MATH",
      classDate: "2026-05-02", // OLDER than the English one below
      state: "REVIEWED",
      growthFocus: "Wait-time in maths.",
    });
    mockFindById.mockReturnValue(leanChain(current));
    // First call carries the subject filter and hits; the fallback must never run.
    mockFindOne.mockImplementation((q: Record<string, unknown>) =>
      leanChain(q.subject === "MATH" ? sameSubjectOlder : row({ subject: "ENGLISH", classDate: "2026-06-10" })),
    );

    const res = await priorObservationContext(CURRENT_ID.toString());

    expect(res?.observationId).toBe(PRIOR_ID.toString());
    expect(res?.subject).toBe("MATH");
    expect(res?.sameSubject).toBe(true);
    expect(mockFindOne).toHaveBeenCalledTimes(1); // no fallback pass
  });

  test("with no same-subject prior it falls back to any subject and flags sameSubject false", async () => {
    const current = row({ _id: CURRENT_ID, subject: "MATH" });
    const otherSubject = row({ _id: PRIOR_ID, subject: "ENGLISH", classDate: "2026-06-10", state: "REVIEWED", growthFocus: "Pace." });
    mockFindById.mockReturnValue(leanChain(current));
    mockFindOne.mockImplementation((q: Record<string, unknown>) =>
      leanChain(q.subject === "MATH" ? null : otherSubject),
    );

    const res = await priorObservationContext(CURRENT_ID.toString());

    expect(res?.subject).toBe("ENGLISH");
    expect(res?.sameSubject).toBe(false);
    expect(res?.isReReview).toBe(false);
    expect(mockFindOne).toHaveBeenCalledTimes(2);
  });

  test("a DANGLING prevObservationId falls through to the date search rather than returning nothing", async () => {
    const current = row({ _id: CURRENT_ID, prevObservationId: PRIOR_ID });
    const found = row({ _id: oid(), state: "REVIEWED", growthFocus: "Questioning." });
    mockFindById.mockImplementation((id: unknown) =>
      leanChain(String(id) === String(CURRENT_ID) ? current : null),
    );
    mockFindOne.mockReturnValue(leanChain(found));

    const res = await priorObservationContext(CURRENT_ID.toString());

    expect(res).not.toBeNull();
    expect(res?.isReReview).toBe(false);
    expect(mockFindOne).toHaveBeenCalled();
  });

  test("the search is scoped: same teacher, REF-11, settled state, a growth focus, strictly earlier", async () => {
    const current = row({ _id: CURRENT_ID, classDate: "2026-06-20" });
    mockFindById.mockReturnValue(leanChain(current));
    mockFindOne.mockReturnValue(leanChain(null));

    await priorObservationContext(CURRENT_ID.toString());

    const q = mockFindOne.mock.calls[0][0] as Record<string, unknown>;
    expect(q.teacherId).toEqual(TEACHER);
    expect(q.form).toBe("REF11");
    expect(q.growthFocus).toEqual({ $ne: null });
    expect(q.classDate).toEqual({ $lt: "2026-06-20" }); // strictly earlier, never itself
    expect(q._id).toEqual({ $ne: CURRENT_ID });
    expect(q.state).toEqual({ $in: ["REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"] });
  });
});

// ===========================================================================
// CO-10 — the VISIBILITY decision (the field set IS the rule)
// ===========================================================================

describe("priorObservationContext — the narrow slice (D-#363 visibility)", () => {
  test("returns EXACTLY the agreed fields — no scores, no response, no observer identity", async () => {
    const current = row({ _id: CURRENT_ID });
    // A fully-populated prior row written by a DIFFERENT observer: everything the
    // caller must not receive is present on the source document.
    const prior = row({
      _id: PRIOR_ID,
      observerId: OTHER_OBSERVER,
      state: "TEACHER_RESPONDED",
      classDate: "2026-05-02",
      growthFocus: "Wait-time.",
      oneStrength: "Modelling.",
      priorFocusProgress: "PARTLY",
      priorFocusNote: "improved in pairs only",
      domains: OBSERVATION_DOMAINS.map((d) => ({ domain: d, level: 2, note: "secret" })),
      gates: OBSERVATION_GATES.map((g) => ({ gate: g, result: "BREACH", breachNote: "secret" })),
      teacherResponse: "I disagree with the pacing note.",
      fairnessRating: 2,
      usefulnessRating: 1,
    });
    mockFindById.mockReturnValue(leanChain(current));
    mockFindOne.mockReturnValue(leanChain(prior));

    const res = await priorObservationContext(CURRENT_ID.toString());

    expect(Object.keys(res as object).sort()).toEqual(
      [
        "classDate",
        "form",
        "growthFocus",
        "isReReview",
        "oneStrength",
        "observationId",
        "priorFocusProgress",
        "sameSubject",
        "subject",
      ].sort(),
    );
    // Named explicitly so a regression fails by NAME, not just by key count.
    const keys = Object.keys(res as object);
    for (const forbidden of [
      "domains",
      "gates",
      "observerId",
      "teacherId",
      "teacherResponse",
      "fairnessRating",
      "usefulnessRating",
      "priorFocusNote",
      "recordingId",
      "state",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  test("canReadPriorContext: the assigned observer and a manager may read; nobody else", () => {
    const obs = { observerId: OBSERVER.toString() };
    // The observer being asked the carry-forward question.
    expect(canReadPriorContext({ userId: OBSERVER.toString(), canManage: false }, obs)).toBe(true);
    // Principal/Office.
    expect(canReadPriorContext({ userId: oid().toString(), canManage: true }, obs)).toBe(true);
    // The OBSERVED teacher has no path — this read exists to fill in a form.
    expect(canReadPriorContext({ userId: TEACHER.toString(), canManage: false }, obs)).toBe(false);
    // Another teacher who merely holds observation:review.
    expect(canReadPriorContext({ userId: OTHER_OBSERVER.toString(), canManage: false }, obs)).toBe(false);
    // An unassigned row is readable only by a manager.
    expect(canReadPriorContext({ userId: OBSERVER.toString(), canManage: false }, { observerId: null })).toBe(false);
  });
});

// ===========================================================================
// CO-11 — the observer's own history + the section filter
// ===========================================================================

describe("observerReviewsPaged (CO-11)", () => {
  beforeEach(() => {
    mockCount.mockResolvedValue(0);
    mockFind.mockReturnValue(leanChain([]));
  });

  test("forces observerId to the caller — a peer id in the input is OVERRIDDEN", async () => {
    await observerReviewsPaged(OBSERVER.toString(), { observerId: OTHER_OBSERVER.toString() });

    const q = mockCount.mock.calls[0][0] as Record<string, unknown>;
    expect(String(q.observerId)).toBe(OBSERVER.toString());
    expect(String(q.observerId)).not.toBe(OTHER_OBSERVER.toString());
  });

  test("does NOT restrict state — the history holds every row the caller has touched", async () => {
    await observerReviewsPaged(OBSERVER.toString(), {});

    const q = mockCount.mock.calls[0][0] as Record<string, unknown>;
    expect(q.state).toBeUndefined();
  });

  test("passes the other filters through unchanged", async () => {
    await observerReviewsPaged(OBSERVER.toString(), {
      subject: "MATH",
      sectionId: SECTION.toString(),
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
    });

    const q = mockCount.mock.calls[0][0] as Record<string, unknown>;
    expect(q.subject).toBe("MATH");
    expect(String(q.sectionId)).toBe(SECTION.toString());
    expect(q.classDate).toEqual({ $gte: "2026-06-01", $lte: "2026-06-30" });
  });
});

describe("allObservationsPaged — the sectionId (class) filter (CO-11)", () => {
  beforeEach(() => {
    mockCount.mockResolvedValue(0);
    mockFind.mockReturnValue(leanChain([]));
  });

  test("sectionId narrows the query", async () => {
    await allObservationsPaged({ sectionId: SECTION.toString() });

    const q = mockCount.mock.calls[0][0] as Record<string, unknown>;
    expect(String(q.sectionId)).toBe(SECTION.toString());
  });

  test("omitting it leaves the query unscoped by section", async () => {
    await allObservationsPaged({});

    const q = mockCount.mock.calls[0][0] as Record<string, unknown>;
    expect(q.sectionId).toBeUndefined();
  });

  test("an invalid sectionId is refused, not silently ignored", async () => {
    await expect(allObservationsPaged({ sectionId: "not-an-id" })).rejects.toThrow(/sectionId/i);
  });
});
