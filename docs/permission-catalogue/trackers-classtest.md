# Class test, set tracker and student profile — build checklist

Features: `class_test`, `class_test_question`, `class_test_script`, `set_tracker`, `student_profile` (owner rows: see README). Cross-refs: `printing` (class-test print queue), `question_sets`, `work_claim`, `archive`. Source: inventory A2, origin/dev 2026-10-20.
Counts: 38 mutations, 43 queries (38 in (b), 5 guardian/self in (e)), 5 REST.

Shared helpers referenced below: `assertAnchorWrite` / `assertAnchorRead` (`server/src/modules/trackers/classTestAnchor.ts`), `assertCanWrite` / `assertCanRead` (`server/src/middleware/authz.ts`), `isAdminStaff` (`server/src/modules/foundation/services/RoleScope.ts:31`). In the new gates, "scope stays" means the anchor/scope check keeps deciding WHERE; its PRINCIPAL bypass becomes the feature's `edit_all`, and OFFICE passes only with scope or `edit_all`.

## (a) Mutations

### `server/src/modules/trackers/resolvers/classTest.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| classTest.ts:145 | createClassTestRequest | tracker:write; assertAnchorWrite (section or group; P bypass, O refused); service actorCanManage = roster:manage forces a teacher pick (D-#366) | `class_test:create` + assertAnchorWrite (scope stays; P bypass → `class_test:edit_all`); actorCanManage → `class_test:edit_all` (D-#366) |
| classTest.ts:219 | registerClassTestOfficial | authenticated; isAdminStaff → unscoped; else tracker:write + assertAnchorWrite | `class_test:register` + assertAnchorWrite (scope stays); unscoped / on-behalf pick (D-#366) → `class_test:edit_all` (2H) |
| classTest.ts:345 | markClassTestPrinted | roster:manage; assertPrintAdmin (roster:manage again) | `printing:process` |
| classTest.ts:358 | cancelClassTest | roster:manage; assertPrintAdmin | `printing:process` |
| classTest.ts:371 | retireClassTest | roster:manage; service refuses once results exist | `class_test:delete`; results-exist refusal (stays) |
| classTest.ts:390 | updateClassTestDetails | authenticated; roster:manage = any test; else tracker:write + own (ClassTestService.ts:713); state guards D-#277 | hasAnyPermission [`class_test:edit`, `class_test:edit_all`]; `edit` → own test (teacherId/requestedBy, stays); `edit_all` → any test; state guards D-#277 (stay) |
| classTest.ts:423 | restoreClassTest | roster:manage | `class_test:delete` |

### `server/src/modules/trackers/resolvers/classTestQuestion.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| classTestQuestion.ts:110 | createCtQuestionRequest | tracker:write; assertAnchorWrite (section) | `class_test_question:create` + assertAnchorWrite (scope stays; P bypass → `class_test:edit_all`) |
| classTestQuestion.ts:134 | sendCtQuestionForReview | authenticated; assertOffice = roster:manage | `class_test_question:prepare` |
| classTestQuestion.ts:158 | reviewCtQuestion | tracker:write; service requester only | `class_test_question:create` + requester only (stays) |
| classTestQuestion.ts:182 | requestCtQuestionPrint | tracker:write; assertAnchorWrite + requester only | `class_test_question:create` + assertAnchorWrite (scope stays) + requester only (stays) |
| classTestQuestion.ts:214 | editCtQuestionRequest | tracker:write; assertAnchorWrite + requester only + state | `class_test_question:create` + assertAnchorWrite (scope stays) + requester only + state (stay) |
| classTestQuestion.ts:248 | cancelCtQuestionRequest | tracker:write; requester only + before CONFIRMED | `class_test_question:create` + requester only + before CONFIRMED (stay) |
| classTestQuestion.ts:271 | deleteCtQuestionRequest | authenticated; assertOffice = roster:manage | `class_test_question:delete` |

### `server/src/modules/trackers/resolvers/classTestResult.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| classTestResult.ts:135 | enterClassTestResult | tracker:write; assertAnchorWrite(action `enter_classtest_result`) | `class_test:enter_results` + assertAnchorWrite(enter_classtest_result) (stays; P bypass → `class_test:edit_all`, 2H) |
| classTestResult.ts:313 | submitClassTestExam | tracker:write; assertWriteTest (anchor write, enter_classtest_result) | `class_test:enter_results` + assertWriteTest(enter_classtest_result) (stays) |
| classTestResult.ts:328 | recallClassTestExam | tracker:write; assertWriteTest | `class_test:enter_results` + assertWriteTest (stays) |
| classTestResult.ts:345 | publishClassTestExam | roster:manage; assertReadTest (admins: existence only) | `class_test:publish` + assertReadTest (`class_test:view_all` = existence only). F-18 |
| classTestResult.ts:360 | publishClassTestResult | roster:manage; assertReadTest | `class_test:publish` + assertReadTest. F-18 |
| classTestResult.ts:378 | sendBackClassTestExam | roster:manage; assertReadTest | `class_test:publish` + assertReadTest. F-18 |
| classTestResult.ts:394 | unpublishClassTestResult | roster:manage; assertReadTest | `class_test:revoke` + assertReadTest |
| classTestResult.ts:412 | unpublishClassTestExam | roster:manage; assertReadTest | `class_test:revoke` + assertReadTest |

### `server/src/modules/trackers/resolvers/classTestScripts.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| classTestScripts.ts:166 | receiveClassTestScripts | roster:manage | `class_test_script:scan` |
| classTestScripts.ts:176 | undoReceiveClassTestScripts | roster:manage; service only before tagging | `class_test_script:scan`; before-tagging rule (stays) |
| classTestScripts.ts:186 | waiveClassTestScripts | roster:manage | `class_test_script:scan` |
| classTestScripts.ts:196 | unwaiveClassTestScripts | roster:manage | `class_test_script:scan` |
| classTestScripts.ts:206 | attachClassTestScriptPages | roster:manage | `class_test_script:scan` |
| classTestScripts.ts:220 | removeClassTestScriptPage | roster:manage | `class_test_script:scan` |
| classTestScripts.ts:234 | setClassTestScriptMissing | roster:manage | `class_test_script:scan` |
| classTestScripts.ts:250 | publishClassTestScripts | roster:manage; needs UPLOAD_DONE | `class_test_script:publish`; UPLOAD_DONE (stays) |
| classTestScripts.ts:260 | unpublishClassTestScripts | roster:manage | `class_test_script:publish` |
| classTestScripts.ts:270 | handBackClassTestScripts | roster:manage; needs PUBLISHED | `class_test_script:hand_back`; PUBLISHED (stays) |
| classTestScripts.ts:284 | markClassTestScriptsReturned | hasAnyPermission [tracker:write, roster:manage]; not roster:manage → must be the accountable teacher | hasAnyPermission [`class_test_script:return`, `class_test_script:scan`]; `scan` → any test; `return` only → accountable teacher's own tests (stays) |

### Other resolver files
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/trackers/resolvers/resultEntryTarget.ts:93 | setResultEntryTarget | authenticated; primary `role !== "PRINCIPAL"` → refused | `class_test:settings` (PRINCIPAL-DEFAULT) |
| server/src/modules/trackers/resolvers/trackers.ts:193 | openTracker | tracker:write; assertCanWrite(section, set.subjectId) | `set_tracker:enter_results` + assertCanWrite (scope stays; P bypass → `set_tracker:edit_all`) |
| server/src/modules/trackers/resolvers/trackers.ts:219 | recordEntry | tracker:write; assertCanWrite | `set_tracker:enter_results` + assertCanWrite (scope stays; P bypass → `set_tracker:edit_all`) |
| server/src/modules/trackers/resolvers/trackers.ts:288 | recordEntries | tracker:write; assertCanWrite | `set_tracker:enter_results` + assertCanWrite (scope stays; P bypass → `set_tracker:edit_all`) |
| server/src/modules/trackers/resolvers/trackers.ts:328 | closeTracker | tracker:write; assertCanWrite | `set_tracker:enter_results` + assertCanWrite (scope stays; P bypass → `set_tracker:edit_all`) |

## (b) Queries

### `server/src/modules/trackers/resolvers/classTest.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| classTest.ts:284 | suggestClassTestNumber | tracker:write; assertAnchorWrite (OFFICE refused, even when registering on behalf) | `class_test:create` + assertAnchorWrite (scope stays; P bypass → `class_test:edit_all`) |
| classTest.ts:440 | classTestPrintQueue | roster:manage; assertPrintAdmin | `printing:view_all` |
| classTest.ts:452 | myClassTests | tracker:write; self (requestedBy) | `class_test:view`; self list (stays) |
| classTest.ts:468 | myClassTestsPage | tracker:write; self | `class_test:view`; self list (stays) |
| classTest.ts:481 | classTestsForSection | tracker:read; assertCanRead (classId from the section) | `class_test:view` (+ `class_test:view_all` lifts scope) |
| classTest.ts:504 | classTest | authenticated; assertStaffRead (isAdminStaff or tracker:read) + assertAnchorRead (admin bypass) | hasAnyPermission [`class_test:view`, `class_test:view_all`]; `view` → assertAnchorRead (stays); `view_all` → any test |

### `server/src/modules/trackers/resolvers/classTestQuestion.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| classTestQuestion.ts:294 | myCtQuestionRequests | tracker:write; self | `class_test_question:create`; self list (stays) |
| classTestQuestion.ts:306 | ctQuestionQueue | authenticated; assertOffice = roster:manage | `class_test_question:prepare` |
| classTestQuestion.ts:323 | myCtQuestionRequestsPage | tracker:write; self | `class_test_question:create`; self list (stays) |
| classTestQuestion.ts:336 | ctQuestionQueuePage | authenticated; assertOffice | `class_test_question:prepare` |
| classTestQuestion.ts:361 | ctQuestionCounts | authenticated; roster:manage = all; tracker:write = own; else zeros (never throws) | authenticated, never throws (stays); `class_test_question:prepare` → all; `class_test_question:create` → own; else zeros |

### `server/src/modules/trackers/resolvers/classTestResult.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| classTestResult.ts:175 | classTestStudentResult | tracker:read; assertReadTest (anchor read, admin bypass) | `class_test:view` (+ `class_test:view_all` lifts scope) + assertReadTest. F-18 |
| classTestResult.ts:212 | classTestRoster | tracker:read; assertReadTest | `class_test:view` (+ `class_test:view_all` lifts scope) + assertReadTest. F-18 |
| classTestResult.ts:229 | classTestResults | tracker:read; assertReadTest | `class_test:view` (+ `class_test:view_all` lifts scope) + assertReadTest. F-18 |
| classTestResult.ts:242 | classTestReportStatus | tracker:read; assertReadTest | `class_test:view` (+ `class_test:view_all` lifts scope) + assertReadTest. F-18 |

### `server/src/modules/trackers/resolvers/classTestScripts.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| classTestScripts.ts:121 | myClassTestScriptTasks | tracker:write; self (teacherId) | `class_test_script:return`; self (teacherId, stays) |
| classTestScripts.ts:132 | classTestScriptQueue | roster:manage | `class_test_script:scan` |
| classTestScripts.ts:141 | classTestScriptSheet | roster:manage | `class_test_script:scan` |
| classTestScripts.ts:151 | classTestScriptRow | hasAnyPermission [tracker:read, roster:manage]; no row scope | `class_test_script:view` (row scope to add; `scan` holders any). F-16 |

### `server/src/modules/trackers/resolvers/classTestSummary.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| classTestSummary.ts:180 | classTestReportsStatus | authenticated; assertReportRead (admin unscoped; else tracker:read + section read scope or self teacherId) | hasAnyPermission [`class_test:view`, `class_test:view_all`]; `view` → section scope or self (stays); `view_all` → no section / any |
| classTestSummary.ts:242 | classTestPrincipalDashboard | authenticated; assertDashboardAdmin = isAdminStaff | `class_test:view_all` |
| classTestSummary.ts:282 | classTestOverdueCounts | authenticated; admin = school-wide; tracker:read = own; else zeros (never throws) | authenticated, never throws (stays); `class_test:view_all` → school; `class_test:view` → own; else zeros |
| classTestSummary.ts:346 | classTestClassSubjectAnalysis | authenticated; assertReportRead(section) | hasAnyPermission [`class_test:view`, `class_test:view_all`]; `view` → section scope (stays); `view_all` → any |
| classTestSummary.ts:446 | classTestStudentProfile | authenticated; admin bypass; else assertReportRead(student's section) | hasAnyPermission [`class_test:view`, `class_test:view_all`]; `view` → student's section scope (stays); `view_all` → any |
| classTestSummary.ts:510 | classTestOverdueChase | message:dispatch; assertChaseAdmin = isAdminStaff AND message:dispatch | `class_test:remind` |

### `server/src/modules/trackers/resolvers/studentProfile.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| studentProfile.ts:158 | studentProfileHomework | authenticated; assertStudentProfileRead (tier 1 assertReportRead + tier 2 subject narrowing) | `student_profile:view` (+ `student_profile:view_all` lifts scope); tier 2 subject narrowing + designation class teacher / homework confirmer / homework supervisor (stays) |
| studentProfile.ts:181 | studentProfileAssignment | authenticated; same | `student_profile:view` (+ `student_profile:view_all` lifts scope); tier 2 narrowing + designation (stays) |
| studentProfile.ts:204 | studentProfileClassTest | authenticated; same | `student_profile:view` (+ `student_profile:view_all` lifts scope); tier 2 narrowing + designation (stays) |
| studentProfile.ts:395 | studentProfileHeader | authenticated; same | `student_profile:view` (+ `student_profile:view_all` lifts scope); tier 2 narrowing + designation (stays) |
| studentProfile.ts:411 | studentProfileAttendance | authenticated; tier 1 only (subject-free) | `student_profile:view` (+ `student_profile:view_all` lifts scope); tier 1 (stays) |
| studentProfile.ts:441 | studentProfileClassAttendance | authenticated; tier 1 only | `student_profile:view` (+ `student_profile:view_all` lifts scope); tier 1 (stays) |
| studentProfile.ts:460 | studentProfileComments | authenticated; tier 1 only | `student_profile:view` (+ `student_profile:view_all` lifts scope); tier 1 (stays) |

### Other resolver files
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/trackers/resolvers/trackers.ts:356 | tracker | tracker:read; assertCanRead | `set_tracker:view` + assertCanRead (scope stays; `set_tracker:view_all` lifts scope) |
| server/src/modules/trackers/resolvers/trackers.ts:379 | trackers | tracker:read; assertCanRead | `set_tracker:view` + assertCanRead (scope stays; `set_tracker:view_all` lifts scope) |
| server/src/modules/trackers/resolvers/trackers.ts:410 | trackersPage | tracker:read; assertCanRead | `set_tracker:view` + assertCanRead (scope stays; `set_tracker:view_all` lifts scope) |
| server/src/modules/trackers/resolvers/trackers.ts:445 | trackerSummary | tracker:read; assertCanRead | `set_tracker:view` + assertCanRead (scope stays; `set_tracker:view_all` lifts scope) |
| server/src/modules/trackers/resolvers/trackers.ts:470 | waLink | message:dispatch; pure link builder | `set_tracker:remind` |
| server/src/modules/trackers/resolvers/wholePicture.ts:96 | studentWholePicture | authenticated; admin bypass; else assertReportRead(student's section) | `student_profile:view` (+ `student_profile:view_all` lifts scope) |

## (c) REST routes / SSE topics
| file:line | route / topic | today's gate | → new gate |
|---|---|---|---|
| server/src/routes/files.ts:358 | POST /files/classtest | tracker:write OR roster:manage | hasAnyPermission [`class_test:create`, `class_test_question:prepare`] |
| server/src/routes/files.ts:559 | POST /files/ctscript | roster:manage | `class_test_script:scan` |
| server/src/modules/trackers/routes/studentProfilePdf.ts:35 | GET /pdf/student-profile/:studentId | assertStudentProfileRead (same as the hub) | `student_profile:export` + assertStudentProfileRead (scope stays; `student_profile:view_all` lifts it) |
| server/src/routes/files.ts:1151 → server/src/modules/trackers/services/ClassTestFileService.ts:25-47 | GET /files/:id (`classtest_question`) | roster:manage any; uploader; requester of a round's file | hasAnyPermission [`printing:process`, `class_test_question:prepare`] → any; else own (uploader / requester of the round's file, stays) |
| server/src/routes/files.ts:1168 → server/src/modules/trackers/services/ClassTestFileService.ts:60-86 | GET /files/:id (`classtest_script`) | roster:manage any; guardian when result and scripts published; tracker:read + anchor read | `class_test_script:scan` → any; `class_test_script:view` + assertAnchorRead (scope stays); guardian branch unchanged (GUARDIAN) |

## (d) Hidden role / designation gates
| file:line | today | → replacement |
|---|---|---|
| server/src/modules/trackers/classTestAnchor.ts:153-154, 167-168; server/src/middleware/authz.ts:202-203, 238-239 | primary `role === "PRINCIPAL"` passes; primary `role === "OFFICE"` always refused for writes (not template-aware) | PRINCIPAL branch → `class_test:edit_all` (assertAnchorWrite) / `set_tracker:edit_all` (assertCanWrite in trackers.ts); OFFICE hard refusal replaced: OFFICE passes only with scope or the feature's `edit_all` |
| server/src/modules/trackers/classTestAnchor.ts:100 (assertAnchorRead); server/src/middleware/authz.ts:96 (assertCanRead) | isAdminStaff bypasses row scope on reads | `class_test:view_all` (anchor read); `student_profile:view_all` (profile reads). set_tracker has no `view_all` in README, see (h) |
| server/src/modules/trackers/resolvers/classTest.ts:56-61 (assertPrintAdmin) | roster:manage stands in for "print admin" | `printing:process` (printed/cancel); `printing:view_all` (queue) |
| server/src/modules/trackers/resolvers/classTest.ts:64-70 (assertStaffRead) | isAdminStaff, or tracker:read | `class_test:view` / `class_test:view_all` |
| server/src/modules/trackers/resolvers/classTest.ts:248-261 | isAdminStaff skips tracker:write AND scope for registerClassTestOfficial | `class_test:edit_all` (unscoped register; 2H) |
| server/src/modules/trackers/resolvers/classTest.ts:210, 278 → server/src/modules/trackers/services/ClassTestService.ts:469 | actorCanManage = roster:manage: a manager must pick the teacher (D-#366) | `class_test:edit_all` |
| server/src/modules/trackers/resolvers/classTest.ts:408 → server/src/modules/trackers/services/ClassTestService.ts:713 | roster:manage = edit any test; else own | `class_test:edit_all` = any test; `class_test:edit` = own (stays) |
| server/src/modules/trackers/resolvers/classTestQuestion.ts:41-46 (assertOffice) | roster:manage | `class_test_question:prepare` (send, queue) / `class_test_question:delete` (delete) |
| server/src/modules/trackers/resolvers/classTestQuestion.ts:371-374 | roster:manage → counts for everyone | `class_test_question:prepare` |
| server/src/modules/trackers/resolvers/classTestSummary.ts:62-77 (assertReportRead) | isAdminStaff unscoped; GUARDIAN check is `role ===` | `class_test:view_all` (unscoped) / `class_test:view` (scoped); GUARDIAN check stays (guardian plane) |
| server/src/modules/trackers/resolvers/classTestSummary.ts:80-85 (assertDashboardAdmin) | isAdminStaff | `class_test:view_all` |
| server/src/modules/trackers/resolvers/classTestSummary.ts:88-93 (assertChaseAdmin) | isAdminStaff AND message:dispatch | `class_test:remind` |
| server/src/modules/trackers/resolvers/classTestSummary.ts:299-311 | admin → school counts; else own; `role === "GUARDIAN"` → zeros | `class_test:view_all` → school; `class_test:view` → own; GUARDIAN → zeros (stays) |
| server/src/modules/trackers/resolvers/classTestSummary.ts:455; server/src/modules/trackers/resolvers/wholePicture.ts:107 | isAdminStaff bypass | `class_test:view_all` (classTestStudentProfile); `student_profile:view_all` (studentWholePicture) |
| server/src/modules/trackers/resolvers/classTestScripts.ts:294-297 | roster:manage → any test, else accountable teacher | `class_test_script:scan` → any test; `class_test_script:return` → accountable teacher (stays) |
| server/src/modules/trackers/resolvers/studentProfile.ts:70-72 → server/src/middleware/authz.ts allowedSubjectCodesForSection(classTeacherOversight) | class teacher, homework delegate, homework supervisor and supervisory scopes get the full view | `student_profile:view` + designation class teacher / homework confirmer / homework supervisor / supervisory scope (stays; tier 2) |
| server/src/modules/trackers/resolvers/resultEntryTarget.ts:108 | primary `role !== "PRINCIPAL"` | `class_test:settings` (PRINCIPAL-DEFAULT) |
| server/src/modules/trackers/services/ClassTestFileService.ts:31, 62, 65 | roster:manage reads every paper and script; `role === "GUARDIAN"` branch | papers: hasAnyPermission [`printing:process`, `class_test_question:prepare`] = any; scripts: `class_test_script:scan` = any; guardian branch stays |
| server/src/routes/files.ts:361-367 | tracker:write OR roster:manage for the paper upload | hasAnyPermission [`class_test:create`, `class_test_question:prepare`] |

## (e) Self-service, guardian and public paths (kept as-is)
| path | today | → |
|---|---|---|
| server/src/modules/trackers/resolvers/classTestGuardian.ts:73 childTestResults | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| server/src/modules/trackers/resolvers/classTestGuardian.ts:95 childTestResultsPage | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| server/src/modules/trackers/resolvers/classTestGuardian.ts:132 childTestResultStats | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| server/src/modules/trackers/resolvers/wholePicture.ts:119 childTrajectory | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| server/src/modules/trackers/resolvers/resultEntryTarget.ts:83 myResultEntryTarget | authenticated; own target or null | SELF (no action) |
| ctQuestionCounts, classTestOverdueCounts (drawer badges) | authenticated; zeros instead of throwing | never throw (stays); the "who sees all" branch reads `class_test_question:prepare` / `class_test:view_all` (rows in (b)) |
| myClassTests(Page), myCtQuestionRequests(Page), myClassTestScriptTasks | self lists, behind tracker:write today | stay self-scoped; gated on `class_test:view` / `class_test_question:create` / `class_test_script:return` (rows in (b)) |

## (f) App gates
| file:line | today | → new |
|---|---|---|
| app/src/navigation/AppTabs.tsx:1697 | canClassTest = tracker:read OR roster:manage | hasAnyPermission [`class_test:view`, `class_test:view_all`, `class_test:create`, `class_test:register`, `class_test_question:create`, `class_test_question:prepare`, `class_test_script:view`, `printing:view_all`] |
| app/src/navigation/AppTabs.tsx:1671 | canSets = set:read | `question_sets:view` |
| app/src/navigation/AppTabs.tsx:1672 | canTrackers = tracker:read (generic tracker tab) | `set_tracker:view` |
| app/src/navigation/AppTabs.tsx:1762 | canReports = isRole P or O (reconciliation report hub) | hasAnyPermission [`homework:view_reports`, `assignment:view_reports`]. F-30 |
| app/src/navigation/DrawerContent.tsx:339 | canClassTestBadge = roster:manage OR tracker:write | hasAnyPermission [`class_test_question:create`, `class_test_question:prepare`] |
| app/src/navigation/DrawerContent.tsx:360 | canCtOverdueBadge = role !== GUARDIAN | hasAnyPermission [`class_test:view`, `class_test:view_all`] |
| app/src/navigation/DrawerContent.tsx:378 | roster:manage chooses overdue vs awaitingSubmit | `class_test:view_all` |
| app/src/screens/classtest/ClassTestHomeScreen.tsx:43 | canWrite = tracker:write | `class_test:create` |
| app/src/screens/classtest/ClassTestHomeScreen.tsx:44 | canPrint = roster:manage | `printing:view_all` |
| app/src/screens/classtest/ClassTestHomeScreen.tsx:47 (used :60, :123, :142) | isAdmin = isRole P or O (dashboard button, overdue counts, request button) | dashboard / overdue counts → `class_test:view_all`; :123 request button → hasAnyPermission [`class_test:create`, `class_test:register`] |
| app/src/screens/classtest/ClassTestDashboardScreen.tsx:118 | canFile = roster:manage (script archive filing) | `archive:create` (desk path = `archive:approve`) |
| app/src/screens/classtest/ClassTestPublishScreen.tsx:41 (used :51, :158, :178, :200, :207, :239) | isAdmin = roster:manage | :158/:178/:200/:207 → `class_test:publish`; :239 → `class_test:revoke`; :51 teacher leg → `class_test:enter_results` |
| app/src/screens/classtest/ClassTestResultsScreen.tsx:43 (used :70, :230, :285, :347, :381, :419) | isAdmin = roster:manage | :70 → `class_test:edit_all` (own test = `class_test:edit`); :285 → `class_test:publish`; admin panels (:230, :347, :381, :419) → `class_test:publish` / `class_test:view_all` |
| app/src/screens/classtest/ClassTestResultsScreen.tsx:378 | tracker:read (error text vs "teacher only") | `class_test:view`. F-18 |
| app/src/screens/home/TodayScreen.tsx:136-137 | canClassTest | as AppTabs.tsx:1697 |
| app/src/screens/home/TodayScreen.tsx:140 | canSets = set:read (recent sets) | `question_sets:view` |
| app/src/screens/home/TodayScreen.tsx:141 | canTrackers = tracker:read (also the HW/AS lifecycle cards) | `set_tracker:view`; the HW/AS lifecycle cards follow `homework:view` / `assignment:view` (trackers-homework-assignment.md) |
| app/src/screens/home/TodayScreen.tsx:171 | canFileTests = tracker:write (pending-results card) | `class_test:enter_results` |
| app/src/screens/home/TodayScreen.tsx:544 | CtScriptTeacherCard if tracker:write | `class_test_script:return` |
| app/src/screens/home/TodayScreen.tsx:547; app/src/screens/home/AdminTodayScreen.tsx:214 | CtScriptOfficeCard if roster:manage | `class_test_script:scan` |
| app/src/screens/home/TodayScreen.tsx:128, 569, 775 | myWorkClaims / ResultEntryTargetCard, ungated | SELF, unchanged (`work_claim:view_own`; result-entry target SELF) |
| app/src/screens/admin/AdminHomeScreen.tsx:34 | canWorkClaims = isRole P or O (a digest-recipient teacher can't see this card today) | `work_claim:view_all` |
| app/src/screens/admin/WorkClaimQueueScreen.tsx:194 | role === "PRINCIPAL" (digest editor) | `work_claim:settings` |
| app/src/components/WorkClaimTeacherCard.tsx (reject sheet) | no gate (shows only when rows exist) | `work_claim:reject`. F-5 |
| app/src/screens/admin/AccessControlEditScreen.tsx:69-73 | comment listing role-gated surfaces (canWorkClaims, canReports) | update the comment when those role gates become actions |

## (g) Notification recipients chosen by role
The inventory names these without lines (its Q7). Lines located in origin/dev:

| file:line | today | → holders of |
|---|---|---|
| server/src/modules/notifications/services/emitters.ts:1374 (emitCtQuestionOffice) | actingAsFilter P/O: new request / changes requested / confirmed | `class_test_question:prepare` |
| server/src/modules/notifications/services/emitters.ts:1410 (emitCtResultSubmitted) | actingAsFilter P/O: a teacher submitted results for approval | `class_test:publish` |
| server/src/modules/notifications/services/SchedulerService.ts:649 (class-test overdue digest, CT_OVERDUE_DIGEST_ROLES) | actingAsFilter Office + Principal, 08:00 FULL days | `class_test:remind` |

The work-claim digest recipients (`server/src/modules/trackers/services/WorkClaimDigestService.ts:71`) are listed in trackers-homework-assignment.md.

## (h) Build notes
- `roster:manage` is overloaded here: print admin, approver, script desk, question-paper office, retire/restore and "edit any". Each holder needs the specific action (`printing:view_all` / `printing:process`, `class_test:publish` / `revoke` / `delete` / `edit_all`, `class_test_script:scan` / `publish` / `hand_back`, `class_test_question:prepare` / `delete`), not a rename.
- 2H: `class_test:edit_all` (O on) replaces both the template-aware `isAdminStaff` register/edit-any bypass and the primary-role PRINCIPAL anchor bypass. A two-hat teacher today edits any test but enters results only in scope; after the change `edit_all` also lifts the anchor scope for `enter_results`. Include one two-hat login in the `/verify` drive.
- The delegated-action tag `enter_classtest_result` (ACS-3) must map to `class_test:enter_results` in `DELEGATED_ACTION_PERMISSIONS` so delegation keeps working.
- `suggestClassTestNumber` gates on `class_test:create` only, so Office still gets no number suggestion when registering on behalf (today's behaviour). Widening it to `register` is an owner call.
- Open: should `class_test:publish` imply read access to the marks of the test under approval (Office approves results it is refused by `tracker:read` today)? See F-18.
- `class_test_script:return` vs `scan`: return-only holders act on the accountable teacher's own tests; `scan` holders act on any test. `classTestScriptRow` needs a row scope (F-16).
- `set_tracker:view_all` (O on †) is the home for the `isAdminStaff` read lift in `assertCanRead` on the tracker reads. It is inert for pure Office (no `set_tracker:view`) and keeps a two-hat teacher's unscoped read. Open: retire the legacy J4 tracker instead.
- `register` stays distinct from `create` (it skips the office print). Whether the legacy `set_tracker` (J4) is still live, or should be retired rather than given actions, is an owner call.
- `tracker:export` is not used anywhere (dead). `set:export` is handled in content-questions-exams.md (F-19).
- `setResultEntryTarget` used a primary-role check. As `class_test:settings` it becomes template-aware (consistent with D-#467).
- Many resolvers here are `authenticated` with the real gate in the body (classTest, classTestReportsStatus, dashboard, analysis, studentProfile*, studentWholePicture, register, updateDetails, send/delete question, setResultEntryTarget). Each gets the explicit action above; the hand-rolled body gates are the rows in (d).
- Notification recipients in (g) are chosen by role today; after the split they follow the action holders.

Listed elsewhere:
- trackers-homework-assignment.md: `server/src/modules/trackers/resolvers/workClaim.ts` rows (mutations rejectWorkClaim :292, nudgeWorkClaim :323, setWorkClaimDigestRecipients :424; queries myWorkClaims :241, workClaimQueue :262, workClaimDigestRecipients :410); `server/src/modules/trackers/resolvers/reconReport.ts:159` reconciliationReport; hidden gates `reconReport.ts:27-35` (actsAsRole P/O), `workClaim.ts:274, 335, 418` → `server/src/modules/trackers/services/WorkClaimDigestService.ts:88-92` (canWatchClaims), `workClaim.ts:434` (`role !== "PRINCIPAL"`); self path myWorkClaims (D-#535).
- content-questions-exams.md: `server/src/modules/assessment/resolvers/assessment.ts` rows (mutations createSet :173, createSetWithQuestions :209, addQuestionToSet :258, renameSet :291, removeQuestionFromSet :319, assembleSet :347; queries assessmentSet :382, assessmentSets :419, assessmentSetsPage :446, myRecentSets :498, questionUsageCounts :547, questionUsage :565); REST `server/src/modules/assessment/routes/setPdf.ts:42,50` GET /pdf/set/:id; hidden gate `setPdf.ts:42-48` mayRenderSet. The inventory's `question_set` feature is the README's `question_sets` (`create`, owned by content-questions-exams).
