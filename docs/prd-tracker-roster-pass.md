# PRD — Tracker Roster Pass (homework + assignment, RP-1..RP-4)

**Status:** Draft for build — approved by Principal 2026-07-23
**Owner:** Principal (SCD)
**Scope:** Two composite server orchestrators per tracker (submit pass / return pass), one section-wide assignment read, one assignment outcome orchestrator, two new reusable app components, and two new workspace screens replacing four existing ones. **No lifecycle-engine change, no model/schema change, no new permission, no vocab/contract sync.**
**Traceability:** D-#355 (homework, this design), D-#356 (assignment parity). **Supersedes** D-#267 / `docs/prd-homework-check-grid.md` (the one-tap grid it replaces) and the Records↔Checking split in `docs/prd-tracker-homework.md` §12. Builds on: the shared 6-stage engine (`trackers/lifecycle.ts`, D-#37), D-#63 (absent-only attendance — the interaction pattern this copies), D-#313 (bulk mark-due), D-#314/#320 (attendance-backed issue roster), D-#337 (subject-scoped checking reads), D-#338 (per-record undo), D-#260 (chase → guardian reminder), D-#87 (assignment resubmission is never automatic), D-#331 (assignment week anchors on the delivery Thursday), D-#350/#351 (lifecycle report reads `stateDates`).

---

## 0. Quick checklist (read this first)

- [ ] Four slices, built in order: **RP-1 (server, hw) → RP-2 (app, hw) → RP-3 (server, as) → RP-4 (app, as)**. Server layer before app screens (house rule). PR 1 = RP-1+RP-2, PR 2 = RP-3+RP-4, PR 3 = the retirement sweep. Each off `dev`.
- [ ] **Verify PR 1 on the dev site with a real two-subject teacher before starting RP-3.** RP-3/RP-4 are a straight port; they must not begin until the shape is confirmed on real data.
- [ ] The pass services are **orchestrators only** — every write still goes through `transitionRecord` / `checkRecord` so `assertTransition` stays the single guard. No edge logic duplicated, no audit row skipped.
- [ ] `submitted` / `returned` travel as **Booleans** in an entry list; no new GraphQL enum, no `shared/vocab.ts` change, no mirrored-enum sync. Vocab verifier must pass untouched on every slice.
- [ ] **First-cross-only chase** (§3.1) is the one behavioural rule that differs from today in BOTH trackers. Get it under test before the app work starts.
- [ ] Route names of retired screens are kept for one release as redirects (house rule: route names unchanged), then deleted in PR 3.
- [ ] All new user-facing strings → `STR` in `app/src/lib/labels.ts`, Bangla + English.

---

## 1. Goal

The homework lifecycle is driven one student at a time across two screens (`HomeworkRecordsScreen` for due/chase/redeliver/return, `CheckingQueueScreen` for the outcome grid); assignment is driven across two more (`CollectAssignmentScreen`, `AssignmentCheckingScreen`), each scoped to a single item. A teacher with thirty students touches the screen thirty times to record one fact they observed in one glance: who handed the khata in.

Attendance already solved this shape — the marker taps only the exceptions and commits the roster once (D-#63). This PRD applies that idiom to the two stages of the tracker lifecycle that are genuinely roster-shaped, and leaves individual only the stage that genuinely is:

**জমা (chip pass) → যাচাই (individual) → ফেরত (chip pass)**

One card per subject per date (homework) / per week (assignment), all three stages on the card, each group holding only the students currently at that stage. Multi-column on a laptop. `DUE` disappears from the UI entirely — it is a calendar artifact the sweep and the pass handle between them.

## 2. Gap table

| # | Gap | Impact | Slice |
|---|---|---|---|
| G1 | Recording who submitted is N per-student interactions; the observation is roster-shaped but the UI is record-shaped. | Slowest daily task; teachers skip it and records stall | RP-1/2 |
| G2 | Handing back checked khatas (`CHECKED → RETURNED`) exists only on the Records screen, so the checking teacher must switch screens to finish the loop. | The Records↔Checking shuttle survives D-#267; returns get skipped | RP-1/2 |
| G3 | `groupByDate` keys on `dateGiven` alone, so a teacher who teaches two subjects to one section gets both subjects merged into one date card. | Can't tell whose work is whose; bulk actions span subjects | RP-2 |
| G4 | Every card is full-bleed at any viewport; a 1440px laptop shows one card where four fit. | Wasted screen; excess scrolling on the primary desktop workflow | RP-2 |
| G5 | Re-crossing an already-chased student increments `chaseCount` and re-notifies the guardian every pass. | Chase counts inflate; guardians get spammed for one lapse | RP-1/3 |
| G6 | Assignment has no section-wide record read (`assignmentRecords` is item-scoped) and joins student names client-side from a second query. | No unified screen is buildable; N+1 reads per item | RP-3 |
| G7 | Assignment chases only when the pass runs *after* the due date; before it, non-submitters silently stay `DUE`. Homework chases unconditionally. | Two trackers, two rules, for the same teacher act | RP-3 |
| G8 | Assignment's manual chase edge (`CHASE → CHASE`) exists in the engine but is exposed to nobody — only the Office follow-up list sees chases at all. | Teacher cannot escalate a repeat offender | RP-3/4 |

## 3. Design

### 3.0 Who is on the card (unchanged, stated for the record)

Records spawn from an **attendance-backed roster** at issue (homework: `confirmHomeworkDay` → `issueHomeworkItem`) / delivery (assignment: `deliverAssignment`), via `buildIssueRoster` — every `active` student of the section, `present = NOT in that day's absentStudentIds`. Present → `GIVEN` (+ dueDate); absent → `ABSENT_REDELIVER` (no dueDate). The auto-issue sweep defers the whole class rather than guess when attendance is incomplete (D-#314).

So the card's population is **whoever was present when the work was handed out**. `ABSENT_REDELIVER` students never appear in the three stage groups — they have not received the work. They are reachable from the card header badge (§3.3) and join the জমা chips the moment they are redelivered, **including the same day**: the pass walks `GIVEN → DUE → SUBMITTED` itself, so the fresh next-school-day dueDate is never in the way and no manual mark-due is needed.

A student absent on the *submit* day is a different thing entirely — they hold the work, their record is `GIVEN`/`DUE`, and they are crossed like any other non-submitter.

### 3.1 The chase rule (RP-1 + RP-3 — the one behavioural change)

| Situation | Effect |
|---|---|
| Cross a `GIVEN`/`DUE` student | → `CHASE`, `chaseCount` 0→1, guardian reminder emitted (D-#260) |
| Cross an already-`CHASE` student | **no-op** — no state stamp, no increment, no notification |
| Tap **তাগাদা** on a `CHASE` row | `CHASE → CHASE`, `chaseCount` +1, reminder emitted |
| Leave a `CHASE` student uncrossed | → `SUBMITTED`, `chaseCount` untouched |

**The due date is irrelevant throughout, in both trackers** — crossing chases immediately.

Two existing behaviours change to honour this:
- `HomeworkOutcomeService.recordHomeworkOutcome`, `NOT_SUBMITTED` path — currently fires `CHASE → CHASE` unconditionally and increments on every re-cross. Gate on `chaseCount === 0`.
- `AssignmentService.collectAssignment` — currently chases only when `pastDue`. Superseded by the new pass (§3.4); left untouched until RP-4 retires its screen, removed in PR 3.

### 3.2 Server — RP-1: `HomeworkRosterPassService`

New service, orchestrator only:

```
submitPass(itemId, entries: [{recordId, submitted}], actorId, at?)
  → { submittedCount, chasedCount, unchangedCount }

returnPass(itemId, entries: [{recordId, returned}], actorId, at?)
  → { returnedCount, unchangedCount }
```

**`submitPass` per entry**
- `submitted: true` — fast-forward to `SUBMITTED` via `transitionRecord`: `GIVEN → DUE → SUBMITTED`, or `DUE|CHASE → SUBMITTED`. **One `at` for the whole chain**, so D-#338's `popActionGroup` treats the walk as one undoable action.
- `submitted: false` — apply §3.1. A no-op entry returns in `unchangedCount` and writes nothing.
- Any record not in `GIVEN|DUE|CHASE` → rejected with a domain error naming the record (surfaced via the D-#256 maskError whitelist). The app never sends one; the server does not trust that.

**`returnPass` per entry** — `returned: true` on a `CHECKED|RESUBMIT` record → `RETURNED`. `returned: false` writes nothing. Any other state → domain error.

**Mutations:** `homeworkSubmitPass(sectionId, itemId, entries)`, `homeworkReturnPass(sectionId, itemId, entries)`. Gate identical to `recordHomeworkOutcome`: `tracker:write` + `assertCanWrite(section, subject)` + the D-#337 subject narrowing. No new permission.

**Not wrapped in a Mongo transaction** — same posture and same reasoning as `HomeworkOutcomeService` (see its doc-comment): a mid-pass failure leaves each record at a legal state, and re-running the pass is an idempotent no-op for those already advanced.

**Unchanged and still exposed:** `transitionHomeworkRecord` (the manual **তাগাদা** and any exception move), `recordHomeworkOutcome` (the individual check — §3.3 ②), `revertHomeworkRecord`, `markHomeworkRecordsDue` (kept as a mutation, drops out of the UI), redeliver, declare, reconcile, rollups.

**Jest (focused suite `homeworkRosterPass.test.ts`):** submit pass from each legal start state; the one-timestamp walk (`stateDates` group is poppable by `popActionGroup` as a single action); first-cross chases and second-cross does not; manual chase still increments; uncrossed `CHASE` → `SUBMITTED` without touching the count; guardian reminder emitted once per first cross and not on the no-op; return pass from `CHECKED` and `RESUBMIT`; illegal-state rejection; section-scope deny; D-#337 subject-narrowing deny/allow.

### 3.3 App — RP-2: `HomeworkWorkspaceScreen`

**Two new shared components** (both live in `app/src/components/`, both consumed four times across RP-2 and RP-4 — this reuse is what makes RP-4 cheap):

**`RosterChipPass.tsx`** — the `MarkAttendanceScreen` idiom generalised. Props: `{students, onLabel, offLabel, commitLabel, busy, onCommit}`. Chips default **on**; tap crosses (`✗`, the attendance chip treatment); a live counter reads `জমা: ২৮ · দেয়নি: ৩`; one commit button emits `[{id, on}]`. Purely presentational — it knows nothing about lifecycle states.

**`CardGrid.tsx`** — `flexWrap` + `flexGrow: 1` + `flexBasis` computed from `useWindowDimensions()`, honouring the sidebar-collapse widening already in `ui.tsx` (`DRAWER_PERMANENT_MIN_WIDTH`). Columns: 1 phone → 2 @768 → 3 @1100 → 4 @1450. Reusable by Assignment, Class Test and Reports afterwards.

**Data:** the existing `homeworkOpenRecords(sectionId, classId, states)` with `[GIVEN, ABSENT_REDELIVER, DUE, SUBMITTED, CHASE, CHECKED, RESUBMIT, RETURNED]` — unchanged, already subject-scoped by D-#337 and already carrying `studentName`, `subject`, `hwId`, `description`, `chaseCount`, `stampCount`, `hasAnswerFile`, `result`. `RETURNED` stays filtered to same-day (D-#338 undo-only), as today.

**Grouping:** `groupByDate`'s key becomes **`dateGiven + subject`**. A teacher with two subjects on one section gets two cards for the same date, each self-contained. `SubjectFold` (D-#306) still folds the subjects the caller does not teach.

**Card anatomy** — one per group, laid out by `CardGrid`:

```
২৩ জুলাই · গণিত · HW-C3-MATH-0042        [অনুপস্থিত ছিল · ২]
📘 topic · 📝 description
── জমা ─────────────────────  জমা: ২৮ · দেয়নি: ৩
[রহিম] [করিম ✗] [সালমা] …          [জমা নিশ্চিত করুন]
── যাচাই ───────────────────
রহিম     [ঠিক] [আংশিক] [ভুল]   [📎]        [আনডু]
── ফেরত ────────────────────
[রহিম] [সালমা ✗] …                [ফেরত নিশ্চিত করুন]
```

- **① জমা** — `RosterChipPass` over the `GIVEN|DUE|CHASE` records → `homeworkSubmitPass`. `CHASE` chips carry their count as a suffix. Per-row **তাগাদা** is reachable from a long-press/overflow on a `CHASE` chip (manual escalation, §3.1).
- **② যাচাই** — individual rows for `SUBMITTED` only, calling the existing `recordHomeworkOutcome`: **ঠিক / আংশিক / ভুল** chips, the আংশিক/ভুল inline panel (resubmit toggle + top-up) and the answer-file attach + drop zone, all carried over verbatim from `CheckingQueueScreen`. **দেয়নি does not appear here** — not-submitted is expressed by crossing in ①.
- **③ ফেরত** — `RosterChipPass` over `CHECKED|RESUBMIT` → `homeworkReturnPass`.
- **Header badge** `অনুপস্থিত ছিল · N` opens the redeliver list for the item's `ABSENT_REDELIVER` records (existing `transitionHomeworkRecord → GIVEN`). Off the main flow — those students are not in it — but not on another screen.
- **আনডু** (D-#338) on every row/chip whose `stampCount > 1`, as today.
- Empty groups collapse; a card with no open records disappears. Day accordion behaviour (owner ruling 2026-07-20 — one day open at a time, all closed by default) is preserved at the group level.

**Retired:** `HomeworkRecordsScreen`, `CheckingQueueScreen`. Routes `HomeworkRecords` / `CheckingQueue` kept for one release, redirecting to `HomeworkWorkspace`; deleted in PR 3. `HomeworkHomeScreen`'s action buttons collapse from two ("রেকর্ডস", "যাচাই") to one workspace entry.

**New STR keys (bn/en):** `hwPassSubmit` (জমা/Submission), `hwPassSubmitCommit` (জমা নিশ্চিত করুন/Confirm submissions), `hwPassCheck` (যাচাই/Checking), `hwPassReturn` (ফেরত/Return), `hwPassReturnCommit` (ফেরত নিশ্চিত করুন/Confirm returns), `hwAbsentAtIssue` (অনুপস্থিত ছিল/Absent when issued), `hwPassNotSubmitted` (দেয়নি/Not submitted). Existing `hwChaseAction`, `hwOutcome*`, `hwReturnAction`, `revertAction`, `hwAttachAnswer` are reused as-is.

### 3.4 Server — RP-3: assignment parity

**New query `assignmentOpenRecords(sectionId, classId, states)`** — section-wide, the read that makes a unified screen possible. Returns per record: `id`, `studentName` (resolved server-side — kills the client-side join against `studentsInSection`), `studentId`, `asItemId`, `asId`, `subject`, `classLevel`, `dueDate`, `deliveryDate`, `state`, `chaseCount`, `result`, `marks`, `feedback`, `resubOf`, `stampCount`. Read gate mirrors `assignmentRecords`: `tracker:read` + `assertCanRead` + `assertItemSubjectReadable` per distinct item, so the D-#337 posture is preserved.

**New `AssignmentRosterPassService`** — `submitPass` / `returnPass`, semantics identical to §3.2 including §3.1's first-cross-only rule, and **chasing on cross regardless of the due date** (G7). Mutations `assignmentSubmitPass`, `assignmentReturnPass`, gated as `collectAssignment` is today.

**New `recordAssignmentOutcome`** — the individual check orchestrator, mirroring `recordHomeworkOutcome` (fast-forward then `checkAssignmentRecord`) with two deliberate differences preserved: it carries **`marks` + `feedback`**, and **it never auto-spawns a resubmission** (D-#87 — that stays `issueAssignmentResubmission`, an explicit teacher button on a checked record).

**`sweepAssignmentChases` stays unwired from the scheduler.** It exists as a mutation and is called by nothing in production; under this design chase is a teacher act, not a timer. Left dormant, not deleted.

**Jest (focused suite `assignmentRosterPass.test.ts`):** mirrors §3.2's suite, plus — the owner's worked example as a literal test: 20 delivered, 15 uncrossed / 5 crossed (3 present-not-submitted + 2 absent-that-day) → `submittedCount 15`, `chasedCount 5`; re-run with 4 of the 5 submitting → those 4 `SUBMITTED` with counts untouched, the 5th re-crossed → unchanged at `chaseCount 1`; manual chase → 2. Plus: chase fires *before* the due date (the G7 regression); `assignmentOpenRecords` subject-readability deny; marks bound (`0 ≤ marks ≤ item.totalMarks`) still enforced; no resubmission auto-spawns on `WRONG`.

### 3.5 App — RP-4: `AssignmentWorkspaceScreen`

Same card, same two components, grouped by **due date × subject** (the assignment cadence is weekly and anchors on the delivery Thursday — D-#331 — so the group header reads the week and its due date, not `dateGiven`). Deltas from §3.3:

- **② যাচাই** rows add **marks** + **feedback** fields and the explicit **পুনরায় জমা** (resubmission) button on a checked record.
- The header badge covers `ABSENT_REDELIVER` from **delivery day** — students absent on the due day are ordinary crossed non-submitters and need no special treatment.
- `AssignmentHomeScreen`'s per-cell chips collapse from **[সংগ্রহ] [যাচাই]** to one workspace entry; deliver / reconcile / edit / delete / schedule / chase-list / rollups are untouched.

**Retired:** `CollectAssignmentScreen`, `AssignmentCheckingScreen` (routes redirect one release, deleted in PR 3).

## 4. Journeys (Given/When/Then)

- Given a teacher teaching two subjects to one section, When they open the workspace, Then they see **two cards for that date**, one per subject, each with its own roster and its own commit buttons.
- Given 20 students received an assignment on Thursday, When on Sunday the teacher crosses 3 who did not submit and 2 who were absent and commits, Then the result reads **জমা: ১৫ · তাগাদা: ৫**, And each of the 5 is at `chaseCount 1` with one guardian reminder sent.
- Given those 5 return later and 4 submit, When the teacher leaves them uncrossed and commits, Then the 4 move `CHASE → SUBMITTED` with `chaseCount` **untouched**, And the 5th, crossed again, is **unchanged** — no stamp, no increment, no second reminder.
- Given that 5th student is still missing the next day, When the teacher taps **তাগাদা** on their row, Then `chaseCount` becomes 2 and a reminder is sent.
- Given a student was absent when homework was issued, When the teacher redelivers them from the header badge **on the same day**, Then they appear in the জমা chips immediately, And committing the pass carries them `GIVEN → DUE → SUBMITTED` without any mark-due step.
- Given a record still in `GIVEN`, When the teacher taps ভুল in যাচাই, Then the server fast-forwards to checked-`WRONG` atomically with an audit row per edge and a resubmission spawns exactly as today (homework), or does **not** spawn (assignment, D-#87).
- Given a teacher checked 28 khatas, When they cross the 2 they kept back and commit ফেরত, Then 26 go `RETURNED` and the 2 reappear on tomorrow's card.
- Given a mistaken commit, When the teacher taps আনডু on a row that same day, Then the whole fast-forward walk is popped as one action (D-#338), Because the pass stamps its chain with a single timestamp.
- Given a laptop at ≥1450px, When the workspace renders, Then subject cards lay out four across with no horizontal page scroll.
- Given a proxy or wrong-subject teacher, When they commit any pass, Then the existing Bangla deny surfaces — the pass adds no new authorization path.

## 5. Out of scope

- Any change to the lifecycle states or edges, chase messaging content, reconciliation, the 120-min ceiling, the weekly assignment ceiling, or rollup formulas.
- **Bulk undo.** D-#338 undo stays per-record; a miscommitted 30-student pass is 30 undos. Deliberately deferred until it is observed to happen — see §9.
- Wiring `sweepAssignmentChases` to the scheduler.
- Applying the roster-pass recipe to Class Test / Vocabulary / Saturday Revision — the intended follow-on, each in its own PRD, reusing `RosterChipPass` + `CardGrid`.
- Offline/optimistic commits; a pass is a single online mutation.
- Retiring `markHomeworkRecordsDue` / `collectAssignment` as mutations (PR 3 removes `collectAssignment` with its screen; `markHomeworkRecordsDue` stays).

## 6. Reused / unchanged

Lifecycle engine + edges (`lifecycle.ts`) and `popActionGroup`; `transitionRecord` / `checkRecord` / `checkAssignmentRecord` / `issueAssignmentResubmission`; `recordHomeworkOutcome`; `homeworkOpenRecords`; `groupByDate` (key changed, module kept); `SubjectFold`; `useTaughtSubjects`; the D-#337 subject narrowing; `assertCanRead` / `assertCanWrite`; D-#256 error surfacing; D-#260 chase emitters with their per-student-per-day dedupe; the attendance-backed issue roster; declare / reconcile / deliver / schedule / rollups / guardian reads. **No new permission, model, index, or notification kind.**

## 7. Contract-sync note

None. `submitted` / `returned` are Booleans in an entry list; `outcome` and `result` keep travelling as server-validated Strings (house pattern). No mirrored enum, no `shared/vocab.ts` change, no import-envelope change. **The vocab verifier must pass untouched on all four slices.**

## 8. Build order & gates

| PR | Branch | Contents | Deploy |
|---|---|---|---|
| 1 | `feat/rp-homework-roster-pass` | RP-1 + RP-2 | server + OTA |
| 2 | `feat/rp-assignment-roster-pass` | RP-3 + RP-4 | server + OTA |
| 3 | `chore/rp-retire-old-screens` | delete redirect routes + `collectAssignment` | OTA |

Each off `dev`. **PR 1 must be verified on the dev site with a real two-subject teacher before PR 2 starts.**

**Server slices (RP-1, RP-3):** `npm run build --workspace=shared` (if `dist/` stale) → `npm run typecheck --workspace=server` → the focused suite → full `npm run test --workspace=server` green → vocab verifier PASS (untouched).

**App slices (RP-2, RP-4):** `npm run typecheck --workspace=app`-equivalent (`tsc --noEmit`) → `expo export --platform web` (capture the **full** output and check `$?` — a piped tail masks bundler failures) → Playwright drive at the running app: (1) two-subject teacher sees two cards for one date; (2) submit pass with crosses → counts correct; (3) re-run → no double-chase, no second notification; (4) individual check incl. আংশিক panel + file attach; (5) return pass; (6) আনডু pops a whole walk; (7) redeliver → student appears in জমা same day; (8) manual তাগাদা increments; (9) wide-viewport screenshot showing multi-column layout; (10) Bangla/English toggle + dark mode.

## 9. Known consequences (accepted)

1. **The lifecycle report's pending pills thin out.** D-#350/#351 bucket by current state over `stateDates`; as the pass becomes the normal path, records skip through `DUE`/`SUBMITTED` and "awaiting submission" / "awaiting check" shrink. The report stays correct — the numbers get smaller. D-#267 already accepted this for the check grid; this makes it the default path.
2. **A pass can emit several guardian reminders at once** — one per first cross (D-#260, deduped per student+item per day). Five is fine; watch it at thirty.
3. **Undo is per-record, not per-pass** (§5).

---

**Next = build RP-1 per §3.1–§3.2, then RP-2 per §3.3; verify on dev; then RP-3 per §3.4 and RP-4 per §3.5.**
