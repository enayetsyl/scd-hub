/**
 * homeworkWeeklyUnsubmitted resolver (D-#453) — the staff twin of the weekly
 * guardian digest: per-student subject-wise unsubmitted lines for a week +
 * the digest day's heads-up items, each row carrying the SAME rendered Bangla
 * message the guardians got (one text truth) as a manual wa.me line for the
 * ~129 contact-only families (ADR-003 — never auto-dispatched).
 *
 * Gate: Principal/Office by ROLE (the D-#290/#350 oversight precedent) — the
 * payload names every student school-wide with a guardian phone; `tracker:read`
 * would hand that to any teacher.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { isValidDateKey } from "../../attendance/dates";
import {
  homeworkWeeklyDigestData,
  reportWindowOf,
  renderDigestBody,
  primaryGuardianPhoneOf,
  type HwWeeklyStudentDigest,
  type HwWeeklyItemLine,
  type HwWeeklyHeadsUpLine,
  type DigestWindow,
} from "../services/HomeworkWeeklyDigestService";

function assertWeeklyReportAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role !== "PRINCIPAL" && ctx.auth.role !== "OFFICE") {
    throw new ForbiddenError("সাপ্তাহিক রিপোর্ট শুধুমাত্র অধ্যক্ষ/অফিসের জন্য");
  }
}

/** wa.me click-to-send link (ADR-003 — MANUAL send only; null when no phone). */
function waLinkOf(phone: string | null, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

interface HwWeeklyStudentRow extends HwWeeklyStudentDigest {
  guardianPhone: string | null;
  waLink: string | null;
  messageBn: string;
}

interface HwWeeklyReport extends DigestWindow {
  students: HwWeeklyStudentRow[];
}

const HwWeeklyUnsubmittedItemRef = builder.objectRef<HwWeeklyItemLine>("HwWeeklyUnsubmittedItem").implement({
  description: "One still-unsubmitted homework line in a student's week (D-#453).",
  fields: (t) => ({
    hwItemId: t.exposeString("hwItemId"),
    hwId: t.exposeString("hwId"),
    subject: t.exposeString("subject"),
    subjectLabelBn: t.exposeString("subjectLabelBn"),
    dateKey: t.exposeString("dateKey"),
    description: t.string({ nullable: true, resolve: (r) => r.description }),
    state: t.exposeString("state"),
    stateLabelBn: t.exposeString("stateLabelBn"),
    chaseCount: t.exposeInt("chaseCount"),
    dueDateKey: t.string({ nullable: true, resolve: (r) => r.dueDateKey }),
  }),
});

const HwWeeklyHeadsUpItemRef = builder.objectRef<HwWeeklyHeadsUpLine>("HwWeeklyHeadsUpItem").implement({
  description: "A digest-day fresh homework line (the weekend heads-up, D-#453).",
  fields: (t) => ({
    hwItemId: t.exposeString("hwItemId"),
    hwId: t.exposeString("hwId"),
    subject: t.exposeString("subject"),
    subjectLabelBn: t.exposeString("subjectLabelBn"),
    description: t.string({ nullable: true, resolve: (r) => r.description }),
    qCount: t.exposeInt("qCount"),
    timeDecl: t.exposeInt("timeDecl"),
    dueDateKey: t.string({ nullable: true, resolve: (r) => r.dueDateKey }),
  }),
});

const HwWeeklyStudentRowRef = builder.objectRef<HwWeeklyStudentRow>("HwWeeklyStudentRow").implement({
  description:
    "One student's weekly picture + the guardian-identical rendered message and its manual wa.me line (D-#453).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (r) => r.nameBn }),
    rollNumber: t.string({ nullable: true, resolve: (r) => r.rollNumber }),
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.string({ nullable: true, resolve: (r) => r.sectionNameBn }),
    classLevel: t.exposeInt("classLevel"),
    guardianPhone: t.string({ nullable: true, resolve: (r) => r.guardianPhone }),
    waLink: t.string({ nullable: true, resolve: (r) => r.waLink }),
    messageBn: t.exposeString("messageBn"),
    unsubmitted: t.field({ type: [HwWeeklyUnsubmittedItemRef], resolve: (r) => r.unsubmitted }),
    headsUp: t.field({ type: [HwWeeklyHeadsUpItemRef], resolve: (r) => r.headsUp }),
  }),
});

const HwWeeklyReportRef = builder.objectRef<HwWeeklyReport>("HwWeeklyUnsubmittedReport").implement({
  description:
    "The weekly unsubmitted-homework report (D-#453): what the Thursday guardian digest sent/will send, " +
    "per student, for manual follow-up of contact-only families. Principal/Office only.",
  fields: (t) => ({
    weekStartKey: t.exposeString("weekStartKey"),
    unsubFromKey: t.exposeString("unsubFromKey"),
    unsubToKey: t.exposeString("unsubToKey"),
    headsUpKey: t.exposeString("headsUpKey"),
    students: t.field({ type: [HwWeeklyStudentRowRef], resolve: (r) => r.students }),
  }),
});

builder.queryField("homeworkWeeklyUnsubmitted", (t) =>
  t.field({
    type: HwWeeklyReportRef,
    description:
      "Per-student weekly unsubmitted homework + digest-day heads-up, with the guardian-identical " +
      "rendered message and a manual wa.me line per student (D-#453). weekStart omitted = current week; " +
      "any dateKey is snapped to its week's Sunday. Principal/Office by role.",
    // Role gate in the resolver (the D-#350 oversight pattern) — OFFICE holds no
    // tracker:read, so a permission gate here would lock the report's operator out.
    authScopes: { authenticated: true },
    args: {
      weekStart: t.arg.string({ required: false }),
      sectionId: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertWeeklyReportAdmin(ctx);
      if (args.weekStart && !isValidDateKey(args.weekStart)) {
        throw new Error("weekStart must be YYYY-MM-DD");
      }
      const window = await reportWindowOf(args.weekStart ?? null, new Date());
      const digests = await homeworkWeeklyDigestData(window, {
        sectionId: args.sectionId ?? null,
        classLevel: args.classLevel ?? null,
      });
      const phoneOf = await primaryGuardianPhoneOf(digests.map((d) => d.studentId));
      const students: HwWeeklyStudentRow[] = [];
      for (const d of digests) {
        // The wa variant: byte-identical content + the closing tail (one text truth).
        const messageBn = await renderDigestBody("homework.weeklyDigest.wa", d, window);
        const guardianPhone = phoneOf.get(d.studentId) ?? d.studentPhone ?? null;
        students.push({ ...d, guardianPhone, waLink: waLinkOf(guardianPhone, messageBn), messageBn });
      }
      return { ...window, students };
    },
  }),
);
