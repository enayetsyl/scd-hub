/**
 * StaffPayScreen — set a staff member's consolidated monthly salary + payment
 * method (prd-hr H4.1, payroll:manage). There is no read of the current pay row in
 * the staff roster (Principal/Office-only field, omitted from the `staff` query), so
 * this is set-and-confirm: the saved value echoes back after a save.
 */
import React from "react";
import { useMutation } from "urql";
import { PAYMENT_METHODS } from "@scd/shared";
import { SET_STAFF_PAY } from "../../graphql/operations";
import { Screen, H2, Card, Row, Field, Select, Button, Notice } from "../../components/ui";
import { StaffSelect } from "../../components/selects";
import { STR, money, paymentMethodLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";

export default function StaffPayScreen(): React.ReactElement {
  const [staffId, setStaffId] = React.useState("");
  const [salary, setSalary] = React.useState("");
  const [method, setMethod] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<{ monthlySalary: number | null; paymentMethod: string | null } | null>(null);

  const [, setPay] = useMutation(SET_STAFF_PAY);

  const valid = staffId !== "" && (salary === "" || /^\d+(\.\d+)?$/.test(salary)) && (salary !== "" || method !== null);

  async function submit(): Promise<void> {
    if (!valid) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    const res = await setPay({
      staffProfileId: staffId,
      monthlySalary: salary === "" ? undefined : parseFloat(salary),
      paymentMethod: method ?? undefined,
    });
    setBusy(false);
    const r = res.data?.setStaffPay;
    if (res.error || !r) {
      setError(friendlyError(res.error));
      return;
    }
    setSaved({ monthlySalary: r.monthlySalary, paymentMethod: r.paymentMethod });
  }

  return (
    <Screen scroll>
      <H2>{STR.hrStaffPay}</H2>
      {error ? <Notice message={error} tone="danger" /> : null}
      {saved ? <Notice message={STR.hrPaySaved} tone="ok" /> : null}
      <Card>
        <StaffSelect label={STR.hrStaffMember} value={staffId} onChange={setStaffId} />
        <Field label={STR.hrMonthlySalary} value={salary} onChangeText={setSalary} keyboardType="decimal-pad" placeholder="0" />
        <Select
          label={STR.hrPaymentMethod}
          value={method}
          options={PAYMENT_METHODS.map((m) => ({ label: paymentMethodLabel(m), value: m }))}
          onChange={setMethod}
          placeholder={STR.hrPaymentMethod}
        />
        <Button title={STR.hrEntSave} onPress={submit} loading={busy} disabled={busy || !valid} />
      </Card>
      {saved ? (
        <Card>
          <Row label={STR.hrMonthlySalary} value={saved.monthlySalary != null ? money(saved.monthlySalary) : "—"} />
          <Row label={STR.hrPaymentMethod} value={paymentMethodLabel(saved.paymentMethod)} />
        </Card>
      ) : null}
    </Screen>
  );
}
