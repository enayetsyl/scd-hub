/**
 * DailySnapshotScreen (FIN-2A, finance:manage) — the per-ledger opening / in / out /
 * closing for a chosen date (financeDailySnapshot). The snapshot's `in` field is a JS
 * keyword aliased to `moneyIn` in the gql query.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { FINANCE_DAILY_SNAPSHOT_QUERY } from "../../graphql/finance";
import { Screen, Card, Body, Muted, Button, Field, Row, Divider, Loader } from "../../components/ui";
import { STR, ledgerKindLabel, money } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function DailySnapshotScreen(): React.ReactElement {
  const [date, setDate] = useState("");
  const [active, setActive] = useState("");

  const [snapQ] = useQuery({
    query: FINANCE_DAILY_SNAPSHOT_QUERY,
    variables: { date: active },
    pause: !active,
  });
  const snap = snapQ.data?.financeDailySnapshot ?? null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Field label={STR.finDate} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
          <Button title={STR.finLoad} variant="secondary" onPress={() => setActive(date.trim())} />
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finSnapshotTitle}</Body>
          {snapQ.fetching ? (
            <Loader label={STR.loading} />
          ) : snapQ.error ? (
            <Muted style={{ marginTop: space(2) }}>{friendlyError(snapQ.error)}</Muted>
          ) : !snap ? (
            <Muted style={{ marginTop: space(2) }}>{STR.finNone}</Muted>
          ) : (
            snap.ledgers.map((l) => (
              <View key={l.ledger} style={{ marginTop: space(2) }}>
                <Body style={{ fontWeight: "700" }}>{ledgerKindLabel(l.ledger)}</Body>
                <Row label={STR.finOpening} value={money(l.opening)} />
                <Row label={STR.finIn} value={money(l.moneyIn)} />
                <Row label={STR.finOut} value={money(l.out)} />
                <Row label={STR.finClosing} value={money(l.closing)} />
                <Divider />
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
