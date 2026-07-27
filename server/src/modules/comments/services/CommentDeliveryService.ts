/**
 * CommentDeliveryService (CM-2, prd-comments-meetings §5/§6, J-CM1, D-#172) —
 * deliver ONE daily student comment to the family, per-comment (mirrors the legacy
 * Form's per-row WhatsApp send).
 *
 *   deliverComment — stamp `deliveredAt` + `deliveryChannels` (which SEALS the CM-1
 *                    immutability — editComment already refuses a delivered comment),
 *                    then deliver on the existing rails:
 *                      • wa.me click-to-send for EVERY family with a phone
 *                        (Student.phone, ADR-003; phone-less → unreachableByWa);
 *                      • an in-app Notification (kind STUDENT_COMMENT, D-#72) via the
 *                        emit() seam → inbox + push behind the seam for login-enabled
 *                        guardians; contact-only families stay wa.me-only (D-#31).
 *
 * The body is rendered from the merged Message-Templates registry
 * (`student_comment.notify.*`, built on MT-1 per D-#131 — NOT inline). **N+1 guard:**
 * the title + body are rendered ONCE per comment here and the pre-rendered text is
 * passed to the emitter — renderTemplate is NEVER called inside the per-guardian loop.
 *
 * Write-scope (`tracker:write` + `assertCanWrite` on the comment's section, resolved
 * server-side) is enforced by the RESOLVER — this service trusts the actor.
 * Identity-plane; NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { COMMENT_TYPE_LABELS_BN } from "@scd/shared";
import { StudentComment, type IStudentComment } from "../models/StudentComment";
import { Student } from "../../foundation/models/Student";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import { emitStudentComment } from "../../notifications/services/emitters";
import { writeAudit } from "../../platform/services/AuditService";
import { StudentCommentError } from "./StudentCommentService";

/** wa.me click-to-send link (ADR-003 — always a MANUAL send; null when no phone). */
export function commentWaLink(phone: string | undefined | null, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export interface CommentDeliveryOutcome {
  commentId: string;
  studentId: string;
  studentName: string;
  /** The rendered Bangla body (the wa.me + inbox text). */
  messageBn: string;
  /** wa.me link for the family phone (null when no phone → unreachableByWa). */
  waLink: string | null;
  /** True when the family has no phone (counted in unreachableCount upstream). */
  unreachableByWa: boolean;
  /** Login-enabled guardian ids that got an in-app inbox row. */
  notifiedGuardianIds: string[];
  /** Channels this delivery used (wa / inbox). */
  deliveryChannels: string[];
  deliveredAt: string;
}

type StudentLite = { _id: Types.ObjectId; name: string; nameBn?: string; phone?: string };

/**
 * Deliver one comment (J-CM1). Idempotent on `deliveredAt` (stamped once, on the
 * first delivery — that seals immutability); the wa.me link is (re)generated each
 * call and the emit is dedupe-keyed per (comment, guardian) so a re-call never
 * double-notifies. Returns the per-comment delivery payload.
 */
export async function deliverComment(commentId: string, actorId: string): Promise<CommentDeliveryOutcome> {
  if (!Types.ObjectId.isValid(commentId)) throw new StudentCommentError("Invalid comment id");
  const comment = (await StudentComment.findById(commentId)) as IStudentComment | null;
  if (!comment) throw new StudentCommentError("Comment not found");
  // A discarded draft was deliberately dropped (D-#365) — it must never reach a guardian,
  // even if some stale UI path tries to deliver it. (Idempotent redelivery of an already
  // delivered comment stays allowed below.)
  if (comment.discardedAt && !comment.deliveredAt) {
    throw new StudentCommentError("This comment was discarded and cannot be delivered");
  }

  const student = (await Student.findById(comment.studentId)
    .select("name nameBn phone")
    .lean()) as unknown as StudentLite | null;
  const studentName = student?.nameBn || student?.name || "শিক্ষার্থী";
  const typeBn = (COMMENT_TYPE_LABELS_BN as Record<string, string>)[comment.type] ?? comment.type;

  // N+1 guard: render the title + body ONCE here; the emitter takes pre-rendered text.
  const titleBn = await renderTemplate("student_comment.notify.title");
  const messageBn = await renderTemplate("student_comment.notify.body", {
    StudentName: studentName,
    CommentType: typeBn,
    CommentText: comment.text,
  });

  const waLink = commentWaLink(student?.phone, messageBn);
  const notifiedGuardianIds = await emitStudentComment({
    commentId: comment._id,
    studentId: comment.studentId,
    sectionId: comment.sectionId,
    titleBn,
    messageBn,
  });

  const channels: string[] = [];
  if (waLink) channels.push("wa");
  if (notifiedGuardianIds.length > 0) channels.push("inbox");

  // Stamp deliveredAt ONCE (seals immutability); refresh deliveryChannels each call.
  const deliveredAt = comment.deliveredAt ?? new Date();
  comment.deliveredAt = deliveredAt;
  comment.deliveryChannels = channels;
  await comment.save();

  await writeAudit({
    eventKind: "STUDENT_COMMENT_DELIVERED",
    actorId,
    targetId: comment._id,
    targetKind: "StudentComment",
    meta: {
      studentId: comment.studentId.toString(),
      sectionId: comment.sectionId.toString(),
      channels,
      notifiedCount: notifiedGuardianIds.length,
      unreachableByWa: !waLink,
    },
  });

  return {
    commentId: comment._id.toString(),
    studentId: comment.studentId.toString(),
    studentName,
    messageBn,
    waLink,
    unreachableByWa: !waLink,
    notifiedGuardianIds,
    deliveryChannels: channels,
    deliveredAt: new Date(deliveredAt).toISOString(),
  };
}
