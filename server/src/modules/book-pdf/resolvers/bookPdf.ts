/**
 * Book PDF resolvers (PB-1/PB-2, D-#1661). The upload itself is a REST route
 * (POST /files/book-pdf, multipart PDF + bookCode); everything else is here.
 *
 *   bookPdfShelf       — teachers (plan-book read / class_books:view|manage): READY books + chapter ranges.
 *   bookPdfPage        — one page as a data URI (same gate).
 *   bookPdfAdminShelf  — class_books:manage: every school book with its PDF row.
 *   bookChapterKeys    — class_books:manage: the chapter keys a page range is keyed to.
 *   setBookPdfChapters / updateBookPdf / deleteBookPdf — class_books:manage.
 */
import type { Permission } from "@scd/shared";
import { builder } from "../../../schema";
import {
  bookChapterKeys,
  bookPdfAdminRows,
  bookPdfPage,
  bookPdfShelf,
  deleteBookPdf,
  setBookPdfChapters,
  updateBookPdf,
  type BookChapterKeyShape,
  type BookPdfAdminRow,
  type BookPdfChapterShape,
  type BookPdfPageShape,
  type BookPdfShape,
} from "../services/BookPdfService";

const ChapterRef = builder.objectRef<BookPdfChapterShape>("BookPdfChapter").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    title: t.exposeString("title"),
    fromPage: t.exposeInt("fromPage"),
    toPage: t.exposeInt("toPage"),
  }),
});

const BookPdfRef = builder.objectRef<BookPdfShape>("BookPdf").implement({
  description: "The printed pages of a school book (rendered from the uploaded PDF), by chapter page ranges.",
  fields: (t) => ({
    id: t.exposeString("id"),
    bookCode: t.exposeString("bookCode"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    titleBn: t.exposeString("titleBn"),
    versionLabel: t.exposeString("versionLabel"),
    sourceName: t.exposeString("sourceName"),
    // PROCESSING | READY | FAILED
    status: t.exposeString("status"),
    error: t.string({ nullable: true, resolve: (r) => r.error }),
    replacing: t.exposeBoolean("replacing"),
    pageCount: t.exposeInt("pageCount"),
    pageAspect: t.exposeFloat("pageAspect"),
    active: t.exposeBoolean("active"),
    chapters: t.field({ type: [ChapterRef], resolve: (r) => r.chapters }),
    updatedAt: t.exposeString("updatedAt"),
  }),
});

const PageRef = builder.objectRef<BookPdfPageShape>("BookPdfPage").implement({
  fields: (t) => ({
    pdfId: t.exposeString("pdfId"),
    page: t.exposeInt("page"),
    pageCount: t.exposeInt("pageCount"),
    dataUri: t.exposeString("dataUri"),
  }),
});

const AdminRowRef = builder.objectRef<BookPdfAdminRow>("BookPdfAdminRow").implement({
  fields: (t) => ({
    bookCode: t.exposeString("bookCode"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    titleBn: t.exposeString("titleBn"),
    pdf: t.field({ type: BookPdfRef, nullable: true, resolve: (r) => r.pdf }),
  }),
});

const ChapterKeyRef = builder.objectRef<BookChapterKeyShape>("BookChapterKey").implement({
  fields: (t) => ({ key: t.exposeString("key"), title: t.exposeString("title") }),
});

const ChapterInput = builder.inputType("BookPdfChapterInput", {
  fields: (t) => ({
    key: t.string({ required: true }),
    title: t.string({ required: false }),
    fromPage: t.int({ required: true }),
    toPage: t.int({ required: true }),
  }),
});

// Readers: the service re-checks (non-guardian + one of these actions).
const READ_SCOPES: { hasAnyPermission: Permission[] } = { hasAnyPermission: ["lesson_plans:read_book", "class_books:view", "class_books:manage"] };

builder.queryField("bookPdfShelf", (t) =>
  t.field({
    type: [BookPdfRef],
    authScopes: READ_SCOPES,
    description: "Teachers' shelf of printed book PDFs (READY, visible) with their chapter page ranges. Never for guardians.",
    resolve: (_r, _a, ctx) => bookPdfShelf(ctx),
  }),
);

builder.queryField("bookPdfPage", (t) =>
  t.field({
    type: PageRef,
    authScopes: READ_SCOPES,
    args: { pdfId: t.arg.string({ required: true }), page: t.arg.int({ required: true }) },
    resolve: (_r, a, ctx) => bookPdfPage(ctx, a.pdfId, a.page),
  }),
);

builder.queryField("bookPdfAdminShelf", (t) =>
  t.field({
    type: [AdminRowRef],
    authScopes: { hasPermission: "class_books:manage" },
    resolve: () => bookPdfAdminRows(),
  }),
);

builder.queryField("bookChapterKeys", (t) =>
  t.field({
    type: [ChapterKeyRef],
    authScopes: { hasPermission: "class_books:manage" },
    args: { bookCode: t.arg.string({ required: true }) },
    resolve: (_r, a) => bookChapterKeys(a.bookCode),
  }),
);

builder.mutationField("setBookPdfChapters", (t) =>
  t.field({
    type: BookPdfRef,
    authScopes: { hasPermission: "class_books:manage" },
    args: { bookCode: t.arg.string({ required: true }), chapters: t.arg({ type: [ChapterInput], required: true }) },
    resolve: (_r, a, ctx) =>
      setBookPdfChapters(
        ctx.auth!.userId,
        a.bookCode,
        a.chapters.map((c) => ({ key: c.key, title: c.title ?? null, fromPage: c.fromPage, toPage: c.toPage })),
      ),
  }),
);

builder.mutationField("updateBookPdf", (t) =>
  t.field({
    type: BookPdfRef,
    authScopes: { hasPermission: "class_books:manage" },
    args: { bookCode: t.arg.string({ required: true }), versionLabel: t.arg.string({ required: false }), active: t.arg.boolean({ required: false }) },
    resolve: (_r, a, ctx) => updateBookPdf(ctx.auth!.userId, a.bookCode, { versionLabel: a.versionLabel, active: a.active }),
  }),
);

builder.mutationField("deleteBookPdf", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "class_books:manage" },
    args: { bookCode: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => deleteBookPdf(ctx.auth!.userId, a.bookCode),
  }),
);
