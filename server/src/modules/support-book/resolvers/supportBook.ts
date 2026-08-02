/**
 * Support-book resolvers (SB-1, D-#403–#428).
 *
 * The gate boundary. `MergeService` and `PolicySetService` are pure services with NO
 * permission checks in them — the gating lives here, which is the repo's layering
 * everywhere else, and means those services must never be called from anywhere but a
 * gated field.
 *
 * Grants (D-#405/#424): `book:read` for every read, `book:author` to submit a patch,
 * `book:manage` to create a book or activate a policy version. All seven `book:*`
 * sit on the PRINCIPAL template; everyone else is granted per user via AC-1.
 *
 * Book plane (D-#404): every id here is a bare ObjectId. Nothing populates across the
 * connection, and no field on these types reaches a student, guardian or staff row.
 */
import { Types } from "mongoose";
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { BOOK_TYPES, POLICY_DOC_KEYS, type BookType, type PolicyDocKey } from "@scd/shared";
import { SupportBook } from "../models/SupportBook";
import { SupportBookLesson } from "../models/SupportBookLesson";
import { LessonPatch } from "../models/LessonPatch";
import { BookEvent, writeBookEvent } from "../models/BookEvent";
import { submitPatch, type PatchEnvelope } from "../services/MergeService";
import { activePolicySet, activatePolicyDoc } from "../services/PolicySetService";
import { writeAudit } from "../../platform/services/AuditService";
import { isBookDbReady } from "../../../bookDb";

function actorId(ctx: AppContext): Types.ObjectId {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return new Types.ObjectId(ctx.auth.userId);
}

/** The book plane is optional at boot (D-#404). Answer plainly rather than hanging on
 *  a buffered query that will never drain. */
function assertBookPlane(): void {
  if (!isBookDbReady()) {
    throw new ForbiddenError("বই-প্রোডাকশন ডেটাবেস কনফিগার করা হয়নি (BOOK_MONGODB_URI)");
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BookShape {
  bookId: string; bookType: string; classLevel: number; subject: string;
  mode: string | null; titleBn: string; status: string; lessonCount: number;
  policySetHash: string | null;
}
const BookRef = builder.objectRef<BookShape>("SupportBookSummary");
BookRef.implement({
  description: "A book in production — either production line (D-#421).",
  fields: (t) => ({
    bookId: t.exposeString("bookId"),
    bookType: t.exposeString("bookType"),
    classLevel: t.exposeInt("classLevel"),
    subject: t.exposeString("subject"),
    mode: t.exposeString("mode", { nullable: true }),
    titleBn: t.exposeString("titleBn"),
    status: t.exposeString("status"),
    lessonCount: t.exposeInt("lessonCount"),
    policySetHash: t.exposeString("policySetHash", { nullable: true }),
  }),
});

interface LessonShape {
  bookId: string; lessonNo: number; nctbTitleBn: string | null; state: string;
  action: string | null; severity: string | null; bwTreatment: string | null;
  blockCount: number; slotCount: number; checklistPassed: boolean; selfReviewed: boolean;
  policySetHash: string | null;
}
const LessonRef = builder.objectRef<LessonShape>("SupportBookLessonSummary");
LessonRef.implement({
  description: "One পাঠ. `selfReviewed` records that author and reviewer were the same person (D-#424).",
  fields: (t) => ({
    bookId: t.exposeString("bookId"),
    lessonNo: t.exposeInt("lessonNo"),
    nctbTitleBn: t.exposeString("nctbTitleBn", { nullable: true }),
    state: t.exposeString("state"),
    action: t.exposeString("action", { nullable: true }),
    severity: t.exposeString("severity", { nullable: true }),
    bwTreatment: t.exposeString("bwTreatment", { nullable: true }),
    blockCount: t.exposeInt("blockCount"),
    slotCount: t.exposeInt("slotCount"),
    checklistPassed: t.exposeBoolean("checklistPassed"),
    selfReviewed: t.exposeBoolean("selfReviewed"),
    policySetHash: t.exposeString("policySetHash", { nullable: true }),
  }),
});

interface FindingShape {
  check: string; severity: string; message: string;
  lessonNo: number | null; blockId: string | null; slotId: string | null; unit: string | null;
}
const FindingRef = builder.objectRef<FindingShape>("SupportBookValidatorFinding");
FindingRef.implement({
  description: "One validator finding. RED refuses the merge; GREY merges with a warning.",
  fields: (t) => ({
    check: t.exposeString("check"),
    severity: t.exposeString("severity"),
    message: t.exposeString("message"),
    lessonNo: t.exposeInt("lessonNo", { nullable: true }),
    blockId: t.exposeString("blockId", { nullable: true }),
    slotId: t.exposeString("slotId", { nullable: true }),
    unit: t.exposeString("unit", { nullable: true }),
  }),
});

interface MergeResultShape {
  merged: boolean; patchId: string; redCount: number; greyCount: number;
  lessonNos: number[]; policySetHash: string; policyMissing: string[];
  findings: FindingShape[];
}
const MergeResultRef = builder.objectRef<MergeResultShape>("SupportBookMergeResult");
MergeResultRef.implement({
  description:
    "The outcome of submitting a patch. A RED result is NOT an error — it is returned " +
    "with its findings for the author to act on, and the patch is stored either way.",
  fields: (t) => ({
    merged: t.exposeBoolean("merged"),
    patchId: t.exposeString("patchId"),
    redCount: t.exposeInt("redCount"),
    greyCount: t.exposeInt("greyCount"),
    lessonNos: t.exposeIntList("lessonNos"),
    policySetHash: t.exposeString("policySetHash"),
    policyMissing: t.exposeStringList("policyMissing"),
    findings: t.field({ type: [FindingRef], resolve: (p) => p.findings }),
  }),
});

interface EventShape {
  kind: string; summary: string; reason: string | null; at: Date;
  lessonNo: number | null; actorId: string; policySetHash: string | null;
}
const EventRef = builder.objectRef<EventShape>("SupportBookEvent");
EventRef.implement({
  description:
    "One row of the EDITORIAL timeline — why the content reads as it does (D-#411). " +
    "The security audit log is separate and answers a different question.",
  fields: (t) => ({
    kind: t.exposeString("kind"),
    summary: t.exposeString("summary"),
    reason: t.exposeString("reason", { nullable: true }),
    at: t.string({ resolve: (e) => e.at.toISOString() }),
    lessonNo: t.exposeInt("lessonNo", { nullable: true }),
    actorId: t.exposeString("actorId"),
    policySetHash: t.exposeString("policySetHash", { nullable: true }),
  }),
});

interface PolicySetShape { hash: string; missing: string[]; docs: Array<{ docKey: string; version: number }> }
const PolicyDocEntryRef = builder.objectRef<{ docKey: string; version: number }>("SupportBookPolicyDocEntry");
PolicyDocEntryRef.implement({
  fields: (t) => ({
    docKey: t.exposeString("docKey"),
    version: t.exposeInt("version"),
  }),
});
const PolicySetRef = builder.objectRef<PolicySetShape>("SupportBookPolicySet");
PolicySetRef.implement({
  description:
    "The active policy set for a book and its hash — stamped on every patch so a " +
    "decision stays reproducible against the policy AS IT STOOD (D-#403). `missing` " +
    "names documents the set expected and did not find.",
  fields: (t) => ({
    hash: t.exposeString("hash"),
    missing: t.exposeStringList("missing"),
    docs: t.field({ type: [PolicyDocEntryRef], resolve: (p) => p.docs }),
  }),
});

// ---------------------------------------------------------------------------
// Queries (book:read)
// ---------------------------------------------------------------------------

builder.queryField("supportBooks", (t) =>
  t.field({
    type: [BookRef],
    description: "Every book in production, both lines. Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: { bookType: t.arg.string({ required: false }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      const q: Record<string, unknown> = {};
      if (args.bookType) {
        if (!BOOK_TYPES.includes(args.bookType as BookType)) throw new ForbiddenError("unknown bookType");
        q.bookType = args.bookType;
      }
      const books = await SupportBook.find(q).sort({ bookId: 1 }).lean();
      const counts = await SupportBookLesson.aggregate<{ _id: string; n: number }>([
        { $group: { _id: "$bookId", n: { $sum: 1 } } },
      ]);
      const byBook = new Map(counts.map((c) => [c._id, c.n]));
      return books.map((b) => ({
        bookId: b.bookId, bookType: b.bookType, classLevel: b.classLevel, subject: b.subject,
        mode: b.mode ?? null, titleBn: b.titleBn, status: b.status,
        lessonCount: byBook.get(b.bookId) ?? 0, policySetHash: b.policySetHash ?? null,
      }));
    },
  }),
);

builder.queryField("supportBookLessons", (t) =>
  t.field({
    type: [LessonRef],
    description: "A book's পাঠ in NCTB order. Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: { bookId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      const rows = await SupportBookLesson.find({ bookId: args.bookId }).sort({ lessonNo: 1 }).lean();
      return rows.map((l) => ({
        bookId: l.bookId, lessonNo: l.lessonNo, nctbTitleBn: l.nctbTitleBn ?? null,
        state: l.state, action: l.action ?? null, severity: l.severity ?? null,
        bwTreatment: l.bwTreatment ?? null,
        blockCount: (l.blocks ?? []).length, slotCount: (l.imageSlots ?? []).length,
        checklistPassed: l.reviewerSignoff?.checklistPassed ?? false,
        selfReviewed: l.reviewerSignoff?.selfReviewed ?? false,
        policySetHash: l.policySetHash ?? null,
      }));
    },
  }),
);

builder.queryField("supportBookTimeline", (t) =>
  t.field({
    type: [EventRef],
    description:
      "The editorial timeline for a book, or one পাঠ — why the content reads as it " +
      "does (SB-5's read, written from SB-1 onward). Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: {
      bookId: t.arg.string({ required: true }),
      lessonNo: t.arg.int({ required: false }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args) => {
      assertBookPlane();
      const q: Record<string, unknown> = { bookId: args.bookId };
      if (args.lessonNo != null) q.lessonNo = args.lessonNo;
      const rows = await BookEvent.find(q).sort({ at: -1 }).limit(Math.min(args.limit ?? 100, 500)).lean();
      return rows.map((e) => ({
        kind: e.kind, summary: e.summary, reason: e.reason ?? null, at: e.at,
        lessonNo: e.lessonNo ?? null, actorId: String(e.actorId),
        policySetHash: e.refs?.policySetHash ?? null,
      }));
    },
  }),
);

builder.queryField("supportBookPolicySet", (t) =>
  t.field({
    type: PolicySetRef,
    description: "The active policy set + hash for a book (D-#403). Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: { bookId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      const set = await activePolicySet(args.bookId);
      return {
        hash: set.hash,
        missing: set.missing,
        docs: set.docs.map((d) => ({ docKey: d.docKey, version: d.version })),
      };
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("createSupportBook", (t) =>
  t.field({
    type: BookRef,
    description: "Create a book (either line). Requires book:manage. Audited.",
    authScopes: { hasPermission: "book:manage" },
    args: {
      bookId: t.arg.string({ required: true }),
      bookType: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      subject: t.arg.string({ required: true }),
      titleBn: t.arg.string({ required: true }),
      mode: t.arg.string({ required: false }),
      hasTextEn: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertBookPlane();
      const actor = actorId(ctx);
      if (!BOOK_TYPES.includes(args.bookType as BookType)) throw new ForbiddenError("unknown bookType");
      const created = await SupportBook.create({
        bookId: args.bookId,
        bookType: args.bookType,
        classLevel: args.classLevel,
        subject: args.subject,
        titleBn: args.titleBn,
        mode: args.mode ?? null,
        hasTextEn: args.hasTextEn ?? false,
        status: "content-draft",
        versionLog: [],
        createdBy: actor,
      });
      await writeBookEvent({
        bookId: created.bookId, kind: "BOOK_CREATED", actorId: actor,
        summary: `${created.bookType} ${created.bookId} created`,
      });
      await writeAudit({
        eventKind: "BOOK_CREATED", actorId: actor, actorRole: ctx.auth?.role,
        targetKind: "SupportBook", meta: { bookId: created.bookId, bookType: created.bookType },
      });
      return {
        bookId: created.bookId, bookType: created.bookType, classLevel: created.classLevel,
        subject: created.subject, mode: created.mode ?? null, titleBn: created.titleBn,
        status: created.status, lessonCount: 0, policySetHash: null,
      };
    },
  }),
);

builder.mutationField("activateSupportBookPolicy", (t) =>
  t.field({
    type: PolicySetRef,
    description:
      "Upload + activate a new version of a governance document (D-#403). The prior " +
      "active version is superseded, never deleted. Requires book:manage. Audited.",
    authScopes: { hasPermission: "book:manage" },
    args: {
      docKey: t.arg.string({ required: true }),
      body: t.arg.string({ required: true }),
      bookId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertBookPlane();
      const actor = actorId(ctx);
      if (!POLICY_DOC_KEYS.includes(args.docKey as PolicyDocKey)) {
        throw new ForbiddenError(`unknown policy doc key: ${args.docKey}`);
      }
      const doc = await activatePolicyDoc({
        docKey: args.docKey as PolicyDocKey,
        bookId: args.bookId ?? null,
        body: args.body,
        uploadedBy: actor,
      });
      if (args.bookId) {
        await writeBookEvent({
          bookId: args.bookId, kind: "POLICY_ACTIVATED", actorId: actor,
          summary: `${doc.docKey} v${doc.version} activated`,
        });
      }
      await writeAudit({
        eventKind: "BOOK_POLICY_ACTIVATED", actorId: actor, actorRole: ctx.auth?.role,
        targetKind: "PolicyDoc", meta: { docKey: doc.docKey, version: doc.version, bookId: args.bookId ?? null },
      });
      const set = await activePolicySet(args.bookId ?? "");
      return { hash: set.hash, missing: set.missing, docs: set.docs.map((d) => ({ docKey: d.docKey, version: d.version })) };
    },
  }),
);

builder.mutationField("submitSupportBookPatch", (t) =>
  t.field({
    type: MergeResultRef,
    description:
      "Submit a SCHEMA §5 patch. Validates against the merge candidate and merges " +
      "wholesale by lesson_no on a green result (D-#406/#408). A RED does NOT throw — " +
      "it returns merged:false with findings, and the patch is stored either way. " +
      "Requires book:author.",
    authScopes: { hasPermission: "book:author" },
    args: {
      patchJson: t.arg.string({ required: true }),
      source: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertBookPlane();
      const actor = actorId(ctx);
      let patch: PatchEnvelope;
      try {
        patch = JSON.parse(args.patchJson) as PatchEnvelope;
      } catch (e) {
        throw new ForbiddenError(`patch is not valid JSON: ${(e as Error).message}`);
      }
      // Only the two real paths; anything else is a caller bug, not a new source.
      const source = args.source === "IN_APP_CHAT" ? "IN_APP_CHAT" : "DESKTOP_UPLOAD";
      const r = await submitPatch({ patch, source, actorId: actor });

      await writeAudit({
        eventKind: r.merged ? "BOOK_PATCH_MERGED" : "BOOK_PATCH_REJECTED",
        actorId: actor, actorRole: ctx.auth?.role, targetKind: "LessonPatch",
        targetId: r.patchId,
        meta: { bookId: patch.book_id, patchId: patch.patch_id, lessonNos: r.lessonNos, red: r.report.redCount },
      });

      return {
        merged: r.merged,
        patchId: String(r.patchId),
        redCount: r.report.redCount,
        greyCount: r.report.greyCount,
        lessonNos: r.lessonNos,
        policySetHash: r.policySetHash,
        policyMissing: r.policyMissing,
        findings: r.report.findings.map((f) => ({
          check: f.check, severity: f.severity, message: f.message,
          lessonNo: f.lessonNo ?? null, blockId: f.blockId ?? null,
          slotId: f.slotId ?? null, unit: f.unit ?? null,
        })),
      };
    },
  }),
);

builder.queryField("supportBookPatches", (t) =>
  t.field({
    type: [FindingRef],
    description:
      "The findings on a book's most recent patch — including a REJECTED one, which " +
      "is retained precisely because a refused report is the useful part. Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: { bookId: t.arg.string({ required: true }), lessonNo: t.arg.int({ required: false }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      const q: Record<string, unknown> = { bookId: args.bookId };
      if (args.lessonNo != null) q.lessonNo = args.lessonNo;
      const p = await LessonPatch.findOne(q).sort({ submittedAt: -1 }).lean();
      if (!p) return [];
      return (p.findings ?? []).map((f) => ({
        check: f.check, severity: f.severity, message: f.message,
        lessonNo: f.lessonNo ?? null, blockId: f.blockId ?? null,
        slotId: f.slotId ?? null, unit: f.unit ?? null,
      }));
    },
  }),
);
