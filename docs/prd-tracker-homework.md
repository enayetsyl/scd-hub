# PRD — Homework Tracker (daily HW-… channel)

**Status:** DRAFT (source LOCKED — `docs/tracker-homework-handoff.md`) · **Owner:** Principal
**Scope:** the daily Homework Tracker inside SCD Hub's existing `homework` tracker-kind — an
**operational-plane** feature (Layer-A item declaration → 6-stage per-student lifecycle → daily budget
reconciliation + trim log → resubmission/Pool top-up → roll-ups into `trackerSummary`). It rides the
**existing tracker-kind**: **no new tracker-kind, no vocab/schema/harness three-place sync** (D-013;
restated by the handoff §0/§12). All per-student data sits behind the PII firewall (ADR-005); only
de-identified aggregates cross to the corpus.

This file is the **build contract**: it turns the LOCKED Project-06 handoff
(`docs/tracker-homework-handoff.md`) into per-role journeys with **testable acceptance criteria** and a
**slice-by-slice build order**, written so they seed the verifier/test gate directly (Jest+Supertest for
resolver/authz, the fail-closed firewall test, and — later — Maestro e2e for golden paths). Traceability
tags point back to the handoff (`§n`), `DECISIONS.md` (`D-#nn`), and the ADRs in `docs/architecture.md`.

> **Single source of truth:** the *spec* lives in `docs/tracker-homework-handoff.md` (the Project-06
> consult-via-human handoff, LOCKED v1.1 incl. Amendment A-01). This file is the *build contract*. When
> they disagree, the **handoff wins** — fix this file. Adoption decisions D-#33–#35 are authoritative in
> `DECISIONS.md`.

---

## 1. Goal
Make the daily homework channel real end-to-end: the subject teacher **declares** one common sheet per
subject per day (numbered HW-…, topic-tagged TOP-…, with a declared minute cost); the class teacher
**reconciles** the day's total against the uniform **240-min ceiling**, trimming by question count (never
time) with an immutable trim log, then **issues**; each per-student copy then runs the ratified **6-stage
lifecycle** (Given → Absent/Re-deliver → Due → Submitted/Chase → Checked/Resubmit+Top-up → Returned),
with WRONG results spawning a same-ID resubmission that may carry a Pool-selected top-up; and the whole
thing **rolls up** into `trackerSummary` for the dashboards — all on the identity plane, with the
ADR-005 firewall provably closed.

## 2. The gap (handoff §1 "ratifies and completes" vs. what's actually built)
The Slice-3 build (`server/src/modules/trackers/`) is the **bare generic tracker**: `TrackerRecord` =
one doc per `set × section`, per-student entries de-identified (sha256), HW field = a single
`complete: boolean`. The handoff's homework-specific machinery is **largely unbuilt**.

| Handoff requirement | Built today | Slice |
|---|---|---|
| §3 6-stage lifecycle (FIRM), timestamped, resubmission-spawning | ❌ one `complete` boolean | **T1** |
| §2.1 Layer A — `HomeworkItem` (HW-ID, TOP-tags, TIME_DECL, Q_COUNT, POOL_REF, REV_ITEM, SESSION_REF) | ❌ no item layer | **T1** |
| §2.2 Layer B — per-student lifecycle record (STATE, STATE_DATES, CHASE_COUNT, RESULT, RESUB_OF, TOPUP_*) | ❌ | **T1** (+ T3 for TOPUP) |
| §2.3 / §4 Layer C — daily reconciliation + 240 ceiling gate + trim log (ক/খ/গ, from/to, minutes) | ❌ | **T2** |
| §6 cadence — Sun–Thu issue, Fri/Sat hard-block, Thursday light path | ❌ | **T2** |
| §5 resubmission + Pool top-up (4 boundaries) + per-child day-load | ❌ | **T3** |
| §7 thresholds — chase 2/3, resubmission watch-list ≥3 / 2 wk, trim >30%/mo | ❌ | **T4** |
| §8 `trackerSummary` roll-ups (touches-per-topic, chase list, completion health, trim patterns, day-load) | ⚠️ counts/avg only | **T4** |
| §8.4 question-usage feed (de-identified) | ❌ | **T4** |
| §9 plane split + ADR-005 firewall | ✅ pseudonym + `CorpusEvent` pattern exists — **extend, keep green** | every slice |
| §2 Bangla labels + English codes | ⚠️ only `homework: "বাড়ির কাজ"` | every slice |
| §9 RBAC — class-teacher-only reconcile/confirm; subject-teacher declare/check own | ⚠️ `tracker:write` exists; no role split for reconcile-confirm | T2 + cross-cut |

## 3. Roles & scope (handoff §9 mapped to the existing role set)
**No new auth roles** (D-#17 principle). The reconcile-confirm authority is a **row/action-scope rule on
the existing `tracker:write`**, not a new permission, unless the build proves otherwise during T2 (flag
to the Principal if it does — that would be a contract change).

| Role / overlay | In this feature | Primary jobs |
|---|---|---|
| **Subject teacher** (TEACHING scope) | Declare + check **own subject** | Create Layer-A items (declaration), record `RESULT` at Checked, select Pool top-ups, work the resubmission queue. |
| **Class teacher** (the daily-coordinator) | **Only** role that runs §4 reconciliation + confirms issue | Tally `DAY_TOTAL`, drive the trim workflow, confirm → spawn per-student records. (REF-08 §2.3/§9.) |
| **Principal** | Read-everything + §8.3 | Weekly load roll-up, completion health, touches-per-topic, trim patterns, watch-list. |
| **Subject Lead** (SUPERVISORY scope) | Read trim-patterns + substitution review (read-only, D-#17) | The §7.4 trim-pattern flag view. No declare/reconcile. |

**Plane/firewall (handoff §9, ADR-005):** Layer-B records, chase counts, results, resubmission histories,
reconciliation/trim logs are **operational/identity-bearing**. Only **aggregates** cross to corpus
(per-question usage counts, per-topic touch counts, anonymized completion/trim stats). The J5.6
fail-closed firewall test **must stay green** after every slice.

## 4. Build-step → slice map (recommended build order)
Each slice ships its journeys' acceptance criteria as tests (`/skills/feature-lifecycle`), green under the
gate before the next. No three-place contract sync (existing tracker-kind) — but **every new field gets
its Bangla label + English code** per handoff §2, and any *truly* new controlled vocab (e.g. an
`HW_LIFECYCLE_STATE` enum, a `RESULT` enum) is an **app-native vocab addition in `/shared/vocab.ts`** with
`*_LABELS_BN` (NFR-5) — not a wire-contract enum, so **no envelope-schema/harness sync**, but `/shared`
build + the vocab verifier still run.

| Slice | Build-step | Journeys | Dependency gate |
|---|---|---|---|
| **HW-T1** | Data model + 6-stage lifecycle (handoff §2, **§3 FIRM**) | T1.* | Foundation everything hangs off. Lifecycle built **once, shared with the Assignment tracker**. No external dep. |
| **HW-T2** | Daily budget reconciliation + trim log + cadence (handoff §4, §6, §2.3) | T2.* | Needs T1 (Layer-A items to tally). Class-teacher reconcile-confirm action-scope. |
| **HW-T3** | Resubmission + Pool top-up (handoff §5) | T3.* | Needs T1 (lifecycle stage 5) + the Slice-2 question store (Pool QP-… read, D-028 ≥20 floor). |
| **HW-T4** | Roll-ups + thresholds + question-usage feed (handoff §7, §8) | T4.* | Needs T1–T3. Extends `trackerSummary`; de-identified corpus aggregates only. |
| (cross-cut) | RBAC row/action-scope + plane split + firewall | T5.* | Verified in **every** slice above; the J5.6 firewall test stays green throughout. |
| (later, optional) | App screens (handoff §8.1/§8.2 views) | — | After the server contract is green; mirrors the Slice-4 frontend pattern. |

## 5. Journeys & acceptance criteria
Written Given/When/Then. Each maps to one or more handoff §12 checklist items (the adoption gate).

### T1 — Data model + 6-stage lifecycle  *(handoff §2, §3; slice HW-T1)*
> **Status: BUILT** (D-#36/#37) — vocab + lifecycle engine + calendar + Layer-A/B/sequence models +
> `HomeworkService` + GraphQL wired; gate green (vocab verifier, shared+server tsc, jest 154/154, firewall
> J5.6 green). Not yet committed; not verified live. Covers §12 #2/#3/#8/#9 + partial #1.
- **T1.1 Declare a Layer-A `HomeworkItem`** *(§2.1, §4.1)* — Given a subject teacher on a school night
  (Sun–Thu), When they declare, Then one **common** item persists with `HW_ID`
  (`HW-{class}-{SUBJECT}-{nnnn}`, year-continuous per class+subject, 4-digit, year-reset), `DATE_GIVEN`,
  `CLASS`, `SUBJECT`, **≥1 `TOP_TAGS`** (`TOP-{SUBJECT}-C{class}-{nn}`, never empty), `TIME_DECL` (0–40
  band, default 20, 0 valid), `Q_COUNT`, `POOL_REF`, `REV_ITEM`, `SESSION_REF`. **No per-student variant
  is creatable.** → checklist #2, #8.
- **T1.2 The 6-stage lifecycle exists exactly as §3** *(§3 FIRM)* — Given an issued item, When a
  per-student record transitions, Then it moves only along the legal edges (`GIVEN`→`DUE` overnight;
  absence → `ABSENT_REDELIVER` then re-deliver; `DUE`→`SUBMITTED`|`CHASE`; `SUBMITTED`→`CHECKED`;
  `CHECKED`→`RETURNED`); **every transition is timestamped** in `STATE_DATES`; illegal skips are rejected.
  → checklist #3.
- **T1.3 Lifecycle is built once and shared with the Assignment tracker** *(§3, §1)* — Given the lifecycle
  component, Then it is implemented as a single reusable unit (state set + transition guard + timestamp
  trail) consumable by both `homework` and (future) `assignment` kinds — not duplicated. → checklist #3.
- **T1.4 Absent-on-given shifts the due date** *(§3 stage 2)* — Given a student absent at issue, When they
  next attend, Then the record re-delivers and proceeds as Given with the due date shifted (**default =
  next school night**; the ADR's documented rule). → checklist #3.
- **T1.5 Bangla labels + English codes** *(§2)* — Given any rendered Layer-A/B field, Then it carries its
  Bangla label and English code per the §2 tables (codes on forms/trackers, NFR-5). → checklist #9.

### T2 — Daily budget reconciliation + trim log + cadence  *(handoff §4, §6, §2.3; slice HW-T2)*
> **Status: BUILT** (D-#41) — `HomeworkReconciliation` (Layer C) + `HomeworkReconciliationService`
> (tallyDay / getTrimCandidates / applyTrim / confirmHomeworkDay) + GraphQL; gate green (vocab verifier,
> shared+server tsc, jest, firewall green). Covers §12 #4/#5/#7/#8. **Class-teacher-only reconcile now
> enforced** — `Section.classTeacherId` + `assignClassTeacher` + `assertIsClassTeacher` gate on
> `trimHomeworkItem`/`confirmHomeworkDay` (D-#42, resolves the earlier open item).
- **T2.1 Live `DAY_TOTAL` tally** *(§4.2)* — Given declarations landing for a class+day, Then `DAY_TOTAL` =
  sum of `TIME_DECL` across subjects that **met today**, recomputed live, shown vs the 240 ceiling with a
  clear over/under state. → checklist #4.
- **T2.2 Over-ceiling hard-blocks issue** *(§4.3, §7.1)* — Given `DAY_TOTAL > 240`, When the class teacher
  tries to confirm/issue, Then issuing is **blocked** until reconciled; `DAY_TOTAL ≤ 240` → confirm
  succeeds and per-student records spawn (`GIVEN`/`ABSENT_REDELIVER`). **Never silently issue
  over-ceiling.** → checklist #4.
- **T2.3 Trim by question count, never time, in ক→খ→গ order** *(§4.4, D-030)* — Given an over-ceiling day,
  When the class teacher trims, Then the system offers (a) revision items (`REV_ITEM=Y`) first, then (b)
  `Q_COUNT` reductions on the lightest subjects **sorted ascending by `TIME_DECL`**, then (c) zeroing a
  subject (`TRIM_TO=0` permitted); reducing `Q_COUNT` reduces `TIME_DECL` proportionally; **no path
  extends time**. → checklist #4, #5.
- **T2.4 Immutable trim log** *(§2.3, §4.5)* — Given a confirmed reconciliation, Then each cut is a trim-log
  row (`TRIM_HW`, `TRIM_RANK` ক/খ/গ, `TRIM_FROM`/`TRIM_TO`, `TRIM_MIN`) and the reconciliation closes
  (`RECON_STATE = reconciled`); **trim rows are immutable** thereafter. → checklist #5.
- **T2.5 Band warns, sum blocks** *(§4 closing)* — Given a single subject's `TIME_DECL > 40`, Then the
  system **warns** but does **not** block (legitimate on reduced-roster days); only the day-sum > 240
  blocks. → checklist #4.
- **T2.6 Cadence + Thursday light path** *(§6.1, §6.2)* — Given a Friday or Saturday, Then HW-… issuing is
  **hard-blocked**; Given Thursday, Then the light roster still declares/tallies/reconciles like any night
  (not a zero-homework day). → checklist #7.
- **T2.7 One common sheet enforced** *(§4.1)* — Given any declaration/issue path, Then no per-student item
  variant can be created (the only per-student divergence is the §5 top-up). → checklist #8.

### T3 — Resubmission + Pool top-up  *(handoff §5; slice HW-T3)*
- **T3.1 `RESULT` recording + auto-spawn** *(§2.2, §3 stage 5)* — Given a record at `CHECKED`, When
  `RESULT = ভুল (WRONG)`, Then a resubmission record auto-spawns (`RESUB_OF` set, **same `HW_ID`**, its own
  1→6 pass); `আংশিক (PARTIAL)` spawns only at the teacher's judgment; `সঠিক (CORRECT)` advances to
  `RETURNED`. → checklist #3, #6.
- **T3.2 Top-up boundary 1 — selected, never authored** *(§5.1, D-028)* — Given a top-up, Then `TOPUP_QIDS`
  may reference **only** existing questions in the topic's ≥20-question Pool (QP-…) in the question store;
  **no free-text** question entry. → checklist #6.
- **T3.3 Top-up boundary 2 — reactive only** *(§5.2)* — Given any top-up, Then it attaches **only** to a
  record with `RESUB_OF` set; there is **no pre-scheduling** UI/path. → checklist #6.
- **T3.4 Top-up boundary 3 — time-counted + visible day-load** *(§5.3)* — Given `TOPUP_TIME`, Then it counts
  toward that child's personal daily load, surfaced in the teacher view (the child may personally exceed the
  ceiling — accepted; it must be a visible choice). → checklist #6.
- **T3.5 Top-up boundary 4 — inside the resubmission stage, same ID** *(§5.4)* — Given a top-up, Then it
  rides the resubmission record (`TOPUP_FLAG=Y`, same `HW_ID`, its own due/submitted/checked pass) — **not a
  new stream**. → checklist #6.

### T4 — Roll-ups + thresholds + question-usage feed  *(handoff §7, §8; slice HW-T4)*
- **T4.1 `trackerSummary` extended** *(§8.1–8.3)* — Then it exposes: per-subject declarations + live
  `DAY_TOTAL` vs 240; chase list (records in `CHASE` with counts); open resubmissions; **per-child day-load
  incl. `TOPUP_TIME`**; submitted-on-time %, chase volume, return latency (Given→Returned); **touches per
  TOP-… tag** (zero extra logging); weekly load roll-up per class. → checklist #10.
- **T4.2 Chase thresholds** *(§7.2, A-01)* — Given `CHASE_COUNT = 2` → record surfaces on the class
  teacher's attention list; `= 3` → a parent-comms prompt surfaces and sends via the existing wa.me path
  (no in-build wording authored). → checklist #10.
- **T4.3 Resubmission watch-list** *(§7.3, A-01)* — Given a student with **≥3 open/recent resubmissions in a
  rolling 2-week window**, Then they surface on the Master watch-list (alongside, not replacing, D-025
  flags). → checklist #10.
- **T4.4 Trim-pattern flag** *(§7.4, A-01)* — Given a subject trimmed on **>30% of school days in a month**,
  Then it is flagged in the principal/Subject-Lead view. → checklist #10.
- **T4.5 Question-usage feed, de-identified** *(§8.4, ADR-005)* — Then per-question Pool usage counts (which
  HW-… used which qids, when) cross to corpus as **aggregates only** — no student identity. → checklist
  #10, #11(plane).

### T5 — RBAC, plane split & firewall  *(cross-cutting; handoff §9; verified every slice)*
- **T5.1 Class-teacher-only reconcile/confirm** *(§9)* — Given a subject teacher (not class teacher), When
  they attempt §4 reconcile/confirm-issue, Then it is denied; the class teacher succeeds. → checklist #4.
- **T5.2 Subject-teacher scope** *(§9)* — Given a subject teacher, Then they may declare + check **their own
  subject** only. → checklist #1 boundary.
- **T5.3 Subject Lead read-only** *(§9, D-#17)* — Given a Subject Lead, Then they read trim-patterns +
  substitution review only; no declare/reconcile/check write. → checklist #9-RBAC.
- **T5.4 Fail-closed firewall stays green** *(ADR-005, J5.6)* — Then no homework analytics/export resolver
  joins a Layer-B/reconciliation/trim row to identity; the existing fail-closed firewall test keeps
  passing after every slice. **← non-negotiable.** → checklist #11.
- **T5.5 No new tracker-kind / no contract sync** *(§0, D-013)* — Then HW-… rides the existing `homework`
  tracker-kind; the envelope schema + harness are untouched (only app-native `/shared/vocab.ts` additions,
  verified by the vocab verifier). → checklist #1.

## 6. Out of scope (this feature)
- **Assignment tracker AS-…**, Quran muraja'ah discipline, exit-check/D-025 flags, question authoring, the
  Pool itself, REF-07 revision scheduling, the Master dashboard's full spec — all per handoff §1/§10.
- **Parent-comms wording** — Project 06 delivers it (REF-12 §7); the feature only raises the trigger and
  sends via the existing wa.me path.
- **App screens** beyond the server contract are a later slice (handoff §8.1/§8.2 views).

## 7. Reused / unchanged
- **`TrackerRecord` + `homework` tracker-kind** (Slice 3) — extended, not replaced; no new kind (D-013).
- **De-identification + `CorpusEvent`** (ADR-005) — the existing pseudonym/corpus-event pattern carries the
  de-identified aggregates; firewall test reused and kept green.
- **Question store** (Slice 2) — Pool QP-… read-only for top-up selection (D-028 ≥20 floor).
- **`tracker:write` + `assertCanWrite`** (ADR-004/017) — reconcile-confirm is an action/row-scope rule on
  it; **no new permission** unless T2 proves one is needed (flag to Principal — would be a contract change).
- **wa.me deep-link builder** (`buildNonSubmitterLink`, ADR-003) — reused for the chase=3 parent-comms
  prompt.
- **`AcademicYear`** — drives the year-continuous `HW_ID` numbering + year-reset.

## 8. Open items routed to the Principal (consult-via-human, handoff §10)
None of the handoff's §11 items remain open (closed by Amendment A-01). Build-time questions to route:
- ~~If T2 finds reconcile-confirm cannot be expressed as action-scope on `tracker:write` and needs a new
  permission → contract change, route to the Principal.~~ **RESOLVED (D-#42):** the Principal chose to add a
  `Section.classTeacherId` designation (assigned via the existing `roster:manage`); reconcile/confirm is
  class-teacher-only via `assertIsClassTeacher`. No new permission was needed.
- The pre-class-test top-up window (§5) depends on whether the build can read the Class Test schedule; if
  not, leave it to teacher judgment (do not block) — confirm at T3.
- Any pupil-/parent-facing wording must obey the D-049 materials rule (খাতা/পেনসিল/কলম; whiteboard+marker).
