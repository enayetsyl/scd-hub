/**
 * Routine → ScopeGrant binding decision (R2.5/R2.6, D-#49) — pure.
 *
 * A subject-teacher slot auto-grants teaching access (chapter/lesson plan + question
 * pool + tracker), keyed by a `Subject` doc. Quran/Arabic run against cross-grade
 * `SubjectGroup`s, not Sections, so they bind nothing. ISLAM is different: it IS taught
 * per Section, carries class notes / homework / assignments, and has a `Subject` doc —
 * leaving it out meant Islam teachers only ever had hand-made grants, which did not
 * follow the C4/C5 boys/girls split (owner report 2026-10-01: "এই শাখায় লেখার অনুমতি
 * নেই" on a class note). This decides whether a given slot should bind a teaching
 * grant; the service does the idempotent upsert/revoke (and skips a subject with no
 * `Subject` doc).
 */

/** Subjects whose Section slots bind a routine teaching grant: the 5 content subjects + ISLAM. */
export const ROUTINE_GRANT_SUBJECTS: readonly string[] = ["BAN", "ENG", "MATH", "SCI", "BGS", "ISLAM"];

export interface GrantPlanInput {
  groupType: string;
  isBreak: boolean;
  teacherId?: string | null;
  subject: string;
}

export interface GrantPlan {
  bind: boolean;
  reason: string;
}

/**
 * Should this slot bind a routine teaching grant? Only a non-break, teacher-assigned,
 * Section-based slot for a CONTENT subject (`contentSubjects`) binds.
 */
export function routineGrantPlan(slot: GrantPlanInput, contentSubjects: readonly string[]): GrantPlan {
  if (slot.isBreak) return { bind: false, reason: "break period" };
  if (!slot.teacherId) return { bind: false, reason: "no teacher" };
  if (slot.groupType !== "section")
    return { bind: false, reason: "non-section group (Quran/Arabic carry no content scope)" };
  if (!contentSubjects.includes(slot.subject))
    return { bind: false, reason: "non-content subject (no chapter/lesson plan to grant)" };
  return { bind: true, reason: "section + content subject" };
}
