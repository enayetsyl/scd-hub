/**
 * "View as" gate + picker (VA-1, D-#638).
 *
 * Covers the guardrails that are decisions rather than plumbing:
 *   G2 — no nesting, no self, no Principal target, no account its owner cannot use either
 *   G3 — the gate reads the DATABASE role, never a permission and never the token's role
 *   G6 — nothing is subtracted: the borrowed token carries the target's own access
 *   G7 — starting a session is NOT a login, so it cannot make a quiet family look active
 *
 * DB-free (repo convention): the identity models and the audit writer are mocked.
 */
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { PERMISSIONS } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

// --- chainable model mocks -------------------------------------------------
// Each terminal `.lean()` resolves whatever the matching jest.fn returns. `select`
// returns a node carrying every continuation the service uses (sort/limit/lean), so one
// shape serves both `find().select().lean()` and `find().select().limit().lean()`.
const leafFor = (fn: jest.Mock, args: unknown[]) => {
  const node: Record<string, unknown> = {
    lean: async () => fn(...args),
    then: undefined,
  };
  node.select = () => node;
  node.sort = () => node;
  node.limit = () => node;
  return node;
};

const mockUserFindById = jest.fn();
const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    findById: (id: unknown) => leafFor(mockUserFindById, [id]),
    find: (q: unknown) => leafFor(mockUserFind, [q]),
  },
}));

const mockGuardianFindById = jest.fn();
const mockGuardianFind = jest.fn();
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: {
    findById: (id: unknown) => leafFor(mockGuardianFindById, [id]),
    find: (q: unknown) => leafFor(mockGuardianFind, [q]),
  },
}));

const mockLinkFind = jest.fn();
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: { find: (q: unknown) => leafFor(mockLinkFind, [q]) },
}));

const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (q: unknown) => leafFor(mockStudentFind, [q]) },
}));

const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (q: unknown) => leafFor(mockSectionFind, [q]) },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
  writeAuditMany: jest.fn(),
}));

import {
  listImpersonationTargets,
  startImpersonation,
  endImpersonation,
  IMPERSONATION_TTL_MINUTES,
} from "../modules/foundation/services/ImpersonationService";

const PRINCIPAL = oid();
const TEACHER = oid();
const GUARDIAN = oid();

const principalDoc = { _id: PRINCIPAL, role: "PRINCIPAL", active: true, name: "Principal" };
const teacherDoc = {
  _id: TEACHER,
  role: "TEACHER",
  active: true,
  name: "Teacher",
  additionalTemplates: [],
  grantedPermissions: [],
  revokedPermissions: [],
};
const guardianDoc = { _id: GUARDIAN, name: "Guardian", active: true, loginEnabled: true, passwordHash: "x" };

const start = (over: Partial<Parameters<typeof startImpersonation>[0]> = {}) =>
  startImpersonation({
    callerUserId: PRINCIPAL.toString(),
    alreadyImpersonating: false,
    targetId: TEACHER.toString(),
    targetKind: "STAFF",
    ...over,
  });

const payloadOf = (token: string) => jwt.decode(token) as Record<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindById.mockImplementation(async (id: unknown) => {
    const key = String(id);
    if (key === PRINCIPAL.toString()) return principalDoc;
    if (key === TEACHER.toString()) return teacherDoc;
    return null;
  });
  mockUserFind.mockResolvedValue([]);
  mockGuardianFindById.mockImplementation(async (id: unknown) =>
    String(id) === GUARDIAN.toString() ? guardianDoc : null,
  );
  mockGuardianFind.mockResolvedValue([]);
  mockLinkFind.mockResolvedValue([]);
  mockStudentFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([]);
  mockWriteAudit.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// G3 — the gate is the database role, not a permission and not the token
// ---------------------------------------------------------------------------

describe("G3 — only a Principal in the database may start a session", () => {
  test("a teacher is refused", async () => {
    await expect(start({ callerUserId: TEACHER.toString() })).rejects.toThrow(/প্রধান শিক্ষক/);
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("an OFFICE account holding EVERY permission is still refused", async () => {
    // The point of G3: impersonation is not grantable. If it were a Permission, the AC-1
    // per-user override system could hand it to an office desk by accident.
    const office = oid();
    mockUserFindById.mockImplementation(async (id: unknown) =>
      String(id) === office.toString()
        ? { _id: office, role: "OFFICE", active: true, grantedPermissions: [...PERMISSIONS] }
        : null,
    );
    await expect(start({ callerUserId: office.toString() })).rejects.toThrow(/প্রধান শিক্ষক/);
  });

  test("impersonation is deliberately NOT a member of the Permission enum", () => {
    // Keeping it out of the enum is what keeps it out of the grant surface — and out of
    // the two-place contract sync. If someone adds it, this test says why not to.
    expect([...PERMISSIONS].filter((p) => /impersonat|view.?as/i.test(p))).toEqual([]);
  });

  test("a deactivated Principal is refused", async () => {
    mockUserFindById.mockResolvedValue({ ...principalDoc, active: false });
    await expect(start()).rejects.toThrow(/প্রধান শিক্ষক/);
  });

  test("a malformed caller id is refused before any query runs", async () => {
    await expect(start({ callerUserId: "not-an-id" })).rejects.toThrow(/প্রধান শিক্ষক/);
    expect(mockUserFindById).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// G2 — the four refusals
// ---------------------------------------------------------------------------

describe("G2 — refusals, each of which mints nothing", () => {
  test("no second hop: a borrowed session cannot start another", async () => {
    await expect(start({ alreadyImpersonating: true })).rejects.toThrow(/নিজের অ্যাকাউন্টে ফিরে/);
    expect(mockUserFindById).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("a Principal cannot view as themselves", async () => {
    await expect(start({ targetId: PRINCIPAL.toString() })).rejects.toThrow(/নিজের অ্যাকাউন্ট/);
  });

  test("a Principal cannot view as another Principal", async () => {
    const other = oid();
    mockUserFindById.mockImplementation(async (id: unknown) =>
      String(id) === PRINCIPAL.toString()
        ? principalDoc
        : { _id: other, role: "PRINCIPAL", active: true, name: "Other", additionalTemplates: [] },
    );
    await expect(start({ targetId: other.toString() })).rejects.toThrow(/প্রধান শিক্ষকের অ্যাকাউন্ট/);
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("nor as a teacher who holds the PRINCIPAL template — the ladder's back door", async () => {
    mockUserFindById.mockImplementation(async (id: unknown) =>
      String(id) === PRINCIPAL.toString()
        ? principalDoc
        : { ...teacherDoc, additionalTemplates: ["PRINCIPAL"] },
    );
    await expect(start()).rejects.toThrow(/প্রধান শিক্ষকের অ্যাকাউন্ট/);
  });

  test("an inactive staff account cannot be entered", async () => {
    mockUserFindById.mockImplementation(async (id: unknown) =>
      String(id) === PRINCIPAL.toString() ? principalDoc : { ...teacherDoc, active: false },
    );
    await expect(start()).rejects.toThrow(/নিষ্ক্রিয়/);
  });

  test("a guardian with no login enabled cannot be entered either", async () => {
    // "View as" must never reach an account its real owner could not log into.
    mockGuardianFindById.mockResolvedValue({ ...guardianDoc, loginEnabled: false });
    await expect(start({ targetId: GUARDIAN.toString(), targetKind: "GUARDIAN" })).rejects.toThrow(
      /লগইন চালু নেই/,
    );
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("a contact-only guardian (no password) is refused for the same reason", async () => {
    mockGuardianFindById.mockResolvedValue({ ...guardianDoc, passwordHash: undefined });
    await expect(start({ targetId: GUARDIAN.toString(), targetKind: "GUARDIAN" })).rejects.toThrow(
      /লগইন চালু নেই/,
    );
  });

  test("an unknown target is refused", async () => {
    await expect(start({ targetId: oid().toString() })).rejects.toThrow(/পাওয়া যায়নি/);
  });
});

// ---------------------------------------------------------------------------
// G6 — nothing is subtracted (the owner's decision)
// ---------------------------------------------------------------------------

describe("G6 — the borrowed token carries the target's own access, unmodified", () => {
  test("the token's subject is the TEACHER, which is what makes scoping work", async () => {
    // Scope checks read ctx.auth.userId directly (classTeacherId === ctx.auth.userId), so
    // minting with the Principal's id would show them their own empty section list.
    const res = await start();
    const p = payloadOf(res.token);
    expect(p.userId).toBe(TEACHER.toString());
    expect(p.role).toBe("TEACHER");
    expect(res.userId).toBe(TEACHER.toString());
  });

  test("the Principal rides along in impersonatorId — that is the only addition", async () => {
    const p = payloadOf((await start()).token);
    expect(p.impersonatorId).toBe(PRINCIPAL.toString());
    expect(p.impersonatorRole).toBe("PRINCIPAL");
  });

  test("the target's per-user grants and revocations are carried verbatim", async () => {
    mockUserFindById.mockImplementation(async (id: unknown) =>
      String(id) === PRINCIPAL.toString()
        ? principalDoc
        : {
            ...teacherDoc,
            additionalTemplates: ["OFFICE"],
            grantedPermissions: ["book:manage"],
            revokedPermissions: ["exam:manage"],
          },
    );
    const p = payloadOf((await start()).token);
    expect(p.additionalTemplates).toEqual(["OFFICE"]);
    expect(p.grantedPermissions).toEqual(["book:manage"]);
    expect(p.revokedPermissions).toEqual(["exam:manage"]);
  });

  test("a guardian session carries no templates or overrides — the guardian wall holds", async () => {
    const res = await start({ targetId: GUARDIAN.toString(), targetKind: "GUARDIAN" });
    const p = payloadOf(res.token);
    expect(p.role).toBe("GUARDIAN");
    expect(p.userId).toBe(GUARDIAN.toString());
    expect(p.additionalTemplates).toBeUndefined();
    expect(p.grantedPermissions).toBeUndefined();
  });

  test("the session is short-lived", async () => {
    const res = await start();
    expect(res.expiresInSeconds).toBe(IMPERSONATION_TTL_MINUTES * 60);
    const p = payloadOf(res.token);
    const ttl = (p.exp as number) - (p.iat as number);
    expect(ttl).toBe(IMPERSONATION_TTL_MINUTES * 60);
    // Materially shorter than an ordinary 8h session — a forgotten tab is not a standing
    // second identity.
    expect(ttl).toBeLessThan(8 * 60 * 60);
  });
});

// ---------------------------------------------------------------------------
// G7 — a borrowed session is not a login
// ---------------------------------------------------------------------------

describe("G7 — starting a session must not look like the account logging in", () => {
  test("it writes IMPERSONATION_START and never LOGIN_SUCCESS", async () => {
    await start();
    const kinds = mockWriteAudit.mock.calls.map((c) => (c[0] as { eventKind: string }).eventKind);
    expect(kinds).toContain("IMPERSONATION_START");
    expect(kinds).not.toContain("LOGIN_SUCCESS");
  });

  test("entering a GUARDIAN account writes no guardian login row", async () => {
    // The engagement report counts LOGIN_SUCCESS rows with actorRole GUARDIAN to find
    // families that have gone quiet. A row here would make every family the Principal
    // checks read as active, and silently hide them from the report.
    await start({ targetId: GUARDIAN.toString(), targetKind: "GUARDIAN" });
    for (const [row] of mockWriteAudit.mock.calls as Array<[{ eventKind: string; actorRole?: string }]>) {
      expect(row.eventKind).not.toBe("LOGIN_SUCCESS");
      expect(row.actorRole).not.toBe("GUARDIAN");
    }
  });

  test("the START row names the Principal and points at the borrowed account", async () => {
    await start();
    const row = mockWriteAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(String(row.actorId)).toBe(PRINCIPAL.toString());
    expect(row.actorRole).toBe("PRINCIPAL");
    expect(String(row.targetId)).toBe(TEACHER.toString());
    expect(row.targetKind).toBe("User");
  });

  test("ending a session records it; a caller with no impersonator records nothing", async () => {
    await endImpersonation({ borrowedUserId: TEACHER.toString(), impersonatorId: PRINCIPAL.toString() });
    expect((mockWriteAudit.mock.calls[0][0] as { eventKind: string }).eventKind).toBe("IMPERSONATION_END");

    mockWriteAudit.mockClear();
    await expect(endImpersonation({ borrowedUserId: TEACHER.toString(), impersonatorId: "" })).resolves.toBe(
      false,
    );
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

describe("the picker lists who can be entered, and says why not", () => {
  test("guardian rows carry one line per child, with the শাখা (owner ask)", async () => {
    const student = oid();
    const section = oid();
    mockGuardianFind.mockResolvedValue([guardianDoc]);
    mockLinkFind.mockResolvedValue([{ guardianId: GUARDIAN, studentId: student }]);
    mockStudentFind.mockResolvedValue([{ _id: student, name: "Ayesha", nameBn: "আয়েশা", sectionId: section }]);
    mockSectionFind.mockResolvedValue([{ _id: section, nameBn: "শাখা ৪ক", code: "4A" }]);

    const rows = await listImpersonationTargets({
      callerUserId: PRINCIPAL.toString(),
      kind: "GUARDIAN",
    });
    expect(rows[0].lines).toEqual(["আয়েশা · শাখা ৪ক"]);
    expect(rows[0].eligible).toBe(true);
  });

  test("a guardian with two children lists both", async () => {
    const [s1, s2, sec1, sec2] = [oid(), oid(), oid(), oid()];
    mockGuardianFind.mockResolvedValue([guardianDoc]);
    mockLinkFind.mockResolvedValue([
      { guardianId: GUARDIAN, studentId: s1 },
      { guardianId: GUARDIAN, studentId: s2 },
    ]);
    mockStudentFind.mockResolvedValue([
      { _id: s1, name: "Rafi", sectionId: sec1 },
      { _id: s2, name: "Sadia", sectionId: sec2 },
    ]);
    mockSectionFind.mockResolvedValue([
      { _id: sec1, nameBn: "শাখা ২খ" },
      { _id: sec2, nameBn: "শাখা ৫ক" },
    ]);
    const rows = await listImpersonationTargets({ callerUserId: PRINCIPAL.toString(), kind: "GUARDIAN" });
    expect(rows[0].lines).toEqual(["Rafi · শাখা ২খ", "Sadia · শাখা ৫ক"]);
  });

  test("an ineligible row is RETURNED locked with a reason, not filtered away", async () => {
    // A missing row invites "why can't I find her"; a locked row answers it.
    mockGuardianFind.mockResolvedValue([{ ...guardianDoc, loginEnabled: false }]);
    const rows = await listImpersonationTargets({ callerUserId: PRINCIPAL.toString(), kind: "GUARDIAN" });
    expect(rows).toHaveLength(1);
    expect(rows[0].eligible).toBe(false);
    expect(rows[0].reason).toMatch(/লগইন চালু নেই/);
  });

  test("the staff list locks Principals and the caller themselves", async () => {
    mockUserFind.mockResolvedValue([
      { _id: PRINCIPAL, name: "Me", role: "PRINCIPAL", active: true, additionalTemplates: [] },
      { _id: TEACHER, name: "Teacher", role: "TEACHER", active: true, additionalTemplates: [] },
    ]);
    const rows = await listImpersonationTargets({ callerUserId: PRINCIPAL.toString(), kind: "STAFF" });
    expect(rows.find((r) => r.id === PRINCIPAL.toString())?.eligible).toBe(false);
    expect(rows.find((r) => r.id === TEACHER.toString())?.eligible).toBe(true);
  });

  test("searching a child's name finds the family (how the owner will actually look)", async () => {
    const student = oid();
    mockGuardianFind
      .mockResolvedValueOnce([]) // no guardian matches "আয়েশা" by their own details
      .mockResolvedValueOnce([guardianDoc]); // …but her guardian is found through the roster
    mockStudentFind.mockResolvedValueOnce([{ _id: student }]).mockResolvedValueOnce([]);
    mockLinkFind.mockResolvedValueOnce([{ guardianId: GUARDIAN, studentId: student }]).mockResolvedValue([]);

    const rows = await listImpersonationTargets({
      callerUserId: PRINCIPAL.toString(),
      kind: "GUARDIAN",
      search: "আয়েশা",
    });
    expect(rows.map((r) => r.id)).toEqual([GUARDIAN.toString()]);
  });

  test("a search string with regex characters is matched literally, not as a pattern", async () => {
    mockUserFind.mockResolvedValue([]);
    await listImpersonationTargets({ callerUserId: PRINCIPAL.toString(), kind: "STAFF", search: "a.*b(" });
    const q = mockUserFind.mock.calls[0][0] as { $or: Array<{ name?: RegExp }> };
    expect(q.$or[0].name?.source).toBe("a\\.\\*b\\(");
  });

  test("the picker is Principal-only, like the mint", async () => {
    await expect(
      listImpersonationTargets({ callerUserId: TEACHER.toString(), kind: "STAFF" }),
    ).rejects.toThrow(/প্রধান শিক্ষক/);
  });
});
