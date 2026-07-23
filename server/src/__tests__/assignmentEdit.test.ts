/**
 * D-#352 — tiered edit + DRAFT-delete of a delivered assignment (the D-#336
 * homework twin, owner ask 2026-07-23).
 *
 *   DRAFT  → estMinutes / totalMarks / setId / attachments all editable
 *   ISSUED → descriptive only; estMinutes FROZEN (weekly load already confirmed),
 *            delivery/due dates never client-editable at any status
 *   delete → DRAFT only; ISSUED refused (student records exist)
 *   who    → the cell's own subject teacher, or Principal/Office
 *
 * DB-free: models mocked; the policy logic is real.
 */
const mockItemFindById = jest.fn();
const mockItemDeleteOne = jest.fn();
const mockRecFindOne = jest.fn();
const mockFileFind = jest.fn();

jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: {
    findById: (id: unknown) => Promise.resolve(mockItemFindById(id)),
    deleteOne: (q: unknown) => mockItemDeleteOne(q),
  },
}));
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: {
    findOne: (q: unknown) => ({ select: () => ({ lean: () => mockRecFindOne(q) }) }),
  },
}));
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: { find: (q: unknown) => ({ select: () => ({ lean: () => mockFileFind(q) }) }) },
}));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn() }));
jest.mock("../modules/trackers/models/AssignmentSchedule", () => ({ AssignmentSchedule: {} }));
jest.mock("../modules/trackers/models/AssignmentSequence", () => ({ AssignmentSequence: {} }));
jest.mock("../modules/routine/models/HolidayException", () => ({ HolidayException: { find: () => ({ lean: () => [] }) } }));

import {
  updateAssignmentItem,
  deleteAssignmentItem,
} from "../modules/trackers/services/AssignmentService";

const ITEM = "507f1f77bcf86cd799439011";
const OWNER = "aaaaaaaaaaaaaaaaaaaaaaa1"; // the rotation cell's subject teacher
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbb2"; // a different teacher

interface ItemDoc {
  [k: string]: unknown;
  save: jest.Mock;
}

const makeItem = (over: Record<string, unknown> = {}): ItemDoc => ({
  _id: ITEM,
  asId: "AS-C4-MATH-0001",
  weekNumber: 3,
  subject: "MATH",
  status: "DRAFT",
  estMinutes: 20,
  totalMarks: 20,
  teacherId: OWNER,
  deliveryDate: new Date(2026, 6, 16),
  dueDate: new Date(2026, 6, 19),
  setId: undefined,
  attachmentIds: undefined,
  save: jest.fn().mockResolvedValue(undefined),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRecFindOne.mockResolvedValue(null); // no student records / none over the ceiling
  mockItemDeleteOne.mockResolvedValue({ deletedCount: 1 });
  mockFileFind.mockResolvedValue([]);
});

describe("updateAssignmentItem (D-#352 tiered edit)", () => {
  test("DRAFT: the teacher can change the time (estMinutes)", async () => {
    const doc = makeItem();
    mockItemFindById.mockReturnValue(doc);

    const r = await updateAssignmentItem({ itemId: ITEM, estMinutes: 45, actorId: OWNER });

    expect(doc.estMinutes).toBe(45);
    expect(doc.save).toHaveBeenCalled();
    expect(r).toMatchObject({ asId: "AS-C4-MATH-0001", status: "DRAFT", estMinutes: 45 });
  });

  test("ISSUED: the time is FROZEN — estMinutes edit is rejected", async () => {
    const doc = makeItem({ status: "ISSUED" });
    mockItemFindById.mockReturnValue(doc);

    await expect(
      updateAssignmentItem({ itemId: ITEM, estMinutes: 45, actorId: OWNER }),
    ).rejects.toThrow(/সময়/);
    expect(doc.estMinutes).toBe(20); // untouched
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("ISSUED: descriptive fields (totalMarks, setId) are still editable", async () => {
    const doc = makeItem({ status: "ISSUED" });
    mockItemFindById.mockReturnValue(doc);

    const r = await updateAssignmentItem({
      itemId: ITEM,
      totalMarks: 50,
      setId: "507f1f77bcf86cd799439099",
      actorId: OWNER,
    });

    expect(doc.totalMarks).toBe(50);
    expect(String(doc.setId)).toBe("507f1f77bcf86cd799439099");
    expect(r.totalMarks).toBe(50);
    expect(r.estMinutes).toBe(20); // unchanged, still reported
  });

  test("totalMarks cannot drop below a mark already given", async () => {
    mockItemFindById.mockReturnValue(makeItem({ status: "ISSUED" }));
    mockRecFindOne.mockResolvedValue({ _id: "rec-1" }); // someone scored above it

    await expect(
      updateAssignmentItem({ itemId: ITEM, totalMarks: 5, actorId: OWNER }),
    ).rejects.toThrow(/পূর্ণমান/);
  });

  test("blank setId clears the question-set link", async () => {
    const doc = makeItem({ setId: "507f1f77bcf86cd799439099" });
    mockItemFindById.mockReturnValue(doc);

    await updateAssignmentItem({ itemId: ITEM, setId: "  ", actorId: OWNER });
    expect(doc.setId).toBeUndefined();
  });

  test("another teacher cannot edit someone else's cell", async () => {
    mockItemFindById.mockReturnValue(makeItem());
    await expect(
      updateAssignmentItem({ itemId: ITEM, estMinutes: 45, actorId: OTHER }),
    ).rejects.toThrow(/দায়িত্বপ্রাপ্ত শিক্ষক/);
  });

  test("Principal/Office may correct any cell", async () => {
    const doc = makeItem();
    mockItemFindById.mockReturnValue(doc);

    await updateAssignmentItem({ itemId: ITEM, estMinutes: 30, actorId: OTHER, isAdmin: true });
    expect(doc.estMinutes).toBe(30);
  });
});

describe("deleteAssignmentItem (D-#352 DRAFT-only delete)", () => {
  test("a DRAFT delivery can be deleted by its teacher (the mistaken-delivery fix path)", async () => {
    mockItemFindById.mockReturnValue(makeItem());

    const r = await deleteAssignmentItem({ itemId: ITEM, actorId: OWNER });

    expect(r).toMatchObject({ asId: "AS-C4-MATH-0001" });
    expect(mockItemDeleteOne).toHaveBeenCalledWith({ _id: ITEM });
  });

  test("an ISSUED assignment is never deleted", async () => {
    mockItemFindById.mockReturnValue(makeItem({ status: "ISSUED" }));

    await expect(deleteAssignmentItem({ itemId: ITEM, actorId: OWNER })).rejects.toThrow(
      /ইস্যু হয়ে যাওয়া/,
    );
    expect(mockItemDeleteOne).not.toHaveBeenCalled();
  });

  test("a DRAFT that somehow has student records is refused (defensive)", async () => {
    mockItemFindById.mockReturnValue(makeItem());
    mockRecFindOne.mockResolvedValue({ _id: "rec-1" });

    await expect(deleteAssignmentItem({ itemId: ITEM, actorId: OWNER })).rejects.toThrow(
      /শিক্ষার্থী রেকর্ড/,
    );
    expect(mockItemDeleteOne).not.toHaveBeenCalled();
  });

  test("another teacher cannot delete someone else's cell", async () => {
    mockItemFindById.mockReturnValue(makeItem());
    await expect(deleteAssignmentItem({ itemId: ITEM, actorId: OTHER })).rejects.toThrow(
      /দায়িত্বপ্রাপ্ত শিক্ষক/,
    );
  });
});
