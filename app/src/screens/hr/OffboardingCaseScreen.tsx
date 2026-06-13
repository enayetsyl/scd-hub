/**
 * OffboardingCaseScreen — one offboarding case end-to-end (prd-hr §6, H6, D-#29):
 * clearance checklist, system-access revocation, the hard-held final settlement,
 * exit interview, and service certificate. staff:manage drives the admin steps;
 * **compute settlement = payroll:manage; release = PRINCIPAL-only (payroll:approve)
 * and is gated server-side on clearance being complete (D-#29).**
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import { CLEARANCE_ITEM_STATUSES, roleHasPermission } from "@scd/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  OFFBOARDING_CASE_QUERY,
  ADD_OFFBOARDING_CLEARANCE_ITEM,
  UPDATE_OFFBOARDING_CLEARANCE_ITEM,
  REVOKE_OFFBOARDING_ACCESS,
  COMPUTE_FINAL_SETTLEMENT,
  RELEASE_FINAL_SETTLEMENT,
  RECORD_EXIT_INTERVIEW,
  ISSUE_SERVICE_CERTIFICATE,
  CANCEL_OFFBOARDING,
  type SettlementLineT,
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
  Field,
  Select,
  Button,
  Badge,
  Loader,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { AcademicYearSelect } from "../../components/selects";
import { useAuth } from "../../auth/AuthContext";
import {
  STR,
  bnNum,
  money,
  offboardingTriggerLabel,
  offboardingStatusLabel,
  clearanceItemStatusLabel,
  payDeductionTypeLabel,
  payAdditionTypeLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "OffboardingCase">;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function SettlementLineRow({ label, line }: { label: string; line: SettlementLineT }): React.ReactElement {
  return <Row label={`${label}${line.note ? ` · ${line.note}` : ""}`} value={money(line.amount)} />;
}

export default function OffboardingCaseScreen({ route }: Props): React.ReactElement {
  const { caseId } = route.params;
  const { role } = useAuth();
  const canCompute = !!role && roleHasPermission(role, "payroll:manage");
  const canRelease = !!role && roleHasPermission(role, "payroll:approve");

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  // forms
  const [itemStatus, setItemStatus] = React.useState<Record<string, string>>({});
  const [itemNote, setItemNote] = React.useState<Record<string, string>>({});
  const [newKey, setNewKey] = React.useState("");
  const [newLabel, setNewLabel] = React.useState("");
  const [workingDays, setWorkingDays] = React.useState("");
  const [yearId, setYearId] = React.useState("");
  const [payableDays, setPayableDays] = React.useState("");
  const [arrears, setArrears] = React.useState("");
  const [arrearsNote, setArrearsNote] = React.useState("");
  const [exitReason, setExitReason] = React.useState("");
  const [exitFeedback, setExitFeedback] = React.useState("");

  const [{ data, fetching, error: qErr }, refetch] = useQuery({ query: OFFBOARDING_CASE_QUERY, variables: { caseId } });
  const [, addItem] = useMutation(ADD_OFFBOARDING_CLEARANCE_ITEM);
  const [, updateItem] = useMutation(UPDATE_OFFBOARDING_CLEARANCE_ITEM);
  const [, revoke] = useMutation(REVOKE_OFFBOARDING_ACCESS);
  const [, compute] = useMutation(COMPUTE_FINAL_SETTLEMENT);
  const [, release] = useMutation(RELEASE_FINAL_SETTLEMENT);
  const [, recordExit] = useMutation(RECORD_EXIT_INTERVIEW);
  const [, issueCert] = useMutation(ISSUE_SERVICE_CERTIFICATE);
  const [, cancel] = useMutation(CANCEL_OFFBOARDING);

  const c = data?.offboardingCase ?? null;

  /** Run a mutation, surface ok/err, refetch the case. */
  async function run<T>(fn: () => Promise<{ error?: unknown; data?: T | null }>, picked: (d: T) => unknown, okMsg: string): Promise<void> {
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await fn();
    setBusy(false);
    if (res.error || !res.data || !picked(res.data)) {
      setError(friendlyError(res.error as never));
      return;
    }
    setOk(okMsg);
    refetch({ requestPolicy: "network-only" });
  }

  if (fetching) return <Screen><Loader label={STR.loading} /></Screen>;
  if (qErr || !c) {
    return (
      <Screen scroll>
        <ErrorBanner message={qErr ? friendlyError(qErr) : STR.empty} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      </Screen>
    );
  }

  const settlement = c.settlement;
  const released = !!settlement?.releasedAt;
  const terminal = c.status === "completed" || c.status === "cancelled";

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space(2) }}>
        <H2>{route.params.name}</H2>
        <Badge text={offboardingStatusLabel(c.status)} tone={c.status === "completed" ? "ok" : c.status === "cancelled" ? "muted" : "info"} />
      </View>
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      <Card>
        <Row label={STR.hrTrigger} value={offboardingTriggerLabel(c.trigger)} />
        <Row label={STR.hrLastWorkingDay} value={bnNum(c.lastWorkingDayKey)} />
        {c.noticeDateKey ? <Row label={STR.hrNoticeDate} value={bnNum(c.noticeDateKey)} /> : null}
      </Card>

      {/* Clearance checklist */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrClearance}</Body>
      {c.clearanceItems.length === 0 ? <Card><Muted>{STR.empty}</Muted></Card> : null}
      {c.clearanceItems.map((it) => (
        <Card key={it.key}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700", flex: 1 }}>{it.label}</Body>
            <Badge
              text={clearanceItemStatusLabel(it.status)}
              tone={it.status === "done" ? "ok" : it.status === "waived" ? "muted" : "warn"}
            />
          </View>
          {it.note ? <Muted>{it.note}</Muted> : null}
          {!terminal ? (
            <>
              <Divider />
              <Select
                label={STR.hrClearanceItemStatus}
                value={itemStatus[it.key] ?? it.status}
                options={CLEARANCE_ITEM_STATUSES.map((s) => ({ label: clearanceItemStatusLabel(s), value: s }))}
                onChange={(v) => setItemStatus((p) => ({ ...p, [it.key]: v }))}
              />
              <Field
                label={STR.hrClearanceNote}
                value={itemNote[it.key] ?? ""}
                onChangeText={(v) => setItemNote((p) => ({ ...p, [it.key]: v }))}
                autoCapitalize="sentences"
              />
              <Button
                title={STR.hrClearanceItemStatus}
                variant="secondary"
                onPress={() =>
                  run(
                    () => updateItem({ caseId, key: it.key, status: itemStatus[it.key] ?? it.status, note: itemNote[it.key]?.trim() || undefined }),
                    (d) => (d as { updateOffboardingClearanceItem?: unknown }).updateOffboardingClearanceItem,
                    STR.hrClearanceUpdated,
                  )
                }
                disabled={busy}
              />
            </>
          ) : null}
        </Card>
      ))}
      {!terminal ? (
        <Card>
          <Muted style={{ marginBottom: space(2) }}>{STR.hrClearanceAdd}</Muted>
          <Field label={STR.hrClearanceKey} value={newKey} onChangeText={setNewKey} placeholder="keys_devices" />
          <Field label={STR.hrClearanceLabel} value={newLabel} onChangeText={setNewLabel} autoCapitalize="sentences" />
          <Button
            title={STR.hrClearanceAdd}
            variant="secondary"
            onPress={() =>
              run(
                () => addItem({ caseId, key: newKey.trim(), label: newLabel.trim() }),
                (d) => (d as { addOffboardingClearanceItem?: unknown }).addOffboardingClearanceItem,
                STR.hrClearanceItemAdded,
              ).then(() => { setNewKey(""); setNewLabel(""); })
            }
            disabled={busy || newKey.trim() === "" || newLabel.trim() === ""}
          />
        </Card>
      ) : null}

      {/* System access */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrAccess}</Body>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Body style={{ fontWeight: "700" }}>{c.accessRevoked ? STR.hrAccessRevokedBadge : STR.hrAccessActive}</Body>
          <Badge text={c.accessRevoked ? STR.hrAccessRevokedBadge : STR.hrAccessActive} tone={c.accessRevoked ? "danger" : "ok"} />
        </View>
        {c.accessRevoked ? (
          <>
            {c.grantsRevokedCount != null ? <Row label={STR.hrGrantsRevoked} value={bnNum(c.grantsRevokedCount)} /> : null}
            {c.accessRevokedAt ? <Muted>{bnNum(c.accessRevokedAt.slice(0, 10))}</Muted> : null}
          </>
        ) : !terminal ? (
          <View style={{ marginTop: space(2) }}>
            <Button
              title={STR.hrRevokeAccess}
              variant="danger"
              onPress={() =>
                run(() => revoke({ caseId }), (d) => (d as { revokeOffboardingAccess?: unknown }).revokeOffboardingAccess, STR.hrAccessRevokedMsg)
              }
              disabled={busy}
            />
          </View>
        ) : null}
      </Card>

      {/* Final settlement */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrSettlement}</Body>
      {settlement ? (
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Body style={{ fontWeight: "700" }}>{money(settlement.netPay)}</Body>
            <Badge
              text={released ? STR.hrSettlementReleasedBadge : STR.hrSettlementHeld}
              tone={released ? "ok" : "warn"}
            />
          </View>
          <Row label={STR.hrPayGross} value={money(settlement.grossSalary)} />
          <Row label={STR.hrPayDayRate} value={money(settlement.dayRate)} />
          {settlement.leaveEncashmentDays > 0 ? <Row label={STR.hrLeaveEncashDays} value={bnNum(settlement.leaveEncashmentDays)} /> : null}
          {settlement.additions.length > 0 ? (
            <>
              <Divider />
              <Muted>{STR.hrPayAdditions}</Muted>
              {settlement.additions.map((l, i) => <SettlementLineRow key={i} label={payAdditionTypeLabel(l.type)} line={l} />)}
            </>
          ) : null}
          {settlement.deductions.length > 0 ? (
            <>
              <Divider />
              <Muted>{STR.hrPayDeductions}</Muted>
              {settlement.deductions.map((l, i) => <SettlementLineRow key={i} label={payDeductionTypeLabel(l.type)} line={l} />)}
            </>
          ) : null}
          {settlement.advanceRecovered > 0 ? <Row label={STR.hrAdvanceRecovered} value={money(settlement.advanceRecovered)} /> : null}
          <Divider />
          <Row label={STR.hrPayNet} value={money(settlement.netPay)} />
          {!released ? (
            <View style={{ marginTop: space(3) }}>
              {canRelease ? (
                <Button
                  title={STR.hrReleaseSettlement}
                  onPress={() =>
                    run(() => release({ caseId }), (d) => (d as { releaseFinalSettlement?: unknown }).releaseFinalSettlement, STR.hrReleasedMsg)
                  }
                  disabled={busy}
                />
              ) : (
                <Notice message={STR.hrReleaseGated} tone="info" />
              )}
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* Compute / recompute (while not released) */}
      {!released && !terminal && canCompute ? (
        <Card>
          <Muted style={{ marginBottom: space(2) }}>{STR.hrComputeSettlement}</Muted>
          <Field label={STR.hrSettlementWorkingDays} value={workingDays} onChangeText={setWorkingDays} keyboardType="number-pad" placeholder="26" />
          <AcademicYearSelect label={STR.hrYear} value={yearId} onChange={setYearId} />
          <Field label={STR.hrSettlementPayableDays} value={payableDays} onChangeText={setPayableDays} keyboardType="number-pad" placeholder="" />
          <Field label={STR.hrSettlementArrears} value={arrears} onChangeText={setArrears} keyboardType="number-pad" placeholder="" />
          <Field label={STR.hrSettlementArrearsNote} value={arrearsNote} onChangeText={setArrearsNote} autoCapitalize="sentences" />
          <Button
            title={STR.hrCompute}
            onPress={() =>
              run(
                () =>
                  compute({
                    caseId,
                    workingDays: parseInt(workingDays, 10),
                    academicYearId: yearId || undefined,
                    payableDays: /^\d+$/.test(payableDays) ? parseInt(payableDays, 10) : undefined,
                    arrearsAmount: /^\d+$/.test(arrears) ? parseInt(arrears, 10) : undefined,
                    arrearsNote: arrearsNote.trim() || undefined,
                  }),
                (d) => (d as { computeFinalSettlement?: unknown }).computeFinalSettlement,
                STR.hrSettlementComputed,
              )
            }
            loading={busy}
            disabled={busy || !/^\d+$/.test(workingDays) || parseInt(workingDays, 10) <= 0}
          />
        </Card>
      ) : null}

      {/* Exit interview */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrExitInterview}</Body>
      <Card>
        {c.exitInterviewReason || c.exitInterviewFeedback ? (
          <>
            {c.exitInterviewReason ? <Row label={STR.hrExitReason} value={c.exitInterviewReason} /> : null}
            {c.exitInterviewFeedback ? <Muted>{c.exitInterviewFeedback}</Muted> : null}
            <Divider />
          </>
        ) : null}
        <Field label={STR.hrExitReason} value={exitReason} onChangeText={setExitReason} autoCapitalize="sentences" />
        <Field label={STR.hrExitFeedback} value={exitFeedback} onChangeText={setExitFeedback} multiline autoCapitalize="sentences" />
        <Button
          title={STR.hrExitSave}
          variant="secondary"
          onPress={() =>
            run(
              () => recordExit({ caseId, reason: exitReason.trim() || undefined, feedback: exitFeedback.trim() || undefined }),
              (d) => (d as { recordExitInterview?: unknown }).recordExitInterview,
              STR.hrExitSaved,
            )
          }
          disabled={busy || (exitReason.trim() === "" && exitFeedback.trim() === "")}
        />
      </Card>

      {/* Service certificate */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrServiceCert}</Body>
      <Card>
        {c.serviceCertificateIssuedAt ? (
          <Row label={STR.hrCertIssuedOn} value={bnNum(c.serviceCertificateIssuedAt.slice(0, 10))} />
        ) : (
          <Button
            title={STR.hrIssueCert}
            variant="secondary"
            onPress={() =>
              run(() => issueCert({ caseId }), (d) => (d as { issueServiceCertificate?: unknown }).issueServiceCertificate, STR.hrCertIssued)
            }
            disabled={busy}
          />
        )}
      </Card>

      {/* Cancel (before access revoked / terminal) */}
      {!terminal && !c.accessRevoked ? (
        <View style={{ marginTop: space(4) }}>
          <Button
            title={STR.hrCancelOffboarding}
            variant="danger"
            onPress={() =>
              run(() => cancel({ caseId }), (d) => (d as { cancelOffboarding?: unknown }).cancelOffboarding, STR.hrOffboardingCancelled)
            }
            disabled={busy}
          />
        </View>
      ) : null}
    </Screen>
  );
}
