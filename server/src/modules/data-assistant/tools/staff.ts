/**
 * find_staff, staff_attendance, staff_leave, payroll_summary (docs/prd-data-assistant-mcp.md §7
 * tools 16–19). StaffProfile contact, NID and bank fields are never selected; the payroll
 * `person` mode reads payslips (which carry no bank/NID) — never the payment-export rows.
 *
 * OPEN-1 (settled from the code): the payroll screens have NO separate individual-pay switch.
 * `staffPayslips` and `payslipsForRun` (the per-person pay lines) are gated `payroll:view`, the
 * same as `payrollRuns`. So `person` = `payroll:view` exactly (no new switch invented, D-#1544).
 */
import { Types } from "mongoose";
import { z } from "zod";
import { LEAVE_STATUSES } from "@scd/shared";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { listStaffDirectory } from "../../hr/services/StaffDirectoryService";
import { teacherAttendanceForDate, teacherAttendanceSummary } from "../../attendance/services/TeacherAttendanceService";
import { listLeavePage } from "../../hr/services/StaffLeaveService";
import { balancesForStaff } from "../../hr/services/LeaveEntitlementService";
import { payrollRuns, payslipsForRun, payslipsForStaff } from "../../hr/services/PayrollService";
import { skeleton } from "../../platform/ai/deidentify";
import { assertRule, gateOf } from "../gates";
import { LONG_TEXT_CAP, wrapUntrusted } from "../untrusted";
import { ToolInvalid, type ToolDef } from "../types";
import { addDays, cap, checkDay, checkRange, currentYearIdOrThrow, DATE_KEY, limitArg, MONTH_KEY, NAME_QUERY, OBJECT_ID } from "./common";

const nameHit = (q: string, ...names: Array<string | null | undefined>) => {
  const needle = q.trim().toLowerCase();
  const sk = needle.split(/\s+/).map(skeleton).filter(Boolean);
  return names.some((n) => {
    if (!n) return false;
    const hay = n.toLowerCase();
    if (hay.includes(needle)) return true;
    const words = hay.split(/\s+/).map(skeleton);
    return sk.length > 0 && sk.every((s) => words.some((w) => w.includes(s)));
  });
};

async function staffNames(ids: readonly string[]): Promise<Map<string, { name: string; nameBn: string | null; designation: string | null }>> {
  const valid = [...new Set(ids.filter((i) => Types.ObjectId.isValid(i)))];
  const rows = (await StaffProfile.find({ _id: { $in: valid } }).select("name nameBn designation").lean()) as Array<{ _id: Types.ObjectId; name: string; nameBn?: string; designation?: string }>;
  return new Map(rows.map((r) => [String(r._id), { name: r.name, nameBn: r.nameBn ?? null, designation: r.designation ?? null }]));
}

// ---------------------------------------------------------------------------
// 16 find_staff
// ---------------------------------------------------------------------------

const STAFF_DIR = { authenticated: true } as const;

export const findStaff: ToolDef = {
  name: "find_staff",
  label_bn: "কর্মী খোঁজা",
  label_en: "Find staff",
  description:
    "Find a teacher or staff member by name (শিক্ষক, কর্মী, স্টাফ), or list staff by category. Returns staff_id (use it with other tools), name, " +
    "designation and category. Never returns phone numbers, addresses, NID or bank details.",
  input: { query: NAME_QUERY.optional(), category: z.string().regex(/^[a-z_]{2,30}$/).optional(), limit: limitArg(25, 100).optional() },
  gates: [{ mode: "default", rule: STAFF_DIR, resolver: { file: "modules/hr/resolvers/staffDirectory.ts", field: "staffDirectory" } }],
  maxRows: 100,
  async run(ctx, a) {
    assertRule(ctx.auth, STAFF_DIR);
    const args = a as { query?: string; category?: string; limit?: number };
    // isManage false: the directory's plain staff view (the smallest one).
    const rows = (await listStaffDirectory({ callerUserId: ctx.auth.userId, isManage: false, observableOnly: false, category: args.category ?? null })).filter(
      (r) => !args.query || nameHit(args.query, r.name, r.nameBn),
    );
    const c = cap(rows, args.limit ?? 25);
    return {
      data: c.rows.map((r) => ({ staff_id: r.id, name: r.name, name_bn: r.nameBn ?? null, designation: r.designation ?? null, category: r.category ?? null })),
      rowCount: c.rows.length,
      truncated: c.truncated,
      total: c.total,
    };
  },
};

// ---------------------------------------------------------------------------
// 17 staff_attendance
// ---------------------------------------------------------------------------

const STAFF_ATT = { anyOf: ["staff_attendance:view_all"] } as const;

export const staffAttendance: ToolDef = {
  name: "staff_attendance",
  label_bn: "কর্মীদের উপস্থিতি",
  label_en: "Staff attendance",
  description:
    "Staff attendance (শিক্ষকদের উপস্থিতি, দেরি, ছুটি). With date (default today): each person's status and punch in/out that day. " +
    "With from + to (≤ 93 days): per person present / late / leave / absent. staff_id narrows to one person.",
  input: { date: DATE_KEY.optional(), from: DATE_KEY.optional(), to: DATE_KEY.optional(), staff_id: OBJECT_ID.optional() },
  gates: [
    { mode: "default", rule: STAFF_ATT, resolver: { file: "modules/attendance/resolvers/teacherAttendance.ts", field: "teacherAttendanceForDate" } },
    { mode: "range", rule: STAFF_ATT, resolver: { file: "modules/attendance/resolvers/teacherAttendance.ts", field: "teacherAttendanceSummary" } },
  ],
  maxRows: 100,
  async run(ctx, a) {
    assertRule(ctx.auth, STAFF_ATT);
    const args = a as { date?: string; from?: string; to?: string; staff_id?: string };
    if (args.from || args.to) {
      if (!args.from || !args.to) throw new ToolInvalid("Give both from and to.");
      checkRange(args.from, args.to, 93);
      const rows = (await teacherAttendanceSummary(args.from, args.to)).filter((r) => !args.staff_id || r.staffProfileId === args.staff_id);
      const c = cap(rows, 100);
      return {
        data: { from: args.from, to: args.to, people: c.rows.map((r) => ({ staff_id: r.staffProfileId, name: r.staffName, category: r.category, days: r.days, present: r.present, late: r.late, leave: r.leave, absent: r.absent, present_pct: r.presentPct })) },
        rowCount: c.rows.length,
        truncated: c.truncated,
        total: c.total,
      };
    }
    const date = args.date ?? ctx.today;
    checkDay(date, ctx.today, 400);
    const rows = (await teacherAttendanceForDate(date)).filter((r) => !args.staff_id || r.staffProfileId === args.staff_id);
    const c = cap(rows, 100);
    return {
      data: { date, people: c.rows.map((r) => ({ staff_id: r.staffProfileId, name: r.staffName, category: r.category, status: r.status, in: r.punchIn ?? null, out: r.punchOut ?? null, shift: r.shift ?? null })) },
      rowCount: c.rows.length,
      truncated: c.truncated,
      total: c.total,
    };
  },
};

// ---------------------------------------------------------------------------
// 18 staff_leave
// ---------------------------------------------------------------------------

const LEAVE_GATE = { anyOf: ["leave:view_all"] } as const;

export const staffLeave: ToolDef = {
  name: "staff_leave",
  label_bn: "কর্মীদের ছুটি",
  label_en: "Staff leave",
  description:
    "Staff leave applications (ছুটি, ছুটির আবেদন, কারণ, বাকি ছুটি) overlapping a date range (default the last 30 days, ≤ 366): type, dates, days, status " +
    "and the reason as untrusted_text. status: applied (pending) | approved | rejected | cancelled. With staff_id + include_balances: that person's leave left this year.",
  input: {
    status: z.enum(LEAVE_STATUSES).optional(),
    from: DATE_KEY.optional(),
    to: DATE_KEY.optional(),
    staff_id: OBJECT_ID.optional(),
    include_balances: z.boolean().optional(),
  },
  gates: [
    { mode: "default", rule: LEAVE_GATE, resolver: { file: "modules/hr/resolvers/staffLeave.ts", field: "staffLeaveApplicationsPage" } },
    { mode: "balances", rule: LEAVE_GATE, resolver: { file: "modules/hr/resolvers/staffLeave.ts", field: "staffLeaveBalances" } },
  ],
  maxRows: 100,
  async run(ctx, a) {
    assertRule(ctx.auth, LEAVE_GATE);
    const args = a as { status?: string; from?: string; to?: string; staff_id?: string; include_balances?: boolean };
    const to = args.to ?? ctx.today;
    const from = args.from ?? addDays(to, -29);
    checkRange(from, to, 366);
    const page = await listLeavePage({ status: args.status, fromKey: from, toKey: to }, { page: 1, pageSize: 200 });
    const rows = page.rows.filter((r) => !args.staff_id || String(r.staffProfileId) === args.staff_id);
    const c = cap(rows, 100);
    const names = await staffNames(c.rows.map((r) => String(r.staffProfileId)));
    const out: Record<string, unknown> = {
      from,
      to,
      applications: c.rows.map((r) => ({
        staff_id: String(r.staffProfileId),
        staff: names.get(String(r.staffProfileId))?.name ?? null,
        type: r.leaveType,
        from: r.fromKey,
        to: r.toKey,
        days: r.days,
        status: r.status,
        // Owner Q5: the reason may go to the provider, only inside the untrusted_text envelope.
        reason: wrapUntrusted(r.reason, LONG_TEXT_CAP),
      })),
    };
    if (args.include_balances) {
      if (!args.staff_id) throw new ToolInvalid("include_balances needs staff_id.");
      const b = await balancesForStaff(args.staff_id, await currentYearIdOrThrow());
      out.balances = b.map((x) => ({ type: x.leaveType, paid: x.paid, allowance: x.allowanceDays, carried_over: x.carriedOverDays, taken: x.takenDays, left: x.remainingDays }));
    }
    return { data: out, rowCount: c.rows.length, truncated: c.truncated || page.total > page.rows.length, total: args.staff_id ? rows.length : page.total };
  },
};

// ---------------------------------------------------------------------------
// 19 payroll_summary
// ---------------------------------------------------------------------------

const PAY_TOTALS = { anyOf: ["payroll:view"] } as const;
const PAY_PERSON = { anyOf: ["payroll:view"] } as const;

type Slip = Awaited<ReturnType<typeof payslipsForRun>>[number];

export const payrollSummary: ToolDef = {
  name: "payroll_summary",
  label_bn: "বেতন",
  label_en: "Payroll",
  description:
    "Salaries (বেতন, বেতন শিট, মোট বেতন, কর্তন). mode totals (default): per month — status, staff count, gross, deductions, net, by category " +
    "(month = YYYY-MM, or last_n months ≤ 24, default 6). mode person: individual pay lines (gross, deductions, net) — one person's (staff_id) " +
    "or every person's in one month. Never returns bank accounts or NID.",
  input: {
    mode: z.enum(["totals", "person"]).optional(),
    month: MONTH_KEY.optional(),
    last_n: z.number().int().min(1).max(24).optional(),
    staff_id: OBJECT_ID.optional(),
  },
  gates: [
    { mode: "totals", rule: PAY_TOTALS, resolver: { file: "modules/hr/resolvers/payroll.ts", field: "payrollRuns" } },
    { mode: "person", rule: PAY_PERSON, resolver: { file: "modules/hr/resolvers/payroll.ts", field: "staffPayslips" } },
  ],
  maxRows: 100,
  async run(ctx, a) {
    const args = a as { mode?: "totals" | "person"; month?: string; last_n?: number; staff_id?: string };
    const mode = args.mode ?? "totals";
    assertRule(ctx.auth, gateOf(payrollSummary, mode));
    const runs = await payrollRuns();
    const slipRow = (s: Slip) => ({
      staff_id: String(s.staffProfileId),
      name: s.snapshotName,
      category: s.category,
      month: s.monthKey,
      gross: s.grossSalary,
      deductions: (s.deductions ?? []).map((d) => ({ head: d.type, amount: d.amount })),
      additions: (s.additions ?? []).map((d) => ({ head: d.type, amount: d.amount })),
      total_deductions: s.totalDeductions,
      net: s.netPay,
    });
    if (mode === "person") {
      if (args.staff_id) {
        // staffPayslips: locked runs only, newest first.
        const slips = (await payslipsForStaff(args.staff_id)).filter((s) => !args.month || s.monthKey === args.month);
        const c = cap(slips, 24);
        return { data: { staff_id: args.staff_id, payslips: c.rows.map(slipRow) }, rowCount: c.rows.length, truncated: c.truncated, total: c.total };
      }
      if (!args.month) throw new ToolInvalid("person mode needs staff_id, or a month for everyone's pay.");
      const run = runs.find((r) => r.monthKey === args.month);
      if (!run) return { data: { month: args.month, status: null, people: [] }, rowCount: 0 };
      const slips = await payslipsForRun(String(run._id));
      const c = cap(slips, 100);
      return { data: { month: args.month, status: run.status, people: c.rows.map(slipRow) }, rowCount: c.rows.length, truncated: c.truncated, total: c.total };
    }
    const chosen = args.month ? runs.filter((r) => r.monthKey === args.month) : runs.slice(0, args.last_n ?? 6);
    const out = [];
    for (const r of chosen.slice(0, 24)) {
      const slips = await payslipsForRun(String(r._id));
      const byCat = new Map<string, { count: number; net: number }>();
      for (const s of slips) {
        const b = byCat.get(s.category) ?? { count: 0, net: 0 };
        b.count++;
        b.net += s.netPay;
        byCat.set(s.category, b);
      }
      out.push({
        month: r.monthKey,
        status: r.status,
        staff_count: slips.length,
        gross: slips.reduce((n, s) => n + s.grossSalary, 0),
        deductions: slips.reduce((n, s) => n + s.totalDeductions, 0),
        additions: slips.reduce((n, s) => n + (s.totalAdditions ?? 0), 0),
        net: slips.reduce((n, s) => n + s.netPay, 0),
        by_category: [...byCat.entries()].map(([category, v]) => ({ category, count: v.count, net: v.net })),
      });
    }
    return { data: { runs: out }, rowCount: out.length };
  },
};
