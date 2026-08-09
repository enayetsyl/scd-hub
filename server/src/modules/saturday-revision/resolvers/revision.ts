/**
 * Saturday-Revision (Qur'an Hifz) resolvers (SR-1, prd-sr1 §3/§5/§6, D-#241/#242).
 *
 * RBAC — composes EXISTING permissions only (D-#17/#94, no new role/permission):
 *   - Record / edit (`recordRevisionEntry` / `editRevisionEntry`): `tracker:write`
 *     + the Quran-group scope (the teacher leads a quran-track slot for the group);
 *     Principal/Office admin via their existing reach. GUARDIAN never writes.
 *   - Reads: `tracker:read` + the Quran-group scope (teacher); Principal/Office
 *     unscoped. GUARDIAN never sees the staff revision reads.
 *
 * authScopes gate `{ authenticated: true }` (NOT a hasPermission scope) because OFFICE
 * holds neither tracker:read nor tracker:write (the CT-4-FIX/D-#196 posture) yet is an
 * admin reader/recorder here — the gate helpers below are the authority. NO delivery
 * (SR-2) / analytics (SR-3) here. Identity plane (names studentIds); no corpus path.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import { isAdminStaff } from "../../foundation/services/RoleScope";
import {
  recordEntry,
  editEntry,
  groupSaturday,
  studentRevisionHistory,
  myRevisionGroups,
  teacherTeachesGroup,
  teacherCanReadStudent,
  type RevisionEntryShape,
  type JuzRecordShape,
  type RevisionGridRow,
  type RevisionGroupShape,
  type JuzRecordInput,
} from "../services/RevisionService";

// ---------------------------------------------------------------------------
// Scope gates (the authority — authScopes is only `authenticated: true`)
// ---------------------------------------------------------------------------

function isAdmin(ctx: AppContext): boolean {
  return isAdminStaff(ctx.auth);
}

/** Write scope: P/O admin; else tracker:write + the teacher leads the group. */
async function assertCanWriteGroup(ctx: AppContext, groupId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (isAdmin(ctx)) return;
  if (ctx.auth.role === "GUARDIAN" || !callerHasPermission(ctx.auth, "tracker:write")) {
    throw new ForbiddenError("You cannot record revision for this group");
  }
  if (!(await teacherTeachesGroup(ctx.auth.userId as string, groupId))) {
    throw new ForbiddenError("You do not lead this Qur'an group");
  }
}

/** Read scope for a group grid: P/O unscoped; else tracker:read + leads the group. */
async function assertCanReadGroup(ctx: AppContext, groupId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (isAdmin(ctx)) return;
  if (ctx.auth.role === "GUARDIAN" || !callerHasPermission(ctx.auth, "tracker:read")) {
    throw new ForbiddenError("You cannot read this group's revision");
  }
  if (!(await teacherTeachesGroup(ctx.auth.userId as string, groupId))) {
    throw new ForbiddenError("You do not lead this Qur'an group");
  }
}

/** Read scope for a child's history: P/O unscoped; else tracker:read + the child is
 *  in a group the teacher leads. */
async function assertCanReadStudent(ctx: AppContext, studentId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (isAdmin(ctx)) return;
  if (ctx.auth.role === "GUARDIAN" || !callerHasPermission(ctx.auth, "tracker:read")) {
    throw new ForbiddenError("You cannot read this child's revision");
  }
  if (!(await teacherCanReadStudent(ctx.auth.userId as string, studentId))) {
    throw new ForbiddenError("This child is not in a Qur'an group you lead");
  }
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

const JuzMistakesRef = builder.objectRef<JuzRecordShape["mistakes"]>("RevisionJuzMistakes");
JuzMistakesRef.implement({
  description: "Structured tajweed-mistake counts for one juz record (SR-1).",
  fields: (t) => ({
    harf: t.exposeInt("harf"),
    ghunnah: t.exposeInt("ghunnah"),
    madd: t.exposeInt("madd"),
    other: t.exposeInt("other"),
  }),
});

const JuzRecordRef = builder.objectRef<JuzRecordShape>("RevisionJuzRecord");
JuzRecordRef.implement({
  description: "One juz heard in a revision entry: category / amount / تنبیه/فتح / mistake counts (SR-1, §3).",
  fields: (t) => ({
    juz: t.exposeInt("juz"),
    category: t.exposeString("category"),
    amountJuz: t.exposeFloat("amountJuz"),
    tanbih: t.exposeInt("tanbih"),
    fath: t.exposeInt("fath"),
    mistakes: t.field({ type: JuzMistakesRef, resolve: (r) => r.mistakes }),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
  }),
});

const RevisionEntryRef = builder.objectRef<RevisionEntryShape>("RevisionEntry");
RevisionEntryRef.implement({
  description:
    "One Saturday Hifz revision entry (SR-1): per-juz records + present/absent + comment. " +
    "Editable until delivered (SR-2), then immutable (§3/D-#242). Identity plane (ADR-005).",
  fields: (t) => ({
    id: t.exposeString("id"),
    groupId: t.exposeString("groupId"),
    studentId: t.exposeString("studentId"),
    date: t.exposeString("date"),
    present: t.exposeBoolean("present"),
    juzRecords: t.field({ type: [JuzRecordRef], resolve: (r) => r.juzRecords }),
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
  description: "One row of the group × Saturday grid: a student + their entry (null if not yet recorded).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    entry: t.field({ type: RevisionEntryRef, nullable: true, resolve: (r) => r.entry }),
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

const JuzMistakesInputType = builder.inputType("RevisionJuzMistakesInput", {
  description: "Mistake counts for one juz (each ≥ 0; defaults 0).",
  fields: (t) => ({
    harf: t.int({ required: false }),
    ghunnah: t.int({ required: false }),
    madd: t.int({ required: false }),
    other: t.int({ required: false }),
  }),
});

const JuzRecordInputType = builder.inputType("RevisionJuzRecordInput", {
  description: "One juz heard: juz 1–30, category, amount (>0), تنبیه/فتح, mistake counts, note.",
  fields: (t) => ({
    juz: t.int({ required: true }),
    category: t.string({ required: true }),
    amountJuz: t.float({ required: true }),
    tanbih: t.int({ required: false }),
    fath: t.int({ required: false }),
    mistakes: t.field({ type: JuzMistakesInputType, required: false }),
    note: t.string({ required: false }),
  }),
});

function toJuzInputs(rows: ReadonlyArray<{
  juz: number;
  category: string;
  amountJuz: number;
  tanbih?: number | null;
  fath?: number | null;
  mistakes?: { harf?: number | null; ghunnah?: number | null; madd?: number | null; other?: number | null } | null;
  note?: string | null;
}> | null | undefined): JuzRecordInput[] {
  return (rows ?? []).map((r) => ({
    juz: r.juz,
    category: r.category,
    amountJuz: r.amountJuz,
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
// Mutations (tracker:write + group scope; P/O admin)
// ---------------------------------------------------------------------------

builder.mutationField("recordRevisionEntry", (t) =>
  t.field({
    type: RevisionEntryRef,
    description:
      "Record one (student × Saturday) Hifz revision entry (J-SR1; upsert, prefilled-then-edit). " +
      "present=false ⇒ no juz records. Requires tracker:write + leading the Qur'an group. " +
      "Immutable once delivered (SR-2). Audited.",
    authScopes: { authenticated: true },
    args: {
      groupId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
      present: t.arg.boolean({ required: true }),
      juzRecords: t.arg({ type: [JuzRecordInputType], required: false }),
      teacherComment: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertCanWriteGroup(ctx, args.groupId);
      return recordEntry({
        groupId: args.groupId,
        studentId: args.studentId,
        date: new Date(args.date),
        present: args.present,
        juzRecords: toJuzInputs(args.juzRecords),
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
      "Requires tracker:write + leading the entry's Qur'an group. Audited.",
    authScopes: { authenticated: true },
    args: {
      entryId: t.arg.string({ required: true }),
      groupId: t.arg.string({ required: true }),
      present: t.arg.boolean({ required: true }),
      juzRecords: t.arg({ type: [JuzRecordInputType], required: false }),
      teacherComment: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertCanWriteGroup(ctx, args.groupId);
      return editEntry({
        entryId: args.entryId,
        present: args.present,
        juzRecords: toJuzInputs(args.juzRecords),
        teacherComment: args.teacherComment ?? undefined,
        actorId: ctx.auth!.userId as string,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries (tracker:read + group scope; P/O unscoped)
// ---------------------------------------------------------------------------

builder.queryField("groupRevisionSaturday", (t) =>
  t.field({
    type: [RevisionGridRowRef],
    description:
      "The group's active roster × a Saturday's entries — the entry grid (J-SR1). " +
      "Requires tracker:read + leading the Qur'an group (Principal/Office unscoped).",
    authScopes: { authenticated: true },
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
      "Requires tracker:read + the child being in a Qur'an group you lead (Principal/Office unscoped).",
    authScopes: { authenticated: true },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertCanReadStudent(ctx, args.studentId);
      return studentRevisionHistory(args.studentId);
    },
  }),
);

builder.queryField("myRevisionGroups", (t) =>
  t.field({
    type: [RevisionGroupRef],
    description:
      "The Hifz Qur'an groups the caller may record revision for (SR-1, RevisionHome). " +
      "Teacher → groups they lead; Principal/Office → all active Hifz groups. GUARDIAN denied.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (ctx.auth.role === "GUARDIAN") throw new ForbiddenError("Guardians cannot read staff revision groups");
      if (!isAdmin(ctx) && !callerHasPermission(ctx.auth, "tracker:read")) {
        throw new ForbiddenError("You cannot read revision groups");
      }
      return myRevisionGroups(ctx.auth.userId as string, isAdmin(ctx));
    },
  }),
);
