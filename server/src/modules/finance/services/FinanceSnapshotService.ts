/**
 * FinanceSnapshotService (FIN-2A, prd-finance-fin2.md §3.A, D-#224/#225/#228) — record &
 * reverse postings (append-only) and DERIVE the daily snapshot / month-to-date / per-child
 * fee history off the FIN-1 `ledgerBalanceAsOf` seam. Nothing is stored but the postings
 * themselves; balances are always computed (D-#85).
 *
 * Identity/operational plane; NO corpus path (ADR-005).
 */
import {
  FINANCE_PAYMENT_MODES,
  FINANCE_STUDENT_FEE_HEADS,
  FINANCE_INCOME_HEADS,
  FINANCE_EXPENSE_HEADS,
  LEDGER_KINDS,
} from "@scd/shared";
import { FinancePosting, type IFinancePosting } from "../models/FinancePosting";
import {
  FinanceError,
  type FinanceActor,
  openingFor,
  loadDeclarations,
  loadPostingsAsOf,
  loadQardEntriesAsOf,
} from "./FinanceLedgerService";
import { sumLedgerDelta, dayInOut, type PostingLike } from "../postingMath";
import { sumQardDelta, qardDayInOut } from "../qardIouMath";
import { writeAudit } from "../../platform/services/AuditService";

const MODE_SET = new Set<string>(FINANCE_PAYMENT_MODES);
const FEE_HEAD_SET = new Set<string>(FINANCE_STUDENT_FEE_HEADS);
const INCOME_HEAD_SET = new Set<string>(FINANCE_INCOME_HEADS);
const EXPENSE_HEAD_SET = new Set<string>(FINANCE_EXPENSE_HEADS);
const LEDGER_SET = new Set<string>(LEDGER_KINDS);
/** All 5 ledgers flow into the snapshot — Cash/Bank/Online (FIN-2A) + the Qard/IOU
 *  control ledgers (FIN-3, D-#233 — control balances flow into the same daily snapshot). */
const SNAPSHOT_LEDGERS = LEDGER_KINDS;

export interface FeeLineInput {
  head: string;
  amount: number;
}
export interface SalaryAdjustmentInput {
  label: string;
  amount: number;
}

export interface RecordPostingInput {
  date: Date;
  kind: string;
  mode: string;
  amount?: number;
  note?: string | null;
  studentId?: string | null;
  feeLines?: FeeLineInput[];
  incomeHead?: string | null;
  expenseHead?: string | null;
  toLedger?: string | null;
  /** SALARY pre-fill base (HR net-payable total, D-#228). */
  salaryBaseAmount?: number | null;
  salaryAdjustments?: SalaryAdjustmentInput[];
}

function assertPositive(amount: number, label = "পরিমাণ"): void {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new FinanceError(`${label} অবশ্যই ধনাত্মক সংখ্যা হতে হবে`);
  }
}

/**
 * Validate + normalise a posting by kind, returning the doc to persist. Pure-ish (no DB);
 * the discriminated block is enforced here (J-FIN2-1/3/4).
 */
function buildPostingDoc(input: RecordPostingInput, actor: FinanceActor): Record<string, unknown> {
  if (!(input.date instanceof Date) || Number.isNaN(input.date.getTime())) {
    throw new FinanceError("তারিখ বৈধ নয়");
  }
  if (!MODE_SET.has(input.mode)) throw new FinanceError(`অজানা মোড: ${input.mode}`);

  const base: Record<string, unknown> = {
    date: input.date,
    kind: input.kind,
    mode: input.mode,
    note: input.note ?? null,
    enteredByUserId: actor.userId,
  };

  switch (input.kind) {
    case "FEE_COLLECTION": {
      if (!input.studentId) throw new FinanceError("ফি আদায়ে শিক্ষার্থী প্রয়োজন");
      const lines = input.feeLines ?? [];
      if (lines.length === 0) throw new FinanceError("ফি লাইন প্রয়োজন");
      for (const l of lines) {
        if (!FEE_HEAD_SET.has(l.head)) throw new FinanceError(`অজানা ফি খাত: ${l.head}`);
        assertPositive(l.amount, "ফি লাইন পরিমাণ");
      }
      const amount = lines.reduce((s, l) => s + l.amount, 0);
      return { ...base, studentId: input.studentId, feeLines: lines, amount };
    }
    case "OTHER_INCOME": {
      if (!input.incomeHead || !INCOME_HEAD_SET.has(input.incomeHead)) {
        throw new FinanceError(`অজানা আয় খাত: ${input.incomeHead}`);
      }
      assertPositive(input.amount as number);
      return { ...base, incomeHead: input.incomeHead, amount: input.amount };
    }
    case "EXPENSE": {
      if (!input.expenseHead || !EXPENSE_HEAD_SET.has(input.expenseHead)) {
        throw new FinanceError(`অজানা ব্যয় খাত: ${input.expenseHead}`);
      }
      // SALARY pre-fill (D-#228): amount = HR base + Σ adjustments; store both.
      if (input.expenseHead === "SALARY" && input.salaryBaseAmount != null) {
        const adj = input.salaryAdjustments ?? [];
        for (const a of adj) {
          if (typeof a.amount !== "number" || !Number.isFinite(a.amount)) {
            throw new FinanceError("সমন্বয় পরিমাণ বৈধ নয়");
          }
          if (!a.label || !a.label.trim()) throw new FinanceError("সমন্বয় লেবেল প্রয়োজন");
        }
        const amount = input.salaryBaseAmount + adj.reduce((s, a) => s + a.amount, 0);
        assertPositive(amount, "বেতন পরিমাণ");
        return {
          ...base,
          expenseHead: "SALARY",
          salaryBaseAmount: input.salaryBaseAmount,
          salaryAdjustments: adj,
          amount,
        };
      }
      assertPositive(input.amount as number);
      return { ...base, expenseHead: input.expenseHead, amount: input.amount };
    }
    case "TRANSFER": {
      if (!input.toLedger || !LEDGER_SET.has(input.toLedger)) {
        throw new FinanceError(`অজানা গন্তব্য লেজার: ${input.toLedger}`);
      }
      if (input.toLedger === input.mode) {
        throw new FinanceError("উৎস ও গন্তব্য লেজার একই হতে পারে না");
      }
      assertPositive(input.amount as number);
      return { ...base, toLedger: input.toLedger, movementHead: "BANK_DEPOSIT", amount: input.amount };
    }
    default:
      throw new FinanceError(`অজানা পোস্টিং কাইন্ড: ${input.kind}`);
  }
}

/** Append a money event (J-FIN2-1/3/4). Audited FINANCE_POSTING_RECORDED. */
export async function recordPosting(
  input: RecordPostingInput,
  actor: FinanceActor,
): Promise<IFinancePosting> {
  const doc = buildPostingDoc(input, actor);
  const row = await FinancePosting.create(doc);
  await writeAudit({
    eventKind: "FINANCE_POSTING_RECORDED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: row._id,
    targetKind: "FinancePosting",
    meta: { kind: row.kind, mode: row.mode, amount: row.amount, date: row.date.toISOString() },
  });
  return row;
}

/**
 * Reverse a posting (J-FIN2-2): append a NEW posting that copies the original's shape +
 * date and negates its effect (`reversesPostingId`). The original is never edited/deleted.
 * Guards: the target must exist, not itself be a reversal, and not already be reversed.
 * Audited FINANCE_POSTING_REVERSED.
 */
export async function reversePosting(
  postingId: string,
  actor: FinanceActor,
): Promise<IFinancePosting> {
  const original = await FinancePosting.findById(postingId);
  if (!original) throw new FinanceError("পোস্টিং পাওয়া যায়নি");
  if (original.reversesPostingId != null) {
    throw new FinanceError("একটি রিভার্সাল পোস্টিং আবার রিভার্স করা যায় না");
  }
  const already = await FinancePosting.findOne({ reversesPostingId: original._id }).lean();
  if (already) throw new FinanceError("এই পোস্টিং ইতিমধ্যে রিভার্স করা হয়েছে");

  const reversal = await FinancePosting.create({
    date: original.date,
    kind: original.kind,
    mode: original.mode,
    amount: original.amount,
    note: `Reversal of ${original._id.toString()}`,
    studentId: original.studentId ?? null,
    feeLines: original.feeLines,
    incomeHead: original.incomeHead ?? null,
    expenseHead: original.expenseHead ?? null,
    movementHead: original.movementHead ?? null,
    toLedger: original.toLedger ?? null,
    salaryBaseAmount: original.salaryBaseAmount ?? null,
    salaryAdjustments: original.salaryAdjustments,
    reversesPostingId: original._id,
    enteredByUserId: actor.userId,
  });

  await writeAudit({
    eventKind: "FINANCE_POSTING_REVERSED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: reversal._id,
    targetKind: "FinancePosting",
    meta: { reversesPostingId: original._id.toString(), kind: original.kind, amount: original.amount },
  });
  return reversal;
}

// --- Derived reads ----------------------------------------------------------

export interface LedgerDaySnapshot {
  ledger: string;
  opening: number;
  in: number;
  out: number;
  closing: number;
}
export interface DailySnapshot {
  date: string;
  ledgers: LedgerDaySnapshot[];
}

function dayBounds(dateKey: string): { dayStart: Date; dayEnd: Date; priorEnd: Date } {
  const dayStart = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(dayStart.getTime())) throw new FinanceError(`তারিখ বৈধ নয়: ${dateKey}`);
  const dayEnd = new Date(`${dateKey}T23:59:59.999Z`);
  const priorEnd = new Date(dayStart.getTime() - 1);
  return { dayStart, dayEnd, priorEnd };
}

/**
 * The day's per-ledger opening (close of date-1) / in / out / closing for Cash/Bank/Online
 * (J-FIN2-1). Derived off the seam — no manual carry-forward.
 */
export async function dailySnapshot(dateKey: string): Promise<DailySnapshot> {
  const { dayStart, dayEnd, priorEnd } = dayBounds(dateKey);
  const [declarations, postings, qard] = await Promise.all([
    loadDeclarations(),
    loadPostingsAsOf(dayEnd),
    loadQardEntriesAsOf(dayEnd),
  ]);

  const ledgers = SNAPSHOT_LEDGERS.map((ledger) => {
    const opening =
      openingFor(declarations, ledger, priorEnd) + sumLedgerDelta(postings, ledger, priorEnd) + sumQardDelta(qard, ledger, priorEnd);
    const closing =
      openingFor(declarations, ledger, dayEnd) + sumLedgerDelta(postings, ledger, dayEnd) + sumQardDelta(qard, ledger, dayEnd);
    const p = dayInOut(postings, ledger, dayStart, dayEnd);
    const q = qardDayInOut(qard, ledger, dayStart, dayEnd);
    return { ledger, opening, in: p.in + q.in, out: p.out + q.out, closing };
  });
  return { date: dateKey, ledgers };
}

export interface HeadTotal {
  head: string;
  amount: number;
}
export interface MonthToDate {
  month: string;
  feeByHead: HeadTotal[];
  incomeByHead: HeadTotal[];
  expenseByHead: HeadTotal[];
  totalIn: number;
  totalOut: number;
}

/** Month-to-date totals by head (the Daily-tab + month-report feed). YYYY-MM. */
export async function monthToDate(month: string): Promise<MonthToDate> {
  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(monthStart.getTime())) throw new FinanceError(`মাস বৈধ নয়: ${month}`);
  const monthEnd = new Date(monthStart);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

  const rows = await FinancePosting.find({ date: { $gte: monthStart, $lt: monthEnd } }).lean<
    Array<PostingLike & {
      feeLines?: FeeLineInput[];
      incomeHead?: string | null;
      expenseHead?: string | null;
    }>
  >();

  const fee = new Map<string, number>();
  const income = new Map<string, number>();
  const expense = new Map<string, number>();
  let totalIn = 0;
  let totalOut = 0;
  const bump = (m: Map<string, number>, head: string, amt: number) => m.set(head, (m.get(head) ?? 0) + amt);
  const sign = (p: PostingLike) => (p.reversesPostingId != null ? -1 : 1);

  for (const p of rows) {
    const s = sign(p);
    if (p.kind === "FEE_COLLECTION") {
      for (const l of p.feeLines ?? []) bump(fee, l.head, l.amount * s);
      totalIn += p.amount * s;
    } else if (p.kind === "OTHER_INCOME") {
      if (p.incomeHead) bump(income, p.incomeHead, p.amount * s);
      totalIn += p.amount * s;
    } else if (p.kind === "EXPENSE") {
      if (p.expenseHead) bump(expense, p.expenseHead, p.amount * s);
      totalOut += p.amount * s;
    }
    // TRANSFER moves between ledgers — neither income nor expense (excluded, §3.A).
  }

  const toArr = (m: Map<string, number>): HeadTotal[] =>
    [...m.entries()].map(([head, amount]) => ({ head, amount })).sort((a, b) => a.head.localeCompare(b.head));

  return {
    month,
    feeByHead: toArr(fee),
    incomeByHead: toArr(income),
    expenseByHead: toArr(expense),
    totalIn,
    totalOut,
  };
}

/** That child's FEE_COLLECTION postings, newest first (per-head history, J-FIN2-1). */
export async function studentFeeHistory(studentId: string): Promise<IFinancePosting[]> {
  return FinancePosting.find({ studentId, kind: "FEE_COLLECTION" }).sort({ date: -1, createdAt: -1 });
}
