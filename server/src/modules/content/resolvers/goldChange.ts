/**
 * Gold-change resolvers (RF-2, owner 25 Nov 2026) — change after the Principal finalised an item.
 *
 *   requestGoldChange      (mutation) — the reviewer who reviewed it. Plans: plan_review:review,
 *                          questions: question_review:review. The gold item is not touched.
 *   decideGoldChange       (mutation) — the Principal. Plans: plan_review:approve, questions:
 *                          question_review:publish. Approve = the item leaves gold (back to draft).
 *   goldChangeRequests     (query)    — the Principal's section (only the kinds the caller may decide).
 *   myGoldChangeRequests   (query)    — the reviewer's own requests, so she reads "বাতিল" + the note.
 * The permission is per doc type, so it is checked inside the service (with `can`), not by authScopes.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import type { Permission } from "@scd/shared";
import {
  requestGoldChange as requestSvc,
  decideGoldChange as decideSvc,
  listGoldChangeRequests as listSvc,
  listMyGoldChangeRequests as listMineSvc,
  type GoldChangeRequestDTO,
} from "../services/GoldChangeService";
import { mapReviewError } from "./review";

const GoldChangeRequestRef = builder.objectRef<GoldChangeRequestDTO>("GoldChangeRequest");
GoldChangeRequestRef.implement({
  description:
    "RF-2: a reviewer's request to change a finalised (gold) plan or question. Carries the item " +
    "(title / question text + payload) so the decision card shows the comment and the item together.",
  fields: (t) => ({
    id: t.exposeString("id"),
    artifactId: t.exposeString("artifactId"),
    docType: t.exposeString("docType"),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    anchorWord: t.exposeString("anchorWord"),
    addressNumber: t.exposeString("addressNumber"),
    qid: t.string({ nullable: true, resolve: (r) => r.qid }),
    sessionIndex: t.int({ nullable: true, resolve: (r) => r.sessionIndex }),
    reviewerId: t.exposeString("reviewerId"),
    reviewerName: t.string({ nullable: true, resolve: (r) => r.reviewerName }),
    comment: t.exposeString("comment"),
    proposalJson: t.string({ nullable: true, resolve: (r) => r.proposalJson }),
    status: t.exposeString("status"),
    decidedByName: t.string({ nullable: true, resolve: (r) => r.decidedByName }),
    decidedAt: t.string({ nullable: true, resolve: (r) => r.decidedAt }),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
    createdAt: t.exposeString("createdAt"),
    title: t.string({ nullable: true, resolve: (r) => r.title }),
    questionText: t.string({ nullable: true, resolve: (r) => r.questionText }),
    payloadJson: t.string({ nullable: true, resolve: (r) => r.payloadJson }),
    artifactReviewStatus: t.string({ nullable: true, resolve: (r) => r.artifactReviewStatus }),
  }),
});

builder.mutationField("requestGoldChange", (t) =>
  t.field({
    type: GoldChangeRequestRef,
    description:
      "Ask the Principal to change a finalised (gold) plan/question you reviewed. `comment` is mandatory; " +
      "`proposal` (questions only) is an optional corrected text/answer. The gold item is not touched. " +
      "Requires plan_review:review (plans) / question_review:review (questions).",
    authScopes: { authenticated: true },
    args: {
      artifactId: t.arg.string({ required: true }),
      comment: t.arg.string({ required: true }),
      proposal: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const auth = ctx.auth;
      try {
        return await requestSvc({
          artifactId: args.artifactId,
          reviewerId: auth.userId,
          comment: args.comment,
          proposal: args.proposal,
          can: (p: Permission) => callerHasPermission(auth, p),
          actorRole: auth.role,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

builder.mutationField("decideGoldChange", (t) =>
  t.field({
    type: GoldChangeRequestRef,
    description:
      "Approve or reject a gold-change request. Approve: the item leaves gold (back to draft) and the " +
      "reviewer's comment becomes its change request. Reject: nothing changes; `note` is shown to the " +
      "reviewer. Requires plan_review:approve (plans) / question_review:publish (questions).",
    authScopes: { authenticated: true },
    args: {
      requestId: t.arg.string({ required: true }),
      approve: t.arg.boolean({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const auth = ctx.auth;
      try {
        return await decideSvc({
          requestId: args.requestId,
          approve: args.approve,
          note: args.note,
          actorId: auth.userId,
          actorRole: auth.role,
          can: (p: Permission) => callerHasPermission(auth, p),
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

builder.queryField("goldChangeRequests", (t) =>
  t.field({
    type: [GoldChangeRequestRef],
    description:
      "The Principal's gold-change requests (default OPEN; also APPROVED / REJECTED), newest first - only " +
      "the kinds the caller may decide. Requires plan_review:approve or question_review:publish.",
    authScopes: { authenticated: true },
    args: { status: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const auth = ctx.auth;
      try {
        return await listSvc({ status: args.status, can: (p: Permission) => callerHasPermission(auth, p) });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

builder.queryField("myGoldChangeRequests", (t) =>
  t.field({
    type: [GoldChangeRequestRef],
    description:
      "The caller's own gold-change requests, newest first - so a reviewer can read the Principal's " +
      "decision and note. Requires plan_review:review or question_review:review.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const auth = ctx.auth;
      if (!callerHasPermission(auth, "plan_review:review") && !callerHasPermission(auth, "question_review:review")) {
        throw new ForbiddenError();
      }
      return listMineSvc(auth.userId);
    },
  }),
);
