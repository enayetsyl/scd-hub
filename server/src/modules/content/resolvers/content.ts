/**
 * Content module resolvers — import + browse (J1 journeys).
 *
 * importEnvelope — J1.1–J1.4 (requires content:import; TEACHER denied)
 * contentTree    — J1.5 browse Subject×Class→Chapter→Lesson tree
 * contentArtifacts — J1.5 filtered list
 * artifact       — J1.5/J1.7 open one plan (returns rendered_markdown; app never re-renders)
 */
import { builder } from "../../../schema";
import { importEnvelope as importEnvelopeSvc } from "../services/ContentService";
import { ContentArtifact } from "../models/ContentArtifact";
import { assertCanRead, ForbiddenError } from "../../../middleware/authz";
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
}

const ImportResultRef = builder.objectRef<ImportResultShape>("ImportResult");
ImportResultRef.implement({
  description: "Result of an importEnvelope mutation",
  fields: (t) => ({
    verdict: t.exposeString("verdict"),
    failChecks: t.field({ type: ["String"], resolve: (r) => r.failChecks }),
    warnings: t.field({ type: ["String"], resolve: (r) => r.warnings }),
    advisories: t.field({ type: ["String"], resolve: (r) => r.advisories }),
    artifactId: t.string({ nullable: true, resolve: (r) => r.artifactId ?? null }),
    batchId: t.exposeString("batchId"),
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
      // Row-scope: PRINCIPAL/OFFICE bypass; TEACHER must have a grant covering this content
      await assertCanRead(ctx, "", doc.subject, doc.subject);
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

      // Supervisory scope (J1.6): PRINCIPAL/OFFICE see everything; TEACHER scope applied per-result
      const docs = await ContentArtifact.find(filter).lean();

      if (ctx.auth.role === "PRINCIPAL" || ctx.auth.role === "OFFICE") {
        return docs.map(docToShape);
      }

      // For TEACHER, filter to what their scope union covers (assertCanRead per-doc is expensive;
      // we check subject-level scope here — the authz middleware handles class-level when needed)
      const allowed: ArtifactShape[] = [];
      for (const doc of docs) {
        try {
          await assertCanRead(ctx, "", doc.subject, doc.subject);
          allowed.push(docToShape(doc));
        } catch {
          // skip artifacts outside the teacher's scope
        }
      }
      return allowed;
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

      // Apply scope filter for TEACHERs
      const visibleDocs: typeof docs = [];
      if (ctx.auth.role === "PRINCIPAL" || ctx.auth.role === "OFFICE") {
        visibleDocs.push(...docs);
      } else {
        for (const doc of docs) {
          try {
            await assertCanRead(ctx, "", doc.subject, doc.subject);
            visibleDocs.push(doc);
          } catch {
            // outside scope — skip
          }
        }
      }

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
