/**
 * HomeworkLifecycleReportService — the Principal/Office "বাড়ির কাজ লাইফসাইকেল
 * রিপোর্ট", REDESIGNED teacher-first (D-#350, supersedes the D-#300 section×subject
 * five-card layout). Two reads:
 *
 *   1. homeworkLifecycleReport(from, to, opts) — a filterable (date range + class
 *      + subject) per-TEACHER lifecycle table: how many items each teacher
 *      declared / issued / gave, and how many student records reached submitted /
 *      checked / returned, plus the actionable PENDING buckets (awaiting
 *      submission / checking / return, and chased-still-pending). The red checking
 *      backlog (SUBMITTED > N days, naming the declaring teacher) rides along.
 *
 *   2. homeworkLifecyclePending(from, to, teacherId, stage, opts) — the drill-down
 *      behind any pending number: the named students stuck at that stage, with
 *      class-section, roll, the primary guardian phone (to chase), current state,
 *      and how many days they have been waiting.
 *
 * Pure read over existing data (stateDates is a full timestamped audit trail) —
 * no schema change. Identity/operational plane; the pending drill names students
 * and guardian phones — allowed here (ADR-005 only forbids the CORPUS plane from
 * joining back to identity; this service is never imported by corpus).
 */
import type { LifecycleState } from "@scd/shared";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { Student } from "../../foundation/models/Student";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { resolveSubjectTeachers } from "../subjectTeacher";
import {
  AWAITING_CHECK_STATES as AWAITING_CHECK,
  AWAITING_RETURN_STATES as AWAITING_RETURN,
  PRE_SUBMIT_STATES as PRE_SUBMIT,
  currentStateSince,
  dayRangeBounds,
  everReached,
} from "../lifecycleBuckets";

export const HW_CHECKING_BACKLOG_DAYS = 2;
const DAY_MS = 86_400_000;

/** The four drillable pending stages. */
export type HwPendingStage = "SUBMISSION" | "CHECK" | "RETURN" | "CHASE";

export const HW_PENDING_STAGES: readonly HwPendingStage[] = ["SUBMISSION", "CHECK", "RETURN", "CHASE"];

export function isHwPendingStage(s: string): s is HwPendingStage {
  return (HW_PENDING_STAGES as readonly string[]).includes(s);
}

/** Current-state set a stage's pending records live in. */
function statesForStage(stage: HwPendingStage): readonly LifecycleState[] {
  switch (stage) {
    case "CHECK":
      return AWAITING_CHECK;
    case "RETURN":
      return AWAITING_RETURN;
    case "SUBMISSION":
    case "CHASE":
      return PRE_SUBMIT;
  }
}

export interface HwLifecycleFilters {
  classLevel?: number | null;
  subject?: string | null;
  now?: Date;
}

export interface HwTeacherLifecycleRow {
  teacherId: string;
  teacherName: string;
  /** Layer-A items declared by this teacher in range. */
  declaredItems: number;
  /** …of which issued (student records spawned). */
  issuedItems: number;
  /** Per-student records spawned (the true "given" count). */
  given: number;
  /** Records that ever reached each state. */
  submitted: number;
  checked: number;
  returned: number;
  /** PENDING (current-state) buckets — the actionable, drillable numbers. */
  pendingSubmission: number;
  pendingChecking: number;
  pendingReturn: number;
  /** Chased and still not submitted. */
  chasedPending: number;
}

export interface HwBacklogRow {
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  /** The declaring teacher — whose checking queue this is. */
  teacherName: string | null;
  count: number;
  oldestDays: number;
}

export interface HwLifecycleReport {
  fromKey: string;
  toKey: string;
  backlogThresholdDays: number;
  teachers: HwTeacherLifecycleRow[];
  backlog: HwBacklogRow[];
}

export interface HwPendingStudent {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  sectionNameBn: string | null;
  classLevel: number;
  subject: string;
  /** Primary guardian phone (earliest active link), or the student's own contact. */
  guardianPhone: string | null;
  /** Current atomic lifecycle state. */
  state: string;
  /** Whole days sitting in the current state. */
  daysWaiting: number;
  chaseCount: number;
  /** Grouping + navigation (owner ask 2026-08-04): the drill lists DATE + CLASS and
   *  opens the matching workspace card, instead of a flat roll of names and phones. */
  hwItemId: string;
  dateGiven: string;
  sectionId: string;
  classId: string;
}

interface SectionMeta {
  nameBn: string;
  classLevel: number;
  classId: string;
}

/** Build the HomeworkItem filter shared by the report + the drill (D-#350). */
function itemFilter(
  start: Date,
  end: Date,
  opts: { classLevel?: number | null; subject?: string | null } = {},
): Record<string, unknown> {
  const f: Record<string, unknown> = { dateGiven: { $gte: start, $lte: end } };
  if (opts.classLevel != null) f.classLevel = opts.classLevel;
  if (opts.subject) f.subject = opts.subject;
  return f;
}

interface ItemLite {
  _id: { toString(): string };
  sectionId: { toString(): string };
  subject: string;
  dateGiven: Date;
  declaredBy: { toString(): string };
}

/**
 * Attribute each homework item to its ACCOUNTABLE subject teacher (D-#350 owner
 * finding) — the routine's teacher for that section×subject, NOT whoever
 * physically declared it. A Principal/Office data-entry on a teacher's behalf
 * must land in that teacher's row, not the entrant's. Falls back to the declarer
 * only when the routine names no teacher for the cell (e.g. an unscheduled
 * catch-up subject).
 *
 * The routine walk itself lives in ../subjectTeacher so the class-test tracker
 * resolves attribution by the identical rule.
 */
async function accountableTeacherByItem(items: ItemLite[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (items.length === 0) return out;

  const resolved = await resolveSubjectTeachers(
    items.map((i) => ({
      key: i._id.toString(),
      sectionId: i.sectionId.toString(),
      subject: i.subject,
      on: new Date(i.dateGiven),
    })),
  );
  for (const it of items) {
    const k = it._id.toString();
    out.set(k, resolved.get(k) ?? it.declaredBy.toString());
  }
  return out;
}

export async function homeworkLifecycleReport(
  fromKey: string,
  toKey: string,
  opts: HwLifecycleFilters = {},
): Promise<HwLifecycleReport> {
  const now = opts.now ?? new Date();
  const { start, end } = dayRangeBounds(fromKey, toKey);

  const items = await HomeworkItem.find(itemFilter(start, end, opts))
    .select("sectionId classId classLevel subject status declaredBy dateGiven")
    .lean();

  const records =
    items.length === 0
      ? []
      : await HomeworkStudentRecord.find({ hwItemId: { $in: items.map((i) => i._id) } })
          .select("hwItemId state stateDates chaseCount")
          .lean();

  const itemById = new Map(items.map((i) => [i._id.toString(), i]));
  // Attribute every item to its accountable subject teacher (routine), not the
  // declarer (D-#350 owner finding: a Principal's on-behalf entry belongs to the
  // subject teacher's row).
  const accById = await accountableTeacherByItem(items as unknown as ItemLite[]);
  const teacherOfItem = (it: { _id: { toString(): string }; declaredBy: { toString(): string } }): string =>
    accById.get(it._id.toString()) ?? it.declaredBy.toString();

  // --- per-teacher accumulation -------------------------------------------------
  interface TeacherAcc {
    declaredItems: number;
    issuedItems: number;
    given: number;
    submitted: number;
    checked: number;
    returned: number;
    pendingSubmission: number;
    pendingChecking: number;
    pendingReturn: number;
    chasedPending: number;
  }
  const teacherAcc = new Map<string, TeacherAcc>();
  const teacherFor = (id: string): TeacherAcc => {
    let a = teacherAcc.get(id);
    if (!a) {
      a = {
        declaredItems: 0, issuedItems: 0, given: 0, submitted: 0, checked: 0, returned: 0,
        pendingSubmission: 0, pendingChecking: 0, pendingReturn: 0, chasedPending: 0,
      };
      teacherAcc.set(id, a);
    }
    return a;
  };

  for (const it of items) {
    const a = teacherFor(teacherOfItem(it));
    a.declaredItems += 1;
    if (it.status === "issued") a.issuedItems += 1;
  }

  // --- checking backlog, keyed per (cell × declaring teacher) --------------------
  interface BacklogAcc { sectionId: string; subject: string; teacherId: string | null; count: number; oldestDays: number }
  const backlogAcc = new Map<string, BacklogAcc>();

  for (const r of records) {
    const it = itemById.get(r.hwItemId.toString());
    if (!it) continue;
    const a = teacherFor(teacherOfItem(it));
    const stamps = (r.stateDates ?? []) as Array<{ state: string; at: Date }>;
    const state = r.state as LifecycleState;

    a.given += 1;
    if (everReached(stamps, "SUBMITTED")) a.submitted += 1;
    if (everReached(stamps, "CHECKED")) a.checked += 1;
    if (everReached(stamps, "RETURNED")) a.returned += 1;

    const chased = (r.chaseCount ?? 0) > 0;
    if ((PRE_SUBMIT as readonly string[]).includes(state)) {
      a.pendingSubmission += 1;
      if (chased) a.chasedPending += 1;
    } else if (state === "SUBMITTED") {
      a.pendingChecking += 1;
    } else if ((AWAITING_RETURN as readonly string[]).includes(state)) {
      a.pendingReturn += 1;
    }

    // Red backlog: SUBMITTED sitting > threshold.
    if (state === "SUBMITTED") {
      const since = currentStateSince(stamps, "SUBMITTED");
      if (since) {
        const waitDays = (now.getTime() - since.getTime()) / DAY_MS;
        if (waitDays > HW_CHECKING_BACKLOG_DAYS) {
          const tid = teacherOfItem(it);
          const bk = `${it.sectionId.toString()}|${it.subject}|${tid}`;
          const b =
            backlogAcc.get(bk) ??
            backlogAcc
              .set(bk, { sectionId: it.sectionId.toString(), subject: it.subject, teacherId: tid, count: 0, oldestDays: 0 })
              .get(bk)!;
          b.count += 1;
          b.oldestDays = Math.max(b.oldestDays, Math.floor(waitDays));
        }
      }
    }
  }

  // --- enrich names -------------------------------------------------------------
  const sectionIds = new Set<string>();
  for (const b of backlogAcc.values()) sectionIds.add(b.sectionId);
  const sections = sectionIds.size
    ? await Section.find({ _id: { $in: [...sectionIds] } }).select("nameBn classId").lean()
    : [];
  const classes = sections.length
    ? await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("level").lean()
    : [];
  const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level]));
  const metaOf = new Map<string, SectionMeta>(
    sections.map((s) => [
      s._id.toString(),
      { nameBn: s.nameBn, classLevel: levelOf.get(s.classId.toString()) ?? 0, classId: s.classId.toString() },
    ]),
  );
  const meta = (sectionId: string): SectionMeta =>
    metaOf.get(sectionId) ?? { nameBn: sectionId, classLevel: 0, classId: "" };

  const teachers = await User.find({ _id: { $in: [...teacherAcc.keys()] } }).select("name").lean();
  const teacherNameOf = new Map(teachers.map((u) => [u._id.toString(), u.name]));

  const teacherRows: HwTeacherLifecycleRow[] = [...teacherAcc.entries()]
    .map(([teacherId, a]) => ({
      teacherId,
      teacherName: teacherNameOf.get(teacherId) ?? teacherId,
      declaredItems: a.declaredItems,
      issuedItems: a.issuedItems,
      given: a.given,
      submitted: a.submitted,
      checked: a.checked,
      returned: a.returned,
      pendingSubmission: a.pendingSubmission,
      pendingChecking: a.pendingChecking,
      pendingReturn: a.pendingReturn,
      chasedPending: a.chasedPending,
    }))
    // Most stuck first: total pending, then most given.
    .sort(
      (x, y) =>
        y.pendingSubmission + y.pendingChecking + y.pendingReturn -
          (x.pendingSubmission + x.pendingChecking + x.pendingReturn) ||
        y.given - x.given ||
        x.teacherName.localeCompare(y.teacherName),
    );

  const backlog: HwBacklogRow[] = [...backlogAcc.values()]
    .map((b) => ({
      sectionId: b.sectionId,
      sectionNameBn: meta(b.sectionId).nameBn,
      classLevel: meta(b.sectionId).classLevel,
      subject: b.subject,
      teacherName: b.teacherId ? (teacherNameOf.get(b.teacherId) ?? null) : null,
      count: b.count,
      oldestDays: b.oldestDays,
    }))
    .sort((a, b) => b.oldestDays - a.oldestDays || b.count - a.count);

  return { fromKey, toKey, backlogThresholdDays: HW_CHECKING_BACKLOG_DAYS, teachers: teacherRows, backlog };
}

/**
 * The drill-down behind a pending number (D-#350): the named students stuck at
 * `stage` for one teacher, within the same date/class/subject filters.
 */
export async function homeworkLifecyclePending(
  fromKey: string,
  toKey: string,
  teacherId: string,
  stage: HwPendingStage,
  opts: HwLifecycleFilters = {},
): Promise<HwPendingStudent[]> {
  const now = opts.now ?? new Date();
  const { start, end } = dayRangeBounds(fromKey, toKey);

  const allItems = await HomeworkItem.find(itemFilter(start, end, opts))
    .select("sectionId subject classLevel dateGiven declaredBy")
    .lean();
  if (allItems.length === 0) return [];
  // Keep only items this teacher is ACCOUNTABLE for (routine subject teacher), so
  // the drill matches the card's attribution — not the declarer (D-#350 finding).
  const accById = await accountableTeacherByItem(allItems as unknown as ItemLite[]);
  const items = allItems.filter(
    (it) => (accById.get(it._id.toString()) ?? it.declaredBy.toString()) === teacherId,
  );
  if (items.length === 0) return [];
  const subjectOf = new Map(
    items.map((i) => [
      i._id.toString(),
      { subject: i.subject, classLevel: i.classLevel, dateGiven: new Date(i.dateGiven).toISOString() },
    ]),
  );

  const recFilter: Record<string, unknown> = {
    hwItemId: { $in: items.map((i) => i._id) },
    state: { $in: statesForStage(stage) },
  };
  if (stage === "CHASE") recFilter.chaseCount = { $gt: 0 };

  const records = await HomeworkStudentRecord.find(recFilter)
    .select("hwItemId studentId sectionId state stateDates chaseCount")
    .lean();
  if (records.length === 0) return [];

  const studentIds = [...new Set(records.map((r) => r.studentId.toString()))];
  const sectionIds = [...new Set(records.map((r) => r.sectionId.toString()))];

  const [students, sections, links] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).select("name nameBn rollNumber phone").lean(),
    Section.find({ _id: { $in: sectionIds } }).select("nameBn classId").lean(),
    GuardianLink.find({ studentId: { $in: studentIds }, active: { $ne: false } })
      .select("studentId guardianId createdAt")
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  const classes = sections.length
    ? await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("level").lean()
    : [];
  const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level]));
  const sectionMeta = new Map<string, SectionMeta>(
    sections.map((s) => [
      s._id.toString(),
      { nameBn: s.nameBn, classLevel: levelOf.get(s.classId.toString()) ?? 0, classId: s.classId.toString() },
    ]),
  );
  const studentOf = new Map(students.map((s) => [s._id.toString(), s]));

  // Primary guardian phone = earliest active link (links pre-sorted by createdAt).
  const primaryGuardianId = new Map<string, string>();
  for (const l of links) {
    const sid = l.studentId.toString();
    if (!primaryGuardianId.has(sid)) primaryGuardianId.set(sid, l.guardianId.toString());
  }
  const guardianIds = [...new Set(primaryGuardianId.values())];
  const guardians = guardianIds.length
    ? await Guardian.find({ _id: { $in: guardianIds } }).select("phone").lean()
    : [];
  const guardianPhoneOf = new Map(guardians.map((g) => [g._id.toString(), g.phone ?? null]));

  const rows: HwPendingStudent[] = records.map((r) => {
    const sid = r.studentId.toString();
    const stu = studentOf.get(sid);
    const sm = sectionMeta.get(r.sectionId.toString());
    const it = subjectOf.get(r.hwItemId.toString());
    const gid = primaryGuardianId.get(sid);
    const stamps = (r.stateDates ?? []) as Array<{ state: string; at: Date }>;
    const since = currentStateSince(stamps, r.state);
    const daysWaiting = since ? Math.floor((now.getTime() - since.getTime()) / DAY_MS) : 0;
    return {
      studentId: sid,
      name: stu?.name ?? sid,
      nameBn: stu?.nameBn ?? null,
      rollNumber: stu?.rollNumber ?? null,
      sectionNameBn: sm?.nameBn ?? null,
      classLevel: it?.classLevel ?? sm?.classLevel ?? 0,
      subject: it?.subject ?? "",
      guardianPhone: (gid ? guardianPhoneOf.get(gid) : null) ?? stu?.phone ?? null,
      state: r.state,
      daysWaiting,
      chaseCount: r.chaseCount ?? 0,
      hwItemId: r.hwItemId.toString(),
      dateGiven: it?.dateGiven ?? "",
      sectionId: r.sectionId.toString(),
      classId: sm?.classId ?? "",
    };
  });

  // Longest-waiting first — the sharpest end of the queue.
  rows.sort((a, b) => b.daysWaiting - a.daysWaiting || (b.chaseCount - a.chaseCount));
  return rows;
}
