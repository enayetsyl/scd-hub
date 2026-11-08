/**
 * meteredGeminiFetch (AI-2, D-#1124) — how the four OLDER Gemini features are metered:
 * monthly comments, the support-book author, the observation rota and voice tasks.
 *
 * They are not moved onto `aiSend`: they need things the seam does not have (audio input,
 * a response schema, the voice model chain) and they are not capped (they are not part of
 * the owner's AI budget, D-#1103). What they must not be is UNMETERED (D-#1091), so each
 * one's single Gemini fetch goes through here instead of `fetch`. It behaves exactly like
 * `fetch` — same Response, same throw — and on the side writes one `AiUsage` row from
 * Gemini's `usageMetadata`. The ledger can never break the call: every metering step is
 * try/caught, and nothing is written when the database is not connected (DB-free tests).
 */
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import { recordAiUsage } from "../services/AiUsageService";
import { costUsd } from "./aiPrices";
import { classifyStatus } from "./provider";

export type LegacyAiFeature = "monthly_comment" | "book_author" | "observation_rota" | "voice_task";

interface GeminiUsageReply {
  modelVersion?: string;
  candidates?: Array<{ finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

export interface MeterContext {
  userId?: string | null;
  role?: string | null;
  refType?: string | null;
  refId?: string | null;
}

const connected = () => mongoose.connection.readyState === 1;

export async function meteredGeminiFetch(
  feature: LegacyAiFeature,
  model: string,
  url: string,
  init: RequestInit,
  ctx: MeterContext = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const at = new Date();
  const started = Date.now();
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    if (connected()) {
      void recordAiUsage([{ at, ...ctx, feature, callId: randomUUID(), attempt: 1, provider: "gemini", model, latencyMs: Date.now() - started, outcome: "error", errorKind: "network" }]);
    }
    throw err;
  }
  if (!connected()) return res;
  try {
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      void recordAiUsage([{ at, ...ctx, feature, callId: randomUUID(), attempt: 1, provider: "gemini", model, latencyMs, outcome: "error", errorKind: classifyStatus(res.status) }]);
      return res;
    }
    const body = (await res.clone().json()) as GeminiUsageReply;
    const u = body.usageMetadata ?? {};
    const cached = u.cachedContentTokenCount ?? 0;
    const usage = {
      cacheHitTokens: cached,
      cacheMissTokens: Math.max(0, (u.promptTokenCount ?? 0) - cached),
      outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      reasoningTokens: u.thoughtsTokenCount ?? null,
    };
    const finish = body.candidates?.[0]?.finishReason;
    void recordAiUsage([
      {
        at,
        ...ctx,
        feature,
        callId: randomUUID(),
        attempt: 1,
        provider: "gemini",
        model,
        resolvedModel: body.modelVersion ?? null,
        ...usage,
        // Billed whether or not the reply was usable.
        costUsd: costUsd("gemini", model, usage, at),
        latencyMs,
        outcome: finish && finish !== "STOP" ? "error" : "ok",
        errorKind: finish && finish !== "STOP" ? "truncated" : null,
      },
    ]);
  } catch (err) {
    console.error(`[ai-usage] could not meter a ${feature} call (the call is unaffected):`, err);
  }
  return res;
}
