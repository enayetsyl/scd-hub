/**
 * CommentReadService (D-#882) — the family confirms it has read a delivered daily comment.
 *
 * Owner ask 2026-11-01: a comment the Office sends must open on the guardian's app as a
 * pop-up that only "পড়েছি" closes, so the school knows the family actually read it — the
 * wa.me message and the inbox row (CM-2) prove only that it was sent.
 *
 *   myUnreadComments     — GUARDIAN: delivered comments about the guardian's own children
 *                          still waiting for a "পড়েছি", oldest first (the pop-up queue).
 *   confirmCommentRead   — GUARDIAN: stamp `guardianReadAt` once (the first guardian of the
 *                          family wins; a second tap or a second device is a no-op); audited.
 *   unreadCommentsPage   — STAFF (`student_comments:read_status`): the Office's follow-up
 *                          list — still unconfirmed, oldest delivery first, with the family
 *                          phone and whether anyone in the family has an app login (a family
 *                          with none can never see the pop-up, so it needs a call).
 *
 * Only comments with `readConfirmRequired` take part: the flag is set at the FIRST
 * delivery from this release on, so nothing delivered before it ever pops up (owner).
 * Both positive and concern comments ask for it (owner).
 *
 * Identity plane (names students and guardians); no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { StudentComment, type IStudentComment } from "../models/StudentComment";
import { Student } from "../../foundation/models/Student";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { personName } from "../../../lib/personName";
import { StudentCommentError } from "./StudentCommentService";

/** The pop-up queue is shown one at a time; a family with more waiting gets the rest as
 *  each one is confirmed, so this bounds one read, not what the family can reach. */
const POPUP_QUEUE_MAX = 20;

const str = (v: unknown): string => String(v);

/** The still-unconfirmed filter shared by the pop-up queue and the Office list. */
const UNREAD = { readConfirmRequired: true, guardianReadAt: null, deliveredAt: { $ne: null }, discardedAt: null } as const;

export interface GuardianUnreadComment {
  id: string;
  studentId: string;
  studentName: string;
  type: string;
  sentiment: string;
  text: string;
  attachmentIds: string[];
  deliveredAt: string;
}

export interface UnreadCommentRow {
  id: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  authorName: string;
  type: string;
  sentiment: string;
  text: string;
  deliveredAt: string;
  /** The family phone on the student record (for a call / WhatsApp), or null. */
  phone: string | null;
  /** Someone in the family can sign in to the app — otherwise the pop-up can never show. */
  hasAppLogin: boolean;
}

async function activeChildIds(guardianId: string): Promise<Types.ObjectId[]> {
  if (!Types.ObjectId.isValid(guardianId)) return [];
  const guardian = (await Guardian.findById(guardianId).select("active").lean()) as unknown as { active?: boolean } | null;
  if (!guardian || guardian.active === false) return [];
  const links = (await GuardianLink.find({ guardianId: new Types.ObjectId(guardianId), active: { $ne: false } })
    .select("studentId")
    .lean()) as unknown as Array<{ studentId: Types.ObjectId }>;
  return links.map((l) => l.studentId);
}

export async function myUnreadComments(guardianId: string): Promise<GuardianUnreadComment[]> {
  const childIds = await activeChildIds(guardianId);
  if (childIds.length === 0) return [];
  const docs = (await StudentComment.find({ studentId: { $in: childIds }, ...UNREAD })
    .sort({ deliveredAt: 1, _id: 1 })
    .limit(POPUP_QUEUE_MAX)
    .lean()) as unknown as IStudentComment[];
  if (docs.length === 0) return [];
  const students = (await Student.find({ _id: { $in: [...new Set(docs.map((d) => str(d.studentId)))] } })
    .select("name nameBn")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string }>;
  const nameOf = new Map(students.map((s) => [str(s._id), personName(s, "শিক্ষার্থী")]));
  return docs.map((d) => ({
    id: str(d._id),
    studentId: str(d.studentId),
    studentName: nameOf.get(str(d.studentId)) ?? "শিক্ষার্থী",
    type: d.type,
    sentiment: d.sentiment,
    text: d.text,
    attachmentIds: (d.attachmentIds ?? []).map(str),
    deliveredAt: new Date(d.deliveredAt as Date).toISOString(),
  }));
}

/** True when this call recorded the confirmation; false when it was already recorded. */
export async function confirmCommentRead(guardianId: string, commentId: string, now: Date = new Date()): Promise<boolean> {
  if (!Types.ObjectId.isValid(commentId)) throw new StudentCommentError("Invalid comment id");
  const comment = (await StudentComment.findById(commentId)
    .select("studentId deliveredAt readConfirmRequired guardianReadAt")
    .lean()) as unknown as IStudentComment | null;
  if (!comment || !comment.deliveredAt) throw new StudentCommentError("মন্তব্যটি পাওয়া যায়নি।");
  const childIds = await activeChildIds(guardianId);
  // Same answer for "not yours" as for "missing" — never confirm another family's row.
  if (!childIds.some((id) => id.equals(comment.studentId))) throw new StudentCommentError("মন্তব্যটি পাওয়া যায়নি।");
  if (!comment.readConfirmRequired || comment.guardianReadAt) return false;

  const res = await StudentComment.updateOne(
    { _id: comment._id, guardianReadAt: null },
    { $set: { guardianReadAt: now, guardianReadBy: new Types.ObjectId(guardianId) } },
  );
  if (res.modifiedCount === 0) return false; // a second device got there first
  await writeAudit({
    eventKind: "STUDENT_COMMENT_READ_CONFIRMED",
    actorId: guardianId,
    actorRole: "GUARDIAN",
    targetId: comment._id,
    targetKind: "StudentComment",
    meta: { studentId: str(comment.studentId) },
  });
  return true;
}

export function unreadCommentsPage(args: PageArgs): Promise<Page<UnreadCommentRow>> {
  return queryPage(
    StudentComment,
    { ...UNREAD },
    { deliveredAt: 1, _id: 1 },
    args,
    (docs) => withFamily(docs as unknown as IStudentComment[]),
  );
}

async function withFamily(docs: IStudentComment[]): Promise<UnreadCommentRow[]> {
  if (docs.length === 0) return [];
  const studentIds = [...new Set(docs.map((d) => str(d.studentId)))];
  const [students, authors, links] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).select("name nameBn phone sectionId").lean() as unknown as Promise<
      Array<{ _id: Types.ObjectId; name: string; nameBn?: string; phone?: string; sectionId?: Types.ObjectId }>
    >,
    User.find({ _id: { $in: [...new Set(docs.map((d) => str(d.authorUserId)))] } }).select("name").lean() as unknown as Promise<
      Array<{ _id: Types.ObjectId; name: string }>
    >,
    GuardianLink.find({ studentId: { $in: studentIds }, active: { $ne: false } }).select("studentId guardianId").lean() as unknown as Promise<
      Array<{ studentId: Types.ObjectId; guardianId: Types.ObjectId }>
    >,
  ]);
  const withLogin = new Set(
    (
      (await Guardian.find({ _id: { $in: links.map((l) => l.guardianId) }, loginEnabled: true, active: { $ne: false } })
        .select("_id")
        .lean()) as unknown as Array<{ _id: Types.ObjectId }>
    ).map((g) => str(g._id)),
  );
  const familyHasLogin = new Set(links.filter((l) => withLogin.has(str(l.guardianId))).map((l) => str(l.studentId)));

  // The child's CURRENT section (a split may have moved them since the comment was written).
  const sectionIds = [...new Set(students.map((s) => (s.sectionId ? str(s.sectionId) : "")).filter(Boolean))];
  const sections = (await Section.find({ _id: { $in: sectionIds } }).select("classId nameBn").lean()) as unknown as Array<{
    _id: Types.ObjectId;
    classId: Types.ObjectId;
    nameBn?: string;
  }>;
  const classes = (await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("nameBn").lean()) as unknown as Array<{
    _id: Types.ObjectId;
    nameBn?: string;
  }>;
  const classBn = new Map(classes.map((c) => [str(c._id), c.nameBn ?? ""]));
  const sectionLabel = new Map(
    sections.map((s) => [str(s._id), [classBn.get(str(s.classId)), s.nameBn].filter(Boolean).join(" · ")]),
  );
  const student = new Map(students.map((s) => [str(s._id), s]));
  const author = new Map(authors.map((a) => [str(a._id), a.name]));

  return docs.map((d) => {
    const s = student.get(str(d.studentId));
    return {
      id: str(d._id),
      studentId: str(d.studentId),
      studentName: personName(s, "শিক্ষার্থী"),
      classLabel: s?.sectionId ? sectionLabel.get(str(s.sectionId)) ?? "" : "",
      authorName: author.get(str(d.authorUserId)) ?? "",
      type: d.type,
      sentiment: d.sentiment,
      text: d.text,
      deliveredAt: new Date(d.deliveredAt as Date).toISOString(),
      phone: s?.phone?.trim() || null,
      hasAppLogin: familyHasLogin.has(str(d.studentId)),
    };
  });
}
