/**
 * D-#585 — per-staff payroll adjustments, the grouping half.
 *
 * `preparePayrollRun` keys adjustments BY STAFF, so two rows for the same person must
 * become one adjustment with two lines. Emitting two separate entries would mean the
 * second silently replaced the first and a payslip came out short — the kind of error
 * nobody notices until someone counts their pay.
 *
 * The helper lives in /shared: it is the shape of the contract between the form and the
 * mutation, and a server test cannot import across the app workspace's rootDir.
 */
import { buildAdjustments, rowComplete, rowStarted, type AdjRow } from "@scd/shared";

const STAFF_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const STAFF_B = "bbbbbbbbbbbbbbbbbbbbbbbb";

function row(over: Partial<AdjRow> = {}): AdjRow {
  return {
    key: "k",
    staffProfileId: STAFF_A,
    sign: "addition",
    type: "arrears",
    amount: "5000",
    note: "",
    ...over,
  };
}

describe("rowComplete / rowStarted", () => {
  test("a row needs a person, a type and a numeric amount", () => {
    expect(rowComplete(row())).toBe(true);
    expect(rowComplete(row({ staffProfileId: "" }))).toBe(false);
    expect(rowComplete(row({ type: null }))).toBe(false);
    expect(rowComplete(row({ amount: "" }))).toBe(false);
  });

  test("an amount typed as text is NOT a number — it must not reach the server as NaN", () => {
    // The D-#546-adjacent trap: Number("Tk. 5,000") is NaN, JSON serialises NaN as
    // null, and null reads server-side as "not provided".
    expect(rowComplete(row({ amount: "Tk. 5,000" }))).toBe(false);
    expect(rowComplete(row({ amount: "5000." }))).toBe(false);
    expect(rowComplete(row({ amount: "1234.50" }))).toBe(true);
  });

  test("a STARTED but unfinished row is distinguishable from an untouched one", () => {
    const blank: AdjRow = { key: "k", staffProfileId: "", sign: "addition", type: "arrears", amount: "", note: "" };
    expect(rowStarted(blank)).toBe(false);
    expect(rowStarted({ ...blank, amount: "500" })).toBe(true);
    expect(rowStarted({ ...blank, staffProfileId: STAFF_A })).toBe(true);
    expect(rowStarted({ ...blank, note: "arrears" })).toBe(true);
  });
});

describe("buildAdjustments", () => {
  test("two rows for the SAME person become one adjustment with two lines", () => {
    const out = buildAdjustments([
      row({ key: "1", amount: "5000", note: "July arrears" }),
      row({ key: "2", type: "bonus", amount: "1000" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].staffProfileId).toBe(STAFF_A);
    expect(out[0].manualAdditions).toEqual([
      { type: "arrears", amount: 5000, note: "July arrears" },
      { type: "bonus", amount: 1000, note: null },
    ]);
    expect(out[0].manualDeductions).toEqual([]);
  });

  test("additions and deductions land on their own sides", () => {
    const out = buildAdjustments([
      row({ key: "1", amount: "5000" }),
      row({ key: "2", sign: "deduction", type: "other", amount: "250" }),
    ]);
    expect(out[0].manualAdditions).toHaveLength(1);
    expect(out[0].manualDeductions).toEqual([{ type: "other", amount: 250, note: null }]);
  });

  test("different people get separate adjustments", () => {
    const out = buildAdjustments([
      row({ key: "1" }),
      row({ key: "2", staffProfileId: STAFF_B, amount: "700" }),
    ]);
    expect(out.map((a) => a.staffProfileId)).toEqual([STAFF_A, STAFF_B]);
  });

  test("incomplete rows are dropped, not sent as zeroes", () => {
    const out = buildAdjustments([
      row({ key: "1", staffProfileId: "" }),
      row({ key: "2", amount: "abc" }),
    ]);
    expect(out).toEqual([]);
  });

  test("an empty list produces no adjustments at all — the run computes as before", () => {
    expect(buildAdjustments([])).toEqual([]);
  });
});
