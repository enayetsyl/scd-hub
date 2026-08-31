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
  /** YYYY-MM. Omitted → see `defaultEffectiveFrom` below. */
  effectiveFrom?: string | null;
  previousSalary?: number | null;
  note?: string | null;
  /**
   * The staff member's joining month (YYYY-MM), used only for the FIRST row (D-#590).
   */
  joiningMonth?: string | null;
  actorId: string;
}

/**
 * When a change takes effect, if the caller did not say.
 *
 * THE FIRST ROW IS DATED FROM JOINING, not from the day it was typed (D-#590). This is
 * the bug that made backdating useless: a teacher joined 2025-07 at 8,000, the wizard
 * wrote that row as effective 2026-08 (the month of entry), she was then raised to
 * 10,000 effective 2026-07 — and because resolution takes the latest row already in
 * effect, the August row (8,000) OUTRANKED the July raise and her payslip came out at
 * the old salary. Dating the initial figure from her joining month puts the rows in the
 * order the facts actually happened: 2025-07 → 8,000, then 2026-07 → 10,000.
 *
 * Later changes still default to the current month: a raise entered today with no date
 * given is a raise from today.
 */
export function defaultEffectiveFrom(isFirstRow: boolean, joiningMonth?: string | null): string {
  const now = currentMonthKey();
  if (!isFirstRow) return now;
  const joined = joiningMonth?.trim();
  // A joining month in the FUTURE would date the salary before it can apply; the
  // current month is the safer floor.
  if (joined && MONTH_KEY.test(joined) && joined <= now) return joined;
  return now;
}

export async function recordPayChange(input: RecordPayChangeInput): Promise<IStaffPayChange> {
  const isFirstRow =
    (await StaffPayChange.countDocuments({
      staffProfileId: new Types.ObjectId(input.staffProfileId),
    })) === 0;
  const effectiveFrom =
    input.effectiveFrom?.trim() || defaultEffectiveFrom(isFirstRow, input.joiningMonth);
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
  // EVERY row, not just those in range: a month earlier than a person's first recorded
  // change still has an answer, and it is not the profile's current figure (D-#590).
  const rows = (await StaffPayChange.find({})
    .sort({ effectiveFrom: 1, createdAt: 1 })
    .select("staffProfileId monthlySalary previousSalary effectiveFrom")
    .lean()) as unknown as Array<{
    staffProfileId: Types.ObjectId;
    monthlySalary: number;
    previousSalary?: number | null;
    effectiveFrom: string;
  }>;

  const byStaff = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.staffProfileId.toString();
    const list = byStaff.get(k);
    if (list) list.push(r);
    else byStaff.set(k, [r]);
  }

  const out = new Map<string, number>();
  for (const [staffId, list] of byStaff) {
    const inRange = list.filter((r) => r.effectiveFrom <= monthKey);
    if (inRange.length > 0) {
      // Ascending order, so the last one in range is the latest change already in
      // effect for this month.
      out.set(staffId, inRange[inRange.length - 1].monthlySalary);
      continue;
    }
    /**
     * The month predates every recorded change. The best evidence of what was earned
     * then is the EARLIEST row's `previousSalary` — that field says exactly what the
     * figure was before that change. When it is null the row IS the initial figure, so
     * that figure is what applied. Falling through to the profile would be wrong: by
     * now the profile holds the newest salary, so re-running an old month after a raise
     * would pay the raise.
     */
    const earliest = list[0];
    out.set(staffId, earliest.previousSalary ?? earliest.monthlySalary);
  }
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
