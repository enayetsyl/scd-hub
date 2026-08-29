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
}

/** One row as the form holds it, before validation. */
export interface AdjRow {
  key: string;
  staffProfileId: string;
  sign: "addition" | "deduction";
  type: string | null;
  amount: string;
  note: string;
}

const AMOUNT = /^\d+(\.\d+)?$/;

/** A row that can be sent: a person, a type, and a numeric amount. */
export function rowComplete(r: AdjRow): boolean {
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
    if (r.sign === "addition") adj.manualAdditions!.push(line);
    else adj.manualDeductions!.push(line);
  }
  return [...byStaff.values()];
}
