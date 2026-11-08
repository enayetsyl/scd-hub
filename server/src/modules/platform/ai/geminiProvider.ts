/**
 * Gemini on the shared AI seam (D-#1090) — the fallback for DeepSeek, and the provider a
 * feature can be pointed at instead. Same REST endpoint the existing Gemini callers use
 * (no SDK). Order: systemInstruction = stablePrefix (+ context), then history, then the
 * new input.
 *
 * Gemini's Flash models think, and on some versions thinking cannot be switched off
 * (`thinkingBudget: 0` is refused — MonthlyCommentService). Thinking tokens come out of
 * `maxOutputTokens`, so the budget sent is the caller's answer budget PLUS an allowance for
 * the thinking; otherwise the answer is cut off (the 382-of-400-tokens incident).
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

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const THINKING_ALLOWANCE: Record<AiReasoning, number> = { off: 2048, low: 4096, high: 8192 };

interface GeminiReply {
  modelVersion?: string;
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

export function geminiBody(input: AiSendInput): Record<string, unknown> {
  const system = input.context ? `${input.stablePrefix}\n\n${input.context}` : input.stablePrefix;
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [
      ...(input.history ?? []).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
      { role: "user", parts: [{ text: input.variablePart }] },
    ],
    generationConfig: {
      maxOutputTokens: input.maxOutputTokens + THINKING_ALLOWANCE[input.reasoning],
      ...(input.json ? { responseMimeType: "application/json" } : {}),
    },
  };
}

export class GeminiProvider implements AiProvider {
  readonly name = "gemini" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly baseUrl = GEMINI_BASE_URL,
  ) {}

  async send(input: AiSendInput, model: string): Promise<AiSendResult> {
    const started = Date.now();
    const body = await withDeadline(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, this.name, async (signal) => {
      const res = await this.fetchImpl(`${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(geminiBody(input)),
        signal,
      });
      if (!res.ok) throw new AiProviderError(classifyStatus(res.status), `Gemini returned ${res.status}`, this.name, res.status);
      return (await res.json()) as GeminiReply;
    });

    const cand = body.candidates?.[0];
    if (cand?.finishReason !== "STOP") {
      throw new AiProviderError("truncated", `Gemini stopped early (${cand?.finishReason ?? "no finish reason"})`, this.name);
    }
    // Thinking parts are the model's reasoning, never the answer.
    const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
    if (!text) throw new AiProviderError("bad_response", "Gemini returned no text", this.name);

    const u = body.usageMetadata ?? {};
    const cached = u.cachedContentTokenCount ?? 0;
    return {
      provider: this.name,
      model,
      resolvedModel: body.modelVersion || model,
      text,
      ...(input.json ? { json: parseJsonReply(text, this.name) } : {}),
      usage: {
        cacheHitTokens: cached,
        cacheMissTokens: Math.max(0, (u.promptTokenCount ?? 0) - cached),
        // Gemini counts thinking apart from the answer but bills both as output; DeepSeek's
        // completion_tokens already includes reasoning. One meaning on the ledger: billed output.
        outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        reasoningTokens: u.thoughtsTokenCount ?? null,
      },
      finishReason: "stop",
      latencyMs: Date.now() - started,
    };
  }
}
