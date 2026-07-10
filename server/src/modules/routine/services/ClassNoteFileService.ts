/**
 * Class-note attachment read gate (guardian access follow-up to D-#52 / the R-5 notes).
 *
 * Staff read these under `routine:read`. A GUARDIAN may now open one too — but only an
 * attachment hanging off a note for a group their OWN child sits in.
 *
 * Unlike a `comment_*` file, a `classnote_attachment` StoredFile carries NO back-
 * reference to a student: the pointer runs ClassNote → file. So the gate reverse-resolves
 * the note by `attachmentIds` (indexed), reads its denormalized `groupType`/`groupId`,
 * and checks the guardian has a linked child in that group:
 *
 *   section      → an active linked child whose `sectionId` is the note's group
 *   subjectgroup → an active linked child with a `SubjectGroupMembership` in it
 *
 * A file that no note references is unreadable by anyone but staff — an orphan upload
 * (picked but never attached) must not leak.
 *
 * Identity plane only; no corpus path (ADR-005).
 */
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Student } from "../../foundation/models/Student";
import { ClassNote } from "../models/ClassNote";
import { SubjectGroupMembership } from "../models/SubjectGroupMembership";

const DENY_BN = "এই ফাইলটি দেখার অনুমতি নেই";

/** The active student ids this guardian is linked to. */
async function linkedStudentIds(guardianId: string): Promise<string[]> {
  const guardian = await Guardian.findById(guardianId).lean();
  if (!guardian || !guardian.active) return [];
  const links = await GuardianLink.find({ guardianId }).select("studentId active").lean();
  return links.filter((l) => l.active !== false).map((l) => l.studentId.toString());
}

/**
 * Throws unless the caller may read this class-note attachment.
 * `fileId` is the StoredFile `_id`; the caller has already established the file's kind.
 */
export async function assertClassNoteFileReadAccess(ctx: AppContext, fileId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError(DENY_BN);
  if (ctx.auth.role !== "GUARDIAN") throw new ForbiddenError(DENY_BN);

  // Which note owns this attachment? No back-ref exists, so resolve the other way.
  const note = await ClassNote.findOne({ attachmentIds: fileId }).select("groupType groupId").lean();
  if (!note) throw new ForbiddenError(DENY_BN); // orphan upload — never readable by a guardian

  const studentIds = await linkedStudentIds(ctx.auth.userId);
  if (studentIds.length === 0) throw new ForbiddenError(DENY_BN);

  const groupId = note.groupId.toString();
  const hasChildInGroup =
    note.groupType === "section"
      ? (await Student.exists({ _id: { $in: studentIds }, sectionId: groupId, active: true })) !== null
      : (await SubjectGroupMembership.exists({ groupId, studentId: { $in: studentIds } })) !== null;

  if (!hasChildInGroup) throw new ForbiddenError(DENY_BN);
}
