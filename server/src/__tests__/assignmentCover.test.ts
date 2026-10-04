/**
 * D-#707 — a delivery-day cover of the scheduled teacher's period takes over the
 * week's assignment (owner ruling 2026-10-02). DB-free: the three models are mocked.
 */
import mongoose from "mongoose";

const mockSlotFind = jest.fn();
const mockSubFind = jest.fn();
const mockCoverFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (f: unknown) => ({ select: () => ({ lean: () => mockSlotFind(f) }) }) },
}));
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({
  RoutineSubstitution: { find: (f: unknown) => ({ select: () => ({ lean: () => mockSubFind(f) }) }) },
}));
jest.mock("../modules/hr/models/StaffCoverSlot", () => ({
  StaffCoverSlot: { find: (f: unknown) => ({ select: () => ({ lean: () => mockCoverFind(f) }) }) },
}));

import { deliveryDayCovers, coverCellKey } from "../modules/trackers/assignmentCover";

const oid = () => new mongoose.Types.ObjectId();
const SEC = oid();
const MAHFUZ = oid();
const TAZKIR = oid();
const OTHER = oid();
const THU = new Date(2026, 9, 8); // a delivery Thursday
const cell = { sectionId: SEC.toString(), subject: "BAN", teacherId: MAHFUZ.toString() };

function slot(over: Record<string, unknown> = {}) {
  return { _id: oid(), groupId: SEC, subject: "BAN", teacherId: MAHFUZ, periodNumber: 5, ...over };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSubFind.mockResolvedValue([]);
  mockCoverFind.mockResolvedValue([]);
});

describe("deliveryDayCovers (D-#707)", () => {
  test("an approved HR cover of the scheduled teacher's period that day names the cover", async () => {
    const s = slot();
    mockSlotFind.mockResolvedValue([s]);
    mockCoverFind.mockResolvedValue([{ routineSlotId: s._id, finalCoverTeacherUserId: TAZKIR }]);
    const m = await deliveryDayCovers([cell], THU);
    expect(m.get(coverCellKey(cell))).toBe(TAZKIR.toString());
    // asks for that weekday's live section slots of that subject
    expect(mockSlotFind.mock.calls[0][0]).toMatchObject({ groupType: "section", dayOfWeek: "THU", isBreak: false });
  });

  test("a routine substitution works too; the HR cover wins when both name the slot", async () => {
    const s = slot();
    mockSlotFind.mockResolvedValue([s]);
    mockSubFind.mockResolvedValue([{ slotId: s._id, coverTeacherId: OTHER }]);
    expect((await deliveryDayCovers([cell], THU)).get(coverCellKey(cell))).toBe(OTHER.toString());
    mockCoverFind.mockResolvedValue([{ routineSlotId: s._id, finalCoverTeacherUserId: TAZKIR }]);
    expect((await deliveryDayCovers([cell], THU)).get(coverCellKey(cell))).toBe(TAZKIR.toString());
  });

  test("a cover of ANOTHER teacher's period (same section + subject) does not take the week", async () => {
    const s = slot({ teacherId: OTHER });
    mockSlotFind.mockResolvedValue([s]);
    mockCoverFind.mockResolvedValue([{ routineSlotId: s._id, finalCoverTeacherUserId: TAZKIR }]);
    expect((await deliveryDayCovers([cell], THU)).size).toBe(0);
    expect(mockCoverFind).not.toHaveBeenCalled(); // never even looked up
  });

  test("no period of that subject on the delivery day → no handover", async () => {
    mockSlotFind.mockResolvedValue([]);
    expect((await deliveryDayCovers([cell], THU)).size).toBe(0);
  });

  test("several periods that day: the earliest covered one decides", async () => {
    const p2 = slot({ periodNumber: 2 });
    const p6 = slot({ periodNumber: 6 });
    mockSlotFind.mockResolvedValue([p6, p2]);
    mockCoverFind.mockResolvedValue([
      { routineSlotId: p6._id, finalCoverTeacherUserId: OTHER },
      { routineSlotId: p2._id, finalCoverTeacherUserId: TAZKIR },
    ]);
    expect((await deliveryDayCovers([cell], THU)).get(coverCellKey(cell))).toBe(TAZKIR.toString());
  });

  test("an empty batch reads nothing", async () => {
    expect((await deliveryDayCovers([], THU)).size).toBe(0);
    expect(mockSlotFind).not.toHaveBeenCalled();
  });
});
