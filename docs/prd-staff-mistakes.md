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
