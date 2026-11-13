/**
 * dayStartMinutesOn picks the regular window IN FORCE on the date (owner 13 Nov 2026: school starts 07:30
 * from Sun 15 Nov). Before this, routineMaster / slotView / PendingAlertService took the earliest window of
 * the year, so a second window never took effect.
 */
const windows = [
  { fromDate: new Date(2026, 0, 1), toDate: new Date(2026, 10, 14), season: "regular", dayStartMinutes: 420, active: true },
  { fromDate: new Date(2026, 10, 15), toDate: new Date(2026, 11, 31), season: "regular", dayStartMinutes: 450, active: true },
];
jest.mock("../modules/foundation/services/currentYear", () => ({ currentYearFilter: async () => ({}) }));
jest.mock("../modules/routine/models/ScheduleWindow", () => ({
  ScheduleWindow: { find: () => ({ sort: () => ({ lean: async () => windows }) }) },
}));

import { dayStartMinutesOn, DEFAULT_DAY_START_MINUTES } from "../modules/routine/dayStart";

test("the last day of the old window is still 07:00", async () => {
  expect(await dayStartMinutesOn(new Date(2026, 10, 14, 9, 0))).toBe(420);
});

test("from 15 Nov the 07:30 window is in force", async () => {
  expect(await dayStartMinutesOn(new Date(2026, 10, 15, 6, 0))).toBe(450);
  expect(await dayStartMinutesOn(new Date(2026, 11, 20))).toBe(450);
});

test("a day outside every window falls back to the earliest window", async () => {
  expect(await dayStartMinutesOn(new Date(2027, 0, 5))).toBe(420);
});

test("the default is 07:00 when no window exists", () => {
  expect(DEFAULT_DAY_START_MINUTES).toBe(420);
});
