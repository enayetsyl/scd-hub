# PRD — Guardian "done at home" declaration + the return-from-leave reminder (slices GC-1..GC-5, RL-1..RL-2)

**Status:** BUILD CONTRACT — **all owner rulings ratified 2026-08-25 (§11); no open questions.** Wireframes attached (§10). Nothing built.
**Owner:** Principal
**Modules:** `server/src/modules/trackers` (the claim row + resolution), `server/src/modules/guardian` (the file mutation), `server/src/modules/routine` (`myDay` — the return card), `server/src/modules/notifications` (four new kinds)
**Decisions:** **D-#551–#554** (2026-08-25, pre-flighted against `origin/dev` @ `630ab49`; live max was D-#547. *An earlier pre-flight against `8ceb013` had reserved #547–#553; `D-#547` then landed on dev the same day — the HR policy screen — so the whole block shifted up by one before anything was written.*)
**Source:** owner ask 2026-08-25 — *"the guardian makes sure the student completes the homework but the student didn't submit at school, so the teacher never marks it submitted"* and *"when a student comes back after a leave, remind the teacher to ask that student for the homework and assignment."*

---

## §0 — At a glance

Two separate features that close the two ends of the same leak: **work that was done but never got recorded as done.**

- **A — the guardian declaration (GC-1..GC-5).** On any of the child's homework/assignment rows sitting at `DUE` or `CHASE`, a guardian taps **"বাড়িতে সম্পন্ন হয়েছে"**. That files a `GuardianWorkClaim`. **All three roles see it at once** — teacher, Office and Principal. The teacher is notified immediately; if the work is still not marked by **11:30** the Office is notified, and by **13:00** the Principal is (owner ruling, D-#554). The Office can **nudge the teacher**, not mark the work submitted.
- **B — the return-from-leave reminder (RL-1..RL-2).** The Today dashboard grows a card naming the students who are back today after an absence, with each one's still-open homework and assignments split into **"পুনরায় দিতে হবে"** (never received it — `ABSENT_REDELIVER`) and **"জমা নিতে হবে"** (received it, still not handed in).
- **The claim NEVER moves the lifecycle.** A guardian cannot write `SUBMITTED`. The tracker stays the teacher's record; the claim is a parallel row that says *a parent asserts this was done* and *nobody has answered them yet* (D-#551).
- **The teacher gets no extra tap.** Marking the student submitted through any existing path auto-resolves the claim (D-#552). The only manual close is an explicit **reject with a reason**, which is what stops the Office chasing a teacher who genuinely never received the notebook.
- **Plane:** identity/operational. Names a student and a guardian; **no corpus/analytics join** — ADR-005 untouched, the fail-closed firewall test stays green.
- **Contract surface:** app-native `/shared/vocab.ts` additions only — **no envelope twin, no harness sync** (the D-#46/#52 pattern). Vocab verifier stays green.
- **Build order:** RL-1/RL-2 are **independent of A** and are the cheaper half — they can ship first.

## §1 — Goal

### A. The declaration

The homework tracker's `DUE`/`CHASE` states currently mean two very different things that the data cannot tell apart:

1. the child did not do the work, or
2. the child did the work and it was never recorded — the notebook stayed at home, the teacher's roster pass missed the row, the day got away from everyone.

Case 2 is invisible today and its cost is real: the chase ladder keeps firing at a family that has already done the work (`HW_CHASE` pushes on **every** chase, D-#260), the weekly digest lists it again on Thursday (D-#452), and the parent has no way to say so. The only channel is WhatsApp to a teacher who may not read it.

This gives the family one button and gives the school an **answerable queue**: every claim is either accepted (the work gets recorded) or rejected with a reason (the family learns why) — and if neither happens, somebody senior finds out.

### B. The return-from-leave reminder

`ABSENT_REDELIVER` already exists and is already correct: a student absent at issue time never receives the sheet, so their record parks there and carries **no due date** (`HomeworkDueSweepService` deliberately skips it). The engine edge `ABSENT_REDELIVER → GIVEN` exists, exposed as `redeliverAssignmentRecord` and its homework twin.

Nothing ever *reminds anyone to walk that edge.* A child back after three days has records parked in a state that no sweep touches and no screen surfaces at the moment it matters — the morning they walk back in. The work silently never happens.

## §2 — Gap table

| Area | Current (`origin/dev`, 2026-08-25) | Desired |
|---|---|---|
| Guardian says "it's done" | No path. WhatsApp, or nothing. | One button on the record card (GC-3). |
| Teacher learns of it | — | `WORK_CLAIM_FILED` to the issuing teacher + a badge on the roster pass (GC-4). |
| Office/Principal oversight | — | A pending-claims queue all three roles see immediately + notifications at 11:30 (Office) / 13:00 (Principal) on the action day (GC-5). |
| Guardian learns the outcome | — | `WORK_CLAIM_RESOLVED` — accepted, or rejected with the teacher's reason (GC-2). |
| Chase while a claim is open | The chase ladder keeps firing at the family. | A `PENDING` claim **suppresses** the guardian chase push for that record (§6.4). |
| Student returns from leave | `ABSENT_REDELIVER` rows sit untouched; nothing prompts anyone. | A Today card naming returning students + their open items (RL-1). |
| Who is "returning" | Derivable from attendance, never derived. | Confirmed from `StudentAttendanceDay`, predicted from `StudentLeaveApplication.toKey` (RL-1). |

## §3 — Reused / unchanged (do not rebuild)

`HomeworkStudentRecord` / `AssignmentStudentRecord` and their shared `LIFECYCLE_STATES` (D-#37) · `transitionRecord` + `assertTransition` — the claim never bypasses them · `HomeworkRosterPassService` / `AssignmentRosterPassService` (the auto-resolve hook, D-#355) · `GuardianLink` + `assertGuardianOfStudent` and the existing `guardian:read_child` gate — **no new guardian permission** · `submitChildLeaveApplication` as the precedent for a guardian *write* · `emit()` + `dedupeKeys` + `bestEffort` + `renderTemplate` (N-1, D-#72) · `SchedulerService` for the escalation sweep (D-#73, restart-safe) · `PendingAlertService` + `MyDayService` for the Today card · `StudentAttendanceDay` (absent-only capture, D-#63) · **`StudentAttendanceService`'s mark/amend seam — the RL-2 push hangs off it, no new sweep** · `StudentLeaveApplication` (recorded-only, D-#66) · `actingAsFilter(["PRINCIPAL","OFFICE"])` for the operator fan-out (the D-#296 shape) · `writeAudit` (ADR-008).

## §4 — New vocabulary (app-native, `/shared/vocab.ts`)

> App-native only; **no envelope twin, no three-place sync** (D-#46/#52). The verifier asserts presence + BN/EN label coverage on both maps.

- `WORK_CLAIM_TRACKERS = [HOMEWORK, ASSIGNMENT]` — বাড়ির কাজ / অ্যাসাইনমেন্ট.
- `WORK_CLAIM_STATUSES = [PENDING, ACCEPTED, REJECTED, EXPIRED]` — অপেক্ষমাণ / গৃহীত / নাকচ / মেয়াদোত্তীর্ণ.
- `WORK_CLAIM_REJECT_REASONS = [NOT_BROUGHT, NOT_FOUND, INCOMPLETE, ALREADY_RECORDED, OTHER]` — খাতা আনেনি / খাতা পাইনি / অসম্পূর্ণ / আগেই জমা লেখা হয়েছে / অন্যান্য. A picker, not free text, so the Office queue can be read at a glance; `OTHER` opens a ≤200-char note.
- Notification kinds — all **app-native, no wire twin**:
  - `WORK_CLAIM_FILED` — `অভিভাবক জানিয়েছেন কাজ হয়েছে` → the item's `issuedBy` teacher.
  - `WORK_CLAIM_ESCALATED` — `অভিভাবকের জানানো নিষ্পন্ন হয়নি` → Office at **11:30**, Principal at **13:00**, on the action day (§6.3).
  - `WORK_CLAIM_RESOLVED` — `আপনার জানানোর উত্তর এসেছে` → the guardian who filed it.
  - `STUDENT_RETURNED` — `ছুটি শেষে ফিরেছে` → the class teacher, once per student per day (RL-2; **confirmed by the owner 2026-08-25**, §11.2).
- Audit kinds: `WORK_CLAIM_FILED`, `WORK_CLAIM_ACCEPTED`, `WORK_CLAIM_REJECTED`, `WORK_CLAIM_NUDGED`, `WORK_CLAIM_EXPIRED`.
- `Notification.refs` gains `workClaimId?: string` — **and it must be added to `RefsSchema`**, not only to the TS interface. A ref present on the interface but absent from the sub-schema is silently stripped by Mongoose on write; that exact bug is already recorded in the model's own comments for `ctQuestionRequestId`.
- **No new permission.** Guardians file under `guardian:read_child`; teachers resolve under the `tracker:write` they already need in order to mark submitted; Office/Principal read the queue under `tracker:read`. Office nudging is deliberately *not* a permission — see D-#554.

## §5 — The data model

### 5.1 `GuardianWorkClaim` (new, `trackers` module)

| Field | Type | Notes |
|---|---|---|
| `tracker` | `WorkClaimTracker` | HOMEWORK \| ASSIGNMENT — one row type, two trackers. |
| `recordId` | ObjectId | → `HomeworkStudentRecord` / `AssignmentStudentRecord`. |
| `workId` | string | Denormalised `hwId` / assignment id — the human handle shown everywhere. |
| `studentId`, `sectionId`, `classId` | ObjectId | Identity plane; never joined from corpus. |
| `subject` | string | Denormalised so the queue reads at a glance without a second lookup. |
| `dueDate` | Date? | Copied at file time — context only; the ladder's clock is the claim, not this. |
| `claimedByGuardianId` | ObjectId | The login-enabled guardian who tapped. |
| `claimedByUserId` | ObjectId | Their `User` row (the portal logs in as a user). |
| `claimedAt` | Date | When the parent tapped. |
| `actionDateKey` | string | `YYYY-MM-DD` — **the action day (§6.3.1), resolved once at file time and stored.** The 11:30 / 13:00 rungs read this field; they never re-derive it. Computing it per sweep would make the ladder depend on when the ticker happened to run. |
| `note` | string? | ≤200 chars, optional — "খাতা ব্যাগে দিয়ে দিয়েছি". |
| `status` | `WorkClaimStatus` | PENDING → ACCEPTED \| REJECTED \| EXPIRED. |
| `attemptNumber` | number | 1 or 2 (D-#553 caps re-claims at one). |
| `resolvedBy` | ObjectId? | The teacher/Principal who closed it. |
| `resolvedAt` | Date? | |
| `resolution` | `"AUTO" \| "MANUAL"` | AUTO = the ordinary submit path closed it (D-#552). |
| `rejectReason` | `WorkClaimRejectReason?` | Required when `status = REJECTED`. |
| `rejectNote` | string? | ≤200 chars; required only when the reason is `OTHER`. |
| `officeNotifiedAt`, `principalNotifiedAt` | Date? | Ladder idempotency — makes the sweep restart-safe. |
| `lastNudgedAt`, `nudgeCount` | Date?, number | The Office nudge, rate-limited to once per day. |

**Indexes:** `{ recordId: 1, status: 1 }` (the one-open-claim guard + the roster badge lookup) · `{ status: 1, actionDateKey: 1 }` (the 11:30 / 13:00 sweep — it asks "open claims whose action day is today or earlier", so this is the hot one) · `{ studentId: 1, claimedAt: -1 }` · a **partial unique** on `{ recordId: 1 }` where `status = PENDING` — the one-open-claim invariant enforced by the database, not only by the service.

### 5.2 Nothing is added to the record models

`HomeworkStudentRecord` / `AssignmentStudentRecord` gain **no field**. The teacher's screens read the claim by `recordId`. A denormalised `hasOpenClaim` flag would be a second source of truth for a fact the claim row already states, and it would drift the first time a sweep expires a claim.

## §6 — The rules

### 6.1 When may a guardian file? (D-#553)

All five must hold, checked server-side — the app hides the button, the server does not trust that:

1. `assertGuardianOfStudent` passes (the existing link gate).
2. The record's state is **`DUE` or `CHASE`**. Not `GIVEN` (nothing is late yet), not `ABSENT_REDELIVER` (the child never received the work — the answer there is redelivery, which is exactly what RL-1 surfaces), not any post-submit state.
3. No `PENDING` claim exists on that record.
4. `attemptNumber ≤ 2` — one re-claim after a rejection, then the row is closed to the family. A parent who still disagrees is a conversation, not a third row.
5. The record's `dueDate` is within the last **7 school days** (`BACKLOG_DAYS`, the D-#279 window). Older than that, the term's reconciliation owns it.

A duplicate file is **idempotent** — it returns the existing open claim rather than erroring, the same posture as `emit()`.

### 6.2 How it closes (D-#552)

| Path | Result |
|---|---|
| Teacher marks the student submitted — the roster pass, or a direct `transitionHomeworkRecord`/assignment twin | Claim → **ACCEPTED**, `resolution = AUTO`. **No extra tap.** |
| Teacher taps **নাকচ** on the claim and picks a reason | Claim → **REJECTED**. The guardian is told the reason. |
| Principal marks submitted (they hold `tracker:write`) | ACCEPTED, same auto path. |
| Nobody acts for 7 school days | **EXPIRED** by the sweep; it leaves the queue and stays in the audit. |

The auto-resolve hook lives in **`HomeworkRosterPassService` / `AssignmentRosterPassService` and on `transitionRecord`'s submit edge** — one place per tracker, so no future submit path can bypass it.

### 6.3 Visibility is immediate; the notification ladder is same-day (D-#554, owner ruling 2026-08-25)

**Two different things, and the distinction is the whole design.**

**Seeing it is immediate, for all three roles.** The moment a claim is filed it appears on the teacher's Today card and their roster pass, *and* in the Office/Principal queue (§10.6). Nobody waits a day to learn it exists. There is no state in which a claim is filed and a role who could act cannot see it.

**Being told is laddered, by the clock, inside one school day:**

| Fire point | Who | Row |
|---|---|---|
| Immediately, on file | the item's `issuedBy` teacher | `WORK_CLAIM_FILED`, one per claim |
| **11:30** on the action day, still `PENDING` | every active Office user | `WORK_CLAIM_ESCALATED` — **one digest row per user per day** listing every unresolved claim, never one row per claim |
| **13:00** on the action day, still `PENDING` | every active Principal user | `WORK_CLAIM_ESCALATED`, same digest shape |

Both fire points run inside the existing 60-second `SchedulerService` ticker, which already fires at arbitrary `HH:MM` (the attendance tiers use 12:10 / 12:45) and already gates OFF/HOLIDAY days — so **no new scheduling infrastructure**. The dedupe key is `(dateKey, fire point, recipient)`, which makes the rungs restart-safe and lets a claim that stays open re-appear in the *next* school day's 11:30 and 13:00 rows. That repetition is the chasing behaviour, not a bug: a claim nobody answers keeps coming back until somebody does.

**The digest shape is what makes a same-day ladder survivable.** With the Principal now told within hours rather than days, the count matters: one row per person per day listing N claims is one notification; one row per claim is N. At 91 students the second shape makes the Principal's inbox unreadable inside a week, and an unreadable inbox is an ignored one.

### 6.3.1 Which day's 11:30 does a claim get? — the action day (D-#557)

The owner's ruling fixes the clock but not the calendar. Their two worked examples settle it:

> *"tap on the Monday night, or before Thursday 9am"* — both must reach a real 11:30.

- Filed **strictly before 11:30 on a school day** → checked at **that day's** 11:30 and 13:00. *(Thursday 09:00 → Thursday 11:30 / 13:00.)*
- Filed **at any other time** — an evening, 11:35, a Thursday afternoon, a Friday, a holiday → anchors to the **next school day**, checked at that day's 11:30 and 13:00. *(Monday 21:00 → Tuesday 11:30 / 13:00.)*

The rule is "the first school day on which **both** rungs still lie ahead", and it exists to stop one specific failure: a claim filed at 12:00 would otherwise skip the Office rung entirely and reach the Principal at 13:00, having given the teacher one hour. Every claim gets the teacher a full morning, and gets both rungs in order.

It also means a Thursday-afternoon claim waits for Sunday — correct, because nobody can collect a notebook on Friday or Saturday. The scheduler's existing stale-skip rule (a fire point more than 30 minutes past is skipped, never backfilled) is already the right behaviour: a missed 11:30 is picked up by the next school day's 11:30, never replayed at 15:00.

### 6.3.2 Office nudges; Office does not resolve
**Office nudges; Office does not resolve.** `OFFICE` holds no tracker permission at all (`SCOPE_RULES`), so the queue's action button re-fires `WORK_CLAIM_FILED` to the teacher (once per claim per day) and does nothing else. That is the owner's ask read literally — *"the office can chase the teacher for the entry"* — and it keeps the tracker single-authored.

### 6.4 An open claim suppresses the chase push

While a claim is `PENDING`, `emitHwGuardianChase` / `emitAssignmentGuardianChase` **skip that record**. The state still advances and `chaseCount` still increments — the teacher's view is unchanged — but the family is not pushed a reminder for work they have already told the school about. Without this, filing a claim makes the notifications *worse*, and nobody files a second one.

## §7 — Feature B: the return-from-leave card

### 7.1 Who counts as "returning" (D-#555)

Two sources, both derived on every Today load — **no stored row, no sweep, nothing to backfill or repair**:

- **Confirmed (`RETURNED`).** The student is in `absentStudentIds` on the most recent *marked* school day before today, and **not** in today's — which requires today's attendance to be marked. This is the accurate signal and it arrives mid-morning.
- **Expected (`EXPECTED`).** A `StudentLeaveApplication` whose `toKey` is the previous school day. Available from 07:00, before anyone has marked anything, and it is what makes the card useful in the first period.

A student who is both shows once, as `RETURNED`. A student on a still-running leave shows as neither.

### 7.2 What the card shows

Per returning student: name, section, how many school days absent, and their open records split in two —

- **পুনরায় দিতে হবে** — `ABSENT_REDELIVER`. The child never received this. The row's action is the existing redeliver edge.
- **জমা নিতে হবে** — `DUE` / `CHASE`. The child has it and has not handed it in.

### 7.3 Scope, and why it degrades (D-#556)

`myDay` is `authenticated: true` and every field internally re-uses an existing gate. The card follows:

- **Class teacher** of the section → every returning student in it, all subjects.
- **Subject teacher** → only students in classes they have a period with **today**, and only *their own subject's* open items. A teacher must not be handed a list they have no lesson in which to act on.
- **Office / guardian / a caller with neither** → an empty list. Never an error. The D-#532 lesson applies directly: a dashboard field that can refuse is a field that can break the shell.

### 7.4 The push (RL-2 — owner ruling 2026-08-25: *"once the attendance is done, that time will count"*)

One `STUDENT_RETURNED` notification per **student per day**, to the **class teacher** of the section, fired **at the moment the section's attendance for the day is marked** — not at the school-day start, and not from the leave register.

**The card and the push deliberately use different sources.** This is the shape the owner's ruling produces, and it is the right one:

| | Sources | When | Why |
|---|---|---|---|
| **The card** (RL-1) | both — attendance-confirmed **and** leave-register-expected | from 07:00, on every Today load | a class teacher who opens the app in the first period should see who is *due* back |
| **The push** (RL-2) | attendance-confirmed **only** | the instant the section day is marked | a notification is an interruption; it must never be wrong |

**Confirmed-only removes a whole class of false alarm.** The draft proposed pushing at the school-day start off `StudentLeaveApplication.toKey` — which would push the class teacher about a child who then turns out to be still absent. The leave register records an *intention*; attendance records what happened. Pushing on the intention would have trained teachers to distrust the notification within a week. The card can carry a maybe (`ফেরার কথা`, clearly labelled); a push cannot.

**Implementation notes:**

- **Trigger is the SECTION day record**, not a Quran/Arabic `subjectGroupId` record. `StudentAttendanceDay` carries exactly one of the two (§7 shaping), the card is section-scoped, and the recipient is the section's class teacher — so a subject-group marking must not fire it.
- **Fired from the marking path, not the ticker.** `StudentAttendanceService`'s mark/amend seam already knows the section, the day and the absentee list; the return set is a diff against the previous marked day. No new sweep, and no polling for "has attendance happened yet".
- **Dedupe on `(dateKey, studentId, teacherId)`** — an amendment (`amendStudentAttendance`, D-#63 O2) re-saves the day, and re-saving must not re-push.
- **A late amendment that flips a pushed student back to absent does not unsend the push.** Accepted: the card self-corrects on the next load; a notification is a moment in time. Not worth a retraction mechanism.
- The push carries the two counts — how many items to re-deliver, how many to collect — and deep-links to the card.

**One consequence worth stating plainly.** Attendance at this school is often marked late — the AT-4 reminder tiers exist at 12:10 / 12:45 / 14:00 for exactly that reason. So on a slow day this push can arrive around midday rather than in the morning. That is not a flaw in the ruling: the **card** already carries the early `ফেরার কথা` signal from 07:00 for the teacher who opens the app, and the push is the backstop for the teacher who does not. The two halves cover different failure modes, which is why keeping both sources on the card matters.
### 7.5 The card clears itself

It is derived, so it disappears when the underlying facts do: every listed item resolved, or the day ends. There is no dismiss button and no dismissal row to store.

## §8 — Slices

| Slice | What lands | Gate |
|---|---|---|
| **GC-1** | Vocab (3–4 enums + 3–4 notification kinds + 5 audit kinds), `Notification.refs.workClaimId` **in the sub-schema**, the `GuardianWorkClaim` model + the partial-unique index | vocab verifier, server tsc |
| **GC-2** | `WorkClaimService`: `fileWorkClaim` (the five §6.1 guards), `rejectWorkClaim`, the auto-resolve hook in both roster-pass services + both submit edges, the chase suppression (§6.4) | server jest — the guard table, idempotency, auto-resolve from every submit path |
| **GC-3** | Guardian app: the button + claim state on `ChildHomeworkScreen` and `ChildAssignmentsScreen`; the outcome banner | app tsc, expo web export exit 0 |
| **GC-4** | Teacher: `WORK_CLAIM_FILED`, the claim badge on the roster pass, the reject sheet, the Today "অভিভাবকের জানানো" card | server jest + app tsc |
| **GC-5** | Office/Principal queue screen (visible from the moment a claim is filed), the nudge action, the **11:30 / 13:00** rungs + the expiry sweep in `SchedulerService`, and `actionDateKey` resolution at file time | server jest — action-day resolution across evening / mid-morning / Thursday-afternoon / holiday filings, and rung idempotency across a restart |
| **RL-1** | `myDay.returningStudents` — both sources, the two-group split, the scope rules; the Today card | server jest + app tsc |
| **RL-2** | The `STUDENT_RETURNED` push to the class teacher, **fired from the attendance mark/amend seam**, once per student per day | server jest — no push before marking; one push on marking; none on re-save/amend; none from a subject-group marking |

**RL-1 has no dependency on GC-\*.** If only one thing ships this week, it should be RL-1: one derived query and one card, and it drives an engine edge that already exists.

## §9 — Acceptance criteria

**A — the declaration**

- A1. A guardian on a `CHASE` row sees **বাড়িতে সম্পন্ন হয়েছে**; on a `GIVEN`, `ABSENT_REDELIVER` or any post-submit row they do not — and a hand-crafted mutation for those is refused.
- A2. Filing twice on the same record creates **one** row and returns it both times.
- A3. The issuing teacher has a `WORK_CLAIM_FILED` row within a second of the tap, deep-linking to that student's roster pass.
- A4. The teacher marks the student submitted in the ordinary pass, taps nothing else, and the claim reads **গৃহীত**; the guardian gets `WORK_CLAIM_RESOLVED`.
- A5. The teacher rejects with **খাতা আনেনি**; the guardian sees that reason on the card and may file exactly one more time.
- A6. **Visibility:** the instant a claim is filed it is present in the Office and Principal queue and on the teacher's Today card — before any notification has fired.
- A6a. **The clock:** a claim filed Thursday 09:00 and left unresolved puts one row in every Office inbox at Thursday 11:30 and every Principal inbox at Thursday 13:00 — **one row per user per day, not per claim** — and re-running the tick adds nothing.
- A6b. **The action day:** a claim filed Monday 21:00 fires at **Tuesday** 11:30 / 13:00, not Monday's. One filed at 11:35 fires the next school day, never skipping the Office rung to reach the Principal an hour later. One filed Thursday afternoon fires Sunday. A claim still open the following school day appears again in that day's 11:30 and 13:00 rows.
- A7. The Office queue's action fires the teacher's notification again and is refused a second time the same day. Office has no path to change the record's state.
- A8. While the claim is `PENDING`, the day's chase sweep advances the record but pushes the guardian nothing for it.
- A9. Nothing in the claim path is reachable from the corpus plane — the fail-closed firewall test stays green.

**B — the return card**

- B1. A student absent Sun–Tue and present Wed appears on Wednesday's card, marked **৩ দিন পর**, with every open item listed.
- B2. Before attendance is marked, a student whose leave ended Tuesday shows as **ফেরার কথা**; once marked present they become **ফিরেছে**; once marked absent again they leave the card.
- B3. `ABSENT_REDELIVER` items land under **পুনরায় দিতে হবে** and `DUE`/`CHASE` under **জমা নিতে হবে** — never mixed.
- B4. A subject teacher sees only their own subject's items and only classes they teach today; the class teacher sees all.
- B5. An Office login and a guardian login render `myDay` with an empty list and **no error** — the navigator never breaks (D-#532).
- B6. The card is gone the next day, with nothing stored to clean up.
- B7. **No push before attendance.** A student whose leave application ended yesterday appears on the card as **ফেরার কথা** from 07:00 and generates **no notification**. The push fires only when the section's day is marked and confirms they are back.
- B8. That push goes to the **class teacher only** — not one per subject teacher — and re-saving or amending the same day's attendance does **not** re-push.
- B9. A **subject-group** (Quran / Arabic) marking never fires the return push; only the SECTION day record does.
- B10. A student on leave whose application ended yesterday but who is marked **absent** again today produces no push at all, and leaves the card.

## §10 — Wireframes

> Bangla strings below are **proposals** pending §11.1. `[ ]` = button, `( )` = badge.

### 10.1 Guardian — the record card, before filing

```
+------------------------------------------------------+
| গণিত                                                 |
| HW-C4-MATH-0012                                      |
| HW-সবাই চতুর্ভুজ ও ত্রিভুজ ৪ টি করে এঁকে আনবেন           |
|                                                      |
| ( বাড়ির কাজ আনেনি )          <- red, state = CHASE   |
|                                                      |
| প্রদান করা হয়েছে              ২০২৬-০৮-২৪              |
| জমা দেওয়া হয়নি                ২০২৬-০৮-২৫              |
| জমা হয়েছে                     —                       |
|                                                      |
| ( তাগাদা x২ )                                        |
|                                                      |
| +--------------------------------------------------+ |
| |       [ + বাড়িতে সম্পন্ন হয়েছে ]                   | |  <- NEW
| +--------------------------------------------------+ |
| শিক্ষক জানতে পারবেন এবং খাতা চেয়ে নেবেন                 |
+------------------------------------------------------+
```

### 10.2 Guardian — the file sheet (a confirmation, not a form)

```
+------------------------------------------------------+
|  বাড়িতে সম্পন্ন হয়েছে?                             X |
|  --------------------------------------------------  |
|  গণিত · HW-C4-MATH-0012                              |
|  আপনি জানাচ্ছেন যে সন্তান কাজটি বাড়িতে করেছে।            |
|  শিক্ষক খাতা দেখে অ্যাপে জমা লিখে দেবেন।                |
|                                                      |
|  মন্তব্য (ঐচ্ছিক)                                      |
|  +------------------------------------------------+  |
|  | খাতা ব্যাগে দিয়ে দিয়েছি                          |  |  <= ২০০ অক্ষর
|  +------------------------------------------------+  |
|                                                      |
|              [ বাতিল ]        [ জানিয়ে দিন ]          |
+------------------------------------------------------+
```

### 10.3 Guardian — the three states after filing

```
PENDING                          ACCEPTED                       REJECTED
+---------------------------+    +--------------------------+   +-----------------------------+
| ( অপেক্ষমাণ )  ২৫ আগস্ট     |    | ( গৃহীত )   ২৬ আগস্ট      |   | ( নাকচ )    ২৬ আগস্ট         |
| আপনি জানিয়েছেন — শিক্ষকের  |    | শিক্ষক জমা লিখে দিয়েছেন।  |   | শিক্ষক: খাতা আনেনি           |
| উত্তরের অপেক্ষায়।           |    | ( জমা হয়েছে )             |   | [ আবার জানান ] <- once only |
+---------------------------+    +--------------------------+   +-----------------------------+
```

### 10.4 Teacher — the Today card, and the badge where the teacher already works

```
+- আজ -------------------------------------------------+
| অভিভাবকের জানানো                          ( ৩ )      |
| ---------------------------------------------------  |
| * আয়েশা সিদ্দিকা · ৪র্থ-মূল · গণিত                    |
|   "বাড়িতে সম্পন্ন হয়েছে" · ২৫ আগস্ট · ১ দিন            |
|   HW-C4-MATH-0012                                    |
|                        [ খাতা নিয়েছি ]   [ নাকচ ]     |
| * রায়হান কবির · ৪র্থ-মূল · ইংরেজি · ২ দিন   ! অফিসকে  |
|   জানানো হয়েছে                                        |
|                        [ খাতা নিয়েছি ]   [ নাকচ ]     |
|                                        আরও দেখুন ->  |
+------------------------------------------------------+

জমা নেওয়া (the roster pass) — the same fact, in the teacher's existing flow:

  ছাত্র/ছাত্রী             জমা দেয়নি
  -----------------------------------
  আয়েশা সিদ্দিকা    [প]      [ x ]      <- [প] = a guardian says it is done
  রায়হান কবির       [প]      [ x ]
  তানজিলা আক্তার            [ x ]
```

### 10.5 Teacher — the reject sheet

```
+------------------------------------------------------+
|  কেন জমা লেখা যাচ্ছে না?                            X |
|  --------------------------------------------------  |
|  আয়েশা সিদ্দিকা · গণিত · HW-C4-MATH-0012              |
|                                                      |
|   (o) খাতা আনেনি                                      |
|   ( ) খাতা পাইনি                                      |
|   ( ) অসম্পূর্ণ                                        |
|   ( ) আগেই জমা লেখা হয়েছে                             |
|   ( ) অন্যান্য  ->  +----------------------------+    |
|                     +----------------------------+    |
|                                                      |
|  অভিভাবক এই কারণটি দেখতে পাবেন।                       |
|              [ বাতিল ]          [ নাকচ করুন ]         |
+------------------------------------------------------+
```

### 10.6 Office / Principal — the queue

Visible to all three roles from the moment a claim is filed. The **checkpoint** column, not an age in days, is what the same-day ladder made the sort key.

```
+- অভিভাবকের জানানো — অনিষ্পন্ন --------------------------------------------+
|  [ সব ]  [ ১১:৩০ পার ]  [ ১৩:০০ পার ]                    মোট: ৭          |
|  ---------------------------------------------------------------------  |
|  অবস্থা      ছাত্র/ছাত্রী     শ্রেণি    বিষয়   শিক্ষক        পদক্ষেপ         |
|  ---------------------------------------------------------------------  |
|  ১৩:০০ পার  রায়হান কবির    ৪র্থ-মূল  ইংরেজি  আফিজা ম্যাডাম [ তাগাদা ]   |  <- red
|  ১১:৩০ পার  আয়েশা সিদ্দিকা  ৪র্থ-মূল  গণিত    আরিফা ম্যাডাম [ তাগাদা ]   |  <- amber
|  ১১:৩০ পার  মমিন উদ্দিন     ৩য়-মূল   বাংলা   আথিক স্যার    ( পাঠানো )   |  <- nudged
|  ১১:৩০-এর   সুমাইয়া খাতুন   ৫ম-মূল   গণিত    আরিফা ম্যাডাম     —        |     already
|   অপেক্ষায়                                                              |
|  ---------------------------------------------------------------------  |
|  অফিস জমা লিখতে পারে না — শুধু শিক্ষককে মনে করিয়ে দিতে পারে।              |
+--------------------------------------------------------------------------+
```

Row 4 is the shape the draft could not show: a claim **already visible to the Office and the Principal, before either has been notified**. That is the separation D-#554 turns on.

A claim filed after 11:30 shows `আগামীকাল ১১:৩০` — the action day (§6.3.1) rendered where staff can see it, so nobody reads a quiet row as a missed one.

### 10.7 Teacher — the return-from-leave card (RL-1)

```
+- আজ -------------------------------------------------+
| ছুটি শেষে ফিরেছে                          ( ২ )       |
| ---------------------------------------------------  |
| * আয়েশা সিদ্দিকা · ৪র্থ-মূল       ( ৩ দিন পর )         |
|                                                      |
|   পুনরায় দিতে হবে                                     |
|   · গণিত   HW-C4-MATH-0009      [ দিয়েছি ]            |
|   · বাংলা  AS-C4-BAN-0003       [ দিয়েছি ]            |
|                                                      |
|   জমা নিতে হবে                                        |
|   · ইংরেজি HW-C4-ENG-0011  ( তাগাদা x১ )              |
|                                                      |
| * রায়হান কবির · ৪র্থ-মূল        ( ফেরার কথা )          |
|   ছুটি শেষ ২৪ আগস্ট · হাজিরা এখনো নেওয়া হয়নি            |
|   পুনরায় দিতে হবে                                     |
|   · গণিত   HW-C4-MATH-0010      [ দিয়েছি ]            |
+------------------------------------------------------+
```

## §11 — Owner rulings (ratified 2026-08-25)

1. **The Bangla strings are accepted as drawn** — including `তাগাদা দিন` on the Office nudge. The `তাগাদা`/`মনে করিয়ে দিন` ambiguity was raised and the owner confirmed the wording; it is closed, not deferred.
2. **RL-2 ships. The push is in**, not held back for a week of observation. The design recommendation was to watch the card first; the owner ruled for the push, so it is in the slice list as committed work (§7.4).
3. **Escalation is same-day, by the clock — this SUPERSEDES the +1/+2-school-day ladder the draft proposed.** Everyone (teacher, Office, Principal) *sees* the claim immediately; the Office is *notified* at **11:30** and the Principal at **13:00** if the teacher has not marked it (§6.3, D-#554).
4. **Assignments are in scope from the start** — one claim type across both trackers, exactly as drawn. No change from the draft.
5. **The action day is confirmed (D-#557).** The rule inferred from the owner's two examples — *"the first school day on which both rungs still lie ahead"* — was put back to them and accepted. Monday night → Tuesday 11:30; Thursday 09:00 → that same Thursday.
6. **The RL-2 push fires when attendance is marked** — *"once the attendance is done, that time will count"* — not at the school-day start, and not from the leave register. This **replaces** the draft's proposed fire point (§7.4). The card keeps both sources; only the push is narrowed to the confirmed one.

**No open questions remain. Every value in this document is either an owner ruling or a stated derivation from one.**

## §12 — Out of scope

Contact-only guardians (no inbox — the recorded D-#31/#72 limitation; they are reached by the existing manual `wa.me` paths) · a photo of the completed work attached to the claim (a real idea, but it makes this a file-upload feature with a storage and PII surface; revisit once the loop is proven) · any guardian-written lifecycle state · claims on class tests, vocab tests or the Saturday revision · a claim-rate report per teacher (an obvious later analytic, and it must stay on the operational plane).

## §13 — Traceability

| Decision | Statement |
|---|---|
| **D-#551** | A guardian claim NEVER writes a lifecycle state. It is a parallel `GuardianWorkClaim` row recording an assertion and whether anyone has answered it; the tracker stays single-authored by the teacher. |
| **D-#552** | The claim auto-resolves on the teacher's ORDINARY submit path — the roster pass and both submit edges — so the feature adds no tap for the person it is asking to act. The only manual close is an explicit reject **with a reason from a picker**, because "no answer yet" and "the child genuinely didn't bring it" must not look the same to the Office. |
| **D-#553** | Claimable states are `DUE`/`CHASE` only, one PENDING claim per record (partial-unique, enforced in the DB), one re-claim after a rejection, and a 7-school-day window. `ABSENT_REDELIVER` is deliberately excluded — the answer there is redelivery, which RL-1 surfaces. |
| **D-#554** | **SEEING and BEING TOLD are separated.** All three roles — teacher, Office, Principal — see a claim in their queue the instant it is filed. Notification is a same-day ladder by the clock: teacher immediately, **Office at 11:30**, **Principal at 13:00**, each as **one digest row per user per day** listing every unresolved claim. Office can nudge and cannot resolve — `OFFICE` holds no tracker permission and this feature does not grant one. *(Owner ruling 2026-08-25, superseding the draft's +1/+2-school-day ladder. The digest shape is now load-bearing: at hours-scale the per-claim shape would put N notifications a day into the Principal's inbox instead of one, and it is the same 60s ticker either way — the attendance tiers already fire at 12:10/12:45, so neither time needs new infrastructure.)* |
| **D-#555** | The return-from-leave card is DERIVED on every Today load from two sources (attendance-confirmed, leave-application-expected) — no stored row, no sweep, nothing to backfill. |
| **D-#556** | The card is scoped by the caller's routine reach (class teacher = whole section; subject teacher = own subject, classes taught today) and permission-degrades to an empty list, never an error (the D-#532 rule). The RL-2 push is narrower still on **both** axes — **class teacher only** (one returning student would otherwise push every subject teacher who meets them that day) and **attendance-confirmed only**, fired from the marking seam (owner ruling 2026-08-25). The card may show a maybe; a push may not. Pushing off the leave register would notify a teacher about a child who then turns out to still be absent, and a notification teachers learn to distrust is worse than none. |
| **D-#557** | **Every claim is stamped with an ACTION DAY at file time (`actionDateKey`), and the 11:30 / 13:00 rungs read that field rather than re-deriving it.** The action day is the first school day on which both rungs still lie ahead: filed before 11:30 on a school day → that day; filed at any other time → the next school day. *(Derived from the owner's own two examples — "Monday night" and "before Thursday 9am" — which only both reach a real 11:30 under this rule. It exists to stop a 12:00 filing skipping the Office rung and reaching the Principal an hour later, and storing it rather than recomputing it stops the ladder depending on when the ticker happened to run. Inferred, then **put back to the owner and confirmed 2026-08-25**.)* |
