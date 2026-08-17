# PRD — Classroom Observation module (REF-11 + Quran review)

**Status:** DRAFT (build contract) — planning 2026-06-13
**Owner:** Principal
**Module:** `classroom-observation` (standalone; identity/operational plane, behind ADR-005)
**Decisions:** D-#146–#152 (this contract)
**Implements (external, LOCKED):** REF-11 Classroom Observation Rubric v1.1 (Project 00/07; D-PROJ00-054/-065) — adopted by ADR as cross-Project **coordination, not imported curriculum governance** (AGENTS scope boundary; D-#33 pattern). The app carries the operational structure + BN/EN labels + a non-authoritative §3 echo; the anchors stay in REF-11.
**Ports from:** ClassEcho — (a) the client-side YouTube upload path (`youtube_upload_demo.md`); (b) the legacy review **form** (rating criteria + compliance checklist + narrative), reused **only for Quran** teaching.

---

## §0 — At a glance / build order (read first)

- **What:** an in-app pipeline to record a class, have a senior teacher review it, release it to the observed teacher, let that teacher respond, nudge them if they don't, and track the trend — plus a scheduler that suggests who's due and a reviewer-effectiveness read.
- **Two forms, one pipeline:** **REF-11 form** for general subjects + Arabic + Islam (`HW_SUBJECTS`); **ClassEcho form** for **Quran**. The form is chosen by subject.
- **No Principal sign-off** — developmental, not appraisal (REF-11 §1.3). The observer's submission releases straight to the observed teacher. **↳ SUPERSEDED by D-#271 / CO-8:** a Principal/Office **publish gate** now sits between REVIEWED and teacher visibility — the observer's submission is REVIEWED (observer/Principal-only) and a separate `publishClassroomObservation` releases it. Still developmental once published (no appraisal sign-off semantics).
- **Anchor:** a session = a `RoutineSlot` + date → teacher, subject, period, and the **Section** (general/Islam) or **SubjectGroup** (Arabic groups; Quran groups Qaida/Ammapara/Najera/Hifz, D-#56/#48).
- **Plane:** identity/operational **staff** data; **no corpus/student path** — ADR-005 firewall unaffected.
- **Contract surface:** app-native `/shared/vocab.ts` additions only — **no wire twin, no two-/three-place sync** (D-#46/#52). Vocab verifier stays green.
- **Build order:** **CO-1** REF-11 form core + pipeline + roles → **CO-2** footage upload → **CO-3** release + teacher response + notify/escalate (in-app) → **CO-4** trend → **CO-5** Quran (ClassEcho) form → **CO-6** review scheduler → **CO-7** reviewer effectiveness → **CO-8** publish gate (D-#271) → **CO-9** parallel multi-reviewer co-review + compare (D-#272) → **CO-10** prior-focus carry-forward on the review form (D-#363) → **CO-11** the observer's own review history (D-#363) → **CO-12** withhold (D-#369) → **CO-13** AI review analysis (D-#426/#427) → **CO-14** AI review rota from a written instruction (D-#426/#427) → **CO-15** cancel a planned review (D-#428) → **CO-16** overall suggestion on the review form (D-#503).
- **The AI pair (CO-13/CO-14) share one rule:** the model **chooses and narrates; it never computes.** Every number, date, period and clock time is produced server-side and handed to it; its output is validated against that same server-built set before anything is shown. See D-#426.

---

## §1 — Goal

One consistent, growth-framed way to review teaching across the school: REF-11 for general/Arabic/Islam, the familiar ClassEcho form for Quran, both two-way (observer comments, teacher responds), on a sensible cadence, with a private read on how well observers themselves are reviewing. Replaces the legacy ClassEcho app.

## §2 — Gap table

| Area | Current (scd-hub `main`) | Desired |
|---|---|---|
| Teaching review | None (the "Plan review" loop reviews lesson-plan documents, D-#38). | Two-form review pipeline (CO-1/CO-5). |
| Quran review | None in scd-hub. | ClassEcho form, ported (CO-5). |
| Footage | Only in legacy ClassEcho. | `SessionRecording` → YouTube-unlisted (CO-2). |
| Two-way feedback | None. | Observer comment → teacher response, with reminders (CO-3). |
| Cadence | None. | Tiered scheduler suggests who's due (CO-6). |
| Observer quality | None. | Calibration + timeliness + throughput + impact + fairness (CO-7). |
| Reading the reviews | A Principal reads 34+ free-text reviews by hand to see who needs help. | A ranked, narrated per-teacher read, computed server-side and worded by the model (CO-13). |
| Abandoning a plan | No way out — an uploaded/assigned row can only move forward, and sits in the queue and counts forever. | Principal/Office cancel with a required reason; reversible; footage kept (CO-15). |
| Planning the next month | The CO-6 due list says *who*; turning that into dated sessions is manual against a routine that changes often. | A written instruction ("Zarir every other day, rotate his 3 classes…") → a validated dated rota (CO-14). |
| A suggestion that fits no domain | Every free-text box on the REF-11 form hangs off something scored, so a cross-cutting idea has to be filed as a domain weakness — or left unsaid. | One optional, unscored `overallSuggestion` beside the review (CO-16). |

## §3 — Reused / unchanged (do not rebuild)

`RoutineSlot` + date (session anchor); `Section` / `SubjectGroup` (D-#48/#56) for the anchor; `HW_SUBJECTS` (REF-11 form) and `QURAN` (Quran form) off `ROUTINE_SUBJECTS` (D-#54); single TEACHER role; audit log (ADR-008); `calendar.ts` (review only real teaching sessions); ADR-005 firewall (no corpus/student path). Notification **transport** reuses the deferred messaging/push pipeline (D-#52) — this module delivers **in-app now**, push later.

## §4 — New vocabulary (app-native; `/shared/vocab.ts`; BN labels + English codes)

> App-native only; **no envelope/schema twin, no harness sync.** Verifier asserts presence + BN-label coverage.

- `OBSERVATION_FORMS = [REF11, QURAN]` — REF-11 ফর্ম / কুরআন ফর্ম.
- `OBSERVATION_DOMAINS = [D1..D5]`, `OBSERVATION_LEVELS = [1..4]`, `OBSERVATION_GATES = [G1,G2]`, `GATE_RESULTS = [PASS,BREACH]` — REF-11 form (BN/EN per REF-11 §3/§5; level 3 = working standard; **no total/average**).
- `QURAN_REVIEW_CRITERIA` — the ClassEcho rating items, scored 1–5 (**exact labels pinned from the ClassEcho `review` model before CO-5 — see CO-5**); `QURAN_COMPLIANCE_ITEMS` — yes/no: class started on time · class performed as trained · maintains discipline · students understand the lesson · class is interactive · signs homework diary · checks homework diary; narrative: strengths / improvements / suggestions.
- `OBSERVATION_STATES = [UPLOADED, ASSIGNED, REVIEWED, TEACHER_RESPONDED, SUPERSEDED]` — আপলোডকৃত / বরাদ্দকৃত / পর্যালোচিত / শিক্ষকের জবাব / প্রতিস্থাপিত.
- `GROWTH_PROGRESS = [YES,PARTLY,NOT_YET]` (REF-11 carry-forward); `SUPPORT_TIERS = [STRONG, DEVELOPING, NEEDS_SUPPORT]` (scheduler).
- Permissions: `observation:upload` (PRINCIPAL, OFFICE), `observation:review` (assigned observer — a TEACHER), `observation:read` (row-scoped), `observation:manage` (PRINCIPAL, OFFICE — designations, cadence config, dashboards, publish/withhold/cancel).
- `OBSERVATION_ASSIGNMENT_CANCELLED` — a new `NOTIFICATION_KINDS` entry (CO-15; app-native, BN + EN labels, **no wire twin** — the CO-8 `OBSERVATION_READY_TO_PUBLISH` precedent). The only vocab addition CO-13–CO-15 make between them.

---

## §5 — Slices

### CO-1 — REF-11 form core + pipeline + roles
**Model `ClassroomObservation`** (identity plane): `form∈OBSERVATION_FORMS`; session anchor `{ routineSlotId?, sectionId|subjectGroupId, subject, teacherId, classDate, periodNumber }`; `observerId`; REF-11 payload `{ domains:[{domain,level1-4,note}]×5, gates:[{gate,result,breachNote?}]×2, oneStrength, growthFocus, prevObservationId?, priorFocusProgress? }` — **no total/average**; `state`; timestamps; `recordingId?`; `teacherResponse?`. (Quran payload added in CO-5.)
**Roles / lifecycle:** `observation:upload` (Principal/Office) creates the recording + the observation in **UPLOADED**, and **assigns** an observer → **ASSIGNED**. The assigned **observer** (a senior teacher) scores + comments and submits → **REVIEWED** (this *releases* it to the observed teacher; no Principal sign-off). **Conflict guard: an observer cannot be assigned their own teaching.** `observation:read` is row-scoped: observer sees own; observed teacher sees own **only at/after REVIEWED**; Principal/Office (`observation:manage`) see all. Re-review supersedes (`SUPERSEDED`). **≥1 observation per recording allowed** (enables CO-7 calibration).
**Acceptance:**
- [ ] Exactly 5 domain levels (1–4) + note each; exactly 2 gate results; 1 strength + 1 growth focus; no average stored.
- [ ] A gate BREACH stands on its own regardless of levels (§2.1).
- [ ] Observer ≠ observed teacher (assignment refused otherwise).
- [ ] Observed teacher cannot read before REVIEWED; never sees other observers' inputs (D-#28).
- [ ] All transitions audited (ADR-008); vocab verifier + server tsc + tests green.

### CO-2 — Session footage (YouTube-unlisted, ported)
`SessionRecording { anchor…, youtubeVideoId, privacyStatus:"unlisted", uploadedBy, createdAt }`. Upload = client-side Google Identity Services (scope `youtube.upload`) + YouTube Data API v3 multipart, `selfDeclaredMadeForKids=false`; adapt the ClassEcho Next.js path to Expo (web first). **Google `client_id`/`api_key` in `.env` (`EXPO_PUBLIC_…`) — never committed.** Privacy = knowing trade-off (D-#149); **Action pending:** confirm against the School-Handbook recording policy + data-protection before live use.
**Acceptance:** [ ] upload yields an unlisted id linked to one anchor; [ ] no secret in any committed file/`/docs`.

### CO-3 — Release + teacher response + notify/escalate (in-app)
On REVIEWED, the observed teacher sees the video + scores + comment and **writes a response** (→ TEACHER_RESPONDED), visible to observer + Principal. UI states *"acknowledging = seen & discussed, not agreement"* (REF-11 §5). **Notification** to the observed teacher on release — **in-app now**; device push rides the deferred pipeline (D-#52). **Escalation ladder** if no response: reminder → second reminder → flag to Principal (intervals configurable, `observation:manage`).
**Acceptance:** [ ] teacher can view + respond; cannot edit scores; [ ] in-app notify on release; [ ] escalation fires on no-response per config and stops on response.

### CO-4 — Trend
Per-teacher domain trend over time (REF-11 §2.2) and, for Quran, rating/compliance trend. School-wide patterns → training-need signal (REF-11 §8). **Staff** aggregates only; no student/corpus path.
**Acceptance:** [ ] trend renders across ≥2 reviews; [ ] aggregates compute over staff only (firewall test green).

### CO-5 — Quran review (ClassEcho form)
Add the Quran payload to `ClassroomObservation`: `{ ratings:[{criterion∈QURAN_REVIEW_CRITERIA, score1-5}], compliance:[{item∈QURAN_COMPLIANCE_ITEMS, yesNo}], strengths, improvements, suggestions }`. Used when `subject==QURAN` (Quran `SubjectGroup` anchor, D-#56). Same pipeline/roles/notify/escalate as CO-1/CO-3.
**Pre-build step (required):** pin the **exact `QURAN_REVIEW_CRITERIA` labels** verbatim from the ClassEcho `review` model (`https://github.com/enayetsyl/ClassEcho`) before building; do not invent them. The 7 compliance items + 3 narrative fields above are already final.
**Acceptance:** [ ] Quran session uses the Quran form (never REF-11); [ ] criteria match the ClassEcho source; [ ] same release/response/notify flow.

### CO-6 — Review scheduler (suggests; never auto-assigns)
Per teacher: `lastReviewedAt` + a `SUPPORT_TIERS` tier read from recent reviews (REF-11 domains-at-≥3 vs 2/1 + recent breach; Quran = avg rating + compliance). Tier → interval (Strong = longest, Developing = base, Needs-support = shortest; **base + per-tier multipliers configurable**, `observation:manage`). Output = a **"due for review" list** (overdue, sorted by tier + lateness), routine/calendar-aware (only teachers with real teaching sessions, only teaching days), never-reviewed → soonest bucket. **Guardrails:** frequency cap; tier derived from review data only; list visible to Principal/Office/observers, not wider staff; framed as support.
**Acceptance:** [ ] due list ranks correctly by tier + overdue; [ ] config changes intervals; [ ] suggestion only — no automatic assignment.

### CO-7 — Reviewer effectiveness (private/developmental — not a public scoreboard)
Per observer: **(1) Calibration** — a recording assigned to two observers; measure domain-score agreement within one level (REF-11 §1.2); **(2) Timeliness** — assign→review completion time; backlog; **(3) Throughput** — reviews completed per period; **(4) Developmental impact** — on a teacher's re-review, did the prior growth-focus domain improve (gentle, low-weight, attributed to the prior observer); **(5) Teacher fairness rating** — the observed teacher rates the review's fairness/usefulness (not agreement). Surfaced to Principal (`observation:manage`) only.
**Acceptance:** [ ] double-review computes within-one-level agreement; [ ] timeliness/throughput per observer; [ ] impact links re-review domain movement to the prior focus; [ ] fairness rating captured separately from agreement; [ ] no observer leaderboard exposed to staff.

### CO-8 — Publish gate (D-#271; reverses §1.3 "releases straight to the observed teacher")
A **Principal/Office publish checkpoint** now sits between the observer's review and the observed teacher's visibility. `reviewClassroomObservation` still transitions ASSIGNED → REVIEWED, but REVIEWED is now **observer + Principal/Office only** — NOT visible to the observed teacher. A new `publishClassroomObservation(observationId)` (`observation:manage`) stamps `publishedAt` + `publishedBy` and **that** releases it (fires `OBSERVATION_RELEASED` to the teacher). Modelled as an **additive `publishedAt` flag, NOT a new `OBSERVATION_STATES` value** (Option A) — CO-4/6/7 aggregates that key off REVIEWED are unchanged. Every read/act gate that was `≥ REVIEWED` for the observed teacher moves to `publishedAt != null`: `canReadObservation` (teacher branch), `respondToClassroomObservation`, CO-7 `rateReview`, and the CO-3 **escalation clock** (calendar-days-since-**publish**, scanning published-but-unanswered rows). At review time a `OBSERVATION_READY_TO_PUBLISH` notice goes to Principal/Office (app-native kind, no wire twin). **Migration:** existing REVIEWED/TEACHER_RESPONDED/SUPERSEDED rows are backfilled `publishedAt = reviewedAt` at deploy (one-time script) so teachers keep access to feedback they have already seen. Re-review supersession semantics are unchanged.
**Acceptance:**
- [ ] The observed teacher CANNOT read a REVIEWED-but-unpublished observation (or its footage); the observer + Principal/Office still can.
- [ ] `publishClassroomObservation` (`observation:manage`) sets `publishedAt`/`publishedBy`, is audited, and fires `OBSERVATION_RELEASED` to the teacher exactly once.
- [ ] Teacher respond + fairness-rating are refused until published; allowed after.
- [ ] The response-escalation ladder measures days since **publish**, not review, and does not fire on an unpublished row.
- [ ] Principal/Office receive `OBSERVATION_READY_TO_PUBLISH` at review; no Principal sign-off is added to the appraisal sense (still developmental). Vocab verifier + server tsc + tests green.

### CO-9 — Parallel multi-reviewer co-review + compare (D-#272)
A single recording can be reviewed by **several observers in parallel**. `requestCoReviewObservation(sourceObservationId, observerId)` (`observation:upload`) creates a NEW independent ASSIGNED observation on the **same recording/anchor** as the source, **without** superseding it and **without** `prevObservationId` — distinct from **re-review** (D-#194), which REPLACES and supersedes. Each co-review row is scored, and **published, independently** (per-row `publishedAt`, CO-8). The group key is the shared `recordingId` (footage is always attached). A new manager read `classroomObservationsForRecording(recordingId)` powers a Principal **compare view**: each reviewer's REF-11 domain/gate scores laid out side-by-side, with a **within-one-level divergence** highlight (REF-11 §1.2) — the same agreement signal CO-7 calibration scores. **Guards:** co-observer ≠ observed teacher; a co-observer already reviewing that recording is refused (no duplicate reviewer rows); the source must have a recording attached. Additive — no new state, no new permission.
**Acceptance:**
- [ ] Adding a co-reviewer creates a NEW ASSIGNED row on the same recording; the source row is NOT superseded and keeps its own state.
- [ ] The same observer cannot be added twice to one recording; the observed teacher cannot be a co-observer; a source with no recording is refused.
- [ ] `classroomObservationsForRecording` returns every reviewer's row for a recording (Principal/Office); the compare view highlights domains where reviewers differ by >1 level.
- [ ] Each reviewer's row publishes on its own `publishedAt` (CO-8); server tsc + tests green.

### CO-10 — Prior-focus carry-forward on the review form (D-#363)
**The problem this fixes.** `priorFocusProgress` asks the observer "did the prior growth focus progress?" (হ্যাঁ / আংশিক / এখনও নয়) but the review form shows **nothing** about the prior observation — so an observer reviewing several teachers in a sitting is asked to answer from memory. Worse, the only link to a previous observation, `prevObservationId`, is written **solely by `requestReReview`** (a re-review of the SAME session); a normal new observation of the same teacher weeks later has no link at all. So the data path did not exist either.

**New read `priorObservationContext(observationId)`** — resolves the observation whose growth focus this review is carrying forward:
1. if `prevObservationId` is set (a re-review), that row — no search;
2. otherwise the **newest** REF-11 row for the SAME `teacherId` with a non-null `growthFocus`, `state ∈ {REVIEWED, TEACHER_RESPONDED, SUPERSEDED}` and `classDate < ` this row's, **preferring the same `subject`** (a same-subject prior is returned ahead of any other-subject prior, not merely sorted before it);
3. else `null`.
Ordered `classDate desc, reviewedAt desc`. Served off the existing `{ teacherId: 1, classDate: -1 }` index.

**VISIBILITY — a deliberate, NARROW widening of `canReadObservation` (the sensitive part).** The prior review was usually written by a *different* observer, and the row rule is "an observer sees only their own rows". Carry-forward cannot work under that rule, so this read returns a **fixed narrow slice and nothing else**: `classDate`, `subject`, `form`, `growthFocus`, `oneStrength`, `priorFocusProgress`, plus the derived `sameSubject` / `isReReview` flags. It NEVER returns the prior `domains`, `gates`, breach notes, `teacherResponse`, fairness ratings, or the prior **observer's identity** — peer scores and peer identity stay private; only the developmental thread is carried. Access is gated to the **assigned observer of the row being reviewed** (or `observation:manage`), so it is not a general back door onto another observer's work.

**`priorFocusNote`** — a new optional free-text on `ClassroomObservation` beside `priorFocusProgress`: the enum alone cannot say *how* the focus moved. Validated like the rest of the REF-11 payload (trimmed, `null` when empty), REF-11-only, never required — an observation with no prior carries neither field.

**UI (`ReviewObservationScreen`).** A prior-focus card above the REF-11 block quotes the prior growth focus with its date + subject (and marks an other-subject prior as such, since "the focus was set in a different subject" changes how it is read). When there is **no prior**, the progress select AND the note field are **not rendered at all** — today a first-ever observation still offers "পূর্ববর্তী ফোকাসের অগ্রগতি", inviting a meaningless answer. `ObservationDetailScreen` shows the stored note under the progress row.

**Deliberately REF-11 only.** A QURAN row has no `growthFocus` (its narrative lives in `quran.improvements`) and no `priorFocusProgress` field to answer, so no prior card is shown on the Quran form. Carrying Quran improvements forward is a separate ask, not this slice.

**Acceptance:**
- [ ] With a prior REF-11 observation for the same teacher, the review form shows that prior growth focus (date + subject) and both carry-forward fields.
- [ ] With no prior, `priorObservationContext` returns null and NEITHER the progress select nor the note renders.
- [ ] A re-review (`prevObservationId` set) resolves to exactly that row, not a date search.
- [ ] A same-subject prior wins over a more recent other-subject prior.
- [ ] The payload NEVER contains the prior row's domains, gates, teacher response, fairness rating, or observer id — a test asserts the field set.
- [ ] A teacher who is neither the assigned observer nor a manager is refused; the observed teacher gets no path to it.
- [ ] `priorFocusNote` round-trips, trims, stores null when blank, and is refused on a QURAN row like the rest of the REF-11 payload.

### CO-11 — The observer's own review history (D-#363)
**The problem this fixes.** An observer's only surface is `myObservationReviewQueue`, which returns **ASSIGNED rows only** — the moment they submit, the review disappears from their view. They cannot re-watch a session they reviewed, re-read what they wrote, or find "that class 4 English review from last month". The full filter/search/pagination UI already exists in `AllObservationsScreen`, but it is gated on `observation:upload` (Principal/Office).

**New read `myObservationReviews(...)`** — the same filter + pagination engine as `allClassroomObservations`, with `observerId` **forced server-side to the caller** (not an argument, so it cannot be pointed at a peer). Permission `observation:review`. Every returned row is one the caller observed, which `canReadObservation` already permits — no widening. States are not restricted: the queue answers "what's open", the history answers "everything I have touched".

**New `sectionId` filter** on `allObservationsPaged` (and therefore both screens) — the owner asked to filter by class and no screen had it, although every row stores `sectionId`.

**UI.** The filter block is extracted from `AllObservationsScreen` into a shared `ObservationFilters` component (identical filters, one definition) and mounted by a new `MyReviewHistoryScreen`, reachable from the review queue and the observation hub. Rows open `ObservationDetailScreen`, which already embeds the session video — so "see the video I reviewed earlier" needs no new plumbing.

**Acceptance:**
- [ ] `myObservationReviews` returns only rows where the caller is the observer, whatever `observerId`-shaped input is supplied.
- [ ] Reviewed / published / superseded rows all appear (not just ASSIGNED); filters + paging behave as on the oversight screen.
- [ ] A `sectionId` filter narrows both `myObservationReviews` and `allClassroomObservations`.
- [ ] Opening a history row plays the reviewed session's footage.
- [ ] A caller without `observation:review` is refused; `allClassroomObservations` stays `observation:upload`.

### CO-12 — Withhold: a recorded decision NOT to publish (D-#369)
**The problem this fixes.** CO-8 made the awaiting-publish queue (`state: REVIEWED, publishedAt: null`) the Principal's work list — it drives the Observation drawer badge and the admin-Today `obsAwaitingPublish` tile. But some reviews are deliberately never released to the observed teacher (handled verbally, unusable footage, a re-observation already scheduled). Today such a row is indistinguishable from one nobody has got to yet, so it inflates the badge **forever** and the real backlog becomes unreadable.

**The flag.** Additive `withheldAt` / `withheldBy` / `withheldReason` on `ClassroomObservation` — the same Option-A shape CO-8 chose, **NOT** a new `OBSERVATION_STATES` value, so the CO-4/6/7 aggregates keyed off REVIEWED stay untouched and no contract sync is needed. `withholdClassroomObservation(observationId, reason)` (`observation:manage`) stamps all three; **the reason is REQUIRED** (trimmed, 3–500 chars) — it is the record of *why* the observed teacher never received this feedback. `releaseClassroomObservationHold(observationId)` clears them and returns the row to the queue; it deliberately does **not** publish (two separate acts). Both audited (`CLASSROOM_OBSERVATION_WITHHELD` / `_HOLD_LIFTED`, the latter carrying `priorReason` so lifting a hold does not erase the record).

**What changes, and what deliberately does not.** ONLY the counts and the filter: `observationCounts.toPublish` and the admin-Today `obsAwaitingPublish` tile add `withheldAt: null`. Everything downstream is already correct — the observed teacher could never read an unpublished row (`canReadObservation`), respond, or rate it, and the CO-3 escalation ladder already scans `publishedAt != null`. `publishObservation` refuses a withheld row (lift the hold first) so publishing stays deliberate. **Withholding is silent to the observed teacher** — telling them a review exists that they may not read is worse than not publishing it. No migration: `withheldAt` defaults null, so every existing row reads as "no hold".

**UI.** The publish-status chip row becomes one mutually-exclusive four-way over the two server booleans — All / Published / **Pending** (`published:false` + `withheld:false`, the real queue) / **Withheld** — on both the oversight screen and the observer's own history. The row badge gains a `warn`-tone "স্থগিত". `ObservationDetailScreen` shows Publish **or** Withhold (with a required reason field) on an unpublished REVIEWED row, and a withheld row shows the hold, who set it, its reason, and a Lift button. The admin-Today badge deep-link seeds `withheld: false` so the opened list matches the number that was tapped.

**Acceptance:**
- [ ] Withholding a REVIEWED row stamps all three fields, audits with the reason, leaves `state` REVIEWED and `publishedAt` null, and notifies nobody.
- [ ] An empty/whitespace-only reason is refused and nothing is written; the stored reason is trimmed.
- [ ] A non-REVIEWED row, an already-published row and a second withhold are each refused.
- [ ] `observationCounts.toPublish` and the admin-Today awaiting-publish tile both drop the withheld row.
- [ ] `publishClassroomObservation` refuses a withheld row; lifting the hold clears all three fields, audits `priorReason`, and does NOT publish.
- [ ] The Withheld filter chip returns exactly the held rows; the Pending chip excludes them. Server tsc + tests green.

### CO-13 — AI review analysis: a ranked, narrated read of who needs help (D-#426/#427)

**The problem this fixes.** CO-4 plots a trend and CO-6 says who is *due*; neither says **who is struggling and why**. That answer lives in the free text — 5 domain notes per review, plus strengths, growth focus, breach notes and the teacher's reply — and reading it is a manual sitting. Measured on live data 2026-08-01: 46 observations, 34 reviewed, and the signal that matters (one teacher with 3 gate breaches; a school-wide D4 assessment gap in 15 of 34 reviews) is invisible without reading all of it.

**Split of labour — the rule that makes this safe.** The **server ranks; the model narrates.** Nothing about the ordering is delegated:
- `observationAnalysisFacts(from, to)` (PURE, testable) computes per teacher: review count, per-domain mean, overall domain mean, gate-breach count, first/last review date, direction of travel across reviews, `priorFocusProgress` distribution, fairness/usefulness means, and the CO-6 `SUPPORT_TIERS` tier — **reusing `supportTierOf`, not a second definition**.
- **The rank is a stated rule, not a model opinion:** any teacher with a gate BREACH in the window sorts first (REF-11 §2.1 — a breach stands on its own regardless of levels), then ascending overall domain mean. A teacher with `reviewCount < 2` is ranked but carries a **`lowConfidence`** flag; one review is not a record.
- The model receives the facts + the free text and returns **one narrative per teacher plus an optional `rankNote`** where it disagrees with the computed order. The note is shown to the Principal; **it never reorders anybody.** An LLM quietly re-sorting named staff is precisely the failure this split exists to prevent.

**Guards (D-#399 lineage, enforced here not trusted to the prompt).** `validateNumerals` (reused from MR-4) rejects any numeral in a narrative that is not in that teacher's own facts, retry once. Teacher identity is **de-identified outbound** — the model sees `T1…Tn`, names are spliced in locally at render, so no staff name leaves the building. Free text is sent **unmodified, including student names** — the narrow, deliberate exception recorded in **D-#427**; read that row before changing this line. Every generation stores model id, `promptVersion` and `promptHash`.

**Never stored (owner ruling).** `observationAnalysis(from, to)` is derived at read time and persisted nowhere — the D-#85 discipline CO-6 already follows. A saved league table of named staff becomes an HR record that outlives its accuracy and gets cited months later against a teacher who has since improved. **Visibility is `observation:manage` (Principal/Office) only**, consistent with CO-7's "not a public scoreboard"; a teacher has no path to a peer's rank.

**Never blocks.** Two API failures (or two validator failures) fall back to the **computed ranking with rule-based reason chips** off the facts — "3 breaches", "D4 mean 1.4", "trend down". The Principal still gets the ranking; only the prose is missing, and the UI says so.

**Labelled.** The narrative is marked AI-drafted in the UI. It is advisory input to a human judgement, never an appraisal output (§7 already bars that use, and D-#28 reserves appraisal outcomes to the Principal).

**Acceptance:**
- [ ] `observationAnalysisFacts` is pure and unit-tested; every number in the UI traces to it, none to the model.
- [ ] Ordering is breach-first then ascending domain mean, and is identical with the provider disabled.
- [ ] A narrative containing a numeral absent from that teacher's facts is rejected, retried once, then falls back to chips.
- [ ] The outbound prompt contains no staff name (a test asserts the token set); names appear only after local render.
- [ ] `rankNote` renders as a note and provably does not affect order (a test asserts order is unchanged by its content).
- [ ] Nothing is written to any collection; a caller without `observation:manage` is refused.
- [ ] With `GEMINI_API_KEY` unset the whole screen still renders from facts alone. Server tsc + tests green.

### CO-14 — AI review rota from a written instruction (D-#426/#427)

**The problem this fixes.** The reviewer can take about one video a school day, and the Principal's real instruction is prose: *"Zarir every other day rotating his 3 classes, then the others one by rotation, skip Jerin (on leave), Hamida at most twice and only in the first half, classes 1–5, no Nursery/KG."* Turning that into dated sessions means knowing which weekdays are school days, which of a teacher's classes exist on each weekday, the period number and the clock time — and **the routine changes often**, so a table typed once is wrong within weeks.

**The model picks from a menu it did not build.** The server expands the routine into concrete dated candidates *first*:
- **School days** are derived — the distinct `dayOfWeek` on active non-break `RoutineSlot`s (SUN–THU today), never hardcoded — minus `HolidayException`.
- **Eligibility:** `classLevel ∈ [1..5]` (Nursery −1 / KG 0 excluded), `isBreak: false`, `active: true`, teacher active and not excluded.
- **Clock time is computed, never guessed:** `ScheduleWindow.dayStartMinutes` + the cumulative `PeriodGrid` durations for the audience serving that class level (`class_1_5` → P5 = 09:40–10:15 at a 07:00 start).
- Each candidate carries a stable id and its teacher's CO-6 tier + `lastReviewedAt`.

The model gets the **instruction verbatim** plus that candidate set, and returns `{date, candidateId, reason}` per school day through `responseSchema` constrained decoding. **It never emits a period, a time or a class** — only an id that already exists. A hallucinated slot is therefore not a validation failure to catch; it is unrepresentable.

**The constraint echo — how you see whether it understood you.** Alongside the schedule the model returns a **structured restatement of the instruction it acted on** (`{intensive:[{teacher, everyNDays, rotateClasses}], excluded:[…], caps:[{teacher, max, window}], levels, perDay}`). Two jobs: the validator checks the schedule against **the echo**, and the Principal reads the echo to confirm it matches what they meant. "Did it understand me?" becomes something displayed rather than assumed.

**Validation (the core of this slice).** Every returned id exists and its date matches; exactly one per school day, none missing, none doubled; every row is levels 1–5; no excluded teacher appears; every cap in the echo holds; the intensive teacher's spacing matches `everyNDays`; and where `rotateClasses` is set, that teacher's classes differ by at most one in count. On violation: **one retry with the violations named**, then **refuse and show them**. There is deliberately **no fallback table** — unlike a monthly comment, a plausible-looking wrong rota is worse than no rota, because nobody can tell by looking.

**Display only (owner ruling).** Accepting a rota does **not** create `ClassroomObservation` rows. CO-6's guardrail — the system suggests, humans assign — is unchanged, and a model-influenced list must not write into the observation pipeline unattended.

**Stored, and re-checked against a moving routine.** `ObservationRota { periodFrom, periodTo, instruction, constraintEcho, rows:[{date, candidateId, teacherId, sectionId|subjectGroupId, subject, periodNumber, startHHmm, endHHmm, reason}], model, promptVersion, promptHash, createdBy }`. On every later read each row is **re-resolved against the live routine** and flagged `slotChanged` when its slot no longer exists — so a rota degrades visibly instead of quietly showing a period that moved. Regenerating is one call, because the instruction was stored, not just its output.

**Relationship to CO-6.** CO-14 **consumes** the tier + `lastReviewedAt` signal and does not replace the due list. Two schedulers disagreeing about who is overdue is the obvious way to get this wrong.

**Additive.** No new vocab, no new state, no new permission (`observation:manage`), no wire twin — the verifier is untouched.

**Acceptance:**
- [ ] The candidate expander is pure and unit-tested: school days derived from the routine, holidays removed, levels −1/0 excluded, clock times computed from `dayStartMinutes` + grid durations.
- [ ] A returned id that is absent from the candidate set, or whose date disagrees, is rejected.
- [ ] Missing day, doubled day, excluded teacher, and a breached cap are each caught and named.
- [ ] The intensive teacher lands on every Nth school day and their classes are balanced within one.
- [ ] Two failures produce a refusal listing the violations — never a partial or unvalidated table.
- [ ] Accepting a rota writes `ObservationRota` and creates **no** observation rows.
- [ ] A stored rota whose underlying slot has since moved renders `slotChanged` rather than a stale period.
- [ ] The constraint echo is rendered to the user beside the table. Server tsc + tests green.

**BUILT 2026-08-02.** `rota.ts` (pure: `datesInRange` / `candidatesForDate` / `validateRota` /
`normalizeEcho`) + `ObservationRotaService` (expansion, provider seam, orchestration,
save/read) + `ObservationRota` model + `observationRota` resolvers + `ObservationRotaScreen`.
Two things the build settled that the spec left open:
- **School days come from `resolveDayType`, not from the routine's own weekday coverage.**
  That is the ONE calendar source the trackers and attendance already use (D-#50), so
  holidays are honoured for free and there is no second definition of "a school day".
  FULL only — Saturday is QURAN_ONLY and a REF-11 review targets general teaching.
- **`saveObservationRota` regenerates from the stored instruction rather than accepting a
  client-posted table.** The rows a client could send are exactly what the validator
  exists to distrust, so trusting them on save would defeat the whole design.
Gates: jest 2807/2807 (164 suites, 28 new), shared/server/app typecheck clean, vocab
verifier PASS, expo web export exit 0.

### CO-15 — Cancel a planned review (UPLOADED / ASSIGNED) — D-#428

**The problem this fixes.** Once a session is uploaded or an observer assigned, there is **no way out**. The row can only move forward: an observer must review it, or it sits in `myObservationReviewQueue` and `observationCounts.toReview` forever. But plans lapse for ordinary reasons — the footage is unusable, the teacher left or is on leave, the class was covered by a substitute, the routine changed under it, or it was simply uploaded twice. Today the only remedies are to review something nobody wants reviewed, or to delete the row and lose the record. Owner ask: **Principal and Office need to cancel an assigned or uploaded review.**

**Additive flags, for the third time in this module.** `cancelledAt` / `cancelledBy` / `cancelledReason` on `ClassroomObservation` — **NOT** a new `OBSERVATION_STATES` value. CO-8 (publish) and CO-12 (withhold) both made this choice and both stated why; the reason is unchanged and now load-bearing. A new state would ripple into every `state`-keyed read — the CO-4 trend, the CO-6 tier derivation, CO-7 throughput, the queue, the counts, every UI chip — to express something that is a **flag on a row, not a stage of its life**. `state` is left exactly as it was (UPLOADED or ASSIGNED), so a restore needs no memory of where the row came from.

**Scope, and the boundary with CO-12 (the part to get right).** `cancelClassroomObservation(observationId, reason)` (`observation:manage`) accepts **only `UPLOADED` or `ASSIGNED`**. A `REVIEWED` row is refused with a message naming the alternative: **cancel is "this review will not happen"; withhold (CO-12) is "it happened and will not be released".** Conflating them would let a completed review be erased as though it had never been written, which is exactly the record CO-12 exists to keep. `TEACHER_RESPONDED` and `SUPERSEDED` are refused outright.

**The reason is REQUIRED** (trimmed, 3–500 chars), on CO-12's precedent and for the same reason: it is the record of why a planned observation of a named teacher never took place. A second cancel is refused; both acts are audited (`CLASSROOM_OBSERVATION_CANCELLED` / `_RESTORED`, the latter carrying `priorReason` so restoring does not erase the history).

**Reversible.** `restoreCancelledObservation(observationId)` (`observation:manage`) clears all three fields and returns the row to its queue. Because `state` was never touched, restore is a clear, not a transition — an UPLOADED row comes back UPLOADED, an ASSIGNED row comes back ASSIGNED to the same observer.

**Who is told.** Cancelling an **ASSIGNED** row notifies the assigned observer — it was in their queue and vanishing silently is worse than a notice. New app-native kind `OBSERVATION_ASSIGNMENT_CANCELLED` (BN + EN labels, no wire twin — the CO-8 `OBSERVATION_READY_TO_PUBLISH` precedent). Cancelling an **UPLOADED** row notifies nobody: no observer has been named yet. **The observed teacher is never notified either way** — an unpublished row was already invisible to them (`publishedAt` null), so announcing a review that was planned and abandoned is noise about work they never saw.

**What changes downstream — precisely.** Only the pending reads, all by adding `cancelledAt: null`: `observationCounts.toReview` (today `{observerId, state:"ASSIGNED"}`) and `myObservationReviewQueue`. `toPublish` already filters `state:"REVIEWED"`, which cancel can never reach, so it is untouched. **CO-6 is verified-unaffected rather than assumed:** its tier reads only RELEASED states and a cancelled row is never released, and its candidate list comes from `RoutineSlot`s, not observations — so a cancelled plan correctly leaves no trace of "this teacher was observed". `allObservationsPaged` gains a **Cancelled** filter chip so the record stays reachable.

**The footage stays.** Cancelling does **not** delete the linked `SessionRecording` — the recording is CO-2's object with its own lifecycle, may be shared with a co-review (CO-9), and a fresh observation can be raised against the same footage. Deleting media as a side effect of cancelling an admin plan is a much larger act than the one requested.

**No migration.** `cancelledAt` defaults null, so every existing row reads as "not cancelled".

**Acceptance:**
- [ ] Cancelling an UPLOADED or ASSIGNED row stamps all three fields, audits with the reason, and leaves `state` unchanged.
- [ ] A REVIEWED row is refused with a message pointing at withhold; TEACHER_RESPONDED and SUPERSEDED are refused; a second cancel is refused.
- [ ] An empty/whitespace-only reason is refused and nothing is written; the stored reason is trimmed.
- [ ] `observationCounts.toReview` and `myObservationReviewQueue` both drop the cancelled row; `toPublish` is unchanged.
- [ ] Cancelling an ASSIGNED row notifies the assigned observer once; cancelling an UPLOADED row notifies nobody; the observed teacher is never notified.
- [ ] Restore clears all three fields, audits `priorReason`, and returns the row to the same state and observer it had.
- [ ] The linked `SessionRecording` still exists after a cancel.
- [ ] The Cancelled filter returns exactly the cancelled rows and the default list excludes them.
- [ ] A caller without `observation:manage` is refused. Vocab verifier (new notification kind + BN/EN labels) + server tsc + tests green.

### CO-16 — Overall suggestion: an idea that belongs to no domain — D-#503

**The problem this fixes.** Reviewer feedback (2026-08-17, class 2 Math): watching the footage, the useful thought was *"these students have a lot of energy — channel it through writing, pair/group work, visual materials or hands-on activities; e.g. model a money problem in pairs with the school's fake notes"*. The REF-11 form has nowhere to put that. Every free-text box on it is **attached to something scored** — a domain note, a breach note, `oneStrength`, `growthFocus`, the CO-10 progress note. So a cross-cutting, practical, take-it-or-leave-it idea has to be filed under a domain, where it reads as **that domain's weakness**. Some of these ideas do relate to a domain (engagement), but not all do, and none of them are findings. The observer's real alternative today is to say nothing.

**One optional field: `overallSuggestion`** on `ClassroomObservation` — trimmed, `null` when blank, validated with the rest of the REF-11 payload (`validateRef11Payload`), **never required**. On the form it is its own card **after** the scored block, with help text saying in as many words that it is not added to any score.

**DESCRIPTIVE, not a signal — the part to get right.** The field is stored and displayed and **read by nothing that computes**. It does not enter the CO-4 trend, CO-7 reviewer effectiveness, the CO-6 tier, or the CO-13 ranking — all of which read domain levels, gate results and fairness ratings only. This is the whole point of the ask: making a suggestion must not cost the teacher a mark, and the absence of one must not look like a clean sheet. Turning it into a signal later would be a new decision, not a refinement.

**REF-11 only, deliberately.** The QURAN (ClassEcho) form already asks for `quran.suggestions` (CO-5); a second suggestion box there would just split the same answer in two. Sent on a QURAN row it is ignored, exactly as the other REF-11 fields are (owner ruling, 2026-08-17).

**Visibility rides the existing gate.** It is a plain field on the row, so it reaches the observed teacher **when the review is published** (CO-8), together with the rest — and never before. No new permission, no widening: a withheld (CO-12) review's suggestion stays unseen like the rest of that review.

**No vocab, no migration.** No enum, no schema/`shared/vocab.ts` change (so no two-place contract sync). `overallSuggestion` defaults null, so every existing row reads as "no suggestion offered".

**Acceptance:**
- [ ] A REF-11 review submitted with a suggestion stores it trimmed; submitted without one stores `null` (never `""`), and the review is accepted either way.
- [ ] The field appears on the review form in its own card after the scored block, with the not-scored help text, and is restored by the local draft autosave like every other answer.
- [ ] A QURAN row never stores it, even when a client sends it; `quran.suggestions` is unaffected.
- [ ] Reviewing with vs without a suggestion produces identical domains/gates/strength/focus — a test pins that it changes no score.
- [ ] The observed teacher sees it on the published review and cannot read it before publish; observer + Principal/Office see it from review onward.
- [ ] It renders on `ObservationDetailScreen` and per reviewer on the CO-9 compare view; server + app tsc and tests green.

## §6 — Given/When/Then journeys

1. **Upload & assign.** *Given* a recorded session, *when* Office uploads it and assigns a senior teacher (not the class's own teacher), *then* it is ASSIGNED and audited.
2. **Review & release.** *Given* an ASSIGNED observation, *when* the observer submits scores + comment, *then* REVIEWED and the observed teacher is notified in-app and can now see it.
3. **Respond.** *Given* a REVIEWED observation, *when* the teacher writes a response, *then* TEACHER_RESPONDED, visible to observer + Principal; escalation stops.
4. **No response.** *Given* no response by the configured interval, *when* it lapses, *then* reminders fire, then a flag to the Principal.
5. **Quran form.** *Given* a Quran session, *when* it is reviewed, *then* the ClassEcho form is used, not REF-11.
6. **Due list.** *Given* tiers and last-review dates, *when* the scheduler runs, *then* overdue teachers are suggested, weakest/most-overdue first.
7. **Calibration.** *Given* two observers on one recording, *when* both submit, *then* their agreement-within-one-level is reported to the Principal.
8. **Carry-forward (CO-10).** *Given* a teacher observed before, *when* their next observation is opened for review, *then* the prior growth focus is quoted on the form and the observer answers the progress question from the screen, not from memory.
9. **Review history (CO-11).** *Given* an observer who has completed reviews, *when* they open "আমার পর্যালোচনা", *then* they can filter their own past reviews by class, subject, teacher and date and re-open the session footage.
10. **Withhold (CO-12).** *Given* a REVIEWED observation the Principal has decided not to release, *when* they withhold it with a reason, *then* it leaves the awaiting-publish badge and the Today tile, stays visible to them and the observer under the Withheld filter, the teacher is neither notified nor able to read it — and lifting the hold later puts it back in the queue without publishing it.
11. **Analysis (CO-13).** *Given* a term of completed reviews, *when* the Principal opens the analysis, *then* teachers are ordered breach-first then weakest-mean-first with a narrative reason each, low-confidence single-review teachers are marked as such, and with the AI provider unavailable the same order still renders with rule-based chips.
12. **Rota (CO-14).** *Given* a written instruction and a month, *when* the Principal generates a rota, *then* the app shows one dated session per school day with class, subject, period and clock time drawn from the live routine, alongside a restatement of the constraints it applied — and if the model breaks one of them, the Principal sees the violation, not a table.
13. **Cancel (CO-15).** *Given* an uploaded or assigned observation that will not now happen — unusable footage, a teacher on leave, a duplicate upload — *when* Principal or Office cancels it with a reason, *then* it leaves the observer's queue and the to-review count, the assigned observer is told once, the observed teacher is told nothing, the footage is kept, and the row stays readable under the Cancelled filter with who cancelled it and why. *And when* it was cancelled in error, restoring it returns it to the same state and observer.
14. **Overall suggestion (CO-16).** *Given* an observer whose most useful thought about a class fits no single domain — "channel this energy into pair work and hands-on modelling" — *when* they write it in the overall-suggestion box and submit, *then* it is stored as a suggestion, shown to the observed teacher when the review is published, and counted in no score at all.

## §7 — Out of scope

Appraisal / pay / discipline (REF-11 §1.3; HR / School Handbook) — and this data is **not** to be repurposed as appraisal without the Principal (cf. D-#28); the CO-13 ranking is advisory input to that judgement, never its output. **Auto-assignment from a generated rota** (CO-14 displays; humans assign — CO-6's guardrail). **A stored ranking history** (CO-13 is read-time only, owner ruling). **Model-chosen ordering of staff** (the rank is a stated rule; the model narrates it). Device **push** transport (deferred pipeline, D-#52 — in-app only now). Guardian visibility (none; staff-internal). Cadence *enforcement* (the scheduler suggests; humans assign). Peer/self review as a formal record (practice only, REF-11 §1.4). REF-11 rubric governance (curriculum Project; adopted by ADR).

## §8 — Traceability

REF-11 v1.1 (D-PROJ00-054/-065) · REF-18 §4 (Bloom, D2) · D-#17 (supervisory overlay) · D-#28 (observation input / appraisal-outcome reserved to Principal) · D-#36 (HW_SUBJECTS, Quran excluded from HW) · D-#46/#52 (app-native vocab, no wire twin; deferred push) · D-#48/#56 (SubjectGroup; Quran/Arabic groups; Deen→Islam) · D-#54 (ROUTINE_SUBJECTS incl. QURAN) · ADR-005 (firewall) · ADR-008 (audit). New: **D-#146–#152**; **D-#271** (CO-8 publish gate) · **D-#272** (CO-9 co-review) · **D-#324** (published filter) · **D-#363** (CO-10 carry-forward + CO-11 review history) · **D-#369** (CO-12 withhold flag) · **D-#426** (CO-13/CO-14: the model chooses and narrates, never computes) · **D-#427** (observation free text goes outbound unmodified — the student-name carve-out from D-#399(a)) · **D-#428** (CO-15 cancel: additive flags, UPLOADED/ASSIGNED only, withhold owns the reviewed case) · **D-#503** (CO-16 overall suggestion: optional, REF-11-only, descriptive — never scored). Reuses the MR-4 AI seam: `CommentProvider` / `GeminiCommentProvider` / `validateNumerals` / `promptHashOf` (`server/src/modules/reports/services/MonthlyCommentService.ts`, D-#399), `GEMINI_API_KEY`; and CO-6's `supportTierOf`. Vocab: `OBSERVATION_FORMS/DOMAINS/LEVELS/GATES/GATE_RESULTS/STATES`, `QURAN_REVIEW_CRITERIA`, `QURAN_COMPLIANCE_ITEMS`, `GROWTH_PROGRESS`, `SUPPORT_TIERS`, `observation:{upload,review,read,manage}`; reuses `RoutineSlot`, `SubjectGroup`, `Section`, `HW_SUBJECTS`, `ROUTINE_SUBJECTS`.
