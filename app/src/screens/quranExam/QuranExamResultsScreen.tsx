/**
 * QuranExamResultsScreen (D-#874) — every student's mark by level, computed on the server
 * from their sittings (Hifz: over all sittings). In progress until every sitting is done.
 */
import React from "react";
import { RefreshControl, View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { QX_RESULTS } from "../../graphql/quranExam";
import { Badge, Body, Card, H2, Muted, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, bnNum } from "../../lib/labels";
import { qxLevelLabel } from "../../lib/quranExam";
import type { QuranExamStackParamList } from "../../navigation/types";
import { space } from "../../theme";

type Props = NativeStackScreenProps<QuranExamStackParamList, "QuranExamResults">;

export default function QuranExamResultsScreen({ route }: Props): React.ReactElement {
  const [q, reexec] = useQuery({ query: QX_RESULTS, variables: { examId: route.params.examId } });
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, refetch);
  const rows = q.data?.quranExamResults ?? [];
  const levels = [...new Set(rows.map((r) => r.level))];
  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate result={q} onRetry={refetch}>
        <View style={{ gap: space(3) }}>
          {levels.map((lv) => (
            <View key={lv} style={{ gap: space(2) }}>
              <H2>{qxLevelLabel(lv)}</H2>
              {rows
                .filter((r) => r.level === lv)
                .map((r) => (
                  <Card key={r.studentId}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontWeight: "700" }}>{r.studentName}</Body>
                        <Muted>
                          {r.classLabelBn}
                          {r.tanbih != null ? ` · ${STR.qxTanbih} ${bnNum(r.tanbih)} · ${STR.qxFath} ${bnNum(r.fath ?? 0)}` : ""}
                        </Muted>
                      </View>
                      {r.absent ? <Badge text={STR.qxAbsent} tone="danger" /> : null}
                      {r.mark != null ? (
                        <Badge text={`${bnNum(r.mark)} / ${bnNum(r.fullMarks)}`} tone="ok" />
                      ) : (
                        <Badge text={STR.qxInProgress.replace("{d}", bnNum(r.done)).replace("{s}", bnNum(r.sittings))} tone="warn" />
                      )}
                    </View>
                  </Card>
                ))}
            </View>
          ))}
        </View>
      </QueryGate>
    </Screen>
  );
}
