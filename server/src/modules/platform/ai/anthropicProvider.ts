/**
 * Claude on the shared AI seam (provider "anthropic") — so the school's Claude API credit can
 * answer any AI feature a Principal points at it, and the AI Workspace pickers (chat, revise,
 * batch job) can choose a Claude model per message. Uses the official SDK (@anthropic-ai/sdk).
 *
 * The SDK is loaded with `require` behind the narrow interfaces below, NOT imported with its
 * types: the server `tsc` already runs close to CI's 4 GB heap, and the SDK's request/response
 * unions are large (the MCP SDK precedent, mcp/sdk.ts). The wire shapes used here follow the
 * Claude API docs:
 *   - prompt caching: an explicit breakpoint on the stable prefix (and on the session context),
 *     plus top-level automatic caching for the growing conversation tail — 3 of the 4 slots;
 *     5-minute TTL (every chat turn or job item refreshes it);
 *   - thinking: adaptive (Opus 5.5 cannot switch it off); the seam's reasoning level maps to
 *     `output_config.effort` (off → low, low → medium, high → high). Thinking tokens come out
 *     of max_tokens, so an allowance is added to the caller's answer budget (as for Gemini);
 *   - always streamed (long answers must not hit HTTP timeouts); `finalMessage()` gives the
 *     whole reply; the "text" event feeds the W-2 live answer;
 *   - refusals: on Opus / Sonnet the server-side fallback (`fallbacks: "default"`, beta
 *     `server-side-fallback-2026-07-01`) re-runs a declined request on another Claude model in
 *     the same call; a refusal that still stands is an error, never shown as an answer;
 *   - usage: cache_read → hit; input + cache_creation → miss (cache_creation also reported as
 *     `cacheWriteTokens`, priced at 1.25× in aiPrices.ts); output_tokens includes thinking.
 * Pictures (png/jpeg/gif/webp) and PDFs are sent as image / document blocks.
 */
import { ANTHROPIC_MODELS } from "./models";
import {
  AiProviderError,
  classifyStatus,
  DEFAULT_TIMEOUT_MS,
  parseJsonReply,
  withDeadline,
  type AiProvider,
  type AiReasoning,
  type AiSendInput,
  type AiSendResult,
} from "./provider";

export { ANTHROPIC_MODELS };

const EFFORT: Record<AiReasoning, "low" | "medium" | "high"> = { off: "low", low: "medium", high: "high" };
/** Added to the caller's answer budget: thinking tokens count against max_tokens. */
export const CLAUDE_THINKING_ALLOWANCE: Record<AiReasoning, number> = { off: 4096, low: 8192, high: 16_000 };
/** Models with the server-side refusal fallback (Haiku has none). */
const SERVER_FALLBACK_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"];
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// ---- the SDK surface used here (see the header for why it is not imported with types) ----
interface ClaudeUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}
interface ClaudeMessage {
  model?: string;
  stop_reason?: string | null;
  content?: Array<{ type: string; text?: string }>;
  usage?: ClaudeUsage;
}
interface ClaudeStream {
  on(event: "text", fn: (delta: string) => void): unknown;
  finalMessage(): Promise<ClaudeMessage>;
}
interface ClaudeClient {
  beta: { messages: { stream(body: Record<string, unknown>, opts?: { signal?: AbortSignal }): ClaudeStream } };
  models: { retrieve(id: string, opts?: { signal?: AbortSignal }): Promise<{ id: string }> };
}
interface ClaudeSdk {
  Anthropic: new (opts: { apiKey: string; maxRetries?: number; timeout?: number }) => ClaudeClient;
  APIError: new (...a: never[]) => Error & { status?: number };
  APIConnectionError: new (...a: never[]) => Error;
}

let sdk: ClaudeSdk | null = null;
function loadSdk(): ClaudeSdk {
  if (!sdk) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@anthropic-ai/sdk") as Partial<ClaudeSdk> & { default?: ClaudeSdk["Anthropic"] };
    sdk = { Anthropic: (mod.Anthropic ?? mod.default)!, APIError: mod.APIError!, APIConnectionError: mod.APIConnectionError! };
  }
  return sdk;
}

/** Builds a client; injectable so the provider is tested without the network. */
export type ClaudeClientFactory = (apiKey: string) => ClaudeClient;
const defaultClient: ClaudeClientFactory = (apiKey) => new (loadSdk().Anthropic)({ apiKey, maxRetries: 0, timeout: 30 * 60 * 1000 });

function fileBlock(f: { mime: string; data: Buffer }): Record<string, unknown> {
  const data = f.data.toString("base64");
  if (f.mime === "application/pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  if (IMAGE_MIMES.includes(f.mime)) return { type: "image", source: { type: "base64", media_type: f.mime, data } };
  throw new AiProviderError("bad_response", `Claude cannot read ${f.mime}`, "anthropic");
}

/** The request body — exported so the prefix-stability test can read exactly what is sent. */
export function claudeBody(input: AiSendInput, model: string): Record<string, unknown> {
  const system = [
    ...(input.stablePrefix ? [{ type: "text", text: input.stablePrefix, cache_control: { type: "ephemeral" } }] : []),
    ...(input.context ? [{ type: "text", text: input.context, cache_control: { type: "ephemeral" } }] : []),
  ];
  const messages = [
    ...(input.history ?? []).filter((t) => t.text).map((t) => ({ role: t.role, content: t.text })),
    { role: "user", content: [...(input.files ?? []).map(fileBlock), { type: "text", text: input.variablePart }] },
  ];
  return {
    model,
    max_tokens: input.maxOutputTokens + CLAUDE_THINKING_ALLOWANCE[input.reasoning],
    ...(system.length ? { system } : {}),
    messages,
    // Automatic caching of the conversation tail (the explicit breakpoints keep the prefix).
    cache_control: { type: "ephemeral" },
    thinking: { type: "adaptive" },
    output_config: { effort: EFFORT[input.reasoning] },
    ...(SERVER_FALLBACK_MODELS.includes(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
  };
}

/** Maps an SDK error to the seam's error kinds (abort errors are left to withDeadline). */
function mapError(e: unknown, signal: AbortSignal): never {
  if (signal.aborted) throw e;
  const s = loadSdk();
  if (e instanceof AiProviderError) throw e;
  if (e instanceof s.APIConnectionError) throw new AiProviderError("network", "could not reach Claude", "anthropic");
  if (e instanceof s.APIError && typeof e.status === "number") throw new AiProviderError(classifyStatus(e.status), `Claude returned ${e.status}`, "anthropic", e.status);
  throw new AiProviderError("network", (e as Error)?.message ?? "Claude call failed", "anthropic");
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;

  constructor(
    private readonly apiKey: string,
    private readonly makeClient: ClaudeClientFactory = defaultClient,
  ) {}

  async send(input: AiSendInput, model: string): Promise<AiSendResult> {
    const started = Date.now();
    const body = claudeBody(input, model);
    const msg = await withDeadline(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, this.name, async (signal) => {
      try {
        const stream = this.makeClient(this.apiKey).beta.messages.stream(body, { signal });
        let text = "";
        if (input.onDelta) {
          const onDelta = input.onDelta;
          stream.on("text", (delta) => {
            text += delta;
            onDelta(text);
          });
        }
        return await stream.finalMessage();
      } catch (e) {
        return mapError(e, signal);
      }
    }, input.abortSignal);

    const stop = msg.stop_reason ?? null;
    if (stop === "refusal") throw new AiProviderError("bad_response", "Claude declined this request", this.name);
    if (stop !== "end_turn" && stop !== "stop_sequence") {
      throw new AiProviderError("truncated", `Claude stopped early (${stop ?? "no stop reason"})`, this.name);
    }
    // Thinking blocks are the model's reasoning, never the answer.
    const text = (msg.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    if (!text) throw new AiProviderError("bad_response", "Claude returned no text", this.name);

    const u = msg.usage ?? {};
    const write = u.cache_creation_input_tokens ?? 0;
    return {
      provider: this.name,
      model,
      resolvedModel: msg.model || model,
      text,
      ...(input.json ? { json: parseJsonReply(text, this.name) } : {}),
      usage: {
        cacheHitTokens: u.cache_read_input_tokens ?? 0,
        cacheMissTokens: (u.input_tokens ?? 0) + write,
        cacheWriteTokens: write,
        outputTokens: u.output_tokens ?? 0,
        reasoningTokens: null,
      },
      finishReason: "stop",
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * The settings screen's key test: reads the model through the Models API — proves the key and
 * that the model exists, and costs no tokens. Returns the HTTP status (200 = fine).
 */
export async function pingAnthropic(key: string, model: string, makeClient: ClaudeClientFactory = defaultClient): Promise<number> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    await makeClient(key).models.retrieve(model, { signal: ctl.signal });
    return 200;
  } catch (e) {
    const s = loadSdk();
    if (e instanceof s.APIError && typeof e.status === "number") return e.status;
    throw new Error("Claude-এ পৌঁছানো যায়নি — ইন্টারনেট সংযোগ দেখুন");
  } finally {
    clearTimeout(timer);
  }
}
