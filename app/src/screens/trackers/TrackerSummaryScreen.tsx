/**
 * TrackerSummaryScreen (S12 / J4.4) — aggregate stats for a tracker (total
 * entries, submitted/complete counts, average score). Read-only; supervisory
 * teachers can view (read-scope).
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { TRACKER_SUMMARY_QUERY } from "../../graphql/operations";
import type { TrackersStackParamList } from "../../navigation/types";
import { Screen, H2, Card, Row, Loader, ErrorBanner, Notice } from "../../components/ui";
import { STR, trackerKindLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";

type Props = NativeStackScreenProps<TrackersStackParamList, "TrackerSummary">;

export default function TrackerSummaryScreen({ route }: Props): React.ReactElement {
  const { trackerId } = route.params;
  const [{ data, fetching, error }, refetch] = useQuery({
    query: TRACKER_SUMMARY_QUERY,
    variables: { trackerId },
  });

  if (fetching) return <Loader label={STR.loading} />;
  if (error) {
    return (
      <Screen>
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      </Screen>
    );
  }
  const s = data?.trackerSummary;
  if (!s) {
    return (
      <Screen>
        <Notice message={STR.empty} tone="warn" />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <H2>{STR.trackerSummary}</H2>
      <Card>
        <Row label={STR.kind} value={trackerKindLabel(s.trackerKind)} />
        <Row label={STR.totalEntries} value={bnNum(s.totalEntries)} />
        <Row label={STR.submittedCount} value={bnNum(s.submittedCount)} />
        <Row label={STR.completeCount} value={bnNum(s.completeCount)} />
        <Row label={STR.averageScore} value={s.averageScore != null ? bnNum(s.averageScore.toFixed(1)) : "—"} />
      </Card>
    </Screen>
  );
}
