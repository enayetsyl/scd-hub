/**
 * Assignment handout-board resolvers (AS-T7, D-#643).
 *
 * TWO surfaces over ONE service read (`AssignmentHandoutService`):
 *   `assignmentHandoutBoard(date)` — the whole school's board (office preparation +
 *                                   the tap-through from the admin Today card)
 *   `myDay.assignmentHandout`      — the caller's own sections, delivery day only
 *                                   (the field lives on the myDay type; the object
 *                                   ref is exported from here so both share it)
 *
 * NO new permission. The board rides the SAME gate as the rest of the schedule/
 * expected-grid reads (`assertStaffScheduleRead`, D-#94): Principal/Office as
 * unscoped staff, or any role holding `tracker:read`. Deliberately not narrowed to
 * the caller's own sections — the cross-check is a whole-day coordination view, the
 * same reasoning that leaves `expectedAssignmentsForWeek` unscoped, and it carries
 * no student identity at all (section, subject, teacher name).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import { isAdminStaff } from "../../foundation/services/RoleScope";
import {
  handoutBoard as handoutBoardSvc,
  type HandoutBoard,
  type HandoutPacket,
  type HandoutSection,
} from "../services/AssignmentHandoutService";

/** Mirrors `assertStaffScheduleRead` in ./assignment — Principal/Office, or tracker:read. */
function assertHandoutRead(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (isAdminStaff(ctx.auth)) return;
  if (callerHasPermission(ctx.auth, "tracker:read")) return;
  throw new ForbiddenError();
}

export const HandoutPacketRef = builder.objectRef<HandoutPacket>("AssignmentHandoutPacket").implement({
  description:
    "One printed assignment packet to hand a section in the last period (AS-T7). " +
    "`printRequested` is the D-#459 match — a live ASSIGNMENT print request for this " +
    "(section × subject) on the delivery date; false means the paper may not exist yet.",
  fields: (t) => ({
    entryId: t.exposeString("entryId"),
    subject: t.exposeString("subject"),
    subjectTeacherId: t.exposeString("subjectTeacherId"),
    subjectTeacherName: t.string({ nullable: true, resolve: (p) => p.subjectTeacherName }),
    delivered: t.exposeBoolean("delivered"),
    asId: t.string({ nullable: true, resolve: (p) => p.asId }),
    description: t.string({ nullable: true, resolve: (p) => p.description }),
    printRequested: t.exposeBoolean("printRequested"),
  }),
});

export const HandoutSectionRef = builder.objectRef<HandoutSection>("AssignmentHandoutSection").implement({
  description:
    "A section's handout for the delivery day (AS-T7, D-#643): the packets to carry into its " +
    "LAST section period, and who takes that period. `handoutTeacherId` is null when the " +
    "section has no resolvable last period — the case the office must see, not the one to hide. " +
    "`nilPackets` are subjects that declared no assignment this week; they are named so the " +
    "count reconciles instead of reading as a lost paper.",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classId: t.exposeString("classId"),
    classLevel: t.exposeInt("classLevel"),
    lastPeriodNumber: t.int({ nullable: true, resolve: (s) => s.lastPeriodNumber }),
    lastPeriodSubject: t.string({ nullable: true, resolve: (s) => s.lastPeriodSubject }),
    handoutTeacherId: t.string({ nullable: true, resolve: (s) => s.handoutTeacherId }),
    handoutTeacherName: t.string({ nullable: true, resolve: (s) => s.handoutTeacherName }),
    isCover: t.exposeBoolean("isCover"),
    packets: t.field({ type: [HandoutPacketRef], resolve: (s) => s.packets }),
    nilPackets: t.field({ type: [HandoutPacketRef], resolve: (s) => s.nilPackets }),
  }),
});

const HandoutBoardRef = builder.objectRef<HandoutBoard>("AssignmentHandoutBoard").implement({
  description:
    "The whole school's handout board for the week containing `date` (AS-T7). Sections with no " +
    "expected assignment that week are absent. `isDeliveryToday` says whether the packets go out " +
    "today or are still being prepared for `deliveryDateKey`.",
  fields: (t) => ({
    date: t.exposeString("date"),
    weekNumber: t.exposeInt("weekNumber"),
    deliveryDateKey: t.string({ nullable: true, resolve: (b) => b.deliveryDateKey }),
    isDeliveryToday: t.exposeBoolean("isDeliveryToday"),
    sections: t.field({ type: [HandoutSectionRef], resolve: (b) => b.sections }),
  }),
});

builder.queryField("assignmentHandoutBoard", (t) =>
  t.field({
    type: HandoutBoardRef,
    description:
      "Which assignment packets go to which section in its last period, and who collects them " +
      "from the office (AS-T7, D-#643). Staff read — no new permission.",
    authScopes: { authenticated: true },
    args: { date: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertHandoutRead(ctx);
      const d = new Date(args.date);
      if (isNaN(d.getTime())) throw new Error("Invalid date");
      return handoutBoardSvc(d);
    },
  }),
);
