/**
 * CT question-request resolvers (owner ask 2026-07-20) — the request + review
 * loop in front of the existing class-test print path.
 *
 * RBAC (composes existing perms — nothing new):
 *   createCtQuestionRequest / reviewCtQuestion / requestCtQuestionPrint /
 *   myCtQuestionRequests — tracker:write teacher; create + print re-verify the
 *   section write-scope; review/print are ROW-gated to the requester in the service.
 *   sendCtQuestionForReview / ctQuestionQueue — roster:manage (Principal/Office).
 *   editCtQuestionRequest / cancelCtQuestionRequest — tracker:write teacher, ROW-gated
 *   to the requester in the service; edit re-verifies the section write-scope.
 *   deleteCtQuestionRequest — roster:manage (Principal/Office). OFFICE deliberately
 *   holds no tracker permission (D-#554), so the teacher's verbs and the office's verb
 *   land on different people by construction; the PRINCIPAL holds both.
 * PM: the teacher verbs are `class_test_question:create`, the office's
 * `class_test_question:prepare` (send, queue) / `:delete`; the write scope's role
 * bypass is `class_test:edit_all` (CLASS_TEST_REACH).
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import type { AppContext } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import { assertAnchorWrite, CLASS_TEST_REACH, subjectIdOrNull } from "../classTestAnchor";
import { ClassTestQuestionRequest } from "../models/ClassTestQuestionRequest";
import {
  createCtQuestionRequest,
  sendCtQuestionForReview,
  reviewCtQuestion,
  requestCtQuestionPrint,
  editCtQuestionRequest,
  cancelCtQuestionRequest,
  deleteCtQuestionRequest,
  myCtQuestionRequests,
  ctQuestionQueue,
  myCtQuestionRequestsPage,
  ctQuestionQueuePage,
  ctQuestionCounts,
  type CtQuestionRequestShape,
  type CtQuestionRoundShape,
  type PrintCtQuestionResult,
} from "../services/ClassTestQuestionService";

/** The question-paper office (PM): `class_test_question:prepare` sends drafts and reads
 *  the queue, `class_test_question:delete` soft-deletes a request. */
function assertOffice(
  ctx: AppContext,
  perm: "class_test_question:prepare" | "class_test_question:delete" = "class_test_question:prepare",
): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, perm)) {
    throw new ForbiddenError("প্রশ্ন তৈরি ও পাঠানো অফিস/অধ্যক্ষের কাজ");
  }
}

/**
 * Section write-scope for a question request — the same gate a class test uses, so
 * an ARABIC request (no `Subject` row, no routine grant) is decided by the routine
 * instead of failing with "Subject not found: ARABIC" (owner report 2026-10-11).
 */
async function assertQuestionWrite(ctx: AppContext, sectionId: string, subject: string): Promise<void> {
  await assertAnchorWrite(
    ctx,
    { sectionId, classId: null, subjectGroupId: null, subject },
    () => subjectIdOrNull(subject),
    undefined,
    CLASS_TEST_REACH,
  );
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
    cancelledAt: t.string({ nullable: true, resolve: (r) => r.cancelledAt }),
    cancelReason: t.string({ nullable: true, resolve: (r) => r.cancelReason }),
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
      "Requires class_test_question:create + section write-scope.",
    authScopes: { hasPermission: "class_test_question:create" },
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
      await assertQuestionWrite(ctx, args.sectionId, args.subject);
      return createCtQuestionRequest({ ...args, actorId: ctx.auth.userId as string });
    },
  }),
);

builder.mutationField("sendCtQuestionForReview", (t) =>
  t.field({
    type: CtQuestionRequestRef,
    description:
      "Office uploads the produced paper (classtest_question file) and sends it to the requesting " +
      "teacher for review — one round; repeatable until confirmed. Requires class_test_question:prepare.",
    authScopes: { hasPermission: "class_test_question:prepare" },
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
    authScopes: { hasPermission: "class_test_question:create" },
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
    authScopes: { hasPermission: "class_test_question:create" },
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
      await assertQuestionWrite(ctx, doc.sectionId.toString(), doc.subject as string);
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

builder.mutationField("editCtQuestionRequest", (t) =>
  t.field({
    type: CtQuestionRequestRef,
    description:
      "The requesting teacher corrects a mistake in the details — chapter, total marks, duration " +
      "and exam date. Subject, class/section and the test number are the request's address and " +
      "cannot be moved. Allowed only while the office still owes a paper (REQUESTED / " +
      "CHANGES_REQUESTED); the office is notified that the spec changed. Row-gated to the " +
      "requester; re-verifies the section write-scope.",
    authScopes: { hasPermission: "class_test_question:create" },
    args: {
      id: t.arg.string({ required: true }),
      chapter: t.arg.string({ required: true }),
      totalMarks: t.arg.int({ required: true }),
      durationMinutes: t.arg.int({ required: true }),
      examDate: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const doc = await ClassTestQuestionRequest.findById(args.id).select("sectionId subject").lean();
      if (!doc) throw new Error("অনুরোধটি পাওয়া যায়নি");
      await assertQuestionWrite(ctx, doc.sectionId.toString(), doc.subject as string);
      return editCtQuestionRequest({
        id: args.id,
        chapter: args.chapter,
        totalMarks: args.totalMarks,
        durationMinutes: args.durationMinutes,
        examDate: args.examDate,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("cancelCtQuestionRequest", (t) =>
  t.field({
    type: CtQuestionRequestRef,
    description:
      "The requesting teacher withdraws a request filed by mistake (status CANCELLED). The row " +
      "stays visible on both lists so the office sees the withdrawal rather than a card vanishing. " +
      "Allowed before CONFIRMED only. Row-gated to the requester.",
    authScopes: { hasPermission: "class_test_question:create" },
    args: {
      id: t.arg.string({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return cancelCtQuestionRequest({
        id: args.id,
        reason: args.reason ?? null,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("deleteCtQuestionRequest", (t) =>
  t.field({
    type: "Boolean",
    description:
      "Office/Principal soft-deletes a question request (active:false) — it leaves both lists and " +
      "the requesting teacher is notified. Refused while the request has a live ClassTest hanging " +
      "off it (cancel the print job first). Requires class_test_question:delete.",
    authScopes: { hasPermission: "class_test_question:delete" },
    args: {
      id: t.arg.string({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertOffice(ctx, "class_test_question:delete");
      return deleteCtQuestionRequest({
        id: args.id,
        reason: args.reason ?? null,
        actorId: ctx.auth!.userId as string,
      });
    },
  }),
);

builder.queryField("myCtQuestionRequests", (t) =>
  t.field({
    type: [CtQuestionRequestRef],
    description: "The caller's own question requests — action-needed first. Requires class_test_question:create.",
    authScopes: { hasPermission: "class_test_question:create" },
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
      "Every question request, work-needed first, teacher names joined. Requires class_test_question:prepare.",
    authScopes: { hasPermission: "class_test_question:prepare" },
    resolve: async (_root, _args, ctx) => {
      assertOffice(ctx);
      return ctQuestionQueue();
    },
  }),
);

// D-#761: the two request lists, one page at a time (finished requests pile up
// forever). The unpaged queries above stay for bundles released before paging.
const CtQuestionRequestPageRef = pageRef("CtQuestionRequestPage", CtQuestionRequestRef);

builder.queryField("myCtQuestionRequestsPage", (t) =>
  t.field({
    type: CtQuestionRequestPageRef,
    description: "One page of myCtQuestionRequests (same order). Requires class_test_question:create.",
    authScopes: { hasPermission: "class_test_question:create" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return myCtQuestionRequestsPage(ctx.auth.userId as string, args);
    },
  }),
);

builder.queryField("ctQuestionQueuePage", (t) =>
  t.field({
    type: CtQuestionRequestPageRef,
    description: "One page of ctQuestionQueue (work-needed first). Requires class_test_question:prepare.",
    authScopes: { hasPermission: "class_test_question:prepare" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: async (_root, args, ctx) => {
      assertOffice(ctx);
      return ctQuestionQueuePage(args);
    },
  }),
);

const CtQuestionCountsRef = builder
  .objectRef<{ pending: number; inReview: number }>("CtQuestionCounts")
  .implement({
    description:
      "Class Test sidebar badge counts (owner 2026-07-25): question requests the office still owes " +
      "a paper on (pending) and papers waiting on the teacher (inReview).",
    fields: (t) => ({
      pending: t.exposeInt("pending"),
      inReview: t.exposeInt("inReview"),
    }),
  });

builder.queryField("ctQuestionCounts", (t) =>
  t.field({
    type: CtQuestionCountsRef,
    description:
      "How many class-test question requests are pending (REQUESTED/CHANGES_REQUESTED) and in review " +
      "(IN_REVIEW). class_test_question:prepare holders see the whole pipeline; a requester " +
      "(class_test_question:create) " +
      "sees only their own. Anyone else gets zeros.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const officeWide = callerHasPermission(ctx.auth, "class_test_question:prepare");
      const canRequest = callerHasPermission(ctx.auth, "class_test_question:create");
      if (!officeWide && !canRequest) return { pending: 0, inReview: 0 };
      return ctQuestionCounts(officeWide ? null : (ctx.auth.userId as string));
    },
  }),
);
