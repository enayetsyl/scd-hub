/**
 * Guardian work-claim resolvers — the STAFF side (GC-4/GC-5, D-#551..#554).
 *
 * Seeing and being told are separate (D-#554): every one of these reads is open
 * to all three staff roles from the instant a claim is filed. The 10:30 digest
 * (D-#710) is a scheduler concern, not a visibility one — but whoever the Principal
 * adds to the digest may open the queue it links to, and nudge from it.
 *
 *   myWorkClaims     — the teacher's own open claims (Today card + roster badge)
 *   workClaimQueue   — the unresolved queue, oldest (school days pending) first
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
import { GuardianWorkClaim } from "../models/GuardianWorkClaim";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { rejectWorkClaim as rejectSvc } from "../services/WorkClaimService";
import type { GuardianWorkClaimView } from "../services/WorkClaimView";
import { emitWorkClaimNudge, emitWorkClaimResolved } from "../../notifications/services/emitters";
import { writeAudit } from "../../platform/services/AuditService";
import { dateKeyOf } from "../../attendance/dates";
import { WorkClaimDigestConfig } from "../models/WorkClaimDigestConfig";
import { canWatchClaims, makePendingDayCounter } from "../services/WorkClaimDigestService";

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
      "record (GC-3, D-#551). It records an assertion and its answer — it NEVER " +
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
 *  same-day ladder made "how many days old" the wrong question (D-#554). */
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
  /** D-#635: the WORK's own date (the record's due date at file time) — "which
   *  day's homework is this?", the question the queue could not answer. Null on a
   *  claim filed against a record that carried no due date. */
  dueDateKey: string | null;
  note: string | null;
  status: string;
  statusLabelBn: string;
  /** WAITING | OFFICE_TOLD | PRINCIPAL_TOLD | SCHEDULED_TOMORROW */
  checkpoint: string;
  checkpointLabelBn: string;
  /** True once the Office has nudged this claim TODAY (rate limit, D-#554). */
  nudgedToday: boolean;
  /** D-#710: SCHOOL days from the action day through today, inclusive (0 = not yet). */
  pendingSchoolDays: number;
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
    dueDateKey: t.string({ nullable: true, resolve: (r) => r.dueDateKey }),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
    status: t.exposeString("status"),
    statusLabelBn: t.exposeString("statusLabelBn"),
    checkpoint: t.exposeString("checkpoint"),
    checkpointLabelBn: t.exposeString("checkpointLabelBn"),
    nudgedToday: t.exposeBoolean("nudgedToday"),
    pendingSchoolDays: t.exposeInt("pendingSchoolDays"),
  }),
});

const CHECKPOINT_LABELS_BN: Record<string, string> = {
  PRINCIPAL_TOLD: "১০:৩০ পার",
  // Legacy: only claims stamped by the retired 11:30 rung (before D-#710) carry this.
  OFFICE_TOLD: "১১:৩০ পার",
  WAITING: "১০:৩০-এর অপেক্ষায়",
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

  // Sequential on purpose: the counter memoizes each calendar day, and claims share
  // the same handful of days — in parallel every call would miss the memo.
  const countDays = makePendingDayCounter(now);
  const days: number[] = [];
  for (const c of claims) days.push(await countDays(c.actionDateKey));

  const rows = claims.map((c, i) => {
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
      dueDateKey: c.dueDate ? dateKeyOf(new Date(c.dueDate)) : null,
      note: c.note ?? null,
      status: c.status,
      statusLabelBn: WORK_CLAIM_STATUS_LABELS_BN[c.status as never] ?? c.status,
      checkpoint,
      checkpointLabelBn: CHECKPOINT_LABELS_BN[checkpoint] ?? checkpoint,
      nudgedToday: !!c.lastNudgedAt && dateKeyOf(new Date(c.lastNudgedAt)) === todayKey,
      pendingSchoolDays: days[i],
    };
  });

  // D-#710: longest-waiting first — "how many days at the teacher's hand" is now
  // the question (owner ruling 2026-10-04), with the ladder rank as the tie-break.
  rows.sort(
    (a, b) =>
      b.pendingSchoolDays - a.pendingSchoolDays ||
      (CHECKPOINT_RANK[a.checkpoint] ?? 9) - (CHECKPOINT_RANK[b.checkpoint] ?? 9) ||
      a.claimedAt.localeCompare(b.claimedAt),
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Reads — visible to all three roles from the moment a claim is filed (D-#554)
//
// NOT gated on tracker:read (BUG-WC-3): OFFICE holds no tracker permission at
// all — that is the very guarantee that stops it marking work submitted — so
// gating its own queue on that permission locked the Office out of the screen
// built for it. The isAdminStaff check in each resolver is the real gate.
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
    authScopes: { authenticated: true },
    description:
      "Every unresolved guardian claim, longest-waiting first (school days pending, D-#710). " +
      "The Office/Principal queue, also open to the Principal's chosen digest recipients.",
    resolve: async (_r, _a, ctx) => {
      // The queue is the OFFICE/PRINCIPAL screen and is unscoped by design: the
      // whole point of a claim is that somebody above the teacher can see it
      // (D-#554). A teacher reads their OWN claims through myWorkClaims instead —
      // unless the Principal added them to the 10:30 digest (D-#710), which links here.
      if (!(await canWatchClaims(ctx))) throw new ForbiddenError();
      const claims = (await GuardianWorkClaim.find({ status: "PENDING" })
        .sort({ claimedAt: 1 })
        .lean()) as unknown as Array<Record<string, any>>;
      return toRows(claims, new Date());
    },
  }),
);

// ---------------------------------------------------------------------------
// The one manual close (D-#552) — needs tracker:write, which OFFICE never holds
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
      "Close a guardian claim with a reason the family will see (D-#552). The ONLY " +
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
// The nudge (D-#554) — the entire extent of what the Office can do
// ---------------------------------------------------------------------------

builder.mutationField("nudgeWorkClaim", (t) =>
  t.field({
    type: WorkClaimRowRef,
    authScopes: { authenticated: true },
    description:
      "Re-fire the teacher's notification for one open claim, at most once per claim " +
      "per day. This is ALL the Office can do — it holds no tracker:write and can " +
      "never mark the work submitted itself (D-#554).",
    args: { claimId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => {
      // Whoever may watch the queue may nudge from it (D-#554, D-#710) — the nudge is
      // a reminder to the teacher, never a change to the work.
      if (!(await canWatchClaims(ctx))) throw new ForbiddenError();
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

// ---------------------------------------------------------------------------
// The 10:30 digest's extra recipients (D-#710) — Principal-edited
// ---------------------------------------------------------------------------

interface DigestRecipient {
  userId: string;
  name: string;
  role: string;
}

const DigestRecipientRef = builder.objectRef<DigestRecipient>("WorkClaimDigestRecipient").implement({
  description: "A person the Principal added to the 10:30 guardian-claim digest (D-#710).",
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
    role: t.exposeString("role"),
  }),
});

async function extraRecipients(): Promise<DigestRecipient[]> {
  const cfg = (await WorkClaimDigestConfig.findOne({ key: "SINGLETON" })
    .select("extraRecipientIds")
    .lean()) as unknown as { extraRecipientIds?: Types.ObjectId[] } | null;
  const ids = cfg?.extraRecipientIds ?? [];
  if (ids.length === 0) return [];
  const users = (await User.find({ _id: { $in: ids }, active: true })
    .select("name role")
    .sort({ name: 1 })
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name?: string; role?: string }>;
  return users.map((u) => ({ userId: u._id.toString(), name: u.name ?? "", role: u.role ?? "" }));
}

builder.queryField("workClaimDigestRecipients", (t) =>
  t.field({
    type: [DigestRecipientRef],
    authScopes: { authenticated: true },
    description:
      "Who the Principal added to the 10:30 digest, on top of every Principal and Office user " +
      "(D-#710). Readable by whoever may watch the queue.",
    resolve: async (_r, _a, ctx) => {
      if (!(await canWatchClaims(ctx))) throw new ForbiddenError();
      return extraRecipients();
    },
  }),
);

builder.mutationField("setWorkClaimDigestRecipients", (t) =>
  t.field({
    type: [DigestRecipientRef],
    authScopes: { authenticated: true },
    description:
      "Replace the 10:30 digest's extra recipients (D-#710). PRINCIPAL only. Every Principal " +
      "and Office user always receives it; these are the people added on top, and they may " +
      "also open the claim queue and nudge from it.",
    args: { userIds: t.arg.stringList({ required: true }) },
    resolve: async (_r, args, ctx) => {
      if (ctx.auth?.role !== "PRINCIPAL") throw new ForbiddenError();
      const unique = [...new Set(args.userIds)];
      if (unique.some((id) => !Types.ObjectId.isValid(id))) throw new Error("অজানা ব্যবহারকারী");
      const users = (await User.find({
        _id: { $in: unique.map((id) => new Types.ObjectId(id)) },
        active: true,
        role: { $ne: "GUARDIAN" },
      })
        .select("_id")
        .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
      if (users.length !== unique.length) {
        throw new Error("শুধু সক্রিয় কর্মীদের যোগ করা যায়");
      }
      await WorkClaimDigestConfig.findOneAndUpdate(
        { key: "SINGLETON" },
        {
          $set: {
            extraRecipientIds: users.map((u) => u._id),
            updatedBy: new Types.ObjectId(ctx.auth.userId),
          },
        },
        { upsert: true },
      );
      await writeAudit({
        eventKind: "WORK_CLAIM_DIGEST_RECIPIENTS_SET",
        actorId: ctx.auth.userId,
        targetKind: "WorkClaimDigestConfig",
        meta: { userIds: unique },
      });
      return extraRecipients();
    },
  }),
);

export { WorkClaimRowRef };
export type { WorkClaimRow };
