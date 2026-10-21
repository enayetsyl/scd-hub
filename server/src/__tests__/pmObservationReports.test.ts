/**
 * PM sweep — observation, comments & reports area (docs/permission-catalogue/
 * observation-comments-reports.md). The role bypasses these features used
 * (isAdminStaff, primary role PRINCIPAL/TEACHER, roster:manage "manager") are now
 * catalogue actions. Each test pins both halves of the rule:
 *   - ship day: with no edits, every default login decides exactly as before;
 *   - the switch works: Office with the action turned off is refused, a teacher
 *     granted it per person passes.
 * DB-free: models are mocked; a teacher has no scope anywhere.
 */
import { roleHasPermission, setRoleTemplateOverrides, ROLES, type Permission } from "@scd/shared";

jest.mock("../modules/foundation/services/ScopeGrantService", () => ({
  composeTeacherScope: async () => ({ scopes: [], expiredProxyGrantIds: [] }),
  canRead: () => false,
  canWrite: () => false,
  delegationNeedsClassId: () => false,
  stampProxyExpired: async () => undefined,
  proxyWindowEnd: () => new Date(),
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: {
    findById: () => ({
      select: () => ({ lean: async () => ({ classId: { toString: () => "64b000000000000000000002" } }) }),
      lean: async () => ({ classId: { toString: () => "64b000000000000000000002" } }),
    }),
  },
}));
jest.mock("../modules/comments/models/StudentComment", () => ({
  StudentComment: {
    findById: () => ({
      select: () => ({
        lean: async () => ({
          authorUserId: { toString: () => "u-author" },
          studentId: { toString: () => "64b000000000000000000003" },
          deliveredAt: null,
        }),
      }),
    }),
  },
}));

import {
  assertMonthlyReportRead,
  canOverrideMonthly,
  requireMonthly,
  seesMonthlyFees,
} from "../modules/reports/services/monthlyReportGate";
import { assertCanGenerate } from "../modules/worksheets/services/WorksheetService";
import { teachingNoteVisibility } from "../modules/teaching-notes/services/TeachingNoteService";
import { allowedEnglishDriveClassLevels } from "../modules/english-drive/services/EnglishDriveService";
import { assertCommentFileReadAccess } from "../modules/comments/services/CommentFileService";

const ctx = (role: string, extra: Record<string, unknown> = {}) =>
  ({ auth: { role, userId: `u-${role}`, ...extra } }) as never;
const SEC = "64b000000000000000000001";

afterEach(() => setRoleTemplateOverrides({}));

// ---------------------------------------------------------------------------
// Ship day: each re-gated action's default holders = who passed the old gate
// ---------------------------------------------------------------------------
describe("default holders reproduce the old gates", () => {
  const holders = (p: Permission) => ROLES.filter((r) => roleHasPermission(r, p)).sort();
  test.each<[Permission, string[]]>([
    // PRINCIPAL-only powers that rode the PRINCIPAL role
    ["classroom_observation:set_quota", ["PRINCIPAL"]],
    ["monthly_report:override", ["PRINCIPAL"]],
    ["monthly_report:revoke", ["PRINCIPAL"]],
    ["monthly_report:settings", ["PRINCIPAL"]],
    // assertRelease (report:release ∧ isAdminStaff) → Principal + Office
    ["monthly_report:view_all", ["OFFICE", "PRINCIPAL"]],
    ["monthly_report:create", ["OFFICE", "PRINCIPAL"]],
    ["monthly_report:export", ["OFFICE", "PRINCIPAL"]],
    ["monthly_report:release", ["OFFICE", "PRINCIPAL"]],
    // roster:manage desks → Principal + Office
    ["student_comments:review", ["OFFICE", "PRINCIPAL"]],
    ["student_comments:send", ["OFFICE", "PRINCIPAL"]],
    ["parents_meeting:view", ["OFFICE", "PRINCIPAL"]],
    ["improvement_plan:view_all", ["OFFICE", "PRINCIPAL"]],
    ["improvement_plan:edit_all", ["OFFICE", "PRINCIPAL"]],
    ["teaching_notes:review", ["OFFICE", "PRINCIPAL"]],
    ["worksheets:edit_all", ["OFFICE", "PRINCIPAL"]],
    ["worksheets:settings", ["OFFICE", "PRINCIPAL"]],
    // observation:manage / :upload → Principal + Office
    ["classroom_observation:publish", ["OFFICE", "PRINCIPAL"]],
    ["classroom_observation:view_all", ["OFFICE", "PRINCIPAL"]],
    ["classroom_observation:view_reports", ["OFFICE", "PRINCIPAL"]],
    ["free_mixing_review:view_all", ["OFFICE", "PRINCIPAL"]],
    // tracker:write / authenticated-staff reads → teachers too
    ["student_comments:create", ["PRINCIPAL", "TEACHER"]],
    ["parents_meeting:write_notes", ["PRINCIPAL", "TEACHER"]],
    ["parents_meeting:view_brief", ["OFFICE", "PRINCIPAL", "TEACHER"]],
    ["worksheets:create", ["OFFICE", "PRINCIPAL", "TEACHER"]],
    ["teaching_notes:view", ["OFFICE", "PRINCIPAL", "TEACHER"]],
    ["english_drive:view", ["OFFICE", "PRINCIPAL", "TEACHER"]],
  ])("%s → %j", (perm, roles) => {
    expect(holders(perm)).toEqual(roles);
  });
});

// ---------------------------------------------------------------------------
// Monthly report
// ---------------------------------------------------------------------------
describe("monthly report gates", () => {
  test("override = Principal by default; a person's grant hands it to Office", () => {
    expect(canOverrideMonthly(ctx("PRINCIPAL"))).toBe(true);
    expect(canOverrideMonthly(ctx("OFFICE"))).toBe(false);
    expect(canOverrideMonthly(ctx("OFFICE", { grantedPermissions: ["monthly_report:override"] }))).toBe(true);
  });

  test("revoke / settings: Office refused by default, passes once the role is switched on", () => {
    expect(() => requireMonthly(ctx("OFFICE"), "monthly_report:revoke")).toThrow();
    expect(requireMonthly(ctx("PRINCIPAL"), "monthly_report:revoke")).toBe("u-PRINCIPAL");
    setRoleTemplateOverrides({ OFFICE: { granted: ["monthly_report:revoke"], revoked: [] } });
    expect(requireMonthly(ctx("OFFICE"), "monthly_report:revoke")).toBe("u-OFFICE");
  });

  test("the assertRelease role half is gone: a teacher granted release passes; Office switched off is refused", () => {
    expect(() => requireMonthly(ctx("TEACHER"), "monthly_report:release")).toThrow();
    expect(requireMonthly(ctx("TEACHER", { grantedPermissions: ["monthly_report:release"] }), "monthly_report:release")).toBe(
      "u-TEACHER",
    );
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["monthly_report:release"] } });
    expect(() => requireMonthly(ctx("OFFICE"), "monthly_report:release")).toThrow();
  });

  test("fee block: Office/Principal see it, a teacher does not (as before); it follows view_all", () => {
    expect(seesMonthlyFees(ctx("PRINCIPAL"))).toBe(true);
    expect(seesMonthlyFees(ctx("OFFICE"))).toBe(true);
    expect(seesMonthlyFees(ctx("TEACHER"))).toBe(false);
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["monthly_report:view_all"] } });
    expect(seesMonthlyFees(ctx("OFFICE"))).toBe(false);
  });

  test("staff read: Office unscoped by default; with view_all off it needs scope like a teacher", async () => {
    await expect(assertMonthlyReportRead(ctx("OFFICE"), SEC)).resolves.toBeUndefined();
    await expect(assertMonthlyReportRead(ctx("TEACHER"), SEC)).rejects.toThrow("Forbidden"); // no scope here
    await expect(
      assertMonthlyReportRead(ctx("TEACHER", { grantedPermissions: ["monthly_report:view_all"] }), SEC),
    ).resolves.toBeUndefined();
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["monthly_report:view_all"] } });
    await expect(assertMonthlyReportRead(ctx("OFFICE"), SEC)).rejects.toThrow("Forbidden");
    await expect(assertMonthlyReportRead(ctx("GUARDIAN"), SEC)).rejects.toThrow("Forbidden");
  });
});

// ---------------------------------------------------------------------------
// Worksheets / notes / English drive / comment files
// ---------------------------------------------------------------------------
describe("worksheets: make = worksheets:create", () => {
  test("teacher + Office pass by default; Office switched off is refused; guardian never", () => {
    expect(() => assertCanGenerate(ctx("TEACHER"))).not.toThrow();
    expect(() => assertCanGenerate(ctx("OFFICE"))).not.toThrow();
    expect(() => assertCanGenerate(ctx("GUARDIAN"))).toThrow();
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["worksheets:create"] } });
    expect(() => assertCanGenerate(ctx("OFFICE"))).toThrow();
  });
});

describe("teaching notes visibility: view_all = every pair (was isAdminStaff)", () => {
  test("Office/Principal unrestricted by default; a teacher granted view_all is too", async () => {
    await expect(teachingNoteVisibility(ctx("OFFICE"))).resolves.toBeNull();
    await expect(teachingNoteVisibility(ctx("PRINCIPAL"))).resolves.toBeNull();
    await expect(teachingNoteVisibility(ctx("TEACHER", { grantedPermissions: ["teaching_notes:view_all"] }))).resolves.toBeNull();
  });
  test("Office with view_all and view off is refused; a guardian always is", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["teaching_notes:view_all", "teaching_notes:view"] } });
    await expect(teachingNoteVisibility(ctx("OFFICE"))).rejects.toThrow();
    await expect(teachingNoteVisibility(ctx("GUARDIAN"))).rejects.toThrow();
  });
});

describe("English drive visibility: view_all = all levels (was isAdminStaff)", () => {
  test("Office unrestricted by default; switched off (view + view_all) it is refused", async () => {
    await expect(allowedEnglishDriveClassLevels(ctx("OFFICE"))).resolves.toBeNull();
    await expect(
      allowedEnglishDriveClassLevels(ctx("TEACHER", { grantedPermissions: ["english_drive:view_all"] })),
    ).resolves.toBeNull();
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["english_drive:view_all", "english_drive:view"] } });
    await expect(allowedEnglishDriveClassLevels(ctx("OFFICE"))).rejects.toThrow();
  });
});

describe("comment attachment read: the reviewer is student_comments:review (was isAdminStaff)", () => {
  const file = { studentCommentId: "64b000000000000000000004" } as never;
  test("Office reads an undelivered attachment by default; with review off it cannot", async () => {
    await expect(assertCommentFileReadAccess(ctx("OFFICE"), file)).resolves.toBeUndefined();
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["student_comments:review"] } });
    await expect(assertCommentFileReadAccess(ctx("OFFICE"), file)).rejects.toThrow();
  });
  test("a teacher (not the author) is refused; granted review per person, passes", async () => {
    await expect(assertCommentFileReadAccess(ctx("TEACHER"), file)).rejects.toThrow();
    await expect(
      assertCommentFileReadAccess(ctx("TEACHER", { grantedPermissions: ["student_comments:review"] }), file),
    ).resolves.toBeUndefined();
  });
});
