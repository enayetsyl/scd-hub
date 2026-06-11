/**
 * Routine → ScopeGrant binding decision (R2.5/R2.6, D-#49) — pure.
 *
 * A subject-teacher slot auto-grants teaching access (chapter/lesson plan + question
 * pool + tracker), but a teaching `ScopeGrant` is keyed by a content `Subject` doc —
 * which only exists for the 5 content subjects (BAN/ENG/MATH/SCI/BGS) taught against
 * a `Section`. Quran/Arabic/Islam have no authored content (and run against
 * cross-grade `SubjectGroup`s, not Sections), so there is nothing to grant. This
 * decides whether a given slot should bind a teaching grant; the service does the
 * idempotent upsert/revoke.
 */

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
