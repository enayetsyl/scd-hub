# PRD — A work sheet can carry an earlier class's objectives (PR-B of the objective chain)

**Status:** BUILT 2026-11-11 (overnight session, branch `claude/charming-cori-ksozdn`, slice label PR-B).
**Decisions:** D-#1314–#1316. Behind the mastery switch (`MasteryEnablement`) like every sheet.

## Why
A start-of-year baseline test, and tracing a weakness to an earlier class. Before this, `createPaper`
refused any code whose class was not the section's class.

## Rules
- `createPaper` (sources HW, CT, RUBRIC) accepts a code of the same subject from the section's class or
  any EARLIER class (NUR < KG < C1 … C6, `MASTERY_CLASS_TOKENS` order); a later class is refused
  ("… পরের শ্রেণির …"). The code must be LOCKED and tagged (existing checks). Its question type and marks
  come from the marks table of the code's OWN class. A bank question must be tagged with that code
  (existing check). The section's own class × subject switch is the one that must be on.
- A sheet made only of earlier-class codes gets the title "ভিত্তি যাচাই" when the teacher gives none.
- Evidence rows are written as today: the paper's section, class and source; the row's `loCode` is the
  earlier-class code.
- Section reads of the section's own tree ignore the earlier-class rows: `liveSectionRows` (no `loCode`)
  keeps only codes of the section's class unless `includeEarlierClasses` is set. That one filter covers
  the heat-map, the student view, the school roll-up, the guardian view, the weekly assignment builder
  and the section trigger. A read that names one code (`loCode`) is unfiltered — that is how the earlier
  step and the re-test read it.
- The earlier-step hint (`resolveEarlierSteps`, D-#927) already looked for the student's own evidence on
  the prerequisite code in any section; now that the rows exist it shows the step's state, judged by the
  earlier class's policy, instead of "আগের শ্রেণির তথ্য নেই". No change was needed there.

## New read
`masteryEarlierClassSummary(sectionId, subject, page?, pageSize?)` → `{ rows, total, page, pageSize }`
(paged, D-#761). One row per earlier-class code this section has live evidence on: `code`, `labelBn`,
`classToken`, `assessed` (roster students with a state other than NOT_ASSESSED), `weak`, `weakStudents`.
Each code is judged by its own class's policy. Gate: `mastery:view` + the row rule (routine holder or
`mastery:edit_all`). No new permission.

## App
- Heat-map screen: a section "আগের শ্রেণির ধাপ" under the table, hidden when the read is empty.
- New-sheet screen: a switch "আগের শ্রেণির {objective} যোগ করুন" (level word from `useMasteryLevelLabels`)
  → pick an earlier class → the same picker for that class; item chips show the class; marks are
  snapshotted per item as shown. The "ভিত্তি যাচাই" default title is shown under the title box.
- Help: reading guide `mastery-earlier-class`.

## Acceptance (`server/src/__tests__/masteryEarlierClass.test.ts`)
1. A Class 2 section's sheet with a Class 1 code is created; with a Class 3 code it is refused.
2. Marks are snapshotted from the Class 1 table.
3. After confirmation, a student weak on a Class 2 row whose prerequisite is that Class 1 code sees the
   Class 1 step's real state.
4. The summary lists the code with correct counts; the heat-map, the assignment builder's rows and the
   trigger are unchanged by the extra rows.

## PR-K — baseline results on the student's own page (D-#1425)
- `masteryStudentDiagnosis` gains `baseline`: each earlier-class code this child has live evidence on in
  their section — `loCode`, `labelBn`, `classToken`, `state` (judged by the EARLIER class's policy, like the
  summary above) and `lastEvidenceAt`. Ordered by class then code. Empty when the child has none.
- The student's mastery page (staff screen, behind `mastery:view` and the row rule) shows a card
  "ভিত্তি যাচাই" with those rows (label, class, state, last date); hidden when empty. No new permission,
  no new switch: a LOCKED tree for the earlier class is enough for the sheet to exist. Nothing is added to
  any guardian view (the guardian read still ignores earlier-class rows).
- The child's own-class rows, counts and "more weak than" standing are unchanged by baseline rows.
- Acceptance: `masteryEarlierClass.test.ts` "PR-K" case.
