import type { BorrowerType } from "@scd/shared";
import { Student } from "../foundation/models/Student";
import { User } from "../foundation/models/User";
import { Guardian } from "../foundation/models/Guardian";
import { LibraryError } from "./errors";

/**
 * The exactly-one-of borrower shape shared by BookLoan + BookReservation
 * (prd-library §5): a borrower is a Student, a staff User, or a Guardian —
 * read-only roster references, no roster change (D-#81).
 */
export interface Borrower {
  type: BorrowerType;
  /** The Student/User/Guardian _id, per `type`. */
  id: string;
}

export type BorrowerIdField = "studentId" | "userId" | "guardianId";

export function borrowerField(type: BorrowerType): BorrowerIdField {
  switch (type) {
    case "STUDENT":
      return "studentId";
    case "STAFF":
      return "userId";
    case "GUARDIAN":
      return "guardianId";
  }
}

/** Mongo filter selecting one borrower's rows. */
export function borrowerFilter(b: Borrower): Record<string, unknown> {
  return { borrowerType: b.type, [borrowerField(b.type)]: b.id };
}

/** The $set/create fields naming one borrower. */
export function borrowerFields(b: Borrower): Record<string, unknown> {
  return { borrowerType: b.type, [borrowerField(b.type)]: b.id };
}

/** Does a stored row (loan/reservation) belong to this borrower? */
export function borrowerMatches(
  row: { borrowerType: string; studentId?: { toString(): string } | null; userId?: { toString(): string } | null; guardianId?: { toString(): string } | null },
  b: Borrower,
): boolean {
  if (row.borrowerType !== b.type) return false;
  const stored = row[borrowerField(b.type)];
  return !!stored && stored.toString() === b.id;
}

/** Assert the borrower exists and is active on the roster (Bangla deny). */
export async function assertBorrowerExists(b: Borrower): Promise<void> {
  if (!b.id) throw new LibraryError("পাঠক নির্বাচন করুন");
  if (b.type === "STUDENT") {
    const s = await Student.findById(b.id).lean();
    if (!s || !s.active) throw new LibraryError("শিক্ষার্থীটি পাওয়া যায়নি বা সক্রিয় নয়");
    return;
  }
  if (b.type === "STAFF") {
    const u = await User.findById(b.id).lean();
    if (!u || !u.active) throw new LibraryError("স্টাফ অ্যাকাউন্টটি পাওয়া যায়নি বা সক্রিয় নয়");
    return;
  }
  const g = await Guardian.findById(b.id).lean();
  if (!g || !g.active) throw new LibraryError("অভিভাবকটি পাওয়া যায়নি বা সক্রিয় নয়");
}
