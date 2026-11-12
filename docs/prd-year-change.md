# PRD — 2027 year change and Class 6 (audit + build plan)

**Status:** PLAN, not ratified · **Written:** 2026-11-11 (cloud session, docs only, no code changed)
**Owner rulings used:** brief of 2026-11-12 (school year starts Sun 3 Jan 2027; Sylhet opens Class 6;
nine Class 6 subjects; codes `ICT`, `BAN2`, `ENG2`; everyone moves up by default; only the Principal
runs the change, after a trial on the dev site; the 2026 record stays fully readable).

Path shorthand: `S/` = `server/src/modules/`, `A/` = `app/src/`, `V` = `shared/vocab.ts`.
Line numbers are from `dev` at 8d9e5a2. "Not verified" means I could not confirm it from the code.

---

## 0. Summary (read this first)

1. **Five things break on day one if nothing is built**, worst first:
   - **Every new homework, assignment, class test and scholarship ID in 2027 collides with a 2026 ID.**
     Counters restart per year, but the ID itself has no year and is globally unique (§1.4). The first
     `HW-C3-BAN-0001` of 2027 fails with a duplicate-key error. Teachers see a raw error.
   - **Class 6 cannot be created.** `Class.level` has `max: ROSTER_CLASS_LEVEL_MAX` = 5 (`V:87`,
     `S/foundation/models/Class.ts:18-21`). The new subjects are not in any teaching list (§4).
   - **Office can flip the current year with one tap today**, without promoting anyone
     (`classes_sections:settings`, `office: true`, `shared/permissionCatalogue.ts:942`;
     `S/foundation/resolvers/classes.ts:158-181`).
   - **About 30 readers list classes, sections or bell windows without a year filter.** Once 2027 rows exist, they pick the wrong
     year or list both (§1.2).
   - **Moving `Student.sectionId` empties every 2026 view built from a live roster.** There are 128 live
     `Student.find({sectionId|classId…})` reads. Several writers would also stamp 2026 records with
     2027 sections (§1.3).
2. **Recommended model: a hybrid (§2).** Add a per-year **Enrolment** record (student × year × class ×
   section × roll × status × dates). Keep `Student.classId/sectionId` as a pointer to the
   *current* enrolment, so the ~170 "today" readers do not change. Switch only the readers that show
   a past period (about 30 functions) to read the enrolment. 2026 sections then look "emptied",
   which the code already handles since the C4/C5 split (D-#720–#731, D-#770).
3. **Procedure (§3):** *Prepare* (any day in December, nothing visible changes) → *Cut-over* (Fri
   1 Jan 2027 evening: pointers move, the current year flips) → *Undo* is possible at both steps.
   Every step has a dry run that prints each change first.
4. **Ten build slices (§5).** YC-0 to YC-6 must be live and rehearsed on dev by **Sun 20 Dec 2026**.
   YC-7 to YC-9 can follow.
5. **Open questions with recommended answers are in §6.** Nothing in this plan needs an answer before
   YC-0 and YC-1 start.

---

## 1. Findings

### 1.1 How "the current year" is found

There is one flag, `AcademicYear.current` (`S/foundation/models/AcademicYear.ts:18`).
`setCurrentAcademicYear` (`S/foundation/resolvers/classes.ts:158-181`) flips it and changes nothing
else. `createAcademicYear` builds 1 Jan to 31 Dec from the label (`classes.ts:122-155`).

| Reader | What it does with the year | Path |
|---|---|---|
| Attendance ranking | Uses the given year, else the current one, else the **newest `startDate`** (that is the stray 2029) | `S/attendance/services/AttendanceRankingService.ts:173-184` |
| Pending alerts / assignment handout | Uses the current year, else the year covering today; then `AssignmentSchedule.findOne({academicYearId})` | `S/routine/services/PendingAlertService.ts:260-277`; `S/trackers/services/AssignmentHandoutService.ts:122-131` |
| Class test (group-anchored) | Uses the current year; throws if none is set | `S/trackers/services/ClassTestService.ts:332-336`; `S/trackers/resolvers/classTest.ts:321-324` |
| Student profile window | Current year up to today | `S/trackers/services/StudentProfileContextService.ts:90-103` |
| Monthly report stamp | `academicYearId` = **current** year, not the year of the report period | `S/reports/services/MonthlyReportService.ts:377-379,394-396` |
| Parent meeting default | Current year; throws if none is set | `S/comments/services/ParentMeetingService.ts:336-340` |
| Mastery rollup | Current year, else the newest year with mastery switched on | `S/mastery/services/MasteryRollupService.ts:53-72` |
| Lesson progress sections | Current year → its classes at levels 1–5 → their sections | `S/lesson-progress/services/LessonProgressService.ts:160-168` |
| Archive retention | Protects the current year and the one before it. **If no year is current, every FILED bundle becomes disposable** | `S/archive/services/ArchiveService.ts:480-505` |
| HR leave / exit pay | The year covering the date, else the current one | `S/hr/services/StaffLeaveService.ts:131-138`; `LeaveEntitlementService.ts:392-394`; `ExitPayService.ts:76` |
| Scripts | `import-students.ts` (current year, else **upserts "2026"**), `seed-routine.ts`, `backfill-ct-scripts.ts`, `help/fixture.ts` (hard-coded 2026) | `server/scripts/import-students.ts:72-79` etc. |
| App, ~20 screens | `years.find(y => y.current) ?? years[0]`. `academicYears` is sorted **label descending**, so the fallback `years[0]` is **2029** | `S/foundation/resolvers/classes.ts:111-116`; `A/components/selects.tsx:203-208` and the list in §1.2 |
| App section context | **A saved 2026 year/class/section pick survives the flip.** It is repaired only when the year is null or deleted | `A/state/SectionContext.tsx:79-89` |
| App section labels | Load only the current year's classes, so 2026 section ids lose their label after the flip | `A/lib/useSectionNames.ts:22-30` |

Calendar-year readers that only label Drive folders (`new Date().getFullYear()`) are harmless
(`WorksheetService.ts:534`, `ActivityBankService.ts:197`, `StorybookService.ts:491` and others).

### 1.2 Lists of classes, sections and windows with no year filter

App pickers are safe: every class/section picker goes through `CLASSES_QUERY(academicYearId)`
(`A/graphql/operations.ts:220`; `classes.ts:87-88`). The server is not.

| Pattern | Sites | Effect once 2027 rows exist |
|---|---|---|
| `Class.find({level})` | `S/routine/services/RoutineTriggerService.ts:481`, `S/notifications/services/emitters.ts:1611` | Matches both years' classes, so alerts go to the wrong teachers |
| `Class.find({active:true})`, first match per level | `S/printing/resolvers/printRequest.ts:705-711` | Print tag suggestion picks either year |
| `Class.find({})` / `Section.find({})` | `S/workboard/services/WorkBoardService.ts:158-159`, `S/content/contentScope.ts:53`, `S/classroom-observation/services/ObservationRotaService.ts:101-104`, `S/exams/services/ExamSyllabusReadService.ts:792`, `S/popup-notices/services/PopupAudienceService.ts:226,335,532,562`, `S/reports/services/MonthlyPendingWorkService.ts:199-200`, `S/foundation/services/StudentBanglaNameService.ts:45-46` | Duplicate rows per level (the syllabus board lists both years) |
| `Section.find({active})` sweeps | monthly sweep `server/src/routes/triggers.ts:91`, `S/reports/resolvers/monthlyReport.ts:375`, `S/attendance/services/AttendanceReportService.ts:642,752`, `S/routine/services/MyDayService.ts:202`, `S/chat/services/ChatGroupService.ts:259`, `S/ai-assist/services/AiAssistService.ts:189` | Sweep both years. This is safe only while the 2026 sections have no live students |
| Sections by class teacher, no year | `attendanceBacklog.ts:105`, `StudentAttendanceService.ts:544`, `studentAttendance.ts:891`, `PendingAlertService.ts:332`, `ClassTeacherService.ts:136`, `MyDayService.ts:258`, `MeetingChainService.ts:655,1066`, `ImpersonationService.ts:262` | A teacher who is class teacher in both years gets both years' backlogs |
| `ScheduleWindow.find({active:true})` | `S/guardian/services/GuardianPortalService.ts:284,475`, `S/routine/services/LiveClassBoardService.ts:223`, `S/routine/services/RoutineTriggerService.ts:39`; `PendingAlertService.ts:229-235` (earliest window across years) | 2026 and 2027 bell windows are both live |
| Section-split script | `skills/_tools/section_split_by_gender.cjs:80` `findOne({level, active})` | May pick the 2026 class |

Already filtered by year (complete list): `classes.ts:88`, `LessonProgressService.ts:164`,
`ExamRoutineService.ts:143,205`, `MasteryRollupService.ts:72`.

### 1.3 How a student is tied to a class and section

- `Student` has one `classId`, one `sectionId`, `rollNumber`, `schoolId` (unique) and `active`. It has no
  history (`S/foundation/models/Student.ts:41-60`).
- **Admission:** `createStudent` takes the ids as given. It does not check that the section belongs
  to the class, and nothing in the app calls it (`S/foundation/resolvers/students.ts:163-181`). The
  real path is `server/scripts/import-students.ts:138-155`, which **re-sets classId, sectionId and
  `active:true` on every run**. Re-running it after the change would move children back.
- **schoolId** is never generated. It comes from the spreadsheet "ID" column
  (`server/scripts/extract-students.py:91,116`). The real format is not verified.
- **Roll number:** written only by `setStudentRollNumber` (`students.ts:145-161`). No app screen calls it.
- **Leavers:** nothing anywhere sets `Student.active = false`. There is no mark-left, transfer or
  promotion code.
- **Moves:** only bulk moves exist, through merge/split (`S/foundation/services/SectionMergeService.ts:101,173`;
  `section_split_by_gender.cjs:187`). They call `rehomeStudentRecords`
  (`S/trackers/services/recordRehome.ts:35-63`), which moves a child's homework and assignment records
  and DRAFT/READY monthly reports to the new section. **It must never be used for promotion.** It
  would drag 2026 history into 2027 sections.
- **Precedent:** class tests already rebuild the roster of an "emptied" section. The comment says
  "Students carry no section history, so this is reconstructed" (`S/trackers/classTestAnchor.ts:251-293`).
  The fallback is "the class's active students", which is empty after a year change.
- **Roster reads:** 199 `Student.find/countDocuments/distinct/…` calls in 103 files; 128 of them filter on
  `sectionId` or `classId`. Examples: `rosterOf` (`S/mastery/services/MasteryWorkService.ts:355-359`),
  `rosterForUnit` (`S/attendance/attendanceUnit.ts:164-178`), the class-test roster
  (`classTestAnchor.ts:244-250`), `sectionMonthMetrics` (`S/reports/services/MonthlyMetricsService.ts:732`),
  `studentsInSection` (`S/foundation/resolvers/students.ts:89`), `Section.studentCount` (`classes.ts:57-59`).

### 1.4 Per-module findings

"At the change" assumes the naive move: `Student.classId/sectionId` point at 2027 sections and nothing
else changes. Risk: **DL** = data written wrong or lost · **WV** = wrong or empty view (data intact) ·
**BL** = blocks 2027 work · **C** = cosmetic.

**Foundation**

| Item | Keys on | At the change | Risk | Path |
|---|---|---|---|---|
| Class / Section | `Class(level, academicYearId)` unique; `Section(classId, code)` unique | 2027 rows can coexist. There is **no `createSection` mutation** and no copy-to-new-year | BL | `Class.ts:31`, `Section.ts:40`; `classes.ts:249-273` |
| Class teacher | `Section.classTeacherId/supportTeacherIds/homeworkConfirmerId`; append-only log `ClassTeacherAssignment(sectionId, at)`, no year | 2026 values stay as history; 2027 sections need fresh values | BL | `S/foundation/services/ClassTeacherService.ts:38-103`; `S/middleware/authz.ts:364-374` |
| Scope grants | teaching: `classId+sectionId+subjectId`, `expiresAt`; supervisory/delegation: `extent` + `classId`/`explicitSet` (one year's classId) | Routine grants for 2027 come from 2027 slots. **Supervisory and delegation grants on 2026 classes go stale** | BL | `S/foundation/models/ScopeGrant.ts`; `ScopeGrantService.ts:88-105,126-206`; `S/routine/services/RoutineSlotService.ts:380-430` |
| Guardian link | `guardianId, studentId`; no year | Survives | — | `S/foundation/models/GuardianLink.ts` |
| Directory | `Student.find({active:true})`; labels from the live class | Shows 2027 | — | `S/foundation/services/StudentDirectoryService.ts:125-140` |

**Attendance** — records: `StudentAttendanceDay(sectionId | subjectGroupId, dateKey, absentStudentIds)`, no year
(`S/attendance/models/StudentAttendanceDay.ts:19-66`). Since 2026-07-13, Class 1–5 children are
marked on their **Quran SubjectGroup**. Nursery/KG (`level <= 0`) and children with no Quran group are
marked on the section (`S/attendance/attendanceUnit.ts:47-125`). Rosters are always live (`:164-178`).

| View | At the change | Risk | Path |
|---|---|---|---|
| Absentee report (2026 date) | Each child is resolved to their *current* unit. Nursery/KG and pre-cutover section days drop out; group days show 2027 labels | WV | `AttendanceReportService.ts:104-135` |
| Student history / absent-without-application | Reads only the current unit and section, so 2026 section days disappear | WV | `AttendanceReportService.ts:472-484,526-538` |
| Section register | `Student.find({sectionId})` is empty | WV | `AttendanceReportService.ts:337` |
| Amend a past day | The roster is empty, so `validateAbsentees` rejects every absentee | BL (2026) | `S/attendance/services/StudentAttendanceService.ts:284-289` |
| Ranking | Filters by current class/section/group | WV | `AttendanceRankingService.ts:349-418,524-536` |
| Quran-group days | Unaffected by the section move. Reshuffling groups wipes past days from history (memberships have no dates) | WV | `S/routine/models/SubjectGroupMembership.ts:9-39`; `S/routine/services/GroupRetireAttendanceService.ts:50-80` |

**Routine**

| Item | Keys on | At the change | Risk | Path |
|---|---|---|---|---|
| Slots | `groupType/groupId`, `classId`, day, period, subject, teacher, `effectiveFrom/To`; no year | 2026 dates still resolve. **Open-ended 2026 slots block 2027 slots** in the conflict engine (same teacher; same Quran/Arabic group) | BL | `S/routine/models/RoutineSlot.ts:17-49`; `RoutineSlotService.ts:101-109,442-470`; `conflicts.ts:30-48` |
| Copy / draft routine | **Does not exist.** Slots are created one at a time | — | BL | `S/routine/resolvers/routineSlots.ts:320-370` |
| Period grid | `(audienceKey, season)`; chosen by `level<=0 ? "nursery_kg" : "class_1_5"`. Guardian/observation look up `classLevels.includes(level)` | Level 6 gets the class_1_5 grid by key, **but no period times in the guardian view until the data has 6 in `classLevels`** | BL (C6) | `S/routine/slotView.ts:42-43`; `S/guardian/services/GuardianPortalService.ts:288,476`; `ObservationRotaService.ts:151` |
| Schedule windows | `ScheduleWindow.academicYearId` is required, but readers ignore it (§1.2) | 2027 windows are needed; both years are then live | WV/BL | `S/routine/models/ScheduleWindow.ts:17,30` |
| Substitution / cover / class note | `(slotId, date)`; `StaffCoverSlot` snapshots class/section | Survive | — | `RoutineSubstitution.ts:17-20`; `ClassNote.ts:14-48`; `S/hr/models/StaffCoverSlot.ts:70-71` |
| Subject list | `ROUTINE_SUBJECTS` = BAN ENG MATH SCI BGS ARABIC ISLAM QURAN. **No ICT/BAN2/ENG2.** Grant binding is limited to `ROUTINE_GRANT_SUBJECTS` (a literal) | C6 slots refused | BL | `V:1286`; `S/routine/binding.ts:16` |

**Subject groups** — `SubjectGroup` has no year or class. `SubjectGroupMembership(groupId, studentId, track)` is
unique per track and **undated**; removing a member hard-deletes it and logs only `SubjectGroupDeparture.leftAt`
(`S/routine/models/SubjectGroup.ts:15-40`; `SubjectGroupMembership.ts:16-39`; `S/routine/resolvers/routine.ts:430-470`).
Unaffected by a section move. There is no bulk re-group.

**Trackers**

| Item | Keys on | At the change | Risk | Path |
|---|---|---|---|---|
| **ID sequences** | `HomeworkSequence/AssignmentSequence/ClassTestSequence(academicYearId, classLevel, subject)`, `ClassTestGroupSequence(academicYearId, groupId)`, `ScholarshipSequence(year, level, key)`. **The IDs carry no year and are `unique: true`** | The 2027 counter restarts at 1, so **every create fails (E11000)** until it passes the 2026 maximum. Each failed attempt still bumps the counter | **BL** | `S/trackers/models/HomeworkItem.ts:73`; `HomeworkSequence.ts:24-34`; `S/trackers/services/HomeworkService.ts:72-91,303`; `AssignmentItem.ts:72`; `AssignmentService.ts:53-65`; `ClassTest.ts:159`; `ClassTestService.ts:54-87`; `S/scholarship/models/ScholarshipPaper.ts:112` |
| Homework | Item: year, class, section, date; records: `studentId+sectionId` (stored) | Stored records still show on 2026 sections. Nothing can be issued to them (roster 0) | — | `HomeworkItem.ts:111-113`; `HomeworkAutoIssueService.ts:51`; `HomeworkService.ts:252` |
| Assignment | `AssignmentSchedule` one per year; item unique `(year, week, section, subject)` | **A 2027 schedule is required**. If the flag is not flipped, weeks pass 53 and the board throws | BL | `AssignmentSchedule.ts:71`; `AssignmentScheduleService.ts:88-176,323` |
| Gifts / streaks | Award unique `(year, student, kind, week)`; stamps class/section | The 2026 section report is empty (live roster). **A late 2026 handover stamps the 2027 class** | WV + DL | `S/trackers/services/AssignmentGiftService.ts:236-244,606-631`; `S/trackers/resolvers/assignmentGift.ts:75-80` |
| Class tests | `ctId`, year, class, section or group; results `(testId, studentId)` stored | Roster and completion denominator are live, so an unfinished 2026 test lists nobody, and its denominator 0 reads as complete | WV + BL | `S/trackers/classTestAnchor.ts:232-293,367-375`; `ClassTestSummaryService.ts:287-309` |
| Student profile | Counters by `studentId` (survive); header, classmates and permission gate from the live section | The 2026 class teacher loses access; the 2026 window needs an explicit range | WV | `StudentProfileContextService.ts:90-174,343-345`; `S/trackers/resolvers/studentProfile.ts:63-80` |
| Nil declarations, reconciliation | `(sectionId, subject, dateKey)`, `(classId, reconDate)` | Survive | — | `HomeworkNilDeclaration.ts:49`; `HomeworkReconciliation.ts:96` |

**Exams and scholarship**

| Item | Keys on | At the change | Risk | Path |
|---|---|---|---|---|
| Exam / syllabus / exam routine | `Exam(academicYearId, term)` unique; syllabus `(examId, classId, subject)` | Guardian syllabus/routine for a 2026 exam use the live classId, so they show nothing. The syllabus board lists both years' classes | WV | `S/exams/models/Exam.ts:33,45`; `ExamSyllabusReadService.ts:538-556,792`; `ExamRoutineService.ts:289-311` |
| Paper drafts / reference papers | `year` number, term, `classLevel` (max 5) | Survive; C6 is refused | BL (C6) | `S/exam-papers/services/ExamPaperDraftService.ts:72`; `ExamPaperDraft.ts:173` |
| Viva | Paper `(examId, classId, subject)`; roster `Student.find({classId})` live; synced from **all** ORAL slots with no year filter | 2026 papers show no children, and editing is refused | WV | `S/viva/services/VivaService.ts:263-311,326,711,738-741` |
| Quran exam | Sittings store `groupId`, level; labels come from the live class | 2026 results carry 2027 labels. **Bug: `myQuranExamSittings` maps paper by level across all published exams, so 2026 sittings get scored against the 2027 paper.** The load script throws if two exams share a name | DL (display) | `S/quran-exam/services/QuranExamService.ts:156-168,595-603`; `server/scripts/load-quran-exam.cjs:50-51` |
| Scholarship | Paper per section; roster `{classId, active, !excluded}` live | 2026 analysis is empty; `scholarshipExcluded` follows the child into C6 | WV | `S/scholarship/services/ScholarshipAnalysisService.ts:480-491`; `ScholarshipService.ts:365-376,573` |
| Archive | Bundle copies year/class/section from the test; box `BX-{calendarYear}-{nn}` | Retention needs a current year (above). Duplicate ctIds make the label search match both years | DL (if no current) | `S/archive/services/ArchiveService.ts:200-215,334-345,480-505,619-620` |
| Printing | Request `classId, sectionId, copiesClassId` | A reprint of a 2026 per-present job waits forever (no attendance on the 2026 class). Tag regexes accept `C[1-5]` only | WV | `S/printing/services/PrintRequestService.ts:347-392,1117-1122,1384-1389` |

**Mastery** (another session is building mastery tonight; YC-7 touches these files only after that work merges)

| Item | Keys on | At the change | Risk | Path |
|---|---|---|---|---|
| Evidence | `studentId, sectionId, academicYearId, classToken, loCode`; index on `studentId+loCode` | Survives, and is findable by student across years | — | `S/mastery/models/MasteryEvidence.ts:18-26,83` |
| Enablement | Unique `(academicYearId, classToken, subject)` | **2027 needs fresh rows** (needs LOCKED outcomes) | BL | `MasteryEnablement.ts:37`; `MasteryCatalogueService.ts:1229-1244` |
| `rosterOf` / heatmap / diagnosis | `rosterOf` is live; `studentContext` derives the section from the live Student | 2026 heatmap empty; a child's diagnosis shows 2027 only; no year argument exists | WV | `MasteryWorkService.ts:355-359`; `MasteryDiagnosisService.ts:72-77,310-317,414-419,634-728` |
| Cross-class earlier steps | `resolveEarlierSteps` reads by `studentId` over any year | **Works** — this is the cross-year objective path | — | `MasteryDiagnosisService.ts:178-218` |
| Repeaters | Same-class codes are read from the current section only | A repeater's 2026 evidence for the same class is not shown | WV | `MasteryDiagnosisService.ts:202,220-226` |
| Guardian / rollup | `childMasteryAssignments` filters on the live section; `schoolRollup` has no year | 2026 hidden | WV | `MasteryGuardianService.ts:92-98,173-188`; `MasteryRollupService.ts:53-62` |

**Reports, meetings, progress, guardian, other**

| Item | Keys on | At the change | Risk | Path |
|---|---|---|---|---|
| Monthly report | Unique `(studentId, periodKey, revision)`; **section/class come from the live Student and year from the *current* year at build time** | December 2026 is still revisable after 3 Jan (draft day 1, 14-day window). A rebuild stamps 2027 section/class/year; year-to-date fees reset to 0 | **DL** | `MonthlyReportService.ts:331,377-396,840`; `MonthlyReportConfigService.ts:67-69`; `MonthlyMetricsService.ts:605-620,732` |
| Lesson progress | `LessonDelivery.rosterStudentIds` is a snapshot taken at write time | **Re-editing a 2026 class note after the move re-snapshots an empty roster** | **DL** | `S/lesson-progress/services/LessonDeliveryService.ts:341-353`; `StudentLessonService.ts:169,206-212` |
| Parent meetings | Meeting has year + `includeScope.classIds/sectionIds`; scope resolved live | An unfinished 2026 chain gets an empty scope; the brief shows the 2027 class; `previousMeetingOf` has no year bound | WV | `S/comments/services/ParentMeetingService.ts:332-399`; `MeetingChainService.ts:231-233`; `MeetingBriefService.ts:75-97,340,414-424` |
| Comments | `StudentComment.sectionId` stored at write | Survive | — | `S/comments/models/StudentComment.ts:75` |
| Improvement / progress board | Action `sectionId, classId, studentId`; board live | 2026 board empty; a CLASS action running across 3 Jan loses its guardians | WV | `S/improvement/services/ImprovementActionService.ts:167-172,419-422,661-668,792,913,1040`; `ProgressBoardService.ts:139,212,289` |
| Guardian portal | No year concept; class notes, nil days, class tests and period grid come from the live section and class | Cannot show last year. Monthly reports, fees, attendance and leave are by `studentId` and survive | WV | `S/guardian/services/GuardianPortalService.ts:280-292,325-390,714,867-894,977-991` |
| Leaver's guardian | `myChildren` filters `Student.active:true`; `assertGuardianOfStudent` does not check `active` | A leaver disappears from the portal; direct reads by id would still pass | C | `GuardianPortalService.ts:332`; `S/middleware/authz.ts:346-362` |
| Notifications / pop-ups | Emitters use live rosters; pop-up audience by level/section/student, resolved at publish | Saved audience lists holding 2026 section ids go stale; `LEVELS` is −1..5 | C / BL (C6) | `S/notifications/services/emitters.ts:237,1537,2028`; `PopupAudienceService.ts:56,331-351`; `PopupAudienceList.ts:37` |
| Worksheets / activity / class books / library | Worksheets Nursery/KG only; activity issues and loans by `studentId`; class books by level | The activity skill report re-buckets 2026 issues by the current class | C | `S/activity-sheets/services/ActivityReportService.ts:75-89`; `ClassBookService.ts:113-121` |
| Finance | Postings, fee support and dues by `studentId`; `BudgetLine(academicYearId, head)` | Survive; create the 2027 budget as usual | — | `S/finance/services/FeeSupportService.ts:278-290`; `BudgetLine.ts:41` |
| HR | Entitlement `(staff, year, type)`, appraisal per year; leave year = the year covering the date | The 2027 `startDate` must be ≤ 3 Jan (`createAcademicYear` gives 1 Jan) | — | `S/hr/models/StaffLeaveEntitlement.ts:50`; `StaffLeaveService.ts:131-138` |
| Chat / guardian notices | Section groups from active sections; `GuardianNotice` section-scoped | New 2027 groups needed (auto) | — | `S/chat/services/ChatGroupService.ts:201,259`; `GuardianNotice.ts:33,44` |
| Permissions / sidebar | No year or class keys | — | — | `shared/permissionCatalogue.ts` |
| Saturday revision, daily report, teaching notes, support book | No section/class/year keys | Unaffected | — | `S/saturday-revision/models/RevisionEntry.ts:55-59`; `S/daily-report/models/DailyReport.ts:125` |

---

## 2. The model choice

| | (a) Enrolment only | (b) Move `sectionId`, rely on stored fields | **(c) Hybrid — recommended** |
|---|---|---|---|
| Idea | Every roster reads a dated enrolment; `Student.classId/sectionId` removed | Overwrite the pointers; each record keeps the class/section it stored | Add the dated enrolment; keep `Student.classId/sectionId` as **a pointer to the current enrolment**, kept equal by every writer |
| Readers to change | All 199 `Student.*` roster reads + app | The ~30 past-period readers in §1.4 **cannot** be fixed from stored fields: attendance stores only absentees, class-test denominators, Nursery/KG section days, the meeting scope, the lesson snapshot and the guardian portal store no roster. A roster per record would have to be invented module by module | ~30 past-period readers switch to `sectionRoster()` / `enrolmentOf()`; ~170 "today" readers unchanged |
| 2026 views | Correct | Partly empty forever | Correct |
| Cross-year objective record | Works (one `Student` row) | Works (`MasteryEvidence.studentId`) | Works |
| Mid-year moves (a later split) | Native | Needs `rehomeStudentRecords` again | Native, and replaces the "emptied section" reconstruction (`classTestAnchor.ts:251-293`) |
| Fits 3 Jan | No | Yes, but loses history | Yes |

**Recommendation: (c).** The cross-year objective record does not decide it, because all three keep one
`Student` row and `MasteryEvidence` is keyed by `studentId`. **Last year's views** do decide it. Only an
enrolment can answer "who was in 3 Boys on 14 Oct 2026". With the pointer kept, every 2026
section looks *emptied* after the cut-over, exactly like the সম্মিলিত sections after the C4/C5 split.
The code already treats an emptied section as closed to new work (D-#706, D-#720, D-#770). New work is
therefore refused on 2026 sections with no new code, and only the past views need the enrolment.

### 2.1 Enrolment record (proposed)

`Enrolment { studentId, academicYearId, classId, classLevel, sectionId, rollNumber?, status, startKey,
endKey?, outcome?, runId?, createdBy, timestamps }`

- `status`: `PLANNED` (prepared, not live) · `ACTIVE` · `CLOSED`.
- `outcome` on CLOSED: `PROMOTED` · `REPEATED` · `LEFT` · `MOVED` (mid-year section move).
- Indexes: unique `(studentId, academicYearId, startKey)`; `(sectionId, status)`; `(academicYearId, classId)`.
- **Invariant (tested):** for every student, `Student.classId/sectionId` = their ACTIVE enrolment in the
  current year. `Student.active` holds exactly when such an enrolment exists.
- Helpers (one service, `S/foundation/services/EnrolmentService.ts`):
  - `sectionRoster(sectionId, { on?: dateKey })` — enrolments of the section covering the date, or all of them.
  - `enrolmentOf(studentId, { academicYearId } | { on })`.
  - `currentYearId()` (cached per request).
  - `isCurrentYearSection(sectionId)`.
- **Rule for readers:** a screen about *today* keeps reading `Student`. A screen about *a date, a month,
  an exam or a past section* reads `sectionRoster` / `enrolmentOf`.

---

## 3. The year-change procedure (Principal)

One new screen, **শিক্ষাবর্ষ পরিবর্তন** (year change), under Admin. It has three steps. Each step shows a dry run listing every row it
will create or change, and writes only on "চালু করুন" (apply). Every write carries the run id
(`runId`) and an audit row `YEAR_CHANGE_*`. Office cannot run it; see the permissions in YC-5.

**Step 1 — Prepare (any day in December; nothing visible changes)**

1. **Year:** pick 2027 (it already exists; the dry run prints its dates; `startDate` must be ≤ 3 Jan).
2. **Classes and sections:** one row per class, pre-filled from the 2026 shape (Nursery, KG, C1, C2 = one
   section; C3–C5 = বালক/বালিকা) plus **Class 6 = বালক/বালিকা**. The Principal can turn a class into
   one or two sections. It writes 2027 `Class` + `Section` rows (codes `Main` / `Boys` / `Girls`).
3. **Promotion list per class:** every active child is ticked to move up one level, and is placed in the
   same-named section, or by gender when the target class is split. Untick = repeats (same level,
   2027 section). "চলে গেছে" = left. Class 5 → Class 6. Optional roll number column. It writes
   **PLANNED** 2027 enrolments only. Pointers are untouched.
4. **New admissions:** name, gender, schoolId (typed, uniqueness checked), class, section, guardian phone.
   It writes `Student(active:false)` + a PLANNED enrolment + the guardian link through the
   existing provisioning. The child becomes active at the cut-over.
5. **Class teachers:** pre-filled with the 2026 teacher of the same level and section code; the Principal edits.
   Written to the 2027 sections (log rows as today).
6. **Routine draft:** copies each 2026 section's live slots to the matching 2027 section, **dated
   `effectiveFrom` 2027-01-03** (a future-dated row is the draft: nothing reads it before that day). The
   same run sets `effectiveTo` 2027-01-02 on the 2026 rows. Class 6 starts empty. The Principal fills
   its 20 general periods in the routine editor, with the conflict engine running. Quran/Arabic group
   slots are kept as they are (the groups do not change).
7. **Copies with defaults the Principal can untick:**
   - bell windows (2027 `ScheduleWindow` rows);
   - the 2027 `AssignmentSchedule` (term start 3 Jan, rotation entries mapped to the 2027 sections);
   - supervisory and delegation grants re-pointed to the same-level 2027 class;
   - mastery switches (`MasteryEnablement` for 2027, same class token and subject);
   - **ID counters**: 2027 sequence rows seeded with the 2026 values, so numbers continue (§6 Q5).

**Step 2 — Cut-over (Friday 1 Jan 2027, after 18:00, once the December monthly drafts exist)**

Dry run first, then apply. One run, in this order, idempotent (a re-run finishes a broken run):

1. Refuses if any homework is unissued or an assignment week is DRAFT on a 2026 section (as the split script does).
2. Closes the 2026 enrolments: PROMOTED / REPEATED / LEFT, `endKey` 2026-12-31.
3. Sets the 2027 enrolments ACTIVE, `startKey` 2027-01-01.
4. Moves `Student.classId/sectionId/rollNumber` to the 2027 enrolment. Leavers get `active:false`.
   New admissions get `active:true`. The scholarship flag is cleared for children leaving Class 5.
5. Ends the 2026 CLASS-scope improvement actions (listed in the dry run).
6. **Flips `AcademicYear.current` to 2027** — the last write.
7. Writes the audit row with the before-state of every changed `Student` (the undo uses it).

A named database backup is taken immediately before step 2 (the hourly backup also exists, ADR-011).

**Step 3 — Undo**

- *Before the cut-over:* "প্রস্তুতি বাতিল" (cancel the preparation) deletes every row with this `runId` (2027 classes, sections, enrolments,
  slots, windows, schedule, grants, enablements, sequences) and clears `effectiveTo` 2027-01-02 on
  the 2026 slots it set. The dry run lists what goes.
- *After the cut-over:* "পরিবর্তন ফিরিয়ে নিন" (undo the change) restores each `Student` from the audit before-state, sets the
  2026 enrolments ACTIVE and the 2027 ones back to PLANNED, and flips the current year back to 2026.
  Work created on 2027 sections in between stays on them and is listed. Last resort: restore the
  backup.

**Trial:** the whole run is rehearsed on the dev site (§6 Q15), with a written checklist (§5, YC-6
acceptance), by **20 Dec**. Prod Step 1 happens after the rehearsal; Step 2 happens on 1 Jan.

**Splitting a class later** (e.g. Class 2 in March): the existing `skills/section-split` procedure,
updated in YC-9 to choose the class by current year and to close and open enrolments (outcome
`MOVED`) instead of only overwriting pointers.

---

## 4. Class 6 onboarding (teaching side)

**Built 2026-11-12 (YC-3, D-#1480–#1483).** Row-by-row result (done before / built / left) is in
`docs/overnight-handoff-yc3.md`.

**The other session covers the content side:** the import contract, `SUBJECTS`, and the `C[1-5]` patterns in
`docs/import-contract.schema.json`. I could not see its branch. YC-3 must start from `dev` after that
work merges, and re-check each line below, because `shared/vocab.ts` is a serialized contract file
(AGENTS.md "Parallel sessions" rule 5).

| What | Today | Change | Path |
|---|---|---|---|
| Roster level | `ROSTER_CLASS_LEVELS` −1..5, `MAX = 5` | add 6 (follows into Class, HomeworkItem, AssignmentItem/Schedule/Gift/Nil, ReferencePaper, ExamPaperDraft, ClassBook, TeachingNote, Vocab, ActivityBank, Storybook) | `V:84-87` |
| Class labels | `ROSTER_CLASS_LABELS_BN/EN` stop at 5 (typed record, so tsc forces 6) | ষষ্ঠ শ্রেণি / Class 6 | `V:124-132,1047-1055` |
| Local label maps | `ROSTER_CLASS_BN` (falls back to `শ্রেণি ৬`); pop-up audience **no fallback** (`undefined`); import script fallback `level 6` | add 6 | `S/trackers/services/StudentProfileSheetService.ts:30-38`; `PopupAudienceService.ts:449,456`; `server/scripts/import-students.ts:90` |
| Teaching subjects | `HW_SUBJECTS` / `ROUTINE_SUBJECTS` / labels lack ICT, BAN2, ENG2 | add the three with BN/EN labels; 13+ Mongoose enums follow (§1.4) | `V:939-953,1160,1286-1293` |
| Subject label by class | BAN = "বাংলা" | In Class 6, BAN/ENG read "১ম পত্র"; BAN2/ENG2 read "২য় পত্র". One helper `subjectLabel(code, level)` | `V:953,1289` |
| Grant subjects | literal `ROUTINE_GRANT_SUBJECTS` | add ICT, BAN2, ENG2; `Subject` rows must exist (seed only creates `FOUNDATION_SUBJECTS`) | `S/routine/binding.ts:16`; `S/foundation/models/Subject.ts:4`; `server/scripts/seed.ts:112-115` |
| ID / code regexes that assume letters only | `HW_ID_RE ([A-Z]+)`, `GENERIC_TOPIC_CODE_RE TOP-[A-Z]+`, AI-assist `^[A-Z_]{2,20}$`, mastery `LO-[A-Z0-9]+-[A-Z]+-` and the subject alternation | allow digits: `[A-Z][A-Z0-9]*` | `S/trackers/services/HomeworkSummaryService.ts:42`; `HomeworkService.ts:51`; `S/ai-assist/services/AiAssistService.ts:146`; `S/mastery/services/MasteryAssignmentService.ts:678`; `A/screens/mastery/masteryReviewUi.tsx:66`; `masteryStateUi.ts:39`; `V:5410,5413` (mastery: coordinate with the other session) |
| Homework topics | `HomeworkTopic.classLevel` max 5 | max follows roster; seed generic topics for C6 | `S/trackers/models/HomeworkTopic.ts:51`; `server/scripts/seed-homework-topics.ts:31` |
| Literal 1–5 checks | exam-paper draft validator; pop-up levels; observation default levels; English Drive 1..5 (model, service, app regex); print tag regexes; class-note `mayHavePlan` | widen to 6 (English Drive and observation: owner choice, §6 Q16) | `ExamPaperDraftService.ts:72`; `server/scripts/exam-papers/validate-drafts.mjs:49`; `PopupAudienceService.ts:56`; `A/screens/popup/PopupComposeScreen.tsx:61-62`; `ObservationRotaService.ts:64`; `rota.ts:65,307`; `S/english-drive/services/EnglishDriveService.ts:41,152,300`; `EnglishDriveDoc.ts:75`; `A/lib/englishDrive.ts:98`; `PrintRequestService.ts:1117-1122`; `A/screens/classnotes/MyClassNotesScreen.tsx:77` |
| App literal subject lists | reference papers; teaching-note order | add the three | `A/screens/exampapers/ReferencePapersScreen.tsx:29`; `A/lib/teachingNotes.ts:48` |
| Period grid | C6 falls on `class_1_5` (8 periods: P1–P2 Quran, P3 Arabic, P5–P8 general, 35 min). This matches "4 general periods a day" | **data:** add 6 to that grid's `classLevels` | `S/routine/slotView.ts:43`; `server/scripts/seed-routine.ts:226-236` |
| "Senior" marks drivers | `level >= 4` includes 6; text says "চতুর্থ ও পঞ্চম" | decide: include 6 (text "চতুর্থ–ষষ্ঠ") | `S/reports/services/marksDriversStats.ts:471`; `A/screens/reports/MarksDriversScreen.tsx:207-208` |
| Unused rule | `ROUTINE_SUBJECTS_CLASS3_PLUS` documented as enforced, but nothing reads it | leave; note in YC-3 | `V:1301` |
| Safe already | `classToken(6)` = C6; mastery tokens include C6; `SCHOLARSHIP_CLASS_LEVELS=[5]` is a membership test; attendance treats level ≥1 as Quran-group capture | — | `V:98-121,5314,5325`; `attendanceUnit.ts:54` |

**Weekly routine for Class 6** (owner's split, 20 general periods): Math 4, Science 4, ENG 3, BAN 2,
BAN2 2, BGS 2, ENG2 1, ICT 1, ISLAM 1. The routine editor already validates by subject, so once
YC-3 is live the Principal enters it in Step 1.6 for each Class 6 section.

---

## 5. Build slices

Each slice is one PR into `dev`, with its help guide (D-#973) and permission entries (D-#799) in the
same PR. **Test fixture (all slices, no real roster):** `server/src/__tests__/fixtures/yearChange.ts`
on the in-memory Mongo already used by the server tests. It holds:

- years 2026 (current), 2027 and 2029;
- classes Nursery, KG, C1, C2 (Main), and C3–C5 with an emptied সম্মিলিত plus বালক/বালিকা, all in 2026;
- 3 fake children per section (`Test Child A1`…, schoolIds `T-001`…), one Quran group spanning C3–C5,
  one Arabic group;
- for one C3 section and one Nursery section: 2 homework items with records, 1 assignment week,
  2 class tests (one unfinished), attendance days on both group and section;
- one mastery evidence row, a DRAFT December monthly report, a released November report, a lesson
  delivery, a CLASS improvement action and a supervisory `grade_class` grant;
- a planned outcome list: one repeater (C2), one leaver (C4), two admissions into C6.

| Slice | Must be live by | Content | Acceptance tests (executed) |
|---|---|---|---|
| **YC-0 Guard rails** | 6 Dec | (1) `setCurrentAcademicYear` refused outside the year-change flow (new action `year_change:cut_over`, Principal only); `classes_sections:settings` keeps "add a year". (2) Current-year filter on every §1.2 site, including `mySectionsAsClassTeacher` and `ScheduleWindow` readers. (3) ID generators: when a counter is new for a year, seed from the highest earlier value for the same key; translate E11000 into a Bangla message. (4) Archive retention refuses to mark anything disposable when no year is current. (5) Quran-exam paper map keyed by `examId+level`. (6) `import-students.ts` refuses to run when a non-current year has classes. (7) `academicYears` sorted by `startDate` desc | With 2027 rows present: each §1.2 reader returns only the current year (one test per module); 2027 homework/assignment/CT/SP creates succeed after 2026 has `-0005`, and the next id is `-0006`; archive with no current year → 0 disposable; the 2026 Quran sitting scores against its own paper after a 2027 exam is published; Office calling `setCurrentAcademicYear` → Forbidden |
| **YC-1 Enrolment record** | 6 Dec | Model + `EnrolmentService` helpers + backfill script (dry run / APPLY) giving one 2026 ACTIVE enrolment per student. Split history is reconstructed best-effort from `SectionMerge.moves` and the `SECTIONS_SPLIT` audit; whether the audit names students is not verified. Writers keep the invariant: `createStudent`, merge/split, split script | Backfill on fixture: counts equal active students; invariant check passes; `sectionRoster(সম্মিলিত, on: before split)` = pre-split children; re-running the backfill writes 0 |
| **YC-2 Past-period readers (data-writing + core)** | 13 Dec | Switch to `sectionRoster`/`enrolmentOf`: attendance (`resolveUnits` by date, report, history, register, amend, ranking); class-test roster + denominator (replaces `emptiedSectionRoster`); monthly report stamps class/section/year **from the period's enrolment** and year-to-date fees by the period's year; `LessonDelivery` snapshot by note date; gift handover stamp by award year; student profile header/classmates/gate by window year + a year picker | On the fixture after a simulated cut-over: 2026 absentee report, history and ranking equal the pre-cut-over output (snapshot compare); amend a 2026 day OK; unfinished 2026 CT lists its 3 children; December revision keeps the 2026 section/year; re-editing a 2026 class note keeps its roster; the 2026 class teacher opens the 2026 profile read-only |
| **YC-3 Class 6 + new subjects** | 13 Dec (after the other session's vocab PR) | Everything in §4; `Subject` rows ICT/BAN2/ENG2; period-grid data; generic C6 topics | Create a level-6 class; routine slot for each of the 9 subjects; declare `HW-C6-BAN2-0001` and parse it back; CT and syllabus for ENG2; labels "বাংলা দ্বিতীয় পত্র"; verifiers in AGENTS.md green; tsc 0 |
| **YC-4 Year-change engine** | 13 Dec | `planYearChange` / `applyPrepare` / `applyCutover` / `undoPrepare` / `undoCutover` services, `runId`, audits, a dry-run printer, the refusal rules of §3; a VM script wrapper for the rehearsal | Fixture: prepare dry run lists exact counts; prepare writes PLANNED only (every today-reader unchanged — snapshot); cut-over moves the repeater/leaver/admissions correctly; current = 2027; re-run = 0 writes; undo-cutover restores the pointer snapshot byte for byte; undo-prepare leaves 0 rows with the run id; 2026 slots end 2027-01-02 and 2027 slots start 2027-01-03 with 0 conflicts |
| **YC-5 Principal screens + app year handling** | 17 Dec + OTA | Year-change screen (3 steps, promotion list per class, admissions, class teachers, dry-run view); permissions `year_change:view/prepare/cut_over/undo` (Principal only); help guide; `SectionContext` drops a saved pick whose year is not current; `useSectionNames` resolves any section id; `AcademicYearSelect` labels the past year | Local UI walk on the fixture (as for other features): untick → repeater, mark left, add admission, dry run, apply; teacher app with a saved 2026 pick opens on 2027 after the flip; a 2026 section id shows "৩য় শ্রেণি বালক (২০২৬)"; help verifier green |
| **YC-6 Routine + schedule copy** | 17 Dec | The copy in §3 step 1.6–1.7 (slots, bell windows, assignment schedule, grants, mastery switches, sequences), including the C6 empty grid | Fixture: copied slots per section equal 2026's; conflict engine 0; grants for 2027 teachers active from 3 Jan; 2026 grants expire 3 Jan; assignment handout on 3 Jan shows week 1 |
| **Rehearsal** | **20 Dec** | Full run on dev (§6 Q15) + checklist: one child per class across attendance, homework, CT, mastery, monthly report, profile, guardian | Checklist signed off by the owner |
| **YC-7 Past-period readers, part 2** | 31 Jan | Guardian "গত বছর" (last year) tab (class notes, homework, CT, exam syllabus/routine, mastery, monthly reports); mastery heatmap/diagnosis/rollup with a year argument and repeaters' prior-year trail (after the mastery branch merges); parent-meeting scope + brief window; improvement board; viva; scholarship analysis; Quran-exam labels; activity skill report; print reprint of a 2026 job | Each view on the fixture shows the same 2026 data before and after the cut-over |
| **YC-8 Dated group memberships** | before any Quran/Arabic re-grouping | `joinedKey/leftKey` on memberships (backfill from `createdAt` + `SubjectGroupDeparture`); attendance and revision read membership by date; bulk re-group screen | Moving a child Qaida → Nazera keeps their old days in history and ranking |
| **YC-9 Split a class in-year** | when a split is decided | `section-split` skill + script: class by current year; enrolment MOVED/ACTIVE pairs; `rehomeStudentRecords` kept for in-year only | Split the fixture C2: old-section views unchanged; new halves list the moved records |

**Built 2026-11-13 (YC-5, D-#1530).** GraphQL face over the engine (`yearChangeSetup / Plan / CutoverPlan / UndoPlan / Runs`, `applyYearChangePrepare / Cutover`, `undoYearChange`; each gated `year_change:*`, Principal only; engine refusals are registered as expected errors so the Bangla sentence reaches the screen). App screen "শিক্ষাবর্ষ পরিবর্তন" under Admin (drawer leaf + Admin card, `year_change:view`): Prepare / Cut-over (typed new-year confirmation) / Undo, each with its dry run first, and the run history. `SectionContext` drops a saved pick of a past year once the current year has changed; `useSectionNames` / `useSectionLabel` resolve the latest past year's sections too ("... (2026)"); `AcademicYearSelect` labels a past year "(গত বছর)". Help guide `admin-year-change` is a draft until its pictures are taken on the rehearsal. Tests: `yearChangeScreens.test.ts`. Re-opening the screen on a prepared year pair returns that run's decisions, admissions, section shapes, class teachers and copy options (a second apply reconciles to what it is sent, so seeding from defaults would undo the first preparation); the dry run lists what the apply will delete or move. **Dev rehearsal:** the server env var `YEAR_CHANGE_ALLOW_EARLY=1` lets the cut-over (dry run and apply) run before the last day of the old year; set it on the dev service only, never on prod (it is listed in `.env.example`, empty). Undo-cutover with work added on 2027 sections afterwards is blocked in the app; only `server/scripts/year-change.ts undo-cutover --force` overrides it. Not done here: the local UI walk on the fixture and the OTA (lead).

Order: YC-0 and YC-1 in parallel → YC-2, YC-3 (once the content PR merges), YC-4 → YC-5, YC-6 →
rehearsal → prod Step 1 (≈ 21–31 Dec) → prod Step 2 on 1 Jan → YC-7 in January.

---

## 6. Open questions for the owner (each with my recommended answer)

| # | Question | Recommended answer |
|---|---|---|
| Q1 | Sections in 2027 (assumption 1) | Pre-fill the 2026 shape + C6 বালক/বালিকা; the Principal changes any class on the setup screen; later splits via YC-9 |
| Q2 | Default promotion (assumption 2) | Yes: all ticked; untick = repeat; "left" is a separate mark; only the Principal; rehearsal on dev first |
| Q3 | Class 6 shape (assumption 3) | C6 keeps the Class 1–5 day: Quran P1–P2, Arabic P3, four 35-min general periods P5–P8. It joins the existing Quran/Arabic groups, so attendance is captured on the Quran group as for C1–5 |
| Q4 | The stray 2029 year | Delete it in YC-0 after a dry run shows it holds no classes, exams, budget lines, leave rows, windows, schedules or mastery switches. Today it is the fallback in the ranking and the app (`years[0]`) |
| Q5 | ID numbers in 2027 | **Continue the 2026 numbers** (`HW-C3-BAN-0131` …). No ID format, parser, print regex or app change is needed, and IDs stay unique. The alternative (`HW-27-C3-…`) touches every parser |
| Q6 | When does the cut-over run? | **Fri 1 Jan 2027 after 18:00**, after the December monthly drafts exist. Saturday is for checks; Sunday 3 Jan is the first school day. When are 2026 final results and promotion decisions ready? The promotion list must be final by 31 Dec |
| Q7 | Class teachers in 2027 | Pre-fill the same level and section as 2026 (the teacher keeps the class); the Principal edits |
| Q8 | Teachers' access to their 2026 sections | Read-only, indefinitely, for sections they taught: an expired routine grant on a non-current-year section still gives read, never write. Principal/Office see all |
| Q9 | Leavers' guardians | They lose the portal at the cut-over unless a sibling remains (as today). Office prints the final report. Data is kept |
| Q10 | 2027 roll numbers | Optional column on the promotion list, with an "auto by name" button. Blank is allowed |
| Q11 | Quran/Arabic groups on 3 Jan | Unchanged at the year change. Re-group only after YC-8, otherwise past attendance and revision days drop from history |
| Q12 | Repeaters' mastery | Show their 2026 evidence as "last year" in the trail; compute the 2027 state from 2027 evidence only |
| Q13 | Scholarship flag | Clear it for children leaving Class 5 at the cut-over |
| Q14 | Guardian "last year" view by 3 Jan? | By 31 Jan (YC-7). On 3 Jan, monthly reports, fees, attendance and leave are already readable by student; nothing is lost |
| Q15 | Rehearsal data on dev | Restore the latest prod backup into a separate rehearsal database on the VM, point the dev site at it for the rehearsal day, then drop it. Not verified: what the dev site's database holds today |
| Q16 | English Drive and the observation rota for Class 6 | Include C6 (widen to 1..6). Say if C6 English uses a different material |
| Q17 | "Senior" marks drivers | Include C6 with C4–C5 |
| Q18 | Subject names in Class 6 | BAN/ENG show "বাংলা/ইংরেজি প্রথম পত্র" in C6 only; C1–C5 unchanged |
| Q19 | New admission IDs | Office types the schoolId as today; the screen checks uniqueness. Say if you want the app to suggest the next number (format not verified) |
| Q20 | Section labels in 2027 | C3–C6 বালক/বালিকা; Nursery–C2 মূল |

### Decisions proposed for ratification (become D-# rows once approved)

- **YC-D1** Hybrid model: dated `Enrolment` + `Student.classId/sectionId` kept as the current pointer.
- **YC-D2** Past-period readers read the enrolment; today readers read `Student`. 2026 sections become "emptied" after the cut-over.
- **YC-D3** `rehomeStudentRecords` is for in-year moves only, never for promotion.
- **YC-D4** ID numbers continue across years (counters seeded from the earlier year).
- **YC-D5** The current year flips only inside the cut-over run (Principal); Office keeps "add a year".
- **YC-D6** Draft routine = future-dated slots (`effectiveFrom` 2027-01-03); 2026 slots end 2027-01-02.
- **YC-D7** Year change = Prepare (PLANNED rows, invisible) → Cut-over (one idempotent run, flip last) → Undo at both steps; every write tagged with a `runId`.
- **YC-D8** Teachers keep read-only access to sections they taught in a past year.
- **YC-D9** Quran/Arabic memberships are not changed by the year change; dated memberships (YC-8) come first.

---

## 7. Risks (most serious first)

| # | Risk | Guard |
|---|---|---|
| 1 | All new homework/assignment/CT IDs fail on 3 Jan (collision) | YC-0 counter seeding + E11000 message; YC-4 seeds 2027 counters; tested |
| 2 | Someone flips the current year without promoting (Office has the right today) | YC-0 removes the flip from `classes_sections:settings`; only the cut-over run flips |
| 3 | Data written wrong after the flip: December report revisions, lesson-note re-snapshot, gift stamps, Quran-exam paper | YC-2 + YC-0(5); snapshot tests |
| 4 | 2026 views go empty (attendance, class tests, profile, mastery, guardian) | YC-1 + YC-2 by 13 Dec; YC-7 by 31 Jan; rehearsal checklist |
| 5 | Wrong-year rows in sweeps, alerts, bell times, syllabus board once 2027 rows exist (Prepare creates them in December) | YC-0 must be live **before** prod Step 1 |
| 6 | Class 6 or its subjects refused on 3 Jan | YC-3 by 13 Dec; it depends on the other session's `shared/vocab.ts` PR landing first (serialized contract file) |
| 7 | Partial cut-over, no way back | YC-4: idempotent, `runId`, audit before-state, undo, named backup |
| 8 | Teachers' phones still on a 2026 pick or an old bundle | YC-5 OTA by 17 Dec; `SectionContext` reset; old bundles keep working because queries are unchanged |
| 9 | Routine clashes block the 2027 routine | YC-6 ends 2026 rows and copies in one run; conflict engine reports before apply |
| 10 | `import-students.ts` re-run moves children back; the split script picks a 2026 class | YC-0(6); YC-9 |
| 11 | Re-grouping Quran/Arabic children in January erases their past days | Q11 + YC-8 |
| 12 | Stray 2029 year used as a fallback | Q4, YC-0(7) |

**Not verified from the code:** prod's actual year rows and their dates; whether `SECTIONS_SPLIT`
audits name students; the schoolId format; what the dev site's database holds; the content-side
changes the other session is making tonight; `unmarkedSections` behaviour for an emptied section.
