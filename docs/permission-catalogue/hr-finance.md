# HR, finance, work board & printing — build checklist

Features: `staff_records`, `hr_policy`, `leave`, `cover` (leave-cover half), `payroll`, `salary_advance`, `appraisal`, `conduct`, `grievance`, `staff_letters`, `offboarding`, `finance_ledger`, `finance_reports`, `budget`, `fee_support`, `qard`, `reconciliation`, `work_board`, `printing` (owner rows: see README). Source: inventory C, origin/dev 2026-10-20.
Counts: 63 mutations, 89 queries, 5 REST/SSE. (Inventory C's 61 + 87 + 4, plus the deduped `foundation/resolvers/staff.ts` rows (2 mutations, 2 queries) and the SSE `print_queue` topic.)

Today's holders (from `shared/vocab.ts` ROLE_PERMISSIONS): `staff:manage`, `leave:manage`, `payroll:manage`, `performance:manage`, `attendance:manage`, `finance:manage`, `tasks:assign`, `roster:manage` = P + O. `payroll:approve`, `performance:signoff` = P only (RESERVED, `shared/vocab.ts:4221`). `tracker:write` = P + T (not O). `user:manage` = P. No resolver in this area uses `role === "PRINCIPAL"`, `isPrincipalStaff`, `isAdminStaff` or `actsAs` as a Principal gate. Every Principal-only power rides a RESERVED permission and maps to a LOCKED action. The hidden role gates are about the office desk and who gets notified.

## (a) Mutations

### `server/src/modules/hr/resolvers/staffLeave.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| staffLeave.ts:171 | upsertStaffLeaveEntitlement | leave:manage | `leave:settings` |
| staffLeave.ts:209 | applyForStaffLeave | authenticated; own StaffProfile via staffMatch; another `staffProfileId` needs leave:manage (:232) | `leave:apply` (SELF, own StaffProfile via staffMatch, stays) + in-resolver `assertHasPermission(leave:create)` when `staffProfileId` is another person |
| staffLeave.ts:253 | decideStaffLeave | authenticated; approve/reject need leave:manage (:271); cancel = own-row OR leave:manage (:274-278) | `hasAnyPermission(leave:approve, leave:apply)` + per-branch assert: approve/reject → `leave:approve`; cancel own → `leave:apply` (SELF, own-row stays); cancel another's → `leave:approve` |
| staffLeave.ts:285 | proposeStaffCover | authenticated; leave:manage OR own leave's applicant (:297-301) | `cover:propose` (SELF, own leave's applicant, stays) + in-resolver `assertHasPermission(cover:approve)` on another person's leave |
| staffLeave.ts:308 | decideStaffCoverSlot | leave:manage; approval mints a 1-day proxy ScopeGrant (CoverService) | `cover:approve` + proxy mint in `server/src/modules/hr/services/CoverService.ts` (stays) |

### `server/src/modules/hr/resolvers/payroll.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| payroll.ts:300 | setStaffPay | payroll:manage | `payroll:edit` |
| payroll.ts:366 | preparePayrollRun | payroll:manage | `payroll:prepare` |
| payroll.ts:401 | approvePayrollRun | payroll:approve (RESERVED) | `payroll:approve` (LOCKED) |
| payroll.ts:411 | cancelPayrollRun | payroll:manage; service: prepared runs only | `payroll:prepare` + prepared-runs-only rule (stays) |
| payroll.ts:425 | issueStaffAdvance | payroll:approve (RESERVED) | `salary_advance:issue` (LOCKED) |
| payroll.ts:451 | settleStaffAdvance | payroll:approve (RESERVED) | `salary_advance:settle` (LOCKED) |

### `server/src/modules/hr/resolvers/performance.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| performance.ts:177 | submitObservation | authenticated; performance:manage OR `userCanObserve` supervisory ScopeGrant extent (:195-202, `server/src/modules/hr/services/observationScope.ts`) | `appraisal:observe` (anyone) OR supervisory ScopeGrant row-scope via `userCanObserve` (stays) |
| performance.ts:278 | upsertAppraisal | performance:manage | `appraisal:prepare` |
| performance.ts:307 | signOffAppraisal | performance:signoff (RESERVED) | `appraisal:sign_off` (LOCKED) |
| performance.ts:358 | recordConductStep | performance:manage; ladder order in ConductService | `conduct:create` + ladder order (stays) |
| performance.ts:392 | recordConductHearing | performance:manage | `conduct:record_hearing` |
| performance.ts:413 | finalizeConductStep | performance:signoff (RESERVED); hearing required (service); termination writes employmentStatus | `conduct:sign_off` (LOCKED) + hearing-required rule (stays) |
| performance.ts:465 | raiseGrievance | authenticated; own StaffProfile via staffMatch | `grievance:raise` (SELF, never revocable) |
| performance.ts:492 | updateGrievance | performance:manage | `grievance:resolve` |
| performance.ts:543 | addDevelopmentLog | performance:manage | `appraisal:log_cpd` |

### `server/src/modules/hr/resolvers/offboarding.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| offboarding.ts:113 | initiateOffboarding | staff:manage | `offboarding:create` |
| offboarding.ts:138 | addOffboardingClearanceItem | staff:manage | `offboarding:edit` |
| offboarding.ts:153 | updateOffboardingClearanceItem | staff:manage | `offboarding:edit` |
| offboarding.ts:175 | revokeOffboardingAccess | staff:manage; last-working-day gate (service) | `offboarding:revoke` + last-working-day gate (stays) |
| offboarding.ts:189 | computeFinalSettlement | payroll:manage; held until clearance | `offboarding:prepare` + held-until-clearance (stays) |
| offboarding.ts:220 | releaseFinalSettlement | payroll:approve (RESERVED); clearance must be complete (service) | `offboarding:settle` (LOCKED) + clearance-complete rule (stays) |
| offboarding.ts:233 | recordExitInterview | staff:manage | `offboarding:edit` |
| offboarding.ts:248 | issueServiceCertificate | staff:manage | `offboarding:issue` |
| offboarding.ts:259 | cancelOffboarding | staff:manage; only before access is revoked (service) | `offboarding:cancel` + before-revoke rule (stays) |

### `server/src/modules/hr/resolvers/staffHub.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| staffHub.ts:477 | setHrPolicy | payroll:manage; redundant inline `require_(payroll:manage)` (:507) | `hr_policy:settings` (drop the inline duplicate) |
| staffHub.ts:576 | issueStaffLetter | staff:manage; redundant inline `require_(staff:manage)` (:595) | `staff_letters:issue` (drop the inline duplicate) |
| staffHub.ts:625 | voidStaffLetter | staff:manage; inline require_ (:637) | `staff_letters:void` (drop the inline duplicate) |
| staffHub.ts:643 | confirmStaffEmployment | staff:manage; inline require_ (:658); settles probation debt (pool → salary); `issueLetter` defaults true | `staff_records:confirm` (+ `staff_letters:issue` when `issueLetter=true`: open, see (h)) |

### `server/src/modules/foundation/resolvers/staff.ts` (deduped here)
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| staff.ts:175 | createStaffProfile | staff:manage | `staff_records:create` |
| staff.ts:197 | updateStaffProfile | staff:manage | `staff_records:edit` · F-23 |

### `server/src/modules/finance/resolvers/*`
The only gate is `finance:manage`. `actor.role` reaches the services only as the audit `actorRole`, never as a gate.

| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/finance/resolvers/budget.ts:126 | setBudgetLine | finance:manage | `budget:edit` |
| server/src/modules/finance/resolvers/feeSupport.ts:127 | createFeeProvider | finance:manage | `fee_support:edit` |
| server/src/modules/finance/resolvers/feeSupport.ts:142 | setFeeSupportAllocation | finance:manage | `fee_support:edit` |
| server/src/modules/finance/resolvers/feeSupport.ts:174 | recordProviderReceipt | finance:manage | `fee_support:create` |
| server/src/modules/finance/resolvers/feeSupport.ts:191 | chaseFeeDue | finance:manage; messages the guardian (wa.me + push) | `finance_ledger:remind` |
| server/src/modules/finance/resolvers/financeLedger.ts:70 | setLedgerOpeningBalance | finance:manage | `finance_ledger:settings` |
| server/src/modules/finance/resolvers/financePosting.ts:144 | recordFinancePosting | finance:manage | `finance_ledger:create` |
| server/src/modules/finance/resolvers/financePosting.ts:187 | reverseFinancePosting | finance:manage | `finance_ledger:reverse` |
| server/src/modules/finance/resolvers/qardIou.ts:97 | setFinanceParty | finance:manage | `qard:edit` |
| server/src/modules/finance/resolvers/qardIou.ts:114 | recordQardIouEntry | finance:manage | `qard:create` |
| server/src/modules/finance/resolvers/reconciliation.ts:64 | recordReconciliation | finance:manage | `reconciliation:create` |

### `server/src/modules/workboard/resolvers/workBoard.ts`
All are `authenticated` today. The real gate sits in the services under `server/src/modules/workboard/services/`.

| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| workBoard.ts:491 | createTask | authenticated; self OK; another assignee needs tasks:assign (TaskService.ts:105) | `work_board:use` (SELF) + in-service `work_board:assign` for another assignee |
| workBoard.ts:508 | updateTask | authenticated; assigner OR tasks:assign (TaskService.ts:90-92) | `work_board:use` (assigner own-row, stays) OR `work_board:assign` |
| workBoard.ts:525 | setTaskStatus | authenticated; assignee, assigner OR tasks:assign (TaskService.ts:95-98) | `work_board:use` (assignee/assigner own-row, stays) OR `work_board:assign` |
| workBoard.ts:535 | setTaskBlocked | authenticated; same as setTaskStatus | `work_board:use` (assignee/assigner own-row, stays) OR `work_board:assign` |
| workBoard.ts:545 | reassignTask | authenticated; assigner OR tasks:assign (TaskService.ts:221); the new assignee is not checked | `work_board:use` (assigner own-row, stays) OR `work_board:assign`; handing to another person needs `work_board:assign` · F-6 |
| workBoard.ts:555 | moveTask | authenticated; slot: assignee; day: assigner OR tasks:assign (TaskService.ts:244-257) | `hasAnyPermission(work_board:use, work_board:assign)` + per-branch: slot → assignee own-row (stays); day → assigner own-row (stays) OR `work_board:assign` |
| workBoard.ts:570 | cancelTask | authenticated; assigner OR tasks:assign (TaskService.ts:275) | `work_board:use` (assigner own-row, stays) OR `work_board:assign` |
| workBoard.ts:580 | pullWorkCard | authenticated; `canPullAtAll` = role P/O, P/O template, OR tasks:assign (OfficeCoverService.ts:102-106) | `work_board:cover_desk` |
| workBoard.ts:591 | releaseWorkCard | authenticated; the puller OR tasks:assign (OfficeCoverService.ts:147) | `work_board:use` (puller own-row, stays) OR `work_board:assign` |
| workBoard.ts:600 | createTaskTemplate | authenticated; self OK; another person needs tasks:assign (TaskTemplateService.ts:74) | `work_board:use` (SELF) + in-service `work_board:assign` for another person |
| workBoard.ts:620 | setTaskTemplateActive | authenticated; creator/assignee OR tasks:assign (TaskTemplateService.ts:127) | `work_board:use` (creator/assignee own-row, stays) OR `work_board:assign` |

### `server/src/modules/printing/resolvers/printRequest.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| printRequest.ts:255 | createPrintRequest | tracker:write | `printing:create` |
| printRequest.ts:291 | markPrintRequestPrinted | authenticated; `assertPrintAdmin` = roster:manage (:51-56, :305) | `printing:process` |
| printRequest.ts:311 | markPrintRequestDelivered | authenticated; roster:manage (:320) | `printing:process` |
| printRequest.ts:326 | cancelPrintRequest | authenticated; roster:manage = any job; else tracker:write + own (:339-343; PrintRequestService.ts:487) | `hasAnyPermission(printing:process, printing:create)` + per-branch: any job → `printing:process`; own → `printing:create` + requester own-row (stays) |
| printRequest.ts:728 | tagPrintRequests | authenticated; roster:manage any / tracker:write own (:750-753; PrintRequestService.ts:1144) | `hasAnyPermission(printing:process, printing:create)` + per-branch: any → `printing:process`; own → `printing:create` + own-row (stays) |
| printRequest.ts:769 | reprintPrintRequest | authenticated; roster:manage any / tracker:write own (:790-793; PrintRequestService.ts:1232) | `hasAnyPermission(printing:process, printing:create)` + per-branch: any → `printing:process`; own → `printing:create` + own-row (stays) |

## (b) Queries

### `server/src/modules/hr/resolvers/staffLeave.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| staffLeave.ts:346 | staffLeaveApplications | leave:manage | `leave:view_all` |
| staffLeave.ts:368 | staffLeaveApplicationsPage | leave:manage | `leave:view_all` |
| staffLeave.ts:388 | staffLeavePendingCount | leave:manage | `leave:approve` (drawer badge) |
| staffLeave.ts:399 | staffLeaveBalances | leave:manage | `leave:view_all` |
| staffLeave.ts:412 | staffCoverSlots | authenticated; leave:manage OR applicant own-row (:419-424) | `cover:propose` (SELF, applicant own-row, stays) OR `cover:view_all` (any leave) |
| staffLeave.ts:430 | needsCoverSlots | leave:manage | `cover:view_all` |
| staffLeave.ts:445 | myStaffLeave | authenticated; own (staffMatch) | `leave:apply` (SELF) |
| staffLeave.ts:455 | myStaffLeaveBalances | authenticated; own | `leave:apply` (SELF) |

### `server/src/modules/hr/resolvers/payroll.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| payroll.ts:191 | paymentAdvice | payroll:manage | `payroll:export` |
| payroll.ts:267 | staffPayHistory | payroll:manage | `payroll:view` |
| payroll.ts:468 | payrollRuns | payroll:manage | `payroll:view` |
| payroll.ts:477 | payslipsForRun | payroll:manage | `payroll:view` |
| payroll.ts:487 | payrollPaymentExport | payroll:manage; DEPRECATED, no client | `payroll:export` (or delete the field) |
| payroll.ts:502 | myPayslips | authenticated; own, locked runs only | `payroll:view_own` (SELF) + locked-runs-only (stays) |
| payroll.ts:521 | staffPayslips | payroll:manage; locked runs only | `payroll:view` + locked-runs-only (stays) |
| payroll.ts:534 | staffAdvances | payroll:manage | `salary_advance:view` |

### `server/src/modules/hr/resolvers/performance.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| performance.ts:221 | myObservations | authenticated; observerId = me | `appraisal:view_own` (SELF) |
| performance.ts:233 | staffObservations | performance:manage | `appraisal:view_all` |
| performance.ts:247 | myObservationsPage | authenticated; observerId = me | `appraisal:view_own` (SELF) |
| performance.ts:260 | staffObservationsPage | performance:manage | `appraisal:view_all` |
| performance.ts:334 | staffAppraisals | performance:manage | `appraisal:view_all` |
| performance.ts:344 | myAppraisals | authenticated; own | `appraisal:view_own` (SELF) |
| performance.ts:441 | staffConductRecords | performance:manage | `conduct:view_all` |
| performance.ts:451 | myConductRecords | authenticated; own | `conduct:view_own` (SELF) |
| performance.ts:519 | grievances | performance:manage | `grievance:view_all` |
| performance.ts:529 | myGrievances | authenticated; own | `grievance:raise` (SELF) |
| performance.ts:570 | staffDevelopmentLog | performance:manage | `appraisal:view_all` |
| performance.ts:580 | myDevelopmentLog | authenticated; own | `appraisal:view_own` (SELF) |

### `server/src/modules/hr/resolvers/offboarding.ts`, `server/src/modules/hr/resolvers/staffDirectory.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| offboarding.ts:274 | offboardingCase | staff:manage | `offboarding:view` |
| offboarding.ts:285 | offboardingCases | staff:manage | `offboarding:view` |
| offboarding.ts:295 | offboardingCasesForStaff | staff:manage | `offboarding:view` |
| staffDirectory.ts:47 | staffDirectory | authenticated; GUARDIAN rejected by role (:62); `isManager` = performance:manage OR staff:manage (:40-45) widens observableOnly to everyone, else supervisory scope | SELF (non-guardian discovery; GUARDIAN wall stays) + `observableOnly` widening on `hasAnyPermission(appraisal:observe, staff_records:view)`, else supervisory scope (stays) |

### `server/src/modules/hr/resolvers/staffHub.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| staffHub.ts:299 | hrPolicy | payroll:manage | `hr_policy:view` |
| staffHub.ts:308 | staffLetters | staff:manage | `staff_letters:view` |
| staffHub.ts:318 | staffLeavePool | leave:manage | `leave:view_all` |
| staffHub.ts:331 | staffProbationDebt | leave:manage | `leave:view_all` |
| staffHub.ts:341 | staffAttendance | attendance:manage | `staff_attendance:view_all` |
| staffHub.ts:358 | staffAttendanceSummary | attendance:manage | `staff_attendance:view_all` |
| staffHub.ts:381 | staffLatenessPreview | attendance:manage | `staff_attendance:view_all` |
| staffHub.ts:395 | staffLatenessCharge | payroll:manage | `payroll:view` |
| staffHub.ts:424 | myLeavePool | authenticated; own | `leave:apply` (SELF) |
| staffHub.ts:450 | myProbationDebt | authenticated; own | `leave:apply` (SELF) |
| staffHub.ts:463 | confirmationPreview | staff:manage | `staff_records:confirm` |
| staffHub.ts:556 | supportContractDefaults | authenticated; inline `require_(staff:manage)` (:563), declarative scope does not match | `staff_letters:issue` (declarative; drop the inline check) |
| staffHub.ts:682 | staffLetterCount | staff:manage | `staff_letters:view` |

### `server/src/modules/foundation/resolvers/staff.ts` (deduped here)
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| staff.ts:79 | staff | staff:manage; returns monthlySalary and bank fields | `staff_records:view` · F-24 |
| staff.ts:103 | staffProfile | staff:manage | `staff_records:view` · F-24 |

### `server/src/modules/finance/resolvers/*` (all `finance:manage`, no extra gate)
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/finance/resolvers/budget.ts:161 | budgetLines | finance:manage | `budget:view` |
| server/src/modules/finance/resolvers/budget.ts:171 | budgetVsActual | finance:manage | `budget:view` |
| server/src/modules/finance/resolvers/budget.ts:181 | budgetSurplusDeficit | finance:manage | `budget:view` |
| server/src/modules/finance/resolvers/feeSupport.ts:210 | feeProviders | finance:manage | `fee_support:view` |
| server/src/modules/finance/resolvers/feeSupport.ts:219 | financeProviderStatement | finance:manage | `fee_support:view` |
| server/src/modules/finance/resolvers/financeDashboard.ts:122 | financeMonthlyReport | finance:manage | `finance_reports:view` |
| server/src/modules/finance/resolvers/financeDashboard.ts:132 | financeYearOverview | finance:manage | `finance_reports:view` |
| server/src/modules/finance/resolvers/financeDashboard.ts:142 | financeYtdIncomeStatement | finance:manage | `finance_reports:view` |
| server/src/modules/finance/resolvers/financeDashboard.ts:152 | financeTrends | finance:manage | `finance_reports:view` |
| server/src/modules/finance/resolvers/financeLedger.ts:99 | ledgerOpeningBalances | finance:manage | `finance_ledger:view` |
| server/src/modules/finance/resolvers/financeLedger.ts:111 | ledgerBalanceAsOf | finance:manage | `finance_ledger:view` |
| server/src/modules/finance/resolvers/financePosting.ts:201 | financeDailySnapshot | finance:manage | `finance_ledger:view` |
| server/src/modules/finance/resolvers/financePosting.ts:211 | financeMonthToDate | finance:manage | `finance_ledger:view` |
| server/src/modules/finance/resolvers/financePosting.ts:221 | studentFeeHistory | finance:manage | `finance_ledger:view` |
| server/src/modules/finance/resolvers/financePosting.ts:231 | hrPayrollNetPayableTotal | finance:manage | `finance_ledger:view` (PII-free aggregate that pre-fills a SALARY posting) |
| server/src/modules/finance/resolvers/qardIou.ts:155 | financeParties | finance:manage | `qard:view` |
| server/src/modules/finance/resolvers/qardIou.ts:164 | qardIouPartyOutstanding | finance:manage | `qard:view` |
| server/src/modules/finance/resolvers/qardIou.ts:174 | qardIouOverdue | finance:manage | `qard:view` |
| server/src/modules/finance/resolvers/qardIou.ts:184 | qardIouPartyEntries | finance:manage | `qard:view` |
| server/src/modules/finance/resolvers/reconciliation.ts:93 | latestReconciliation | finance:manage | `reconciliation:view` |
| server/src/modules/finance/resolvers/reconciliation.ts:104 | reconciliationHistory | finance:manage | `reconciliation:view` |
| server/src/modules/finance/resolvers/reconciliation.ts:117 | reconciliationHistoryPage | finance:manage | `reconciliation:view` |
| server/src/modules/finance/resolvers/reconciliation.ts:132 | unreconciledDays | finance:manage | `reconciliation:view` |

### `server/src/modules/workboard/resolvers/workBoard.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| workBoard.ts:319 | myWorkBoard | authenticated; own | `work_board:use` (SELF) |
| workBoard.ts:334 | workBoardFor | tasks:assign; redundant `assertAssigner` (:345) | `work_board:view_all` (drop the duplicate) |
| workBoard.ts:353 | homeworkCheckMonths | authenticated; own, or another user needs tasks:assign (`boardOwnerId` :69-75) | `work_board:use` (own) + in-resolver `work_board:view_all` for another user |
| workBoard.ts:365 | homeworkCheckCardsForMonth | authenticated; same as homeworkCheckMonths | `work_board:use` (own) + in-resolver `work_board:view_all` for another user |
| workBoard.ts:375 | myWorkBoardCounts | authenticated; own | `work_board:use` (SELF) |
| workBoard.ts:389 | task | authenticated; assignee, assigner OR tasks:assign (TaskService.ts:84-88) | `work_board:use` (assignee/assigner own-row, stays) OR `work_board:view_all` |
| workBoard.ts:404 | tasksAssignedByMe | authenticated; assignedBy = me | `work_board:use` (SELF) |
| workBoard.ts:421 | tasksAssignedByMePage | authenticated; assignedBy = me | `work_board:use` (SELF) |
| workBoard.ts:438 | workLoadGrid | tasks:assign; redundant assertAssigner | `work_board:view_all` (drop the duplicate) |
| workBoard.ts:452 | assignableStaff | tasks:assign; redundant assertAssigner | `work_board:assign` (drop the duplicate) |
| workBoard.ts:478 | taskTemplates | authenticated; every template with tasks:assign, else own (TaskTemplateService.ts:143) | `work_board:use` (own rows) (+ `work_board:view_all` lifts scope) |

### `server/src/modules/printing/resolvers/printRequest.ts`
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| printRequest.ts:371 | printQueue | authenticated; roster:manage (:386) | `printing:view_all` |
| printRequest.ts:403 | printQueueCounts | authenticated; roster:manage (:409) | `printing:view_all` |
| printRequest.ts:415 | myPrintRequests | tracker:write; own | `printing:create` + own rows (stays) |
| printRequest.ts:428 | myPrintRequestsPage | tracker:write; own | `printing:create` + own rows (stays) |
| printRequest.ts:517 | printHistory | authenticated; roster:manage = all; tracker:write = forced to own (:544-555) | `printing:create` (forced to own, stays) (+ `printing:view_all` lifts scope) |
| printRequest.ts:603 | printHistoryPage | authenticated; `historyScope` (:591-598), same rule | `printing:create` (forced to own, stays) (+ `printing:view_all` lifts scope) |
| printRequest.ts:676 | printHistoryFacets | authenticated; historyScope | `printing:create` (forced to own, stays) (+ `printing:view_all` lifts scope) |
| printRequest.ts:808 | printRequest | authenticated; roster:manage OR requester (:819) | `printing:view_all` OR requester own-row (SELF) |

## (c) REST routes / SSE topics
| file:line | route / topic | today's gate | → new gate |
|---|---|---|---|
| server/src/modules/hr/routes/paymentAdvicePdf.ts:72 | GET /export/payment-advice/:runId (server/src/index.ts:185) | `callerHasPermission(payroll:manage)` (:78) | `payroll:export` |
| server/src/modules/hr/routes/paymentExportCsv.ts:45 | GET /export/payment/:runId (server/src/index.ts:184) | `callerHasPermission(payroll:manage)` (:51) | `payroll:export` |
| server/src/modules/hr/routes/payrollRegisterXlsx.ts:35 | GET /export/payroll-register/:runId (server/src/index.ts:186) | `callerHasPermission(payroll:manage)` (:41) | `payroll:export` |
| server/src/modules/hr/routes/staffLetterPdf.ts:52 | GET /pdf/staff-letter/:id (server/src/index.ts:190) | `callerHasPermission(staff:manage)` (:54) | `staff_letters:view` |
| server/src/realtime/bus.ts:19 + server/src/routes/events.ts:44 | SSE topic `print_queue` | roster:manage | `printing:view_all` |

## (d) Hidden role / designation gates
| file:line | today | → replacement |
|---|---|---|
| server/src/modules/workboard/services/OfficeCoverService.ts:102-106 | `canPullAtAll` = role P/O, a P/O template, OR tasks:assign; decides `pullWorkCard` | `work_board:cover_desk` |
| server/src/modules/printing/resolvers/printRequest.ts:51-59 | `assertPrintAdmin` / `isOffice` = roster:manage (a borrowed perm used as "is Office") for the whole print operator surface | `printing:view_all` (reads) / `printing:process` (actions) |
| server/src/modules/printing/resolvers/printRequest.ts:261,340,546,594,751,791 | tracker:write (a borrowed perm used as "is teacher") decides the print requester | `printing:create` |
| server/src/modules/hr/resolvers/staffDirectory.ts:62 | `role === "GUARDIAN"` rejected from the staff directory | stays (plane wall, ADR-005), not a matrix action |
| server/src/modules/hr/resolvers/staffDirectory.ts:40-45 | staff:manage OR performance:manage widens observableOnly to everyone | `hasAnyPermission(appraisal:observe, staff_records:view)` |
| server/src/modules/hr/resolvers/staffHub.ts:341/358/381 | attendance:manage (borrowed) gates staff attendance in the hub | `staff_attendance:view_all` |
| server/src/modules/hr/resolvers/staffHub.ts:299/477 | payroll:manage (borrowed) governs leave and letter policy | `hr_policy:view` / `hr_policy:settings` |
| server/src/modules/workboard/services/WorkBoardService.ts:385-389 | homework declared by actingAs P/O is routed to the routine teacher | stays (routing only, not a capability) |

Principal-only actions that ride the role inside a resolver: none in this area. All 6 LOCKED actions (`payroll:approve`, `salary_advance:issue`, `salary_advance:settle`, `offboarding:settle`, `appraisal:sign_off`, `conduct:sign_off`) already map to RESERVED perms.

## (e) Self-service, guardian and public paths (kept as-is)
The own StaffProfile is resolved by the phone join (`server/src/modules/hr/services/staffMatch.ts` `resolveStaffProfileForUser`). Each SELF action is shown read-only in the editor ("everyone, for themselves"). No guardian-plane or public resolver is in this area.

| path | today | → |
|---|---|---|
| leave: applyForStaffLeave (own), decideStaffLeave cancel (own), myStaffLeave, myStaffLeaveBalances, myLeavePool, myProbationDebt | authenticated + own StaffProfile | `leave:apply` (SELF) |
| cover: proposeStaffCover (own leave), staffCoverSlots (own leave) | authenticated + own leave's applicant | `cover:propose` (SELF) |
| payroll: myPayslips (locked runs only) | authenticated + own | `payroll:view_own` (SELF) |
| appraisal: myAppraisals, myDevelopmentLog, myObservations(+Page) (as author) | authenticated + own | `appraisal:view_own` (SELF). submitObservation for a supervisor is a row-scope (supervisory ScopeGrant), not self. |
| conduct: myConductRecords | authenticated + own | `conduct:view_own` (SELF) |
| grievance: raiseGrievance, myGrievances | authenticated + own | `grievance:raise` (SELF, never revocable: a protection right) |
| staff directory: staffDirectory (discovery, non-guardian) | authenticated, GUARDIAN rejected | SELF (no feature; GUARDIAN wall stays) |
| work_board: myWorkBoard, myWorkBoardCounts, homeworkCheck* (own), task (assignee/assigner), tasksAssignedByMe(+Page), taskTemplates (own), createTask / createTaskTemplate for self, update/cancel/move/reassign a task I assigned, set status or blocked on my card, setTaskTemplateActive (mine), releaseWorkCard (mine) | authenticated + own row | `work_board:use` (SELF) |
| printing: printRequest (own), own-row halves of cancel, tag and reprint | tracker:write + requester own-row | own-row stays behind `printing:create` (self only for someone who can request at all) |

## (f) App gates
| file:line | today | → new |
|---|---|---|
| app/src/navigation/AppTabs.tsx:1687 | canPrint = tracker:write OR roster:manage | `printing:create` OR `printing:view_all` |
| app/src/navigation/AppTabs.tsx:1735 | canFinance = finance:manage | any of `finance_ledger:view`, `finance_reports:view`, `budget:view`, `fee_support:view`, `qard:view`, `reconciliation:view` |
| app/src/navigation/AppTabs.tsx:1739 | canHr = role !== GUARDIAN (HR tab, self-service; also a hidden role gate) | unchanged (SELF) |
| app/src/navigation/DrawerContent.tsx:133 | AssignedByMe leaf perms [tasks:assign] | `work_board:assign` |
| app/src/navigation/DrawerContent.tsx:134 | LoadGrid leaf perms [tasks:assign] | `work_board:view_all` |
| app/src/navigation/DrawerContent.tsx:311 | isPrintOperator = roster:manage (badge) | `printing:view_all` |
| app/src/navigation/DrawerContent.tsx:382 | canLeaveBadge = leave:manage | `leave:approve` |
| app/src/screens/admin/AdminHomeScreen.tsx:21 | canStaff = staff:manage | `staff_records:view` |
| app/src/screens/hr/HrHomeScreen.tsx:20 | leave:manage → LeaveAdmin card | `leave:view_all` |
| app/src/screens/hr/HrHomeScreen.tsx:21 | payroll:manage → PayrollHome card (:47) and HrPolicy card (:53) | `payroll:view` (PayrollHome); `hr_policy:view` (HrPolicy) |
| app/src/screens/hr/HrHomeScreen.tsx:22 | performance:manage → PerformanceHome | any of `appraisal:view_all`, `conduct:view_all`, `grievance:view_all` |
| app/src/screens/hr/HrHomeScreen.tsx:23 | staff:manage → OffboardingHome | `offboarding:view` |
| app/src/screens/hr/StaffHubScreen.tsx:780 | canStaff: quick actions (:825 edit/confirm), documents tab (:795), exit tab (:797) | `staff_records:edit` / `staff_records:confirm` (quick actions); `staff_letters:view` (documents); `offboarding:view` (exit) |
| app/src/screens/hr/StaffHubScreen.tsx:784 | user:manage (credential card) | any of `staff_logins:create`, `staff_logins:reset_password` (feature owned by foundation-platform.md) |
| app/src/screens/hr/StaffHubScreen.tsx:785 | leave:manage → leave tab, pool and debt in profile (:256-268) | `leave:view_all` |
| app/src/screens/hr/StaffHubScreen.tsx:786 | attendance:manage → attendance tab | `staff_attendance:view_all` |
| app/src/screens/hr/StaffHubScreen.tsx:787 | payroll:manage → payroll tab | `payroll:view` |
| app/src/screens/hr/StaffHubScreen.tsx:788 | performance:manage → performance tab | `appraisal:view_all` |
| app/src/screens/hr/StaffPayEditScreen.tsx:94 | payroll:manage (salary, pay history) | `payroll:edit` (salary); `payroll:view` (history) |
| app/src/screens/hr/StaffPayEditScreen.tsx:95 | staff:manage (bank account) | `staff_records:edit` |
| app/src/screens/hr/PayrollRunDetailScreen.tsx:64 | payroll:approve | `payroll:approve` (LOCKED) |
| app/src/screens/hr/AdvancesScreen.tsx:44 | payroll:approve | `salary_advance:issue` / `salary_advance:settle` (LOCKED) |
| app/src/screens/hr/OffboardingCaseScreen.tsx:70 | payroll:manage (compute) | `offboarding:prepare` |
| app/src/screens/hr/OffboardingCaseScreen.tsx:71 | payroll:approve (release) | `offboarding:settle` (LOCKED) |
| app/src/screens/hr/StaffAppraisalsScreen.tsx:44 | performance:signoff | `appraisal:sign_off` (LOCKED) |
| app/src/screens/hr/StaffConductScreen.tsx:56 | performance:signoff | `conduct:sign_off` (LOCKED) |
| app/src/screens/workboard/TaskDetailScreen.tsx:43 | assigner OR tasks:assign (canManage) | assigner own-row OR `work_board:assign` |
| app/src/screens/workboard/TaskDetailScreen.tsx:64, :183 | tasks:assign (reassign picker) | `work_board:assign` |
| app/src/screens/workboard/TaskFormScreen.tsx:30 | tasks:assign (pick anyone) | `work_board:assign` |
| app/src/screens/workboard/WorkBoardScreen.tsx:97 | mine OR tasks:assign (canWork on another person's board) | `work_board:assign` (writing) / `work_board:view_all` (reading) |
| app/src/screens/workboard/WorkBoardScreen.tsx:190 | tasks:assign (new task on another person's board) | `work_board:assign` |
| app/src/screens/printing/PrintHomeScreen.tsx:94 | isOffice = roster:manage (queue :120, gaps :151, buttons :414/:427) | `printing:view_all` (queue, gaps) + `printing:process` (buttons) |
| app/src/screens/printing/PrintHomeScreen.tsx:95 | canRequest = tracker:write | `printing:create` |
| app/src/screens/printing/PrintHistoryScreen.tsx:93 | isOffice = roster:manage | `printing:view_all` |

## (g) Notification recipients chosen by role
| file:line | today | → holders of |
|---|---|---|
| server/src/modules/workboard/services/OfficeCoverService.ts:36 | `isDesk` = primary role === OFFICE; owns the office queue cards (PRINT_JOB, LEAVE_APPROVAL) | `printing:process` (PRINT_JOB cards) / `leave:approve` (LEAVE_APPROVAL cards) |
| server/src/modules/workboard/services/OfficeCoverService.ts:37-38 | `isBackup` = PRINCIPAL or an OFFICE/PRINCIPAL template; sees office cards while the desk is absent, and `canPull` on the card (WorkBoardService.ts:1004) | `work_board:cover_desk` |
| server/src/modules/workboard/services/OfficeCoverService.ts:51-52 | `deskLogins` = `User.find({role:"OFFICE"})`; decides "is the desk uncovered today" | the same set as `isDesk`: `printing:process` / `leave:approve` |
| server/src/modules/workboard/services/WorkBoardService.ts:957 | leave-approval card approvers = `officeRecipients` (role-based) ∩ leave:manage; a TEACHER granted it today gets no card | `leave:approve` |
| server/src/modules/notifications/services/emitters.ts:1320 | `emitPrintRequested` → `actingAsFilter(["PRINCIPAL","OFFICE"])` (print-queue push) | `printing:process` |
| server/src/modules/notifications/services/emitters.ts:1441 | `emitStaffLeaveSubmitted` → actingAs P/O (leave push) | `leave:approve` |

## (h) Build notes
- Migration map. Printing rides roster:manage / tracker:write, HR policy rides payroll:manage, staff attendance rides attendance:manage. AC-1 per-user `grantedPermissions` / `revokedPermissions` hold the old strings, so each needs a 1→many expansion (e.g. a revoke of roster:manage today also removes printing, and must still do so after the split). Splitting finance:manage into 6 features changes what "grant the accountant the books" means; the expansion must grant all six.
- Pay exposure. `staff` returns monthlySalary and bank fields to every `staff_records:view` holder (F-24). Letters print the salary. confirmStaffEmployment can move held leave debt to salary. Open: should salary fields need `payroll:view`?
- confirmStaffEmployment with `issueLetter=true` (the default) issues a letter. Open: also assert `staff_letters:issue` on that branch.
- LOCKED scope. `salary_advance:issue` / `:settle` and `offboarding:settle` ride payroll:approve today and stay LOCKED. Open owner question: keep them locked, or make them grantable with only `payroll:approve` locked.
- Recipients follow action holders, not roles. With role routing, a TEACHER granted `leave:approve` or `printing:process` is never notified and an OFFICE user with the action revoked still gets the cards and pushes. Switch every row in (g) together.
- Two covers, one feature. Leave cover (`cover:view_all`, `cover:approve`, `cover:propose`, this file) mints a 1-day proxy ScopeGrant via `server/src/modules/hr/services/CoverService.ts`. Routine slot cover (`cover:assign`) goes through `server/src/modules/routine/services/RoutineCoverService.ts`. Both call `assignProxy` / `revokeProxy` in `server/src/modules/foundation/services/ScopeGrantService.ts`; the direct proxy resolvers are `cover:assign_proxy` (ESCALATION).
- Approve and reject stay one action for leave (`leave:approve`) and cover (`cover:approve`). Confirm with the owner before splitting.
- `offboarding:revoke` (disable login + revoke all ScopeGrants) is split from `offboarding:edit` because of its impact.
- `reassignTask` (`server/src/modules/workboard/services/TaskService.ts:218-223`): see F-6. Build the new-assignee check with `work_board:assign`.
- Schema hygiene. Fields that declare `authenticated` but gate inline (supportContractDefaults, the print operator mutations and queries, cancel/tag/reprint) and fields that double-gate (setHrPolicy, issue/void/confirm letters, the workBoard `assertAssigner`) should end with the declarative `authScopes` as the single truth, with any-of where an own-row path applies.
- Office cannot `createPrintRequest` today (no tracker:write) but can reprint any job via roster:manage. README default keeps `printing:create` T on / O off. Cancelling a class-test print job retires the exam (D-#628).
- `payrollPaymentExport` is deprecated with no client: gate it on `payroll:export` or delete it.
- Screens with no `can(...)` gate today rely on the server: the finance sub-screens (tab-level gate only), LeaveAdmin, NeedsCover, TaskTemplates, LoadGrid. Add per-button gates (finance create/reverse/settings, `leave:approve` / `leave:settings`, `cover:approve`).
- `work_board:use` stays SELF. A toggle to stop someone creating their own tasks was considered and not recommended.

Listed elsewhere:
- `server/src/modules/foundation/resolvers/provisioning.ts:124` provisionStaffLogin (user:manage) → foundation-platform.md.
- `server/src/modules/routine/resolvers/routineSlots.ts:439/452/478` coversForDate / assignCover / cancelCover (routine:read / routine:manage; slot cover → `cover:assign`) → attendance-routine-library.md.
- Proxy ScopeGrant resolvers (`server/src/modules/foundation/resolvers/scopeGrants.ts`, `cover:assign_proxy`) → foundation-platform.md.
- `server/src/modules/improvement/resolvers/improvement.ts:436` leaveImprovementTasks (hasAnyPermission roster:manage, leave:manage, tracker:write + inline :445) → observation-comments-reports.md; its new gate keeps anyOf(`improvement_plan:view_all`, `leave:view_all`) + applicant self.
- Class-test print queue resolvers (gated `printing:view_all` / `printing:process`) → trackers-classtest.md.
