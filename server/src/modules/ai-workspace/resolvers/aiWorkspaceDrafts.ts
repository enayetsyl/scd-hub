/**
 * AI Workspace W-3 (docs/prd-ai-workspace.md §5) — drafts: create / from a chat answer,
 * versions, approve, revise with notes (AI, now or off-peak), preview + send to a pipeline.
 * Export is GET /files/ai-draft/:draftId/export?format=docx|pdf (no AI).
 */
import type { Permission } from "@scd/shared";
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import {
  approveDraft,
  cancelDraftRevision,
  createDraft,
  draft,
  draftsPage,
  draftVersion,
  draftVersionsPage,
  previewDraftSend,
  reviseDraft,
  saveDraftFromMessage,
  saveDraftVersion,
  scoreDraft,
  sendDraftToPipeline,
  setDraftArchived,
  type DraftVersionView,
  type DraftView,
  type PlanCheckView,
  type PipelinePreview,
  type SendResult,
} from "../services/DraftService";

const WS_SCOPE: { hasAnyPermission: Permission[] } = { hasAnyPermission: ["ai_workspace:use", "ai_workspace:admin"] };
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

interface ReviseView {
  status: string;
  runAfter: Date | null;
  error: string | null;
  notes: string;
}
const ReviseRef = builder.objectRef<ReviseView>("AiDraftRevise").implement({
  fields: (t) => ({
    status: t.string({ description: "queued | running | failed | stopped", resolve: (r) => r.status }),
    runAfter: t.string({ nullable: true, resolve: (r) => iso(r.runAfter) }),
    error: t.string({ nullable: true, resolve: (r) => r.error }),
    notes: t.string({ resolve: (r) => r.notes }),
  }),
});

type ReviewView = NonNullable<DraftView["review"]>;
const ReviewRef = builder.objectRef<ReviewView>("AiDraftReview").implement({
  fields: (t) => ({
    score: t.string({ description: "usable | minor | rewrite", resolve: (r) => r.score }),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
    byName: t.string({ nullable: true, resolve: (r) => r.byName }),
    at: t.string({ resolve: (r) => iso(r.at)! }),
    version: t.int({ resolve: (r) => r.version }),
  }),
});

type SendView = DraftView["sends"][number];
const SendRef = builder.objectRef<SendView>("AiDraftSend").implement({
  fields: (t) => ({
    pipeline: t.string({ resolve: (s) => s.pipeline }),
    version: t.int({ resolve: (s) => s.version }),
    ok: t.boolean({ resolve: (s) => s.ok }),
    summary: t.string({ resolve: (s) => s.summary }),
    at: t.string({ resolve: (s) => iso(s.at)! }),
  }),
});

const DraftRef = builder.objectRef<DraftView>("AiDraft").implement({
  fields: (t) => ({
    id: t.string({ resolve: (d) => d.id }),
    projectId: t.string({ resolve: (d) => d.projectId }),
    title: t.string({ resolve: (d) => d.title }),
    kind: t.string({ description: "free | lesson_plan | question_bank | book_chapter | storybook | paper", resolve: (d) => d.kind }),
    status: t.string({ description: "draft | approved (the current version is the approved one)", resolve: (d) => d.status }),
    currentVersion: t.int({ resolve: (d) => d.currentVersion }),
    approvedVersion: t.int({ nullable: true, resolve: (d) => d.approvedVersion }),
    approvedByName: t.string({ nullable: true, resolve: (d) => d.approvedByName }),
    approvedAt: t.string({ nullable: true, resolve: (d) => iso(d.approvedAt) }),
    createdByName: t.string({ nullable: true, resolve: (d) => d.createdByName }),
    origin: t.string({ description: "app | claude", resolve: (d) => d.origin }),
    revise: t.field({ type: ReviseRef, nullable: true, resolve: (d) => d.revise }),
    sends: t.field({ type: [SendRef], resolve: (d) => d.sends }),
    canSend: t.boolean({ description: "Approved, unchanged since, and of a kind with a pipeline.", resolve: (d) => d.canSend }),
    review: t.field({ type: ReviewRef, nullable: true, description: "W-6 pilot score by the owner.", resolve: (d) => d.review }),
    updatedAt: t.string({ resolve: (d) => iso(d.updatedAt)! }),
    savedTogether: t.int({ description: "Save-as-draft from an answer with several lesson plans: how many drafts were made (this is the first).", resolve: (d) => d.savedTogether }),
  }),
});
const DraftPageRef = pageRef("AiDraftPage", DraftRef);

const PlanCheckRef = builder.objectRef<PlanCheckView>("AiPlanCheck").implement({
  description: "validate_plan.py's verdict on a lesson-plan version (P09 plan tools).",
  fields: (t) => ({
    verdict: t.string({ description: "PASS | FAIL | ERROR (the validator could not run)", resolve: (c) => c.verdict }),
    fails: t.stringList({ resolve: (c) => c.fails }),
    warns: t.stringList({ resolve: (c) => c.warns }),
    chapterDraftId: t.string({ nullable: true, description: "The chapter-plan draft a multi-period session plan was checked against.", resolve: (c) => c.chapterDraftId }),
    chapterVersion: t.int({ nullable: true, resolve: (c) => c.chapterVersion }),
    at: t.string({ resolve: (c) => iso(c.at)! }),
  }),
});

const VersionRef = builder.objectRef<DraftVersionView>("AiDraftVersion").implement({
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.id }),
    version: t.int({ resolve: (v) => v.version }),
    body: t.string({ description: "Markdown, or JSON text for question_bank / book_chapter. Shortened in the versions list.", resolve: (v) => v.body }),
    planJson: t.string({ nullable: true, description: "lesson_plan: the plan JSON.", resolve: (v) => v.planJson }),
    note: t.string({ nullable: true, resolve: (v) => v.note }),
    source: t.string({ description: "manual | chat | revise | job", resolve: (v) => v.source }),
    policyHash: t.string({ nullable: true, resolve: (v) => v.policyHash }),
    costUsd: t.float({ nullable: true, resolve: (v) => v.costUsd }),
    createdByName: t.string({ nullable: true, resolve: (v) => v.createdByName }),
    origin: t.string({ resolve: (v) => v.origin }),
    planCheck: t.field({ type: PlanCheckRef, nullable: true, description: "lesson_plan: the validator's verdict on this version.", resolve: (v) => v.planCheck }),
    at: t.string({ resolve: (v) => iso(v.at)! }),
  }),
});
const VersionPageRef = pageRef("AiDraftVersionPage", VersionRef);

const DraftWithVersionRef = builder.objectRef<{ draft: DraftView; version: DraftVersionView }>("AiDraftWithVersion").implement({
  fields: (t) => ({
    draft: t.field({ type: DraftRef, resolve: (x) => x.draft }),
    version: t.field({ type: VersionRef, description: "The current version, whole.", resolve: (x) => x.version }),
  }),
});

const PreviewRef = builder.objectRef<PipelinePreview>("AiDraftSendPreview").implement({
  fields: (t) => ({
    pipeline: t.string({ resolve: (p) => p.pipeline }),
    verdict: t.string({ nullable: true, description: "The validator's dry run (lesson plans): PASS | FAIL.", resolve: (p) => p.verdict }),
    failChecks: t.stringList({ resolve: (p) => p.failChecks }),
    replaces: t.string({ nullable: true, description: "What the send replaces — shown in the confirm step (D-#1229).", resolve: (p) => p.replaces }),
    adds: t.string({ resolve: (p) => p.adds }),
  }),
});

const SendResultRef = builder.objectRef<SendResult>("AiDraftSendResult").implement({
  fields: (t) => ({
    ok: t.boolean({ resolve: (r) => r.ok }),
    summary: t.string({ resolve: (r) => r.summary }),
    failChecks: t.stringList({ resolve: (r) => r.failChecks }),
  }),
});

builder.queryField("aiDraftsPage", (t) =>
  t.field({
    type: DraftPageRef,
    authScopes: WS_SCOPE,
    args: { projectId: t.arg.string({ required: true }), archived: t.arg.boolean({ required: false }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => draftsPage(ctx.auth, a.projectId, { archived: a.archived, page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("aiDraft", (t) =>
  t.field({ type: DraftWithVersionRef, authScopes: WS_SCOPE, args: { id: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => draft(ctx.auth, a.id) }),
);

builder.queryField("aiDraftVersion", (t) =>
  t.field({
    type: VersionRef,
    authScopes: WS_SCOPE,
    args: { draftId: t.arg.string({ required: true }), version: t.arg.int({ required: true }) },
    resolve: (_r, a, ctx) => draftVersion(ctx.auth, a.draftId, a.version),
  }),
);

builder.queryField("aiDraftVersionsPage", (t) =>
  t.field({
    type: VersionPageRef,
    authScopes: WS_SCOPE,
    args: { draftId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => draftVersionsPage(ctx.auth, a.draftId, { page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("aiDraftSendPreview", (t) =>
  t.field({
    type: PreviewRef,
    description: "Dry run before a send: the validator's verdict and what would be replaced. Needs the pipeline's permission.",
    authScopes: WS_SCOPE,
    args: { draftId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => previewDraftSend(ctx.auth, a.draftId),
  }),
);

builder.mutationField("createAiDraft", (t) =>
  t.field({
    type: DraftRef,
    authScopes: WS_SCOPE,
    args: {
      projectId: t.arg.string({ required: true }),
      title: t.arg.string({ required: true }),
      kind: t.arg.string({ required: true }),
      body: t.arg.string({ required: true }),
      planJson: t.arg.string({ required: false }),
      note: t.arg.string({ required: false }),
    },
    resolve: (_r, a, ctx) => createDraft(ctx.auth, a.projectId, { title: a.title, kind: a.kind, body: a.body, planJson: a.planJson, note: a.note }),
  }),
);

builder.mutationField("saveAiDraftFromMessage", (t) =>
  t.field({
    type: DraftRef,
    description: "Save a finished AI answer as a draft; a ```json block becomes the JSON part for lesson_plan / question_bank / book_chapter.",
    authScopes: WS_SCOPE,
    args: { messageId: t.arg.string({ required: true }), title: t.arg.string({ required: true }), kind: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => saveDraftFromMessage(ctx.auth, a.messageId, { title: a.title, kind: a.kind }),
  }),
);

builder.mutationField("saveAiDraftVersion", (t) =>
  t.field({
    type: DraftRef,
    description: "Editor: the next version (an approved draft becomes a draft again until re-approved).",
    authScopes: WS_SCOPE,
    args: { draftId: t.arg.string({ required: true }), body: t.arg.string({ required: true }), planJson: t.arg.string({ required: false }), note: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => saveDraftVersion(ctx.auth, a.draftId, { body: a.body, planJson: a.planJson, note: a.note }),
  }),
);

builder.mutationField("approveAiDraft", (t) =>
  t.field({ type: DraftRef, description: "Owner: lock the current version.", authScopes: WS_SCOPE, args: { draftId: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => approveDraft(ctx.auth, a.draftId) }),
);

builder.mutationField("scoreAiDraft", (t) =>
  t.field({
    type: DraftRef,
    description: "Owner: the pilot score — usable | minor | rewrite (PRD §8).",
    authScopes: WS_SCOPE,
    args: { draftId: t.arg.string({ required: true }), score: t.arg.string({ required: true }), note: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => scoreDraft(ctx.auth, a.draftId, { score: a.score, note: a.note }),
  }),
);

builder.mutationField("setAiDraftArchived", (t) =>
  t.field({
    type: DraftRef,
    authScopes: WS_SCOPE,
    args: { draftId: t.arg.string({ required: true }), archived: t.arg.boolean({ required: true }) },
    resolve: (_r, a, ctx) => setDraftArchived(ctx.auth, a.draftId, a.archived),
  }),
);

builder.mutationField("reviseAiDraft", (t) =>
  t.field({
    type: DraftRef,
    description: "Editor: DeepSeek writes the next version from the notes. model, thinking and runAt (now|offpeak) are required.",
    authScopes: WS_SCOPE,
    args: {
      draftId: t.arg.string({ required: true }),
      notes: t.arg.string({ required: true }),
      model: t.arg.string({ required: true }),
      thinking: t.arg.string({ required: true }),
      runAt: t.arg.string({ required: true }),
    },
    resolve: async (_r, a, ctx) => {
      const { draft: d, done } = await reviseDraft(ctx.auth, a.draftId, { notes: a.notes, model: a.model, thinking: a.thinking, runAt: a.runAt });
      done.catch((e) => console.warn("ai draft revision crashed:", (e as Error)?.message));
      return d;
    },
  }),
);

builder.mutationField("cancelAiDraftRevision", (t) =>
  t.field({ type: DraftRef, description: "Cancel a revision waiting for off-peak.", authScopes: WS_SCOPE, args: { draftId: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => cancelDraftRevision(ctx.auth, a.draftId) }),
);

builder.mutationField("sendAiDraftToPipeline", (t) =>
  t.field({
    type: SendResultRef,
    description: "Send the APPROVED draft into its pipeline (a publish, D-#1229). confirm must be true; question banks need a curation tag.",
    authScopes: WS_SCOPE,
    args: {
      draftId: t.arg.string({ required: true }),
      confirm: t.arg.boolean({ required: true }),
      curationTag: t.arg.string({ required: false }),
      unitTitle: t.arg.string({ required: false }),
    },
    resolve: (_r, a, ctx) => sendDraftToPipeline(ctx.auth, a.draftId, { confirm: a.confirm, curationTag: a.curationTag, unitTitle: a.unitTitle }),
  }),
);
