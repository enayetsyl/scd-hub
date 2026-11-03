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
import {
  buildAdjustments,
  rowComplete,
  rowStarted,
  applyLeaveCharges,
  applyLatenessCharges,
  pickValid,
  type AdjRow,
  type LeaveChargePick,
  type LatenessPick,
} from "@scd/shared";

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

  test("an advance-recovery row needs only a person (the screen has no type or amount for it)", () => {
    const adv = row({ sign: "advance_recovery", type: null, amount: "" });
    expect(rowComplete(adv)).toBe(true);
    expect(rowComplete({ ...adv, staffProfileId: "" })).toBe(false);
    expect(buildAdjustments([adv])).toEqual([
      { staffProfileId: STAFF_A, manualAdditions: [], manualDeductions: [], recoverAdvance: true },
    ]);
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

describe("applyLeaveCharges — the optional leave-to-salary switches (D-#898)", () => {
  function pick(over: Partial<LeaveChargePick> = {}): LeaveChargePick {
    return { staffProfileId: STAFF_A, kind: "probation", maxDays: 5, on: true, days: "5", ...over };
  }

  test("a row left OFF charges nothing — off is the default and the run is unchanged", () => {
    expect(applyLeaveCharges([], [pick({ on: false })])).toEqual([]);
  });

  test("probation charges go to probationChargeDays, an overdrawn balance to leaveRecoveryDays", () => {
    expect(
      applyLeaveCharges([], [pick({ days: "3" }), pick({ staffProfileId: STAFF_B, kind: "overdrawn", days: "2" })]),
    ).toEqual([
      { staffProfileId: STAFF_A, probationChargeDays: 3 },
      { staffProfileId: STAFF_B, leaveRecoveryDays: 2 },
    ]);
  });

  test("merges into the person's existing adjustment instead of adding one the server would drop", () => {
    const manual = buildAdjustments([row({ sign: "deduction", type: "other", amount: "500" })]);
    const out = applyLeaveCharges(manual, [pick({ days: "2" })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ staffProfileId: STAFF_A, probationChargeDays: 2 });
    expect(out[0].manualDeductions).toHaveLength(1);
  });

  test("days must be above zero and within the most that may be charged; a partial day is fine", () => {
    expect(pickValid(pick({ days: "0" }))).toBe(false);
    expect(pickValid(pick({ days: "6" }))).toBe(false);
    expect(pickValid(pick({ days: "abc" }))).toBe(false);
    expect(pickValid(pick({ days: "2.5" }))).toBe(true);
    expect(pickValid(pick({ on: false, days: "abc" }))).toBe(true);
    expect(applyLeaveCharges([], [pick({ days: "9" })])).toEqual([]);
  });
});

describe("applyLatenessCharges — the per-person lateness switches (D-#908)", () => {
  const late = (over: Partial<LatenessPick> = {}): LatenessPick => ({
    staffProfileId: STAFF_A, maxDays: 3, on: true, days: "3", to: "salary", ...over,
  });

  test("off charges nothing; on carries the days and where they land", () => {
    expect(applyLatenessCharges([], [late({ on: false })])).toEqual([]);
    expect(applyLatenessCharges([], [late({ days: "2", to: "leave" })])).toEqual([
      { staffProfileId: STAFF_A, latenessChargeDays: 2, latenessChargeTo: "leave" },
    ]);
  });

  test("merges into the same person's leave charge rather than adding a second entry", () => {
    const withLeave = applyLeaveCharges([], [{ staffProfileId: STAFF_A, kind: "overdrawn", maxDays: 5, on: true, days: "5" }]);
    expect(applyLatenessCharges(withLeave, [late()])).toEqual([
      { staffProfileId: STAFF_A, leaveRecoveryDays: 5, latenessChargeDays: 3, latenessChargeTo: "salary" },
    ]);
  });

  test("more days than the late marks allow are dropped", () => {
    expect(applyLatenessCharges([], [late({ days: "4" })])).toEqual([]);
  });
});
