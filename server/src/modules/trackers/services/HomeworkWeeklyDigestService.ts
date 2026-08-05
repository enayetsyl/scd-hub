/**
 * HomeworkWeeklyDigestService (D-#452) — the weekly guardian homework digest +
 * the staff weekly report's shared data core.
 *
 * Owner ask (2026-08-04): each Thursday the guardian receives the week's
 * still-unsubmitted homework — subject-wise, with date and details — plus the
 * digest day's freshly given homework as a weekend heads-up.
 *
 * Shape:
 *   digestWindowOf            — Sun..day−1 = unsubmitted window; the day itself
 *                               = heads-up window; weekStartKey = the dedupe scope
 *   isHomeworkWeeklyDigestDay — true on the LAST OPEN day of the Sun–Thu school
 *                               week (normally Thursday; a Thursday HolidayException
 *                               rolls BACK — the assignment-anchor direction,
 *                               computable by look-ahead because holidays are
 *                               declared in advance). resolveDayType stays the
 *                               one calendar source.
 *   homeworkWeeklyDigestData  — per-student subject-grouped lines. Unsubmitted
 *                               basis = OWED_BY_STUDENT_STATES (GIVEN/DUE/CHASE —
 *                               the D-#359 bucket; ABSENT_REDELIVER and RESUBMIT
 *                               excluded): CHASE is the honest post-D-#451 state,
 *                               GIVEN/DUE ride along as the safety net for a
 *                               missed sweep. Heads-up basis = LAYER A (items,
 *                               declared OR issued — records may not exist before
 *                               the 17:00 auto-issue), fanned to the class's
 *                               active students.
 *   dispatchHomeworkWeeklyDigest — render once (MT N+1 guard), emit per
 *                               guardian × child; skip students with no lines.
 *
 * Push bodies MUST self-cap: no channel-side truncation exists (pushChannel
 * sends bodyBn verbatim; Expo hard-drops >4KB payloads with only a GlitchTip
 * breadcrumb), so clampDigestBody + the line cap are load-bearing, not polish.
 *
 * Identity plane (names studentIds); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { HW_SUBJECT_LABELS_BN, LIFECYCLE_STATE_LABELS_BN } from "@scd/shared";
import type { HwSubject, LifecycleState } from "@scd/shared";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { OWED_BY_STUDENT_STATES, dayRangeBounds, inStates } from "../lifecycleBuckets";
import { weekStartSunday } from "../assignmentCalendar";
import { dateKeyOf, parseDateKey } from "../../attendance/dates";
import { resolveDayType } from "../../routine/calendar";
import { resolveHomeworkDueDate } from "../homeworkDueDate";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import { emitHomeworkWeeklyDigest } from "../../notifications/services/emitters";

/** Hard cap on the rendered body (chars). Expo's total-payload limit is 4096
 *  BYTES and Bangla is ~3 bytes/char UTF-8; ~1000 chars + title + refs stays
 *  safely under it. The inbox row shares the same body (one bodyBn per emit). */
export const HW_DIGEST_BODY_MAX_CHARS = 1000;
/** Line-shaped truncation before the char clamp: at most this many unsubmitted
 *  lines, then "+ আরও n টি" — a cut list, never a cut word. */
export const HW_DIGEST_MAX_LINES = 15;

export interface DigestWindow {
  /** dateKey of the week's Sunday — the digest's week id / dedupe scope. */
  weekStartKey: string;
  unsubFromKey: string;
  /** The day before the digest day (normally Wednesday). */
  unsubToKey: string;
  /** The digest day itself (normally Thursday) — the heads-up window. */
  headsUpKey: string;
}

export function digestWindowOf(digestDay: Date): DigestWindow {
  const headsUpKey = dateKeyOf(digestDay);
  const weekStartKey = dateKeyOf(weekStartSunday(digestDay));
  const prev = new Date(digestDay.getFullYear(), digestDay.getMonth(), digestDay.getDate() - 1);
  return {
    weekStartKey,
    unsubFromKey: weekStartKey,
    unsubToKey: dateKeyOf(prev),
    headsUpKey,
  };
}

/**
 * True iff `now` is the LAST OPEN day of this Sun–Thu school week: a school
 * weekday whose every LATER day through Thursday resolves OFF/HOLIDAY. On a
 * plain Thursday the later-set is empty → true. Saturday (QURAN_ONLY passes
 * the scheduler gate) is never a digest day. A fully closed week fires nothing.
 */
export async function isHomeworkWeeklyDigestDay(now: Date): Promise<boolean> {
  const dow = now.getDay();
  if (dow < 0 || dow > 4) return false; // Sun(0)–Thu(4) only
  const probe = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (;;) {
    probe.setDate(probe.getDate() + 1);
    if (probe.getDay() === 5) return true; // walked past Thursday — all later days closed
    const dayType = await resolveDayType(probe);
    if (dayType !== "OFF" && dayType !== "HOLIDAY") return false; // an open day still comes
  }
}

// ---------------------------------------------------------------------------
// Data core (shared by the guardian dispatch AND the staff weekly report)
// ---------------------------------------------------------------------------

export interface HwWeeklyItemLine {
  hwItemId: string;
  hwId: string;
  subject: string;
  subjectLabelBn: string;
  /** dateGiven as YYYY-MM-DD. */
  dateKey: string;
  description: string | null;
  state: string;
  stateLabelBn: string;
  chaseCount: number;
  /** The record's due date as YYYY-MM-DD (null when unset). */
  dueDateKey: string | null;
}

export interface HwWeeklyHeadsUpLine {
  hwItemId: string;
  hwId: string;
  subject: string;
  subjectLabelBn: string;
  description: string | null;
  qCount: number;
  timeDecl: number;
  /** The routine-aware due day for the fresh sheet (YYYY-MM-DD). */
  dueDateKey: string | null;
}

export interface HwWeeklyStudentDigest {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  /** Student contact phone (the shared family contact, D-#31/#59). */
  studentPhone: string | null;
  sectionId: string;
  sectionNameBn: string | null;
  classId: string;
  classLevel: number;
  /** Sorted subject-first, then dateKey. */
  unsubmitted: HwWeeklyItemLine[];
  headsUp: HwWeeklyHeadsUpLine[];
}

interface ItemLite {
  _id: Types.ObjectId;
  hwId: string;
  subject: string;
  dateGiven: Date;
  description?: string;
  qCount: number;
  timeDecl: number;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  classLevel: number;
  status: string;
}

const subjectBn = (s: string): string => (HW_SUBJECT_LABELS_BN as Record<string, string>)[s] ?? s;
const stateBn = (s: string): string => (LIFECYCLE_STATE_LABELS_BN as Record<string, string>)[s] ?? s;

/**
 * The per-student week picture. One item query over the whole span
 * (`dayRangeBounds` — the D-#359 windowing), split in memory by dateKey;
 * only students with ≥1 line in either section are returned.
 */
export async function homeworkWeeklyDigestData(
  window: DigestWindow,
  opts: { sectionId?: string | null; classLevel?: number | null } = {},
): Promise<HwWeeklyStudentDigest[]> {
  const { start, end } = dayRangeBounds(window.unsubFromKey, window.headsUpKey);
  const itemFilter: Record<string, unknown> = { dateGiven: { $gte: start, $lte: end } };
  if (opts.sectionId) itemFilter.sectionId = new Types.ObjectId(opts.sectionId);
  if (opts.classLevel != null) itemFilter.classLevel = opts.classLevel;

  const items = (await HomeworkItem.find(itemFilter)
    .select("hwId subject dateGiven description qCount timeDecl sectionId classId classLevel status")
    .lean()) as unknown as ItemLite[];
  if (items.length === 0) return [];

  const unsubItems = items.filter((i) => dateKeyOf(new Date(i.dateGiven)) <= window.unsubToKey);
  const headsUpItems = items.filter((i) => dateKeyOf(new Date(i.dateGiven)) === window.headsUpKey);
  const itemOf = new Map(items.map((i) => [i._id.toString(), i]));

  // Unsubmitted basis: Layer-B records still owed by the student.
  const records = unsubItems.length
    ? await HomeworkStudentRecord.find({
        hwItemId: { $in: unsubItems.map((i) => i._id) },
        state: { $in: OWED_BY_STUDENT_STATES },
      })
        .select("hwItemId studentId sectionId classId state chaseCount dueDate")
        .lean()
    : [];

  // Heads-up basis: Layer A fanned to the class's active students (records may
  // not exist yet — the day reconciles at 17:00). Routine-aware due day per item.
  const headsUpDueKey = new Map<string, string | null>();
  await Promise.all(
    headsUpItems.map(async (i) => {
      try {
        const due = await resolveHomeworkDueDate(i.sectionId, i.subject as HwSubject, new Date(i.dateGiven));
        headsUpDueKey.set(i._id.toString(), dateKeyOf(due));
      } catch {
        headsUpDueKey.set(i._id.toString(), null);
      }
    }),
  );
  const headsUpClassIds = [...new Set(headsUpItems.map((i) => i.classId.toString()))];
  const headsUpStudents = headsUpClassIds.length
    ? ((await Student.find({ classId: { $in: headsUpClassIds }, active: true })
        .select("_id classId sectionId")
        .lean()) as unknown as Array<{ _id: Types.ObjectId; classId: Types.ObjectId; sectionId?: Types.ObjectId }>)
    : [];

  // Assemble per student.
  const byStudent = new Map<string, { unsub: HwWeeklyItemLine[]; heads: HwWeeklyHeadsUpLine[]; sectionId: string; classId: string }>();
  const entryOf = (studentId: string, sectionId: string, classId: string) => {
    let e = byStudent.get(studentId);
    if (!e) {
      e = { unsub: [], heads: [], sectionId, classId };
      byStudent.set(studentId, e);
    }
    return e;
  };

  for (const r of records) {
    if (!inStates(r.state as LifecycleState, OWED_BY_STUDENT_STATES)) continue;
    const it = itemOf.get(r.hwItemId.toString());
    if (!it) continue;
    entryOf(r.studentId.toString(), r.sectionId.toString(), r.classId?.toString() ?? it.classId.toString()).unsub.push({
      hwItemId: it._id.toString(),
      hwId: it.hwId,
      subject: it.subject,
      subjectLabelBn: subjectBn(it.subject),
      dateKey: dateKeyOf(new Date(it.dateGiven)),
      description: it.description?.trim() || null,
      state: r.state,
      stateLabelBn: stateBn(r.state),
      chaseCount: r.chaseCount ?? 0,
      dueDateKey: r.dueDate ? dateKeyOf(new Date(r.dueDate)) : null,
    });
  }

  const headsByClass = new Map<string, ItemLite[]>();
  for (const i of headsUpItems) {
    const k = i.classId.toString();
    (headsByClass.get(k) ?? headsByClass.set(k, []).get(k)!).push(i);
  }
  for (const stu of headsUpStudents) {
    const classItems = headsByClass.get(stu.classId.toString()) ?? [];
    if (classItems.length === 0) continue;
    const e = entryOf(
      stu._id.toString(),
      stu.sectionId?.toString() ?? classItems[0].sectionId.toString(),
      stu.classId.toString(),
    );
    for (const it of classItems) {
      e.heads.push({
        hwItemId: it._id.toString(),
        hwId: it.hwId,
        subject: it.subject,
        subjectLabelBn: subjectBn(it.subject),
        description: it.description?.trim() || null,
        qCount: it.qCount ?? 0,
        timeDecl: it.timeDecl ?? 0,
        dueDateKey: headsUpDueKey.get(it._id.toString()) ?? null,
      });
    }
  }
  if (byStudent.size === 0) return [];

  // Labels: students + sections in two batched reads.
  const studentIds = [...byStudent.keys()];
  const sectionIds = [...new Set([...byStudent.values()].map((e) => e.sectionId))];
  const [students, sections] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).select("name nameBn rollNumber phone").lean(),
    Section.find({ _id: { $in: sectionIds } }).select("nameBn").lean(),
  ]);
  const studentOf = new Map(students.map((s) => [s._id.toString(), s]));
  const sectionNameOf = new Map(sections.map((s) => [s._id.toString(), s.nameBn ?? null]));

  const sortLines = (a: HwWeeklyItemLine, b: HwWeeklyItemLine) =>
    a.subject === b.subject ? a.dateKey.localeCompare(b.dateKey) : a.subject.localeCompare(b.subject);

  const out: HwWeeklyStudentDigest[] = [];
  for (const [studentId, e] of byStudent) {
    const stu = studentOf.get(studentId);
    const it = itemOf.get(e.unsub[0]?.hwItemId ?? e.heads[0]?.hwItemId ?? "");
    out.push({
      studentId,
      name: stu?.name ?? "",
      nameBn: stu?.nameBn ?? null,
      rollNumber: stu?.rollNumber ?? null,
      studentPhone: stu?.phone ?? null,
      sectionId: e.sectionId,
      sectionNameBn: sectionNameOf.get(e.sectionId) ?? null,
      classId: e.classId,
      classLevel: it?.classLevel ?? 0,
      unsubmitted: e.unsub.sort(sortLines),
      headsUp: e.heads.sort((a, b) => a.subject.localeCompare(b.subject)),
    });
  }
  out.sort((a, b) => (a.classLevel - b.classLevel) || (a.rollNumber ?? "").localeCompare(b.rollNumber ?? ""));
  return out;
}

// ---------------------------------------------------------------------------
// Bangla body builders (the SR buildDigestSummary posture: section fragments
// live here; the message FRAME lives in the MT registry — D-#131)
// ---------------------------------------------------------------------------

/** "জমা হয়নি:\nগণিত — ০৩-০৮: … (তাগাদা ×২)\n…" — subject-grouped; empty →
 *  the all-clear line. Line-capped at HW_DIGEST_MAX_LINES. */
export function buildUnsubmittedSummary(lines: HwWeeklyItemLine[]): string {
  if (lines.length === 0) return "এই সপ্তাহের সব বাড়ির কাজ জমা হয়েছে — মাশাআল্লাহ।";
  const shown = lines.slice(0, HW_DIGEST_MAX_LINES);
  const rows = shown.map((l) => {
    const detail = l.description ? `: ${l.description}` : "";
    const chase = l.chaseCount > 0 ? ` (তাগাদা ×${l.chaseCount})` : "";
    return `• ${l.subjectLabelBn} — ${l.dateKey}${detail}${chase}`;
  });
  if (lines.length > shown.length) rows.push(`+ আরও ${lines.length - shown.length}টি`);
  return `জমা হয়নি:\n${rows.join("\n")}`;
}

/** "আজ দেওয়া বাড়ির কাজ — <due> জমা:\n…" — empty input → "" (the template's
 *  {HeadsUp} then interpolates to nothing). Due day is derived per line —
 *  never a hardcoded weekday, a holiday-shifted due date must stay truthful. */
export function buildHeadsUpSummary(lines: HwWeeklyHeadsUpLine[]): string {
  if (lines.length === 0) return "";
  const rows = lines.map((l) => {
    const detail = l.description ? `: ${l.description}` : "";
    const due = l.dueDateKey ? ` (জমা ${l.dueDateKey})` : "";
    return `• ${l.subjectLabelBn}${detail}${due}`;
  });
  return `আজ দেওয়া বাড়ির কাজ:\n${rows.join("\n")}`;
}

/** Hard char clamp with a Bangla see-the-app tail — cut at a line boundary
 *  where possible so truncation reads as a shortened list, not a torn word. */
export function clampDigestBody(body: string, maxChars = HW_DIGEST_BODY_MAX_CHARS): string {
  if (body.length <= maxChars) return body;
  const tail = "\n… বিস্তারিত অ্যাপে দেখুন।";
  let cut = body.slice(0, maxChars - tail.length);
  const lastBreak = cut.lastIndexOf("\n");
  if (lastBreak > maxChars / 2) cut = cut.slice(0, lastBreak);
  return cut + tail;
}

/** The one rendered message per student — shared verbatim by the guardian
 *  inbox/push AND the staff report's wa.me line (one text truth). */
export async function renderDigestBody(
  templateKey: "homework.weeklyDigest.body" | "homework.weeklyDigest.wa",
  digest: HwWeeklyStudentDigest,
  window: DigestWindow,
): Promise<string> {
  const body = await renderTemplate(templateKey, {
    StudentName: digest.nameBn || digest.name || "শিক্ষার্থী",
    WeekRange: `${window.unsubFromKey} — ${window.headsUpKey}`,
    Unsubmitted: buildUnsubmittedSummary(digest.unsubmitted),
    HeadsUp: buildHeadsUpSummary(digest.headsUp),
  });
  return clampDigestBody(body.replace(/\n{3,}/g, "\n\n").trim());
}

// ---------------------------------------------------------------------------
// Dispatch (the scheduler family's body)
// ---------------------------------------------------------------------------

export interface HwWeeklyDigestDispatchResult {
  students: number;
  notified: number;
}

export async function dispatchHomeworkWeeklyDigest(now: Date): Promise<HwWeeklyDigestDispatchResult> {
  const window = digestWindowOf(now);
  const digests = await homeworkWeeklyDigestData(window);
  if (digests.length === 0) return { students: 0, notified: 0 };

  // MT N+1 guard: the title is per-school, rendered ONCE; bodies are per student.
  const titleBn = await renderTemplate("homework.weeklyDigest.title");
  let notified = 0;
  for (const digest of digests) {
    const messageBn = await renderDigestBody("homework.weeklyDigest.body", digest, window);
    const guardianIds = await emitHomeworkWeeklyDigest({
      studentId: digest.studentId,
      sectionId: digest.sectionId,
      weekStartKey: window.weekStartKey,
      titleBn,
      messageBn,
    });
    notified += guardianIds.length;
  }
  return { students: digests.length, notified };
}

// ---------------------------------------------------------------------------
// Staff-report helpers (HWD-3)
// ---------------------------------------------------------------------------

/** Primary-guardian phone per student (earliest active link; student-contact
 *  fallback — the D-#31/#59 shared-family-contact reality). Mirrors the
 *  homeworkLifecyclePending resolution so both reports name the same number. */
export async function primaryGuardianPhoneOf(
  studentIds: readonly string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (studentIds.length === 0) return out;
  const links = (await GuardianLink.find({ studentId: { $in: studentIds }, active: { $ne: false } })
    .select("studentId guardianId createdAt")
    .sort({ createdAt: 1 })
    .lean()) as unknown as Array<{ studentId: Types.ObjectId; guardianId: Types.ObjectId }>;
  const primaryGuardianId = new Map<string, string>();
  for (const l of links) {
    const sid = l.studentId.toString();
    if (!primaryGuardianId.has(sid)) primaryGuardianId.set(sid, l.guardianId.toString());
  }
  const guardianIds = [...new Set(primaryGuardianId.values())];
  const guardians = guardianIds.length
    ? await Guardian.find({ _id: { $in: guardianIds } }).select("phone").lean()
    : [];
  const phoneOf = new Map(guardians.map((g) => [g._id.toString(), g.phone ?? null]));
  for (const sid of studentIds) {
    const gid = primaryGuardianId.get(sid);
    out.set(sid, (gid ? phoneOf.get(gid) : null) ?? null);
  }
  return out;
}

/** Resolve a weekStart arg ("YYYY-MM-DD", any day accepted — snapped to its
 *  Sunday) to the window the DIGEST used/will use for that week: the digest day
 *  is the week's last open day, walked back from Thursday. Falls back to
 *  Thursday when the whole week is closed (the report then shows an empty week). */
export async function reportWindowOf(weekStartKey: string | null | undefined, now: Date): Promise<DigestWindow> {
  const anchor = weekStartKey ? weekStartSunday(parseDateKey(weekStartKey)) : weekStartSunday(now);
  const thursday = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 4);
  let digestDay = thursday;
  for (let back = 0; back < 5; back += 1) {
    const candidate = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 4 - back);
    const dayType = await resolveDayType(candidate);
    if (dayType !== "OFF" && dayType !== "HOLIDAY") {
      digestDay = candidate;
      break;
    }
  }
  return digestWindowOf(digestDay);
}
