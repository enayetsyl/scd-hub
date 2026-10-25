/**
 * Parents'-Meeting + per-family slot resolvers (CM-3, prd-comments-meetings §3/§6,
 * D-#123). The Office/Principal create a meeting, generate per-family slots (siblings
 * collapsed by Student.phone), flag On-Call, reorder, and read the arrangement.
 *
 * RBAC — composes EXISTING permissions only (D-#17/#94, no new role/permission):
 *   every mutation + read here is gated `roster:manage` (the admin gate; Principal +
 *   Office hold it, teachers/guardians do not). Meetings span sections, so there is no
 *   per-section row-scope — the flat admin permission is the gate.
 *
 * NO dispatch / no attendance / no MeetingComment here — those are CM-4 / CM-5.
 * Identity plane (slots name studentIds + the family phone); no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  createParentMeeting,
  generateSlots,
  setSlotOnCall,
  reorderSlots,
  setMeetingBreaks,
  listParentMeetings,
  getParentMeeting,
  listMeetingSlots,
  type ParentMeetingShape,
  type ParentMeetingSlotShape,
  type GenerateSlotsResult,
  type MeetingSlotResponseShape,
} from "../services/ParentMeetingService";

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

const MeetingBreakRef = builder.objectRef<{ startMinutes: number; endMinutes: number }>("MeetingBreak");
MeetingBreakRef.implement({
  description: "A clock-time break in a parents' meeting day: [startMinutes, endMinutes), minutes-from-midnight.",
  fields: (t) => ({
    startMinutes: t.exposeInt("startMinutes"),
    endMinutes: t.exposeInt("endMinutes"),
  }),
});

const MeetingBreakInput = builder.inputType("MeetingBreakInput", {
  fields: (t) => ({
    startMinutes: t.int({ required: true }),
    endMinutes: t.int({ required: true }),
  }),
});

const ParentMeetingRef = builder.objectRef<ParentMeetingShape>("ParentMeeting");
ParentMeetingRef.implement({
  description:
    "A twice-yearly parents' meeting (CM-3): academic year + instance label + date + slot length + " +
    "day-start + includeScope. status draft→scheduled→closed (the scheduled flip is CM-4). Identity plane.",
  fields: (t) => ({
    id: t.exposeString("id"),
    academicYearId: t.exposeString("academicYearId"),
    instanceLabel: t.exposeString("instanceLabel"),
    meetingDate: t.exposeString("meetingDate"),
    slotMinutes: t.exposeInt("slotMinutes"),
    dayStartMinutes: t.exposeInt("dayStartMinutes"),
    breaks: t.field({ type: [MeetingBreakRef], resolve: (m) => m.breaks }),
    status: t.exposeString("status"),
    includeClassIds: t.exposeStringList("includeClassIds"),
    includeSectionIds: t.exposeStringList("includeSectionIds"),
    createdAt: t.exposeString("createdAt"),
    updatedAt: t.exposeString("updatedAt"),
  }),
});

export const MeetingSlotResponseRef = builder.objectRef<MeetingSlotResponseShape>("MeetingSlotResponse");
MeetingSlotResponseRef.implement({
  description:
    "A family's one, final answer to its slot (D-#840): choice CONFIRMED | CHANGE_REQUESTED | CANT_COME, " +
    "plus the Principal/VP ruling on a change (reviewOutcome APPROVED | DECLINED, D-#842).",
  fields: (t) => ({
    choice: t.exposeString("choice"),
    preferredSlotTime: t.int({ nullable: true, resolve: (r) => r.preferredSlotTime }),
    reason: t.string({ nullable: true, resolve: (r) => r.reason }),
    respondedAt: t.exposeString("respondedAt"),
    reviewOutcome: t.string({ nullable: true, resolve: (r) => r.reviewOutcome }),
    reviewNote: t.string({ nullable: true, resolve: (r) => r.reviewNote }),
    reviewFromSlotTime: t.int({ nullable: true, resolve: (r) => r.reviewFromSlotTime }),
    reviewedAt: t.string({ nullable: true, resolve: (r) => r.reviewedAt }),
    reviewSeenAt: t.string({ nullable: true, resolve: (r) => r.reviewSeenAt }),
  }),
});

const ParentMeetingSlotRef = builder.objectRef<ParentMeetingSlotShape>("ParentMeetingSlot");
ParentMeetingSlotRef.implement({
  description:
    "One appointment per family for a parents' meeting (CM-3): siblings collapsed by Student.phone, " +
    "combined studentIds/classLabels, an order that drives the slot time, On-Call (no time). " +
    "dispatchedAt/attended/attendanceRemark are populated in CM-4.",
  fields: (t) => ({
    id: t.exposeString("id"),
    meetingId: t.exposeString("meetingId"),
    familyKey: t.exposeString("familyKey"),
    studentIds: t.exposeStringList("studentIds"),
    classLabels: t.exposeStringList("classLabels"),
    studentNames: t.stringList({
      nullable: true,
      description: "Names parallel to studentIds, joined at read time; null on payloads that do not join them.",
      resolve: (s) => s.studentNames ?? null,
    }),
    order: t.exposeInt("order"),
    slotTime: t.int({ nullable: true, resolve: (s) => s.slotTime }),
    onCall: t.exposeBoolean("onCall"),
    dispatchedAt: t.string({ nullable: true, resolve: (s) => s.dispatchedAt }),
    attended: t.boolean({ nullable: true, resolve: (s) => s.attended }),
    attendanceRemark: t.string({ nullable: true, resolve: (s) => s.attendanceRemark }),
    response: t.field({ type: MeetingSlotResponseRef, nullable: true, resolve: (s) => s.response }),
    rescheduledAt: t.string({ nullable: true, resolve: (s) => s.rescheduledAt }),
    createdAt: t.exposeString("createdAt"),
    updatedAt: t.exposeString("updatedAt"),
  }),
});

const GenerateSlotsResultRef = builder.objectRef<GenerateSlotsResult>("GenerateSlotsResult");
GenerateSlotsResultRef.implement({
  description:
    "The outcome of generating a meeting's per-family slots: the slots + family counts. " +
    "unreachableCount = phone-less single-student families (D-#174 — counted, never dropped).",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    slots: t.field({ type: [ParentMeetingSlotRef], resolve: (r) => r.slots }),
    familyCount: t.exposeInt("familyCount"),
    reachableCount: t.exposeInt("reachableCount"),
    unreachableCount: t.exposeInt("unreachableCount"),
  }),
});

// ---------------------------------------------------------------------------
// Mutations (roster:manage — the D-#94 admin gate)
// ---------------------------------------------------------------------------

builder.mutationField("createParentMeeting", (t) =>
  t.field({
    type: ParentMeetingRef,
    description:
      "Create a parents' meeting in draft (academicYear defaults to the current; instanceLabel + date + " +
      "slotMinutes + dayStartMinutes + optional class/section scope). Requires roster:manage. Audited.",
    authScopes: { hasPermission: "parents_meeting:create" },
    args: {
      instanceLabel: t.arg.string({ required: true }),
      meetingDate: t.arg.string({ required: true }),
      slotMinutes: t.arg.int({ required: true }),
      dayStartMinutes: t.arg.int({ required: true }),
      academicYearId: t.arg.string({ required: false }),
      includeClassIds: t.arg.stringList({ required: false }),
      includeSectionIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return createParentMeeting({
        instanceLabel: args.instanceLabel,
        meetingDate: args.meetingDate,
        slotMinutes: args.slotMinutes,
        dayStartMinutes: args.dayStartMinutes,
        academicYearId: args.academicYearId ?? undefined,
        includeClassIds: args.includeClassIds ?? undefined,
        includeSectionIds: args.includeSectionIds ?? undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("generateMeetingSlots", (t) =>
  t.field({
    type: GenerateSlotsResultRef,
    description:
      "Generate per-family slots for a draft meeting (siblings collapsed by Student.phone, default order " +
      "class→section→name, sequential timed slots). WHOLESALE / idempotent — re-running rebuilds the set. " +
      "Requires roster:manage. Audited.",
    authScopes: { hasPermission: "parents_meeting:create" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return generateSlots(args.meetingId, ctx.auth.userId as string);
    },
  }),
);

builder.mutationField("setMeetingSlotOnCall", (t) =>
  t.field({
    type: [ParentMeetingSlotRef],
    description:
      "Flag (or unflag) a family's slot as On-Call (no fixed time) and re-time the remaining slots. " +
      "Requires roster:manage. Returns the meeting's slots in order. Audited.",
    authScopes: { hasPermission: "parents_meeting:create" },
    args: {
      slotId: t.arg.string({ required: true }),
      onCall: t.arg.boolean({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return setSlotOnCall(args.slotId, args.onCall, ctx.auth.userId as string);
    },
  }),
);

builder.mutationField("reorderMeetingSlots", (t) =>
  t.field({
    type: [ParentMeetingSlotRef],
    description:
      "Reorder a draft meeting's slots (the new order drives the slot times). The list must be exactly the " +
      "meeting's slots. Requires roster:manage. Returns the slots in the new order. Audited.",
    authScopes: { hasPermission: "parents_meeting:create" },
    args: {
      meetingId: t.arg.string({ required: true }),
      slotIds: t.arg.stringList({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return reorderSlots(args.meetingId, args.slotIds, ctx.auth.userId as string);
    },
  }),
);

const SetMeetingBreaksResultRef = builder.objectRef<{ meeting: ParentMeetingShape; slots: ParentMeetingSlotShape[] }>(
  "SetMeetingBreaksResult",
);
SetMeetingBreaksResultRef.implement({
  fields: (t) => ({
    meeting: t.field({ type: ParentMeetingRef, resolve: (r) => r.meeting }),
    slots: t.field({ type: [ParentMeetingSlotRef], resolve: (r) => r.slots }),
  }),
});

builder.mutationField("setMeetingBreaks", (t) =>
  t.field({
    type: SetMeetingBreaksResultRef,
    description:
      "Replace a draft meeting's clock-time breaks (overlaps merge) and re-time its slots so none runs " +
      "into a break. Requires roster:manage. Audited.",
    authScopes: { hasPermission: "parents_meeting:create" },
    args: {
      meetingId: t.arg.string({ required: true }),
      breaks: t.arg({ type: [MeetingBreakInput], required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return setMeetingBreaks(args.meetingId, args.breaks, ctx.auth.userId as string);
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries (roster:manage — admin reads for the Office)
// ---------------------------------------------------------------------------

builder.queryField("parentMeetings", (t) =>
  t.field({
    type: [ParentMeetingRef],
    description: "List parents' meetings (optionally by academic year), newest first. Requires roster:manage.",
    authScopes: { hasPermission: "parents_meeting:view" },
    args: { academicYearId: t.arg.string({ required: false }) },
    resolve: async (_root, args) => listParentMeetings(args.academicYearId ?? undefined),
  }),
);

builder.queryField("parentMeeting", (t) =>
  t.field({
    type: ParentMeetingRef,
    description: "One parents' meeting by id. Requires roster:manage.",
    authScopes: { hasPermission: "parents_meeting:view" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => getParentMeeting(args.meetingId),
  }),
);

builder.queryField("parentMeetingSlots", (t) =>
  t.field({
    type: [ParentMeetingSlotRef],
    description: "A meeting's per-family slots in display order. Requires roster:manage.",
    authScopes: { hasPermission: "parents_meeting:view" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => listMeetingSlots(args.meetingId),
  }),
);
