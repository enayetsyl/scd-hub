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
import { isBankDetailsComplete as isComplete, type BankDetails as Details } from "@scd/shared";

// The RULES live in /shared — they are the shape of the contract between this form and
// the write, and a .tsx cannot be imported by the server test project (D-#588). They
// are re-exported here so every existing import of this module keeps working.
export {
  isBankDetailsComplete,
  detailsForMethod,
  EMPTY_BANK_DETAILS,
  type BankDetails,
} from "@scd/shared";

export default function BankDetailsFields({
  method,
  value,
  onChange,
  showIncompleteWarning = false,
}: {
  method: string;
  value: Details;
  onChange: (next: Details) => void;
  /** Surface WHY the caller is blocking — silence would just look broken. */
  showIncompleteWarning?: boolean;
}): React.ReactElement | null {
  if (method === "cash") return null;
  const set = (k: keyof Details) => (v: string) => onChange({ ...value, [k]: v });
  const bkash = method === "bkash";
  const incomplete = showIncompleteWarning && !isComplete(method, value);

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
          {/* D-#592. The routing number was added to the schema and to the flat edit
              form, but NOT here — and this component is what the join wizard and the pay
              screen render, so it could not be typed on either path anyone actually
              uses. The column existed, the advice pack read it, and nothing could fill
              it: exactly the D-#577 failure, repeated by the person who wrote it down.
              Not starred: an internal transfer has no routing column, and the advice
              pack demands it only where the channel makes it necessary. */}
          <Field label={STR.stfRoutingNo} value={value.routingNo} onChangeText={set("routingNo")} />
          <Muted>{STR.stfRoutingNoHint}</Muted>
        </>
      ) : null}
      <Muted>{STR.stfAccountNeededNote}</Muted>
      {incomplete ? <Notice tone="warn" message={STR.stfBankDetailsRequired} /> : null}
    </View>
  );
}
