/**
 * `planBookChapter` — the matching chapter of the school's own book beside a lesson plan
 * (.claude/plans/plan-book-tab.md, Step 1). Gate: `lesson_plans:read_book` AND the plan's own read
 * scope (same helper as `artifact(id)`); the service re-checks both. A missing book / version / book
 * plane answers `available: false` with a Bangla reason — it never throws to the screen.
 */
import { builder } from "../../../schema";
import { planBookForCaller, type PlanBookChapterItem, type PlanBookPdf, type PlanBookPicture, type PlanBookResult } from "../../book-lifecycle/services/planBook";

const ChapterItemRef = builder.objectRef<PlanBookChapterItem>("PlanBookChapterItem").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    title: t.exposeString("title"),
    number: t.exposeInt("number", { nullable: true }),
  }),
});

const PictureRef = builder.objectRef<PlanBookPicture>("PlanBookPicture").implement({
  fields: (t) => ({ path: t.exposeString("path"), url: t.exposeString("url") }),
});

const PdfRef = builder.objectRef<PlanBookPdf>("PlanBookPdf").implement({
  description: "The printed PDF pages of the book (PB-2): page images are fetched with bookPdfPage.",
  fields: (t) => ({
    pdfId: t.exposeString("pdfId"),
    versionLabel: t.exposeString("versionLabel"),
    pageCount: t.exposeInt("pageCount"),
    pageAspect: t.exposeFloat("pageAspect"),
    fromPage: t.exposeInt("fromPage", { nullable: true }),
    toPage: t.exposeInt("toPage", { nullable: true }),
  }),
});

const PlanBookChapterRef = builder.objectRef<PlanBookResult>("PlanBookChapter").implement({
  description: "The book chapter beside a plan: children's text first, the teacher note + answers separate.",
  fields: (t) => ({
    available: t.exposeBoolean("available"),
    reason: t.exposeString("reason", { nullable: true }),
    bookTitle: t.exposeString("bookTitle", { nullable: true }),
    versionLabel: t.exposeString("versionLabel", { nullable: true }),
    released: t.exposeBoolean("released"),
    chapters: t.field({ type: [ChapterItemRef], resolve: (r) => r.chapters }),
    chapterKey: t.exposeString("chapterKey", { nullable: true }),
    title: t.exposeString("title", { nullable: true }),
    childText: t.exposeString("childText", { nullable: true }),
    teacherNote: t.exposeString("teacherNote", { nullable: true }),
    anchorMissing: t.exposeBoolean("anchorMissing"),
    pictures: t.field({ type: [PictureRef], resolve: (r) => r.pictures }),
    pdf: t.field({ type: PdfRef, nullable: true, resolve: (r) => r.pdf }),
  }),
});

builder.queryField("planBookChapter", (t) =>
  t.field({
    type: PlanBookChapterRef,
    authScopes: { hasPermission: "lesson_plans:read_book" },
    description:
      "The chapter of the school's released (else final) book that matches this plan. `chapterKey` overrides the matched chapter. Audited as a content read.",
    args: { artifactId: t.arg.string({ required: true }), chapterKey: t.arg.string() },
    resolve: (_r, a, ctx) => planBookForCaller(ctx, a.artifactId, a.chapterKey),
  }),
);
