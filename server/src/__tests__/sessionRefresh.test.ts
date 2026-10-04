/**
 * D-#708 — stay signed in: 30-day sessions re-minted on every app open, and a
 * deactivated account's token stops working on the GraphQL path within the cache window.
 * DB-free: User/Guardian are mocked.
 */
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const mockUserFindOne = jest.fn();
const mockGuardianFindOne = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    findOne: (q: unknown) => {
      const lean = () => mockUserFindOne(q);
      return { lean, select: () => ({ lean }) };
    },
  },
}));
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: {
    findOne: (q: unknown) => {
      const lean = () => mockGuardianFindOne(q);
      return { lean, select: () => ({ lean }) };
    },
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn() }));

import { refreshSession, signToken, SESSION_TTL } from "../modules/foundation/services/AuthService";
import { withActiveAccount, clearSessionActiveCache } from "../sessionActive";

const USER = new mongoose.Types.ObjectId();
const lifetimeDays = (token: string): number => {
  const p = jwt.decode(token) as { iat: number; exp: number };
  return (p.exp - p.iat) / 86400;
};

beforeEach(() => {
  jest.clearAllMocks();
  clearSessionActiveCache();
});

describe("refreshSession (D-#708)", () => {
  test("an active staff account gets a fresh 30-day token carrying its CURRENT access", async () => {
    mockUserFindOne.mockResolvedValue({
      _id: USER,
      role: "TEACHER",
      name: "Zarir",
      additionalTemplates: ["OFFICE"],
      grantedPermissions: [],
      revokedPermissions: [],
    });
    const r = await refreshSession({ userId: USER.toString(), role: "TEACHER" });
    expect(r).not.toBeNull();
    expect(lifetimeDays(r!.token)).toBe(30);
    expect((jwt.decode(r!.token) as { additionalTemplates: string[] }).additionalTemplates).toEqual(["OFFICE"]);
    expect(mockUserFindOne).toHaveBeenCalledWith({ _id: USER.toString(), active: true });
  });

  test("a deactivated / missing account gets null (the app signs out)", async () => {
    mockUserFindOne.mockResolvedValue(null);
    expect(await refreshSession({ userId: USER.toString(), role: "TEACHER" })).toBeNull();
  });

  test("a guardian whose login was disabled gets null", async () => {
    mockGuardianFindOne.mockResolvedValue({ _id: USER, name: "G", loginEnabled: false, passwordHash: "x" });
    expect(await refreshSession({ userId: USER.toString(), role: "GUARDIAN" })).toBeNull();
    mockGuardianFindOne.mockResolvedValue({ _id: USER, name: "G", loginEnabled: true, passwordHash: "x" });
    const r = await refreshSession({ userId: USER.toString(), role: "GUARDIAN" });
    expect(r?.role).toBe("GUARDIAN");
  });

  test("a borrowed View-as token is never extended", async () => {
    expect(
      await refreshSession({ userId: USER.toString(), role: "TEACHER", impersonatorId: "p1", impersonatorRole: "PRINCIPAL" }),
    ).toBeNull();
    expect(mockUserFindOne).not.toHaveBeenCalled();
  });

  test("login tokens default to the 30-day session (was 8h)", () => {
    expect(SESSION_TTL).toBe("30d");
    expect(lifetimeDays(signToken({ userId: "u", role: "TEACHER" }))).toBe(30);
  });
});

describe("withActiveAccount (D-#708)", () => {
  const auth = { userId: USER.toString(), role: "TEACHER" as const };

  test("an active account passes; the answer is cached (one read per minute)", async () => {
    mockUserFindOne.mockResolvedValue({ _id: USER });
    expect(await withActiveAccount(auth)).toBe(auth);
    expect(await withActiveAccount(auth)).toBe(auth);
    expect(mockUserFindOne).toHaveBeenCalledTimes(1);
  });

  test("a deactivated account's still-valid token is dropped", async () => {
    mockUserFindOne.mockResolvedValue(null);
    expect(await withActiveAccount(auth)).toBeNull();
  });

  test("a DB failure never signs anyone out", async () => {
    mockUserFindOne.mockRejectedValue(new Error("down"));
    expect(await withActiveAccount(auth)).toBe(auth);
  });

  test("no token stays no token", async () => {
    expect(await withActiveAccount(null)).toBeNull();
  });
});
