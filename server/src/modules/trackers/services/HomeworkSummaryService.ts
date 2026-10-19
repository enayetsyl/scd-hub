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
import type { LifecycleState } from "@scd/shared";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkReconciliation } from "../models/HomeworkReconciliation";
import { isTerminalState } from "../lifecycle";
import { homeworkRecordOwners, ownerOf, type HwItemOwnerLite } from "../recordOwner";

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

export interface HomeworkSummaryOpts extends ClassOverviewOpts {
  /** D-#770: narrow to ONE section — after a gender split the বালক and বালিকা
   *  roll-ups are separate piles. Records are keyed by the STUDENT's section
   *  (they follow a moved student, recordRehome); items by the section they were
   *  declared on, plus any item the section's records point at (an item issued
   *  before the split serves both halves). Omit for the class-wide fold. */
  sectionId?: string | null;
}

export async function homeworkSummary(
  classId: string,
  opts: HomeworkSummaryOpts = {},
): Promise<HomeworkSummaryResult> {
  let records = await HomeworkStudentRecord.find(
    opts.sectionId ? { classId, sectionId: opts.sectionId } : { classId },
  ).lean();
  let items = await HomeworkItem.find(
    opts.sectionId
      ? {
          classId,
          status: "issued",
          $or: [
            { sectionId: opts.sectionId },
            { _id: { $in: [...new Set(records.map((r) => r.hwItemId.toString()))] } },
          ],
        }
      : { classId, status: "issued" },
  ).lean();

  // D-#641 (BUG-019): the same narrowing D-#634 gave the class chips and Today's
  // rows. Left class-wide then "for the section's confirmer", this fold ended up
  // reporting 62 unchecked / 109 chases under chips that correctly showed the
  // viewing teacher nothing — and its own topic list gave the scope away, naming
  // TOP-ENG / TOP-MATH / TOP-BAN for a teacher who only teaches ইসলাম শিক্ষা.
  // Records AND items are narrowed together, so the health percentages and the
  // topic touches describe the same homework as the counts above them.
  if (opts.teacherId) {
    const ids = [
      ...new Set([
        ...records.map((r) => r.hwItemId.toString()),
        ...items.map((i) => i._id.toString()),
      ]),
    ];
    const mine = await recordsAttributedTo(records, opts.teacherId, ids);
    records = mine.records;
    items = items.filter((i) => mine.itemIds.has(i._id.toString()));
  }

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
  /** D-#770: set by homeworkSectionOverview (the per-section bucket); null on the
   *  legacy class-keyed fold. */
  sectionId: string | null;
  pendingChecking: number;
  openResubmissions: number;
  activeChases: number;
  /** % of records that reached SUBMITTED with no chase. null if none yet. */
  onTimePct: number | null;
  /** Days in the current (Sun-start) week where Σ issued time > the 120 ceiling. */
  overCeilingDaysThisWeek: number;
}

/**
 * The records whose OWNER is `teacherId` (D-#772 — per RECORD, not per item). A
 * record on its item's section belongs to the item's ACCOUNTABLE teacher: the
 * routine's subject teacher for the item's section × subject on its own date (D-#351,
 * the rule the lifecycle report and the class-test tracker attribute by), falling
 * back to the declarer. A record rehomed to another section by a split belongs to the
 * routine subject teacher of the RECORD's section (`recordOwner`).
 *
 * `itemIds` comes back as the items the teacher owns any of these records on — plus,
 * for an item with no record here (`extraItemIds`, e.g. one not yet issued), the
 * items whose item-level owner they are — so topic touches describe the same work.
 */
async function recordsAttributedTo<R extends { hwItemId: { toString(): string }; sectionId?: { toString(): string } | null }>(
  records: R[],
  teacherId: string,
  extraItemIds: readonly string[] = [],
  now: Date = new Date(),
): Promise<{ records: R[]; itemIds: Set<string> }> {
  const ids = [...new Set([...records.map((r) => r.hwItemId.toString()), ...extraItemIds])];
  if (ids.length === 0) return { records: [], itemIds: new Set() };
  const items = (await HomeworkItem.find({ _id: { $in: ids } })
    .select("sectionId subject dateGiven declaredBy")
    .lean()) as unknown as HwItemOwnerLite[];
  const sectionOf = new Map(items.map((i) => [i._id.toString(), i.sectionId]));
  const owners = await homeworkRecordOwners(
    items,
    [
      ...records.map((r) => ({ itemId: r.hwItemId.toString(), recordSectionId: r.sectionId?.toString() ?? null })),
      ...items.map((i) => ({ itemId: i._id.toString(), recordSectionId: i.sectionId.toString() })),
    ],
    now,
  );
  const withRecords = new Set<string>();
  const itemIds = new Set<string>();
  const mine = records.filter((r) => {
    const k = r.hwItemId.toString();
    withRecords.add(k);
    const sec = sectionOf.get(k);
    if (!sec) return false;
    const owned = ownerOf(owners, k, r.sectionId, sec) === teacherId;
    if (owned) itemIds.add(k);
    return owned;
  });
  for (const i of items) {
    const k = i._id.toString();
    if (!withRecords.has(k) && ownerOf(owners, k, i.sectionId, i.sectionId) === teacherId) itemIds.add(k);
  }
  return { records: mine, itemIds };
}

/** Sun-00:00 → Sat-23:59:59 (UTC) window containing `asOfMillis`. */
function weekRange(asOfMillis: number): { start: Date; end: Date } {
  const d = new Date(asOfMillis);
  const startMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay(), 0, 0, 0, 0);
  return { start: new Date(startMs), end: new Date(startMs + 7 * DAY_MS - 1) };
}

export interface ClassOverviewOpts {
  /** D-#634: count only the homework ATTRIBUTED to this teacher (the routine's
   *  subject teacher, D-#351, falling back to the declarer; per RECORD after a
   *  split, D-#772 — `recordsAttributedTo`). Omit for the
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
    records = (await recordsAttributedTo(records, opts.teacherId, [], new Date(asOfMillis))).records;
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

  return classIds.map((classId) => ({
    classId,
    sectionId: null,
    ...overviewCounts(recByClass.get(classId) ?? [], minsByClassDay.get(classId)),
  }));
}

type OverviewRecord = {
  state: LifecycleState;
  resubOf?: unknown;
  chaseCount: number;
  stateDates?: Array<{ state: string }>;
};

/** The badge numbers for one bucket (a class, or one section of it). */
function overviewCounts(
  recs: readonly OverviewRecord[],
  days: Map<string, number> | undefined,
): Omit<ClassOverviewResult, "classId" | "sectionId"> {
  const pendingChecking = recs.filter((r) => r.state === "SUBMITTED").length;
  const activeChases = recs.filter((r) => r.state === "CHASE").length;
  const openResubmissions = recs.filter((r) => r.resubOf && !isTerminalState(r.state)).length;
  const reachedSubmitted = recs.filter((r) => (r.stateDates ?? []).some((s) => s.state === "SUBMITTED"));
  const onTime = reachedSubmitted.filter((r) => r.chaseCount === 0).length;
  const onTimePct = reachedSubmitted.length ? Math.round((onTime / reachedSubmitted.length) * 100) : null;
  const overCeilingDaysThisWeek = days ? [...days.values()].filter((m) => m > HW_DAILY_CEILING_MIN).length : 0;
  return { pendingChecking, activeChases, openResubmissions, onTimePct, overCeilingDaysThisWeek };
}

export interface SectionOverviewRef {
  classId: string;
  sectionId: string;
}

/**
 * homeworkSectionOverview (D-#770) — the same badges as homeworkClassOverview,
 * bucketed per SECTION. After a gender split (C4/C5 2026-10-01, C3 2026-10-25) a
 * class-keyed fold pooled বালক and বালিকা: one badge for both halves, and an
 * over-ceiling day that added both halves' minutes (each half gets its own sheet,
 * so neither child carried that load). Records bucket by their own sectionId (the
 * student's section — records follow a moved student); this week's issued items
 * by the section they were declared on. For a single-section class the bucket is
 * the whole class, so the numbers equal the class-keyed ones.
 */
export async function homeworkSectionOverview(
  refs: readonly SectionOverviewRef[],
  asOfMillis: number,
  opts: ClassOverviewOpts = {},
): Promise<ClassOverviewResult[]> {
  const seen = new Set<string>();
  const unique = refs.filter((r) => (seen.has(r.sectionId) ? false : (seen.add(r.sectionId), true)));
  if (unique.length === 0) return [];
  const sectionIds = unique.map((r) => r.sectionId);

  let records = await HomeworkStudentRecord.find({ sectionId: { $in: sectionIds } }).lean();
  if (opts.teacherId) {
    records = (await recordsAttributedTo(records, opts.teacherId, [], new Date(asOfMillis))).records;
  }
  const { start, end } = weekRange(asOfMillis);
  const items = await HomeworkItem.find({
    // classId leads the (classId, sectionId, subject, dateGiven) index.
    classId: { $in: [...new Set(unique.map((r) => r.classId))] },
    sectionId: { $in: sectionIds },
    status: "issued",
    dateGiven: { $gte: start, $lte: end },
  }).lean();

  const recBySection = new Map<string, typeof records>();
  for (const r of records) {
    const k = r.sectionId.toString();
    (recBySection.get(k) ?? recBySection.set(k, []).get(k)!).push(r);
  }
  const minsBySectionDay = new Map<string, Map<string, number>>();
  for (const it of items) {
    const k = it.sectionId.toString();
    const dayKey = new Date(it.dateGiven as unknown as Date).toISOString().slice(0, 10);
    const days = minsBySectionDay.get(k) ?? minsBySectionDay.set(k, new Map()).get(k)!;
    days.set(dayKey, (days.get(dayKey) ?? 0) + (it.timeDecl ?? 0));
  }

  return unique.map((ref) => ({
    classId: ref.classId,
    sectionId: ref.sectionId,
    ...overviewCounts(recBySection.get(ref.sectionId) ?? [], minsBySectionDay.get(ref.sectionId)),
  }));
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
  /** D-#770: narrow to one section (records carry the STUDENT's section). */
  sectionId?: string | null,
): Promise<WatchListResult> {
  const resubs = await HomeworkStudentRecord.find(
    sectionId ? { classId, sectionId, resubOf: { $ne: null } } : { classId, resubOf: { $ne: null } },
  ).lean();
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

/** Stays CLASS-keyed (D-#770 note): it reads the HomeworkReconciliation row, which is
 *  still one per class per day (unique classId + reconDate, see D-#731), so there is
 *  no per-section trim log to narrow to. */
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
  // Records are keyed by the STUDENT's section, not the item's: an item issued before a
  // section split serves both halves, each tallying only its own students. Subject scope
  // is an ITEM property, so it is applied to the items those records point at.
  let records = await HomeworkStudentRecord.find({ sectionId })
    .select("hwItemId state stateDates")
    .lean();
  if (subjects) {
    const itemIds = [...new Set(records.map((r) => r.hwItemId.toString()))];
    const readable = await HomeworkItem.find({ _id: { $in: itemIds }, subject: { $in: [...subjects] } })
      .select("_id")
      .lean();
    const keep = new Set(readable.map((i) => i._id.toString()));
    records = records.filter((r) => keep.has(r.hwItemId.toString()));
  }

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

export async function questionUsageFeed(
  classId: string,
  /** D-#770: narrow to one section — the items declared on it plus any item its
   *  records point at (an item issued before a split serves both halves), and the
   *  section's own top-ups. Omit for the class-wide feed. */
  sectionId?: string | null,
): Promise<QuestionUsageResult> {
  let items;
  let topups;
  if (sectionId) {
    const recs = await HomeworkStudentRecord.find({ classId, sectionId }).lean();
    topups = recs.filter((r) => r.topupFlag);
    items = await HomeworkItem.find({
      classId,
      $or: [{ sectionId }, { _id: { $in: [...new Set(recs.map((r) => r.hwItemId.toString()))] } }],
    }).lean();
  } else {
    items = await HomeworkItem.find({ classId }).lean();
    topups = await HomeworkStudentRecord.find({ classId, topupFlag: true }).lean();
  }

  const usage = new Map<string, number>();
  for (const it of items) for (const qid of it.selectedQids ?? []) usage.set(qid, (usage.get(qid) ?? 0) + 1);
  for (const r of topups) for (const qid of r.topupQids ?? []) usage.set(qid, (usage.get(qid) ?? 0) + 1);

  const feed = [...usage.entries()]
    .map(([qid, count]) => ({ qid, count }))
    .sort((a, b) => b.count - a.count);

  return { classId, feed };
}
