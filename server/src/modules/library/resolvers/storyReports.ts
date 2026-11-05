/**
 * Storybook reports (SB-6, W10) — each tab its own Reports-hub switch (D-#861 pattern):
 * reports:storybook_series / reports:storybook_books / reports:storybook_readers.
 */
import { builder } from "../../../schema";
import {
  storyBooksReport,
  storyReadersReport,
  storySeriesReport,
  type StoryPreferenceCell,
  type StoryReaderRow,
  type StoryReadersReport,
  type StoryStatRow,
} from "../services/StoryReportService";

const StatRowRef = builder.objectRef<StoryStatRow>("StoryStatRow");
StatRowRef.implement({
  description: "Reads / lending / waiting for one storybook series or book over the report window.",
  fields: (t) => ({
    id: t.exposeString("id"),
    nameBn: t.exposeString("nameBn"),
    seriesNo: t.int({ nullable: true, resolve: (r) => r.seriesNo }),
    lent: t.exposeInt("lent"),
    read: t.exposeInt("read"),
    returned: t.exposeInt("returned"),
    readers: t.exposeInt("readers"),
    waiting: t.exposeInt("waiting"),
    copies: t.exposeInt("copies"),
    neverBorrowed: t.exposeBoolean("neverBorrowed"),
    secondCopy: t.exposeBoolean("secondCopy"),
  }),
});

const ReaderRowRef = builder.objectRef<StoryReaderRow>("StoryReaderRow");
ReaderRowRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    classLabelBn: t.exposeString("classLabelBn"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    read: t.exposeInt("read"),
    favouriteTagBn: t.string({ nullable: true, resolve: (r) => r.favouriteTagBn }),
    lastVisit: t.string({ nullable: true, resolve: (r) => (r.lastVisit ? r.lastVisit.toISOString() : null) }),
    overdue: t.exposeBoolean("overdue"),
    stopped: t.exposeBoolean("stopped"),
  }),
});

const PrefCellRef = builder.objectRef<StoryPreferenceCell>("StoryPreferenceCell");
PrefCellRef.implement({
  fields: (t) => ({
    seriesNameBn: t.exposeString("seriesNameBn"),
    groupLabelBn: t.exposeString("groupLabelBn"),
    read: t.exposeInt("read"),
  }),
});

const ReadersRef = builder.objectRef<StoryReadersReport>("StoryReadersReport");
ReadersRef.implement({
  fields: (t) => ({
    readers: t.field({ type: [ReaderRowRef], resolve: (r) => r.readers }),
    byClass: t.field({ type: [PrefCellRef], resolve: (r) => r.byClass }),
    bySection: t.field({ type: [PrefCellRef], resolve: (r) => r.bySection }),
  }),
});

builder.queryField("storySeriesReport", (t) =>
  t.field({
    type: [StatRowRef],
    description: "Storybooks by series over d30 / d90 / year. Requires reports:storybook_series.",
    authScopes: { hasPermission: "reports:storybook_series" },
    args: { window: t.arg.string({ required: true }) },
    resolve: async (_root, args) => storySeriesReport(args.window),
  }),
);

builder.queryField("storyBooksReport", (t) =>
  t.field({
    type: [StatRowRef],
    description: "Storybooks by book (optionally one series) — second-copy suggestions and never-borrowed books. Requires reports:storybook_books.",
    authScopes: { hasPermission: "reports:storybook_books" },
    args: { window: t.arg.string({ required: true }), seriesId: t.arg.string({ required: false }) },
    resolve: async (_root, args) => storyBooksReport(args.window, args.seriesId),
  }),
);

builder.queryField("storyReadersReport", (t) =>
  t.field({
    type: ReadersRef,
    description: "Storybook readers: per child (names children), who stopped, preference by class / section. Requires reports:storybook_readers.",
    authScopes: { hasPermission: "reports:storybook_readers" },
    args: { window: t.arg.string({ required: true }) },
    resolve: async (_root, args) => storyReadersReport(args.window),
  }),
);
