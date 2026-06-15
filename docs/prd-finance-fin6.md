# PRD — Finance FIN-6: Rollups, Principal dashboard & the finance app

**Status:** Planned — build contract (slice 6 of 6 — completes the module). No feature code yet.
**Owner:** Principal (SCD) · **Module prefix:** FIN · **Plane:** identity/operational (ADR-005)
**Source REQ:** `docs/finance-requirements.md` (LOCKED) · **Builds on:** FIN-1..FIN-5
**Traceability:** D-#221–#238 (FIN-1..5) · **new D-#239–#240** · ADR-005/008 · D-#85 (derived) · MT-1/D-#131

> One live dashboard replacing the IMPORTRANGE stitching — and the Expo screens that finally let the
> Office and Principal use the whole module.

## §0 — At a glance
- [ ] **All rollups are DERIVED** (D-#85) over the existing FIN-1..FIN-5 data — **no new persisted model**;
  this slice is reads + app.
- [ ] **Builds as TWO PRs (D-#240): FIN-6A** = the server rollup reads + the Principal dashboard;
  **FIN-6B** = the Expo finance app surface over FIN-1..FIN-6.
- [ ] The dashboard reuses FIN-3 (Qard/IOU status), FIN-4 (recon history), FIN-5 (budget variance + surplus/
  deficit), FIN-2B (zakat-support-applied + provider statements) — one live view, no cross-file stitching.
- [ ] **Guardians get NO finance UI** (REQ §5); the only guardian-facing finance surface is the fee-due
  chase message (already FIN-2B). Reuses `finance:manage` (no new permission); always-open.

## §1 — Goal
Replace the Master Dashboard workbook: one live Principal dashboard (KPIs, trends, YTD income statement,
budget variance, Qard/IOU status, recon history, zakat-support-applied) plus the Expo screens for the
Office to do daily entry, fees/zakat, Qard/IOU, reconciliation, and budgeting — completing the finance
module end to end.

## §2 — Scope boundary & internal build order
**FIN-6A — server rollups + dashboard reads** (DERIVED): `monthlyReport`, `yearOverview`/KPIs, trends,
`ytdIncomeStatement`; composes the existing FIN-3/4/5/2B reads. No new model.
**FIN-6B — the Expo finance app** over FIN-1..FIN-6: Office entry/admin screens + the Principal dashboard.
| NOT in FIN-6 |
|---|
| New financial constructs / double-entry GL (REQ §7) · guardian self-service payment (deferred) · any new posting type (FIN-2/3 own postings) |

## §3 — Reads (all DERIVED — D-#85; no new model)
**`FinanceRollupService`:**
- **`monthlyReport(month)`** → income by head + expense by head + the per-ledger snapshot
  (`allLedgerBalancesAsOf` month-end) + net for the month — the Daily-tab month report.
- **`yearOverview(year, asOf)` / KPIs** → cash position (Σ ledger balances now), MTD/YTD income + expense,
  surplus/deficit (FIN-5), budget-variance summary (FIN-5), Qard/IOU outstanding (FIN-3), recon-status
  (FIN-4), **zakat-support-applied** total + provider receivables outstanding (FIN-2B).
- **`ytdIncomeStatement(year, asOf)`** → income heads − expense heads = net (the income-statement view,
  NOT a double-entry GL, REQ §1).
- **Trends** → monthly income/expense/net series for the year (charts).
- **Dashboard KPI set** (proposed — confirm Principal priorities at build): *cash position · this-month
  income vs expense · surplus/deficit YTD · budget variance (top over/under heads) · Qard/IOU outstanding ·
  zakat support applied + provider receivable · last reconciliation diffs · fees-due outstanding (FIN-2B).*

## §4 — App surface (FIN-6B, Expo)
A **💰 Finance tab** gated `finance:manage` (Principal+Office; **GUARDIAN never** sees it). Screens over the
merged FIN-1..6 resolvers (no server change in 6B): **DailyEntry** (post fee/income/expense/transfer, the
FIN-2 forms) · **DailySnapshot** (per-ledger opening/in/out/closing) · **Fees & Zakat** (per-child fee +
allocation + provider statement + fee-due chase wa.me) · **Qard/IOU** (party register + outstanding +
overdue) · **Reconciliation** (enter bank + Eximus, diffs + history) · **Budget** (set per-head budgets +
phasing, view variance) · **Principal Dashboard** (the KPIs/trends/YTD/charts, P/O). Every action re-gated
server-side; the Bangla deny surfaces inline (the D-#42/#125 posture). BN-first labels (existing token
system). Message bodies stay on the MT registry (D-#131).

## §5 — RBAC — reuses FIN-1, no new permission
All FIN-6 reads + every app screen gate **`finance:manage`**; the dashboard is Principal/Office. Guardian
holds no finance permission (no finance UI; the fee-due chase is the only guardian-facing surface, FIN-2B).
No new permission; always-open.

## §6 — Journeys (Given/When/Then)
- **J-FIN6-1 (Principal dashboard).** *Given* the live module, *when* the Principal opens the dashboard,
  *then* cash position, month income/expense, surplus/deficit, budget variance, Qard/IOU status, recon
  history, and zakat-support-applied show **without any cross-file stitching** (REQ J-FIN5).
- **J-FIN6-2 (monthly report).** *When* the Office opens a month, *then* income/expense by head + the
  ledger snapshot + net render, all derived.
- **J-FIN6-3 (Office does a full day in-app).** *When* the Office posts fees/income/expenses, reconciles,
  and checks the budget — *then* it all flows through the FIN-1..5 resolvers with the snapshot + variance
  live.
- **J-FIN6-4 (guardian wall).** *Given* a guardian login, *then* there is no finance tab/screen; only the
  fee-due chase message reaches them (FIN-2B).
- **J-FIN6-5 (firewall).** No rollup joins the corpus plane; NFR-11 green.

## §7 — Out of scope (FIN-6)
Double-entry GL / statutory financial statements beyond the income-statement view (REQ §7) · guardian
self-service online payment · receipt-image attachments (deferred) · multi-year/multi-branch rollups
(single school) · exporting to external accounting (Eximus stays parallel).

## §8 — Reused / unchanged
The FIN-1..5 reads/seams (`ledgerBalanceAsOf`, monthToDate, budgetVsActual, partyOutstanding,
reconciliationHistory, the FIN-2B zakat/provider reads) · `finance:manage` · the Expo token/label system +
the guardian-portal/deny pattern (D-#42/#125) · MT registry (D-#131) · identity-plane firewall · single-school.

## §9 — Firewall (ADR-005)
All FIN-6 reads are derived over identity-plane finance data; no corpus path; the firewall block stays
green; no new model to add.

## §10 — Acceptance gate (build verifies — executed)
1. **FIN-6A:** monthly report + year KPIs + YTD income statement + trends derive over FIN-1..5 with no new
   model; dashboard P/O-gated. Server gate: verifier PASS, shared+server tsc, jest all-green (+
   `financeRollup.test.ts`).
2. **FIN-6B:** the Finance tab + screens gate `finance:manage`, GUARDIAN never sees them; ops match the
   FIN-1..6 server schema. App gate: app tsc + `expo export --platform web` green.

## §11 — Traceability & decision band
- **Builds on:** D-#221–#238. **Reaffirmed:** D-#85 (derived), D-#131 (MT registry), D-#17/#94/#145, ADR-005.
- **New — D-#239–#240:**
  - **D-#239** — FIN-6 rollups are **all DERIVED** over the existing FIN-1..5 data (no new model) —
    `monthlyReport` / `yearOverview` KPIs / `ytdIncomeStatement` / trends compose the FIN-3 (Qard/IOU),
    FIN-4 (recon), FIN-5 (budget/surplus), FIN-2B (zakat/provider) reads into one Principal dashboard;
    income-statement view only, not a double-entry GL (REQ §1).
  - **D-#240** — FIN-6 builds as **two PRs**: FIN-6A (server rollups + dashboard) then FIN-6B (the Expo
    finance app over FIN-1..6, `finance:manage`-gated, **no guardian finance UI** — REQ §5).
- **Module complete:** FIN-1..FIN-6 fully planned. Build order = FIN-1 → FIN-2A → FIN-2B → FIN-3 → FIN-4 →
  FIN-5 → FIN-6A → FIN-6B.
