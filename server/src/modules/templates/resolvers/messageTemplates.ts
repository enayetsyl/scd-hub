/**
 * Message-template resolvers (MT-1/MT-3; prd-message-templates §4/§5, D-#129).
 *
 * RBAC: EVERY field here gates `template:manage` — PRINCIPAL only (the verifier-proven
 * exact-holder set, D-#129). The whole surface (list/read/history/edit/reset) is the
 * Principal's admin screen; Office/Teacher/Guardian never reach it.
 *
 * Identity/operational plane; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import {
  listMessageTemplates,
  messageTemplateHistory,
  editMessageTemplate,
  resetMessageTemplate,
  isMessageTemplateKey,
  MessageTemplateError,
  type TemplateListEntry,
  type TemplateHistoryEntry,
} from "../services/MessageTemplateService";

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

const MessageTemplateRef = builder.objectRef<TemplateListEntry>("MessageTemplate");
MessageTemplateRef.implement({
  description:
    "A generated-message template (MT-1): its effective body (admin override else code default) plus the code default for comparison.",
  fields: (t) => ({
    key: t.string({ resolve: (e) => e.key }),
    group: t.exposeString("group"),
    labelBn: t.exposeString("labelBn"),
    placeholders: t.stringList({ resolve: (e) => [...e.placeholders] }),
    /** Effective (override-or-default). */
    bnBody: t.string({ resolve: (e) => e.bnBody }),
    enBody: t.string({ nullable: true, resolve: (e) => e.enBody ?? null }),
    langMode: t.string({ resolve: (e) => e.langMode }),
    isDefault: t.boolean({ resolve: (e) => e.isDefault }),
    /** The code default (for the MT-3 preview + reset comparison). */
    defaultBnBody: t.string({ resolve: (e) => e.def.bnDefault }),
    defaultEnBody: t.string({ nullable: true, resolve: (e) => e.def.enDefault ?? null }),
    defaultLangMode: t.string({ resolve: (e) => e.def.defaultLangMode }),
    updatedAt: t.string({ nullable: true, resolve: (e) => (e.updatedAt ? new Date(e.updatedAt).toISOString() : null) }),
    updatedBy: t.string({ nullable: true, resolve: (e) => e.updatedBy ?? null }),
  }),
});

const MessageTemplateHistoryRef = builder.objectRef<TemplateHistoryEntry>("MessageTemplateHistoryEntry");
MessageTemplateHistoryRef.implement({
  description: "One append-only edit/reset of a message template (the prior body retained, ADR-008).",
  fields: (t) => ({
    at: t.string({ resolve: (e) => new Date(e.at).toISOString() }),
    actorId: t.string({ nullable: true, resolve: (e) => e.actorId ?? null }),
    action: t.exposeString("action"),
    priorBnBody: t.string({ nullable: true, resolve: (e) => e.priorBnBody ?? null }),
    priorEnBody: t.string({ nullable: true, resolve: (e) => e.priorEnBody ?? null }),
    priorLangMode: t.string({ nullable: true, resolve: (e) => e.priorLangMode ?? null }),
    wasDefault: t.boolean({ resolve: (e) => e.wasDefault }),
  }),
});

const ResetResultRef = builder.objectRef<{ key: string; reset: boolean }>("MessageTemplateResetResult");
ResetResultRef.implement({
  description: "Outcome of a reset-to-default (J3): reset=false ⇒ there was no override (already default).",
  fields: (t) => ({
    key: t.exposeString("key"),
    reset: t.exposeBoolean("reset"),
  }),
});

// ---------------------------------------------------------------------------
// Queries (template:manage — Principal only)
// ---------------------------------------------------------------------------

builder.queryField("messageTemplates", (t) =>
  t.field({
    type: [MessageTemplateRef],
    description: "Every generated-message template with its effective + default bodies (MT-3 list). Requires template:manage.",
    authScopes: { hasPermission: "template:manage" },
    resolve: async () => listMessageTemplates(),
  }),
);

builder.queryField("messageTemplate", (t) =>
  t.field({
    type: MessageTemplateRef,
    nullable: true,
    description: "One template by key. Requires template:manage.",
    authScopes: { hasPermission: "template:manage" },
    args: { key: t.arg.string({ required: true }) },
    resolve: async (_root, args) => {
      if (!isMessageTemplateKey(args.key)) return null;
      const all = await listMessageTemplates();
      return all.find((e) => e.key === args.key) ?? null;
    },
  }),
);

builder.queryField("messageTemplateHistory", (t) =>
  t.field({
    type: [MessageTemplateHistoryRef],
    description: "The append-only edit/reset history for a template key. Requires template:manage.",
    authScopes: { hasPermission: "template:manage" },
    args: {
      key: t.arg.string({ required: true }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args) => {
      if (!isMessageTemplateKey(args.key)) return [];
      return messageTemplateHistory(args.key, args.limit ?? 50);
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations (template:manage — Principal only)
// ---------------------------------------------------------------------------

builder.mutationField("editMessageTemplate", (t) =>
  t.field({
    type: MessageTemplateRef,
    description:
      "Save an admin override for a template (MT-1, J1). Edit-time placeholder validation + empty-EN guard; prior body audited. Requires template:manage.",
    authScopes: { hasPermission: "template:manage" },
    args: {
      key: t.arg.string({ required: true }),
      bnBody: t.arg.string({ required: true }),
      enBody: t.arg.string({ required: false }),
      langMode: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await editMessageTemplate({
        key: args.key,
        bnBody: args.bnBody,
        enBody: args.enBody ?? null,
        langMode: args.langMode,
        actorId: ctx.auth!.userId,
      });
      const all = await listMessageTemplates();
      return all.find((e) => e.key === args.key)!;
    },
  }),
);

builder.mutationField("resetMessageTemplate", (t) =>
  t.field({
    type: ResetResultRef,
    description: "Delete the admin override → the code default returns instantly (J3). Audited. Requires template:manage.",
    authScopes: { hasPermission: "template:manage" },
    args: { key: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => resetMessageTemplate(args.key, ctx.auth!.userId),
  }),
);

// Re-export so a thrown validation error keeps its type at the module boundary.
export { MessageTemplateError };
