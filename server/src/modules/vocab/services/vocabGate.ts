/**
 * Vocab authorization gates (VC-1/VC-2; D-#126/#127). Extracted from the resolvers
 * (no `builder` import here) so the DENY paths are unit-testable with mocks — closing
 * the VC-1 coordinator follow-up (resolver gate deny-paths previously uncovered).
 *
 * Both gates compose EXISTING scope/permission machinery — no new role/permission:
 *   - `assertCanManageClassLevel` (word bank, §7 J1): tracker:write + a teaching/proxy
 *     scope at the class level (Principal unscoped; Office/Guardian denied).
 *   - `assertCanOperateVocab` (test build/mark, §5): the assigned tester OR an active
 *     proxy on the section (Principal unscoped; Office/Guardian denied).
 *
 * The coarse `tracker:write` RBAC is enforced by the resolver's authScopes; these add
 * the row/class-level reach on top (ADR-004 posture).
 */
import type { AppContext } from "../../../context";
import { ForbiddenError, resolveTeacherScopes } from "../../../middleware/authz";
import { Class } from "../../foundation/models/Class";
import { currentAssignment, isVocabOperator } from "./VocabAssignmentService";

/**
 * Assert the caller may MANAGE the word bank for `classLevel`. Principal → unscoped;
 * Teacher → must hold a teaching/proxy scope on a section whose Class sits at that
 * level; Office/Guardian → denied (no tracker:write reach). Mirrors `assertCanWrite`
 * but resolves to a CLASS LEVEL (the bank's grain is per program × classLevel).
 */
export async function assertCanManageClassLevel(ctx: AppContext, classLevel: number): Promise<void> {
  if (ctx.auth?.role === "PRINCIPAL") return;
  if (ctx.auth?.role !== "TEACHER") throw new ForbiddenError();
  const scopes = await resolveTeacherScopes(ctx);
  const writableClassIds = scopes
    .filter((s) => s.kind === "teaching" || s.kind === "proxy")
    .map((s) => (s as { classId: string }).classId);
  if (writableClassIds.length === 0) throw new ForbiddenError();
  const match = await Class.findOne({ _id: { $in: writableClassIds }, level: classLevel })
    .select("_id")
    .lean();
  if (!match) {
    throw new ForbiddenError("You may only manage the word bank for a class level you teach");
  }
}

/**
 * Assert the caller may BUILD/MARK a test for (section × program × week). Principal →
 * unscoped; Teacher → the current assigned tester OR an active proxy on the section
 * (§5); Office/Guardian → denied.
 */
export async function assertCanOperateVocab(
  ctx: AppContext,
  sectionId: string,
  program: string,
  weekOf: Date,
): Promise<void> {
  if (ctx.auth?.role === "PRINCIPAL") return;
  if (ctx.auth?.role !== "TEACHER") throw new ForbiddenError();
  const current = await currentAssignment(sectionId, program, weekOf);
  const scopes = await resolveTeacherScopes(ctx);
  if (!isVocabOperator(ctx.auth.userId, sectionId, current, scopes)) {
    throw new ForbiddenError("Only the assigned vocab tester or a covering teacher may build/mark this test");
  }
}
