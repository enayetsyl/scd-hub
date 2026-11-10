/**
 * AI Workspace W-4 (docs/prd-ai-workspace.md §6) — batch jobs: estimate (both prices), create
 * (run time REQUIRED, D-#1209), list, read with items, cancel. The worker process runs them.
 */
import type { Permission } from "@scd/shared";
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { cancelJob, createJob, estimateJob, job, jobsPage, type JobEstimate, type JobItemView, type JobView } from "../services/JobService";

const WS_SCOPE: { hasAnyPermission: Permission[] } = { hasAnyPermission: ["ai_workspace:use", "ai_workspace:admin"] };
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

const ItemRef = builder.objectRef<JobItemView>("AiJobItem").implement({
  fields: (t) => ({
    id: t.string({ resolve: (i) => i.id }),
    value: t.string({ resolve: (i) => i.value }),
    status: t.string({ description: "queued | running | done | failed | cancelled", resolve: (i) => i.status }),
    attempts: t.int({ resolve: (i) => i.attempts }),
    fixes: t.int({ description: "Validator refusals sent back to the AI.", resolve: (i) => i.fixes }),
    draftId: t.string({ nullable: true, resolve: (i) => i.draftId }),
    error: t.string({ nullable: true, resolve: (i) => i.error }),
    costUsd: t.float({ resolve: (i) => i.costUsd }),
  }),
});

const JobRef = builder.objectRef<JobView>("AiJob").implement({
  fields: (t) => ({
    id: t.string({ resolve: (j) => j.id }),
    projectId: t.string({ resolve: (j) => j.projectId }),
    title: t.string({ resolve: (j) => j.title }),
    kind: t.string({ resolve: (j) => j.kind }),
    template: t.string({ resolve: (j) => j.template }),
    model: t.string({ resolve: (j) => j.model }),
    thinking: t.string({ resolve: (j) => j.thinking }),
    runAt: t.string({ resolve: (j) => j.runAt }),
    status: t.string({ description: "queued | running | done | partial | failed | cancelled", resolve: (j) => j.status }),
    total: t.int({ resolve: (j) => j.total }),
    done: t.int({ resolve: (j) => j.done }),
    failed: t.int({ resolve: (j) => j.failed }),
    queued: t.int({ resolve: (j) => j.queued }),
    running: t.int({ resolve: (j) => j.running }),
    costUsd: t.float({ resolve: (j) => j.costUsd }),
    estimateNowUsd: t.float({ resolve: (j) => j.estimateNowUsd }),
    estimateOffpeakUsd: t.float({ resolve: (j) => j.estimateOffpeakUsd }),
    cacheHitRate: t.float({ nullable: true, resolve: (j) => j.cacheHitRate }),
    createdByName: t.string({ nullable: true, resolve: (j) => j.createdByName }),
    origin: t.string({ resolve: (j) => j.origin }),
    createdAt: t.string({ resolve: (j) => iso(j.createdAt)! }),
    finishedAt: t.string({ nullable: true, resolve: (j) => iso(j.finishedAt) }),
    items: t.field({ type: [ItemRef], description: "Empty in the list; whole on aiJob.", resolve: (j) => j.items }),
  }),
});
const JobPageRef = pageRef("AiJobPage", JobRef);

const EstimateRef = builder.objectRef<JobEstimate>("AiJobEstimate").implement({
  fields: (t) => ({
    items: t.int({ resolve: (e) => e.items }),
    inputTokens: t.int({ resolve: (e) => e.inputTokens }),
    outputTokens: t.int({ description: "An assumption per draft kind, for the estimate only.", resolve: (e) => e.outputTokens }),
    nowUsd: t.float({ description: "Starting now (full price at peak).", resolve: (e) => e.nowUsd }),
    offpeakUsd: t.float({ description: "Waiting for off-peak (half price).", resolve: (e) => e.offpeakUsd }),
    peakNow: t.boolean({ resolve: (e) => e.peakNow }),
    offpeakStartsAt: t.string({ resolve: (e) => e.offpeakStartsAt.toISOString() }),
  }),
});

const jobArgs = (t: Parameters<Parameters<typeof builder.mutationField>[1]>[0]) => ({
  projectId: t.arg.string({ required: true }),
  title: t.arg.string({ required: true }),
  kind: t.arg.string({ required: true }),
  template: t.arg.string({ required: true, description: "Prompt with {{item}} where each item goes." }),
  items: t.arg.stringList({ required: true }),
  model: t.arg.string({ required: true }),
  thinking: t.arg.string({ required: true }),
});

builder.queryField("aiJobEstimate", (t) =>
  t.field({
    type: EstimateRef,
    description: "Both prices before a job starts (PRD §6).",
    authScopes: WS_SCOPE,
    args: {
      projectId: t.arg.string({ required: true }),
      title: t.arg.string({ required: true }),
      kind: t.arg.string({ required: true }),
      template: t.arg.string({ required: true }),
      items: t.arg.stringList({ required: true }),
      model: t.arg.string({ required: true }),
      thinking: t.arg.string({ required: true }),
    },
    resolve: (_r, a, ctx) => estimateJob(ctx.auth, a.projectId, { title: a.title, kind: a.kind, template: a.template, items: a.items, model: a.model, thinking: a.thinking }),
  }),
);

builder.queryField("aiJobsPage", (t) =>
  t.field({
    type: JobPageRef,
    authScopes: WS_SCOPE,
    args: { projectId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => jobsPage(ctx.auth, a.projectId, { page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("aiJob", (t) => t.field({ type: JobRef, authScopes: WS_SCOPE, args: { id: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => job(ctx.auth, a.id) }));

builder.mutationField("createAiJob", (t) =>
  t.field({
    type: JobRef,
    description: "Editor: start a batch job. runAt (now | offpeak) is REQUIRED — no default (D-#1209).",
    authScopes: WS_SCOPE,
    args: { ...jobArgs(t), runAt: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) =>
      createJob(ctx.auth, a.projectId, { title: a.title, kind: a.kind, template: a.template, items: a.items, model: a.model, thinking: a.thinking, runAt: a.runAt }),
  }),
);

builder.mutationField("cancelAiJob", (t) =>
  t.field({ type: JobRef, description: "Editor: cancel every item not started yet.", authScopes: WS_SCOPE, args: { id: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => cancelJob(ctx.auth, a.id) }),
);
