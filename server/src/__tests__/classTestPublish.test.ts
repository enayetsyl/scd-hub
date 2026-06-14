/**
 * Class Test Tracker CT-3 tests (prd-tracker-class-test §5/§8, J4/J7, D-#121/#122/#160).
 *
 * Templates  — class_test.result.{regular|excellent|absent} render byte-identically to
 *              the MT-registry defaults (built on the registry, D-#131); classTestMessageKind
 *              maps ABSENT→absent, weakness→regular, no-weakness→excellent (§8).
 * Publish    — publishResult/publishExam stamp publishedAt + $inc publishedVersion, deliver
 *              (wa.me for the family + emit() for login-enabled), audit PUBLISHED; require a
 *              PRINTED exam + an entered result; the dedupeKey carries publishedVersion so a
 *              RE-publish RE-notifies (D-#122 — a fresh v2 key, not swallowed).
 * Unpublish  — clears publishedAt, leaves publishedVersion, audit UNPUBLISHED.
 * Guardian   — childTestResults returns PUBLISHED only + derives percent/pass; the shape
 *              NEVER carries teacherAction (J7/D-#68).
 *
 * DB-free (the repo convention): models + emit + audit are mocked; renderTemplate runs for
 * real and falls back to the code-default registry (no DB → byte-identical default).
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

const mockCtFindById = jest.fn();
const mockCtFind = jest.fn();
jest.mock("../modules/trackers/models/ClassTest", () => ({
  ClassTest: {
    findById: (id: unknown) => mockCtFindById(id),
    find: (q: unknown) => mockCtFind(q),
  },
}));

const mockResFindOneUpdate = jest.fn();
const mockResFindByIdUpdate = jest.fn();
const mockResFind = jest.fn();
const mockResUpdateMany = jest.fn();
jest.mock("../modules/trackers/models/ClassTestResult", () => ({
  ClassTestResult: {
    findOneAndUpdate: (...a: unknown[]) => mockResFindOneUpdate(...a),
    findByIdAndUpdate: (...a: unknown[]) => mockResFindByIdUpdate(...a),
    find: (q: unknown) => mockResFind(q),
    updateMany: (...a: unknown[]) => mockResUpdateMany(...a),
  },
}));

const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (q: unknown) => mockStudentFind(q) },
}));

// The real emitClassTestGuardianResult runs (so the dedupeKey it builds is exercised);
// only the leaf models + the single emit() door are mocked.
const mockEmit = jest.fn();
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (i: unknown) => mockEmit(i),
}));

const mockLinkFind = jest.fn();
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: { find: (q: unknown) => mockLinkFind(q) },
}));
const mockGuardianFind = jest.fn();
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: { find: (q: unknown) => mockGuardianFind(q) },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import {
  publishResult,
  publishExam,
  unpublishResult,
  unpublishExam,
  classTestMessageKind,
  buildClassTestResultMessage,
} from "../modules/trackers/services/ClassTestPublishService";
import { childTestResults, ClassTestResultError } from "../modules/trackers/services/ClassTestResultService";
import { interpolate, renderTemplate } from "../modules/templates/services/MessageTemplateService";
import { MESSAGE_TEMPLATE_REGISTRY } from "@scd/shared";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_OID = oid();
const SECTION_OID = oid();
const STUDENT_OID = oid();
const GUARDIAN_OID = oid();
const ACTOR = oid().toString();

const printedTest = (over: Record<string, unknown> = {}) => ({
  _id: TEST_OID,
  ctId: "CT-C3-MATH-0001",
  sectionId: SECTION_OID,
  subject: "MATH",
  testNumber: 1,
  examDate: new Date(2026, 6, 10),
  totalMarks: 20,
  passMark: 8,
  classLevel: 3,
  status: "PRINTED",
  ...over,
});

const resultDoc = (over: Record<string, unknown> = {}) => ({
  _id: oid(),
  testId: TEST_OID,
  studentId: STUDENT_OID,
  status: "PRESENT",
  marks: 15,
  weakness: "ভগ্নাংশ",
  guardianAction: "বাড়িতে অনুশীলন",
  publishedVersion: 1,
  publishedAt: new Date(),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCtFindById.mockReturnValue(leanChain(printedTest()));
  mockStudentFind.mockReturnValue(leanChain([{ _id: STUDENT_OID, name: "Karim", nameBn: "করিম", phone: "01711-000000" }]));
  // one login-enabled guardian for the student
  mockLinkFind.mockReturnValue(leanChain([{ guardianId: GUARDIAN_OID }]));
  mockGuardianFind.mockReturnValue(leanChain([{ _id: GUARDIAN_OID }]));
  mockEmit.mockResolvedValue({ created: true, dedupeKey: "x" });
  mockWriteAudit.mockResolvedValue(undefined);
});

// ===========================================================================
// Templates (§8) — rendered from the MT registry (byte-identical), kind mapping
// ===========================================================================

describe("class_test.result.* templates", () => {
  test("classTestMessageKind: ABSENT→absent, weakness→regular, no-weakness→excellent (§8)", () => {
    expect(classTestMessageKind({ status: "ABSENT" })).toBe("absent");
    expect(classTestMessageKind({ status: "PRESENT", weakness: "ভগ্নাংশ" })).toBe("regular");
    expect(classTestMessageKind({ status: "PRESENT", weakness: "" })).toBe("excellent");
    expect(classTestMessageKind({ status: "PRESENT", weakness: "   " })).toBe("excellent"); // whitespace-only = none
  });

  test("renderTemplate(class_test.result.regular.body) is byte-identical to the registry default", async () => {
    const params = {
      StudentName: "করিম", Subject: "গণিত", TestNumber: 1, Marks: 15, TotalMarks: 20,
      Weakness: "ভগ্নাংশ", GuardianAction: "বাড়িতে অনুশীলন",
    };
    const expected = interpolate(MESSAGE_TEMPLATE_REGISTRY["class_test.result.regular.body"].bnDefault, params);
    const rendered = await renderTemplate("class_test.result.regular.body", params);
    expect(rendered).toBe(expected);
    expect(rendered).toContain("আসসালামু আলাইকুম");
    expect(rendered).toContain("লক্ষণীয় দিক: ভগ্নাংশ");
    expect(rendered).toContain("জাযাকাল্লাহু খাইরান");
  });

  test("buildClassTestResultMessage picks excellent (no weakness) + absent variants", async () => {
    const test = { subject: "MATH", testNumber: 2, examDate: new Date(2026, 6, 10), totalMarks: 20 };
    const excellent = await buildClassTestResultMessage({ status: "PRESENT", marks: 20, weakness: null }, test, "করিম");
    expect(excellent.kind).toBe("excellent");
    expect(excellent.messageBn).toContain("আলহামদুলিল্লাহ");
    expect(excellent.messageBn).toContain("20/20");

    const absent = await buildClassTestResultMessage({ status: "ABSENT", marks: null }, test, "করিম");
    expect(absent.kind).toBe("absent");
    expect(absent.messageBn).toContain("অনুপস্থিত");
  });
});

// ===========================================================================
// publishResult / publishExam (J4)
// ===========================================================================

describe("publishResult", () => {
  test("stamps publishedAt + bumps version, delivers (wa.me + emit), audits PUBLISHED", async () => {
    mockResFindOneUpdate.mockResolvedValue(resultDoc({ publishedVersion: 1 }));
    const out = await publishResult(TEST_OID.toString(), STUDENT_OID.toString(), ACTOR);

    // $set publishedAt + $inc publishedVersion
    expect(mockResFindOneUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ testId: expect.anything(), studentId: expect.anything() }),
      expect.objectContaining({ $set: expect.objectContaining({ publishedAt: expect.any(Date) }), $inc: { publishedVersion: 1 } }),
      expect.objectContaining({ new: true }),
    );
    expect(out.recipients).toHaveLength(1);
    const r = out.recipients[0];
    expect(r.kind).toBe("regular"); // has weakness
    expect(r.waLink).toMatch(/^https:\/\/wa\.me\/01711000000\?text=/);
    expect(r.notifiedGuardianIds).toEqual([GUARDIAN_OID.toString()]);
    expect(out.unreachableCount).toBe(0);
    // emit got a v1 dedupeKey + the registered kind
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "CLASS_TEST_RESULT",
        dedupeKey: expect.stringMatching(/:v1$/),
        refs: expect.objectContaining({ classTestId: TEST_OID.toString(), studentId: STUDENT_OID.toString() }),
      }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "CLASS_TEST_RESULT_PUBLISHED" }));
  });

  test("a family with no phone is unreachable-by-wa but still gets the inbox emit", async () => {
    mockStudentFind.mockReturnValue(leanChain([{ _id: STUDENT_OID, nameBn: "করিম" }])); // no phone
    mockResFindOneUpdate.mockResolvedValue(resultDoc());
    const out = await publishResult(TEST_OID.toString(), STUDENT_OID.toString(), ACTOR);
    expect(out.recipients[0].waLink).toBeNull();
    expect(out.unreachableCount).toBe(1);
    expect(out.recipients[0].notifiedGuardianIds).toEqual([GUARDIAN_OID.toString()]);
  });

  test("RE-publish RE-notifies — the dedupeKey bumps v1 → v2 (D-#122)", async () => {
    mockResFindOneUpdate
      .mockResolvedValueOnce(resultDoc({ publishedVersion: 1 }))
      .mockResolvedValueOnce(resultDoc({ publishedVersion: 2 }));
    await publishResult(TEST_OID.toString(), STUDENT_OID.toString(), ACTOR);
    await publishResult(TEST_OID.toString(), STUDENT_OID.toString(), ACTOR);
    const keys = mockEmit.mock.calls.map((c) => (c[0] as { dedupeKey: string }).dedupeKey);
    expect(keys[0]).toMatch(/:v1$/);
    expect(keys[1]).toMatch(/:v2$/);
    expect(keys[0]).not.toBe(keys[1]); // distinct → emit can't swallow the republish
  });

  test("throws on a non-PRINTED exam, and when no result was entered", async () => {
    mockCtFindById.mockReturnValue(leanChain(printedTest({ status: "REQUESTED" })));
    await expect(publishResult(TEST_OID.toString(), STUDENT_OID.toString(), ACTOR)).rejects.toThrow(/printed \(official\)/);

    mockCtFindById.mockReturnValue(leanChain(printedTest()));
    mockResFindOneUpdate.mockResolvedValue(null);
    await expect(publishResult(TEST_OID.toString(), STUDENT_OID.toString(), ACTOR)).rejects.toThrow(/nothing to publish/);
  });
});

describe("publishExam (bulk)", () => {
  test("publishes every entered result; one audit row for the batch", async () => {
    const s2 = oid();
    mockResFind.mockReturnValue(leanChain([
      { _id: oid(), studentId: STUDENT_OID },
      { _id: oid(), studentId: s2 },
    ]));
    mockStudentFind.mockReturnValue(leanChain([
      { _id: STUDENT_OID, nameBn: "করিম", phone: "01711000000" },
      { _id: s2, nameBn: "রহিম" }, // no phone → unreachable
    ]));
    mockResFindByIdUpdate
      .mockResolvedValueOnce(resultDoc({ studentId: STUDENT_OID, publishedVersion: 1 }))
      .mockResolvedValueOnce(resultDoc({ studentId: s2, status: "ABSENT", marks: undefined, weakness: undefined, publishedVersion: 1 }));

    const out = await publishExam(TEST_OID.toString(), ACTOR);
    expect(out.recipients).toHaveLength(2);
    expect(out.unreachableCount).toBe(1);
    expect(out.recipients[1].kind).toBe("absent");
    const audits = mockWriteAudit.mock.calls.filter((c) => (c[0] as { eventKind: string }).eventKind === "CLASS_TEST_RESULT_PUBLISHED");
    expect(audits).toHaveLength(1);
    expect((audits[0][0] as { meta: { mode: string } }).meta.mode).toBe("exam");
  });

  test("throws when no results are entered for the exam", async () => {
    mockResFind.mockReturnValue(leanChain([]));
    await expect(publishExam(TEST_OID.toString(), ACTOR)).rejects.toThrow(/nothing to publish/);
  });
});

// ===========================================================================
// unpublishResult / unpublishExam (J4)
// ===========================================================================

describe("unpublish", () => {
  test("unpublishResult clears publishedAt (version untouched), audits UNPUBLISHED", async () => {
    mockResFindOneUpdate.mockResolvedValue(resultDoc({ publishedAt: null }));
    const out = await unpublishResult(TEST_OID.toString(), STUDENT_OID.toString(), ACTOR);
    expect(out.unpublishedCount).toBe(1);
    expect(mockResFindOneUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ publishedAt: { $ne: null } }),
      { $set: { publishedAt: null } },
      expect.objectContaining({ new: true }),
    );
    // NO $inc on publishedVersion (kept so the next publish bumps it → re-notify)
    const update = mockResFindOneUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(update.$inc).toBeUndefined();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "CLASS_TEST_RESULT_UNPUBLISHED" }));
    expect(mockEmit).not.toHaveBeenCalled(); // unpublish never delivers
  });

  test("unpublishResult throws when the result is not published", async () => {
    mockResFindOneUpdate.mockResolvedValue(null);
    await expect(unpublishResult(TEST_OID.toString(), STUDENT_OID.toString(), ACTOR)).rejects.toBeInstanceOf(ClassTestResultError);
  });

  test("unpublishExam clears all published rows + reports the count", async () => {
    mockResUpdateMany.mockResolvedValue({ modifiedCount: 3 });
    const out = await unpublishExam(TEST_OID.toString(), ACTOR);
    expect(out.unpublishedCount).toBe(3);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "CLASS_TEST_RESULT_UNPUBLISHED" }));
  });
});

// ===========================================================================
// childTestResults (J7 / D-#68) — guardian read: published-only, no teacherAction
// ===========================================================================

describe("childTestResults", () => {
  test("returns only PUBLISHED results, derives percent/pass, and NEVER exposes teacherAction", async () => {
    mockResFind.mockReturnValue(leanChain([
      { testId: TEST_OID, studentId: STUDENT_OID, status: "PRESENT", marks: 15, weakness: "ভগ্নাংশ", teacherAction: "SECRET-internal", guardianAction: "অনুশীলন", publishedAt: new Date(2026, 6, 11) },
    ]));
    mockCtFind.mockReturnValue(leanChain([printedTest()]));

    const rows = await childTestResults(STUDENT_OID.toString());
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({ status: "PRESENT", marks: 15, totalMarks: 20, percent: 75, pass: true });
    expect(r.weakness).toBe("ভগ্নাংশ");
    expect(r.guardianAction).toBe("অনুশীলন");
    // teacherAction must be structurally absent from the guardian shape (J7)
    expect("teacherAction" in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain("SECRET-internal");
  });

  test("filters out the query is published-only (find query carries publishedAt $ne null)", async () => {
    mockResFind.mockReturnValue(leanChain([]));
    mockCtFind.mockReturnValue(leanChain([]));
    const rows = await childTestResults(STUDENT_OID.toString());
    expect(rows).toEqual([]);
    expect(mockResFind).toHaveBeenCalledWith(expect.objectContaining({ publishedAt: { $ne: null } }));
  });

  test("ABSENT published result carries null marks/percent/pass", async () => {
    mockResFind.mockReturnValue(leanChain([
      { testId: TEST_OID, studentId: STUDENT_OID, status: "ABSENT", publishedAt: new Date(2026, 6, 11) },
    ]));
    mockCtFind.mockReturnValue(leanChain([printedTest()]));
    const rows = await childTestResults(STUDENT_OID.toString());
    expect(rows[0]).toMatchObject({ status: "ABSENT", marks: null, percent: null, pass: null });
  });
});
