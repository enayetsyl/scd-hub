/**
 * Overdue chase-list resolver (LB-5, D-#84) — librarians' report with ADR-003
 * wa.me click-to-send rows (J-L8). Works with ZERO notification infrastructure;
 * the LIBRARY_DUE_SOON / LIBRARY_OVERDUE inbox reminders ride the emit() seam
 * separately (LibraryReminderService). NO fines (D-#27).
 */
import { builder } from "../../../schema";
import { assertIsLibrarian } from "../services/LibrarianService";
import { libraryChaseList, type ChaseRow } from "../services/LibraryChaseService";

const ChaseRowRef = builder.objectRef<ChaseRow>("LibraryChaseRow");
ChaseRowRef.implement({
  description:
    "One overdue loan on the chase list — borrower phone + manual wa.me reminder link " +
    "(ADR-003); staff rows are chased in-app, no link.",
  fields: (t) => ({
    loanId: t.exposeString("loanId"),
    borrowerType: t.exposeString("borrowerType"),
    borrowerId: t.exposeString("borrowerId"),
    borrowerName: t.string({ nullable: true, resolve: (r) => r.borrowerName }),
    phone: t.string({ nullable: true, resolve: (r) => r.phone }),
    titleBn: t.string({ nullable: true, resolve: (r) => r.titleBn }),
    accessionNo: t.string({ nullable: true, resolve: (r) => r.accessionNo }),
    dueDate: t.string({ resolve: (r) => r.dueDate.toISOString() }),
    daysOverdue: t.exposeInt("daysOverdue"),
    waLink: t.string({ nullable: true, resolve: (r) => r.waLink }),
  }),
});

builder.queryField("libraryChaseList", (t) =>
  t.field({
    type: [ChaseRowRef],
    description:
      "Overdue ACTIVE loans grouped by borrower type with wa.me reminder links (LB-5, J-L8). " +
      "Librarian gate.",
    authScopes: { hasPermission: "library:read" },
    resolve: async (_root, _args, ctx) => {
      await assertIsLibrarian(ctx);
      return libraryChaseList();
    },
  }),
);
