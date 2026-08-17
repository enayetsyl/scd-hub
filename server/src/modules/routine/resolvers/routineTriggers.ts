/**
 * Routine module — R-5 resolvers (bell-schedule trigger + class-note/daily-diary).
 *
 * The trigger SCHEDULE is computed here; delivery (push) rides the deferred
 * messaging pipeline (D-#52). Reads gated `routine:read`; bell-duty assignment is
 * `routine:manage`; class-note publish is `routine:read` (authorized in-service to
 * the slot's teacher / cover / admin).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { assertCanRead, assertCanWrite, allowedSubjectCodesForSection, ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import { Section } from "../../foundation/models/Section";
import { Subject } from "../../foundation/models/Subject";
import {
  resolveNoteHomeworkTarget,
  resolveClassNoteHomework,
  type NoteHomeworkTarget,
} from "../services/ClassNoteHomeworkService";
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
  resolveNoteAuthorization,
  classNotesForDate,
  classNoteSubmissionReport,
  myClassNotePrompts,
  updateClassNote,
  deleteClassNote,
  classNotesAdmin,
  classNotePage,
  classNoteFilterOptions,
  type ClassNoteSubmissionRow,
  type ClassNoteAdminRow,
  type ClassNoteAttachmentView,
  type ClassNotePage,
  type ClassNoteFilterOption,
  type ClassNoteFilterOptions,
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
    sectionId: t.string({ nullable: true, resolve: (r) => r.sectionId }),
    classId: t.string({ nullable: true, resolve: (r) => r.classId }),
    authorId: t.string({ nullable: true, resolve: (r) => r.authorId }),
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

async function resolveSubjectIdByCode(code: string): Promise<string> {
  const doc = await Subject.findOne({ code }).select("_id").lean();
  if (!doc) throw new Error(`Subject not found: ${code}`);
  return doc._id.toString();
}

/**
 * DE-3 (D-#477): the day's homework, declared from inside the class note.
 *
 * `mode` travels as a validated String (house pattern — no new GraphQL enum, no
 * `/shared/vocab.ts` change, no contract sync). DECLARE carries the same fields
 * `declareHomeworkItem` already takes; NIL carries the D-#299 reason.
 */
const ClassNoteHomeworkInput = builder.inputType("ClassNoteHomeworkInput", {
  fields: (t) => ({
    mode: t.string({ required: true }), // DECLARE | NIL
    topTags: t.stringList({ required: false }),
    description: t.string({ required: false }),
    qCount: t.int({ required: false }),
    timeDecl: t.int({ required: false }),
    poolRef: t.string({ required: false }),
    revItem: t.boolean({ required: false }),
    attachmentIds: t.stringList({ required: false }),
    reason: t.string({ required: false }), // NIL only
  }),
});

/**
 * The homework half is gated SEPARATELY from the note (D-#477): publishing a note is
 * `routine:read`, but declaring homework is `tracker:write` + section/subject
 * write-scope. A cover teacher legitimately holds the first without the second, so
 * inheriting one gate for both would quietly widen who can write to the tracker.
 */
async function gateNoteHomework(ctx: AppContext, target: NoteHomeworkTarget): Promise<void> {
  if (!ctx.auth || !callerHasPermission(ctx.auth, "tracker:write")) {
    throw new ForbiddenError("Declaring homework needs tracker:write");
  }
  await assertCanWrite(ctx, target.sectionId, await resolveSubjectIdByCode(target.subject));
}

builder.mutationField("publishClassNote", (t) =>
  t.field({
    type: ClassNoteRef,
    description:
      "Publish a class note. DE-3 (D-#477): the optional `homework` payload declares the day's " +
      "homework (or a nil declaration) through the EXISTING tracker services and links it, so a " +
      "teacher enters the period once. The homework half is gated separately (tracker:write).",
    authScopes: { hasPermission: "routine:read" },
    args: {
      slotId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
      taughtSummaryBn: t.arg.string({ required: true }),
      homeworkItemId: t.arg.string({ required: false }),
      attachmentIds: t.arg.stringList({ required: false }),
      homework: t.arg({ type: ClassNoteHomeworkInput, required: false }),
    },
    resolve: async (_r, args, ctx) => {
      const date = parseDate(args.date);
      // Order matters (D-#477): the note's own authorization runs FIRST, so a caller
      // who may not write this note never declares homework as a side effect. Then
      // the homework, then the note upsert — both idempotent, so a partial failure
      // self-heals on the next tap instead of needing a cross-collection transaction.
      const slot = await resolveNoteAuthorization({
        slotId: args.slotId,
        date,
        actorId: ctx.auth!.userId,
        canManage: isAdminStaff(ctx.auth),
      });
      let linkedItemId = args.homeworkItemId ?? null;
      if (args.homework) {
        // Ids come from the SLOT, never from the client — a forged sectionId cannot
        // move the declaration to a section the caller happens to have scope on.
        const target = await resolveNoteHomeworkTarget(slot);
        await gateNoteHomework(ctx, target);
        linkedItemId = await resolveClassNoteHomework({
          target,
          date,
          hw: args.homework,
          actorId: ctx.auth!.userId,
        });
      }
      return publishClassNote({
        slotId: args.slotId,
        date,
        taughtSummaryBn: args.taughtSummaryBn,
        homeworkItemId: linkedItemId,
        attachmentIds: args.attachmentIds ?? null,
        actorId: ctx.auth!.userId,
        canManage: isAdminStaff(ctx.auth),
      });
    },
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

// --- The class-note archive: filtered + paginated list (owner ask 2026-08-17) ---

/**
 * Who the caller may see. Principal/Office (`routine:manage`) read the whole
 * school and may pick a teacher; anyone else is PINNED to their own notes — the
 * client's `teacherId` is ignored rather than trusted, so a forged argument can
 * never widen the slice.
 */
function classNoteScopeTeacherId(ctx: AppContext, requested?: string | null): string | null {
  if (ctx.auth && callerHasPermission(ctx.auth, "routine:manage")) return requested ?? null;
  return ctx.auth!.userId;
}

const ClassNotePageRef = builder.objectRef<ClassNotePage>("ClassNotePage").implement({
  fields: (t) => ({
    rows: t.field({ type: [ClassNoteAdminRowRef], resolve: (p) => p.rows }),
    total: t.exposeInt("total"),
    page: t.exposeInt("page"),
    pageSize: t.exposeInt("pageSize"),
  }),
});

builder.queryField("classNotesPage", (t) =>
  t.field({
    type: ClassNotePageRef,
    description:
      "The class-note archive: class/section/subject/teacher/date filters, newest first, " +
      "50 rows a page. routine:manage sees the school; every other caller sees their own notes.",
    authScopes: { hasPermission: "routine:read" },
    args: {
      from: t.arg.string({ required: false }),
      to: t.arg.string({ required: false }),
      classId: t.arg.string({ required: false }),
      sectionId: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      teacherId: t.arg.string({ required: false }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      classNotePage({
        from: args.from ? parseDate(args.from) : null,
        to: args.to ? parseDate(args.to) : null,
        classId: args.classId ?? null,
        sectionId: args.sectionId ?? null,
        subject: args.subject ?? null,
        teacherId: classNoteScopeTeacherId(ctx, args.teacherId),
        page: args.page ?? null,
        pageSize: args.pageSize ?? null,
      }),
  }),
);

const ClassNoteFilterOptionRef = builder.objectRef<ClassNoteFilterOption & { parentId?: string | null }>(
  "ClassNoteFilterOption",
).implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    label: t.exposeString("label"),
    parentId: t.string({ nullable: true, resolve: (o) => o.parentId ?? null }),
  }),
});

const ClassNoteFilterOptionsRef = builder.objectRef<ClassNoteFilterOptions & { canManage: boolean }>(
  "ClassNoteFilterOptions",
).implement({
  fields: (t) => ({
    classes: t.field({ type: [ClassNoteFilterOptionRef], resolve: (o) => o.classes }),
    sections: t.field({ type: [ClassNoteFilterOptionRef], resolve: (o) => o.sections }),
    subjects: t.stringList({ resolve: (o) => o.subjects }),
    teachers: t.field({ type: [ClassNoteFilterOptionRef], resolve: (o) => o.teachers }),
    /** The caller reads the whole school (and so may edit/delete any row). */
    canManage: t.exposeBoolean("canManage"),
  }),
});

builder.queryField("classNoteFilterOptions", (t) =>
  t.field({
    type: ClassNoteFilterOptionsRef,
    description: "Filter values that exist in the caller's slice of the class-note archive.",
    authScopes: { hasPermission: "routine:read" },
    resolve: async (_r, _args, ctx) => {
      const canManage = !!ctx.auth && callerHasPermission(ctx.auth, "routine:manage");
      const options = await classNoteFilterOptions({ teacherId: canManage ? null : ctx.auth!.userId });
      return { ...options, canManage };
    },
  }),
);

builder.mutationField("updateClassNote", (t) =>
  t.field({
    type: ClassNoteRef,
    description:
      "Edit a note's summary/attachments. routine:manage edits any note; every other caller " +
      "edits only the note they authored (checked in-service against publishedBy).",
    authScopes: { hasPermission: "routine:read" },
    args: {
      id: t.arg.string({ required: true }),
      taughtSummaryBn: t.arg.string({ required: false }),
      attachmentIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      updateClassNote({
        id: args.id,
        taughtSummaryBn: args.taughtSummaryBn ?? undefined,
        attachmentIds: args.attachmentIds ?? undefined,
        actorId: ctx.auth!.userId,
        canManage: !!ctx.auth && callerHasPermission(ctx.auth, "routine:manage"),
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
