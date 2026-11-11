/**
 * Model ids by provider, kept apart from the provider classes so screens and services can
 * check a model without loading an SDK (Claude provider: anthropicProvider.ts).
 *
 * Claude models (Anthropic's model table, 2026-10): Opus 5.5 (the most capable of the three
 * and Anthropic's default), Sonnet 5.5 (half the price), Haiku 5.5 (the cheapest). Ids are
 * complete as written — no date suffix.
 */
import { DEEPSEEK_MODELS } from "./deepseekProvider";
import type { AiProviderName } from "./provider";

export const ANTHROPIC_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

/** Every model a workspace chat, revise or batch job may pick (W-2 picker, D-#1205 + Claude). */
export const WORKSPACE_MODELS: readonly string[] = [...DEEPSEEK_MODELS, ...ANTHROPIC_MODELS];

/** The provider that answers a model id; null for an id no picker offers. */
export function providerOfModel(model: string): AiProviderName | null {
  if ((DEEPSEEK_MODELS as readonly string[]).includes(model)) return "deepseek";
  if ((ANTHROPIC_MODELS as readonly string[]).includes(model)) return "anthropic";
  return null;
}

/** True when the model's provider has cheaper hours (DeepSeek); Claude costs the same at any time. */
export function hasOffPeak(model: string): boolean {
  return providerOfModel(model) === "deepseek";
}
