/**
 * Review daily statistics (owner 22 Nov 2026, .claude/plans/review-daily-stats.md).
 * Own numbers: myReviewStats / myReviewStatsSummary (review_stats:view_own).
 * Anyone's or the team's: reviewStats / reviewStatsSummary / reviewStatsReviewers (review_stats:view_all).
 */
import { gql } from "urql";

export interface KindCountsT {
  chapterPlans: number;
  sessionPlans: number;
  questions: number;
  total: number;
}

export interface ReviewStatsDayT {
  /** Dhaka day, YYYY-MM-DD. */
  dayKey: string;
  counts: KindCountsT;
  /** This day minus the previous calendar day. */
  delta: KindCountsT;
}

export interface ReviewStatsPageT {
  rows: ReviewStatsDayT[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ReviewStatsSummaryT {
  todayKey: string;
  today: KindCountsT;
  yesterday: KindCountsT;
  delta: KindCountsT;
  last7Days: KindCountsT;
  allTime: KindCountsT;
}

export interface ReviewStatsReviewerT {
  id: string;
  name: string;
}

const COUNTS = "chapterPlans sessionPlans questions total";
const DAY_ROWS = `rows { dayKey counts { ${COUNTS} } delta { ${COUNTS} } } total page pageSize`;
const SUMMARY = `todayKey today { ${COUNTS} } yesterday { ${COUNTS} } delta { ${COUNTS} } last7Days { ${COUNTS} } allTime { ${COUNTS} }`;

export const MY_REVIEW_STATS = gql<{ myReviewStats: ReviewStatsPageT }, { page: number; pageSize: number }>`
  query MyReviewStats($page: Int, $pageSize: Int) {
    myReviewStats(page: $page, pageSize: $pageSize) { ${DAY_ROWS} }
  }
`;

export const MY_REVIEW_STATS_SUMMARY = gql<{ myReviewStatsSummary: ReviewStatsSummaryT }, Record<string, never>>`
  query MyReviewStatsSummary {
    myReviewStatsSummary { ${SUMMARY} }
  }
`;

export const REVIEW_STATS = gql<
  { reviewStats: ReviewStatsPageT },
  { reviewerId: string | null; page: number; pageSize: number }
>`
  query ReviewStats($reviewerId: String, $page: Int, $pageSize: Int) {
    reviewStats(reviewerId: $reviewerId, page: $page, pageSize: $pageSize) { ${DAY_ROWS} }
  }
`;

export const REVIEW_STATS_SUMMARY = gql<{ reviewStatsSummary: ReviewStatsSummaryT }, { reviewerId: string | null }>`
  query ReviewStatsSummary($reviewerId: String) {
    reviewStatsSummary(reviewerId: $reviewerId) { ${SUMMARY} }
  }
`;

export const REVIEW_STATS_REVIEWERS = gql<{ reviewStatsReviewers: ReviewStatsReviewerT[] }, Record<string, never>>`
  query ReviewStatsReviewers {
    reviewStatsReviewers { id name }
  }
`;

// Review speed / rubber-stamp flag (D-#1684): management only (review_stats:view_all or review_program:supervise).
export interface ReviewQualityKindT {
  n: number;
  medianGapSec: number | null;
  fastPct: number;
  approvePct: number;
  changesPct: number;
  silentApprovePct: number;
}

export interface ReviewQualityRowT {
  reviewerId: string;
  name: string;
  flag: "NONE" | "GREEN" | "AMBER" | "RED";
  reasonsBn: string[];
  questions: ReviewQualityKindT;
  plans: ReviewQualityKindT;
}

const QUALITY_KIND = "n medianGapSec fastPct approvePct changesPct silentApprovePct";
export const REVIEW_QUALITY = gql<{ reviewQuality: ReviewQualityRowT[] }, { days: number }>`
  query ReviewQuality($days: Int) {
    reviewQuality(days: $days) { reviewerId name flag reasonsBn questions { ${QUALITY_KIND} } plans { ${QUALITY_KIND} } }
  }
`;
