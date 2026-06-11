/**
 * Routine module — R-2 resolvers (routine slots + conflict engine + scope binding).
 *
 * Reads gated `routine:read`, writes `routine:manage` (D-#46). The conflict engine,
 * scope binding (D-#49), and effective-dating live in RoutineSlotService.
 */
import { builder } from "../../../schema";
import { DAYS_OF_WEEK, PERIOD_TRACKS, ROUTINE_SUBJECTS } from "@scd/shared";
import { RoutineSlot, type IRoutineSlot } from "../models/RoutineSlot";
import {
  createRoutineSlot,
  deleteRoutineSlot,
  routineForDate,
  type CreateSlotResult,
} from "../services/RoutineSlotService";

const RoutineSlotRef = builder.objectRef<IRoutineSlot>("RoutineSlot").implement({
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
    resolve: async (_r, args) =>
      RoutineSlot.find({ groupType: args.groupType, groupId: args.groupId, active: true })
        .sort({ dayOfWeek: 1, periodNumber: 1 })
        .lean() as unknown as IRoutineSlot[],
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
      return routineForDate(args.groupType, args.groupId, d);
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

builder.mutationField("deleteRoutineSlot", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "routine:manage" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => {
      await deleteRoutineSlot(args.id, ctx.auth!.userId);
      return true;
    },
  }),
);
