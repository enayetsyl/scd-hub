/**
 * Staff-leave resolvers (HR-2; prd-hr §3, H2, D-#22/#23).
 *
 * RBAC:
 *   leave:manage (Principal/Office) — entitlements, approve/reject leave, approve
 *     cover slots, list all leave + balances, record leave on a staff member's behalf
 *     (support staff have no login, so Office records theirs).
 *   Own-row self-service (NO new permission) — a logged-in staff member applies for
 *     THEIR OWN leave, proposes a covering teacher on their own leave's slots, cancels
 *     their own leave, and views their own leave + balances. The caller's StaffProfile
 *     is resolved from the auth token via the phone link (staffMatch) — the same join
 *     provisioning uses; no User↔StaffProfile FK is added (worktree-rule-3 safe).
 *
 * Identity-plane only; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import {
  applyForLeave,
  decideLeave,
  leaveForStaff,
  listLeave,
  type LeaveDecision,
} from "../services/StaffLeaveService";
import { balancesForStaff, upsertEntitlement, type LeaveBalanceView } from "../services/LeaveEntitlementService";
import {
  proposeCover,
  decideCoverSlot,
  coverSlotsForLeave,
  needsCoverSlots,
  type NeedsCoverRow,
} from "../services/CoverService";
import { resolveStaffProfileForUser } from "../services/staffMatch";
import { StaffLeaveApplication, type IStaffLeaveApplication } from "../models/StaffLeaveApplication";
import type { IStaffCoverSlot } from "../models/StaffCoverSlot";
import type { LeaveType, LeaveDayPart } from "@scd/shared";
import { roundLeaveDays } from "../services/dates";

// ---------------------------------------------------------------------------
// Gates / helpers
// ---------------------------------------------------------------------------

function hasManage(ctx: AppContext): boolean {
  return ctx.auth !== null && callerHasPermission(ctx.auth, "leave:manage");
}

/** The caller's own StaffProfile id (own-row self-service), or throw. */
async function callerStaffProfileId(ctx: AppContext): Promise<string> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const staff = await resolveStaffProfileForUser(ctx.auth.userId);
  if (!staff) throw new ForbiddenError("No staff profile is linked to your login");
  return staff._id.toString();
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

type LeaveShape = IStaffLeaveApplication;

const StaffLeaveRef = builder.objectRef<LeaveShape>("StaffLeaveApplication");
StaffLeaveRef.implement({
  description: "A staff leave application (HR-2; prd-hr §3) — parent record + decision split.",
  fields: (t) => ({
    id: t.string({ resolve: (l) => l._id.toString() }),
    staffProfileId: t.string({ resolve: (l) => l.staffProfileId.toString() }),
    academicYearId: t.string({ nullable: true, resolve: (l) => l.academicYearId?.toString() ?? null }),
    leaveType: t.exposeString("leaveType"),
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    // D-#361: "full" | "late_entry" | "early_leave"; the periods a partial day misses.
    dayPart: t.string({ resolve: (l) => l.dayPart ?? "full" }),
    partialPeriodCount: t.int({ nullable: true, resolve: (l) => l.partialPeriodCount ?? null }),
    partialPeriods: t.intList({ resolve: (l) => l.partialPeriods ?? [] }),
    // Float, not Int, since D-#361: a partial day is 1/3 of a day.
    days: t.float({ resolve: (l) => roundLeaveDays(l.days) }),
    reason: t.exposeString("reason"),
    status: t.exposeString("status"),
    paidDays: t.float({ nullable: true, resolve: (l) => (l.paidDays == null ? null : roundLeaveDays(l.paidDays)) }),
    unpaidDays: t.float({ nullable: true, resolve: (l) => (l.unpaidDays == null ? null : roundLeaveDays(l.unpaidDays)) }),
    exceedWarning: t.string({ nullable: true, resolve: (l) => l.exceedWarning ?? null }),
    decisionNote: t.string({ nullable: true, resolve: (l) => l.decisionNote ?? null }),
    decidedAt: t.string({ nullable: true, resolve: (l) => (l.decidedAt ? new Date(l.decidedAt).toISOString() : null) }),
    createdAt: t.string({ resolve: (l) => new Date(l.createdAt).toISOString() }),
  }),
});

const StaffCoverSlotRef = builder.objectRef<IStaffCoverSlot>("StaffCoverSlot");
StaffCoverSlotRef.implement({
  description:
    "One leave's cover slot for ONE class meeting (date × period). A `section` slot's approval mints a " +
    "one-day proxy grant; a `subjectgroup` (Quran/Arabic) slot is recorded only, no grant (prd-hr §3.5, " +
    "D-#22; per-meeting redesign PXG-1, D-#268; Quran/Arabic support follow-up).",
  fields: (t) => ({
    id: t.string({ resolve: (s) => s._id.toString() }),
    leaveApplicationId: t.string({ resolve: (s) => s.leaveApplicationId.toString() }),
    groupType: t.string({ resolve: (s) => s.groupType ?? "section" }),
    classId: t.string({ nullable: true, resolve: (s) => s.classId?.toString() ?? null }),
    sectionId: t.string({ nullable: true, resolve: (s) => s.sectionId?.toString() ?? null }),
    subjectId: t.string({ nullable: true, resolve: (s) => s.subjectId?.toString() ?? null }),
    subjectGroupId: t.string({ nullable: true, resolve: (s) => s.subjectGroupId?.toString() ?? null }),
    absentTeacherUserId: t.string({ nullable: true, resolve: (s) => s.absentTeacherUserId?.toString() ?? null }),
    dateKey: t.exposeString("dateKey"),
    periodNumber: t.exposeInt("periodNumber"),
    proposedCoverTeacherId: t.string({ nullable: true, resolve: (s) => s.proposedCoverTeacherId?.toString() ?? null }),
    finalCoverTeacherUserId: t.string({ nullable: true, resolve: (s) => s.finalCoverTeacherUserId?.toString() ?? null }),
    status: t.exposeString("status"),
    proxyGrantId: t.string({ nullable: true, resolve: (s) => s.proxyGrantId?.toString() ?? null }),
  }),
});

const NeedsCoverRowRef = builder.objectRef<NeedsCoverRow>("NeedsCoverRow");
NeedsCoverRowRef.implement({
  description: "One uncovered class meeting across every approved leave in a date range (PXG-1 inbox).",
  fields: (t) => ({
    slotId: t.exposeString("slotId"),
    leaveApplicationId: t.exposeString("leaveApplicationId"),
    groupType: t.exposeString("groupType"),
    absentTeacherUserId: t.string({ nullable: true, resolve: (r) => r.absentTeacherUserId }),
    absentTeacherName: t.string({ nullable: true, resolve: (r) => r.absentTeacherName }),
    classId: t.string({ nullable: true, resolve: (r) => r.classId }),
    className: t.string({ nullable: true, resolve: (r) => r.className }),
    sectionId: t.string({ nullable: true, resolve: (r) => r.sectionId }),
    sectionName: t.string({ nullable: true, resolve: (r) => r.sectionName }),
    subjectId: t.string({ nullable: true, resolve: (r) => r.subjectId }),
    subjectName: t.string({ nullable: true, resolve: (r) => r.subjectName }),
    subjectGroupId: t.string({ nullable: true, resolve: (r) => r.subjectGroupId }),
    subjectGroupName: t.string({ nullable: true, resolve: (r) => r.subjectGroupName }),
    dateKey: t.exposeString("dateKey"),
    periodNumber: t.exposeInt("periodNumber"),
  }),
});

const StaffLeaveBalanceRef = builder.objectRef<LeaveBalanceView>("StaffLeaveBalance");
StaffLeaveBalanceRef.implement({
  description: "Per-type leave balance for a staff member in a year (§3.1/§3.4 budget surface).",
  fields: (t) => ({
    leaveType: t.exposeString("leaveType"),
    paid: t.exposeBoolean("paid"),
    balanceTracked: t.exposeBoolean("balanceTracked"),
    allowanceDays: t.exposeInt("allowanceDays"),
    carriedOverDays: t.exposeInt("carriedOverDays"),
    // Float since D-#361 — a partial day draws 1/3, so a balance can be fractional.
    takenDays: t.exposeFloat("takenDays"),
    remainingDays: t.exposeFloat("remainingDays"),
    encashableDays: t.exposeInt("encashableDays"),
  }),
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("upsertStaffLeaveEntitlement", (t) =>
  t.field({
    type: StaffLeaveBalanceRef,
    description:
      "Grant/edit a staff member's leave allowance for a year + balance-tracked type (§3.1). " +
      "Allowances are admin DATA (numbers parked, §10). Requires leave:manage. Audited.",
    authScopes: { hasPermission: "leave:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      academicYearId: t.arg.string({ required: true }),
      leaveType: t.arg.string({ required: true }),
      allowanceDays: t.arg.int({ required: true }),
      carriedOverDays: t.arg.int({ required: false }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await upsertEntitlement({
        staffProfileId: args.staffProfileId,
        academicYearId: args.academicYearId,
        leaveType: args.leaveType as LeaveType,
        allowanceDays: args.allowanceDays,
        carriedOverDays: args.carriedOverDays ?? undefined,
        note: args.note ?? undefined,
        actorId: ctx.auth!.userId,
      });
      const balances = await balancesForStaff(args.staffProfileId, args.academicYearId);
      return (
        balances.find((b) => b.leaveType === args.leaveType) ?? {
          leaveType: args.leaveType as LeaveType,
          paid: true, balanceTracked: true,
          allowanceDays: args.allowanceDays, carriedOverDays: args.carriedOverDays ?? 0,
          takenDays: 0, remainingDays: args.allowanceDays + (args.carriedOverDays ?? 0), encashableDays: args.carriedOverDays ?? 0,
        }
      );
    },
  }),
);

builder.mutationField("applyForStaffLeave", (t) =>
  t.field({
    type: StaffLeaveRef,
    description:
      "Record a staff leave application (prd-hr H2.1). A teacher applies for THEIR OWN leave " +
      "(own-row; omit staffProfileId). Principal/Office (leave:manage) may record on any staff " +
      "member's behalf by passing staffProfileId. Fans out cover slots. Audited. " +
      "`dayPart` (D-#361) is optional/additive: omitted or \"full\" is the original whole-day " +
      "leave; \"late_entry\"/\"early_leave\" need `partialPeriodCount` and a single date " +
      "(fromKey === toKey), fan out cover for ONLY the missed periods, and cost 1/3 of a day.",
    authScopes: { authenticated: true },
    args: {
      staffProfileId: t.arg.string({ required: false }),
      leaveType: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
      dayPart: t.arg.string({ required: false }),
      partialPeriodCount: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      let target: string;
      if (args.staffProfileId) {
        if (!hasManage(ctx) && args.staffProfileId !== (await callerStaffProfileId(ctx))) {
          throw new ForbiddenError("You may only apply for your own leave");
        }
        target = args.staffProfileId;
      } else {
        target = await callerStaffProfileId(ctx);
      }
      return applyForLeave({
        staffProfileId: target,
        leaveType: args.leaveType as LeaveType,
        fromKey: args.fromKey,
        toKey: args.toKey,
        reason: args.reason,
        dayPart: (args.dayPart ?? undefined) as LeaveDayPart | undefined,
        partialPeriodCount: args.partialPeriodCount ?? undefined,
        actorId: ctx.auth!.userId,
      }) as unknown as Promise<LeaveShape>;
    },
  }),
);

builder.mutationField("decideStaffLeave", (t) =>
  t.field({
    type: StaffLeaveRef,
    description:
      "Approve / reject (Principal/Office, leave:manage) or cancel (the applicant, own-row, OR " +
      "leave:manage) a leave. Approve stamps the paid/unpaid split — the exceed rule WARNS, never " +
      "blocks (§3.3); cancel/reject revoke any live cover proxy grants. Audited.",
    authScopes: { authenticated: true },
    args: {
      applicationId: t.arg.string({ required: true }),
      decision: t.arg.string({ required: true }), // approve | reject | cancel
      note: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const decision = args.decision as LeaveDecision;
      if (!["approve", "reject", "cancel"].includes(decision)) {
        throw new ForbiddenError("decision must be approve, reject or cancel");
      }
      if (decision !== "cancel" && !hasManage(ctx)) {
        throw new ForbiddenError("Only Principal/Office may approve or reject leave (leave:manage)");
      }
      if (decision === "cancel" && !hasManage(ctx)) {
        const app = await StaffLeaveApplication.findById(args.applicationId).select("staffProfileId").lean();
        if (!app || app.staffProfileId.toString() !== (await callerStaffProfileId(ctx))) {
          throw new ForbiddenError("You may only cancel your own leave");
        }
      }
      return decideLeave(args.applicationId, decision, ctx.auth!.userId, args.note ?? undefined) as unknown as Promise<LeaveShape>;
    },
  }),
);

builder.mutationField("proposeStaffCover", (t) =>
  t.field({
    type: StaffCoverSlotRef,
    description:
      "Propose a covering teacher for a leave's cover slot (the legwork, D-#22) — does NOT grant " +
      "write access. The leave's applicant (own-row) or Principal/Office may propose. Audited.",
    authScopes: { authenticated: true },
    args: {
      slotId: t.arg.string({ required: true }),
      coverTeacherUserId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!hasManage(ctx)) {
        const slot = await coverSlotOwnerLeave(args.slotId);
        if (!slot || slot.staffProfileId !== (await callerStaffProfileId(ctx))) {
          throw new ForbiddenError("You may only propose cover on your own leave");
        }
      }
      return proposeCover(args.slotId, args.coverTeacherUserId, ctx.auth!.userId) as unknown as Promise<IStaffCoverSlot>;
    },
  }),
);

builder.mutationField("decideStaffCoverSlot", (t) =>
  t.field({
    type: StaffCoverSlotRef,
    description:
      "Approve a proposed (or, with an override, a needs-cover) slot → mint a one-day D-#20 proxy " +
      "grant (write access begins), or reject it → back to needs-cover (D-#22). `overrideCoverTeacherUserId` " +
      "(PXG-1, D-#268) is optional/additive: omitted, behavior is unchanged; supplied, it mints for the " +
      "override teacher instead of the proposer's pick, and lets a proposal-less slot be direct-assigned. " +
      "Requires leave:manage. Audited.",
    authScopes: { hasPermission: "leave:manage" },
    args: {
      slotId: t.arg.string({ required: true }),
      approve: t.arg.boolean({ required: true }),
      overrideCoverTeacherUserId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      decideCoverSlot(
        args.slotId,
        args.approve,
        ctx.auth!.userId,
        args.overrideCoverTeacherUserId ?? undefined,
      ) as unknown as Promise<IStaffCoverSlot>,
  }),
);

/** The owning leave's staffProfileId for a cover slot (own-row propose gate). */
async function coverSlotOwnerLeave(slotId: string): Promise<{ staffProfileId: string } | null> {
  const { StaffCoverSlot } = await import("../models/StaffCoverSlot");
  const slot = await StaffCoverSlot.findById(slotId).select("leaveApplicationId").lean();
  if (!slot) return null;
  const leave = await StaffLeaveApplication.findById(slot.leaveApplicationId).select("staffProfileId").lean();
  return leave ? { staffProfileId: leave.staffProfileId.toString() } : null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("staffLeaveApplications", (t) =>
  t.field({
    type: [StaffLeaveRef],
    description: "All staff leave applications overlapping a range, optionally by status (Office/Principal). Requires leave:manage.",
    authScopes: { hasPermission: "leave:manage" },
    args: {
      status: t.arg.string({ required: false }),
      fromKey: t.arg.string({ required: false }),
      toKey: t.arg.string({ required: false }),
    },
    resolve: async (_root, args) =>
      listLeave({
        status: args.status ?? undefined,
        fromKey: args.fromKey ?? undefined,
        toKey: args.toKey ?? undefined,
      }) as unknown as Promise<LeaveShape[]>,
  }),
);

builder.queryField("staffLeavePendingCount", (t) =>
  t.field({
    type: "Int",
    description:
      "How many leave applications are awaiting approval (status 'applied') — the Staff drawer badge " +
      "(owner 2026-07-26). Requires leave:manage.",
    authScopes: { hasPermission: "leave:manage" },
    resolve: async () => StaffLeaveApplication.countDocuments({ status: "applied" }),
  }),
);

builder.queryField("staffLeaveBalances", (t) =>
  t.field({
    type: [StaffLeaveBalanceRef],
    description: "Per-type leave balances for a staff member in a year (§3.1/§3.4). Requires leave:manage.",
    authScopes: { hasPermission: "leave:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      academicYearId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) => balancesForStaff(args.staffProfileId, args.academicYearId),
  }),
);

builder.queryField("staffCoverSlots", (t) =>
  t.field({
    type: [StaffCoverSlotRef],
    description: "The cover slots of a leave (prd-hr §3.5). leave:manage, or the leave's applicant (own-row).",
    authScopes: { authenticated: true },
    args: { leaveApplicationId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!hasManage(ctx)) {
        const leave = await StaffLeaveApplication.findById(args.leaveApplicationId).select("staffProfileId").lean();
        if (!leave || leave.staffProfileId.toString() !== (await callerStaffProfileId(ctx))) {
          throw new ForbiddenError("You may only view cover slots for your own leave");
        }
      }
      return coverSlotsForLeave(args.leaveApplicationId) as unknown as Promise<IStaffCoverSlot[]>;
    },
  }),
);

builder.queryField("needsCoverSlots", (t) =>
  t.field({
    type: [NeedsCoverRowRef],
    description:
      "Every uncovered class meeting (across all approved leaves overlapping the range) — the " +
      "cross-leave inbox (PXG-1, D-#268). Same gate as decideStaffCoverSlot.",
    authScopes: { hasPermission: "leave:manage" },
    args: {
      from: t.arg.string({ required: true }),
      to: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) => needsCoverSlots(args.from, args.to),
  }),
);

builder.queryField("myStaffLeave", (t) =>
  t.field({
    type: [StaffLeaveRef],
    description: "The caller's own staff leave applications (own-row, prd-hr H2.7). No permission needed.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) =>
      leaveForStaff(await callerStaffProfileId(ctx)) as unknown as Promise<LeaveShape[]>,
  }),
);

builder.queryField("myStaffLeaveBalances", (t) =>
  t.field({
    type: [StaffLeaveBalanceRef],
    description: "The caller's own leave balances for a year (own-row, prd-hr H2.7). No permission needed.",
    authScopes: { authenticated: true },
    args: { academicYearId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => balancesForStaff(await callerStaffProfileId(ctx), args.academicYearId),
  }),
);
