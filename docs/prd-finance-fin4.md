# PRD — Finance FIN-4: Dual reconciliation (bank + Eximus)

**Status:** Planned — build contract (slice 4 of 6). No feature code yet.
**Owner:** Principal (SCD) · **Module prefix:** FIN · **Plane:** identity/operational (ADR-005)
**Source REQ:** `docs/finance-requirements.md` (LOCKED) · **Builds on:** FIN-1..FIN-3
**Traceability:** D-#186 (Eximus boundary) · D-#221–#234 (FIN-1..3) · **new D-#235–#236** · ADR-005/008

> Two truths, one check: the app's derived balance vs the bank statement, and the app vs an entered
> Eximus control figure. Differences surfaced + kept as history.

## §0 — At a glance
- [ ] Per the REQ, **Eximus stays a parallel system — NO live link** (D-#186). FIN-4 reconciles against a
  **manually entered** bank-statement balance **and** a **manually entered Eximus control figure**.
- [ ] The **app balance is DERIVED** (the FIN-1/2/3 `ledgerBalanceAsOf` seam) — never re-keyed.
- [ ] `bankDiff = app − bank`, `eximusDiff = app − eximus`; both stored as **dated, append-only**
  reconciliation history.
- [ ] ⚠️ The exact **Eximus control figure** (what number you read off Eximus) is flagged for confirmation
  with the accountant (§3 / D-#236) — default = the day's **closing balance** Eximus reports.
- [ ] Reuses `finance:manage` (no new permission); always-open; server-only; identity plane.

## §1 — Goal
Replace the Daily tab's bank software-vs-statement difference, and add the new app-vs-Eximus control check:
the Office enters the bank statement balance and the Eximus control figure for a day, and the app shows
how its own derived ledger balance differs from each — recording every check so a drift can be traced.

## §2 — Scope boundary
| In FIN-4 | NOT FIN-4 |
|---|---|
| `ReconciliationEntry` (dated, append-only) + the two diffs + history + unreconciled-days read | The postings that DERIVE the app balance → FIN-2/FIN-3 |
| Compares the entered bank + Eximus figures vs `ledgerBalanceAsOf` | Live Eximus API (out — manual figure only, D-#186) · budget (FIN-5) · dashboard + app (FIN-6) |

## §3 — Data model (identity plane; dated, append-only; no `schoolId`)
**`ReconciliationEntry`** — one check for a date: `{ date, bankStatementBalance?, eximusControlFigure?,
appBankBalance (DERIVED at save = `ledgerBalanceAsOf(BANK, date)`), appTotalBalance (DERIVED = Σ all
ledgers, or the figure the Eximus total maps to — see below), bankDiff (= appBankBalance −
bankStatementBalance), eximusDiff (= appTotal − eximusControlFigure), note?, enteredByUserId, createdAt }`.
- **Append-only:** a re-reconciliation for the same day is a **new dated entry** (history preserved); the
  latest by `createdAt` is the day's current reconciliation.
- **The app balance is captured DERIVED at save** (a snapshot of the seam value) so the recorded diff is
  reproducible even if a later back-dated posting moves the live balance — the history shows what was true
  when reconciled (plus the live re-check on demand).
- **⚠️ Eximus control figure (D-#236) — confirm exact definition:** default = the **closing balance Eximus
  reports for the day** (e.g. closing cash/bank), compared against the app's matching derived total. The
  build pins whether it's a single closing total or per-ledger against the accountant; the model carries
  the entered figure + the app figure it's compared to either way.

**`ReconciliationService`:** `recordReconciliation(date, {bank?, eximus?})` (computes the diffs off the
seam; audited); `reconciliationHistory(range)` + `latestReconciliation(date)` + `unreconciledDays(range)`
(school-days with postings but no reconciliation) — all derived.

**Audit kinds** (Audit.ts): `RECONCILIATION_RECORDED`.

## §4 — Vocabulary (app-native; additive)
- `RECON_SOURCES = [BANK, EXIMUS]` + BN/EN labels (+ verifier extension) — labels the two diff sources.
  *(MAY be a model-local union; it only drives a label.)* No other vocab.

## §5 — RBAC — reuses FIN-1, no new permission
`recordReconciliation` + the reads gate **`finance:manage`** (Principal+Office). Guardian none. No new
permission; always-open (no `finance:approve`).

## §6 — Journeys (Given/When/Then)
- **J-FIN4-1 (bank reconcile).** *Given* a posted day, *when* the Office enters the bank-statement balance,
  *then* `bankDiff = app − bank` is shown + stored, and a non-zero diff is highlighted for investigation.
- **J-FIN4-2 (Eximus reconcile).** *When* the Office enters the Eximus control figure, *then*
  `eximusDiff = app − eximus` is shown + stored alongside the bank diff.
- **J-FIN4-3 (history + drift).** *Given* days of reconciliations, *when* the Office opens the history,
  *then* each day's two diffs are listed and a persistent drift is visible.
- **J-FIN4-4 (re-reconcile).** *When* a figure is corrected, *then* a new dated entry supersedes (history
  retained, never overwritten).
- **J-FIN4-5 (firewall).** Corpus cannot resolve any FIN-4 model; green both ways.

## §7 — Out of scope (FIN-4)
Live Eximus integration/API (manual figure only, D-#186) · auto-matching individual transactions (it's a
balance-level check, not line-by-line) · budget (FIN-5) · dashboard + app (FIN-6).

## §8 — Reused / unchanged
The `ledgerBalanceAsOf` seam (FIN-1/2/3, D-#223/#225/#233) · the D-#50 school-day calendar (unreconciled
school-days) · `finance:manage` · append-only audit · identity-plane firewall · single-school.

## §9 — Firewall (ADR-005)
`ReconciliationEntry` + service are identity-plane; no corpus path; finance firewall block extended; NFR-11 green.

## §10 — Acceptance gate (build verifies — executed)
1. Record bank + Eximus figures → both diffs computed off the derived seam + stored dated/append-only;
   re-reconcile supersedes with history retained; unreconciled-days read.
2. RBAC `finance:manage`; firewall both ways green. Full gate: verifier PASS, shared+server tsc, jest
   all-green (+ `reconciliation.test.ts`). Server-only.

## §11 — Traceability & decision band
- **Builds on:** D-#221–#234. **Reaffirmed:** D-#186 (Eximus parallel/no live link), D-#223/#225, D-#17/#94/#145.
- **New — D-#235–#236:**
  - **D-#235** — dual reconciliation = a **dated, append-only `ReconciliationEntry`** capturing the entered
    bank-statement balance + the entered Eximus control figure vs the app's **DERIVED** ledger balance
    (snapshotted at save for reproducibility) → `bankDiff` + `eximusDiff` + history; no live Eximus link.
  - **D-#236** — the **Eximus control figure** is entered manually; its exact definition (a single closing
    total vs per-ledger) is **confirmed with the accountant at build** (default = Eximus's day-closing balance).
- **Next:** FIN-5 (budget vs actual).
