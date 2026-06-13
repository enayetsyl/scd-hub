/**
 * Payroll resolvers (HR-3; prd-hr §4, D-#26/#27/#109/#110).
 *
 * RBAC (§4.7 — Principal/Office only; never the corpus plane):
 *   payroll:manage  (Principal/Office) — set pay, prepare/recompute/cancel a run, read
 *                   payslips/export/advances.
 *   payroll:approve (PRINCIPAL only) — approve+LOCK a run, issue/settle advances.
 *                   Office CANNOT approve (H4.2/H4.7) — a distinct permission, not a
 *                   role check, so the verifier proves it.
 *
 * Identity-plane only; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { writeAudit } from "../../platform/services/AuditService";
import type { PaymentMethod } from "@scd/shared";
import {
  preparePayrollRun,
  approvePayrollRun,
  cancelPayrollRun,
  payrollRuns,
  payslipsForRun,
  paymentExport,
  type PaymentExportRow,
} from "../services/PayrollService";
import { issueAdvance, settleAdvance, advancesForStaff } from "../services/AdvanceService";
import type { IPayrollRun } from "../models/PayrollRun";
import type { IPayslip, IPayLine } from "../models/Payslip";
import type { IAdvanceLoan, AdvanceRecoveryMode } from "../models/AdvanceLoan";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const PayLineRef = builder.objectRef<IPayLine>("PayLine");
PayLineRef.implement({
  description: "An itemised deduction/addition line on a payslip (Bangla labels + English codes, NFR-5).",
  fields: (t) => ({
    type: t.exposeString("type"),
    amount: t.exposeFloat("amount"),
    days: t.float({ nullable: true, resolve: (l) => l.days ?? null }),
    note: t.string({ nullable: true, resolve: (l) => l.note ?? null }),
  }),
});

const PayrollRunRef = builder.objectRef<IPayrollRun>("PayrollRun");
PayrollRunRef.implement({
  description: "A monthly payroll run (prepared → approved_locked; immutable once locked, §4.2).",
  fields: (t) => ({
    id: t.string({ resolve: (r) => r._id.toString() }),
    monthKey: t.exposeString("monthKey"),
    status: t.exposeString("status"),
    workingDays: t.exposeInt("workingDays"),
    preparedAt: t.string({ resolve: (r) => new Date(r.preparedAt).toISOString() }),
    approvedAt: t.string({ nullable: true, resolve: (r) => (r.approvedAt ? new Date(r.approvedAt).toISOString() : null) }),
    note: t.string({ nullable: true, resolve: (r) => r.note ?? null }),
  }),
});

const PayslipRef = builder.objectRef<IPayslip>("Payslip");
PayslipRef.implement({
  description: "One staff member's computed line: net = gross − deductions + additions (§4.2).",
  fields: (t) => ({
    id: t.string({ resolve: (p) => p._id.toString() }),
    payrollRunId: t.string({ resolve: (p) => p.payrollRunId.toString() }),
    staffProfileId: t.string({ resolve: (p) => p.staffProfileId.toString() }),
    monthKey: t.exposeString("monthKey"),
    snapshotName: t.exposeString("snapshotName"),
    category: t.exposeString("category"),
    paymentMethod: t.string({ nullable: true, resolve: (p) => p.paymentMethod ?? null }),
    grossSalary: t.exposeFloat("grossSalary"),
    dayRate: t.exposeFloat("dayRate"),
    unpaidLeaveDays: t.exposeFloat("unpaidLeaveDays"),
    deductions: t.field({ type: [PayLineRef], resolve: (p) => p.deductions }),
    additions: t.field({ type: [PayLineRef], resolve: (p) => p.additions }),
    totalDeductions: t.exposeFloat("totalDeductions"),
    totalAdditions: t.exposeFloat("totalAdditions"),
    netPay: t.exposeFloat("netPay"),
    advanceRepaid: t.exposeFloat("advanceRepaid"),
  }),
});

const AdvanceLoanRef = builder.objectRef<IAdvanceLoan>("AdvanceLoan");
AdvanceLoanRef.implement({
  description: "A qard-hasan advance/loan (interest- & fee-free, D-#27).",
  fields: (t) => ({
    id: t.string({ resolve: (a) => a._id.toString() }),
    staffProfileId: t.string({ resolve: (a) => a.staffProfileId.toString() }),
    principal: t.exposeFloat("principal"),
    balance: t.exposeFloat("balance"),
    recoveryMode: t.exposeString("recoveryMode"),
    installmentAmount: t.float({ nullable: true, resolve: (a) => a.installmentAmount ?? null }),
    status: t.exposeString("status"),
    issueDate: t.string({ resolve: (a) => new Date(a.issueDate).toISOString() }),
    note: t.string({ nullable: true, resolve: (a) => a.note ?? null }),
  }),
});

const PaymentExportRowRef = builder.objectRef<PaymentExportRow>("PaymentExportRow");
PaymentExportRowRef.implement({
  description: "A net-pay line for bank/bKash bulk upload (cash-paid staff excluded, §4.6).",
  fields: (t) => ({
    staffProfileId: t.exposeString("staffProfileId"),
    name: t.exposeString("name"),
    paymentMethod: t.exposeString("paymentMethod"),
    account: t.string({ nullable: true, resolve: (r) => r.account }),
    netPay: t.exposeFloat("netPay"),
  }),
});

const PayLineInputRef = builder.inputType("PayLineInput", {
  description: "A manual deduction/addition line (arrears/bonus/clawback/statutory/other).",
  fields: (t) => ({
    type: t.string({ required: true }),
    amount: t.float({ required: true }),
    note: t.string({ required: false }),
  }),
});

const StaffAdjustmentInputRef = builder.inputType("StaffPayrollAdjustmentInput", {
  description: "Per-staff payroll overrides for a run (pro-ration + manual lines).",
  fields: (t) => ({
    staffProfileId: t.string({ required: true }),
    payableDays: t.float({ required: false }),
    latenessDeduction: t.float({ required: false }),
    manualDeductions: t.field({ type: [PayLineInputRef], required: false }),
    manualAdditions: t.field({ type: [PayLineInputRef], required: false }),
  }),
});

interface StaffPayView { id: string; monthlySalary: number | null; paymentMethod: string | null }
const StaffPayRef = builder.objectRef<StaffPayView>("StaffPay");
StaffPayRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    monthlySalary: t.float({ nullable: true, resolve: (s) => s.monthlySalary }),
    paymentMethod: t.string({ nullable: true, resolve: (s) => s.paymentMethod }),
  }),
});

// ---------------------------------------------------------------------------
// Mutations — pay record
// ---------------------------------------------------------------------------

builder.mutationField("setStaffPay", (t) =>
  t.field({
    type: StaffPayRef,
    description: "Set a staff member's consolidated monthly salary + payment method (§4.1/§4.6). Requires payroll:manage. Audited.",
    authScopes: { hasPermission: "payroll:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      monthlySalary: t.arg.float({ required: false }),
      paymentMethod: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const staff = await StaffProfile.findById(args.staffProfileId);
      if (!staff) throw new Error("Staff profile not found");
      if (args.monthlySalary != null) {
        if (args.monthlySalary < 0) throw new Error("monthlySalary must be ≥ 0");
        staff.monthlySalary = args.monthlySalary;
      }
      if (args.paymentMethod != null) staff.paymentMethod = args.paymentMethod as PaymentMethod;
      await staff.save();
      await writeAudit({
        eventKind: "STAFF_PAY_SET",
        actorId: ctx.auth!.userId,
        targetId: staff._id,
        targetKind: "StaffProfile",
        meta: { hasSalary: staff.monthlySalary != null, paymentMethod: staff.paymentMethod ?? null },
      });
      return { id: staff._id.toString(), monthlySalary: staff.monthlySalary ?? null, paymentMethod: staff.paymentMethod ?? null };
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations — the run lifecycle
// ---------------------------------------------------------------------------

builder.mutationField("preparePayrollRun", (t) =>
  t.field({
    type: PayrollRunRef,
    description:
      "Compute (or recompute) a monthly run: gross + unpaid-leave deduction (stored split, D-#110) + " +
      "advance recovery (net-pay guard) + manual lines. Requires payroll:manage. Audited.",
    authScopes: { hasPermission: "payroll:manage" },
    args: {
      monthKey: t.arg.string({ required: true }),
      workingDays: t.arg.int({ required: true }),
      adjustments: t.arg({ type: [StaffAdjustmentInputRef], required: false }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const { run } = await preparePayrollRun({
        monthKey: args.monthKey,
        workingDays: args.workingDays,
        note: args.note ?? undefined,
        actorId: ctx.auth!.userId,
        adjustments: (args.adjustments ?? []).map((a) => ({
          staffProfileId: a.staffProfileId,
          payableDays: a.payableDays ?? undefined,
          latenessDeduction: a.latenessDeduction ?? undefined,
          manualDeductions: (a.manualDeductions ?? []).map((l) => ({ type: l.type as IPayLine["type"], amount: l.amount, note: l.note ?? undefined })),
          manualAdditions: (a.manualAdditions ?? []).map((l) => ({ type: l.type as IPayLine["type"], amount: l.amount, note: l.note ?? undefined })),
        })),
      });
      return run;
    },
  }),
);

builder.mutationField("approvePayrollRun", (t) =>
  t.field({
    type: PayrollRunRef,
    description: "Approve + LOCK a run (immutable) and commit advance recovery. PRINCIPAL only (payroll:approve, H4.2/H4.7). Audited.",
    authScopes: { hasPermission: "payroll:approve" },
    args: { runId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => approvePayrollRun(args.runId, ctx.auth!.userId),
  }),
);

builder.mutationField("cancelPayrollRun", (t) =>
  t.field({
    type: PayrollRunRef,
    description: "Discard a prepared run (before approval). Requires payroll:manage. Audited.",
    authScopes: { hasPermission: "payroll:manage" },
    args: { runId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => cancelPayrollRun(args.runId, ctx.auth!.userId),
  }),
);

// ---------------------------------------------------------------------------
// Mutations — advances (Principal-approved)
// ---------------------------------------------------------------------------

builder.mutationField("issueStaffAdvance", (t) =>
  t.field({
    type: AdvanceLoanRef,
    description: "Issue a qard-hasan advance/loan (interest- & fee-free, D-#27). PRINCIPAL only (payroll:approve). Audited.",
    authScopes: { hasPermission: "payroll:approve" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      principal: t.arg.float({ required: true }),
      issueDate: t.arg.string({ required: true }),
      recoveryMode: t.arg.string({ required: true }), // one_shot | installments
      installmentAmount: t.arg.float({ required: false }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      issueAdvance({
        staffProfileId: args.staffProfileId,
        principal: args.principal,
        issueDate: new Date(args.issueDate),
        recoveryMode: args.recoveryMode as AdvanceRecoveryMode,
        installmentAmount: args.installmentAmount ?? undefined,
        note: args.note ?? undefined,
        actorId: ctx.auth!.userId,
      }),
  }),
);

builder.mutationField("settleStaffAdvance", (t) =>
  t.field({
    type: AdvanceLoanRef,
    description: "Settle (early payoff) or write off an advance. PRINCIPAL only (payroll:approve). Audited.",
    authScopes: { hasPermission: "payroll:approve" },
    args: {
      advanceId: t.arg.string({ required: true }),
      writeOff: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => settleAdvance(args.advanceId, args.writeOff ?? false, ctx.auth!.userId),
  }),
);

// ---------------------------------------------------------------------------
// Queries (payroll:manage)
// ---------------------------------------------------------------------------

builder.queryField("payrollRuns", (t) =>
  t.field({
    type: [PayrollRunRef],
    description: "Recent payroll runs (newest first; cancelled excluded). Requires payroll:manage.",
    authScopes: { hasPermission: "payroll:manage" },
    resolve: async () => payrollRuns(),
  }),
);

builder.queryField("payslipsForRun", (t) =>
  t.field({
    type: [PayslipRef],
    description: "All payslips of a run. Requires payroll:manage.",
    authScopes: { hasPermission: "payroll:manage" },
    args: { runId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => payslipsForRun(args.runId),
  }),
);

builder.queryField("payrollPaymentExport", (t) =>
  t.field({
    type: [PaymentExportRowRef],
    description: "Net-pay-per-staff export for bank/bKash bulk upload (cash excluded; locked run only, §4.6). Requires payroll:manage.",
    authScopes: { hasPermission: "payroll:manage" },
    args: { runId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => paymentExport(args.runId),
  }),
);

builder.queryField("staffAdvances", (t) =>
  t.field({
    type: [AdvanceLoanRef],
    description: "A staff member's advances/loans (newest first). Requires payroll:manage.",
    authScopes: { hasPermission: "payroll:manage" },
    args: { staffProfileId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => advancesForStaff(args.staffProfileId),
  }),
);
