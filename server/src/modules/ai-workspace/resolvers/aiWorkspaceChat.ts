/**
 * AI Workspace W-2 (docs/prd-ai-workspace.md §4) — project chat: chats, turns, the price
 * clock, send (with the three pickers), stop. A sent answer streams into its message row;
 * the web watches GET /events/ai-chat/:messageId, the phone polls `aiProjectChatMessage`.
 */
import type { Permission } from "@scd/shared";
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import {
  projectChat,
  projectChatMessage,
  projectChatMessagesPage,
  projectChatsPage,
  sendProjectMessage,
  startProjectChat,
  stopProjectMessage,
  workspacePriceClock,
  type ChatMessageView,
  type ChatSessionView,
} from "../services/ProjectChatService";
import { aiChatFiles } from "../services/FileIngestService";
import { AiProjectFileRef } from "./aiWorkspace";

const WS_SCOPE: { hasAnyPermission: Permission[] } = { hasAnyPermission: ["ai_workspace:use", "ai_workspace:admin"] };
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

const ChatRef = builder.objectRef<ChatSessionView>("AiProjectChat").implement({
  fields: (t) => ({
    id: t.string({ resolve: (s) => s.id }),
    projectId: t.string({ resolve: (s) => s.projectId }),
    title: t.string({ resolve: (s) => s.title }),
    startedByName: t.string({ nullable: true, resolve: (s) => s.startedByName }),
    turns: t.int({ resolve: (s) => s.turns }),
    lastAt: t.string({ resolve: (s) => iso(s.lastAt)! }),
    model: t.string({ description: "The Model picker's last choice (D-#1205).", resolve: (s) => s.model }),
    thinking: t.string({ description: "off | low | high", resolve: (s) => s.thinking }),
    runAt: t.string({ nullable: true, description: "now | offpeak — null until the first send (no default, D-#1209 spirit).", resolve: (s) => s.runAt }),
    contextTokens: t.int({ description: "Prompt + answer tokens of the latest answer (DeepSeek's count).", resolve: (s) => s.contextTokens }),
    windowTokens: t.int({ resolve: (s) => s.windowTokens }),
    contextUsed: t.float({ description: "contextTokens ÷ window.", resolve: (s) => s.contextUsed }),
    suggestNewChat: t.boolean({ description: "True from 80 % of the window (D-#1204); never shortened automatically.", resolve: (s) => s.suggestNewChat }),
  }),
});
const ChatPageRef = pageRef("AiProjectChatPage", ChatRef);

const MessageRef = builder.objectRef<ChatMessageView>("AiProjectChatMessage").implement({
  fields: (t) => ({
    id: t.string({ resolve: (m) => m.id }),
    sessionId: t.string({ resolve: (m) => m.sessionId }),
    role: t.string({ resolve: (m) => m.role }),
    text: t.string({ resolve: (m) => m.text }),
    at: t.string({ resolve: (m) => iso(m.at)! }),
    status: t.string({ description: "queued | running | done | failed | stopped", resolve: (m) => m.status }),
    modelName: t.string({ nullable: true, resolve: (m) => m.modelName }),
    thinking: t.string({ nullable: true, resolve: (m) => m.thinking }),
    runAt: t.string({ nullable: true, resolve: (m) => m.runAt }),
    runAfter: t.string({ nullable: true, description: "Off-peak: answered from this time.", resolve: (m) => iso(m.runAfter) }),
    error: t.string({ nullable: true, resolve: (m) => m.error }),
    warning: t.string({ nullable: true, resolve: (m) => m.warning }),
    authorName: t.string({ nullable: true, resolve: (m) => m.authorName }),
    tokens: t.int({ nullable: true, resolve: (m) => m.tokens }),
    costUsd: t.float({ nullable: true, resolve: (m) => m.costUsd }),
  }),
});
const MessagePageRef = pageRef("AiProjectChatMessagePage", MessageRef);

interface PerMillion {
  hit: number;
  miss: number;
  output: number;
}
const PerMillionRef = builder.objectRef<PerMillion>("AiPerMillionPrice").implement({
  fields: (t) => ({
    hit: t.float({ resolve: (p) => p.hit }),
    miss: t.float({ resolve: (p) => p.miss }),
    output: t.float({ resolve: (p) => p.output }),
  }),
});

const ClaudePriceRef = builder.objectRef<PerMillion & { model: string }>("AiClaudeModelPrice").implement({
  description: "A Claude model's USD per 1M tokens — the same at any hour.",
  fields: (t) => ({
    model: t.string({ resolve: (p) => p.model }),
    hit: t.float({ resolve: (p) => p.hit }),
    miss: t.float({ resolve: (p) => p.miss }),
    output: t.float({ resolve: (p) => p.output }),
  }),
});

const ClockRef = builder.objectRef<ReturnType<typeof workspacePriceClock>>("AiPriceClock").implement({
  fields: (t) => ({
    peak: t.boolean({ resolve: (c) => c.peak }),
    changesAt: t.string({ description: "When the price next changes (ISO).", resolve: (c) => c.changesAt.toISOString() }),
    factor: t.float({ description: "1 at peak, 0.5 off-peak.", resolve: (c) => c.factor }),
    flashPerMillion: t.field({ type: PerMillionRef, description: "USD per 1M tokens right now.", resolve: (c) => c.flashPerMillion }),
    proPerMillion: t.field({ type: PerMillionRef, resolve: (c) => c.proPerMillion }),
    claudePerMillion: t.field({ type: [ClaudePriceRef], description: "Claude models (the school's Claude API credit); no off-peak.", resolve: (c) => c.claudePerMillion }),
  }),
});

builder.queryField("aiPriceClock", (t) =>
  t.field({ type: ClockRef, description: "DeepSeek peak / off-peak now and when it changes (D-#1205).", authScopes: WS_SCOPE, resolve: () => workspacePriceClock() }),
);

builder.queryField("aiProjectChatsPage", (t) =>
  t.field({
    type: ChatPageRef,
    authScopes: WS_SCOPE,
    args: { projectId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => projectChatsPage(ctx.auth, a.projectId, { page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("aiProjectChat", (t) =>
  t.field({ type: ChatRef, authScopes: WS_SCOPE, args: { id: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => projectChat(ctx.auth, a.id) }),
);

builder.queryField("aiProjectChatMessagesPage", (t) =>
  t.field({
    type: MessagePageRef,
    description: "Turns oldest-first; no page = the last page.",
    authScopes: WS_SCOPE,
    args: { sessionId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => projectChatMessagesPage(ctx.auth, a.sessionId, { page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("aiProjectChatMessage", (t) =>
  t.field({
    type: MessageRef,
    description: "One turn — the phone polls this while an answer streams.",
    authScopes: WS_SCOPE,
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => projectChatMessage(ctx.auth, a.id),
  }),
);

builder.queryField("aiProjectChatFiles", (t) =>
  t.field({ type: [AiProjectFileRef], description: "Files attached to this chat only.", authScopes: WS_SCOPE, args: { sessionId: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => aiChatFiles(ctx.auth, a.sessionId) }),
);

builder.mutationField("startAiProjectChat", (t) =>
  t.field({
    type: ChatRef,
    description: "Editor: a new chat in the project; the project's files and instructions carry over.",
    authScopes: WS_SCOPE,
    args: { projectId: t.arg.string({ required: true }), title: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => startProjectChat(ctx.auth, a.projectId, a.title),
  }),
);

const SendResultRef = builder.objectRef<{ user: ChatMessageView; assistant: ChatMessageView }>("AiProjectSendResult").implement({
  fields: (t) => ({
    user: t.field({ type: MessageRef, resolve: (r) => r.user }),
    assistant: t.field({ type: MessageRef, description: "The answer's placeholder: running (watch it) or queued (off-peak).", resolve: (r) => r.assistant }),
  }),
});

builder.mutationField("sendAiProjectMessage", (t) =>
  t.field({
    type: SendResultRef,
    description: "Editor: send with the three pickers — model, thinking (off|low|high) and runAt (now|offpeak), all required.",
    authScopes: WS_SCOPE,
    args: {
      sessionId: t.arg.string({ required: true }),
      text: t.arg.string({ required: true }),
      model: t.arg.string({ required: true }),
      thinking: t.arg.string({ required: true }),
      runAt: t.arg.string({ required: true }),
    },
    resolve: async (_r, a, ctx) => {
      const { user, assistant, done } = await sendProjectMessage(ctx.auth, a.sessionId, { text: a.text, model: a.model, thinking: a.thinking, runAt: a.runAt });
      done.catch((e) => console.warn("ai workspace chat crashed:", (e as Error)?.message));
      return { user, assistant };
    },
  }),
);

builder.mutationField("stopAiProjectMessage", (t) =>
  t.field({
    type: MessageRef,
    description: "Editor: stop a running answer, or cancel one waiting for off-peak.",
    authScopes: WS_SCOPE,
    args: { messageId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => stopProjectMessage(ctx.auth, a.messageId),
  }),
);
