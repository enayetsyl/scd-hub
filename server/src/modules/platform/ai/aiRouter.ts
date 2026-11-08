/**
 * aiSend — the single entry point for every NEW AI feature (AI-1, D-#1090).
 *
 *   1. read the feature's route (switch, provider + model, fallback) from AiSettingService;
 *   2. a switched-off feature throws `AiFeatureOffError` before anything is sent — callers
 *      fail open (D-#1100): the teacher can always save without a check;
 *   3. try the chosen provider; on ANY failure try the other provider ONCE (if fallback is
 *      on and it has a key);
 *   4. return the result plus every attempt.
 *
 * `attempts` exists for AI-2: the usage ledger (D-#1091) is written here, in this one
 * place, so no caller can skip it. Until AI-2 lands, nothing is recorded.
 */
import { aiRouteFor } from "../services/AiSettingService";
import { DeepseekProvider } from "./deepseekProvider";
import { GeminiProvider } from "./geminiProvider";
import {
  AiProviderError,
  type AiErrorKind,
  type AiProvider,
  type AiProviderName,
  type AiSendInput,
  type AiSendResult,
} from "./provider";

export class AiFeatureOffError extends Error {
  constructor(readonly feature: string) {
    super("এই এআই সুবিধাটি এখন বন্ধ আছে");
    this.name = "AiFeatureOffError";
  }
}

export interface AiAttempt {
  provider: AiProviderName;
  model: string;
  outcome: "ok" | "error";
  errorKind?: AiErrorKind;
  /** True for the second, fallback attempt. */
  fallback: boolean;
  latencyMs: number;
  result?: AiSendResult;
}

export interface AiSendOutcome {
  result: AiSendResult;
  attempts: AiAttempt[];
}

export type ProviderFactory = (provider: AiProviderName, key: string) => AiProvider;

export const defaultProviderFactory: ProviderFactory = (provider, key) =>
  provider === "deepseek" ? new DeepseekProvider(key) : new GeminiProvider(key);

export async function aiSend(
  feature: string,
  input: AiSendInput,
  deps: { makeProvider?: ProviderFactory; route?: typeof aiRouteFor } = {},
): Promise<AiSendOutcome> {
  const route = await (deps.route ?? aiRouteFor)(feature);
  if (!route.enabled) throw new AiFeatureOffError(feature);
  const make = deps.makeProvider ?? defaultProviderFactory;

  const plan: Array<{ provider: AiProviderName; model: string; key: string | null; fallback: boolean }> = [
    { ...route.primary, fallback: false },
    ...(route.fallback ? [{ ...route.fallback, fallback: true }] : []),
  ];

  const attempts: AiAttempt[] = [];
  let lastError: AiProviderError | null = null;
  for (const step of plan) {
    const started = Date.now();
    if (!step.key) {
      lastError = new AiProviderError("not_configured", `no key for ${step.provider}`, step.provider);
      attempts.push({ provider: step.provider, model: step.model, outcome: "error", errorKind: "not_configured", fallback: step.fallback, latencyMs: 0 });
      continue;
    }
    try {
      const result = await make(step.provider, step.key).send(input, step.model);
      attempts.push({ provider: step.provider, model: step.model, outcome: "ok", fallback: step.fallback, latencyMs: result.latencyMs, result });
      return { result, attempts };
    } catch (e) {
      const err = e instanceof AiProviderError ? e : new AiProviderError("network", (e as Error)?.message ?? "unknown error", step.provider);
      lastError = err;
      attempts.push({ provider: step.provider, model: step.model, outcome: "error", errorKind: err.kind, fallback: step.fallback, latencyMs: Date.now() - started });
    }
  }
  throw Object.assign(lastError ?? new AiProviderError("not_configured", "no provider", route.primary.provider), { attempts });
}
