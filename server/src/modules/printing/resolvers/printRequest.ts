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
import { StoredFile } from "../../platform/models/StoredFile";
import { Class } from "../../foundation/models/Class";
import { classPresenceForDate } from "../../attendance/services/AttendanceReportService";
import { dateKeyOf } from "../../attendance/dates";
import {
  createPrintRequest,
  markPrinted,
  markDelivered,
  cancelPrintRequest,
  printQueue,
  myPrintRequests,
  printRequestById,
  printQueueCounts,
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

/** An attached file, NAMED — the Office must be able to open EVERY file on a job, not
 *  just the first (live-testing find: a teacher attached a PDF + an image and only the
 *  image was reachable). */
interface PrintFileView {
  id: string;
  name: string;
  mime: string;
}

interface PrintRequestView {
  doc: IPrintRequest;
  requesterName: string | null;
  files: PrintFileView[];
  /** D-#294 (CLASS_PRESENT jobs): the resolved copy count for the USE day, or null
   *  while that day's attendance is pending; the class level for display. */
  effectiveCopies: number | null;
  copiesPending: boolean;
  copiesClassLevel: number | null;
}

const PrintFileRef = builder.objectRef<PrintFileView>("PrintFile");
PrintFileRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    mime: t.exposeString("mime"),
  }),
});

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
    /** Every attached file, named — the Office opens each one individually. */
    files: t.field({ type: [PrintFileRef], resolve: (v) => v.files }),
    linkUrl: t.string({ nullable: true, resolve: (v) => v.doc.linkUrl ?? null }),
    colour: t.string({ resolve: (v) => v.doc.colour }),
    sides: t.string({ resolve: (v) => v.doc.sides }),
    copies: t.int({ resolve: (v) => v.doc.copies }),
    copiesMode: t.string({ resolve: (v) => v.doc.copiesMode ?? "FIXED" }),
    copiesClassId: t.string({ nullable: true, resolve: (v) => v.doc.copiesClassId?.toString() ?? null }),
    copiesClassLevel: t.int({ nullable: true, resolve: (v) => v.copiesClassLevel }),
    /** Resolved count for CLASS_PRESENT jobs (use-day attendance); equals `copies` otherwise. */
    effectiveCopies: t.int({ nullable: true, resolve: (v) => v.effectiveCopies }),
    /** True while the use day's attendance is pending — the Office may print with a manual count. */
    copiesPending: t.boolean({ resolve: (v) => v.copiesPending }),
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

/** Attach requester + file names in ONE batched load each — the queue is a list view.
 *  D-#294: CLASS_PRESENT rows additionally resolve their copy count from the USE day's
 *  attendance — one `classPresenceForDate` call per DISTINCT use day in the list. */
async function decorate(docs: IPrintRequest[]): Promise<PrintRequestView[]> {
  if (docs.length === 0) return [];
  const ids = [...new Set(docs.map((d) => d.requestedBy.toString()))];
  const users = await User.find({ _id: { $in: ids } }).select("name").lean();
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name]));

  const fileIds = [...new Set(docs.flatMap((d) => (d.fileIds ?? []).map((f) => f.toString())))];
  const files = fileIds.length
    ? await StoredFile.find({ _id: { $in: fileIds } }).select("originalName mime").lean()
    : [];
  const fileById = new Map(files.map((f) => [f._id.toString(), f]));

  // D-#294: per-class-present copy resolution, batched per distinct use day.
  const cpDocs = docs.filter((d) => d.copiesMode === "CLASS_PRESENT");
  const classIds = [...new Set(cpDocs.map((d) => d.copiesClassId?.toString()).filter(Boolean))] as string[];
  const classes = classIds.length
    ? await Class.find({ _id: { $in: classIds } }).select("level").lean()
    : [];
  const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level]));
  const todayKey = dateKeyOf(new Date());
  const useKeys = [
    ...new Set(
      cpDocs
        .filter((d) => d.status === "REQUESTED" && d.neededByKey && d.neededByKey <= todayKey)
        .map((d) => d.neededByKey!),
    ),
  ];
  const presenceByDay = new Map(
    await Promise.all(
      useKeys.map(async (key) => [key, await classPresenceForDate(key)] as const),
    ),
  );

  return docs.map((doc) => {
    let effectiveCopies: number | null = doc.copies;
    let copiesPending = false;
    if (doc.copiesMode === "CLASS_PRESENT" && doc.status === "REQUESTED") {
      const presence = doc.neededByKey ? presenceByDay.get(doc.neededByKey) : undefined;
      const row = presence?.find((p) => p.classId === doc.copiesClassId?.toString());
      if (row && row.complete) {
        effectiveCopies = row.presentCount;
      } else {
        effectiveCopies = null;
        copiesPending = true; // future use day, or attendance not (fully) marked yet
      }
    }
    return {
      doc,
      requesterName: nameById.get(doc.requestedBy.toString()) ?? null,
      files: (doc.fileIds ?? []).map((f) => {
        const id = f.toString();
        const found = fileById.get(id);
        // A vanished file still lists, so the Office sees the job is incomplete.
        return { id, name: found?.originalName ?? "file", mime: found?.mime ?? "" };
      }),
      effectiveCopies,
      copiesPending,
      copiesClassLevel: doc.copiesClassId ? (levelOf.get(doc.copiesClassId.toString()) ?? null) : null,
    };
  });
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
      // MANDATORY on a teacher's request (live-testing requirement) — the Office cannot
      // start a job without knowing how to print it, how many, and by when.
      colour: t.arg.string({ required: true }),
      sides: t.arg.string({ required: true }),
      copies: t.arg.int({ required: true }),
      // D-#294: FIXED (default) | CLASS_PRESENT (+ the class whose present count prints).
      copiesMode: t.arg.string({ required: false }),
      copiesClassId: t.arg.string({ required: false }),
      neededByKey: t.arg.string({ required: true }),
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
    description:
      "REQUESTED → PRINTED. Office/Principal (roster:manage). Audited. For a CLASS_PRESENT " +
      "job the count finalizes from the use day's attendance — or from `copies` (manual) " +
      "while that attendance is pending (D-#294).",
    authScopes: { authenticated: true },
    args: {
      id: t.arg.string({ required: true }),
      /** Manual count for a CLASS_PRESENT job whose use-day attendance is pending. */
      copies: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertPrintAdmin(ctx);
      return decorateOne(await markPrinted(args.id, ctx.auth!.userId, args.copies));
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

const PrintQueueCountsRef = builder
  .objectRef<{ requested: number; printed: number }>("PrintQueueCounts")
  .implement({
    description: "Sidebar badge counts (D-#294): jobs awaiting printing / awaiting delivery.",
    fields: (t) => ({
      requested: t.exposeInt("requested"),
      printed: t.exposeInt("printed"),
    }),
  });

builder.queryField("printQueueCounts", (t) =>
  t.field({
    type: PrintQueueCountsRef,
    description: "How many jobs await printing (REQUESTED) and delivery (PRINTED). roster:manage.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      assertPrintAdmin(ctx);
      return printQueueCounts();
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
