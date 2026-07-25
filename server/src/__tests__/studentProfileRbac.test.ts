/**
 * Student profile RBAC (SP-1, prd-student-profile §4, D-#357) — the two-tier gate,
 * executed through the REAL built schema so the Pothos scope-auth layer is exercised
 * with each role's context (the classTestSummaryRbac.test.ts posture).
 *
 * Tier 1 (`assertReportRead`) and the subject walk (`allowedSubjectCodesForSection`)
 * are mocked: their own semantics are covered by their own suites. What is pinned
 * HERE is the wiring only this feature owns —
 *
 *   · Principal/Office reach the panels (OFFICE holds no `tracker:read`, so an
 *     `authScopes: { hasPermission: … }` slip would lock the Office out — the D-#196
 *     regression);
 *   · a GUARDIAN is denied on both panels (they keep childTrajectory, D-#277);
 *   · an out-of-scope teacher is denied by tier 1;
 *   · an in-scope SUBJECT teacher is narrowed — the walk's codes reach the service;
 *   · a class teacher / supervisor (walk returns null) gets the FULL view;
 *   · the walk is called with `classTeacherOversight: true` — the D-#357 decision,
 *     the INVERSE of the D-#337 checking-queue call. A future copy-paste of the
 *     queue's `false` would silently blind the class teacher, so it is asserted;
 *   · an unknown studentId is refused before any panel query runs.
 *
 * DB-free.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();
const leanChain = (val: unknown) => ({ select: () => ({ lean: async () => val }) });

const emptyPanel = {
  studentId: "s", fromKey: "2026-07-01", toKey: "2026-07-31",
  fullView: true, subjectFilter: [] as string[],
  totals: {
    sheets: 0, records: 0, received: 0, absentAtIssue: 0, notReceivedStill: 0, submitted: 0,
    notSubmitted: 0, awaiting: 0, pendingChecking: 0, pendingReturn: 0, chased: 0, chaseTotal: 0,
    checked: 0, returned: 0, resubmissions: 0, correct: 0, partial: 0, wrong: 0,
    qualityPct: null, submissionPct: null, graded: 0, avgMarksPct: null,
  },
  bySubject: [], items: [],
};

const mockHomeworkPanel = jest.fn(async () => emptyPanel);
const mockAssignmentPanel = jest.fn(async () => emptyPanel);
jest.mock("../modules/trackers/services/StudentProfileService", () => ({
  studentHomeworkPanel: (...a: unknown[]) => mockHomeworkPanel(...(a as [])),
  studentAssignmentPanel: (...a: unknown[]) => mockAssignmentPanel(...(a as [])),
}));

class FakeForbidden extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}
const mockAllowedSubjects = jest.fn();
jest.mock("../middleware/authz", () => ({
  ForbiddenError: FakeForbidden,
  allowedSubjectCodesForSection: (...a: unknown[]) => mockAllowedSubjects(...a),
  // classTestSummary (imported for assertReportRead) pulls these in too.
  assertCanRead: jest.fn(async () => undefined),
  callerHasPermission: () => true,
}));

const mockAssertReportRead = jest.fn();
jest.mock("../modules/trackers/resolvers/classTestSummary", () => ({
  assertReportRead: (...a: unknown[]) => mockAssertReportRead(...a),
  StudentAnalyticsRef: undefined,
}));

const mockStudentFindById = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findById: (id: unknown) => leanChain(mockStudentFindById(id)) },
}));

import { builder } from "../schema";
import "../modules/trackers/resolvers/studentProfile";

builder.mutationField("_studentProfileRbacNoop", (t) => t.boolean({ resolve: () => true }));
const schema = builder.toSchema();

type Ctx = { auth: { role: string; userId: string } | null };
const USER = oid().toString();
const ctxOf = (role: string | null): Ctx => ({ auth: role ? { role, userId: USER } : null });

const run = (source: string, role: string | null): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: ctxOf(role) }) as Promise<ExecutionResult>;

const ok = (r: ExecutionResult) => !r.errors || r.errors.length === 0;
const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

const SECTION = oid();
const CLASS = oid();
const STUDENT = oid().toString();

const HW = `query { studentProfileHomework(studentId: "${STUDENT}", fromKey: "2026-07-01", toKey: "2026-07-31") { fullView subjectFilter totals { sheets } } }`;
const AS = `query { studentProfileAssignment(studentId: "${STUDENT}", fromKey: "2026-07-01", toKey: "2026-07-31") { fullView totals { sheets } } }`;

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks wipes CALLS, not implementations — restore the canned panels so a
  // per-test mockResolvedValue cannot leak into the next test.
  mockHomeworkPanel.mockResolvedValue(emptyPanel);
  mockAssignmentPanel.mockResolvedValue(emptyPanel);
  mockStudentFindById.mockReturnValue({ sectionId: SECTION, classId: CLASS });
  mockAssertReportRead.mockResolvedValue(undefined); // in scope by default
  mockAllowedSubjects.mockResolvedValue(null); // unrestricted by default
});

describe("tier 1 — who reaches the panels at all", () => {
  test.each(["PRINCIPAL", "OFFICE", "TEACHER"])("%s in scope is allowed", async (role) => {
    expect(ok(await run(HW, role))).toBe(true);
    expect(ok(await run(AS, role))).toBe(true);
  });

  test("GUARDIAN is denied on both panels", async () => {
    mockAssertReportRead.mockRejectedValue(new FakeForbidden());
    expect(denied(await run(HW, "GUARDIAN"))).toBe(true);
    expect(denied(await run(AS, "GUARDIAN"))).toBe(true);
    expect(mockHomeworkPanel).not.toHaveBeenCalled();
    expect(mockAssignmentPanel).not.toHaveBeenCalled();
  });

  test("unauthenticated is denied", async () => {
    expect(denied(await run(HW, null))).toBe(true);
  });

  test("a teacher with no scope on the student's section is denied by tier 1", async () => {
    mockAssertReportRead.mockRejectedValue(new FakeForbidden("সেকশন স্কোপ নেই"));
    const r = await run(HW, "TEACHER");
    expect(denied(r)).toBe(true);
    expect(mockAllowedSubjects).not.toHaveBeenCalled(); // never reaches tier 2
    expect(mockHomeworkPanel).not.toHaveBeenCalled();
  });

  test("an unknown studentId is refused before any panel read", async () => {
    mockStudentFindById.mockReturnValue(null);
    const r = await run(HW, "PRINCIPAL");
    expect(denied(r)).toBe(true);
    expect(mockAssertReportRead).not.toHaveBeenCalled();
    expect(mockHomeworkPanel).not.toHaveBeenCalled();
  });

  test("tier 1 is asserted against the STUDENT's own section, not a client argument", async () => {
    await run(HW, "TEACHER");
    expect(mockAssertReportRead).toHaveBeenCalledWith(expect.anything(), SECTION.toString());
  });
});

describe("tier 2 — subject narrowing (D-#357)", () => {
  test("the walk is called with classTeacherOversight TRUE (inverse of D-#337)", async () => {
    await run(HW, "TEACHER");
    expect(mockAllowedSubjects).toHaveBeenCalledWith(
      expect.anything(),
      SECTION.toString(),
      CLASS.toString(),
      { classTeacherOversight: true },
    );
  });

  test("a subject teacher is narrowed: the walk's codes reach the service", async () => {
    mockAllowedSubjects.mockResolvedValue(new Set(["ENG", "BAN"]));
    mockHomeworkPanel.mockResolvedValue({ ...emptyPanel, fullView: false, subjectFilter: ["ENG", "BAN"] });

    const r = await run(HW, "TEACHER");
    expect(ok(r)).toBe(true);
    expect(mockHomeworkPanel).toHaveBeenCalledWith(STUDENT, {
      fromKey: "2026-07-01",
      toKey: "2026-07-31",
      subjects: ["ENG", "BAN"],
    });
    const data = r.data as { studentProfileHomework: { fullView: boolean; subjectFilter: string[] } };
    expect(data.studentProfileHomework.fullView).toBe(false);
    expect(data.studentProfileHomework.subjectFilter).toEqual(["ENG", "BAN"]);
  });

  test("class teacher / supervisor (walk returns null) gets the FULL view", async () => {
    mockAllowedSubjects.mockResolvedValue(null);
    const r = await run(HW, "TEACHER");
    expect(ok(r)).toBe(true);
    expect(mockHomeworkPanel).toHaveBeenCalledWith(STUDENT, {
      fromKey: "2026-07-01",
      toKey: "2026-07-31",
      subjects: null,
    });
    expect((r.data as { studentProfileHomework: { fullView: boolean } }).studentProfileHomework.fullView).toBe(true);
  });

  test("a teacher who teaches nothing on the section gets an empty allow-list, not full view", async () => {
    mockAllowedSubjects.mockResolvedValue(new Set<string>());
    await run(HW, "TEACHER");
    expect(mockHomeworkPanel).toHaveBeenCalledWith(
      STUDENT,
      expect.objectContaining({ subjects: [] }),
    );
  });

  test("the assignment panel runs the identical gate", async () => {
    mockAllowedSubjects.mockResolvedValue(new Set(["MATH"]));
    await run(AS, "TEACHER");
    expect(mockAssertReportRead).toHaveBeenCalledWith(expect.anything(), SECTION.toString());
    expect(mockAllowedSubjects).toHaveBeenCalledWith(
      expect.anything(),
      SECTION.toString(),
      CLASS.toString(),
      { classTeacherOversight: true },
    );
    expect(mockAssignmentPanel).toHaveBeenCalledWith(
      STUDENT,
      expect.objectContaining({ subjects: ["MATH"] }),
    );
  });
});
