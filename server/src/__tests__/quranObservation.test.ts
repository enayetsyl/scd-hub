/**
 * Classroom Observation CO-5 — the Quran (ClassEcho) form tests
 * (prd-classroom-observation §CO-5, D-#56).
 *
 * Vocab   — QURAN_REVIEW_CRITERIA / QURAN_COMPLIANCE_ITEMS label totality (BN + EN)
 *           + the pinned ClassEcho set (NEVER REF-11).
 * quran   — the PURE validator: exactly 8 ratings (1–5, note optional), 7 yes/no
 *           compliance items, strengths/improvements/suggestions required; rejects
 *           wrong count / unknown / out-of-range / duplicate / missing. NO total.
 * Service — uploadObservation enforces form ↔ subject (QURAN ⟺ Quran form, refused
 *           both ways in Bangla); reviewObservation on a QURAN row stores the Quran
 *           payload (+ a REF-11 payload on a QURAN row is refused); the pipeline is
 *           SHARED — a QURAN observation assigns + reviews + responds like REF-11.
 * Trend   — the CO-4 teacherDomainTrend still excludes QURAN rows (form:"REF11").
 *
 * DB-free (repo convention): the model + audit + notifications are mocked.
 */
import mongoose from "mongoose";
import {
  QURAN_REVIEW_CRITERIA,
  QURAN_REVIEW_CRITERIA_LABELS_BN,
  QURAN_REVIEW_CRITERIA_LABELS_EN,
  QURAN_COMPLIANCE_ITEMS,
  QURAN_COMPLIANCE_ITEM_LABELS_BN,
  QURAN_COMPLIANCE_ITEM_LABELS_EN,
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

const mockEmit = jest.fn();
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (e: unknown) => mockEmit(e),
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => mockUserFind(q) },
}));

// Import AFTER mocks
import { validateQuranPayload, QuranValidationError, type QuranPayloadInput } from "../modules/classroom-observation/quran";
import {
  uploadObservation,
  assignObserver,
  reviewObservation,
  publishObservation,
  respondToObservation,
  ClassroomObservationError,
} from "../modules/classroom-observation/services/ClassroomObservationService";
import { teacherDomainTrend } from "../modules/classroom-observation/services/ClassroomObservationTrendService";

const TEACHER = oid();
const OBSERVER = oid();
const OFFICE = oid();
const GROUP = oid(); // a Quran SubjectGroup anchor (D-#56)

// A valid Quran payload (8 ratings 1–5, 7 yes/no, strengths/improvements/suggestions).
const validQuran = (): QuranPayloadInput => ({
  ratings: QURAN_REVIEW_CRITERIA.map((c, i) => ({ criterion: c, score: (i % 5) + 1, note: `note ${c}` })),
  compliance: QURAN_COMPLIANCE_ITEMS.map((item, i) => ({ item, yesNo: i % 2 === 0 })),
  strengths: "Clear tajwid modelling.",
  improvements: "Pace the revision section.",
  suggestions: "Use the homework diary at the close.",
});

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockEmit.mockResolvedValue(undefined);
  mockUserFind.mockReturnValue({ select: () => ({ lean: async () => [{ _id: oid() }] }) });
  mockCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
    _id: oid(),
    ...doc,
    domains: doc.domains ?? [],
    gates: doc.gates ?? [],
    quran: doc.quran ?? null,
    createdAt: new Date("2026-06-14T00:00:00Z"),
    updatedAt: new Date("2026-06-14T00:00:00Z"),
  }));
});

/** A mongoose-doc-like object (has .save) for the findById mutate paths. */
const makeDoc = (over: Record<string, unknown> = {}) => {
  const doc: Record<string, unknown> = {
    _id: oid(),
    form: "QURAN",
    subject: "QURAN",
    teacherId: TEACHER,
    classDate: "2026-06-14",
    sectionId: null,
    subjectGroupId: GROUP,
    routineSlotId: null,
    periodNumber: 2,
    observerId: OBSERVER,
    state: "ASSIGNED",
    createdBy: OFFICE,
    assignedAt: new Date("2026-06-14T00:00:00Z"),
    reviewedAt: null,
    domains: [],
    gates: [],
    oneStrength: null,
    growthFocus: null,
    prevObservationId: null,
    priorFocusProgress: null,
    quran: null,
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
// Vocab — label totality + the pinned ClassEcho set (NEVER REF-11)
// ===========================================================================

describe("CO-5 vocab", () => {
  test("QURAN_REVIEW_CRITERIA is the pinned set of 8 ClassEcho items", () => {
    expect([...QURAN_REVIEW_CRITERIA]).toEqual([
      "SUBJECT_KNOWLEDGE",
      "ENGAGEMENT_WITH_STUDENTS",
      "USE_OF_TEACHING_AIDS",
      "INTERACTION_AND_QUESTION_HANDLING",
      "STUDENT_DISCIPLINE",
      "TEACHERS_CONTROL_OVER_CLASS",
      "PARTICIPATION_LEVEL_OF_STUDENTS",
      "COMPLETION_OF_PLANNED_SYLLABUS",
    ]);
  });
  test("QURAN_COMPLIANCE_ITEMS is the 7 PRD-final yes/no items", () => {
    expect([...QURAN_COMPLIANCE_ITEMS]).toEqual([
      "CLASS_STARTED_ON_TIME",
      "CLASS_PERFORMED_AS_TRAINED",
      "MAINTAINS_DISCIPLINE",
      "STUDENTS_UNDERSTAND_LESSON",
      "CLASS_IS_INTERACTIVE",
      "SIGNS_HOMEWORK_DIARY",
      "CHECKS_HOMEWORK_DIARY",
    ]);
  });
  test("every criterion + item has a BN + EN label", () => {
    for (const c of QURAN_REVIEW_CRITERIA) {
      expect(QURAN_REVIEW_CRITERIA_LABELS_BN[c]).toBeTruthy();
      expect(QURAN_REVIEW_CRITERIA_LABELS_EN[c]).toBeTruthy();
    }
    for (const i of QURAN_COMPLIANCE_ITEMS) {
      expect(QURAN_COMPLIANCE_ITEM_LABELS_BN[i]).toBeTruthy();
      expect(QURAN_COMPLIANCE_ITEM_LABELS_EN[i]).toBeTruthy();
    }
  });
});

// ===========================================================================
// quran — the pure validator (§CO-5 acceptance)
// ===========================================================================

describe("validateQuranPayload", () => {
  test("a well-formed payload returns the canonical shape with NO total/average", () => {
    const res = validateQuranPayload(validQuran());
    expect(res.ratings).toHaveLength(8);
    expect(res.ratings.map((r) => r.criterion)).toEqual([...QURAN_REVIEW_CRITERIA]); // canonical order
    expect(res.compliance).toHaveLength(7);
    expect(res.compliance.map((c) => c.item)).toEqual([...QURAN_COMPLIANCE_ITEMS]);
    expect(res.strengths).toBeTruthy();
    expect(res.improvements).toBeTruthy();
    expect(res.suggestions).toBeTruthy();
    expect(res).not.toHaveProperty("total");
    expect(res).not.toHaveProperty("average");
  });

  test("the per-rating note is optional", () => {
    const p = validQuran();
    p.ratings = QURAN_REVIEW_CRITERIA.map((c, i) => ({ criterion: c, score: (i % 5) + 1 }));
    const res = validateQuranPayload(p);
    expect(res.ratings.every((r) => r.note === null)).toBe(true);
  });

  test("rejects the wrong rating count (fewer than 8)", () => {
    const p = validQuran();
    p.ratings = p.ratings.slice(0, 7);
    expect(() => validateQuranPayload(p)).toThrow(/Exactly 8 rating/);
  });

  test("rejects an unknown criterion", () => {
    const p = validQuran();
    p.ratings[0] = { criterion: "NOPE", score: 3 };
    expect(() => validateQuranPayload(p)).toThrow(/Unknown criterion/);
  });

  test("rejects a duplicate criterion at the right count", () => {
    const p = validQuran();
    p.ratings[7] = { criterion: "SUBJECT_KNOWLEDGE", score: 4 };
    expect(() => validateQuranPayload(p)).toThrow(/Duplicate rating criterion/);
  });

  test("rejects a score out of 1–5 (and a non-integer)", () => {
    const lo = validQuran();
    lo.ratings[0] = { criterion: "SUBJECT_KNOWLEDGE", score: 0 };
    expect(() => validateQuranPayload(lo)).toThrow(/score must be an integer 1–5/);
    const hi = validQuran();
    hi.ratings[0] = { criterion: "SUBJECT_KNOWLEDGE", score: 6 };
    expect(() => validateQuranPayload(hi)).toThrow(/score must be an integer 1–5/);
    const frac = validQuran();
    frac.ratings[0] = { criterion: "SUBJECT_KNOWLEDGE", score: 3.5 };
    expect(() => validateQuranPayload(frac)).toThrow(/score must be an integer 1–5/);
  });

  test("rejects the wrong compliance count + an unknown / duplicate / missing item", () => {
    const few = validQuran();
    few.compliance = few.compliance.slice(0, 6);
    expect(() => validateQuranPayload(few)).toThrow(/Exactly 7 compliance/);

    const unknown = validQuran();
    unknown.compliance[0] = { item: "NOPE", yesNo: true };
    expect(() => validateQuranPayload(unknown)).toThrow(/Unknown compliance item/);

    const dup = validQuran();
    dup.compliance[6] = { item: "CLASS_STARTED_ON_TIME", yesNo: false };
    expect(() => validateQuranPayload(dup)).toThrow(/Duplicate compliance item/);
  });

  test("rejects a missing strength / improvement / suggestion", () => {
    expect(() => validateQuranPayload({ ...validQuran(), strengths: "  " })).toThrow(/Strengths are required/);
    expect(() => validateQuranPayload({ ...validQuran(), improvements: "" })).toThrow(/Improvements are required/);
    expect(() => validateQuranPayload({ ...validQuran(), suggestions: "   " })).toThrow(/Suggestions are required/);
  });
});

// ===========================================================================
// uploadObservation — form ↔ subject enforcement (NEVER REF-11 for QURAN)
// ===========================================================================

describe("uploadObservation form ↔ subject (CO-5)", () => {
  const base = {
    subject: "QURAN",
    teacherId: TEACHER.toString(),
    classDate: "2026-06-14",
    subjectGroupId: GROUP.toString(),
    actorId: OFFICE.toString(),
  };

  test("a QURAN session uses the QURAN form (stores form:QURAN)", async () => {
    const res = await uploadObservation({ ...base, form: "QURAN", observerId: OBSERVER.toString() });
    expect(res.form).toBe("QURAN");
    expect(res.subject).toBe("QURAN");
    expect(res.state).toBe("ASSIGNED");
  });

  test("a QURAN subject on the REF-11 form is refused in Bangla", async () => {
    await expect(uploadObservation({ ...base, form: "REF11" })).rejects.toThrow(/কুরআন ফর্ম/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("a non-Quran subject on the QURAN form is refused in Bangla", async () => {
    await expect(
      uploadObservation({ form: "QURAN", subject: "MATH", teacherId: TEACHER.toString(), classDate: "2026-06-14", sectionId: oid().toString(), actorId: OFFICE.toString() }),
    ).rejects.toThrow(/শুধু কুরআন বিষয়ে/);
  });
});

// ===========================================================================
// reviewObservation — the Quran payload path (and a mismatch refused)
// ===========================================================================

describe("reviewObservation (QURAN form, CO-5)", () => {
  test("the assigned observer stores the Quran payload → REVIEWED", async () => {
    const doc = makeDoc({ state: "ASSIGNED", form: "QURAN", observerId: OBSERVER });
    mockFindById.mockResolvedValue(doc);
    const res = await reviewObservation({
      observationId: String(doc._id),
      // REF-11 fields empty — a QURAN row ignores them.
      domains: [],
      gates: [],
      oneStrength: "",
      growthFocus: "",
      quran: validQuran(),
      actorId: OBSERVER.toString(),
    });
    expect(res.state).toBe("REVIEWED");
    expect(res.quran).not.toBeNull();
    expect(res.quran?.ratings).toHaveLength(8);
    expect(res.quran?.compliance).toHaveLength(7);
    // The REF-11 payload is left empty on a QURAN row.
    expect(res.domains).toHaveLength(0);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASSROOM_OBSERVATION_REVIEWED" }),
    );
  });

  test("a QURAN row reviewed WITHOUT a Quran payload is refused in Bangla", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "ASSIGNED", form: "QURAN", observerId: OBSERVER }));
    await expect(
      reviewObservation({ observationId: oid().toString(), domains: [], gates: [], oneStrength: "", growthFocus: "", actorId: OBSERVER.toString() }),
    ).rejects.toThrow(/কুরআন পেলোড প্রয়োজন/);
  });

  test("propagates the Quran validation (bad payload refused)", async () => {
    mockFindById.mockResolvedValue(makeDoc({ state: "ASSIGNED", form: "QURAN", observerId: OBSERVER }));
    const bad = validQuran();
    bad.ratings = bad.ratings.slice(0, 7);
    await expect(
      reviewObservation({ observationId: oid().toString(), domains: [], gates: [], oneStrength: "", growthFocus: "", quran: bad, actorId: OBSERVER.toString() }),
    ).rejects.toBeInstanceOf(QuranValidationError);
  });
});

// ===========================================================================
// Shared pipeline — a QURAN observation assigns + reviews + responds like REF-11
// ===========================================================================

describe("QURAN observation shares the REF-11 pipeline", () => {
  test("assign → review → publish → respond drives UPLOADED→ASSIGNED→REVIEWED→(published)→TEACHER_RESPONDED", async () => {
    // assign (UPLOADED → ASSIGNED)
    const assignedDoc = makeDoc({ state: "UPLOADED", form: "QURAN", observerId: null, assignedAt: null });
    mockFindById.mockResolvedValueOnce(assignedDoc);
    const assigned = await assignObserver({
      observationId: String(assignedDoc._id),
      observerId: OBSERVER.toString(),
      actorId: OFFICE.toString(),
    });
    expect(assigned.state).toBe("ASSIGNED");

    // review (ASSIGNED → REVIEWED) with the Quran payload
    const reviewDoc = makeDoc({ state: "ASSIGNED", form: "QURAN", observerId: OBSERVER });
    mockFindById.mockResolvedValueOnce(reviewDoc);
    const reviewed = await reviewObservation({
      observationId: String(reviewDoc._id),
      domains: [],
      gates: [],
      oneStrength: "",
      growthFocus: "",
      quran: validQuran(),
      actorId: OBSERVER.toString(),
    });
    expect(reviewed.state).toBe("REVIEWED");
    // CO-8 (D-#271): review nudges managers to publish; it does NOT release to the teacher yet.
    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "OBSERVATION_READY_TO_PUBLISH" }));
    expect(mockEmit).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "OBSERVATION_RELEASED" }));

    // publish (Principal/Office) → releases to the teacher (OBSERVATION_RELEASED fires here now)
    const publishDoc = makeDoc({ state: "REVIEWED", form: "QURAN", observerId: OBSERVER, publishedAt: null, quran: reviewed.quran });
    mockFindById.mockResolvedValueOnce(publishDoc);
    const published = await publishObservation({ observationId: String(publishDoc._id), actorId: OFFICE.toString() });
    expect(published.publishedAt).toBeTruthy();
    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "OBSERVATION_RELEASED" }));

    // respond (REVIEWED + published → TEACHER_RESPONDED) by the observed teacher
    const respondDoc = makeDoc({ state: "REVIEWED", form: "QURAN", observerId: OBSERVER, publishedAt: new Date(), quran: reviewed.quran });
    mockFindById.mockResolvedValueOnce(respondDoc);
    const responded = await respondToObservation({
      observationId: String(respondDoc._id),
      responseText: "দেখেছি ও আলোচনা করেছি।",
      actorId: TEACHER.toString(),
    });
    expect(responded.state).toBe("TEACHER_RESPONDED");
    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "OBSERVATION_RESPONDED" }));
  });
});

// ===========================================================================
// CO-4 trend sanity — QURAN rows are excluded (form:"REF11" filter)
// ===========================================================================

describe("CO-4 teacherDomainTrend excludes QURAN rows (sanity)", () => {
  test("the trend query filters form:REF11 (Quran rows never enter the domain trend)", async () => {
    mockFind.mockReturnValue(leanChain([]));
    await teacherDomainTrend(TEACHER.toString());
    expect(mockFind).toHaveBeenCalled();
    const queries = mockFind.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(queries.every((q) => q.form === "REF11")).toBe(true);
  });
});
