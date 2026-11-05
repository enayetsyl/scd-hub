/**
 * "My child's books" (SB-4, D-#983/#984, W4): the storybooks a child holds now, books read in
 * the last 7 days / this month / this year, stickers, and recent history. A linked guardian
 * for their child, or staff with library:view (link / reader check in the service).
 */
import { builder } from "../../../schema";
import { childStoryReading, type ChildStoryReading, type StoryLoanView } from "../services/StoryReadingService";

const StoryLoanRef = builder.objectRef<StoryLoanView>("StoryLoan");
StoryLoanRef.implement({
  description: "One storybook loan as the family sees it.",
  fields: (t) => ({
    loanId: t.string({ resolve: (v) => v.loan._id.toString() }),
    titleId: t.string({ resolve: (v) => v.title._id.toString() }),
    titleBn: t.string({ resolve: (v) => v.title.titleBn }),
    seriesNo: t.int({ nullable: true, resolve: (v) => v.title.seriesNo ?? null }),
    seriesNameBn: t.string({ nullable: true, resolve: (v) => v.seriesNameBn }),
    coverFileId: t.string({ nullable: true, resolve: (v) => v.title.coverFileId?.toString() ?? null }),
    issuedAt: t.string({ resolve: (v) => new Date(v.loan.issuedAt).toISOString() }),
    dueDate: t.string({ resolve: (v) => new Date(v.loan.dueDate).toISOString() }),
    returnedAt: t.string({ nullable: true, resolve: (v) => (v.loan.returnedAt ? new Date(v.loan.returnedAt).toISOString() : null) }),
    overdue: t.boolean({ resolve: (v) => v.loan.status === "ACTIVE" && new Date(v.loan.dueDate).getTime() < Date.now() }),
    read: t.boolean({ nullable: true, resolve: (v) => v.loan.readAtReturn ?? null }),
    sticker: t.boolean({ resolve: (v) => v.loan.stickerGiven === true }),
  }),
});

const ChildReadingRef = builder.objectRef<ChildStoryReading>("ChildStoryReading");
ChildReadingRef.implement({
  fields: (t) => ({
    current: t.field({ type: [StoryLoanRef], resolve: (r) => r.current }),
    history: t.field({ type: [StoryLoanRef], resolve: (r) => r.history }),
    readLast7Days: t.exposeInt("readLast7Days"),
    readThisMonth: t.exposeInt("readThisMonth"),
    readThisYear: t.exposeInt("readThisYear"),
    stickersThisYear: t.exposeInt("stickersThisYear"),
    stickersTotal: t.exposeInt("stickersTotal"),
  }),
});

builder.queryField("childStoryReading", (t) =>
  t.field({
    type: ChildReadingRef,
    description: "A child's storybooks: held now, read counts (7 days / month / year), stickers, recent history (W4).",
    authScopes: { hasAnyPermission: ["library:view", "guardian:read_child"] },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => childStoryReading(ctx, args.studentId),
  }),
);
