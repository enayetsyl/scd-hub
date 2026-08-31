/**
 * The disbursement-details rules (SH-10, D-#588) — pure, and therefore testable.
 *
 * These live in /shared rather than beside the component for the same reason
 * `payrollAdjustments` does: they are the shape of a contract between the form and the
 * write, and a `.tsx` cannot be imported by the server's test project at all. The
 * component keeps the rendering; this keeps the rules.
 */

export interface BankDetails {
  bankAccount: string;
  bankAccountName: string;
  bankName: string;
  bankBranch: string;
  /**
   * The receiving bank's routing number (D-#592).
   *
   * OPTIONAL here, deliberately. A transfer to the school's OWN bank is an internal
   * instruction that has no routing column at all, so requiring it would block the
   * majority of staff for a field their sheet never prints. A BEFTN transfer to any
   * other bank DOES need it — and the advice pack blocks that row, on the screen and
   * on the document, naming the missing number. The demand is made where the channel
   * is known, not here where it is not.
   */
  routingNo: string;
}

export const EMPTY_BANK_DETAILS: BankDetails = {
  bankAccount: "",
  bankAccountName: "",
  bankName: "",
  bankBranch: "",
  routingNo: "",
};

/**
 * Which fields a method actually requires — the single source both screens read.
 *
 *   bank  — the number, the holder's name, the bank and the branch. A transfer cannot
 *           be made from a number alone.
 *   bkash — the number only; it IS the whole instruction.
 *   cash  — nothing; cash-paid staff are excluded from the payment file by design.
 */
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

/**
 * The details to carry across when the PAYMENT METHOD changes (D-#588).
 *
 * `bankAccount` holds "the number to pay into" for both methods, so switching from
 * ব্যাংক to বিকাশ left the bank's account number sitting in the বিকাশ নম্বর field —
 * under a বিকাশ label, ready to be saved and later exported as a bKash destination.
 * The owner found it driving the join wizard.
 *
 * So the NUMBER is cleared on any change of method: an account number and a phone
 * number are different identifiers, and the wrong one here is a payment sent somewhere
 * else. The bank-only fields are KEPT — they are hidden for বিকাশ and never sent for
 * it, so keeping them costs nothing and switching back by mistake does not destroy
 * three fields of typing.
 */
export function detailsForMethod(
  prev: BankDetails,
  previousMethod: string,
  nextMethod: string,
): BankDetails {
  if (previousMethod === nextMethod) return prev;
  return { ...prev, bankAccount: "" };
}
