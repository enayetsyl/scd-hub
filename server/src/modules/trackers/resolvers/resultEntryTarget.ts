/**
 * Result-entry-target resolvers (owner ask 2026-10-14, D-#739). `myResultEntryTarget` is
 * the caller's OWN progress on a fixed class-test result backlog with a promised finish
 * day — null for everyone without a target, so the Today card renders for that teacher
 * alone. `setResultEntryTarget` is Principal-only. Identity/operational plane — no
 * corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  resultEntryTargetProgress,
  setResultEntryTarget,
  type EntryTargetDay,
  type EntryTargetLine,
  type EntryTargetProgress,
} from "../services/ResultEntryTargetService";

const DayRef = builder.objectRef<EntryTargetDay>("ResultEntryTargetDay").implement({
  description: "One day of a teacher's result-backlog running total (or a planned day still to come).",
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    working: t.exposeBoolean("working"),
    entered: t.exposeInt("entered"),
    cumulative: t.exposeInt("cumulative"),
    expected: t.exposeInt("expected"),
    diff: t.exposeInt("diff"),
    isToday: t.exposeBoolean("isToday"),
    future: t.exposeBoolean("future"),
  }),
});

const LineRef = builder.objectRef<EntryTargetLine>("ResultEntryTargetLine").implement({
  description: "One group/level of the backlog: students × tests, entered so far, and backlog tests found.",
  fields: (t) => ({
    label: t.exposeString("label"),
    students: t.exposeInt("students"),
    tests: t.exposeInt("tests"),
    total: t.exposeInt("total"),
    entered: t.exposeInt("entered"),
    remaining: t.exposeInt("remaining"),
    testsFound: t.exposeInt("testsFound"),
  }),
});

const ProgressRef = builder.objectRef<EntryTargetProgress>("ResultEntryTargetProgress").implement({
  description:
    "The caller's progress on a fixed class-test result backlog: per-level counts, the target spread evenly " +
    "over the working days to the due day, how far behind (negative) or ahead (positive) as of yesterday, and " +
    "what today and each remaining day need.",
  fields: (t) => ({
    subject: t.exposeString("subject"),
    startKey: t.exposeString("startKey"),
    dueKey: t.exposeString("dueKey"),
    todayKey: t.exposeString("todayKey"),
    total: t.exposeInt("total"),
    enteredTotal: t.exposeInt("enteredTotal"),
    remaining: t.exposeInt("remaining"),
    lines: t.field({ type: [LineRef], resolve: (p) => p.lines }),
    days: t.field({ type: [DayRef], resolve: (p) => p.days }),
    enteredThroughYesterday: t.exposeInt("enteredThroughYesterday"),
    expectedThroughYesterday: t.exposeInt("expectedThroughYesterday"),
    diffThroughYesterday: t.exposeInt("diffThroughYesterday"),
    todayWorking: t.exposeBoolean("todayWorking"),
    todayEntered: t.exposeInt("todayEntered"),
    todayTarget: t.exposeInt("todayTarget"),
    neededToday: t.exposeInt("neededToday"),
    workingDaysLeft: t.exposeInt("workingDaysLeft"),
    perDayToFinish: t.exposeInt("perDayToFinish"),
    done: t.exposeBoolean("done"),
    overdue: t.exposeBoolean("overdue"),
  }),
});

const LineInput = builder.inputType("ResultEntryTargetLineInput", {
  fields: (t) => ({
    label: t.string({ required: true }),
    subjectGroupIds: t.stringList({ required: true }),
    students: t.int({ required: true }),
    tests: t.int({ required: true }),
  }),
});

builder.queryField("myResultEntryTarget", (t) =>
  t.field({
    type: ProgressRef,
    nullable: true,
    description: "The caller's result-backlog progress, or null when they have no active target.",
    authScopes: { authenticated: true },
    resolve: async (_r, _a, ctx) => (ctx.auth ? resultEntryTargetProgress(ctx.auth.userId) : null),
  }),
);

builder.mutationField("setResultEntryTarget", (t) =>
  t.field({
    type: "Boolean",
    description: "Set, change or switch off a teacher's class-test result backlog target. PRINCIPAL only.",
    authScopes: { authenticated: true },
    args: {
      userId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      lines: t.arg({ type: [LineInput], required: true }),
      startKey: t.arg.string({ required: true }),
      dueKey: t.arg.string({ required: true }),
      weekdays: t.arg.intList({ required: false }),
      active: t.arg.boolean({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      if (ctx.auth?.role !== "PRINCIPAL") throw new ForbiddenError();
      await setResultEntryTarget({ ...args, actorId: ctx.auth.userId });
      return true;
    },
  }),
);
