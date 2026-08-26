/**
 * StaffPayEditScreen (SH-9) — set ONE staff member's pay, from their hub.
 *
 * Until this, the বেতন tab could only display "—" and the salary had to be set from the
 * payroll screens on the other side of the app — the exact scatter the hub exists to
 * end, sitting inside the hub itself.
 *
 * It also collects the ACCOUNT for a non-cash method. Found in the 2026-08-26 prod E2E
 * test: the wizard let you pick ব্যাংক and never asked for an account number, so a
 * bank-paid staff member had a payment method and nothing to pay into — and the
 * disbursement export exists precisely to carry that number.
 *
 * Gate: `payroll:manage` for the salary; the account number rides `staff:manage`
 * because it lives on the profile. A caller holding only one of the two still gets the
 * half they may write, rather than a screen that refuses on save.
 */
import React from "react";
import { View } from "react-native";
import { useMutation } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AdminStackParamList } from "../../navigation/types";
import { PAYMENT_METHODS } from "@scd/shared";
import { SET_STAFF_PAY, UPDATE_STAFF_PROFILE } from "../../graphql/operations";
import {
  Screen, H2, Body, Muted, Card, Field, Chip, ChipRow, Button, Divider, Notice,
} from "../../components/ui";
import { STR, paymentMethodLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import BankDetailsFields, {
  isBankDetailsComplete,
  type BankDetails,
} from "../../components/BankDetailsFields";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "StaffPayEdit">;

/** Digits (and at most one decimal point) only — everything else is not a salary. */
function parseAmount(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function StaffPayEditScreen({ route, navigation }: Props): React.ReactElement {
  const { staff } = route.params;
  const { can } = useAuth();
  const canPay = can("payroll:manage");
  const canStaff = can("staff:manage");

  const [, setPay] = useMutation(SET_STAFF_PAY);
  const [, updateStaff] = useMutation(UPDATE_STAFF_PROFILE);

  const [salary, setSalary] = React.useState(staff.monthlySalary != null ? String(staff.monthlySalary) : "");
  const [method, setMethod] = React.useState(staff.paymentMethod ?? "bank");
  const [bank, setBank] = React.useState<BankDetails>({
    bankAccount: staff.bankAccount ?? "",
    bankAccountName: staff.bankAccountName ?? "",
    bankName: staff.bankName ?? "",
    bankBranch: staff.bankBranch ?? "",
  });
  const [bankTouched, setBankTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const amount = parseAmount(salary);
  const salaryTouched = salary.trim() !== "";
  // The field is free text on web, where keyboardType is only a hint. A salary that
  // cannot be parsed must stop here rather than travel as NaN and serialise to null,
  // which the server would read as "leave unchanged" — saving the method alone and
  // looking, to the operator, exactly like success.
  const salaryInvalid = salaryTouched && amount === null;
  // A method with no details cannot be paid into; the disbursement file carries them.
  const bankOk = isBankDetailsComplete(method, bank);
  const canSave = !salaryInvalid && bankOk && !busy;

  async function onSave(): Promise<void> {
    setBusy(true);
    setFailure(null);
    if (canPay) {
      const res = await setPay({
        staffProfileId: staff.id,
        monthlySalary: amount,
        paymentMethod: method,
      });
      if (res.error) { setBusy(false); setFailure(friendlyError(res.error)); return; }
    }
    if (canStaff) {
      const res = await updateStaff({
        staffProfileId: staff.id,
        input: {
          bankAccount: bank.bankAccount.trim(),
          bankAccountName: bank.bankAccountName.trim(),
          bankName: bank.bankName.trim(),
          bankBranch: bank.bankBranch.trim(),
        },
      });
      if (res.error) { setBusy(false); setFailure(friendlyError(res.error)); return; }
    }
    setBusy(false);
    navigation.goBack();
  }

  return (
    <Screen scroll>
      <H2>{`${STR.stfSetPay} — ${staff.nameBn || staff.name}`}</H2>
      {failure ? <Notice tone="danger" message={failure} /> : null}

      {canPay ? (
        <Card>
          <Field
            label={STR.stfMonthlySalary}
            value={salary}
            onChangeText={setSalary}
            keyboardType="numeric"
            placeholder="12345"
          />
          {salaryInvalid ? <Notice tone="danger" message={STR.stfSalaryNotANumber} /> : null}
          <Muted>{STR.stfSalaryDigitsOnly}</Muted>

          <Divider />
          <Muted>{STR.stfPaymentMethod}</Muted>
          <ChipRow>
            {PAYMENT_METHODS.map((m) => (
              <Chip key={m} label={paymentMethodLabel(m)} selected={method === m} onPress={() => setMethod(m)} />
            ))}
          </ChipRow>
        </Card>
      ) : (
        <Notice tone="info" message={STR.stfPayNeedsPayrollPerm} />
      )}

      {canStaff ? (
        <Card>
          <BankDetailsFields
            method={method}
            value={bank}
            onChange={(v) => { setBankTouched(true); setBank(v); }}
            showIncompleteWarning={bankTouched}
          />
        </Card>
      ) : null}

      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Button title={STR.cancel} variant="secondary" onPress={() => navigation.goBack()} />
        <Button title={STR.save} loading={busy} disabled={!canSave} onPress={() => void onSave()} />
      </View>
    </Screen>
  );
}
