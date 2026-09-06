/**
 * AssignmentHandoutService (AS-T7, D-#643) — "what do I carry into the last period?"
 *
 * The school hands out EVERY subject's assignment for a section in ONE period: the
 * section's last period on the delivery day (owner instruction 2026-09-05). The
 * teacher who takes that period collects the printed packets from the office and
 * cross-checks them against the number of subjects that are actually due — a count
 * they had no way to know, because the rotation that decides it lives in the
 * AssignmentSchedule and was only ever shown to the SUBJECT teacher who prepares
 * the paper (D-#280's prep countdown).
 *
 * This is a pure READ that joins three seams that already exist — it stores nothing
 * and adds no permission:
 *   the week's expected cells — `expectedItemsForWeek` (the 4-week rotation, D-#86),
 *                               nil-declared cells kept SEPARATE rather than dropped
 *   who hands them out        — the section's highest-numbered non-break SECTION
 *                               period that day, cover-overlaid (RoutineSubstitution
 *                               R-4 and the HR StaffCoverSlot, the two mechanisms
 *                               MyDayService already reconciles)
 *   is it printed             — a live ASSIGNMENT `PrintRequest` for (section ×
 *                               subject × delivery date), the D-#459 match
 *
 * WHY THE LAST **SECTION** PERIOD, not simply the last period. A section's final
 * period of the day can be a cross-grade Quran/Arabic group (D-#48), and there the
 * section's students are split across several groups with several teachers — nobody
 * stands in front of the whole section. A handout has to reach the section at once,
 * so the anchor is the last period at which the section IS one room.
 *
 * A section with expected packets but NO resolvable last period is still returned,
 * with `handoutTeacherId: null` — that is precisely the case the office needs to see
 * before it stacks the papers, not one to hide.
 */
import { HW_SUBJECTS, DAYS_OF_WEEK, type HwSubject, type PeriodTrack } from "@scd/shared";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { RoutineSlot, type IRoutineSlot } from "../../routine/models/RoutineSlot";
import { RoutineSubstitution } from "../../routine/models/RoutineSubstitution";
import { StaffCoverSlot } from "../../hr/models/StaffCoverSlot";
import { liveWindow } from "../../routine/liveWindow";
import { resolveDayType, dayTypeAdmitsTrack } from "../../routine/calendar";
import { PrintRequest } from "../../printing/models/PrintRequest";
import { AssignmentSchedule } from "../models/AssignmentSchedule";
import { expectedItemsForWeek } from "./AssignmentScheduleService";
import { weekNumberFor } from "../assignmentCalendar";

export interface HandoutPacket {
  /** The rotation entry (AssignmentSchedule.entries subdocument id). */
  entryId: string;
  subject: HwSubject;
  /** The teacher who PREPARES the paper — not necessarily the one handing it out. */
  subjectTeacherId: string;
  subjectTeacherName: string | null;
  /** An AssignmentItem exists for this cell — the digital delivery pass is done. */
  delivered: boolean;
  asId: string | null;
  description: string | null;
  /** A live (non-cancelled) ASSIGNMENT print request for this cell's delivery date. */
  printRequested: boolean;
}

export interface HandoutSection {
  sectionId: string;
  sectionNameBn: string;
  classId: string;
  classLevel: number;
  /** The section's last non-break SECTION period that day, or null if it has none. */
  lastPeriodNumber: number | null;
  lastPeriodSubject: string | null;
  /** Who actually stands there — the cover teacher when the period is covered. */
  handoutTeacherId: string | null;
  handoutTeacherName: string | null;
  /** True when `handoutTeacher` is covering someone else's period today. */
  isCover: boolean;
  /** The packets to carry — what the cross-check counts against. */
  packets: HandoutPacket[];
  /** Cells the subject teacher declared "no assignment this week" (D-#86 nil).
   *  Named, not dropped: a missing packet that is missing ON PURPOSE is the one
   *  thing that stops the cross-check turning into a hunt for a lost paper. */
  nilPackets: HandoutPacket[];
}

export interface HandoutBoard {
  /** The date asked for. */
  date: string;
  /** The rotation week `date` falls in, or 0 when no schedule/year resolves. */
  weekNumber: number;
  /** The §4-resolved delivery date for that week (holiday rolls applied), or null. */
  deliveryDateKey: string | null;
  /** `deliveryDateKey === date` — the day the packets actually go out. */
  isDeliveryToday: boolean;
  sections: HandoutSection[];
}

const EMPTY_BOARD = (dateKey: string): HandoutBoard => ({
  date: dateKey,
  weekNumber: 0,
  deliveryDateKey: null,
  isDeliveryToday: false,
  sections: [],
});

const dateKeyOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const subjectOrder = (s: string): number => {
  const i = (HW_SUBJECTS as readonly string[]).indexOf(s);
  return i === -1 ? HW_SUBJECTS.length : i;
};

/**
 * The academic year to read the rotation against. Copied from PendingAlertService
 * rather than imported: that module lives in `routine` and already imports THIS
 * module's neighbour (`AssignmentScheduleService`), so importing it back would
 * close a trackers → routine → trackers cycle for eight lines of lookup.
 * `AcademicYear.current` defaults to false, so the covering-range fallback is not
 * optional — without it a roster where nobody flipped the flag reads as "no year".
 */
async function resolveAcademicYearId(today: Date): Promise<string | null> {
  const current = await AcademicYear.findOne({ current: true }).select("_id").lean();
  if (current) return current._id.toString();
  const covering = await AcademicYear.findOne({
    startDate: { $lte: today },
    endDate: { $gte: today },
  })
    .select("_id")
    .lean();
  return covering ? covering._id.toString() : null;
}

interface LastPeriod {
  periodNumber: number;
  subject: string;
  teacherId: string | null;
  isCover: boolean;
}

/**
 * Each section's last non-break SECTION period on `date`, cover-overlaid.
 *
 * Both cover mechanisms are read, because both are live: the routine module's
 * direct-assign `RoutineSubstitution` (R-4) and the HR leave-cover `StaffCoverSlot`
 * (PXG-1). MyDayService reconciles the same pair for the covering teacher's own
 * schedule; the handout has to agree with it, or a covering teacher would see the
 * period on Today and the packet list on nobody's screen.
 */
async function lastSectionPeriods(sectionIds: string[], date: Date): Promise<Map<string, LastPeriod>> {
  const out = new Map<string, LastPeriod>();
  if (sectionIds.length === 0) return out;

  const dayType = await resolveDayType(date);
  const dayOfWeek = DAYS_OF_WEEK[date.getDay()];
  const raw = (await RoutineSlot.find({
    groupType: "section",
    groupId: { $in: sectionIds },
    dayOfWeek,
    active: true,
    isBreak: false,
    ...liveWindow(date),
  }).lean()) as unknown as IRoutineSlot[];
  const admitted = raw.filter((s) => dayTypeAdmitsTrack(dayType, s.track as PeriodTrack));
  if (admitted.length === 0) return out;

  // Highest period number per section wins.
  const bySection = new Map<string, IRoutineSlot>();
  for (const s of admitted) {
    const key = s.groupId.toString();
    const held = bySection.get(key);
    if (!held || s.periodNumber > held.periodNumber) bySection.set(key, s);
  }

  const slotIds = [...bySection.values()].map((s) => s._id);
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const [subs, coverSlots] = await Promise.all([
    RoutineSubstitution.find({
      slotId: { $in: slotIds },
      active: true,
      date: { $gte: dayStart, $lte: dayEnd },
    })
      .select("slotId coverTeacherId")
      .lean(),
    StaffCoverSlot.find({
      routineSlotId: { $in: slotIds },
      dateKey: dateKeyOf(date),
      status: "approved",
    })
      .select("routineSlotId finalCoverTeacherUserId")
      .lean(),
  ]);
  const coverBySlot = new Map<string, string>();
  for (const su of subs) coverBySlot.set(su.slotId.toString(), su.coverTeacherId.toString());
  for (const cs of coverSlots) {
    if (cs.finalCoverTeacherUserId) {
      coverBySlot.set(cs.routineSlotId.toString(), cs.finalCoverTeacherUserId.toString());
    }
  }

  for (const [sectionId, slot] of bySection) {
    const cover = coverBySlot.get(slot._id.toString()) ?? null;
    out.set(sectionId, {
      periodNumber: slot.periodNumber,
      subject: slot.subject,
      teacherId: cover ?? (slot.teacherId ? slot.teacherId.toString() : null),
      isCover: !!cover,
    });
  }
  return out;
}

export interface HandoutBoardOptions {
  /** Keep only the sections this teacher hands out — the Today-card read. */
  forTeacherId?: string;
  /** Stop before resolving last periods when `date` is not the delivery date. The
   *  Today card renders nothing then, and this read runs on EVERY dashboard load,
   *  so the slot/cover/name/print lookups would be pure waste six days a week. */
  deliveryDayOnly?: boolean;
}

/**
 * The handout board for `date`.
 *
 * The `forTeacherId` filter is applied BEFORE the name/print enrichment, so a
 * teacher's Today load never pays for the whole school's lookups.
 *
 * Returns an EMPTY board (never throws) when the year, the schedule or the week
 * yields nothing: a school that has not set a term anchor must still get a rendered
 * dashboard, and `expectedItemsForWeek` throws by design in exactly that case.
 */
export async function handoutBoard(date: Date, opts: HandoutBoardOptions = {}): Promise<HandoutBoard> {
  const { forTeacherId, deliveryDayOnly } = opts;
  const key = dateKeyOf(date);
  const academicYearId = await resolveAcademicYearId(date);
  if (!academicYearId) return EMPTY_BOARD(key);
  const schedule = await AssignmentSchedule.findOne({ academicYearId }).select("termStartDate").lean();
  if (!schedule) return EMPTY_BOARD(key);
  const weekNumber = weekNumberFor(new Date(schedule.termStartDate), date);
  if (weekNumber < 1) return EMPTY_BOARD(key);

  let week;
  try {
    week = await expectedItemsForWeek(academicYearId, weekNumber);
  } catch {
    return EMPTY_BOARD(key);
  }
  const deliveryDateKey = week.deliveryDate ? week.deliveryDate.slice(0, 10) : null;
  const base: HandoutBoard = {
    date: key,
    weekNumber,
    deliveryDateKey,
    isDeliveryToday: deliveryDateKey === key,
    sections: [],
  };
  if (week.suspended || !deliveryDateKey || week.items.length === 0) return base;
  if (deliveryDayOnly && !base.isDeliveryToday) return base;

  // 1. Group the week's expected cells by section.
  interface RawSection {
    sectionId: string;
    classId: string;
    classLevel: number;
    packets: HandoutPacket[];
    nilPackets: HandoutPacket[];
  }
  const bySection = new Map<string, RawSection>();
  for (const item of week.items) {
    let row = bySection.get(item.sectionId);
    if (!row) {
      row = {
        sectionId: item.sectionId,
        classId: item.classId,
        classLevel: item.classLevel,
        packets: [],
        nilPackets: [],
      };
      bySection.set(item.sectionId, row);
    }
    const packet: HandoutPacket = {
      entryId: item.entryId,
      subject: item.subject as HwSubject,
      subjectTeacherId: item.teacherId,
      subjectTeacherName: null,
      delivered: item.delivered,
      asId: item.asId,
      description: item.description,
      printRequested: false,
    };
    (item.nilDeclared ? row.nilPackets : row.packets).push(packet);
  }

  // 2. Who hands each section's packets out — resolved on the DELIVERY date, not on
  //    `date`: the board is a preparation view the office opens before the day, and
  //    the routine that matters is the one in force when the papers go out.
  const deliveryDate = new Date(
    Number(deliveryDateKey.slice(0, 4)),
    Number(deliveryDateKey.slice(5, 7)) - 1,
    Number(deliveryDateKey.slice(8, 10)),
  );
  const lastPeriods = await lastSectionPeriods([...bySection.keys()], deliveryDate);

  let rows = [...bySection.values()].map((r) => {
    const lp = lastPeriods.get(r.sectionId) ?? null;
    return {
      ...r,
      lastPeriodNumber: lp ? lp.periodNumber : null,
      lastPeriodSubject: lp ? lp.subject : null,
      handoutTeacherId: lp ? lp.teacherId : null,
      isCover: lp ? lp.isCover : false,
    };
  });
  if (forTeacherId) rows = rows.filter((r) => r.handoutTeacherId === forTeacherId);
  if (rows.length === 0) return base;

  // 3. Names + print status — batched over whatever survived the filter.
  const sectionIds = rows.map((r) => r.sectionId);
  const classIds = [...new Set(rows.map((r) => r.classId))];
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.handoutTeacherId) userIds.add(r.handoutTeacherId);
    for (const p of [...r.packets, ...r.nilPackets]) if (p.subjectTeacherId) userIds.add(p.subjectTeacherId);
  }
  const [sections, users, printed] = await Promise.all([
    Section.find({ _id: { $in: sectionIds } }).select("nameBn").lean(),
    User.find({ _id: { $in: [...userIds] } }).select("name").lean(),
    PrintRequest.find({
      purpose: "ASSIGNMENT",
      neededByKey: deliveryDateKey,
      classId: { $in: classIds },
      status: { $ne: "CANCELLED" },
    })
      .select("sectionId subject")
      .lean(),
  ]);
  const sectionNameById = new Map(sections.map((s) => [s._id.toString(), s.nameBn]));
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name]));
  const printedKeys = new Set(
    (printed as unknown as Array<{ sectionId?: { toString(): string }; subject?: string }>)
      .filter((p) => !!p.sectionId && !!p.subject)
      .map((p) => `${p.sectionId!.toString()}|${p.subject}`),
  );

  base.sections = rows
    .map((r) => {
      const fill = (p: HandoutPacket): HandoutPacket => ({
        ...p,
        subjectTeacherName: nameById.get(p.subjectTeacherId) ?? null,
        printRequested: printedKeys.has(`${r.sectionId}|${p.subject}`),
      });
      return {
        sectionId: r.sectionId,
        sectionNameBn: sectionNameById.get(r.sectionId) ?? "",
        classId: r.classId,
        classLevel: r.classLevel,
        lastPeriodNumber: r.lastPeriodNumber,
        lastPeriodSubject: r.lastPeriodSubject,
        handoutTeacherId: r.handoutTeacherId,
        handoutTeacherName: r.handoutTeacherId ? nameById.get(r.handoutTeacherId) ?? null : null,
        isCover: r.isCover,
        packets: r.packets.sort((a, b) => subjectOrder(a.subject) - subjectOrder(b.subject)).map(fill),
        nilPackets: r.nilPackets.sort((a, b) => subjectOrder(a.subject) - subjectOrder(b.subject)).map(fill),
      };
    })
    .sort((a, b) => a.classLevel - b.classLevel || a.sectionNameBn.localeCompare(b.sectionNameBn));
  return base;
}

/**
 * The Today-card read: the sections the caller hands out TODAY, or [] on any other
 * day. Delivery-day-only on purpose — this card is "carry these into the last
 * period", and a list shown a day early is a list acted on a day early. The office
 * board (`handoutBoard`) is the one that looks ahead, because preparation does.
 */
export async function myHandoutSections(userId: string, date: Date): Promise<HandoutSection[]> {
  const board = await handoutBoard(date, { forTeacherId: userId, deliveryDayOnly: true });
  return board.sections;
}

/** Total packets on a board — the number the cross-check is counted against. */
export function packetCount(sections: HandoutSection[]): number {
  return sections.reduce((n, s) => n + s.packets.length, 0);
}

/** Packets with no live print request — the office's "not ready yet" signal. */
export function unprintedCount(sections: HandoutSection[]): number {
  return sections.reduce((n, s) => n + s.packets.filter((p) => !p.printRequested).length, 0);
}
