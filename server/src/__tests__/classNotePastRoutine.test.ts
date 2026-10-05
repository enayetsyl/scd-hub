/**
 * Class notes after a routine change (owner report 2026-10-05) — Kawsar could not see his
 * own 30 Sep notes for C4 Bangla / C5 BGS once the 1 Oct gender split moved those periods
 * to new sections: section read-scope follows TODAY's routine, so the old সম্মিলিত section
 * refused him. `ownSlotIdsOn` is the date-scoped fallback: the caller's own slots in the
 * group that were live on THAT date.
 */
import { Types } from "mongoose";

const mockSlotFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (q: unknown) => ({ select: () => ({ lean: () => mockSlotFind(q) }) }) },
}));
jest.mock("../modules/notifications/services/emitters", () => ({
  emitClassNotePublished: jest.fn(),
}));

import { ownSlotIdsOn } from "../modules/routine/services/RoutineTriggerService";

type Slot = { _id: Types.ObjectId; effectiveFrom: Date; effectiveTo: Date | null };

/** Apply the query's live-window clause the way Mongo would — enough to tell old from new. */
function matches(q: Record<string, any>, s: Slot): boolean {
  if (!(s.effectiveFrom.getTime() <= q.effectiveFrom.$lte.getTime())) return false;
  return (q.$or as Array<Record<string, any>>).some((c) =>
    "effectiveTo" in c && c.effectiveTo && c.effectiveTo.$gte
      ? !!s.effectiveTo && s.effectiveTo.getTime() >= c.effectiveTo.$gte.getTime()
      : s.effectiveTo === null,
  );
}

const teacher = new Types.ObjectId().toString();
const section = new Types.ObjectId().toString();
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms);
// The split: the old সম্মিলিত slot closes at the end of 30 Sep; the new one opens 1 Oct.
const oldSlot: Slot = { _id: new Types.ObjectId(), effectiveFrom: local(2026, 1, 1), effectiveTo: local(2026, 9, 30, 23, 59, 59, 999) };
const newSlot: Slot = { _id: new Types.ObjectId(), effectiveFrom: local(2026, 10, 1), effectiveTo: null };

beforeEach(() => {
  mockSlotFind.mockReset();
  mockSlotFind.mockImplementation(async (q: Record<string, any>) => [oldSlot, newSlot].filter((s) => matches(q, s)));
});

describe("ownSlotIdsOn — what the teacher taught on that date", () => {
  test("the day before the split finds the OLD slot only; the day after, the new one", async () => {
    const before = await ownSlotIdsOn(teacher, "section", section, local(2026, 9, 30));
    expect([...before]).toEqual([oldSlot._id.toString()]);
    const after = await ownSlotIdsOn(teacher, "section", section, local(2026, 10, 1));
    expect([...after]).toEqual([newSlot._id.toString()]);
  });

  test("the query is the caller's own slots, in this group, on that weekday", async () => {
    await ownSlotIdsOn(teacher, "section", section, local(2026, 9, 30)); // a Wednesday
    const q = mockSlotFind.mock.calls[0][0] as Record<string, any>;
    expect(q.teacherId.toString()).toBe(teacher);
    expect(q.groupId.toString()).toBe(section);
    expect(q.groupType).toBe("section");
    expect(q.dayOfWeek).toBe("WED");
  });

  test("a bad id never queries and grants nothing", async () => {
    expect((await ownSlotIdsOn("nope", "section", section, local(2026, 9, 30))).size).toBe(0);
    expect(mockSlotFind).not.toHaveBeenCalled();
  });
});
