/**
 * Messaging M-6 — guardian notice tests (prd-messaging §5/§6 M-6, D-#79/#111).
 *
 *   compose — fan-out builds ONE ADR-003 wa.me link per active student WITH a
 *             family phone; phone-less students raise unreachableCount; persists
 *             GuardianNotice + audits NOTICE_SENT; empty title/body + a SECTION
 *             notice with no sectionId are rejected (J-M8).
 *   authz   — the D-#45 duty map: SCHOOL needs chat:manage; SECTION needs the
 *             class teacher (assertIsClassTeacher) OR chat:manage — a
 *             non-class-teacher SECTION compose is DENIED (the J-M8 acceptance).
 *
 * DB-free: Student / GuardianNotice / AuditService / assertIsClassTeacher mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: () => ({ select: () => ({ lean: () => mockStudentFind() }) }) },
}));

const mockNoticeCreate = jest.fn();
jest.mock("../modules/chat/models/GuardianNotice", () => ({
  GuardianNotice: { create: (d: unknown) => mockNoticeCreate(d) },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

const mockAssertClassTeacher = jest.fn();
jest.mock("../middleware/authz", () => {
  const actual = jest.requireActual("../middleware/authz");
  return {
    ...actual,
    assertIsClassTeacher: (ctx: unknown, sectionId: unknown) => mockAssertClassTeacher(ctx, sectionId),
  };
});

import { ForbiddenError } from "../middleware/authz";
import { ChatError } from "../modules/chat/services/ChatService";
import {
  composeGuardianNotice,
  assertCanComposeNotice,
  buildGuardianNoticeLink,
} from "../modules/chat/services/GuardianNoticeService";
import type { AppContext } from "../context";

const COMPOSER = oid().toString();
const SECTION = oid().toString();
const NOTICE = oid();

const ctx = (role: string): AppContext => ({ auth: { userId: COMPOSER, role } } as unknown as AppContext);

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentFind.mockResolvedValue([
    { _id: oid(), name: "Yousuf", nameBn: "ইউসুফ", phone: "+8801700000001" },
    { _id: oid(), name: "Barakah", nameBn: "বারাকাহ", phone: undefined }, // unreachable
  ]);
  mockNoticeCreate.mockImplementation(async (d: Record<string, unknown>) => ({ _id: NOTICE, ...d }));
  mockWriteAudit.mockResolvedValue(undefined);
  mockAssertClassTeacher.mockResolvedValue(undefined);
});

// ===========================================================================
// compose — fan-out + persistence + audit
// ===========================================================================

describe("M-6 composeGuardianNotice", () => {
  test("SECTION: one wa.me link per phone-bearing student; phone-less → unreachable; NOTICE_SENT audited", async () => {
    const res = await composeGuardianNotice({
      scope: "SECTION",
      sectionId: SECTION,
      title: "ছুটি",
      body: "আগামীকাল স্কুল বন্ধ",
      composedBy: COMPOSER,
    });
    expect(res.recipientCount).toBe(1);
    expect(res.unreachableCount).toBe(1);
    expect(res.recipients[0].studentName).toBe("ইউসুফ");
    // normalizePhone preserves the leading + (the established library/credentials convention).
    expect(res.recipients[0].waLink).toMatch(/^https:\/\/wa\.me\/\+8801700000001\?text=/);
    expect(mockNoticeCreate).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "SECTION", title: "ছুটি", recipientCount: 1 }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "NOTICE_SENT", meta: expect.objectContaining({ recipientCount: 1, unreachableCount: 1 }) }),
    );
  });

  test("SCHOOL: composes across all active students (no section filter)", async () => {
    const res = await composeGuardianNotice({ scope: "SCHOOL", title: "t", body: "b", composedBy: COMPOSER });
    expect(res.scope).toBe("SCHOOL");
    expect(mockNoticeCreate).toHaveBeenCalledWith(expect.objectContaining({ scope: "SCHOOL" }));
  });

  test("empty title or body is rejected; a SECTION notice with no sectionId is rejected", async () => {
    await expect(composeGuardianNotice({ scope: "SCHOOL", title: "  ", body: "b", composedBy: COMPOSER })).rejects.toThrow(ChatError);
    await expect(composeGuardianNotice({ scope: "SECTION", title: "t", body: "b", composedBy: COMPOSER })).rejects.toThrow(/সেকশন/);
    expect(mockNoticeCreate).not.toHaveBeenCalled();
  });
});

describe("buildGuardianNoticeLink", () => {
  test("normalizes the phone and url-encodes the Bangla body", () => {
    const link = buildGuardianNoticeLink({ toPhone: "01700000001", studentName: "ইউসুফ", title: "ছুটি", body: "বন্ধ" });
    expect(link.startsWith("https://wa.me/")).toBe(true);
    expect(link).toContain("?text=");
  });
});

// ===========================================================================
// authz — the D-#45 duty map (J-M8 deny)
// ===========================================================================

describe("M-6 assertCanComposeNotice (D-#45 duty)", () => {
  test("SCHOOL requires chat:manage — a non-manager is denied", async () => {
    await expect(assertCanComposeNotice(ctx("TEACHER"), { scope: "SCHOOL", canManage: false })).rejects.toThrow(ForbiddenError);
    await expect(assertCanComposeNotice(ctx("OFFICE"), { scope: "SCHOOL", canManage: true })).resolves.toBeUndefined();
  });

  test("SECTION by a manager is allowed WITHOUT a class-teacher check", async () => {
    await assertCanComposeNotice(ctx("OFFICE"), { scope: "SECTION", sectionId: SECTION, canManage: true });
    expect(mockAssertClassTeacher).not.toHaveBeenCalled();
  });

  test("SECTION by a non-manager defers to assertIsClassTeacher — the class teacher passes", async () => {
    await assertCanComposeNotice(ctx("TEACHER"), { scope: "SECTION", sectionId: SECTION, canManage: false });
    expect(mockAssertClassTeacher).toHaveBeenCalledWith(expect.anything(), SECTION);
  });

  test("J-M8: a non-class-teacher SECTION notice is DENIED", async () => {
    mockAssertClassTeacher.mockRejectedValue(new ForbiddenError("not the class teacher"));
    await expect(
      assertCanComposeNotice(ctx("TEACHER"), { scope: "SECTION", sectionId: SECTION, canManage: false }),
    ).rejects.toThrow(ForbiddenError);
  });

  test("SECTION with no sectionId is rejected", async () => {
    await expect(assertCanComposeNotice(ctx("OFFICE"), { scope: "SECTION", canManage: true })).rejects.toThrow(ChatError);
  });
});
