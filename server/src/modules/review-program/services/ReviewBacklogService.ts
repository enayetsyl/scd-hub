/**
 * ReviewBacklogService — H-2 daily backlog reminder (.claude/plans/review-hub-and-quality.md).
 *
 * Every school morning (the scheduler's `review_backlog_daily` family, 08:00 Dhaka) each active staff
 * login with something left to review gets ONE notification built from the SAME rows as the hub
 * ("আমার পর্যালোচনা", see ReviewHubService.reviewHubForUser) — no second count. Nothing left → nothing sent.
 * People holding `review_program:supervise` get ONE extra line, only when some reviewer has an item whose
 * due date is already past.
 *
 * Kind: the generic REVIEW_ASSIGNED review-duty kind, with `refs.screenTarget` ("Tab/Screen") naming the
 * page it opens — no new notification kind, so no contract file changes.
 *
 * Dedupe keys carry the RECIPIENT and the day (an entity-only key swallows a re-emit to a new recipient).
 *
 * The PRINCIPAL is not a reviewer recipient: his own hub card is his view, and the supervisor summary is how
 * he hears about other people's backlog. Operational plane — identity ids only (ADR-005).
 */
import { User } from "../../foundation/models/User";
import { bnNum } from "../../../lib/bnNum";
import { emit } from "../../notifications/services/NotificationService";
import { holderIdsOf } from "../../access-control/services/holders";
import { reviewHubForUser, type ReviewHubKind, type ReviewHubRow } from "./ReviewHubService";

/** 08:00 Asia/Dhaka, minutes from midnight (the scheduler reads server-local time = Dhaka, see its TZ check). */
export const REVIEW_BACKLOG_MINUTES = 8 * 60;

export const reviewBacklogKeys = {
  reviewer: (userId: string, dateKey: string) => `review-backlog:${userId}:${dateKey}`,
  supervisor: (supervisorId: string, dateKey: string) => `review-overdue:${supervisorId}:${dateKey}`,
} as const;

const HUB_TARGET = "ReviewTab/ReviewHub";
const SUPERVISION_TARGET = "ReviewTab/ReviewSupervision";

/** Short names for the one-line body (the hub screen carries the long titles). */
const KIND_SHORT_BN: Record<ReviewHubKind, string> = {
  PLAN: "প্ল্যান",
  QUESTION: "প্রশ্ন",
  EXAM_PAPER: "প্রশ্নপত্র",
  SYLLABUS: "সিলেবাস",
  MASTERY: "শিখনফল",
  OBSERVATION: "পর্যবেক্ষণ",
  VIDEO: "ভিডিও",
  CT_QUESTION: "ক্লাস টেস্টের প্রশ্ন",
  BOOK: "বই",
  WINTER: "শীতকালীন বুকলেট",
  TASK: "কাজ",
};

const BN_MONTHS = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

/** `2026-11-20` → `২০ নভেম্বর`. */
export function dueDayBn(dueKey: string): string {
  const [, m, d] = dueKey.split("-");
  return `${bnNum(Number(d))} ${BN_MONTHS[Number(m) - 1] ?? ""}`.trim();
}

/** Rows the reminder counts: the hub's own total leaves the school-wide winter queue out, so does this. */
const own = (rows: ReviewHubRow[]): ReviewHubRow[] => rows.filter((r) => r.kind !== "WINTER");

/** Pure: title + body from the hub rows. `null` when nothing is left. */
export function backlogMessage(rows: ReviewHubRow[], todayKey: string): { titleBn: string; bodyBn: string } | null {
  const mine = own(rows).filter((r) => r.left > 0);
  const total = mine.reduce((n, r) => n + r.left, 0);
  if (total === 0) return null;

  const byKind = new Map<ReviewHubKind, number>();
  for (const r of mine) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + r.left);
  const top = [...byKind.entries()]
    .sort((a, b) => b[1] - a[1] || KIND_SHORT_BN[a[0]].localeCompare(KIND_SHORT_BN[b[0]]))
    .slice(0, 3)
    .map(([kind, n]) => `${KIND_SHORT_BN[kind]} ${bnNum(n)}`)
    .join(" · ");

  const due = mine.map((r) => r.dueKey).filter((k): k is string => !!k).sort()[0];
  let tail = "";
  if (due) tail = due < todayKey ? " — সময় পেরিয়েছে" : ` — সবচেয়ে কাছের শেষ তারিখ ${dueDayBn(due)}`;

  return { titleBn: `আজ পর্যালোচনা বাকি: ${bnNum(total)}`, bodyBn: `${top}${tail}` };
}

/** Pure: how many review-program items (plan / question rounds) are past their due date. Manual work-board
 *  cards worded as a review are the person's own to-do, not the programme's, so they never count here. */
export function overdueCount(rows: ReviewHubRow[], todayKey: string): number {
  return rows
    .filter((r) => (r.kind === "PLAN" || r.kind === "QUESTION") && r.dueKey !== null && r.dueKey < todayKey)
    .reduce((n, r) => n + r.left, 0);
}

/** Pure: the supervisor's single line, e.g. `পর্যালোচনায় সময় পেরিয়েছে: কাওসার (৩), জেরিন (১)`. */
export function overdueLine(lines: Array<{ name: string; overdue: number }>): string {
  const sorted = [...lines].sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name));
  const shown = sorted.slice(0, 8).map((l) => `${l.name} (${bnNum(l.overdue)})`);
  const more = sorted.length - shown.length;
  return `পর্যালোচনায় সময় পেরিয়েছে: ${shown.join(", ")}${more > 0 ? ` …আরও ${bnNum(more)} জন` : ""}`;
}

export interface ReviewBacklogResult {
  reviewersNotified: number;
  supervisorsNotified: number;
}

/** One run for `dateKey` (YYYY-MM-DD, Dhaka). Idempotent per day through the emit dedupe keys. */
export async function dispatchReviewBacklog(dateKey: string): Promise<ReviewBacklogResult> {
  const users = await User.find({ active: true, role: { $nin: ["GUARDIAN", "PRINCIPAL"] } })
    .select("name role additionalTemplates grantedPermissions revokedPermissions")
    .sort({ name: 1 })
    .lean();

  const overdue: Array<{ name: string; overdue: number }> = [];
  let reviewersNotified = 0;
  let failed = 0;

  for (const u of users) {
    const id = u._id.toString();
    try {
      const hub = await reviewHubForUser(
        {
        userId: id,
        role: u.role,
        additionalTemplates: u.additionalTemplates ?? [],
        grantedPermissions: u.grantedPermissions ?? [],
        revokedPermissions: u.revokedPermissions ?? [],
        },
        { skipSchoolWide: true },
      );
      const msg = backlogMessage(hub.rows, dateKey);
      if (!msg) continue;
      const late = overdueCount(hub.rows, dateKey);
      if (late > 0) overdue.push({ name: u.name, overdue: late });
      const res = await emit({
        recipientUserId: id,
        kind: "REVIEW_ASSIGNED",
        titleBn: msg.titleBn,
        bodyBn: msg.bodyBn,
        refs: { screenTarget: HUB_TARGET, date: dateKey },
        dedupeKey: reviewBacklogKeys.reviewer(id, dateKey),
      });
      if (res.created) reviewersNotified += 1;
    } catch (err) {
      // One person's failure never stops the rest; it is counted and thrown ONCE after everyone else was sent.
      failed += 1;
      console.warn(`[reviewBacklog] ${id} skipped:`, err instanceof Error ? err.message : err);
    }
  }

  let supervisorsNotified = 0;
  if (overdue.length > 0) {
    const supervisors = await holderIdsOf("review_program:supervise");
    const line = overdueLine(overdue);
    for (const sid of supervisors) {
      const res = await emit({
        recipientUserId: sid,
        kind: "REVIEW_ASSIGNED",
        titleBn: "পর্যালোচনায় বিলম্ব",
        bodyBn: line,
        refs: { screenTarget: SUPERVISION_TARGET, date: dateKey },
        dedupeKey: reviewBacklogKeys.supervisor(sid, dateKey),
      });
      if (res.created) supervisorsNotified += 1;
    }
  }
  // Throwing keeps the scheduler's runOnce from marking the day done, so the next tick (inside the stale
  // window) retries; the dedupe keys make the people already told a no-op.
  if (failed > 0) throw new Error(`review backlog: ${failed} reviewer(s) failed, ${reviewersNotified} sent`);
  return { reviewersNotified, supervisorsNotified };
}
