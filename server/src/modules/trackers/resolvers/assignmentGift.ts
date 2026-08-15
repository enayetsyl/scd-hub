/**
 * Assignment gift & streak resolvers (AG-3, D-#479–#483).
 *
 * RBAC composes EXISTING permissions — no new permission, no `/shared/vocab.ts`
 * edit, therefore no two-place contract sync (D-#483):
 *   - READ (`assignmentGiftReport`): `tracker:read`. Principal/Office are
 *     unscoped staff and see every class; any other caller must name a section
 *     and pass `assertCanRead` on it — the established staff-read pattern.
 *   - TICK (`recordGiftHandover` / `undoGiftHandover`): Principal/Office
 *     (`isAdminStaff`) OR the section's assigned class teacher — the D-#42/#45
 *     daily-coordinator gate. `assertCanWrite` is deliberately NOT used: it
 *     throws for OFFICE (authz.ts), and the office is exactly who hands out the
 *     gifts.
 *
 * Entitlement is re-derived inside the service on every tick, so the mutation
 * cannot mint a gift for a student the rule does not currently name a winner.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError, assertCanRead } from "../../../middleware/authz";
import { isAdminStaff } from "../../foundation/services/RoleScope";
import { Section } from "../../foundation/models/Section";
import { Student } from "../../foundation/models/Student";
import { GIFT_AWARD_KINDS, type GiftAwardKind } from "../models/AssignmentGiftAward";
import {
  assignmentGiftReport,
  recordGiftHandover,
  undoGiftHandover,
  GIFT_STREAK_BLOCK,
  type GiftReport,
  type GiftStudentRow,
  type GiftWeek,
  type GiftMissedItem,
  type GiftAwardDTO,
} from "../services/AssignmentGiftService";

function isGiftAwardKind(s: string): s is GiftAwardKind {
  return (GIFT_AWARD_KINDS as readonly string[]).includes(s);
}

/** Read gate: admin staff unscoped; everyone else must name a section they can read. */
async function assertCanReadGiftReport(
  ctx: AppContext,
  sectionId: string | null,
  classId: string | null,
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role === "GUARDIAN") throw new ForbiddenError();
  if (isAdminStaff(ctx.auth)) return;
  if (!sectionId) {
    throw new ForbiddenError("শাখা নির্বাচন করুন — পুরো স্কুলের উপহার রিপোর্ট শুধু অধ্যক্ষ/অফিসের জন্য");
  }
  const section = await Section.findById(sectionId).select("classId").lean();
  if (!section) throw new ForbiddenError("শাখা পাওয়া যায়নি");
  await assertCanRead(ctx, sectionId, classId ?? section.classId.toString());
}

/**
 * Tick gate: admin staff, or the section's assigned class teacher. The section is
 * read off the STUDENT server-side — never taken from the caller — so scope cannot
 * be asserted on one section while ticking a student in another.
 */
async function assertCanHandOverGift(ctx: AppContext, studentId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role === "GUARDIAN") throw new ForbiddenError();
  if (isAdminStaff(ctx.auth)) return;
  const student = await Student.findById(studentId).select("sectionId").lean();
  if (!student) throw new ForbiddenError("শিক্ষার্থী পাওয়া যায়নি");
  const section = await Section.findById(student.sectionId).select("classTeacherId").lean();
  const ctId = section?.classTeacherId ? section.classTeacherId.toString() : null;
  if (!ctId || ctId !== ctx.auth.userId) {
    throw new ForbiddenError("উপহার হস্তান্তর শুধু অধ্যক্ষ/অফিস বা শাখার শ্রেণিশিক্ষক করতে পারেন");
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const GiftMissedItemRef = builder.objectRef<GiftMissedItem>("GiftMissedItem").implement({
  description: "An assignment the student did not get in on time — the 'why they lost the week' detail.",
  fields: (t) => ({
    asId: t.exposeString("asId"),
    subject: t.exposeString("subject"),
    state: t.exposeString("state"),
    lateSubmission: t.exposeBoolean("lateSubmission", {
      description: "Submitted, but after the due date — distinct from never submitted.",
    }),
  }),
});

const GiftWeekRef = builder.objectRef<GiftWeek>("GiftWeek").implement({
  description: "One student's result for one week.",
  fields: (t) => ({
    weekNumber: t.exposeInt("weekNumber"),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
    settled: t.exposeBoolean("settled", {
      description: "False while the due date is still ahead — PENDING, never a loss (D-#481).",
    }),
    issued: t.exposeInt("issued"),
    onTime: t.exposeInt("onTime"),
    won: t.exposeBoolean("won"),
    missed: t.field({ type: [GiftMissedItemRef], resolve: (r) => r.missed }),
  }),
});

const GiftAwardRef = builder.objectRef<GiftAwardDTO>("GiftAward").implement({
  description: "A recorded physical handover (AG-2) — the only stored state in the module.",
  fields: (t) => ({
    id: t.exposeString("id"),
    kind: t.exposeString("kind"),
    weekNumber: t.exposeInt("weekNumber"),
    streakLength: t.int({ nullable: true, resolve: (r) => r.streakLength }),
    handedOverAt: t.string({ resolve: (r) => r.handedOverAt.toISOString() }),
    handedOverBy: t.exposeString("handedOverBy"),
    handedOverByName: t.string({ nullable: true, resolve: (r) => r.handedOverByName }),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
  }),
});

const GiftStudentRowRef = builder.objectRef<GiftStudentRow>("GiftStudentRow").implement({
  description:
    "One student's gift standing. `currentStreak` rolls unbroken; `streakMilestoneWeeks` are the " +
    "completed 4-week blocks — the higher-gift entitlements (D-#483).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    schoolId: t.exposeString("schoolId"),
    rollNumber: t.string({ nullable: true, resolve: (r) => r.rollNumber }),
    classId: t.exposeString("classId"),
    sectionId: t.exposeString("sectionId"),
    weeks: t.field({ type: [GiftWeekRef], resolve: (r) => r.weeks }),
    wonWeeks: t.intList({ resolve: (r) => r.wonWeeks }),
    currentStreak: t.exposeInt("currentStreak"),
    bestStreak: t.exposeInt("bestStreak"),
    streakMilestoneWeeks: t.intList({ resolve: (r) => r.streakMilestoneWeeks }),
    awards: t.field({ type: [GiftAwardRef], resolve: (r) => r.awards }),
  }),
});

const GiftWeekDueRef = builder
  .objectRef<GiftReport["weekDueDates"][number]>("GiftWeekDue")
  .implement({
    description: "The window header: each week's due date and whether it is judged yet.",
    fields: (t) => ({
      weekNumber: t.exposeInt("weekNumber"),
      dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
      settled: t.exposeBoolean("settled"),
    }),
  });

const GiftReportRef = builder.objectRef<GiftReport>("AssignmentGiftReport").implement({
  description:
    "Weekly gift winners + 4-week streaks, derived on read from the assignment tracker (D-#479). " +
    "Nothing about a winner is stored; only the handover is.",
  fields: (t) => ({
    academicYearId: t.exposeString("academicYearId"),
    weekFrom: t.exposeInt("weekFrom"),
    weekTo: t.exposeInt("weekTo"),
    streakBlock: t.int({
      description: "Weeks per higher gift (4).",
      resolve: () => GIFT_STREAK_BLOCK,
    }),
    weekDueDates: t.field({ type: [GiftWeekDueRef], resolve: (r) => r.weekDueDates }),
    students: t.field({ type: [GiftStudentRowRef], resolve: (r) => r.students }),
  }),
});

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

builder.queryField("assignmentGiftReport", (t) =>
  t.field({
    type: GiftReportRef,
    description:
      "Who submitted every Thursday-given assignment by its Sunday (weekly gift) and who has a " +
      "4-week run (higher gift). Principal/Office see every class; a teacher must name a section " +
      "they can read.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      weekFrom: t.arg.int({ required: false }),
      weekTo: t.arg.int({ required: false }),
      classId: t.arg.string({ required: false }),
      sectionId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertCanReadGiftReport(ctx, args.sectionId ?? null, args.classId ?? null);
      return assignmentGiftReport({
        academicYearId: args.academicYearId,
        weekFrom: args.weekFrom ?? undefined,
        weekTo: args.weekTo ?? undefined,
        classId: args.classId ?? undefined,
        sectionId: args.sectionId ?? undefined,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("recordGiftHandover", (t) =>
  t.field({
    type: GiftAwardRef,
    description:
      "Record that the gift was physically given. Entitlement is RE-DERIVED here and the call is " +
      "refused if the student is not currently a winner for that week (D-#479). Idempotent.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      kind: t.arg.string({ required: true, description: "WEEKLY | STREAK" }),
      weekNumber: t.arg.int({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (!isGiftAwardKind(args.kind)) throw new ForbiddenError(`অজানা উপহারের ধরন: ${args.kind}`);
      await assertCanHandOverGift(ctx, args.studentId);
      return recordGiftHandover({
        academicYearId: args.academicYearId,
        studentId: args.studentId,
        kind: args.kind,
        weekNumber: args.weekNumber,
        note: args.note ?? undefined,
        handedOverBy: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("undoGiftHandover", (t) =>
  t.boolean({
    description: "Undo a mis-tick. True when a handover row was actually removed.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      kind: t.arg.string({ required: true, description: "WEEKLY | STREAK" }),
      weekNumber: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!isGiftAwardKind(args.kind)) throw new ForbiddenError(`অজানা উপহারের ধরন: ${args.kind}`);
      await assertCanHandOverGift(ctx, args.studentId);
      return undoGiftHandover(args.academicYearId, args.studentId, args.kind, args.weekNumber);
    },
  }),
);
