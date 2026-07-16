/**
 * VocabStudentReportScreen (VC-5 / J5) — a student's vocab dashboard (tracker:read):
 * per-test history, roll-up, persistent weak words (admin threshold, default 2), and a
 * cumulative period roll-up with a Weekly/Monthly/Last-N toggle (§9). All DERIVED (D-#85).
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { VOCAB_STUDENT_DASHBOARD_QUERY, VOCAB_STUDENT_CUMULATIVE_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Badge, Chip } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, vocabProgramLabel, vocabCumulativeModeLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { VocabStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<VocabStackParamList, "VocabStudentReport">;
const MODES = ["WEEKLY", "MONTHLY", "LAST_N"] as const;

export default function VocabStudentReportScreen({ route }: Props): React.ReactElement {
  const { studentId, studentName, program } = route.params;
  const [mode, setMode] = useState<(typeof MODES)[number]>("WEEKLY");

  const [dashQ, refetchDash] = useQuery({
    query: VOCAB_STUDENT_DASHBOARD_QUERY,
    variables: { studentId, program: program ?? null },
  });
  const dash = dashQ.data?.vocabStudentDashboard ?? null;
  const [cumQ, refetchCum] = useQuery({
    query: VOCAB_STUDENT_CUMULATIVE_QUERY,
    variables: { studentId, program: program ?? null, mode },
  });
  const cum = cumQ.data?.vocabStudentCumulative ?? null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <QueryGate
          result={dashQ}
          onRetry={() => {
            refetchDash({ requestPolicy: "network-only" });
            refetchCum({ requestPolicy: "network-only" });
          }}
          loaderLabel={STR.loading}
        >
          <Card>
            <Body style={{ fontWeight: "700" }}>{studentName}</Body>
            {dash ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), marginTop: space(2) }}>
                <Muted>
                  {STR.vbAvgScore}: {bnNum(dash.rollup.averageScore)}/{bnNum(dash.rollup.averageTotal)}
                </Muted>
                <Muted>
                  {STR.vbPresentCount}: {bnNum(dash.rollup.presentCount)} · {STR.vbAbsentCount}: {bnNum(dash.rollup.absentCount)}
                </Muted>
              </View>
            ) : null}
          </Card>

          {/* Persistent weak words */}
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.vbPersistentWords}</Body>
            {(dash?.persistentWords ?? []).length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.empty}</Muted>
            ) : (
              dash!.persistentWords.map((w) => (
                <View key={w.wordId} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}>
                  <Body style={{ flexShrink: 1 }}>
                    {w.headword} — {w.banglaMeaning}
                  </Body>
                  <Badge text={`${bnNum(w.missCount)}×`} tone="warn" />
                </View>
              ))
            )}
          </Card>

          {/* Cumulative period */}
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.vbCumulative}</Body>
            <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
              {MODES.map((m) => (
                <Chip key={m} label={vocabCumulativeModeLabel(m)} selected={mode === m} onPress={() => setMode(m)} />
              ))}
            </View>
            <QueryGate
              result={cumQ}
              onRetry={() => {
                refetchDash({ requestPolicy: "network-only" });
                refetchCum({ requestPolicy: "network-only" });
              }}
              loaderLabel={STR.loading}
            >
              {cum ? (
                <View style={{ marginTop: space(2) }}>
                  <Muted>
                    {cum.periodLabel} · {STR.vbNumTests}: {bnNum(cum.numTests)} · {STR.vbAvgScore}:{" "}
                    {bnNum(cum.rollup.averageScore)}/{bnNum(cum.rollup.averageTotal)}
                  </Muted>
                </View>
              ) : null}
            </QueryGate>
          </Card>

          {/* Per-test history */}
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.vbPerTest}</Body>
            {(dash?.perTest ?? []).length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.vbNoReportData}</Muted>
            ) : (
              dash!.perTest.map((e) => (
                <View key={e.test.testId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body>
                      {vocabProgramLabel(e.test.program)} · {e.test.label}
                    </Body>
                    <Muted>{new Date(e.test.testDate).toLocaleDateString()}</Muted>
                  </View>
                  <Badge
                    text={
                      e.result.status === "ABSENT"
                        ? STR.vbAbsent
                        : `${bnNum(e.result.score ?? 0)}/${bnNum(e.result.totalMarks)}`
                    }
                    tone={e.result.status === "ABSENT" ? "muted" : "ok"}
                  />
                </View>
              ))
            )}
          </Card>
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
