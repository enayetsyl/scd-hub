/**
 * MyLeaveScreen — a staff member's own leave self-service (prd-hr H2.7, own-row).
 * Shows per-type balances for the current academic year, the list of own
 * applications (with the approval paid/unpaid split + any exceed warning), an
 * apply form, own-cancel, and a link to each application's cover slots.
 * All reads/writes are own-row (no permission); the server resolves the caller's
 * StaffProfile via the phone link.
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import { LEAVE_TYPES, LEAVE_DAY_PARTS } from "@scd/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ACADEMIC_YEARS_QUERY,
  MY_STAFF_LEAVE_QUERY,
  MY_STAFF_LEAVE_BALANCES_QUERY,
  APPLY_FOR_STAFF_LEAVE,
  DECIDE_STAFF_LEAVE,
  type StaffLeaveT,
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
  Field,
  Select,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { STR, bnNum, leaveTypeLabel, leaveStatusLabel, leaveDayPartLabel, leavePartialSummary } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { DateField } from "../../components/DateField";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "MyLeave">;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The longest school day is 8 periods (PeriodGrid class_1_5, D-#57); the server
 *  clamps a bigger count down to the staff member's own last teaching period. */
const MAX_PARTIAL_PERIODS = 8;

function statusTone(s: string): "info" | "ok" | "danger" | "muted" {
  return s === "approved" ? "ok" : s === "rejected" ? "danger" : s === "cancelled" ? "muted" : "info";
}

function fmtDate(iso: string | null): string {
  return iso ? bnNum(iso.slice(0, 10)) : "—";
}

export default function MyLeaveScreen({ navigation }: Props): React.ReactElement {
  const { confirmAction } = useConfirm();
  const [leaveType, setLeaveType] = React.useState<string | null>(null);
  const [fromKey, setFromKey] = React.useState("");
  const [toKey, setToKey] = React.useState("");
  const [dayPart, setDayPart] = React.useState<string>("full");
  const [periodCount, setPeriodCount] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const years = yearsQ.data?.academicYears ?? [];
  const yearId = (years.find((y) => y.current) ?? years[0])?.id ?? "";

  const [leaveQ, refetchLeave] = useQuery({ query: MY_STAFF_LEAVE_QUERY });
  const [balQ, refetchBal] = useQuery({
    query: MY_STAFF_LEAVE_BALANCES_QUERY,
    variables: { academicYearId: yearId },
    pause: yearId === "",
  });

  const [, applyLeave] = useMutation(APPLY_FOR_STAFF_LEAVE);
  const [, decideLeave] = useMutation(DECIDE_STAFF_LEAVE);

  const applications = leaveQ.data?.myStaffLeave ?? [];
  const balances = balQ.data?.myStaffLeaveBalances ?? [];

  // A partial day (D-#361) is single-date only, so the day-part control appears only
  // once both dates are set and equal — and any date edit that breaks that resets it,
  // so a multi-day application can never carry a stale "early leave" into submit.
  const sameDay = ISO_DATE.test(fromKey) && fromKey === toKey;
  React.useEffect(() => {
    if (!sameDay && dayPart !== "full") {
      setDayPart("full");
      setPeriodCount(null);
    }
  }, [sameDay, dayPart]);

  const isPartial = dayPart !== "full";
  const formValid =
    leaveType &&
    ISO_DATE.test(fromKey) &&
    ISO_DATE.test(toKey) &&
    reason.trim() !== "" &&
    (!isPartial || (sameDay && periodCount !== null));

  async function submit(): Promise<void> {
    if (!formValid) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await applyLeave({
      leaveType: leaveType!,
      fromKey,
      toKey,
      reason: reason.trim(),
      dayPart: isPartial ? dayPart : undefined,
      partialPeriodCount: isPartial ? parseInt(periodCount!, 10) : undefined,
    });
    setBusy(false);
    if (res.error || !res.data?.applyForStaffLeave) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrLeaveApplied);
    setLeaveType(null);
    setFromKey("");
    setToKey("");
    setDayPart("full");
    setPeriodCount(null);
    setReason("");
    refetchLeave({ requestPolicy: "network-only" });
    refetchBal({ requestPolicy: "network-only" });
  }

  async function cancel(app: StaffLeaveT): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.hrLeaveCancel }))) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await decideLeave({ applicationId: app.id, decision: "cancel" });
    setBusy(false);
    if (res.error || !res.data?.decideStaffLeave) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrLeaveCancelled);
    refetchLeave({ requestPolicy: "network-only" });
    refetchBal({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.hrMyLeave}</H2>

      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {/* Balances */}
      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.hrLeaveBalances}</Body>
      {balQ.fetching ? (
        <Loader label={STR.loading} />
      ) : balances.length === 0 ? (
        <Card>
          <Muted>{STR.empty}</Muted>
        </Card>
      ) : (
        balances.map((b) => (
          <Card key={b.leaveType}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>{leaveTypeLabel(b.leaveType)}</Body>
              {b.paid ? null : <Badge text={STR.hrLeaveUnpaidBadge} tone="muted" />}
            </View>
            {b.balanceTracked ? (
              <>
                <Row label={STR.hrLeaveAllowance} value={bnNum(b.allowanceDays)} />
                <Row label={STR.hrLeaveCarried} value={bnNum(b.carriedOverDays)} />
                <Row label={STR.hrLeaveTaken} value={bnNum(b.takenDays)} />
                <Row label={STR.hrLeaveRemaining} value={bnNum(b.remainingDays)} />
                <Row label={STR.hrLeaveEncashable} value={bnNum(b.encashableDays)} />
              </>
            ) : (
              <Muted>{STR.hrLeaveTaken}: {bnNum(b.takenDays)}</Muted>
            )}
          </Card>
        ))
      )}

      {/* Apply form */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrApplyLeave}</Body>
      <Card>
        <Select
          label={STR.hrLeaveType}
          value={leaveType}
          options={LEAVE_TYPES.map((t) => ({ label: leaveTypeLabel(t), value: t }))}
          onChange={setLeaveType}
          placeholder={STR.hrLeaveType}
        />
        <DateField label={STR.hrLeaveFrom} value={fromKey} onChange={setFromKey} helper={STR.hrDateHint} />
        <DateField label={STR.hrLeaveTo} value={toKey} onChange={setToKey} min={fromKey || undefined} helper={STR.hrDateHint} />
        {sameDay ? (
          <>
            <Select
              label={STR.hrLeaveDayPart}
              value={dayPart}
              options={LEAVE_DAY_PARTS.map((p) => ({ label: leaveDayPartLabel(p), value: p }))}
              onChange={(v) => setDayPart(v ?? "full")}
              placeholder={STR.hrLeaveDayPart}
            />
            {isPartial ? (
              <>
                <Select
                  label={STR.hrLeavePartialPeriods}
                  value={periodCount}
                  options={Array.from({ length: MAX_PARTIAL_PERIODS }, (_, i) => ({
                    label: `${bnNum(i + 1)} ${STR.hrLeavePeriodShort}`,
                    value: String(i + 1),
                  }))}
                  onChange={setPeriodCount}
                  placeholder={STR.hrLeavePartialPeriods}
                />
                <Muted>{STR.hrLeavePartialHint}</Muted>
                <Muted>{STR.hrLeavePartialThird}</Muted>
              </>
            ) : null}
          </>
        ) : null}
        <Field
          label={STR.hrLeaveReason}
          value={reason}
          onChangeText={setReason}
          placeholder={STR.hrLeaveReasonPlaceholder}
          multiline
          autoCapitalize="sentences"
        />
        <Button title={STR.hrLeaveSubmit} onPress={submit} loading={busy} disabled={busy || !formValid} />
      </Card>

      {/* My applications */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>{STR.hrLeaveMyApplications}</Body>
      {leaveQ.fetching ? (
        <Loader label={STR.loading} />
      ) : leaveQ.error ? (
        <ErrorBanner message={friendlyError(leaveQ.error)} onRetry={() => refetchLeave({ requestPolicy: "network-only" })} />
      ) : applications.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        applications.map((a) => (
          <Card key={a.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Body style={{ fontWeight: "700", flex: 1 }}>{leaveTypeLabel(a.leaveType)}</Body>
              <Badge text={leaveStatusLabel(a.status)} tone={statusTone(a.status)} />
            </View>
            <Muted>
              {fmtDate(a.fromKey)} – {fmtDate(a.toKey)} · {bnNum(a.days)} {STR.hrLeaveDays}
            </Muted>
            {leavePartialSummary(a.dayPart, a.partialPeriods) ? (
              <Muted>{leavePartialSummary(a.dayPart, a.partialPeriods)}</Muted>
            ) : null}
            <Muted>{a.reason}</Muted>
            {a.status === "approved" && a.paidDays != null ? (
              <Muted>
                {STR.hrLeavePaid}: {bnNum(a.paidDays)} · {STR.hrLeaveUnpaid}: {bnNum(a.unpaidDays ?? 0)}
              </Muted>
            ) : null}
            {a.exceedWarning ? <Notice message={a.exceedWarning} tone="warn" /> : null}
            {a.decisionNote ? <Muted>“{a.decisionNote}”</Muted> : null}
            <Divider />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              <Button
                title={STR.hrLeaveViewCover}
                variant="secondary"
                onPress={() =>
                  navigation.navigate("LeaveCover", { leaveApplicationId: a.id, title: leaveTypeLabel(a.leaveType), manage: false })
                }
              />
              {a.status === "applied" || a.status === "approved" ? (
                <Button title={STR.hrLeaveCancel} variant="danger" onPress={() => cancel(a)} disabled={busy} />
              ) : null}
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
