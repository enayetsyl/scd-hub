/**
 * Delegated-scope tests (ACS-1 — D-#484..#489, docs/prd-access-control-scope.md).
 *
 * The feature in one line: a `delegation` grant lets one person do ONE NAMED DUTY
 * across a wider slice of the school than they teach. These tests pin the four
 * properties that make that safe:
 *
 *   1. ZERO MIGRATION — an untagged gate (no action named) is never satisfied by a
 *      delegation, so every pre-ACS-1 call site behaves exactly as before (D-#486).
 *   2. The ACTION is the grain — a declare delegation does not let you submit.
 *   3. The EXTENT is the reach — and the class-shaped extents fail CLOSED when the
 *      caller's class is unknown.
 *   4. Expiry is REQUEST-time (D-#488) — no cron, and the row survives.
 *
 * Pure-logic tests run with no DB; the `assertCanWrite` seam tests mock the two
 * models it touches (the established pattern in this suite).
 */

const mockGrantFind = jest.fn();
const mockSectionFindById = jest.fn();
const mockUserFindById = jest.fn();

jest.mock("../modules/foundation/models/ScopeGrant", () => ({
  ScopeGrant: {
    find: (f: unknown) => ({ lean: async () => mockGrantFind(f) }),
    findById: (id: unknown) => ({ lean: async () => null, then: undefined, _id: id }),
  },
}));
// Both call shapes: `.select(...).lean()` (assertCanWrite) and a bare `.lean()`
// (assertCanConfirmHomework).
jest.mock("../modules/foundation/models/Section", () => ({
  Section: {
    findById: (id: unknown) => ({
      select: () => ({ lean: async () => mockSectionFindById(id) }),
      lean: async () => mockSectionFindById(id),
    }),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    findById: (id: unknown) => ({ select: () => ({ lean: async () => mockUserFindById(id) }) }),
  },
}));

import {
  canRead,
  canWrite,
  delegationNeedsClassId,
  validateDelegationGrant,
  composeTeacherScope,
  type ScopeItem,
} from "../modules/foundation/services/ScopeGrantService";
import {
  assertCanWrite,
  assertCanWriteAny,
  assertCanConfirmHomework,
  ForbiddenError,
} from "../middleware/authz";
import { DELEGATED_ACTIONS, DELEGATED_ACTION_BUILD_STATUS } from "@scd/shared";
import type { AppContext } from "../context";

const SECTION_A = "sectionA";
const SECTION_B = "sectionB";
const CLASS_1 = "class1";
const CLASS_2 = "class2";
const SUBJ_BAN = "subjBAN";
const SUBJ_ENG = "subjENG";

function teachingScope(sectionId: string, classId: string, subjectId: string): ScopeItem {
  return { kind: "teaching", sectionId, classId, subjectId };
}

function delegationScope(
  extent: string,
  actions: string[],
  opts: { classId?: string; subjectId?: string; explicitSet?: Array<{ classId: string; subjectId: string }> } = {},
): ScopeItem {
  return { kind: "delegation", extent, actions, grantId: "d1", ...opts };
}

// ---------------------------------------------------------------------------
// 1. The zero-migration property — the whole seam rests on this
// ---------------------------------------------------------------------------

describe("canWrite + delegation: untagged gates are untouched (D-#486)", () => {
  const scopes = [delegationScope("whole_school", ["declare_assignment"])];

  test("a whole-school delegation does NOT satisfy a gate that names no action", () => {
    expect(canWrite(scopes, SECTION_A)).toBe(false);
    expect(canWrite(scopes, SECTION_A, SUBJ_ENG)).toBe(false);
  });

  test("it DOES satisfy the gate that names its action", () => {
    expect(canWrite(scopes, SECTION_A, SUBJ_ENG, { action: "declare_assignment" })).toBe(true);
  });

  test("an empty opts object is still 'no action named' — fails closed", () => {
    expect(canWrite(scopes, SECTION_A, SUBJ_ENG, {})).toBe(false);
  });

  test("a delegation never widens a teaching/proxy-only decision either way", () => {
    const mixed: ScopeItem[] = [teachingScope(SECTION_A, CLASS_1, SUBJ_BAN), ...scopes];
    expect(canWrite(mixed, SECTION_A, SUBJ_BAN)).toBe(true); // teaching, as before
    expect(canWrite(mixed, SECTION_B, SUBJ_BAN)).toBe(false); // untagged ⇒ delegation inert
  });
});

// ---------------------------------------------------------------------------
// 2. The action is the grain
// ---------------------------------------------------------------------------

describe("canWrite + delegation: the action allow-list is the grain", () => {
  test("a declare delegation does not authorize submitting (the owner's two cases stay separate)", () => {
    const tazkir = [delegationScope("whole_school", ["declare_assignment"])];
    expect(canWrite(tazkir, SECTION_A, SUBJ_ENG, { action: "declare_assignment" })).toBe(true);
    expect(canWrite(tazkir, SECTION_A, SUBJ_ENG, { action: "submit_homework" })).toBe(false);
  });

  test("a submit delegation does not authorize declaring", () => {
    const jerin = [delegationScope("whole_school", ["submit_homework"])];
    expect(canWrite(jerin, SECTION_A, SUBJ_ENG, { action: "submit_homework" })).toBe(true);
    expect(canWrite(jerin, SECTION_A, SUBJ_ENG, { action: "declare_assignment" })).toBe(false);
  });

  test("a multi-action grant authorizes each listed action and nothing else", () => {
    const scopes = [delegationScope("whole_school", ["declare_homework", "submit_homework"])];
    expect(canWrite(scopes, SECTION_A, SUBJ_BAN, { action: "declare_homework" })).toBe(true);
    expect(canWrite(scopes, SECTION_A, SUBJ_BAN, { action: "submit_homework" })).toBe(true);
    expect(canWrite(scopes, SECTION_A, SUBJ_BAN, { action: "check_homework" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. The extent is the reach
// ---------------------------------------------------------------------------

describe("canWrite + delegation: extent shapes", () => {
  const ACT = { action: "declare_homework" };

  test("whole_school reaches every section, with or without a class in hand", () => {
    const scopes = [delegationScope("whole_school", ["declare_homework"])];
    expect(canWrite(scopes, SECTION_A, SUBJ_BAN, ACT)).toBe(true);
    expect(canWrite(scopes, SECTION_B, SUBJ_ENG, { ...ACT, classId: CLASS_2 })).toBe(true);
  });

  test("grade_class reaches only its class — and needs the class to decide", () => {
    const scopes = [delegationScope("grade_class", ["declare_homework"], { classId: CLASS_1 })];
    expect(canWrite(scopes, SECTION_A, SUBJ_BAN, { ...ACT, classId: CLASS_1 })).toBe(true);
    expect(canWrite(scopes, SECTION_B, SUBJ_BAN, { ...ACT, classId: CLASS_2 })).toBe(false);
    // Fails CLOSED when the caller could not resolve the section's class.
    expect(canWrite(scopes, SECTION_A, SUBJ_BAN, ACT)).toBe(false);
  });

  test("subject_dept reaches only its subject, and needs the action to name one", () => {
    const scopes = [delegationScope("subject_dept", ["declare_homework"], { subjectId: SUBJ_BAN })];
    expect(canWrite(scopes, SECTION_A, SUBJ_BAN, ACT)).toBe(true);
    expect(canWrite(scopes, SECTION_A, SUBJ_ENG, ACT)).toBe(false);
    expect(canWrite(scopes, SECTION_A, undefined, ACT)).toBe(false);
  });

  test("explicit_set reaches only its (class, subject) pairs", () => {
    const scopes = [
      delegationScope("explicit_set", ["declare_homework"], {
        explicitSet: [{ classId: CLASS_1, subjectId: SUBJ_BAN }],
      }),
    ];
    expect(canWrite(scopes, SECTION_A, SUBJ_BAN, { ...ACT, classId: CLASS_1 })).toBe(true);
    expect(canWrite(scopes, SECTION_A, SUBJ_ENG, { ...ACT, classId: CLASS_1 })).toBe(false);
    expect(canWrite(scopes, SECTION_B, SUBJ_BAN, { ...ACT, classId: CLASS_2 })).toBe(false);
  });

  test("delegationNeedsClassId is true only for the class-shaped extents (the lazy-lookup guard)", () => {
    const whole = [delegationScope("whole_school", ["declare_homework"])];
    const grade = [delegationScope("grade_class", ["declare_homework"], { classId: CLASS_1 })];
    const dept = [delegationScope("subject_dept", ["declare_homework"], { subjectId: SUBJ_BAN })];
    const set = [delegationScope("explicit_set", ["declare_homework"], { explicitSet: [] })];
    expect(delegationNeedsClassId(whole, "declare_homework")).toBe(false);
    expect(delegationNeedsClassId(dept, "declare_homework")).toBe(false);
    expect(delegationNeedsClassId(grade, "declare_homework")).toBe(true);
    expect(delegationNeedsClassId(set, "declare_homework")).toBe(true);
    // A different action, or no action at all, needs no lookup.
    expect(delegationNeedsClassId(grade, "submit_homework")).toBe(false);
    expect(delegationNeedsClassId(grade, undefined)).toBe(false);
  });
});

describe("canRead + delegation: read rides the extent (D-#485)", () => {
  test("a submit delegation grants READ over its extent — you cannot submit what you cannot see", () => {
    const scopes = [delegationScope("whole_school", ["submit_homework"])];
    expect(canRead(scopes, SECTION_B, CLASS_2, SUBJ_ENG)).toBe(true);
  });

  test("read follows the same extent shapes as supervisory", () => {
    const grade = [delegationScope("grade_class", ["submit_homework"], { classId: CLASS_1 })];
    expect(canRead(grade, SECTION_A, CLASS_1)).toBe(true);
    expect(canRead(grade, SECTION_B, CLASS_2)).toBe(false);
  });

  test("read does NOT require the action to be named (it is not an action gate)", () => {
    const scopes = [delegationScope("subject_dept", ["submit_homework"], { subjectId: SUBJ_BAN })];
    expect(canRead(scopes, SECTION_A, CLASS_1, SUBJ_BAN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Request-time expiry + composition
// ---------------------------------------------------------------------------

describe("composeTeacherScope + delegation (D-#488 request-time expiry)", () => {
  const base = {
    _id: "d1",
    kind: "delegation",
    active: true,
    extent: "whole_school",
    actions: ["declare_assignment"],
  };
  const NOW = new Date("2026-08-15T10:00:00+06:00");

  beforeEach(() => {
    mockGrantFind.mockReset();
  });

  test("an unexpired delegation composes into the scope union", async () => {
    mockGrantFind.mockResolvedValue([{ ...base, expiresAt: new Date("2026-12-31T00:00:00+06:00") }]);
    const { scopes } = await composeTeacherScope("teacher-1", NOW);
    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toMatchObject({ kind: "delegation", actions: ["declare_assignment"] });
  });

  test("an open-ended delegation (no expiry) composes", async () => {
    mockGrantFind.mockResolvedValue([{ ...base }]);
    const { scopes } = await composeTeacherScope("teacher-1", NOW);
    expect(scopes).toHaveLength(1);
  });

  test("a lapsed delegation is inert with NO cron having run", async () => {
    mockGrantFind.mockResolvedValue([{ ...base, expiresAt: new Date("2026-08-14T23:59:00+06:00") }]);
    const { scopes } = await composeTeacherScope("teacher-1", NOW);
    expect(scopes).toHaveLength(0);
  });

  test("a malformed delegation (no actions) is dropped rather than trusted", async () => {
    mockGrantFind.mockResolvedValue([{ ...base, actions: [] }]);
    const { scopes } = await composeTeacherScope("teacher-1", NOW);
    expect(scopes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Grant validation
// ---------------------------------------------------------------------------

describe("validateDelegationGrant (§4.1)", () => {
  const OK = ["declare_homework"];

  test("a valid whole-school grant passes", () => {
    expect(validateDelegationGrant({ extent: "whole_school", actions: OK })).toBeNull();
  });

  test("the extent rules are the supervisory rules", () => {
    expect(validateDelegationGrant({ extent: "subject_dept", actions: OK })).toMatch(/subject/);
    expect(validateDelegationGrant({ extent: "grade_class", actions: OK })).toMatch(/class/);
    expect(validateDelegationGrant({ extent: "galaxy", actions: OK })).toMatch(/unknown/);
  });

  test("at least one action is required — an extent alone grants nothing", () => {
    expect(validateDelegationGrant({ extent: "whole_school", actions: [] })).toMatch(/at least one action/);
    expect(validateDelegationGrant({ extent: "whole_school" })).toMatch(/at least one action/);
  });

  test("an unknown action is refused", () => {
    expect(validateDelegationGrant({ extent: "whole_school", actions: ["run_the_school"] })).toMatch(/unknown delegated action/);
  });

  // The silent-no-op guard (D-#486): a pipeline action has no tagged call site, so
  // granting it would change nothing while looking granted. After ACS-3 every declared
  // action IS tagged, so the guard has no live instance left to refuse — what is
  // asserted here is that fact itself. If a future action lands as `pipeline`, this
  // test fails and the guard's refusal branch becomes reachable again.
  test("every declared action is currently grantable — no pipeline action remains after ACS-3", () => {
    for (const a of DELEGATED_ACTIONS) {
      expect(DELEGATED_ACTION_BUILD_STATUS[a]).toBe("build");
      expect(validateDelegationGrant({ extent: "whole_school", actions: [a] })).toBeNull();
    }
  });

  test("an already-past expiry is refused", () => {
    expect(validateDelegationGrant({ extent: "whole_school", actions: OK, expiresAt: new Date("2000-01-01") })).toMatch(/future/);
  });
});

// ---------------------------------------------------------------------------
// 6. The real seam: assertCanWrite (with the lazy Section lookup)
// ---------------------------------------------------------------------------

describe("assertCanWrite + delegation (the tagged-gate seam)", () => {
  const ctx = { auth: { userId: "tazkir", role: "TEACHER" } } as unknown as AppContext;

  beforeEach(() => {
    mockGrantFind.mockReset();
    mockSectionFindById.mockReset();
  });

  test("J-ACS1: a whole-school declare_assignment delegation passes the tagged gate", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "whole_school", actions: ["declare_assignment"] },
    ]);
    await expect(
      assertCanWrite(ctx, SECTION_B, SUBJ_ENG, "declare_assignment"),
    ).resolves.toBeUndefined();
    // whole_school needs no class — the extra lookup never happens.
    expect(mockSectionFindById).not.toHaveBeenCalled();
  });

  test("the same person is still refused on an UNTAGGED gate (zero migration, J-ACS4)", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "whole_school", actions: ["declare_assignment"] },
    ]);
    await expect(assertCanWrite(ctx, SECTION_B, SUBJ_ENG)).rejects.toThrow(ForbiddenError);
  });

  test("and refused on a gate naming a duty they were not given", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "whole_school", actions: ["declare_assignment"] },
    ]);
    await expect(
      assertCanWrite(ctx, SECTION_B, SUBJ_ENG, "submit_homework"),
    ).rejects.toThrow(ForbiddenError);
  });

  test("J-ACS3: grade_class resolves the section's class lazily — matching class passes", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "grade_class", classId: CLASS_1, actions: ["declare_homework"] },
    ]);
    mockSectionFindById.mockResolvedValue({ classId: CLASS_1 });
    await expect(
      assertCanWrite(ctx, SECTION_A, SUBJ_BAN, "declare_homework"),
    ).resolves.toBeUndefined();
    expect(mockSectionFindById).toHaveBeenCalledWith(SECTION_A);
  });

  test("J-ACS3: a section in another class is refused", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "grade_class", classId: CLASS_1, actions: ["declare_homework"] },
    ]);
    mockSectionFindById.mockResolvedValue({ classId: CLASS_2 });
    await expect(
      assertCanWrite(ctx, SECTION_B, SUBJ_BAN, "declare_homework"),
    ).rejects.toThrow(ForbiddenError);
  });

  test("a missing section fails CLOSED rather than passing on an unknown class", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "grade_class", classId: CLASS_1, actions: ["declare_homework"] },
    ]);
    mockSectionFindById.mockResolvedValue(null);
    await expect(
      assertCanWrite(ctx, SECTION_A, SUBJ_BAN, "declare_homework"),
    ).rejects.toThrow(ForbiddenError);
  });

  test("a teacher with NO delegation pays no extra query for the feature", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "t1", kind: "teaching", active: true, classId: CLASS_1, sectionId: SECTION_A, subjectId: SUBJ_BAN },
    ]);
    await expect(
      assertCanWrite(ctx, SECTION_A, SUBJ_BAN, "declare_homework"),
    ).resolves.toBeUndefined();
    expect(mockSectionFindById).not.toHaveBeenCalled();
  });

  test("ACS-3: a check delegation passes the check gates but not the declare ones", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "whole_school", actions: ["check_homework"] },
    ]);
    await expect(assertCanWrite(ctx, SECTION_B, SUBJ_ENG, "check_homework")).resolves.toBeUndefined();
    await expect(assertCanWrite(ctx, SECTION_B, SUBJ_ENG, "check_assignment")).rejects.toThrow(ForbiddenError);
    await expect(assertCanWrite(ctx, SECTION_B, SUBJ_ENG, "declare_homework")).rejects.toThrow(ForbiddenError);
  });

  test("a lapsed delegation is refused at the gate (D-#488)", async () => {
    mockGrantFind.mockResolvedValue([
      {
        _id: "d1",
        kind: "delegation",
        active: true,
        extent: "whole_school",
        actions: ["declare_assignment"],
        expiresAt: new Date(Date.now() - 60_000),
      },
    ]);
    await expect(
      assertCanWrite(ctx, SECTION_B, SUBJ_ENG, "declare_assignment"),
    ).rejects.toThrow(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// 7. ACS-3: the boolean-flag fold (D-#489) — old flag OR new grant
// ---------------------------------------------------------------------------

describe("assertCanConfirmHomework + delegation (the ACS-3 fold)", () => {
  const ctx = { auth: { userId: "jerin", role: "TEACHER" } } as unknown as AppContext;

  beforeEach(() => {
    mockGrantFind.mockReset();
    mockSectionFindById.mockReset();
    mockUserFindById.mockReset();
    mockGrantFind.mockResolvedValue([]);
    mockUserFindById.mockResolvedValue({});
  });

  test("UNCHANGED: the section's class teacher still passes, with no grant in sight", async () => {
    mockSectionFindById.mockResolvedValue({ classId: CLASS_1, classTeacherId: "jerin" });
    await expect(assertCanConfirmHomework(ctx, SECTION_A)).resolves.toBeUndefined();
    expect(mockGrantFind).not.toHaveBeenCalled(); // the old paths short-circuit first
  });

  test("UNCHANGED: the per-section homework delegate still passes", async () => {
    mockSectionFindById.mockResolvedValue({ classId: CLASS_1, homeworkConfirmerId: "jerin" });
    await expect(assertCanConfirmHomework(ctx, SECTION_A)).resolves.toBeUndefined();
  });

  test("UNCHANGED: the school-wide homeworkSupervisor boolean still passes (no migration needed)", async () => {
    mockSectionFindById.mockResolvedValue({ classId: CLASS_1 });
    mockUserFindById.mockResolvedValue({ homeworkSupervisor: true });
    await expect(assertCanConfirmHomework(ctx, SECTION_A)).resolves.toBeUndefined();
  });

  test("NEW: a confirm_homework_day delegation passes the same gate", async () => {
    mockSectionFindById.mockResolvedValue({ classId: CLASS_1 });
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "whole_school", actions: ["confirm_homework_day"] },
    ]);
    await expect(assertCanConfirmHomework(ctx, SECTION_A)).resolves.toBeUndefined();
  });

  test("NEW: a grade_class confirm delegation reaches only its class", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "grade_class", classId: CLASS_1, actions: ["confirm_homework_day"] },
    ]);
    mockSectionFindById.mockResolvedValue({ classId: CLASS_1 });
    await expect(assertCanConfirmHomework(ctx, SECTION_A)).resolves.toBeUndefined();
    mockSectionFindById.mockResolvedValue({ classId: CLASS_2 });
    await expect(assertCanConfirmHomework(ctx, SECTION_B)).rejects.toThrow(ForbiddenError);
  });

  test("a delegation for a DIFFERENT duty does not confer the confirm gate", async () => {
    mockSectionFindById.mockResolvedValue({ classId: CLASS_1 });
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "whole_school", actions: ["declare_homework"] },
    ]);
    await expect(assertCanConfirmHomework(ctx, SECTION_A)).rejects.toThrow(ForbiddenError);
  });

  test("an ordinary teacher with none of the above is still refused", async () => {
    mockSectionFindById.mockResolvedValue({ classId: CLASS_1, classTeacherId: "someone-else" });
    await expect(assertCanConfirmHomework(ctx, SECTION_A)).rejects.toThrow(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// 8. ACS-4 (D-#592): the UNDO gate — any duty, because undo has no duty of its own
// ---------------------------------------------------------------------------

describe("assertCanWriteAny — the revert gate", () => {
  const ctx = { auth: { userId: "tazkir", role: "TEACHER" } } as unknown as AppContext;
  const HW_DUTIES = ["declare_homework", "submit_homework", "check_homework"] as const;

  beforeEach(() => {
    mockGrantFind.mockReset();
    mockSectionFindById.mockReset();
  });

  test("holding ANY ONE of the listed duties passes — the submit-only delegate can undo", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "whole_school", actions: ["submit_homework"] },
    ]);
    await expect(assertCanWriteAny(ctx, SECTION_B, SUBJ_ENG, HW_DUTIES)).resolves.toBeUndefined();
  });

  test("...and so can the check-only delegate", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "whole_school", actions: ["check_homework"] },
    ]);
    await expect(assertCanWriteAny(ctx, SECTION_B, SUBJ_ENG, HW_DUTIES)).resolves.toBeUndefined();
  });

  test("a delegation for the OTHER tracker does not open this one's undo", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "whole_school", actions: ["check_assignment"] },
    ]);
    await expect(assertCanWriteAny(ctx, SECTION_B, SUBJ_ENG, HW_DUTIES)).rejects.toThrow(ForbiddenError);
  });

  test("no grant at all is still refused", async () => {
    mockGrantFind.mockResolvedValue([]);
    await expect(assertCanWriteAny(ctx, SECTION_B, SUBJ_ENG, HW_DUTIES)).rejects.toThrow(ForbiddenError);
  });

  test("an ordinary teaching grant still passes, unchanged by the widening", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "t1", kind: "teaching", active: true, classId: CLASS_1, sectionId: SECTION_A, subjectId: SUBJ_BAN },
    ]);
    await expect(assertCanWriteAny(ctx, SECTION_A, SUBJ_BAN, HW_DUTIES)).resolves.toBeUndefined();
    // ...and NOT on a section they do not teach.
    await expect(assertCanWriteAny(ctx, SECTION_B, SUBJ_BAN, HW_DUTIES)).rejects.toThrow(ForbiddenError);
  });

  test("the class-shaped extent still fails closed, and costs ONE Section lookup for the whole list", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "grade_class", classId: CLASS_1, actions: ["check_homework"] },
    ]);
    mockSectionFindById.mockResolvedValue({ classId: CLASS_2 });
    await expect(assertCanWriteAny(ctx, SECTION_B, SUBJ_BAN, HW_DUTIES)).rejects.toThrow(ForbiddenError);
    expect(mockSectionFindById).toHaveBeenCalledTimes(1);
  });

  test("OFFICE and GUARDIAN are refused; PRINCIPAL passes — same posture as assertCanWrite", async () => {
    mockGrantFind.mockResolvedValue([]);
    const office = { auth: { userId: "o", role: "OFFICE" } } as unknown as AppContext;
    const guardian = { auth: { userId: "g", role: "GUARDIAN" } } as unknown as AppContext;
    const principal = { auth: { userId: "p", role: "PRINCIPAL" } } as unknown as AppContext;
    await expect(assertCanWriteAny(office, SECTION_A, SUBJ_BAN, HW_DUTIES)).rejects.toThrow(ForbiddenError);
    await expect(assertCanWriteAny(guardian, SECTION_A, SUBJ_BAN, HW_DUTIES)).rejects.toThrow(ForbiddenError);
    await expect(assertCanWriteAny(principal, SECTION_A, SUBJ_BAN, HW_DUTIES)).resolves.toBeUndefined();
  });

  test("an EMPTY action list is the plain pre-ACS-1 check — a delegation never satisfies it", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "d1", kind: "delegation", active: true, extent: "whole_school", actions: ["check_homework"] },
    ]);
    await expect(assertCanWriteAny(ctx, SECTION_B, SUBJ_ENG, [])).rejects.toThrow(ForbiddenError);
  });
});
