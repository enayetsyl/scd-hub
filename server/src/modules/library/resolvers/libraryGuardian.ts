/**
 * Guardian-portal rider (LB-5, D-#84 / GP-2 rider, D-#68) — ONE read query:
 * a linked guardian sees their child's library loans (current + history),
 * read-only. Link-scoped by `assertGuardianOfStudent`; guardians get NO
 * library mutations (reserve/renew stay desk-only for them). The type is a
 * deliberately NARROW guardian-facing shape (the D-#69 pattern): title +
 * accession + dates + status — no librarian/desk fields.
 */
import { builder } from "../../../schema";
import { assertGuardianOfStudent } from "../../../middleware/authz";
import { borrowerLoans, isOverdue } from "../services/LibraryCirculationService";
import { BookTitle } from "../models/BookTitle";
import { BookCopy } from "../models/BookCopy";
import type { IBookLoan } from "../models/BookLoan";

type IdLike = { toString(): string };

type LoanLean = Pick<IBookLoan, "status" | "issuedAt" | "dueDate"> & {
  _id: IdLike;
  titleId: IdLike;
  copyId: IdLike;
  returnedAt?: Date | null;
};

interface ChildLoanView {
  loan: LoanLean;
  titleBn: string | null;
  accessionNo: string | null;
}

const ChildLibraryLoanRef = builder.objectRef<ChildLoanView>("ChildLibraryLoan");
ChildLibraryLoanRef.implement({
  description: "A child's loan as the guardian portal shows it — read-only, narrow (D-#69 pattern).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.loan._id.toString() }),
    titleBn: t.string({ nullable: true, resolve: (v) => v.titleBn }),
    accessionNo: t.string({ nullable: true, resolve: (v) => v.accessionNo }),
    issuedAt: t.string({ resolve: (v) => new Date(v.loan.issuedAt).toISOString() }),
    dueDate: t.string({ resolve: (v) => new Date(v.loan.dueDate).toISOString() }),
    status: t.string({ resolve: (v) => v.loan.status }),
    returnedAt: t.string({
      nullable: true,
      resolve: (v) => (v.loan.returnedAt ? new Date(v.loan.returnedAt).toISOString() : null),
    }),
    overdue: t.boolean({ resolve: (v) => isOverdue(v.loan as never) }),
  }),
});

builder.queryField("childLibraryLoans", (t) =>
  t.field({
    type: [ChildLibraryLoanRef],
    description:
      "The linked child's library loans — current + history, read-only (LB-5 / GP-2 rider, " +
      "J-L9). Gated by the guardian-link row scope (D-#68); no mutations exist for guardians.",
    authScopes: { authenticated: true },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      const rows = (await borrowerLoans({ type: "STUDENT", id: args.studentId })) as unknown as LoanLean[];
      if (rows.length === 0) return [];
      const [titles, copies] = await Promise.all([
        BookTitle.find({ _id: { $in: rows.map((l) => l.titleId.toString()) } })
          .select("titleBn")
          .lean() as unknown as Promise<Array<{ _id: IdLike; titleBn: string }>>,
        BookCopy.find({ _id: { $in: rows.map((l) => l.copyId.toString()) } })
          .select("accessionNo")
          .lean() as unknown as Promise<Array<{ _id: IdLike; accessionNo: string }>>,
      ]);
      const titleMap = new Map(titles.map((x) => [x._id.toString(), x.titleBn]));
      const copyMap = new Map(copies.map((x) => [x._id.toString(), x.accessionNo]));
      return rows.map((loan) => ({
        loan,
        titleBn: titleMap.get(loan.titleId.toString()) ?? null,
        accessionNo: copyMap.get(loan.copyId.toString()) ?? null,
      }));
    },
  }),
);
