# Homework, assignment, gift and work claims — build checklist

Features: `homework`, `assignment`, `assignment_gift`, `work_claim`, plus `reconciliationReport` (gate = any-of `homework:view_reports`, `assignment:view_reports`; no feature of its own). Owner rows: see README. Source: inventory A1 (with the work-claim and reconciliation rows of A2 merged in), origin/dev 2026-10-20.
Counts: 46 mutations, 45 queries, 4 REST/SSE.

Scope helpers used below (applies to every row that names them): in `assertCanWrite` / `assertCanWriteAny` (and the wrappers `assertItemWriteScope`, `assertCanWriteOnItem`), the primary-role PRINCIPAL bypass becomes `homework:edit_all` / `assignment:edit_all`, and the OFFICE hard refusal is replaced: OFFICE passes only with scope or `<feature>:edit_all`. In `assertCanRead` / `allowedSubjectCodesForSection`, the `isAdminStaff` bypass becomes `homework:view_all` / `assignment:view_all`. See (d).

## (a) Mutations

### `server/src/modules/trackers/resolvers/homework.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| homework.ts:263 | declareHomeworkItem | tracker:write + assertCanWrite(section, subject, declare_homework) | `homework:declare` + assertCanWrite(declare_homework) (stays) |
| homework.ts:316 | updateHomeworkItem | tracker:write + assertCanWrite(item.section, item.subject, declare_homework); service locks the identity trio, issued items allow only some fields | `homework:declare` + assertCanWrite(declare_homework) (stays) + service field locks (stays); editing another teacher's item → `homework:edit_all` (F-9) |
| homework.ts:374 | deleteHomeworkItem | tracker:write + assertCanWrite(declare_homework); service: declared-only, day unreconciled | `homework:declare` + assertCanWrite(declare_homework) (stays) + service declared-only/unreconciled rule (stays); another teacher's item → `homework:edit_all` (F-9) |
| homework.ts:407 | voidHomeworkItem | homework:void; no resolver gate; service refuses an item with any record | `homework:delete` + HomeworkVoidService refuses items with records (stays) |
| homework.ts:471 | declareNoHomework | tracker:write + assertCanWrite(declare_homework) | `homework:declare` + assertCanWrite(declare_homework) (stays) |
| homework.ts:500 | removeNoHomework | tracker:write + assertCanWrite(declare_homework) | `homework:declare` + assertCanWrite(declare_homework) (stays) |
| homework.ts:549 | issueHomeworkItem | tracker:write + assertCanWrite(section, item.subject, declare_homework) | `homework:issue` + assertCanWrite(declare_homework) (stays); no app caller, retirement candidate |
| homework.ts:585 | transitionHomeworkRecord | tracker:write + assertCanWrite(section, subject, submit_homework when toState=SUBMITTED, else untagged) + assertHwRecordInSection | hasAnyPermission(`homework:mark_submitted`, `homework:issue`, `homework:check`, `homework:return`) + in-resolver assertHasPermission per branch: SUBMITTED/CHASE/DUE → `homework:mark_submitted`; GIVEN → `homework:issue`; CHECKED/RESUBMIT → `homework:check`; RETURNED → `homework:return`; + assertCanWrite tag rule (stays) + assertHwRecordInSection (stays) |
| homework.ts:623 | markHomeworkRecordsDue | tracker:write + assertCanWrite(section, —, submit_homework) | `homework:mark_submitted` + assertCanWrite(submit_homework) (stays); no app caller |
| homework.ts:1198 | trimHomeworkItem | tracker:write + assertCanConfirmHomework (P / class teacher / confirmer / supervisor / delegation) | `homework:confirm_day` + designation class_teacher / homework_confirmer / homework_supervisor / confirm_homework_day delegation (stays); PRINCIPAL leg → `homework:edit_all` |
| homework.ts:1228 | confirmHomeworkDay | tracker:write + assertCanConfirmHomework | `homework:confirm_day` + designation class_teacher / homework_confirmer / homework_supervisor / confirm_homework_day delegation (stays); PRINCIPAL leg → `homework:edit_all` |
| homework.ts:1327 | checkHomeworkRecord | tracker:write + assertCanWrite(check_homework) + assertHwRecordInSection | `homework:check` + assertCanWrite(check_homework) (stays) + assertHwRecordInSection (stays) |
| homework.ts:1394 | revertHomeworkRecord | authenticated; GUARDIAN denied; if not isAdminStaff → assertCanWriteAny([declare, submit, check]_homework); service own-action/same-day unless admin | hasAnyPermission(`homework:undo`, `homework:undo_any`); `homework:undo_any` replaces the `admin = isAdminStaff` flag (skips scope + service any-actor/any-day); else assertCanWriteAny([declare, submit, check]_homework) (stays) + HomeworkRevertService own-stamp/same-day rule (stays). F-7 |
| homework.ts:1466 | recordHomeworkOutcome | tracker:write + assertCanWrite(check_homework) + assertHwRecordInSection | `homework:check` + assertCanWrite(check_homework) (stays) + assertHwRecordInSection (stays); outcome NOT_SUBMITTED is a chase, see (h) |
| homework.ts:1584 | homeworkSubmitPass | tracker:write + assertItemWriteScope(submit_homework) | `homework:mark_submitted` + assertItemWriteScope(submit_homework) (stays) |
| homework.ts:1611 | homeworkReturnPass | tracker:write + assertItemWriteScope(check_homework) | `homework:return` + assertItemWriteScope(check_homework) (stays) |

### `server/src/modules/trackers/resolvers/homeworkFiles.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| homeworkFiles.ts:37 | attachHomeworkQuestionFile | tracker:write + assertCanWrite(item.section, subject, declare_homework) | `homework:declare` + assertCanWrite(declare_homework) (stays) |
| homeworkFiles.ts:63 | attachHomeworkAnswerFile | tracker:write + assertCanWrite(rec.section, subject, check_homework) | `homework:check` + assertCanWrite(check_homework) (stays) |

### `server/src/modules/trackers/resolvers/assignment.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| assignment.ts:816 | upsertAssignmentSchedule | roster:manage | `assignment:settings` |
| assignment.ts:840 | addAssignmentScheduleEntry | roster:manage | `assignment:settings` |
| assignment.ts:874 | removeAssignmentScheduleEntry | roster:manage | `assignment:settings` |
| assignment.ts:891 | retireAssignmentScheduleEntry | roster:manage | `assignment:settings` |
| assignment.ts:911 | updateAssignmentScheduleEntryTeacher | roster:manage | `assignment:settings` |
| assignment.ts:1072 | declareNoAssignment | tracker:write + assertCanWrite(section, entry.subject, declare_assignment) | `assignment:declare` + assertCanWrite(declare_assignment) (stays) |
| assignment.ts:1107 | removeNoAssignment | tracker:write + assertCanWrite(declare_assignment) | `assignment:declare` + assertCanWrite(declare_assignment) (stays) |
| assignment.ts:1191 | updateAssignmentItem | tracker:write + assertCanWriteOnItem (item section declare_assignment, or split-half record section check_assignment) + service own-cell/RECORD_HALF unless isAdmin = isAdminStaff | `assignment:declare` + assertCanWriteOnItem tags (stays) + AssignmentService own-cell/RECORD_HALF rule (stays); `assignment:edit_all` replaces `isAdmin` (2H) |
| assignment.ts:1224 | deleteAssignmentItem | tracker:write + assertCanWriteOnItem(declare_assignment) + service assertOwnsAssignmentCell unless isAdmin; DRAFT only | `assignment:declare` + assertCanWriteOnItem (stays) + own-cell and DRAFT-only rules (stay); `assignment:edit_all` replaces `isAdmin` (2H) |
| assignment.ts:1245 | deliverAssignment | tracker:write + assertCanWrite(section, entry.subject, declare_assignment) | `assignment:declare` + assertCanWrite(declare_assignment) (stays) |
| assignment.ts:1387 | setAssignmentItemMinutes | authenticated + assertCanConfirmAssignmentWeek (roster:manage OR class teacher) | `assignment:confirm_week` + designation class_teacher (stays); roster:manage leg → waived by `assignment:settings` (README waiver). F-8 |
| assignment.ts:1427 | confirmAssignmentWeek | authenticated + assertCanConfirmAssignmentWeek | `assignment:confirm_week` + designation class_teacher (stays); roster:manage leg → waived by `assignment:settings` (README waiver). F-8 |
| assignment.ts:1452 | redeliverAssignmentRecord | tracker:write + assertCanWrite(declare_assignment) + assertRecordInSection | `assignment:issue` + assertCanWrite(declare_assignment) (stays) + assertRecordInSection (stays) |
| assignment.ts:1477 | transitionAssignmentRecord | tracker:write + assertCanWrite(submit_assignment when toState=SUBMITTED, else untagged) + assertRecordInSection | hasAnyPermission(`assignment:mark_submitted`, `assignment:check`, `assignment:return`, `assignment:resubmit`) + in-resolver assertHasPermission per branch: SUBMITTED/CHASE → `assignment:mark_submitted`; CHECKED → `assignment:check`; RETURNED → `assignment:return`; RESUBMIT → `assignment:resubmit`; + assertCanWrite tag rule (stays) + assertRecordInSection (stays) |
| assignment.ts:1503 | sweepAssignmentChases | message:dispatch + assertFollowUpAdmin (isAdminStaff) | `assignment:remind`; no app caller |
| assignment.ts:1647 | revertAssignmentRecord | authenticated; GUARDIAN denied; assertRecordInSection; if not isAdminStaff → assertCanWriteAny([declare, submit, check]_assignment); service own/same-day unless admin | hasAnyPermission(`assignment:undo`, `assignment:undo_any`); `assignment:undo_any` replaces `admin = isAdminStaff`; else assertCanWriteAny(...) (stays) + assertRecordInSection (stays) + AssignmentRevertService own-stamp/same-day rule (stays). F-7 |
| assignment.ts:1684 | checkAssignmentRecord | tracker:write + assertCanWrite(check_assignment) + assertRecordInSection | `assignment:check` + assertCanWrite(check_assignment) (stays) + assertRecordInSection (stays) |
| assignment.ts:1854 | assignmentSubmitPass | tracker:write + assertCanWrite(submit_assignment) | `assignment:mark_submitted` + assertCanWrite(submit_assignment) (stays) |
| assignment.ts:1885 | assignmentReturnPass | tracker:write + assertCanWrite(check_assignment) | `assignment:return` + assertCanWrite(check_assignment) (stays) |
| assignment.ts:1917 | recordAssignmentOutcome | tracker:write + assertCanWrite(check_assignment) + assertRecordInSection | `assignment:check` + assertCanWrite(check_assignment) (stays) + assertRecordInSection (stays) |
| assignment.ts:1951 | issueAssignmentResubmission | tracker:write + assertCanWrite(check_assignment) + assertRecordInSection | `assignment:resubmit` + assertCanWrite(check_assignment) (stays) + assertRecordInSection (stays) |
| assignment.ts:2010 | escalateAssignmentChase | message:dispatch + assertFollowUpAdmin | `assignment:remind` |
| assignment.ts:2037 | recordAssignmentFollowUpOutcome | message:dispatch + assertFollowUpAdmin | `assignment:remind` |

### `server/src/modules/trackers/resolvers/assignmentGift.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| assignmentGift.ts:235 | recordGiftHandover | anyOf(tracker:read, gift:manage) + assertCanHandOverGift (isAdminStaff OR class teacher of the student's section) | `assignment_gift:issue` + designation class_teacher of the student's section (stays); isAdminStaff leg → `assignment_gift:view_all` lifts the designation; service re-derives entitlement per tick (stays) |
| assignmentGift.ts:265 | undoGiftHandover | anyOf(tracker:read, gift:manage) + assertCanHandOverGift | `assignment_gift:issue` + designation class_teacher (stays); isAdminStaff leg → `assignment_gift:view_all` lifts the designation |

### `server/src/modules/trackers/resolvers/workClaim.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| workClaim.ts:292 | rejectWorkClaim | tracker:write; no row scope (service checks claim state and reason only) | `work_claim:reject` + add row scope (claim.teacherId = me, or write scope on claim.sectionId). F-5 |
| workClaim.ts:323 | nudgeWorkClaim | authenticated + canWatchClaims (isAdminStaff OR digest recipient); once a day per claim | `work_claim:remind` + designation digest_recipient (stays) + once-a-day rule (stays); isAdminStaff leg → waived by `admin_dashboard:view` (README waiver) |
| workClaim.ts:424 | setWorkClaimDigestRecipients | authenticated + `ctx.auth.role !== "PRINCIPAL"` → deny | `work_claim:settings` |

## (b) Queries

### `server/src/modules/trackers/resolvers/homework.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| homework.ts:442 | unissuedHomework | homework:void; school-wide | `homework:delete` |
| homework.ts:525 | homeworkNilDeclarations | tracker:read + assertCanRead + allowedSubjectCodesForSection | `homework:view` (+ `homework:view_all` lifts scope) + assertCanRead + subject filter (stays) |
| homework.ts:650 | homeworkItems | tracker:read + assertCanRead + subject filter | `homework:view` (+ `homework:view_all` lifts scope) + assertCanRead + subject filter (stays) |
| homework.ts:692 | homeworkTopics | tracker:read; catalogue, no row scope | `homework:view` (declare-form picker) |
| homework.ts:725 | homeworkStudentRecords | tracker:read + assertCanRead + item subject ∈ allowed | `homework:view` (+ `homework:view_all` lifts scope) + assertCanRead + subject check (stays) |
| homework.ts:805 | homeworkOpenRecords | tracker:read + assertCanRead + subject filter | `homework:view` (+ `homework:view_all` lifts scope) + assertCanRead + subject filter (stays) |
| homework.ts:859 | homeworkDoneItemsPage | tracker:read + assertCanRead + subject filter | `homework:view` (+ `homework:view_all` lifts scope) + assertCanRead + subject filter (stays) |
| homework.ts:892 | homeworkDoneItemSubjects | tracker:read + assertCanRead + subject filter | `homework:view` (+ `homework:view_all` lifts scope) + assertCanRead + subject filter (stays) |
| homework.ts:935 | homeworkItemTallies | tracker:read + assertCanRead + subject filter | `homework:view` (+ `homework:view_all` lifts scope) + assertCanRead + subject filter (stays) |
| homework.ts:1107 | homeworkDayTally | tracker:read + assertCanViewHomeworkDay (confirmer OR assertCanRead) | hasAnyPermission(`homework:view`, `homework:confirm_day`) (+ `homework:view_all` lifts scope) + assertCanViewHomeworkDay (stays) |
| homework.ts:1160 | homeworkIssueRoster | tracker:read + assertCanViewHomeworkDay | hasAnyPermission(`homework:view`, `homework:confirm_day`, `assignment:declare`) + assertCanViewHomeworkDay (stays); assignment delivery reads it for the attendance prefill |
| homework.ts:1179 | homeworkTrimCandidates | tracker:read + assertCanViewHomeworkDay | hasAnyPermission(`homework:view`, `homework:confirm_day`) + assertCanViewHomeworkDay (stays) |
| homework.ts:1639 | studentDayLoad | tracker:read + assertCanRead | `homework:view` (+ `homework:view_all` lifts scope) + assertCanRead (stays); no app caller |
| homework.ts:1813 | homeworkSummary | tracker:read + assertCanViewHomeworkDay; isAdminStaff → class-wide, else own-attributed | `homework:view` + assertCanViewHomeworkDay (stays); `homework:view_all` → class-wide numbers (replaces isAdminStaff) |
| homework.ts:1870 | homeworkClassOverview | tracker:read + per-ref assertCanViewHomeworkDay (skips failures); isAdminStaff → class-wide | `homework:view` + per-ref assertCanViewHomeworkDay (stays); `homework:view_all` → class-wide numbers |
| homework.ts:1915 | homeworkWatchList | tracker:read + assertCanRead | `homework:view` (+ `homework:view_all` lifts scope) + assertCanRead (stays) |
| homework.ts:1933 | homeworkTrimPattern | tracker:read + assertCanRead | `homework:view` (+ `homework:view_all` lifts scope) + assertCanRead (stays) |
| homework.ts:1954 | questionUsageFeed | tracker:read + assertCanRead | `homework:view` (+ `homework:view_all` lifts scope) + assertCanRead (stays) |

### `server/src/modules/trackers/resolvers/` — reports
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| hwLifecycleReport.ts:113 | homeworkLifecycleReport | authenticated + actsAsRole PRINCIPAL or OFFICE | `homework:view_reports` |
| hwLifecycleReport.ts:134 | homeworkLifecyclePending | authenticated; teacherId = self → open, else actsAsRole P/O | SELF leg (teacherId = me) stays; another teacher → in-resolver `homework:view_reports` |
| hwLifecycleReport.ts:164 | myHomeworkLifecycle | tracker:read; self-scoped (school report filtered to me) | `homework:view` (self-scoped, stays) |
| hwWeeklyDigest.ts:118 | homeworkWeeklyUnsubmitted | authenticated + actsAsRole P/O | `homework:remind` |
| reconReport.ts:159 | reconciliationReport | authenticated + actsAsRole P/O | hasAnyPermission(`homework:view_reports`, `assignment:view_reports`) |

### `server/src/modules/trackers/resolvers/assignment.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| assignment.ts:948 | assignmentLoadReport | roster:manage | `assignment:view_reports` |
| assignment.ts:963 | assignmentSchedule | authenticated + assertStaffScheduleRead (isAdminStaff OR tracker:read) | hasAnyPermission(`assignment:view`, `assignment:settings`) |
| assignment.ts:978 | expectedAssignmentsForWeek | authenticated + assertStaffScheduleRead | hasAnyPermission(`assignment:view`, `assignment:settings`) |
| assignment.ts:1023 | assignmentCellForSlot | tracker:read + assertCanRead | `assignment:view` (+ `assignment:view_all` lifts scope) + assertCanRead (stays); read by the deliver block |
| assignment.ts:1052 | myAssignmentPrepPrompts | tracker:read; self (userId) | `assignment:view` (self-scoped, stays) |
| assignment.ts:1349 | assignmentWeekLoad | tracker:read; try assertCanConfirmAssignmentWeek, else assertCanRead | hasAnyPermission(`assignment:view`, `assignment:confirm_week`) + confirm-week designation OR assertCanRead (stays). F-8 |
| assignment.ts:1516 | assignmentItems | tracker:read + assertCanRead + subject filter | `assignment:view` (+ `assignment:view_all` lifts scope) + assertCanRead + subject filter (stays) |
| assignment.ts:1557 | assignmentRecords | tracker:read + assertCanRead + assertItemSubjectReadable | `assignment:view` (+ `assignment:view_all` lifts scope) + assertCanRead + assertItemSubjectReadable (stays) |
| assignment.ts:1595 | assignmentItemCounts | tracker:read + assertCanRead + assertItemSubjectReadable | `assignment:view` (+ `assignment:view_all` lifts scope) + assertCanRead + assertItemSubjectReadable (stays) |
| assignment.ts:1750 | assignmentOpenRecords | tracker:read + assertCanRead + subject filter | `assignment:view` (+ `assignment:view_all` lifts scope) + assertCanRead + subject filter (stays) |
| assignment.ts:1801 | assignmentItemTallies | tracker:read + assertCanRead + subject filter | `assignment:view` (+ `assignment:view_all` lifts scope) + assertCanRead + subject filter (stays) |
| assignment.ts:1982 | assignmentChaseList | message:dispatch + assertFollowUpAdmin | `assignment:remind` |
| assignment.ts:1994 | assignmentChaseListPage | message:dispatch + assertFollowUpAdmin | `assignment:remind` |
| assignment.ts:2063 | assignmentFollowUps | message:dispatch + assertFollowUpAdmin | `assignment:remind` |
| assignment.ts:2111 | assignmentSummary | tracker:read; no row scope; `role === "TEACHER"` → own rows, else school-wide | `assignment:view` (own rows) + `assignment:view_all` → school-wide (replaces the primary-role check) |
| assignment.ts:2137 | childAssignments | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| assignment.ts:2205 | myAssignmentLifecycle | tracker:read; self | `assignment:view` (self-scoped, stays) |

### `server/src/modules/trackers/resolvers/` — gift, handout, work claims
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| assignmentGift.ts:203 | assignmentGiftReport | anyOf(tracker:read, gift:manage); GUARDIAN denied; isAdminStaff → unscoped, else sectionId required + assertCanRead | `assignment_gift:view` + sectionId + assertCanRead (stays); `assignment_gift:view_all` → no sectionId, school-wide (replaces isAdminStaff) |
| assignmentHandout.ts:91 | assignmentHandoutBoard | authenticated + assertHandoutRead (isAdminStaff OR tracker:read); school-wide by design | hasAnyPermission(`assignment:view`, `assignment:settings`) |
| workClaim.ts:241 | myWorkClaims | authenticated; self (teacherId = me); [] rather than an error | `work_claim:view_own` (SELF); never refuses (D-#535) |
| workClaim.ts:262 | workClaimQueue | authenticated + canWatchClaims | `work_claim:view_all` + designation digest_recipient (stays); isAdminStaff leg → waived by `admin_dashboard:view` (README waiver) |
| workClaim.ts:410 | workClaimDigestRecipients | authenticated + canWatchClaims | `work_claim:view_all` + designation digest_recipient (stays); isAdminStaff leg → waived by `admin_dashboard:view` (README waiver) |

## (c) REST routes / SSE topics
Not in inventory A1; found on read of `server/src/routes/files.ts` (its homework and assignment file-kind branches belong to this area by the dedupe rule). No SSE topic in `server/src/routes/events.ts` names these features.

| file:line | route / topic | today's gate | → new gate |
|---|---|---|---|
| server/src/routes/files.ts:205 | POST /files/hw (kind question / answer) | tracker:write | kind=question → `homework:declare`; kind=answer → `homework:check` (scope is enforced later by attachHomeworkQuestionFile / attachHomeworkAnswerFile) |
| server/src/routes/files.ts:614 | POST /files/assignment | tracker:write | `assignment:declare` (bound at deliverAssignment) |
| server/src/routes/files.ts:1160 → server/src/modules/trackers/services/AssignmentFileService.ts:23 | GET /files/:id (`assignment_attachment`) | uploader always; staff assertCanRead on the item's section (isAdminStaff unscoped); GUARDIAN: linked active child in the item's class | uploader leg stays; staff → `assignment:view` (+ `assignment:view_all` lifts scope); GUARDIAN (guardian:read_child, unchanged) |
| server/src/routes/files.ts:1195 → server/src/modules/trackers/services/HomeworkFileService.ts:117 | GET /files/:id (`hw_question`, `hw_answer`; default branch) | staff assertCanRead on the owning item/record's section (isAdminStaff unscoped); GUARDIAN: answer via assertGuardianOfStudent, question via a linked active child in the class | staff → `homework:view` (+ `homework:view_all` lifts scope); GUARDIAN (guardian:read_child, unchanged) |

## (d) Hidden role / designation gates
| file:line | today | → replacement |
|---|---|---|
| server/src/middleware/authz.ts:202, :238 | primary `role === "PRINCIPAL"` skips assertCanWrite / assertCanWriteAny (not template-aware) | `homework:edit_all` / `assignment:edit_all`; the helpers take the feature |
| server/src/middleware/authz.ts:203, :239 | primary `role === "OFFICE"` → hard deny on every scoped write | Removed; OFFICE passes only with scope or `<feature>:edit_all` (both O off, so pure Office stays refused) |
| server/src/middleware/authz.ts:96 | assertCanRead: `isAdminStaff` → unscoped read | `homework:view_all` / `assignment:view_all`; the helper takes the feature |
| server/src/middleware/authz.ts:131, :135-146 | allowedSubjectCodesForSection: isAdminStaff → all subjects; class teacher / `Section.homeworkConfirmerId` / `User.homeworkSupervisor` → all subjects | Admin leg → `homework:view_all` / `assignment:view_all`; class teacher / confirmer / supervisor stay designations (scope) |
| server/src/middleware/authz.ts:314-335 | assertCanConfirmHomework: PRINCIPAL; class teacher; homeworkConfirmerId; homeworkSupervisor flag; confirm_homework_day delegation | `homework:confirm_day` + the designation, flag or delegation (stays); PRINCIPAL leg → `homework:edit_all` |
| server/src/modules/trackers/resolvers/homework.ts:1093 | assertCanViewHomeworkDay = confirmer OR read scope | hasAnyPermission(`homework:view`, `homework:confirm_day`) + confirmer designation OR read scope (stays) |
| server/src/modules/trackers/resolvers/homework.ts:1409-1410; server/src/modules/trackers/resolvers/assignment.ts:1662-1663 | GUARDIAN deny; `admin = isAdminStaff` → skip scope + service any-actor/any-day | `homework:undo_any` / `assignment:undo_any`; GUARDIAN holds neither, so the explicit deny becomes redundant. F-7 |
| server/src/modules/trackers/services/HomeworkRevertService.ts:54; server/src/modules/trackers/services/AssignmentRevertService.ts:46 | non-admin may pop only own stamps, same Dhaka day | Rule stays, keyed by `homework:undo_any` / `assignment:undo_any` instead of `admin` |
| server/src/modules/trackers/resolvers/homework.ts:1837, :1900, :1908 | `isAdminStaff` → class-wide numbers, else own-attributed (D-#634/#641) | `homework:view_all` |
| server/src/modules/trackers/resolvers/assignment.ts:134 | assertFollowUpAdmin: isAdminStaff on top of message:dispatch | `assignment:remind` |
| server/src/modules/trackers/resolvers/assignment.ts:144; server/src/modules/trackers/resolvers/assignmentHandout.ts:31 | assertStaffScheduleRead / assertHandoutRead: isAdminStaff OR tracker:read | hasAnyPermission(`assignment:view`, `assignment:settings`) |
| server/src/modules/trackers/resolvers/assignment.ts:178 | assertCanConfirmAssignmentWeek: `roster:manage` (admin proxy) OR class teacher | `assignment:confirm_week` + designation class_teacher (stays); roster:manage leg → waived by `assignment:settings` (README waiver). F-8 |
| server/src/modules/trackers/resolvers/assignment.ts:1218, :1238 → server/src/modules/trackers/services/AssignmentService.ts:308-333 | `isAdmin = isAdminStaff` → edit/delete anyone's cell; else own cell (`item.teacherId`) or RECORD_HALF | `assignment:edit_all` (2H); own-cell and RECORD_HALF rules stay in the service |
| server/src/modules/trackers/resolvers/assignment.ts:2126 | primary `ctx.auth.role === "TEACHER"` → self-scoped summary | `assignment:view_all` holder → school-wide, else own rows |
| server/src/modules/trackers/resolvers/assignmentGift.ts:57 | isAdminStaff → unscoped gift report | `assignment_gift:view_all` |
| server/src/modules/trackers/resolvers/assignmentGift.ts:74-81 | assertCanHandOverGift: isAdminStaff OR class teacher of the student's section | `assignment_gift:issue` + designation class_teacher (stays); isAdminStaff leg → `assignment_gift:view_all` lifts the designation |
| server/src/modules/trackers/resolvers/hwLifecycleReport.ts:32 (+ :152 self bypass) | actsAsRole P/O; self bypass for teacherId = me | `homework:view_reports`; self bypass stays (SELF) |
| server/src/modules/trackers/resolvers/hwWeeklyDigest.ts:33 | actsAsRole P/O | `homework:remind` |
| server/src/modules/trackers/resolvers/reconReport.ts:32 (helper :27-35) | actsAsRole P/O | hasAnyPermission(`homework:view_reports`, `assignment:view_reports`) |
| server/src/modules/trackers/services/WorkClaimDigestService.ts:88-92 (called at workClaim.ts:274, :335, :418) | canWatchClaims = isAdminStaff OR listed in WorkClaimDigestConfig.extraRecipientIds | `work_claim:view_all` (queue, recipient list) / `work_claim:remind` (nudge) + designation digest_recipient (stays); the isAdminStaff leg → designation waived by `admin_dashboard:view` (README waiver) |
| server/src/modules/trackers/resolvers/workClaim.ts:434 | primary `role !== "PRINCIPAL"` | `work_claim:settings` |
| server/src/modules/trackers/services/HomeworkVoidService.ts | refuses items with records | Stays (state rule) |

## (e) Self-service, guardian and public paths (kept as-is)
| path | today | → |
|---|---|---|
| myWorkClaims (workClaim.ts:241) | authenticated, self, [] fallback | `work_claim:view_own` (SELF); must never refuse (D-#535) |
| homeworkLifecyclePending with teacherId = self (hwLifecycleReport.ts:134) | authenticated, self bypass | SELF; another teacher → `homework:view_reports` |
| myHomeworkLifecycle, myAssignmentLifecycle, myAssignmentPrepPrompts | tracker:read, self | Under `homework:view` / `assignment:view`, self-scoped; the dashboard card degrades to empty, not an error, when the action is missing |
| assignmentSummary for a TEACHER (assignment.ts:2111) | tracker:read, own rows | `assignment:view` (own rows) |
| Revert own step (revertHomeworkRecord, revertAssignmentRecord) | authenticated + scope + service rule | `homework:undo` / `assignment:undo` (T on); service own-stamp/same-day rule stays |
| Other `authenticated` fields with resolver-body gates: revertHomeworkRecord, revertAssignmentRecord, setAssignmentItemMinutes, confirmAssignmentWeek, assignmentSchedule, expectedAssignmentsForWeek, assignmentHandoutBoard, homeworkLifecycleReport, homeworkWeeklyUnsubmitted, reconciliationReport, workClaimQueue, workClaimDigestRecipients, nudgeWorkClaim, setWorkClaimDigestRecipients | role/flag checks hidden in resolvers | Not self paths: each moves to a declarative hasPermission / hasAnyPermission as listed in (a) and (b), so the static resolver-gate guard can see it |

## (f) App gates
| file:line | today | → new |
|---|---|---|
| app/src/navigation/AppTabs.tsx:1673 | `canHomework = can("tracker:read")` | `homework:view` |
| app/src/navigation/AppTabs.tsx:1676-1677 | `canAssignment = tracker:read \|\| roster:manage` | anyOf `assignment:view`, `assignment:settings`, `assignment:remind` |
| app/src/navigation/AppTabs.tsx:1762 | `canReports = isRole(P) \|\| isRole(O)` (Reports drawer; reconciliation report hub) | anyOf `homework:view_reports`, `homework:remind`, `assignment:view_reports` (plus other areas' report actions). F-30 |
| app/src/navigation/DrawerContent.tsx:168-177 | report leaves (HwDeclarePending, HwIssuePending, AsDeclarePending, AsDeliverPending, AsPrintPending, ReconciliationReport, HwLifecycleReport, HwWeeklyUnsubmitted) under canReports | per-leaf `perms`: Hw* leaves and HwLifecycleReport → `homework:view_reports`; As* leaves → `assignment:view_reports`; ReconciliationReport → anyOf both view_reports; HwWeeklyUnsubmitted → `homework:remind` |
| app/src/screens/home/TodayScreen.tsx:131 | `canDeclare = can("tracker:read")` (declare tile) | `homework:declare` |
| app/src/screens/home/TodayScreen.tsx:141 (used :197, :207, :827, :875) | `canTrackers` gates the my-homework / my-assignment lifecycle cards | `homework:view` / `assignment:view` per card |
| app/src/screens/home/TodayScreen.tsx:144 (:786) | `canGift = gift:manage` → GiftHandoverCard | `assignment_gift:issue` (+ `assignment_gift:view_all` for the unscoped list) |
| app/src/screens/home/TodayScreen.tsx:149 (:538) | `homework:void` → UnissuedHomeworkCard | `homework:delete` |
| app/src/screens/home/AdminTodayScreen.tsx:113 (:237) | `gift:manage` | `assignment_gift:issue` |
| app/src/screens/home/AdminTodayScreen.tsx:118 (:228) | `homework:void` | `homework:delete` |
| app/src/screens/admin/AdminHomeScreen.tsx:34 | `canWorkClaims = isRole(P) \|\| isRole(O)` (a digest-recipient teacher cannot see this card today) | `work_claim:view_all` |
| app/src/screens/admin/WorkClaimQueueScreen.tsx:194 | `role === "PRINCIPAL"` → digest recipients card | `work_claim:settings` |
| app/src/components/WorkClaimTeacherCard.tsx:44 | reject button, no gate (shows when rows exist) | `work_claim:reject`. F-5 |
| app/src/screens/homework/HomeworkHomeScreen.tsx:60 (:149, :219) | `canVoid = homework:void` (switches delete vs void) | `homework:delete` |
| app/src/screens/homework/HomeworkHomeScreen.tsx:71 ← app/src/components/ClassSectionDashboard.tsx:59 | `isAdmin = roster:manage \|\| user.homeworkSupervisor` (school-wide class list) | `homework:view_all` (homework_supervisor stays a designation/scope) |
| app/src/screens/homework/HomeworkHomeScreen.tsx:166-167 (:365, :371) | `canReconcileHomework = isAdmin \|\| classTeacherId===me \|\| homeworkConfirmerId===me` | `homework:confirm_day` + designation (stays) |
| app/src/screens/homework/HomeworkHomeScreen.tsx:216 | `mine = isAdmin \|\| declaredBy === me` (edit/delete); server enforces no ownership | `homework:declare` (own, declaredBy) / `homework:edit_all` (others). F-9 |
| app/src/screens/homework/HomeworkReconcileScreen.tsx:45, :106-107 | `isAdmin = roster:manage \|\| homeworkSupervisor`; same canReconcile | `homework:confirm_day` + designation (stays); isAdmin list leg → `homework:view_all` |
| app/src/screens/homework/HomeworkReconcileScreen.tsx:81 | `homework:void` | `homework:delete` |
| app/src/screens/homework/HomeworkWorkspaceScreen.tsx:480 | `canRevertPrior = role P \|\| O` | `homework:undo_any` |
| app/src/screens/classnotes/MyClassNotesScreen.tsx:107 | `mayDeclare = isSection && can("tracker:write")` | `homework:declare` |
| app/src/components/AssignmentDeliverBlock.tsx:51 | `can("tracker:write")` | `assignment:declare` |
| app/src/screens/assignment/AssignmentHomeScreen.tsx:62 (:106, :167, :370, :430, :439, :448, :456) | `canTrackerRead` | `assignment:view` (workspace / roll-up chips); :167, :370 nil-declare → `assignment:declare` |
| app/src/screens/assignment/AssignmentHomeScreen.tsx:63 (:231, :433, :456) | `canSchedule = roster:manage` | `assignment:settings`; handout chip :456 → anyOf `assignment:view`, `assignment:settings` |
| app/src/screens/assignment/AssignmentHomeScreen.tsx:64 (:448) | `canGift = gift:manage` | `assignment_gift:view` |
| app/src/screens/assignment/AssignmentHomeScreen.tsx:65 (:436) | `isFollowUpAdmin = role P \|\| O` (chase chip) | `assignment:remind` |
| app/src/screens/assignment/AssignmentHomeScreen.tsx:112, :122, :131, :167, :370 | `role === "TEACHER"` → own cells plus class-teacher sections; edit only own | `assignment:view_all` (all rows) / `assignment:edit_all` (others' cells) / `assignment:confirm_week` + class_teacher designation |
| app/src/screens/assignment/AssignmentWorkspaceScreen.tsx:429 | `canRevertPrior = role P \|\| O` | `assignment:undo_any` |
| app/src/components/GiftHandoverCard.tsx | mounted by the gift:manage gates above | `assignment_gift:issue` |

App role checks (`role === "PRINCIPAL"/"OFFICE"/"TEACHER"`) are primary-role, while the server uses template-aware `isAdminStaff`; they disagree today for teachers who hold the OFFICE template.

## (g) Notification recipients chosen by role
Inventory A1 names none for homework, assignment or gift (a grep of `server/src/modules/trackers` and `server/src/modules/notifications/services` for `actingAsFilter` / `userIdsByRole` / `officeRecipients` finds none for these features). A2 names the work-claim digest:

| file:line | today | → holders of |
|---|---|---|
| server/src/modules/trackers/services/WorkClaimDigestService.ts:71 | digestRecipientIds = `User.find(actingAsFilter(["PRINCIPAL", "OFFICE"]))` + the Principal-named extras (:57) | holders of `work_claim:view_all` who also hold `admin_dashboard:view` (the waiver) + the digest_recipient designation list |

## (h) Build notes
- `homework:issue` covers ABSENT_REDELIVER → GIVEN and issueHomeworkItem only. Issuing the day happens through `homework:confirm_day` (and the overnight auto-issue, `system`).
- Delegations: `DELEGATED_ACTIONS` tags carry WHAT and WHERE today, and D-#592 folded return, resubmit, answer-file and edit/delete into them. With `return` and `resubmit` split out, `check_homework` must expand to `homework:check` + `homework:return`, `check_assignment` to `assignment:check` + `assignment:resubmit` + `assignment:return`, and `declare_assignment` to `assignment:declare` + `assignment:issue`, or existing delegates lose duties. `declare_homework` → `homework:declare`, `submit_homework` / `submit_assignment` → `*:mark_submitted`, `confirm_homework_day` → `homework:confirm_day`. Source: `legacy-expansion.md` (`DELEGATED_ACTION_PERMISSIONS`).
- Office defaults reproduce today's leaks past D-#554: `homework:undo_any` / `assignment:undo_any` O on (F-7), `assignment:confirm_week` O on (F-8). The verifier check "OFFICE holds no tracker:*" (`skills/_tools/verify_shared_vocab.mjs:749`, also :788, :791) needs rewording for the per-feature keys.
- Designation waivers (README flag legend): `assignment:confirm_week` is waived by `assignment:settings` (today's roster:manage leg; O on), and `assignment_gift:issue` by `assignment_gift:view_all` (today's isAdminStaff leg; O on).
- canWatchClaims: `work_claim:view_all` and `work_claim:remind` are DESIGNATION:digest_recipient, waived by `admin_dashboard:view` (today's isAdminStaff leg, template-aware). Open for the owner: fold the digest list into per-user grants and leave the digest as a notification subscription.
- reconciliationReport covers both features; any-of today. The payload could later be split per feature so each half follows its own view_reports.
- PII: homeworkWeeklyUnsubmitted and homeworkLifecyclePending (other teacher) return guardian phone numbers school-wide. The editor should warn when `homework:remind` or `homework:view_reports` is granted to TEACHER.
- homeworkIssueRoster is shared with assignment delivery; the any-of including `assignment:declare` keeps delivery working for an assignment-only teacher.
- recordHomeworkOutcome with NOT_SUBMITTED is a chase but stays under `homework:check` (or branch it to `homework:mark_submitted`, as transitionHomeworkRecord does).
- Asymmetry that stays: redeliverAssignmentRecord is tagged `declare_assignment` (delegates can redeliver); the homework GIVEN transition is untagged.
- Office keeps assignmentSchedule, expectedAssignmentsForWeek and assignmentHandoutBoard through `assignment:settings` (Office has no `assignment:view`; its `assignment:view_all` is inert).
- Two-hat (OFFICE-template) teachers: primary-role checks (`assertCanWrite`, `assertCanConfirmHomework`, assignmentSummary's `role === "TEACHER"`, setWorkClaimDigestRecipients) are unified by the permission checks, so behaviour shifts for them (`assignment:edit_all` 2H).
- Dead or unused server paths (issueHomeworkItem, markHomeworkRecordsDue, sweepAssignmentChases, studentDayLoad) still get a gate here; consider retiring them instead.
- Tests that pin today's gates: `giftRbac.test.ts`, `assignmentGift.test.ts`, `assignmentRevert.test.ts`, `homeworkOutcomeRbac.test.ts`, `delegatedExtent.test.ts`, plus the verifier checks above.
- The four `server/src/routes/files.ts` rows in (c) were not in inventory A1; they were added from a read of the live file.

Listed elsewhere: `server/src/modules/foundation/resolvers/classes.ts:305` assignHomeworkConfirmer and `:346` setHomeworkSupervisor (designation setters, `teaching_assignments:assign_homework_checker`) → foundation-platform.md. `server/src/modules/trackers/resolvers/studentProfile.ts:158` studentProfileHomework and `:181` studentProfileAssignment (`student_profile:view`) → trackers-classtest.md. A2 §6 `app/src/screens/home/TodayScreen.tsx:128, :569, :775` (ungated myWorkClaims / ResultEntryTargetCard, self-service) and `app/src/screens/admin/AccessControlEditScreen.tsx:69-73` (comment listing canWorkClaims, canReports) → trackers-classtest.md. A2's copies of the workClaim.ts, reconReport.ts and AppTabs.tsx:1762 rows are merged into this file; trackers-classtest.md only cross-references them. Out of the inventory: `server/src/modules/routine/resolvers/myDay.ts:156` myDay.assignmentHandout shares the handout board read (→ attendance-routine-library.md).
