/**
 * Content read scope (D-#257) — a teacher sees a content artifact `(subject, classLevel)`
 * iff their routine-/admin-granted scope covers it:
 *   • TEACHING grant (routine-bound, D-#49): the exact (subject, class) they teach;
 *   • active PROXY grant: any content subject for the covered class, for the cover window;
 *   • SUPERVISORY: whole_school (all) / subject_dept (subject) / grade_class (class) /
 *     explicit_set (subject+class).
 *
 * So adding a teacher to the routine for a subject (→ teaching grant) makes that subject's
 * content visible with NO extra permission; removing them (→ grant revoked) hides it
 * immediately; a proxy sees the covered class's content only while the proxy window is live.
 *
 * Built ONCE per request (the teacher's grants + Subject/Class id→code/level maps), then
 * checked per artifact — no per-doc DB hit.
 */
import { callerHasPermission, type Permission } from "@scd/shared";
import type { AppContext } from "../../context";
import { resolveTeacherScopes } from "../../middleware/authz";
import { Subject } from "../foundation/models/Subject";
import { Class } from "../foundation/models/Class";

export interface ContentScope {
  /** Sees everything (holds the read's `view_all` action, or a whole_school supervisory grant). */
  all: boolean;
  /** subject_dept supervisory — these subject codes, across any class. */
  subjects: Set<string>;
  /** grade_class supervisory — these class levels, across any subject. */
  classLevels: Set<number>;
  /** teaching + active proxy + explicit_set — exact "SUBJECT|level" pairs. */
  pairs: Set<string>;
}

const key = (subjectCode: string, classLevel: number): string => `${subjectCode}|${classLevel}`;

/**
 * `viewAll` is the action that lifts the row limit for THIS read (PM, D-#790; was the
 * PRINCIPAL/OFFICE primary role): `lesson_plans:view_all` on the plan reads,
 * `question_bank:view_all` on the question reads. Template- and grant-aware, so a
 * teacher who also wears the OFFICE template now gets the lift (2H, F-27).
 */
export async function buildContentScope(ctx: AppContext, viewAll: Permission): Promise<ContentScope> {
  const scope: ContentScope = { all: false, subjects: new Set(), classLevels: new Set(), pairs: new Set() };
  const role = ctx.auth?.role;
  if (!ctx.auth || role === "GUARDIAN") return scope; // default-deny
  if (callerHasPermission(ctx.auth, viewAll)) {
    scope.all = true;
    return scope;
  }

  const scopes = await resolveTeacherScopes(ctx);
  const [subjects, classes] = await Promise.all([
    Subject.find({}).select("code").lean(),
    Class.find({}).select("level").lean(),
  ]);
  const codeById = new Map(subjects.map((s) => [s._id.toString(), s.code]));
  const levelById = new Map(classes.map((c) => [c._id.toString(), c.level]));

  for (const s of scopes) {
    if (s.kind === "teaching") {
      const code = codeById.get(s.subjectId);
      const lvl = levelById.get(s.classId);
      if (code && lvl != null) scope.pairs.add(key(code, lvl));
    } else if (s.kind === "proxy") {
      // A cover is per-subject (D-#257): the proxy sees only the covered subject's
      // content for its class, while the proxy window is live. No subject ⇒ no content.
      const code = s.subjectId ? codeById.get(s.subjectId) : undefined;
      const lvl = levelById.get(s.classId);
      if (code && lvl != null) scope.pairs.add(key(code, lvl));
    } else if (s.kind === "supervisory") {
      switch (s.extent) {
        case "whole_school":
          scope.all = true;
          break;
        case "subject_dept": {
          const code = s.subjectId ? codeById.get(s.subjectId) : undefined;
          if (code) scope.subjects.add(code);
          break;
        }
        case "grade_class": {
          const lvl = s.classId ? levelById.get(s.classId) : undefined;
          if (lvl != null) scope.classLevels.add(lvl);
          break;
        }
        case "explicit_set":
          for (const e of s.explicitSet ?? []) {
            const code = codeById.get(e.subjectId);
            const lvl = levelById.get(e.classId);
            if (code && lvl != null) scope.pairs.add(key(code, lvl));
          }
          break;
      }
    }
  }
  return scope;
}

export function contentScopeAllows(scope: ContentScope, subjectCode: string, classLevel: number): boolean {
  return (
    scope.all ||
    scope.subjects.has(subjectCode) ||
    scope.classLevels.has(classLevel) ||
    scope.pairs.has(key(subjectCode, classLevel))
  );
}

/**
 * Push the content scope INTO a Mongo query as an `$or` on ContentArtifact's
 * `(subject, classLevel)` — so a paginated/large read can be scoped in the DB
 * (skip/limit works, no per-doc post-filter loop). Returns:
 *   • `undefined` — unrestricted (`view_all` holder / whole_school): add nothing.
 *   • `null`      — the caller sees NOTHING: the query should return [].
 *   • `{ $or }`   — merge into the filter (`filter.$or = result.$or`).
 */
export function contentScopeMongo(
  scope: ContentScope,
): { $or: Record<string, unknown>[] } | null | undefined {
  if (scope.all) return undefined;
  const or: Record<string, unknown>[] = [];
  if (scope.subjects.size > 0) or.push({ subject: { $in: [...scope.subjects] } });
  if (scope.classLevels.size > 0) or.push({ classLevel: { $in: [...scope.classLevels] } });
  for (const p of scope.pairs) {
    const [code, lvl] = p.split("|");
    or.push({ subject: code, classLevel: Number(lvl) });
  }
  return or.length > 0 ? { $or: or } : null;
}
