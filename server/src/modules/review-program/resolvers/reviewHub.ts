/**
 * myReviewHub (H-1, .claude/plans/review-hub-and-quality.md) — everything the caller still has
 * to review, in one read. Authenticated only: each section inside is gated by the caller's OWN
 * review permission (see ReviewHubService), so a caller with none gets an empty hub, not a refusal
 * — the drawer and the Today card ask on every render and must never be taken down by it.
 */
import { builder } from "../../../schema";
import { myReviewHub, type ReviewHubResult, type ReviewHubRow } from "../services/ReviewHubService";

const RowRef = builder.objectRef<ReviewHubRow>("ReviewHubRow");
RowRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    kind: t.exposeString("kind"),
    titleBn: t.exposeString("titleBn"),
    left: t.exposeInt("left"),
    total: t.exposeInt("total"),
    dueKey: t.string({ nullable: true, resolve: (r) => r.dueKey }),
    tab: t.exposeString("tab"),
    screen: t.exposeString("screen"),
    paramsJson: t.string({ nullable: true, resolve: (r) => r.paramsJson }),
  }),
});

const HubRef = builder.objectRef<ReviewHubResult>("ReviewHub");
HubRef.implement({
  fields: (t) => ({
    rows: t.field({ type: [RowRef], resolve: (h) => h.rows }),
    totalLeft: t.exposeInt("totalLeft"),
  }),
});

builder.queryField("myReviewHub", (t) =>
  t.field({
    type: HubRef,
    description:
      "The caller's review backlog across plans, questions, exam papers, syllabus sign-offs, mastery rounds, " +
      "observations, class videos, class-test question requests, support-book rounds, winter booklets and " +
      "review cards on the work board. Each section appears only when the caller holds that review's permission.",
    authScopes: { authenticated: true },
    resolve: (_root, _args, ctx) => myReviewHub(ctx),
  }),
);
