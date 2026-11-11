/**
 * The ONE seam every new AI feature calls a model through (AI-1, D-#1090,
 * docs/prd-ai-assist.md §3). A provider turns one `AiSendInput` into one `AiSendResult`;
 * the router (`aiRouter.ts`) picks the provider + model per feature and falls back once.
 *
 * Prompt order IS the cache: `stablePrefix` (rules, samples — no dates, ids or names) goes
 * first and must be byte-identical across calls, then `context` (stable within a session),
 * then `history`, then `variablePart` (the new input). Both providers keep that order.
 *
 * Errors are typed so callers can fail open (D-#1100) and the AI-2 ledger can record why a
 * call failed. Any finish other than a normal stop is an error: a cut-off reply must never
 * reach a teacher or a guardian (the CommentProvider lesson).
 */

/** "anthropic" = Claude (anthropicProvider.ts), added for the school's Claude API credit. */
export const AI_PROVIDERS = ["deepseek", "gemini", "anthropic"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

/** "off" = no thinking (cheapest); DeepSeek maps it to reasoning_effort "none". */
export type AiReasoning = "off" | "low" | "high";

export interface AiTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AiSendInput {
  /** Rules + examples. Byte-identical across calls, or the prompt cache is lost. */
  stablePrefix: string;
  /** Stable within one session (e.g. the chapter text); sent right after the prefix. */
  context?: string;
  history?: AiTurn[];
  /** The new input — the only part that changes every call. */
  variablePart: string;
  /** Ask for a JSON object; the reply is parsed into `json`. */
  json?: boolean;
  maxOutputTokens: number;
  reasoning: AiReasoning;
  /** Per-call deadline; the router falls back on a timeout. Default 30 s. */
  timeoutMs?: number;
  /**
   * Files sent WITH the new input (AI Workspace W-1, D-#1227: reading a picture or a scanned
   * PDF). Gemini only — DeepSeek's chat API takes text, so a call with files to DeepSeek is
   * refused before anything is sent. Never logged (the exchange log keeps the text only).
   */
  files?: AiInlineFile[];
  /**
   * Streaming (AI Workspace W-2): when set, a provider that can stream calls it with the
   * answer text so far as it arrives; the result is still the whole answer, and the ledger is
   * still written once by the router. A provider that cannot stream simply answers whole.
   */
  onDelta?: (textSoFar: string) => void;
  /** Stop button (W-2): aborting it ends the call with kind "stopped" (no fallback). */
  abortSignal?: AbortSignal;
}

export interface AiInlineFile {
  /** image/png, image/jpeg, image/webp, application/pdf … */
  mime: string;
  data: Buffer;
}

export interface AiTokenUsage {
  cacheHitTokens: number;
  cacheMissTokens: number;
  /**
   * The part of `cacheMissTokens` written INTO the cache (Claude bills a cache write at 1.25×
   * the input price). Absent for providers that do not charge for writing.
   */
  cacheWriteTokens?: number;
  /** Billed output tokens — INCLUDES any reasoning/thinking tokens. */
  outputTokens: number;
  /** The reasoning part of `outputTokens`; null when the provider does not report it. */
  reasoningTokens: number | null;
}

export interface AiSendResult {
  provider: AiProviderName;
  /** The model id that was asked for. */
  model: string;
  /** The model the provider says answered (an alias resolves to a dated model). */
  resolvedModel: string;
  text: string;
  json?: unknown;
  usage: AiTokenUsage;
  /** Always "stop" on a result — anything else was thrown as `truncated`. */
  finishReason: "stop";
  latencyMs: number;
}

export type AiErrorKind =
  | "not_configured" // no key for this provider
  | "auth" // the key was refused (400/401/403)
  | "busy" // 429 / 5xx — try later
  | "not_found" // the model does not exist (404)
  | "timeout"
  | "network"
  | "truncated" // finish reason other than a normal stop
  | "bad_response" // no text, or JSON asked for and not returned
  | "stopped"; // the person pressed Stop (W-2) — never retried on the fallback

export class AiProviderError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly provider: AiProviderName,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface AiProvider {
  readonly name: AiProviderName;
  send(input: AiSendInput, model: string): Promise<AiSendResult>;
}

/** `fetch`, injectable so the providers are tested without the network. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  /** The streamed body (W-2); only read when the call asked to stream. */
  body?: ReadableStream<Uint8Array> | null;
}>;

export const DEFAULT_TIMEOUT_MS = 30_000;

export function classifyStatus(status: number): AiErrorKind {
  if (status === 400 || status === 401 || status === 402 || status === 403) return "auth";
  if (status === 404) return "not_found";
  return "busy";
}

/** Models sometimes wrap JSON in a ```json fence even in JSON mode; accept that, nothing looser. */
export function parseJsonReply(text: string, provider: AiProviderName): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AiProviderError("bad_response", "the reply was not valid JSON", provider);
  }
}

/** Runs `fn` with an abort signal that fires after `ms`; a fired signal becomes `timeout`. */
export async function withDeadline<T>(ms: number, provider: AiProviderName, fn: (signal: AbortSignal) => Promise<T>, stop?: AbortSignal): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const onStop = () => ctl.abort();
  if (stop?.aborted) ctl.abort();
  stop?.addEventListener("abort", onStop);
  try {
    return await fn(ctl.signal);
  } catch (e) {
    if (stop?.aborted) throw new AiProviderError("stopped", "stopped by the person", provider);
    if (e instanceof AiProviderError) throw e;
    if (ctl.signal.aborted) throw new AiProviderError("timeout", `no reply within ${Math.round(ms / 1000)} s`, provider);
    throw new AiProviderError("network", "could not reach the AI service", provider);
  } finally {
    clearTimeout(timer);
    stop?.removeEventListener("abort", onStop);
  }
}
