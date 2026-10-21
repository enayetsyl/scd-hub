/**
 * Vocab authorization gates (VC-1/VC-2; D-#126/#127). Extracted from the resolvers
 * (no `builder` import here) so the DENY paths are unit-testable with mocks — closing
 * the VC-1 coordinator follow-up (resolver gate deny-paths previously uncovered).
 *
 * Both gates compose the `vocab_test:*` catalogue actions (PM, D-#790–#801) with the
 * existing scope machinery:
 *   - `assertCanManageClassLevel` (word bank, §7 J1): `vocab_test:edit` + a teaching/
 *     proxy scope at the class level.
 *   - `assertCanOperateVocab` (test build/mark, §5): `vocab_test:create` /
 *     `vocab_test:enter_results` + the assigned tester OR an active proxy on the section.
 * `vocab_test:edit_all` (PRINCIPAL-DEFAULT) lifts the scope/designation — it replaces the
 * old `role === "PRINCIPAL"` bypass. The old Office hard-deny is replaced too: Office
 * holds none of these actions by default (so it is still refused), and passes only once
 * granted the action AND holding the scope/designation, or `edit_all`. A GUARDIAN login
 * is always refused (plane check).
 *
 * The resolver's authScopes name the action or `edit_all`; these add the row/class-level
 * reach on top (ADR-004 posture).
 */
import { callerHasPermission, type Permission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError, resolveTeacherScopes } from "../../../middleware/authz";
import { Class } from "../../foundation/models/Class";
import { currentAssignment, isVocabOperator } from "./VocabAssignmentService";

/** `vocab_test:edit_all` — run any শাখা's vocab (was the PRINCIPAL role bypass). */
function holdsEditAll(ctx: AppContext): boolean {
  return !!ctx.auth && callerHasPermission(ctx.auth, "vocab_test:edit_all");
}

/** The action half of a designation gate: a staff login holding `action`. */
function assertHoldsAction(ctx: AppContext, action: Permission): void {
  if (!ctx.auth || ctx.auth.role === "GUARDIAN" || !callerHasPermission(ctx.auth, action)) {
    throw new ForbiddenError();
  }
}

/**
 * Assert the caller may MANAGE the word bank for `classLevel`. `vocab_test:edit_all` →
 * unscoped; otherwise `vocab_test:edit` + a teaching/proxy scope on a section whose
 * Class sits at that level. Mirrors `assertCanWrite` but resolves to a CLASS LEVEL (the
 * bank's grain is per program × classLevel).
 */
export async function assertCanManageClassLevel(ctx: AppContext, classLevel: number): Promise<void> {
  if (holdsEditAll(ctx)) return;
  assertHoldsAction(ctx, "vocab_test:edit");
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
 * Assert the caller may BUILD (`vocab_test:create`) or MARK (`vocab_test:enter_results`)
 * a test for (section × program × week). `vocab_test:edit_all` → unscoped; otherwise the
 * action + the current assigned tester OR an active proxy on the section (§5).
 */
export async function assertCanOperateVocab(
  ctx: AppContext,
  sectionId: string,
  program: string,
  weekOf: Date,
  action: Extract<Permission, "vocab_test:create" | "vocab_test:enter_results"> = "vocab_test:create",
): Promise<void> {
  if (holdsEditAll(ctx)) return;
  assertHoldsAction(ctx, action);
  const current = await currentAssignment(sectionId, program, weekOf);
  const scopes = await resolveTeacherScopes(ctx);
  if (!isVocabOperator(ctx.auth!.userId, sectionId, current, scopes)) {
    throw new ForbiddenError("Only the assigned vocab tester or a covering teacher may build/mark this test");
  }
}
