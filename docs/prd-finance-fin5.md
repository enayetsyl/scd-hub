# PRD — Finance FIN-5: Budget vs Actual

**Status:** Planned — build contract (slice 5 of 6). No feature code yet.
**Owner:** Principal (SCD) · **Module prefix:** FIN · **Plane:** identity/operational (ADR-005)
**Source REQ:** `docs/finance-requirements.md` (LOCKED) · **Builds on:** FIN-1..FIN-4
**Traceability:** D-#221–#236 (FIN-1..4) · **new D-#237–#238** · ADR-005/008 · D-#85 (derived)

> The plan vs the books — per head, per month, live. No more pasting actuals.

## §0 — At a glance
- [ ] **Per-head budgets for BOTH expense AND income heads** (your call) — an annual amount with **monthly
  phasing**: each month defaults to **annual ÷ 12** but is **individually overridable** (seasonal heads
  like Picnic / Training; income that peaks at admission season). (D-#237)
- [ ] **Actuals are auto-DERIVED from FIN-2 postings** by head × month (D-#85) — never pasted.
- [ ] **Variance = actual − target**, monthly + cumulative (YTD); **surplus/deficit** = income actual −
  expense actual. Movement heads (Bank Deposit / Qard / IOU repayment) are **excluded** from both (FIN-1
  D-#223 — they are not income or expense).
- [ ] Per **academic year**. Reuses `finance:manage` (no new permission); always-open; server-only.

## §1 — Goal
Replace the Budget-vs-Actual workbook: the Principal/Office sets an annual budget per expense head and an
income target per income head (with optional month-by-month phasing), and the app shows live monthly +
cumulative variance and the running surplus/deficit, with actuals fed straight from the daily postings.

## §2 — Scope boundary
| In FIN-5 | NOT FIN-5 |
|---|---|
| `BudgetLine` (per year × head, annual + monthly phasing) + the derived variance/surplus reads | The postings that feed actuals → FIN-2/FIN-3 |
| Expense budgets + income targets | Reconciliation (FIN-4) · the dashboard rollup + app (FIN-6) |

## §3 — Data model (identity plane; per academic year; no `schoolId`)
**`BudgetLine`** — one per (year × head): `{ academicYearId, head (a `FINANCE_EXPENSE_HEADS` or
`FINANCE_INCOME_HEADS` value), kind ∈ BUDGET_LINE_KINDS (EXPENSE | INCOME), annualAmount,
monthlyOverrides?: { [monthKey "YYYY-MM" | monthIndex]: amount }, note?, enteredByUserId, updatedAt }`.
- **Monthly target** for a head/month = `monthlyOverrides[month] ?? annualAmount / 12`. (Default even
  split; any month overridable — D-#237.) The budget is **editable** (always-open); each edit audited
  (prior + new, the D-#101 pattern) so the budget's history is auditable, even though `BudgetLine` itself
  is a current-state row (not a posting).
- `kind` is derivable from the head but stored for a clean expense-vs-income split (so the variance reads
  never miscategorise).

**`BudgetService`** (reads all DERIVED, D-#85 — reuse FIN-2's by-head/by-month aggregation):
- `setBudgetLine(...)` (validates head ∈ the right enum for `kind`; audited).
- **`budgetVsActual(year, asOf)`** → per head: `{ target(month), actual(month), variance(month),
  cumulativeTarget, cumulativeActual, cumulativeVariance }`. **Actual** = Σ FIN-2 postings of that head in
  that month (expense heads ← `EXPENSE` postings; income heads ← the `FEE_COLLECTION` per-head split +
  `OTHER_INCOME`), via the FIN-2 monthToDate aggregation — **movement heads excluded** (D-#238).
- `surplusDeficit(year, asOf)` → Σ income actual − Σ expense actual (monthly + YTD).
- `budgetSummary(year)` → totals + the over/under-budget heads.

**Audit kinds** (Audit.ts): `BUDGET_LINE_SET`.

## §4 — Vocabulary (app-native; additive)
- `BUDGET_LINE_KINDS = [EXPENSE, INCOME]` + BN/EN labels (+ verifier extension). *(MAY be model-local.)*
  The expense/income head enums are already frozen (FIN-1) — FIN-5 adds none.

## §5 — RBAC — reuses FIN-1, no new permission
`setBudgetLine` + the variance/surplus reads gate **`finance:manage`** (Principal+Office — the Principal
sets the budget, the Office records actuals; both hold it). Guardian none. No new permission; always-open
(no `finance:approve` — a budget edit is not a period-lock).

## §6 — Journeys (Given/When/Then)
- **J-FIN5-1 (set budget).** *Given* a new academic year, *when* the Principal sets an annual budget per
  expense head + income target per income head, *then* each month's target defaults to annual ÷ 12.
- **J-FIN5-2 (phase a seasonal head).** *When* the Principal overrides the Picnic head's months (e.g. all
  in one month), *then* that head's monthly targets honour the phasing, the rest stay even.
- **J-FIN5-3 (live variance).** *Given* posted expenses/fees, *when* the Office opens budget-vs-actual,
  *then* each head's actual (auto-fed), target, and monthly + cumulative variance show — no paste.
- **J-FIN5-4 (surplus/deficit).** *Then* the running income-minus-expense surplus/deficit is shown YTD.
- **J-FIN5-5 (movement exclusion).** *Given* a Bank-Deposit / Qard-repayment posting, *then* it is NOT
  counted as income or expense in any variance (D-#238).
- **J-FIN5-6 (firewall).** Corpus cannot resolve any FIN-5 model; green both ways.

## §7 — Out of scope (FIN-5)
Multi-year budget rollover / re-forecasting · per-section / per-cost-centre budgets (single school, head-
level only) · the dashboard rollup + Expo app (FIN-6) · approval/lock of a budget (always-open).

## §8 — Reused / unchanged
FIN-2's by-head/by-month posting aggregation + the income/expense head enums (FIN-1) · `AcademicYear`
(the budget year) · `finance:manage` · append-only audit (the budget-edit prior-state) · identity-plane
firewall · single-school.

## §9 — Firewall (ADR-005)
`BudgetLine` + service are identity-plane; no corpus path; finance firewall block extended; NFR-11 green.

## §10 — Acceptance gate (build verifies — executed)
1. Budget per head (expense + income), monthly target = override ?? annual/12; actuals auto-derived from
   FIN-2 by head×month; monthly + cumulative variance + surplus/deficit; movement heads excluded.
2. Budget edit audited (prior + new). RBAC `finance:manage`; firewall green. Full gate: verifier PASS,
   shared+server tsc, jest all-green (+ `budget.test.ts`). Server-only.

## §11 — Traceability & decision band
- **Builds on:** D-#221–#236. **Reaffirmed:** D-#85 (derived), D-#223 (movement heads ≠ income), D-#17/#94/#145.
- **New — D-#237–#238:**
  - **D-#237** — FIN-5 budget = **per head, expense AND income**, an annual amount with **per-month phasing**
    (each month defaults to **annual ÷ 12**, individually overridable); per academic year; `finance:manage`,
    always-open (a budget edit is not a period-lock).
  - **D-#238** — **actuals are DERIVED** from FIN-2 postings by head × month (no paste) — income targets vs
    `FEE_COLLECTION`+`OTHER_INCOME`, expense budgets vs `EXPENSE` postings; **movement heads (Bank Deposit /
    Qard / IOU repayment) excluded** from both variance sides.
- **Next:** FIN-6 (rollups & Principal dashboard + the Expo finance app).
