/**
 * HR-5 offboarding resolvers (prd-hr §6, H6, D-#29/#117).
 *
 * RBAC (composed from existing permissions — NO new permission, D-#117):
 *   staff:manage (Principal/Office) — initiate, manage the clearance checklist,
 *     trigger access revocation manually, record the exit interview, issue the
 *     service certificate, cancel, and read cases (HR personnel admin).
 *   payroll:manage (Principal/Office) — compute the hard-held final settlement.
 *   payroll:approve (PRINCIPAL only) — RELEASE the settlement after clearance (the
 *     D-#29 hard-hold authority; Office cannot release).
 *
 * Confidentiality (H7.1/H7.3 unchanged): offboarding rows are Principal/Office only.
 * Identity-plane only; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { OffboardingTrigger, ClearanceItemStatus, PayAdditionType } from "@scd/shared";
import {
  initiateOffboarding,
  addClearanceItem,
  updateClearanceItem,
  revokeOffboardingAccess,
  computeFinalSettlement,
  releaseFinalSettlement,
  recordExitInterview,
  issueServiceCertificate,
  cancelOffboarding,
  offboardingCaseById,
  offboardingCases,
  offboardingCasesForStaff,
} from "../services/OffboardingService";
import type { IOffboardingCase, IClearanceItem, ISettlementLine, IFinalSettlement } from "../models/OffboardingCase";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const ClearanceItemRef = builder.objectRef<IClearanceItem>("ClearanceItem");
ClearanceItemRef.implement({
  description: "A clearance checklist line (HR-5; prd-hr §6.2).",
  fields: (t) => ({
    key: t.exposeString("key"),
    label: t.exposeString("label"),
    status: t.exposeString("status"),
    note: t.string({ nullable: true, resolve: (i) => i.note ?? null }),
    updatedAt: t.string({ nullable: true, resolve: (i) => (i.updatedAt ? new Date(i.updatedAt).toISOString() : null) }),
  }),
});

const SettlementLineRef = builder.objectRef<ISettlementLine>("SettlementLine");
SettlementLineRef.implement({
  description: "A computed settlement line (mirrors a payroll pay line).",
  fields: (t) => ({
    type: t.exposeString("type"),
    amount: t.exposeInt("amount"),
    days: t.int({ nullable: true, resolve: (l) => l.days ?? null }),
    note: t.string({ nullable: true, resolve: (l) => l.note ?? null }),
  }),
});

const FinalSettlementRef = builder.objectRef<IFinalSettlement>("FinalSettlement");
FinalSettlementRef.implement({
  description: "The hard-held final settlement (HR-5; prd-hr §6.4, D-#29).",
  fields: (t) => ({
    workingDays: t.exposeInt("workingDays"),
    payableDays: t.int({ nullable: true, resolve: (s) => s.payableDays ?? null }),
    dayRate: t.exposeInt("dayRate"),
    grossSalary: t.exposeInt("grossSalary"),
    leaveEncashmentDays: t.exposeInt("leaveEncashmentDays"),
    deductions: t.field({ type: [SettlementLineRef], resolve: (s) => s.deductions }),
    additions: t.field({ type: [SettlementLineRef], resolve: (s) => s.additions }),
    totalDeductions: t.exposeInt("totalDeductions"),
    totalAdditions: t.exposeInt("totalAdditions"),
    netPay: t.exposeInt("netPay"),
    advanceRecovered: t.exposeInt("advanceRecovered"),
    held: t.exposeBoolean("held"),
    computedAt: t.string({ resolve: (s) => new Date(s.computedAt).toISOString() }),
    releasedAt: t.string({ nullable: true, resolve: (s) => (s.releasedAt ? new Date(s.releasedAt).toISOString() : null) }),
  }),
});

const OffboardingCaseRef = builder.objectRef<IOffboardingCase>("OffboardingCase");
OffboardingCaseRef.implement({
  description: "A staff offboarding case (HR-5; prd-hr §6, D-#29). Principal/Office only.",
  fields: (t) => ({
    id: t.string({ resolve: (c) => c._id.toString() }),
    staffProfileId: t.string({ resolve: (c) => c.staffProfileId.toString() }),
    trigger: t.exposeString("trigger"),
    status: t.exposeString("status"),
    noticeDateKey: t.string({ nullable: true, resolve: (c) => c.noticeDateKey ?? null }),
    lastWorkingDayKey: t.exposeString("lastWorkingDayKey"),
    clearanceItems: t.field({ type: [ClearanceItemRef], resolve: (c) => c.clearanceItems ?? [] }),
    accessRevoked: t.exposeBoolean("accessRevoked"),
    accessRevokedAt: t.string({ nullable: true, resolve: (c) => (c.accessRevokedAt ? new Date(c.accessRevokedAt).toISOString() : null) }),
    grantsRevokedCount: t.int({ nullable: true, resolve: (c) => c.grantsRevokedCount ?? 0 }),
    loginDisabled: t.boolean({ nullable: true, resolve: (c) => c.loginDisabled ?? false }),
    settlement: t.field({ type: FinalSettlementRef, nullable: true, resolve: (c) => c.settlement ?? null }),
    exitInterviewReason: t.string({ nullable: true, resolve: (c) => c.exitInterview?.reason ?? null }),
    exitInterviewFeedback: t.string({ nullable: true, resolve: (c) => c.exitInterview?.feedback ?? null }),
    serviceCertificateIssuedAt: t.string({ nullable: true, resolve: (c) => (c.serviceCertificateIssuedAt ? new Date(c.serviceCertificateIssuedAt).toISOString() : null) }),
    createdAt: t.string({ resolve: (c) => new Date(c.createdAt).toISOString() }),
  }),
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("initiateOffboarding", (t) =>
  t.field({
    type: OffboardingCaseRef,
    description:
      "Open an offboarding case (prd-hr H6.1). The trigger sets StaffProfile.employmentStatus " +
      "(resignation→resigned, termination→terminated, fixed_term_end→contract_ended, retirement→retired). " +
      "Seeds the default clearance checklist. Requires staff:manage. Audited.",
    authScopes: { hasPermission: "staff:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      trigger: t.arg.string({ required: true }),
      lastWorkingDayKey: t.arg.string({ required: true }),
      noticeDateKey: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      initiateOffboarding({
        staffProfileId: args.staffProfileId,
        trigger: args.trigger as OffboardingTrigger,
        lastWorkingDayKey: args.lastWorkingDayKey,
        noticeDateKey: args.noticeDateKey ?? undefined,
        actorId: ctx.auth!.userId,
      }) as unknown as Promise<IOffboardingCase>,
  }),
);

builder.mutationField("addOffboardingClearanceItem", (t) =>
  t.field({
    type: OffboardingCaseRef,
    description: "Add a clearance checklist item (prd-hr H6.2). Requires staff:manage. Audited.",
    authScopes: { hasPermission: "staff:manage" },
    args: {
      caseId: t.arg.string({ required: true }),
      key: t.arg.string({ required: true }),
      label: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) =>
      addClearanceItem(args.caseId, args.key, args.label, ctx.auth!.userId) as unknown as Promise<IOffboardingCase>,
  }),
);

builder.mutationField("updateOffboardingClearanceItem", (t) =>
  t.field({
    type: OffboardingCaseRef,
    description: "Set a clearance item done/waived/pending with a note (prd-hr H6.2). Requires staff:manage. Audited.",
    authScopes: { hasPermission: "staff:manage" },
    args: {
      caseId: t.arg.string({ required: true }),
      key: t.arg.string({ required: true }),
      status: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      updateClearanceItem(
        args.caseId,
        args.key,
        args.status as ClearanceItemStatus,
        args.note ?? undefined,
        ctx.auth!.userId,
      ) as unknown as Promise<IOffboardingCase>,
  }),
);

builder.mutationField("revokeOffboardingAccess", (t) =>
  t.field({
    type: OffboardingCaseRef,
    description:
      "Disable the login + revoke ALL scope grants for the leaver (prd-hr H6.3) — normally done " +
      "automatically by the system on the last working day; this is the manual admin path (same " +
      "last-working-day gate). Idempotent. Requires staff:manage. Audited.",
    authScopes: { hasPermission: "staff:manage" },
    args: { caseId: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) =>
      revokeOffboardingAccess({ caseId: args.caseId, actorId: ctx.auth!.userId }) as unknown as Promise<IOffboardingCase>,
  }),
);

builder.mutationField("computeFinalSettlement", (t) =>
  t.field({
    type: OffboardingCaseRef,
    description:
      "Compute the final settlement (prd-hr H6.4): salary pro-rated to the last day (payableDays) + " +
      "arrears + full leave encashment − outstanding advance. HARD-HELD until clearance (D-#29). " +
      "Recompute-safe while held. Requires payroll:manage. Audited.",
    authScopes: { hasPermission: "payroll:manage" },
    args: {
      caseId: t.arg.string({ required: true }),
      workingDays: t.arg.int({ required: true }),
      academicYearId: t.arg.string({ required: false }),
      payableDays: t.arg.int({ required: false }),
      arrearsAmount: t.arg.int({ required: false }),
      arrearsNote: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      computeFinalSettlement({
        caseId: args.caseId,
        workingDays: args.workingDays,
        academicYearId: args.academicYearId ?? undefined,
        payableDays: args.payableDays ?? undefined,
        manualAdditions:
          args.arrearsAmount && args.arrearsAmount > 0
            ? [{ type: "arrears" as PayAdditionType, amount: args.arrearsAmount, note: args.arrearsNote ?? undefined }]
            : undefined,
        actorId: ctx.auth!.userId,
      }) as unknown as Promise<IOffboardingCase>,
  }),
);

builder.mutationField("releaseFinalSettlement", (t) =>
  t.field({
    type: OffboardingCaseRef,
    description:
      "PRINCIPAL-only (payroll:approve): release the hard-held settlement — GATED on clearance being " +
      "complete (every item done/waived, H6.4/D-#29). Commits the advance recovery + closes the case. Audited.",
    authScopes: { hasPermission: "payroll:approve" },
    args: { caseId: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) =>
      releaseFinalSettlement(args.caseId, ctx.auth!.userId) as unknown as Promise<IOffboardingCase>,
  }),
);

builder.mutationField("recordExitInterview", (t) =>
  t.field({
    type: OffboardingCaseRef,
    description: "Record the optional exit interview — reason + feedback (prd-hr H6.5). Requires staff:manage. Audited.",
    authScopes: { hasPermission: "staff:manage" },
    args: {
      caseId: t.arg.string({ required: true }),
      reason: t.arg.string({ required: false }),
      feedback: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      recordExitInterview(args.caseId, args.reason ?? undefined, args.feedback ?? undefined, ctx.auth!.userId) as unknown as Promise<IOffboardingCase>,
  }),
);

builder.mutationField("issueServiceCertificate", (t) =>
  t.field({
    type: OffboardingCaseRef,
    description: "Issue a service/experience certificate (prd-hr H6.5). Requires staff:manage. Audited.",
    authScopes: { hasPermission: "staff:manage" },
    args: { caseId: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) =>
      issueServiceCertificate(args.caseId, ctx.auth!.userId) as unknown as Promise<IOffboardingCase>,
  }),
);

builder.mutationField("cancelOffboarding", (t) =>
  t.field({
    type: OffboardingCaseRef,
    description: "Withdraw an exit before access has been revoked (prd-hr §6). Requires staff:manage. Audited.",
    authScopes: { hasPermission: "staff:manage" },
    args: { caseId: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) =>
      cancelOffboarding(args.caseId, ctx.auth!.userId) as unknown as Promise<IOffboardingCase>,
  }),
);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("offboardingCase", (t) =>
  t.field({
    type: OffboardingCaseRef,
    nullable: true,
    description: "One offboarding case by id (Principal/Office). Requires staff:manage.",
    authScopes: { hasPermission: "staff:manage" },
    args: { caseId: t.arg.string({ required: true }) },
    resolve: (_root, args) => offboardingCaseById(args.caseId) as unknown as Promise<IOffboardingCase | null>,
  }),
);

builder.queryField("offboardingCases", (t) =>
  t.field({
    type: [OffboardingCaseRef],
    description: "All offboarding cases, optionally by status (Principal/Office). Requires staff:manage.",
    authScopes: { hasPermission: "staff:manage" },
    args: { status: t.arg.string({ required: false }) },
    resolve: (_root, args) => offboardingCases(args.status ?? undefined) as unknown as Promise<IOffboardingCase[]>,
  }),
);

builder.queryField("offboardingCasesForStaff", (t) =>
  t.field({
    type: [OffboardingCaseRef],
    description: "A staff member's offboarding case history (Principal/Office). Requires staff:manage.",
    authScopes: { hasPermission: "staff:manage" },
    args: { staffProfileId: t.arg.string({ required: true }) },
    resolve: (_root, args) => offboardingCasesForStaff(args.staffProfileId) as unknown as Promise<IOffboardingCase[]>,
  }),
);
