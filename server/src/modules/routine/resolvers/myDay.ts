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
import { myDayFor, type MyDayHomeworkCounts, type MyDayResult } from "../services/MyDayService";

const MyDayHomeworkRef = builder.objectRef<MyDayHomeworkCounts>("MyDayHomework").implement({
  description: "Cumulative homework counts over the caller's accessible classes (UX-4 Today dashboard).",
  fields: (t) => ({
    pendingChecking: t.exposeInt("pendingChecking"),
    openResubmissions: t.exposeInt("openResubmissions"),
    activeChases: t.exposeInt("activeChases"),
  }),
});

const MyDayRef = builder.objectRef<MyDayResult>("MyDay").implement({
  description:
    "The caller's day at a glance (UX-4): own routine periods for the date (cover-overlaid, " +
    "view-enriched), summed homework work counts, and whether attendance marking is pending.",
  fields: (t) => ({
    date: t.exposeString("date"),
    dayType: t.exposeString("dayType"),
    slots: t.field({
      type: [RoutineSlotRef],
      resolve: (r) => r.slots as unknown as IRoutineSlot[],
    }),
    homework: t.field({ type: MyDayHomeworkRef, resolve: (r) => r.homework }),
    attendancePending: t.exposeBoolean("attendancePending"),
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
