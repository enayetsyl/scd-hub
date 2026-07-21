/**
 * Audit-viewer read tests (owner ask 2026-07-20).
 *
 * RBAC   — audit:read is PRINCIPAL-only (the viewer gate; verifier-proven set).
 * Read   — newest-first, `before` cursor + kind/role filters forwarded, limit
 *          clamped to [1, 200], actor names joined from Users AND Guardians,
 *          meta serialized to JSON (empty meta → null).
 *
 * DB-free (repo convention): Audit + User + Guardian are mocked.
 */
import mongoose from "mongoose";
import { roleHasPermission, ROLES } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

const mockAuditFind = jest.fn();
jest.mock("../modules/platform/models/Audit", () => ({
  Audit: {
    find: (q: unknown) => ({
      sort: () => ({ limit: (n: number) => ({ lean: async () => mockAuditFind(q, n) }) }),
    }),
  },
}));
const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => ({ select: () => ({ lean: async () => mockUserFind(q) }) }) },
}));
const mockGuardianFind = jest.fn();
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: { find: (q: unknown) => ({ select: () => ({ lean: async () => mockGuardianFind(q) }) }) },
}));

import { auditLog } from "../modules/platform/services/AuditQueryService";

const STAFF_ID = oid();
const GUARDIAN_ID = oid();

beforeEach(() => {
  jest.clearAllMocks();
  mockAuditFind.mockReturnValue([]);
  mockUserFind.mockReturnValue([]);
  mockGuardianFind.mockReturnValue([]);
});

describe("RBAC — audit:read is Principal-only", () => {
  test("exact holder set is [PRINCIPAL]", () => {
    expect(ROLES.filter((r) => roleHasPermission(r, "audit:read"))).toEqual(["PRINCIPAL"]);
  });
});

describe("auditLog read", () => {
  test("forwards before/kind/role filters and clamps the limit", async () => {
    await auditLog({ before: "2026-07-20T10:00:00.000Z", eventKind: "LOGIN_FAIL", actorRole: "GUARDIAN", limit: 9999 });
    const [q, n] = mockAuditFind.mock.calls[0];
    expect(q.eventKind).toBe("LOGIN_FAIL");
    expect(q.actorRole).toBe("GUARDIAN");
    expect(q.eventAt.$lt.toISOString()).toBe("2026-07-20T10:00:00.000Z");
    expect(n).toBe(200); // clamped

    await auditLog({ limit: 0 });
    expect(mockAuditFind.mock.calls[1][1]).toBe(1); // clamped up
  });

  test("an invalid before cursor is ignored, not an error", async () => {
    await auditLog({ before: "not-a-date" });
    const [q] = mockAuditFind.mock.calls[0];
    expect(q.eventAt).toBeUndefined();
  });

  test("joins actor names from Users AND Guardians; meta serializes (empty → null)", async () => {
    mockAuditFind.mockReturnValue([
      { _id: oid(), eventKind: "TRACKER_WRITE", eventAt: new Date("2026-07-20T09:00:00Z"), actorId: STAFF_ID, actorRole: "TEACHER", meta: { hwId: "HW-1" } },
      { _id: oid(), eventKind: "LOGIN_SUCCESS", eventAt: new Date("2026-07-20T08:00:00Z"), actorId: GUARDIAN_ID, actorRole: "GUARDIAN", meta: {} },
      { _id: oid(), eventKind: "PROXY_EXPIRED", eventAt: new Date("2026-07-20T07:00:00Z") },
    ]);
    mockUserFind.mockReturnValue([{ _id: STAFF_ID, name: "Nuha" }]);
    mockGuardianFind.mockReturnValue([{ _id: GUARDIAN_ID, name: "Omar Faruq" }]);

    const rows = await auditLog();
    expect(rows[0]).toMatchObject({ eventKind: "TRACKER_WRITE", actorName: "Nuha", metaJson: JSON.stringify({ hwId: "HW-1" }) });
    expect(rows[1]).toMatchObject({ actorName: "Omar Faruq", metaJson: null });
    expect(rows[2]).toMatchObject({ actorId: null, actorName: null, actorRole: null });
  });
});
