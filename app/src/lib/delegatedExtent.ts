/**
 * delegatedClassReach — which classes a DELEGATION grant (ACS-1, D-#484) puts within
 * reach of the class picker.
 *
 * A delegation reaches its work through an EXTENT, never through a `sectionId`, which
 * only a `teaching` grant carries. The picker's other three sources — teaching scopes,
 * class-teacher sections, routine slots — all key on a section id, so before this
 * existed a teacher whose only grant was a whole-school duty landed on an EMPTY class
 * list: the server would have accepted every write (`assertCanRead` / `assertCanWrite`
 * honour the extent, D-#485/#486) and the app offered no class to perform it on. The
 * duty was real, enforceable, and unreachable.
 *
 * Two rules here are not obvious and are the reason this is a named function:
 *
 *  1. `subject_dept` is DELIBERATELY not in reach. `extentCovers` answers it
 *     `!!subjectId && s.subjectId === subjectId`, and the tracker reads call
 *     `assertCanRead(sectionId, classId)` with NO subject — so such a grant fails the
 *     read gate on every section as the server stands today. Listing its classes would
 *     build a picker whose every entry 403s the moment it is opened, which is worse
 *     than the empty list it replaced. The other three extents all answer true with no
 *     subject named, which is exactly why they are the ones included.
 *
 *  2. Expiry is re-checked HERE. A lapsed delegation keeps `active: true` — it survives
 *     as history and the window is enforced at request time instead (D-#488) — so a
 *     reader that trusts `active` alone offers classes every mutation then refuses.
 *
 * Delegations only. A `supervisory` grant shares the extent vocabulary and carries the
 * same read, but no write; surfacing it here would hand an oversight-only holder a full
 * set of lifecycle controls that the write gate refuses — the dishonest rendering D-#388
 * exists to avoid.
 *
 * Pure (no React / React Native / `labels` import) so the server suite can unit-test it,
 * the route `homeworkText.ts`, `nameList.ts` and `attachRows.ts` already take.
 */

/** The picker-relevant shape of one `myScopes` row. */
export interface ExtentGrantLike {
  kind: string;
  active: boolean;
  extent: string | null;
  classId: string | null;
  explicitSet: readonly { classId: string }[] | null;
  /** ISO instant; null/absent = open-ended. */
  expiresAt: string | null;
}

export interface DelegatedReach {
  /** Every active class is in reach — the caller skips `classIds` entirely. */
  wholeSchool: boolean;
  /** Class ids reached by a class-shaped extent. Empty when `wholeSchool` is true. */
  classIds: Set<string>;
}

export function delegatedClassReach(
  grants: readonly ExtentGrantLike[],
  now: number = Date.now(),
): DelegatedReach {
  let wholeSchool = false;
  const classIds = new Set<string>();

  for (const g of grants) {
    if (!g.active || g.kind !== "delegation") continue;
    if (g.expiresAt) {
      const at = new Date(g.expiresAt).getTime();
      // An unparseable stamp is treated as live rather than silently revoking a real
      // grant — the server is the gate either way, and failing closed here would hide
      // a class the holder is entitled to.
      if (!Number.isNaN(at) && at <= now) continue;
    }
    switch (g.extent) {
      case "whole_school":
        wholeSchool = true;
        break;
      case "grade_class":
        if (g.classId) classIds.add(g.classId);
        break;
      case "explicit_set":
        for (const e of g.explicitSet ?? []) classIds.add(e.classId);
        break;
      // subject_dept: see (1) above — not reachable through the subject-less read gate.
      default:
        break;
    }
  }

  return { wholeSchool, classIds: wholeSchool ? new Set<string>() : classIds };
}
