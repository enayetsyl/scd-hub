/**
 * Pure helpers behind ExerciseQuestionPicker (D-#1685) — no React, so the server jest suite can test
 * them (`server/src/__tests__/masteryQuestionRefs.test.ts`).
 */
import { exerciseOfRef, groupExerciseRefs, isSplittableExerciseRef, parseExerciseRef, questionRef } from "@scd/shared";

/** How one row cites one exercise: whole, some questions, or not at all (null). */
export type Cite = { whole: boolean; questions: number[] } | null;

/** The distinct exercises of a ref list, in order (question refs folded into their exercise). */
export function exercisesInRefs(refs: readonly string[], splittableOnly = false): string[] {
  const out: string[] = [];
  for (const r of refs) {
    const e = exerciseOfRef(r);
    if (!e || out.includes(e) || (splittableOnly && !isSplittableExerciseRef(e))) continue;
    out.push(e);
  }
  return out;
}

/** How `refs` cite `exercise` (null = not cited). */
export function citeOf(refs: readonly string[], exercise: string): Cite {
  const g = groupExerciseRefs(refs).find((x) => x.exercise === exercise);
  return g ? { whole: g.whole, questions: g.questions } : null;
}

/** Replace the refs of one exercise, keeping its place in the list (and every other ref as is). */
export function withCite(refs: readonly string[], exercise: string, cite: Cite): string[] {
  const next = cite ? [...(cite.whole ? [exercise] : []), ...[...cite.questions].sort((a, b) => a - b).map((q) => questionRef(exercise, q))] : [];
  const at = refs.findIndex((r) => exerciseOfRef(r) === exercise);
  const rest = refs.filter((r) => exerciseOfRef(r) !== exercise);
  if (at < 0) return [...rest, ...next];
  const before = refs.slice(0, at).filter((r) => exerciseOfRef(r) !== exercise).length;
  return [...rest.slice(0, before), ...next, ...rest.slice(before)];
}

/**
 * The same question picked in two parts of a split — refused by the server (QUESTION_ONE_CODE), so
 * the form says so before it sends. Each conflict: the question ref and the 1-based part numbers.
 */
export function splitPartConflicts(parts: readonly (readonly string[])[]): { ref: string; parts: number[] }[] {
  const seen = new Map<string, number[]>();
  parts.forEach((refs, i) => {
    for (const r of new Set(refs)) {
      const p = parseExerciseRef(r);
      if (!p || p.question === null) continue;
      const key = questionRef(p.exercise, p.question);
      const list = seen.get(key) ?? [];
      if (!list.includes(i + 1)) list.push(i + 1);
      seen.set(key, list);
    }
  });
  return [...seen].filter(([, list]) => list.length > 1).map(([ref, list]) => ({ ref, parts: list }));
}
