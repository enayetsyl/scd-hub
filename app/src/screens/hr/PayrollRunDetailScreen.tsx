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
  REOPEN_PAYROLL_RUN,
  PAYROLL_RUNS_QUERY,
  SALARY_SENT_GROUPS,
  ANNOUNCE_SALARY_SENT,
  type PayLineT,
  type SalarySentGroupT,
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
  Field,
  Chip,
  ChipRow,
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
  paymentChannelLabel,
} from "../../lib/labels";
import { downloadFile, openLetterPdf, PDF_SUPPORTED, LETTER_PDF_SUPPORTED } from "../../lib/pdf";
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

/** An ISO instant as Dhaka date + time, "০৩/১১/২০২৬ ১৪:০৫". */
function dhakaStamp(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 6 * 3_600_000).toISOString();
  return bnNum(`${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`);
}

/**
 * D-#915 — tell each payment group its salary went out, one group at a time: the bank
 * transfer and the cash envelopes are paid on different days.
 */
function SalarySentCard({ runId }: { runId: string }): React.ReactElement | null {
  const { confirmAction } = useConfirm();
  const [{ data, error: qErr }] = useQuery({ query: SALARY_SENT_GROUPS, variables: { runId }, requestPolicy: "network-only" });
  const [, announce] = useMutation(ANNOUNCE_SALARY_SENT);
  const [groups, setGroups] = React.useState<SalarySentGroupT[] | null>(null);
  const [choice, setChoice] = React.useState<Record<string, "notification" | "popup" | "both">>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const shown = groups ?? data?.salarySentGroups ?? [];
  if (qErr) return <Card><ErrorBanner message={friendlyError(qErr)} /></Card>;
  if (shown.length === 0) return null;

  async function tell(g: SalarySentGroupT): Promise<void> {
    const pick = choice[g.channel] ?? "both";
    const label = paymentChannelLabel(g.channel);
    if (!(await confirmAction({
      confirmLabel: STR.stfSalarySentConfirm,
      message: `${label} · ${bnNum(g.staffCount)} ${STR.stfSalarySentPeople} · ${money(g.total)}`,
    }))) return;
    setBusy(g.channel);
    setError(null);
    setOk(null);
    const res = await announce({
      runId,
      channel: g.channel,
      sendChannels: pick === "both" ? ["notification", "popup"] : [pick],
    });
    setBusy(null);
    if (res.error || !res.data?.announceSalarySent) {
      setError(friendlyError(res.error));
      return;
    }
    setGroups(res.data.announceSalarySent);
    setOk(`${label}: ${STR.stfSalarySentDone}`);
  }

  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.stfSalarySentTitle}</Body>
      <Muted>{STR.stfSalarySentNote}</Muted>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      {shown.map((g) => {
        const last = g.sends[g.sends.length - 1];
        const pick = choice[g.channel] ?? "both";
        return (
          <View key={g.channel} style={{ marginTop: space(3) }}>
            <Divider />
            <Row label={paymentChannelLabel(g.channel)} value={`${bnNum(g.staffCount)} ${STR.stfSalarySentPeople} · ${money(g.total)}`} />
            {last ? (
              <Muted>{`${STR.stfSalarySentLast} ${dhakaStamp(last.at)} · ${last.sendChannels
                .map((c) => (c === "popup" ? STR.stfLetterSendPopup : STR.stfLetterSendNotification))
                .join(" + ")}`}</Muted>
            ) : null}
            {g.withoutLogin.length > 0 ? (
              <Muted>{`${STR.stfSalarySentNoLogin} ${g.withoutLogin.join(", ")}`}</Muted>
            ) : null}
            <ChipRow>
              <Chip label={STR.stfLetterSendNotification} selected={pick === "notification"} onPress={() => setChoice({ ...choice, [g.channel]: "notification" })} />
              <Chip label={STR.stfLetterSendPopup} selected={pick === "popup"} onPress={() => setChoice({ ...choice, [g.channel]: "popup" })} />
              <Chip label={STR.stfLetterSendBoth} selected={pick === "both"} onPress={() => setChoice({ ...choice, [g.channel]: "both" })} />
            </ChipRow>
            <Button
              title={last ? STR.stfSalarySentAgain : STR.stfSalarySentButton}
              variant={last ? "secondary" : "primary"}
              onPress={() => void tell(g)}
              loading={busy === g.channel}
              disabled={busy !== null || g.staffCount === g.withoutLogin.length}
            />
          </View>
        );
      })}
    </Card>
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

  async function openSheet(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await openLetterPdf(`/export/salary-sheet/${runId}`);
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
  const [, reopen] = useMutation(REOPEN_PAYROLL_RUN);
  const [reopening, setReopening] = React.useState(false);
  const [reopenReason, setReopenReason] = React.useState("");
  // The run list carries the reopen history (D-#904); this screen only gets the id.
  const [{ data: runsData }, refetchRuns] = useQuery({ query: PAYROLL_RUNS_QUERY, requestPolicy: "cache-and-network" });
  const thisRun = runsData?.payrollRuns.find((r) => r.id === runId);

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

  /** D-#904 — unlock a locked run to correct it; the server undoes what the lock did. */
  async function runReopen(): Promise<void> {
    if (!reopenReason.trim()) return;
    if (!(await confirmAction({ confirmLabel: STR.hrReopenConfirm, message: STR.hrReopenNote }))) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await reopen({ runId, reason: reopenReason.trim() });
    setBusy(false);
    if (res.error || !res.data?.reopenPayrollRun) {
      setError(friendlyError(res.error));
      return;
    }
    setStatus(res.data.reopenPayrollRun.status);
    setReopening(false);
    setReopenReason("");
    setOk(STR.hrRunReopened);
    refetch({ requestPolicy: "network-only" });
    refetchRuns({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space(2) }}>
        <H2>{bnNum(monthKey)}</H2>
        <Badge text={payrollRunStatusLabel(status)} tone={status === "approved_locked" ? "ok" : status === "cancelled" ? "muted" : "info"} />
      </View>

      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      {thisRun?.lastReopenReason ? (
        <Notice tone="info" message={`${STR.hrReopenedBanner} ${thisRun.lastReopenReason}`} />
      ) : null}

      {status === "approved_locked" && can("payroll:reopen") ? (
        <Card>
          {reopening ? (
            <>
              <Muted style={{ marginBottom: space(2) }}>{STR.hrReopenNote}</Muted>
              <Field label={STR.hrReopenReason} value={reopenReason} onChangeText={setReopenReason} autoCapitalize="sentences" />
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <Button title={STR.cancel} variant="secondary" onPress={() => setReopening(false)} disabled={busy} />
                <Button title={STR.hrReopenConfirm} variant="danger" onPress={runReopen} loading={busy} disabled={busy || !reopenReason.trim()} />
              </View>
            </>
          ) : (
            <Button title={STR.hrReopenRun} variant="secondary" onPress={() => setReopening(true)} />
          )}
        </Card>
      ) : null}

      {/* Actions */}
      {status === "prepared" ? (
        <Card>
          {canApprove ? (
            <Button title={STR.hrApproveLock} onPress={runApprove} loading={busy} disabled={busy} />
          ) : (
            <Notice message={STR.hrPayApproveOnly} tone="info" />
          )}
          {can("payroll:prepare") ? (
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.hrCancelRun} variant="danger" onPress={runCancel} disabled={busy} />
            </View>
          ) : null}
        </Card>
      ) : null}
      {status === "approved_locked" && can("payroll:export") ? (
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

      {/* D-#914 — the sheet behind the salary vouchers; a draft run's copy says DRAFT. */}
      {status !== "cancelled" && LETTER_PDF_SUPPORTED && can("payroll:export") ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.stfSalarySheet}</Body>
          <Muted>{STR.stfSalarySheetNote}</Muted>
          <Button
            title={STR.stfSalarySheet}
            variant="secondary"
            style={{ marginTop: space(2) }}
            onPress={() => void openSheet()}
            loading={busy}
            disabled={busy}
          />
        </Card>
      ) : null}

      {status === "approved_locked" && can("payroll:announce_paid") ? <SalarySentCard runId={runId} /> : null}

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
            {p.isExitPayslip ? <Badge text={STR.hrPayExitPayslip} tone="info" /> : null}
            <Row label={STR.hrPayGross} value={money(p.grossSalary)} />
            <Row label={STR.hrPayDayRate} value={money(p.dayRate)} />
            {p.payableDays != null ? <Row label={STR.hrPayPayableDays} value={bnNum(p.payableDays)} /> : null}
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
