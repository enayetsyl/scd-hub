/**
 * ProjectChatService (AI Workspace W-2, docs/prd-ai-workspace.md §4) — chat inside a project.
 *
 * Storage (D-#1201): AiAssistSession / AiAssistMessage with `projectId`. A send writes the
 * user turn and an EMPTY assistant placeholder at once; the answer streams into the
 * placeholder (text written every ~400 ms), so the web reads it live over SSE
 * (GET /events/ai-chat/:messageId) and the phone by polling, and a reload loses nothing.
 *
 * Prompt (D-#1203) — the cache is the cost control:
 *   stablePrefix = fixed chat instructions + project instructions + pinned files in order
 *                  (byte-identical turn after turn: no dates, ids or user names)
 *   context      = files attached to THIS chat
 *   history      = EVERY earlier answered turn — never shortened (D-#1204)
 *   variablePart = the new message
 * Name protection ON (D-#1207): all four parts de-identified against the whole school, the
 * fail-closed gate on what leaves, names restored in the answer. OFF: sent as written; a soft
 * warning on a phone number or an id-like number.
 *
 * Pickers (D-#1205): model (per-call override), thinking, run now / off-peak. Off-peak turns
 * wait with `runAfter` and the in-process queue (`startWorkspaceChatQueue`, every minute)
 * answers them once DeepSeek is off-peak. Stop aborts a running answer or cancels a queued one.
 */
import { Types } from "mongoose";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { User } from "../../foundation/models/User";
import { AiAssistSession, type IAiAssistSession } from "../../ai-assist/models/AiAssistSession";
import { AiAssistMessage, type IAiAssistMessage } from "../../ai-assist/models/AiAssistMessage";
import { aiSend, AiFeatureOffError, AiModelOverrideError } from "../../platform/ai/aiRouter";
import { AiProviderError } from "../../platform/ai/provider";
import { CONTEXT_WINDOW_TOKENS, isPeak, nextOffPeak, priceClock, priceOf, type PriceClock } from "../../platform/ai/aiPrices";
import { DEEPSEEK_MODELS } from "../../platform/ai/deepseekProvider";
import { assertDeidentified, deidentify, DeidentifyError, reidentify, type DeidScope } from "../../platform/ai/deidentify";
import { scopeForSchool } from "../../platform/services/DeidScopeService";
import { AiCapError } from "../../platform/services/AiUsageService";
import { activeProjectPolicy, type ProjectPolicyVersion } from "../../platform/services/AiPolicyService";
import { AiProject, type IAiProject } from "../models/AiProject";
import { AiProjectFile } from "../models/AiProjectFile";
import { AiUsage } from "../../platform/models/AiUsage";
import { AiWorkspaceError, loadProject, projectPolicyKey } from "./AiProjectService";

export const CHAT_INSTRUCTIONS = `You are the AI assistant of a Bangladeshi Islamic school (SCD), working inside one of the school's projects. The project's own instructions and reference files follow; follow the instructions and use the files. Answer in the language the person writes in unless the instructions say otherwise. Tokens like [S1], [G1], [T1], [PHONE], [NUM], [ID] stand for hidden names and numbers — keep them exactly and never invent a name.`;

/** Output limit per chat answer (PRD §10: generous, only to stop runaways). */
export const CHAT_MAX_OUTPUT_TOKENS = 8_000;
/** Long thinking answers need time; the stream keeps the connection busy. */
export const CHAT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_MESSAGE = 60_000;
const FLUSH_MS = 400;
/** The meter suggests a new chat from here (D-#1204). */
export const NEW_CHAT_AT = 0.8;

const BN = {
  notFound: "আলাপটি পাওয়া যায়নি",
  empty: "বার্তা লিখুন",
  tooLong: "বার্তা খুব বড় (৬০,০০০ অক্ষরের বেশি) — বড় লেখা ফাইল হিসেবে যোগ করুন",
  busy: "আগের উত্তরটি শেষ হলে আবার পাঠান",
  off: "প্রকল্পে আলাপ এখন বন্ধ — প্রধান শিক্ষক এআই সেটিং থেকে চালু করতে পারেন",
  down: "এআই এখন সাড়া দিচ্ছে না — একটু পরে আবার চেষ্টা করুন",
  stopped: "থামানো হয়েছে",
  archived: "আর্কাইভ করা প্রকল্পে নতুন বার্তা পাঠানো যায় না",
  model: "এই মডেলটি কর্মক্ষেত্রে চলে না",
  thinking: "চিন্তার মাত্রা সঠিক নয়",
  runAt: "কখন চলবে — এখন না কম দামে — বেছে নিন",
  warnNumbers: "বার্তায় ফোন নম্বর বা আইডির মতো সংখ্যা আছে — নাম সুরক্ষা বন্ধ থাকায় তা যেমন আছে তেমনই এআই-কে গেছে।",
} as const;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface ChatSessionView {
  id: string;
  projectId: string;
  title: string;
  startedByName: string | null;
  turns: number;
  lastAt: Date;
  model: string;
  thinking: "off" | "low" | "high";
  runAt: "now" | "offpeak" | null;
  contextTokens: number;
  windowTokens: number;
  /** contextTokens ÷ window, 0..1+ */
  contextUsed: number;
  suggestNewChat: boolean;
}

export interface ChatMessageView {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  at: Date;
  status: "queued" | "running" | "done" | "failed" | "stopped";
  modelName: string | null;
  thinking: string | null;
  runAt: string | null;
  runAfter: Date | null;
  error: string | null;
  warning: string | null;
  authorName: string | null;
  tokens: number | null;
  costUsd: number | null;
}

function sessionView(s: IAiAssistSession, project: IAiProject, names: Map<string, string>): ChatSessionView {
  const model = s.chatModel || project.defaultModel;
  const windowTokens = CONTEXT_WINDOW_TOKENS[model] ?? 1_000_000;
  const used = (s.contextTokens ?? 0) / windowTokens;
  return {
    id: s._id.toString(),
    projectId: project._id.toString(),
    title: s.title,
    startedByName: names.get(s.teacherId.toString()) ?? null,
    turns: s.turns,
    lastAt: s.lastAt,
    model,
    thinking: (s.thinking as ChatSessionView["thinking"]) || project.defaultThinking,
    runAt: s.runAt ?? null,
    contextTokens: s.contextTokens ?? 0,
    windowTokens,
    contextUsed: Math.round(used * 1000) / 1000,
    suggestNewChat: used >= NEW_CHAT_AT,
  };
}

function messageView(m: IAiAssistMessage, names: Map<string, string>): ChatMessageView {
  const tokens = m.role === "assistant" && m.outputTokens !== undefined ? (m.cacheHitTokens ?? 0) + (m.cacheMissTokens ?? 0) + (m.outputTokens ?? 0) : null;
  return {
    id: m._id.toString(),
    sessionId: m.sessionId.toString(),
    role: m.role,
    text: m.text ?? "",
    at: m.at,
    status: m.status ?? "done",
    modelName: m.modelName ?? null,
    thinking: m.thinking ?? null,
    runAt: m.runAt ?? null,
    runAfter: m.runAfter ?? null,
    error: m.error ?? null,
    warning: m.warning ?? null,
    authorName: names.get(m.teacherId.toString()) ?? null,
    tokens,
    costUsd: m.costUsd ?? null,
  };
}

async function namesOf(ids: Array<Types.ObjectId | string>): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.map(String))];
  if (!uniq.length) return new Map();
  return new Map((await User.find({ _id: { $in: uniq } }).select("name").lean()).map((u) => [u._id.toString(), u.name]));
}

async function loadChat(authIn: AuthPayload | null, sessionId: string, need: "viewer" | "editor") {
  const s = Types.ObjectId.isValid(sessionId) ? await AiAssistSession.findById(sessionId) : null;
  if (!s || !s.projectId) throw new AiWorkspaceError(BN.notFound);
  const { auth, project } = await loadProject(authIn, s.projectId.toString(), need);
  return { auth, project, session: s };
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

/** Editors start chats (a chat spends money); every member reads them. */
export async function startProjectChat(authIn: AuthPayload | null, projectId: string, titleIn?: string | null): Promise<ChatSessionView> {
  const { auth, project } = await loadProject(authIn, projectId, "editor");
  if (project.archived) throw new AiWorkspaceError(BN.archived);
  const now = new Date();
  const title = (titleIn ?? "").trim().slice(0, 200) || `আলাপ · ${now.toISOString().slice(0, 10)}`;
  const s = await AiAssistSession.create({
    teacherId: new Types.ObjectId(auth.userId),
    projectId: project._id,
    title,
    turns: 0,
    lastAt: now,
    chatModel: project.defaultModel,
    thinking: project.defaultThinking,
    runAt: null,
  });
  return sessionView(s, project, await namesOf([s.teacherId]));
}

export async function projectChatsPage(authIn: AuthPayload | null, projectId: string, args: PageArgs): Promise<Page<ChatSessionView>> {
  const { project } = await loadProject(authIn, projectId, "viewer");
  return queryPage(AiAssistSession, { projectId: project._id }, { lastAt: -1 }, args, async (docs) => {
    const ss = docs as unknown as IAiAssistSession[];
    const names = await namesOf(ss.map((s) => s.teacherId));
    return ss.map((s) => sessionView(s, project, names));
  }, 20);
}

export async function projectChat(authIn: AuthPayload | null, sessionId: string): Promise<ChatSessionView> {
  const { project, session } = await loadChat(authIn, sessionId, "viewer");
  return sessionView(session, project, await namesOf([session.teacherId]));
}

/** Turns oldest-first; the LAST page by default, so a long chat opens at its end. */
export async function projectChatMessagesPage(authIn: AuthPayload | null, sessionId: string, args: PageArgs): Promise<Page<ChatMessageView>> {
  const { session } = await loadChat(authIn, sessionId, "viewer");
  const size = Math.max(1, Math.min(100, args.pageSize ?? 40));
  let page = args.page ?? null;
  if (page === null || page === undefined) {
    const total = await AiAssistMessage.countDocuments({ sessionId: session._id });
    page = Math.max(1, Math.ceil(total / size));
  }
  return queryPage(AiAssistMessage, { sessionId: session._id }, { at: 1, _id: 1 }, { page, pageSize: size }, async (docs) => {
    const ms = docs as unknown as IAiAssistMessage[];
    const names = await namesOf(ms.map((m) => m.teacherId));
    return ms.map((m) => messageView(m, names));
  }, size);
}

export async function projectChatMessage(authIn: AuthPayload | null, messageId: string): Promise<ChatMessageView> {
  const m = Types.ObjectId.isValid(messageId) ? await AiAssistMessage.findById(messageId).lean() : null;
  if (!m || !m.projectId) throw new AiWorkspaceError(BN.notFound);
  await loadProject(authIn, m.projectId.toString(), "viewer");
  return messageView(m as unknown as IAiAssistMessage, await namesOf([m.teacherId]));
}

// ---------------------------------------------------------------------------
// The price clock
// ---------------------------------------------------------------------------

export function workspacePriceClock(now: Date = new Date()): PriceClock & { flashPerMillion: { hit: number; miss: number; output: number }; proPerMillion: { hit: number; miss: number; output: number } } {
  const clock = priceClock("deepseek", now);
  const f = (m: string) => {
    const p = priceOf("deepseek", m);
    return { hit: p.cacheHit * clock.factor, miss: p.cacheMiss * clock.factor, output: p.output * clock.factor };
  };
  return { ...clock, flashPerMillion: f("deepseek-flash"), proPerMillion: f("deepseek-v4-pro") };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const NUMBER_LIKE = /(?:\+?88)?01[3-9]\d{8}|\b\d{6,}\b/;

export async function sendProjectMessage(
  authIn: AuthPayload | null,
  sessionId: string,
  input: { text: string; model: string; thinking: string; runAt: string },
  deps: ChatDeps = {},
): Promise<{ user: ChatMessageView; assistant: ChatMessageView; done: Promise<void> }> {
  const { auth, project, session } = await loadChat(authIn, sessionId, "editor");
  if (project.archived) throw new AiWorkspaceError(BN.archived);
  const text = (input.text ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) throw new AiWorkspaceError(BN.empty);
  if (text.length > MAX_MESSAGE) throw new AiWorkspaceError(BN.tooLong);
  if (!(DEEPSEEK_MODELS as readonly string[]).includes(input.model)) throw new AiWorkspaceError(BN.model);
  if (!["off", "low", "high"].includes(input.thinking)) throw new AiWorkspaceError(BN.thinking);
  if (input.runAt !== "now" && input.runAt !== "offpeak") throw new AiWorkspaceError(BN.runAt);
  const pending = await AiAssistMessage.exists({ sessionId: session._id, role: "assistant", status: { $in: ["queued", "running"] } });
  if (pending) throw new AiWorkspaceError(BN.busy);

  const now = deps.now?.() ?? new Date();
  const warning = !project.nameProtection && NUMBER_LIKE.test(text) ? BN.warnNumbers : null;
  const offpeakWait = input.runAt === "offpeak" && isPeak("deepseek", now);
  const [u, a] = await AiAssistMessage.insertMany([
    { sessionId: session._id, teacherId: new Types.ObjectId(auth.userId), projectId: project._id, role: "user", text, at: now, status: "done", warning },
    {
      sessionId: session._id,
      teacherId: new Types.ObjectId(auth.userId),
      projectId: project._id,
      role: "assistant",
      text: "",
      at: new Date(now.getTime() + 1),
      status: offpeakWait ? "queued" : "running",
      modelName: input.model,
      thinking: input.thinking,
      runAt: input.runAt,
      runAfter: offpeakWait ? nextOffPeak("deepseek", now) : null,
    },
  ]);
  await AiAssistSession.updateOne(
    { _id: session._id },
    { $set: { chatModel: input.model, thinking: input.thinking, runAt: input.runAt, lastAt: now }, $inc: { turns: 1 } },
  );
  const names = await namesOf([auth.userId]);
  const done = offpeakWait ? Promise.resolve() : runAnswer(a._id, auth, deps);
  return { user: messageView(u as unknown as IAiAssistMessage, names), assistant: messageView(a as unknown as IAiAssistMessage, names), done };
}

export interface ChatDeps {
  send?: typeof aiSend;
  scope?: () => Promise<DeidScope>;
  now?: () => Date;
}

/** Running answers in THIS process, for Stop. */
const running = new Map<string, AbortController>();

/** The prompt for one assistant turn (exported for the prefix-stability test). */
export async function buildChatPrompt(
  project: IAiProject,
  sessionId: Types.ObjectId,
  beforeAt: Date,
): Promise<{ stablePrefix: string; context: string; history: Array<{ role: "user" | "assistant"; text: string }>; policy: ProjectPolicyVersion | null; fileIds: string[] }> {
  const [policy, pinned, attached, earlier] = await Promise.all([
    activeProjectPolicy(projectPolicyKey(project._id.toString())),
    AiProjectFile.find({ projectId: project._id, sessionId: null, pinned: true, status: "ready" }).sort({ order: 1, _id: 1 }).select("name text").lean(),
    AiProjectFile.find({ projectId: project._id, sessionId, status: "ready" }).sort({ order: 1, _id: 1 }).select("name text").lean(),
    AiAssistMessage.find({ sessionId, at: { $lt: beforeAt } }).sort({ at: 1, _id: 1 }).select("role text status").lean(),
  ]);
  const parts = [CHAT_INSTRUCTIONS];
  if (policy) parts.push(`# PROJECT INSTRUCTIONS\n\n${policy.body}`);
  for (const f of pinned) parts.push(`# FILE: ${f.name}\n\n${f.text}`);
  const context = attached.map((f) => `# ATTACHED FILE: ${f.name}\n\n${f.text}`).join("\n\n");
  // Every earlier answered turn, in order. A user turn whose answer failed / was stopped is
  // left out with its answer, so the history stays a clean question → answer sequence.
  const history: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (let i = 0; i < earlier.length; i++) {
    const m = earlier[i];
    if (m.role !== "user") continue;
    const next = earlier[i + 1];
    if (next && next.role === "assistant" && (next.status ?? "done") === "done" && next.text) {
      history.push({ role: "user", text: m.text }, { role: "assistant", text: next.text });
      i++;
    }
  }
  return { stablePrefix: parts.join("\n\n"), context, history, policy, fileIds: [...pinned, ...attached].map((f) => f._id.toString()) };
}

/** Answers one placeholder; never throws (the reason is written onto the message). */
export async function runAnswer(messageId: Types.ObjectId, auth: Pick<AuthPayload, "userId" | "role">, deps: ChatDeps = {}): Promise<void> {
  const msg = await AiAssistMessage.findOneAndUpdate({ _id: messageId, status: { $in: ["running", "queued"] } }, { $set: { status: "running", runAfter: null } }, { new: true });
  if (!msg) return;
  const fail = (error: string, status: "failed" | "stopped" = "failed") => AiAssistMessage.updateOne({ _id: msg._id }, { $set: { status, error } });
  try {
    const project = await AiProject.findById(msg.projectId);
    const userTurn = await AiAssistMessage.findOne({ sessionId: msg.sessionId, role: "user", at: { $lt: msg.at } }).sort({ at: -1 }).lean();
    if (!project || !userTurn) return void (await fail(BN.notFound));
    const prompt = await buildChatPrompt(project, msg.sessionId, userTurn.at);

    let stablePrefix = prompt.stablePrefix;
    let context = prompt.context;
    let history = prompt.history;
    let question = userTurn.text;
    let map: Record<string, string> = {};
    if (project.nameProtection) {
      const scope = await (deps.scope ?? scopeForSchool)();
      const p = deidentify(stablePrefix, scope);
      const c = deidentify(context, scope);
      const h = history.map((t) => ({ role: t.role, ...deidentify(t.text, scope) }));
      const q = deidentify(question, scope);
      try {
        for (const t of [p.text, c.text, q.text, ...h.map((x) => x.text)]) assertDeidentified(t, scope);
      } catch (e) {
        if (e instanceof DeidentifyError) return void (await fail(e.message));
        throw e;
      }
      map = Object.assign({}, p.map, c.map, ...h.map((x) => x.map), q.map);
      stablePrefix = p.text;
      context = c.text;
      history = h.map((x) => ({ role: x.role, text: x.text }));
      question = q.text;
    }

    const ctl = new AbortController();
    running.set(msg._id.toString(), ctl);
    let latest = "";
    let flushed = "";
    const flush = async () => {
      if (latest === flushed) return;
      flushed = latest;
      const shown = project.nameProtection ? reidentify(latest, map) : latest;
      await AiAssistMessage.updateOne({ _id: msg._id, status: "running" }, { $set: { text: shown } }).catch(() => undefined);
    };
    const timer = setInterval(() => void flush(), FLUSH_MS);
    try {
      const out = await (deps.send ?? aiSend)(
        "workspace_chat",
        {
          stablePrefix,
          context: context || undefined,
          history,
          variablePart: question,
          maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
          reasoning: (msg.thinking ?? "high") as "off" | "low" | "high",
          timeoutMs: CHAT_TIMEOUT_MS,
          onDelta: (t) => {
            latest = t;
          },
          abortSignal: ctl.signal,
        },
        {
          userId: auth.userId,
          role: auth.role,
          refType: "AiAssistSession",
          sessionId: msg.sessionId.toString(),
          policyHash: prompt.policy?.hash ?? null,
          projectId: project._id.toString(),
          projectMonthlyUsd: project.monthlyCapUsd ?? null,
          modelOverride: msg.modelName ?? project.defaultModel,
          exchange: {
            historyRef: `AiAssistSession:${msg.sessionId.toString()}@${history.length}`,
            prefixRef: [prompt.policy?.hash ?? "no-instructions", ...prompt.fileIds].join(","),
            deidentified: project.nameProtection,
          },
        },
      );
      clearInterval(timer);
      const r = out.result;
      const answer = project.nameProtection ? reidentify(r.text, map) : r.text;
      await AiAssistMessage.updateOne(
        { _id: msg._id },
        {
          $set: {
            status: "done",
            text: answer,
            modelName: r.resolvedModel || r.model,
            policyHash: prompt.policy?.hash,
            error: null,
            cacheHitTokens: r.usage.cacheHitTokens,
            cacheMissTokens: r.usage.cacheMissTokens,
            outputTokens: r.usage.outputTokens,
            costUsd: await costOf(out.callId),
          },
        },
      );
      await AiAssistSession.updateOne(
        { _id: msg.sessionId },
        { $set: { lastAt: new Date(), contextTokens: r.usage.cacheHitTokens + r.usage.cacheMissTokens + r.usage.outputTokens } },
      );
    } catch (e) {
      clearInterval(timer);
      await flush();
      if (e instanceof AiProviderError && e.kind === "stopped") return void (await fail(BN.stopped, "stopped"));
      if (e instanceof AiFeatureOffError) return void (await fail(BN.off));
      if (e instanceof AiCapError) return void (await fail(e.message));
      if (e instanceof AiModelOverrideError) return void (await fail(BN.model));
      if (e instanceof AiProviderError) return void (await fail(e.kind === "truncated" ? "উত্তর সীমা ছাড়িয়েছে — ছোট করে জিজ্ঞেস করুন বা নতুন আলাপ শুরু করুন" : BN.down));
      throw e;
    } finally {
      running.delete(msg._id.toString());
    }
  } catch (e) {
    console.warn("[ai-workspace] chat answer failed:", (e as Error)?.message);
    await fail(BN.down).catch(() => undefined);
  }
}

/** USD the ledger stamped on a call (the router already priced it by time of day). */
async function costOf(callId: string): Promise<number> {
  const rows = await AiUsage.find({ callId }).select("costUsd").lean();
  return Math.round(rows.reduce((s, r) => s + (r.costUsd ?? 0), 0) * 1_000_000) / 1_000_000;
}

/** Stop: aborts a running answer here, or cancels a queued one. Editors only. */
export async function stopProjectMessage(authIn: AuthPayload | null, messageId: string): Promise<ChatMessageView> {
  const m = Types.ObjectId.isValid(messageId) ? await AiAssistMessage.findById(messageId) : null;
  if (!m || !m.projectId || m.role !== "assistant") throw new AiWorkspaceError(BN.notFound);
  await loadProject(authIn, m.projectId.toString(), "editor");
  const ctl = running.get(m._id.toString());
  if (ctl) ctl.abort();
  else await AiAssistMessage.updateOne({ _id: m._id, status: { $in: ["queued", "running"] } }, { $set: { status: "stopped", error: BN.stopped } });
  // Give a running call a moment to write its final state.
  if (ctl) await new Promise((r) => setTimeout(r, 50));
  return projectChatMessage(authIn, messageId);
}

// ---------------------------------------------------------------------------
// The off-peak queue
// ---------------------------------------------------------------------------

/** Answers queued turns whose time has come, while DeepSeek is off-peak. Two at a time. */
export async function processQueuedChats(now: Date = new Date(), deps: ChatDeps = {}): Promise<number> {
  if (isPeak("deepseek", now)) return 0;
  const due = await AiAssistMessage.find({ status: "queued", runAfter: { $lte: now } }).sort({ runAfter: 1 }).limit(10).select("_id teacherId").lean();
  let n = 0;
  for (let i = 0; i < due.length; i += 2) {
    const batch = due.slice(i, i + 2);
    await Promise.all(
      batch.map(async (m) => {
        const u = await User.findById(m.teacherId).select("role").lean();
        await runAnswer(m._id, { userId: m.teacherId.toString(), role: (u?.role ?? "PRINCIPAL") as AuthPayload["role"] }, deps);
        n++;
      }),
    );
  }
  return n;
}

/** Answers left "running" by a restart become failed, so the chat is not stuck. */
export async function failOrphanedAnswers(): Promise<void> {
  await AiAssistMessage.updateMany({ status: "running", projectId: { $ne: null } }, { $set: { status: "failed", error: "সার্ভার আবার চালু হওয়ায় উত্তরটি থেমে গেছে — আবার পাঠান" } });
}

let queueTimer: ReturnType<typeof setInterval> | null = null;
/** Boot: once a minute, answer due off-peak turns (single-instance server, like the ticker). */
export function startWorkspaceChatQueue(): void {
  if (queueTimer) return;
  void failOrphanedAnswers().catch(() => undefined);
  queueTimer = setInterval(() => {
    void processQueuedChats().catch((e) => console.warn("[ai-workspace] queue tick failed:", (e as Error)?.message));
  }, 60_000);
  queueTimer.unref?.();
}

/** For the SSE route: who may watch a message. */
export async function assertCanWatchMessage(authIn: AuthPayload | null, messageId: string): Promise<void> {
  const m = Types.ObjectId.isValid(messageId) ? await AiAssistMessage.findById(messageId).select("projectId").lean() : null;
  if (!m || !m.projectId) throw new ForbiddenError(BN.notFound);
  await loadProject(authIn, m.projectId.toString(), "viewer");
}
