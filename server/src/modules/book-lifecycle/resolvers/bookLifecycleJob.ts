/**
 * Book-lifecycle GraphQL, BL-5 (docs/prd-book-lifecycle.md §14; S10): the AI edit job — estimate
 * (nothing written), start, stop, progress, and a book's jobs (paged, D-#761). Starting needs
 * `ai_edit` + `manage` (re-checked in the service); the job only ever writes a draft (VR-15).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { assertBookPlane } from "../services/access";
import type { IBookEditJob, BookEditJobChapter } from "../models/BookEditJob";
import * as J from "../services/editJob";

const auth = (ctx: AppContext) => {
  assertBookPlane();
  return ctx.auth!;
};

const LeftOutRef = builder.objectRef<{ code: string; reasonBn: string }>("BookLcJobLeftOut").implement({
  fields: (t) => ({ code: t.exposeString("code"), reasonBn: t.exposeString("reasonBn") }),
});

type EstimateShape = Awaited<ReturnType<typeof J.previewEditJob>>;
const EstimateRef = builder.objectRef<EstimateShape>("BookLcJobEstimate").implement({
  fields: (t) => ({
    model: t.exposeString("model"),
    capUsd: t.exposeFloat("capUsd"),
    chapters: t.exposeInt("chapters"),
    units: t.exposeInt("units"),
    inputTokens: t.exposeInt("inputTokens"),
    outputTokens: t.exposeInt("outputTokens"),
    usd: t.exposeFloat("usd"),
    large: t.exposeBoolean("large"),
    leftOut: t.field({ type: [LeftOutRef], resolve: (e) => e.leftOut }),
  }),
});

const JobChapterRef = builder.objectRef<BookEditJobChapter>("BookLcJobChapter").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    status: t.exposeString("status"),
    attempts: t.exposeInt("attempts"),
    fixes: t.exposeInt("fixes"),
    costUsd: t.exposeFloat("costUsd"),
    cacheHitTokens: t.exposeInt("cacheHitTokens"),
    cacheMissTokens: t.exposeInt("cacheMissTokens"),
    outputTokens: t.exposeInt("outputTokens"),
    errorBn: t.string({ nullable: true, resolve: (c) => c.errorBn ?? null }),
  }),
});

const JobRef = builder.objectRef<IBookEditJob>("BookLcEditJob").implement({
  fields: (t) => ({
    id: t.string({ resolve: (j) => j._id.toString() }),
    bookId: t.string({ resolve: (j) => j.bookId.toString() }),
    draftId: t.string({ resolve: (j) => j.draftId.toString() }),
    provider: t.exposeString("provider"),
    model: t.exposeString("modelName"),
    reasoning: t.exposeString("reasoning"),
    status: t.exposeString("status"),
    capUsd: t.exposeFloat("capUsd"),
    estimateUsd: t.exposeFloat("estimateUsd"),
    spentUsd: t.exposeFloat("spentUsd"),
    note: t.string({ nullable: true, resolve: (j) => j.note ?? null }),
    createdAt: t.string({ resolve: (j) => j.createdAt.toISOString() }),
    finishedAt: t.string({ nullable: true, resolve: (j) => j.finishedAt?.toISOString() ?? null }),
    chapters: t.field({ type: [JobChapterRef], resolve: (j) => j.chapters }),
    leftOut: t.field({ type: [LeftOutRef], resolve: (j) => j.leftOut ?? [] }),
  }),
});

const JobsPageRef = builder.objectRef<{ rows: IBookEditJob[]; total: number; page: number; pageSize: number }>("BookLcEditJobPage").implement({
  fields: (t) => ({ rows: t.field({ type: [JobRef], resolve: (p) => p.rows }), total: t.exposeInt("total"), page: t.exposeInt("page"), pageSize: t.exposeInt("pageSize") }),
});

const InstructionIn = builder.inputType("BookLcJobInstructionInput", {
  fields: (t) => ({ text: t.string({ required: true }), needsReview: t.boolean() }),
});
const JobIn = builder.inputType("BookLcEditJobInput", {
  fields: (t) => ({
    feedback: t.stringList(),
    instructions: t.field({ type: [InstructionIn] }),
    scopeChapterKeys: t.stringList(),
    model: t.string(),
    reasoning: t.string(),
    capUsd: t.float(),
    confirmLarge: t.boolean(),
  }),
});

type JobInShape = { feedback?: string[] | null; instructions?: { text: string; needsReview?: boolean | null }[] | null; scopeChapterKeys?: string[] | null; model?: string | null; reasoning?: string | null; capUsd?: number | null; confirmLarge?: boolean | null };
const toInput = (i: JobInShape): J.StartJobInput => ({
  feedback: i.feedback ?? [],
  instructions: i.instructions ?? [],
  scopeChapterKeys: i.scopeChapterKeys ?? [],
  model: i.model ?? null,
  reasoning: i.reasoning === "off" || i.reasoning === "high" ? i.reasoning : "low",
  capUsd: i.capUsd ?? null,
  confirmLarge: i.confirmLarge ?? false,
});

builder.queryField("bookLcEditJobEstimate", (t) =>
  t.field({
    type: EstimateRef,
    authScopes: { hasPermission: "book_lifecycle:ai_edit" },
    description: "S10: tokens and dollars for these choices on the latest version. Nothing is written.",
    args: { bookId: t.arg.string({ required: true }), input: t.arg({ type: JobIn, required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return J.previewEditJob(auth(ctx), a.bookId, toInput(a.input));
    },
  }),
);

builder.mutationField("startBookLcEditJob", (t) =>
  t.field({
    type: JobRef,
    authScopes: { hasPermission: "book_lifecycle:ai_edit" },
    description: "S10 শুরু করুন: opens an ai_job draft and queues the job (model pinned). It never creates a version.",
    args: { bookId: t.arg.string({ required: true }), input: t.arg({ type: JobIn, required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return (await J.startEditJob(auth(ctx), a.bookId, toInput(a.input))).job;
    },
  }),
);

builder.mutationField("stopBookLcEditJob", (t) =>
  t.field({
    type: JobRef,
    authScopes: { hasPermission: "book_lifecycle:ai_edit" },
    args: { jobId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return J.stopEditJob(auth(ctx), a.jobId);
    },
  }),
);

builder.mutationField("rerunBookLcEditJobFailed", (t) =>
  t.field({
    type: JobRef,
    authScopes: { hasPermission: "book_lifecycle:ai_edit" },
    description: "§14.1: the failed chapters of a finished job, again, as a new job on the same open draft.",
    args: { jobId: t.arg.string({ required: true }), capUsd: t.arg.float(), confirmLarge: t.arg.boolean() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return J.rerunFailedChapters(auth(ctx), a.jobId, { capUsd: a.capUsd ?? null, confirmLarge: a.confirmLarge ?? false });
    },
  }),
);

builder.queryField("bookLcEditJob", (t) =>
  t.field({
    type: JobRef,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { jobId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return J.loadJob(auth(ctx), a.jobId);
    },
  }),
);

builder.queryField("bookLcEditJobsPage", (t) =>
  t.field({
    type: JobsPageRef,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { bookId: t.arg.string({ required: true }), page: t.arg.int(), pageSize: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return J.jobsPage(auth(ctx), a.bookId, a.page ?? 1, a.pageSize ?? 20);
    },
  }),
);
