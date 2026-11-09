/**
 * MasteryCatalogueService — M-0 of the mastery tracker (docs/prd-mastery.md §5.1).
 *
 * Catalogue (chapters, learning outcomes, skill strands), the question-type mark table,
 * diagnosis tags, policy and the per year × class × subject switch. Every write is
 * `mastery:manage` at the resolver; the rules themselves live in ../catalogue.ts so this
 * file only reads rows, asks the rules, and writes what they allow.
 */
import { Types } from "mongoose";
import type {
  MasteryClassToken,
  MasteryPolicyValues,
  MasterySubject,
  MasteryOutcomeStatus,
} from "@scd/shared";
import { MasteryOutcome, type IMasteryOutcome } from "../models/MasteryOutcome";
import { MasteryChapter } from "../models/MasteryChapter";
import { MasteryQuestionType } from "../models/MasteryQuestionType";
import { MasteryTag } from "../models/MasteryTag";
import { MasteryPolicy } from "../models/MasteryPolicy";
import { MasteryEnablement } from "../models/MasteryEnablement";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { writeAudit } from "../../platform/services/AuditService";
import {
  MASTERY_CLASS_TOKENS,
  MASTERY_SUBJECTS,
  checkTreeInvariants,
  formatTreeViolation,
  isObjectiveTreeFile,
  readDomainsFile,
  readTreeFile,
  type DomainsFile,
  type MasteryLevelLabels,
  type TreeFile,
} from "@scd/shared";
import { MasteryDomain } from "../models/MasteryDomain";
import { MasteryCatalogueReview } from "../models/MasteryCatalogueReview";
import { MasteryEvidence } from "../models/MasteryEvidence";
import { outcomeBookRef, treeShapeOf } from "../models/MasteryOutcome";
import {
  appendReviewEvents,
  latestReviewRound,
  openReviewRound,
  resolveLevelLabels,
  switchBlockedByReview,
  LEVEL_LABEL_KEYS,
  type ReviewEventInput,
} from "./MasteryReviewService";
import { mergedTreeViolations, planTreeImport, REMOVED_IN_REDRAFT, type ExistingTreeRow } from "../tree";
import {
  cleanPolicyValues,
  diffCatalogue,
  parseCatalogueImport,
  policyScopeKey,
  resolvePolicy,
  validatePolicy,
  validateTagInput,
  type CatalogueDiff,
  type CatalogueImport,
  type TagInput,
} from "../catalogue";

export interface Actor {
  userId: string;
  role: string;
}

export class MasteryCatalogueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasteryCatalogueError";
  }
}

const actorOid = (a: Actor): Types.ObjectId | undefined =>
  Types.ObjectId.isValid(a.userId) ? new Types.ObjectId(a.userId) : undefined;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface OutcomeView {
  code: string;
  classToken: string;
  subject: string;
  chapterNumber: number | null;
  strand: string | null;
  labelBn: string;
  labelEn: string | null;
  sourceText: string;
  nctbCode: string | null;
  assess: string;
  questionTypeCodes: string[];
  homeTipBn: string | null;
  order: number;
  status: string;
  // Objective tree (prd-objective-tree §5). A flat M-0 row reads as a tagged OBJECTIVE, no parent.
  level: string;
  parentCode: string | null;
  domainCode: string | null;
  tagged: boolean;
  prereqCodes: string[];
  legacyCodes: string[];
  claudeNote: string | null;
  reviewState: string | null;
  rejectReason: string | null;
  mergedInto: string | null;
  bookRef: { version: string | null; chapter: number | null; lesson: string | null; exercises: string[] };
}

export interface ChapterView {
  number: number;
  titleBn: string;
  termNote: string | null;
  outcomeCount: number;
}

export interface QuestionTypeView {
  code: string;
  labelBn: string;
  marks: number | null;
  answerForm: string | null;
  notes: string | null;
  active: boolean;
  history: { marks: number; from: string }[];
}

export interface CatalogueView {
  classToken: string;
  subject: string;
  chapters: ChapterView[];
  outcomes: OutcomeView[];
  questionTypes: QuestionTypeView[];
  draftCount: number;
  lockedCount: number;
  retiredCount: number;
}

export interface CoverageRow {
  classToken: string;
  subject: string;
  draftCount: number;
  lockedCount: number;
  retiredCount: number;
  questionTypeCount: number;
}

const outcomeView = (o: IMasteryOutcome): OutcomeView => ({
  code: o.code,
  classToken: o.classToken,
  subject: o.subject,
  chapterNumber: o.chapterNumber ?? null,
  strand: o.strand ?? null,
  labelBn: o.labelBn,
  labelEn: o.labelEn ?? null,
  sourceText: o.sourceText ?? "",
  nctbCode: o.nctbCode ?? null,
  assess: o.assess,
  questionTypeCodes: o.questionTypeCodes ?? [],
  homeTipBn: o.homeTipBn ?? null,
  order: o.order,
  status: o.status,
  ...treeShapeOf(o),
  legacyCodes: o.legacyCodes ?? [],
  claudeNote: o.claudeNote ?? null,
  reviewState: o.reviewState ?? null,
  rejectReason: o.rejectReason ?? null,
  mergedInto: o.mergedInto ?? null,
  bookRef: (() => {
    const b = outcomeBookRef(o);
    return { version: b.version, chapter: b.chapter, lesson: b.lesson ?? null, exercises: b.exercises };
  })(),
});

export async function getCatalogue(
  classToken: MasteryClassToken,
  subject: MasterySubject,
  includeRetired = false,
): Promise<CatalogueView> {
  const [outcomes, chapters, qts] = await Promise.all([
    MasteryOutcome.find({ classToken, subject }).sort({ order: 1, code: 1 }).lean<IMasteryOutcome[]>(),
    MasteryChapter.find({ classToken, subject }).sort({ number: 1 }).lean(),
    MasteryQuestionType.find({ classToken, subject }).sort({ code: 1 }).lean(),
  ]);
  const count = (s: MasteryOutcomeStatus) => outcomes.filter((o) => o.status === s).length;
  const shown = includeRetired ? outcomes : outcomes.filter((o) => o.status !== "RETIRED");
  const perChapter = new Map<number, number>();
  for (const o of shown) if (o.chapterNumber !== null) perChapter.set(o.chapterNumber, (perChapter.get(o.chapterNumber) ?? 0) + 1);
  return {
    classToken,
    subject,
    chapters: chapters.map((c) => ({
      number: c.number,
      titleBn: c.titleBn,
      termNote: c.termNote ?? null,
      outcomeCount: perChapter.get(c.number) ?? 0,
    })),
    outcomes: shown.map(outcomeView),
    questionTypes: qts.map((q) => ({
      code: q.code,
      labelBn: q.labelBn,
      marks: q.marks ?? null,
      answerForm: q.answerForm ?? null,
      notes: q.notes ?? null,
      active: q.active,
      history: (q.history ?? []).map((h) => ({ marks: h.marks, from: new Date(h.from).toISOString() })),
    })),
    draftCount: count("DRAFT"),
    lockedCount: count("LOCKED"),
    retiredCount: count("RETIRED"),
  };
}

/** One row per class × subject that has anything in the catalogue — the A1/A2 overview grid. */
export async function listCoverage(): Promise<CoverageRow[]> {
  const [byStatus, qts] = await Promise.all([
    MasteryOutcome.aggregate<{ _id: { c: string; s: string; st: string }; n: number }>([
      { $group: { _id: { c: "$classToken", s: "$subject", st: "$status" }, n: { $sum: 1 } } },
    ]),
    MasteryQuestionType.aggregate<{ _id: { c: string; s: string }; n: number }>([
      { $group: { _id: { c: "$classToken", s: "$subject" }, n: { $sum: 1 } } },
    ]),
  ]);
  const rows = new Map<string, CoverageRow>();
  const row = (c: string, s: string): CoverageRow => {
    const k = `${c}:${s}`;
    let r = rows.get(k);
    if (!r) {
      r = { classToken: c, subject: s, draftCount: 0, lockedCount: 0, retiredCount: 0, questionTypeCount: 0 };
      rows.set(k, r);
    }
    return r;
  };
  for (const g of byStatus) {
    const r = row(g._id.c, g._id.s);
    if (g._id.st === "DRAFT") r.draftCount = g.n;
    if (g._id.st === "LOCKED") r.lockedCount = g.n;
    if (g._id.st === "RETIRED") r.retiredCount = g.n;
  }
  for (const g of qts) row(g._id.c, g._id.s).questionTypeCount = g.n;
  return [...rows.values()].sort((a, b) => (a.classToken + a.subject).localeCompare(b.classToken + b.subject));
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportReport {
  ok: boolean;
  applied: boolean;
  classToken: string | null;
  subject: string | null;
  status: string | null;
  errors: string[];
  diff: CatalogueDiff | null;
  /** Set for a `scd-objective-tree/1` import (prd-objective-tree §6); null for a flat file. */
  tree: TreeImportPreview | null;
}

export interface TreeImportPreview {
  format: string;
  counts: { domains: number; objectives: number; subs: number; strands: number; tagged: number; grouping: number };
  coverage: { exercisesTotal: number; mapped: number; unmapped: { ref: string; text: string; reason: string }[]; note: string | null };
  flags: { code: string | null; kind: string; text: string; ownerRuling: string | null }[];
  domains: { added: string[]; changed: string[]; unchanged: number };
  round: { action: string; round: number | null };
  review: { kept: number; backToProposed: string[]; removedInRedraft: string[]; lockedChanged: string[] };
  /** Every broken §5 / §10.1 rule, "[RULE] CODE: detail" (also in `errors`). */
  violations: string[];
  /** True when the apply would write nothing (an unchanged re-import). */
  noop: boolean;
}

const failReport = (errors: string[], tree: TreeImportPreview | null = null): ImportReport => ({
  ok: false,
  applied: false,
  classToken: null,
  subject: null,
  status: null,
  errors,
  diff: null,
  tree,
});

async function loadForDiff(c: CatalogueImport) {
  const [existing, existingQts] = await Promise.all([
    MasteryOutcome.find({ classToken: c.classToken, subject: c.subject }).lean<IMasteryOutcome[]>(),
    MasteryQuestionType.find({ classToken: c.classToken, subject: c.subject }).lean(),
  ]);
  return { existing, existingQts };
}

/**
 * Dry-run (apply = false) or apply an imported catalogue (M-0, PRD §5.1 "Catalogue import").
 * The dry run is the SAME computation the apply uses, so what the Principal reviews is what
 * gets written.
 */
export async function importCatalogue(
  json: string,
  apply: boolean,
  actor: Actor,
  domainsJson?: string | null,
): Promise<ImportReport> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return failReport(["JSON পড়া যায়নি।"]);
  }
  if (isObjectiveTreeFile(raw)) return importTree(raw, domainsJson ?? null, apply, actor);
  const parsed = parseCatalogueImport(raw);
  if (!parsed.ok) return failReport(parsed.errors);
  const c = parsed.catalogue;
  // A pair imported as a tree is reviewed in the app; a flat file would delete its draft rows.
  if (await MasteryCatalogueReview.exists({ classToken: c.classToken, subject: c.subject })) {
    return failReport([`${c.classToken} ${c.subject}-এর তালিকা এখন শিখনফল-বৃক্ষ (scd-objective-tree/1) — পুরোনো ধরনের ফাইল ইমপোর্ট করা যাবে না।`]);
  }
  const { existing, existingQts } = await loadForDiff(c);
  const diff = diffCatalogue(
    c,
    existing.map((e) => ({
      code: e.code,
      status: e.status,
      assess: e.assess,
      labelBn: e.labelBn,
      labelEn: e.labelEn,
      sourceText: e.sourceText ?? "",
      nctbCode: e.nctbCode,
      questionTypeCodes: e.questionTypeCodes ?? [],
      homeTipBn: e.homeTipBn,
      order: e.order,
    })),
    existingQts.map((q) => ({ code: q.code, labelBn: q.labelBn, marks: q.marks ?? null })),
  );
  const base = { classToken: c.classToken, subject: c.subject, status: c.status, diff, tree: null };
  if (diff.errors.length > 0) return { ...base, ok: false, applied: false, errors: diff.errors };
  if (!apply) return { ...base, ok: true, applied: false, errors: [] };

  const now = new Date();
  const by = actorOid(actor);
  await applyChaptersAndQts(c, existingQts, now, by);

  // Outcomes.
  const existingByCode = new Map(existing.map((e) => [e.code, e]));
  const lockNow = c.status === "LOCKED";
  for (const o of c.outcomes) {
    const e = existingByCode.get(o.code);
    const fields = {
      labelBn: o.labelBn,
      labelEn: o.labelEn,
      sourceText: o.sourceText,
      nctbCode: o.nctbCode,
      questionTypeCodes: o.questionTypeCodes,
      homeTipBn: o.homeTipBn,
      order: o.order,
    };
    if (!e) {
      await MasteryOutcome.create({
        code: o.code,
        classToken: c.classToken,
        subject: c.subject,
        chapterNumber: o.chapterNumber,
        strand: o.strand,
        assess: o.assess,
        bookRef: c.bookRef,
        ...fields,
        status: lockNow ? "LOCKED" : "DRAFT",
        ...(lockNow ? { lockedAt: now, lockedBy: by } : {}),
      });
      continue;
    }
    const set: Record<string, unknown> = { ...fields, bookRef: c.bookRef ?? e.bookRef };
    if (e.status === "DRAFT") {
      set.assess = o.assess;
      if (lockNow) Object.assign(set, { status: "LOCKED", lockedAt: now, lockedBy: by });
    }
    await MasteryOutcome.updateOne({ _id: e._id }, { $set: set });
  }
  if (diff.removedDrafts.length > 0) await MasteryOutcome.deleteMany({ code: { $in: diff.removedDrafts }, status: "DRAFT" });
  if (diff.retired.length > 0) {
    await MasteryOutcome.updateMany(
      { code: { $in: diff.retired }, status: "LOCKED" },
      { $set: { status: "RETIRED", retiredAt: now, retiredBy: by } },
    );
  }

  void writeAudit({
    eventKind: "MASTERY_CATALOGUE_IMPORTED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "MasteryCatalogue",
    meta: {
      classToken: c.classToken,
      subject: c.subject,
      status: c.status,
      added: diff.added.length,
      changed: diff.changed.length,
      removedDrafts: diff.removedDrafts.length,
      retired: diff.retired.length,
      qtAdded: diff.qtAdded.length,
      qtMarksChanged: diff.qtMarksChanged,
    },
  });
  return { ...base, ok: true, applied: true, errors: [] };
}

type LeanQt = { _id: Types.ObjectId; code: string; labelBn: string; marks?: number | null; answerForm?: string; notes?: string };

/**
 * Chapters + question types of one import (flat or tree). Chapters upsert by number (a dropped
 * chapter turns inactive, never deleted); a marks change appends history (D-#777). Rows that
 * would not change are not written, so an unchanged re-import writes nothing.
 */
async function applyChaptersAndQts(
  c: Pick<CatalogueImport, "classToken" | "subject" | "chapters" | "questionTypes">,
  existingQts: LeanQt[],
  now: Date,
  by: Types.ObjectId | undefined,
): Promise<void> {
  const fileChapters = new Set(c.chapters.map((ch) => ch.number));
  const current = new Map(
    (await MasteryChapter.find({ classToken: c.classToken, subject: c.subject }).lean()).map((ch) => [ch.number, ch]),
  );
  for (const ch of c.chapters) {
    const e = current.get(ch.number);
    if (e && e.titleBn === ch.titleBn && (e.termNote ?? undefined) === ch.termNote && e.active && e.order === ch.number) continue;
    await MasteryChapter.updateOne(
      { classToken: c.classToken, subject: c.subject, number: ch.number },
      { $set: { titleBn: ch.titleBn, termNote: ch.termNote, order: ch.number, active: true } },
      { upsert: true },
    );
  }
  if ([...current.values()].some((ch) => ch.active && !fileChapters.has(ch.number))) {
    await MasteryChapter.updateMany(
      { classToken: c.classToken, subject: c.subject, number: { $nin: [...fileChapters] } },
      { $set: { active: false } },
    );
  }

  const qtByCode = new Map(existingQts.map((q) => [q.code, q]));
  for (const q of c.questionTypes) {
    const e = qtByCode.get(q.code);
    if (!e) {
      await MasteryQuestionType.create({
        classToken: c.classToken,
        subject: c.subject,
        code: q.code,
        labelBn: q.labelBn,
        marks: q.marks,
        answerForm: q.answerForm,
        notes: q.notes,
        active: true,
        history: q.marks === null ? [] : [{ marks: q.marks, from: now, by }],
      });
      continue;
    }
    const marksChanged = (e.marks ?? null) !== (q.marks ?? null);
    if (!marksChanged && e.labelBn === q.labelBn && (e.answerForm ?? undefined) === q.answerForm && (e.notes ?? undefined) === q.notes) continue;
    const update: Record<string, unknown> = { $set: { labelBn: q.labelBn, answerForm: q.answerForm, notes: q.notes } };
    if (marksChanged) {
      (update.$set as Record<string, unknown>).marks = q.marks;
      if (q.marks !== null) update.$push = { history: { marks: q.marks, from: now, by } };
    }
    await MasteryQuestionType.updateOne({ _id: e._id }, update);
  }
}

// ---------------------------------------------------------------------------
// Tree import (prd-objective-tree §6, OT-1)
// ---------------------------------------------------------------------------

const treePreviewBase = (tree: TreeFile, domainCount: number): TreeImportPreview => ({
  format: tree.format,
  counts: {
    domains: domainCount,
    objectives: tree.nodes.filter((n) => n.level === "OBJECTIVE" && !n.strand).length,
    subs: tree.nodes.filter((n) => n.level === "SUB").length,
    strands: tree.nodes.filter((n) => n.level === "OBJECTIVE" && n.strand).length,
    tagged: tree.nodes.filter((n) => n.tagged).length,
    grouping: tree.nodes.filter((n) => !n.tagged).length,
  },
  coverage: tree.coverage,
  flags: tree.flags.map((f) => ({ code: f.code, kind: f.kind, text: f.text, ownerRuling: f.ownerRuling })),
  domains: { added: [], changed: [], unchanged: 0 },
  round: { action: "NONE", round: null },
  review: { kept: 0, backToProposed: [], removedInRedraft: [], lockedChanged: [] },
  violations: [],
  noop: false,
});

/**
 * Dry-run or apply a `scd-objective-tree/1` file (+ its subject's domains file, or the domains
 * already imported for that subject). The file must pass `checkTreeInvariants` (FILE mode — the
 * same function as skills/_tools/verify_objective_tree.mjs) and the catalogue as it would stand
 * afterwards must pass it in REVIEW mode. Apply writes DRAFT rows (`reviewState: PROPOSED`) and
 * opens one OPEN `MasteryCatalogueReview` round — or redrafts the open one in place.
 */
async function importTree(raw: unknown, domainsJson: string | null, apply: boolean, actor: Actor): Promise<ImportReport> {
  const read = readTreeFile(raw);
  if (!read.ok) return failReport(read.errors);
  const tree = read.tree;
  const errors: string[] = [];
  if (!(MASTERY_CLASS_TOKENS as readonly string[]).includes(tree.classToken)) errors.push(`অজানা শ্রেণি: "${tree.classToken}"`);
  if (!(MASTERY_SUBJECTS as readonly string[]).includes(tree.subject)) errors.push(`অজানা বিষয়: "${tree.subject}"`);
  const chapterNos = new Set(tree.chapters.map((c) => c.number));
  for (const n of tree.nodes) {
    if (n.chapterNumber !== null && !chapterNos.has(n.chapterNumber)) errors.push(`${n.code}: অধ্যায় ${n.chapterNumber} অধ্যায়-তালিকায় নেই`);
  }
  if (errors.length > 0) return failReport(errors);
  const classToken = tree.classToken as MasteryClassToken;
  const subject = tree.subject as MasterySubject;

  // Domains: the file given now, else what this subject already holds.
  let domainsFile: DomainsFile | null = null;
  if (domainsJson && domainsJson.trim()) {
    let rawDomains: unknown;
    try {
      rawDomains = JSON.parse(domainsJson);
    } catch {
      return failReport(["ক্ষেত্রের (ডোমেইন) JSON পড়া যায়নি।"]);
    }
    const d = readDomainsFile(rawDomains);
    if (!d.ok) return failReport(d.errors);
    if (d.domains.subject !== subject) return failReport([`ক্ষেত্রের ফাইল ${d.domains.subject}-এর, তালিকা ${subject}-এর।`]);
    domainsFile = d.domains;
  }
  const existingDomains = await MasteryDomain.find({ subject }).lean();
  if (!domainsFile && existingDomains.length === 0) {
    return failReport([`${subject}-এর ক্ষেত্রের তালিকা (domains/${subject}.json) এখনো আসেনি — ফাইলটিও দিন।`]);
  }
  const domainCodes = new Set([...existingDomains.filter((d) => d.active).map((d) => d.code), ...(domainsFile?.domains ?? []).map((d) => d.code)]);
  const preview = treePreviewBase(tree, domainsFile ? domainsFile.domains.length : existingDomains.length);
  if (domainsFile) {
    const byCode = new Map(existingDomains.map((d) => [d.code, d]));
    for (const d of domainsFile.domains) {
      const e = byCode.get(d.code);
      if (!e) preview.domains.added.push(d.code);
      else if (e.labelBn !== d.labelBn || (e.labelEn ?? null) !== d.labelEn || e.order !== d.order || (e.note ?? null) !== d.note || !e.active) {
        preview.domains.changed.push(d.code);
      } else preview.domains.unchanged += 1;
    }
  }

  // Prerequisites may name live codes of the same subject in an EARLIER class.
  const myIdx = (MASTERY_CLASS_TOKENS as readonly string[]).indexOf(classToken);
  const earlier = (MASTERY_CLASS_TOKENS as readonly string[]).slice(0, Math.max(0, myIdx));
  const externalCodes = earlier.length
    ? (await MasteryOutcome.find({ subject, classToken: { $in: earlier }, status: { $ne: "RETIRED" } }).select("code").lean()).map((o) => o.code)
    : [];

  const fileViolations = checkTreeInvariants({
    classToken,
    subject,
    nodes: tree.nodes,
    domainCodes,
    mode: "FILE",
    questionTypeCodes: tree.questionTypes.map((q) => q.code),
    coverage: tree.coverage,
    externalCodes,
  }).map(formatTreeViolation);
  if (fileViolations.length > 0) {
    preview.violations = fileViolations;
    return { ...failReport(fileViolations, preview), classToken, subject, status: "DRAFT" };
  }

  const [existing, existingQts, latest] = await Promise.all([
    MasteryOutcome.find({ classToken, subject }).lean<IMasteryOutcome[]>(),
    MasteryQuestionType.find({ classToken, subject }).lean(),
    latestReviewRound(classToken, subject),
  ]);
  const existingRows: ExistingTreeRow[] = existing.map((e) => ({
    code: e.code,
    status: e.status,
    assess: e.assess,
    chapterNumber: e.chapterNumber ?? null,
    strand: e.strand ?? null,
    labelBn: e.labelBn,
    labelEn: e.labelEn,
    sourceText: e.sourceText,
    questionTypeCodes: e.questionTypeCodes,
    homeTipBn: e.homeTipBn,
    level: e.level,
    parentCode: e.parentCode,
    domainCode: e.domainCode,
    tagged: e.tagged,
    prereqCodes: e.prereqCodes,
    reviewState: e.reviewState,
    rejectReason: e.rejectReason,
    mergedInto: e.mergedInto,
    draftHash: e.draftHash,
    bookRef: e.bookRef,
    order: e.order,
  }));
  const plan = planTreeImport(tree, existingRows, latest ? { round: latest.round, state: latest.state } : null);
  const merged = plan.errors.length === 0 ? mergedTreeViolations(tree, existingRows, plan, domainCodes, externalCodes) : [];

  // The question-type table + chapters, as a flat catalogue would carry them (marks parsed from marksBn).
  const asCatalogue: CatalogueImport = {
    classToken,
    subject,
    status: "DRAFT",
    bookRef: tree.source.book ?? undefined,
    chapters: tree.chapters.map((c) => ({ number: c.number, titleBn: c.titleBn })),
    outcomes: [],
    questionTypes: tree.questionTypes.map((q) => ({
      code: q.code,
      labelBn: q.labelBn || q.code,
      marks: q.marks,
      notes: [q.marksBn, q.examUse].filter(Boolean).join(" · ") || undefined,
    })),
  };
  const qtDiff = diffCatalogue(asCatalogue, [], existingQts.map((q) => ({ code: q.code, labelBn: q.labelBn, marks: q.marks ?? null })));
  const diff: CatalogueDiff = {
    ...qtDiff,
    added: plan.create.map((r) => r.code),
    changed: [
      ...plan.backToProposed.map((r) => ({ code: r.code, fields: ["content"] })),
      ...plan.lockedUpdates.map((r) => ({ code: r.code, fields: Object.keys(r.fields).filter((k) => k !== "draftHash") })),
    ],
    unchanged: plan.kept,
    removedDrafts: plan.deleteFlatDrafts,
    retired: plan.retire,
    errors: [...plan.errors, ...merged],
  };
  preview.round = { action: plan.roundAction, round: plan.roundNumber };
  preview.review = {
    kept: plan.kept,
    backToProposed: plan.backToProposed.map((r) => r.code),
    removedInRedraft: plan.removedInRedraft,
    lockedChanged: plan.lockedUpdates.map((r) => r.code),
  };
  preview.violations = merged;
  const coverageSame =
    !!latest &&
    latest.coverage?.exercisesTotal === tree.coverage.exercisesTotal &&
    latest.coverage?.mapped === tree.coverage.mapped &&
    JSON.stringify((latest.coverage?.unmapped ?? []).map((u) => [u.ref, u.text, u.reason])) ===
      JSON.stringify(tree.coverage.unmapped.map((u) => [u.ref, u.text, u.reason])) &&
    JSON.stringify((latest.flags ?? []).map((f) => [f.code ?? null, f.kind, f.text, f.ownerRuling ?? null])) ===
      JSON.stringify(tree.flags.map((f) => [f.code, f.kind, f.text, f.ownerRuling]));
  preview.noop =
    plan.noop &&
    preview.domains.added.length === 0 &&
    preview.domains.changed.length === 0 &&
    qtDiff.qtAdded.length === 0 &&
    qtDiff.qtMarksChanged.length === 0 &&
    qtDiff.qtLabelChanged.length === 0 &&
    (plan.roundAction === "NONE" || (plan.roundAction === "REDRAFT" && coverageSame && latest?.state === "OPEN"));

  const base = { classToken, subject, status: "DRAFT", diff, tree: preview };
  if (diff.errors.length > 0) return { ...base, ok: false, applied: false, errors: diff.errors };
  if (!apply) return { ...base, ok: true, applied: false, errors: [] };
  if (preview.noop) return { ...base, ok: true, applied: true, errors: [] };

  const now = new Date();
  const by = actorOid(actor);

  // Domains — upsert; a LOCKED domain keeps its code and only takes label / note / order.
  if (domainsFile) {
    for (const d of domainsFile.domains) {
      if (!preview.domains.added.includes(d.code) && !preview.domains.changed.includes(d.code)) continue;
      await MasteryDomain.updateOne(
        { code: d.code },
        {
          $set: { labelBn: d.labelBn, labelEn: d.labelEn ?? undefined, order: d.order, note: d.note ?? undefined, active: true },
          $setOnInsert: { subject, status: "DRAFT" },
        },
        { upsert: true },
      );
    }
  }
  await applyChaptersAndQts(asCatalogue, existingQts, now, by);

  // The round: redraft the open one in place, or open the next.
  let reviewId: Types.ObjectId | null = null;
  const roundFields = {
    coverage: tree.coverage,
    flags: tree.flags.map((f) => ({ code: f.code, kind: f.kind, text: f.text, ownerRuling: f.ownerRuling, ruledOn: f.ruledOn })),
    source: tree.source,
    importedAt: now,
    importedBy: by,
  };
  if (plan.roundAction === "REDRAFT" && latest) {
    reviewId = latest._id;
    await MasteryCatalogueReview.updateOne({ _id: latest._id }, { $set: { ...roundFields, state: "OPEN" }, $unset: { submittedAt: 1 } });
  } else if (plan.roundAction === "OPEN_NEW") {
    const created = await MasteryCatalogueReview.create({ classToken, subject, round: plan.roundNumber, state: "OPEN", ...roundFields });
    reviewId = created._id;
  }

  const existingByCode = new Map(existing.map((e) => [e.code, e]));
  const events: ReviewEventInput[] = [];
  const snapshot = (e: IMasteryOutcome | undefined) =>
    e ? { labelBn: e.labelBn, reviewState: e.reviewState ?? null, ...treeShapeOf(e) } : null;
  for (const r of plan.create) {
    await MasteryOutcome.create({ code: r.code, classToken, subject, ...r.fields, status: "DRAFT", reviewState: "PROPOSED" });
    if (reviewId && plan.roundAction === "REDRAFT") events.push({ reviewId, code: r.code, action: "IMPORT", before: null, after: { reviewState: "PROPOSED", labelBn: r.fields.labelBn } });
  }
  for (const r of plan.backToProposed) {
    const before = existingByCode.get(r.code);
    await MasteryOutcome.updateOne(
      { code: r.code, status: "DRAFT" },
      { $set: { ...r.fields, reviewState: "PROPOSED" }, $unset: { rejectReason: 1, mergedInto: 1 } },
    );
    if (reviewId) events.push({ reviewId, code: r.code, action: "IMPORT", before: snapshot(before), after: { reviewState: "PROPOSED", labelBn: r.fields.labelBn } });
  }
  for (const r of plan.lockedUpdates) await MasteryOutcome.updateOne({ code: r.code, status: "LOCKED" }, { $set: r.fields });
  for (const r of plan.reorder) await MasteryOutcome.updateOne({ code: r.code }, { $set: { order: r.order } });
  if (plan.removedInRedraft.length > 0) {
    await MasteryOutcome.updateMany(
      { code: { $in: plan.removedInRedraft }, status: "DRAFT" },
      { $set: { reviewState: "REJECTED", rejectReason: REMOVED_IN_REDRAFT } },
    );
    for (const code of plan.removedInRedraft) {
      if (reviewId) events.push({ reviewId, code, action: "IMPORT", before: snapshot(existingByCode.get(code)), after: { reviewState: "REJECTED", rejectReason: REMOVED_IN_REDRAFT } });
    }
  }
  if (plan.deleteFlatDrafts.length > 0) await MasteryOutcome.deleteMany({ code: { $in: plan.deleteFlatDrafts }, status: "DRAFT", reviewState: { $exists: false } });
  if (plan.retire.length > 0) {
    await MasteryOutcome.updateMany({ code: { $in: plan.retire }, status: "LOCKED" }, { $set: { status: "RETIRED", retiredAt: now, retiredBy: by } });
  }
  if (reviewId) {
    events.unshift({
      reviewId,
      code: null,
      action: "IMPORT",
      after: {
        roundAction: plan.roundAction,
        added: plan.create.length,
        backToProposed: plan.backToProposed.length,
        removedInRedraft: plan.removedInRedraft.length,
        kept: plan.kept,
        book: tree.source.book,
      },
    });
    await appendReviewEvents(events, actor, now);
  }

  void writeAudit({
    eventKind: "MASTERY_CATALOGUE_IMPORTED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "MasteryCatalogue",
    meta: {
      classToken,
      subject,
      format: tree.format,
      round: plan.roundNumber,
      roundAction: plan.roundAction,
      added: plan.create.length,
      backToProposed: plan.backToProposed.length,
      removedInRedraft: plan.removedInRedraft.length,
      lockedChanged: plan.lockedUpdates.length,
      retired: plan.retire.length,
      domainsAdded: preview.domains.added.length,
    },
  });
  return { ...base, ok: true, applied: true, errors: [] };
}

// ---------------------------------------------------------------------------
// Lock / edit / retire
// ---------------------------------------------------------------------------

/** DRAFT → LOCKED for one class × subject. Codes become permanent (D-#776). */
export async function lockCatalogue(classToken: MasteryClassToken, subject: MasterySubject, actor: Actor): Promise<number> {
  // A tree under review is locked by the Principal behind the review gate (OT-2), never by this
  // one-tap lock — it would also lock rows the reviewer rejected.
  if (await openReviewRound(classToken, subject)) {
    throw new MasteryCatalogueError("এই তালিকা পর্যালোচনায় আছে — পর্যালোচনা শেষে “চূড়ান্ত করুন” থেকে লক হবে।");
  }
  const res = await MasteryOutcome.updateMany(
    { classToken, subject, status: "DRAFT" },
    { $set: { status: "LOCKED", lockedAt: new Date(), lockedBy: actorOid(actor) } },
  );
  if (res.modifiedCount > 0) {
    void writeAudit({
      eventKind: "MASTERY_CATALOGUE_LOCKED",
      actorId: actor.userId,
      actorRole: actor.role,
      targetKind: "MasteryCatalogue",
      meta: { classToken, subject, locked: res.modifiedCount },
    });
  }
  return res.modifiedCount;
}

export interface OutcomeEdit {
  labelBn?: string | null;
  labelEn?: string | null;
  homeTipBn?: string | null;
  sourceText?: string | null;
  questionTypeCodes?: string[] | null;
  /** D-#1161: set after the review (the review judges tags only, D-#1160); refused once evidence exists. */
  assess?: string | null;
}

/**
 * Edit what may change on any live outcome: label, home tip, source text, question types, and —
 * on a tagged row with no evidence yet — Question / Rubric (D-#1161).
 */
export async function saveOutcome(code: string, edit: OutcomeEdit, actor: Actor): Promise<OutcomeView> {
  const o = await MasteryOutcome.findOne({ code });
  if (!o) throw new MasteryCatalogueError("এই শিখনফল পাওয়া যায়নি।");
  if (o.status === "RETIRED") throw new MasteryCatalogueError("অবসরে যাওয়া শিখনফল বদলানো যায় না।");
  if (edit.assess !== undefined && edit.assess !== null && edit.assess !== o.assess) {
    if (edit.assess !== "QUESTION" && edit.assess !== "RUBRIC") throw new MasteryCatalogueError("যাচাই হবে প্রশ্ন বা রুব্রিক।");
    if (o.tagged === false) throw new MasteryCatalogueError("এটি দলের শিরোনাম — প্রশ্ন না রুব্রিক তা এর ভেতরের প্রতিটি সারিতে ঠিক হয়।");
    // Marks and rubric steps are different scales; one code must never hold both (D-#1161).
    if (await MasteryEvidence.exists({ loCode: code, supersededAt: { $exists: false } })) {
      throw new MasteryCatalogueError("এই শিখনফলে ছাত্রছাত্রীদের ফল জমা আছে — এখন প্রশ্ন/রুব্রিক বদলানো যায় না।");
    }
    o.assess = edit.assess;
  }
  if (edit.labelBn !== undefined && edit.labelBn !== null) {
    if (!edit.labelBn.trim()) throw new MasteryCatalogueError("লেবেল খালি রাখা যায় না।");
    o.labelBn = edit.labelBn.trim();
  }
  if (edit.labelEn !== undefined) o.labelEn = edit.labelEn?.trim() || undefined;
  if (edit.homeTipBn !== undefined) o.homeTipBn = edit.homeTipBn?.trim() || undefined;
  if (edit.sourceText !== undefined && edit.sourceText !== null) o.sourceText = edit.sourceText.trim();
  if (edit.questionTypeCodes) {
    const table = await MasteryQuestionType.find({ classToken: o.classToken, subject: o.subject }).select("code active").lean();
    const defined = new Set(table.map((q) => q.code));
    const missing = edit.questionTypeCodes.filter((q) => !defined.has(q));
    if (missing.length > 0) throw new MasteryCatalogueError(`এই প্রশ্নের ধরন তালিকায় নেই: ${missing.join(", ")}`);
    // A switched-off type stays where it already is, but is never newly given (owner rule 2026-11-08).
    const off = new Set(table.filter((q) => q.active === false).map((q) => q.code));
    const had = new Set(o.questionTypeCodes ?? []);
    const newlyOff = edit.questionTypeCodes.filter((q) => off.has(q) && !had.has(q));
    if (newlyOff.length > 0) throw new MasteryCatalogueError(`এই প্রশ্নের ধরন বন্ধ আছে: ${newlyOff.join(", ")}`);
    o.questionTypeCodes = [...new Set(edit.questionTypeCodes)];
  }
  await o.save();
  void writeAudit({
    eventKind: "MASTERY_OUTCOME_SAVED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "MasteryOutcome",
    targetId: o._id,
    meta: { code, fields: Object.keys(edit).filter((k) => (edit as Record<string, unknown>)[k] !== undefined) },
  });
  return outcomeView(o);
}

/** LOCKED → RETIRED (kept, never deleted). A DRAFT row is simply removed — nothing can reference it. */
export async function retireOutcome(code: string, actor: Actor): Promise<string> {
  const o = await MasteryOutcome.findOne({ code });
  if (!o) throw new MasteryCatalogueError("এই শিখনফল পাওয়া যায়নি।");
  if (o.status === "RETIRED") throw new MasteryCatalogueError("এটি আগেই অবসরে গেছে।");
  if (o.status === "DRAFT" && o.reviewState) {
    throw new MasteryCatalogueError("খসড়া বৃক্ষের সারি পর্যালোচনায় বাদ দিন — মুছে ফেললে পর্যালোচনার রেকর্ড ভাঙে।");
  }
  if (o.status === "DRAFT") {
    await MasteryOutcome.deleteOne({ _id: o._id, status: "DRAFT" });
  } else {
    o.status = "RETIRED";
    o.retiredAt = new Date();
    o.retiredBy = actorOid(actor);
    await o.save();
  }
  void writeAudit({
    eventKind: "MASTERY_OUTCOME_RETIRED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "MasteryOutcome",
    targetId: o._id,
    meta: { code, wasDraft: o.status !== "RETIRED" },
  });
  return o.status === "RETIRED" ? "RETIRED" : "DELETED";
}

// ---------------------------------------------------------------------------
// Question-type marks
// ---------------------------------------------------------------------------

export interface QuestionTypeInput {
  classToken: MasteryClassToken;
  subject: MasterySubject;
  code: string;
  labelBn: string;
  marks: number | null;
  answerForm?: string | null;
  notes?: string | null;
  active?: boolean | null;
}

export async function saveQuestionType(input: QuestionTypeInput, actor: Actor): Promise<QuestionTypeView> {
  if (!/^QT-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(input.code)) throw new MasteryCatalogueError("প্রশ্নের ধরনের কোড QT- দিয়ে শুরু করুন (যেমন QT-WORD)।");
  if (!input.labelBn.trim()) throw new MasteryCatalogueError("প্রশ্নের ধরনের নাম লিখুন।");
  if (input.marks !== null && !(Number.isFinite(input.marks) && input.marks >= 0 && Math.round(input.marks * 2) === input.marks * 2)) {
    throw new MasteryCatalogueError("নম্বর ০ বা তার বেশি, ০.৫-এর ধাপে দিন।");
  }
  const now = new Date();
  const by = actorOid(actor);
  const existing = await MasteryQuestionType.findOne({ classToken: input.classToken, subject: input.subject, code: input.code });
  let doc;
  if (!existing) {
    doc = await MasteryQuestionType.create({
      classToken: input.classToken,
      subject: input.subject,
      code: input.code,
      labelBn: input.labelBn.trim(),
      marks: input.marks,
      answerForm: input.answerForm ?? undefined,
      notes: input.notes ?? undefined,
      active: input.active ?? true,
      history: input.marks === null ? [] : [{ marks: input.marks, from: now, by }],
    });
  } else {
    const marksChanged = (existing.marks ?? null) !== (input.marks ?? null);
    existing.labelBn = input.labelBn.trim();
    if (input.answerForm !== undefined) existing.answerForm = input.answerForm ?? undefined;
    if (input.notes !== undefined) existing.notes = input.notes ?? undefined;
    if (input.active !== undefined && input.active !== null) existing.active = input.active;
    if (marksChanged) {
      existing.marks = input.marks;
      if (input.marks !== null) existing.history.push({ marks: input.marks, from: now, by });
    }
    doc = await existing.save();
  }
  void writeAudit({
    eventKind: "MASTERY_QT_SAVED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "MasteryQuestionType",
    targetId: doc._id,
    meta: { classToken: input.classToken, subject: input.subject, code: input.code, marks: input.marks },
  });
  return {
    code: doc.code,
    labelBn: doc.labelBn,
    marks: doc.marks ?? null,
    answerForm: doc.answerForm ?? null,
    notes: doc.notes ?? null,
    active: doc.active,
    history: (doc.history ?? []).map((h) => ({ marks: h.marks, from: new Date(h.from).toISOString() })),
  };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** The seed (D-#778/#787). Routing tags start OFF — they need a scope whose catalogue has the strand. */
export const DEFAULT_TAGS: (Omit<TagInput, "order"> & { order: number })[] = [
  { code: "CONCEPT_GAP", labelBn: "ধারণায় ঘাটতি", appliesTo: "ITEM", effect: "WEAK", allScopes: true, scopes: [], active: true, order: 1 },
  { code: "CARELESS", labelBn: "অসাবধানী ভুল", appliesTo: "ITEM", effect: "LIGHT", allScopes: true, scopes: [], active: true, order: 2 },
  { code: "NOT_ATTEMPTED", labelBn: "চেষ্টা করেনি", appliesTo: "ITEM", effect: "WEAK", allScopes: true, scopes: [], active: true, order: 3 },
  {
    code: "NO_ANSWER_SENTENCE", labelBn: "উত্তর-বাক্য নেই", appliesTo: "ITEM", effect: "ROUTE_STRAND",
    routeStrand: "ANS", routeSeq: 1, level: "ITEM", questionTypeCodes: ["QT-WORD", "QT-CREATIVE"], deductionMarks: 0.5,
    allScopes: false, scopes: [], active: false, order: 4,
  },
  {
    code: "HANDWRITING_UNCLEAR", labelBn: "হাতের লেখা অস্পষ্ট", appliesTo: "WORK", effect: "ROUTE_STRAND",
    routeStrand: "HW", routeSeq: 1, level: "WORK", questionTypeCodes: [], allScopes: false, scopes: [], active: false, order: 5,
  },
  { code: "ABSENT", labelBn: "অনুপস্থিত", appliesTo: "WORK", effect: "NO_EVIDENCE", allScopes: true, scopes: [], active: true, order: 6 },
  { code: "NOT_SUBMITTED", labelBn: "জমা দেয়নি", appliesTo: "WORK", effect: "NO_EVIDENCE", allScopes: true, scopes: [], active: true, order: 7 },
  { code: "COPIED", labelBn: "নকল করেছে", appliesTo: "BOTH", effect: "VOID_BEHAVIOUR", allScopes: true, scopes: [], active: true, order: 8 },
];

/** Insert any missing seed tag; never touches a tag that exists (the admin may have edited it). */
export async function ensureDefaultTags(): Promise<void> {
  for (const t of DEFAULT_TAGS) {
    await MasteryTag.updateOne({ code: t.code }, { $setOnInsert: { ...t, system: true } }, { upsert: true });
  }
}

export interface TagView {
  code: string;
  labelBn: string;
  appliesTo: string;
  effect: string;
  routeStrand: string | null;
  routeSeq: number | null;
  level: string | null;
  questionTypeCodes: string[];
  deductionMarks: number | null;
  allScopes: boolean;
  scopes: { classToken: string; subject: string }[];
  system: boolean;
  active: boolean;
  order: number;
}

export async function listTags(): Promise<TagView[]> {
  await ensureDefaultTags();
  const rows = await MasteryTag.find({}).sort({ order: 1, code: 1 }).lean();
  return rows.map((t) => ({
    code: t.code,
    labelBn: t.labelBn,
    appliesTo: t.appliesTo,
    effect: t.effect,
    routeStrand: t.routeStrand ?? null,
    routeSeq: t.routeSeq ?? null,
    level: t.level ?? null,
    questionTypeCodes: t.questionTypeCodes ?? [],
    deductionMarks: t.deductionMarks ?? null,
    allScopes: t.allScopes,
    scopes: (t.scopes ?? []).map((s) => ({ classToken: s.classToken, subject: s.subject })),
    system: t.system,
    active: t.active,
    order: t.order,
  }));
}

export async function saveTag(input: TagInput, actor: Actor): Promise<TagView> {
  const live = await MasteryOutcome.find({ status: { $ne: "RETIRED" } }).select("code").lean();
  const qts = await MasteryQuestionType.find({}).select("classToken subject code").lean();
  const qtByScope = new Map<string, Set<string>>();
  for (const q of qts) {
    const k = `${q.classToken}:${q.subject}`;
    if (!qtByScope.has(k)) qtByScope.set(k, new Set());
    qtByScope.get(k)!.add(q.code);
  }
  const complaint = validateTagInput(input, new Set(live.map((o) => o.code)), qtByScope);
  if (complaint) throw new MasteryCatalogueError(complaint);
  const isRoute = input.effect === "ROUTE_STRAND";
  const existing = await MasteryTag.findOne({ code: input.code }).lean();
  const order = input.order ?? existing?.order ?? (await MasteryTag.countDocuments({})) + 1;
  await MasteryTag.updateOne(
    { code: input.code },
    {
      $set: {
        labelBn: input.labelBn.trim(),
        appliesTo: input.appliesTo,
        effect: input.effect,
        routeStrand: isRoute ? input.routeStrand?.trim() : undefined,
        routeSeq: isRoute ? input.routeSeq ?? 1 : undefined,
        level: isRoute ? input.level : undefined,
        questionTypeCodes: isRoute && input.level === "ITEM" ? [...new Set(input.questionTypeCodes ?? [])] : [],
        deductionMarks: isRoute ? input.deductionMarks ?? undefined : undefined,
        allScopes: input.allScopes,
        scopes: input.allScopes ? [] : input.scopes,
        active: input.active,
        order,
        updatedBy: actorOid(actor),
      },
      $setOnInsert: { system: false },
    },
    { upsert: true },
  );
  void writeAudit({
    eventKind: "MASTERY_TAG_SAVED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "MasteryTag",
    meta: { code: input.code, effect: input.effect, active: input.active, scopes: input.scopes },
  });
  const all = await listTags();
  return all.find((t) => t.code === input.code)!;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface PolicyView {
  scopeKey: string;
  resolved: MasteryPolicyValues;
  /** The keys this scope's own row sets (empty for an override that inherits everything). */
  ownKeys: string[];
}

export async function getPolicy(classToken?: MasteryClassToken | null, subject?: MasterySubject | null): Promise<PolicyView> {
  const key = policyScopeKey(classToken, subject);
  const school = await MasteryPolicy.findOne({ scopeKey: "SCHOOL" }).lean();
  const own = key === "SCHOOL" ? school : await MasteryPolicy.findOne({ scopeKey: key }).lean();
  const resolved = resolvePolicy(school?.values, key === "SCHOOL" ? null : own?.values);
  return { scopeKey: key, resolved, ownKeys: Object.keys(own?.values ?? {}) };
}

/**
 * Save the school row, or one class × subject override. `values` replaces the scope's own
 * keys wholesale (send {} to make an override inherit everything again). Validated on the
 * RESOLVED result, so an override cannot create an inconsistent set with what it inherits.
 */
export async function savePolicy(
  classToken: MasteryClassToken | null,
  subject: MasterySubject | null,
  values: Record<string, unknown>,
  actor: Actor,
): Promise<PolicyView> {
  const key = policyScopeKey(classToken, subject);
  const clean = cleanPolicyValues(values);
  const school = await MasteryPolicy.findOne({ scopeKey: "SCHOOL" }).lean();
  const resolved = key === "SCHOOL" ? resolvePolicy(clean, null) : resolvePolicy(school?.values, clean);
  const complaint = validatePolicy(resolved);
  if (complaint) throw new MasteryCatalogueError(complaint);
  if (key === "SCHOOL") {
    // A school change must not break an existing override's inherited consistency.
    const overrides = await MasteryPolicy.find({ scopeKey: { $ne: "SCHOOL" } }).lean();
    for (const ov of overrides) {
      const bad = validatePolicy(resolvePolicy(clean, ov.values));
      if (bad) throw new MasteryCatalogueError(`${ov.scopeKey}-এর আলাদা পলিসির সাথে মেলে না: ${bad}`);
    }
  }
  await MasteryPolicy.updateOne(
    { scopeKey: key },
    {
      $set: { values: clean, updatedBy: actorOid(actor), classToken: classToken ?? undefined, subject: subject ?? undefined },
    },
    { upsert: true },
  );
  void writeAudit({
    eventKind: "MASTERY_POLICY_SAVED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "MasteryPolicy",
    meta: { scopeKey: key, values: clean },
  });
  return getPolicy(classToken, subject);
}

// ---------------------------------------------------------------------------
// Domains (D-#921)
// ---------------------------------------------------------------------------

export interface DomainView {
  code: string;
  subject: string;
  labelBn: string;
  labelEn: string | null;
  order: number;
  active: boolean;
  status: string;
  note: string | null;
}

export async function listDomains(subject: MasterySubject): Promise<DomainView[]> {
  const rows = await MasteryDomain.find({ subject }).sort({ order: 1, code: 1 }).lean();
  return rows.map((d) => ({
    code: d.code,
    subject: d.subject,
    labelBn: d.labelBn,
    labelEn: d.labelEn ?? null,
    order: d.order,
    active: d.active,
    status: d.status,
    note: d.note ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Level names (D-#923) — on the SCHOOL policy row
// ---------------------------------------------------------------------------

export interface LevelLabelsView {
  resolved: MasteryLevelLabels;
  /** Keys the school changed from the defaults. */
  ownKeys: string[];
}

export async function getLevelLabels(): Promise<LevelLabelsView> {
  const school = await MasteryPolicy.findOne({ scopeKey: "SCHOOL" }).select("levelLabels").lean();
  const stored = (school?.levelLabels ?? {}) as Partial<MasteryLevelLabels>;
  return { resolved: resolveLevelLabels(stored), ownKeys: LEVEL_LABEL_KEYS.filter((k) => typeof stored[k] === "string") };
}

/**
 * Save the level names. Keys sent replace the stored ones; a blank value (or the default word)
 * returns that key to the default. Every surface reads the result live — no deploy.
 */
export async function saveLevelLabels(input: Partial<Record<keyof MasteryLevelLabels, string | null>>, actor: Actor): Promise<LevelLabelsView> {
  const school = await MasteryPolicy.findOne({ scopeKey: "SCHOOL" }).select("levelLabels").lean();
  const next: Partial<MasteryLevelLabels> = { ...((school?.levelLabels ?? {}) as Partial<MasteryLevelLabels>) };
  const defaults = resolveLevelLabels(null);
  for (const k of LEVEL_LABEL_KEYS) {
    if (!(k in input) || input[k] === undefined) continue;
    const v = (input[k] ?? "").trim();
    if (v.length > 40) throw new MasteryCatalogueError("স্তরের নাম ৪০ অক্ষরের মধ্যে রাখুন।");
    if (!v || v === defaults[k]) delete next[k];
    else next[k] = v;
  }
  const r = resolveLevelLabels(next);
  if (new Set([r.domainBn, r.objectiveBn, r.subBn]).size < 3 || new Set([r.domainEn, r.objectiveEn, r.subEn]).size < 3) {
    throw new MasteryCatalogueError("তিনটি স্তরের নাম আলাদা হতে হবে।");
  }
  await MasteryPolicy.updateOne(
    { scopeKey: "SCHOOL" },
    { $set: { levelLabels: next, updatedBy: actorOid(actor) }, $setOnInsert: { values: {} } },
    { upsert: true },
  );
  void writeAudit({
    eventKind: "MASTERY_LEVEL_LABELS_SAVED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "MasteryPolicy",
    meta: { levelLabels: next },
  });
  return getLevelLabels();
}

// ---------------------------------------------------------------------------
// The switch (D-#775)
// ---------------------------------------------------------------------------

export interface EnablementView {
  academicYearId: string;
  classToken: string;
  subject: string;
  enabled: boolean;
  changedAt: string;
}

export async function listEnablements(academicYearId: string): Promise<EnablementView[]> {
  if (!Types.ObjectId.isValid(academicYearId)) return [];
  const rows = await MasteryEnablement.find({ academicYearId: new Types.ObjectId(academicYearId) })
    .sort({ classToken: 1, subject: 1 })
    .lean();
  return rows.map((r) => ({
    academicYearId: String(r.academicYearId),
    classToken: r.classToken,
    subject: r.subject,
    enabled: r.enabled,
    changedAt: new Date(r.changedAt).toISOString(),
  }));
}

export async function setEnablement(
  academicYearId: string,
  classToken: MasteryClassToken,
  subject: MasterySubject,
  enabled: boolean,
  actor: Actor,
): Promise<EnablementView> {
  if (!Types.ObjectId.isValid(academicYearId) || !(await AcademicYear.exists({ _id: academicYearId }))) {
    throw new MasteryCatalogueError("শিক্ষাবর্ষ পাওয়া যায়নি।");
  }
  if (enabled) {
    const locked = await MasteryOutcome.countDocuments({ classToken, subject, status: "LOCKED" });
    if (locked === 0) throw new MasteryCatalogueError("আগে এই শ্রেণি-বিষয়ের শিখনফল তালিকা লক করুন — তারপর চালু করা যাবে।");
    // Objective tree (prd-objective-tree §7 "Switch"): a pair with review rounds needs one LOCKED.
    const blocked = await switchBlockedByReview(classToken, subject);
    if (blocked) throw new MasteryCatalogueError(blocked);
  }
  const now = new Date();
  await MasteryEnablement.updateOne(
    { academicYearId: new Types.ObjectId(academicYearId), classToken, subject },
    { $set: { enabled, changedBy: actorOid(actor), changedAt: now } },
    { upsert: true },
  );
  void writeAudit({
    eventKind: "MASTERY_ENABLEMENT_SET",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "MasteryEnablement",
    meta: { academicYearId, classToken, subject, enabled },
  });
  return { academicYearId, classToken, subject, enabled, changedAt: now.toISOString() };
}

/** For later slices: is the module on for this year × class × subject? */
export async function isMasteryEnabled(
  academicYearId: string | Types.ObjectId,
  classToken: MasteryClassToken,
  subject: MasterySubject,
): Promise<boolean> {
  const id = typeof academicYearId === "string" ? academicYearId : String(academicYearId);
  if (!Types.ObjectId.isValid(id)) return false;
  return Boolean(
    await MasteryEnablement.exists({ academicYearId: new Types.ObjectId(id), classToken, subject, enabled: true }),
  );
}
