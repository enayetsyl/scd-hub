/**
 * aiSend — the single entry point for every NEW AI feature (AI-1 D-#1120, metered by AI-2).
 *
 *   1. read the feature's route (switch, provider + model, fallback) from AiSettingService;
 *   2. a switched-off feature throws `AiFeatureOffError` before anything is sent;
 *   3. the caps are checked BEFORE sending (D-#1092) — a refusal is `AiCapError` and one
 *      `capped` ledger row; callers fail open (D-#1100): a teacher can always save unchecked;
 *   4. try the chosen provider; on ANY failure try the other provider ONCE (if fallback is
 *      on and it has a key);
 *   5. write one `AiUsage` row per attempt, with its cost (D-#1091) — this is the ONE place
 *      the new features are metered, so no caller can skip it — then check the budget
 *      alert in the background;
 *   6. log the de-identified request and the reply (`AiExchange`, D-#1179) for the
 *      Principal's study of the model — the input is already de-identified by the caller.
 */
import { randomUUID } from "crypto";
import { aiRouteFor } from "../services/AiSettingService";
import { alertIfBudget, assertWithinCaps, recordAiUsage, type AiUsageRowInput, type CapContext } from "../services/AiUsageService";
import { recordAiExchange, type AiExchangeInput } from "../services/AiExchangeService";
import { costUsd } from "./aiPrices";
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
  /** Groups this call's ledger rows. */
  callId: string;
}

/** Who asked, and about what — stamped on every ledger row. No text, ever. */
export interface AiCallContext {
  /** Absent for a scheduler / system call. */
  userId?: string | null;
  role?: string | null;
  /** The record the call is about (e.g. "StudentComment" + its id). */
  refType?: string | null;
  refId?: string | null;
  /** The assistant session, for the per-session cap; stored as refId when no refId is given. */
  sessionId?: string | null;
  /** The AiPolicy version the prompt was built from (AI-3). */
  policyHash?: string | null;
}

export type ProviderFactory = (provider: AiProviderName, key: string) => AiProvider;

export interface AiLedger {
  assertWithinCaps(ctx: CapContext): Promise<void>;
  record(rows: AiUsageRowInput[]): Promise<void>;
  /** Runs after the call, not awaited; must never throw. */
  afterCall(feature: string): Promise<unknown>;
  /** The request / reply log (D-#1179); must never throw. Absent = not logged. */
  exchange?(x: AiExchangeInput): Promise<void>;
}

export const defaultLedger: AiLedger = {
  assertWithinCaps,
  record: recordAiUsage,
  afterCall: (feature) => alertIfBudget(feature),
  exchange: recordAiExchange,
};

export const defaultProviderFactory: ProviderFactory = (provider, key) =>
  provider === "deepseek" ? new DeepseekProvider(key) : new GeminiProvider(key);

export async function aiSend(
  feature: string,
  input: AiSendInput,
  ctx: AiCallContext,
  deps: { makeProvider?: ProviderFactory; route?: typeof aiRouteFor; ledger?: AiLedger; now?: () => Date } = {},
): Promise<AiSendOutcome> {
  const route = await (deps.route ?? aiRouteFor)(feature);
  if (!route.enabled) throw new AiFeatureOffError(feature);
  const make = deps.makeProvider ?? defaultProviderFactory;
  const ledger = deps.ledger ?? defaultLedger;
  const now = deps.now ?? (() => new Date());
  const callId = randomUUID();
  const refId = ctx.refId ?? ctx.sessionId ?? null;

  await ledger.assertWithinCaps({
    feature,
    userId: ctx.userId,
    role: ctx.role,
    sessionId: ctx.sessionId,
    callId,
    provider: route.primary.provider,
    model: route.primary.model,
    refType: ctx.refType,
    refId,
    at: now(),
  });

  const plan: Array<{ provider: AiProviderName; model: string; key: string | null; fallback: boolean }> = [
    { ...route.primary, fallback: false },
    ...(route.fallback ? [{ ...route.fallback, fallback: true }] : []),
  ];

  const attempts: AiAttempt[] = [];
  const rows: AiUsageRowInput[] = [];
  const row = (step: (typeof plan)[number], attempt: AiAttempt, at: Date): AiUsageRowInput => ({
    at,
    userId: ctx.userId,
    role: ctx.role,
    feature,
    callId,
    attempt: attempts.length,
    refType: ctx.refType,
    refId,
    policyHash: ctx.policyHash,
    provider: step.provider,
    model: step.model,
    resolvedModel: attempt.result?.resolvedModel ?? null,
    cacheHitTokens: attempt.result?.usage.cacheHitTokens ?? 0,
    cacheMissTokens: attempt.result?.usage.cacheMissTokens ?? 0,
    outputTokens: attempt.result?.usage.outputTokens ?? 0,
    reasoningTokens: attempt.result?.usage.reasoningTokens ?? null,
    costUsd: attempt.result ? costUsd(step.provider, step.model, attempt.result.usage, at) : 0,
    latencyMs: attempt.latencyMs,
    outcome: attempt.outcome === "error" ? "error" : step.fallback ? "fallback" : "ok",
    errorKind: attempt.errorKind ?? null,
  });

  let lastError: AiProviderError | null = null;
  let answer: AiSendResult | null = null;
  for (const step of plan) {
    const started = now();
    let attempt: AiAttempt;
    if (!step.key) {
      lastError = new AiProviderError("not_configured", `no key for ${step.provider}`, step.provider);
      attempt = { provider: step.provider, model: step.model, outcome: "error", errorKind: "not_configured", fallback: step.fallback, latencyMs: 0 };
    } else {
      try {
        const result = await make(step.provider, step.key).send(input, step.model);
        attempt = { provider: step.provider, model: step.model, outcome: "ok", fallback: step.fallback, latencyMs: result.latencyMs, result };
        answer = result;
      } catch (e) {
        const err = e instanceof AiProviderError ? e : new AiProviderError("network", (e as Error)?.message ?? "unknown error", step.provider);
        lastError = err;
        attempt = { provider: step.provider, model: step.model, outcome: "error", errorKind: err.kind, fallback: step.fallback, latencyMs: now().getTime() - started.getTime() };
      }
    }
    attempts.push(attempt);
    // A not_configured step sent nothing, so it costs nothing and is not a provider call.
    if (attempt.errorKind !== "not_configured") rows.push(row(step, attempt, started));
    if (answer) break;
  }

  await ledger.record(rows);
  void ledger.afterCall(feature).catch(() => undefined);
  if (rows.length > 0 && ledger.exchange) {
    await ledger.exchange({
      at: rows[0].at ?? now(),
      feature,
      callId,
      userId: ctx.userId,
      role: ctx.role,
      refType: ctx.refType,
      refId,
      policyHash: ctx.policyHash,
      stablePrefix: input.stablePrefix,
      context: input.context ?? null,
      history: (input.history ?? []).map((h) => ({ role: h.role, text: h.text })),
      request: input.variablePart,
      reply: answer?.text ?? "",
      attempts: rows.map((r) => ({
        provider: r.provider,
        modelName: r.resolvedModel || r.model,
        outcome: r.outcome === "error" ? "error" : "ok",
        ...(r.errorKind ? { errorKind: r.errorKind } : {}),
        fallback: (r.attempt ?? 1) > 1,
        latencyMs: r.latencyMs ?? 0,
        costUsd: r.costUsd ?? 0,
      })),
    }).catch(() => undefined);
  }

  if (answer) return { result: answer, attempts, callId };
  throw Object.assign(lastError ?? new AiProviderError("not_configured", "no provider", route.primary.provider), { attempts, callId });
}
