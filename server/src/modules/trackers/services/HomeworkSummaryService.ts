/**
 * HomeworkSummaryService — the §8 roll-ups + §7 thresholds (handoff, HW-T4).
 *
 *   homeworkSummary       — the trackerSummary roll-up (§8.1/§8.3): chase list +
 *                           attention/comms thresholds (§7.2), open resubmissions,
 *                           completion health (on-time % / chase volume / return
 *                           latency), and touches-per-TOP-tag (§8.3).
 *   resubmissionWatchList — students with ≥3 open/recent resubmissions in a rolling
 *                           2-week window (§7.3 → Master watch-list).
 *   trimPatternFlags      — subjects trimmed on >30% of the month's school days
 *                           (§7.4 → principal/Subject-Lead view).
 *   questionUsageFeed     — DE-IDENTIFIED per-question Pool usage counts (§8.4):
 *                           which qids HW-… used + how often. No student identity —
 *                           safe to surface to the corpus rotation-health view
 *                           (ADR-005 firewall unaffected; this reads only Layer-A
 *                           items + top-up qids, never joins to a student).
 *
 * Thresholds are the A-01/D-#34 figures (chase 2/3, ≥3 per 2 weeks, >30%/month).
 * Time inputs are passed in as epoch millis so callers (resolvers) supply "now"
 * and the math stays deterministic/testable.
 */
import { HW_DAILY_CEILING_MIN } from "@scd/shared";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkReconciliation } from "../models/HomeworkReconciliation";
import { isTerminalState } from "../lifecycle";
import { resolveSubjectTeachers } from "../subjectTeacher";

// §7.2–7.4 thresholds (confirmed A-01 / D-#34)
export const CHASE_ATTENTION = 2;
export const CHASE_COMMS_PROMPT = 3;
export const RESUB_WATCH_COUNT = 3;
export const RESUB_WINDOW_DAYS = 14;
export const TRIM_PATTERN_RATIO = 0.3;

const DAY_MS = 86_400_000;

/** Subject is encoded in HW_ID = HW-C{class}-{SUBJECT}-{nnnn}, where class may be signed. */
function subjectOfHwId(hwId: string): string {
  const match = hwId.match(/^HW-C(-?\d+)-([A-Z]+)-(\d{4})$/);
  if (match) return match[2] ?? "?";
  return hwId.split("-")[2] ?? "?";
}

function atMillis(at: unknown): number {
  return new Date(at as string | number | Date).getTime();
}

// ---------------------------------------------------------------------------
// homeworkSummary — the trackerSummary roll-up (§8.1/§8.3, T4.1/T4.2)
// ---------------------------------------------------------------------------

export interface ChaseEntry {
  recordId: string;
  hwId: string;
  studentId: string;
  chaseCount: number;
  attention: boolean; // CHASE_COUNT ≥ 2 → class-teacher attention list (§7.2)
  commsPrompt: boolean; // CHASE_COUNT ≥ 3 → parent-comms prompt (§7.2)
}

export interface HomeworkSummaryResult {
  classId: string;
  chaseList: ChaseEntry[];
  attentionCount: number;
  commsPromptCount: number;
  openResubmissions: number;
  /** Records sitting in SUBMITTED, awaiting the teacher's check (SUBMITTED→CHECKED). */
  pendingChecking: number;
  /** % of records that reached SUBMITTED with no chase (on time). null if none yet. */
  submittedOnTimePct: number | null;
  chaseVolume: number;
  /** Mean days GIVEN→RETURNED across returned records. null if none yet. */
  avgReturnLatencyDays: number | null;
  topicTouches: { topTag: string; count: number }[];
}

export async function homeworkSummary(classId: string): Promise<HomeworkSummaryResult> {
  const records = await HomeworkStudentRecord.find({ classId }).lean();
  const items = await HomeworkItem.find({ classId, status: "issued" }).lean();

  const chaseList: ChaseEntry[] = records
    .filter((r) => r.state === "CHASE")
    .map((r) => ({
      recordId: r._id.toString(),
      hwId: r.hwId,
      studentId: r.studentId.toString(),
      chaseCount: r.chaseCount,
      attention: r.chaseCount >= CHASE_ATTENTION,
      commsPrompt: r.chaseCount >= CHASE_COMMS_PROMPT,
    }))
    .sort((a, b) => b.chaseCount - a.chaseCount);

  const openResubmissions = records.filter((r) => r.resubOf && !isTerminalState(r.state)).length;
  const pendingChecking = records.filter((r) => r.state === "SUBMITTED").length;

  // Completion health.
  const reachedSubmitted = records.filter((r) => (r.stateDates ?? []).some((s) => s.state === "SUBMITTED"));
  const onTime = reachedSubmitted.filter((r) => r.chaseCount === 0).length;
  const submittedOnTimePct = reachedSubmitted.length
    ? Math.round((onTime / reachedSubmitted.length) * 100)
    : null;
  const chaseVolume = records.reduce((sum, r) => sum + (r.chaseCount ?? 0), 0);

  const latencies: number[] = [];
  for (const r of records) {
    const given = (r.stateDates ?? []).find((s) => s.state === "GIVEN")?.at;
    const returned = (r.stateDates ?? []).find((s) => s.state === "RETURNED")?.at;
    if (given && returned) latencies.push((atMillis(returned) - atMillis(given)) / DAY_MS);
  }
  const avgReturnLatencyDays = latencies.length
    ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10
    : null;

  // Touches per TOP-… tag — free from the tags, zero extra logging (§8.3).
  const touch = new Map<string, number>();
  for (const it of items) for (const tag of it.topTags ?? []) touch.set(tag, (touch.get(tag) ?? 0) + 1);
  const topicTouches = [...touch.entries()]
    .map(([topTag, count]) => ({ topTag, count }))
    .sort((a, b) => b.count - a.count);

  return {
    classId,
    chaseList,
    attentionCount: chaseList.filter((c) => c.attention).length,
    commsPromptCount: chaseList.filter((c) => c.commsPrompt).length,
    openResubmissions,
    pendingChecking,
    submittedOnTimePct,
    chaseVolume,
    avgReturnLatencyDays,
    topicTouches,
  };
}

// ---------------------------------------------------------------------------
// homeworkClassOverview — per-class cumulative counts for the dashboard badges
// (point 4: pending checking / chases / resubmissions / on-time% / over-ceiling).
// classIds are pre-authorized by the resolver (assertCanRead per class).
// ---------------------------------------------------------------------------

export interface ClassOverviewResult {
  classId: string;
  pendingChecking: number;
  openResubmissions: number;
  activeChases: number;
  /** % of records that reached SUBMITTED with no chase. null if none yet. */
  onTimePct: number | null;
  /** Days in the current (Sun-start) week where Σ issued time > the 120 ceiling. */
  overCeilingDaysThisWeek: number;
}

/**
 * The subset of `itemIds` whose ACCOUNTABLE teacher is `teacherId` — the routine's
 * subject teacher for the item's section × subject on its own date (D-#351, the
 * same rule the lifecycle report and the class-test tracker attribute by), falling
 * back to the declarer when the routine names nobody for that cell. One routine
 * query for the whole batch (resolveSubjectTeachers).
 */
async function itemsAttributedTo(itemIds: string[], teacherId: string): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const items = (await HomeworkItem.find({ _id: { $in: itemIds } })
    .select("sectionId subject dateGiven declaredBy")
    .lean()) as unknown as Array<{
    _id: { toString(): string };
    sectionId: { toString(): string };
    subject: string;
    dateGiven: Date;
    declaredBy: { toString(): string };
  }>;
  const resolved = await resolveSubjectTeachers(
    items.map((i) => ({
      key: i._id.toString(),
      sectionId: i.sectionId.toString(),
      subject: i.subject,
      on: new Date(i.dateGiven),
    })),
  );
  const out = new Set<string>();
  for (const i of items) {
    const k = i._id.toString();
    if ((resolved.get(k) ?? i.declaredBy.toString()) === teacherId) out.add(k);
  }
  return out;
}

/** Sun-00:00 → Sat-23:59:59 (UTC) window containing `asOfMillis`. */
function weekRange(asOfMillis: number): { start: Date; end: Date } {
  const d = new Date(asOfMillis);
  const startMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay(), 0, 0, 0, 0);
  return { start: new Date(startMs), end: new Date(startMs + 7 * DAY_MS - 1) };
}

export interface ClassOverviewOpts {
  /** D-#634: count only the homework ATTRIBUTED to this teacher (the routine's
   *  subject teacher, D-#351, falling back to the declarer). Omit for the
   *  school-wide numbers Principal/Office read. */
  teacherId?: string | null;
}

export async function homeworkClassOverview(
  classIds: string[],
  asOfMillis: number,
  opts: ClassOverviewOpts = {},
): Promise<ClassOverviewResult[]> {
  if (classIds.length === 0) return [];

  let records = await HomeworkStudentRecord.find({ classId: { $in: classIds } }).lean();
  // D-#634: a teacher's dashboard answers "what do I owe?", so the record set is
  // narrowed to the items that are HIS before anything is counted. Attribution is
  // resolved over the items these records already reference — a far smaller set
  // than every item the class was ever given, and no extra work at all for the
  // unscoped (admin) read.
  if (opts.teacherId) {
    const itemIds = [...new Set(records.map((r) => r.hwItemId.toString()))];
    const mine = await itemsAttributedTo(itemIds, opts.teacherId);
    records = records.filter((r) => mine.has(r.hwItemId.toString()));
  }
  const { start, end } = weekRange(asOfMillis);
  const items = await HomeworkItem.find({
    classId: { $in: classIds },
    status: "issued",
    dateGiven: { $gte: start, $lte: end },
  }).lean();

  // Bucket records + this-week issued items by classId.
  const recByClass = new Map<string, typeof records>();
  for (const r of records) {
    const k = r.classId.toString();
    (recByClass.get(k) ?? recByClass.set(k, []).get(k)!).push(r);
  }
  // class → dayKey → summed declared minutes (for the over-ceiling-days count).
  const minsByClassDay = new Map<string, Map<string, number>>();
  for (const it of items) {
    const k = it.classId.toString();
    const dayKey = new Date(it.dateGiven as unknown as Date).toISOString().slice(0, 10);
    const days = minsByClassDay.get(k) ?? minsByClassDay.set(k, new Map()).get(k)!;
    days.set(dayKey, (days.get(dayKey) ?? 0) + (it.timeDecl ?? 0));
  }

  return classIds.map((classId) => {
    const recs = recByClass.get(classId) ?? [];
    const pendingChecking = recs.filter((r) => r.state === "SUBMITTED").length;
    const activeChases = recs.filter((r) => r.state === "CHASE").length;
    const openResubmissions = recs.filter((r) => r.resubOf && !isTerminalState(r.state)).length;
    const reachedSubmitted = recs.filter((r) => (r.stateDates ?? []).some((s) => s.state === "SUBMITTED"));
    const onTime = reachedSubmitted.filter((r) => r.chaseCount === 0).length;
    const onTimePct = reachedSubmitted.length ? Math.round((onTime / reachedSubmitted.length) * 100) : null;
    const days = minsByClassDay.get(classId);
    const overCeilingDaysThisWeek = days
      ? [...days.values()].filter((m) => m > HW_DAILY_CEILING_MIN).length
      : 0;
    return { classId, pendingChecking, activeChases, openResubmissions, onTimePct, overCeilingDaysThisWeek };
  });
}

// ---------------------------------------------------------------------------
// resubmissionWatchList — ≥3 open/recent resubmissions / 2 weeks (§7.3, T4.3)
// ---------------------------------------------------------------------------

export interface WatchListResult {
  classId: string;
  threshold: number;
  windowDays: number;
  watchList: { studentId: string; resubmissionCount: number }[];
}

export async function resubmissionWatchList(
  classId: string,
  asOfMillis: number,
): Promise<WatchListResult> {
  const resubs = await HomeworkStudentRecord.find({ classId, resubOf: { $ne: null } }).lean();
  const cutoff = asOfMillis - RESUB_WINDOW_DAYS * DAY_MS;

  // "open OR recent" — still in flight, or created within the rolling window.
  const relevant = resubs.filter(
    (r) => !isTerminalState(r.state) || atMillis(r.createdAt) >= cutoff,
  );

  const byStudent = new Map<string, number>();
  for (const r of relevant) {
    const k = r.studentId.toString();
    byStudent.set(k, (byStudent.get(k) ?? 0) + 1);
  }

  const watchList = [...byStudent.entries()]
    .filter(([, count]) => count >= RESUB_WATCH_COUNT)
    .map(([studentId, resubmissionCount]) => ({ studentId, resubmissionCount }))
    .sort((a, b) => b.resubmissionCount - a.resubmissionCount);

  return { classId, threshold: RESUB_WATCH_COUNT, windowDays: RESUB_WINDOW_DAYS, watchList };
}

// ---------------------------------------------------------------------------
// trimPatternFlags — subjects trimmed >30% of the month's school days (§7.4, T4.4)
// ---------------------------------------------------------------------------

export interface TrimPatternResult {
  classId: string;
  schoolDays: number;
  threshold: number;
  flags: { subject: string; trimmedDays: number; schoolDays: number; ratio: number; flagged: boolean }[];
}

export async function trimPatternFlags(
  classId: string,
  fromMillis: number,
  toMillis: number,
): Promise<TrimPatternResult> {
  const recons = await HomeworkReconciliation.find({
    classId,
    reconDate: { $gte: new Date(fromMillis), $lte: new Date(toMillis) },
  }).lean();

  const schoolDays = recons.length; // days that actually reconciled = the denominator

  const subjectDays = new Map<string, Set<string>>();
  for (const rec of recons) {
    const dayKey = new Date(rec.reconDate as unknown as Date).toISOString().slice(0, 10);
    const trimmedSubjects = new Set((rec.trimLog ?? []).map((t) => subjectOfHwId(t.hwId)));
    for (const s of trimmedSubjects) {
      if (!subjectDays.has(s)) subjectDays.set(s, new Set());
      subjectDays.get(s)!.add(dayKey);
    }
  }

  const flags = [...subjectDays.entries()]
    .map(([subject, days]) => {
      const trimmedDays = days.size;
      const ratio = schoolDays ? trimmedDays / schoolDays : 0;
      return {
        subject,
        trimmedDays,
        schoolDays,
        ratio: Math.round(ratio * 100) / 100,
        flagged: ratio > TRIM_PATTERN_RATIO,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);

  return { classId, schoolDays, threshold: TRIM_PATTERN_RATIO, flags };
}

// ---------------------------------------------------------------------------
// questionUsageFeed — DE-IDENTIFIED per-question Pool usage (§8.4, T4.5)
// ---------------------------------------------------------------------------

export interface QuestionUsageResult {
  classId: string;
  /** qid → times used across HW-… sheets + resubmission top-ups. No identity. */
  feed: { qid: string; count: number }[];
}

/**
 * Per-item pipeline tally for a section's workspace cards (D-#383, owner ask).
 *
 * The workspace renders only OPEN rows and drops RETURNED ones older than today,
 * so a finished item decays to whatever scraps remain (usually the absentees) and
 * a 17/21-returned card read as bare "অনুপস্থিত ৪". The card can't count what it
 * was never sent, so the progress counts come from here.
 *
 * submitted/checked/returned are CUMULATIVE — read off `stateDates`, not the
 * current state, so a student who has moved on to RETURNED still counts as having
 * submitted. A D-#338 undo pops the stamp, so a reverted record correctly stops
 * counting. pendingSubmission/absent are current-state (what still needs doing).
 */
export interface HomeworkItemTally {
  hwItemId: string;
  /** Roster size the records were spawned from — the denominator. */
  total: number;
  submitted: number;
  checked: number;
  returned: number;
  /** Current GIVEN/DUE/CHASE — still owes a submission. */
  pendingSubmission: number;
  /** Current ABSENT_REDELIVER — absent at issue, awaiting a redeliver. */
  absent: number;
}

const PENDING_SUBMISSION_STATES = new Set(["GIVEN", "DUE", "CHASE"]);

export async function homeworkItemTallies(
  sectionId: string,
  /** Subject allow-list from the caller's scope; null/undefined = unrestricted. */
  subjects?: ReadonlySet<string> | null,
): Promise<HomeworkItemTally[]> {
  // Subject scope is an ITEM property, so restrict by item before touching records.
  let itemFilter: Record<string, unknown> = { sectionId };
  if (subjects) {
    const ids = await HomeworkItem.find({ sectionId, subject: { $in: [...subjects] } })
      .select("_id")
      .lean();
    itemFilter = { hwItemId: { $in: ids.map((i) => i._id) } };
  }

  const records = await HomeworkStudentRecord.find(itemFilter)
    .select("hwItemId state stateDates")
    .lean();

  const byItem = new Map<string, HomeworkItemTally>();
  for (const r of records) {
    const key = r.hwItemId.toString();
    let t = byItem.get(key);
    if (!t) {
      t = { hwItemId: key, total: 0, submitted: 0, checked: 0, returned: 0, pendingSubmission: 0, absent: 0 };
      byItem.set(key, t);
    }
    t.total += 1;
    const stamped = new Set((r.stateDates ?? []).map((s) => s.state));
    if (stamped.has("SUBMITTED")) t.submitted += 1;
    if (stamped.has("CHECKED")) t.checked += 1;
    if (stamped.has("RETURNED")) t.returned += 1;
    if (PENDING_SUBMISSION_STATES.has(r.state)) t.pendingSubmission += 1;
    if (r.state === "ABSENT_REDELIVER") t.absent += 1;
  }
  return [...byItem.values()];
}

export async function questionUsageFeed(classId: string): Promise<QuestionUsageResult> {
  const items = await HomeworkItem.find({ classId }).lean();
  const topups = await HomeworkStudentRecord.find({ classId, topupFlag: true }).lean();

  const usage = new Map<string, number>();
  for (const it of items) for (const qid of it.selectedQids ?? []) usage.set(qid, (usage.get(qid) ?? 0) + 1);
  for (const r of topups) for (const qid of r.topupQids ?? []) usage.set(qid, (usage.get(qid) ?? 0) + 1);

  const feed = [...usage.entries()]
    .map(([qid, count]) => ({ qid, count }))
    .sort((a, b) => b.count - a.count);

  return { classId, feed };
}
