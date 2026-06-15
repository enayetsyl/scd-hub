/**
 * qardIouMath — PURE Qard/IOU register math (FIN-3, prd-finance-fin3.md §3, D-#233/#234).
 * No DB, no clock — unit-tested directly. One entry carries BOTH the cash effect and the
 * control-ledger effect, so the snapshot/seam and the per-party outstanding agree.
 *
 * Control ledger by type: QARD_E_HASANA → QARD_CONTROL, IOU → IOU_CONTROL.
 *   NEW_DISBURSEMENT  → mode −amount, control +amount  (outstanding up)
 *   REPAYMENT_RECEIVED→ mode +amount, control −amount  (outstanding down)
 *   ADJUSTMENT        → control +amount (signed; no cash effect)
 * A reversal (`reversesEntryId` set) negates the whole effect.
 */
import type { LedgerEffect } from "./postingMath";

export interface QardEntryLike {
  type: string; // QARD_E_HASANA | IOU
  direction: string; // NEW_DISBURSEMENT | REPAYMENT_RECEIVED | ADJUSTMENT
  amount: number;
  date: Date;
  mode: string;
  partyId?: string;
  dueDate?: Date | null;
  reversesEntryId?: unknown;
}

/** The control ledger a type maps to. */
export function controlLedgerFor(type: string): string {
  return type === "IOU" ? "IOU_CONTROL" : "QARD_CONTROL";
}

/** The signed per-ledger effects of one entry (cash + control; reversal negates). */
export function qardEntryEffects(e: QardEntryLike): LedgerEffect[] {
  const sign = e.reversesEntryId != null ? -1 : 1;
  const amt = e.amount * sign;
  const control = controlLedgerFor(e.type);
  switch (e.direction) {
    case "NEW_DISBURSEMENT":
      return [
        { ledger: e.mode, delta: -amt },
        { ledger: control, delta: amt },
      ];
    case "REPAYMENT_RECEIVED":
      return [
        { ledger: e.mode, delta: amt },
        { ledger: control, delta: -amt },
      ];
    case "ADJUSTMENT":
      return [{ ledger: control, delta: amt }];
    default:
      return [];
  }
}

/** Σ signed effect on `ledger` over the entries dated ≤ `asOf`. */
export function sumQardDelta(entries: readonly QardEntryLike[], ledger: string, asOf: Date): number {
  let sum = 0;
  const cutoff = asOf.getTime();
  for (const e of entries) {
    if (e.date.getTime() > cutoff) continue;
    for (const eff of qardEntryEffects(e)) if (eff.ledger === ledger) sum += eff.delta;
  }
  return sum;
}

/** The day's IN / OUT on `ledger` over entries dated within [dayStart, dayEnd]. */
export function qardDayInOut(
  entries: readonly QardEntryLike[],
  ledger: string,
  dayStart: Date,
  dayEnd: Date,
): { in: number; out: number } {
  let moneyIn = 0;
  let moneyOut = 0;
  const lo = dayStart.getTime();
  const hi = dayEnd.getTime();
  for (const e of entries) {
    const t = e.date.getTime();
    if (t < lo || t > hi) continue;
    for (const eff of qardEntryEffects(e)) {
      if (eff.ledger !== ledger) continue;
      if (eff.delta >= 0) moneyIn += eff.delta;
      else moneyOut += -eff.delta;
    }
  }
  return { in: moneyIn, out: moneyOut };
}

/**
 * A party's outstanding (for an optional type) as of `asOf`: Σ disbursements −
 * repayments ± adjustments (a reversal negates). > 0 = the party owes the school.
 */
export function partyOutstanding(
  entries: readonly QardEntryLike[],
  partyId: string,
  asOf: Date,
  type?: string,
): number {
  let sum = 0;
  const cutoff = asOf.getTime();
  for (const e of entries) {
    if (e.partyId !== partyId) continue;
    if (type && e.type !== type) continue;
    if (e.date.getTime() > cutoff) continue;
    const sign = e.reversesEntryId != null ? -1 : 1;
    if (e.direction === "NEW_DISBURSEMENT") sum += e.amount * sign;
    else if (e.direction === "REPAYMENT_RECEIVED") sum -= e.amount * sign;
    else if (e.direction === "ADJUSTMENT") sum += e.amount * sign;
  }
  return sum;
}

export interface OverdueRow {
  partyId: string;
  type: string;
  outstanding: number;
  oldestDueDate: Date;
  daysLate: number;
}

const DAY_MS = 86_400_000;

/**
 * Parties with a PAST-DUE unpaid amount as of `asOf` (J-FIN3-3), ranked by lateness.
 * A (party, type) is overdue iff its outstanding > 0 AND it has a disbursement whose
 * `dueDate ≤ asOf`. Lateness = asOf − the oldest such due date.
 */
export function overdueList(entries: readonly QardEntryLike[], asOf: Date): OverdueRow[] {
  const cutoff = asOf.getTime();
  // Group disbursement due dates by party+type.
  const oldestDue = new Map<string, Date>();
  for (const e of entries) {
    if (e.reversesEntryId != null) continue;
    if (e.direction !== "NEW_DISBURSEMENT" || !e.dueDate) continue;
    if (e.dueDate.getTime() > cutoff) continue; // not yet due
    const key = `${e.partyId}|${e.type}`;
    const cur = oldestDue.get(key);
    if (!cur || e.dueDate.getTime() < cur.getTime()) oldestDue.set(key, e.dueDate);
  }

  const rows: OverdueRow[] = [];
  for (const [key, due] of oldestDue.entries()) {
    const [partyId, type] = key.split("|");
    const outstanding = partyOutstanding(entries, partyId, asOf, type);
    if (outstanding <= 0) continue; // settled — not overdue
    rows.push({
      partyId,
      type,
      outstanding,
      oldestDueDate: due,
      daysLate: Math.floor((cutoff - due.getTime()) / DAY_MS),
    });
  }
  rows.sort((a, b) => b.daysLate - a.daysLate);
  return rows;
}
