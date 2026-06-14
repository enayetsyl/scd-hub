/**
 * Library catalog + policy + librarian-gate resolvers (LB-1, D-#81/#82).
 *
 * RBAC (prd-library §4):
 *   library:read (Principal/Teacher/Office) — browse catalog, policies, history.
 *   library:manage (Principal/Office) — catalog + policy + librarian assignment.
 *   Desk OPERATIONS (LB-2/LB-3) gate on `assertIsLibrarian` instead — a TEACHER
 *   passes via an active LibrarianAssignment; the role grant is never widened.
 *
 * All identity-plane; NO corpus path (ADR-005 — a reading record is identity).
 */
import { builder } from "../../../schema";
import {
  BOOK_LANGUAGES,
  BORROWER_TYPES,
  COPY_STATUSES,
  type BookLanguage,
  type BorrowerType,
  type CopyStatus,
} from "@scd/shared";
import { LibraryError } from "../errors";
import type { IBookTitle } from "../models/BookTitle";
import type { IBookCopy } from "../models/BookCopy";
import type { ILibrarianAssignment } from "../models/LibrarianAssignment";
import { User } from "../../foundation/models/User";
import {
  createBookTitle,
  updateBookTitle,
  addBookCopy,
  setCopyStatus,
  bookTitles,
  bookTitleDetail,
} from "../services/LibraryCatalogService";
import {
  getEffectivePolicy,
  effectivePolicies,
  upsertLibraryPolicy,
  type EffectivePolicy,
} from "../services/LibraryPolicyService";
import {
  assertIsLibrarian,
  isAssignedLibrarian,
  assignLibrarian,
  revokeLibrarian,
  librarianHistory,
  currentLibrarianIds,
} from "../services/LibrarianService";
import { callerHasPermission } from "@scd/shared";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

type TitleShape = Pick<IBookTitle, "titleBn" | "titleEn" | "author" | "language" | "category" | "isbn" | "shelf" | "active"> & {
  _id: { toString(): string };
};
type CopyShape = Pick<IBookCopy, "accessionNo" | "status" | "conditionNote"> & {
  _id: { toString(): string };
  titleId: { toString(): string };
};

const BookCopyRef = builder.objectRef<CopyShape>("BookCopy");
BookCopyRef.implement({
  description: "One physical copy — unique accession number + status (D-#82).",
  fields: (t) => ({
    id: t.string({ resolve: (c) => c._id.toString() }),
    titleId: t.string({ resolve: (c) => c.titleId.toString() }),
    accessionNo: t.exposeString("accessionNo"),
    status: t.exposeString("status"),
    conditionNote: t.string({ nullable: true, resolve: (c) => c.conditionNote ?? null }),
  }),
});

interface TitleListItem {
  title: TitleShape;
  totalCopies: number;
  availableCopies: number;
}

const BookTitleRef = builder.objectRef<TitleListItem>("BookTitle");
BookTitleRef.implement({
  description: "A catalog title with computed availability (browse row).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.title._id.toString() }),
    titleBn: t.string({ resolve: (v) => v.title.titleBn }),
    titleEn: t.string({ nullable: true, resolve: (v) => v.title.titleEn ?? null }),
    author: t.string({ nullable: true, resolve: (v) => v.title.author ?? null }),
    language: t.string({ resolve: (v) => v.title.language }),
    category: t.string({ nullable: true, resolve: (v) => v.title.category ?? null }),
    isbn: t.string({ nullable: true, resolve: (v) => v.title.isbn ?? null }),
    shelf: t.string({ nullable: true, resolve: (v) => v.title.shelf ?? null }),
    active: t.boolean({ resolve: (v) => v.title.active }),
    totalCopies: t.exposeInt("totalCopies"),
    availableCopies: t.exposeInt("availableCopies"),
  }),
});

interface TitleDetail extends TitleListItem {
  copies: CopyShape[];
}

const BookTitleDetailRef = builder.objectRef<TitleDetail>("BookTitleDetail");
BookTitleDetailRef.implement({
  description: "A catalog title with its copies (TitleDetail view).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.title._id.toString() }),
    titleBn: t.string({ resolve: (v) => v.title.titleBn }),
    titleEn: t.string({ nullable: true, resolve: (v) => v.title.titleEn ?? null }),
    author: t.string({ nullable: true, resolve: (v) => v.title.author ?? null }),
    language: t.string({ resolve: (v) => v.title.language }),
    category: t.string({ nullable: true, resolve: (v) => v.title.category ?? null }),
    isbn: t.string({ nullable: true, resolve: (v) => v.title.isbn ?? null }),
    shelf: t.string({ nullable: true, resolve: (v) => v.title.shelf ?? null }),
    active: t.boolean({ resolve: (v) => v.title.active }),
    totalCopies: t.exposeInt("totalCopies"),
    availableCopies: t.exposeInt("availableCopies"),
    copies: t.field({ type: [BookCopyRef], resolve: (v) => v.copies }),
  }),
});

const LibraryPolicyRef = builder.objectRef<EffectivePolicy>("LibraryPolicy");
LibraryPolicyRef.implement({
  description:
    "The loan policy in force for a borrower type — admin DATA (D-#82); isDefault marks the PRD " +
    "working values applying because no admin row exists yet.",
  fields: (t) => ({
    borrowerType: t.exposeString("borrowerType"),
    loanDays: t.exposeInt("loanDays"),
    maxConcurrent: t.exposeInt("maxConcurrent"),
    maxRenewals: t.exposeInt("maxRenewals"),
    holdDays: t.exposeInt("holdDays"),
    isDefault: t.exposeBoolean("isDefault"),
  }),
});

type AssignmentShape = Pick<ILibrarianAssignment, "action" | "at"> & {
  _id: { toString(): string };
  userId: { toString(): string };
  actorId: { toString(): string };
};

interface AssignmentView {
  row: AssignmentShape;
  userName: string | null;
}

const LibrarianAssignmentRef = builder.objectRef<AssignmentView>("LibrarianAssignment");
LibrarianAssignmentRef.implement({
  description: "One append-only librarian-duty log row (assign/revoke, D-#81; ADR-008).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.row._id.toString() }),
    userId: t.string({ resolve: (v) => v.row.userId.toString() }),
    userName: t.string({ nullable: true, resolve: (v) => v.userName }),
    action: t.string({ resolve: (v) => v.row.action }),
    actorId: t.string({ resolve: (v) => v.row.actorId.toString() }),
    at: t.string({ resolve: (v) => new Date(v.row.at).toISOString() }),
  }),
});

function parseEnum<T extends string>(value: string, allowed: readonly T[], labelBn: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new LibraryError(`${labelBn} সঠিক নয়: ${value}`);
  }
  return value as T;
}

export const parseBorrowerType = (v: string): BorrowerType =>
  parseEnum(v, BORROWER_TYPES, "পাঠকের ধরন");

async function decorateAssignments(rows: AssignmentShape[]): Promise<AssignmentView[]> {
  const ids = [...new Set(rows.map((r) => r.userId.toString()))];
  const users = (await User.find({ _id: { $in: ids } }).select("name").lean()) as unknown as Array<{
    _id: { toString(): string };
    name: string;
  }>;
  const names = new Map(users.map((u) => [u._id.toString(), u.name]));
  return rows.map((row) => ({ row, userName: names.get(row.userId.toString()) ?? null }));
}

// ---------------------------------------------------------------------------
// Queries — library:read
// ---------------------------------------------------------------------------

builder.queryField("bookTitles", (t) =>
  t.field({
    type: [BookTitleRef],
    description: "Browse/search the catalog (text/language/category) with computed availability.",
    authScopes: { hasPermission: "library:read" },
    args: {
      search: t.arg.string({ required: false }),
      language: t.arg.string({ required: false }),
      category: t.arg.string({ required: false }),
      includeInactive: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args) =>
      bookTitles({
        search: args.search,
        language: args.language ? parseEnum(args.language, BOOK_LANGUAGES, "ভাষা") : null,
        category: args.category,
        includeInactive: args.includeInactive,
      }) as unknown as Promise<TitleListItem[]>,
  }),
);

builder.queryField("bookTitle", (t) =>
  t.field({
    type: BookTitleDetailRef,
    nullable: true,
    description: "One title with its copies + availability. WITHDRAWN copies stay listed (history).",
    authScopes: { hasPermission: "library:read" },
    args: { titleId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => {
      const detail = await bookTitleDetail(args.titleId);
      if (!detail) return null;
      return {
        title: detail.title as unknown as TitleShape,
        copies: detail.copies as unknown as CopyShape[],
        totalCopies: detail.copies.length,
        availableCopies: detail.availableCopies,
      };
    },
  }),
);

builder.queryField("libraryPolicies", (t) =>
  t.field({
    type: [LibraryPolicyRef],
    description: "Effective loan policy per borrower type (admin row else PRD working values).",
    authScopes: { hasPermission: "library:read" },
    resolve: async () => effectivePolicies(),
  }),
);

builder.queryField("librarianHistory", (t) =>
  t.field({
    type: [LibrarianAssignmentRef],
    description: "The append-only librarian-duty log, newest first (D-#81; ADR-008).",
    authScopes: { hasPermission: "library:read" },
    resolve: async () =>
      decorateAssignments((await librarianHistory()) as unknown as AssignmentShape[]),
  }),
);

builder.queryField("currentLibrarians", (t) =>
  t.field({
    type: [LibrarianAssignmentRef],
    description: "Teachers whose latest duty row is `assign` (the active desk roster).",
    authScopes: { hasPermission: "library:read" },
    resolve: async () => {
      const ids = await currentLibrarianIds();
      const rows = ((await librarianHistory()) as unknown as AssignmentShape[]).filter(
        (r) => ids.includes(r.userId.toString()) && r.action === "assign",
      );
      // keep only each user's latest assign row
      const seen = new Set<string>();
      const latest: AssignmentShape[] = [];
      for (const r of rows) {
        const uid = r.userId.toString();
        if (seen.has(uid)) continue;
        seen.add(uid);
        latest.push(r);
      }
      return decorateAssignments(latest);
    },
  }),
);

builder.queryField("amILibrarian", (t) =>
  t.boolean({
    description:
      "Does the caller pass the desk gate (library:manage OR an active LibrarianAssignment)? " +
      "Drives the desk/manage entries on LibraryHome (LB-4).",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) return false;
      if (callerHasPermission(ctx.auth, "library:manage")) return true;
      return ctx.auth.role === "TEACHER" && (await isAssignedLibrarian(ctx.auth.userId));
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations — library:manage (catalog / policy / duty assignment)
// ---------------------------------------------------------------------------

builder.mutationField("createBookTitle", (t) =>
  t.field({
    type: BookTitleRef,
    description: "Add a catalog title (copies are added per accession number). Audited.",
    authScopes: { hasPermission: "library:manage" },
    args: {
      titleBn: t.arg.string({ required: true }),
      titleEn: t.arg.string({ required: false }),
      author: t.arg.string({ required: false }),
      language: t.arg.string({ required: true }),
      category: t.arg.string({ required: false }),
      isbn: t.arg.string({ required: false }),
      shelf: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const title = await createBookTitle(
        {
          titleBn: args.titleBn,
          titleEn: args.titleEn,
          author: args.author,
          language: parseEnum(args.language, BOOK_LANGUAGES, "ভাষা"),
          category: args.category,
          isbn: args.isbn,
          shelf: args.shelf,
        },
        ctx.auth!.userId,
      );
      return { title: title as unknown as TitleShape, totalCopies: 0, availableCopies: 0 };
    },
  }),
);

builder.mutationField("updateBookTitle", (t) =>
  t.field({
    type: BookTitleRef,
    description: "Patch a title's bibliographic fields / active flag. Audited.",
    authScopes: { hasPermission: "library:manage" },
    args: {
      titleId: t.arg.string({ required: true }),
      titleBn: t.arg.string({ required: false }),
      titleEn: t.arg.string({ required: false }),
      author: t.arg.string({ required: false }),
      language: t.arg.string({ required: false }),
      category: t.arg.string({ required: false }),
      isbn: t.arg.string({ required: false }),
      shelf: t.arg.string({ required: false }),
      active: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const title = await updateBookTitle(
        args.titleId,
        {
          titleBn: args.titleBn ?? undefined,
          titleEn: args.titleEn ?? undefined,
          author: args.author ?? undefined,
          language: args.language ? parseEnum(args.language, BOOK_LANGUAGES, "ভাষা") : undefined,
          category: args.category ?? undefined,
          isbn: args.isbn ?? undefined,
          shelf: args.shelf ?? undefined,
          active: args.active,
        },
        ctx.auth!.userId,
      );
      const detail = await bookTitleDetail(args.titleId);
      return {
        title: title as unknown as TitleShape,
        totalCopies: detail?.copies.length ?? 0,
        availableCopies: detail?.availableCopies ?? 0,
      };
    },
  }),
);

builder.mutationField("addBookCopy", (t) =>
  t.field({
    type: BookCopyRef,
    description: "Add a physical copy with a unique accession number (duplicate rejected, J-L1). Audited.",
    authScopes: { hasPermission: "library:manage" },
    args: {
      titleId: t.arg.string({ required: true }),
      accessionNo: t.arg.string({ required: true }),
      conditionNote: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      addBookCopy(args.titleId, args.accessionNo, args.conditionNote, ctx.auth!.userId) as unknown as Promise<CopyShape>,
  }),
);

builder.mutationField("setCopyStatus", (t) =>
  t.field({
    type: BookCopyRef,
    description:
      "Catalog-side copy status (AVAILABLE/LOST/DAMAGED/WITHDRAWN). ON_LOAN/ON_HOLD are " +
      "desk-managed and refused here. WITHDRAWN removes from circulation, never deletes. Audited.",
    authScopes: { hasPermission: "library:manage" },
    args: {
      copyId: t.arg.string({ required: true }),
      status: t.arg.string({ required: true }),
      conditionNote: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      setCopyStatus(
        args.copyId,
        parseEnum(args.status, COPY_STATUSES, "কপির অবস্থা") as CopyStatus,
        args.conditionNote,
        ctx.auth!.userId,
      ) as unknown as Promise<CopyShape>,
  }),
);

builder.mutationField("upsertLibraryPolicy", (t) =>
  t.field({
    type: LibraryPolicyRef,
    description: "Create/replace the loan policy row for a borrower type (admin data, D-#82). Audited.",
    authScopes: { hasPermission: "library:manage" },
    args: {
      borrowerType: t.arg.string({ required: true }),
      loanDays: t.arg.int({ required: true }),
      maxConcurrent: t.arg.int({ required: true }),
      maxRenewals: t.arg.int({ required: true }),
      holdDays: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) =>
      upsertLibraryPolicy(
        parseBorrowerType(args.borrowerType),
        {
          loanDays: args.loanDays,
          maxConcurrent: args.maxConcurrent,
          maxRenewals: args.maxRenewals,
          holdDays: args.holdDays,
        },
        ctx.auth!.userId,
      ),
  }),
);

builder.mutationField("assignLibrarian", (t) =>
  t.field({
    type: LibrarianAssignmentRef,
    description:
      "Give a TEACHER the librarian desk duty (append-only log, D-#81 — no new role). " +
      "Audited as LIBRARIAN_ASSIGNED.",
    authScopes: { hasPermission: "library:manage" },
    args: { teacherUserId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const row = await assignLibrarian(args.teacherUserId, ctx.auth!.userId);
      const [view] = await decorateAssignments([row as unknown as AssignmentShape]);
      return view;
    },
  }),
);

builder.mutationField("revokeLibrarian", (t) =>
  t.field({
    type: LibrarianAssignmentRef,
    description: "Revoke the desk duty (appends a revoke row — history preserved). Audited.",
    authScopes: { hasPermission: "library:manage" },
    args: { teacherUserId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const row = await revokeLibrarian(args.teacherUserId, ctx.auth!.userId);
      const [view] = await decorateAssignments([row as unknown as AssignmentShape]);
      return view;
    },
  }),
);

// assertIsLibrarian is re-exported for the circulation/reservation resolvers (LB-2/LB-3).
export { assertIsLibrarian };
