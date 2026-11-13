/**
 * WinterBookletsScreen (D-#1620) — the winter-holiday booklets, one card per class.
 * winter_task:review sees all six and the count of her own open suggestions;
 * winter_task:manage (the Principal) sees everyone's.
 */
import React from "react";
import { RefreshControl, View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { WINTER_BOOKLETS_QUERY, type WinterBookletRowT } from "../../graphql/winterTask";
import { Badge, Body, Button, Card, EmptyState, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, bnNum } from "../../lib/labels";
import type { WinterTaskStackParamList } from "../../navigation/types";
import { space } from "../../theme";

type Props = NativeStackScreenProps<WinterTaskStackParamList, "WinterBooklets">;

export function winterStatusLabel(status: string): string {
  return status === "APPROVED" ? STR.wtStApproved : status === "DRAFT" ? STR.wtStDraft : STR.wtStReview;
}

function Row({ b, onOpen }: { b: WinterBookletRowT; onOpen: () => void }): React.ReactElement {
  return (
    <Card onPress={onOpen} style={{ marginBottom: space(3) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Body style={{ fontWeight: "700" }}>{b.classLabelBn}</Body>
          <Muted>
            {b.titleBn}
            {" · "}
            {STR.wtPagesN.replace("{n}", bnNum(b.pageCount))}
          </Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
            <Badge text={winterStatusLabel(b.status)} tone={b.status === "APPROVED" ? "ok" : "info"} />
            <Badge text={STR.wtOpenN.replace("{n}", bnNum(b.openChanges))} tone={b.openChanges > 0 ? "warn" : "muted"} />
            {b.acceptedChanges > 0 ? <Badge text={STR.wtAcceptedN.replace("{n}", bnNum(b.acceptedChanges))} tone="ok" /> : null}
          </View>
        </View>
        <Button title={STR.wtOpenBook} variant="secondary" onPress={onOpen} />
      </View>
    </Card>
  );
}

export default function WinterBookletsScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const manage = can("winter_task:manage");
  const [q, refetch] = useQuery({ query: WINTER_BOOKLETS_QUERY, requestPolicy: "cache-and-network" });
  const reload = (): void => refetch({ requestPolicy: "network-only" });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, reload);
  const books = q.data?.winterBooklets ?? [];
  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Notice tone="info" message={manage ? STR.wtHintManage : STR.wtHintReview} />
      <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
        {books.length === 0 ? (
          <EmptyState message={STR.wtEmpty} />
        ) : (
          <View style={{ marginTop: space(3) }}>
            {books.map((b) => (
              <Row key={b.id} b={b} onOpen={() => navigation.navigate("WinterBooklet", { bookletId: b.id, title: b.classLabelBn })} />
            ))}
          </View>
        )}
      </QueryGate>
    </Screen>
  );
}
