# Observation, comments & reports — build checklist

Features: `classroom_observation`, `free_mixing_review`, `student_comments`, `parents_meeting`, `monthly_report`, `improvement_plan`, `teaching_notes`, `english_drive`, `worksheets` (owner rows: see README). Source: inventory E, origin/dev 2026-10-20.
Counts: 70 mutations, 76 queries, 7 REST/SSE.

## (a) Mutations

### `server/src/modules/classroom-observation/resolvers/classroomObservation.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| classroomObservation.ts:290 | uploadClassroomObservation | observation:upload; observer ≠ observed (svc) | `classroom_observation:upload`; with `observerId` also in-resolver `assertHasPermission(classroom_observation:assign)`; observer ≠ observed (stays) |
| classroomObservation.ts:328 | assignClassroomObserver | observation:upload; state UPLOADED/ASSIGNED; observer ≠ observed (svc :415/:425) | `classroom_observation:assign`; state + observer ≠ observed (stays) |
| classroomObservation.ts:346 | reviewClassroomObservation | observation:review; assigned observer (ClassroomObservationService.ts:584) | `classroom_observation:review` + designation assigned observer (stays) |
| classroomObservation.ts:398 | editClassroomObservationReview | observation:manage; not published/cancelled (svc) | `classroom_observation:edit`; not published/cancelled (stays) |
| classroomObservation.ts:444 | rejectClassroomObservation | observation:review; assigned observer + ASSIGNED (svc :952) | `classroom_observation:review` + designation assigned observer (stays); ASSIGNED (stays) |
| classroomObservation.ts:469 | reRequestClassroomObservation | observation:upload; REVIEWED only; observer ≠ observed (svc :1142) | `classroom_observation:assign`; REVIEWED + observer ≠ observed (stays) |
| classroomObservation.ts:492 | requestCoReviewObservation | observation:upload; source has recording; observer ≠ observed (svc :1222) | `classroom_observation:assign`; recording + observer ≠ observed (stays) |
| classroomObservation.ts:516 | respondToClassroomObservation | observation:read; observed teacher (svc :1061) | `classroom_observation:view` + designation observed teacher (stays) |
| classroomObservation.ts:539 | publishClassroomObservation | observation:manage; REVIEWED, unpublished (svc) | `classroom_observation:publish`; state (stays) |
| classroomObservation.ts:555 | withholdClassroomObservation | observation:manage; REVIEWED, unpublished, not withheld | `classroom_observation:publish`; state (stays) |
| classroomObservation.ts:579 | releaseClassroomObservationHold | observation:manage | `classroom_observation:publish` |
| classroomObservation.ts:594 | cancelClassroomObservation | observation:manage; UPLOADED/ASSIGNED only | `classroom_observation:assign`; state (stays) |
| classroomObservation.ts:620 | restoreCancelledClassroomObservation | observation:manage | `classroom_observation:assign` |
| classroomObservation.ts:663 | setObservationEscalationConfig | observation:manage | `classroom_observation:settings` |

### `server/src/modules/classroom-observation/resolvers/` (other files)
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/classroom-observation/resolvers/observationEffectiveness.ts:81 | rateObservationReview | observation:read; observed teacher + released (ClassroomObservationEffectivenessService.ts:80) | `classroom_observation:view` + designation observed teacher (stays); released (stays) |
| server/src/modules/classroom-observation/resolvers/observationRota.ts:157 | generateObservationRota | observation:manage | `classroom_observation:schedule` |
| server/src/modules/classroom-observation/resolvers/observationRota.ts:196 | saveObservationRota | observation:manage | `classroom_observation:schedule` |
| server/src/modules/classroom-observation/resolvers/observationSchedule.ts:109 | setObservationScheduleConfig | observation:manage | `classroom_observation:settings` |
| server/src/modules/classroom-observation/resolvers/reviewQuota.ts:54 | setReviewQuota | authenticated; `ctx.auth.role !== "PRINCIPAL"` → Forbidden (:67) | `classroom_observation:set_quota` (PRINCIPAL-DEFAULT) |
| server/src/modules/classroom-observation/resolvers/sessionRecording.ts:68 | recordSessionFootage | observation:upload (actorRole for audit only) | `classroom_observation:upload` |
| server/src/modules/classroom-observation/resolvers/videoReview.ts:72 | createVideoReview | observation:upload | `free_mixing_review:assign` |
| server/src/modules/classroom-observation/resolvers/videoReview.ts:111 | reviewVideo | observation:review; assigned teacher (VideoReviewService.ts:148) | `free_mixing_review:review` + designation assigned reviewer (stays) |

### `server/src/modules/comments/resolvers/`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| studentComment.ts:87 | recordStudentComment | tracker:write; section resolved server-side, no section scope (D-#263) | `student_comments:create`; no section scope (stays, D-#263) |
| studentComment.ts:122 | editStudentComment | authenticated; author-only unless `isAdminStaff` (`isReviewer` :43; StudentCommentService.ts:192); undelivered | hasAnyPermission(`student_comments:create`, `student_comments:review`); own → `create` + author rule (stays); any → in-resolver `assertHasPermission(student_comments:review)`; undelivered (stays) |
| studentComment.ts:152 | removeCommentAttachment | authenticated; same as edit | hasAnyPermission(`student_comments:create`, `student_comments:review`); own → `create` + author rule (stays); any → `student_comments:review`; undelivered (stays) |
| studentComment.ts:175 | discardStudentComment | roster:manage; undelivered | `student_comments:review`; undelivered (stays) |
| commentDelivery.ts:39 | deliverStudentComment | roster:manage; comment exists | `student_comments:send` |
| meetingChain.ts:448 | openMeetingComments | roster:manage | `parents_meeting:assign` |
| meetingChain.ts:464 | refreshMeetingCommentRoster | roster:manage | `parents_meeting:assign` |
| meetingChain.ts:474 | setMeetingSubjectSkipped | roster:manage | `parents_meeting:assign` |
| meetingChain.ts:489 | remindMeetingTeacher | roster:manage; once per day | `parents_meeting:assign`; once per day (stays) |
| meetingChain.ts:519 | saveMeetingFinalComment | roster:manage | `parents_meeting:review` |
| meetingChain.ts:542 | saveMeetingSubjectNote | tracker:write; row's teacher (MeetingChainService.ts:419); frozen after summary | `parents_meeting:write_notes` + designation row teacher (stays); frozen after summary (stays) |
| meetingComment.ts:145 | saveMeetingComment | tracker:write; `assertIsClassTeacher` (:163); `assertSummaryWritable` | `parents_meeting:write_notes` + designation class_teacher (stays); `assertSummaryWritable` (stays) |
| meetingDispatch.ts:100 | dispatchMeetingSchedule | roster:manage | `parents_meeting:send` |
| meetingDispatch.ts:116 | setMeetingSlotAttendance | roster:manage; meeting dispatched | `parents_meeting:mark_attendance`; dispatched (stays) |
| parentMeeting.ts:117 | createParentMeeting | roster:manage | `parents_meeting:create` |
| parentMeeting.ts:149 | generateMeetingSlots | roster:manage; draft meeting | `parents_meeting:create`; draft (stays) |
| parentMeeting.ts:165 | setMeetingSlotOnCall | roster:manage | `parents_meeting:create` |
| parentMeeting.ts:183 | reorderMeetingSlots | roster:manage; draft meeting | `parents_meeting:create`; draft (stays) |
| parentMeeting.ts:211 | setMeetingBreaks | roster:manage; draft meeting | `parents_meeting:create`; draft (stays) |

### `server/src/modules/reports/resolvers/monthlyReport.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| monthlyReport.ts:556 | buildMonthlyReports | authenticated; `assertRelease` = report:release ∧ isAdminStaff (:71-84) | `monthly_report:create` (role conjunction dropped) |
| monthlyReport.ts:573 | draftMonthlyReportComment | authenticated; `assertRelease` + `assertStaffReportRead` | `monthly_report:create` + `assertStaffReportRead` (stays) |
| monthlyReport.ts:602 | draftMonthlyReportComments | authenticated; `assertRelease` + per-id read gate | `monthly_report:create` + per-id read gate (stays) |
| monthlyReport.ts:638 | importMonthlyComments | authenticated; `assertRelease` + per-row read gate | `monthly_report:export` + per-row read gate (stays) |
| monthlyReport.ts:668 | reviewMonthlyReportComment | authenticated; `assertStaffReportRead` + full view (`subjects === null`) (:683-685) | `monthly_report:review` + designation class_teacher / whole_section_supervisor via full view (stays) |
| monthlyReport.ts:692 | releaseMonthlyReport | authenticated; `assertRelease`; `overrideReason` honoured only for primary role PRINCIPAL (MonthlyReportService.ts:583) | `monthly_report:release`; `overrideReason` → in-resolver `assertHasPermission(monthly_report:override)` (PRINCIPAL-DEFAULT) |
| monthlyReport.ts:712 | bulkReleaseMonthlyReports | authenticated; same as release | `monthly_report:release`; `overrideReason` → `monthly_report:override` (PRINCIPAL-DEFAULT) |
| monthlyReport.ts:733 | revokeMonthlyReport | authenticated; `assertPrincipal` (primary role, :87) | `monthly_report:revoke` (PRINCIPAL-DEFAULT) |
| monthlyReport.ts:750 | revokeMonthlyReleaseBatch | authenticated; `assertPrincipal` | `monthly_report:revoke` (PRINCIPAL-DEFAULT) |
| monthlyReport.ts:766 | setMonthlyReportConfig | authenticated; `assertPrincipal` | `monthly_report:settings` (PRINCIPAL-DEFAULT) |

### `server/src/modules/improvement/resolvers/improvement.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| improvement.ts:459 | createImprovementAction | roster:manage (role passed for audit) | `improvement_plan:create` |
| improvement.ts:488 | stopImprovementAction | roster:manage | `improvement_plan:edit` |
| improvement.ts:497 | extendImprovementAction | roster:manage | `improvement_plan:edit` |
| improvement.ts:506 | setImprovementDayAssignee | roster:manage | `improvement_plan:assign` |
| improvement.ts:515 | tickImprovementTask | hasAnyPermission[tracker:write, roster:manage]; svc: responsible today (self/cover) OR `isAdmin` = roster:manage (on behalf, past day, reason) | hasAnyPermission(`improvement_plan:tick`, `improvement_plan:edit_all`); own/cover today → `improvement_plan:tick` (SELF + responsible-today designation, stays); on behalf → in-resolver `assertHasPermission(improvement_plan:edit_all)` + reason (stays) |
| improvement.ts:537 | untickImprovementTask | hasAnyPermission[tracker:write, roster:manage]; non-admin: own tick + today only (ImprovementActionService.ts:506-507) | hasAnyPermission(`improvement_plan:tick`, `improvement_plan:edit_all`); own tick today → `tick` (stays); others' → `improvement_plan:edit_all` |
| improvement.ts:549 | tickChildImprovementTask | guardian:read_child; assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| improvement.ts:571 | untickChildImprovementTask | guardian:read_child; assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |

### `server/src/modules/teaching-notes/`, `english-drive/`, `worksheets/` resolvers
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/teaching-notes/resolvers/teachingNotes.ts:140 | sendTeachingNoteToPrint | authenticated; read gate (isAdminStaff all; role TEACHER → taught pairs; else deny); neededByKey required | `teaching_notes:send` + read gate `teaching_notes:view` (+ `teaching_notes:view_all` lifts scope); neededByKey (stays) |
| server/src/modules/teaching-notes/resolvers/teachingNotes.ts:169 | uploadTeachingNote | roster:manage | `teaching_notes:upload` |
| server/src/modules/teaching-notes/resolvers/teachingNoteComments.ts:77 | addTeachingNoteComment | authenticated; read gate | `teaching_notes:view` (+ `view_all` lifts scope) |
| server/src/modules/teaching-notes/resolvers/teachingNoteComments.ts:98 | setTeachingNoteCommentStatus | authenticated; roster:manage OR note uploader (TeachingNoteCommentService.ts:346-354) | `teaching_notes:view` outer; `teaching_notes:review` OR designation note uploader (stays) |
| server/src/modules/teaching-notes/resolvers/teachingNoteComments.ts:119 | addressTeachingNoteComments | authenticated; same, per comment | `teaching_notes:view` outer; per comment `teaching_notes:review` OR designation note uploader (stays) |
| server/src/modules/teaching-notes/resolvers/teachingNoteComments.ts:138 | deleteTeachingNoteComment | authenticated; author OR roster:manage (svc :430) | `teaching_notes:view` outer; own → SELF author rule (stays); any → `teaching_notes:review` |
| server/src/modules/english-drive/resolvers/englishDrive.ts:106 | sendEnglishDriveDocToPrint | authenticated; read gate (isAdminStaff all; role TEACHER → English classes) | `english_drive:send` + read gate `english_drive:view` (+ `english_drive:view_all` lifts scope) |
| server/src/modules/english-drive/resolvers/englishDrive.ts:142 | uploadEnglishDriveDoc | roster:manage | `english_drive:upload` |
| server/src/modules/worksheets/resolvers/worksheet.ts:311 | saveWorksheetPlan | roster:manage; svc `isManager` (:208) | `worksheets:settings` |
| server/src/modules/worksheets/resolvers/worksheet.ts:327 | sendWorksheetToPrint | hasAnyPermission[tracker:write, roster:manage]; `forTeacherId` needs roster:manage (svc :477) | `worksheets:send`; `forTeacherId` → in-resolver `assertHasPermission(worksheets:edit_all)` |
| server/src/modules/worksheets/resolvers/worksheet.ts:349 | updateWorksheetPicture | roster:manage | `worksheets:edit` |

## (b) Queries

### `server/src/modules/classroom-observation/resolvers/`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| classroomObservation.ts:653 | observationEscalationConfig | observation:manage | `classroom_observation:settings` |
| classroomObservation.ts:693 | classroomObservation | observation:read; `canReadObservation`: isAdminStaff all / observer own / observed after publish (svc :1290) | `classroom_observation:view` (+ `classroom_observation:view_all` lifts scope); observer own / observed after publish (stays) |
| classroomObservation.ts:715 | teacherClassroomObservations | observation:read; per-row `canReadObservation` | `classroom_observation:view` (+ `view_all` lifts scope); per-row rule (stays) |
| classroomObservation.ts:731 | observationPriorFocusContext | observation:read; `canReadPriorContext`: isAdminStaff or assigned observer (svc :1446) | hasAnyPermission(`classroom_observation:review`, `classroom_observation:view_all`); `review` → designation assigned observer (stays) |
| classroomObservation.ts:756 | myObservationReviewQueue | observation:review; self | `classroom_observation:review` (own rows) |
| classroomObservation.ts:781 | observationCounts | observation:read; toReview needs observation:review; toPublish needs observation:upload | `classroom_observation:view`; `toReview` → `classroom_observation:review`; `toPublish` → `classroom_observation:publish` (F-21) |
| classroomObservation.ts:797 | allClassroomObservations | observation:upload | `classroom_observation:view_all` (F-21) |
| classroomObservation.ts:843 | myObservationReviews | observation:review; observerId forced to caller | `classroom_observation:review`; observerId = caller (stays) |
| classroomObservation.ts:888 | classroomObservationsForRecording | observation:upload | `classroom_observation:view_all` |
| server/src/modules/classroom-observation/resolvers/observationEffectiveness.ts:109 | reviewerEffectiveness | observation:manage | `classroom_observation:view_reports` |
| server/src/modules/classroom-observation/resolvers/observationRota.ts:231 | observationRotas | observation:manage | `classroom_observation:schedule` |
| server/src/modules/classroom-observation/resolvers/observationRota.ts:243 | observationRota | observation:manage | `classroom_observation:schedule` |
| server/src/modules/classroom-observation/resolvers/observationSchedule.ts:83 | observationDueList | observation:manage | `classroom_observation:schedule` |
| server/src/modules/classroom-observation/resolvers/observationSchedule.ts:94 | observationScheduleConfig | observation:manage | `classroom_observation:settings` |
| server/src/modules/classroom-observation/resolvers/observationTrend.ts:114 | teacherObservationTrend | observation:read; self unless isAdminStaff (:128) | `classroom_observation:view` (self) (+ `classroom_observation:view_all` lifts to any teacher) |
| server/src/modules/classroom-observation/resolvers/observationTrend.ts:135 | schoolObservationPatterns | observation:manage | `classroom_observation:view_reports` |
| server/src/modules/classroom-observation/resolvers/reviewQuota.ts:44 | myReviewQuota | authenticated; self | SELF (see (e)) |
| server/src/modules/classroom-observation/resolvers/sessionRecording.ts:96 | observationRecording | observation:read; `canReadObservation` | `classroom_observation:view` (+ `view_all` lifts scope); `canReadObservation` row rule (stays) |
| server/src/modules/classroom-observation/resolvers/videoReview.ts:98 | myVideoReviews | observation:review; self | `free_mixing_review:review` (own rows) |
| server/src/modules/classroom-observation/resolvers/videoReview.ts:136 | videoReviewOverview | observation:manage | `free_mixing_review:view_all` |
| server/src/modules/classroom-observation/resolvers/videoReview.ts:150 | videoReviewRowsPage | observation:manage | `free_mixing_review:view_all` |

### `server/src/modules/comments/resolvers/`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| studentComment.ts:199 | sectionStudentComments | authenticated; `assertReadSection`: isAdminStaff unscoped, else `assertCanRead` (guardian denied) | `student_comments:view` (+ `student_comments:view_all` lifts scope); `assertCanRead` (stays) |
| studentComment.ts:215 | sectionStudentCommentsPage | authenticated; same | `student_comments:view` (+ `view_all` lifts scope); `assertCanRead` (stays) |
| studentComment.ts:232 | studentComments | authenticated; same (section from student) | `student_comments:view` (+ `view_all` lifts scope); `assertCanRead` (stays) |
| studentComment.ts:274 | myStudentComments | authenticated; own authored | `student_comments:create` (own rows) |
| studentComment.ts:293 | myStudentCommentsPage | authenticated; self | `student_comments:create` (own rows) |
| studentComment.ts:330 | commentReviewInbox | roster:manage | `student_comments:review` |
| studentComment.ts:347 | commentReviewInboxPage | roster:manage | `student_comments:review` |
| studentComment.ts:363 | commentReviewCount | roster:manage | `student_comments:review` |
| meetingChain.ts:499 | meetingCommentProgress | roster:manage | `parents_meeting:view` |
| meetingChain.ts:509 | meetingFinalQueue | roster:manage | `parents_meeting:review` |
| meetingChain.ts:559 | myMeetingNoteWork | tracker:write; self | `parents_meeting:write_notes` (own rows) |
| meetingChain.ts:568 | myMeetingSummaryWork | tracker:write; sections I am শ্রেণি শিক্ষক of | `parents_meeting:write_notes` + designation class_teacher (stays) |
| meetingChain.ts:577 | meetingSubjectNoteContext | authenticated; row's teacher OR roster:manage (MeetingChainService.ts:565) | hasAnyPermission(`parents_meeting:write_notes`, `parents_meeting:view`); own row → `write_notes` + designation row teacher (stays); any row → `parents_meeting:view` |
| meetingChain.ts:591 | meetingBrief | authenticated; roster:manage OR শ্রেণি শিক্ষক of the child's শাখা (`assertBriefRead`, svc :1027-1033) | `parents_meeting:view_brief` + designation class_teacher of the child's শাখা (stays); `parents_meeting:view` lifts the designation (replaces roster:manage) |
| meetingComment.ts:181 | studentCommentTimeline | `repsScope` (primary-role tracker:read ∨ roster:manage); no row scope | `parents_meeting:view_brief` + add a row scope (F-13) |
| meetingComment.ts:193 | meetingComparison | `repsScope`; no row scope | `parents_meeting:view_brief` + add a row scope (F-13) |
| meetingComment.ts:212 | childComments | guardian:read_child; assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| meetingComment.ts:228 | childMeetingSlot | guardian:read_child; assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| meetingDispatch.ts:139 | meetingAttendanceSummary | roster:manage | `parents_meeting:view` |
| parentMeeting.ts:233 | parentMeetings | roster:manage | `parents_meeting:view` |
| parentMeeting.ts:243 | parentMeeting | roster:manage | `parents_meeting:view` |
| parentMeeting.ts:253 | parentMeetingSlots | roster:manage | `parents_meeting:view` |

### `server/src/modules/reports/resolvers/monthlyReport.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| monthlyReport.ts:298 | monthlyReportsForSection | authenticated; `assertReportRead` (isAdminStaff unscoped; else tracker:read + section scope) + SP-1 narrowing; fees hidden when primary role TEACHER (:107) | `monthly_report:view` (+ `monthly_report:view_all` lifts scope); section scope + SP-1 narrowing (stays); fee block shown when caller holds `monthly_report:view_all` (owner call); `requiresPrincipal` → `monthly_report:override` |
| monthlyReport.ts:344 | monthlyReport | authenticated; `assertStaffReportRead` | `monthly_report:view` (+ `view_all` lifts scope); fee block / `requiresPrincipal` as above |
| monthlyReport.ts:378 | monthlyClassRollups | authenticated; `assertRelease` | `monthly_report:view_all` |
| monthlyReport.ts:464 | monthlyPendingWork | authenticated; `assertRelease` | `monthly_report:view_all` |
| monthlyReport.ts:500 | monthlyTeacherChase | authenticated; `assertRelease` | `monthly_report:view_all` |
| monthlyReport.ts:513 | monthlyReportConfig | authenticated; `assertRelease` | anyOf(`monthly_report:settings`, `monthly_report:view_all`) |
| monthlyReport.ts:524 | childMonthlyReports | authenticated; assertGuardianOfStudent; RELEASED only | GUARDIAN (guardian:read_child + assertGuardianOfStudent; RELEASED only, stays) |

### `server/src/modules/improvement/resolvers/improvement.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| improvement.ts:322 | progressSchoolOverview | roster:manage | `improvement_plan:view_all` |
| improvement.ts:332 | progressSectionBoard | roster:manage | `improvement_plan:view_all` |
| improvement.ts:341 | progressStudent | roster:manage | `improvement_plan:view_all` |
| improvement.ts:357 | improvementSuggest | roster:manage | `improvement_plan:create` |
| improvement.ts:370 | improvementActions | roster:manage | `improvement_plan:view_all` |
| improvement.ts:379 | improvementAction | roster:manage | `improvement_plan:view_all` |
| improvement.ts:394 | myImprovementTasks | hasAnyPermission[tracker:write, roster:manage]; own + cover | `improvement_plan:tick` (SELF + responsible-today designation, stays) |
| improvement.ts:403 | improvementDayTasks | roster:manage | `improvement_plan:view_all` |
| improvement.ts:412 | childImprovementTasks | guardian:read_child; assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| improvement.ts:425 | childImprovementStreak | guardian:read_child; assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| improvement.ts:437 | leaveImprovementTasks | hasAnyPermission[roster:manage, leave:manage, tracker:write]; without roster/leave:manage → must be the applicant (:445-449) | anyOf(`improvement_plan:view_all`, `leave:view_all`); without either → applicant self-check (`leave:apply` SELF) (stays) |

### `server/src/modules/teaching-notes/`, `english-drive/`, `worksheets/` resolvers
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/teaching-notes/resolvers/teachingNotes.ts:77 | teachingNotes | authenticated; isAdminStaff all; role TEACHER → taught pairs; else deny (TeachingNoteService.ts:118-121) | `teaching_notes:view` (+ `teaching_notes:view_all` lifts scope); taught-pair scope (stays) |
| server/src/modules/teaching-notes/resolvers/teachingNotes.ts:98 | teachingNote | authenticated; same | `teaching_notes:view` (+ `view_all` lifts scope) |
| server/src/modules/teaching-notes/resolvers/teachingNotes.ts:108 | teachingNoteVersions | authenticated; same | `teaching_notes:view` (+ `view_all` lifts scope) |
| server/src/modules/teaching-notes/resolvers/teachingNotes.ts:120 | teachingNoteMyScope | authenticated; guardian → [] (svc :234) | `teaching_notes:view` |
| server/src/modules/teaching-notes/resolvers/teachingNoteComments.ts:54 | teachingNoteComments | authenticated; note read gate | `teaching_notes:view` (+ `view_all` lifts scope) |
| server/src/modules/teaching-notes/resolvers/teachingNoteComments.ts:66 | openTeachingNoteComments | roster:manage; svc re-check (:188) | `teaching_notes:review` |
| server/src/modules/english-drive/resolvers/englishDrive.ts:64 | englishDriveDocs | authenticated; isAdminStaff all; role TEACHER → English classes (EnglishDriveService.ts:108-111) | `english_drive:view` (+ `english_drive:view_all` lifts scope); English-class scope (stays) |
| server/src/modules/english-drive/resolvers/englishDrive.ts:76 | englishDriveDoc | authenticated; same | `english_drive:view` (+ `view_all` lifts scope) |
| server/src/modules/english-drive/resolvers/englishDrive.ts:86 | englishDriveMyClassLevels | authenticated; guardian → [] (svc :155) | `english_drive:view` |
| server/src/modules/worksheets/resolvers/worksheet.ts:219 | worksheetPlan | hasAnyPermission[tracker:write, roster:manage] | `worksheets:create` |
| server/src/modules/worksheets/resolvers/worksheet.ts:246 | worksheetPreview | same | `worksheets:create` |
| server/src/modules/worksheets/resolvers/worksheet.ts:257 | myWorksheets | same; self | `worksheets:create` (own rows) |
| server/src/modules/worksheets/resolvers/worksheet.ts:270 | myWorksheetsPage | same; self | `worksheets:create` (own rows) |
| server/src/modules/worksheets/resolvers/worksheet.ts:280 | worksheetTeachers | same; svc returns [] unless roster:manage | `worksheets:edit_all` |
| server/src/modules/worksheets/resolvers/worksheet.ts:290 | worksheetPictures | same; `includeHidden` not gated | `worksheets:create`; `includeHidden` → in-resolver `assertHasPermission(worksheets:edit)` (F-15) |

## (c) REST routes / SSE topics
| file:line | route / topic | today's gate | → new gate |
|---|---|---|---|
| server/src/modules/comments/routes/meetingBriefPdf.ts:28 | GET /pdf/meeting-brief/:meetingId | authenticated; `assertBriefRead` with isAdmin = callerHasPermission(roster:manage) (:43) | `parents_meeting:view_brief` + designation class_teacher (stays); `parents_meeting:view` lifts the designation |
| server/src/modules/reports/routes/monthlyReportPdf.ts:34 | GET /pdf/monthly-report/:reportId | role GUARDIAN → link + RELEASED; staff → `assertReportRead`; fees hidden for role TEACHER (:69) | staff: `monthly_report:view` (+ `monthly_report:view_all` lifts scope); fee block shown with `monthly_report:view_all` (owner call); guardian branch → see (e) |
| server/src/modules/reports/routes/monthlyCommentExport.ts:96 | GET /export/monthly-comments | report:release ∧ PRIMARY role P/O (:103) + per-section read | `monthly_report:export` + per-section read (stays) (F-22) |
| server/src/modules/english-drive/routes/englishDrivePdf.ts:37 | GET /pdf/english-drive/:id | authenticated + service read gate | `english_drive:view` (+ `english_drive:view_all` lifts scope) |
| server/src/modules/english-drive/routes/englishDrivePdf.ts:76 | POST /pdf/english-drive/render | only `role === "GUARDIAN"` refused | `english_drive:send` + read gate `english_drive:view` (+ `view_all`) (F-14) |
| server/src/modules/worksheets/routes/worksheetPdf.ts:83 | POST /pdf/worksheet/preview | authenticated + `assertCanGenerate` | `worksheets:create` |
| server/src/modules/worksheets/routes/worksheetPdf.ts:105 | GET /pdf/worksheet/:id | authenticated; own OR roster:manage (WorksheetService.ts:599-600) | own → `worksheets:create`; others' → `worksheets:edit_all` |

## (d) Hidden role / designation gates
| file:line | today | → replacement |
|---|---|---|
| server/src/modules/classroom-observation/resolvers/classroomObservation.ts:66-70 (`actorOf`); server/src/modules/classroom-observation/services/ClassroomObservationService.ts:1295, :1447 | `canManage = isAdminStaff` (role/template) → every row, any prior focus | `classroom_observation:view_all` |
| server/src/modules/classroom-observation/resolvers/classroomObservation.ts:180-192 | fairnessRating / usefulnessRating returned only when PRIMARY `role === PRINCIPAL/OFFICE` | `classroom_observation:view_reports` |
| server/src/modules/classroom-observation/resolvers/observationTrend.ts:33-36, :128 | `isAdminStaff` → any teacher's trend | `classroom_observation:view_all` |
| server/src/modules/classroom-observation/resolvers/sessionRecording.ts:32-35 | `isAdminStaff` actor | `classroom_observation:view_all` |
| server/src/modules/classroom-observation/resolvers/reviewQuota.ts:67 | `role !== "PRINCIPAL"` | `classroom_observation:set_quota` (PRINCIPAL-DEFAULT) |
| server/src/modules/classroom-observation/resolvers/classroomObservation.ts:790-791 | badge `toPublish` keyed on `observation:upload` while publish needs `observation:manage` | `classroom_observation:publish` (F-21) |
| server/src/modules/classroom-observation/services/ClassroomObservationService.ts:584, :952, :1061; server/src/modules/classroom-observation/services/ClassroomObservationEffectivenessService.ts:80; server/src/modules/classroom-observation/services/VideoReviewService.ts:148 | designations: assigned observer / observed teacher / assigned video reviewer | STAY (row gate) |
| server/src/modules/comments/resolvers/studentComment.ts:43-45 (`isReviewer`) | `isAdminStaff` → edit/strip any undelivered comment | `student_comments:review` |
| server/src/modules/comments/resolvers/studentComment.ts:48-54 (`assertReadSection`) | `isAdminStaff` bypass of section scope | `student_comments:view_all` |
| server/src/modules/comments/resolvers/meetingComment.ts:38-41 (`repsScope`) | `roleHasPermission(primary role, …)`; ignores AC-1 grants/revokes/templates | `parents_meeting:view_brief` + add a row scope (F-13) |
| server/src/modules/comments/resolvers/meetingComment.ts:163 | `assertIsClassTeacher` | STAYS (designation class_teacher) |
| server/src/modules/comments/resolvers/meetingChain.ts:72-73; server/src/modules/comments/routes/meetingBriefPdf.ts:43; server/src/modules/comments/services/MeetingChainService.ts:565, :1028 | `isAdmin = roster:manage` → any note screen, any brief | `parents_meeting:view` (any note screen; lifts the brief's class-teacher designation); brief gate `parents_meeting:view_brief`; class_teacher / row-teacher designations STAY |
| server/src/modules/reports/resolvers/monthlyReport.ts:71-84 (`assertRelease`) | `report:release` AND `isAdminStaff`; a teacher granted the permission is still refused | split into `monthly_report:create` / `:view_all` / `:release` / `:export`; role conjunction dropped |
| server/src/modules/reports/resolvers/monthlyReport.ts:83, :87-91 (`assertPrincipal`); server/src/modules/reports/services/MonthlyReportService.ts:583 | PRIMARY role PRINCIPAL | `monthly_report:override`, `:revoke`, `:settings` (PRINCIPAL-DEFAULT) |
| server/src/modules/reports/resolvers/monthlyReport.ts:107; server/src/modules/reports/routes/monthlyReportPdf.ts:69 | `isTeacher = role === "TEACHER"` → fee block stripped | fee block shown when caller holds `monthly_report:view_all` (owner call) |
| server/src/modules/reports/resolvers/monthlyReport.ts:316, :353, :583, :687 | `role === "PRINCIPAL"` → `requiresPrincipal` / releasable shown in view | `monthly_report:override` |
| server/src/modules/reports/routes/monthlyCommentExport.ts:102-103 | PRIMARY role P/O (not template-aware, differs from resolver) | `monthly_report:export` (F-22) |
| server/src/modules/trackers/resolvers/classTestSummary.ts:69 (`assertReportRead`, shared helper) | `isAdminStaff` unscoped | monthly_report use: `monthly_report:view_all`. The helper takes the caller's feature `view_all` as a parameter; the class-test use is in trackers-classtest.md |
| server/src/modules/improvement/resolvers/improvement.ts:530, :544 | `isAdmin = roster:manage` → on-behalf tick, any past day | `improvement_plan:edit_all` |
| server/src/modules/improvement/resolvers/improvement.ts:445-449 | leave applicant self-check | STAYS (SELF) |
| server/src/modules/teaching-notes/services/TeachingNoteService.ts:118-121, :234 | `isAdminStaff` → all; `role !== "TEACHER"` → deny | `teaching_notes:view_all` / `teaching_notes:view` |
| server/src/modules/teaching-notes/services/TeachingNoteCommentService.ts:188, :349, :430 | roster:manage (open list, address, delete any); uploader/author designations | `teaching_notes:review`; uploader/author designations STAY |
| server/src/modules/english-drive/services/EnglishDriveService.ts:108-111, :155 | `isAdminStaff` → all; `role !== "TEACHER"` → deny | `english_drive:view_all` / `english_drive:view` |
| server/src/modules/english-drive/routes/englishDrivePdf.ts:78 | only GUARDIAN refused | `english_drive:send` (F-14) |
| server/src/modules/worksheets/services/WorksheetService.ts:66-73 (`GENERATE_PERMS`), :76 (`isManager`) used at :208, :477, :600 | tracker:write ∨ roster:manage; roster:manage for plan / on-behalf / others' papers | `worksheets:create` / `:send` / `:settings` / `:edit_all` |
| app/src/navigation/AppTabs.tsx:1762 | `canReports = isRole("PRINCIPAL") \|\| isRole("OFFICE")` (whole Reports tab incl. monthly console) | `monthly_report:view_all` (or any monthly_report action) (F-30) |

## (e) Self-service, guardian and public paths (kept as-is)
| path | today | → |
|---|---|---|
| myReviewQuota (server/src/modules/classroom-observation/resolvers/reviewQuota.ts:44) | self read | SELF, no action |
| editStudentComment / removeCommentAttachment (own, undelivered) | author check | `student_comments:create` + author rule (stays) |
| myStudentComments / myStudentCommentsPage | self, no permission today | `student_comments:create` (own rows) |
| sectionStudentComments / sectionStudentCommentsPage / studentComments | `authenticated` + section scope; a staff login with no tracker permission but section scope can read | `student_comments:view` (+ `view_all` lifts scope) |
| meetingSubjectNoteContext / meetingBrief | `authenticated` + designation | `parents_meeting:write_notes` / `parents_meeting:view_brief` (designations stay) |
| monthlyReportsForSection, monthlyReport, all monthly mutations | `authenticated` + inner gates | the `monthly_report` actions in (a)/(b), as declarative `authScopes` |
| teachingNotes / teachingNote / teachingNoteVersions / teachingNoteMyScope / teachingNoteComments / addTeachingNoteComment / sendTeachingNoteToPrint | `authenticated` + role-based scope | `teaching_notes:view` / `teaching_notes:send`; own comment delete stays SELF |
| setTeachingNoteCommentStatus / addressTeachingNoteComments | `authenticated` + uploader-or-roster | `teaching_notes:review`; uploader stays a designation |
| englishDrive* queries + sendEnglishDriveDocToPrint + PDF routes | `authenticated` + role scope | `english_drive:view` / `english_drive:send` |
| respondToClassroomObservation / rateObservationReview | `observation:read` + observed teacher | `classroom_observation:view` + designation observed teacher (stays) |
| tickImprovementTask / untickImprovementTask (own, today) / myImprovementTasks | tracker:write ∨ roster:manage + responsible-today | `improvement_plan:tick` (SELF + responsible-today designation); on-behalf branch → `improvement_plan:edit_all` |
| leaveImprovementTasks (applicant) | applicant self-check | SELF (stays) |
| Guardian plane: childComments, childMeetingSlot, childMonthlyReports, childImprovementTasks, childImprovementStreak, tickChildImprovementTask, untickChildImprovementTask (rows in (a)/(b)) | guardian:read_child (childMonthlyReports: `authenticated`) + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| guardian branch of GET /pdf/monthly-report/:reportId (server/src/modules/reports/routes/monthlyReportPdf.ts:34) | role GUARDIAN → link + RELEASED | GUARDIAN (guardian:read_child + assertGuardianOfStudent; RELEASED only, stays) |

## (f) App gates
| file:line | today | → new |
|---|---|---|
| app/src/navigation/AppTabs.tsx:1648 | MY_VIDEO_REVIEWS paused unless `isRole("TEACHER") && can("observation:review")` | `free_mixing_review:review` |
| app/src/navigation/AppTabs.tsx:1701 | Comments tab: `tracker:read ∨ roster:manage` | any of `student_comments:*` / `parents_meeting:*` |
| app/src/navigation/AppTabs.tsx:1705-1710 | Observation tab: any `observation:*` | any `classroom_observation:*` |
| app/src/navigation/AppTabs.tsx:1713-1715 | Free Mixing tab: `observation:upload` OR teacher with assigned videos | `free_mixing_review:assign` / `:view_all` OR `:review` (+ has rows) |
| app/src/navigation/AppTabs.tsx:1718-1720 | English Drive tab: `roster:manage` OR teacher with classes | `english_drive:view_all` OR `english_drive:view` (+ has classes) |
| app/src/navigation/AppTabs.tsx:1723-1725 | Notes & guides tab: `roster:manage` OR teacher with pairs | `teaching_notes:view_all` OR `teaching_notes:view` (+ has pairs) |
| app/src/navigation/AppTabs.tsx:1762 | Reports tab: `isRole(PRINCIPAL) \|\| isRole(OFFICE)` | `monthly_report:view_all` (monthly console part) (F-30) |
| app/src/navigation/DrawerContent.tsx:96 | Student progress leaf `perms: ["roster:manage"]` | `improvement_plan:view_all` |
| app/src/navigation/DrawerContent.tsx:437 | comment badge `roster:manage` | `student_comments:review` |
| app/src/navigation/DrawerContent.tsx:457 | observation badge `observation:read` | `classroom_observation:view` (server zeroes counts per action) |
| app/src/screens/observation/ObservationHomeScreen.tsx:22 | canUpload → Upload button, All observations | `classroom_observation:upload` / `classroom_observation:view_all` |
| app/src/screens/observation/ObservationHomeScreen.tsx:23 | canReview → review queue, my reviews | `classroom_observation:review` |
| app/src/screens/observation/ObservationHomeScreen.tsx:24 | canRead → my observations, trend | `classroom_observation:view` |
| app/src/screens/observation/ObservationHomeScreen.tsx:25 | canManage → due list, rota, reviewer effectiveness, config | `classroom_observation:schedule` / `:view_reports` / `:settings` (one button each) |
| app/src/screens/observation/ObservationDetailScreen.tsx:72 | canUpload → reassign/re-review/co-review/footage/compare (:123, :265, :531, :569, :642, :671) | `classroom_observation:assign` (footage → `:upload`; compare → `:view_all`) |
| app/src/screens/observation/ObservationDetailScreen.tsx:73 | canManage → cancel/restore (:340), publish/withhold/edit (:388) | `classroom_observation:assign` (cancel/restore) / `:publish` / `:edit` |
| app/src/screens/observation/ObservationDetailScreen.tsx:74 | canReview → review form (:285) | `classroom_observation:review` |
| app/src/screens/observation/ObservationTrendScreen.tsx:23 | canManage → teacher picker + school patterns | `classroom_observation:view_all` / `classroom_observation:view_reports` |
| app/src/screens/freemixing/FreeMixingHomeScreen.tsx:15 | `observation:upload` → admin board vs my list | `free_mixing_review:view_all` |
| app/src/screens/comments/CommentsHomeScreen.tsx:33 | `tracker:read` → daily comments + my comments | `student_comments:view` / `student_comments:create` |
| app/src/screens/comments/CommentsHomeScreen.tsx:34 | `roster:manage` → meetings | `parents_meeting:view` |
| app/src/screens/comments/CommentsHomeScreen.tsx:36 | `roster:manage` → review & deliver | `student_comments:review` |
| app/src/screens/comments/CommentEntryScreen.tsx:57 | `roster:manage` → deliver button (:352) | `student_comments:send` |
| app/src/screens/home/TodayScreen.tsx:552-553; app/src/screens/home/AdminTodayScreen.tsx:218 | improvement teacher card (`tracker:write`) / office card (`roster:manage`) | `improvement_plan:tick` (teacher card, SELF) / `improvement_plan:view_all` |
| app/src/screens/home/TodayScreen.tsx:557-558; app/src/screens/home/AdminTodayScreen.tsx:223-224 | meeting note/summary cards `tracker:write` | `parents_meeting:write_notes` |
| app/src/screens/teachingnotes/TeachingNotesHomeScreen.tsx:35; app/src/screens/teachingnotes/TeachingNoteDocScreen.tsx:52 | `roster:manage` → upload | `teaching_notes:upload` |
| app/src/screens/teachingnotes/TeachingNoteCommentThread.tsx:40 | `roster:manage` → address / delete any | `teaching_notes:review` |
| app/src/screens/englishdrive/EnglishDriveHomeScreen.tsx:31 | `roster:manage` → upload | `english_drive:upload` |
| app/src/screens/printing/PrintHomeScreen.tsx:94-95, :407, :414 | worksheet entry `tracker:write ∨ roster:manage`; bank + plan buttons `roster:manage` | `worksheets:create`; `worksheets:edit` (bank) / `worksheets:settings` (plan) |
| app/src/screens/worksheets/WorksheetGenerateScreen.tsx:141 | `roster:manage` → teacher picker (:274, :325) | `worksheets:edit_all` |
| app/src/screens/worksheets/PictureBankScreen.tsx:29 | `roster:manage` → editable fields | `worksheets:edit` |
| app/src/screens/hr/LeaveCoverScreen.tsx:68 → app/src/components/LeaveImprovementTasks.tsx | `manage` route param (not a permission) shows the assignee picker | `improvement_plan:assign` |
| app/src/screens/reports/MonthlyReportConsoleScreen.tsx:449; app/src/screens/reports/MonthlyReportDetailScreen.tsx:311 | server-sent `requiresPrincipal` (no `can`) | `monthly_report:override` |

## (g) Notification recipients chosen by role
The inventory names no role-routed notification recipients in this area. (remindMeetingTeacher notifies the one named teacher; deliverStudentComment notifies the linked guardian.)

## (h) Build notes
- **View_all becomes grantable.** Observation, student comments, teaching notes, English Drive and the monthly report all pick the scoped vs unscoped branch by `isAdminStaff` / `role === "TEACHER"` today. After the change it is `<feature>:view_all`. For teaching notes and English Drive the scoped branch is `view` with the routine (taught pair / English class) scope, which stays.
- **Monthly fees (owner call).** The fee block is stripped for primary role TEACHER today. The mapping shows it to holders of `monthly_report:view_all`; the owner must confirm a separate `view_fees` is not wanted.
- **Monthly Principal powers.** `override`, `revoke`, `settings` and `classroom_observation:set_quota` are PRINCIPAL-DEFAULT (switchable, default Principal only). The vocab comment says `report:release` edits the MR-2 thresholds; the code says Principal only. The catalogue follows the code. The config read moves to anyOf(`settings`, `view_all`).
- **`assertRelease` conjunction dropped.** Today a teacher granted `report:release` is still refused by the `isAdminStaff` half. After the change the split actions (`create`, `view_all`, `release`, `export`) gate alone.
- **Shared `assertReportRead`** (`server/src/modules/trackers/resolvers/classTestSummary.ts:69`) is used by the monthly report and by class-test reports. Its `isAdminStaff` bypass must become a parameter so each caller passes its own feature's `view_all`.
- **Umbrella migration.** `roster:manage` today covers meetings, comment review/send, improvement, notes/drive upload and worksheets admin. `tracker:write` covers comment authoring, meeting notes, worksheets and improvement ticks. AC-1 per-user grants and revokes of those must map onto the new actions without widening anyone, and D-#554 (Office holds no tracker permission) must still hold.
- **Upload with `observerId`** both uploads and assigns, so it needs `classroom_observation:assign` in-resolver as well.
- **Cancel/restore** were `observation:manage`; they fold into `classroom_observation:assign` (same planner's job). Split into a `cancel` action only if the owner asks.
- **Principal gains review.** In the new model the Principal holds `classroom_observation:review` and `free_mixing_review:review`, which he does not today. The assigned-observer / assigned-reviewer designations still gate the row, so this is harmless.
- **Meeting brief.** `view_brief` is the gate; the class-teacher designation stays; `parents_meeting:view` (Office default) lifts the designation in place of today's roster:manage `isAdmin`. `studentCommentTimeline` / `meetingComparison` need a new row scope (F-13).
- **remindMeetingTeacher** sends a রিমাইন্ডার but stays under `parents_meeting:assign` (the comment-collection desk), as in the README.
- **Worksheets** have no routine scope on class × subject for a teacher today; this is unchanged.
- **Improvement day-assignee picker** is shown today by the `manage` route param on LeaveCoverScreen, not a permission; the app must switch it to `improvement_plan:assign`.
- **No app UI** calls `setReviewQuota`, and teachers have no app path to monthly reports (`reviewMonthlyReportComment` is only used by the P/O console, which sits behind the role-gated Reports tab, F-30).

Listed elsewhere: the class-test use of the shared `assertReportRead` helper (`server/src/modules/trackers/resolvers/classTestSummary.ts:69`) → trackers-classtest.md.
