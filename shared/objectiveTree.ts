// =============================================================================
// OBJECTIVE TREE — the ONE invariant function (prd-objective-tree §5, §10 item 1)
// =============================================================================
// Pure: no database, no I/O. Three callers share it so a rule can never drift:
//   - skills/_tools/verify_objective_tree.mjs   (the drafting verifier, mode FILE)
//   - the tree import (MasteryCatalogueService)  (mode FILE on the file, REVIEW on the merged set)
//   - review writes in OT-2                      (mode REVIEW, after each accept/split/merge/…)
//
// FILE mode adds the drafting rules (home tip on objectives only, banned term, assess +
// known question types, children numbered 1..N without gaps, coverage recomputed from the
// cited refs). REVIEW mode holds only the §5 invariants, so a reviewer may reject `.2` of
// three children without renumbering, and a reviewer-added row is not held to drafting text.
import {
  MASTERY_CLASS_TOKENS,
  MASTERY_DOMAIN_CODE_RE,
  MASTERY_LO_CODE_RE,
  MASTERY_SUBJECTS,
  parseMasteryLoCode,
} from "./vocab";
import { masteryPrereqSubjects } from "./masteryPartners";

export const OBJECTIVE_TREE_FORMAT = "scd-objective-tree/1";
export const OBJECTIVE_DOMAINS_FORMAT = "scd-objective-domains/1";

/** Never in a label or home tip up to Class 3 (those books ban it; use "হিসাবটি"). From Class 4 the
 *  books use it as a chapter title, so it is allowed there (owner, D-#974). */
export const OBJECTIVE_TREE_BANNED_TERMS = ["গাণিতিক বাক্য"] as const;
export const OBJECTIVE_TREE_BANNED_TERM_CLASSES = ["NUR", "KG", "C1", "C2", "C3"] as const;

export interface TreeNodeInput {
  code: string;
  level: "OBJECTIVE" | "SUB";
  parentCode: string | null;
  domainCode: string | null;
  chapterNumber: number | null;
  strand: string | null;
  tagged: boolean;
  prereqCodes: string[];
  /** bookRef.exercises — refs "<chapter>/<lesson>/<n>", "…/<a>–<b>" ranges, "…/—" unnumbered activities,
   *  "…/<n>#<q>" one question of exercise n (D-#1685). */
  exercises: string[];
  labelBn: string;
  homeTipBn?: string | null;
  assess?: string | null;
  questionTypeCodes?: string[];
}

export interface TreeCoverageInput {
  exercisesTotal: number;
  mapped: number;
  unmapped: unknown[];
  /** How many questions an exercise has — needed once it is cited question by question (D-#1685). */
  questionCounts?: ExerciseQuestionCount[];
}

/** "Exercise 3/অনুশীলনী/8 has 6 questions" — the exercise ref is whole (no "#"). */
export interface ExerciseQuestionCount {
  ref: string;
  count: number;
}

export interface TreeCheckInput {
  classToken: string;
  subject: string;
  /** Rows that count: REJECTED / merged-away rows are left out by the caller. */
  nodes: TreeNodeInput[];
  domainCodes: Iterable<string>;
  mode: "FILE" | "REVIEW";
  /** FILE mode: the tree's question-type codes (assess rule). */
  questionTypeCodes?: Iterable<string>;
  /** FILE mode: the file's coverage block. */
  coverage?: TreeCoverageInput | null;
  /** Codes outside this tree a prerequisite may name (same subject or its partner paper, live). */
  externalCodes?: Iterable<string>;
}

/** Every rule, in report order; `fileOnly` rules run in FILE mode only. */
export const TREE_RULES = {
  CODE_UNIQUE: { text: "codes unique", fileOnly: false },
  CODE_PATTERN: { text: "code pattern (objective / sub .N / strand) + class, subject and chapter in the code", fileOnly: false },
  SUB_PARENT: { text: "every SUB has an OBJECTIVE parent with tagged:false (same domain, chapter, strand)", fileOnly: false },
  SINGLE_CHILD: { text: "no objective has exactly one child", fileOnly: false },
  TAGGED_IFF_LEAF: { text: "objective tagged iff it has no children; every SUB tagged", fileOnly: false },
  CHILD_NUMBERING: { text: "children numbered 1..N without gaps", fileOnly: true },
  TAGGED_CITES_EXERCISE: { text: "every tagged row cites >= 1 exercise", fileOnly: false },
  QUESTION_REF: { text: "a question ref names one question (1..99) of one numbered exercise", fileOnly: false },
  QUESTION_ONE_CODE: { text: "a question is cited by one tagged row (one code per question)", fileOnly: false },
  PREREQ_RESOLVES: { text: "prerequisites resolve (same subject or its partner paper, same or earlier class, not self)", fileOnly: false },
  PREREQ_CYCLE: { text: "prerequisite graph has no cycles", fileOnly: false },
  DOMAIN_RESOLVES: { text: "domain codes resolve", fileOnly: false },
  HOME_TIP: { text: "home tip on every objective, none on subs", fileOnly: true },
  BANNED_TERM: { text: "banned term absent from labels/tips", fileOnly: true },
  ASSESS_QT: { text: "assess valid + question types known", fileOnly: true },
  COVERAGE: { text: "coverage: mapped + unmapped = exercisesTotal; mapped = distinct numbered refs cited; exercises cited by question fully cited", fileOnly: true },
} as const;
export type TreeRule = keyof typeof TREE_RULES;

export interface TreeViolation {
  rule: TreeRule;
  code: string | null;
  detail: string;
}

// ---------------------------------------------------------------------------
// Question-level refs (D-#1685): "<chapter>/<lesson>/<n>#<q>" = question q (book order) of exercise n
// ---------------------------------------------------------------------------

/** The separator between an exercise ref and its question number. Never used in a lesson name. */
export const EXERCISE_QUESTION_SEP = "#";

export interface ParsedExerciseRef {
  /** The whole-exercise ref ("3/অনুশীলনী/8"). */
  exercise: string;
  /** The question number (1..99), or null for a whole-exercise ref. */
  question: number | null;
}

/**
 * "3/অনুশীলনী/8#3" → { exercise: "3/অনুশীলনী/8", question: 3 }; a ref without "#" in its last part →
 * { exercise: ref, question: null }. null when the question part is malformed: only ONE numbered
 * exercise can be cited by question (not a range "2–4", not an unnumbered "—"), and q is 1..99.
 * Bangla digits in the question are read as ASCII.
 */
export function parseExerciseRef(ref: string): ParsedExerciseRef | null {
  const r = String(ref ?? "").trim();
  const i = r.lastIndexOf("/");
  const last = r.slice(i + 1);
  const h = last.indexOf(EXERCISE_QUESTION_SEP);
  if (h < 0) return { exercise: r, question: null };
  const no = last.slice(0, h).trim();
  const q = asciiDigits(last.slice(h + 1).trim());
  if (i < 0 || !/^\d+$/.test(no) || !/^[1-9]\d?$/.test(q)) return null;
  return { exercise: `${r.slice(0, i + 1)}${no}`, question: Number(q) };
}

/** The whole-exercise part of a ref ("3/অনুশীলনী/8#3" → "3/অনুশীলনী/8"); a whole ref is returned as is. */
export function exerciseOfRef(ref: string): string {
  const p = parseExerciseRef(ref);
  if (p) return p.exercise;
  const r = String(ref ?? "").trim();
  const i = r.lastIndexOf("/");
  const h = r.indexOf(EXERCISE_QUESTION_SEP, i + 1);
  return h < 0 ? r : r.slice(0, h).trim();
}

/** The stored form of a ref: trimmed, question number in ASCII ("…/8#৩" → "…/8#3"). Malformed → as typed. */
export function normaliseExerciseRef(ref: string): string {
  const p = parseExerciseRef(ref);
  if (!p) return String(ref ?? "").trim();
  return p.question === null ? p.exercise : `${p.exercise}${EXERCISE_QUESTION_SEP}${p.question}`;
}

/** A question ref from its exercise and number. */
export const questionRef = (exercise: string, question: number): string => `${exercise}${EXERCISE_QUESTION_SEP}${question}`;

export interface GroupedExerciseRef {
  exercise: string;
  /** True when the exercise is cited whole. */
  whole: boolean;
  /** The questions cited one by one, ascending (empty for a whole-only exercise). */
  questions: number[];
}

/** Refs grouped by exercise, first-seen order: ["…/8#1", "…/8#3", "…/7"] → [{…/8, [1, 3]}, {…/7, whole}]. */
export function groupExerciseRefs(refs: readonly string[] | null | undefined): GroupedExerciseRef[] {
  const by = new Map<string, GroupedExerciseRef>();
  for (const ref of refs ?? []) {
    const p = parseExerciseRef(ref);
    const exercise = p ? p.exercise : exerciseOfRef(ref);
    const g = by.get(exercise) ?? { exercise, whole: false, questions: [] };
    if (p && p.question !== null) {
      if (!g.questions.includes(p.question)) g.questions.push(p.question);
    } else {
      g.whole = true;
    }
    by.set(exercise, g);
  }
  for (const g of by.values()) g.questions.sort((a, b) => a - b);
  return [...by.values()];
}

/** True when a ref can be split into questions: one numbered exercise, no question part yet. */
export function isSplittableExerciseRef(ref: string): boolean {
  const p = parseExerciseRef(ref);
  if (!p || p.question !== null) return false;
  const last = p.exercise.slice(p.exercise.lastIndexOf("/") + 1);
  return p.exercise.includes("/") && /^\d+$/.test(last);
}

export interface QuestionCoverageGap {
  exercise: string;
  detail: string;
}

/**
 * Exercises cited question by question that are not fully covered (D-#1685): an exercise is mapped
 * when it is cited whole, OR every one of its questions is cited by some tagged row — never both
 * ways at once by chapter rows (a whole citation would say every question tests that row too). A
 * skill-strand row (SK-…) citing it whole is fine: a strand names where a cross-cutting skill is
 * practised, and never maps a question. Needs the exercise's question count. The lock gate (REVIEW)
 * and COVERAGE (FILE) refuse any gap; a review write does not, so a reviewer can move an exercise
 * from whole to question-by-question one row at a time.
 */
export function questionCoverageGaps(
  nodes: readonly (Pick<TreeNodeInput, "code" | "tagged" | "exercises"> & { strand?: string | null })[],
  counts: Iterable<ExerciseQuestionCount> | null | undefined,
): QuestionCoverageGap[] {
  const countOf = new Map<string, number>();
  for (const c of counts ?? []) countOf.set(c.ref, c.count);
  const whole = new Map<string, Set<string>>();
  const byQuestion = new Map<string, Set<string>>();
  const cited = new Map<string, Set<number>>();
  for (const n of nodes) {
    if (!n.tagged) continue;
    for (const ref of n.exercises) {
      const p = parseExerciseRef(ref);
      if (!p) continue;
      if (p.question === null) {
        if (n.strand) continue;
        whole.set(p.exercise, (whole.get(p.exercise) ?? new Set<string>()).add(n.code));
      } else {
        cited.set(p.exercise, (cited.get(p.exercise) ?? new Set<number>()).add(p.question));
        byQuestion.set(p.exercise, (byQuestion.get(p.exercise) ?? new Set<string>()).add(n.code));
      }
    }
  }
  const out: QuestionCoverageGap[] = [];
  for (const [exercise, qs] of cited) {
    const w = whole.get(exercise);
    if (w) {
      const list = (x: Set<string>) => [...x].sort().join(", ");
      out.push({ exercise, detail: `cited whole by ${list(w)} and by question by ${list(byQuestion.get(exercise) ?? new Set())} — cite it one way` });
    }
    const count = countOf.get(exercise);
    if (!count) {
      out.push({ exercise, detail: "cited by question but its question count is not set" });
      continue;
    }
    const missing: number[] = [];
    for (let q = 1; q <= count; q++) if (!qs.has(q)) missing.push(q);
    const beyond = [...qs].filter((q) => q > count).sort((a, b) => a - b);
    if (missing.length) out.push({ exercise, detail: `question${missing.length > 1 ? "s" : ""} ${missing.join(", ")} of ${count} not cited` });
    if (beyond.length) out.push({ exercise, detail: `question${beyond.length > 1 ? "s" : ""} ${beyond.join(", ")} beyond its ${count}` });
  }
  return out;
}

/** "7/হাতে রাখি/2–4" → three refs; "…/—" (an unnumbered activity) → none; "…/8#3" → its exercise "…/8". */
export function expandExerciseRef(input: string): string[] {
  const ref = exerciseOfRef(input);
  const i = ref.lastIndexOf("/");
  if (i < 0) return [ref];
  const head = ref.slice(0, i);
  const last = ref.slice(i + 1);
  if (last === "—" || last === "-") return [];
  const m = /^(\d+)[–-](\d+)$/.exec(last);
  if (!m) return [ref];
  const out: string[] = [];
  for (let n = Number(m[1]); n <= Number(m[2]); n++) out.push(`${head}/${n}`);
  return out;
}

/**
 * The chapters a row is practised in, from its exercise refs "<chapter>/<lesson>/<n>" (also "…/—").
 * Sorted, unique, numbers only; refs with a non-numeric chapter ("SK-VOC/—") are ignored. Derived —
 * a skill-strand row has no chapter of its own, so this is how the app says where it is practised.
 */
export function practisedChapters(exercises: readonly string[] | null | undefined): number[] {
  const set = new Set<number>();
  for (const ref of exercises ?? []) {
    const head = String(ref).split("/")[0]?.trim() ?? "";
    if (/^\d{1,3}$/.test(head)) set.add(Number(head));
  }
  return [...set].sort((a, b) => a - b);
}

const classIndex = (token: string): number => (MASTERY_CLASS_TOKENS as readonly string[]).indexOf(token);

/**
 * Check a set of tree rows. Returns every violation (empty = sound). Each names the rule and
 * the code, so an import or a review write can refuse "with the broken rule named".
 */
export function checkTreeInvariants(input: TreeCheckInput): TreeViolation[] {
  const { classToken, subject, nodes, mode } = input;
  const file = mode === "FILE";
  const out: TreeViolation[] = [];
  const bad = (rule: TreeRule, code: string | null, detail: string) => out.push({ rule, code, detail });

  // CODE_UNIQUE
  const by = new Map<string, TreeNodeInput>();
  for (const n of nodes) {
    if (by.has(n.code)) bad("CODE_UNIQUE", n.code, "appears twice");
    by.set(n.code, n);
  }

  // CODE_PATTERN
  for (const n of nodes) {
    const p = MASTERY_LO_CODE_RE.test(n.code) ? parseMasteryLoCode(n.code) : null;
    if (!p) {
      bad("CODE_PATTERN", n.code, "does not match MASTERY_LO_CODE_RE");
      continue;
    }
    if (p.classToken !== classToken || p.subject !== subject) bad("CODE_PATTERN", n.code, `class/subject differ from the tree (${classToken} ${subject})`);
    if (n.level === "SUB" && p.sub === null) bad("CODE_PATTERN", n.code, "a SUB needs a .N suffix");
    if (n.level === "SUB" && p.sub !== null && p.sub < 1) bad("CODE_PATTERN", n.code, ".N must be 1..99");
    if (n.level === "OBJECTIVE" && p.sub !== null) bad("CODE_PATTERN", n.code, "an OBJECTIVE has no .N suffix");
    if ((p.strand ?? null) !== (n.strand ?? null)) bad("CODE_PATTERN", n.code, `strand field ${n.strand ?? "null"} differs from the code`);
    if (p.strand === null && n.chapterNumber !== p.chapterNumber) bad("CODE_PATTERN", n.code, `chapterNumber ${n.chapterNumber ?? "null"} differs from the code`);
    if (p.strand !== null && n.chapterNumber !== null) bad("CODE_PATTERN", n.code, "a skill strand has chapterNumber null");
  }

  // SUB_PARENT
  const kids = new Map<string, TreeNodeInput[]>();
  for (const n of nodes) {
    if (n.level === "SUB") {
      const par = n.parentCode ? by.get(n.parentCode) : undefined;
      if (!par) {
        bad("SUB_PARENT", n.code, `parent ${n.parentCode ?? "null"} not found`);
        continue;
      }
      if (par.level !== "OBJECTIVE") bad("SUB_PARENT", n.code, `parent ${par.code} is not an OBJECTIVE`);
      if (par.tagged) bad("SUB_PARENT", n.code, `parent ${par.code} is tagged (a parent only groups)`);
      if (!n.code.startsWith(`${par.code}.`)) bad("SUB_PARENT", n.code, `code does not extend its parent ${par.code}`);
      if (n.domainCode !== par.domainCode || n.chapterNumber !== par.chapterNumber || (n.strand ?? null) !== (par.strand ?? null)) {
        bad("SUB_PARENT", n.code, "domain/chapter/strand differ from the parent");
      }
      const list = kids.get(par.code) ?? [];
      list.push(n);
      kids.set(par.code, list);
    } else if (n.parentCode !== null) {
      bad("SUB_PARENT", n.code, "an OBJECTIVE has no parent");
    }
  }

  // SINGLE_CHILD / TAGGED_IFF_LEAF / CHILD_NUMBERING
  for (const n of nodes) {
    if (n.level === "SUB") {
      if (!n.tagged) bad("TAGGED_IFF_LEAF", n.code, "a SUB is always tagged");
      continue;
    }
    const ch = kids.get(n.code) ?? [];
    if (ch.length === 1) bad("SINGLE_CHILD", n.code, `has exactly one child (${ch[0].code})`);
    if (ch.length > 0 && n.tagged) bad("TAGGED_IFF_LEAF", n.code, `tagged with ${ch.length} children`);
    if (ch.length === 0 && !n.tagged) bad("TAGGED_IFF_LEAF", n.code, "untagged with no children");
    if (file && ch.length > 0) {
      const nums = ch.map((k) => parseMasteryLoCode(k.code)?.sub ?? 0).sort((a, b) => a - b);
      if (!nums.every((v, i) => v === i + 1)) bad("CHILD_NUMBERING", n.code, `children numbered ${nums.join(",")}`);
    }
  }

  // TAGGED_CITES_EXERCISE
  for (const n of nodes) if (n.tagged && n.exercises.length === 0) bad("TAGGED_CITES_EXERCISE", n.code, "cites no exercise");

  // QUESTION_REF / QUESTION_ONE_CODE (D-#1685; one code per question, D-#776). An exercise cited
  // whole by one row and by question by another is a coverage gap (questionCoverageGaps), not this.
  const questionBy = new Map<string, Map<number, string[]>>();
  for (const n of nodes) {
    for (const ref of n.exercises) {
      const p = parseExerciseRef(ref);
      if (!p) {
        bad("QUESTION_REF", n.code, `${ref}: a question is "<chapter>/<lesson>/<n>#<q>" (one numbered exercise, q 1..99)`);
        continue;
      }
      if (!n.tagged || p.question === null) continue;
      const qs = questionBy.get(p.exercise) ?? new Map<number, string[]>();
      const list = qs.get(p.question) ?? [];
      if (!list.includes(n.code)) list.push(n.code);
      qs.set(p.question, list);
      questionBy.set(p.exercise, qs);
    }
  }
  for (const [exercise, qs] of questionBy) {
    for (const [q, codes] of [...qs].sort((a, b) => a[0] - b[0])) {
      if (codes.length > 1) bad("QUESTION_ONE_CODE", [...codes].sort()[1], `${questionRef(exercise, q)} is cited by ${[...codes].sort().join(", ")}`);
    }
  }

  // PREREQ_RESOLVES
  const external = new Set(input.externalCodes ?? []);
  const myClass = classIndex(classToken);
  for (const n of nodes) {
    for (const pc of n.prereqCodes) {
      if (pc === n.code) {
        bad("PREREQ_RESOLVES", n.code, "names itself");
        continue;
      }
      if (by.has(pc)) continue;
      const p = parseMasteryLoCode(pc);
      if (!p || !external.has(pc)) {
        bad("PREREQ_RESOLVES", n.code, `${pc} not found`);
        continue;
      }
      if (!masteryPrereqSubjects(subject).includes(p.subject) || classIndex(p.classToken) > myClass) bad("PREREQ_RESOLVES", n.code, `${pc} is another subject or a later class`);
    }
  }

  // PREREQ_CYCLE (inside the tree only — external codes cannot point back into a draft)
  const state = new Map<string, 1 | 2>();
  const seenCycle = new Set<string>();
  const visit = (c: string, path: string[]): void => {
    const s = state.get(c);
    if (s === 1) {
      const loop = [...path.slice(path.indexOf(c)), c].join(" > ");
      if (!seenCycle.has(loop)) {
        seenCycle.add(loop);
        bad("PREREQ_CYCLE", c, loop);
      }
      return;
    }
    if (s === 2) return;
    state.set(c, 1);
    for (const p of by.get(c)?.prereqCodes ?? []) if (by.has(p)) visit(p, [...path, c]);
    state.set(c, 2);
  };
  for (const c of by.keys()) visit(c, []);

  // DOMAIN_RESOLVES
  const domains = new Set(input.domainCodes);
  for (const n of nodes) {
    if (!n.domainCode || !MASTERY_DOMAIN_CODE_RE.test(n.domainCode) || !domains.has(n.domainCode)) {
      bad("DOMAIN_RESOLVES", n.code, `domain ${n.domainCode ?? "null"} not in the domain ladder`);
    } else if (!n.domainCode.startsWith(`DOM-${subject}-`)) {
      bad("DOMAIN_RESOLVES", n.code, `domain ${n.domainCode} is another subject's`);
    }
  }

  if (file) {
    const termsBanned = (OBJECTIVE_TREE_BANNED_TERM_CLASSES as readonly string[]).includes(classToken);
    for (const n of nodes) {
      const tip = (n.homeTipBn ?? "").trim();
      if (n.level === "OBJECTIVE" && !tip) bad("HOME_TIP", n.code, "objective without a home tip");
      if (n.level === "SUB" && tip) bad("HOME_TIP", n.code, "a sub-objective has a home tip (guardians see objectives only)");
      for (const term of termsBanned ? OBJECTIVE_TREE_BANNED_TERMS : []) {
        if (`${n.labelBn} ${tip}`.includes(term)) bad("BANNED_TERM", n.code, `uses "${term}"`);
      }
    }
    const qts = new Set(input.questionTypeCodes ?? []);
    for (const n of nodes) {
      if (n.assess !== "QUESTION" && n.assess !== "RUBRIC") bad("ASSESS_QT", n.code, `assess ${n.assess ?? "null"}`);
      if (!n.questionTypeCodes || n.questionTypeCodes.length === 0) bad("ASSESS_QT", n.code, "no question type");
      for (const q of n.questionTypeCodes ?? []) if (!qts.has(q)) bad("ASSESS_QT", n.code, `question type ${q} not in the tree's table`);
    }
    const cov = input.coverage;
    if (!cov) {
      bad("COVERAGE", null, "no coverage block");
    } else {
      if (cov.mapped + cov.unmapped.length !== cov.exercisesTotal) {
        bad("COVERAGE", null, `mapped ${cov.mapped} + unmapped ${cov.unmapped.length} != exercisesTotal ${cov.exercisesTotal}`);
      }
      const cited = new Set<string>();
      for (const n of nodes) for (const r of n.exercises) for (const x of expandExerciseRef(r)) cited.add(x);
      if (cited.size !== cov.mapped) bad("COVERAGE", null, `mapped ${cov.mapped} != distinct numbered refs cited ${cited.size}`);
      for (const g of questionCoverageGaps(nodes, cov.questionCounts)) bad("COVERAGE", null, `${g.exercise}: ${g.detail}`);
    }
  }
  return out;
}

/** One line per violation: "[RULE] CODE: detail" — what an import refusal shows. */
export function formatTreeViolation(v: TreeViolation): string {
  return `[${v.rule}] ${v.code ?? "—"}: ${v.detail}`;
}

// ---------------------------------------------------------------------------
// File shape (scd-objective-tree/1 + scd-objective-domains/1, tree README)
// ---------------------------------------------------------------------------

export interface TreeFileNode extends TreeNodeInput {
  sourceText: string;
  bookRef: { chapter: number | null; lesson: string | null; exercises: string[] };
  legacyCodes: string[];
  claudeNote: string | null;
}

export interface TreeFile {
  format: typeof OBJECTIVE_TREE_FORMAT;
  classToken: string;
  subject: string;
  source: { book: string | null; files: string[]; readOn: string | null };
  chapters: { number: number; titleBn: string }[];
  questionTypes: { code: string; labelBn: string; marksBn: string | null; marks: number | null; examUse: string | null }[];
  nodes: TreeFileNode[];
  coverage: {
    exercisesTotal: number;
    mapped: number;
    unmapped: { ref: string; text: string; reason: string }[];
    note: string | null;
    /** Optional (D-#1685): question counts of the exercises cited question by question. */
    questionCounts: ExerciseQuestionCount[];
  };
  flags: { code: string | null; kind: string; text: string; ownerRuling: string | null; ruledOn: string | null }[];
}

export interface DomainsFile {
  format: typeof OBJECTIVE_DOMAINS_FORMAT;
  subject: string;
  domains: { code: string; labelBn: string; labelEn: string | null; order: number; note: string | null }[];
}

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const ns = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : []);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** Bangla digits → ASCII. */
const asciiDigits = (t: string): string => t.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));

/** "১" → 1, "২ (প্রতি সারি)" → 2, "১½" → 1.5; anything else (a split, "—") → null. */
export function marksFromBn(marksBn: string | null): number | null {
  if (!marksBn) return null;
  const m = /^\s*(\d+)?(\.5|½)?\s*(\(.*\))?\s*$/.exec(asciiDigits(marksBn));
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) + (m[2] ? 0.5 : 0);
}

/** True when the JSON is a tree file (so the importer picks the tree path). */
export function isObjectiveTreeFile(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && (raw as Record<string, unknown>).format === OBJECTIVE_TREE_FORMAT;
}

/** Shape check + normalise a tree file. Content rules are `checkTreeInvariants`. */
export function readTreeFile(raw: unknown): { ok: true; tree: TreeFile } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObjectiveTreeFile(raw)) return { ok: false, errors: [`format must be "${OBJECTIVE_TREE_FORMAT}"`] };
  const r = raw as Record<string, unknown>;
  const classToken = s(r.classToken);
  const subject = s(r.subject);
  if (!(MASTERY_CLASS_TOKENS as readonly string[]).includes(classToken)) errors.push(`unknown classToken "${classToken}"`);
  if (!subject) errors.push("subject missing");
  else if (!(MASTERY_SUBJECTS as readonly string[]).includes(subject)) errors.push(`unknown subject "${subject}"`);
  const src = (r.source ?? {}) as Record<string, unknown>;
  const chapters: TreeFile["chapters"] = [];
  for (const c of Array.isArray(r.chapters) ? r.chapters : []) {
    const o = (c ?? {}) as Record<string, unknown>;
    const number = intOrNull(o.number);
    if (number === null || number < 0) errors.push(`chapter number "${String(o.number)}" is not a whole number`);
    else chapters.push({ number, titleBn: s(o.titleBn) });
  }
  const questionTypes: TreeFile["questionTypes"] = [];
  for (const q of Array.isArray(r.questionTypes) ? r.questionTypes : []) {
    const o = (q ?? {}) as Record<string, unknown>;
    const marksBn = ns(o.marksBn);
    const marks = typeof o.marks === "number" ? o.marks : marksFromBn(marksBn);
    questionTypes.push({ code: s(o.code), labelBn: s(o.labelBn), marksBn, marks, examUse: ns(o.examUse) });
  }
  const nodes: TreeFileNode[] = [];
  const rawNodes = Array.isArray(r.nodes) ? r.nodes : [];
  if (rawNodes.length === 0) errors.push("nodes missing or empty");
  rawNodes.forEach((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const code = s(o.code);
    const level = s(o.level);
    if (level !== "OBJECTIVE" && level !== "SUB") errors.push(`node ${i + 1} (${code || "no code"}): level must be OBJECTIVE or SUB`);
    if (typeof o.tagged !== "boolean") errors.push(`${code || `node ${i + 1}`}: tagged must be true/false`);
    if (!s(o.labelBn)) errors.push(`${code || `node ${i + 1}`}: labelBn missing`);
    const br = (o.bookRef ?? {}) as Record<string, unknown>;
    const exercises = strList(br.exercises);
    nodes.push({
      code,
      level: level === "SUB" ? "SUB" : "OBJECTIVE",
      parentCode: ns(o.parentCode),
      domainCode: ns(o.domainCode),
      chapterNumber: intOrNull(o.chapterNumber),
      strand: ns(o.strand),
      tagged: o.tagged === true,
      prereqCodes: strList(o.prereqCodes),
      exercises,
      labelBn: s(o.labelBn),
      homeTipBn: ns(o.homeTipBn),
      assess: ns(o.assess),
      questionTypeCodes: strList(o.questionTypeCodes),
      sourceText: s(o.sourceText),
      bookRef: { chapter: intOrNull(br.chapter), lesson: ns(br.lesson), exercises },
      legacyCodes: strList(o.legacyCodes),
      claudeNote: ns(o.claudeNote),
    });
  });
  const cov = (r.coverage ?? null) as Record<string, unknown> | null;
  if (!cov || typeof cov.exercisesTotal !== "number" || typeof cov.mapped !== "number" || !Array.isArray(cov.unmapped)) {
    errors.push("coverage {exercisesTotal, mapped, unmapped[]} missing");
  }
  const coverage: TreeFile["coverage"] = {
    exercisesTotal: typeof cov?.exercisesTotal === "number" ? cov.exercisesTotal : 0,
    mapped: typeof cov?.mapped === "number" ? cov.mapped : 0,
    unmapped: (Array.isArray(cov?.unmapped) ? cov.unmapped : []).map((u) => {
      const o = (u ?? {}) as Record<string, unknown>;
      return { ref: s(o.ref), text: s(o.text), reason: s(o.reason) };
    }),
    note: ns(cov?.note),
    questionCounts: [],
  };
  const qcSeen = new Set<string>();
  for (const x of Array.isArray(cov?.questionCounts) ? cov.questionCounts : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const ref = s(o.ref);
    const count = intOrNull(o.count);
    if (!isSplittableExerciseRef(ref)) errors.push(`coverage.questionCounts: "${ref}" is not one numbered exercise`);
    else if (count === null || count < 1 || count > 99) errors.push(`coverage.questionCounts: ${ref} count must be 1..99`);
    else if (qcSeen.has(ref)) errors.push(`coverage.questionCounts: ${ref} appears twice`);
    else {
      qcSeen.add(ref);
      coverage.questionCounts.push({ ref, count });
    }
  }
  const flags: TreeFile["flags"] = (Array.isArray(r.flags) ? r.flags : []).map((f) => {
    const o = (f ?? {}) as Record<string, unknown>;
    return { code: ns(o.code), kind: s(o.kind) || "OTHER", text: s(o.text), ownerRuling: ns(o.ownerRuling), ruledOn: ns(o.ruledOn) };
  });
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    tree: {
      format: OBJECTIVE_TREE_FORMAT,
      classToken,
      subject,
      source: { book: ns(src.book), files: strList(src.files), readOn: ns(src.readOn) },
      chapters,
      questionTypes,
      nodes,
      coverage,
      flags,
    },
  };
}

/** Shape check + normalise a domains file. */
export function readDomainsFile(raw: unknown): { ok: true; domains: DomainsFile } | { ok: false; errors: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.format !== OBJECTIVE_DOMAINS_FORMAT) return { ok: false, errors: [`domains format must be "${OBJECTIVE_DOMAINS_FORMAT}"`] };
  const errors: string[] = [];
  const subject = s(r.subject);
  if (!(MASTERY_SUBJECTS as readonly string[]).includes(subject)) errors.push(`unknown subject "${subject}"`);
  const seen = new Set<string>();
  const domains: DomainsFile["domains"] = [];
  for (const d of Array.isArray(r.domains) ? r.domains : []) {
    const o = (d ?? {}) as Record<string, unknown>;
    const code = s(o.code);
    if (!MASTERY_DOMAIN_CODE_RE.test(code) || !code.startsWith(`DOM-${subject}-`)) errors.push(`domain code "${code}" is not DOM-${subject}-<SLUG>`);
    if (seen.has(code)) errors.push(`domain ${code} appears twice`);
    seen.add(code);
    if (!s(o.labelBn)) errors.push(`${code}: labelBn missing`);
    domains.push({ code, labelBn: s(o.labelBn), labelEn: ns(o.labelEn), order: typeof o.order === "number" ? o.order : domains.length + 1, note: ns(o.note) });
  }
  if (domains.length === 0) errors.push("domains missing or empty");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, domains: { format: OBJECTIVE_DOMAINS_FORMAT, subject, domains } };
}
