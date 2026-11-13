/**
 * CSP-5 measures (docs/prd-child-support-profile.md §7.8, §11): the approval-load card (approve), the
 * owner's choice at its review (manage), one child's own series and the school totals (view_all).
 * No field returns a list of children or teachers ordered by a behaviour figure (§16.8 M-2).
 */
import { builder } from "../../../schema";
import { approvalLoad, childIndicators, recordApprovalLoadChoice, schoolTotals } from "../services/supportLifecycle";

builder.queryField("supportApprovalLoadJson", (t) =>
  t.string({
    description: "অনুমোদনের চাপ (§7.8): week-end queue sizes, the largest, medians, the waiting backlog — school totals only.",
    authScopes: { hasPermission: "support_profile:approve" },
    resolve: async (_r, _a, ctx) => JSON.stringify(await approvalLoad(ctx)),
  }),
);
builder.mutationField("recordSupportApprovalLoadChoice", (t) =>
  t.string({
    description: "The owner's choice at the approval-load review (keep · widen quick approve · class teacher first · fewer prompts); returns the next review date.",
    authScopes: { hasPermission: "support_profile:manage" },
    args: { choice: t.arg.string({ required: true }), nextInDays: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => recordApprovalLoadChoice(ctx, a.choice, a.nextInDays ?? 90),
  }),
);
builder.queryField("supportChildIndicatorsJson", (t) =>
  t.string({
    description: "One child against their own earlier months only (§11).",
    authScopes: { hasPermission: "support_profile:view_all" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => JSON.stringify(await childIndicators(ctx, a.studentId)),
  }),
);
builder.queryField("supportSchoolTotalsJson", (t) =>
  t.string({
    description: "School totals — no child and no teacher named (§11).",
    authScopes: { hasPermission: "support_profile:view_all" },
    resolve: async (_r, _a, ctx) => JSON.stringify(await schoolTotals(ctx)),
  }),
);
