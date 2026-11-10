/**
 * AI price table (AI-2, D-#1091) — USD per 1 MILLION tokens, used to stamp `costUsd` on
 * every `AiUsage` row. It is CONFIG, not truth: a wrong price only mis-states cost, it
 * never changes what a model is asked.
 *
 * ⚠ UNVERIFIED. DeepSeek's official pricing table did not render for a reader on
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
};

/**
 * Model context windows in tokens; input and output share the window (AI Workspace W-1).
 * DeepSeek's Models & Pricing page lists 1M context for both models (checked 2026-11-10).
 * Config, like the prices: a change is a one-line edit here.
 */
export const CONTEXT_WINDOW_TOKENS: Record<string, number> = {
  "deepseek-flash": 1_000_000,
  "deepseek-v4-pro": 1_000_000,
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
  const usd =
    ((usage.cacheHitTokens * price.cacheHit + usage.cacheMissTokens * price.cacheMiss + usage.outputTokens * price.output) / 1_000_000) * factor;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
