/**
 * PaymentExportScreen — the net-pay-per-staff export for a locked run (prd-hr H4.6,
 * payroll:manage). Cash-paid staff are excluded server-side; actual payment is
 * external (no live payment API).
 *
 * D-#579 — it was a screen you copied off by hand, and it lied by omission in two
 * ways. It listed people with NO account number as if they were payable, listed ৳0
 * rows the bank cannot accept, and showed only the account NUMBER — never the account
 * name, bank or branch that SH-10 added and that a transfer actually needs. Now:
 *
 *   - payable rows and blocked rows are shown APART, each blocked one with its reason,
 *     so a person missing from payday is visible rather than absent;
 *   - the full disbursement details are on the row;
 *   - the payable rows download as a CSV (web only, like the other exports).
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { PAYROLL_PAYMENT_EXPORT_QUERY } from "../../graphql/operations";
import type { HrStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Row,
  Badge,
  Button,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { STR, bnNum, money, paymentMethodLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { downloadFile, PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "PaymentExport">;

export default function PaymentExportScreen({ route }: Props): React.ReactElement {
  const { runId, monthKey } = route.params;
  const [{ data, fetching, error }, refetch] = useQuery({
    query: PAYROLL_PAYMENT_EXPORT_QUERY,
    variables: { runId },
    requestPolicy: "cache-and-network",
  });
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const rows = data?.payrollPaymentExport ?? [];
  const payable = rows.filter((r) => r.blockedReason === null);
  const blocked = rows.filter((r) => r.blockedReason !== null);
  const total = payable.reduce((sum, r) => sum + r.netPay, 0);

  async function download(): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      await downloadFile(`/export/payment/${runId}`, `payment-${monthKey}.csv`);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  return (
    <Screen scroll>
      <H2>{`${STR.hrPaymentExport} · ${bnNum(monthKey)}`}</H2>
      {failure ? <Notice message={failure} tone="danger" /> : null}

      {fetching && rows.length === 0 ? (
        <Loader label={STR.loading} />
      ) : error ? (
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : rows.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        <>
          <Card>
            <Row label={STR.stfExportPayableCount} value={`${bnNum(String(payable.length))} ${STR.stfExportPeople}`} />
            <Row label={STR.stfExportTotal} value={money(total)} />
            {PDF_SUPPORTED ? (
              <Button
                title={STR.stfExportCsv}
                onPress={download}
                loading={busy}
                disabled={busy || payable.length === 0}
              />
            ) : (
              <Muted>{STR.stfExportWebOnly}</Muted>
            )}
          </Card>

          {/* Cannot be paid — shown FIRST, because this is the list that needs an
              action before payday, and the one nobody would go looking for. */}
          {blocked.length > 0 ? (
            <>
              <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>
                {STR.stfExportBlockedTitle}
              </Body>
              <Notice tone="warn" message={STR.stfExportBlockedNote} />
              {blocked.map((r) => (
                <Card key={r.staffProfileId}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700", flex: 1 }}>{r.name}</Body>
                    <Badge text={r.blockedReason ?? ""} tone="warn" />
                  </View>
                  <Row label={STR.hrPaymentMethod} value={paymentMethodLabel(r.paymentMethod)} />
                  <Row label={STR.hrPayNet} value={money(r.netPay)} />
                </Card>
              ))}
            </>
          ) : null}

          <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>
            {STR.stfExportPayableTitle}
          </Body>
          {payable.length === 0 ? (
            <Card>
              <Muted>{STR.empty}</Muted>
            </Card>
          ) : (
            payable.map((r) => (
              <Card key={r.staffProfileId}>
                <Body style={{ fontWeight: "700" }}>{r.name}</Body>
                <Row label={STR.hrPaymentMethod} value={paymentMethodLabel(r.paymentMethod)} />
                {r.account ? <Row label={STR.hrPayAccount} value={r.account} /> : null}
                {r.accountName ? <Row label={STR.stfBankAccountName} value={r.accountName} /> : null}
                {r.bankName ? <Row label={STR.stfBankName} value={r.bankName} /> : null}
                {r.bankBranch ? <Row label={STR.stfBankBranch} value={r.bankBranch} /> : null}
                <Row label={STR.hrPayNet} value={money(r.netPay)} />
              </Card>
            ))
          )}
        </>
      )}
    </Screen>
  );
}
