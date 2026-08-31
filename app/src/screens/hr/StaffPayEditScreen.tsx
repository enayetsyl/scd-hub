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
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AdminStackParamList } from "../../navigation/types";
import { PAYMENT_METHODS } from "@scd/shared";
import { SET_STAFF_PAY, UPDATE_STAFF_PROFILE, STAFF_PAY_HISTORY_QUERY } from "../../graphql/operations";
import {
  Screen, H2, Body, Muted, Card, Row, Field, Chip, ChipRow, Button, Divider, Notice,
} from "../../components/ui";
import { STR, bnNum, paymentMethodLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import BankDetailsFields, {
  isBankDetailsComplete,
  detailsForMethod,
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

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** This month, as YYYY-MM — the default effective month for a raise entered today. */
function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * What this person has earned, and from when (D-#587).
 *
 * Shown beside the field that changes it, because the question 'was that raise
 * recorded from July or from today' is asked at exactly the moment someone is about
 * to type another one.
 */
function PayHistoryCard({ staffProfileId }: { staffProfileId: string }): React.ReactElement | null {
  const [{ data }] = useQuery({
    query: STAFF_PAY_HISTORY_QUERY,
    variables: { staffProfileId },
    requestPolicy: "cache-and-network",
  });
  const rows = data?.staffPayHistory ?? [];
  if (rows.length === 0) return null;
  return (
    <Card>
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfPayHistory}</Body>
      {rows.map((r) => (
        <Row
          key={r.id}
          label={bnNum(r.effectiveFrom)}
          value={
            r.previousSalary != null
              ? `৳ ${bnNum(String(r.previousSalary))} → ৳ ${bnNum(String(r.monthlySalary))}`
              : `৳ ${bnNum(String(r.monthlySalary))}`
          }
        />
      ))}
      <Muted>{STR.stfPayHistoryNote}</Muted>
    </Card>
  );
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
    routingNo: staff.routingNo ?? "",
  });
  const [bankTouched, setBankTouched] = React.useState(false);
  // A raise is dated: entering it in September does not make it a September raise.
  // Defaults to this month, which is the common case (D-#587).
  const [effectiveFrom, setEffectiveFrom] = React.useState(currentMonthKey());
  const [payNote, setPayNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const amount = parseAmount(salary);
  const salaryTouched = salary.trim() !== "";
  // The field is free text on web, where keyboardType is only a hint. A salary that
  // cannot be parsed must stop here rather than travel as NaN and serialise to null,
  // which the server would read as "leave unchanged" — saving the method alone and
  // looking, to the operator, exactly like success.
  const salaryInvalid = salaryTouched && amount === null;
  // Only a CHANGED figure needs a date and a reason — re-saving the same salary,
  // or editing only the payment method, must not ask for either.
  const salaryChanged = amount !== null && amount !== (staff.monthlySalary ?? null);
  // A method with no details cannot be paid into; the disbursement file carries them.
  const bankOk = isBankDetailsComplete(method, bank);
  const canSave = !salaryInvalid && bankOk && !busy && (!salaryChanged || MONTH_KEY.test(effectiveFrom.trim()));

  async function onSave(): Promise<void> {
    setBusy(true);
    setFailure(null);
    if (canPay) {
      const res = await setPay({
        staffProfileId: staff.id,
        monthlySalary: amount,
        paymentMethod: method,
        effectiveFrom,
        payChangeNote: payNote.trim() || null,
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
          routingNo: bank.routingNo.trim(),
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
              <Chip
                key={m}
                label={paymentMethodLabel(m)}
                selected={method === m}
                // Switching method clears the NUMBER: an account number left under a
                // বিকাশ label is a payment sent somewhere else (D-#588).
                onPress={() => {
                  setBank((b) => detailsForMethod(b, method, m));
                  setMethod(m);
                }}
              />
            ))}
          </ChipRow>
        </Card>
      ) : (
        <Notice tone="info" message={STR.stfPayNeedsPayrollPerm} />
      )}

      {/* When the change takes effect, and why. Payroll pays the figure effective in
          the month being run, so a backdated raise reaches the months it belongs to
          rather than only the next one (D-#587). */}
      {canPay && salaryChanged ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfPayChangeSection}</Body>
          <Field label={STR.stfPayEffectiveFrom} value={effectiveFrom} onChangeText={setEffectiveFrom} placeholder="2026-07" />
          <Muted>{STR.stfPayEffectiveHint}</Muted>
          <Field label={STR.stfPayChangeReason} value={payNote} onChangeText={setPayNote} autoCapitalize="sentences" />
        </Card>
      ) : null}

      {canPay ? <PayHistoryCard staffProfileId={staff.id} /> : null}

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

      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
        <Button title={STR.cancel} variant="secondary" onPress={() => navigation.goBack()} />
        <Button title={STR.save} loading={busy} disabled={!canSave} onPress={() => void onSave()} />
      </View>
    </Screen>
  );
}
