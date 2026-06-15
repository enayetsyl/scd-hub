/**
 * ReviewerEffectivenessScreen (CO-7, observation:manage) — per-observer calibration /
 * timeliness / throughput / impact / fairness (reviewerEffectiveness). Framed as
 * PRIVATE and developmental — not an evaluation ranking.
 */
import React from "react";
import { ScrollView } from "react-native";
import { useQuery } from "urql";
import { REVIEWER_EFFECTIVENESS_QUERY } from "../../graphql/observation";
import { Screen, Card, Body, Muted, Row, Loader } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

const num1 = (v: number | null): string => (v != null ? bnNum(v.toFixed(1)) : "—");
const pct = (v: number | null): string => (v != null ? `${bnNum(Math.round(v * 100))}%` : "—");

export default function ReviewerEffectivenessScreen(): React.ReactElement {
  const [q] = useQuery({ query: REVIEWER_EFFECTIVENESS_QUERY, variables: {} });
  const rows = q.data?.reviewerEffectiveness?.observers ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.obsReviewerEffTitle}</Body>
          <Muted>{STR.obsReviewerEffNote}</Muted>
        </Card>

        {q.fetching ? (
          <Loader label={STR.loading} />
        ) : q.error ? (
          <Card>
            <Muted>{friendlyError(q.error)}</Muted>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <Muted>{STR.obsNoReviewers}</Muted>
          </Card>
        ) : (
          rows.map((r) => (
            <Card key={r.observerId}>
              <Body style={{ fontWeight: "700" }}>{r.observerName}</Body>
              <Row label={STR.obsReviewsCompleted} value={bnNum(r.reviewsCompleted)} />
              <Row label={STR.obsAvgTurnaround} value={num1(r.avgTurnaroundDays)} />
              <Row label={STR.obsBacklog} value={bnNum(r.backlog)} />
              <Row label={STR.obsCalibration} value={`${pct(r.calibrationAgreement)} (${bnNum(r.calibrationPairs)})`} />
              <Row label={STR.obsImpact} value={`${num1(r.impactAvgDomainsImproved)} (${bnNum(r.impactReReviews)})`} />
              <Row label={STR.obsAvgFairness} value={`${num1(r.avgFairness)} (${bnNum(r.ratingsReceived)})`} />
              <Row label={STR.obsAvgUsefulness} value={num1(r.avgUsefulness)} />
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
