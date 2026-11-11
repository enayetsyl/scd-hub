/**
 * AI price table (AI-2, D-#1091) — USD per 1 MILLION tokens, used to stamp `costUsd` on
 * every `AiUsage` row. It is CONFIG, not truth: a wrong price only mis-states cost, it
 * never changes what a model is asked.
 *
 * Claude prices are Anthropic's published first-party rates (see the `anthropic` row).
 *
 * ⚠ UNVERIFIED (DeepSeek / Gemini). DeepSeek's official pricing table did not render for a reader on
 * 2026-11-08 and secondary sources disagree (PRD P10, D-#1120). These figures follow the
 * PRD's time-of-day model (off-peak = half price; peak = weekdays 01:00–04:00 and
 * 06:00–10:00 UTC) with the most recent secondary figures. The owner checks them against
 * the DeepSeek console and Google AI Studio billing, and corrects this file in a PR; the
 * monthly reconciliation script (`server/scripts/ai-usage-month.ts`) shows the gap.
 */
import type { AiProviderName, AiTokenUsage } from "./provider";

export interface ModelPrice {
  /** Input tokens served from the provider's prompt cache. */
  cacheHit: number;
  /** Input tokens not in the cache. */
  cacheMiss: number;
  /** Output tokens — reasoning tokens are billed as output and are already inside it. */
  output: number;
  /** Input tokens written into the cache (Claude: 1.25× input for the 5-minute TTL); absent = cacheMiss. */
  cacheWrite?: number;
}

interface ProviderPrices {
  /** Peak prices per model. */
  models: Record<string, ModelPrice>;
  /** The model whose price is used for an id not listed (an alias that moved). */
  fallbackModel: string;
  /** Off-peak multiplier (1 = no time-of-day pricing). */
  offPeakFactor: number;
  /** UTC hour windows [from, to) on weekdays (Mon–Fri) that are PEAK; other times off-peak. */
  peakUtcHours: Array<[number, number]>;
}

export const AI_PRICES: Record<AiProviderName, ProviderPrices> = {
  deepseek: {
    models: {
      "deepseek-flash": { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
      "deepseek-v4-pro": { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
    },
    fallbackModel: "deepseek-flash",
    offPeakFactor: 0.5,
    peakUtcHours: [
      [1, 4],
      [6, 10],
    ],
  },
  gemini: {
    models: {
      "gemini-flash-latest": { cacheHit: 0.075, cacheMiss: 0.3, output: 2.5 },
      "gemini-flash-lite-latest": { cacheHit: 0.025, cacheMiss: 0.1, output: 0.4 },
    },
    fallbackModel: "gemini-flash-latest",
    offPeakFactor: 1,
    peakUtcHours: [],
  },
  // Claude (Anthropic first-party API prices, cached model table of 2026-10): cache reads
  // $0.20 on Opus 5.5 / Sonnet 5.5 and 0.1× input on Haiku 5.5; a 5-minute cache write is
  // 1.25× input. Haiku 5.5's price doubles above 100K prompt tokens ($0.50 / $2.50) — not
  // modelled here. No time-of-day pricing.
  anthropic: {
    models: {
      "claude-opus-5-5": { cacheHit: 0.2, cacheMiss: 4, output: 20, cacheWrite: 5 },
      "claude-sonnet-5-5": { cacheHit: 0.2, cacheMiss: 2, output: 10, cacheWrite: 2.5 },
      "claude-haiku-5-5": { cacheHit: 0.01, cacheMiss: 0.1, output: 0.5, cacheWrite: 0.125 },
    },
    fallbackModel: "claude-opus-5-5",
    offPeakFactor: 1,
    peakUtcHours: [],
  },
};

/**
 * Model context windows in tokens; input and output share the window (AI Workspace W-1).
 * DeepSeek's Models & Pricing page lists 1M context for both models (checked 2026-11-10).
 * Config, like the prices: a change is a one-line edit here.
 */
export const CONTEXT_WINDOW_TOKENS: Record<string, number> = {
  "deepseek-flash": 1_000_000,
  "deepseek-v4-pro": 1_000_000,
  // Claude: 1M context on all three (Anthropic's model table).
  "claude-opus-5-5": 1_000_000,
  "claude-sonnet-5-5": 1_000_000,
  "claude-haiku-5-5": 1_000_000,
};

/** AI Workspace context budget (PRD §3): warn above, refuse above (instructions + pinned files). */
export const WORKSPACE_PREFIX_WARN_TOKENS = 150_000;
export const WORKSPACE_PREFIX_MAX_TOKENS = 400_000;

/** True when `at` falls in the provider's peak window (weekdays, UTC). */
export function isPeak(provider: AiProviderName, at: Date): boolean {
  const p = AI_PRICES[provider];
  if (p.offPeakFactor === 1) return true;
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = at.getUTCHours();
  return p.peakUtcHours.some(([from, to]) => h >= from && h < to);
}

export interface PriceClock {
  peak: boolean;
  /** When the price next changes (the start of the next off-peak or peak hour block). */
  changesAt: Date;
  /** 1 at peak, the off-peak factor otherwise. */
  factor: number;
}

/**
 * The chat's price clock (W-2, D-#1205): peak or off-peak now, and when that changes. Read
 * from the same `peakUtcHours` the ledger prices by — no second copy of the windows.
 */
export function priceClock(provider: AiProviderName, now: Date): PriceClock {
  const peak = isPeak(provider, now);
  const t = new Date(now);
  t.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 24 * 8; i++) {
    t.setUTCHours(t.getUTCHours() + 1);
    if (isPeak(provider, t) !== peak) return { peak, changesAt: new Date(t), factor: peak ? 1 : AI_PRICES[provider].offPeakFactor };
  }
  return { peak, changesAt: new Date(t), factor: peak ? 1 : AI_PRICES[provider].offPeakFactor };
}

/** The next moment that is off-peak: `now` itself when it already is. */
export function nextOffPeak(provider: AiProviderName, now: Date): Date {
  return isPeak(provider, now) ? priceClock(provider, now).changesAt : now;
}

/** The price row for a model id; a dated or unknown id uses the closest listed one. */
export function priceOf(provider: AiProviderName, model: string): ModelPrice {
  const p = AI_PRICES[provider];
  if (p.models[model]) return p.models[model];
  const prefix = Object.keys(p.models).find((m) => model.startsWith(m));
  if (prefix) return p.models[prefix];
  if (provider === "gemini" && model.includes("lite")) return p.models["gemini-flash-lite-latest"];
  return p.models[p.fallbackModel];
}

/** USD for one call, rounded to 1/1,000,000 of a dollar. */
export function costUsd(provider: AiProviderName, model: string, usage: AiTokenUsage, at: Date): number {
  const price = priceOf(provider, model);
  const factor = isPeak(provider, at) ? 1 : AI_PRICES[provider].offPeakFactor;
  // Cache writes are inside cacheMissTokens; they pay the write premium on top of the miss price.
  const writePremium = (usage.cacheWriteTokens ?? 0) * Math.max(0, (price.cacheWrite ?? price.cacheMiss) - price.cacheMiss);
  const usd =
    ((usage.cacheHitTokens * price.cacheHit + usage.cacheMissTokens * price.cacheMiss + writePremium + usage.outputTokens * price.output) / 1_000_000) * factor;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
