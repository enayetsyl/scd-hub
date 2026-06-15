/**
 * ReconciliationService (FIN-4, prd-finance-fin4.md §3/§6, J-FIN4-1..J-FIN4-4,
 * D-#235/#236) — the dual reconciliation: the app's DERIVED ledger balances (the FIN-1/2/3
 * `ledgerBalanceAsOf` seam) vs an entered bank-statement balance AND an entered per-ledger
 * Eximus control figure. Both diffs are stored dated + append-only; a re-reconcile is a new
 * entry (history retained). Eximus is parallel — manual figures, no live link (D-#186).
 *
 * Identity/operational plane; NO corpus path (ADR-005).
 */
import {
  ReconciliationEntry,
  type IReconciliationEntry,
  type ILedgerTriple,
} from "../models/ReconciliationEntry";
import { FinancePosting } from "../models/FinancePosting";
import { QardIouEntry } from "../models/QardIouEntry";
import { FinanceError, type FinanceActor, ledgerBalanceAsOf } from "./FinanceLedgerService";
import { writeAudit } from "../../platform/services/AuditService";

export interface RecordReconciliationInput {
  /** YYYY-MM-DD — reconcile as of the END of this day. */
  date: string;
  bankStatementBalance?: number | null;
  eximusClosing?: ILedgerTriple | null;
  note?: string | null;
}

function dayEndOf(dateKey: string): Date {
  const dayEnd = new Date(`${dateKey}T23:59:59.999Z`);
  if (Number.isNaN(dayEnd.getTime())) throw new FinanceError(`তারিখ বৈধ নয়: ${dateKey}`);
  return dayEnd;
}

/**
 * Record a reconciliation for `date` (J-FIN4-1/2): derive the app's BANK + CASH/BANK/ONLINE
 * closing off the seam, diff against the entered bank + Eximus figures, append + audit.
 */
export async function recordReconciliation(
  input: RecordReconciliationInput,
  actor: FinanceActor,
): Promise<IReconciliationEntry> {
  const dayEnd = dayEndOf(input.date);

  const [cash, bank, online] = await Promise.all([
    ledgerBalanceAsOf("CASH", dayEnd),
    ledgerBalanceAsOf("BANK", dayEnd),
    ledgerBalanceAsOf("ONLINE", dayEnd),
  ]);
  const appClosing: ILedgerTriple = { CASH: cash, BANK: bank, ONLINE: online };

  const bankStatementBalance = input.bankStatementBalance ?? null;
  if (bankStatementBalance != null && !Number.isFinite(bankStatementBalance)) {
    throw new FinanceError("ব্যাংক ব্যালেন্স বৈধ নয়");
  }
  const bankDiff = bankStatementBalance != null ? bank - bankStatementBalance : null;

  let eximusClosing: ILedgerTriple | null = null;
  let eximusDiff: ILedgerTriple | null = null;
  if (input.eximusClosing) {
    const e = input.eximusClosing;
    for (const k of ["CASH", "BANK", "ONLINE"] as const) {
      if (!Number.isFinite(e[k])) throw new FinanceError(`এক্সিমাস ${k} ব্যালেন্স বৈধ নয়`);
    }
    eximusClosing = { CASH: e.CASH, BANK: e.BANK, ONLINE: e.ONLINE };
    eximusDiff = {
      CASH: cash - e.CASH,
      BANK: bank - e.BANK,
      ONLINE: online - e.ONLINE,
    };
  }

  if (bankStatementBalance == null && eximusClosing == null) {
    throw new FinanceError("অন্তত একটি অঙ্ক (ব্যাংক বা এক্সিমাস) প্রয়োজন");
  }

  const row = await ReconciliationEntry.create({
    date: dayEnd,
    bankStatementBalance,
    appBankBalance: bank,
    bankDiff,
    eximusClosing,
    appClosing,
    eximusDiff,
    note: input.note ?? null,
    enteredByUserId: actor.userId,
  });

  await writeAudit({
    eventKind: "RECONCILIATION_RECORDED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: row._id,
    targetKind: "ReconciliationEntry",
    meta: { date: input.date, bankDiff, eximusDiff },
  });
  return row;
}

/** A date's current reconciliation (the latest by createdAt) or null. */
export async function latestReconciliation(dateKey: string): Promise<IReconciliationEntry | null> {
  const dayStart = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(dayStart.getTime())) throw new FinanceError(`তারিখ বৈধ নয়: ${dateKey}`);
  const dayEnd = new Date(`${dateKey}T23:59:59.999Z`);
  return ReconciliationEntry.findOne({ date: { $gte: dayStart, $lte: dayEnd } }).sort({ createdAt: -1 });
}

/** The most recent reconciliation overall (FIN-6A dashboard "last recon diffs"), or null. */
export async function mostRecentReconciliation(): Promise<IReconciliationEntry | null> {
  return ReconciliationEntry.findOne().sort({ date: -1, createdAt: -1 });
}

/** Reconciliation history over [from, to] (inclusive), newest first (J-FIN4-3). */
export async function reconciliationHistory(fromKey: string, toKey: string): Promise<IReconciliationEntry[]> {
  const from = new Date(`${fromKey}T00:00:00.000Z`);
  const to = new Date(`${toKey}T23:59:59.999Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new FinanceError("তারিখ পরিসীমা বৈধ নয়");
  return ReconciliationEntry.find({ date: { $gte: from, $lte: to } }).sort({ date: -1, createdAt: -1 });
}

/**
 * Days within [from, to] that have postings (finance activity) but NO reconciliation —
 * the chase-for-completeness read (J-FIN4-3). Derived from the posting/qard dates (those
 * only occur on active days), so no calendar coupling is needed.
 */
export async function unreconciledDays(fromKey: string, toKey: string): Promise<string[]> {
  const from = new Date(`${fromKey}T00:00:00.000Z`);
  const to = new Date(`${toKey}T23:59:59.999Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new FinanceError("তারিখ পরিসীমা বৈধ নয়");

  const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10);

  const [postings, qard, recons] = await Promise.all([
    FinancePosting.find({ date: { $gte: from, $lte: to } }).select("date").lean<Array<{ date: Date }>>(),
    QardIouEntry.find({ date: { $gte: from, $lte: to } }).select("date").lean<Array<{ date: Date }>>(),
    ReconciliationEntry.find({ date: { $gte: from, $lte: to } }).select("date").lean<Array<{ date: Date }>>(),
  ]);

  const activeDays = new Set<string>([...postings, ...qard].map((r) => dayKey(r.date)));
  const reconDays = new Set<string>(recons.map((r) => dayKey(r.date)));
  return [...activeDays].filter((d) => !reconDays.has(d)).sort();
}
