# PRD — Guardian help: missed-lesson home guide, per-question homework marks, homework-honesty flag, question hints

**Status:** PLANNED 2026-11-13 (owner rulings below). Nothing built.
**Decision block:** D-#1520–#1529 (YC-5 holds D-#1500+; origin/dev max D-#1498 on 2026-11-13).
**Builds on:** lesson progress (`docs/prd-lesson-progress.md`, LP-1..3 live; LP-4 = PR #1151, never merged),
mastery (`MasteryPaper` / `MasteryResult` / `MasteryEvidence`, `MasteryGuardianService`), the guardian portal
(`GuardianPortalService`, `ChildClassNotesScreen`, `ChildHomeworkScreen`, `ChildMasteryAssignments`).

## 0. Owner ask and rulings (2026-11-12 night → 2026-11-13 morning)

Ask: (1) teachers mark the plan taught and the Office tracks it — **already live (LP-1..3)**; (2) an absent child's
guardian gets a simple guide to teach the missed lesson at home; (3) flag homework that the guardian may have done;
(4) hints for every bank question so a guardian can help without giving the answer.

| Question | Ruling |
|---|---|
| Hints per question | A 3-step ladder for **every** bank question (all classes, all subjects). |
| What the guardian sees | Hints **one at a time**; the answer is **never** shown in the portal; the app records how many hints were opened. |
| Honesty flag rule | **Cumulative** per objective: the child's homework + assignment percentage on that objective (all items so far this year) is **20 percentage points or more above** the class-test percentage on the same objective. No fixed thresholds — the cumulative average flattens single good or bad days. |
| Flag route | Office queue only; the Office investigates by hand and records an outcome. No automatic message to the guardian. |
| Missed-lesson guide | A short guide per period, sent at **1 pm** (not 6 pm), and it must also list the **questions done as classwork** in that period. |
| Homework marking | Today's CORRECT / PARTIAL / WRONG homework result does **not** continue. **From 2027 every homework question carries marks**; the teacher deducts for spelling, punctuation and similar **on the paper copy**, following each book's marks distribution and decisions, and **enters only each question's mark in the app** (no deduction tags in the app, 2026-11-13). |

## 1. Slices (build order)

| Slice | What | Depends on |
|---|---|---|
| GH-1 | Hint store + loader + guardian hint ladder + hint-open log; hint guideline (`docs/hint-guideline.md`) | — (start first: hint generation runs in parallel) |
| GH-2 | Per-question homework marks entered in the app (2027 homework); deductions done by hand on the paper | mastery HW papers |
| GH-3 | Homework-honesty flag + Office queue + outcome record | GH-2 (marks per objective), GH-1 (hint-open counts shown in the case) |
| GH-4 | Missed-lesson home guide: revive LP-4 (#1151) + home-guide store + 1 pm notice | lesson progress switch ON in 2027 |

## 2. GH-1 — Question hints

**Store** (not in the question payload — the payload schema stays locked; hints can be added or edited without
re-importing a bank): `QuestionHint { qid (unique), classToken, subject, steps: [{ n: 1|2|3, textBn }], language
("bn"|"en"), source ("agent"|"teacher"), version, updatedBy, updatedAt }`. Step 1 = where to look / what to notice;
step 2 = a guiding question; step 3 = a similar worked example with different numbers or words. Quick items
(MCQ / true-false / matching / one-word) still get three steps, each short.

**Loader:** `importQuestionHints(json)` (Principal; `question_hint:import`) + a server script for bulk files
(`server/scripts/import-question-hints.ts`), upsert by qid, dry-run first. Refuses a hint whose text contains the
item's answer (the correct option text, `tf_answer` as a word, any `blanks[].accepted`, `answer_key.accepted`) —
the same check the generation checker runs.

**Guardian portal:** wherever a child has bank questions assigned with a qid — mastery assignment sheets
(`MasteryAssignmentSheet.items[].qid`), extra homework (`MasteryPaper` HW `extra:true` + `perStudentItems`), 2027 HW
papers (GH-2), homework `selectedQids` / `topupQids` — the question is shown with a button "একটি ইঙ্গিত দেখুন"
that opens step 1, then 2, then 3. No answer, ever. Each opening writes `HintView { guardianUserId, studentId, qid,
step, at }` (once per step per day). Teachers see per child "ইঙ্গিত খোলা হয়েছে: ২/৩" on the item.

**Hint guideline** (`docs/hint-guideline.md`; the agents' copy sits beside the question-bank packs): the ladder,
never the answer, never a near-answer ("শুরু হয় 'প' দিয়ে…" for a one-word answer is too much), only words and
numbers the book has taught by that chapter, short (step 1–2: one sentence; step 3: up to three lines), Bangla for
Bangla-medium subjects and the Bangla instruction for English items with the English example in English, a
gentle Islamic-friendly tone, and per question type: MCQ — how to rule out a wrong option; true/false — what to
check in the sentence; fill-in — read the whole sentence first; maths — draw, count, check by the reverse sum;
writing — talk first, then the first sentence together, never write it for the child.

**Generation:** agents write `<bank>_hints.json` per bank file in each pack's `out/hints/`, checked by
`tools/check_hints.py` (3 steps, length, no answer leak, qid exists), then loaded with the script. Order: Class 1–2,
then 3, then 4–6; within a class, homework-heavy subjects first.

## 3. GH-2 — Per-question homework marks (from the 2027 school year)

Every homework is a HW `MasteryPaper` (bank items or teacher items, each with its marks and `loCodes`). **The teacher
deducts on the child's paper copy** (spelling, punctuation, handwriting … following the book's marks distribution
and decisions) **and enters only the mark for each question in the app** — the existing `MasteryResult` exception
model (no row = full marks; a row = that item's marks). **No deduction tags or deduction rules in the app**
(owner, 2026-11-13). Confirmed papers feed `MasteryEvidence` per objective — the input GH-3 needs. The 2026
CORRECT / PARTIAL / WRONG result stays readable for the old records only. Build work: make the per-question marks
entry fast for a whole section (one row per child, one cell per question, exceptions only).

## 4. GH-3 — Homework-honesty flag

For each child × objective: **HW% = Σearned / Σavailable** over all non-superseded, non-excluded `MasteryEvidence`
rows with source HW or AS this academic year up to the class test's date; **CT% = the same over CT evidence** for
that objective. Recomputed whenever a CT paper is confirmed. **Flag when HW% − CT% ≥ 20 points** (at least one HW/AS
row and one CT row on the objective). One open case per child × objective; a later confirmation updates it.

**Office queue** "হোমওয়ার্ক যাচাই" (`homework_integrity:view` / `:record`, granted to Office and Principal): child,
class, objective, HW%, CT%, the gap, the item list behind each number, and the hints opened on those items (GH-1).
Outcome: অভিভাবক করে দিয়েছেন / শিশু নিজে করেছে / অস্পষ্ট, with a note and date; audited; closing does not
change any mark. No guardian message is sent by the app. A recurring child (2+ cases in a term) is marked on the
case list.

## 5. GH-4 — Missed-lesson home guide

1. **Revive LP-4** (PR #1151, D-#827/#828): rebase on dev; keep the guardian screen "যে পাঠ মিস হয়েছে" and the
   Office catch-up task; **move the notice to 1 pm** (`LESSON_MISSED`, school days): every period marked so far
   that day where the child was absent; periods marked after 1 pm go into the next school day's 1 pm notice.
2. **Home guide store:** `SessionHomeGuide { classToken, subject, chapter, sessionIndex, planArtifactId, steps[5–7]
   (textBn), classworkItems[] (the book exercises / questions done in class, as printed), homeTimeMin, version }`
   — written in simple Bangla for parents from the session plans by agents (`<plan>_homeguide.json` beside each
   plan), loaded by a script; the plan itself is not changed. Steps: what the class learnt (one line) → how to
   teach it at home in 10–15 minutes with things at home → the classwork questions to do together → 2–3 practice
   items → what not to do (don't give answers; use the hints).
3. **Guardian view:** each missed period shows the class note text, the homework, the home guide and its classwork
   questions (with GH-1 hints where the items are bank questions).
4. Needs the lesson-progress switch ON in 2027 (a missed period is known only when the teacher marks the plan).

## 6. Acceptance (headline)

- GH-1: a hint containing the answer is refused by the loader; the guardian sees step 2 only after opening step 1;
  no answer field reaches any guardian GraphQL type; HintView is written once per step per day.
- GH-2: a teacher enters 1½ of 2 on an item; the child's evidence on that objective drops by ½; no deduction tag
  exists in the app.
- GH-3: HW 85% / CT 60% on LO-X → a case; HW 75% / CT 60% → none; outcome recorded with an audit row; no guardian
  notification exists for the case.
- GH-4: a child absent on a marked period gets one 1 pm notice listing it; the guide shows the classwork questions;
  a period marked at 2 pm appears in the next school day's 1 pm notice.
- PII firewall test keeps passing (no corpus path to these per-child rows).

## 7. Later / not in scope
Guardian-written hints; per-guardian hint limits; using hint counts in the flag rule (shown only, not scored).
