/**
 * LeaveAdminScreen — the Principal/Office leave surface (prd-hr H2, leave:manage):
 * review applications by status, approve/reject (the exceed rule only warns —
 * surfaced on the card), open a leave's cover slots to approve them → proxy, and
 * grant/edit per-staff annual leave entitlements. Server gates leave:manage and
 * denies in-band; this screen is reached only when the caller holds it.
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import { LEAVE_TYPES, LEAVE_STATUSES } from "@scd/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  STAFF_LEAVE_APPLICATIONS_QUERY,
  DECIDE_STAFF_LEAVE,
  UPSERT_STAFF_LEAVE_ENTITLEMENT,
  STAFF_QUERY,
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
  Chip,
  ChipRow,
  Field,
  Select,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { StaffSelect, AcademicYearSelect } from "../../components/selects";
import { STR, bnNum, leaveTypeLabel, leaveStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "LeaveAdmin">;

function statusTone(s: string): "info" | "ok" | "danger" | "muted" {
  return s === "approved" ? "ok" : s === "rejected" ? "danger" : s === "cancelled" ? "muted" : "info";
}

function fmtDate(iso: string | null): string {
  return iso ? bnNum(iso.slice(0, 10)) : "—";
}

export default function LeaveAdminScreen({ navigation }: Props): React.ReactElement {
  const [status, setStatus] = React.useState<string | null>("applied");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  // Entitlement editor state
  const [entStaff, setEntStaff] = React.useState("");
  const [entYear, setEntYear] = React.useState("");
  const [entType, setEntType] = React.useState<string | null>(null);
  const [entAllowance, setEntAllowance] = React.useState("");
  const [entCarried, setEntCarried] = React.useState("");
  const [entNote, setEntNote] = React.useState("");

  const [appsQ, refetchApps] = useQuery({
    query: STAFF_LEAVE_APPLICATIONS_QUERY,
    variables: { status: status ?? undefined },
  });
  const [staffQ] = useQuery({ query: STAFF_QUERY, variables: {} });

  const [, decide] = useMutation(DECIDE_STAFF_LEAVE);
  const [, upsertEnt] = useMutation(UPSERT_STAFF_LEAVE_ENTITLEMENT);

  const apps = appsQ.data?.staffLeaveApplications ?? [];
  const staffName = new Map((staffQ.data?.staff ?? []).map((s) => [s.id, s.nameBn || s.name]));

  async function runDecide(applicationId: string, decision: "approve" | "reject"): Promise<void> {
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await decide({ applicationId, decision });
    setBusy(false);
    if (res.error || !res.data?.decideStaffLeave) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(decision === "approve" ? STR.hrLeaveApproved : STR.hrLeaveRejected);
    refetchApps({ requestPolicy: "network-only" });
  }

  const entValid = entStaff !== "" && entYear !== "" && entType && /^\d+$/.test(entAllowance);

  async function saveEntitlement(): Promise<void> {
    if (!entValid) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await upsertEnt({
      staffProfileId: entStaff,
      academicYearId: entYear,
      leaveType: entType!,
      allowanceDays: parseInt(entAllowance, 10),
      carriedOverDays: /^\d+$/.test(entCarried) ? parseInt(entCarried, 10) : undefined,
      note: entNote.trim() === "" ? undefined : entNote.trim(),
    });
    setBusy(false);
    if (res.error || !res.data?.upsertStaffLeaveEntitlement) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrEntSaved);
    setEntAllowance("");
    setEntCarried("");
    setEntNote("");
  }

  return (
    <Screen scroll>
      <H2>{STR.hrLeaveAdmin}</H2>

      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {/* Status filter */}
      <Muted style={{ marginBottom: space(1) }}>{STR.hrLeaveStatusFilter}</Muted>
      <ChipRow>
        {LEAVE_STATUSES.map((s) => (
          <Chip key={s} label={leaveStatusLabel(s)} selected={status === s} onPress={() => setStatus(s)} />
        ))}
        <Chip label={STR.allCategories} selected={status === null} onPress={() => setStatus(null)} />
      </ChipRow>

      {appsQ.fetching ? (
        <Loader label={STR.loading} />
      ) : appsQ.error ? (
        <ErrorBanner message={friendlyError(appsQ.error)} onRetry={() => refetchApps({ requestPolicy: "network-only" })} />
      ) : apps.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        apps.map((a) => (
          <Card key={a.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700", flex: 1 }}>{staffName.get(a.staffProfileId) ?? STR.hrApplicant}</Body>
              <Badge text={leaveStatusLabel(a.status)} tone={statusTone(a.status)} />
            </View>
            <Muted>
              {leaveTypeLabel(a.leaveType)} · {fmtDate(a.fromKey)} – {fmtDate(a.toKey)} · {bnNum(a.days)} {STR.hrLeaveDays}
            </Muted>
            <Muted>{a.reason}</Muted>
            {a.status === "approved" && a.paidDays != null ? (
              <Muted>{STR.hrLeavePaid}: {bnNum(a.paidDays)} · {STR.hrLeaveUnpaid}: {bnNum(a.unpaidDays ?? 0)}</Muted>
            ) : null}
            {a.exceedWarning ? <Notice message={a.exceedWarning} tone="warn" /> : null}
            <Divider />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              {a.status === "applied" ? (
                <>
                  <Button title={STR.hrLeaveApprove} onPress={() => runDecide(a.id, "approve")} disabled={busy} />
                  <Button title={STR.hrLeaveReject} variant="danger" onPress={() => runDecide(a.id, "reject")} disabled={busy} />
                </>
              ) : null}
              <Button
                title={STR.hrLeaveManageCover}
                variant="secondary"
                onPress={() => navigation.navigate("LeaveCover", { leaveApplicationId: a.id, title: leaveTypeLabel(a.leaveType), manage: true })}
              />
            </View>
          </Card>
        ))
      )}

      {/* Entitlement editor */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrEntitlements}</Body>
      <Card>
        <StaffSelect label={STR.hrStaffMember} value={entStaff} onChange={setEntStaff} />
        <AcademicYearSelect label={STR.hrYear} value={entYear} onChange={setEntYear} />
        <Select
          label={STR.hrLeaveType}
          value={entType}
          options={LEAVE_TYPES.map((t) => ({ label: leaveTypeLabel(t), value: t }))}
          onChange={setEntType}
          placeholder={STR.hrLeaveType}
        />
        <Field label={STR.hrEntAllowance} value={entAllowance} onChangeText={setEntAllowance} keyboardType="number-pad" placeholder="0" />
        <Field label={STR.hrEntCarried} value={entCarried} onChangeText={setEntCarried} keyboardType="number-pad" placeholder="0" />
        <Field label={STR.hrEntNote} value={entNote} onChangeText={setEntNote} autoCapitalize="sentences" />
        <Button title={STR.hrEntSave} onPress={saveEntitlement} loading={busy} disabled={busy || !entValid} />
      </Card>
    </Screen>
  );
}
