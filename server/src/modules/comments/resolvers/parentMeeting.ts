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
  listParentMeetings,
  getParentMeeting,
  listMeetingSlots,
  type ParentMeetingShape,
  type ParentMeetingSlotShape,
  type GenerateSlotsResult,
} from "../services/ParentMeetingService";

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

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
    status: t.exposeString("status"),
    includeClassIds: t.exposeStringList("includeClassIds"),
    includeSectionIds: t.exposeStringList("includeSectionIds"),
    createdAt: t.exposeString("createdAt"),
    updatedAt: t.exposeString("updatedAt"),
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
    order: t.exposeInt("order"),
    slotTime: t.int({ nullable: true, resolve: (s) => s.slotTime }),
    onCall: t.exposeBoolean("onCall"),
    dispatchedAt: t.string({ nullable: true, resolve: (s) => s.dispatchedAt }),
    attended: t.boolean({ nullable: true, resolve: (s) => s.attended }),
    attendanceRemark: t.string({ nullable: true, resolve: (s) => s.attendanceRemark }),
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
    authScopes: { hasPermission: "roster:manage" },
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
    authScopes: { hasPermission: "roster:manage" },
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
    authScopes: { hasPermission: "roster:manage" },
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
    authScopes: { hasPermission: "roster:manage" },
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

// ---------------------------------------------------------------------------
// Queries (roster:manage — admin reads for the Office)
// ---------------------------------------------------------------------------

builder.queryField("parentMeetings", (t) =>
  t.field({
    type: [ParentMeetingRef],
    description: "List parents' meetings (optionally by academic year), newest first. Requires roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: { academicYearId: t.arg.string({ required: false }) },
    resolve: async (_root, args) => listParentMeetings(args.academicYearId ?? undefined),
  }),
);

builder.queryField("parentMeeting", (t) =>
  t.field({
    type: ParentMeetingRef,
    description: "One parents' meeting by id. Requires roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => getParentMeeting(args.meetingId),
  }),
);

builder.queryField("parentMeetingSlots", (t) =>
  t.field({
    type: [ParentMeetingSlotRef],
    description: "A meeting's per-family slots in display order. Requires roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => listMeetingSlots(args.meetingId),
  }),
);
