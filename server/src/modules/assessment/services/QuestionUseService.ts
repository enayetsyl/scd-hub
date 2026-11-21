/**
 * QuestionUseService — the single use history (AL-3, D-#1667, docs/prd-academic-loop-2027.md §3.2).
 *
 * Writers (`recordUses` / `syncUses` / `withdrawUses`) are called at each "a question went to the children"
 * moment and run regardless of the release switch (§3.6). Readers answer "what did this শাখা / child have, and
 * when" in one indexed query, so the builders (homework draft, extra homework, assignment Part A / B) and the
 * class-test block never join four sources.
 *
 * Days, not weeks: the window is `assignmentNoRepeatWeeks × 7` calendar days (Dhaka day keys). A use given
 * exactly N days ago is still INSIDE the window (blocked); N + 1 days ago is outside ("more than 28 days ago",
 * AC-B16). The tracker's Sun–Sat weeks and mastery's ISO weeks differ, which is why a day count is used.
 *
 * Merged শাখা (D-#62): a read for a merged (combined) শাখা also reads its `SectionMerge.sourceSectionIds`.
 * A child's history follows the child: whole-শাখা uses of an earlier শাখা the child sat in are read through the
 * child's Enrolment history and credited to that child only for the days they were enrolled there.
 */
import { Types } from "mongoose";
import {
  QuestionUse,
  questionUseKey,
  type QuestionUseKind,
  type QuestionUseSourceType,
} from "../models/QuestionUse";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { Student } from "../../foundation/models/Student";
import { SectionMerge } from "../../foundation/models/SectionMerge";
import { Enrolment } from "../../foundation/models/Enrolment";
import { AssessmentSet } from "../models/AssessmentSet";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { ClassTest } from "../../trackers/models/ClassTest";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { getPolicy } from "../../mastery/services/MasteryCatalogueService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { bnNum } from "../../../lib/bnNum";

/** Kinds that count as "homework" for the year rule (§4.3) and the bank share (R21). */
export const HOMEWORK_KINDS: readonly QuestionUseKind[] = ["HW", "EXTRA_HW"];
/** Kinds that block a class-test question (R19). */
export const CT_BLOCKING_KINDS: readonly QuestionUseKind[] = ["HW", "EXTRA_HW", "AS"];

const oid = (s: string | Types.ObjectId) => new Types.ObjectId(String(s));

/** Level → catalogue token (copy of MasteryWorkService.classTokenForLevel; kept local to avoid an import cycle). */
export function classTokenOfLevel(level: number | null | undefined): string {
  if (level === -1) return "NUR";
  if (level === 0) return "KG";
  return typeof level === "number" && level >= 1 && level <= 6 ? `C${level}` : "";
}

// ---------------------------------------------------------------------------
// Day arithmetic (Dhaka day keys)
// ---------------------------------------------------------------------------

export function todayKey(now: Date = new Date()): string {
  return dhakaDayKey(now);
}

export function addDaysKey(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** First day INSIDE the window: today − days (a use that many days ago is still blocked). */
export function windowStartKey(today: string, days: number): string {
  return addDaysKey(today, -days);
}

/** `assignmentNoRepeatWeeks` for the class × subject (default 4). */
export async function noRepeatWeeks(classToken?: string | null, subject?: string | null): Promise<number> {
  const p = await getPolicy((classToken || null) as never, (subject || null) as never);
  const w = Number(p.resolved.assignmentNoRepeatWeeks);
  return Number.isFinite(w) && w > 0 ? w : 4;
}

/** The release switch (school-wide). Only the class-test block (R19) and the bank share (R21) read it. */
export async function isLoop2027On(): Promise<boolean> {
  const p = await getPolicy(null, null);
  return p.resolved.academicLoop2027On === true;
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

export interface UseInput {
  qid: string;
  kind: QuestionUseKind;
  sourceType: QuestionUseSourceType;
  sourceId: string | Types.ObjectId;
  itemNo?: number | null;
  academicYearId: string | Types.ObjectId;
  sectionId: string | Types.ObjectId;
  classToken?: string | null;
  subject: string;
  /** [] / omitted = the whole শাখা roster. */
  studentIds?: (string | Types.ObjectId)[];
  /** "YYYY-MM-DD" Dhaka. */
  givenOn: string;
}

function rowOf(u: UseInput) {
  const studentIds = [...new Set((u.studentIds ?? []).map(String))].sort().map(oid);
  return {
    qid: u.qid,
    kind: u.kind,
    sourceType: u.sourceType,
    sourceId: oid(u.sourceId),
    ...(u.itemNo != null ? { itemNo: u.itemNo } : {}),
    academicYearId: oid(u.academicYearId),
    sectionId: oid(u.sectionId),
    classToken: u.classToken ?? "",
    subject: u.subject,
    studentIds,
    givenOn: u.givenOn,
    useKey: questionUseKey({ ...u, studentIds }),
  };
}

/**
 * Write the given rows, idempotently (upsert on `useKey`). A row that was withdrawn and is given again comes
 * back (withdrawnAt cleared, givenOn refreshed). A repeat write of a LIVE row (a reprint) changes nothing: the first
 * given day wins. Returns how many rows were touched.
 */
export async function recordUses(uses: UseInput[], opts: { onlyNew?: boolean } = {}): Promise<number> {
  const clean = uses.filter((u) => typeof u.qid === "string" && u.qid.trim() !== "");
  if (clean.length === 0) return 0;
  const ops = clean.map((u) => {
    const r = rowOf(u);
    const { useKey, ...rest } = r;
    // onlyNew (the backfill): an existing row — including one withdrawn on purpose — is left exactly as it is.
    const { givenOn, ...others } = rest;
    const update = opts.onlyNew
      ? { $setOnInsert: { ...rest, withdrawnAt: null } }
      : [
          {
            $set: {
              ...Object.fromEntries(Object.entries(others).map(([k, v]) => [k, { $literal: v }])),
              // First given day wins; a row that was withdrawn and is given again takes the new day.
              givenOn: { $cond: [{ $ne: [{ $ifNull: ["$withdrawnAt", null] }, null] }, { $literal: givenOn }, { $ifNull: ["$givenOn", { $literal: givenOn }] }] },
              withdrawnAt: null,
            },
          },
        ];
    return { updateOne: { filter: { useKey }, update, upsert: true } };
  });
  await QuestionUse.bulkWrite(ops, { ordered: false });
  return ops.length;
}

/** Withdraw every live row of one source (a paper deleted / an issue undone before results). */
export async function withdrawUses(
  sourceType: QuestionUseSourceType,
  sourceId: string | Types.ObjectId,
  opts: { studentIds?: (string | Types.ObjectId)[]; at?: Date; qids?: string[]; givenOn?: string } = {},
): Promise<number> {
  const filter: Record<string, unknown> = { sourceType, sourceId: oid(sourceId), withdrawnAt: null };
  // A top-up revert names the exact rows of the spawned resubmission (its qids, on the day it was issued).
  if (opts.qids) filter.qid = { $in: opts.qids };
  if (opts.givenOn) filter.givenOn = opts.givenOn;
  if (opts.studentIds) filter.studentIds = [...new Set(opts.studentIds.map(String))].sort().map(oid);
  const res = await QuestionUse.updateMany(filter, { $set: { withdrawnAt: opts.at ?? new Date() } });
  return res.modifiedCount ?? 0;
}

/** Make a source's live rows exactly `uses`: write them, withdraw the rest (an item list that changed). */
export async function syncUses(
  sourceType: QuestionUseSourceType,
  sourceId: string | Types.ObjectId,
  uses: UseInput[],
): Promise<void> {
  const keep = new Set(uses.map((u) => rowOf(u).useKey));
  await recordUses(uses);
  const live = await QuestionUse.find({ sourceType, sourceId: oid(sourceId), withdrawnAt: null }).select("useKey").lean();
  const stale = live.filter((l) => !keep.has(l.useKey)).map((l) => l._id);
  if (stale.length) await QuestionUse.updateMany({ _id: { $in: stale } }, { $set: { withdrawnAt: new Date() } });
}

/** The parts of a MasteryPaper the ledger needs. */
export interface PaperLike {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  sectionId: Types.ObjectId;
  classToken: string;
  subject: string;
  date: Date;
  items: { itemNo: number; qid?: string | null }[];
  perStudentItems?: { studentId: Types.ObjectId; itemNos: number[] }[];
}

/**
 * Ledger rows for the bank questions on a paper. A paper with no per-student lists gives every item to the whole
 * শাখা. With per-student lists (AS Part A + Part B, extra homework, re-test) an item goes to exactly the children
 * whose list holds it — except that an item on EVERY listed child's sheet of a `wholeIfAll` paper (AS Part A)
 * is a whole-শাখা use. Teacher-written items (no qid) are not bank uses and are skipped.
 */
export function usesOfPaper(
  p: PaperLike,
  kind: QuestionUseKind,
  opts: { givenOn?: string; wholeIfAll?: boolean } = {},
): UseInput[] {
  const givenOn = opts.givenOn ?? p.date.toISOString().slice(0, 10);
  const lists = p.perStudentItems ?? [];
  const out: UseInput[] = [];
  for (const it of p.items) {
    if (!it.qid) continue;
    let studentIds: string[] = [];
    if (lists.length > 0) {
      studentIds = lists.filter((l) => l.itemNos.includes(it.itemNo)).map((l) => String(l.studentId));
      if (studentIds.length === 0) continue;
      if (opts.wholeIfAll && studentIds.length === lists.length) studentIds = [];
    }
    out.push({
      qid: it.qid,
      kind,
      sourceType: "MASTERY_PAPER",
      sourceId: p._id,
      itemNo: it.itemNo,
      academicYearId: p.academicYearId,
      sectionId: p.sectionId,
      classToken: p.classToken,
      subject: p.subject,
      studentIds,
      givenOn,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export interface UseRow {
  qid: string;
  kind: QuestionUseKind;
  sourceType: QuestionUseSourceType;
  sourceId: string;
  givenOn: string;
  sectionId: string;
  /** [] = the whole roster of `sectionId`. */
  studentIds: string[];
  /** True when the row reached the child through an earlier শাখा (Enrolment history). */
  viaEnrolment?: boolean;
}

const asRow = (r: {
  qid: string; kind: string; sourceType: string; sourceId: Types.ObjectId; givenOn: string; sectionId: Types.ObjectId; studentIds?: Types.ObjectId[];
}): UseRow => ({
  qid: r.qid,
  kind: r.kind as QuestionUseKind,
  sourceType: r.sourceType as QuestionUseSourceType,
  sourceId: String(r.sourceId),
  givenOn: r.givenOn,
  sectionId: String(r.sectionId),
  studentIds: (r.studentIds ?? []).map(String),
});

/** A merged (combined) শাখা reads its source শাখা too (§3.7). */
export async function expandSections(sectionIds: (string | Types.ObjectId)[]): Promise<Types.ObjectId[]> {
  const ids = [...new Set(sectionIds.map(String))];
  if (ids.length === 0) return [];
  const merges = await SectionMerge.find({ status: "active", combinedSectionId: { $in: ids.map(oid) } })
    .select("sourceSectionIds")
    .lean();
  const all = new Set(ids);
  for (const m of merges) for (const s of m.sourceSectionIds ?? []) all.add(String(s));
  return [...all].map(oid);
}

/** Rows credited to children through their earlier শাখा (Enrolment history), as per-child rows. */
async function viaEnrolment(
  studentIds: string[],
  currentSections: Set<string>,
  filter: Record<string, unknown>,
): Promise<UseRow[]> {
  if (studentIds.length === 0) return [];
  const enr = await Enrolment.find({ studentId: { $in: studentIds.map(oid) }, status: { $in: ["ACTIVE", "CLOSED"] } })
    .select("studentId sectionId startKey endKey")
    .lean(); // bounded: one roster's enrolments
  const earlier = enr.filter((e) => !currentSections.has(String(e.sectionId)));
  if (earlier.length === 0) return [];
  const sections = [...new Set(earlier.map((e) => String(e.sectionId)))].map(oid);
  const rows = await QuestionUse.find({ ...filter, sectionId: { $in: sections }, studentIds: { $size: 0 } }).lean();
  const out: UseRow[] = [];
  for (const r of rows) {
    for (const e of earlier) {
      if (String(e.sectionId) !== String(r.sectionId)) continue;
      if (r.givenOn < e.startKey || (e.endKey && r.givenOn > e.endKey)) continue;
      out.push({ ...asRow(r), studentIds: [String(e.studentId)], viaEnrolment: true });
    }
  }
  return out;
}

export interface WindowQuery {
  sectionIds: (string | Types.ObjectId)[];
  /** Children whose own history (per-child rows, earlier শাখा) is also read. */
  studentIds?: string[];
  /** Inclusive first day: rows given on or after it. */
  sinceDay: string;
  kinds?: readonly QuestionUseKind[];
  academicYearId?: string | Types.ObjectId;
  subject?: string;
}

/**
 * Every live use in the window for these শাখা (merged শাখা expanded) and, when `studentIds` is given, for those
 * children wherever they sat. Withdrawn rows never count.
 */
export async function usedInWindow(q: WindowQuery): Promise<UseRow[]> {
  const sections = await expandSections(q.sectionIds);
  const base: Record<string, unknown> = { withdrawnAt: null, givenOn: { $gte: q.sinceDay } };
  if (q.kinds) base.kind = { $in: [...q.kinds] };
  if (q.academicYearId) base.academicYearId = oid(q.academicYearId);
  if (q.subject) base.subject = q.subject;
  const or: Record<string, unknown>[] = [{ sectionId: { $in: sections } }];
  if (q.studentIds?.length) or.push({ studentIds: { $in: q.studentIds.map(oid) } });
  const rows = (await QuestionUse.find({ ...base, $or: or }).lean()).map(asRow); // bounded: a window of one শাখা
  const extra = await viaEnrolment(q.studentIds ?? [], new Set(sections.map(String)), base);
  return [...rows, ...extra];
}

/** Homework (HW + EXTRA_HW) used this academic year by the শাখা / children (§4.3). */
export async function homeworkUsedThisYear(q: {
  sectionIds: (string | Types.ObjectId)[];
  academicYearId: string | Types.ObjectId;
  studentIds?: string[];
  subject?: string;
}): Promise<UseRow[]> {
  return usedInWindow({ ...q, sinceDay: "0000-01-01", kinds: HOMEWORK_KINDS });
}

/** qid → the day it was last given to the শাখা (any kind, all time) — the "least recently used" order (R23). */
export async function lastUseBySection(q: {
  sectionIds: (string | Types.ObjectId)[];
  subject?: string;
  qids?: string[];
}): Promise<Map<string, string>> {
  const sections = await expandSections(q.sectionIds);
  const filter: Record<string, unknown> = { withdrawnAt: null, sectionId: { $in: sections } };
  if (q.subject) filter.subject = q.subject;
  if (q.qids) filter.qid = { $in: q.qids };
  const rows = await QuestionUse.find(filter).select("qid givenOn").lean(); // bounded: one শাখা × subject history
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.qid) || out.get(r.qid)! < r.givenOn) out.set(r.qid, r.givenOn);
  return out;
}

/** The qids a row set covers: for the whole শাখা (no `studentId`) every row; for one child the rows that reached them. */
export function qidsOf(rows: UseRow[], studentId?: string): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (studentId === undefined || r.studentIds.length === 0 || r.studentIds.includes(studentId)) out.add(r.qid);
  }
  return out;
}

export interface SectionAvoid {
  /** Window ∪ homework-this-year, any row of the শাখা (Part A, class homework, extra-homework class check). */
  forSection: Set<string>;
  /** One child: whole-শাখা rows plus the rows that reached this child. */
  forChild(studentId: string): Set<string>;
  /** qid → last day given to the শাখা (all time). */
  lastOn: Map<string, string>;
  /** Homework-used (HW + EXTRA_HW) qids this year for the শাখা, any row. */
  homeworkYear: Set<string>;
  /** Every qid with a use inside the no-repeat window (any row of the শাখা, any kind). */
  windowQids: Set<string>;
  windowDays: number;
}

/**
 * What the builders must not offer: any use in the window, plus every homework question of the year (§4.3).
 * Not gated by the release switch — the ledger is always honoured by the builders (only R19 / R21 are gated).
 */
export async function avoidFor(q: {
  sectionId: string | Types.ObjectId;
  academicYearId: string | Types.ObjectId;
  classToken?: string | null;
  subject: string;
  studentIds?: string[];
  today?: string;
}): Promise<SectionAvoid> {
  const today = q.today ?? todayKey();
  const weeks = await noRepeatWeeks(q.classToken, q.subject);
  const days = weeks * 7;
  const [win, hwYear, lastOn] = await Promise.all([
    usedInWindow({ sectionIds: [q.sectionId], studentIds: q.studentIds, sinceDay: windowStartKey(today, days), subject: q.subject }),
    homeworkUsedThisYear({ sectionIds: [q.sectionId], academicYearId: q.academicYearId, studentIds: q.studentIds, subject: q.subject }),
    lastUseBySection({ sectionIds: [q.sectionId], subject: q.subject }),
  ]);
  const all = [...win, ...hwYear];
  return {
    forSection: qidsOf(all),
    forChild: (sid) => qidsOf(all, sid),
    lastOn,
    homeworkYear: qidsOf(hwYear),
    windowQids: qidsOf(win),
    windowDays: days,
  };
}

// ---------------------------------------------------------------------------
// Class-test block (R19) — only while the release switch is on
// ---------------------------------------------------------------------------

export function ctBlockMessage(weeks: number, qids: string[]): string {
  const list = qids.slice(0, 5).join(", ") + (qids.length > 5 ? "…" : "");
  return `এই প্রশ্ন গত ${bnNum(weeks)} সপ্তাহে বাড়ির কাজ / অ্যাসাইনমেন্টে ছিল (${list})`;
}

/** The R19 refusal — the only error a caller should show as a block (anything else is an internal failure). */
export class CtBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CtBlockError";
  }
}

/**
 * The qids among `qids` that a class test of this শাখা may NOT take: given as HW / EXTRA_HW / AS to the শাখা or
 * to any child on its roster within the window. Empty when the release switch is off (§3.6).
 */
export async function ctBlockedQids(q: {
  sectionId: string | Types.ObjectId;
  qids: string[];
  classToken?: string | null;
  subject?: string;
  today?: string;
  /** Only these children (a group-anchored test: the group's members in this শাখা), instead of the whole roster. */
  studentIds?: string[];
}): Promise<{ blocked: string[]; weeks: number }> {
  // Switch first (§3.6): while it is off nothing else is read.
  if (q.qids.length === 0 || !(await isLoop2027On())) return { blocked: [], weeks: 4 };
  const weeks = await noRepeatWeeks(q.classToken, q.subject);
  const kids = q.studentIds ?? (await Student.find({ sectionId: oid(q.sectionId), active: true }).select("_id").lean()).map((s) => String(s._id)); // bounded: one roster
  const rows = await usedInWindow({
    sectionIds: [q.sectionId],
    studentIds: kids,
    sinceDay: windowStartKey(q.today ?? todayKey(), weeks * 7),
    kinds: CT_BLOCKING_KINDS,
  });
  // A named child list (a group-anchored test): only whole-শাখা rows and rows that reached THOSE children count.
  const used = q.studentIds ? new Set(q.studentIds.flatMap((s) => [...qidsOf(rows, s)])) : qidsOf(rows);
  return { blocked: [...new Set(q.qids)].filter((x) => used.has(x)), weeks };
}

/** Throws the R19 refusal when any of `qids` is blocked for a class test of this শাখা. */
export async function assertCtAddable(q: {
  sectionId: string | Types.ObjectId;
  qids: string[];
  classToken?: string | null;
  subject?: string;
  today?: string;
  studentIds?: string[];
}): Promise<void> {
  const { blocked, weeks } = await ctBlockedQids(q);
  if (blocked.length > 0) throw new CtBlockError(ctBlockMessage(weeks, blocked));
}

/** Section → { academicYearId, classToken } for rows written from a section id alone. */
export async function sectionFacts(sectionId: string | Types.ObjectId): Promise<{ academicYearId: Types.ObjectId; classToken: string } | null> {
  const sec = await Section.findById(sectionId).select("classId").lean();
  if (!sec) return null;
  const cls = await Class.findById(sec.classId).select("level academicYearId").lean();
  if (!cls) return null;
  return { academicYearId: cls.academicYearId as Types.ObjectId, classToken: classTokenOfLevel(cls.level as number) };
}

// ---------------------------------------------------------------------------
// Fail-soft wrappers for writers that sit inside someone else's flow
// ---------------------------------------------------------------------------

/**
 * Writers sit at the end of a teacher's action (issue, send, link). The ledger is a read-model for the
 * builders: a failed write must never undo the teacher's work, so it is logged and the backfill repairs it.
 */
export async function recordUsesSafe(uses: UseInput[]): Promise<void> {
  try {
    await recordUses(uses);
  } catch (err) {
    console.error("[question-use] write failed:", err);
  }
}

export async function withdrawUsesSafe(
  sourceType: QuestionUseSourceType,
  sourceId: string | Types.ObjectId,
  opts: { studentIds?: (string | Types.ObjectId)[]; qids?: string[]; givenOn?: string } = {},
): Promise<void> {
  try {
    await withdrawUses(sourceType, sourceId, opts);
  } catch (err) {
    console.error("[question-use] withdraw failed:", err);
  }
}

// ---------------------------------------------------------------------------
// AssessmentSet sources (the legacy pool sets): print, finalise, class-test block
// ---------------------------------------------------------------------------

interface SetTarget {
  sectionId: Types.ObjectId;
  /** [] = the whole roster; a group-anchored test names that শাখা's group members only. */
  studentIds: string[];
  academicYearId: Types.ObjectId;
  classToken: string;
}

interface SetUsePlan {
  kind: QuestionUseKind;
  subject: string;
  qids: { qid: string; itemNo: number }[];
  targets: SetTarget[];
  /** CT with a class test: its exam date; else null (= the day it is printed). */
  examDay: string | null;
}

/**
 * Where an assembled set's questions go: the set's own শাখা — or, for a CT whose class test is group-anchored
 * (Quran / Arabic, D-#48), one target per member শাখা holding only that শাখা's group members (AC-U3).
 */
async function planOfSet(setId: string | Types.ObjectId, classTestId?: string | null): Promise<SetUsePlan | null> {
  const set = await AssessmentSet.findById(setId).select("setType sectionId classId status basketItems").lean();
  if (!set || set.status !== "assembled") return null;
  const items = (set.basketItems ?? []).map((b, i) => ({ qid: b.qid, itemNo: i + 1 }));
  if (items.length === 0) return null;
  const arts = await ContentArtifact.find({ _id: { $in: (set.basketItems ?? []).map((b) => b.artifactId) } }).select("subject").limit(1).lean();
  const subject = arts[0]?.subject ?? "";
  const kind = (set.setType === "CT" ? "CT" : set.setType === "AS" ? "AS" : "HW") as QuestionUseKind;

  type TestLite = { examDate?: Date; subjectGroupId?: Types.ObjectId | null };
  let test: TestLite | null = null;
  if (set.setType === "CT") {
    test = (await ClassTest.findOne(
      classTestId && Types.ObjectId.isValid(classTestId) ? { _id: oid(classTestId) } : { setId: set._id, status: { $ne: "CANCELLED" } },
    )
      .select("examDate subjectGroupId")
      .lean()) as TestLite | null;
  }
  const examDay = test?.examDate ? dhakaDayKey(new Date(test.examDate)) : null;

  const targets: SetTarget[] = [];
  if (test?.subjectGroupId) {
    const members = await SubjectGroupMembership.find({ groupId: test.subjectGroupId }).select("studentId").lean(); // bounded: one group
    const kids = await Student.find({ _id: { $in: members.map((m) => m.studentId) }, active: true }).select("sectionId").lean();
    const bySection = new Map<string, string[]>();
    for (const k of kids) bySection.set(String(k.sectionId), [...(bySection.get(String(k.sectionId)) ?? []), String(k._id)]);
    for (const [sid, ids] of bySection) {
      const f = await sectionFacts(sid);
      if (f) targets.push({ sectionId: oid(sid), studentIds: ids, ...f });
    }
  } else {
    const f = await sectionFacts(set.sectionId);
    if (f) targets.push({ sectionId: set.sectionId, studentIds: [], ...f });
  }
  return { kind, subject, qids: items, targets, examDay };
}

/**
 * AC-U3 / §3.2: write the ledger rows for an assembled set that is being given (printed). CT: the exam date when a
 * class test names the set, else the print day. One row per question per target শাখা. Idempotent.
 */
export async function writeSetUses(
  setId: string | Types.ObjectId,
  opts: { classTestId?: string | null; givenOn?: string } = {},
): Promise<number> {
  return recordUses(await usesOfSet(setId, opts));
}

/** The ledger rows an assembled set would write (used by the writer and the backfill's dry run). */
export async function usesOfSet(
  setId: string | Types.ObjectId,
  opts: { classTestId?: string | null; givenOn?: string } = {},
): Promise<UseInput[]> {
  const plan = await planOfSet(setId, opts.classTestId);
  if (!plan) return [];
  const givenOn = plan.examDay ?? opts.givenOn ?? todayKey();
  return plan.targets.flatMap((t) =>
    plan.qids.map((q) => ({
      qid: q.qid,
      kind: plan.kind,
      sourceType: "ASSESSMENT_SET" as const,
      sourceId: oid(setId),
      itemNo: q.itemNo,
      academicYearId: t.academicYearId,
      sectionId: t.sectionId,
      classToken: t.classToken,
      subject: plan.subject,
      studentIds: t.studentIds,
      givenOn,
    })),
  );
}

/** R19 re-check at finalise / print for a CT set (only while the release switch is on). Throws the refusal. */
export async function assertSetCtAllowed(setId: string | Types.ObjectId, classTestId?: string | null): Promise<void> {
  // The switch first (§3.6): while it is off no other ledger or set query runs.
  if (!(await isLoop2027On())) return;
  const set = await AssessmentSet.findById(setId).select("setType").lean();
  if (!set || set.setType !== "CT") return;
  const plan = await planOfSet(setId, classTestId);
  if (!plan) return;
  for (const t of plan.targets) {
    await assertCtAddable({ sectionId: t.sectionId, qids: plan.qids.map((q) => q.qid), classToken: t.classToken, subject: plan.subject, studentIds: t.studentIds.length > 0 ? t.studentIds : undefined });
  }
}

// ---------------------------------------------------------------------------
// Withdraw on cancel (AC-B11 echo for the set / class-test sources)
// ---------------------------------------------------------------------------

/**
 * A SET print request was cancelled: its set's rows are withdrawn — unless another live print request still
 * carries the same set (then the questions did go to the children).
 */
export async function withdrawForCancelledPrint(setId: string | Types.ObjectId, printRequestId: string | Types.ObjectId): Promise<void> {
  try {
    const { PrintRequest } = await import("../../printing/models/PrintRequest");
    const live = await PrintRequest.exists({ setId: oid(setId), _id: { $ne: oid(printRequestId) }, status: { $ne: "CANCELLED" } });
    if (!live) await withdrawUses("ASSESSMENT_SET", setId);
  } catch (err) {
    console.error("[question-use] withdraw on print cancel failed:", err);
  }
}

/**
 * AL-4 (the AL-3 gap): a retired class test was restored — its set's rows and its linked CT sheet's rows are written
 * again (the retire withdrew them). Idempotent; the rows come back with the exam date as the given day.
 */
export async function restoreForClassTest(testId: string | Types.ObjectId): Promise<void> {
  try {
    const test = await ClassTest.findById(testId).select("setId examDate").lean();
    if (!test) return;
    if (test.setId) await writeSetUses(test.setId, { classTestId: String(testId) });
    const { MasteryPaper } = await import("../../mastery/models/MasteryPaper");
    const paper = await MasteryPaper.findOne({ "links.classTestId": oid(testId) });
    if (paper) await recordUses(usesOfPaper(paper, "CT", { givenOn: dhakaDayKey(new Date(test.examDate)) }));
  } catch (err) {
    console.error("[question-use] re-write on class-test restore failed:", err);
  }
}

/** A class test was cancelled / retired: the questions of its set and of its linked CT sheet never sat. */
export async function withdrawForClassTest(testId: string | Types.ObjectId): Promise<void> {
  try {
    const test = await ClassTest.findById(testId).select("setId").lean();
    if (test?.setId) await withdrawUses("ASSESSMENT_SET", test.setId);
    const { MasteryPaper } = await import("../../mastery/models/MasteryPaper");
    const paper = await MasteryPaper.findOne({ "links.classTestId": oid(testId) }).select("_id").lean();
    if (paper) await withdrawUses("MASTERY_PAPER", paper._id);
  } catch (err) {
    console.error("[question-use] withdraw on class-test cancel failed:", err);
  }
}
