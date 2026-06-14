/**
 * ClassTestStudentProfileScreen (CT-5 / J6) — one student across subjects: a
 * per-subject roll-up (avg / latest / trend) + the full per-exam result list (newest
 * first). Staff read (tracker:read; teacher scoped to the student's section
 * server-side). %/pass-fail are derived server-side (D-#85).
 */
import React from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { CLASS_TEST_STUDENT_PROFILE_QUERY } from "../../graphql/classTest";
import { Screen, Card, Body, Muted, Badge, Loader, Notice } from "../../components/ui";
import { STR, hwSubjectLabel, ctTrendGlyph, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassTestStackParamList, "ClassTestStudentProfile">;

export default function ClassTestStudentProfileScreen({ route }: Props): React.ReactElement {
  const { studentId, studentName } = route.params;
  const [q] = useQuery({ query: CLASS_TEST_STUDENT_PROFILE_QUERY, variables: { studentId } });
  const p = q.data?.classTestStudentProfile ?? null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{p?.studentName || studentName}</Body>
        </Card>

        {q.error ? (
          <Notice message={friendlyError(q.error)} tone="danger" />
        ) : q.fetching ? (
          <Loader label={STR.loading} />
        ) : !p || p.results.length === 0 ? (
          <Card>
            <Muted>{STR.ctNoProfile}</Muted>
          </Card>
        ) : (
          <>
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.ctBySubject}</Body>
              {p.bySubject.map((b) => (
                <View
                  key={b.subject}
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}
                >
                  <View style={{ flexShrink: 1 }}>
                    <Body>{hwSubjectLabel(b.subject)}</Body>
                    <Muted>
                      {STR.ctAvgPercent} {b.avgPercent == null ? "—" : `${bnNum(b.avgPercent)}%`} · {STR.ctExamsTaken}{" "}
                      {bnNum(b.examsTaken)}
                    </Muted>
                  </View>
                  <Badge
                    text={`${ctTrendGlyph(b.trend)} ${b.latestPercent == null ? "" : bnNum(b.latestPercent) + "%"}`}
                    tone={b.trend === "up" ? "ok" : b.trend === "down" ? "danger" : "muted"}
                  />
                </View>
              ))}
            </Card>

            {p.results.map((r) => (
              <Card key={r.testId}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>
                      {hwSubjectLabel(r.subject)} · {STR.ctTestNumber} {bnNum(r.testNumber)}
                    </Body>
                    <Muted>
                      {r.ctId} · {new Date(r.examDate).toLocaleDateString()}
                    </Muted>
                  </View>
                  {r.status === "ABSENT" ? (
                    <Badge text={STR.ctAbsent} tone="muted" />
                  ) : (
                    <Badge
                      text={`${bnNum(r.marks ?? 0)}/${bnNum(r.totalMarks)} · ${r.percent == null ? "" : bnNum(r.percent) + "%"}`}
                      tone={r.pass ? "ok" : "danger"}
                    />
                  )}
                </View>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
