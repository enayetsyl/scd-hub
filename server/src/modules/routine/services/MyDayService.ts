/**
 * MyDayService (UX-4, prd-ux-improvements.md §4.4, D-#265) — the staff "Today"
 * dashboard read. ONE gated query composes three EXISTING seams, adding no new
 * permission and no new scope logic:
 *   slots             — the caller's own routine periods for the date (the
 *                       myRoutineSlots filter narrowed to the date's weekday +
 *                       effective range, cover-overlaid like routineForDate,
 *                       day-type-filtered per R2.1, view-enriched per R-3), PLUS
 *                       any period the caller is covering under an APPROVED HR
 *                       leave-cover slot for this exact date (PXG-1/#268
 *                       live-testing find — a proxy ScopeGrant only ever scoped
 *                       tracker/content ACCESS; it never surfaced on the covering
 *                       teacher's own schedule, so a teacher had no in-app way to
 *                       see what they're covering beyond the one-time COVER_ASSIGNED
 *                       notification). Marked `isCovering: true`, `teacherName` is
 *                       the ABSENT teacher's real name (the slot is still theirs).
 *                       The older routine-module R-4 direct-assign cover (a
 *                       RoutineSubstitution from Cover management, no StaffCoverSlot)
 *                       is now surfaced the same way (step 1c) — a cover set from
 *                       Routine → Cover management appears on the proxy's Today page.
 *   homework          — pendingChecking / openResubmissions / activeChases summed
 *                       over the caller's ACCESSIBLE refs — authorized per section
 *                       exactly like homeworkClassOverview (confirm-scope OR read-
 *                       scope; unreadable refs silently skipped)
 *   attendancePending — the caller marks ≥1 attendance UNIT for the date — their Quran
 *                       group (Class 1–5) or Nursery/KG section, via myMarkingUnits
 *                       (D-#278) — and that unit's record is still missing
 * Callers without the underlying permission get empty/zero fields, never an error
 * (a guardian or office login lands here too — the dashboard must render).
 */
import { DAYS_OF_WEEK, callerHasPermission, type PeriodTrack } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError, assertCanConfirmHomework, assertCanRead } from "../../../middleware/authz";
import { Section } from "../../foundation/models/Section";
import { Class as ClassModel } from "../../foundation/models/Class";
import { RoutineSlot, type IRoutineSlot } from "../models/RoutineSlot";
import { RoutineSubstitution } from "../models/RoutineSubstitution";
import { enrichRoutineSlots, type SlotViewFields } from "../slotView";
import { resolveDayType, dayTypeAdmitsTrack } from "../calendar";
import {
  returningStudentsFor,
  previousSchoolDayKey,
  type ReturningStudent,
} from "../../trackers/services/ReturnFromLeaveService";
import { homeworkClassOverview } from "../../trackers/services/HomeworkSummaryService";
import { myMarkingUnits } from "../../attendance/services/StudentAttendanceService";
import { classPresenceForDate, type ClassPresence } from "../../attendance/services/AttendanceReportService";
import { pendingWorkFor, type PendingAlert, type AssignmentPrep } from "./PendingAlertService";
import { StaffCoverSlot } from "../../hr/models/StaffCoverSlot";
import { liveWindow } from "../liveWindow";

type IdLike = { toString(): string };

export interface MyDayHomeworkCounts {
  pendingChecking: number;
  openResubmissions: number;
  activeChases: number;
}

export type MyDaySlot = IRoutineSlot & SlotViewFields & { coverTeacherId?: string | null; isCovering?: boolean };

export interface ClassTeacherSection {
  sectionId: string;
  nameBn: string;
  classLevel: number;
}

export interface MyDayResult {
  date: string;
  dayType: string;
  slots: MyDaySlot[];
  homework: MyDayHomeworkCounts;
  attendancePending: boolean;
  /** Red backlog alerts — work owed today OR on a previous school day (D-#279). */
  alerts: PendingAlert[];
  /** Amber countdown to the assignment-prep deadline, or null (D-#280). */
  assignmentPrep: AssignmentPrep | null;
  /** Principal/Office only: per-class present/absent snapshot for the date (D-#279). */
  classPresence: ClassPresence[];
  /** The sections the caller is CLASS TEACHER of (D-#42 daily coordinator) — the
   *  Today dashboard names the duty so the reconcile alerts have a face. */
  classTeacherOf: ClassTeacherSection[];
  /** RL-1 (D-#552/#553): students back today after an absence, with the work to
   *  hand back out and the work to collect. Derived every load — no stored row.
   *  Empty for a caller with no reach; NEVER an error (the D-#535 rule). */
  returningStudents: ReturningStudent[];
}

export async function myDayFor(ctx: AppContext, dateStr: string): Promise<MyDayResult> {
  const auth = ctx.auth;
  if (!auth) throw new ForbiddenError("Unauthenticated");
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) throw new Error("Invalid date");
  const dateKey = dateStr.slice(0, 10);
  const dayType = await resolveDayType(d);

  // 1. Own periods — the myRoutineSlots filter (teacherId = caller) narrowed to the
  //    date, cover-overlaid (R4.4) and day-type-filtered (R2.1: OFF/HOLIDAY admit
  //    nothing, QURAN_ONLY only the quran track).
  let slots: MyDaySlot[] = [];
  if (callerHasPermission(auth, "routine:read")) {
    const dayOfWeek = DAYS_OF_WEEK[d.getDay()];
    const raw = (await RoutineSlot.find({
      teacherId: auth.userId,
      dayOfWeek,
      active: true,
      isBreak: false,
      ...liveWindow(d),
    })
      .sort({ periodNumber: 1 })
      .lean()) as unknown as IRoutineSlot[];
    const admitted = raw.filter((s) => dayTypeAdmitsTrack(dayType, s.track as PeriodTrack));
    if (admitted.length > 0) {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      const subs = await RoutineSubstitution.find({
        slotId: { $in: admitted.map((s) => s._id) },
        active: true,
        date: { $gte: start, $lte: end },
      }).lean();
      const coverMap = new Map(subs.map((su) => [su.slotId.toString(), su.coverTeacherId.toString()]));
      const withCover = admitted.map((s) => ({
        ...s,
        coverTeacherId: coverMap.get(s._id.toString()) ?? null,
      }));
      slots = (await enrichRoutineSlots(withCover)) as MyDaySlot[];
    }

    // 1b. Periods the caller is COVERING today under an approved HR leave-cover
    //     slot (PXG-1 gap fix) — the routine slot is still named for the absent
    //     teacher, so it's fetched by routineSlotId and marked isCovering for the
    //     app to badge distinctly; teacherName resolves to the ABSENT teacher.
    const coverSlots = await StaffCoverSlot.find({
      finalCoverTeacherUserId: auth.userId,
      dateKey,
      status: "approved",
    })
      .select("routineSlotId")
      .lean();
    if (coverSlots.length > 0) {
      const routineSlotIds = coverSlots.map((c) => c.routineSlotId);
      const coveredRaw = (await RoutineSlot.find({ _id: { $in: routineSlotIds }, active: true })
        .sort({ periodNumber: 1 })
        .lean()) as unknown as IRoutineSlot[];
      if (coveredRaw.length > 0) {
        const enrichedCovered = (await enrichRoutineSlots(
          coveredRaw.map((s) => ({ ...s, coverTeacherId: null })),
        )) as MyDaySlot[];
        for (const s of enrichedCovered) s.isCovering = true;
        slots = [...slots, ...enrichedCovered].sort((a, b) => a.periodNumber - b.periodNumber);
      }
    }

    // 1c. Periods the caller is COVERING today via the routine-module direct-assign
    //     cover (a RoutineSubstitution from Routine → Cover management, R-4) — the
    //     same gap as 1b but for the older mechanism (no StaffCoverSlot). Previously
    //     such a cover only granted the proxy content/tracker ACCESS + a one-time
    //     COVER_ASSIGNED notification; it never surfaced on the covering teacher's
    //     own Today page. Fetched by the substitution's slotId, day-type-filtered
    //     like own slots, and marked isCovering (teacherName = the ABSENT teacher).
    const covStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const covEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    const mySubs = await RoutineSubstitution.find({
      coverTeacherId: auth.userId,
      active: true,
      date: { $gte: covStart, $lte: covEnd },
    })
      .select("slotId")
      .lean();
    if (mySubs.length > 0) {
      const already = new Set(slots.map((s) => s._id.toString()));
      const subSlotIds = mySubs.map((su) => su.slotId).filter((id) => !already.has(id.toString()));
      if (subSlotIds.length > 0) {
        const coveredRaw = (await RoutineSlot.find({ _id: { $in: subSlotIds }, active: true })
          .sort({ periodNumber: 1 })
          .lean()) as unknown as IRoutineSlot[];
        const admittedCovered = coveredRaw.filter((s) => dayTypeAdmitsTrack(dayType, s.track as PeriodTrack));
        if (admittedCovered.length > 0) {
          const enrichedCovered = (await enrichRoutineSlots(
            admittedCovered.map((s) => ({ ...s, coverTeacherId: null })),
          )) as MyDaySlot[];
          for (const s of enrichedCovered) s.isCovering = true;
          slots = [...slots, ...enrichedCovered].sort((a, b) => a.periodNumber - b.periodNumber);
        }
      }
    }
  }

  // 2. Homework counts over the caller's accessible refs — per-section authorization
  //    identical to homeworkClassOverview (confirm-scope first, then read-scope;
  //    unreadable refs silently skipped so a stale ref never breaks the dashboard).
  const homework: MyDayHomeworkCounts = { pendingChecking: 0, openResubmissions: 0, activeChases: 0 };
  if (callerHasPermission(auth, "tracker:read")) {
    const sections = (await Section.find({ active: true }).select("_id classId").lean()) as unknown as Array<{
      _id: { toString(): string };
      classId: { toString(): string };
    }>;
    const authorized = new Set<string>();
    for (const s of sections) {
      const sectionId = s._id.toString();
      const classId = s.classId.toString();
      try {
        try {
          await assertCanConfirmHomework(ctx, sectionId);
        } catch {
          await assertCanRead(ctx, sectionId, classId);
        }
        authorized.add(classId);
      } catch {
        // Not this caller's section — skipped, exactly like homeworkClassOverview.
      }
    }
    if (authorized.size > 0) {
      const overview = await homeworkClassOverview([...authorized], Date.now());
      for (const o of overview) {
        homework.pendingChecking += o.pendingChecking;
        homework.openResubmissions += o.openResubmissions;
        homework.activeChases += o.activeChases;
      }
    }
  }

  // 3. Attendance pending — the caller marks ≥1 attendance UNIT for the date (their
  //    Quran group or Nursery/KG section, D-#278) and its day record is still absent
  //    (first-class-teacher / cover / override / class-teacher-fallback path, AT2.3).
  let attendancePending = false;
  if (callerHasPermission(auth, "attendance:mark")) {
    const marking = await myMarkingUnits(auth.userId, dateKey);
    attendancePending = marking.some((m) => !m.marked);
  }

  // 4. Backlog alerts (D-#279) + the assignment-prep countdown (D-#280) — anything the
  //    caller owes today OR on a previous school day, and how long is left before the
  //    next assignment must be ready. Each kind self-gates on its own permission and
  //    yields nothing when absent, so this stays safe for guardian/office logins.
  const { alerts, assignmentPrep } = await pendingWorkFor(ctx, d);

  // 4b. The sections the caller class-teaches (daily coordinator, D-#42) — named on
  //     Today so the hw/as reconcile duty (and its red alerts) has a visible owner.
  let classTeacherOf: ClassTeacherSection[] = [];
  if (auth.role === "TEACHER") {
    const mySections = (await Section.find({ classTeacherId: auth.userId, active: true })
      .select("nameBn classId")
      .lean()) as unknown as Array<{ _id: IdLike; nameBn: string; classId: IdLike }>;
    if (mySections.length > 0) {
      const classes = (await ClassModel.find({ _id: { $in: mySections.map((s) => s.classId) } })
        .select("level")
        .lean()) as unknown as Array<{ _id: IdLike; level: number }>;
      const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level]));
      classTeacherOf = mySections.map((s) => ({
        sectionId: s._id.toString(),
        nameBn: s.nameBn,
        classLevel: levelOf.get(s.classId.toString()) ?? 0,
      }));
    }
  }

  // 5. Principal/Office: the per-class present/absent snapshot for the date (D-#279).
  //    Teachers get an empty list — they read their own worklist instead.
  const classPresence = callerHasPermission(auth, "attendance:manage")
    ? await classPresenceForDate(dateKey)
    : [];

  // 6. RL-1 — who is back today, and what to ask them for (D-#552/#553).
  //    Scope follows the caller's REACH, and degrades to [] rather than refusing:
  //      class teacher  → the whole section, every subject
  //      subject teacher → only classes they have a period with TODAY, and only
  //                        their own subject's items — nobody is handed a list
  //                        they have no lesson in which to act on
  //      anyone else    → []
  let returningStudents: ReturningStudent[] = [];
  try {
    const ctSectionIds = classTeacherOf.map((s) => s.sectionId);
    if (ctSectionIds.length > 0) {
      const prevKey = await previousSchoolDayKey(d, async (probe) => {
        const dt = await resolveDayType(probe);
        return dt !== "OFF" && dt !== "HOLIDAY";
      });
      returningStudents = await returningStudentsFor(ctSectionIds, dateKey, prevKey);
    } else if (slots.length > 0) {
      // Subject teacher: today's own periods give both the sections and the subjects.
      // Section slots only: a Quran/Arabic SubjectGroup slot has no section behind
      // it (groupType "subjectgroup"), and this card is section-scoped.
      const sectionSlots = slots.filter((sl) => sl.groupType === "section");
      const todaySectionIds = [...new Set(sectionSlots.map((sl) => sl.groupId?.toString()).filter(Boolean))] as string[];
      const todaySubjects = [...new Set(sectionSlots.map((sl) => sl.subject).filter(Boolean))] as string[];
      if (todaySectionIds.length > 0) {
        const prevKey = await previousSchoolDayKey(d, async (probe) => {
          const dt = await resolveDayType(probe);
          return dt !== "OFF" && dt !== "HOLIDAY";
        });
        returningStudents = await returningStudentsFor(
          todaySectionIds,
          dateKey,
          prevKey,
          todaySubjects,
        );
      }
    }
  } catch (err) {
    // A dashboard field that can refuse is a field that can white-screen the app
    // (D-#535). An empty card is always better than a broken navigator.
    console.error("[myDay] returning-students card failed; rendering empty:", err);
    returningStudents = [];
  }

  return { date: dateKey, dayType, slots, homework, attendancePending, alerts, assignmentPrep, classPresence, classTeacherOf, returningStudents };
}
