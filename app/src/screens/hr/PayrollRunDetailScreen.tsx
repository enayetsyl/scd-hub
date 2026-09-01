/**
 * PayrollRunDetailScreen — one run's payslips + lifecycle actions (prd-hr H4.2/H4.6).
 * payroll:manage reads payslips + cancels a prepared run; **Approve + lock is
 * PRINCIPAL-only (payroll:approve)** — the button shows only for that permission and
 * the server re-checks. A locked run reveals the payment export. Recompute = prepare
 * the same month again from the Prepare screen (it upserts).
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  PAYSLIPS_FOR_RUN_QUERY,
  APPROVE_PAYROLL_RUN,
  CANCEL_PAYROLL_RUN,
  type PayLineT,
} from "../../graphql/operations";
import type { HrStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Row,
  Divider,
  Button,
  Badge,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import {
  STR,
  bnNum,
  money,
  payrollRunStatusLabel,
  payDeductionTypeLabel,
  payAdditionTypeLabel,
  payLineNote,
} from "../../lib/labels";
import { downloadFile, PDF_SUPPORTED } from "../../lib/pdf";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "PayrollRunDetail">;

function PayLineRow({ label, line }: { label: string; line: PayLineT }): React.ReactElement {
  return (
    <Row
      label={`${label}${line.days != null ? ` · ${bnNum(line.days)}` : ""}${payLineNote(line.note) ? ` · ${payLineNote(line.note)}` : ""}`}
      value={money(line.amount)}
    />
  );
}

export default function PayrollRunDetailScreen({ route, navigation }: Props): React.ReactElement {
  const { runId, monthKey } = route.params;
  const { confirmAction } = useConfirm();
  const { role, can } = useAuth();
  const canApprove = can("payroll:approve");

  const [status, setStatus] = React.useState(route.params.status);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  async function downloadRegister(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await downloadFile(`/export/payroll-register/${runId}`, `payroll-register-${monthKey}.xlsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  const [{ data, fetching, error: qErr }, refetch] = useQuery({
    query: PAYSLIPS_FOR_RUN_QUERY,
    variables: { runId },
    requestPolicy: "cache-and-network",
  });
  const [, approve] = useMutation(APPROVE_PAYROLL_RUN);
  const [, cancel] = useMutation(CANCEL_PAYROLL_RUN);

  const payslips = data?.payslipsForRun ?? [];

  async function runApprove(): Promise<void> {
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await approve({ runId });
    setBusy(false);
    if (res.error || !res.data?.approvePayrollRun) {
      setError(friendlyError(res.error));
      return;
    }
    setStatus(res.data.approvePayrollRun.status);
    setOk(STR.hrRunApproved);
    refetch({ requestPolicy: "network-only" });
  }

  async function runCancel(): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.hrCancelRun }))) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await cancel({ runId });
    setBusy(false);
    if (res.error || !res.data?.cancelPayrollRun) {
      setError(friendlyError(res.error));
      return;
    }
    setStatus(res.data.cancelPayrollRun.status);
    setOk(STR.hrRunCancelled);
    // Cancelling DELETES the run's payslips, so this screen now has nothing left to
    // show — and the list behind it excludes cancelled runs entirely (D-#578).
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space(2) }}>
        <H2>{bnNum(monthKey)}</H2>
        <Badge text={payrollRunStatusLabel(status)} tone={status === "approved_locked" ? "ok" : status === "cancelled" ? "muted" : "info"} />
      </View>

      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {/* Actions */}
      {status === "prepared" ? (
        <Card>
          {canApprove ? (
            <Button title={STR.hrApproveLock} onPress={runApprove} loading={busy} disabled={busy} />
          ) : (
            <Notice message={STR.hrPayApproveOnly} tone="info" />
          )}
          <View style={{ marginTop: space(2) }}>
            <Button title={STR.hrCancelRun} variant="danger" onPress={runCancel} disabled={busy} />
          </View>
        </Card>
      ) : null}
      {status === "approved_locked" ? (
        <Card onPress={() => navigation.navigate("PaymentExport", { runId, monthKey })}>
          <Body style={{ fontWeight: "700" }}>{STR.hrPaymentExport}</Body>
        </Card>
      ) : null}

      {/* The accounting register (D-#625). Offered on a DRAFT run too: checking the
          arithmetic before approving is the point, and a run that cannot be inspected
          until it is frozen gets approved unread. Not for a cancelled run — its
          payslips are gone. */}
      {status !== "cancelled" && PDF_SUPPORTED ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.stfRegisterDownload}</Body>
          <Muted>{STR.stfRegisterNote}</Muted>
          <Button
            title={STR.stfRegisterDownload}
            variant="secondary"
            style={{ marginTop: space(2) }}
            onPress={() => void downloadRegister()}
            loading={busy}
            disabled={busy}
          />
        </Card>
      ) : null}

      {/* Payslips */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrPayslips}</Body>
      {fetching && payslips.length === 0 ? (
        <Loader label={STR.loading} />
      ) : qErr ? (
        <ErrorBanner message={friendlyError(qErr)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : payslips.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        payslips.map((p) => (
          <Card key={p.id}>
            <Body style={{ fontWeight: "700" }}>{p.snapshotName}</Body>
            <Row label={STR.hrPayGross} value={money(p.grossSalary)} />
            <Row label={STR.hrPayDayRate} value={money(p.dayRate)} />
            {p.unpaidLeaveDays > 0 ? <Row label={STR.hrPayUnpaidLeave} value={bnNum(p.unpaidLeaveDays)} /> : null}
            {p.deductions.length > 0 ? (
              <>
                <Divider />
                <Muted>{STR.hrPayDeductions}</Muted>
                {p.deductions.map((l, i) => <PayLineRow key={i} label={payDeductionTypeLabel(l.type)} line={l} />)}
              </>
            ) : null}
            {p.additions.length > 0 ? (
              <>
                <Divider />
                <Muted>{STR.hrPayAdditions}</Muted>
                {p.additions.map((l, i) => <PayLineRow key={i} label={payAdditionTypeLabel(l.type)} line={l} />)}
              </>
            ) : null}
            <Divider />
            <Row label={STR.hrPayNet} value={money(p.netPay)} />
            {p.advanceRepaid > 0 ? <Row label={STR.hrPayAdvanceRepaid} value={money(p.advanceRepaid)} /> : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
