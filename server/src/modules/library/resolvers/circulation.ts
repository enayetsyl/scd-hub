/**
 * Circulation desk + reservations resolvers (LB-2/LB-3, D-#81/#82/#83).
 *
 * Gates (prd-library §4, ADR-004 layering):
 *   Desk mutations (issue/return/renew/lost, desk reserve/cancel, queue view)
 *     → `assertIsLibrarian` (library:manage OR an active LibrarianAssignment).
 *   Staff self-service (myLoans/myReservations, reserve for SELF, cancel own)
 *     → `library:read`, own-row only.
 *
 * NO fines, no money fields (D-#27). All identity-plane (ADR-005).
 */
import { builder } from "../../../schema";
import { callerHasPermission, BORROWER_TYPES, LOAN_STATUSES } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { LibraryError } from "../errors";
import { type Borrower, borrowerField } from "../borrowers";
import { parseBorrowerType } from "./library";
import { assertIsLibrarian } from "../services/LibrarianService";
import {
  issueBook,
  returnBook,
  renewLoan,
  markLost,
  loans,
  borrowerLoans,
  isOverdue,
  type LoanFilter,
} from "../services/LibraryCirculationService";
import {
  reserveTitle,
  cancelReservation,
  reservationsForTitle,
  reservationsForBorrower,
} from "../services/LibraryReservationService";
import type { IBookLoan } from "../models/BookLoan";
import type { IBookReservation } from "../models/BookReservation";
import { BookReservation } from "../models/BookReservation";
import { BookTitle } from "../models/BookTitle";
import { BookCopy } from "../models/BookCopy";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { Guardian } from "../../foundation/models/Guardian";

// ---------------------------------------------------------------------------
// Decoration (names + title/accession labels for desk lists)
// ---------------------------------------------------------------------------

type IdLike = { toString(): string };

interface BorrowerRow {
  borrowerType: string;
  studentId?: IdLike | null;
  userId?: IdLike | null;
  guardianId?: IdLike | null;
}

function borrowerIdOf(row: BorrowerRow): string {
  const field = borrowerField(row.borrowerType as never);
  return row[field]?.toString() ?? "";
}

interface NameMaps {
  students: Map<string, string>;
  users: Map<string, string>;
  guardians: Map<string, string>;
  titles: Map<string, string>;
  accessions: Map<string, string>;
}

async function buildNameMaps(rows: BorrowerRow[], titleIds: string[], copyIds: string[]): Promise<NameMaps> {
  const studentIds = rows.filter((r) => r.borrowerType === "STUDENT").map(borrowerIdOf);
  const userIds = rows.filter((r) => r.borrowerType === "STAFF").map(borrowerIdOf);
  const guardianIds = rows.filter((r) => r.borrowerType === "GUARDIAN").map(borrowerIdOf);
  const [students, users, guardians, titles, copies] = await Promise.all([
    studentIds.length
      ? (Student.find({ _id: { $in: studentIds } }).select("name nameBn").lean() as unknown as Promise<
          Array<{ _id: IdLike; name: string; nameBn?: string }>
        >)
      : Promise.resolve([]),
    userIds.length
      ? (User.find({ _id: { $in: userIds } }).select("name").lean() as unknown as Promise<
          Array<{ _id: IdLike; name: string }>
        >)
      : Promise.resolve([]),
    guardianIds.length
      ? (Guardian.find({ _id: { $in: guardianIds } }).select("name").lean() as unknown as Promise<
          Array<{ _id: IdLike; name: string }>
        >)
      : Promise.resolve([]),
    titleIds.length
      ? (BookTitle.find({ _id: { $in: titleIds } }).select("titleBn").lean() as unknown as Promise<
          Array<{ _id: IdLike; titleBn: string }>
        >)
      : Promise.resolve([]),
    copyIds.length
      ? (BookCopy.find({ _id: { $in: copyIds } }).select("accessionNo").lean() as unknown as Promise<
          Array<{ _id: IdLike; accessionNo: string }>
        >)
      : Promise.resolve([]),
  ]);
  return {
    students: new Map(students.map((s) => [s._id.toString(), s.nameBn || s.name])),
    users: new Map(users.map((u) => [u._id.toString(), u.name])),
    guardians: new Map(guardians.map((g) => [g._id.toString(), g.name])),
    titles: new Map(titles.map((t) => [t._id.toString(), t.titleBn])),
    accessions: new Map(copies.map((c) => [c._id.toString(), c.accessionNo])),
  };
}

function borrowerNameFrom(maps: NameMaps, row: BorrowerRow): string | null {
  const id = borrowerIdOf(row);
  if (row.borrowerType === "STUDENT") return maps.students.get(id) ?? null;
  if (row.borrowerType === "STAFF") return maps.users.get(id) ?? null;
  return maps.guardians.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

type LoanShape = Pick<IBookLoan, "borrowerType" | "issuedAt" | "dueDate" | "renewCount" | "status"> & {
  _id: IdLike;
  copyId: IdLike;
  titleId: IdLike;
  studentId?: IdLike | null;
  userId?: IdLike | null;
  guardianId?: IdLike | null;
  returnedAt?: Date | null;
  lostNote?: string | null;
};

interface LoanView {
  loan: LoanShape;
  borrowerName: string | null;
  titleBn: string | null;
  accessionNo: string | null;
}

const BookLoanRef = builder.objectRef<LoanView>("BookLoan");
BookLoanRef.implement({
  description: "One loan — overdue is COMPUTED from dueDate (D-#82); no money fields (D-#27).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.loan._id.toString() }),
    copyId: t.string({ resolve: (v) => v.loan.copyId.toString() }),
    titleId: t.string({ resolve: (v) => v.loan.titleId.toString() }),
    titleBn: t.string({ nullable: true, resolve: (v) => v.titleBn }),
    accessionNo: t.string({ nullable: true, resolve: (v) => v.accessionNo }),
    borrowerType: t.string({ resolve: (v) => v.loan.borrowerType }),
    borrowerId: t.string({ resolve: (v) => borrowerIdOf(v.loan) }),
    borrowerName: t.string({ nullable: true, resolve: (v) => v.borrowerName }),
    issuedAt: t.string({ resolve: (v) => new Date(v.loan.issuedAt).toISOString() }),
    dueDate: t.string({ resolve: (v) => new Date(v.loan.dueDate).toISOString() }),
    renewCount: t.int({ resolve: (v) => v.loan.renewCount }),
    status: t.string({ resolve: (v) => v.loan.status }),
    returnedAt: t.string({
      nullable: true,
      resolve: (v) => (v.loan.returnedAt ? new Date(v.loan.returnedAt).toISOString() : null),
    }),
    lostNote: t.string({ nullable: true, resolve: (v) => v.loan.lostNote ?? null }),
    overdue: t.boolean({ resolve: (v) => isOverdue(v.loan as never) }),
  }),
});

type ReservationShape = Pick<IBookReservation, "borrowerType" | "status"> & {
  _id: IdLike;
  titleId: IdLike;
  studentId?: IdLike | null;
  userId?: IdLike | null;
  guardianId?: IdLike | null;
  createdAt: Date;
  readyAt?: Date | null;
  heldCopyId?: IdLike | null;
  expiresAt?: Date | null;
};

interface ReservationView {
  resv: ReservationShape;
  borrowerName: string | null;
  titleBn: string | null;
  heldAccessionNo: string | null;
}

const BookReservationRef = builder.objectRef<ReservationView>("BookReservation");
BookReservationRef.implement({
  description:
    "A title-level FIFO reservation (D-#83). READY holds a specific copy until expiresAt; " +
    "expiry is lazy at request time (D-#21).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.resv._id.toString() }),
    titleId: t.string({ resolve: (v) => v.resv.titleId.toString() }),
    titleBn: t.string({ nullable: true, resolve: (v) => v.titleBn }),
    borrowerType: t.string({ resolve: (v) => v.resv.borrowerType }),
    borrowerId: t.string({ resolve: (v) => borrowerIdOf(v.resv) }),
    borrowerName: t.string({ nullable: true, resolve: (v) => v.borrowerName }),
    status: t.string({ resolve: (v) => v.resv.status }),
    createdAt: t.string({ resolve: (v) => new Date(v.resv.createdAt).toISOString() }),
    readyAt: t.string({
      nullable: true,
      resolve: (v) => (v.resv.readyAt ? new Date(v.resv.readyAt).toISOString() : null),
    }),
    heldCopyId: t.string({ nullable: true, resolve: (v) => v.resv.heldCopyId?.toString() ?? null }),
    heldAccessionNo: t.string({ nullable: true, resolve: (v) => v.heldAccessionNo }),
    expiresAt: t.string({
      nullable: true,
      resolve: (v) => (v.resv.expiresAt ? new Date(v.resv.expiresAt).toISOString() : null),
    }),
  }),
});

async function decorateLoans(rows: LoanShape[]): Promise<LoanView[]> {
  const maps = await buildNameMaps(
    rows,
    rows.map((r) => r.titleId.toString()),
    rows.map((r) => r.copyId.toString()),
  );
  return rows.map((loan) => ({
    loan,
    borrowerName: borrowerNameFrom(maps, loan),
    titleBn: maps.titles.get(loan.titleId.toString()) ?? null,
    accessionNo: maps.accessions.get(loan.copyId.toString()) ?? null,
  }));
}

async function decorateReservations(rows: ReservationShape[]): Promise<ReservationView[]> {
  const maps = await buildNameMaps(
    rows,
    rows.map((r) => r.titleId.toString()),
    rows.filter((r) => r.heldCopyId).map((r) => r.heldCopyId!.toString()),
  );
  return rows.map((resv) => ({
    resv,
    borrowerName: borrowerNameFrom(maps, resv),
    titleBn: maps.titles.get(resv.titleId.toString()) ?? null,
    heldAccessionNo: resv.heldCopyId ? maps.accessions.get(resv.heldCopyId.toString()) ?? null : null,
  }));
}

// ---------------------------------------------------------------------------
// Gate helpers
// ---------------------------------------------------------------------------

function requireLibraryRead(ctx: AppContext): void {
  if (!ctx.auth || !callerHasPermission(ctx.auth, "library:read")) {
    throw new ForbiddenError();
  }
}

/** A staff caller acting on THEMSELVES (self-service path). */
function isSelfStaff(ctx: AppContext, borrower: Borrower): boolean {
  return borrower.type === "STAFF" && ctx.auth !== null && borrower.id === ctx.auth.userId;
}

function parseBorrowerArgs(borrowerType: string, borrowerId: string): Borrower {
  if (!(BORROWER_TYPES as readonly string[]).includes(borrowerType)) {
    throw new LibraryError(`পাঠকের ধরন সঠিক নয়: ${borrowerType}`);
  }
  return { type: parseBorrowerType(borrowerType), id: borrowerId };
}

// ---------------------------------------------------------------------------
// Desk mutations (assertIsLibrarian)
// ---------------------------------------------------------------------------

builder.mutationField("issueBook", (t) =>
  t.field({
    type: BookLoanRef,
    description:
      "Desk: issue a copy by accession number to a student/staff/guardian (J-L2). An ON_HOLD copy " +
      "issues only to its READY reservation's borrower. Librarian gate (J-L3). Audited BOOK_ISSUED.",
    authScopes: { authenticated: true },
    args: {
      accessionNo: t.arg.string({ required: true }),
      borrowerType: t.arg.string({ required: true }),
      borrowerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertIsLibrarian(ctx);
      const loan = await issueBook(
        args.accessionNo,
        parseBorrowerArgs(args.borrowerType, args.borrowerId),
        ctx.auth!.userId,
      );
      const [view] = await decorateLoans([loan as unknown as LoanShape]);
      return view;
    },
  }),
);

builder.mutationField("returnBook", (t) =>
  t.field({
    type: BookLoanRef,
    description:
      "Desk: return an ACTIVE loan (J-L4). With a queue the copy goes ON_HOLD for the head " +
      "reservation (J-L6). Librarian gate. Audited BOOK_RETURNED.",
    authScopes: { authenticated: true },
    args: { loanId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertIsLibrarian(ctx);
      const loan = await returnBook(args.loanId, ctx.auth!.userId);
      const [view] = await decorateLoans([loan as unknown as LoanShape]);
      return view;
    },
  }),
);

builder.mutationField("renewLoan", (t) =>
  t.field({
    type: BookLoanRef,
    description:
      "Desk: renew an ACTIVE loan (J-L5) — blocked at maxRenewals or while the title has a " +
      "QUEUED/READY reservation. Librarian gate. Audited BOOK_RENEWED.",
    authScopes: { authenticated: true },
    args: { loanId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertIsLibrarian(ctx);
      const loan = await renewLoan(args.loanId, ctx.auth!.userId);
      const [view] = await decorateLoans([loan as unknown as LoanShape]);
      return view;
    },
  }),
);

builder.mutationField("markBookLost", (t) =>
  t.field({
    type: BookLoanRef,
    description:
      "Desk: settle a loan as LOST with a replacement note — NO money is computed or recorded " +
      "(J-L7, D-#27). Librarian gate. Audited BOOK_MARKED_LOST.",
    authScopes: { authenticated: true },
    args: {
      loanId: t.arg.string({ required: true }),
      note: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertIsLibrarian(ctx);
      const loan = await markLost(args.loanId, args.note, ctx.auth!.userId);
      const [view] = await decorateLoans([loan as unknown as LoanShape]);
      return view;
    },
  }),
);

// ---------------------------------------------------------------------------
// Reservations (staff self-serve OR desk on behalf)
// ---------------------------------------------------------------------------

builder.mutationField("reserveTitle", (t) =>
  t.field({
    type: BookReservationRef,
    description:
      "Reserve a title (FIFO queue, D-#83). Staff reserve for THEMSELVES with library:read " +
      "(omit borrower args); the desk reserves on anyone's behalf (librarian gate). Audited.",
    authScopes: { authenticated: true },
    args: {
      titleId: t.arg.string({ required: true }),
      borrowerType: t.arg.string({ required: false }),
      borrowerId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      let borrower: Borrower;
      if (args.borrowerType || args.borrowerId) {
        if (!args.borrowerType || !args.borrowerId) {
          throw new LibraryError("পাঠকের ধরন ও আইডি একসাথে দিন");
        }
        borrower = parseBorrowerArgs(args.borrowerType, args.borrowerId);
        if (isSelfStaff(ctx, borrower)) {
          requireLibraryRead(ctx);
        } else {
          await assertIsLibrarian(ctx);
        }
      } else {
        // No borrower args = self-service (a staff token reserving for itself).
        requireLibraryRead(ctx);
        if (ctx.auth!.role === "GUARDIAN") throw new ForbiddenError();
        borrower = { type: "STAFF", id: ctx.auth!.userId };
      }
      const resv = await reserveTitle(args.titleId, borrower, ctx.auth!.userId);
      const [view] = await decorateReservations([resv as unknown as ReservationShape]);
      return view;
    },
  }),
);

builder.mutationField("cancelReservation", (t) =>
  t.field({
    type: BookReservationRef,
    description:
      "Cancel a QUEUED/READY reservation — staff cancel their OWN (library:read); the desk " +
      "cancels any (librarian gate). A cancelled hold promotes the next in queue.",
    authScopes: { authenticated: true },
    args: { reservationId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const existing = (await BookReservation.findById(args.reservationId).lean()) as unknown as
        | (ReservationShape & { userId?: IdLike | null })
        | null;
      if (!existing) throw new LibraryError("সংরক্ষণটি পাওয়া যায়নি");
      const ownStaffRow =
        existing.borrowerType === "STAFF" && existing.userId?.toString() === ctx.auth!.userId;
      if (ownStaffRow) {
        requireLibraryRead(ctx);
      } else {
        await assertIsLibrarian(ctx);
      }
      const resv = await cancelReservation(args.reservationId);
      const [view] = await decorateReservations([resv as unknown as ReservationShape]);
      return view;
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("loans", (t) =>
  t.field({
    type: [BookLoanRef],
    description:
      "Desk loan list (status/borrowerType/overdueOnly filters). Librarian gate — borrower " +
      "identities are not for general browsing.",
    authScopes: { hasPermission: "library:read" },
    args: {
      status: t.arg.string({ required: false }),
      borrowerType: t.arg.string({ required: false }),
      overdueOnly: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertIsLibrarian(ctx);
      const filter: LoanFilter = {
        status: args.status
          ? ((): never => {
              if (!(LOAN_STATUSES as readonly string[]).includes(args.status!)) {
                throw new LibraryError(`ঋণের অবস্থা সঠিক নয়: ${args.status}`);
              }
              return args.status as never;
            })()
          : null,
        borrowerType: args.borrowerType ? parseBorrowerType(args.borrowerType) : null,
        overdueOnly: args.overdueOnly,
      };
      return decorateLoans((await loans(filter)) as unknown as LoanShape[]);
    },
  }),
);

builder.queryField("borrowerLoans", (t) =>
  t.field({
    type: [BookLoanRef],
    description: "One borrower's loans, newest first (desk view). Librarian gate.",
    authScopes: { hasPermission: "library:read" },
    args: {
      borrowerType: t.arg.string({ required: true }),
      borrowerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertIsLibrarian(ctx);
      const rows = await borrowerLoans(parseBorrowerArgs(args.borrowerType, args.borrowerId));
      return decorateLoans(rows as unknown as LoanShape[]);
    },
  }),
);

builder.queryField("myLoans", (t) =>
  t.field({
    type: [BookLoanRef],
    description: "The calling staff member's own loans (own-row; J5-style self view).",
    authScopes: { hasPermission: "library:read" },
    resolve: async (_root, _args, ctx) => {
      const rows = await borrowerLoans({ type: "STAFF", id: ctx.auth!.userId });
      return decorateLoans(rows as unknown as LoanShape[]);
    },
  }),
);

builder.queryField("reservationsForTitle", (t) =>
  t.field({
    type: [BookReservationRef],
    description:
      "A title's active queue, FIFO, after the lazy-expiry pass (D-#83). Librarian gate.",
    authScopes: { hasPermission: "library:read" },
    args: { titleId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertIsLibrarian(ctx);
      const rows = await reservationsForTitle(args.titleId);
      return decorateReservations(rows as unknown as ReservationShape[]);
    },
  }),
);

builder.queryField("myReservations", (t) =>
  t.field({
    type: [BookReservationRef],
    description: "The calling staff member's own reservations (own-row).",
    authScopes: { hasPermission: "library:read" },
    resolve: async (_root, _args, ctx) => {
      const rows = await reservationsForBorrower({ type: "STAFF", id: ctx.auth!.userId });
      return decorateReservations(rows as unknown as ReservationShape[]);
    },
  }),
);

builder.queryField("borrowerReservations", (t) =>
  t.field({
    type: [BookReservationRef],
    description: "One borrower's reservations, newest first (desk view). Librarian gate.",
    authScopes: { hasPermission: "library:read" },
    args: {
      borrowerType: t.arg.string({ required: true }),
      borrowerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertIsLibrarian(ctx);
      const rows = await reservationsForBorrower(parseBorrowerArgs(args.borrowerType, args.borrowerId));
      return decorateReservations(rows as unknown as ReservationShape[]);
    },
  }),
);

// ---------------------------------------------------------------------------
// Desk borrower picker (LB-4)
// ---------------------------------------------------------------------------

interface BorrowerHit {
  id: string;
  name: string;
  detail: string | null;
}

const BorrowerHitRef = builder.objectRef<BorrowerHit>("LibraryBorrowerHit");
BorrowerHitRef.implement({
  description: "One desk borrower-search hit (student ID / guardian phone / staff role as detail).",
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    detail: t.string({ nullable: true, resolve: (h) => h.detail }),
  }),
});

builder.queryField("libraryBorrowerSearch", (t) =>
  t.field({
    type: [BorrowerHitRef],
    description:
      "Desk borrower search by name/ID/phone within one borrower type (LB-4 picker). " +
      "Librarian gate — exposes roster identities.",
    authScopes: { hasPermission: "library:read" },
    args: {
      borrowerType: t.arg.string({ required: true }),
      search: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertIsLibrarian(ctx);
      const type = parseBorrowerType(args.borrowerType);
      const term = args.search.trim();
      if (!term) return [];
      const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const LIMIT = 20;
      if (type === "STUDENT") {
        const rows = (await Student.find({
          active: true,
          $or: [{ name: rx }, { nameBn: rx }, { schoolId: rx }],
        })
          .select("name nameBn schoolId")
          .limit(LIMIT)
          .lean()) as unknown as Array<{ _id: IdLike; name: string; nameBn?: string; schoolId: string }>;
        return rows.map((s) => ({ id: s._id.toString(), name: s.nameBn || s.name, detail: s.schoolId }));
      }
      if (type === "STAFF") {
        const rows = (await User.find({ active: true, name: rx })
          .select("name role")
          .limit(LIMIT)
          .lean()) as unknown as Array<{ _id: IdLike; name: string; role: string }>;
        return rows.map((u) => ({ id: u._id.toString(), name: u.name, detail: u.role }));
      }
      const rows = (await Guardian.find({ active: true, $or: [{ name: rx }, { phone: rx }] })
        .select("name phone")
        .limit(LIMIT)
        .lean()) as unknown as Array<{ _id: IdLike; name: string; phone?: string }>;
      return rows.map((g) => ({ id: g._id.toString(), name: g.name, detail: g.phone ?? null }));
    },
  }),
);
