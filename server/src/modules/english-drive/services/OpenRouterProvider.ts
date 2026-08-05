/**
 * OpenRouter chat provider (D-#455) — the second LLM lane in the repo.
 *
 * The house pattern is the one MonthlyCommentService and BookAuthorChatService
 * set: an INTERFACE, a `…FromEnv()` that returns **null** when nothing is
 * configured, and a caller that falls back rather than fails. This file is that
 * pattern pointed at OpenRouter's OpenAI-shaped `/chat/completions`, so the
 * model is a deployment choice (`OPENROUTER_MODEL`) instead of a code change.
 *
 * Why a second provider at all: the English Drive block split is bulk document
 * work on a long input, not guardian-facing prose. It wants a cheap long-context
 * model and it must never block on quota — hence its own key and its own
 * fallback (the deterministic slice), separate from GEMINI_API_KEY.
 *
 * Model note (checked 2026-08-05): OpenRouter currently lists **no `:free`
 * DeepSeek variant**. The default below is the cheap paid DeepSeek Flash
 * (~$0.14/M in, $0.28/M out — a block split is a fraction of a paisa). Set
 * `OPENROUTER_MODEL=google/gemma-4-31b-it:free` (or any other `:free` id) for a
 * zero-cost deployment; nothing here depends on which model is chosen.
 *
 * NOTHING that reaches this provider is identity data — the input is curriculum
 * markdown authored in Claude Desktop. No student, guardian or staff record has
 * a path here (ADR-005 is untouched).
 */

/** The chat call the splitter needs — one system prompt, one user turn, text back. */
export interface ChatProvider {
  readonly model: string;
  complete(input: {
    system: string;
    user: string;
    /** Hard ceiling on the reply; the caller sizes it from the text it expects back. */
    maxOutputTokens?: number;
  }): Promise<string>;
}

export class OpenRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterError";
  }
}

/** Cheap, 1M-context, no `:free` DeepSeek exists — see the file header. */
export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";

export class OpenRouterProvider implements ChatProvider {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, model = DEFAULT_OPENROUTER_MODEL, baseUrl = "https://openrouter.ai/api/v1") {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async complete(input: { system: string; user: string; maxOutputTokens?: number }): Promise<string> {
    // Typed off `fetch` itself so this file needs no DOM lib in the server tsconfig.
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          // OpenRouter attribution headers — they identify the calling app on the
          // dashboard and are what a free-tier rate limit is counted against.
          "HTTP-Referer": process.env.PUBLIC_APP_URL || "https://scdhub.shafayet.me",
          "X-Title": "SCD Hub — English Drive",
        },
        body: JSON.stringify({
          model: this.model,
          // Low but not zero: the task is reformatting, and a deterministic reply
          // is what the item-preserving validator downstream wants to see.
          temperature: 0.2,
          max_tokens: input.maxOutputTokens ?? 4096,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
        }),
      });
    } catch (e) {
      // A network fault must read as a provider fault, not a crash — the caller
      // falls back to the deterministic slice on any throw from here.
      throw new OpenRouterError(`could not reach OpenRouter (${e instanceof Error ? e.message : "network error"})`);
    }

    if (!res.ok) {
      // 429 is the one a free-tier deployment will actually meet; name it so the
      // Principal sees why the sheets came back unpolished instead of a bare 429.
      if (res.status === 429) throw new OpenRouterError("OpenRouter rate limit reached (429)");
      if (res.status === 401 || res.status === 403) throw new OpenRouterError(`OpenRouter rejected the key (${res.status})`);
      throw new OpenRouterError(`OpenRouter returned ${res.status}`);
    }

    const body = (await res.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>;
      error?: { message?: string; code?: number | string };
    };
    // OpenRouter can answer 200 with an error envelope (upstream provider faults).
    if (body.error) throw new OpenRouterError(body.error.message ?? "OpenRouter returned an error");

    const choice = body.choices?.[0];
    // Anything but `stop` left a fragment. A truncated worksheet is worse than an
    // unpolished one — reject it here so the deterministic slice is what ships.
    if (choice?.finish_reason && choice.finish_reason !== "stop") {
      throw new OpenRouterError(`model stopped early (${choice.finish_reason}) — the reply was cut off`);
    }
    const text = (choice?.message?.content ?? "").trim();
    if (!text) throw new OpenRouterError("OpenRouter returned no text");
    return stripCodeFence(text);
  }
}

/**
 * Models like to wrap a whole markdown answer in a ```markdown fence. Unwrap only
 * when the fence is the ENTIRE reply — a fenced block inside a worksheet (the day
 * scripts use them for board work) must survive untouched.
 */
export function stripCodeFence(text: string): string {
  const m = /^```(?:markdown|md)?\s*\n([\s\S]*)\n```$/.exec(text.trim());
  return m ? m[1].trim() : text;
}

/** Null when no key is configured — every caller falls back, none of them fail. */
export function openRouterFromEnv(): ChatProvider | null {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  return new OpenRouterProvider(
    key,
    process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
    process.env.OPENROUTER_BASE_URL || undefined,
  );
}
