/**
 * Book-lifecycle notifications (docs/prd-book-lifecycle.md §16, D-#1610). No review-round kinds:
 * the reviewer works on paper and has no login (owner Q1). Fail-soft: a notification failure never
 * undoes the write it reports.
 */
import type { ISchoolBook } from "../models/SchoolBook";
import type { IBookFeedback } from "../models/BookFeedback";
import { emit } from "../../notifications/services/NotificationService";
import { holderIdsOf } from "../../access-control/services/holders";
import { dhakaDayKey } from "../../../lib/dhakaDay";

async function safe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error("[BookLcNotify]", err);
  }
}

/** A teacher / print report arrived → `manage` holders, one per book per Dhaka day. */
export async function notifyFeedbackFiled(book: ISchoolBook, item: IBookFeedback, filedBy?: string): Promise<void> {
  if (item.source !== "teacher" && item.source !== "print_error") return;
  const day = dhakaDayKey(new Date());
  await safe(async () => {
    for (const userId of await holderIdsOf("book_lifecycle:manage")) {
      if (item.reporterId && item.reporterId.toString() === userId) continue;
      // The person who filed it (e.g. the Principal logging a print error) is not told of her own item.
      if (filedBy && filedBy === userId) continue;
      await emit({
        recipientUserId: userId,
        kind: "BOOK_FEEDBACK_FILED",
        titleBn: `বইয়ের নতুন মতামত: ${book.titleBn}`,
        bodyBn: `${book.code} — আজ নতুন মতামত এসেছে (${item.code})। মতামত বাছাইয়ে দেখুন।`,
        refs: { bookId: book._id.toString() },
        dedupeKey: `BOOK_FEEDBACK_FILED:${book._id}:${day}:${userId}`,
      });
    }
  });
}

/** Her item was accepted / rejected / applied → the reporter (teacher reports only). */
export async function notifyFeedbackAnswered(book: ISchoolBook, item: IBookFeedback, outcomeBn: string): Promise<void> {
  if (!item.reporterId) return;
  await safe(() =>
    emit({
      recipientUserId: item.reporterId!.toString(),
      kind: "BOOK_FEEDBACK_ANSWERED",
      titleBn: `আপনার জানানো ভুল (${item.code})`,
      bodyBn: `${book.titleBn}: ${outcomeBn}`,
      refs: { bookId: book._id.toString() },
      dedupeKey: `BOOK_FEEDBACK_ANSWERED:${item._id}:${item.status}:${item.history.length}`,
    }),
  );
}
