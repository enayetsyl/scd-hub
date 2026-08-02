/**
 * BookAuthorChatService — the in-app authoring path (SB-6, D-#408/#412).
 *
 * Built LAST on purpose. The Claude Desktop path already works and will stay the
 * workhorse for months, so this is a convenience with the highest cost and the largest
 * unknown — not a dependency of anything above it.
 *
 * ── ONE WRITE PATH ───────────────────────────────────────────────────────────
 * A turn that emits a patch does NOT write to the book. It hands the envelope to
 * `submitPatch`, the same function a Desktop upload goes through, and the same
 * validator decides. `source: IN_APP_CHAT` is recorded for the timeline and branched
 * on nowhere. That is what stops this becoming a second, softer way into a book.
 *
 * ── THE PROVIDER IS A SEAM, NOT A CHOICE ─────────────────────────────────────
 * Which model writes Bengali well enough for a taught-letter inventory is an empirical
 * question with a free objective scorer already in place — the validator's RED count.
 * So the model is configuration, and swapping it is an env change rather than a
 * rewrite. The seam follows `CommentProvider` (D-#399), including its hard-won
 * details: an alias resolves to a dated model and THAT is what a bad batch is traced
 * to, and a non-STOP finish is a truncated answer that must be rejected rather than
 * merged.
 */
import { Types } from "mongoose";
import { BookAuthorSession, type IBookAuthorSession } from "../models/BookAuthorSession";
import { SupportBook, type ISupportBook } from "../models/SupportBook";
import { SupportBookLesson } from "../models/SupportBookLesson";
import { activePolicySet } from "./PolicySetService";
import { assemblePrompt, PATCH_RESPONSE_SCHEMA, PROMPT_VERSION } from "./BookAuthorPromptService";
import { submitPatch, type PatchEnvelope } from "./MergeService";
import { writeBookEvent } from "../models/BookEvent";
import type { ValidatorReport } from "./validator/index";

export class AuthorChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorChatError";
  }
}

export const AUTHOR_CHAT_ERRORS_BN = {
  noProvider: "কোনো এলএলএম কনফিগার করা নেই",
  ceiling: "এই বইয়ের এ মাসের টোকেন সীমা শেষ হয়েছে",
  closed: "এই সেশনটি বন্ধ",
  noBook: "বই পাওয়া যায়নি",
} as const;

export interface ProviderReply {
  text: string;
  /** Present when the turn was asked for a patch and the model produced one. */
  patch?: Record<string, unknown> | null;
  resolvedModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  cached?: boolean;
}

export interface AuthorProvider {
  readonly model: string;
  /**
   * `policyPrefix` is passed separately so a provider that supports explicit caching
   * can mark it; one that does not simply concatenates. Keeping the split at the seam
   * means the caching decision belongs to the provider, not to the caller.
   */
  send(input: {
    policyPrefix: string;
    variablePart: string;
    expectPatch: boolean;
    schema: typeof PATCH_RESPONSE_SCHEMA;
  }): Promise<ProviderReply>;
}

/** Null when nothing is configured — the caller reports it rather than crashing. */
export function authorProviderFromEnv(): AuthorProvider | null {
  // Deliberately reads the SAME key the monthly report uses. Which provider suits
  // this task is unsettled (see the header); making it a config value is the point.
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  return new GeminiAuthorProvider(key, process.env.BOOK_AUTHOR_MODEL || undefined);
}

export class GeminiAuthorProvider implements AuthorProvider {
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model = "gemini-flash-latest") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async send(input: {
    policyPrefix: string;
    variablePart: string;
    expectPatch: boolean;
    schema: typeof PATCH_RESPONSE_SCHEMA;
  }): Promise<ProviderReply> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          // Prefix FIRST and in its own part, so a provider-side cache can match it.
          contents: [{ parts: [{ text: input.policyPrefix }, { text: input.variablePart }] }],
          generationConfig: {
            temperature: 0.3,
            // Must cover the model's REASONING as well as its answer — the monthly
            // report learned this the hard way at 400, where thinking consumed the
            // whole budget and every draft came back truncated.
            maxOutputTokens: 8192,
            ...(input.expectPatch
              ? { responseMimeType: "application/json", responseSchema: input.schema }
              : {}),
          },
        }),
      },
    );
    if (!res.ok) throw new AuthorChatError(`provider returned ${res.status}`);

    const body = (await res.json()) as {
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      modelVersion?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
    };
    const candidate = body.candidates?.[0];
    // Only STOP means a finished answer. A truncated patch is worse than no patch —
    // it would fail the validator in a way that looks like a content problem.
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      throw new AuthorChatError(`provider stopped early (${candidate.finishReason})`);
    }
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought) // reasoning is not the answer and is never shown
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) throw new AuthorChatError("provider returned no text");

    let patch: Record<string, unknown> | null = null;
    if (input.expectPatch) {
      try {
        patch = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Schema-constrained output that will not parse is a provider fault, not an
        // editorial outcome — say so rather than passing a string to the merge.
        throw new AuthorChatError("provider returned unparseable JSON for a patch turn");
      }
    }

    const u = body.usageMetadata ?? {};
    return {
      text,
      patch,
      resolvedModel: body.modelVersion,
      inputTokens: u.promptTokenCount,
      outputTokens: u.candidatesTokenCount,
      cached: (u.cachedContentTokenCount ?? 0) > 0,
    };
  }
}

/** Default monthly ceiling per book, in total tokens. Overridable per deployment. */
export const DEFAULT_MONTHLY_TOKEN_CEILING = 5_000_000;

function ceiling(): number {
  const v = Number(process.env.BOOK_AUTHOR_MONTHLY_TOKEN_CEILING);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MONTHLY_TOKEN_CEILING;
}

/** Tokens this book has spent in the current calendar month. */
export async function monthlySpend(bookId: string, now = new Date()): Promise<number> {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const sessions = await BookAuthorSession.find({ bookId, createdAt: { $gte: from } })
    .select("totalInputTokens totalOutputTokens")
    .lean();
  return sessions.reduce((n, s) => n + (s.totalInputTokens ?? 0) + (s.totalOutputTokens ?? 0), 0);
}

export interface TurnInput {
  bookId: string;
  lessonNo: number;
  authorId: Types.ObjectId;
  instruction: string;
  /** Ask for a schema-constrained patch rather than prose. */
  expectPatch?: boolean;
  provider?: AuthorProvider | null;
  /** Merge a returned patch immediately (the nine-step loop's step 8→9). */
  autoMerge?: boolean;
}

export interface TurnResult {
  sessionId: Types.ObjectId;
  text: string;
  patchEmitted: boolean;
  merged: boolean;
  report?: ValidatorReport;
  inputTokens: number;
  outputTokens: number;
  cached: boolean;
}

/**
 * One turn. Opens a session for the পাঠ if none is open.
 *
 * A patch turn goes straight to `submitPatch` when `autoMerge` is set — a RED comes
 * back as findings the author can feed to the next turn, exactly as a Desktop upload
 * would. The model never learns whether its output "shipped"; it learns what the
 * validator said.
 */
export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const provider = input.provider === undefined ? authorProviderFromEnv() : input.provider;
  if (!provider) throw new AuthorChatError(AUTHOR_CHAT_ERRORS_BN.noProvider);

  const spent = await monthlySpend(input.bookId);
  if (spent >= ceiling()) throw new AuthorChatError(AUTHOR_CHAT_ERRORS_BN.ceiling);

  const book = await SupportBook.findOne({ bookId: input.bookId }).lean<ISupportBook>();
  if (!book) throw new AuthorChatError(AUTHOR_CHAT_ERRORS_BN.noBook);

  const lesson = await SupportBookLesson.findOne({ bookId: input.bookId, lessonNo: input.lessonNo }).lean();
  const set = await activePolicySet(input.bookId);

  let session = await BookAuthorSession.findOne({
    bookId: input.bookId, lessonNo: input.lessonNo, state: "OPEN",
  });
  if (!session) {
    session = await BookAuthorSession.create({
      bookId: input.bookId, lessonNo: input.lessonNo, authorId: input.authorId,
      state: "OPEN", turns: [], totalInputTokens: 0, totalOutputTokens: 0,
    });
  }

  const prompt = assemblePrompt({
    set,
    book,
    lesson: lesson as never,
    instruction: input.instruction,
    history: session.turns.map((t) => ({ role: t.role, text: t.text })),
  });

  const reply = await provider.send({
    policyPrefix: prompt.policyPrefix,
    variablePart: prompt.variablePart,
    expectPatch: !!input.expectPatch,
    schema: PATCH_RESPONSE_SCHEMA,
  });

  session.turns.push({ role: "user", text: input.instruction, createdAt: new Date() });
  session.turns.push({
    role: "model",
    text: reply.text,
    emittedPatch: reply.patch ?? null,
    model: provider.model,
    resolvedModel: reply.resolvedModel,
    policySetHash: set.hash,
    promptVersion: PROMPT_VERSION,
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
    cached: reply.cached,
    createdAt: new Date(),
  });
  session.totalInputTokens += reply.inputTokens ?? 0;
  session.totalOutputTokens += reply.outputTokens ?? 0;
  await session.save();

  let merged = false;
  let report: ValidatorReport | undefined;

  if (reply.patch && input.autoMerge) {
    const r = await submitPatch({
      patch: reply.patch as unknown as PatchEnvelope,
      source: "IN_APP_CHAT",
      actorId: input.authorId,
      chatSessionId: session._id,
    });
    merged = r.merged;
    report = r.report;
    if (merged) {
      session.state = "MERGED";
      session.mergedPatchId = r.patchId;
      await session.save();
    }
  }

  await writeBookEvent({
    bookId: input.bookId,
    lessonNo: input.lessonNo,
    kind: reply.patch ? (merged ? "PATCH_MERGED" : "PATCH_SUBMITTED") : "LESSON_STATE_CHANGED",
    actorId: input.authorId,
    summary: reply.patch
      ? `in-app chat emitted a patch for পাঠ ${input.lessonNo}${merged ? " (merged)" : ""}`
      : `in-app chat turn on পাঠ ${input.lessonNo}`,
    refs: { policySetHash: set.hash },
  });

  return {
    sessionId: session._id,
    text: reply.text,
    patchEmitted: !!reply.patch,
    merged,
    report,
    inputTokens: reply.inputTokens ?? 0,
    outputTokens: reply.outputTokens ?? 0,
    cached: !!reply.cached,
  };
}
