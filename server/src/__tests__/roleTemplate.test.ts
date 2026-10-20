/**
 * PM role templates (docs/prd-permission-matrix.md §4.2/§7, J-PM1/J-PM2/J-PM4/J-PM8, D-#791/#792).
 *
 * The Principal switches a catalogue action on/off for a whole role. DB-free: the
 * RoleTemplateOverride / User models and writeAudit are mocked with in-memory stores.
 * Proves: the delta is relative to the code default; a write reaches the very next
 * permission check (no restart, no re-login); a person's own grant beats the role; LOCKED
 * and SELF are refused; legacy names are untouched; every change is audited.
 */
import {
  callerHasPermission,
  setRoleTemplateOverrides,
  getRoleTemplateOverrides,
  CATALOGUE_ROLE_DEFAULTS,
} from "@scd/shared";

const mockRows: Record<string, { role: string; granted: string[]; revoked: string[] }> = {};
const mockAudits: Array<Record<string, unknown>> = [];

jest.mock("../modules/access-control/models/RoleTemplateOverride", () => ({
  RoleTemplateOverride: {
    find: () => ({ lean: async () => Object.values(mockRows) }),
    findOneAndUpdate: async (q: { role: string }, u: { $set: { granted: string[]; revoked: string[] } }) => {
      mockRows[q.role] = { role: q.role, granted: [...u.$set.granted], revoked: [...u.$set.revoked] };
      return mockRows[q.role];
    },
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { countDocuments: async () => 23, findById: async () => null },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: async (a: Record<string, unknown>) => {
    mockAudits.push(a);
  },
}));

import {
  setRoleTemplatePermission,
  resetRoleTemplate,
  roleTemplates,
  loadRoleTemplateOverrides,
} from "../modules/access-control/services/RoleTemplateService";

const principal = { userId: "p1", role: "PRINCIPAL" };
const teacher = { role: "TEACHER" as const };

beforeEach(() => {
  for (const k of Object.keys(mockRows)) delete mockRows[k];
  mockAudits.length = 0;
  setRoleTemplateOverrides({});
});

test("J-PM1: switching Teacher Return off bites every teacher on the very next check", async () => {
  expect(callerHasPermission(teacher, "homework:return")).toBe(true);
  const shape = await setRoleTemplatePermission(principal, "TEACHER", "homework:return", false);
  expect(shape.revoked).toEqual(["homework:return"]);
  expect(shape.permissions).not.toContain("homework:return");
  expect(shape.userCount).toBe(23);
  expect(callerHasPermission(teacher, "homework:return")).toBe(false);
  expect(callerHasPermission(teacher, "homework:check")).toBe(true);
  // An unswept gate still naming the legacy permission answers exactly as before.
  expect(callerHasPermission(teacher, "tracker:write")).toBe(true);
});

test("J-PM2: a person's own grant beats the role switch", async () => {
  await setRoleTemplatePermission(principal, "TEACHER", "homework:return", false);
  expect(callerHasPermission({ ...teacher, grantedPermissions: ["homework:return"] }, "homework:return")).toBe(true);
});

test("the delta is relative to the code default: turning a default back on leaves no trace", async () => {
  await setRoleTemplatePermission(principal, "TEACHER", "homework:return", false);
  const back = await setRoleTemplatePermission(principal, "TEACHER", "homework:return", true);
  expect(back.granted).toEqual([]);
  expect(back.revoked).toEqual([]);
  const on = await setRoleTemplatePermission(principal, "OFFICE", "homework:check", true);
  expect(CATALOGUE_ROLE_DEFAULTS.OFFICE).not.toContain("homework:check");
  expect(on.granted).toEqual(["homework:check"]);
  expect(callerHasPermission({ role: "OFFICE" }, "homework:check")).toBe(true);
});

test("J-PM8: LOCKED, SELF, PRINCIPAL/GUARDIAN roles and unknown actions are refused in Bangla", async () => {
  await expect(setRoleTemplatePermission(principal, "OFFICE", "payroll:approve", true)).rejects.toThrow(/প্রধান শিক্ষক/);
  await expect(setRoleTemplatePermission(principal, "TEACHER", "leave:apply", false)).rejects.toThrow(/নিজের/);
  await expect(setRoleTemplatePermission(principal, "PRINCIPAL", "homework:check", false)).rejects.toThrow(/শিক্ষক ও অফিস/);
  await expect(setRoleTemplatePermission(principal, "GUARDIAN", "homework:view", true)).rejects.toThrow(/শিক্ষক ও অফিস/);
  await expect(setRoleTemplatePermission(principal, "TEACHER", "homework:fly", true)).rejects.toThrow(/অজানা/);
  await expect(setRoleTemplatePermission(principal, "OFFICE", "staff_logins:create", true)).rejects.toThrow(/নিরাপত্তা/);
  expect(mockAudits).toHaveLength(0);
});

test("every change is audited with prior + next delta and the affected login count", async () => {
  await setRoleTemplatePermission(principal, "TEACHER", "homework:return", false);
  await resetRoleTemplate(principal, "TEACHER");
  expect(mockAudits.map((a) => a.eventKind)).toEqual(["ROLE_TEMPLATE_CHANGED", "ROLE_TEMPLATE_CHANGED"]);
  expect(mockAudits[0].meta).toMatchObject({
    role: "TEACHER",
    change: "disable",
    permission: "homework:return",
    prior: { granted: [], revoked: [] },
    next: { granted: [], revoked: ["homework:return"] },
    affectedUsers: 23,
  });
  expect(mockAudits[1].meta).toMatchObject({ change: "reset", next: { granted: [], revoked: [] } });
  expect(callerHasPermission(teacher, "homework:return")).toBe(true);
});

test("loadRoleTemplateOverrides publishes stored rows and drops unknown strings", async () => {
  mockRows.OFFICE = { role: "OFFICE", granted: ["homework:check", "nonsense:x"], revoked: ["homework:delete"] };
  await loadRoleTemplateOverrides();
  expect(getRoleTemplateOverrides()).toEqual({ OFFICE: { granted: ["homework:check"], revoked: ["homework:delete"] } });
  expect(callerHasPermission({ role: "OFFICE" }, "homework:delete")).toBe(false);
  const shapes = await roleTemplates();
  expect(shapes.map((s) => s.role)).toEqual(["TEACHER", "OFFICE"]);
});
