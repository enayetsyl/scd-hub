/**
 * PreparePayrollScreen — compute a monthly payroll run (prd-hr H4.2, payroll:manage).
 *
 * Base prepare: month + working days + note. The server derives gross − unpaid-leave
 * deduction + advance recovery (net-pay guard) per staff.
 *
 * PER-STAFF ADJUSTMENTS (D-#585). `preparePayrollRun` has accepted an `adjustments`
 * argument since HR-3 and no screen ever sent one, so in practice a payslip could not
 * be adjusted at all. The case that surfaced it: a salary raised mid-year. Pay is
 * FORWARD-ONLY by design — editing `monthlySalary` must never silently restate months
 * already paid — so the back-pay has to arrive as an explicit বকেয়া line on one run,
 * which is exactly what this section now writes. It also covers a one-off bonus, a
 * deduction the school agreed, and a pro-rated month (payable days).
 *
 * Lines are entered per staff member and grouped into one adjustment each, because
 * that is the shape the server takes and the shape a payslip prints.
 *
 * LEAVE OVER THE BALANCE (D-#898). Once the month is typed, the server lists everyone
 * whose leave is over: held probation days, or a confirmed member's negative balance.
 * Each row is OFF until the operator says হ্যাঁ, and the days start at the full figure
 * and may be lowered. This replaced the manual "ঋণাত্মক ছুটি সমন্বয়" row, which made
 * the operator type a day count without seeing the balance it was meant to settle.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { PAY_ADDITION_TYPES, PAY_DEDUCTION_TYPES } from "@scd/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { PREPARE_PAYROLL_RUN, LEAVE_CHARGE_CANDIDATES, LATENESS_CHARGE_CANDIDATES } from "../../graphql/operations";
import {
  buildAdjustments,
  rowComplete,
  rowStarted,
  applyLeaveCharges,
  applyLatenessCharges,
  pickValid,
  latenessPickValid,
  type AdjRow,
  type LeaveChargePick,
  type LatenessPick,
} from "@scd/shared";
import type { HrStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Field,
  Select,
  Button,
  Divider,
  Notice,
  Chip,
  ChipRow,
  Loader,
} from "../../components/ui";
import { StaffSelect } from "../../components/selects";
import { STR, bnNum, payAdditionTypeLabel, payDeductionTypeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HrStackParamList, "PreparePayroll">;

const MONTH_KEY = /^\d{4}-\d{2}$/;

function blankRow(): AdjRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    staffProfileId: "",
    sign: "addition",
    // বকেয়া (arrears) is the default because the reason this section exists is a
    // mid-year raise whose back-pay has to land somewhere.
    type: "arrears",
    amount: "",
    note: "",
  };
}

export default function PreparePayrollScreen({ navigation }: Props): React.ReactElement {
  const [monthKey, setMonthKey] = React.useState("");
  const [workingDays, setWorkingDays] = React.useState("");
  const [note, setNote] = React.useState("");
  const [rows, setRows] = React.useState<AdjRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [, prepare] = useMutation(PREPARE_PAYROLL_RUN);

  const monthOk = MONTH_KEY.test(monthKey);
  const [{ data: overData, fetching: overFetching }] = useQuery({
    query: LEAVE_CHARGE_CANDIDATES,
    variables: { monthKey },
    pause: !monthOk,
    requestPolicy: "network-only",
  });
  // The operator's choices, keyed by person. Rebuilt from the server's list each time it
  // arrives so a person who is no longer over drops out, but a choice already made for
  // someone still listed is kept.
  const [picks, setPicks] = React.useState<LeaveChargePick[]>([]);
  React.useEffect(() => {
    const list = overData?.leaveChargeCandidates ?? [];
    setPicks((prev) =>
      list.map((c) => {
        const had = prev.find((p) => p.staffProfileId === c.staffProfileId && p.kind === c.kind);
        return had
          ? { ...had, maxDays: c.days }
          : { staffProfileId: c.staffProfileId, kind: c.kind, maxDays: c.days, on: false, days: String(c.days) };
      }),
    );
  }, [overData]);
  const names = new Map((overData?.leaveChargeCandidates ?? []).map((c) => [c.staffProfileId, c.name]));
  const invalidPicks = picks.filter((p) => !pickValid(p));

  function patchPick(staffProfileId: string, part: Partial<LeaveChargePick>): void {
    setPicks((ps) => ps.map((p) => (p.staffProfileId === staffProfileId ? { ...p, ...part } : p)));
  }

  // D-#908 — per-person lateness, the same shape as the leave card above: off by default,
  // days pre-filled with the most that may be charged, and a salary / leave-balance choice.
  const [{ data: lateData, fetching: lateFetching }] = useQuery({
    query: LATENESS_CHARGE_CANDIDATES,
    variables: { monthKey },
    pause: !monthOk,
    requestPolicy: "network-only",
  });
  const [latePicks, setLatePicks] = React.useState<LatenessPick[]>([]);
  React.useEffect(() => {
    const list = lateData?.latenessChargeCandidates?.rows ?? [];
    setLatePicks((prev) =>
      list.map((c) => {
        const had = prev.find((p) => p.staffProfileId === c.staffProfileId);
        return had
          ? { ...had, maxDays: c.days }
          : { staffProfileId: c.staffProfileId, maxDays: c.days, on: false, days: String(c.days), to: "salary" as const };
      }),
    );
  }, [lateData]);
  const lateRows = new Map((lateData?.latenessChargeCandidates?.rows ?? []).map((c) => [c.staffProfileId, c]));
  const invalidLate = latePicks.filter((p) => !latenessPickValid(p));
  function patchLate(staffProfileId: string, part: Partial<LatenessPick>): void {
    setLatePicks((ps) => ps.map((p) => (p.staffProfileId === staffProfileId ? { ...p, ...part } : p)));
  }

  const valid = monthOk && /^\d+$/.test(workingDays) && parseInt(workingDays, 10) > 0;
  // A half-filled row is a mistake, not an empty one: silently dropping it would mean
  // the operator watches themselves type an amount that then never reaches a payslip.
  const incompleteRows = rows.filter((r) => !rowComplete(r) && rowStarted(r));

  function patch(key: string, part: Partial<AdjRow>): void {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...part } : r)));
  }

  async function submit(): Promise<void> {
    if (!valid || incompleteRows.length > 0 || invalidPicks.length > 0 || invalidLate.length > 0) return;
    setBusy(true);
    setError(null);
    const adjustments = applyLatenessCharges(applyLeaveCharges(buildAdjustments(rows), picks), latePicks);
    const res = await prepare({
      monthKey,
      workingDays: parseInt(workingDays, 10),
      note: note.trim() === "" ? undefined : note.trim(),
      adjustments: adjustments.length > 0 ? adjustments : undefined,
    });
    setBusy(false);
    const run = res.data?.preparePayrollRun;
    if (res.error || !run) {
      setError(friendlyError(res.error));
      return;
    }
    navigation.replace("PayrollRunDetail", { runId: run.id, monthKey: run.monthKey, status: run.status });
  }

  return (
    <Screen scroll>
      <H2>{STR.hrPrepareRun}</H2>
      {error ? <Notice message={error} tone="danger" /> : null}
      <Card>
        <Field label={STR.hrPayMonth} value={monthKey} onChangeText={setMonthKey} placeholder="2026-06" />
        <Field label={STR.hrPayWorkingDays} value={workingDays} onChangeText={setWorkingDays} keyboardType="number-pad" placeholder="26" />
        <Field label={STR.hrPayNote} value={note} onChangeText={setNote} autoCapitalize="sentences" />
      </Card>

      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>
        {STR.stfLeaveChargeTitle}
      </Body>
      <Card>
        <Muted>{STR.stfLeaveChargeNote}</Muted>
        {!monthOk ? (
          <Muted style={{ marginTop: space(2) }}>{STR.stfLeaveChargeMonthFirst}</Muted>
        ) : overFetching && !overData ? (
          <Loader label={STR.loading} />
        ) : picks.length === 0 ? (
          <Muted style={{ marginTop: space(2) }}>{STR.stfLeaveChargeNone}</Muted>
        ) : (
          picks.map((p) => (
            <View key={p.staffProfileId} style={{ marginTop: space(3) }}>
              <Divider />
              <Body style={{ fontWeight: "700" }}>{names.get(p.staffProfileId) ?? ""}</Body>
              <Muted>
                {`${p.kind === "probation" ? STR.stfLeaveChargeProbation : STR.stfLeaveChargeOverdrawn}: ${bnNum(String(p.maxDays))} ${STR.stfDays}`}
              </Muted>
              <Body style={{ marginTop: space(1) }}>{STR.stfLeaveChargeAsk}</Body>
              <ChipRow>
                <Chip label={STR.stfYes} selected={p.on} onPress={() => patchPick(p.staffProfileId, { on: true })} />
                <Chip label={STR.stfNo} selected={!p.on} onPress={() => patchPick(p.staffProfileId, { on: false })} />
              </ChipRow>
              {p.on ? (
                <Field
                  label={STR.stfLeaveChargeDays}
                  value={p.days}
                  onChangeText={(v) => patchPick(p.staffProfileId, { days: v })}
                  keyboardType="numeric"
                />
              ) : null}
            </View>
          ))
        )}
      </Card>
      {invalidPicks.length > 0 ? <Notice tone="warn" message={STR.stfLeaveChargeInvalid} /> : null}

      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>
        {STR.stfLateChargeTitle}
      </Body>
      <Card>
        <Muted>{STR.stfLateChargeNote}</Muted>
        {!monthOk ? (
          <Muted style={{ marginTop: space(2) }}>{STR.stfLeaveChargeMonthFirst}</Muted>
        ) : lateFetching && !lateData ? (
          <Loader label={STR.loading} />
        ) : lateData?.latenessChargeCandidates?.ruleOn ? (
          <Notice tone="info" message={STR.stfLateChargeRuleOn} />
        ) : latePicks.length === 0 ? (
          <Muted style={{ marginTop: space(2) }}>{STR.stfLateChargeNone}</Muted>
        ) : (
          latePicks.map((p) => {
            const c = lateRows.get(p.staffProfileId);
            return (
              <View key={p.staffProfileId} style={{ marginTop: space(3) }}>
                <Divider />
                <Body style={{ fontWeight: "700" }}>{c?.name ?? ""}</Body>
                <Muted>
                  {STR.stfLateChargeLine
                    .replace("{late}", bnNum(String(c?.lateCount ?? 0)))
                    .replace("{days}", bnNum(String(p.maxDays)))
                    .replace("{per}", bnNum(String(lateData?.latenessChargeCandidates?.lateDaysPerCharge ?? 3)))}
                </Muted>
                <Body style={{ marginTop: space(1) }}>{STR.stfLeaveChargeAsk}</Body>
                <ChipRow>
                  <Chip label={STR.stfYes} selected={p.on} onPress={() => patchLate(p.staffProfileId, { on: true })} />
                  <Chip label={STR.stfNo} selected={!p.on} onPress={() => patchLate(p.staffProfileId, { on: false })} />
                </ChipRow>
                {p.on ? (
                  <>
                    <Field
                      label={STR.stfLeaveChargeDays}
                      value={p.days}
                      onChangeText={(v) => patchLate(p.staffProfileId, { days: v })}
                      keyboardType="numeric"
                    />
                    <Body style={{ marginBottom: space(1) }}>{STR.stfLateChargeTo}</Body>
                    <ChipRow>
                      <Chip label={STR.stfLateChargeSalary} selected={p.to === "salary"} onPress={() => patchLate(p.staffProfileId, { to: "salary" })} />
                      <Chip label={STR.stfLateChargeLeave} selected={p.to === "leave"} onPress={() => patchLate(p.staffProfileId, { to: "leave" })} />
                    </ChipRow>
                  </>
                ) : null}
              </View>
            );
          })
        )}
      </Card>
      {invalidLate.length > 0 ? <Notice tone="warn" message={STR.stfLeaveChargeInvalid} /> : null}

      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(2) }}>
        {STR.stfAdjustmentsTitle}
      </Body>
      <Card>
        <Muted>{STR.stfAdjustmentsNote}</Muted>
        {rows.map((r) => (
          <View key={r.key} style={{ marginTop: space(3) }}>
            <Divider />
            <StaffSelect
              label={STR.hrStaffMember}
              value={r.staffProfileId}
              onChange={(v) => patch(r.key, { staffProfileId: v })}
            />
            <Select
              label={STR.stfAdjustmentSign}
              value={r.sign}
              options={[
                { label: STR.stfAdjustmentAddition, value: "addition" },
                { label: STR.stfAdjustmentDeduction, value: "deduction" },
                // ঋণাত্মক ছুটি সমন্বয় moved to the leave list above (D-#898), where the
                // balance is shown and the days are capped at it.
                { label: STR.stfAdjustmentAdvanceRecovery, value: "advance_recovery" },
              ]}
              // Switching side must clear the type: an addition type is not a valid
              // deduction type, and the server would reject it at prepare.
              onChange={(v) =>
                patch(r.key, {
                  sign: (v ?? "addition") as AdjRow["sign"],
                  // A recovery row has no money type — its amount is DAYS (D-#617).
                  type: v === "addition" ? "arrears" : null,
                })
              }
            />
            {/* Neither recovery kind is a money LINE, so neither picks a money type. */}
            {r.sign === "addition" || r.sign === "deduction" ? (
              <Select
                label={STR.stfAdjustmentType}
                value={r.type}
                options={(r.sign === "addition" ? PAY_ADDITION_TYPES : PAY_DEDUCTION_TYPES).map((t) => ({
                  label: r.sign === "addition" ? payAdditionTypeLabel(t) : payDeductionTypeLabel(t),
                  value: t,
                }))}
                onChange={(v) => patch(r.key, { type: v })}
                placeholder={STR.stfAdjustmentType}
              />
            ) : null}
            {r.sign === "advance_recovery" ? (
              // The loan's own outstanding balance IS the amount — there is nothing to
              // type, and a field here would only invite a figure that disagrees with it.
              <Muted>{STR.stfAdjustmentAdvanceRecoveryHint}</Muted>
            ) : (
              <Field
                label={r.sign === "leave_recovery" ? STR.stfAdjustmentRecoveryDays : STR.stfAdjustmentAmount}
                value={r.amount}
                onChangeText={(v) => patch(r.key, { amount: v })}
                keyboardType="numeric"
                placeholder="0"
              />
            )}
            <Field
              label={STR.stfAdjustmentReason}
              value={r.note}
              onChangeText={(v) => patch(r.key, { note: v })}
              placeholder={STR.stfAdjustmentReasonPlaceholder}
              autoCapitalize="sentences"
            />
            <Button
              title={STR.remove}
              variant="secondary"
              onPress={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            />
          </View>
        ))}
        <Button
          title={STR.stfAdjustmentAdd}
          variant="secondary"
          style={{ marginTop: space(3) }}
          onPress={() => setRows((rs) => [...rs, blankRow()])}
        />
      </Card>

      {incompleteRows.length > 0 ? <Notice tone="warn" message={STR.stfAdjustmentIncomplete} /> : null}

      <Button
        title={STR.hrPrepare}
        onPress={submit}
        loading={busy}
        disabled={busy || !valid || incompleteRows.length > 0 || invalidPicks.length > 0 || invalidLate.length > 0}
        style={{ marginTop: space(3) }}
      />
    </Screen>
  );
}
