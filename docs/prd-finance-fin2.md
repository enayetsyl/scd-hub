# PRD — Finance FIN-2: Daily entry & postings (+ zakat fee-support)

**Status:** Planned — build contract (slice 2 of 6). No feature code yet.
**Owner:** Principal (SCD) · **Module prefix:** FIN · **Plane:** identity/operational (ADR-005)
**Source REQ:** `docs/finance-requirements.md` (LOCKED) · **Builds on:** `docs/prd-finance-fin1.md` (FIN-1)
**Traceability:** D-#186–#192 (REQ) · D-#221–#223 (FIN-1) · **new D-#224–#230** (this slice) · ADR-005/008/003 · D-#131

> The day's money, recorded once. FIN-2 turns the FIN-1 ledger foundation into a working book: fees,
> income, expenses, transfers, the derived daily snapshot — and the zakat/3rd-party fee-support engine.

## §0 — At a glance (read first)
- [ ] **FIN-2 is the heaviest slice — recommend building it as TWO PRs (D-#229):**
  **FIN-2A** = core postings + the derived **daily snapshot**; **FIN-2B** = the zakat/3rd-party
  **fee-support** sub-system (allocation + provider + fee-split + receivable + guardian-due chase).
- [ ] **Postings are append-only** — a correction is a **reversing posting**, never an edit/delete
  (the FIN-1 D-#222 discipline). The accountant enters each event once; the snapshot derives (REQ §2).
- [ ] **The daily snapshot extends the FIN-1 `ledgerBalanceAsOf` seam** (D-#223): opening (prior close) /
  in / out / closing per ledger — `opening + Σ(postings)`. FIN-2 covers **Cash/Bank/Online**; the
  Qard/IOU control ledgers' movements stay **FIN-3** (which extends the same seam).
- [ ] **Zakat = a roster-linked, effective-dated, append-only allocation** + a **provider receivable** +
  **auto fee-split** (guardian-due / provider-due) (REQ §1/§11, D-#191). **Coverage is PER-HEAD** — each
  covered head is FULL or a fixed AMOUNT (৳ cap), varying per student per head (ratified 2026-06-14; §3.B, D-#226).
- [ ] **No new permission** — reuses `finance:manage` (FIN-1/D-#221). Guardians get **no finance UI**,
  only fee-due **chase messages** on the existing rails (REQ §5).
- [ ] Vocab-toucher (additive): finance posting-kind / coverage / allocation-status enums + the
  `FINANCE_FEE_DUE` notification kind + the `finance.fee_due.chase.*` MT keys. **No wire sync** (REQ §9).
- [ ] Server-only. App is FIN-6. Single school, no `schoolId`. Identity plane, firewall both ways.

## §1 — Goal
Replace the Daily tab's manual Eximus re-key: the accountant posts each fee / income / expense / transfer
**once in the app**, and the day's per-ledger opening/in/out/closing + the month-to-date totals derive
automatically. Student fees link to the **existing roster** with a per-head split and a per-child history.
For students with a **zakat / 3rd-party** sponsor, each fee auto-splits into the guardian's remaining due
(exposed for chasing) and the provider's covered share (raised as a **receivable**), with a provider
statement of owed-vs-paid. This is a **cash/ledger** layer (REQ §1), not a double-entry GL.

## §2 — Scope boundary & internal build order
**FIN-2A — postings + daily snapshot** (build + ship first):
- `FinancePosting` (the unified, append-only event) + record/reverse + per-child fee history reads.
- The derived **daily snapshot** (extends `ledgerBalanceAsOf`) for Cash/Bank/Online; Bank-Deposit transfers.
- The **SALARY** expense line fed from the HR payroll net-payable total (D-#228).

**FIN-2B — zakat / 3rd-party fee-support** (build + ship second, on top of 2A):
- `FeeProvider`, the effective-dated append-only `FeeSupportAllocation`, the **fee-split** at fee-posting
  time, the provider **receivable** + `ProviderReceipt`, the provider statement, and the **guardian
  fee-due chase** (wa.me + emit, MT-registry bodies).

| NOT in FIN-2 (later) |
|---|
| Qard/IOU register movements + person-wise outstanding → **FIN-3** (FIN-2's snapshot seam is the extend-point it plugs into) |
| Bank-statement + Eximus dual reconciliation → **FIN-4** · Budget-vs-actual → **FIN-5** · Dashboard + Expo app → **FIN-6** |
| Receipt-image attachments (deferred, REQ §7) · payroll internals (HR owns) · guardian self-service online payment (deferred) |

## §3 — Data model (identity plane; no corpus path; no `schoolId`; all append-only)

### §3.A — Postings & snapshot (FIN-2A)
**`FinancePosting`** — one money event; **append-only** (never edited/deleted; a correction is a
reversing posting that references the original — D-#224):
`{ date: Date, kind ∈ FINANCE_POSTING_KINDS, mode ∈ FINANCE_PAYMENT_MODES, amount: number (>0),
note?, studentId?: ObjectId, feeLines?: [{head ∈ FINANCE_STUDENT_FEE_HEADS, amount}], incomeHead? ∈
FINANCE_INCOME_HEADS, expenseHead? ∈ FINANCE_EXPENSE_HEADS, movementHead? ∈
FINANCE_LEDGER_MOVEMENT_HEADS, toLedger? ∈ LEDGER_KINDS, reversesPostingId?: ObjectId, enteredByUserId,
createdAt }`. The **`kind` discriminates** which optional block is required:
- `FEE_COLLECTION` → `studentId` + `feeLines[]` (amount = Σ feeLines); money **IN** to the `mode` ledger.
- `OTHER_INCOME` → `incomeHead`; **IN** to the `mode` ledger.
- `EXPENSE` → `expenseHead`; **OUT** of the `mode` ledger (`SALARY` ⇐ HR total, D-#228).
- `TRANSFER` → a **Bank Deposit**-style move: **OUT** of the `mode` ledger **IN** to `toLedger`
  (e.g. Cash→Bank); `movementHead = BANK_DEPOSIT`. (Qard/IOU repayments are **FIN-3**, not here.)
- A reversal sets `reversesPostingId` + negates the original's effect (same shape, kind preserved).

**`FinanceSnapshotService`** (derived; D-#85 — never stored):
- **Extends `ledgerBalanceAsOf(ledger, asOf)`** (FIN-1) → `opening(FIN-1 seed) + Σ(FinancePosting effects
  ≤ asOf)`. The one balance truth; FIN-3 further extends it for Qard/IOU. (D-#225)
- `dailySnapshot(date)` → per ledger `{ opening (close of date-1), in, out, closing }` + the day's
  postings; `monthToDate(month)` totals by head (the Daily-tab + month-report feed).
- `studentFeeHistory(studentId)` → that child's `FEE_COLLECTION` postings, newest first (per-head).
- Pure `applyPostings(opening, postings, asOf)` helper, unit-tested.

**SALARY from HR (D-#228 — ratified):** a read seam `hrPayrollNetPayableTotal(monthKey)` returns **only
the aggregate net-payable figure** (Σ `payslip.netPay` over the **`approved_locked`** run; no payslip /
per-staff PII) for `finance:manage`. It **pre-fills** the `SALARY` `EXPENSE` posting, then the Office may
apply **manual deduction/adjustment lines** (e.g. exclude cash-paid staff, recover an advance, round) —
the posting stores the **HR base + each `{label, amount(signed)}` adjustment** with `amount = base +
Σ adjustments`, both audited, so finance still reconciles to HR. HR exposes only the aggregate; finance
never reads an individual payslip (the PII boundary holds).

### §3.B — Zakat / 3rd-party fee-support (FIN-2B)
**`FeeProvider`** — the sponsor / zakat fund: `{ name, nameBn?, contact?, note?, active }`.
**`FeeSupportAllocation`** — roster-linked, **effective-dated, append-only** "living master" (D-#226):
`{ studentId, providerId, coverage: <see below>, effectiveDate, endDate?, status ∈
FEE_SUPPORT_ALLOCATION_STATUSES, note?, enteredByUserId, createdAt }`. Adds/removes/amount-changes are
**new dated rows**; the active allocation for a student on a date = the latest by `createdAt` with
`effectiveDate ≤ date` and not ended.
- **Coverage model (ratified 2026-06-14, D-#226) — PER-HEAD:** `coverage: [{ head ∈
  FINANCE_STUDENT_FEE_HEADS, type ∈ FEE_COVERAGE_TYPES (FULL | AMOUNT), amount? }]` — one entry per
  covered head; **FULL** = the provider pays that head's whole posted amount, **AMOUNT** = the provider
  pays up to ৳`amount` of it (capped at the posted amount), **per fee posting**. A head NOT listed = the
  guardian pays it fully. Matches SCD's real pattern: some students are FULL across admission / session /
  tuition / revision / books / transport; others get a partial ৳ figure on one-or-more heads that
  **varies per student per head**. *(All current usage is ৳-amounts; a `PERCENT` type is a one-line add
  if a % sponsorship ever appears.)*
- **Fee-split (pure `splitFee(feeLines, coverage)`):** at `FEE_COLLECTION` time, if the student has an
  active allocation, **per fee line** `{head, amount}`: FULL → provider-due += `amount`; AMOUNT `v` →
  provider-due += `min(v, amount)` (guardian-due gets the rest); head not in coverage → guardian-due +=
  `amount`. Summed across lines. The fee posting records the gross; a linked **`ProviderReceivable`**
  movement raises the provider-due against the provider; the guardian-due is exposed for chasing. No
  double-count: the snapshot counts the gross fee once; the receivable is a provider-ledger memo, not a
  second cash-in.
**`ProviderReceipt`** — a provider's payment against its receivable: `{ providerId, amount, date, mode,
note?, enteredBy }` (also a `FinancePosting`-IN so the cash lands in a ledger). Reduces the outstanding.
**Provider statement (derived):** per provider, `Σ provider-due raised` vs `Σ receipts` = outstanding.
**Guardian fee-due (derived):** per student/family, the remaining guardian-due across recent fees — the
chase list.

**Audit kinds** (Audit.ts, NOT vocab): `FINANCE_POSTING_RECORDED`, `FINANCE_POSTING_REVERSED`,
`FEE_SUPPORT_ALLOCATION_SET`, `PROVIDER_RECEIPT_RECORDED`, `FINANCE_FEE_DUE_CHASED`.

## §4 — Vocabulary (app-native; additive; BN+EN; NO wire/envelope sync — REQ §9)
FIN-1 froze the heads/modes/ledgers/dirs+types. FIN-2 adds (additive; extend the finance verifier §):
- `FINANCE_POSTING_KINDS = [FEE_COLLECTION, OTHER_INCOME, EXPENSE, TRANSFER]` + BN/EN labels.
- `FEE_COVERAGE_TYPES = [FULL, AMOUNT]` + labels (per-head coverage type, §3.B; FULL = the whole head, AMOUNT = a ৳ cap).
- `FEE_SUPPORT_ALLOCATION_STATUSES = [ACTIVE, ENDED]` + labels.
- `NOTIFICATION_KINDS += FINANCE_FEE_DUE` (+BN/EN) — **the verifier §C.5 exact-list must be extended by
  the same edit** (the CT-1/CM-2 posture). Guardian login-enabled inbox row; wa.me for all (D-#227).
- `MESSAGE_TEMPLATE_KEYS += finance.fee_due.chase.{title,body,wa}` + registry defaults (the D-#131
  build-on-registry posture; rendered via `renderTemplate`, never inline) — extends verifier §C.13.
- *Posting-kind / allocation-status MAY instead be model-local unions if the build prefers; the
  notification kind + MT keys + coverage types must be vocab (they drive labels/exact-lists).*

## §5 — RBAC (reuses FIN-1 — no new permission)
- All FIN-2 writes (record/reverse posting, set allocation, record provider receipt) + reads (snapshot,
  fee history, provider statement, guardian-due) gate **`finance:manage`** (Principal+Office, D-#221).
- The guardian fee-due **chase** (generate wa.me + emit) gates `finance:manage` (Office runs it); the
  guardian is a **recipient only** — no finance resolver is guardian-readable (REQ §5). No new permission.
- The HR-total read seam (`hrPayrollNetPayableTotal`) is finance-readable as a **PII-free aggregate**
  (D-#228) — confirm the HR side exposes it to `finance:manage` without leaking payslips.

## §6 — Journeys (Given/When/Then)
- **J-FIN2-1 (daily collection).** *Given* a school day, *when* the Office posts a student fee (mode +
  per-head split), other income, and an expense, *then* each `FinancePosting` is appended + audited, and
  `dailySnapshot(today)` shows the per-ledger opening/in/out/closing without any manual carry-forward.
- **J-FIN2-2 (reversal, not edit).** *Given* a mistaken posting, *when* the Office reverses it, *then* a
  linked reversing posting is appended (original retained), and the snapshot nets to correct — no row is
  edited or deleted (J-FIN1-3 discipline).
- **J-FIN2-3 (transfer).** *Given* cash banked, *when* the Office posts a `TRANSFER` Cash→Bank, *then*
  Cash `out` and Bank `in` both reflect it and total cash-on-hand is unchanged.
- **J-FIN2-4 (SALARY from HR + adjust).** *Given* a locked HR payroll month, *when* the Office posts the
  monthly `SALARY` expense, *then* it **pre-fills** with the HR net-payable **total** (no payslip detail
  crosses), the Office adds any **manual deduction/adjustment lines**, and the posting records HR base +
  adjustments to the chosen ledger.
- **J-FIN2-5 (zakat split).** *Given* a student with an active 50%-of-Tuition allocation, *when* the
  Office posts their tuition fee, *then* the app raises the provider's 50% as a receivable and exposes the
  guardian's remaining 50% as due; the gross is counted once in the snapshot.
- **J-FIN2-6 (provider statement & receipt).** *Given* receivables raised, *when* the provider pays and
  the Office records a `ProviderReceipt`, *then* the provider's outstanding drops and the cash lands in a
  ledger; the statement shows owed-vs-paid.
- **J-FIN2-7 (guardian chase).** *Given* outstanding guardian-due, *when* the Office runs the chase,
  *then* a `finance.fee_due.chase.*` wa.me link is built for every family with a phone (+ an inbox row +
  push for login-enabled guardians via `FINANCE_FEE_DUE`); phone-less surface as `unreachableCount`; no
  finance screen is shown to the guardian (J-CM/AS chase posture).
- **J-FIN2-8 (firewall + PII).** *Given* the corpus plane, *then* it cannot resolve any finance model;
  *and* finance never reads an individual payslip — only the HR aggregate (J-FIN1-6 + the PII boundary).

## §7 — Out of scope (FIN-2)
Qard/IOU register (FIN-3) · bank+Eximus reconciliation (FIN-4) · budget-vs-actual (FIN-5) · dashboard +
Expo app (FIN-6) · receipt-image attachments (deferred; reuse GP-A/M-4 DriveStore if added) · payroll
runs/payslips (HR) · guardian self-service online fee payment (deferred) · the zakat fund's own inflow
accounting beyond the per-provider receivable (REQ §7) · period-lock / `finance:approve` (the locking slice).

## §8 — Reused / unchanged
The FIN-1 `LEDGER_KINDS`/`FINANCE_*` vocab + `ledgerBalanceAsOf` seam + `finance:manage` (D-#221–#223) ·
the student roster + `Student.phone` family contact (D-#31/#59) · the MT registry + `renderTemplate`
(MT-1/D-#131) + wa.me (ADR-003) + the `emit()` seam + N-4 push (D-#72/#75/#99) · append-only audit
(ADR-008) · the HR payroll net-payable total (REQ §8) · identity-plane firewall (ADR-005). No
envelope/harness/wire change (REQ §9). No new role (D-#17/#94).

## §9 — Firewall (ADR-005)
All FIN-2 models (`FinancePosting`, `FeeProvider`, `FeeSupportAllocation`, `ProviderReceipt`) are
identity-plane; they import nothing from the corpus plane and vice-versa — the finance firewall block
(FIN-1) is extended to cover them (both ways), NFR-11 stays green. The HR-total read returns a **PII-free
aggregate only** — no payslip/per-staff path is opened.

## §10 — Acceptance gate (build verifies — executed)
1. **FIN-2A:** posting record + reverse (append-only, no edit/delete); `dailySnapshot` derives
   opening/in/out/closing per ledger off the FIN-1 seam; transfer double-effect; SALARY = HR aggregate
   (no payslip crosses); per-child fee history. Vocab verifier PASS (posting-kind enum + labels).
2. **FIN-2B:** effective-dated append-only allocation; `splitFee` provider-due/guardian-due per the
   coverage model (gross counted once); provider receivable + receipt + statement (owed-vs-paid);
   guardian fee-due chase (wa.me all + emit login-enabled, `FINANCE_FEE_DUE` + `finance.fee_due.chase.*`
   from the registry, never inline; `unreachableCount`). Verifier §C.5 + §C.13 extended, PASS.
3. RBAC: Principal+Office reach finance; Teacher/Guardian denied; no guardian-readable finance resolver.
4. Firewall finance block both ways, green; no individual-payslip read path.
5. Full gate: vocab verifier PASS, shared build + shared/server tsc clean, `npm run test
   --workspace=server` all-green (+ `financePosting.test.ts` / `feeSupport.test.ts`). Server-only.

## §11 — Traceability & decision band
- **Builds on:** D-#221–#223 (FIN-1). **Reaffirmed:** D-#191 (zakat full-fee + provider receivable +
  effective-dated allocation), D-#187/#188 (payroll + Qard carved to HR/FIN-3), D-#17/#94/#145, D-#131,
  D-#72, ADR-003/005/008.
- **New (this slice) — D-#224–#230:**
  - **D-#224** — `FinancePosting` is the unified, **append-only** money event (kind-discriminated; fee =
    `feeLines[]` breakdown, transfer = `mode`→`toLedger`); a correction is a **reversing posting**
    referencing the original, never an edit/delete.
  - **D-#225** — the daily snapshot is **derived** by **extending the FIN-1 `ledgerBalanceAsOf` seam**
    (opening + Σ postings); FIN-2 owns Cash/Bank/Online, the Qard/IOU control ledgers stay FIN-3 (which
    extends the same seam) — one balance truth, no second carry.
  - **D-#226** — zakat/3rd-party = `FeeProvider` + **effective-dated append-only `FeeSupportAllocation`**
    + a pure `splitFee` (provider-due/guardian-due, gross counted once) + provider receivable +
    `ProviderReceipt` + statement. **Coverage is PER-HEAD (ratified 2026-06-14):** `[{head, type ∈
    {FULL, AMOUNT}, amount?}]` — FULL = the head's whole posted amount, AMOUNT = a ৳ cap (per fee
    posting), varying per student per head; a head not listed = guardian pays it. (PERCENT deferred —
    all current SCD usage is ৳-amounts.)
  - **D-#227** — guardian fee-due chase rides the existing rails: wa.me for all + `emit()`
    `FINANCE_FEE_DUE` for login-enabled, bodies from the MT registry (`finance.fee_due.chase.*`, D-#131),
    `unreachableCount` for phone-less; **no finance UI for guardians** (REQ §5) — they are recipients only.
  - **D-#228** — the `SALARY` expense **pre-fills from the HR payroll net-payable aggregate total**
    (Σ `payslip.netPay` over the `approved_locked` run; PII-free read seam, `finance:manage`); the Office
    then applies **manual deduction/adjustment lines** (`{label, amount(signed)}`), with the posting
    storing **HR base + adjustments** (`amount = base + Σ adj`, both audited) so finance reconciles to HR.
    Finance never reads an individual payslip (the ADR-005 PII boundary holds). **Ratified 2026-06-14.**
  - **D-#229** — FIN-2 builds as **two PRs**: FIN-2A (postings + snapshot + SALARY) then FIN-2B (zakat
    fee-support), to keep each reviewable; the vocab additions land with their owning sub-slice.
  - **D-#248** — FIN-2B fee-split is a DERIVED memo (gross counted once; the provider/guardian split +
    receivable is derived, never a second ledger movement). *(Reserved as D-#230 at authoring; renumbered to
    #248 at merge — CO-6 had taken #230.)*
- **Next:** FIN-3 (Qard-e-Hasana & IOU register) — authored after FIN-2 is approved/built.
