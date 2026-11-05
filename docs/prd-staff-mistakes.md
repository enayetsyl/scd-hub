# Staff mistake record — build contract

Owner ask, 2026-11-04: the নম্বর জমায় ভুল notes (D-#892/#893) record a teacher's same-day
correction as a mistake with no way to explain it. A teacher who marked two children "not
submitted" because they never gave their scripts to the class captain, and later took them
by hand, has a valid reason. Give every caught mistake a reason step (common buttons + free
text), a review by Office / the Principal, and a record per person. The same pattern then
spreads to every other place a mistake can be caught.

Mockup (12 screens, owner-reviewed 2026-11-04): https://claude.ai/artifact/W7vLyrSRc64FTcvp2cxRNn

Decisions: D-#936 (the log), D-#937 (reason at correction time + deadline), D-#938 (guardian
message follows the reason), D-#939 (review decisions).

## 1. The model

One `StaffMistake` per caught mistake per person (`server/src/modules/staff-mistakes`).
A source (a `MarkCorrectionNote` today) keeps its own detail; the mistake row carries the
reason and the decision.

| field | meaning |
|---|---|
| `staffUserId` | whose mistake it is (the person who made the wrong mark, not the corrector) |
| `kind` | the source — `MARK_CORRECTION` in MR-1 |
| `tier` | 1 = the wrong thing reached a guardian/staff; 2 = caught before; 3 = missed duty |
| `sourceId` | the source row (`MarkCorrectionNote._id`) |
| `status` | `EXPLANATION_DUE` → `PENDING_REVIEW` → `COUNTED` / `EXCUSED` / `MOVED` |
| `reasonCode`, `reasonText` | the reason button + free text |
| `explainDueAt` | deadline for an explanation |
| `autoCounted` | counted because the deadline passed with no explanation |
| `decidedBy`, `decidedAt`, `decisionNote` | the review |
| `movedFromId` / `movedToId` | a MOVE links the two rows |

Unique on (`kind`, `sourceId`, `staffUserId`).

## 2. Status rules

- Created with a reason by the person themselves → `MINE` = `COUNTED` at once (self-admitted;
  a reviewer may still excuse it); any other reason → `PENDING_REVIEW`.
- Created without a reason (undo, the workspace card, a work-claim acceptance, a correction
  made by someone else) → `EXPLANATION_DUE`; the person is notified.
- The person may explain while `EXPLANATION_DUE` or `PENDING_REVIEW` (re-explaining replaces
  the reason). Not after a decision.
- `EXPLANATION_DUE` past `explainDueAt` → `COUNTED`, `autoCounted: true`. Settled lazily on
  every read (no scheduler family in MR-1).
- Deadline = 17:00 Dhaka on the next school day (Sun–Thu).

## 3. Reasons (`shared/staffMistakes.ts`)

`MARK_CORRECTION`: `MINE` আমার ভুল ছিল · `LATE_DIRECT` পরে সরাসরি আমার কাছে জমা দিয়েছে ·
`OFFICE_LATE` অফিস থেকে খাতা দেরিতে বা কম পেয়েছি · `OTHER` অন্য কারণ (text required).
Free text is optional for the first three, at most 500 characters.

## 4. Guardian message (D-#938)

The reason chosen on the submit pass rides a request-scoped context into
`recordMarkCorrection`. `LATE_DIRECT` sends "বাড়ির কাজ পরে জমা হয়েছে" (the child brought it
late, directly to the teacher; please use the office route). Every other reason, and no
reason, keeps the D-#893 apology.

## 5. Review (D-#939)

`staff_mistakes:review` (Office on; Principal implicit) decides `PENDING_REVIEW`,
`EXPLANATION_DUE` or a self-counted row: `EXCUSE` (kept, not counted), `COUNT`, or `MOVE` to
another staff member (the original becomes `MOVED`; the new row starts `EXPLANATION_DUE` for
them). Optional note. Nobody decides their own row. The person is notified of the decision.
Single-step in MR-1; the mockup's Office-then-Principal step is MR-2 if the owner wants it.

## 6. Permissions — `staff_mistakes` (Staff & HR)

| action | T | O | flags |
|---|---|---|---|
| `view_own` — my entries; explain them | on | on | SELF |
| `view_all` — everyone's entries (staff file, summary) | — | on | |
| `review` — decide explanations | — | on | |

## 7. Slices

| slice | scope |
|---|---|
| **MR-1** | the log + `MARK_CORRECTION` source; reason sheet on the homework/assignment submit pass; আমার ভুল ও ব্যাখ্যা; ব্যাখ্যা যাচাই queue; guardian message by reason |
| MR-2 | warning ladder (3 in 30 days → pop-up; 5 → face-to-face; 8 in 90 → conduct suggestion), meeting record, per-staff summary, settings (deadline, reasons, on/off per place), optional two-step review |
| MR-3 | attendance as a source (store which child changed first) |
| MR-4 | class-test marks re-published, scripts unpublished / wrong page |
| MR-5 | work claim accepted, homework/assignment CHECKED/RESUBMIT reverts |
| MR-6+ | the remaining tier-1 places, then tier 2, then tier 3 (mockup screens 9–11) |

## 8. Acceptance (MR-1)

1. Correcting today's chase on the submit pass asks for a reason; the pass is not sent without one.
2. `MINE` → counted; other reasons → pending review; Office + Principal still get the D-#893 notice.
3. `LATE_DIRECT` changes the guardian's message; others keep the apology.
4. An undo / card-tap correction creates an entry that asks for an explanation and notifies the person.
5. No explanation by the deadline → counted automatically.
6. A reviewer can excuse, count or move; the person is told; nobody reviews their own.
7. Teachers see only their own entries.

## 9. MR-2 — the warning ladder (D-#940–#942, #1005)

- **Ladder.** After any mistake becomes COUNTED (self-admitted, reviewer, or an explanation
  that ran out — the scheduler settles those every tick), the person's weighted count of
  COUNTED mistakes decided inside each rung's window is compared with the rung. Defaults:
  3 in 30 days → WARNING (pop-up), 5 in 30 → MEETING (face-to-face), 8 in 90 → CONDUCT
  (the Principal is told to consider a conduct step; nothing opens on its own). Weights:
  tier 1 = 1, tier 2 = ½, tier 3 = ½. Each rung fires once per window per person.
- **Who hears.** The person once (the highest new step) + the pop-up on their next app open
  (closed only by বুঝেছি). WARNING/MEETING → holders of `staff_mistakes:meetings`;
  CONDUCT → holders of `conduct:create`.
- **Meeting.** `staff_mistakes:meetings` (Office on) books date/time/place (the pop-up
  returns with the time; "অন্য সময় চাই" tells them) and records who talked, what was
  discussed, the agreed action and a follow-up date, optionally sending the summary.
- **Summary.** কর্মীর ভুলের হিসাব: per person over 30/90 days — counted (+ weighted),
  waiting, accepted, most frequent place, highest step reached; plus a count by place.
- **Rules.** `staff_mistakes:settings` (PRINCIPAL-DEFAULT) edits the three rungs, the tier
  weights, the explanation deadline (next school day 17:00 / 24 hours / third school day
  17:00) and which places record mistakes at all.

## 10. MR-3 — attendance (D-#944)

- **What is recorded.** When a day's absent list that was already submitted is saved again with
  a different set (the marker's same-day re-submit, or a Principal/Office amendment), the server
  diffs old vs new and appends each flipped child (from → to, when, by whom) to an
  `AttendanceCorrectionNote` for (unit × day × the day's marker). Before this only the count of
  absentees reached the audit log. The first save of a day is never a correction; an unchanged
  re-submit records nothing.
- **Whose mistake.** The day's marker (`markedBy` before the save), even when Office corrects it.
- **Episodes.** While the entry still waits for a reason, further changes that day join the same
  note; once it has been explained or decided, the next change opens episode 2 (its own entry).
- **Reasons** (`ATTENDANCE_CORRECTION`): আমার ভুল ছিল (counts) · শিক্ষার্থী দেরিতে এসেছে and
  শিক্ষার্থী অন্য কাজে বাইরে ছিল (`autoExcuses`: accepted at once, kept on file) · অন্য কারণ (text).
- **App.** The attendance screen asks before saving when the caller is the day's marker and the
  list changed; a correction by someone else asks the marker to explain later (STAFF_MISTAKE_EXPLAIN).
- **Tier 1** (a wrong absent decides who gets homework that day).

## 11. MR-4 — class tests (D-#945)

- **Marks.** Every publish stores `publishedSnapshot` (marks, present/absent, entrant) on the
  result. A later publish (one child or the whole exam) whose values differ from the snapshot
  appends the child (from → to, when, who published) to a `ClassTestCorrectionNote` (MARKS)
  owned by the snapshot's entrant → tier-1 `CLASS_TEST_MARKS` entry, explained later (Office
  usually re-publishes). First release and an unchanged re-publish record nothing.
- **Scripts.** Unpublishing published scripts (guardians had the pages) records a SCRIPTS note
  for `scripts.publishedBy` → `CLASS_TEST_SCRIPTS` entry; a reviewer can move it to whoever
  attached the wrong page.
- **Reasons.** Marks: যোগে ভুল / ভুল শিক্ষার্থীর ঘরে নম্বর (both count) · খাতা পরে পাওয়া গেছে
  (accepted at once) · অন্য কারণ. Scripts: আমার ভুল ছিল (counts) · পাতা ভুল শিক্ষার্থীর সাথে ·
  স্ক্যান অস্পষ্ট · অন্য কারণ.
- Episodes as in §10. The guardian's re-publish message is unchanged (it already re-notifies the
  new result); a "নম্বর সংশোধন" wording is a follow-up.

## 12. MR-5 — accepted claims and undone marks (D-#951)

- **Accepted claim.** When a guardian's "done at home" claim is accepted (the teacher marks the
  work submitted), the record's last CHASE stamp is read: made by a person on an EARLIER day →
  tier-1 `WORK_CLAIM_ACCEPTED` entry for that person (source = the claim). A same-day chase is
  already a MarkCorrectionNote (D-#892); a system chase (no `by`) is nobody's mistake.
- **Undone mark.** A homework/assignment revert that pops a RESUBMIT (the family was told to
  resubmit) always counts; a popped CHECKED counts when someone else undoes it or it was given
  on an earlier day (a teacher fixing their own tap the same day told nobody). One
  `WorkRevertNote` per revert per owner → tier-1 `WORK_REVERT` entry.
- **Reasons.** Claim: আমার ভুল ছিল (counts) · খাতা অন্যের কাছে ছিল · শিক্ষার্থী পরে দেখিয়েছে
  (accepted at once) · অন্য কারণ. Revert: ভুল শিক্ষার্থীর ঘরে চাপ পড়েছে (counts) · খাতা আবার
  দেখে বদলেছি · অন্য কারণ. Both explained later.

## 13. MR-6 — the remaining tier-1 places (D-#954)

One generic source, `StaffMistakeNote` (kind × refKey × owner × episode, lines of Bangla written
when the correction happened), and `recordPlaceMistake()` called from each place. All tier 1,
explained later by the owner. Reasons = আমার ভুল ছিল + the place's own + অন্য কারণ.

| kind | caught when | owner |
|---|---|---|
| POPUP_NOTICE_CHANGE | a published pop-up's text/buttons change or it is re-shown or withdrawn AND someone had read it (moving only the end date is not) | `publishedBy` ?? `createdBy` |
| MONTHLY_REPORT_REVOKE | a released report is revoked (a batch gathers on one note) | `releasedByUserId` |
| SYLLABUS_REOPEN | a PUBLISHED syllabus's content changes | the previous `updatedBy` |
| EXAM_ROUTINE_CHANGE | a published routine's slots for a class change | the previous `updatedBy` |
| STAFF_LETTER_VOID | a letter that was sent to the person's app is voided | `issuedBy` |
| PAYROLL_REOPEN | a locked payroll run is reopened | `preparedBy` |
| FINANCE_REVERSAL | a posting is reversed | the original `enteredByUserId` |
| MASTERY_CORRECTION | results change after the paper was confirmed (per prior entrant) | each changed row's previous `enteredBy` |
| QURAN_EXAM_CORRECTION | an ABSENT sitting is saved present with no MADE_UP after the absence | the ABSENT history entry's `by` |
| CLASS_NOTE_CHANGE | a published note is re-published with a different summary, edited (text/files) or deleted | `publishedBy` |

Not in this slice: Saturday revision (a delivered entry cannot be corrected at all yet — needs a
correction path first) and Quran-exam marks changed after an unlock.

## 14. MR-7 — tier 2: someone else caught it (D-#953)

Same generic note as §13 with `tier: 2` (half weight on the ladder by default). Explained later.

| kind | caught when | owner |
|---|---|---|
| CT_RESULT_SENT_BACK | Office sends submitted class-test results back | each submitter |
| CT_DETAILS_FIXED | a class test's total or pass marks are corrected (a date-only move is not) | `requestedBy` |
| CT_REQUEST_CHANGED | a question request is edited / cancelled after the Office typed a version | `requestedBy` |
| CT_PAPER_SENT_BACK | the teacher sends the Office's typed paper back for changes | the round's `sentBy` |
| HW_ITEM_VOIDED | the Office voids a declared homework item | `declaredBy` |
| ASSIGNMENT_ITEM_CHANGED | a delivered assignment's set or text changes (supplying missing total marks is not) | `deliveredBy` |
| COMMENT_REVISED | a reviewer rewrites or discards someone's comment | `authorUserId` |
| OBSERVATION_REJECTED | the observer rejects an unreviewable video | `createdBy` (uploader) |
| OBSERVATION_RESTORED | a cancelled observation is restored | who cancelled it |
| TASK_REOPENED | a task marked done is reopened by someone else | `doneBy` |
| SCRIPTS_RECEIVE_UNDONE | a scripts receipt is undone | `receivedBy` |
| COVER_CANCELLED | a cover is cancelled (the covering teacher had been told) | `createdBy` |
| ROUTINE_CELL_REVISED | a routine cell is revised before it ever took effect | `createdBy` |
| LEAVE_REDECIDED | an approved / rejected leave is decided again | the first decider |
| PRINT_CANCELLED | the Office cancels someone else's print request | `requestedBy` |

Deferred (need new comparison logic, not just a hook): staff attendance sheet re-imported,
salary entered twice for one month, guardian linked then unlinked, question retired then
restored, absent-at-delivery vs the attendance register.

## 15. MR-8 — tier 3: missed or late duties (D-#955)

Same generic note with `tier: 3`, `correctedBy: "system"` and `oncePerRef` — the existing sweep that
already reminds or escalates records the miss **once per thing**, however many days it keeps running.
Explained later with the duty reasons (ছুটিতে ছিলাম, প্রক্সির দায়িত্বে ছিল, অ্যাপের সমস্যা, অন্য দায়িত্ব,
ভুলে গেছি = counts, অন্য কারণ + text).

| kind | recorded when | owner | leave day checked |
|---|---|---|---|
| ATTENDANCE_NOT_MARKED | the 14:00 reminder finds a section still unmarked | the section's marker | that day |
| HW_PASS_SKIPPED | the 17:30 chase sweep marks children "not submitted" itself | the item's `declaredBy` | that day |
| ASSIGNMENT_UNMARKED | an item is on the 09:30 late-marks list | each teacher of the item | that day |
| OBSERVATION_NO_RESPONSE | an unanswered observation reaches the Principal flag (default 7 days) | the observed teacher | — |
| TASK_OVERDUE | the morning task sweep finds a task past its due day and still open | the assignee | the due day |
| WORK_CLAIM_UNANSWERED | a guardian's "done at home" claim expires unanswered | the claim's teacher | — |

**Approved leave:** where a duty day is known, an approved staff leave covering it (matched through the
staff profile) accepts the entry at once as ছুটিতে ছিলাম — no explain notice is sent.

Deferred: the class-test marks overdue digest only carries counts, not who; Saturday revision and
Quran marks after unlock have no correction path yet.
