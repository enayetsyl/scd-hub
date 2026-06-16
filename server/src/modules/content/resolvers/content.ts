/**
 * Content module resolvers — import + browse (J1 journeys).
 *
 * importEnvelope — J1.1–J1.4 (requires content:import; TEACHER denied)
 * contentTree    — J1.5 browse Subject×Class→Chapter→Lesson tree
 * contentArtifacts — J1.5 filtered list
 * artifact       — J1.5/J1.7 open one plan (returns rendered_markdown; app never re-renders)
 */
import { builder } from "../../../schema";
import { importEnvelope as importEnvelopeSvc, importContentFiles, type ImportFile } from "../services/ContentService";
import { ContentArtifact } from "../models/ContentArtifact";
import { User } from "../../foundation/models/User";
import { ForbiddenError } from "../../../middleware/authz";
import { buildContentScope, contentScopeAllows } from "../contentScope";
import { reviewerMayReadArtifact } from "../services/ReviewService";
import type { Types, FlattenMaps } from "mongoose";
import type { FilterQuery } from "mongoose";
import type { IContentArtifact } from "../models/ContentArtifact";

type LeanArtifact = FlattenMaps<IContentArtifact> & { _id: Types.ObjectId };

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

interface ImportResultShape {
  verdict: string;
  failChecks: string[];
  warnings: string[];
  advisories: string[];
  artifactId?: string | null;
  batchId: string;
  wrappedEnvelopeJson?: string | null;
  itemsTotal?: number | null;
  itemsPassed?: number | null;
  itemsFailed?: number | null;
}

const ImportResultRef = builder.objectRef<ImportResultShape>("ImportResult");
ImportResultRef.implement({
  description: "Result of an import (importEnvelope, importFiles, or a question-bank fan-out)",
  fields: (t) => ({
    verdict: t.exposeString("verdict"),
    failChecks: t.field({ type: ["String"], resolve: (r) => r.failChecks }),
    warnings: t.field({ type: ["String"], resolve: (r) => r.warnings }),
    advisories: t.field({ type: ["String"], resolve: (r) => r.advisories }),
    artifactId: t.string({ nullable: true, resolve: (r) => r.artifactId ?? null }),
    batchId: t.exposeString("batchId"),
    /** The envelope the app auto-built from a plan+md pair (null for a direct envelope import). */
    envelopeJson: t.string({ nullable: true, resolve: (r) => r.wrappedEnvelopeJson ?? null }),
    /** Question-bank fan-out tallies (null outside the bank path). */
    itemsTotal: t.int({ nullable: true, resolve: (r) => r.itemsTotal ?? null }),
    itemsPassed: t.int({ nullable: true, resolve: (r) => r.itemsPassed ?? null }),
    itemsFailed: t.int({ nullable: true, resolve: (r) => r.itemsFailed ?? null }),
  }),
});

const ImportFileInput = builder.inputType("ImportFileInput", {
  description: "One uploaded file (a plan .json, its .md, or a built envelope .json).",
  fields: (t) => ({
    filename: t.string({ required: true }),
    content: t.string({ required: true }),
  }),
});

interface AddressShape {
  anchorWord: string;
  number: string;
  title?: string | null;
}

const ArtifactAddressRef = builder.objectRef<AddressShape>("ArtifactAddress");
ArtifactAddressRef.implement({
  fields: (t) => ({
    anchorWord: t.exposeString("anchorWord"),
    number: t.exposeString("number"),
    title: t.string({ nullable: true, resolve: (a) => a.title ?? null }),
  }),
});

interface ArtifactShape {
  _id: Types.ObjectId;
  docType: string;
  subject: string;
  classLevel: number;
  address: AddressShape;
  curationTag: string;
  reviewStatus: string;
  renderedMarkdown?: string | null;
  current: boolean;
  priorVersionId?: Types.ObjectId | null;
  importedAt: Date;
}

const ArtifactRef = builder.objectRef<ArtifactShape>("ContentArtifact");
ArtifactRef.implement({
  description: "An imported content artifact (plan, question, etc.)",
  fields: (t) => ({
    id: t.string({ resolve: (a) => a._id.toString() }),
    docType: t.exposeString("docType"),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    address: t.field({ type: ArtifactAddressRef, resolve: (a) => a.address }),
    curationTag: t.exposeString("curationTag"),
    reviewStatus: t.exposeString("reviewStatus"),
    renderedMarkdown: t.string({ nullable: true, resolve: (a) => a.renderedMarkdown ?? null }),
    current: t.exposeBoolean("current"),
    priorVersionId: t.string({ nullable: true, resolve: (a) => a.priorVersionId?.toString() ?? null }),
    importedAt: t.string({ resolve: (a) => a.importedAt.toISOString() }),
  }),
});

// contentTree — hierarchical grouping of current artifacts for navigation (J1.5)
interface ContentTreeNodeShape {
  subject: string;
  classLevel: number;
  chapters: ContentTreeChapterShape[];
}
interface ContentTreeChapterShape {
  anchorWord: string;
  number: string;
  title?: string | null;
  artifacts: ArtifactShape[];
}

const ContentTreeChapterRef = builder.objectRef<ContentTreeChapterShape>("ContentTreeChapter");
ContentTreeChapterRef.implement({
  fields: (t) => ({
    anchorWord: t.exposeString("anchorWord"),
    number: t.exposeString("number"),
    title: t.string({ nullable: true, resolve: (c) => c.title ?? null }),
    artifacts: t.field({ type: [ArtifactRef], resolve: (c) => c.artifacts }),
  }),
});

const ContentTreeNodeRef = builder.objectRef<ContentTreeNodeShape>("ContentTreeNode");
ContentTreeNodeRef.implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    chapters: t.field({ type: [ContentTreeChapterRef], resolve: (n) => n.chapters }),
  }),
});

// ---------------------------------------------------------------------------
// Mutation: importEnvelope
// ---------------------------------------------------------------------------

builder.mutationField("importEnvelope", (t) =>
  t.field({
    type: ImportResultRef,
    description: "Import a validated envelope. Requires content:import (Principal/Office only — J1.4).",
    authScopes: { hasPermission: "content:import" },
    args: {
      envelopeJson: t.arg.string({ required: true, description: "The full envelope as a JSON string" }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      let envelope: Record<string, unknown>;
      try {
        envelope = JSON.parse(args.envelopeJson) as Record<string, unknown>;
      } catch {
        return {
          verdict: "FAIL",
          failChecks: ["[PARSE] Envelope is not valid JSON"],
          warnings: [],
          advisories: [],
          artifactId: null,
          batchId: "n/a",
        };
      }
      const result = await importEnvelopeSvc(envelope, ctx.auth.userId as unknown as import("mongoose").Types.ObjectId);
      return result;
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: importFiles — upload a plan JSON+MD pair (auto-wrapped) or an envelope (J1.1)
// ---------------------------------------------------------------------------

builder.mutationField("importFiles", (t) =>
  t.field({
    type: ImportResultRef,
    description:
      "Import a Project-03 plan as a JSON + Markdown pair (the app auto-wraps it into an envelope), " +
      "a Project-04 question bank ({stimuli,questions} collection, fanned out into N envelopes; pass " +
      "curationTag), or a single built envelope JSON. Same gate + persistence as importEnvelope. " +
      "Requires content:import (J1.1).",
    authScopes: { hasPermission: "content:import" },
    args: {
      files: t.arg({ type: [ImportFileInput], required: true }),
      /** Question-bank only: the curation tag for every fanned-out item (model-required; questions carry none). */
      curationTag: t.arg.string({ required: false }),
      /** Question-bank only: optional unit title for the synthesized address (defaults to "Unit N"). */
      unitTitle: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const user = await User.findById(ctx.auth.userId).lean();
      const author = user?.name ?? ctx.auth.userId;
      const files: ImportFile[] = args.files.map((f) => ({ filename: f.filename, content: f.content }));
      return importContentFiles(
        files,
        ctx.auth.userId as unknown as import("mongoose").Types.ObjectId,
        author,
        args.curationTag ?? undefined,
        args.unitTitle ?? undefined,
      );
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: artifact (open one plan — J1.5/J1.7)
// ---------------------------------------------------------------------------

builder.queryField("artifact", (t) =>
  t.field({
    type: ArtifactRef,
    nullable: true,
    description: "Fetch a single content artifact by id. TEACHER scope enforced.",
    authScopes: { hasPermission: "content:read" },
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const doc = await ContentArtifact.findById(args.id).lean();
      if (!doc) return null;
      // Row-scope (D-#257): PRINCIPAL/OFFICE bypass; a TEACHER sees it iff a routine
      // teaching/proxy or supervisory grant covers (subject, classLevel).
      // Override (D-#39): a teacher with an active review assignment for this exact version
      // may read it even outside their teaching subject (read-only, artifact-scoped).
      const scope = await buildContentScope(ctx);
      if (!contentScopeAllows(scope, doc.subject, doc.classLevel)) {
        if (!(ctx.auth && (await reviewerMayReadArtifact(ctx.auth.userId, doc._id)))) throw new ForbiddenError();
      }
      return docToShape(doc);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: contentArtifacts (filtered list — J1.5)
// ---------------------------------------------------------------------------

builder.queryField("contentArtifacts", (t) =>
  t.field({
    type: [ArtifactRef],
    description: "Browse content artifacts with optional filters. TEACHER scope enforced. Returns current versions only by default.",
    authScopes: { hasPermission: "content:read" },
    args: {
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      docType: t.arg.string({ required: false }),
      curationTag: t.arg.string({ required: false }),
      reviewStatus: t.arg.string({ required: false }),
      currentOnly: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const filter: FilterQuery<IContentArtifact> = {};
      if (args.currentOnly !== false) filter.current = true;
      if (args.subject) filter.subject = args.subject;
      if (args.classLevel != null) filter.classLevel = args.classLevel;
      if (args.docType) filter.docType = args.docType;
      if (args.curationTag) filter.curationTag = args.curationTag;
      if (args.reviewStatus) filter.reviewStatus = args.reviewStatus;

      // Scope (J1.6 / D-#257): PRINCIPAL/OFFICE see everything; a TEACHER sees content
      // covered by a routine teaching/proxy or supervisory grant (subject + class). Scope
      // is resolved once, then each artifact is matched cheaply.
      const docs = await ContentArtifact.find(filter).lean();
      const scope = await buildContentScope(ctx);
      return docs.filter((d) => contentScopeAllows(scope, d.subject, d.classLevel)).map(docToShape);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: contentTree (Subject×Class→Chapter→Lesson navigation — J1.5)
// ---------------------------------------------------------------------------

builder.queryField("contentTree", (t) =>
  t.field({
    type: [ContentTreeNodeRef],
    description: "Hierarchical content tree: Subject×Class → Chapter → Lesson (current only, scope-filtered).",
    authScopes: { hasPermission: "content:read" },
    args: {
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const filter: FilterQuery<IContentArtifact> = { current: true };
      if (args.subject) filter.subject = args.subject;
      if (args.classLevel != null) filter.classLevel = args.classLevel;

      const docs = await ContentArtifact.find(filter).sort({ subject: 1, classLevel: 1, "address.number": 1 }).lean();

      // Scope filter (J1.6 / D-#257): routine teaching/proxy or supervisory grant by subject+class.
      const scope = await buildContentScope(ctx);
      const visibleDocs = docs.filter((d) => contentScopeAllows(scope, d.subject, d.classLevel));

      // Group: subject+classLevel → anchorWord+number → artifacts
      const nodeMap = new Map<string, ContentTreeNodeShape>();
      for (const doc of visibleDocs) {
        const nodeKey = `${doc.subject}:${doc.classLevel}`;
        if (!nodeMap.has(nodeKey)) {
          nodeMap.set(nodeKey, { subject: doc.subject, classLevel: doc.classLevel, chapters: [] });
        }
        const node = nodeMap.get(nodeKey)!;
        const chapterKey = `${doc.address.anchorWord}:${doc.address.number}`;
        let chapter = node.chapters.find(
          (c) => c.anchorWord === doc.address.anchorWord && c.number === String(doc.address.number),
        );
        if (!chapter) {
          chapter = {
            anchorWord: doc.address.anchorWord,
            number: String(doc.address.number),
            title: doc.address.title ?? null,
            artifacts: [],
          };
          node.chapters.push(chapter);
          void chapterKey;
        }
        chapter.artifacts.push(docToShape(doc));
      }

      return Array.from(nodeMap.values());
    },
  }),
);

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function docToShape(doc: LeanArtifact): ArtifactShape {
  return {
    _id: doc._id,
    docType: doc.docType,
    subject: doc.subject,
    classLevel: doc.classLevel,
    address: {
      anchorWord: doc.address.anchorWord,
      number: String(doc.address.number),
      title: doc.address.title ?? null,
    },
    curationTag: doc.curationTag,
    reviewStatus: doc.reviewStatus,
    renderedMarkdown: doc.renderedMarkdown ?? null,
    current: doc.current,
    priorVersionId: doc.priorVersionId ?? null,
    importedAt: doc.importedAt,
  };
}
