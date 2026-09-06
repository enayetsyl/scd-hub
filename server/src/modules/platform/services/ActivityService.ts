/**
 * ActivityService — one person's complete recorded activity, day by day (AL-1, D-#645).
 *
 * WHY THIS IS NOT JUST `auditLog` WITH AN ACTOR FILTER.
 * The audit log (ADR-008) answers "who did what" for ~219 administrative event
 * kinds, and it is genuinely complete for those. But the highest-volume thing a
 * TEACHER does all day — walking a roster and marking work জমা হয়েছে / দেখা
 * হয়েছে — writes NO audit row at all: `TRACKER_WRITE` is declared in the union
 * and emitted nowhere. That work is stamped on the record instead, in
 * `stateDates[].by/.at` (added for the D-#338 revert authorization). So a person
 * timeline built on the audit log alone shows an office desk's whole day and
 * almost nothing of a teacher's, which is exactly backwards from what the reader
 * is asking.
 *
 * Rather than start writing an audit row per student per transition — thousands
 * a day, and with no history before the change — this service READS the stamps
 * that already exist. That makes the timeline retroactive to the first day of
 * the tracker, at the cost of the two sources paging differently (below).
 *
 * ONE PASS IS ONE ROW, NOT THIRTY. Tracker stamps are folded to
 * (item × state × Dhaka day) with a count: "HW-C5-ENG-0012 — ২৮ জন শিক্ষার্থীকে
 * জমা হয়েছে চিহ্নিত করেছেন", which is the altitude the question is asked at. Two
 * separate passes over the same item on the same day fold into one row on
 * purpose — the answer to "what did he do that day" is the day's total.
 *
 * RANGE-WINDOWED, NOT CURSOR-PAGED. `auditLog` pages on an `eventAt` cursor.
 * That cannot be extended across the folded tracker rows: a cursor landing
 * inside a day would re-emit the same (item, state, day) group with a smaller
 * count on the next page, which reads as the teacher having done the work twice.
 * So the person view takes a DATE RANGE and reports `truncated` when a source
 * hits its cap — the reader narrows the range instead of scrolling. The daily
 * counts (`personActivityDays`) exist so they can see which days are worth
 * opening before they narrow.
 *
 * PII: this is the operational plane. It reads identity (Users, Guardians, and
 * — since AL-2's expand — the Students named inside one pass) and the trackers'
 * identity-bearing Layer-B records. That is allowed here and nowhere near the
 * firewall: ADR-005 forbids the CORPUS plane from joining back to identity, and
 * this module imports nothing from `modules/corpus` and is never imported by it.
 * The reader is the Principal under `audit:read`, who can already open any of
 * these rosters directly; the expand saves them the trip, it does not widen what
 * they may see.
 */
import { Types, type PipelineStage } from "mongoose";
import { LIFECYCLE_STATE_LABELS_BN, LIFECYCLE_STATE_LABELS_EN } from "@scd/shared";
import { Audit, type IAudit } from "../models/Audit";
import { User } from "../../foundation/models/User";
import { Guardian } from "../../foundation/models/Guardian";
import { HomeworkStudentRecord } from "../../trackers/models/HomeworkStudentRecord";
import { AssignmentStudentRecord } from "../../trackers/models/AssignmentStudentRecord";
import { HomeworkItem } from "../../trackers/models/HomeworkItem";
import { AssignmentItem } from "../../trackers/models/AssignmentItem";
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { auditKindLabel, kindsInGroup, type ActivityGroup, ACTIVITY_GROUPS } from "../auditLabels";
import { dhakaDayKey } from "../../../lib/dhakaDay";

export const ACTIVITY_LIMIT_DEFAULT = 200;
export const ACTIVITY_LIMIT_MAX = 500;
export const ACTIVITY_PEOPLE_LIMIT_DEFAULT = 30;
export const ACTIVITY_PEOPLE_LIMIT_MAX = 100;
/** Widest window a single read may span. A year of one person's activity is a
 *  report, not a screen — and the tracker fold is per day, so the cost is linear. */
export const ACTIVITY_MAX_RANGE_DAYS = 400;

export type ActivitySource = "AUDIT" | "HOMEWORK" | "ASSIGNMENT";
export const ACTIVITY_SOURCES: readonly ActivitySource[] = ["AUDIT", "HOMEWORK", "ASSIGNMENT"];

export interface ActivityPersonShape {
  id: string;
  name: string;
  /** Staff role, or "GUARDIAN" for a guardian account. */
  role: string;
  kind: "STAFF" | "GUARDIAN";
  active: boolean;
}

export interface ActivityRowShape {
  id: string;
  source: ActivitySource;
  /** Sort instant — the audit event, or the LAST stamp of a folded pass. */
  at: string;
  /** Folded tracker rows only: the first stamp of the pass. Null for audit rows. */
  firstAt: string | null;
  /** Dhaka calendar day, "YYYY-MM-DD" — the grouping key the reader sees. */
  day: string;
  /** Audit event kind, or the lifecycle state for a tracker pass. */
  kind: string;
  labelBn: string;
  labelEn: string;
  group: ActivityGroup;
  /** Students touched by a folded pass; 1 for an audit row. */
  count: number;
  targetKind: string | null;
  targetId: string | null;
  /** Human handle for the thing acted on — the HW_ID/AS_ID for tracker rows. */
  targetLabel: string | null;
  /** Tracker rows only (AL-2): WHERE the work was, resolved from the item so the
   *  reader does not have to decode `HW-C3-ENG-0020` in their head. */
  subject: string | null;
  classLevel: number | null;
  sectionName: string | null;
  /** The item's own date — dateGiven (homework) / deliveryDate (assignment). */
  itemDate: string | null;
  metaJson: string | null;
  /** Written inside a "View as" session (D-#638) — the Principal acting through
   *  this account, NOT this person. Shown, never hidden: a timeline that quietly
   *  attributed the Principal's actions to the borrowed account would be a lie. */
  viaViewAs: boolean;
}

export interface ActivityDayShape {
  day: string;
  audit: number;
  homework: number;
  assignment: number;
  total: number;
}

export interface PersonActivityResult {
  rows: ActivityRowShape[];
  /** True when any source hit its cap — the window is hiding rows. */
  truncated: boolean;
}

export interface PersonActivityInput {
  personId: string;
  /** Dhaka calendar days, inclusive, "YYYY-MM-DD". */
  from: string;
  to: string;
  group?: string | null;
  kind?: string | null;
  source?: string | null;
  limit?: number | null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "YYYY-MM-DD" (Dhaka) → the instant that day begins, in UTC. */
function dayStartInstant(day: string): Date {
  return new Date(`${day}T00:00:00.000+06:00`);
}
/** "YYYY-MM-DD" (Dhaka) → the instant that day ends, in UTC. */
function dayEndInstant(day: string): Date {
  return new Date(`${day}T23:59:59.999+06:00`);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates + clamps the requested window. Throws on a malformed day so a typo
 *  cannot silently widen to "everything ever". */
export function resolveWindow(from: string, to: string): { start: Date; end: Date } {
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) {
    throw new Error("from/to must be YYYY-MM-DD dates");
  }
  const start = dayStartInstant(from);
  const end = dayEndInstant(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("from/to must be valid dates");
  }
  if (end < start) throw new Error("`to` must not be earlier than `from`");
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (spanDays > ACTIVITY_MAX_RANGE_DAYS) {
    throw new Error(`range must not exceed ${ACTIVITY_MAX_RANGE_DAYS} days`);
  }
  return { start, end };
}

function isActivityGroup(v: string): v is ActivityGroup {
  return (ACTIVITY_GROUPS as readonly string[]).includes(v);
}

/**
 * People who can appear in a timeline: staff Users and Guardians, searched by
 * name. Deliberately NOT filtered to "people who have activity" — proving a
 * negative is exactly what the reader wants for an account they suspect is
 * unused, and an empty timeline says that far more clearly than an absent name.
 */
export async function activityPeople(
  input: { search?: string | null; limit?: number | null } = {},
): Promise<ActivityPersonShape[]> {
  const limit = Math.min(
    Math.max(input.limit ?? ACTIVITY_PEOPLE_LIMIT_DEFAULT, 1),
    ACTIVITY_PEOPLE_LIMIT_MAX,
  );
  const search = input.search?.trim() ?? "";
  const nameQ = search === "" ? {} : { name: new RegExp(escapeRegex(search), "i") };

  const [users, guardians] = await Promise.all([
    User.find(nameQ).select("name role active").limit(limit).lean() as unknown as Promise<
      Array<{ _id: Types.ObjectId; name?: string; role?: string; active?: boolean }>
    >,
    Guardian.find(nameQ).select("name active").limit(limit).lean() as unknown as Promise<
      Array<{ _id: Types.ObjectId; name?: string; active?: boolean }>
    >,
  ]);

  const rows: ActivityPersonShape[] = [
    ...users.map((u) => ({
      id: u._id.toString(),
      name: u.name ?? "—",
      role: u.role ?? "—",
      kind: "STAFF" as const,
      active: u.active !== false,
    })),
    ...guardians.map((g) => ({
      id: g._id.toString(),
      name: g.name ?? "—",
      role: "GUARDIAN",
      kind: "GUARDIAN" as const,
      active: g.active !== false,
    })),
  ];
  // Staff first (the common reader intent), then by name.
  rows.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name, "bn") : a.kind === "STAFF" ? -1 : 1,
  );
  return rows.slice(0, limit);
}

/** Resolves one person's display identity from either collection. */
export async function activityPerson(personId: string): Promise<ActivityPersonShape | null> {
  if (!Types.ObjectId.isValid(personId)) return null;
  const id = new Types.ObjectId(personId);
  const [user, guardian] = await Promise.all([
    User.findById(id).select("name role active").lean() as unknown as Promise<{
      _id: Types.ObjectId;
      name?: string;
      role?: string;
      active?: boolean;
    } | null>,
    Guardian.findById(id).select("name active").lean() as unknown as Promise<{
      _id: Types.ObjectId;
      name?: string;
      active?: boolean;
    } | null>,
  ]);
  if (user) {
    return {
      id: user._id.toString(),
      name: user.name ?? "—",
      role: user.role ?? "—",
      kind: "STAFF",
      active: user.active !== false,
    };
  }
  if (guardian) {
    return {
      id: guardian._id.toString(),
      name: guardian.name ?? "—",
      role: "GUARDIAN",
      kind: "GUARDIAN",
      active: guardian.active !== false,
    };
  }
  return null;
}

interface TrackerItemJoin {
  subject?: string;
  classId?: Types.ObjectId;
  sectionId?: Types.ObjectId;
  dateGiven?: Date;
  deliveryDate?: Date;
  description?: string;
  dueDate?: Date;
}

interface TrackerFoldRow {
  _id: { item: Types.ObjectId; state: string; day: string };
  count: number;
  firstAt: Date;
  lastAt: Date;
  code?: string;
  item?: TrackerItemJoin;
}

/** Class level + section name for a batch of ids, resolved once per read rather
 *  than once per row (the AuditQueryService name-join pattern). */
interface PlaceNames {
  levelByClassId: Map<string, number>;
  nameBySectionId: Map<string, string>;
}

const EMPTY_PLACES: PlaceNames = { levelByClassId: new Map(), nameBySectionId: new Map() };

async function resolvePlaces(rows: TrackerFoldRow[]): Promise<PlaceNames> {
  const classIds = [...new Set(rows.map((r) => r.item?.classId?.toString()).filter(Boolean))] as string[];
  const sectionIds = [...new Set(rows.map((r) => r.item?.sectionId?.toString()).filter(Boolean))] as string[];
  if (classIds.length === 0 && sectionIds.length === 0) return EMPTY_PLACES;
  const [classes, sections] = await Promise.all([
    Class.find({ _id: { $in: classIds } }).select("level").lean() as unknown as Promise<
      Array<{ _id: Types.ObjectId; level?: number }>
    >,
    Section.find({ _id: { $in: sectionIds } }).select("nameBn").lean() as unknown as Promise<
      Array<{ _id: Types.ObjectId; nameBn?: string }>
    >,
  ]);
  const levelByClassId = new Map<string, number>();
  for (const c of classes) if (typeof c.level === "number") levelByClassId.set(c._id.toString(), c.level);
  const nameBySectionId = new Map<string, string>();
  for (const sec of sections) if (sec.nameBn) nameBySectionId.set(sec._id.toString(), sec.nameBn);
  return { levelByClassId, nameBySectionId };
}

/** The fold pipeline, identical in shape for both trackers — only the field
 *  names of the item reference and its human code differ. */
function trackerPipeline(
  actorId: Types.ObjectId,
  start: Date,
  end: Date,
  itemField: string,
  codeField: string,
  itemCollection: string,
  limit: number,
): PipelineStage[] {
  const range = { $gte: start, $lte: end };
  return [
    // Pre-`$unwind` narrowing: hits the {stateDates.by, stateDates.at} index.
    // Matches ACROSS elements at this stage (a record this person touched at
    // some point, with SOME stamp in the window) — the post-unwind match below
    // is what makes it exact.
    { $match: { "stateDates.by": actorId, "stateDates.at": range } },
    { $unwind: "$stateDates" },
    { $match: { "stateDates.by": actorId, "stateDates.at": range } },
    {
      $group: {
        _id: {
          item: `$${itemField}`,
          state: "$stateDates.state",
          day: { $dateToString: { format: "%Y-%m-%d", date: "$stateDates.at", timezone: "Asia/Dhaka" } },
        },
        count: { $sum: 1 },
        firstAt: { $min: "$stateDates.at" },
        lastAt: { $max: "$stateDates.at" },
        code: { $first: `$${codeField}` },
      },
    },
    { $sort: { lastAt: -1 } },
    { $limit: limit },
    // AFTER the limit, never before: at most `limit` items are joined, not every
    // record the person has ever touched.
    {
      $lookup: {
        from: itemCollection,
        localField: "_id.item",
        foreignField: "_id",
        as: "item",
      },
    },
    { $unwind: { path: "$item", preserveNullAndEmptyArrays: true } },
  ];
}

async function homeworkRows(
  actorId: Types.ObjectId,
  start: Date,
  end: Date,
  limit: number,
): Promise<ActivityRowShape[]> {
  const folded = (await HomeworkStudentRecord.aggregate(
    trackerPipeline(actorId, start, end, "hwItemId", "hwId", HomeworkItem.collection.name, limit),
  )) as unknown as TrackerFoldRow[];
  const places = await resolvePlaces(folded);
  return folded.map((f) => trackerRow(f, "HOMEWORK", places));
}

async function assignmentRows(
  actorId: Types.ObjectId,
  start: Date,
  end: Date,
  limit: number,
): Promise<ActivityRowShape[]> {
  const folded = (await AssignmentStudentRecord.aggregate(
    trackerPipeline(actorId, start, end, "asItemId", "asId", AssignmentItem.collection.name, limit),
  )) as unknown as TrackerFoldRow[];
  const places = await resolvePlaces(folded);
  return folded.map((f) => trackerRow(f, "ASSIGNMENT", places));
}

function trackerRow(
  f: TrackerFoldRow,
  source: "HOMEWORK" | "ASSIGNMENT",
  places: PlaceNames = EMPTY_PLACES,
): ActivityRowShape {
  const state = f._id.state;
  const stateBn =
    (LIFECYCLE_STATE_LABELS_BN as Record<string, string | undefined>)[state] ?? state;
  const stateEn =
    (LIFECYCLE_STATE_LABELS_EN as Record<string, string | undefined>)[state] ?? state;
  const noun = source === "HOMEWORK" ? "বাড়ির কাজে" : "অ্যাসাইনমেন্টে";
  const nounEn = source === "HOMEWORK" ? "homework" : "assignment";
  return {
    // Stable across re-reads of the same window: the fold key IS the identity.
    id: `${source}:${f._id.item.toString()}:${state}:${f._id.day}`,
    source,
    at: new Date(f.lastAt).toISOString(),
    firstAt: new Date(f.firstAt).toISOString(),
    day: f._id.day,
    kind: state,
    labelBn: `${noun} “${stateBn}” চিহ্নিত করেছেন`,
    labelEn: `Marked ${nounEn} “${stateEn}”`,
    group: source === "HOMEWORK" ? "HOMEWORK" : "ASSIGNMENT",
    count: f.count,
    targetKind: source === "HOMEWORK" ? "HomeworkItem" : "AssignmentItem",
    targetId: f._id.item.toString(),
    targetLabel: f.code ?? null,
    subject: f.item?.subject ?? null,
    classLevel: f.item?.classId ? places.levelByClassId.get(f.item.classId.toString()) ?? null : null,
    sectionName: f.item?.sectionId
      ? places.nameBySectionId.get(f.item.sectionId.toString()) ?? null
      : null,
    itemDate: itemDateOf(f.item),
    metaJson: null,
    viaViewAs: false,
  };
}

/** Homework calls it `dateGiven`, assignments `deliveryDate`; the reader wants
 *  "the day this work belongs to" either way. */
function itemDateOf(item?: TrackerItemJoin): string | null {
  const d = item?.dateGiven ?? item?.deliveryDate;
  return d ? new Date(d).toISOString() : null;
}

async function auditRows(
  actorId: Types.ObjectId,
  start: Date,
  end: Date,
  limit: number,
  kind?: string | null,
  group?: string | null,
): Promise<ActivityRowShape[]> {
  const q: Record<string, unknown> = {
    // A "View as" row names the Principal as actor and the borrowed account in
    // `onBehalfOf`. Both belong on this person's timeline — one as their own
    // action, the other as something done THROUGH them (flagged, never merged).
    $or: [{ actorId }, { onBehalfOf: actorId }],
    eventAt: { $gte: start, $lte: end },
  };
  if (kind) {
    q.eventKind = kind;
  } else if (group && isActivityGroup(group)) {
    q.eventKind = { $in: kindsInGroup(group) };
  }

  const rows = (await Audit.find(q).sort({ eventAt: -1 }).limit(limit).lean()) as unknown as IAudit[];
  return rows.map((r) => {
    const label = auditKindLabel(r.eventKind);
    const at = new Date(r.eventAt);
    return {
      id: r._id.toString(),
      source: "AUDIT" as const,
      at: at.toISOString(),
      firstAt: null,
      day: dhakaDayKey(at),
      kind: r.eventKind,
      labelBn: label.bn,
      labelEn: label.en,
      group: label.group,
      count: 1,
      targetKind: r.targetKind ?? null,
      targetId: r.targetId ? r.targetId.toString() : null,
      targetLabel: null,
      subject: null,
      classLevel: null,
      sectionName: null,
      itemDate: null,
      metaJson: r.meta && Object.keys(r.meta).length > 0 ? JSON.stringify(r.meta) : null,
      viaViewAs: r.onBehalfOf != null && r.onBehalfOf.toString() === actorId.toString(),
    };
  });
}

/**
 * One person's activity across every recorded source, newest first.
 * Gate: `audit:read` (Principal) — enforced at the resolver.
 */
export async function personActivity(input: PersonActivityInput): Promise<PersonActivityResult> {
  if (!Types.ObjectId.isValid(input.personId)) return { rows: [], truncated: false };
  const actorId = new Types.ObjectId(input.personId);
  const { start, end } = resolveWindow(input.from, input.to);
  const limit = Math.min(Math.max(input.limit ?? ACTIVITY_LIMIT_DEFAULT, 1), ACTIVITY_LIMIT_MAX);

  const source = input.source ?? null;
  const group = input.group ?? null;
  const kind = input.kind ?? null;

  // An unrecognised filter is REFUSED, not ignored and not silently empty. The
  // app only ever sends values from `activityGroups`/`activitySources`, so a bad
  // one is a bug — and both alternatives lie to the reader: ignoring it shows
  // everything under a filter chip, and returning nothing reads as "this person
  // did nothing", which is the single most damaging wrong answer this screen can
  // give about a member of staff.
  if (group !== null && !isActivityGroup(group)) {
    throw new Error(`unknown activity group "${group}"`);
  }
  if (source !== null && !(ACTIVITY_SOURCES as readonly string[]).includes(source)) {
    throw new Error(`unknown activity source "${source}"`);
  }

  // A kind filter names an AUDIT kind (a lifecycle state is not one), so it and
  // any non-tracker group take the tracker sources out of the read entirely.
  const wantAudit =
    (source === null || source === "AUDIT") &&
    (group === null || kindsInGroup(group).length > 0);
  const wantHomework =
    (source === null || source === "HOMEWORK") &&
    (group === null || group === "HOMEWORK") &&
    kind === null;
  const wantAssignment =
    (source === null || source === "ASSIGNMENT") &&
    (group === null || group === "ASSIGNMENT") &&
    kind === null;

  const [audit, homework, assignment] = await Promise.all([
    wantAudit ? auditRows(actorId, start, end, limit, kind, group) : Promise.resolve([]),
    wantHomework ? homeworkRows(actorId, start, end, limit) : Promise.resolve([]),
    wantAssignment ? assignmentRows(actorId, start, end, limit) : Promise.resolve([]),
  ]);

  // Any source returning a full page means the window is hiding rows; say so
  // rather than presenting a silently partial day as a complete one.
  const truncated =
    audit.length >= limit || homework.length >= limit || assignment.length >= limit;

  const rows = [...audit, ...homework, ...assignment].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { rows: rows.slice(0, limit), truncated };
}

/**
 * Per-day totals across the window — the map the reader uses to pick a day
 * before narrowing the range. Three cheap `$group`s, no row bodies.
 */
export async function personActivityDays(input: {
  personId: string;
  from: string;
  to: string;
}): Promise<ActivityDayShape[]> {
  if (!Types.ObjectId.isValid(input.personId)) return [];
  const actorId = new Types.ObjectId(input.personId);
  const { start, end } = resolveWindow(input.from, input.to);
  const range = { $gte: start, $lte: end };
  const dayKey = (field: string) => ({
    $dateToString: { format: "%Y-%m-%d", date: field, timezone: "Asia/Dhaka" },
  });

  const [auditDays, hwDays, asDays] = await Promise.all([
    Audit.aggregate([
      { $match: { $or: [{ actorId }, { onBehalfOf: actorId }], eventAt: range } },
      { $group: { _id: dayKey("$eventAt"), n: { $sum: 1 } } },
    ]) as unknown as Promise<Array<{ _id: string; n: number }>>,
    HomeworkStudentRecord.aggregate([
      { $match: { "stateDates.by": actorId, "stateDates.at": range } },
      { $unwind: "$stateDates" },
      { $match: { "stateDates.by": actorId, "stateDates.at": range } },
      { $group: { _id: dayKey("$stateDates.at"), n: { $sum: 1 } } },
    ]) as unknown as Promise<Array<{ _id: string; n: number }>>,
    AssignmentStudentRecord.aggregate([
      { $match: { "stateDates.by": actorId, "stateDates.at": range } },
      { $unwind: "$stateDates" },
      { $match: { "stateDates.by": actorId, "stateDates.at": range } },
      { $group: { _id: dayKey("$stateDates.at"), n: { $sum: 1 } } },
    ]) as unknown as Promise<Array<{ _id: string; n: number }>>,
  ]);

  const byDay = new Map<string, ActivityDayShape>();
  const bump = (day: string, field: "audit" | "homework" | "assignment", n: number): void => {
    const row = byDay.get(day) ?? { day, audit: 0, homework: 0, assignment: 0, total: 0 };
    row[field] += n;
    row.total += n;
    byDay.set(day, row);
  };
  for (const d of auditDays) bump(d._id, "audit", d.n);
  for (const d of hwDays) bump(d._id, "homework", d.n);
  for (const d of asDays) bump(d._id, "assignment", d.n);

  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}


// ---------------------------------------------------------------------------
// AL-2 — the expand: what ONE row is actually made of.
//
// Kept as its own lazy read rather than folded into `personActivity`: a window
// of 500 rows would otherwise join and return ~15,000 student sub-documents to
// render a list nobody has opened yet. One row is opened at a time, so one row
// is fetched at a time.
// ---------------------------------------------------------------------------

export interface ActivityStudentShape {
  id: string;
  name: string;
  rollNumber: string | null;
  /** The exact stamp for THIS student in THIS pass — a pass spread over an hour
   *  shows as an hour of individual times, not one rounded moment. */
  at: string;
}

export interface ActivityRowDetailShape {
  rowId: string;
  source: ActivitySource;
  /** Tracker: HW_ID/AS_ID. */
  itemCode: string | null;
  subject: string | null;
  classLevel: number | null;
  sectionName: string | null;
  itemDate: string | null;
  dueDate: string | null;
  /** The teacher's own description of the work. */
  description: string | null;
  /** Audit: the target resolved to a name, where its kind is one we can resolve. */
  targetLabel: string | null;
  targetKind: string | null;
  metaJson: string | null;
  students: ActivityStudentShape[];
  /** More students than the cap — the list is a sample, and says so. */
  studentsTruncated: boolean;
}

/** A section is ~30 students; 200 is a ceiling that no real pass reaches, and
 *  stops a malformed row from streaming a whole collection. */
const DETAIL_STUDENT_CAP = 200;

/**
 * Puts a NAME to an audit row's target. Deliberately a short allow-list rather
 * than a lookup over every collection: 219 event kinds point at dozens of
 * models, and a half-guessed join that returns the wrong name is worse than the
 * raw id, which is at least honestly opaque.
 */
async function resolveAuditTarget(
  targetKind: string | null | undefined,
  targetId: Types.ObjectId | null | undefined,
): Promise<string | null> {
  if (!targetKind || !targetId) return null;
  const id = targetId;
  switch (targetKind) {
    case "Student": {
      const d = (await Student.findById(id).select("name nameBn rollNumber").lean()) as
        | { name?: string; nameBn?: string; rollNumber?: string }
        | null;
      if (!d) return null;
      const nm = d.nameBn ?? d.name ?? null;
      return nm && d.rollNumber ? `${nm} (${d.rollNumber})` : nm;
    }
    case "User": {
      const d = (await User.findById(id).select("name").lean()) as { name?: string } | null;
      return d?.name ?? null;
    }
    case "Guardian": {
      const d = (await Guardian.findById(id).select("name").lean()) as { name?: string } | null;
      return d?.name ?? null;
    }
    case "Section": {
      const d = (await Section.findById(id).select("nameBn").lean()) as { nameBn?: string } | null;
      return d?.nameBn ?? null;
    }
    case "Class": {
      const d = (await Class.findById(id).select("nameBn").lean()) as { nameBn?: string } | null;
      return d?.nameBn ?? null;
    }
    case "HomeworkItem": {
      const d = (await HomeworkItem.findById(id).select("hwId").lean()) as { hwId?: string } | null;
      return d?.hwId ?? null;
    }
    case "AssignmentItem": {
      const d = (await AssignmentItem.findById(id).select("asId").lean()) as { asId?: string } | null;
      return d?.asId ?? null;
    }
    default:
      // Unresolvable kinds keep the raw id on screen — opaque, but never wrong.
      return null;
  }
}

interface StudentStampRow {
  studentId: Types.ObjectId;
  at: Date;
  student?: { name?: string; nameBn?: string; rollNumber?: string };
}

async function trackerRowDetail(
  source: "HOMEWORK" | "ASSIGNMENT",
  actorId: Types.ObjectId,
  itemId: Types.ObjectId,
  state: string,
  day: string,
): Promise<ActivityRowDetailShape | null> {
  const start = dayStartInstant(day);
  const end = dayEndInstant(day);
  if (Number.isNaN(start.getTime())) return null;
  const range = { $gte: start, $lte: end };

  const isHw = source === "HOMEWORK";
  const recordModel = isHw ? HomeworkStudentRecord : AssignmentStudentRecord;
  const itemField = isHw ? "hwItemId" : "asItemId";
  // Each `findById` is issued on a CONCRETE model: a `HomeworkItem | AssignmentItem`
  // variable is a union of two overload sets and tsc cannot call it.
  const ITEM_FIELDS = "hwId asId subject classId sectionId dateGiven deliveryDate dueDate description";

  const [item, stamps] = await Promise.all([
    (isHw
      ? HomeworkItem.findById(itemId).select(ITEM_FIELDS).lean()
      : AssignmentItem.findById(itemId).select(ITEM_FIELDS).lean()) as unknown as Promise<
      | ({
          hwId?: string;
          asId?: string;
          dueDate?: Date;
          description?: string;
        } & TrackerItemJoin)
      | null
    >,
    recordModel.aggregate([
      { $match: { [itemField]: itemId, "stateDates.by": actorId, "stateDates.at": range } },
      { $unwind: "$stateDates" },
      {
        $match: {
          "stateDates.by": actorId,
          "stateDates.state": state,
          "stateDates.at": range,
        },
      },
      { $sort: { "stateDates.at": 1 } },
      { $limit: DETAIL_STUDENT_CAP + 1 },
      {
        $lookup: {
          from: Student.collection.name,
          localField: "studentId",
          foreignField: "_id",
          as: "student",
        },
      },
      { $unwind: { path: "$student", preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, studentId: 1, at: "$stateDates.at", student: 1 } },
    ]) as unknown as Promise<StudentStampRow[]>,
  ]);

  const truncated = stamps.length > DETAIL_STUDENT_CAP;
  const shown = truncated ? stamps.slice(0, DETAIL_STUDENT_CAP) : stamps;

  const places = await resolvePlaces([
    {
      _id: { item: itemId, state, day },
      count: 0,
      firstAt: start,
      lastAt: start,
      item: item ?? undefined,
    },
  ]);

  return {
    rowId: `${source}:${itemId.toString()}:${state}:${day}`,
    source,
    itemCode: (isHw ? item?.hwId : item?.asId) ?? null,
    subject: item?.subject ?? null,
    classLevel: item?.classId ? places.levelByClassId.get(item.classId.toString()) ?? null : null,
    sectionName: item?.sectionId
      ? places.nameBySectionId.get(item.sectionId.toString()) ?? null
      : null,
    itemDate: itemDateOf(item ?? undefined),
    dueDate: item?.dueDate ? new Date(item.dueDate).toISOString() : null,
    description: item?.description ?? null,
    targetLabel: null,
    targetKind: isHw ? "HomeworkItem" : "AssignmentItem",
    metaJson: null,
    students: shown.map((r) => ({
      id: r.studentId.toString(),
      name: r.student?.nameBn ?? r.student?.name ?? "—",
      rollNumber: r.student?.rollNumber ?? null,
      at: new Date(r.at).toISOString(),
    })),
    studentsTruncated: truncated,
  };
}

/**
 * The detail behind one timeline row. `rowId` is the id the row already carries:
 * the fold key for a tracker pass, the audit `_id` for an event.
 * Gate: `audit:read` (Principal) — enforced at the resolver.
 */
export async function activityRowDetail(input: {
  personId: string;
  rowId: string;
}): Promise<ActivityRowDetailShape | null> {
  if (!Types.ObjectId.isValid(input.personId)) return null;
  const actorId = new Types.ObjectId(input.personId);

  const parts = input.rowId.split(":");
  if (parts.length === 4 && (parts[0] === "HOMEWORK" || parts[0] === "ASSIGNMENT")) {
    const [source, itemId, state, day] = parts;
    if (!Types.ObjectId.isValid(itemId) || !DAY_RE.test(day)) return null;
    return trackerRowDetail(
      source as "HOMEWORK" | "ASSIGNMENT",
      actorId,
      new Types.ObjectId(itemId),
      state,
      day,
    );
  }

  if (!Types.ObjectId.isValid(input.rowId)) return null;
  const row = (await Audit.findById(new Types.ObjectId(input.rowId)).lean()) as unknown as IAudit | null;
  if (!row) return null;
  // The row must actually belong to this person's timeline. The caller holds
  // audit:read and could read it directly anyway — but a detail endpoint that
  // answers for a row it was not asked about is a contract nobody can reason on.
  const belongs =
    row.actorId?.toString() === actorId.toString() ||
    row.onBehalfOf?.toString() === actorId.toString();
  if (!belongs) return null;

  return {
    rowId: row._id.toString(),
    source: "AUDIT",
    itemCode: null,
    subject: null,
    classLevel: null,
    sectionName: null,
    itemDate: null,
    dueDate: null,
    description: null,
    targetLabel: await resolveAuditTarget(row.targetKind, row.targetId),
    targetKind: row.targetKind ?? null,
    metaJson: row.meta && Object.keys(row.meta).length > 0 ? JSON.stringify(row.meta) : null,
    students: [],
    studentsTruncated: false,
  };
}
