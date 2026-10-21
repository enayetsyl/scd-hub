# PRD — Learning-outcome mastery tracker (`mastery` module · শিখন-দক্ষতা ট্র্যাকার)

**Status:** M-0 BUILT 2026-10-20 (branch `feat/mastery-m0`: catalogue, mark table, tags, policy, switch,
import + `skills/_tools/mastery_catalogue_to_json.mjs`; merged to dev #1114); M-1 BUILT 2026-10-20 (branch
`feat/mastery-m1`: bank accepts LO codes + `lo_codes`, harness L3/L4, `[MASTERY-LO]` import warning,
`questions(loCodes)` filter + `loCodes` field); M-2 BUILT 2026-10-21 (branch `feat/mastery-m2`: work sheets
HW / class test / rubric, exceptions-only entry, append-only evidence + strand routing, `mastery:edit_all`, D-#807);
M-3..M-6 contracted. Mock canvas (32 screens, C3 Math sample):
https://claude.ai/artifact/41PHE293FUroM64pWFH6u1 (owner-private; open it before building a screen).
**Decision block:** D-#775–#785, reserved against `origin/main@b96af3ae` = `origin/dev@569d60ec`
(2026-10-20, max D-#774; open PRs hold only D-#650/#651/#761). D-#786 (approvers) amends D-#781.
**Content:** draft learning-outcome catalogues for Classes 1–3 in `docs/mastery/lo-catalogue/`
(owner reviews and locks; see that folder's README).

**Owner ask (2026-10-19):** "I want a similar feature [to scholarship] for all subjects all classes.
The primary purpose is to identify in which topic and which chapter a student has weakness then
suggest tailored hw/assignment for him/her; also identify overall weakness of a class in a topic or
chapter and take corrective action like extra class." Settled in the same conversation:
"System should have full record what was the issue of the student, what we did, what was the result
of each action"; "HW will be initial assessment … later assignment will be tailored based on its
result … with minimum time to produce"; "build this feature as add-on … limited scale this year and
full scale next year"; "full loop, thin".

## §0 — At a glance / build order (read first)

| Slice | What it is | Needs |
|---|---|---|
| M-0 | Catalogue: chapters, learning outcomes (LO), skill strands, question-type mark table, diagnosis tags, policy, per class×subject switch; admin screens; import of a locked catalogue file | — |
| M-1 | Question bank speaks LO codes (contract sync: payload schema + envelope + vocab + harness) | M-0 codes |
| M-2 | Per-question work sheets on homework and class tests; exceptions-only entry; rubric entry; evidence log | M-0 (M-1 for bank questions) |
| M-3 | Diagnosis engine (pure) + student / LO-evidence / section heat-map views + quality report with teacher exclusion | M-2 |
| M-4 | Weekly tailored assignment: teacher layout, automatic pick, teacher review, own question, PDF, per-student entry, guardian view | M-3 |
| M-5 | Section trigger → extra class (approve, one-off slot, attendance) → automatic re-test → close with outcome; action record + timeline + leader dashboard | M-3 (M-4 for the re-test sheet) |
| M-6 | Guardian progress + "what the school did" views; notifications; AI-assisted question drafting (teacher-initiated) | M-3..M-5 |

**Thin, whole loop (owner, 2026-10-19):** every slice ships a basic, working version before any slice
is polished. M-0..M-3 is the minimum that diagnoses; M-4/M-5 act on it; M-6 tells the guardian.

**Rollout (D-#784):** built in 2026 against the **2027 books**; the switch is per class×subject×year.
Classes 1–3 first (books final), then 4–5, then Nursery / KG / Class 6. Islam and Arabic join when
their books arrive. 2026 use is opportunistic: any class×subject the owner switches on after its
catalogue is locked.

## §1 — Goal

1. Find each student's weak **learning outcomes** (fine-grained, from the book) and chapters — from
   marks **and** the teacher's re-work and tags, not marks alone.
2. Give each student a weekly assignment aimed at those outcomes, produced in minutes: the app picks,
   the teacher approves.
3. Find outcomes where half a section is weak and act: extra class in the routine, then a re-test.
4. Check that each action worked, and keep the whole record — issue → action → result → progress —
   visible to staff and guardians.
5. Judge the homework/assignment itself (which questions told strong and weak students apart).

## §2 — Gap table

| Need | Today | After |
|---|---|---|
| Topic/chapter weakness | Class 5 scholarship only (`ScholarshipAnalysisService`) | Every enabled class×subject, at LO grain |
| Per-question marks | Only `ScholarshipScore.itemMarks`; HW/AS/CT store a total or a result | `MasteryResult` per work sheet (exceptions only) |
| Topic vocabulary | Free-string `topic_tag` (`TOP-…`), `HomeworkTopic`, `ScholarshipTopic` — three vocabularies | One LO catalogue per class×subject (`LO-…`) |
| Question-type marks | Only inside `ExamSyllabus.marks[]` per exam | `MasteryQuestionType` per class×subject, used everywhere |
| Different questions per student | Impossible (`AssignmentItem` = one `setId` per section/week) | `MasteryAssignmentSheet` per student (Part A shared + Part B personal) |
| One-off extra period | None (`RoutineSubstitution` = cover on an existing slot only) | `MasteryExtraClass` (routine models untouched) |
| Issue → action → result record | `ImprovementAction` (daily tick tasks) | `MasteryAction` + evidence timeline |

## §3 — Reused / unchanged (do not rebuild, do not change semantics)

- **Homework tracker** (`HomeworkItem`, `HomeworkStudentRecord`, chase/due sweeps, weekly digest,
  work-claim). Mastery **reads** an item's roster and each record's state (ABSENT_REDELIVER /
  NOT_SUBMITTED → no evidence). It never writes these collections.
- **Assignment tracker** (`AssignmentItem`, `AssignmentStudentRecord`, `AssignmentGiftService`
  streaks, chase). Mastery creates the week's item through `deliverAssignment` /
  `confirmAssignmentWeek` exactly as a teacher would, and writes each student's **total** through the
  existing `checkAssignmentRecord` service path — so lifecycle, chase and gifts keep working unchanged
  (D-#775).
- **Class tests** (`ClassTest`, `ClassTestResult`). A work sheet may be attached to a class test; the
  class-test total is still entered/derived the existing way.
- **Question bank + review** (`ContentArtifact`, QR review rounds, `applyQuestionOnlyGate` — teachers
  see gold only). Mastery picks only `reviewStatus: gold`, `current`, not `retiredAt`.
- **PDF** (`pdfkit`, `server/src/routes/pdfRenderer.ts` `mixedText`), **print queue**
  (`createPrintRequest`), **notifications** (`NotificationService.emit`; dedupeKey MUST include the
  recipient), **audit** (`writeAudit`), **paging** (`lib/paging.ts` — every growing list pages from
  day one, D-#761), **routine conflict engine** (`routine/conflicts.ts`, `slotsForDate`,
  `slotsForTeacherOnDate`).
- **Scholarship module** stays as is until Class 5 moves in (§11).
- **Exams** (half-yearly/annual) are NOT connected (owner, 2026-10-19). Mastery marks are never
  official and never labelled as exam marks.

## §4 — New vocabulary (`shared/vocab.ts`; app-native, not mirrored in the envelope except §6.2)

```ts
export const MASTERY_CLASS_TOKENS = ["NUR", "KG", "C1", "C2", "C3", "C4", "C5", "C6"] as const;
export const MASTERY_SUBJECTS = HW_SUBJECTS;                 // BAN ENG MATH SCI BGS ARABIC ISLAM (no QURAN)
export const MASTERY_ASSESS = ["QUESTION", "RUBRIC"] as const;
export const MASTERY_STATES = ["NOT_ASSESSED", "INSUFFICIENT", "WEAK", "IMPROVING", "MASTERED", "REVISION_DUE"] as const;
export const MASTERY_STATE_LABELS_BN = { NOT_ASSESSED: "যাচাই হয়নি", INSUFFICIENT: "তথ্য কম", WEAK: "দুর্বল",
  IMPROVING: "উন্নতি হচ্ছে", MASTERED: "আয়ত্তে", REVISION_DUE: "রিভিশন বাকি" };
export const MASTERY_STATE_LABELS_GUARDIAN_BN = { WEAK: "মনোযোগ দরকার", IMPROVING: "উন্নতি হচ্ছে",
  MASTERED: "ভালো পারে", REVISION_DUE: "ভালো পারে", INSUFFICIENT: "এখনো জানা যায়নি", NOT_ASSESSED: "এখনো পড়ানো/যাচাই হয়নি" };
export const MASTERY_SOURCES = ["HW", "AS", "CT", "RETEST", "RUBRIC", "SCHOLARSHIP"] as const;
export const MASTERY_ITEM_ORIGINS = ["BANK", "TEACHER", "TEACHER_AI"] as const;
export const MASTERY_TAG_EFFECTS = ["WEAK", "LIGHT", "NO_EVIDENCE", "VOID_BEHAVIOUR", "ROUTE_STRAND"] as const;
export const MASTERY_RUBRIC_STEPS = [1, 2, 3, 4] as const;   // ১ পারে না · ২ সাহায্যে পারে · ৩ প্রায় পারে · ৪ ভালো পারে
export const MASTERY_ACTION_KINDS = ["TAILORED_ASSIGNMENT", "EXTRA_CLASS", "RETEACH", "REVISION_SHEET", "GUARDIAN_NOTE"] as const;
export const MASTERY_ACTION_OUTCOMES = ["SUCCESS", "PARTIAL", "NOT_RESOLVED"] as const;
export const MASTERY_LO_CODE_RE = /^LO-(NUR|KG|C[1-6])-(BAN|ENG|MATH|SCI|BGS|ARABIC|ISLAM)-(\d{2}|SK-[A-Z]{2,8})-\d{2}$/;
```
Permissions (append to `PERMISSIONS` + `ROLE_PERMISSIONS`, follow the how-to note at the top of
vocab.ts): `mastery:read` (TEACHER, PRINCIPAL, OFFICE — scoped by the caller's grants),
`mastery:enter` (TEACHER, PRINCIPAL — enter results / build assignments for sections they teach),
`mastery:manage` (PRINCIPAL — catalogue, mark table, tags, policy, switch),
`mastery:approve` (PRINCIPAL by role; the owner gives it to **selected OFFICE role holders** as a
**per-user grant** via `AccessControlService` — no new role is created, D-#786).
Guardians read through `guardian:read_child` + `assertGuardianOfStudent` (like `childTestResults`).

## §5 — The model (new collections, `server/src/modules/mastery/models/`)

### 5.1 Catalogue (M-0)

**`MasteryChapter`** `{classToken, subject, number, titleBn, titleEn?, order, active, bookRef}` —
unique (classToken, subject, number).

**`MasteryOutcome`** — the LO (D-#776):
`{code, classToken, subject, chapterNumber|null, strand|null, labelBn, labelEn?, sourceText,
nctbCode?, assess: QUESTION|RUBRIC, questionTypeCodes[], homeTipBn?, order, status:
DRAFT|LOCKED|RETIRED, lockedAt?, lockedBy?, bookRef}` — unique `code`; `chapterNumber` null ⇔
`strand` set (a skill strand). A LOCKED code is permanent; it can be RETIRED, never deleted or
re-coded (old evidence keeps resolving).

**`MasteryQuestionType`** (D-#777) `{classToken, subject, code: "QT-…", labelBn, marks (0.5 steps),
answerForm?, active, history[{marks, from, by}]}` — unique (classToken, subject, code). Editing marks
appends history; every work-sheet item **copies** its marks at creation, so a change never rewrites a
past result.

**`MasteryTag`** (D-#778) `{code, labelBn, appliesTo: ITEM|WORK|BOTH, effect: MASTERY_TAG_EFFECTS,
routeStrand?: string, level?: ITEM|WORK, questionTypeCodes?: string[], deductionMarks?: number,
scopes: [{classToken, subject}] | "ALL", active, order}` (routing rules: §5.2, D-#787). Seed: ধারণায় ঘাটতি (WEAK), অসাবধানী
ভুল (LIGHT), চেষ্টা করেনি (WEAK), উত্তর-বাক্য নেই (ROUTE_STRAND → SK-ANS), হাতের লেখা অস্পষ্ট
(ROUTE_STRAND → SK-HW), অনুপস্থিত (NO_EVIDENCE), জমা দেয়নি (NO_EVIDENCE), নকল করেছে
(VOID_BEHAVIOUR). Re-work is a first-class flag, not a tag (§5.2). Admin adds tags.

**`MasteryPolicy`** (D-#779/#780/#781) — one SCHOOL row + optional (classToken, subject) overrides:
`{weakBelowPct: 50, weakGapVsSection: 15, minQuestionsForVerdict: 2, improvingAtPct: 70,
masteredAtPct: 70, masteredDistinctQuestions: 2, masteredSeparateWeeks: true,
revisionFirstWeeks: 4, revisionThenWeeks: 8, reworkIsWeak: true, workReworkIsLight: true,
sectionTriggerPct: 50, sectionTriggerMinAssessments: 2, retestAfterDays: 7,
rubricWeakAtOrBelow: 2, rubricGoodAt: 4,
assignmentDefaults: {totalMarks, minutes, partAOn, partAMarks, partBMarks, mixWeak: 60, mixImproving: 25, mixRevision: 15}}`.

**`MasteryEnablement`** (D-#775) `{academicYearId, classToken, subject, enabled, enabledBy, at}` — the
add-on switch. Every mastery entry point (resolver, scheduler family, Today card) checks it; nothing
appears for a class×subject that is off. Turning on requires the catalogue for that pair to be LOCKED.

**Catalogue import:** the locked `docs/mastery/lo-catalogue/<C>_<SUBJ>.md` is converted by
`skills/_tools/mastery_catalogue_to_json.mjs` into JSON, which the admin uploads
(`importMasteryCatalogue`, dry-run diff first). Re-import of a LOCKED code may change label / home
tip / question types only; a code that disappears is RETIRED, never deleted.

### 5.2 Work sheets and results (M-2)

**`MasteryPaper`** — any assessed piece of work:
`{paperId: "MP-<C>-<SUBJ>-NNNN", source: HW|AS|CT|RETEST|RUBRIC, sectionId, classId, classToken,
subject, date, links: {hwItemId?, classTestId?, assignmentId?, extraClassId?},
items[{itemNo, origin: BANK|TEACHER|TEACHER_AI, artifactId?, qid?, textBn?, loCodes[], chapterNumber,
questionTypeCode, marks /*copied*/}], rubricLoCodes[] /*RUBRIC source*/, entryState: OPEN|CONFIRMED,
confirmedAt?, confirmedBy?}`.
- `loCodes` is an array; scoring when length > 1 is the open D-#776 point (owner: "decide after
  production"); until decided the UI allows exactly one and the engine credits each listed LO in full
  (the scholarship D-#661 rule).
- A teacher/AI item cannot be saved without `loCodes[0]` and `questionTypeCode`; `marks` comes from
  the mark table and is not editable.

**`MasteryResult`** — **exceptions only** (D-#778):
`{paperId, studentId, status: PRESENT|ABSENT|NOT_SUBMITTED|VOID, items[{itemNo, marks?, rework?,
tags[]}], workRework, workTags[], rubric[{loCode, step}], note?, enteredBy, updatedAt}`.
- No row = present with full marks on every item **once the paper is CONFIRMED** (the "সব ঠিক আছে"
  button). Before confirmation nothing becomes evidence.
- Status defaults from the tracker: HW record ABSENT_REDELIVER → ABSENT; outcome NOT_SUBMITTED →
  NOT_SUBMITTED; class-test absence → ABSENT. Teacher can override.
- Rubric papers: every listed rubric LO defaults to step 4; rows hold only the lower steps.

**`MasteryEvidence`** — append-only, one row per (paper, student, item, LO) written at confirmation
(and re-written as a new row on correction, the old one marked superseded):
`{studentId, sectionId, classToken, subject, loCode, chapterNumber, source, paperId, itemNo, qid?,
earned, available, rubricStep?, rework, tags[], signal: GOOD|WEAK|LIGHT|NEUTRAL, week, at,
supersededAt?, excludedAt?, excludedBy?, excludeReason?}`.
- `NO_EVIDENCE`/`VOID_BEHAVIOUR` statuses or tags produce **no** row (VOID writes a behaviour note to
  the class teacher instead).
- `ROUTE_STRAND` tags (D-#787) — how a mark-deduction tag feeds a cross-chapter skill:
  - A routing tag carries `routeStrand` (e.g. `SK-ANS`), `level: ITEM|WORK`, `questionTypeCodes[]`
    (ITEM level: which item types can carry it, e.g. QT-WORD/QT-CREATIVE for "উত্তর-বাক্য নেই"),
    an optional `deductionMarks` (from the book rule, e.g. ½) and `scopes[]` (class × subject where it
    is on — e.g. off for C1–C2 Math, whose books forbid answer sentences).
  - **Weak evidence:** an item (or work) carrying the tag writes a WEAK row against the strand LO, with
    the item's chapter.
  - **Good evidence:** every confirmed item of a listed type (ITEM level) — or every confirmed work
    (WORK level, e.g. "হাতের লেখা অস্পষ্ট") — that does NOT carry the tag writes a GOOD row for the
    strand. So the strand gets a real state (weak → improving → mastered) without the teacher doing
    anything beyond the exceptions they already enter.
  - **No double blame:** the item's own LO is scored as if the routed deduction had not happened
    (earned + `deductionMarks`, capped at the item's marks). A word problem solved correctly but
    missing its answer sentence (4½/5) is GOOD for division and WEAK for SK-ANS.
  - The strand LO must exist in that class × subject's catalogue; a tag routed to a missing strand is
    refused at tag save.
- Rework on the same question the student already answered is recorded with `signal: NEUTRAL` for
  mastery (D-#779).

### 5.3 State (M-3)

**`MasteryState`** — materialised, recomputed from evidence by a pure function
(`computeOutcomeState(evidence[], policy, sectionMean)`):
`{studentId, loCode, sectionId, subject, state, since, lastEvidenceAt, evidenceCount,
earnedPct, seenQids[], goodQids[{qid, week}], nextRevisionAt?, history[{state, at, paperId}]}`.
Recompute triggers: paper confirmation, result correction, exclusion/un-exclusion, policy change
(batch), nightly revision-due sweep.

### 5.4 Assignment (M-4)

**`MasteryAssignment`** `{sectionId, subject, academicYearId, weekNumber, layout{totalMarks, minutes,
partAOn, partAMarks, partALoCodes[], partBOn, partBMarks, mix{weak, improving, revision},
questionTypeCodes[]|ALL}, assignmentItemId /*tracker link*/, partAPaperItems[], status:
DRAFT|APPROVED|SENT, rememberLayout, builtAt, approvedBy?}` — unique (section, subject, week).

**`MasteryAssignmentSheet`** `{assignmentId, studentId, partBItems[], reasons[{itemNo, text}],
warnings[NO_UNSEEN_QUESTION|INSUFFICIENT_EVIDENCE|…], status: DRAFT|NEEDS_REVIEW|APPROVED,
pdfFileId?, paperId?}`. On SENT one `MasteryPaper` (source AS) per section holds Part A items +
the union of Part B items; each student's `MasteryResult` covers only the items on their sheet
(items not on a sheet are "not given", never "wrong" — the 2026-09-24 union-paper rule).

### 5.5 Actions and extra classes (M-5)

**`MasteryAction`** (D-#781) `{scope: STUDENT|SECTION, studentId?, sectionId, subject, loCodes[],
kind: MASTERY_ACTION_KINDS, trigger{at, statesSnapshot, sectionWeakPct?}, status:
PROPOSED|APPROVED|IN_PROGRESS|CHECKING|CLOSED|REJECTED, approvedBy?, links{assignmentId?,
extraClassId?, retestPaperId?}, outcome?: MASTERY_ACTION_OUTCOMES, before{weakPct|earnedPct},
after{…}, closedBy?, closedAt?, notes[]}`. TAILORED_ASSIGNMENT actions are written automatically
per student per week (one row per student-week, listing the LOs in Part B) so the timeline shows
"what we did" without teacher typing.

**`MasteryExtraClass`** `{actionId, sectionId, subject, loCodes[], attendees: WEAK|WEAK_IMPROVING|
SECTION, studentIds[], teacherId, date, slot{kind: PERIOD|AFTER_SCHOOL, periodNumber?, replaces?,
roomId}, status: SCHEDULED|HELD|CANCELLED, attendance[{studentId, present}], retestDate,
retestPaperId?}`. Routine models are not changed: the one-off period is read into the teacher's Today
and the routine day view through `extraClassesForDate`. The slot finder lists, for the next 7 school
days, periods where the teacher is free (`slotsForTeacherOnDate`) and the room is free
(conflict engine), showing what the section has in that period ("replaces Art"), plus an
after-school option ("guardians will be told").

**`MasteryExclusion`** (D-#782) `{sectionId, qid|{paperId, itemNo}, by, reason, at, revokedAt?}` —
marks matching evidence `excludedAt`; recompute follows.

## §6 — Contracts

### 6.1 Selection rules (M-4, the substance of "minimum time to produce")
For each student, per subject, per week:
1. Candidate LOs = enabled, taught (chapter appears in a confirmed paper or the section's syllabus
   coverage) and in state WEAK / IMPROVING / REVISION_DUE / INSUFFICIENT. MASTERED is skipped.
2. Fill Part B marks by the layout mix (weak → improving → revision; INSUFFICIENT gets one question
   to gather evidence). Within a band, older `lastEvidenceAt` first.
3. For each LO pick a gold question whose type is allowed by the layout and the LO, **never a qid in
   `seenQids`** for that student, preferring types the student lost marks on, then lowest exposure in
   the section. No candidate → warning `NO_UNSEEN_QUESTION`; the teacher writes one, asks AI, picks
   another type, or skips (D-#780). The gap is counted per LO for the content team.
4. Part A (if on) = the section's top weak LOs (default: those at ≥ trigger %), questions unseen by
   **every** student of the section where possible.
5. Totals snap to the layout within ±1 mark; the teacher sees the difference.
The teacher reviews the section list (approve all / open one / swap / add own) and sends; sending
creates or updates the tracker `AssignmentItem` (`deliverAssignment` with `totalMarks` = layout
total) so the assignment lifecycle, chase and gifts run unchanged.

### 6.2 Question bank (M-1) — **two-place contract sync** (skills/contract-sync)
- `server/import/LOCKED_QuestionPayload_Schema_v1.json` `topic_tag` pattern widens to accept
  `MASTERY_LO_CODE_RE` alongside the legacy `^TOP-…$` (legacy stays valid — the Class 5 bank and
  scholarship keep working).
- Optional `tags.lo_codes: string[]` (each matching the LO pattern) for the multi-LO case; absent ⇒
  `[topic_tag]`.
- `docs/import-contract.schema.json`, `shared/vocab.ts` (`MASTERY_LO_CODE_RE`), the harness and
  `verify_shared_vocab.mjs` change together; run every verifier in AGENTS.md.
- Import of a question whose LO code is unknown to the catalogue is **accepted with a warning** (the
  catalogue may be imported later) but such a question is never auto-picked until the code exists
  and is LOCKED.
- Legacy `TOP-` → LO mapping for the Class 5 bank is a one-time script when Class 5 moves in (§11),
  not M-1.

### 6.3 Engine rules (D-#779, all from `MasteryPolicy`)
- Evidence is per (student, LO); rubric step maps to % (1→0, 2→33, 3→67, 4→100).
- **Verdict floor:** fewer than `minQuestionsForVerdict` distinct non-excluded items ⇒ INSUFFICIENT.
- **WEAK** if earned% < `weakBelowPct`, or earned% < sectionMean − `weakGapVsSection`, or any item in
  the last two assessments carries rework (`reworkIsWeak`) or a WEAK-effect tag. LIGHT signals count
  as WEAK when ≥ 2 within 3 weeks.
- **IMPROVING**: was WEAK and the latest item ≥ `improvingAtPct` with no rework.
- **MASTERED**: ≥ `masteredDistinctQuestions` distinct qids ≥ `masteredAtPct`, no rework, in separate
  ISO weeks, and none of the last two items below `weakBelowPct`. Sets `nextRevisionAt = +revisionFirstWeeks`.
- **REVISION_DUE** when `nextRevisionAt` passes; a good revision item → MASTERED with
  `+revisionThenWeeks`; a poor one → WEAK (path restarts).
- A rework item never counts as good; redoing the same qid never counts toward mastery.
- **Section %** for an LO = WEAK students ÷ students with a verdict. Trigger when ≥ `sectionTriggerPct`
  and the LO has ≥ `sectionTriggerMinAssessments` confirmed papers; one open SECTION action per
  (section, subject, LO) at a time.

### 6.4 Quality report (M-3, D-#782)
Per item and per paper: facility (% full marks), rework rate, discrimination (mean of top third −
mean of bottom third, by the section's subject earned% over the last 8 weeks), signals
`TOO_EASY` (facility ≥ 95 %), `MAY_BE_UNCLEAR` (rework ≥ 30 % or top third < 50 %),
`DISCRIMINATES` (gap ≥ 40). Report only; cross-section view per qid for reviewers. The only action is
the teacher's **exclude from diagnosis** for their section (reversible, reason required).

## §7 — Screens (match the mock; Bangla per the fixed vocabulary — শাখা, বাড়ির কাজ, শিক্ষার্থী, রিমাইন্ডার, চাপুন)

| Mock | Screen | Who | Slice |
|---|---|---|---|
| A1 | অধ্যায় ও শিখনফল (catalogue, import, lock, retire) | Principal | M-0 |
| A2 | প্রশ্নের ধরন ও নম্বর (per class×subject, history) | Principal | M-0 |
| A3 | ট্যাগ ও পলিসি (+ class×subject overrides, switch) | Principal | M-0 |
| T1 | Today cards: entry pending, assignment drafts, extra class, re-test | Teacher | M-2/M-4/M-5 |
| T2 | বাড়ির কাজ তৈরি — LO chips → app's bank pick → own question (LO + type; marks locked) | Teacher | M-2 |
| T3/T4 | নম্বর তোলা — exceptions grid; one-question sheet (marks, book's deduction reasons, tags, rework; whole-work rework/tags) | Teacher | M-2 |
| T5 | রুব্রিক — 4-step per student, default 4 | Teacher | M-2 |
| T6/T7 | সাপ্তাহিক অ্যাসাইনমেন্ট — layout card + section list; one student's Part B with reasons and gaps | Teacher | M-4 |
| T8 | A4 PDF: Part A + Part B, answer boxes, marks boxes, code footer | Teacher/Guardian | M-4 |
| I1/I2 | শিক্ষার্থীর অবস্থা; one LO's evidence trail | Teacher, Principal | M-3 |
| I3 | শাখার হিট-ম্যাপ + trigger banner | Teacher, Principal | M-3 |
| I4 | কাজের মান রিপোর্ট + exclude | Teacher, reviewers | M-3 |
| L1 | পুরো স্কুল dashboard: pending approvals, running actions, class×subject grid, entry backlog | Principal, office holders with `mastery:approve` | M-5 |
| L2 | অতিরিক্ত ক্লাসের প্রস্তাব — attendees, teacher, slot finder, re-test date, notify list | Principal / office holder with `mastery:approve` | M-5 |
| L3 | রি-টেস্টের ফল — before/after, per student, close with outcome | Teacher, approver | M-5 |
| L4 | পুরো রেকর্ড (timeline: issue · action · result) | Staff | M-5 |
| G1–G4 | Guardian: সন্তানের অগ্রগতি, বিষয়ের বিস্তারিত (+ home tips), এই সপ্তাহের অ্যাসাইনমেন্ট (+ PDF), স্কুল যা করেছে | Guardian | M-4/M-6 |

## §8 — Scheduler families (`SchedulerService`; add a `jest.mock` stub for each new family)
- `masteryRevisionDue` (daily 05:30 Dhaka): flip MASTERED → REVISION_DUE when due.
- `masterySectionTrigger` (daily 18:00): evaluate §6.3 trigger, create PROPOSED actions, notify approvers.
- `masteryAssignmentDrafts` (weekly, the school's assignment-build day): build drafts for enabled
  sections whose teacher has not built one; Today card for the teacher.
- `masteryRetestDue` (daily): create the re-test sheet `retestAfterDays` after a HELD extra class.

## §9 — Notifications (dedupeKey always includes the recipient)
Teacher: assignment drafts ready; extra class approved/scheduled; re-test due. Approvers: new
proposal. Guardian: weekly assignment sent (with PDF); child's extra class scheduled; re-test result
summary. Class teacher: behaviour note (VOID tag), three NOT_SUBMITTED in a row.

## §10 — Journeys and acceptance (feeds tests)

1. **Exceptions entry.** Given a confirmed 6-item HW for 28 students where 9 have exception rows and 1
   is ABSENT, evidence rows exist for 27 students; the 18 without rows get full marks; the absent
   student has none. Editing one row after confirmation supersedes only that student's rows.
2. **Rework signal.** A 5/5 item with rework makes the attempt non-good; with prior INSUFFICIENT the
   LO becomes WEAK; redoing the same qid correctly is recorded but the state stays WEAK until a
   different qid scores ≥ 70 %.
3. **Mastery path.** WEAK → (different qid 2/2) IMPROVING → (another different qid, next week, 2/2)
   MASTERED with `nextRevisionAt` = +4 weeks → REVISION_DUE → good → MASTERED (+8) / poor → WEAK.
4. **Never repeat.** The builder never places a qid in a student's `seenQids`; with none left it raises
   `NO_UNSEEN_QUESTION` and the sheet is NEEDS_REVIEW.
5. **Layout.** A teacher's layout (Part A off, 20 marks, mix 80/20/0, types SOLVE only) is honoured
   for every sheet and remembered when ticked.
6. **Trigger.** 16/28 WEAK with 3 confirmed papers ⇒ one PROPOSED section action; a second evaluation
   does not duplicate it; approval by an OFFICE user holding the `mastery:approve` grant succeeds;
   by an OFFICE user without the grant, or a plain teacher, is refused.
7. **Extra class → re-test → close.** HELD with attendance ⇒ re-test sheet built on the due date with
   unseen qids per attendee; confirming it updates states; closing records before/after and outcome;
   the timeline shows issue → action → result.
8. **Exclusion.** Excluding a qid for a section recomputes states without it; revoking restores them;
   the record keeps who/why.
9. **Switch.** With a class×subject switched off, no Today card, no scheduler work and no guardian
   view appears; existing homework/assignment flows are byte-for-byte unchanged (tracker tests green).
10. **Guardian.** A guardian sees only their child, plain labels, home tips, the week's assignment and
    PDF, and the actions record; no section ranks, no other children.
11. **Deduction-tag routing.** On a confirmed C3 Math HW with four QT-WORD items, a student whose item 3
    carries "উত্তর-বাক্য নেই" (4½/5) gets: item 3's own LO scored 5/5 (GOOD); SK-ANS rows = 3 GOOD + 1
    WEAK. A C2 Math paper cannot carry that tag (scope off). A work tagged "হাতের লেখা অস্পষ্ট" writes
    one WEAK SK-HW row; an untagged confirmed work writes one GOOD row.
12. **Marks snapshot.** Changing QT-WORD from 5 to 4 leaves existing items at 5; new items get 4.

## §11 — Out of scope / later
- Half-yearly / annual exam marks (exams module) — not connected.
- Class 5 scholarship move-in: later slice; scholarship papers become `source: SCHOLARSHIP` after
  re-tagging items to Class 5 LOs (needs the C5 books final); legacy `TOP-` codes mapped by script.
- Student-facing logins (students do not use the app).
- Auto-removing bank questions (reviewers decide; report only).

## §12 — Open (owner)
1. One LO per question or several (D-#776) — owner undecided. Meanwhile cross-cutting skills are
   captured by deduction-tag routing (D-#787) and a question that tests two things can be split into
   parts (ক/খ), each with its own LO and marks.
2. ~~Minimum approved questions per LO~~ — settled: **no minimum** (D-#787).
3. Books still to arrive: Islam (all classes), Arabic, Class 4 Science; Nursery/KG/Class 6 books.
4. The weekly assignment build day per class (default: the tracker's existing delivery day).

## §13 — Traceability
| D-# | Topic | PRD |
|---|---|---|
| D-#775 | Add-on module, per class×subject×year switch, trackers untouched | §0, §3, §5.1 |
| D-#776 | LO spine from the 2027 books; code format; skill strands; lock/retire | §4, §5.1, §6.2 |
| D-#777 | Question-type mark table; marks snapshotted | §5.1 |
| D-#778 | Exceptions-only entry; rework flag; tags with effects; no-evidence cases; rubric 4-step | §5.2 |
| D-#779 | State rules (all policy-configurable) | §6.3 |
| D-#780 | Tailored weekly assignment; teacher-configurable layout; gold-only pick; never a seen qid; teacher/AI questions | §5.4, §6.1 |
| D-#781 | Section trigger → extra class (principal or approver) → re-test → close; action record | §5.5, §6.3 |
| D-#786 | Approvers = Principal + selected OFFICE holders by per-user grant; no coordinator role | §4 |
| D-#787 | No minimum questions per LO; deduction tags route evidence to skill strands (confirmed, built M-0/M-2) | §5.1, §5.2, §12 |
| D-#782 | Quality report is report-only; teacher can exclude a question for their section | §6.4 |
| D-#783 | Guardian visibility and wording; never exam marks | §7, §9 |
| D-#784 | Scope Nursery–C6, all subjects but Quran; rollout order; 2026 opportunistic, 2027 full | §0 |
| D-#785 | Bank contract: LO codes accepted alongside legacy TOP- codes; optional `lo_codes` | §6.2 |
