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
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> };
  }>;
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
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: system },
    ...(input.history ?? []).map((t) => ({ role: t.role, content: t.text })),
    { role: "user", content: input.variablePart },
  ];
  // DA-2 tool rounds (OpenAI format): the assistant message exactly as DeepSeek returned it
  // (content, reasoning_content, tool_calls — thinking mode needs its reasoning back within the
  // same question), then one `tool` message per call.
  for (const r of input.toolRounds ?? []) {
    messages.push(r.assistant as Record<string, unknown>);
    for (const x of r.results) messages.push({ role: "tool", tool_call_id: x.id, content: x.content });
    if (r.note) messages.push({ role: "user", content: r.note });
  }
  const tools = input.tools?.length
    ? {
        tools: input.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
        tool_choice: input.toolChoice ?? "auto",
      }
    : {};
  // Tool calls are read from the whole reply, never streamed (their arguments arrive in pieces).
  const stream = !!input.onDelta && !input.tools?.length;
  return {
    model,
    messages,
    ...tools,
    max_tokens: input.maxOutputTokens,
    reasoning_effort: EFFORT[input.reasoning],
    ...(input.json ? { response_format: { type: "json_object" } } : {}),
    // W-2: stream when the caller watches the answer arrive; the last chunk carries the usage.
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : { stream: false }),
  };
}

interface DeepseekChunk {
  model?: string;
  choices?: Array<{ finish_reason?: string | null; delta?: { content?: string | null; reasoning_content?: string | null } }>;
  usage?: DeepseekReply["usage"];
}

/**
 * Reads DeepSeek's server-sent events (`data: {...}` lines, then `data: [DONE]`) into one
 * reply, calling `onDelta` with the answer so far. Thinking text (`reasoning_content`) is
 * not part of the answer and is not shown. Exported for the parser test.
 */
export async function readDeepseekStream(body: ReadableStream<Uint8Array>, onDelta: (textSoFar: string) => void): Promise<DeepseekReply> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finish: string | undefined;
  let model: string | undefined;
  let usage: DeepseekReply["usage"];
  const handle = (line: string) => {
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk: DeepseekChunk;
    try {
      chunk = JSON.parse(data) as DeepseekChunk;
    } catch {
      return;
    }
    model = chunk.model ?? model;
    if (chunk.usage) usage = chunk.usage;
    const c = chunk.choices?.[0];
    if (c?.finish_reason) finish = c.finish_reason;
    const piece = c?.delta?.content;
    if (piece) {
      text += piece;
      onDelta(text);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer) handle(buffer);
  return { model, choices: [{ finish_reason: finish, message: { content: text } }], usage };
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
      if (input.onDelta && !input.tools?.length && res.body) return readDeepseekStream(res.body, input.onDelta);
      return (await res.json()) as DeepseekReply;
    }, input.abortSignal);

    const choice = body.choices?.[0];
    const finish = choice?.finish_reason;
    const u0 = body.usage ?? {};
    const usage = {
      cacheHitTokens: u0.prompt_cache_hit_tokens ?? 0,
      cacheMissTokens: u0.prompt_cache_miss_tokens ?? 0,
      outputTokens: u0.completion_tokens ?? 0,
      reasoningTokens: u0.completion_tokens_details?.reasoning_tokens ?? null,
    };
    if (finish === "tool_calls" && input.tools?.length) {
      const m = choice?.message ?? {};
      const calls = (m.tool_calls ?? []).filter((c) => c.id && c.function?.name);
      if (calls.length === 0) throw new AiProviderError("bad_response", "DeepSeek asked for a tool but named none", this.name);
      return {
        provider: this.name,
        model,
        resolvedModel: body.model || model,
        text: (m.content ?? "").trim(),
        usage,
        finishReason: "tool_calls",
        toolCalls: calls.map((c) => ({ id: c.id!, name: c.function!.name!, argsJson: c.function?.arguments ?? "{}" })),
        assistantRaw: { role: "assistant", content: m.content ?? null, ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}), tool_calls: m.tool_calls },
        latencyMs: Date.now() - started,
      };
    }
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
