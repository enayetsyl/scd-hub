/**
 * Per-staff payroll adjustment rows → the shape `preparePayrollRun` takes (D-#585).
 *
 * Kept out of the screen so it can be tested: the grouping is the part that can be
 * wrong in a way nobody notices until a payslip is short. Two rows for the same person
 * must become ONE adjustment with two lines — the server keys adjustments by staff, so
 * two separate entries would mean the second silently replaced the first.
 *
 * It lives in /shared rather than in the app because it is the SHAPE OF A CONTRACT between
 * the form and `preparePayrollRun`, and because a test cannot import across the server
 * workspace's rootDir. Pure TypeScript, no React Native imports.
 */

export interface PayLineInput {
  type: string;
  amount: number;
  note?: string | null;
}

export interface StaffPayrollAdjustment {
  staffProfileId: string;
  payableDays?: number | null;
  latenessDeduction?: number | null;
  manualDeductions?: PayLineInput[];
  manualAdditions?: PayLineInput[];
  /** Days of a negative leave balance settled by agreement this month (D-#617). */
  leaveRecoveryDays?: number | null;
  leaveRecoveryNote?: string | null;
  /** Days of HELD probation leave charged to this month's pay, by choice (D-#898). */
  probationChargeDays?: number | null;
  probationChargeNote?: string | null;
  /** Days of lateness charged this month, by choice, and where they land (D-#908). */
  latenessChargeDays?: number | null;
  latenessChargeTo?: "salary" | "leave" | null;
  /**
   * Recover the outstanding advance in THIS run (D-#622). A one-off recovers only
   * when this is true — it takes the whole balance, so it is chosen, not assumed;
   * an installment keeps running unless this is false.
   */
  recoverAdvance?: boolean | null;
}

/** One row as the form holds it, before validation. */
export interface AdjRow {
  key: string;
  staffProfileId: string;
  /**
   * "leave_recovery" is not a money line: the AMOUNT is read as DAYS of a negative
   * leave balance the staff member agreed to settle, and the server turns it into both
   * a deduction and a credit back to the balance (D-#617). Keeping it in the same row
   * shape means the office enters it where they already enter everything else.
   */
  sign: "addition" | "deduction" | "leave_recovery" | "advance_recovery";
  type: string | null;
  amount: string;
  note: string;
}

const AMOUNT = /^\d+(\.\d+)?$/;

/** A row that can be sent: a person, a type, and a numeric amount. */
export function rowComplete(r: AdjRow): boolean {
  // A recovery row carries days in `amount` and needs no money type.
  if (r.sign === "leave_recovery") return r.staffProfileId !== "" && AMOUNT.test(r.amount.trim());
  return r.staffProfileId !== "" && r.type !== null && AMOUNT.test(r.amount.trim());
}

/** A row the operator has STARTED but not finished — a mistake, not an empty row. */
export function rowStarted(r: AdjRow): boolean {
  return r.staffProfileId !== "" || r.amount.trim() !== "" || r.note.trim() !== "";
}

export function buildAdjustments(rows: AdjRow[]): StaffPayrollAdjustment[] {
  const byStaff = new Map<string, StaffPayrollAdjustment>();
  for (const r of rows) {
    if (!rowComplete(r)) continue;
    const line: PayLineInput = {
      type: r.type as string,
      amount: Number(r.amount.trim()),
      note: r.note.trim() || null,
    };
    let adj = byStaff.get(r.staffProfileId);
    if (!adj) {
      adj = { staffProfileId: r.staffProfileId, manualAdditions: [], manualDeductions: [] };
      byStaff.set(r.staffProfileId, adj);
    }
    if (r.sign === "advance_recovery") {
      // The row IS the instruction — the amount is the loan's own balance, not typed.
      adj.recoverAdvance = true;
    } else if (r.sign === "leave_recovery") {
      // Days, not taka — and the server prices them at that month's day-rate.
      adj.leaveRecoveryDays = line.amount;
      adj.leaveRecoveryNote = line.note ?? null;
    } else if (r.sign === "addition") adj.manualAdditions!.push(line);
    else adj.manualDeductions!.push(line);
  }
  return [...byStaff.values()];
}

/**
 * One row of the prepare screen's "charge leave to salary" list (D-#898).
 *
 * The list comes from the server (`leaveChargeCandidates`): who is over, which kind, and
 * the most that may be charged. The operator turns a row ON and may lower the days.
 * Off is the default — nothing is charged that nobody chose.
 */
export interface LeaveChargePick {
  staffProfileId: string;
  kind: "probation" | "overdrawn";
  /** The most that may be charged (from the server). */
  maxDays: number;
  on: boolean;
  /** As typed; starts at `maxDays`. */
  days: string;
}

/** A switched-on row whose days are a number in (0, maxDays]. */
export function pickValid(p: LeaveChargePick): boolean {
  if (!p.on) return true;
  if (!AMOUNT.test(p.days.trim())) return false;
  const d = Number(p.days.trim());
  return d > 0 && d <= p.maxDays + 0.01;
}

/**
 * Fold the switched-on rows into the adjustments, one per person — merged into a
 * person's existing adjustment rather than added beside it, because the server keys
 * adjustments by staff and a second entry would silently replace the first.
 */
export function applyLeaveCharges(
  adjustments: StaffPayrollAdjustment[],
  picks: LeaveChargePick[],
): StaffPayrollAdjustment[] {
  const out = adjustments.map((a) => ({ ...a }));
  for (const p of picks) {
    if (!p.on || !pickValid(p)) continue;
    const days = Number(p.days.trim());
    let adj = out.find((a) => a.staffProfileId === p.staffProfileId);
    if (!adj) {
      adj = { staffProfileId: p.staffProfileId };
      out.push(adj);
    }
    if (p.kind === "probation") adj.probationChargeDays = days;
    else adj.leaveRecoveryDays = days;
  }
  return out;
}

/**
 * One row of the prepare screen's per-person lateness card (D-#908). The list comes from
 * `latenessChargeCandidates`; the operator turns a row on, may lower the days, and picks
 * where they land — salary (a বিলম্ব কর্তন line) or the leave balance. Off by default.
 */
export interface LatenessPick {
  staffProfileId: string;
  /** floor(late marks / lateDaysPerCharge), from the server. */
  maxDays: number;
  on: boolean;
  days: string;
  to: "salary" | "leave";
}

/** A switched-on row needs days in (0, maxDays]; an off row is always fine. */
export function latenessPickValid(p: LatenessPick): boolean {
  return pickValid({ staffProfileId: p.staffProfileId, kind: "overdrawn", maxDays: p.maxDays, on: p.on, days: p.days });
}

/** Fold the switched-on lateness rows into the adjustments, one entry per person. */
export function applyLatenessCharges(
  adjustments: StaffPayrollAdjustment[],
  picks: LatenessPick[],
): StaffPayrollAdjustment[] {
  const out = adjustments.map((a) => ({ ...a }));
  for (const p of picks) {
    if (!p.on || !latenessPickValid(p)) continue;
    let adj = out.find((a) => a.staffProfileId === p.staffProfileId);
    if (!adj) {
      adj = { staffProfileId: p.staffProfileId };
      out.push(adj);
    }
    adj.latenessChargeDays = Number(p.days.trim());
    adj.latenessChargeTo = p.to;
  }
  return out;
}
