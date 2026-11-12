# PRD — The class test and its question sheet are one entry (PR-C of the objective chain)

**Status:** BUILT 2026-11-11 (overnight session, branch `claude/charming-cori-ksozdn`, slice label PR-C).
**Decisions:** D-#1317–#1320. Behind the mastery switch: with no linked sheet every class-test flow is unchanged.

## Why
A class test stores one total per child (`ClassTestResult.marks`, written by `enterResult`). A mastery sheet
of source CT was separate and `MasteryPaper.links.classTestId` was never set, so marks were typed twice.

## Link (create)
`createMasteryPaper(…, classTestId?)` — CT source only. The test must exist, be REQUESTED or PRINTED, be
section-anchored (a group test is refused with a clear message), have the sheet's section and subject, and
have no other sheet (unique partial index on `links.classTestId`; the duplicate-key race maps to the same
message). The sheet's date is the test's exam date. The items' marks must add up to the test's
`totalMarks`, otherwise refused naming both totals.

`masteryClassTestOptions(sectionId, subject)` (`mastery:create` + row rule): the section × subject's
section-anchored REQUESTED / PRINTED tests with an exam date from 30 days ago onwards (upcoming tests
included) that have no sheet. Deleting an OPEN sheet with no results frees the test again.

## Entry, confirmation, corrections
- On a linked sheet the status NOT_SUBMITTED is neither offered (entry screen) nor accepted (server).
- Confirm first checks that the test is PRINTED and its exam date has come (the class test's own J3 rule),
  then that no submitted / published result would change, then writes evidence, then writes every roster
  student's result through `enterResult`: ABSENT → ABSENT, no marks; anyone else (PRESENT, VOID) → PRESENT
  with the total earned on the sheet (full marks where there is no exception row). A student whose stored
  status and total already match is not written again.
- The write passes the result's existing weakness / teacher-action / guardian-action back unchanged and
  sends no AI stamp, so the comments and the AI-check stamp stay (pinned by a test). An ABSENT write clears
  comments exactly as the class test always does (an absent child has no comments, owner report 2026-11-06).
- A correction after confirmation re-writes that student's total the same way. If the student's result is
  submitted for approval or published, a correction that would change the total or status is refused with the
  class test's own "recall / unpublish first" message; a total-neutral change (a tag, re-work) is allowed.

## The class-test side
- `enterClassTestResult` (resolver) asks `classTestEntryGuard` (lazy import of `mastery/classTestLink.ts`,
  so trackers and mastery never import each other at load): with a linked sheet not yet confirmed →
  "আগে প্রশ্নভিত্তিক শিট নিশ্চিত করুন…"; confirmed → a status or mark that differs from the stored one is
  refused; the same mark with comments saves.
- `masteryClassTestSheet(classTestId)` (`mastery:view`): `{ enabled, paperId, entryState, sectionId,
  classLevel }` — no student data. The class-test screen shows a "প্রশ্নভিত্তিক শিট" row only when
  `enabled` (mastery on for that class × subject × year): open the sheet, or create one (opens the new-sheet
  screen with the test pre-picked and the required total beside the running total). While a sheet owns the
  test, the marks and absence are read-only and only the comments are typed; before confirmation the card
  says "আগে প্রশ্নভিত্তিক শিট নিশ্চিত করুন".
- Recheck, hold and published-correction flows are unchanged. When they leave a class-test mark that differs
  from the sheet total, the sheet page shows a warning line per student with both numbers
  (`masteryPaper.classTestMismatches`).

## Acceptance (`server/src/__tests__/masteryClassTestLink.test.ts`)
1. With no linked sheet, every existing class-test flow and test is unchanged (full suite + guard null).
2. Totals 18 on a 20-mark test are refused at sheet creation.
3. Confirming writes PRESENT + total for present students and ABSENT for absent ones, and keeps comments typed earlier.
4. Direct mark entry on a linked test is refused; saving comments with the same mark succeeds.
5. A total-changing correction after submit is refused; a tag-only correction is accepted.
6. A second sheet for the same test, and a sheet for a group test, are refused.

Help: reading guide `mastery-class-test-sheet`; `exam-ct-enter-marks` intro updated.
