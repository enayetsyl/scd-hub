/**
 * Assignment gift & streak resolvers (AG-3, D-#479–#483).
 *
 * RBAC (PM, D-#790..#801; was D-#483/#667's `tracker:read` OR `gift:manage`). The
 * report takes `assignment_gift:view`, the two ticks `assignment_gift:issue` — Teacher
 * and Office both hold each by default, so the two callers below keep arriving:
 *   - a TEACHER is section-scoped in the resolver body;
 *   - the OFFICE desk — the people who physically hand the gifts out — holds the
 *     gift actions and NO homework/assignment action (D-#554 stands).
 *   - READ (`assignmentGiftReport`): a holder of `assignment_gift:view_all`
 *     (Principal/Office by default — was `isAdminStaff`) sees every class; any other
 *     caller must name a section and pass `assertCanRead` on it.
 *   - TICK (`recordGiftHandover` / `undoGiftHandover`): the section's assigned class
 *     teacher (the D-#42/#45 daily-coordinator designation), waived by
 *     `assignment_gift:view_all` (was `isAdminStaff`). `assertCanWrite` is
 *     deliberately NOT used: the office is exactly who hands out the gifts.
 *
 * Entitlement is re-derived inside the service on every tick, so the mutation
 * cannot mint a gift for a student the rule does not currently name a winner.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError, assertCanRead, type Reach } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
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

/** PM reach: `assignment_gift:view_all` replaces the isAdminStaff bypass (reads + the
 *  class-teacher designation on a tick). */
const GIFT_READ: Reach = { viewAll: "assignment_gift:view_all" };

/** Read gate: a view_all holder is unscoped; everyone else must name a section they can read. */
async function assertCanReadGiftReport(
  ctx: AppContext,
  sectionId: string | null,
  classId: string | null,
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role === "GUARDIAN") throw new ForbiddenError();
  if (callerHasPermission(ctx.auth, "assignment_gift:view_all")) return;
  if (!sectionId) {
    throw new ForbiddenError("শাখা নির্বাচন করুন — পুরো স্কুলের উপহার রিপোর্ট শুধু অধ্যক্ষ/অফিসের জন্য");
  }
  const section = await Section.findById(sectionId).select("classId").lean();
  if (!section) throw new ForbiddenError("শাখা পাওয়া যায়নি");
  await assertCanRead(ctx, sectionId, classId ?? section.classId.toString(), undefined, GIFT_READ);
}

/**
 * Tick gate: the section's assigned class teacher, or a holder of
 * `assignment_gift:view_all` (the designation waiver; Principal/Office by default). The section is
 * read off the STUDENT server-side — never taken from the caller — so scope cannot
 * be asserted on one section while ticking a student in another.
 */
async function assertCanHandOverGift(ctx: AppContext, studentId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role === "GUARDIAN") throw new ForbiddenError();
  if (callerHasPermission(ctx.auth, "assignment_gift:view_all")) return;
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
      description: "False while the due date is still ahead.",
    }),
    status: t.exposeString("status", {
      description: "WON | QUALIFIED (live, everything already in) | PENDING | LOST (D-#497).",
    }),
    issued: t.exposeInt("issued"),
    onTime: t.exposeInt("onTime"),
    outstanding: t.exposeInt("outstanding"),
    won: t.exposeBoolean("won", { description: "WON or QUALIFIED." }),
    provisional: t.exposeBoolean("provisional", {
      description: "A win the live week could still take back.",
    }),
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
    entitlementHolds: t.exposeBoolean("entitlementHolds", {
      description:
        "False when the derivation no longer names this student a winner for that week — " +
        "the handover stands as a record of what happened, but the screen flags the mismatch.",
    }),
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
    className: t.exposeString("className", {
      description: "The class's Bangla name — the heading the Office's Today card groups winners under.",
    }),
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn", {
      description: "The student's current section's Bangla name (D-#724) — the Today card groups by section.",
    }),
    weeks: t.field({ type: [GiftWeekRef], resolve: (r) => r.weeks }),
    wonWeeks: t.intList({ resolve: (r) => r.wonWeeks }),
    pendingWeeks: t.intList({
      resolve: (r) => r.pendingWeeks,
      description: "Weeks still awaiting data entry — neither a win nor a loss.",
    }),
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
    authScopes: { hasPermission: "assignment_gift:view" },
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
    authScopes: { hasPermission: "assignment_gift:issue" },
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
    authScopes: { hasPermission: "assignment_gift:issue" },
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
