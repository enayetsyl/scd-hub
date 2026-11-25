/**
 * ReviewQualityService — review speed / rubber-stamp flag (owner GO 25 Nov 2026, D-#1684,
 * .claude/plans/review-speed-flag.md).
 *
 * Why: on 24-25 Nov one reviewer decided 1,000 questions (998 APPROVE, no comments), a median 1.5 s
 * apart, while the 20:30 stats push only said "total 1000". This module turns the same first-verdict
 * audit rows `ReviewStatsService` counts into a per-reviewer flag: GREEN / AMBER / RED / NONE.
 *
 * Source = the first `REVIEW_SUBMITTED` row of each round (resubmits ignored), credited to the ROUND's
 * reviewer, sorted by time, split per reviewer and per kind (question vs plan = chapter + session plan).
 * NOTE: the bulk bar (D-#527) writes one audit row per item with near-identical times, so bulk verdicts
 * show up as very short gaps. That is intended: the owner wants to see rubber-stamping however it was done.
 *
 * Seen only by management (`review_stats:view_all` / `review_program:supervise`); a reviewer never gets
 * a view of their own quality data. Operational plane (identity ids) - behind the ADR-005 firewall.
 *
 * The pure function `qualityFromEvents` is unit-tested without a database.
 */
import { Types } from "mongoose";
import { PLAN_DOC_TYPES } from "@scd/shared";
import { Audit } from "../../platform/models/Audit";
import { User } from "../../foundation/models/User";
import { QUESTION_DOC_TYPE } from "../../questions/services/QuestionReviewService";
import { holderIdsOf } from "../../access-control/services/holders";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { bnNum } from "../../../lib/bnNum";
import { addDaysToKey, dayKeyStart, firstVerdictMatch, roundLookup } from "./ReviewStatsService";

export const QUALITY_THRESHOLDS = {
  /** A question verdict under this many seconds after the previous one counts as "fast". */
  QUESTION_FAST_SEC: 8,
  PLAN_FAST_SEC: 120,
  /** A gap this long (minutes) starts a new sitting and is not counted as a gap. */
  SITTING_GAP_MIN: 30,
  MIN_QUESTIONS: 50,
  MIN_PLANS: 10,
  FAST_PCT_AMBER: 30,
  SILENT_APPROVE_PCT: 95,
} as const;
export type QualityThresholds = typeof QUALITY_THRESHOLDS;

export type QualityKind = "question" | "plan";
export type QualityFlag = "NONE" | "GREEN" | "AMBER" | "RED";

export interface QualityEvent {
  reviewerId: string;
  kind: QualityKind;
  /** Epoch ms of the verdict. */
  at: number;
  verdict: string;
  /** Questions only: a written reason came with the verdict. */
  reasonGiven?: boolean;
}

export interface KindQuality {
  n: number;
  /** Median seconds between consecutive verdicts inside a sitting; null when there is no gap. */
  medianGapSec: number | null;
  fastPct: number;
  approvePct: number;
  changesPct: number;
  /** Questions only (plan verdicts carry no reason flag): APPROVE without a reason, share of all verdicts. */
  silentApprovePct: number;
}

export interface ReviewerQuality {
  reviewerId: string;
  flag: QualityFlag;
  reasonsBn: string[];
  questions: KindQuality;
  plans: KindQuality;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;
const pct = (num: number, den: number): number => (den === 0 ? 0 : (num / den) * 100);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface RawKind extends KindQuality {
  rawMedian: number | null;
  rawFastPct: number;
  rawSilentPct: number;
  rawChangesPct: number;
}

function kindQuality(events: QualityEvent[], kind: QualityKind, t: QualityThresholds): RawKind {
  const sorted = events.filter((e) => e.kind === kind).sort((a, b) => a.at - b.at);
  const fastSec = kind === "question" ? t.QUESTION_FAST_SEC : t.PLAN_FAST_SEC;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const sec = (sorted[i].at - sorted[i - 1].at) / 1000;
    if (sec >= t.SITTING_GAP_MIN * 60) continue; // a new sitting, not a gap
    gaps.push(sec);
  }
  const approves = sorted.filter((e) => e.verdict === "APPROVE").length;
  const silent = kind === "question" ? sorted.filter((e) => e.verdict === "APPROVE" && e.reasonGiven !== true).length : 0;
  const rawMedian = median(gaps);
  const rawFast = pct(gaps.filter((g) => g < fastSec).length, gaps.length);
  const rawSilent = pct(silent, sorted.length);
  const rawChanges = pct(sorted.length - approves, sorted.length);
  return {
    n: sorted.length,
    medianGapSec: rawMedian === null ? null : round1(rawMedian),
    fastPct: Math.round(rawFast),
    approvePct: Math.round(pct(approves, sorted.length)),
    changesPct: Math.round(rawChanges),
    silentApprovePct: Math.round(rawSilent),
    rawMedian,
    rawFastPct: rawFast,
    rawSilentPct: rawSilent,
    rawChangesPct: rawChanges,
  };
}

const KIND_LABEL_BN: Record<QualityKind, string> = { question: "প্রশ্ন", plan: "পরিকল্পনা" };

/** "১.৫" for 1.5, "২" for 2 (Bangla digits). */
const secBn = (s: number): string => bnNum(Number.isInteger(s) ? String(s) : s.toFixed(1));

/** Pure: one row per reviewer who appears in `events`. */
export function qualityFromEvents(events: QualityEvent[], t: QualityThresholds = QUALITY_THRESHOLDS): ReviewerQuality[] {
  const byReviewer = new Map<string, QualityEvent[]>();
  for (const e of events) {
    const list = byReviewer.get(e.reviewerId) ?? [];
    list.push(e);
    byReviewer.set(e.reviewerId, list);
  }
  const out: ReviewerQuality[] = [];
  for (const [reviewerId, evs] of byReviewer) {
    const q = kindQuality(evs, "question", t);
    const p = kindQuality(evs, "plan", t);
    const kinds: Array<{ kind: QualityKind; k: RawKind; min: number; fastSec: number }> = [
      { kind: "question", k: q, min: t.MIN_QUESTIONS, fastSec: t.QUESTION_FAST_SEC },
      { kind: "plan", k: p, min: t.MIN_PLANS, fastSec: t.PLAN_FAST_SEC },
    ];
    const counted = kinds.filter((x) => x.k.n >= x.min);
    let flag: QualityFlag = counted.length === 0 ? "NONE" : "GREEN";
    const reasonsBn: string[] = [];
    for (const { kind, k, fastSec } of counted) {
      const label = KIND_LABEL_BN[kind];
      if (k.rawMedian !== null && k.rawMedian < fastSec) {
        flag = "RED";
        reasonsBn.push(`${label}: ${bnNum(k.n)}টি, গড়ে ${secBn(round1(k.rawMedian))} সেকেন্ডে একটি`);
      } else if (k.rawFastPct >= t.FAST_PCT_AMBER) {
        if (flag !== "RED") flag = "AMBER";
        reasonsBn.push(`${label}: ${bnNum(k.n)}টির মধ্যে ${bnNum(Math.round(k.rawFastPct))} শতাংশ ${bnNum(fastSec)} সেকেন্ডের কমে`);
      }
      if (kind === "question" && k.rawSilentPct >= t.SILENT_APPROVE_PCT && k.rawChangesPct === 0) {
        if (flag !== "RED") flag = "AMBER";
        reasonsBn.push(`${bnNum(Math.round((k.rawSilentPct / 100) * k.n))}টি অনুমোদন, কোনো মন্তব্য নেই`);
      }
    }
    const strip = ({ rawMedian: _a, rawFastPct: _b, rawSilentPct: _c, rawChangesPct: _d, ...rest }: RawKind): KindQuality => rest;
    out.push({ reviewerId, flag, reasonsBn, questions: strip(q), plans: strip(p) });
  }
  return out;
}

export interface ReviewQualityRow extends ReviewerQuality {
  name: string;
}

/** Quality rows for the Dhaka days [fromKey, toKey]; `reviewerId` omitted = everyone with activity. */
export async function reviewQuality(opts: { fromKey: string; toKey: string; reviewerId?: string }): Promise<ReviewQualityRow[]> {
  const docTypes = [...PLAN_DOC_TYPES, QUESTION_DOC_TYPE];
  const rows = await Audit.aggregate<{
    at: Date;
    reviewerId: Types.ObjectId;
    docType: string;
    verdict?: string;
    reasonGiven?: boolean;
  }>([
    { $match: firstVerdictMatch(dayKeyStart(opts.fromKey), dayKeyStart(addDaysToKey(opts.toKey, 1)), opts.reviewerId) },
    roundLookup(),
    { $unwind: "$round" },
    {
      $match: {
        "round.docType": { $in: docTypes },
        ...(opts.reviewerId ? { "round.reviewerId": new Types.ObjectId(opts.reviewerId) } : {}),
      },
    },
    {
      $project: {
        _id: 0,
        at: "$eventAt",
        reviewerId: "$round.reviewerId",
        docType: "$round.docType",
        verdict: "$meta.verdict",
        reasonGiven: "$meta.reasonGiven",
      },
    },
    { $sort: { at: 1 } },
  ]);
  const events: QualityEvent[] = rows
    .filter((r) => r.reviewerId)
    .map((r) => ({
      reviewerId: String(r.reviewerId),
      kind: r.docType === QUESTION_DOC_TYPE ? "question" : "plan",
      at: new Date(r.at).getTime(),
      verdict: r.verdict ?? "",
      reasonGiven: r.reasonGiven === true,
    }));
  const quality = qualityFromEvents(events);
  if (quality.length === 0) return [];
  const users = (await User.find({ _id: { $in: quality.map((q) => q.reviewerId) } })
    .select("name")
    .lean()) as unknown as Array<{ _id: { toString(): string }; name: string }>;
  const names = new Map(users.map((u) => [u._id.toString(), u.name]));
  return quality
    .map((q) => ({ ...q, name: names.get(q.reviewerId) ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name, "bn"));
}

// ---------------------------------------------------------------------------
// The 20:30 supervisor alert
// ---------------------------------------------------------------------------

export const QUALITY_ALERT_TITLE_BN = "পর্যালোচনার গতি — সতর্কতা";
const MAX_NAMED = 4;
const FLAG_BN: Record<QualityFlag, string> = { RED: "লাল", AMBER: "হলুদ", GREEN: "সবুজ", NONE: "—" };

export const reviewQualityDedupeKey = (recipientId: string, dateKey: string): string => `review-quality:${recipientId}:${dateKey}`;

/** Pure: the notice body for the flagged reviewers (RED first), or null when nobody is flagged. */
export function qualityAlertBodyBn(rows: ReviewQualityRow[]): string | null {
  const flagged = rows
    .filter((r) => r.flag === "RED" || r.flag === "AMBER")
    .sort((a, b) => (a.flag === b.flag ? a.name.localeCompare(b.name, "bn") : a.flag === "RED" ? -1 : 1));
  if (flagged.length === 0) return null;
  const lines = flagged.slice(0, MAX_NAMED).map((r) => `${r.name} (${FLAG_BN[r.flag]}) — ${r.reasonsBn[0] ?? ""}`);
  const more = flagged.length - MAX_NAMED;
  if (more > 0) lines.push(`+ আরও ${bnNum(more)} জন`);
  return lines.join("\n");
}

export interface QualityAlert {
  recipientIds: string[];
  titleBn: string;
  bodyBn: string;
}

/** Today's quality for the 20:30 run: who to tell and what, or null when nobody is AMBER/RED. */
export async function qualityAlertForToday(now: Date): Promise<QualityAlert | null> {
  const todayKey = dhakaDayKey(now);
  const rows = await reviewQuality({ fromKey: todayKey, toKey: todayKey });
  const bodyBn = qualityAlertBodyBn(rows);
  if (!bodyBn) return null;
  const recipientIds = await holderIdsOf("review_program:supervise");
  if (recipientIds.length === 0) return null;
  return { recipientIds, titleBn: QUALITY_ALERT_TITLE_BN, bodyBn };
}
