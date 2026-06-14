# Finance & Accounting — Module Requirements (REQ)

_Status: PLANNED (requirements only — no build). Owner: Principal (SCD). Created: 2026-06-14._
_Type: module-level REQ (what/why/scope + sub-PRD map). Slice-level journeys + acceptance live in the per-area PRDs (FIN-1…FIN-6), authored one at a time after this REQ is approved._

> بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ — this module handles the school's amanah (financial trust); accuracy and traceability over convenience.

## Scope checklist (read first)

- [ ] **In:** ledgers + opening balances, daily postings (student fees, other income, expenses), Qard-e-Hasana / IOU register, **dual reconciliation (bank statement + Eximus control figure)**, budget-vs-actual, monthly rollups + Principal dashboard.
- [ ] **In:** zakat / third-party fee support as a roster-linked, effective-dated, append-only allocation with a **provider receivable** + auto fee-split (guardian-due / provider-due).
- [ ] **Out (carved):** salary/payroll internals — the existing **HR payroll module** owns them; finance posts only the monthly **net-payable total** as the `Salary` expense line.
- [ ] **Out (carved):** **staff salary-recoverable advances** — stay in HR (`issueStaffAdvance`/`settleStaffAdvance`).
- [ ] **Boundary:** Eximus stays parallel (separate system of record, **no live connection**); the app is the management/reporting layer that replaces the manual Google-Sheet keying.
- [ ] **One school**, no branch dimension (Sylhet/Dhaka are labels only). Identity-plane only (ADR-005). Reuse Office/Principal RBAC (no new role).

## 1. Goal

Replace the linked **Google-Sheet management layer** (six workbooks: Daily, Budget-vs-Actual, Qard/IOU Central, Salary Master, Bank & Online record, Master Dashboard) with a purpose-built finance module inside the app. Eximus remains the separate entry system as today; the accountant stops re-keying into Google Sheets and instead records directly in the app, which then auto-produces the daily snapshot, monthly report, budget variance, and the Principal's live dashboard — and reconciles **against both the bank statement and an entered Eximus control total**.

This is a **cash/ledger management layer**, not a double-entry general ledger. It mirrors the school's existing balance-and-register discipline; it does not introduce GAAP accounting constructs.

## 2. Gap table (today → target)

| Area | Today (Google Sheets) | Target (app) | Key gap to close |
|---|---|---|---|
| Daily entry | Accountant re-keys Eximus data into the day tab; manual buffer rows | Accountant posts transactions once in the app; snapshot derives | Direct entry replacing manual re-key; derived opening/in/out/closing |
| Ledgers | 5 named ledgers, opening pasted as placeholders | Persistent ledgers; prior-day close = next-day open automatically | No manual carry-forward; opening is computed |
| Student fees | Per-student row split across heads; some free-text | Roster-linked posting with per-head split | Link to the existing student roster; per-child fee history |
| Zakat / 3rd-party | Standalone "Zakat Master" flat list | Roster-linked, effective-dated allocation + provider receivable + auto fee-split | Living master (adds/removes/amount changes) with history + billing |
| Qard / IOU | Central transaction log + person-wise summary | Same, app-native; staff salary-advances excluded (HR owns) | De-duplicate staff advances vs HR |
| Reconciliation | Daily bank software-vs-statement difference | Bank diff **plus** app-vs-Eximus control diff + history | New Eximus control-figure entry alongside bank |
| Budget vs Actual | Actuals pasted monthly; variance formulas | Actuals auto-fed from postings; monthly + cumulative variance | Remove manual paste; live variance |
| Dashboard | IMPORTRANGE stitching across files | One live dashboard (KPIs, trends, YTD, recon history, Qard/IOU status) | Replace cross-file URL stitching |
| Salary | Full Salary Master + monthly runs | **Not rebuilt** — pull HR payroll net-payable total only | Single source of payroll truth (HR) |

## 3. Reference data carried from the sheets (finalized in FIN-1/FIN-2 against live code + glossary)

- **Ledgers (5):** Cash, Bank, Online Payment, Qard-e-Hasana (control), IOU (control).
- **Payment modes:** Cash, Bank, Online.
- **Student-fee heads (per-child split):** Admission, Session, Tuition, Books & Stationeries, Revision, Transport, Other (+ free-text head).
- **Income heads (true income):** Admission Fee, Session Fee, Tuition Fee, Books & Stationeries, Revision Fee, Transport Fee, Application Form & Prospectus, Sadaka, Subsidy, Other Fee, Other.
- **Ledger-movement heads (not income):** Bank Deposit, Qard Repayment, IOU Repayment.
- **Expense heads (~24, unified):** Salary, Rent, Utilities, Gas Bill, Mobile Bills, Repairing & Maintenance, Transport, Conveyance, Class Material, Office Stationary, Student Stationary, Kitchen Materials, Cleaning, Breakfast, Lunch, Afternoon Meal, Food Reward, Halaqa, Picnic, Community, Training (exact set frozen in FIN-1).
- **Qard/IOU directions:** New Disbursement, Repayment Received, Adjustment (opening balance). **Types:** Qard-e-Hasana, IOU.

## 4. Sub-PRD decomposition (build map — each is a separate planning session + PRD)

| Slice | Scope | Notes |
|---|---|---|
| **FIN-1** | Ledgers & opening balances | 5 ledgers; head/mode enums; one school, no branch; opening = prior close. |
| **FIN-2** | Daily entry & postings | Student fees (roster-linked, per-head split) + zakat fee-split, other income, expenses; derives the daily snapshot. Includes the zakat allocation + provider-receivable register. |
| **FIN-3** | Qard-e-Hasana & IOU register | Community/general benevolent loans + non-salary office advances; person-wise outstanding. Staff salary-recoverable advances excluded (HR). |
| **FIN-4** | Dual reconciliation | Per-day bank-statement balance **and** Eximus control figure; app-vs-bank and app-vs-Eximus differences + history. |
| **FIN-5** | Budget vs Actual | Annual budget per head; actuals auto-fed from FIN-2; monthly + cumulative variance; surplus/deficit. |
| **FIN-6** | Rollups & Principal dashboard | Monthly report + year overview KPIs, trends, YTD income statement, recon history, Qard/IOU status. |

## 5. Roles

Reuse existing RBAC — **no new role or permission** (D-#17/#94 posture):
- **Office** — records postings, Qard/IOU movements, daily bank + Eximus reconciliation, zakat allocations and provider receipts; runs guardian fee-due chasing.
- **Principal** — reviews dashboard and reports; holds any approval-style / period-lock controls (defined per FIN PRD).
- **Guardian** — no finance UI in v1; receives fee-due chase messages only (reusing the existing message rails).

## 6. High-level journeys (REQ-level; detailed G/W/T per FIN PRD)

- **J-FIN1 — Daily collection (Office):** *Given* a school day, *when* the Office records a student's fee, other income, and expenses with mode + head, *then* the day's opening/in/out/closing per ledger derive automatically and the month report updates.
- **J-FIN2 — Dual reconciliation (Office):** *Given* a posted day, *when* the Office enters the bank-statement balance and the Eximus control figure, *then* the app shows app-vs-bank and app-vs-Eximus differences and records them to reconciliation history.
- **J-FIN3 — Qard/IOU (Office):** *Given* a benevolent loan or office advance to a non-staff party, *when* the Office logs disbursement/repayment/adjustment, *then* the person-wise outstanding updates. (Staff salary advances are handled in HR, not here.)
- **J-FIN4 — Zakat & dues (Office):** *Given* a covered student with an active allocation, *when* the Office records the fee, *then* the app splits it into guardian-due and provider-due, raises the provider's receivable, and exposes the guardian's remaining due for chasing; *and* a provider statement totals what each provider owes vs has paid.
- **J-FIN5 — Principal review (Principal):** *Given* the live module, *when* the Principal opens the dashboard, *then* KPIs, monthly trends, YTD income statement, budget variance, Qard/IOU status, recon history, and "zakat support applied" are shown without cross-file stitching.

## 7. Out of scope (v1)

- Payroll computation/runs and payslips — **HR module owns**; finance consumes the monthly net-payable total only.
- Staff salary-recoverable advances — HR (`issueStaffAdvance`/`settleStaffAdvance`).
- Live Eximus integration/API — reconciliation is via a **manually entered control figure** only.
- Guardian self-service online fee payment — deferred (chasing only in v1).
- Multi-branch / multi-school ledgers — single school (D-#145/#140 reaffirmed).
- Double-entry GL / formal financial statements beyond the income-statement view.
- Receipt-image attachments on transactions — deferred; if added later, reuse the GP-A/M-4 DriveStore pattern (decided per FIN PRD).
- Zakat fund's own inflow accounting beyond the per-provider receivable.

## 8. Reused / unchanged

- **Student roster + guardian links** (foundation module) — fees and zakat allocations link to existing students.
- **HR payroll module** — supplies the monthly `Salary` expense total.
- **Audit log** (platform, ADR-008) — finance writes append-only audit entries.
- **RBAC** Office/Principal (D-#17/#94) — no new role/permission.
- **Identity plane** (ADR-005) — finance is identity-linked; it never joins the analytics/corpus plane; the fail-closed firewall extends both ways.
- **Message Templates registry (MT-1 / D-#131) + wa.me seam (ADR-003)** — guardian fee-due chase messages render from the registry; no inline strings.
- **Append-only discipline** — allocations, Qard/IOU movements, and reconciliation history are dated entries, never overwrites.

## 9. Vocabulary & contract note (for the FIN PRDs)

Finance is an **app-native FEATURE**, not `doc_type` corpus content. Its enums (ledger kinds, finance income/expense heads, payment modes, Qard/IOU directions+types, recon sources, zakat-allocation status, etc.) are added to `/shared/vocab.ts` with BN/EN labels **with NO import-envelope/wire sync expected** — serialize `vocab.ts` per AGENTS rule 5. **If any FIN PRD ever touches a mirrored enum or the import-contract schema, that PRD must write the two-/three-place sync requirement (schema + `/shared/vocab.ts` + harness) into itself.** This REQ touches no vocab or schema files.

## 10. Traceability

- **New decisions:** D-#186 (module + Eximus boundary), D-#187 (payroll carved out), D-#188 (Qard/IOU vs HR split), D-#189 (single-school/no-branch), D-#190 (identity-plane + roster-linked fees), D-#191 (zakat full-fee + provider receivable + effective-dated allocation), D-#192 (reuse Office/Principal RBAC).
- **Reaffirmed:** D-#145 / D-#140 (single-school, no `schoolId`); D-#17 / D-#94 (no new role/permission).
- **ADRs:** ADR-005 (PII firewall / plane split), ADR-008 (append-only audit), ADR-003 (manual wa.me send).
- **Related modules:** HR payroll + staff advances (D-#135); Message Templates (MT-1 / D-#131).
