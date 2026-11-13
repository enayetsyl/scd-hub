/**
 * The per-child strategy library (docs/prd-child-support-profile.md §5.4, §16.7; D-#1565 part).
 * Counts are DERIVED on read from APPROVED reports' `strategyLinks` inside the positive window
 * (D-#85 derive-on-read): worked / partly / did not work, distinct teachers, the level, reuse, and
 * "last three failed" (E-7). A strategy is created at approval from the report's candidate or a
 * starter key; a punitive candidate never becomes a strategy (S-4).
 */
import { Types } from "mongoose";
import {
  SUPPORT_STARTER_STRATEGIES,
  daysBetweenKeys,
  evidenceLevel,
  SUPPORT_THRESHOLDS,
  type SupportLevel,
  type SupportStrategyKind,
} from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { SupportStrategy, type ISupportStrategy } from "../models/SupportStrategy";
import { SupportReport, type ISupportReport } from "../models/SupportReport";

export interface StrategyCounts {
  worked: number;
  partly: number;
  didNotWork: number;
  teachers: number;
  level: SupportLevel | null;
  successShare: number | null;
  lastTriedKey: string | null;
  lastThreeFailed: boolean;
}

export async function strategyCounts(strategyIds: Types.ObjectId[], now: Date = new Date()): Promise<Map<string, StrategyCounts>> {
  const today = dhakaDayKey(now);
  const reps = await SupportReport.find({ status: "APPROVED", "strategyLinks.strategyId": { $in: strategyIds } })
    .select("authorId occurredOn periodNo context subject strategyLinks source")
    .lean();
  const out = new Map<string, StrategyCounts>();
  for (const id of strategyIds) {
    const tries = reps
      .filter((r) => daysBetweenKeys(r.occurredOn, today) <= SUPPORT_THRESHOLDS.positiveWindowDays)
      .flatMap((r) => r.strategyLinks.filter((l) => String(l.strategyId) === String(id)).map((l) => ({ r, outcome: l.outcome })))
      .sort((a, b) => a.r.occurredOn.localeCompare(b.r.occurredOn));
    const n = (o: string) => tries.filter((t) => t.outcome === o).length;
    const lvl = evidenceLevel({
      side: "POSITIVE",
      isStrategy: true,
      todayKey: today,
      evidence: tries.map((t) => ({ id: String(t.r._id), authorId: String(t.r.authorId), occurredOn: t.r.occurredOn, slot: t.r.periodNo != null ? `P${t.r.periodNo}` : (t.r.context ?? "OTHER"), setting: t.r.subject || t.r.context || "OTHER", source: t.r.source, result: t.outcome })),
    });
    const last3 = tries.slice(-3);
    out.set(String(id), {
      worked: n("WORKED"),
      partly: n("PARTLY"),
      didNotWork: n("DID_NOT_WORK"),
      teachers: new Set(tries.map((t) => String(t.r.authorId))).size,
      level: lvl.level,
      successShare: tries.length ? Math.round(((n("WORKED") + n("PARTLY")) / tries.length) * 100) : null,
      lastTriedKey: tries.length ? tries[tries.length - 1].r.occurredOn : null,
      lastThreeFailed: last3.length === 3 && last3.every((t) => t.outcome === "DID_NOT_WORK") && (new Set(last3.map((t) => String(t.r.authorId))).size >= 2 || daysBetweenKeys(last3[0].r.occurredOn, last3[2].r.occurredOn) >= 14),
    });
  }
  return out;
}

export interface LinkInput {
  /** An existing strategy id, or "NEW". */
  strategyId: string;
  outcome: "WORKED" | "PARTLY" | "DID_NOT_WORK";
  /** For NEW: a starter key, or a title (the report's candidate). */
  starterKey?: string | null;
  titleBn?: string | null;
}

/** Resolve the Principal's confirmed links: create NEW strategies on this profile, validate the rest. */
export async function resolveLinks(r: ISupportReport, links: LinkInput[]): Promise<{ strategyId: Types.ObjectId; outcome: LinkInput["outcome"] }[]> {
  const out: { strategyId: Types.ObjectId; outcome: LinkInput["outcome"] }[] = [];
  for (const l of links.slice(0, 5)) {
    if (!["WORKED", "PARTLY", "DID_NOT_WORK"].includes(l.outcome)) continue;
    let s: ISupportStrategy | null = null;
    if (l.strategyId === "NEW") {
      const starter = SUPPORT_STARTER_STRATEGIES.find((x) => x.key === l.starterKey);
      const title = (starter?.bn ?? l.titleBn ?? "").trim().slice(0, 90);
      if (!title || !r.profileId) continue;
      const existing = starter ? await SupportStrategy.findOne({ profileId: r.profileId, starterKey: starter.key, status: "ACTIVE" }) : null;
      s =
        existing ??
        (await SupportStrategy.create({
          profileId: r.profileId,
          titleBn: title,
          howBn: (r.whatWorked || r.tried || "").slice(0, 400),
          kind: (starter?.kind ?? "PREVENT") as SupportStrategyKind,
          needTag: starter?.needs?.[0] ?? null,
          starterKey: starter?.key ?? null,
          contextTags: r.subject ? [`SUBJECT:${r.subject}`] : [],
          createdFromReportId: r._id,
        }));
    } else if (Types.ObjectId.isValid(l.strategyId)) {
      s = await SupportStrategy.findOne({ _id: new Types.ObjectId(l.strategyId), profileId: r.profileId });
    }
    if (s) out.push({ strategyId: s._id, outcome: l.outcome });
  }
  return out;
}
