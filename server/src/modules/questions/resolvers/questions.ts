/**
 * Question + stimulus query resolvers — J2.1–J2.4.
 *
 * Questions and stimuli are ContentArtifacts (docType=question|stimulus).
 * This module adds a question-specific query surface on top of the existing
 * ContentArtifact store — no separate collection, no data duplication.
 *
 * questions() — filtered list (J2.2); tag filters applied to envelopeJson.tags
 *               and envelopeJson.payload fields (stored in the artifact).
 * question()  — single question with full payload for preview (J2.3).
 * stimuli()   — filtered list of stimulus artifacts.
 *
 * Row-scope: assertCanRead enforced per-result for TEACHERs (J2.4 — supervisory
 * read passes naturally because canRead covers supervisory extent).
 */
import { builder } from "../../../schema";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { ForbiddenError } from "../../../middleware/authz";
import { buildContentScope, contentScopeAllows, contentScopeMongo } from "../../content/contentScope";
import { normalizeBanglaDigits, escapeRegex, orderQuestionCategories } from "../search";
import { reviewerMayReadArtifact } from "../../content/services/ReviewService";
import { applyQuestionOnlyGate, seesPublishedOnly } from "../publishGate";
import { QUESTION_CATEGORIES } from "@scd/shared";
import type { Types, FlattenMaps, FilterQuery } from "mongoose";
import type { IContentArtifact } from "../../content/models/ContentArtifact";

type LeanArtifact = FlattenMaps<IContentArtifact> & { _id: Types.ObjectId };

// ---------------------------------------------------------------------------
// Shared return shape: QuestionArtifact
// (Extends the base ContentArtifact shape with question-specific payload fields
//  exposed as structured fields for J2.2 filter chips + J2.3 preview.)
// ---------------------------------------------------------------------------

interface QuestionArtifactShape {
  _id: Types.ObjectId;
  id: string;
  docType: string;
  subject: string;
  classLevel: number;
  /** The full payload from envelopeJson.payload (question or stimulus payload). */
  payloadJson: string;
  /** Question-specific tag fields lifted from envelope tags + payload. */
  qid?: string | null;
  topicTag?: string | null;
  questionType?: string | null;
  /** Exercise family (D-#511) — payload lesson_ref. */
  category?: string | null;
  paperRole?: string | null;
  bloomLevel?: string | null;
  difficulty?: string | null;
  marks?: number | null;
  curationTag: string;
  reviewStatus: string;
  current: boolean;
  importedAt: Date;
}

const QuestionArtifactRef = builder.objectRef<QuestionArtifactShape>("QuestionArtifact");
QuestionArtifactRef.implement({
  description: "A question or stimulus artifact with full payload for preview/assembly.",
  fields: (t) => ({
    id: t.exposeString("id"),
    docType: t.exposeString("docType"),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    /** Full payload serialised as JSON string — client deserialises for rich preview. */
    payloadJson: t.exposeString("payloadJson"),
    qid: t.string({ nullable: true, resolve: (q) => q.qid ?? null }),
    topicTag: t.string({ nullable: true, resolve: (q) => q.topicTag ?? null }),
    questionType: t.string({ nullable: true, resolve: (q) => q.questionType ?? null }),
    category: t.string({ nullable: true, resolve: (q) => q.category ?? null }),
    paperRole: t.string({ nullable: true, resolve: (q) => q.paperRole ?? null }),
    bloomLevel: t.string({ nullable: true, resolve: (q) => q.bloomLevel ?? null }),
    difficulty: t.string({ nullable: true, resolve: (q) => q.difficulty ?? null }),
    marks: t.float({ nullable: true, resolve: (q) => q.marks ?? null }),
    curationTag: t.exposeString("curationTag"),
    reviewStatus: t.exposeString("reviewStatus"),
    current: t.exposeBoolean("current"),
    importedAt: t.string({ resolve: (q) => q.importedAt.toISOString() }),
  }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function docToShape(doc: LeanArtifact): QuestionArtifactShape {
  const env = doc.envelopeJson as Record<string, unknown>;
  const tags = (env.tags ?? {}) as Record<string, unknown>;
  const payload = (env.payload ?? {}) as Record<string, unknown>;

  return {
    _id: doc._id,
    id: doc._id.toString(),
    docType: doc.docType,
    subject: doc.subject,
    classLevel: doc.classLevel,
    payloadJson: JSON.stringify(env.payload ?? {}),
    qid: (payload.qid as string | undefined) ?? null,
    topicTag: (tags.topic_tag as string | undefined) ?? null,
    questionType: (payload.question_type as string | undefined) ?? null,
    category: (payload.lesson_ref as string | undefined) ?? null,
    paperRole: (payload.paper_role as string | undefined) ??
               (tags.paper_role as string | undefined) ?? null,
    bloomLevel: (payload.bloom_level as string | undefined) ??
                (tags.bloom_level as string | undefined) ?? null,
    difficulty: (payload.difficulty as string | undefined) ??
                (tags.difficulty as string | undefined) ?? null,
    marks: typeof payload.marks === "number" ? payload.marks : null,
    curationTag: doc.curationTag,
    reviewStatus: doc.reviewStatus,
    current: doc.current,
    importedAt: doc.importedAt,
  };
}

/** Apply TEACHER row-scope filter to a list of lean artifacts.
 *  Questions are (subject, classLevel) content — scoped via buildContentScope
 *  (teaching/proxy/supervisory grants), same as the content module (D-#257).
 *  Built once per request, then checked per artifact — no per-doc DB hit. */
async function applyScope(
  docs: LeanArtifact[],
  ctx: import("../../../context").AppContext,
): Promise<QuestionArtifactShape[]> {
  const scope = await buildContentScope(ctx);
  return docs
    .filter((doc) => contentScopeAllows(scope, doc.subject, doc.classLevel))
    .map(docToShape);
}

// ---------------------------------------------------------------------------
// Query: questions — J2.2 multi-tag filter
// ---------------------------------------------------------------------------

builder.queryField("questions", (t) =>
  t.field({
    type: [QuestionArtifactRef],
    description: "Filter questions by any combination of tags (J2.2). TEACHER scope enforced (J2.4).",
    authScopes: { hasPermission: "question:read" },
    args: {
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      topicTag: t.arg.string({ required: false }),
      questionType: t.arg.string({ required: false }),
      category: t.arg.string({ required: false }),
      bloomLevel: t.arg.string({ required: false }),
      difficulty: t.arg.string({ required: false }),
      paperRole: t.arg.string({ required: false }),
      marksMin: t.arg.float({ required: false }),
      marksMax: t.arg.float({ required: false }),
      reviewStatus: t.arg.string({ required: false }),
      /** Free-text search over question_text + qid. Bangla digits in the term
       *  are normalised to Latin for the qid match ("৪২" → matches HW-0042). */
      search: t.arg.string({ required: false }),
      /** Server-side pagination (default 40, cap 200) — the bank can be large. */
      limit: t.arg.int({ required: false }),
      offset: t.arg.int({ required: false }),
      /** Cursor: id of the last item of the previous page (sorted by
       *  importedAt desc, _id desc). When given, `offset` is ignored. An
       *  unknown/vanished id is silently ignored (falls back to page 1 —
       *  the client dedupes appended pages by id). */
      after: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const filter: FilterQuery<IContentArtifact> = {
        docType: "question",
        current: true,
      };
      if (args.subject) filter.subject = args.subject;
      if (args.classLevel != null) filter.classLevel = args.classLevel;
      if (args.reviewStatus) filter.reviewStatus = args.reviewStatus;

      // Publish gate (Q3.1): a teacher sees ONLY published questions. Set last so an
      // explicit reviewStatus arg can never widen it back open.
      applyQuestionOnlyGate(filter as Record<string, unknown>, ctx.auth);

      // Tag-level filters stored in envelopeJson.tags or envelopeJson.payload
      if (args.topicTag) filter["envelopeJson.tags.topic_tag"] = args.topicTag;
      if (args.bloomLevel) filter["envelopeJson.tags.bloom_level"] = args.bloomLevel;
      if (args.difficulty) filter["envelopeJson.tags.difficulty"] = args.difficulty;
      if (args.paperRole) filter["envelopeJson.tags.paper_role"] = args.paperRole;
      if (args.questionType) filter["envelopeJson.payload.question_type"] = args.questionType;
      // Category (D-#511) — the exercise family, carried in the payload's free-text
      // lesson_ref. Payload-side like question_type, because it is not an envelope tag.
      if (args.category) filter["envelopeJson.payload.lesson_ref"] = args.category;

      // Marks range filter on payload.marks
      if (args.marksMin != null || args.marksMax != null) {
        const marksFilter: Record<string, number> = {};
        if (args.marksMin != null) marksFilter.$gte = args.marksMin;
        if (args.marksMax != null) marksFilter.$lte = args.marksMax;
        filter["envelopeJson.payload.marks"] = marksFilter;
      }

      // Multiple $or clauses (content scope / search / cursor) must be ANDed —
      // a bare filter.$or would let a later clause clobber an earlier one.
      const ands: FilterQuery<IContentArtifact>[] = [];

      // Free-text search: question body as typed + digit-normalised qid.
      const rawSearch = args.search?.trim();
      if (rawSearch) {
        const textRe = new RegExp(escapeRegex(rawSearch), "i");
        const qidRe = new RegExp(escapeRegex(normalizeBanglaDigits(rawSearch)), "i");
        ands.push({
          $or: [
            { "envelopeJson.payload.question_text": textRe },
            { "envelopeJson.payload.qid": qidRe },
          ],
        });
      }

      // Cursor: strictly-before tuple matching the {importedAt:-1,_id:-1} sort.
      if (args.after) {
        const anchor = await ContentArtifact.findById(args.after)
          .select("importedAt")
          .lean();
        if (anchor) {
          ands.push({
            $or: [
              { importedAt: { $lt: anchor.importedAt } },
              { importedAt: anchor.importedAt, _id: { $lt: anchor._id } },
            ],
          });
        }
      }

      // Push TEACHER content-scope INTO the DB query so pagination is correct and we
      // don't load-then-filter every artifact (J2.4). PRINCIPAL/OFFICE → unrestricted.
      const scope = await buildContentScope(ctx);
      const scopeFilter = contentScopeMongo(scope);
      if (scopeFilter === null) return []; // caller has no readable content
      if (scopeFilter) ands.push({ $or: scopeFilter.$or });

      if (ands.length) filter.$and = ands;

      const limit = Math.min(Math.max(args.limit ?? 40, 1), 200);
      const offset = args.after ? 0 : Math.max(args.offset ?? 0, 0);
      const docs = (await ContentArtifact.find(filter)
        .sort({ importedAt: -1, _id: -1 })
        .skip(offset)
        .limit(limit)
        .lean()) as LeanArtifact[];
      return docs.map(docToShape);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: question — single with full payload (J2.3)
// ---------------------------------------------------------------------------

builder.queryField("question", (t) =>
  t.field({
    type: QuestionArtifactRef,
    nullable: true,
    description: "Fetch a single question artifact by id with full payload (J2.3).",
    authScopes: { hasPermission: "question:read" },
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const doc = await ContentArtifact.findById(args.id).lean() as LeanArtifact | null;
      if (!doc || doc.docType !== "question") return null;
      const scope = await buildContentScope(ctx);
      if (!contentScopeAllows(scope, doc.subject, doc.classLevel)) throw new ForbiddenError();
      // Publish gate (Q3.2) — with ONE exception: the assigned reviewer must be able to read
      // exactly the unpublished question they were asked to review. That override is
      // read-only and artifact-scoped; it grants no right to select it into a set (Q5.3).
      if (seesPublishedOnly(ctx.auth) && doc.reviewStatus !== "gold") {
        const isReviewer = await reviewerMayReadArtifact(ctx.auth.userId, doc._id);
        if (!isReviewer) return null;
      }
      return docToShape(doc);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: questionTopicTags — distinct topic tags for the FilterSheet (F4)
// ---------------------------------------------------------------------------

builder.queryField("questionTopicTags", (t) =>
  t.field({
    type: ["String"],
    description:
      "Distinct topic_tag values across readable questions — feeds the bank's topic filter. " +
      "Optionally narrowed by subject/classLevel. TEACHER content scope enforced.",
    authScopes: { hasPermission: "question:read" },
    args: {
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const filter: FilterQuery<IContentArtifact> = { docType: "question", current: true };
      if (args.subject) filter.subject = args.subject;
      if (args.classLevel != null) filter.classLevel = args.classLevel;
      // An unpublished question must not leak its topic into the filter chips (Q3.1).
      applyQuestionOnlyGate(filter as Record<string, unknown>, ctx.auth);

      const scope = await buildContentScope(ctx);
      const scopeFilter = contentScopeMongo(scope);
      if (scopeFilter === null) return [];
      if (scopeFilter) filter.$or = scopeFilter.$or;

      const tags = (await ContentArtifact.distinct(
        "envelopeJson.tags.topic_tag",
        filter,
      )) as unknown[];
      return tags
        .filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "")
        .sort((a, b) => a.localeCompare(b, "bn"));
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: questionCategories — distinct exercise families for the FilterSheet (D-#511)
// ---------------------------------------------------------------------------

builder.queryField("questionCategories", (t) =>
  t.field({
    type: ["String"],
    description:
      "Distinct question CATEGORY codes (payload lesson_ref) across readable questions — " +
      "feeds the bank's category filter. Optionally narrowed by subject/classLevel. " +
      "Returns [] where the chosen slice carries no categories, which is how the client " +
      "knows not to render the group at all. TEACHER content scope enforced.",
    authScopes: { hasPermission: "question:read" },
    args: {
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const filter: FilterQuery<IContentArtifact> = { docType: "question", current: true };
      if (args.subject) filter.subject = args.subject;
      if (args.classLevel != null) filter.classLevel = args.classLevel;
      // An unpublished question must not leak its category into the filter chips (Q3.1).
      applyQuestionOnlyGate(filter as Record<string, unknown>, ctx.auth);

      const scope = await buildContentScope(ctx);
      const scopeFilter = contentScopeMongo(scope);
      if (scopeFilter === null) return [];
      if (scopeFilter) filter.$or = scopeFilter.$or;

      const codes = (await ContentArtifact.distinct(
        "envelopeJson.payload.lesson_ref",
        filter,
      )) as unknown[];
      return orderQuestionCategories(codes, QUESTION_CATEGORIES);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: stimuli — filtered list of stimulus artifacts
// ---------------------------------------------------------------------------

builder.queryField("stimuli", (t) =>
  t.field({
    type: [QuestionArtifactRef],
    description: "Browse stimulus artifacts (shared passages/poems/audio-scripts).",
    // DELIBERATELY NOT publish-gated (D-#508 §5a). A question payload carries a
    // `stimulus_ref` that must resolve to a stored stimulus; gating stimuli on reviewStatus
    // would render a PUBLISHED question without its passage whenever the shared stimulus was
    // still `draft` — a silent failure landing on a paper in a child's hand. Stimuli are
    // supporting material, not assessable content. A test asserts this exemption; do not
    // "tidy" it into line with questions().
    authScopes: { hasPermission: "question:read" },
    args: {
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const filter: FilterQuery<IContentArtifact> = { docType: "stimulus", current: true };
      if (args.subject) filter.subject = args.subject;
      if (args.classLevel != null) filter.classLevel = args.classLevel;

      const docs = await ContentArtifact.find(filter).lean() as LeanArtifact[];
      return applyScope(docs, ctx);
    },
  }),
);
