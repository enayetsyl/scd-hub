# Handoff — YC-2 past-period readers (cloud brief 9)

Branch `claude/wizardly-shannon-eafmut`, started from `origin/dev` at 8d12011. Not merged, no PR.
Contract: `docs/prd-year-change.md` §5 row YC-2 (findings §1.3/§1.4). Decisions D-#1470–#1475.

## What was built

**Shared helpers** (`server/src/modules/foundation/services/EnrolmentService.ts`, appended):
`placementSpans(filter, {from,to})`, `placementsOn(on, filter)`, `sectionRosterIdsOn(sectionId, on)`,
`spanOn`, `spansByStudent`, `yearCoveringKey`, `enrolmentsInUse()`. A child with no enrolment row at
all is placed by today's `Student` pointer (brief §1). Every switched reader takes the enrolment path
only while `enrolmentsInUse()` is true (DB connected and at least one ACTIVE/CLOSED enrolment — prod
after the backfill); otherwise its pre-YC-2 code runs verbatim (D-#1470).

| Brief §3 item | Where |
|---|---|
| 1. Attendance | `attendanceUnit.ts` `rosterForUnit(unit, dateKey)` (= amend validation `validateAbsentees`, the marking roster) + `studentLitesOn`; `AttendanceReportService.ts`: `absenteeReport`, `classPresenceForDate` / `sectionPresenceForDate`, `sectionsAttendanceForDate` (register), `attendanceUnitsForDate` (admin mark/amend list, also labels that day's sections), `studentAttendanceHistory` and `absentNoApplication` (span by span); `AttendanceRankingService.ts` section-shaped ranking (span by span, row labelled by the last placement). Quran-group memberships untouched (Q11). |
| 2. Class tests | `classTestAnchor.ts`: exam-date roster first (`rosterStudentIds`, `classTestRosterStudents`, `rosterCount`), live roster + emptied-section reconstruction kept as fallbacks; `ClassTestSummaryService.ts` batched denominator by exam date (one span read for all sections). |
| 3. Monthly report | `MonthlyMetricsService.ts` `periodPlacement` (latest enrolment overlapping the month → class/section/year, YTD fees from that year's start, notices of that section) and `sectionMonthRoster` (children whose period placement is the section); `MonthlyReportService.buildMonthlyReport` stamps from `periodPlacement`. |
| 4. Lesson delivery | `LessonDeliveryService.recordDelivery`: roster + attendance units of the note's DATE. |
| 5. Gift handover | `AssignmentGiftService.recordGiftHandover`: stamp from the enrolment of the award's year. |
| 6. Student profile | `StudentProfileContextService`: `studentProfileHeader(id, now, academicYearId?)` (+ `enrolledYears`, `pastYear`), `profileWindowOfYear`, classmates on the window's last day; `resolvers/studentProfile.ts`: gate by the named year / `toKey`, header arg `academicYearId`; PDF route gates on `?to`. App: `StudentProfileScreen` year row (only when >1 year), past year view-only notice, 30/90-day chips hidden on a past year. |
| §2 Q8 read-only | `middleware/authz.ts` `pastYearSectionTie` used by `assertCanRead` and `allowedSubjectCodesForSection`; never by a write gate. |

Help: new reading guide `server/assets/help/guides/family-student-profile-past-year.json`; one
sentence added to `family-student-profile.json` intro (its pictures are unchanged: the year row only
appears once a child has two years).

Tests: `server/src/__tests__/yearChangePastReaders.test.ts` (8 tests) on new fixture exports
`seedPastReadersWorld` + `simulateCutover` (`fixtures/yearChange.ts`; existing exports untouched).

## Verified (commands + result tails)

FILLED_BELOW

## Not done

- Readers outside the brief's list, left for YC-7: `unmarkedSections` (a past date after the cut-over
  lists only current-year sections), the group / track / level ranking class label (still today's class),
  the gift **section report** (live roster), guardian portal, mastery, parent meetings, viva, scholarship,
  improvement board, Quran-exam labels, print reprint.
- Profile tabs not year-bound: class test, lessons (পাঠ), the dashboard's whole-picture card.
- No acceptance test for the gift handover stamp (not in the brief's acceptance list; the handover
  needs a full entitlement setup). The code path is typechecked and the existing gift suites pass.
- No screenshot for the year row (it only appears after a real cut-over; a reading guide was used).
- No production run, no seed, no rehearsal (YC-4 engine does not exist yet; the cut-over in the tests
  is a fixture helper).

## Decisions made (smallest safe option where the brief / PRD were silent)

- D-#1470: enrolment path only while enrolment rows exist (keeps every existing suite and every
  today-screen byte-identical before the backfill; mocked-model unit tests assert the old query shapes).
  Per-child fallback: no enrolment at all → today's pointer; rows that do not cover a date → not
  placed that day (a child admitted later is not on an earlier day's roster).
- D-#1471: "the period's enrolment" = the latest enrolment overlapping the month; the section-month
  roster follows the same rule so the sweep's cohort matches the stamp.
- D-#1472: past-year read = class teacher of that section, or a routine teaching grant on it in any
  state; only for a year that started before the current year.
- D-#1473: the panel gate uses the enrolment on the window's last day (`toKey`); the header uses the
  named year.
- D-#1474: exam-date roster first, the old reconstruction kept as the fallback.
- `simulateCutover` stamps the 2026 routine grants' `expiresAt` one minute in the past (the test clock
  is before 3 Jan 2027); YC-6 will future-date it to 2027-01-03.

## Questions for the owner

1. After the cut-over, should the 2026 sections stay `active`? The monthly sweep visits every active
   section; a December re-sweep after 3 Jan builds from the 2026 sections only if they stay active
   (the 2027 sections hold nobody for December). Recommended: keep them active until 15 Jan (the
   December revision window), then YC-4 can retire them.
2. Should supervisors / delegations on a 2026 class (not only class teachers and routine teachers) keep
   read on it after the year change? Built: no (YC-6 re-points them to 2027).
3. Year picker on the guardian app (YC-7) — same rule (only when the child has two years)?
