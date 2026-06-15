/**
 * postingMath — PURE ledger-effect math for FinancePosting (FIN-2A, prd-finance-fin2.md
 * §3.A, D-#224/#225). No DB, no clock — unit-tested directly. The single place that knows
 * how a posting moves the ledgers, so `ledgerBalanceAsOf` (the FIN-1 seam, extended here)
 * and `dailySnapshot` agree by construction.
 *
 * Effect rules (a reversal — `reversesPostingId` set — negates the normal effect):
 *   FEE_COLLECTION / OTHER_INCOME → mode ledger += amount (IN)
 *   EXPENSE                       → mode ledger -= amount (OUT)
 *   TRANSFER                      → mode ledger -= amount (OUT), toLedger += amount (IN)
 */

/** The minimal posting shape the math needs (pure-testable). */
export interface PostingLike {
  date: Date;
  kind: string;
  mode: string;
  amount: number;
  toLedger?: string | null;
  reversesPostingId?: unknown;
}

export interface LedgerEffect {
  ledger: string;
  delta: number; // signed: +IN, −OUT
}

/** The signed per-ledger effects of one posting (a reversal negates them). */
export function postingEffects(p: PostingLike): LedgerEffect[] {
  const sign = p.reversesPostingId != null ? -1 : 1;
  const amt = p.amount * sign;
  switch (p.kind) {
    case "FEE_COLLECTION":
    case "OTHER_INCOME":
      return [{ ledger: p.mode, delta: amt }];
    case "EXPENSE":
      return [{ ledger: p.mode, delta: -amt }];
    case "TRANSFER":
      return p.toLedger
        ? [
            { ledger: p.mode, delta: -amt },
            { ledger: p.toLedger, delta: amt },
          ]
        : [{ ledger: p.mode, delta: -amt }];
    default:
      return [];
  }
}

/** Σ signed effect on `ledger` over the postings dated ≤ `asOf` (inclusive). */
export function sumLedgerDelta(
  postings: readonly PostingLike[],
  ledger: string,
  asOf: Date,
): number {
  let sum = 0;
  const cutoff = asOf.getTime();
  for (const p of postings) {
    if (p.date.getTime() > cutoff) continue;
    for (const e of postingEffects(p)) {
      if (e.ledger === ledger) sum += e.delta;
    }
  }
  return sum;
}

/** The day's money IN / OUT on `ledger` over postings dated within [dayStart, dayEnd]. */
export function dayInOut(
  postings: readonly PostingLike[],
  ledger: string,
  dayStart: Date,
  dayEnd: Date,
): { in: number; out: number } {
  let moneyIn = 0;
  let moneyOut = 0;
  const lo = dayStart.getTime();
  const hi = dayEnd.getTime();
  for (const p of postings) {
    const t = p.date.getTime();
    if (t < lo || t > hi) continue;
    for (const e of postingEffects(p)) {
      if (e.ledger !== ledger) continue;
      if (e.delta >= 0) moneyIn += e.delta;
      else moneyOut += -e.delta;
    }
  }
  return { in: moneyIn, out: moneyOut };
}
