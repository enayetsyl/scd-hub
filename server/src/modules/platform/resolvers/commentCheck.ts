/**
 * AI comment checker (AI-5, D-#1095) — suggestions only; nothing here saves or delivers.
 * `ai_assist:check_comment` (teachers + Office).
 */
import { builder } from "../../../schema";
import { checkComment, commentCheckAvailability, type CheckIssue, type CheckResult } from "../services/CommentCheckService";

const IssueRef = builder.objectRef<CheckIssue>("CommentCheckIssue").implement({
  fields: (t) => ({
    field: t.string({ description: "text | weakness | guardianAction | teacherAction", resolve: (i) => i.field }),
    type: t.string({ description: "punctuation | tone | honorific | structure | standard | marks | spelling", resolve: (i) => i.type }),
    quote: t.string({ resolve: (i) => i.quote }),
    suggestion: t.string({ resolve: (i) => i.suggestion }),
    pick: t.string({ nullable: true, description: "A tone note only: the tone the text fits better (CONCERN | POSITIVE).", resolve: (i) => i.pick ?? null }),
  }),
});

const FieldTextRef = builder.objectRef<{ field: string; text: string }>("CommentCheckField").implement({
  fields: (t) => ({
    field: t.string({ resolve: (f) => f.field }),
    text: t.string({ resolve: (f) => f.text }),
  }),
});

const ResultRef = builder.objectRef<CheckResult>("CommentCheckResult").implement({
  fields: (t) => ({
    status: t.string({ description: "CHECKED | NOT_CHECKED", resolve: (r) => r.status }),
    reason: t.string({ nullable: true, resolve: (r) => r.reason }),
    message: t.string({ nullable: true, description: "Bangla, when NOT_CHECKED.", resolve: (r) => r.message }),
    policyHash: t.string({ nullable: true, resolve: (r) => r.policyHash }),
    model: t.string({ nullable: true, resolve: (r) => r.model }),
    issues: t.field({ type: [IssueRef], resolve: (r) => r.issues }),
    corrected: t.field({ type: [FieldTextRef], resolve: (r) => r.corrected }),
    token: t.string({ nullable: true, description: "Pass back as aiCheckToken on save.", resolve: (r) => r.token }),
  }),
});

const AvailabilityRef = builder.objectRef<{ daily: boolean; ct: boolean }>("CommentCheckAvailability").implement({
  fields: (t) => ({
    daily: t.boolean({ resolve: (a) => a.daily }),
    ct: t.boolean({ resolve: (a) => a.ct }),
  }),
});

const FieldInput = builder.inputType("CommentCheckFieldInput", {
  fields: (t) => ({ field: t.string({ required: true }), text: t.string({ required: true }) }),
});

builder.queryField("commentCheckAvailability", (t) =>
  t.field({
    type: AvailabilityRef,
    description: "Whether the AI checker can run for daily / class-test comments (feature on + standard on). ai_assist:check_comment.",
    authScopes: { hasPermission: "ai_assist:check_comment" },
    resolve: (_r, _a, ctx) => commentCheckAvailability(ctx.auth),
  }),
);

builder.mutationField("checkComment", (t) =>
  t.field({
    type: ResultRef,
    description: "Check a comment against the active standard (de-identified, metered, capped). Saves nothing. ai_assist:check_comment.",
    authScopes: { hasPermission: "ai_assist:check_comment" },
    args: {
      kind: t.arg.string({ required: true, description: "DAILY | CT" }),
      studentId: t.arg.string({ required: true }),
      fields: t.arg({ type: [FieldInput], required: true }),
      markPct: t.arg.float({ required: false }),
      commentType: t.arg.string({ required: false }),
      sentiment: t.arg.string({ required: false }),
    },
    resolve: (_r, args, ctx) =>
      checkComment(ctx.auth, {
        kind: args.kind === "CT" ? "CT" : "DAILY",
        studentId: args.studentId,
        fields: args.fields.map((f) => ({ field: f.field, text: f.text })),
        markPct: args.markPct,
        commentType: args.commentType,
        sentiment: args.sentiment,
      }),
  }),
);
