/**
 * VocabReportScreen (VC-5 / J5) — the per-test report (tracker:read): class roll-up
 * (present/absent + average, ABSENT excluded §4), each student's derived score (tap →
 * the per-student dashboard), and the most-missed words. All DERIVED server-side (D-#85).
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { VOCAB_TEST_REPORT_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Badge, Chip, Loader, Notice } from "../../components/ui";
import { STR, bnNum, vocabDirectionLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { VocabStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<VocabStackParamList, "VocabReport">;
type Nav = NativeStackNavigationProp<VocabStackParamList>;

export default function VocabReportScreen({ route }: Props): React.ReactElement {
  const { testId } = route.params;
  const nav = useNavigation<Nav>();
  const [reportQ] = useQuery({ query: VOCAB_TEST_REPORT_QUERY, variables: { testId } });
  const report = reportQ.data?.vocabTestReport ?? null;

  if (reportQ.fetching) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!report) {
    return (
      <Screen>
        <Notice message={STR.vbNoReportData} tone="info" />
      </Screen>
    );
  }

  const r = report.rollup;
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{report.test.label}</Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), marginTop: space(2) }}>
            <Muted>
              {STR.vbPresentCount}: {bnNum(r.presentCount)}
            </Muted>
            <Muted>
              {STR.vbAbsentCount}: {bnNum(r.absentCount)}
            </Muted>
            <Muted>
              {STR.vbAvgScore}: {bnNum(r.averageScore)}/{bnNum(r.averageTotal)}
            </Muted>
          </View>
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.vbStudentsHeading}</Body>
          {report.students.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.vbNoReportData}</Muted>
          ) : (
            report.students.map((s) => (
              <View
                key={s.studentId}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Body>
                    {s.status === "ABSENT"
                      ? STR.vbAbsent
                      : `${STR.vbScore}: ${bnNum(s.score ?? 0)}/${bnNum(s.totalMarks)} · ${STR.vbWrongCount} ${bnNum(s.wrongCount ?? 0)}`}
                  </Body>
                  <Muted>{s.studentId}</Muted>
                </View>
                <Chip
                  label={STR.vbViewStudent}
                  onPress={() => nav.navigate("VocabStudentReport", { studentId: s.studentId, studentName: s.studentId, program: report.test.program })}
                />
              </View>
            ))
          )}
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.vbMostMissed}</Body>
          {report.mostMissed.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.empty}</Muted>
          ) : (
            report.mostMissed.map((w) => (
              <View
                key={w.wordId}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Body>
                    {w.headword} — {w.banglaMeaning}
                  </Body>
                  <Muted>
                    {w.directions.map(vocabDirectionLabel).join(", ")} · {bnNum(w.missedBy)} ({bnNum(Math.round(w.missedPct * 100))}%)
                  </Muted>
                </View>
                {w.flagged ? <Badge text={STR.vbFlagged} tone="warn" /> : null}
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
