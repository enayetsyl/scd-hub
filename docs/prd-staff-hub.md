# PRD — Staff Hub: one place for a staff member's whole lifecycle (`hr` module, slices SH-1..SH-7)

Source: owner ask 2026-08-25, with the EximusEdu teacher profile as the reference surface and
`SCD Appointment Letter (Suhel Ahmad).docx` as the letter template.
Decisions ratified in the same session: **D-#539..#545**.
Supersedes nothing; **extends** `prd-hr.md` (H1–H6) rather than replacing it.

---

## §0 — At a glance

The owner's words: *"in the eximus the starting to ending i can see in a single place. but in our
app i have to jump in 10 different places for hr, admission, leave, payroll, dismiss related task.
I want to consolidate everything in a single tab."*

Six asks, in the order they were given:

1. Join a teacher — enter full details, activate the account, generate the password.
2. One button issues the **appointment letter**.
3. Enter a **confirmation date** → a confirmation letter from the same data + free extra text.
4. **Leave balance** visible on the profile.
5. **3 late days = 1 day** — taken from leave first, then from salary.
6. **Probation = all leave unpaid; permanent = 20 days.** Proper leave display on the teacher's
   profile, with daily attendance times.

The engine for most of this already exists. The gap is a **surface** (there is no staff detail
screen anywhere in the app) plus **four genuinely new rules** (§4).

---

## §1 — Goal

One `StaffHub` screen, reached from the staff list and from the HR tab, carrying every tab of a
staff member's record; and one **join wizard** that ends on that screen with the login provisioned
and the appointment letter issued — instead of the three unconnected screens that do it today.

**Non-goal:** re-implementing leave, payroll, performance or offboarding. Those services are
shipped and correct; this PRD gives them a shared surface and adds the four rules below.

---

## §2 — Gap table

| # | Ask | Status today | Where |
|---|---|---|---|
| 1 | Staff details | **Exists** — `StaffProfile`, 24 fields, create/edit from the app (D-#526) | `StaffFormScreen` |
| 1 | Activate + password | **Exists** — `provisionStaffLogin` / `resetStaffPassword`, phone login, one-time password, WhatsApp share (D-#60) | `StaffCredentialsScreen` |
| 1 | …as one flow | **MISSING** — the form `goBack()`s to the list; credentials are a separate screen listing everyone | SH-6 |
| 2 | Appointment letter | **MISSING** — no letter concept anywhere in the repo | SH-1 |
| 3 | Confirmation date | **MISSING** — `employmentStatus` flips with no date, so nothing knows *when* | SH-2 |
| 3 | Confirmation letter | **MISSING** | SH-1/SH-2 |
| 4 | Leave balance | **Exists** — `balancesForStaff()` — but reachable only from MyLeave (own) / LeaveAdmin | SH-5 |
| 5 | Lateness rule | **MISSING** — `computePayslip` has an unwired `latenessDeduction` slot; nothing counts LATE days | SH-4 |
| 6 | Probation leave | **MISSING** — `splitLeaveDays` never looks at employment status | SH-3 |
| 6 | The 20-day pool | **MISSING** — allowances are per-(staff, year, **type**) with no defaults | SH-3 |
| 6 | Attendance times | **Exists** — `TeacherAttendanceDay.punchIn/punchOut/shift` — but no admin per-staff read | SH-5 |
| — | The hub itself | **MISSING** — no staff detail screen exists | SH-6 |

---

## §3 — Reused / unchanged (do not rebuild)

- `StaffProfile` + `StaffProfileService` + the `staff` query and its `staff:manage` gate.
- `provisionStaffLogin` / `resetStaffPassword` and the whole `user:manage` credential path.
- `StaffLeaveApplication`, `StaffLeaveEntitlement`, `applyForLeave`, `decideLeave`, `CoverService`.
- `TeacherAttendanceDay` and the biometric importer — **no change at all**; the hub only reads it.
- `PayrollRun` / `Payslip` / `computePayslip` / `AdvanceService` — one new input line, no new maths.
- `OffboardingCase` and the whole exit path.
- `pdfRenderer.ts`'s `mixedText` (Bengali via Noto, Latin via Helvetica) and the
  `/pdf/set/:id` route pattern — the letters ride both.

**No new permission.** Letters ride `staff:manage`; the HR policy rides `payroll:manage`; the
per-staff attendance read rides `attendance:manage`. Adding a permission would mean an RBAC
contract change (`/shared/vocab.ts` + harness + verifier) for no gate that the existing four
do not already express.

---

## §4 — The four new rules (owner rulings, 2026-08-25)

### D-#539 — One shared 20-day pool, not per-type allowances

The appointment letter, clause 7: *"Total 20 days including sick leave and casual leave."*
That is **one pool**, and today's model cannot express it — `StaffLeaveEntitlement` is keyed
`(staff, year, leaveType)`, so casual 20 + sick 20 = 40 paid days, contradicting the letter every
employee has signed.

`casual`, `sick` and `bereavement` now draw from a single annual pool. The number lives on a new
`HrPolicy` singleton with **read-time defaults** — the D-#97 posture, mirroring `LibraryPolicy`:
no seed write ever runs against the shared live Atlas, and an absent row reads as the PRD value
(20). Per-type `StaffLeaveEntitlement` rows are **retained** as a deliberate override for the
individual exception; when one exists for a type it wins for that type.

Mid-year joiners are pro-rated by the existing `proRateAllowance` — unchanged.

### D-#540 — Probation leave is a HELD DEBT, not a monthly deduction

Owner's words: *"Record as unpaid and will be adjusted on when become permanent or if not left
will be adjusted on final month salary."*

So leave taken before confirmation is:

- **recorded** and approved normally (the absence must still reach cover and the routine),
- marked unpaid — it never draws the pool,
- **not deducted from that month's salary**,
- accrued on a `ProbationLeaveDebt` ledger instead.

Settlement, decided by the owner:

| Event | What happens to the held days |
|---|---|
| Confirmed | Debited from the **new pool** at confirmation. Excess over the pool falls to salary. |
| Leaves before confirmation | Deducted at day-rate from the **final month / settlement**. |

**Paid-ness is derived from a DATE, not from the current status.** `paid` iff
`confirmationDate` exists AND `fromKey >= confirmationDate`. Deriving it from the live
`employmentStatus` would make a confirmation retroactively pay for last March's probation leave.

### D-#541 — 3 late days = 1 day, monthly, leave first then salary

Per **calendar month**: `chargedDays = floor(lateCount / 3)`. The leftover 1–2 lates are
**forgiven at month end** — the counter resets, it does not carry.

The charged day comes off the leave pool first; once the pool is empty it becomes a day-rate
salary deduction. It is computed at payroll **prepare** and **frozen when the run locks**, so a
later attendance re-import cannot change an issued payslip — the same guarantee every other
payslip line already carries.

It is a **record** (`LatenessCharge`), not a silent balance decrement. A teacher who asks why
their balance dropped by a day must be shown the three dates that did it.

`prd-hr.md` H4.3 parked exactly this: *"lateness/early-departure = no deduction by default …
with an optional Principal-configurable deduction rule (parameters parked)"*. This fills the
parked parameters; the rule stays **off** until `HrPolicy.latenessRuleEnabled` is set, so no
existing payroll behaviour changes on deploy.

### D-#542 — A letter is a frozen record, not a printout

`StaffLetter` stores a **snapshot of every merge field at issue time**; the PDF renders from the
snapshot, never from the live profile. A letter signed in January must still print identically
after the address is edited in June — the `Payslip.snapshotName` posture, for the same reason.

Consequences: a letter is never edited. A wrong letter is **voided** (kept, marked, still
renderable) and a new one issued. Ref numbers are per-year sequential and never reused.

The template's two self-contradictions are resolved at issue time, not reproduced:

- Clause 1 (salary) and clause 2 (honorary) are **mutually exclusive** — the issuer picks
  `paid` or `honorary` and only that clause prints.
- Clause 6's *"Your duties as a principal"* interpolates the person's real designation.

---

## §5 — Slices

### SH-1 — `StaffLetter`: model, service, resolvers, PDF route  *(server)*
- `STAFF_LETTER_KINDS` = `appointment | confirmation | service_certificate` in `/shared/vocab.ts`
  with BN/EN labels. App-native, no wire twin — the import envelope is untouched.
- `StaffLetter` model: `staffProfileId`, `kind`, `refNo` (unique), `issuedOn`, `snapshot`
  (every merge field), `extraText`, `salaryMode` (`paid | honorary`), `status`
  (`issued | void`), `issuedBy`, `voidedBy`/`voidReason`.
- `StaffLetterService`: `issueLetter` (builds the snapshot from the live profile + policy,
  allocates the ref no), `voidLetter`, `lettersForStaff`.
- `GET /pdf/staff-letter/:id` — `staff:manage`, pdfkit + `mixedText`, rendering **from the
  snapshot only**.
- Audit kinds `STAFF_LETTER_ISSUED` / `STAFF_LETTER_VOIDED`.

### SH-2 — `confirmationDate` + the confirmation action  *(server)*
- `StaffProfile.confirmationDate?: Date`, writable through a dedicated
  `confirmStaffEmployment(staffProfileId, confirmationDate, extraText, issueLetter)` mutation
  (not the generic profile input — confirming is an event with side effects, not a field edit).
- Sets `employmentStatus = "confirmed"`, settles the probation debt (D-#540), optionally issues
  the confirmation letter in the same call. Audited `STAFF_EMPLOYMENT_CONFIRMED`.

### SH-3 — The leave pool + probation debt  *(server)*
- `HrPolicy` singleton (read-time defaults, no seed): `annualLeaveDays: 20`,
  `lateDaysPerCharge: 3`, `latenessRuleEnabled: false`, `probationDebtEnabled: true`.
- `LeaveEntitlementService`: a `poolBalance()` alongside the per-type view; `balancesForStaff`
  gains the pooled shape without dropping the per-type override.
- `splitLeaveDays` gains `isProbationLeave` — probation leave is 0 paid / all unpaid, and the
  approve path writes a `ProbationLeaveDebt` row instead of touching the pool.
- `settleProbationDebt()` — called by SH-2 on confirmation and by `OffboardingService` at exit.

### SH-4 — `LatenessCharge` + payroll wiring  *(server)*
- `LatenessCharge` per `(staffProfileId, monthKey)`: `lateDateKeys[]`, `chargedDays`,
  `paidFromLeave`, `chargedToSalary`, `dayRate`, `frozen`.
- `computeLatenessCharge(staffProfileId, monthKey)` — pure where it can be, DB-backed where it
  must be; `PayrollService.prepareRun` calls it and passes the money half into the existing
  `computePayslip({ latenessDeduction })`.
- Frozen at lock, alongside the payslips.

### SH-5 — The reads the hub needs  *(server)*
- `staffAttendance(staffProfileId, fromKey, toKey)` — `attendance:manage`; wraps the existing
  `staffAttendanceForRange`.
- `staffAttendanceSummary(staffProfileId, fromKey, toKey)` — counts + %.
- `staffLeaveBalance(staffProfileId)` — pooled balance + held debt, `leave:manage`.
- `staffPayslips(staffProfileId)` — `payroll:manage`; and `myPayslips` for the own-row twin that
  `MyRecordScreen` has been missing since PR-1.
- Per-tab queries, **never one aggregate**: D-#532's lesson is that a permission-carrying probe
  returning `null` takes the navigator down.

### SH-6 — `StaffHubScreen` + the join wizard  *(app)*
- `StaffHubScreen` — tabs প্রোফাইল · উপস্থিতি · ছুটি · বেতন · কাগজপত্র, each gated by `can()`
  and lazily queried. Action bar: সম্পাদনা / পাসওয়ার্ড রিসেট / নিয়োগপত্র / স্থায়ীকরণ / অব্যাহতি.
- Registered in **both** the Admin and HR stacks (the `StudentProfile` precedent) and **never
  first** in either — a param-taking initial route crashes the whole tab, and neither `tsc` nor
  `expo export` catches it.
- `StaffJoinWizard` — ধাপ ১ তথ্য → ২ বেতন → ৩ লগইন → ৪ নিয়োগপত্র, ending on the hub.
  Step 3 is Principal-only (`user:manage`); for an Office caller it shows a waiting state and
  lets them finish rather than dead-ending. **Editing keeps the existing flat form.**

### SH-7 — Own-row mirror + the gate  *(app + verification)*
- `MyRecordScreen` gains own leave balance, own attendance and own payslips — the three
  "pending, no own-row read exists" notices it has carried since PR-1.
- Gate: shared build, server `tsc`, app `tsc`, vocab verifier, server jest, expo web export.

---

## §6 — Acceptance criteria

**A1** Given a staff member on probation with no `confirmationDate`, when they take 3 days of
casual leave and it is approved, then the pool is unchanged, `paidDays = 0`, and a
`ProbationLeaveDebt` row of 3 days exists.

**A2** Given that same person is then confirmed on 01-07 with a pro-rated pool of 10, when
`confirmStaffEmployment` runs, then the debt is settled against the pool, remaining = 7, and the
debt row is marked settled — with **no salary deduction**.

**A3** Given held days exceeding the pool (12 held, 10 pool), when confirmed, then 10 settle
against the pool and 2 remain as a salary charge.

**A4** Given a probationer leaves before confirmation with 6 held days, when offboarding computes
the settlement, then 6 × day-rate is deducted from the final settlement.

**A5** Given 5 LATE days in a month and `latenessRuleEnabled`, then `chargedDays = 1`, taken from
the leave pool; the remaining 2 lates do not carry into the next month.

**A6** Given 3 LATE days and an empty pool, then `chargedToSalary = 1` and the payslip carries a
`lateness` deduction of one day-rate.

**A7** Given `latenessRuleEnabled = false` (the default), then no `LatenessCharge` is written and
payroll output is byte-identical to today.

**A8** Given an appointment letter issued with `salaryMode: paid`, when the PDF renders, then
clause 1 carries the salary and clause 2 (honorary) is **absent**, and clause 6 names the
person's designation — not "principal".

**A9** Given a letter issued in January, when the profile's address is edited in June and the same
letter is re-rendered, then the PDF is unchanged.

**A10** Given a caller with `staff:manage` but not `payroll:manage`, when they open the hub, then
the বেতন tab is absent and no query for it is fired.

**A11** Given a TEACHER, when they reach any staff-hub query for another person, then it is
refused — the hub adds no reach that `staff:manage` did not already carry.

---

## §7 — Out of scope (deliberate, owner-confirmed 2026-08-25)

- **Repeatable sub-tables** the Eximus form has — academic qualifications, employment history,
  trainings/courses, multiple bank accounts, custom fields. `qualification` and `bankAccount`
  stay single fields. Nothing in the letters, leave rules or payroll needs them.
- **Retroactive letters for existing staff.** The ~40 current staff have no letters; their
  কাগজপত্র tab starts empty. Issuing retroactively is a manual per-person action, not a migration.
- **Early-departure charges.** Only late ENTRY is counted (the owner's rule as given). The
  biometric sheet's out-punch is displayed but drives nothing.
- **Grace minutes.** `LATE` is read off the sheet's own 𝓛 symbol (AT-1) — the app does no
  arrival-time computation. `prd-hr.md` H3.3's grace model stays parked.

---

## §8 — Traceability

| Ask | Slice | Acceptance |
|---|---|---|
| Full details + activate + password, as one flow | SH-6 | A10, A11 |
| Appointment letter on a button | SH-1 | A8, A9 |
| Confirmation date + letter + extra text | SH-2 | A2 |
| Leave balance on the profile | SH-3, SH-5 | A1 |
| 3 lates = 1 day, leave then salary | SH-4 | A5, A6, A7 |
| Probation unpaid, permanent 20 days | SH-3 | A1, A2, A3, A4 |
| Leave + attendance display | SH-5, SH-6, SH-7 | A10 |
