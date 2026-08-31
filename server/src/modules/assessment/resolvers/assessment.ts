/**
 * Assessment module resolvers — basket + assembly (J3.1–J3.5).
 *
 * Mutations (all require write-scope via assertCanWrite):
 *   createSet       — J3.1/J3.2 draft set with section+type
 *   addQuestionToSet — J3.1 basket accumulation; emits questions_selected event
 *   assembleSet     — J3.2 finalise; enforces write-scope (J3.5); emits set_assembled
 *
 * Queries:
 *   assessmentSet   — fetch one set (section read-scope enforced)
 *   assessmentSets  — list sets for a section (read-scope enforced)
 *
 * Write-scope rule (J3.5): assertCanWrite requires teaching or proxy grant for the
 * section. Supervisory-only teachers cannot write → ForbiddenError. PRINCIPAL can.
 */
import { builder } from "../../../schema";
import {
  createSet as createSetSvc,
  createSetWithQuestions as createSetWithQuestionsSvc,
  addQuestionToSet as addQuestionSvc,
  removeQuestionFromSet as removeQuestionSvc,
  renameSet as renameSetSvc,
  assembleSet as assembleSetSvc,
  listMyRecentSets,
  type RecentSetItem,
} from "../services/AssessmentService";
import { AssessmentSet } from "../models/AssessmentSet";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { assertCanWrite, assertCanRead, ForbiddenError } from "../../../middleware/authz";
import type { Types, FlattenMaps } from "mongoose";
import type { IAssessmentSet, BasketItem } from "../models/AssessmentSet";

type LeanSet = FlattenMaps<IAssessmentSet> & { _id: Types.ObjectId };

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

interface BasketItemShape {
  artifactId: string;
  qid: string;
  marks: number;
  /** Full question payload (envelopeJson.payload) as JSON — populated only by the
   *  single-set query so the detail screen can render the question + answer. Null on
   *  list/mutation responses (they don't fetch artifacts). */
  payloadJson?: string | null;
}

const BasketItemRef = builder.objectRef<BasketItemShape>("BasketItem");
BasketItemRef.implement({
  fields: (t) => ({
    artifactId: t.exposeString("artifactId"),
    qid: t.exposeString("qid"),
    marks: t.exposeFloat("marks"),
    payloadJson: t.string({ nullable: true, resolve: (b) => b.payloadJson ?? null }),
  }),
});

interface AssessmentSetShape {
  _id: Types.ObjectId;
  id: string;
  setType: string;
  name?: string | null;
  sectionId: string;
  classId: string;
  subjectId?: string | null;
  status: string;
  basketItems: BasketItemShape[];
  totalMarks?: number | null;
  durationMinutes?: number | null;
  /** Exam-time basis, frozen at assembly (QT-1). `durationMinutes` is what the set CLAIMS. */
  examMinutes?: number | null;
  dueDate?: string | null;
  createdBy: string;
  assembledBy?: string | null;
  assembledAt?: string | null;
  createdAt: Date;
}

const AssessmentSetRef = builder.objectRef<AssessmentSetShape>("AssessmentSet");
AssessmentSetRef.implement({
  description: "An assessment set (HW/AS/CT) with its basket of questions.",
  fields: (t) => ({
    id: t.exposeString("id"),
    setType: t.exposeString("setType"),
    name: t.string({ nullable: true, resolve: (s) => s.name ?? null }),
    sectionId: t.exposeString("sectionId"),
    classId: t.exposeString("classId"),
    subjectId: t.string({ nullable: true, resolve: (s) => s.subjectId ?? null }),
    status: t.exposeString("status"),
    basketItems: t.field({ type: [BasketItemRef], resolve: (s) => s.basketItems }),
    totalMarks: t.float({ nullable: true, resolve: (s) => s.totalMarks ?? null }),
    durationMinutes: t.int({ nullable: true, resolve: (s) => s.durationMinutes ?? null }),
    /**
     * The exam-time basis this set's duration came from (QT-2, D-#607).
     *
     * QT-1 snapshot it and never exposed it, so the value was written and unreadable. Both
     * numbers are shown together because they answer different questions: `examMinutes` is
     * how long the questions take, `durationMinutes` is how long THIS set claims to take —
     * for homework the second is double the first, and seeing only one hides that.
     */
    examMinutes: t.int({ nullable: true, resolve: (s) => s.examMinutes ?? null }),
    dueDate: t.string({ nullable: true, resolve: (s) => s.dueDate ?? null }),
    createdBy: t.exposeString("createdBy"),
    assembledBy: t.string({ nullable: true, resolve: (s) => s.assembledBy ?? null }),
    assembledAt: t.string({ nullable: true, resolve: (s) => s.assembledAt ?? null }),
    createdAt: t.string({ resolve: (s) => s.createdAt.toISOString() }),
  }),
});

interface AssembleResultShape {
  setId: string;
  status: string;
  itemCount: number;
  totalMarks: number;
  assembledAt: string;
}

const AssembleResultRef = builder.objectRef<AssembleResultShape>("AssembleResult");
AssembleResultRef.implement({
  fields: (t) => ({
    setId: t.exposeString("setId"),
    status: t.exposeString("status"),
    itemCount: t.exposeInt("itemCount"),
    totalMarks: t.exposeFloat("totalMarks"),
    assembledAt: t.exposeString("assembledAt"),
  }),
});

// ---------------------------------------------------------------------------
// Helper: lean doc → shape
// ---------------------------------------------------------------------------

function setToShape(doc: LeanSet, payloadById?: Map<string, string>): AssessmentSetShape {
  const items = (doc.basketItems ?? []) as unknown as BasketItem[];
  return {
    _id: doc._id,
    id: doc._id.toString(),
    setType: doc.setType,
    name: doc.name ?? null,
    sectionId: doc.sectionId.toString(),
    classId: doc.classId.toString(),
    subjectId: doc.subjectId?.toString() ?? null,
    status: doc.status,
    basketItems: items.map((item) => ({
      artifactId: item.artifactId.toString(),
      qid: item.qid,
      marks: item.marks,
      payloadJson: payloadById?.get(item.artifactId.toString()) ?? null,
    })),
    totalMarks: typeof doc.totalMarks === "number" ? doc.totalMarks : null,
    durationMinutes: typeof doc.durationMinutes === "number" ? doc.durationMinutes : null,
    examMinutes: typeof doc.examMinutes === "number" ? doc.examMinutes : null,
    dueDate: doc.dueDate ? (doc.dueDate as unknown as Date).toISOString() : null,
    createdBy: doc.createdBy.toString(),
    assembledBy: doc.assembledBy?.toString() ?? null,
    assembledAt: doc.assembledAt ? (doc.assembledAt as unknown as Date).toISOString() : null,
    createdAt: doc.createdAt as unknown as Date,
  };
}

// ---------------------------------------------------------------------------
// Mutation: createSet — J3.1/J3.2
// ---------------------------------------------------------------------------

builder.mutationField("createSet", (t) =>
  t.field({
    type: AssessmentSetRef,
    description: "Create a draft assessment set. Requires write-scope for the section (J3.5).",
    authScopes: { hasPermission: "set:assemble" },
    args: {
      setType: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      subjectId: t.arg.string({ required: false }),
      name: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      // J3.5 — only teaching or proxy grant permits assembly (supervisory is read-only)
      await assertCanWrite(ctx, args.sectionId, args.subjectId ?? undefined);

      const result = await createSetSvc({
        setType: args.setType as import("@scd/shared").SetType,
        sectionId: args.sectionId,
        classId: args.classId,
        subjectId: args.subjectId ?? undefined,
        name: args.name ?? undefined,
        actorId: ctx.auth.userId as string,
      });

      const doc = await AssessmentSet.findById(result.setId).lean() as LeanSet;
      return setToShape(doc);
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: createSetWithQuestions — one-step transactional create (ux-audit F6/F10)
// ---------------------------------------------------------------------------

builder.mutationField("createSetWithQuestions", (t) =>
  t.field({
    type: AssessmentSetRef,
    description:
      "Create an assessment set in one step: validate every artifact, then create the set " +
      "directly in `assembled` status with the ordered basket. Atomic — a failure writes " +
      "nothing (no half-populated draft). Write-scope enforced (J3.5). Returns the full set " +
      "so the client document cache invalidates set lists.",
    authScopes: { hasPermission: "set:assemble" },
    args: {
      setType: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      subjectId: t.arg.string({ required: false }),
      name: t.arg.string({ required: false }),
      /** Ordered — basketItems preserve this order. */
      artifactIds: t.arg.stringList({ required: true }),
      /** HW / AS only — ISO date string */
      dueDate: t.arg.string({ required: false }),
      /** CT only */
      durationMinutes: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      // J3.5 — only teaching or proxy grant permits assembly (supervisory is read-only)
      await assertCanWrite(ctx, args.sectionId, args.subjectId ?? undefined);

      const result = await createSetWithQuestionsSvc({
        setType: args.setType as import("@scd/shared").SetType,
        sectionId: args.sectionId,
        classId: args.classId,
        subjectId: args.subjectId ?? undefined,
        name: args.name ?? undefined,
        artifactIds: args.artifactIds,
        dueDate: args.dueDate ?? undefined,
        durationMinutes: args.durationMinutes ?? undefined,
        actorId: ctx.auth.userId as string,
      });

      const doc = await AssessmentSet.findById(result.setId).lean() as LeanSet;
      return setToShape(doc);
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: addQuestionToSet — J3.1 basket
// ---------------------------------------------------------------------------

builder.mutationField("addQuestionToSet", (t) =>
  t.field({
    type: AssessmentSetRef,
    description: "Add a question to a draft set basket. Write-scope enforced (J3.5).",
    authScopes: { hasPermission: "question:select" },
    args: {
      setId: t.arg.string({ required: true }),
      artifactId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      // Resolve the set's sectionId for the write-scope check
      const setDoc = await AssessmentSet.findById(args.setId).lean() as LeanSet | null;
      if (!setDoc) throw new Error("AssessmentSet not found");
      await assertCanWrite(ctx, setDoc.sectionId.toString(), setDoc.subjectId ? setDoc.subjectId.toString() : undefined);

      await addQuestionSvc(
        args.setId,
        args.artifactId,
        ctx.auth.userId as string,
      );

      const updated = await AssessmentSet.findById(args.setId).lean() as LeanSet;
      return setToShape(updated);
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: renameSet — set/clear the display name (any status)
// ---------------------------------------------------------------------------

builder.mutationField("renameSet", (t) =>
  t.field({
    type: AssessmentSetRef,
    description: "Set or clear a set's display name. Any status; write-scope enforced (J3.5).",
    authScopes: { hasPermission: "set:assemble" },
    args: {
      setId: t.arg.string({ required: true }),
      name: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const setDoc = await AssessmentSet.findById(args.setId).lean() as LeanSet | null;
      if (!setDoc) throw new Error("AssessmentSet not found");
      await assertCanWrite(ctx, setDoc.sectionId.toString(), setDoc.subjectId ? setDoc.subjectId.toString() : undefined);

      await renameSetSvc(args.setId, args.name);

      const updated = await AssessmentSet.findById(args.setId).lean() as LeanSet;
      return setToShape(updated);
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: removeQuestionFromSet — J3 draft edit
// ---------------------------------------------------------------------------

builder.mutationField("removeQuestionFromSet", (t) =>
  t.field({
    type: AssessmentSetRef,
    description: "Remove a question from a draft set. Draft-only; write-scope enforced (J3.5).",
    authScopes: { hasPermission: "question:select" },
    args: {
      setId: t.arg.string({ required: true }),
      artifactId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const setDoc = await AssessmentSet.findById(args.setId).lean() as LeanSet | null;
      if (!setDoc) throw new Error("AssessmentSet not found");
      await assertCanWrite(ctx, setDoc.sectionId.toString(), setDoc.subjectId ? setDoc.subjectId.toString() : undefined);

      await removeQuestionSvc(args.setId, args.artifactId);

      const updated = await AssessmentSet.findById(args.setId).lean() as LeanSet;
      return setToShape(updated);
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: assembleSet — J3.2 finalise
// ---------------------------------------------------------------------------

builder.mutationField("assembleSet", (t) =>
  t.field({
    type: AssembleResultRef,
    description: "Finalise a draft set. Enforces write-scope (J3.5). Emits set_assembled event.",
    authScopes: { hasPermission: "set:assemble" },
    args: {
      setId: t.arg.string({ required: true }),
      /** CT only */
      durationMinutes: t.arg.int({ required: false }),
      /** HW / AS only — ISO date string */
      dueDate: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const setDoc = await AssessmentSet.findById(args.setId).lean() as LeanSet | null;
      if (!setDoc) throw new Error("AssessmentSet not found");
      await assertCanWrite(ctx, setDoc.sectionId.toString(), setDoc.subjectId ? setDoc.subjectId.toString() : undefined);

      const result = await assembleSetSvc({
        setId: args.setId,
        actorId: ctx.auth.userId as string,
        durationMinutes: args.durationMinutes ?? undefined,
        dueDate: args.dueDate ?? undefined,
      });

      return result;
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: assessmentSet — single set by id
// ---------------------------------------------------------------------------

builder.queryField("assessmentSet", (t) =>
  t.field({
    type: AssessmentSetRef,
    nullable: true,
    description: "Fetch an assessment set by id. Read-scope enforced.",
    authScopes: { hasPermission: "set:read" },
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const doc = await AssessmentSet.findById(args.id).lean() as LeanSet | null;
      if (!doc) return null;
      // Read-scope: sectionId-level check (classId as second param serves as classId)
      await assertCanRead(ctx, doc.sectionId.toString(), doc.classId.toString());

      // Enrich each basket item with its question payload so the detail screen can
      // render the full question + answer (J3 view). Batched in one query.
      const items = (doc.basketItems ?? []) as unknown as BasketItem[];
      const artifactIds = items.map((i) => i.artifactId.toString());
      const artifacts = await ContentArtifact.find({ _id: { $in: artifactIds } })
        .select("envelopeJson")
        .lean();
      const payloadById = new Map<string, string>();
      for (const a of artifacts) {
        const env = a.envelopeJson as Record<string, unknown>;
        payloadById.set(a._id.toString(), JSON.stringify(env.payload ?? {}));
      }
      return setToShape(doc, payloadById);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: assessmentSets — list for a section
// ---------------------------------------------------------------------------

builder.queryField("assessmentSets", (t) =>
  t.field({
    type: [AssessmentSetRef],
    description: "List assessment sets for a section. Read-scope enforced.",
    authScopes: { hasPermission: "set:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      status: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);

      const filter: Record<string, unknown> = { sectionId: args.sectionId };
      if (args.status) filter.status = args.status;

      const docs = await AssessmentSet.find(filter).sort({ createdAt: -1 }).lean() as LeanSet[];
      return docs.map((d) => setToShape(d));
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: myRecentSets — the caller's newest sets across all sections (ux-audit F7)
// ---------------------------------------------------------------------------

const MyRecentSetRef = builder.objectRef<RecentSetItem>("MyRecentSet");
MyRecentSetRef.implement({
  description:
    "A recently created/assembled set of the caller, with the id of its still-open " +
    "tracker (if any) so the Today screen can jump straight into TrackerEntry.",
  fields: (t) => ({
    id: t.exposeString("id"),
    setType: t.exposeString("setType"),
    name: t.string({ nullable: true, resolve: (s) => s.name }),
    sectionId: t.exposeString("sectionId"),
    classId: t.exposeString("classId"),
    subjectId: t.string({ nullable: true, resolve: (s) => s.subjectId }),
    status: t.exposeString("status"),
    itemCount: t.exposeInt("itemCount"),
    totalMarks: t.float({ nullable: true, resolve: (s) => s.totalMarks }),
    dueDate: t.string({ nullable: true, resolve: (s) => s.dueDate }),
    createdAt: t.exposeString("createdAt"),
    openTrackerId: t.string({ nullable: true, resolve: (s) => s.openTrackerId }),
  }),
});

builder.queryField("myRecentSets", (t) =>
  t.field({
    type: [MyRecentSetRef],
    description:
      "The caller's most recently created/assembled sets across ALL their sections. " +
      "Self-scoped (createdBy/assembledBy = caller), so no section read-scope check.",
    authScopes: { hasPermission: "set:read" },
    args: {
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const limit = Math.min(Math.max(args.limit ?? 2, 1), 10);
      return listMyRecentSets(ctx.auth.userId as string, limit);
    },
  }),
);
