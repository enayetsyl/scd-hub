/**
 * Observation scope (HR-4; prd-hr §5.1/H5.2, D-#28) — the bounded supervisor
 * observation-WRITE gate.
 *
 * D-#28 grants a supervisor (Class Teacher / Coordinator / Subject Lead) a narrow
 * write INSIDE their existing supervisory `ScopeGrant` extent — NO new role, NO new
 * permission. This composes that authority from the EXISTING supervisory scope
 * (the D-#94 pattern): an observation names the class/subject it was made in, and a
 * teacher may submit it only if a SUPERVISORY scope of theirs covers that extent.
 *
 * Teaching / proxy scope does NOT grant observation-write (supervisory is the
 * oversight overlay, D-#17/#28). Principal/Office reach all observations via
 * `performance:manage` (checked in the resolver before this helper).
 *
 * Pure predicate (`supervisoryCovers`) is unit-tested directly; the async resolver
 * builds the caller's scope union (reusing `composeTeacherScope`) and applies it.
 */
import type { ScopeItem } from "../../foundation/services/ScopeGrantService";
import { composeTeacherScope } from "../../foundation/services/ScopeGrantService";

/**
 * Does any SUPERVISORY scope in the union cover the observation's (class, subject)?
 * whole_school covers everything; grade_class matches the class; subject_dept matches
 * the subject; explicit_set matches a (class, subject) pair. An observation may carry
 * only a class or only a subject — a covering scope must still positively match the
 * field(s) that ARE present (an observation with neither is not coverable → false).
 */
export function supervisoryCovers(
  scopes: ScopeItem[],
  classId?: string | null,
  subjectId?: string | null,
): boolean {
  if (!classId && !subjectId) return false;
  for (const s of scopes) {
    if (s.kind !== "supervisory") continue;
    switch (s.extent) {
      case "whole_school":
        return true;
      case "grade_class":
        if (classId && s.classId === classId) return true;
        break;
      case "subject_dept":
        if (subjectId && s.subjectId === subjectId) return true;
        break;
      case "explicit_set":
        if (
          s.explicitSet?.some(
            (e) =>
              (!classId || e.classId === classId) &&
              (!subjectId || e.subjectId === subjectId),
          )
        )
          return true;
        break;
    }
  }
  return false;
}

/** True if the user may observe within the given (class, subject) — supervisory only. */
export async function userCanObserve(
  userId: string,
  classId?: string | null,
  subjectId?: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  const { scopes } = await composeTeacherScope(userId, now);
  return supervisoryCovers(scopes, classId, subjectId);
}
