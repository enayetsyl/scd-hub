/**
 * FinanceLedgerService (FIN-1, prd-finance-fin1.md §3, D-#221–#223) — the ledger
 * foundation: declare effective-dated, append-only opening balances and DERIVE the
 * authoritative opening (and, from FIN-2 on, the running balance) per ledger.
 *
 * Pure where possible (the classTestScoring/ref11 posture): `openingFor` resolves the
 * authoritative opening from a list of declarations with NO DB/clock, so it is
 * unit-tested directly. The DB-touching functions just load + delegate.
 *
 * THE SEAM (D-#223): `ledgerBalanceAsOf(ledger, asOf)` returns the opening-as-of in
 * FIN-1. FIN-2 EXTENDS *this one function* to `opening + Σ(postings ≤ asOf)` — the
 * single seam every later slice's snapshot, reconciliation, and dashboard reads
 * through. `allLedgerBalancesAsOf` is the 5-ledger vector FIN-2's daily snapshot grows.
 *
 * Identity/operational plane; NO corpus path (ADR-005).
 */
import { LEDGER_KINDS, type LedgerKind } from "@scd/shared";
import {
  LedgerOpeningBalance,
  type ILedgerOpeningBalance,
} from "../models/LedgerOpeningBalance";
import { FinancePosting } from "../models/FinancePosting";
import { QardIouEntry } from "../models/QardIouEntry";
import { sumLedgerDelta, type PostingLike } from "../postingMath";
import { sumQardDelta, type QardEntryLike } from "../qardIouMath";
import { writeAudit } from "../../platform/services/AuditService";

/** A write-time rejection surfaced to the caller as a Bangla message (the "422" shape). */
export class FinanceError extends Error {}

export interface FinanceActor {
  userId: string;
  role: string;
}

export interface SetOpeningBalanceInput {
  ledger: string;
  amount: number;
  effectiveDate: Date;
  note?: string | null;
}

/** One ledger's opening (or running balance, from FIN-2) as of a query date. */
export interface LedgerBalance {
  ledger: LedgerKind;
  /** The authoritative opening as-of (FIN-1); opening + Σ(postings) from FIN-2. */
  amount: number;
}

const LEDGER_SET = new Set<string>(LEDGER_KINDS);

/** The minimal shape `openingFor` needs from a declaration row (pure-testable). */
export interface OpeningDeclaration {
  ledger: string;
  amount: number;
  effectiveDate: Date;
  createdAt: Date;
}

/**
 * PURE: the authoritative opening for `ledger` as of `asOf` (D-#222). Among the
 * declarations for that ledger whose `effectiveDate ≤ asOf`, the one with the LATEST
 * `createdAt` wins (a later re-declaration supersedes); before any declaration ⇒ 0.
 * No DB, no clock — unit-tested directly.
 */
export function openingFor(
  declarations: readonly OpeningDeclaration[],
  ledger: string,
  asOf: Date,
): number {
  let best: OpeningDeclaration | null = null;
  for (const d of declarations) {
    if (d.ledger !== ledger) continue;
    if (d.effectiveDate.getTime() > asOf.getTime()) continue; // not yet effective
    if (best === null || d.createdAt.getTime() > best.createdAt.getTime()) {
      best = d;
    }
  }
  return best ? best.amount : 0;
}

function assertValidInput(input: SetOpeningBalanceInput): void {
  if (!LEDGER_SET.has(input.ledger)) {
    throw new FinanceError(`অজানা লেজার: ${input.ledger}`);
  }
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount)) {
    throw new FinanceError("ব্যালেন্স একটি বৈধ সংখ্যা হতে হবে");
  }
  if (!(input.effectiveDate instanceof Date) || Number.isNaN(input.effectiveDate.getTime())) {
    throw new FinanceError("কার্যকর তারিখ বৈধ নয়");
  }
}

/**
 * Declare (append) an opening balance for a ledger. NEVER overwrites — a correction is
 * a new dated row (D-#222). Audited FINANCE_OPENING_BALANCE_SET. Returns the new row.
 */
export async function setOpeningBalance(
  input: SetOpeningBalanceInput,
  actor: FinanceActor,
): Promise<ILedgerOpeningBalance> {
  assertValidInput(input);
  const row = await LedgerOpeningBalance.create({
    ledger: input.ledger,
    amount: input.amount,
    effectiveDate: input.effectiveDate,
    note: input.note ?? null,
    enteredByUserId: actor.userId,
  });

  await writeAudit({
    eventKind: "FINANCE_OPENING_BALANCE_SET",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: row._id,
    targetKind: "LedgerOpeningBalance",
    meta: {
      ledger: input.ledger,
      amount: input.amount,
      effectiveDate: input.effectiveDate.toISOString(),
      note: input.note ?? null,
    },
  });

  return row;
}

/** Load postings dated ≤ asOf as the pure shape (the FIN-2 seam extension). */
export async function loadPostingsAsOf(asOf: Date): Promise<PostingLike[]> {
  const rows = await FinancePosting.find({ date: { $lte: asOf } }).lean<
    Array<{ date: Date; kind: string; mode: string; amount: number; toLedger?: string | null; reversesPostingId?: unknown }>
  >();
  return rows.map((r) => ({
    date: new Date(r.date),
    kind: r.kind,
    mode: r.mode,
    amount: r.amount,
    toLedger: r.toLedger ?? null,
    reversesPostingId: r.reversesPostingId ?? null,
  }));
}

/** Load Qard/IOU entries dated ≤ asOf as the pure shape (the FIN-3 seam extension). */
export async function loadQardEntriesAsOf(asOf: Date): Promise<QardEntryLike[]> {
  const rows = await QardIouEntry.find({ date: { $lte: asOf } }).lean<
    Array<{ type: string; direction: string; amount: number; date: Date; mode: string; partyId?: unknown; dueDate?: Date | null; reversesEntryId?: unknown }>
  >();
  return rows.map((r) => ({
    type: r.type,
    direction: r.direction,
    amount: r.amount,
    date: new Date(r.date),
    mode: r.mode,
    partyId: r.partyId ? (r.partyId as { toString(): string }).toString() : undefined,
    dueDate: r.dueDate ? new Date(r.dueDate) : null,
    reversesEntryId: r.reversesEntryId ?? null,
  }));
}

/** Load every declaration as the pure shape (newest declarations included). */
export async function loadDeclarations(): Promise<OpeningDeclaration[]> {
  const rows = await LedgerOpeningBalance.find().lean<OpeningDeclaration[]>();
  return rows.map((r) => ({
    ledger: r.ledger,
    amount: r.amount,
    effectiveDate: new Date(r.effectiveDate),
    createdAt: new Date(r.createdAt),
  }));
}

/**
 * The authoritative opening per ledger as of `asOf` (defaults to now), for ALL 5
 * ledgers (missing ⇒ 0), derived. The 5-ledger vector the ledgers view renders.
 */
export async function openingBalances(asOf: Date = new Date()): Promise<LedgerBalance[]> {
  const declarations = await loadDeclarations();
  return LEDGER_KINDS.map((ledger) => ({
    ledger,
    amount: openingFor(declarations, ledger, asOf),
  }));
}

/**
 * THE SEAM (D-#223/#225): one ledger's balance as of `asOf` = the FIN-1 opening seed +
 * Σ(FinancePosting effects ≤ asOf) (FIN-2A). Every later slice reads balances through
 * here, so the FIN-3 Qard/IOU extension is one more term in the same place.
 */
export async function ledgerBalanceAsOf(
  ledger: string,
  asOf: Date = new Date(),
): Promise<number> {
  if (!LEDGER_SET.has(ledger)) {
    throw new FinanceError(`অজানা লেজার: ${ledger}`);
  }
  const [declarations, postings, qard] = await Promise.all([
    loadDeclarations(),
    loadPostingsAsOf(asOf),
    loadQardEntriesAsOf(asOf),
  ]);
  return (
    openingFor(declarations, ledger, asOf) +
    sumLedgerDelta(postings, ledger, asOf) +
    sumQardDelta(qard, ledger, asOf)
  );
}

/**
 * The 5-ledger balance vector as of `asOf` — opening seed + Σ(postings) + Σ(Qard/IOU
 * effects) per ledger (FIN-2A + FIN-3). The daily snapshot reads through here.
 */
export async function allLedgerBalancesAsOf(asOf: Date = new Date()): Promise<LedgerBalance[]> {
  const [declarations, postings, qard] = await Promise.all([
    loadDeclarations(),
    loadPostingsAsOf(asOf),
    loadQardEntriesAsOf(asOf),
  ]);
  return LEDGER_KINDS.map((ledger) => ({
    ledger,
    amount:
      openingFor(declarations, ledger, asOf) +
      sumLedgerDelta(postings, ledger, asOf) +
      sumQardDelta(qard, ledger, asOf),
  }));
}
