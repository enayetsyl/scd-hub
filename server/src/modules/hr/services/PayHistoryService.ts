/**
 * PayHistoryService (D-#587) — what someone earned, and from when.
 *
 * Two jobs, and the second is the one that changes behaviour:
 *
 *   recordPayChange     — writes a row when a salary is set, with the month it takes
 *                         effect. Called by `setStaffPay`, never on its own.
 *   salaryForMonth      — the figure that applies to a given month: the latest change
 *                         with `effectiveFrom` ≤ that month.
 *
 * FALLING BACK IS THE WHOLE COMPATIBILITY STORY. Nobody has history rows today, so
 * `salaryForMonth` returns the profile's current `monthlySalary` for every staff member
 * until a change is recorded through the new path — which means landing this cannot
 * move a single figure on a run prepared tomorrow. Rows only start mattering once
 * someone deliberately backdates a raise, which is exactly when they should.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import { StaffPayChange, type IStaffPayChange } from "../models/StaffPayChange";
import { writeAudit } from "../../platform/services/AuditService";
import { PayrollError } from "./payrollMath";

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function assertMonthKeyStrict(monthKey: string): void {
  if (!MONTH_KEY.test(monthKey)) {
    throw new PayrollError(`effectiveFrom must be YYYY-MM: ${monthKey}`);
  }
}

/** The month a bare `new Date()` falls in — the default when no month is given. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export interface RecordPayChangeInput {
  staffProfileId: string;
  monthlySalary: number;
  /** YYYY-MM. Defaults to the current month — a raise entered today, effective today. */
  effectiveFrom?: string | null;
  previousSalary?: number | null;
  note?: string | null;
  actorId: string;
}

export async function recordPayChange(input: RecordPayChangeInput): Promise<IStaffPayChange> {
  const effectiveFrom = input.effectiveFrom?.trim() || currentMonthKey();
  assertMonthKeyStrict(effectiveFrom);
  if (input.monthlySalary < 0) throw new PayrollError("monthlySalary must be ≥ 0");

  const row = await StaffPayChange.create({
    staffProfileId: new Types.ObjectId(input.staffProfileId),
    effectiveFrom,
    monthlySalary: input.monthlySalary,
    previousSalary: input.previousSalary ?? null,
    note: input.note?.trim() || null,
    actorId: new Types.ObjectId(input.actorId),
  });

  await writeAudit({
    eventKind: "STAFF_PAY_SET",
    actorId: input.actorId,
    targetId: row._id,
    targetKind: "StaffPayChange",
    meta: {
      staffProfileId: input.staffProfileId,
      effectiveFrom,
      monthlySalary: input.monthlySalary,
      previousSalary: input.previousSalary ?? null,
    },
  });
  return row;
}

/** This person's changes, newest first. */
export async function payHistoryForStaff(staffProfileId: string): Promise<IStaffPayChange[]> {
  return StaffPayChange.find({ staffProfileId: new Types.ObjectId(staffProfileId) })
    .sort({ effectiveFrom: -1, createdAt: -1 })
    .lean() as unknown as Promise<IStaffPayChange[]>;
}

/**
 * The salary effective in `monthKey` for every staff member that has history, as a map.
 *
 * ONE query for the whole run rather than one per person: payroll prepares 25 payslips
 * in a loop, and a per-staff lookup there is 25 round-trips for a table that is usually
 * empty. Staff with no row in range are simply absent from the map, and the caller then
 * uses the profile's current figure — which is today's behaviour exactly.
 */
export async function salariesEffectiveIn(monthKey: string): Promise<Map<string, number>> {
  assertMonthKeyStrict(monthKey);
  const rows = (await StaffPayChange.find({ effectiveFrom: { $lte: monthKey } })
    .sort({ effectiveFrom: 1, createdAt: 1 })
    .select("staffProfileId monthlySalary effectiveFrom")
    .lean()) as unknown as Array<{ staffProfileId: Types.ObjectId; monthlySalary: number }>;

  // Ascending order means the last write per staff member wins — the latest change
  // that had already taken effect by this month.
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.staffProfileId.toString(), r.monthlySalary);
  return out;
}

/** The single-staff form of the above, for a screen that shows one person. */
export async function salaryForMonth(
  staffProfileId: string,
  monthKey: string,
  fallback: number,
): Promise<number> {
  assertMonthKeyStrict(monthKey);
  const row = (await StaffPayChange.findOne({
    staffProfileId: new Types.ObjectId(staffProfileId),
    effectiveFrom: { $lte: monthKey },
  })
    .sort({ effectiveFrom: -1, createdAt: -1 })
    .select("monthlySalary")
    .lean()) as unknown as { monthlySalary: number } | null;
  return row ? row.monthlySalary : fallback;
}
