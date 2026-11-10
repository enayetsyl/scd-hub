/**
 * AI Workspace W-2 — project chat (docs/prd-ai-workspace.md §4; D-#1201, #1203–#1205,
 * #1207, #1226, #1228), on an in-memory MongoDB. The model call is a stub.
 *   • prompt: fixed instructions + project instructions + pinned files (byte-identical across
 *     turns, checked through deepseekBody) → chat-attached files → FULL history → message
 *   • pickers: the model goes as a per-call override, thinking as reasoning; required
 *   • the answer streams into its placeholder; usage, cost and the context meter are kept
 *   • off-peak: queued until DeepSeek is off-peak, then answered by the queue
 *   • stop: a running answer ends "stopped" (no fallback); a queued one is cancelled
 *   • name protection ON: de-identified out, names restored in; OFF: soft number warning
 *   • the teacher assistant never lists or opens project chats
 *   • router: model override only on DeepSeek and only its models; Stop never falls back;
 *     the log keeps references, not copies, for workspace chat
 *   • DeepSeek's stream parser, and the price clock
 * Every name here is invented.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { Student } from "../modules/foundation/models/Student";
import { AiAssistMessage } from "../modules/ai-assist/models/AiAssistMessage";
import { AiAssistSession } from "../modules/ai-assist/models/AiAssistSession";
import { AiProjectFile } from "../modules/ai-workspace/models/AiProjectFile";
import { AiUsage } from "../modules/platform/models/AiUsage";
import { AiExchange } from "../modules/platform/models/AiExchange";
import { createAiProject, saveAiProjectInstructions, updateAiProject } from "../modules/ai-workspace/services/AiProjectService";
import {
  buildChatPrompt,
  CHAT_INSTRUCTIONS,
  processQueuedChats,
  projectChat,
  projectChatMessagesPage,
  projectChatsPage,
  sendProjectMessage,
  startProjectChat,
  stopProjectMessage,
  workspacePriceClock,
} from "../modules/ai-workspace/services/ProjectChatService";
import { allAssistSessionsPage, myAssistSessionsPage } from "../modules/ai-assist/services/AiAssistService";
import { deepseekBody, readDeepseekStream } from "../modules/platform/ai/deepseekProvider";
import { aiSend, AiModelOverrideError, type AiLedger } from "../modules/platform/ai/aiRouter";
import { AiProviderError, type AiSendInput } from "../modules/platform/ai/provider";
import { isPeak, priceClock } from "../modules/platform/ai/aiPrices";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
const viewer: AuthPayload = { userId: new Types.ObjectId().toString(), role: "TEACHER", grantedPermissions: ["ai_workspace:use"] };
const MON_PEAK = new Date("2026-11-09T07:00:00Z"); // Monday 13:00 Dhaka — peak
const MON_OFF = new Date("2026-11-09T12:00:00Z"); // Monday 18:00 Dhaka — off-peak

type Sent = { feature: string; input: AiSendInput; ctx: Record<string, unknown> };
function stubSend(reply: (input: AiSendInput) => string, sent: Sent[] = []) {
  const fn = async (feature: string, input: AiSendInput, ctx: Record<string, unknown>) => {
    sent.push({ feature, input, ctx });
    const text = reply(input);
    input.onDelta?.(text.slice(0, 3));
    input.onDelta?.(text);
    const callId = new Types.ObjectId().toString();
    await AiUsage.create({ at: new Date(), branch: "sylhet", feature, callId, attempt: 1, provider: "deepseek", modelName: String(ctx.modelOverride), costUsd: 0.0021, outcome: "ok", projectId: ctx.projectId as string, cacheHitTokens: 100, cacheMissTokens: 20, outputTokens: 30 });
    return {
      result: { provider: "deepseek" as const, model: String(ctx.modelOverride), resolvedModel: String(ctx.modelOverride), text, usage: { cacheHitTokens: 100, cacheMissTokens: 20, outputTokens: 30, reasoningTokens: 5 }, finishReason: "stop" as const, latencyMs: 3 },
      attempts: [],
      callId,
    };
  };
  return fn as unknown as typeof aiSend;
}
const pick = { model: "deepseek-v4-pro", thinking: "low", runAt: "now" };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await User.create([
    { _id: principal.userId, role: "PRINCIPAL", name: "Head Teacher", phone: "01700000001", passwordHash: "x" },
    { _id: viewer.userId, role: "TEACHER", name: "Viewer Teacher", phone: "01700000002", passwordHash: "x", grantedPermissions: ["ai_workspace:use"] },
  ]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("project chat", () => {
  let projectId = "";
  let sessionId = "";

  beforeAll(async () => {
    projectId = (await createAiProject(principal, { name: "Storybook series", nameProtection: false })).id;
    await saveAiProjectInstructions(principal, projectId, "## নিয়ম\nছোট বাক্যে গল্প লিখুন।");
    await AiProjectFile.create([
      { projectId, name: "b.md", mime: "text/markdown", sizeBytes: 1, status: "ready", text: "FILE B", tokenCount: 2, pinned: true, order: 2, uploadedBy: principal.userId },
      { projectId, name: "a.md", mime: "text/markdown", sizeBytes: 1, status: "ready", text: "FILE A", tokenCount: 2, pinned: true, order: 1, uploadedBy: principal.userId },
      { projectId, name: "off.md", mime: "text/markdown", sizeBytes: 1, status: "ready", text: "UNPINNED", tokenCount: 2, pinned: false, order: 3, uploadedBy: principal.userId },
    ]);
    const chat = await startProjectChat(principal, projectId, "গল্প ১");
    sessionId = chat.id;
    await AiProjectFile.create({ projectId, sessionId, name: "chat-only.md", mime: "text/markdown", sizeBytes: 1, status: "ready", text: "CHAT FILE", tokenCount: 2, pinned: false, order: 1, uploadedBy: principal.userId });
  });

  it("a viewer reads chats but cannot start one or send", async () => {
    await createAiProject(principal, { name: "other", nameProtection: false });
    const { setAiProjectMembers } = await import("../modules/ai-workspace/services/AiProjectService");
    await setAiProjectMembers(principal, projectId, [{ userId: principal.userId, role: "owner" }, { userId: viewer.userId, role: "viewer" }]);
    expect((await projectChatsPage(viewer, projectId, {})).total).toBe(1);
    await expect(startProjectChat(viewer, projectId)).rejects.toThrow("লেখার অনুমতি নেই");
    await expect(sendProjectMessage(viewer, sessionId, { text: "x", ...pick })).rejects.toThrow("লেখার অনুমতি নেই");
  });

  it("the pickers are required and checked", async () => {
    await expect(sendProjectMessage(principal, sessionId, { text: "x", ...pick, model: "gpt-4" })).rejects.toThrow("মডেলটি");
    await expect(sendProjectMessage(principal, sessionId, { text: "x", ...pick, thinking: "max" })).rejects.toThrow("চিন্তার");
    await expect(sendProjectMessage(principal, sessionId, { text: "x", ...pick, runAt: "" })).rejects.toThrow("কম দামে");
  });

  it("send → the answer streams into its placeholder; prompt order, pickers, ledger and meter", async () => {
    const sent: Sent[] = [];
    const r = await sendProjectMessage(principal, sessionId, { text: "প্রথম গল্প লিখুন", ...pick }, { send: stubSend(() => "এক ছিল এক রাজা।", sent) });
    expect(r.assistant.status).toBe("running");
    await r.done;
    const page = await projectChatMessagesPage(principal, sessionId, {});
    expect(page.rows.map((m) => [m.role, m.text, m.status])).toEqual([
      ["user", "প্রথম গল্প লিখুন", "done"],
      ["assistant", "এক ছিল এক রাজা।", "done"],
    ]);
    expect(page.rows[1]).toMatchObject({ tokens: 150, costUsd: 0.0021, modelName: "deepseek-v4-pro", thinking: "low" });
    const { input, ctx, feature } = sent[0];
    expect(feature).toBe("workspace_chat");
    expect(input.stablePrefix).toBe(`${CHAT_INSTRUCTIONS}\n\n# PROJECT INSTRUCTIONS\n\n## নিয়ম\nছোট বাক্যে গল্প লিখুন।\n\n# FILE: a.md\n\nFILE A\n\n# FILE: b.md\n\nFILE B`);
    expect(input.context).toBe("# ATTACHED FILE: chat-only.md\n\nCHAT FILE");
    expect(input).toMatchObject({ history: [], variablePart: "প্রথম গল্প লিখুন", reasoning: "low", maxOutputTokens: 8000 });
    expect(ctx).toMatchObject({ modelOverride: "deepseek-v4-pro", projectId, sessionId, exchange: { historyRef: `AiAssistSession:${sessionId}@0`, deidentified: false } });
    const chat = await projectChat(principal, sessionId);
    expect(chat).toMatchObject({ model: "deepseek-v4-pro", thinking: "low", runAt: "now", contextTokens: 150, suggestNewChat: false, turns: 1 });
  });

  it("the prefix is byte-identical on the next turn and the WHOLE history is sent (never shortened)", async () => {
    const sent: Sent[] = [];
    for (let i = 2; i <= 13; i++) {
      const r = await sendProjectMessage(principal, sessionId, { text: `প্রশ্ন ${i}`, ...pick }, { send: stubSend((inp) => `উত্তর ${inp.variablePart}`, sent) });
      await r.done;
    }
    const first = deepseekBody(sent[0].input, "deepseek-v4-pro") as { messages: Array<{ role: string; content: string }> };
    const last = deepseekBody(sent[sent.length - 1].input, "deepseek-v4-pro") as { messages: Array<{ role: string; content: string }> };
    expect(last.messages[0]).toEqual(first.messages[0]);
    expect(sent[sent.length - 1].input.history).toHaveLength(2 * 12); // turns 1..12 before turn 13
    expect(sent[sent.length - 1].input.history![0]).toEqual({ role: "user", text: "প্রথম গল্প লিখুন" });
  });

  it("a second send waits for the running answer", async () => {
    let release: (() => void) | null = null;
    const slow = (async () => {
      await new Promise<void>((r) => (release = r));
      throw new AiProviderError("stopped", "x", "deepseek");
    }) as unknown as typeof aiSend;
    const r = await sendProjectMessage(principal, sessionId, { text: "ধীর", ...pick }, { send: slow });
    await expect(sendProjectMessage(principal, sessionId, { text: "আবার", ...pick })).rejects.toThrow("আগের উত্তরটি");
    for (let i = 0; i < 100 && !release; i++) await new Promise((res) => setTimeout(res, 20));
    (release as unknown as () => void)();
    await r.done;
    expect((await AiAssistMessage.findById(r.assistant.id).lean())?.status).toBe("stopped");
  });

  it("stop aborts a running answer — the partial text stays, no fallback", async () => {
    const send = (async (_f: string, input: AiSendInput) => {
      input.onDelta?.("অর্ধেক");
      await new Promise<void>((res, rej) => input.abortSignal!.addEventListener("abort", () => rej(new AiProviderError("stopped", "x", "deepseek"))));
    }) as unknown as typeof aiSend;
    const r = await sendProjectMessage(principal, sessionId, { text: "থামবে", ...pick }, { send });
    await new Promise((res) => setTimeout(res, 500));
    await stopProjectMessage(principal, r.assistant.id);
    await r.done;
    expect(await AiAssistMessage.findById(r.assistant.id).lean()).toMatchObject({ status: "stopped", text: "অর্ধেক" });
  });

  it("off-peak: queued at peak with runAfter; the queue answers it once off-peak; stop cancels a queued one", async () => {
    const chat = await startProjectChat(principal, projectId, "রাতের কাজ");
    const r = await sendProjectMessage(principal, chat.id, { text: "রাতে লিখুন", ...pick, runAt: "offpeak" }, { now: () => MON_PEAK });
    expect(r.assistant.status).toBe("queued");
    expect(r.assistant.runAfter?.toISOString()).toBe("2026-11-09T10:00:00.000Z");
    const sent: Sent[] = [];
    expect(await processQueuedChats(MON_PEAK, { send: stubSend(() => "x", sent) })).toBe(0);
    expect(await processQueuedChats(MON_OFF, { send: stubSend(() => "রাতের উত্তর", sent) })).toBe(1);
    expect(await AiAssistMessage.findById(r.assistant.id).lean()).toMatchObject({ status: "done", text: "রাতের উত্তর" });

    const r2 = await sendProjectMessage(principal, chat.id, { text: "আবার রাতে", ...pick, runAt: "offpeak" }, { now: () => MON_PEAK });
    const stopped = await stopProjectMessage(principal, r2.assistant.id);
    expect(stopped.status).toBe("stopped");
    expect(await processQueuedChats(MON_OFF, { send: stubSend(() => "x") })).toBe(0);
  });

  it("an off-peak send while already off-peak runs at once", async () => {
    const chat = await startProjectChat(principal, projectId, "এখনই কম দামে");
    const r = await sendProjectMessage(principal, chat.id, { text: "এখন", ...pick, runAt: "offpeak" }, { now: () => MON_OFF, send: stubSend(() => "ঠিক আছে") });
    expect(r.assistant.status).toBe("running");
    await r.done;
  });

  it("name protection OFF: a phone number is sent as written with a soft warning", async () => {
    const r = await sendProjectMessage(principal, sessionId, { text: "ফোন 01712345678", ...pick }, { send: stubSend(() => "ok") });
    await r.done;
    expect(r.user.warning).toContain("ফোন নম্বর");
  });

  it("name protection ON: names hidden going out (prefix, history, message) and restored coming back", async () => {
    await Student.create({ schoolId: "0201", name: "Tahsin Karim", nameBn: "তাহসিন করিম", classId: new Types.ObjectId(), sectionId: new Types.ObjectId() });
    const pid = (await createAiProject(principal, { name: "Report help", nameProtection: true })).id;
    await saveAiProjectInstructions(principal, pid, "Tahsin Karim-এর জন্য সহজ ভাষা।");
    const chat = await startProjectChat(principal, pid);
    const sent: Sent[] = [];
    const r = await sendProjectMessage(principal, chat.id, { text: "তাহসিন করিম কেমন করছে?", ...pick }, { send: stubSend((inp) => `${inp.variablePart.match(/\[S\d*\]/)?.[0]} ভালো করছে।`, sent) });
    await r.done;
    expect(sent[0].input.stablePrefix).not.toContain("Tahsin");
    expect(sent[0].input.variablePart).not.toContain("তাহসিন");
    expect(sent[0].ctx).toMatchObject({ exchange: { deidentified: true } });
    expect((await AiAssistMessage.findById(r.assistant.id).lean())?.text).toMatch(/^(তাহসিন করিম|Tahsin Karim) ভালো করছে।$/);
  });

  it("the teacher assistant never lists project chats", async () => {
    expect((await myAssistSessionsPage(principal, {})).total).toBe(0);
    expect((await allAssistSessionsPage(principal, {})).total).toBe(0);
    expect(await AiAssistSession.countDocuments({ projectId: { $ne: null } })).toBeGreaterThan(0);
  });

  it("an archived project takes no new messages", async () => {
    await updateAiProject(principal, projectId, { archived: true });
    await expect(sendProjectMessage(principal, sessionId, { text: "x", ...pick })).rejects.toThrow("আর্কাইভ");
    await updateAiProject(principal, projectId, { archived: false });
  });

  it("buildChatPrompt leaves out a turn whose answer failed", async () => {
    const chat = await startProjectChat(principal, projectId, "ব্যর্থ");
    const t0 = new Date();
    await AiAssistMessage.create([
      { sessionId: chat.id, teacherId: principal.userId, projectId, role: "user", text: "Q1", at: t0, status: "done" },
      { sessionId: chat.id, teacherId: principal.userId, projectId, role: "assistant", text: "", at: new Date(t0.getTime() + 1), status: "failed" },
      { sessionId: chat.id, teacherId: principal.userId, projectId, role: "user", text: "Q2", at: new Date(t0.getTime() + 2), status: "done" },
      { sessionId: chat.id, teacherId: principal.userId, projectId, role: "assistant", text: "A2", at: new Date(t0.getTime() + 3), status: "done" },
    ]);
    const { AiProject } = await import("../modules/ai-workspace/models/AiProject");
    const p = await AiProject.findById(projectId);
    const prompt = await buildChatPrompt(p!, new Types.ObjectId(chat.id), new Date(t0.getTime() + 10));
    expect(prompt.history).toEqual([{ role: "user", text: "Q2" }, { role: "assistant", text: "A2" }]);
  });
});

describe("router, stream parser, price clock", () => {
  const route = async () => ({ enabled: true, primary: { provider: "deepseek" as const, model: "deepseek-flash", key: "k" }, fallback: { provider: "gemini" as const, model: "g", key: "g" } });
  const ledger = (log: unknown[] = []): AiLedger => ({ assertWithinCaps: async () => undefined, record: async (rows) => void log.push(...rows), afterCall: async () => undefined, exchange: async (x) => void log.push(x) });
  const base: AiSendInput = { stablePrefix: "P", variablePart: "Q", maxOutputTokens: 10, reasoning: "off", history: [{ role: "user", text: "old" }] };

  it("the model override answers with that DeepSeek model; anything else is refused", async () => {
    const seen: string[] = [];
    const make = () => ({ name: "deepseek" as const, send: async (_i: AiSendInput, m: string) => (seen.push(m), { provider: "deepseek" as const, model: m, resolvedModel: m, text: "ok", usage: { cacheHitTokens: 0, cacheMissTokens: 1, outputTokens: 1, reasoningTokens: null }, finishReason: "stop" as const, latencyMs: 1 }) });
    await aiSend("workspace_chat", base, { modelOverride: "deepseek-v4-pro" }, { route, makeProvider: make, ledger: ledger() });
    expect(seen).toEqual(["deepseek-v4-pro"]);
    await expect(aiSend("workspace_chat", base, { modelOverride: "gemini-flash-latest" }, { route, makeProvider: make, ledger: ledger() })).rejects.toBeInstanceOf(AiModelOverrideError);
  });

  it("Stop never falls back to the other provider; reference mode drops the history copy", async () => {
    const tried: string[] = [];
    const log: Array<Record<string, unknown>> = [];
    const make = (p: "deepseek" | "gemini") => ({
      name: p,
      send: async () => {
        tried.push(p);
        throw new AiProviderError("stopped", "x", p);
      },
    });
    await expect(aiSend("workspace_chat", base, { exchange: { historyRef: "AiAssistSession:x@1", prefixRef: "h", deidentified: false } }, { route, makeProvider: make as never, ledger: ledger(log as never) })).rejects.toMatchObject({ kind: "stopped" });
    expect(tried).toEqual(["deepseek"]);
    const x = log.find((r) => "historyRef" in r)!;
    expect(x).toMatchObject({ history: [], historyRef: "AiAssistSession:x@1", prefixRef: "h", deidentified: false });
  });

  it("the exchange log stores a reference row for workspace chat", async () => {
    const { recordAiExchange } = await import("../modules/platform/services/AiExchangeService");
    await recordAiExchange({ at: new Date(), feature: "workspace_chat", callId: "c-ref", stablePrefix: "VERY LONG PREFIX", history: [{ role: "user", text: "old" }], historyRef: "AiAssistSession:s@2", prefixRef: "project:x@v1#abc,f1", deidentified: false, request: "Q", reply: "A", attempts: [] });
    const row = await AiExchange.findOne({ callId: "c-ref" }).lean();
    expect(row).toMatchObject({ history: [], historyRef: "AiAssistSession:s@2", deidentified: false });
    expect(row?.prefixHash.startsWith("ref:")).toBe(true);
  });

  it("parses DeepSeek's stream: answer text only, finish reason, usage from the last chunk", async () => {
    const lines = [
      'data: {"model":"deepseek-v4-pro","choices":[{"delta":{"reasoning_content":"thinking..."}}]}',
      'data: {"choices":[{"delta":{"content":"এক "}}]}',
      'data: {"choices":[{"delta":{"content":"ছিল"},"finish_reason":"stop"}]}',
      'data: {"choices":[],"usage":{"prompt_cache_hit_tokens":7,"prompt_cache_miss_tokens":3,"completion_tokens":9}}',
      "data: [DONE]",
      "",
    ].join("\n");
    const bytes = new TextEncoder().encode(lines);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 40));
        c.enqueue(bytes.slice(40));
        c.close();
      },
    });
    const seen: string[] = [];
    const r = await readDeepseekStream(body, (t) => seen.push(t));
    expect(seen).toEqual(["এক ", "এক ছিল"]);
    expect(r).toMatchObject({ model: "deepseek-v4-pro", choices: [{ finish_reason: "stop", message: { content: "এক ছিল" } }], usage: { prompt_cache_hit_tokens: 7, completion_tokens: 9 } });
    expect(deepseekBody({ ...base, onDelta: () => undefined }, "m")).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it("price clock: weekday peak 01–04 and 06–10 UTC; weekends off-peak", () => {
    expect(isPeak("deepseek", MON_PEAK)).toBe(true);
    expect(priceClock("deepseek", MON_PEAK)).toMatchObject({ peak: true, changesAt: new Date("2026-11-09T10:00:00Z"), factor: 1 });
    expect(priceClock("deepseek", MON_OFF)).toMatchObject({ peak: false, changesAt: new Date("2026-11-10T01:00:00Z"), factor: 0.5 });
    const sat = new Date("2026-11-14T08:00:00Z");
    expect(priceClock("deepseek", sat)).toMatchObject({ peak: false, changesAt: new Date("2026-11-16T01:00:00Z") });
    const c = workspacePriceClock(MON_OFF);
    expect(c.flashPerMillion.output).toBeCloseTo(0.6);
  });
});
