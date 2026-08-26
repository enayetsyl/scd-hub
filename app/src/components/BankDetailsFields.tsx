/**
 * BankDetailsFields (SH-10) — the disbursement details for one payment method.
 *
 * ONE component, used by the join wizard and the per-staff pay screen, because the two
 * must agree on what "complete" means. The owner found the gap by driving the wizard:
 * selecting ব্যাংক set a payment method and never asked where to pay, so a bank-paid
 * staff member had a method and nothing behind it — and the disbursement export exists
 * precisely to carry those details.
 *
 * What each method needs:
 *   bank  — account number, account holder name, bank, branch (a transfer needs all four)
 *   bkash — the number only
 *   cash  — nothing; cash-paid staff are excluded from the payment file by design
 *
 * `isBankDetailsComplete` is exported beside the fields so a caller can BLOCK on it
 * rather than re-deriving the rule and drifting from what the form shows.
 */
import React from "react";
import { View } from "react-native";
import { Field, Muted, Notice } from "./ui";
import { STR } from "../lib/labels";

export interface BankDetails {
  bankAccount: string;
  bankAccountName: string;
  bankName: string;
  bankBranch: string;
}

export const EMPTY_BANK_DETAILS: BankDetails = {
  bankAccount: "",
  bankAccountName: "",
  bankName: "",
  bankBranch: "",
};

/** Which fields a method actually requires — the single source both screens read. */
export function isBankDetailsComplete(method: string, d: BankDetails): boolean {
  if (method === "cash") return true;
  if (method === "bkash") return d.bankAccount.trim() !== "";
  return (
    d.bankAccount.trim() !== "" &&
    d.bankAccountName.trim() !== "" &&
    d.bankName.trim() !== "" &&
    d.bankBranch.trim() !== ""
  );
}

export default function BankDetailsFields({
  method,
  value,
  onChange,
  showIncompleteWarning = false,
}: {
  method: string;
  value: BankDetails;
  onChange: (next: BankDetails) => void;
  /** Surface WHY the caller is blocking — silence would just look broken. */
  showIncompleteWarning?: boolean;
}): React.ReactElement | null {
  if (method === "cash") return null;
  const set = (k: keyof BankDetails) => (v: string) => onChange({ ...value, [k]: v });
  const bkash = method === "bkash";
  const incomplete = showIncompleteWarning && !isBankDetailsComplete(method, value);

  return (
    <View>
      <Field
        label={`${bkash ? STR.stfBkashNumber : STR.bankAccount} *`}
        value={value.bankAccount}
        onChangeText={set("bankAccount")}
        placeholder={bkash ? "01xxxxxxxxx" : undefined}
      />
      {!bkash ? (
        <>
          <Field label={`${STR.stfBankAccountName} *`} value={value.bankAccountName} onChangeText={set("bankAccountName")} />
          <Field label={`${STR.stfBankName} *`} value={value.bankName} onChangeText={set("bankName")} />
          <Field label={`${STR.stfBankBranch} *`} value={value.bankBranch} onChangeText={set("bankBranch")} />
        </>
      ) : null}
      <Muted>{STR.stfAccountNeededNote}</Muted>
      {incomplete ? <Notice tone="warn" message={STR.stfBankDetailsRequired} /> : null}
    </View>
  );
}
