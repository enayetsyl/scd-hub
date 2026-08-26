/**
 * Guardian work-claim resolvers — the STAFF side (GC-4/GC-5, D-#548..#551).
 *
 * Seeing and being told are separate (D-#551): every one of these reads is open
 * to all three staff roles from the instant a claim is filed. The 11:30 / 13:00
 * notifications are a scheduler concern, not a visibility one.
 *
 *   myWorkClaims     — the teacher's own open claims (Today card + roster badge)
 *   workClaimQueue   — the Office/Principal unresolved queue, checkpoint-sorted
 *   rejectWorkClaim  — the ONE manual close; needs tracker:write, so Office cannot
 *   nudgeWorkClaim   — re-fire the teacher's notification; Office's ENTIRE power here
 *
 * `myWorkClaims` is `authenticated: true` and degrades to [] for a caller with no
 * claims of their own — the D-#535 rule: a dashboard field that can refuse is a
 * field that can white-screen the app.
 */
import { Types } from "mongoose";
import { WORK_CLAIM_REJECT_REASONS, WORK_CLAIM_STATUS_LABELS_BN, WORK_CLAIM_REJECT_REASON_LABELS_BN } from "@scd/shared";
import type { WorkClaimRejectReason } from "@scd/shared";
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { isAdminStaff } from "../../foundation/services/RoleScope";
import { GuardianWorkClaim } from "../models/GuardianWorkClaim";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { rejectWorkClaim as rejectSvc } from "../services/WorkClaimService";
import type { GuardianWorkClaimView } from "../services/WorkClaimView";
import { emitWorkClaimNudge, emitWorkClaimResolved } from "../../notifications/services/emitters";
import { writeAudit } from "../../platform/services/AuditService";
import { dateKeyOf } from "../../attendance/dates";

/**
 * The guardian-facing claim view, defined HERE and imported by the guardian
 * portal and the assignment resolver. One GraphQL type, so a parent reading the
 * homework screen and the assignment screen cannot be shown two different shapes.
 */
export const GuardianWorkClaimGqlRef = builder
  .objectRef<GuardianWorkClaimView>("GuardianWorkClaim")
  .implement({
    description:
      "A guardian's \"বাড়িতে সম্পন্ন হয়েছে\" declaration on one homework/assignment " +
      "record (GC-3, D-#548). It records an assertion and its answer — it NEVER " +
      "moves the record's lifecycle state; only a teacher does that.",
    fields: (t) => ({
      claimId: t.exposeString("claimId"),
      status: t.exposeString("status"),
      statusLabelBn: t.exposeString("statusLabelBn"),
      claimedAt: t.exposeString("claimedAt"),
      resolvedAt: t.string({ nullable: true, resolve: (r) => r.resolvedAt }),
      rejectReasonLabelBn: t.string({ nullable: true, resolve: (r) => r.rejectReasonLabelBn }),
      rejectNote: t.string({ nullable: true, resolve: (r) => r.rejectNote }),
      attemptNumber: t.exposeInt("attemptNumber"),
      canReclaim: t.exposeBoolean("canReclaim"),
    }),
  });

/** One row of either staff list. `checkpoint` is what the queue sorts on — the
 *  same-day ladder made "how many days old" the wrong question (D-#551). */
interface WorkClaimRow {
  claimId: string;
  tracker: string;
  workId: string;
  subject: string;
  studentId: string;
  studentNameBn: string;
  sectionId: string;
  sectionNameBn: string;
  teacherId: string;
  teacherName: string;
  claimedAt: string;
  actionDateKey: string;
  note: string | null;
  status: string;
  statusLabelBn: string;
  /** WAITING | OFFICE_TOLD | PRINCIPAL_TOLD | SCHEDULED_TOMORROW */
  checkpoint: string;
  checkpointLabelBn: string;
  /** True once the Office has nudged this claim TODAY (rate limit, D-#551). */
  nudgedToday: boolean;
}

const WorkClaimRowRef = builder.objectRef<WorkClaimRow>("WorkClaimRow").implement({
  description:
    "An unresolved guardian claim as staff see it. Visible to teacher, Office and " +
    "Principal from the moment it is filed — notification is a separate, laddered thing.",
  fields: (t) => ({
    claimId: t.exposeString("claimId"),
    tracker: t.exposeString("tracker"),
    workId: t.exposeString("workId"),
    subject: t.exposeString("subject"),
    studentId: t.exposeString("studentId"),
    studentNameBn: t.exposeString("studentNameBn"),
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    teacherId: t.exposeString("teacherId"),
    teacherName: t.exposeString("teacherName"),
    claimedAt: t.exposeString("claimedAt"),
    actionDateKey: t.exposeString("actionDateKey"),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
    status: t.exposeString("status"),
    statusLabelBn: t.exposeString("statusLabelBn"),
    checkpoint: t.exposeString("checkpoint"),
    checkpointLabelBn: t.exposeString("checkpointLabelBn"),
    nudgedToday: t.exposeBoolean("nudgedToday"),
  }),
});

const CHECKPOINT_LABELS_BN: Record<string, string> = {
  PRINCIPAL_TOLD: "১৩:০০ পার",
  OFFICE_TOLD: "১১:৩০ পার",
  WAITING: "১১:৩০-এর অপেক্ষায়",
  SCHEDULED_TOMORROW: "আগামী কর্মদিবস",
};

/** Rank for the queue sort: the furthest up the ladder comes first. */
const CHECKPOINT_RANK: Record<string, number> = {
  PRINCIPAL_TOLD: 0,
  OFFICE_TOLD: 1,
  WAITING: 2,
  SCHEDULED_TOMORROW: 3,
};

function checkpointOf(claim: {
  officeNotifiedAt?: Date | null;
  principalNotifiedAt?: Date | null;
  actionDateKey: string;
}, todayKey: string): string {
  if (claim.principalNotifiedAt) return "PRINCIPAL_TOLD";
  if (claim.officeNotifiedAt) return "OFFICE_TOLD";
  return claim.actionDateKey > todayKey ? "SCHEDULED_TOMORROW" : "WAITING";
}

async function toRows(claims: Array<Record<string, any>>, now: Date): Promise<WorkClaimRow[]> {
  if (claims.length === 0) return [];
  const todayKey = dateKeyOf(now);

  // Three batched lookups, never one per row (the D-#476 lesson).
  const students = (await Student.find({ _id: { $in: claims.map((c) => c.studentId) } })
    .select("nameBn name")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; nameBn?: string; name?: string }>;
  const sections = (await Section.find({ _id: { $in: claims.map((c) => c.sectionId) } })
    .select("nameBn code")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; nameBn?: string; code?: string }>;
  const teachers = (await User.find({ _id: { $in: claims.map((c) => c.teacherId) } })
    .select("name")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name?: string }>;

  const sName = new Map(students.map((s) => [s._id.toString(), s.nameBn || s.name || ""]));
  const secName = new Map(sections.map((s) => [s._id.toString(), s.nameBn || s.code || ""]));
  const tName = new Map(teachers.map((u) => [u._id.toString(), u.name || ""]));

  const rows = claims.map((c) => {
    const checkpoint = checkpointOf(c as never, todayKey);
    return {
      claimId: c._id.toString(),
      tracker: c.tracker,
      workId: c.workId,
      subject: c.subject ?? "",
      studentId: c.studentId.toString(),
      studentNameBn: sName.get(c.studentId.toString()) ?? "",
      sectionId: c.sectionId.toString(),
      sectionNameBn: secName.get(c.sectionId.toString()) ?? "",
      teacherId: c.teacherId.toString(),
      teacherName: tName.get(c.teacherId.toString()) ?? "",
      claimedAt: new Date(c.claimedAt).toISOString(),
      actionDateKey: c.actionDateKey,
      note: c.note ?? null,
      status: c.status,
      statusLabelBn: WORK_CLAIM_STATUS_LABELS_BN[c.status as never] ?? c.status,
      checkpoint,
      checkpointLabelBn: CHECKPOINT_LABELS_BN[checkpoint] ?? checkpoint,
      nudgedToday: !!c.lastNudgedAt && dateKeyOf(new Date(c.lastNudgedAt)) === todayKey,
    };
  });

  rows.sort(
    (a, b) =>
      (CHECKPOINT_RANK[a.checkpoint] ?? 9) - (CHECKPOINT_RANK[b.checkpoint] ?? 9) ||
      a.claimedAt.localeCompare(b.claimedAt),
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Reads — visible to all three roles from the moment a claim is filed (D-#551)
// ---------------------------------------------------------------------------

builder.queryField("myWorkClaims", (t) =>
  t.field({
    type: [WorkClaimRowRef],
    authScopes: { authenticated: true },
    description:
      "The caller's OWN open guardian claims — the teacher Today card and the roster " +
      "badge read this. Returns [] for a caller with none (a guardian, the Office), " +
      "never an error: a dashboard field that can refuse can white-screen the app (D-#535).",
    resolve: async (_r, _a, ctx) => {
      if (!ctx.auth) return [];
      const claims = (await GuardianWorkClaim.find({
        teacherId: new Types.ObjectId(ctx.auth.userId),
        status: "PENDING",
      })
        .sort({ claimedAt: 1 })
        .lean()) as unknown as Array<Record<string, any>>;
      return toRows(claims, new Date());
    },
  }),
);

builder.queryField("workClaimQueue", (t) =>
  t.field({
    type: [WorkClaimRowRef],
    authScopes: { hasPermission: "tracker:read" },
    description:
      "Every unresolved guardian claim, checkpoint-first (13:00 passed → 11:30 passed → " +
      "waiting → scheduled for the next school day). The Office/Principal queue.",
    resolve: async (_r, _a, ctx) => {
      // The queue is the OFFICE/PRINCIPAL screen and is unscoped by design: the
      // whole point of a claim is that somebody above the teacher can see it
      // (D-#551). A teacher reads their OWN claims through myWorkClaims instead.
      if (!isAdminStaff(ctx.auth)) throw new ForbiddenError();
      const claims = (await GuardianWorkClaim.find({ status: "PENDING" })
        .sort({ claimedAt: 1 })
        .lean()) as unknown as Array<Record<string, any>>;
      return toRows(claims, new Date());
    },
  }),
);

// ---------------------------------------------------------------------------
// The one manual close (D-#549) — needs tracker:write, which OFFICE never holds
// ---------------------------------------------------------------------------

const RejectReasonEnum = builder.enumType("WorkClaimRejectReason", {
  values: WORK_CLAIM_REJECT_REASONS as unknown as string[],
  description: "A picker value, never free text — the Office queue has to stay readable.",
});

builder.mutationField("rejectWorkClaim", (t) =>
  t.field({
    type: WorkClaimRowRef,
    authScopes: { hasPermission: "tracker:write" },
    description:
      "Close a guardian claim with a reason the family will see (D-#549). The ONLY " +
      "manual close — accepting happens automatically when the teacher marks the " +
      "student submitted, with no second tap.",
    args: {
      claimId: t.arg.string({ required: true }),
      reason: t.arg({ type: RejectReasonEnum, required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      const claim = await rejectSvc({
        claimId: args.claimId,
        actorId: ctx.auth!.userId,
        reason: args.reason as WorkClaimRejectReason,
        note: args.note ?? null,
      });
      await emitWorkClaimResolved(claim as never);
      const rows = await toRows([claim.toObject() as Record<string, any>], new Date());
      return rows[0];
    },
  }),
);

// ---------------------------------------------------------------------------
// The nudge (D-#551) — the entire extent of what the Office can do
// ---------------------------------------------------------------------------

builder.mutationField("nudgeWorkClaim", (t) =>
  t.field({
    type: WorkClaimRowRef,
    authScopes: { hasPermission: "tracker:read" },
    description:
      "Re-fire the teacher's notification for one open claim, at most once per claim " +
      "per day. This is ALL the Office can do — it holds no tracker:write and can " +
      "never mark the work submitted itself (D-#551).",
    args: { claimId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => {
      // The queue is the OFFICE/PRINCIPAL screen and is unscoped by design: the
      // whole point of a claim is that somebody above the teacher can see it
      // (D-#551). A teacher reads their OWN claims through myWorkClaims instead.
      if (!isAdminStaff(ctx.auth)) throw new ForbiddenError();
      const claim = await GuardianWorkClaim.findById(args.claimId);
      if (!claim) throw new Error("জানানোটি পাওয়া যায়নি");
      if (claim.status !== "PENDING") throw new Error("এই জানানোটি ইতিমধ্যেই নিষ্পন্ন হয়েছে");

      const now = new Date();
      const todayKey = dateKeyOf(now);
      if (claim.lastNudgedAt && dateKeyOf(new Date(claim.lastNudgedAt)) === todayKey) {
        throw new Error("আজ একবার মনে করিয়ে দেওয়া হয়েছে — আগামীকাল আবার পারবেন");
      }

      await emitWorkClaimNudge(
        {
          claimId: claim._id.toString(),
          tracker: claim.tracker,
          workId: claim.workId,
          subject: claim.subject,
          studentId: claim.studentId.toString(),
          sectionId: claim.sectionId.toString(),
          teacherId: claim.teacherId.toString(),
          claimedByGuardianId: claim.claimedByGuardianId.toString(),
        },
        now,
      );

      claim.lastNudgedAt = now;
      claim.nudgeCount += 1;
      await claim.save();

      await writeAudit({
        eventKind: "WORK_CLAIM_NUDGED",
        actorId: ctx.auth!.userId,
        targetId: claim._id.toString(),
        targetKind: "GuardianWorkClaim",
        meta: { workId: claim.workId, teacherId: claim.teacherId.toString(), nudgeCount: claim.nudgeCount },
      });

      const rows = await toRows([claim.toObject() as Record<string, any>], now);
      return rows[0];
    },
  }),
);

export { WorkClaimRowRef };
export type { WorkClaimRow };
