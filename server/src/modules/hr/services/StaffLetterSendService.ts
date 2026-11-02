/**
 * StaffLetterSendService (D-#900) — send an issued letter to the staff member's own app.
 *
 * The owner: *"option to send it with notification or popup or both."* A letter lives in
 * the staff member's আমার চিঠি screen whether or not it is sent (D-#901); sending is how
 * they learn it is there. Two channels, either or both:
 *
 *   notification — an inbox notice + push (`STAFF_LETTER_SENT`), tap → আমার চিঠি
 *   popup        — a pop-up notice to that one login, with a "চিঠি দেখুন" button that
 *                  opens আমার চিঠি. Built on the pop-up system, so its report shows when
 *                  they saw it, and the sender needs the pop-up's own staff-send switch.
 *
 * Every send is recorded on the letter (`sends`), and "send again" is a new notice — the
 * notification's dedupe key carries the send number (the entity-only trap).
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import {
  STAFF_LETTER_SEND_CHANNELS,
  STAFF_LETTER_KIND_LABELS_BN,
  type StaffLetterSendChannel,
} from "@scd/shared";
import type { AppContext } from "../../../context";
import { StaffLetter, type IStaffLetter } from "../models/StaffLetter";
import { LetterError } from "./StaffLetterService";
import { resolveUserIdForStaff } from "./staffMatch";
import { emitStaffLetterSent } from "../../notifications/services/emitters";
import { savePopupDraft, publishPopupNotice } from "../../popup-notices/services/PopupNoticeService";
import { writeAudit } from "../../platform/services/AuditService";
import { dhakaDayKey } from "../../../lib/dhakaDay";

/** The app screen a letter pop-up's button opens (tab/screen, PopupNoticeHost). */
export const MY_LETTERS_TARGET = "HrTab/MyLetters";
/** How long the pop-up keeps coming back (daily) until they open the letter. */
const POPUP_DAYS = 14;

export async function sendLetter(
  ctx: AppContext,
  letterId: string,
  channels: string[],
): Promise<IStaffLetter> {
  const picked = [...new Set(channels)] as StaffLetterSendChannel[];
  if (picked.length === 0) throw new LetterError("কীভাবে পাঠাবেন তা বাছাই করুন — নোটিফিকেশন, পপ-আপ বা দুটোই");
  if (!picked.every((c) => (STAFF_LETTER_SEND_CHANNELS as readonly string[]).includes(c))) {
    throw new LetterError(`Unknown send channel: ${channels.join(", ")}`);
  }

  const letter = await StaffLetter.findById(letterId);
  if (!letter) throw new LetterError("পত্রটি পাওয়া যায়নি");
  if (letter.status !== "issued") throw new LetterError("বাতিল পত্র পাঠানো যায় না");

  const userId = await resolveUserIdForStaff(letter.staffProfileId.toString());
  if (!userId) {
    throw new LetterError("এই কর্মীর অ্যাপ লগইন নেই — পত্রটি ছাপিয়ে হাতে দিন");
  }

  const kindLabelBn = STAFF_LETTER_KIND_LABELS_BN[letter.kind];
  const sendIndex = (letter.sends?.length ?? 0) + 1;
  const now = new Date();

  // The pop-up first: it is the channel that can REFUSE (the sender's pop-up switch, an
  // ended date), and a refusal must not leave a notification already sent behind it.
  let popupNoticeId: Types.ObjectId | null = null;
  if (picked.includes("popup")) {
    const draft = await savePopupDraft(ctx, null, {
      titleBn: `আপনার নতুন চিঠি: ${kindLabelBn}`,
      bodyBn: `স্কুল আপনাকে একটি চিঠি পাঠিয়েছে (${letter.refNo})। নিচের বোতাম চাপলে আপনার চিঠির তালিকা খুলবে।`,
      tone: "info",
      audience: { userIds: [userId] },
      rules: { closeButton: true },
      actions: [{ kind: "OPEN_SCREEN", labelBn: "চিঠি দেখুন", labelEn: "Open the letter", target: MY_LETTERS_TARGET }],
      endsOn: dhakaDayKey(new Date(now.getTime() + POPUP_DAYS * 86_400_000)),
      repeat: "daily",
    });
    const published = await publishPopupNotice(ctx, draft.id, now);
    popupNoticeId = new Types.ObjectId(published.id);
  }

  const sent: StaffLetterSendChannel[] = [];
  if (popupNoticeId) sent.push("popup");
  if (picked.includes("notification")) {
    const created = await emitStaffLetterSent({
      letterId: letter._id.toString(),
      recipientUserId: userId,
      sendIndex,
      kindLabelBn,
      refNo: letter.refNo,
    });
    if (created) sent.push("notification");
  }
  if (sent.length === 0) throw new LetterError("পত্রটি পাঠানো যায়নি — আবার চেষ্টা করুন");

  letter.sends = [
    ...(letter.sends ?? []),
    { at: now, by: new Types.ObjectId(ctx.auth!.userId), channels: sent, popupNoticeId },
  ];
  await letter.save();

  await writeAudit({
    eventKind: "STAFF_LETTER_SENT",
    actorId: ctx.auth!.userId,
    targetId: letter._id,
    targetKind: "StaffLetter",
    meta: { refNo: letter.refNo, kind: letter.kind, channels: sent, sendIndex, recipientUserId: userId },
  });
  return letter;
}
