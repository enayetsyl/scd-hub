/**
 * Content read scope (D-#257) — a teacher sees content for (subject, classLevel) only where
 * a routine teaching/proxy or supervisory grant covers it. DB-free: resolveTeacherScopes +
 * Subject/Class models mocked.
 */
const mockResolveScopes = jest.fn();
jest.mock("../middleware/authz", () => ({ resolveTeacherScopes: (ctx: unknown) => mockResolveScopes(ctx) }));

const mockSubjectFind = jest.fn();
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { find: () => ({ select: () => ({ lean: () => mockSubjectFind() }) }) },
}));
const mockClassFind = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: () => ({ select: () => ({ lean: () => mockClassFind() }) }) },
}));

import { buildContentScope, contentScopeAllows } from "../modules/content/contentScope";
import type { AppContext } from "../context";

const teacherCtx = { auth: { role: "TEACHER", userId: "t1" } } as unknown as AppContext;

beforeEach(() => {
  jest.clearAllMocks();
  mockSubjectFind.mockResolvedValue([{ _id: "sBAN", code: "BAN" }, { _id: "sMATH", code: "MATH" }]);
  mockClassFind.mockResolvedValue([{ _id: "c5", level: 5 }, { _id: "c3", level: 3 }]);
});

describe("contentScopeAllows (pure)", () => {
  const scope = { all: false, subjects: new Set(["BAN"]), classLevels: new Set([3]), pairs: new Set(["MATH|5"]) };
  test("matches by subject_dept subject, grade_class level, and exact pair", () => {
    expect(contentScopeAllows(scope, "BAN", 1)).toBe(true);   // subject_dept BAN
    expect(contentScopeAllows(scope, "SCI", 3)).toBe(true);   // grade_class level 3
    expect(contentScopeAllows(scope, "MATH", 5)).toBe(true);  // exact pair
    expect(contentScopeAllows(scope, "MATH", 4)).toBe(false); // wrong class
    expect(contentScopeAllows(scope, "ENG", 5)).toBe(false);  // uncovered
  });
  test("all=true sees everything", () => {
    expect(contentScopeAllows({ all: true, subjects: new Set(), classLevels: new Set(), pairs: new Set() }, "X", 9)).toBe(true);
  });
});

describe("buildContentScope", () => {
  test("PRINCIPAL/OFFICE → all", async () => {
    const scope = await buildContentScope({ auth: { role: "PRINCIPAL", userId: "p" } } as unknown as AppContext);
    expect(scope.all).toBe(true);
    expect(mockResolveScopes).not.toHaveBeenCalled();
  });

  test("teaching grant → exact (subject, class) pair only", async () => {
    mockResolveScopes.mockResolvedValue([{ kind: "teaching", subjectId: "sBAN", classId: "c5", sectionId: "x" }]);
    const scope = await buildContentScope(teacherCtx);
    expect(contentScopeAllows(scope, "BAN", 5)).toBe(true);
    expect(contentScopeAllows(scope, "BAN", 3)).toBe(false); // other class
    expect(contentScopeAllows(scope, "MATH", 5)).toBe(false); // other subject
  });

  test("active proxy WITH subject → that subject+class only (per-subject cover)", async () => {
    mockResolveScopes.mockResolvedValue([{ kind: "proxy", subjectId: "sMATH", classId: "c5", sectionId: "x", grantId: "g" }]);
    const scope = await buildContentScope(teacherCtx);
    expect(contentScopeAllows(scope, "MATH", 5)).toBe(true);
    expect(contentScopeAllows(scope, "BAN", 5)).toBe(false); // proxy is subject-scoped, not whole class
  });

  test("proxy WITHOUT subject → no content (non-content cover)", async () => {
    mockResolveScopes.mockResolvedValue([{ kind: "proxy", classId: "c5", sectionId: "x", grantId: "g" }]);
    const scope = await buildContentScope(teacherCtx);
    expect(contentScopeAllows(scope, "BAN", 5)).toBe(false);
    expect(contentScopeAllows(scope, "MATH", 5)).toBe(false);
  });

  test("supervisory whole_school → all; subject_dept → subject; grade_class → class", async () => {
    mockResolveScopes.mockResolvedValue([
      { kind: "supervisory", extent: "subject_dept", subjectId: "sBAN" },
      { kind: "supervisory", extent: "grade_class", classId: "c3" },
    ]);
    const scope = await buildContentScope(teacherCtx);
    expect(contentScopeAllows(scope, "BAN", 1)).toBe(true);  // subject_dept BAN, any class
    expect(contentScopeAllows(scope, "SCI", 3)).toBe(true);  // grade_class 3, any subject
    expect(contentScopeAllows(scope, "SCI", 1)).toBe(false);
  });
});
