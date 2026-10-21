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
}

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
export async function importCatalogue(json: string, apply: boolean, actor: Actor): Promise<ImportReport> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, applied: false, classToken: null, subject: null, status: null, errors: ["JSON পড়া যায়নি।"], diff: null };
  }
  const parsed = parseCatalogueImport(raw);
  if (!parsed.ok) {
    return { ok: false, applied: false, classToken: null, subject: null, status: null, errors: parsed.errors, diff: null };
  }
  const c = parsed.catalogue;
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
  const base = { classToken: c.classToken, subject: c.subject, status: c.status, diff };
  if (diff.errors.length > 0) return { ...base, ok: false, applied: false, errors: diff.errors };
  if (!apply) return { ...base, ok: true, applied: false, errors: [] };

  const now = new Date();
  const by = actorOid(actor);

  // Chapters — upsert by number; a chapter the file drops is marked inactive, never deleted.
  const fileChapters = new Set(c.chapters.map((ch) => ch.number));
  for (const ch of c.chapters) {
    await MasteryChapter.updateOne(
      { classToken: c.classToken, subject: c.subject, number: ch.number },
      { $set: { titleBn: ch.titleBn, termNote: ch.termNote, order: ch.number, active: true } },
      { upsert: true },
    );
  }
  await MasteryChapter.updateMany(
    { classToken: c.classToken, subject: c.subject, number: { $nin: [...fileChapters] } },
    { $set: { active: false } },
  );

  // Question types — upsert; a marks change appends history (the snapshot rule, D-#777).
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
    const update: Record<string, unknown> = { $set: { labelBn: q.labelBn, answerForm: q.answerForm, notes: q.notes } };
    if ((e.marks ?? null) !== (q.marks ?? null)) {
      (update.$set as Record<string, unknown>).marks = q.marks;
      if (q.marks !== null) update.$push = { history: { marks: q.marks, from: now, by } };
    }
    await MasteryQuestionType.updateOne({ _id: e._id }, update);
  }

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

// ---------------------------------------------------------------------------
// Lock / edit / retire
// ---------------------------------------------------------------------------

/** DRAFT → LOCKED for one class × subject. Codes become permanent (D-#776). */
export async function lockCatalogue(classToken: MasteryClassToken, subject: MasterySubject, actor: Actor): Promise<number> {
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
}

/** Edit what may change on any live outcome: label, home tip, source text, question types. */
export async function saveOutcome(code: string, edit: OutcomeEdit, actor: Actor): Promise<OutcomeView> {
  const o = await MasteryOutcome.findOne({ code });
  if (!o) throw new MasteryCatalogueError("এই শিখনফল পাওয়া যায়নি।");
  if (o.status === "RETIRED") throw new MasteryCatalogueError("অবসরে যাওয়া শিখনফল বদলানো যায় না।");
  if (edit.labelBn !== undefined && edit.labelBn !== null) {
    if (!edit.labelBn.trim()) throw new MasteryCatalogueError("লেবেল খালি রাখা যায় না।");
    o.labelBn = edit.labelBn.trim();
  }
  if (edit.labelEn !== undefined) o.labelEn = edit.labelEn?.trim() || undefined;
  if (edit.homeTipBn !== undefined) o.homeTipBn = edit.homeTipBn?.trim() || undefined;
  if (edit.sourceText !== undefined && edit.sourceText !== null) o.sourceText = edit.sourceText.trim();
  if (edit.questionTypeCodes) {
    const defined = new Set(
      (await MasteryQuestionType.find({ classToken: o.classToken, subject: o.subject }).select("code").lean()).map((q) => q.code),
    );
    const missing = edit.questionTypeCodes.filter((q) => !defined.has(q));
    if (missing.length > 0) throw new MasteryCatalogueError(`এই প্রশ্নের ধরন তালিকায় নেই: ${missing.join(", ")}`);
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
