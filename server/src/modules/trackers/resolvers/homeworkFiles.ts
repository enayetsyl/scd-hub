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
import { Subject } from "../../foundation/models/Subject";
import { HomeworkItem } from "../models/HomeworkItem";
import {
  attachQuestionFile,
  attachAnswerFile,
  requireItem,
  requireRecord,
  type AttachResult,
} from "../services/HomeworkFileService";

async function resolveSubjectId(subject: string): Promise<string> {
  const doc = await Subject.findOne({ code: subject }).select("_id").lean();
  if (!doc) throw new Error(`Subject not found: ${subject}`);
  return doc._id.toString();
}

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
      // The question file is part of the work being given out (ACS-4, D-#592).
      await assertCanWrite(
        ctx,
        item.sectionId.toString(),
        await resolveSubjectId(item.subject),
        "declare_homework",
      );
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
      const item = await HomeworkItem.findById(rec.hwItemId).select("subject").lean();
      // The checked-answer file is part of checking the work (ACS-4, D-#592).
      await assertCanWrite(
        ctx,
        rec.sectionId.toString(),
        item?.subject ? await resolveSubjectId(item.subject) : undefined,
        "check_homework",
      );
      return attachAnswerFile(args.recordId, args.fileId, ctx.auth.userId);
    },
  }),
);
