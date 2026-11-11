/**
 * Claude as the third AI provider ("anthropic") — no network, no database.
 *   • the request: cached stable prefix + context (explicit breakpoints), top-level automatic
 *     caching for the tail, adaptive thinking with effort from the seam's reasoning level,
 *     the server-side refusal fallback on Opus / Sonnet only, pictures and PDFs as blocks
 *   • the reply: text only (thinking dropped), usage mapped (cache read → hit, input + cache
 *     write → miss), a refusal / max_tokens stop is an error, never an answer; live deltas
 *   • the price: cache writes pay the 1.25× premium on top of the miss price
 *   • the router: a Claude model picked in a workspace chat switches the provider for that call,
 *     with Claude's own key; a Gemini route still refuses a picked model
 *   • the settings test: 401 / 404 / 200 from the Models API read
 */
import { AnthropicProvider, claudeBody, CLAUDE_THINKING_ALLOWANCE } from "../modules/platform/ai/anthropicProvider";
import { costUsd } from "../modules/platform/ai/aiPrices";
import { aiSend, AiModelOverrideError, type AiLedger } from "../modules/platform/ai/aiRouter";
import { providerOfModel, WORKSPACE_MODELS } from "../modules/platform/ai/models";
import { AiProviderError, type AiProvider, type AiProviderName, type AiSendInput } from "../modules/platform/ai/provider";
import { testAnthropic } from "../modules/platform/services/AiSettingService";

const base: AiSendInput = { stablePrefix: "RULES", context: "CHAPTER", history: [{ role: "user", text: "q1" }, { role: "assistant", text: "a1" }], variablePart: "q2", maxOutputTokens: 1000, reasoning: "low" };

function fakeClient(reply: Record<string, unknown>, deltas: string[] = [], seen: Array<Record<string, unknown>> = []) {
  return () => ({
    beta: {
      messages: {
        stream(body: Record<string, unknown>) {
          seen.push(body);
          const handlers: Array<(d: string) => void> = [];
          return {
            on(_e: "text", fn: (d: string) => void) {
              handlers.push(fn);
              return this;
            },
            async finalMessage() {
              for (const d of deltas) handlers.forEach((h) => h(d));
              return reply;
            },
          };
        },
      },
    },
    models: { retrieve: async (id: string) => ({ id }) },
  });
}

const OK = {
  model: "claude-sonnet-5-5",
  stop_reason: "end_turn",
  content: [{ type: "thinking", text: "" }, { type: "text", text: "উত্তর " }, { type: "text", text: "শেষ" }],
  usage: { input_tokens: 40, cache_creation_input_tokens: 2000, cache_read_input_tokens: 9000, output_tokens: 700 },
};

describe("the request", () => {
  it("caches the prefix and the context, then the tail; effort from the reasoning level", () => {
    const b = claudeBody(base, "claude-opus-5-5");
    expect(b.system).toEqual([
      { type: "text", text: "RULES", cache_control: { type: "ephemeral" } },
      { type: "text", text: "CHAPTER", cache_control: { type: "ephemeral" } },
    ]);
    expect(b.messages).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: [{ type: "text", text: "q2" }] },
    ]);
    expect(b).toMatchObject({ cache_control: { type: "ephemeral" }, thinking: { type: "adaptive" }, output_config: { effort: "medium" }, max_tokens: 1000 + CLAUDE_THINKING_ALLOWANCE.low });
    expect(b).toMatchObject({ betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  });

  it("Haiku has no server-side fallback; off = low effort; pictures and PDFs are blocks; other files are refused", () => {
    const b = claudeBody({ ...base, reasoning: "off", files: [{ mime: "image/png", data: Buffer.from("p") }, { mime: "application/pdf", data: Buffer.from("d") }] }, "claude-haiku-5-5");
    expect(b.fallbacks).toBeUndefined();
    expect(b.betas).toBeUndefined();
    expect(b.output_config).toEqual({ effort: "low" });
    const msgs = b.messages as Array<{ content: unknown }>;
    const last = msgs[msgs.length - 1].content as Array<Record<string, unknown>>;
    expect(last.map((x) => x.type)).toEqual(["image", "document", "text"]);
    expect(() => claudeBody({ ...base, files: [{ mime: "text/csv", data: Buffer.from("x") }] }, "claude-opus-5-5")).toThrow(AiProviderError);
  });

  it("no context, no empty system block", () => {
    expect(claudeBody({ ...base, context: undefined }, "claude-sonnet-5-5").system).toEqual([{ type: "text", text: "RULES", cache_control: { type: "ephemeral" } }]);
  });
});

describe("the reply", () => {
  it("text only, usage mapped, live deltas", async () => {
    const seen: string[] = [];
    const r = await new AnthropicProvider("k", fakeClient(OK, ["উত্তর ", "শেষ"]) as never).send({ ...base, onDelta: (t) => seen.push(t) }, "claude-sonnet-5-5");
    expect(r).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5", resolvedModel: "claude-sonnet-5-5", text: "উত্তর শেষ", finishReason: "stop" });
    expect(r.usage).toEqual({ cacheHitTokens: 9000, cacheMissTokens: 2040, cacheWriteTokens: 2000, outputTokens: 700, reasoningTokens: null });
    expect(seen).toEqual(["উত্তর ", "উত্তর শেষ"]);
  });

  it("a refusal or a max_tokens stop is an error, never an answer", async () => {
    await expect(new AnthropicProvider("k", fakeClient({ ...OK, stop_reason: "refusal" }) as never).send(base, "claude-opus-5-5")).rejects.toMatchObject({ kind: "bad_response" });
    await expect(new AnthropicProvider("k", fakeClient({ ...OK, stop_reason: "max_tokens" }) as never).send(base, "claude-opus-5-5")).rejects.toMatchObject({ kind: "truncated" });
    await expect(new AnthropicProvider("k", fakeClient({ ...OK, content: [{ type: "text", text: "  " }] }) as never).send(base, "claude-opus-5-5")).rejects.toMatchObject({ kind: "bad_response" });
  });

  it("JSON asked for is parsed", async () => {
    const r = await new AnthropicProvider("k", fakeClient({ ...OK, content: [{ type: "text", text: '```json\n{"ok":true}\n```' }] }) as never).send({ ...base, json: true }, "claude-haiku-5-5");
    expect(r.json).toEqual({ ok: true });
  });
});

describe("the price", () => {
  it("cache writes pay the premium on top of the miss price", () => {
    const at = new Date("2026-11-11T08:00:00Z");
    // Opus 5.5: 1M read × 0.20 + 1M miss × 4 + 1M write × (5 − 4) + 1M out × 20 = 25.2
    expect(costUsd("anthropic", "claude-opus-5-5", { cacheHitTokens: 1e6, cacheMissTokens: 1e6, cacheWriteTokens: 1e6, outputTokens: 1e6, reasoningTokens: null }, at)).toBe(25.2);
    // No write: plain miss price; the same at any hour.
    const night = new Date("2026-11-11T20:00:00Z");
    expect(costUsd("anthropic", "claude-sonnet-5-5", { cacheHitTokens: 0, cacheMissTokens: 1e6, outputTokens: 0, reasoningTokens: null }, night)).toBe(2);
  });

  it("the workspace pickers know the Claude models", () => {
    expect(WORKSPACE_MODELS).toEqual(["deepseek-flash", "deepseek-v4-pro", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(providerOfModel("claude-haiku-5-5")).toBe("anthropic");
    expect(providerOfModel("gemini-flash-latest")).toBeNull();
  });
});

describe("the router", () => {
  const ledger = (): AiLedger => ({ assertWithinCaps: async () => undefined, record: async () => undefined, afterCall: async () => undefined });
  const made: Array<{ provider: AiProviderName; key: string }> = [];
  const make = (provider: AiProviderName, key: string): AiProvider => {
    made.push({ provider, key });
    return {
      name: provider,
      send: async (_i, model) => ({ provider, model, resolvedModel: model, text: "ok", usage: { cacheHitTokens: 0, cacheMissTokens: 1, outputTokens: 1, reasoningTokens: null }, finishReason: "stop", latencyMs: 1 }),
    };
  };
  const route = (provider: AiProviderName) => async () => ({
    enabled: true,
    primary: { provider, model: provider === "gemini" ? "gemini-flash-latest" : "deepseek-flash", key: `k-${provider}` },
    fallback: { provider: "gemini" as AiProviderName, model: "gemini-flash-latest", key: "k-gemini" },
  });

  it("a Claude model picked on a DeepSeek route answers with Claude and Claude's key", async () => {
    made.length = 0;
    const out = await aiSend("workspace_chat", base, { modelOverride: "claude-sonnet-5-5" }, { route: route("deepseek"), makeProvider: make, ledger: ledger(), keyFor: (p) => `k-${p}` });
    expect(made).toEqual([{ provider: "anthropic", key: "k-anthropic" }]);
    expect(out.result).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
  });

  it("no Claude key = not configured (then the fallback answers)", async () => {
    made.length = 0;
    const out = await aiSend("workspace_chat", base, { modelOverride: "claude-opus-5-5" }, { route: route("deepseek"), makeProvider: make, ledger: ledger(), keyFor: () => null });
    expect(out.attempts[0]).toMatchObject({ provider: "anthropic", errorKind: "not_configured" });
    expect(out.result.provider).toBe("gemini");
  });

  it("a Gemini route still refuses a picked model", async () => {
    await expect(aiSend("workspace_chat", base, { modelOverride: "claude-opus-5-5" }, { route: route("gemini"), makeProvider: make, ledger: ledger() })).rejects.toBeInstanceOf(AiModelOverrideError);
  });
});

describe("the key test (Models API read, no tokens)", () => {
  it("200 passes; 401 / 404 / 429 explain themselves", async () => {
    await expect(testAnthropic("sk-ant-x", "claude-opus-5-5", async () => 200)).resolves.toBeUndefined();
    await expect(testAnthropic("sk-ant-x", "claude-opus-5-5", async () => 401)).rejects.toThrow("Claude Console");
    await expect(testAnthropic("sk-ant-x", "claude-opus-9", async () => 404)).rejects.toThrow("claude-opus-9");
    await expect(testAnthropic("sk-ant-x", "claude-opus-5-5", async () => 429)).rejects.toThrow("429");
  });
});
