/**
 * "What moves the marks" (D-#905/#906).
 *
 *  1. The ported statistics reproduce the 23-Sep published page from its own 66 anonymous
 *     points ([level, attendance %, homework %, assignment %, result %], copied from the
 *     artifact). Those points are rounded to 0.1 (attendance to whole percent), so figures
 *     are matched to the rounding, not to the last digit.
 *  2. The frozen definitions: GIVEN and ABSENT_REDELIVER count neither way; minimums
 *     withhold a figure rather than report it off two records.
 *  3. The gate: the `reports:marks_drivers` switch opens the field; nothing else does.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";

jest.mock("../modules/reports/services/MarksDriversService", () => {
  const actual = jest.requireActual("../modules/reports/services/MarksDriversService");
  return { ...actual, marksDriversReport: jest.fn(async () => ({})) };
});

import { builder } from "../schema";
import "../modules/reports/resolvers/marksDrivers";
import {
  childRow,
  computeFigures,
  pearson,
  pval,
  type ChildRow,
  type ChildInput,
} from "../modules/reports/services/marksDriversStats";

// prettier-ignore
const PUBLISHED: Array<[number, number, number, number, number]> = [[0,97,84.6,88,19],[2,78,86.4,96.3,81.2],[3,100,87,100,74.5],[5,95,98.3,100,85.8],[1,78,75.3,83.3,66.4],[2,95,76.8,89.7,65],[3,82,19.3,36.6,47.2],[1,85,87.3,94.4,79.5],[4,100,84,100,82],[4,78,72,81.3,59],[0,82,73.9,76,86.3],[4,89,83.5,91.2,66.2],[4,75,62.9,78.1,51.5],[2,68,71.2,84.2,64.1],[2,100,93.1,96.8,48.6],[3,92,53.9,63.4,51],[3,83,55.4,65.9,26.5],[3,100,16.3,18.4,38.5],[3,75,67.7,87.5,57.7],[4,94,73.4,88.9,63.6],[4,100,84.4,94.1,80.4],[4,93,89.8,94.4,81.8],[5,100,91.6,87.2,81.3],[5,97,79.5,91.9,67.3],[5,100,60.3,72.7,76.7],[5,33,56.3,36.4,57.3],[2,90,97.1,96.4,79.3],[3,75,70,81.5,56.8],[4,55,48.8,58.8,52.2],[3,100,64.5,80.5,22.9],[3,92,82.4,92.7,62.4],[3,100,77.9,87.8,58.6],[5,97,73.2,78.1,65.4],[0,92,57.9,100,98],[0,98,100,100,96],[1,97,89,100,61.2],[1,87,93.6,100,73.4],[2,92,93.1,100,76.8],[2,87,56.3,51.6,59.7],[4,100,85,77.8,68.3],[5,94,83.7,89.2,71.9],[5,97,78.8,92.1,79],[0,88,38.2,47.4,68],[0,93,95,96.2,48.8],[3,92,44.1,58.6,70.3],[3,67,70,80,68.1],[3,83,81.7,92.7,59.8],[1,85,66.2,85,64.7],[2,100,95.8,100,64.8],[0,88,87.7,81.8,98],[0,93,88.5,96.2,68],[4,100,74,91.7,75],[4,97,61.1,63.9,81],[1,87,84,95,38.4],[2,92,91.3,100,85],[2,100,76.3,96.8,56.9],[2,98,64.3,61.3,76.9],[3,100,50.9,62.9,45.9],[4,92,28.3,33.3,51.3],[0,87,78.4,92,95],[2,97,90.4,100,70.8],[2,88,86.4,100,75.4],[1,93,93.6,100,78.1],[2,100,97.2,96.8,83.3],[3,92,42.2,34.4,40],[3,98,78,85,55]];

const publishedRows: ChildRow[] = PUBLISHED.map(([level, att, hw, as, pct]) => ({
  level,
  heldDays: 60,
  absentDays: Math.round(60 * (1 - att / 100)),
  att: att / 100,
  pct,
  hwDone: hw / 100,
  hwQual: null,
  hwAbsent: null,
  asDone: as / 100,
  asQual: null,
}));

describe("marks drivers — reproduces the 23-Sep published page", () => {
  const f = computeFigures(publishedRows);
  const r = (k: string) => f.correlations.find((c) => c.key === k)!;

  it("66 children with a result", () => {
    expect(f.withResult).toBe(66);
  });
  it("homework submission r ≈ 0.436, significant", () => {
    expect(r("hwDone").r).toBeCloseTo(0.436, 2);
    expect(r("hwDone").p).toBeLessThan(0.001);
    expect(r("hwDone").significant).toBe(true);
  });
  it("assignment submission r ≈ 0.426", () => {
    expect(r("asDone").r).toBeCloseTo(0.426, 2);
  });
  it("attendance r ≈ 0.11 and NOT significant", () => {
    expect(Math.abs((r("att").r ?? 0) - 0.111)).toBeLessThan(0.01);
    expect(r("att").significant).toBe(false);
  });
  it("homework thirds 57.4 → 65.3 → 75.4", () => {
    const t = f.tertiles.find((x) => x.key === "hwDone")!;
    expect(t.bottom).toBeCloseTo(57.4, 0);
    expect(t.middle).toBeCloseTo(65.3, 0);
    expect(t.top).toBeCloseTo(75.4, 0);
  });
  it("attendance thirds land within three marks of each other", () => {
    const t = f.tertiles.find((x) => x.key === "att")!;
    expect(Math.abs((t.top ?? 0) - (t.bottom ?? 0))).toBeLessThan(4);
  });
  it("below 85%: 14 children averaging 59.6 against 67.8", () => {
    expect(f.below85.nBelow).toBe(14);
    expect(f.below85.below).toBeCloseTo(59.6, 0);
    expect(f.below85.above).toBeCloseTo(67.8, 0);
  });
  it("attendance bands match the published counts", () => {
    expect(f.bands.map((b) => b.n)).toEqual([4, 6, 4, 10, 15, 27]);
  });
  it("Class 4 + 5 pooled: attendance tracks results strongly (20 children)", () => {
    expect(f.senior.n).toBe(20);
    expect(f.senior.r ?? 0).toBeGreaterThan(0.6);
  });
  it("effect: attendance ≈ 4 marks, homework ≈ 17.5", () => {
    const e = (k: string) => f.effects.find((x) => x.key === k)!.marks;
    expect(e("att")).toBeGreaterThan(2);
    expect(e("att")).toBeLessThan(6);
    expect(e("hwDone")).toBeCloseTo(17.5, 0);
  });
  it("no id or name rides on a scatter point", () => {
    expect(Object.keys(f.points[0]).sort()).toEqual(["att", "hwDone", "level", "result"]);
  });
});

describe("marks drivers — frozen definitions", () => {
  const rec = (state: string, result: string | null = null) => ({ state, result, chaseCount: 0 });
  const base: ChildInput = { level: 3, attendance: { held: 20, absent: 2 }, tests: [], homework: [], assignments: [] };

  it("GIVEN and ABSENT_REDELIVER count neither as submitted nor as missed", () => {
    const row = childRow({
      ...base,
      homework: [rec("SUBMITTED"), rec("CHECKED"), rec("RETURNED"), rec("CHASE"), rec("DUE"), rec("GIVEN"), rec("ABSENT_REDELIVER"), rec("ABSENT_REDELIVER")],
    });
    expect(row.hwDone).toBeCloseTo(3 / 5, 6);
    expect(row.hwAbsent).toBeCloseTo(2 / 8, 6);
  });
  it("quality scores CORRECT 1, PARTIAL 0.5, WRONG 0", () => {
    const row = childRow({
      ...base,
      homework: [rec("CHECKED", "CORRECT"), rec("CHECKED", "CORRECT"), rec("CHECKED", "PARTIAL"), rec("CHECKED", "WRONG"), rec("CHECKED", "PARTIAL")],
    });
    expect(row.hwQual).toBeCloseTo(3 / 5, 6);
  });
  it("a result needs three PRESENT papers; ABSENT papers are left out", () => {
    const two = childRow({ ...base, tests: [{ status: "PRESENT", marks: 10, totalMarks: 20 }, { status: "PRESENT", marks: 20, totalMarks: 20 }, { status: "ABSENT", marks: null, totalMarks: 20 }] });
    expect(two.pct).toBeNull();
    const three = childRow({ ...base, tests: [{ status: "PRESENT", marks: 10, totalMarks: 20 }, { status: "PRESENT", marks: 20, totalMarks: 20 }, { status: "PRESENT", marks: 15, totalMarks: 20 }] });
    expect(three.pct).toBeCloseTo(75, 6);
  });
  it("attendance is withheld under ten marked days", () => {
    expect(childRow({ ...base, attendance: { held: 9, absent: 0 } }).att).toBeNull();
    expect(childRow({ ...base, attendance: { held: 20, absent: 5 } }).att).toBeCloseTo(0.75, 6);
  });
  it("too few children reports no correlation rather than a noisy one", () => {
    const f = computeFigures(publishedRows.slice(0, 5));
    expect(f.correlations.every((c) => c.r === null && !c.significant)).toBe(true);
    expect(f.tertiles.every((t) => t.bottom === null)).toBe(true);
  });
  it("pearson / pval primitives", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 9);
    expect(pval(0.5, 20)).toBeCloseTo(0.0248, 3);
  });
});

builder.mutationField("zzMarksDriversNoop", (t) => t.boolean({ resolve: () => true }));
const schema = builder.toSchema();
mongoose.set("bufferCommands", false);

const ME = new mongoose.Types.ObjectId().toString();
const QUERY = `query { marksDrivers(window: "d90") { __typename } }`;
const run = (role: string, granted: string[] = []): Promise<ExecutionResult> =>
  graphql({ schema, source: QUERY, contextValue: { auth: { role, userId: ME, grantedPermissions: granted } } }) as Promise<ExecutionResult>;
const refused = (r: ExecutionResult): boolean => (r.errors ?? []).some((e) => /Not authorized/i.test(e.message));

describe("marks drivers — gate (D-#905)", () => {
  it("the switch alone opens it for a teacher", async () => {
    expect(refused(await run("TEACHER", ["reports:marks_drivers"]))).toBe(false);
  });
  it("the Principal holds it by default", async () => {
    expect(refused(await run("PRINCIPAL"))).toBe(false);
  });
  it("a plain teacher is refused", async () => {
    expect(refused(await run("TEACHER"))).toBe(true);
  });
  it("Office is refused by default", async () => {
    expect(refused(await run("OFFICE"))).toBe(true);
  });
  it("another report switch does not open it", async () => {
    expect(refused(await run("TEACHER", ["reports:student_progress"]))).toBe(true);
  });
});
