/**
 * Student-comment DELIVERY resolver (CM-2, prd-comments-meetings §6, J-CM1, D-#172).
 *
 * RBAC — composes EXISTING permissions only (D-#17/#94, no new role/permission):
 *   - `deliverStudentComment`: `tracker:write` + `assertCanWrite` on the comment's
 *     REAL section (resolved server-side from the stored comment, never client-
 *     supplied) — exactly the CM-1 record/edit posture. Office + Guardians denied.
 *
 * Delivery stamps `deliveredAt` (which SEALS the CM-1 immutability) + `deliveryChannels`,
 * builds a wa.me link for every family with a phone (ADR-003), and emits an in-app
 * Notification (kind STUDENT_COMMENT) for login-enabled guardians (D-#72). The
 * attachment upload route lives in `routes/files.ts` (POST /files/comment). Identity
 * plane; no corpus path.
 */
import { builder } from "../../../schema";
import { deliverComment, type CommentDeliveryOutcome } from "../services/CommentDeliveryService";
import { StudentComment } from "../models/StudentComment";
import { assertCanWrite, ForbiddenError } from "../../../middleware/authz";

const CommentDeliveryOutcomeRef = builder.objectRef<CommentDeliveryOutcome>("CommentDeliveryOutcome");
CommentDeliveryOutcomeRef.implement({
  description:
    "The result of delivering ONE daily student comment (CM-2, J-CM1): the rendered Bangla body, a " +
    "wa.me link for the family (ADR-003; null when no phone → unreachableByWa), and the login-enabled " +
    "guardians who got an in-app Notification (D-#72).",
  fields: (t) => ({
    commentId: t.exposeString("commentId"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    messageBn: t.exposeString("messageBn"),
    waLink: t.string({ nullable: true, resolve: (r) => r.waLink }),
    unreachableByWa: t.exposeBoolean("unreachableByWa"),
    notifiedGuardianIds: t.exposeStringList("notifiedGuardianIds"),
    deliveryChannels: t.exposeStringList("deliveryChannels"),
    deliveredAt: t.exposeString("deliveredAt"),
  }),
});

builder.mutationField("deliverStudentComment", (t) =>
  t.field({
    type: CommentDeliveryOutcomeRef,
    description:
      "Deliver one daily student comment to the family (J-CM1): stamps deliveredAt (sealing immutability) " +
      "+ deliveryChannels, returns a wa.me link for the family phone, and emits an in-app Notification for " +
      "login-enabled guardians. Per-comment (mirrors the Form's per-row send). Requires tracker:write on " +
      "the comment's section. Audited.",
    authScopes: { hasPermission: "tracker:write" },
    args: { commentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const comment = await StudentComment.findById(args.commentId).select("sectionId authorUserId").lean();
      if (!comment) throw new ForbiddenError("Comment not found");
      // The author may always deliver their OWN comment (D-#263); a non-author still
      // needs section write-scope (Principal/Office + scoped teachers deliver others').
      if (comment.authorUserId.toString() !== (ctx.auth.userId as string)) {
        await assertCanWrite(ctx, comment.sectionId.toString());
      }
      return deliverComment(args.commentId, ctx.auth.userId as string);
    },
  }),
);
