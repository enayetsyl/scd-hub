import { callerHasPermission } from "@scd/shared";
import type { Types } from "mongoose";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { buildContentScope, contentScopeAllows } from "../contentScope";
import { reviewerMayReadArtifact } from "./ReviewService";

/**
 * Row-scope (D-#257) for opening ONE artifact: `lesson_plans:view_all` bypasses; anyone else sees
 * it iff a routine teaching/proxy or supervisory grant covers (subject, classLevel).
 * Override (D-#39): a reviewer (plan_review:review / question_review:review) with an
 * active review assignment for this exact version may read it even outside their
 * teaching subject (read-only, artifact-scoped).
 * Shared by `artifact(id)` and the plan-beside-book read (`planBookChapter`) so the two can never drift.
 */
export async function assertMayReadArtifact(ctx: AppContext, doc: { _id: Types.ObjectId; subject: string; classLevel: number }): Promise<void> {
  const scope = await buildContentScope(ctx, "lesson_plans:view_all");
  if (!contentScopeAllows(scope, doc.subject, doc.classLevel)) {
    const mayReview =
      !!ctx.auth &&
      (callerHasPermission(ctx.auth, "plan_review:review") || callerHasPermission(ctx.auth, "question_review:review"));
    if (!(mayReview && (await reviewerMayReadArtifact(ctx.auth!.userId, doc._id)))) throw new ForbiddenError();
  }
}
