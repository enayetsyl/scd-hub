/**
 * Print-request resolvers (PQ-1, D-#281).
 *
 * RBAC — NO new permission (D-#281), exactly the gates the class-test print flow
 * already uses:
 *   tracker:write  (TEACHER) — file a request; cancel your OWN while REQUESTED.
 *   roster:manage  (Office/Principal) — work the queue: mark printed, mark
 *                  delivered, cancel any REQUESTED job, read every bucket.
 * A teacher reads only their own requests. All identity-plane; no corpus path.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { User } from "../../foundation/models/User";
import {
  createPrintRequest,
  markPrinted,
  markDelivered,
  cancelPrintRequest,
  printQueue,
  myPrintRequests,
  printRequestById,
} from "../services/PrintRequestService";
import type { IPrintRequest } from "../models/PrintRequest";

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/** Office / Principal — the print operator. Same lever as `assertPrintAdmin` in CT-1. */
function assertPrintAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "roster:manage")) {
    throw new ForbiddenError("ছাপানো/ডেলিভারি অফিস বা অধ্যক্ষের কাজ");
  }
}

const isOffice = (ctx: AppContext): boolean =>
  ctx.auth !== null && callerHasPermission(ctx.auth, "roster:manage");

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

interface PrintRequestView {
  doc: IPrintRequest;
  requesterName: string | null;
}

const PrintRequestRef = builder.objectRef<PrintRequestView>("PrintRequest");
PrintRequestRef.implement({
  description:
    "One job in the Office print queue (D-#281). `sourceType` selects exactly one of " +
    "setId / contentArtifactId / fileIds / linkUrl. Statuses: REQUESTED → PRINTED → DELIVERED (+ CANCELLED).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.doc._id.toString() }),
    title: t.string({ resolve: (v) => v.doc.title }),
    purpose: t.string({ resolve: (v) => v.doc.purpose }),
    sourceType: t.string({ resolve: (v) => v.doc.sourceType }),
    setId: t.string({ nullable: true, resolve: (v) => v.doc.setId?.toString() ?? null }),
    contentArtifactId: t.string({
      nullable: true,
      resolve: (v) => v.doc.contentArtifactId?.toString() ?? null,
    }),
    fileIds: t.stringList({ resolve: (v) => (v.doc.fileIds ?? []).map((f) => f.toString()) }),
    linkUrl: t.string({ nullable: true, resolve: (v) => v.doc.linkUrl ?? null }),
    copies: t.int({ resolve: (v) => v.doc.copies }),
    neededByKey: t.string({ nullable: true, resolve: (v) => v.doc.neededByKey ?? null }),
    subject: t.string({ nullable: true, resolve: (v) => v.doc.subject ?? null }),
    notes: t.string({ nullable: true, resolve: (v) => v.doc.notes ?? null }),
    status: t.string({ resolve: (v) => v.doc.status }),
    requestedBy: t.string({ resolve: (v) => v.doc.requestedBy.toString() }),
    requesterName: t.string({ nullable: true, resolve: (v) => v.requesterName }),
    requestedAt: t.string({ resolve: (v) => new Date(v.doc.requestedAt).toISOString() }),
    printedAt: t.string({ nullable: true, resolve: (v) => (v.doc.printedAt ? new Date(v.doc.printedAt).toISOString() : null) }),
    deliveredAt: t.string({
      nullable: true,
      resolve: (v) => (v.doc.deliveredAt ? new Date(v.doc.deliveredAt).toISOString() : null),
    }),
    cancelReason: t.string({ nullable: true, resolve: (v) => v.doc.cancelReason ?? null }),
  }),
});

/** Attach requester names in ONE batched load — the queue is a list view. */
async function decorate(docs: IPrintRequest[]): Promise<PrintRequestView[]> {
  if (docs.length === 0) return [];
  const ids = [...new Set(docs.map((d) => d.requestedBy.toString()))];
  const users = await User.find({ _id: { $in: ids } }).select("name").lean();
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name]));
  return docs.map((doc) => ({ doc, requesterName: nameById.get(doc.requestedBy.toString()) ?? null }));
}

const decorateOne = async (doc: IPrintRequest): Promise<PrintRequestView> => (await decorate([doc]))[0];

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("createPrintRequest", (t) =>
  t.field({
    type: PrintRequestRef,
    description:
      "File a print request (PQ-1). Exactly one source: setId | contentArtifactId | fileIds | linkUrl. " +
      "Born REQUESTED, audited. Requires tracker:write.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      title: t.arg.string({ required: true }),
      purpose: t.arg.string({ required: true }),
      sourceType: t.arg.string({ required: true }),
      setId: t.arg.string({ required: false }),
      contentArtifactId: t.arg.string({ required: false }),
      fileIds: t.arg.stringList({ required: false }),
      linkUrl: t.arg.string({ required: false }),
      copies: t.arg.int({ required: false }),
      neededByKey: t.arg.string({ required: false }),
      classId: t.arg.string({ required: false }),
      sectionId: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      notes: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const doc = await createPrintRequest({ ...args, requestedBy: ctx.auth!.userId });
      return decorateOne(doc);
    },
  }),
);

builder.mutationField("markPrintRequestPrinted", (t) =>
  t.field({
    type: PrintRequestRef,
    description: "REQUESTED → PRINTED. Office/Principal (roster:manage). Audited.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertPrintAdmin(ctx);
      return decorateOne(await markPrinted(args.id, ctx.auth!.userId));
    },
  }),
);

builder.mutationField("markPrintRequestDelivered", (t) =>
  t.field({
    type: PrintRequestRef,
    description:
      "PRINTED → DELIVERED — the Office handed the job back to the requesting teacher. " +
      "Office/Principal (roster:manage). Audited; the requester is notified (PQ-5).",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertPrintAdmin(ctx);
      return decorateOne(await markDelivered(args.id, ctx.auth!.userId));
    },
  }),
);

builder.mutationField("cancelPrintRequest", (t) =>
  t.field({
    type: PrintRequestRef,
    description:
      "Withdraw a REQUESTED job — the requester may cancel their own, the Office may cancel any. " +
      "A PRINTED job cannot be cancelled (the paper exists). Audited.",
    authScopes: { authenticated: true },
    args: {
      id: t.arg.string({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const office = isOffice(ctx);
      if (!office && !callerHasPermission(ctx.auth, "tracker:write")) {
        throw new ForbiddenError("Not allowed to cancel a print request");
      }
      const doc = await cancelPrintRequest(args.id, ctx.auth.userId, { isOffice: office, reason: args.reason });
      return decorateOne(doc);
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("printQueue", (t) =>
  t.field({
    type: [PrintRequestRef],
    description:
      "One bucket of the Office print queue, oldest request first: REQUESTED (yet to print), " +
      "PRINTED (printing done), DELIVERED, CANCELLED. Requires roster:manage.",
    authScopes: { authenticated: true },
    args: {
      status: t.arg.string({ required: true }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertPrintAdmin(ctx);
      return decorate(await printQueue(args.status, args.limit ?? 100));
    },
  }),
);

builder.queryField("myPrintRequests", (t) =>
  t.field({
    type: [PrintRequestRef],
    description: "The caller's own print requests, newest first. Requires tracker:write.",
    authScopes: { hasPermission: "tracker:write" },
    args: { limit: t.arg.int({ required: false }) },
    resolve: async (_root, args, ctx) => decorate(await myPrintRequests(ctx.auth!.userId, args.limit ?? 50)),
  }),
);

builder.queryField("printRequest", (t) =>
  t.field({
    type: PrintRequestRef,
    nullable: true,
    description: "One print request — its requester, or the Office.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const doc = await printRequestById(args.id);
      if (!doc) return null;
      if (!isOffice(ctx) && doc.requestedBy.toString() !== ctx.auth.userId) {
        throw new ForbiddenError("Not your print request");
      }
      return decorateOne(doc);
    },
  }),
);
