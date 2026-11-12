/**
 * Partner subjects for objective prerequisites (PR-P, brief 6 §7).
 * A 2nd-paper row may name a live 1st-paper row (same or earlier class) as its earlier step.
 * One direction only: a 1st-paper row never names a 2nd-paper row. No other pair.
 * (Kept out of vocab.ts, the contract file, beside the MASTERY_SUBJECTS list it refers to.)
 */
export const MASTERY_PARTNER_SUBJECT: Readonly<Record<string, string>> = { BAN2: "BAN", ENG2: "ENG" };

/** The subject whose live codes `subject`'s prerequisites may also name, or null. */
export function masteryPartnerSubject(subject: string): string | null {
  return MASTERY_PARTNER_SUBJECT[subject] ?? null;
}

/** Subjects a prerequisite of a `subject` row may belong to: its own, plus its partner. */
export function masteryPrereqSubjects(subject: string): string[] {
  const p = masteryPartnerSubject(subject);
  return p ? [subject, p] : [subject];
}
