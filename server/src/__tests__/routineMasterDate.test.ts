/**
 * Full routine grid for a chosen date — `routineMasterWeek(on)` must read the routine
 * in force ON that date (so a saved change effective tomorrow can be previewed today),
 * and default to today when no date is given.
 */
const find = jest.fn();
const lean = (v: unknown) => ({ lean: jest.fn().mockResolvedValue(v) });

jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (...a: unknown[]) => { find(...a); return { sort: () => lean([]) }; } },
}));
jest.mock("../modules/foundation/models/Section", () => ({ Section: { find: () => lean([]) } }));
jest.mock("../modules/foundation/models/Class", () => ({ Class: { find: () => lean([]) } }));
jest.mock("../modules/routine/models/SubjectGroup", () => ({ SubjectGroup: { find: () => lean([]) } }));
jest.mock("../modules/routine/models/PeriodGrid", () => ({ PeriodGrid: { findOne: () => lean(null) } }));
jest.mock("../modules/routine/models/ScheduleWindow", () => ({
  ScheduleWindow: { findOne: () => ({ sort: () => lean(null) }) },
}));
jest.mock("../modules/routine/slotView", () => ({ enrichRoutineSlots: jest.fn().mockResolvedValue([]) }));

import { routineMasterWeek } from "../modules/routine/routineMaster";
import { liveWindow } from "../modules/routine/liveWindow";

beforeEach(() => find.mockClear());

test("reads each weekday's slots with the window of the requested date", async () => {
  const on = new Date(2026, 9, 1);
  const week = await routineMasterWeek(on);
  expect(week.map((m) => m.day)).toEqual(["SUN", "MON", "TUE", "WED", "THU"]);
  expect(find).toHaveBeenCalledTimes(5);
  for (const [filter] of find.mock.calls) {
    expect(filter).toMatchObject({ active: true, ...liveWindow(on) });
  }
});

test("a future date and today produce different windows (the preview is not today)", async () => {
  await routineMasterWeek(new Date(2026, 9, 1));
  const future = find.mock.calls[0][0];
  find.mockClear();
  await routineMasterWeek(new Date(2026, 8, 30));
  const today = find.mock.calls[0][0];
  expect(future).not.toEqual(today);
});

test("defaults to today when no date is given", async () => {
  await routineMasterWeek();
  expect(find.mock.calls[0][0]).toMatchObject({ active: true, ...liveWindow(new Date()) });
});
