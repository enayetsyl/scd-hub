/**
 * AssignmentScheduleService (AS-T1, D-#86/D-#89) — the admin-managed 4-week
 * rotation, the computed expected-item grid, and the teacher prep prompts.
 *
 *   upsertAssignmentSchedule  — year config: term anchor + cadence weekdays
 *   addScheduleEntry / removeScheduleEntry — rotation CRUD
 *   expectedItemsForWeek      — week N → resolved entries with §4-rolled dates,
 *                               suspended flag, and the delivered join
 *   myAssignmentPrepPrompts   — D-#89: Sun/Mon in-app prompt listing the
 *                               teacher's expected items not yet delivered
 *                               (the myClassNotePrompts pattern; push rides
 *                               the deferred messaging pipeline)
 *
 * The open-day predicate comes from the ONE calendar source (D-#50): routine
 * `dayTypeFor` + `HolidayException` ranges — no second calendar truth.
 */
import { HW_SUBJECTS, ROSTER_CLASS_LEVEL_MIN, ROSTER_CLASS_LEVEL_MAX } from "@scd/shared";
import type { HwSubject } from "@scd/shared";
import { Class } from "../../foundation/models/Class";
import { AssignmentSchedule, type IAssignmentSchedule } from "../models/AssignmentSchedule";
import { AssignmentItem } from "../models/AssignmentItem";
import { AssignmentNilDeclaration, AS_NIL_REASONS, type AsNilReason } from "../models/AssignmentNilDeclaration";
import { HolidayException } from "../../routine/models/HolidayException";
import { dayTypeFor } from "../../routine/calendar";
import {
  atMidnight,
  weekNumberFor,
  weekStartOf,
  resolveWeekDates,
  dateOnlyISO,
  type IsOpenDay,
  type ResolvedWeekDates,
} from "../assignmentCalendar";

function assertSubject(s: string): asserts s is HwSubject {
  if (!(HW_SUBJECTS as readonly string[]).includes(s)) {
    throw new Error(`Unknown assignment subject: ${s} (allowed: ${HW_SUBJECTS.join(", ")})`);
  }
}

/** Anchors must be FULL school weekdays Sun(0)–Thu(4): Fri is off, Sat is
 *  Quran-only and Quran is excluded from this tracker (D-#36/§4 rule 4). */
function assertAnchorWeekday(label: string, dow: number): void {
  if (!Number.isInteger(dow) || dow < 0 || dow > 4) {
    throw new Error(`${label} must be a school weekday 0 (Sun) … 4 (Thu) — Fri/Sat cannot host an assignment anchor (D-#86)`);
  }
}

// ---------------------------------------------------------------------------
// Open-day predicate (the §4 single calendar source)
// ---------------------------------------------------------------------------

/**
 * Build a sync IsOpenDay predicate for [from, to] by preloading the active
 * HolidayException ranges once. Open = dayTypeFor resolves FULL (Sun–Thu,
 * no holiday override).
 */
export async function loadOpenDayPredicate(from: Date, to: Date): Promise<IsOpenDay> {
  const holidays = (await HolidayException.find({
    active: true,
    fromDate: { $lte: to },
    toDate: { $gte: from },
  }).lean()) as unknown as Array<{ fromDate: Date; toDate: Date }>;
  return (date: Date) => {
    const t = atMidnight(date).getTime();
    const isHoliday = holidays.some(
      (h) => t >= atMidnight(new Date(h.fromDate)).getTime() && t <= new Date(h.toDate).getTime(),
    );
    return dayTypeFor(date, isHoliday) === "FULL";
  };
}

// ---------------------------------------------------------------------------
// Schedule CRUD (admin — Principal/Office; the resolver gates)
// ---------------------------------------------------------------------------

export interface UpsertScheduleInput {
  academicYearId: string;
  termStartDate: string | Date;
  deliveryDayOfWeek?: number;
  dueDayOfWeek?: number;
}

export async function upsertAssignmentSchedule(
  input: UpsertScheduleInput,
): Promise<IAssignmentSchedule> {
  const termStartDate = new Date(input.termStartDate);
  if (Number.isNaN(termStartDate.getTime())) throw new Error("Invalid termStartDate");
  const deliveryDayOfWeek = input.deliveryDayOfWeek ?? 4; // THU
  const dueDayOfWeek = input.dueDayOfWeek ?? 0; // SUN
  assertAnchorWeekday("deliveryDayOfWeek", deliveryDayOfWeek);
  assertAnchorWeekday("dueDayOfWeek", dueDayOfWeek);

  return AssignmentSchedule.findOneAndUpdate(
    { academicYearId: input.academicYearId },
    {
      $set: { termStartDate: atMidnight(termStartDate), deliveryDayOfWeek, dueDayOfWeek },
      $setOnInsert: { entries: [] },
    },
    { new: true, upsert: true },
  );
}

export interface AddEntryInput {
  academicYearId: string;
  cycleWeek: number;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  teacherId: string;
}

export async function addScheduleEntry(input: AddEntryInput): Promise<IAssignmentSchedule> {
  assertSubject(input.subject);
  if (!Number.isInteger(input.cycleWeek) || input.cycleWeek < 1 || input.cycleWeek > 4) {
    throw new Error("cycleWeek must be 1..4 (the 4-week rotation, D-#86)");
  }
  if (
    !Number.isInteger(input.classLevel) ||
    input.classLevel < ROSTER_CLASS_LEVEL_MIN ||
    input.classLevel > ROSTER_CLASS_LEVEL_MAX
  ) {
    throw new Error(
      `Assignments cover the roster classes Nursery–C5 (classLevel must be ${ROSTER_CLASS_LEVEL_MIN}..${ROSTER_CLASS_LEVEL_MAX})`,
    );
  }
  const schedule = await AssignmentSchedule.findOne({ academicYearId: input.academicYearId });
  if (!schedule) {
    throw new Error("No AssignmentSchedule for this academic year — set the term anchor first");
  }
  const dup = schedule.entries.find(
    (e) =>
      e.cycleWeek === input.cycleWeek &&
      e.sectionId.toString() === input.sectionId &&
      e.subject === input.subject,
  );
  if (dup) {
    throw new Error(
      `The rotation already has ${input.subject} for this section on cycle week ${input.cycleWeek}`,
    );
  }
  schedule.entries.push({
    cycleWeek: input.cycleWeek,
    classId: input.classId,
    classLevel: input.classLevel,
    sectionId: input.sectionId,
    subject: input.subject,
    teacherId: input.teacherId,
  } as never);
  await schedule.save();
  return schedule;
}

export async function removeScheduleEntry(
  academicYearId: string,
  entryId: string,
): Promise<IAssignmentSchedule> {
  const schedule = await AssignmentSchedule.findOne({ academicYearId });
  if (!schedule) throw new Error("No AssignmentSchedule for this academic year");
  const entry = schedule.entries.id(entryId);
  if (!entry) throw new Error("Schedule entry not found");
  entry.deleteOne();
  await schedule.save();
  return schedule;
}

/** Reassign the teacher on one rotation entry (D-#328) — the per-entry edit the
 *  admin does inline; only the teacherId changes, subject/section/week are fixed. */
export async function updateScheduleEntryTeacher(
  academicYearId: string,
  entryId: string,
  teacherId: string,
): Promise<IAssignmentSchedule> {
  if (!teacherId) throw new Error("teacherId is required");
  const schedule = await AssignmentSchedule.findOne({ academicYearId });
  if (!schedule) throw new Error("No AssignmentSchedule for this academic year");
  const entry = schedule.entries.id(entryId);
  if (!entry) throw new Error("Schedule entry not found");
  entry.teacherId = teacherId as never;
  await schedule.save();
  return schedule;
}

export async function getAssignmentSchedule(
  academicYearId: string,
): Promise<IAssignmentSchedule | null> {
  return AssignmentSchedule.findOne({ academicYearId });
}

// ---------------------------------------------------------------------------
// Expected-item resolution (the computed grid, PRD §3/§4)
// ---------------------------------------------------------------------------

export interface ExpectedItem {
  /** Rotation-entry subdocument id — the stable ref AssignmentItem stores. */
  entryId: string;
  cycleWeek: number;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: HwSubject;
  teacherId: string;
  /** True once an AssignmentItem exists for (week × section × subject). */
  delivered: boolean;
  /** AS-T6: null (no item) | "DRAFT" (awaiting weekly confirm) | "ISSUED". */
  status: string | null;
  asItemId: string | null;
  asId: string | null;
  /** D-#353: current values, so the edit sheet can prefill without a second read. */
  estMinutes: number | null;
  totalMarks: number | null;
  /** D-#478: same reason — the edit sheet corrects a wrong instruction in place. */
  description: string | null;
  /** Explicit "no assignment this week" declaration for this expected cell. */
  nilDeclared: boolean;
  nilReason: string | null;
  nilDeclarationId: string | null;
}

export interface ExpectedWeek {
  academicYearId: string;
  weekNumber: number;
  cycleWeek: number;
  weekStart: string;
  /** Calendar-month label parts (D-#275): week-of-month resets each month. */
  year: number;
  month: number;
  weekOfMonth: number;
  suspended: boolean;
  deliveryDate: string | null;
  dueDate: string | null;
  items: ExpectedItem[];
}

/** Resolve week N's §4 dates from a loaded schedule (shared by the queries
 *  and AS-T2's delivery pass, which re-resolves server-side). */
export async function resolveScheduleWeek(
  schedule: IAssignmentSchedule,
  weekNumber: number,
): Promise<ResolvedWeekDates> {
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53) {
    throw new Error("weekNumber must be 1..53");
  }
  const weekStart = weekStartOf(schedule.termStartDate, weekNumber);
  const windowEnd = new Date(weekStart.getTime() + 70 * 86_400_000); // covers the 60-day due roll
  const isOpen = await loadOpenDayPredicate(weekStart, windowEnd);
  return resolveWeekDates(
    schedule.termStartDate,
    weekNumber,
    schedule.deliveryDayOfWeek,
    schedule.dueDayOfWeek,
    isOpen,
  );
}

/**
 * DE-5 (D-#477): the assignment cell a ROUTINE SLOT can hand out on a given date,
 * or null.
 *
 * The period card owns none of the assignment axes — it knows a slot and a date,
 * not a term anchor or a week number — so this resolves the chain server-side:
 * slot → section+subject+class → the year's schedule → the week that date falls in
 * → that week's expected cells. It answers only when the cell is genuinely
 * deliverable TODAY from this period: same section and subject, not yet delivered,
 * and the §4-resolved delivery date is this date. Anything else returns null and
 * the card simply shows nothing.
 */
export async function assignmentCellForSlot(input: {
  sectionId: string;
  subject: string;
  classId: string;
  date: Date;
}): Promise<(ExpectedItem & { academicYearId: string; weekNumber: number; deliveryDate: string; dueDate: string }) | null> {
  const cls = await Class.findById(input.classId).select("academicYearId").lean();
  if (!cls) return null;
  const academicYearId = cls.academicYearId.toString();
  const schedule = await AssignmentSchedule.findOne({ academicYearId });
  if (!schedule) return null;

  const weekNumber = weekNumberFor(schedule.termStartDate, input.date);
  if (weekNumber < 1) return null;
  const week = await expectedItemsForWeek(academicYearId, weekNumber);
  if (week.suspended || !week.deliveryDate || !week.dueDate) return null;
  if (week.deliveryDate !== dateOnlyISO(atMidnight(input.date))) return null;

  const cell = week.items.find(
    (i) => i.sectionId === input.sectionId && i.subject === input.subject && !i.delivered,
  );
  if (!cell) return null;
  return { ...cell, academicYearId, weekNumber, deliveryDate: week.deliveryDate, dueDate: week.dueDate };
}

export async function expectedItemsForWeek(
  academicYearId: string,
  weekNumber: number,
): Promise<ExpectedWeek> {
  const schedule = await AssignmentSchedule.findOne({ academicYearId });
  if (!schedule) {
    throw new Error("No AssignmentSchedule for this academic year — set the term anchor first");
  }
  const resolved = await resolveScheduleWeek(schedule, weekNumber);
  const entries = schedule.entries.filter((e) => e.cycleWeek === resolved.cycleWeek);

  // An AssignmentItem is delivered once one exists for (week × section × subject)
  // — the same key the delivery pass enforces uniqueness on. We deliberately do
  // NOT key on scheduleEntryId: rotation entries are subdocuments, so editing an
  // entry (remove + re-add) mints a new _id and would orphan the delivered item,
  // making the home card read "Not delivered" while the deliver screen (keyed on
  // section+subject) correctly reports "already delivered".
  const existing = (await AssignmentItem.find({
    academicYearId,
    weekNumber,
  }).lean()) as unknown as Array<{
    _id: { toString(): string };
    asId: string;
    sectionId: { toString(): string };
    subject: string;
    status: string;
    estMinutes?: number;
    totalMarks?: number;
    description?: string;
  }>;
  const itemKey = (sectionId: string, subject: string): string => `${sectionId}|${subject}`;
  const byEntry = new Map(existing.map((i) => [itemKey(i.sectionId.toString(), i.subject), i]));
  const nilRows = (await AssignmentNilDeclaration.find({
    academicYearId,
    weekNumber,
  }).lean()) as unknown as Array<{
    _id: { toString(): string };
    sectionId: { toString(): string };
    subject: string;
    reason: string;
  }>;
  const nilByEntry = new Map(nilRows.map((n) => [itemKey(n.sectionId.toString(), n.subject), n]));

  return {
    academicYearId,
    weekNumber: resolved.weekNumber,
    cycleWeek: resolved.cycleWeek,
    weekStart: dateOnlyISO(resolved.weekStart),
    year: resolved.year,
    month: resolved.month,
    weekOfMonth: resolved.weekOfMonth,
    suspended: resolved.suspended,
    deliveryDate: resolved.deliveryDate ? dateOnlyISO(resolved.deliveryDate) : null,
    dueDate: resolved.dueDate ? dateOnlyISO(resolved.dueDate) : null,
    items: entries.map((e) => {
      const item = byEntry.get(itemKey(e.sectionId.toString(), e.subject));
      const nil = nilByEntry.get(itemKey(e.sectionId.toString(), e.subject));
      return {
        entryId: e._id.toString(),
        cycleWeek: e.cycleWeek,
        classId: e.classId.toString(),
        classLevel: e.classLevel,
        sectionId: e.sectionId.toString(),
        subject: e.subject,
        teacherId: e.teacherId.toString(),
        delivered: !!item,
        status: item ? item.status : null,
        asItemId: item ? item._id.toString() : null,
        asId: item ? item.asId : null,
        estMinutes: item?.estMinutes ?? null,
        totalMarks: item?.totalMarks ?? null,
        description: item?.description ?? null,
        nilDeclared: !!nil,
        nilReason: nil?.reason ?? null,
        nilDeclarationId: nil ? nil._id.toString() : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// "No assignment this week" nil declarations
// ---------------------------------------------------------------------------

export interface AssignmentNilDeclarationDTO {
  id: string;
  academicYearId: string;
  weekNumber: number;
  cycleWeek: number;
  weekStartKey: string;
  deliveryDateKey: string;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: HwSubject;
  teacherId: string;
  reason: AsNilReason;
  declaredBy: string;
}

function nilDto(doc: {
  _id: { toString(): string };
  academicYearId: { toString(): string };
  weekNumber: number;
  cycleWeek: number;
  weekStartKey: string;
  deliveryDateKey: string;
  classId: { toString(): string };
  classLevel: number;
  sectionId: { toString(): string };
  subject: HwSubject;
  teacherId: { toString(): string };
  reason: AsNilReason;
  declaredBy: { toString(): string };
}): AssignmentNilDeclarationDTO {
  return {
    id: doc._id.toString(),
    academicYearId: doc.academicYearId.toString(),
    weekNumber: doc.weekNumber,
    cycleWeek: doc.cycleWeek,
    weekStartKey: doc.weekStartKey,
    deliveryDateKey: doc.deliveryDateKey,
    classId: doc.classId.toString(),
    classLevel: doc.classLevel,
    sectionId: doc.sectionId.toString(),
    subject: doc.subject,
    teacherId: doc.teacherId.toString(),
    reason: doc.reason,
    declaredBy: doc.declaredBy.toString(),
  };
}

interface NilInput {
  academicYearId: string;
  weekNumber: number;
  entryId: string;
  sectionId: string;
  reason?: string;
  actorId: string;
}

async function resolveNilCell(input: Omit<NilInput, "reason" | "actorId">) {
  const schedule = await AssignmentSchedule.findOne({ academicYearId: input.academicYearId });
  if (!schedule) throw new Error("No AssignmentSchedule for this academic year — set the term anchor first");
  const entry = schedule.entries.id(input.entryId);
  if (!entry) throw new Error("Schedule entry not found in this year's rotation");
  if (entry.sectionId.toString() !== input.sectionId) {
    throw new Error("sectionId does not match the schedule entry's section");
  }
  const resolved = await resolveScheduleWeek(schedule, input.weekNumber);
  if (resolved.cycleWeek !== entry.cycleWeek) {
    throw new Error(
      `Week ${input.weekNumber} is cycle week ${resolved.cycleWeek}, but this entry belongs to cycle week ${entry.cycleWeek}`,
    );
  }
  if (resolved.suspended || !resolved.deliveryDate) {
    throw new Error(`Week ${input.weekNumber} is suspended — no assignment is expected`);
  }
  return { entry, resolved };
}

export async function declareNoAssignment(input: NilInput): Promise<AssignmentNilDeclarationDTO> {
  if (!input.reason || !(AS_NIL_REASONS as readonly string[]).includes(input.reason)) {
    throw new Error(`Unknown no-assignment reason: ${input.reason ?? ""}`);
  }
  const { entry, resolved } = await resolveNilCell(input);
  const existing = await AssignmentItem.findOne({
    academicYearId: input.academicYearId,
    weekNumber: input.weekNumber,
    sectionId: entry.sectionId,
    subject: entry.subject,
  }).lean();
  if (existing) {
    throw new Error("This assignment is already delivered; edit/delete it instead of declaring no assignment");
  }

  const doc = await AssignmentNilDeclaration.findOneAndUpdate(
    {
      academicYearId: input.academicYearId,
      weekNumber: input.weekNumber,
      sectionId: entry.sectionId,
      subject: entry.subject,
    },
    {
      $set: {
        academicYearId: input.academicYearId,
        weekNumber: input.weekNumber,
        cycleWeek: resolved.cycleWeek,
        weekStartKey: dateOnlyISO(resolved.weekStart).slice(0, 10),
        deliveryDateKey: dateOnlyISO(resolved.deliveryDate as Date).slice(0, 10),
        classId: entry.classId,
        classLevel: entry.classLevel,
        sectionId: entry.sectionId,
        subject: entry.subject,
        teacherId: entry.teacherId,
        reason: input.reason,
        declaredBy: input.actorId,
      },
    },
    { new: true, upsert: true },
  );
  return nilDto(doc as never);
}

export async function removeNoAssignment(input: Omit<NilInput, "reason">): Promise<boolean> {
  const { entry } = await resolveNilCell(input);
  const res = await AssignmentNilDeclaration.deleteOne({
    academicYearId: input.academicYearId,
    weekNumber: input.weekNumber,
    sectionId: entry.sectionId,
    subject: entry.subject,
  });
  return res.deletedCount > 0;
}

// ---------------------------------------------------------------------------
// Teacher prep prompts (D-#89 / AJ-2)
// ---------------------------------------------------------------------------

/** Sunday + Monday — the prompt days (D-#89). */
const PREP_PROMPT_DAYS = new Set([0, 1]);

export interface PrepPrompt {
  entryId: string;
  weekNumber: number;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: HwSubject;
  deliveryDate: string;
  dueDate: string;
}

/**
 * The teacher's expected items for the CURRENT week not yet delivered —
 * surfaced only on Sunday/Monday (D-#89); empty on other days, on suspended
 * weeks, before the term, and once everything is delivered (AJ-2).
 */
export async function myAssignmentPrepPrompts(
  academicYearId: string,
  teacherId: string,
  today: Date = new Date(),
): Promise<PrepPrompt[]> {
  if (!PREP_PROMPT_DAYS.has(today.getDay())) return [];
  const schedule = await AssignmentSchedule.findOne({ academicYearId });
  if (!schedule) return [];
  const weekNumber = weekNumberFor(schedule.termStartDate, today);
  if (weekNumber < 1) return [];

  const week = await expectedItemsForWeek(academicYearId, weekNumber);
  if (week.suspended || !week.deliveryDate || !week.dueDate) return [];

  return week.items
    .filter((i) => i.teacherId === teacherId && !i.delivered && !i.nilDeclared)
    .map((i) => ({
      entryId: i.entryId,
      weekNumber,
      classId: i.classId,
      classLevel: i.classLevel,
      sectionId: i.sectionId,
      subject: i.subject,
      deliveryDate: week.deliveryDate as string,
      dueDate: week.dueDate as string,
    }));
}
