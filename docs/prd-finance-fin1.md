# PRD — Finance FIN-1: Ledgers & opening balances

**Status:** Planned — build contract (slice 1 of 6). No feature code yet.
**Owner:** Principal (SCD) · **Module prefix:** FIN · **Plane:** identity/operational (ADR-005)
**Source REQ:** `docs/finance-requirements.md` (LOCKED) · **Slice map:** REQ §4 (FIN-1…FIN-6)
**Traceability:** D-#186–#192 (the REQ) · **new D-#221–#223** (this slice) · ADR-005/008 · D-#17/#94/#145

> بِسْمِ اللَّهِ — the school's amanah. FIN-1 lays the foundation: the ledgers, the finance
> vocabulary, and the opening balances every later slice computes from. Accuracy + traceability.

## §0 — At a glance (read first)
- [ ] **FIN-1 builds the FOUNDATION, not the postings.** It establishes the 5 ledgers, freezes the
  full finance vocabulary (heads/modes/directions), stores the migration **opening balances**
  (effective-dated, append-only), and exposes the **`ledgerBalanceAsOf` seam** that FIN-2 fills with
  postings. *No transactions are entered in FIN-1.*
- [ ] **Opening is the only stored balance** — every later day's opening = the prior day's close,
  **computed** (REQ §2), never carried by hand.
- [ ] **One new permission `finance:manage`** (Principal+Office) — see §5 (refines REQ D-#192;
  **ratified 2026-06-14**).
- [ ] Server-only. App is a later slice (FIN-6 / per-slice). Single school, no branch, no `schoolId`.
- [ ] Identity plane (ADR-005) — finance never joins the corpus/analytics plane. Append-only audit.
- [ ] App-native vocab — **no import-envelope / wire / harness sync** (REQ §9, AGENTS rule 5).

## §1 — Goal
Stand up the finance ledger foundation so FIN-2 (daily postings) has somewhere to post and something
to derive from. Concretely: (a) name the 5 ledgers as a controlled vocabulary; (b) freeze the
income/expense/fee/movement heads, payment modes, and Qard/IOU directions+types as app-native enums
(carried verbatim from the live sheets, REQ §3); (c) record the **opening balances** at the
Google-Sheet→app cutover, dated and append-only; (d) provide the pure **balance-as-of** read seam that
returns the opening today and, once FIN-2 lands, opening + Σ(postings). Nothing else moves yet.

## §2 — Scope boundary (FIN-1 vs the rest)
| In FIN-1 | NOT FIN-1 (later slice) |
|---|---|
| The 5 `LEDGER_KINDS` + the full finance enum freeze (§4) | Daily fee/income/expense **postings** + the daily snapshot → **FIN-2** |
| `LedgerOpeningBalance` (effective-dated, append-only) + set/list | Roster-linked student fees, zakat fee-split, provider receivable → **FIN-2** |
| `ledgerBalanceAsOf` seam (returns opening-only now) | Qard/IOU register movements + person-wise outstanding → **FIN-3** (FIN-1 only freezes the dir/type enums) |
| `finance:manage` permission + audit + firewall block | Bank/Eximus dual reconciliation → **FIN-4** · Budget-vs-actual → **FIN-5** · Dashboard + app → **FIN-6** |

FIN-1 deliberately ships the vocabulary the *whole* module needs (one vocab-owner edit, AGENTS
"one vocab owner at a time"); the *models that consume* the heads (postings) are FIN-2/FIN-3.

## §3 — Data model (identity plane; no corpus path; no `schoolId`)
**`LedgerOpeningBalance`** — the migration seed; the only stored balance.
`{ ledger ∈ LEDGER_KINDS, amount: number (signed — a control ledger may be negative), effectiveDate:
Date (the cutover/as-of date this opening applies from), note?: string, enteredByUserId, createdAt }`.
- **Append-only (D-#222).** A correction is a **new dated row**, never an overwrite (REQ §8). The
  *authoritative* opening for a ledger as of a query date = the row with the **latest `createdAt`**
  whose `effectiveDate ≤ queryDate` (a later re-declaration supersedes; before any declaration ⇒ 0).
- One declaration per ledger at cutover is the norm; the model also supports a later effective-dated
  re-declaration (e.g. an audited true-up) without losing history.
- No `schoolId` (single school, D-#145). No `academicYearId` — the opening is a calendar-dated seed,
  not year-scoped (the budget *year* is FIN-5's concern).

**`FinanceLedgerService`** (pure where possible; the `classTestScoring`/`ref11` posture):
- `setOpeningBalance({ ledger, amount, effectiveDate, note? }, actor)` → appends one
  `LedgerOpeningBalance`; audited `FINANCE_OPENING_BALANCE_SET`. Validates `ledger ∈ LEDGER_KINDS`,
  finite amount, valid date.
- `openingBalances(asOf = today)` → the authoritative opening per ledger (latest declaration ≤ asOf),
  for all 5 ledgers (missing ⇒ 0), derived.
- **`ledgerBalanceAsOf(ledger, asOf)`** → **= the opening as-of `asOf`** in FIN-1. *FIN-2 extends this
  one function* to `opening + Σ(postings up to asOf)` — the single seam every later slice's snapshot,
  reconciliation, and dashboard reads through (D-#223). Pure `openingFor(declarations, ledger, asOf)`
  helper is unit-tested directly.
- `allLedgerBalancesAsOf(asOf)` → the 5-ledger vector (the snapshot stub FIN-2 grows).

**Audit kinds** (`platform/models/Audit.ts`, ADR-008 — NOT vocab): `FINANCE_OPENING_BALANCE_SET`.

## §4 — Vocabulary (app-native; `/shared/vocab.ts`; BN + EN labels; NO wire/envelope sync — REQ §9)
FIN-1 owns the finance vocab freeze. Codes are English `UPPER_SNAKE`; every enum gets total BN+EN
label maps and a new verifier section. **Namespaced `FINANCE_*` / `LEDGER_*` / `QARD_IOU_*` to avoid
the existing HR `PAYMENT_METHODS`/`PaymentMethod` clash (which is salary disbursement: bank/bkash/cash).**

- `LEDGER_KINDS = [CASH, BANK, ONLINE, QARD_CONTROL, IOU_CONTROL]` — the 5 ledgers (REQ §3).
- `FINANCE_PAYMENT_MODES = [CASH, BANK, ONLINE]` — the 3 movement modes (distinct from HR's enum).
- `FINANCE_INCOME_HEADS` — Admission Fee, Session Fee, Tuition Fee, Books & Stationeries, Revision Fee,
  Transport Fee, Application Form & Prospectus, Sadaka, Subsidy, Other Fee, Other (REQ §3, true income).
- `FINANCE_STUDENT_FEE_HEADS` — Admission, Session, Tuition, Books & Stationeries, Revision, Transport,
  Other (the per-child split; `OTHER` carries a free-text label at posting time, FIN-2).
- `FINANCE_LEDGER_MOVEMENT_HEADS = [BANK_DEPOSIT, QARD_REPAYMENT, IOU_REPAYMENT]` — movements, **not
  income** (REQ §3 — kept a separate enum so FIN-5 budget/actual never counts them as revenue).
- `FINANCE_EXPENSE_HEADS` — the **22 unified heads, RATIFIED 2026-06-15** (REQ §3): Salary, Rent, Utilities,
  Gas Bill, Mobile Bills, Repairing & Maintenance, Transport, Conveyance, Class Material, Office
  Stationary, Student Stationary, Kitchen Materials, Cleaning, Breakfast, Lunch, Afternoon Meal, Food
  Reward, Halaqa, Picnic, Community, Training, Other. (`SALARY` is the line HR payroll feeds — REQ §3/§7.)
- `QARD_IOU_DIRECTIONS = [NEW_DISBURSEMENT, REPAYMENT_RECEIVED, ADJUSTMENT]` (ADJUSTMENT = opening
  balance) + `QARD_IOU_TYPES = [QARD_E_HASANA, IOU]` (frozen now; the register is FIN-3).
- **Verifier (new §, exact-set checks):** each enum exact + BN/EN label totality; `LEDGER_KINDS` is
  exactly the 5; `FINANCE_LEDGER_MOVEMENT_HEADS` disjoint from `FINANCE_INCOME_HEADS`; the OFFICE/role
  permission exact-lists updated for `finance:manage` (§5). Follow the vocab header "add an enum" +
  "add a Permission" checklists.
- **Head lists RATIFIED 2026-06-15 + management (D-#247):** the expense (22) / income (11) / student-fee (7)
  lists are confirmed final (income heads = Admission Fee, Session Fee, Tuition Fee, Books & Stationeries,
  Revision Fee, Transport Fee, Application Form & Prospectus, Sadaka, Subsidy, Other Fee, Other; fee heads =
  Admission, Session, Tuition, Books & Stationeries, Revision, Transport, Other). Heads are a **code-controlled
  list** (NOT an Office-managed registry) — adding/renaming a head later is an **additive vocab edit** by a
  developer (one enum line + BN/EN label + verifier; **NO migration** — existing postings keep their head);
  the **`OTHER` head + free-text note** is the runtime escape valve for one-offs. (A self-service `FinanceHead`
  registry was considered and DEFERRED — the chart is stable; revisit only if heads change often.)

> **No mirrored/wire enum is touched.** If any *later* FIN PRD ever touches the import-contract schema
> or a mirrored enum, that PRD writes the two-/three-place sync into itself (REQ §9). FIN-1 does not.

## §5 — RBAC  (refines REQ D-#192 — **ratified 2026-06-14**)
**Ratified (D-#221): one new permission `finance:manage` (Principal + Office), no new role.**
- Writes (`setOpeningBalance`) and reads (`openingBalances`/`ledgerBalanceAsOf`) gate `finance:manage`.
  Guardian holds none (REQ §5 — no finance UI). `PERMISSION_BUILD_STATUS["finance:manage"]="build"`.
- **Why a new permission rather than reusing an existing one (the REQ §5/§10 "no new permission"):**
  finance is a distinct functional area, exactly like **Library** (`library:manage`, D-#81),
  **Classroom Observation** (`observation:*`, D-#146/#147), and **HR** (`payroll:manage`/`staff:manage`)
  — all of which minted their own permission without adding a role. Reusing `roster:manage` (Office's
  generic admin perm) would **couple finance to roster duties**: with the now-live **AC-1 per-user
  access control**, a Principal granting `roster:manage` to a teacher (for class-teacher assignments)
  would *also* hand them the books. A dedicated `finance:manage` lets the Principal grant finance to
  **the accountant specifically** (AC-1's whole point) without bundling unrelated powers. This refines
  D-#192's *intent* ("reuse the Office/Principal model, don't add a role") while correcting its letter.
- **`finance:approve` (Principal-only) is NOT introduced in FIN-1** — period-lock / approval lands with
  the slice that needs it (FIN-2 posting-lock or FIN-6), introduced as `finance:approve` then (the
  `payroll:approve` posture). FIN-1 needs only `finance:manage`.
- *Alternative if the Principal rejects a new perm:* gate finance on `roster:manage` (Office's admin
  perm; functionally reaches Principal+Office today). The PRD body is otherwise unchanged — only the
  gate string differs. (Recorded so the decision is reversible without a rewrite.)

## §6 — Journeys (Given/When/Then)
- **J-FIN1-1 (set opening).** *Given* the cutover, *when* the Office sets the Cash ledger's opening to
  ৳X effective the cutover date, *then* a `LedgerOpeningBalance` row is appended, audited, and
  `ledgerBalanceAsOf(CASH, cutover)` returns ৳X.
- **J-FIN1-2 (the 5-ledger snapshot).** *Given* openings set for all 5 ledgers, *when* the Office opens
  the ledgers view, *then* all five authoritative openings render (un-set ⇒ ৳0), derived.
- **J-FIN1-3 (append-only correction).** *Given* a wrong opening, *when* the Office re-declares the
  ledger's opening (a new dated row), *then* the latest declaration is authoritative, the prior row is
  retained as history (never overwritten), and the audit trail shows both.
- **J-FIN1-4 (effective-dating).** *Given* an opening effective from date D, *when* `ledgerBalanceAsOf`
  is asked for a date before D, *then* it returns ৳0 (the ledger had no declared opening yet).
- **J-FIN1-5 (RBAC deny).** *Given* a Teacher or Guardian (no `finance:manage`), *when* they call any
  finance resolver, *then* it is denied (Bangla); only Principal/Office reach it.
- **J-FIN1-6 (firewall).** *Given* the corpus/analytics plane, *when* it runs, *then* it cannot resolve
  any finance model — the fail-closed firewall test stays green (a new finance block, both ways).

## §7 — Out of scope (FIN-1)
Postings / daily snapshot (FIN-2) · roster-linked fees + zakat fee-split + provider receivable (FIN-2) ·
Qard/IOU register movements + outstanding (FIN-3 — FIN-1 only freezes the dir/type enums) · bank +
Eximus reconciliation (FIN-4) · budget-vs-actual (FIN-5) · dashboard + Expo app (FIN-6) · receipt-image
attachments (deferred, REQ §7) · payroll internals (HR owns; finance only posts the `SALARY` total, REQ
§7) · period-lock / `finance:approve` (the slice that introduces locking).

## §8 — Reused / unchanged
Append-only audit (ADR-008) · the 4-role RBAC + the AC-1 per-user model (a new permission, no new role —
D-#17/#94) · identity-plane firewall (ADR-005) · single-school convention, no `schoolId` (D-#145) ·
`AcademicYear` exists but FIN-1 does not bind to it (opening is calendar-dated). No envelope/harness/wire
change (REQ §9). No new model on the corpus plane.

## §9 — Firewall (ADR-005)
`LedgerOpeningBalance` + `FinanceLedgerService` are identity-plane; they import nothing from the corpus
plane and the corpus plane imports nothing from finance. The build adds a **new finance block to the
fail-closed firewall test (corpus ⇄ finance, both ways)** — the NFR-11 test must stay green.

## §10 — Acceptance gate (build verifies — executed)
1. `LEDGER_KINDS`/`FINANCE_*`/`QARD_IOU_*` present + label-total (BN+EN); the new verifier section
   green; `finance:manage` declared, BUILD, Principal+Office exact-holder; vocab verifier **PASS**.
2. `setOpeningBalance` appends (never overwrites); `openingBalances`/`ledgerBalanceAsOf` derive the
   authoritative opening (latest declaration ≤ asOf; pre-declaration ⇒ 0); audited.
3. RBAC: Principal+Office reach finance; Teacher/Guardian denied (J-FIN1-5 tested).
4. Firewall finance block both ways, green.
5. Full gate: vocab verifier PASS, shared build + shared/server tsc clean, `npm run test
   --workspace=server` all-green (+ a new `finance.test.ts` suite). Server-only — no app, no expo.

## §11 — Traceability & decision band
- **REQ:** D-#186–#192 (`docs/finance-requirements.md`). **Reaffirmed:** D-#17/#94 (no new role),
  D-#145 (single-school, no `schoolId`), ADR-005/008/003.
- **New (this slice) — D-#221–#223:**
  - **D-#221** — `finance:manage` (Principal+Office), no new role; **refines D-#192** (distinct function
    deserves its own perm per the Library/Observation/HR precedent + the AC-1 per-user-grant synergy).
    **Ratified 2026-06-14.**
  - **D-#222** — opening balances are **effective-dated + append-only**; authoritative = latest
    declaration (`createdAt`) with `effectiveDate ≤ asOf`; corrections are new dated rows, never
    overwrites (REQ §8 discipline).
  - **D-#223** — FIN-1 **freezes the full finance vocabulary** (ledgers/modes/heads/qard-iou
    dirs+types, `FINANCE_*`-namespaced, app-native, no wire sync); the single **`ledgerBalanceAsOf`
    seam** returns opening-only in FIN-1 and is *extended* (not replaced) by FIN-2 to add Σ(postings).
  - **D-#247 (ratified 2026-06-15)** — the head lists are **confirmed final** (22 expense / 11 income / 7
    student-fee) and heads are a **code-controlled list, NOT an Office-managed registry**: a new head is an
    additive vocab edit by a developer (no migration; existing data safe), and the `OTHER` head + free-text
    note is the runtime escape valve; a self-service `FinanceHead` registry was considered and deferred.
- **Next:** FIN-2 (daily entry & postings) — authored after FIN-1 is approved/built.
