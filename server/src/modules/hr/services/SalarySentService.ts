/**
 * SalarySentService (D-#915) — tell staff their salary has gone out.
 *
 * The owner: *"after clearing the money from the bank … send a notification and pop-up
 * message, both or any one, to inform the respective teacher that their money has been
 * disbursed"*. The breakdown (each deduction by name, each addition, net) is the payslip
 * they already have under আমার রেকর্ড; the notice says the month, the amount and how it
 * was paid, and opens that payslip — the owner chose "short + link".
 *
 * PER PAYMENT GROUP, because the money does not go out together: the own-bank transfer,
 * the BEFTN transfer and the cash envelopes clear on different days, and telling the cash
 * staff "your salary has been sent" the day the bank letter goes in would be wrong. The
 * groups and their members are EXACTLY the advice pack's (`paymentAdvice`), payable rows
 * only — someone the bank sheet blocked (no account number) was not in that transfer, so
 * they are not told it arrived.
 *
 * LOCKED runs only (the advice pack's own rule): a prepared run's figures can still change.
 *
 * Every send is recorded on the run (`salarySentNotices`) and a re-send is a new notice —
 * the notification's dedupe key carries the send number (the entity-only trap).
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import {
  PAYMENT_CHANNELS,
  STAFF_LETTER_SEND_CHANNELS,
  type PaymentChannel,
  type StaffLetterSendChannel,
} from "@scd/shared";
import type { AppContext } from "../../../context";
import { PayrollRun } from "../models/PayrollRun";
import { paymentAdvice } from "./PaymentAdviceService";
import { PayrollError } from "./payrollMath";
import { resolveUserIdForStaff } from "./staffMatch";
import { takaFigure } from "./takaWords";
import { emitSalarySent } from "../../notifications/services/emitters";
import { savePopupDraft, publishPopupNotice } from "../../popup-notices/services/PopupNoticeService";
import { writeAudit } from "../../platform/services/AuditService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { bnNum } from "../../../lib/bnNum";

/** The app screen the pop-up's button opens: the staff member's own record, payslips included. */
export const MY_RECORD_TARGET = "HrTab/MyRecord";
/**
 * The pop-up shows ONCE, on the next app open (owner, D-#916: "only the next time when the
 * app is open") — closing it or pressing its button ends it. This is only how long it waits
 * for that next open, so someone away from the app for a while still sees it.
 */
const POPUP_DAYS = 30;

const BN_MONTHS = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

/** `2026-10` → `অক্টোবর ২০২৬`. */
export function monthBn(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  return `${BN_MONTHS[Number(m) - 1] ?? monthKey} ${bnNum(y)}`;
}

/** How the money reached them, as the staff member reads it (not the office's channel name). */
export const PAID_HOW_BN: Record<PaymentChannel, string> = {
  internal: "আপনার ব্যাংক হিসাবে",
  beftn: "আপনার ব্যাংক হিসাবে",
  bkash: "আপনার বিকাশে",
  cash: "নগদে",
};

export interface SalarySentSend {
  at: Date;
  sendChannels: string[];
  recipientCount: number;
  total: number;
}

export interface SalarySentGroup {
  channel: PaymentChannel;
  staffCount: number;
  total: number;
  /** Paid in this group but no app login — the office tells them another way. */
  withoutLogin: string[];
  sends: SalarySentSend[];
}

interface Member {
  staffProfileId: string;
  name: string;
  amount: number;
  userId: string | null;
}

async function groupsWithMembers(runId: string): Promise<{
  monthKey: string;
  groups: Array<{ channel: PaymentChannel; total: number; members: Member[] }>;
}> {
  const advice = await paymentAdvice(runId);
  const groups = [];
  for (const g of advice.groups) {
    if (g.rows.length === 0) continue;
    const members = await Promise.all(
      g.rows.map(async (r) => ({
        staffProfileId: r.staffProfileId,
        name: r.name,
        amount: r.amount,
        userId: await resolveUserIdForStaff(r.staffProfileId),
      })),
    );
    groups.push({ channel: g.channel, total: g.total, members });
  }
  return { monthKey: advice.monthKey, groups };
}

/** The payment groups of a locked run, who in each can be told, and what was sent so far. */
export async function salarySentGroups(runId: string): Promise<SalarySentGroup[]> {
  const { groups } = await groupsWithMembers(runId);
  const run = await PayrollRun.findById(runId).select("salarySentNotices").lean();
  const notices = run?.salarySentNotices ?? [];
  return groups.map((g) => ({
    channel: g.channel,
    staffCount: g.members.length,
    total: g.total,
    withoutLogin: g.members.filter((m) => !m.userId).map((m) => m.name),
    sends: notices
      .filter((n) => n.channel === g.channel)
      .map((n) => ({ at: n.at, sendChannels: n.sendChannels, recipientCount: n.recipientCount, total: n.total })),
  }));
}

export async function announceSalarySent(
  ctx: AppContext,
  runId: string,
  channel: string,
  sendChannels: string[],
): Promise<SalarySentGroup[]> {
  const picked = [...new Set(sendChannels)] as StaffLetterSendChannel[];
  if (picked.length === 0) throw new PayrollError("কীভাবে জানাবেন তা বাছাই করুন — নোটিফিকেশন, পপ-আপ বা দুটোই");
  if (!picked.every((c) => (STAFF_LETTER_SEND_CHANNELS as readonly string[]).includes(c))) {
    throw new PayrollError(`Unknown send channel: ${sendChannels.join(", ")}`);
  }
  if (!(PAYMENT_CHANNELS as readonly string[]).includes(channel)) {
    throw new PayrollError(`Unknown payment group: ${channel}`);
  }

  const { monthKey, groups } = await groupsWithMembers(runId);
  const group = groups.find((g) => g.channel === channel);
  if (!group) throw new PayrollError("এই মাসে এই পদ্ধতিতে কাউকে বেতন দেওয়া হয়নি");
  const reachable = group.members.filter((m): m is Member & { userId: string } => !!m.userId);
  if (reachable.length === 0) {
    throw new PayrollError("এই দলের কারও অ্যাপ লগইন নেই — তাঁদের সরাসরি জানান");
  }

  const run = await PayrollRun.findById(runId);
  if (!run) throw new PayrollError("Payroll run not found");
  const sendIndex = (run.salarySentNotices ?? []).filter((n) => n.channel === channel).length + 1;
  const now = new Date();
  const month = monthBn(monthKey);
  const how = PAID_HOW_BN[channel as PaymentChannel];

  // The pop-up first: it is the channel that can REFUSE (the sender's pop-up switch), and a
  // refusal must not leave notifications already sent behind it. One pop-up for the whole
  // group — it carries no amount, so nobody's figure is shown to anyone else.
  let popupNoticeId: Types.ObjectId | null = null;
  if (picked.includes("popup")) {
    const draft = await savePopupDraft(ctx, null, {
      titleBn: `${month}-এর বেতন দেওয়া হয়েছে`,
      bodyBn: `আপনার ${month}-এর বেতন ${how} দেওয়া হয়েছে। পরিমাণ, কর্তন ও পুরো হিসাব দেখতে নিচের বোতাম চাপুন।`,
      tone: "info",
      audience: { userIds: reachable.map((m) => m.userId) },
      rules: { closeButton: true },
      actions: [{ kind: "OPEN_SCREEN", labelBn: "বেতনের হিসাব দেখুন", labelEn: "Open my payslip", target: MY_RECORD_TARGET }],
      endsOn: dhakaDayKey(new Date(now.getTime() + POPUP_DAYS * 86_400_000)),
      repeat: "once",
    });
    const published = await publishPopupNotice(ctx, draft.id, now);
    popupNoticeId = new Types.ObjectId(published.id);
  }

  let notified = 0;
  if (picked.includes("notification")) {
    for (const m of reachable) {
      const created = await emitSalarySent({
        runId,
        channel,
        recipientUserId: m.userId,
        sendIndex,
        monthBn: month,
        netPayBn: bnNum(takaFigure(m.amount)),
        howBn: how,
      });
      if (created) notified += 1;
    }
  }

  const sent: StaffLetterSendChannel[] = [];
  if (popupNoticeId) sent.push("popup");
  if (notified > 0) sent.push("notification");
  if (sent.length === 0) throw new PayrollError("জানানো যায়নি — আবার চেষ্টা করুন");

  run.salarySentNotices = [
    ...(run.salarySentNotices ?? []),
    {
      channel,
      at: now,
      by: new Types.ObjectId(ctx.auth!.userId),
      sendChannels: sent,
      recipientCount: reachable.length,
      total: group.total,
      popupNoticeId,
    },
  ];
  await run.save();

  await writeAudit({
    eventKind: "SALARY_SENT_ANNOUNCED",
    actorId: ctx.auth!.userId,
    targetId: run._id,
    targetKind: "PayrollRun",
    meta: {
      monthKey,
      channel,
      sendChannels: sent,
      sendIndex,
      recipients: reachable.length,
      notified,
      withoutLogin: group.members.length - reachable.length,
      total: group.total,
    },
  });
  return salarySentGroups(runId);
}
