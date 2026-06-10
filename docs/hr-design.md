# HR Module — Design Handoff

**Status:** DESIGN · all build-steps + offboarding **LOCKED**; **D-#22–D-#29 ruled by Principal** · **Owner:** Principal
**Scope:** the HR (staff lifecycle) module of SCD Hub — an **operational-plane** module. It is ops software,
not curriculum governance (consistent with the repo scope boundary). All HR data sits behind the PII
firewall (ADR-005); this module adds **no** new corpus→identity path.

> **Note for the build:** This module overlaps `docs/roadmap.md` — "Deferred ops modules" (payroll, leave,
> attendance). Pulling HR forward into the active build is a STATUS/roadmap call, not a change of direction —
> record it when STATUS is updated.

---

## 0. Summary & checklist (read this first)

**What this module is:** the system of record for every employee, plus the staff-lifecycle workflows
(records → attendance & leave → payroll → performance/conduct/development).

**Build order (mirrors the app's slice approach):**
1. **Staff records** — the foundation everything hangs off. *(designed — §2)*
2. **Attendance & leave** — leave is the seam to the existing proxy/cover system. *(designed — leave §3, attendance §3a)*
3. **Payroll** — needs records (salary) + attendance (deductions). *(designed — §4)*
4. **Performance, conduct & development** — independent of payroll. *(designed — §5)*

**Locked checklist:**
- [x] `StaffProfile` = master record for **every** employee; `User` login optional (§2.1)
- [x] HR categories (teacher, assistant/Hifz, office/accounts, support); no driver (§2.2)
- [x] HR-category → auth-role mapping (small role set preserved; reach via scope grants) (§2.3)
- [x] Employment **type** (scales leave/pay) vs employment **status** (lifecycle) kept separate (§2.4)
- [x] Leave: entitlements/balances model, types, carryover, two encashment paths, exceed rule (§3)
- [x] Cover/proxy fan-out: leave → one proxy slot per class, each can name a different teacher (§3.5)
- [x] Attendance: biometric terminal = source of truth; **all staff incl. support enrolled** (D-#25) (§3a.1)
- [x] Ingest via live device sync (periodic auto + manual pull); transport-agnostic; `biometric_id` is the mapping key (§3a.2)
- [x] Tracks lateness + early departure; pay consequence deferred to payroll (§3a.3)
- [x] Schedule = base start/end for all + per-person exceptions + dated (Ramadan) overrides + working-days calendar (§3a.4)
- [x] Manual missed-punch entry: audit-logged + source-tagged; no-punch reconciliation order (§3a.5)
- [x] Payroll: single consolidated monthly salary; day-rate = monthly ÷ working days; net = gross − deductions + additions (§4.1–4.2)
- [x] Only attendance-driven deduction = unpaid leave/absence; lateness = no deduction by default, optional Principal-configurable rule (D-#26) (§4.3)
- [x] Advances/loans: interest- & fee-free, one-shot or installments, net-pay guard, exit-netted (§4.5)
- [x] Disbursement: app computes + payslips + payment export; payment external; payment details on `StaffProfile` (§4.6)
- [x] Performance: observations (REF-11) → annual appraisal; supervisors observe (D-#28), Principal signs off (§5.1)
- [x] Conduct: defined escalating ladder, due-process hearing per step, gross-misconduct fast-track, lapsing warnings (§5.2)
- [x] Grievance: confidential staff-raised channel to Principal; Development: CPD log fed by appraisal needs (§5.2–5.3)
- [x] Offboarding: triggers → status; clearance checklist; access revoked on last day; final settlement **hard-held until clearance** (D-#29); profile retained (§6)
- [x] Eight decisions to append to `DECISIONS.md`: **D-#22–D-#29** (§8)

**Open / next (not yet designed):**
- [ ] **Verify maternity legal position** before final lock (see D-#23, §8)
- [ ] **Parked numbers / specs:** leave entitlement amounts per role + Hajj reset policy (§3.1); attendance start/end times + grace minutes (§3a); **biometric device model/SDK** (§3a.2); Eid/festival bonus policy + day-rate basis confirm (§4.1, §4.4); **statutory deductions** to confirm with accountant (§4.3); **payment export target format** (§4.6); warning **lapse period** per stage + appraisal cadence if not annual (§5.2, §5.1); **REF-11 rubric** availability from curriculum Projects (§5.1)

**Design principles (Islamic alignment):** clear, unambiguous contract terms (no *gharar*); wages paid
**promptly and in full** (build payroll so dues are never delayed); **confidentiality of staff records**
(*satr* — don't expose a person's faults) enforced structurally via RBAC row-scope + the audit log.

---

## 1. Where HR sits in the architecture

- **Plane:** operational/identity plane (alongside students/guardians/users, rosters, trackers).
  HR is the **most sensitive identity-bearing** data in the system (salaries, contracts, conduct notes).
- **Firewall:** no analytics/export resolver may join HR data to the corpus plane. The fail-closed
  firewall test (J5.6, NFR-11) must keep passing after this module lands.
- **Access default:** pay and personnel rows are **Principal/Office only**. Teachers — including those
  with supervisory scope — never see salary, contract, or disciplinary rows. This is a row-scope rule on
  the new entity, consistent with default-deny RBAC (ADR-004).

---

## 2. Build-step 1 — Staff records (LOCKED)

### 2.1 `StaffProfile` — the master record
- `StaffProfile` is the **system of record for every employee**, whether or not they use the app.
- A `User` (login/auth identity) is **optional** and links to the profile **only when the person needs
  app access**. `User` stays the auth identity; `StaffProfile` holds the HR data.
  - Teachers, assistant/Hifz teachers, office → profile **+** login.
  - Support staff (guard/cleaner/cook/aya) → profile, **no login**.
- **Fields (baseline):** identity/bio; **HR category**; **employment type**; **employment status**;
  join date; qualifications; contract terms; documents; emergency contact; **salary structure**
  (Principal/Office-only row); **`biometric_id`** — the staff number used by the attendance device/software;
  set once per person; maps an imported punch to this profile (the linchpin of §3a, attendance ingest);
  **payment method + account/number** (bank / bKash / cash) for the payroll disbursement export (§4.6),
  Principal/Office-only.
- Plane: operational; behind the PII firewall; no new corpus path.

### 2.2 HR categories employed (the real list)
`teacher` · `assistant / Hifz teacher` · `office / accounts` · `support (guard, cleaner, cook, aya)`.
**No driver.** HR category lives on `StaffProfile`; it drives leave defaults, pay defaults, and reporting,
and is **free to extend** (adding a category has no permission cost).

### 2.3 HR category → app auth role (keep the role set small)
HR category and auth role are **separate concerns**. Auth role drives permissions and stays small
(`PRINCIPAL` / `TEACHER` / `OFFICE`); differences between job titles are expressed as **row-scope**, not
new roles (the D-#17 principle — "same permission set, wider/narrower scope").

| HR category | App login? | Auth role |
|---|---|---|
| Principal / head | Yes | `PRINCIPAL` |
| Teacher | Yes | `TEACHER` |
| Assistant / Hifz teacher | Yes | `TEACHER` (reach set by their scope grants, **not** a new role) |
| Office / Accounts | Yes | `OFFICE` |
| Support (guard, cleaner, cook, aya) | **No** | none — HR profile only |

> **Flag (RBAC discipline):** if an assistant/Hifz teacher "shouldn't do everything a teacher can," the
> lever is their **scope grant** (which classes/sections), not a new role. A genuinely forbidden *action*
> (e.g. "assistants never assemble sets") is a real exception to design explicitly — never a new role.
> Minting roles per title reopens the RBAC churn the architecture was built to avoid (ADR-004/017).

### 2.4 Employment type vs employment status (separate fields)
- **Employment type** — `full-time` / `part-time` / `fixed-term (contract)`. **Scales** leave and pay
  (a part-timer's allowance and salary are pro-rated off this). Lives on the profile; feeds the defaults.
- **Employment status** — `probation → confirmed → resigned / terminated`. A **lifecycle** field, not a
  type. Drives eligibility and feeds offboarding.
- Keeping these apart from the start avoids a messy migration when offboarding is built.

> **Carried-forward interaction:** status meets the leave rules — probation/short-service is exactly where
> pro-ration and the maternity six-month-service condition bite. Wire this when entitlements are drawn.

---

## 3. Build-step 2 (leave half) — Leave management (LOCKED)

> Attendance is the **other half** of this step and is **not yet designed**.

### 3.1 Entitlements / balances model
- The system tracks **balances** (allowance, days taken, remaining) — not just a running log.
- Entitlements attach **per role**, with a **per-staff override** for exceptions.
- **Pro-rated** for mid-year joiners.
- The annual allowance is **granted at the start of the academic year** (reads `AcademicYear`, not the
  calendar year).
- *(Open, for when numbers are set: decide whether **Hajj** resets yearly or is a once-in-service grant.)*

### 3.2 Leave types
| Type | Paid? | Balance? | Carryover | Notes |
|---|---|---|---|---|
| Casual | Paid | Yes | Uncapped | carries over, encashable (§3.4) |
| Sick | Paid | Yes | Uncapped | carries over, encashable (§3.4) |
| Bereavement | Paid | Yes | Uncapped | carries over, encashable (§3.4) |
| **Maternity** | **Unpaid** | Event-triggered, **capped per event** | n/a | not an annual quota; nothing to carry/encash. **See D-#23 + legal flag.** |
| **Hajj** | **Unpaid** | Event-triggered, **capped per event** | n/a | discretionary; no statutory pay requirement |
| Unpaid (LWP) | Unpaid | No balance | n/a | the **overflow bucket** (see §3.3) |

### 3.3 Exceed rule
On exceeding an allowance the system **warns** — it does **not** hard-block. Principal/Office may still
approve the extra days as **unpaid (LWP)**. (A hard block tends to push staff to under-report real absence.)

### 3.4 Carryover & encashment
- **Carryover:** all paid types carry over with **no cap**.
- **Encashment — two paths:**
  - **Voluntary, in-service:** an employee may *request* to cash out — **carried-over (prior-year)
    balance only**. (Current-year allowance is not cashable in-service, so the incentive never becomes
    "skip the leave, take the money.")
  - **Mandatory, at exit:** the **full** carried balance is paid out automatically in final settlement
    (no request needed).

> **Flag (budget liability):** uncapped carryover + encashable = an **accruing, open-ended salary
> liability**. Chosen knowingly. Mitigation in the design: in-service cash-outs *bleed* the liability;
> surface the **running cash value** of accrued encashable days as a number the budget sees each year so a
> departure never surprises you.

### 3.5 Cover / proxy fan-out (the seam to the existing proxy system)
- A **leave** is the **parent record**: applicant, `start_date` + `N` days, reason, status.
- Because an absent teacher covers several classes, the leave **fans out into one cover slot per
  class/section** they teach in that window — and **each slot can name a different covering teacher**.
- Each *filled* slot becomes a **proxy grant exactly as D-#20 already defines it**
  (`covered_class`, `covering_teacher`, `start_date`, `duration_days`). The grant model is unchanged —
  it is already per-class, so N classes → N grants.
- **Who arranges:**
  - **Teacher arranges** — the applicant proposes a covering teacher per class in the leave application.
  - **Admin arranges** — any empty slot surfaces as "needs cover" for Principal/Office to fill; same path
    for sudden/emergency leave where nothing was arranged.
- **Activation (D-#22):** a teacher's choice is a **proposal**; the proxy grant takes effect only on
  **approval by Principal/Office**. The teacher does the legwork; admin stays the authority that activates
  write access. No teacher silently hands another teacher write access to a class they don't teach.

---

## 3a. Build-step 2 (attendance half) — Staff attendance (LOCKED)

### 3a.1 Capture & scope
- An **external biometric terminal** is the **source of truth** for attendance.
- **All staff are enrolled, including support (guard/cleaner/cook/aya)** — each gets a `biometric_id`
  and punches like everyone else (D-#25, revised). Tracking **counts**: support pay becomes
  attendance-driven (unpaid-leave/absence deductions apply) and support joins the §3 leave-balance system —
  no longer flat pay / informal leave.
- Support staff still have **no app login** (records-only on the auth side); attendance reaches the system
  through the terminal ingest (§3a.2), not a login.
- The attendance record is per-staff, per-day.

### 3a.2 Ingest — how punches reach SCD Hub
- SCD Hub is **not** wired to the device today; the terminal feeds the school's **existing software** over
  Wi-Fi. The plan is for SCD Hub to connect to the device **as another client**, the same way that software
  does: **periodic auto-sync** + a **manual on-demand pull** for realtime.
- SCD Hub is a **consumer** — it never manages the device.
- **The internal attendance record is the source of truth and is transport-agnostic.** "Periodic auto" and
  "manual pull" are just transports feeding it; a file/CSV import remains a valid fallback transport. So the
  contract can be built now and the live transport bolted on later **without redesign**.
- **Mapping linchpin:** every punch carries the device's staff number, matched to `StaffProfile.biometric_id`
  (§2.1). No mapping → no attachment.
- **Dependency / flag:** a live device sync is the **first live external dependency** in the app — the
  posture so far is manual-import-only (content) with automation parked. It is **device-specific**, so the
  device **model/SDK** is on the critical path before the sync is built (the name can be supplied later).
  Captured as a knowing architectural decision (→ D-#24).

### 3a.3 Statuses & lateness
- Statuses: `present` / `absent` / `late` / `half-day` / `on-leave`.
- **First punch = arrival (in); last punch = departure (out).**
- **Late** = arrival later than (start time + grace). The record stores both the `late` status **and the
  late-minutes**, so payroll can use it however the Principal later decides.
- Because the out-punch is captured too, **early departure** is computable the same way.
- **Boundary:** attendance only *captures* lateness / early-departure minutes. The **pay consequence**
  is a **payroll** decision — **resolved in §4.3 (D-#26): no deduction by default, conduct-handled; an
  optional Principal-configurable deduction rule can be switched on.**

### 3a.4 Schedule model (what lateness compares against)
- **One school-wide base start time and base end time** for all staff, with **per-person exceptions**
  (no per-category tier). The per-person overrides sit on `StaffProfile`, beside the per-staff leave override.
- **Dated overrides:** start/end model carries dated overrides so the **Ramadan** timetable (and other
  special days) is just an override, not a yearly hand-edit.
- **Working-days calendar:** attendance reads the school's working days (weekly holiday — Friday, plus
  Saturday if closed — and school holidays), so a non-working day never reads as "absent."

### 3a.5 Manual entry & integrity
- Office may **manually enter/correct** a missed punch.
- **Every manual entry is audit-logged** (who, when) and **tagged `source: manual` vs `source: device`**,
  so a human override is never indistinguishable from a real punch (rides the append-only audit log, ADR-008).
- **No-punch reconciliation order:** approved leave that day → `on-leave`; otherwise the day sits
  **unresolved** for office to either correct (missed punch → `present`, with a reason) or confirm `absent`.

### 3a.6 Visibility
- **Principal/Office** see and manage all attendance. A **logged-in staff member** sees only **their own**
  record. (Support staff have a record but no login, so they don't self-view in-app.)

---

## 4. Build-step 3 — Payroll (LOCKED)

### 4.1 Salary structure
- Pay is a **single consolidated monthly figure** per person — no basic/allowance split. Lives on
  `StaffProfile` (Principal/Office-only).
- **Day-rate** (for any day-based adjustment) = monthly figure ÷ that month's **working days** (default;
  flat ÷30 is the alternative if you prefer). Parked: the actual figures.
- Applies to **all staff including support** — support pay is now attendance-driven (D-#25, revised), not flat.

### 4.2 The monthly run
- **Net = consolidated gross − deductions + additions**, per staff, per month.
- **Workflow:** Office prepares the run → **Principal approves** → the run **locks** (immutable) and is
  audit-logged; payslips and the payment export issue **only** from a locked run.
- **Pro-ration:** mid-month joiners/leavers and part-timers pro-rated on the day-rate.

### 4.3 Deductions
- **Unpaid leave (LWP) / unauthorised absence** → day-rate × days. *(The only attendance-driven deduction.)*
- **Advance / loan repayment** → see §4.5.
- **Statutory** (income-tax withholding, any provident fund) → **placeholder; confirm with your accountant.**
  Not hard-coded; no tax advice is given here.
- **Lateness / early departure → no deduction by default (D-#26)** — recorded only and handled as conduct
  (§5.2); an **optional Principal-configurable deduction rule** can be switched on (its parameters parked).

### 4.4 Additions
- **Eid / festival bonus** — a policy amount you set (a fixed figure, or a multiple of monthly salary, since
  there is no "basic" to compute against). Parked: the policy/number.
- **Arrears** (back-pay, corrections).
- **Leave encashment payout** — the §3.4 voluntary in-service cash-out and the mandatory exit settlement
  surface here; the accruing carryover liability shows up as a real line.

### 4.5 Advances / loans
- One **Advance/Loan** record per staff: amount, issue date, recovery mode, schedule, running balance, status.
- **Recovery mode chosen per advance:** one-shot next run **or** scheduled installments over months.
- **Interest-free *and* fee-free** (*qard hasan* — nothing charged on top of principal) (**D-#27**).
- **Net-pay guard:** a repayment never pushes net pay negative; any excess caps and rolls forward.
- **Principal-approved, audit-logged**; early settlement allowed.
- **At exit:** outstanding balance netted against final settlement (with the encashment payout, §4.4).

### 4.6 Disbursement
- The app **computes and records** the run and issues **payslips** (itemised; Bangla labels + English codes).
- It also produces a **payment export** — net pay per staff for upload to your bank / bKash bulk-disbursement.
  Actual payment happens **outside** the app (no live payment API this phase).
- **Format is target-specific** (which bank / bKash product): design a clean internal disbursement record and
  map it to the target once confirmed — no redesign when it lands. Parked: the target format.
- **Payment details live on `StaffProfile`** (records addition, §2.1): payment method (bank / bKash / cash)
  + account/number, Principal/Office-only. Cash-paid staff (likely support) are flagged and excluded from the file.

### 4.7 Sensitivity
- Payroll is the most sensitive plane: **Principal/Office only**, every run audit-logged, never the corpus plane.

---

## 5. Build-step 4 — Performance, conduct & development (LOCKED)

### 5.1 Performance / appraisal
- **Two layers:** ongoing **observations** roll up into a periodic **appraisal**.
- **Observation** = an event — observer, date, class/subject, **REF-11 rubric** scores + notes, follow-up.
  (Teachers; office/support get the form only, no observation.)
- **Appraisal** = per staff, per **cycle = annual, aligned to the academic year**: gathers the cycle's
  observations + goals + an overall outcome, and **emits development needs** (feed to §5.3).
- **Who:** supervisors (Class Teacher / Coordinator / Subject Lead) **observe within their extent**
  (bounded write — **D-#28**); the **Principal signs off** the appraisal outcome. A supervisor sees only
  their own observations — not the outcome, others' inputs, or any conduct record.
- **REF-11 rubric** is referenced/consumed, **authored in the curriculum Projects** — not owned here
  (scope boundary). Parked until available.

### 5.2 Conduct (disciplinary + grievance)
- **Defined escalating ladder**, stages configurable, default **verbal → written → final → termination**;
  the ladder **enforces order**.
- **Each step records:** staff, date, issue + category, stage, evidence/notes, the **person's
  response/hearing captured _before_ the step is finalised** (*'adl* — built in, not optional), issuer, outcome.
- **Gross-misconduct fast-track** — a serious incident may jump straight to final/termination.
- **Warnings lapse:** each carries a **live-until** date; on lapse it **stops counting toward escalation**
  but **stays on file as history** (not deleted — audit integrity holds). Lapse period parked, settable per stage.
- **Termination step** writes employment **status → terminated** and triggers **offboarding / final settlement**.
- **Grievance** — a **staff-raised** confidential complaint channel routed to the Principal; tracked +
  audited (same confidentiality, opposite direction to disciplinary).
- **Confidentiality (*satr*):** Principal/Office + the subject (own record only); **supervisors never see
  conduct**; fully audit-logged.

### 5.3 Development
- A **per-staff training / CPD log:** activity, date, outcome.
- **Fed by the development needs** the appraisal emits (§5.1), so review and growth are linked, not separate.

### 5.4 Sensitivity
- After pay, the most sensitive plane: **Principal/Office only** (plus the subject's own record),
  audit-logged, never the corpus plane.

---

## 6. Offboarding (LOCKED — cross-cutting workflow)

Not a build-step of its own; it stitches together pieces already specified in records, leave, payroll and
conduct into one exit workflow.

- **Triggers** — resignation (with notice → last working day), termination (from the conduct ladder, §5.2),
  fixed-term end, retirement — each sets employment **status** (§2.4).
- **Clearance checklist** — configurable: asset return (keys/devices/books), handover (classes, trackers,
  materials), confirm no pending dues.
- **Access revocation** — on the last working day the **system** disables the `User` login and revokes all
  scope grants (teaching/supervisory/proxy), audit-logged. Not left manual — the security-sensitive step.
- **Final settlement** — a final pay run: salary pro-rated to last day + arrears + full leave encashment
  (§3.4) − outstanding advance (§4.5). **Hard-held until clearance is complete (D-#29)** — nothing releases,
  no deadline, until assets are returned and handover is done.
- **Retention** — `StaffProfile` is kept (status = resigned/terminated), history + audit retained,
  confidentiality continues. **Never deleted.**
- **Service / experience certificate** + optional **exit interview** (reason, feedback).

---

## 7. Open items (not yet designed)

- **Maternity legal verification** — see D-#23 (the one item carrying real risk; verify §1(4) status with a
  legal adviser before that part locks).
- **Parked numbers / specs** *(shapes already locked):* leave entitlements + Hajj reset (§3.1); attendance
  start/end times + grace + device model/SDK (§3a); Eid bonus policy + day-rate basis (§4); statutory
  deductions to confirm with accountant (§4.3); payment-export target format (§4.6); warning lapse period
  per stage + appraisal cadence (§5); REF-11 rubric availability (§5.1); offboarding clearance-list items +
  notice periods (§6).

---

## 8. Decisions to append to `DECISIONS.md` (append-only — do not rewrite existing rows)

| ID | Decision | Rationale |
|---|---|---|
| D-#22 | **Cover / proxy teacher is _proposed_ per class** (by the absent teacher in the leave application, or by Principal/Office for empty/emergency slots) and **activates only on Principal/Office approval**. The leave is the parent record; it fans out one cover slot per class/section the absent teacher teaches, each slot independently assignable; each approved slot becomes a D-#20 proxy grant. | Refines D-#20 (assigner = Principal/Admin). Keeps activation authority with admin while letting the absent teacher do the arranging legwork. Avoids expanding write-authz to teachers (a teacher self-creating live proxy grants would let one teacher grant another write access to a class) — corpus-plane boundary still overrides (ADR-005/017). |
| D-#23 | **Maternity leave is set _unpaid_** in the HR leave design, recorded as a **knowing, accepted risk** by the Principal. | Bangladesh law points the other way: BLA §46 mandates **paid** maternity (8 weeks before + 8 after); a 2012 Ministry of Education decree set **6 months paid** for non-government teachers (which this school's teaching staff are); §1(4) lets some establishments set their own policy and §46 carries eligibility conditions (≥6 months' service; >2 surviving children → leave but not benefit). The Principal accepts the exposure as a deliberate decision rather than a silent default. **Action:** verify coverage/exemption with current law / a legal adviser before final lock, and keep the §1(4) basis (or reasoning) on file beside this row. |
| D-#24 | **Staff attendance ingests from the biometric device via live sync** (periodic auto-sync + manual on-demand pull), with SCD Hub as a consumer alongside the school's existing software. | This is the **first live external dependency** in the app, knowingly qualifying the manual-import-only posture for ops data. Reversible: the internal attendance record is the source of truth and transport-agnostic, so a file/CSV import remains a valid fallback. Device is **model-specific** — the SDK/model is a prerequisite for building the sync. Mapping via `StaffProfile.biometric_id`; the corpus-plane firewall still overrides (ADR-005). |
| D-#25 | **All staff, including support (guard/cleaner/cook/aya), are attendance-tracked on the biometric terminal** — each enrolled with a `biometric_id`; tracking **counts**: support pay is attendance-driven (unpaid-leave/absence deductions) and support is on the §3 leave-balance system. Support still have no app login. | Revised from the earlier "support untracked / flat pay / informal leave." The Principal chose uniform, auditable treatment for everyone; the terminal already reaches them and `biometric_id` maps the punch (§3a.2), so no login is needed to track. |
| D-#26 | **Lateness / early departure has no payroll deduction _by default_** (recorded only; handled via conduct, §5.2), **but an optional Principal-configurable deduction rule may be switched on**; the only always-on attendance deduction is unpaid-leave/absence at the day-rate. | Refines the earlier "no pay impact." Default-off keeps the kinder conduct route and avoids unfair docking, while giving the Principal a lever to enable a deduction policy (e.g. N lates = a day) when warranted. Parameters parked until set. |
| D-#27 | **Staff advances/loans are interest-free _and_ fee-free** (*qard hasan*), recovered through payroll (one-shot or installments), with a net-pay guard and exit-netting. | An Islamic institution must not charge *riba* — and *riba* covers disguised processing fees, not only stated interest. The guard (never zero out a salary) reflects "wages in full / no hardship." Recorded so no future change quietly adds a charge. |
| D-#28 | **Supervisory grant gains a bounded observation-write:** a supervisor (Class Teacher / Coordinator / Subject Lead) may submit performance **observations** on staff **within their existing supervisory extent** (whole-school / grade / subject-dept / explicit set); the **appraisal sign-off (outcome) stays Principal-only**, and supervisors see neither the outcome, others' inputs, nor any conduct record. | Refines D-#17 (supervisory = read-only). Performance review needs supervisor observation input, but the school keeps the *judgement* central with the Principal. Mirrors the proxy overlay — a narrow write inside a defined, pre-existing scope: no new role, no scope-model churn (ADR-004/017); the corpus-plane firewall still overrides (ADR-005). |
| D-#29 | **Final settlement is hard-held until offboarding clearance is complete** — no deadline; earned pay (salary to last day + leave encashment) and all other dues release only after assets are returned and handover is done. | Principal's choice, for maximum leverage to recover assets/handover. Recorded as a **knowing trade-off** against the prompt-wages obligation (*"pay the worker before his sweat dries"*) and against the risk that a non-cooperative leaver's earned wages sit indefinitely (the deadline-backstop alternative was declined). **Action:** confirm against any Bangladesh statutory final-dues timeline before final lock. |

## 9. Suggested `STATUS.md` additions
- **Now/next:** add HR module — **all four build-steps + offboarding designed** (records, attendance & leave,
  payroll, performance/conduct/development, offboarding; this doc). Remaining: maternity legal check + parked
  numbers/specs (values you supply or external confirmations).
- **Recent decisions:** D-#22 (cover proposal → admin approval), D-#23 (maternity unpaid, accepted-risk),
  D-#24 (attendance live device sync → first live external dependency), D-#25 (all staff incl. support tracked),
  D-#26 (lateness no deduction by default, optional configurable rule), D-#27 (advances interest- & fee-free),
  D-#28 (supervisor observation-write), D-#29 (final settlement hard-held until clearance).
- **Roadmap note:** HR (records/attendance/leave/payroll/performance/offboarding) pulled forward from
  `docs/roadmap.md` "Deferred ops modules" into the active build.
