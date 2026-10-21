/**
 * PM reach (docs/prd-permission-matrix.md §5.4/§5.5, D-#793/#796).
 *
 *   - assertCanWrite / assertCanWriteAny / assertCanRead take the feature's reach action
 *     (`edit_all` / `view_all`). With it, the ACTION decides — the blanket OFFICE refusal
 *     and the PRINCIPAL-by-role pass are gone for that gate; without it, the pre-matrix
 *     role behaviour is unchanged (unswept call sites).
 *   - holdersOf resolves "who should be told" from the action, not a role list.
 * DB-free: the teacher's scope union is mocked empty (no teaching grant anywhere).
 */
import { setRoleTemplateOverrides } from "@scd/shared";

jest.mock("../modules/foundation/services/ScopeGrantService", () => ({
  composeTeacherScope: async () => ({ scopes: [], expiredProxyGrantIds: [] }),
  canRead: () => false,
  canWrite: () => false,
  delegationNeedsClassId: () => false,
  stampProxyExpired: async () => undefined,
  proxyWindowEnd: () => new Date(),
}));
const mockUsers = [
  { _id: "u-p", name: "Principal", role: "PRINCIPAL", additionalTemplates: [], grantedPermissions: [], revokedPermissions: [] },
  { _id: "u-o", name: "Office", role: "OFFICE", additionalTemplates: [], grantedPermissions: [], revokedPermissions: [] },
  { _id: "u-t", name: "Teacher", role: "TEACHER", additionalTemplates: [], grantedPermissions: [], revokedPermissions: [] },
  { _id: "u-j", name: "Jerin", role: "TEACHER", additionalTemplates: [], grantedPermissions: ["leave:approve"], revokedPermissions: [] },
];
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: () => ({ select: () => ({ sort: () => ({ lean: async () => mockUsers }) }) }),
    findById: () => ({ select: () => ({ lean: async () => null }), lean: async () => null }),
  },
}));

import { assertCanWrite, assertCanWriteAny, assertCanRead, allowedSubjectCodesForSection } from "../middleware/authz";
import { holdersOf } from "../modules/access-control/services/holders";

const ctx = (role: string, extra: Record<string, unknown> = {}) =>
  ({ auth: { role, userId: `u-${role}`, ...extra } }) as never;
const SEC = "64b000000000000000000001";
const CLS = "64b000000000000000000002";

afterEach(() => setRoleTemplateOverrides({}));

describe("write reach (edit_all)", () => {
  test("without reach: the pre-matrix role behaviour (Principal passes, Office refused)", async () => {
    await expect(assertCanWrite(ctx("PRINCIPAL"), SEC)).resolves.toBeUndefined();
    await expect(assertCanWrite(ctx("OFFICE"), SEC)).rejects.toThrow("Forbidden");
    await expect(assertCanWrite(ctx("TEACHER"), SEC)).rejects.toThrow("Forbidden");
  });

  test("with reach: the action decides — Principal holds edit_all, Office does not by default", async () => {
    const reach = { editAll: "homework:edit_all" as const };
    await expect(assertCanWrite(ctx("PRINCIPAL"), SEC, undefined, undefined, reach)).resolves.toBeUndefined();
    await expect(assertCanWrite(ctx("OFFICE"), SEC, undefined, undefined, reach)).rejects.toThrow("Forbidden");
    await expect(assertCanWrite(ctx("GUARDIAN"), SEC, undefined, undefined, reach)).rejects.toThrow("Forbidden");
  });

  test("a switch the Principal turns on actually works: Office with edit_all passes (no role refusal)", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: ["homework:edit_all"], revoked: [] } });
    const reach = { editAll: "homework:edit_all" as const };
    await expect(assertCanWrite(ctx("OFFICE"), SEC, undefined, "check_homework", reach)).resolves.toBeUndefined();
    await expect(assertCanWriteAny(ctx("OFFICE"), SEC, undefined, ["check_homework"], reach)).resolves.toBeUndefined();
  });

  test("a person's own edit_all grant works too; a guardian never passes", async () => {
    const reach = { editAll: "homework:edit_all" as const };
    await expect(
      assertCanWrite(ctx("TEACHER", { grantedPermissions: ["homework:edit_all"] }), SEC, undefined, undefined, reach),
    ).resolves.toBeUndefined();
    await expect(
      assertCanWrite(ctx("GUARDIAN", { grantedPermissions: ["homework:edit_all"] }), SEC, undefined, undefined, reach),
    ).rejects.toThrow("Forbidden");
  });
});

describe("read reach (view_all)", () => {
  test("without reach: isAdminStaff (Office reads everything)", async () => {
    await expect(assertCanRead(ctx("OFFICE"), SEC, CLS)).resolves.toBeUndefined();
    await expect(allowedSubjectCodesForSection(ctx("OFFICE"), SEC, CLS)).resolves.toBeNull();
  });

  test("with reach: switching Office view_all off narrows Office to its own scope (none)", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["homework:view_all"] } });
    await expect(assertCanRead(ctx("OFFICE"), SEC, CLS, undefined, { viewAll: "homework:view_all" })).rejects.toThrow("Forbidden");
  });

  test("Office keeps edit_all where it acted school-wide before (class tests)", async () => {
    await expect(
      assertCanWrite(ctx("OFFICE"), SEC, undefined, undefined, { editAll: "class_test:edit_all" }),
    ).resolves.toBeUndefined();
  });

  test("with reach: a teacher granted view_all reads every section", async () => {
    const t = ctx("TEACHER", { grantedPermissions: ["homework:view_all"] });
    await expect(assertCanRead(t, SEC, CLS, undefined, { viewAll: "homework:view_all" })).resolves.toBeUndefined();
    await expect(allowedSubjectCodesForSection(t, SEC, CLS, { viewAll: "homework:view_all" })).resolves.toBeNull();
  });
});

describe("holdersOf (recipients follow the action)", () => {
  test("default switches: leave approval reaches Principal + Office, plus a teacher granted it", async () => {
    const names = (await holdersOf("leave:approve")).map((u) => u.name);
    expect(names).toEqual(["Principal", "Office", "Jerin"]);
  });

  test("a role switch moves the recipients with it", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["leave:approve"] } });
    const names = (await holdersOf("leave:approve")).map((u) => u.name);
    expect(names).toEqual(["Principal", "Jerin"]);
  });
});
