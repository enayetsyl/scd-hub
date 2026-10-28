/**
 * MyQuranExamScreen (D-#876) — "আমার পরীক্ষার দায়িত্ব": the caller's own sittings (once the
 * schedule is published), grouped by day, each opening the mark screen. Includes sittings
 * the Office moved to them on the day.
 */
import React from "react";
import { RefreshControl, View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { QX_MY_SITTINGS, type QxSittingT } from "../../graphql/quranExam";
import { Badge, Body, Card, EmptyState, H2, Muted, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, bnNum, fullDateLabel } from "../../lib/labels";
import { qxLevelLabel, qxRange } from "../../lib/quranExam";
import type { QuranExamStackParamList } from "../../navigation/types";
import { space } from "../../theme";

type Props = NativeStackScreenProps<QuranExamStackParamList, "MyQuranExam">;

export function QxStatusBadge({ s }: { s: QxSittingT }): React.ReactElement {
  if (s.status === "DONE") {
    return <Badge text={s.total != null ? `${STR.qxDone} · ${bnNum(s.total)}` : STR.qxDone} tone="ok" />;
  }
  if (s.status === "ABSENT") return <Badge text={STR.qxAbsent} tone="danger" />;
  return <Badge text={STR.qxPending} tone="warn" />;
}

export function SittingRow({ s, onPress, showExaminer }: { s: QxSittingT; onPress: () => void; showExaminer?: boolean }): React.ReactElement {
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <Body style={{ fontWeight: "700" }}>{s.studentName}</Body>
          <Muted>
            {qxRange(s.start, s.end)} · {qxLevelLabel(s.level)} · {s.portionLabel}
            {s.classLabelBn ? ` · ${s.classLabelBn}` : ""}
            {showExaminer ? ` · ${s.examinerName}` : ""}
          </Muted>
        </View>
        <QxStatusBadge s={s} />
      </View>
    </Card>
  );
}

/** The list itself — also rendered as the tab's home for a teacher who only examines. */
export function MyQuranExamList({ onOpen }: { onOpen: (id: string) => void }): React.ReactElement {
  const [q, reexec] = useQuery({ query: QX_MY_SITTINGS, variables: { fromDateKey: null } });
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, refetch);
  const rows = q.data?.myQuranExamSittings ?? [];
  const days = [...new Set(rows.map((r) => r.dateKey))];
  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate result={q} onRetry={refetch} isEmpty={!rows.length} empty={<EmptyState message={STR.qxNoSittings} />}>
        <View style={{ gap: space(3) }}>
          {days.map((d) => (
            <View key={d} style={{ gap: space(2) }}>
              <H2>{fullDateLabel(d)}</H2>
              {rows
                .filter((r) => r.dateKey === d)
                .map((r) => (
                  <SittingRow key={r.id} s={r} onPress={() => onOpen(r.id)} />
                ))}
            </View>
          ))}
        </View>
      </QueryGate>
    </Screen>
  );
}

export default function MyQuranExamScreen({ navigation }: Props): React.ReactElement {
  return <MyQuranExamList onOpen={(id) => navigation.navigate("QuranExamSitting", { id })} />;
}
