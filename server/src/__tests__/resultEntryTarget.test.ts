/**
 * Result-entry target (owner ask 2026-10-14, D-#739) — the pure backlog maths, on Akter's
 * real Arabic backlog: Book 1 14×4, Book 2 21×6, Book 3 13×4, Level 4 9×4 = 270 results,
 * promised by Thu 22 Oct 2026, counted from Wed 14 Oct. Sun–Thu working ⇒ 7 working days
 * (14, 15, 18, 19, 20, 21, 22), so the running target is ceil(270k/7):
 * 39, 78, 116, 155, 193, 232, 270.
 */
import { buildEntryTargetProgress, type EntryTargetLineInput } from "../modules/trackers/services/ResultEntryTargetService";

const sunToThu = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return [0, 1, 2, 3, 4].includes(new Date(y, m - 1, d).getDay());
};
const times = (k: string, n: number) => Array.from({ length: n }, () => k);

const lines = (entries: Partial<Record<string, string[]>> = {}): EntryTargetLineInput[] => [
  { label: "বুক ১", students: 14, tests: 4, testsFound: 4, entryDays: entries["বুক ১"] ?? [] },
  { label: "বুক ২", students: 21, tests: 6, testsFound: 6, entryDays: entries["বুক ২"] ?? [] },
  { label: "বুক ৩", students: 13, tests: 4, testsFound: 4, entryDays: entries["বুক ৩"] ?? [] },
  { label: "লেভেল ৪", students: 9, tests: 4, testsFound: 3, entryDays: entries["লেভেল ৪"] ?? [] },
];
const base = { subject: "ARABIC", startKey: "2026-10-14", dueKey: "2026-10-22", isWorking: sunToThu };

describe("buildEntryTargetProgress", () => {
  test("first day: 270 spread over 7 working days, the plan listed to the due day", () => {
    const p = buildEntryTargetProgress({ ...base, todayKey: "2026-10-14", lines: lines() });
    expect(p).toMatchObject({ total: 270, enteredTotal: 0, remaining: 270, todayWorking: true, todayTarget: 39, neededToday: 39 });
    expect(p).toMatchObject({ diffThroughYesterday: 0, workingDaysLeft: 7, perDayToFinish: 39, done: false, overdue: false });
    expect(p.days.map((d) => [d.dateKey.slice(8), d.expected, d.future])).toEqual([
      ["14", 39, false],
      ["15", 78, true],
      ["18", 116, true],
      ["19", 155, true],
      ["20", 193, true],
      ["21", 232, true],
      ["22", 270, true],
    ]);
  });

  test("mid-way: a line is capped at students × tests, a Friday entry still counts", () => {
    const p = buildEntryTargetProgress({
      ...base,
      todayKey: "2026-10-18",
      lines: lines({ "বুক ২": times("2026-10-14", 30), "বুক ১": times("2026-10-15", 60), "বুক ৩": times("2026-10-16", 10) }),
    });
    expect(p.lines.map((l) => [l.label, l.total, l.entered, l.remaining])).toEqual([
      ["বুক ১", 56, 56, 0],
      ["বুক ২", 126, 30, 96],
      ["বুক ৩", 52, 10, 42],
      ["লেভেল ৪", 36, 0, 36],
    ]);
    const row = (k: string) => p.days.find((d) => d.dateKey === k)!;
    expect(row("2026-10-15")).toMatchObject({ entered: 56, cumulative: 86, expected: 78, diff: 8 });
    expect(row("2026-10-16")).toMatchObject({ working: false, entered: 10, cumulative: 96, expected: 78 });
    expect(p.days.some((d) => d.dateKey === "2026-10-17")).toBe(false);
    expect(p).toMatchObject({ enteredThroughYesterday: 96, expectedThroughYesterday: 78, diffThroughYesterday: 18 });
    expect(p).toMatchObject({ todayTarget: 38, neededToday: 20, remaining: 174, workingDaysLeft: 5, perDayToFinish: 35 });
    expect(p.lines[3].testsFound).toBe(3);
  });

  test("a school holiday in the window spreads the backlog over fewer days", () => {
    const isWorking = (k: string) => sunToThu(k) && k !== "2026-10-20";
    const p = buildEntryTargetProgress({ ...base, isWorking, todayKey: "2026-10-14", lines: lines() });
    expect(p.days.map((d) => d.expected)).toEqual([45, 90, 135, 180, 225, 270]);
    expect(p.days.some((d) => d.dateKey === "2026-10-20")).toBe(false);
  });

  test("past the due day with a shortfall: overdue, the whole rest is owed", () => {
    const p = buildEntryTargetProgress({
      ...base,
      todayKey: "2026-10-25",
      lines: lines({ "বুক ২": times("2026-10-19", 126), "বুক ১": times("2026-10-20", 56), "বুক ৩": times("2026-10-21", 18) }),
    });
    expect(p).toMatchObject({ enteredTotal: 200, remaining: 70, overdue: true, done: false, todayWorking: false });
    expect(p).toMatchObject({ todayTarget: 0, neededToday: 70, workingDaysLeft: 0, perDayToFinish: 0 });
    expect(p.days.every((d) => !d.future)).toBe(true);
  });

  test("all 270 in: done", () => {
    const p = buildEntryTargetProgress({
      ...base,
      todayKey: "2026-10-21",
      lines: lines({
        "বুক ১": times("2026-10-15", 56),
        "বুক ২": times("2026-10-19", 126),
        "বুক ৩": times("2026-10-20", 52),
        "লেভেল ৪": times("2026-10-21", 36),
      }),
    });
    expect(p).toMatchObject({ enteredTotal: 270, remaining: 0, done: true, neededToday: 0, perDayToFinish: 0 });
  });

  test("before any working day the target is zero; starting after today yields no days", () => {
    const p = buildEntryTargetProgress({ ...base, todayKey: "2026-10-13", lines: lines() });
    expect(p.days.filter((d) => !d.future)).toEqual([]);
  });
});
