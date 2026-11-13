/**
 * Data assistant DA-2 review fixes: no provider fallback on tool rounds, view-as ownership,
 * Stop between tool calls, the failed round in the request log, a failed last round, the session
 * cap text. Every name here is invented.
 */
import { aiSend, type ProviderFactory } from "../modules/platform/ai/aiRouter";
import { AiProviderError, type AiProvider, type AiSendInput, type AiSendResult } from "../modules/platform/ai/provider";
import { AiExchange } from "../modules/platform/models/AiExchange";
import { AiFeatureSetting } from "../modules/platform/models/AiFeatureSetting";
import { resetLimits } from "../modules/data-assistant/limits";
import { askDataAssistant, dataChat, dataChatMessage, dataChatsPage, startDataChat, stopDataAnswer, BN, type DataChatDeps } from "../modules/data-assistant/services/DataChatService";
import type { AuthPayload } from "../context";
import { setupFixtures, teardownFixtures, type Fx } from "./dataAssistantFixtures";

const mockRunTool = jest.fn();
jest.mock("../modules/data-assistant/runTool", () => {
  const actual = jest.requireActual("../modules/data-assistant/runTool");
  return { ...actual, runTool: (...a: unknown[]) => mockRunTool(...a) };
});
const actualRunTool = jest.requireActual("../modules/data-assistant/runTool").runTool as (...a: unknown[]) => Promise<unknown>;

jest.setTimeout(180_000);
let fx: Fx;
beforeAll(async () => {
  fx = await setupFixtures();
});
afterAll(async () => teardownFixtures(fx));
beforeEach(() => {
  resetLimits();
  mockRunTool.mockReset();
  mockRunTool.mockImplementation((...a: unknown[]) => actualRunTool(...a));
});

type Script = (input: AiSendInput, n: number) => Partial<AiSendResult>;
const call = (id: string, name: string, args: unknown) => ({ id, name, argsJson: JSON.stringify(args) });

function depsFor(script: Script, opts: { fallbackOn?: boolean; fallbackCalls?: number[] } = {}): DataChatDeps {
  let n = 0;
  const make = (name: "anthropic" | "deepseek", sc: Script): AiProvider => ({
    name,
    async send(input, model) {
      if (name === "deepseek") opts.fallbackCalls?.push(1);
      const r = sc(input, n++);
      return { provider: name, model, resolvedModel: model, text: "", usage: { cacheHitTokens: 0, cacheMissTokens: 100, outputTokens: 50, reasoningTokens: null }, finishReason: "stop", latencyMs: 1, ...r } as AiSendResult;
    },
  });
  const primary = make("anthropic", script);
  const fb = make("deepseek", () => ({ text: "from deepseek" }));
  const factory: ProviderFactory = (p) => (p === "anthropic" ? primary : fb);
  return {
    send: (f, i, c, d) =>
      aiSend(f, i, c, {
        ...d,
        makeProvider: factory,
        keyFor: () => "k",
        route: async () => ({
          enabled: true,
          primary: { provider: "anthropic", model: "claude-sonnet-5-5", key: "k" },
          fallback: opts.fallbackOn ? { provider: "deepseek", model: "deepseek-flash", key: "k" } : null,
        }),
      }),
  };
}

async function ask(auth: AuthPayload, text: string, deps: DataChatDeps) {
  const s = await startDataChat(auth, {});
  const out = await askDataAssistant(auth, s.id, { text }, deps);
  await out.done;
  return { session: s, out, answer: await dataChatMessage(auth, out.assistant.id) };
}

it("a failing Claude round with the fallback switch on never reaches DeepSeek (tool rounds)", async () => {
  const fbCalls: number[] = [];
  const { answer } = await ask(
    fx.auth.principal,
    "বেতন কত?",
    depsFor(
      () => {
        throw new AiProviderError("busy", "503", "anthropic", 503);
      },
      { fallbackOn: true, fallbackCalls: fbCalls },
    ),
  );
  expect(answer.status).toBe("failed");
  expect(fbCalls).toHaveLength(0);
});

it("View as chats and real chats are separate, in both directions", async () => {
  const real = fx.auth.office;
  const borrowed: AuthPayload = { ...fx.auth.office, impersonatorId: fx.auth.principal.userId, impersonatorRole: "PRINCIPAL" };
  const a = await ask(real, "প্রশ্ন", depsFor(() => ({ text: "উত্তর" })));
  const b = await ask(borrowed, "প্রশ্ন", depsFor(() => ({ text: "উত্তর" })));
  expect(a.session.viewAs).toBe(false);
  expect(b.session.viewAs).toBe(true);
  await expect(dataChat(borrowed, a.session.id)).rejects.toThrow("পাওয়া যায়নি");
  await expect(dataChat(real, b.session.id)).rejects.toThrow("পাওয়া যায়নি");
  await expect(dataChatMessage(borrowed, a.out.assistant.id)).rejects.toThrow("পাওয়া যায়নি");
  await expect(dataChatMessage(real, b.out.assistant.id)).rejects.toThrow("পাওয়া যায়নি");
  await expect(stopDataAnswer(borrowed, a.out.assistant.id)).rejects.toThrow("পাওয়া যায়নি");
  await expect(stopDataAnswer(real, b.out.assistant.id)).rejects.toThrow("পাওয়া যায়নি");
  const realIds = (await dataChatsPage(real, {})).rows.map((r) => r.id);
  const borrowedIds = (await dataChatsPage(borrowed, {})).rows.map((r) => r.id);
  expect(realIds).toContain(a.session.id);
  expect(realIds).not.toContain(b.session.id);
  expect(borrowedIds).toContain(b.session.id);
  expect(borrowedIds).not.toContain(a.session.id);
});

it("Stop between tool calls: later calls of the round do not run", async () => {
  mockRunTool.mockImplementation(async (...a: unknown[]) => {
    const r = await actualRunTool(...a);
    await stopDataAnswer(fx.auth.principal, (a[3] as { messageId: string }).messageId);
    return r;
  });
  const { answer } = await ask(
    fx.auth.principal,
    "সব বলুন",
    depsFor(() => ({ finishReason: "tool_calls", toolCalls: [call("a", "my_access", {}), call("b", "my_access", {}), call("c", "my_access", {})], assistantRaw: [] })),
  );
  expect(mockRunTool).toHaveBeenCalledTimes(1);
  expect(answer.status).toBe("stopped");
});

it("a failed later round is in the request log (error attempt), not a clean empty reply", async () => {
  const { session, answer } = await ask(
    fx.auth.principal,
    "প্রশ্ন",
    depsFor((_i, n) => {
      if (n === 0) return { finishReason: "tool_calls", toolCalls: [call("a", "my_access", {})], assistantRaw: [] };
      throw new AiProviderError("busy", "503", "anthropic", 503);
    }),
  );
  expect(answer.status).toBe("failed");
  const ex = await AiExchange.findOne({ refId: session.id }).lean();
  expect(ex!.attempts).toHaveLength(2);
  expect(ex!.attempts[1].outcome).toBe("error");
});

it("a last round that still asks for tools, or an empty answer, fails with the down text", async () => {
  const stubborn = await ask(fx.auth.principal, "প্রশ্ন", depsFor(() => ({ finishReason: "tool_calls", toolCalls: [call("a", "my_access", {})], assistantRaw: [] })));
  expect(stubborn.answer).toMatchObject({ status: "failed", error: BN.down });
  const empty = await ask(fx.auth.principal, "প্রশ্ন", depsFor(() => ({ text: "   " })));
  expect(empty.answer).toMatchObject({ status: "failed", error: BN.down });
});

it("the session cap says the chat reached its limit (rounds, not questions)", async () => {
  await AiFeatureSetting.updateOne({ feature: "data_assistant" }, { $set: { perSessionTurns: 1 } });
  try {
    const { answer } = await ask(fx.auth.principal, "প্রশ্ন", depsFor((_i, n) => (n === 0 ? { finishReason: "tool_calls", toolCalls: [call("a", "my_access", {})], assistantRaw: [] } : { text: "উত্তর" })));
    expect(answer.status).toBe("failed");
    expect(answer.error).toContain("সীমায় পৌঁছেছে");
    expect(answer.error).not.toContain("প্রশ্নের সীমা");
  } finally {
    await AiFeatureSetting.updateOne({ feature: "data_assistant" }, { $set: { perSessionTurns: 40 } });
  }
});
