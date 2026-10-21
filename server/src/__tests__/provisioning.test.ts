/**
 * Credential-provisioning tests (D-#59 guardians, D-#60 staff).
 *
 * DB-free: the Mongoose models are mocked with small in-memory stores; bcrypt is
 * real so we can prove a generated password actually verifies (i.e. login would
 * succeed). Covers: phone grouping links all siblings, idempotent re-provision
 * (reset, no duplicate links), guardian/staff login by phone after provisioning,
 * HR-category → role mapping, support/phoneless rejection, and RBAC.
 *
 * NOTE: everything referenced inside a jest.mock() factory is `mock`-prefixed so
 * babel-plugin-jest-hoist allows the out-of-scope reference.
 */
import { roleHasPermission, callerHasPermission } from "@scd/shared";

// ---------------------------------------------------------------------------
// In-memory stores + helpers (all mock-prefixed for jest.mock hoisting)
// ---------------------------------------------------------------------------

type MockDoc = Record<string, any>;
const mockStore: {
  students: MockDoc[];
  classes: MockDoc[];
  guardians: MockDoc[];
  guardianLinks: MockDoc[];
  users: MockDoc[];
  staff: MockDoc[];
  idCounter: number;
} = { students: [], classes: [], guardians: [], guardianLinks: [], users: [], staff: [], idCounter: 0 };

const mockNextId = () => `id${++mockStore.idCounter}`;
const mockLean = (v: any) => ({ lean: () => Promise.resolve(v) });
const mockSortLean = (v: any) => ({ sort: () => ({ lean: () => Promise.resolve(v) }) });
const mockSaveable = (doc: any) => {
  doc.save = () => Promise.resolve(doc);
  return doc;
};

jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: () => mockLean(mockStore.students) },
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: () => mockLean(mockStore.classes) },
}));
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: {
    find: (q: any) => {
      const set = q && q.identifier && q.identifier.$in;
      const rows = set ? mockStore.guardians.filter((g) => set.includes(g.identifier)) : mockStore.guardians;
      return mockLean(rows);
    },
    findOne: (q: any) => Promise.resolve(mockStore.guardians.find((g) => g.identifier === q.identifier) || null),
    findById: (id: any) => Promise.resolve(mockStore.guardians.find((g) => g._id === id) || null),
    create: (d: any) => {
      const doc = mockSaveable(Object.assign({ _id: mockNextId() }, d));
      mockStore.guardians.push(doc);
      return Promise.resolve(doc);
    },
  },
}));
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: {
    findOne: (q: any) => ({
      lean: () =>
        Promise.resolve(
          mockStore.guardianLinks.find((l) => l.guardianId === q.guardianId && l.studentId === q.studentId) || null,
        ),
    }),
    create: (d: any) => {
      const doc = Object.assign({ _id: mockNextId() }, d);
      mockStore.guardianLinks.push(doc);
      return Promise.resolve(doc);
    },
    countDocuments: (q: any) => Promise.resolve(mockStore.guardianLinks.filter((l) => l.guardianId === q.guardianId).length),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: (q: any) => {
      const set = q && q.phone && q.phone.$in;
      const rows = set ? mockStore.users.filter((u) => set.includes(u.phone)) : mockStore.users;
      return mockLean(rows);
    },
    findOne: (q: any) => {
      // D-#315: staffLogin's phone clause is now { $in: [candidates] }.
      const phoneMatches = (u: any, c: any) =>
        c.phone && (c.phone.$in ? c.phone.$in.includes(u.phone) : u.phone === c.phone);
      let found;
      if (q.$or) {
        found = mockStore.users.find((u) =>
          q.$or.some((c: any) => (c.email && u.email === c.email) || phoneMatches(u, c)),
        );
      } else if (q.phone) {
        found = mockStore.users.find((u) => phoneMatches(u, q));
      }
      if (found && q.active !== undefined && found.active !== q.active) found = undefined;
      return Promise.resolve(found || null);
    },
    findById: (id: any) => Promise.resolve(mockStore.users.find((u) => u._id === id) || null),
    create: (d: any) => {
      const doc = mockSaveable(Object.assign({ _id: mockNextId() }, d));
      mockStore.users.push(doc);
      return Promise.resolve(doc);
    },
  },
}));
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: {
    find: () => mockSortLean(mockStore.staff),
    findById: (id: any) => Promise.resolve(mockStore.staff.find((s) => s._id === id) || null),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: jest.fn(() => Promise.resolve()),
}));
// The login lockout (D-#765) — never blocked here; its behaviour is in loginThrottle.test.ts.
jest.mock("../modules/foundation/models/LoginThrottle", () => ({
  LoginThrottle: {
    findOne: () => ({ lean: () => Promise.resolve(null) }),
    findOneAndUpdate: () => ({ lean: () => Promise.resolve({ failures: 1, blockedUntil: null }) }),
    updateOne: () => Promise.resolve({}),
    deleteOne: () => Promise.resolve({}),
  },
}));

// Import AFTER mocks
import {
  roleForCategory,
  guardianCredentialCandidates,
  provisionGuardianLogin,
  resetGuardianPassword,
  staffCredentialCandidates,
  provisionStaffLogin,
  resetStaffPassword,
  resetUserPassword,
  assertMayMintRole,
  PRINCIPAL_LOGIN_GUARD_BN,
  MINT_ROLE_GUARD_BN,
} from "../modules/foundation/services/ProvisioningService";
import { generatePassword, normalizePhone, buildCredentialShareLink } from "../modules/foundation/services/credentials";
import { verifyPassword, staffLogin, phoneCandidates } from "../modules/foundation/services/AuthService";

const ACTOR = { userId: "actor1", role: "PRINCIPAL" };

beforeEach(() => {
  mockStore.students = [];
  mockStore.classes = [];
  mockStore.guardians = [];
  mockStore.guardianLinks = [];
  mockStore.users = [];
  mockStore.staff = [];
  mockStore.idCounter = 0;
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("credentials helpers", () => {
  test("generatePassword is 8 unambiguous chars (no 0/O/1/l/I)", () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(8);
      expect(p).toMatch(/^[A-Za-z2-9]+$/);
      expect(p).not.toMatch(/[0O1lI]/); // the ambiguous glyphs are excluded by design
    }
  });

  test("normalizePhone strips spaces/dashes/parens", () => {
    expect(normalizePhone(" (017) 1234-5678 ")).toBe("01712345678");
  });

  test("buildCredentialShareLink embeds id + password in a wa.me link", async () => {
    const link = await buildCredentialShareLink({ toPhone: "01711", identifier: "01711", password: "Ab2Cd3Ef", name: "Test", audience: "guardian" });
    expect(link).toMatch(/^https:\/\/wa\.me\/01711\?text=/);
    expect(decodeURIComponent(link)).toContain("01711");
    expect(decodeURIComponent(link)).toContain("Ab2Cd3Ef");
  });
});

describe("roleForCategory (D-#60)", () => {
  test("teacher + assistant_hifz → TEACHER", () => {
    expect(roleForCategory("teacher")).toBe("TEACHER");
    expect(roleForCategory("assistant_hifz")).toBe("TEACHER");
  });
  test("office_accounts → OFFICE", () => {
    expect(roleForCategory("office_accounts")).toBe("OFFICE");
  });
  test("support → null (no login, D-#25)", () => {
    expect(roleForCategory("support")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Guardian provisioning
// ---------------------------------------------------------------------------

describe("guardian provisioning (D-#59)", () => {
  function seedFamily(): void {
    mockStore.classes = [
      { _id: "c1", nameBn: "নার্সারি" },
      { _id: "c2", nameBn: "কেজি" },
    ];
    // Two siblings share one phone; a third child is on a different phone.
    mockStore.students = [
      { _id: "s1", name: "Karim", phone: "01711-111111", classId: "c1", active: true },
      { _id: "s2", name: "Rahim", phone: "017 11 111111", classId: "c2", active: true },
      { _id: "s3", name: "Other", phone: "01999999999", classId: "c1", active: true },
    ];
  }

  test("candidates group siblings by normalized phone", async () => {
    seedFamily();
    const cands = await guardianCredentialCandidates();
    const family = cands.find((c) => c.phone === "01711111111");
    expect(family).toBeDefined();
    expect(family!.students).toHaveLength(2);
    expect(family!.students.map((s) => s.name).sort()).toEqual(["Karim", "Rahim"]);
    expect(family!.students[0].className).toBeTruthy();
    expect(family!.loginExists).toBe(false);
  });

  test("provision creates one login linked to BOTH siblings; password verifies", async () => {
    seedFamily();
    const cred = await provisionGuardianLogin("01711-111111", ACTOR);

    expect(cred.identifier).toBe("01711111111");
    expect(cred.identifierKind).toBe("phone");
    expect(cred.studentCount).toBe(2);
    expect(cred.alreadyExisted).toBe(false);
    expect(cred.waLink).toContain("wa.me/01711111111");

    expect(mockStore.guardians).toHaveLength(1);
    expect(mockStore.guardians[0].loginEnabled).toBe(true);
    const links = mockStore.guardianLinks.filter((l) => l.guardianId === mockStore.guardians[0]._id);
    expect(links.map((l) => l.studentId).sort()).toEqual(["s1", "s2"]);

    const ok = await verifyPassword(cred.password, mockStore.guardians[0].passwordHash as string);
    expect(ok).toBe(true);
  });

  test("re-provision is idempotent: resets password, no duplicate links", async () => {
    seedFamily();
    const first = await provisionGuardianLogin("01711111111", ACTOR);
    const second = await provisionGuardianLogin("01711111111", ACTOR);

    expect(mockStore.guardians).toHaveLength(1);
    expect(mockStore.guardianLinks.filter((l) => l.guardianId === mockStore.guardians[0]._id)).toHaveLength(2);
    expect(second.alreadyExisted).toBe(true);
    expect(second.password).not.toBe(first.password);
    const ok = await verifyPassword(second.password, mockStore.guardians[0].passwordHash as string);
    expect(ok).toBe(true);
  });

  test("provision picks up a NEW sibling on a later run", async () => {
    seedFamily();
    await provisionGuardianLogin("01711111111", ACTOR);
    mockStore.students.push({ _id: "s4", name: "Newborn", phone: "01711111111", classId: "c1", active: true });
    const cred = await provisionGuardianLogin("01711111111", ACTOR);
    expect(cred.studentCount).toBe(3);
    expect(mockStore.guardianLinks.filter((l) => l.guardianId === mockStore.guardians[0]._id)).toHaveLength(3);
  });

  test("provision throws when no student has that phone", async () => {
    seedFamily();
    await expect(provisionGuardianLogin("01700000000", ACTOR)).rejects.toThrow();
  });

  test("resetGuardianPassword rotates the password and keeps login enabled", async () => {
    seedFamily();
    await provisionGuardianLogin("01711111111", ACTOR);
    const gid = mockStore.guardians[0]._id;
    const reset = await resetGuardianPassword(gid, ACTOR);
    expect(reset.alreadyExisted).toBe(true);
    expect(mockStore.guardians[0].loginEnabled).toBe(true);
    const ok = await verifyPassword(reset.password, mockStore.guardians[0].passwordHash as string);
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Staff provisioning
// ---------------------------------------------------------------------------

describe("staff provisioning (D-#60)", () => {
  function seedStaff(): void {
    mockStore.staff = [
      { _id: "t1", name: "Teacher One", category: "teacher", phone: "01811111111", active: true },
      { _id: "o1", name: "Office One", category: "office_accounts", phone: "01822222222", active: true },
      { _id: "g1", name: "Guard One", category: "support", phone: "01833333333", active: true },
      { _id: "t2", name: "No Phone", category: "teacher", phone: undefined, active: true },
    ];
  }

  test("candidates map roles and flag support / phoneless as not provisionable", async () => {
    seedStaff();
    const cands = await staffCredentialCandidates();
    const byId = new Map(cands.map((c) => [c.staffId, c]));
    expect(byId.get("t1")!.mappedRole).toBe("TEACHER");
    expect(byId.get("t1")!.provisionable).toBe(true);
    expect(byId.get("o1")!.mappedRole).toBe("OFFICE");
    expect(byId.get("g1")!.provisionable).toBe(false);
    expect(byId.get("g1")!.reason).toBeTruthy();
    expect(byId.get("t2")!.provisionable).toBe(false);
  });

  test("provision a teacher → User with TEACHER role + phone login; password verifies", async () => {
    seedStaff();
    const cred = await provisionStaffLogin("t1", ACTOR);
    expect(cred.identifier).toBe("01811111111");
    expect(cred.contextLabel).toBe("TEACHER");
    expect(mockStore.users).toHaveLength(1);
    expect(mockStore.users[0].role).toBe("TEACHER");
    expect(mockStore.users[0].phone).toBe("01811111111");
    expect(mockStore.users[0].email).toBeUndefined();
    const ok = await verifyPassword(cred.password, mockStore.users[0].passwordHash as string);
    expect(ok).toBe(true);
  });

  test("staffLogin by phone succeeds after provisioning", async () => {
    seedStaff();
    const cred = await provisionStaffLogin("t1", ACTOR);
    const res = await staffLogin({ email: "01811111111", password: cred.password });
    expect(res).not.toBeNull();
    expect(res!.role).toBe("TEACHER");
  });

  // D-#315: any equivalent spelling of the same number logs in.
  test("staffLogin accepts +88/88-prefixed spellings of the stored phone", async () => {
    seedStaff();
    const cred = await provisionStaffLogin("t1", ACTOR);
    for (const spelling of ["+8801811111111", "8801811111111", "01811111111"]) {
      const res = await staffLogin({ email: spelling, password: cred.password });
      expect(res).not.toBeNull();
    }
  });

  test("phoneCandidates expands every BD-mobile spelling; leaves other inputs alone (D-#315)", () => {
    const all = ["01811111111", "+8801811111111", "8801811111111"];
    expect(phoneCandidates("01811111111").sort()).toEqual([...all].sort());
    expect(phoneCandidates("+8801811111111").sort()).toEqual([...all].sort());
    expect(phoneCandidates("880 1811-111111").sort()).toEqual([...all].sort());
    expect(phoneCandidates("someone@school.org")).toEqual(["someone@school.org"]);
    expect(phoneCandidates("12345")).toEqual(["12345"]);
  });

  test("office_accounts → OFFICE role", async () => {
    seedStaff();
    const cred = await provisionStaffLogin("o1", ACTOR);
    expect(cred.contextLabel).toBe("OFFICE");
    expect(mockStore.users[0].role).toBe("OFFICE");
  });

  test("support staff cannot be provisioned (D-#25)", async () => {
    seedStaff();
    await expect(provisionStaffLogin("g1", ACTOR)).rejects.toThrow();
  });

  test("phoneless staff cannot be provisioned", async () => {
    seedStaff();
    await expect(provisionStaffLogin("t2", ACTOR)).rejects.toThrow();
  });

  test("re-provision a staff login resets the password without duplicating the User", async () => {
    seedStaff();
    const first = await provisionStaffLogin("t1", ACTOR);
    const second = await provisionStaffLogin("t1", ACTOR);
    expect(mockStore.users).toHaveLength(1);
    expect(second.alreadyExisted).toBe(true);
    expect(second.password).not.toBe(first.password);
  });
});

// ---------------------------------------------------------------------------
// RBAC — the two gates (no new permissions introduced)
// ---------------------------------------------------------------------------

describe("RBAC gates", () => {
  test("guardian provisioning gate (guardian:link): PRINCIPAL+OFFICE yes, TEACHER no", () => {
    expect(roleHasPermission("PRINCIPAL", "guardian:link")).toBe(true);
    expect(roleHasPermission("OFFICE", "guardian:link")).toBe(true);
    expect(roleHasPermission("TEACHER", "guardian:link")).toBe(false);
    expect(roleHasPermission("GUARDIAN", "guardian:link")).toBe(false);
  });
  test("staff provisioning gate (user:manage): PRINCIPAL only", () => {
    expect(roleHasPermission("PRINCIPAL", "user:manage")).toBe(true);
    expect(roleHasPermission("OFFICE", "user:manage")).toBe(false);
    expect(roleHasPermission("TEACHER", "user:manage")).toBe(false);
  });
  // PM: the resolvers now name catalogue actions; the defaults reproduce the old gates.
  test("catalogue gates: guardians:reset_password P+O; staff_logins:* P only (ship day)", () => {
    for (const perm of ["guardians:reset_password", "guardians:link", "guardians:view_all", "guardians:create"] as const) {
      expect(callerHasPermission({ role: "PRINCIPAL" }, perm)).toBe(true);
      expect(callerHasPermission({ role: "OFFICE" }, perm)).toBe(true);
      expect(callerHasPermission({ role: "TEACHER" }, perm)).toBe(false);
      expect(callerHasPermission({ role: "GUARDIAN" }, perm)).toBe(false);
    }
    for (const perm of ["staff_logins:view", "staff_logins:create", "staff_logins:reset_password"] as const) {
      expect(callerHasPermission({ role: "PRINCIPAL" }, perm)).toBe(true);
      expect(callerHasPermission({ role: "OFFICE" }, perm)).toBe(false);
      expect(callerHasPermission({ role: "TEACHER" }, perm)).toBe(false);
      // A legacy per-person grant of user:manage still reaches them (read-time expansion).
      expect(callerHasPermission({ role: "OFFICE", grantedPermissions: ["user:manage"] }, perm)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Escalation target guards (PM F-3 / F-4, PRD §5.6)
// ---------------------------------------------------------------------------

describe("escalation target guards (F-3, F-4)", () => {
  const OFFICE_ACTOR = { userId: "off1", role: "OFFICE" };

  function seedPrincipalPhone(extra: Record<string, unknown> = {}): void {
    mockStore.users = [
      mockSaveable({ _id: "p1", phone: "01899999999", name: "Principal", role: "PRINCIPAL", active: true, passwordHash: "x", ...extra }),
    ];
  }

  test("F-4: a non-Principal cannot reset a PRINCIPAL phone login; the Principal can", async () => {
    seedPrincipalPhone();
    await expect(resetStaffPassword("p1", OFFICE_ACTOR)).rejects.toThrow(PRINCIPAL_LOGIN_GUARD_BN);
    expect(mockStore.users[0].passwordHash).toBe("x");
    const cred = await resetStaffPassword("p1", ACTOR);
    expect(cred.identifier).toBe("01899999999");
  });

  test("F-4: a non-Principal cannot reset a PRINCIPAL email login; the Principal can", async () => {
    mockStore.users = [
      mockSaveable({ _id: "p2", email: "head@school.org", name: "Principal", role: "PRINCIPAL", active: true, passwordHash: "x" }),
    ];
    await expect(resetUserPassword("p2", OFFICE_ACTOR)).rejects.toThrow(PRINCIPAL_LOGIN_GUARD_BN);
    expect(mockStore.users[0].passwordHash).toBe("x");
    await expect(resetUserPassword("p2", ACTOR)).resolves.toMatchObject({ identifier: "head@school.org" });
  });

  test("F-4: a login holding the PRINCIPAL template is guarded the same way", async () => {
    mockStore.users = [
      mockSaveable({ _id: "t9", phone: "01877777777", name: "Deputy", role: "TEACHER", additionalTemplates: ["PRINCIPAL"], active: true, passwordHash: "x" }),
    ];
    await expect(resetStaffPassword("t9", OFFICE_ACTOR)).rejects.toThrow(PRINCIPAL_LOGIN_GUARD_BN);
  });

  test("F-4: provisionStaffLogin cannot re-provision (reset) a PRINCIPAL login on the same phone", async () => {
    seedPrincipalPhone();
    mockStore.staff = [{ _id: "s1", name: "Principal", category: "teacher", phone: "01899999999", active: true }];
    await expect(provisionStaffLogin("s1", OFFICE_ACTOR)).rejects.toThrow(PRINCIPAL_LOGIN_GUARD_BN);
    expect(mockStore.users[0].passwordHash).toBe("x");
    await expect(provisionStaffLogin("s1", ACTOR)).resolves.toMatchObject({ alreadyExisted: true });
  });

  test("F-4: a non-Principal holder still resets and provisions ordinary staff logins", async () => {
    mockStore.users = [mockSaveable({ _id: "t1", phone: "01811111111", name: "T", role: "TEACHER", active: true, passwordHash: "x" })];
    await expect(resetStaffPassword("t1", OFFICE_ACTOR)).resolves.toMatchObject({ identifier: "01811111111" });
    mockStore.staff = [{ _id: "o1", name: "Office One", category: "office_accounts", phone: "01822222222", active: true }];
    await expect(provisionStaffLogin("o1", OFFICE_ACTOR)).resolves.toMatchObject({ alreadyExisted: false });
  });

  test("F-3: only the Principal mints a PRINCIPAL or GUARDIAN role via createUser", () => {
    expect(() => assertMayMintRole("PRINCIPAL", OFFICE_ACTOR)).toThrow(MINT_ROLE_GUARD_BN);
    expect(() => assertMayMintRole("GUARDIAN", { role: "TEACHER" })).toThrow(MINT_ROLE_GUARD_BN);
    expect(() => assertMayMintRole("PRINCIPAL", ACTOR)).not.toThrow();
    expect(() => assertMayMintRole("GUARDIAN", ACTOR)).not.toThrow();
    expect(() => assertMayMintRole("TEACHER", OFFICE_ACTOR)).not.toThrow();
    expect(() => assertMayMintRole("OFFICE", OFFICE_ACTOR)).not.toThrow();
  });
});
