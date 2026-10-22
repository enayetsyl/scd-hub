# Attendance, routine & library — build checklist

Features: `attendance`, `staff_attendance`, `routine`, `class_note`, `lesson_progress`, `library`, `chat`, `saturday_revision`, `vocab_test`, plus the routine-slot half of `cover` (`cover:assign`; the rest of `cover` lives in hr-finance.md) (owner rows: see README). Source: inventory D, origin/dev 2026-10-20.
Counts: 76 mutations, 108 queries, 4 REST rows (5 routes).

Designation names used below: `marker_of_the_day`, `class_teacher`, `slot_teacher_or_cover`, `librarian`, `group_lead`, `vocab_tester`. Each stays as the row gate under its action (README `DESIGNATION:`).

## (a) Mutations

#### `server/src/modules/attendance/resolvers/push.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| push.ts:21 | registerPushDevice | authenticated + own device; GUARDIAN → guardian-owned device | `notifications:view` (SELF); own-device rule and GUARDIAN plane routing (stays) |
| push.ts:40 | unregisterPushDevice | authenticated + own device | `notifications:view` (SELF); own device (stays) |

#### `server/src/modules/attendance/resolvers/studentAttendance.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| studentAttendance.ts:387 | assignSectionMarker | attendance:manage + target `role === "TEACHER"` (StudentAttendanceService.ts:195) | `attendance:assign`; target must hold `attendance:mark` (replaces the role test) |
| studentAttendance.ts:413 | assignUnitMarker | attendance:manage + same TEACHER-role target check | `attendance:assign`; target must hold `attendance:mark` |
| studentAttendance.ts:441 | revokeSectionMarker | attendance:manage | `attendance:assign` |
| studentAttendance.ts:559 | markSectionAttendance | attendance:mark + assertMayMark (marker of the day), FULL day, end-of-day lock | `attendance:mark` + designation marker_of_the_day (stays); FULL-day rule and end-of-day lock (stays) |
| studentAttendance.ts:577 | markAttendanceUnit | attendance:mark + assertMayMarkUnit (StudentAttendanceService.ts:162) | `attendance:mark` + designation marker_of_the_day (stays) |
| studentAttendance.ts:602 | amendAttendanceUnit | attendance:manage (audited) | `attendance:edit` (audit stays) |
| studentAttendance.ts:625 | amendStudentAttendance | attendance:manage | `attendance:edit` |
| studentAttendance.ts:647 | submitLeaveApplication | attendance:manage | `attendance:record_leave` |

#### `server/src/modules/attendance/resolvers/teacherAttendance.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| teacherAttendance.ts:130 | previewTeacherAttendanceImport | attendance:manage | `staff_attendance:upload` |
| teacherAttendance.ts:144 | commitTeacherAttendanceImport | attendance:manage | `staff_attendance:upload` |

#### `server/src/modules/routine/resolvers/routine.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| routine.ts:306 | createRoom | routine:manage | `routine:settings` |
| routine.ts:324 | setRoomActive | routine:manage | `routine:settings` |
| routine.ts:340 | createSubjectGroup | routine:manage | `routine:settings` |
| routine.ts:381 | setSubjectGroupActive | routine:manage | `routine:settings` |
| routine.ts:415 | addGroupMember | routine:manage | `routine:settings` |
| routine.ts:452 | removeGroupMember | routine:manage | `routine:settings` |
| routine.ts:472 | upsertPeriodGrid | routine:manage | `routine:settings` |
| routine.ts:513 | createScheduleWindow | routine:manage | `routine:edit_calendar` |
| routine.ts:552 | createHolidayException | routine:manage | `routine:edit_calendar` |
| routine.ts:588 | retireHolidayException | routine:manage | `routine:edit_calendar` |

#### `server/src/modules/routine/resolvers/routineSlots.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| routineSlots.ts:279 | reassignRoutineSubjectTeacher | routine:manage + conflict engine; chat resync | `routine:edit`; conflict engine and chat resync (stay) |
| routineSlots.ts:313 | createRoutineSlot | routine:manage | `routine:edit` |
| routineSlots.ts:365 | updateRoutineSlot | routine:manage | `routine:edit` |
| routineSlots.ts:395 | deleteRoutineSlot | routine:manage | `routine:edit` |
| routineSlots.ts:452 | assignCover | routine:manage | `cover:assign` |
| routineSlots.ts:478 | cancelCover | routine:manage | `cover:assign` |

#### `server/src/modules/routine/resolvers/routineTriggers.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| routineTriggers.ts:230 | assignBellDuty | routine:manage | `routine:settings` |
| routineTriggers.ts:289 | publishClassNote | routine:read + slot teacher/cover (RoutineTriggerService.ts:112-123), bypass `isAdminStaff` (:315/:337); homework half tracker:write + assertCanWrite (:283) | hasAnyPermission(`class_note:create`, `class_note:edit_all`); `class_note:create` + designation slot_teacher_or_cover (stays); `class_note:edit_all` lifts the designation; homework half: in-resolver assertHasPermission(`homework:declare`) + assertCanWrite (stays) |
| routineTriggers.ts:500 | updateClassNote | routine:read + own note (publishedBy) unless routine:manage (:518) | hasAnyPermission(`class_note:edit`, `class_note:edit_all`); `class_note:edit` + own note publishedBy (stays); `class_note:edit_all` lifts own-row |
| routineTriggers.ts:527 | deleteClassNote | routine:manage | `class_note:delete` |

#### `server/src/modules/library/resolvers/circulation.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| circulation.ts:266 | issueBook | authenticated + assertIsLibrarian (library:manage OR TEACHER + LibrarianAssignment) | `library:lend` + designation librarian (stays; waived by `library:edit_all`; `role === "TEACHER"` test dropped) |
| circulation.ts:291 | returnBook | authenticated + assertIsLibrarian | `library:return` + designation librarian (stays; waived by `library:edit_all`) |
| circulation.ts:308 | renewLoan | authenticated + assertIsLibrarian | `library:lend` + designation librarian (stays; waived by `library:edit_all`) |
| circulation.ts:325 | markBookLost | authenticated + assertIsLibrarian | `library:return` + designation librarian (stays; waived by `library:edit_all`) |
| circulation.ts:349 | reserveTitle | authenticated; self → library:read + not GUARDIAN (:376); others → assertIsLibrarian | hasAnyPermission(`library:view`, `library:lend`); self branch assertHasPermission(`library:view`); others branch assertHasPermission(`library:lend`) + designation librarian (stays; waived by `library:edit_all`); GUARDIAN deny (stays) |
| circulation.ts:386 | cancelReservation | authenticated; own STAFF row → library:read; else assertIsLibrarian | hasAnyPermission(`library:view`, `library:lend`); own branch `library:view` + own row (stays); others branch `library:lend` + designation librarian (stays; waived by `library:edit_all`) |

#### `server/src/modules/library/resolvers/library.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| library.ts:320 | createBookTitle | library:manage | `library:edit` |
| library.ts:352 | updateBookTitle | library:manage | `library:edit` |
| library.ts:393 | addBookCopy | library:manage | `library:edit` |
| library.ts:408 | setCopyStatus | library:manage | `library:edit` |
| library.ts:430 | upsertLibraryPolicy | library:manage | `library:settings` |
| library.ts:456 | assignLibrarian | library:manage + target `role === "TEACHER"` (LibrarianService.ts:47) | `library:assign`; target must hold `library:lend` (replaces the role test) |
| library.ts:472 | revokeLibrarian | library:manage | `library:assign` |

#### `server/src/modules/chat/resolvers/chat.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| chat.ts:312 | openDirectConversation | chat:write + other party not GUARDIAN/inactive (ChatService.ts:84) | `chat:send`; partner check (stays) |
| chat.ts:321 | sendMessage | chat:write + membership; ANNOUNCEMENT lock unless chat:manage (:340) | `chat:send` + membership (stays); lock bypass → `chat:publish` |
| chat.ts:350 | markSeen | chat:write + membership | `chat:view` + membership (stays) |
| chat.ts:363 | setConversationMuted | chat:read + membership | `chat:view` + membership (stays) |
| chat.ts:378 | forwardMessage | chat:write + membership; ANNOUNCEMENT lock unless chat:manage (:392) | `chat:send` + membership (stays); lock bypass → `chat:publish` |
| chat.ts:401 | editMessage | chat:write + own message (ChatService.ts:395) | `chat:send` + own message (stays) |
| chat.ts:413 | deleteMessage | chat:write + own message (ChatService.ts:432) | `chat:send` + own message (stays) |
| chat.ts:422 | toggleReaction | chat:write + membership | `chat:send` + membership (stays) |
| chat.ts:449 | createGroupConversation | chat:manage | `chat:create` |
| chat.ts:475 | addConversationMember | chat:manage | `chat:edit` |
| chat.ts:490 | removeConversationMember | chat:manage | `chat:edit` |
| chat.ts:505 | archiveConversation | chat:manage | `chat:edit` |
| chat.ts:514 | setPostingPolicy | chat:manage | `chat:edit` |
| chat.ts:530 | resyncChatGroups | chat:manage | `chat:edit` |
| chat.ts:610 | openConversationOversight | chat:oversee (RESERVED), audited | `chat:view_all` (LOCKED); audit (stays) |
| chat.ts:647 | composeGuardianNotice | chat:write; SCHOOL → chat:manage; SECTION → class teacher OR chat:manage (GuardianNoticeService.ts:37-46) | hasAnyPermission(`chat:send_notice`, `chat:send_notice_all`); SECTION branch `chat:send_notice` + designation class_teacher (stays), or `chat:send_notice_all`; SCHOOL branch assertHasPermission(`chat:send_notice_all`) |

#### `server/src/modules/saturday-revision/resolvers/revision.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| revision.ts:213 | recordRevisionEntry | authenticated + assertCanWriteGroup (isAdminStaff OR tracker:write + teacherTeachesGroup) | hasAnyPermission(`saturday_revision:enter_results`, `saturday_revision:edit_all`); `enter_results` + designation group_lead (stays); `saturday_revision:edit_all` lifts the designation |
| revision.ts:244 | editRevisionEntry | authenticated + same | same as recordRevisionEntry |

#### `server/src/modules/saturday-revision/resolvers/revisionDelivery.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| revisionDelivery.ts:96 | deliverRevisionEntry | authenticated + assertCanDeliver (isAdminStaff OR tracker:write + group lead) | hasAnyPermission(`saturday_revision:send`, `saturday_revision:edit_all`); `send` + designation group_lead (stays); `edit_all` lifts the designation |
| revisionDelivery.ts:113 | deliverGroupRevisionSaturday | authenticated + same | same as deliverRevisionEntry |
| revisionDelivery.ts:131 | setRevisionEscalationConfig | authenticated + assertConfigAdmin (isAdminStaff) | `saturday_revision:settings` |

#### `server/src/modules/vocab/resolvers/vocabResult.ts`, `vocabSummary.ts`, `vocabTest.ts`, `vocabWord.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/vocab/resolvers/vocabResult.ts:69 | submitVocabStudentResult | tracker:write + assertCanOperateVocab (PRINCIPAL bypass; TEACHER + assigned tester/proxy; others denied) | `vocab_test:enter_results` + designation vocab_tester (stays); `vocab_test:edit_all` (PRINCIPAL-DEFAULT) lifts it; OFFICE hard-deny replaced (Office passes only with the designation or `edit_all`) |
| server/src/modules/vocab/resolvers/vocabSummary.ts:359 | generateVocabTestMessages | message:dispatch, no scope | `vocab_test:send` (F-12) |
| server/src/modules/vocab/resolvers/vocabSummary.ts:373 | generateVocabCumulativeMessages | message:dispatch, no scope | `vocab_test:send` (F-12) |
| server/src/modules/vocab/resolvers/vocabTest.ts:103 | createVocabTest | tracker:write + assertCanOperateVocab | `vocab_test:create` + designation vocab_tester (stays); `vocab_test:edit_all` lifts it |
| server/src/modules/vocab/resolvers/vocabTest.ts:139 | updateVocabTest | tracker:write + assertCanOperateVocab (old + new week) | `vocab_test:create` + designation vocab_tester on old and new week (stays); `vocab_test:edit_all` lifts it |
| server/src/modules/vocab/resolvers/vocabTest.ts:185 | setVocabTestPositions | tracker:write + assertCanOperateVocab | `vocab_test:create` + designation vocab_tester (stays); `vocab_test:edit_all` lifts it |
| server/src/modules/vocab/resolvers/vocabTest.ts:213 | assignVocabTester | roster:manage | `vocab_test:assign` |
| server/src/modules/vocab/resolvers/vocabWord.ts:53 | addVocabWord | tracker:write + assertCanManageClassLevel (PRINCIPAL bypass; TEACHER teaching/proxy on level) | `vocab_test:edit` + class-level scope (stays); `vocab_test:edit_all` lifts it; OFFICE hard-deny replaced |
| server/src/modules/vocab/resolvers/vocabWord.ts:79 | editVocabWord | tracker:write + same | `vocab_test:edit` + class-level scope (stays); `vocab_test:edit_all` lifts it |
| server/src/modules/vocab/resolvers/vocabWord.ts:105 | setVocabWordActive | tracker:write + same | `vocab_test:edit` + class-level scope (stays); `vocab_test:edit_all` lifts it |

## (b) Queries

#### `server/src/modules/attendance/resolvers/attendanceRanking.ts`, `push.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/attendance/resolvers/attendanceRanking.ts:58 | studentAttendanceRanking | attendance:manage | `attendance:view_all` |
| server/src/modules/attendance/resolvers/attendanceRanking.ts:90 | staffAttendanceRanking | attendance:manage | `staff_attendance:view_all` |
| server/src/modules/attendance/resolvers/attendanceRanking.ts:145 | subjectGroupAttendanceBreakdown | attendance:manage | `attendance:view_all` |
| server/src/modules/attendance/resolvers/push.ts:57 | guardianChaseLink | attendance:manage | `attendance:remind` |

#### `server/src/modules/attendance/resolvers/studentAttendance.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| studentAttendance.ts:676 | myMarkingUnits | attendance:mark + own units (designation-derived) | `attendance:mark` + designation marker_of_the_day (stays) |
| studentAttendance.ts:711 | attendanceUnitRoster | authenticated + assertUnitMarkerOrManage (marker of date OR attendance:manage) | hasAnyPermission(`attendance:mark`, `attendance:edit`); `mark` + designation marker_of_the_day (stays); `attendance:edit` lifts it |
| studentAttendance.ts:750 | attendanceUnitsForDate | attendance:manage | `attendance:edit` |
| studentAttendance.ts:762 | attendanceUnitDay | authenticated + assertUnitMarkerOrManage | hasAnyPermission(`attendance:mark`, `attendance:edit`); `mark` + designation marker_of_the_day (stays); `attendance:edit` lifts it |
| studentAttendance.ts:781 | sectionAttendance | authenticated; manage OR marker of date OR class teacher | hasAnyPermission(`attendance:view`, `attendance:mark`, `attendance:view_all`); `view` + designation class_teacher (stays); `mark` + designation marker_of_the_day (stays); `view_all` lifts scope |
| studentAttendance.ts:807 | sectionMarkerAssignments | attendance:manage | `attendance:assign` |
| studentAttendance.ts:822 | absenteeReport | attendance:manage | `attendance:view_all` |
| studentAttendance.ts:853 | mySectionAttendance | authenticated; not GUARDIAN (:863); own teaching/proxy/class-teacher sections | `attendance:view` + own teaching/proxy/class-teacher sections (stays); GUARDIAN deny (stays) |
| studentAttendance.ts:878 | sectionAbsentees | authenticated + assertSectionReportAccess (manage OR class teacher) | `attendance:view` + designation class_teacher (stays) (+ `attendance:view_all` lifts scope) |
| studentAttendance.ts:902 | studentAttendanceHistory | authenticated; manage OR class teacher of student's section | `attendance:view` + designation class_teacher (stays) (+ `attendance:view_all` lifts scope) |
| studentAttendance.ts:925 | absentNoApplication | authenticated; manage (all) OR class teacher with sectionId | `attendance:view` + designation class_teacher with sectionId (stays) (+ `attendance:view_all` lifts scope, incl. no sectionId) |
| studentAttendance.ts:948 | unmarkedSections | attendance:manage | `attendance:view_all` |
| studentAttendance.ts:960 | leaveApplicationsForSection | authenticated + assertSectionReportAccess | `attendance:view` + designation class_teacher (stays) (+ `attendance:view_all` lifts scope) |

#### `server/src/modules/attendance/resolvers/teacherAttendance.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| teacherAttendance.ts:173 | teacherAttendanceForDate | attendance:manage | `staff_attendance:view_all` |
| teacherAttendance.ts:183 | myStaffAttendance | authenticated + own StaffProfile (phone link) | `staff_attendance:view_own` (SELF); own row (stays) |
| teacherAttendance.ts:206 | teacherAttendanceImports | attendance:manage | `staff_attendance:upload` |
| teacherAttendance.ts:218 | teacherAttendanceImportsPage | attendance:manage | `staff_attendance:upload` |
| teacherAttendance.ts:228 | teacherAttendanceSummary | attendance:manage | `staff_attendance:view_all` |

#### `server/src/modules/routine/resolvers/liveClassBoard.ts`, `myDay.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/routine/resolvers/liveClassBoard.ts:84 | liveClassBoard | routine:manage | `routine:view_all` |
| server/src/modules/routine/resolvers/myDay.ts:167 | myDay | authenticated; per block: routine:read, attendance:mark, role==="TEACHER" (class-teacher list), attendance:manage, tracker:read (MyDayService.ts:110/242/256/275/327) | no gate of its own; blocks: periods `routine:view`, attendancePending `attendance:mark`, class-teacher list designation class_teacher (role test dropped), classPresence `attendance:view_all`, homework block `homework:view` |

#### `server/src/modules/routine/resolvers/routine.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| routine.ts:151 | rooms | routine:read | `routine:view` |
| routine.ts:159 | subjectGroups | routine:read | `routine:view` |
| routine.ts:180 | subjectGroupMembers | routine:read | `routine:view` |
| routine.ts:206 | subjectGroupMemberProfiles | routine:read (student names, school-wide) | `routine:view` (F-20) |
| routine.ts:223 | periodGrids | routine:read | `routine:view` |
| routine.ts:235 | scheduleWindows | routine:read | `routine:view` |
| routine.ts:247 | holidays | routine:read | `routine:view` |
| routine.ts:256 | dayType | routine:read | `routine:view` |
| routine.ts:275 | resolvedDay | routine:read | `routine:view` |

#### `server/src/modules/routine/resolvers/routineSlots.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| routineSlots.ts:123 | routineSlots | routine:read | `routine:view` |
| routineSlots.ts:147 | myRoutineSlots | routine:read + own teacherId | `routine:view` + own teacherId (stays) |
| routineSlots.ts:163 | routineForDate | routine:read | `routine:view` |
| routineSlots.ts:221 | routineMaster | routine:manage | `routine:view_all` |
| routineSlots.ts:233 | routineMasterWeek | routine:manage | `routine:view_all` |
| routineSlots.ts:260 | sectionSubjectRoutineTeachers | user:manage | `teaching_assignments:assign_subject_teacher` |
| routineSlots.ts:418 | teacherAvailability | authenticated; not GUARDIAN (:431) | `routine:view`; GUARDIAN deny (stays) |
| routineSlots.ts:439 | coversForDate | routine:read | `routine:view` |

#### `server/src/modules/routine/resolvers/routineTriggers.ts`, `teacherClassLoad.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/routine/resolvers/routineTriggers.ts:143 | bellSchedule | routine:read | `routine:view` |
| server/src/modules/routine/resolvers/routineTriggers.ts:152 | bellDutyForDate | routine:read | `routine:view` |
| server/src/modules/routine/resolvers/routineTriggers.ts:161 | classNotesForDate | routine:read + assertCanRead + subject filter; own-slot fallback | `class_note:view` + assertCanRead + subject filter (D-#389) + own-slot fallback (stay) |
| server/src/modules/routine/resolvers/routineTriggers.ts:210 | myClassNotePrompts | routine:read + own slots | `class_note:create` + own slots (stays) |
| server/src/modules/routine/resolvers/routineTriggers.ts:219 | classNoteSubmissionReport | routine:manage | `class_note:view_all` |
| server/src/modules/routine/resolvers/routineTriggers.ts:345 | classNotesAdmin | routine:manage | `class_note:view_all` |
| server/src/modules/routine/resolvers/routineTriggers.ts:363 | classNotesAdminPage | routine:manage | `class_note:view_all` |
| server/src/modules/routine/resolvers/routineTriggers.ts:397 | classNotesAdminOptions | routine:manage | `class_note:view_all` |
| server/src/modules/routine/resolvers/routineTriggers.ts:433 | classNotesPage | routine:read; own notes unless routine:manage (:420) | `class_note:view` + own notes (+ `class_note:view_all` lifts scope to school-wide) |
| server/src/modules/routine/resolvers/routineTriggers.ts:487 | classNoteFilterOptions | routine:read; canManage = routine:manage (:493) | `class_note:view` (+ `class_note:view_all` lifts scope); row-button flags from `class_note:edit_all` / `class_note:delete` |
| server/src/modules/routine/resolvers/teacherClassLoad.ts:63 | teacherClassLoad | authenticated; isAdminStaff OR own teacherId (:19-24) | `routine:view` for own teacherId (+ `routine:view_all` lifts scope to all teachers) |

#### `server/src/modules/library/resolvers/chase.ts`, `circulation.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/library/resolvers/chase.ts:30 | libraryChaseList | library:read + assertIsLibrarian | `library:remind` + designation librarian (stays; waived by `library:edit_all`) |
| server/src/modules/library/resolvers/circulation.ts:417 | loans | library:read + assertIsLibrarian | `library:lend` + designation librarian (stays; waived by `library:edit_all`) (F-33) |
| server/src/modules/library/resolvers/circulation.ts:448 | borrowerLoans | library:read + assertIsLibrarian | `library:lend` + designation librarian (stays; waived by `library:edit_all`) |
| server/src/modules/library/resolvers/circulation.ts:470 | myLoans | library:read + own STAFF row | `library:view` + own row (stays) |
| server/src/modules/library/resolvers/circulation.ts:485 | reservationsForTitle | library:read + assertIsLibrarian | `library:lend` + designation librarian (stays; waived by `library:edit_all`) |
| server/src/modules/library/resolvers/circulation.ts:500 | myReservations | library:read + own row | `library:view` + own row (stays) |
| server/src/modules/library/resolvers/circulation.ts:512 | borrowerReservations | library:read + assertIsLibrarian | `library:lend` + designation librarian (stays; waived by `library:edit_all`) |
| server/src/modules/library/resolvers/circulation.ts:549 | libraryBorrowerSearch | library:read + assertIsLibrarian | `library:lend` + designation librarian (stays; waived by `library:edit_all`) |

#### `server/src/modules/library/resolvers/library.ts`, `libraryGuardian.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/library/resolvers/library.ts:187 | bookTitles | library:read | `library:view` |
| server/src/modules/library/resolvers/library.ts:211 | bookTitlesPage | library:read | `library:view` |
| server/src/modules/library/resolvers/library.ts:239 | bookTitle | library:read | `library:view` |
| server/src/modules/library/resolvers/library.ts:259 | libraryPolicies | library:read | `library:view` |
| server/src/modules/library/resolvers/library.ts:268 | librarianHistory | library:read | `library:view` |
| server/src/modules/library/resolvers/library.ts:278 | currentLibrarians | library:read | `library:view` |
| server/src/modules/library/resolvers/library.ts:302 | amILibrarian | authenticated; library:manage OR TEACHER + assignment (:308-312) | no gate (probe); returns the shared assertIsLibrarian result (`library:lend` + (designation librarian OR `library:edit_all`)) |
| server/src/modules/library/resolvers/libraryGuardian.ts:49 | childLibraryLoans | authenticated + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |

#### `server/src/modules/chat/resolvers/chat.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| chat.ts:251 | myConversations | chat:read + own memberships | `chat:view` + own memberships (stays) |
| chat.ts:263 | conversation | chat:read + assertChatMember | `chat:view` + membership (stays) |
| chat.ts:272 | messages | chat:read + membership (listMessages) | `chat:view` + membership (stays) |
| chat.ts:542 | oversightConversations | chat:oversee (RESERVED) | `chat:view_all` (LOCKED) |
| chat.ts:557 | oversightConversationsPage | chat:oversee | `chat:view_all` (LOCKED) |
| chat.ts:573 | oversightMessages | chat:oversee | `chat:view_all` (LOCKED) |

#### `server/src/modules/saturday-revision/resolvers/`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/saturday-revision/resolvers/revision.ts:275 | groupRevisionSaturday | authenticated + assertCanReadGroup (isAdminStaff OR tracker:read + group lead) | `saturday_revision:view` + designation group_lead (stays) (+ `saturday_revision:view_all` lifts scope) |
| server/src/modules/saturday-revision/resolvers/revision.ts:293 | studentRevisionHistory | authenticated + assertCanReadStudent | `saturday_revision:view` + designation group_lead (stays) (+ `view_all` lifts scope) |
| server/src/modules/saturday-revision/resolvers/revision.ts:311 | studentRevisionHistoryPage | authenticated + assertCanReadStudent | `saturday_revision:view` + designation group_lead (stays) (+ `view_all` lifts scope) |
| server/src/modules/saturday-revision/resolvers/revision.ts:330 | myRevisionGroups | authenticated; not GUARDIAN; isAdminStaff OR tracker:read (:339-343) | `saturday_revision:view` + own groups (+ `view_all` lifts scope to all groups); GUARDIAN deny (stays) |
| server/src/modules/saturday-revision/resolvers/revisionDelivery.ts:149 | revisionEscalationConfig | authenticated + assertConfigAdmin | `saturday_revision:settings` |
| server/src/modules/saturday-revision/resolvers/revisionGuardian.ts:56 | childRevision | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| server/src/modules/saturday-revision/resolvers/revisionSummary.ts:207 | studentJuzWeakness | authenticated + assertReadStudent | `saturday_revision:view` + designation group_lead (stays) (+ `view_all` lifts scope) |
| server/src/modules/saturday-revision/resolvers/revisionSummary.ts:220 | revisionGroupCoverage | authenticated + assertReadGroup | `saturday_revision:view` + designation group_lead (stays) (+ `view_all` lifts scope) |
| server/src/modules/saturday-revision/resolvers/revisionSummary.ts:237 | revisionWeeklyTrend | authenticated + assertScope (student or group) | `saturday_revision:view` + designation group_lead (stays) (+ `view_all` lifts scope) |
| server/src/modules/saturday-revision/resolvers/revisionSummary.ts:254 | revisionLevelDashboard | authenticated + assertReadGroup | `saturday_revision:view` + designation group_lead (stays) (+ `view_all` lifts scope) |
| server/src/modules/saturday-revision/resolvers/revisionSummary.ts:267 | revisionStudentDashboard | authenticated + assertReadStudent | `saturday_revision:view` + designation group_lead (stays) (+ `view_all` lifts scope) |
| server/src/modules/saturday-revision/resolvers/revisionSummary.ts:280 | revisionMistakeBreakdown | authenticated + assertScope | `saturday_revision:view` + designation group_lead (stays) (+ `view_all` lifts scope) |
| server/src/modules/saturday-revision/resolvers/revisionSummary.ts:297 | revisionCompletenessStatus | authenticated + assertDashboardAdmin (isAdminStaff) | `saturday_revision:view_all` |
| server/src/modules/saturday-revision/resolvers/revisionSummary.ts:310 | revisionCompletenessChase | authenticated + assertChaseAdmin (isAdminStaff AND message:dispatch) | `saturday_revision:remind` |

#### `server/src/modules/vocab/resolvers/`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/vocab/resolvers/vocabGuardian.ts:28 | childVocab | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| server/src/modules/vocab/resolvers/vocabResult.ts:109 | vocabStudentResult | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabResult.ts:123 | vocabTestResults | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabSummary.ts:242 | vocabTestReport | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabSummary.ts:257 | vocabStudentDashboard | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabSummary.ts:275 | vocabStudentTestsPage | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabSummary.ts:293 | vocabClassDashboard | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabSummary.ts:311 | vocabClassTestsPage | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabSummary.ts:329 | vocabStudentCumulative | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabTest.ts:245 | vocabTest | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabTest.ts:256 | vocabTestPositions | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabTest.ts:266 | vocabTests | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabTest.ts:285 | vocabTestsPage | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabTest.ts:309 | vocabTesterAssignment | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabTest.ts:325 | vocabAssignmentHistory | roster:manage | `vocab_test:assign` |
| server/src/modules/vocab/resolvers/vocabTest.ts:339 | vocabAssignmentHistoryPage | roster:manage | `vocab_test:assign` |
| server/src/modules/vocab/resolvers/vocabTest.ts:354 | myVocabAssignments | tracker:read + own row | `vocab_test:view` + own row (stays) |
| server/src/modules/vocab/resolvers/vocabTest.ts:370 | myVocabAssignmentsPage | tracker:read + own row | `vocab_test:view` + own row (stays) |
| server/src/modules/vocab/resolvers/vocabWord.ts:129 | vocabWords | tracker:read | `vocab_test:view` (F-12) |
| server/src/modules/vocab/resolvers/vocabWord.ts:150 | vocabWord | tracker:read | `vocab_test:view` (F-12) |

## (c) REST routes / SSE topics
| file:line | route / topic | today's gate | → new gate |
|---|---|---|---|
| server/src/routes/files.ts:276 | POST /files/chat | chat:write + conversation membership | `chat:send` + membership (stays) |
| server/src/routes/files.ts:504 | POST /files/classnote | routine:read | `class_note:create` |
| server/src/routes/files.ts:1157 | GET /files/:id (classnote_attachment) | routine:read, else guardian child check | `class_note:view`; guardian branch GUARDIAN (guardian:read_child, unchanged) |
| server/src/routes/triggers.ts:29, :128 | POST /triggers/attendance-reminder, /triggers/library-reminder | scheduler shared secret | system |

No SSE topics in this area.

## (d) Hidden role / designation gates
| file:line | today | → replacement |
|---|---|---|
| server/src/modules/attendance/resolvers/studentAttendance.ts:69 `hasManage` (used :88, :100, :794, :915, :939) | callerHasPermission(attendance:manage) in resolver bodies | split: marker-read bypass → `attendance:edit`; report-read bypass → `attendance:view_all` |
| server/src/modules/attendance/resolvers/studentAttendance.ts:82-93 `assertUnitMarkerOrManage` | marker of the date (designation, row/day) | `attendance:mark` + designation marker_of_the_day (stays); manage branch → `attendance:edit` |
| server/src/modules/attendance/resolvers/studentAttendance.ts:98-107 `assertSectionReportAccess` | section's class teacher (designation, row) | `attendance:view` + designation class_teacher (stays); manage branch → `attendance:view_all` |
| server/src/modules/attendance/services/StudentAttendanceService.ts:162-170 `assertMayMarkUnit` | marker of the day (override → routine → class teacher) | designation marker_of_the_day (stays), paired with `attendance:mark` |
| server/src/modules/attendance/services/StudentAttendanceService.ts:195 | assigned marker must have `role === "TEACHER"` | target must hold `attendance:mark` |
| server/src/modules/attendance/resolvers/studentAttendance.ts:863 | `role === "GUARDIAN"` deny | plane check (stays) |
| server/src/modules/attendance/resolvers/push.ts:31, :48 | GUARDIAN → guardian-owned device | plane routing (stays) |
| server/src/modules/routine/resolvers/teacherClassLoad.ts:19-24 `assertClassLoadScope` | `isAdminStaff` OR own id | `routine:view_all`; own id stays under `routine:view` |
| server/src/modules/routine/resolvers/routineTriggers.ts:315, :337 | `canManage: isAdminStaff(ctx.auth)` for publishClassNote | `class_note:edit_all` |
| server/src/modules/routine/resolvers/routineTriggers.ts:420, :493, :518 | callerHasPermission(routine:manage) in body | `class_note:view_all` (archive scope :420, filter options :493); `class_note:edit_all` (update any :518) |
| server/src/modules/routine/resolvers/routineTriggers.ts:283 `gateNoteHomework` | tracker:write + assertCanWrite | `homework:declare` + assertCanWrite (stays) |
| server/src/modules/routine/services/RoutineTriggerService.ts:112-123 | slot teacher OR cover teacher (unless canManage) | `class_note:create` + designation slot_teacher_or_cover (stays); canManage → `class_note:edit_all` |
| server/src/modules/routine/resolvers/routineSlots.ts:264 | `user:manage` on a routine read | `teaching_assignments:assign_subject_teacher` |
| server/src/modules/routine/resolvers/routineSlots.ts:431 | `role === "GUARDIAN"` deny | plane check (stays) |
| server/src/modules/routine/services/RoutineCoverService.ts:97 | cover availability lists only `role: "TEACHER"` users | role data filter (stays), or "users with routine slots"; see (h) |
| server/src/modules/routine/services/MyDayService.ts:110 / :242 / :275 | routine:read / attendance:mark / attendance:manage | `routine:view` / `attendance:mark` / `attendance:view_all` |
| server/src/modules/routine/services/MyDayService.ts:256 | class-teacher sections only if `auth.role === "TEACHER"` | drop the role test; designation class_teacher alone decides |
| server/src/modules/routine/services/PendingAlertService.ts:406 / :412 / :417 / :426 | attendance:mark / routine:read / tracker:write | `attendance:mark` / `class_note:create` / `homework:declare` |
| server/src/modules/library/services/LibrarianService.ts:33-38 `assertIsLibrarian` | library:manage OR (`role === "TEACHER"` AND active LibrarianAssignment) | caller holds `library:lend` / `library:return` / `library:remind` (role default or per-user grant) AND (an active LibrarianAssignment OR `library:edit_all`): action + designation librarian (stays), the library:manage desk branch → `library:edit_all` (O on); `role === "TEACHER"` test dropped |
| server/src/modules/library/services/LibrarianService.ts:47 | duty only assignable to `role === "TEACHER"` | target must hold `library:lend`; role test dropped |
| server/src/modules/library/resolvers/library.ts:308-312 `amILibrarian` | same logic as assertIsLibrarian, duplicated | reuse the assertIsLibrarian helper; return the effective desk capability |
| server/src/modules/library/resolvers/circulation.ts:244-253, :376 | requireLibraryRead / isSelfStaff / GUARDIAN deny | `library:view` (self row stays); GUARDIAN plane check (stays) |
| server/src/modules/chat/resolvers/chat.ts:340, :392 | canManage = chat:manage → ANNOUNCEMENT bypass | `chat:publish` |
| server/src/modules/chat/resolvers/chat.ts:662 + server/src/modules/chat/services/GuardianNoticeService.ts:37-46 | SCHOOL needs chat:manage; SECTION needs class teacher unless chat:manage | SCHOOL / any section → `chat:send_notice_all`; SECTION → `chat:send_notice` + designation class_teacher (stays) |
| server/src/modules/chat/services/ChatService.ts:84 | 1:1 partner must not be GUARDIAN | plane check (stays) |
| server/src/modules/chat/services/ChatService.ts:395, :432 | own message only | own-row (stays) |
| server/src/modules/saturday-revision/resolvers/revision.ts:42 `isAdmin` = isAdminStaff (used :49, :61, :74, :340-343) | Principal/Office template = unscoped read + write | reads → `saturday_revision:view_all`; writes → `saturday_revision:edit_all` |
| server/src/modules/saturday-revision/resolvers/revision.ts:50, :62, :75 | tracker:write / tracker:read conjunct (borrowed) | `saturday_revision:enter_results` / `saturday_revision:view` |
| server/src/modules/saturday-revision/services/RevisionService.ts:439 `teacherTeachesGroup` | leads a quran-track slot for the group (routine-derived) | designation group_lead (stays) |
| server/src/modules/saturday-revision/resolvers/revisionDelivery.ts:35-44 `assertCanDeliver` | isAdminStaff OR tracker:write + group lead | `saturday_revision:send` + designation group_lead (stays); isAdminStaff → `saturday_revision:edit_all` |
| server/src/modules/saturday-revision/resolvers/revisionDelivery.ts:47-50 `assertConfigAdmin` | isAdminStaff | `saturday_revision:settings` |
| server/src/modules/saturday-revision/resolvers/revisionSummary.ts:68-71 `assertDashboardAdmin` | isAdminStaff | `saturday_revision:view_all` |
| server/src/modules/saturday-revision/resolvers/revisionSummary.ts:73-78 `assertChaseAdmin` | isAdminStaff AND message:dispatch | `saturday_revision:remind` |
| server/src/modules/vocab/services/vocabGate.ts:26-40 `assertCanManageClassLevel` | `role === "PRINCIPAL"` bypass; `role !== "TEACHER"` deny; teaching/proxy on class level | PRINCIPAL bypass → `vocab_test:edit_all` (PRINCIPAL-DEFAULT); `vocab_test:edit` + class-level scope (stays); OFFICE hard-deny replaced (Office passes only with scope or `edit_all`) |
| server/src/modules/vocab/services/vocabGate.ts:47-60 `assertCanOperateVocab` | `role === "PRINCIPAL"` bypass; `role !== "TEACHER"` deny; assigned tester OR proxy | PRINCIPAL bypass → `vocab_test:edit_all` (PRINCIPAL-DEFAULT); `vocab_test:create` / `vocab_test:enter_results` + designation vocab_tester (stays); OFFICE hard-deny replaced (Office passes only with the designation or `edit_all`) |

The inventory's AttendanceReminderService.ts:88 row is in (g).

## (e) Self-service, guardian and public paths (kept as-is)
| path | today | → |
|---|---|---|
| registerPushDevice / unregisterPushDevice (server/src/modules/attendance/resolvers/push.ts:21 / :40) | authenticated, own device | `notifications:view` (SELF) |
| myStaffAttendance (server/src/modules/attendance/resolvers/teacherAttendance.ts:183) | authenticated, own StaffProfile | `staff_attendance:view_own` (SELF) |
| mySectionAttendance (server/src/modules/attendance/resolvers/studentAttendance.ts:853) | authenticated, own teaching/proxy/class-teacher sections | `attendance:view` (shows absentee names, so it becomes removable) |
| attendanceUnitRoster / attendanceUnitDay / sectionAttendance / sectionAbsentees / studentAttendanceHistory / absentNoApplication / leaveApplicationsForSection (server/src/modules/attendance/resolvers/studentAttendance.ts) | authenticated, designation-gated, no permission | `attendance:mark` / `attendance:view` + designation (stays), so removing the action removes them |
| teacherAvailability (server/src/modules/routine/resolvers/routineSlots.ts:418) | any staff | `routine:view` |
| teacherClassLoad own (server/src/modules/routine/resolvers/teacherClassLoad.ts:63) | own id | `routine:view` |
| myDay (server/src/modules/routine/resolvers/myDay.ts:167) | composite, each block self-gates | no gate of its own; blocks follow the mapped actions |
| amILibrarian (server/src/modules/library/resolvers/library.ts:302) | probe | no gate; probe of `library:lend` + designation librarian |
| issueBook … cancelReservation (server/src/modules/library/resolvers/circulation.ts) | authenticated + internal gate | declarative `library:*` action scopes (`hasAnyPermission` where the resolver branches); designation librarian checked inside the resolver |
| All saturday-revision staff resolvers (server/src/modules/saturday-revision/resolvers/) | authenticated + internal gates (Office holds no tracker:*) | declarative `saturday_revision:*` action scopes |

Guardian plane (rows in (b)/(c)): childLibraryLoans, childRevision, childVocab and the GET /files/:id classnote_attachment guardian branch stay GUARDIAN (guardian:read_child, unchanged). Public: none in this area. System: POST /triggers/attendance-reminder, /triggers/library-reminder.

## (f) App gates
| file:line | today | → new |
|---|---|---|
| app/src/navigation/AppTabs.tsx:1680 (`canRoutine`, drives RoutineTab :1835 and ClassNotesTab :1838) | routine:read | split the flag: RoutineTab → `routine:view`; ClassNotesTab → `class_note:view` |
| app/src/navigation/AppTabs.tsx:1681-1682 (`canAttendance`) | attendance:mark \|\| attendance:manage | any of `attendance:mark`, `attendance:view`, `attendance:view_all`, `attendance:edit`, `attendance:assign` \|\| `staff_attendance:upload` |
| app/src/navigation/AppTabs.tsx:1683 (`canLibrary`) | library:read | `library:view` |
| app/src/navigation/AppTabs.tsx:1689 (`canChat`) | chat:read | `chat:view` |
| app/src/navigation/AppTabs.tsx:1693 (`canVocab`) | tracker:read \|\| roster:manage | `vocab_test:view` \|\| `vocab_test:assign` |
| app/src/navigation/AppTabs.tsx:1730 (`canRevision`) | tracker:read \|\| roster:manage | `saturday_revision:view` \|\| `saturday_revision:view_all` |
| app/src/navigation/AppTabs.tsx:1762 (`canReports`, holds TeacherClassLoad screen :1388) | isRole PRINCIPAL/OFFICE | TeacherClassLoad entry → `routine:view_all` (rest of the Reports tab: other areas) (F-30) |
| app/src/screens/admin/AdminHomeScreen.tsx:20 | routine:manage | `routine:settings` \|\| `routine:edit` \|\| `routine:edit_calendar` (admin routine cards) |
| app/src/screens/admin/AdminHomeScreen.tsx:37 | attendance:manage (ranking card) | `attendance:view_all` (student ranking) / `staff_attendance:view_all` (staff ranking) |
| app/src/screens/admin/AssignSubjectTeacherScreen.tsx:74 | routine:manage ("also update routine") | `routine:edit` |
| app/src/screens/attendance/AttendanceHomeScreen.tsx:28 | attendance:mark | `attendance:mark` |
| app/src/screens/attendance/AttendanceHomeScreen.tsx:29 (cards :49 admin, :53 upload, :57 report, :61 assign marker) | attendance:manage | :49 → `attendance:edit`; :53 → `staff_attendance:upload`; :57 → `attendance:view_all` (+ `staff_attendance:view_all` for the staff summary); :61 → `attendance:assign` |
| app/src/screens/home/TodayScreen.tsx:132 | attendance:manage | `attendance:view_all` |
| app/src/screens/home/TodayScreen.tsx:134-135 | mark \|\| manage | same set as AppTabs `canAttendance` |
| app/src/screens/home/TodayScreen.tsx:138 (`canClassNotes`) | routine:read | `class_note:create` |
| app/src/screens/home/TodayScreen.tsx:147, app/src/screens/home/AdminTodayScreen.tsx:115 (`canLiveBoard`) | routine:manage | `routine:view_all` |
| app/src/screens/hr/StaffHubScreen.tsx:786 | attendance:manage | `staff_attendance:view_all` |
| app/src/screens/routine/RoutineHomeScreen.tsx:26 (`canManage`; :49 board, :50 master grid, :51 bell, :52 holidays, :53 note report, :54 notes admin, :85-102/:146-156 editor + cover) | routine:manage | :49/:50 → `routine:view_all`; :51 → `routine:settings`; :52 → `routine:edit_calendar`; :53/:54 → `class_note:view_all`; editor → `routine:edit`; cover → `cover:assign` |
| app/src/screens/routine/BellScheduleScreen.tsx:28 | routine:manage | `routine:settings` |
| app/src/screens/classnotes/MyClassNotesScreen.tsx:107 | tracker:write (homework half) | `homework:declare` |
| app/src/screens/library/LibraryHomeScreen.tsx:41-43, :82-89, :129 | library:manage + amILibrarian | desk → `library:lend` + designation librarian (via amILibrarian); :86 catalog → `library:edit`; :89 admin → `library:settings` \|\| `library:assign`; chase (:55) → `library:remind` |
| app/src/screens/library/TitleDetailScreen.tsx:51-53, :136 | library:manage + amILibrarian | queue/desk → `library:lend` + designation librarian; copy edit → `library:edit` |
| app/src/screens/chat/ChatHomeScreen.tsx:64 (:87 group manage) | chat:manage | `chat:create` \|\| `chat:edit` |
| app/src/screens/chat/ChatHomeScreen.tsx:65 (:109 oversight) | chat:oversee | `chat:view_all` (LOCKED) |
| app/src/screens/chat/ChatHomeScreen.tsx:66 (:101 notice entry) | chat:write | `chat:send_notice` \|\| `chat:send_notice_all` |
| app/src/screens/chat/ChatThreadScreen.tsx:55 (:246 announcement lock, :277 group admin) | chat:manage | :246 → `chat:publish`; :277 → `chat:edit` |
| app/src/screens/chat/NewChatScreen.tsx:29 (:63) | chat:manage | `chat:create` |
| app/src/screens/chat/GuardianNoticeScreen.tsx:45 (:58/:64/:113/:127) | chat:manage | `chat:send_notice_all` |
| app/src/screens/revision/RevisionHomeScreen.tsx:36 (:48 dashboard button) | roster:manage (server uses isAdminStaff) | `saturday_revision:view_all` (F-31) |
| app/src/screens/vocab/VocabHomeScreen.tsx:28 (:46 assign tester) | roster:manage | `vocab_test:assign` |
| app/src/components/LiveClassCard.tsx (gated by caller, comment :5) | routine:manage | `routine:view_all` |

## (g) Notification recipients chosen by role
| file:line | today | → holders of |
|---|---|---|
| server/src/modules/attendance/services/AttendanceReminderService.ts:88 `userIdsByRole` | T1245 → acting-as OFFICE, T1400 → acting-as PRINCIPAL | `attendance:view_all` |

No other role-routed recipient is named for this area.

## (h) Build notes
- Two designation patterns. Marker of the day, class teacher, slot teacher/cover, Quran group lead and weekly vocab tester are row/day WHERE gates: the action means "eligible", the designation picks the rows. The librarian is a school-wide desk duty: the action (role default or per-user grant) plus an active LibrarianAssignment. The editor shows the DESIGNATION badge on `attendance:mark`, `attendance:view`, `class_note:create`, `chat:send_notice`, `saturday_revision:{view,enter_results,send}`, `vocab_test:{create,enter_results}` and `library:{lend,return,remind}`, so a ticked box is not read as "works everywhere".
- Librarian for Office: today `library:manage` lets P/O work the desk with no LibrarianAssignment. That branch becomes `library:edit_all` (O on), which waives the librarian designation; teachers still need the assignment. Open: may an Office-role helper be given desk duty (LibrarianService.ts:47 target check)?
- Assign-target checks (assignSectionMarker / assignUnitMarker, assignLibrarian) move from `role === "TEACHER"` to "target holds the action". Under R3 the Principal holds `attendance:mark`; this is harmless (no designation) until the target check moves to the action.
- vocab: `vocab_test:edit_all` is PRINCIPAL-DEFAULT and replaces the PRINCIPAL bypass in vocabGate. The OFFICE hard-deny is replaced: Office passes only with scope/designation or `edit_all`. OFFICE defaults for `vocab_test:edit`, `create`, `enter_results`, `edit_all` are off, which reproduces today. Vocab reads have no row scope and vocab sends are unscoped (F-12).
- Borrowed permissions are cut loose: saturday_revision (tracker:read/write, message:dispatch), vocab (tracker:*, roster:manage, message:dispatch), class notes (routine:read/manage), staff attendance and the HR staff hub (attendance:manage), sectionSubjectRoutineTeachers (user:manage). Toggling homework must not switch revision or vocab on or off. OFFICE has no vocab view today (no tracker:read) yet sees the Vocab tab via roster:manage; `vocab_test:view || vocab_test:assign` reproduces that.
- `routine:view` is a base read that the Today screen, class notes, subject-group pickers and attendance's routine-derived marker lookups lean on (server-side lookups are not permission-gated; the app tabs are). Make it non-removable, or warn on removal. `subjectGroupMemberProfiles` exposes student names to every routine reader (F-20).
- The master-grid cell edit needs `routine:view_all` (to open the grid) and `routine:edit`. Bell duty stays under `routine:settings`; split out an own action only if the owner wants a non-admin ringing it.
- The class-note write bypasses were inconsistent (role test for publish, permission test for update); both become `class_note:edit_all`. The homework half of publishClassNote stays a homework gate (`homework:declare`).
- RoutineCoverService.ts:97 lists only `role: "TEACHER"` users as cover candidates: an Office-template teacher appears, a deputy with role OFFICE does not. Decide whether it becomes "users with routine slots".
- Reminder recipients (g): decide whether the T1245/T1400 attendance reminders follow `attendance:view_all` holders or stay a role/notification setting.
- registerPushDevice / unregisterPushDevice are notification infrastructure living in the attendance module; consider moving the file.
- App: AppTabs uses one `canRoutine` flag for both the Routine and Class-notes tabs; split it. RevisionHomeScreen shows the dashboard on roster:manage while the server checks isAdminStaff (F-31).
- Library BN wording uses ধার, never ঋণ; one server error string (circulation.ts:435) still says "ঋণের অবস্থা" (F-33).

Listed elsewhere: `server/src/modules/hr/resolvers/staffHub.ts:348` staffAttendance, `:362` staffAttendanceSummary, `:386` staffLatenessPreview → hr-finance.md (new gate `staff_attendance:view_all`). The other `cover` actions (`view_all`, `approve`, `assign_proxy`, `propose`) → hr-finance.md.

## (e) `lesson_progress` — lesson-plan progress (added with LP-1/LP-2, 2026-10-22, D-#820–#826)

| file | field | gate |
|---|---|---|
| server/src/modules/lesson-progress/resolvers/lessonDelivery.ts | lessonPlanForSlot (LP-1) | hasAnyPermission(`class_note:create`, `class_note:edit`, `class_note:edit_all`) + slot teacher / cover / note author, or `class_note:edit_all` |
| server/src/modules/routine/resolvers/routineTriggers.ts | publishClassNote / updateClassNote `lessonPlan` arg (LP-1) | rides the note's own gate (no new action) |
| server/src/modules/lesson-progress/resolvers/lessonProgress.ts | lessonProgressOverview (LP-2) | `lesson_progress:view_all` |
| server/src/modules/lesson-progress/resolvers/lessonProgress.ts | myLessonProgress (LP-2) | hasAnyPermission(`lesson_progress:view`, `lesson_progress:view_all`); own routine শাখা × subjects + class-teacher শাখা |
| server/src/modules/lesson-progress/resolvers/lessonProgress.ts | lessonSectionTracker (LP-2) | hasAnyPermission(`lesson_progress:view`, `lesson_progress:view_all`) + row rule (routine holder / class teacher; `view_all` lifts it) |
| app DrawerContent | ক্লাস নোট → পাঠ পরিকল্পনার অগ্রগতি leaf | perms `lesson_progress:view` / `view_all` (inside the `class_note:view` route) |
| server/src/modules/lesson-progress/resolvers/studentLessons.ts | studentLessons (LP-3) | hasAnyPermission(`lesson_progress:view`, `lesson_progress:view_all`) + row rule: `view_all` / class teacher of the child's শাখা see every subject; a subject teacher only the routine-held subjects (`narrowed`); anyone else refused |
| server/src/modules/mastery/resolvers/masteryDiagnosis.ts | MasteryOutcomeTrail.chapterLessons (LP-3) | rides `masteryOutcomeTrail`'s gate (routine holder / `mastery:edit_all`) |
| server/src/modules/mastery/resolvers/masteryAction.ts | MasteryAction.lessonGap (LP-3) | rides `masteryAction`'s gate |
| app StudentProfileScreen | পাঠ tab | `lesson_progress:view` / `view_all` |
| server/src/modules/lesson-progress/resolvers/lessonProgress.ts | lessonCatchupSuggestion (LP-4) | `lesson_progress:view_all` |
| server/src/modules/lesson-progress/resolvers/lessonProgress.ts | createLessonCatchup (LP-4) | `lesson_progress:view_all`; the task itself through createTask (`work_board:assign` to give it to another person) |
| server/src/modules/lesson-progress/resolvers/guardianLessons.ts | childMissedLessonsPage (LP-4) | GUARDIAN `guardian:read_child` + assertGuardianOfStudent |
