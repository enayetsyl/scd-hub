/**
 * PaymentExportScreen — what leaves the school on payday (prd-hr H4.6, payroll:manage).
 *
 * D-#591 reshaped this around the documents the bank actually receives, taking the
 * school's own June 2026 pack as the specification. Pay does not leave by one route: a
 * transfer to the school's OWN bank is an internal instruction with no bank/branch
 * columns, a transfer anywhere else goes by BEFTN and needs a routing number, and cash
 * is handed over by the office. So the screen shows those lists separately, each with
 * its own total — the figure its covering letter quotes — and the pack downloads as a
 * PDF of letters and advice sheets.
 *
 * ANYONE THE SHEET CANNOT PAY IS SHOWN, per channel, with the reason. A person missing
 * from an advice sheet is a person who does not get paid, and that failure is silent
 * unless the screen says it (D-#579).
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { PAYMENT_ADVICE_QUERY, type AdviceGroupT } from "../../graphql/operations";
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
  Divider,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { STR, bnNum, money, paymentChannelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { downloadFile, PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "PaymentExport">;

function ChannelSection({ group }: { group: AdviceGroupT }): React.ReactElement {
  const beftn = group.channel === "beftn";
  const cash = group.channel === "cash";
  return (
    <View>
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>
        {paymentChannelLabel(group.channel)}
      </Body>

      <Card>
        <Row
          label={STR.stfExportPayableCount}
          value={`${bnNum(String(group.rows.length))} ${STR.stfExportPeople}`}
        />
        <Row label={STR.stfExportTotal} value={money(group.total)} />
      </Card>

      {group.rows.map((r) => (
        <Card key={r.staffProfileId}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700", flex: 1 }}>{r.name}</Body>
            <Body style={{ fontWeight: "700" }}>{money(r.amount)}</Body>
          </View>
          {/* Cash needs no account at all — showing empty rows for it would only
              suggest something is missing. */}
          {cash ? null : (
            <>
              {r.account ? <Row label={STR.hrPayAccount} value={r.account} /> : null}
              {r.accountName ? <Row label={STR.stfBankAccountName} value={r.accountName} /> : null}
              {beftn && r.bankName ? <Row label={STR.stfBankName} value={r.bankName} /> : null}
              {beftn && r.bankBranch ? <Row label={STR.stfBankBranch} value={r.bankBranch} /> : null}
              {beftn && r.routingNo ? <Row label={STR.stfRoutingNo} value={r.routingNo} /> : null}
            </>
          )}
        </Card>
      ))}

      {group.blocked.length > 0 ? (
        <>
          <Notice tone="warn" message={STR.stfExportBlockedNote} />
          {group.blocked.map((r) => (
            <Card key={r.staffProfileId}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700", flex: 1 }}>{r.name}</Body>
                <Badge text={r.blockedReason ?? ""} tone="warn" />
              </View>
              <Row label={STR.hrPayNet} value={money(r.amount)} />
            </Card>
          ))}
        </>
      ) : null}
    </View>
  );
}

export default function PaymentExportScreen({ route }: Props): React.ReactElement {
  const { runId, monthKey } = route.params;
  const [{ data, fetching, error }, refetch] = useQuery({
    query: PAYMENT_ADVICE_QUERY,
    variables: { runId },
    requestPolicy: "cache-and-network",
  });
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const advice = data?.paymentAdvice;
  const groups = advice?.groups ?? [];
  const grandTotal = groups.reduce((sum, g) => sum + g.total, 0);
  const blockedCount = groups.reduce((n, g) => n + g.blocked.length, 0);

  async function download(path: string, filename: string): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      await downloadFile(path, filename);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  return (
    <Screen scroll>
      <H2>{`${STR.hrPaymentExport} · ${bnNum(monthKey)}`}</H2>
      {failure ? <Notice message={failure} tone="danger" /> : null}

      {fetching && !advice ? (
        <Loader label={STR.loading} />
      ) : error ? (
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : !advice || groups.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        <>
          <Card>
            <Row label={STR.stfExportTotal} value={money(grandTotal)} />
            <Row label={STR.stfAdvicePaymentInfo} value={advice.paymentInfo} />
            {blockedCount > 0 ? (
              <Notice
                tone="warn"
                message={`${STR.stfExportBlockedTitle}: ${bnNum(String(blockedCount))} ${STR.stfExportPeople}`}
              />
            ) : null}
            <Divider />
            {/* The letterhead and the school's own bank are printed on a letter that
                goes to a bank over the school's name. Say so BEFORE the download
                returns an error. */}
            {advice.ready ? null : (
              <Notice tone="warn" message={`${STR.stfAdviceNotReady} ${advice.missing.join(", ")}`} />
            )}
            {PDF_SUPPORTED ? (
              <>
                <Button
                  title={STR.stfAdviceDownload}
                  onPress={() => download(`/export/payment-advice/${runId}`, `salary-advice-${monthKey}.pdf`)}
                  loading={busy}
                  disabled={busy || !advice.ready}
                />
                <Button
                  title={STR.stfExportCsv}
                  variant="secondary"
                  style={{ marginTop: space(2) }}
                  onPress={() => download(`/export/payment/${runId}`, `payment-${monthKey}.xlsx`)}
                  disabled={busy}
                />
              </>
            ) : (
              <Muted>{STR.stfExportWebOnly}</Muted>
            )}
          </Card>

          {groups.map((g) => (
            <ChannelSection key={g.channel} group={g} />
          ))}
        </>
      )}
    </Screen>
  );
}
