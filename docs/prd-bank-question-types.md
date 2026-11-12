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
