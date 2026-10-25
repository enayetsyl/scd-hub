/**
 * PM sweep — attendance / class-load / Saturday-revision gates (D-#790–#801).
 *
 * The role bypasses these resolvers used (attendance:manage on the class-teacher and
 * marker-of-the-day read gates, isAdminStaff on the class-load and revision reads, the
 * revision config) are now catalogue actions. Checked here through the real schema:
 *   - default Office still passes (ship day changes nobody's access);
 *   - Office with the action switched off (role edit) is refused;
 *   - a Teacher granted the action per person passes without the designation.
 * DB-free: services auto-mocked, the one model read the gates make is stubbed.
 */
import { graphql, type ExecutionResult } from "graphql";
import { setRoleTemplateOverrides } from "@scd/shared";

const mockSectionFindById = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: {
    findById: (id: unknown) => ({
      lean: () => mockSectionFindById(id),
      select: () => ({ lean: () => mockSectionFindById(id) }),
    }),
    find: () => ({ select: () => ({ lean: async () => [] }), lean: async () => [] }),
  },
}));
jest.mock("../modules/attendance/services/StudentAttendanceService");
jest.mock("../modules/attendance/services/LeaveApplicationService");
jest.mock("../modules/attendance/services/AttendanceReportService");
jest.mock("../modules/routine/services/TeacherClassLoadService");
jest.mock("../modules/saturday-revision/services/RevisionService");
jest.mock("../modules/saturday-revision/services/RevisionDeliveryService");

import { builder } from "../schema";
import "../modules/attendance/resolvers/studentAttendance";
import "../modules/routine/resolvers/teacherClassLoad";
import "../modules/saturday-revision/resolvers/revision";
import "../modules/saturday-revision/resolvers/revisionDelivery";
import { markerForUnit } from "../modules/attendance/services/StudentAttendanceService";
import { leaveApplicationsForSection } from "../modules/attendance/services/LeaveApplicationService";
import { teacherClassLoad } from "../modules/routine/services/TeacherClassLoadService";
import { myRevisionGroups } from "../modules/saturday-revision/services/RevisionService";
import { getEscalationConfig } from "../modules/saturday-revision/services/RevisionDeliveryService";

builder.mutationField("_pmArlGatesTestNoop", (t) => t.boolean({ resolve: () => true }));
const schema = builder.toSchema();

type Auth = { role: string; userId: string; grantedPermissions?: string[] };
const as = (role: string, extra: Partial<Auth> = {}): Auth => ({ role, userId: "me", ...extra });

const run = (auth: Auth | null, source: string): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: { auth } }) as Promise<ExecutionResult>;
const ok = (r: ExecutionResult): boolean => !r.errors || r.errors.length === 0;

const LEAVE_Q = `query { leaveApplicationsForSection(sectionId: "s1", fromKey: "2026-10-01", toKey: "2026-10-20") { id } }`;
const UNIT_DAY_Q = `query { attendanceUnitDay(unitType: "section", unitId: "s1", dateKey: "2026-10-20") { dateKey } }`;
const LOAD_ALL_Q = `query { teacherClassLoad(month: "2026-10") { teacherId } }`;
const REV_GROUPS_Q = `query { myRevisionGroups { id } }`;
const REV_CONFIG_Q = `query { revisionEscalationConfig { consecutiveAbsenceThreshold } }`;

beforeEach(() => {
  jest.clearAllMocks();
  mockSectionFindById.mockResolvedValue({ _id: "s1", classTeacherId: { toString: () => "someone-else" } });
  (leaveApplicationsForSection as jest.Mock).mockResolvedValue([]);
  (markerForUnit as jest.Mock).mockResolvedValue({ teacherId: "someone-else" });
  (teacherClassLoad as jest.Mock).mockResolvedValue([]);
  (myRevisionGroups as jest.Mock).mockResolvedValue([]);
  (getEscalationConfig as jest.Mock).mockResolvedValue({ consecutiveAbsenceThreshold: 2, isDefault: true });
});
afterEach(() => setRoleTemplateOverrides({}));

describe("attendance — class-teacher report gate (attendance:view + designation | view_all)", () => {
  test("default Office reads any section (view_all), no class-teacher lookup", async () => {
    expect(ok(await run(as("OFFICE"), LEAVE_Q))).toBe(true);
    expect(mockSectionFindById).not.toHaveBeenCalled();
  });

  test("Office with attendance:view_all switched off falls to the class-teacher check", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["attendance:view_all"] } });
    expect(ok(await run(as("OFFICE"), LEAVE_Q))).toBe(false);
    expect(leaveApplicationsForSection).not.toHaveBeenCalled();
  });

  test("a Teacher reads only as the section's class teacher", async () => {
    expect(ok(await run(as("TEACHER"), LEAVE_Q))).toBe(false);
    mockSectionFindById.mockResolvedValue({ _id: "s1", classTeacherId: { toString: () => "me" } });
    expect(ok(await run(as("TEACHER"), LEAVE_Q))).toBe(true);
  });

  test("a class teacher whose role lost attendance:view is refused", async () => {
    setRoleTemplateOverrides({ TEACHER: { granted: [], revoked: ["attendance:view"] } });
    mockSectionFindById.mockResolvedValue({ _id: "s1", classTeacherId: { toString: () => "me" } });
    expect(ok(await run(as("TEACHER"), LEAVE_Q))).toBe(false);
  });

  test("a Teacher granted attendance:view_all per person passes without the designation", async () => {
    expect(ok(await run(as("TEACHER", { grantedPermissions: ["attendance:view_all"] }), LEAVE_Q))).toBe(true);
  });

  test("a guardian never reaches it", async () => {
    expect(ok(await run(as("GUARDIAN"), LEAVE_Q))).toBe(false);
  });
});

describe("attendance — marker-of-the-day read gate (attendance:mark + designation | edit)", () => {
  test("default Office passes on attendance:edit", async () => {
    expect(ok(await run(as("OFFICE"), UNIT_DAY_Q))).toBe(true);
    expect(markerForUnit).not.toHaveBeenCalled();
  });

  test("Office with attendance:edit switched off is refused (no mark)", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["attendance:edit"] } });
    expect(ok(await run(as("OFFICE"), UNIT_DAY_Q))).toBe(false);
  });

  test("a Teacher passes only as the unit's marker for the date", async () => {
    expect(ok(await run(as("TEACHER"), UNIT_DAY_Q))).toBe(false);
    (markerForUnit as jest.Mock).mockResolvedValue({ teacherId: "me" });
    expect(ok(await run(as("TEACHER"), UNIT_DAY_Q))).toBe(true);
  });

  test("a Teacher granted attendance:edit per person passes without being the marker", async () => {
    expect(ok(await run(as("TEACHER", { grantedPermissions: ["attendance:edit"] }), UNIT_DAY_Q))).toBe(true);
  });
});

describe("teacherClassLoad — every teacher's load needs routine:view_all", () => {
  test("default Office and Principal read all teachers", async () => {
    expect(ok(await run(as("OFFICE"), LOAD_ALL_Q))).toBe(true);
    expect(ok(await run(as("PRINCIPAL"), LOAD_ALL_Q))).toBe(true);
  });

  test("Office with routine:view_all switched off is refused", async () => {
    // D-#846: the Reports-hub switch reports:class_load also opens every teacher's load — both off.
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["routine:view_all", "reports:class_load"] } });
    expect(ok(await run(as("OFFICE"), LOAD_ALL_Q))).toBe(false);
  });

  test("a Teacher reads only their own load, unless granted routine:view_all", async () => {
    expect(ok(await run(as("TEACHER"), LOAD_ALL_Q))).toBe(false);
    expect(ok(await run(as("TEACHER"), `query { teacherClassLoad(month: "2026-10", teacherId: "me") { teacherId } }`))).toBe(true);
    expect(ok(await run(as("TEACHER", { grantedPermissions: ["routine:view_all"] }), LOAD_ALL_Q))).toBe(true);
  });
});

describe("Saturday revision — view_all / settings replace isAdminStaff", () => {
  test("default Office lists every group (view_all)", async () => {
    expect(ok(await run(as("OFFICE"), REV_GROUPS_Q))).toBe(true);
    expect(myRevisionGroups).toHaveBeenCalledWith("me", true);
  });

  test("Office with saturday_revision:view_all off is narrowed to its own groups", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["saturday_revision:view_all"] } });
    expect(ok(await run(as("OFFICE"), REV_GROUPS_Q))).toBe(true);
    expect(myRevisionGroups).toHaveBeenCalledWith("me", false);
  });

  test("a Teacher sees own groups; granted view_all per person, every group", async () => {
    await run(as("TEACHER"), REV_GROUPS_Q);
    expect(myRevisionGroups).toHaveBeenLastCalledWith("me", false);
    await run(as("TEACHER", { grantedPermissions: ["saturday_revision:view_all"] }), REV_GROUPS_Q);
    expect(myRevisionGroups).toHaveBeenLastCalledWith("me", true);
  });

  test("the escalation config follows saturday_revision:settings", async () => {
    expect(ok(await run(as("OFFICE"), REV_CONFIG_Q))).toBe(true);
    expect(ok(await run(as("TEACHER"), REV_CONFIG_Q))).toBe(false);
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["saturday_revision:settings"] } });
    expect(ok(await run(as("OFFICE"), REV_CONFIG_Q))).toBe(false);
    expect(ok(await run(as("TEACHER", { grantedPermissions: ["saturday_revision:settings"] }), REV_CONFIG_Q))).toBe(true);
  });

  test("guardians are refused", async () => {
    expect(ok(await run(as("GUARDIAN"), REV_GROUPS_Q))).toBe(false);
  });
});
