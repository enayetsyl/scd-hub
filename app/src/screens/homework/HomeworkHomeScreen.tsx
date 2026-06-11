/**
 * HomeworkHomeScreen (§8.1/§8.3) — the section-aware daily homework dashboard.
 * Shows today's declarations + live DAY_TOTAL vs the 240-min ceiling, the chase
 * list with §7.2 attention/comms badges, open resubmissions, completion health,
 * and touches-per-topic. Hub to Declare / Reconcile / Checking.
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { HOMEWORK_DAY_TALLY, HOMEWORK_SUMMARY } from "../../graphql/operations";
import type { HomeworkStackParamList } from "../../navigation/types";
import {
  Screen,
  Body,
  Muted,
  Card,
  Badge,
  Button,
  Field,
  Loader,
  EmptyState,
  ErrorBanner,
} from "../../components/ui";
import { SectionBar } from "../../components/SectionBar";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space, colors } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeworkStackParamList, "HomeworkHome">;

const today = (): string => new Date().toISOString().slice(0, 10);

export default function HomeworkHomeScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [date, setDate] = useState(today());

  const vars = { sectionId: selection.sectionId ?? "", classId: selection.classId ?? "", date };
  const [tallyQ, refetchTally] = useQuery({ query: HOMEWORK_DAY_TALLY, variables: vars, pause: !hasSection });
  const [sumQ] = useQuery({
    query: HOMEWORK_SUMMARY,
    variables: { sectionId: vars.sectionId, classId: vars.classId },
    pause: !hasSection,
  });

  const tally = tallyQ.data?.homeworkDayTally;
  const summary = sumQ.data?.homeworkSummary;
  const over = tally ? !tally.withinCeiling : false;

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <SectionBar onChange={() => navigation.navigate("SectionPicker")} />
        {hasSection ? (
          <Field label={STR.hwDate} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : tallyQ.error ? (
          <ErrorBanner message={friendlyError(tallyQ.error)} onRetry={() => refetchTally({ requestPolicy: "network-only" })} />
        ) : tallyQ.fetching && !tally ? (
          <Loader label={STR.loading} />
        ) : (
          <>
            {/* Day total vs ceiling */}
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{STR.hwDayTotal}</Body>
                <Badge
                  text={`${bnNum(tally?.dayTotal ?? 0)} / ${bnNum(tally?.ceiling ?? 240)} ${STR.hwMinutes}`}
                  tone={over ? "danger" : "ok"}
                />
              </View>
              <Muted style={{ marginTop: 4 }}>
                {over ? `${STR.hwOverCeiling} · ${STR.hwOverBy} ${bnNum(tally?.overBy ?? 0)} ${STR.hwMinutes}` : STR.hwWithinCeiling}
              </Muted>
            </Card>

            {/* Declarations */}
            {(tally?.items ?? []).length === 0 ? (
              <EmptyState message={STR.empty} />
            ) : (
              (tally?.items ?? []).map((it) => (
                <Card key={it.itemId}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700" }}>{hwSubjectLabel(it.subject)}</Body>
                    <Badge text={it.status === "issued" ? STR.hwIssued : STR.hwDeclared} tone={it.status === "issued" ? "ok" : "muted"} />
                  </View>
                  <Muted style={{ marginTop: 4 }}>
                    {it.hwId} · {bnNum(it.timeDecl)} {STR.hwMinutes} · {bnNum(it.qCount)} {STR.questionsWord}
                  </Muted>
                  {it.bandWarning ? <Muted style={{ color: colors.warn, marginTop: 2 }}>{STR.hwBandWarning}</Muted> : null}
                </Card>
              ))
            )}

            {/* Summary roll-ups */}
            {summary ? (
              <Card>
                <Body style={{ fontWeight: "700", marginBottom: 6 }}>{STR.trackerSummary}</Body>
                <SummaryRow label={STR.hwOpenResubmissions} value={bnNum(summary.openResubmissions)} />
                <SummaryRow
                  label={STR.hwOnTimePct}
                  value={summary.submittedOnTimePct == null ? "—" : `${bnNum(summary.submittedOnTimePct)}%`}
                />
                <SummaryRow label={STR.hwChaseVolume} value={bnNum(summary.chaseVolume)} />
                <SummaryRow
                  label={STR.hwReturnLatency}
                  value={summary.avgReturnLatencyDays == null ? "—" : bnNum(summary.avgReturnLatencyDays)}
                />
                {summary.chaseList.length > 0 ? (
                  <>
                    <Muted style={{ marginTop: 8, fontWeight: "700" }}>{STR.hwChaseList}</Muted>
                    {summary.chaseList.map((c) => (
                      <View key={c.recordId} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                        <Muted>{c.hwId}</Muted>
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          <Badge text={`${STR.trackerEntry} ${bnNum(c.chaseCount)}`} tone="muted" />
                          {c.commsPrompt ? <Badge text={STR.hwCommsPrompt} tone="danger" /> : c.attention ? <Badge text={STR.hwAttention} tone="warn" /> : null}
                        </View>
                      </View>
                    ))}
                  </>
                ) : null}
                {summary.topicTouches.length > 0 ? (
                  <>
                    <Muted style={{ marginTop: 8, fontWeight: "700" }}>{STR.hwTopicTouches}</Muted>
                    {summary.topicTouches.slice(0, 8).map((tt) => (
                      <View key={tt.topTag} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                        <Muted>{tt.topTag}</Muted>
                        <Muted>{bnNum(tt.count)}</Muted>
                      </View>
                    ))}
                  </>
                ) : null}
              </Card>
            ) : null}

            {/* Actions */}
            <View style={{ gap: space(2), marginTop: space(2) }}>
              <Button title={STR.hwDeclare} onPress={() => navigation.navigate("DeclareHomework")} />
              <Button title={STR.hwReconcile} variant="secondary" onPress={() => navigation.navigate("HomeworkReconcile")} />
              <Button title={STR.hwChecking} variant="secondary" onPress={() => navigation.navigate("CheckingQueue")} />
              <Button title={STR.hwRollups} variant="secondary" onPress={() => navigation.navigate("HomeworkRollups")} />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
      <Muted>{label}</Muted>
      <Body>{value}</Body>
    </View>
  );
}
