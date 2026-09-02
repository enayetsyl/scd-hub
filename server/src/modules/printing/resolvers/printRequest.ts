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
import { Section } from "../../foundation/models/Section";
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
  printHistory,
  reprintPrintRequest,
  tagPrintRequests,
  suggestTagFor,
  type PrintHistoryRow,
  type PrintTagSuggestion,
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
  /** D-#362: the level of the job's OWN class (`classId`) — the history sorts by it. */
  classLevel: number | null;
  /** D-#459: the job's section label, for display next to classLevel. */
  sectionNameBn: string | null;
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
    // D-#362: the job's own class/section, so the history can group and label by class.
    classId: t.string({ nullable: true, resolve: (v) => v.doc.classId?.toString() ?? null }),
    classLevel: t.int({ nullable: true, resolve: (v) => v.classLevel }),
    sectionId: t.string({ nullable: true, resolve: (v) => v.doc.sectionId?.toString() ?? null }),
    sectionNameBn: t.string({ nullable: true, resolve: (v) => v.sectionNameBn }),
    subject: t.string({ nullable: true, resolve: (v) => v.doc.subject ?? null }),
    /** PQ-5: the class test this job prints the paper for, when it has one. The queue
     *  warns before cancelling such a job — cancelling it RETIRES the exam too, which
     *  takes mark entry away from the teacher (D-#627). */
    classTestId: t.string({ nullable: true, resolve: (v) => v.doc.classTestId?.toString() ?? null }),
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
  // The class lookup covers BOTH `copiesClassId` (the count's class) and `classId` (the
  // job's own class, which the D-#362 history labels and sorts by) in one query.
  const cpDocs = docs.filter((d) => d.copiesMode === "CLASS_PRESENT");
  const classIds = [
    ...new Set(
      [
        ...cpDocs.map((d) => d.copiesClassId?.toString()),
        ...docs.map((d) => d.classId?.toString()),
      ].filter(Boolean),
    ),
  ] as string[];
  const classes = classIds.length
    ? await Class.find({ _id: { $in: classIds } }).select("level").lean()
    : [];
  const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level]));

  // D-#459: section labels, batched — only the jobs that carry one (mostly ASSIGNMENT).
  const sectionIds = [...new Set(docs.map((d) => d.sectionId?.toString()).filter(Boolean))] as string[];
  const sections = sectionIds.length
    ? await Section.find({ _id: { $in: sectionIds } }).select("nameBn").lean()
    : [];
  const sectionNameById = new Map(sections.map((s) => [s._id.toString(), s.nameBn]));

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
      classLevel: doc.classId ? (levelOf.get(doc.classId.toString()) ?? null) : null,
      sectionNameBn: doc.sectionId ? (sectionNameById.get(doc.sectionId.toString()) ?? null) : null,
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

interface PrintQueuePageView {
  items: PrintRequestView[];
  total: number;
  hasMore: boolean;
}

const PrintQueuePageRef = builder.objectRef<PrintQueuePageView>("PrintQueuePage");
PrintQueuePageRef.implement({
  description:
    "One page of a print-queue bucket (D-#461). `total` counts the whole bucket, not the page, " +
    "so the pager can show a range; `hasMore` is true while later pages remain.",
  fields: (t) => ({
    items: t.field({ type: [PrintRequestRef], resolve: (r) => r.items }),
    total: t.exposeInt("total"),
    hasMore: t.exposeBoolean("hasMore"),
  }),
});

builder.queryField("printQueue", (t) =>
  t.field({
    type: PrintQueuePageRef,
    description:
      "One paginated bucket of the Office print queue: REQUESTED (yet to print), PRINTED " +
      "(printing done), DELIVERED, CANCELLED. The two ACTIVE buckets stay oldest-first (the " +
      "order the Office works them); the two TERMINAL buckets are newest-first history " +
      "(D-#461). Requires roster:manage.",
    authScopes: { authenticated: true },
    args: {
      status: t.arg.string({ required: true }),
      limit: t.arg.int({ required: false }),
      offset: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertPrintAdmin(ctx);
      const page = await printQueue(args.status, args.limit ?? undefined, args.offset ?? undefined);
      return { items: await decorate(page.items), total: page.total, hasMore: page.hasMore };
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

// ---------------------------------------------------------------------------
// D-#362 — reprint history
// ---------------------------------------------------------------------------

interface PrintHistoryRowView {
  row: PrintHistoryRow;
  latest: PrintRequestView;
  requesterNames: string[];
  /** PQ-9: what the job's own file/title names suggest, for an untagged row only. */
  suggestion: (PrintTagSuggestion & { classId: string | null }) | null;
}

interface PrintHistoryPageView {
  rows: PrintHistoryRowView[];
  scannedCapped: boolean;
  truncated: boolean;
  totalRows: number;
}

const PrintHistoryRowRef = builder.objectRef<PrintHistoryRowView>("PrintHistoryRow");
PrintHistoryRowRef.implement({
  description:
    "One already-printed DOCUMENT in the reprint history (D-#362) — repeats of the same source for the " +
    "same class/subject/purpose collapse into a single row. `latest` is the job a reprint clones.",
  fields: (t) => ({
    key: t.string({ resolve: (v) => v.row.key }),
    /** The most recent print of this document — the reprint source. */
    latest: t.field({ type: PrintRequestRef, resolve: (v) => v.latest }),
    /** How many times it has already been printed. */
    printCount: t.int({ resolve: (v) => v.row.printCount }),
    lastPrintedAt: t.string({ resolve: (v) => v.row.lastPrintedAt.toISOString() }),
    firstPrintedAt: t.string({ resolve: (v) => v.row.firstPrintedAt.toISOString() }),
    /** Everyone who has printed it (Office view); a teacher only ever sees themselves. */
    requesterNames: t.stringList({ resolve: (v) => v.requesterNames }),
    /** PQ-7: the same requesters as ids, index-aligned with `requesterNames`, so the
     *  Office can filter the history by teacher (two staff may share a name). */
    requesterIds: t.stringList({ resolve: (v) => v.row.requesterIds }),
    /** PQ-8: the class this row is FOR — the job's own `classId`, else the class its copy
     *  count follows (`copiesClassId`). Distinct from `latest.classId`, which stays the
     *  job's own field; browse the history by THIS one. Null = names no class either way. */
    classId: t.string({ nullable: true, resolve: (v) => v.row.classId }),
    classLevel: t.int({ nullable: true, resolve: (v) => v.row.classLevel }),
    /** PQ-9: every job behind this row — what `tagPrintRequests` is called with, so the
     *  whole document is tagged rather than just the print that represents it. */
    jobIds: t.stringList({ resolve: (v) => v.row.jobIds }),
    /** PQ-9: the class/subject the job's own file name or title suggests, present ONLY on
     *  a row that names no class. A pre-fill for the tag control, never applied by itself. */
    suggestedClassId: t.string({ nullable: true, resolve: (v) => v.suggestion?.classId ?? null }),
    suggestedClassLevel: t.int({ nullable: true, resolve: (v) => v.suggestion?.classLevel ?? null }),
    suggestedSubject: t.string({ nullable: true, resolve: (v) => v.suggestion?.subject ?? null }),
    /** The text the suggestion was read out of, so the person confirming can judge it. */
    suggestionEvidence: t.string({ nullable: true, resolve: (v) => v.suggestion?.evidence ?? null }),
  }),
});

const PrintHistoryPageRef = builder
  .objectRef<PrintHistoryPageView>("PrintHistoryPage")
  .implement({
    description: "A page of the reprint history (D-#362).",
    fields: (t) => ({
      rows: t.field({ type: [PrintHistoryRowRef], resolve: (v) => v.rows }),
      /** True when the scan cap was reached, so prints older than the window may be missing. */
      scannedCapped: t.boolean({ resolve: (v) => v.scannedCapped }),
      /** PQ-7: true when more documents matched than were returned — never truncate silently. */
      truncated: t.boolean({ resolve: (v) => v.truncated }),
      /** How many documents matched the filters before the page limit. */
      totalRows: t.int({ resolve: (v) => v.totalRows }),
    }),
  });

builder.queryField("printHistory", (t) =>
  t.field({
    type: PrintHistoryPageRef,
    description:
      "Already-printed jobs (PRINTED + DELIVERED), collapsed to ONE ROW PER DOCUMENT and ordered by " +
      "class → subject → purpose → newest print (D-#362). Filter by class / subject / purpose, by " +
      "requester and by printed-on window (PQ-7). " +
      "The Office/Principal (roster:manage) see every requester's prints; a teacher (tracker:write) " +
      "sees only their own — enforced server-side, not by an argument.",
    authScopes: { authenticated: true },
    args: {
      /** PQ-8: the EFFECTIVE class — matches a job's own `classId`, or `copiesClassId` on
       *  a job that names no class of its own. */
      classId: t.arg.string({ required: false }),
      /** PQ-8: only jobs that name no class either way. */
      noClass: t.arg.boolean({ required: false }),
      subject: t.arg.string({ required: false }),
      purpose: t.arg.string({ required: false }),
      /** PQ-7: narrow to one requester. Office only — for a teacher the scope is already
       *  their own, so the argument is ignored rather than allowed to widen it. */
      requestedBy: t.arg.string({ required: false }),
      /** PQ-7: inclusive printed-on window, `YYYY-MM-DD`. */
      fromKey: t.arg.string({ required: false }),
      toKey: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const office = isOffice(ctx);
      if (!office && !callerHasPermission(ctx.auth, "tracker:write")) {
        throw new ForbiddenError("Not allowed to read the print history");
      }
      const page = await printHistory({
        classId: args.classId,
        noClass: args.noClass,
        subject: args.subject,
        purpose: args.purpose,
        // Own-row scope for a teacher: the caller cannot widen it. The Office may narrow.
        requestedBy: office ? args.requestedBy ?? null : ctx.auth.userId,
        fromKey: args.fromKey,
        toKey: args.toKey,
        limit: args.limit,
      });
      const decorated = await decorate(page.rows.map((r) => r.latest));
      const names = await requesterNamesFor(page.rows);
      // PQ-9: a level→class map for the suggestions, fetched once and only when some row
      // actually needs one (a fully tagged page pays nothing).
      const needsSuggestion = page.rows.some((r) => r.classId === null);
      const classByLevel = needsSuggestion ? await activeClassByLevel() : new Map<number, string>();
      return {
        rows: page.rows.map((row, i) => ({
          row,
          latest: decorated[i],
          requesterNames: row.requesterIds.map((id) => names.get(id) ?? "—"),
          // Only an untagged row gets a suggestion — on a tagged one it would invite
          // re-tagging a class somebody already established.
          suggestion:
            row.classId === null
              ? suggestionFor(decorated[i], classByLevel)
              : null,
        })),
        scannedCapped: page.scannedCapped,
        truncated: page.truncated,
        totalRows: page.totalRows,
      };
    },
  }),
);

/** Roster class per LEVEL, for turning a suggested level into a real class id (PQ-9).
 *  Only ACTIVE classes: a suggestion must not point at a retired year's class. */
async function activeClassByLevel(): Promise<Map<number, string>> {
  const classes = await Class.find({ active: true }).select("level").lean();
  const out = new Map<number, string>();
  // First one wins per level; the roster has exactly one class per level today, and a
  // duplicate must not make the suggestion depend on document order silently.
  for (const c of classes) if (!out.has(c.level)) out.set(c.level, c._id.toString());
  return out;
}

/** The suggestion for one row: read the job's own file names + title, then resolve the
 *  level to a class. A level with no matching class yields a suggestion with no id — the
 *  evidence is still worth showing. */
function suggestionFor(
  view: PrintRequestView,
  classByLevel: Map<number, string>,
): PrintTagSuggestion & { classId: string | null } {
  const s = suggestTagFor({ title: view.doc.title, fileNames: view.files.map((f) => f.name) });
  return { ...s, classId: s.classLevel === null ? null : classByLevel.get(s.classLevel) ?? null };
}

/** Names for every requester across the page's groups, in one query. */
async function requesterNamesFor(rows: PrintHistoryRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((r) => r.requesterIds))];
  if (ids.length === 0) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select("name").lean();
  return new Map(users.map((u) => [u._id.toString(), u.name]));
}

builder.mutationField("tagPrintRequests", (t) =>
  t.field({
    type: [PrintRequestRef],
    description:
      "Name the class/subject a historical print job was FOR (PQ-9, D-#392). Pass EVERY job behind a " +
      "history row (`PrintHistoryRow.jobIds`) — the row stands for the document, so tagging one print " +
      "would split it. Omit an argument to leave that field alone; pass null to clear it. The Office " +
      "(roster:manage) may tag any job, a teacher only their own; a class-test job is refused outright " +
      "because its class belongs to the exam record. Audited with both the old and the new value.",
    authScopes: { authenticated: true },
    args: {
      ids: t.arg.stringList({ required: true }),
      /** Omitted = leave; null = clear; an id = set. Validated against the roster. */
      classId: t.arg.string({ required: false }),
      /** D-#459: omitted = leave; null = clear; an id = set. Requires `classId` set in the
       *  SAME call, and must belong to it. */
      sectionId: t.arg.string({ required: false }),
      /** Omitted = leave; null = clear; a `ROUTINE_SUBJECTS` code = set. */
      subject: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const office = isOffice(ctx);
      if (!office && !callerHasPermission(ctx.auth, "tracker:write")) {
        throw new ForbiddenError("Not allowed to tag a print request");
      }
      const docs = await tagPrintRequests({
        ids: args.ids,
        // An omitted GraphQL argument is absent from `args`, an explicit null is null —
        // that distinction IS the leave/clear signal, so it is passed through untouched.
        classId: args.classId === undefined ? undefined : args.classId,
        sectionId: args.sectionId === undefined ? undefined : args.sectionId,
        subject: args.subject === undefined ? undefined : args.subject,
        actorId: ctx.auth.userId,
        isOffice: office,
      });
      return decorate(docs);
    },
  }),
);

builder.mutationField("reprintPrintRequest", (t) =>
  t.field({
    type: PrintRequestRef,
    description:
      "Re-queue an already-printed job WITHOUT re-uploading its file (D-#362): clones the original's " +
      "source, print settings and class/subject/purpose into a new REQUESTED job for `neededByKey`. " +
      "The original's requester (own-row) or the Office/Principal may reprint. A linked class test is " +
      "deliberately NOT re-linked — the exam record keeps its own lifecycle. Audited; the queue is notified.",
    authScopes: { authenticated: true },
    args: {
      id: t.arg.string({ required: true }),
      /** The date the reprint will be USED — a reprint is always for a new day. */
      neededByKey: t.arg.string({ required: true }),
      copies: t.arg.int({ required: false }),
      /** D-#294: keeps the original's mode when omitted. Pass FIXED to reprint a
       *  per-class-present job as a plain typed count — then `copies` is honoured. */
      copiesMode: t.arg.string({ required: false }),
      notes: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const office = isOffice(ctx);
      if (!office && !callerHasPermission(ctx.auth, "tracker:write")) {
        throw new ForbiddenError("Not allowed to file a print request");
      }
      const doc = await reprintPrintRequest({
        sourceRequestId: args.id,
        neededByKey: args.neededByKey,
        copies: args.copies,
        copiesMode: args.copiesMode,
        notes: args.notes,
        actorId: ctx.auth.userId,
        isOffice: office,
      });
      return decorateOne(doc);
    },
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
