/**
 * feeSplit — PURE zakat/3rd-party fee-split math (FIN-2B, prd-finance-fin2.md §3.B,
 * D-#226). No DB, no clock — unit-tested directly. The single place that knows how a
 * gross fee divides into the provider's covered share and the guardian's remaining due,
 * per the PER-HEAD coverage model. The gross is counted ONCE upstream (the snapshot);
 * this split is the receivable/chase MEMO, never a second ledger movement (D-#230).
 *
 * Per fee line {head, amount}, against the active allocation's coverage:
 *   head not covered → guardian-due += amount
 *   FULL            → provider-due += amount
 *   AMOUNT v        → provider-due += min(v, amount); guardian-due += amount − min(v, amount)
 */

export interface CoverageItem {
  head: string;
  type: string; // FULL | AMOUNT
  amount?: number | null;
}
export interface FeeLine {
  head: string;
  amount: number;
}
export interface FeeSplit {
  gross: number;
  providerDue: number;
  guardianDue: number;
  perLine: Array<{ head: string; amount: number; providerDue: number; guardianDue: number }>;
}

/** Split a fee's lines into provider-due / guardian-due against a coverage list. An empty
 *  / absent coverage ⇒ the whole gross is guardian-due (no active allocation). */
export function splitFee(feeLines: readonly FeeLine[], coverage: readonly CoverageItem[] = []): FeeSplit {
  const byHead = new Map<string, CoverageItem>();
  for (const c of coverage) byHead.set(c.head, c);

  let gross = 0;
  let providerDue = 0;
  let guardianDue = 0;
  const perLine: FeeSplit["perLine"] = [];

  for (const line of feeLines) {
    gross += line.amount;
    const cov = byHead.get(line.head);
    let p = 0;
    if (cov) {
      if (cov.type === "FULL") {
        p = line.amount;
      } else if (cov.type === "AMOUNT") {
        const cap = cov.amount ?? 0;
        p = Math.max(0, Math.min(cap, line.amount));
      }
    }
    const g = line.amount - p;
    providerDue += p;
    guardianDue += g;
    perLine.push({ head: line.head, amount: line.amount, providerDue: p, guardianDue: g });
  }

  return { gross, providerDue, guardianDue, perLine };
}

/** The minimal allocation shape `activeAllocationFor` needs (pure-testable). */
export interface AllocationLike {
  studentId: string;
  providerId: string;
  coverage: CoverageItem[];
  effectiveDate: Date;
  endDate?: Date | null;
  status: string;
  createdAt: Date;
}

/**
 * PURE: the active allocation for a student on `asOf` — the latest by `createdAt` among
 * the student's rows with `effectiveDate ≤ asOf`, status ACTIVE, and not ended
 * (`endDate` null or ≥ asOf). null if none.
 */
export function activeAllocationFor<T extends AllocationLike>(
  allocations: readonly T[],
  studentId: string,
  asOf: Date,
): T | null {
  let best: T | null = null;
  for (const a of allocations) {
    if (a.studentId !== studentId) continue;
    if (a.status !== "ACTIVE") continue;
    if (a.effectiveDate.getTime() > asOf.getTime()) continue;
    if (a.endDate != null && a.endDate.getTime() < asOf.getTime()) continue;
    if (best === null || a.createdAt.getTime() > best.createdAt.getTime()) best = a;
  }
  return best;
}
