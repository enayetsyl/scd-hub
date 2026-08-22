/**
 * Teaching Notes resolvers (TN-1, prd-teaching-notes). No new permission
 * (D-#513) — upload rides `roster:manage`, reads ride the caller's teaching
 * scope, resolved in the service:
 *
 *   teachingNotes         — authenticated; the (class × subject) library, scoped.
 *   teachingNote          — authenticated; one note WITH contentMd, scope-checked.
 *   teachingNoteVersions  — authenticated; the retained version history.
 *   teachingNoteMyScope   — authenticated; the caller's readable (class, subject)
 *                           pairs — the drawer gate + the picker ([] hides the tab).
 *   uploadTeachingNote    — roster:manage (Principal/Office): create/replace.
 *
 * Operational plane; no corpus path (ADR-005); no guardian path.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  teachingNotes,
  teachingNoteById,
  teachingNoteVersions,
  myTeachingNoteScope,
  uploadTeachingNote,
  sendTeachingNoteToPrint,
  type TeachingNoteShape,
  type TeachingNoteUploadResult,
  type TeachingNoteScopePair,
  type TeachingNotePrintResult,
} from "../services/TeachingNoteService";

const TeachingNoteRef = builder.objectRef<TeachingNoteShape>("TeachingNote");
TeachingNoteRef.implement({
  description:
    "One teacher-facing pedagogy note for a (class × subject) — answer guide, lesson note or " +
    "syllabus. Library lists carry metadata only (contentMd null); the single read includes it.",
  fields: (t) => ({
    id: t.exposeString("id"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    kind: t.exposeString("kind"),
    seq: t.exposeInt("seq"),
    title: t.exposeString("title"),
    version: t.exposeInt("version"),
    format: t.exposeString("format"),
    fileId: t.string({ nullable: true, resolve: (r) => r.fileId }),
    pdfFileId: t.string({ nullable: true, resolve: (r) => r.pdfFileId }),
    fileName: t.string({ nullable: true, resolve: (r) => r.fileName }),
    fileMime: t.string({ nullable: true, resolve: (r) => r.fileMime }),
    uploadedAt: t.exposeString("uploadedAt"),
    uploadedById: t.exposeString("uploadedById"),
    uploadedByName: t.string({ nullable: true, resolve: (r) => r.uploadedByName }),
    contentMd: t.string({ nullable: true, resolve: (r) => r.contentMd }),
    commentCount: t.exposeInt("commentCount"),
    openCommentCount: t.exposeInt("openCommentCount"),
  }),
});

const TeachingNoteScopePairRef =
  builder.objectRef<TeachingNoteScopePair>("TeachingNoteScopePair");
TeachingNoteScopePairRef.implement({
  description: "A (class level, subject) pair the caller may read notes for.",
  fields: (t) => ({
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
  }),
});

const TeachingNoteUploadResultRef =
  builder.objectRef<TeachingNoteUploadResult>("TeachingNoteUploadResult");
TeachingNoteUploadResultRef.implement({
  fields: (t) => ({
    note: t.field({ type: TeachingNoteRef, resolve: (r) => r.note }),
    replacedVersion: t.int({ nullable: true, resolve: (r) => r.replacedVersion }),
    openCommentCount: t.exposeInt("openCommentCount"),
  }),
});

builder.queryField("teachingNotes", (t) =>
  t.field({
    type: [TeachingNoteRef],
    description:
      "The teaching-note library — the latest note of every (class, subject, kind, seq) the " +
      "caller may see. Teachers get the pairs they teach; Principal/Office all; guardians denied.",
    authScopes: { authenticated: true },
    args: {
      classLevel: t.arg.int({ required: false }),
      subject: t.arg.string({ required: false }),
      kind: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      teachingNotes(ctx, {
        classLevel: args.classLevel ?? null,
        subject: args.subject ?? null,
        kind: args.kind ?? null,
      }),
  }),
);

builder.queryField("teachingNote", (t) =>
  t.field({
    type: TeachingNoteRef,
    description: "One teaching note with its markdown. Scope-checked like the library.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => teachingNoteById(ctx, args.id),
  }),
);

builder.queryField("teachingNoteVersions", (t) =>
  t.field({
    type: [TeachingNoteRef],
    description:
      "Every retained version of one note's identity, newest first — superseded rows are never " +
      "deleted, so an older version stays readable beside the current one.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => teachingNoteVersions(ctx, args.id),
  }),
);

builder.queryField("teachingNoteMyScope", (t) =>
  t.field({
    type: [TeachingNoteScopePairRef],
    description:
      "The (class, subject) pairs the caller may read — the drawer gate and the picker. " +
      "Empty hides the tab; guardians always get [].",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => myTeachingNoteScope(ctx),
  }),
);

const TeachingNotePrintResultRef =
  builder.objectRef<TeachingNotePrintResult>("TeachingNotePrintResult");
TeachingNotePrintResultRef.implement({
  fields: (t) => ({
    printRequestId: t.exposeString("printRequestId"),
    title: t.exposeString("title"),
  }),
});

builder.mutationField("sendTeachingNoteToPrint", (t) =>
  t.field({
    type: TeachingNotePrintResultRef,
    description:
      "File a teaching note into the office print queue. Same read gate as the doc screen — a " +
      "teacher can only print what they can read. Reuses createPrintRequest untouched.",
    authScopes: { authenticated: true },
    args: {
      id: t.arg.string({ required: true }),
      colour: t.arg.string({ required: true }),
      sides: t.arg.string({ required: true }),
      copies: t.arg.int({ required: true }),
      copiesMode: t.arg.string({ required: false }),
      copiesClassId: t.arg.string({ required: false }),
      neededByKey: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      // The use date is MANDATORY (the English Drive posture): the office queue
      // needs to know WHEN the print is used, enforced at this teacher-facing seam.
      if (!args.neededByKey) throw new Error("প্রিন্ট কবে ব্যবহার হবে সেই তারিখ দিন");
      return sendTeachingNoteToPrint(ctx, args);
    },
  }),
);

builder.mutationField("uploadTeachingNote", (t) =>
  t.field({
    type: TeachingNoteUploadResultRef,
    description:
      "Upload one teaching note; an existing (class, subject, kind, seq) is replaced (old row " +
      "stamped replacedAt, retained). Version is server-assigned. Requires roster:manage. Audited.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      classLevel: t.arg.int({ required: true }),
      subject: t.arg.string({ required: true }),
      kind: t.arg.string({ required: true }),
      seq: t.arg.int({ required: false }),
      title: t.arg.string({ required: true }),
      format: t.arg.string({ required: false }),
      contentMd: t.arg.string({ required: false }),
      fileId: t.arg.string({ required: false }),
      pdfFileId: t.arg.string({ required: false }),
      fileName: t.arg.string({ required: false }),
      fileMime: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return uploadTeachingNote({
        ...args,
        actorId: ctx.auth.userId as string,
        actorRole: ctx.auth.role,
      });
    },
  }),
);
