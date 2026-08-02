/**
 * Routine module — R-2 resolvers (routine slots + conflict engine + scope binding).
 *
 * Reads gated `routine:read`, writes `routine:manage` (D-#46). The conflict engine,
 * scope binding (D-#49), and effective-dating live in RoutineSlotService.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { DAYS_OF_WEEK, PERIOD_TRACKS, ROUTINE_SUBJECTS } from "@scd/shared";
import { RoutineSlot, type IRoutineSlot } from "../models/RoutineSlot";
import { type IRoutineSubstitution } from "../models/RoutineSubstitution";
import {
  createRoutineSlot,
  updateRoutineSlot,
  deleteRoutineSlot,
  routineForDate,
  sectionSubjectRoutineTeachers,
  reassignRoutineSubjectTeacher,
  type CreateSlotResult,
  type SubjectRoutineTeachers,
  type ReassignSubjectTeacherResult,
} from "../services/RoutineSlotService";
import {
  teacherAvailability,
  assignCover,
  cancelCover,
  coversForDate,
} from "../services/RoutineCoverService";
import { liveWindow } from "../liveWindow";
import { enrichRoutineSlots } from "../slotView";
import { routineMasterGrid, routineMasterWeek, type MasterColumn, type MasterRow, type MasterConflict, type RoutineMaster } from "../routineMaster";
import type { AvailabilityRow } from "../cover";

/** Parse the optional changeover date carried by the versioned write mutations
 *  (D-#47(3)). Absent → the service defaults to today. */
function parseEffectiveFrom(raw?: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) throw new Error("Invalid effectiveFrom");
  return d;
}

export const RoutineSlotRef = builder.objectRef<IRoutineSlot>("RoutineSlot").implement({
  fields: (t) => ({
    id: t.string({ resolve: (s) => s._id.toString() }),
    groupType: t.exposeString("groupType"),
    groupId: t.string({ resolve: (s) => s.groupId.toString() }),
    classId: t.string({ nullable: true, resolve: (s) => (s.classId ? s.classId.toString() : null) }),
    dayOfWeek: t.exposeString("dayOfWeek"),
    periodNumber: t.exposeInt("periodNumber"),
    subject: t.exposeString("subject"),
    track: t.exposeString("track"),
    isBreak: t.exposeBoolean("isBreak"),
    teacherId: t.string({ nullable: true, resolve: (s) => (s.teacherId ? s.teacherId.toString() : null) }),
    roomId: t.string({ nullable: true, resolve: (s) => (s.roomId ? s.roomId.toString() : null) }),
    effectiveFrom: t.string({ resolve: (s) => new Date(s.effectiveFrom).toISOString() }),
    effectiveTo: t.string({ nullable: true, resolve: (s) => (s.effectiveTo ? new Date(s.effectiveTo).toISOString() : null) }),
    active: t.exposeBoolean("active"),
    // Populated only by routineForDate (the cover overlaying this slot on that date, R4.4).
    coverTeacherId: t.string({
      nullable: true,
      resolve: (s) => (s as { coverTeacherId?: string | null }).coverTeacherId ?? null,
    }),
    // View-only enrichment (R-3) — attached by enrichRoutineSlots on the read paths.
    teacherName: t.string({ nullable: true, resolve: (s) => (s as { teacherName?: string | null }).teacherName ?? null }),
    coverTeacherName: t.string({ nullable: true, resolve: (s) => (s as { coverTeacherName?: string | null }).coverTeacherName ?? null }),
    startTime: t.string({ nullable: true, resolve: (s) => (s as { startTime?: string | null }).startTime ?? null }),
    endTime: t.string({ nullable: true, resolve: (s) => (s as { endTime?: string | null }).endTime ?? null }),
    groupName: t.string({ nullable: true, resolve: (s) => (s as { groupName?: string | null }).groupName ?? null }),
    // True only on myDay's synthesized rows (PXG-1 gap fix): this period belongs to
    // another (absent) teacher and the caller is covering it under an approved HR
    // leave-cover slot for this date — teacherName above is the ABSENT teacher's name.
    isCovering: t.boolean({ resolve: (s) => (s as { isCovering?: boolean }).isCovering ?? false }),
  }),
});

const AvailabilityRowRef = builder.objectRef<AvailabilityRow>("AvailabilityRow").implement({
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    name: t.exposeString("name"),
    classCount: t.exposeInt("classCount"),
    free: t.exposeBoolean("free"),
  }),
});

const RoutineSubstitutionRef = builder.objectRef<IRoutineSubstitution>("RoutineSubstitution").implement({
  fields: (t) => ({
    id: t.string({ resolve: (s) => s._id.toString() }),
    slotId: t.string({ resolve: (s) => s.slotId.toString() }),
    date: t.string({ resolve: (s) => new Date(s.date).toISOString() }),
    coverTeacherId: t.string({ resolve: (s) => s.coverTeacherId.toString() }),
    absentTeacherId: t.string({ nullable: true, resolve: (s) => (s.absentTeacherId ? s.absentTeacherId.toString() : null) }),
    reason: t.string({ nullable: true, resolve: (s) => s.reason ?? null }),
    proxyGrantId: t.string({ nullable: true, resolve: (s) => (s.proxyGrantId ? s.proxyGrantId.toString() : null) }),
    active: t.exposeBoolean("active"),
    // View-only enrichment (coversForDate): names + covered-slot context so the list
    // shows readable text instead of raw ObjectIds.
    coverTeacherName: t.string({ nullable: true, resolve: (s) => (s as { coverTeacherName?: string | null }).coverTeacherName ?? null }),
    absentTeacherName: t.string({ nullable: true, resolve: (s) => (s as { absentTeacherName?: string | null }).absentTeacherName ?? null }),
    subject: t.string({ nullable: true, resolve: (s) => (s as { subject?: string | null }).subject ?? null }),
    periodNumber: t.int({ nullable: true, resolve: (s) => (s as { periodNumber?: number | null }).periodNumber ?? null }),
    dayOfWeek: t.string({ nullable: true, resolve: (s) => (s as { dayOfWeek?: string | null }).dayOfWeek ?? null }),
    groupName: t.string({ nullable: true, resolve: (s) => (s as { groupName?: string | null }).groupName ?? null }),
  }),
});

const CreateSlotResultRef = builder.objectRef<CreateSlotResult>("CreateSlotResult").implement({
  fields: (t) => ({
    slot: t.field({ type: RoutineSlotRef, resolve: (r) => r.slot }),
    warnings: t.stringList({ resolve: (r) => r.warnings }),
  }),
});

// ---------------------------------------------------------------------------
// Queries (routine:read)
// ---------------------------------------------------------------------------

builder.queryField("routineSlots", (t) =>
  t.field({
    type: [RoutineSlotRef],
    authScopes: { hasPermission: "routine:read" },
    args: {
      groupType: t.arg.string({ required: true }),
      groupId: t.arg.string({ required: true }),
    },
    resolve: async (_r, args) => {
      const slots = await RoutineSlot.find({
        groupType: args.groupType,
        groupId: args.groupId,
        active: true,
        ...liveWindow(),
      })
        .sort({ dayOfWeek: 1, periodNumber: 1 })
        .lean();
      return enrichRoutineSlots(slots) as unknown as IRoutineSlot[];
    },
  }),
);

builder.queryField("myRoutineSlots", (t) =>
  t.field({
    type: [RoutineSlotRef],
    authScopes: { hasPermission: "routine:read" },
    resolve: async (_r, _args, ctx) => {
      const slots = await RoutineSlot.find({ teacherId: ctx.auth!.userId, active: true, ...liveWindow() })
        .sort({ dayOfWeek: 1, periodNumber: 1 })
        .lean();
      return enrichRoutineSlots(slots) as unknown as IRoutineSlot[];
    },
  }),
);

builder.queryField("routineForDate", (t) =>
  t.field({
    type: [RoutineSlotRef],
    authScopes: { hasPermission: "routine:read" },
    args: {
      groupType: t.arg.string({ required: true }),
      groupId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
    },
    resolve: async (_r, args) => {
      const d = new Date(args.date);
      if (isNaN(d.getTime())) throw new Error("Invalid date");
      if (args.groupType !== "section" && args.groupType !== "subjectgroup")
        throw new Error("Invalid groupType");
      const slots = await routineForDate(args.groupType, args.groupId, d);
      return enrichRoutineSlots(slots) as unknown as IRoutineSlot[];
    },
  }),
);

// ---------------------------------------------------------------------------
// Master grid (admin overview — all groups × periods for a day + conflicts, R-3)
// ---------------------------------------------------------------------------

const MasterColumnRef = builder.objectRef<MasterColumn>("RoutineMasterColumn").implement({
  fields: (t) => ({
    periodNumber: t.exposeInt("periodNumber"),
    startTime: t.string({ nullable: true, resolve: (c) => c.startTime }),
    endTime: t.string({ nullable: true, resolve: (c) => c.endTime }),
    isBreak: t.exposeBoolean("isBreak"),
  }),
});
const MasterRowRef = builder.objectRef<MasterRow>("RoutineMasterRow").implement({
  fields: (t) => ({
    groupType: t.exposeString("groupType"),
    groupId: t.exposeString("groupId"),
    label: t.exposeString("label"),
    sublabel: t.string({ nullable: true, resolve: (r) => r.sublabel }),
  }),
});
const MasterConflictRef = builder.objectRef<MasterConflict>("RoutineMasterConflict").implement({
  fields: (t) => ({
    periodNumber: t.exposeInt("periodNumber"),
    teacherId: t.exposeString("teacherId"),
    teacherName: t.string({ nullable: true, resolve: (c) => c.teacherName }),
    labels: t.stringList({ resolve: (c) => c.labels }),
  }),
});
const RoutineMasterRef = builder.objectRef<RoutineMaster>("RoutineMaster").implement({
  fields: (t) => ({
    day: t.exposeString("day"),
    columns: t.field({ type: [MasterColumnRef], resolve: (m) => m.columns }),
    rows: t.field({ type: [MasterRowRef], resolve: (m) => m.rows }),
    slots: t.field({ type: [RoutineSlotRef], resolve: (m) => m.slots as unknown as IRoutineSlot[] }),
    conflicts: t.field({ type: [MasterConflictRef], resolve: (m) => m.conflicts }),
  }),
});

builder.queryField("routineMaster", (t) =>
  t.field({
    type: RoutineMasterRef,
    authScopes: { hasPermission: "routine:manage" },
    args: { day: t.arg.string({ required: true }) },
    resolve: async (_r, args) => {
      if (!(DAYS_OF_WEEK as readonly string[]).includes(args.day)) throw new Error("Invalid day");
      return routineMasterGrid(args.day);
    },
  }),
);

builder.queryField("routineMasterWeek", (t) =>
  t.field({
    type: [RoutineMasterRef],
    authScopes: { hasPermission: "routine:manage" },
    resolve: async () => routineMasterWeek(),
  }),
);

// ---------------------------------------------------------------------------
// Subject-teacher ⇄ routine visibility + sync (D-#291)
// ---------------------------------------------------------------------------

const SubjectRoutineTeachersRef = builder
  .objectRef<SubjectRoutineTeachers>("SubjectRoutineTeachers")
  .implement({
    description:
      "The ROUTINE's teacher(s) for one subject in a section (live slots) — shown beside the " +
      "teaching grants so a grant/timetable mismatch is visible (D-#291).",
    fields: (t) => ({
      subject: t.exposeString("subject"),
      teacherIds: t.field({ type: ["String"], resolve: (r) => r.teacherIds }),
      teacherNames: t.field({ type: ["String"], resolve: (r) => r.teacherNames }),
    }),
  });

builder.queryField("sectionSubjectRoutineTeachers", (t) =>
  t.field({
    type: [SubjectRoutineTeachersRef],
    description: "Per-subject routine teachers for a section's live slots (Assign-subject-teacher view).",
    authScopes: { hasPermission: "user:manage" },
    args: { sectionId: t.arg.string({ required: true }) },
    resolve: (_r, args) => sectionSubjectRoutineTeachers(args.sectionId),
  }),
);

const ReassignResultRef = builder
  .objectRef<ReassignSubjectTeacherResult>("ReassignSubjectTeacherResult")
  .implement({
    fields: (t) => ({
      updatedSlots: t.exposeInt("updatedSlots"),
      warnings: t.field({ type: ["String"], resolve: (r) => r.warnings }),
    }),
  });

builder.mutationField("reassignRoutineSubjectTeacher", (t) =>
  t.field({
    type: ReassignResultRef,
    description:
      "Point every live routine slot of (section, subject) at a new teacher (D-#291) — the optional " +
      "'also update the routine' step after a subject-teacher assignment. Whole-or-nothing: pre-checks " +
      "the teacher's availability across all affected periods, then reuses the master-grid cell-edit " +
      "path per slot (conflict engine + grant re-binding + chat re-sync).",
    authScopes: { hasPermission: "routine:manage" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      teacherId: t.arg.string({ required: true }),
      effectiveFrom: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (!(ROUTINE_SUBJECTS as readonly string[]).includes(args.subject))
        throw new Error("Invalid subject");
      return reassignRoutineSubjectTeacher(
        args.sectionId,
        args.subject,
        args.teacherId,
        ctx.auth.userId,
        parseEffectiveFrom(args.effectiveFrom),
      );
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations (routine:manage)
// ---------------------------------------------------------------------------

builder.mutationField("createRoutineSlot", (t) =>
  t.field({
    type: CreateSlotResultRef,
    authScopes: { hasPermission: "routine:manage" },
    args: {
      groupType: t.arg.string({ required: true }),
      groupId: t.arg.string({ required: true }),
      dayOfWeek: t.arg.string({ required: true }),
      periodNumber: t.arg.int({ required: true }),
      subject: t.arg.string({ required: true }),
      track: t.arg.string({ required: true }),
      isBreak: t.arg.boolean({ required: true }),
      teacherId: t.arg.string({ required: false }),
      roomId: t.arg.string({ required: false }),
      effectiveFrom: t.arg.string({ required: true }),
      effectiveTo: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      if (args.groupType !== "section" && args.groupType !== "subjectgroup")
        throw new Error("Invalid groupType");
      if (!(DAYS_OF_WEEK as readonly string[]).includes(args.dayOfWeek))
        throw new Error("Invalid dayOfWeek");
      if (!(PERIOD_TRACKS as readonly string[]).includes(args.track))
        throw new Error("Invalid track");
      if (!(ROUTINE_SUBJECTS as readonly string[]).includes(args.subject))
        throw new Error("Invalid subject");
      const from = new Date(args.effectiveFrom);
      if (isNaN(from.getTime())) throw new Error("Invalid effectiveFrom");
      let to: Date | null = null;
      if (args.effectiveTo) {
        to = new Date(args.effectiveTo);
        if (isNaN(to.getTime())) throw new Error("Invalid effectiveTo");
        if (to.getTime() < from.getTime()) throw new Error("effectiveTo must be ≥ effectiveFrom");
      }
      return createRoutineSlot({
        groupType: args.groupType,
        groupId: args.groupId,
        dayOfWeek: args.dayOfWeek as (typeof DAYS_OF_WEEK)[number],
        periodNumber: args.periodNumber,
        subject: args.subject as (typeof ROUTINE_SUBJECTS)[number],
        track: args.track as (typeof PERIOD_TRACKS)[number],
        isBreak: args.isBreak,
        teacherId: args.teacherId ?? null,
        roomId: args.roomId ?? null,
        effectiveFrom: from,
        effectiveTo: to,
        createdBy: ctx.auth!.userId,
      });
    },
  }),
);

builder.mutationField("updateRoutineSlot", (t) =>
  t.field({
    type: CreateSlotResultRef,
    authScopes: { hasPermission: "routine:manage" },
    args: {
      id: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      track: t.arg.string({ required: true }),
      teacherId: t.arg.string({ required: false }),
      roomId: t.arg.string({ required: false }),
      effectiveFrom: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      if (!(PERIOD_TRACKS as readonly string[]).includes(args.track))
        throw new Error("Invalid track");
      if (!(ROUTINE_SUBJECTS as readonly string[]).includes(args.subject))
        throw new Error("Invalid subject");
      return updateRoutineSlot({
        slotId: args.id,
        subject: args.subject as (typeof ROUTINE_SUBJECTS)[number],
        track: args.track as (typeof PERIOD_TRACKS)[number],
        teacherId: args.teacherId ?? null,
        roomId: args.roomId ?? null,
        actorId: ctx.auth!.userId,
        effectiveFrom: parseEffectiveFrom(args.effectiveFrom),
      });
    },
  }),
);

builder.mutationField("deleteRoutineSlot", (t) =>
  t.field({
    type: "Boolean",
    description:
      "Remove a cell from the timetable. A slot that has already applied is RETIRED from " +
      "`effectiveFrom` (default today) so history survives; one whose window has not started " +
      "is deleted outright (D-#47(3)).",
    authScopes: { hasPermission: "routine:manage" },
    args: {
      id: t.arg.string({ required: true }),
      effectiveFrom: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      await deleteRoutineSlot(args.id, ctx.auth!.userId, parseEffectiveFrom(args.effectiveFrom));
      return true;
    },
  }),
);

// ---------------------------------------------------------------------------
// Cover / proxy-manage (R-4)
// ---------------------------------------------------------------------------

builder.queryField("teacherAvailability", (t) =>
  t.field({
    type: [AvailabilityRowRef],
    description:
      "Free/busy + day class-count per teacher for a (date, period) — widened from routine:manage to " +
      "any authenticated staff (D-#268 ruling, PXG-1): the applicant proposing a cover needs this too. " +
      "Guardians remain excluded (plane isolation).",
    authScopes: { authenticated: true },
    args: {
      date: t.arg.string({ required: true }),
      periodNumber: t.arg.int({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      if (ctx.auth?.role === "GUARDIAN") throw new ForbiddenError();
      const d = new Date(args.date);
      if (isNaN(d.getTime())) throw new Error("Invalid date");
      return teacherAvailability(d, args.periodNumber);
    },
  }),
);

builder.queryField("coversForDate", (t) =>
  t.field({
    type: [RoutineSubstitutionRef],
    authScopes: { hasPermission: "routine:read" },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_r, args) => {
      const d = new Date(args.date);
      if (isNaN(d.getTime())) throw new Error("Invalid date");
      return coversForDate(d);
    },
  }),
);

builder.mutationField("assignCover", (t) =>
  t.field({
    type: RoutineSubstitutionRef,
    authScopes: { hasPermission: "routine:manage" },
    args: {
      slotId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
      coverTeacherId: t.arg.string({ required: true }),
      reason: t.arg.string({ required: false }),
      durationDays: t.arg.int({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      const d = new Date(args.date);
      if (isNaN(d.getTime())) throw new Error("Invalid date");
      return assignCover({
        slotId: args.slotId,
        date: d,
        coverTeacherId: args.coverTeacherId,
        reason: args.reason ?? null,
        durationDays: args.durationDays ?? undefined,
        actorId: ctx.auth!.userId,
      });
    },
  }),
);

builder.mutationField("cancelCover", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "routine:manage" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => {
      await cancelCover(args.id, ctx.auth!.userId);
      return true;
    },
  }),
);
