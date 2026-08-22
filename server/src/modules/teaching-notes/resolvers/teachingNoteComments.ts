/**
 * Teaching-note comment resolvers (TN-2, prd-teaching-notes). No new permission:
 *
 *   teachingNoteComments      — authenticated; the thread for a note's IDENTITY
 *                               (any version's id returns the same thread).
 *   openTeachingNoteComments  — roster:manage; the Principal's cross-subject
 *                               "still outstanding" list.
 *   addTeachingNoteComment    — authenticated; anyone who may read the note.
 *   setTeachingNoteCommentStatus — the note's uploader or roster:manage.
 *   addressTeachingNoteComments  — same, in bulk (offered after a new version).
 *   deleteTeachingNoteComment    — the author (soft) or roster:manage.
 */
import { builder } from "../../../schema";
import {
  teachingNoteComments,
  openTeachingNoteComments,
  addTeachingNoteComment,
  setTeachingNoteCommentStatus,
  addressTeachingNoteComments,
  deleteTeachingNoteComment,
  type TeachingNoteCommentShape,
} from "../services/TeachingNoteCommentService";

const TeachingNoteCommentRef =
  builder.objectRef<TeachingNoteCommentShape>("TeachingNoteComment");
TeachingNoteCommentRef.implement({
  description:
    "One teacher's improvement comment on a teaching note. Anchored to the note's IDENTITY, " +
    "not the version row, so the thread survives a replacement; versionSeen records which " +
    "version the author was reading.",
  fields: (t) => ({
    id: t.exposeString("id"),
    noteId: t.exposeString("noteId"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    kind: t.exposeString("kind"),
    seq: t.exposeInt("seq"),
    versionSeen: t.exposeInt("versionSeen"),
    bodyBn: t.exposeString("bodyBn"),
    anchor: t.string({ nullable: true, resolve: (r) => r.anchor }),
    authorId: t.exposeString("authorId"),
    authorName: t.string({ nullable: true, resolve: (r) => r.authorName }),
    status: t.exposeString("status"),
    addressedByName: t.string({ nullable: true, resolve: (r) => r.addressedByName }),
    addressedAt: t.string({ nullable: true, resolve: (r) => r.addressedAt }),
    addressedNote: t.string({ nullable: true, resolve: (r) => r.addressedNote }),
    createdAt: t.exposeString("createdAt"),
    staleForCurrentVersion: t.exposeBoolean("staleForCurrentVersion"),
    currentVersion: t.exposeInt("currentVersion"),
    noteTitle: t.exposeString("noteTitle"),
  }),
});

builder.queryField("teachingNoteComments", (t) =>
  t.field({
    type: [TeachingNoteCommentRef],
    description:
      "The comment thread for a note's identity, oldest first. Passing ANY version's id " +
      "returns the same thread — that is the point of the anchor.",
    authScopes: { authenticated: true },
    args: { noteId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => teachingNoteComments(ctx, args.noteId),
  }),
);

builder.queryField("openTeachingNoteComments", (t) =>
  t.field({
    type: [TeachingNoteCommentRef],
    description:
      "Every OPEN comment across the whole library, newest first — the Principal's outstanding " +
      "list. Requires roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    resolve: async (_root, _args, ctx) => openTeachingNoteComments(ctx),
  }),
);

builder.mutationField("addTeachingNoteComment", (t) =>
  t.field({
    type: TeachingNoteCommentRef,
    description:
      "Leave an improvement comment on a teaching note. Allowed to anyone who may read it; " +
      "many comments per teacher and many teachers per note. Audited.",
    authScopes: { authenticated: true },
    args: {
      noteId: t.arg.string({ required: true }),
      bodyBn: t.arg.string({ required: true }),
      anchor: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      addTeachingNoteComment(ctx, {
        noteId: args.noteId,
        bodyBn: args.bodyBn,
        anchor: args.anchor ?? null,
      }),
  }),
);

builder.mutationField("setTeachingNoteCommentStatus", (t) =>
  t.field({
    type: TeachingNoteCommentRef,
    description:
      "Mark a comment ADDRESSED (or reopen it as OPEN). The note's uploader or roster:manage — " +
      "a teacher cannot close their own feedback loop. Audited.",
    authScopes: { authenticated: true },
    args: {
      commentId: t.arg.string({ required: true }),
      status: t.arg.string({ required: true }),
      addressedNote: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      setTeachingNoteCommentStatus(ctx, {
        commentId: args.commentId,
        status: args.status,
        addressedNote: args.addressedNote ?? null,
      }),
  }),
);

builder.mutationField("addressTeachingNoteComments", (t) =>
  t.field({
    type: "Int",
    description:
      "Mark several open comments ADDRESSED at once — offered right after a new version is " +
      "uploaded. Returns how many were closed.",
    authScopes: { authenticated: true },
    args: {
      commentIds: t.arg.stringList({ required: true }),
      addressedNote: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      addressTeachingNoteComments(ctx, {
        commentIds: args.commentIds,
        addressedNote: args.addressedNote ?? null,
      }),
  }),
);

builder.mutationField("deleteTeachingNoteComment", (t) =>
  t.field({
    type: "Boolean",
    description:
      "Soft-delete a comment — the author, or roster:manage. The row is retained (deletedAt) so " +
      "a supervised thread cannot lose entries without trace. Audited.",
    authScopes: { authenticated: true },
    args: { commentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => deleteTeachingNoteComment(ctx, args.commentId),
  }),
);
