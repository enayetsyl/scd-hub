/**
 * Recheck / tabulation resolvers — EX-4 (docs/prd-exams.md §6).
 *
 * The "rechecker cannot peek" rule is enforced HERE, at the read: `examRecheckWorksheet`
 * passes `revealAll` only for a manager or the tabulator. For the assigned RECHECKER the
 * checker's figure comes back null on every row they have not yet answered — the paper
 * sheet's side-by-side columns made that impossible, which is why most of the scanned
 * recheck columns are simply the checker's number copied across.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission, EXAM_COMPONENTS, MARK_ENTRY_STATUSES } from "@scd/shared";
import type { AppContext } from "../../../context";
import {
  recheckWorksheet,
  enterRecheckMarks,
  divergenceReport,
  resolveDivergence,
  tabulationReadiness,
  tabulatePaper,
  reopenPaper,
  type RecheckWorksheetRow,
  type DivergenceRow,
  type TabulationReadiness,
} from "../services/ExamRecheckService";
import { ExamError } from "../services/ExamService";
import { assertAssignedTo, isAssignedTo } from "../services/ExamAssignmentService";
import type { IExamPaper } from "../models/ExamPaper";

const isManager = (ctx: AppContext): boolean =>
  ctx.auth !== null && callerHasPermission(ctx.auth, "exam:manage");

function rethrow(err: unknown): never {
  if (err instanceof ExamError) throw new ForbiddenError(err.message);
  throw err;
}

async function assertDuty(
  ctx: AppContext,
  paperId: string,
  roles: readonly ("CHECKER" | "RECHECKER" | "TABULATOR" | "MARK_RECHECKER")[],
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (isManager(ctx)) return;
  if (!callerHasPermission(ctx.auth, "exam:mark")) {
    throw new ForbiddenError("খাতা মূল্যায়নের অনুমতি নেই");
  }
  try {
    await assertAssignedTo(paperId, ctx.auth.userId, roles);
  } catch (err) { rethrow(err); }
}

const RecheckRowRef = builder.objectRef<RecheckWorksheetRow>("ExamRecheckRow");
RecheckRowRef.implement({
  description:
    "One row of the rechecker's worksheet. `checkerRawMark` is NULL until this rechecker " +
    "has entered their own figure — the independence the paper sheet cannot enforce.",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    component: t.exposeString("component"),
    checkerRawMark: t.float({ nullable: true, resolve: (r) => r.checkerRawMark }),
    checkerStatus: t.string({ nullable: true, resolve: (r) => r.checkerStatus }),
    recheckRawMark: t.float({ nullable: true, resolve: (r) => r.recheckRawMark }),
    recheckStatus: t.string({ nullable: true, resolve: (r) => r.recheckStatus }),
    divergent: t.exposeBoolean("divergent"),
    resolvedRawMark: t.float({ nullable: true, resolve: (r) => r.resolvedRawMark }),
  }),
});

const DivergenceRef = builder.objectRef<DivergenceRow>("ExamDivergence");
DivergenceRef.implement({
  description: "A checker/rechecker disagreement. Must be resolved before tabulation.",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    component: t.exposeString("component"),
    checkerRawMark: t.float({ nullable: true, resolve: (r) => r.checkerRawMark }),
    checkerStatus: t.exposeString("checkerStatus"),
    recheckRawMark: t.float({ nullable: true, resolve: (r) => r.recheckRawMark }),
    recheckStatus: t.exposeString("recheckStatus"),
    resolved: t.exposeBoolean("resolved"),
  }),
});

const ReadinessRef = builder.objectRef<TabulationReadiness>("ExamTabulationReadiness");
ReadinessRef.implement({
  description: "Why a paper can or cannot be tabulated — every blocker named, not just refused.",
  fields: (t) => ({
    ready: t.exposeBoolean("ready"),
    missingMarks: t.exposeInt("missingMarks"),
    unresolvedDivergences: t.exposeInt("unresolvedDivergences"),
    notRechecked: t.exposeInt("notRechecked"),
    custodyBlockers: t.exposeStringList("custodyBlockers"),
  }),
});

const PaperRef = builder.objectRef<IExamPaper>("ExamPaperLock");
PaperRef.implement({
  fields: (t) => ({
    id: t.string({ resolve: (p) => p._id.toString() }),
    tabulatedAt: t.string({ nullable: true, resolve: (p) => p.tabulatedAt?.toISOString() ?? null }),
  }),
});

builder.queryField("examRecheckWorksheet", (t) =>
  t.field({
    type: [RecheckRowRef],
    description:
      "The rechecker's worksheet. A plain RECHECKER sees the checker's figure only on rows " +
      "they have already answered; a manager or tabulator sees everything.",
    authScopes: { authenticated: true },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertDuty(ctx, args.paperId, ["RECHECKER", "TABULATOR", "MARK_RECHECKER"]);
      const revealAll =
        isManager(ctx) ||
        (await isAssignedTo(args.paperId, ctx.auth!.userId, ["TABULATOR", "MARK_RECHECKER"]));
      try {
        return await recheckWorksheet(args.paperId, revealAll);
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.queryField("examDivergences", (t) =>
  t.field({
    type: [DivergenceRef],
    description: "Every checker/rechecker disagreement on a paper.",
    authScopes: { authenticated: true },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertDuty(ctx, args.paperId, ["RECHECKER", "TABULATOR", "MARK_RECHECKER"]);
      try {
        return await divergenceReport(args.paperId);
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.queryField("examTabulationReadiness", (t) =>
  t.field({
    type: ReadinessRef,
    description: "Whether the paper can be locked, and what is blocking it if not.",
    authScopes: { authenticated: true },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertDuty(ctx, args.paperId, ["TABULATOR", "MARK_RECHECKER", "RECHECKER"]);
      try {
        return await tabulationReadiness(args.paperId);
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("enterExamRecheckMarks", (t) =>
  t.int({
    description:
      "Enter the rechecker's INDEPENDENT figures. Requires a RECHECKER assignment for this " +
      "paper. Refuses a row the checker never filled. Audited.",
    authScopes: { authenticated: true },
    args: {
      paperId: t.arg.string({ required: true }),
      studentIds: t.arg.stringList({ required: true }),
      components: t.arg.stringList({ required: true }),
      statuses: t.arg.stringList({ required: true }),
      rawMarks: t.arg.floatList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertDuty(ctx, args.paperId, ["RECHECKER"]);
      const n = args.studentIds.length;
      if (args.components.length !== n || args.statuses.length !== n) {
        throw new ForbiddenError("শিক্ষার্থী, অংশ ও উপস্থিতির সংখ্যা মিলছে না");
      }
      for (const c of args.components) {
        if (!EXAM_COMPONENTS.includes(c as never)) throw new ForbiddenError(`অজানা অংশ: ${c}`);
      }
      for (const s of args.statuses) {
        if (!MARK_ENTRY_STATUSES.includes(s as never)) throw new ForbiddenError(`অজানা উপস্থিতি: ${s}`);
      }
      try {
        return await enterRecheckMarks(
          args.paperId,
          args.studentIds.map((studentId, i) => ({
            studentId,
            component: args.components[i] as never,
            status: args.statuses[i] as never,
            rawMark: args.rawMarks?.[i] ?? null,
          })),
          ctx.auth!.userId,
        );
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("resolveExamDivergence", (t) =>
  t.boolean({
    description:
      "Settle one disagreement with an explicitly agreed figure. The agreed value wins over " +
      "BOTH passes — neither the checker nor the rechecker is automatically right. Audited " +
      "with both original figures. Tabulator or manager.",
    authScopes: { authenticated: true },
    args: {
      paperId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      component: t.arg.string({ required: true }),
      status: t.arg.string({ required: true }),
      rawMark: t.arg.float({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertDuty(ctx, args.paperId, ["TABULATOR", "MARK_RECHECKER"]);
      if (!EXAM_COMPONENTS.includes(args.component as never)) throw new ForbiddenError("অজানা অংশ");
      if (!MARK_ENTRY_STATUSES.includes(args.status as never)) throw new ForbiddenError("অজানা উপস্থিতি");
      try {
        await resolveDivergence(
          args.paperId, args.studentId, args.component as never,
          args.status as never, args.rawMark ?? null, ctx.auth!.userId,
        );
        return true;
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("tabulateExamPaper", (t) =>
  t.field({
    type: PaperRef,
    description:
      "Lock the paper. REFUSES while any divergence is unresolved or a mark is missing — " +
      "and, from EX-7, while custody is unbalanced. Audited.",
    authScopes: { authenticated: true },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertDuty(ctx, args.paperId, ["TABULATOR"]);
      try {
        return await tabulatePaper(args.paperId, ctx.auth!.userId);
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("reopenExamPaper", (t) =>
  t.field({
    type: PaperRef,
    description:
      "Re-open a tabulated paper with a REQUIRED reason. Office/Principal (exam:manage) " +
      "only — never a side effect of another action. Audited.",
    authScopes: { authenticated: true },
    args: {
      paperId: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (!isManager(ctx)) throw new ForbiddenError("পুনরায় খোলা অফিস বা প্রধান শিক্ষকের কাজ");
      try {
        return await reopenPaper(args.paperId, args.reason, ctx.auth.userId);
      } catch (err) { rethrow(err); }
    },
  }),
);
