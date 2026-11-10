/**
 * The AI request & reply log (D-#1179) — the Principal's view of every comment check and
 * assistant question as sent to the AI (names hidden) and the reply. Reading / exporting is
 * `ai_assist:read_ai_log`, deleting `ai_assist:delete_ai_log`; both LOCKED. Paged (D-#761).
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import {
  aiExchangeDetail,
  aiExchangesExport,
  aiExchangesPage,
  deleteAiExchange,
  deleteAiExchanges,
  type AiExchangeDetail,
  type AiExchangeExportRow,
  type AiExchangeRow,
} from "../services/AiExchangeService";
import type { IAiExchangeAttempt } from "../models/AiExchange";

const iso = (d: Date) => new Date(d).toISOString();

const AttemptRef = builder.objectRef<IAiExchangeAttempt>("AiExchangeAttempt").implement({
  fields: (t) => ({
    provider: t.string({ resolve: (a) => a.provider }),
    modelName: t.string({ resolve: (a) => a.modelName }),
    outcome: t.string({ resolve: (a) => a.outcome }),
    errorKind: t.string({ nullable: true, resolve: (a) => a.errorKind ?? null }),
    fallback: t.boolean({ resolve: (a) => a.fallback }),
    latencyMs: t.int({ resolve: (a) => Math.round(a.latencyMs) }),
    costUsd: t.float({ resolve: (a) => a.costUsd }),
  }),
});

const TurnRef = builder.objectRef<{ role: string; text: string }>("AiExchangeTurn").implement({
  fields: (t) => ({ role: t.string({ resolve: (x) => x.role }), text: t.string({ resolve: (x) => x.text }) }),
});

const TypeCountRef = builder.objectRef<{ type: string; count: number }>("AiExchangeIssueType").implement({
  fields: (t) => ({ type: t.string({ resolve: (x) => x.type }), count: t.int({ resolve: (x) => x.count }) }),
});

const RowRef = builder.objectRef<AiExchangeRow>("AiExchangeRow").implement({
  fields: (t) => ({
    id: t.string({ resolve: (r) => r.id }),
    at: t.string({ resolve: (r) => iso(r.at) }),
    feature: t.string({ resolve: (r) => r.feature }),
    userId: t.string({ nullable: true, resolve: (r) => r.userId }),
    userName: t.string({ nullable: true, resolve: (r) => r.userName }),
    role: t.string({ nullable: true, resolve: (r) => r.role }),
    modelName: t.string({ nullable: true, resolve: (r) => r.modelName }),
    ok: t.boolean({ resolve: (r) => r.ok }),
    errorKind: t.string({ nullable: true, resolve: (r) => r.errorKind }),
    latencyMs: t.int({ resolve: (r) => Math.round(r.latencyMs) }),
    costUsd: t.float({ resolve: (r) => r.costUsd }),
    fellBack: t.boolean({ resolve: (r) => r.fellBack }),
    policyHash: t.string({ nullable: true, resolve: (r) => r.policyHash }),
    issuesShown: t.int({ nullable: true, resolve: (r) => r.issuesShown }),
    issuesAccepted: t.int({ nullable: true, resolve: (r) => r.issuesAccepted }),
    teacherOverrode: t.boolean({ nullable: true, resolve: (r) => r.teacherOverrode }),
    saved: t.boolean({ resolve: (r) => r.saved }),
    preview: t.string({ resolve: (r) => r.preview }),
  }),
});

const PageRef = pageRef("AiExchangePage", RowRef);

const DetailRef = builder.objectRef<AiExchangeDetail>("AiExchangeDetail").implement({
  fields: (t) => ({
    row: t.field({ type: RowRef, resolve: (d) => d }),
    refType: t.string({ nullable: true, resolve: (d) => d.refType }),
    refId: t.string({ nullable: true, resolve: (d) => d.refId }),
    attempts: t.field({ type: [AttemptRef], resolve: (d) => d.attempts }),
    prefix: t.string({ description: "The fixed instructions + the standard / rules exactly as sent.", resolve: (d) => d.prefix }),
    context: t.string({ nullable: true, description: "The chapter plan as sent (assistant).", resolve: (d) => d.context }),
    history: t.field({ type: [TurnRef], resolve: (d) => d.history }),
    request: t.string({ resolve: (d) => d.request }),
    reply: t.string({ resolve: (d) => d.reply }),
    issueTypes: t.field({ type: [TypeCountRef], resolve: (d) => Object.entries(d.issueTypes ?? {}).map(([type, count]) => ({ type, count: Number(count) || 0 })) }),
  }),
});

const ExportRowRef = builder.objectRef<AiExchangeExportRow>("AiExchangeExportRow").implement({
  fields: (t) => ({
    row: t.field({ type: RowRef, resolve: (r) => r }),
    request: t.string({ resolve: (r) => r.request }),
    reply: t.string({ resolve: (r) => r.reply }),
  }),
});

builder.queryField("aiExchangesPage", (t) =>
  t.field({
    type: PageRef,
    description: "The AI request & reply log, newest first; optional feature and Dhaka month (YYYY-MM). ai_assist:read_ai_log (LOCKED).",
    authScopes: { hasPermission: "ai_assist:read_ai_log" },
    args: {
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
      feature: t.arg.string({ required: false }),
      month: t.arg.string({ required: false }),
    },
    resolve: (_r, args, ctx) => aiExchangesPage(ctx.auth, { page: args.page, pageSize: args.pageSize, feature: args.feature, month: args.month }),
  }),
);

builder.queryField("aiExchange", (t) =>
  t.field({
    type: DetailRef,
    description: "One logged AI exchange in full. ai_assist:read_ai_log (LOCKED).",
    authScopes: { hasPermission: "ai_assist:read_ai_log" },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => aiExchangeDetail(ctx.auth, args.id),
  }),
);

builder.queryField("aiExchangesExport", (t) =>
  t.field({
    type: [ExportRowRef],
    description: "The filtered log with full request and reply text (at most 5,000 rows). ai_assist:read_ai_log (LOCKED).",
    authScopes: { hasPermission: "ai_assist:read_ai_log" },
    args: { feature: t.arg.string({ required: false }), month: t.arg.string({ required: false }) },
    resolve: (_r, args, ctx) => aiExchangesExport(ctx.auth, { feature: args.feature, month: args.month }),
  }),
);

builder.mutationField("deleteAiExchange", (t) =>
  t.field({
    type: "Boolean",
    description: "Delete one AI log entry (audited). ai_assist:delete_ai_log (LOCKED).",
    authScopes: { hasPermission: "ai_assist:delete_ai_log" },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => deleteAiExchange(ctx.auth, args.id),
  }),
);

builder.mutationField("deleteAiExchanges", (t) =>
  t.field({
    type: "Int",
    description: "Delete every AI log entry of a Dhaka month and / or feature (one is required; audited). Returns the count. ai_assist:delete_ai_log (LOCKED).",
    authScopes: { hasPermission: "ai_assist:delete_ai_log" },
    args: { feature: t.arg.string({ required: false }), month: t.arg.string({ required: false }) },
    resolve: (_r, args, ctx) => deleteAiExchanges(ctx.auth, { feature: args.feature, month: args.month }),
  }),
);
