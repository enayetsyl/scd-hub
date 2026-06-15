# PRD — Finance FIN-3: Qard-e-Hasana & IOU register

**Status:** Planned — build contract (slice 3 of 6). No feature code yet.
**Owner:** Principal (SCD) · **Module prefix:** FIN · **Plane:** identity/operational (ADR-005)
**Source REQ:** `docs/finance-requirements.md` (LOCKED) · **Builds on:** FIN-1 (`prd-finance-fin1.md`), FIN-2 (`prd-finance-fin2.md`)
**Traceability:** D-#186–#192 (REQ) · D-#221–#229 (FIN-1/2) · **new D-#232–#234** · ADR-005/008 · D-#188 (Qard vs HR split)

> The benevolent-loan + office-advance ledger — who owes the school, who the school owes, and when it's due.

## §0 — At a glance
- [ ] The **Qard-e-Hasana (control)** + **IOU (control)** ledgers come alive: per-party disbursement /
  repayment / adjustment, a **per-party running outstanding**, and **due-dates / schedules + overdue**.
- [ ] **Staff salary-recoverable advances are EXCLUDED** — HR owns them (`issueStaffAdvance`/
  `settleStaffAdvance`, D-#188). FIN-3 is for **community / general benevolent loans + NON-salary office
  advances** to non-staff parties.
- [ ] A **saved `FinanceParty` master** (pick-from-list, no name typos) + per-loan **due dates / installment
  schedule** + **overdue** tracking (your call, D-#234). Qard-e-Hasana is **interest-free**.
- [ ] **Append-only** (FIN-1 D-#222): a correction is an `ADJUSTMENT` / reversing entry, never an edit/delete.
- [ ] **FIN-3 extends the FIN-1 `ledgerBalanceAsOf` seam** for the **Qard-control + IOU-control** ledgers
  (and the cash side of disbursements/repayments) — one balance truth (D-#233).
- [ ] Reuses `finance:manage` (no new permission); always-open (no period-lock). Server-only; identity plane.

## §1 — Goal
Replace the "Qard/IOU Central" workbook: every benevolent loan given, office advance to a non-staff party,
and repayment received is recorded once against a saved party, with the running outstanding, the due date /
schedule, and the overdue list derived. The control-ledger balances flow into the same daily snapshot as
the cash ledgers — no separate carry-forward.

## §2 — Scope boundary
| In FIN-3 | NOT FIN-3 |
|---|---|
| `FinanceParty` master + `QardIouEntry` (disburse/repay/adjust) + per-party outstanding + due/overdue | Cash/Bank/Online postings (fees/income/expense) → **FIN-2** |
| Extends `ledgerBalanceAsOf` for Qard-control + IOU-control + the cash effect | **Staff salary advances → HR** (`issueStaffAdvance`/`settleStaffAdvance`, D-#188) |
| | Reconciliation (FIN-4) · budget (FIN-5) · dashboard + app (FIN-6) |

## §3 — Data model (identity plane; append-only; no `schoolId`)
**`FinanceParty`** — the non-staff counterparty: `{ name, nameBn?, kind ∈ FINANCE_PARTY_KINDS
(COMMUNITY | INDIVIDUAL | ORG), contact?, note?, active, enteredByUserId }`. (A staff member's salary
advance is NOT a FinanceParty — that's HR.)
**`QardIouEntry`** — the register movement; **append-only** (D-#222):
`{ partyId, type ∈ QARD_IOU_TYPES (QARD_E_HASANA | IOU), direction ∈ QARD_IOU_DIRECTIONS
(NEW_DISBURSEMENT | REPAYMENT_RECEIVED | ADJUSTMENT), amount (>0), date, mode ∈ FINANCE_PAYMENT_MODES,
dueDate? (a disbursement's expected repayment), schedule?: [{ dueDate, amount }] (optional installments),
note?, reversesEntryId?, enteredByUserId, createdAt }`. (`QARD_IOU_TYPES`/`DIRECTIONS` were frozen in
FIN-1 — D-#223; FIN-3 consumes them.)
- `NEW_DISBURSEMENT` — money out to the party (Cash/Bank **out**, control-ledger outstanding **up**).
- `REPAYMENT_RECEIVED` — money in from the party (Cash/Bank **in**, control-ledger outstanding **down**).
- `ADJUSTMENT` — opening balance / write-off / correction (effective-dated; the REQ §3 "Adjustment").

**`QardIouService`** (pure where possible):
- `setParty` / `recordEntry(...)` (validates type/direction/amount/mode; audited); reverse via an
  `ADJUSTMENT` or a `reversesEntryId` entry (never edit/delete).
- **`partyOutstanding(partyId, asOf)`** → Σ(disbursements − repayments ± adjustments) for that party/type.
- `overdueList(asOf)` → parties with a **past-due unpaid** amount (a disbursement's `dueDate`/schedule
  installment ≤ asOf still outstanding); ranked by lateness. Derived.
- **Extends `ledgerBalanceAsOf` (D-#233):** for `QARD_CONTROL`/`IOU_CONTROL` ledgers = Σ outstanding; for
  Cash/Bank/Online = the cash side of disbursements (out) / repayments (in). The single `QardIouEntry`
  record contributes BOTH effects — **no paired `FinancePosting` duplication** (the gross is counted once;
  it appears in the snapshot's movement breakdown under `FINANCE_LEDGER_MOVEMENT_HEADS` Qard/IOU Repayment).

**Audit kinds** (Audit.ts): `FINANCE_PARTY_SET`, `QARD_IOU_ENTRY_RECORDED`.

## §4 — Vocabulary (app-native; additive; BN+EN; NO wire sync)
- `FINANCE_PARTY_KINDS = [COMMUNITY, INDIVIDUAL, ORG]` + BN/EN labels (+ verifier extension). The
  `QARD_IOU_TYPES`/`QARD_IOU_DIRECTIONS` are already frozen (FIN-1) — FIN-3 adds NO new direction/type.
- *(FINANCE_PARTY_KINDS MAY be a model-local union instead if the build prefers — it drives a small label.)*

## §5 — RBAC — reuses FIN-1, no new permission
All FIN-3 writes (set party, record entry) + reads (outstanding, overdue, register log) gate
**`finance:manage`** (Principal+Office). Guardian none. No new permission; no `finance:approve` (always-open).

## §6 — Journeys (Given/When/Then)
- **J-FIN3-1 (disburse).** *Given* a community Qard-e-Hasana, *when* the Office records a `NEW_DISBURSEMENT`
  to a saved party with a `dueDate`, *then* the party's outstanding rises, Cash falls, the Qard-control
  outstanding rises, and the entry is audited — all from one record.
- **J-FIN3-2 (repay).** *When* the party repays (full or installment), *then* a `REPAYMENT_RECEIVED` drops
  their outstanding + the control ledger and lands the cash in a ledger.
- **J-FIN3-3 (overdue).** *Given* a disbursement whose `dueDate` has passed and is unpaid, *then* the party
  appears on the overdue list, ranked by lateness.
- **J-FIN3-4 (adjust, not edit).** *Given* a mis-keyed amount, *when* the Office posts an `ADJUSTMENT` /
  reversing entry, *then* the outstanding nets correct and the original is retained (append-only).
- **J-FIN3-5 (staff boundary).** *Given* a staff salary advance, *then* it is NOT recordable here — it
  lives in HR (D-#188); FIN-3 has no staff-advance path.
- **J-FIN3-6 (firewall).** The corpus plane cannot resolve any FIN-3 model; firewall green both ways.

## §7 — Out of scope (FIN-3)
Staff salary advances (HR) · interest/profit (Qard-e-Hasana is benevolent, interest-free) · cash postings
(FIN-2) · reconciliation (FIN-4) · budget (FIN-5) · dashboard + app (FIN-6) · automated repayment reminders
(the chase rails exist if wanted later; v1 is the overdue read).

## §8 — Reused / unchanged
FIN-1 `LEDGER_KINDS` (QARD_CONTROL/IOU_CONTROL) + `QARD_IOU_TYPES`/`DIRECTIONS` + `FINANCE_PAYMENT_MODES`
+ the `ledgerBalanceAsOf` seam (D-#223/#225) + `finance:manage` · append-only audit (ADR-008) ·
identity-plane firewall (ADR-005) · single-school (no `schoolId`). HR owns staff advances (D-#188).

## §9 — Firewall (ADR-005)
`FinanceParty` + `QardIouEntry` + `QardIouService` are identity-plane; no corpus path either way; the
finance firewall block (FIN-1/2) is extended to cover them; NFR-11 stays green.

## §10 — Acceptance gate (build verifies — executed)
1. Party master + append-only entries (no edit/delete); per-party outstanding + overdue derive; control +
   cash effects flow through `ledgerBalanceAsOf` with no double-count. `FINANCE_PARTY_KINDS` verifier green.
2. Staff-advance exclusion holds (no FIN-3 path writes a staff advance).
3. RBAC `finance:manage`; firewall both ways green. Full gate: verifier PASS, shared+server tsc, jest
   all-green (+ `qardIou.test.ts`). Server-only.

## §11 — Traceability & decision band
- **Builds on:** D-#221–#229. **Reaffirmed:** D-#188 (Qard/IOU vs HR split), D-#222/#223/#225, D-#17/#94/#145.
- **New — D-#232–#234:**
  - **D-#232** — Qard/IOU = a saved `FinanceParty` master + an **append-only `QardIouEntry`** (frozen
    type×direction) + per-party outstanding; **staff salary advances EXCLUDED** (HR owns them, D-#188).
  - **D-#233** — FIN-3 **extends the `ledgerBalanceAsOf` seam** for the Qard-control + IOU-control ledgers
    AND the cash side of disbursements/repayments — one record, both effects, no `FinancePosting` twin.
  - **D-#234** — a disbursement carries an optional **`dueDate` + installment `schedule`**; **overdue** is
    derived (past-due unpaid), ranked by lateness; **no interest** (Qard-e-Hasana is benevolent).
- **Next:** FIN-4 (dual reconciliation).
