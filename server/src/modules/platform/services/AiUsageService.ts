/**
 * AiUsageService (AI-2) — the AI usage ledger, the caps and the budget alert.
 *
 *   recordAiUsage   writes `AiUsage` rows (D-#1091). Only the router (`ai/aiRouter.ts`) and
 *                   the metered Gemini fetch (`ai/meteredFetch.ts`) call it, so no AI call
 *                   in the app goes unmetered.
 *   assertWithinCaps refuses BEFORE anything is sent (D-#1092): per person per Dhaka day,
 *                   per assistant session, per feature per Dhaka month, and the school-wide
 *                   monthly budget across the capped features. A refusal is `AiCapError`
 *                   (a Bangla sentence; callers fail open, D-#1100) plus one `capped` row.
 *   alertIfBudget   tells the Principal (every holder of `system_health:ai_key`) when a
 *                   monthly cap first reaches the alert percent (default 70 %) and again
 *                   at 100 %, once per cap per month (D-#1103).
 *
 * Days and months are Dhaka days and months (UTC+6, no daylight saving).
 */
import { Types } from "mongoose";
import { AiUsage, type AiUsageOutcome } from "../models/AiUsage";
import { aiBudgetConfig, aiFeatureConfig, CAPPED_AI_FEATURES, AI_FEATURES } from "./AiSettingService";
import { holdersOf } from "../../access-control/services/holders";
import { emit } from "../../notifications/services/NotificationService";

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

export class AiCapError extends Error {
  constructor(
    message: string,
    readonly cap: "daily" | "session" | "monthly" | "budget",
  ) {
    super(message);
    this.name = "AiCapError";
  }
}

/** UTC instant of 00:00 Dhaka on the Dhaka day containing `at`. */
export function dhakaDayStart(at: Date): Date {
  const local = new Date(at.getTime() + DHAKA_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - DHAKA_OFFSET_MS);
}

/** UTC instant of 00:00 Dhaka on the 1st of the Dhaka month containing `at`. */
export function dhakaMonthStart(at: Date): Date {
  const local = new Date(at.getTime() + DHAKA_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - DHAKA_OFFSET_MS);
}

/** "2026-11" for the Dhaka month containing `at`. */
export function dhakaMonthKey(at: Date): string {
  const local = new Date(at.getTime() + DHAKA_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function schoolBranch(): string {
  return (process.env.SCHOOL_BRANCH || "sylhet").trim().toLowerCase();
}

export interface AiUsageRowInput {
  at?: Date;
  userId?: string | null;
  role?: string | null;
  feature: string;
  callId: string;
  attempt: number;
  refType?: string | null;
  refId?: string | null;
  provider: "deepseek" | "gemini";
  model: string;
  resolvedModel?: string | null;
  policyHash?: string | null;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number | null;
  costUsd?: number;
  latencyMs?: number;
  outcome: AiUsageOutcome;
  errorKind?: string | null;
}

/** Writes the rows. Never throws: a ledger failure is logged, never shown to a teacher. */
export async function recordAiUsage(rows: AiUsageRowInput[]): Promise<void> {
  if (rows.length === 0) return;
  const branch = schoolBranch();
  try {
    await AiUsage.insertMany(
      rows.map((r) => ({
        at: r.at ?? new Date(),
        userId: r.userId && Types.ObjectId.isValid(r.userId) ? new Types.ObjectId(r.userId) : undefined,
        role: r.role ?? undefined,
        branch,
        feature: r.feature,
        callId: r.callId,
        attempt: r.attempt,
        refType: r.refType ?? undefined,
        refId: r.refId ?? undefined,
        provider: r.provider,
        modelName: r.model,
        resolvedModel: r.resolvedModel ?? undefined,
        policyHash: r.policyHash ?? undefined,
        cacheHitTokens: r.cacheHitTokens ?? 0,
        cacheMissTokens: r.cacheMissTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        reasoningTokens: r.reasoningTokens ?? undefined,
        costUsd: r.costUsd ?? 0,
        latencyMs: r.latencyMs ?? 0,
        outcome: r.outcome,
        errorKind: r.errorKind ?? undefined,
      })),
      { ordered: false },
    );
  } catch (err) {
    console.error("[ai-usage] could not record usage (the call itself is unaffected):", err);
  }
}

async function spentSince(features: readonly string[], since: Date): Promise<number> {
  const agg = await AiUsage.aggregate<{ usd: number }>([
    { $match: { feature: { $in: [...features] }, at: { $gte: since } } },
    { $group: { _id: null, usd: { $sum: "$costUsd" } } },
  ]);
  return agg[0]?.usd ?? 0;
}

/** Calls one person made for a feature since `since` (first attempts only; refusals do not count). */
async function callsSince(match: Record<string, unknown>, since: Date): Promise<number> {
  return AiUsage.countDocuments({ ...match, attempt: 1, outcome: { $ne: "capped" }, at: { $gte: since } });
}

export interface CapContext {
  feature: string;
  userId?: string | null;
  role?: string | null;
  /** The assistant session, for the per-session cap. */
  sessionId?: string | null;
  callId: string;
  provider: "deepseek" | "gemini";
  model: string;
  refType?: string | null;
  refId?: string | null;
  at?: Date;
}

const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Refuses (and records one `capped` row) when any cap is reached. Order: the person's day,
 * the session, the feature's month, the school's month.
 */
export async function assertWithinCaps(ctx: CapContext): Promise<void> {
  if (!CAPPED_AI_FEATURES.includes(ctx.feature)) return;
  const at = ctx.at ?? new Date();
  const cfg = await aiFeatureConfig(ctx.feature);
  const label = AI_FEATURES.find((f) => f.key === ctx.feature)?.bn ?? ctx.feature;
  let refusal: AiCapError | null = null;

  if (ctx.userId && cfg.dailyPerUser >= 0) {
    const used = await callsSince({ feature: ctx.feature, userId: new Types.ObjectId(ctx.userId) }, dhakaDayStart(at));
    if (used >= cfg.dailyPerUser) refusal = new AiCapError(`আজ ${label}-এর সীমা (${cfg.dailyPerUser} বার) শেষ — কাল আবার পারবেন। এখনকার লেখাটি যাচাই ছাড়াই পাঠাতে পারেন।`, "daily");
  }
  if (!refusal && ctx.sessionId && cfg.perSessionTurns !== null) {
    const used = await callsSince({ feature: ctx.feature, refId: ctx.sessionId }, new Date(0));
    if (used >= cfg.perSessionTurns) refusal = new AiCapError(`এই আলাপে ${cfg.perSessionTurns}টি প্রশ্নের সীমা শেষ — নতুন আলাপ শুরু করুন।`, "session");
  }
  if (!refusal) {
    const spent = await spentSince([ctx.feature], dhakaMonthStart(at));
    if (spent >= cfg.monthlyUsd) refusal = new AiCapError(`এ মাসে ${label}-এর খরচের সীমা (${fmtUsd(cfg.monthlyUsd)}) শেষ — প্রধান শিক্ষক সীমা বাড়ালে আবার চলবে।`, "monthly");
  }
  if (!refusal) {
    const budget = await aiBudgetConfig();
    const spent = await spentSince(CAPPED_AI_FEATURES, dhakaMonthStart(at));
    if (spent >= budget.monthlyUsd) refusal = new AiCapError(`এ মাসে এআই-এর মোট খরচের সীমা (${fmtUsd(budget.monthlyUsd)}) শেষ — প্রধান শিক্ষক সীমা বাড়ালে আবার চলবে।`, "budget");
  }
  if (!refusal) return;

  await recordAiUsage([
    {
      at,
      userId: ctx.userId,
      role: ctx.role,
      feature: ctx.feature,
      callId: ctx.callId,
      attempt: 1,
      refType: ctx.refType,
      refId: ctx.refId ?? ctx.sessionId,
      provider: ctx.provider,
      model: ctx.model,
      outcome: "capped",
      errorKind: refusal.cap,
    },
  ]);
  throw refusal;
}

/**
 * After a call: alert the Principal once per cap per month at the alert percent and at
 * 100 %. Never throws. The dedupe key carries the RECIPIENT, so a new holder still gets it.
 */
export async function alertIfBudget(feature: string, at: Date = new Date()): Promise<number> {
  if (!CAPPED_AI_FEATURES.includes(feature)) return 0;
  try {
    const [cfg, budget] = await Promise.all([aiFeatureConfig(feature), aiBudgetConfig()]);
    const month = dhakaMonthKey(at);
    const since = dhakaMonthStart(at);
    const label = AI_FEATURES.find((f) => f.key === feature)?.bn ?? feature;
    const checks: Array<{ scope: string; name: string; spent: number; cap: number }> = [
      { scope: feature, name: label, spent: await spentSince([feature], since), cap: cfg.monthlyUsd },
      { scope: "global", name: "এআই-এর মোট খরচ", spent: await spentSince(CAPPED_AI_FEATURES, since), cap: budget.monthlyUsd },
    ];
    const due: Array<{ scope: string; name: string; spent: number; cap: number; pct: number }> = [];
    for (const c of checks) {
      if (c.cap <= 0) continue;
      const pct = (c.spent / c.cap) * 100;
      if (pct >= 100) due.push({ ...c, pct: 100 });
      else if (pct >= budget.alertPct) due.push({ ...c, pct: budget.alertPct });
    }
    if (due.length === 0) return 0;
    const recipients = await holdersOf("system_health:ai_key");
    let n = 0;
    for (const d of due) {
      const titleBn = d.pct >= 100 ? `${d.name}: এ মাসের সীমা শেষ` : `${d.name}: এ মাসের সীমার ${d.pct}% খরচ হয়েছে`;
      const bodyBn = `এ মাসে খরচ ${fmtUsd(d.spent)}, সীমা ${fmtUsd(d.cap)}।${d.pct >= 100 ? " সীমা না বাড়ালে এই সুবিধা মাসের বাকি সময় বন্ধ থাকবে; শিক্ষকেরা যাচাই ছাড়াই পাঠাতে পারবেন।" : ""}`;
      for (const r of recipients) {
        const res = await emit({
          recipientUserId: r._id.toString(),
          kind: "AI_BUDGET_ALERT",
          titleBn,
          bodyBn,
          // No refs: the tap opens the AI settings screen, whatever the cap.
          dedupeKey: `AIB:${d.scope}:${month}:${d.pct}:${r._id.toString()}`,
        });
        if (res.created) n += 1;
      }
    }
    return n;
  } catch (err) {
    console.error("[ai-usage] budget alert failed (never blocks a call):", err);
    return 0;
  }
}
