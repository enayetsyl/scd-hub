/**
 * IntegrityService - the homework-honesty flag (GH-3, docs/prd-guardian-help.md section 4, D-#1522).
 *
 * Rule (owner): per child x objective, HW% = sum(earned)/sum(available) over live (not superseded, not
 * excluded) MasteryEvidence rows with source HW or AS in the academic year, up to the date of the child's
 * latest class test on that objective; CT% = the same over source CT. Flag when HW% - CT% >= 20 points,
 * with at least one HW/AS row and one CT row. Cumulative: no other threshold.
 *
 * Office only. NOTHING here notifies a guardian, a teacher or anyone else - the Office investigates by
 * hand and records the outcome. This file must never import the notification service (tested).
 */
import { Types } from "mongoose";
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

/** HW% minus CT% (percentage points) at or above which a case is opened. */
export const INTEGRITY_GAP_POINTS = 20;
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
export function evaluateRows(rows: readonly EvidenceRowLike[]): Evaluation | null {
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
    flagged: hwRaw - ctRaw >= INTEGRITY_GAP_POINTS - 1e-9,
    hwItems: [...hw].sort(byDate).slice(-ITEMS_CAP).map(toItem),
    ctItems: [...ct].sort(byDate).slice(-ITEMS_CAP).map(toItem),
  };
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
  for (const [key, g] of groups) {
    out.checked += 1;
    try {
      const ev = evaluateRows(g);
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
        await IntegrityCase.create({
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
        });
        if (closed) out.reopened += 1;
        else out.opened += 1;
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

// -- the Office read ---------------------------------------------------------

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
  /** 2+ cases for this child in the same half of the academic year. */
  recurring: boolean;
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

export interface CaseDetail extends CaseRow {
  hwItems: CaseItemView[];
  ctItems: CaseItemView[];
  history: { at: string; hwPct: number; ctPct: number }[];
}

export interface CaseFilter {
  status?: string | null;
  classToken?: string | null;
  sectionId?: string | null;
  subject?: string | null;
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

async function halfOf(yearId: Types.ObjectId, at: Date, cache: Map<string, number>): Promise<0 | 1> {
  const k = String(yearId);
  let mid = cache.get(k);
  if (mid === undefined) {
    const y = await AcademicYear.findById(yearId).select("startDate endDate").lean();
    mid = y ? (y.startDate.getTime() + y.endDate.getTime()) / 2 : 0;
    cache.set(k, mid);
  }
  return at.getTime() < mid ? 0 : 1;
}

async function rowsOf(cases: readonly IIntegrityCase[]): Promise<CaseRow[]> {
  if (cases.length === 0) return [];
  const [students, sections, outcomes] = await Promise.all([
    Student.find({ _id: { $in: cases.map((c) => c.studentId) } }).select("name nameBn schoolId").lean(),
    Section.find({ _id: { $in: cases.map((c) => c.sectionId) } }).select("nameBn classId").lean(),
    MasteryOutcome.find({ code: { $in: [...new Set(cases.map((c) => c.loCode))] } }).select("code classToken subject labelBn").lean(),
  ]);
  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("nameBn").lean();
  const stMap = new Map(students.map((s) => [String(s._id), s]));
  const secMap = new Map(sections.map((s) => [String(s._id), s]));
  const clsMap = new Map(classes.map((c) => [String(c._id), c]));
  const loMap = new Map(outcomes.map((o) => [`${o.code}|${o.classToken}|${o.subject}`, o.labelBn]));
  // Recurring: how many cases each child has in the same half-year (OPEN or CLOSED).
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
      recurring: (counts.get(`${c.studentId}|${c.academicYearId}|${half}`) ?? 0) >= 2,
    });
  }
  return rows;
}

export const CASE_LIST_CAP = 500;

export async function listCases(f: CaseFilter): Promise<CaseRow[]> {
  const q: Record<string, unknown> = {};
  if (f.status === "OPEN" || f.status === "CLOSED") q.status = f.status;
  if (f.classToken) q.classToken = f.classToken;
  if (f.subject) q.subject = f.subject;
  if (f.sectionId) {
    if (!Types.ObjectId.isValid(f.sectionId)) return [];
    q.sectionId = oid(f.sectionId);
  }
  const cases = await IntegrityCase.find(q).sort({ status: -1, gap: -1 }).limit(CASE_LIST_CAP);
  return rowsOf(cases);
}

export async function caseDetail(id: string): Promise<CaseDetail> {
  if (!Types.ObjectId.isValid(id)) throw new IntegrityError("কেসটি পাওয়া যায়নি।");
  const c = await IntegrityCase.findById(id);
  if (!c) throw new IntegrityError("কেসটি পাওয়া যায়নি।");
  const [row] = await rowsOf([c]);
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
  return {
    ...row,
    hwItems: c.hwItems.map(view),
    ctItems: c.ctItems.map(view),
    history: c.history.map((h) => ({ at: iso(h.at), hwPct: h.hwPct, ctPct: h.ctPct })),
  };
}

// -- the Office write --------------------------------------------------------

export async function recordOutcome(
  id: string,
  outcome: string,
  note: string | null | undefined,
  actor: { userId: string; role: string },
): Promise<CaseRow> {
  if (!(INTEGRITY_OUTCOMES as readonly string[]).includes(outcome)) throw new IntegrityError("ফলাফল বেছে নিন।");
  if (!Types.ObjectId.isValid(id)) throw new IntegrityError("কেসটি পাওয়া যায়নি।");
  const c = await IntegrityCase.findById(id);
  if (!c) throw new IntegrityError("কেসটি পাওয়া যায়নি।");
  if (c.status === "CLOSED") throw new IntegrityError("এই কেসের ফলাফল আগেই লেখা হয়েছে।");
  c.status = "CLOSED";
  c.outcome = outcome as IntegrityOutcome;
  c.note = (note ?? "").trim().slice(0, 1000) || undefined;
  c.closedAt = new Date();
  c.closedBy = Types.ObjectId.isValid(actor.userId) ? oid(actor.userId) : undefined;
  c.updatedAt = c.closedAt;
  await c.save(); // closing changes no mark - the evidence is untouched
  void writeAudit({
    eventKind: "HOMEWORK_INTEGRITY_RECORDED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "IntegrityCase",
    targetId: c._id,
    meta: { studentId: String(c.studentId), loCode: c.loCode, outcome, gap: c.gap },
  });
  const [row] = await rowsOf([c]);
  return row;
}
