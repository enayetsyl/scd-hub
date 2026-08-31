/**
 * PaymentAdviceService (D-#591) — the documents the bank actually receives.
 *
 * The school's own June 2026 pack is the specification: TWO covering letters and TWO
 * advice sheets, both addressed to the manager of the school's bank, each quoting the
 * school's bearing account and a total in words.
 *
 *   internal — staff banking with the SCHOOL'S OWN bank. One sheet, no bank/branch
 *              columns (they are all the same bank) and no routing number.
 *   beftn    — staff at any other bank. The sheet carries bank, branch and ROUTING NO,
 *              because a BEFTN instruction cannot be issued without one.
 *   cash     — handed over by the office. On neither bank sheet, but listed, because a
 *              person who is simply absent from every sheet is a person who does not
 *              get paid.
 *   bkash    — its own list for the same reason. The June pack has none; the app
 *              supports it, so it is shown rather than silently dropped.
 *
 * THE SPLIT IS DERIVED, NOT TYPED. A staff member whose `bankName` matches the school's
 * own bank is internal; everyone else is BEFTN. A typo therefore lands someone on the
 * BEFTN sheet, where a missing routing number BLOCKS them — the safe direction. The
 * alternative, a per-staff channel field, is one more thing to keep in step with the
 * bank name it would have to agree with anyway.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import type { PaymentChannel } from "@scd/shared";
import { PayrollRun } from "../models/PayrollRun";
import { Payslip, type IPayslip } from "../models/Payslip";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { getHrPolicy, type HrPolicyView } from "./HrPolicyService";
import { PayrollError } from "./payrollMath";

export interface AdviceRow {
  staffProfileId: string;
  name: string;
  /** The name the account is held in — what the bank matches, not always the same. */
  accountName: string | null;
  account: string | null;
  bankName: string | null;
  bankBranch: string | null;
  routingNo: string | null;
  amount: number;
  /** null when payable; otherwise why this row cannot be instructed. */
  blockedReason: string | null;
}

export interface AdviceGroup {
  channel: PaymentChannel;
  rows: AdviceRow[];
  /** Payable rows only — what the letter asks the bank to move. */
  total: number;
  blocked: AdviceRow[];
}

export interface PaymentAdvice {
  monthKey: string;
  /** "SCD Jun '26 Salary" — the Payment Info every row carries on the school's sheets. */
  paymentInfo: string;
  /** The letter's own date: salaries for a month are advised at the start of the next. */
  letterDate: string;
  policy: HrPolicyView;
  groups: AdviceGroup[];
}

const NO_ACCOUNT = "অ্যাকাউন্ট নম্বর নেই";
const NO_ACCOUNT_NAME = "হিসাবধারীর নাম নেই";
const NO_BANK = "ব্যাংকের নাম নেই";
const NO_BRANCH = "শাখার নাম নেই";
const NO_ROUTING = "রাউটিং নম্বর নেই";
const ZERO_NET = "নিট বেতন শূন্য";

/**
 * Bank names differ by spacing, case and punctuation — compare on letters and digits.
 *
 * EQUALITY ONLY, not containment (D-#597). The first cut also matched when either name
 * contained the other, to forgive "Islami Bank" vs "Islami Bank Bangladesh PLC". But
 * half the banks here share a word: with the school's own name shortened to
 * "Islami Bank", every staff member at AL-ARAFAH Islami Bank, Social Islami Bank and
 * EXIM matched it and moved to the INTERNAL sheet — which carries no routing column, so
 * they would have looked perfectly payable while the instruction was unissuable. The
 * school's own name is free text on the HR-policy screen, so that was one edit away.
 *
 * Being too strict fails the safe way round: an unmatched name lands on the BEFTN sheet,
 * where a missing routing number blocks the row loudly instead of misrouting it quietly.
 */
export function sameBank(a?: string | null, b?: string | null): boolean {
  const norm = (v?: string | null): string =>
    (v ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9ঀ-৿]/g, "")
      // Only the corporate suffix is forgiven, and only at the end: "…Ltd." and "…PLC"
      // are the same bank, whereas a shorter NAME is a different bank.
      .replace(/(limited|ltd|plc|pcl)$/, "");
  const x = norm(a);
  const y = norm(b);
  return x !== "" && y !== "" && x === y;
}

/** Which document this person's pay belongs on. */
export function channelFor(
  paymentMethod: string | null | undefined,
  bankName: string | null | undefined,
  schoolBankName: string,
): PaymentChannel {
  if (paymentMethod === "cash") return "cash";
  if (paymentMethod === "bkash") return "bkash";
  return sameBank(bankName, schoolBankName) ? "internal" : "beftn";
}

/** Why this row cannot be instructed on its channel — null when it can. */
export function blockReasonFor(channel: PaymentChannel, r: Omit<AdviceRow, "blockedReason">): string | null {
  if (r.amount <= 0) return ZERO_NET;
  if (channel === "cash") return null; // nothing to instruct; the office hands it over
  if (!r.account?.trim()) return NO_ACCOUNT;
  if (channel === "bkash") return null; // the number IS the instruction
  if (!r.accountName?.trim()) return NO_ACCOUNT_NAME;
  if (channel === "internal") return null;
  // BEFTN needs the receiving bank identified as well as the account.
  if (!r.bankName?.trim()) return NO_BANK;
  if (!r.bankBranch?.trim()) return NO_BRANCH;
  if (!r.routingNo?.trim()) return NO_ROUTING;
  return null;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-06" → "SCD Jun '26 Salary", the wording on the school's own sheets. */
export function paymentInfoFor(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  return `SCD ${MONTHS_SHORT[Number(m) - 1]} '${y.slice(2)} Salary`;
}

/** June's salary is advised on 1 July — the letter is dated the month AFTER the run. */
export function adviceLetterDate(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  return next.toISOString().slice(0, 10);
}

/**
 * The whole pack for a LOCKED run: every payslip resolved to a channel, with the
 * disbursement details the corresponding sheet needs.
 */
export async function paymentAdvice(runId: string): Promise<PaymentAdvice> {
  const run = await PayrollRun.findById(runId).lean();
  if (!run) throw new PayrollError("Payroll run not found");
  if (run.status !== "approved_locked") {
    throw new PayrollError("Payment advice issues only from a locked run (§4.6)");
  }

  const policy = await getHrPolicy();
  const slips = (await Payslip.find({ payrollRunId: new Types.ObjectId(runId) }).lean()) as unknown as IPayslip[];
  const staff = await StaffProfile.find({ _id: { $in: slips.map((s) => s.staffProfileId) } })
    .select("bankAccount bankAccountName bankName bankBranch routingNo")
    .lean();
  const byId = new Map(staff.map((s) => [s._id.toString(), s]));

  const groups = new Map<PaymentChannel, AdviceGroup>();
  const ensure = (c: PaymentChannel): AdviceGroup => {
    let g = groups.get(c);
    if (!g) {
      g = { channel: c, rows: [], total: 0, blocked: [] };
      groups.set(c, g);
    }
    return g;
  };

  for (const p of slips) {
    const d = byId.get(p.staffProfileId.toString());
    const channel = channelFor(p.paymentMethod, d?.bankName, policy.schoolBankName);
    const base = {
      staffProfileId: p.staffProfileId.toString(),
      name: p.snapshotName,
      accountName: d?.bankAccountName?.trim() || null,
      account: d?.bankAccount?.trim() || null,
      bankName: d?.bankName?.trim() || null,
      bankBranch: d?.bankBranch?.trim() || null,
      routingNo: d?.routingNo?.trim() || null,
      amount: p.netPay,
    };
    const row: AdviceRow = { ...base, blockedReason: blockReasonFor(channel, base) };
    const g = ensure(channel);
    if (row.blockedReason) g.blocked.push(row);
    else {
      g.rows.push(row);
      g.total += row.amount;
    }
  }

  // A stable, meaningful order: the two bank sheets first (they are what goes out
  // today), then bKash, then the cash list the office works from.
  const order: PaymentChannel[] = ["internal", "beftn", "bkash", "cash"];
  const sorted = order
    .map((c) => groups.get(c))
    .filter((g): g is AdviceGroup => g !== undefined)
    .map((g) => ({
      ...g,
      rows: [...g.rows].sort((a, b) => a.name.localeCompare(b.name)),
      blocked: [...g.blocked].sort((a, b) => a.name.localeCompare(b.name)),
    }));

  return {
    monthKey: run.monthKey,
    paymentInfo: paymentInfoFor(run.monthKey),
    letterDate: adviceLetterDate(run.monthKey),
    policy,
    groups: sorted,
  };
}
