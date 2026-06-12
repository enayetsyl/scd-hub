import { BookReservation, type IBookReservation } from "../models/BookReservation";
import { BookCopy, type IBookCopy } from "../models/BookCopy";
import { BookTitle, type IBookTitle } from "../models/BookTitle";
import { BookLoan } from "../models/BookLoan";
import { writeAudit } from "../../platform/services/AuditService";
import { LibraryError } from "../errors";
import {
  type Borrower,
  borrowerFilter,
  borrowerFields,
  assertBorrowerExists,
} from "../borrowers";
import { getEffectivePolicy } from "./LibraryPolicyService";

/**
 * Title-level FIFO reservations (LB-3, D-#83).
 *
 * EXPIRY POSTURE (D-#83 / D-#21): a READY hold past `expiresAt` is expired
 * LAZILY at request time — `expireLapsedHolds()` is the ONE expiry truth, run
 * by every touch of the title (reserve / issue / renew / return / queue read).
 * If/when the D-#73 ticker exists, a sweep MAY call the same function — never
 * a second implementation.
 */

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Pure: has this READY hold lapsed? */
export function holdLapsed(resv: Pick<IBookReservation, "status" | "expiresAt">, now: Date): boolean {
  return resv.status === "READY" && !!resv.expiresAt && resv.expiresAt.getTime() < now.getTime();
}

/** Promote the oldest QUEUED reservation onto this copy (copy → ON_HOLD,
 *  head → READY with the reserver type's pickup window); with no queue the
 *  copy goes AVAILABLE. The single promotion path for return/expiry/cancel. */
export async function releaseCopyToQueue(copy: IBookCopy, now = new Date()): Promise<boolean> {
  const head = (await BookReservation.findOne({ titleId: copy.titleId, status: "QUEUED" })
    .sort({ createdAt: 1, _id: 1 })) as IBookReservation | null;
  if (!head) {
    copy.status = "AVAILABLE";
    await copy.save();
    return false;
  }
  const policy = await getEffectivePolicy(head.borrowerType);
  head.status = "READY";
  head.readyAt = now;
  head.heldCopyId = copy._id;
  head.expiresAt = addDays(now, policy.holdDays);
  await head.save();
  copy.status = "ON_HOLD";
  await copy.save();
  return true;
}

/** THE lazy-expiry pass (D-#21/D-#83): flip every lapsed READY hold on the
 *  title to EXPIRED (audited) and promote the next QUEUED borrower onto the
 *  freed copy. Call before any decision that depends on the queue. */
export async function expireLapsedHolds(titleId: string, now = new Date()): Promise<number> {
  const lapsed = (await BookReservation.find({
    titleId,
    status: "READY",
    expiresAt: { $lt: now },
  })) as IBookReservation[];
  for (const resv of lapsed) {
    resv.status = "EXPIRED";
    await resv.save();
    await writeAudit({
      eventKind: "RESERVATION_EXPIRED",
      targetId: resv._id,
      targetKind: "BookReservation",
      meta: { titleId, borrowerType: resv.borrowerType },
    });
    if (resv.heldCopyId) {
      const copy = (await BookCopy.findById(resv.heldCopyId)) as IBookCopy | null;
      if (copy && copy.status === "ON_HOLD") {
        await releaseCopyToQueue(copy, now);
      }
    }
  }
  return lapsed.length;
}

/** Is renewal blocked by the queue (J-L5: any QUEUED or READY reservation)? */
export async function reservationBlocksRenewal(titleId: string): Promise<boolean> {
  const blocking = await BookReservation.countDocuments({
    titleId,
    status: { $in: ["QUEUED", "READY"] },
  });
  return blocking > 0;
}

/** The READY reservation holding this specific copy, if any. */
export async function readyReservationForCopy(copyId: string): Promise<IBookReservation | null> {
  return BookReservation.findOne({ heldCopyId: copyId, status: "READY" }) as Promise<IBookReservation | null>;
}

/** Mark a READY reservation fulfilled (its borrower got the held copy). */
export async function fulfillReservation(reservationId: string): Promise<void> {
  await BookReservation.updateOne({ _id: reservationId }, { $set: { status: "FULFILLED" } });
}

/** Place a title-level reservation (staff self-serve or desk on behalf). */
export async function reserveTitle(
  titleId: string,
  borrower: Borrower,
  actorId: string,
): Promise<IBookReservation> {
  const title = (await BookTitle.findById(titleId).lean()) as IBookTitle | null;
  if (!title || !title.active) throw new LibraryError("বইটি পাওয়া যায়নি");
  await assertBorrowerExists(borrower);
  await expireLapsedHolds(titleId);

  const dup = await BookReservation.findOne({
    titleId,
    ...borrowerFilter(borrower),
    status: { $in: ["QUEUED", "READY"] },
  }).lean();
  if (dup) throw new LibraryError("এই বইয়ের জন্য ইতিমধ্যে একটি সক্রিয় সংরক্ষণ রয়েছে");

  const holding = await BookLoan.findOne({
    titleId,
    ...borrowerFilter(borrower),
    status: "ACTIVE",
  }).lean();
  if (holding) throw new LibraryError("বইটির একটি কপি ইতিমধ্যে এই পাঠকের কাছে আছে");

  const resv = (await BookReservation.create({
    titleId,
    ...borrowerFields(borrower),
    status: "QUEUED",
  })) as IBookReservation;
  await writeAudit({
    eventKind: "RESERVATION_PLACED",
    actorId,
    targetId: resv._id,
    targetKind: "BookReservation",
    meta: { titleId, borrowerType: borrower.type },
  });
  return resv;
}

/** Cancel a QUEUED/READY reservation; a cancelled READY hold releases its copy
 *  to the next in queue (or back to AVAILABLE). */
export async function cancelReservation(reservationId: string): Promise<IBookReservation> {
  const resv = (await BookReservation.findById(reservationId)) as IBookReservation | null;
  if (!resv) throw new LibraryError("সংরক্ষণটি পাওয়া যায়নি");
  if (resv.status !== "QUEUED" && resv.status !== "READY") {
    throw new LibraryError("সংরক্ষণটি আর সক্রিয় নয়");
  }
  const heldCopyId = resv.status === "READY" ? resv.heldCopyId : undefined;
  resv.status = "CANCELLED";
  await resv.save();
  if (heldCopyId) {
    const copy = (await BookCopy.findById(heldCopyId)) as IBookCopy | null;
    if (copy && copy.status === "ON_HOLD") {
      await releaseCopyToQueue(copy);
    }
  }
  return resv;
}

/** The title's queue, FIFO, after the lazy-expiry pass (active rows only). */
export async function reservationsForTitle(titleId: string): Promise<IBookReservation[]> {
  await expireLapsedHolds(titleId);
  return BookReservation.find({ titleId, status: { $in: ["QUEUED", "READY"] } })
    .sort({ createdAt: 1, _id: 1 })
    .lean() as unknown as IBookReservation[];
}

/** One borrower's reservations (own-row for staff; desk view per borrower). */
export async function reservationsForBorrower(borrower: Borrower): Promise<IBookReservation[]> {
  return BookReservation.find({ ...borrowerFilter(borrower) })
    .sort({ createdAt: -1 })
    .lean() as unknown as IBookReservation[];
}
