/**
 * Per-user Access Control tests (AC-1, prd-access-control §9 J-AC1..J-AC6, D-#193/#210–#215).
 *
 * Two halves:
 *   A. The PURE seam (`effectivePermissions` / `callerHasPermission`, @scd/shared) — the
 *      headline byte-identical proof (J-AC5) + multi-template union (J-AC2) + per-user
 *      add/remove (J-AC1) + the reserved-locked structural backstop (J-AC3).
 *   B. The service mutations — DB-free (the User model + writeAudit are mocked with small
 *      in-memory stores). Reserved-locked + guardian-wall write rejections (J-AC3/J-AC4) +
 *      the USER_ACCESS_CHANGED prior+new audit (J-AC6).
 *
 * NOTE: everything referenced inside a jest.mock() factory is `mock`-prefixed so
 * babel-plugin-jest-hoist allows the out-of-scope reference.
 */
import {
  effectivePermissions,
  callerHasPermission,
  permissionsForRole,
  ROLES,
  RESERVED_PERMISSIONS,
  type Role,
  type Permission,
} from "@scd/shared";

// ---------------------------------------------------------------------------
// Mocks (mock-prefixed for jest.mock hoisting)
// ---------------------------------------------------------------------------

interface MockUser {
  _id: { toString(): string };
  role: string;
  additionalTemplates: string[];
  grantedPermissions: string[];
  revokedPermissions: string[];
  save(): Promise<MockUser>;
}
const mockUserStore: Record<string, MockUser> = {};
const mockAudits: Array<Record<string, unknown>> = [];

jest.mock("../modules/foundation/models/User", () => ({
  User: {
    findById: (id: string) => Promise.resolve(mockUserStore[id] ?? null),
  },
}));

jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (params: Record<string, unknown>) => {
    mockAudits.push(params);
    return Promise.resolve();
  },
}));

import * as AC from "../modules/access-control/services/AccessControlService";

function seedUser(id: string, role: string, over: Partial<MockUser> = {}): MockUser {
  const u: MockUser = {
    _id: { toString: () => id },
    role,
    additionalTemplates: [],
    grantedPermissions: [],
    revokedPermissions: [],
    save: () => Promise.resolve(u),
    ...over,
  };
  mockUserStore[id] = u;
  return u;
}

const ACTOR = { userId: "principal-1", role: "PRINCIPAL" };

beforeEach(() => {
  for (const k of Object.keys(mockUserStore)) delete mockUserStore[k];
  mockAudits.length = 0;
});

const setOf = (profile: Parameters<typeof effectivePermissions>[0]) => [...effectivePermissions(profile)].sort();

// ===========================================================================
// A. The pure seam
// ===========================================================================

describe("A. effectivePermissions / callerHasPermission (the pure seam)", () => {
  test("J-AC5 BYTE-IDENTICAL: with empty arrays, every role resolves to its old role set exactly", () => {
    for (const role of ROLES) {
      expect(setOf({ role })).toEqual([...permissionsForRole(role)].sort());
    }
  });

  test("J-AC5: an undefined-array profile equals an empty-array profile (the zero-migration default)", () => {
    const role: Role = "TEACHER";
    expect(setOf({ role })).toEqual(
      setOf({ role, additionalTemplates: [], grantedPermissions: [], revokedPermissions: [] }),
    );
  });

  test("J-AC2 multi-template: TEACHER + OFFICE template = the union, MINUS the reserved five", () => {
    const eff = effectivePermissions({ role: "TEACHER", additionalTemplates: ["OFFICE"] });
    // gains OFFICE perms…
    expect(eff.has("roster:manage")).toBe(true);
    expect(eff.has("leave:manage")).toBe(true);
    // …keeps TEACHER perms…
    expect(eff.has("tracker:write")).toBe(true);
    // …and the union is exactly (teacher ∪ office) for a non-reserved-holding pair.
    const expected = new Set<Permission>([...permissionsForRole("TEACHER"), ...permissionsForRole("OFFICE")]);
    expect(setOf({ role: "TEACHER", additionalTemplates: ["OFFICE"] })).toEqual([...expected].sort());
    // …with no reserved perm reachable (neither template holds one anyway).
    for (const r of RESERVED_PERMISSIONS) expect(eff.has(r)).toBe(false);
  });

  test("J-AC1 per-user add: a grant adds a perm beyond the template; two same-role users can differ", () => {
    const a = effectivePermissions({ role: "TEACHER", revokedPermissions: ["tracker:export", "chat:write"] });
    const b = effectivePermissions({ role: "TEACHER", grantedPermissions: ["library:manage"] });
    expect(a.has("tracker:export")).toBe(false);
    expect(a.has("chat:write")).toBe(false);
    expect(b.has("library:manage")).toBe(true);
    // same starting template, divergent effective sets
    expect(setOf({ role: "TEACHER", revokedPermissions: ["tracker:export"] })).not.toEqual(
      setOf({ role: "TEACHER", grantedPermissions: ["library:manage"] }),
    );
  });

  test("J-AC1 revoke wins: a perm both granted AND revoked is NOT effective", () => {
    const eff = effectivePermissions({
      role: "TEACHER",
      grantedPermissions: ["library:manage"],
      revokedPermissions: ["library:manage", "tracker:write"],
    });
    expect(eff.has("library:manage")).toBe(false); // revoke beats grant
    expect(eff.has("tracker:write")).toBe(false); // revoke beats template
  });

  test("J-AC3 backstop: a forced reserved perm is DROPPED for a non-Principal, KEPT for the Principal", () => {
    // even if a reserved perm is forced into granted / a template, a non-Principal never holds it
    const office = effectivePermissions({ role: "OFFICE", grantedPermissions: ["payroll:approve", "access:manage"] });
    expect(office.has("payroll:approve")).toBe(false);
    expect(office.has("access:manage")).toBe(false);
    const teacherWithPrincipalTpl = effectivePermissions({ role: "TEACHER", additionalTemplates: ["OFFICE"], grantedPermissions: ["template:manage"] });
    expect(teacherWithPrincipalTpl.has("template:manage")).toBe(false);
    // the Principal keeps all five reserved perms (Principal-only, not Principal-never)
    const principal = effectivePermissions({ role: "PRINCIPAL" });
    for (const r of RESERVED_PERMISSIONS) expect(principal.has(r)).toBe(true);
  });

  test("callerHasPermission mirrors the gate: present+active ⇒ true; absent / reserved-on-non-Principal ⇒ false", () => {
    expect(callerHasPermission({ role: "TEACHER" }, "tracker:write")).toBe(true);
    expect(callerHasPermission({ role: "TEACHER" }, "user:manage")).toBe(false);
    expect(callerHasPermission({ role: "OFFICE", grantedPermissions: ["payroll:approve"] }, "payroll:approve")).toBe(false);
    expect(callerHasPermission({ role: "PRINCIPAL" }, "access:manage")).toBe(true);
    // a per-user grant reaches a real gate
    expect(callerHasPermission({ role: "TEACHER", grantedPermissions: ["library:manage"] }, "library:manage")).toBe(true);
    // a per-user revoke closes a gate the template opened
    expect(callerHasPermission({ role: "TEACHER", revokedPermissions: ["tracker:write"] }, "tracker:write")).toBe(false);
  });
});

// ===========================================================================
// B. The service mutations (mocked store)
// ===========================================================================

describe("B. AccessControlService mutations + audit", () => {
  test("J-AC1 addGrantedPermission adds the perm and returns the derived effective set", async () => {
    seedUser("t1", "TEACHER");
    const out = await AC.addGrantedPermission(ACTOR, "t1", "library:manage");
    expect(out.grantedPermissions).toContain("library:manage");
    expect(out.effectivePermissions).toContain("library:manage");
    expect(mockUserStore.t1.grantedPermissions).toEqual(["library:manage"]);
  });

  test("J-AC1 removeGrantedPermission / add+remove revoke round-trip", async () => {
    seedUser("t1", "TEACHER", { grantedPermissions: ["library:manage"] });
    const removed = await AC.removeGrantedPermission(ACTOR, "t1", "library:manage");
    expect(removed.grantedPermissions).not.toContain("library:manage");

    const revoked = await AC.addRevokedPermission(ACTOR, "t1", "tracker:export");
    expect(revoked.revokedPermissions).toContain("tracker:export");
    expect(revoked.effectivePermissions).not.toContain("tracker:export");

    const unrevoked = await AC.removeRevokedPermission(ACTOR, "t1", "tracker:export");
    expect(unrevoked.revokedPermissions).not.toContain("tracker:export");
    expect(unrevoked.effectivePermissions).toContain("tracker:export"); // flows from the template again
  });

  test("J-AC2 setAdditionalTemplates accepts TEACHER/OFFICE; rejects PRINCIPAL + GUARDIAN", async () => {
    seedUser("t1", "TEACHER");
    const out = await AC.setAdditionalTemplates(ACTOR, "t1", ["OFFICE"]);
    expect(out.additionalTemplates).toEqual(["OFFICE"]);
    expect(out.effectivePermissions).toContain("roster:manage");

    await expect(AC.setAdditionalTemplates(ACTOR, "t1", ["PRINCIPAL"])).rejects.toThrow(AC.AccessControlError);
    await expect(AC.setAdditionalTemplates(ACTOR, "t1", ["GUARDIAN"])).rejects.toThrow(AC.AccessControlError);
  });

  test("J-AC3 reserved-locked perms are REJECTED at write-time (all five)", async () => {
    seedUser("t1", "TEACHER");
    for (const r of RESERVED_PERMISSIONS) {
      await expect(AC.addGrantedPermission(ACTOR, "t1", r)).rejects.toThrow(AC.AccessControlError);
    }
    expect(mockUserStore.t1.grantedPermissions).toEqual([]); // nothing leaked through
  });

  test("J-AC4 guardian wall: guardian:read_child is ungrantable to a staff User", async () => {
    seedUser("t1", "TEACHER");
    await expect(AC.addGrantedPermission(ACTOR, "t1", "guardian:read_child")).rejects.toThrow(AC.AccessControlError);
  });

  test("J-AC4 guardian wall: the model governs the staff User only (a GUARDIAN-role / unknown target is refused)", async () => {
    seedUser("g1", "GUARDIAN");
    await expect(AC.addGrantedPermission(ACTOR, "g1", "tracker:write")).rejects.toThrow(AC.AccessControlError);
    await expect(AC.effectiveUserAccess("does-not-exist")).rejects.toThrow(AC.AccessControlError);
  });

  test("unknown permission is refused", async () => {
    seedUser("t1", "TEACHER");
    await expect(AC.addGrantedPermission(ACTOR, "t1", "nonsense:perm")).rejects.toThrow(AC.AccessControlError);
  });

  test("J-AC6 audit: every change writes USER_ACCESS_CHANGED with actor, target, prior + new", async () => {
    seedUser("t1", "TEACHER", { grantedPermissions: ["library:manage"] });
    await AC.addRevokedPermission(ACTOR, "t1", "tracker:export");

    expect(mockAudits).toHaveLength(1);
    const a = mockAudits[0];
    expect(a.eventKind).toBe("USER_ACCESS_CHANGED");
    expect(a.actorId).toBe("principal-1");
    expect(a.actorRole).toBe("PRINCIPAL");
    expect((a.targetId as { toString(): string }).toString()).toBe("t1");
    expect(a.targetKind).toBe("User");
    const meta = a.meta as { change: string; permission?: string; prior: AC.UserAccessSnapshot; next: AC.UserAccessSnapshot };
    expect(meta.change).toBe("revoke_added");
    expect(meta.permission).toBe("tracker:export");
    expect(meta.prior.revokedPermissions).toEqual([]); // PRIOR state captured
    expect(meta.next.revokedPermissions).toEqual(["tracker:export"]); // NEW state captured
    expect(meta.prior.grantedPermissions).toEqual(["library:manage"]); // unrelated arrays snapshotted too
  });

  test("effectiveUserAccess returns the raw arrays + the derived effective set", async () => {
    seedUser("t1", "TEACHER", { grantedPermissions: ["library:manage"], revokedPermissions: ["tracker:export"] });
    const out = await AC.effectiveUserAccess("t1");
    expect(out.role).toBe("TEACHER");
    expect(out.grantedPermissions).toEqual(["library:manage"]);
    expect(out.effectivePermissions).toContain("library:manage");
    expect(out.effectivePermissions).not.toContain("tracker:export");
    expect(mockAudits).toHaveLength(0); // a read never audits
  });
});
