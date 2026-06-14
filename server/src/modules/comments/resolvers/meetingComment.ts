/**
 * Meeting-comment + comparison + guardian-read resolvers (CM-5, prd-comments-meetings
 * §3/§6/§8, J-CM6/J-CM7/J-CM8, D-#124).
 *
 * RBAC — composes EXISTING permissions only (D-#17, no new role/permission):
 *   - Save a meeting comment (`saveMeetingComment`): `tracker:write` + `assertIsClassTeacher`
 *     on the child's REAL section (resolved server-side). Office/Principal are NOT the class
 *     teacher → denied (J-CM6); the class teacher's parent-comms duty (D-#42/#45).
 *   - Comparison reads (`studentCommentTimeline` / `meetingComparison`): `tracker:read` OR
 *     `roster:manage` (the reps gate, §8).
 *   - Guardian reads (`childComments` / `childMeetingSlot`): `guardian:read_child` +
 *     `assertGuardianOfStudent` (D-#68); a dedicated shape STRUCTURALLY omits every staff
 *     field, so the meeting comment + undelivered comments can never leak (J-CM8).
 *
 * Identity plane (names studentIds); no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { Role } from "@scd/shared";
import { roleHasPermission } from "@scd/shared";
import { ForbiddenError, assertIsClassTeacher, assertGuardianOfStudent } from "../../../middleware/authz";
import { resolveCommentSection } from "../services/StudentCommentService";
import {
  saveMeetingComment,
  studentCommentTimeline,
  meetingComparison,
  childComments,
  childMeetingSlot,
  type MeetingCommentEntry,
  type CommentTypeCount,
  type StudentCommentTimeline,
  type MeetingComparison,
  type GuardianStudentComment,
  type GuardianMeetingSlot,
} from "../services/MeetingCommentService";

/** Staff comparison reads — reps gate: tracker:read OR roster:manage (§8). */
const repsScope = (_p: unknown, _a: unknown, ctx: { auth: { role: string } | null }) =>
  ctx.auth !== null &&
  (roleHasPermission(ctx.auth.role as Role, "tracker:read") ||
    roleHasPermission(ctx.auth.role as Role, "roster:manage"));

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

const MeetingCommentEntryRef = builder.objectRef<MeetingCommentEntry>("MeetingCommentEntry");
MeetingCommentEntryRef.implement({
  description:
    "A class-teacher meeting note for one child at one meeting (CM-5): positive + concern, with the " +
    "meeting's label/date. Staff/in-meeting use only — NEVER shown in the guardian portal (J-CM8).",
  fields: (t) => ({
    id: t.exposeString("id"),
    meetingId: t.exposeString("meetingId"),
    instanceLabel: t.exposeString("instanceLabel"),
    meetingDate: t.exposeString("meetingDate"),
    studentId: t.exposeString("studentId"),
    authorUserId: t.exposeString("authorUserId"),
    positiveText: t.exposeString("positiveText"),
    concernText: t.exposeString("concernText"),
    createdAt: t.exposeString("createdAt"),
    updatedAt: t.exposeString("updatedAt"),
  }),
});

const CommentTypeCountRef = builder.objectRef<CommentTypeCount>("CommentTypeCount");
CommentTypeCountRef.implement({
  description: "One bucket of the daily-comment by-type rollup (J-CM7).",
  fields: (t) => ({
    type: t.exposeString("type"),
    count: t.exposeInt("count"),
  }),
});

const StudentCommentTimelineRef = builder.objectRef<StudentCommentTimeline>("StudentCommentTimeline");
StudentCommentTimelineRef.implement({
  description:
    "A child's cross-meeting comparison timeline (CM-5, J-CM7): prior meeting notes chronological + a " +
    "daily-comment by-type rollup since the most recent meeting. All DERIVED (D-#44/#202).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    meetingComments: t.field({ type: [MeetingCommentEntryRef], resolve: (r) => r.meetingComments }),
    rollupSinceLastMeeting: t.field({ type: [CommentTypeCountRef], resolve: (r) => r.rollupSinceLastMeeting }),
    sinceMeetingId: t.string({ nullable: true, resolve: (r) => r.sinceMeetingId }),
    sinceMeetingDate: t.string({ nullable: true, resolve: (r) => r.sinceMeetingDate }),
  }),
});

const MeetingComparisonRef = builder.objectRef<MeetingComparison>("MeetingComparison");
MeetingComparisonRef.implement({
  description:
    "The in-meeting comparison for one child at one meeting (CM-5, J-CM7): this note + prior notes + the " +
    "by-type rollup of daily comments since the previous meeting.",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    instanceLabel: t.exposeString("instanceLabel"),
    meetingDate: t.exposeString("meetingDate"),
    studentId: t.exposeString("studentId"),
    current: t.field({ type: MeetingCommentEntryRef, nullable: true, resolve: (r) => r.current }),
    prior: t.field({ type: [MeetingCommentEntryRef], resolve: (r) => r.prior }),
    rollupSincePrevious: t.field({ type: [CommentTypeCountRef], resolve: (r) => r.rollupSincePrevious }),
    previousMeetingId: t.string({ nullable: true, resolve: (r) => r.previousMeetingId }),
    previousMeetingDate: t.string({ nullable: true, resolve: (r) => r.previousMeetingDate }),
  }),
});

const GuardianStudentCommentRef = builder.objectRef<GuardianStudentComment>("GuardianStudentComment");
GuardianStudentCommentRef.implement({
  description:
    "A child's DELIVERED daily comment as the guardian portal shows it — read-only (CM-5, J-CM8). " +
    "Carries type/sentiment/text/attachments/deliveredAt ONLY; NEVER authorUserId/sectionId/deliveryChannels.",
  fields: (t) => ({
    id: t.exposeString("id"),
    type: t.exposeString("type"),
    sentiment: t.exposeString("sentiment"),
    text: t.exposeString("text"),
    attachmentIds: t.exposeStringList("attachmentIds"),
    deliveredAt: t.exposeString("deliveredAt"),
    createdAt: t.exposeString("createdAt"),
  }),
});

const GuardianMeetingSlotRef = builder.objectRef<GuardianMeetingSlot>("GuardianMeetingSlot");
GuardianMeetingSlotRef.implement({
  description:
    "The guardian's own family slot for a meeting — read-only (CM-5, J-CM8). Carries the time/On-Call/class " +
    "labels/dispatch/attended ONLY; NEVER familyKey/studentIds/attendanceRemark.",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    instanceLabel: t.exposeString("instanceLabel"),
    meetingDate: t.exposeString("meetingDate"),
    slotTime: t.int({ nullable: true, resolve: (r) => r.slotTime }),
    onCall: t.exposeBoolean("onCall"),
    classLabels: t.exposeStringList("classLabels"),
    order: t.exposeInt("order"),
    dispatchedAt: t.string({ nullable: true, resolve: (r) => r.dispatchedAt }),
    attended: t.boolean({ nullable: true, resolve: (r) => r.attended }),
  }),
});

// ---------------------------------------------------------------------------
// Mutation — saveMeetingComment (class-teacher only, J-CM6)
// ---------------------------------------------------------------------------

builder.mutationField("saveMeetingComment", (t) =>
  t.field({
    type: MeetingCommentEntryRef,
    description:
      "Save (upsert) the class teacher's positive+concern note for one child at one meeting (J-CM6). " +
      "Requires tracker:write AND being the child's section class teacher (Office/Principal denied). Audited.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      meetingId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      positiveText: t.arg.string({ required: false }),
      concernText: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      // Section resolved server-side from the student (the CM-1 D-#115 posture).
      const sectionId = await resolveCommentSection(args.studentId);
      await assertIsClassTeacher(ctx, sectionId); // class-teacher-only (J-CM6 / D-#42/#45)
      return saveMeetingComment({
        meetingId: args.meetingId,
        studentId: args.studentId,
        positiveText: args.positiveText ?? undefined,
        concernText: args.concernText ?? undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries — comparison reads (reps: tracker:read OR roster:manage)
// ---------------------------------------------------------------------------

builder.queryField("studentCommentTimeline", (t) =>
  t.field({
    type: StudentCommentTimelineRef,
    description:
      "A child's cross-meeting comparison timeline (J-CM7): prior meeting notes + the daily-comment by-type " +
      "rollup since the most recent meeting. Requires tracker:read OR roster:manage.",
    authScopes: repsScope,
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => studentCommentTimeline(args.studentId),
  }),
);

builder.queryField("meetingComparison", (t) =>
  t.field({
    type: MeetingComparisonRef,
    description:
      "The in-meeting comparison for one child at one meeting (J-CM7): this note + prior notes + the daily " +
      "by-type rollup since the previous meeting. Requires tracker:read OR roster:manage.",
    authScopes: repsScope,
    args: {
      meetingId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) => meetingComparison(args.meetingId, args.studentId),
  }),
);

// ---------------------------------------------------------------------------
// Queries — guardian reads (guardian:read_child + assertGuardianOfStudent, D-#68)
// ---------------------------------------------------------------------------

builder.queryField("childComments", (t) =>
  t.field({
    type: [GuardianStudentCommentRef],
    description:
      "The linked child's DELIVERED daily comments — read-only (CM-5, J-CM8). Undelivered comments and the " +
      "meeting comment are structurally absent. Gated by the guardian-link row scope (D-#68).",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childComments(args.studentId);
    },
  }),
);

builder.queryField("childMeetingSlot", (t) =>
  t.field({
    type: GuardianMeetingSlotRef,
    nullable: true,
    description:
      "The guardian's own family slot for a meeting — read-only (CM-5, J-CM8); null when the child has no slot. " +
      "Gated by the guardian-link row scope (D-#68). Never carries the staff attendance note.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      meetingId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childMeetingSlot(args.meetingId, args.studentId);
    },
  }),
);
