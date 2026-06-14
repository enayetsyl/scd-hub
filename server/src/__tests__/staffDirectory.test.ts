/**
 * HR-G2 staffDirectory (prd-hr §H8.2/H8.3, D-#216/#217) — the PII-free staff
 * directory read + the observableOnly supervisory narrowing.
 *
 * Executes REAL GraphQL queries against the built schema with each role's context,
 * so the `authenticated` gate + the in-resolver GUARDIAN deny + the real permission
 * map (isManager) are exercised; the real `listStaffDirectory` runs against mocked
 * models / scope / phone-join. Asserts:
 *   - GUARDIAN + unauthenticated denied;
 *   - the general list (observableOnly:false) returns every active staff (name-only),
 *     readable by a plain TEACHER (no permission) — discovery posture;
 *   - Principal/Office (manager) get everyone even with observableOnly:true;
 *   - a bounded supervisor (TEACHER) with observableOnly:true gets only the teachers
 *     in a (class, subject) cell their SUPERVISORY scope covers;
 *   - the teacher→StaffProfile hop is FAIL-CLOSED (a null phone-join ⇒ excluded);
 *   - no supervisory scope ⇒ empty observable subset;
 *   - the entry shape STRUCTURALLY omits sensitive fields (querying `nid` is invalid).
 *
 * DB-free.
 */
import mongoose from "mongoose";
import { graphql } from "graphql";
import type { ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();
const leanList = (val: unknown) => ({ lean: async () => val });

// --- mocks (before importing the resolver) ---------------------------------

const mockStaffFind = jest.fn();
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: { find: (q: unknown) => leanList(mockStaffFind(q)) },
}));

const mockSubjectFind = jest.fn();
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { find: () => leanList(mockSubjectFind()) },
}));

const mockSlotFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (q: unknown) => leanList(mockSlotFind(q)) },
}));

const mockComposeScope = jest.fn();
jest.mock("../modules/foundation/services/ScopeGrantService", () => ({
  composeTeacherScope: (...a: unknown[]) => mockComposeScope(...a),
}));

const mockResolveStaff = jest.fn();
jest.mock("../modules/hr/services/staffMatch", () => ({
  resolveStaffProfileForUser: (...a: unknown[]) => mockResolveStaff(...a),
}));

class FakeForbidden extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}
jest.mock("../middleware/authz", () => ({ ForbiddenError: FakeForbidden }));

// Import the builder + register the staffDirectory field (side-effect import).
import { builder } from "../schema";
import "../modules/hr/resolvers/staffDirectory";

builder.mutationField("_dirTestNoop", (t) => t.boolean({ resolve: () => true }));
const schema = builder.toSchema();

type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string | null, userId = oid().toString()): Ctx => ({
  auth: role ? { role, userId } : null,
});

const run = (source: string, ctx: Ctx): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: ctx }) as Promise<ExecutionResult>;

const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

const sp = (name: string, category = "teacher") => ({
  _id: oid(),
  name,
  nameBn: `${name}-bn`,
  designation: "Teacher",
  category,
  active: true,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockStaffFind.mockResolvedValue([]);
  mockSubjectFind.mockResolvedValue([]);
  mockSlotFind.mockResolvedValue([]);
  mockComposeScope.mockResolvedValue({ scopes: [], expiredProxyGrantIds: [] });
  mockResolveStaff.mockResolvedValue(null);
});

const Q = "query($o: Boolean){ staffDirectory(observableOnly: $o){ id name nameBn category } }";

describe("HR-G2 staffDirectory — gate", () => {
  test("unauthenticated is denied", async () => {
    const r = await graphql({ schema, source: Q, contextValue: ctxOf(null), variableValues: { o: false } });
    expect(denied(r)).toBe(true);
  });

  test("GUARDIAN is denied (staff-internal; walled login plane)", async () => {
    const r = await graphql({ schema, source: Q, contextValue: ctxOf("GUARDIAN"), variableValues: { o: false } });
    expect(denied(r)).toBe(true);
  });

  test("the entry shape structurally omits sensitive fields (nid not queryable)", async () => {
    const bad = "query{ staffDirectory{ id nid } }";
    const r = await run(bad, ctxOf("PRINCIPAL"));
    expect(denied(r)).toBe(true); // GraphQL validation: Cannot query field "nid"
  });
});

describe("HR-G2 staffDirectory — general list (observableOnly:false)", () => {
  test("a plain TEACHER (no permission) reads every active staff, name-only", async () => {
    mockStaffFind.mockResolvedValue([sp("Alice"), sp("Bob", "support")]);
    const r = await graphql({ schema, source: Q, contextValue: ctxOf("TEACHER"), variableValues: { o: false } });
    expect(denied(r)).toBe(false);
    const rows = (r.data as { staffDirectory: { name: string }[] }).staffDirectory;
    expect(rows.map((x) => x.name).sort()).toEqual(["Alice", "Bob"]);
    // observableOnly:false ⇒ the supervisory path is never consulted.
    expect(mockComposeScope).not.toHaveBeenCalled();
  });
});

describe("HR-G2 staffDirectory — observableOnly:true", () => {
  test("Principal/Office (manager) get everyone", async () => {
    mockStaffFind.mockResolvedValue([sp("Alice"), sp("Bob")]);
    for (const role of ["PRINCIPAL", "OFFICE"]) {
      const r = await graphql({ schema, source: Q, contextValue: ctxOf(role), variableValues: { o: true } });
      expect(denied(r)).toBe(false);
      expect((r.data as { staffDirectory: unknown[] }).staffDirectory).toHaveLength(2);
    }
    // Manager path returns the full list — no slot/scope reverse-join.
    expect(mockComposeScope).not.toHaveBeenCalled();
  });

  test("a bounded supervisor with NO supervisory scope sees nothing", async () => {
    mockComposeScope.mockResolvedValue({ scopes: [], expiredProxyGrantIds: [] });
    const r = await graphql({ schema, source: Q, contextValue: ctxOf("TEACHER"), variableValues: { o: true } });
    expect(denied(r)).toBe(false);
    expect((r.data as { staffDirectory: unknown[] }).staffDirectory).toHaveLength(0);
  });

  test("a supervisor gets only teachers in a covered (class) cell — fail-closed phone-join", async () => {
    const classA = oid().toString();
    const classB = oid().toString();
    const teacherA = oid().toString(); // assigned to classA (covered)
    const teacherB = oid().toString(); // assigned to classB (not covered)
    mockComposeScope.mockResolvedValue({
      scopes: [{ kind: "supervisory", extent: "grade_class", classId: classA }],
      expiredProxyGrantIds: [],
    });
    mockSubjectFind.mockResolvedValue([]); // subject mapping irrelevant for grade_class
    mockSlotFind.mockResolvedValue([
      { teacherId: { toString: () => teacherA }, classId: { toString: () => classA }, subject: "MATH" },
      { teacherId: { toString: () => teacherB }, classId: { toString: () => classB }, subject: "MATH" },
    ]);
    const profileA = sp("Alice");
    mockResolveStaff.mockImplementation(async (uid: string) => (uid === teacherA ? profileA : null));

    const r = await graphql({ schema, source: Q, contextValue: ctxOf("TEACHER"), variableValues: { o: true } });
    expect(denied(r)).toBe(false);
    const rows = (r.data as { staffDirectory: { name: string }[] }).staffDirectory;
    expect(rows.map((x) => x.name)).toEqual(["Alice"]);
    // teacherA was resolved; teacherB (uncovered) was never even phone-joined.
    expect(mockResolveStaff).toHaveBeenCalledWith(teacherA);
    expect(mockResolveStaff).not.toHaveBeenCalledWith(teacherB);
  });

  test("a covered teacher whose phone-join fails closed (null) is excluded", async () => {
    const classA = oid().toString();
    const teacherA = oid().toString();
    mockComposeScope.mockResolvedValue({
      scopes: [{ kind: "supervisory", extent: "grade_class", classId: classA }],
      expiredProxyGrantIds: [],
    });
    mockSlotFind.mockResolvedValue([
      { teacherId: { toString: () => teacherA }, classId: { toString: () => classA }, subject: "MATH" },
    ]);
    mockResolveStaff.mockResolvedValue(null); // ambiguous/shared phone ⇒ fail closed

    const r = await graphql({ schema, source: Q, contextValue: ctxOf("TEACHER"), variableValues: { o: true } });
    expect(denied(r)).toBe(false);
    expect((r.data as { staffDirectory: unknown[] }).staffDirectory).toHaveLength(0);
  });

  test("subject_dept supervisor matches via the slot subject→Subject._id mapping", async () => {
    const mathId = oid().toString();
    const teacherM = oid().toString();
    mockComposeScope.mockResolvedValue({
      scopes: [{ kind: "supervisory", extent: "subject_dept", subjectId: mathId }],
      expiredProxyGrantIds: [],
    });
    mockSubjectFind.mockResolvedValue([{ _id: { toString: () => mathId }, code: "MATH" }]);
    mockSlotFind.mockResolvedValue([
      { teacherId: { toString: () => teacherM }, classId: { toString: () => oid().toString() }, subject: "MATH" },
      { teacherId: { toString: () => oid().toString() }, classId: { toString: () => oid().toString() }, subject: "ENG" },
    ]);
    const profileM = sp("Mahmud");
    mockResolveStaff.mockImplementation(async (uid: string) => (uid === teacherM ? profileM : null));

    const r = await graphql({ schema, source: Q, contextValue: ctxOf("TEACHER"), variableValues: { o: true } });
    const rows = (r.data as { staffDirectory: { name: string }[] }).staffDirectory;
    expect(rows.map((x) => x.name)).toEqual(["Mahmud"]);
  });
});
