/**
 * AI usage & comment quality (AI-7, D-#1140) — mirror server/src/modules/platform/resolvers/aiUsageReport.ts.
 * `reports:ai_usage` (Principal by default).
 */
import { gql } from "urql";

export interface AiUsageBucketT {
  key: string;
  label: string;
  calls: number;
  usd: number;
  capped: number;
  errors: number;
}

export interface AiUsageReportT {
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
  byDay: AiUsageBucketT[];
  byPerson: AiUsageBucketT[];
  byFeature: AiUsageBucketT[];
  byModel: AiUsageBucketT[];
  budget: Array<{ scope: string; label: string; spentUsd: number; capUsd: number; projectedUsd: number; pct: number }>;
  quality: Array<{
    userId: string;
    name: string;
    checks: number;
    issuesFound: number;
    issuesAccepted: number;
    overrode: number;
    notChecked: number;
    acceptanceRate: number | null;
    overrideRate: number | null;
    issueTypes: Array<{ type: string; count: number }>;
  }>;
}

const B = "key label calls usd capped errors";

export const AI_USAGE_REPORT = gql<{ aiUsageReport: AiUsageReportT }, { fromKey: string; toKey: string }>`
  query AiUsageReport($fromKey: String!, $toKey: String!) {
    aiUsageReport(fromKey: $fromKey, toKey: $toKey) {
      fromKey toKey
      totals { usd calls capped errors fallbacks cacheHitRate avgCostPerCheckUsd avgCostPerTurnUsd notChecked checked }
      byDay { ${B} } byPerson { ${B} } byFeature { ${B} } byModel { ${B} }
      budget { scope label spentUsd capUsd projectedUsd pct }
      quality { userId name checks issuesFound issuesAccepted overrode notChecked acceptanceRate overrideRate issueTypes { type count } }
    }
  }
`;
