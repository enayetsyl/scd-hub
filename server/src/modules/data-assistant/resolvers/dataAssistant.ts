/**
 * Data assistant GraphQL (docs/prd-data-assistant-mcp.md §8.1, §11).
 * DA-1: the tool-call log — `dataToolCallsPage` (`data_assistant:audit`, LOCKED) and
 * `myDataToolCallsPage` (own calls, any staff login; the service refuses GUARDIAN).
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { dataToolCallsPage, myDataToolCallsPage, type DataCallView } from "../services/DataCallLogService";

const DataCallRef = builder.objectRef<DataCallView>("DataToolCall").implement({
  fields: (t) => ({
    id: t.string({ resolve: (r) => r.id }),
    at: t.string({ resolve: (r) => new Date(r.at).toISOString() }),
    userId: t.string({ resolve: (r) => r.userId }),
    userName: t.string({ nullable: true, resolve: (r) => r.userName }),
    role: t.string({ resolve: (r) => r.role }),
    impersonatorName: t.string({ nullable: true, description: "Set when the Principal tested the chat as this login (View as).", resolve: (r) => r.impersonatorName }),
    surface: t.string({ description: "in_app | claude | chatgpt", resolve: (r) => r.surface }),
    clientName: t.string({ nullable: true, resolve: (r) => r.clientName }),
    tool: t.string({ resolve: (r) => r.tool }),
    args: t.string({ description: "The arguments (JSON, contacts swept, ≤ 2 KB).", resolve: (r) => r.args }),
    outcome: t.string({ description: "ok | denied | invalid | limited | error | off", resolve: (r) => r.outcome }),
    deniedNeeds: t.stringList({ resolve: (r) => r.deniedNeeds }),
    rowCount: t.int({ resolve: (r) => r.rowCount }),
    truncated: t.boolean({ resolve: (r) => r.truncated }),
    replyBytes: t.int({ resolve: (r) => r.replyBytes }),
    ms: t.int({ resolve: (r) => r.ms }),
  }),
});

const DataCallPageRef = pageRef("DataToolCallPage", DataCallRef);

builder.queryField("dataToolCallsPage", (t) =>
  t.field({
    type: DataCallPageRef,
    description: "Every person's data-assistant tool calls, newest first (data_assistant:audit, Principal).",
    authScopes: { hasPermission: "data_assistant:audit" },
    args: {
      userId: t.arg.string({ required: false }),
      tool: t.arg.string({ required: false }),
      surface: t.arg.string({ required: false }),
      clientName: t.arg.string({ required: false }),
      outcome: t.arg.string({ required: false }),
      fromKey: t.arg.string({ required: false }),
      toKey: t.arg.string({ required: false }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: (_r, a, ctx) =>
      dataToolCallsPage(ctx.auth, { userId: a.userId, tool: a.tool, surface: a.surface, clientName: a.clientName, outcome: a.outcome, fromKey: a.fromKey, toKey: a.toKey }, { page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("myDataToolCallsPage", (t) =>
  t.field({
    type: DataCallPageRef,
    description: "My own data-assistant tool calls, newest first.",
    authScopes: { hasPermission: "my_account:view" },
    args: {
      tool: t.arg.string({ required: false }),
      surface: t.arg.string({ required: false }),
      clientName: t.arg.string({ required: false }),
      outcome: t.arg.string({ required: false }),
      fromKey: t.arg.string({ required: false }),
      toKey: t.arg.string({ required: false }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: (_r, a, ctx) =>
      myDataToolCallsPage(ctx.auth, { tool: a.tool, surface: a.surface, clientName: a.clientName, outcome: a.outcome, fromKey: a.fromKey, toKey: a.toKey }, { page: a.page, pageSize: a.pageSize }),
  }),
);

// ---------------------------------------------------------------------------
// DA-2: the in-app data chat. authScopes = any staff login (`my_account:view`, SELF); the door
// itself (`data_assistant:use`, or a Principal testing through "View as", D-#1570) is checked in
// DataChatService on fresh permissions — a scope here would refuse the View-as test.
// ---------------------------------------------------------------------------

import {
  askDataAssistant,
  dataChat,
  dataChatMessage,
  dataChatMessagesPage,
  dataChatModels,
  dataChatsPage,
  setDataChatModel,
  startDataChat,
  stopDataAnswer,
  BN as CHAT_BN,
  type DataChatMessageView,
  type DataChatSessionView,
} from "../services/DataChatService";

const DataChatRef = builder.objectRef<DataChatSessionView>("DataChat").implement({
  fields: (t) => ({
    id: t.string({ resolve: (s) => s.id }),
    title: t.string({ resolve: (s) => s.title }),
    turns: t.int({ resolve: (s) => s.turns }),
    lastAt: t.string({ resolve: (s) => new Date(s.lastAt).toISOString() }),
    chatModel: t.string({ resolve: (s) => s.chatModel }),
    deepseekWarning: t.boolean({ description: "True when the chat answers with DeepSeek: show the names/pay/comments warning.", resolve: (s) => s.deepseekWarning }),
    viewAs: t.boolean({ description: "True when the Principal is testing as another login (View as).", resolve: (s) => s.viewAs }),
  }),
});

const DataToolChipRef = builder.objectRef<DataChatMessageView["tools"][number]>("DataToolChip").implement({
  fields: (t) => ({
    tool: t.string({ resolve: (c) => c.tool }),
    labelBn: t.string({ resolve: (c) => c.labelBn }),
    outcome: t.string({ resolve: (c) => c.outcome }),
  }),
});

const DataChatMessageRef = builder.objectRef<DataChatMessageView>("DataChatMessage").implement({
  fields: (t) => ({
    id: t.string({ resolve: (m) => m.id }),
    sessionId: t.string({ resolve: (m) => m.sessionId }),
    role: t.string({ resolve: (m) => m.role }),
    text: t.string({ resolve: (m) => m.text }),
    at: t.string({ resolve: (m) => new Date(m.at).toISOString() }),
    status: t.string({ description: "running | done | failed | stopped", resolve: (m) => m.status }),
    error: t.string({ nullable: true, resolve: (m) => m.error }),
    modelName: t.string({ nullable: true, resolve: (m) => m.modelName }),
    tools: t.field({ type: [DataToolChipRef], resolve: (m) => m.tools }),
    denied: t.boolean({ resolve: (m) => m.denied }),
    costUsd: t.float({ nullable: true, resolve: (m) => m.costUsd }),
  }),
});

const DataChatPageRef = pageRef("DataChatPage", DataChatRef);
const DataChatMessagePageRef = pageRef("DataChatMessagePage", DataChatMessageRef);

const DataChatModelRef = builder.objectRef<{ id: string; deepseek: boolean; isDefault: boolean }>("DataChatModel").implement({
  fields: (t) => ({
    id: t.string({ resolve: (m) => m.id }),
    deepseek: t.boolean({ resolve: (m) => m.deepseek }),
    isDefault: t.boolean({ resolve: (m) => m.isDefault }),
  }),
});

const DataAskResultRef = builder
  .objectRef<{ user: DataChatMessageView; assistant: DataChatMessageView; session: DataChatSessionView }>("DataAskResult")
  .implement({
    fields: (t) => ({
      user: t.field({ type: DataChatMessageRef, resolve: (r) => r.user }),
      assistant: t.field({ type: DataChatMessageRef, resolve: (r) => r.assistant }),
      session: t.field({ type: DataChatRef, resolve: (r) => r.session }),
    }),
  });

const CHAT_SCOPE = { hasPermission: "my_account:view" } as const;

builder.queryField("dataChatModels", (t) =>
  t.field({
    type: [DataChatModelRef],
    description: "The data chat's model picker; DeepSeek entries carry the warning.",
    authScopes: CHAT_SCOPE,
    resolve: () => dataChatModels(),
  }),
);

builder.queryField("dataChatDeepseekWarning", (t) =>
  t.string({ description: "The Bangla + English warning shown before a DeepSeek answer.", authScopes: CHAT_SCOPE, resolve: () => CHAT_BN.deepseekWarning }),
);

builder.queryField("dataChatsPage", (t) =>
  t.field({
    type: DataChatPageRef,
    description: "My data chats, newest first.",
    authScopes: CHAT_SCOPE,
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => dataChatsPage(ctx.auth, { page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("dataChat", (t) =>
  t.field({
    type: DataChatRef,
    description: "One of my data chats.",
    authScopes: CHAT_SCOPE,
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => dataChat(ctx.auth, a.id),
  }),
);

builder.queryField("dataChatMessagesPage", (t) =>
  t.field({
    type: DataChatMessagePageRef,
    description: "One of my data chats, newest page first (rows oldest → newest within the page).",
    authScopes: CHAT_SCOPE,
    args: { sessionId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => dataChatMessagesPage(ctx.auth, a.sessionId, { page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("dataChatMessage", (t) =>
  t.field({
    type: DataChatMessageRef,
    description: "One answer (polled while it is running).",
    authScopes: CHAT_SCOPE,
    args: { id: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => dataChatMessage(ctx.auth, a.id),
  }),
);

builder.mutationField("startDataChat", (t) =>
  t.field({
    type: DataChatRef,
    authScopes: CHAT_SCOPE,
    args: { title: t.arg.string({ required: false }), model: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => startDataChat(ctx.auth, { title: a.title, model: a.model }),
  }),
);

builder.mutationField("setDataChatModel", (t) =>
  t.field({
    type: DataChatRef,
    authScopes: CHAT_SCOPE,
    args: { sessionId: t.arg.string({ required: true }), model: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => setDataChatModel(ctx.auth, a.sessionId, a.model),
  }),
);

builder.mutationField("askDataAssistant", (t) =>
  t.field({
    type: DataAskResultRef,
    description: "Ask a question; the answer is written to the returned assistant message as it completes (poll dataChatMessage).",
    authScopes: CHAT_SCOPE,
    args: { sessionId: t.arg.string({ required: true }), text: t.arg.string({ required: true }), model: t.arg.string({ required: false }) },
    resolve: async (_r, a, ctx) => {
      const out = await askDataAssistant(ctx.auth, a.sessionId, { text: a.text, model: a.model });
      out.done.catch((e) => console.warn("[data-assistant] answer crashed:", (e as Error)?.message));
      return out;
    },
  }),
);

builder.mutationField("stopDataAnswer", (t) =>
  t.field({
    type: DataChatMessageRef,
    authScopes: CHAT_SCOPE,
    args: { messageId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => stopDataAnswer(ctx.auth, a.messageId),
  }),
);

// ---------------------------------------------------------------------------
// DA-3/DA-4: connections (Claude). Own list for any staff login; everyone's for the Principal.
// ---------------------------------------------------------------------------

import { allDataConnectionsPage, myDataConnections, revokeDataConnection, type DataConnectionView } from "../services/DataConnectionService";

const DataConnectionRef = builder.objectRef<DataConnectionView>("DataConnection").implement({
  fields: (t) => ({
    userId: t.string({ resolve: (c) => c.userId }),
    userName: t.string({ nullable: true, resolve: (c) => c.userName }),
    clientId: t.string({ resolve: (c) => c.clientId }),
    clientName: t.string({ resolve: (c) => c.clientName }),
    connectedAt: t.string({ resolve: (c) => new Date(c.connectedAt).toISOString() }),
    lastUsedAt: t.string({ nullable: true, resolve: (c) => (c.lastUsedAt ? new Date(c.lastUsedAt).toISOString() : null) }),
    expiresAt: t.string({ description: "The 90-day limit: the person signs in again after this.", resolve: (c) => new Date(c.expiresAt).toISOString() }),
    calls30d: t.int({ resolve: (c) => c.calls30d }),
  }),
});

builder.queryField("myDataConnections", (t) =>
  t.field({
    type: [DataConnectionRef],
    description: "My connected apps (Claude) reading school data as me.",
    authScopes: { hasPermission: "my_account:view" },
    resolve: (_r, _a, ctx) => myDataConnections(ctx.auth),
  }),
);

const DataConnectionPageRef = pageRef("DataConnectionPage", DataConnectionRef);

builder.queryField("allDataConnectionsPage", (t) =>
  t.field({
    type: DataConnectionPageRef,
    description: "Every person's data connections, paged (data_assistant:audit, Principal).",
    authScopes: { hasPermission: "data_assistant:audit" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => allDataConnectionsPage(ctx.auth, { page: a.page, pageSize: a.pageSize }),
  }),
);

builder.mutationField("revokeDataConnection", (t) =>
  t.boolean({
    description: "Disconnect: my own connection, or anyone's with data_assistant:audit.",
    authScopes: { hasPermission: "my_account:view" },
    args: { clientId: t.arg.string({ required: true }), userId: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => revokeDataConnection(ctx.auth, a.clientId, a.userId),
  }),
);
