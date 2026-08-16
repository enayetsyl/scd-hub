/**
 * AssignmentGiftService (AG-1/AG-2, D-#479–#483) — the owner's incentive rule:
 * submit EVERY assignment given on Thursday by its Sunday → a gift; do that four
 * weeks running → a higher gift.
 *
 * Nothing about a winner is stored (D-#479). Eligibility, the weekly win and the
 * streak are computed here from `AssignmentStudentRecord.stateDates` joined to
 * `AssignmentItem.dueDate`; only the physical handover lands in
 * `AssignmentGiftAward`. The Thursday→Sunday cadence and its holiday rolls come
 * free from `AssignmentItem.dueDate` (D-#86) — this module owns no calendar.
 *
 * The rules, in one place:
 *   on time   — the FIRST `SUBMITTED` stamp's Dhaka day-key ≤ the item's `dueDate`
 *               day-key. Quality ignored; a chased-but-on-time record counts;
 *               resubmission records (`resubOf`) are excluded entirely (D-#480).
 *   eligible  — ≥1 ISSUED assignment that week. Absence is NOT an excuse: an
 *               ABSENT_REDELIVER record must still be submitted (D-#481).
 *   settled   — only weeks whose due date has passed are judged; the live week is
 *               PENDING, never a loss (D-#481).
 *   streak    — won → +1, lost → 0, not-eligible → carried unchanged (bridged,
 *               D-#482). The counter rolls; the higher gift fires only when
 *               `streak % 4 === 0` (D-#483).
 *
 * Identity/operational plane; NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { AssignmentItem } from "../models/AssignmentItem";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { AssignmentGiftAward, type GiftAwardKind } from "../models/AssignmentGiftAward";
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { dateOnlyISO } from "../assignmentCalendar";
import type { HwSubject, LifecycleState } from "@scd/shared";

/** Weeks per higher-gift block (D-#483). Mirrors the 4-week rotation cycle. */
export const GIFT_STREAK_BLOCK = 4;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/** An assignment the student has not (yet) got in on time. While the week is live
 *  this is "still awaited"; once settled it is "missed". */
export interface GiftMissedItem {
  asId: string;
  subject: HwSubject;
  /** Current lifecycle state (DUE / CHASE / ABSENT_REDELIVER, or a late SUBMITTED). */
  state: LifecycleState;
  /** True when it was submitted, but after the due date. */
  lateSubmission: boolean;
}

/**
 * Per (student × week) outcome (D-#497 — supersedes D-#481's blanket settled gate).
 *   WON       — settled, everything in on time. Final.
 *   QUALIFIED — the week is still LIVE but every issued assignment is already in
 *               on time. Counts as a win now; still provisional, because a teacher
 *               may confirm an extra subject later in the same week
 *               (`confirmAssignmentWeek` re-runs for new drafts), which puts the
 *               student back to PENDING.
 *   PENDING   — the week is live and at least one assignment is unmarked. Neither
 *               a win nor a loss: it does NOT break a streak.
 *   LOST      — settled and at least one assignment was late or never submitted.
 */
export type GiftWeekStatus = "WON" | "QUALIFIED" | "PENDING" | "LOST";

export interface GiftWeek {
  weekNumber: number;
  /** UTC-midnight ISO of the due day, or null when the student had no items. */
  dueDate: string | null;
  /** False while the due date is still in the future. */
  settled: boolean;
  status: GiftWeekStatus;
  issued: number;
  onTime: number;
  /** Issued assignments with no on-time SUBMITTED stamp yet. */
  outstanding: number;
  /** WON or QUALIFIED — i.e. counts toward the streak and the weekly gift. */
  won: boolean;
  /** QUALIFIED rather than WON — a win that the week could still take back. */
  provisional: boolean;
  /** The outstanding assignments: what is still awaited (live) or was missed (settled). */
  missed: GiftMissedItem[];
}

export interface GiftAwardDTO {
  id: string;
  kind: GiftAwardKind;
  weekNumber: number;
  streakLength: number | null;
  handedOverAt: Date;
  handedOverBy: string;
  handedOverByName: string | null;
  note: string | null;
  /**
   * False when the derivation no longer names this student a winner for that week —
   * the gift was handed over, then a revert (D-#338) or a mid-week extra subject
   * changed the answer underneath it. Surfaced rather than hidden: the ledger
   * records what physically happened and must not be silently rewritten.
   */
  entitlementHolds: boolean;
}

export interface GiftStudentRow {
  studentId: string;
  studentName: string;
  schoolId: string;
  rollNumber: string | null;
  classId: string;
  sectionId: string;
  /** Only the weeks inside [weekFrom, weekTo] — the streak is derived over the
   *  student's WHOLE history up to weekTo, not just this window. */
  weeks: GiftWeek[];
  /** Weeks won inside the window (WON or QUALIFIED). */
  wonWeeks: number[];
  /** Weeks inside the window still awaiting data entry (PENDING). */
  pendingWeeks: number[];
  /** Consecutive wins as of weekTo (bridged over non-eligible and pending weeks). */
  currentStreak: number;
  bestStreak: number;
  /** Weeks (anywhere up to weekTo) where the streak closed a 4-block — the
   *  higher-gift entitlements. */
  streakMilestoneWeeks: number[];
  /** Handover rows already recorded for this student, any week up to weekTo. */
  awards: GiftAwardDTO[];
}

export interface GiftReport {
  academicYearId: string;
  weekFrom: number;
  weekTo: number;
  /** Due date per week in the window (null = no assignments anywhere that week). */
  weekDueDates: Array<{ weekNumber: number; dueDate: string | null; settled: boolean }>;
  students: GiftStudentRow[];
}

export interface GiftFilter {
  academicYearId: string;
  /** Defaults to weekTo − 3 (the current 4-block), floored at 1. */
  weekFrom?: number;
  /** Defaults to the highest week that has any ISSUED item. */
  weekTo?: number;
  classId?: string;
  sectionId?: string;
  /** Test seam — "today" for the settled-week gate. */
  asOf?: Date;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ItemLean {
  _id: Types.ObjectId;
  asId: string;
  weekNumber: number;
  dueDate: Date;
  subject: HwSubject;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
}

interface RecordLean {
  asItemId: Types.ObjectId;
  studentId: Types.ObjectId;
  state: LifecycleState;
  stateDates: Array<{ state: LifecycleState; at: Date }>;
}

/**
 * The FIRST `SUBMITTED` stamp, not the last: `CHASE → SUBMITTED → CHASE` is a
 * legal cycle (lifecycle.ts), so a re-collection must not overwrite an on-time
 * original (D-#480).
 */
function firstSubmittedAt(stateDates: RecordLean["stateDates"]): Date | null {
  for (const s of stateDates) {
    if (s.state === "SUBMITTED") return s.at;
  }
  return null;
}

/**
 * Day-KEY comparison, never an instant compare: `dueDate` is a date-only
 * local-midnight value (`atMidnight`, assignmentCalendar.ts), so `at <= dueDate`
 * would cut the deadline at 00:00 of the due day and fail everyone who submitted
 * during the actual school day. `dhakaDayKey` yields the intended calendar day
 * under both a UTC and an Asia/Dhaka server, so this compare is TZ-stable
 * (D-#480). ISO "YYYY-MM-DD" keys order correctly as strings.
 */
function submittedOnTime(submittedAt: Date | null, dueDate: Date): boolean {
  if (!submittedAt) return false;
  return dhakaDayKey(submittedAt) <= dhakaDayKey(dueDate);
}

/** A week is judged only once its due day has fully passed (D-#481). */
function isSettled(dueDate: Date, asOf: Date): boolean {
  return dhakaDayKey(dueDate) < dhakaDayKey(asOf);
}

interface WeekTally {
  weekNumber: number;
  dueDate: Date | null;
  issued: number;
  onTime: number;
  missed: GiftMissedItem[];
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export async function assignmentGiftReport(filter: GiftFilter): Promise<GiftReport> {
  const asOf = filter.asOf ?? new Date();
  const yearId = new Types.ObjectId(filter.academicYearId);

  const scope: Record<string, unknown> = { academicYearId: yearId, status: "ISSUED" };
  if (filter.classId) scope.classId = new Types.ObjectId(filter.classId);
  if (filter.sectionId) scope.sectionId = new Types.ObjectId(filter.sectionId);

  // weekTo defaults to the last week that actually has issued work.
  let weekTo = filter.weekTo;
  if (weekTo === undefined) {
    const last = (await AssignmentItem.findOne(scope)
      .sort({ weekNumber: -1 })
      .select("weekNumber")
      .lean()) as unknown as { weekNumber: number } | null;
    weekTo = last?.weekNumber ?? 0;
  }
  const weekFrom = Math.max(1, filter.weekFrom ?? weekTo - (GIFT_STREAK_BLOCK - 1));

  if (weekTo < 1) {
    return { academicYearId: filter.academicYearId, weekFrom: 1, weekTo: 0, weekDueDates: [], students: [] };
  }

  // The streak needs the student's WHOLE history up to weekTo — deriving only over
  // the visible window would restart every streak at the window's first week.
  const items = (await AssignmentItem.find({ ...scope, weekNumber: { $lte: weekTo } })
    .select("asId weekNumber dueDate subject classId sectionId")
    .lean()) as unknown as ItemLean[];

  if (items.length === 0) {
    return { academicYearId: filter.academicYearId, weekFrom, weekTo, weekDueDates: [], students: [] };
  }

  const itemById = new Map(items.map((i) => [i._id.toString(), i]));

  // `resubOf: null` matches BOTH a missing field and an explicit null — the
  // resubmission exclusion of D-#480 pushed down to Mongo.
  const records = (await AssignmentStudentRecord.find({
    asItemId: { $in: items.map((i) => i._id) },
    resubOf: null,
  })
    .select("asItemId studentId state stateDates")
    .lean()) as unknown as RecordLean[];

  // studentId → weekNumber → tally
  const byStudent = new Map<string, Map<number, WeekTally>>();
  for (const rec of records) {
    const item = itemById.get(rec.asItemId.toString());
    if (!item) continue;
    const sid = rec.studentId.toString();
    let weeks = byStudent.get(sid);
    if (!weeks) {
      weeks = new Map();
      byStudent.set(sid, weeks);
    }
    let tally = weeks.get(item.weekNumber);
    if (!tally) {
      tally = { weekNumber: item.weekNumber, dueDate: item.dueDate, issued: 0, onTime: 0, missed: [] };
      weeks.set(item.weekNumber, tally);
    }
    // Sections share the school calendar, but keep the latest due date defensively.
    if (!tally.dueDate || item.dueDate > tally.dueDate) tally.dueDate = item.dueDate;

    tally.issued += 1;
    const submittedAt = firstSubmittedAt(rec.stateDates);
    if (submittedOnTime(submittedAt, item.dueDate)) {
      tally.onTime += 1;
    } else {
      tally.missed.push({
        asId: item.asId,
        subject: item.subject,
        state: rec.state,
        lateSubmission: submittedAt !== null,
      });
    }
  }

  const studentIds = [...byStudent.keys()];
  const [students, awards] = await Promise.all([
    Student.find({ _id: { $in: studentIds } })
      .select("name schoolId rollNumber classId sectionId")
      .lean() as unknown as Promise<
      Array<{
        _id: Types.ObjectId;
        name: string;
        schoolId: string;
        rollNumber?: string;
        classId: Types.ObjectId;
        sectionId: Types.ObjectId;
      }>
    >,
    AssignmentGiftAward.find({
      academicYearId: yearId,
      studentId: { $in: studentIds },
      weekNumber: { $lte: weekTo },
    }).lean() as unknown as Promise<
      Array<{
        _id: Types.ObjectId;
        studentId: Types.ObjectId;
        kind: GiftAwardKind;
        weekNumber: number;
        streakLength?: number;
        handedOverAt: Date;
        handedOverBy: Types.ObjectId;
        note?: string;
      }>
    >,
  ]);
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));

  const handoverUserIds = [...new Set(awards.map((a) => a.handedOverBy.toString()))];
  const handoverNames = handoverUserIds.length
    ? ((await User.find({ _id: { $in: handoverUserIds } })
        .select("name")
        .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string }>)
    : [];
  const userNameById = new Map(handoverNames.map((u) => [u._id.toString(), u.name]));

  const awardsByStudent = new Map<string, GiftAwardDTO[]>();
  for (const a of awards) {
    const sid = a.studentId.toString();
    const list = awardsByStudent.get(sid) ?? [];
    list.push({
      id: a._id.toString(),
      kind: a.kind,
      weekNumber: a.weekNumber,
      streakLength: a.streakLength ?? null,
      handedOverAt: a.handedOverAt,
      handedOverBy: a.handedOverBy.toString(),
      handedOverByName: userNameById.get(a.handedOverBy.toString()) ?? null,
      note: a.note ?? null,
      entitlementHolds: true, // re-checked against the derivation in the walk below
    });
    awardsByStudent.set(sid, list);
  }

  // Week-level due dates for the window header (max across sections in scope).
  const weekDue = new Map<number, Date>();
  for (const i of items) {
    const cur = weekDue.get(i.weekNumber);
    if (!cur || i.dueDate > cur) weekDue.set(i.weekNumber, i.dueDate);
  }
  const weekDueDates: GiftReport["weekDueDates"] = [];
  for (let w = weekFrom; w <= weekTo; w++) {
    const d = weekDue.get(w) ?? null;
    weekDueDates.push({
      weekNumber: w,
      dueDate: d ? dateOnlyISO(d) : null,
      settled: d ? isSettled(d, asOf) : false,
    });
  }

  const rows: GiftStudentRow[] = [];
  for (const [sid, weeks] of byStudent) {
    const student = studentById.get(sid);
    if (!student) continue; // deleted/unknown roster row — nothing to report on

    let streak = 0;
    let bestStreak = 0;
    const milestoneWeeks: number[] = [];
    const windowWeeks: GiftWeek[] = [];
    const wonWeeks: number[] = [];
    const pendingWeeks: number[] = [];
    /** Full-history wins — the window-limited `wonWeeks` cannot validate an award
     *  handed over before the visible block. */
    const allWonWeeks = new Set<number>();

    // Ascending walk over the WHOLE history to weekTo (D-#482 bridging).
    for (let w = 1; w <= weekTo; w++) {
      const tally = weeks.get(w);
      const settled = tally?.dueDate ? isSettled(tally.dueDate, asOf) : false;
      const eligible = !!tally && tally.issued >= 1;
      const outstanding = tally ? tally.issued - tally.onTime : 0;

      // D-#497 — four outcomes, not two. A LIVE week with everything already in
      // is a win NOW (nothing outstanding can arrive late); a live week with work
      // still unmarked is PENDING and must not touch the streak either way.
      let status: GiftWeekStatus;
      if (!eligible) {
        status = "PENDING"; // no work set — bridged below, never shown as a win
      } else if (outstanding === 0) {
        status = settled ? "WON" : "QUALIFIED";
      } else {
        status = settled ? "LOST" : "PENDING";
      }
      const won = eligible && (status === "WON" || status === "QUALIFIED");

      if (won) {
        allWonWeeks.add(w);
        streak += 1;
        if (streak > bestStreak) bestStreak = streak;
        if (streak % GIFT_STREAK_BLOCK === 0) milestoneWeeks.push(w);
      } else if (status === "LOST") {
        streak = 0;
      }
      // PENDING (live, or no work set) → carried unchanged (bridged, D-#482).

      if (w >= weekFrom) {
        windowWeeks.push({
          weekNumber: w,
          dueDate: tally?.dueDate ? dateOnlyISO(tally.dueDate) : null,
          settled,
          status,
          issued: tally?.issued ?? 0,
          onTime: tally?.onTime ?? 0,
          outstanding,
          won,
          provisional: status === "QUALIFIED",
          missed: tally?.missed ?? [],
        });
        if (won) wonWeeks.push(w);
        else if (eligible && status === "PENDING") pendingWeeks.push(w);
      }
    }

    rows.push({
      studentId: sid,
      studentName: student.name,
      schoolId: student.schoolId,
      rollNumber: student.rollNumber ?? null,
      classId: student.classId.toString(),
      sectionId: student.sectionId.toString(),
      weeks: windowWeeks,
      wonWeeks,
      pendingWeeks,
      currentStreak: streak,
      bestStreak,
      streakMilestoneWeeks: milestoneWeeks,
      awards: (awardsByStudent.get(sid) ?? []).map((a) => ({
        ...a,
        entitlementHolds:
          a.kind === "WEEKLY" ? allWonWeeks.has(a.weekNumber) : milestoneWeeks.includes(a.weekNumber),
      })),
    });
  }

  // Longest current streak first, then most wins in the window, then name —
  // the owner reads this to hand out gifts, so the winners sort to the top.
  rows.sort(
    (a, b) =>
      b.currentStreak - a.currentStreak ||
      b.wonWeeks.length - a.wonWeeks.length ||
      a.studentName.localeCompare(b.studentName),
  );

  return { academicYearId: filter.academicYearId, weekFrom, weekTo, weekDueDates, students: rows };
}

// ---------------------------------------------------------------------------
// Entitlement + handover (AG-2)
// ---------------------------------------------------------------------------

export interface GiftEntitlement {
  entitled: boolean;
  /** Entitled off a LIVE week (QUALIFIED) rather than a settled one — the gift may
   *  legitimately be handed over now, but an extra subject confirmed later in the
   *  same week can withdraw it (D-#497). */
  provisional: boolean;
  /** The week's outcome, for a message that says WHY when not entitled. */
  status: GiftWeekStatus | null;
  /** The streak at that week — set for a STREAK entitlement. */
  streakLength: number | null;
  classId: string;
  sectionId: string;
}

/**
 * Re-derive whether `studentId` is entitled to `kind` at `weekNumber` (D-#479 —
 * the award never creates entitlement). Deliberately re-runs the full derivation
 * rather than trusting what the screen was showing: the report may have been open
 * across a revert, and a gift handed off a stale number is exactly the failure the
 * derive-on-read design exists to prevent.
 */
export async function giftEntitlement(
  academicYearId: string,
  studentId: string,
  kind: GiftAwardKind,
  weekNumber: number,
  asOf?: Date,
): Promise<GiftEntitlement> {
  const report = await assignmentGiftReport({
    academicYearId,
    weekFrom: weekNumber,
    weekTo: weekNumber,
    asOf,
  });
  const row = report.students.find((s) => s.studentId === studentId);
  if (!row) {
    return {
      entitled: false,
      provisional: false,
      status: null,
      streakLength: null,
      classId: "",
      sectionId: "",
    };
  }
  const week = row.weeks.find((w) => w.weekNumber === weekNumber) ?? null;
  const entitled =
    kind === "WEEKLY"
      ? row.wonWeeks.includes(weekNumber)
      : row.streakMilestoneWeeks.includes(weekNumber);
  return {
    entitled,
    provisional: entitled && week?.provisional === true,
    status: week?.status ?? null,
    streakLength: kind === "STREAK" && entitled ? row.currentStreak : null,
    classId: row.classId,
    sectionId: row.sectionId,
  };
}

export interface HandoverInput {
  academicYearId: string;
  studentId: string;
  kind: GiftAwardKind;
  weekNumber: number;
  note?: string;
  handedOverBy: string;
  asOf?: Date;
}

/** Record that the gift was physically given. Idempotent on the unique key. */
export async function recordGiftHandover(input: HandoverInput): Promise<GiftAwardDTO> {
  const ent = await giftEntitlement(
    input.academicYearId,
    input.studentId,
    input.kind,
    input.weekNumber,
    input.asOf,
  );
  if (!ent.entitled) {
    // Say WHY: "still waiting on entries" is a different problem for the office
    // than "this student missed one", and only the first is worth coming back to.
    if (input.kind === "WEEKLY" && ent.status === "PENDING") {
      throw new Error("এই সপ্তাহের সব অ্যাসাইনমেন্টের তথ্য এখনও ওঠেনি — বাকিটা উঠলে উপহার দেওয়া যাবে");
    }
    throw new Error(
      input.kind === "WEEKLY"
        ? "এই সপ্তাহে শিক্ষার্থী সব অ্যাসাইনমেন্ট সময়মতো জমা দেয়নি — উপহার দেওয়া যাবে না"
        : "এই সপ্তাহে শিক্ষার্থীর ৪ সপ্তাহের ধারা পূর্ণ হয়নি — বড় উপহার দেওয়া যাবে না",
    );
  }

  const student = (await Student.findById(input.studentId)
    .select("classId sectionId")
    .lean()) as unknown as { classId: Types.ObjectId; sectionId: Types.ObjectId } | null;
  if (!student) throw new Error("শিক্ষার্থী পাওয়া যায়নি");

  // Read the level off the class rather than trusting anything client-supplied.
  const cls = (await Class.findById(student.classId).select("level").lean()) as unknown as {
    level: number;
  } | null;
  if (!cls) throw new Error("শ্রেণি পাওয়া যায়নি");
  const classLevel = cls.level;

  const now = new Date();
  const doc = await AssignmentGiftAward.findOneAndUpdate(
    {
      academicYearId: new Types.ObjectId(input.academicYearId),
      studentId: new Types.ObjectId(input.studentId),
      kind: input.kind,
      weekNumber: input.weekNumber,
    },
    {
      $setOnInsert: {
        classId: student.classId,
        classLevel,
        sectionId: student.sectionId,
        streakLength: ent.streakLength ?? undefined,
        handedOverAt: now,
        handedOverBy: new Types.ObjectId(input.handedOverBy),
        note: input.note?.trim() || undefined,
      },
    },
    { upsert: true, new: true },
  ).lean();

  const a = doc as unknown as {
    _id: Types.ObjectId;
    kind: GiftAwardKind;
    weekNumber: number;
    streakLength?: number;
    handedOverAt: Date;
    handedOverBy: Types.ObjectId;
    note?: string;
  };
  const by = (await User.findById(a.handedOverBy).select("name").lean()) as unknown as {
    name: string;
  } | null;
  return {
    id: a._id.toString(),
    kind: a.kind,
    weekNumber: a.weekNumber,
    streakLength: a.streakLength ?? null,
    handedOverAt: a.handedOverAt,
    handedOverBy: a.handedOverBy.toString(),
    handedOverByName: by?.name ?? null,
    note: a.note ?? null,
    entitlementHolds: true, // just re-derived above
  };
}

/** Undo a mis-tick. Returns true when a row was actually removed. */
export async function undoGiftHandover(
  academicYearId: string,
  studentId: string,
  kind: GiftAwardKind,
  weekNumber: number,
): Promise<boolean> {
  const res = await AssignmentGiftAward.deleteOne({
    academicYearId: new Types.ObjectId(academicYearId),
    studentId: new Types.ObjectId(studentId),
    kind,
    weekNumber,
  });
  return res.deletedCount > 0;
}
