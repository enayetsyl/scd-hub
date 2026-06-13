/**
 * PreparePayrollScreen — compute a monthly payroll run (prd-hr H4.2, payroll:manage).
 * Base prepare: month + working days + note. The server derives gross − unpaid-leave
 * deduction + advance recovery (net-pay guard) per staff; per-staff manual adjustments
 * are an admin extension parked for a later pass. On success → the run detail.
 */
import React from "react";
import { useMutation } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { PREPARE_PAYROLL_RUN } from "../../graphql/operations";
import type { HrStackParamList } from "../../navigation/types";
import { Screen, H2, Card, Field, Button, Notice } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";

type Props = NativeStackScreenProps<HrStackParamList, "PreparePayroll">;

const MONTH_KEY = /^\d{4}-\d{2}$/;

export default function PreparePayrollScreen({ navigation }: Props): React.ReactElement {
  const [monthKey, setMonthKey] = React.useState("");
  const [workingDays, setWorkingDays] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [, prepare] = useMutation(PREPARE_PAYROLL_RUN);

  const valid = MONTH_KEY.test(monthKey) && /^\d+$/.test(workingDays) && parseInt(workingDays, 10) > 0;

  async function submit(): Promise<void> {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const res = await prepare({
      monthKey,
      workingDays: parseInt(workingDays, 10),
      note: note.trim() === "" ? undefined : note.trim(),
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
        <Button title={STR.hrPrepare} onPress={submit} loading={busy} disabled={busy || !valid} />
      </Card>
    </Screen>
  );
}
