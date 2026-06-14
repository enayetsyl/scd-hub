/**
 * HR-4 performance / conduct / development resolvers (prd-hr §5, H5, D-#28/#112/#113).
 *
 * RBAC:
 *   performance:manage (Principal/Office) — read+manage ALL observations, prepare
 *     appraisals, record conduct steps + hearings, handle grievances, log CPD.
 *   performance:signoff (PRINCIPAL only) — sign off an appraisal outcome + finalize a
 *     conduct step (the central judgement; Office cannot — a distinct permission the
 *     verifier proves, mirroring payroll:approve, D-#112).
 *   Supervisor observation-WRITE (NO permission) — a supervisor submits observations
 *     ONLY within their existing supervisory ScopeGrant extent (D-#28, composed via
 *     `userCanObserve`); they read ONLY their own observations (H5.2), never the
 *     outcome, others' inputs, or any conduct record.
 *   Own-row self-service (NO permission) — a staff member raises a grievance and reads
 *     their OWN conduct / appraisal / grievance / development records (the subject's
 *     own record, H5.5). The caller's StaffProfile is the phone-link (staffMatch).
 *
 * Confidentiality (satr, H5.5/H7.3): conduct/grievance/appraisal-outcome are
 * Principal/Office + the subject only; supervisors never see conduct. Identity-plane
 * only; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission, type AppraisalOutcome, type ConductStage, type GrievanceStatus } from "@scd/shared";
import type { AppContext } from "../../../context";
import { resolveStaffProfileForUser } from "../services/staffMatch";
import { userCanObserve } from "../services/observationScope";
import { PerformanceError } from "../services/conductLadder";
import {
  submitObservation,
  observationsForStaff,
  observationsByObserver,
  upsertAppraisal,
  signOffAppraisal,
  appraisalsForStaff,
  addDevelopmentLog,
  developmentLogForStaff,
} from "../services/PerformanceService";
import {
  recordConductStep,
  recordConductHearing,
  finalizeConductStep,
  conductForStaff,
} from "../services/ConductService";
import {
  raiseGrievance,
  updateGrievance,
  listGrievances,
  grievancesRaisedBy,
} from "../services/GrievanceService";
import type { IObservation } from "../models/Observation";
import type { IAppraisal } from "../models/Appraisal";
import type { IConductRecord } from "../models/ConductRecord";
import type { IGrievance } from "../models/Grievance";
import type { IDevelopmentLog } from "../models/DevelopmentLog";

// ---------------------------------------------------------------------------
// Gates / helpers
// ---------------------------------------------------------------------------

function hasManage(ctx: AppContext): boolean {
  return ctx.auth !== null && callerHasPermission(ctx.auth, "performance:manage");
}
function hasSignoff(ctx: AppContext): boolean {
  return ctx.auth !== null && callerHasPermission(ctx.auth, "performance:signoff");
}

/** The caller's own StaffProfile id (own-row self-service), or throw. */
async function callerStaffProfileId(ctx: AppContext): Promise<string> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const staff = await resolveStaffProfileForUser(ctx.auth.userId);
  if (!staff) throw new ForbiddenError("No staff profile is linked to your login");
  return staff._id.toString();
}

/** Map a PerformanceError to a ForbiddenError-style GraphQL error (keeps the message). */
function asError(e: unknown): never {
  if (e instanceof PerformanceError || e instanceof ForbiddenError) throw e;
  throw e;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const ObservationRef = builder.objectRef<IObservation>("Observation");
ObservationRef.implement({
  description: "A performance observation event (HR-4; prd-hr §5.1, D-#28).",
  fields: (t) => ({
    id: t.string({ resolve: (o) => o._id.toString() }),
    staffProfileId: t.string({ resolve: (o) => o.staffProfileId.toString() }),
    observerId: t.string({ resolve: (o) => o.observerId.toString() }),
    dateKey: t.exposeString("dateKey"),
    classId: t.string({ nullable: true, resolve: (o) => o.classId?.toString() ?? null }),
    subjectId: t.string({ nullable: true, resolve: (o) => o.subjectId?.toString() ?? null }),
    notes: t.exposeString("notes"),
    followUp: t.string({ nullable: true, resolve: (o) => o.followUp ?? null }),
    appraisalId: t.string({ nullable: true, resolve: (o) => o.appraisalId?.toString() ?? null }),
    createdAt: t.string({ resolve: (o) => new Date(o.createdAt).toISOString() }),
  }),
});

const AppraisalRef = builder.objectRef<IAppraisal>("Appraisal");
AppraisalRef.implement({
  description: "An annual appraisal cycle (HR-4; prd-hr §5.1). Outcome is Principal-only (H5.2).",
  fields: (t) => ({
    id: t.string({ resolve: (a) => a._id.toString() }),
    staffProfileId: t.string({ resolve: (a) => a.staffProfileId.toString() }),
    academicYearId: t.string({ resolve: (a) => a.academicYearId.toString() }),
    status: t.exposeString("status"),
    goals: t.stringList({ resolve: (a) => a.goals ?? [] }),
    developmentNeeds: t.stringList({ resolve: (a) => a.developmentNeeds ?? [] }),
    overallOutcome: t.string({ nullable: true, resolve: (a) => a.overallOutcome ?? null }),
    outcomeNote: t.string({ nullable: true, resolve: (a) => a.outcomeNote ?? null }),
    signedOffAt: t.string({ nullable: true, resolve: (a) => (a.signedOffAt ? new Date(a.signedOffAt).toISOString() : null) }),
    createdAt: t.string({ resolve: (a) => new Date(a.createdAt).toISOString() }),
  }),
});

const ConductRecordRef = builder.objectRef<IConductRecord>("ConductRecord");
ConductRecordRef.implement({
  description: "A disciplinary-ladder step (HR-4; prd-hr §5.2, D-#113). Confidential (H5.5).",
  fields: (t) => ({
    id: t.string({ resolve: (c) => c._id.toString() }),
    staffProfileId: t.string({ resolve: (c) => c.staffProfileId.toString() }),
    stage: t.exposeString("stage"),
    status: t.exposeString("status"),
    grossMisconduct: t.exposeBoolean("grossMisconduct"),
    issue: t.exposeString("issue"),
    category: t.string({ nullable: true, resolve: (c) => c.category ?? null }),
    evidence: t.string({ nullable: true, resolve: (c) => c.evidence ?? null }),
    hearingNote: t.string({ nullable: true, resolve: (c) => c.hearingNote ?? null }),
    hearingHeldAt: t.string({ nullable: true, resolve: (c) => (c.hearingHeldAt ? new Date(c.hearingHeldAt).toISOString() : null) }),
    liveUntil: t.string({ nullable: true, resolve: (c) => (c.liveUntil ? new Date(c.liveUntil).toISOString() : null) }),
    outcome: t.string({ nullable: true, resolve: (c) => c.outcome ?? null }),
    finalizedAt: t.string({ nullable: true, resolve: (c) => (c.finalizedAt ? new Date(c.finalizedAt).toISOString() : null) }),
    createdAt: t.string({ resolve: (c) => new Date(c.createdAt).toISOString() }),
  }),
});

const GrievanceRef = builder.objectRef<IGrievance>("Grievance");
GrievanceRef.implement({
  description: "A staff-raised confidential grievance (HR-4; prd-hr §5.2, H5.4).",
  fields: (t) => ({
    id: t.string({ resolve: (g) => g._id.toString() }),
    raisedByStaffProfileId: t.string({ resolve: (g) => g.raisedByStaffProfileId.toString() }),
    subject: t.exposeString("subject"),
    detail: t.exposeString("detail"),
    status: t.exposeString("status"),
    resolutionNote: t.string({ nullable: true, resolve: (g) => g.resolutionNote ?? null }),
    handledAt: t.string({ nullable: true, resolve: (g) => (g.handledAt ? new Date(g.handledAt).toISOString() : null) }),
    createdAt: t.string({ resolve: (g) => new Date(g.createdAt).toISOString() }),
  }),
});

const DevelopmentLogRef = builder.objectRef<IDevelopmentLog>("DevelopmentLog");
DevelopmentLogRef.implement({
  description: "A per-staff CPD development-log entry (HR-4; prd-hr §5.3, H5.4).",
  fields: (t) => ({
    id: t.string({ resolve: (d) => d._id.toString() }),
    staffProfileId: t.string({ resolve: (d) => d.staffProfileId.toString() }),
    activity: t.exposeString("activity"),
    dateKey: t.exposeString("dateKey"),
    outcome: t.string({ nullable: true, resolve: (d) => d.outcome ?? null }),
    sourceAppraisalId: t.string({ nullable: true, resolve: (d) => d.sourceAppraisalId?.toString() ?? null }),
    createdAt: t.string({ resolve: (d) => new Date(d.createdAt).toISOString() }),
  }),
});

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

builder.mutationField("submitObservation", (t) =>
  t.field({
    type: ObservationRef,
    description:
      "Submit a performance observation (prd-hr H5.1/H5.2). A SUPERVISOR may submit only " +
      "within their existing supervisory extent (D-#28, no permission); Principal/Office " +
      "(performance:manage) may submit on any staff. Audited.",
    authScopes: { authenticated: true },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
      notes: t.arg.string({ required: true }),
      classId: t.arg.string({ required: false }),
      subjectId: t.arg.string({ required: false }),
      followUp: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (!hasManage(ctx)) {
        // Bounded supervisor write: must cover the observation's (class, subject) extent.
        const ok = await userCanObserve(ctx.auth.userId, args.classId ?? undefined, args.subjectId ?? undefined);
        if (!ok) {
          throw new ForbiddenError(
            "You may only observe within your supervisory extent (D-#28)",
          );
        }
      }
      try {
        return (await submitObservation({
          staffProfileId: args.staffProfileId,
          observerId: ctx.auth.userId,
          dateKey: args.dateKey,
          notes: args.notes,
          classId: args.classId ?? undefined,
          subjectId: args.subjectId ?? undefined,
          followUp: args.followUp ?? undefined,
        })) as unknown as IObservation;
      } catch (e) {
        asError(e);
      }
    },
  }),
);

builder.queryField("myObservations", (t) =>
  t.field({
    type: [ObservationRef],
    description: "The caller's OWN observations they authored (supervisor sees only their own, H5.2). No permission.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return observationsByObserver(ctx.auth.userId) as unknown as Promise<IObservation[]>;
    },
  }),
);

builder.queryField("staffObservations", (t) =>
  t.field({
    type: [ObservationRef],
    description: "All observations of a staff member (admin read). Requires performance:manage.",
    authScopes: { hasPermission: "performance:manage" },
    args: { staffProfileId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => observationsForStaff(args.staffProfileId) as unknown as Promise<IObservation[]>,
  }),
);

// ---------------------------------------------------------------------------
// Appraisal
// ---------------------------------------------------------------------------

builder.mutationField("upsertAppraisal", (t) =>
  t.field({
    type: AppraisalRef,
    description:
      "Prepare/edit a DRAFT annual appraisal — goals + development needs (prd-hr H5.1). " +
      "Requires performance:manage. Outcome is set only at Principal sign-off. Audited.",
    authScopes: { hasPermission: "performance:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      academicYearId: t.arg.string({ required: true }),
      goals: t.arg.stringList({ required: false }),
      developmentNeeds: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      try {
        return (await upsertAppraisal({
          staffProfileId: args.staffProfileId,
          academicYearId: args.academicYearId,
          goals: args.goals ?? undefined,
          developmentNeeds: args.developmentNeeds ?? undefined,
          actorId: ctx.auth!.userId,
        })) as unknown as IAppraisal;
      } catch (e) {
        asError(e);
      }
    },
  }),
);

builder.mutationField("signOffAppraisal", (t) =>
  t.field({
    type: AppraisalRef,
    description:
      "PRINCIPAL-only sign-off (performance:signoff): set the overall outcome, lock the " +
      "appraisal, and emit its development needs into the CPD log (prd-hr H5.2/H5.4). Audited.",
    authScopes: { hasPermission: "performance:signoff" },
    args: {
      appraisalId: t.arg.string({ required: true }),
      outcome: t.arg.string({ required: true }),
      outcomeNote: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      try {
        return (await signOffAppraisal({
          appraisalId: args.appraisalId,
          outcome: args.outcome as AppraisalOutcome,
          outcomeNote: args.outcomeNote ?? undefined,
          actorId: ctx.auth!.userId,
        })) as unknown as IAppraisal;
      } catch (e) {
        asError(e);
      }
    },
  }),
);

builder.queryField("staffAppraisals", (t) =>
  t.field({
    type: [AppraisalRef],
    description: "All appraisals of a staff member (admin read). Requires performance:manage.",
    authScopes: { hasPermission: "performance:manage" },
    args: { staffProfileId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => appraisalsForStaff(args.staffProfileId) as unknown as Promise<IAppraisal[]>,
  }),
);

builder.queryField("myAppraisals", (t) =>
  t.field({
    type: [AppraisalRef],
    description: "The caller's OWN appraisals incl. outcome (the subject's own record, H5.5). No permission.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) =>
      appraisalsForStaff(await callerStaffProfileId(ctx)) as unknown as Promise<IAppraisal[]>,
  }),
);

// ---------------------------------------------------------------------------
// Conduct ladder
// ---------------------------------------------------------------------------

builder.mutationField("recordConductStep", (t) =>
  t.field({
    type: ConductRecordRef,
    description:
      "Raise a DRAFT conduct-ladder step (prd-hr H5.3). The ladder enforces order " +
      "(verbal→written→final→termination, no rung-skip); gross misconduct may fast-track " +
      "to final/termination. Requires performance:manage. Audited.",
    authScopes: { hasPermission: "performance:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      stage: t.arg.string({ required: true }),
      issue: t.arg.string({ required: true }),
      category: t.arg.string({ required: false }),
      evidence: t.arg.string({ required: false }),
      grossMisconduct: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      try {
        return (await recordConductStep({
          staffProfileId: args.staffProfileId,
          stage: args.stage as ConductStage,
          issue: args.issue,
          category: args.category ?? undefined,
          evidence: args.evidence ?? undefined,
          grossMisconduct: args.grossMisconduct ?? false,
          actorId: ctx.auth!.userId,
        })) as unknown as IConductRecord;
      } catch (e) {
        asError(e);
      }
    },
  }),
);

builder.mutationField("recordConductHearing", (t) =>
  t.field({
    type: ConductRecordRef,
    description:
      "Capture the person's response/hearing BEFORE finalisation ('adl, not optional, prd-hr H5.3). " +
      "Moves the step to hearing_held. Requires performance:manage. Audited.",
    authScopes: { hasPermission: "performance:manage" },
    args: {
      recordId: t.arg.string({ required: true }),
      hearingNote: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      try {
        return (await recordConductHearing(args.recordId, args.hearingNote, ctx.auth!.userId)) as unknown as IConductRecord;
      } catch (e) {
        asError(e);
      }
    },
  }),
);

builder.mutationField("finalizeConductStep", (t) =>
  t.field({
    type: ConductRecordRef,
    description:
      "PRINCIPAL-only (performance:signoff): finalise a conduct step — the disciplinary " +
      "judgement. Requires a recorded hearing first ('adl); a termination step writes " +
      "employmentStatus → terminated (offboarding trigger, prd-hr H5.3). Audited.",
    authScopes: { hasPermission: "performance:signoff" },
    args: {
      recordId: t.arg.string({ required: true }),
      liveUntilKey: t.arg.string({ required: false }),
      outcome: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      try {
        return (await finalizeConductStep({
          recordId: args.recordId,
          actorId: ctx.auth!.userId,
          liveUntilKey: args.liveUntilKey ?? undefined,
          outcome: args.outcome ?? undefined,
        })) as unknown as IConductRecord;
      } catch (e) {
        asError(e);
      }
    },
  }),
);

builder.queryField("staffConductRecords", (t) =>
  t.field({
    type: [ConductRecordRef],
    description: "A staff member's conduct ladder (admin read; supervisors NEVER see conduct, H5.5). Requires performance:manage.",
    authScopes: { hasPermission: "performance:manage" },
    args: { staffProfileId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => conductForStaff(args.staffProfileId) as unknown as Promise<IConductRecord[]>,
  }),
);

builder.queryField("myConductRecords", (t) =>
  t.field({
    type: [ConductRecordRef],
    description: "The caller's OWN conduct records (the subject's own record only, H5.5). No permission.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) =>
      conductForStaff(await callerStaffProfileId(ctx)) as unknown as Promise<IConductRecord[]>,
  }),
);

// ---------------------------------------------------------------------------
// Grievance
// ---------------------------------------------------------------------------

builder.mutationField("raiseGrievance", (t) =>
  t.field({
    type: GrievanceRef,
    description:
      "Raise a confidential grievance (own-row; routed to the Principal, prd-hr H5.4). " +
      "The caller's StaffProfile is the phone-link; no permission needed. Audited.",
    authScopes: { authenticated: true },
    args: {
      subject: t.arg.string({ required: true }),
      detail: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const staffProfileId = await callerStaffProfileId(ctx);
      try {
        return (await raiseGrievance({
          raisedByStaffProfileId: staffProfileId,
          subject: args.subject,
          detail: args.detail,
          actorId: ctx.auth!.userId,
        })) as unknown as IGrievance;
      } catch (e) {
        asError(e);
      }
    },
  }),
);

builder.mutationField("updateGrievance", (t) =>
  t.field({
    type: GrievanceRef,
    description:
      "Move a grievance under_review / resolved / closed with a note (prd-hr H5.4). " +
      "Requires performance:manage (Principal/Office). Audited.",
    authScopes: { hasPermission: "performance:manage" },
    args: {
      grievanceId: t.arg.string({ required: true }),
      status: t.arg.string({ required: true }),
      resolutionNote: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      try {
        return (await updateGrievance({
          grievanceId: args.grievanceId,
          status: args.status as GrievanceStatus,
          resolutionNote: args.resolutionNote ?? undefined,
          actorId: ctx.auth!.userId,
        })) as unknown as IGrievance;
      } catch (e) {
        asError(e);
      }
    },
  }),
);

builder.queryField("grievances", (t) =>
  t.field({
    type: [GrievanceRef],
    description: "All grievances, optionally by status (admin read, H5.5). Requires performance:manage.",
    authScopes: { hasPermission: "performance:manage" },
    args: { status: t.arg.string({ required: false }) },
    resolve: async (_root, args) => listGrievances(args.status ?? undefined) as unknown as Promise<IGrievance[]>,
  }),
);

builder.queryField("myGrievances", (t) =>
  t.field({
    type: [GrievanceRef],
    description: "The caller's OWN raised grievances (the subject's own record, H5.5). No permission.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) =>
      grievancesRaisedBy(await callerStaffProfileId(ctx)) as unknown as Promise<IGrievance[]>,
  }),
);

// ---------------------------------------------------------------------------
// Development (CPD)
// ---------------------------------------------------------------------------

builder.mutationField("addDevelopmentLog", (t) =>
  t.field({
    type: DevelopmentLogRef,
    description: "Add a CPD development-log entry for a staff member (prd-hr H5.4). Requires performance:manage. Audited.",
    authScopes: { hasPermission: "performance:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      activity: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: false }),
      outcome: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      try {
        return (await addDevelopmentLog({
          staffProfileId: args.staffProfileId,
          activity: args.activity,
          dateKey: args.dateKey ?? undefined,
          outcome: args.outcome ?? undefined,
          actorId: ctx.auth!.userId,
        })) as unknown as IDevelopmentLog;
      } catch (e) {
        asError(e);
      }
    },
  }),
);

builder.queryField("staffDevelopmentLog", (t) =>
  t.field({
    type: [DevelopmentLogRef],
    description: "A staff member's CPD log (admin read). Requires performance:manage.",
    authScopes: { hasPermission: "performance:manage" },
    args: { staffProfileId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => developmentLogForStaff(args.staffProfileId) as unknown as Promise<IDevelopmentLog[]>,
  }),
);

builder.queryField("myDevelopmentLog", (t) =>
  t.field({
    type: [DevelopmentLogRef],
    description: "The caller's OWN CPD log (own-row; growth, not confidential). No permission.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) =>
      developmentLogForStaff(await callerStaffProfileId(ctx)) as unknown as Promise<IDevelopmentLog[]>,
  }),
);
