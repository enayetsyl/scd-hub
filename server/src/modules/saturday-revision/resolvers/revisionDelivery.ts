/**
 * Saturday-Revision delivery + escalation resolvers (SR-2, prd-sr2 §3/§5/§6, D-#244/#245).
 *
 * RBAC — the `saturday_revision:*` catalogue actions (PM, D-#790–#801):
 *   - Deliver (`deliverRevisionEntry` / `deliverGroupRevisionSaturday`):
 *     `saturday_revision:send` + the Quran-group scope, OR `saturday_revision:edit_all`
 *     (Principal/Office by default). The guardian is a recipient only — no SR resolver
 *     is guardian-writable.
 *   - The escalation threshold config (`revisionEscalationConfig` / `setRevisionEscalation
 *     Config`): `saturday_revision:settings` (Principal/Office by default).
 *
 * Identity plane (names studentIds); no corpus path.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import { RevisionEntry } from "../models/RevisionEntry";
import { teacherTeachesGroup } from "../services/RevisionService";
import {
  deliverEntry,
  deliverGroupSaturday,
  getEscalationConfig,
  setEscalationConfig,
  type RevisionDeliveryOutcome,
  type RevisionEscalationConfigShape,
} from "../services/RevisionDeliveryService";

/** Deliver scope: edit_all (any group); else send + the teacher leads the group. */
async function assertCanDeliver(ctx: AppContext, groupId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (callerHasPermission(ctx.auth, "saturday_revision:edit_all")) return;
  if (ctx.auth.role === "GUARDIAN" || !callerHasPermission(ctx.auth, "saturday_revision:send")) {
    throw new ForbiddenError("You cannot deliver this group's revision");
  }
  if (!(await teacherTeachesGroup(ctx.auth.userId as string, groupId))) {
    throw new ForbiddenError("You do not lead this Qur'an group");
  }
}

/** Config needs `saturday_revision:settings` (Principal/Office by default). */
function assertConfigAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "saturday_revision:settings")) throw new ForbiddenError("Only Principal/Office may read or set the escalation threshold");
}

async function groupOfEntry(entryId: string): Promise<string> {
  const entry = (await RevisionEntry.findById(entryId).select("groupId").lean()) as { groupId?: { toString(): string } } | null;
  if (!entry?.groupId) throw new ForbiddenError("Entry not found");
  return entry.groupId.toString();
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

const RevisionDeliveryOutcomeRef = builder.objectRef<RevisionDeliveryOutcome>("RevisionDeliveryOutcome");
RevisionDeliveryOutcomeRef.implement({
  description:
    "The result of delivering one revision entry (SR-2): the rendered message, the wa.me link, " +
    "the notified login-enabled guardians, and the escalated streak (if any).",
  fields: (t) => ({
    entryId: t.exposeString("entryId"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    present: t.exposeBoolean("present"),
    kind: t.exposeString("kind"),
    messageBn: t.exposeString("messageBn"),
    waLink: t.string({ nullable: true, resolve: (r) => r.waLink }),
    unreachableByWa: t.exposeBoolean("unreachableByWa"),
    notifiedGuardianIds: t.exposeStringList("notifiedGuardianIds"),
    deliveryChannels: t.exposeStringList("deliveryChannels"),
    deliveredAt: t.exposeString("deliveredAt"),
    escalatedStreak: t.int({ nullable: true, resolve: (r) => r.escalatedStreak }),
  }),
});

const RevisionEscalationConfigRef = builder.objectRef<RevisionEscalationConfigShape>("RevisionEscalationConfig");
RevisionEscalationConfigRef.implement({
  description: "The consecutive-absence escalation threshold (SR-2; read-time default 2 when unset — D-#245/#97).",
  fields: (t) => ({
    consecutiveAbsenceThreshold: t.exposeInt("consecutiveAbsenceThreshold"),
    isDefault: t.exposeBoolean("isDefault"),
  }),
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("deliverRevisionEntry", (t) =>
  t.field({
    type: RevisionDeliveryOutcomeRef,
    description:
      "Deliver one revision entry to the family (J-SR2-1/2/3): absent alert or weekly digest on the rails; " +
      "seals the entry; runs the consecutive-absence escalation on an absent entry. " +
      "Requires being the group's teacher (saturday_revision:send) or saturday_revision:edit_all. Audited.",
    authScopes: { hasAnyPermission: ["saturday_revision:send", "saturday_revision:edit_all"] },
    args: { entryId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const groupId = await groupOfEntry(args.entryId);
      await assertCanDeliver(ctx, groupId);
      return deliverEntry(args.entryId, ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("deliverGroupRevisionSaturday", (t) =>
  t.field({
    type: [RevisionDeliveryOutcomeRef],
    description:
      "Batch-deliver every entry for a (group × Saturday). Requires being the group's teacher " +
      "(saturday_revision:send) or saturday_revision:edit_all. Audited per entry.",
    authScopes: { hasAnyPermission: ["saturday_revision:send", "saturday_revision:edit_all"] },
    args: {
      groupId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertCanDeliver(ctx, args.groupId);
      return deliverGroupSaturday(args.groupId, new Date(args.date), ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("setRevisionEscalationConfig", (t) =>
  t.field({
    type: RevisionEscalationConfigRef,
    description:
      "Set the consecutive-absence escalation threshold (SR-2, D-#245). Principal/Office only. Audited.",
    authScopes: { hasPermission: "saturday_revision:settings" },
    args: { consecutiveAbsenceThreshold: t.arg.int({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertConfigAdmin(ctx);
      return setEscalationConfig(args.consecutiveAbsenceThreshold, ctx.auth!.userId as string);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

builder.queryField("revisionEscalationConfig", (t) =>
  t.field({
    type: RevisionEscalationConfigRef,
    description: "The consecutive-absence escalation threshold (SR-2). Principal/Office only.",
    authScopes: { hasPermission: "saturday_revision:settings" },
    resolve: async (_root, _args, ctx) => {
      assertConfigAdmin(ctx);
      return getEscalationConfig();
    },
  }),
);
