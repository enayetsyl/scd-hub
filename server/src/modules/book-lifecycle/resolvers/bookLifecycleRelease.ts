/**
 * Book-lifecycle GraphQL, BL-2 (docs/prd-book-lifecycle.md §8 S6/S8/S9, §9.4, §11): print releases,
 * errata, the teacher surfaces (আমার বই, ভুল জানান). Every field names its `book_lifecycle:*` action;
 * the services re-check it (and the reader scope for teacher fields).
 */
import { Types } from "mongoose";
import type { BookEdition, BookFeedbackCategory } from "@scd/shared";
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { pageRef } from "../../../pageRef";
import { queryPage } from "../../../lib/paging";
import { BookPrintRelease, BookErratum, type IBookErratum, type IBookPrintRelease } from "../models/BookRelease";
import { BookVersion } from "../models/BookVersion";
import { assertBookPlane, canBookLc, requireBookLc } from "../services/access";
import { namesOf } from "../services/names";
import { bookTeachersNow } from "../services/teacherScope";
import { loadBook, vlabel } from "../services/store";
import * as RS from "../services/releaseService";
import * as ES from "../services/errataService";
import * as TS from "../services/teacherService";

const auth = (ctx: AppContext) => {
  assertBookPlane();
  return ctx.auth!;
};
const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : null);

interface ReleaseShape {
  r: IBookPrintRelease;
  versionLabel: string;
}
interface ReleaseFileRow {
  edition: string;
  kind: string;
  fileId: string;
}
const ReleaseFileRef = builder.objectRef<ReleaseFileRow>("BookLcReleaseFile").implement({
  fields: (t) => ({ edition: t.exposeString("edition"), kind: t.exposeString("kind"), fileId: t.exposeString("fileId") }),
});
const ReleaseRef = builder.objectRef<ReleaseShape>("BookLcRelease").implement({
  description: "A print release (§5.10).",
  fields: (t) => ({
    id: t.string({ resolve: (s) => s.r._id.toString() }),
    bookId: t.string({ resolve: (s) => s.r.bookId.toString() }),
    releaseNo: t.int({ resolve: (s) => s.r.releaseNo }),
    labelBn: t.string({ resolve: (s) => s.r.labelBn }),
    status: t.string({ resolve: (s) => s.r.status }),
    versionId: t.string({ resolve: (s) => s.r.versionId.toString() }),
    versionLabel: t.string({ resolve: (s) => s.versionLabel }),
    recordedAt: t.string({ nullable: true, resolve: (s) => iso(s.r.recordedAt) }),
    pressNameBn: t.string({ nullable: true, resolve: (s) => s.r.pressNameBn ?? null }),
    sentToPressAt: t.string({ nullable: true, resolve: (s) => iso(s.r.sentToPressAt) }),
    printedAt: t.string({ nullable: true, resolve: (s) => iso(s.r.printedAt) }),
    copies: t.int({ nullable: true, resolve: (s) => s.r.copies ?? null }),
    distributedAt: t.string({ nullable: true, resolve: (s) => iso(s.r.distributedAt) }),
    classBookId: t.string({ nullable: true, resolve: (s) => s.r.classBookId ?? null }),
    files: t.field({ type: [ReleaseFileRef], resolve: (s) => s.r.files.map((f) => ({ edition: f.edition, kind: f.kind, fileId: f.storedFileId.toString() })) }),
  }),
});
async function releaseShape(r: IBookPrintRelease): Promise<ReleaseShape> {
  const v = await BookVersion.findById(r.versionId).select("major minor").lean();
  return { r, versionLabel: v ? vlabel(v) : "?" };
}
const ReleasePage = pageRef("BookLcReleasePage", ReleaseRef);

interface ErratumShape {
  e: IBookErratum;
  readers: number;
  ackNames: string[];
  mine: boolean;
}
const ErratumRef = builder.objectRef<ErratumShape>("BookLcErratum").implement({
  description: "ভুল-সংশোধনী (§5.11). `ackNames` only to view holders; `acked` = the caller ticked ঠিক করেছি.",
  fields: (t) => ({
    id: t.string({ resolve: (s) => s.e._id.toString() }),
    code: t.string({ resolve: (s) => s.e.code }),
    status: t.string({ resolve: (s) => s.e.status }),
    releaseId: t.string({ resolve: (s) => s.e.releaseId.toString() }),
    editions: t.stringList({ resolve: (s) => s.e.editions }),
    page: t.string({ nullable: true, resolve: (s) => s.e.page ?? null }),
    whereBn: t.string({ resolve: (s) => s.e.whereBn }),
    wrongText: t.string({ resolve: (s) => s.e.wrongText }),
    correctText: t.string({ resolve: (s) => s.e.correctText }),
    instructionBn: t.string({ resolve: (s) => s.e.instructionBn }),
    announcedAt: t.string({ nullable: true, resolve: (s) => iso(s.e.announcedAt) }),
    carried: t.boolean({ resolve: (s) => !!s.e.carriedIntoVersionId }),
    ackCount: t.int({ resolve: (s) => s.e.acks.length }),
    readerCount: t.int({ resolve: (s) => s.readers }),
    ackNames: t.stringList({ resolve: (s) => s.ackNames }),
    acked: t.boolean({ resolve: (s) => s.mine }),
  }),
});
async function erratumShapes(rows: IBookErratum[], ctx: AppContext): Promise<ErratumShape[]> {
  const viewer = canBookLc(ctx.auth, "view");
  const names = viewer ? await namesOf(rows.flatMap((r) => r.acks.map((a) => a.userId))) : new Map<string, string>();
  const readerCounts = new Map<string, number>();
  for (const r of rows) {
    const k = r.bookId.toString();
    if (!readerCounts.has(k)) {
      const book = await loadBook(r.bookId);
      readerCounts.set(k, viewer ? (await bookTeachersNow(book)).size : 0);
    }
  }
  return rows.map((e) => ({
    e,
    readers: readerCounts.get(e.bookId.toString()) ?? 0,
    ackNames: viewer ? e.acks.map((a) => names.get(a.userId.toString()) ?? "?") : [],
    mine: e.acks.some((a) => a.userId.toString() === ctx.auth?.userId),
  }));
}
const ErratumPage = pageRef("BookLcErratumPage", ErratumRef);

interface MyBookShape {
  row: TS.MyBookRow;
  errata: ErratumShape[];
}
const MyBookRef = builder.objectRef<MyBookShape>("BookLcMyBook").implement({
  description: "আমার বই: a book of my class + subject with its current release (§8 S8).",
  fields: (t) => ({
    bookId: t.string({ resolve: (s) => s.row.book._id.toString() }),
    code: t.string({ resolve: (s) => s.row.book.code }),
    titleBn: t.string({ resolve: (s) => s.row.book.titleBn }),
    classLevel: t.int({ resolve: (s) => s.row.book.classLevel }),
    subject: t.string({ resolve: (s) => s.row.book.subject }),
    releaseLabelBn: t.string({ resolve: (s) => s.row.release.labelBn }),
    versionLabel: t.string({ resolve: (s) => s.row.versionLabel }),
    teacherFileIds: t.stringList({ resolve: (s) => s.row.teacherFileIds }),
    errata: t.field({ type: [ErratumRef], resolve: (s) => s.errata }),
  }),
});

interface MyReportShape {
  code: string;
  bookId: string;
  status: string;
  category: string;
  textBn: string;
  page: string | null;
  rejectReasonBn: string | null;
  appliedInVersionId: string | null;
  createdAt: string;
}
const MyReportRef = builder.objectRef<MyReportShape>("BookLcMyReport").implement({
  fields: (t) => ({
    code: t.exposeString("code"),
    bookId: t.exposeString("bookId"),
    status: t.exposeString("status"),
    category: t.exposeString("category"),
    textBn: t.exposeString("textBn"),
    page: t.exposeString("page", { nullable: true }),
    rejectReasonBn: t.exposeString("rejectReasonBn", { nullable: true }),
    appliedInVersionId: t.exposeString("appliedInVersionId", { nullable: true }),
    createdAt: t.exposeString("createdAt"),
  }),
});

// ---------------------------------------------------------------------------

builder.queryField("bookLcReleasesPage", (t) =>
  t.field({
    type: ReleasePage,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { bookId: t.arg.string({ required: true }), page: t.arg.int(), pageSize: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      return queryPage(BookPrintRelease, { bookId: new Types.ObjectId(a.bookId) }, { releaseNo: -1 }, a, async (docs) => Promise.all(docs.map((d) => releaseShape(BookPrintRelease.hydrate(d)))));
    },
  }),
);

builder.queryField("bookLcErrataPage", (t) =>
  t.field({
    type: ErratumPage,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { bookId: t.arg.string({ required: true }), releaseId: t.arg.string(), page: t.arg.int(), pageSize: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      const filter: Record<string, unknown> = { bookId: new Types.ObjectId(a.bookId) };
      if (a.releaseId) filter.releaseId = new Types.ObjectId(a.releaseId);
      return queryPage(BookErratum, filter, { createdAt: -1 }, a, async (docs) => erratumShapes(docs.map((d) => BookErratum.hydrate(d)), ctx));
    },
  }),
);

builder.queryField("myBookLcBooks", (t) =>
  t.field({
    type: [MyBookRef],
    authScopes: { hasPermission: "book_lifecycle:teacher_view" },
    description: "আমার বই — books of the class + subject I teach now, released content only (§7.3).",
    resolve: async (_r, _a, ctx) => {
      assertBookPlane();
      const rows = await TS.myBooks(auth(ctx));
      return Promise.all(rows.map(async (row) => ({ row, errata: await erratumShapes(row.errata, ctx) })));
    },
  }),
);

builder.queryField("myBookLcReports", (t) =>
  t.field({
    type: [MyReportRef],
    authScopes: { hasPermission: "book_lifecycle:report" },
    description: "আমার পাঠানো — my own reports and their outcome (the 200 newest).",
    resolve: async (_r, _a, ctx) => {
      assertBookPlane();
      return (await TS.myReports(auth(ctx))).map((f) => ({
        code: f.code,
        bookId: f.bookId.toString(),
        status: f.status,
        category: f.category,
        textBn: f.textBn,
        page: f.anchor?.page ?? null,
        rejectReasonBn: f.rejectReasonBn ?? null,
        appliedInVersionId: f.appliedInVersionId?.toString() ?? null,
        createdAt: iso(f.createdAt)!,
      }));
    },
  }),
);

builder.mutationField("createBookLcRelease", (t) =>
  t.field({
    type: ReleaseRef,
    authScopes: { hasPermission: "book_lifecycle:release" },
    args: { versionId: t.arg.string({ required: true }), labelBn: t.arg.string({ required: true }), pressNameBn: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return releaseShape(await RS.createRelease(auth(ctx), a.versionId, a));
    },
  }),
);

builder.mutationField("recordBookLcRelease", (t) =>
  t.field({
    type: ReleaseRef,
    authScopes: { hasPermission: "book_lifecycle:release" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return releaseShape(await RS.recordRelease(auth(ctx), a.id));
    },
  }),
);

builder.mutationField("setBookLcReleaseStatus", (t) =>
  t.field({
    type: ReleaseRef,
    authScopes: { hasPermission: "book_lifecycle:release" },
    args: { id: t.arg.string({ required: true }), status: t.arg.string({ required: true }), at: t.arg.string(), pressNameBn: t.arg.string(), copies: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      if (a.status !== "sent_to_press" && a.status !== "printed") throw new Error("ছাপাখানায় / ছাপা হয়েছে");
      return releaseShape(await RS.setReleaseStatus(auth(ctx), a.id, { status: a.status, at: a.at ? new Date(a.at) : null, pressNameBn: a.pressNameBn, copies: a.copies }));
    },
  }),
);

builder.mutationField("notifyBookLcRelease", (t) =>
  t.field({
    type: ReleaseRef,
    authScopes: { hasPermission: "book_lifecycle:release" },
    description: "শিক্ষকদের জানান — BOOK_RELEASED to the book's readers.",
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return releaseShape((await RS.notifyTeachersOfRelease(auth(ctx), a.id)).release);
    },
  }),
);

builder.mutationField("publishBookLcToClassBooks", (t) =>
  t.field({
    type: ReleaseRef,
    authScopes: { hasPermission: "book_lifecycle:release" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return releaseShape(await RS.publishToClassBooks(auth(ctx), a.id));
    },
  }),
);

builder.mutationField("setBookLcClassBooksSwitch", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "book_lifecycle:finalize" },
    description: "The per-book switch for the class-books publish (Q7) — guardian exposure is the Principal's call.",
    args: { bookId: t.arg.string({ required: true }), on: t.arg.boolean({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      await RS.setClassBooksSwitch(auth(ctx), a.bookId, a.on);
      return a.on;
    },
  }),
);

builder.mutationField("updateBookLcErratum", (t) =>
  t.field({
    type: ErratumRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { id: t.arg.string({ required: true }), page: t.arg.string(), editions: t.arg.stringList(), whereBn: t.arg.string(), wrongText: t.arg.string(), correctText: t.arg.string(), instructionBn: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return (await erratumShapes([await ES.updateErratum(auth(ctx), a.id, a)], ctx))[0];
    },
  }),
);

builder.mutationField("announceBookLcErratum", (t) =>
  t.field({
    type: ErratumRef,
    authScopes: { hasPermission: "book_lifecycle:finalize" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return (await erratumShapes([await ES.announceErratum(auth(ctx), a.id)], ctx))[0];
    },
  }),
);

builder.mutationField("withdrawBookLcErratum", (t) =>
  t.field({
    type: ErratumRef,
    authScopes: { hasPermission: "book_lifecycle:finalize" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return (await erratumShapes([await ES.withdrawErratum(auth(ctx), a.id)], ctx))[0];
    },
  }),
);

builder.mutationField("ackBookLcErratum", (t) =>
  t.field({
    type: ErratumRef,
    authScopes: { hasPermission: "book_lifecycle:teacher_view" },
    description: "ঠিক করেছি — a reader of the book acknowledges an announced erratum.",
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return (await erratumShapes([await ES.ackErratum(auth(ctx), a.id)], ctx))[0];
    },
  }),
);

builder.mutationField("fileBookLcTeacherReport", (t) =>
  t.field({
    type: MyReportRef,
    authScopes: { hasPermission: "book_lifecycle:report" },
    description: "ভুল জানান — a teacher's report on a book of their class + subject (S9).",
    args: {
      bookId: t.arg.string({ required: true }),
      edition: t.arg.string(),
      page: t.arg.string(),
      quote: t.arg.string(),
      textBn: t.arg.string({ required: true }),
      category: t.arg.string({ required: true }),
      photoFileIds: t.arg.stringList(),
    },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      const f = await TS.fileTeacherReport(auth(ctx), a.bookId, { ...a, edition: (a.edition as BookEdition | null) ?? null, category: a.category as BookFeedbackCategory });
      return { code: f.code, bookId: f.bookId.toString(), status: f.status, category: f.category, textBn: f.textBn, page: f.anchor?.page ?? null, rejectReasonBn: null, appliedInVersionId: null, createdAt: iso(f.createdAt)! };
    },
  }),
);
