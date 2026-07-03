# PRD — Homework Check Grid (one-tap outcome recording, HWG-1..HWG-2)

**Status:** Draft for build — approved by Principal 2026-07-03
**Owner:** Principal (SCD)
**Scope:** ONE new composite server mutation (`recordHomeworkOutcome`) + rework of the app Checking screen into an attendance-style outcome grid. No schema/model change, no new permission, no vocab/contract sync.
**Traceability:** D-#267 (this design). Builds on: homework lifecycle (§8.2, `lifecycle.ts` edges), pending-by-date Phase 1 (`homeworkOpenRecords`, `groupByDate` — STATUS 2026-07), ENH-002 proxy subject narrowing, D-#63 (absent-only attendance — the interaction pattern this copies), UX program D-#265/#266 (R-Feedback/R-Confirm rules apply as those slices land).

---

## 0. Quick checklist (read this first)

- [ ] Two slices, built in order: **HWG-1 (server) → HWG-2 (app)**. One PR each, off `dev`. Server layer before app screens (house rule).
- [ ] HWG-1 adds ONE mutation that internally reuses the existing lifecycle transition + check services — it must NOT duplicate edge logic or skip audit rows.
- [ ] `outcome` travels as a **String** arg validated server-side (house pattern, same as `toState`/`result`) — NO new GraphQL enum, NO `shared/vocab.ts` change, NO mirrored-enum sync.
- [ ] Existing mutations (`transitionHomeworkRecord`, `checkHomeworkRecord`) stay untouched — the Records screen keeps using them.
- [ ] Route name `CheckingQueue` is kept (house rule: route names unchanged); the screen's content is rebuilt.
- [ ] Gate per slice: HWG-1 = server `tsc` + focused jest suite + full jest green + vocab verifier PASS (untouched); HWG-2 = app `tsc --noEmit` + `expo export --platform web` + the §4.2.5 manual checklist on phone-width AND ≥1024px web.
- [ ] All new user-facing strings → `STR` in `app/src/lib/labels.ts`, Bangla + English.

---

## 1. Goal

Recording a homework outcome currently takes three interactions across two screens per student: mark DUE (Records) → mark SUBMITTED (Records) → switch to Checking queue → pick a result. In a real classroom the teacher observes everything in one glance per child: the khata is correct, partial, wrong, or not there. This PRD collapses data entry to match reality: **one tap per student** on a roster grid — ঠিক / আংশিক / ভুল / দেয়নি — with the lifecycle fast-forwarded legally and atomically behind the tap. DUE is a calendar artifact, not a teacher decision; the teacher never touches it again on the happy path.

## 2. Gap table

| # | Gap | Impact | Slice |
|---|---|---|---|
| G1 | One observed fact (a child's homework outcome) requires 3 mutations entered manually in sequence, across Records + Checking screens. | Slowest daily tracker task; teachers skip steps, records stall in GIVEN/DUE | HWG-1/2 |
| G2 | The GIVEN→DUE transition is manual although it encodes no decision (the due date arriving). | Pure busywork; stalled records distort chase/rollup counts | HWG-1 |
| G3 | Checking queue lists only SUBMITTED records — a teacher checking in class can't act on the GIVEN/DUE/CHASE rows sitting in front of them. | Forces the Records↔Checking screen shuttle | HWG-2 |
| G4 | App-chained multi-mutation alternatives would leave half-advanced records on mid-chain failure. | Data hygiene | HWG-1 (atomic composite chosen — D-#267) |

## 3. Design

### 3.1 Server — HWG-1: `recordHomeworkOutcome`

**Mutation (GraphQL, args as Strings per house pattern):**
```
recordHomeworkOutcome(
  sectionId: ID!, recordId: ID!,
  outcome: String!,            # CORRECT | PARTIAL | WRONG | NOT_SUBMITTED (server-validated)
  resubmit: Boolean,           # PARTIAL only, same semantics as checkHomeworkRecord
  topupQids: [String!],        # same as checkHomeworkRecord
  topupTime: Int
): HwOutcomeResult!            # { record, resubmission? } — same shape family as HwCheckResult
```

**Behavior (all inside one service call, atomic):**
1. Gate exactly as the existing transition/check path: `tracker:write` + `assertCanWrite(section)` + ENH-002 proxy subject narrowing. No new permission.
2. Legal fast-forward from the record's current state, reusing the lifecycle service edge-by-edge (each internal transition writes its normal append-only audit row):
   - `CORRECT | PARTIAL | WRONG`: GIVEN→DUE→SUBMITTED, DUE→SUBMITTED, CHASE→SUBMITTED, SUBMITTED→(no-op) — then apply the existing check logic verbatim: WRONG auto-spawns a resubmission; PARTIAL spawns only when `resubmit=true`; top-ups as today.
   - `NOT_SUBMITTED`: GIVEN→DUE (if needed) then DUE→CHASE or CHASE→CHASE, with semantics identical to today's transition (no new messaging side-effects).
3. Reject with a domain error (surfaced via the D-#256 maskError whitelist) when the record is in `ABSENT_REDELIVER`, `CHECKED`, `RESUBMIT`, or `RETURNED` — those flows stay on the Records screen — or when `outcome` is not one of the four values.
4. `transitionHomeworkRecord` and `checkHomeworkRecord` remain untouched and in use.

**Jest (focused suite `homeworkOutcome.test.ts`):** each outcome from each legal start state (GIVEN/DUE/CHASE/SUBMITTED); audit row per internal edge; WRONG auto-resubmission preserved; PARTIAL resubmit flag honored; top-up carry; illegal-state and bad-outcome rejections; section-scope deny; proxy subject-narrowing deny/allow.

### 3.2 App — HWG-2: the Check Grid (rebuilt `CheckingQueueScreen`)

**Data:** `homeworkOpenRecords(sectionId, classId, states: [GIVEN, DUE, SUBMITTED, CHASE, CHECKED, RESUBMIT, ABSENT_REDELIVER])` — the existing read; grouped by `dateGiven` via `groupByDate`, and within each date by homework item (subject · hwId header).

**Row rendering (per student under each item):**
- Actionable states (GIVEN/DUE/SUBMITTED/CHASE): student name + state badge + four chips — **ঠিক / আংশিক / ভুল / দেয়নি**.
  - ঠিক and দেয়নি fire `recordHomeworkOutcome` immediately (per-row busy spinner; row updates from refetch).
  - আংশিক / ভুল expand an inline panel under the row (the Principal's box pattern): ভুল → optional top-up fields (collapsed fold) + নিশ্চিত button; আংশিক → resubmit toggle chip + optional top-up fold + নিশ্চিত. Defaults mirror today's server rules.
- Non-actionable states: CHECKED/RESUBMIT → result badge + a ghost "রেকর্ডস" hint (return/resubmit handling stays on Records); ABSENT_REDELIVER → badge + same hint. No chips.
- Feedback: adopt the UX-1 toast + field-error rules if UX-1 has landed by build time; otherwise per-row inline error text (never a top-of-screen-only notice).
- Screen header keeps the SectionBar; screen doc-comment and drawer label unchanged ("Checking"), route name `CheckingQueue` kept.

**Untouched:** `HomeworkRecordsScreen` (exception drill-down: redeliver, returns, manual moves), Declare, Reconcile, rollups, guardian reads, `homeworkClassOverview` badge semantics.

**New STR keys (bn/en):** `hwOutcomeCorrect` (ঠিক/Correct), `hwOutcomePartial` (আংশিক/Partial), `hwOutcomeWrong` (ভুল/Wrong), `hwOutcomeNotSubmitted` (দেয়নি/Not submitted), `hwConfirm` (নিশ্চিত/Confirm), `hwSeeRecords` (রেকর্ডস/Records).

## 4. Journeys (Given/When/Then)

- Given a teacher opens Checking for their section on checking day, When the grid renders, Then every student's record for each pending item shows with its state, And recording a child's outcome as ঠিক or দেয়নি is exactly one tap.
- Given a record still in GIVEN, When the teacher taps ভুল, Then the server fast-forwards GIVEN→DUE→SUBMITTED→checked-WRONG atomically with an audit row per edge, And a resubmission spawns exactly as today.
- Given a record in CHECKED, When the grid renders, Then it shows the result badge with no chips, And the return move remains on Records.
- Given a proxy teacher whose grant covers a different subject, When they tap any chip on this item, Then the existing Bangla deny surfaces inline.
- Given a mid-request failure, Then no record is ever left half-advanced (single atomic service call).

## 5. Out of scope

- Any change to the lifecycle states/edges themselves, chase messaging, reconciliation, the 120-min ceiling, or rollup formulas.
- Retiring the Records screen or its manual transitions.
- Applying the grid recipe to Assignments / Class Test / Vocabulary / Saturday Revision — recorded here as the intended follow-on: the deferred pending-by-date phases (STATUS) should adopt this grid pattern module-by-module in their own PRDs.
- Offline/optimistic caching of taps.

## 6. Reused / unchanged

Lifecycle service + edges (`lifecycle.ts`), check service (resubmission/top-up rules), `homeworkOpenRecords` + `groupByDate`, SectionContext/SectionBar, ENH-002 proxy gates, D-#256 error surfacing, `tracker:write` — no new permission, model, index, or notification kind.

## 7. Contract-sync note

None. `outcome` is a String argument validated server-side (house pattern, same as `toState`/`result`). No mirrored enum, no `shared/vocab.ts` change, no import-envelope change. The vocab verifier must pass untouched on both slices.

## 8. Build order & gates

`feat/hwg-1-outcome-mutation` (server) → `feat/hwg-2-check-grid` (app), each off `dev`, sequential. HWG-1 gate: server `tsc`, focused + full jest green, verifier PASS. HWG-2 gate: app `tsc --noEmit`, `expo export --platform web`, plus manual checklist: (1) one-tap ঠিক and দেয়নি on GIVEN/DUE/CHASE rows on a phone-width viewport; (2) আংশিক expander with resubmit + top-up → guardian day-load reflects the top-up; (3) ভুল from GIVEN spawns a resubmission visible on Records; (4) CHECKED row read-only with Records hint; (5) proxy wrong-subject deny; (6) Bangla/English toggle + dark mode.

**Next = build HWG-1 per docs/prd-homework-check-grid.md §3.1, then HWG-2 per §3.2.**
