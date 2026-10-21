/**
 * MasteryDiagnosisService — M-3 of the mastery tracker (docs/prd-mastery.md §5.3 / §6.3 / §6.4,
 * D-#779 / #782 / #808).
 *
 *  - studentDiagnosis   — one student × subject: every LOCKED outcome with its state (I1)
 *  - outcomeTrail       — one student × outcome: state path, every evidence row, bank coverage (I2)
 *  - sectionHeatmap     — one section × subject: outcomes taught × students, section %, trigger (I3)
 *  - qualityPapersPage / paperQualityDetail — the work-quality report (I4)
 *  - excludeItem / revokeExclusion — the teacher's "do not use in diagnosis" (D-#782)
 *
 * States are computed on read from the live evidence by the pure engine (../diagnosis.ts). Row
 * rule as in M-2 (D-#807): the routine holder of the section × subject, or `mastery:edit_all`.
 */
import { Types } from "mongoose";
import { parseMasteryLoCode } from "@scd/shared";
import type { MasteryClassToken, MasteryState, MasterySubject } from "@scd/shared";
import { MasteryEvidence } from "../models/MasteryEvidence";
import { MasteryOutcome } from "../models/MasteryOutcome";
import { MasteryPaper, type IMasteryPaper } from "../models/MasteryPaper";
import { MasteryTag } from "../models/MasteryTag";
import { MasteryExclusion, type IMasteryExclusion, type MasteryExclusionScope } from "../models/MasteryExclusion";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { writeAudit } from "../../platform/services/AuditService";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { personName } from "../../../lib/personName";
import { getPolicy } from "./MasteryCatalogueService";
import {
  MasteryWorkError,
  assertMayWork,
  loadPaperFor,
  paperView,
  rosterOf,
  sectionContext,
  type Auth,
  type PaperView,
} from "./MasteryWorkService";
import {
  computeOutcomeState,
  paperQuality,
  sectionOutcomeSummary,
  QUALITY_RANK_WEEKS,
  type DiagnosisPolicy,
  type EvidenceLike,
  type ItemQuality,
  type OutcomeState,
} from "../diagnosis";
import { loCodeMongoFilter } from "../bank";
import { clearExclusion, reapplyExclusions } from "../exclusions";

const oid = (s: string) => new Types.ObjectId(s);
const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

type LiveRow = EvidenceLike & { studentId: string };

/** The live rows (not superseded, not excluded) of one section × subject. */
async function liveSectionRows(sectionId: Types.ObjectId, subject: MasterySubject, loCode?: string): Promise<LiveRow[]> {
  const rows = await MasteryEvidence.find({
    sectionId, subject, supersededAt: null, excludedAt: null, ...(loCode ? { loCode } : {}),
  })
    .select("studentId paperId itemNo qid loCode earned available rubricStep rework signal routed at week")
    .lean(); // bounded: one section × subject's evidence for the year
  return rows.map((r) => ({
    studentId: String(r.studentId),
    paperId: String(r.paperId),
    itemNo: r.itemNo ?? null,
    qid: r.qid ?? null,
    loCode: r.loCode,
    earned: r.earned,
    available: r.available,
    rubricStep: r.rubricStep ?? null,
    rework: Boolean(r.rework),
    signal: r.signal,
    routed: Boolean(r.routed),
    at: new Date(r.at),
    week: r.week,
  }));
}

async function diagnosisPolicy(classToken: MasteryClassToken, subject: MasterySubject): Promise<DiagnosisPolicy> {
  return (await getPolicy(classToken, subject)).resolved;
}

interface SectionStates {
  /** loCode → studentId → state */
  states: Map<string, Map<string, OutcomeState>>;
  /** loCode → mean earned% of the students with evidence */
  means: Map<string, number>;
  /** loCode → distinct papers with evidence */
  assessments: Map<string, number>;
}

/** Every student × outcome state of one section × subject, plus the section means. */
function computeSection(rows: LiveRow[], policy: DiagnosisPolicy, now: Date): SectionStates {
  const byLo = new Map<string, Map<string, LiveRow[]>>();
  for (const r of rows) {
    const m = byLo.get(r.loCode) ?? new Map<string, LiveRow[]>();
    m.set(r.studentId, [...(m.get(r.studentId) ?? []), r]);
    byLo.set(r.loCode, m);
  }
  const out: SectionStates = { states: new Map(), means: new Map(), assessments: new Map() };
  for (const [lo, perStudent] of byLo) {
    const pcts = [...perStudent.values()].map((rs) => {
      const a = rs.reduce((s, r) => s + r.available, 0);
      return a > 0 ? (rs.reduce((s, r) => s + r.earned, 0) / a) * 100 : 0;
    });
    const mean = pcts.reduce((s, x) => s + x, 0) / pcts.length;
    out.means.set(lo, mean);
    out.assessments.set(lo, new Set([...perStudent.values()].flat().map((r) => r.paperId)).size);
    const states = new Map<string, OutcomeState>();
    for (const [sid, rs] of perStudent) states.set(sid, computeOutcomeState(rs, policy, { sectionMeanPct: mean, now }));
    out.states.set(lo, states);
  }
  return out;
}

async function lockedOutcomes(classToken: MasteryClassToken, subject: MasterySubject) {
  return MasteryOutcome.find({ classToken, subject, status: "LOCKED" })
    .select("code labelBn chapterNumber strand order homeTipBn")
    .sort({ chapterNumber: 1, order: 1, code: 1 })
    .lean();
}

async function sectionLabel(sectionId: Types.ObjectId): Promise<{ sectionName: string; className: string }> {
  const s = await Section.findById(sectionId).select("nameBn classId").lean();
  const c = s ? await Class.findById(s.classId).select("nameBn").lean() : null;
  return { sectionName: s?.nameBn ?? "", className: c?.nameBn ?? "" };
}

async function studentContext(studentId: string) {
  if (!Types.ObjectId.isValid(studentId)) throw new MasteryWorkError("শিক্ষার্থী পাওয়া যায়নি।");
  const st = await Student.findById(studentId).select("name nameBn rollNumber sectionId").lean();
  if (!st) throw new MasteryWorkError("শিক্ষার্থী পাওয়া যায়নি।");
  const ctx = await sectionContext(String(st.sectionId));
  return { st, ctx };
}

// ---------------------------------------------------------------------------
// I1 — one student × subject
// ---------------------------------------------------------------------------

export interface OutcomeStateView {
  loCode: string;
  labelBn: string;
  chapterNumber: number | null;
  strand: string | null;
  state: MasteryState;
  since: string | null;
  lastEvidenceAt: string | null;
  evidenceCount: number;
  assessments: number;
  earnedPct: number | null;
  recentPct: number | null;
  sectionMeanPct: number | null;
  reworkCount: number;
  reasons: string[];
  nextRevisionAt: string | null;
}

const round = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n));

function stateView(
  o: { code: string; labelBn: string; chapterNumber?: number | null; strand?: string | null },
  s: OutcomeState | undefined,
  mean: number | undefined,
): OutcomeStateView {
  return {
    loCode: o.code,
    labelBn: o.labelBn,
    chapterNumber: o.chapterNumber ?? null,
    strand: o.strand ?? null,
    state: s?.state ?? "NOT_ASSESSED",
    since: iso(s?.since),
    lastEvidenceAt: iso(s?.lastEvidenceAt),
    evidenceCount: s?.evidenceCount ?? 0,
    assessments: s?.assessments ?? 0,
    earnedPct: round(s?.earnedPct),
    recentPct: round(s?.recentPct),
    sectionMeanPct: round(mean),
    reworkCount: s?.reworkCount ?? 0,
    reasons: s?.reasons ?? [],
    nextRevisionAt: iso(s?.nextRevisionAt),
  };
}

export interface StudentDiagnosis {
  studentId: string;
  name: string;
  rollNumber: string | null;
  sectionId: string;
  sectionName: string;
  className: string;
  classToken: string;
  subject: string;
  /** Subjects of this class with a locked catalogue that the caller may open. */
  subjects: string[];
  outcomes: OutcomeStateView[];
  /** Where the student stands: how many in the section have more WEAK outcomes in this subject. */
  sectionSize: number;
  moreWeakThan: number;
}

async function subjectsFor(auth: Auth, sectionId: Types.ObjectId, classToken: MasteryClassToken): Promise<string[]> {
  const subjects = (await MasteryOutcome.distinct("subject", { classToken, status: "LOCKED" })) as MasterySubject[];
  const out: string[] = [];
  for (const s of subjects.sort()) {
    try {
      await assertMayWork(auth, sectionId, s, new Date());
      out.push(s);
    } catch {
      /* not this caller's subject */
    }
  }
  return out;
}

export async function studentDiagnosis(studentId: string, subject: MasterySubject, auth: Auth): Promise<StudentDiagnosis> {
  const { st, ctx } = await studentContext(studentId);
  await assertMayWork(auth, ctx.sectionId, subject, new Date());
  const [outcomes, rows, policy, label, roster, subjects] = await Promise.all([
    lockedOutcomes(ctx.classToken, subject),
    liveSectionRows(ctx.sectionId, subject),
    diagnosisPolicy(ctx.classToken, subject),
    sectionLabel(ctx.sectionId),
    rosterOf(ctx.sectionId),
    subjectsFor(auth, ctx.sectionId, ctx.classToken),
  ]);
  const sec = computeSection(rows, policy, new Date());
  const weakCount = new Map<string, number>();
  for (const per of sec.states.values()) {
    for (const [sid, s] of per) if (s.state === "WEAK") weakCount.set(sid, (weakCount.get(sid) ?? 0) + 1);
  }
  const mine = weakCount.get(studentId) ?? 0;
  return {
    studentId,
    name: personName(st),
    rollNumber: st.rollNumber ?? null,
    sectionId: String(ctx.sectionId),
    ...label,
    classToken: ctx.classToken,
    subject,
    subjects,
    outcomes: outcomes.map((o) => stateView(o, sec.states.get(o.code)?.get(studentId), sec.means.get(o.code))),
    sectionSize: roster.length,
    moreWeakThan: roster.filter((s) => (weakCount.get(String(s._id)) ?? 0) < mine).length,
  };
}

// ---------------------------------------------------------------------------
// I2 — one student × outcome
// ---------------------------------------------------------------------------

export interface TrailRow {
  paperId: string;
  source: string;
  title: string | null;
  date: string;
  itemNo: number | null;
  qid: string | null;
  questionTypeCode: string | null;
  earned: number;
  available: number;
  rubricStep: number | null;
  rework: boolean;
  workRework: boolean;
  signal: string;
  routed: boolean;
  tags: { code: string; labelBn: string }[];
  excluded: boolean;
  excludeReason: string | null;
}

export interface OutcomeTrail {
  studentId: string;
  name: string;
  outcome: OutcomeStateView & { homeTipBn: string | null };
  history: { state: string; at: string; paperId: string | null }[];
  rows: TrailRow[];
  bankGold: number;
  bankSeen: number;
}

export async function outcomeTrail(studentId: string, loCode: string, auth: Auth): Promise<OutcomeTrail> {
  const parsed = parseMasteryLoCode(loCode);
  if (!parsed) throw new MasteryWorkError("শিখনফলের কোড ঠিক নয়।");
  const { st, ctx } = await studentContext(studentId);
  if (parsed.classToken !== ctx.classToken) throw new MasteryWorkError("এই শিখনফল শিক্ষার্থীর শ্রেণির নয়।");
  const subject = parsed.subject;
  await assertMayWork(auth, ctx.sectionId, subject, new Date());
  const outcome = await MasteryOutcome.findOne({ code: loCode }).select("code labelBn chapterNumber strand homeTipBn").lean();
  if (!outcome) throw new MasteryWorkError("শিখনফল পাওয়া যায়নি।");

  const [sectionRows, policy, own, tags, bank] = await Promise.all([
    liveSectionRows(ctx.sectionId, subject, loCode),
    diagnosisPolicy(ctx.classToken, subject),
    MasteryEvidence.find({ studentId: oid(studentId), loCode, supersededAt: null }).sort({ at: -1, itemNo: 1 }).lean(),
    MasteryTag.find({}).select("code labelBn").lean(),
    ContentArtifact.find({ docType: "question", current: true, retiredAt: null, reviewStatus: "gold", ...loCodeMongoFilter([loCode]) })
      .select("envelopeJson.payload.qid")
      .lean(), // bounded: one outcome's gold questions
  ]);
  const sec = computeSection(sectionRows, policy, new Date());
  const s = sec.states.get(loCode)?.get(studentId);
  const papers = await MasteryPaper.find({ _id: { $in: [...new Set(own.map((r) => String(r.paperId)))].map(oid) } })
    .select("paperId source title date items")
    .lean();
  const paperBy = new Map(papers.map((p) => [String(p._id), p]));
  const paperCode = new Map(papers.map((p) => [String(p._id), p.paperId]));
  const tagLabel = new Map(tags.map((t) => [t.code, t.labelBn]));
  const bankQids = new Set(
    bank.map((a) => ((a.envelopeJson as Record<string, unknown>)?.payload as Record<string, unknown> | undefined)?.qid).filter(Boolean) as string[],
  );
  const seen = new Set(own.map((r) => r.qid).filter((q): q is string => Boolean(q)));
  return {
    studentId,
    name: personName(st),
    outcome: { ...stateView(outcome, s, sec.means.get(loCode)), homeTipBn: outcome.homeTipBn ?? null },
    history: (s?.history ?? []).map((h) => ({ state: h.state, at: h.at.toISOString(), paperId: h.paperId ? paperCode.get(h.paperId) ?? null : null })),
    rows: own.map((r) => {
      const p = paperBy.get(String(r.paperId));
      const item = p?.items.find((i) => i.itemNo === r.itemNo);
      return {
        paperId: p?.paperId ?? "",
        source: r.source,
        title: p?.title ?? null,
        date: new Date(r.at).toISOString().slice(0, 10),
        itemNo: r.itemNo ?? null,
        qid: r.qid ?? null,
        questionTypeCode: item?.questionTypeCode ?? null,
        earned: r.earned,
        available: r.available,
        rubricStep: r.rubricStep ?? null,
        rework: Boolean(r.rework),
        workRework: Boolean(r.workRework),
        signal: r.signal,
        routed: Boolean(r.routed),
        tags: (r.tags ?? []).map((c) => ({ code: c, labelBn: tagLabel.get(c) ?? c })),
        excluded: Boolean(r.excludedAt),
        excludeReason: r.excludeReason ?? null,
      };
    }),
    bankGold: bankQids.size,
    bankSeen: [...seen].filter((q) => bankQids.has(q)).length,
  };
}

// ---------------------------------------------------------------------------
// I3 — section heat-map
// ---------------------------------------------------------------------------

export interface HeatOutcome {
  loCode: string;
  labelBn: string;
  chapterNumber: number | null;
  strand: string | null;
  assessments: number;
  weak: number;
  verdicts: number;
  weakPct: number | null;
  triggered: boolean;
  sectionMeanPct: number | null;
  /** One cell per student, in `students` order. */
  cells: { state: MasteryState; pct: number | null }[];
}

export interface SectionHeatmap {
  sectionId: string;
  sectionName: string;
  className: string;
  subject: string;
  triggerPct: number;
  students: { studentId: string; name: string; rollNumber: string | null; weakCount: number }[];
  /** Outcomes the section has evidence on ("taught"), in book order. */
  outcomes: HeatOutcome[];
  /** Locked outcomes with no evidence yet. */
  notYetAssessed: number;
}

export async function sectionHeatmap(sectionId: string, subject: MasterySubject, auth: Auth): Promise<SectionHeatmap> {
  const ctx = await sectionContext(sectionId);
  await assertMayWork(auth, ctx.sectionId, subject, new Date());
  const [outcomes, rows, policy, label, roster] = await Promise.all([
    lockedOutcomes(ctx.classToken, subject),
    liveSectionRows(ctx.sectionId, subject),
    diagnosisPolicy(ctx.classToken, subject),
    sectionLabel(ctx.sectionId),
    rosterOf(ctx.sectionId),
  ]);
  const sec = computeSection(rows, policy, new Date());
  const students = roster.map((s) => String(s._id));
  const heat: HeatOutcome[] = [];
  for (const o of outcomes) {
    const per = sec.states.get(o.code);
    if (!per) continue;
    const cells = students.map((sid) => {
      const s = per.get(sid);
      return { state: (s?.state ?? "NOT_ASSESSED") as MasteryState, pct: round(s?.recentPct) };
    });
    const assessments = sec.assessments.get(o.code) ?? 0;
    const sum = sectionOutcomeSummary(cells.map((c) => c.state), assessments, policy);
    heat.push({
      loCode: o.code, labelBn: o.labelBn, chapterNumber: o.chapterNumber ?? null, strand: o.strand ?? null,
      assessments, ...sum, sectionMeanPct: round(sec.means.get(o.code)), cells,
    });
  }
  return {
    sectionId: String(ctx.sectionId),
    ...label,
    subject,
    triggerPct: policy.sectionTriggerPct,
    students: roster.map((s, i) => ({
      studentId: students[i],
      name: personName(s),
      rollNumber: s.rollNumber ?? null,
      weakCount: heat.filter((h) => h.cells[i].state === "WEAK").length,
    })),
    outcomes: heat,
    notYetAssessed: outcomes.length - heat.length,
  };
}

// ---------------------------------------------------------------------------
// I4 — quality report
// ---------------------------------------------------------------------------

export interface QualityPaperRow {
  paper: PaperView;
  students: number;
  meanPct: number | null;
  flagged: number;
}

/** Each paper's own-outcome rows (not routed, not superseded) — the quality report's input. */
async function qualityInputs(paper: Pick<IMasteryPaper, "_id" | "sectionId" | "subject" | "date">) {
  const since = new Date(paper.date.getTime() - QUALITY_RANK_WEEKS * 7 * 86_400_000);
  const [rows, rankRows] = await Promise.all([
    MasteryEvidence.find({ paperId: paper._id, supersededAt: null, routed: false }).select("studentId itemNo earned available rework").lean(),
    MasteryEvidence.find({
      sectionId: paper.sectionId, subject: paper.subject, supersededAt: null, excludedAt: null, routed: false,
      at: { $gte: since, $lte: paper.date },
    })
      .select("studentId earned available")
      .lean(), // bounded: one section × subject × 8 weeks
  ]);
  const acc = new Map<string, { e: number; a: number }>();
  for (const r of rankRows) {
    const k = String(r.studentId);
    const x = acc.get(k) ?? { e: 0, a: 0 };
    x.e += r.earned;
    x.a += r.available;
    acc.set(k, x);
  }
  const rank = new Map([...acc].filter(([, x]) => x.a > 0).map(([k, x]) => [k, (x.e / x.a) * 100]));
  return {
    rows: rows.map((r) => ({ studentId: String(r.studentId), itemNo: r.itemNo ?? null, earned: r.earned, available: r.available, rework: Boolean(r.rework) })),
    rank,
  };
}

export async function qualityPapersPage(
  sectionId: string,
  subject: MasterySubject,
  args: PageArgs,
  auth: Auth,
): Promise<Page<QualityPaperRow>> {
  const ctx = await sectionContext(sectionId);
  await assertMayWork(auth, ctx.sectionId, subject, new Date());
  return queryPage(
    MasteryPaper,
    { sectionId: ctx.sectionId, subject, entryState: "CONFIRMED", source: { $ne: "RUBRIC" } },
    { date: -1, _id: -1 },
    args,
    async (docs) =>
      Promise.all(
        (docs as unknown as IMasteryPaper[]).map(async (p) => {
          const { rows, rank } = await qualityInputs(p);
          const q = paperQuality(p.items.map((i) => i.itemNo), rows, rank);
          return { paper: paperView(p), students: new Set(rows.map((r) => r.studentId)).size, meanPct: q.meanPct, flagged: q.flagged };
        }),
      ),
  );
}

export interface ExclusionView {
  id: string;
  scope: MasteryExclusionScope;
  paperId: string;
  itemNo: number;
  qid: string | null;
  reason: string;
  at: string;
  byName: string;
}

export interface PaperQualityDetail {
  paper: PaperView;
  students: number;
  rosterSize: number;
  meanPct: number | null;
  flagged: number;
  items: (ItemQuality & { exclusion: ExclusionView | null })[];
}

async function exclusionViews(list: IMasteryExclusion[], paperCode: (id: string) => string): Promise<ExclusionView[]> {
  const users = await User.find({ _id: { $in: [...new Set(list.map((x) => String(x.by)))].map(oid) } }).select("name nameBn").lean();
  const nameOf = new Map(users.map((u) => [String(u._id), personName(u as { name?: string; nameBn?: string })]));
  return list.map((x) => ({
    id: String(x._id),
    scope: x.scope,
    paperId: paperCode(String(x.paperId)),
    itemNo: x.itemNo,
    qid: x.qid ?? null,
    reason: x.reason,
    at: x.at.toISOString(),
    byName: nameOf.get(String(x.by)) ?? "",
  }));
}

export async function paperQualityDetail(paperId: string, auth: Auth): Promise<PaperQualityDetail> {
  const paper = await loadPaperFor(paperId, auth);
  const [{ rows, rank }, roster] = await Promise.all([qualityInputs(paper), rosterOf(paper.sectionId)]);
  const q = paperQuality(paper.items.map((i) => i.itemNo), rows, rank);
  const qids = paper.items.map((i) => i.qid).filter((x): x is string => Boolean(x));
  const active = (await MasteryExclusion.find({
    sectionId: paper.sectionId,
    revokedAt: null,
    $or: [{ scope: "ITEM", paperId: paper._id }, { scope: "QID", qid: { $in: qids } }],
  }).lean()) as unknown as IMasteryExclusion[];
  const codes = new Map(
    (await MasteryPaper.find({ _id: { $in: active.map((x) => x.paperId) } }).select("paperId").lean()).map((p) => [String(p._id), p.paperId]),
  );
  const views = await exclusionViews(active, (id) => codes.get(id) ?? "");
  return {
    paper: paperView(paper),
    students: new Set(rows.map((r) => r.studentId)).size,
    rosterSize: roster.length,
    meanPct: q.meanPct,
    flagged: q.flagged,
    items: q.items.map((it) => {
      const item = paper.items.find((i) => i.itemNo === it.itemNo)!;
      const ex = active.findIndex((x) =>
        x.scope === "ITEM" ? String(x.paperId) === String(paper._id) && x.itemNo === it.itemNo : Boolean(item.qid) && x.qid === item.qid,
      );
      return { ...it, exclusion: ex >= 0 ? views[ex] : null };
    }),
  };
}

// ---------------------------------------------------------------------------
// Exclusion (D-#782)
// ---------------------------------------------------------------------------

export async function excludeItem(
  paperId: string,
  itemNo: number,
  scope: MasteryExclusionScope,
  reason: string,
  auth: Auth,
): Promise<ExclusionView> {
  const paper = await loadPaperFor(paperId, auth);
  const item = paper.items.find((i) => i.itemNo === itemNo);
  if (!item) throw new MasteryWorkError(`প্রশ্ন ${bn(itemNo)} এই কাজে নেই।`);
  if (scope !== "ITEM" && scope !== "QID") throw new MasteryWorkError("বাদ দেওয়ার ধরন ঠিক নয়।");
  if (scope === "QID" && !item.qid) throw new MasteryWorkError("নিজের লেখা প্রশ্ন শুধু এই কাজ থেকে বাদ দেওয়া যায়।");
  const why = (reason ?? "").trim();
  if (!why) throw new MasteryWorkError("বাদ দেওয়ার কারণ লিখুন।");
  if (why.length > 300) throw new MasteryWorkError("কারণ ৩০০ অক্ষরের মধ্যে লিখুন।");
  const dup = await MasteryExclusion.exists({
    sectionId: paper.sectionId,
    revokedAt: null,
    ...(scope === "QID" ? { scope, qid: item.qid } : { scope, paperId: paper._id, itemNo }),
  });
  if (dup) throw new MasteryWorkError("এই প্রশ্ন আগেই নির্ণয় থেকে বাদ দেওয়া আছে।");
  if (!Types.ObjectId.isValid(auth.userId)) throw new MasteryWorkError("ব্যবহারকারী পাওয়া যায়নি।");
  const ex = await MasteryExclusion.create({
    sectionId: paper.sectionId,
    subject: paper.subject,
    scope,
    paperId: paper._id,
    itemNo,
    qid: scope === "QID" ? item.qid : undefined,
    reason: why,
    by: oid(auth.userId),
    at: new Date(),
  });
  await reapplyExclusions(paper.sectionId);
  void writeAudit({
    eventKind: "MASTERY_ITEM_EXCLUDED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryPaper",
    targetId: paper._id,
    meta: { paperId, itemNo, scope, qid: item.qid ?? null, reason: why },
  });
  return (await exclusionViews([ex], () => paperId))[0];
}

export async function revokeExclusion(exclusionId: string, auth: Auth): Promise<boolean> {
  if (!Types.ObjectId.isValid(exclusionId)) throw new MasteryWorkError("বাদ দেওয়ার রেকর্ড পাওয়া যায়নি।");
  const ex = await MasteryExclusion.findById(exclusionId);
  if (!ex || ex.revokedAt) throw new MasteryWorkError("বাদ দেওয়ার রেকর্ড পাওয়া যায়নি।");
  await assertMayWork(auth, ex.sectionId, ex.subject, new Date());
  ex.revokedAt = new Date();
  ex.revokedBy = Types.ObjectId.isValid(auth.userId) ? oid(auth.userId) : undefined;
  await ex.save();
  await clearExclusion(ex);
  void writeAudit({
    eventKind: "MASTERY_EXCLUSION_REVOKED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryPaper",
    targetId: ex.paperId,
    meta: { itemNo: ex.itemNo, scope: ex.scope, qid: ex.qid ?? null },
  });
  return true;
}
