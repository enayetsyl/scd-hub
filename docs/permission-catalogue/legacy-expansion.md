# Legacy expansion — old permissions, role checks and delegations → catalogue actions

This file is the source for three maps in `/shared/vocab.ts` (PRD §5.3, §6):
- `LEGACY_PERMISSION_EXPANSION`: an old permission maps to the new actions it covered.
- `LEGACY_PERMISSION_ALIASES`: the reverse. `myPermissions` still answers the old name to pre-release app bundles.
- `DELEGATED_ACTION_PERMISSIONS`: each delegated duty maps to the actions it needs and widens.

**Rule (R6).** A holder of an old permission, in the role context where it is held, keeps exactly what that permission allowed.
- Most old permissions expand the same way in every context.
- Some old permissions allowed something only together with a role check (`isAdminStaff`, `actsAsRole`, primary role). Their expansion is split by **context**:
  - `any`: the expansion applies wherever the permission is held, including a per-user AC-1 grant.
  - `admin template`: the expansion applies only when the caller also holds the PRINCIPAL or OFFICE template (`isAdminStaff`).
- `PRINCIPAL` holds every action, so its context is never needed.

**Ship-day equality (verifier §C.PM).** For each role r ∈ {TEACHER, OFFICE}, the derived default must equal three sources unioned:
1. the expansion of r's old permissions (`any` rows, plus the `admin template` rows when r = OFFICE);
2. the role-check actions in table 2 that r passed today;
3. the authenticated-only actions in table 3.

Only SELF actions sit outside the equality. They are on for everyone.

## 1. Old permission → new actions
| old permission | context | new actions | note |
|---|---|---|---|
| `content:read` | any | `lesson_plans:view` | also `recentEvents` (corpus, identity-free) |
| `content:import` | any | `lesson_plans:import`, `question_bank:import` | the resolver detects the doc kind |
| `content:assign_review` | any | `plan_review:assign`, `question_review:assign`, `question_review:view_all` | |
| `content:review` | any | `plan_review:review`, `question_review:review` | |
| `content:promote_gold` | any | `plan_review:approve`, `question_review:publish` | |
| `question:read` | any | `question_bank:view` | |
| `question:select` | any | `question_sets:create` | ⚠ a per-user grant of `question:select` **alone** widens to createSet/rename/assemble. Every template that holds it also holds `set:assemble`. |
| `question:manage` | any | `question_bank:edit`, `question_bank:delete` | |
| `set:read` | any | `question_sets:view`, `question_sets:export` | `/pdf/set` gated on set:read today (F-19) |
| `set:assemble` | any | `question_sets:create` | |
| `set:export` | any | — | never checked today (F-19). Alias only. |
| `tracker:read` | any | `homework:view`, `assignment:view`, `assignment_gift:view`, `class_test:view`, `class_test_script:view`, `set_tracker:view`, `student_profile:view`, `student_profile:export`, `saturday_revision:view`, `vocab_test:view`, `monthly_report:view`, `archive:view` | `student_profile` / `monthly_report` also open via the admin template (table 2) |
| `tracker:write` | any | `homework:declare`, `homework:issue`, `homework:mark_submitted`, `homework:check`, `homework:return`, `homework:confirm_day`, `homework:undo`, `assignment:declare`, `assignment:issue`, `assignment:mark_submitted`, `assignment:check`, `assignment:resubmit`, `assignment:return`, `assignment:undo`, `work_claim:reject`, `class_test:view`, `class_test:create`, `class_test:register`, `class_test:edit`, `class_test:enter_results`, `class_test_question:create`, `class_test_script:return`, `set_tracker:enter_results`, `saturday_revision:enter_results`, `saturday_revision:send`, `vocab_test:edit`, `vocab_test:create`, `vocab_test:enter_results`, `student_comments:create`, `parents_meeting:write_notes`, `printing:create`, `archive:create`, `worksheets:create`, `worksheets:send` | `confirm_day` still needs the designation; `undo` rode `authenticated` + write scope; `class_test:view` = own lists (myClassTests) |
| `tracker:export` | any | — | never checked today. Alias only. |
| `gift:manage` | any | `assignment_gift:view`, `assignment_gift:view_all`, `assignment_gift:issue` | |
| `homework:void` | any | `homework:delete` | |
| `routine:read` | any | `routine:view`, `class_note:view`, `class_note:create`, `class_note:edit` | `create` still needs slot teacher/cover |
| `routine:manage` | any | `routine:view_all`, `routine:edit`, `routine:edit_calendar`, `routine:settings`, `cover:assign`, `class_note:view_all`, `class_note:edit_all`, `class_note:delete` | `class_note:edit_all` also comes from isAdminStaff (table 2) |
| `attendance:mark` | any | `attendance:mark` | |
| `attendance:manage` | any | `attendance:view`, `attendance:view_all`, `attendance:edit`, `attendance:assign`, `attendance:record_leave`, `attendance:remind`, `staff_attendance:upload`, `staff_attendance:view_all` | the staff hub attendance tab merges into `staff_attendance:view_all` |
| `library:read` | any | `library:view` | |
| `library:manage` | any | `library:lend`, `library:return`, `library:remind`, `library:edit_all`, `library:edit`, `library:settings`, `library:assign` | `edit_all` = the desk without a LibrarianAssignment |
| `chat:read` | any | `chat:view` | |
| `chat:write` | any | `chat:send`, `chat:send_notice` | `markSeen` moves to `chat:view` (always co-held); `send_notice` needs the class-teacher designation |
| `chat:manage` | any | `chat:create`, `chat:edit`, `chat:publish`, `chat:send_notice_all` | |
| `chat:oversee` | any | `chat:view_all` | LOCKED |
| `roster:manage` | any | `students:view_all`, `students:create`, `students:edit`, `classes_sections:create`, `classes_sections:merge_split`, `classes_sections:settings`, `teaching_assignments:assign_class_teacher`, `teaching_assignments:assign_homework_checker`, `assignment:settings`, `assignment:view_reports`, `assignment:confirm_week`, `class_test:edit_all`, `class_test:delete`, `class_test:publish`, `class_test:revoke`, `class_test_question:prepare`, `class_test_question:delete`, `class_test_script:view`, `class_test_script:scan`, `class_test_script:publish`, `class_test_script:hand_back`, `printing:view_all`, `printing:process`, `archive:view`, `archive:create`, `archive:approve`, `archive:lend`, `archive:void`, `archive:delete`, `archive:settings`, `vocab_test:assign`, `student_comments:review`, `student_comments:send`, `parents_meeting:view`, `parents_meeting:create`, `parents_meeting:send`, `parents_meeting:mark_attendance`, `parents_meeting:assign`, `parents_meeting:review`, `parents_meeting:view_brief`, `improvement_plan:view_all`, `improvement_plan:create`, `improvement_plan:edit`, `improvement_plan:assign`, `improvement_plan:edit_all`, `teaching_notes:upload`, `teaching_notes:review`, `english_drive:upload`, `worksheets:create`, `worksheets:send`, `worksheets:edit_all`, `worksheets:edit`, `worksheets:settings` | The print-queue exceptions on `/pdf/set` and `/pdf/artifact` stay extra gates read through `printing:view_all`. A per-user revoke of roster:manage removes all of these, as today. |
| `staff:manage` | any | `staff_records:view`, `staff_records:create`, `staff_records:edit`, `staff_records:confirm`, `staff_letters:view`, `staff_letters:issue`, `staff_letters:void`, `offboarding:view`, `offboarding:create`, `offboarding:edit`, `offboarding:revoke`, `offboarding:issue`, `offboarding:cancel` | the staffDirectory widening reads `appraisal:observe` ∨ `staff_records:view` |
| `leave:manage` | any | `leave:view_all`, `leave:approve`, `leave:create`, `leave:settings`, `cover:view_all`, `cover:approve` | leaveImprovementTasks keeps any-of(`improvement_plan:view_all`, `leave:view_all`). Do NOT expand to improvement_plan. |
| `payroll:manage` | any | `payroll:view`, `payroll:edit`, `payroll:prepare`, `payroll:export`, `salary_advance:view`, `hr_policy:view`, `hr_policy:settings`, `offboarding:prepare` | |
| `payroll:approve` | any | `payroll:approve`, `salary_advance:issue`, `salary_advance:settle`, `offboarding:settle` | all LOCKED |
| `performance:manage` | any | `appraisal:view_all`, `appraisal:observe`, `appraisal:prepare`, `appraisal:log_cpd`, `conduct:view_all`, `conduct:create`, `conduct:record_hearing`, `grievance:view_all`, `grievance:resolve` | |
| `performance:signoff` | any | `appraisal:sign_off`, `conduct:sign_off` | LOCKED |
| `guardian:link` | any | `guardians:view_all`, `guardians:create`, `guardians:link`, `guardians:reset_password` | |
| `message:dispatch` | any | `set_tracker:remind`, `vocab_test:send` | |
| `message:dispatch` | admin template | `assignment:remind`, `class_test:remind`, `saturday_revision:remind` | today: message:dispatch ∧ isAdminStaff |
| `user:manage` | any | `staff_logins:view`, `staff_logins:create`, `staff_logins:reset_password`, `teaching_assignments:assign_subject_teacher`, `teaching_assignments:assign_supervisor`, `cover:assign_proxy` | ESCALATION rows. Incl. the routine `sectionSubjectRoutineTeachers` read. |
| `user:view_as` | any | `view_as:open` | |
| `audit:read` | any | `audit_log:view`, `audit_log:view_activity`, `system_health:view`, `guardian_engagement:view` | |
| `template:manage` | any | `message_templates:view`, `message_templates:edit` | LOCKED |
| `access:manage` | any | `access_control:edit`, `access_control:delegate` | LOCKED |
| `observation:upload` | any | `classroom_observation:upload`, `classroom_observation:assign`, `free_mixing_review:assign` | |
| `observation:upload` | admin template | `classroom_observation:view_all` | The list queries rode `upload`, and the row bypass rode isAdminStaff. ⚠ A per-user `upload` grant to a teacher today sees the lists without the row bypass (F-21). Do not give it `view_all`. |
| `observation:review` | any | `classroom_observation:review`, `free_mixing_review:review` | |
| `observation:read` | any | `classroom_observation:view` | |
| `observation:manage` | any | `classroom_observation:assign`, `classroom_observation:edit`, `classroom_observation:publish`, `classroom_observation:schedule`, `classroom_observation:settings`, `classroom_observation:view_reports`, `free_mixing_review:view_all` | `view_reports` rating fields were primary-role P/O |
| `finance:manage` | any | `finance_ledger:view`, `finance_ledger:create`, `finance_ledger:reverse`, `finance_ledger:settings`, `finance_ledger:remind`, `finance_reports:view`, `budget:view`, `budget:edit`, `fee_support:view`, `fee_support:edit`, `fee_support:create`, `qard:view`, `qard:create`, `qard:edit`, `reconciliation:view`, `reconciliation:create` | |
| `report:release` | admin template | `monthly_report:view_all`, `monthly_report:create`, `monthly_report:export`, `monthly_report:release` | today: report:release ∧ isAdminStaff. A teacher holding report:release had nothing. |
| `report:release` | any (TEACHER context) | — | |
| `book:read` | any | `book_production:view` | |
| `book:author` | any | `book_production:author` | |
| `book:illustrate` | any | `book_production:illustrate` | |
| `book:review` | any | `book_production:review` | |
| `book:review_senior` | any | `book_production:approve` | |
| `book:assemble` | any | `book_production:assemble` | |
| `book:manage` | any | `book_production:create`, `book_production:settings`, `book_production:assign` | |
| `exam:manage` | any | `exam_syllabus:settings`, `exam_syllabus:edit` | |
| `exam:manage` | admin template | `exam_syllabus:view_all` | today: exam:manage ∧ isAdminStaff |
| `exam:read` | any | `exam_syllabus:view` | never enforced (F-10); everyone authenticated reads today, see table 3 |
| `scholarship:manage` | any | `scholarship_practice:create`, `scholarship_practice:enter_results`, `scholarship_practice:settings` | |
| `scholarship:manage` | admin template (primary role P/O today) | `scholarship_practice:delete`, `scholarship_practice:select_candidates`, `scholarship_practice:edit_all` | today the primary role; template-aware after (2H, F-27) |
| `scholarship:read` | any | `scholarship_practice:view` | |
| `tasks:assign` | any | `work_board:view_all`, `work_board:assign`, `work_board:cover_desk` | |
| `guardian:read_child` | GUARDIAN | `guardian:read_child` | unchanged, not in the editor |

### Aliases (`LEGACY_PERMISSION_ALIASES`, for `myPermissions` until retired)
An old name is returned if the caller holds **any** action in its expansion row (both contexts), with these exceptions:
- `tracker:read` is also returned for any `homework:view` / `assignment:view` / `class_test:view` holder.
- `tracker:write` is returned for any homework, assignment or class-test write action (PRD §6.3).
- `set:export` is returned with `question_sets:export`.
- `tracker:export` is returned with `tracker:read`.
- `roster:manage` is returned only if the caller holds **any** of its actions. Old bundles gate about 40 app surfaces on it (AppTabs, DrawerContent, Today cards). Over-answering shows a screen the server then refuses. Under-answering hides a screen the person can use. Prefer over-answering. The server is the gate.
- The reserved names are returned only to PRINCIPAL.

## 2. Role checks and designations → actions
| today's check (where) | who passed | → action (default) |
|---|---|---|
| `isAdminStaff` read bypass: `assertCanRead` / `allowedSubjectCodesForSection` (authz.ts:96, :131) | P, O template | `homework:view_all`, `assignment:view_all`, `set_tracker:view_all`, `question_sets:view_all` (O on †) |
| `isAdminStaff` homework class-wide numbers (homework.ts:1837/:1900/:1908) | P, O template | `homework:view_all` |
| `isAdminStaff` revert `admin` (homework.ts:1410, assignment.ts:1663) | P, O | `homework:undo_any`, `assignment:undo_any` (O on, F-7) |
| `isAdminStaff` assignment cell bypass (assignment.ts:1218/:1238) | P, O template (two-hat only in practice) | `assignment:edit_all` (O off, 2H) |
| `role === "TEACHER"` self-scope (assignment.ts:2126) | inverse | `assignment:view_all` |
| `isAdminStaff` schedule/board read (assignment.ts:144, assignmentHandout.ts:31) | P, O | any-of `assignment:view` / `assignment:settings` |
| `assertFollowUpAdmin` isAdminStaff (assignment.ts:134) | P, O | `assignment:remind` |
| `assertCanConfirmAssignmentWeek` roster:manage OR class teacher (assignment.ts:178) | P, O, CT | `assignment:confirm_week` + designation class_teacher |
| `assertCanConfirmHomework` P / CT / confirmer / supervisor / delegation (authz.ts:310-335) | P, designated T | `homework:confirm_day` + designation |
| `actsAsRole(P\|O)` hwLifecycleReport.ts:32, reconReport.ts:32 | P, O | `homework:view_reports`, `assignment:view_reports` |
| `actsAsRole(P\|O)` hwWeeklyDigest.ts:33 | P, O | `homework:remind` |
| `isAdminStaff` gift report (assignmentGift.ts:57) | P, O | `assignment_gift:view_all` |
| `assertCanHandOverGift` isAdminStaff OR class teacher (assignmentGift.ts:74-81) | P, O, CT | `assignment_gift:issue` + designation |
| `canWatchClaims` isAdminStaff OR digest list (WorkClaimDigestService.ts:88) | P, O, digest T | `work_claim:view_all`, `work_claim:remind` + designation digest_recipient |
| `role !== "PRINCIPAL"` (workClaim.ts:434) | P | `work_claim:settings` (PRINCIPAL-DEFAULT) |
| `assertCanWrite` / `assertCanWriteAny` PRINCIPAL bypass, OFFICE refusal (authz.ts:202-203, :238-239) | P | `<feature>:edit_all` for homework, assignment, set_tracker, question_sets (PRINCIPAL-DEFAULT). OFFICE needs scope or edit_all. |
| `assertAnchorWrite` PRINCIPAL bypass / OFFICE refusal (classTestAnchor.ts:153-154, :167-168) | P | `class_test:edit_all` |
| `isAdminStaff` anchor read (classTestAnchor.ts:100), assertReportRead / dashboard (classTestSummary.ts:62-93) | P, O | `class_test:view_all` |
| `isAdminStaff` register unscoped (classTest.ts:248-261); `actorCanManage` roster:manage (ClassTestService.ts:469); edit any (ClassTestService.ts:713) | P, O | `class_test:edit_all` (+ `class_test:register`) |
| `assertChaseAdmin` isAdminStaff ∧ dispatch (classTestSummary.ts:88) | P, O | `class_test:remind` |
| `role !== "PRINCIPAL"` (resultEntryTarget.ts:108) | P | `class_test:settings` (PRINCIPAL-DEFAULT) |
| roster:manage → any test's scripts (classTestScripts.ts:294-297) | P, O | `class_test_script:scan` holders act on any test |
| `isAdminStaff` profile bypass (classTestSummary.ts:455, wholePicture.ts:107, studentProfile.ts) | P, O | `student_profile:view_all` (+ `student_profile:view`, `:export` for O) |
| `actsAsRole(P\|O)` assertDashboardAdmin (adminToday.ts:18-25) | P, O | `admin_dashboard:view` |
| `isAdminStaff \|\| tracker:read` archive assertStaffRead (archive.ts:61) | P, O, T | `archive:view` |
| roster:manage desk path in fileScriptBundle (archive.ts:415, ArchiveService.ts:347) | P, O | `archive:approve` holders get any-test + auto-ack |
| `user:view_as` re-read in ImpersonationService (:95) | P (+grant) | `view_as:open` |
| `hasManage` attendance:manage bypass (studentAttendance.ts:69) | P, O | `attendance:view_all` (reports) / `attendance:edit` (marker reads) |
| marker of the day (StudentAttendanceService.ts:162) | designated T | `attendance:mark` + designation |
| class teacher (assertSectionReportAccess, studentAttendance.ts:98) | CT | `attendance:view` + designation |
| assigned marker `role === "TEACHER"` (StudentAttendanceService.ts:195) | target check | the target must hold `attendance:mark` |
| `userIdsByRole` reminders (AttendanceReminderService.ts:88) | O / P recipients | holders of `attendance:view_all` |
| `isAdminStaff` teacher load (teacherClassLoad.ts:19-24) | P, O | `routine:view_all` |
| `isAdminStaff` publishClassNote bypass (routineTriggers.ts:315/:337); routine:manage update/archive (:420/:493/:518) | P, O | `class_note:edit_all` / `class_note:view_all` |
| slot teacher or cover (RoutineTriggerService.ts:112-123) | designated T | `class_note:create` + designation |
| `assertIsLibrarian` library:manage OR TEACHER+assignment (LibrarianService.ts:33-38) | P, O, librarian T | `library:lend` / `:return` / `:remind` + designation librarian; the library:manage branch → `library:edit_all` (waiver) |
| `canWatchClaims` isAdminStaff leg | P, O template | designation waived by `admin_dashboard:view` |
| `assertCanConfirmAssignmentWeek` roster:manage leg | P, O | designation waived by `assignment:settings` |
| librarian target `role === "TEACHER"` (LibrarianService.ts:47) | target check | target holds `library:lend` (default T) |
| chat:manage ANNOUNCEMENT bypass (chat.ts:340/:392) | P, O | `chat:publish` |
| GuardianNoticeService class teacher / chat:manage (:37-46) | CT, P, O | `chat:send_notice` + designation / `chat:send_notice_all` |
| `isAdminStaff` revision reads/writes/config (revision.ts:42; revisionDelivery.ts:35-50; revisionSummary.ts:68-78) | P, O | `saturday_revision:view_all`, `:edit_all`, `:settings`, `:remind`; O also `:view`, `:enter_results`, `:send` |
| group lead (RevisionService.ts:439) | designated T | `saturday_revision:view/enter_results/send` + designation group_lead |
| vocabGate PRINCIPAL bypass, `role !== "TEACHER"` deny (vocabGate.ts:26-60) | P | `vocab_test:edit_all` (PRINCIPAL-DEFAULT); Office no longer role-denied |
| assigned tester or proxy (vocabGate.ts:47-60) | designated T | `vocab_test:create`, `:enter_results` + designation vocab_tester |
| `isAdminStaff` observation canManage (classroomObservation.ts:66-70, observationTrend.ts:33, sessionRecording.ts:32) | P, O | `classroom_observation:view_all` |
| primary role P/O rating fields (classroomObservation.ts:180-192) | P, O | `classroom_observation:view_reports` |
| `role !== "PRINCIPAL"` (reviewQuota.ts:67) | P | `classroom_observation:set_quota` (PRINCIPAL-DEFAULT) |
| assigned observer / observed teacher / assigned video reviewer | designated T | `classroom_observation:review`, `free_mixing_review:review` + designation; respond/rate under `classroom_observation:view` |
| `isAdminStaff` isReviewer / assertReadSection (studentComment.ts:43-54) | P, O | `student_comments:review`, `student_comments:view_all` |
| `repsScope` primary-role (meetingComment.ts:38-41) | P, T, O | `parents_meeting:view_brief` (F-13) |
| roster:manage isAdmin note screen / brief (meetingChain.ts:72, MeetingChainService.ts:565/:1028) | P, O | `parents_meeting:view` / `:view_brief` |
| `assertIsClassTeacher` meeting summary (meetingComment.ts:163); row teacher (MeetingChainService.ts:419) | designated T | `parents_meeting:write_notes` + designation |
| `assertRelease` report:release ∧ isAdminStaff (monthlyReport.ts:71-84) | P, O | `monthly_report:create`, `:export`, `:release`, `:view_all` |
| `assertPrincipal`, primary PRINCIPAL override (monthlyReport.ts:83-91; MonthlyReportService.ts:583) | P | `monthly_report:override`, `:revoke`, `:settings` (PRINCIPAL-DEFAULT) |
| `isTeacher` fee strip (monthlyReport.ts:107; monthlyReportPdf.ts:69) | inverse | fee block shown to `monthly_report:view_all` holders (owner call; 2H) |
| full-view designation (monthlyReport.ts:683-685) | CT / whole-section supervisor | `monthly_report:review` + designation |
| roster:manage `isAdmin` improvement on-behalf (improvement.ts:530/:544) | P, O | `improvement_plan:edit_all` |
| `isAdminStaff` / `role === "TEACHER"` teaching notes (TeachingNoteService.ts:118-121) | P, O / T | `teaching_notes:view_all` / `teaching_notes:view` |
| `isAdminStaff` / `role === "TEACHER"` English drive (EnglishDriveService.ts:108-111) | P, O / T | `english_drive:view_all` / `english_drive:view` |
| GUARDIAN-only refusal on /pdf/english-drive/render (englishDrivePdf.ts:78) | all staff | `english_drive:send` (F-14) |
| `isManager` roster:manage (WorksheetService.ts:76) | P, O | `worksheets:edit_all`, `:settings`, `:edit` |
| `isAdminStaff` publishGate (publishGate.ts:26-28) | P, O | `question_bank:view_all` |
| `isAdminStaff` any review thread (review.ts:328; questionReview.ts:697) | P, O | `plan_review:assign` / `question_review:view_all` |
| `contentScope` primary P/O = all (contentScope.ts:37) | P, O (primary role) | `lesson_plans:view_all` (O on †, 2H), `question_bank:view_all` (F-27) |
| `isPrincipalStaff` syllabus publish / teacher-stage bypass (ExamSyllabusService.ts:78, :562) | P | `exam_syllabus:publish` (PRINCIPAL-DEFAULT) |
| `isAdminStaff` TEACHER_REVIEW send back (ExamSyllabusService.ts:632) | P, O | `exam_syllabus:edit` |
| `isAdminStaff` drafts / board (ExamSyllabusReadService.ts:268-766) | P, O | `exam_syllabus:view_all` |
| routine-derived teacher sign-off (D-#533) | named holder | no action (row fact) |
| scholarship `assertMayManage` P/O, topic save/retire, candidates (ScholarshipService.ts:86, :434, :472, :544) | P, O / P, O, T | `scholarship_practice:edit_all`, `:settings`, `:delete`, `:select_candidates` |
| book `force` `role === "PRINCIPAL"` (supportBookBuild.ts:173) | P | `book_production:override` (PRINCIPAL-DEFAULT) |
| book self-review stamp `callerIsPrincipal` (supportBookReview.ts:222) | P | stays a PRINCIPAL row property (not an action) |
| OfficeCoverService isDesk / isBackup / canPullAtAll (:36-38, :102-106) | P, O template, tasks:assign | `work_board:cover_desk`. The desk-card owners are holders of `printing:process` / `leave:approve`. |
| print/leave notification recipients `actingAsFilter(P,O)` (emitters.ts:1320, :1441); WorkBoardService.ts:957 | P, O | holders of `printing:process` / `leave:approve` |
| `assertPrintAdmin` roster:manage (printRequest.ts:51-59; classTest.ts:56-61) | P, O | `printing:view_all` / `printing:process` |
| tracker:write as "is teacher" for print requests (printRequest.ts:261…791) | P, T | `printing:create` |
| `isManager` staff directory widening (staffDirectory.ts:40-45) | P, O | `appraisal:observe` ∨ `staff_records:view` |
| `role === "GUARDIAN"` refusals (plane walls) | — | stay (ADR-005), not actions |

## 3. Actions that no old permission carried (authenticated-only today)
These defaults come from who passed the resolver body today, not from any old permission:

| action | T | O | today |
|---|---|---|---|
| `student_comments:view` | on | on | authenticated + assertCanRead / isAdminStaff |
| `student_profile:view`, `student_profile:export` | on | on | authenticated + assertStudentProfileRead |
| `monthly_report:view` | on | on | authenticated + assertReportRead |
| `monthly_report:review` | on | on | authenticated + full-view designation |
| `attendance:view` | on | on | authenticated + class teacher / attendance:manage |
| `teaching_notes:view`, `teaching_notes:send` | on | on | authenticated + role scope |
| `english_drive:view`, `english_drive:send` | on | on | authenticated + role scope |
| `exam_syllabus:view` | on | on | authenticated (exam:read unenforced) |
| `homework:undo`, `assignment:undo` | on | — | authenticated + write scope |
| `assignment:confirm_week` | on | — (O via roster:manage) | authenticated + class teacher |
| `saturday_revision:*` | see table 2 | | authenticated + internal gates |
| `class_test:register`, `class_test:edit` | on | on / — | authenticated + body gates |
| SELF actions | on | on | `work_claim:view_own`, `improvement_plan:tick`, `staff_attendance:view_own`, `cover:propose`, `leave:apply`, `appraisal:view_own`, `conduct:view_own`, `grievance:raise`, `payroll:view_own`, `notifications:view`, `work_board:use`, `my_account:view` |

## 4. Delegated actions → actions (`DELEGATED_ACTION_PERMISSIONS`)
A delegation widens **where**. The holder must also hold the action(s) below (PRD §5.3). Each duty maps to the **full** set of actions it covers today (D-#592). Revert (`undo`) passes on **any** of the three duties of a tracker.

| delegated action | requires / widens these actions | covers today |
|---|---|---|
| `declare_homework` | `homework:declare`, `homework:undo` | declare, update, delete own declaration, no-homework / remove, question file (homeworkFiles.ts:37), issueHomeworkItem; revert (any-of) |
| `submit_homework` | `homework:mark_submitted`, `homework:undo` | submit pass, transition → SUBMITTED, markHomeworkRecordsDue; revert (any-of) |
| `check_homework` | `homework:check`, `homework:return`, `homework:undo` | check, one-tap outcome, answer file (homeworkFiles.ts:63), return pass (D-#592); revert (any-of) |
| `declare_assignment` | `assignment:declare`, `assignment:issue`, `assignment:undo` | deliver, update, delete own draft, no-assignment / remove, redeliver (D-#592); revert (any-of) |
| `submit_assignment` | `assignment:mark_submitted`, `assignment:undo` | submit pass, transition → SUBMITTED; revert (any-of) |
| `check_assignment` | `assignment:check`, `assignment:resubmit`, `assignment:return`, `assignment:declare` (RECORD_HALF only), `assignment:undo` | check, outcome, resubmission, return pass, updateAssignmentItem on a split-half record section (assertCanWriteOnItem); revert (any-of) |
| `enter_classtest_result` | `class_test:enter_results` | enter result, submit, recall (assertWriteTest) |
| `confirm_homework_day` | `homework:confirm_day` | confirm the day, trim (কমানো), the confirm half of assertCanViewHomeworkDay (day tally, issue roster, trim candidates) |

**Behaviour the PRD requires (J-PM7).** If a role or person loses one of a duty's required actions, the delegated-duties editor greys that duty out and shows the reason. The duty also stops working on the action it lost. Example: `check_homework` without `homework:return` still checks, but the return pass refuses. That is new: today the duty covers both.
