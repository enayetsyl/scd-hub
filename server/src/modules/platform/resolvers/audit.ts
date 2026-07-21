/**
 * Audit-log resolver (owner ask 2026-07-20) — the in-app viewer read over the
 * append-only audit log (ADR-008). READ-ONLY by construction: no mutation is
 * exposed here, ever — rows are written only by the server-internal writeAudit.
 * Gated on `audit:read` (Principal only, verifier-proven).
 */
import { builder } from "../../../schema";
import {
  auditLog,
  type AuditRowShape,
} from "../services/AuditQueryService";

const AuditRowRef = builder.objectRef<AuditRowShape>("AuditRow");
AuditRowRef.implement({
  description:
    "One append-only audit event (ADR-008): who did what, when, to which record. meta is the " +
    "event's detail payload serialized as JSON.",
  fields: (t) => ({
    id: t.exposeString("id"),
    eventKind: t.exposeString("eventKind"),
    eventAt: t.exposeString("eventAt"),
    actorId: t.string({ nullable: true, resolve: (r) => r.actorId }),
    actorName: t.string({ nullable: true, resolve: (r) => r.actorName }),
    actorRole: t.string({ nullable: true, resolve: (r) => r.actorRole }),
    targetKind: t.string({ nullable: true, resolve: (r) => r.targetKind }),
    targetId: t.string({ nullable: true, resolve: (r) => r.targetId }),
    metaJson: t.string({ nullable: true, resolve: (r) => r.metaJson }),
  }),
});

builder.queryField("auditLog", (t) =>
  t.field({
    type: [AuditRowRef],
    description:
      "Newest-first page of the audit log; `before` (ISO instant) pages older rows; optional " +
      "eventKind/actorRole filters. Requires audit:read (Principal).",
    authScopes: { hasPermission: "audit:read" },
    args: {
      before: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
      eventKind: t.arg.string({ required: false }),
      actorRole: t.arg.string({ required: false }),
    },
    resolve: async (_root, args) =>
      auditLog({
        before: args.before,
        limit: args.limit,
        eventKind: args.eventKind,
        actorRole: args.actorRole,
      }),
  }),
);
