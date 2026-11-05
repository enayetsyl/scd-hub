/**
 * SB-7 — the all-rounder card (D-#987).
 *
 *   areas    each area's score + band by the D-#987 thresholds; class tests: at risk → মনোযোগ,
 *            rising from ≥ 60 → ভালো; assignments ½ on-time + ½ marks; reading from desk ticks
 *            in 30 days ÷ 4, capped at 100, only once the child has borrowed; activity = SOON
 *   overall  plain average of the areas WITH data (a missing one never pulls it down);
 *            ≥ 80 / 60–79 / < 60; strong count
 */
import { areasOf, overallOf, type AreaScore } from "../modules/trackers/services/AllRounderService";

const wp = (o: Partial<{ present: number; marked: number; avg: number | null; traj: string; atRisk: boolean; hw: number | null; total: number; pending: number; late: number; marks: number | null }> = {}) =>
  ({
    attendance: { markedDays: o.marked ?? 40, absentDays: 0, presentPct: o.present ?? 94, recentPresentPct: null, earlierPresentPct: null, trajectory: "flat" },
    classTest: { avgPercent: o.avg === undefined ? 86 : o.avg, trajectory: o.traj ?? "flat", atRisk: o.atRisk ?? false },
    homework: { total: 10, open: 0, done: 9, chased: 0, completionPct: o.hw === undefined ? 55 : o.hw },
    assignment: { total: o.total ?? 6, pending: o.pending ?? 0, late: o.late ?? 1, avgMarksPct: o.marks === undefined ? 70 : o.marks },
  }) as never;

const byArea = (areas: AreaScore[]) => Object.fromEntries(areas.map((a) => [a.area, [a.score, a.band]]));

describe("all-rounder", () => {
  it("scores and bands each area (the W5 mock-up numbers)", () => {
    const areas = areasOf(wp(), { read: 5, everBorrowed: true });
    expect(byArea(areas)).toEqual({
      ATTENDANCE: [94, "STRONG"],
      CLASS_TEST: [86, "STRONG"],
      HOMEWORK: [55, "ATTENTION"],
      ASSIGNMENT: [77, "OK"], // on-time 5/6 = 83.3, marks 70 → 76.7
      READING: [100, "STRONG"], // 5 ÷ 4, capped
      ACTIVITY: [null, "SOON"],
    });
    expect(overallOf(areas)).toEqual({ score: 82, band: "STRONG", strongCount: 3, countedAreas: 5 });
  });

  it("class tests: at risk overrides, rising from 60 counts as strong", () => {
    expect(byArea(areasOf(wp({ avg: 85, atRisk: true }), { read: 0, everBorrowed: false })).CLASS_TEST).toEqual([85, "ATTENTION"]);
    expect(byArea(areasOf(wp({ avg: 64, traj: "up" }), { read: 0, everBorrowed: false })).CLASS_TEST).toEqual([64, "STRONG"]);
    expect(byArea(areasOf(wp({ avg: 64 }), { read: 0, everBorrowed: false })).CLASS_TEST).toEqual([64, "OK"]);
  });

  it("one area alone shows its row but no overall headline", () => {
    const areas = areasOf(wp({ marked: 0, avg: null, hw: null, total: 0, pending: 0, late: 0 }), { read: 5, everBorrowed: true });
    expect(overallOf(areas)).toEqual({ score: null, band: "NONE", strongCount: 1, countedAreas: 1 });
  });

  it("missing data is not counted, and reading starts only after a first storybook", () => {
    const areas = areasOf(wp({ marked: 0, avg: null, hw: null, total: 0, pending: 0, late: 0 }), { read: 0, everBorrowed: false });
    expect(areas.every((a) => a.score === null)).toBe(true);
    expect(overallOf(areas)).toEqual({ score: null, band: "NONE", strongCount: 0, countedAreas: 0 });
    const reading = areasOf(wp(), { read: 1, everBorrowed: true }).find((a) => a.area === "READING")!;
    expect([reading.score, reading.band]).toEqual([25, "ATTENTION"]);
    expect(areasOf(wp(), { read: 2, everBorrowed: true }).find((a) => a.area === "READING")!.band).toBe("OK");
  });

  it("assignments fall back to on-time only when there are no marks; pending ones are not judged", () => {
    const a = areasOf(wp({ total: 4, pending: 2, late: 1, marks: null }), { read: 0, everBorrowed: false }).find((x) => x.area === "ASSIGNMENT")!;
    expect([a.score, a.band]).toEqual([50, "ATTENTION"]);
  });
});
