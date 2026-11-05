/**
 * StaffMistakeSummaryScreen — কর্মীর ভুলের হিসাব (D-#942, docs/prd-staff-mistakes.md §9):
 * per person over the last 30 / 90 days — counted (and weighted), waiting, accepted, where
 * it happens most, and the warning step reached. Tap a row for that person's record.
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { STAFF_MISTAKE_SUMMARY, type StaffMistakeSummaryRowT } from "../../graphql/staffMistakes";
import type { HrStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Chip, ChipRow, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { dhakaWhen, staffMistakeKindLabel, staffWarningStepLabel } from "../../lib/staffMistakeLabels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "StaffMistakeSummary">;

const fmt = (n: number): string => bnNum(Math.round(n * 10) / 10);

function StatusBadge({ r }: { r: StaffMistakeSummaryRowT }): React.ReactElement {
  if (r.warningStep) {
    const when = r.meetingAt ? ` · ${dhakaWhen(r.meetingAt)}` : "";
    return <Badge text={`${staffWarningStepLabel(r.warningStep)}${when}`} tone="danger" />;
  }
  if (r.weighted >= Math.max(1, r.nextThreshold - 1)) {
    return <Badge text={STR.smsNear.replace("{n}", fmt(r.weighted)).replace("{max}", bnNum(r.nextThreshold))} tone="warn" />;
  }
  return <Badge text={STR.smsFine} tone="ok" />;
}

export default function StaffMistakeSummaryScreen({ navigation }: Props): React.ReactElement {
  const [days, setDays] = React.useState(30);
  const [q, refetch] = useQuery({ query: STAFF_MISTAKE_SUMMARY, variables: { days }, requestPolicy: "cache-and-network" });
  const s = q.data?.staffMistakeSummary;

  return (
    <Screen scroll>
      <H2>{STR.smsTitle}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.smsHelp}</Muted>
      <ChipRow>
        <Chip label={STR.smsDays30} selected={days === 30} onPress={() => setDays(30)} />
        <Chip label={STR.smsDays90} selected={days === 90} onPress={() => setDays(90)} />
      </ChipRow>
      {q.fetching && !s ? (
        <Loader label={STR.loading} />
      ) : q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : !s || s.rows.length === 0 ? (
        <EmptyState message={STR.smsEmpty} />
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginVertical: space(2) }}>
            <Badge text={`${STR.smsCounted} · ${bnNum(s.totals.counted)}`} tone="danger" />
            <Badge text={`${STR.smsPending} · ${bnNum(s.totals.pending)}`} tone="warn" />
            <Badge text={`${STR.smsExcused} · ${bnNum(s.totals.excused)}`} tone="info" />
            <Badge text={`${STR.smsWarnings} · ${bnNum(s.totals.warnings)}`} tone="muted" />
          </View>
          {s.rows.map((r) => (
            <Card key={r.staffUserId} onPress={() => navigation.navigate("PersonMistakes", { staffUserId: r.staffUserId, name: r.staffName })}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
                <Body style={{ fontWeight: "700", flexShrink: 1 }}>{r.staffName}</Body>
                <StatusBadge r={r} />
              </View>
              <Muted>
                {STR.smsCounted} {bnNum(r.counted)}
                {r.weighted !== r.counted ? ` (${fmt(r.weighted)})` : ""} · {STR.smsPending} {bnNum(r.pending)} · {STR.smsExcused} {bnNum(r.excused)}
              </Muted>
              {r.topKind ? <Muted>{STR.smsTopKind}: {staffMistakeKindLabel(r.topKind)}</Muted> : null}
            </Card>
          ))}
          {s.byKind.length > 0 ? (
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.smsByKind}</Body>
              {s.byKind.map((k) => (
                <View key={k.kind} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(1) }}>
                  <Body style={{ flexShrink: 1 }}>{staffMistakeKindLabel(k.kind)}</Body>
                  <Body style={{ fontWeight: "700" }}>{bnNum(k.counted)}</Body>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
