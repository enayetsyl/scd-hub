/**
 * PayrollHomeScreen — the payroll surface entry (prd-hr §4, payroll:manage).
 * Lists recent runs (tap → detail) and links to prepare a run, set staff pay, and
 * manage advances. Approve+lock / issue / settle live deeper and are Principal-only
 * (payroll:approve), re-checked server-side.
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { PAYROLL_RUNS_QUERY } from "../../graphql/operations";
import type { HrStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, bnNum, payrollRunStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "PayrollHome">;

function statusTone(s: string): "info" | "ok" | "muted" {
  return s === "approved_locked" ? "ok" : s === "cancelled" ? "muted" : "info";
}

export default function PayrollHomeScreen({ navigation }: Props): React.ReactElement {
  // The list must re-read on focus. `payrollRuns` EXCLUDES cancelled runs, so a
  // cache-first replay after cancelling one still shows it, still badged প্রস্তুত —
  // which reads as "cancel did nothing" and was reported as exactly that (D-#578).
  const [{ data, fetching, error }, refetch] = useQuery({
    query: PAYROLL_RUNS_QUERY,
    requestPolicy: "cache-and-network",
  });
  React.useEffect(
    () => navigation.addListener("focus", () => refetch({ requestPolicy: "network-only" })),
    [navigation, refetch],
  );
  const runs = data?.payrollRuns ?? [];

  return (
    <Screen scroll>
      <H2>{STR.hrPayroll}</H2>

      <Card onPress={() => navigation.navigate("PreparePayroll")}>
        <Body style={{ fontWeight: "700" }}>{STR.hrPrepareRun}</Body>
      </Card>
      <Card onPress={() => navigation.navigate("StaffPay")}>
        <Body style={{ fontWeight: "700" }}>{STR.hrStaffPay}</Body>
        <Muted>{STR.hrStaffPaySub}</Muted>
      </Card>
      <Card onPress={() => navigation.navigate("Advances")}>
        <Body style={{ fontWeight: "700" }}>{STR.hrAdvances}</Body>
        <Muted>{STR.hrAdvancesSub}</Muted>
      </Card>

      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrPayrollRuns}</Body>
      {fetching && runs.length === 0 ? (
        <Loader label={STR.loading} />
      ) : error ? (
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : runs.length === 0 ? (
        <EmptyState message={STR.hrNoRuns} />
      ) : (
        runs.map((r) => (
          <Card key={r.id} onPress={() => navigation.navigate("PayrollRunDetail", { runId: r.id, monthKey: r.monthKey, status: r.status })}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{bnNum(r.monthKey)}</Body>
              <Badge text={payrollRunStatusLabel(r.status)} tone={statusTone(r.status)} />
            </View>
            <Muted>{STR.hrPayWorkingDays}: {bnNum(r.workingDays)}{r.note ? ` · ${r.note}` : ""}</Muted>
          </Card>
        ))
      )}
    </Screen>
  );
}
