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
  markManyRead,
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
    // WC-6: the claim kinds were stored with these refs but never exposed, so the
    // app could not deep-link them and every claim notification was a dead-end tap.
    workClaimId: t.string({ nullable: true, resolve: (r) => r.workClaimId ?? null }),
    workClaimTracker: t.string({ nullable: true, resolve: (r) => r.workClaimTracker ?? null }),
    // Same shape of bug as WC-6: the CT-8 submit notice stored both of these but
    // neither was exposed, so the app had no exam id to deep-link with.
    classTestId: t.string({ nullable: true, resolve: (r) => r.classTestId ?? null }),
    ctId: t.string({ nullable: true, resolve: (r) => r.ctId ?? null }),
    // D-#644: the syllabus deep-link triple. Exposed WITH the kinds that carry it —
    // storing a ref the app cannot read is the WC-6 dead-end tap all over again.
    syllabusId: t.string({ nullable: true, resolve: (r) => r.syllabusId ?? null }),
    examId: t.string({ nullable: true, resolve: (r) => r.examId ?? null }),
    classId: t.string({ nullable: true, resolve: (r) => r.classId ?? null }),
    subject: t.string({ nullable: true, resolve: (r) => r.subject ?? null }),
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

builder.mutationField("markNotificationsRead", (t) =>
  t.field({
    type: "Int",
    authScopes: { authenticated: true },
    description:
      "Mark a picked set of the caller's own unread notifications read (D-#307 inbox " +
      "multi-select); returns how many flipped. Foreign/read ids just don't match.",
    args: { ids: t.arg.stringList({ required: true }) },
    resolve: async (_r, args, ctx) => markManyRead(args.ids, recipientOf(ctx)),
  }),
);

builder.mutationField("markAllNotificationsRead", (t) =>
  t.field({
    type: "Int",
    authScopes: { authenticated: true },
    resolve: async (_r, _a, ctx) => markAllRead(recipientOf(ctx)),
  }),
);
