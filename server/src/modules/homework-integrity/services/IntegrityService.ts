/**
 * IntegrityService - the homework-honesty flag (GH-3, docs/prd-guardian-help.md section 4, D-#1522).
 *
 * Rule (owner): per child x objective, HW% = sum(earned)/sum(available) over live (not superseded, not
 * excluded) MasteryEvidence rows with source HW or AS in the academic year, up to the date of the child's
 * latest class test on that objective; CT% = the same over source CT. Flag when HW% - CT% >= 20 points,
 * with at least one HW/AS row and one CT row. Cumulative: no other threshold.
 *
 * AL-12 (docs/prd-academic-loop-2027.md section 3.4 + journey H, D-#1676) extends it WITHOUT changing the rule (R18):
 *  - the gap and the recurring count are policy keys (`integrityGapPoints`, `integrityRecurringCases`);
 *  - reach: the Office / Principal see every case (`homework_integrity:view_all`); the class teacher of the child's
 *    section and the subject teacher there (the investigators) see and record their own cases and add notes;
 *  - a NEW case sends one notice to each class teacher of the section + each Principal (never a guardian), deduped on
 *    case + recipient; a recompute of the same case sends nothing;
 *  - after the outcome the term tag is stored on the case (`tagActive` / `tagUntil`); the tag surfaces read the cases
 *    (IntegrityTagService), they never copy them. Closing a case never changes a mark.
 * Nothing here ever reaches a guardian: the guardian note is built from the tag by IntegrityTagService, with no case,
 * no number and no objective. Runs regardless of the 2027 release switch (PRD section 3.6).
 */
import { Types } from "mongoose";
import { ROUTINE_SUBJECT_LABELS_BN, type MasteryPolicyValues } from "@scd/shared";
import { resolvePolicy } from "../../mastery/catalogue";
import { MasteryPolicy } from "../../mastery/models/MasteryPolicy";
import { resolveSubjectTeacher } from "../../trackers/subjectTeacher";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { principalUserIds } from "../../staff-mistakes/services/principalPrivacy";
import { User } from "../../foundation/models/User";
import { termEndOf, termOfDate } from "../../../lib/academicTerm";
import { MasteryEvidence } from "../../mastery/models/MasteryEvidence";
import { MasteryOutcome } from "../../mastery/models/MasteryOutcome";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { HintView } from "../../guardian-help/models/HintView";
import { writeAudit } from "../../platform/services/AuditService";
import { personName } from "../../../lib/personName";
import { IntegrityCase, INTEGRITY_OUTCOMES, type IIntegrityCase, type IntegrityItem, type IntegrityOutcome } from "../models/IntegrityCase";

export class IntegrityError extends Error {}

/** HW% minus CT% (percentage points) at or above which a case is opened - the DEFAULT of `integrityGapPoints`. */
export const INTEGRITY_GAP_POINTS = 20;

export interface IntegrityPolicy {
  gapPoints: number;
  recurringCases: number;
}

/** The two school-wide policy keys (PRD section 3.5), defaults when the SCHOOL row does not name them. */
export async function integrityPolicy(): Promise<IntegrityPolicy> {
  const school = await MasteryPolicy.findOne({ scopeKey: "SCHOOL" }).select("values").lean();
  const p = resolvePolicy(school?.values as Partial<MasteryPolicyValues> | undefined, null);
  return { gapPoints: p.integrityGapPoints, recurringCases: p.integrityRecurringCases };
}
const HW_SOURCES = ["HW", "AS"] as const;
const SOURCES = ["HW", "AS", "CT"] as const;
const ITEMS_CAP = 200;
const oid = (s: string) => new Types.ObjectId(s);
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface EvidenceRowLike {
  source: string;
  paperId: Types.ObjectId;
  qid?: string;
  itemNo: number | null;
  earned: number;
  available: number;
  at: Date;
  createdAt?: Date;
}

export interface Evaluation {
  /** Latest createdAt among the rows the numbers actually use (CT rows, HW/AS rows up to the cutoff). */
  usedCreatedAt: number;
  hwPct: number;
  ctPct: number;
  gap: number;
  flagged: boolean;
  hwItems: IntegrityItem[];
  ctItems: IntegrityItem[];
}

const toItem = (r: EvidenceRowLike): IntegrityItem => ({
  paperId: r.paperId, qid: r.qid, itemNo: r.itemNo, earned: r.earned, available: r.available, date: r.at,
});

/** The pure rule. Returns null when either side has no scored row (nothing to compare). */
export function evaluateRows(rows: readonly EvidenceRowLike[], gapPoints: number = INTEGRITY_GAP_POINTS): Evaluation | null {
  const live = rows.filter((r) => r.available > 0);
  const ct = live.filter((r) => r.source === "CT");
  if (ct.length === 0) return null;
  const cutoff = Math.max(...ct.map((r) => r.at.getTime()));
  const hw = live.filter((r) => (HW_SOURCES as readonly string[]).includes(r.source) && r.at.getTime() <= cutoff);
  if (hw.length === 0) return null;
  const pct = (xs: readonly EvidenceRowLike[]) => (100 * xs.reduce((a, r) => a + r.earned, 0)) / xs.reduce((a, r) => a + r.available, 0);
  const hwRaw = pct(hw);
  const ctRaw = pct(ct);
  const byDate = (a: EvidenceRowLike, b: EvidenceRowLike) => a.at.getTime() - b.at.getTime();
  const usedCreatedAt = Math.max(0, ...[...hw, ...ct].map((r) => r.createdAt?.getTime() ?? 0));
  return {
    usedCreatedAt,
    hwPct: r1(hwRaw),
    ctPct: r1(ctRaw),
    gap: r1(hwRaw - ctRaw),
    flagged: hwRaw - ctRaw >= gapPoints - 1e-9,
    hwItems: [...hw].sort(byDate).slice(-ITEMS_CAP).map(toItem),
    ctItems: [...ct].sort(byDate).slice(-ITEMS_CAP).map(toItem),
  };
}

// -- AL-12: investigators + the new-case notice --------------------------------

/** The class teacher of the section and the routine's subject teacher there, de-duplicated. */
export async function investigatorsOf(sectionId: Types.ObjectId, subject: string, on: Date): Promise<Types.ObjectId[]> {
  const [sec, subjectTeacher] = await Promise.all([
    Section.findById(sectionId).select("classTeacherId").lean(),
    resolveSubjectTeacher(String(sectionId), subject, on).catch(() => null),
  ]);
  const ids = [sec?.classTeacherId, subjectTeacher].filter((x): x is Types.ObjectId | string => !!x).map((x) => String(x));
  return [...new Set(ids)].map(oid);
}

export const subjectLabelBn = (code: string): string => (ROUTINE_SUBJECT_LABELS_BN as Record<string, string>)[code] ?? code;

/** AC-H2: one notice to each class teacher of the child's section and one to each Principal; deduped on case + recipient. */
async function noticeNewCase(c: IIntegrityCase): Promise<void> {
  try {
    const [sec, st, principals] = await Promise.all([
      Section.findById(c.sectionId).select("classTeacherId nameBn").lean(),
      Student.findById(c.studentId).select("name nameBn").lean(),
      principalUserIds(),
    ]);
    const recipients = [...new Set([sec?.classTeacherId ? String(sec.classTeacherId) : "", ...principals].filter(Boolean))];
    if (recipients.length === 0) return;
    const { emitIntegrityCase } = await import("../../notifications/services/emitters");
    await emitIntegrityCase({
      recipientUserIds: recipients,
      caseId: c._id,
      studentId: c.studentId,
      sectionId: c.sectionId,
      subject: c.subject,
      titleBn: "হোমওয়ার্ক যাচাইয়ের নতুন কেস",
      messageBn: `${personName(st, "শিক্ষার্থী")} — ${subjectLabelBn(c.subject)}: বাড়ির কাজের ফল ক্লাস টেস্টের চেয়ে অনেক বেশি। কেসটি দেখে ফলাফল লিখুন।`,
    });
  } catch (err) {
    console.error("[homework-integrity] new-case notice failed (the case stays):", err);
  }
}

/** Open cases from before AL-12 have no investigators: fill them in (nightly sweep). */
export async function backfillInvestigators(limit = 500): Promise<void> {
  const now = new Date();
  // Oldest first (the _id is creation order). A case that resolves to nobody is stamped and not looked at again - the live
  // row rule (class teacher / routine subject teacher) still lets those people in.
  const open = await IntegrityCase.find({
    status: "OPEN",
    investigatorsCheckedAt: { $exists: false },
    $or: [{ investigatorIds: { $exists: false } }, { investigatorIds: { $size: 0 } }],
  })
    .sort({ _id: 1 })
    .limit(limit);
  for (const c of open) {
    try {
      const ids = await investigatorsOf(c.sectionId, c.subject, now);
      if (ids.length === 0) {
        c.investigatorsCheckedAt = now;
        await c.save();
        continue;
      }
      c.investigatorIds = ids;
      await c.save();
    } catch (err) {
      console.error("[homework-integrity] investigator backfill failed (next run retries):", err);
    }
  }
}

interface Pair {
  studentId: string;
  loCode: string;
}

export interface RecomputeSummary {
  checked: number;
  opened: number;
  updated: number;
  reopened: number;
}

const liveFilter = (extra: Record<string, unknown>) => ({
  source: { $in: [...SOURCES] },
  supersededAt: null,
  excludedAt: null,
  routed: false,
  available: { $gt: 0 },
  ...extra,
});

const sameItems = (a: readonly IntegrityItem[], b: readonly IntegrityItem[]): boolean =>
  a.length === b.length &&
  a.every((x, i) => String(x.paperId) === String(b[i].paperId) && x.itemNo === b[i].itemNo && x.qid === b[i].qid && x.earned === b[i].earned && x.available === b[i].available);

/** Evaluate and open / update cases for the given pairs in one academic year. Idempotent. */
export async function recomputeForStudentsLos(pairs: readonly Pair[], academicYearId: Types.ObjectId): Promise<RecomputeSummary> {
  const out: RecomputeSummary = { checked: 0, opened: 0, updated: 0, reopened: 0 };
  const unique = [...new Map(pairs.map((p) => [`${p.studentId}|${p.loCode}`, p])).values()];
  if (unique.length === 0) return out;
  const want = new Set(unique.map((p) => `${p.studentId}|${p.loCode}`));
  const studentIds = [...new Set(unique.map((p) => p.studentId))].map(oid);
  const loCodes = [...new Set(unique.map((p) => p.loCode))];
  const [rows, openCases] = await Promise.all([
    MasteryEvidence.find(liveFilter({ academicYearId, studentId: { $in: studentIds }, loCode: { $in: loCodes } }))
      .select("studentId sectionId classToken subject loCode source paperId qid itemNo earned available at createdAt")
      .lean(),
    IntegrityCase.find({ studentId: { $in: studentIds }, loCode: { $in: loCodes }, academicYearId, status: "OPEN" }),
  ]);
  const openBy = new Map(openCases.map((c) => [`${c.studentId}|${c.loCode}`, c]));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.studentId}|${r.loCode}`;
    if (!want.has(k)) continue;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const now = new Date();
  const { gapPoints } = await integrityPolicy();
  for (const [key, g] of groups) {
    out.checked += 1;
    try {
      const ev = evaluateRows(g, gapPoints);
      if (!ev) continue;
      const [studentId, loCode] = key.split("|");
      const open = openBy.get(key);
      if (open) {
        // The numbers move with the evidence; the case stays for the Office to close. A no-op writes nothing.
        if (open.hwPct === ev.hwPct && open.ctPct === ev.ctPct && sameItems(open.hwItems, ev.hwItems) && sameItems(open.ctItems, ev.ctItems)) continue;
        open.hwPct = ev.hwPct;
        open.ctPct = ev.ctPct;
        open.gap = ev.gap;
        open.hwItems = ev.hwItems;
        open.ctItems = ev.ctItems;
        open.updatedAt = now;
        open.history.push({ at: now, hwPct: ev.hwPct, ctPct: ev.ctPct });
        await open.save();
        out.updated += 1;
        continue;
      }
      if (!ev.flagged) continue; // nothing open and nothing to open
      const closed = await IntegrityCase.findOne({ studentId: oid(studentId), loCode, academicYearId, status: "CLOSED" }).sort({ closedAt: -1 }).lean();
      if (closed?.closedAt) {
        // Reopen only on evidence the numbers actually use, newer than the closing, that moved the numbers.
        if (ev.usedCreatedAt <= closed.closedAt.getTime()) continue;
        if (closed.hwPct === ev.hwPct && closed.ctPct === ev.ctPct) continue;
      }
      const last = [...g].sort((x, y) => y.at.getTime() - x.at.getTime())[0];
      try {
        const created = await IntegrityCase.create({
          studentId: oid(studentId),
          sectionId: last.sectionId,
          academicYearId,
          classToken: last.classToken,
          subject: last.subject,
          loCode,
          hwPct: ev.hwPct,
          ctPct: ev.ctPct,
          gap: ev.gap,
          hwItems: ev.hwItems,
          ctItems: ev.ctItems,
          status: "OPEN",
          openedAt: now,
          updatedAt: now,
          history: [{ at: now, hwPct: ev.hwPct, ctPct: ev.ctPct }],
          investigatorIds: await investigatorsOf(last.sectionId, last.subject, now),
        });
        if (closed) out.reopened += 1;
        else out.opened += 1;
        await noticeNewCase(created); // best effort; never fails the recompute
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err; // a parallel recompute opened it first
      }
    } catch (err) {
      console.error(`[homework-integrity] pair ${key} failed (next run retries):`, err);
    }
  }
  return out;
}

/** After a class-test paper's evidence is written: its students x objectives. */
export async function recomputeForPaper(paperId: Types.ObjectId, academicYearId: Types.ObjectId): Promise<RecomputeSummary> {
  const rows = await MasteryEvidence.find({ paperId, supersededAt: null, routed: false }).select("studentId loCode").lean();
  return recomputeForStudentsLos(rows.map((r) => ({ studentId: String(r.studentId), loCode: r.loCode })), academicYearId);
}

let sweeping: Promise<RecomputeSummary> | null = null;

/** The nightly / manual sweep: every child x objective of the year that has both sides. One at a time. */
export function sweepYear(academicYearId?: Types.ObjectId): Promise<RecomputeSummary> {
  if (sweeping) return sweeping;
  const run = doSweep(academicYearId).finally(() => {
    sweeping = null;
  });
  sweeping = run;
  return run;
}

async function doSweep(academicYearId?: Types.ObjectId): Promise<RecomputeSummary> {
  const yearId = academicYearId ?? (await AcademicYear.findOne({ current: true }).select("_id").lean())?._id;
  const total: RecomputeSummary = { checked: 0, opened: 0, updated: 0, reopened: 0 };
  if (!yearId) return total;
  await backfillInvestigators().catch((err) => console.error("[homework-integrity] backfill failed:", err));
  const pairs = await MasteryEvidence.aggregate<{ _id: { s: Types.ObjectId; l: string }; src: string[] }>([
    { $match: liveFilter({ academicYearId: yearId }) },
    { $group: { _id: { s: "$studentId", l: "$loCode" }, src: { $addToSet: "$source" } } },
    { $match: { src: "CT" } },
  ]);
  // Sorted by student so a chunk's student set x objective set stays tight.
  const both = pairs
    .filter((p) => p.src.some((s) => s === "HW" || s === "AS"))
    .map((p) => ({ studentId: String(p._id.s), loCode: p._id.l }))
    .sort((a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));
  for (let i = 0; i < both.length; i += 200) {
    try {
      const r = await recomputeForStudentsLos(both.slice(i, i + 200), yearId);
      total.checked += r.checked;
      total.opened += r.opened;
      total.updated += r.updated;
      total.reopened += r.reopened;
    } catch (err) {
      console.error("[homework-integrity] sweep chunk failed (next run retries):", err);
    }
  }
  return total;
}

// -- the read side (Office, Principal and the investigating teachers) ------------

export interface CaseRow {
  id: string;
  studentId: string;
  studentName: string;
  studentSchoolId: string;
  classToken: string;
  classNameBn: string;
  sectionId: string;
  sectionNameBn: string;
  subject: string;
  loCode: string;
  loLabelBn: string;
  hwPct: number;
  ctPct: number;
  gap: number;
  status: string;
  outcome: string | null;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
  /** `integrityRecurringCases`+ cases for this child in the same term (OPEN or CLOSED). */
  recurring: boolean;
  /** AL-12: the term tag is on right now (outcome GUARDIAN_DID / UNCLEAR, and the term has not ended). */
  tagActive: boolean;
  tagUntil: string | null;
}

export interface CaseItemView {
  paperId: string;
  qid: string | null;
  itemNo: number | null;
  earned: number;
  available: number;
  date: string;
  /** Highest hint step (0..3) any guardian of the child opened on this item (GH-1). */
  hintStep: number;
}

export interface CaseNoteView {
  byName: string;
  at: string;
  text: string;
  mine: boolean;
}

export interface CaseDetail extends CaseRow {
  hwItems: CaseItemView[];
  ctItems: CaseItemView[];
  history: { at: string; hwPct: number; ctPct: number }[];
  /** AL-12: who investigates (class teacher / subject teacher) and what they wrote. */
  investigatorNames: string[];
  notes: CaseNoteView[];
}

export interface CaseFilter {
  status?: string | null;
  classToken?: string | null;
  sectionId?: string | null;
  subject?: string | null;
}

/** Who is asking. `all` = `homework_integrity:view_all` (Office, Principal): every case. Otherwise the row rule. */
export interface IntegrityViewer {
  userId: string;
  all: boolean;
}

const iso = (d: Date) => d.toISOString();

/** The highest hint step opened per qid for one child, across all of the child's guardians. */
export async function hintStepsFor(studentId: string, qids: readonly string[]): Promise<Map<string, number>> {
  const ids = [...new Set(qids.filter(Boolean))];
  const out = new Map<string, number>();
  if (ids.length === 0 || !Types.ObjectId.isValid(studentId)) return out;
  const rows = await HintView.aggregate<{ _id: string; max: number }>([
    { $match: { studentId: oid(studentId), qid: { $in: ids } } },
    { $group: { _id: "$qid", max: { $max: "$step" } } },
  ]);
  for (const r of rows) out.set(r._id, r.max);
  return out;
}

/** The term (0 / 1) a date falls in - the shared GH-3 / D-#1529 definition (`termOfDate`). */
async function halfOf(yearId: Types.ObjectId, at: Date, cache: Map<string, number>): Promise<0 | 1> {
  return (await termOfDate(yearId, at, cache, 2)) === 1 ? 0 : 1;
}

/** Is the tag on right now? (R32: the term of the outcome, never beyond it.) */
export const tagIsOn = (c: { tagActive?: boolean | null; tagUntil?: Date | null }, now: Date): boolean =>
  c.tagActive === true && !!c.tagUntil && c.tagUntil.getTime() > now.getTime();

/** Cases -> rows (names, labels, recurring per the policy count, the tag). Exported for the tag service. */
export async function caseRows(cases: readonly IIntegrityCase[], now: Date = new Date()): Promise<CaseRow[]> {
  if (cases.length === 0) return [];
  const [students, sections, outcomes, policy] = await Promise.all([
    Student.find({ _id: { $in: cases.map((c) => c.studentId) } }).select("name nameBn schoolId").lean(),
    Section.find({ _id: { $in: cases.map((c) => c.sectionId) } }).select("nameBn classId").lean(),
    MasteryOutcome.find({ code: { $in: [...new Set(cases.map((c) => c.loCode))] } }).select("code classToken subject labelBn").lean(),
    integrityPolicy(),
  ]);
  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("nameBn").lean();
  const stMap = new Map(students.map((s) => [String(s._id), s]));
  const secMap = new Map(sections.map((s) => [String(s._id), s]));
  const clsMap = new Map(classes.map((c) => [String(c._id), c]));
  const loMap = new Map(outcomes.map((o) => [`${o.code}|${o.classToken}|${o.subject}`, o.labelBn]));
  // Recurring: how many cases each child has in the same term (OPEN or CLOSED).
  const all = await IntegrityCase.find({ studentId: { $in: cases.map((c) => c.studentId) } }).select("studentId academicYearId openedAt").lean();
  const cache = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const c of all) {
    const k = `${c.studentId}|${c.academicYearId}|${await halfOf(c.academicYearId, c.openedAt, cache)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const rows: CaseRow[] = [];
  for (const c of cases) {
    const st = stMap.get(String(c.studentId));
    const sec = secMap.get(String(c.sectionId));
    const cls = sec ? clsMap.get(String(sec.classId)) : undefined;
    const half = await halfOf(c.academicYearId, c.openedAt, cache);
    rows.push({
      id: String(c._id),
      studentId: String(c.studentId),
      studentName: personName(st, "-"),
      studentSchoolId: st?.schoolId ?? "",
      classToken: c.classToken,
      classNameBn: cls?.nameBn ?? "",
      sectionId: String(c.sectionId),
      sectionNameBn: sec?.nameBn ?? "",
      subject: c.subject,
      loCode: c.loCode,
      loLabelBn: loMap.get(`${c.loCode}|${c.classToken}|${c.subject}`) ?? c.loCode,
      hwPct: c.hwPct,
      ctPct: c.ctPct,
      gap: c.gap,
      status: c.status,
      outcome: c.outcome ?? null,
      note: c.note ?? null,
      openedAt: iso(c.openedAt),
      closedAt: c.closedAt ? iso(c.closedAt) : null,
      recurring: (counts.get(`${c.studentId}|${c.academicYearId}|${half}`) ?? 0) >= policy.recurringCases,
      tagActive: tagIsOn(c, now),
      tagUntil: c.tagUntil ? iso(c.tagUntil) : null,
    });
  }
  return rows;
}

export const CASE_LIST_CAP = 500;

/** AC-H3: may this viewer see / write this case? Everyone with view_all; else an investigator named on the case, the
 *  class teacher of its section, or the routine's teacher of its subject there. */
export async function mayAccessCase(c: IIntegrityCase, viewer: IntegrityViewer, now: Date = new Date()): Promise<boolean> {
  if (viewer.all) return true;
  if ((c.investigatorIds ?? []).some((i) => String(i) === viewer.userId)) return true;
  const sec = await Section.findById(c.sectionId).select("classTeacherId").lean();
  if (sec?.classTeacherId && String(sec.classTeacherId) === viewer.userId) return true;
  const teacher = await resolveSubjectTeacher(String(c.sectionId), c.subject, now).catch(() => null);
  return !!teacher && String(teacher) === viewer.userId;
}

export async function listCases(f: CaseFilter, viewer?: IntegrityViewer): Promise<CaseRow[]> {
  const q: Record<string, unknown> = {};
  if (f.status === "OPEN" || f.status === "CLOSED") q.status = f.status;
  if (f.classToken) q.classToken = f.classToken;
  if (f.subject) q.subject = f.subject;
  if (f.sectionId) {
    if (!Types.ObjectId.isValid(f.sectionId)) return [];
    q.sectionId = oid(f.sectionId);
  }
  if (viewer && !viewer.all) {
    // A teacher: the cases that name them, or that sit in a section they are class teacher of.
    if (!Types.ObjectId.isValid(viewer.userId)) return [];
    const me = oid(viewer.userId);
    const mine = await Section.find({ classTeacherId: me }).select("_id").lean();
    // The routine's teacher of a section x subject: the candidates are the sections they have a period in; mayAccessCase decides.
    const slots = await RoutineSlot.find({ teacherId: me, groupType: "section", active: true }).select("groupId").lean();
    const routineSections = [...new Set(slots.map((s) => String(s.groupId)))].map(oid);
    q.$or = [{ investigatorIds: me }, { sectionId: { $in: [...mine.map((s) => s._id), ...routineSections] } }];
    const found = await IntegrityCase.find(q).sort({ status: -1, gap: -1 }).limit(CASE_LIST_CAP);
    const now = new Date();
    const kept: IIntegrityCase[] = [];
    for (const c of found) if (await mayAccessCase(c, viewer, now)) kept.push(c);
    return caseRows(kept);
  }
  const cases = await IntegrityCase.find(q).sort({ status: -1, gap: -1 }).limit(CASE_LIST_CAP);
  return caseRows(cases);
}

async function loadCase(id: string, viewer: IntegrityViewer | undefined): Promise<IIntegrityCase> {
  if (!Types.ObjectId.isValid(id)) throw new IntegrityError("কেসটি পাওয়া যায়নি।");
  const c = await IntegrityCase.findById(id);
  if (!c) throw new IntegrityError("কেসটি পাওয়া যায়নি।");
  // A case that is not theirs reads exactly like one that does not exist (AC-H3: another শাখা is refused).
  if (viewer && !(await mayAccessCase(c, viewer))) throw new IntegrityError("কেসটি পাওয়া যায়নি।");
  return c;
}

export async function caseDetail(id: string, viewer?: IntegrityViewer): Promise<CaseDetail> {
  const c = await loadCase(id, viewer);
  const [row] = await caseRows([c]);
  const hints = await hintStepsFor(String(c.studentId), [...c.hwItems, ...c.ctItems].map((i) => i.qid ?? ""));
  const view = (i: IntegrityItem): CaseItemView => ({
    paperId: String(i.paperId),
    qid: i.qid ?? null,
    itemNo: i.itemNo,
    earned: i.earned,
    available: i.available,
    date: iso(i.date),
    hintStep: i.qid ? (hints.get(i.qid) ?? 0) : 0,
  });
  const noteIds = (c.notes ?? []).map((n) => n.by);
  const users = await User.find({ _id: { $in: [...(c.investigatorIds ?? []), ...noteIds] } }).select("name").lean();
  const nameOf = new Map(users.map((u) => [String(u._id), u.name as string]));
  return {
    ...row,
    hwItems: c.hwItems.map(view),
    ctItems: c.ctItems.map(view),
    history: c.history.map((h) => ({ at: iso(h.at), hwPct: h.hwPct, ctPct: h.ctPct })),
    investigatorNames: (c.investigatorIds ?? []).map((i) => nameOf.get(String(i)) ?? "-"),
    notes: (c.notes ?? []).map((n) => ({
      byName: nameOf.get(String(n.by)) ?? "-",
      at: iso(n.at),
      text: n.text,
      mine: !!viewer && String(n.by) === viewer.userId,
    })),
  };
}

// -- the write side ------------------------------------------------------------

export interface IntegrityActor extends IntegrityViewer {
  role: string;
}

/** The tag for the rest of the term (R32): GUARDIAN_DID and UNCLEAR tag; CHILD_DID does not. */
export const OUTCOMES_THAT_TAG: readonly IntegrityOutcome[] = ["GUARDIAN_DID", "UNCLEAR"];
const FALLBACK_TERM_DAYS = 183;

export async function recordOutcome(id: string, outcome: string, note: string | null | undefined, actor: IntegrityActor, at: Date = new Date()): Promise<CaseRow> {
  if (!(INTEGRITY_OUTCOMES as readonly string[]).includes(outcome)) throw new IntegrityError("ফলাফল বেছে নিন।");
  const c = await loadCase(id, actor);
  if (c.status === "CLOSED") throw new IntegrityError("এই কেসের ফলাফল আগেই লেখা হয়েছে।");
  c.status = "CLOSED";
  c.outcome = outcome as IntegrityOutcome;
  c.note = (note ?? "").trim().slice(0, 1000) || undefined;
  c.closedAt = at;
  c.closedBy = Types.ObjectId.isValid(actor.userId) ? oid(actor.userId) : undefined;
  c.updatedAt = c.closedAt;
  if (OUTCOMES_THAT_TAG.includes(c.outcome)) {
    // The tag lasts to the end of the term in which the outcome was recorded.
    c.tagActive = true;
    // The term in which the outcome is RECORDED - the CURRENT academic year at that moment, not the case's own year (a 2026 case
    // closed in January 2027 is tagged to the end of the 2027 first term). No current year: the case's year, then a fixed span.
    const current = await AcademicYear.findOne({ current: true }).select("_id").lean();
    c.tagUntil =
      (current ? await termEndOf(current._id, c.closedAt) : null) ??
      (await termEndOf(c.academicYearId, c.closedAt)) ??
      new Date(c.closedAt.getTime() + FALLBACK_TERM_DAYS * 86_400_000);
  } else {
    c.tagActive = false;
    c.tagUntil = undefined;
  }
  await c.save(); // closing changes no mark - the evidence is untouched
  void writeAudit({
    eventKind: "HOMEWORK_INTEGRITY_RECORDED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "IntegrityCase",
    targetId: c._id,
    meta: { studentId: String(c.studentId), loCode: c.loCode, outcome, gap: c.gap },
  });
  const [row] = await caseRows([c]);
  return row;
}

/** AL-12: any investigator (or the Office / Principal) adds a note; open or closed, never edited or removed. */
export async function addCaseNote(id: string, text: string, actor: IntegrityActor): Promise<CaseDetail> {
  const clean = (text ?? "").trim().slice(0, 1000);
  if (!clean) throw new IntegrityError("নোটে কিছু লিখুন।");
  const c = await loadCase(id, actor);
  if (!Types.ObjectId.isValid(actor.userId)) throw new IntegrityError("লগইন প্রয়োজন।");
  const at = new Date();
  c.notes = [...(c.notes ?? []), { by: oid(actor.userId), at, text: clean }];
  c.updatedAt = at;
  await c.save();
  void writeAudit({
    eventKind: "HOMEWORK_INTEGRITY_NOTE",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "IntegrityCase",
    targetId: c._id,
    meta: { studentId: String(c.studentId), loCode: c.loCode },
  });
  return caseDetail(id, actor);
}

// -- the Principal's settings (homework_integrity:settings) ---------------------

export async function saveIntegrityPolicy(input: { gapPoints: number; recurringCases: number }, actor: { userId: string; role: string }): Promise<IntegrityPolicy> {
  const gap = input.gapPoints;
  const rec = input.recurringCases;
  if (!(Number.isFinite(gap) && gap > 0 && gap <= 100)) throw new IntegrityError("পার্থক্যের সীমা ০-এর বেশি ও ১০০-এর মধ্যে দিন।");
  if (!(Number.isInteger(rec) && rec >= 2 && rec <= 20)) throw new IntegrityError("বারবার-এর কেস সংখ্যা ২ থেকে ২০-এর মধ্যে পূর্ণসংখ্যা দিন।");
  // Only these two keys move; every other stored key on the SCHOOL row (the release switch above all) is untouched.
  await MasteryPolicy.updateOne(
    { scopeKey: "SCHOOL" },
    { $set: { "values.integrityGapPoints": gap, "values.integrityRecurringCases": rec, ...(Types.ObjectId.isValid(actor.userId) ? { updatedBy: oid(actor.userId) } : {}) } },
    { upsert: true },
  );
  void writeAudit({
    eventKind: "HOMEWORK_INTEGRITY_SETTINGS",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "MasteryPolicy",
    meta: { integrityGapPoints: gap, integrityRecurringCases: rec },
  });
  return integrityPolicy();
}
