/**
 * AdvancesScreen — qard-hasan advances/loans per staff (prd-hr H4.5, D-#27).
 * payroll:manage reads a staff member's advances; **issue / settle / write-off are
 * PRINCIPAL-only (payroll:approve)** — those controls show only with that permission
 * and the server re-checks. Interest- & fee-free (no rate/fee fields exist).
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  STAFF_ADVANCES_QUERY,
  ISSUE_STAFF_ADVANCE,
  SETTLE_STAFF_ADVANCE,
} from "../../graphql/operations";
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
  Field,
  Select,
  Loader,
  EmptyState,
  Notice,
} from "../../components/ui";
import { StaffSelect } from "../../components/selects";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, money, advanceStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { DateField } from "../../components/DateField";
import { space } from "../../theme/tokens";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function AdvancesScreen(): React.ReactElement {
  const { role, can } = useAuth();
  const { confirmAction } = useConfirm();
  const canApprove = can("payroll:approve");

  const [staffId, setStaffId] = React.useState("");
  const [principal, setPrincipal] = React.useState("");
  const [issueDate, setIssueDate] = React.useState("");
  const [recovery, setRecovery] = React.useState<string | null>("one_shot");
  const [installment, setInstallment] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [advQ, refetch] = useQuery({ query: STAFF_ADVANCES_QUERY, variables: { staffProfileId: staffId }, pause: staffId === "" });
  const [, issue] = useMutation(ISSUE_STAFF_ADVANCE);
  const [, settle] = useMutation(SETTLE_STAFF_ADVANCE);

  const advances = advQ.data?.staffAdvances ?? [];

  const issueValid =
    staffId !== "" &&
    /^\d+(\.\d+)?$/.test(principal) &&
    ISO_DATE.test(issueDate) &&
    recovery !== null &&
    (recovery !== "installments" || /^\d+(\.\d+)?$/.test(installment));

  async function runIssue(): Promise<void> {
    if (!issueValid) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await issue({
      staffProfileId: staffId,
      principal: parseFloat(principal),
      issueDate,
      recoveryMode: recovery!,
      installmentAmount: recovery === "installments" ? parseFloat(installment) : undefined,
      note: note.trim() === "" ? undefined : note.trim(),
    });
    setBusy(false);
    if (res.error || !res.data?.issueStaffAdvance) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrAdvanceIssued);
    setPrincipal("");
    setIssueDate("");
    setInstallment("");
    setNote("");
    refetch({ requestPolicy: "network-only" });
  }

  async function runSettle(advanceId: string, writeOff: boolean): Promise<void> {
    if (writeOff && !(await confirmAction({ confirmLabel: STR.hrAdvanceWriteOff }))) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await settle({ advanceId, writeOff });
    setBusy(false);
    if (res.error || !res.data?.settleStaffAdvance) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrAdvanceSettled);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.hrAdvances}</H2>
      <Muted>{STR.hrAdvancesSub}</Muted>

      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      <Card>
        <StaffSelect label={STR.hrStaffMember} value={staffId} onChange={setStaffId} />
      </Card>

      {staffId === "" ? (
        <EmptyState message={STR.hrSelectStaff} />
      ) : (
        <>
          {/* Existing advances */}
          {advQ.fetching ? (
            <Loader label={STR.loading} />
          ) : advances.length === 0 ? (
            <Card><Muted>{STR.empty}</Muted></Card>
          ) : (
            advances.map((a) => (
              <Card key={a.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700" }}>{money(a.principal)}</Body>
                  <Badge text={advanceStatusLabel(a.status)} tone={a.status === "active" ? "info" : "muted"} />
                </View>
                <Row label={STR.hrAdvanceBalance} value={money(a.balance)} />
                <Muted>{bnNum(a.issueDate.slice(0, 10))}{a.note ? ` · ${a.note}` : ""}</Muted>
                {canApprove && a.status === "active" ? (
                  <>
                    <Divider />
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                      <Button title={STR.hrAdvanceSettle} onPress={() => runSettle(a.id, false)} disabled={busy} />
                      <Button title={STR.hrAdvanceWriteOff} variant="danger" onPress={() => runSettle(a.id, true)} disabled={busy} />
                    </View>
                  </>
                ) : null}
              </Card>
            ))
          )}

          {/* Issue a new advance (Principal only) */}
          {canApprove ? (
            <>
              <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrIssueAdvance}</Body>
              <Card>
                <Field label={STR.hrAdvancePrincipal} value={principal} onChangeText={setPrincipal} keyboardType="decimal-pad" placeholder="0" />
                <DateField label={STR.hrAdvanceIssueDate} value={issueDate} onChange={setIssueDate} helper={STR.hrDateHint} />
                <Select
                  label={STR.hrAdvanceRecovery}
                  value={recovery}
                  options={[
                    { label: STR.hrRecoveryOneShot, value: "one_shot" },
                    { label: STR.hrRecoveryInstallments, value: "installments" },
                  ]}
                  onChange={setRecovery}
                />
                {recovery === "installments" ? (
                  <Field label={STR.hrInstallmentAmount} value={installment} onChangeText={setInstallment} keyboardType="decimal-pad" placeholder="0" />
                ) : null}
                <Field label={STR.hrPayNote} value={note} onChangeText={setNote} autoCapitalize="sentences" />
                <Button title={STR.hrIssueAdvance} onPress={runIssue} loading={busy} disabled={busy || !issueValid} />
              </Card>
            </>
          ) : (
            <Notice message={STR.hrPayApproveOnly} tone="info" />
          )}
        </>
      )}
    </Screen>
  );
}
