/**
 * Homework attachment mutations (GP-A, D-#70).
 *
 * Teachers attach; guardians only view (no guardian mutation exists). Both
 * mutations ride `tracker:write` + `assertCanWrite` on the OWNING doc's
 * section (the subject teacher) — NO new permission. Audit HW_FILE_ATTACHED.
 * Upload itself is the Express route POST /files/hw; these bind an uploaded
 * StoredFile to its homework doc. No GraphQL type here ever carries a Drive id.
 */
import { builder } from "../../../schema";
import { assertCanWrite, ForbiddenError } from "../../../middleware/authz";
import {
  attachQuestionFile,
  attachAnswerFile,
  requireItem,
  requireRecord,
  type AttachResult,
} from "../services/HomeworkFileService";

const AttachResultRef = builder.objectRef<AttachResult>("HomeworkFileAttachResult");
AttachResultRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    hwId: t.exposeString("hwId"),
    fileId: t.exposeString("fileId"),
  }),
});

builder.mutationField("attachHomeworkQuestionFile", (t) =>
  t.field({
    type: AttachResultRef,
    description:
      "Attach (or replace) the question file on a Layer-A homework item. " +
      "Subject-teacher write-scope on the item's section (GP-A, D-#70).",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      hwItemId: t.arg.string({ required: true }),
      fileId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const item = await requireItem(args.hwItemId);
      await assertCanWrite(ctx, item.sectionId.toString());
      return attachQuestionFile(args.hwItemId, args.fileId, ctx.auth.userId);
    },
  }),
);

builder.mutationField("attachHomeworkAnswerFile", (t) =>
  t.field({
    type: AttachResultRef,
    description:
      "Attach (or replace) the checked-answer file on a Layer-B student record. " +
      "Subject-teacher write-scope on the record's section (GP-A, D-#70).",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      recordId: t.arg.string({ required: true }),
      fileId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const rec = await requireRecord(args.recordId);
      await assertCanWrite(ctx, rec.sectionId.toString());
      return attachAnswerFile(args.recordId, args.fileId, ctx.auth.userId);
    },
  }),
);
