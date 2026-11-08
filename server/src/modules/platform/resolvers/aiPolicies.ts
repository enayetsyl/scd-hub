/**
 * AI rules (AI-3, D-#1093) — versioned documents the AI features build their prompts from.
 * Teachers (and the Office) read the ACTIVE version (`ai_assist:read_rules`); the Principal
 * reads every version, writes the next one and switches one on (`ai_assist:edit_rules`).
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import {
  activateAiPolicyVersion,
  activeAiPolicyView,
  aiPolicySummaries,
  aiPolicyVersion,
  aiPolicyVersionsPage,
  deactivateAiPolicy,
  saveAiPolicyVersion,
  type AiPolicySummary,
  type AiPolicyVersionView,
} from "../services/AiPolicyService";

const AiPolicySummaryRef = builder.objectRef<AiPolicySummary>("AiPolicySummary").implement({
  fields: (t) => ({
    key: t.string({ description: "comment_standard | ct_comment_standard | assistant_rules", resolve: (v) => v.key }),
    labelBn: t.string({ resolve: (v) => v.labelBn }),
    labelEn: t.string({ resolve: (v) => v.labelEn }),
    activeVersion: t.int({ nullable: true, description: "Null = switched off (the feature does not run).", resolve: (v) => v.activeVersion }),
    latestVersion: t.int({ nullable: true, resolve: (v) => v.latestVersion }),
    versions: t.int({ resolve: (v) => v.versions }),
  }),
});

const AiPolicyVersionRef = builder.objectRef<AiPolicyVersionView>("AiPolicyVersion").implement({
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.id }),
    key: t.string({ resolve: (v) => v.key }),
    version: t.int({ resolve: (v) => v.version }),
    body: t.string({ description: "Markdown.", resolve: (v) => v.body }),
    hash: t.string({ description: "key@vN#sha12 — stamped on every AI result.", resolve: (v) => v.hash }),
    note: t.string({ nullable: true, resolve: (v) => v.note }),
    active: t.boolean({ resolve: (v) => v.active }),
    createdAt: t.string({ resolve: (v) => new Date(v.createdAt).toISOString() }),
    createdByName: t.string({ nullable: true, description: "Null for the seeded draft.", resolve: (v) => v.createdByName }),
    activatedAt: t.string({ nullable: true, resolve: (v) => (v.activatedAt ? new Date(v.activatedAt).toISOString() : null) }),
  }),
});

const AiPolicyVersionPageRef = pageRef("AiPolicyVersionPage", AiPolicyVersionRef);

builder.queryField("aiPolicySummaries", (t) =>
  t.field({
    type: [AiPolicySummaryRef],
    description: "Each AI rules document: active and latest version. ai_assist:read_rules or edit_rules.",
    authScopes: { hasAnyPermission: ["ai_assist:read_rules", "ai_assist:edit_rules"] },
    resolve: (_r, _a, ctx) => aiPolicySummaries(ctx.auth),
  }),
);

builder.queryField("activeAiPolicy", (t) =>
  t.field({
    type: AiPolicyVersionRef,
    nullable: true,
    description: "The active version of one AI rules document (the teachers' training sheet); null = off.",
    authScopes: { hasAnyPermission: ["ai_assist:read_rules", "ai_assist:edit_rules"] },
    args: { key: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => activeAiPolicyView(ctx.auth, args.key),
  }),
);

builder.queryField("aiPolicyVersionsPage", (t) =>
  t.field({
    type: AiPolicyVersionPageRef,
    description: "Every version of one AI rules document, newest first (D-#761 paging). ai_assist:edit_rules.",
    authScopes: { hasPermission: "ai_assist:edit_rules" },
    args: { key: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, args, ctx) => aiPolicyVersionsPage(ctx.auth, args.key, { page: args.page, pageSize: args.pageSize }),
  }),
);

builder.queryField("aiPolicyVersion", (t) =>
  t.field({
    type: AiPolicyVersionRef,
    description: "One version of an AI rules document. ai_assist:edit_rules.",
    authScopes: { hasPermission: "ai_assist:edit_rules" },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => aiPolicyVersion(ctx.auth, args.id),
  }),
);

builder.mutationField("saveAiPolicyVersion", (t) =>
  t.field({
    type: AiPolicyVersionRef,
    description: "Write the next version (saved OFF). Audited without the text. ai_assist:edit_rules.",
    authScopes: { hasPermission: "ai_assist:edit_rules" },
    args: { key: t.arg.string({ required: true }), body: t.arg.string({ required: true }), note: t.arg.string({ required: false }) },
    resolve: (_r, args, ctx) => saveAiPolicyVersion(ctx.auth, { key: args.key, body: args.body, note: args.note }),
  }),
);

builder.mutationField("activateAiPolicyVersion", (t) =>
  t.field({
    type: AiPolicyVersionRef,
    description: "Switch one version on; the other versions of its document go off. Audited. ai_assist:edit_rules.",
    authScopes: { hasPermission: "ai_assist:edit_rules" },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => activateAiPolicyVersion(ctx.auth, args.id),
  }),
);

builder.mutationField("deactivateAiPolicy", (t) =>
  t.field({
    type: AiPolicySummaryRef,
    description: "Switch a document off — the AI feature that reads it stops. Audited. ai_assist:edit_rules.",
    authScopes: { hasPermission: "ai_assist:edit_rules" },
    args: { key: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => deactivateAiPolicy(ctx.auth, args.key),
  }),
);
