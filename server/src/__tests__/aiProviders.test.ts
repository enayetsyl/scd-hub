/**
 * AI-1 provider seam (D-#1090) — DB-free, no network.
 *   • prompt order keeps the cache: the stable prefix is byte-identical across calls
 *   • DeepSeek: thinking off by default for "off", JSON mode, usage incl. cache hit/miss
 *   • any finish other than a normal stop is an error (a cut-off reply never reaches anyone)
 *   • Gemini: thinking parts are never the answer; the budget covers the thinking
 *   • the router: a switched-off feature sends nothing; one fallback, every attempt returned
 */
import { DeepseekProvider, deepseekBody } from "../modules/platform/ai/deepseekProvider";
import { GeminiProvider, geminiBody, THINKING_ALLOWANCE } from "../modules/platform/ai/geminiProvider";
import { AiProviderError, type AiSendInput, type FetchLike } from "../modules/platform/ai/provider";
import { aiSend, AiFeatureOffError, type ProviderFactory } from "../modules/platform/ai/aiRouter";
import type { AiRoute } from "../modules/platform/services/AiSettingService";

const PREFIX = "নিয়ম: সম্মানসূচক রূপ, দাঁড়ি, নির্দিষ্ট অনুরোধ।\n(examples …)";
const base = (variablePart: string, extra: Partial<AiSendInput> = {}): AiSendInput => ({
  stablePrefix: PREFIX,
  variablePart,
  maxOutputTokens: 800,
  reasoning: "off",
  ...extra,
});

/** A fetch that records each body and answers with the queued replies in order. */
function fakeFetch(replies: Array<{ status?: number; body?: unknown }>) {
  const sent: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fn: FetchLike = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = replies[Math.min(sent.length - 1, replies.length - 1)];
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body ?? {} };
  };
  return { fn, sent };
}

const dsOk = (content: string, finish = "stop") => ({
  body: {
    model: "deepseek-flash",
    choices: [{ finish_reason: finish, message: { content } }],
    usage: { prompt_cache_hit_tokens: 5000, prompt_cache_miss_tokens: 500, completion_tokens: 420, completion_tokens_details: { reasoning_tokens: 0 } },
  },
});

describe("prompt order is the cache", () => {
  test("the stable prefix is the first message, byte-identical whatever follows", () => {
    const a = deepseekBody(base("মন্তব্য ১"), "deepseek-flash");
    const b = deepseekBody(base("আরেকটি মন্তব্য", { history: [{ role: "user", text: "q" }, { role: "assistant", text: "a" }] }), "deepseek-flash");
    const first = (x: Record<string, unknown>) => (x.messages as Array<{ role: string; content: string }>)[0];
    expect(first(a)).toEqual({ role: "system", content: PREFIX });
    expect(Buffer.from(first(a).content).equals(Buffer.from(first(b).content))).toBe(true);
    const msgs = b.messages as Array<{ role: string; content: string }>;
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(msgs[3].content).toBe("আরেকটি মন্তব্য");
  });

  test("context goes AFTER the prefix, so the prefix bytes still lead", () => {
    const body = deepseekBody(base("q", { context: "অধ্যায় ৩ …" }), "deepseek-flash");
    const sys = (body.messages as Array<{ content: string }>)[0].content;
    expect(sys.startsWith(PREFIX)).toBe(true);
    expect(sys.endsWith("অধ্যায় ৩ …")).toBe(true);
    const g = geminiBody(base("q", { context: "অধ্যায় ৩ …" })) as { systemInstruction: { parts: Array<{ text: string }> } };
    expect(g.systemInstruction.parts[0].text.startsWith(PREFIX)).toBe(true);
  });
});

describe("DeepSeek", () => {
  test("reasoning off is sent as reasoning_effort none; JSON mode; Bearer key; the chat endpoint", async () => {
    const { fn, sent } = fakeFetch([dsOk('{"issues":[],"corrected":"ঠিক আছে।"}')]);
    const r = await new DeepseekProvider("sk-test", fn).send(base("x", { json: true }), "deepseek-flash");
    expect(sent[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(sent[0].headers.Authorization).toBe("Bearer sk-test");
    expect(sent[0].body).toMatchObject({ model: "deepseek-flash", max_tokens: 800, reasoning_effort: "none", response_format: { type: "json_object" } });
    expect(r.json).toEqual({ issues: [], corrected: "ঠিক আছে।" });
    expect(r.usage).toEqual({ cacheHitTokens: 5000, cacheMissTokens: 500, outputTokens: 420, reasoningTokens: 0 });
    expect(r).toMatchObject({ provider: "deepseek", model: "deepseek-flash", resolvedModel: "deepseek-flash", finishReason: "stop" });
  });

  test.each(["length", "content_filter", "insufficient_system_resource"])("finish_reason %s is a truncated error, never a result", async (finish) => {
    const { fn } = fakeFetch([dsOk("অর্ধেক মন্ত", finish)]);
    await expect(new DeepseekProvider("k", fn).send(base("x"), "deepseek-flash")).rejects.toMatchObject({ kind: "truncated", provider: "deepseek" });
  });

  test("HTTP status → error kind; unparseable JSON → bad_response; empty → bad_response", async () => {
    for (const [status, kind] of [[401, "auth"], [402, "auth"], [404, "not_found"], [429, "busy"], [503, "busy"]] as const) {
      const { fn } = fakeFetch([{ status }]);
      await expect(new DeepseekProvider("k", fn).send(base("x"), "deepseek-flash")).rejects.toMatchObject({ kind, status });
    }
    await expect(new DeepseekProvider("k", fakeFetch([dsOk("not json")]).fn).send(base("x", { json: true }), "deepseek-flash")).rejects.toMatchObject({ kind: "bad_response" });
    await expect(new DeepseekProvider("k", fakeFetch([dsOk("  ")]).fn).send(base("x"), "deepseek-flash")).rejects.toMatchObject({ kind: "bad_response" });
  });

  test("a fenced JSON reply is accepted", async () => {
    const r = await new DeepseekProvider("k", fakeFetch([dsOk('```json\n{"a":1}\n```')]).fn).send(base("x", { json: true }), "deepseek-flash");
    expect(r.json).toEqual({ a: 1 });
  });

  test("no reply within the deadline → timeout", async () => {
    const hang: FetchLike = (_u, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(new DeepseekProvider("k", hang).send(base("x", { timeoutMs: 30 }), "deepseek-flash")).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("Gemini", () => {
  const gOk = (parts: Array<{ text: string; thought?: boolean }>, finishReason = "STOP") => ({
    body: {
      modelVersion: "gemini-3.6-flash-001",
      candidates: [{ finishReason, content: { parts } }],
      usageMetadata: { promptTokenCount: 6000, cachedContentTokenCount: 4000, candidatesTokenCount: 300, thoughtsTokenCount: 900 },
    },
  });

  test("thinking parts are dropped; usage splits cached vs not; the alias resolves", async () => {
    const { fn, sent } = fakeFetch([gOk([{ text: "ভাবনা…", thought: true }, { text: "উত্তর।" }])]);
    const r = await new GeminiProvider("g", fn).send(base("x"), "gemini-flash-latest");
    expect(r.text).toBe("উত্তর।");
    expect(r.usage).toEqual({ cacheHitTokens: 4000, cacheMissTokens: 2000, outputTokens: 1200, reasoningTokens: 900 });
    expect(r.resolvedModel).toBe("gemini-3.6-flash-001");
    expect(sent[0].url).toContain("/models/gemini-flash-latest:generateContent");
  });

  test("the output budget covers the thinking as well as the answer", () => {
    const g = geminiBody(base("x")) as { generationConfig: { maxOutputTokens: number } };
    expect(g.generationConfig.maxOutputTokens).toBe(800 + THINKING_ALLOWANCE.off);
  });

  test("MAX_TOKENS is truncated, never a result", async () => {
    const { fn } = fakeFetch([gOk([{ text: "অর্ধেক" }], "MAX_TOKENS")]);
    await expect(new GeminiProvider("g", fn).send(base("x"), "gemini-flash-latest")).rejects.toMatchObject({ kind: "truncated" });
  });
});

/** No database: caps always pass, rows are dropped. The ledger itself is tested in aiUsage.test.ts. */
const nullLedger = { assertWithinCaps: async () => {}, record: async () => {}, afterCall: async () => 0 };

describe("the router", () => {
  const route = (r: Partial<AiRoute> = {}): (() => Promise<AiRoute>) => async () => ({
    enabled: true,
    primary: { provider: "deepseek", model: "deepseek-flash", key: "sk" },
    fallback: { provider: "gemini", model: "gemini-flash-latest", key: "g" },
    ...r,
  });
  const ok = (provider: "deepseek" | "gemini") => ({
    provider,
    model: "m",
    resolvedModel: "m",
    text: "t",
    usage: { cacheHitTokens: 0, cacheMissTokens: 1, outputTokens: 1, reasoningTokens: null },
    finishReason: "stop" as const,
    latencyMs: 5,
  });
  const factory = (behaviour: Record<string, "ok" | "busy">): { make: ProviderFactory; calls: string[] } => {
    const calls: string[] = [];
    const make: ProviderFactory = (provider) => ({
      name: provider,
      send: async () => {
        calls.push(provider);
        if (behaviour[provider] === "busy") throw new AiProviderError("busy", "busy", provider, 503);
        return ok(provider);
      },
    });
    return { make, calls };
  };

  test("a switched-off feature sends nothing", async () => {
    const { make, calls } = factory({ deepseek: "ok" });
    await expect(aiSend("comment_check", base("x"), {}, { ledger: nullLedger,  route: route({ enabled: false }), makeProvider: make })).rejects.toBeInstanceOf(AiFeatureOffError);
    expect(calls).toEqual([]);
  });

  test("the chosen provider answers → one attempt", async () => {
    const { make, calls } = factory({ deepseek: "ok" });
    const out = await aiSend("comment_check", base("x"), {}, { ledger: nullLedger,  route: route(), makeProvider: make });
    expect(calls).toEqual(["deepseek"]);
    expect(out.attempts).toHaveLength(1);
    expect(out.result.provider).toBe("deepseek");
  });

  test("the chosen provider fails → the other is tried ONCE, both attempts returned", async () => {
    const { make, calls } = factory({ deepseek: "busy", gemini: "ok" });
    const out = await aiSend("comment_check", base("x"), {}, { ledger: nullLedger,  route: route(), makeProvider: make });
    expect(calls).toEqual(["deepseek", "gemini"]);
    expect(out.attempts.map((a) => [a.provider, a.outcome, a.errorKind ?? null, a.fallback])).toEqual([
      ["deepseek", "error", "busy", false],
      ["gemini", "ok", null, true],
    ]);
  });

  test("both fail → the last error, carrying both attempts; no third try", async () => {
    const { make, calls } = factory({ deepseek: "busy", gemini: "busy" });
    const err = await aiSend("comment_check", base("x"), {}, { ledger: nullLedger,  route: route(), makeProvider: make }).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as { attempts: unknown[] }).attempts).toHaveLength(2);
    expect(calls).toEqual(["deepseek", "gemini"]);
  });

  test("no fallback configured → one attempt; no key for the chosen provider → not_configured", async () => {
    const one = factory({ deepseek: "busy" });
    await expect(aiSend("comment_check", base("x"), {}, { ledger: nullLedger,  route: route({ fallback: null }), makeProvider: one.make })).rejects.toMatchObject({ kind: "busy" });
    expect(one.calls).toEqual(["deepseek"]);
    const none = factory({});
    await expect(
      aiSend("comment_check", base("x"), {}, { ledger: nullLedger,  route: route({ primary: { provider: "deepseek", model: "deepseek-flash", key: null }, fallback: null }), makeProvider: none.make }),
    ).rejects.toMatchObject({ kind: "not_configured" });
    expect(none.calls).toEqual([]);
  });
});
