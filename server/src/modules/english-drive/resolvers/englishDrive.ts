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
  splitEnglishDriveBlock,
  type BlockSplitResult,
  type DerivedSheet,
} from "../services/BlockSplitService";
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
    pdfFileId: t.string({ nullable: true, resolve: (r) => r.pdfFileId }),
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
      // D-#294 print flow (owner 2026-07-25): copies mode + class + use date.
      copiesMode: t.arg.string({ required: false }),
      copiesClassId: t.arg.string({ required: false }),
      neededByKey: t.arg.string({ required: false }),
      // Edit-before-print (D-#348): optional edited markdown + layout knobs.
      contentMd: t.arg.string({ required: false }),
      fontScale: t.arg.float({ required: false }),
      lineSpacing: t.arg.float({ required: false }),
      margin: t.arg.float({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      // The use date is MANDATORY on a teacher's request — the office queue needs to
      // know when the print is used (enforced at this teacher-facing seam, like colour/sides).
      if (!args.neededByKey) throw new Error("প্রিন্ট কবে ব্যবহার হবে সেই তারিখ দিন");
      return sendEnglishDriveDocToPrint(ctx, args);
    },
  }),
);

// ---------------------------------------------------------------------------
// ED-5 (D-#455) — split one block file into its sheets. This does NOT save: it
// returns the derived sheets so the Principal reviews and edits them in the same
// upload list, then commits through the existing uploadEnglishDriveDoc path. A
// bad AI run therefore cannot reach a teacher's library without a human look.
// ---------------------------------------------------------------------------

const DerivedSheetRef = builder.objectRef<DerivedSheet>("EnglishDriveDerivedSheet");
DerivedSheetRef.implement({
  description: "One sheet sliced out of a block file — not yet saved.",
  fields: (t) => ({
    kind: t.exposeString("kind"),
    seq: t.exposeInt("seq"),
    title: t.exposeString("title"),
    contentMd: t.exposeString("contentMd"),
    blockNumbers: t.field({ type: ["Int"], resolve: (r) => r.blockNumbers }),
    filename: t.exposeString("filename"),
    /** False = the deterministic slice shipped (no AI, or the AI pass was rejected). */
    polished: t.exposeBoolean("polished"),
  }),
});

const BlockSplitResultRef = builder.objectRef<BlockSplitResult>("EnglishDriveBlockSplitResult");
BlockSplitResultRef.implement({
  fields: (t) => ({
    sheets: t.field({ type: [DerivedSheetRef], resolve: (r) => r.sheets }),
    model: t.string({ nullable: true, resolve: (r) => r.model }),
    warnings: t.field({ type: ["String"], resolve: (r) => r.warnings }),
  }),
});

builder.mutationField("splitEnglishDriveBlock", (t) =>
  t.field({
    type: BlockSplitResultRef,
    description:
      "ED-5: slice a block file into its Teacher Delivery sheet, CW/HW sheets, PT and Answer Key. " +
      "Deterministic — the sheets are CUT from the master, never regenerated; the LLM only writes the " +
      "delivery sheet's front matter and tidies formatting, and any tidy that changes the numbered " +
      "items is discarded. Saves nothing: the caller reviews, then uploads. Requires roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      classLevel: t.arg.int({ required: true }),
      blockNumber: t.arg.int({ required: true }),
      version: t.arg.int({ required: true }),
      contentMd: t.arg.string({ required: true }),
      /** The topic printed on every sheet header; derived from the master when absent. */
      blockTitle: t.arg.string({ required: false }),
      /** False = deterministic only, no API call at all. */
      polish: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return splitEnglishDriveBlock({
        classLevel: args.classLevel,
        blockNumber: args.blockNumber,
        version: args.version,
        contentMd: args.contentMd,
        blockTitle: args.blockTitle ?? null,
        polish: args.polish ?? true,
      });
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
      pdfFileId: t.arg.string({ required: false }),
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
