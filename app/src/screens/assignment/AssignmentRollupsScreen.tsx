/**
 * AssignmentRollupsScreen (AS-T5, AJ-7) — delivery rate vs scheduled
 * (suspended weeks excluded), submission rate, chase volume, checking
 * latency, open resubmissions, D-#34 thresholds. A TEACHER's view is
 * self-scoped server-side.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { AS_SUMMARY, TEACHERS_QUERY, CLASSES_QUERY, type AsRateRowT } from "../../graphql/operations";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "AssignmentRollups">;

function RateTable({ title, rows, nameOf }: { title: string; rows: AsRateRowT[]; nameOf: (k: string) => string }): React.ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <Card>
      <Body style={{ fontWeight: "700", marginBottom: 4 }}>{title}</Body>
      {rows.map((r) => (
        <View key={r.key} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
          <Body style={{ flexShrink: 1 }}>{nameOf(r.key)}</Body>
          <Muted>
            {bnNum(r.delivered)}/{bnNum(r.scheduled)}
            {r.deliveryRatePct !== null ? ` (${bnNum(r.deliveryRatePct)}%)` : ""}
          </Muted>
        </View>
      ))}
    </Card>
  );
}

export default function AssignmentRollupsScreen({ route }: Props): React.ReactElement {
  const { academicYearId } = route.params;
  const [summaryQ] = useQuery({ query: AS_SUMMARY, variables: { academicYearId }, pause: !academicYearId });
  // Same trap as the schedule editor: `users` needs user:manage (Principal only), so an
  // Office or teacher reading these rollups saw raw ObjectIds where names belong.
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });
  const [classesQ] = useQuery({ query: CLASSES_QUERY, variables: { academicYearId }, pause: !academicYearId });

  const s = summaryQ.data?.assignmentSummary ?? null;
  const teacherName = (id: string): string => (teachersQ.data?.teachers ?? []).find((u) => u.id === id)?.name ?? id;
  const className = (id: string): string => (classesQ.data?.classes ?? []).find((c) => c.id === id)?.nameBn ?? id;
  const weekName = (k: string): string => `${STR.asWeek} ${bnNum(k)}`;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {summaryQ.fetching ? (
          <Loader label={STR.loading} />
        ) : summaryQ.error ? (
          <Notice message={friendlyError(summaryQ.error)} tone="danger" />
        ) : !s ? (
          <EmptyState message={STR.empty} />
        ) : (
          <>
            <Card>
              <Body style={{ fontWeight: "700", marginBottom: 4 }}>
                {STR.asWeek} {bnNum(s.weekFrom)}–{bnNum(s.weekTo)}
              </Body>
              <Muted>
                {STR.asDeliveryRate}: {bnNum(s.deliveredTotal)}/{bnNum(s.scheduledTotal)}
              </Muted>
              {s.submissionRatePct !== null ? (
                <Muted>
                  {STR.asSubmissionRate}: {bnNum(s.submissionRatePct)}%
                </Muted>
              ) : null}
              <Muted>
                {STR.asChaseVolume}: {bnNum(s.chaseVolume)} · {STR.asOpenResubs}: {bnNum(s.openResubmissions)}
              </Muted>
              {s.avgCheckingLatencyDays !== null ? (
                <Muted>
                  {STR.asLatency}: {bnNum(s.avgCheckingLatencyDays)}
                </Muted>
              ) : null}
              <Muted>
                {STR.asAttention}: {bnNum(s.attentionStudentIds.length)} · {STR.asCommsPrompt}: {bnNum(s.commsPromptStudentIds.length)}
              </Muted>
              {s.suspendedWeeks.length > 0 ? (
                <Muted>
                  {STR.asSuspendedWeeks}: {s.suspendedWeeks.map((w) => bnNum(w)).join(", ")}
                </Muted>
              ) : null}
            </Card>
            <RateTable title={STR.asByTeacher} rows={s.byTeacher} nameOf={teacherName} />
            <RateTable title={STR.asByClass} rows={s.byClass} nameOf={className} />
            <RateTable title={STR.asByWeek} rows={s.byWeek} nameOf={weekName} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
