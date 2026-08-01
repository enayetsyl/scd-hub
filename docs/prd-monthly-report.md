# PRD — Monthly Progress Report (one child, one month, released deliberately)

**Status:** DRAFT (build contract) · **Owner:** Principal · **Audience:** guardian (released), Principal/Office (release), class teacher (review)
**Scope:** a per-student **monthly** progress report — attendance, homework, assignment, class test, Saturday
revision, concerns, library, guardian participation, fees paid — each with a month-over-month trend and a
year-to-date cumulative, one AI-drafted guardian paragraph reviewed by a human, published only when the
Principal or Office **releases** it, and re-released as a new revision when late data changes the numbers.

**Posture:** the numbers are **not new work** — they are the SP-1..SP-4 student-profile reads (D-#357–#360)
re-windowed to a calendar month, plus cohort comparators. What IS new is the **document**: a frozen,
versioned, releasable artifact with a coverage gate and an AI comment layer. One new collection
(`MonthlyReport`) + one singleton config + one new permission; everything else is derived at read time
(D-#85). Identity plane behind the ADR-005 firewall — the corpus module imports none of it.

This is the build contract; the decisions are authoritative in `DECISIONS.md` (D-#393–D-#402). If they
disagree, the decision row wins — fix this file.

---

## 1. Goal

The school already records everything a guardian needs and shows almost none of it to them on a schedule.
A guardian learns their child is falling behind when someone phones, or at the half-yearly report card.

The monthly report closes that gap with a document the school **controls the release of**: generated from
data the app already holds, reviewed by a human, released per student or per class, and honest about what
it does not yet know.

**Non-goals.** It is not the exam report card (`docs/prd-exams.md`, EX-1..EX-10) — marks, GPA and grades
live there and are **linked, never duplicated** (D-#402). It is not a ranking sheet: no peer is named, ever
(§5.2). It is not an editor — nothing is marked, corrected or authored here except the guardian comment.

## 2. What exists today (inventory — reuse, do not rebuild)

| Piece | Where | Reuse as | Verified |
|---|---|---|---|
| `studentHomeworkPanel` / `studentAssignmentPanel` — per-subject sheets/received/submitted/notSubmitted/correct/partial/wrong/resubmissions/chased/absentAtIssue, windowed on `fromKey`/`toKey` | `trackers/services/StudentProfileService.ts` | **§5.4 / §5.5**, called with the month window | yes |
| `lifecycleBuckets.ts` — `everReached` / `currentStateSince` / `dayRangeBounds` / `isOverdue` + state sets | `trackers/lifecycleBuckets.ts` | **coverage** (§5.1) — settled vs open | yes |
| `studentProfileAttendance` — per-day absent/leave-covered, `absentUncoveredDays`, `absentStreakMax`, per-month series, overlapping leaves | `trackers/services/StudentProfileContextService.ts` | **§5.3** | yes |
| `attendanceSplitOf` — the ONE definition of the attendance split, shared with the whole-picture band (D-#359) | `trackers/services/WholePictureService.ts` | §5.3, unchanged | yes |
| `ClassTestSummaryService.studentProfile(studentId, subjects)` — per-subject marks, average, best/weakest, rank | `trackers/services/ClassTestSummaryService.ts` | **§5.6** | yes |
| `StudentComment` — `type` (GENERAL/ATTENDANCE/STUDY_HOMEWORK/BEHAVIOUR/SERIOUS_MATTER) × `sentiment` (CONCERN/POSITIVE) + `deliveredAt` | `comments/models/StudentComment.ts` | **§5.8 concerns** (D-#400) | yes |
| `ParentMeeting` + `MeetingComment` (`positiveText` / `concernText`) | `comments/models/` | §5.10 the class teacher's note | yes |
| `FinancePosting` kind `FEE_COLLECTION` — `studentId` + `feeLines[{head, amount}]`; `FeeSupportAllocation` | `finance/models/` | **§5.11 fees paid** (D-#401) | yes |
| markdown → pdfkit + NotoSansBengali A4 engine (`markdownToPdf`) | `routes/pdfRenderer.ts` | **§8 the PDF** — a sample was rendered through it during planning | yes |
| `MessageTemplate` registry (MT-1, D-#131) + `renderTemplate` | `templates/services/` | **§7.4 the fallback comment** | yes |
| `CommentDeliveryService` — wa.me link + `emitStudentComment` → inbox/push, phone-less → `unreachableByWa` | `comments/services/` | **§9 release notification rails** | yes |
| `/triggers` — shared-secret, idempotent external-scheduler endpoints (AT-4, D-#65); `startNotificationTicker` (D-#73) | `server/src/index.ts`, `notifications/services/SchedulerService.ts` | **§6.3 nightly recompute** | yes |
| `ObservationEscalationConfig` — `key: "SINGLETON"`, read-time defaults, **never seeded** against the live DB (D-#97) | `classroom-observation/models/` | **the pattern for `MonthlyReportConfig`** (§6.1) | yes |
| `writeAudit` (ADR-008, append-only) | `platform/services/AuditService.ts` | every release / re-release / revoke | yes |
| `RevisionEntry` — `present` + `juzRecords[{amountJuz, tanbih, fath, mistakes}]` + `teacherComment`; **no grade band** | `saturday-revision/models/` | §5.7 | yes (MR-1) |
| `BookLoan` — `issuedAt` / `dueDate` / `returnedAt`; OVERDUE derived, never stored | `library/models/` | §5.9 | yes (MR-1) |
| `GuardianNotice` (`sectionId` + `createdAt`, **no read receipt**), `chaseCount` on tracker records | `chat/models/`, `trackers/models/` | §5.10, reduced — see the drop table there | yes (MR-1) |

**The last three rows were named by model, not by field, until MR-1 opened them** (AGENTS rule 3). Two came
back different from the assumption: Hifz stores no grade band (§5.7) and guardian participation has no read
receipt, no inbound reply and no meeting attendance (§5.10). Those metrics were **dropped, not
approximated**, and the drops are recorded where the metric was specified.

## 3. Scope of v1 (owner ruling 2026-07-30)

**In:** all classes **including Nursery and KG** · attendance · homework · assignment · class test ·
Saturday revision (Hifz) · concerns · library · guardian participation · class-teacher meeting note ·
exam link · **fees paid** · one AI guardian paragraph · release / re-release / revoke · PDF ·
a class-level roll-up for the Principal.

**Out of v1:** vocab tests (owner: "not now") · fee **dues** (no fee-schedule model exists — D-#401) ·
any peer name · any cross-term cumulative that duplicates the exam report card.

## 4. Visibility and gates

| Actor | Sees | Can do |
|---|---|---|
| Guardian | **only RELEASED revisions**, own child only, via the existing guardian gate | read, print |
| Class teacher | any revision of a child in their section, full view | review/edit the comment, mark ready |
| Subject teacher | **the SP-1 two-tier gate applies** — `assertReportRead` on the section, then `allowedSubjectCodesForSection`; own subjects only, and the sheet says so | read only |
| Office | every report | release / re-release, recompute |
| Principal | every report | release / re-release, **coverage override, unlock after hard-lock, revoke** |

Two rules that are not negotiable:

1. **The fee block is hidden from teachers** — Principal, Office and the child's own guardian only (D-#401).
2. **A subject teacher never sees another subject's numbers**, and the AI paragraph — which is cross-subject
   by nature — is **not rendered at all** on a narrowed view. A narrowed sheet that quietly drops a
   paragraph is honest; one that shows a paragraph written from subjects the reader may not see is not.

## 5. Metric definitions (the substance — get these exact)

### 5.1 Shared vocabulary

- **`periodKey`** — `"YYYY-MM"`, a calendar month.
- **School days** — distinct `dateKey`s in the month on which the student's section has **any**
  attendance record (D-#278-safe, via the existing attendance reads). Derived, never configured: holidays,
  closures and Ramadan schedules therefore need no separate calendar.
- **Cohort** — the student's **section** for class average / class best; **all active students** for the
  school-best attendance number only (§5.3). No other metric is compared school-wide.
- **Coverage** — per stream, `settled ÷ total` using the `lifecycleBuckets` state sets: a homework or
  assignment record is settled once it reaches a terminal state (returned / checked / not-submitted /
  absent); a class test is settled once its marks are entered. **Attendance is complete by construction**
  (school days are derived from it) and carries coverage 100%.
- **`provisional`** — true when any stream's coverage is below its gate. It prints on the page.
- **Expected-while-present** — the fairness denominator: items issued on days the student was present.
  Every submission rate uses it; the raw issued count is shown beside it, never instead of it.

### 5.2 Comparators (D-#396)

For each rate the report carries `classAvg` and `classBest`, both **numbers only, never a name**.
`classBest` is suppressed and only `classAvg` shown when the section roster is smaller than
`minSectionSizeForClassBest` (default 5) — in a section of six, "the best" is a person.

Attendance additionally carries `schoolBestDays`: the highest present-day count of **any** student in the
school that month, as a bare number (owner ruling — no class, no name).

The student's **own best month this academic year** is carried for every rate, so a weak student is
measured against themselves as well as the room.

### 5.3 Attendance

`presentDays / schoolDays`, `rate = present ÷ schoolDays`, plus — straight from
`studentProfileAttendance` — `absentLeaveCovered` (an approved/overlapping `StudentLeaveApplication`),
`absentUncovered` (no leave on file), `absentStreakMax`, and a **day-of-week pattern** (the weekday
carrying the most absences, reported only when it accounts for ≥ half the month's absences).

There is **no "late"**: the school does not admit late students (owner, 2026-07-30). No late/partial-day
metric is computed, and none is to be added by analogy with staff partial-day leave (D-#361).

### 5.4 Homework · 5.5 Assignment

Identical shape, computed separately, per subject and totalled, from `studentHomeworkPanel` /
`studentAssignmentPanel` windowed to the month:

`issued` · `expectedWhilePresent` · `submitted` · `submissionRate` · `classAvg` · `classBest` ·
`checked` · `correct` / `partial` / `wrong` · `qualityRate = correct ÷ checked` · `classAvgQuality` ·
`resubmissions` · `notSubmittedDueToAbsence` · `remindersSent` (`chaseCount`) · `coverage`.

A resubmission is **one sheet, not two** (the SP-1 rule) — it is reported as a count beside the row, never
folded into `issued`.

### 5.6 Class test

Per subject: `testsHeld` · `attended` · `absent` · `marksObtained / marksFull` · `rate` · `classAvg` ·
`classBest` (as a percentage, so a 50-mark and a 20-mark test compare) · `unmarked` · `coverage`.

Pulled from `ClassTestSummaryService.studentProfile`. **Marks published by the exam module are not
re-derived here** — a term exam appears as the link in §5.12.

### 5.7 Saturday revision (Hifz)

Sessions · attended · absent · **juz heard** (`amountJuz` summed) · **tanbih / fath** prompts · **tajweed
mistakes** (harf + ghunnah + madd + other) · the latest teacher note. Source `RevisionEntry`; the Qur'an is
deliberately outside the homework tracker (D-#36), so without this section the report would omit half of
what the school teaches.

**Corrected at MR-1:** `RevisionEntry` carries **no evaluation or grade band** — effort, prompts and
structured mistake counts are what it actually stores. The planning sample showed a ভালো/মধ্যম/দুর্বল split;
that field does not exist and is not invented.

### 5.8 Concerns (D-#400)

**A complaint is a `StudentComment` with `sentiment: CONCERN`** — nothing else. Reported as a count per
`type` (ATTENDANCE / STUDY_HOMEWORK / BEHAVIOUR / SERIOUS_MATTER / GENERAL) with the month total, plus the
POSITIVE count beside it so the section cannot read as a charge sheet.

`SERIOUS_MATTER` is **flagged, never narrated by the model** (§7.3) and always surfaces regardless of trend.

### 5.9 Library

Loans taken · returned on time · overdue · still held · year-to-date total.

### 5.10 Guardian participation

**Reminders sent** about this child's work (`chaseCount` summed across both trackers) · **notices sent** to
the child's section or the whole school · whether a **usable phone number** is on file.

**Dropped at MR-1, per the §2 rule — the data does not exist:**

| Planned | Why it is not computed |
|---|---|
| Notices **read** | `GuardianNotice` has no per-family read receipt; `MessageReceipt` belongs to chat messages, not notices |
| Guardian **replies** to reminders | reminders go out over wa.me click-to-send (ADR-003) — there is no inbound leg to count |
| Parent-meeting **attendance** | `ParentMeeting` has `status` (draft/scheduled/closed) and `MeetingComment` is per (meeting × child); neither records who turned up |

Each is a real feature request, not an oversight — they need a field before they can be a number.

**The class teacher's `MeetingComment` does NOT appear on the guardian sheet.** It is explicitly
staff/in-meeting only (J-CM8, D-#124: "never shown in the guardian portal — the guardian shape
structurally cannot reach it"), and a monthly report is not a side door onto it. It is shown on the
**staff view only**, as context for the person reviewing the AI paragraph.

### 5.11 Fees (D-#401)

**Payments only.** Per head and total for the month, plus year-to-date, plus support/waiver from
`FeeSupportAllocation`, plus the latest receipt reference.

**No dues, no balance, no "outstanding".** Finance stores no balances by design (D-#222/#225) and the repo
has no fee-schedule/invoice model, so nothing in the system knows what a child was *supposed* to pay. A
wrong due figure in a guardian's hand is worse than no figure. The sheet says so in one line.

### 5.12 Exam link

If a term exam falls in the month, one line naming it, its date and its report card. No marks are copied.

### 5.13 Cumulative

Every rate additionally carries an **academic-year-to-date** figure, anchored on `AcademicYear` (the
D-#358 default window), not calendar YTD.

## 6. Trend, config, and freshness

### 6.1 The trend rule (D-#395)

Four states, in this order:

1. **`NOT_COMPARABLE`** — either month is below the metric's **minimum sample**. Printed as
   `তুলনাযোগ্য নয়`. This is what stops a short month, a Ramadan schedule or a two-homework subject from
   manufacturing a trend.
2. **`DOWN`** — delta ≤ −threshold → `মনোযোগ প্রয়োজন`
3. **`UP`** — delta ≥ +threshold → `উন্নতি`
4. **`STEADY`** — otherwise → `স্থিতিশীল`

Defaults (all Principal-editable):

| Metric | Compared as | Min sample (**both** months) | Threshold |
|---|---|---|---|
| Attendance | present ÷ school days | 10 school days | ±5 pp |
| Homework submission | submitted ÷ expected-while-present | 5 sheets | ±10 pp |
| Assignment submission | submitted ÷ expected-while-present | 3 items | ±10 pp |
| Quality (HW/AS) | correct ÷ checked | 5 checked | ±10 pp |
| Class test | marks ÷ full marks | 2 tests | ±5 pp |
| Concerns | raw count | — | ±2 |
| Resubmissions | raw count | 3 issued | ±2 |

**Absolute flags, independent of trend:** `absentStreakMax ≥ 3` · `absentUncovered ≥ 3` · any
`SERIOUS_MATTER` concern.

`MonthlyReportConfig` is a `key: "SINGLETON"` document following the `ObservationEscalationConfig` pattern
exactly — **read-time defaults, never seeded by a startup or bulk write against the shared live DB**
(D-#97). Fields: every threshold and min-sample above, `coverageGatePct` (default 80),
`minSectionSizeForClassBest` (default 5), the four window knobs (§6.2), `showFees`, `showClassBest`.

**The config used is frozen into every revision's snapshot** (D-#395). Otherwise a threshold edited in
September silently re-explains a July report that a family has already read.

### 6.2 The calendar (D-#398)

| Day (of the following month) | What happens |
|---|---|
| 1 | Revision 1 auto-generated, status `DRAFT` |
| ~5 | Target release |
| 2–14 | **Revision window** — nightly recompute; changed numbers raise revision N+1 |
| 15–21 | Window closed to auto-recompute; manual recompute still available |
| 21 | **Hard lock** — corrections belong to the next month's report |
| after 21 | Principal-only unlock, with a reason, audited |

### 6.3 Recompute (D-#398)

A nightly **idempotent `/triggers` endpoint** (shared secret, the AT-4/D-#65 pattern), **not** an
in-process cron and **not** a write hook on every tracker mutation. It recomputes every open report for
the closed month, diffs against the current revision, and raises a new revision only when a **reported
number** changes (a re-render with identical numbers must not create a revision, or the office drowns in
re-release prompts).

## 7. The document, its revisions, and its release

### 7.1 Model

`MonthlyReport`, unique on **`(studentId, periodKey, revision)`**.

**Corrected at MR-3:** the contract first said one row per (student × month). It cannot be — a released
revision has to stay byte-stable while the next one is being built, and one row would mean editing the
document the family is currently reading. **A revision is its own row**; at most one may be `RELEASED` at a
time, and releasing a newer one stamps the older `SUPERSEDED`. The unique index is also the concurrency
guard: two nightly sweeps racing cannot both write "revision 2".

Fields: `status` · `revision` · `snapshot` (**the frozen computed numbers, the frozen config, and both
comments**) · `dataAsOf` · `coverage{homework, assignment, classTest}` · `provisional` ·
`commentDraft{text, model, promptVersion, promptHash, generatedAt}` · `commentFinal` · `reviewedBy/At` ·
`releasedRevision` · `releasedAt/By` · `releaseBatchId` · `changeLog[]` (what changed between revisions).

### 7.2 States (D-#393)

```
DRAFT ──ready──> READY ──release──> RELEASED
  ^                                    │
  └──── new data raises revision N+1 ──┘   (N stays RELEASED and visible)
RELEASED ──superseded by a released N+1──> SUPERSEDED
RELEASED ──revoke (Principal)──> DRAFT (guardian loses access; audited)
```

**A released revision is immutable.** Late data never edits it — it creates revision N+1 in `DRAFT`
alongside it, and the guardian keeps seeing revision N until someone releases N+1. The staff view badges
the report `সংশোধিত` and shows the `changeLog` diff, so the office can see *why* re-release is being
asked of them. Silently changing a number a family has already read is the one failure this feature
cannot survive.

### 7.3 Release (D-#397)

- **Office and Principal** both release and re-release, individually or in bulk.
- **Bulk release** takes a section / class / whole-school selection, shows a count and a per-student
  exclusion list, and writes **one `releaseBatchId`** so a wrong bulk release is revocable as a batch.
- **Release is blocked while `provisional`** (any stream below `coverageGatePct`). **Principal only** may
  override, with a reason, audited.
- **Revoke** and **unlock-after-hard-lock** are Principal only.
- Every release, re-release, override, revoke and unlock writes an audit row (ADR-008).
- New permission **`report:release`** — Principal + Office. This is a **two-place contract sync**:
  `/shared/vocab.ts` + the role→permission map + the harness, then the vocab verifier
  (`/skills/contract-sync`). Reading a report needs no new permission — it rides the existing
  `assertReportRead` + guardian gates.

### 7.4 The AI comment layer (D-#399)

**One AI paragraph per report — the overall guardian summary. Nothing else.** Per-section chips
(`উন্নতি` / `স্থিতিশীল` / `মনোযোগ প্রয়োজন` / `তুলনাযোগ্য নয়`) are **rule-based from §6.1** — cheaper,
deterministic, and incapable of contradicting the table above them.

Five conditions on the generation:

1. **De-identified prompt.** The model receives numbers, subject codes, class level and trend states —
   **never the name, school ID, guardian name or phone**. The name is spliced in locally at render. This
   keeps the outbound flow free of identity regardless of which provider or tier is used.
2. **The model never authors a number.** Facts are computed and passed as JSON; the model writes prose
   over them. **A validator rejects any output containing a numeral that does not appear in the facts
   JSON**, and retries once before falling back. Hallucinated statistics in a guardian's hand are the
   reputational failure mode here.
3. **Template fallback.** On API failure, validator failure twice, or reviewer rejection, the comment
   falls back to a `MessageTemplate` rendering (MT-1, D-#131). The report never blocks on an external API.
4. **Human review is a release precondition.** `commentFinal` must be either edited or explicitly accepted
   by a named user (`reviewedBy`) before `READY`. A regenerated draft clears the review.
5. **Provider-agnostic seam.** `docs/architecture.md` §14 already parks exactly this ("provider-agnostic
   AI layer — Gemini for high-volume"). v1 targets **Gemini Flash** via `GEMINI_API_KEY` in `.env`
   (never committed), behind an interface with one method, so a provider swap is a config change.
   Volume is ~1 call per student per month.

Prompt rules, pinned: Bangla, respectful address, 2–4 sentences, exactly one actionable suggestion for
home, **never compare to a named peer**, never diagnose a child, never speculate about the family, and
**never narrate a `SERIOUS_MATTER` concern** — that routes to a human meeting, and the paragraph says only
that the class teacher will make contact.

Every draft stores `model`, `promptVersion` and `promptHash`, so a bad batch is traceable to the prompt
that produced it.

## 8. The sheet (PDF)

Markdown → the existing `markdownToPdf` engine. **A full sample with fake data was rendered through this
exact engine during planning** — three A4 pages at `fontScale 0.92`, `margin 38`, tables of ≤ 7 columns
(the renderer's weighted columns get cramped beyond that). Section order and layout follow that sample.

The page carries, always: the status + revision + `dataAsOf` band at the top; the release-blocked reason
when provisional; the trend appendix (§6.1 thresholds as used); who printed it and when; and the sentence
that a later revision must be re-released to be seen.

**Prerequisite (separate change):** the middle dot `·` renders as `.notdef` boxes in this engine — the
Noto Bengali subset lacks U+00B7 and `pdfRenderer.ts` does not transliterate it, so it inherits the
Bengali run. It is used as a separator by `StudentProfileSheetService` and `englishDrivePdf.ts` today.
Fix in `strongFont()` (treat U+00B7 as a Latin run) **before** this feature's sheet is written, as its own
one-line change.

Delivery: in-app to the guardian, the wa.me + notification rails from `CommentDeliveryService`, and paper
through the existing `PrintRequest` queue (D-#281) — no new print path.

## 8b. The Desktop round trip (MR-8, D-#415)

A second lane to the same field. The in-app model (MR-4) writes `commentDraft`; so does
this. Nothing downstream knows the difference, and neither lane can release anything on
its own.

**Why it exists.** The free tier rate-limits mid-class, the paragraph it writes is
serviceable rather than good, and the school already authors its curriculum this way
(`docs/import-workflow.md`). This is that workflow pointed at comments.

### 8b.1 Export — Markdown, de-identified

`GET /export/monthly-comments?sectionId=&periodKey=` (or `?all=1` for the school,
D-#414) streams a `.md` file: the instruction block first — the SAME rules as the MR-4
prompt, kept in one place so the two lanes cannot drift — then one fenced block per
child.

**No name, no roll, no phone leaves the building.** Each block is keyed by
`reportId` and carries the same whitelisted facts `commentFactsOf` builds, because a
file that goes into a chat window is a wider exposure than an API call, not a narrower
one. The reviewer sees ids in Desktop and names in the console; the app re-attaches
them on the way back.

Every block also carries `revision` and `figuresHash` — see §8b.4.

### 8b.2 Return — JSON, not prose

```json
{ "periodKey": "2026-07", "sectionId": "…", "comments": [ { "reportId": "…", "text": "…" } ] }
```

Markdown back would mean parsing prose, and the first stray heading breaks it. The
envelope is validated on arrival: unknown `reportId`, wrong `periodKey`/`sectionId`,
duplicate ids and missing text are all refusals that NAME the row, never silent drops.

### 8b.3 The guards run again, in full

An uploaded comment is unverified text. That a person pasted it does not make its
numbers real, so on import each one faces exactly what a generated draft faces:

- `validateNumerals` against **that report's own facts**;
- `looksLikeProse` (length, no JSON debris, ends on a danda);
- the report must be writable — a `RELEASED` or `SUPERSEDED` revision is refused,
  because a released document is immutable (D-#393).

A row that fails is reported with its reason and its `reportId`; the rest still import.

### 8b.4 Bound to the revision

The export stamps `revision` and `figuresHash` (a hash of `reportedFigures`). On
import, a report whose figures have moved since the export is **refused**: a mark that
landed in between means the comment describes numbers nobody will ever see. Without
this the feature quietly reintroduces the drift the freeze rule exists to prevent.

The remedy is stated in the refusal: rebuild, re-export, redo those rows.

### 8b.5 It is still a draft

An imported comment lands as `commentDraft` with `source: "IMPORT"`, and a person
still presses accept in the app (owner ruling, D-#414). One rule holds for both lanes:
**nothing is released that a person has not accepted in the app.** Treating the upload
itself as the review would mean the release gate could be satisfied by a file.

Bulk-accept for a section exists so this is one press, not twenty-one.

## 9. Notification

On **release**: a notification + wa.me line saying the month's report is available.
On **re-release**: a *different* body naming it a revision (`সংশোধিত`), so a family is never silently
handed different numbers under the same message.
No notification on draft, recompute, or revocation of an unreleased revision.

## 10. Slices

| Slice | Delivers | Verified by |
|---|---|---|
| **MR-1** | Snapshot compute (server only): month window, school days, every §5 metric, cohort comparators, coverage. Confirms the three unverified models. | jest — pure metric tests + windowing + narrowing |
| **MR-2** | Trend engine + `MonthlyReportConfig` + config frozen into the snapshot | jest — every state incl. `NOT_COMPARABLE` at the boundary |
| **MR-3** | `MonthlyReport` model, revisions, state machine, `changeLog`, audit, `report:release` (contract sync + verifier) | jest + vocab verifier |
| **MR-4** | AI seam: facts JSON, de-identification, numeral validator, template fallback, review fields | jest — validator rejects an invented numeral; fallback fires |
| **MR-5** | Staff UI: per-class console, coverage chips, comment review, release / bulk release / revoke | app typecheck + expo export + **live drive** |
| **MR-6** | Guardian read (released revisions only) + release/re-release notifications | jest RBAC + live drive |
| **MR-7** | PDF + print queue + the Principal's class-level roll-up | rendered sheet eyeballed |
| **MR-8** | The Desktop round trip: de-identified Markdown export (section or whole school), validated JSON import, same guards, revision-bound | jest — a moved figure is refused; an invented numeral is refused; a released revision is refused |

MR-1..MR-4 are server-only and land without any UI. MR-5 is the first slice a person can see.

## 11. Acceptance criteria

1. A report for a month with an unchecked assignment pile is `provisional`, **cannot be released** by the
   Office, prints the reason, and releases after the Principal overrides with a reason (audited).
2. Marks entered on the 9th raise revision 2; the guardian still sees revision 1 until someone releases
   revision 2; the staff view shows what changed.
3. A revision whose recompute changes no reported number does **not** create a new revision.
4. A released revision cannot be edited by any path, including recompute.
5. A month with 6 school days shows `তুলনাযোগ্য নয়` for attendance, not a −40 pp collapse.
6. A section of 4 shows class average and **no** class best.
7. No output anywhere in the report contains another student's name.
8. A subject teacher's sheet shows only their subjects, says so, and shows **no** AI paragraph.
9. A guardian can open only released revisions of their own child; the staff-only fields are unreachable.
10. An AI draft containing a numeral absent from the facts JSON is rejected; after two failures the
    template fallback is used and the report is still releasable.
11. Bulk-releasing a class writes one `releaseBatchId`; revoking that batch removes guardian access from
    exactly those reports.
12. The fee block is absent from a teacher's view and present for Principal, Office and the guardian.
13. `SERIOUS_MATTER` is flagged on the page and absent from the generated paragraph.
14. The firewall test still passes; the corpus plane imports nothing added here.

## 12. Decisions appended (`DECISIONS.md`)

D-#393 the document + freeze-on-release · D-#394 denominators, coverage, provisional · D-#395 the trend
rule + frozen config · D-#396 comparators · D-#397 release authority + bulk + revoke · D-#398 the calendar
+ recompute trigger · D-#399 the AI layer · D-#400 complaint = CONCERN · D-#401 fees paid, no dues ·
D-#402 scope + relationship to the exam report card.

## 13. Open questions (do not block MR-1)

1. Bangla only, or a bilingual sheet for the record?
2. Does Nursery/KG want the same section list, or a shorter sheet (no class test, no assignment)?
3. Should a guardian see the class average at all for Nursery, where the cohort is tiny?
4. Fee **dues** — worth a fee-schedule model as its own feature later? (Owner: "we will do it later.")
5. Should the class-level roll-up (MR-7) also go to the class teacher, or Principal only?
6. MR-8: should a whole-school export split into one file per section inside a zip, or one long file? (Starting with one file per request; `?all=1` concatenates.)
