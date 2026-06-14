/**
 * Student-comment (daily observation log) resolvers (CM-1, prd-comments-meetings
 * §3/§5/§6, D-#114/#115).
 *
 * RBAC — composes EXISTING permissions only (D-#17/#94, no new role/permission):
 *   - Record / edit a comment (`recordStudentComment` / `editStudentComment`):
 *     `tracker:write` + `assertCanWrite` on the comment's REAL section (resolved
 *     server-side from the student, never client-supplied). `editStudentComment` is
 *     additionally AUTHOR-ONLY and refused once delivered (enforced in the service).
 *   - Reads (`sectionStudentComments` / `studentComments`): `tracker:read`; teachers
 *     additionally need read-scope on the section (Principal/Office are unscoped).
 *
 * NO delivery here (no emit()/wa.me) — that is CM-2. The guardian-facing
 * delivered-only read is CM-5. Identity plane (names studentIds); no corpus path.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import {
  resolveCommentSection,
  recordComment,
  editComment,
  listSectionComments,
  studentComments,
  type StudentCommentShape,
} from "../services/StudentCommentService";
import { StudentComment } from "../models/StudentComment";
import { Section } from "../../foundation/models/Section";
import { assertCanWrite, assertCanRead, ForbiddenError } from "../../../middleware/authz";

/** Enforce staff read-scope on a section (teachers only; Principal/Office unscoped). */
async function assertReadSection(ctx: AppContext, sectionId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role === "PRINCIPAL" || ctx.auth.role === "OFFICE") return;
  const section = await Section.findById(sectionId).lean();
  if (!section) throw new ForbiddenError("Section not found");
  await assertCanRead(ctx, sectionId, section.classId.toString());
}

// ---------------------------------------------------------------------------
// GraphQL shape
// ---------------------------------------------------------------------------

const StudentCommentRef = builder.objectRef<StudentCommentShape>("StudentComment");
StudentCommentRef.implement({
  description:
    "A daily teacher observation about a child (CM-1): typed + sentiment + text, subject-free. " +
    "Editable by the author until delivered, then immutable (§3). Identity plane (ADR-005).",
  fields: (t) => ({
    id: t.exposeString("id"),
    studentId: t.exposeString("studentId"),
    sectionId: t.exposeString("sectionId"),
    authorUserId: t.exposeString("authorUserId"),
    type: t.exposeString("type"),
    sentiment: t.exposeString("sentiment"),
    text: t.exposeString("text"),
    attachmentIds: t.exposeStringList("attachmentIds"),
    deliveredAt: t.string({ nullable: true, resolve: (r) => r.deliveredAt }),
    deliveryChannels: t.exposeStringList("deliveryChannels"),
    createdAt: t.exposeString("createdAt"),
    updatedAt: t.exposeString("updatedAt"),
  }),
});

// ---------------------------------------------------------------------------
// Mutations (tracker:write + section verify; edit is author-only/pre-delivery)
// ---------------------------------------------------------------------------

builder.mutationField("recordStudentComment", (t) =>
  t.field({
    type: StudentCommentRef,
    description:
      "Record one daily student comment (J-CM1): type + sentiment + text [+ optional attachments]. " +
      "The author is the authenticated teacher; the section is resolved server-side from the student. " +
      "Requires tracker:write on that section. NO delivery yet (CM-2). Audited.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      studentId: t.arg.string({ required: true }),
      type: t.arg.string({ required: true }),
      sentiment: t.arg.string({ required: true }),
      text: t.arg.string({ required: true }),
      attachmentIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const sectionId = await resolveCommentSection(args.studentId);
      await assertCanWrite(ctx, sectionId);
      return recordComment({
        studentId: args.studentId,
        sectionId,
        type: args.type,
        sentiment: args.sentiment,
        text: args.text,
        attachmentIds: args.attachmentIds ?? undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("editStudentComment", (t) =>
  t.field({
    type: StudentCommentRef,
    description:
      "Edit an undelivered student comment (author-only; refused once delivered — §3). " +
      "Requires tracker:write on the comment's section. Audited.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      commentId: t.arg.string({ required: true }),
      type: t.arg.string({ required: false }),
      sentiment: t.arg.string({ required: false }),
      text: t.arg.string({ required: false }),
      attachmentIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const comment = await StudentComment.findById(args.commentId).select("sectionId").lean();
      if (!comment) throw new ForbiddenError("Comment not found");
      await assertCanWrite(ctx, comment.sectionId.toString());
      return editComment({
        commentId: args.commentId,
        type: args.type ?? undefined,
        sentiment: args.sentiment ?? undefined,
        text: args.text ?? undefined,
        attachmentIds: args.attachmentIds ?? undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries (tracker:read + section read-scope for teachers)
// ---------------------------------------------------------------------------

builder.queryField("sectionStudentComments", (t) =>
  t.field({
    type: [StudentCommentRef],
    description: "Every daily comment on a section, newest first (the staff worklist). Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: { sectionId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertReadSection(ctx, args.sectionId);
      return listSectionComments(args.sectionId);
    },
  }),
);

builder.queryField("studentComments", (t) =>
  t.field({
    type: [StudentCommentRef],
    description:
      "A child's full daily-comment history, newest first (the staff timeline; the guardian-facing " +
      "delivered-only read is CM-5). Requires tracker:read + read-scope on the child's section.",
    authScopes: { hasPermission: "tracker:read" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const sectionId = await resolveCommentSection(args.studentId);
      await assertReadSection(ctx, sectionId);
      return studentComments(args.studentId);
    },
  }),
);
