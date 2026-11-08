/**
 * AI usage & comment quality (AI-7, D-#1140) — the Principal's report. `reports:ai_usage`.
 */
import { builder } from "../../../schema";
import { aiUsageReport, type AiUsageReport, type BudgetLine, type QualityRow, type UsageBucket } from "../services/AiAnalyticsService";

const BucketRef = builder.objectRef<UsageBucket>("AiUsageBucket").implement({
  fields: (t) => ({
    key: t.string({ resolve: (b) => b.key }),
    label: t.string({ resolve: (b) => b.label }),
    calls: t.int({ resolve: (b) => b.calls }),
    usd: t.float({ resolve: (b) => b.usd }),
    capped: t.int({ resolve: (b) => b.capped }),
    errors: t.int({ resolve: (b) => b.errors }),
  }),
});

const BudgetRef = builder.objectRef<BudgetLine>("AiBudgetLine").implement({
  fields: (t) => ({
    scope: t.string({ resolve: (b) => b.scope }),
    label: t.string({ resolve: (b) => b.label }),
    spentUsd: t.float({ resolve: (b) => b.spentUsd }),
    capUsd: t.float({ resolve: (b) => b.capUsd }),
    projectedUsd: t.float({ resolve: (b) => b.projectedUsd }),
    pct: t.int({ resolve: (b) => b.pct }),
  }),
});

const TypeCountRef = builder.objectRef<{ type: string; count: number }>("AiIssueTypeCount").implement({
  fields: (t) => ({ type: t.string({ resolve: (x) => x.type }), count: t.int({ resolve: (x) => x.count }) }),
});

const QualityRef = builder.objectRef<QualityRow>("AiCommentQualityRow").implement({
  fields: (t) => ({
    userId: t.string({ resolve: (r) => r.userId }),
    name: t.string({ resolve: (r) => r.name }),
    checks: t.int({ resolve: (r) => r.checks }),
    issuesFound: t.int({ resolve: (r) => r.issuesFound }),
    issuesAccepted: t.int({ resolve: (r) => r.issuesAccepted }),
    overrode: t.int({ resolve: (r) => r.overrode }),
    notChecked: t.int({ resolve: (r) => r.notChecked }),
    acceptanceRate: t.float({ nullable: true, resolve: (r) => r.acceptanceRate }),
    overrideRate: t.float({ nullable: true, resolve: (r) => r.overrideRate }),
    issueTypes: t.field({ type: [TypeCountRef], resolve: (r) => Object.entries(r.issueTypes).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count) }),
  }),
});

const TotalsRef = builder.objectRef<AiUsageReport["totals"]>("AiUsageTotals").implement({
  fields: (t) => ({
    usd: t.float({ resolve: (x) => x.usd }),
    calls: t.int({ resolve: (x) => x.calls }),
    capped: t.int({ resolve: (x) => x.capped }),
    errors: t.int({ resolve: (x) => x.errors }),
    fallbacks: t.int({ resolve: (x) => x.fallbacks }),
    cacheHitRate: t.float({ nullable: true, resolve: (x) => x.cacheHitRate }),
    avgCostPerCheckUsd: t.float({ nullable: true, resolve: (x) => x.avgCostPerCheckUsd }),
    avgCostPerTurnUsd: t.float({ nullable: true, resolve: (x) => x.avgCostPerTurnUsd }),
    notChecked: t.int({ resolve: (x) => x.notChecked }),
    checked: t.int({ resolve: (x) => x.checked }),
  }),
});

const ReportRef = builder.objectRef<AiUsageReport>("AiUsageReport").implement({
  fields: (t) => ({
    fromKey: t.string({ resolve: (r) => r.fromKey }),
    toKey: t.string({ resolve: (r) => r.toKey }),
    totals: t.field({ type: TotalsRef, resolve: (r) => r.totals }),
    byDay: t.field({ type: [BucketRef], resolve: (r) => r.byDay }),
    byPerson: t.field({ type: [BucketRef], resolve: (r) => r.byPerson }),
    byFeature: t.field({ type: [BucketRef], resolve: (r) => r.byFeature }),
    byModel: t.field({ type: [BucketRef], resolve: (r) => r.byModel }),
    budget: t.field({ type: [BudgetRef], description: "Always the current Dhaka month.", resolve: (r) => r.budget }),
    quality: t.field({ type: [QualityRef], resolve: (r) => r.quality }),
  }),
});

builder.queryField("aiUsageReport", (t) =>
  t.field({
    type: ReportRef,
    description: "AI spend, usage, the month's budget and comment-check quality for a Dhaka date range. reports:ai_usage.",
    authScopes: { hasPermission: "reports:ai_usage" },
    args: { fromKey: t.arg.string({ required: true }), toKey: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => aiUsageReport(ctx.auth, args.fromKey, args.toKey),
  }),
);
