/**
 * Routine module — R-5 resolvers (bell-schedule trigger + class-note/daily-diary).
 *
 * The trigger SCHEDULE is computed here; delivery (push) rides the deferred
 * messaging pipeline (D-#52). Reads gated `routine:read`; bell-duty assignment is
 * `routine:manage`; class-note publish is `routine:read` (authorized in-service to
 * the slot's teacher / cover / admin).
 */
import { builder } from "../../../schema";
import { assertCanRead, allowedSubjectCodesForSection } from "../../../middleware/authz";
import { Section } from "../../foundation/models/Section";
import { type IBellDutyAssignment } from "../models/BellDutyAssignment";
import { type IClassNote } from "../models/ClassNote";
import { RoutineSlotRef } from "./routineSlots";
import type { BellTrigger } from "../trigger";
import { isAdminStaff } from "../../foundation/services/RoleScope";
import {
  bellSchedule,
  assignBellDuty,
  bellDutyForDate,
  publishClassNote,
  classNotesForDate,
  classNoteSubmissionReport,
  myClassNotePrompts,
  updateClassNote,
  deleteClassNote,
  classNotesAdmin,
  type ClassNoteSubmissionRow,
  type ClassNoteAdminRow,
  type ClassNoteAttachmentView,
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
    attachmentIds: t.stringList({ resolve: (n) => (n.attachmentIds ?? []).map((a) => a.toString()) }),
    publishedBy: t.string({ resolve: (n) => n.publishedBy.toString() }),
    publishedAt: t.string({ resolve: (n) => new Date(n.publishedAt).toISOString() }),
  }),
});

const ClassNoteAttachmentRef = builder.objectRef<ClassNoteAttachmentView>("ClassNoteAttachment").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    mime: t.exposeString("mime"),
  }),
});

const ClassNoteAdminRowRef = builder.objectRef<ClassNoteAdminRow>("ClassNoteAdminRow").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    date: t.exposeString("date"),
    subject: t.exposeString("subject"),
    taughtSummaryBn: t.exposeString("taughtSummaryBn"),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel ?? null }),
    classNameBn: t.string({ nullable: true, resolve: (r) => r.classNameBn }),
    sectionCode: t.string({ nullable: true, resolve: (r) => r.sectionCode }),
    sectionNameBn: t.string({ nullable: true, resolve: (r) => r.sectionNameBn }),
    subjectGroupNameBn: t.string({ nullable: true, resolve: (r) => r.subjectGroupNameBn }),
    authorName: t.string({ nullable: true, resolve: (r) => r.authorName }),
    publishedAt: t.exposeString("publishedAt"),
    attachments: t.field({ type: [ClassNoteAttachmentRef], resolve: (r) => r.attachments }),
  }),
});

const ClassNoteSubmissionRowRef = builder.objectRef<ClassNoteSubmissionRow>("ClassNoteSubmissionRow").implement({
  fields: (t) => ({
    groupType: t.exposeString("groupType"),
    groupId: t.exposeString("groupId"),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel ?? null }),
    classNameBn: t.string({ nullable: true, resolve: (r) => r.classNameBn }),
    sectionCode: t.string({ nullable: true, resolve: (r) => r.sectionCode }),
    sectionNameBn: t.string({ nullable: true, resolve: (r) => r.sectionNameBn }),
    subjectGroupNameBn: t.string({ nullable: true, resolve: (r) => r.subjectGroupNameBn }),
    teacherId: t.string({ nullable: true, resolve: (r) => r.teacherId }),
    teacherName: t.string({ nullable: true, resolve: (r) => r.teacherName }),
    teacherPhone: t.string({ nullable: true, resolve: (r) => r.teacherPhone }),
    teacherSchoolId: t.string({ nullable: true, resolve: (r) => r.teacherSchoolId }),
    publishedSubjects: t.stringList({ resolve: (r) => r.publishedSubjects }),
    pendingSubjects: t.stringList({ resolve: (r) => r.pendingSubjects }),
    publishedCount: t.exposeInt("publishedCount"),
    pendingCount: t.exposeInt("pendingCount"),
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
    resolve: async (_r, args, ctx) => {
      if (args.groupType !== "section" && args.groupType !== "subjectgroup") throw new Error("Invalid groupType");
      const notes = await classNotesForDate(args.groupType, args.groupId, parseDate(args.date));

      // D-#389 (owner, 2026-07-29) — the same move D-#388 made for the trackers:
      // the class teacher SEES the whole section's notes again, because the screen
      // now collapses other subjects behind a per-slot toggle instead of hiding
      // them. Hiding at the query left the section coordinator unable to see what
      // was taught in their own section at all. A plain subject teacher is still
      // narrowed to their own subjects — they have no oversight to extend.
      // Publishing stays subject-scoped in the mutation; reading is not writing.
      if (args.groupType === "section" && ctx.auth) {
        const section = await Section.findById(args.groupId).select("classId").lean();
        const classId = section?.classId ? section.classId.toString() : "";
        await assertCanRead(ctx, args.groupId, classId);
        const allowed = await allowedSubjectCodesForSection(ctx, args.groupId, classId);
        if (allowed) {
          const userId = ctx.auth.userId as string;
          // Own notes always stay visible (covers subjects missing from the
          // Subject catalog, e.g. QURAN slots).
          return notes.filter((n) => allowed.has(n.subject) || n.publishedBy.toString() === userId);
        }
      }
      return notes;
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

builder.queryField("classNoteSubmissionReport", (t) =>
  t.field({
    type: [ClassNoteSubmissionRowRef],
    authScopes: { hasPermission: "routine:manage" },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_r, args) => classNoteSubmissionReport(parseDate(args.date)),
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
      attachmentIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      publishClassNote({
        slotId: args.slotId,
        date: parseDate(args.date),
        taughtSummaryBn: args.taughtSummaryBn,
        homeworkItemId: args.homeworkItemId ?? null,
        attachmentIds: args.attachmentIds ?? null,
        actorId: ctx.auth!.userId,
        canManage: isAdminStaff(ctx.auth),
      }),
  }),
);

// --- Class-note admin (Principal/Office): list / edit / delete -------------

builder.queryField("classNotesAdmin", (t) =>
  t.field({
    type: [ClassNoteAdminRowRef],
    authScopes: { hasPermission: "routine:manage" },
    args: {
      date: t.arg.string({ required: true }),
      /** Inclusive range end (admin filters); omitted = the single `date`. */
      dateTo: t.arg.string({ required: false }),
    },
    resolve: async (_r, args) =>
      classNotesAdmin(parseDate(args.date), args.dateTo ? parseDate(args.dateTo) : undefined),
  }),
);

builder.mutationField("updateClassNote", (t) =>
  t.field({
    type: ClassNoteRef,
    authScopes: { hasPermission: "routine:manage" },
    args: {
      id: t.arg.string({ required: true }),
      taughtSummaryBn: t.arg.string({ required: false }),
      attachmentIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_r, args) =>
      updateClassNote({
        id: args.id,
        taughtSummaryBn: args.taughtSummaryBn ?? undefined,
        attachmentIds: args.attachmentIds ?? undefined,
      }),
  }),
);

const DeleteResultRef = builder.objectRef<{ id: string }>("ClassNoteDeleteResult").implement({
  fields: (t) => ({ id: t.exposeString("id") }),
});

builder.mutationField("deleteClassNote", (t) =>
  t.field({
    type: DeleteResultRef,
    authScopes: { hasPermission: "routine:manage" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, args) => deleteClassNote(args.id),
  }),
);
