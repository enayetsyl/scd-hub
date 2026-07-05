/**
 * recordHomeworkOutcome RBAC/proxy-narrowing (HWG-1) — executes a real GraphQL query
 * against the built schema with each role's context, mirroring
 * classTestSummaryRbac.test.ts's pattern. The whole `homework.ts` resolver file's
 * dependency surface must be mocked to import it (it registers many fields on the
 * shared builder singleton) — RBAC, not aggregation, is under test here; the outcome
 * composition itself is covered by homeworkOutcome.test.ts.
 *
 * DB-free.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();
const leanChain = (val: unknown) => ({ select: () => ({ lean: async () => val }) });

// --- mocks (before importing the resolver) ---------------------------------

jest.mock("../modules/trackers/services/HomeworkService", () => ({
  declareHomeworkItem: jest.fn(),
  issueHomeworkItem: jest.fn(),
  transitionRecord: jest.fn(),
  listDailyItems: jest.fn(async () => []),
  listStudentRecords: jest.fn(async () => []),
  listOpenRecords: jest.fn(async () => []),
  listHomeworkTopics: jest.fn(async () => []),
}));
jest.mock("../modules/trackers/services/HomeworkReconciliationService", () => ({
  tallyDay: jest.fn(),
  getTrimCandidates: jest.fn(),
  applyTrim: jest.fn(),
  confirmHomeworkDay: jest.fn(),
}));
jest.mock("../modules/trackers/services/HomeworkResubmissionService", () => ({
  checkRecord: jest.fn(),
  getStudentDayLoad: jest.fn(),
}));
jest.mock("../modules/trackers/services/HomeworkSummaryService", () => ({
  homeworkSummary: jest.fn(),
  homeworkClassOverview: jest.fn(),
  resubmissionWatchList: jest.fn(),
  trimPatternFlags: jest.fn(),
  questionUsageFeed: jest.fn(),
}));

const mockRecordOutcome = jest.fn();
jest.mock("../modules/trackers/services/HomeworkOutcomeService", () => ({
  recordHomeworkOutcome: (...a: unknown[]) => mockRecordOutcome(...a),
}));

class FakeForbidden extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}
const mockAssertCanWrite = jest.fn();
jest.mock("../middleware/authz", () => ({
  ForbiddenError: FakeForbidden,
  assertCanWrite: (...a: unknown[]) => mockAssertCanWrite(...a),
  assertCanRead: jest.fn(),
  assertCanConfirmHomework: jest.fn(),
}));

const mockSubjectFindOne = jest.fn();
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { findOne: (f: unknown) => leanChain(mockSubjectFindOne(f)) },
}));

const mockItemFindById = jest.fn();
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { findById: (id: unknown) => leanChain(mockItemFindById(id)) },
}));

const mockRecFindById = jest.fn();
jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { findById: (id: unknown) => leanChain(mockRecFindById(id)) },
}));

// Import the builder + register the homework resolvers on it (side-effect import).
import { builder } from "../schema";
import "../modules/trackers/resolvers/homework";

const schema = builder.toSchema();

type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string | null): Ctx => ({ auth: role ? { role, userId: oid().toString() } : null });

const run = (source: string, role: string | null): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: ctxOf(role) }) as Promise<ExecutionResult>;

const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;
const ok = (r: ExecutionResult) => !r.errors || r.errors.length === 0;

const SECTION = oid().toString();
const RECORD = oid().toString();

const MUTATION = `mutation {
  recordHomeworkOutcome(sectionId: "${SECTION}", recordId: "${RECORD}", outcome: "CORRECT") {
    recordId
    state
  }
}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockRecFindById.mockReturnValue({ hwItemId: oid() });
  mockItemFindById.mockReturnValue({ subject: "MATH" });
  mockSubjectFindOne.mockReturnValue({ _id: oid() });
  mockAssertCanWrite.mockResolvedValue(undefined); // in-scope by default
  mockRecordOutcome.mockResolvedValue({
    kind: "checked",
    result: { recordId: RECORD, hwId: "HW-C1-MATH-0001", state: "CHECKED", result: "CORRECT", resubmission: null },
  });
});

describe("recordHomeworkOutcome — RBAC + proxy subject-narrowing", () => {
  test("an in-scope teacher succeeds; assertCanWrite is called with the resolved subjectId", async () => {
    const r = await run(MUTATION, "TEACHER");
    expect(ok(r)).toBe(true);
    expect(mockAssertCanWrite).toHaveBeenCalled();
    const [, sectionArg, subjectArg] = mockAssertCanWrite.mock.calls[0];
    expect(sectionArg).toBe(SECTION);
    expect(subjectArg).toBeTruthy();
  });

  test("a proxy teacher scoped to a different subject is denied (Bangla-safe deny)", async () => {
    mockAssertCanWrite.mockRejectedValue(new FakeForbidden());
    const r = await run(MUTATION, "TEACHER");
    expect(denied(r)).toBe(true);
    expect(mockRecordOutcome).not.toHaveBeenCalled();
  });

  test("an unauthenticated caller is denied before any gate/service runs", async () => {
    const r = await run(MUTATION, null);
    expect(denied(r)).toBe(true);
    expect(mockAssertCanWrite).not.toHaveBeenCalled();
    expect(mockRecordOutcome).not.toHaveBeenCalled();
  });

  test("a missing sectionId is denied at the schema/argument-validation layer", async () => {
    const badMutation = `mutation { recordHomeworkOutcome(recordId: "${RECORD}", outcome: "CORRECT") { recordId } }`;
    const r = await run(badMutation, "TEACHER");
    expect(denied(r)).toBe(true);
  });
});
