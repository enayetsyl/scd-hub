/**
 * Notifications resolvers (N-1, D-#72) — the OWN-ROW inbox API. NO permission is
 * involved (none added, D-#72): any authenticated recipient reads/marks only rows
 * addressed to them; the recipient is derived from the auth context, never from
 * arguments. A GUARDIAN token maps to guardian rows; any staff token to its user
 * rows. Emission is server-internal — there is deliberately no emit mutation.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import type { INotification, NotificationRefs } from "../models/Notification";
import {
  myNotifications,
  myUnreadCount,
  markRead,
  markAllRead,
  type RecipientRef,
} from "../services/NotificationService";

function recipientOf(ctx: AppContext): RecipientRef {
  const auth = ctx.auth!;
  return auth.role === "GUARDIAN" ? { guardianId: auth.userId } : { userId: auth.userId };
}

const NotificationRefsRef = builder.objectRef<NotificationRefs>("NotificationRefs").implement({
  fields: (t) => ({
    classNoteId: t.string({ nullable: true, resolve: (r) => r.classNoteId ?? null }),
    slotId: t.string({ nullable: true, resolve: (r) => r.slotId ?? null }),
    date: t.string({ nullable: true, resolve: (r) => r.date ?? null }),
    groupType: t.string({ nullable: true, resolve: (r) => r.groupType ?? null }),
    groupId: t.string({ nullable: true, resolve: (r) => r.groupId ?? null }),
    hwItemId: t.string({ nullable: true, resolve: (r) => r.hwItemId ?? null }),
    studentId: t.string({ nullable: true, resolve: (r) => r.studentId ?? null }),
    sectionId: t.string({ nullable: true, resolve: (r) => r.sectionId ?? null }),
    reviewAssignmentId: t.string({ nullable: true, resolve: (r) => r.reviewAssignmentId ?? null }),
    artifactId: t.string({ nullable: true, resolve: (r) => r.artifactId ?? null }),
    substitutionId: t.string({ nullable: true, resolve: (r) => r.substitutionId ?? null }),
    loanId: t.string({ nullable: true, resolve: (r) => r.loanId ?? null }),
    rung: t.int({ nullable: true, resolve: (r) => r.rung ?? null }),
    audienceKey: t.string({ nullable: true, resolve: (r) => r.audienceKey ?? null }),
    periodNumber: t.int({ nullable: true, resolve: (r) => r.periodNumber ?? null }),
    tier: t.string({ nullable: true, resolve: (r) => r.tier ?? null }),
    hour: t.int({ nullable: true, resolve: (r) => r.hour ?? null }),
    // D-#301: observation deep-link — the CO-3 kinds carry it; the app opens
    // ObservationDetail directly instead of a list screen.
    observationId: t.string({ nullable: true, resolve: (r) => r.observationId ?? null }),
  }),
});

const NotificationRef = builder.objectRef<INotification>("Notification").implement({
  fields: (t) => ({
    id: t.string({ resolve: (n) => n._id.toString() }),
    kind: t.exposeString("kind"),
    titleBn: t.exposeString("titleBn"),
    bodyBn: t.exposeString("bodyBn"),
    refs: t.field({ type: NotificationRefsRef, resolve: (n) => n.refs ?? {} }),
    readAt: t.string({ nullable: true, resolve: (n) => (n.readAt ? new Date(n.readAt).toISOString() : null) }),
    createdAt: t.string({ resolve: (n) => new Date(n.createdAt).toISOString() }),
  }),
});

// --- Queries (own-row, N1.2) -------------------------------------------------

builder.queryField("myNotifications", (t) =>
  t.field({
    type: [NotificationRef],
    authScopes: { authenticated: true },
    args: {
      unreadOnly: t.arg.boolean({ required: false }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      myNotifications(recipientOf(ctx), {
        unreadOnly: args.unreadOnly ?? false,
        limit: args.limit ?? undefined,
      }),
  }),
);

builder.queryField("myUnreadNotificationCount", (t) =>
  t.field({
    type: "Int",
    authScopes: { authenticated: true },
    resolve: async (_r, _a, ctx) => myUnreadCount(recipientOf(ctx)),
  }),
);

// --- Mutations (own-row markRead, N1.7) --------------------------------------

builder.mutationField("markNotificationRead", (t) =>
  t.field({
    type: NotificationRef,
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => markRead(args.id, recipientOf(ctx)),
  }),
);

builder.mutationField("markAllNotificationsRead", (t) =>
  t.field({
    type: "Int",
    authScopes: { authenticated: true },
    resolve: async (_r, _a, ctx) => markAllRead(recipientOf(ctx)),
  }),
);
