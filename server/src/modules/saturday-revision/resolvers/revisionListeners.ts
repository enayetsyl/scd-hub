/**
 * Saturday-Revision SR-6 resolvers (docs/prd-sr6-listeners.md, D-#1170–#1174): weekly
 * target per Hifz level, standing listener assignment, the listener's own Saturday list,
 * and the release board.
 *
 * RBAC — catalogue actions (D-#1174):
 *   - revisionTargets (read): saturday_revision:view / :view_all / :set_target / :enter_results
 *     (a listener reads the target to mark against it).
 *   - setRevisionTarget: saturday_revision:set_target + leading a group of the level, or
 *     saturday_revision:edit_all for any level (the waiver).
 *   - revisionListenerBoard / setRevisionListener: saturday_revision:assign_listeners.
 *   - myRevisionListening: saturday_revision:enter_results (self-scoped: the caller's students).
 *   - revisionReleaseBoard / releaseRevisionSaturday: saturday_revision:release.
 * GUARDIAN never reaches any of these. Identity plane; no corpus path.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import { RevisionPortionRef } from "./revision";
import { RevisionDeliveryOutcomeRef } from "./revisionDelivery";
import type { RevisionEntryShape } from "../services/RevisionService";
import {
  revisionTargets,
  setRevisionTarget,
  teacherLevels,
  listenerBoard,
  setRevisionListener,
  myListening,
  releaseBoard,
  releaseSaturday,
  type TargetPortionShape,
  type RevisionTargetShape,
  type RevisionLevelTarget,
  type ListenerBoard,
  type ListenerBoardStudent,
  type ListenerCandidate,
  type ListeningRow,
  type ReleaseBoard,
  type ReleaseListenerProgress,
  type ReleaseRow,
  type ReleasePending,
} from "../services/RevisionListenerService";

function staff(ctx: AppContext): NonNullable<AppContext["auth"]> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role === "GUARDIAN") throw new ForbiddenError("Guardians cannot use the revision staff screens");
  return ctx.auth;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const TargetPortionRef = builder.objectRef<TargetPortionShape>("RevisionTargetPortion");
TargetPortionRef.implement({
  description: "One category's target range for a Hifz level's Saturday (SR-6, D-#1170).",
  fields: (t) => ({
    category: t.exposeString("category"),
    fromSurah: t.exposeInt("fromSurah"),
    fromAyah: t.exposeInt("fromAyah"),
    toSurah: t.exposeInt("toSurah"),
    toAyah: t.exposeInt("toAyah"),
    rangeBn: t.exposeString("rangeBn"),
  }),
});

const RevisionTargetRef = builder.objectRef<RevisionTargetShape>("RevisionTarget");
RevisionTargetRef.implement({
  description: "A Hifz level's weekly revision target — the same for every student of the level (SR-6, D-#1170).",
  fields: (t) => ({
    level: t.exposeString("level"),
    date: t.exposeString("date"),
    portions: t.field({ type: [TargetPortionRef], resolve: (r) => r.portions }),
    setByName: t.string({ nullable: true, resolve: (r) => r.setByName }),
    updatedAt: t.exposeString("updatedAt"),
  }),
});

const LevelTargetRef = builder.objectRef<RevisionLevelTarget>("RevisionLevelTarget");
LevelTargetRef.implement({
  description: "A Hifz level × a Saturday: its groups, student count, this week's target and last week's (prefill).",
  fields: (t) => ({
    level: t.exposeString("level"),
    groupNames: t.exposeStringList("groupNames"),
    studentCount: t.exposeInt("studentCount"),
    target: t.field({ type: RevisionTargetRef, nullable: true, resolve: (r) => r.target }),
    previous: t.field({ type: RevisionTargetRef, nullable: true, resolve: (r) => r.previous }),
  }),
});

const ListenerStudentRef = builder.objectRef<ListenerBoardStudent>("RevisionListenerStudent");
ListenerStudentRef.implement({
  description: "A Hifz student and the teacher who listens to their revision (null = not with anyone).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    groupId: t.exposeString("groupId"),
    groupNameBn: t.exposeString("groupNameBn"),
    level: t.exposeString("level"),
    listenerUserId: t.string({ nullable: true, resolve: (r) => r.listenerUserId }),
  }),
});

const ListenerCandidateRef = builder.objectRef<ListenerCandidate>("RevisionListenerCandidate");
ListenerCandidateRef.implement({
  description: "A staff member who may record revision results — someone a student can be given to.",
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
  }),
});

const ListenerBoardRef = builder.objectRef<ListenerBoard>("RevisionListenerBoard");
ListenerBoardRef.implement({
  description: "Every Hifz student with their standing listener, plus the people they can be given to (SR-6, D-#1171).",
  fields: (t) => ({
    students: t.field({ type: [ListenerStudentRef], resolve: (r) => r.students }),
    listeners: t.field({ type: [ListenerCandidateRef], resolve: (r) => r.listeners }),
  }),
});

/** The entry as the listening/release screens need it (same fields as RevisionEntry). */
const SrEntryRef = builder.objectRef<RevisionEntryShape>("RevisionListenEntry");
SrEntryRef.implement({
  description: "A recorded revision entry, as the SR-6 listening and release screens read it.",
  fields: (t) => ({
    id: t.exposeString("id"),
    groupId: t.exposeString("groupId"),
    studentId: t.exposeString("studentId"),
    date: t.exposeString("date"),
    present: t.exposeBoolean("present"),
    portions: t.field({ type: [RevisionPortionRef], resolve: (r) => r.portions }),
    teacherComment: t.string({ nullable: true, resolve: (r) => r.teacherComment }),
    deliveredAt: t.string({ nullable: true, resolve: (r) => r.deliveredAt }),
    inProgress: t.exposeBoolean("inProgress"),
    updatedAt: t.exposeString("updatedAt"),
  }),
});

const ListeningRowRef = builder.objectRef<ListeningRow>("RevisionListeningRow");
ListeningRowRef.implement({
  description: "One of the caller's students this Saturday: the level's target and the entry so far (SR-6, D-#1172).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    groupId: t.exposeString("groupId"),
    groupNameBn: t.exposeString("groupNameBn"),
    level: t.exposeString("level"),
    entry: t.field({ type: SrEntryRef, nullable: true, resolve: (r) => r.entry }),
    target: t.field({ type: RevisionTargetRef, nullable: true, resolve: (r) => r.target }),
  }),
});

const ReleaseProgressRef = builder.objectRef<ReleaseListenerProgress>("RevisionReleaseProgress");
ReleaseProgressRef.implement({
  description: "One listener's Saturday so far: students given to them and how many are recorded.",
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
    assigned: t.exposeInt("assigned"),
    recorded: t.exposeInt("recorded"),
  }),
});

const ReleaseRowRef = builder.objectRef<ReleaseRow>("RevisionReleaseRow");
ReleaseRowRef.implement({
  description: "A recorded, unsent entry the release would send.",
  fields: (t) => ({
    entry: t.field({ type: SrEntryRef, resolve: (r) => r.entry }),
    studentName: t.exposeString("studentName"),
    groupNameBn: t.exposeString("groupNameBn"),
    recordedByName: t.exposeString("recordedByName"),
  }),
});

const ReleasePendingRef = builder.objectRef<ReleasePending>("RevisionReleasePending");
ReleasePendingRef.implement({
  description: "A Hifz student with no entry yet this Saturday.",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    groupNameBn: t.exposeString("groupNameBn"),
    listenerName: t.string({ nullable: true, resolve: (r) => r.listenerName }),
    inProgress: t.exposeBoolean("inProgress"),
  }),
});

const ReleaseBoardRef = builder.objectRef<ReleaseBoard>("RevisionReleaseBoard");
ReleaseBoardRef.implement({
  description: "A Saturday's release board (SR-6, D-#1173): progress per listener, what is ready, what is still waiting.",
  fields: (t) => ({
    listeners: t.field({ type: [ReleaseProgressRef], resolve: (r) => r.listeners }),
    ready: t.field({ type: [ReleaseRowRef], resolve: (r) => r.ready }),
    pending: t.field({ type: [ReleasePendingRef], resolve: (r) => r.pending }),
    releasedCount: t.exposeInt("releasedCount"),
  }),
});

const TargetPortionInputType = builder.inputType("RevisionTargetPortionInput", {
  description: "One category's target range (all four surah/ayah fields).",
  fields: (t) => ({
    category: t.string({ required: true }),
    fromSurah: t.int({ required: true }),
    fromAyah: t.int({ required: true }),
    toSurah: t.int({ required: true }),
    toAyah: t.int({ required: true }),
  }),
});

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

builder.queryField("revisionTargets", (t) =>
  t.field({
    type: [LevelTargetRef],
    description: "Every Hifz level's target for a Saturday, with last week's for prefill (SR-6, D-#1170).",
    authScopes: {
      hasAnyPermission: [
        "saturday_revision:view",
        "saturday_revision:view_all",
        "saturday_revision:set_target",
        "saturday_revision:enter_results",
      ],
    },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      staff(ctx);
      return revisionTargets(new Date(args.date));
    },
  }),
);

builder.queryField("myRevisionTargetLevels", (t) =>
  t.stringList({
    description:
      "The Hifz levels the caller may declare a target for: every level with saturday_revision:edit_all, " +
      "else the levels of the Qur'an groups they lead (with saturday_revision:set_target).",
    authScopes: { hasAnyPermission: ["saturday_revision:set_target", "saturday_revision:edit_all"] },
    resolve: async (_root, _args, ctx) => {
      const auth = staff(ctx);
      if (callerHasPermission(auth, "saturday_revision:edit_all")) {
        return (await revisionTargets(new Date())).map((l) => l.level);
      }
      if (!callerHasPermission(auth, "saturday_revision:set_target")) return [];
      return teacherLevels(auth.userId as string);
    },
  }),
);

builder.mutationField("setRevisionTarget", (t) =>
  t.field({
    type: RevisionTargetRef,
    description:
      "Declare a Hifz level's target for a Saturday — every student of the level gets the same ranges " +
      "(SR-6, D-#1170). Requires saturday_revision:set_target + leading a group of the level, or " +
      "saturday_revision:edit_all. Audited.",
    authScopes: { hasAnyPermission: ["saturday_revision:set_target", "saturday_revision:edit_all"] },
    args: {
      level: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
      portions: t.arg({ type: [TargetPortionInputType], required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const auth = staff(ctx);
      if (!callerHasPermission(auth, "saturday_revision:edit_all")) {
        if (!callerHasPermission(auth, "saturday_revision:set_target")) throw new ForbiddenError("You cannot declare revision targets");
        if (!(await teacherLevels(auth.userId as string)).includes(args.level)) {
          throw new ForbiddenError("You do not lead a group of this level");
        }
      }
      return setRevisionTarget({
        level: args.level,
        date: new Date(args.date),
        portions: args.portions.map((p) => ({ ...p })),
        actorId: auth.userId as string,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Listener assignment
// ---------------------------------------------------------------------------

builder.queryField("revisionListenerBoard", (t) =>
  t.field({
    type: ListenerBoardRef,
    description: "Every Hifz student and their standing listener (SR-6, D-#1171). Requires saturday_revision:assign_listeners.",
    authScopes: { hasPermission: "saturday_revision:assign_listeners" },
    resolve: async (_root, _args, ctx) => {
      staff(ctx);
      return listenerBoard();
    },
  }),
);

builder.mutationField("setRevisionListener", (t) =>
  t.field({
    type: ListenerStudentRef,
    description:
      "Give a Hifz student to a listener (or listenerUserId null = take them away). Holds every Saturday " +
      "until changed (SR-6, D-#1171). Requires saturday_revision:assign_listeners. Audited.",
    authScopes: { hasPermission: "saturday_revision:assign_listeners" },
    args: {
      studentId: t.arg.string({ required: true }),
      listenerUserId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const auth = staff(ctx);
      return setRevisionListener({
        studentId: args.studentId,
        listenerUserId: args.listenerUserId ?? null,
        actorId: auth.userId as string,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// The listener's Saturday list
// ---------------------------------------------------------------------------

builder.queryField("myRevisionListening", (t) =>
  t.field({
    type: [ListeningRowRef],
    description:
      "The caller's students for a Saturday — each with the level's target and the entry so far (SR-6, D-#1172). " +
      "Self-scoped; requires saturday_revision:enter_results.",
    authScopes: { hasPermission: "saturday_revision:enter_results" },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const auth = staff(ctx);
      return myListening(auth.userId as string, new Date(args.date));
    },
  }),
);

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

builder.queryField("revisionReleaseBoard", (t) =>
  t.field({
    type: ReleaseBoardRef,
    description: "A Saturday's release board (SR-6, D-#1173). Requires saturday_revision:release.",
    authScopes: { hasPermission: "saturday_revision:release" },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      staff(ctx);
      return releaseBoard(new Date(args.date));
    },
  }),
);

builder.mutationField("releaseRevisionSaturday", (t) =>
  t.field({
    type: [RevisionDeliveryOutcomeRef],
    description:
      "Send every recorded, unsent Hifz entry of a Saturday (or only entryIds) to the families — inbox, push and a " +
      "wa.me link each, via SR-2 delivery (SR-6, D-#1173). Requires saturday_revision:release. Audited.",
    authScopes: { hasPermission: "saturday_revision:release" },
    args: {
      date: t.arg.string({ required: true }),
      entryIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const auth = staff(ctx);
      return releaseSaturday(new Date(args.date), auth.userId as string, args.entryIds ?? null);
    },
  }),
);
