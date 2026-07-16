/**
 * teacherClassLoad resolver (D-#327) — per-teacher teaching load from the routine.
 *
 * Scope: no `teacherId` → every teacher (Principal/Office oversight). With a
 * `teacherId` == the caller → own load (any teacher). A `teacherId` ≠ the caller
 * → Principal/Office only. Counts scheduled (substantive) periods.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  teacherClassLoad,
  type TeacherClassLoadShape,
  type WeekdayCountShape,
  type ClassLoadSlotShape,
} from "../services/TeacherClassLoadService";

function assertClassLoadScope(ctx: AppContext, teacherId?: string | null): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role === "PRINCIPAL" || ctx.auth.role === "OFFICE") return;
  if (teacherId && teacherId === ctx.auth.userId) return;
  throw new ForbiddenError("A teacher may view only their own class load; all-teacher view is Principal/Office only");
}

const WeekdayCountRef = builder.objectRef<WeekdayCountShape>("TeacherWeekdayCount").implement({
  description: "One weekday and how many periods the teacher teaches that day (standard weekly pattern).",
  fields: (t) => ({
    dayOfWeek: t.exposeString("dayOfWeek"),
    count: t.exposeInt("count"),
  }),
});

const ClassLoadSlotRef = builder.objectRef<ClassLoadSlotShape>("TeacherClassLoadSlot").implement({
  description: "One routine period in the teacher's weekly grid (for the drill-down detail).",
  fields: (t) => ({
    dayOfWeek: t.exposeString("dayOfWeek"),
    periodNumber: t.exposeInt("periodNumber"),
    subject: t.exposeString("subject"),
    track: t.exposeString("track"),
    groupName: t.string({ nullable: true, resolve: (r) => r.groupName }),
    startTime: t.string({ nullable: true, resolve: (r) => r.startTime }),
    endTime: t.string({ nullable: true, resolve: (r) => r.endTime }),
  }),
});

const TeacherClassLoadRef = builder.objectRef<TeacherClassLoadShape>("TeacherClassLoad").implement({
  description:
    "A teacher's teaching load for a month: standard weekly pattern (perWeekday + weekTotal) plus the " +
    "calendar-accurate monthTotal (teaching days only, holidays netted out), and the weekly grid for detail.",
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    teacherName: t.exposeString("teacherName"),
    perWeekday: t.field({ type: [WeekdayCountRef], resolve: (r) => r.perWeekday }),
    weekTotal: t.exposeInt("weekTotal"),
    monthKey: t.exposeString("monthKey"),
    monthTotal: t.exposeInt("monthTotal"),
    monthTeachingDays: t.exposeInt("monthTeachingDays"),
    slots: t.field({ type: [ClassLoadSlotRef], resolve: (r) => r.slots }),
  }),
});

builder.queryField("teacherClassLoad", (t) =>
  t.field({
    type: [TeacherClassLoadRef],
    description:
      "Per-teacher teaching load for a month (YYYY-MM). Omit teacherId for every teacher (Principal/Office); " +
      "pass your own id for your own load. Counts scheduled routine periods.",
    authScopes: { authenticated: true },
    args: {
      month: t.arg.string({ required: true }),
      teacherId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertClassLoadScope(ctx, args.teacherId);
      return teacherClassLoad(args.month, args.teacherId ?? undefined);
    },
  }),
);
