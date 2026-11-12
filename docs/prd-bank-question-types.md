# PRD — a bank question carries its school question type (PR-G)

Contract file for slice PR-G of brief 5. The mastery module stays behind its existing switch.

## Why
The bank's `question_type` is an answer form (mcq, fill_blank …). The school's type code (`QT-FILL`,
`QT-LONG5` …) decides the marks. Until now every picker gave a bank question the objective's FIRST
allowed type, so a 5-mark question could be printed as a 1-mark item.

## What
- The type travels in the payload's free-text `lesson_ref` (the field the `QCAT-` categories use,
  D-#511/#513) — no schema change. `questionTypeCodeOf(payload)` (`mastery/bank.ts`) returns it when
  it matches `^QT-[A-Z0-9]+(-[A-Z0-9]+)*$`, else null (a `QCAT-` value or a lesson handle is null).
  Read as `qtCode` on the question list, the reviewer queue and `goldBank`.
- **Import check** (`masteryImportCheck`): a `QT-` code must be an ACTIVE type of the question's class ×
  subject, one of the objective's `questionTypeCodes`, and the question's `marks` must equal the
  type's marks when the table has them. List locked: refused with the reason (`[MASTERY-QT] …`).
  Before lock: the same findings are warnings. No `QT-` code: accepted as today.
- **Pickers** pick (question, type) together (`pickTyped` / `typeOfQuestion`, `assignmentBuilder.ts`): a
  question with a `qtCode` is offered only as that type, only when the objective and the layout allow
  it and its marks fit the room left. Untyped questions keep the old rule. Used by the assignment
  builder (Part A, Part B), the re-test, the homework draft, the extra homework (preview and send) and
  the swap edit (a swap-in must be untyped or of the item's own type). `createPaper` (BANK origin)
  refuses a type different from the question's; the new-paper screen pre-fills and locks it.
  The open-extra-sheet `hardAvoid` (D-#1421) is untouched.
- **Coverage**: per tagged objective, gold / pending per allowed type, any other type carried, and a
  "no type" cell; an allowed type with no gold question is `zero` (highlighted). `typeCsv` exports
  `objective,type,gold,pending`.
- **Bank list and reviewer queue**: the type code shows beside the objective code; a `qtCode` filter on
  `questions`, `myQuestionReviews` and `myQuestionReviewCount`.

## Not in this slice
REF-19 optional (PR-H), exam pool (PR-I).

## Acceptance
1. `lesson_ref: "QT-LONG5"` is picked only as QT-LONG5 with that type's marks; `QCAT-…` behaves as before.
2. After lock a type the objective does not allow, an inactive type or differing marks are refused;
   before lock they import with a warning.
3. A layout allowing only QT-FILL never receives a QT-LONG5 question.
4. Coverage per objective × type matches a fixture; the legacy Class 5 import, list and category filter
   tests are unchanged.

Tests: `server/src/__tests__/masteryBankQt.test.ts` (includes items copied from the produced
`C1_MATH_U07_bank_v1.json`, `fixtures/c1math_u07_qt_items.json`).

---

# PR-I — questions held for the exam papers (D-#1408)

## Why
The school uses the bank all year for homework, assignments, re-tests and class tests. Questions set
aside for the half-yearly and annual papers must never be given out before the exam.

## What
- `ContentArtifact.examPoolAt / examPoolBy` on a question (same shape and re-import rule as the
  important mark, D-#550: the new version of the same qid inherits the hold).
- Set and cleared by `question:manage` (`question_bank:edit` / `question_bank:delete`: Principal, Office):
  - one at a time from the question preview;
  - in bulk by the current filter: the filter must name a subject AND a class, may match at most 5000
    questions, and the count shown first is sent back (`expectedCount`) so a moved list is refused;
  - in bulk by a pasted list of qids (max 5000, one read): ids are trimmed, upper-cased and Bangla
    digits made ASCII; the result is marked / not found / unchanged with counts, and at most 200 ids
    per list.
  Every real change writes a `QUESTION_EXAM_HELD` / `QUESTION_EXAM_RELEASED` audit row; repeating a
  state writes nothing.
- Badge and filter "পরীক্ষার জন্য রাখা" in the bank list (teachers see both). Server arg
  `examPool: only | exclude | any`: `any` for the bank list, `exclude` for pickers (the new-paper picker
  passes it explicitly).
- Held questions are left out of every picker (`goldBank`: assignment Part A/B and swap, homework
  draft, extra homework, re-test) and refused by name in `createPaper` (HW, CT), the extra-homework
  create, the homework top-up, and the question-bank sets (`addQuestionToSet`, `createSetWithQuestions`).
- Passages: when a part of a stimulus is held, its sibling parts (same `stimulus_ref`) are left out and
  refused too ("same passage as a held question").
- Coverage: `goldCount` = usable gold, `heldCount` = held gold, per row and per cell; the type CSV has a
  `held` column.

## Not in this slice
- Drafts and papers made before a hold are not re-checked (documented in D-#1408); `assembleSet` does
  not re-check the basket either.
- The exam-paper builder, the only future reader that asks for `any` / `only`.

## Acceptance
1. A held question is never offered by the assignment builder, the homework draft, the extra homework
   or the re-test; `createPaper` and the bank sets refuse it for every source, with the reason.
2. Bulk marking by id list reports marked / not found / unchanged (lower-case and Bangla-digit ids
   match); by filter it refuses a filter without subject and class, over 5000 matches, or a stale count.
   Re-import keeps the mark.
3. A teacher without `question:manage` cannot set or clear it.
4. Holding one part of a passage keeps its sibling parts out of every picker and set.

Tests: `server/src/__tests__/examPool.test.ts`, `questions.test.ts` (re-import), `masteryBankQt.test.ts`
(CSV header).

## PR-K: question types are not tied to objectives (D-#1526)

Owner ruling 2026-11-13: the objective tree assesses the learning objective; the same objective can be assessed by many question types. A bank question's `QT-` code is therefore valid when it is an ACTIVE type of its class x subject (the book's marks table) and its marks equal the type's marks; it no longer has to be one of the objective's `questionTypeCodes`. That list stays on the objective as a SUGGESTION (the app labels it "proposed question types"; it is the default type for an untyped question and the first choice in pickers, never a gate). A question with no `QT-` code (a practice-only quick item) imports as before and is only offered where the objective suggests a type. Unknown/inactive codes behave as before (warning before lock, refusal after).
