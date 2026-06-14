/**
 * CT-4 RBAC fix (D-#196) — the four class-test READ aggregates must gate
 * `{ authenticated: true }` (the gate helpers enforce access), NOT
 * `{ hasPermission: "tracker:read" }`. OFFICE reads the dashboard + reports (§6/§9)
 * but holds NO `tracker:read`, so the old scope rejected Office at the Pothos
 * scope-auth layer BEFORE the resolver's Principal/Office gate could run.
 *
 * This executes REAL GraphQL queries against the built schema with each role's
 * context, so the `scopeAuth.authScopes` layer (which uses the real permission map)
 * is exercised — the fix is what lets Office through. The aggregate SERVICE is mocked
 * (RBAC, not aggregation, is under test); authz + the Section/Student lookups the
 * teacher-scoping path needs are mocked too. The chase (message:dispatch) is unchanged
 * and already had OFFICE coverage — it is not retested here.
 *
 * DB-free.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();
const leanChain = (val: unknown) => ({ select: () => ({ lean: async () => val }) });

// --- mocks (before importing the resolver) ---------------------------------

// The aggregate service — canned returns; RBAC, not aggregation, is under test.
jest.mock("../modules/trackers/services/ClassTestSummaryService", () => ({
  reportsStatus: jest.fn(async () => []),
  principalDashboard: jest.fn(async () => ({
    logged: 3, complete: 1, inProgress: 1, notStarted: 1, overdue: 0,
    completionRatePct: 33, overdueByTeacher: [],
  })),
  classSubjectAnalysis: jest.fn(async () => ({ sectionId: "s", subject: "MATH", examCount: 2, students: [] })),
  studentProfile: jest.fn(async () => ({ studentId: "x", studentName: "করিম", results: [], bySubject: [] })),
  overdueChaseList: jest.fn(async () => ({ entries: [], unreachableCount: 0 })),
}));

class FakeForbidden extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}
// assertCanRead is the teacher section-scope check; mock it so an in-scope teacher
// passes and an out-of-scope teacher is denied.
const mockAssertCanRead = jest.fn();
jest.mock("../middleware/authz", () => ({
  ForbiddenError: FakeForbidden,
  assertCanRead: (...a: unknown[]) => mockAssertCanRead(...a),
}));

const mockSectionFindById = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => leanChain(mockSectionFindById(id)) },
}));
const mockStudentFindById = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findById: (id: unknown) => leanChain(mockStudentFindById(id)) },
}));

// Import the builder + register the CT-4 read fields on it (side-effect import).
import { builder } from "../schema";
import "../modules/trackers/resolvers/classTestSummary";

// graphql-js refuses an empty Mutation type; the resolver adds only queries, so
// give the singleton builder one throwaway mutation field before toSchema().
builder.mutationField("_rbacTestNoop", (t) => t.boolean({ resolve: () => true }));
const schema = builder.toSchema();

type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string | null): Ctx => ({ auth: role ? { role, userId: oid().toString() } : null });

const run = (source: string, role: string | null): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: ctxOf(role) }) as Promise<ExecutionResult>;

const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;
const ok = (r: ExecutionResult) => !r.errors || r.errors.length === 0;

const SECTION = oid().toString();
const STUDENT = oid().toString();

const Q = {
  reports: (sectionId?: string) =>
    sectionId
      ? `query { classTestReportsStatus(sectionId: "${sectionId}") { testId } }`
      : `query { classTestReportsStatus { testId } }`,
  dashboard: `query { classTestPrincipalDashboard { logged } }`,
  classSubject: `query { classTestClassSubjectAnalysis(sectionId: "${SECTION}", subject: "MATH") { examCount } }`,
  profile: `query { classTestStudentProfile(studentId: "${STUDENT}") { studentName } }`,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAssertCanRead.mockResolvedValue(undefined); // in-scope by default
  mockSectionFindById.mockReturnValue({ classId: oid() });
  mockStudentFindById.mockReturnValue({ sectionId: oid() });
});

// ===========================================================================
// OFFICE — the regression: previously locked out at scope-auth (no tracker:read)
// ===========================================================================

describe("OFFICE can now read the dashboard + all three reports (D-#196)", () => {
  test("classTestPrincipalDashboard", async () => {
    const r = await run(Q.dashboard, "OFFICE");
    expect(ok(r)).toBe(true);
    expect((r.data as { classTestPrincipalDashboard: { logged: number } }).classTestPrincipalDashboard.logged).toBe(3);
  });

  test("classTestReportsStatus (unscoped)", async () => {
    const r = await run(Q.reports(), "OFFICE");
    expect(ok(r)).toBe(true);
    expect(mockAssertCanRead).not.toHaveBeenCalled(); // P/O unscoped — no section check
  });

  test("classTestClassSubjectAnalysis", async () => {
    const r = await run(Q.classSubject, "OFFICE");
    expect(ok(r)).toBe(true);
    expect((r.data as { classTestClassSubjectAnalysis: { examCount: number } }).classTestClassSubjectAnalysis.examCount).toBe(2);
  });

  test("classTestStudentProfile (unscoped)", async () => {
    const r = await run(Q.profile, "OFFICE");
    expect(ok(r)).toBe(true);
    expect(mockStudentFindById).not.toHaveBeenCalled(); // P/O skip the student-section lookup
  });
});

// ===========================================================================
// PRINCIPAL — unscoped (spot check)
// ===========================================================================

describe("PRINCIPAL reads everything unscoped", () => {
  test("dashboard + reports", async () => {
    expect(ok(await run(Q.dashboard, "PRINCIPAL"))).toBe(true);
    expect(ok(await run(Q.reports(), "PRINCIPAL"))).toBe(true);
    expect(ok(await run(Q.profile, "PRINCIPAL"))).toBe(true);
  });
});

// ===========================================================================
// TEACHER — section-scoped on the reports; denied the school-wide dashboard
// ===========================================================================

describe("TEACHER is section-scoped on the reports", () => {
  test("a teacher reads a section they can read (assertCanRead passes)", async () => {
    const r = await run(Q.reports(SECTION), "TEACHER");
    expect(ok(r)).toBe(true);
    expect(mockAssertCanRead).toHaveBeenCalled();
  });

  test("a teacher is denied a section they cannot read (assertCanRead throws)", async () => {
    mockAssertCanRead.mockRejectedValue(new FakeForbidden());
    expect(denied(await run(Q.reports(SECTION), "TEACHER"))).toBe(true);
  });

  test("a teacher must scope reports — no sectionId is denied", async () => {
    expect(denied(await run(Q.reports(), "TEACHER"))).toBe(true);
  });

  test("a teacher is denied the school-wide Principal Dashboard (P/O only)", async () => {
    expect(denied(await run(Q.dashboard, "TEACHER"))).toBe(true);
  });
});

// ===========================================================================
// GUARDIAN (the role without tracker:read) + unauthenticated — denied everywhere
// ===========================================================================

describe("GUARDIAN and unauthenticated callers are denied", () => {
  test("GUARDIAN is denied all four reads", async () => {
    expect(denied(await run(Q.dashboard, "GUARDIAN"))).toBe(true);
    expect(denied(await run(Q.reports(SECTION), "GUARDIAN"))).toBe(true);
    expect(denied(await run(Q.classSubject, "GUARDIAN"))).toBe(true);
    expect(denied(await run(Q.profile, "GUARDIAN"))).toBe(true);
  });

  test("unauthenticated is denied all four reads (authScopes: authenticated)", async () => {
    expect(denied(await run(Q.dashboard, null))).toBe(true);
    expect(denied(await run(Q.reports(SECTION), null))).toBe(true);
    expect(denied(await run(Q.classSubject, null))).toBe(true);
    expect(denied(await run(Q.profile, null))).toBe(true);
  });
});
