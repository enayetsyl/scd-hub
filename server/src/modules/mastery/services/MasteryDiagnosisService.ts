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
import { MasteryAction } from "../models/MasteryAction";
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
import { MasteryDomain } from "../models/MasteryDomain";
import {
  buildCatalogueTree,
  objectiveState,
  rollUpObjective,
  summarise,
  type CatalogueTree,
  type StateSummary,
  type TreeRowLike,
} from "../rollup";

const oid = (s: string) => new Types.ObjectId(s);
const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

type LiveRow = EvidenceLike & { studentId: string };

/** The live rows (not superseded, not excluded) of one section × subject. */
export async function liveSectionRows(sectionId: Types.ObjectId, subject: MasterySubject, loCode?: string): Promise<LiveRow[]> {
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

export async function diagnosisPolicy(classToken: MasteryClassToken, subject: MasterySubject): Promise<DiagnosisPolicy> {
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
export function computeSection(rows: LiveRow[], policy: DiagnosisPolicy, now: Date): SectionStates {
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

export async function lockedOutcomes(classToken: MasteryClassToken, subject: MasterySubject) {
  return MasteryOutcome.find({ classToken, subject, status: "LOCKED" })
    .select("code labelBn chapterNumber strand order homeTipBn assess questionTypeCodes level parentCode tagged domainCode prereqCodes")
    .sort({ chapterNumber: 1, order: 1, code: 1 })
    .lean();
}

// ---------------------------------------------------------------------------
// OT-3 — the tree of a class × subject, roll-up and the earlier step (prd-objective-tree §8.1)
// ---------------------------------------------------------------------------

export interface LoadedTree {
  rows: Awaited<ReturnType<typeof lockedOutcomes>>;
  tree: CatalogueTree;
  /** Domain code → its label (school-wide ladder, D-#921). */
  domainLabel: Map<string, string>;
}

/** The LOCKED rows of a class × subject as a tree. A flat catalogue reads `isTree: false`. */
export async function loadTree(classToken: MasteryClassToken, subject: MasterySubject): Promise<LoadedTree> {
  const [rows, domains] = await Promise.all([
    lockedOutcomes(classToken, subject),
    MasteryDomain.find({ subject }).select("code labelBn order").sort({ order: 1, code: 1 }).lean(),
  ]);
  const tree = buildCatalogueTree(rows as TreeRowLike[], domains.map((d) => d.code));
  return { rows, tree, domainLabel: new Map(domains.map((d) => [d.code, d.labelBn])) };
}

export interface EarlierStep {
  code: string;
  labelBn: string;
  classToken: string;
  /** The prerequisite belongs to an earlier class (the D-#927 ladder). */
  crossClass: boolean;
  /** The student's state on it; null when `noData`. */
  state: MasteryState | null;
  /** Cross-class and the student has no evidence from that class ("আগের শ্রেণির তথ্য নেই"). */
  noData: boolean;
}

/**
 * Each prerequisite with THIS student's state (D-#927). Same class: read from the section's live
 * states (an untagged prerequisite rolls up from its children). Earlier class: the student's own
 * evidence from that class (any section, any year), replayed by the engine with that class's
 * policy and that section's mean; none at all ⇒ noData.
 */
export async function resolveEarlierSteps(
  studentId: string,
  classToken: MasteryClassToken,
  subject: MasterySubject,
  prereqCodes: string[],
  stateHere: (code: string) => MasteryState,
): Promise<Map<string, EarlierStep>> {
  const codes = [...new Set(prereqCodes)];
  const out = new Map<string, EarlierStep>();
  if (codes.length === 0) return out;
  const [rows, kids] = await Promise.all([
    MasteryOutcome.find({ code: { $in: codes } }).select("code labelBn level tagged").lean(),
    MasteryOutcome.find({ parentCode: { $in: codes }, status: { $ne: "RETIRED" } }).select("code parentCode tagged").lean(),
  ]);
  const rowBy = new Map(rows.map((r) => [r.code, r]));
  const childrenOf = new Map<string, string[]>();
  for (const k of kids) if (k.parentCode && (k.tagged ?? true)) childrenOf.set(k.parentCode, [...(childrenOf.get(k.parentCode) ?? []), k.code]);
  const leavesOf = (code: string): string[] => {
    const r = rowBy.get(code);
    const untagged = r ? r.tagged === false : (childrenOf.get(code) ?? []).length > 0;
    return untagged ? childrenOf.get(code) ?? [] : [code];
  };

  // Earlier-class prerequisites: the student's own live evidence on their tagged rows.
  const cross = codes.filter((c) => (parseMasteryLoCode(c)?.classToken ?? classToken) !== classToken);
  const crossLeaves = [...new Set(cross.flatMap(leavesOf))];
  const crossState = new Map<string, MasteryState>();
  if (crossLeaves.length > 0 && Types.ObjectId.isValid(studentId)) {
    const own = await MasteryEvidence.find({ studentId: oid(studentId), loCode: { $in: crossLeaves }, supersededAt: null, excludedAt: null })
      .select("sectionId loCode")
      .lean(); // bounded: one student × a handful of earlier codes
    const sectionOf = new Map<string, Types.ObjectId>();
    for (const r of own) if (!sectionOf.has(r.loCode)) sectionOf.set(r.loCode, r.sectionId);
    for (const [lo, sectionId] of sectionOf) {
      const parsed = parseMasteryLoCode(lo);
      if (!parsed) continue;
      const [secRows, policy] = await Promise.all([liveSectionRows(sectionId, parsed.subject, lo), diagnosisPolicy(parsed.classToken, parsed.subject)]);
      const st = computeSection(secRows, policy, new Date()).states.get(lo)?.get(studentId)?.state;
      if (st) crossState.set(lo, st);
    }
  }

  for (const code of codes) {
    const parsed = parseMasteryLoCode(code);
    const isCross = (parsed?.classToken ?? classToken) !== classToken;
    const leaves = leavesOf(code);
    let state: MasteryState | null;
    let noData = false;
    if (isCross) {
      const known = leaves.filter((l) => crossState.has(l));
      if (known.length === 0) {
        state = null;
        noData = true;
      } else state = rollUpObjective(leaves.map((l) => crossState.get(l) ?? "NOT_ASSESSED"));
    } else {
      state = leaves.length === 1 && leaves[0] === code ? stateHere(code) : rollUpObjective(leaves.map(stateHere));
    }
    out.set(code, {
      code,
      labelBn: rowBy.get(code)?.labelBn ?? code,
      classToken: parsed?.classToken ?? classToken,
      crossClass: isCross,
      state,
      noData,
    });
  }
  return out;
}

export interface RollupObjectiveView {
  code: string;
  labelBn: string;
  chapterNumber: number | null;
  strand: string | null;
  domainCode: string | null;
  tagged: boolean;
  /** Own state (tagged) or rolled up from the children (untagged). */
  state: MasteryState;
  childCodes: string[];
  weakChildCodes: string[];
  /** The children's states (a tagged objective: its own one state). */
  summary: StateSummary;
}

export interface DomainRollupView {
  code: string | null;
  labelBn: string | null;
  objectiveCodes: string[];
  /** Counts per state over the domain's tagged rows. */
  summary: StateSummary;
  /** The same roll-up rule applied to all of the domain's tagged rows. */
  state: MasteryState;
}

/** One student's objective and domain roll-up over a tree. */
export function studentRollup(
  t: LoadedTree,
  stateOf: (code: string) => MasteryState,
): { objectives: RollupObjectiveView[]; domains: DomainRollupView[] } {
  const objectives = t.tree.objectives.map((o) => {
    const leaves = o.tagged ? [o.code] : o.childCodes;
    const states = leaves.map(stateOf);
    return {
      code: o.code,
      labelBn: o.labelBn,
      chapterNumber: o.chapterNumber,
      strand: o.strand,
      domainCode: o.domainCode,
      tagged: o.tagged,
      state: objectiveState(o, stateOf),
      childCodes: o.childCodes,
      weakChildCodes: o.childCodes.filter((c) => stateOf(c) === "WEAK"),
      summary: summarise(states),
    };
  });
  const domains = t.tree.domains.map((d) => {
    const states = d.taggedCodes.map(stateOf);
    return {
      code: d.code,
      labelBn: d.code ? t.domainLabel.get(d.code) ?? d.code : null,
      objectiveCodes: d.objectiveCodes,
      summary: summarise(states),
      state: rollUpObjective(states),
    };
  });
  return { objectives, domains };
}

export async function sectionLabel(sectionId: Types.ObjectId): Promise<{ sectionName: string; className: string }> {
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
  // OT-3: where the row sits in the tree (a flat row: OBJECTIVE, no parent, no domain).
  level: string;
  parentCode: string | null;
  domainCode: string | null;
  /** WEAK rows only: each prerequisite with this student's state (D-#927). */
  earlierSteps: EarlierStep[];
}

const round = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n));

function stateView(
  o: TreeRowLike,
  s: OutcomeState | undefined,
  mean: number | undefined,
): OutcomeStateView {
  return {
    loCode: o.code,
    labelBn: o.labelBn,
    chapterNumber: o.chapterNumber ?? null,
    strand: o.strand ?? null,
    level: o.level ?? "OBJECTIVE",
    parentCode: o.parentCode ?? null,
    domainCode: o.domainCode ?? null,
    earlierSteps: [],
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
  /** The TAGGED rows (a flat catalogue: every row, as before). */
  outcomes: OutcomeStateView[];
  /** Where the student stands: how many in the section have more WEAK outcomes in this subject. */
  sectionSize: number;
  moreWeakThan: number;
  /** OT-3: false for a flat catalogue (the screen renders as before). */
  isTree: boolean;
  objectives: RollupObjectiveView[];
  domains: DomainRollupView[];
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
  const [t, rows, policy, label, roster, subjects] = await Promise.all([
    loadTree(ctx.classToken, subject),
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
  const stateOf = (code: string): MasteryState => sec.states.get(code)?.get(studentId)?.state ?? "NOT_ASSESSED";
  const outcomes = t.tree.tagged.map((o) => stateView(o, sec.states.get(o.code)?.get(studentId), sec.means.get(o.code)));
  // The earlier step (D-#927) on every WEAK tagged row that names prerequisites.
  const weakRows = t.tree.tagged.filter((o) => stateOf(o.code) === "WEAK" && (o.prereqCodes ?? []).length > 0);
  if (weakRows.length > 0) {
    const steps = await resolveEarlierSteps(studentId, ctx.classToken, subject, weakRows.flatMap((o) => o.prereqCodes ?? []), stateOf);
    for (const v of outcomes) {
      const row = t.tree.byCode.get(v.loCode);
      if (v.state === "WEAK") v.earlierSteps = (row?.prereqCodes ?? []).map((c) => steps.get(c)).filter((x): x is EarlierStep => Boolean(x));
    }
  }
  const roll = t.tree.isTree ? studentRollup(t, stateOf) : { objectives: [], domains: [] };
  return {
    studentId,
    name: personName(st),
    rollNumber: st.rollNumber ?? null,
    sectionId: String(ctx.sectionId),
    ...label,
    classToken: ctx.classToken,
    subject,
    subjects,
    outcomes,
    sectionSize: roster.length,
    moreWeakThan: roster.filter((s) => (weakCount.get(String(s._id)) ?? 0) < mine).length,
    isTree: t.tree.isTree,
    objectives: roll.objectives,
    domains: roll.domains,
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
  /** OT-3: the objective a sub-objective belongs to, and the domain (null on a flat row). */
  parentLabelBn: string | null;
  domainLabelBn: string | null;
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
  const outcome = await MasteryOutcome.findOne({ code: loCode })
    .select("code labelBn chapterNumber strand homeTipBn level parentCode tagged domainCode prereqCodes")
    .lean();
  if (!outcome) throw new MasteryWorkError("শিখনফল পাওয়া যায়নি।");
  const [parent, domain] = await Promise.all([
    outcome.parentCode ? MasteryOutcome.findOne({ code: outcome.parentCode }).select("labelBn homeTipBn").lean() : null,
    outcome.domainCode ? MasteryDomain.findOne({ code: outcome.domainCode }).select("labelBn").lean() : null,
  ]);

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
  const view = stateView(outcome as TreeRowLike, s, sec.means.get(loCode));
  const prereqs = outcome.prereqCodes ?? [];
  if (view.state === "WEAK" && prereqs.length > 0) {
    // The same-class prerequisites read the section's live states (the whole subject's rows).
    const subjectRows = await liveSectionRows(ctx.sectionId, subject);
    const all = computeSection(subjectRows, policy, new Date());
    const stateOf = (code: string): MasteryState => all.states.get(code)?.get(studentId)?.state ?? "NOT_ASSESSED";
    const steps = await resolveEarlierSteps(studentId, ctx.classToken, subject, prereqs, stateOf);
    view.earlierSteps = prereqs.map((c) => steps.get(c)).filter((x): x is EarlierStep => Boolean(x));
  }
  return {
    studentId,
    name: personName(st),
    // A sub-objective's home tip is its objective's (guardians see the objective grain, D-#925).
    outcome: { ...view, homeTipBn: outcome.homeTipBn ?? parent?.homeTipBn ?? null },
    parentLabelBn: parent?.labelBn ?? null,
    domainLabelBn: domain?.labelBn ?? null,
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
  /** The open action on this outcome, if any (M-5) — the banner links to it. */
  actionId: string | null;
  actionStatus: string | null;
  /** One cell per student, in `students` order. */
  cells: { state: MasteryState; pct: number | null }[];
  // OT-3 — a column is a tagged row (TAGGED), an objective (OBJECTIVE, rolled up) or a domain (DOMAIN).
  level: "TAGGED" | "OBJECTIVE" | "DOMAIN";
  parentCode: string | null;
  /** A tagged sub-objective's objective — the trigger banner names it (§8.1). */
  parentLabelBn: string | null;
  domainCode: string | null;
  /** OBJECTIVE: its tagged children; DOMAIN: its objectives. */
  childCodes: string[];
  /** OBJECTIVE: children with at least one WEAK student, the worst first. */
  weakChildCodes: string[];
  /** Share of cells MASTERED / REVISION_DUE (DOMAIN, OBJECTIVE). */
  masteredPct: number | null;
}

export interface SectionHeatmap {
  sectionId: string;
  sectionName: string;
  className: string;
  subject: string;
  triggerPct: number;
  students: { studentId: string; name: string; rollNumber: string | null; weakCount: number }[];
  /** Tagged rows the section has evidence on ("taught"), in book order. */
  outcomes: HeatOutcome[];
  /** Tagged rows with no evidence yet. */
  notYetAssessed: number;
  /** OT-3: false for a flat catalogue — then the two lists below are empty. */
  isTree: boolean;
  /** Objectives with at least one taught tagged row, rolled up per student. */
  objectiveColumns: HeatOutcome[];
  /** Domains with at least one taught tagged row: per student the roll-up, the section's share weak. */
  domainColumns: HeatOutcome[];
}

export async function sectionHeatmap(sectionId: string, subject: MasterySubject, auth: Auth): Promise<SectionHeatmap> {
  const ctx = await sectionContext(sectionId);
  await assertMayWork(auth, ctx.sectionId, subject, new Date());
  const [t, rows, policy, label, roster, actions] = await Promise.all([
    loadTree(ctx.classToken, subject),
    liveSectionRows(ctx.sectionId, subject),
    diagnosisPolicy(ctx.classToken, subject),
    sectionLabel(ctx.sectionId),
    rosterOf(ctx.sectionId),
    MasteryAction.find({ sectionId: ctx.sectionId, subject, status: { $in: ["PROPOSED", "APPROVED", "IN_PROGRESS", "CHECKING"] } })
      .select("loCode status")
      .lean(),
  ]);
  const actionOf = new Map(actions.map((x) => [x.loCode, { id: String(x._id), status: x.status as string }]));
  const sec = computeSection(rows, policy, new Date());
  const students = roster.map((s) => String(s._id));
  const heat: HeatOutcome[] = [];
  const parentLabel = (code: string | null | undefined) => (code ? t.tree.byCode.get(code)?.labelBn ?? null : null);
  for (const o of t.tree.tagged) {
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
      assessments, ...sum, sectionMeanPct: round(sec.means.get(o.code)),
      actionId: actionOf.get(o.code)?.id ?? null, actionStatus: actionOf.get(o.code)?.status ?? null, cells,
      level: "TAGGED", parentCode: o.parentCode ?? null, parentLabelBn: parentLabel(o.parentCode),
      domainCode: o.domainCode ?? null, childCodes: [], weakChildCodes: [], masteredPct: null,
    });
  }

  // OT-3 roll-up columns (tree catalogues only). The trigger stays on tagged rows (D-#813).
  const objectiveColumns: HeatOutcome[] = [];
  const domainColumns: HeatOutcome[] = [];
  if (t.tree.isTree) {
    const heatBy = new Map(heat.map((h) => [h.loCode, h]));
    const stateAt = (code: string, si: number): MasteryState => heatBy.get(code)?.cells[si].state ?? "NOT_ASSESSED";
    const rollColumn = (
      code: string, labelBn: string, level: "OBJECTIVE" | "DOMAIN", leaves: string[], extra: Partial<HeatOutcome>,
    ): HeatOutcome | null => {
      const taught = leaves.filter((c) => heatBy.has(c));
      if (taught.length === 0) return null;
      const cells = students.map((_sid, si) => {
        const states = leaves.map((c) => stateAt(c, si));
        return { state: rollUpObjective(states), pct: summarise(states).masteredPct };
      });
      const all = summarise(students.flatMap((_sid, si) => leaves.map((c) => stateAt(c, si))));
      const perStudent = summarise(cells.map((c) => c.state));
      const isDomain = level === "DOMAIN";
      return {
        loCode: code, labelBn, chapterNumber: null, strand: null,
        assessments: Math.max(...taught.map((c) => heatBy.get(c)!.assessments)),
        // An objective column counts students (its rolled-up state); a domain counts its cells.
        weak: isDomain ? all.weak : perStudent.weak,
        verdicts: isDomain ? all.assessed : perStudent.assessed,
        weakPct: isDomain ? all.weakPct : perStudent.weakPct,
        triggered: taught.some((c) => heatBy.get(c)!.triggered),
        sectionMeanPct: null, actionId: null, actionStatus: null, cells,
        level, parentCode: null, parentLabelBn: null, domainCode: null, childCodes: [], weakChildCodes: [],
        masteredPct: all.masteredPct,
        ...extra,
      };
    };
    for (const o of t.tree.objectives) {
      const leaves = o.tagged ? [o.code] : o.childCodes;
      const weakChildCodes = o.childCodes
        .filter((c) => (heatBy.get(c)?.weak ?? 0) > 0)
        .sort((a, b) => (heatBy.get(b)!.weakPct ?? 0) - (heatBy.get(a)!.weakPct ?? 0));
      const col = rollColumn(o.code, o.labelBn, "OBJECTIVE", leaves, {
        chapterNumber: o.chapterNumber, strand: o.strand, domainCode: o.domainCode, childCodes: o.childCodes, weakChildCodes,
      });
      if (col) objectiveColumns.push(col);
    }
    for (const d of t.tree.domains) {
      const label = d.code ? t.domainLabel.get(d.code) ?? d.code : "";
      const col = rollColumn(d.code ?? "", label, "DOMAIN", d.taggedCodes, { domainCode: d.code, childCodes: d.objectiveCodes });
      if (col) domainColumns.push(col);
    }
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
    notYetAssessed: t.tree.tagged.length - heat.length,
    isTree: t.tree.isTree,
    objectiveColumns,
    domainColumns,
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
