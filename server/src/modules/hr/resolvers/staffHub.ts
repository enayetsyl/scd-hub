/**
 * Staff-hub resolvers (SH-1..SH-5; docs/prd-staff-hub.md).
 *
 * The reads and writes the consolidated hub needs, and NOTHING more: every field here
 * is gated on a permission that already existed, because a screen that gathers six
 * surfaces into one must not become a seventh, wider surface.
 *
 *   staff:manage    — letters (issue / void / list), employment confirmation
 *   leave:manage    — the pooled balance + the held probation debt
 *   attendance:manage — per-staff attendance days + summary + lateness preview
 *   payroll:manage  — the HR policy switches, another person's lateness charge
 *   own-row (none)  — the caller's own pool + held debt
 *
 * `myPayslips` and the admin `staffPayslips` deliberately live in `payroll.ts` beside
 * the `Payslip` type and `payslipsForStaff` (which restricts to LOCKED runs) — a second
 * payslip type here would have shown staff a prepared, unapproved figure.
 *
 * DELIBERATELY NOT ONE AGGREGATE QUERY. Each tab asks for its own slice, so a caller
 * who lacks a permission simply never fires that request. Folding them together would
 * rebuild exactly the D-#532 failure: a permission-carrying field returning `null` and
 * a screen reading through it.
 *
 * Identity-plane only; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import type { StaffLetterKind, SalaryMode } from "@scd/shared";

import { getHrPolicy, setHrPolicy, type HrPolicyView } from "../services/HrPolicyService";
import {
  issueLetter,
  voidLetter,
  lettersForStaff,
  type IssueLetterInput,
} from "../services/StaffLetterService";
import { confirmEmployment, previewConfirmation } from "../services/ConfirmationService";
import { pooledBalanceForStaff, type PooledBalanceView } from "../services/LeaveEntitlementService";
import { heldDebtForStaff, type HeldDebtView } from "../services/ProbationDebtService";
import { previewLateness, latenessChargeFor, type LatenessPreview } from "../services/LatenessService";
import {
  staffAttendanceForRange,
  summarizeStatuses,
  type TeacherDayRecord,
} from "../../attendance/services/TeacherAttendanceService";
import { resolveStaffProfileForUser } from "../services/staffMatch";
import { StaffLetter, type IStaffLetter } from "../models/StaffLetter";
import { Types } from "mongoose";

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function require_(ctx: AppContext, perm: Parameters<typeof callerHasPermission>[1]): void {
  if (!ctx.auth || !callerHasPermission(ctx.auth, perm)) {
    throw new ForbiddenError("অনুমতি নেই");
  }
}

/** The caller's own StaffProfile id (own-row self-service), or null. */
async function callerStaffId(ctx: AppContext): Promise<string | null> {
  if (!ctx.auth) return null;
  const staff = await resolveStaffProfileForUser(ctx.auth.userId);
  return staff ? staff._id.toString() : null;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const HrPolicyRef = builder.objectRef<HrPolicyView>("HrPolicy");
HrPolicyRef.implement({
  description:
    "School-wide HR policy (SH-3). Read-time defaults — an unset policy reads as " +
    "HR_POLICY_DEFAULTS, so this never reflects a seed write.",
  fields: (t) => ({
    annualLeaveDays: t.exposeInt("annualLeaveDays"),
    lateDaysPerCharge: t.exposeInt("lateDaysPerCharge"),
    latenessRuleEnabled: t.exposeBoolean("latenessRuleEnabled"),
    probationDebtEnabled: t.exposeBoolean("probationDebtEnabled"),
    signatoryName: t.exposeString("signatoryName"),
    signatoryTitle: t.exposeString("signatoryTitle"),
    weeklyHoursText: t.exposeString("weeklyHoursText"),
    letterRefPrefix: t.exposeString("letterRefPrefix"),
  }),
});

const StaffLetterRef = builder.objectRef<IStaffLetter>("StaffLetter");
StaffLetterRef.implement({
  description:
    "An issued staff letter (SH-1, D-#542). Every printable field comes from the " +
    "FROZEN snapshot — the live profile is never joined, so an old letter still prints " +
    "as it was signed.",
  fields: (t) => ({
    id: t.string({ resolve: (l) => l._id.toString() }),
    staffProfileId: t.string({ resolve: (l) => l.staffProfileId.toString() }),
    kind: t.exposeString("kind"),
    refNo: t.exposeString("refNo"),
    issuedOn: t.string({ resolve: (l) => l.issuedOn.toISOString() }),
    status: t.exposeString("status"),
    extraText: t.string({ nullable: true, resolve: (l) => l.extraText ?? null }),
    voidReason: t.string({ nullable: true, resolve: (l) => l.voidReason ?? null }),
    // Snapshot fields the list needs to describe a letter without opening the PDF.
    salaryMode: t.string({ resolve: (l) => l.snapshot.salaryMode }),
    monthlySalary: t.float({ nullable: true, resolve: (l) => l.snapshot.monthlySalary ?? null }),
    designation: t.string({ resolve: (l) => l.snapshot.designation }),
    effectiveFrom: t.string({ resolve: (l) => l.snapshot.effectiveFrom }),
    letterDate: t.string({ resolve: (l) => l.snapshot.letterDate }),
    annualLeaveDays: t.int({ resolve: (l) => l.snapshot.annualLeaveDays }),
  }),
});

const PooledBalanceRef = builder.objectRef<PooledBalanceView>("StaffLeavePool");
PooledBalanceRef.implement({
  description:
    "The ONE shared annual leave pool (SH-3, D-#539) — casual + sick + bereavement " +
    "draw from it together, per the appointment letter's clause 7.",
  fields: (t) => ({
    academicYearId: t.string({ nullable: true, resolve: (b) => b.academicYearId }),
    allowanceDays: t.float({ resolve: (b) => b.allowanceDays }),
    carriedOverDays: t.float({ resolve: (b) => b.carriedOverDays }),
    takenDays: t.float({ resolve: (b) => b.takenDays }),
    remainingDays: t.float({ resolve: (b) => b.remainingDays }),
    overridden: t.exposeBoolean("overridden"),
    proRated: t.exposeBoolean("proRated"),
  }),
});

interface HeldDebtRowShape {
  id: string;
  fromKey: string;
  leaveType: string;
  days: number;
}
const HeldDebtRowRef = builder.objectRef<HeldDebtRowShape>("ProbationDebtRow");
HeldDebtRowRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    fromKey: t.exposeString("fromKey"),
    leaveType: t.exposeString("leaveType"),
    days: t.float({ resolve: (r) => r.days }),
  }),
});

const HeldDebtRef = builder.objectRef<HeldDebtView>("ProbationDebt");
HeldDebtRef.implement({
  description:
    "Leave taken before confirmation, HELD rather than deducted (SH-3, D-#540). Rows, " +
    "not just a total: a balance that dropped must be explainable by dates.",
  fields: (t) => ({
    totalDays: t.float({ resolve: (d) => d.totalDays }),
    rows: t.field({ type: [HeldDebtRowRef], resolve: (d) => d.rows }),
  }),
});

const LatenessPreviewRef = builder.objectRef<LatenessPreview>("LatenessPreview");
LatenessPreviewRef.implement({
  description:
    "A live, UNSAVED reckoning of a month's lateness (SH-4, D-#541). Reading it never " +
    "writes a charge — only a payroll prepare does.",
  fields: (t) => ({
    enabled: t.exposeBoolean("enabled"),
    lateCount: t.exposeInt("lateCount"),
    lateDateKeys: t.exposeStringList("lateDateKeys"),
    lateDaysPerCharge: t.exposeInt("lateDaysPerCharge"),
    chargedDays: t.exposeInt("chargedDays"),
    paidFromLeave: t.exposeInt("paidFromLeave"),
    chargedToSalary: t.exposeInt("chargedToSalary"),
    latesUntilNextCharge: t.exposeInt("latesUntilNextCharge"),
  }),
});

const StaffDayRef = builder.objectRef<TeacherDayRecord>("StaffAttendanceDay");
StaffDayRef.implement({
  description: "One staff member's attendance for one date, from the biometric import (AT-1).",
  fields: (t) => ({
    staffProfileId: t.exposeString("staffProfileId"),
    dateKey: t.exposeString("dateKey"),
    status: t.exposeString("status"),
    punchIn: t.string({ nullable: true, resolve: (d) => d.punchIn ?? null }),
    punchOut: t.string({ nullable: true, resolve: (d) => d.punchOut ?? null }),
    shift: t.string({ nullable: true, resolve: (d) => d.shift ?? null }),
  }),
});

interface StaffAttendanceSummaryShape {
  present: number;
  late: number;
  leave: number;
  absent: number;
  total: number;
  presentPct: number;
}
const StaffSummaryRef = builder.objectRef<StaffAttendanceSummaryShape>("StaffMonthSummary");
StaffSummaryRef.implement({
  fields: (t) => ({
    present: t.exposeInt("present"),
    late: t.exposeInt("late"),
    leave: t.exposeInt("leave"),
    absent: t.exposeInt("absent"),
    total: t.exposeInt("total"),
    presentPct: t.exposeFloat("presentPct"),
  }),
});

interface ConfirmPreviewShape {
  heldDays: number;
  poolAllowance: number;
  poolRemaining: number;
  fromPool: number;
  toSalary: number;
}
const ConfirmPreviewRef = builder.objectRef<ConfirmPreviewShape>("ConfirmationPreview");
ConfirmPreviewRef.implement({
  description:
    "A DRY RUN of confirming employment (SH-2) — the ledger the স্থায়ীকরণ sheet shows " +
    "before the button is pressed. Reading it settles nothing.",
  fields: (t) => ({
    heldDays: t.exposeFloat("heldDays"),
    poolAllowance: t.exposeFloat("poolAllowance"),
    poolRemaining: t.exposeFloat("poolRemaining"),
    fromPool: t.exposeFloat("fromPool"),
    toSalary: t.exposeFloat("toSalary"),
  }),
});

interface ConfirmResultShape {
  staffProfileId: string;
  confirmationDate: string;
  heldDays: number;
  settledFromPool: number;
  settledToSalary: number;
  poolRemainingAfter: number;
  letterId: string | null;
}
const ConfirmResultRef = builder.objectRef<ConfirmResultShape>("ConfirmationResult");
ConfirmResultRef.implement({
  fields: (t) => ({
    staffProfileId: t.exposeString("staffProfileId"),
    confirmationDate: t.exposeString("confirmationDate"),
    heldDays: t.exposeFloat("heldDays"),
    settledFromPool: t.exposeFloat("settledFromPool"),
    settledToSalary: t.exposeFloat("settledToSalary"),
    poolRemainingAfter: t.exposeFloat("poolRemainingAfter"),
    letterId: t.string({ nullable: true, resolve: (r) => r.letterId }),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("hrPolicy", (t) =>
  t.field({
    type: HrPolicyRef,
    description: "The school-wide HR policy (SH-3). Requires payroll:manage.",
    authScopes: { hasPermission: "payroll:manage" },
    resolve: async () => getHrPolicy(),
  }),
);

builder.queryField("staffLetters", (t) =>
  t.field({
    type: [StaffLetterRef],
    description: "A staff member's issued letters, newest first (SH-1). Requires staff:manage.",
    authScopes: { hasPermission: "staff:manage" },
    args: { staffProfileId: t.arg.string({ required: true }) },
    resolve: async (_r, args) => lettersForStaff(args.staffProfileId),
  }),
);

builder.queryField("staffLeavePool", (t) =>
  t.field({
    type: PooledBalanceRef,
    description: "The shared 20-day pool for a staff member (SH-3, D-#539). Requires leave:manage.",
    authScopes: { hasPermission: "leave:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      academicYearId: t.arg.string({ required: false }),
    },
    resolve: async (_r, args) => pooledBalanceForStaff(args.staffProfileId, args.academicYearId ?? null),
  }),
);

builder.queryField("staffProbationDebt", (t) =>
  t.field({
    type: HeldDebtRef,
    description: "Held probation leave for a staff member (SH-3, D-#540). Requires leave:manage.",
    authScopes: { hasPermission: "leave:manage" },
    args: { staffProfileId: t.arg.string({ required: true }) },
    resolve: async (_r, args) => heldDebtForStaff(args.staffProfileId),
  }),
);

builder.queryField("staffAttendance", (t) =>
  t.field({
    type: [StaffDayRef],
    description:
      "One staff member's attendance over [fromKey, toKey], oldest first, with the " +
      "AT-1 ✘=ABSENT → LEAVE overlay applied. Requires attendance:manage (the admin " +
      "twin of the own-row myStaffAttendance).",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
    },
    resolve: async (_r, args) => staffAttendanceForRange(args.staffProfileId, args.fromKey, args.toKey),
  }),
);

builder.queryField("staffAttendanceSummary", (t) =>
  t.field({
    type: StaffSummaryRef,
    description: "Counts + present% for ONE staff member over a range. Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
    },
    resolve: async (_r, args) => {
      const days = await staffAttendanceForRange(args.staffProfileId, args.fromKey, args.toKey);
      const counts = summarizeStatuses(days.map((d) => d.status));
      const total = days.length;
      return {
        ...counts,
        total,
        presentPct: total > 0 ? Math.round(((counts.present + counts.late) / total) * 1000) / 10 : 0,
      };
    },
  }),
);

builder.queryField("staffLatenessPreview", (t) =>
  t.field({
    type: LatenessPreviewRef,
    description:
      "A month's lateness reckoning WITHOUT writing a charge (SH-4). Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      monthKey: t.arg.string({ required: true }),
    },
    resolve: async (_r, args) => previewLateness(args.staffProfileId, args.monthKey),
  }),
);

builder.queryField("staffLatenessCharge", (t) =>
  t.field({
    type: LatenessPreviewRef,
    description:
      "The STORED charge for a month, shaped like the preview so one card renders both " +
      "(a frozen charge wins over a live count). Requires payroll:manage.",
    authScopes: { hasPermission: "payroll:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      monthKey: t.arg.string({ required: true }),
    },
    resolve: async (_r, args) => {
      const row = await latenessChargeFor(args.staffProfileId, args.monthKey);
      if (!row) return previewLateness(args.staffProfileId, args.monthKey);
      const forgiven = row.lateDateKeys.length - row.chargedDays * row.lateDaysPerCharge;
      return {
        enabled: true,
        lateCount: row.lateDateKeys.length,
        lateDateKeys: row.lateDateKeys,
        lateDaysPerCharge: row.lateDaysPerCharge,
        chargedDays: row.chargedDays,
        paidFromLeave: row.paidFromLeave,
        chargedToSalary: row.chargedToSalary,
        latesUntilNextCharge: row.lateDaysPerCharge - forgiven,
      };
    },
  }),
);

builder.queryField("myLeavePool", (t) =>
  t.field({
    type: PooledBalanceRef,
    description: "The caller's OWN pooled leave balance (SH-7). Own-row, no permission.",
    authScopes: { authenticated: true },
    resolve: async (_r, _a, ctx) => {
      const sid = await callerStaffId(ctx);
      if (!sid) {
        return {
          academicYearId: null,
          allowanceDays: 0,
          carriedOverDays: 0,
          takenDays: 0,
          remainingDays: 0,
          overridden: false,
          proRated: false,
        };
      }
      return pooledBalanceForStaff(sid);
    },
  }),
);

builder.queryField("myProbationDebt", (t) =>
  t.field({
    type: HeldDebtRef,
    description: "The caller's OWN held probation leave (SH-7). Own-row, no permission.",
    authScopes: { authenticated: true },
    resolve: async (_r, _a, ctx) => {
      const sid = await callerStaffId(ctx);
      if (!sid) return { totalDays: 0, rows: [] };
      return heldDebtForStaff(sid);
    },
  }),
);

builder.queryField("confirmationPreview", (t) =>
  t.field({
    type: ConfirmPreviewRef,
    description: "What confirming would settle (SH-2) — a dry run. Requires staff:manage.",
    authScopes: { hasPermission: "staff:manage" },
    args: { staffProfileId: t.arg.string({ required: true }) },
    resolve: async (_r, args) => previewConfirmation(args.staffProfileId),
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("setHrPolicy", (t) =>
  t.field({
    type: HrPolicyRef,
    description:
      "Edit the HR policy (SH-3). Only the fields passed are written. Requires payroll:manage.",
    authScopes: { hasPermission: "payroll:manage" },
    args: {
      annualLeaveDays: t.arg.int({ required: false }),
      lateDaysPerCharge: t.arg.int({ required: false }),
      latenessRuleEnabled: t.arg.boolean({ required: false }),
      probationDebtEnabled: t.arg.boolean({ required: false }),
      signatoryName: t.arg.string({ required: false }),
      signatoryTitle: t.arg.string({ required: false }),
      weeklyHoursText: t.arg.string({ required: false }),
      letterRefPrefix: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      require_(ctx, "payroll:manage");
      return setHrPolicy({
        annualLeaveDays: args.annualLeaveDays ?? undefined,
        lateDaysPerCharge: args.lateDaysPerCharge ?? undefined,
        latenessRuleEnabled: args.latenessRuleEnabled ?? undefined,
        probationDebtEnabled: args.probationDebtEnabled ?? undefined,
        signatoryName: args.signatoryName ?? undefined,
        signatoryTitle: args.signatoryTitle ?? undefined,
        weeklyHoursText: args.weeklyHoursText ?? undefined,
        letterRefPrefix: args.letterRefPrefix ?? undefined,
        actorId: ctx.auth!.userId,
      });
    },
  }),
);

builder.mutationField("issueStaffLetter", (t) =>
  t.field({
    type: StaffLetterRef,
    description:
      "Issue a letter, freezing its merge fields (SH-1, D-#542). Requires staff:manage.",
    authScopes: { hasPermission: "staff:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      kind: t.arg.string({ required: true }),
      effectiveFrom: t.arg.string({ required: true }),
      salaryMode: t.arg.string({ required: true }),
      letterDate: t.arg.string({ required: false }),
      monthlySalary: t.arg.float({ required: false }),
      designation: t.arg.string({ required: false }),
      weeklyHours: t.arg.string({ required: false }),
      extraText: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      require_(ctx, "staff:manage");
      const input: IssueLetterInput = {
        staffProfileId: args.staffProfileId,
        kind: args.kind as StaffLetterKind,
        effectiveFrom: args.effectiveFrom,
        salaryMode: args.salaryMode as SalaryMode,
        letterDate: args.letterDate ?? undefined,
        monthlySalary: args.monthlySalary ?? undefined,
        designation: args.designation ?? undefined,
        weeklyHours: args.weeklyHours ?? undefined,
        extraText: args.extraText ?? undefined,
        actorId: ctx.auth!.userId,
      };
      return issueLetter(input);
    },
  }),
);

builder.mutationField("voidStaffLetter", (t) =>
  t.field({
    type: StaffLetterRef,
    description:
      "Void a letter — kept and still renderable, marked VOID on its face (D-#542). " +
      "Requires staff:manage.",
    authScopes: { hasPermission: "staff:manage" },
    args: {
      letterId: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      require_(ctx, "staff:manage");
      return voidLetter(args.letterId, args.reason, ctx.auth!.userId);
    },
  }),
);

builder.mutationField("confirmStaffEmployment", (t) =>
  t.field({
    type: ConfirmResultRef,
    description:
      "Confirm employment (SH-2): stamps the date, settles the held probation debt " +
      "against the new pool, and optionally issues the confirmation letter. Requires " +
      "staff:manage.",
    authScopes: { hasPermission: "staff:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      confirmationDate: t.arg.string({ required: true }),
      extraText: t.arg.string({ required: false }),
      issueLetter: t.arg.boolean({ required: false, defaultValue: true }),
    },
    resolve: async (_r, args, ctx) => {
      require_(ctx, "staff:manage");
      const res = await confirmEmployment({
        staffProfileId: args.staffProfileId,
        confirmationDate: args.confirmationDate,
        extraText: args.extraText ?? null,
        issueLetter: args.issueLetter ?? true,
        actorId: ctx.auth!.userId,
      });
      return {
        staffProfileId: res.staffProfileId,
        confirmationDate: res.confirmationDate,
        heldDays: res.settlement.heldDays,
        settledFromPool: res.settlement.fromPool,
        settledToSalary: res.settlement.toSalary,
        poolRemainingAfter: res.poolRemainingAfter,
        letterId: res.letterId,
      };
    },
  }),
);

// A letter's existence gates the hub's buttons; exposed as a cheap count so the
// screen does not fetch every letter just to decide whether to show "স্থায়ীকরণ পত্র".
builder.queryField("staffLetterCount", (t) =>
  t.field({
    type: "Int",
    description: "How many LIVE (non-void) letters of a kind a staff member has. staff:manage.",
    authScopes: { hasPermission: "staff:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      kind: t.arg.string({ required: true }),
    },
    resolve: async (_r, args) =>
      StaffLetter.countDocuments({
        staffProfileId: new Types.ObjectId(args.staffProfileId),
        kind: args.kind,
        status: "issued",
      }),
  }),
);
