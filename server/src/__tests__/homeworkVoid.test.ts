/**
 * HW-VOID (D-#741) — Principal/Office remove a never-issued homework declaration.
 *
 *   1. the permission: PRINCIPAL + OFFICE only, and the Office still holds no tracker:*
 *   2. a declared item with no student records is removed — whatever the day's state
 *      (the reconciliation row is never consulted) — its class-note link is cleared,
 *      and the removal is audited with the item snapshot
 *   3. refused: issued item, declared item that already has student records, an item
 *      issued between the check and the delete, an unknown id
 *   4. the clean-up list asks for declared + 0-question items in the lookback window
 *   5. both resolver fields are gated on homework:void, not on a tracker permission
 *
 * DB-free: every model + the audit writer is mocked; the rule logic is real.
 */
import { readFileSync } from "fs";
import path from "path";

const mockItemById = jest.fn();
const mockFindOneAndDelete = jest.fn();
const mockItemFind = jest.fn();
const mockRecordExists = jest.fn();
const mockNoteUpdateMany = jest.fn();
const mockWriteAudit = jest.fn();
const mockReconFindOne = jest.fn();

jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: {
    findById: (id: string) => ({ lean: () => Promise.resolve(mockItemById(id)) }),
    findOneAndDelete: (q: unknown) => ({ lean: () => Promise.resolve(mockFindOneAndDelete(q)) }),
    find: (q: unknown) => ({ sort: () => ({ lean: () => Promise.resolve(mockItemFind(q)) }) }),
  },
}));
jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { exists: (q: unknown) => Promise.resolve(mockRecordExists(q)) },
}));
jest.mock("../modules/trackers/models/HomeworkReconciliation", () => ({
  HomeworkReconciliation: { findOne: (q: unknown) => ({ lean: () => mockReconFindOne(q) }) },
  reconDayKey: (d: Date) => d,
}));
jest.mock("../modules/routine/models/ClassNote", () => ({
  ClassNote: { updateMany: (q: unknown, u: unknown) => Promise.resolve(mockNoteUpdateMany(q, u)) },
}));
const nameModel = (rows: Record<string, unknown>[]) => ({
  find: () => ({ select: () => ({ lean: () => Promise.resolve(rows) }) }),
});
jest.mock("../modules/foundation/models/Class", () => ({
  Class: nameModel([{ _id: { toString: () => "class-1" }, nameBn: "প্রথম শ্রেণি" }]),
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: nameModel([{ _id: { toString: () => "sec-1" }, nameBn: "সম্মিলিত" }]),
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: nameModel([{ _id: { toString: () => "teacher-1" }, name: "Teacher One" }]),
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => Promise.resolve(mockWriteAudit(p)),
}));

import { PERMISSIONS, ROLE_PERMISSIONS, roleHasPermission } from "@scd/shared";
import {
  voidHomeworkItem,
  listUnissuedHomework,
  UNISSUED_LOOKBACK_DAYS,
} from "../modules/trackers/services/HomeworkVoidService";

function itemDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: { toString: () => "item-1" },
    hwId: "HW-C1-MATH-0042",
    classId: { toString: () => "class-1" },
    classLevel: 1,
    sectionId: { toString: () => "sec-1" },
    subject: "MATH",
    dateGiven: new Date("2026-10-15T00:00:00"),
    timeDecl: 0,
    qCount: 0,
    description: "ক্লাস টেস্ট নেয়া হবে, জ্যামিতি অধ্যায়ের।",
    status: "declared",
    declaredBy: { toString: () => "teacher-1" },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRecordExists.mockReturnValue(null);
  mockFindOneAndDelete.mockImplementation(() => itemDoc());
  // A reconciled day — the void path must not care.
  mockReconFindOne.mockResolvedValue({ reconState: "reconciled" });
});

describe("homework:void — the permission", () => {
  test("is declared, and held by PRINCIPAL + OFFICE only", () => {
    expect(PERMISSIONS).toContain("homework:void");
    expect(roleHasPermission("PRINCIPAL", "homework:void")).toBe(true);
    expect(roleHasPermission("OFFICE", "homework:void")).toBe(true);
    expect(roleHasPermission("TEACHER", "homework:void")).toBe(false);
    expect(roleHasPermission("GUARDIAN", "homework:void")).toBe(false);
  });

  test("the Office still holds no tracker permission (D-#554)", () => {
    expect(ROLE_PERMISSIONS.OFFICE.some((p) => p.startsWith("tracker:"))).toBe(false);
  });
});

describe("voidHomeworkItem", () => {
  test("removes a declared 0-question item on a reconciled day, unlinks its class note, audits it", async () => {
    mockItemById.mockReturnValue(itemDoc());
    const res = await voidHomeworkItem("item-1", "office-1");

    expect(res).toEqual({ itemId: "item-1", hwId: "HW-C1-MATH-0042" });
    // Conditional on status so a racing confirm wins.
    expect(mockFindOneAndDelete).toHaveBeenCalledWith(expect.objectContaining({ status: "declared" }));
    expect(mockReconFindOne).not.toHaveBeenCalled();
    expect(mockNoteUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ homeworkItemId: expect.anything() }),
      { $unset: { homeworkItemId: 1 } },
    );
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    const audit = mockWriteAudit.mock.calls[0][0];
    expect(audit.eventKind).toBe("HW_ITEM_VOIDED");
    expect(audit.actorId).toBe("office-1");
    expect(audit.targetKind).toBe("HomeworkItem");
    expect(audit.meta).toMatchObject({
      hwId: "HW-C1-MATH-0042",
      subject: "MATH",
      qCount: 0,
      declaredBy: "teacher-1",
      description: "ক্লাস টেস্ট নেয়া হবে, জ্যামিতি অধ্যায়ের।",
    });
  });

  test("a declared item with questions is removable too — the rule is 'never issued', not '0 questions'", async () => {
    mockItemById.mockReturnValue(itemDoc({ qCount: 5, timeDecl: 20 }));
    await expect(voidHomeworkItem("item-1", "principal-1")).resolves.toMatchObject({ itemId: "item-1" });
  });

  test("refuses an issued item and deletes nothing", async () => {
    mockItemById.mockReturnValue(itemDoc({ status: "issued", qCount: 5 }));
    await expect(voidHomeworkItem("item-1", "office-1")).rejects.toThrow(/মুছে ফেলা যাবে না/);
    expect(mockFindOneAndDelete).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("refuses a declared item that already has student records", async () => {
    mockItemById.mockReturnValue(itemDoc());
    mockRecordExists.mockReturnValue({ _id: "rec-1" });
    await expect(voidHomeworkItem("item-1", "office-1")).rejects.toThrow(/রেকর্ড আছে/);
    expect(mockFindOneAndDelete).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("refuses when the item was issued between the check and the delete", async () => {
    mockItemById.mockReturnValue(itemDoc());
    mockFindOneAndDelete.mockReturnValue(null);
    await expect(voidHomeworkItem("item-1", "office-1")).rejects.toThrow(/মুছে ফেলা যাবে না/);
    expect(mockNoteUpdateMany).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("an unknown id is refused", async () => {
    mockItemById.mockReturnValue(null);
    await expect(voidHomeworkItem("nope", "office-1")).rejects.toThrow(/পাওয়া যায়নি/);
  });
});

describe("listUnissuedHomework", () => {
  test("asks for declared, 0-question items inside the lookback window", async () => {
    mockItemFind.mockReturnValue([]);
    const now = new Date("2026-10-15T10:00:00Z");
    await expect(listUnissuedHomework(now)).resolves.toEqual([]);
    const q = mockItemFind.mock.calls[0][0];
    expect(q.status).toBe("declared");
    expect(q.qCount).toEqual({ $lte: 0 });
    expect(q.dateGiven.$gte.getTime()).toBe(now.getTime() - UNISSUED_LOOKBACK_DAYS * 86_400_000);
  });

  test("maps class, section and declarer names onto each row", async () => {
    mockItemFind.mockReturnValue([itemDoc()]);
    const [row] = await listUnissuedHomework(new Date("2026-10-15T10:00:00Z"));
    expect(row).toMatchObject({
      itemId: "item-1",
      className: "প্রথম শ্রেণি",
      sectionName: "সম্মিলিত",
      declaredByName: "Teacher One",
      subject: "MATH",
      qCount: 0,
    });
    expect(row.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("resolver gates", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../modules/trackers/resolvers/homework.ts"),
    "utf8",
  );
  test.each(["voidHomeworkItem", "unissuedHomework"])("%s is gated on homework:void", (field) => {
    const at = source.indexOf(`Field("${field}"`);
    expect(at).toBeGreaterThan(0);
    const gate = source.slice(at).match(/authScopes:\s*\{([^}]*)\}/)?.[1] ?? "";
    // NOT tracker:* — the Office has none (D-#554), so such a gate would lock it out.
    expect(gate).toContain('"homework:void"');
    expect(gate).not.toContain("tracker:");
  });
});
