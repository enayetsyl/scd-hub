/**
 * D-#588 — switching payment method must not leave the previous method's number behind.
 *
 * `bankAccount` holds "the number to pay into" for both ব্যাংক and বিকাশ, so switching
 * left a bank account number sitting in the বিকাশ নম্বর field, under a বিকাশ label,
 * ready to be saved and exported as a bKash destination. The owner found it driving the
 * join wizard.
 *
 * The rules live in /shared (a .tsx cannot be imported here). A static read of the two
 * screens as well, deliberately: the rule is only worth anything if
 * BOTH the wizard and the pay screen apply it, and the thing that was wrong was that
 * neither did. Types cannot catch a missing call.
 */
import { readFileSync } from "fs";
import path from "path";

import {
  detailsForMethod,
  isBankDetailsComplete,
  EMPTY_BANK_DETAILS,
} from "@scd/shared";

const FILLED = {
  bankAccount: "0012345678901",
  bankAccountName: "Parul Begum",
  bankName: "IBBL",
  bankBranch: "Uttara",
  routingNo: "",
};

describe("detailsForMethod", () => {
  test("switching bank → bkash clears the NUMBER", () => {
    const next = detailsForMethod(FILLED, "bank", "bkash");
    expect(next.bankAccount).toBe("");
  });

  test("switching bkash → bank clears it too — a phone number is not an account number", () => {
    const next = detailsForMethod({ ...EMPTY_BANK_DETAILS, bankAccount: "01712345678" }, "bkash", "bank");
    expect(next.bankAccount).toBe("");
  });

  test("the bank-only fields are KEPT, so switching back does not destroy typing", () => {
    const next = detailsForMethod(FILLED, "bank", "bkash");
    expect(next.bankAccountName).toBe("Parul Begum");
    expect(next.bankName).toBe("IBBL");
    expect(next.bankBranch).toBe("Uttara");
  });

  test("re-selecting the SAME method changes nothing — it is not a switch", () => {
    expect(detailsForMethod(FILLED, "bank", "bank")).toEqual(FILLED);
  });

  test("after a switch the form is incomplete, so save is blocked until a number is typed", () => {
    const next = detailsForMethod(FILLED, "bank", "bkash");
    expect(isBankDetailsComplete("bkash", next)).toBe(false);
  });
});

describe("both screens actually apply the rule", () => {
  const read = (rel: string): string => readFileSync(path.resolve(__dirname, rel), "utf8");

  test.each([
    ["the join wizard", "../../../app/src/screens/admin/StaffJoinScreen.tsx"],
    ["the pay screen", "../../../app/src/screens/hr/StaffPayEditScreen.tsx"],
  ])("%s calls detailsForMethod when the method chip is pressed", (_name, rel) => {
    const src = read(rel);
    expect(src).toContain("detailsForMethod");
    // Guard against the import surviving while the call is refactored away.
    expect(src).toMatch(/detailsForMethod\(\s*b/);
  });
});

// ===========================================================================
describe("the routing number reaches the screens that collect bank details (D-#592)", () => {
  const read = (rel: string): string => readFileSync(path.resolve(__dirname, rel), "utf8");

  /**
   * The field existed on the model, in GraphQL and in the advice pack, and on the flat
   * EDIT form — but not in `BankDetailsFields`, which is what the join wizard and the
   * pay screen render. So the column could not be typed on either path anyone uses:
   * D-#577's lesson ("an argument the schema accepts is not a feature until a screen
   * sends it") repeated by the person who wrote it down. Found by the owner driving
   * prod: "i couldn't find routing number field".
   */
  test("the shared component renders it — the join wizard and the pay screen both use it", () => {
    const src = read("../../../app/src/components/BankDetailsFields.tsx");
    expect(src).toContain("stfRoutingNo");
    expect(src).toMatch(/value=\{value\.routingNo\}/);
  });

  test("both screens SAVE it, not just show it", () => {
    for (const rel of [
      "../../../app/src/screens/admin/StaffJoinScreen.tsx",
      "../../../app/src/screens/hr/StaffPayEditScreen.tsx",
    ]) {
      expect(read(rel)).toMatch(/routingNo: bank\.routingNo\.trim\(\)/);
    }
  });

  test("the pay screen SEEDS it from the record, so an edit does not blank it", () => {
    const src = read("../../../app/src/screens/hr/StaffPayEditScreen.tsx");
    expect(src).toMatch(/routingNo: staff\.routingNo \?\? ""/);
  });

  test("it is NOT required for completeness — an internal transfer has no routing column", () => {
    // Requiring it here would block every staff member at the school's own bank for a
    // field their advice sheet never prints. The demand is made where the channel is
    // known (PaymentAdviceService), not here where it is not.
    expect(isBankDetailsComplete("bank", { ...FILLED, routingNo: "" })).toBe(true);
    expect(isBankDetailsComplete("bkash", { ...EMPTY_BANK_DETAILS, bankAccount: "017", routingNo: "" })).toBe(true);
  });

  test("switching method keeps the routing number, like the other bank-only fields", () => {
    const next = detailsForMethod({ ...FILLED, routingNo: "015914152" }, "bank", "bkash");
    expect(next.routingNo).toBe("015914152");
    expect(next.bankAccount).toBe("");
  });
});
