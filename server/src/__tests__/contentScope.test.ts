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
import { setRoleTemplateOverrides } from "@scd/shared";

const teacherCtx = { auth: { role: "TEACHER", userId: "t1" } } as unknown as AppContext;

afterEach(() => setRoleTemplateOverrides({}));

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
  test("PRINCIPAL/OFFICE → all (default templates hold both view_all actions)", async () => {
    for (const role of ["PRINCIPAL", "OFFICE"]) {
      for (const perm of ["lesson_plans:view_all", "question_bank:view_all"] as const) {
        const scope = await buildContentScope({ auth: { role, userId: "p" } } as unknown as AppContext, perm);
        expect(scope.all).toBe(true);
      }
    }
    expect(mockResolveScopes).not.toHaveBeenCalled();
  });

  test("PM: the lift is the action — Office with it switched off falls back to grants", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["question_bank:view_all"] } });
    mockResolveScopes.mockResolvedValue([]);
    const ctx = { auth: { role: "OFFICE", userId: "o" } } as unknown as AppContext;
    expect((await buildContentScope(ctx, "question_bank:view_all")).all).toBe(false);
    expect(mockResolveScopes).toHaveBeenCalled();
    // The plan reads lift on their own action, untouched.
    expect((await buildContentScope(ctx, "lesson_plans:view_all")).all).toBe(true);
  });

  test("PM: a teacher granted lesson_plans:view_all per person sees every plan, not every question", async () => {
    const ctx = {
      auth: { role: "TEACHER", userId: "t2", grantedPermissions: ["lesson_plans:view_all"] },
    } as unknown as AppContext;
    expect((await buildContentScope(ctx, "lesson_plans:view_all")).all).toBe(true);
    mockResolveScopes.mockResolvedValue([]);
    expect((await buildContentScope(ctx, "question_bank:view_all")).all).toBe(false);
  });

  test("a default TEACHER holds neither lift; a GUARDIAN gets nothing", async () => {
    mockResolveScopes.mockResolvedValue([]);
    expect((await buildContentScope(teacherCtx, "lesson_plans:view_all")).all).toBe(false);
    expect((await buildContentScope(teacherCtx, "question_bank:view_all")).all).toBe(false);
    mockResolveScopes.mockClear();
    const guardian = { auth: { role: "GUARDIAN", userId: "g" } } as unknown as AppContext;
    expect((await buildContentScope(guardian, "lesson_plans:view_all")).all).toBe(false);
    expect(mockResolveScopes).not.toHaveBeenCalled();
  });

  test("teaching grant → exact (subject, class) pair only", async () => {
    mockResolveScopes.mockResolvedValue([{ kind: "teaching", subjectId: "sBAN", classId: "c5", sectionId: "x" }]);
    const scope = await buildContentScope(teacherCtx, "lesson_plans:view_all");
    expect(contentScopeAllows(scope, "BAN", 5)).toBe(true);
    expect(contentScopeAllows(scope, "BAN", 3)).toBe(false); // other class
    expect(contentScopeAllows(scope, "MATH", 5)).toBe(false); // other subject
  });

  test("active proxy WITH subject → that subject+class only (per-subject cover)", async () => {
    mockResolveScopes.mockResolvedValue([{ kind: "proxy", subjectId: "sMATH", classId: "c5", sectionId: "x", grantId: "g" }]);
    const scope = await buildContentScope(teacherCtx, "lesson_plans:view_all");
    expect(contentScopeAllows(scope, "MATH", 5)).toBe(true);
    expect(contentScopeAllows(scope, "BAN", 5)).toBe(false); // proxy is subject-scoped, not whole class
  });

  test("proxy WITHOUT subject → no content (non-content cover)", async () => {
    mockResolveScopes.mockResolvedValue([{ kind: "proxy", classId: "c5", sectionId: "x", grantId: "g" }]);
    const scope = await buildContentScope(teacherCtx, "lesson_plans:view_all");
    expect(contentScopeAllows(scope, "BAN", 5)).toBe(false);
    expect(contentScopeAllows(scope, "MATH", 5)).toBe(false);
  });

  test("supervisory whole_school → all; subject_dept → subject; grade_class → class", async () => {
    mockResolveScopes.mockResolvedValue([
      { kind: "supervisory", extent: "subject_dept", subjectId: "sBAN" },
      { kind: "supervisory", extent: "grade_class", classId: "c3" },
    ]);
    const scope = await buildContentScope(teacherCtx, "lesson_plans:view_all");
    expect(contentScopeAllows(scope, "BAN", 1)).toBe(true);  // subject_dept BAN, any class
    expect(contentScopeAllows(scope, "SCI", 3)).toBe(true);  // grade_class 3, any subject
    expect(contentScopeAllows(scope, "SCI", 1)).toBe(false);
  });
});
