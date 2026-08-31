/**
 * D-#591 — the bank advice pack: which sheet a person belongs on, what blocks a row,
 * and the amount in words the covering letter quotes.
 *
 * The school's own June 2026 pack is the specification, so the figures here are its
 * figures: 160,500 internal and 43,000 by BEFTN.
 */
import {
  sameBank,
  channelFor,
  blockReasonFor,
  paymentInfoFor,
  adviceLetterDate,
} from "../modules/hr/services/PaymentAdviceService";
import { takaInWords, takaFigure } from "../modules/hr/services/takaWords";

const SCHOOL_BANK = "Islami Bank Bangladesh PLC";

const row = (over: Partial<Parameters<typeof blockReasonFor>[1]> = {}) => ({
  staffProfileId: "x",
  name: "Someone",
  accountName: "Someone",
  account: "20503217400016414",
  bankName: SCHOOL_BANK,
  bankBranch: "Dakshin Surma",
  routingNo: "015914152",
  amount: 10000,
  ...over,
});

// ===========================================================================
describe("which sheet a person belongs on", () => {
  test("the school's own bank is an INTERNAL transfer, anything else is BEFTN", () => {
    expect(channelFor("bank", SCHOOL_BANK, SCHOOL_BANK)).toBe("internal");
    expect(channelFor("bank", "Pubali Bank", SCHOOL_BANK)).toBe("beftn");
  });

  test("cash and bKash are their own lists — neither goes on a bank sheet", () => {
    expect(channelFor("cash", null, SCHOOL_BANK)).toBe("cash");
    expect(channelFor("bkash", null, SCHOOL_BANK)).toBe("bkash");
  });

  test("bank names match through spacing, case and Ltd/PLC noise", () => {
    expect(sameBank("islami bank bangladesh plc", SCHOOL_BANK)).toBe(true);
    expect(sameBank("Islami Bank Bangladesh Ltd.", "Islami Bank Bangladesh")).toBe(true);
    expect(sameBank("  ISLAMI BANK BANGLADESH  PLC. ", SCHOOL_BANK)).toBe(true);
  });

  test("a different bank never matches, and a blank never matches anything", () => {
    expect(sameBank("Pubali Bank", SCHOOL_BANK)).toBe(false);
    expect(sameBank("", SCHOOL_BANK)).toBe(false);
    expect(sameBank(null, null)).toBe(false);
  });

  /**
   * D-#597. This is where the old rule was wrong, and the old test asserted the wrong
   * thing: it matched when either name CONTAINED the other, so `sameBank("Islami Bank",
   * SCHOOL_BANK)` was true and looked like sensible forgiveness. Half the banks here
   * share a word. The school's own bank name is free text on the HR-policy screen, so
   * shortening it to "Islami Bank" would have matched AL-ARAFAH Islami Bank, Social
   * Islami Bank and EXIM — moving those staff onto the internal sheet, which has no
   * routing column, so they would have read as payable while being unissuable.
   */
  test("a SHORTER name is a different bank — containment must not match", () => {
    expect(sameBank("Al-Arafah Islami Bank", SCHOOL_BANK)).toBe(false);
    expect(sameBank("Social Islami Bank", SCHOOL_BANK)).toBe(false);
    expect(sameBank("Islami Bank", SCHOOL_BANK)).toBe(false);
    // And the trap in its original form: the letterhead name typed short.
    expect(channelFor("bank", "Al-Arafah Islami Bank", "Islami Bank")).toBe("beftn");
  });

  test("an UNSET school bank puts everyone on BEFTN — the sheet that demands more, not less", () => {
    // The safe direction: BEFTN requires a routing number, so an unconfigured school
    // bank surfaces as blocked rows rather than a wrongly-issued internal transfer.
    expect(channelFor("bank", "Pubali Bank", "")).toBe("beftn");
    expect(channelFor("bank", SCHOOL_BANK, "")).toBe("beftn");
  });
});

// ===========================================================================
describe("what stops a row being instructed", () => {
  test("a payable internal row needs the account and the account NAME, nothing more", () => {
    expect(blockReasonFor("internal", row())).toBeNull();
    expect(blockReasonFor("internal", row({ account: null }))).toBe("অ্যাকাউন্ট নম্বর নেই");
    expect(blockReasonFor("internal", row({ accountName: null }))).toBe("হিসাবধারীর নাম নেই");
    // The internal sheet has no bank/branch/routing columns at all.
    expect(blockReasonFor("internal", row({ bankBranch: null, routingNo: null }))).toBeNull();
  });

  test("BEFTN additionally needs bank, branch and ROUTING NUMBER", () => {
    expect(blockReasonFor("beftn", row())).toBeNull();
    expect(blockReasonFor("beftn", row({ bankName: null }))).toBe("ব্যাংকের নাম নেই");
    expect(blockReasonFor("beftn", row({ bankBranch: null }))).toBe("শাখার নাম নেই");
    expect(blockReasonFor("beftn", row({ routingNo: null }))).toBe("রাউটিং নম্বর নেই");
  });

  test("bKash needs only the number; cash needs nothing to instruct", () => {
    expect(blockReasonFor("bkash", row({ accountName: null, bankName: null, routingNo: null }))).toBeNull();
    expect(blockReasonFor("bkash", row({ account: null }))).toBe("অ্যাকাউন্ট নম্বর নেই");
    expect(blockReasonFor("cash", row({ account: null, accountName: null }))).toBeNull();
  });

  test("a zero net is blocked on EVERY channel — there is nothing to pay", () => {
    for (const c of ["internal", "beftn", "bkash", "cash"] as const) {
      expect(blockReasonFor(c, row({ amount: 0 }))).toBe("নিট বেতন শূন্য");
    }
  });
});

// ===========================================================================
describe("the letter's own wording", () => {
  test("the total in words uses the BANGLADESHI grouping, as the school's letter does", () => {
    // The June letter: "Tk. 160,500/- (One Lac Sixty Thousand Five Hundred Only)".
    expect(takaInWords(160500)).toBe("One Lac Sixty Thousand Five Hundred Only");
    expect(takaFigure(160500)).toBe("160,500");
    // NOT "One Hundred Sixty Thousand…", which is what an international grouping gives.
    expect(takaInWords(160500)).not.toContain("Hundred Sixty Thousand");
  });

  test("the BEFTN letter's figure", () => {
    expect(takaInWords(43000)).toBe("Forty Three Thousand Only");
  });

  test("crore, and the awkward small cases", () => {
    expect(takaInWords(12345678)).toBe("One Crore Twenty Three Lac Forty Five Thousand Six Hundred Seventy Eight Only");
    expect(takaInWords(0)).toBe("Zero Only");
    expect(takaInWords(1)).toBe("One Only");
    expect(takaInWords(100)).toBe("One Hundred Only");
    expect(takaInWords(1000)).toBe("One Thousand Only");
    expect(takaInWords(100000)).toBe("One Lac Only");
    expect(takaInWords(15)).toBe("Fifteen Only");
  });

  test("the Payment Info column reads as the school writes it", () => {
    expect(paymentInfoFor("2026-06")).toBe("SCD Jun '26 Salary");
    expect(paymentInfoFor("2026-12")).toBe("SCD Dec '26 Salary");
  });

  test("June's salary is advised on 1 July — the letter is dated the month AFTER", () => {
    expect(adviceLetterDate("2026-06")).toBe("2026-07-01");
    // And December rolls the year, which is exactly where an off-by-one would hide.
    expect(adviceLetterDate("2026-12")).toBe("2027-01-01");
  });
});
