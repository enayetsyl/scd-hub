/**
 * FinanceHomeScreen (FIN-6B app surfaces) — the Finance/Accounting tab hub.
 * The whole tab is gated by finance:manage (Principal/Office); every sub-screen
 * action is re-gated server-side — its Bangla deny surfaces inline if reached.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen, Card, Body, Button } from "../../components/ui";
import { STR } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { FinanceStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<FinanceStackParamList>;

export default function FinanceHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finHomeTitle}</Body>
          <View style={{ marginTop: space(2), gap: space(2) }}>
            <Button title={STR.finDailyEntryNav} onPress={() => nav.navigate("DailyEntry")} />
            <Button title={STR.finSnapshotNav} variant="secondary" onPress={() => nav.navigate("DailySnapshot")} />
            <Button title={STR.finFeesZakatNav} variant="secondary" onPress={() => nav.navigate("FeesZakat")} />
            <Button title={STR.finQardIouNav} variant="secondary" onPress={() => nav.navigate("QardIou")} />
            <Button title={STR.finReconNav} variant="secondary" onPress={() => nav.navigate("Reconciliation")} />
            <Button title={STR.finBudgetNav} variant="secondary" onPress={() => nav.navigate("Budget")} />
            <Button title={STR.finDashboardNav} variant="ghost" onPress={() => nav.navigate("FinanceDashboard")} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
