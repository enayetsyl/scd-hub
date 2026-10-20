# Foundation & platform — build checklist

Features: `students`, `guardians`, `classes_sections`, `teaching_assignments`, `staff_logins`, `view_as`, `access_control`, `audit_log`, `system_health`, `guardian_engagement`, `message_templates`, `admin_dashboard`, `archive`, `notifications` (SELF), `my_account` (SELF) (owner rows: see README). The proxy-grant rows (`cover:assign_proxy`) also live here; the rest of the `cover` feature is in hr-finance.md. Source: inventory B, origin/dev 2026-10-20.
Counts: 58 mutations (46 in (a), 12 in (e)), 71 queries (48 in (b), 23 in (e)), 3 REST. The inventory's other 2 mutations, 2 queries and 1 SSE topic are listed elsewhere (see the end of this file).

## (a) Mutations
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| `server/src/modules/foundation/resolvers/auth.ts:147` | startImpersonation | authenticated; service re-reads `user:view_as` from the DB (ImpersonationService.ts:95); no second hop; target ≠ self/Principal/inactive (:338) | `view_as:open` (service DB re-read must read the new key; no-second-hop and target guards stay) |
| `server/src/modules/foundation/resolvers/classes.ts:122` | createAcademicYear | roster:manage | `classes_sections:settings` |
| `server/src/modules/foundation/resolvers/classes.ts:158` | setCurrentAcademicYear | roster:manage | `classes_sections:settings` |
| `server/src/modules/foundation/resolvers/classes.ts:217` | mergeSections | roster:manage | `classes_sections:merge_split` |
| `server/src/modules/foundation/resolvers/classes.ts:240` | splitSections | roster:manage | `classes_sections:merge_split` |
| `server/src/modules/foundation/resolvers/classes.ts:249` | createClass | roster:manage | `classes_sections:create` |
| `server/src/modules/foundation/resolvers/classes.ts:281` | assignClassTeacher | roster:manage; assignee must be primary-role TEACHER (ClassTeacherService.ts:17) | `teaching_assignments:assign_class_teacher` + assignee-is-TEACHER rule (stays) |
| `server/src/modules/foundation/resolvers/classes.ts:305` | assignHomeworkConfirmer | roster:manage; assignee TEACHER | `teaching_assignments:assign_homework_checker` + assignee-is-TEACHER rule (stays) |
| `server/src/modules/foundation/resolvers/classes.ts:346` | setHomeworkSupervisor | roster:manage; target TEACHER | `teaching_assignments:assign_homework_checker` + target-is-TEACHER rule (stays) |
| `server/src/modules/foundation/resolvers/classes.ts:361` | setSupportTeacher | roster:manage; assignee TEACHER | `teaching_assignments:assign_class_teacher` + assignee-is-TEACHER rule (stays) |
| `server/src/modules/foundation/resolvers/guardians.ts:33` | createGuardian | guardian:link | `guardians:create` |
| `server/src/modules/foundation/resolvers/guardians.ts:60` | linkGuardianToStudent | guardian:link | `guardians:link` |
| `server/src/modules/foundation/resolvers/guardians.ts:92` | unlinkGuardianFromStudent | guardian:link | `guardians:link` |
| `server/src/modules/foundation/resolvers/provisioning.ts:91` | provisionGuardianLogin | guardian:link | `guardians:reset_password` |
| `server/src/modules/foundation/resolvers/provisioning.ts:102` | resetGuardianPassword | guardian:link | `guardians:reset_password` |
| `server/src/modules/foundation/resolvers/provisioning.ts:124` | provisionStaffLogin | user:manage; role mapped from HR category (ProvisioningService.ts:70/269); resets an existing User on the same phone; no Principal-target guard | `staff_logins:create` (ESCALATION) + HR-category role mapping (stays) + target guard (F-4) |
| `server/src/modules/foundation/resolvers/provisioning.ts:135` | resetStaffPassword | user:manage; phone logins only; no target guard | `staff_logins:reset_password` (ESCALATION) + target guard (F-4) |
| `server/src/modules/foundation/resolvers/provisioning.ts:146` | resetUserPassword | user:manage; email logins only; no target guard (comment says "the Principal's own included") | `staff_logins:reset_password` (ESCALATION) + target guard (F-4) |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:158` | grantTeaching | user:manage | `teaching_assignments:assign_subject_teacher` (ESCALATION) |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:181` | revokeTeaching | user:manage | `teaching_assignments:assign_subject_teacher` (ESCALATION) |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:195` | grantSupervisory | user:manage | `teaching_assignments:assign_supervisor` (ESCALATION) |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:225` | revokeSupervisory | user:manage | `teaching_assignments:assign_supervisor` (ESCALATION) |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:259` | grantDelegation | access:manage (RESERVED) | `access_control:delegate` (LOCKED) |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:295` | revokeDelegation | access:manage (RESERVED) | `access_control:delegate` (LOCKED) |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:309` | assignProxy | user:manage | `cover:assign_proxy` (ESCALATION) |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:340` | revokeProxy | user:manage | `cover:assign_proxy` (ESCALATION) |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:354` | extendProxy | user:manage | `cover:assign_proxy` (ESCALATION) |
| `server/src/modules/foundation/resolvers/students.ts:139` | setStudentRollNumber | roster:manage | `students:edit` |
| `server/src/modules/foundation/resolvers/students.ts:157` | createStudent | roster:manage | `students:create` |
| `server/src/modules/foundation/resolvers/users.ts:126` | createUser | user:manage; `role` arg = any of ROLES incl. PRINCIPAL/GUARDIAN (:138) | `staff_logins:create` (ESCALATION) + PRINCIPAL/GUARDIAN role arg refused unless the caller is PRINCIPAL (F-3) |
| `server/src/modules/access-control/resolvers/accessControl.ts:52` | setUserAdditionalTemplates | access:manage (RESERVED); only TEACHER/OFFICE templates (AccessControlService.ts:155); GUARDIAN target refused (:74) | `access_control:edit` (LOCKED) + template and GUARDIAN-target invariants (stay) |
| `server/src/modules/access-control/resolvers/accessControl.ts:67` | addUserGrantedPermission | access:manage; reserved perms and guardian:read_child refused | `access_control:edit` (LOCKED) + reserved / guardian:read_child refusal (stays) |
| `server/src/modules/access-control/resolvers/accessControl.ts:82` | removeUserGrantedPermission | access:manage | `access_control:edit` (LOCKED) |
| `server/src/modules/access-control/resolvers/accessControl.ts:95` | addUserRevokedPermission | access:manage | `access_control:edit` (LOCKED) |
| `server/src/modules/access-control/resolvers/accessControl.ts:108` | removeUserRevokedPermission | access:manage | `access_control:edit` (LOCKED) |
| `server/src/modules/templates/resolvers/messageTemplates.ts:120` | editMessageTemplate | template:manage (RESERVED); placeholder validation | `message_templates:edit` (LOCKED) + placeholder validation (stays) |
| `server/src/modules/templates/resolvers/messageTemplates.ts:146` | resetMessageTemplate | template:manage (RESERVED) | `message_templates:edit` (LOCKED) |
| `server/src/modules/archive/resolvers/archive.ts:396` | fileScriptBundle | hasAnyPermission [tracker:write, roster:manage]; without roster:manage: CLASS_TEST only + assertAnchorWrite on the test's শাখা/group (:416-437); with roster:manage: any source + auto-acknowledged (:415, ArchiveService.ts:347) | `archive:create` + CLASS_TEST-only + assertAnchorWrite (stays); the desk path (any source + auto-ack) is for holders of `archive:approve` |
| `server/src/modules/archive/resolvers/archive.ts:453` | acknowledgeScriptBundle | roster:manage | `archive:approve` |
| `server/src/modules/archive/resolvers/archive.ts:466` | checkOutScriptBundle | roster:manage | `archive:lend` |
| `server/src/modules/archive/resolvers/archive.ts:492` | checkInScriptBundle | roster:manage | `archive:lend` |
| `server/src/modules/archive/resolvers/archive.ts:516` | disposeScriptBundle | roster:manage; retention window + state checked in service | `archive:delete` + retention window and state rule (stays) |
| `server/src/modules/archive/resolvers/archive.ts:538` | voidScriptBundle | roster:manage | `archive:void` |
| `server/src/modules/archive/resolvers/archive.ts:560` | createStorageBox | roster:manage | `archive:settings` |
| `server/src/modules/archive/resolvers/archive.ts:580` | updateStorageBox | roster:manage | `archive:settings` |
| `server/src/modules/archive/resolvers/archive.ts:604` | retireStorageBox | roster:manage | `archive:settings` |

## (b) Queries
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| `server/src/modules/foundation/resolvers/auth.ts:100` | impersonationTargets | authenticated; service requires user:view_as (DB re-read) | `view_as:open` (service DB re-read reads the new key) |
| `server/src/modules/foundation/resolvers/auth.ts:126` | impersonationTargetsPage | authenticated; same | `view_as:open` (service DB re-read reads the new key) |
| `server/src/modules/foundation/resolvers/classes.ts:78` | classes | authenticated | authenticated, no action (base reference read) |
| `server/src/modules/foundation/resolvers/classes.ts:92` | subjects | authenticated | authenticated, no action (base reference read) |
| `server/src/modules/foundation/resolvers/classes.ts:111` | academicYears | authenticated | authenticated, no action (base reference read) |
| `server/src/modules/foundation/resolvers/classes.ts:198` | activeSectionMerges | roster:manage | `classes_sections:merge_split` |
| `server/src/modules/foundation/resolvers/classes.ts:331` | homeworkSupervisors | roster:manage | `teaching_assignments:assign_homework_checker` |
| `server/src/modules/foundation/resolvers/classes.ts:398` | classTeacherHistory | roster:manage | `teaching_assignments:assign_class_teacher` |
| `server/src/modules/foundation/resolvers/guardians.ts:24` | guardians | guardian:link | `guardians:view_all` |
| `server/src/modules/foundation/resolvers/provisioning.ts:82` | guardianCredentialCandidates | guardian:link | `guardians:reset_password` |
| `server/src/modules/foundation/resolvers/provisioning.ts:115` | staffCredentialCandidates | user:manage | `staff_logins:view` |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:98` | proxyGrants | user:manage | `cover:assign_proxy` (ESCALATION) |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:120` | proxyGrantsPage | user:manage | `cover:assign_proxy` (ESCALATION) |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:136` | teachingGrants | user:manage | `teaching_assignments:assign_subject_teacher` |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:146` | supervisoryGrants | user:manage | `teaching_assignments:assign_supervisor` |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:247` | delegationGrants | access:manage (RESERVED) | `access_control:delegate` (LOCKED) |
| `server/src/modules/foundation/resolvers/students.ts:76` | studentsInSection | authenticated; no staff check, no assertCanRead; exposes phone, address, DOB and guardian phones | no editor action; staff-only + assertCanRead row scope on the শাখা (F-1) |
| `server/src/modules/foundation/resolvers/students.ts:129` | studentDirectory | roster:manage | `students:view_all` |
| `server/src/modules/foundation/resolvers/users.ts:103` | teachers | authenticated; none (a GUARDIAN token can read teacher email/phone) | no editor action; staff-only (F-2) |
| `server/src/modules/foundation/resolvers/users.ts:115` | users | user:manage | `staff_logins:view`; the name pickers that call it need a non-privileged staff-names read instead (F-25) |
| `server/src/modules/access-control/resolvers/accessControl.ts:125` | userEffectiveAccess | access:manage (RESERVED) | `access_control:edit` (LOCKED) |
| `server/src/modules/platform/resolvers/audit.ts:38` | auditLog | audit:read | `audit_log:view` |
| `server/src/modules/platform/resolvers/activity.ts:99` | activityPeople | audit:read | `audit_log:view_activity` |
| `server/src/modules/platform/resolvers/activity.ts:112` | activityPerson | audit:read | `audit_log:view_activity` |
| `server/src/modules/platform/resolvers/activity.ts:123` | personActivity | audit:read | `audit_log:view_activity` |
| `server/src/modules/platform/resolvers/activity.ts:157` | personActivityPage | audit:read | `audit_log:view_activity` |
| `server/src/modules/platform/resolvers/activity.ts:189` | personActivityDays | audit:read | `audit_log:view_activity` |
| `server/src/modules/platform/resolvers/activity.ts:206` | activityGroups | audit:read | `audit_log:view_activity` (static list; `audit_log:view` also fits) |
| `server/src/modules/platform/resolvers/activity.ts:220` | activitySources | audit:read | `audit_log:view_activity` (static list) |
| `server/src/modules/platform/resolvers/systemHealth.ts:207` | systemHealth | audit:read | `system_health:view` |
| `server/src/modules/templates/resolvers/messageTemplates.ts:76` | messageTemplates | template:manage (RESERVED) | `message_templates:view` (LOCKED) |
| `server/src/modules/templates/resolvers/messageTemplates.ts:85` | messageTemplate | template:manage | `message_templates:view` (LOCKED) |
| `server/src/modules/templates/resolvers/messageTemplates.ts:100` | messageTemplateHistory | template:manage | `message_templates:view` (LOCKED) |
| `server/src/modules/engagement/resolvers/guardianEngagement.ts:126` | guardianEngagement | audit:read | `guardian_engagement:view` |
| `server/src/modules/dashboard/resolvers/adminToday.ts:57` | adminToday | authenticated; assertDashboardAdmin = actsAsRole PRINCIPAL OR OFFICE (:18-25) | `admin_dashboard:view` as a declarative authScope; the cards inside keep their own gates |
| `server/src/modules/corpus/resolvers/analytics.ts:39` | recentEvents | content:read; returns [] (placeholder); firewall-bound | `lesson_plans:view` (or remove); must stay identity-free (ADR-005) |
| `server/src/modules/archive/resolvers/archive.ts:173` | storageBoxes | authenticated; assertStaffRead = isAdminStaff OR tracker:read (:61) | `archive:view` |
| `server/src/modules/archive/resolvers/archive.ts:186` | storageBox | authenticated; assertStaffRead | `archive:view` |
| `server/src/modules/archive/resolvers/archive.ts:200` | storageBoxBundles | authenticated; assertStaffRead | `archive:view` |
| `server/src/modules/archive/resolvers/archive.ts:213` | scriptBundle | authenticated; assertStaffRead | `archive:view` |
| `server/src/modules/archive/resolvers/archive.ts:229` | scriptBundleForTest | authenticated; assertStaffRead | `archive:view` |
| `server/src/modules/archive/resolvers/archive.ts:250` | scriptBundles | authenticated; assertStaffRead | `archive:view` |
| `server/src/modules/archive/resolvers/archive.ts:281` | openScriptCheckouts | authenticated; assertStaffRead | `archive:view` |
| `server/src/modules/archive/resolvers/archive.ts:294` | pendingScriptAcks | authenticated; assertStaffRead | `archive:view` (the ack itself is `archive:approve`) |
| `server/src/modules/archive/resolvers/archive.ts:308` | archiveLocationsForTests | authenticated; assertStaffRead | `archive:view` |
| `server/src/modules/archive/resolvers/archive.ts:326` | scriptBundlesPage | authenticated; assertStaffRead | `archive:view` |
| `server/src/modules/archive/resolvers/archive.ts:361` | disposableScriptBundlesPage | roster:manage | `archive:delete` |
| `server/src/modules/archive/resolvers/archive.ts:378` | disposableScriptBundles | roster:manage | `archive:delete` |

## (c) REST routes / SSE topics
| file:line | route / topic | today's gate | → new gate |
|---|---|---|---|
| `server/src/modules/archive/routes/archiveCoverPdf.ts:22` | GET /pdf/archive-cover/:bundleId | tracker:read OR roster:manage | `archive:view` |
| `server/src/routes/files.ts:434` | POST /files/archive (bundle photo) | tracker:write OR roster:manage | `archive:create` |
| `server/src/routes/files.ts:1172` | GET /files/:id, kind=archive_photo | tracker:read OR roster:manage | `archive:view` |

## (d) Hidden role / designation gates
| file:line | today | → replacement |
|---|---|---|
| `server/src/modules/dashboard/resolvers/adminToday.ts:18-25` | `assertDashboardAdmin` = actsAsRole P OR O (template-aware) | `admin_dashboard:view` as a declarative authScope |
| `server/src/modules/archive/resolvers/archive.ts:61-67` | `assertStaffRead` = isAdminStaff OR tracker:read (P, O, T) | `archive:view` |
| `server/src/modules/archive/resolvers/archive.ts:415` + `server/src/modules/archive/services/ArchiveService.ts:347` | `canManage = roster:manage` skips the শাখা scope and auto-acknowledges | holders of `archive:approve` get the desk path (any test + auto-ack); others `archive:create` + assertAnchorWrite (stays) |
| `server/src/modules/foundation/resolvers/users.ts:138` | createUser accepts any role incl. PRINCIPAL/GUARDIAN (user:manage, P) | `staff_logins:create`; PRINCIPAL/GUARDIAN role arg refused unless the caller is PRINCIPAL (F-3) |
| `server/src/modules/foundation/services/ProvisioningService.ts:265-288, 323, 359` | reset/provision has no target-role guard (user:manage, P) | refuse when the target is PRINCIPAL (or holds the P template) unless the caller is PRINCIPAL (F-4) |
| `server/src/modules/foundation/services/ProvisioningService.ts:70-80` | HR category → login role mapping (data rule) | stays (role is a data fact, not a choice) |
| `server/src/modules/foundation/services/ClassTeacherService.ts:17` | assignee `role !== "TEACHER"` → refused (primary role) | stays (data rule); see build notes on actsAs(TEACHER) |
| `server/src/modules/foundation/services/ImpersonationService.ts:95-104, :276, :338` | view-as permission re-read from the DB; Principal targets never eligible | gate becomes `view_as:open` (DB re-read reads it); Principal-target guard stays as an invariant |
| `server/src/modules/access-control/services/AccessControlService.ts:74, :155` | GUARDIAN target refused; only TEACHER/OFFICE templates | stays (editor invariants) |
| `server/src/modules/notifications/services/AnnouncementService.ts:41` | `role !== "GUARDIAN"` → null (audience rule) | stays (guardian plane) |
| `server/src/modules/notifications/resolvers/notifications.ts:25`; `server/src/modules/notifications/resolvers/webPush.ts:24` | GUARDIAN → guardianId owner | stays (SELF owner rule) |
| `server/src/middleware/authz.ts:96, :131` | `isAdminStaff` → unscoped read / all subjects (P, O template) | `<feature>:view_all` of the calling resolver's feature (each area file maps its own) |
| `server/src/middleware/authz.ts:202-203, :238-239` | assertCanWrite: PRINCIPAL bypass; OFFICE and GUARDIAN always refused | PRINCIPAL bypass → `<feature>:edit_all`; OFFICE passes only with scope or `<feature>:edit_all`; GUARDIAN refusal stays |
| `server/src/middleware/authz.ts:310-316` | assertCanConfirmHomework: PRINCIPAL, class teacher, delegate, homework supervisor | `homework:confirm_day` + designation class_teacher/homework_confirmer/homework_supervisor (stays), owned by trackers-homework-assignment.md; the designations are set by `teaching_assignments:assign_class_teacher` / `:assign_homework_checker`; PRINCIPAL keeps it (holds every action) |
| `Section.classTeacherId` / `supportTeacherIds` / `homeworkConfirmerId`; `User.homeworkSupervisor` | designations set via roster:manage | designations stay (WHO); only the assigning is gated: `teaching_assignments:assign_class_teacher` / `:assign_homework_checker` |
| `server/src/modules/engagement/resolvers/guardianView.ts:26` | uses guardian:read_child as "is a guardian" | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/platform/resolvers/systemHealth.ts:214`; `server/src/modules/engagement/resolvers/guardianEngagement.ts:134`; `server/src/modules/platform/resolvers/activity.ts` | `audit:read` reused as a generic Principal-only read for 4 features | split: `system_health:view`, `guardian_engagement:view`, `audit_log:view`, `audit_log:view_activity` |
| (cross-module) `roster:manage` | the "office desk" proxy in about 17 modules (139 server refs: printing, comments, class tests, vocab, english-drive, teaching-notes, worksheets, improvement, trackers, assessment, files routes) | each maps to its own feature action; here only `students:*`, `classes_sections:*`, `teaching_assignments:*`, `archive:*` |

## (e) Self-service, guardian and public paths (kept as-is)
| path | today | → |
|---|---|---|
| `server/src/modules/foundation/resolvers/auth.ts:26` staffLogin (m) | none; login throttle (LoginThrottleService) | public |
| `server/src/modules/foundation/resolvers/auth.ts:52` guardianLogin (m) | none; throttle | public |
| `server/src/modules/foundation/resolvers/auth.ts:40` refreshSession (m) | none; null without `ctx.auth`; a borrowed View-as token is never extended | `my_account:view` (SELF) |
| `server/src/modules/foundation/resolvers/auth.ts:170` endImpersonation (m) | authenticated; only with a borrowed token (`impersonatorId`) | `my_account:view` (SELF) |
| `server/src/modules/foundation/resolvers/users.ts:28` me (q) | authenticated; GUARDIAN branch maps own Guardian row | `my_account:view` (SELF) |
| `server/src/modules/foundation/resolvers/users.ts:57` myPermissions (q) | authenticated; own token | `my_account:view` (SELF); must return `feature:action` keys after migration |
| `server/src/modules/foundation/resolvers/users.ts:86` myTemplates (q) | authenticated; own token | `my_account:view` (SELF) |
| `server/src/modules/foundation/resolvers/scopeGrants.ts:76` myScopes (q) | authenticated; own grants, lapsed filtered | `my_account:view` (SELF) |
| `server/src/modules/foundation/resolvers/classes.ts:376` mySectionsAsClassTeacher (q) | authenticated; own rows | `my_account:view` (SELF) |
| `server/src/modules/notifications/resolvers/notifications.ts:83` myNotifications (q) | authenticated; own rows | `notifications:view` (SELF) |
| `server/src/modules/notifications/resolvers/notifications.ts:102` myNotificationsPage (q) | authenticated; own rows | `notifications:view` (SELF) |
| `server/src/modules/notifications/resolvers/notifications.ts:117` myNotification (q) | authenticated; own row | `notifications:view` (SELF) |
| `server/src/modules/notifications/resolvers/notifications.ts:128` myUnreadNotificationCount (q) | authenticated; own rows | `notifications:view` (SELF) |
| `server/src/modules/notifications/resolvers/notifications.ts:138` markNotificationRead (m) | authenticated; own row (`recipientOf`, :23) | `notifications:view` (SELF) |
| `server/src/modules/notifications/resolvers/notifications.ts:147` markNotificationsRead (m) | authenticated; own rows | `notifications:view` (SELF) |
| `server/src/modules/notifications/resolvers/notifications.ts:159` markAllNotificationsRead (m) | authenticated; own rows | `notifications:view` (SELF) |
| `server/src/modules/notifications/resolvers/webPush.ts:14` webPushPublicKey (q) | authenticated | `notifications:view` (SELF) |
| `server/src/modules/notifications/resolvers/webPush.ts:29` registerWebPush (m) | authenticated; owner from token; https endpoint | `notifications:view` (SELF) |
| `server/src/modules/notifications/resolvers/webPush.ts:65` unregisterWebPush (m) | authenticated; own row only | `notifications:view` (SELF) |
| `server/src/modules/notifications/resolvers/announcement.ts:31` myAnnouncement (q) | authenticated; service returns null unless role === GUARDIAN | GUARDIAN (guardian-only answer, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:283` myChildren (q) | guardian:read_child; own links | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:291` childRoutine (q) | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:306` childRoutineRange (q) | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:327` childClassNotes (q) | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:342` childClassNotesRange (q) | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:363` childHomework (q) | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:389` childHomeworkNilDays (q) | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:406` childDayLoad (q) | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:421` childAttendanceHistory (q) | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:437` childFeeDue (q) | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:451` childLeaveApplications (q) | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:467` submitChildLeaveApplication (m) | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:505` childUpcomingClassTests (q) | guardian:read_child + assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/guardian/resolvers/guardianPortal.ts:520` fileChildWorkClaim (m) | guardian:read_child + assertGuardianOfStudent; tracker ∈ HOMEWORK/ASSIGNMENT | GUARDIAN (guardian:read_child, unchanged) |
| `server/src/modules/engagement/resolvers/guardianView.ts:17` recordGuardianView (m) | guardian:read_child; guardian taken from token; surface allow-list | GUARDIAN (guardian:read_child, unchanged) |

## (f) App gates
| file:line | today | → new |
|---|---|---|
| `app/src/navigation/AppTabs.tsx:521` | `can("user:view_as")` (account menu row) | `view_as:open` |
| `app/src/navigation/AppTabs.tsx:645` | `role === "PRINCIPAL" OR role === "OFFICE"` (primary role, not template-aware) | `admin_dashboard:view` (F-28) |
| `app/src/navigation/AppTabs.tsx:1743` | `canAdmin = can("content:import") OR can("user:manage")` registers AdminTab | OR over every admin-hub action: `staff_logins:view`, `students:view_all`, `classes_sections:merge_split`, `classes_sections:settings`, `teaching_assignments:*`, `cover:assign_proxy`, `staff_records:view`, `guardians:reset_password`, `guardians:link`, `message_templates:view`, `access_control:edit`, `audit_log:view`, `audit_log:view_activity`, `system_health:view`, `guardian_engagement:view`, plus the content-import cards (`lesson_plans:import`, `question_bank:import`) (F-29) |
| `app/src/navigation/DrawerContent.tsx:246` | AdminTab item (follows the tab registration) | same OR as AppTabs.tsx:1743 (F-29) |
| `app/src/screens/admin/AdminHomeScreen.tsx:18` (cards :50, :57, :64, :71) | `user:manage` → Users / ScopeGrant / AssignSubjectTeacher / SupervisoryGrant | `staff_logins:view`; `cover:assign_proxy`; `teaching_assignments:assign_subject_teacher`; `teaching_assignments:assign_supervisor` |
| `app/src/screens/admin/AdminHomeScreen.tsx:19` (cards :78, :148, :162, :169) | `roster:manage` → Roster / AssignClassTeacher / SectionConfig / AcademicYear | `students:view_all`; `teaching_assignments:assign_class_teacher` OR `:assign_homework_checker`; `classes_sections:merge_split`; `classes_sections:settings` |
| `app/src/screens/admin/AdminHomeScreen.tsx:21` (card :141) | `staff:manage` → Staff | `staff_records:view` (feature owned by hr-finance.md) |
| `app/src/screens/admin/AdminHomeScreen.tsx:22` (card :176) | `guardian:link` → GuardianCredentials | `guardians:reset_password` OR `guardians:link` |
| `app/src/screens/admin/AdminHomeScreen.tsx:23` (card :184) | `template:manage` | `message_templates:view` (LOCKED) |
| `app/src/screens/admin/AdminHomeScreen.tsx:25` (card :191) | `access:manage` | `access_control:edit` (LOCKED) |
| `app/src/screens/admin/AdminHomeScreen.tsx:26` (cards :101, :111, :120, :130) | `audit:read` → AuditLog / PersonActivity / SystemHealth / GuardianEngagement | `audit_log:view`; `audit_log:view_activity`; `system_health:view`; `guardian_engagement:view` |
| `app/src/screens/admin/AdminHomeScreen.tsx:198` | "no permission" notice condition (misses audit/attendance) | recompute from the new admin-hub action set (F-29) |
| `app/src/screens/admin/UserListScreen.tsx:25` | `can("user:manage")` | `staff_logins:view` (list) / `staff_logins:create` (form) / `staff_logins:reset_password` |
| `app/src/screens/admin/ScopeGrantScreen.tsx:56` | `can("user:manage")` | `cover:assign_proxy` |
| `app/src/screens/admin/SupervisoryGrantScreen.tsx:39` | `can("user:manage")` | `teaching_assignments:assign_supervisor` |
| `app/src/screens/admin/StaffJoinScreen.tsx:108` | `can("user:manage")` (step 3 login) | `staff_logins:create` |
| `app/src/screens/hr/StaffHubScreen.tsx:780` / `:784` | `staff:manage` / `user:manage` (credentials) | `staff_records:view` / `staff_logins:create` + `staff_logins:reset_password` |
| `app/src/screens/hr/StaffPayEditScreen.tsx:95` | `staff:manage` (bank account) | `staff_records:edit` (hr-finance.md owns pay) |
| `app/src/screens/admin/AccessControlEditScreen.tsx:121, :127` | `role === "PRINCIPAL"` display checks | display only; no gate change (keep, or read templates) |
| `app/src/screens/admin/AuditLogScreen.tsx:25` | role → chip tone | cosmetic, no change |
| `app/src/screens/archive/ArchiveHomeScreen.tsx:72` | `can("roster:manage")` | `archive:settings` / `archive:approve` (per control) |
| `app/src/screens/archive/BundleDetailScreen.tsx:45` | `can("roster:manage")` | `archive:approve` / `archive:lend` / `archive:void` / `archive:delete` (per button) |
| `app/src/screens/archive/StorageBoxScreen.tsx:40` | `can("roster:manage")` | `archive:settings` |
| `app/src/screens/classtest/ClassTestDashboardScreen.tsx:118` | `canFile = can("roster:manage")` | `archive:create` (desk path = `archive:approve`) |
| `app/src/screens/assignment/AssignmentScheduleScreen.tsx:74`; `app/src/screens/assignment/AssignmentRollupsScreen.tsx:42` | comments: the `users` picker needs user:manage | a non-privileged staff-names read (no editor action), not `staff_logins:view` (F-25) |

## (g) Notification recipients chosen by role
The inventory names no role-routed notification recipient in this area. The one role-routed push it mentions is the SSE topic `print_queue` (routed by `roster:manage`), listed in hr-finance.md.

## (h) Build notes
- `myPermissions` must return the new `feature:action` keys (or both during migration). The app's `can()` reads it.
- ESCALATION actions (`staff_logins:create`, `staff_logins:reset_password`, `teaching_assignments:assign_subject_teacher`, `teaching_assignments:assign_supervisor`, `cover:assign_proxy`) mint logins or manufacture read/write scope. Today they are P-only via `user:manage`. The target guards (F-3, F-4) must land before any of them is switched on for T or O. Otherwise a holder could reset or mint a Principal login and take over the account.
- `provisionStaffLogin` also resets an existing login on the same phone. Provision and reset therefore share the F-4 target guard.
- Migration seam: `roster:manage` has 139 server refs across about 17 modules plus many app gates. `user:manage` is also read by routine (`sectionSubjectRoutineTeachers`). The legacy alias (old permission implies its derived actions) must cover both until every module is migrated. `REALTIME_TOPICS` and the REST routes call `callerHasPermission` directly, so they need the same seam, and the topic map must take a `feature:action`.
- `audit:read` gates four features today. They split into `audit_log:view`, `audit_log:view_activity`, `system_health:view` and `guardian_engagement:view`. `view_activity` also shows the Principal's own actions. Whether `audit_log:*` should be LOCKED is open (the README defaults are off for T and O, not LOCKED).
- `view_as:open`: ImpersonationService re-reads the permission from the DB (ImpersonationService.ts:95). That re-read must use the new key. Default off for T/O. The never-the-Principal target guard stays.
- `recentEvents` is a placeholder that returns `[]`. Map it to `lesson_plans:view` or delete it. Either way it must stay identity-free (ADR-005), and the firewall test must keep passing.
- Unwired API: `createStudent`, `setStudentRollNumber`, `createClass`, `createGuardian` and `guardians` have no app caller. Their switches are inert until a screen exists.
- `guardians:link` is security-relevant: a link decides which child's data a guardian's app shows.
- `classes_sections:settings` (current-year rollover affects the whole school) and `archive:delete` (paper is shredded after disposal) are candidates for P-only defaults. The README keeps O on to reproduce today.
- ClassTeacherService.ts:17 checks the primary role. Consider `actsAs(TEACHER)` so an OFFICE-primary person who also teaches can be a শ্রেণি শিক্ষক.
- `assertCanWrite` refuses OFFICE outright today (authz.ts:203). Under the conventions OFFICE passes only with scope or `<feature>:edit_all`. Without that change, an editor toggle for OFFICE on a tracker-write action would look granted but still 403.
- The homework supervisor flag lets its holder reconcile every শাখা (authz.ts:316 assertCanConfirmHomework). That is why `assign_homework_checker` is kept separate from `assign_class_teacher`.
- `pendingScriptAcks` reads under `archive:view`. The ack itself needs `archive:approve`.
- `announcements:publish` is not built. `myAnnouncement` is guardian-plane, and `GuardianAnnouncement` rows are written by script.
- An open question for hr-finance: should staff NID/bank fields get their own sensitive-read action instead of riding `staff_records:view` (F-24)?

Listed elsewhere: `server/src/modules/foundation/resolvers/staff.ts:79` staff, `:103` staffProfile, `:175` createStaffProfile, `:197` updateStaffProfile → hr-finance.md · SSE topic `print_queue` (`server/src/modules/realtime/bus.ts:19` + `server/src/routes/events.ts:44`, roster:manage) → hr-finance.md (printing) · `server/src/modules/routine/resolvers/routineSlots.ts:264` sectionSubjectRoutineTeachers (reads user:manage) → attendance-routine-library.md · `app/src/screens/admin/AdminHomeScreen.tsx:34` WorkClaimQueue card (`isRole(P) OR isRole(O)`) → `work_claim:view_all`, trackers-homework-assignment.md · `app/src/components/ClassSectionDashboard.tsx:59`, `app/src/screens/homework/HomeworkReconcileScreen.tsx:45` (`can("roster:manage") OR user.homeworkSupervisor`, reconcile any শাখা) → trackers-homework-assignment.md · cross-module `roster:manage` app gates (`app/src/navigation/AppTabs.tsx:1677, 1687, 1693, 1697, 1701, 1719, 1724, 1731`; `app/src/navigation/DrawerContent.tsx:96, 311, 339, 378, 437`; printing, classtest, comments, vocab, englishdrive, teachingnotes, worksheets, revision and home-card screens) → the area file of each owning feature (printing → hr-finance.md; classtest → trackers-classtest.md; comments, englishdrive, teachingnotes, worksheets → observation-comments-reports.md; vocab, revision → attendance-routine-library.md).
