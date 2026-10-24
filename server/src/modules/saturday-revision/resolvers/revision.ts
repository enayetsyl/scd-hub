/**
 * Saturday-Revision (Qur'an Hifz) resolvers (SR-1, prd-sr1 §3/§5/§6, D-#241/#242).
 *
 * RBAC — the `saturday_revision:*` catalogue actions (PM, D-#790–#801):
 *   - Record / edit (`recordRevisionEntry` / `editRevisionEntry`):
 *     `saturday_revision:enter_results` + the Quran-group scope (the teacher leads a
 *     quran-track slot for the group), or `saturday_revision:edit_all` (Principal/
 *     Office by default) for any group. GUARDIAN never writes.
 *   - Reads: `saturday_revision:view` + the Quran-group scope (teacher), or
 *     `saturday_revision:view_all` (Principal/Office by default) unscoped. GUARDIAN
 *     never sees the staff revision reads.
 *
 * authScopes name the action OR its reach (`hasAnyPermission`); the gate helpers below
 * then apply the group-lead designation unless the reach action is held. NO delivery
 * (SR-2) / analytics (SR-3) here. Identity plane (names studentIds); no corpus path.
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import type { AppContext } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import {
  recordEntry,
  editEntry,
  groupSaturday,
  studentRevisionHistory,
  studentRevisionHistoryPage,
  myRevisionGroups,
  teacherTeachesGroup,
  teacherCanReadStudent,
  type RevisionEntryShape,
  type RevisionPortionShape,
  type RevisionGridRow,
  type RevisionGroupShape,
  type PortionInput,
} from "../services/RevisionService";

// ---------------------------------------------------------------------------
// Scope gates (the designation; authScopes name the action or its reach)
// ---------------------------------------------------------------------------

/** Reads beyond the caller's own groups (was the isAdminStaff read bypass). */
function canViewAll(ctx: AppContext): boolean {
  return !!ctx.auth && callerHasPermission(ctx.auth, "saturday_revision:view_all");
}

/** Writes on any group (was the isAdminStaff write bypass). */
function canEditAll(ctx: AppContext): boolean {
  return !!ctx.auth && callerHasPermission(ctx.auth, "saturday_revision:edit_all");
}

/** Write scope: edit_all; else enter_results + the teacher leads the group. */
async function assertCanWriteGroup(ctx: AppContext, groupId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (canEditAll(ctx)) return;
  if (ctx.auth.role === "GUARDIAN" || !callerHasPermission(ctx.auth, "saturday_revision:enter_results")) {
    throw new ForbiddenError("You cannot record revision for this group");
  }
  if (!(await teacherTeachesGroup(ctx.auth.userId as string, groupId))) {
    throw new ForbiddenError("You do not lead this Qur'an group");
  }
}

/** Read scope for a group grid: view_all unscoped; else view + leads the group. */
async function assertCanReadGroup(ctx: AppContext, groupId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (canViewAll(ctx)) return;
  if (ctx.auth.role === "GUARDIAN" || !callerHasPermission(ctx.auth, "saturday_revision:view")) {
    throw new ForbiddenError("You cannot read this group's revision");
  }
  if (!(await teacherTeachesGroup(ctx.auth.userId as string, groupId))) {
    throw new ForbiddenError("You do not lead this Qur'an group");
  }
}

/** Read scope for a child's history: view_all unscoped; else view + the child is
 *  in a group the teacher leads. */
async function assertCanReadStudent(ctx: AppContext, studentId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (canViewAll(ctx)) return;
  if (ctx.auth.role === "GUARDIAN" || !callerHasPermission(ctx.auth, "saturday_revision:view")) {
    throw new ForbiddenError("You cannot read this child's revision");
  }
  if (!(await teacherCanReadStudent(ctx.auth.userId as string, studentId))) {
    throw new ForbiddenError("This child is not in a Qur'an group you lead");
  }
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

export const PortionMistakesRef = builder.objectRef<RevisionPortionShape["mistakes"]>("RevisionPortionMistakes");
PortionMistakesRef.implement({
  description: "Structured tajweed-mistake counts for one revision portion (SR-5, D-#836).",
  fields: (t) => ({
    harf: t.exposeInt("harf"),
    ghunnah: t.exposeInt("ghunnah"),
    madd: t.exposeInt("madd"),
    other: t.exposeInt("other"),
  }),
});

export const RevisionPortionRef = builder.objectRef<RevisionPortionShape>("RevisionPortion");
RevisionPortionRef.implement({
  description:
    "One portion heard in a revision entry (SR-5, D-#833): category, a surah:ayah range in mushaf order " +
    "(null on a range-less NOT_DONE), status, تنبیه/فتح and mistake counts. ayahs/juzs are derived.",
  fields: (t) => ({
    category: t.exposeString("category"),
    status: t.exposeString("status"),
    fromSurah: t.int({ nullable: true, resolve: (r) => r.fromSurah }),
    fromAyah: t.int({ nullable: true, resolve: (r) => r.fromAyah }),
    toSurah: t.int({ nullable: true, resolve: (r) => r.toSurah }),
    toAyah: t.int({ nullable: true, resolve: (r) => r.toAyah }),
    rangeBn: t.string({ nullable: true, resolve: (r) => r.rangeBn }),
    ayahs: t.exposeInt("ayahs"),
    juzs: t.exposeIntList("juzs"),
    tanbih: t.exposeInt("tanbih"),
    fath: t.exposeInt("fath"),
    mistakes: t.field({ type: PortionMistakesRef, resolve: (r) => r.mistakes }),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
  }),
});

const RevisionEntryRef = builder.objectRef<RevisionEntryShape>("RevisionEntry");
RevisionEntryRef.implement({
  description:
    "One Saturday Hifz revision entry (SR-1/SR-5): portions (surah:ayah ranges) + present/absent + comment. " +
    "Editable until delivered (SR-2), then immutable (§3/D-#242). Identity plane (ADR-005).",
  fields: (t) => ({
    id: t.exposeString("id"),
    groupId: t.exposeString("groupId"),
    studentId: t.exposeString("studentId"),
    date: t.exposeString("date"),
    present: t.exposeBoolean("present"),
    portions: t.field({ type: [RevisionPortionRef], resolve: (r) => r.portions }),
    teacherComment: t.string({ nullable: true, resolve: (r) => r.teacherComment }),
    teacherUserId: t.exposeString("teacherUserId"),
    deliveredAt: t.string({ nullable: true, resolve: (r) => r.deliveredAt }),
    deliveryChannels: t.exposeStringList("deliveryChannels"),
    createdAt: t.exposeString("createdAt"),
    updatedAt: t.exposeString("updatedAt"),
  }),
});

const RevisionGridRowRef = builder.objectRef<RevisionGridRow>("RevisionGridRow");
RevisionGridRowRef.implement({
  description:
    "One row of the group × Saturday grid: a student + their entry (null if not yet recorded) + their latest " +
    "earlier entry (the prefill source, SR-5).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    entry: t.field({ type: RevisionEntryRef, nullable: true, resolve: (r) => r.entry }),
    previous: t.field({ type: RevisionEntryRef, nullable: true, resolve: (r) => r.previous }),
  }),
});

const RevisionGroupRef = builder.objectRef<RevisionGroupShape>("RevisionGroup");
RevisionGroupRef.implement({
  description: "A Hifz Qur'an SubjectGroup the caller may record revision for (SR-1, RevisionHome).",
  fields: (t) => ({
    id: t.exposeString("id"),
    code: t.exposeString("code"),
    nameBn: t.exposeString("nameBn"),
    level: t.exposeString("level"),
    gender: t.exposeString("gender"),
  }),
});

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

const PortionMistakesInputType = builder.inputType("RevisionPortionMistakesInput", {
  description: "Mistake counts for one portion (each ≥ 0; defaults 0).",
  fields: (t) => ({
    harf: t.int({ required: false }),
    ghunnah: t.int({ required: false }),
    madd: t.int({ required: false }),
    other: t.int({ required: false }),
  }),
});

const PortionInputType = builder.inputType("RevisionPortionInput", {
  description:
    "One portion heard: category, status, the start/end surah:ayah (all four, or none on NOT_DONE), " +
    "تنبیه/فتح, mistake counts, note.",
  fields: (t) => ({
    category: t.string({ required: true }),
    status: t.string({ required: true }),
    fromSurah: t.int({ required: false }),
    fromAyah: t.int({ required: false }),
    toSurah: t.int({ required: false }),
    toAyah: t.int({ required: false }),
    tanbih: t.int({ required: false }),
    fath: t.int({ required: false }),
    mistakes: t.field({ type: PortionMistakesInputType, required: false }),
    note: t.string({ required: false }),
  }),
});

function toPortionInputs(rows: ReadonlyArray<{
  category: string;
  status: string;
  fromSurah?: number | null;
  fromAyah?: number | null;
  toSurah?: number | null;
  toAyah?: number | null;
  tanbih?: number | null;
  fath?: number | null;
  mistakes?: { harf?: number | null; ghunnah?: number | null; madd?: number | null; other?: number | null } | null;
  note?: string | null;
}> | null | undefined): PortionInput[] {
  return (rows ?? []).map((r) => ({
    category: r.category,
    status: r.status,
    fromSurah: r.fromSurah ?? undefined,
    fromAyah: r.fromAyah ?? undefined,
    toSurah: r.toSurah ?? undefined,
    toAyah: r.toAyah ?? undefined,
    tanbih: r.tanbih ?? undefined,
    fath: r.fath ?? undefined,
    mistakes: r.mistakes
      ? {
          harf: r.mistakes.harf ?? undefined,
          ghunnah: r.mistakes.ghunnah ?? undefined,
          madd: r.mistakes.madd ?? undefined,
          other: r.mistakes.other ?? undefined,
        }
      : undefined,
    note: r.note ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// Mutations (saturday_revision:enter_results + group scope; or :edit_all)
// ---------------------------------------------------------------------------

builder.mutationField("recordRevisionEntry", (t) =>
  t.field({
    type: RevisionEntryRef,
    description:
      "Record one (student × Saturday) Hifz revision entry (J-SR1; upsert, prefilled-then-edit). " +
      "present=false ⇒ no portions. Requires saturday_revision:enter_results + leading the Qur'an group. " +
      "Immutable once delivered (SR-2). Audited.",
    authScopes: { hasAnyPermission: ["saturday_revision:enter_results", "saturday_revision:edit_all"] },
    args: {
      groupId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
      present: t.arg.boolean({ required: true }),
      portions: t.arg({ type: [PortionInputType], required: false }),
      teacherComment: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertCanWriteGroup(ctx, args.groupId);
      return recordEntry({
        groupId: args.groupId,
        studentId: args.studentId,
        date: new Date(args.date),
        present: args.present,
        portions: toPortionInputs(args.portions),
        teacherComment: args.teacherComment ?? undefined,
        actorId: ctx.auth!.userId as string,
      });
    },
  }),
);

builder.mutationField("editRevisionEntry", (t) =>
  t.field({
    type: RevisionEntryRef,
    description:
      "Edit an existing revision entry by id (J-SR1-4; refused once delivered). " +
      "Requires saturday_revision:enter_results + leading the entry's Qur'an group. Audited.",
    authScopes: { hasAnyPermission: ["saturday_revision:enter_results", "saturday_revision:edit_all"] },
    args: {
      entryId: t.arg.string({ required: true }),
      groupId: t.arg.string({ required: true }),
      present: t.arg.boolean({ required: true }),
      portions: t.arg({ type: [PortionInputType], required: false }),
      teacherComment: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertCanWriteGroup(ctx, args.groupId);
      return editEntry({
        entryId: args.entryId,
        present: args.present,
        portions: toPortionInputs(args.portions),
        teacherComment: args.teacherComment ?? undefined,
        actorId: ctx.auth!.userId as string,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries (saturday_revision:view + group scope; :view_all unscoped)
// ---------------------------------------------------------------------------

builder.queryField("groupRevisionSaturday", (t) =>
  t.field({
    type: [RevisionGridRowRef],
    description:
      "The group's active roster × a Saturday's entries — the entry grid (J-SR1). " +
      "Requires saturday_revision:view + leading the Qur'an group (Principal/Office unscoped).",
    authScopes: { hasAnyPermission: ["saturday_revision:view", "saturday_revision:view_all"] },
    args: {
      groupId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertCanReadGroup(ctx, args.groupId);
      return groupSaturday(args.groupId, new Date(args.date));
    },
  }),
);

builder.queryField("studentRevisionHistory", (t) =>
  t.field({
    type: [RevisionEntryRef],
    description:
      "A child's Hifz revision history, newest first (SR-1; staff timeline). " +
      "Requires saturday_revision:view + the child being in a Qur'an group you lead (Principal/Office unscoped).",
    authScopes: { hasAnyPermission: ["saturday_revision:view", "saturday_revision:view_all"] },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertCanReadStudent(ctx, args.studentId);
      return studentRevisionHistory(args.studentId);
    },
  }),
);

// D-#761: one entry per Saturday, forever — page the staff timeline.
const RevisionEntryPageRef = pageRef("RevisionEntryPage", RevisionEntryRef);

builder.queryField("studentRevisionHistoryPage", (t) =>
  t.field({
    type: RevisionEntryPageRef,
    description:
      "studentRevisionHistory, one page at a time, newest first (D-#761). Same gate: saturday_revision:view + " +
      "the child being in a Qur'an group you lead (Principal/Office unscoped).",
    authScopes: { hasAnyPermission: ["saturday_revision:view", "saturday_revision:view_all"] },
    args: {
      studentId: t.arg.string({ required: true }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertCanReadStudent(ctx, args.studentId);
      return studentRevisionHistoryPage(args.studentId, args);
    },
  }),
);

builder.queryField("myRevisionGroups", (t) =>
  t.field({
    type: [RevisionGroupRef],
    description:
      "The Hifz Qur'an groups the caller may record revision for (SR-1, RevisionHome). " +
      "Teacher → groups they lead; Principal/Office → all active Hifz groups. GUARDIAN denied.",
    authScopes: { hasAnyPermission: ["saturday_revision:view", "saturday_revision:view_all"] },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (ctx.auth.role === "GUARDIAN") throw new ForbiddenError("Guardians cannot read staff revision groups");
      if (!canViewAll(ctx) && !callerHasPermission(ctx.auth, "saturday_revision:view")) {
        throw new ForbiddenError("You cannot read revision groups");
      }
      return myRevisionGroups(ctx.auth.userId as string, canViewAll(ctx));
    },
  }),
);
