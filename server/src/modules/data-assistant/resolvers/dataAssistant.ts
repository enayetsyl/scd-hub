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
