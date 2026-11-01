/**
 * Comment read confirmation resolvers (D-#886).
 *
 *   myUnreadStudentComments   — GUARDIAN (guardian:read_child): the pop-up queue, the
 *                               caller's own active children only (resolved server-side).
 *   confirmStudentCommentRead — GUARDIAN: "পড়েছি"; refused for another family's comment.
 *   unreadStudentCommentsPage — STAFF (student_comments:read_status): the Office's
 *                               not-read-yet list (paged, D-#761).
 *
 * The per-comment `guardianReadAt` / `readConfirmRequired` fields live on the existing
 * staff comment types (studentComment.ts, studentProfile.ts) behind the same permission.
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  confirmCommentRead,
  myUnreadComments,
  unreadCommentsPage,
  type GuardianUnreadComment,
  type UnreadCommentRow,
} from "../services/CommentReadService";

/** May this caller see whether a family has read a comment? (Field-level gate.) */
export function canSeeReadStatus(ctx: AppContext): boolean {
  return !!ctx.auth && callerHasPermission(ctx.auth, "student_comments:read_status");
}

const GuardianUnreadCommentRef = builder.objectRef<GuardianUnreadComment>("GuardianUnreadComment");
GuardianUnreadCommentRef.implement({
  description:
    "A delivered daily comment about one of the guardian's children that still waits for \"পড়েছি\" (D-#886). " +
    "Guardian shape: no author, section or delivery channels.",
  fields: (t) => ({
    id: t.exposeString("id"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    type: t.exposeString("type"),
    sentiment: t.exposeString("sentiment"),
    text: t.exposeString("text"),
    attachmentIds: t.exposeStringList("attachmentIds"),
    deliveredAt: t.exposeString("deliveredAt"),
  }),
});

builder.queryField("myUnreadStudentComments", (t) =>
  t.field({
    type: [GuardianUnreadCommentRef],
    description: "The guardian's comment pop-up queue, oldest first (D-#886). Own active children only.",
    authScopes: { hasPermission: "guardian:read_child" },
    resolve: (_r, _a, ctx) => myUnreadComments(ctx.auth!.userId as string),
  }),
);

builder.mutationField("confirmStudentCommentRead", (t) =>
  t.field({
    type: "Boolean",
    description:
      "The guardian tapped \"পড়েছি\" (D-#886). Stamps the first confirmation; true when this call recorded it, " +
      "false when it was already recorded. Audited.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { commentId: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => confirmCommentRead(ctx.auth!.userId as string, args.commentId),
  }),
);

const UnreadCommentRowRef = builder.objectRef<UnreadCommentRow>("UnreadStudentComment");
UnreadCommentRowRef.implement({
  description: "A sent comment the family has not confirmed reading yet — the Office's follow-up row (D-#886).",
  fields: (t) => ({
    id: t.exposeString("id"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    classLabel: t.exposeString("classLabel"),
    authorName: t.exposeString("authorName"),
    type: t.exposeString("type"),
    sentiment: t.exposeString("sentiment"),
    text: t.exposeString("text"),
    deliveredAt: t.exposeString("deliveredAt"),
    phone: t.string({ nullable: true, resolve: (r) => r.phone }),
    hasAppLogin: t.exposeBoolean("hasAppLogin"),
  }),
});

const UnreadCommentPageRef = pageRef("UnreadStudentCommentPage", UnreadCommentRowRef);

builder.queryField("unreadStudentCommentsPage", (t) =>
  t.field({
    type: UnreadCommentPageRef,
    description: "Sent comments no one in the family has confirmed reading, oldest first (D-#886). Paged (D-#761).",
    authScopes: { hasPermission: "student_comments:read_status" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return unreadCommentsPage(args);
    },
  }),
);
