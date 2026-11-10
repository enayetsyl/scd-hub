/**
 * DeepSeek over its OpenAI-format endpoint (D-#1090). Chosen over the Anthropic-format one
 * because it reports `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`, which the AI-2
 * ledger prices separately. Checked against api-docs.deepseek.com on 2026-11-08:
 *   POST https://api.deepseek.com/chat/completions, Bearer key
 *   models `deepseek-flash` (served by V4.1-Flash) and `deepseek-v4-pro`
 *   thinking is ON unless `reasoning_effort: "none"` is sent
 *   finish_reason: stop | length | content_filter | tool_calls | insufficient_system_resource | aborted
 *
 * Message order keeps the cache: system = stablePrefix (+ context after it), then history,
 * then the new input. DeepSeek caches on a byte prefix, so the rules must come first.
 */
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
  type FetchLike,
} from "./provider";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";
export const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"] as const;

const EFFORT: Record<AiReasoning, "none" | "low" | "high"> = { off: "none", low: "low", high: "high" };

interface DeepseekReply {
  model?: string;
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>;
  usage?: {
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/** The request body — exported so the prefix-stability test can read exactly what is sent. */
export function deepseekBody(input: AiSendInput, model: string): Record<string, unknown> {
  const system = input.context ? `${input.stablePrefix}\n\n${input.context}` : input.stablePrefix;
  const messages = [
    { role: "system", content: system },
    ...(input.history ?? []).map((t) => ({ role: t.role, content: t.text })),
    { role: "user", content: input.variablePart },
  ];
  return {
    model,
    messages,
    max_tokens: input.maxOutputTokens,
    reasoning_effort: EFFORT[input.reasoning],
    ...(input.json ? { response_format: { type: "json_object" } } : {}),
    stream: false,
  };
}

export class DeepseekProvider implements AiProvider {
  readonly name = "deepseek" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly baseUrl = DEEPSEEK_BASE_URL,
  ) {}

  async send(input: AiSendInput, model: string): Promise<AiSendResult> {
    // The chat API takes text only (W-1): never send a picture's bytes as if they were text.
    if (input.files?.length) throw new AiProviderError("bad_response", "DeepSeek cannot read pictures or PDFs", this.name);
    const started = Date.now();
    const body = await withDeadline(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, this.name, async (signal) => {
      const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(deepseekBody(input, model)),
        signal,
      });
      if (!res.ok) throw new AiProviderError(classifyStatus(res.status), `DeepSeek returned ${res.status}`, this.name, res.status);
      return (await res.json()) as DeepseekReply;
    });

    const choice = body.choices?.[0];
    const finish = choice?.finish_reason;
    if (finish !== "stop") {
      throw new AiProviderError("truncated", `DeepSeek stopped early (${finish ?? "no finish reason"})`, this.name);
    }
    const text = (choice?.message?.content ?? "").trim();
    if (!text) throw new AiProviderError("bad_response", "DeepSeek returned no text", this.name);

    const u = body.usage ?? {};
    return {
      provider: this.name,
      model,
      resolvedModel: body.model || model,
      text,
      ...(input.json ? { json: parseJsonReply(text, this.name) } : {}),
      usage: {
        cacheHitTokens: u.prompt_cache_hit_tokens ?? 0,
        cacheMissTokens: u.prompt_cache_miss_tokens ?? 0,
        outputTokens: u.completion_tokens ?? 0,
        reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? null,
      },
      finishReason: "stop",
      latencyMs: Date.now() - started,
    };
  }
}
