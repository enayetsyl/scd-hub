/**
 * English Drive resolvers (D-#344) — the md-import + teacher-library surface.
 * No new permission (PRD §5):
 *
 *   englishDriveDocs          — authenticated; the service scopes to the caller's
 *                               English classes (P/O all; guardian denied).
 *   englishDriveDoc           — authenticated; one doc WITH contentMd, scope-checked.
 *   englishDriveMyClassLevels — authenticated; the caller's class levels (drawer
 *                               gate + class picker; [] hides the tab, guardian []).
 *   uploadEnglishDriveDoc     — roster:manage (Principal/Office): create/replace.
 *
 * Operational plane; no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  englishDriveDocs,
  englishDriveDocById,
  myEnglishDriveClassLevels,
  uploadEnglishDriveDoc,
  sendEnglishDriveDocToPrint,
  type EnglishDriveDocShape,
  type EnglishDriveUploadResult,
  type EnglishDrivePrintResult,
} from "../services/EnglishDriveService";

const EnglishDriveDocRef = builder.objectRef<EnglishDriveDocShape>("EnglishDriveDoc");
EnglishDriveDocRef.implement({
  description:
    "One English Drive curriculum document (block file or derivative), markdown stored in the doc. " +
    "Library lists carry metadata only (contentMd null); the single-doc read includes the markdown.",
  fields: (t) => ({
    id: t.exposeString("id"),
    classLevel: t.exposeInt("classLevel"),
    // Null = block-less (assignments are week-scoped, D-#346; PT uses blockNumbers).
    blockNumber: t.int({ nullable: true, resolve: (r) => r.blockNumber }),
    // The blocks a PT covers (D-#347); [] for every other kind.
    blockNumbers: t.field({ type: ["Int"], resolve: (r) => r.blockNumbers }),
    kind: t.exposeString("kind"),
    seq: t.exposeInt("seq"),
    title: t.exposeString("title"),
    version: t.exposeInt("version"),
    // Body format (owner 2026-07-25): MD (markdown) | PDF | DOCX (binary in fileId).
    format: t.exposeString("format"),
    fileId: t.string({ nullable: true, resolve: (r) => r.fileId }),
    fileName: t.string({ nullable: true, resolve: (r) => r.fileName }),
    fileMime: t.string({ nullable: true, resolve: (r) => r.fileMime }),
    uploadedAt: t.exposeString("uploadedAt"),
    uploadedByName: t.string({ nullable: true, resolve: (r) => r.uploadedByName }),
    contentMd: t.string({ nullable: true, resolve: (r) => r.contentMd }),
  }),
});

const EnglishDriveUploadResultRef =
  builder.objectRef<EnglishDriveUploadResult>("EnglishDriveUploadResult");
EnglishDriveUploadResultRef.implement({
  fields: (t) => ({
    doc: t.field({ type: EnglishDriveDocRef, resolve: (r) => r.doc }),
    replacedVersion: t.int({ nullable: true, resolve: (r) => r.replacedVersion }),
  }),
});

builder.queryField("englishDriveDocs", (t) =>
  t.field({
    type: [EnglishDriveDocRef],
    description:
      "The English Drive library — the latest doc of every (class, block, kind) the caller may see. " +
      "Teachers get their English classes; Principal/Office all; guardians denied.",
    authScopes: { authenticated: true },
    args: { classLevel: t.arg.int({ required: false }) },
    resolve: async (_root, args, ctx) => englishDriveDocs(ctx, args.classLevel ?? null),
  }),
);

builder.queryField("englishDriveDoc", (t) =>
  t.field({
    type: EnglishDriveDocRef,
    description: "One English Drive document with its markdown. Scope-checked like the library.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => englishDriveDocById(ctx, args.id),
  }),
);

builder.queryField("englishDriveMyClassLevels", (t) =>
  t.field({
    type: ["Int"],
    description:
      "The class levels (1..5) whose English Drive the caller may read — [] means no access " +
      "(hides the drawer tab). Principal/Office get all five; guardians [].",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => myEnglishDriveClassLevels(ctx),
  }),
);

const EnglishDrivePrintResultRef =
  builder.objectRef<EnglishDrivePrintResult>("EnglishDrivePrintResult");
EnglishDrivePrintResultRef.implement({
  fields: (t) => ({
    printRequestId: t.exposeString("printRequestId"),
    title: t.exposeString("title"),
  }),
});

builder.mutationField("sendEnglishDriveDocToPrint", (t) =>
  t.field({
    type: EnglishDrivePrintResultRef,
    description:
      "ED-2: render the doc's PDF server-side and file it through the EXISTING print queue " +
      "(UPLOAD source, print_upload file owned by the caller). Same read gate as the doc " +
      "screen — the class's English teachers + Principal/Office; guardians never.",
    authScopes: { authenticated: true },
    args: {
      id: t.arg.string({ required: true }),
      colour: t.arg.string({ required: true }),
      sides: t.arg.string({ required: true }),
      copies: t.arg.int({ required: true }),
      // Edit-before-print (D-#348): optional edited markdown + layout knobs.
      contentMd: t.arg.string({ required: false }),
      fontScale: t.arg.float({ required: false }),
      lineSpacing: t.arg.float({ required: false }),
      margin: t.arg.float({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return sendEnglishDriveDocToPrint(ctx, args);
    },
  }),
);

builder.mutationField("uploadEnglishDriveDoc", (t) =>
  t.field({
    type: EnglishDriveUploadResultRef,
    description:
      "Upload one English Drive markdown document; an existing (class, block, kind, seq) is replaced " +
      "(old row stamped replacedAt). Requires roster:manage (Principal/Office). Audited.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      classLevel: t.arg.int({ required: true }),
      // Optional for AS (week-scoped, D-#346) and PT (uses blockNumbers); required otherwise.
      blockNumber: t.arg.int({ required: false }),
      // The blocks a PT covers (D-#347) — required (1+) for PT, ignored otherwise.
      blockNumbers: t.arg.intList({ required: false }),
      kind: t.arg.string({ required: true }),
      seq: t.arg.int({ required: false }),
      title: t.arg.string({ required: true }),
      version: t.arg.int({ required: true }),
      // MD (default) → contentMd; PDF/DOCX → fileId of an `english_drive` StoredFile.
      format: t.arg.string({ required: false }),
      contentMd: t.arg.string({ required: false }),
      fileId: t.arg.string({ required: false }),
      fileName: t.arg.string({ required: false }),
      fileMime: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return uploadEnglishDriveDoc({
        ...args,
        actorId: ctx.auth.userId as string,
        actorRole: ctx.auth.role,
      });
    },
  }),
);
