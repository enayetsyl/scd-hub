/**
 * Storybook reading — what a family sees, and what tells them (SB-4, D-#983/#984).
 *
 *  - `childStoryReading`: the books the child holds now, the books read (the desk's tick at
 *    return) in the last 7 days / this month / this year (Dhaka), stickers, and recent history.
 *    Storybooks only (titles in a series); ordinary library loans stay on the loans card.
 *  - Alerts (D-#984 — notification + pop-up + Today card): a storybook lent to a child
 *    (STORYBOOK_ISSUED) and a sticker earned at return (STORYBOOK_STICKER). The notification
 *    goes to every linked, active guardian, deduped per loan AND guardian; the pop-up targets
 *    the child's family and needs the sender's own popup_notice:send_guardian — without it
 *    (a teacher on desk duty) the pop-up is skipped, the notification still goes. Best effort:
 *    an alert never fails the issue / return it follows.
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Guardian } from "../../foundation/models/Guardian";
import { Student } from "../../foundation/models/Student";
import { emit } from "../../notifications/services/NotificationService";
import { savePopupDraft, publishPopupNotice } from "../../popup-notices/services/PopupNoticeService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { BookLoan, type IBookLoan } from "../models/BookLoan";
import { BookTitle, type IBookTitle } from "../models/BookTitle";
import { StorySeries } from "../models/StorySeries";
import { resolveShelfViewer } from "./StorybookService";
import { bnDayLabel } from "./StoryHoldService";
import { guardiansWithFeature } from "../../guardian-access/services/GuardianFeatureService";

const DAY_MS = 86_400_000;
const HISTORY = 20;

export interface StoryLoanView {
  loan: IBookLoan;
  title: IBookTitle;
  seriesNameBn: string | null;
}

export interface ChildStoryReading {
  current: StoryLoanView[];
  history: StoryLoanView[];
  readLast7Days: number;
  readThisMonth: number;
  readThisYear: number;
  stickersThisYear: number;
  stickersTotal: number;
}

/** Was this return counted as read in the window [from, ∞)? */
const readSince = (l: IBookLoan, from: Date) => l.status === "RETURNED" && l.readAtReturn === true && !!l.returnedAt && new Date(l.returnedAt) >= from;

export async function childStoryReading(ctx: AppContext, studentId: string, now = new Date()): Promise<ChildStoryReading> {
  await resolveShelfViewer(ctx, studentId);
  const loans = (await BookLoan.find({ studentId }).sort({ issuedAt: -1 }).lean()) as unknown as IBookLoan[];
  const titles = (await BookTitle.find({ _id: { $in: loans.map((l) => l.titleId) }, seriesId: { $exists: true } }).lean()) as unknown as IBookTitle[];
  const tById = new Map(titles.map((t) => [t._id.toString(), t]));
  const story = loans.filter((l) => tById.has(l.titleId.toString()));
  const series = await StorySeries.find({ _id: { $in: titles.map((t) => t.seriesId) } }).select("nameBn").lean();
  const sById = new Map(series.map((s) => [s._id.toString(), s.nameBn as string]));
  const view = (l: IBookLoan): StoryLoanView => {
    const title = tById.get(l.titleId.toString())!;
    return { loan: l, title, seriesNameBn: title.seriesId ? sById.get(title.seriesId.toString()) ?? null : null };
  };
  const today = dhakaDayKey(now);
  const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00+06:00`);
  const yearStart = new Date(`${today.slice(0, 4)}-01-01T00:00:00+06:00`);
  const weekStart = new Date(now.getTime() - 7 * DAY_MS);
  const returned = story.filter((l) => l.status === "RETURNED");
  return {
    current: story.filter((l) => l.status === "ACTIVE").map(view),
    history: returned
      .sort((a, b) => new Date(b.returnedAt ?? 0).getTime() - new Date(a.returnedAt ?? 0).getTime())
      .slice(0, HISTORY)
      .map(view),
    readLast7Days: story.filter((l) => readSince(l, weekStart)).length,
    readThisMonth: story.filter((l) => readSince(l, monthStart)).length,
    readThisYear: story.filter((l) => readSince(l, yearStart)).length,
    stickersThisYear: returned.filter((l) => l.stickerGiven === true && !!l.returnedAt && new Date(l.returnedAt) >= yearStart).length,
    stickersTotal: returned.filter((l) => l.stickerGiven === true).length,
  };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export const storyAlertKey = (kind: "ISSUED" | "STICKER", loanId: string, guardianId: string): string =>
  `${kind === "ISSUED" ? "SBI" : "SBS"}:${loanId}:${guardianId}`;

/** A storybook loan's book + child, or null when the loan is not a child's storybook loan. */
async function storyLoanContext(loan: Pick<IBookLoan, "titleId" | "studentId" | "borrowerType">) {
  if (loan.borrowerType !== "STUDENT" || !loan.studentId) return null;
  const title = await BookTitle.findById(loan.titleId).select("titleBn seriesId").lean();
  if (!title?.seriesId) return null;
  const student = await Student.findById(loan.studentId).select("name nameBn").lean();
  const links = await GuardianLink.find({ studentId: loan.studentId }).select("guardianId active").lean();
  // D-#1011: only families who can see the shelf are told (no notification → no pop-up either).
  const guardians = await guardiansWithFeature(
    "STORYBOOKS",
    await Guardian.find({ _id: { $in: links.filter((l) => l.active !== false).map((l) => l.guardianId) }, active: true })
      .select("_id")
      .lean(),
  );
  return { titleBn: title.titleBn as string, child: (student?.nameBn || student?.name || "") as string, guardians };
}

async function popup(ctx: AppContext, studentId: Types.ObjectId, titleBn: string, bodyBn: string, now: Date): Promise<boolean> {
  if (!ctx.auth || !callerHasPermission(ctx.auth, "popup_notice:send_guardian")) return false;
  try {
    const draft = await savePopupDraft(ctx, null, {
      titleBn,
      bodyBn,
      tone: "info",
      audience: { studentIds: [studentId.toString()] },
      rules: { closeButton: true },
      actions: [{ kind: "OPEN_SCREEN", labelBn: "গল্পের বই দেখুন", labelEn: "Open storybooks", target: "GuardianStoriesTab" }],
      endsOn: dhakaDayKey(new Date(now.getTime() + 3 * DAY_MS)),
      repeat: "once",
    });
    await publishPopupNotice(ctx, draft.id, now);
    return true;
  } catch (e) {
    console.warn("storybook pop-up skipped:", (e as Error)?.message);
    return false;
  }
}

export interface AlertResult {
  notified: number;
  popup: boolean;
}

/** A child borrowed a storybook → tell the family. */
export async function alertStoryIssued(ctx: AppContext, loan: IBookLoan, now = new Date()): Promise<AlertResult> {
  const c = await storyLoanContext(loan).catch(() => null);
  if (!c) return { notified: 0, popup: false };
  const due = bnDayLabel(dhakaDayKey(new Date(loan.dueDate)));
  const titleBn = `${c.child} নতুন বই নিয়েছে`;
  const bodyBn = `“${c.titleBn}” — ফেরত দিতে হবে ${due}-এর মধ্যে। একসাথে পড়ুন!`;
  let notified = 0;
  for (const g of c.guardians) {
    const r = await emit({
      recipientGuardianId: g._id.toString(),
      recipientUserId: null,
      kind: "STORYBOOK_ISSUED",
      titleBn,
      bodyBn,
      refs: { studentId: loan.studentId!.toString(), loanId: loan._id.toString() },
      dedupeKey: storyAlertKey("ISSUED", loan._id.toString(), g._id.toString()),
    }).catch(() => ({ created: false }));
    if (r.created) notified += 1;
  }
  // A retry finds every notification already sent — no second pop-up either.
  return { notified, popup: notified > 0 ? await popup(ctx, loan.studentId!, titleBn, bodyBn, now) : false };
}

/** The desk gave a sticker for a read book → tell the family. */
export async function alertStorySticker(ctx: AppContext, loan: IBookLoan, now = new Date()): Promise<AlertResult> {
  if (loan.stickerGiven !== true) return { notified: 0, popup: false };
  const c = await storyLoanContext(loan).catch(() => null);
  if (!c) return { notified: 0, popup: false };
  const titleBn = `${c.child} একটি স্টিকার পেয়েছে ★`;
  const bodyBn = `“${c.titleBn}” পুরোটা পড়ে ফেরত দিয়েছে। শাবাশ!`;
  let notified = 0;
  for (const g of c.guardians) {
    const r = await emit({
      recipientGuardianId: g._id.toString(),
      recipientUserId: null,
      kind: "STORYBOOK_STICKER",
      titleBn,
      bodyBn,
      refs: { studentId: loan.studentId!.toString(), loanId: loan._id.toString() },
      dedupeKey: storyAlertKey("STICKER", loan._id.toString(), g._id.toString()),
    }).catch(() => ({ created: false }));
    if (r.created) notified += 1;
  }
  // A retry finds every notification already sent — no second pop-up either.
  return { notified, popup: notified > 0 ? await popup(ctx, loan.studentId!, titleBn, bodyBn, now) : false };
}
