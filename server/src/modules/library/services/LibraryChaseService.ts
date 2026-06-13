import type { BorrowerType } from "@scd/shared";
import { BookLoan, type IBookLoan } from "../models/BookLoan";
import { BookTitle } from "../models/BookTitle";
import { BookCopy } from "../models/BookCopy";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { Guardian } from "../../foundation/models/Guardian";
import { normalizePhone } from "../../foundation/services/credentials";
import { renderTemplate } from "../../templates/services/MessageTemplateService";

/**
 * The overdue CHASE LIST (LB-5, D-#84) — works with ZERO notification
 * infrastructure: overdue ACTIVE loans grouped by borrower type, each row
 * carrying the right phone (student → the family phone on the Student row;
 * guardian → the guardian phone) and an ADR-003 wa.me click-to-send Bangla
 * reminder. Staff rows carry no wa.me link — staff are reached in-app
 * (LIBRARY_OVERDUE inbox) / directly. NO fines, ever (D-#27): the message
 * asks for the return, nothing else.
 */

type IdLike = { toString(): string };

export interface ChaseRow {
  loanId: string;
  borrowerType: BorrowerType;
  borrowerId: string;
  borrowerName: string | null;
  phone: string | null;
  titleBn: string | null;
  accessionNo: string | null;
  dueDate: Date;
  daysOverdue: number;
  /** ADR-003 manual wa.me deep link (null when no phone / staff row). */
  waLink: string | null;
}

/** The ADR-003 Bangla overdue-reminder deep link (no fines language). The body is the
 *  `library.overdue.wa` template (MT-2) — admin-editable, byte-identical by default. */
export async function buildOverdueReminderLink(args: {
  toPhone: string;
  borrowerName: string;
  titleBn: string;
  accessionNo: string;
  dueDateKey: string;
}): Promise<string> {
  const phone = normalizePhone(args.toPhone);
  const msg = await renderTemplate("library.overdue.wa", {
    borrowerName: args.borrowerName,
    title: args.titleBn,
    accessionNo: args.accessionNo,
    dueDateKey: args.dueDateKey,
  });
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

/** Pure: whole days past due at `now` (≥ 1 for an overdue loan). */
export function daysOverdueOf(dueDate: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000)));
}

function dateKeyOfLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Overdue ACTIVE loans grouped by borrower type, with wa.me links (J-L8). */
export async function libraryChaseList(now = new Date()): Promise<ChaseRow[]> {
  const overdue = (await BookLoan.find({ status: "ACTIVE", dueDate: { $lt: now } })
    .sort({ dueDate: 1 })
    .lean()) as unknown as Array<
    Pick<IBookLoan, "borrowerType" | "dueDate"> & {
      _id: IdLike;
      copyId: IdLike;
      titleId: IdLike;
      studentId?: IdLike | null;
      userId?: IdLike | null;
      guardianId?: IdLike | null;
    }
  >;
  if (overdue.length === 0) return [];

  const studentIds = overdue.filter((l) => l.borrowerType === "STUDENT").map((l) => l.studentId!.toString());
  const userIds = overdue.filter((l) => l.borrowerType === "STAFF").map((l) => l.userId!.toString());
  const guardianIds = overdue.filter((l) => l.borrowerType === "GUARDIAN").map((l) => l.guardianId!.toString());
  const titleIds = overdue.map((l) => l.titleId.toString());
  const copyIds = overdue.map((l) => l.copyId.toString());

  const [students, users, guardians, titles, copies] = await Promise.all([
    studentIds.length
      ? (Student.find({ _id: { $in: studentIds } }).select("name nameBn phone").lean() as unknown as Promise<
          Array<{ _id: IdLike; name: string; nameBn?: string; phone?: string }>
        >)
      : Promise.resolve([]),
    userIds.length
      ? (User.find({ _id: { $in: userIds } }).select("name phone").lean() as unknown as Promise<
          Array<{ _id: IdLike; name: string; phone?: string }>
        >)
      : Promise.resolve([]),
    guardianIds.length
      ? (Guardian.find({ _id: { $in: guardianIds } }).select("name phone").lean() as unknown as Promise<
          Array<{ _id: IdLike; name: string; phone?: string }>
        >)
      : Promise.resolve([]),
    BookTitle.find({ _id: { $in: titleIds } }).select("titleBn").lean() as unknown as Promise<
      Array<{ _id: IdLike; titleBn: string }>
    >,
    BookCopy.find({ _id: { $in: copyIds } }).select("accessionNo").lean() as unknown as Promise<
      Array<{ _id: IdLike; accessionNo: string }>
    >,
  ]);

  const studentMap = new Map(students.map((s) => [s._id.toString(), s]));
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));
  const guardianMap = new Map(guardians.map((g) => [g._id.toString(), g]));
  const titleMap = new Map(titles.map((t) => [t._id.toString(), t.titleBn]));
  const copyMap = new Map(copies.map((c) => [c._id.toString(), c.accessionNo]));

  const order: Record<BorrowerType, number> = { STUDENT: 0, GUARDIAN: 1, STAFF: 2 };

  const rows = await Promise.all(
    overdue.map(async (loan) => {
      let borrowerId = "";
      let borrowerName: string | null = null;
      let phone: string | null = null;
      if (loan.borrowerType === "STUDENT") {
        borrowerId = loan.studentId!.toString();
        const s = studentMap.get(borrowerId);
        borrowerName = s ? s.nameBn || s.name : null;
        phone = s?.phone ?? null; // the family phone (D-#31/#59 reality)
      } else if (loan.borrowerType === "STAFF") {
        borrowerId = loan.userId!.toString();
        const u = userMap.get(borrowerId);
        borrowerName = u?.name ?? null;
        phone = u?.phone ?? null;
      } else {
        borrowerId = loan.guardianId!.toString();
        const g = guardianMap.get(borrowerId);
        borrowerName = g?.name ?? null;
        phone = g?.phone ?? null;
      }
      const titleBn = titleMap.get(loan.titleId.toString()) ?? null;
      const accessionNo = copyMap.get(loan.copyId.toString()) ?? null;
      // Staff are chased in-app (inbox), not over WhatsApp (J-L8 scope).
      const waLink =
        loan.borrowerType !== "STAFF" && phone && borrowerName && titleBn && accessionNo
          ? await buildOverdueReminderLink({
              toPhone: phone,
              borrowerName,
              titleBn,
              accessionNo,
              dueDateKey: dateKeyOfLocal(new Date(loan.dueDate)),
            })
          : null;
      return {
        loanId: loan._id.toString(),
        borrowerType: loan.borrowerType as BorrowerType,
        borrowerId,
        borrowerName,
        phone,
        titleBn,
        accessionNo,
        dueDate: new Date(loan.dueDate),
        daysOverdue: daysOverdueOf(new Date(loan.dueDate), now),
        waLink,
      };
    }),
  );
  return rows.sort(
    (a, b) => order[a.borrowerType] - order[b.borrowerType] || a.dueDate.getTime() - b.dueDate.getTime(),
  );
}
