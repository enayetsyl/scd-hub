/**
 * Pure catalogue logic for the mastery tracker (M-0, docs/prd-mastery.md §5.1).
 *
 *   parseCatalogueImport — validate the JSON a locked catalogue file converts to
 *   diffCatalogue        — what an import would change, and what it may not change
 *   validateTagInput     — the tag rules, incl. D-#787 routing (strand must exist per scope)
 *   resolvePolicy        — defaults ⊕ school row ⊕ class × subject override
 *   validatePolicy       — ranges and orderings on the RESOLVED values
 *
 * No database here: the service feeds rows in and writes what these return, so every
 * rule is testable without Mongo and cannot be bypassed by a second write path.
 */
import {
  MASTERY_CLASS_TOKENS,
  MASTERY_LO_CODE_RE,
  MASTERY_POLICY_DEFAULTS,
  MASTERY_QT_CODE_RE,
  MASTERY_STRAND_RE,
  MASTERY_SUBJECTS,
  MASTERY_TAG_APPLIES,
  MASTERY_TAG_EFFECTS,
  MASTERY_ROUTE_LEVELS,
  parseMasteryLoCode,
} from "@scd/shared";
import type {
  MasteryAssess,
  MasteryClassToken,
  MasteryOutcomeStatus,
  MasteryPolicyValues,
  MasteryRouteLevel,
  MasterySubject,
  MasteryTagApplies,
  MasteryTagEffect,
} from "@scd/shared";

// ---------------------------------------------------------------------------
// Import shape
// ---------------------------------------------------------------------------

export interface ImportChapter {
  number: number;
  titleBn: string;
  termNote?: string;
}

export interface ImportOutcome {
  code: string;
  chapterNumber: number | null;
  strand: string | null;
  labelBn: string;
  labelEn?: string;
  sourceText: string;
  nctbCode?: string;
  assess: MasteryAssess;
  questionTypeCodes: string[];
  homeTipBn?: string;
  order: number;
}

export interface ImportQuestionType {
  code: string;
  labelBn: string;
  marks: number | null;
  answerForm?: string;
  notes?: string;
}

export interface CatalogueImport {
  classToken: MasteryClassToken;
  subject: MasterySubject;
  status: "DRAFT" | "LOCKED";
  bookRef?: string;
  chapters: ImportChapter[];
  outcomes: ImportOutcome[];
  questionTypes: ImportQuestionType[];
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const optStr = (v: unknown): string | undefined => {
  const s = str(v);
  return s ? s : undefined;
};
const isHalfStep = (n: number): boolean => Number.isFinite(n) && n >= 0 && Math.round(n * 2) === n * 2;

/**
 * Validate and normalise the JSON produced by `skills/_tools/mastery_catalogue_to_json.mjs`.
 * Returns the catalogue, or every problem found (Bangla-free codes: these are admin
 * messages shown verbatim in the import screen, which quotes the offending code).
 */
export function parseCatalogueImport(raw: unknown): { ok: true; catalogue: CatalogueImport } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["ইমপোর্ট ফাইল পড়া যায়নি (JSON অবজেক্ট নয়)।"] };
  const r = raw as Record<string, unknown>;
  const classToken = str(r.classToken) as MasteryClassToken;
  const subject = str(r.subject) as MasterySubject;
  if (!(MASTERY_CLASS_TOKENS as readonly string[]).includes(classToken)) errors.push(`অজানা শ্রেণি: "${classToken}"`);
  if (!(MASTERY_SUBJECTS as readonly string[]).includes(subject)) errors.push(`অজানা বিষয়: "${subject}"`);
  const status = str(r.status).toUpperCase().startsWith("LOCKED") ? "LOCKED" : "DRAFT";

  // Chapters
  const chapters: ImportChapter[] = [];
  const chapterNos = new Set<number>();
  for (const c of Array.isArray(r.chapters) ? r.chapters : []) {
    const o = (c ?? {}) as Record<string, unknown>;
    const number = Number(o.number);
    if (!Number.isInteger(number) || number < 0) {
      errors.push(`অধ্যায়ের নম্বর ঠিক নয়: "${String(o.number)}"`);
      continue;
    }
    if (chapterNos.has(number)) errors.push(`অধ্যায় ${number} দুবার আছে`);
    chapterNos.add(number);
    const titleBn = str(o.titleBn);
    if (!titleBn) errors.push(`অধ্যায় ${number}-এর নাম নেই`);
    chapters.push({ number, titleBn, termNote: optStr(o.termNote) });
  }

  // Question types
  const questionTypes: ImportQuestionType[] = [];
  const qtCodes = new Set<string>();
  for (const q of Array.isArray(r.questionTypes) ? r.questionTypes : []) {
    const o = (q ?? {}) as Record<string, unknown>;
    const code = str(o.code);
    if (!MASTERY_QT_CODE_RE.test(code)) {
      errors.push(`প্রশ্নের ধরনের কোড ঠিক নয়: "${code}"`);
      continue;
    }
    if (qtCodes.has(code)) errors.push(`প্রশ্নের ধরন ${code} দুবার আছে`);
    qtCodes.add(code);
    let marks: number | null = null;
    if (o.marks !== null && o.marks !== undefined && o.marks !== "") {
      const n = Number(o.marks);
      if (!isHalfStep(n)) errors.push(`${code}: নম্বর ০.৫-এর ধাপে হতে হবে ("${String(o.marks)}")`);
      else marks = n;
    }
    questionTypes.push({ code, labelBn: str(o.labelBn) || code, marks, answerForm: optStr(o.answerForm), notes: optStr(o.notes) });
  }

  // Outcomes (chapter outcomes and strands arrive in one list)
  const outcomes: ImportOutcome[] = [];
  const codes = new Set<string>();
  let order = 0;
  for (const x of Array.isArray(r.outcomes) ? r.outcomes : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const code = str(o.code);
    const parsed = parseMasteryLoCode(code);
    if (!parsed || !MASTERY_LO_CODE_RE.test(code)) {
      errors.push(`শিখনফলের কোড ঠিক নয়: "${code}"`);
      continue;
    }
    if (parsed.classToken !== classToken || parsed.subject !== subject) {
      errors.push(`${code}: কোডের শ্রেণি/বিষয় ফাইলের সাথে মেলে না (${classToken} ${subject})`);
    }
    if (codes.has(code)) errors.push(`${code} দুবার আছে`);
    codes.add(code);
    if (parsed.strand === null && parsed.chapterNumber !== null && !chapterNos.has(parsed.chapterNumber)) {
      errors.push(`${code}: অধ্যায় ${parsed.chapterNumber} অধ্যায়-তালিকায় নেই`);
    }
    const assessRaw = str(o.assess).toUpperCase();
    const assess: MasteryAssess = assessRaw === "RUBRIC" || str(o.assess) === "রুব্রিক" ? "RUBRIC" : "QUESTION";
    const labelBn = str(o.labelBn);
    if (!labelBn) errors.push(`${code}: লেবেল নেই`);
    const qts = (Array.isArray(o.questionTypeCodes) ? o.questionTypeCodes : []).map(str).filter(Boolean);
    for (const qt of qts) {
      if (!qtCodes.has(qt)) errors.push(`${code}: প্রশ্নের ধরন ${qt} নম্বর-তালিকায় নেই`);
    }
    order += 1;
    outcomes.push({
      code,
      chapterNumber: parsed.chapterNumber,
      strand: parsed.strand,
      labelBn,
      labelEn: optStr(o.labelEn),
      sourceText: str(o.sourceText),
      nctbCode: optStr(o.nctbCode),
      assess,
      questionTypeCodes: [...new Set(qts)],
      homeTipBn: optStr(o.homeTipBn),
      order,
    });
  }
  if (outcomes.length === 0) errors.push("কোনো শিখনফল নেই।");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    catalogue: { classToken, subject, status, bookRef: optStr(r.bookRef), chapters, outcomes, questionTypes },
  };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface ExistingOutcome {
  code: string;
  status: MasteryOutcomeStatus;
  assess: MasteryAssess;
  labelBn: string;
  labelEn?: string;
  sourceText: string;
  nctbCode?: string;
  questionTypeCodes: string[];
  homeTipBn?: string;
  order: number;
}

export interface ExistingQuestionType {
  code: string;
  labelBn: string;
  marks: number | null;
}

export interface CatalogueDiff {
  added: string[];
  changed: { code: string; fields: string[] }[];
  unchanged: number;
  /** DRAFT rows the file no longer lists — deleted on apply (nothing can reference a draft). */
  removedDrafts: string[];
  /** LOCKED rows the file no longer lists — RETIRED on apply, never deleted. */
  retired: string[];
  qtAdded: string[];
  qtMarksChanged: { code: string; from: number | null; to: number | null }[];
  qtLabelChanged: string[];
  /** Changes an import may not make. Any entry blocks the apply. */
  errors: string[];
}

/** Fields a LOCKED outcome may still change by import (D-#776). `assess` is not one of them. */
const LOCKED_EDITABLE = ["labelBn", "labelEn", "sourceText", "nctbCode", "questionTypeCodes", "homeTipBn", "order"] as const;

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

export function diffCatalogue(
  incoming: CatalogueImport,
  existing: ExistingOutcome[],
  existingQts: ExistingQuestionType[],
): CatalogueDiff {
  const diff: CatalogueDiff = {
    added: [],
    changed: [],
    unchanged: 0,
    removedDrafts: [],
    retired: [],
    qtAdded: [],
    qtMarksChanged: [],
    qtLabelChanged: [],
    errors: [],
  };
  const byCode = new Map(existing.map((e) => [e.code, e]));
  const incomingCodes = new Set(incoming.outcomes.map((o) => o.code));

  for (const o of incoming.outcomes) {
    const e = byCode.get(o.code);
    if (!e) {
      diff.added.push(o.code);
      continue;
    }
    if (e.status === "RETIRED") {
      diff.errors.push(`${o.code}: এই কোড অবসরে গেছে — আবার চালু করা যায় না, নতুন কোড দিন।`);
      continue;
    }
    const fields: string[] = [];
    if (e.assess !== o.assess) fields.push("assess");
    for (const f of LOCKED_EDITABLE) {
      if (f === "questionTypeCodes") {
        if (!sameList(e.questionTypeCodes, o.questionTypeCodes)) fields.push(f);
      } else if ((e[f] ?? "") !== (o[f] ?? "")) {
        fields.push(f);
      }
    }
    if (fields.length === 0) {
      diff.unchanged += 1;
      continue;
    }
    if (e.status === "LOCKED" && fields.includes("assess")) {
      diff.errors.push(`${o.code}: লক করা শিখনফলের যাচাইয়ের ধরন (প্রশ্ন/রুব্রিক) বদলানো যায় না।`);
    }
    diff.changed.push({ code: o.code, fields });
  }

  for (const e of existing) {
    if (incomingCodes.has(e.code) || e.status === "RETIRED") continue;
    if (e.status === "DRAFT") diff.removedDrafts.push(e.code);
    else diff.retired.push(e.code);
  }

  const qtByCode = new Map(existingQts.map((q) => [q.code, q]));
  for (const q of incoming.questionTypes) {
    const e = qtByCode.get(q.code);
    if (!e) {
      diff.qtAdded.push(q.code);
      continue;
    }
    if ((e.marks ?? null) !== (q.marks ?? null)) diff.qtMarksChanged.push({ code: q.code, from: e.marks ?? null, to: q.marks ?? null });
    if (e.labelBn !== q.labelBn) diff.qtLabelChanged.push(q.code);
  }
  return diff;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export interface TagInput {
  code: string;
  labelBn: string;
  appliesTo: MasteryTagApplies;
  effect: MasteryTagEffect;
  routeStrand?: string | null;
  routeSeq?: number | null;
  level?: MasteryRouteLevel | null;
  questionTypeCodes?: string[] | null;
  deductionMarks?: number | null;
  allScopes: boolean;
  scopes: { classToken: MasteryClassToken; subject: MasterySubject }[];
  active: boolean;
  order?: number | null;
}

/** The strand LO a routing tag lands on in one scope (D-#787). */
export function routeTargetCode(
  scope: { classToken: MasteryClassToken; subject: MasterySubject },
  strand: string,
  seq = 1,
): string {
  return `LO-${scope.classToken}-${scope.subject}-SK-${strand}-${String(seq).padStart(2, "0")}`;
}

/**
 * The tag rules. `liveCodes` = every non-RETIRED outcome code; `qtCodesByScope` = the
 * question-type codes defined for each "<classToken>:<subject>". Returns a Bangla
 * complaint, or null when the tag is sound.
 */
export function validateTagInput(
  t: TagInput,
  liveCodes: Set<string>,
  qtCodesByScope: Map<string, Set<string>>,
): string | null {
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(t.code)) return "ট্যাগের কোড ইংরেজি বড় হাতের অক্ষর, সংখ্যা ও _ দিয়ে লিখুন (যেমন CONCEPT_GAP)।";
  if (!t.labelBn.trim()) return "ট্যাগের নাম লিখুন।";
  if (!(MASTERY_TAG_APPLIES as readonly string[]).includes(t.appliesTo)) return "ট্যাগ কোথায় দেওয়া যাবে তা ঠিক নয়।";
  if (!(MASTERY_TAG_EFFECTS as readonly string[]).includes(t.effect)) return "ট্যাগের প্রভাব ঠিক নয়।";
  const scopes = t.scopes ?? [];
  for (const s of scopes) {
    if (!(MASTERY_CLASS_TOKENS as readonly string[]).includes(s.classToken) || !(MASTERY_SUBJECTS as readonly string[]).includes(s.subject)) {
      return "ট্যাগের শ্রেণি/বিষয় ঠিক নয়।";
    }
  }
  if (!t.allScopes && scopes.length === 0 && t.active) return "চালু ট্যাগের জন্য অন্তত একটি শ্রেণি-বিষয় বাছুন, বা “সব জায়গায়” দিন।";
  if (t.effect !== "ROUTE_STRAND") return null;

  // D-#787: a routing tag names a real strand in every scope it is on.
  const strand = (t.routeStrand ?? "").trim();
  if (!MASTERY_STRAND_RE.test(strand)) return "দক্ষতা-ধারার কোড লিখুন (যেমন ANS, HW)।";
  if (!t.level || !(MASTERY_ROUTE_LEVELS as readonly string[]).includes(t.level)) return "ট্যাগটি প্রতি প্রশ্নে না পুরো কাজে — তা বাছুন।";
  if (t.allScopes) return "দক্ষতা-ধারার ট্যাগ “সব জায়গায়” হতে পারে না — কোন শ্রেণি-বিষয়ে চালু তা বাছুন।";
  if (t.deductionMarks !== null && t.deductionMarks !== undefined && !isHalfStep(t.deductionMarks)) {
    return "কাটা নম্বর ০.৫-এর ধাপে দিন।";
  }
  const qts = t.questionTypeCodes ?? [];
  if (t.level === "ITEM" && qts.length === 0) return "প্রতি-প্রশ্নের ট্যাগের জন্য কোন ধরনের প্রশ্নে দেওয়া যাবে তা বাছুন।";
  const seq = t.routeSeq ?? 1;
  for (const s of scopes) {
    const target = routeTargetCode(s, strand, seq);
    if (!liveCodes.has(target)) return `${s.classToken} ${s.subject}-এর তালিকায় ${target} নেই — আগে দক্ষতা-ধারাটি তালিকায় আনুন।`;
    if (t.level === "ITEM") {
      const defined = qtCodesByScope.get(`${s.classToken}:${s.subject}`) ?? new Set<string>();
      const missing = qts.filter((q) => !defined.has(q));
      if (missing.length > 0) return `${s.classToken} ${s.subject}-এ এই প্রশ্নের ধরন নেই: ${missing.join(", ")}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export type PolicyKey = keyof typeof MASTERY_POLICY_DEFAULTS;
export const POLICY_KEYS = Object.keys(MASTERY_POLICY_DEFAULTS) as PolicyKey[];

/** Keep only known keys with the right primitive type — an override stores ONLY what it changes. */
export function cleanPolicyValues(v: Record<string, unknown>): Partial<MasteryPolicyValues> {
  const out: Record<string, number | boolean> = {};
  for (const k of POLICY_KEYS) {
    const val = v[k];
    if (val === null || val === undefined) continue;
    const want = typeof MASTERY_POLICY_DEFAULTS[k];
    if (want === "boolean" && typeof val === "boolean") out[k] = val;
    if (want === "number" && typeof val === "number" && Number.isFinite(val)) out[k] = val;
  }
  return out as Partial<MasteryPolicyValues>;
}

export function resolvePolicy(
  school: Partial<MasteryPolicyValues> | null | undefined,
  override: Partial<MasteryPolicyValues> | null | undefined,
): MasteryPolicyValues {
  return { ...(MASTERY_POLICY_DEFAULTS as unknown as MasteryPolicyValues), ...(school ?? {}), ...(override ?? {}) };
}

/** Ranges and orderings, on the RESOLVED values (an override is judged with what it inherits). */
export function validatePolicy(p: MasteryPolicyValues): string | null {
  const pct = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;
  const posInt = (n: number) => Number.isInteger(n) && n >= 1;
  for (const k of ["weakBelowPct", "weakGapVsSection", "improvingAtPct", "masteredAtPct", "sectionTriggerPct",
    "assignmentMixWeak", "assignmentMixImproving", "assignmentMixRevision"] as const) {
    if (!pct(p[k])) return `${k}: ০ থেকে ১০০-এর মধ্যে দিন।`;
  }
  for (const k of ["minQuestionsForVerdict", "masteredDistinctQuestions", "revisionFirstWeeks", "revisionThenWeeks",
    "lightSignalsMakeWeak", "lightSignalWindowWeeks", "sectionTriggerMinAssessments", "retestAfterDays",
    "assignmentMinutes"] as const) {
    if (!posInt(p[k])) return `${k}: ১ বা তার বেশি পূর্ণসংখ্যা দিন।`;
  }
  if (!(p.weakBelowPct < p.improvingAtPct)) return "“দুর্বল”-এর সীমা “উন্নতি”-র সীমার চেয়ে কম হতে হবে।";
  if (!(p.weakBelowPct <= p.masteredAtPct)) return "“আয়ত্তে”-র সীমা “দুর্বল”-এর সীমার চেয়ে কম হতে পারে না।";
  if (!(p.rubricWeakAtOrBelow >= 1 && p.rubricWeakAtOrBelow < p.rubricGoodAt && p.rubricGoodAt <= 4)) {
    return "রুব্রিকের ধাপ: দুর্বল-সীমা ১–৩, ভালো-সীমা তার চেয়ে বেশি ও ৪-এর মধ্যে।";
  }
  if (p.assignmentMixWeak + p.assignmentMixImproving + p.assignmentMixRevision !== 100) {
    return "অংশ খ-এর মিশ্রণ (দুর্বল + উন্নতি + রিভিশন) মিলে ১০০% হতে হবে।";
  }
  for (const k of ["assignmentTotalMarks", "assignmentPartAMarks", "assignmentPartBMarks"] as const) {
    if (!(Number.isFinite(p[k]) && p[k] >= 0 && isHalfStep(p[k]))) return `${k}: ০ বা তার বেশি, ০.৫-এর ধাপে দিন।`;
  }
  return null;
}

/** "SCHOOL" or "<classToken>:<subject>". */
export function policyScopeKey(classToken?: string | null, subject?: string | null): string {
  return classToken && subject ? `${classToken}:${subject}` : "SCHOOL";
}
