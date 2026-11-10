/**
 * AI Workspace (W-1, docs/prd-ai-workspace.md §3) — projects, members, instructions, files.
 * Every field needs `ai_workspace:use` or `ai_workspace:admin`; the service then checks the
 * caller's role in the project (viewer / editor / owner; admin = owner). Files are uploaded
 * through POST /files/ai-workspace; their text is read here by character range.
 */
import type { Permission } from "@scd/shared";
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import {
  aiProject,
  aiProjectContextBudget,
  aiProjectInstructions,
  aiProjectInstructionVersionsPage,
  aiProjectsPage,
  aiWorkspaceMemberCandidates,
  createAiProject,
  saveAiProjectInstructions,
  setAiProjectMembers,
  updateAiProject,
  type AiProjectMemberView,
  type AiProjectView,
  type ContextBudget,
  type MemberCandidate,
} from "../services/AiProjectService";
import {
  aiProjectFilesPage,
  aiProjectFileText,
  deleteAiProjectFile,
  rereadAiProjectFile,
  updateAiProjectFile,
  type AiProjectFileText,
  type AiProjectFileView,
} from "../services/FileIngestService";
import type { ProjectPolicyVersion, AiPolicyVersionView } from "../../platform/services/AiPolicyService";
import { mcpConnections, revokeMcpConnection, type McpConnectionView } from "../mcp/connections";

const WS_SCOPE: { hasAnyPermission: Permission[] } = { hasAnyPermission: ["ai_workspace:use", "ai_workspace:admin"] };
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

const MemberRef = builder.objectRef<AiProjectMemberView>("AiProjectMember").implement({
  fields: (t) => ({
    userId: t.string({ resolve: (m) => m.userId }),
    name: t.string({ resolve: (m) => m.name }),
    role: t.string({ description: "owner | editor | viewer", resolve: (m) => m.role }),
  }),
});

const ProjectRef = builder.objectRef<AiProjectView>("AiProject").implement({
  fields: (t) => ({
    id: t.string({ resolve: (p) => p.id }),
    name: t.string({ resolve: (p) => p.name }),
    description: t.string({ nullable: true, resolve: (p) => p.description }),
    ownerName: t.string({ nullable: true, resolve: (p) => p.ownerName }),
    myRole: t.string({ description: "owner | editor | viewer (ai_workspace:admin = owner).", resolve: (p) => p.myRole }),
    members: t.field({ type: [MemberRef], resolve: (p) => p.members }),
    defaultModel: t.string({ resolve: (p) => p.defaultModel }),
    defaultThinking: t.string({ description: "off | low | high", resolve: (p) => p.defaultThinking }),
    nameProtection: t.boolean({ description: "ON = de-identification + the fail-closed roster gate on every turn (D-#1207).", resolve: (p) => p.nameProtection }),
    monthlyCapUsd: t.float({ nullable: true, description: "The project's own monthly cap; null = none.", resolve: (p) => p.monthlyCapUsd }),
    archived: t.boolean({ resolve: (p) => p.archived }),
    fileCount: t.int({ resolve: (p) => p.fileCount }),
    createdAt: t.string({ resolve: (p) => iso(p.createdAt)! }),
    updatedAt: t.string({ resolve: (p) => iso(p.updatedAt)! }),
  }),
});
const ProjectPageRef = pageRef("AiProjectPage", ProjectRef);

const CandidateRef = builder.objectRef<MemberCandidate>("AiProjectMemberCandidate").implement({
  fields: (t) => ({
    userId: t.string({ resolve: (c) => c.userId }),
    name: t.string({ resolve: (c) => c.name }),
  }),
});

const InstructionRef = builder.objectRef<ProjectPolicyVersion>("AiProjectInstructions").implement({
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.id }),
    version: t.int({ resolve: (v) => v.version }),
    body: t.string({ description: "Markdown — the start of every prompt in this project.", resolve: (v) => v.body }),
    hash: t.string({ description: "project:<id>@vN#sha12 — stamped on every AI result.", resolve: (v) => v.hash }),
    note: t.string({ nullable: true, resolve: (v) => v.note }),
    createdAt: t.string({ resolve: (v) => iso(v.createdAt)! }),
  }),
});

const InstructionVersionRef = builder.objectRef<AiPolicyVersionView>("AiProjectInstructionVersion").implement({
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.id }),
    version: t.int({ resolve: (v) => v.version }),
    body: t.string({ resolve: (v) => v.body }),
    hash: t.string({ resolve: (v) => v.hash }),
    note: t.string({ nullable: true, resolve: (v) => v.note }),
    active: t.boolean({ resolve: (v) => v.active }),
    createdAt: t.string({ resolve: (v) => iso(v.createdAt)! }),
    createdByName: t.string({ nullable: true, resolve: (v) => v.createdByName }),
  }),
});
const InstructionVersionPageRef = pageRef("AiProjectInstructionVersionPage", InstructionVersionRef);

export const AiProjectFileRef = builder.objectRef<AiProjectFileView>("AiProjectFile").implement({
  fields: (t) => ({
    id: t.string({ resolve: (f) => f.id }),
    projectId: t.string({ resolve: (f) => f.projectId }),
    name: t.string({ resolve: (f) => f.name }),
    mime: t.string({ resolve: (f) => f.mime }),
    sizeBytes: t.int({ resolve: (f) => f.sizeBytes }),
    storedFileId: t.string({ nullable: true, description: "Open the original through GET /files/:id.", resolve: (f) => f.storedFileId }),
    status: t.string({ description: "processing | ready | failed", resolve: (f) => f.status }),
    error: t.string({ nullable: true, description: "Why it failed, or a note (e.g. only the first 80 pages read).", resolve: (f) => f.error }),
    textSource: t.string({ nullable: true, description: "text | tesseract | gemini", resolve: (f) => f.textSource ?? null }),
    pages: t.int({ nullable: true, resolve: (f) => f.pages }),
    chars: t.int({ resolve: (f) => f.chars }),
    tokenCount: t.int({ resolve: (f) => f.tokenCount }),
    tokenMethod: t.string({ nullable: true, description: "tokenizer | estimate | measured", resolve: (f) => f.tokenMethod ?? null }),
    pinned: t.boolean({ resolve: (f) => f.pinned }),
    order: t.int({ resolve: (f) => f.order }),
    at: t.string({ resolve: (f) => iso(f.at)! }),
  }),
});
const FileRef = AiProjectFileRef;
const FilePageRef = pageRef("AiProjectFilePage", FileRef);

const FileTextRef = builder.objectRef<AiProjectFileText>("AiProjectFileText").implement({
  fields: (t) => ({
    fileId: t.string({ resolve: (x) => x.fileId }),
    name: t.string({ resolve: (x) => x.name }),
    offset: t.int({ resolve: (x) => x.offset }),
    text: t.string({ resolve: (x) => x.text }),
    totalChars: t.int({ resolve: (x) => x.totalChars }),
  }),
});

const BudgetRef = builder.objectRef<ContextBudget>("AiProjectContextBudget").implement({
  fields: (t) => ({
    model: t.string({ resolve: (b) => b.model }),
    instructionTokens: t.int({ resolve: (b) => b.instructionTokens }),
    fileTokens: t.int({ resolve: (b) => b.fileTokens }),
    pinnedFiles: t.int({ resolve: (b) => b.pinnedFiles }),
    totalTokens: t.int({ resolve: (b) => b.totalTokens }),
    windowTokens: t.int({ resolve: (b) => b.windowTokens }),
    warnTokens: t.int({ resolve: (b) => b.warnTokens }),
    maxTokens: t.int({ resolve: (b) => b.maxTokens }),
    warn: t.boolean({ resolve: (b) => b.warn }),
    over: t.boolean({ resolve: (b) => b.over }),
    costPerMessageCacheHitUsd: t.float({ resolve: (b) => b.costPerMessageCacheHitUsd }),
    costPerMessageCacheMissUsd: t.float({ resolve: (b) => b.costPerMessageCacheMissUsd }),
    spentThisMonthUsd: t.float({ resolve: (b) => b.spentThisMonthUsd }),
    monthlyCapUsd: t.float({ nullable: true, resolve: (b) => b.monthlyCapUsd }),
  }),
});

// ---- queries ----

builder.queryField("aiProjectsPage", (t) =>
  t.field({
    type: ProjectPageRef,
    description: "Projects I am a member of (every project for ai_workspace:admin), newest first.",
    authScopes: WS_SCOPE,
    args: { archived: t.arg.boolean({ required: false }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => aiProjectsPage(ctx.auth, { archived: a.archived, page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("aiProject", (t) =>
  t.field({ type: ProjectRef, authScopes: WS_SCOPE, args: { id: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => aiProject(ctx.auth, a.id) }),
);

builder.queryField("aiProjectContextBudget", (t) =>
  t.field({
    type: BudgetRef,
    description: "Instructions + pinned files in tokens, the cost of that prefix per message, and this month's spend.",
    authScopes: WS_SCOPE,
    args: { projectId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => aiProjectContextBudget(ctx.auth, a.projectId),
  }),
);

builder.queryField("aiProjectInstructions", (t) =>
  t.field({
    type: InstructionRef,
    nullable: true,
    description: "The current instructions; null until the first version is saved.",
    authScopes: WS_SCOPE,
    args: { projectId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => aiProjectInstructions(ctx.auth, a.projectId),
  }),
);

builder.queryField("aiProjectInstructionVersionsPage", (t) =>
  t.field({
    type: InstructionVersionPageRef,
    authScopes: WS_SCOPE,
    args: { projectId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => aiProjectInstructionVersionsPage(ctx.auth, a.projectId, { page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("aiProjectFilesPage", (t) =>
  t.field({
    type: FilePageRef,
    description: "The project's knowledge files in prompt order.",
    authScopes: WS_SCOPE,
    args: { projectId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => aiProjectFilesPage(ctx.auth, a.projectId, { page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("aiProjectFileText", (t) =>
  t.field({
    type: FileTextRef,
    description: "A slice of a file's text (default the first 20,000 characters; at most 100,000).",
    authScopes: WS_SCOPE,
    args: { fileId: t.arg.string({ required: true }), offset: t.arg.int({ required: false }), limit: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => aiProjectFileText(ctx.auth, a.fileId, a.offset, a.limit),
  }),
);

builder.queryField("aiWorkspaceMemberCandidates", (t) =>
  t.field({
    type: [CandidateRef],
    description: "Staff who hold ai_workspace:use (or admin) — the people a project can add.",
    authScopes: WS_SCOPE,
    resolve: (_r, _a, ctx) => aiWorkspaceMemberCandidates(ctx.auth),
  }),
);

// ---- mutations ----

builder.mutationField("createAiProject", (t) =>
  t.field({
    type: ProjectRef,
    description: "A new project; the creator is its owner. Model / thinking default to the workspace defaults.",
    authScopes: WS_SCOPE,
    args: {
      name: t.arg.string({ required: true }),
      description: t.arg.string({ required: false }),
      nameProtection: t.arg.boolean({ required: true }),
      defaultModel: t.arg.string({ required: false }),
      defaultThinking: t.arg.string({ required: false }),
      monthlyCapUsd: t.arg.float({ required: false }),
    },
    resolve: (_r, a, ctx) => createAiProject(ctx.auth, a),
  }),
);

builder.mutationField("updateAiProject", (t) =>
  t.field({
    type: ProjectRef,
    description: "Owner only: name, description, defaults, name protection, monthly cap, archive.",
    authScopes: WS_SCOPE,
    args: {
      id: t.arg.string({ required: true }),
      name: t.arg.string({ required: false }),
      description: t.arg.string({ required: false }),
      defaultModel: t.arg.string({ required: false }),
      defaultThinking: t.arg.string({ required: false }),
      nameProtection: t.arg.boolean({ required: false }),
      monthlyCapUsd: t.arg.float({ required: false }),
      clearMonthlyCap: t.arg.boolean({ required: false }),
      archived: t.arg.boolean({ required: false }),
    },
    resolve: (_r, a, ctx) => updateAiProject(ctx.auth, a.id, a),
  }),
);

const MemberInput = builder.inputType("AiProjectMemberInput", {
  fields: (t) => ({ userId: t.string({ required: true }), role: t.string({ required: true }) }),
});

builder.mutationField("setAiProjectMembers", (t) =>
  t.field({
    type: ProjectRef,
    description: "Owner only: replace the member list (at least one owner).",
    authScopes: WS_SCOPE,
    args: { id: t.arg.string({ required: true }), members: t.arg({ type: [MemberInput], required: true }) },
    resolve: (_r, a, ctx) => setAiProjectMembers(ctx.auth, a.id, a.members),
  }),
);

builder.mutationField("saveAiProjectInstructions", (t) =>
  t.field({
    type: InstructionRef,
    description: "Editor: a new instructions version, which becomes the current one. Audited without the text.",
    authScopes: WS_SCOPE,
    args: { projectId: t.arg.string({ required: true }), body: t.arg.string({ required: true }), note: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => saveAiProjectInstructions(ctx.auth, a.projectId, a.body, a.note),
  }),
);

builder.mutationField("updateAiProjectFile", (t) =>
  t.field({
    type: FileRef,
    description: "Editor: pin / unpin (refused past the 400k-token prefix), reorder, rename.",
    authScopes: WS_SCOPE,
    args: { fileId: t.arg.string({ required: true }), pinned: t.arg.boolean({ required: false }), order: t.arg.int({ required: false }), name: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => updateAiProjectFile(ctx.auth, a.fileId, { pinned: a.pinned, order: a.order, name: a.name }),
  }),
);

builder.mutationField("rereadAiProjectFile", (t) =>
  t.field({
    type: FileRef,
    description: "Editor: read the original again — auto | tesseract (OCR on the server) | gemini (Gemini vision, metered).",
    authScopes: WS_SCOPE,
    args: { fileId: t.arg.string({ required: true }), mode: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      const { file, done } = await rereadAiProjectFile(ctx.auth, a.fileId, a.mode);
      done.catch((e) => console.warn("ai workspace re-read crashed:", (e as Error)?.message));
      return file;
    },
  }),
);

builder.mutationField("deleteAiProjectFile", (t) =>
  t.boolean({
    description: "Editor: remove the file and its stored original.",
    authScopes: WS_SCOPE,
    args: { fileId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => deleteAiProjectFile(ctx.auth, a.fileId),
  }),
);

// ---- W-5: the MCP bridge's connections (D-#1214) ----

const McpConnectionRef = builder.objectRef<McpConnectionView>("AiMcpConnection").implement({
  fields: (t) => ({
    clientId: t.string({ resolve: (c) => c.clientId }),
    clientName: t.string({ resolve: (c) => c.clientName }),
    connectedAt: t.string({ resolve: (c) => iso(c.connectedAt)! }),
    lastUsedAt: t.string({ nullable: true, resolve: (c) => iso(c.lastUsedAt) }),
    calls30d: t.int({ resolve: (c) => c.calls30d }),
    replyKb30d: t.float({ description: "Size of the replies sent to this client in 30 days (PRD §7).", resolve: (c) => c.replyKb30d }),
  }),
});

builder.queryField("aiMcpConnections", (t) =>
  t.field({
    type: [McpConnectionRef],
    description: "Clients (Claude, Claude Code) holding live MCP tokens. ai_workspace:admin.",
    authScopes: { hasPermission: "ai_workspace:admin" },
    resolve: (_r, _a, ctx) => mcpConnections(ctx.auth),
  }),
);

builder.mutationField("revokeAiMcpConnection", (t) =>
  t.boolean({
    description: "Disconnect a client: revokes every token it holds. ai_workspace:admin. Audited.",
    authScopes: { hasPermission: "ai_workspace:admin" },
    args: { clientId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => revokeMcpConnection(ctx.auth, a.clientId),
  }),
);
