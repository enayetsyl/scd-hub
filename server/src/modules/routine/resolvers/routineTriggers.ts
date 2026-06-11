/**
 * Routine module — R-5 resolvers (bell-schedule trigger + class-note/daily-diary).
 *
 * The trigger SCHEDULE is computed here; delivery (push) rides the deferred
 * messaging pipeline (D-#52). Reads gated `routine:read`; bell-duty assignment is
 * `routine:manage`; class-note publish is `routine:read` (authorized in-service to
 * the slot's teacher / cover / admin).
 */
import { builder } from "../../../schema";
import { type IBellDutyAssignment } from "../models/BellDutyAssignment";
import { type IClassNote } from "../models/ClassNote";
import { RoutineSlotRef } from "./routineSlots";
import type { BellTrigger } from "../trigger";
import {
  bellSchedule,
  assignBellDuty,
  bellDutyForDate,
  publishClassNote,
  classNotesForDate,
  myClassNotePrompts,
} from "../services/RoutineTriggerService";

const BellTriggerRef = builder.objectRef<BellTrigger>("BellTrigger").implement({
  fields: (t) => ({
    periodNumber: t.exposeInt("periodNumber"),
    endHHMM: t.exposeString("endHHMM"),
    isBreak: t.exposeBoolean("isBreak"),
    bellAdminId: t.string({ nullable: true, resolve: (b) => b.bellAdminId }),
  }),
});

const BellDutyRef = builder.objectRef<IBellDutyAssignment>("BellDutyAssignment").implement({
  fields: (t) => ({
    id: t.string({ resolve: (d) => d._id.toString() }),
    date: t.string({ resolve: (d) => new Date(d.date).toISOString() }),
    periodNumber: t.int({ nullable: true, resolve: (d) => d.periodNumber ?? null }),
    adminId: t.string({ resolve: (d) => d.adminId.toString() }),
    active: t.exposeBoolean("active"),
  }),
});

const ClassNoteRef = builder.objectRef<IClassNote>("ClassNote").implement({
  fields: (t) => ({
    id: t.string({ resolve: (n) => n._id.toString() }),
    slotId: t.string({ resolve: (n) => n.slotId.toString() }),
    groupType: t.exposeString("groupType"),
    groupId: t.string({ resolve: (n) => n.groupId.toString() }),
    date: t.string({ resolve: (n) => new Date(n.date).toISOString() }),
    subject: t.exposeString("subject"),
    taughtSummaryBn: t.exposeString("taughtSummaryBn"),
    homeworkItemId: t.string({ nullable: true, resolve: (n) => (n.homeworkItemId ? n.homeworkItemId.toString() : null) }),
    publishedBy: t.string({ resolve: (n) => n.publishedBy.toString() }),
    publishedAt: t.string({ resolve: (n) => new Date(n.publishedAt).toISOString() }),
  }),
});

function parseDate(s: string): Date {
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new Error("Invalid date");
  return d;
}

// --- Queries ---------------------------------------------------------------

builder.queryField("bellSchedule", (t) =>
  t.field({
    type: [BellTriggerRef],
    authScopes: { hasPermission: "routine:read" },
    args: { date: t.arg.string({ required: true }), audienceKey: t.arg.string({ required: true }) },
    resolve: async (_r, args) => bellSchedule(parseDate(args.date), args.audienceKey),
  }),
);

builder.queryField("bellDutyForDate", (t) =>
  t.field({
    type: [BellDutyRef],
    authScopes: { hasPermission: "routine:read" },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_r, args) => bellDutyForDate(parseDate(args.date)),
  }),
);

builder.queryField("classNotesForDate", (t) =>
  t.field({
    type: [ClassNoteRef],
    authScopes: { hasPermission: "routine:read" },
    args: {
      groupType: t.arg.string({ required: true }),
      groupId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
    },
    resolve: async (_r, args) => {
      if (args.groupType !== "section" && args.groupType !== "subjectgroup") throw new Error("Invalid groupType");
      return classNotesForDate(args.groupType, args.groupId, parseDate(args.date));
    },
  }),
);

builder.queryField("myClassNotePrompts", (t) =>
  t.field({
    type: [RoutineSlotRef],
    authScopes: { hasPermission: "routine:read" },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => myClassNotePrompts(parseDate(args.date), ctx.auth!.userId),
  }),
);

// --- Mutations -------------------------------------------------------------

builder.mutationField("assignBellDuty", (t) =>
  t.field({
    type: BellDutyRef,
    authScopes: { hasPermission: "routine:manage" },
    args: {
      date: t.arg.string({ required: true }),
      periodNumber: t.arg.int({ required: false }),
      adminId: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) =>
      assignBellDuty({
        date: parseDate(args.date),
        periodNumber: args.periodNumber ?? null,
        adminId: args.adminId,
        actorId: ctx.auth!.userId,
      }),
  }),
);

builder.mutationField("publishClassNote", (t) =>
  t.field({
    type: ClassNoteRef,
    authScopes: { hasPermission: "routine:read" },
    args: {
      slotId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
      taughtSummaryBn: t.arg.string({ required: true }),
      homeworkItemId: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      publishClassNote({
        slotId: args.slotId,
        date: parseDate(args.date),
        taughtSummaryBn: args.taughtSummaryBn,
        homeworkItemId: args.homeworkItemId ?? null,
        actorId: ctx.auth!.userId,
        canManage: ctx.auth!.role === "PRINCIPAL" || ctx.auth!.role === "OFFICE",
      }),
  }),
);
