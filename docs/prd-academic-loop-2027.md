# PRD — The 2027 academic loop + dev test data (`academic loop` · পাঠ থেকে মূল্যায়ন পর্যন্ত)

**Status:** PLANNED 2026-11-21 (docs only; nothing built by this PR). Revised the same day after a fresh-context
review (confirm guards, budget arithmetic, reuse of the built auto-issue / mark ladder, pauses,
substitutes, teaching units, release switch, dev safety, loop-health slice), then again with the owner's answers
to the review's questions (R17–R34, 21 Nov 2026), a dated launch plan (§8.1), and the owner's answers to the last
open questions (R35–R36, 21 Nov 2026: every §10 question is now closed).
**Decision block:** D-#1667–#1678, taken against `origin/dev@cf14bd46` (max D-#1665; D-#1666 is held by the
Telegram bot PR). Rows say "owner 21 Nov" only for the owner's answers; every other choice is marked
**proposed — open Q#** (§10); since R35–R36 every such Q# is closed (R36 accepts the proposals, R35 replaces Q11).
**Source:** the owner's flow A–G (cloud-session handoff, 21 Nov 2026) and the owner's answers to the grilling
round the same day (§1). Every "built" claim below was checked against the code on `origin/dev@cf14bd46`.
**Builds on (read these first; this PRD does not repeat them):** `docs/prd-lesson-progress.md` (LP-1..4),
`docs/prd-mastery.md` (M-0..M-6), `docs/prd-objective-tree.md`, `docs/prd-mastery-class-test-link.md` (PR-C),
`docs/prd-mastery-homework-from-lesson.md` (PR-D/J/K), `docs/prd-ct-weak-objectives.md`, `docs/prd-guardian-help.md`
(GH-1..4), `docs/prd-tracker-assignment.md` (AS-T6 cap, AS-T7 handout board), `docs/prd-print-queue.md`,
`docs/prd-mark-submission-guard.md` (D-#889–#893).
**Plane:** operational / identity (ADR-005). Nothing here gives the corpus plane a path to a child, a guardian or
a staff member; the fail-closed firewall test must keep passing.

## §0 — At a glance

The school already has every piece of the loop "teach → homework → weekly assignment → class test → weak
objectives → support" **except the glue**: homework and the weekly assignment have no per-question marks, so
nothing outside the optional mastery papers reaches `MasteryEvidence`; questions can repeat because only class-test
sets are counted; and nobody proposes the week's assignment. This PRD adds that glue without a second model: every
2027 homework and weekly assignment **is** a mastery paper (`MasteryPaper` + exceptions-only `MasteryResult`), so
the existing diagnosis, guardian views, re-teach trigger and the live homework-honesty flag start working on real
data. Everything new that writes evidence sits behind one release switch (§3.6, default OFF), so the live 2026
classes and the December exams see no change.

| Slice | What | PR |
|---|---|---|
| AL-0 | **One lead contract PR**: every `shared/vocab.ts` / `shared/permissionCatalogue.ts` change of AL-1…AL-13 | lead |
| AL-1 | Dev "no outgoing" kill switch, fail-closed on `_dev` DBs (push, chat, Telegram, AI providers, Drive) | server |
| AL-2 | Prod → dev copy with masked identities (lead-only runbook + mask script) + the fake-activity generator frame | server script + runbook |
| AL-3 | One question-use history for HW + AS + CT (per শাখা and per child); QU-1 reads it | server (+ tiny app badge) |
| AL-4 | Homework = HW mastery paper: link at declare, confirm guards, tick-wrong marks, evidence, write-back, "send to print" | server |
| AL-5 | Homework screens: question picker, tick-wrong grid, send to print, marks on profile + guardian | app |
| AL-6 | Weekly assignment = AS paper: per-question marks, cap/day budget, day split, CT counted | server, then app |
| AL-7 | Suggestion engine + automatic draft + subject-swap suggestion + per-child load | server |
| AL-8 | Suggestion review screen, swap card, load panel, Office/Principal view + comment | app |
| AL-9 | Marking deadlines on the **existing** mark-submission ladder (a "marks entered" stage) | server, then app |
| AL-10 | Guardian: hints on class homework, number + level word, a **separate weekly message per child**, "ক্লাস মিস" | server, then app |
| AL-11 | Term target dates per class × subject → on track / behind N (teaching days only); Principal alert | server, then app |
| AL-12 | Outside-help flag extensions (class + subject teacher investigate, notices, tag surfaces, settable gap) | server, then app |
| AL-13 | Loop health + January readiness + bank stock | server, then app |

After AL-0 the slices go **strictly one after another** (one PR each, server before app). The fake-activity
generator is not a last slice: AL-2 builds its frame and each later slice adds its own scenario (§9.3). The
handoff's S-1…S-7 are renumbered (§8 says why). **Everything must be live (switch OFF) before the first school day,
Sun 3 Jan 2027** (R33); the dated plan is §8.1.

## §1 — The owner's rulings (21 Nov 2026; settled — do not re-ask)

| # | Topic | Ruling |
|---|---|---|
| R1 | No-repeat | 4 weeks, **configurable**; tracked **per শাখা and per child**. A homework question **never** goes into an assignment (this PRD reads "never" as *within the academic year*). Class-test questions count too: HW + AS + CT share **one** use history. |
| R2 | Suggestion engine | **Both**: an automatic draft every **Wednesday** and on request. Chapters = taught so far (recent weighted higher) + each child's weak objectives + revision of older chapters (taken from the lesson marks, **not** chapters the teacher ticks). Subjects follow the rotation table (2–3 a week); the system may suggest a **swap** when another subject has many weak objectives; a teacher/Office accepts. |
| R3 | Marks | Per-question marks on homework **and** the weekly assignment. Entry = **tick only the wrong/partial questions** (all start full). Guardians see number + level word (e.g. "৮/১০ — ভালো"). Homework is marked the **same day** it comes in; the assignment (handed in Sunday) by **Tuesday**; reminders + a late list for the Principal. |
| R4 | Weak objective | = the existing mastery levels (`mastery/diagnosis.ts`): WEAK if the last two assessments < 50 %, 15 below the শাখা, rework or light signals; MASTERED = 2 distinct first-try ≥ 70 % in separate weeks; revision after 4, then 8 weeks. **No new % rule.** |
| R5 | Re-teach | Half the class below 50 % on an objective — already built (`MasteryAction`, `sectionTriggerPct` 50). |
| R6 | Weekly rhythm | Teacher finalises Wed/Thu → Office prints Thu → home Thu, ~3 h Fri + ~3 h Sat → handed in Sunday. Cap **6 h/week (360 min)**, at most **3 h a day**. Time = **1.8 min per mark**. |
| R7 | Submission | Paper; the teacher records it (no guardian photo upload). |
| R8 | Homework print | The teacher taps "প্রিন্টে পাঠান" (no automatic print request). |
| R9 | Homework picking | The app drafts questions from what was taught (unused first); the teacher sees, swaps, removes, adds. |
| R10 | Tailored top-up | The teacher decides per child (no fixed cap; warn above 3 h a day). |
| R11 | Absent child | Missed objectives show **"ক্লাস মিস"** (not weak) until practised; the next assignment gives **1–2 easy questions** on them; the guardian home guide (built). |
| R12 | Approval | The **subject teacher alone** finalises the weekly assignment; the Office prints; the Principal/Office can view and comment. |
| R13 | Guardian view | Per subject: weak + improving objectives + what to practise (with hints), kind words, **no ranking**. A **weekly** summary notification (marks + weak/improving), not one per mark. |
| R14 | Syllabus on time | The Office sets **term target dates per class × subject** (half-yearly portion + annual); the tracker shows on track / behind by N sessions; the Principal is alerted at **2+ weeks behind**. |
| R15 | Dev test data | Copy prod → dev, **mask phones/emails** (fake logins + one shared test password), a **new dev kill switch** for outgoing notifications; classes **Nursery to Class 5**; **8 weeks** of fake 2027 activity; testers = owner + Claude first, then 2–3 teachers. |
| R16 | Outside-help flag | Keep HW% − CT% ≥ **20 points** per objective, **adjustable** (Principal). Investigators: **class teacher first**, plus Office and the **subject teacher**; the Principal sees all. A new case notifies the investigator **and** the Principal. After the outcome the tag shows on the student profile (staff), marks reports (HW/AS marks on a tagged objective carry a note), the guardian-meeting brief, and the guardian portal (gentle note, e.g. "বাড়ির কাজ শিশুকে নিজে করতে দিন"). Outcomes stay অভিভাবক করে দিয়েছেন / শিশু নিজে করেছে / অস্পষ্ট; recurring = 2+ cases in a term. |

**Second round — the owner's answers to the review's questions (21 Nov 2026; settled):**

| # | Topic | Ruling |
|---|---|---|
| R17 | MASTERED needs school | Homework / assignment alone can **never** make a child MASTERED; at least one good **in-school** answer (class test or in-class work) is required. Homework can still show WEAK / IMPROVING. The re-teach (section) trigger also needs in-school results. |
| R18 | Outside-help rule | **Keep as now**: any CT row on the objective + the 20-point gap; no "≥ 2 questions" or class-wide filter. The gap stays adjustable. |
| R19 | Class-test block | A class test **blocks** (not warns) any question the শাখা or a child had as homework or assignment in the last 4 weeks (from the use history). |
| R20 | No locked tree on 1 Jan | Per-question **marks are still recorded** (marks without objectives); no weak-objective tracking until the tree is locked. |
| R21 | Bank share | Homework may use at most **half** of each objective's unused questions; the rest is kept for assignments and class tests; a "weeks of stock left" warning when low. |
| R22 | Non-bank homework | Textbook exercise, reading, memorising, handwriting are allowed as **free lines without marks**, tracked done / not done. |
| R23 | Homework repeat | No unused homework question left → the **least-recently-used** older one may repeat, marked "আবার". |
| R24 | Missed-lesson items | At most the **3 most recent** missed objectives per subject per week get easy questions; the rest carry over. |
| R25 | Hours by class | 6 h a week, at most 3 h a day, **Class 1–5 alike** (no per-class setting); **Nursery/KG have no weekly assignment**. |
| R26 | Time | **1.8 min per mark for both homework and the weekly assignment** (replaces the per-subject grid × 2 for 2027). |
| R27 | Thursday homework | The Thursday class homework comes **on top of** the weekly assignment (not counted in the 6 h). |
| R28 | Teacher on leave | Subject teacher on leave Wed/Thu → the day's **substitute or the Office** may finalise the system's draft. |
| R29 | Swap acceptor | The swap card is accepted by the **class teacher or the Office**; both subject teachers are told. |
| R30 | Late marks | **Term 1:** the late list + the Principal's card only. **From term 2:** also the quiet staff-mistake record. |
| R31 | Guardian weekly message | A **separate weekly message per child** (not merged into the D-#452 digest); nothing sent in a week with no marks. |
| R32 | Level words + help note | খুব ভালো ≥ 90 % · ভালো ≥ 70 % · মোটামুটি ≥ 50 % · আরও অনুশীলন দরকার < 50 %. The guardian homework-help note shows **only** after "অভিভাবক করে দিয়েছেন", and the tag lasts the **term**. |
| R33 | Launch | **Everything** (all slices) ready before the first school day of January 2027; the release switch stays **OFF** until the owner turns it on after dev testing. |
| R34 | Fake data | A **rehearsed 2027 year** on dev: run the 2027 year change on dev first, then generate 8 weeks of Jan–Feb 2027 activity. |
| R35 | No result word on marked work (Q11) | Remove the CORRECT / PARTIAL / WRONG wording for marked homework and assignments: screens show **only the marks and the percentage** (e.g. ৭/১০ · ৭০%). Guardians also see the level word (R32). |
| R36 | The other open questions | Accepted **as proposed** (owner 21 Nov 2026): Q4 অস্পষ্ট tags staff surfaces only, for the term; Q6 `swapSuggestWeakPct` 30, recent = last 3 weeks, weight 3 : 1, revision 20 %; Q12 school weeks for MASTERED + the ≥ 50 % in-school roster guard on re-teach; Q13 no back-fill of marks-only papers; Q14 free-line kinds TEXTBOOK / READING / MEMORISE / HANDWRITING / OTHER with teacher minutes; Q15 guardian weekly message Wednesday 18:00; Q16 RUBRIC counts as in-school; Q17 no dev-wide clock in v1 (history views + `dev-tick.ts --at`). |

"Term" in R30 and R32 is the existing GH-3 term (the two halves of the academic year, D-#1529), so tags, the
recurring badge and the late-marks rule share one definition; the syllabus-target portions (§3.3) keep their own
exam-based start.

## §2 — What is built vs what the handoff assumed

Checked on `origin/dev@cf14bd46`, 21 Nov 2026.

| Step | State | Where (reuse) | Gap |
|---|---|---|---|
| A. Mark the session taught | **Built** (LP-1..4) | `lesson-progress/models/LessonDelivery.ts`, `LessonDeliveryService`, class-note picker | School switch `LessonProgressConfig.classNoteQuestionOn` is OFF (on in 2027) |
| A. Office/Principal progress | **Built** | `LessonProgressService` (`lessonProgressOverview`, `lessonSectionTracker`), `screens/lessonprogress/` | "On time" is only `pacePerWeek` + `projectedFinishKey` — **no target date** (AL-11) |
| B. Homework picked from the bank | **Partly** | `masteryHomeworkDraft` → HW `MasteryPaper` (D-#1321), `HomeworkFromLessonLink.tsx`; `HomeworkItem.selectedQids` in the API (`trackers/resolvers/homework.ts`) | **No app screen sends `selectedQids`**; `ClassNoteHomeworkService` only stores tags + a count (AL-4/5) |
| B. Print | **Partly** | `printing/models/PrintRequest.ts` (purpose HOMEWORK); extra-HW PDF `mastery/routes/masteryExtraPdf.ts`; assignment PDF `mastery/routes/masteryAssignmentPdf.ts` | `PRINT_SOURCES` = SET / CONTENT_ARTIFACT / UPLOAD / LINK — a mastery paper cannot be sent; no class-homework PDF (AL-4) |
| B. Guardian hints | **Partly** (GH-1 merged #1512, D-#1527) | `guardian-help/services/GuardianHintService.ts` | Reads assignment sheets, extra HW, `selectedQids`/`topupQids` — **not** a class HW mastery paper (AL-10) |
| B. Submission | **Built** (matches R7) | tracker lifecycle; `GuardianWorkClaim` is only a claim | — |
| B. Per-question HW marks (GH-2) | **Partly** | `MasteryPaper.items[].marks`, `MasteryResult` (exceptions), `MasteryEntryScreen.tsx` | Tracker rows have no marks; no fast whole-শাখা grid; **`MasteryWorkService.trackerDefaults` maps GIVEN and "no record" to PRESENT** → a confirm before the submit pass would write false 100 % evidence (AL-4 guard) |
| C. Rotation | **Built** | `trackers/models/AssignmentSchedule.ts` (Thu delivery, Sun due, 4-week cycle, cell `teacherId`) | — |
| C. Weekly cap | **Built at 360 min** (D-#323, 15 Jul 2026) | `AS_WEEKLY_CEILING_MIN = 360` in `shared/vocab.ts`; `confirmAssignmentWeek` hard-blocks | Handoff/fact-check said 180 — **stale**. Missing: the **3 h per day** split and a settable key (AL-6) |
| C. Week auto-issue | **Built** (D-#839) | `trackers/services/AssignmentAutoIssueService.ts` (sweep calls `confirmAssignmentWeek` when every rotation cell is delivered and within the cap) | None — AL-6 finalise only feeds it |
| C. Hand-in ladder | **Built** (D-#889–#893) | `trackers/services/MarkReminderService.ts` (due-day pop-ups, 09:30 Office/Principal snapshot, `mark_submission:alerts`, substitute reach), `MarkCorrectionService.ts`, quiet mistake record (D-#1020) | No stage for "per-question marks entered" (AL-9) |
| C. Time per mark | **Partly** | `QUESTION_TIME_RATES` grid × `SET_TYPE_TIME_MULTIPLIER` (HW/AS = 2); 1.8 only for the 2027 subjects (D-#1440) | R26: flat 1.8 for homework **and** the weekly assignment from 2027 (AL-0 / AL-4 / AL-6) |
| C. Per-question AS marks | **Partly** | mastery AS paper (`links.assignmentId/asItemId`) → `MasteryResult` → `MasteryEvidence` | `AssignmentStudentRecord` holds one total; a non-tailored week has no paper (AL-6) |
| C. Question-use history | **Partly** (QU-1, D-#608) | `assessment/services/QuestionUsageService.ts` | Counts `AssessmentSet.basketItems` only — not homework, not mastery papers; no window (AL-3) |
| C. Suggestion engine | **Not built** | Only Part B bands (`assignmentBuilder.ts`) and `masteryHomeworkDraft` | All of §4 (AL-7/8). The `masteryAssignmentDrafts` weekly family in prd-mastery §8 **does not exist** in `SchedulerService` |
| C. Calendar pauses | **Built** (D-#1655, D-#86) | `academic-pause/` (`ASSIGNMENT_GENERATION`, `ASSIGNMENT_CHASE`, `HOMEWORK_REQUIRED`), holiday rolls, SUSPENDED weeks in `resolveScheduleWeek` | Every new job must honour them (§7) |
| D. Tailored assignment | **Built** (M-4) | `MasteryAssignmentService.ts`, `assignmentBuilder.ts`; `MasteryAssignment` is **unique per ISO week × শাখা × subject** | The weekly assignment *is* the tailored one; between weeks = extra homework. Gap: per-child load across subjects (AL-7) |
| D. Extra homework for weak children | **Built** (D-#1322–#1325, PR-J) | `MasteryHomeworkService` | — |
| D. Weak per child + trend | **Built** | `mastery/diagnosis.ts`, `MasteryDiagnosisService`, `MasteryRollupService` | Gets no HW/AS evidence until AL-4/AL-6; `EvidenceLike` carries **no `source`**, so R17 (MASTERED needs an in-school answer) cannot be expressed today (§3.8) |
| D. Guardian weekly homework digest | **Built** (D-#452) | `trackers/services/HomeworkWeeklyDigestService.ts` (17:00 on the last open day of the Sun–Thu week, per guardian × child) | Stays as it is: R31 wants a separate weekly message per child (AL-10) |
| E. Missed vs weak | **Built** (D-#950, GH-4 D-#1528) | `StudentLessonService`, `ObjectiveLessonService`, `ChildMissedLessonsScreen.tsx`, 13:00 `LESSON_MISSED` | "ক্লাস মিস" as its own state + easy items in the next assignment (AL-7/10); home-guide packs not loaded yet (content) |
| F. CT → objectives | **Built** | `ClassTestWeakObjectiveService` (`weakLoCodes` ≤ 5), `mastery/classTestLink.ts` (PR-C; group-anchored tests take no sheet) | CT questions are not in the use history; a sheet is optional (AL-3/6) |
| F. Re-teach flag | **Built** | `MasteryAction` SECTION trigger (`sectionTriggerPct` 50, `sectionTriggerMinAssessments` 2; % = WEAK ÷ children **with a verdict**) | With few children assessed the trigger can fire on a small minority (Q12, accepted R36) |
| Outside-help flag | **Built + LIVE** (GH-3, D-#1529, #1514) | `homework-integrity/` (`IntegrityCase`, `IntegrityService`, nightly `HWINT`) | 0 cases on prod (no HW/AS/CT evidence); gap is a constant `INTEGRITY_GAP_POINTS = 20`; Office + Principal only; no notices; no tag surfaces (AL-12) |
| Policy keys | **Built** mechanism | `MASTERY_POLICY_DEFAULTS` (`shared/vocab.ts`), `MasteryPolicy` (SCHOOL row + class × subject overrides), `MasteryPolicyScreen.tsx` | New keys (§3.5) |
| Bank coverage | **Built** | `MasteryBankCoverageService` (resolver `masteryBankCoverage`) | No "weeks of stock left" (AL-13) |
| Dev safety | **Not built** | `platform/services/ExpoPush.ts`, `notifications/services/webPushChannel.ts`, `chat/services/ChatPushService.ts` post unguarded; `index.ts` always registers channels + the ticker; AI providers (DeepSeek / Gemini / Claude) and `DriveStore` call out whenever keys exist | AL-1; `server/scripts/seed.ts` deletes identity rows — never run it |

**Stale records found** (corrected here, not rewritten in place):
- `docs/prd-guardian-help.md` header: "GH-1..3 not built" — GH-1 (#1512, D-#1527) and GH-3 (#1514, D-#1529) are merged and live; GH-2 is the only unbuilt GH slice (AL-4/5/6 build it).
- `docs/prd-ct-weak-objectives.md` header: "not merged" — the code (`weakLoCodes`, `ClassTestWeakObjectiveService`) is on dev.
- `STATUS.md` "## Now / next" (line ~1952) still describes import contract v1.1; the live cursor is the dated log at the top.
- `docs/prd-tracker-assignment.md` §11 title "3-hour cap" and the handoff's "180 → 360" step: the cap has been 360 since D-#323.
- `docs/prd-mastery.md` §8 lists `masteryAssignmentDrafts` / `masteryRevisionDue` / `masterySectionTrigger` as scheduler families: revision-due is computed on read, the section trigger runs after each confirmation, and the weekly drafts family was never built.
- The mastery entry roster (`MasteryWorkService.rosterOf`) still sorts by `rollNumber`; the school has no roll numbers (D-#1463) — the new grid sorts by student ID (AL-4/5 fix it at the source).

## §3 — Data model (gaps only; no duplicate models)

### 3.1 Decision: per-question marks live on the mastery paper (D-#1669)

Every 2027 homework and every weekly assignment of a class × subject with mastery ON **is** a `MasteryPaper`
(source HW / AS), linked to its tracker row. Per-question marks are the existing exceptions-only `MasteryResult`;
confirmation writes `MasteryEvidence` exactly as today. **No per-question fields are added to `HomeworkItem`,
`HomeworkStudentRecord` or `AssignmentStudentRecord`.**

Why: (1) `MasteryEvidence` (source HW/AS/CT) is the only input the diagnosis, the re-teach trigger, the guardian
mastery page and the GH-3 honesty flag read — a second marks store would need a second evidence writer and would
drift; (2) the tick-wrong entry the owner asked for **is** the exceptions model (no row = full marks);
(3) the class test already works this way (PR-C), so all three kinds share one entry screen and one correction
path. Rejected: `HomeworkStudentRecord.items[]` marks (duplicates `MasteryResult`, no LO codes, no evidence).

**Link.** `HomeworkItem.paperId?` points at the paper; `MasteryPaper.links.hwItemId` is made unique for class
homework by a partial index `{ "links.hwItemId": 1 }` with `partialFilterExpression: { extra: false,
"links.hwItemId": { $exists: true } }` — a partial index cannot use `$ne`, so AL-4 first backfills `extra: false` on
every existing paper without the field, runs a duplicate check (refuses to build the index while two class papers
share an item), then builds it. The AS paper keeps its existing `links.asItemId`.

**Confirm guards (new; fixes the `trackerDefaults` hole).** For a paper linked to a tracker item:
1. Confirm is **refused while any original roster record is GIVEN or DUE** ("আগে জমা নেওয়ার হিসাব শেষ করুন: …"
   naming the children) — the submit pass must have left every record SUBMITTED, CHASE or ABSENT_REDELIVER first.
2. `trackerDefaults` changes: SUBMITTED / CHECKED / RETURNED / RESUBMIT → PRESENT; CHASE → NOT_SUBMITTED;
   ABSENT_REDELIVER → ABSENT; **a roster child with no tracker record is left off the paper** (no result row, no
   evidence, never "full marks") — e.g. a child who joined after the homework was given.
3. The manual check path is guarded the way `classTestEntryGuard` guards the class test: on a record whose item has a
   linked paper, `checkHomeworkRecord` / `checkAssignmentRecord` with a result or marks is refused ("প্রশ্নভিত্তিক
   শিটে নম্বর দিন"); only the paper's confirm/correction writes them. Records with no linked paper are unchanged.
4. **Items lock once given.** After "প্রিন্টে পাঠান" (or issue, whichever first) the paper's items cannot change;
   changing a question needs the print request cancelled first (the Office has not printed it yet) — so what the
   children got and what the marks grid shows never differ.

**Derived cache on the tracker** (written only by the paper's confirm / correction):

| Model | Field | Meaning |
|---|---|---|
| `HomeworkStudentRecord` | `earnedMarks?`, `availableMarks?` (new) | The child's total on the linked paper |
| `AssignmentStudentRecord` | `marks` (existing) + `availableMarks?` (new) | Σ earned / Σ available on **the child's own items** (Part B totals differ by child; ½ marks allowed) |
| both | `result` (existing) | **No result word on marked work (R35).** Every screen that shows a linked record (teacher grid, profile TrackerTab, reports, guardian) shows `earned / available · N %` and never the CORRECT / PARTIAL / WRONG label. The stored `result` is still filled internally (≥ 70 % CORRECT, ≥ 50 % PARTIAL, < 50 % WRONG — the policy's `masteredAtPct` / `weakBelowPct`) only so 2026 readers (counts, filters) keep working; it is never displayed for a linked record. Unlinked 2026 items keep their word. |
| `AssignmentItem` | `doOnDay?: FRI \| SAT \| BOTH`, `minutesByDay?: {FRI, SAT}` (new) | The per-day split (§4.4) |

Confirm moves every SUBMITTED record of the paper to CHECKED (one entry = check + marks).

**Void / revert.** Deleting an OPEN paper with no results, or a tracker undo that withdraws the issue (e.g.
`homework:undo` of the issue step, `assignment:undo_any`), sets `withdrawnAt` on its `QuestionUse` rows and excludes
its evidence (`excludedAt`, reason "বাতিল", `MasteryExclusion` path) so states recompute; nothing is hard-deleted.
A post-confirm marks change goes through the existing correction path and writes a `MarkCorrectionService`
correction note like the class test's (D-#889–#893), so the quiet mistake record sees it.

**Class × subjects without a locked objective tree (R20).** Marks are still recorded per question: the paper is a
**marks-only** paper (`MasteryPaper.marksOnly: true`), allowed without `MasteryEnablement` and without `loCodes`.
Each item's marks come from the bank question's own marks (or the teacher's figure for a teacher item); the same
grid, confirm guards, tracker cache, `QuestionUse` rows, print and guardian "number + level word" apply, but
**confirm writes no `MasteryEvidence`**, so no weak-objective state, no re-teach trigger and no GH-3 case can come
from it. When the tree is later locked and mastery switched on, new papers are normal papers; the marks-only papers
stay as they are (no back-fill — accepted R36, Q13). This closes the old Q2.

**Free lines without marks (R22).** A homework may carry, beside or instead of bank questions, free lines
`HomeworkItem.freeLines[{ kind: TEXTBOOK | READING | MEMORISE | HANDWRITING | OTHER, textBn, estMinutes }]`. They have
no marks and no evidence; per child they are tracked done / not done as exceptions on the record
(`HomeworkStudentRecord.freeLinesNotDone: number[]`, empty = all done once SUBMITTED). Their minutes are the
teacher's `estMinutes` (they have no marks to time). A homework of free lines only has no paper and follows the
tracker flow with the done / not-done ticks.

### 3.2 `QuestionUse` — one use history for HW + AS + CT (D-#1667)

New collection in `assessment/` (beside QU-1):

```
QuestionUse {
  qid,                                  // never the artifactId (QU-1 rule: re-imports make new rows)
  kind: HW | AS | CT | EXTRA_HW | RETEST,
  sourceType: MASTERY_PAPER | ASSESSMENT_SET | HOMEWORK_ITEM,
  sourceId, itemNo?,
  academicYearId, sectionId, classToken, subject,
  studentIds: ObjectId[],               // [] = the whole শাখা roster; else only these children (Part B, extra HW, top-up)
  givenOn: "YYYY-MM-DD" (Dhaka),        // the day it went to the children
  withdrawnAt?                          // a paper deleted / an issue undone before results (§3.1)
}
indexes: {sectionId, givenOn}, {studentIds, givenOn}, {qid, givenOn}
```

- **Written when a question is given**, not when drafted: HW paper at "send to print" or issue (whichever first);
  AS paper at finalise; extra HW at create; CT at sheet link (`givenOn` = exam date) and at `AssessmentSet` print for
  unlinked tests (a group-anchored test writes one row per member শাখা); RETEST at re-test sheet create. Drafts are
  not uses (two teachers' drafts never block each other); the builders still treat **open unconfirmed sheets** as
  seen for the child (`openExtraSeen` stays).
- **Why a ledger and not a read over the sources:** four sources with four shapes (`basketItems`, `selectedQids`,
  `items[]`, `perStudentItems`), different "given" moments, and per-child rows. One indexed collection makes the
  no-repeat check a single query per শাখা per week. Rejected: a derived read (four joins per suggestion).
- **QU-1 is re-pointed, not duplicated:** `questionUsageCounts` / `questionUsage` read `QuestionUse` (same output +
  a `kind` field), so the bank badge shows homework and assignment uses too. Gate unchanged (`question_sets:view`).
- **Backfill** (`server/scripts/backfill-question-use.ts`, dry run first, idempotent by
  `(sourceType, sourceId, itemNo, qid)`): from `AssessmentSet.basketItems`, `HomeworkItem.selectedQids`,
  `HomeworkStudentRecord.topupQids`, and every `MasteryPaper` (items + `perStudentItems`).
- **Rules read from it** (§4.3): never an HW question in an AS within the **academic year** (per শাখা and per child);
  no question given to the শাখা or the child within `assignmentNoRepeatWeeks × 7` **days** (days, not ISO weeks —
  the tracker's Sun–Sat weeks and mastery's ISO weeks differ).
- **Class-test block (R19):** adding a question to a class test of a শাখা — a CT `AssessmentSet` basket, the CT
  question request, or a CT mastery sheet — is **refused** when that শাখা, or any child on its roster (Part B, extra
  homework, top-up), had it as HW, EXTRA_HW or AS within `assignmentNoRepeatWeeks × 7` days ("এই প্রশ্ন গত ৪ সপ্তাহে
  বাড়ির কাজ / অ্যাসাইনমেন্টে ছিল"). The check runs at add and again at finalise / print.
- **Homework bank share (R21):** per শাখা × objective × academic year, homework may take a bank question only while
  the homework-used count on that objective stays ≤ `homeworkBankSharePct` (50) % of the objective's gold pool; the
  rest of the pool is kept for assignments and class tests. When the homework share is used up, the R23 repeat rule
  applies (§4.7), then a book exercise as a free line.
- A child's per-child history follows the child; whole-শাখা uses of an earlier শাখা are read through the child's
  `Enrolment` history, and a merged শাখা reads its `SectionMerge.sourceSectionIds` (§3.7).

### 3.3 Term target dates (D-#1675)

New `SyllabusTarget` in `lesson-progress/models/`:
`{ academicYearId, classToken, subject, term: HALF_YEARLY | ANNUAL, targetDate, endChapter, endSessionIndex,
setBy, setAt }` — unique (year, classToken, subject, term). The end point is a session in book order (the session
plans' stable key, prd-lesson-progress §1); ANNUAL defaults to the last session.

**Term start:** HALF_YEARLY starts on `AcademicYear.startDate`; ANNUAL starts the school day after the last
half-yearly exam day of that class (the exams module's routine), or, with no exam recorded, the day after the
half-yearly `targetDate`; its first session is the one after the half-yearly end point.

**Teaching days only:** a day counts when `calendar.ts` says it is an open school day **and** it is not an exam day
of that class (exam routine) **and** no `AcademicPause` window covering it switches off assignments/homework for the
class. Holidays (incl. Eid/Ramadan holidays, `HolidayException`) are excluded by the calendar. A shorter-period season
(`ScheduleWindow`, e.g. winter or Ramadan timings) still counts as a teaching day — the pace is counted in sessions per
period, not in minutes.

On-track read (added to `lessonProgressOverview` / `lessonSectionTracker`): `expectedByToday` = sessions from the term
start to the end point × (teaching days elapsed ÷ teaching days from term start to `targetDate`);
`behindBy = expectedByToday − finished` (≥ 0); `weeksBehind = behindBy ÷ the শাখা's routine periods per week for
that subject`. State: ON_TRACK (`behindBy` = 0), BEHIND (N sessions), NO_TARGET.

### 3.4 Outside-help flag extensions (D-#1676)

`IntegrityCase` gains `investigatorIds[]` (the class teacher(s) of the child's শাখা and the subject teacher(s) of the
objective's subject there, at open time), `notes[{ by, at, text }]` (any investigator), `tagActive: boolean` and
`tagUntil` (the end of the term in which the outcome was recorded, R32). The **case rule itself is unchanged**
(R18): any CT evidence row on the objective + HW% − CT% ≥ the gap; no minimum number of questions and no class-wide
filter. Tag rules (R32): outcome অভিভাবক করে দিয়েছেন → `tagActive` for the rest of the term on staff surfaces **and**
the guardian homework-help note; অস্পষ্ট → the staff tag only (no guardian note; accepted R36, Q4); শিশু নিজে করেছে →
no tag. The gap and the recurring count move to policy keys (§3.5). Tag surfaces read the cases; they do not copy
them.

### 3.5 Policy keys (flat, like D-#1321)

All in `MASTERY_POLICY_DEFAULTS` (numbers/booleans only, as `MasteryPolicyValues` requires). Keys marked **S** are
school-wide: read from the SCHOOL row only; a class × subject override is refused. Defaults marked † are proposals
(Q6 / Q12 / Q15, all accepted R36), the rest come from the rulings or existing behaviour. Hours and time are the same for Class
1–5 (R25), so none of them has a class override.

| Key | Default | S | Meaning |
|---|---|---|---|
| `academicLoop2027On` | **false** | S | The release switch (§3.6) |
| `assignmentNoRepeatWeeks` | 4 | | No question repeats for a শাখা or a child within 4 × 7 days (HW/AS/CT history) |
| `weeklyAssignmentHoursCap` | 6 | S | Week cap per শাখা (360 min); replaces the read of `AS_WEEKLY_CEILING_MIN` (the constant stays as the default) |
| `perDayHours` | 3 | S | At most 3 h of assignment on one home day (Fri / Sat) |
| `subjectsPerWeekMin` / `subjectsPerWeekMax` | 2 / 3 | S | Subjects in a week (rotation) |
| `minutesPerMark` | 1.8 | S | Time per mark for homework **and** the weekly assignment (R6, R26; replaces the grid × 2 while the release switch is on; class tests keep the exam grid) |
| `homeworkBankSharePct` | 50 | | Homework may use at most this share of an objective's gold pool per শাখা per year (R21) |
| `masteredNeedsInSchool` | true | | MASTERED needs ≥ 1 good in-school answer; the section trigger reads in-school results (R17, §3.8) |
| `suggestRecentWeeks` | 3 † | | Chapters taught in the last 3 weeks are "recent" |
| `suggestRecentWeight` | 3 † | | Weight of a recent chapter vs 1 for an older one (3:1) |
| `suggestRevisionPct` | 20 † | | Share of the common part from older chapters |
| `suggestMissedEasyQuestions` | 2 | | Easy questions per missed objective (R11: 1–2) |
| `suggestMissedObjectivesPerWeek` | 3 | | Only the 3 most recent missed objectives per subject per week get easy questions; the rest carry over (R24) |
| `swapSuggestWeakPct` | 30 † | | A non-rotation subject whose শাখা has ≥ 30 % WEAK verdict rows (and more than the weakest rotation subject) is offered as a swap |
| `asDraftLeadDays` | 1 | S | The automatic draft runs 1 school day before the resolved delivery day (Thursday → Wednesday) |
| `asDraftHour` | 6 | S | …at 06:00 Dhaka |
| `hwMarkDeadlineDays` | 0 | S | Homework marked on the day it comes in (R3) |
| `asMarkDeadlineDow` | 2 | S | Assignment marked by Tuesday (0 = Sunday; R3) |
| `termBehindAlertWeeks` | 2 | S | Principal alert at 2+ weeks behind a term target (R14) |
| `lateMarksMistakeFromTerm` | 2 | S | Late marking feeds the quiet staff-mistake record from this term on (R30) |
| `guardianSummaryDow` / `guardianSummaryHour` | 3 / 18 † | S | The separate weekly guardian message per child: Wednesday 18:00 (after the Tuesday marking deadline, a day before the Thursday digest; accepted R36, Q15) |
| `sectionTriggerMinAssessedPct` | 50 † | | Re-teach fires only when ≥ 50 % of the roster has an in-school item on the objective (Q12, accepted R36) |
| `integrityGapPoints` | 20 | S | HW% − CT% that opens a case (replaces `INTEGRITY_GAP_POINTS`); edited with `homework_integrity:settings` |
| `integrityRecurringCases` | 2 | S | Cases in a term that make a child "recurring" |

The policy screen gets one card "সাপ্তাহিক চক্র" for the S keys (`mastery:settings`); the two integrity keys sit on
the হোমওয়ার্ক যাচাই screen (`homework_integrity:settings`). All of them land in the one AL-0 contract PR.

### 3.6 Release switch (D-#1678)

`academicLoop2027On` (SCHOOL row, default **false**). While it is off: declaring homework creates no paper and writes
no tracker cache; no AS paper is made for a non-tailored week; the confirm guards and the manual-check guard of §3.1
do not apply; `ASDRAFT`, the "marks entered" stage and the guardian weekly message do not run; the 1.8 min/mark
time (R26), the class-test block (R19), the homework bank share (R21) and the in-school rule for MASTERED (R17) are
not applied, so 2026 states and timings do not move during the December exams. Turning it on recomputes every
`MasteryState` once (batch). `QuestionUse` writing,
term targets (AL-11) and the outside-help extensions (AL-12) run regardless (they change nothing for a 2026 class
without new evidence). The Principal turns it on for the 2027 year after the December exams and the readiness list
(AL-13) is green. Existing mastery papers made by hand keep working as today either way.

### 3.7 Teaching units supported

- **Supported:** the শাখা (`Section`), including every gender-split বালক / বালিকা শাখা (each split is its own
  Section). Homework and assignment tracker items are section-anchored only, so every paper, use row and grid is per
  শাখা.
- **Merged sections (D-#62):** while two শাখা sit merged, reads of `QuestionUse`, `LessonDelivery` and evidence for the
  merged শাখা also read its `SectionMerge.sourceSectionIds`, so a question used in either source শাখা in the window
  is excluded; on a split back, per-child rows travel with the child.
- **Not in this loop (v1):** cross-class subject groups (Quran / Arabic, D-#48/#56) — Quran is outside the homework
  tracker (D-#36) and a group-anchored class test takes no sheet (PR-C); the Class 5 class-wide scholarship practice
  group (D-#896) — the scholarship module keeps its own papers, which do not enter `QuestionUse` or evidence.
- **Nursery / KG:** homework (marks, free lines, marks-only papers where no tree is locked) yes; **no weekly
  assignment** (R25), so `ASDRAFT`, the swap card and the assignment deadlines never run for them.

### 3.8 MASTERED needs an in-school answer (R17; D-#1670)

Today `diagnosis.ts` replays `EvidenceLike` rows that carry no source, although every `MasteryEvidence` row stores
`source` (the paper's). Design:
- `EvidenceLike` gains `source` and a derived `inSchool: boolean`; the replay (`MasteryDiagnosisService`) maps it from
  the evidence row. **In-school sources:** CT, RETEST, RUBRIC (teacher-observed in class) and a new paper source
  **CW** — "ক্লাসের কাজ" (in-class work marked in the period: same paper, entry and evidence path as HW, never printed
  for home, never a tracker item). HW, AS and extra HW are at-home. (RUBRIC as in-school is accepted R36, Q16.)
- **MASTERED** (with `masteredNeedsInSchool`): the existing rule **and** at least one of the counted good distinct
  questions is in-school. When the rule holds only on at-home items: a child who was WEAK / IMPROVING shows IMPROVING;
  a child with no earlier verdict shows IMPROVING with the note "ক্লাসে যাচাই বাকি". At-home items still make WEAK and
  IMPROVING exactly as today (R17).
- **Revision:** a good at-home revision item leaves REVISION_DUE as it is; only a good in-school item returns the
  objective to MASTERED (+ `revisionThenWeeks`); a poor item of any source → WEAK (path restarts).
- **Section (re-teach) trigger:** evaluated on in-school evidence only — a child counts as weak for the trigger when
  the in-school earned % on the objective (its last two in-school items) is below `weakBelowPct` (or the section-gap
  rule); the denominator is the children with ≥ 1 in-school item; `sectionTriggerMinAssessments` counts in-school
  papers. The child's own state (WEAK from homework) is unchanged by this.
- The extra-homework and assignment Part B pickers keep reading the child's state, so homework-weak children still get
  support.
- Pure-function tests in `diagnosis` cover: four good HW items → IMPROVING, not MASTERED; + one good CT item in another
  week → MASTERED; a good HW revision item → still REVISION_DUE; 16/28 WEAK on homework but 3/20 weak in class → no
  re-teach proposal.

## §4 — Suggestion engine (D-#1668)

### 4.1 When
- **Automatic:** scheduler family `ASDRAFT` runs `asDraftLeadDays` school days **before the resolved delivery day**
  (the D-#86 roll: a Thursday holiday moves delivery to Wednesday and the draft to Tuesday), at `asDraftHour`.
  It skips a SUSPENDED week (no open day, or an `ASSIGNMENT_GENERATION` pause, D-#1655). For each শাখা, one DRAFT
  `MasteryAssignment` per rotation subject with mastery ON and no assignment yet for that week. A `jest.mock` stub is
  added to the DB-free scheduler test. Notice to each subject teacher: "সাপ্তাহিক অ্যাসাইনমেন্টের খসড়া তৈরি" + a
  Today card.
- **On request:** "প্রস্তাব দিন" on the assignment screen builds (or, after a confirm dialog, rebuilds) the DRAFT.
  A rebuild never touches a finalised assignment.
- Subjects with mastery OFF are listed as "নিজে তৈরি করুন" (the 2026 tracker flow). Class 1–5 only; Nursery / KG have
  no weekly assignment (R25).
- **One per week:** the weekly assignment *is* the tailored assignment (`MasteryAssignment` is unique per ISO week ×
  শাখা × subject). Support between weeks is the extra homework for weak children (PR-J), not a second assignment.

### 4.2 Inputs
1. **Subjects:** this week's rotation cells (`cycleWeek`) for the শাখা, 2–3 (`subjectsPerWeekMin/Max`).
2. **Chapters:** chapters with sessions marked taught for the শাখা × subject (`LessonDelivery`), never chapters ticked
   by hand. Recent (`suggestRecentWeeks`) weighted `suggestRecentWeight` : 1. No lesson marks → the engine says so and
   offers the chapter list for the teacher to choose (the only manual case).
3. **Per child:** the diagnosis states (WEAK, IMPROVING, REVISION_DUE) on tagged objectives of those chapters and any
   earlier ones; "ক্লাস মিস" objectives (§5-E3).
4. **History:** `QuestionUse` (§3.2) for the শাখা (and merge sources) and each child; MasteryEvidence `seenQids`.
5. **Load:** each child's other subjects this week and any extra homework given for the weekend (§4.4).

### 4.3 Exclusions (hard)
- Any qid used as **HW** for this শাখা (or, for Part B, this child) **this academic year** — never in an assignment.
- Any qid with a use (HW / AS / CT / extra / re-test) for the শাখা or the child within `assignmentNoRepeatWeeks × 7`
  days.
- Part B (per child): never a qid in that child's `seenQids` (the mastery rule: a repeat cannot prove mastery).
- Not gold / unpublished / held for an exam (`examHold`), untagged (grouping) objectives, RUBRIC objectives.
- A question beyond the window is allowed only when no unseen one exists for that objective; it is ranked last and
  shown with "আবার".

### 4.4 Budget, composition, day split
- **Week budget** = min(`weeklyAssignmentHoursCap`, 2 × `perDayHours`) × 60 = 360 min, held as two **day budgets**
  (Fri 180, Sat 180).
- **Subject share** = week budget ÷ number of subjects (2 → 180 each, 3 → 120 each); its marks = floor(share ÷
  `minutesPerMark`).
- **Inside a subject**, Part A (common) and Part B (per child) split the subject's marks in the ratio of the existing
  layout keys `assignmentPartAMarks : assignmentPartBMarks` (default 5 : 10 → one third common) or the teacher's
  remembered layout. The subject's **counted minutes** = (Part A marks + the **median** child's Part B marks) ×
  `minutesPerMark`.
- **Day split:** subjects are placed largest first on the lighter day; a subject that does not fit whole **spans both
  days** (`doOnDay = BOTH`, `minutesByDay`) — the sheet prints "শুক্রবার: প্রশ্ন ১–৬ · শনিবার: প্রশ্ন ৭–১২".
  Each day's counted minutes ≤ `perDayHours` × 60.
- **Common part:** (100 − `suggestRevisionPct`) % from recent chapters, the rest from older chapters; inside a chapter,
  objectives ranked by the শাখা's WEAK + IMPROVING count, then least evidence.
- **Per child:** the existing builder (`assignmentBuilder.ts`, mix weak/improving/revision), plus
  `suggestMissedEasyQuestions` easy questions (`tags.difficulty = easy`, else the lowest marks) per "ক্লাস মিস"
  objective, for only the `suggestMissedObjectivesPerWeek` (3) **most recent** missed objectives of that subject; the
  older ones carry over to the next week (R24). The teacher decides each child's extra size (R10).
- **Per-child load:** for each child and each home day, Σ over all the week's subjects (Part A + that child's Part B
  on that day) + extra homework given for the weekend. Shown to **every subject teacher of the week and the class
  teacher** ("শিশুর সাপ্তাহিক চাপ"); a day over `perDayHours` shows a warning and still saves (R10). The Thursday class
  homework is shown on the panel as its own line but **is not counted** in the 6 h or the day budgets (R27).
- **Question pick per slot:** never-seen in the শাখা first, then least-used, then oldest last use; ties broken by a seed
  of (শাখা, week) so a rebuild with the same inputs gives the same draft.

### 4.5 Swap card
- Shown when a mastery-ON subject not in this week's cells passes `swapSuggestWeakPct` and has more WEAK rows than the
  weakest rotation subject: "এই সপ্তাহে <X>-এর বদলে <Y>?".
- Accepted by the শাখা's class teacher or the Office (`assignment:accept_swap`; owner, R29). Accepting: the dropped subject's DRAFT is deleted (a confirm dialog warns if its teacher already edited it; a
  finalised subject cannot be swapped), the new subject's draft is built by the engine, and both teachers are
  notified. The dropped subject's teacher = the rotation cell's `AssignmentSchedule.teacherId`; the new subject's
  teacher = the routine slot holder for that শাখা × subject (`RoutineSlot`). The rotation table is not changed.
  Ignoring = no change; the card expires at the delivery day.

### 4.6 Teacher override, finalise, audit
- The subject teacher (or a substitute covering that শাখা today, §7) sees every item with its reason ("দুর্বল: …",
  "আগের অধ্যায়ের পুনরাবৃত্তি", "ক্লাস মিস"), and can **swap** (alternatives for the same objective that pass §4.3),
  **remove**, **add** any bank question (§4.3 re-checked; an HW question or an in-window repeat is refused with the
  reason), and edit a child's Part B.
- **Shortfall is never silent:** a child with no unseen question for an objective (`NO_UNSEEN_QUESTION`, sheet
  NEEDS_REVIEW) is flagged on the draft day with a notice to the teacher; finalise lists every NEEDS_REVIEW sheet and
  is refused until each is resolved (a teacher item, a past-window "আবার" question, or the item removed), so Thursday's
  print is never blocked by a sheet nobody saw.
- **Finalise** = the existing `sendAssignment` (subject teacher only, R12). When the subject teacher is on approved
  leave on the Wednesday or Thursday, the day's substitute (an active `RoutineSubstitution` on that শাখা) **or the
  Office** (`assignment:finalise_on_leave`) may finalise the system's draft, with or without edits (R28); the audit row
  names who finalised and why. Refused when the week's counted minutes
  would pass the week budget or a day would pass its day budget (naming the overage). It delivers the tracker item
  (DRAFT with `estMinutes` = the subject's counted minutes and `doOnDay` / `minutesByDay`). **Issuing is not new:** the
  existing D-#839 sweep (`AssignmentAutoIssueService`) confirms the week once every rotation cell is delivered and the
  week is within the cap; an over-cap week waits for the class teacher as today.
- **Audit:** the draft stores `suggestion { builtBy: ENGINE|TEACHER, at, inputs: {chapters, weakCounts, excluded:
  {hw, window, seen}}, reasons[] }`; every override writes an audit row `AS_SUGGESTION_EDIT` (before/after qid, who).
  The Principal/Office see drafts and finalised weeks and can comment (`assignment:comment`); a comment notifies the
  subject teacher.

### 4.7 Homework draft rules (the daily class homework; R9, R21–R23, R26)
- Draft = `masteryHomeworkDraft` from the sessions taught that day, unused first (§3.2), within the homework bank share
  (`homeworkBankSharePct`, R21).
- **No unused question left** (or the share used up) → the **least-recently-used** question the শাখা had before (any
  kind, oldest last use first) may repeat, marked "আবার" (R23); a question given to the শাখা in the last
  `assignmentNoRepeatWeeks × 7` days is still not repeated. Nothing suitable → the book exercise as a free line.
- Free lines (§3.1) can be added by the teacher at any time.
- Time = marks × `minutesPerMark` (1.8) for bank / teacher items + each free line's `estMinutes`; the daily tally
  against `HW_DAILY_CEILING_MIN` (120) uses that sum (R26).
- Every homework question used becomes "homework-used" for the year, so it never enters that শাখা's (or child's)
  assignments (R1) and blocks class tests for 4 weeks (R19).

## §5 — Per-role journeys and acceptance (feeds e2e)

REUSE = existing code, unchanged or extended; NEW = built by the named slice. Criteria are numbered for tests. All
NEW behaviour assumes `academicLoop2027On` = true unless the AC says otherwise.

### A. Teach the session; keep the syllabus on time
| Step | Who | What | Reuse / new |
|---|---|---|---|
| A1 | Teacher | Opens the class note after the period, picks the session(s) finished | REUSE LP-1 (`MyClassNotesScreen`, `LessonDeliveryService`); switch ON in 2027 |
| A2 | Office | Sees sessions done per class / শাখা / subject | REUSE LP-2 `LessonProgressScreen`, `LessonTrackerScreen` |
| A3 | Office | Sets the half-yearly end session + date and the annual date per class × subject | NEW AL-11 (`SyllabusTarget`, screen "লক্ষ্য তারিখ") |
| A4 | Office / Principal | Sees "সময়মতো" / "N সেশন পিছিয়ে" per শাখা × subject | NEW AL-11 |
| A5 | Principal | Gets a notice when a শাখা × subject is 2+ weeks behind | NEW AL-11 (weekly family `LPBEHIND`) |

- **AC-A1** Given a target of session 40 by 30 June and 50 % of the term's teaching days gone, When a শাখা has 15
  sessions finished, Then it shows "৫ সেশন পিছিয়ে" (expected 20).
- **AC-A2** Given that শাখা has 2 periods a week for the subject and is 4+ sessions behind, When `LPBEHIND` runs, Then
  the Principal gets one notice for it (dedupe key holds the week, the শাখা × subject and the recipient); a second run
  that week sends nothing.
- **AC-A3** Given no target for a class × subject, Then the row shows "লক্ষ্য দেওয়া নেই" and no alert is sent.
- **AC-A4** Only `lesson_progress:set_targets` can save a target; a teacher's call is refused.
- **AC-A5** Given 5 exam days and a 3-day holiday inside the term, Then neither counts as a teaching day: the expected
  sessions are not raised by them; a winter-timings week counts as normal teaching days.
- **AC-A6** The ANNUAL term starts the school day after the class's last half-yearly exam day (or after the
  half-yearly target date when no exam is recorded).

### B. Homework with per-question marks
| Step | Who | What | Reuse / new |
|---|---|---|---|
| B1 | Teacher (or today's substitute) | After the class note, opens homework: the app drafts questions from the session(s) taught, unused first | REUSE `masteryHomeworkDraft`; NEW AL-4/5 picker in `DeclareHomeworkScreen.tsx`, unused = `QuestionUse` |
| B2 | Teacher | Swaps, removes, adds questions; saves | NEW AL-5; server REUSE `createMasteryPaper` + NEW link to `HomeworkItem` at declare (AL-4) |
| B3 | Teacher | Taps "প্রিন্টে পাঠান"; the items lock | NEW AL-4 print source `MASTERY_PAPER` + class-homework PDF |
| B4 | Office | Prints and delivers from the queue | REUSE print queue (`printing:process`) |
| B5 | Guardian | Sees the homework and opens hints one step at a time | REUSE `ChildHomeworkScreen`, GH-1; NEW AL-10 hints for class HW papers |
| B6 | Teacher | Records who handed it in (paper) | REUSE `homework:mark_submitted` (submit pass) |
| B7 | Teacher | Same day: ticks only wrong/partial questions in one grid for the whole শাখা (children by student ID), confirms | NEW AL-5 grid; REUSE `MasteryResult` exceptions + confirm → `MasteryEvidence` |
| B8 | System | Records → CHECKED with the child's total; the student profile shows it | NEW AL-4 write-back; REUSE `TrackerTab.tsx` (shows marks) |
| B9 | Guardian | Sees "৮/১০ — ভালো" on the homework card and in the separate weekly message per child | NEW AL-10 (`GWSUM`) |
| B10 | Office / Principal | Unentered marks show on the existing mark-submission snapshot and the Principal's card; from term 2 also the quiet mistake record | NEW AL-9 stage over REUSE `MarkReminderService` |

- **AC-B1** Given sessions taught today with bank questions, When the teacher opens homework, Then the draft lists them,
  none used by the শাখা before; a question used last week by the শাখা is offered only when no unused one exists.
- **AC-B2** Given a saved homework, Then one HW `MasteryPaper` (`extra: false`) exists with `links.hwItemId` = the item
  and `HomeworkItem.paperId` set; a second class paper for the same item is refused by the partial unique index.
- **AC-B3** "প্রিন্টে পাঠান" creates one `PrintRequest` (purpose HOMEWORK, source `MASTERY_PAPER`, copies
  `CLASS_PRESENT`); no print request is ever made without the tap; a `QuestionUse` row per question is written; after
  it, an item edit is refused until the print request is cancelled.
- **AC-B4** Given 28 children, all records SUBMITTED / CHASE / ABSENT_REDELIVER, 3 with ticked items (one ½ of 2 on item
  3) and 1 ABSENT, When the teacher confirms, Then 27 children have evidence, 24 at full marks; the ½ child's objective
  drops by ½; their records are CHECKED with `earnedMarks/availableMarks`.
- **AC-B5** A correction after confirm supersedes only that child's evidence, rewrites only that child's totals and
  writes one correction note.
- **AC-B6** The guardian card shows marks and a level word only, never the answer; no notification is sent per mark.
- **AC-B7** A class × subject with mastery OFF, or `academicLoop2027On` = false, keeps the 2026 result flow
  byte-for-byte (tracker tests green): no paper, no cache, no guard.
- **AC-B8** Given 2 records still GIVEN or DUE, When the teacher confirms, Then it is refused naming both children; no
  evidence is written.
- **AC-B9** Given a roster child with no tracker record for the item, When the paper is confirmed, Then that child has
  no result row and no evidence (never full marks).
- **AC-B10** Given a linked record, When `checkHomeworkRecord` is called with a result, Then it is refused with the
  sheet message; a record of an unlinked item checks as today.
- **AC-B11** Given the issue is undone (or the OPEN paper deleted) before results, Then its `QuestionUse` rows carry
  `withdrawnAt` and the questions are offered again; after confirm, a void excludes the evidence and states recompute.
- **AC-B12** (R35) Given confirmed marks 7/10, Then the teacher grid, the student profile and the guardian screen show "৭/১০ · ৭০%" (guardian also "ভালো") and no CORRECT / PARTIAL / WRONG word anywhere; the internal `result` is CORRECT (7/10), PARTIAL (5/10), WRONG (4½/10).
- **AC-B13** (R20) Given a class × subject with no LOCKED tree, When the teacher saves bank homework, Then a marks-only
  paper is made; confirming it writes the tracker totals and `QuestionUse` rows but **no** `MasteryEvidence`; the
  guardian sees "৮/১০ — ভালো".
- **AC-B14** (R22) Given a homework of "পাঠ ৩ পড়ে আসবে" + "হাতের লেখা ১ পৃষ্ঠা", Then it saves with no marks; ticking one
  child's handwriting line "হয়নি" stores it in `freeLinesNotDone`; no evidence is written; the daily tally uses the
  lines' minutes.
- **AC-B15** (R21) Given an objective with 10 gold questions and 5 already used as homework by the শাখা this year, Then
  the draft offers no further unused question on it for homework; the AS / CT pickers still see the other 5.
- **AC-B16** (R23) Given no unused question within the share, Then the draft offers the least-recently-used one the শাখা
  had (more than 28 days ago), marked "আবার"; with none, a book-exercise free line.
- **AC-B17** (R26) With the switch on, a 10-mark homework counts 18 minutes in the daily tally (not grid × 2).
- **AC-B18** (R32) Level words: 9/10 খুব ভালো, 7/10 ভালো, 5/10 মোটামুটি, 4/10 আরও অনুশীলন দরকার.

### C. Weekly assignment (revision)
| Step | Who | What | Reuse / new |
|---|---|---|---|
| C1 | System | 1 school day before delivery: drafts per rotation subject | NEW AL-7 `ASDRAFT` |
| C2 | Subject teacher | Reviews reasons, swaps/removes/adds, edits a child's extra part, sees each child's load | NEW AL-8 over REUSE `MasteryAssignmentScreen` / `MasteryAssignmentSheetScreen` |
| C3 | Class teacher / Office | Accepts or ignores a subject-swap card | NEW AL-7/8 |
| C4 | Subject teacher | Finalises (Wed/Thu) | REUSE `sendAssignment`; NEW AL-6 budget checks + delivery |
| C5 | System | Issues the week when every cell is delivered and within the cap | REUSE D-#839 `AssignmentAutoIssueService` (existing behaviour) |
| C6 | Principal / Office | View drafts + finalised weeks; comment | NEW AL-8 (`assignment:comment`) |
| C7 | Office | Prints Thursday (per-child pages) | REUSE print queue + assignment PDF; NEW AL-4 source |
| C8 | Teacher | Records hand-in on Sunday | REUSE `collectAssignment` + the D-#889 due-day ladder |
| C9 | Teacher | By Tuesday: tick-wrong grid (each child sees only own items), confirm | REUSE grid (AL-5) on the AS paper; REUSE union-paper rule |
| C10 | System | `AssignmentStudentRecord.marks` / `availableMarks` derived; evidence written | NEW AL-6 write-back |

- **AC-C1** Given a শাখা with BAN + MATH in this week's cells and Thursday open, When `ASDRAFT` runs on Wednesday, Then
  two DRAFT assignments exist, each ≤ 180 counted minutes, together ≤ 360; a second run creates nothing.
- **AC-C2** No draft item is a question used as homework by that শাখা this academic year, or used by the শাখা or that
  child (any kind, incl. CT) in the last 28 days.
- **AC-C3** A teacher adding an HW question is refused with the reason; adding an in-window repeat is refused; adding an
  unseen gold question succeeds and writes an `AS_SUGGESTION_EDIT` audit row.
- **AC-C4** Given BAN 150 + MATH 150 + SCI 90 counted minutes, When the third subject is finalised, Then it is refused
  (390 > 360) naming the overage.
- **AC-C5** (existing behaviour, kept green) When the last rotation cell is delivered within the cap, Then the D-#839
  sweep issues the week (present → GIVEN, absent → ABSENT_REDELIVER) without a class-teacher step.
- **AC-C6** A swap card appears only when the non-rotation subject passes `swapSuggestWeakPct`; the শাখা's class
  teacher or the Office accepts it (R29); accepting deletes the dropped subject's draft, builds the new subject's draft
  and notifies both subject teachers (cell `teacherId` and the routine slot holder); the rotation table is unchanged; a
  plain subject teacher is refused; a finalised subject cannot be swapped.
- **AC-C7** A child's top-up that pushes their day past 3 h shows a warning and still saves (R10).
- **AC-C8** Rebuilding with the same inputs gives the same draft (seeded ranking).
- **AC-C9** (three-subject week passes) Given BAN, MATH, SCI with layout 5 : 10 and 1.8 min/mark, Then each subject
  share is 120 min = 66 marks (22 common + 44 per child at the median), BAN goes on Friday (120), MATH spans Friday 60 +
  Saturday 60, SCI on Saturday (120): Friday 180, Saturday 180, week 360 — all three finalise.
- **AC-C10** The load panel shows, for each child and day, the sum across all the week's subjects plus weekend extra
  homework, to every subject teacher of the week and the class teacher; the Thursday class homework is listed but not
  counted in the 360 / 180 budgets (R27).
- **AC-C11** Given a child's sheet NEEDS_REVIEW (no unseen question), Then the teacher is notified on the draft day and
  finalise lists that sheet and is refused until it is resolved; nothing reaches the print queue half-built.
- **AC-C12** Building a second assignment for the same ISO week × শাখা × subject is refused; the screen points to
  "দুর্বলদের বাড়তি বাড়ির কাজ" (extra homework) for support between weeks.
- **AC-C13** Given a Thursday holiday, Then delivery rolls to Wednesday (D-#86) and `ASDRAFT` runs on Tuesday; given a
  week inside an `ASSIGNMENT_GENERATION` pause, Then no draft, no notice and no marking reminder for it.
- **AC-C14** (R28) Given the subject teacher on approved leave on Thursday, Then that day's substitute for the শাখা or an
  Office user may finalise the draft (audit names them); another teacher is refused; on a normal day the Office cannot
  finalise.
- **AC-C15** (R25) No draft, swap card or assignment deadline exists for a Nursery or KG শাখা; the same 360 / 180 budget
  applies to every Class 1–5 শাখা.

### D. Weak points and tailored support
| Step | Who | What | Reuse / new |
|---|---|---|---|
| D1 | System | HW/AS/CT evidence → each child's state per objective | REUSE `diagnosis.ts` (R4: no new rule) |
| D2 | System | Weak objectives feed the next draft's Part B | REUSE builder; NEW AL-7 wiring |
| D3 | Teacher | The weekly assignment is the tailored one; between weeks, extra homework | REUSE M-4 + PR-J |
| D4 | Teacher / Office | Improving or not, per child | REUSE `MasteryStudentScreen`, trend |
| D5 | Guardian | Per subject: weak + improving + what to practise (hints), kind words, no ranking | REUSE `ChildMasteryScreen`; NEW AL-10 separate weekly message (`GWSUM`) |

- **AC-D1** Given two HW items < 50 % on LO-X in the last two assessments, Then LO-X is WEAK and appears in the next
  draft's Part B for that child with the reason "দুর্বল".
- **AC-D2** Given a WEAK child then 2/2 on a different question next week, Then IMPROVING (existing rule).
- **AC-D3** No guardian surface shows another child, a rank or a শাখা average.
- **AC-D4** (R17) Given four good at-home items on LO-X in two weeks and no in-school item, Then LO-X is IMPROVING
  ("ক্লাসে যাচাই বাকি"), never MASTERED; after one good class-test item in a separate week, Then MASTERED.
- **AC-D5** (R31) Given a child with confirmed marks this week, When `GWSUM` runs, Then each of the child's guardians gets
  one message for that child (marks + level words + weak / improving objectives + what to practise); a child with no
  confirmed marks that week gets nothing; the D-#452 digest is unchanged.

### E. Absent child
| Step | Who | What | Reuse / new |
|---|---|---|---|
| E1 | System | Lesson marks + attendance → missed sessions per child | REUSE `StudentLessonService`, `ObjectiveLessonService` |
| E2 | Guardian | 13:00 notice + home guide + classwork items | REUSE GH-4 (`ChildMissedLessonsScreen`) |
| E3 | Staff + guardian | A missed objective with no evidence after the missed day shows "ক্লাস মিস", not WEAK / not assessed | NEW AL-10 (display over D-#950) |
| E4 | System | The next assignment gives 1–2 easy questions on it | NEW AL-7 |
| E5 | Office | Catch-up task | REUSE LP-4 |

- **AC-E1** Given a child absent on the day LO-Y was taught and no evidence on LO-Y since, Then staff and guardian views
  show "ক্লাস মিস"; after the child's first confirmed item on LO-Y the normal state shows.
- **AC-E2** The next draft gives that child `suggestMissedEasyQuestions` easy items on LO-Y in Part B; given 5 missed
  objectives in one subject, Then only the 3 most recent get items this week and the other 2 come next week (R24).
- **AC-E3** A child ABSENT_REDELIVER for a homework is not counted unmarked for it and gets no evidence from it.

### F. Class test
| Step | Who | What | Reuse / new |
|---|---|---|---|
| F1 | Teacher | Class test with its question sheet (marks per question) | REUSE PR-C `classTestLink.ts`; NEW AL-6 warning on a mastery-ON test with no sheet |
| F2 | System | Confirm writes CT evidence + the class-test totals | REUSE |
| F3 | Teacher | Optional weak objectives on the result | REUSE CT-WLO |
| F4 | System | Half the class below 50 % → re-teach proposal | REUSE `MasteryAction` section trigger (+ the min-assessed guard, Q12, accepted R36) |
| F5 | System | CT questions enter the use history | NEW AL-3 |

- **AC-F1** Given a linked sheet, When it is confirmed, Then CT evidence exists and `QuestionUse` rows (kind CT,
  `givenOn` = exam date) exist; those questions are excluded from the next 28 days' drafts.
- **AC-F2** (R17) Given 16/28 children below 50 % on LO-Z in the last two in-school items with 2 confirmed in-school
  papers, Then one PROPOSED section action; given 16/28 WEAK from homework only and 3/20 weak in class, Then none;
  given only 6 children with an in-school item (4 weak), Then none (with the Q12 guard on, R36).
- **AC-F3** (R19) Given a question a child of the শাখা had as extra homework 10 days ago, When a teacher adds it to that
  শাখা's class test, Then it is refused with the reason; 30 days ago → allowed.

### H. Outside-help flag (class teacher first)
| Step | Who | What | Reuse / new |
|---|---|---|---|
| H1 | System | Evidence → case when HW% − CT% ≥ `integrityGapPoints` | REUSE `IntegrityService`; NEW AL-12 policy read |
| H2 | System | Notifies the class teacher(s) and the Principal | NEW AL-12 |
| H3 | Class teacher | Opens own শাখা's case, adds notes, records the outcome | NEW AL-12 (Teacher reach) over REUSE screen হোমওয়ার্ক যাচাই |
| H4 | Subject teacher | Same as the class teacher, for own subject in that শাখা (an investigator; can record) | NEW AL-12 |
| H5 | Office | Every case, notes, records | REUSE (Office default) |
| H6 | Principal | Sees all cases, sets the gap | NEW AL-12 (`homework_integrity:view_all`, `:settings`) |
| H7 | Staff surfaces | Tag on the student profile, marks views, meeting brief | NEW AL-12 (`TrackerTab`, mastery marks views, `comments/routes/meetingBriefPdf.ts`) |
| H8 | Guardian | Gentle note "বাড়ির কাজ শিশুকে নিজে করতে দিন" on that subject | NEW AL-12 |

- **AC-H1** HW 85 % / CT 60 % on LO-X → a case; HW 75 % / CT 60 % → none (gap 20); with `integrityGapPoints` = 15 the
  second opens a case.
- **AC-H2** A new case sends one notice to each class teacher of the child's শাখা and one to the Principal (dedupe key
  carries case + recipient); recompute of the same case sends nothing.
- **AC-H3** A class teacher sees and records only cases of own শাখা; a subject teacher only own subject in that শাখা; a
  teacher of another শাখা is refused.
- **AC-H4** Outcome অভিভাবক করে দিয়েছেন → the profile, the meeting brief and the marks views show the tag; HW/AS marks on
  that objective carry "বাড়ির কাজে বাইরের সাহায্য সন্দেহ"; the guardian portal shows the gentle note only (no case, no
  numbers) — until the end of that term (R32). Outcome শিশু নিজে করেছে → no tag, no guardian note. Outcome অস্পষ্ট →
  the staff tag only, no guardian note (Q4, accepted R36).
- **AC-H6** (R18) A child with one CT item on LO-X and HW 90 % / CT 50 % → a case (no minimum-questions filter).
- **AC-H5** Two cases in one term → "বারবার" badge; closing a case never changes a mark.

### U. Units, substitutes, leave, pauses (cross-cutting ACs)
- **AC-U1** Given BAN-বালক and BAN-বালিকা as two শাখা, Then each has its own papers, grid, use history and drafts.
- **AC-U2** Given two শাখা merged (D-#62), Then a question used in either source শাখা in the last 28 days is excluded
  from the merged শাখা's draft.
- **AC-U3** A group-anchored (Quran/Arabic) test creates no sheet and no paper; its `AssessmentSet` print writes one
  `QuestionUse` row per member শাখা.
- **AC-S1** Given an active `RoutineSubstitution` today on a slot of that শাখা whose absent teacher is the subject
  teacher, Then the substitute can pick homework, enter marks and finalise for that শাখা × subject; another teacher is
  refused.
- **AC-S2** Given the subject teacher is on approved leave on the marking deadline, Then the paper is not late that day;
  the deadline moves to their first school day back (unless a substitute marked it).
- **AC-M1** (R30) Given a homework paper still unconfirmed after its deadline in term 1, Then it appears on the late list
  (09:30 snapshot) and the Principal's card, and **no** staff-mistake row is written; the same in term 2 also writes one
  quiet mistake row (no notice to the teacher, D-#1020).
- **AC-P1** Given a `HOMEWORK_REQUIRED` pause, Then no homework marking reminder and no late entry for homework; given an
  `ASSIGNMENT_CHASE` pause, Then no assignment marking reminder (the D-#1655 mark-ladder rule).
- **AC-R1** With `academicLoop2027On` = false, no new job runs and every 2026 flow is byte-for-byte unchanged.

### L. Loop health and readiness (AL-13)
- **AC-L1** The loop-health page shows per teacher and per শাখা × subject, for a chosen period: % periods with a session
  marked, % HW/AS papers confirmed by the deadline, % papers with at least one tick (a 0 % rate over 4 weeks is shown,
  not judged), % class tests with a linked sheet, WEAK → IMPROVING / MASTERED moves, re-teach actions and their
  before/after.
- **AC-L2** The readiness list shows per class × subject: tree LOCKED, mastery switch, gold questions and weeks of stock,
  session plans with objective tags, rotation cells, term targets, hints loaded — each green/red with what to do.
- **AC-L3** Weeks of stock = per objective, unseen gold questions ÷ the average weekly use over the last 4 weeks (or the
  default layout's use before data exists), via `MasteryBankCoverageService`; a class × subject under 4 weeks is red and
  listed for the Principal.

## §6 — Permission catalogue entries (D-#799; registered in the AL-0 contract PR, used when built)

| permission | EN | BN | allows | T | O | flags | slice |
|---|---|---|---|---|---|---|---|
| `lesson_progress:set_targets` | Set term target dates | মেয়াদের লক্ষ্য তারিখ ঠিক করা | Save/clear half-yearly + annual end session and date per class × subject | — | on | | AL-11 |
| `assignment:suggest` | Get an assignment suggestion | অ্যাসাইনমেন্টের প্রস্তাব নেওয়া | Open the automatic draft; "প্রস্তাব দিন" / rebuild; swap/add/remove inside §4.3 | on | on | own শাখা × subject or today's substitute (row rule) | AL-7 |
| `assignment:accept_swap` | Accept a subject swap | বিষয় বদলের প্রস্তাব গ্রহণ | Accept/ignore the week's swap card (R29) | on | on | DESIGNATION:class_teacher (Teacher) | AL-7 |
| `assignment:finalise_on_leave` | Finalise for a teacher on leave | ছুটিতে থাকা শিক্ষকের অ্যাসাইনমেন্ট চূড়ান্ত করা | Finalise the system's draft when the subject teacher is on approved leave that Wed/Thu (R28); the day's substitute has it through the substitution, no grant needed | — | on | | AL-7 |
| `assignment:comment` | Comment on an assignment | অ্যাসাইনমেন্টে মন্তব্য | View any draft/finalised week and comment; notifies the subject teacher | — | on | | AL-8 |
| `homework_integrity:view` | See homework check cases | হোমওয়ার্ক যাচাইয়ের কেস দেখা | **Extended:** Teacher on, row-scoped to the class teacher of the শাখা or the teacher of that subject there; add notes | on | on | row rule | AL-12 |
| `homework_integrity:record` | Record the outcome | যাচাইয়ের ফলাফল লেখা | **Extended:** the class teacher and the subject teacher (same row rule) record too | on | on | row rule | AL-12 |
| `homework_integrity:view_all` | All homework check cases | সব যাচাইয়ের কেস দেখা | Every case school-wide | — | on | | AL-12 |
| `homework_integrity:settings` | Homework check settings | হোমওয়ার্ক যাচাইয়ের সেটিং | Edit `integrityGapPoints`, `integrityRecurringCases` | — | — | Principal only, LOCKED | AL-12 |
| `reports:loop_health` | Loop health | শিক্ষাচক্রের অবস্থা | The AL-13 health page and the readiness list | — | on | | AL-13 |

**No new permission** (reuse): per-question entry = `mastery:enter_results`; homework picker = `homework:declare` +
`mastery:create`; "প্রিন্টে পাঠান" = `printing:create`; finalise = `mastery:create`; marking alerts =
`mark_submission:alerts` / `:view_own` / `:view_notes`; the "সাপ্তাহিক চক্র" policy card and the release switch =
`mastery:settings`; question-use badge = `question_sets:view`. The dev kill switch and the dev scripts are environment
/ lead-only, not permissions. Guardian surfaces are the portal's own (no staff permission).

## §7 — Cross-cutting rules

- **Calendar (D-#86, D-#1655):** every new scheduled job reads the resolved delivery/due days (holiday rolls) and skips
  SUSPENDED weeks; `ASSIGNMENT_GENERATION` stops `ASDRAFT` and assignment marking reminders; `ASSIGNMENT_CHASE` stops
  assignment marking reminders (as it stops the mark ladder); `HOMEWORK_REQUIRED` stops homework marking reminders and
  late entries. Exam weeks are the Office's pause windows; the engine has no exam rule of its own.
- **Substitutes and leave:** an active `RoutineSubstitution` gives its substitute the subject teacher's reach for that
  শাখা × subject on that day (pick homework, enter marks, finalise) — the same rule `MarkReminderService` uses. Late
  lists are leave-aware (approved leave on the deadline moves it to the first school day back) and never count
  ABSENT_REDELIVER children.
- **Rosters** are sorted by student ID (D-#1463), never roll number.
- **Mastery weeks:** an HW given Monday and an AS handed in the Sunday before are in the same **school week** (Sun–Sat,
  D-#275) but in different ISO weeks; the PRD proposes that `masteredSeparateWeeks` counts school weeks (Q12, accepted R36).
- **Paging (D-#761):** the case list, the week review list (all শাখা), the loop-health rows and `questionUsage` rows are
  `<name>Page` queries (`server/src/lib/paging.ts`). One শাখা's roster grid is not a growing list.
- **Help guides (D-#973):** each slice that adds or changes a screen adds/updates its guide in
  `server/assets/help/guides/` in the same PR (draft until its picture is taken): `homework-pick-questions`,
  `homework-marks-grid`, `assignment-suggestion`, `assignment-week-review`, `lesson-targets`, `loop-health`,
  `homework-integrity` (update), `child-homework` / `child-mastery` (update), the mark-submission guide (update).
- **Null-safe reads (D-#1657):** every new app read is `data?.x?.y` (the jest scan fails the build otherwise); every new
  service checks id arguments with `isValidObjectId` and treats "" as not given.
- **PII firewall (ADR-005):** `QuestionUse`, the marks cache, targets, cases and loop-health rows are identity-plane; no
  corpus or analytics resolver reads them; the firewall test keeps passing.
- **Mobile:** every new screen is checked at ~360 dp (the grid scrolls sideways inside its card; the page does not).
- **Notifications:** every dedupe key carries the recipient; every send goes through the AL-1 guard.
- **Scheduler:** each new family (`ASDRAFT`, `GWSUM`, `LPBEHIND`) gets a `jest.mock` stub in the DB-free scheduler
  test; the marking stage rides the existing mark-ladder ticks. `GWSUM` is a separate message per child (R31); the
  D-#452 digest is not changed.
- **Errors readable:** refusals are Bangla sentences naming the reason (cap overage, HW question, in-window repeat,
  records still GIVEN).

## §8 — Slices in build order (AL-0 first, then strictly one after another; server before app)

Why the handoff order changed: all contract-file changes go in one lead PR first so no two slices race on
`shared/vocab.ts`; the kill switch must exist **before** any prod data reaches dev (AL-1 → AL-2); the use history is
needed by every picker (AL-3 first of the features); per-question marks must write `MasteryEvidence` with source
HW/AS/CT early, because the live GH-3 flag, the diagnosis and the guardian views are idle without it (AL-4..6); the
tailored assignment, the week auto-issue (D-#839) and the mark ladder (D-#889) are built, so
they are reused, not slices; the 180 → 360 cap change is already done (D-#323). AL-13's readiness list must be green
before the Principal turns on `academicLoop2027On`. All slices must be live by 31 Dec 2026 (R33) — the dated plan is
§8.1.

| Slice | Scope | Main files | AC | Tests |
|---|---|---|---|---|
| **AL-0** contract | Policy keys (§3.5), `PRINT_SOURCES` + `MASTERY_PAPER`, paper source `CW`, the 2027 time rule (1.8 min/mark for HW/AS behind the switch, R26), free-line kinds, new notification kinds (assignment draft ready, swap card, assignment comment, guardian weekly message, integrity case, lesson behind), permission catalogue rows (§6) | `shared/vocab.ts`, `shared/permissionCatalogue.ts`, `docs/permission-catalogue/` | — | shared vocab verifier + permission-catalogue checks green |
| **AL-1** kill switch | §9.1: one guard `server/src/lib/outgoing.ts`, fail-closed on `_dev`, used by Expo/web/chat push, the Telegram bot, the AI provider clients (incl. voice transcripts, monthly comments, voice tasks) and `DriveStore`; `/readyz` line | `platform/services/ExpoPush.ts`, `notifications/services/pushChannel.ts`, `webPushChannel.ts`, `chat/services/ChatPushService.ts`, AI provider clients, `platform/services/DriveStore.ts`, `index.ts` | §9.1 | unit: each path sends nothing on a `_dev` DB without the explicit flag; `Notification` rows still written |
| **AL-2** dev copy + generator frame | Lead-only runbook + `server/scripts/dev-mask.ts` (§9.2); generator frame `server/scripts/dev-fake-2027.ts` with run/manifest/remove and scenario 0 (lessons, attendance, absences) | runbook, scripts | §9.2, §9.3 | in-memory Mongo: no real phone/email/address survives; refuses a prod URI / non-`_dev` DB; residue-count 0 after `--remove` |
| **AL-3** use history | `QuestionUse` + writers at each "given" point + withdraw on void/undo + backfill + QU-1 re-pointed + `masteryHomeworkDraft` / extra HW / Part A read it; **class-test block** at basket add, CT request, CT sheet and print (R19); **homework bank share** (R21); merges via `sourceSectionIds`; app: bank badge shows HW/AS/CT + the CT refusal; generator: repeat scenario | `assessment/models/QuestionUse.ts`, `QuestionUsageService.ts`, assessment set / CT request services, `MasteryHomeworkService.ts`, `assignmentBuilder.ts` | AC-B1, AC-B11, AC-B15, AC-C2, AC-F1, AC-F3, AC-U2, AC-U3 | backfill idempotent; window by days; CT counts; CT block |
| **AL-4** HW paper (server) | Declare with picked qids → HW paper + `HomeworkItem.paperId` (`extra:false` backfill + duplicate check + partial index); confirm guards + `trackerDefaults` fix; manual-check guard; item lock after print; write-back (`earnedMarks`, CHECKED, thresholds); correction notes; section grid read/write (exceptions only, ID order); print source + class-homework PDF route; substitute reach; release switch; **marks-only papers** for class × subjects with no locked tree (R20); **free lines** + done/not-done (R22); 1.8 min/mark tally (R26); repeat rule (R23) | `trackers/resolvers/homework.ts`, `trackers/models/HomeworkItem.ts`, `HomeworkStudentRecord.ts`, `MasteryWorkService.ts`, `printing/`, `mastery/routes/` | AC-B2..B5, B7..B17, AC-S1, AC-R1 | `masteryHomework` + tracker suites green; guard tests |
| **AL-5** HW screens (app) | Picker in `DeclareHomeworkScreen` (draft, swap, remove, add, "আবার" badge, free lines), tick-wrong grid (+ free-line "হয়নি" ticks), "প্রিন্টে পাঠান", `TrackerTab` marks, guardian card number + level word (R32); generator: HW marks scenario | `app/src/screens/homework/`, `mastery/MasteryEntryScreen.tsx` (grid mode), `student/profile/TrackerTab.tsx`, `guardian/ChildHomeworkScreen.tsx` | AC-B1..B6, B14, B16, B18 | null-safe jest scan; 360 dp check; help guides |
| **AL-6** AS paper + budget | Every mastery-ON weekly assignment gets an AS paper (Part A only when not tailored); write-back with `availableMarks`; cap/day/minutes keys replace the constant read; `doOnDay` / `minutesByDay`; finalise feeds D-#839; CT-without-sheet warning; **§3.8 in-school rule** (`EvidenceLike.source/inSchool`, MASTERED + revision + section trigger, the `CW` in-class work paper); app: grid reused, day labels on the sheet, "ক্লাসের কাজ" sheet; generator: AS + CT + in-class scenarios | `AssignmentService.ts`, `MasteryAssignmentService.ts`, `mastery/diagnosis.ts`, `MasteryDiagnosisService.ts`, `MasteryActionService.ts`, `MasteryPolicyScreen.tsx` | AC-C4, C5, C9, C12, C15, AC-D4, AC-F1, AC-F2 | AS-T6 + auto-issue journeys green; diagnosis pure suite (§3.8); GH-3 recompute sees AS evidence |
| **AL-7** engine (server) | §4: `assignmentSuggestion`, rebuild, `ASDRAFT` (lead days, pauses), swap card + `acceptAssignmentSwap` lifecycle (class teacher / Office), missed-easy items (3 most recent, carry-over), per-child load (Thursday HW listed, not counted), NEEDS_REVIEW notice + finalise refusal, substitute / Office finalise on leave, Nursery/KG excluded, audit; generator: weak-improving + absent scenarios | `mastery/suggestion.ts` (new, pure), `MasteryAssignmentService.ts`, `SchedulerService.ts` | AC-C1..C3, C6..C8, C10, C11, C13..C15, AC-D1, AC-E2 | pure-function suite for ranking/exclusions/budget; scheduler stub |
| **AL-8** engine (app) | Week review screen "সাপ্তাহিক অ্যাসাইনমেন্ট — প্রস্তাব" (reasons, swap/remove/add, child parts, day split, load panel), swap card, Office/Principal view + comment | `app/src/screens/mastery/` | C2, C3, C6 | help guides; 360 dp |
| **AL-9** marking deadlines | `MarkReminderService` gains a "marks entered" stage: a confirmed-paper check on the HW same-day / AS Tuesday deadlines, the teacher's pop-up, the 09:30 Office/Principal snapshot via `mark_submission:alerts`, leave-aware, substitutes counted, pauses honoured, the Principal's Today card; late marking feeds the quiet mistake record (D-#1020) **only from term 2** (`lateMarksMistakeFromTerm`, R30); app: the existing pop-ups/lists show the stage; generator: late-marking scenario | `trackers/services/MarkReminderService.ts`, `models/MarkReminder.ts`, `staff-mistakes/` | B10, AC-M1, AC-S2, AC-P1, AC-E3 | `markSubmissionGuard` suite extended; one reminder per teacher per day |
| **AL-10** guardian | Hints for class HW papers (`GuardianHintService`), number + level word (R32), the **separate weekly message per child** `GWSUM` (R31; one per guardian × child, dedupe `GWS:<week>:<studentId>:<guardianId>`, nothing in a week with no confirmed marks; the D-#452 digest untouched) + its "এই সপ্তাহ" card, "ক্লাস মিস" (staff + guardian) | `guardian-help/`, `MasteryGuardianService.ts`, `SchedulerService.ts`, `ChildMasteryScreen.tsx` | AC-B6, AC-D3, AC-D5, AC-E1 | no answer field on guardian types; digest suite unchanged |
| **AL-11** targets | `SyllabusTarget`, `setSyllabusTargets`, teaching-day pace, annual start, `LPBEHIND`, Office screen; generator: behind-target scenario | `lesson-progress/` | AC-A1..A6 | calendar/exam-day math; dedupe |
| **AL-12** outside-help | §3.4 (case rule unchanged, R18) + permissions + notices + tag surfaces for the term + guardian note only after অভিভাবক করে দিয়েছেন (R32); generator: outside-help scenario | `homework-integrity/`, `TrackerTab`, `meetingBriefPdf.ts`, guardian portal | AC-H1..H6 | `homeworkIntegrityRbac` extended; firewall green |
| **AL-13** loop health + readiness | Health page, readiness list, weeks of stock (`MasteryBankCoverageService`) shown separately for the homework share and the AS/CT share (R21), `reports:loop_health` | `reports/` or `mastery/`, app screen | AC-L1..L3 | paged rows; readiness rules unit-tested |

### 8.1 Dated launch plan (R33: everything live before Sun 3 Jan 2027, release switch OFF)

From Sat 21 Nov 2026. One slice at a time (owner's laptop rule), each = build → fresh review → fixes → PR to `dev`;
app slices ride the next promotion + one OTA. Dates are "merged to dev by".

| By | Milestone | Depends on |
|---|---|---|
| Mon 23 Nov | This PRD merged; **AL-0** contract PR (all `shared/vocab.ts` / catalogue changes) | owner answers (done) |
| Wed 25 Nov | **AL-1** fail-closed kill switch on the dev site | AL-0 |
| Sat 28 Nov | **AL-2** masked prod → dev copy (lead, VM) + generator frame (scenario 0) | AL-1 live on dev |
| Wed 2 Dec | **AL-3** use history + CT block + bank share | AL-0 |
| Sun 6 Dec | **AL-4** homework paper (server) | AL-3 |
| Wed 9 Dec | **AL-5** homework screens (app) | AL-4 |
| Sun 13 Dec | **AL-6** assignment paper + budget + in-school rule (server + app) | AL-4 |
| Thu 17 Dec | **AL-7** suggestion engine (server) | AL-3, AL-6 |
| Sun 20 Dec | **YC rehearsal on dev** (docs/prd-year-change.md §5 "Rehearsal", YC-0…YC-6, `YEAR_CHANGE_ALLOW_EARLY=1` on dev) — the dev site now has the 2027 year | AL-2 copy, YC slices |
| Mon 21 Dec | **AL-8** suggestion screens (app) | AL-7 |
| Wed 23 Dec | **AL-9** marking stage on the mark ladder; **AL-10** guardian (two PRs, back to back) | AL-4, AL-6 |
| Sat 26 Dec | **AL-11** term targets; **AL-12** outside-help (back to back) | AL-6 |
| Mon 28 Dec | **AL-13** loop health + readiness | all above |
| Mon 28 – Tue 29 Dec | Generator full run: 8 weeks of Jan–Feb 2027 on the rehearsed year, every scenario; owner + Claude test (API probes, one browser walk) | YC rehearsal, AL-2…AL-13 |
| Wed 30 Dec | 2–3 teachers test on dev with fake logins; fixes | above |
| Thu 31 Dec | Promotion `dev → main` + OTA; release switch **OFF** on prod; readiness list read on prod | above |
| From Sun 3 Jan | The owner turns `academicLoop2027On` on when satisfied with dev testing and the readiness list is green | owner |

**Tightest dependencies (flag):**
1. **13 PRs in ~5½ weeks, one at a time**, alongside the December exams and the YC work (YC-4/5/6 rehearsal by 20 Dec,
   prod cut-over 1 Jan) — any slice that slips pushes everything after it; AL-9/AL-10 and AL-11/AL-12 are already paired.
2. **AL-2 before the YC rehearsal:** the copy replaces the identity and roster collections, so a copy after 20 Dec would
   wipe the rehearsed year; a later re-copy means re-running the rehearsal.
3. **The generator's full run waits for the rehearsal** (R34): only ~2 days of end-to-end testing remain before
   promotion.
4. **Future dates on dev:** Jan–Feb 2027 activity is in the future while testing in December; "today" screens and the
   scheduler see the real date. Testers use history views and a lead-only `dev-tick.ts --at <date>` that runs the new
   families (ASDRAFT, GWSUM, LPBEHIND, the marks stage) for a chosen day; a dev-wide clock is Q17 (accepted R36).
5. **Content, not code:** locked trees, the homework/AS/CT bank stock, session-plan tags, rotation cells and targets for
   2027 must exist for the readiness list to go green — AL-13 shows the gaps; filling them is content work outside these
   PRs.
6. **AL-0 is lead-only and blocks every slice;** it must not wait on another branch's `shared/vocab.ts` change (AGENTS.md
   parallel-sessions rule 5).

## §9 — Dev test-data plan (design only; D-#1677)

### 9.1 Kill switch first (AL-1) — fail-closed
- One guard (`server/src/lib/outgoing.ts`): **when the DB name ends in `_dev`, nothing goes out unless
  `OUTGOING_NOTIFICATIONS=on` is set explicitly**; `OUTGOING_NOTIFICATIONS=off` blocks on any DB. Covered: Expo push,
  web push, chat push, the Telegram bot (D-#1666 PR must call the guard), every AI provider call (DeepSeek, Gemini,
  Claude — incl. voice-note transcripts, monthly comments, voice tasks; a blocked call returns the feature's "AI off"
  path), and `DriveStore` uploads (files stay local on dev).
- `Notification` rows and pop-ups are still written, so testers see them in the app.
- `/readyz` prints "outgoing OFF" and whether any AI / Drive / VAPID / Telegram key is present in the environment; the
  dev runbook asserts the dev `.env` holds none of `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`,
  `GOOGLE_OAUTH_REFRESH_TOKEN`, `WEB_PUSH_VAPID_PRIVATE_KEY` or a Telegram token (belt and braces with the guard).

### 9.2 Copy prod → dev (VM, lead only)
1. Stop the dev API. Check the guard: the dev DB name ends in `_dev` and `OUTGOING_NOTIFICATIONS` is not `on`.
2. **Refuse the wrong target:** the runbook compares the restore URI with the prod URI (host + DB name) and stops if
   they match or the target DB name does not end in `_dev`.
3. **Empty the old dev operational and mastery-seed data first:** tracker items/records, class tests/results, class
   notes, lesson deliveries, attendance, mastery papers/results/evidence/states/assignments/sheets/actions/extra
   classes, integrity cases, `QuestionUse`, notifications, audits, print requests, the old `@mastery.test` seed users.
4. `mongodump` the prod DB **read-only** with an `--nsInclude` list; `mongorestore --drop` into the dev DB for exactly
   those collections.
5. **Collections copied:** `users`, `staffprofiles`, `guardians`, `guardianlinks`, `students`, `enrolments`, `classes`,
   `sections`, `sectionmerges`, `subjects`, `academicyears`, `academicpauses`, `classteacherassignments`, `scopegrants`,
   `roletemplateoverrides`; routine: `routineslots`, `periodgrids`, `rooms`, `subjectgroups`, `subjectgroupmemberships`,
   `holidayexceptions`, `schedulewindows`; `assignmentschedules`; content: `contentartifacts` (questions, stimuli,
   session plans), `questionhints`, `sessionhomeguides`; mastery catalogue: `masterydomains`, `masterychapters`,
   `masteryoutcomes`, `masteryquestiontypes`, `masterytags`, `masterypolicies`, `masteryenablements`,
   `masterycataloguereviews`, `masterysequences`, `masteryexclusions`; `lessonprogressconfigs`. (Exact collection names
   are read from the models at build time.)
6. **Never copied:** push devices / web-push subscriptions, notifications, audits, AI settings/keys/usage,
   HR/payroll/finance, files, login throttles, sessions, chat.
7. **Mask immediately** (`dev-mask.ts`, before the API starts): every `User` / `Guardian` / `StaffProfile` / `Student`
   phone → `01000` + a running number; every email → `user-<n>@dev.invalid`; `Guardian.identifier` to match;
   `Student.address` and `StaffProfile` NID / address / bank / pay fields cleared; every `passwordHash` set to ONE
   shared test password (given to testers out of band, never written in the repo). The script refuses to run unless the
   DB name ends in `_dev` and the guard is closed, and ends by counting phone / email / address values in users,
   guardians, staff profiles **and students** that do not match the fake patterns — must be 0.
8. Start the dev API; the lead checks `/readyz` and logs in with one fake login. The YC rehearsal (§9.3) runs on this
   copy; re-copying later wipes the rehearsed year and means re-running it.
9. **Never run `server/scripts/seed.ts`** on dev or prod (it deletes identity rows).
10. Names stay (the owner wants the real roster); the dev site stays behind its basic auth, and no help-guide picture or
    doc is taken from it (the repo is public).

### 9.3 Fake 2027 activity (frame in AL-2, one scenario per later slice)
`server/scripts/dev-fake-2027.ts` — dev only (same refusals as the mask script), **Nursery to Class 5**, **8 school
weeks**, dry run by default, `--apply`, `--remove <runId>`.
- **Through the services, back-dated:** every write passes an explicit `at` / date to the service (the back-dated
  submit-pass recipe) so lifecycle stamps, deadlines and "seen" dates fall on the fake days; emitters are **muted** for
  the run (no `Notification` rows from fake activity) on top of the AL-1 guard.
- **Tag and remove:** each created row is stamped `devFakeRun: "<runId>"` by a raw update after the service call; the
  manifest lists the run's **declared collection list**, which includes side-effect rows — `MasteryEvidence`,
  `MasteryState`, `MasteryAction`, `IntegrityCase`, `QuestionUse`, `Notification`, `Audit`, staff-mistake rows,
  `MarkEscalation` / reminder acks, print requests. `--remove` deletes by `devFakeRun` across that list, then recomputes
  states; a **residue-count test** asserts 0 tagged rows in every listed collection afterwards. A re-run first removes
  the previous run.
- **Rehearsed 2027 year first (R34):** after the AL-2 copy, the lead runs the 2027 year change on dev exactly as
  `docs/prd-year-change.md` §3 / §5 "Rehearsal" describes (YC-0…YC-6: Prepare copies routine, bell windows, assignment
  schedule and mastery switches into 2027; Cut-over with `YEAR_CHANGE_ALLOW_EARLY=1` on dev only; promotions,
  admissions, the new Class 6). The generator refuses to run unless the dev current academic year is 2027 and was made
  by a year-change run (`runId` present).
- Switches on, for the 2027 year on dev, `classNoteQuestionOn`, `academicLoop2027On` and mastery for every class ×
  subject with a locked tree; the others get marks-only homework (R20), lessons and attendance.
- Dates: **8 school weeks from Sun 3 Jan 2027** (to the end of February) on the 2027 calendar (holidays, pauses and the
  rotation as copied by the year change). These dates are in the future while testing in December, so the "today"
  screens and real-time jobs are checked with `dev-tick.ts --at <date>` (§8.1 flag 4; no dev clock in v1, Q17, R36). Classes
  Nursery–Class 5 only (Class 6 is new in 2027 and not part of these scenarios).
- **Scenarios** (added by the slice that makes them testable; each names the children it used, picked at random):
  0 (AL-2, run on the 2026 year until the rehearsal, then re-run on 2027) lessons, attendance and absences; 1 (AL-3)
  repeats and class-test blocks refused; 2 (AL-5/6) HW (incl. marks-only and free lines), AS, CT and in-class marks; 3 (AL-7) weak
  children who improve, and absent children with "ক্লাস মিস" + easy items; 4 (AL-7) one objective most of a শাখা fails →
  re-teach; 5 (AL-9) late marking; 6 (AL-11) a শাখা × subject 2+ weeks behind its target; 7 (AL-12) high HW/AS + low CT
  → an outside-help case.
- **Testers:** the owner + Claude first (API probes, then one browser walk), then 2–3 teachers with fake logins given out
  of band.

## §10 — Open questions

**None open.** Numbers are kept stable across revisions. Closed by the owner on 21 Nov 2026: Q1 (R26), Q2 (R20),
Q3 (R32), Q5 (R34), Q6 acceptor (R29), Q8 (R23), Q9 (R31), Q10 (R24); Q7 withdrawn (D-#839 already auto-issues);
**Q11 → R35** (no CORRECT / PARTIAL / WRONG word on marked work — marks and percentage only); **Q4, Q6 tuning, Q12,
Q13, Q14, Q15, Q16, Q17 → R36** (accepted as proposed — see the R36 row in §1).

## §11 — Traceability

| D-# | Covers |
|---|---|
| D-#1667 | R1 no-repeat + the `QuestionUse` ledger (§3.2); R19 class-test block; R21 homework bank share |
| D-#1668 | R2 suggestion engine (§4); R29 swap acceptor; R28 finalise on leave; tuning numbers (Q6, R36) |
| D-#1669 | R3 marks on the mastery paper, confirm guards; R20 marks-only papers; R22 free lines; R30 late marks by term; no result word on marked work (Q11, R35) |
| D-#1670 | R4 + R5 + R17 mastery rules with the in-school requirement (§3.8); two guards (Q12, R36) |
| D-#1671 | R6 + R25 + R26 + R27 weekly rhythm, hours for Class 1–5, no Nursery/KG assignment, 1.8 min/mark, Thursday homework on top |
| D-#1672 | R7 + R8 + R9 + R23 paper submission, tap-to-print, drafted homework picking, the "আবার" repeat |
| D-#1673 | R10 + R11 + R24 tailored top-up, per-child load, the absent child ("ক্লাস মিস"), 3 most recent missed objectives |
| D-#1674 | R12 + R13 + R31 + R32 approval, the guardian view, the separate weekly message per child, level words; Wednesday 18:00 (Q15, R36) |
| D-#1675 | R14 term target dates, teaching days, annual start (§3.3) |
| D-#1676 | R16 + R18 + R32 outside-help: rule kept, extensions, guardian note only after অভিভাবক করে দিয়েছেন, tag for the term (§3.4) |
| D-#1677 | R15 + R34 dev test data, fail-closed kill switch, rehearsed 2027 year (§9) |
| D-#1678 | R33 launch: slice order AL-0…AL-13 and the dated plan (§8.1); release switch (§3.6); teaching units (§3.7); stale-record corrections (§2) |
