/**
 * observationAnchor — which SubjectGroup track an observation subject is taught on.
 *
 * PURE module (no React / React Native / `labels` import) so the server suite can
 * unit-test it, the posture `nameList.ts`, `attachRows.ts` and `delegatedExtent.ts`
 * already take — the app workspace has no test runner of its own.
 *
 * Quran AND Arabic are cross-grade, gender-split GROUPS (D-#48/#56): a student is
 * placed by LEVEL — Quran: Qaida/Ammapara/Najera/Hifz 1–3; Arabic: Book 1/2/3 — and
 * progresses independent of their general class, so neither subject belongs to a
 * class section at all. Their routine slots, attendance and class-notes all run
 * against the group; only general subjects run against a `Section`.
 *
 * This matters beyond tidiness because the SERVER does not check it: `assertAnchor`
 * in `ClassroomObservationService` requires exactly one of sectionId/subjectGroupId
 * and that form ↔ subject agree, but it never loads the group, so it would accept an
 * ARABIC observation anchored to a Quran group (or to a group id that exists nowhere).
 * Filtering the picker by track is therefore the only thing standing between the
 * uploader and a row anchored to a session that never happened.
 */

/** The two tracks a `SubjectGroup` can belong to (mirrors the model's enum). */
export type SubjectGroupTrack = "quran" | "arabic";

/**
 * The track to filter the subject-group picker by, or `null` for "no track of its
 * own" — a general subject, which is section-anchored in practice and so is offered
 * every live group rather than none (a cross-grade general session stays possible).
 */
export function groupTrackForSubject(subject: string | null | undefined): SubjectGroupTrack | null {
  if (subject === "QURAN") return "quran";
  if (subject === "ARABIC") return "arabic";
  return null;
}

/**
 * Does this subject sit in a group rather than a class section? Drives the anchor
 * default on the upload form: picking Quran or Arabic moves the anchor off Section,
 * because there is no section that sat the session.
 */
export function isGroupTaughtSubject(subject: string | null | undefined): boolean {
  return groupTrackForSubject(subject) !== null;
}
