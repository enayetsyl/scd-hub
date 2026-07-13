/**
 * AssignmentFileService — the GET /files/:id read gate for `assignment_attachment`
 * files (D-#298, the homework hw_question pattern):
 *
 *   uploader → always (the file exists BEFORE the item does, while the delivery
 *              form previews the picked list — the print_upload rule);
 *   staff    → read scope on the owning item's section+class;
 *   GUARDIAN → a linked ACTIVE child enrolled in the item's class.
 *
 * Ownership is reverse-resolved through AssignmentItem.attachmentIds (the file
 * carries no back-reference); an unbound file is readable by nobody but its
 * uploader. Default-deny (GP-J7).
 */
import type { AppContext } from "../../../context";
import { assertCanRead, ForbiddenError } from "../../../middleware/authz";
import { AssignmentItem, type IAssignmentItem } from "../models/AssignmentItem";
import type { IStoredFile } from "../../platform/models/StoredFile";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Student } from "../../foundation/models/Student";

export async function assertAssignmentFileReadAccess(
  ctx: AppContext,
  file: IStoredFile,
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (file.uploadedBy?.toString() === ctx.auth.userId) return;

  const item = (await AssignmentItem.findOne({
    attachmentIds: file._id,
  }).lean()) as unknown as IAssignmentItem | null;
  if (!item) throw new ForbiddenError("ফাইলটি কোনো অ্যাসাইনমেন্টের সাথে যুক্ত নয়");

  if (ctx.auth.role === "GUARDIAN") {
    const links = await GuardianLink.find({ guardianId: ctx.auth.userId }).lean();
    const activeIds = links.filter((l) => l.active !== false).map((l) => l.studentId);
    if (activeIds.length > 0) {
      const enrolled = await Student.findOne({
        _id: { $in: activeIds },
        classId: item.classId,
        active: true,
      }).lean();
      if (enrolled) return;
    }
    throw new ForbiddenError("এই শিক্ষার্থীর তথ্য দেখার অনুমতি নেই");
  }
  await assertCanRead(ctx, item.sectionId.toString(), item.classId.toString());
}
