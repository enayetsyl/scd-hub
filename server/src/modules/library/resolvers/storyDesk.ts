/**
 * Storybook desk resolvers (SB-2, D-#982/#983/#985, docs/prd-storybook-reading.md).
 *
 *  - Desk reads (code lookup, child search, today's children): `library:lend` + the
 *    librarian gate, like every desk screen (they expose roster identities).
 *  - Copies: `library:edit` (catalogue). Holiday rules: `library:settings` to change,
 *    `library:view` to read. Issue / return are the existing `issueBook` / `returnBook`.
 * The sticker PDF is REST: GET /files/storybook-stickers (routes/files.ts).
 */
import { builder } from "../../../schema";
import { assertIsLibrarian } from "../services/LibrarianService";
import type { ILibraryHolidayRule } from "../models/LibraryHolidayRule";
import {
  addStoryCopies,
  deskStudentsToday,
  findDeskStudents,
  libraryHolidayRules,
  lookupStoryCopy,
  saveLibraryHolidayRule,
  type CopyLookup,
  type DeskStudent,
} from "../services/StoryDeskService";

const DeskStudentRef = builder.objectRef<DeskStudent>("StoryDeskStudent");
DeskStudentRef.implement({
  description: "A child at the storybook desk: who they are and how many books they hold against their limit.",
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    schoolId: t.exposeString("schoolId"),
    rollNumber: t.string({ nullable: true, resolve: (s) => s.rollNumber }),
    classLabelBn: t.exposeString("classLabelBn"),
    sectionNameBn: t.string({ nullable: true, resolve: (s) => s.sectionNameBn }),
    activeLoans: t.exposeInt("activeLoans"),
    maxLoans: t.exposeInt("maxLoans"),
    overdue: t.exposeBoolean("overdue"),
  }),
});

const CopyLookupRef = builder.objectRef<CopyLookup>("StoryCopyLookup");
CopyLookupRef.implement({
  description: "A copy found by its code at the desk: the book, who has it now, who it is held for.",
  fields: (t) => ({
    copyId: t.string({ resolve: (v) => v.copy._id.toString() }),
    code: t.string({ resolve: (v) => v.copy.accessionNo }),
    status: t.string({ resolve: (v) => v.copy.status }),
    titleId: t.string({ resolve: (v) => v.title._id.toString() }),
    titleBn: t.string({ resolve: (v) => v.title.titleBn }),
    titleEn: t.string({ nullable: true, resolve: (v) => v.title.titleEn ?? null }),
    seriesNo: t.int({ nullable: true, resolve: (v) => v.title.seriesNo ?? null }),
    coverFileId: t.string({ nullable: true, resolve: (v) => v.title.coverFileId?.toString() ?? null }),
    seriesNameBn: t.string({ nullable: true, resolve: (v) => v.series?.nameBn ?? null }),
    loanId: t.string({ nullable: true, resolve: (v) => v.loan?._id.toString() ?? null }),
    issuedAt: t.string({ nullable: true, resolve: (v) => (v.loan ? new Date(v.loan.issuedAt).toISOString() : null) }),
    dueDate: t.string({ nullable: true, resolve: (v) => (v.loan ? new Date(v.loan.dueDate).toISOString() : null) }),
    borrower: t.field({ type: DeskStudentRef, nullable: true, resolve: (v) => v.borrower }),
    heldFor: t.field({ type: DeskStudentRef, nullable: true, resolve: (v) => v.heldFor }),
    waitingCount: t.exposeInt("waitingCount"),
  }),
});

const HolidayRuleRef = builder.objectRef<ILibraryHolidayRule>("LibraryHolidayRule");
HolidayRuleRef.implement({
  description: "A dated holiday rule for student loans (D-#982): higher limit + one due day.",
  fields: (t) => ({
    id: t.string({ resolve: (r) => r._id.toString() }),
    nameBn: t.exposeString("nameBn"),
    fromDay: t.exposeString("fromDay"),
    toDay: t.exposeString("toDay"),
    dueDay: t.exposeString("dueDay"),
    maxConcurrent: t.exposeInt("maxConcurrent"),
    active: t.exposeBoolean("active"),
  }),
});

builder.queryField("storyCopyByCode", (t) =>
  t.field({
    type: CopyLookupRef,
    description: "Desk: find a copy by its code (typed or scanned; TRE-7-1 = TRE-07-1).",
    authScopes: { hasPermission: "library:lend" },
    args: { code: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertIsLibrarian(ctx, "library:lend");
      return lookupStoryCopy(args.code);
    },
  }),
);

builder.queryField("storyDeskStudents", (t) =>
  t.field({
    type: [DeskStudentRef],
    description: "Desk: children by school ID (numeric — 103 = 0103), name or roll, with their loans against the limit.",
    authScopes: { hasPermission: "library:lend" },
    args: { search: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertIsLibrarian(ctx, "library:lend");
      return findDeskStudents(args.search);
    },
  }),
);

builder.queryField("storyDeskToday", (t) =>
  t.field({
    type: [DeskStudentRef],
    description: "Desk: children who borrowed or returned today, newest first — the daily swappers.",
    authScopes: { hasPermission: "library:lend" },
    resolve: async (_root, _args, ctx) => {
      await assertIsLibrarian(ctx, "library:lend");
      return deskStudentsToday();
    },
  }),
);

builder.mutationField("addStoryCopies", (t) =>
  t.stringList({
    description: "Give every book of a series (or the listed numbers) N copies with codes SERIES-BOOK-COPY. Returns the new codes.",
    authScopes: { hasPermission: "library:edit" },
    args: {
      seriesId: t.arg.string({ required: true }),
      copiesEach: t.arg.int({ required: true }),
      seriesNos: t.arg.intList({ required: false }),
    },
    resolve: async (_root, args, ctx) => addStoryCopies(args.seriesId, args.copiesEach, args.seriesNos, ctx.auth!.userId),
  }),
);

builder.queryField("libraryHolidayRules", (t) =>
  t.field({
    type: [HolidayRuleRef],
    description: "Holiday rules for student loans (newest first).",
    authScopes: { hasPermission: "library:view" },
    args: { includeInactive: t.arg.boolean({ required: false }) },
    resolve: async (_root, args) => libraryHolidayRules(args.includeInactive ?? false),
  }),
);

builder.mutationField("saveLibraryHolidayRule", (t) =>
  t.field({
    type: HolidayRuleRef,
    description: "Create (no ruleId) or change a holiday rule; active: false retires it. Audited.",
    authScopes: { hasPermission: "library:settings" },
    args: {
      ruleId: t.arg.string({ required: false }),
      nameBn: t.arg.string({ required: true }),
      fromDay: t.arg.string({ required: true }),
      toDay: t.arg.string({ required: true }),
      dueDay: t.arg.string({ required: true }),
      maxConcurrent: t.arg.int({ required: true }),
      active: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => saveLibraryHolidayRule(args, ctx.auth!.userId),
  }),
);
