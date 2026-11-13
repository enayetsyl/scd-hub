/**
 * The in-app data chat — "তথ্য সহকারী" (docs/prd-data-assistant-mcp.md §4.5; D-#1540).
 *
 * The server hands the tools to the model as function calls (no MCP hop): question →
 * aiSend("data_assistant", tools) → each tool call runs through `runTool` (the same gates,
 * redaction, limits and log as the Claude door) → results go back → repeat. At most 6 rounds and
 * 12 tool calls per question; the last round is sent with tool use switched off, so the model
 * answers with what it has. Each round is one metered aiSend (one AiUsage row per attempt).
 *
 * Prompt order (D-#1203): stablePrefix = the data-assistant rules (no dates, ids or names); the
 * tool list in registry order filtered by the person's permissions. Today's Dhaka date goes in
 * the variable part. History = earlier questions + final answers only (tool results are never
 * replayed; the model calls a tool again when it needs fresh data).
 *
 * No de-identification (OD-2): names go to the provider; contacts never (every tool result is
 * redacted in runTool) and the question itself is swept of phones and e-mails before sending.
 * The request log keeps the question, the final answer and the tool calls (names + swept
 * arguments + AiDataCall ids) — never tool results (owner Q7); Principal-only read as today.
 */
import { Types } from "mongoose";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { aiSend, AiFeatureOffError, AiModelOverrideError, defaultLedger, type AiLedger, type AiSendOutcome } from "../../platform/ai/aiRouter";
import { AiProviderError, type AiToolRound, type AiTurn } from "../../platform/ai/provider";
import { WORKSPACE_MODELS, providerOfModel } from "../../platform/ai/models";
import { AiCapError } from "../../platform/services/AiUsageService";
import { aiFeatureConfig } from "../../platform/services/AiSettingService";
import { recordAiExchange } from "../../platform/services/AiExchangeService";
import { AiUsage } from "../../platform/models/AiUsage";
import { doorOpen, freshAuth } from "../freshAuth";
import { DATA_ASSISTANT_RULES } from "../prompt";
import { redact, sweepText } from "../redact";
import { runTool } from "../runTool";
import { toolSpecsFor } from "../toolSpecs";
import { findTool } from "../tools/registry";
import { DataChatMessage, DataChatSession, type IDataChatMessage, type IDataChatSession, type IDataToolUse } from "../models/DataChat";

export const MAX_ROUNDS = 6;
export const MAX_TOOL_CALLS = 12;
export const MAX_QUESTION = 2000;
const HISTORY_TURNS = 10;
const ANSWER_TOKENS = 4000;
const TIMEOUT_MS = 3 * 60 * 1000;
export const DEFAULT_DATA_MODEL = "claude-sonnet-5-5";

export const BN = {
  off: "তথ্য সহকারী এখন বন্ধ আছে। প্রধান শিক্ষক চালু করলে ব্যবহার করা যাবে।",
  noDoor: "তথ্য সহকারী ব্যবহারের অনুমতি আপনার নেই।",
  notFound: "আলাপটি পাওয়া যায়নি।",
  empty: "প্রশ্ন লিখুন।",
  tooLong: "প্রশ্নটি অনেক বড় — ছোট করে লিখুন।",
  busy: "আগের প্রশ্নের উত্তর এখনো আসছে — একটু অপেক্ষা করুন।",
  model: "এই মডেলটি এখানে চলে না।",
  down: "এআই এখন উত্তর দিতে পারছে না — একটু পরে আবার চেষ্টা করুন।",
  stopped: "থামানো হয়েছে।",
  restart: "সার্ভার আবার চালু হওয়ায় উত্তরটি থেমে গেছে — আবার জিজ্ঞেস করুন।",
  deepseekWarning:
    "DeepSeek-এও নাম, বেতন ও মন্তব্য যাবে। / Names, individual pay and comment texts will also go to DeepSeek. ফোন নম্বর ও ঠিকানা কখনো যায় না।",
};

export class DataChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataChatError";
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface DataChatSessionView {
  id: string;
  title: string;
  turns: number;
  lastAt: Date;
  chatModel: string;
  /** True when the chat answers with DeepSeek (the app shows the names/pay/comments warning). */
  deepseekWarning: boolean;
  /** "Principal testing as <person>" (View as, owner Q11). */
  viewAs: boolean;
}

export interface DataChatMessageView {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  at: Date;
  status: string;
  error: string | null;
  modelName: string | null;
  tools: Array<{ tool: string; labelBn: string; outcome: string }>;
  /** True when any tool answered "no permission" (the "অনুমতি নেই" chip). */
  denied: boolean;
  costUsd: number | null;
}

const isDeepseek = (model: string) => providerOfModel(model) === "deepseek";

function sessionView(s: IDataChatSession): DataChatSessionView {
  const model = s.chatModel || DEFAULT_DATA_MODEL;
  return { id: String(s._id), title: s.title, turns: s.turns, lastAt: s.lastAt, chatModel: model, deepseekWarning: isDeepseek(model), viewAs: !!s.impersonatorId };
}

function messageView(m: IDataChatMessage): DataChatMessageView {
  const tools = (m.tools ?? []).map((t) => ({ tool: t.tool, labelBn: findTool(t.tool)?.label_bn ?? t.tool, outcome: t.outcome }));
  return {
    id: String(m._id),
    sessionId: String(m.sessionId),
    role: m.role,
    text: m.text,
    at: m.at,
    status: m.status ?? "done",
    error: m.error ?? null,
    modelName: m.modelName ?? null,
    tools,
    denied: tools.some((t) => t.outcome === "denied"),
    costUsd: m.costUsd ?? null,
  };
}

// ---------------------------------------------------------------------------
// Door + ownership
// ---------------------------------------------------------------------------

async function assertDoor(authIn: AuthPayload | null): Promise<AuthPayload> {
  if (!authIn || authIn.role === "GUARDIAN") throw new ForbiddenError(BN.noDoor);
  const auth = await freshAuth(authIn.userId, authIn);
  if (!auth || !(await doorOpen(auth, "in_app"))) throw new ForbiddenError(BN.noDoor);
  return auth;
}

async function ownSession(auth: AuthPayload, sessionId: string): Promise<IDataChatSession> {
  const s = Types.ObjectId.isValid(sessionId) ? await DataChatSession.findById(sessionId) : null;
  // Own chats only — not even the Principal reads another person's data chat here (the tool
  // calls are in the audit log; the questions and answers in the AI request log).
  if (!s || String(s.userId) !== auth.userId || String(s.impersonatorId ?? "") !== String(auth.impersonatorId ?? "")) throw new DataChatError(BN.notFound);
  return s;
}

const impersonator = (auth: AuthPayload) => (auth.impersonatorId && Types.ObjectId.isValid(auth.impersonatorId) ? new Types.ObjectId(auth.impersonatorId) : null);

export async function startDataChat(authIn: AuthPayload | null, input: { title?: string | null; model?: string | null } = {}): Promise<DataChatSessionView> {
  const auth = await assertDoor(authIn);
  const model = input.model || DEFAULT_DATA_MODEL;
  if (!WORKSPACE_MODELS.includes(model)) throw new DataChatError(BN.model);
  const now = new Date();
  const s = await DataChatSession.create({
    userId: new Types.ObjectId(auth.userId),
    impersonatorId: impersonator(auth),
    title: (input.title ?? "").trim().slice(0, 200) || `তথ্য সহকারী · ${dhakaDayKey(now)}`,
    turns: 0,
    lastAt: now,
    chatModel: model,
  });
  return sessionView(s);
}

export async function dataChat(authIn: AuthPayload | null, sessionId: string): Promise<DataChatSessionView> {
  const auth = await assertDoor(authIn);
  return sessionView(await ownSession(auth, sessionId));
}

export async function setDataChatModel(authIn: AuthPayload | null, sessionId: string, model: string): Promise<DataChatSessionView> {
  const auth = await assertDoor(authIn);
  if (!WORKSPACE_MODELS.includes(model)) throw new DataChatError(BN.model);
  const s = await ownSession(auth, sessionId);
  s.chatModel = model;
  await s.save();
  return sessionView(s);
}

export async function dataChatsPage(authIn: AuthPayload | null, args: PageArgs): Promise<Page<DataChatSessionView>> {
  const auth = await assertDoor(authIn);
  return queryPage(DataChatSession, { userId: new Types.ObjectId(auth.userId), impersonatorId: impersonator(auth) }, { lastAt: -1, _id: -1 }, args, (docs) => (docs as unknown as IDataChatSession[]).map(sessionView), 20);
}

export async function dataChatMessagesPage(authIn: AuthPayload | null, sessionId: string, args: PageArgs): Promise<Page<DataChatMessageView>> {
  const auth = await assertDoor(authIn);
  const s = await ownSession(auth, sessionId);
  // Newest page first in the database, shown oldest → newest on the page.
  const p = await queryPage(DataChatMessage, { sessionId: s._id }, { at: -1, _id: -1 }, args, (docs) => (docs as unknown as IDataChatMessage[]).map(messageView), 30);
  return { ...p, rows: [...p.rows].reverse() };
}

export async function dataChatMessage(authIn: AuthPayload | null, messageId: string): Promise<DataChatMessageView> {
  const auth = await assertDoor(authIn);
  const m = Types.ObjectId.isValid(messageId) ? await DataChatMessage.findById(messageId).lean() : null;
  if (!m || String(m.userId) !== auth.userId || String(m.impersonatorId ?? "") !== String(auth.impersonatorId ?? "")) throw new DataChatError(BN.notFound);
  return messageView(m as unknown as IDataChatMessage);
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

export interface DataChatDeps {
  send?: typeof aiSend;
  now?: () => Date;
}

const running = new Map<string, AbortController>();

export async function askDataAssistant(
  authIn: AuthPayload | null,
  sessionId: string,
  input: { text: string; model?: string | null },
  deps: DataChatDeps = {},
): Promise<{ user: DataChatMessageView; assistant: DataChatMessageView; session: DataChatSessionView; done: Promise<void> }> {
  const auth = await assertDoor(authIn);
  const s = await ownSession(auth, sessionId);
  const text = (input.text ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) throw new DataChatError(BN.empty);
  if (text.length > MAX_QUESTION) throw new DataChatError(BN.tooLong);
  const model = input.model || s.chatModel || DEFAULT_DATA_MODEL;
  if (!WORKSPACE_MODELS.includes(model)) throw new DataChatError(BN.model);
  if (!(await aiFeatureConfig("data_assistant")).enabled) throw new DataChatError(BN.off);
  if (await DataChatMessage.exists({ sessionId: s._id, role: "assistant", status: "running" })) throw new DataChatError(BN.busy);
  const now = deps.now?.() ?? new Date();
  const base = { sessionId: s._id, userId: new Types.ObjectId(auth.userId), impersonatorId: impersonator(auth) };
  const [u, a] = await DataChatMessage.insertMany([
    { ...base, role: "user", text, at: now, status: "done" },
    { ...base, role: "assistant", text: "", at: new Date(now.getTime() + 1), status: "running", modelName: model },
  ]);
  s.chatModel = model;
  s.lastAt = now;
  s.turns += 1;
  await s.save();
  const done = runDataAnswer(a._id, auth, deps);
  return { user: messageView(u as unknown as IDataChatMessage), assistant: messageView(a as unknown as IDataChatMessage), session: sessionView(s), done };
}

/** Earlier questions and final answers of the session (text only, newest 10 pairs). */
async function historyOf(sessionId: Types.ObjectId, before: Date): Promise<AiTurn[]> {
  const rows = (await DataChatMessage.find({ sessionId, at: { $lt: before }, $or: [{ role: "user" }, { role: "assistant", status: "done" }] })
    .sort({ at: -1 })
    .limit(HISTORY_TURNS * 2)
    .select("role text")
    .lean()) as Array<{ role: "user" | "assistant"; text: string }>;
  const turns = rows.reverse().filter((r) => r.text);
  // The history must alternate and start with a question; drop an unanswered question.
  const out: AiTurn[] = [];
  for (const r of turns) {
    if (out.length === 0 && r.role !== "user") continue;
    if (out.length && out[out.length - 1].role === r.role) out.pop();
    out.push({ role: r.role, text: r.role === "user" ? sweepText(r.text) : r.text });
  }
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out;
}

/** The variable part: today's Dhaka date + the swept question. */
export function variablePartOf(question: string, today: string): string {
  return `Today (Dhaka): ${today}\n\nQuestion:\n${sweepText(question)}`;
}

async function costOf(callIds: string[]): Promise<number> {
  if (callIds.length === 0) return 0;
  const rows = await AiUsage.find({ callId: { $in: callIds } }).select("costUsd").lean();
  return Math.round(rows.reduce((s, r) => s + (r.costUsd ?? 0), 0) * 1_000_000) / 1_000_000;
}

/** A ledger that meters every round but logs the exchange only once, at the end (Q7). */
const roundLedger: AiLedger = { ...defaultLedger, exchange: undefined };

export async function runDataAnswer(messageId: Types.ObjectId, auth: AuthPayload, deps: DataChatDeps = {}): Promise<void> {
  const msg = await DataChatMessage.findOne({ _id: messageId, status: "running" });
  if (!msg) return;
  const finish = (set: Partial<IDataChatMessage>) => DataChatMessage.updateOne({ _id: msg._id }, { $set: set });
  const ctl = new AbortController();
  running.set(String(msg._id), ctl);
  const tools: IDataToolUse[] = [];
  const llmCallIds: string[] = [];
  const toolCallLog: Array<{ name: string; args: string; dataCallId: string | null }> = [];
  let question = "";
  let answer = "";
  try {
    const userTurn = await DataChatMessage.findOne({ sessionId: msg.sessionId, role: "user", at: { $lt: msg.at } }).sort({ at: -1 }).lean();
    if (!userTurn) return void (await finish({ status: "failed", error: BN.notFound }));
    question = userTurn.text;
    const now = deps.now?.() ?? new Date();
    const history = await historyOf(msg.sessionId, userTurn.at);
    const specs = toolSpecsFor((await freshAuth(auth.userId, auth)) ?? auth);
    const rounds: AiToolRound[] = [];
    let calls = 0;
    let out: AiSendOutcome | null = null;
    const stopped = () => new AiProviderError("stopped", "stopped by the user", "anthropic");
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      if (ctl.signal.aborted) throw stopped();
      const last = round === MAX_ROUNDS || calls >= MAX_TOOL_CALLS;
      out = await (deps.send ?? aiSend)(
        "data_assistant",
        {
          stablePrefix: DATA_ASSISTANT_RULES,
          history,
          variablePart: variablePartOf(question, dhakaDayKey(now)),
          maxOutputTokens: ANSWER_TOKENS,
          reasoning: "low",
          timeoutMs: TIMEOUT_MS,
          tools: specs,
          toolChoice: last ? "none" : "auto",
          toolRounds: rounds,
          abortSignal: ctl.signal,
        },
        {
          userId: auth.userId,
          role: auth.role,
          refType: "DataChatSession",
          sessionId: String(msg.sessionId),
          modelOverride: msg.modelName ?? DEFAULT_DATA_MODEL,
        },
        { ledger: roundLedger },
      );
      llmCallIds.push(out.callId);
      const r = out.result;
      if (last && r.finishReason === "tool_calls") break; // tools were switched off: do not run them
      if (r.finishReason !== "tool_calls" || !r.toolCalls?.length) {
        answer = r.text;
        break;
      }
      // Run every tool call of this round; all results go back together (one message).
      const results: AiToolRound["results"] = [];
      for (const call of r.toolCalls) {
        if (calls >= MAX_TOOL_CALLS) {
          results.push({ id: call.id, content: JSON.stringify({ ok: false, error: "limit", message_en: "Tool-call limit reached for this question; answer with what you have." }), isError: true });
          continue;
        }
        if (ctl.signal.aborted) throw stopped();
        calls++;
        let args: unknown = {};
        try {
          args = call.argsJson ? JSON.parse(call.argsJson) : {};
        } catch {
          args = { _unparsable: true };
        }
        const res = await runTool(auth, call.name, args, { surface: "in_app", sessionId: String(msg.sessionId), messageId: String(msg._id) });
        tools.push({ tool: call.name, outcome: res.outcome, callId: res.callId });
        toolCallLog.push({ name: call.name, args: JSON.stringify(redact(args)).slice(0, 2048), dataCallId: res.callId });
        results.push({ id: call.id, content: JSON.stringify(res.reply), isError: !res.reply.ok });
      }
      rounds.push({ assistant: r.assistantRaw, calls: r.toolCalls, results, ...(calls >= MAX_TOOL_CALLS ? { note: "Tool-call limit reached. Answer now from the results above." } : {}) });
    }
    if (!answer) answer = out?.result.text ?? "";
    // A last round that still asks for tools, or an empty reply, is a failed answer.
    if (!answer.trim() || out?.result.finishReason === "tool_calls") {
      answer = "";
      await finish({ status: "failed", error: BN.down, tools, rounds: llmCallIds.length, costUsd: await costOf(llmCallIds) });
      return;
    }
    await finish({
      status: "done",
      text: answer,
      error: null,
      modelName: out?.result.resolvedModel || out?.result.model || msg.modelName,
      tools,
      rounds: llmCallIds.length,
      costUsd: await costOf(llmCallIds),
    });
    await DataChatSession.updateOne({ _id: msg.sessionId }, { $set: { lastAt: new Date() } });
  } catch (e) {
    const failedCall = (e as { callId?: string } | null)?.callId;
    if (failedCall && !llmCallIds.includes(failedCall)) llmCallIds.push(failedCall);
    const set = (error: string, status: "failed" | "stopped" = "failed") => finish({ status, error, tools, rounds: llmCallIds.length });
    if (e instanceof AiProviderError && e.kind === "stopped") await set(BN.stopped, "stopped");
    else if (e instanceof AiFeatureOffError) await set(BN.off);
    else if (e instanceof AiCapError) await set(e.message);
    else if (e instanceof AiModelOverrideError) await set(BN.model);
    else if (e instanceof AiProviderError) await set(BN.down);
    else {
      console.warn("[data-assistant] chat answer failed:", (e as Error)?.message);
      await set(BN.down).catch(() => undefined);
    }
  } finally {
    running.delete(String(msg._id));
    // A failed round throws before its callId is pushed; its ledger rows carry the session.
    const usage = (await AiUsage.find(llmCallIds.length ? { callId: { $in: llmCallIds } } : { refId: String(msg.sessionId), at: { $gte: msg.at } })
      .sort({ at: 1 })
      .lean()
      .catch(() => [])) as Array<{ callId?: string; provider: string; modelName: string; resolvedModel?: string | null; outcome: string; errorKind?: string | null; latencyMs?: number; costUsd?: number }>;
    if (usage.length > 0) {
      const attempts = usage.map((r) => ({
        provider: r.provider,
        modelName: r.resolvedModel || r.modelName,
        outcome: (r.outcome === "ok" || r.outcome === "fallback" ? "ok" : "error") as "ok" | "error",
        ...(r.errorKind ? { errorKind: r.errorKind } : {}),
        fallback: r.outcome === "fallback",
        latencyMs: r.latencyMs ?? 0,
        costUsd: r.costUsd ?? 0,
      }));
      // One request-log row per question (Q7): question, answer, tool calls — no tool results.
      await recordAiExchange({
        at: msg.at,
        feature: "data_assistant",
        callId: llmCallIds[0] ?? usage[0].callId ?? String(msg._id),
        userId: auth.userId,
        role: auth.role,
        refType: "DataChatSession",
        refId: String(msg.sessionId),
        stablePrefix: DATA_ASSISTANT_RULES,
        historyRef: `DataChatSession:${String(msg.sessionId)}`,
        deidentified: false,
        request: sweepText(question),
        reply: answer,
        attempts,
        toolCalls: toolCallLog,
        impersonatorId: auth.impersonatorId ?? null,
      }).catch(() => undefined);
    }
  }
}

export async function stopDataAnswer(authIn: AuthPayload | null, messageId: string): Promise<DataChatMessageView> {
  const auth = await assertDoor(authIn);
  const m = Types.ObjectId.isValid(messageId) ? await DataChatMessage.findById(messageId) : null;
  if (!m || String(m.userId) !== auth.userId || String(m.impersonatorId ?? "") !== String(auth.impersonatorId ?? "") || m.role !== "assistant") throw new DataChatError(BN.notFound);
  const ctl = running.get(String(m._id));
  if (ctl) {
    ctl.abort();
    await new Promise((r) => setTimeout(r, 50));
  } else await DataChatMessage.updateOne({ _id: m._id, status: "running" }, { $set: { status: "stopped", error: BN.stopped } });
  return dataChatMessage(authIn, messageId);
}

/** Answers left "running" by a restart become failed, so a chat is never stuck. */
export async function failOrphanedDataAnswers(): Promise<void> {
  await DataChatMessage.updateMany({ status: "running" }, { $set: { status: "failed", error: BN.restart } });
}

/** The model picker: the workspace models; DeepSeek ones carry the warning. */
export function dataChatModels(): Array<{ id: string; deepseek: boolean; isDefault: boolean }> {
  return WORKSPACE_MODELS.map((id) => ({ id, deepseek: isDeepseek(id), isDefault: id === DEFAULT_DATA_MODEL }));
}
