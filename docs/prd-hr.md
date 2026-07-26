# PRD — HR / Staff-lifecycle module

**Status:** DRAFT (design LOCKED — `docs/hr-design.md`) · **Owner:** Principal
**Scope:** the HR module of SCD Hub — an **operational-plane** module (staff records → attendance &
leave → payroll → performance/conduct/development → offboarding). Pulled forward from
`docs/roadmap.md` "Deferred ops modules" into the active build. It is **ops software, not curriculum
governance** (repo scope boundary). All HR data sits behind the PII firewall (ADR-005); this module
adds **no** new corpus→identity path.

This PRD turns the locked design (`docs/hr-design.md`) into **per-role journeys with testable
acceptance criteria**, written Given/When/Then so they seed the NFR-11 suite directly (Jest+Supertest
for resolver/authz, Maestro e2e for golden paths, and the fail-closed firewall test). Traceability tags
point back to `docs/hr-design.md` (§n), `DECISIONS.md` (`D-#nn`), and the ADRs in `docs/architecture.md`.

> **Single source of truth:** the *design* lives in `docs/hr-design.md`; this file is the *build
> contract* (journeys + acceptance criteria + build order). When they disagree, the design wins — fix
> this file. Decisions D-#22–D-#29 are authoritative in `DECISIONS.md`.

---

## 1. Goal of this module
The school runs the full staff lifecycle inside SCD Hub: every employee is a record of system; leave
and attendance are tracked (attendance from the biometric terminal); a monthly payroll run computes net
pay, payslips and a payment-export file; performance/conduct/development and offboarding are workflows —
all **Principal/Office-only** for pay and personnel rows, with a bounded supervisor observation-write,
the corpus/identity firewall provably closed, and every sensitive action audit-logged.

## 2. Roles & scope (in this module)
**No new auth roles.** HR category (§2.2) is a `StaffProfile` field that drives defaults/reporting and is
free to extend; permissions stay on the small role set (`PRINCIPAL` / `TEACHER` / `OFFICE`), differences
expressed as **row-scope** (the D-#17 principle).

| Role | In this module | Primary jobs here |
|---|---|---|
| **Principal** | Full | Approve cover proposals, leave, payroll runs, advances; sign off appraisals; run the conduct ladder + grievance; authorise offboarding/final settlement. Sees all rows. |
| **Office** | Full (no sign-off) | Maintain `StaffProfile`s; manage attendance ingest + manual corrections; prepare payroll runs; manage leave balances; run clearance checklist. **Cannot** approve a payroll run or sign off appraisal/conduct (those are Principal). |
| **Teacher** | Self + bounded extras | Apply for leave (propose cover per class); self-view own attendance; **supervisors** (scope overlay) submit performance **observations within their extent** (D-#28). Never see salary/contract/conduct rows. |
| **Support staff** (guard/cleaner/cook/aya) | Record-only | `StaffProfile` + `biometric_id`, **no app login**; attendance-tracked (D-#25), leave-balanced (§3), attendance-driven pay. Reached via the terminal, not a login. |

**Access default (row-scope rule):** pay, contract, salary, payment-detail, conduct, grievance and
appraisal-outcome rows are **Principal/Office only**. A teacher — *including one with supervisory scope* —
never reads them. The subject sees **their own** record only (own attendance; own conduct/grievance).
Default-deny (ADR-004); the J5.6 firewall (NFR-11) is unaffected and must stay green.

---

## 3. Build-step → slice map (recommended build order)
Mirrors the app's slice approach; each ships its journeys' acceptance criteria as tests
(`/skills/feature-lifecycle`). Vocab/contract additions per step are listed in §9.

| Slice | Build-step | Journeys | Notes / dependency gate |
|---|---|---|---|
| **HR-1** | Staff records (§2 design) | **H1** | Foundation everything hangs off. No external dep. |
| **HR-2a** | Leave (§3 design) | **H2** | Reuses the proxy/cover system (D-#20/#22). Needs HR-1 + `AcademicYear`. |
| **HR-2b** | Attendance (§3a design) | **H3** | Contract buildable now (transport-agnostic); **live device sync gated on device model/SDK** (D-#24). Build internal record + manual/CSV transport first. |
| **HR-3** | Payroll (§4 design) | **H4** | Needs HR-1 (salary) + HR-2b (attendance deductions) + HR-2a (encashment). |
| **HR-4** | Performance / conduct / development (§5 design) | **H5** | Independent of payroll. Needs HR-1 + supervisory scope (D-#28). REF-11 rubric parked. |
| **HR-5** | Offboarding (§6 design — cross-cutting) | **H6** | Stitches records + leave + payroll + conduct. Needs HR-1..HR-4. |
| (cross-cut) | Access / identity / firewall | **H7** | Row-scope + audit + firewall assertions; verified in every slice above. |
| **HR-G1** | Self-service reads (gap; post-HR-5) | **H8** | **Built (D-#185).** Own-row `myPayslips` / `myStaffAttendance`; fail-closed phone-join; vocab-free; no new perm. |
| **HR-G2** | Staff directory (gap; post-HR-5) | **H8** | **Planned (D-#216/#217).** Unblocks the H5.2 observation picker + the chat staff-list. Server-only, vocab-free, no new perm; observable filter reverse-join is fail-closed. |

---

## 4. Journeys & acceptance criteria

### H1 — Staff records  *(design §2; build-step 1)*
- **H1.1 Create a `StaffProfile` for any employee** *(§2.1)* — Given Principal/Office, When they create a
  profile, Then it persists identity/bio, **HR category** (§2.2), **employment type** + **employment
  status** (separate fields, §2.4), join date, qualifications, contract terms, documents, emergency
  contact; salary structure + payment method/account + `biometric_id` are stored as **Principal/Office-only
  rows**. A profile is valid **with or without** a linked `User`.
- **H1.2 Login is optional and linked, not embedded** *(§2.1, §2.3)* — Given a profile, When the person
  needs app access, Then a `User` (auth identity) is linked to it; support staff get a profile with **no
  `User`**. `User` stays the auth identity; `StaffProfile` holds HR data.
- **H1.3 HR category → auth role mapping, no new roles** *(§2.3, D-#17)* — Given any HR category, When a
  login is created, Then the auth role is one of `PRINCIPAL`/`TEACHER`/`OFFICE` per the §2.3 table
  (assistant/Hifz = `TEACHER`, reach via scope grants); **creating a profile never mints a new role**.
- **H1.4 Salary / payment / contract rows are Principal/Office-only** *(§2.1, §4.7, ADR-004)* — Given a
  Teacher (incl. supervisory scope), When they query a profile, Then salary structure, payment
  method/account and contract terms are **not returned** (default-deny row-scope); the subject sees their
  own non-pay fields only.
- **H1.5 `biometric_id` is the attendance mapping key** *(§2.1, §3a.2)* — Given a profile, When a
  `biometric_id` is set (once per person), Then an imported punch carrying that device staff-number
  attaches to this profile; **no mapping → no attachment** (H3.4).
- **H1.6 Employment type scales defaults; status drives lifecycle** *(§2.4)* — Given `type`
  (full/part/fixed-term), Then leave entitlement and pay pro-rate off it; Given `status`
  (probation→confirmed→resigned/terminated), Then it gates eligibility and feeds offboarding (H6). The two
  are independent fields.

### H2 — Leave management  *(design §3; build-step 2, leave half)*
- **H2.1 Entitlements / balances, granted per academic year** *(§3.1)* — Given a staff member, When the
  **academic year** starts (reads `AcademicYear`, not calendar year), Then the annual allowance is granted;
  the system tracks **balance** (allowance / taken / remaining), per-role defaults with a **per-staff
  override**, **pro-rated** for mid-year joiners.
- **H2.2 Leave types behave per the §3.2 table** *(§3.2, D-#23)* — Casual/Sick/Bereavement = paid,
  balance, **uncapped carryover**, encashable; **Maternity = unpaid**, event-triggered, capped per event,
  no carry/encash (**D-#23, legal check pending — H7.5**); **Hajj = unpaid**, event-triggered, capped;
  **Unpaid (LWP) = no balance**, the overflow bucket.
- **H2.3 Exceed rule warns, never hard-blocks** *(§3.3)* — Given an application beyond allowance, Then the
  system **warns**; Principal/Office may still approve the extra days as **unpaid (LWP)**. No hard block.
- **H2.4 Carryover + two encashment paths** *(§3.4)* — paid types carry over with **no cap**;
  **(a) voluntary in-service** cash-out requests draw **carried-over (prior-year) balance only** (current-
  year allowance not cashable in-service); **(b) mandatory at exit** pays the **full** carried balance
  automatically in final settlement (H6.4). The **running cash value** of accrued encashable days is
  surfaced as a budget-visible number each year.
- **H2.5 Leave → cover fan-out (the proxy seam)** *(§3.5, D-#20/#22)* — Given a leave (parent record:
  applicant, `start_date` + N days, reason, status), When it covers several classes, Then it **fans out one
  cover slot per class/section** the absent teacher teaches in that window; **each slot independently names
  a covering teacher**. Each *filled* slot maps 1:1 to a **D-#20 proxy grant** (`covered_class`,
  `covering_teacher`, `start_date`, `duration_days`) — N classes → N grants, grant model unchanged.
- **H2.6 Cover is proposed, activates only on admin approval** *(§3.5, **D-#22**)* — Given the teacher
  proposes a covering teacher per class (or leaves a slot empty), When **Principal/Office approve**, Then
  the proxy grant takes effect (write access begins); **a teacher's proposal alone never grants write
  access**. Empty/emergency slots surface as "needs cover" for admin to fill. Assign/approve/reject is
  audit-logged.
- **H2.7 Leave visibility** *(§3, §1)* — Given a logged-in staff member, Then they see **their own** leave
  + balances; Principal/Office see and manage all.
- **H2.8 Partial-day leave — late entry / early leave** *(**D-#361**, owner ask; extends H2.5/H2.6)* —
  Given a teacher who will miss only the **first few** or the **last few** periods of a day, When they apply
  with `dayPart` = `late_entry` | `early_leave` plus a **period count**, Then:
  - the application is **single-date** (`fromKey === toKey`) — a multi-day partial is rejected; a longer
    absence is either a full-day leave or one partial application per day;
  - the **missed period numbers are resolved at apply time and stored** — `late_entry` takes periods
    `1..n`; `early_leave` takes the last `n` periods of **that staff member's own teaching day** (their last
    routine period, falling back to the longest active `PeriodGrid`), because a nursery/KG day is 6 periods
    and a class 1–5 day is 8 (D-#57);
  - **cover fans out for those periods only** — the classes the teacher still teaches that day raise **no**
    cover slot; proposal → Principal/Office approval → one-day proxy grant is unchanged (H2.6);
  - a teacher on a partial day **may still cover** another absence in a period outside their own window
    (the cover pickers and the double-book guard are period-scoped, not day-scoped);
  - **balance cost is a flat one third of a day** — **three partial-day leaves = one day** (owner ruling),
    whatever the period count. Balances, the paid/unpaid split and payroll's unpaid-leave deduction are
    therefore fractional and round to 2dp only where they are displayed;
  - a partial day **does not** flip a biometric ✘ to LEAVE (H3's overlay) — the staff member was at school
    that day, so a whole-day absence against a partial leave stays a real ABSENT worth investigating.

### H3 — Staff attendance  *(design §3a; build-step 2, attendance half)*
- **H3.1 Biometric terminal is the source of truth; all staff enrolled** *(§3a.1, **D-#25**)* — Given any
  employee **including support**, Then they have a `biometric_id` and punch like everyone else; the record
  is **per-staff, per-day**. Support pay becomes attendance-driven and support joins the §3 leave-balance
  system. Support have **no login** (records-only on the auth side).
- **H3.2 Internal record is the source of truth and transport-agnostic** *(§3a.2, **D-#24**)* — Given
  punches, When they arrive via **periodic auto-sync**, **manual on-demand pull**, **or a CSV/file
  fallback**, Then they land in the same internal attendance record; the contract is buildable now and the
  **live device sync bolts on later without redesign**. SCD Hub is a **consumer** — it never manages the
  device. *(Live sync is **device model/SDK-gated** — H7.6.)*
- **H3.3 Statuses + lateness + early departure are computed** *(§3a.3)* — statuses
  `present`/`absent`/`late`/`half-day`/`on-leave`; **first punch = in, last punch = out**; **late** =
  arrival > (start + grace), stored as the `late` status **and** late-minutes; early departure computable
  from the out-punch. Attendance only **captures** these minutes — the **pay consequence is a payroll
  decision** (H4.3 / D-#26).
- **H3.4 Punch maps via `biometric_id` or does not attach** *(§3a.2)* — Given a punch with a device
  staff-number, When it matches a `StaffProfile.biometric_id`, Then it attaches; **no match → no
  attachment** (surfaced for office to resolve).
- **H3.5 Schedule model: base + per-person + dated overrides + working-days** *(§3a.4)* — one school-wide
  base start/end for all, **per-person exceptions** on `StaffProfile`, **dated overrides** (e.g. Ramadan)
  so special days are not a yearly hand-edit, and a **working-days calendar** (weekly holiday Friday + any
  closed Saturday + school holidays) so a non-working day never reads as "absent."
- **H3.6 Manual entry is audit-logged + source-tagged** *(§3a.5, ADR-008)* — Given Office corrects a missed
  punch, Then the entry is **audit-logged (who/when)** and **tagged `source: manual` vs `source: device`**;
  a human override is never indistinguishable from a real punch.
- **H3.7 No-punch reconciliation order** *(§3a.5)* — Given a no-punch day, When approved leave exists →
  `on-leave`; otherwise the day sits **unresolved** for office to either correct (missed punch → `present`,
  with reason) or confirm `absent`.
- **H3.8 Attendance visibility** *(§3a.6)* — Principal/Office see + manage all; a **logged-in** staff member
  sees only **their own**; support (no login) don't self-view.

### H4 — Payroll  *(design §4; build-step 3)*
- **H4.1 Single consolidated monthly salary; day-rate derived** *(§4.1)* — pay is **one monthly figure**
  per person (no basic/allowance split) on `StaffProfile` (Principal/Office-only); **day-rate = monthly ÷
  that month's working days** (default; flat ÷30 the alternative). Applies to **all staff incl. support**
  (attendance-driven, D-#25).
- **H4.2 Monthly run: Office prepares → Principal approves → locks** *(§4.2)* — **Net = consolidated gross −
  deductions + additions**, per staff per month. Given Office prepares a run, When **Principal approves**,
  Then the run **locks (immutable)** and is audit-logged; **payslips + payment export issue only from a
  locked run**. Mid-month joiners/leavers + part-timers pro-rated on the day-rate.
- **H4.3 Deductions** *(§4.3, **D-#26**)* — **unpaid leave (LWP)/unauthorised absence = day-rate × days
  (the only always-on attendance-driven deduction)**; advance/loan repayment (H4.5); **statutory =
  placeholder, confirm with accountant** (not hard-coded, no tax advice); **lateness/early-departure = no
  deduction by default**, recorded + handled as conduct (H5.2), with an **optional Principal-configurable
  deduction rule** that can be switched on (parameters parked).
- **H4.4 Additions** *(§4.4)* — Eid/festival bonus (policy figure or salary multiple; parked); arrears
  (back-pay/corrections); **leave-encashment payout** (the H2.4 in-service cash-out + the exit settlement)
  surface here, the accruing carryover liability shown as a real line.
- **H4.5 Advances / loans — *qard hasan*** *(§4.5, **D-#27**)* — one Advance/Loan record per staff (amount,
  issue date, recovery mode, schedule, running balance, status); recovery **one-shot or installments**;
  **interest-free *and* fee-free**; **net-pay guard** (a repayment never pushes net negative — excess caps
  and rolls forward); Principal-approved + audit-logged; early settlement allowed; **at exit, outstanding
  netted** against final settlement (H6.4).
- **H4.6 Disbursement: compute + payslips + payment export** *(§4.6)* — the app **computes/records** the run
  and issues **payslips** (itemised; Bangla labels + English codes, NFR-5); it produces a **payment export**
  (net pay per staff) for bank/bKash bulk upload — **actual payment is external** (no live payment API this
  phase). Format is **target-specific** (parked): a clean internal disbursement record maps to the target
  once confirmed (no redesign). Payment details live on `StaffProfile` (Principal/Office-only);
  **cash-paid staff are flagged and excluded** from the file.
- **H4.7 Payroll sensitivity** *(§4.7)* — **Principal/Office only**, every run audit-logged, **never** the
  corpus plane (H7).

### H5 — Performance, conduct & development  *(design §5; build-step 4)*
- **H5.1 Observations roll up into an annual appraisal** *(§5.1, **D-#28**)* — an **observation** is an
  event (observer, date, class/subject, **REF-11 rubric** scores + notes, follow-up); an **appraisal** is
  per staff per **cycle = annual, aligned to the academic year**, gathering the cycle's observations + goals
  + an overall outcome and **emitting development needs** (→ H5.4).
- **H5.2 Bounded supervisor observation-write; Principal signs off** *(§5.1, **D-#28**, D-#17)* — Given a
  supervisor (Class Teacher / Coordinator / Subject Lead), When they observe **within their existing
  supervisory extent**, Then they may **submit observations** (a bounded write inside a pre-existing scope —
  no new role); the **appraisal sign-off / outcome is Principal-only**; a supervisor sees **only their own
  observations** — not the outcome, others' inputs, or any conduct record.
- **H5.3 Conduct ladder enforces order, with due process** *(§5.2)* — a **defined escalating ladder**
  (stages configurable; default verbal → written → final → termination) **enforces order**; each step
  records staff/date/issue+category/stage/evidence + the person's **response/hearing captured _before_ the
  step is finalised** (*'adl*, not optional)/issuer/outcome; a **gross-misconduct fast-track** may jump to
  final/termination; **warnings lapse** (a `live-until` date — on lapse it stops counting toward escalation
  but **stays on file as history**, never deleted; lapse period parked, per-stage); the **termination step
  writes status → terminated and triggers offboarding** (H6).
- **H5.4 Grievance + development** *(§5.2–§5.3)* — **grievance** is a **staff-raised confidential** channel
  routed to the Principal, tracked + audited (same confidentiality, opposite direction to disciplinary);
  **development** is a per-staff CPD log (activity/date/outcome) **fed by the appraisal's development needs**
  (H5.1), so review and growth are linked.
- **H5.5 Confidentiality (*satr*) + sensitivity** *(§5.2, §5.4)* — conduct/grievance/appraisal-outcome are
  **Principal/Office + the subject (own record only)**; **supervisors never see conduct**; fully
  audit-logged; never the corpus plane (H7).

### H6 — Offboarding  *(design §6; cross-cutting workflow)*
- **H6.1 Triggers set employment status** *(§6, §2.4)* — resignation (notice → last working day),
  termination (from H5.3), fixed-term end, retirement — each sets `StaffProfile.status`.
- **H6.2 Clearance checklist (configurable)** *(§6)* — asset return (keys/devices/books), handover
  (classes, trackers, materials), confirm no pending dues. List items parked.
- **H6.3 Access revoked on the last working day — by the system** *(§6)* — Given the last working day, When
  it arrives, Then the **system** disables the `User` login and **revokes all scope grants** (teaching /
  supervisory / proxy), audit-logged; **not left manual** (the security-sensitive step).
- **H6.4 Final settlement hard-held until clearance** *(§6, **D-#29**)* — Given an exit, Then a final pay
  run computes salary pro-rated to last day + arrears + **full leave encashment** (H2.4) − **outstanding
  advance** (H4.5); the settlement is **hard-held — no deadline — until clearance (H6.2) is complete**
  (assets returned + handover done). *(Knowing trade-off against prompt-wages; statutory final-dues timeline
  to confirm — H7.7.)*
- **H6.5 Profile retained, never deleted** *(§6)* — `StaffProfile` is kept (status =
  resigned/terminated), history + audit retained, confidentiality continues; plus a **service/experience
  certificate** + optional **exit interview** (reason, feedback).

### H7 — Access, identity, firewall & audit  *(cross-cutting; design §1; NFR-11)*
- **H7.1 Pay/personnel rows are Principal/Office-only** *(§1, §2.1, ADR-004)* — covered by H1.4 + H4.7 +
  H5.5; the resolver default-denies these rows to TEACHER (incl. supervisory).
- **H7.2 Subject self-view only** *(§3a.6, §5.4)* — a logged-in staff member reads their own attendance,
  leave, conduct/grievance — not anyone else's, and not pay/contract rows of their own beyond what §2.1
  allows.
- **H7.3 Supervisor write is bounded, read stays narrow** *(D-#28)* — a supervisor's only HR write is the
  observation (H5.2) inside their extent; they gain **no** read of salary/conduct/outcome.
- **H7.4 Fail-closed firewall stays green** *(ADR-005, NFR-11, J5.6)* — **no HR analytics/export resolver
  may join HR data to the corpus plane**; the existing fail-closed firewall test must keep passing after
  HR lands. HR adds **no** new corpus→identity path. ← non-negotiable.
- **H7.5 Maternity legal position verified before lock** *(D-#23)* — **open**: confirm BLA §46 / 2012 MoE
  decree coverage vs the §1(4) basis with a legal adviser before the maternity rule finally locks; keep the
  reasoning on file beside the D-#23 row.
- **H7.6 Biometric device model/SDK on the critical path** *(D-#24)* — **open**: the live-sync transport
  cannot be built until the device model/SDK is supplied; until then the internal record + manual/CSV
  transport is the build (H3.2).
- **H7.7 Statutory confirmations** — **open**: statutory payroll deductions (with accountant, §4.3) and any
  Bangladesh statutory final-dues timeline (vs D-#29, §6) confirmed before those parts lock.
- **H7.8 Every sensitive HR action audit-logged** *(ADR-008)* — manual attendance edits, leave/cover
  approvals, payroll lock, advance approval, conduct steps, grievance, access revocation and final
  settlement all ride the append-only audit log.

### H8 — Self-service reads & staff directory  *(gap slices; post-HR-5, NOT in the original build-step map)*
Two server gaps surfaced when the HR app shipped (PR-1) and are tracked as **HR-G** slices. Both are
identity-plane, vocab-free, and add **no** new permission (D-#17/#94).
- **H8.1 Own-row self-service reads** *(HR-G1, built — **D-#185**)* — `myPayslips` (the caller's own
  payslips, `approved_locked` runs only, §4.2) + `myStaffAttendance` (own attendance over a range, reusing
  the H3 ✘→LEAVE overlay). Both resolve the caller's `StaffProfile` via the **fail-closed phone-join**
  (`resolveStaffProfileForUser`, D-#103/#185); no linked profile ⇒ `[]`, never another person's data.
- **H8.2 General staff directory** *(HR-G2, planned — **D-#216**)* — *Why:* the **H5.2 supervisor
  observation-submit** (`submitObservation`) needs a `staffProfileId`, but every `StaffProfile` read is
  `staff:manage` (Principal/Office) — so the HR app cannot render the observation picker, and the chat module
  (M-5) already had to *derive* a staff list from SCHOOL-group memberships for the same reason. Fix:
  `staffDirectory(observableOnly: Boolean = false)` → a dedicated **`StaffDirectoryEntry { id, name, nameBn,
  designation, category }`** — a distinct read shape that **structurally omits** every H1.4 sensitive row
  (NID/bank/salary/paymentMethod) and all personal bio/contact (dob, parents, spouse, addresses, personal
  phone), the CT-3 `GuardianClassTestResult` precedent (a separate type that *cannot* leak). Gate =
  `authenticated: true`, **GUARDIAN rejected in-resolver** (staff-internal; guardians are a walled login
  plane, ADR-005). **No new permission** — the staff analog of the student roster: scoped staff *read* the
  roster while *acting* is scope-gated; reading "who works here, by name + role" is discovery, the
  *capability* (`submitObservation`) stays scope-gated. One directory serves both the H5.2 picker and the
  chat staff-list.
- **H8.3 Observable filter** *(HR-G2 — **D-#217**)* — `observableOnly: true` returns only the staff the
  caller may observe: the teachers assigned to a `(class, subject)` cell covered by the caller's
  **supervisory** `ScopeGrant` extent (`composeTeacherScope` → `supervisoryCovers`, the H5.2 authority);
  Principal/Office (`performance:manage`/`staff:manage`) get everyone. **Reverse-join (build risk, flagged):**
  resolve `(class, subject, teacherUserId)` [confirm the assignment source against live code at build —
  likely `RoutineSlot.teacherId`, **not** the teaching `ScopeGrant` extent which is "may teach" not "is
  assigned"] ∩ the caller's supervisory extent, then `teacherUserId → StaffProfile` via the **fail-closed
  phone-join** (D-#103/#185): a staff member who doesn't resolve (shared phone) is **excluded from the
  observable subset but still appears in the general list** — no masquerade, no wrong person.
- **H8.4 App rider (later)** — a small app slice renders the picker over `staffDirectory(observableOnly:
  true)` + the existing `submitObservation`. Server-only HR-G2 ships first.
- **H8.5 Firewall + audit** — the directory is on the identity-plane `StaffProfile`; **no corpus path**; the
  new resolver/shape import nothing from corpus — the NFR-11 fail-closed test stays green (H7.4). A directory
  read is non-mutating, so no new audit kind.
- **Noted, out of this slice:** `submitObservation` validates the `(class, subject)` extent but **not** that
  `staffProfileId` actually teaches it (`performance.ts`) — the picker offers only valid staff, but the
  server doesn't *enforce* `staffProfileId ∈ extent`. Optional later hardening; not folded in.
- **Acceptance:** [ ] general list returns name+role only — no sensitive/bio field reachable; [ ] GUARDIAN
  denied; [ ] `observableOnly:true` returns only the caller's supervisory-covered teachers, fail-closed on
  the phone join; [ ] Principal/Office get all; [ ] firewall green; [ ] no new permission.

---

## 5. Golden-path e2e (NFR-11) — what Maestro/Supertest must cover
1. **Hire → record:** create a `StaffProfile` (+ optional `User`), salary row invisible to a teacher (H1.1,
   H1.4).
2. **Leave → cover:** apply leave → fan-out cover slots → admin approves → proxy grant active on the covered
   class only (H2.5, H2.6, reuses the existing J5.7 proxy lifecycle).
3. **Attendance → payroll:** ingest punches (CSV transport) → reconcile a no-punch day → run payroll with an
   unpaid-leave deduction → Principal approves → run locks → payslip + payment export (H3.2/H3.7, H4.2/H4.6).
4. **Conduct:** ladder enforces order with a hearing recorded before finalisation; supervisor cannot read it
   (H5.3, H5.5/H7.3).
5. **Offboarding:** termination → status → access revoked on last day → final settlement hard-held until
   clearance (H6.3, H6.4).
6. **Firewall:** the corpus/analytics path cannot join any HR row to identity — **fail-closed** (H7.4, J5.6).

Dense-logic unit/integration targets (NFR-11): leave balance/pro-ration/encashment math (H2.1/H2.4);
cover fan-out → N proxy grants (H2.5); attendance lateness/early-departure + working-days reconciliation
(H3.3/H3.5/H3.7); **payroll net = gross − deductions + additions** incl. net-pay guard (H4.2/H4.3/H4.5);
conduct ladder order + warning lapse (H5.3); **HR row-scope authz + fail-closed firewall** (H7.1/H7.4);
offboarding access-revocation + settlement hold (H6.3/H6.4).

## 6. Out of scope (this module)
- **Live payment API** — payment export only; actual payment external (§4.6).
- **Device management** — SCD Hub is a consumer, never manages the terminal (§3a.2).
- **Curriculum-owned artefacts** — the **REF-11 observation rubric** is authored in the curriculum Projects
  and only *consumed* here (scope boundary, §5.1).
- **Tax advice / statutory hard-coding** — statutory deductions are a confirmed-with-accountant placeholder
  (§4.3); no rates baked in.
- Other deferred ops modules (comms, notices, fees, expenses, routine, exam/results, library/asset register)
  remain in `docs/roadmap.md`.

---

## 7. New entities (shape sketch — not the contract)
Model these on the operational/identity plane (alongside foundation models), behind the firewall.
Final field lists come from `docs/hr-design.md`; this is the inventory.
- `StaffProfile` (master record; salary/payment/contract rows Principal/Office-only; `biometric_id`;
  per-person schedule + leave overrides) — §2.1.
- `LeaveEntitlement` / `LeaveBalance` (per staff per academic year) + `LeaveApplication` (parent) +
  `CoverSlot` (fans out → existing proxy `ScopeGrant`) — §3.
- `AttendanceRecord` (per staff per day; status + late-minutes + `source: manual|device`) +
  `Schedule`/`ScheduleOverride` + `WorkingDaysCalendar` — §3a.
- `PayrollRun` (monthly; prepared → approved/locked) + `Payslip` + `PaymentExport` line; `AdvanceLoan`
  (per staff; running balance) — §4.
- `Observation` + `Appraisal` (annual cycle) + `ConductRecord` (ladder stage + hearing) + `Grievance` +
  `DevelopmentLog` — §5.
- `OffboardingCase` (triggers → clearance checklist → settlement hold → retention) — §6.
- `StaffDirectoryEntry` (**read-only projection over `StaffProfile`** — `{id, name, nameBn, designation,
  category}`; no new model, no sensitive/bio field; HR-G2 §H8) — D-#216.

## 8. Reused / unchanged
- **Proxy/cover `ScopeGrant`** (D-#20) is reused **as-is** — a filled cover slot becomes one grant; no
  model change (H2.5). D-#22 adds the *propose → approve* gate around it.
- **Append-only audit log** (ADR-008) carries every sensitive HR action (H7.8).
- **`AcademicYear`** drives the leave grant + appraisal cycle (H2.1, H5.1).
- **RBAC role set + resolver authz** (ADR-004/017) — HR adds row-scope, **no new role** (H1.3).
- **PII firewall** (ADR-005) — HR is identity-plane only; no new corpus path (H7.4).

## 9. Contract / vocab additions (run `/skills/contract-sync` when these land)
HR adds controlled vocab that must sync across schema ⇄ `/shared/vocab.ts` ⇄ harness (the two-place rule).
Build these per slice, not all at once:
- **HR-1:** `HR_CATEGORY` (teacher / assistant-Hifz / office-accounts / support), `EMPLOYMENT_TYPE`
  (full-time / part-time / fixed-term), `EMPLOYMENT_STATUS` (probation / confirmed / resigned / terminated)
  — + `*_LABELS_BN` (NFR-5).
- **HR-2:** `LEAVE_TYPE` (casual / sick / bereavement / maternity / hajj / unpaid-LWP), `LEAVE_STATUS`
  (applied / approved / rejected / cancelled), `COVER_SLOT_STATUS` (proposed / approved / needs-cover).
- **HR-2b:** `ATTENDANCE_STATUS` (present / absent / late / half-day / on-leave), `PUNCH_SOURCE`
  (device / manual).
- **HR-3:** `PAYROLL_RUN_STATUS` (prepared / approved-locked), `ADVANCE_STATUS`,
  `PAY_DEDUCTION_TYPE` / `PAY_ADDITION_TYPE`, `PAYMENT_METHOD` (bank / bKash / cash).
- **HR-4:** `CONDUCT_STAGE` (verbal / written / final / termination), `OBSERVATION`/`APPRAISAL_OUTCOME`
  vocab, `GRIEVANCE_STATUS`.
- **HR-5:** `OFFBOARDING_TRIGGER` (resignation / termination / fixed-term-end / retirement),
  `CLEARANCE_ITEM_STATUS`.
Each addition: edit the schema **and** `/shared/vocab.ts` **and** the harness, then run the verifiers
(`/skills/contract-sync`, `/shared/AGENTS.md`).

## 10. Dependencies / open items (parked — shapes locked, values/confirmations pending)
- **Maternity legal verification** (D-#23 / H7.5) — the one item carrying real risk; verify before that
  rule locks.
- **Biometric device model/SDK** (D-#24 / H7.6) — prerequisite for the live-sync transport.
- **Parked numbers/specs:** leave entitlement amounts per role + Hajj reset policy (§3.1); attendance
  start/end times + grace minutes (§3a); Eid/festival bonus policy + day-rate basis confirm (§4.1/§4.4);
  **statutory deductions** (with accountant, §4.3); **payment-export target format** (§4.6); warning **lapse
  period** per stage + appraisal cadence if not annual (§5); **REF-11 rubric** availability from curriculum
  Projects (§5.1); offboarding **clearance-list items** + notice periods (§6).
