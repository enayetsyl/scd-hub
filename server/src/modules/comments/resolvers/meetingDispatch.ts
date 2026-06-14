/**
 * Parents'-Meeting dispatch + attendance resolvers (CM-4, prd-comments-meetings
 * §4.1/§6, J-CM4/J-CM5, D-#176). The Office/Principal dispatch the timing notices,
 * capture present/absent per family slot, and read the derived aggregates.
 *
 * RBAC — composes the EXISTING `roster:manage` admin gate (D-#17/#94, no new
 * role/permission); meetings span sections, so no per-section row-scope.
 *
 * VOCAB-FREE: the timing message is inline Bangla and `MEETING_SCHEDULE` is emitted
 * kind-gated (a no-op until the kind is registered — the §4.1/D-#94 path). Identity
 * plane; no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  dispatchMeetingSchedule,
  setSlotAttendance,
  meetingAttendanceSummary,
  type MeetingDispatchOutcome,
  type MeetingDispatchResult,
  type MeetingAttendanceSummary,
} from "../services/MeetingDispatchService";
import type { ParentMeetingSlotShape } from "../services/ParentMeetingService";

// ---------------------------------------------------------------------------
// GraphQL shapes (distinct type names — no clash with the CM-3 ParentMeeting* refs)
// ---------------------------------------------------------------------------

const MeetingDispatchOutcomeRef = builder.objectRef<MeetingDispatchOutcome>("MeetingDispatchOutcome");
MeetingDispatchOutcomeRef.implement({
  description:
    "One slot's dispatch outcome (CM-4): the Bangla timing message, the wa.me link (null when phone-less → " +
    "unreachable), and the login-enabled guardian ids that got an inbox row (empty until MEETING_SCHEDULE is activated).",
  fields: (t) => ({
    slotId: t.exposeString("slotId"),
    familyKey: t.exposeString("familyKey"),
    slotTime: t.int({ nullable: true, resolve: (o) => o.slotTime }),
    onCall: t.exposeBoolean("onCall"),
    messageBn: t.exposeString("messageBn"),
    waLink: t.string({ nullable: true, resolve: (o) => o.waLink }),
    unreachableByWa: t.exposeBoolean("unreachableByWa"),
    notifiedGuardianIds: t.exposeStringList("notifiedGuardianIds"),
    dispatchedAt: t.exposeString("dispatchedAt"),
  }),
});

const MeetingDispatchResultRef = builder.objectRef<MeetingDispatchResult>("MeetingDispatchResult");
MeetingDispatchResultRef.implement({
  description:
    "The outcome of dispatching a meeting's timing notices (CM-4, J-CM5): the meeting is now scheduled; " +
    "per-slot outcomes + family counts. unreachableCount = phone-less families (wa.me-less; D-#174).",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    status: t.exposeString("status"),
    slotCount: t.exposeInt("slotCount"),
    reachableCount: t.exposeInt("reachableCount"),
    unreachableCount: t.exposeInt("unreachableCount"),
    notifiedCount: t.exposeInt("notifiedCount"),
    outcomes: t.field({ type: [MeetingDispatchOutcomeRef], resolve: (r) => r.outcomes }),
  }),
});

const MeetingSlotAttendanceRef = builder.objectRef<ParentMeetingSlotShape>("MeetingSlotAttendance");
MeetingSlotAttendanceRef.implement({
  description: "A family slot after present/absent capture (CM-4).",
  fields: (t) => ({
    id: t.exposeString("id"),
    meetingId: t.exposeString("meetingId"),
    familyKey: t.exposeString("familyKey"),
    onCall: t.exposeBoolean("onCall"),
    slotTime: t.int({ nullable: true, resolve: (s) => s.slotTime }),
    dispatchedAt: t.string({ nullable: true, resolve: (s) => s.dispatchedAt }),
    attended: t.boolean({ nullable: true, resolve: (s) => s.attended }),
    attendanceRemark: t.string({ nullable: true, resolve: (s) => s.attendanceRemark }),
  }),
});

const MeetingAttendanceSummaryRef = builder.objectRef<MeetingAttendanceSummary>("MeetingAttendanceSummary");
MeetingAttendanceSummaryRef.implement({
  description:
    "Derived attendance aggregates for a meeting (CM-4 — replaces the Office-Copy hand-typed counts): " +
    "present/absent/pending over the family slots, plus On-Call / dispatched / reachable counts.",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    total: t.exposeInt("total"),
    present: t.exposeInt("present"),
    absent: t.exposeInt("absent"),
    pending: t.exposeInt("pending"),
    onCall: t.exposeInt("onCall"),
    dispatched: t.exposeInt("dispatched"),
    reachable: t.exposeInt("reachable"),
    unreachable: t.exposeInt("unreachable"),
  }),
});

// ---------------------------------------------------------------------------
// Mutations (roster:manage — the D-#94 admin gate)
// ---------------------------------------------------------------------------

builder.mutationField("dispatchMeetingSchedule", (t) =>
  t.field({
    type: MeetingDispatchResultRef,
    description:
      "Dispatch a meeting's per-family timing notices (J-CM5): flips draft → scheduled, stamps dispatchedAt, " +
      "renders the Bangla slot message (time, or On-Call), builds wa.me links for families with a phone, and " +
      "emits MEETING_SCHEDULE kind-gated. Requires roster:manage. Audited.",
    authScopes: { hasPermission: "roster:manage" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return dispatchMeetingSchedule(args.meetingId, ctx.auth.userId as string);
    },
  }),
);

builder.mutationField("setMeetingSlotAttendance", (t) =>
  t.field({
    type: MeetingSlotAttendanceRef,
    description:
      "Capture present/absent (+ optional remark) for one family slot at the meeting (the meeting must be " +
      "dispatched first). Requires roster:manage. Audited.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      slotId: t.arg.string({ required: true }),
      attended: t.arg.boolean({ required: true }),
      remark: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return setSlotAttendance(args.slotId, args.attended, args.remark ?? undefined, ctx.auth.userId as string);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query (roster:manage — admin read)
// ---------------------------------------------------------------------------

builder.queryField("meetingAttendanceSummary", (t) =>
  t.field({
    type: MeetingAttendanceSummaryRef,
    description:
      "Derived present/absent/total aggregates for a meeting (CM-4 — replaces the Office-Copy counts). " +
      "Requires roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => meetingAttendanceSummary(args.meetingId),
  }),
);
