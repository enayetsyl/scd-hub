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
- **Build order:** **CO-1** REF-11 form core + pipeline + roles → **CO-2** footage upload → **CO-3** release + teacher response + notify/escalate (in-app) → **CO-4** trend → **CO-5** Quran (ClassEcho) form → **CO-6** review scheduler → **CO-7** reviewer effectiveness → **CO-8** publish gate (D-#271) → **CO-9** parallel multi-reviewer co-review + compare (D-#272).

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

## §3 — Reused / unchanged (do not rebuild)

`RoutineSlot` + date (session anchor); `Section` / `SubjectGroup` (D-#48/#56) for the anchor; `HW_SUBJECTS` (REF-11 form) and `QURAN` (Quran form) off `ROUTINE_SUBJECTS` (D-#54); single TEACHER role; audit log (ADR-008); `calendar.ts` (review only real teaching sessions); ADR-005 firewall (no corpus/student path). Notification **transport** reuses the deferred messaging/push pipeline (D-#52) — this module delivers **in-app now**, push later.

## §4 — New vocabulary (app-native; `/shared/vocab.ts`; BN labels + English codes)

> App-native only; **no envelope/schema twin, no harness sync.** Verifier asserts presence + BN-label coverage.

- `OBSERVATION_FORMS = [REF11, QURAN]` — REF-11 ফর্ম / কুরআন ফর্ম.
- `OBSERVATION_DOMAINS = [D1..D5]`, `OBSERVATION_LEVELS = [1..4]`, `OBSERVATION_GATES = [G1,G2]`, `GATE_RESULTS = [PASS,BREACH]` — REF-11 form (BN/EN per REF-11 §3/§5; level 3 = working standard; **no total/average**).
- `QURAN_REVIEW_CRITERIA` — the ClassEcho rating items, scored 1–5 (**exact labels pinned from the ClassEcho `review` model before CO-5 — see CO-5**); `QURAN_COMPLIANCE_ITEMS` — yes/no: class started on time · class performed as trained · maintains discipline · students understand the lesson · class is interactive · signs homework diary · checks homework diary; narrative: strengths / improvements / suggestions.
- `OBSERVATION_STATES = [UPLOADED, ASSIGNED, REVIEWED, TEACHER_RESPONDED, SUPERSEDED]` — আপলোডকৃত / বরাদ্দকৃত / পর্যালোচিত / শিক্ষকের জবাব / প্রতিস্থাপিত.
- `GROWTH_PROGRESS = [YES,PARTLY,NOT_YET]` (REF-11 carry-forward); `SUPPORT_TIERS = [STRONG, DEVELOPING, NEEDS_SUPPORT]` (scheduler).
- Permissions: `observation:upload` (PRINCIPAL, OFFICE), `observation:review` (assigned observer — a TEACHER), `observation:read` (row-scoped), `observation:manage` (PRINCIPAL, OFFICE — designations, cadence config, dashboards).

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

## §6 — Given/When/Then journeys

1. **Upload & assign.** *Given* a recorded session, *when* Office uploads it and assigns a senior teacher (not the class's own teacher), *then* it is ASSIGNED and audited.
2. **Review & release.** *Given* an ASSIGNED observation, *when* the observer submits scores + comment, *then* REVIEWED and the observed teacher is notified in-app and can now see it.
3. **Respond.** *Given* a REVIEWED observation, *when* the teacher writes a response, *then* TEACHER_RESPONDED, visible to observer + Principal; escalation stops.
4. **No response.** *Given* no response by the configured interval, *when* it lapses, *then* reminders fire, then a flag to the Principal.
5. **Quran form.** *Given* a Quran session, *when* it is reviewed, *then* the ClassEcho form is used, not REF-11.
6. **Due list.** *Given* tiers and last-review dates, *when* the scheduler runs, *then* overdue teachers are suggested, weakest/most-overdue first.
7. **Calibration.** *Given* two observers on one recording, *when* both submit, *then* their agreement-within-one-level is reported to the Principal.

## §7 — Out of scope

Appraisal / pay / discipline (REF-11 §1.3; HR / School Handbook) — and this data is **not** to be repurposed as appraisal without the Principal (cf. D-#28). Device **push** transport (deferred pipeline, D-#52 — in-app only now). Guardian visibility (none; staff-internal). Cadence *enforcement* (the scheduler suggests; humans assign). Peer/self review as a formal record (practice only, REF-11 §1.4). REF-11 rubric governance (curriculum Project; adopted by ADR).

## §8 — Traceability

REF-11 v1.1 (D-PROJ00-054/-065) · REF-18 §4 (Bloom, D2) · D-#17 (supervisory overlay) · D-#28 (observation input / appraisal-outcome reserved to Principal) · D-#36 (HW_SUBJECTS, Quran excluded from HW) · D-#46/#52 (app-native vocab, no wire twin; deferred push) · D-#48/#56 (SubjectGroup; Quran/Arabic groups; Deen→Islam) · D-#54 (ROUTINE_SUBJECTS incl. QURAN) · ADR-005 (firewall) · ADR-008 (audit). New: **D-#146–#152**. Vocab: `OBSERVATION_FORMS/DOMAINS/LEVELS/GATES/GATE_RESULTS/STATES`, `QURAN_REVIEW_CRITERIA`, `QURAN_COMPLIANCE_ITEMS`, `GROWTH_PROGRESS`, `SUPPORT_TIERS`, `observation:{upload,review,read,manage}`; reuses `RoutineSlot`, `SubjectGroup`, `Section`, `HW_SUBJECTS`, `ROUTINE_SUBJECTS`.
