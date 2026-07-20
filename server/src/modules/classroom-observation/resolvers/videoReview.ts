/**
 * Video-review resolvers (owner ask 2026-07-20) — the simple class-video
 * self-review loop on the EXISTING observation permissions (no new perm):
 *
 *   createVideoReview   — observation:upload (Principal/Office): log a YouTube
 *                         link + day/time/class/room and assign a teacher.
 *   myVideoReviews      — observation:review (TEACHER): the caller's own list.
 *   reviewVideo         — observation:review, ROW-GATED in the service to the
 *                         assigned teacher: OK, or NOT_OK + mandatory comment.
 *   videoReviewOverview — observation:manage (Principal/Office): every row +
 *                         per-teacher pending/ok/not-ok counts.
 *
 * Staff-internal — GUARDIAN holds no observation:* permission. Identity plane;
 * no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  createVideoReview,
  myVideoReviews,
  reviewVideo,
  videoReviewOverview,
  type VideoReviewShape,
  type VideoReviewTeacherSummary,
  type VideoReviewOverview,
} from "../services/VideoReviewService";

const VideoReviewRef = builder.objectRef<VideoReviewShape>("VideoReview");
VideoReviewRef.implement({
  description:
    "A class-session video (YouTube link + day/time/class/room) assigned to a teacher for a simple " +
    "OK / NOT_OK-with-comment self-review. Staff-internal (ADR-005 identity plane).",
  fields: (t) => ({
    id: t.exposeString("id"),
    youtubeUrl: t.exposeString("youtubeUrl"),
    classDate: t.exposeString("classDate"),
    timeLabel: t.exposeString("timeLabel"),
    classLabel: t.exposeString("classLabel"),
    room: t.exposeString("room"),
    teacherId: t.exposeString("teacherId"),
    teacherName: t.string({ nullable: true, resolve: (r) => r.teacherName }),
    status: t.exposeString("status"),
    comment: t.string({ nullable: true, resolve: (r) => r.comment }),
    reviewedAt: t.string({ nullable: true, resolve: (r) => r.reviewedAt }),
    createdAt: t.exposeString("createdAt"),
  }),
});

const VideoReviewTeacherSummaryRef = builder.objectRef<VideoReviewTeacherSummary>(
  "VideoReviewTeacherSummary",
);
VideoReviewTeacherSummaryRef.implement({
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    teacherName: t.string({ nullable: true, resolve: (r) => r.teacherName }),
    pending: t.exposeInt("pending"),
    ok: t.exposeInt("ok"),
    notOk: t.exposeInt("notOk"),
  }),
});

const VideoReviewOverviewRef = builder.objectRef<VideoReviewOverview>("VideoReviewOverview");
VideoReviewOverviewRef.implement({
  fields: (t) => ({
    rows: t.field({ type: [VideoReviewRef], resolve: (o) => o.rows }),
    summary: t.field({ type: [VideoReviewTeacherSummaryRef], resolve: (o) => o.summary }),
  }),
});

builder.mutationField("createVideoReview", (t) =>
  t.field({
    type: VideoReviewRef,
    description:
      "Log a class-session YouTube link with its day/time/class/room and assign a teacher to review it. " +
      "Requires observation:upload (Principal/Office). Audited.",
    authScopes: { hasPermission: "observation:upload" },
    args: {
      youtubeUrl: t.arg.string({ required: true }),
      classDate: t.arg.string({ required: true }),
      timeLabel: t.arg.string({ required: true }),
      classLabel: t.arg.string({ required: true }),
      room: t.arg.string({ required: true }),
      teacherId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return createVideoReview({
        ...args,
        actorId: ctx.auth.userId as string,
        actorRole: ctx.auth.role,
      });
    },
  }),
);

builder.queryField("myVideoReviews", (t) =>
  t.field({
    type: [VideoReviewRef],
    description:
      "The caller's assigned class-video reviews, PENDING first. Requires observation:review (teacher).",
    authScopes: { hasPermission: "observation:review" },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return myVideoReviews(ctx.auth.userId as string);
    },
  }),
);

builder.mutationField("reviewVideo", (t) =>
  t.field({
    type: VideoReviewRef,
    description:
      "The assigned teacher's verdict on a class video: ok=true closes it; ok=false requires a comment. " +
      "Row-gated to the assigned teacher. Requires observation:review. Audited.",
    authScopes: { hasPermission: "observation:review" },
    args: {
      id: t.arg.string({ required: true }),
      ok: t.arg.boolean({ required: true }),
      comment: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return reviewVideo({
        id: args.id,
        ok: args.ok,
        comment: args.comment ?? null,
        actorId: ctx.auth.userId as string,
        actorRole: ctx.auth.role,
      });
    },
  }),
);

builder.queryField("videoReviewOverview", (t) =>
  t.field({
    type: VideoReviewOverviewRef,
    description:
      "Every class-video review with per-teacher pending/ok/not-ok counts. Requires observation:manage " +
      "(Principal/Office).",
    authScopes: { hasPermission: "observation:manage" },
    resolve: async () => videoReviewOverview(),
  }),
);
