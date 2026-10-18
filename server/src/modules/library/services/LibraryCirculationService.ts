import type { LoanStatus, BorrowerType } from "@scd/shared";
import { COPY_STATUS_LABELS_BN } from "@scd/shared";
import { BookCopy, type IBookCopy } from "../models/BookCopy";
import { BookLoan, type IBookLoan } from "../models/BookLoan";
import { writeAudit } from "../../platform/services/AuditService";
import { LibraryError } from "../errors";
import {
  type Borrower,
  borrowerFilter,
  borrowerFields,
  borrowerMatches,
  assertBorrowerExists,
} from "../borrowers";
import { getEffectivePolicy } from "./LibraryPolicyService";
import {
  addDays,
  expireLapsedHolds,
  releaseCopyToQueue,
  reservationBlocksRenewal,
  readyReservationForCopy,
  fulfillReservation,
} from "./LibraryReservationService";

/**
 * The circulation desk (LB-2, D-#81/#82): issue / return / renew / lost. All
 * mutations resolver-gated by `assertIsLibrarian`. Due dates come from the
 * borrower type's policy (admin data). NO fines and NO money fields ever —
 * overdue draws reminders + the chase list (LB-5); lost = replacement note
 * (D-#27). OVERDUE is computed from dueDate, never stored.
 */

/** Pure: is an ACTIVE loan overdue at `now`? */
export function isOverdue(loan: Pick<IBookLoan, "status" | "dueDate">, now = new Date()): boolean {
  return loan.status === "ACTIVE" && loan.dueDate.getTime() < now.getTime();
}

/** Issue the copy with this accession number to a borrower (J-L2/J-L3/J-L6).
 *  AVAILABLE issues to anyone under the concurrent limit; an ON_HOLD copy
 *  issues ONLY to the READY reservation's borrower (fulfilling it). */
export async function issueBook(
  accessionNo: string,
  borrower: Borrower,
  actorId: string,
  now = new Date(),
): Promise<IBookLoan> {
  await assertBorrowerExists(borrower);
  const accession = accessionNo.trim();
  let copy = (await BookCopy.findOne({ accessionNo: accession })) as IBookCopy | null;
  if (!copy) throw new LibraryError(`অ্যাকসেশন নম্বর ${accession} পাওয়া যায়নি`);

  // Lazy expiry first (D-#21/D-#83) — a lapsed hold may free or re-hold this copy.
  await expireLapsedHolds(copy.titleId.toString(), now);
  copy = (await BookCopy.findById(copy._id)) as IBookCopy;

  let holdReservationId: string | null = null;
  if (copy.status === "ON_HOLD") {
    const resv = await readyReservationForCopy(copy._id.toString());
    if (!resv || !borrowerMatches(resv as never, borrower)) {
      throw new LibraryError("কপিটি অন্য পাঠকের জন্য সংরক্ষিত (হোল্ড)");
    }
    holdReservationId = resv._id.toString();
  } else if (copy.status !== "AVAILABLE") {
    throw new LibraryError(
      `কপিটি ইস্যুর জন্য উপলব্ধ নয় (${COPY_STATUS_LABELS_BN[copy.status]})`,
    );
  }

  const policy = await getEffectivePolicy(borrower.type);
  const activeCount = await BookLoan.countDocuments({
    ...borrowerFilter(borrower),
    status: "ACTIVE",
  });
  if (activeCount >= policy.maxConcurrent) {
    throw new LibraryError(
      `এই পাঠক একসাথে সর্বোচ্চ ${policy.maxConcurrent}টি বই নিতে পারেন — আগে একটি ফেরত দিন`,
    );
  }

  const loan = (await BookLoan.create({
    copyId: copy._id,
    titleId: copy.titleId,
    ...borrowerFields(borrower),
    issuedAt: now,
    dueDate: addDays(now, policy.loanDays),
    renewCount: 0,
    status: "ACTIVE" satisfies LoanStatus,
    issuedBy: actorId,
  })) as IBookLoan;

  // Fulfill the hold AFTER the loan exists (the failure path above leaves it READY).
  if (holdReservationId) {
    await fulfillReservation(holdReservationId);
  }
  copy.status = "ON_LOAN";
  await copy.save();

  await writeAudit({
    eventKind: "BOOK_ISSUED",
    actorId,
    targetId: loan._id,
    targetKind: "BookLoan",
    meta: { accessionNo: accession, borrowerType: borrower.type, dueDate: loan.dueDate.toISOString() },
  });
  return loan;
}

/** Return an ACTIVE loan (J-L4): copy → AVAILABLE, unless a queue exists —
 *  then the copy goes ON_HOLD for the head reservation (J-L6). */
export async function returnBook(loanId: string, actorId: string, now = new Date()): Promise<IBookLoan> {
  const loan = (await BookLoan.findById(loanId)) as IBookLoan | null;
  if (!loan) throw new LibraryError("ঋণটি পাওয়া যায়নি");
  if (loan.status !== "ACTIVE") throw new LibraryError("ঋণটি চলমান নয়");

  loan.status = "RETURNED";
  loan.returnedAt = now;
  loan.returnedBy = actorId as never;
  await loan.save();

  await expireLapsedHolds(loan.titleId.toString(), now);
  const copy = (await BookCopy.findById(loan.copyId)) as IBookCopy | null;
  if (copy) {
    await releaseCopyToQueue(copy, now);
  }

  await writeAudit({
    eventKind: "BOOK_RETURNED",
    actorId,
    targetId: loan._id,
    targetKind: "BookLoan",
    meta: { copyId: loan.copyId.toString() },
  });
  return loan;
}

/** Renew an ACTIVE loan (J-L5): blocked at the type's maxRenewals OR while any
 *  QUEUED/READY reservation exists on the title; else dueDate += loanDays. */
export async function renewLoan(loanId: string, actorId: string, now = new Date()): Promise<IBookLoan> {
  const loan = (await BookLoan.findById(loanId)) as IBookLoan | null;
  if (!loan) throw new LibraryError("ঋণটি পাওয়া যায়নি");
  if (loan.status !== "ACTIVE") throw new LibraryError("ঋণটি চলমান নয়");

  await expireLapsedHolds(loan.titleId.toString(), now);
  const policy = await getEffectivePolicy(loan.borrowerType as BorrowerType);
  if (loan.renewCount >= policy.maxRenewals) {
    throw new LibraryError(`নবায়নের সীমা (${policy.maxRenewals}) শেষ — বইটি ফেরত দিন`);
  }
  if (await reservationBlocksRenewal(loan.titleId.toString())) {
    throw new LibraryError("বইটির জন্য সংরক্ষণ অপেক্ষমাণ — নবায়ন সম্ভব নয়");
  }

  loan.dueDate = addDays(loan.dueDate, policy.loanDays);
  loan.renewCount += 1;
  await loan.save();

  await writeAudit({
    eventKind: "BOOK_RENEWED",
    actorId,
    targetId: loan._id,
    targetKind: "BookLoan",
    meta: { renewCount: loan.renewCount, dueDate: loan.dueDate.toISOString() },
  });
  return loan;
}

/** Settle a loan as lost (J-L7): loan LOST + copy LOST + replacement NOTE —
 *  no monetary field exists anywhere. A replacement copy enters later as a NEW
 *  accession via the catalog. */
export async function markLost(
  loanId: string,
  note: string,
  actorId: string,
): Promise<IBookLoan> {
  if (!note?.trim()) throw new LibraryError("প্রতিস্থাপন/হারানোর টীকা আবশ্যক");
  const loan = (await BookLoan.findById(loanId)) as IBookLoan | null;
  if (!loan) throw new LibraryError("ঋণটি পাওয়া যায়নি");
  if (loan.status !== "ACTIVE") throw new LibraryError("ঋণটি চলমান নয়");

  loan.status = "LOST";
  loan.lostNote = note.trim();
  await loan.save();

  const copy = (await BookCopy.findById(loan.copyId)) as IBookCopy | null;
  if (copy) {
    copy.status = "LOST";
    await copy.save();
  }

  await writeAudit({
    eventKind: "BOOK_MARKED_LOST",
    actorId,
    targetId: loan._id,
    targetKind: "BookLoan",
    meta: { copyId: loan.copyId.toString() },
  });
  return loan;
}

export interface LoanFilter {
  status?: LoanStatus | null;
  borrowerType?: BorrowerType | null;
  overdueOnly?: boolean | null;
}

/** Desk view of loans (newest first). overdueOnly = ACTIVE past due NOW. */
export async function loans(filter: LoanFilter, now = new Date()): Promise<IBookLoan[]> {
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  if (filter.borrowerType) query.borrowerType = filter.borrowerType;
  if (filter.overdueOnly) {
    query.status = "ACTIVE";
    query.dueDate = { $lt: now };
  }
  return BookLoan.find(query).sort({ issuedAt: -1 }).lean() as unknown as IBookLoan[];
}

/** One borrower's loans, newest first (desk view / staff own-row).
 *  D-#761: `activeOnly` keeps just the books still out — what the desk and the staff
 *  home render — instead of the whole loan history; `limit` keeps the newest N.
 *  Both omitted = every loan, as before. */
export async function borrowerLoans(
  borrower: Borrower,
  opts: { activeOnly?: boolean | null; limit?: number | null } = {},
): Promise<IBookLoan[]> {
  const query: Record<string, unknown> = { ...borrowerFilter(borrower) };
  if (opts.activeOnly) query.status = "ACTIVE";
  let q = BookLoan.find(query).sort({ issuedAt: -1, _id: -1 });
  if (opts.limit != null && opts.limit > 0) q = q.limit(opts.limit);
  return q.lean() as unknown as IBookLoan[];
}

/** D-#761: the guardian home's bounded loan list — the newest `limit` loans plus any
 *  older loan still ACTIVE (a book the child still has must never drop off), newest first. */
export async function recentLoansPlusActive(borrower: Borrower, limit: number): Promise<IBookLoan[]> {
  const [recent, active] = await Promise.all([
    borrowerLoans(borrower, { limit }),
    borrowerLoans(borrower, { activeOnly: true }),
  ]);
  const seen = new Set(recent.map((l) => String(l._id)));
  const extra = active.filter((l) => !seen.has(String(l._id)));
  return [...recent, ...extra].sort(
    (a, b) =>
      new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime() || String(b._id).localeCompare(String(a._id)),
  );
}
