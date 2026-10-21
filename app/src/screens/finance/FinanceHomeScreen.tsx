/**
 * FinanceHomeScreen (FIN-6B app surfaces) — the Finance/Accounting tab hub.
 * PM (D-#790..#801): finance:manage split into six features; each entry here shows
 * only to a holder of that screen's action, and every sub-screen action is re-gated
 * server-side — its Bangla deny surfaces inline if reached.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen, Card, Body, Button } from "../../components/ui";
import { STR } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { FinanceStackParamList } from "../../navigation/types";
import { useAuth } from "../../auth/AuthContext";

type Nav = NativeStackNavigationProp<FinanceStackParamList>;

export default function FinanceHomeScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const { can } = useAuth();
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.finHomeTitle}</Body>
          <View style={{ marginTop: space(2), gap: space(2) }}>
            {can("finance_ledger:create") ? (
              <Button title={STR.finDailyEntryNav} onPress={() => nav.navigate("DailyEntry")} />
            ) : null}
            {can("finance_ledger:view") ? (
              <Button title={STR.finSnapshotNav} variant="secondary" onPress={() => nav.navigate("DailySnapshot")} />
            ) : null}
            {can("fee_support:view") ? (
              <Button title={STR.finFeesZakatNav} variant="secondary" onPress={() => nav.navigate("FeesZakat")} />
            ) : null}
            {can("qard:view") ? (
              <Button title={STR.finQardIouNav} variant="secondary" onPress={() => nav.navigate("QardIou")} />
            ) : null}
            {can("reconciliation:view") ? (
              <Button title={STR.finReconNav} variant="secondary" onPress={() => nav.navigate("Reconciliation")} />
            ) : null}
            {can("budget:view") ? (
              <Button title={STR.finBudgetNav} variant="secondary" onPress={() => nav.navigate("Budget")} />
            ) : null}
            {can("finance_reports:view") ? (
              <Button title={STR.finDashboardNav} variant="ghost" onPress={() => nav.navigate("FinanceDashboard")} />
            ) : null}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
