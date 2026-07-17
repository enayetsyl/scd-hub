/**
 * Tracker module resolvers — open / record / close + list / summary (J4.1–J4.5).
 *
 * Mutations (all enforce write-scope via assertCanWrite):
 *   openTracker   — J4.1/J4.3 creates an open TrackerRecord keyed to a set+section
 *   recordEntry   — J4.1/J4.3 upserts one student entry; emits tracker_recorded event
 *   closeTracker  — J4.1/J4.3 seals the record
 *
 * Queries:
 *   tracker        — single record; read-scope enforced
 *   trackers       — list for a section; optional kind/setId/status filter
 *   trackerSummary — aggregate stats (totalEntries, submittedCount, completeCount, avgScore)
 *
 * waLink query: pure function, no DB; builds wa.me deep link (J4.2, ADR-003).
 *
 * Write-scope rule (J4.5 = J3.5): assertCanWrite requires teaching or proxy grant.
 * Supervisory-only → ForbiddenError.
 */
import { builder } from "../../../schema";
import {
  openTracker as openTrackerSvc,
  recordEntry as recordEntrySvc,
  recordEntries as recordEntriesSvc,
  closeTracker as closeTrackerSvc,
  listTrackers,
  getTrackerSummary,
  buildNonSubmitterLink,
} from "../services/TrackerService";
import { AssessmentSet } from "../../assessment/models/AssessmentSet";
import { TrackerRecord } from "../models/TrackerRecord";
import { assertCanWrite, assertCanRead, ForbiddenError } from "../../../middleware/authz";
import type { Types, FlattenMaps } from "mongoose";
import type { ITrackerRecord, TrackerEntry } from "../models/TrackerRecord";

type LeanTracker = FlattenMaps<ITrackerRecord> & { _id: Types.ObjectId };

// ---------------------------------------------------------------------------
// Shape types for Pothos
// ---------------------------------------------------------------------------

interface TrackerEntryShape {
  pseudoStudentId: string;
  score: number | null;
  submitted: boolean | null;
  complete: boolean | null;
}

const TrackerEntryRef = builder.objectRef<TrackerEntryShape>("TrackerEntry");
TrackerEntryRef.implement({
  fields: (t) => ({
    pseudoStudentId: t.exposeString("pseudoStudentId"),
    score: t.float({ nullable: true, resolve: (e) => e.score ?? null }),
    submitted: t.boolean({ nullable: true, resolve: (e) => e.submitted ?? null }),
    complete: t.boolean({ nullable: true, resolve: (e) => e.complete ?? null }),
  }),
});

interface TrackerRecordShape {
  _id: Types.ObjectId;
  id: string;
  trackerKind: string;
  setId: string;
  sectionId: string;
  classId: string;
  entries: TrackerEntryShape[];
  status: string;
  createdBy: string;
  closedAt: string | null;
  createdAt: Date;
}

const TrackerRecordRef = builder.objectRef<TrackerRecordShape>("TrackerRecord");
TrackerRecordRef.implement({
  description: "A tracker session record for one set × section cycle.",
  fields: (t) => ({
    id: t.exposeString("id"),
    trackerKind: t.exposeString("trackerKind"),
    setId: t.exposeString("setId"),
    sectionId: t.exposeString("sectionId"),
    classId: t.exposeString("classId"),
    entries: t.field({ type: [TrackerEntryRef], resolve: (r) => r.entries }),
    status: t.exposeString("status"),
    createdBy: t.exposeString("createdBy"),
    closedAt: t.string({ nullable: true, resolve: (r) => r.closedAt ?? null }),
    createdAt: t.string({ resolve: (r) => r.createdAt.toISOString() }),
  }),
});

interface OpenTrackerResultShape {
  trackerId: string;
  trackerKind: string;
  setId: string;
  sectionId: string;
  classId: string;
  status: string;
}

const OpenTrackerResultRef = builder.objectRef<OpenTrackerResultShape>("OpenTrackerResult");
OpenTrackerResultRef.implement({
  fields: (t) => ({
    trackerId: t.exposeString("trackerId"),
    trackerKind: t.exposeString("trackerKind"),
    setId: t.exposeString("setId"),
    sectionId: t.exposeString("sectionId"),
    classId: t.exposeString("classId"),
    status: t.exposeString("status"),
  }),
});

interface RecordEntryResultShape {
  trackerId: string;
  pseudoStudentId: string;
  entryCount: number;
}

const RecordEntryResultRef = builder.objectRef<RecordEntryResultShape>("RecordEntryResult");
RecordEntryResultRef.implement({
  fields: (t) => ({
    trackerId: t.exposeString("trackerId"),
    pseudoStudentId: t.exposeString("pseudoStudentId"),
    entryCount: t.exposeInt("entryCount"),
  }),
});

interface CloseTrackerResultShape {
  trackerId: string;
  status: string;
  closedAt: string;
}

const CloseTrackerResultRef = builder.objectRef<CloseTrackerResultShape>("CloseTrackerResult");
CloseTrackerResultRef.implement({
  fields: (t) => ({
    trackerId: t.exposeString("trackerId"),
    status: t.exposeString("status"),
    closedAt: t.exposeString("closedAt"),
  }),
});

interface TrackerSummaryShape {
  trackerId: string;
  trackerKind: string;
  totalEntries: number;
  submittedCount: number;
  completeCount: number;
  averageScore: number | null;
}

const TrackerSummaryRef = builder.objectRef<TrackerSummaryShape>("TrackerSummary");
TrackerSummaryRef.implement({
  fields: (t) => ({
    trackerId: t.exposeString("trackerId"),
    trackerKind: t.exposeString("trackerKind"),
    totalEntries: t.exposeInt("totalEntries"),
    submittedCount: t.exposeInt("submittedCount"),
    completeCount: t.exposeInt("completeCount"),
    averageScore: t.float({ nullable: true, resolve: (s) => s.averageScore ?? null }),
  }),
});

// ---------------------------------------------------------------------------
// Helper: lean doc → shape
// ---------------------------------------------------------------------------

function trackerToShape(doc: LeanTracker): TrackerRecordShape {
  const entries = (doc.entries ?? []) as unknown as TrackerEntry[];
  return {
    _id: doc._id,
    id: doc._id.toString(),
    trackerKind: doc.trackerKind,
    setId: doc.setId.toString(),
    sectionId: doc.sectionId.toString(),
    classId: doc.classId.toString(),
    entries: entries.map((e) => ({
      pseudoStudentId: e.pseudoStudentId,
      score: typeof e.score === "number" ? e.score : null,
      submitted: typeof e.submitted === "boolean" ? e.submitted : null,
      complete: typeof e.complete === "boolean" ? e.complete : null,
    })),
    status: doc.status,
    createdBy: doc.createdBy.toString(),
    closedAt: doc.closedAt ? (doc.closedAt as unknown as Date).toISOString() : null,
    createdAt: doc.createdAt as unknown as Date,
  };
}

// ---------------------------------------------------------------------------
// Mutation: openTracker — J4.1/J4.3
// ---------------------------------------------------------------------------

builder.mutationField("openTracker", (t) =>
  t.field({
    type: OpenTrackerResultRef,
    description: "Open a new tracker session for an assembled set. Requires write-scope (J4.5).",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      setId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const setDoc = await AssessmentSet.findById(args.setId).select("subjectId").lean();
      await assertCanWrite(
        ctx,
        args.sectionId,
        setDoc?.subjectId ? setDoc.subjectId.toString() : undefined,
      );
      return openTrackerSvc(args.setId, args.sectionId, ctx.auth.userId as string);
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: recordEntry — J4.1/J4.3
// ---------------------------------------------------------------------------

builder.mutationField("recordEntry", (t) =>
  t.field({
    type: RecordEntryResultRef,
    description: "Record or update one student entry in an open tracker. Write-scope enforced (J4.5).",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      trackerId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      /** CT only */
      score: t.arg.float({ required: false }),
      /** AS only */
      submitted: t.arg.boolean({ required: false }),
      /** HW only */
      complete: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const trackerDoc = await TrackerRecord.findById(args.trackerId).lean() as LeanTracker | null;
      if (!trackerDoc) throw new Error("TrackerRecord not found");
      await assertCanWrite(
        ctx,
        trackerDoc.sectionId.toString(),
        trackerDoc.subjectId ? trackerDoc.subjectId.toString() : undefined,
      );

      return recordEntrySvc({
        trackerId: args.trackerId,
        studentId: args.studentId,
        score: args.score ?? undefined,
        submitted: args.submitted ?? undefined,
        complete: args.complete ?? undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: recordEntries — batch upsert/clear (ux-audit F1)
// ---------------------------------------------------------------------------

const TrackerEntryInput = builder.inputType("TrackerEntryInput", {
  fields: (t) => ({
    studentId: t.string({ required: true }),
    /** CT only */
    score: t.float({ required: false }),
    /** AS only */
    submitted: t.boolean({ required: false }),
    /** HW only */
    complete: t.boolean({ required: false }),
    /** Remove this student's entry (undo of a fresh record). */
    clear: t.boolean({ required: false }),
  }),
});

interface RecordEntriesResultShape {
  trackerId: string;
  entryCount: number;
}

const RecordEntriesResultRef = builder.objectRef<RecordEntriesResultShape>("RecordEntriesResult");
RecordEntriesResultRef.implement({
  fields: (t) => ({
    trackerId: t.exposeString("trackerId"),
    entryCount: t.exposeInt("entryCount"),
  }),
});

builder.mutationField("recordEntries", (t) =>
  t.field({
    type: RecordEntriesResultRef,
    description:
      "Batch record/update/clear student entries in an open tracker with one save. Write-scope enforced (J4.5).",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      trackerId: t.arg.string({ required: true }),
      entries: t.arg({ type: [TrackerEntryInput], required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const trackerDoc = await TrackerRecord.findById(args.trackerId).lean() as LeanTracker | null;
      if (!trackerDoc) throw new Error("TrackerRecord not found");
      await assertCanWrite(
        ctx,
        trackerDoc.sectionId.toString(),
        trackerDoc.subjectId ? trackerDoc.subjectId.toString() : undefined,
      );

      return recordEntriesSvc({
        trackerId: args.trackerId,
        entries: args.entries.map((e) => ({
          studentId: e.studentId,
          score: e.score ?? undefined,
          submitted: e.submitted ?? undefined,
          complete: e.complete ?? undefined,
          clear: e.clear ?? undefined,
        })),
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: closeTracker — J4.1/J4.3
// ---------------------------------------------------------------------------

builder.mutationField("closeTracker", (t) =>
  t.field({
    type: CloseTrackerResultRef,
    description: "Seal an open tracker. Write-scope enforced (J4.5).",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      trackerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const trackerDoc = await TrackerRecord.findById(args.trackerId).lean() as LeanTracker | null;
      if (!trackerDoc) throw new Error("TrackerRecord not found");
      await assertCanWrite(
        ctx,
        trackerDoc.sectionId.toString(),
        trackerDoc.subjectId ? trackerDoc.subjectId.toString() : undefined,
      );

      return closeTrackerSvc(args.trackerId);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: tracker — single record
// ---------------------------------------------------------------------------

builder.queryField("tracker", (t) =>
  t.field({
    type: TrackerRecordRef,
    nullable: true,
    description: "Fetch a tracker record by id. Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const doc = await TrackerRecord.findById(args.id).lean() as LeanTracker | null;
      if (!doc) return null;
      await assertCanRead(ctx, doc.sectionId.toString(), doc.classId.toString());
      return trackerToShape(doc);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: trackers — list with optional filters (J4.4)
// ---------------------------------------------------------------------------

builder.queryField("trackers", (t) =>
  t.field({
    type: [TrackerRecordRef],
    description: "List tracker records for a section. Optional filters: kind / setId / status (J4.4).",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      trackerKind: t.arg.string({ required: false }),
      setId: t.arg.string({ required: false }),
      status: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);

      const docs = await listTrackers({
        sectionId: args.sectionId,
        trackerKind: args.trackerKind as import("@scd/shared").TrackerKind | undefined,
        setId: args.setId ?? undefined,
        status: args.status ?? undefined,
      });

      return (docs as LeanTracker[]).map(trackerToShape);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: trackerSummary — aggregate stats
// ---------------------------------------------------------------------------

builder.queryField("trackerSummary", (t) =>
  t.field({
    type: TrackerSummaryRef,
    nullable: true,
    description: "Aggregate stats for a tracker record (total entries, submitted, complete, avg score).",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      trackerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const doc = await TrackerRecord.findById(args.trackerId).lean() as LeanTracker | null;
      if (!doc) return null;
      await assertCanRead(ctx, doc.sectionId.toString(), doc.classId.toString());

      return getTrackerSummary(args.trackerId);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: waLink — pure wa.me link builder (J4.2, ADR-003)
// ---------------------------------------------------------------------------

builder.queryField("waLink", (t) =>
  t.field({
    type: "String",
    description:
      "Build a wa.me deep link for a non-submitter. Pure function — no dispatch (J4.2, ADR-003).",
    authScopes: { hasPermission: "message:dispatch" },
    args: {
      guardianPhone: t.arg.string({ required: true }),
      studentName: t.arg.string({ required: true }),
      setTitle: t.arg.string({ required: true }),
    },
    resolve: (_root, args) =>
      buildNonSubmitterLink(args.guardianPhone, args.studentName, args.setTitle),
  }),
);
// NOTE: buildNonSubmitterLink is async since MT-2 (renderTemplate). Pothos awaits a
// Promise<string> returned from resolve, so the String field resolves correctly.
