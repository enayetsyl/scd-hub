/**
 * ReconReportService — the Principal/Office "who didn't reconcile?" report.
 *
 * Homework reconciles DAILY (declare → the class teacher's confirmHomeworkDay
 * spawns the per-student records, HW-T2); assignments reconcile WEEKLY
 * (deliver → confirmAssignmentWeek, AS-T6). A miss means declarations/deliveries
 * exist but the confirm never happened — the per-student records don't exist, so
 * students silently get no due dates, no checking, no chases (live prod finding
 * 2026-07-13: Nursery had declared homework and had NEVER been confirmed).
 *
 *   hwReconMisses — per (class, day) in the range: ≥1 still-`declared` item and
 *                   the day's reconciliation is not `reconciled` (the same rule
 *                   as the pendingHomeworkSections reminder ladder — lockstep).
 *   asReconMisses — per (section, week) whose §4-resolved deliveryDate falls in
 *                   the range: ≥1 still-DRAFT item (records never spawned).
 *
 * Rows carry the section + class teacher (the accountable confirmer) so the
 * report answers "WHO didn't submit", not just "what's missing".
 * Identity/operational plane — no corpus path (ADR-005).
 */
import { DAYS_OF_WEEK, HW_DECLARATION_EXPECTED_SUBJECTS } from "@scd/shared";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkNilDeclaration } from "../models/HomeworkNilDeclaration";
import { HomeworkReconciliation, reconDayKey } from "../models/HomeworkReconciliation";
import { AssignmentItem } from "../models/AssignmentItem";
import { AssignmentNilDeclaration } from "../models/AssignmentNilDeclaration";
import { AssignmentSchedule } from "../models/AssignmentSchedule";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { HolidayException } from "../../routine/models/HolidayException";
import { dayTypeFor } from "../../routine/calendar";
import { dateKeyOf, parseDateKey } from "../../attendance/dates";
import { expectedItemsForWeek } from "./AssignmentScheduleService";
import { weekNumberFor } from "../assignmentCalendar";

export interface HwReconMiss {
  dateKey: string;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  /** The accountable confirmer: homework delegate ?? class teacher. Null = nobody assigned. */
  confirmerName: string | null;
  declaredItems: number;
  declaredMinutes: number;
}

export interface AsReconMiss {
  weekNumber: number;
  deliveryDateKey: string;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  /** The accountable confirmer: the section's class teacher. Null = nobody assigned. */
  confirmerName: string | null;
  draftItems: number;
  draftMinutes: number;
}

export interface HwNotDeclared {
  dateKey: string;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  /** The HW subject code (BAN/ENG/…) whose declaration never happened that day. */
  subject: string;
  /** The routine's subject teacher for that (section, subject, weekday) — who owes
   *  the declaration. Null when the slot names nobody. */
  teacherName: string | null;
}

export interface HwNilDeclared {
  dateKey: string;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  /** The teacher who tapped "no homework today". */
  teacherName: string | null;
  reason: string;
}

/** D-#309: a rotation-expected assignment nobody DECLARED — the (section × subject
 *  × week) cell exists in the AssignmentSchedule cycle but no AssignmentItem was
 *  ever created. The step before asMisses' delivered-but-DRAFT. */
export interface AsNotDeclared {
  weekNumber: number;
  weekStartKey: string;
  /** The §4-rolled delivery date the declaration was due by (null never happens
   *  for non-suspended weeks; kept nullable to mirror the resolver shape). */
  deliveryDateKey: string | null;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  /** The rotation entry's teacher — who owes the declaration. */
  teacherName: string | null;
}

export interface AsNilDeclared {
  weekNumber: number;
  weekStartKey: string;
  deliveryDateKey: string;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  teacherName: string | null;
  reason: string;
}

export interface ReconReport {
  fromKey: string;
  toKey: string;
  hwMisses: HwReconMiss[];
  asMisses: AsReconMiss[];
  /** (class, subject, day) cells where the subject HAS routine periods that day but
   *  declared NO homework at all — the step before hwMisses' declared-not-confirmed. */
  hwNotDeclared: HwNotDeclared[];
  /** Explicit "no homework today" declarations in the range (D-#299) — the neutral
   *  list; these cells are EXCLUDED from hwNotDeclared. */
  hwNilDeclared: HwNilDeclared[];
  asNilDeclared: AsNilDeclared[];
  /** D-#309: rotation-expected assignments never declared, per (section × subject × week). */
  asNotDeclared: AsNotDeclared[];
}

interface SectionInfo {
  nameBn: string;
  classLevel: number;
  confirmerName: string | null;
  hwConfirmerName: string | null;
}

/** Batched section → (name, class level, class-teacher/delegate names). */
async function sectionInfoMap(sectionIds: string[]): Promise<Map<string, SectionInfo>> {
  if (sectionIds.length === 0) return new Map();
  const sections = await Section.find({ _id: { $in: sectionIds } })
    .select("nameBn classId classTeacherId homeworkConfirmerId")
    .lean();
  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } })
    .select("level")
    .lean();
  const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level]));
  const userIds = new Set<string>();
  for (const s of sections) {
    if (s.classTeacherId) userIds.add(s.classTeacherId.toString());
    if (s.homeworkConfirmerId) userIds.add(s.homeworkConfirmerId.toString());
  }
  const users = userIds.size
    ? await User.find({ _id: { $in: [...userIds] } }).select("name").lean()
    : [];
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));

  const out = new Map<string, SectionInfo>();
  for (const s of sections) {
    const ctName = s.classTeacherId ? (nameOf.get(s.classTeacherId.toString()) ?? null) : null;
    const delegateName = s.homeworkConfirmerId ? (nameOf.get(s.homeworkConfirmerId.toString()) ?? null) : null;
    out.set(s._id.toString(), {
      nameBn: s.nameBn,
      classLevel: levelOf.get(s.classId.toString()) ?? 0,
      confirmerName: ctName,
      hwConfirmerName: delegateName ?? ctName,
    });
  }
  return out;
}

/** Inclusive local-day range bounds for a [fromKey, toKey] date-key pair. */
function rangeBounds(fromKey: string, toKey: string): { start: Date; end: Date } {
  const start = parseDateKey(fromKey);
  const last = parseDateKey(toKey);
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999);
  if (start.getTime() > end.getTime()) throw new Error("from must not be after to");
  return { start, end };
}

/**
 * D-#309: the (section × subject × week) cells where an assignment was NEVER
 * DECLARED although the AssignmentSchedule rotation expects one that cycle week.
 * Expectation source = the rotation (the same authority the teacher prep prompts
 * use, D-#89) — suspended weeks owe nothing, and a week only reports once its
 * §4-rolled delivery date has passed (before that the declaration isn't late).
 */
async function asNotDeclaredRows(
  fromKey: string,
  toKey: string,
  now: Date,
): Promise<Array<Omit<AsNotDeclared, "sectionNameBn"> & { teacherId: string | null }>> {
  const { start, end } = rangeBounds(fromKey, toKey);
  const todayKey = dateKeyOf(now);

  const schedules = (await AssignmentSchedule.find({}).select("academicYearId termStartDate").lean()) as unknown as Array<{
    academicYearId: { toString(): string };
    termStartDate: Date;
  }>;

  const out: Array<Omit<AsNotDeclared, "sectionNameBn"> & { teacherId: string | null }> = [];
  for (const sched of schedules) {
    const term = new Date(sched.termStartDate);
    const wFrom = Math.max(1, weekNumberFor(term, start));
    const wTo = Math.min(weekNumberFor(term, end), weekNumberFor(term, now), 53);
    for (let w = wFrom; w <= wTo; w++) {
      let week;
      try {
        week = await expectedItemsForWeek(sched.academicYearId.toString(), w);
      } catch {
        continue; // schedule vanished between reads — nothing owed
      }
      if (week.suspended || !week.deliveryDate) continue;
      // expectedItemsForWeek returns a FULL ISO instant (dateOnlyISO), so it must be
      // narrowed to a date key before comparing with one — "2026-07-23T00:00:00.000Z"
      // sorts AFTER "2026-07-23" (longer string, equal prefix), which silently hid
      // every undelivered cell on its own delivery day (owner finding 2026-07-23).
      const deliveryKey = (week.deliveryDate as string).slice(0, 10);
      if (deliveryKey > todayKey) continue; // only the FUTURE isn't due yet
      for (const item of week.items) {
        if (item.delivered || item.nilDeclared) continue;
        out.push({
          weekNumber: week.weekNumber,
          weekStartKey: week.weekStart,
          deliveryDateKey: deliveryKey,
          sectionId: item.sectionId,
          classLevel: item.classLevel,
          subject: item.subject,
          teacherId: item.teacherId || null,
          teacherName: null,
        });
      }
    }
  }
  return out;
}

/**
 * The (class, subject, day) cells where homework was NEVER DECLARED although the
 * subject had live routine periods in that section that day. Expectation source =
 * the ROUTINE (a subject with no period that day owes nothing); only FULL school
 * days count (Fri OFF, Sat QURAN_ONLY, holidays skipped — handoff §6.1), and only
 * days up to today. The named teacher is the routine's subject teacher — the
 * declaration is theirs to make (handoff §2.1).
 */
async function hwNotDeclaredRows(
  fromKey: string,
  toKey: string,
  now: Date,
  /** D-#299: (section|subject|dateKey) cells with an explicit nil declaration —
   *  deliberately none, so they never enter the red list. */
  nilKeys: Set<string>,
): Promise<Array<Omit<HwNotDeclared, "sectionNameBn" | "classLevel"> & { teacherId: string | null }>> {
  const { start, end } = rangeBounds(fromKey, toKey);
  const todayKey = dateKeyOf(now);

  const [slots, declared, holidays] = await Promise.all([
    RoutineSlot.find({
      groupType: "section",
      active: true,
      isBreak: false,
      // D-#308: ARABIC is declarable but never EXPECTED — no red row when absent.
      subject: { $in: HW_DECLARATION_EXPECTED_SUBJECTS as readonly string[] },
    })
      .select("groupId dayOfWeek periodNumber subject teacherId effectiveFrom effectiveTo")
      .lean(),
    HomeworkItem.find({ dateGiven: { $gte: start, $lte: end } })
      .select("sectionId subject dateGiven")
      .lean(),
    HolidayException.find({ active: true, fromDate: { $lte: end }, toDate: { $gte: start } })
      .select("fromDate toDate")
      .lean(),
  ]);
  if (slots.length === 0) return [];

  const declaredKeys = new Set(
    declared.map((d) => `${d.sectionId.toString()}|${d.subject}|${dateKeyOf(new Date(d.dateGiven))}`),
  );

  const out: Array<Omit<HwNotDeclared, "sectionNameBn" | "classLevel"> & { teacherId: string | null }> = [];
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    const dateKey = dateKeyOf(d);
    if (dateKey > todayKey) break; // never report the future
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    const isHoliday = holidays.some(
      (h) => new Date(h.fromDate).getTime() <= dayEnd.getTime() && new Date(h.toDate).getTime() >= dayStart.getTime(),
    );
    if (dayTypeFor(d, isHoliday) !== "FULL") continue;

    const dayOfWeek = DAYS_OF_WEEK[d.getDay()];
    // Earliest live slot per (section, subject) that day names the accountable teacher.
    const bySectionSubject = new Map<string, { teacherId: string | null; periodNumber: number }>();
    for (const s of slots) {
      if (s.dayOfWeek !== dayOfWeek) continue;
      if (new Date(s.effectiveFrom).getTime() > d.getTime()) continue;
      if (s.effectiveTo && new Date(s.effectiveTo).getTime() < d.getTime()) continue;
      const key = `${s.groupId.toString()}|${s.subject}`;
      const prev = bySectionSubject.get(key);
      if (!prev || s.periodNumber < prev.periodNumber) {
        bySectionSubject.set(key, {
          teacherId: s.teacherId ? s.teacherId.toString() : null,
          periodNumber: s.periodNumber,
        });
      }
    }
    for (const [key, cell] of bySectionSubject) {
      const [sectionId, subject] = key.split("|");
      if (declaredKeys.has(`${sectionId}|${subject}|${dateKey}`)) continue;
      if (nilKeys.has(`${sectionId}|${subject}|${dateKey}`)) continue; // deliberately none (D-#299)
      out.push({ dateKey, sectionId, subject, teacherId: cell.teacherId, teacherName: null });
    }
  }
  return out;
}

export async function reconciliationReport(
  fromKey: string,
  toKey: string,
  now: Date = new Date(),
): Promise<ReconReport> {
  const { start, end } = rangeBounds(fromKey, toKey);

  // --- Explicit "no homework today" markers in the range (D-#299) ----------------
  const nilRows = await HomeworkNilDeclaration.find({
    dateKey: { $gte: fromKey, $lte: toKey },
  }).lean();
  const nilKeys = new Set(
    nilRows.map((r) => `${r.sectionId.toString()}|${r.subject}|${r.dateKey}`),
  );
  const asNilRows = await AssignmentNilDeclaration.find({
    deliveryDateKey: { $gte: fromKey, $lte: toKey },
  }).lean();

  // --- Homework never declared at all (routine-expected, per class × subject × day) --
  const notDeclRaw = await hwNotDeclaredRows(fromKey, toKey, now, nilKeys);

  // --- Homework: (class, day) buckets of still-declared items in the range ------
  const hwItems = await HomeworkItem.find({
    status: "declared",
    dateGiven: { $gte: start, $lte: end },
  })
    .select("classId sectionId dateGiven timeDecl")
    .lean();

  const hwBuckets = new Map<
    string,
    { classId: string; sectionId: string; dateKey: string; items: number; minutes: number }
  >();
  for (const it of hwItems) {
    const dateKey = dateKeyOf(new Date(it.dateGiven));
    const key = `${it.classId.toString()}|${dateKey}`;
    const b =
      hwBuckets.get(key) ??
      hwBuckets
        .set(key, {
          classId: it.classId.toString(),
          sectionId: it.sectionId.toString(),
          dateKey,
          items: 0,
          minutes: 0,
        })
        .get(key)!;
    b.items += 1;
    b.minutes += it.timeDecl ?? 0;
  }

  // Drop buckets whose day WAS reconciled (same rule as pendingHomeworkSections).
  let hwPending = [...hwBuckets.values()];
  if (hwPending.length > 0) {
    const recons = await HomeworkReconciliation.find({
      classId: { $in: [...new Set(hwPending.map((b) => b.classId))] },
      reconDate: { $gte: reconDayKey(start), $lte: reconDayKey(end) },
      reconState: "reconciled",
    })
      .select("classId reconDate")
      .lean();
    const reconciled = new Set(
      recons.map((r) => `${r.classId.toString()}|${dateKeyOf(new Date(r.reconDate))}`),
    );
    hwPending = hwPending.filter((b) => !reconciled.has(`${b.classId}|${b.dateKey}`));
  }

  // --- Assignments: (section, week) buckets of still-DRAFT items in the range ---
  const asItems = await AssignmentItem.find({
    status: "DRAFT",
    deliveryDate: { $gte: start, $lte: end },
  })
    .select("sectionId weekNumber deliveryDate estMinutes")
    .lean();

  const asBuckets = new Map<
    string,
    { sectionId: string; weekNumber: number; deliveryDateKey: string; items: number; minutes: number }
  >();
  for (const it of asItems) {
    const key = `${it.sectionId.toString()}|${it.weekNumber}`;
    const b =
      asBuckets.get(key) ??
      asBuckets
        .set(key, {
          sectionId: it.sectionId.toString(),
          weekNumber: it.weekNumber,
          deliveryDateKey: dateKeyOf(new Date(it.deliveryDate)),
          items: 0,
          minutes: 0,
        })
        .get(key)!;
    b.items += 1;
    b.minutes += it.estMinutes ?? 0;
  }
  const asPending = [...asBuckets.values()];

  // --- D-#309: rotation-expected assignments never declared ----------------------
  const asNotDeclRaw = await asNotDeclaredRows(fromKey, toKey, now);

  // --- Enrich with section/class/confirmer names (one batched pass) -------------
  const info = await sectionInfoMap([
    ...new Set([
      ...hwPending.map((b) => b.sectionId),
      ...asPending.map((b) => b.sectionId),
      ...notDeclRaw.map((r) => r.sectionId),
      ...nilRows.map((r) => r.sectionId.toString()),
      ...asNilRows.map((r) => r.sectionId.toString()),
      ...asNotDeclRaw.map((r) => r.sectionId),
    ]),
  ]);

  const notDeclTeacherIds = [
    ...new Set([
      ...(notDeclRaw.map((r) => r.teacherId).filter(Boolean) as string[]),
      ...nilRows.map((r) => r.declaredBy.toString()),
      ...asNilRows.map((r) => r.declaredBy.toString()),
      ...(asNotDeclRaw.map((r) => r.teacherId).filter(Boolean) as string[]),
    ]),
  ];
  const notDeclTeachers = notDeclTeacherIds.length
    ? await User.find({ _id: { $in: notDeclTeacherIds } }).select("name").lean()
    : [];
  const teacherNameOf = new Map(notDeclTeachers.map((u) => [u._id.toString(), u.name]));

  const hwNilDeclared: HwNilDeclared[] = nilRows
    .map((r) => {
      const s = info.get(r.sectionId.toString());
      return {
        dateKey: r.dateKey,
        sectionId: r.sectionId.toString(),
        sectionNameBn: s?.nameBn ?? r.sectionId.toString(),
        classLevel: s?.classLevel ?? 0,
        subject: r.subject,
        teacherName: teacherNameOf.get(r.declaredBy.toString()) ?? null,
        reason: r.reason,
      };
    })
    .sort((a, b) =>
      a.dateKey === b.dateKey
        ? a.classLevel - b.classLevel || a.subject.localeCompare(b.subject)
        : a.dateKey < b.dateKey
          ? 1
          : -1,
    );

  const asNilDeclared: AsNilDeclared[] = asNilRows
    .map((r) => {
      const s = info.get(r.sectionId.toString());
      return {
        weekNumber: r.weekNumber,
        weekStartKey: r.weekStartKey,
        deliveryDateKey: r.deliveryDateKey,
        sectionId: r.sectionId.toString(),
        sectionNameBn: s?.nameBn ?? r.sectionId.toString(),
        classLevel: s?.classLevel ?? r.classLevel,
        subject: r.subject,
        teacherName: teacherNameOf.get(r.declaredBy.toString()) ?? null,
        reason: r.reason,
      };
    })
    .sort((a, b) =>
      a.weekNumber === b.weekNumber
        ? a.classLevel - b.classLevel || a.subject.localeCompare(b.subject)
        : b.weekNumber - a.weekNumber,
    );

  const hwNotDeclared: HwNotDeclared[] = notDeclRaw
    .map((r) => {
      const s = info.get(r.sectionId);
      return {
        dateKey: r.dateKey,
        sectionId: r.sectionId,
        sectionNameBn: s?.nameBn ?? r.sectionId,
        classLevel: s?.classLevel ?? 0,
        subject: r.subject,
        teacherName: r.teacherId ? (teacherNameOf.get(r.teacherId) ?? null) : null,
      };
    })
    .sort((a, b) =>
      a.dateKey === b.dateKey
        ? a.classLevel - b.classLevel || a.subject.localeCompare(b.subject)
        : a.dateKey < b.dateKey
          ? 1
          : -1,
    );

  const hwMisses: HwReconMiss[] = hwPending
    .map((b) => {
      const s = info.get(b.sectionId);
      return {
        dateKey: b.dateKey,
        sectionId: b.sectionId,
        sectionNameBn: s?.nameBn ?? b.sectionId,
        classLevel: s?.classLevel ?? 0,
        confirmerName: s?.hwConfirmerName ?? null,
        declaredItems: b.items,
        declaredMinutes: b.minutes,
      };
    })
    .sort((a, b) => (a.dateKey === b.dateKey ? a.classLevel - b.classLevel : a.dateKey < b.dateKey ? 1 : -1));

  const asMisses: AsReconMiss[] = asPending
    .map((b) => {
      const s = info.get(b.sectionId);
      return {
        weekNumber: b.weekNumber,
        deliveryDateKey: b.deliveryDateKey,
        sectionId: b.sectionId,
        sectionNameBn: s?.nameBn ?? b.sectionId,
        classLevel: s?.classLevel ?? 0,
        confirmerName: s?.confirmerName ?? null,
        draftItems: b.items,
        draftMinutes: b.minutes,
      };
    })
    .sort((a, b) =>
      a.deliveryDateKey === b.deliveryDateKey ? a.classLevel - b.classLevel : a.deliveryDateKey < b.deliveryDateKey ? 1 : -1,
    );

  const asNotDeclared: AsNotDeclared[] = asNotDeclRaw
    .map((r) => {
      const s = info.get(r.sectionId);
      return {
        weekNumber: r.weekNumber,
        weekStartKey: r.weekStartKey,
        deliveryDateKey: r.deliveryDateKey,
        sectionId: r.sectionId,
        sectionNameBn: s?.nameBn ?? r.sectionId,
        classLevel: r.classLevel,
        subject: r.subject,
        teacherName: r.teacherId ? (teacherNameOf.get(r.teacherId) ?? null) : null,
      };
    })
    .sort((a, b) =>
      a.weekNumber === b.weekNumber
        ? a.classLevel - b.classLevel || a.subject.localeCompare(b.subject)
        : b.weekNumber - a.weekNumber,
    );

  return { fromKey, toKey, hwMisses, asMisses, hwNotDeclared, hwNilDeclared, asNilDeclared, asNotDeclared };
}
