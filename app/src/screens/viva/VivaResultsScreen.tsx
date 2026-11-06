/**
 * VivaResultsScreen (D-#1072/#1074, mockup screen 9) — every child's oral total on one
 * paper: absent counts 0 and shows "অনু.", unfinished shows "—". Live: refreshes every
 * 15 s. Joining the oral with the written marks waits for written-mark entry (EX-2/EX-3).
 */
import React from "react";
import { RefreshControl, View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { VIVA_SHEET, vivaNum } from "../../graphql/viva";
import { Badge, Body, Card, Muted, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, bnNum } from "../../lib/labels";
import type { VivaStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { vivaProgressLine } from "./VivaHomeScreen";

type Props = NativeStackScreenProps<VivaStackParamList, "VivaResults">;

export default function VivaResultsScreen({ route }: Props): React.ReactElement {
  const [q, reexec] = useQuery({ query: VIVA_SHEET, variables: { paperId: route.params.paperId } });
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, refetch);
  React.useEffect(() => {
    const id = setInterval(refetch, 15_000);
    return () => clearInterval(id);
  }, [refetch]);
  const sheet = q.data?.vivaSheet;
  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate result={q} onRetry={refetch}>
        {sheet ? (
          <View style={{ gap: space(2) }}>
            <Body style={{ fontWeight: "700" }}>
              {sheet.paper.classLabelBn} · {sheet.paper.subjectLabelBn} · {STR.vivaFull.replace("{n}", vivaNum(sheet.paper.fullMarks))}
            </Body>
            <Muted>{vivaProgressLine(sheet.paper)}</Muted>
            {sheet.paper.lockedAt ? <Badge text={STR.vivaLockedBadge} tone="danger" /> : null}
            {sheet.rows.map((r) => (
              <Card key={r.studentId}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                  <Muted style={{ width: 28 }}>{r.roll ? bnNum(r.roll) : ""}</Muted>
                  <View style={{ flex: 1 }}>
                    <Body>{r.name}</Body>
                    <Muted>{r.examinerName ? STR.vivaExaminerOf.replace("{name}", r.examinerName) : STR.vivaNoExaminer}</Muted>
                  </View>
                  {r.absent ? (
                    <Badge text={STR.vivaAbsShort} tone="danger" />
                  ) : r.done ? (
                    <Badge text={`${vivaNum(r.total)}/${vivaNum(sheet.paper.fullMarks)}`} tone="ok" />
                  ) : r.marks.length ? (
                    <Badge text={`${vivaNum(r.total)}…`} tone="warn" />
                  ) : (
                    <Muted>{STR.vivaNotYet}</Muted>
                  )}
                </View>
              </Card>
            ))}
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
