/**
 * Storybook shelf resolvers (SB-1, D-#980/#981/#986, docs/prd-storybook-reading.md).
 *
 * Reads: `library:view` (staff — everything, drafts too) or `guardian:read_child` (a linked
 * guardian — published series of their child's age band; the link is checked in
 * `resolveShelfViewer`). Writes: `library:edit` (Office). The PDF upload is the REST route
 * POST /files/storybook (routes/files.ts) — same gate.
 *
 * Identity plane; no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { IStoryTag } from "../models/StoryTag";
import {
  bulkTagStoryBooks,
  createStorySeries,
  createStoryTag,
  mergeStoryTags,
  nextSeriesNo,
  resolveShelfViewer,
  saveStoryAgeBand,
  setStoryBookPublished,
  storyAgeBands,
  storyBookDetail,
  storySeriesDetail,
  storyShelf,
  storyTags,
  storybookImage,
  updateStoryBook,
  updateStorySeries,
  updateStoryTag,
  type AgeBandView,
  type BookCard,
  type SeriesCard,
} from "../services/StorybookService";

const ids = (list: ReadonlyArray<{ toString(): string }> | undefined) => (list ?? []).map((x) => x.toString());

const StoryAgeBandRef = builder.objectRef<AgeBandView>("StoryAgeBand");
StoryAgeBandRef.implement({
  description: "A storybook age band (D-#981) — which class levels' guardians see its series. isDefault = no admin row yet.",
  fields: (t) => ({
    code: t.exposeString("code"),
    labelBn: t.exposeString("labelBn"),
    ageMin: t.exposeInt("ageMin"),
    ageMax: t.exposeInt("ageMax"),
    classLevels: t.exposeIntList("classLevels"),
    sortOrder: t.exposeInt("sortOrder"),
    active: t.exposeBoolean("active"),
    isDefault: t.exposeBoolean("isDefault"),
  }),
});

const StoryTagRef = builder.objectRef<IStoryTag>("StoryTag");
StoryTagRef.implement({
  description: "A managed storybook tag (D-#986).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v._id.toString() }),
    nameBn: t.exposeString("nameBn"),
    nameEn: t.string({ nullable: true, resolve: (v) => v.nameEn ?? null }),
    active: t.boolean({ resolve: (v) => v.active !== false }),
  }),
});

const StorySeriesCardRef = builder.objectRef<SeriesCard>("StorySeriesCard");
StorySeriesCardRef.implement({
  description: "A series as the catalogue shows it, with counts for the viewer (D-#980).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.series._id.toString() }),
    code: t.string({ resolve: (v) => v.series.code }),
    nameBn: t.string({ resolve: (v) => v.series.nameBn }),
    nameEn: t.string({ nullable: true, resolve: (v) => v.series.nameEn ?? null }),
    ageBandCode: t.string({ resolve: (v) => v.series.ageBandCode }),
    ageBandLabel: t.exposeString("ageBandLabel"),
    tagIds: t.stringList({ resolve: (v) => ids(v.series.tagIds) }),
    tagNamesBn: t.exposeStringList("tagNamesBn"),
    aboutBn: t.string({ nullable: true, resolve: (v) => v.series.aboutBn ?? null }),
    learnPointsBn: t.stringList({ resolve: (v) => v.series.learnPointsBn ?? [] }),
    coverFileId: t.string({ nullable: true, resolve: (v) => v.series.coverFileId?.toString() ?? null }),
    sortOrder: t.int({ resolve: (v) => v.series.sortOrder ?? 0 }),
    status: t.string({ resolve: (v) => v.series.status }),
    bookCount: t.exposeInt("bookCount"),
    availableBooks: t.exposeInt("availableBooks"),
    draftBooks: t.exposeInt("draftBooks"),
    copyCount: t.exposeInt("copyCount"),
  }),
});

const StoryBookCardRef = builder.objectRef<BookCard>("StoryBookCard");
StoryBookCardRef.implement({
  description: "One storybook with availability and the viewing child's own history (D-#980).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.title._id.toString() }),
    titleBn: t.string({ resolve: (v) => v.title.titleBn }),
    titleEn: t.string({ nullable: true, resolve: (v) => v.title.titleEn ?? null }),
    seriesId: t.string({ nullable: true, resolve: (v) => v.title.seriesId?.toString() ?? null }),
    seriesNo: t.int({ nullable: true, resolve: (v) => v.title.seriesNo ?? null }),
    tagIds: t.stringList({ resolve: (v) => ids(v.title.tagIds) }),
    tagNamesBn: t.exposeStringList("tagNamesBn"),
    learnedPointsBn: t.stringList({ resolve: (v) => v.title.learnedPointsBn ?? [] }),
    parentTipBn: t.string({ nullable: true, resolve: (v) => v.title.parentTipBn ?? null }),
    coverFileId: t.string({ nullable: true, resolve: (v) => v.title.coverFileId?.toString() ?? null }),
    previewFileIds: t.stringList({ resolve: (v) => ids(v.title.previewFileIds) }),
    draft: t.boolean({ resolve: (v) => v.title.draft === true }),
    active: t.boolean({ resolve: (v) => v.title.active !== false }),
    totalCopies: t.exposeInt("totalCopies"),
    availableCopies: t.exposeInt("availableCopies"),
    nextDueDate: t.string({ nullable: true, resolve: (v) => (v.nextDueDate ? v.nextDueDate.toISOString() : null) }),
    waitingCount: t.exposeInt("waitingCount"),
    childReadCount: t.int({ nullable: true, resolve: (v) => v.childReadCount }),
    childHasNow: t.exposeBoolean("childHasNow"),
  }),
});

interface SeriesDetailView {
  card: SeriesCard;
  books: BookCard[];
}
const StorySeriesDetailRef = builder.objectRef<SeriesDetailView>("StorySeriesDetail");
StorySeriesDetailRef.implement({
  fields: (t) => ({
    series: t.field({ type: StorySeriesCardRef, resolve: (v) => v.card }),
    books: t.field({ type: [StoryBookCardRef], resolve: (v) => v.books }),
  }),
});

interface BookDetailView {
  card: BookCard;
  seriesNameBn: string;
  seriesCode: string;
}
const StoryBookDetailRef = builder.objectRef<BookDetailView>("StoryBookDetail");
StoryBookDetailRef.implement({
  fields: (t) => ({
    book: t.field({ type: StoryBookCardRef, resolve: (v) => v.card }),
    seriesNameBn: t.exposeString("seriesNameBn"),
    seriesCode: t.exposeString("seriesCode"),
  }),
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

builder.queryField("storyShelf", (t) =>
  t.field({
    type: [StorySeriesCardRef],
    description:
      "The storybook catalogue (W1). A guardian passes their child → published series of the child's age band. " +
      "Staff without a child see every series, drafts included; with a child, what that guardian sees.",
    authScopes: { hasAnyPermission: ["library:view", "guardian:read_child"] },
    args: { studentId: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => storyShelf(await resolveShelfViewer(ctx, args.studentId)),
  }),
);

builder.queryField("storySeries", (t) =>
  t.field({
    type: StorySeriesDetailRef,
    description: "One series with its books, availability and the child's own history (W2).",
    authScopes: { hasAnyPermission: ["library:view", "guardian:read_child"] },
    args: { seriesId: t.arg.string({ required: true }), studentId: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => storySeriesDetail(await resolveShelfViewer(ctx, args.studentId), args.seriesId),
  }),
);

builder.queryField("storyBook", (t) =>
  t.field({
    type: StoryBookDetailRef,
    description: "One storybook: what the child learns, the parents' tip, preview pages, availability (W3).",
    authScopes: { hasAnyPermission: ["library:view", "guardian:read_child"] },
    args: { titleId: t.arg.string({ required: true }), studentId: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => {
      const d = await storyBookDetail(await resolveShelfViewer(ctx, args.studentId), args.titleId);
      return { card: d.card, seriesNameBn: d.series.nameBn, seriesCode: d.series.code };
    },
  }),
);

builder.queryField("storybookImage", (t) =>
  t.string({
    description: "A storybook cover / preview page as a JPEG data URI, behind the shelf gate (never the whole book).",
    authScopes: { hasAnyPermission: ["library:view", "guardian:read_child"] },
    args: { fileId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => storybookImage(ctx, args.fileId),
  }),
);

builder.queryField("storyAgeBands", (t) =>
  t.field({
    type: [StoryAgeBandRef],
    description: "Storybook age bands (admin data; defaults when none saved).",
    authScopes: { hasPermission: "library:view" },
    resolve: async () => storyAgeBands(),
  }),
);

builder.queryField("storyTags", (t) =>
  t.field({
    type: [StoryTagRef],
    description: "The managed storybook tag list.",
    authScopes: { hasPermission: "library:view" },
    args: { includeInactive: t.arg.boolean({ required: false }) },
    resolve: async (_root, args) => storyTags(args.includeInactive ?? false),
  }),
);

builder.queryField("storyNextSeriesNo", (t) =>
  t.int({
    description: "The next free book number in a series (upload form default).",
    authScopes: { hasPermission: "library:edit" },
    args: { seriesId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => nextSeriesNo(args.seriesId),
  }),
);

// ---------------------------------------------------------------------------
// Writes — library:edit
// ---------------------------------------------------------------------------

builder.mutationField("saveStoryAgeBand", (t) =>
  t.field({
    type: StoryAgeBandRef,
    description: "Create or replace an age band by code (classes whose guardians see its series). Audited.",
    authScopes: { hasPermission: "library:edit" },
    args: {
      code: t.arg.string({ required: true }),
      labelBn: t.arg.string({ required: true }),
      ageMin: t.arg.int({ required: true }),
      ageMax: t.arg.int({ required: true }),
      classLevels: t.arg.intList({ required: true }),
      sortOrder: t.arg.int({ required: false }),
      active: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => saveStoryAgeBand(args, ctx.auth!.userId),
  }),
);

builder.mutationField("createStoryTag", (t) =>
  t.field({
    type: StoryTagRef,
    authScopes: { hasPermission: "library:edit" },
    args: { nameBn: t.arg.string({ required: true }), nameEn: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => createStoryTag(args, ctx.auth!.userId),
  }),
);

builder.mutationField("updateStoryTag", (t) =>
  t.field({
    type: StoryTagRef,
    description: "Rename a tag (every book shows the new name) or retire it.",
    authScopes: { hasPermission: "library:edit" },
    args: {
      tagId: t.arg.string({ required: true }),
      nameBn: t.arg.string({ required: false }),
      nameEn: t.arg.string({ required: false }),
      active: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => updateStoryTag(args.tagId, args, ctx.auth!.userId),
  }),
);

builder.mutationField("mergeStoryTags", (t) =>
  t.field({
    type: StoryTagRef,
    description: "Move every use of one tag to another and retire the first. Returns the surviving tag.",
    authScopes: { hasPermission: "library:edit" },
    args: { fromTagId: t.arg.string({ required: true }), intoTagId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => mergeStoryTags(args.fromTagId, args.intoTagId, ctx.auth!.userId),
  }),
);

builder.mutationField("bulkTagStoryBooks", (t) =>
  t.int({
    description: "Add / remove tags on many books at once. Returns how many books were touched.",
    authScopes: { hasPermission: "library:edit" },
    args: {
      titleIds: t.arg.stringList({ required: true }),
      addTagIds: t.arg.stringList({ required: false }),
      removeTagIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      bulkTagStoryBooks(args.titleIds, args.addTagIds ?? [], args.removeTagIds ?? [], ctx.auth!.userId),
  }),
);

async function seriesCard(seriesId: string): Promise<SeriesCard> {
  const all = await storyShelf({ bandCodes: null, includeUnpublished: true, studentId: null });
  return all.find((c) => c.series._id.toString() === seriesId)!;
}

builder.mutationField("createStorySeries", (t) =>
  t.field({
    type: StorySeriesCardRef,
    description: "A new series (starts as a DRAFT). Code = 2–4 capital letters, the copy-code prefix.",
    authScopes: { hasPermission: "library:edit" },
    args: {
      code: t.arg.string({ required: true }),
      nameBn: t.arg.string({ required: true }),
      nameEn: t.arg.string({ required: false }),
      ageBandCode: t.arg.string({ required: true }),
      tagIds: t.arg.stringList({ required: false }),
      aboutBn: t.arg.string({ required: false }),
      learnPointsBn: t.arg.stringList({ required: false }),
      sortOrder: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const s = await createStorySeries(args, ctx.auth!.userId);
      return seriesCard(s._id.toString());
    },
  }),
);

builder.mutationField("updateStorySeries", (t) =>
  t.field({
    type: StorySeriesCardRef,
    description: "Edit a series; status DRAFT / PUBLISHED / HIDDEN.",
    authScopes: { hasPermission: "library:edit" },
    args: {
      seriesId: t.arg.string({ required: true }),
      status: t.arg.string({ required: false }),
      nameBn: t.arg.string({ required: false }),
      nameEn: t.arg.string({ required: false }),
      ageBandCode: t.arg.string({ required: false }),
      tagIds: t.arg.stringList({ required: false }),
      aboutBn: t.arg.string({ required: false }),
      learnPointsBn: t.arg.stringList({ required: false }),
      sortOrder: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await updateStorySeries(args.seriesId, args, ctx.auth!.userId);
      return seriesCard(args.seriesId);
    },
  }),
);

async function staffBookCard(titleId: string): Promise<BookCard> {
  const d = await storyBookDetail({ bandCodes: null, includeUnpublished: true, studentId: null }, titleId);
  return d.card;
}

builder.mutationField("updateStoryBook", (t) =>
  t.field({
    type: StoryBookCardRef,
    description: "Edit a storybook's titles, number, tags, learned points and parents' tip.",
    authScopes: { hasPermission: "library:edit" },
    args: {
      titleId: t.arg.string({ required: true }),
      titleBn: t.arg.string({ required: false }),
      titleEn: t.arg.string({ required: false }),
      seriesId: t.arg.string({ required: false }),
      seriesNo: t.arg.int({ required: false }),
      tagIds: t.arg.stringList({ required: false }),
      learnedPointsBn: t.arg.stringList({ required: false }),
      parentTipBn: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await updateStoryBook(args.titleId, args, ctx.auth!.userId);
      return staffBookCard(args.titleId);
    },
  }),
);

builder.mutationField("setStoryBookPublished", (t) =>
  t.field({
    type: StoryBookCardRef,
    description: "Publish a draft book (guardians of its band can now see it), or move it back to draft.",
    authScopes: { hasPermission: "library:edit" },
    args: { titleId: t.arg.string({ required: true }), published: t.arg.boolean({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await setStoryBookPublished(args.titleId, args.published, ctx.auth!.userId);
      return staffBookCard(args.titleId);
    },
  }),
);
