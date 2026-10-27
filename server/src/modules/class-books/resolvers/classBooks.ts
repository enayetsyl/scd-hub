/**
 * Class books resolvers (D-#870, docs/prd-class-books.md). The upload itself is a REST
 * route (POST /files/class-book, multipart PDF); everything else is here.
 *
 *   classBooks       — class_books:view|manage: the staff shelf (hidden/failed included).
 *   myClassBooks     — guardian plane: READY, visible books of the children's class levels.
 *   classBookPage    — one page as a data URI; staff by action, a guardian by the child's class.
 *   updateClassBook  — class_books:manage: rename, move class, order, hide/show.
 *   deleteClassBook  — class_books:manage: remove the book and its page images.
 */
import { builder } from "../../../schema";
import {
  classBookPage,
  classBooksForStaff,
  deleteClassBook,
  myClassBooks,
  updateClassBook,
  type ClassBookPageShape,
  type ClassBookShape,
} from "../services/ClassBookService";

const ClassBookRef = builder.objectRef<ClassBookShape>("ClassBook");
ClassBookRef.implement({
  description: "A classroom book families read page by page (view only).",
  fields: (t) => ({
    id: t.exposeString("id"),
    classLevel: t.exposeInt("classLevel"),
    classLabelBn: t.exposeString("classLabelBn"),
    title: t.exposeString("title"),
    sortOrder: t.exposeInt("sortOrder"),
    // PROCESSING | READY | FAILED
    status: t.exposeString("status"),
    error: t.string({ nullable: true, resolve: (r) => r.error }),
    pageCount: t.exposeInt("pageCount"),
    pageAspect: t.exposeFloat("pageAspect"),
    active: t.exposeBoolean("active"),
    sourceName: t.exposeString("sourceName"),
    createdAt: t.exposeString("createdAt"),
  }),
});

const ClassBookPageRef = builder.objectRef<ClassBookPageShape>("ClassBookPage");
ClassBookPageRef.implement({
  fields: (t) => ({
    bookId: t.exposeString("bookId"),
    page: t.exposeInt("page"),
    pageCount: t.exposeInt("pageCount"),
    dataUri: t.exposeString("dataUri"),
  }),
});

builder.queryField("classBooks", (t) =>
  t.field({
    type: [ClassBookRef],
    authScopes: { hasAnyPermission: ["class_books:view", "class_books:manage"] },
    args: { classLevel: t.arg.int({ required: false }) },
    resolve: (_r, args) => classBooksForStaff(args.classLevel ?? null),
  }),
);

builder.queryField("myClassBooks", (t) =>
  t.field({
    type: [ClassBookRef],
    authScopes: { hasPermission: "guardian:read_child" },
    resolve: (_r, _a, ctx) => myClassBooks(ctx.auth!.userId),
  }),
);

builder.queryField("classBookPage", (t) =>
  t.field({
    type: ClassBookPageRef,
    // Staff by action; a guardian is narrowed to their children's classes in the service.
    authScopes: { hasAnyPermission: ["class_books:view", "class_books:manage", "guardian:read_child"] },
    args: {
      bookId: t.arg.string({ required: true }),
      page: t.arg.int({ required: true }),
    },
    resolve: (_r, args, ctx) => classBookPage(ctx, args.bookId, args.page),
  }),
);

builder.mutationField("updateClassBook", (t) =>
  t.field({
    type: ClassBookRef,
    authScopes: { hasPermission: "class_books:manage" },
    args: {
      id: t.arg.string({ required: true }),
      title: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      sortOrder: t.arg.int({ required: false }),
      active: t.arg.boolean({ required: false }),
    },
    resolve: (_r, args, ctx) =>
      updateClassBook(ctx.auth!.userId, args.id, {
        title: args.title,
        classLevel: args.classLevel,
        sortOrder: args.sortOrder,
        active: args.active,
      }),
  }),
);

builder.mutationField("deleteClassBook", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "class_books:manage" },
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => deleteClassBook(ctx.auth!.userId, args.id),
  }),
);
