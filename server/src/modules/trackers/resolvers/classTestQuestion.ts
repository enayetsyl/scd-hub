/**
 * CT question-request resolvers (owner ask 2026-07-20) — the request + review
 * loop in front of the existing class-test print path.
 *
 * RBAC (composes existing perms — nothing new):
 *   createCtQuestionRequest / reviewCtQuestion / requestCtQuestionPrint /
 *   myCtQuestionRequests — tracker:write teacher; create + print re-verify the
 *   section write-scope; review/print are ROW-gated to the requester in the service.
 *   sendCtQuestionForReview / ctQuestionQueue — roster:manage (Principal/Office).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError, assertCanWrite } from "../../../middleware/authz";
import { Subject } from "../../foundation/models/Subject";
import { ClassTestQuestionRequest } from "../models/ClassTestQuestionRequest";
import {
  createCtQuestionRequest,
  sendCtQuestionForReview,
  reviewCtQuestion,
  requestCtQuestionPrint,
  myCtQuestionRequests,
  ctQuestionQueue,
  type CtQuestionRequestShape,
  type CtQuestionRoundShape,
  type PrintCtQuestionResult,
} from "../services/ClassTestQuestionService";

function assertOffice(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "roster:manage")) {
    throw new ForbiddenError("প্রশ্ন তৈরি ও পাঠানো অফিস/অধ্যক্ষের কাজ");
  }
}

async function resolveSubjectId(subject: string): Promise<string> {
  const doc = await Subject.findOne({ code: subject }).select("_id").lean();
  if (!doc) throw new Error(`Subject not found: ${subject}`);
  return doc._id.toString();
}

const CtQuestionRoundRef = builder.objectRef<CtQuestionRoundShape>("CtQuestionRound");
CtQuestionRoundRef.implement({
  fields: (t) => ({
    fileId: t.exposeString("fileId"),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
    sentBy: t.exposeString("sentBy"),
    sentAt: t.exposeString("sentAt"),
    teacherComment: t.string({ nullable: true, resolve: (r) => r.teacherComment }),
    respondedAt: t.string({ nullable: true, resolve: (r) => r.respondedAt }),
  }),
});

const CtQuestionRequestRef = builder.objectRef<CtQuestionRequestShape>("CtQuestionRequest");
CtQuestionRequestRef.implement({
  description:
    "A subject teacher's request for an office-produced class-test question paper, with the " +
    "office↔teacher review rounds. CONFIRMED locks the paper; PRINT_REQUESTED filed the standard " +
    "ClassTest + print-queue row.",
  fields: (t) => ({
    id: t.exposeString("id"),
    classLevel: t.exposeInt("classLevel"),
    sectionId: t.exposeString("sectionId"),
    subject: t.exposeString("subject"),
    chapter: t.exposeString("chapter"),
    testNumber: t.exposeInt("testNumber"),
    totalMarks: t.exposeInt("totalMarks"),
    durationMinutes: t.exposeInt("durationMinutes"),
    examDate: t.exposeString("examDate"),
    status: t.exposeString("status"),
    rounds: t.field({ type: [CtQuestionRoundRef], resolve: (r) => r.rounds }),
    currentFileId: t.string({ nullable: true, resolve: (r) => r.currentFileId }),
    requestedBy: t.exposeString("requestedBy"),
    requesterName: t.string({ nullable: true, resolve: (r) => r.requesterName }),
    requestedAt: t.exposeString("requestedAt"),
    confirmedAt: t.string({ nullable: true, resolve: (r) => r.confirmedAt }),
    classTestId: t.string({ nullable: true, resolve: (r) => r.classTestId }),
  }),
});

const CtQuestionPrintResultRef = builder.objectRef<PrintCtQuestionResult>("CtQuestionPrintResult");
CtQuestionPrintResultRef.implement({
  fields: (t) => ({
    request: t.field({ type: CtQuestionRequestRef, resolve: (r) => r.request }),
    ctId: t.string({ resolve: (r) => r.classTest.ctId }),
  }),
});

builder.mutationField("createCtQuestionRequest", (t) =>
  t.field({
    type: CtQuestionRequestRef,
    description:
      "A subject teacher asks the office to produce a class-test question paper — class/section, " +
      "subject, chapter, marks, duration and exam date all mandatory; the test number auto-increments. " +
      "Requires tracker:write + section write-scope.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      chapter: t.arg.string({ required: true }),
      totalMarks: t.arg.int({ required: true }),
      durationMinutes: t.arg.int({ required: true }),
      examDate: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId, await resolveSubjectId(args.subject));
      return createCtQuestionRequest({ ...args, actorId: ctx.auth.userId as string });
    },
  }),
);

builder.mutationField("sendCtQuestionForReview", (t) =>
  t.field({
    type: CtQuestionRequestRef,
    description:
      "Office uploads the produced paper (classtest_question file) and sends it to the requesting " +
      "teacher for review — one round; repeatable until confirmed. Requires roster:manage.",
    authScopes: { authenticated: true },
    args: {
      id: t.arg.string({ required: true }),
      fileId: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertOffice(ctx);
      return sendCtQuestionForReview({
        id: args.id,
        fileId: args.fileId,
        note: args.note ?? null,
        actorId: ctx.auth!.userId as string,
      });
    },
  }),
);

builder.mutationField("reviewCtQuestion", (t) =>
  t.field({
    type: CtQuestionRequestRef,
    description:
      "The requesting teacher's verdict on the current round: approve=true locks the paper " +
      "(CONFIRMED); approve=false requires a change comment. Row-gated to the requester.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      id: t.arg.string({ required: true }),
      approve: t.arg.boolean({ required: true }),
      comment: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return reviewCtQuestion({
        id: args.id,
        approve: args.approve,
        comment: args.comment ?? null,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("requestCtQuestionPrint", (t) =>
  t.field({
    type: CtQuestionPrintResultRef,
    description:
      "Send the CONFIRMED paper to print — files the standard ClassTest + print-queue row " +
      "(existing printing/delivery logging unchanged). Row-gated to the requester; re-verifies " +
      "the section write-scope.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      id: t.arg.string({ required: true }),
      colour: t.arg.string({ required: false }),
      sides: t.arg.string({ required: false }),
      copies: t.arg.int({ required: false }),
      copiesMode: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const doc = await ClassTestQuestionRequest.findById(args.id).select("sectionId subject").lean();
      if (!doc) throw new Error("অনুরোধটি পাওয়া যায়নি");
      await assertCanWrite(ctx, doc.sectionId.toString(), await resolveSubjectId(doc.subject as string));
      return requestCtQuestionPrint({
        id: args.id,
        colour: args.colour ?? null,
        sides: args.sides ?? null,
        copies: args.copies ?? null,
        copiesMode: args.copiesMode ?? null,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.queryField("myCtQuestionRequests", (t) =>
  t.field({
    type: [CtQuestionRequestRef],
    description: "The caller's own question requests — action-needed first. Requires tracker:write.",
    authScopes: { hasPermission: "tracker:write" },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return myCtQuestionRequests(ctx.auth.userId as string);
    },
  }),
);

builder.queryField("ctQuestionQueue", (t) =>
  t.field({
    type: [CtQuestionRequestRef],
    description:
      "Every question request, work-needed first, teacher names joined. Requires roster:manage.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      assertOffice(ctx);
      return ctQuestionQueue();
    },
  }),
);
