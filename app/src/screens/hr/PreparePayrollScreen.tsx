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
 */
import React from "react";
import { View } from "react-native";
import { useMutation } from "urql";
import { PAY_ADDITION_TYPES, PAY_DEDUCTION_TYPES } from "@scd/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { PREPARE_PAYROLL_RUN } from "../../graphql/operations";
import { buildAdjustments, rowComplete, rowStarted, type AdjRow } from "../../lib/payrollAdjustments";
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
} from "../../components/ui";
import { StaffSelect } from "../../components/selects";
import { STR, payAdditionTypeLabel, payDeductionTypeLabel } from "../../lib/labels";
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

  const valid = MONTH_KEY.test(monthKey) && /^\d+$/.test(workingDays) && parseInt(workingDays, 10) > 0;
  // A half-filled row is a mistake, not an empty one: silently dropping it would mean
  // the operator watches themselves type an amount that then never reaches a payslip.
  const incompleteRows = rows.filter((r) => !rowComplete(r) && rowStarted(r));

  function patch(key: string, part: Partial<AdjRow>): void {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...part } : r)));
  }

  async function submit(): Promise<void> {
    if (!valid || incompleteRows.length > 0) return;
    setBusy(true);
    setError(null);
    const adjustments = buildAdjustments(rows);
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
              ]}
              // Switching side must clear the type: an addition type is not a valid
              // deduction type, and the server would reject it at prepare.
              onChange={(v) =>
                patch(r.key, {
                  sign: (v ?? "addition") as AdjRow["sign"],
                  type: v === "deduction" ? null : "arrears",
                })
              }
            />
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
            <Field
              label={STR.stfAdjustmentAmount}
              value={r.amount}
              onChangeText={(v) => patch(r.key, { amount: v })}
              keyboardType="numeric"
              placeholder="0"
            />
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
        disabled={busy || !valid || incompleteRows.length > 0}
        style={{ marginTop: space(3) }}
      />
    </Screen>
  );
}
