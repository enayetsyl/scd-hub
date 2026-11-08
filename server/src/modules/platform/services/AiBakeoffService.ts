/**
 * AI-8 bake-off (D-#1098) — before the comment checker is switched on, run real past
 * comments through BOTH providers with the exact prompt teachers will get, and compare
 * issues caught per dollar. The owner reads the result and picks the model per feature.
 *
 *   • the sample: recent daily comments (spread across writers) and class-test comments
 *     with their mark %, half each
 *   • each one goes through `prepareCheck` (the live checker's prompt, de-identified, with
 *     the fail-closed gate) and then straight to each provider — the feature switch and
 *     the caps are NOT applied (this runs before switch-on, on purpose), but every call is
 *     metered as feature `comment_check_bakeoff`
 *   • the side-by-side keeps only DE-IDENTIFIED text (the model's own tokens), never names
 *
 * Run on the VM with `server/scripts/ai-bakeoff.cjs`. Needs both keys and both standards ON.
 */
import { randomUUID } from "crypto";
import { StudentComment } from "../../comments/models/StudentComment";
import { ClassTestResult } from "../../trackers/models/ClassTestResult";
import { ClassTest } from "../../trackers/models/ClassTest";
import { costUsd } from "../ai/aiPrices";
import { defaultProviderFactory, type ProviderFactory } from "../ai/aiRouter";
import { AiProviderError, type AiProviderName } from "../ai/provider";
import { CHECK_SEND, CT_FIELDS, isPrepared, parseReply, prepareCheck, type CheckInput, type PreparedCheck } from "./CommentCheckService";
import { providerKey, providerModel, refreshAiConfig } from "./AiSettingService";
import { recordAiUsage } from "./AiUsageService";

export const BAKEOFF_FEATURE = "comment_check_bakeoff";

export interface BakeoffItem {
  ref: string;
  kind: "DAILY" | "CT";
  input: CheckInput;
}

export interface ProviderTally {
  provider: AiProviderName;
  model: string;
  checked: number;
  errors: Record<string, number>;
  issues: number;
  issuesByType: Record<string, number>;
  costUsd: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  latenciesMs: number[];
}

export interface BakeoffSummary {
  items: number;
  skipped: Record<string, number>;
  providers: Array<
    Omit<ProviderTally, "latenciesMs"> & {
      issuesPerCheck: number;
      costPerCheckUsd: number;
      issuesPerDollar: number;
      latencyP50Ms: number;
      latencyP90Ms: number;
    }
  >;
}

export interface SideBySide {
  ref: string;
  kind: "DAILY" | "CT";
  markPct: number | null;
  /** De-identified fields as sent. */
  fields: Array<{ field: string; text: string }>;
  byProvider: Partial<Record<AiProviderName, { issues: Array<{ field: string; type: string; quote: string; suggestion: string }>; corrected: Record<string, string> } | { error: string }>>;
}

/** Recent comments, spread across writers: at most `perWriter` from one person per kind. */
export async function sampleBakeoffItems(count: number, perWriter = 4): Promise<BakeoffItem[]> {
  const half = Math.ceil(count / 2);
  const items: BakeoffItem[] = [];

  const byWriter = new Map<string, number>();
  const comments = await StudentComment.find({ discardedAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .limit(half * 20)
    .select("studentId authorUserId type sentiment text")
    .lean();
  for (const c of comments) {
    if (items.length >= half) break;
    const w = String(c.authorUserId);
    if ((byWriter.get(w) ?? 0) >= perWriter || !c.text?.trim()) continue;
    byWriter.set(w, (byWriter.get(w) ?? 0) + 1);
    items.push({
      ref: String(c._id),
      kind: "DAILY",
      input: { kind: "DAILY", studentId: String(c.studentId), fields: [{ field: "text", text: c.text }], commentType: c.type, sentiment: c.sentiment },
    });
  }

  const byTeacher = new Map<string, number>();
  const results = await ClassTestResult.find({
    status: "PRESENT",
    $or: [{ weakness: { $nin: [null, ""] } }, { guardianAction: { $nin: [null, ""] } }, { teacherAction: { $nin: [null, ""] } }],
  })
    .sort({ updatedAt: -1 })
    .limit(half * 20)
    .select("testId studentId marks weakness guardianAction teacherAction")
    .lean();
  const tests = new Map(
    (await ClassTest.find({ _id: { $in: [...new Set(results.map((r) => String(r.testId)))] } }).select("totalMarks teacherId").lean()).map((t) => [String(t._id), t]),
  );
  for (const r of results) {
    if (items.length >= count) break;
    const t = tests.get(String(r.testId));
    if (!t || !t.totalMarks || r.marks == null) continue;
    const w = String(t.teacherId ?? "none");
    if ((byTeacher.get(w) ?? 0) >= perWriter) continue;
    byTeacher.set(w, (byTeacher.get(w) ?? 0) + 1);
    const fields = CT_FIELDS.map((f) => ({ field: f, text: (r as Record<string, unknown>)[f] as string | undefined })).filter(
      (f): f is { field: (typeof CT_FIELDS)[number]; text: string } => !!f.text && f.text.trim().length > 0,
    );
    items.push({ ref: String(r._id), kind: "CT", input: { kind: "CT", studentId: String(r.studentId), fields, markPct: (r.marks / t.totalMarks) * 100 } });
  }
  return items;
}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

export async function runBakeoff(opts: {
  items: BakeoffItem[];
  providers?: AiProviderName[];
  models?: Partial<Record<AiProviderName, string>>;
  makeProvider?: ProviderFactory;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ summary: BakeoffSummary; sideBySide: SideBySide[] }> {
  await refreshAiConfig(true);
  const providers = opts.providers ?? (["deepseek", "gemini"] as AiProviderName[]);
  const make = opts.makeProvider ?? defaultProviderFactory;
  const keys = Object.fromEntries(providers.map((p) => [p, providerKey(p)])) as Record<AiProviderName, string | null>;
  for (const p of providers) if (!keys[p]) throw new Error(`no key for ${p} — save it on the AI settings screen first`);

  const tallies = Object.fromEntries(
    providers.map((p) => [
      p,
      { provider: p, model: opts.models?.[p] || providerModel(p), checked: 0, errors: {}, issues: 0, issuesByType: {}, costUsd: 0, cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0, latenciesMs: [] } as ProviderTally,
    ]),
  ) as Record<AiProviderName, ProviderTally>;
  const skipped: Record<string, number> = {};
  const sideBySide: SideBySide[] = [];

  let done = 0;
  for (const item of opts.items) {
    const prep = await prepareCheck(item.input);
    if (!isPrepared(prep)) {
      skipped[prep.reason ?? "UNKNOWN"] = (skipped[prep.reason ?? "UNKNOWN"] ?? 0) + 1;
      opts.onProgress?.(++done, opts.items.length);
      continue;
    }
    const row: SideBySide = { ref: item.ref, kind: item.kind, markPct: item.input.markPct == null ? null : Math.round(item.input.markPct), fields: prep.deid, byProvider: {} };
    for (const p of providers) {
      const t = tallies[p];
      const at = new Date();
      try {
        const r = await make(p, keys[p]!).send({ stablePrefix: prep.stablePrefix, variablePart: prep.variablePart, ...CHECK_SEND }, t.model);
        const parsed = parseReply(r.json, new Set((prep as PreparedCheck).fields.map((f) => f.field)));
        const cost = costUsd(p, t.model, r.usage, at);
        t.checked += 1;
        t.issues += parsed.issues.length;
        for (const i of parsed.issues) t.issuesByType[i.type] = (t.issuesByType[i.type] ?? 0) + 1;
        t.costUsd += cost;
        t.cacheHitTokens += r.usage.cacheHitTokens;
        t.cacheMissTokens += r.usage.cacheMissTokens;
        t.outputTokens += r.usage.outputTokens;
        t.latenciesMs.push(r.latencyMs);
        row.byProvider[p] = { issues: parsed.issues, corrected: parsed.corrected };
        await recordAiUsage([
          { at, feature: BAKEOFF_FEATURE, callId: randomUUID(), attempt: 1, refType: item.kind === "DAILY" ? "StudentComment" : "ClassTestResult", refId: item.ref, provider: p, model: t.model, resolvedModel: r.resolvedModel, policyHash: prep.policyHash, ...r.usage, costUsd: cost, latencyMs: r.latencyMs, outcome: "ok" },
        ]);
      } catch (e) {
        const kind = e instanceof AiProviderError ? e.kind : "network";
        t.errors[kind] = (t.errors[kind] ?? 0) + 1;
        row.byProvider[p] = { error: kind };
        await recordAiUsage([{ at, feature: BAKEOFF_FEATURE, callId: randomUUID(), attempt: 1, refId: item.ref, provider: p, model: t.model, policyHash: prep.policyHash, outcome: "error", errorKind: kind }]);
      }
    }
    sideBySide.push(row);
    opts.onProgress?.(++done, opts.items.length);
  }

  const summary: BakeoffSummary = {
    items: opts.items.length,
    skipped,
    providers: providers.map((p) => {
      const t = tallies[p];
      const { latenciesMs, ...rest } = t;
      return {
        ...rest,
        costUsd: Math.round(t.costUsd * 1e6) / 1e6,
        issuesPerCheck: t.checked ? Math.round((t.issues / t.checked) * 100) / 100 : 0,
        costPerCheckUsd: t.checked ? Math.round((t.costUsd / t.checked) * 1e6) / 1e6 : 0,
        issuesPerDollar: t.costUsd > 0 ? Math.round(t.issues / t.costUsd) : 0,
        latencyP50Ms: pct(latenciesMs, 50),
        latencyP90Ms: pct(latenciesMs, 90),
      };
    }),
  };
  return { summary, sideBySide };
}
