import { BookLoan, type IBookLoan } from "../models/BookLoan";
import { BookTitle } from "../models/BookTitle";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { emit } from "../../notifications/services/NotificationService";
import { dateKeyOf, parseDateKey } from "../../attendance/dates";
import { resolveDayType } from "../../routine/calendar";

/**
 * Due-soon / overdue reminder dispatch (LB-5, D-#84) — rides the D-#72
 * `emit()` seam: the inbox row is the delivery; push joins when N-4 registers
 * its channel. Idempotent by dedupeKey, so the dispatcher can run any number
 * of times per day:
 *
 *   LIBRARY_DUE_SOON  `LIBDS:<loanId>`        — once, the day before dueDate.
 *   LIBRARY_OVERDUE   `LIBOD:<loanId>:<rung>` — rung 1 on the first SCHOOL day
 *     after dueDate, then every 3rd school day (rung 2 on the 4th, …). School
 *     days come from the routine calendar (`resolveDayType`) — the same
 *     single calendar source every module uses (D-#50).
 *
 * Recipients: a STAFF borrower gets their own inbox row; a GUARDIAN borrower
 * gets their guardian inbox row when login-enabled; a STUDENT borrower's
 * reminders go to every login-enabled linked guardian. Contact-only guardians
 * (D-#31) stay wa.me-only via the chase list — the recorded D-#72 limitation.
 *
 * Driven by POST /triggers/library-reminder (the AT-4 external-scheduler
 * pattern, shared secret) until the D-#73 in-process ticker (N-2) lands —
 * the ticker should then call this same function, never a second truth.
 */

type IdLike = { toString(): string };

export const libraryDedupeKeys = {
  dueSoon: (loanId: string) => `LIBDS:${loanId}`,
  overdue: (loanId: string, rung: number) => `LIBOD:${loanId}:${rung}`,
} as const;

/** Count SCHOOL days in (afterKey, uptoKey] — days the chase ladder advances on. */
export async function countSchoolDaysBetween(afterKey: string, uptoKey: string): Promise<number> {
  if (uptoKey <= afterKey) return 0;
  let count = 0;
  const cursor = parseDateKey(afterKey);
  const end = parseDateKey(uptoKey);
  // Bounded walk — a loan years overdue still terminates promptly.
  for (let i = 0; i < 370 && cursor < end; i++) {
    cursor.setDate(cursor.getDate() + 1);
    const dayType = await resolveDayType(new Date(cursor));
    if (dayType === "FULL" || dayType === "QURAN_ONLY") count += 1;
  }
  return count;
}

/** Pure: which overdue rung is due after `schoolDaysSinceDue` school days?
 *  Rung 1 fires on school day 1, rung 2 on day 4, rung 3 on day 7… (every
 *  3rd); 0 = nothing due yet. */
export function overdueRungFor(schoolDaysSinceDue: number): number {
  if (schoolDaysSinceDue < 1) return 0;
  return Math.floor((schoolDaysSinceDue - 1) / 3) + 1;
}

interface LoanLean {
  _id: IdLike;
  titleId: IdLike;
  borrowerType: string;
  studentId?: IdLike | null;
  userId?: IdLike | null;
  guardianId?: IdLike | null;
  dueDate: Date;
}

/** Resolve the inbox recipients for one loan (see header). */
async function recipientsOf(loan: LoanLean): Promise<Array<{ userId?: string; guardianId?: string }>> {
  if (loan.borrowerType === "STAFF") {
    return [{ userId: loan.userId!.toString() }];
  }
  if (loan.borrowerType === "GUARDIAN") {
    const g = (await Guardian.findOne({ _id: loan.guardianId, loginEnabled: true, active: true })
      .select("_id")
      .lean()) as { _id: IdLike } | null;
    return g ? [{ guardianId: g._id.toString() }] : [];
  }
  // STUDENT → every login-enabled linked guardian (active link).
  const links = (await GuardianLink.find({ studentId: loan.studentId, active: { $ne: false } })
    .select("guardianId")
    .lean()) as unknown as Array<{ guardianId: IdLike }>;
  if (links.length === 0) return [];
  const guardians = (await Guardian.find({
    _id: { $in: links.map((l) => l.guardianId.toString()) },
    loginEnabled: true,
    active: true,
  })
    .select("_id")
    .lean()) as unknown as Array<{ _id: IdLike }>;
  return guardians.map((g) => ({ guardianId: g._id.toString() }));
}

export interface LibraryReminderSummary {
  dueSoonEmitted: number;
  overdueEmitted: number;
}

/** One dispatcher pass (idempotent — safe to re-run any number of times). */
export async function dispatchLibraryReminders(now = new Date()): Promise<LibraryReminderSummary> {
  const todayKey = dateKeyOf(now);
  const summary: LibraryReminderSummary = { dueSoonEmitted: 0, overdueEmitted: 0 };

  const active = (await BookLoan.find({ status: "ACTIVE" })
    .select("titleId borrowerType studentId userId guardianId dueDate")
    .lean()) as unknown as LoanLean[];
  if (active.length === 0) return summary;

  const titles = (await BookTitle.find({ _id: { $in: active.map((l) => l.titleId.toString()) } })
    .select("titleBn")
    .lean()) as unknown as Array<{ _id: IdLike; titleBn: string }>;
  const titleMap = new Map(titles.map((t) => [t._id.toString(), t.titleBn]));

  for (const loan of active) {
    const dueKey = dateKeyOf(new Date(loan.dueDate));
    const titleBn = titleMap.get(loan.titleId.toString()) ?? "বই";
    const loanId = loan._id.toString();

    // Due tomorrow → LIBRARY_DUE_SOON, once.
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (dueKey === dateKeyOf(tomorrow)) {
      for (const r of await recipientsOf(loan)) {
        const res = await emit({
          recipientUserId: r.userId ?? null,
          recipientGuardianId: r.guardianId ?? null,
          kind: "LIBRARY_DUE_SOON",
          titleBn: "বই ফেরতের স্মরণিকা",
          bodyBn: `“${titleBn}” বইটির ফেরতের তারিখ আগামীকাল (${dueKey})। অনুগ্রহ করে সময়মতো ফেরত দিন।`,
          refs: { loanId, date: dueKey },
          dedupeKey: r.guardianId
            ? `${libraryDedupeKeys.dueSoon(loanId)}:${r.guardianId}`
            : libraryDedupeKeys.dueSoon(loanId),
        });
        if (res.created) summary.dueSoonEmitted += 1;
      }
      continue;
    }

    // Past due → the school-day rung ladder.
    if (dueKey < todayKey) {
      const schoolDays = await countSchoolDaysBetween(dueKey, todayKey);
      const rung = overdueRungFor(schoolDays);
      if (rung === 0) continue;
      for (const r of await recipientsOf(loan)) {
        const res = await emit({
          recipientUserId: r.userId ?? null,
          recipientGuardianId: r.guardianId ?? null,
          kind: "LIBRARY_OVERDUE",
          titleBn: "বই ফেরত বকেয়া",
          bodyBn: `“${titleBn}” বইটির ফেরতের তারিখ (${dueKey}) পেরিয়ে গেছে। অনুগ্রহ করে বইটি লাইব্রেরিতে ফেরত দিন।`,
          refs: { loanId, date: dueKey, rung },
          dedupeKey: r.guardianId
            ? `${libraryDedupeKeys.overdue(loanId, rung)}:${r.guardianId}`
            : libraryDedupeKeys.overdue(loanId, rung),
        });
        if (res.created) summary.overdueEmitted += 1;
      }
    }
  }
  return summary;
}
