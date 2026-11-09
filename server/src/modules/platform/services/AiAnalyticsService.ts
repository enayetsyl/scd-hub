/**
 * AiAnalyticsService (AI-7) — the Principal's AI usage and comment-quality report.
 * `reports:ai_usage` (Principal by default, D-#861 one switch per report).
 *
 *   usage    spend, calls, cache-hit rate, average cost per check / per assistant turn,
 *            cap refusals, errors, fallbacks — by Dhaka day, person, feature and model
 *            (from the `AiUsage` ledger, D-#1091; it holds no text)
 *   budget   this Dhaka month to date against each cap and the school budget, with a
 *            straight-line projection to month end (D-#1103)
 *   quality  per comment writer: checks run, issues found (and by type), accepted, kept
 *            their own text, saved unchecked while the checker was on — from the `aiCheck`
 *            stamps on StudentComment and ClassTestResult (D-#1133; no text)
 */
import { Types } from "mongoose";
import type { AuthPayload } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import { AiUsage } from "../models/AiUsage";
import { User } from "../../foundation/models/User";
import { StudentComment } from "../../comments/models/StudentComment";
import { ClassTestResult } from "../../trackers/models/ClassTestResult";
import { aiBudgetConfig, aiFeatureConfig, AI_FEATURES, CAPPED_AI_FEATURES } from "./AiSettingService";
import { dhakaMonthStart } from "./AiUsageService";

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC instant of 00:00 Dhaka on a YYYY-MM-DD key. */
export function dhakaDayStartOfKey(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error("তারিখ সঠিক নয়");
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - DHAKA_OFFSET_MS);
}

export interface UsageBucket {
  key: string;
  label: string;
  calls: number;
  usd: number;
  capped: number;
  errors: number;
}

export interface QualityRow {
  userId: string;
  name: string;
  checks: number;
  issuesFound: number;
  issuesAccepted: number;
  overrode: number;
  notChecked: number;
  issueTypes: Record<string, number>;
  /** issuesAccepted ÷ issuesFound (0–1); null when nothing was found. */
  acceptanceRate: number | null;
  /** overrode ÷ checks that found issues (0–1); null when none did. */
  overrideRate: number | null;
}

export interface BudgetLine {
  scope: string;
  label: string;
  spentUsd: number;
  capUsd: number;
  projectedUsd: number;
  pct: number;
}

export interface AiUsageReport {
  fromKey: string;
  toKey: string;
  totals: {
    usd: number;
    calls: number;
    capped: number;
    errors: number;
    fallbacks: number;
    cacheHitRate: number | null;
    avgCostPerCheckUsd: number | null;
    avgCostPerTurnUsd: number | null;
    notChecked: number;
    checked: number;
  };
  byDay: UsageBucket[];
  byPerson: UsageBucket[];
  byFeature: UsageBucket[];
  byModel: UsageBucket[];
  budget: BudgetLine[];
  quality: QualityRow[];
}

const FEATURE_LABEL: Record<string, string> = {
  ...Object.fromEntries(AI_FEATURES.map((f) => [f.key, f.bn])),
  monthly_comment: "মাসিক মন্তব্য",
  book_author: "বই লেখা",
  observation_rota: "পর্যবেক্ষণ রোটা",
  voice_task: "কণ্ঠে কাজ",
  comment_check_bakeoff: "মডেল তুলনা (একবার)",
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export async function aiUsageReport(authIn: AuthPayload | null, fromKey: string, toKey: string, now: Date = new Date()): Promise<AiUsageReport> {
  if (!authIn) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(authIn, "reports:ai_usage")) throw new ForbiddenError("এআই ব্যবহারের রিপোর্ট দেখার অনুমতি নেই");
  const from = dhakaDayStartOfKey(fromKey);
  const to = new Date(dhakaDayStartOfKey(toKey).getTime() + DAY_MS);
  if (to <= from) throw new Error("তারিখের সীমা সঠিক নয়");
  if (to.getTime() - from.getTime() > 400 * DAY_MS) throw new Error("একবারে সর্বোচ্চ ৪০০ দিন দেখা যায়");
  const match = { at: { $gte: from, $lt: to } };

  const sums = {
    calls: { $sum: { $cond: [{ $and: [{ $eq: ["$attempt", 1] }, { $ne: ["$outcome", "capped"] }] }, 1, 0] } },
    usd: { $sum: "$costUsd" },
    capped: { $sum: { $cond: [{ $eq: ["$outcome", "capped"] }, 1, 0] } },
    errors: { $sum: { $cond: [{ $eq: ["$outcome", "error"] }, 1, 0] } },
    fallbacks: { $sum: { $cond: [{ $eq: ["$outcome", "fallback"] }, 1, 0] } },
    hit: { $sum: "$cacheHitTokens" },
    miss: { $sum: "$cacheMissTokens" },
  };
  type Row = { _id: unknown; calls: number; usd: number; capped: number; errors: number; fallbacks: number; hit: number; miss: number };
  const group = (id: unknown) => AiUsage.aggregate<Row>([{ $match: match }, { $group: { _id: id, ...sums } }, { $sort: { usd: -1 } }]);

  const [all, byDayRaw, byPersonRaw, byFeatureRaw, byModelRaw] = await Promise.all([
    group(null),
    group({ $dateToString: { format: "%Y-%m-%d", date: "$at", timezone: "+06:00" } }),
    group("$userId"),
    group("$feature"),
    group({ provider: "$provider", model: "$modelName" }),
  ]);
  const t = all[0];
  const featureRow = (f: string) => byFeatureRaw.find((r) => r._id === f);
  const per = (f: string) => {
    const r = featureRow(f);
    return r && r.calls > 0 ? round6(r.usd / r.calls) : null;
  };

  const people = byPersonRaw.filter((r) => r._id);
  const names = new Map(
    (await User.find({ _id: { $in: people.map((r) => r._id as Types.ObjectId) } }).select("name").lean()).map((u) => [u._id.toString(), u.name]),
  );
  const bucket = (key: string, label: string, r: Row): UsageBucket => ({ key, label, calls: r.calls, usd: round6(r.usd), capped: r.capped, errors: r.errors });

  // Budget: always the CURRENT Dhaka month, whatever range is shown.
  const monthStart = dhakaMonthStart(now);
  const monthEnd = dhakaMonthStart(new Date(monthStart.getTime() + 40 * DAY_MS));
  const elapsed = Math.max(1, (now.getTime() - monthStart.getTime()) / DAY_MS);
  const monthDays = (monthEnd.getTime() - monthStart.getTime()) / DAY_MS;
  const mtd = await AiUsage.aggregate<{ _id: string; usd: number }>([
    { $match: { at: { $gte: monthStart, $lt: now }, feature: { $in: [...CAPPED_AI_FEATURES] } } },
    { $group: { _id: "$feature", usd: { $sum: "$costUsd" } } },
  ]);
  const budgetCfg = await aiBudgetConfig();
  const line = async (scope: string, label: string, spent: number, cap: number): Promise<BudgetLine> => ({
    scope,
    label,
    spentUsd: round6(spent),
    capUsd: cap,
    projectedUsd: round6((spent / elapsed) * monthDays),
    pct: cap > 0 ? Math.round((spent / cap) * 100) : 0,
  });
  const budget: BudgetLine[] = [];
  for (const f of AI_FEATURES) {
    const cfg = await aiFeatureConfig(f.key);
    budget.push(await line(f.key, f.bn, mtd.find((m) => m._id === f.key)?.usd ?? 0, cfg.monthlyUsd));
  }
  budget.push(await line("global", "মোট", mtd.reduce((s, m) => s + m.usd, 0), budgetCfg.monthlyUsd));

  // Comment quality from the stamps (writer = comment author / result enterer).
  type Stamp = { _id: Types.ObjectId; status: string; issuesFound?: number; issuesAccepted?: number; teacherOverrode?: boolean; issueTypes?: Record<string, number> };
  const stamps = async (model: typeof StudentComment | typeof ClassTestResult, who: string, when: string) =>
    (model as typeof StudentComment).aggregate<{ _id: Types.ObjectId; stamps: Stamp[] }>([
      { $match: { [when]: { $gte: from, $lt: to }, aiCheck: { $exists: true } } },
      { $project: { who: `$${who}`, s: "$aiCheck" } },
      { $group: { _id: "$who", stamps: { $push: "$s" } } },
    ]);
  const [cs, ct] = await Promise.all([stamps(StudentComment, "authorUserId", "createdAt"), stamps(ClassTestResult as never, "enteredBy", "updatedAt")]);
  const q = new Map<string, QualityRow>();
  for (const g of [...cs, ...ct]) {
    if (!g._id) continue;
    const id = g._id.toString();
    const row = q.get(id) ?? { userId: id, name: "", checks: 0, issuesFound: 0, issuesAccepted: 0, overrode: 0, notChecked: 0, issueTypes: {}, acceptanceRate: null, overrideRate: null };
    for (const s of g.stamps) {
      if (s.status === "NOT_CHECKED") {
        row.notChecked += 1;
        continue;
      }
      row.checks += 1;
      row.issuesFound += s.issuesFound ?? 0;
      row.issuesAccepted += s.issuesAccepted ?? 0;
      if (s.teacherOverrode) row.overrode += 1;
      for (const [k, v] of Object.entries(s.issueTypes ?? {})) row.issueTypes[k] = (row.issueTypes[k] ?? 0) + (v as number);
    }
    q.set(id, row);
  }
  const qNames = new Map((await User.find({ _id: { $in: [...q.keys()] } }).select("name").lean()).map((u) => [u._id.toString(), u.name]));
  const withIssues = async (id: string, model: typeof StudentComment | typeof ClassTestResult, who: string, when: string) =>
    (model as typeof StudentComment).countDocuments({ [who]: new Types.ObjectId(id), [when]: { $gte: from, $lt: to }, "aiCheck.status": "CHECKED", "aiCheck.issuesFound": { $gt: 0 } });
  const quality: QualityRow[] = [];
  for (const r of q.values()) {
    const found = (await withIssues(r.userId, StudentComment, "authorUserId", "createdAt")) + (await withIssues(r.userId, ClassTestResult as never, "enteredBy", "updatedAt"));
    quality.push({
      ...r,
      name: qNames.get(r.userId) ?? "—",
      acceptanceRate: r.issuesFound > 0 ? Math.round((r.issuesAccepted / r.issuesFound) * 100) / 100 : null,
      overrideRate: found > 0 ? Math.round((r.overrode / found) * 100) / 100 : null,
    });
  }
  quality.sort((a, b) => b.checks + b.notChecked - (a.checks + a.notChecked));

  return {
    fromKey,
    toKey,
    totals: {
      usd: round6(t?.usd ?? 0),
      calls: t?.calls ?? 0,
      capped: t?.capped ?? 0,
      errors: t?.errors ?? 0,
      fallbacks: t?.fallbacks ?? 0,
      cacheHitRate: t && t.hit + t.miss > 0 ? Math.round((t.hit / (t.hit + t.miss)) * 100) / 100 : null,
      avgCostPerCheckUsd: per("comment_check"),
      avgCostPerTurnUsd: per("assistant"),
      notChecked: quality.reduce((s, r) => s + r.notChecked, 0),
      checked: quality.reduce((s, r) => s + r.checks, 0),
    },
    byDay: byDayRaw.map((r) => bucket(String(r._id), String(r._id), r)).sort((a, b) => a.key.localeCompare(b.key)),
    byPerson: byPersonRaw.map((r) => (r._id ? bucket(String(r._id), names.get(String(r._id)) ?? "—", r) : bucket("system", "সিস্টেম (নির্ধারিত কাজ)", r))),
    byFeature: byFeatureRaw.map((r) => bucket(String(r._id), FEATURE_LABEL[String(r._id)] ?? String(r._id), r)),
    byModel: byModelRaw.map((r) => {
      const id = r._id as { provider: string; model: string };
      return bucket(`${id.provider}/${id.model}`, `${id.provider} · ${id.model}`, r);
    }),
    budget,
    quality,
  };
}
