# Content, questions, sets, exams, scholarship & books — build checklist

Features: `lesson_plans`, `plan_review`, `question_bank`, `question_review`, `question_sets`, `exam_syllabus`, `scholarship_practice`, `mastery`, `book_production` (owner rows: see README). Source: inventory F, origin/dev 2026-10-20.
Counts: 56 mutations, 73 queries, 7 REST/SSE.

## (a) Mutations
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/content/resolvers/content.ts:193 | importEnvelope | `content:import` | hasAnyPermission(`lesson_plans:import`, `question_bank:import`); resolver detects the doc kind, then assertHasPermission `lesson_plans:import` (plan envelope) or `question_bank:import` (bank) |
| server/src/modules/content/resolvers/content.ts:226 | importFiles | `content:import` | hasAnyPermission(`lesson_plans:import`, `question_bank:import`); resolver detects the kind (plan pair/envelope → `lesson_plans:import`; Project-04 bank → `question_bank:import`) |
| server/src/modules/content/resolvers/review.ts:104 | assignPlanReview | `content:assign_review`; reviewer not validated (any user id) | `plan_review:assign` (F-26) |
| server/src/modules/content/resolvers/review.ts:135 | submitPlanReview | `content:review`; svc: assigned reviewer = caller, round open | `plan_review:review` + designation assigned reviewer (stays); round open (stays) |
| server/src/modules/content/resolvers/review.ts:170 | cancelPlanReview | `content:assign_review` | `plan_review:assign` |
| server/src/modules/content/resolvers/review.ts:224 | approvePlan | `content:promote_gold`; svc: not-reviewed needs overrideReason | `plan_review:approve`; override-reason rule (stays) |
| server/src/modules/content/resolvers/review.ts:265 | approvePlanBulk | `content:promote_gold`; reviewed only, no override | `plan_review:approve`; reviewed-only rule (stays) |
| server/src/modules/content/resolvers/review.ts:354 | assignPlanReviewBulk | `content:assign_review` | `plan_review:assign` (F-26) |
| server/src/modules/content/resolvers/review.ts:503 | movePlanReviews | `content:assign_review`; svc ReviewService.ts:763 target active and role ≠ GUARDIAN | `plan_review:assign`; target check (stays) (F-26) |
| server/src/modules/content/resolvers/review.ts:542 | cancelPlanReviews | `content:assign_review` | `plan_review:assign` |
| server/src/modules/questions/resolvers/questionEdit.ts:73 | updateQuestionContent | `question:manage` | `question_bank:edit` |
| server/src/modules/questions/resolvers/questionEdit.ts:121 | retireQuestion | `question:manage` | `question_bank:delete` |
| server/src/modules/questions/resolvers/questionEdit.ts:151 | restoreQuestion | `question:manage` | `question_bank:delete` |
| server/src/modules/questions/resolvers/questionEdit.ts:176 | setQuestionImportant | hasAny [`question:manage`, `content:review`]; svc: without manage, caller must hold an open round on the qid | hasAnyPermission(`question_bank:edit`, `question_review:review`); in-resolver: `question_bank:edit` → any question; else assertHasPermission `question_review:review` + own open round (stays) |
| server/src/modules/questions/resolvers/questionReview.ts:169 | assignQuestionReview | `content:assign_review` | `question_review:assign` (F-26) |
| server/src/modules/questions/resolvers/questionReview.ts:196 | assignQuestionReviewBulk | `content:assign_review` | `question_review:assign` (F-26) |
| server/src/modules/questions/resolvers/questionReview.ts:240 | assignQuestionReviewByChapter | `content:assign_review`; skips published/reviewed/in-flight | `question_review:assign`; skip rule (stays) (F-26) |
| server/src/modules/questions/resolvers/questionReview.ts:292 | moveQuestionReviewChapter | `content:assign_review`; untouched rounds only | `question_review:assign`; untouched-only (stays) |
| server/src/modules/questions/resolvers/questionReview.ts:328 | clearQuestionCondition | `content:assign_review`; latest round must be APPROVE_WITH_CONDITION | `question_review:assign`; state rule (stays) |
| server/src/modules/questions/resolvers/questionReview.ts:356 | submitQuestionReview | `content:review`; svc QuestionReviewService.ts:388 assigned reviewer only | `question_review:review` + designation assigned reviewer (stays) |
| server/src/modules/questions/resolvers/questionReview.ts:387 | submitQuestionReviewBulk | `content:review`; own rounds; no APPROVE_WITH_CONDITION | `question_review:review` + own rounds (stays) |
| server/src/modules/questions/resolvers/questionReview.ts:417 | publishQuestion | `content:promote_gold`; override needs a reason | `question_review:publish`; override-reason rule (stays) |
| server/src/modules/questions/resolvers/questionReview.ts:446 | publishQuestionBulk | `content:promote_gold`; accepted only | `question_review:publish`; accepted-only (stays) |
| server/src/modules/questions/resolvers/questionReview.ts:487 | publishQuestionsMatching | `content:promote_gold`; verdict must be APPROVE; capped | `question_review:publish`; verdict rule + cap (stays) |
| server/src/modules/assessment/resolvers/assessment.ts:173 | createSet | `set:assemble`; assertCanWrite (P by role; O/G refused by role; T teaching/proxy) | `question_sets:create` + assertCanWrite scope (stays); PRINCIPAL bypass → `question_sets:edit_all`; OFFICE refusal replaced (passes only with scope or `question_sets:edit_all`) |
| server/src/modules/assessment/resolvers/assessment.ts:209 | createSetWithQuestions | `set:assemble`; assertCanWrite | `question_sets:create` + assertCanWrite scope (stays); bypass → `question_sets:edit_all` |
| server/src/modules/assessment/resolvers/assessment.ts:258 | addQuestionToSet | `question:select`; assertCanWrite on the set's section | `question_sets:create` + assertCanWrite scope (stays); bypass → `question_sets:edit_all` |
| server/src/modules/assessment/resolvers/assessment.ts:291 | renameSet | `set:assemble`; assertCanWrite | `question_sets:create` + assertCanWrite scope (stays); bypass → `question_sets:edit_all` |
| server/src/modules/assessment/resolvers/assessment.ts:319 | removeQuestionFromSet | `question:select`; assertCanWrite | `question_sets:create` + assertCanWrite scope (stays); bypass → `question_sets:edit_all` |
| server/src/modules/assessment/resolvers/assessment.ts:347 | assembleSet | `set:assemble`; assertCanWrite | `question_sets:create` + assertCanWrite scope (stays); bypass → `question_sets:edit_all` |
| server/src/modules/exams/resolvers/exams.ts:76 | updateExam | `exam:manage`; svc re-checks `exam:manage` | `exam_syllabus:settings` (svc re-check re-pointed) |
| server/src/modules/exams/resolvers/exams.ts:100 | createExam | `exam:manage`; svc re-checks; duplicate refused | `exam_syllabus:settings`; duplicate rule (stays) |
| server/src/modules/exams/resolvers/examSyllabus.ts:311 | saveExamClassNote | `exam:manage`; svc assertCanManage (:759) | `exam_syllabus:edit` (svc assertCanManage re-pointed) |
| server/src/modules/exams/resolvers/examSyllabus.ts:336 | saveExamSyllabus | `exam:manage`; svc assertCanManage (:296); Σ = 100 | `exam_syllabus:edit`; Σ = 100 rule (stays) |
| server/src/modules/exams/resolvers/examSyllabus.ts:379 | submitExamSyllabus | `exam:manage`; svc assertCanManage (:489); approver must be a routine holder | `exam_syllabus:edit`; approver = routine holder (stays) |
| server/src/modules/exams/resolvers/examSyllabus.ts:395 | reassignExamSyllabus | `exam:manage`; svc assertCanManage (:449); routine holder; not after sign-off | `exam_syllabus:edit`; routine-holder + state rules (stays) |
| server/src/modules/exams/resolvers/examSyllabus.ts:413 | approveExamSyllabus | authenticated; svc :543 named routine holder; else isPrincipalStaff bypass when no holders (:562) | SELF: designation named routine approver (stays, D-#533); no-holder bypass branch → `exam_syllabus:publish` (PRINCIPAL-DEFAULT) |
| server/src/modules/exams/resolvers/examSyllabus.ts:426 | sendBackExamSyllabus | authenticated; svc :614 TEACHER_REVIEW → named approver or isAdminStaff; PRINCIPAL_REVIEW → assertCanManage | authenticated; TEACHER_REVIEW: designation named approver (stays) or `exam_syllabus:edit` (replaces isAdminStaff); PRINCIPAL_REVIEW: `exam_syllabus:edit` |
| server/src/modules/exams/resolvers/examSyllabus.ts:440 | publishExamSyllabus | `exam:manage`; svc :78 isPrincipalStaff | `exam_syllabus:publish` (PRINCIPAL-DEFAULT) |
| server/src/modules/scholarship/resolvers/scholarship.ts:496 | saveScholarshipTopic | `scholarship:manage`; svc :434 primary role ∈ {P,O,T} | `scholarship_practice:settings` (svc role check removed) |
| server/src/modules/scholarship/resolvers/scholarship.ts:526 | retireScholarshipTopic | `scholarship:manage`; svc :472 role ∈ {P,O} | `scholarship_practice:delete` (svc role check removed) |
| server/src/modules/scholarship/resolvers/scholarship.ts:541 | setScholarshipCandidate | `scholarship:manage`; svc :544 role ∈ {P,O} | `scholarship_practice:select_candidates` (svc role check removed) (F-32) |
| server/src/modules/scholarship/resolvers/scholarship.ts:554 | declareScholarshipPaper | `scholarship:manage`; svc :248 assertMayManage: P/O primary-role bypass, T routine holder, other roles refused | `scholarship_practice:create` + routine class × subject check (stays); P/O bypass → `scholarship_practice:edit_all` (2H, F-27) |
| server/src/modules/scholarship/resolvers/scholarship.ts:599 | enterScholarshipScores | `scholarship:manage`; svc :329 assertMayManage (same) | `scholarship_practice:enter_results` + routine class × subject check (stays); bypass → `scholarship_practice:edit_all` (2H, F-27) |
| server/src/modules/support-book/resolvers/supportBook.ts:275 | createSupportBook | `book:manage`; assertBookPlane (infra) | `book_production:create`; assertBookPlane (stays) |
| server/src/modules/support-book/resolvers/supportBook.ts:322 | activateSupportBookPolicy | `book:manage`; assertBookPlane | `book_production:settings`; assertBookPlane (stays) |
| server/src/modules/support-book/resolvers/supportBook.ts:362 | submitSupportBookPatch | `book:author`; assertBookPlane; validator | `book_production:author`; assertBookPlane + validator (stays) |
| server/src/modules/support-book/resolvers/supportBookBuild.ts:151 | queueSupportBookBuild | `book:assemble`; `force` only if role === PRINCIPAL (:173) | `book_production:assemble`; `force` → in-resolver assertHasPermission `book_production:override` (PRINCIPAL-DEFAULT) |
| server/src/modules/support-book/resolvers/supportBookContent.ts:249 | commentOnSupportBookItem | `book:review` | `book_production:review` |
| server/src/modules/support-book/resolvers/supportBookContent.ts:283 | resolveSupportBookComment | hasAny [`book:author`, `book:review`] | hasAnyPermission(`book_production:author`, `book_production:review`); author side = own comment fixes (stays) |
| server/src/modules/support-book/resolvers/supportBookReview.ts:200 | assignSupportBookReview | `book:manage`; self-review refused unless role === PRINCIPAL (:222, stamped) | `book_production:assign`; self-review exemption stays a PRINCIPAL row property (see (d)) |
| server/src/modules/support-book/resolvers/supportBookReview.ts:238 | submitSupportBookReview | `book:review`; svc assigned reviewer | `book_production:review` + designation assigned reviewer (stays) |
| server/src/modules/support-book/resolvers/supportBookReview.ts:284 | raiseSupportBookEscalation | `book:review` | `book_production:review` |
| server/src/modules/support-book/resolvers/supportBookReview.ts:317 | replySupportBookEscalation | `book:review`; `isSenior` = holds `book:review_senior` (:339) | `book_production:review`; isSenior → `book_production:approve` (senior reply marks ANSWERED) |
| server/src/modules/support-book/resolvers/supportBookReview.ts:346 | resolveSupportBookEscalation | `book:review_senior` | `book_production:approve` |
| server/src/modules/support-book/resolvers/supportBookReview.ts:375 | signOffSupportBookLesson | `book:review_senior`; svc: no open escalations, checklist complete | `book_production:approve`; state rules (stays) |

## (b) Queries
| file:line | resolver | today's gate (authScopes + extra) | → new gate (permission, plus extra gates that stay) |
|---|---|---|---|
| server/src/modules/content/resolvers/content.ts:262 | artifact | `content:read`; content scope (contentScope.ts:37 P/O primary role = all); reviewer override | `lesson_plans:view` + content scope (stays; lift see (d), F-27); reviewer override → `plan_review:review` / `question_review:review` + designation assigned reviewer (stays) |
| server/src/modules/content/resolvers/content.ts:291 | contentArtifacts | `content:read`; content scope + mixed-doc publish gate (isAdminStaff) | `lesson_plans:view` + content scope (stays); draft questions → `question_bank:view_all` |
| server/src/modules/content/resolvers/content.ts:419 | contentTree | `content:read`; same | `lesson_plans:view` + content scope (stays) |
| server/src/modules/content/resolvers/content.ts:538 | contentTreePage | `content:read`; same (plans only) | `lesson_plans:view` + content scope (stays) |
| server/src/modules/content/resolvers/review.ts:197 | myReviewAssignments | `content:review`; own rows | `plan_review:review` (own rows, stays) |
| server/src/modules/content/resolvers/review.ts:291 | planReviewInbox | `content:assign_review` | `plan_review:assign` |
| server/src/modules/content/resolvers/review.ts:309 | planReviewThread | authenticated; isAdminStaff → any thread; else participant only | authenticated; participant = SELF branch; any thread → `plan_review:assign` |
| server/src/modules/content/resolvers/review.ts:388 | reviewerAssignmentLoad | `content:assign_review` | `plan_review:assign` |
| server/src/modules/content/resolvers/review.ts:425 | assignablePlans | `content:assign_review` | `plan_review:assign` |
| server/src/modules/content/resolvers/review.ts:449 | assignablePlansPage | `content:assign_review` | `plan_review:assign` |
| server/src/modules/questions/resolvers/questions.ts:153 | questions | `question:read`; scope; publish gate (isAdminStaff); `retired:true` only with `question:manage` | `question_bank:view` + content scope (stays) (+ `question_bank:view_all` lifts publish gate and scope); `retired:true` lens → `question_bank:delete` |
| server/src/modules/questions/resolvers/questions.ts:313 | question | `question:read`; scope; publish gate; reviewer override | `question_bank:view` (+ `question_bank:view_all`); reviewer override → `question_review:review` + designation assigned reviewer (stays) |
| server/src/modules/questions/resolvers/questions.ts:344 | questionTopicTags | `question:read`; scope; publish gate | `question_bank:view` (+ `question_bank:view_all` lifts publish gate) |
| server/src/modules/questions/resolvers/questions.ts:384 | questionCategories | `question:read`; scope; publish gate | `question_bank:view` (+ `question_bank:view_all` lifts publish gate) |
| server/src/modules/questions/resolvers/questions.ts:424 | questionChapters | `question:read`; scope; publish gate | `question_bank:view` (+ `question_bank:view_all` lifts publish gate) |
| server/src/modules/questions/resolvers/questions.ts:460 | stimuli | `question:read`; scope (deliberately not publish-gated) | `question_bank:view` + content scope (stays) |
| server/src/modules/questions/resolvers/questionReview.ts:525 | myQuestionReviews | `content:review`; own rows | `question_review:review` (own rows, stays) |
| server/src/modules/questions/resolvers/questionReview.ts:564 | myQuestionReviewCount | `content:review`; own rows | `question_review:review` (own rows, stays) |
| server/src/modules/questions/resolvers/questionReview.ts:623 | questionReviewInbox | `content:assign_review` | `question_review:view_all` |
| server/src/modules/questions/resolvers/questionReview.ts:653 | questionReviewInboxCount | `content:assign_review` | `question_review:view_all` |
| server/src/modules/questions/resolvers/questionReview.ts:679 | questionReviewThread | authenticated; isAdminStaff → any thread; else participant | authenticated; participant = SELF branch; any thread → `question_review:view_all` |
| server/src/modules/questions/resolvers/questionReview.ts:706 | assignableQuestions | `content:assign_review` | `question_review:assign` |
| server/src/modules/questions/resolvers/questionReview.ts:738 | assignableQuestionsPage | `content:assign_review` | `question_review:assign` |
| server/src/modules/questions/resolvers/questionReview.ts:801 | questionReviewerProgress | `content:assign_review` | `question_review:view_all` |
| server/src/modules/questions/resolvers/questionReview.ts:820 | questionReviewerRounds | `content:assign_review` | `question_review:view_all` |
| server/src/modules/questions/resolvers/questionReview.ts:856 | questionReviewerRoundCount | `content:assign_review` | `question_review:view_all` |
| server/src/modules/questions/resolvers/questionReview.ts:885 | questionCoverage | `content:assign_review` | `question_review:view_all` |
| server/src/modules/questions/resolvers/questionReview.ts:925 | questionReviewerSlices | `content:assign_review` | `question_review:view_all` |
| server/src/modules/questions/resolvers/questionReview.ts:946 | myReviewChapters | `content:review`; own rows | `question_review:review` (own rows, stays) |
| server/src/modules/assessment/resolvers/assessment.ts:382 | assessmentSet | `set:read`; assertCanRead (isAdminStaff → all) | `question_sets:view` + assertCanRead scope (stays); isAdminStaff lift → see (d) authz.ts:96 |
| server/src/modules/assessment/resolvers/assessment.ts:419 | assessmentSets | `set:read`; assertCanRead | `question_sets:view` + assertCanRead scope (stays); lift → see (d) |
| server/src/modules/assessment/resolvers/assessment.ts:446 | assessmentSetsPage | `set:read`; assertCanRead | `question_sets:view` + assertCanRead scope (stays); lift → see (d) |
| server/src/modules/assessment/resolvers/assessment.ts:498 | myRecentSets | `set:read`; own rows (createdBy/assembledBy) | `question_sets:view` (own rows, stays) |
| server/src/modules/assessment/resolvers/assessment.ts:547 | questionUsageCounts | `set:read`; no row scope (school-wide) | `question_sets:view` (F-17) |
| server/src/modules/assessment/resolvers/assessment.ts:565 | questionUsage | `set:read`; no row scope (school-wide) | `question_sets:view` (F-17) |
| server/src/modules/exams/resolvers/exams.ts:57 | exams | authenticated (incl. GUARDIAN) | staff: `exam_syllabus:view`; GUARDIAN keeps authenticated (guardian picker, guardian plane) (F-10) |
| server/src/modules/exams/resolvers/examSyllabus.ts:186 | examSyllabusClass | authenticated; non-admin → published only (isAdminStaff) | staff: `exam_syllabus:view` (+ `exam_syllabus:view_all` lifts published-only); guardians stay on the guardian plane (F-10) |
| server/src/modules/exams/resolvers/examSyllabus.ts:199 | examSyllabusBoard | `exam:manage`; svc :627 isAdminStaff | `exam_syllabus:view_all` |
| server/src/modules/exams/resolvers/examSyllabus.ts:209 | examSyllabusDetail | authenticated; svc :386 unpublished refused unless isAdminStaff | `exam_syllabus:view` (+ `exam_syllabus:view_all` for unpublished) (F-10) |
| server/src/modules/exams/resolvers/examSyllabus.ts:223 | examSyllabusLevels | `exam:manage`; svc :766 isAdminStaff | `exam_syllabus:view_all` |
| server/src/modules/exams/resolvers/examSyllabus.ts:234 | examSyllabusLevelDetail | authenticated; svc :424 GUARDIAN refused; :426 isAdminStaff for drafts | `exam_syllabus:view` (+ `exam_syllabus:view_all` for drafts); GUARDIAN refusal (stays) (F-10) |
| server/src/modules/exams/resolvers/examSyllabus.ts:250 | guardianChildSyllabus | `guardian:read_child`; assertGuardianOfStudent | GUARDIAN (guardian:read_child, unchanged) |
| server/src/modules/exams/resolvers/examSyllabus.ts:262 | mySyllabusApprovals | authenticated; GUARDIAN → [] (:688); own rows | SELF (badge; must never refuse) |
| server/src/modules/exams/resolvers/examSyllabus.ts:271 | mySyllabusApprovalCount | authenticated; GUARDIAN → 0 (:745) | SELF (badge; must never refuse) |
| server/src/modules/exams/resolvers/examSyllabus.ts:280 | examSyllabusApprover | `exam:manage` | `exam_syllabus:edit` |
| server/src/modules/scholarship/resolvers/scholarship.ts:352 | scholarshipTopics | `scholarship:read`; no row scope | `scholarship_practice:view` (F-11) |
| server/src/modules/scholarship/resolvers/scholarship.ts:365 | scholarshipCandidates | `scholarship:read`; no row scope | `scholarship_practice:view` (F-11) |
| server/src/modules/scholarship/resolvers/scholarship.ts:375 | scholarshipPapers | `scholarship:read`; no row scope | `scholarship_practice:view` (F-11) |
| server/src/modules/scholarship/resolvers/scholarship.ts:387 | scholarshipPapersPage | `scholarship:read`; no row scope | `scholarship_practice:view` (F-11) |
| server/src/modules/scholarship/resolvers/scholarship.ts:401 | scholarshipPaper | `scholarship:read`; no row scope | `scholarship_practice:view` (F-11) |
| server/src/modules/scholarship/resolvers/scholarship.ts:410 | scholarshipStudent | `scholarship:read`; no row scope | `scholarship_practice:view` (F-11) |
| server/src/modules/scholarship/resolvers/scholarship.ts:431 | scholarshipClass | `scholarship:read`; no row scope | `scholarship_practice:view` (F-11) |
| server/src/modules/scholarship/resolvers/scholarship.ts:452 | scholarshipItemsCheck | `scholarship:manage` (dry run) | `scholarship_practice:create` |
| server/src/modules/support-book/resolvers/supportBook.ts:178 | supportBooks | `book:read`; assertBookPlane | `book_production:view`; assertBookPlane (stays) |
| server/src/modules/support-book/resolvers/supportBook.ts:205 | supportBookLessons | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBook.ts:227 | supportBookTimeline | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBook.ts:253 | supportBookPolicySet | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBook.ts:413 | supportBookPatches | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookBuild.ts:83 | supportBookAssemblyGate | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookBuild.ts:96 | supportBookBuildJobs | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookBuild.ts:116 | supportBookBuildJobsPage | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookBuild.ts:134 | supportBookExportJson | `book:assemble`; assertBookPlane | `book_production:assemble` |
| server/src/modules/support-book/resolvers/supportBookContent.ts:120 | supportBookLessonContent | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookContent.ts:225 | supportBookComments | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookRationale.ts:111 | supportBookItemRationale | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookRationale.ts:141 | supportBookRationale | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookRationale.ts:163 | supportBookPolicyAt | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookReview.ts:125 | supportBookReviewRounds | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookReview.ts:147 | supportBookEscalations | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookReview.ts:174 | supportBookEscalationsPage | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookSlots.ts:104 | supportBookSlots | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookSlots.ts:151 | supportBookStaleness | `book:read`; assertBookPlane | `book_production:view` |
| server/src/modules/support-book/resolvers/supportBookSlots.ts:165 | supportBookSlotHistory | `book:read`; assertBookPlane | `book_production:view` |

## (c) REST routes / SSE topics
| file:line | route / topic | today's gate | → new gate |
|---|---|---|---|
| server/src/routes/pdf.ts:25 | GET /pdf/artifact/:id | `content:read`, OR `roster:manage` + live PrintRequest | `lesson_plans:view`, OR `printing:view_all` + live PrintRequest (stays; printing owned by hr-finance.md). Verify whether content row scope applies here |
| server/src/modules/assessment/routes/setPdf.ts:44 | GET /pdf/set/:id | `set:read` (`set:export` never checked), OR `roster:manage` + PrintRequest | `question_sets:export`, OR `printing:view_all` + live PrintRequest (stays) (F-19) |
| server/src/modules/exams/routes/syllabusPdf.ts:88 (guardian branch :103) | GET /pdf/syllabus/:examId | authenticated; GUARDIAN branch → guardianChildSyllabus | staff: `exam_syllabus:view`; guardian branch → GUARDIAN (guardian:read_child, unchanged) (F-10) |
| server/src/modules/scholarship/routes/scholarshipAnalysisExport.ts:45 | GET /export/scholarship-analysis | `scholarship:read` (no row scope) | `scholarship_practice:view` (F-11) |
| server/src/routes/files.ts:1027 | POST /files/book | `book:illustrate` OR `book:assemble` | hasAnyPermission(`book_production:illustrate`, `book_production:assemble`); per kind: slot images → `book_production:illustrate`, rendered edition → `book_production:assemble` |
| server/src/routes/bookBuildStream.ts:32 | GET /book-builds/:jobId/stream (SSE) | `book:read` | `book_production:view` |
| server/src/modules/support-book/services/BookFileService.ts:71 | GET /files/:id (book file branch) | `book:read` | `book_production:view` |

## (d) Hidden role / designation gates
| file:line | today | → replacement |
|---|---|---|
| server/src/modules/content/contentScope.ts:37 | `role === "PRINCIPAL" \|\| role === "OFFICE"` → all content (primary role only, not template-aware) | WHERE axis stays. The "all" lift becomes a permission: on the question reads → `question_bank:view_all`; on the plan reads → `lesson_plans:view_all` (O on †, inert for pure Office; 2H) (F-27) |
| server/src/modules/questions/publishGate.ts:26-28 | `seesPublishedOnly = !isAdminStaff` | `!can("question_bank:view_all")` |
| server/src/modules/content/resolvers/review.ts:328 | planReviewThread: any thread if isAdminStaff | `can("plan_review:assign")` |
| server/src/modules/questions/resolvers/questionReview.ts:697 | questionReviewThread: any thread if isAdminStaff | `can("question_review:view_all")` |
| server/src/modules/content/services/ReviewService.ts:763 | movePlanReviews target `role !== "GUARDIAN"`; the assign paths do not validate the reviewer at all | target check stays (F-26) |
| server/src/modules/exams/services/ExamSyllabusService.ts:78 | publish: isPrincipalStaff | `can("exam_syllabus:publish")` (PRINCIPAL-DEFAULT) |
| server/src/modules/exams/services/ExamSyllabusService.ts:562 | teacher-stage bypass when the routine names nobody: isPrincipalStaff | `can("exam_syllabus:publish")` (PRINCIPAL-DEFAULT) |
| server/src/modules/exams/services/ExamSyllabusService.ts:632 | send back at TEACHER_REVIEW: named approver OR isAdminStaff | named approver (designation, stays) OR `can("exam_syllabus:edit")` |
| server/src/modules/exams/services/ExamSyllabusReadService.ts:268, 288, 388, 426 | drafts/unpublished visible if isAdminStaff | `can("exam_syllabus:view_all")` |
| server/src/modules/exams/services/ExamSyllabusReadService.ts:627, 766 | board / levels require isAdminStaff (on top of `exam:manage`) | `can("exam_syllabus:view_all")` only |
| server/src/modules/exams/services/ExamSyllabusReadService.ts:424, 688, 745; server/src/modules/exams/routes/syllabusPdf.ts:103 | `role === "GUARDIAN"` refuse / empty / branch | GUARDIAN plane: stays |
| server/src/modules/scholarship/services/ScholarshipService.ts:86 | assertMayManage: P/O bypass the routine check (primary role); :87 any other role refused | P/O bypass → `can("scholarship_practice:edit_all")` (2H, F-27); routine class × subject check stays; :87 role refusal replaced by holding `scholarship_practice:create` / `:enter_results` |
| server/src/modules/scholarship/services/ScholarshipService.ts:434 | saveTopic: role ∈ {P,O,T} | `can("scholarship_practice:settings")` |
| server/src/modules/scholarship/services/ScholarshipService.ts:472 | retireTopic: role ∈ {P,O} | `can("scholarship_practice:delete")` |
| server/src/modules/scholarship/services/ScholarshipService.ts:544 | setCandidateSitting: role ∈ {P,O} | `can("scholarship_practice:select_candidates")` (F-32) |
| server/src/modules/support-book/resolvers/supportBookBuild.ts:173 | build `force` only if `role === "PRINCIPAL"` | `can("book_production:override")` (PRINCIPAL-DEFAULT, D-#424) |
| server/src/modules/support-book/resolvers/supportBookReview.ts:222 | self-review exemption `callerIsPrincipal` (stamped) | stays: a row property of the PRINCIPAL role (D-#424), not an editor action |
| server/src/middleware/authz.ts:202-203 (also :238-239) | assertCanWrite: P passes by role; O refused by role | PRINCIPAL bypass → `question_sets:edit_all` (PRINCIPAL-DEFAULT); OFFICE refusal replaced: O passes only with scope or `question_sets:edit_all` |
| server/src/middleware/authz.ts:96 | assertCanRead: isAdminStaff → unscoped | for the set reads → `question_sets:view_all` (O on †, inert for pure Office; reproduces two-hat teachers) |

## (e) Self-service, guardian and public paths (kept as-is)
| path | today | → |
|---|---|---|
| planReviewThread, questionReviewThread (participant branch) | participant only; admin by role | SELF (authenticated, participant); the any-thread branch moves to `plan_review:assign` / `question_review:view_all` (see (b)) |
| exams | every role, guardians included | GUARDIAN branch keeps authenticated (guardian picker); staff gate on `exam_syllabus:view` (F-10) |
| examSyllabusClass / examSyllabusDetail / examSyllabusLevelDetail, GET /pdf/syllabus | published rows to everyone; `exam:read` never checked | staff gate on `exam_syllabus:view`; guardians stay on the guardian plane (GUARDIAN). Today a guardian can call examSyllabusClass with any classId and read published rows (low sensitivity) (F-10) |
| mySyllabusApprovals / mySyllabusApprovalCount | badge; never refuses (the 791e5fe rule) | SELF; must keep returning []/0 |
| approveExamSyllabus, sendBackExamSyllabus (TEACHER_REVIEW) | routine-derived row authority | SELF + designation named routine approver (stays, D-#533 / CO-1); only the Principal bypass branch maps to `exam_syllabus:publish` |

## (f) App gates
| file:line | today | → new |
|---|---|---|
| app/src/navigation/AppTabs.tsx:1669 | `can("content:read")` | `lesson_plans:view` |
| app/src/navigation/AppTabs.tsx:1670 | `can("question:read")` | `question_bank:view` |
| app/src/navigation/AppTabs.tsx:1671 | `can("set:read")` | `question_sets:view` |
| app/src/navigation/AppTabs.tsx:1679 | `can("content:review") \|\| can("content:assign_review")` | any of `plan_review:assign`, `plan_review:review`, `plan_review:approve`, `question_review:assign`, `question_review:view_all`, `question_review:review`, `question_review:publish` |
| app/src/navigation/AppTabs.tsx:1743 | `can("content:import") \|\| can("user:manage")` | `lesson_plans:import` \|\| `question_bank:import` \|\| `staff_logins:view` (user-management half, owned by foundation-platform.md) (F-29) |
| app/src/navigation/AppTabs.tsx:1751-1752 | any book:* except read | any `book_production:*` action except `view` |
| app/src/navigation/AppTabs.tsx:1760 | `exam:read \|\| exam:manage` | `exam_syllabus:view` \|\| `exam_syllabus:edit` |
| app/src/navigation/AppTabs.tsx:1761 | `scholarship:read \|\| scholarship:manage` | `scholarship_practice:view` \|\| `scholarship_practice:create` \|\| `scholarship_practice:enter_results` |
| app/src/navigation/DrawerContent.tsx:109 | syExamManage `["exam:manage"]` | `exam_syllabus:settings` |
| app/src/navigation/DrawerContent.tsx:110 | syEntry `["exam:manage"]` | `exam_syllabus:edit` |
| app/src/navigation/DrawerContent.tsx:120 | scTopics `["scholarship:manage"]` | `scholarship_practice:settings` |
| app/src/navigation/DrawerContent.tsx:200 | BookImport `[book:author, book:manage]` | `book_production:author` \|\| `book_production:create` |
| app/src/navigation/DrawerContent.tsx:209 | BookPolicy `[book:manage]` | `book_production:settings` |
| app/src/navigation/DrawerContent.tsx:218 | BookImageQueue `[illustrate, review, review_senior]` | `book_production:illustrate` \|\| `book_production:review` \|\| `book_production:approve` |
| app/src/navigation/DrawerContent.tsx:225 | BookReview `[review, review_senior]` | `book_production:review` \|\| `book_production:approve` |
| app/src/navigation/DrawerContent.tsx:235 | BookEscalationInbox `[review, review_senior]` | `book_production:review` \|\| `book_production:approve` |
| app/src/navigation/DrawerContent.tsx:242 | BookAssemble `[book:assemble]` | `book_production:assemble` |
| app/src/screens/admin/AdminHomeScreen.tsx:17 | `can("content:import")` | `lesson_plans:import` \|\| `question_bank:import` |
| app/src/screens/content/PlanViewScreen.tsx:57 | `content:assign_review` | `plan_review:assign` |
| app/src/screens/content/PlanViewScreen.tsx:58 | `content:promote_gold` | `plan_review:approve` |
| app/src/screens/home/TodayScreen.tsx:139 | `question:read` | `question_bank:view` |
| app/src/screens/home/TodayScreen.tsx:140 | `set:read` | `question_sets:view` |
| app/src/screens/questions/QuestionBankScreen.tsx:181 | `!can("question:manage")` → published only (proxies the server's isAdminStaff) | `!can("question_bank:view_all")` |
| app/src/screens/questions/QuestionPreviewScreen.tsx:112 | `question:manage` | `question_bank:edit`; retire/restore buttons → `question_bank:delete` |
| app/src/screens/review/PublishQuestionsScreen.tsx:81 | `question:manage` | `question_bank:edit` |
| app/src/screens/review/QuestionReviewerRoundsScreen.tsx:83 | `question:manage` | `question_bank:edit` |
| app/src/screens/review/ReviewHomeScreen.tsx:82 | `content:assign_review` | per tab: `plan_review:assign` / `question_review:assign` |
| app/src/screens/review/ReviewHomeScreen.tsx:83 | `content:review` | per tab: `plan_review:review` / `question_review:review` |
| app/src/screens/review/ReviewHomeScreen.tsx:113 | `content:promote_gold` | per tab: `plan_review:approve` / `question_review:publish` |
| app/src/screens/review/ReviewThreadScreen.tsx:94 | `content:assign_review` | `plan_review:assign` |
| app/src/screens/review/ReviewThreadScreen.tsx:95 | `content:promote_gold` | `plan_review:approve` |
| app/src/screens/scholarship/ScholarshipCandidatesScreen.tsx:67 | `scholarship:manage` (T sees it editable; the server refuses T) | `scholarship_practice:select_candidates` (F-32) |
| app/src/screens/scholarship/ScholarshipHomeScreen.tsx:181 | `scholarship:manage` | `scholarship_practice:create` |
| app/src/screens/scholarship/ScholarshipMarksScreen.tsx:158 | `!scholarship:manage` → read only | `!can("scholarship_practice:enter_results")` → read only |
| app/src/screens/supportbook/BookEscalationInboxScreen.tsx:157 | `book:review_senior` | `book_production:approve` |
| app/src/screens/supportbook/BookReviewScreen.tsx:277 | `book:review \|\| book:review_senior` | `book_production:review` \|\| `book_production:approve` |
| app/src/screens/supportbook/BookReviewScreen.tsx:278 | the above `\|\| book:author` | the above \|\| `book_production:author` |
| app/src/screens/supportbook/BookAssembleScreen.tsx:135 | `role === "PRINCIPAL"` (force) | `book_production:override` (mirrors the server) |
| app/src/screens/syllabus/SyllabusApprovalsScreen.tsx:303 | `exam:manage` (board) | `exam_syllabus:view_all` (board) / `exam_syllabus:edit` (actions) |
| app/src/screens/syllabus/SyllabusApprovalsScreen.tsx:305 | `isRole("PRINCIPAL")` → canPublish (:432) | `exam_syllabus:publish` |

## (g) Notification recipients chosen by role
The inventory names no role-routed notification recipients for this area.

## (h) Build notes
- **One import mutation, two features.** `importFiles` / `importEnvelope` stay single resolvers. Gate with hasAnyPermission over `lesson_plans:import` and `question_bank:import`, detect the kind first (importContentFiles already does), then assert the matching action.
- **Principal-only today, switchable after.** `plan_review:approve` and `question_review:publish` replace `content:promote_gold` (held only by P, not RESERVED), so T and O default off. `exam_syllabus:publish` (publish + the no-holder teacher-stage bypass) and `book_production:override` (build `force`) are PRINCIPAL-DEFAULT. The book self-review stamp stays a PRINCIPAL row property (D-#424). These reverse nothing on ship day; granting them later is the owner's call (D-#397 / #424 / #533 posture).
- **Syllabus send-back at PRINCIPAL_REVIEW.** O can do it today via `exam:manage`; `exam_syllabus:edit` (O on) keeps that. Whether O should keep it is an open owner question. vocab.ts says O is refused publish "by state"; the code refuses by role, and the new gate is `exam_syllabus:publish`.
- **Teacher sign-off stays out of the editor.** approve / send back at TEACHER_REVIEW is a routine-derived row fact (D-#533, CO-1 posture). prd-exams EX-1 will extend `exam_syllabus:settings`.
- **`question:select` is redundant** (createSetWithQuestions already selects on `set:assemble` alone); both fold into `question_sets:create`. **`set:export` is never checked** today; `question_sets:export` becomes the real gate on /pdf/set (F-19).
- **assertCanWrite OFFICE refusal.** Today granting O set writes is still refused by role. After the change O passes only with scope or `question_sets:edit_all`; the editor may now offer `question_sets:create` to O.
- **questionUsage reads stay on `question_sets:view`.** Moving them to `question_bank:view` would give them to O (F-17).
- **Two-hat shifts.** contentScope and the scholarship role checks read the primary role only (F-27). With `question_bank:view_all` and `scholarship_practice:edit_all` (O on), a teacher holding the OFFICE template gains the unscoped question view and the any-section scholarship write (2H).
- **Scholarship topic save vs retire** are split (`settings` vs `delete`) because the holders differ today (save P/T/O, retire P/O).
- **`scholarship_practice:release` (SC-5) is future**, not built; planned PRINCIPAL-DEFAULT.
- **Migration.** Existing AC-1 `grantedPermissions` / `revokedPermissions` (book:* for illustrators and reviewers, content:* grants) must translate through `LEGACY_PERMISSION_EXPANSION`. Other consumers of these strings need the same remap: `content:read` in `server/src/modules/corpus/resolvers/analytics.ts:42` and /pdf/artifact, and the `roster:manage` print exceptions on /pdf/artifact and /pdf/set.
- **Book author chat.** The author-chat service exists but is not exposed; it needs a gate (`book_production:author`) only when a resolver is added.
- **/pdf/artifact row scope.** Verify whether content row scope applies on the REST route (it does on the GraphQL reads).

Listed elsewhere: none. The `assessment/resolvers/assessment.ts` and `assessment/routes/setPdf.ts` rows (question_sets) are owned here; trackers-classtest.md cross-references them. The /pdf/artifact and /pdf/set print-queue branches use `printing:view_all`, owned by hr-finance.md.

## (g) `mastery` — learning-outcome mastery tracker (added with M-0, 2026-10-20, D-#775–#787)
Already one-to-one with today's permissions; no hidden role gate, no REST route yet.

### Mutations
| file:line | resolver | today's gate | → new gate |
|---|---|---|---|
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:356 | importMasteryCatalogue | `mastery:manage` | `mastery:settings` |
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:369 | lockMasteryCatalogue | `mastery:manage` | `mastery:settings` |
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:381 | saveMasteryOutcome | `mastery:manage` | `mastery:settings` |
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:407 | retireMasteryOutcome | `mastery:manage` | `mastery:delete` |
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:415 | saveMasteryQuestionType | `mastery:manage` | `mastery:settings` |
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:445 | saveMasteryTag | `mastery:manage`; routing tag needs its strand in every scope (svc) | `mastery:settings`; strand rule (stays) |
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:474 | saveMasteryPolicy | `mastery:manage`; validated on resolved values (svc) | `mastery:settings`; validation (stays) |
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:494 | setMasteryEnablement | `mastery:manage`; ON needs a locked catalogue (svc) | `mastery:settings`; lock rule (stays) |

### Queries
| file:line | resolver | today's gate | → new gate |
|---|---|---|---|
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:303 | masteryCoverage | `mastery:read`; curriculum reference, not row-scoped | `mastery:view` |
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:310 | masteryCatalogue | `mastery:read`; not row-scoped | `mastery:view` |
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:323 | masteryTags | `mastery:read` | `mastery:view` |
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:330 | masteryPolicy | `mastery:read` | `mastery:view` |
| server/src/modules/mastery/resolvers/masteryCatalogue.ts:342 | masteryEnablements | `mastery:read` | `mastery:view` |

### App gates
| file:line | today | → new |
|---|---|---|
| app/src/navigation/AppTabs.tsx:1787 | `mastery:read \|\| mastery:manage` | `mastery:view` \|\| `mastery:settings` |
| app/src/navigation/DrawerContent.tsx:129–132 | msCatalogueHome/msTags/msPolicy `["mastery:read"]`, msImport `["mastery:manage"]` | `mastery:view` / `mastery:settings` |
| app/src/screens/mastery/*.tsx (Home :24, Catalogue :40, Marks :33, Policy :38, Tags :81) | `can("mastery:manage")` shows write controls | `can("mastery:settings")` (retire on Catalogue → `mastery:delete`) |


### M-2 (2026-10-21, D-#807) — work sheets & exceptions-only entry
| file | resolver | gate (already catalogue-native) |
|---|---|---|
| server/src/modules/mastery/resolvers/masteryWork.ts | masteryPapersPage | `mastery:view`; svc: routine holder or `mastery:edit_all` |
| server/src/modules/mastery/resolvers/masteryWork.ts | masteryPaper | `mastery:view`; svc: routine holder or `mastery:edit_all` |
| server/src/modules/mastery/resolvers/masteryWork.ts | masteryHomeworkOptions | `mastery:create`; svc: routine holder or `mastery:edit_all` |
| server/src/modules/mastery/resolvers/masteryWork.ts | createMasteryPaper | `mastery:create`; svc: routine holder or `mastery:edit_all`; switch on; LOCKED outcomes; gold bank items |
| server/src/modules/mastery/resolvers/masteryWork.ts | deleteMasteryPaper | `mastery:create`; svc: OPEN + no results |
| server/src/modules/mastery/resolvers/masteryWork.ts | saveMasteryResults | `mastery:enter_results`; svc: routine holder or `mastery:edit_all` |
| server/src/modules/mastery/resolvers/masteryWork.ts | confirmMasteryPaper | `mastery:enter_results`; svc: routine holder or `mastery:edit_all` |

App: `MasteryTab` opens on `mastery:view` || `mastery:settings` || `mastery:enter_results`; the drawer leaf প্রশ্নভিত্তিক নম্বর on `mastery:enter_results`; the new-sheet button on `mastery:create`. Reach: `MasteryWorkHomeScreen` lists sections via `useAccessibleClasses({ viewAll: "mastery:edit_all" })`.

### M-3 (2026-10-22, D-#808) — diagnosis views, quality report, exclusion
| file | resolver | gate (already catalogue-native) |
|---|---|---|
| server/src/modules/mastery/resolvers/masteryDiagnosis.ts | masteryStudentDiagnosis | `mastery:view`; svc: routine holder or `mastery:edit_all` (the student's section × subject) |
| server/src/modules/mastery/resolvers/masteryDiagnosis.ts | masteryOutcomeTrail | `mastery:view`; svc: routine holder or `mastery:edit_all` |
| server/src/modules/mastery/resolvers/masteryDiagnosis.ts | masterySectionHeatmap | `mastery:view`; svc: routine holder or `mastery:edit_all` |
| server/src/modules/mastery/resolvers/masteryDiagnosis.ts | masteryQualityPapersPage | `mastery:view`; svc: routine holder or `mastery:edit_all` |
| server/src/modules/mastery/resolvers/masteryDiagnosis.ts | masteryPaperQuality | `mastery:view`; svc: routine holder or `mastery:edit_all` |
| server/src/modules/mastery/resolvers/masteryDiagnosis.ts | excludeMasteryItem | `mastery:enter_results`; svc: routine holder or `mastery:edit_all`; reason required |
| server/src/modules/mastery/resolvers/masteryDiagnosis.ts | revokeMasteryExclusion | `mastery:enter_results`; svc: routine holder or `mastery:edit_all` |

App: the heat-map and quality buttons on `MasteryWorkHomeScreen` (reached as in M-2); exclude / bring back on `mastery:enter_results`. No new catalogue action: the views reuse `mastery:view` + the M-2 row rule; a school-wide `view_all` waits for M-5.

### M-4 (2026-10-22, D-#809) — weekly tailored assignment
| file | resolver / route | gate (already catalogue-native) |
|---|---|---|
| server/src/modules/mastery/resolvers/masteryAssignment.ts | masteryAssignment | `mastery:view`; svc: routine holder or `mastery:edit_all` |
| server/src/modules/mastery/resolvers/masteryAssignment.ts | masteryAssignmentSheet | `mastery:view`; svc: routine holder or `mastery:edit_all` |
| server/src/modules/mastery/resolvers/masteryAssignment.ts | masteryAssignmentTrackerItems | `mastery:create`; svc: routine holder or `mastery:edit_all` (read-only link options) |
| server/src/modules/mastery/resolvers/masteryAssignment.ts | buildMasteryAssignment | `mastery:create`; svc: row rule + switch on |
| server/src/modules/mastery/resolvers/masteryAssignment.ts | editMasteryAssignmentSheet | `mastery:create`; svc: row rule; DRAFT only |
| server/src/modules/mastery/resolvers/masteryAssignment.ts | approveMasteryAssignmentSheets | `mastery:create`; svc: row rule; DRAFT only |
| server/src/modules/mastery/resolvers/masteryAssignment.ts | sendMasteryAssignment | `mastery:create`; svc: row rule + switch; every sheet approved |
| server/src/modules/mastery/resolvers/masteryAssignment.ts | deleteMasteryAssignment | `mastery:create`; svc: row rule; DRAFT only |
| server/src/modules/mastery/routes/masteryAssignmentPdf.ts | GET /pdf/mastery-assignment/:id | `mastery:view` (route) + svc row rule |

App: the সাপ্তাহিক অ্যাসাইনমেন্ট button on `MasteryWorkHomeScreen`; layout, rebuild, approve and send on `mastery:create`. Entry of the sent AS sheet reuses M-2 (`mastery:enter_results`).

### M-4b (2026-10-22, D-#810) — guardian view of the weekly assignment
| file | resolver / route | gate |
|---|---|---|
| server/src/modules/mastery/resolvers/masteryGuardian.ts | childMasteryAssignments | `guardian:read_child` (non-catalogue guardian plane) + `assertGuardianOfStudent`; switched-off subjects hidden |
| server/src/modules/mastery/routes/masteryAssignmentPdf.ts | GET /pdf/mastery-assignment/:id?studentId= (guardian path) | `guardian:read_child` + `assertGuardianOfStudent(studentId)`; SENT only; that child's page only; switch on |

App: `ChildMasteryAssignments` on the guardian's Assignments tab (`ChildAssignmentsScreen`), rendered only when the query returns weeks.

### M-5 (2026-10-22, D-#811) — section trigger → extra class → re-test → close
| file | resolver | gate |
|---|---|---|
| server/src/modules/mastery/resolvers/masteryAction.ts | masteryAction | `mastery:view`; svc: `mastery:approve` OR the routine holder (or `mastery:edit_all`) of its section × subject |
| server/src/modules/mastery/resolvers/masteryAction.ts | masteryActionsPage | `mastery:view`; svc: school-wide needs `mastery:approve`; one section × subject needs approve or the row rule |
| server/src/modules/mastery/resolvers/masteryAction.ts | masteryActionCounts | `mastery:approve` |
| server/src/modules/mastery/resolvers/masteryAction.ts | decideMasteryAction | `mastery:approve` (checked again in the svc) |
| server/src/modules/mastery/resolvers/masteryAction.ts | recordMasteryExtraClass | `mastery:enter_results`; svc: approve OR row rule |
| server/src/modules/mastery/resolvers/masteryAction.ts | buildMasteryRetest | `mastery:create`; svc: approve OR row rule |
| server/src/modules/mastery/resolvers/masteryAction.ts | closeMasteryAction | `mastery:enter_results`; svc: approve OR row rule |

`mastery:approve` now gates real fields, so it left `DECLARED_AHEAD` in `permissionCatalogueGates.test.ts` (the list is empty). App: drawer leaf পুরো স্কুল · পদক্ষেপ (`MasteryLeader`) on `mastery:approve`; `MasteryTab` also opens on `mastery:approve`; পদক্ষেপের রেকর্ড on the work home; the heat-map banner links an open action.

### M-6 (2026-10-22, D-#812) — guardian progress, notifications
| file | resolver | gate |
|---|---|---|
| server/src/modules/mastery/resolvers/masteryGuardian.ts | childMasteryProgress | `guardian:read_child` (non-catalogue guardian plane) + `assertGuardianOfStudent`; switched-off subjects hidden |

Notifications (no new catalogue action): MASTERY_PROPOSAL recipients = `holderIdsOf("mastery:approve")`; MASTERY_EXTRA_CLASS = the routine teacher + planned students' guardians; MASTERY_ASSIGNMENT_SENT = the students' guardians. App: guardian drawer item + Today shortcut শিখন-দক্ষতা (`ChildMastery`).

Later slices add their rows here: M-2/M-4 entry and builder (`mastery:enter_results`, `mastery:create`, routine class × subject check in the service), M-5 approval (`mastery:approve`), M-6 guardian reads (`guardian:read_child` + assertGuardianOfStudent).
