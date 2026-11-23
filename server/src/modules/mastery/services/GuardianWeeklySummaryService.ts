/**
 * GuardianWeeklySummaryService — AL-10 of the 2027 academic loop (docs/prd-academic-loop-2027.md §5 B9 / D5, R13, R31,
 * D-#1674): the `GWSUM` weekly family and the "এই সপ্তাহ" card.
 *
 *   childWeeklySummary         one child's week: per subject the confirmed marks + level word (R32), the weak / improving
 *                              objectives and what to practise at home — plain, kind words, never an answer, a rank,
 *                              another child or a শাখা average (AC-D3)
 *   guardianSummaryReady       the cheap tick gate: switch on, `guardianSummaryDow` reached (a holiday rolls it forward
 *                              to the first open day), `guardianSummaryHour` on the configured day
 *   runGuardianWeeklySummary   ONE message PER CHILD per guardian (R31), dedupe `GWS:<week>:<studentId>:<guardianId>`;
 *                              a child with no confirmed marks that week gets NOTHING (AC-D5)
 *
 * The D-#452 homework digest (HW_WEEKLY_DIGEST) is a different message on a different day and is not touched.
 * Release switch (§3.6): with `academicLoop2027On` OFF nothing runs and the card is empty.
 * Identity plane (names studentIds); no corpus path (ADR-005). No guardian type here has an answer field.
 */
import { Types } from "mongoose";
import { HW_SUBJECT_LABELS_BN, marksLevelWord } from "@scd/shared";
import { HomeworkStudentRecord } from "../../trackers/models/HomeworkStudentRecord";
import { HomeworkItem } from "../../trackers/models/HomeworkItem";
import { AssignmentStudentRecord } from "../../trackers/models/AssignmentStudentRecord";
import { AssignmentItem } from "../../trackers/models/AssignmentItem";
import { Student } from "../../foundation/models/Student";
import { atMidnight, weekStartSunday } from "../../trackers/assignmentCalendar";
import { dateKeyOf } from "../../attendance/dates";
import { resolveDayType } from "../../routine/calendar";
import { getPolicy } from "./MasteryCatalogueService";
import { GuardianSummaryRun as RunLog } from "../models/GuardianSummaryRun";
import { childMasteryProgress } from "./MasteryGuardianService";
import { isLoop2027On } from "../../assessment/services/QuestionUseService";
import { emitGuardianWeeklySummary } from "../../notifications/services/emitters";
import { personName } from "../../../lib/personName";

const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const subjectBn = (s: string): string => (HW_SUBJECT_LABELS_BN as Record<string, string>)[s] ?? s;
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 2) / 2));

/** At most this many objectives per list in the message / card (a short, kind note — not a report). */
export const WEEKLY_LIST_MAX = 3;
/** Push bodies are not truncated by any channel: the message clamps itself (the D-#452 digest posture). */
export const WEEKLY_BODY_MAX_CHARS = 900;

export interface WeeklySubjectSummary {
  subject: string;
  subjectBn: string;
  earned: number;
  available: number;
  pct: number;
  /** R32 level word for the week's total in this subject. */
  levelBn: string;
  /** Topics that need a little more attention (plain label). */
  attentionBn: string[];
  /** Topics that are getting better. */
  improvingBn: string[];
  /** What to practise at home (the topic's home tip). */
  practiseBn: string[];
  /** "ক্লাস মিস" topics (R11) — never reported as weak. */
  classMissedBn: string[];
}

export interface ChildWeeklySummary {
  studentId: string;
  /** The Sunday of the school week (the dedupe scope), YYYY-MM-DD. */
  weekKey: string;
  subjects: WeeklySubjectSummary[];
}

/** Sun–Sat school week containing `now`: [start, end) as local midnights, plus the week key. Pure. */
export function schoolWeekOf(now: Date): { start: Date; end: Date; weekKey: string } {
  const start = weekStartSunday(now);
  return { start, end: addDays(start, 7), weekKey: dateKeyOf(start) };
}

interface MarkRow {
  studentId: string;
  subject: string;
  earned: number;
  available: number;
}

/**
 * The marks confirmed in the week (the record turned CHECKED inside it) for HW (earnedMarks / availableMarks) and AS
 * (marks / availableMarks), as one row per record. A correction does not move the CHECKED stamp, so it never re-opens a
 * week. `studentIds` null = every child (the scheduler pass).
 */
export async function weekMarkRows(start: Date, end: Date, studentIds?: readonly string[] | null): Promise<MarkRow[]> {
  const stamp = { $elemMatch: { state: "CHECKED", at: { $gte: start, $lt: end } } };
  const who = studentIds ? { studentId: { $in: studentIds.filter((s) => Types.ObjectId.isValid(s)).map((s) => new Types.ObjectId(s)) } } : {};
  const [hw, as] = await Promise.all([
    HomeworkStudentRecord.find({ ...who, availableMarks: { $gt: 0 }, stateDates: stamp }).select("hwItemId studentId earnedMarks availableMarks").lean(),
    AssignmentStudentRecord.find({ ...who, availableMarks: { $gt: 0 }, stateDates: stamp }).select("asItemId studentId marks availableMarks").lean(),
  ]);
  const [hwItems, asItems] = await Promise.all([
    hw.length ? HomeworkItem.find({ _id: { $in: [...new Set(hw.map((r) => String(r.hwItemId)))] } }).select("subject").lean() : [],
    as.length ? AssignmentItem.find({ _id: { $in: [...new Set(as.map((r) => String(r.asItemId)))] } }).select("subject").lean() : [],
  ]);
  const hwSubject = new Map(hwItems.map((i) => [String(i._id), String(i.subject)]));
  const asSubject = new Map(asItems.map((i) => [String(i._id), String(i.subject)]));
  const out: MarkRow[] = [];
  for (const r of hw) {
    const subject = hwSubject.get(String(r.hwItemId));
    if (subject && typeof r.earnedMarks === "number") out.push({ studentId: String(r.studentId), subject, earned: r.earnedMarks, available: r.availableMarks ?? 0 });
  }
  for (const r of as) {
    const subject = asSubject.get(String(r.asItemId));
    if (subject && typeof r.marks === "number") out.push({ studentId: String(r.studentId), subject, earned: r.marks, available: r.availableMarks ?? 0 });
  }
  return out;
}

/** Sum the rows of ONE child per subject (sorted by subject code — stable, never by marks: no ranking). Pure. */
export function totalsBySubject(rows: readonly Pick<MarkRow, "subject" | "earned" | "available">[]): Array<{ subject: string; earned: number; available: number }> {
  const by = new Map<string, { earned: number; available: number }>();
  for (const r of rows) {
    const x = by.get(r.subject) ?? { earned: 0, available: 0 };
    x.earned += r.earned;
    x.available += r.available;
    by.set(r.subject, x);
  }
  return [...by.entries()].map(([subject, v]) => ({ subject, ...v })).filter((x) => x.available > 0).sort((a, b) => a.subject.localeCompare(b.subject));
}

async function summaryFor(studentId: string, rows: readonly MarkRow[], weekKey: string): Promise<ChildWeeklySummary | null> {
  const totals = totalsBySubject(rows);
  if (totals.length === 0) return null; // nothing confirmed this week → nothing to say (AC-D5)
  let progress: Awaited<ReturnType<typeof childMasteryProgress>> = [];
  try {
    progress = await childMasteryProgress(studentId);
  } catch {
    progress = []; // marks still go out; the topic lines are a bonus
  }
  const progOf = new Map(progress.map((p) => [p.subject as string, p]));
  const subjects: WeeklySubjectSummary[] = totals.map((t) => {
    const pct = Math.round((t.earned / t.available) * 100);
    const p = progOf.get(t.subject);
    return {
      subject: t.subject,
      subjectBn: subjectBn(t.subject),
      earned: t.earned,
      available: t.available,
      pct,
      levelBn: marksLevelWord(pct).bn,
      attentionBn: (p?.attention ?? []).slice(0, WEEKLY_LIST_MAX).map((a) => a.labelBn),
      improvingBn: (p?.improving ?? []).slice(0, WEEKLY_LIST_MAX).map((a) => a.labelBn),
      practiseBn: (p?.attention ?? []).filter((a) => a.homeTipBn).slice(0, WEEKLY_LIST_MAX).map((a) => `${a.labelBn} — ${a.homeTipBn}`),
      classMissedBn: (p?.classMissed ?? []).slice(0, WEEKLY_LIST_MAX).map((a) => a.labelBn),
    };
  });
  return { studentId, weekKey, subjects };
}

/** One child's week for the "এই সপ্তাহ" card (null = nothing confirmed yet, or the release switch is off). */
export async function childWeeklySummary(studentId: string, now: Date = new Date()): Promise<ChildWeeklySummary | null> {
  if (!Types.ObjectId.isValid(studentId)) return null;
  if (!(await isLoop2027On())) return null;
  const { start, end, weekKey } = schoolWeekOf(now);
  return summaryFor(studentId, await weekMarkRows(start, end, [studentId]), weekKey);
}

/** The guardian's message body (Bangla, kind, no rank / no other child / no answer). Pure, self-clamped. */
export function buildWeeklyBody(name: string, s: ChildWeeklySummary): string {
  const lines: string[] = [`${name} সাম্প্রতিক বাড়ির কাজ ও অ্যাসাইনমেন্টে যা করেছে:`];
  for (const x of s.subjects) lines.push(`• ${x.subjectBn} — ${bn(fmt(x.earned))}/${bn(fmt(x.available))} — ${x.levelBn}`);
  const join = (label: string, pick: (x: WeeklySubjectSummary) => string[]) => {
    const parts = s.subjects.flatMap((x) => pick(x).map((t) => `${x.subjectBn}: ${t}`));
    if (parts.length > 0) lines.push(`${label}\n${parts.map((p) => `• ${p}`).join("\n")}`);
  };
  join("ভালো করছে:", (x) => x.improvingBn);
  join("একটু মনোযোগ দরকার:", (x) => x.attentionBn);
  join("ক্লাস মিস (ক্লাসে ছিল না, বাড়িতে দেখে নিন):", (x) => x.classMissedBn);
  join("বাড়িতে যা অনুশীলন করা যায়:", (x) => x.practiseBn);
  lines.push("প্রশ্নের ইঙ্গিত অ্যাপের বাড়ির কাজ অংশে আছে। আপনার সহযোগিতার জন্য ধন্যবাদ।");
  let body = lines.join("\n");
  if (body.length > WEEKLY_BODY_MAX_CHARS) {
    const tail = "\n… বিস্তারিত অ্যাপে দেখুন।";
    let cut = body.slice(0, WEEKLY_BODY_MAX_CHARS - tail.length);
    const br = cut.lastIndexOf("\n");
    if (br > WEEKLY_BODY_MAX_CHARS / 2) cut = cut.slice(0, br);
    body = cut + tail;
  }
  return body;
}

// ---------------------------------------------------------------------------
// The GWSUM family
// ---------------------------------------------------------------------------

const closed = (t: string) => t === "OFF" || t === "HOLIDAY";

/** A run still counts this long after its due time (the D-#452 digest posture): a restart late at night sends nothing. */
export const GWSUM_STALE_MINUTES = 240;
const RUN_KEY = "GWSUM";

/** The latest due slot (`guardianSummaryDow` at `guardianSummaryHour`) at or before `now`; null hour = end of day never reached. */
export function lastDueSlot(now: Date, dow: number, hour: number): Date {
  const back = (now.getDay() - dow + 7) % 7;
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 0, Math.round(hour * 60), 0, 0);
  return slot.getTime() > now.getTime() ? new Date(slot.getFullYear(), slot.getMonth(), slot.getDate() - 7, 0, Math.round(hour * 60), 0, 0) : slot;
}

/**
 * The cheap tick gate (§3.6, §7): switch on; TODAY is open; `guardianSummaryHour` reached and not more than 240 minutes
 * ago. On `guardianSummaryDow` itself that is it; on a later day of the same week only when EVERY day from the configured
 * one up to yesterday was closed (a holiday rolls the message to the first open day, same hour — D-#86). A normal
 * Wednesday run is never repeated on Thursday, and a restart at 23:50 sends nothing.
 */
export async function guardianSummaryReady(now: Date = new Date()): Promise<boolean> {
  const p = (await getPolicy(null, null)).resolved;
  if (p.academicLoop2027On !== true) return false;
  const dow = Number(p.guardianSummaryDow);
  const today = now.getDay();
  if (today < dow) return false;
  const dueMin = Math.round(Number(p.guardianSummaryHour) * 60);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin < dueMin || nowMin - dueMin > GWSUM_STALE_MINUTES) return false;
  if (closed(await resolveDayType(atMidnight(now)))) return false; // a holiday never sends; the next open day rolls it
  for (let d = dow; d < today; d++) {
    if (!closed(await resolveDayType(addDays(atMidnight(now), d - today)))) return false;
  }
  return true;
}

export interface GuardianSummaryRun {
  students: number;
  notified: number;
}

/** One message per child per guardian for the week of `now` (idempotent: the dedupe key carries week + child + guardian). */
export async function runGuardianWeeklySummary(now: Date = new Date()): Promise<GuardianSummaryRun> {
  const res: GuardianSummaryRun = { students: 0, notified: 0 };
  if (!(await isLoop2027On())) return res;
  // The window is everything confirmed SINCE THE PREVIOUS RUN up to this one (never older than one slot back), so marks
  // confirmed after the last message go in this one - nothing lost, nothing twice. The dedupe week is the run's school week.
  const { weekKey } = schoolWeekOf(now);
  const pol = (await getPolicy(null, null)).resolved;
  const floor = new Date(lastDueSlot(now, Number(pol.guardianSummaryDow), Number(pol.guardianSummaryHour)).getTime() - 7 * 86_400_000);
  const last = await RunLog.findOne({ key: RUN_KEY }).select("lastRunAt").lean();
  const start = last && last.lastRunAt.getTime() > floor.getTime() ? last.lastRunAt : floor;
  const rows = await weekMarkRows(start, now, null);
  if (rows.length === 0) {
    await RunLog.updateOne({ key: RUN_KEY }, { $set: { lastRunAt: now } }, { upsert: true });
    return res;
  }
  const byStudent = new Map<string, MarkRow[]>();
  for (const r of rows) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);
  const students = await Student.find({ _id: { $in: [...byStudent.keys()].map((i) => new Types.ObjectId(i)) }, active: true })
    .select("name nameBn sectionId")
    .sort({ _id: 1 })
    .lean();
  for (const st of students) {
    const sid = String(st._id);
    const summary = await summaryFor(sid, byStudent.get(sid) ?? [], weekKey);
    if (!summary) continue;
    const name = personName(st, "শিক্ষার্থী");
    const guardianIds = await emitGuardianWeeklySummary({
      studentId: sid,
      sectionId: String(st.sectionId ?? ""),
      weekKey,
      titleBn: `এই সপ্তাহের পড়াশোনা — ${name}`,
      messageBn: buildWeeklyBody(name, summary),
    });
    res.students += 1;
    res.notified += guardianIds.length;
  }
  await RunLog.updateOne({ key: RUN_KEY }, { $set: { lastRunAt: now } }, { upsert: true }); // the next run starts here
  return res;
}
