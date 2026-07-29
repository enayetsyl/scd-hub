/**
 * Custody resolvers — EX-6 (two-signature handover), EX-7 (reconciliation) and EX-8 (the
 * board, the "waiting on you" list, exceptions). docs/prd-exams.md §6, D-#382.
 *
 * RBAC note: `exam:custody` is held by Office/Principal AND by TEACHER, because a teacher
 * must be able to acknowledge what was handed to them and hand it on. The ROW gates —
 * "only the named receiver may acknowledge", "only the giver may cancel" — live in the
 * service and are what actually constrain it; the permission alone lets nobody touch
 * somebody else's handover.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission, CUSTODY_STAGES, CUSTODY_ITEM_KINDS } from "@scd/shared";
import type { AppContext } from "../../../context";
import {
  recordHandover,
  acknowledgeHandover,
  cancelHandover,
  custodyBalance,
  custodyEventsForExam,
  myPendingAcknowledgements,
  custodyExceptions,
  type CustodyBalance,
  type StageTally,
} from "../services/ExamCustodyService";
import { ExamError } from "../services/ExamService";
import type { IExamCustodyEvent } from "../models/ExamCustodyEvent";
import { User } from "../../foundation/models/User";

function assertCustody(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam:custody")) {
    throw new ForbiddenError("হস্তান্তর নথিভুক্ত করার অনুমতি নেই");
  }
}

function assertExamReader(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam:read")) {
    throw new ForbiddenError("পরীক্ষার তথ্য দেখার অনুমতি নেই");
  }
}

function rethrow(err: unknown): never {
  if (err instanceof ExamError) throw new ForbiddenError(err.message);
  throw err;
}

interface CustodyView {
  doc: IExamCustodyEvent;
  fromName: string | null;
  toName: string | null;
}

const CustodyEventRef = builder.objectRef<CustodyView>("ExamCustodyEvent");
CustodyEventRef.implement({
  description:
    "One physical handover. A DISPUTED row keeps BOTH counts and a mandatory note — the " +
    "app never overwrites one person's count with the other's (D-#382).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.doc._id.toString() }),
    examId: t.string({ resolve: (v) => v.doc.examId.toString() }),
    paperId: t.string({ nullable: true, resolve: (v) => v.doc.paperId?.toString() ?? null }),
    stage: t.string({ resolve: (v) => v.doc.stage }),
    itemKind: t.string({ resolve: (v) => v.doc.itemKind }),
    fromUserId: t.string({ resolve: (v) => v.doc.fromUserId.toString() }),
    fromName: t.string({ nullable: true, resolve: (v) => v.fromName }),
    toUserId: t.string({ resolve: (v) => v.doc.toUserId.toString() }),
    toName: t.string({ nullable: true, resolve: (v) => v.toName }),
    declaredCount: t.int({ resolve: (v) => v.doc.declaredCount }),
    countedCount: t.int({ nullable: true, resolve: (v) => v.doc.countedCount ?? null }),
    status: t.string({ resolve: (v) => v.doc.status }),
    discrepancyNote: t.string({ nullable: true, resolve: (v) => v.doc.discrepancyNote ?? null }),
    handedOverAt: t.string({ resolve: (v) => v.doc.handedOverAt.toISOString() }),
    acknowledgedAt: t.string({ nullable: true, resolve: (v) => v.doc.acknowledgedAt?.toISOString() ?? null }),
  }),
});

async function decorate(rows: IExamCustodyEvent[]): Promise<CustodyView[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.fromUserId.toString(), r.toUserId.toString()]))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }) : [];
  const byId = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  return rows.map((doc) => ({
    doc,
    fromName: byId.get(doc.fromUserId.toString()) ?? null,
    toName: byId.get(doc.toUserId.toString()) ?? null,
  }));
}

const TallyRef = builder.objectRef<StageTally>("ExamCustodyTally");
TallyRef.implement({
  fields: (t) => ({
    stage: t.exposeString("stage"),
    declared: t.exposeInt("declared"),
    counted: t.exposeInt("counted"),
    pending: t.exposeInt("pending"),
    disputed: t.exposeInt("disputed"),
  }),
});

const BalanceRef = builder.objectRef<CustodyBalance>("ExamCustodyBalance");
BalanceRef.implement({
  description:
    "The derived balance for one paper. `blockers` is what stops tabulation — named, so " +
    "the screen can say WHY rather than just refusing (D-#382).",
  fields: (t) => ({
    paperId: t.string({ nullable: true, resolve: (b) => b.paperId }),
    studentsPresent: t.exposeInt("studentsPresent"),
    tallies: t.field({ type: [TallyRef], resolve: (b) => b.tallies }),
    blockers: t.exposeStringList("blockers"),
    balanced: t.exposeBoolean("balanced"),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const RecipientRef = builder.objectRef<{ id: string; name: string; role: string }>("ExamCustodyRecipient");
RecipientRef.implement({
  description:
    "Staff a handover may be addressed to. Gated on exam:custody rather than user:manage — " +
    "an Office clerk must be able to pick a receiver without holding the account-admin " +
    "permission, and only active staff can sign for anything.",
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    role: t.exposeString("role"),
  }),
});

builder.queryField("examCustodyRecipients", (t) =>
  t.field({
    type: [RecipientRef],
    description: "Active staff (Principal/Office/Teacher) who can receive a handover.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      assertCustody(ctx);
      const rows = await User.find({ role: { $in: ["PRINCIPAL", "OFFICE", "TEACHER"] }, active: true });
      return rows
        .map((u) => ({ id: u._id.toString(), name: u.name as string, role: u.role as string }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  }),
);

builder.queryField("examCustodyEvents", (t) =>
  t.field({
    type: [CustodyEventRef],
    description: "Every handover on an exam (or one paper), newest first.",
    authScopes: { authenticated: true },
    args: {
      examId: t.arg.string({ required: true }),
      paperId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      return decorate(await custodyEventsForExam(args.examId, args.paperId ?? null));
    },
  }),
);

builder.queryField("examCustodyBalance", (t) =>
  t.field({
    type: BalanceRef,
    description:
      "Derived reconciliation for one paper: issued vs used vs returned, and what is " +
      "blocking tabulation.",
    authScopes: { authenticated: true },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      try {
        return await custodyBalance(args.paperId);
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.queryField("myPendingCustodyAcknowledgements", (t) =>
  t.field({
    type: [CustodyEventRef],
    description:
      "\"Waiting on you\" — handovers addressed to the caller and still unanswered. The " +
      "user id is forced server-side; this cannot be pointed at a peer.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      assertCustody(ctx);
      return decorate(await myPendingAcknowledgements(ctx.auth!.userId));
    },
  }),
);

builder.queryField("examCustodyExceptions", (t) =>
  t.field({
    type: [CustodyEventRef],
    description:
      "Disputed handovers plus anything unacknowledged past `staleHours` (default 48) — " +
      "the Office's exception list.",
    authScopes: { authenticated: true },
    args: {
      examId: t.arg.string({ required: true }),
      staleHours: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      const { disputed, stale } = await custodyExceptions(args.examId, args.staleHours ?? 48);
      return decorate([...disputed, ...stale]);
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("recordExamCustodyHandover", (t) =>
  t.field({
    type: CustodyEventRef,
    description:
      "The GIVER records a handover with a count. Starts PENDING_ACK — nothing is handed " +
      "over until the named receiver acknowledges. Audited.",
    authScopes: { authenticated: true },
    args: {
      examId: t.arg.string({ required: true }),
      paperId: t.arg.string({ required: false }),
      stage: t.arg.string({ required: true }),
      itemKind: t.arg.string({ required: true }),
      toUserId: t.arg.string({ required: true }),
      declaredCount: t.arg.int({ required: true }),
      attachmentFileIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertCustody(ctx);
      if (!CUSTODY_STAGES.includes(args.stage as never)) throw new ForbiddenError("অজানা ধাপ");
      if (!CUSTODY_ITEM_KINDS.includes(args.itemKind as never)) throw new ForbiddenError("অজানা সামগ্রী");
      try {
        const row = await recordHandover(
          {
            examId: args.examId,
            paperId: args.paperId,
            stage: args.stage as never,
            itemKind: args.itemKind as never,
            toUserId: args.toUserId,
            declaredCount: args.declaredCount,
            attachmentFileIds: args.attachmentFileIds,
          },
          ctx.auth!.userId,
        );
        return (await decorate([row]))[0];
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("acknowledgeExamCustodyHandover", (t) =>
  t.field({
    type: CustodyEventRef,
    description:
      "The NAMED RECEIVER confirms with THEIR own count. Equal → ACKNOWLEDGED; different " +
      "→ DISPUTED, keeping both numbers plus a REQUIRED note. Nobody else can acknowledge, " +
      "not even the giver or a manager. Audited.",
    authScopes: { authenticated: true },
    args: {
      eventId: t.arg.string({ required: true }),
      countedCount: t.arg.int({ required: true }),
      discrepancyNote: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertCustody(ctx);
      try {
        const row = await acknowledgeHandover(
          args.eventId, args.countedCount, args.discrepancyNote ?? null, ctx.auth!.userId,
        );
        return (await decorate([row]))[0];
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("cancelExamCustodyHandover", (t) =>
  t.field({
    type: CustodyEventRef,
    description:
      "The GIVER withdraws a still-unacknowledged handover. An acknowledged or disputed " +
      "one cannot be cancelled — it records something that happened. Audited.",
    authScopes: { authenticated: true },
    args: { eventId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertCustody(ctx);
      try {
        const row = await cancelHandover(args.eventId, ctx.auth!.userId);
        return (await decorate([row]))[0];
      } catch (err) { rethrow(err); }
    },
  }),
);
