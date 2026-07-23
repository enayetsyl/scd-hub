/**
 * myDay resolver (UX-4, prd-ux-improvements.md §4.4, D-#265) — the staff "Today"
 * dashboard read. `authenticated` only: every field internally reuses an existing
 * gate (routine:read for slots, the homeworkClassOverview read/confirm scope per
 * section, attendance:mark for the pending flag) and degrades to empty/zero for
 * callers without it — a guardian or office login renders an empty dashboard,
 * never an error. NO new permission, NO vocab/wire change (server-owned type).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import type { IRoutineSlot } from "../models/RoutineSlot";
import { RoutineSlotRef } from "./routineSlots";
import { myDayFor, type MyDayHomeworkCounts, type MyDayResult, type ClassTeacherSection } from "../services/MyDayService";
import type { PendingAlert, AssignmentPrep, AssignmentPrepCell } from "../services/PendingAlertService";
import type { ClassPresence } from "../../attendance/services/AttendanceReportService";

const AssignmentPrepCellRef = builder.objectRef<AssignmentPrepCell>("AssignmentPrepCell").implement({
  description: "One (class × subject) still needing an assignment prepared for the delivery week.",
  fields: (t) => ({
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    sectionId: t.exposeString("sectionId"),
  }),
});

const AssignmentPrepRef = builder.objectRef<AssignmentPrep>("AssignmentPrep").implement({
  description:
    "The countdown to having the assignment question ready (D-#280). `dueAt` is the school " +
    "day's START on the RESOLVED delivery date — the instant the paper must be in students' " +
    "hands — so a holiday roll carries it. Null once the caller's items are delivered; once " +
    "`dueAt` passes it becomes the red `assignment_entry` alert instead.",
  fields: (t) => ({
    dueAt: t.exposeString("dueAt"),
    deliveryDateKey: t.exposeString("deliveryDateKey"),
    weekNumber: t.exposeInt("weekNumber"),
    items: t.exposeInt("items"),
    cells: t.field({ type: [AssignmentPrepCellRef], resolve: (r) => r.cells ?? [] }),
  }),
});

const MyDayHomeworkRef = builder.objectRef<MyDayHomeworkCounts>("MyDayHomework").implement({
  description: "Cumulative homework counts over the caller's accessible classes (UX-4 Today dashboard).",
  fields: (t) => ({
    pendingChecking: t.exposeInt("pendingChecking"),
    openResubmissions: t.exposeInt("openResubmissions"),
    activeChases: t.exposeInt("activeChases"),
  }),
});

const PendingAlertRef = builder.objectRef<PendingAlert>("PendingAlert").implement({
  description:
    "A red backlog alert on the Today dashboard (D-#279): work the caller owes today OR on a " +
    "previous school day inside the 7-day look-back. kind = attendance | class_note | assignment_entry.",
  fields: (t) => ({
    kind: t.exposeString("kind"),
    /** Pending DAYS for attendance/class_note; pending ITEMS for assignment_entry. */
    count: t.exposeInt("count"),
    oldestDateKey: t.string({ nullable: true, resolve: (a) => a.oldestDateKey }),
  }),
});

const ClassPresenceRef = builder.objectRef<ClassPresence>("ClassPresence").implement({
  description:
    "Per-class present/absent snapshot for a date (D-#279), rolled up from every attendance unit. " +
    "Only students whose unit was marked are counted — an unmarked Quran group is PENDING, never " +
    "silently 'present'. Populated for attendance:manage callers only.",
  fields: (t) => ({
    classId: t.exposeString("classId"),
    classLevel: t.exposeInt("classLevel"),
    classNameBn: t.exposeString("classNameBn"),
    markedCount: t.exposeInt("markedCount"),
    presentCount: t.exposeInt("presentCount"),
    absentCount: t.exposeInt("absentCount"),
    totalCount: t.exposeInt("totalCount"),
    complete: t.exposeBoolean("complete"),
  }),
});

const ClassTeacherSectionRef = builder.objectRef<ClassTeacherSection>("ClassTeacherSection").implement({
  description: "A section the caller is CLASS TEACHER of (D-#42) — named on the Today dashboard.",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    nameBn: t.exposeString("nameBn"),
    classLevel: t.exposeInt("classLevel"),
  }),
});

const MyDayRef = builder.objectRef<MyDayResult>("MyDay").implement({
  description:
    "The caller's day at a glance (UX-4): own routine periods for the date (cover-overlaid, " +
    "view-enriched), summed homework work counts, whether attendance marking is pending, the " +
    "red backlog alerts (D-#279), and — for Principal/Office — the per-class presence snapshot.",
  fields: (t) => ({
    date: t.exposeString("date"),
    dayType: t.exposeString("dayType"),
    slots: t.field({
      type: [RoutineSlotRef],
      resolve: (r) => r.slots as unknown as IRoutineSlot[],
    }),
    homework: t.field({ type: MyDayHomeworkRef, resolve: (r) => r.homework }),
    attendancePending: t.exposeBoolean("attendancePending"),
    alerts: t.field({ type: [PendingAlertRef], resolve: (r) => r.alerts }),
    assignmentPrep: t.field({
      type: AssignmentPrepRef,
      nullable: true,
      resolve: (r) => r.assignmentPrep,
    }),
    classPresence: t.field({ type: [ClassPresenceRef], resolve: (r) => r.classPresence }),
    classTeacherOf: t.field({ type: [ClassTeacherSectionRef], resolve: (r) => r.classTeacherOf }),
  }),
});

builder.queryField("myDay", (t) =>
  t.field({
    type: MyDayRef,
    description:
      "The staff Today dashboard (UX-4): the caller's own periods for the date, pending homework " +
      "counts over their accessible classes, and the attendance-pending flag. Authenticated; each " +
      "field internally reuses its existing gate and returns empty/zero when the caller lacks it.",
    authScopes: { authenticated: true },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return myDayFor(ctx, args.date);
    },
  }),
);
