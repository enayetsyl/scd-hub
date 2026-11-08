/**
 * School notice (D-#1072) — the phone-notification half of a pop-up announcement.
 *
 * The owner (2026-11-08), announcing the help centre: *"send a pop-up and a notification to
 * all the teachers and guardians"*. A pop-up reaches someone only when they open the app; a
 * notification also buzzes the phone of someone who has not opened it for days. So the
 * announcement is ONE pop-up notice, and this sends its people a SCHOOL_NOTICE notification.
 *
 * The audience is the notice's FROZEN recipient rows, never a second audience resolve: both
 * halves reach exactly the same people, and a re-run is safe — the dedupe key carries the
 * notice AND the person (the entity-only dedupe trap), so it adds only someone not yet told.
 * Skipped: rows with no app login (`reachable: false`, and STUDENT rows — families with no
 * guardian), and the sender's own "send to me first" test rows.
 *
 * Server-internal (a script or a service calls it) — no GraphQL door, so no permission.
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import { PopupNotice } from "../models/PopupNotice";
import { PopupNoticeRecipient } from "../models/PopupNoticeRecipient";
import { emit } from "../../notifications/services/NotificationService";
import { writeAudit } from "../../platform/services/AuditService";

export interface SchoolNoticeText {
  titleBn: string;
  bodyBn: string;
  /** The page a tap opens, "Tab/Screen" like a pop-up OPEN_SCREEN button. Omit for none. */
  screenTarget?: string;
}

export interface SchoolNoticeResult {
  /** People who can receive it (app login, not a test row). */
  reachable: number;
  /** New notifications written now — a re-run counts only the people not yet told. */
  created: number;
  /** Families/guardians without an app login: no inbox, nothing sent. */
  withoutLogin: number;
}

const TARGET_RE = /^[A-Za-z]+\/[A-Za-z]+$/;

export async function notifyPopupRecipients(
  actorId: string,
  noticeId: string,
  text: SchoolNoticeText,
): Promise<SchoolNoticeResult> {
  const titleBn = text.titleBn.trim();
  const bodyBn = text.bodyBn.trim();
  if (!titleBn || !bodyBn) throw new Error("notifyPopupRecipients: title and body are required");
  const screenTarget = text.screenTarget?.trim() || undefined;
  if (screenTarget && !TARGET_RE.test(screenTarget)) {
    throw new Error(`notifyPopupRecipients: screenTarget must be "Tab/Screen", got "${screenTarget}"`);
  }
  if (!Types.ObjectId.isValid(noticeId)) throw new Error(`notifyPopupRecipients: bad notice id ${noticeId}`);
  const notice = await PopupNotice.findById(noticeId).lean();
  if (!notice) throw new Error(`notifyPopupRecipients: notice ${noticeId} not found`);
  if (notice.status !== "PUBLISHED") {
    throw new Error(`notifyPopupRecipients: notice ${noticeId} is ${notice.status}, not PUBLISHED`);
  }

  const rows = await PopupNoticeRecipient.find({ noticeId: notice._id, test: { $ne: true } })
    .select({ recipientKind: 1, recipientId: 1, reachable: 1 })
    .lean();

  let reachable = 0;
  let created = 0;
  let withoutLogin = 0;
  for (const r of rows) {
    if (!r.reachable || r.recipientKind === "STUDENT") {
      withoutLogin += 1;
      continue;
    }
    reachable += 1;
    const id = r.recipientId.toString();
    const res = await emit({
      recipientUserId: r.recipientKind === "USER" ? id : null,
      recipientGuardianId: r.recipientKind === "GUARDIAN" ? id : null,
      kind: "SCHOOL_NOTICE",
      titleBn,
      bodyBn,
      refs: screenTarget ? { screenTarget } : {},
      dedupeKey: `school-notice:${noticeId}:${r.recipientKind}:${id}`,
    });
    if (res.created) created += 1;
  }

  await writeAudit({
    eventKind: "POPUP_NOTICE_NOTIFIED",
    actorId,
    targetId: notice._id,
    targetKind: "PopupNotice",
    meta: { reachable, created, withoutLogin, screenTarget: screenTarget ?? null },
  });

  return { reachable, created, withoutLogin };
}
