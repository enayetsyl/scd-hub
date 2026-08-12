/**
 * Guardian-engagement report resolver (GE-1/GE-3, D-#464/#465).
 *
 * READ-ONLY. Gated on `audit:read` — Principal-only in the role map, and no new
 * permission is minted (the D-#414 system-health precedent, which avoids a two-place
 * contract sync for what is a reporting surface, not a new capability).
 *
 * The payload names families and children, so it is identity-plane by construction and
 * must never be reachable from `modules/corpus` (ADR-005). It is a read of existing
 * collections only — nothing here writes, and no export path is opened.
 */
import { builder } from "../../../schema";
import {
  guardianEngagement,
  type GuardianEngagementReport,
  type EngagementSummary,
  type EngagementGuardianRow,
  type SurfaceUsage,
  type InboxKindStat,
} from "../services/GuardianEngagementService";

const SummaryRef = builder.objectRef<EngagementSummary>("EngagementSummary");
SummaryRef.implement({
  description:
    "School-wide adoption over the DESIGNATED portal guardians (those holding an active " +
    "link to a current student, D-#474). Always computed over all of them even when the " +
    "row list is filtered — a section filter must not redefine the denominator.",
  fields: (t) => ({
    totalGuardians: t.int({ resolve: (s) => s.totalGuardians }),
    loginEnabled: t.int({ resolve: (s) => s.loginEnabled }),
    /** Designated guardians with no login issued — an onboarding gap, not a chase target. */
    contactOnly: t.int({ resolve: (s) => s.contactOnly }),
    /** Students with a designated guardian. */
    studentsTotal: t.int({ resolve: (s) => s.studentsTotal }),
    /** ...whose family has signed in at least once — the figure worth acting on. */
    studentsReachable: t.int({ resolve: (s) => s.studentsReachable }),
    studentsUnreachable: t.int({ resolve: (s) => s.studentsUnreachable }),
    /** ...with no credentials issued to anyone: a different fix from chasing. */
    studentsNoCredentials: t.int({ resolve: (s) => s.studentsNoCredentials }),
    /** Guardian records excluded as non-designated — reported so the filter is visible. */
    excludedNonDesignated: t.int({ resolve: (s) => s.excludedNonDesignated }),
    /** ...that could still log in and would land on an EMPTY portal (support trap). */
    excludedButLoginEnabled: t.int({ resolve: (s) => s.excludedButLoginEnabled }),
    everLoggedIn: t.int({ resolve: (s) => s.everLoggedIn }),
    neverLoggedIn: t.int({ resolve: (s) => s.neverLoggedIn }),
    active7: t.int({ resolve: (s) => s.active7 }),
    active30: t.int({ resolve: (s) => s.active30 }),
    active90: t.int({ resolve: (s) => s.active90 }),
    regular: t.int({ resolve: (s) => s.regular }),
    occasional: t.int({ resolve: (s) => s.occasional }),
    lapsed: t.int({ resolve: (s) => s.lapsed }),
    notificationsDelivered: t.int({ resolve: (s) => s.notificationsDelivered }),
    notificationsRead: t.int({ resolve: (s) => s.notificationsRead }),
    viewsRecorded: t.int({ resolve: (s) => s.viewsRecorded }),
    /** Null = view tracking has recorded nothing yet; the screen must say so rather
     *  than let a pre-launch zero read as disengagement. */
    viewsSince: t.string({ nullable: true, resolve: (s) => s.viewsSince }),
    windowDays: t.int({ resolve: (s) => s.windowDays }),
  }),
});

const GuardianRowRef = builder.objectRef<EngagementGuardianRow>("EngagementGuardianRow");
GuardianRowRef.implement({
  description:
    "One DESIGNATED portal guardian — the parent the school actually issued the app to " +
    "(D-#474); the other parent's deactivated link keeps them out of this list. Sorted " +
    "most-actionable first (NO_LOGIN → NEVER → LAPSED → OCCASIONAL → REGULAR) so the " +
    "chase list is the top of the screen, not the bottom.",
  fields: (t) => ({
    guardianId: t.exposeString("guardianId"),
    name: t.exposeString("name"),
    phone: t.string({ nullable: true, resolve: (r) => r.phone }),
    loginEnabled: t.boolean({ resolve: (r) => r.loginEnabled }),
    childNames: t.stringList({ resolve: (r) => r.childNames }),
    sectionNames: t.stringList({ resolve: (r) => r.sectionNames }),
    band: t.exposeString("band"),
    /** Lifetime, NOT window-bounded — else a long-lapsed family would read as NEVER. */
    lastLoginAt: t.string({ nullable: true, resolve: (r) => r.lastLoginAt }),
    loginCount: t.int({ resolve: (r) => r.loginCount }),
    activeDays: t.int({ resolve: (r) => r.activeDays }),
    notificationsDelivered: t.int({ resolve: (r) => r.notificationsDelivered }),
    notificationsRead: t.int({ resolve: (r) => r.notificationsRead }),
    viewCount: t.int({ resolve: (r) => r.viewCount }),
    lastViewAt: t.string({ nullable: true, resolve: (r) => r.lastViewAt }),
    topSurfaces: t.stringList({ resolve: (r) => r.topSurfaces }),
  }),
});

const SurfaceUsageRef = builder.objectRef<SurfaceUsage>("SurfaceUsage");
SurfaceUsageRef.implement({
  description:
    "Which portal screens families actually open. Every declared surface is returned, " +
    "including zeros — a screen nobody opens is the finding, and dropping it would hide it.",
  fields: (t) => ({
    surface: t.exposeString("surface"),
    views: t.int({ resolve: (s) => s.views }),
    distinctGuardians: t.int({ resolve: (s) => s.distinctGuardians }),
    lastAt: t.string({ nullable: true, resolve: (s) => s.lastAt }),
  }),
});

const InboxKindStatRef = builder.objectRef<InboxKindStat>("InboxKindStat");
InboxKindStatRef.implement({
  description:
    "Delivered-vs-opened per notification kind — the closest thing to 'which items were " +
    "never seen'. Caveat: a bulk mark-all-read stamps rows the family never opened, so " +
    "`read` is an upper bound.",
  fields: (t) => ({
    kind: t.exposeString("kind"),
    delivered: t.int({ resolve: (s) => s.delivered }),
    read: t.int({ resolve: (s) => s.read }),
  }),
});

const ReportRef = builder.objectRef<GuardianEngagementReport>("GuardianEngagementReport");
ReportRef.implement({
  fields: (t) => ({
    summary: t.field({ type: SummaryRef, resolve: (r) => r.summary }),
    guardians: t.field({ type: [GuardianRowRef], resolve: (r) => r.guardians }),
    surfaces: t.field({ type: [SurfaceUsageRef], resolve: (r) => r.surfaces }),
    inboxByKind: t.field({ type: [InboxKindStatRef], resolve: (r) => r.inboxByKind }),
    generatedAt: t.exposeString("generatedAt"),
  }),
});

builder.queryField("guardianEngagement", (t) =>
  t.field({
    type: ReportRef,
    description:
      "How regularly families use the portal and what they open (GE-1/GE-3). Three " +
      "independent signals — logins (from the audit log), views (GE-2), inbox " +
      "delivered/read — kept separate so a broken one is visible instead of averaged " +
      "away. Requires audit:read (Principal).",
    authScopes: { hasPermission: "audit:read" },
    args: {
      days: t.arg.int({ required: false }),
      sectionId: t.arg.string({ required: false }),
      band: t.arg.string({ required: false }),
    },
    resolve: async (_root, args) =>
      guardianEngagement({ days: args.days, sectionId: args.sectionId, band: args.band }),
  }),
);
