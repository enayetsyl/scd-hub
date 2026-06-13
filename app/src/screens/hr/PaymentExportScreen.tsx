/**
 * PaymentExportScreen — the net-pay-per-staff export for a locked run (prd-hr H4.6,
 * payroll:manage). Cash-paid staff are excluded server-side; actual payment is
 * external (no live payment API). Read-only list.
 */
import React from "react";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { PAYROLL_PAYMENT_EXPORT_QUERY } from "../../graphql/operations";
import type { HrStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Row, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, bnNum, money, paymentMethodLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";

type Props = NativeStackScreenProps<HrStackParamList, "PaymentExport">;

export default function PaymentExportScreen({ route }: Props): React.ReactElement {
  const { runId, monthKey } = route.params;
  const [{ data, fetching, error }, refetch] = useQuery({ query: PAYROLL_PAYMENT_EXPORT_QUERY, variables: { runId } });
  const rows = data?.payrollPaymentExport ?? [];

  return (
    <Screen scroll>
      <H2>{`${STR.hrPaymentExport} · ${bnNum(monthKey)}`}</H2>
      {fetching ? (
        <Loader label={STR.loading} />
      ) : error ? (
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : rows.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        rows.map((r) => (
          <Card key={r.staffProfileId}>
            <Body style={{ fontWeight: "700" }}>{r.name}</Body>
            <Row label={STR.hrPaymentMethod} value={paymentMethodLabel(r.paymentMethod)} />
            {r.account ? <Row label={STR.hrPayAccount} value={r.account} /> : null}
            <Row label={STR.hrPayNet} value={money(r.netPay)} />
          </Card>
        ))
      )}
    </Screen>
  );
}
