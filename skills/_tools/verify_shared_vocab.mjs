// Executed verification for the /shared vocab. Run:
//   npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json
// Proves (a) mirrored enums equal the envelope JSON Schema, (b) RBAC invariants hold.
// Consumes the TypeScript source of truth directly (no build step) via the tsx runner.
import fs from "node:fs";
import * as V from "../../shared/vocab.ts";

const SCHEMA = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const P = SCHEMA.properties, D = SCHEMA.$defs;

let fails = 0;
const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
function check(name, cond) { console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) fails++; }

console.log("=== A. mirrored enums match the envelope schema ===");
check("subject",        eq(V.SUBJECTS,        P.subject.enum));
check("doc_type",       eq(V.DOC_TYPES,       P.doc_type.enum));
check("curation_tag",   eq(V.CURATION_TAGS,   P.curation_tag.enum));
check("review_status",  eq(V.REVIEW_STATUSES, P.review_status.enum));
check("bloom_level",    eq(V.BLOOM_LEVELS,    D.bloomLevelEN.enum));
check("difficulty",     eq(V.DIFFICULTIES,    P.tags.properties.difficulty.enum));
check("question_type",  eq(V.QUESTION_TYPES,  D.questionPayload.properties.question_type.enum));
check("paper_role",     eq(V.PAPER_ROLES,     P.tags.properties.paper_role.enum));
check("source_project", eq(V.SOURCE_PROJECTS, P.provenance.properties.source_project.enum));
check("anchor_word",    eq(V.ANCHOR_WORDS,    D.addressBlock.properties.anchor_word.enum));
check("class_level min/max", V.CLASS_LEVEL_MIN === P.class_level.minimum && V.CLASS_LEVEL_MAX === P.class_level.maximum);

console.log("=== B. RBAC invariants ===");
const allRolePerms = Object.values(V.ROLE_PERMISSIONS).flat();
check("every granted perm is a declared PERMISSION", allRolePerms.every((p) => V.PERMISSIONS.includes(p)));
check("PERMISSION_BUILD_STATUS covers every PERMISSION", V.PERMISSIONS.every((p) => p in V.PERMISSION_BUILD_STATUS));
check("default-deny: unknown perm on a real role", V.roleHasPermission("TEACHER", "nonsense:perm") === false);
check("default-deny: unknown role", V.roleHasPermission("GHOST", "content:read") === false);
check("PRINCIPAL has user:manage + audit:read", V.roleHasPermission("PRINCIPAL", "user:manage") && V.roleHasPermission("PRINCIPAL", "audit:read"));
check("TEACHER lacks user:manage / audit:read / content:import", !["user:manage","audit:read","content:import"].some((p) => V.roleHasPermission("TEACHER", p)));
check("TEACHER can read content + assemble + write trackers", ["content:read","set:assemble","tracker:write"].every((p) => V.roleHasPermission("TEACHER", p)));
check("OFFICE = roster/staff/leave/payroll/performance/guardian/message/import/assign_review/question(read+manage)/routine/attendance/library/chat/observation/finance/report/exam", eq(V.permissionsForRole("OFFICE"), ["roster:manage","staff:manage","leave:manage","payroll:manage","performance:manage","guardian:link","message:dispatch","content:import","content:assign_review","question:read","question:manage","routine:read","routine:manage","attendance:manage","library:read","library:manage","chat:read","chat:write","chat:manage","observation:upload","observation:read","observation:manage","finance:manage","report:release","exam:manage","exam:read"]));
// question:manage is the desk's correction power, NOT a teaching one (D-#548): Office and the
// Principal hold it; a TEACHER — reviewer included — must still go through a review verdict.
check("question:manage is Principal + Office only; TEACHER and GUARDIAN never", V.roleHasPermission("PRINCIPAL","question:manage") && V.roleHasPermission("OFFICE","question:manage") && !V.roleHasPermission("TEACHER","question:manage") && !V.roleHasPermission("GUARDIAN","question:manage"));
// Office can open the bank it is allowed to correct, but assembling a set stays a teaching call.
check("OFFICE reads questions but does not select them for sets", V.roleHasPermission("OFFICE","question:read") && !V.roleHasPermission("OFFICE","question:select"));
check("routine: PRINCIPAL+OFFICE manage, TEACHER read-only, GUARDIAN none", V.roleHasPermission("PRINCIPAL","routine:manage") && V.roleHasPermission("OFFICE","routine:manage") && V.roleHasPermission("TEACHER","routine:read") && !V.roleHasPermission("TEACHER","routine:manage") && !V.roleHasPermission("GUARDIAN","routine:read"));
check("TEACHER has content:review (reviewer APPROVE), lacks assign/promote", V.roleHasPermission("TEACHER","content:review") && !["content:assign_review","content:promote_gold"].some((p) => V.roleHasPermission("TEACHER", p)));
check("GUARDIAN only has guardian:read_child", eq(V.permissionsForRole("GUARDIAN"), ["guardian:read_child"]));
check("no role can write audit (audit:write undeclared)", !V.PERMISSIONS.includes("audit:write"));
check("NO pipeline perms remain — every permission is BUILD (chat:oversee flipped at M-6 per D-#111; chat:manage at M-2 per D-#98)", eq(V.PERMISSIONS.filter((p) => V.PERMISSION_BUILD_STATUS[p] !== "build"), []));

console.log("=== C. label maps total over their enums ===");
const total = (labels, keys) => keys.every((k) => typeof labels[k] === "string" && labels[k].length > 0);
check("SUBJECT_LABELS_BN total",     total(V.SUBJECT_LABELS_BN, V.SUBJECTS));
check("DOC_TYPE_LABELS_BN total",    total(V.DOC_TYPE_LABELS_BN, V.DOC_TYPES));
check("CURATION_TAG_LABELS_BN total",total(V.CURATION_TAG_LABELS_BN, V.CURATION_TAGS));
check("DIFFICULTY_LABELS_BN total",  total(V.DIFFICULTY_LABELS_BN, V.DIFFICULTIES));
check("PAPER_ROLE_LABELS_BN total",  total(V.PAPER_ROLE_LABELS_BN, V.PAPER_ROLES));
check("REVIEW_STATUS_LABELS_BN total",total(V.REVIEW_STATUS_LABELS_BN, V.REVIEW_STATUSES));
check("REVIEW_VERDICT_LABELS_BN total",total(V.REVIEW_VERDICT_LABELS_BN, V.REVIEW_VERDICTS));
check("SET_TYPE_LABELS_BN total",    total(V.SET_TYPE_LABELS_BN, V.SET_TYPES));
check("TRACKER_KIND_LABELS_BN total",total(V.TRACKER_KIND_LABELS_BN, V.TRACKER_KINDS));
check("SET_TYPE_TO_TRACKER total + valid", V.SET_TYPES.every((s) => V.TRACKER_KINDS.includes(V.SET_TYPE_TO_TRACKER[s])));
check("HR_CATEGORY_LABELS_BN total",       total(V.HR_CATEGORY_LABELS_BN, V.HR_CATEGORIES));
check("EMPLOYMENT_TYPE_LABELS_BN total",   total(V.EMPLOYMENT_TYPE_LABELS_BN, V.EMPLOYMENT_TYPES));
check("EMPLOYMENT_STATUS_LABELS_BN total", total(V.EMPLOYMENT_STATUS_LABELS_BN, V.EMPLOYMENT_STATUSES));
check("HW_SUBJECT_LABELS_BN total",        total(V.HW_SUBJECT_LABELS_BN, V.HW_SUBJECTS));
check("HW_SUBJECTS superset of SUBJECTS",  V.SUBJECTS.every((s) => V.HW_SUBJECTS.includes(s)));
check("LIFECYCLE_STATE_LABELS_BN total",   total(V.LIFECYCLE_STATE_LABELS_BN, V.LIFECYCLE_STATES));
check("HW_RESULT_LABELS_BN total",         total(V.HW_RESULT_LABELS_BN, V.HW_RESULTS));
check("RECON_STATE_LABELS_BN total",       total(V.RECON_STATE_LABELS_BN, V.RECON_STATES));
check("TRIM_RANK_LABELS_BN total",         total(V.TRIM_RANK_LABELS_BN, V.TRIM_RANKS));
check("HW locked figures (120/120/40/20)", V.HW_DAILY_CEILING_MIN === 120 && V.HW_DAILY_FLOOR_MIN === 120 && V.HW_SUBJECT_BAND_MAX_MIN === 40 && V.HW_DEFAULT_TIME_DECL_MIN === 20);

console.log("=== C.2 English label maps total over their enums (bilingual UI) ===");
check("ROSTER_CLASS_LABELS_EN total",      total(V.ROSTER_CLASS_LABELS_EN, V.ROSTER_CLASS_LEVELS));
check("SUBJECT_LABELS_EN total",           total(V.SUBJECT_LABELS_EN, V.SUBJECTS));
check("DOC_TYPE_LABELS_EN total",          total(V.DOC_TYPE_LABELS_EN, V.DOC_TYPES));
check("CURATION_TAG_LABELS_EN total",      total(V.CURATION_TAG_LABELS_EN, V.CURATION_TAGS));
check("DIFFICULTY_LABELS_EN total",        total(V.DIFFICULTY_LABELS_EN, V.DIFFICULTIES));
check("PAPER_ROLE_LABELS_EN total",        total(V.PAPER_ROLE_LABELS_EN, V.PAPER_ROLES));
check("REVIEW_STATUS_LABELS_EN total",     total(V.REVIEW_STATUS_LABELS_EN, V.REVIEW_STATUSES));
check("REVIEW_VERDICT_LABELS_EN total",    total(V.REVIEW_VERDICT_LABELS_EN, V.REVIEW_VERDICTS));
check("SET_TYPE_LABELS_EN total",          total(V.SET_TYPE_LABELS_EN, V.SET_TYPES));
check("TRACKER_KIND_LABELS_EN total",      total(V.TRACKER_KIND_LABELS_EN, V.TRACKER_KINDS));
check("HR_CATEGORY_LABELS_EN total",       total(V.HR_CATEGORY_LABELS_EN, V.HR_CATEGORIES));
check("EMPLOYMENT_TYPE_LABELS_EN total",   total(V.EMPLOYMENT_TYPE_LABELS_EN, V.EMPLOYMENT_TYPES));
check("EMPLOYMENT_STATUS_LABELS_EN total", total(V.EMPLOYMENT_STATUS_LABELS_EN, V.EMPLOYMENT_STATUSES));
check("HW_SUBJECT_LABELS_EN total",        total(V.HW_SUBJECT_LABELS_EN, V.HW_SUBJECTS));
check("LIFECYCLE_STATE_LABELS_EN total",   total(V.LIFECYCLE_STATE_LABELS_EN, V.LIFECYCLE_STATES));
check("HW_RESULT_LABELS_EN total",         total(V.HW_RESULT_LABELS_EN, V.HW_RESULTS));
check("RECON_STATE_LABELS_EN total",       total(V.RECON_STATE_LABELS_EN, V.RECON_STATES));
check("TRIM_RANK_LABELS_EN total",         total(V.TRIM_RANK_LABELS_EN, V.TRIM_RANKS));

console.log("=== C.3 Routine/timetable label maps + invariants (D-#46–#57) ===");
check("DAY_OF_WEEK_LABELS_BN total",       total(V.DAY_OF_WEEK_LABELS_BN, V.DAYS_OF_WEEK));
check("DAY_OF_WEEK_LABELS_EN total",       total(V.DAY_OF_WEEK_LABELS_EN, V.DAYS_OF_WEEK));
check("DAY_TYPE_LABELS_BN total",          total(V.DAY_TYPE_LABELS_BN, V.DAY_TYPES));
check("DAY_TYPE_LABELS_EN total",          total(V.DAY_TYPE_LABELS_EN, V.DAY_TYPES));
check("PERIOD_TRACK_LABELS_BN total",      total(V.PERIOD_TRACK_LABELS_BN, V.PERIOD_TRACKS));
check("PERIOD_TRACK_LABELS_EN total",      total(V.PERIOD_TRACK_LABELS_EN, V.PERIOD_TRACKS));
check("SEASON_LABELS_BN total",            total(V.SEASON_LABELS_BN, V.SEASONS));
check("SEASON_LABELS_EN total",            total(V.SEASON_LABELS_EN, V.SEASONS));
check("HOLIDAY_TYPE_LABELS_BN total",      total(V.HOLIDAY_TYPE_LABELS_BN, V.HOLIDAY_TYPES));
check("HOLIDAY_TYPE_LABELS_EN total",      total(V.HOLIDAY_TYPE_LABELS_EN, V.HOLIDAY_TYPES));
check("GROUP_GENDER_LABELS_BN total",      total(V.GROUP_GENDER_LABELS_BN, V.GROUP_GENDERS));
check("GROUP_GENDER_LABELS_EN total",      total(V.GROUP_GENDER_LABELS_EN, V.GROUP_GENDERS));
check("ROUTINE_SUBJECT_LABELS_BN total",   total(V.ROUTINE_SUBJECT_LABELS_BN, V.ROUTINE_SUBJECTS));
check("ROUTINE_SUBJECT_LABELS_EN total",   total(V.ROUTINE_SUBJECT_LABELS_EN, V.ROUTINE_SUBJECTS));
check("ROUTINE_SUBJECTS superset of HW_SUBJECTS", V.HW_SUBJECTS.every((s) => V.ROUTINE_SUBJECTS.includes(s)));
check("ROUTINE_SUBJECTS adds QURAN",       V.ROUTINE_SUBJECTS.includes("QURAN") && !V.HW_SUBJECTS.includes("QURAN"));
check("ROUTINE_SUBJECTS_CLASS3_PLUS ⊂ ROUTINE_SUBJECTS", V.ROUTINE_SUBJECTS_CLASS3_PLUS.every((s) => V.ROUTINE_SUBJECTS.includes(s)));
check("DAYS_OF_WEEK index-aligned to getDay (7 days, SUN first)", V.DAYS_OF_WEEK.length === 7 && V.DAYS_OF_WEEK[0] === "SUN" && V.DAYS_OF_WEEK[6] === "SAT");

console.log("=== C.4 Attendance label maps + RBAC invariants (D-#63–#67) ===");
check("TEACHER_ATTENDANCE_STATUS_LABELS_BN total", total(V.TEACHER_ATTENDANCE_STATUS_LABELS_BN, V.TEACHER_ATTENDANCE_STATUSES));
check("TEACHER_ATTENDANCE_STATUS_LABELS_EN total", total(V.TEACHER_ATTENDANCE_STATUS_LABELS_EN, V.TEACHER_ATTENDANCE_STATUSES));
check("ATTENDANCE_REMINDER_TIER_LABELS_BN total",  total(V.ATTENDANCE_REMINDER_TIER_LABELS_BN, V.ATTENDANCE_REMINDER_TIERS));
check("ATTENDANCE_REMINDER_TIER_LABELS_EN total",  total(V.ATTENDANCE_REMINDER_TIER_LABELS_EN, V.ATTENDANCE_REMINDER_TIERS));
check("reminder tiers are exactly T1210/T1245/T1400 (D-#65)", eq(V.ATTENDANCE_REMINDER_TIERS, ["T1210","T1245","T1400"]));
check("attendance: PRINCIPAL+OFFICE manage (not mark), TEACHER mark (not manage), GUARDIAN none",
  V.roleHasPermission("PRINCIPAL","attendance:manage") && !V.roleHasPermission("PRINCIPAL","attendance:mark") &&
  V.roleHasPermission("OFFICE","attendance:manage") && !V.roleHasPermission("OFFICE","attendance:mark") &&
  V.roleHasPermission("TEACHER","attendance:mark") && !V.roleHasPermission("TEACHER","attendance:manage") &&
  !V.roleHasPermission("GUARDIAN","attendance:mark") && !V.roleHasPermission("GUARDIAN","attendance:manage"));

console.log("=== C.5 Notification kinds + own-row posture (D-#72–#75) ===");
check("NOTIFICATION_KIND_LABELS_BN total", total(V.NOTIFICATION_KIND_LABELS_BN, V.NOTIFICATION_KINDS));
check("NOTIFICATION_KIND_LABELS_EN total", total(V.NOTIFICATION_KIND_LABELS_EN, V.NOTIFICATION_KINDS));
check("kinds are exactly the 8 phase-1 kinds + 2 library kinds + 1 class-test kind + 1 vocab kind + 1 student-comment kind + 5 classroom-observation kinds + 1 finance kind + 2 saturday-revision kinds + 1 homework-chase kind + 1 assignment-chase kind + 3 homework-confirm kinds + 2 print kinds + 2 ct-question kinds + 2 ct-result kinds + 1 upcoming-class-test kind (D-#472) (D-#72/#74/#84/#122; VC-4 += VOCAB_RESULT, D-#154; CM-2 += STUDENT_COMMENT, D-#172; CO-3 += OBSERVATION_*; CO-8 += OBSERVATION_READY_TO_PUBLISH, D-#271; FIN-2B += FINANCE_FEE_DUE, D-#227; SR-2 += SR_ABSENT/SR_DIGEST, D-#244; HW per-chase += HW_CHASE, D-#260; AS-T4 per-chase += ASSIGNMENT_CHASE, D-#88/#94; HW pending-confirm += HW_PENDING_REMINDER/HW_PENDING_ESCALATION; auto-issue += HW_AUTO_ISSUED, D-#314; PQ-5 += PRINT_DELIVERED, D-#281; web-push += PRINT_REQUESTED, D-#296; CT question loop += CT_QUESTION_REVIEW/CT_QUESTION_OFFICE, D-#342; CT-8 submit/approve loop += CT_RESULT_SUBMITTED/CT_RESULT_PUBLISHED; MR-6 += MONTHLY_REPORT; weekly digest += HW_WEEKLY_DIGEST, D-#452; guardian work claim += WORK_CLAIM_FILED/WORK_CLAIM_ESCALATED/WORK_CLAIM_RESOLVED, D-#551..#554; RL-2 += STUDENT_RETURNED, D-#556; 08:00 overdue digest += CLASS_TEST_OVERDUE_DIGEST, D-#603)", eq(V.NOTIFICATION_KINDS, ["BELL_REMINDER","ATTENDANCE_REMINDER","CLASS_NOTE_PROMPT","CLASS_NOTE_ESCALATION","CLASS_NOTE_PUBLISHED","HW_PARENT_COMMS","HW_CHASE","ASSIGNMENT_CHASE","REVIEW_ASSIGNED","COVER_ASSIGNED","LIBRARY_DUE_SOON","LIBRARY_OVERDUE","CLASS_TEST_RESULT","CLASS_TEST_UPCOMING","CLASS_TEST_OVERDUE_DIGEST","VOCAB_RESULT","STUDENT_COMMENT","MONTHLY_REPORT","OBSERVATION_RELEASED","OBSERVATION_RESPONSE_REMINDER","OBSERVATION_ESCALATED","OBSERVATION_RESPONDED","OBSERVATION_READY_TO_PUBLISH","FINANCE_FEE_DUE","SR_ABSENT","SR_DIGEST","HW_PENDING_REMINDER","HW_PENDING_ESCALATION","HW_AUTO_ISSUED","CT_QUESTION_REVIEW","CT_QUESTION_OFFICE","CT_RESULT_SUBMITTED","CT_RESULT_PUBLISHED","PRINT_DELIVERED","PRINT_REQUESTED","STAFF_LEAVE_SUBMITTED","HW_WEEKLY_DIGEST","TEACHING_NOTE_PUBLISHED","TEACHING_NOTE_COMMENT","TEACHING_NOTE_COMMENT_ADDRESSED","WORK_CLAIM_FILED","WORK_CLAIM_ESCALATED","WORK_CLAIM_RESOLVED","STUDENT_RETURNED"]));
check("homework.weeklyDigest.* template keys registered (title + body + wa — MT registry, D-#131/#452)",
  ["homework.weeklyDigest.title","homework.weeklyDigest.body","homework.weeklyDigest.wa"].every((k) => V.MESSAGE_TEMPLATE_KEYS.includes(k) && V.MESSAGE_TEMPLATE_REGISTRY[k]));
check("STAFF_LEAVE_SUBMITTED is a registered NotificationKind (leave submit → approvers, extends §C.5, owner 2026-07-26)", V.NOTIFICATION_KINDS.includes("STAFF_LEAVE_SUBMITTED"));
check("HW_CHASE is a registered NotificationKind (per-chase guardian notify, extends §C.5, D-#260)", V.NOTIFICATION_KINDS.includes("HW_CHASE"));
check("ASSIGNMENT_CHASE is a registered NotificationKind (AS-T4 per-chase guardian notify, extends §C.5, D-#88/#94)", V.NOTIFICATION_KINDS.includes("ASSIGNMENT_CHASE"));
check("homework.chase.* guardian-message template keys registered (title + body — MT registry, D-#131/#260)",
  ["homework.chase.title","homework.chase.body"].every((k) => V.MESSAGE_TEMPLATE_KEYS.includes(k) && V.MESSAGE_TEMPLATE_REGISTRY[k]));
check("no notification:* permission added (inbox is own-row, emission server-internal, D-#72)", !V.PERMISSIONS.some((p) => p.startsWith("notification")));

console.log("=== C.6 Library vocab + RBAC invariants (D-#81–#84) ===");
check("BORROWER_TYPE_LABELS_BN total",      total(V.BORROWER_TYPE_LABELS_BN, V.BORROWER_TYPES));
check("BORROWER_TYPE_LABELS_EN total",      total(V.BORROWER_TYPE_LABELS_EN, V.BORROWER_TYPES));
check("COPY_STATUS_LABELS_BN total",        total(V.COPY_STATUS_LABELS_BN, V.COPY_STATUSES));
check("COPY_STATUS_LABELS_EN total",        total(V.COPY_STATUS_LABELS_EN, V.COPY_STATUSES));
check("LOAN_STATUS_LABELS_BN total",        total(V.LOAN_STATUS_LABELS_BN, V.LOAN_STATUSES));
check("LOAN_STATUS_LABELS_EN total",        total(V.LOAN_STATUS_LABELS_EN, V.LOAN_STATUSES));
check("RESERVATION_STATUS_LABELS_BN total", total(V.RESERVATION_STATUS_LABELS_BN, V.RESERVATION_STATUSES));
check("RESERVATION_STATUS_LABELS_EN total", total(V.RESERVATION_STATUS_LABELS_EN, V.RESERVATION_STATUSES));
check("BOOK_LANGUAGE_LABELS_BN total",      total(V.BOOK_LANGUAGE_LABELS_BN, V.BOOK_LANGUAGES));
check("BOOK_LANGUAGE_LABELS_EN total",      total(V.BOOK_LANGUAGE_LABELS_EN, V.BOOK_LANGUAGES));
check("borrower types are exactly STUDENT/STAFF/GUARDIAN (D-#81)", eq(V.BORROWER_TYPES, ["STUDENT","STAFF","GUARDIAN"]));
check("copy statuses exact (D-#82)", eq(V.COPY_STATUSES, ["AVAILABLE","ON_LOAN","ON_HOLD","LOST","DAMAGED","WITHDRAWN"]));
check("loan statuses exact — overdue is COMPUTED, never a stored status (D-#82)", eq(V.LOAN_STATUSES, ["ACTIVE","RETURNED","LOST"]) && !V.LOAN_STATUSES.includes("OVERDUE"));
check("reservation statuses exact (D-#83)", eq(V.RESERVATION_STATUSES, ["QUEUED","READY","FULFILLED","CANCELLED","EXPIRED"]));
check("book languages exact", eq(V.BOOK_LANGUAGES, ["BANGLA","ARABIC","ENGLISH","OTHER"]));
check("library: PRINCIPAL+OFFICE read+manage, TEACHER read-only (desk via LibrarianAssignment), GUARDIAN none",
  V.roleHasPermission("PRINCIPAL","library:read") && V.roleHasPermission("PRINCIPAL","library:manage") &&
  V.roleHasPermission("OFFICE","library:read") && V.roleHasPermission("OFFICE","library:manage") &&
  V.roleHasPermission("TEACHER","library:read") && !V.roleHasPermission("TEACHER","library:manage") &&
  !V.roleHasPermission("GUARDIAN","library:read") && !V.roleHasPermission("GUARDIAN","library:manage"));
check("no librarian role added — roles stay PRINCIPAL/TEACHER/OFFICE/GUARDIAN (D-#17/#81)", eq(V.ROLES, ["PRINCIPAL","TEACHER","OFFICE","GUARDIAN"]));

console.log("=== C.7 Chat/messaging vocab + RBAC invariants (D-#76–#79) ===");
check("CONVERSATION_KIND_LABELS_BN total",  total(V.CONVERSATION_KIND_LABELS_BN, V.CONVERSATION_KINDS));
check("CONVERSATION_KIND_LABELS_EN total",  total(V.CONVERSATION_KIND_LABELS_EN, V.CONVERSATION_KINDS));
check("POSTING_POLICY_LABELS_BN total",     total(V.POSTING_POLICY_LABELS_BN, V.POSTING_POLICIES));
check("POSTING_POLICY_LABELS_EN total",     total(V.POSTING_POLICY_LABELS_EN, V.POSTING_POLICIES));
check("ATTACHMENT_KIND_LABELS_BN total",    total(V.ATTACHMENT_KIND_LABELS_BN, V.ATTACHMENT_KINDS));
check("ATTACHMENT_KIND_LABELS_EN total",    total(V.ATTACHMENT_KIND_LABELS_EN, V.ATTACHMENT_KINDS));
check("NOTICE_SCOPE_LABELS_BN total",       total(V.NOTICE_SCOPE_LABELS_BN, V.NOTICE_SCOPES));
check("NOTICE_SCOPE_LABELS_EN total",       total(V.NOTICE_SCOPE_LABELS_EN, V.NOTICE_SCOPES));
check("conversation kinds exact (D-#76/#78)", eq(V.CONVERSATION_KINDS, ["DIRECT","SECTION","SUBJECT","SCHOOL","CUSTOM"]));
check("posting policies exact (D-#78)",       eq(V.POSTING_POLICIES, ["OPEN","ANNOUNCEMENT"]));
check("attachment kinds exact (D-#79)",       eq(V.ATTACHMENT_KINDS, ["IMAGE","PDF","VIDEO","AUDIO"]));
check("notice scopes exact (D-#79)",          eq(V.NOTICE_SCOPES, ["SCHOOL","SECTION"]));
check("chat: PRINCIPAL/TEACHER/OFFICE read+write; GUARDIAN none (D-#76 — guardians are never participants)",
  ["PRINCIPAL","TEACHER","OFFICE"].every((r) => V.roleHasPermission(r, "chat:read") && V.roleHasPermission(r, "chat:write")) &&
  !V.roleHasPermission("GUARDIAN","chat:read") && !V.roleHasPermission("GUARDIAN","chat:write"));
check("chat:manage = PRINCIPAL+OFFICE only — teachers cannot create groups (D-#78)",
  V.roleHasPermission("PRINCIPAL","chat:manage") && V.roleHasPermission("OFFICE","chat:manage") &&
  !V.roleHasPermission("TEACHER","chat:manage") && !V.roleHasPermission("GUARDIAN","chat:manage"));
check("chat:oversee = PRINCIPAL ONLY (D-#77)",
  V.roleHasPermission("PRINCIPAL","chat:oversee") &&
  !["TEACHER","OFFICE","GUARDIAN"].some((r) => V.roleHasPermission(r, "chat:oversee")));
check("chat:manage AND chat:oversee are both BUILD (M-2 activated manage; M-6 activates oversight, D-#111)",
  V.PERMISSION_BUILD_STATUS["chat:manage"] === "build" && V.PERMISSION_BUILD_STATUS["chat:oversee"] === "build");

console.log("=== C.8 HR staff-leave vocab + RBAC invariants (HR step 2 — prd-hr §3, D-#22/#23) ===");
check("LEAVE_TYPE_LABELS_BN total",        total(V.LEAVE_TYPE_LABELS_BN, V.LEAVE_TYPES));
check("LEAVE_TYPE_LABELS_EN total",        total(V.LEAVE_TYPE_LABELS_EN, V.LEAVE_TYPES));
check("LEAVE_STATUS_LABELS_BN total",      total(V.LEAVE_STATUS_LABELS_BN, V.LEAVE_STATUSES));
check("LEAVE_STATUS_LABELS_EN total",      total(V.LEAVE_STATUS_LABELS_EN, V.LEAVE_STATUSES));
check("COVER_SLOT_STATUS_LABELS_BN total", total(V.COVER_SLOT_STATUS_LABELS_BN, V.COVER_SLOT_STATUSES));
check("COVER_SLOT_STATUS_LABELS_EN total", total(V.COVER_SLOT_STATUS_LABELS_EN, V.COVER_SLOT_STATUSES));
check("leave types exact (prd-hr §3.2)",    eq(V.LEAVE_TYPES, ["casual","sick","bereavement","maternity","hajj","unpaid_lwp"]));
check("leave statuses exact (prd-hr §9)",   eq(V.LEAVE_STATUSES, ["applied","approved","rejected","cancelled"]));
check("cover-slot statuses exact (D-#22)",  eq(V.COVER_SLOT_STATUSES, ["needs_cover","proposed","approved"]));
check("LEAVE_TYPE_RULES total over LEAVE_TYPES", V.LEAVE_TYPES.every((t) => typeof V.LEAVE_TYPE_RULES[t]?.paid === "boolean"));
check("maternity + hajj are UNPAID event-capped (D-#23, §3.2)",
  V.LEAVE_TYPE_RULES.maternity.paid === false && V.LEAVE_TYPE_RULES.maternity.eventCapped === true &&
  V.LEAVE_TYPE_RULES.hajj.paid === false && V.LEAVE_TYPE_RULES.hajj.eventCapped === true);
check("casual/sick/bereavement are paid+balance-tracked+carryover+encashable (§3.2/§3.4)",
  ["casual","sick","bereavement"].every((t) => {
    const r = V.LEAVE_TYPE_RULES[t];
    return r.paid && r.balanceTracked && r.carryover && r.encashable;
  }));
check("unpaid_lwp = no balance, no pay (§3.3 overflow bucket)",
  V.LEAVE_TYPE_RULES.unpaid_lwp.paid === false && V.LEAVE_TYPE_RULES.unpaid_lwp.balanceTracked === false);

console.log("=== C.8b Staff-hub vocab (docs/prd-staff-hub.md, D-#539–#545) ===");
check("STAFF_LETTER_KIND_LABELS_BN total",   total(V.STAFF_LETTER_KIND_LABELS_BN, V.STAFF_LETTER_KINDS));
check("STAFF_LETTER_KIND_LABELS_EN total",   total(V.STAFF_LETTER_KIND_LABELS_EN, V.STAFF_LETTER_KINDS));
check("STAFF_LETTER_STATUS_LABELS_BN total", total(V.STAFF_LETTER_STATUS_LABELS_BN, V.STAFF_LETTER_STATUSES));
check("STAFF_LETTER_STATUS_LABELS_EN total", total(V.STAFF_LETTER_STATUS_LABELS_EN, V.STAFF_LETTER_STATUSES));
check("SALARY_MODE_LABELS_BN total",         total(V.SALARY_MODE_LABELS_BN, V.SALARY_MODES));
check("SALARY_MODE_LABELS_EN total",         total(V.SALARY_MODE_LABELS_EN, V.SALARY_MODES));
check("letter kinds exact (D-#542, +support_contract D-#586)",
  eq(V.STAFF_LETTER_KINDS, ["appointment","confirmation","service_certificate","support_contract"]));
check("a letter is issued or void — never 'edited' (D-#542)", eq(V.STAFF_LETTER_STATUSES, ["issued","void"]));
check("salary modes are exactly paid|honorary — the two clauses are exclusive (D-#542)", eq(V.SALARY_MODES, ["paid","honorary"]));
check("POOLED_LEAVE_TYPES ⊂ LEAVE_TYPES and are exactly the balance-tracked ones (D-#539)",
  V.POOLED_LEAVE_TYPES.every((t) => V.LEAVE_TYPES.includes(t)) &&
  eq(V.POOLED_LEAVE_TYPES, V.LEAVE_TYPES.filter((t) => V.LEAVE_TYPE_RULES[t].balanceTracked)));
check("the pool is 20 days — the appointment letter's clause 7 (D-#539)", V.HR_POLICY_DEFAULTS.annualLeaveDays === 20);
check("3 late days per charged day (D-#541)", V.HR_POLICY_DEFAULTS.lateDaysPerCharge === 3);
check("probation runs 6 months here, not the Dhaka branch's 3 (D-#586)", V.HR_POLICY_DEFAULTS.probationMonths === 6);
check("lateness rule ships OFF — prd-hr H4.3 made it opt-in, so no existing payslip changes on deploy (D-#541)",
  V.HR_POLICY_DEFAULTS.latenessRuleEnabled === false);
check("'lateness' is already a declared PAY_DEDUCTION_TYPE — SH-4 wires the existing slot, it adds none",
  V.PAY_DEDUCTION_TYPES.includes("lateness"));
check("no staff-hub permission added — letters ride staff:manage, policy rides payroll:manage (§3)",
  !V.PERMISSIONS.some((p) => p.startsWith("letter") || p.startsWith("staffhub")));
check("leave:manage = PRINCIPAL+OFFICE only — TEACHER self-applies own-row (no perm), GUARDIAN none (prd-hr H2.6/H2.7)",
  V.roleHasPermission("PRINCIPAL","leave:manage") && V.roleHasPermission("OFFICE","leave:manage") &&
  !V.roleHasPermission("TEACHER","leave:manage") && !V.roleHasPermission("GUARDIAN","leave:manage"));

console.log("=== C.9 HR payroll vocab + RBAC invariants (HR step 3 — prd-hr §4, D-#26/#27/#109) ===");
check("PAYMENT_METHOD_LABELS_BN total",       total(V.PAYMENT_METHOD_LABELS_BN, V.PAYMENT_METHODS));
check("PAYMENT_METHOD_LABELS_EN total",       total(V.PAYMENT_METHOD_LABELS_EN, V.PAYMENT_METHODS));
check("PAYROLL_RUN_STATUS_LABELS_BN total",   total(V.PAYROLL_RUN_STATUS_LABELS_BN, V.PAYROLL_RUN_STATUSES));
check("PAYROLL_RUN_STATUS_LABELS_EN total",   total(V.PAYROLL_RUN_STATUS_LABELS_EN, V.PAYROLL_RUN_STATUSES));
check("PAY_DEDUCTION_TYPE_LABELS_BN total",   total(V.PAY_DEDUCTION_TYPE_LABELS_BN, V.PAY_DEDUCTION_TYPES));
check("PAY_DEDUCTION_TYPE_LABELS_EN total",   total(V.PAY_DEDUCTION_TYPE_LABELS_EN, V.PAY_DEDUCTION_TYPES));
check("PAY_ADDITION_TYPE_LABELS_BN total",    total(V.PAY_ADDITION_TYPE_LABELS_BN, V.PAY_ADDITION_TYPES));
check("PAY_ADDITION_TYPE_LABELS_EN total",    total(V.PAY_ADDITION_TYPE_LABELS_EN, V.PAY_ADDITION_TYPES));
check("ADVANCE_STATUS_LABELS_BN total",       total(V.ADVANCE_STATUS_LABELS_BN, V.ADVANCE_STATUSES));
check("ADVANCE_STATUS_LABELS_EN total",       total(V.ADVANCE_STATUS_LABELS_EN, V.ADVANCE_STATUSES));
check("payment methods exact (§4.6)",         eq(V.PAYMENT_METHODS, ["bank","bkash","cash"]));
check("payroll run statuses exact — locked is approved_locked (§4.2)", eq(V.PAYROLL_RUN_STATUSES, ["prepared","approved_locked","cancelled"]));
check("advance statuses exact (§4.5, D-#27)", eq(V.ADVANCE_STATUSES, ["active","settled","written_off"]));
check("unpaid_leave is a deduction type (the only always-on attendance-driven deduction, D-#26)", V.PAY_DEDUCTION_TYPES.includes("unpaid_leave"));
check("leave_encashment is an addition type (§4.4)", V.PAY_ADDITION_TYPES.includes("leave_encashment"));
check("payroll: PRINCIPAL+OFFICE manage; approve PRINCIPAL ONLY (Office cannot approve, H4.2/H4.7/D-#109); TEACHER+GUARDIAN none",
  V.roleHasPermission("PRINCIPAL","payroll:manage") && V.roleHasPermission("OFFICE","payroll:manage") &&
  V.roleHasPermission("PRINCIPAL","payroll:approve") && !V.roleHasPermission("OFFICE","payroll:approve") &&
  !["TEACHER","GUARDIAN"].some((r) => V.roleHasPermission(r, "payroll:manage") || V.roleHasPermission(r, "payroll:approve")));

console.log("=== C.10 HR performance/conduct/development vocab + RBAC invariants (HR step 4 — prd-hr §5, D-#28/#112/#113) ===");
check("CONDUCT_STAGE_LABELS_BN total",          total(V.CONDUCT_STAGE_LABELS_BN, V.CONDUCT_STAGES));
check("CONDUCT_STAGE_LABELS_EN total",          total(V.CONDUCT_STAGE_LABELS_EN, V.CONDUCT_STAGES));
check("CONDUCT_RECORD_STATUS_LABELS_BN total",  total(V.CONDUCT_RECORD_STATUS_LABELS_BN, V.CONDUCT_RECORD_STATUSES));
check("CONDUCT_RECORD_STATUS_LABELS_EN total",  total(V.CONDUCT_RECORD_STATUS_LABELS_EN, V.CONDUCT_RECORD_STATUSES));
check("APPRAISAL_STATUS_LABELS_BN total",       total(V.APPRAISAL_STATUS_LABELS_BN, V.APPRAISAL_STATUSES));
check("APPRAISAL_STATUS_LABELS_EN total",       total(V.APPRAISAL_STATUS_LABELS_EN, V.APPRAISAL_STATUSES));
check("APPRAISAL_OUTCOME_LABELS_BN total",      total(V.APPRAISAL_OUTCOME_LABELS_BN, V.APPRAISAL_OUTCOMES));
check("APPRAISAL_OUTCOME_LABELS_EN total",      total(V.APPRAISAL_OUTCOME_LABELS_EN, V.APPRAISAL_OUTCOMES));
check("GRIEVANCE_STATUS_LABELS_BN total",       total(V.GRIEVANCE_STATUS_LABELS_BN, V.GRIEVANCE_STATUSES));
check("GRIEVANCE_STATUS_LABELS_EN total",       total(V.GRIEVANCE_STATUS_LABELS_EN, V.GRIEVANCE_STATUSES));
check("conduct stages are the ordered ladder verbal→written→final→termination (H5.3)", eq(V.CONDUCT_STAGES, ["verbal","written","final","termination"]) && V.CONDUCT_STAGES[0] === "verbal" && V.CONDUCT_STAGES[3] === "termination");
check("conduct record statuses exact (D-#113)", eq(V.CONDUCT_RECORD_STATUSES, ["draft","hearing_held","finalized","lapsed"]));
check("appraisal statuses exact (H5.1)",        eq(V.APPRAISAL_STATUSES, ["draft","signed_off"]));
check("appraisal outcomes exact (§9)",          eq(V.APPRAISAL_OUTCOMES, ["exceeds","meets","needs_improvement","unsatisfactory"]));
check("grievance statuses exact (H5.4)",        eq(V.GRIEVANCE_STATUSES, ["open","under_review","resolved","closed"]));
check("performance:manage = PRINCIPAL+OFFICE; signoff PRINCIPAL ONLY (Office cannot sign off conduct/appraisal, §2/H5.2/D-#112); TEACHER+GUARDIAN none — a supervisor's observation-write rides the EXISTING supervisory scope, NOT a permission (D-#28)",
  V.roleHasPermission("PRINCIPAL","performance:manage") && V.roleHasPermission("OFFICE","performance:manage") &&
  V.roleHasPermission("PRINCIPAL","performance:signoff") && !V.roleHasPermission("OFFICE","performance:signoff") &&
  !["TEACHER","GUARDIAN"].some((r) => V.roleHasPermission(r, "performance:manage") || V.roleHasPermission(r, "performance:signoff")));

console.log("=== C.11 HR offboarding vocab + RBAC invariants (HR step 5 — prd-hr §6, D-#29/#117) ===");
check("OFFBOARDING_TRIGGER_LABELS_BN total",     total(V.OFFBOARDING_TRIGGER_LABELS_BN, V.OFFBOARDING_TRIGGERS));
check("OFFBOARDING_TRIGGER_LABELS_EN total",     total(V.OFFBOARDING_TRIGGER_LABELS_EN, V.OFFBOARDING_TRIGGERS));
check("OFFBOARDING_STATUS_LABELS_BN total",      total(V.OFFBOARDING_STATUS_LABELS_BN, V.OFFBOARDING_STATUSES));
check("OFFBOARDING_STATUS_LABELS_EN total",      total(V.OFFBOARDING_STATUS_LABELS_EN, V.OFFBOARDING_STATUSES));
check("CLEARANCE_ITEM_STATUS_LABELS_BN total",   total(V.CLEARANCE_ITEM_STATUS_LABELS_BN, V.CLEARANCE_ITEM_STATUSES));
check("CLEARANCE_ITEM_STATUS_LABELS_EN total",   total(V.CLEARANCE_ITEM_STATUS_LABELS_EN, V.CLEARANCE_ITEM_STATUSES));
check("offboarding triggers are exactly the 4 H6.1 triggers", eq(V.OFFBOARDING_TRIGGERS, ["resignation","termination","fixed_term_end","retirement"]));
check("offboarding statuses exact (§6)",         eq(V.OFFBOARDING_STATUSES, ["initiated","access_revoked","completed","cancelled"]));
check("clearance item statuses exact (H6.2)",    eq(V.CLEARANCE_ITEM_STATUSES, ["pending","done","waived"]));
check("EMPLOYMENT_STATUSES gained retired + contract_ended so each H6.1 trigger maps to a status (D-#117)",
  V.EMPLOYMENT_STATUSES.includes("retired") && V.EMPLOYMENT_STATUSES.includes("contract_ended") &&
  ["resigned","terminated"].every((s) => V.EMPLOYMENT_STATUSES.includes(s)));
check("offboarding adds NO new permission — it composes from staff:manage (admin/clearance/access) + payroll:manage (settlement compute) + payroll:approve (settlement release/lock, D-#29/#117)",
  !V.PERMISSIONS.some((p) => p.startsWith("offboard")) &&
  V.roleHasPermission("OFFICE","staff:manage") && V.roleHasPermission("PRINCIPAL","payroll:approve") && !V.roleHasPermission("OFFICE","payroll:approve"));

console.log("=== C.12 Vocabulary-tracker vocab + data-driven program/direction model (VC-1 — prd-vocabulary-tracker §3, D-#104/#105) ===");
check("VOCAB_PROGRAM_LABELS_BN total",   total(V.VOCAB_PROGRAM_LABELS_BN, V.VOCAB_PROGRAMS));
check("VOCAB_PROGRAM_LABELS_EN total",   total(V.VOCAB_PROGRAM_LABELS_EN, V.VOCAB_PROGRAMS));
check("VOCAB_DIRECTION_LABELS_BN total", total(V.VOCAB_DIRECTION_LABELS_BN, V.VOCAB_DIRECTIONS));
check("VOCAB_DIRECTION_LABELS_EN total", total(V.VOCAB_DIRECTION_LABELS_EN, V.VOCAB_DIRECTIONS));
check("vocab programs exact (D-#104/#105)",   eq(V.VOCAB_PROGRAMS, ["ENGLISH", "BANGLA", "ARABIC"]));
check("vocab directions exact (D-#105)",      eq(V.VOCAB_DIRECTIONS, ["DICTATION", "HEADWORD_TO_BANGLA", "BANGLA_TO_HEADWORD"]));
check("VOCAB_PROGRAM_DIRECTIONS total over programs; every listed direction is a real VocabDirection (§3.1)",
  V.VOCAB_PROGRAMS.every((p) => Array.isArray(V.VOCAB_PROGRAM_DIRECTIONS[p]) && V.VOCAB_PROGRAM_DIRECTIONS[p].length > 0 &&
    V.VOCAB_PROGRAM_DIRECTIONS[p].every((d) => V.VOCAB_DIRECTIONS.includes(d))));
check("every program declares DICTATION (the multi-field direction, §3.1)",
  V.VOCAB_PROGRAMS.every((p) => V.VOCAB_PROGRAM_DIRECTIONS[p].includes("DICTATION")));
check("VOCAB_DICTATION_FIELDS total + 1 or 2 fields per program (§3.1)",
  V.VOCAB_PROGRAMS.every((p) => [1, 2].includes(V.VOCAB_DICTATION_FIELDS[p])));
check("ENGLISH+ARABIC dictation = 2 fields, BANGLA = 1 (§3.1)",
  V.VOCAB_DICTATION_FIELDS.ENGLISH === 2 && V.VOCAB_DICTATION_FIELDS.ARABIC === 2 && V.VOCAB_DICTATION_FIELDS.BANGLA === 1);
check("BANGLA omits the reverse meaning direction (DICTATION + HEADWORD_TO_BANGLA only, §3.1)",
  eq(V.VOCAB_PROGRAM_DIRECTIONS.BANGLA, ["DICTATION", "HEADWORD_TO_BANGLA"]));
check("no vocab:* permission — word bank rides tracker:write/tracker:read; weekly assignment rides roster:manage (D-#94/#106 compose, no new perm)",
  !V.PERMISSIONS.some((p) => p.startsWith("vocab")));
// VC-2 — test lifecycle + assignment source (prd-vocabulary-tracker §3.3/§3.5, D-#106)
check("VOCAB_TEST_STATUS_LABELS_BN total",        total(V.VOCAB_TEST_STATUS_LABELS_BN, V.VOCAB_TEST_STATUSES));
check("VOCAB_TEST_STATUS_LABELS_EN total",        total(V.VOCAB_TEST_STATUS_LABELS_EN, V.VOCAB_TEST_STATUSES));
check("vocab test statuses exact (§3.3)",         eq(V.VOCAB_TEST_STATUSES, ["draft", "ready", "marked"]));
check("VOCAB_ASSIGNMENT_SOURCE_LABELS_BN total",  total(V.VOCAB_ASSIGNMENT_SOURCE_LABELS_BN, V.VOCAB_ASSIGNMENT_SOURCES));
check("VOCAB_ASSIGNMENT_SOURCE_LABELS_EN total",  total(V.VOCAB_ASSIGNMENT_SOURCE_LABELS_EN, V.VOCAB_ASSIGNMENT_SOURCES));
check("vocab assignment sources exact (§3.5)",    eq(V.VOCAB_ASSIGNMENT_SOURCES, ["direct", "proxy"]));
// VC-3 — per-(student × test) attendance status (prd-vocabulary-tracker §3.6/§4, D-#142)
check("VOCAB_ATTENDANCE_STATUS_LABELS_BN total",  total(V.VOCAB_ATTENDANCE_STATUS_LABELS_BN, V.VOCAB_ATTENDANCE_STATUSES));
check("VOCAB_ATTENDANCE_STATUS_LABELS_EN total",  total(V.VOCAB_ATTENDANCE_STATUS_LABELS_EN, V.VOCAB_ATTENDANCE_STATUSES));
check("vocab attendance statuses exact (§3.6)",   eq(V.VOCAB_ATTENDANCE_STATUSES, ["PRESENT", "ABSENT"]));
// VC-4 — guardian-message delivery: VOCAB_RESULT notification kind + the vocab.result.* template keys (prd-vocabulary-tracker §8, D-#154)
check("VOCAB_RESULT is a registered NotificationKind (§8, extends §C.5)", V.NOTIFICATION_KINDS.includes("VOCAB_RESULT"));
check("vocab.result.* guardian-message template keys registered (Regular/Perfect/Absent/Cumulative + title, §8 — built on the MT registry, D-#131)",
  ["vocab.result.title","vocab.result.regular.body","vocab.result.perfect.body","vocab.result.absent.body","vocab.result.cumulative.body"].every((k) => V.MESSAGE_TEMPLATE_KEYS.includes(k) && V.MESSAGE_TEMPLATE_REGISTRY[k]));

console.log("=== C.13 Message-template vocab + code-default registry + RBAC invariants (MT-1 — prd-message-templates §3, D-#128–#131) ===");
check("TEMPLATE_LANGUAGE_MODES exact (D-#130)",        eq(V.TEMPLATE_LANGUAGE_MODES, ["BN", "EN", "BOTH"]));
check("TEMPLATE_LANGUAGE_MODE_LABELS_BN total",        total(V.TEMPLATE_LANGUAGE_MODE_LABELS_BN, V.TEMPLATE_LANGUAGE_MODES));
check("TEMPLATE_LANGUAGE_MODE_LABELS_EN total",        total(V.TEMPLATE_LANGUAGE_MODE_LABELS_EN, V.TEMPLATE_LANGUAGE_MODES));
check("MESSAGE_TEMPLATE_KEYS non-empty + unique",      V.MESSAGE_TEMPLATE_KEYS.length > 0 && new Set(V.MESSAGE_TEMPLATE_KEYS).size === V.MESSAGE_TEMPLATE_KEYS.length);
check("MESSAGE_TEMPLATE_REGISTRY total over keys (every key has a code default — D-#128/§3.2)",
  V.MESSAGE_TEMPLATE_KEYS.every((k) => {
    const d = V.MESSAGE_TEMPLATE_REGISTRY[k];
    return d && typeof d.bnDefault === "string" && d.bnDefault.length > 0 &&
      Array.isArray(d.placeholders) && typeof d.group === "string" && d.group.length > 0 &&
      typeof d.labelBn === "string" && d.labelBn.length > 0 &&
      V.TEMPLATE_LANGUAGE_MODES.includes(d.defaultLangMode);
  }));
check("registry has no key outside MESSAGE_TEMPLATE_KEYS",
  Object.keys(V.MESSAGE_TEMPLATE_REGISTRY).every((k) => V.MESSAGE_TEMPLATE_KEYS.includes(k)));
const tplTokens = (s) => (typeof s === "string" ? [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]) : []);
check("every {token} in a default body is a DECLARED placeholder (the edit-time safety net, applied to defaults — D-#129)",
  V.MESSAGE_TEMPLATE_KEYS.every((k) => {
    const d = V.MESSAGE_TEMPLATE_REGISTRY[k];
    const declared = new Set(d.placeholders);
    return [...tplTokens(d.bnDefault), ...tplTokens(d.enDefault)].every((t) => declared.has(t));
  }));
check("empty-EN guard at vocab level: a default langMode of EN/BOTH requires a non-empty enDefault (D-#130)",
  V.MESSAGE_TEMPLATE_KEYS.every((k) => {
    const d = V.MESSAGE_TEMPLATE_REGISTRY[k];
    return d.defaultLangMode === "BN" || (typeof d.enDefault === "string" && d.enDefault.length > 0);
  }));
check("template:manage = PRINCIPAL ONLY (verifier-proven exact-holder set — the payroll:approve/performance:signoff posture, D-#129)",
  V.roleHasPermission("PRINCIPAL", "template:manage") &&
  !["TEACHER", "OFFICE", "GUARDIAN"].some((r) => V.roleHasPermission(r, "template:manage")));
check("template:manage is BUILD (MT-1 active)", V.PERMISSION_BUILD_STATUS["template:manage"] === "build");

console.log("=== C.14 Class-test tracker vocab (CT-1 — prd-tracker-class-test §3.1, D-#119–#122) ===");
check("class-test statuses exact (§3.1)",        eq(V.CLASS_TEST_STATUSES, ["REQUESTED", "PRINTED", "CANCELLED"]));
check("CLASS_TEST_STATUS_LABELS_BN total",       total(V.CLASS_TEST_STATUS_LABELS_BN, V.CLASS_TEST_STATUSES));
check("CLASS_TEST_STATUS_LABELS_EN total",       total(V.CLASS_TEST_STATUS_LABELS_EN, V.CLASS_TEST_STATUSES));
check("class-test sources exact (§3.1)",         eq(V.CLASS_TEST_SOURCES, ["POOL_SET", "UPLOADED_PAPER"]));
check("CLASS_TEST_SOURCE_LABELS_BN total",       total(V.CLASS_TEST_SOURCE_LABELS_BN, V.CLASS_TEST_SOURCES));
check("CLASS_TEST_SOURCE_LABELS_EN total",       total(V.CLASS_TEST_SOURCE_LABELS_EN, V.CLASS_TEST_SOURCES));
check("CLASS_TEST_RESULT is a registered NotificationKind (§3.1/§8, extends §C.5)", V.NOTIFICATION_KINDS.includes("CLASS_TEST_RESULT"));
check("class-test attendance statuses exact (CT-2 §3.3/§4)", eq(V.CLASS_TEST_ATTENDANCE_STATUSES, ["PRESENT", "ABSENT"]));
check("CLASS_TEST_ATTENDANCE_STATUS_LABELS_BN total", total(V.CLASS_TEST_ATTENDANCE_STATUS_LABELS_BN, V.CLASS_TEST_ATTENDANCE_STATUSES));
check("CLASS_TEST_ATTENDANCE_STATUS_LABELS_EN total", total(V.CLASS_TEST_ATTENDANCE_STATUS_LABELS_EN, V.CLASS_TEST_ATTENDANCE_STATUSES));
// CT-3 — guardian-message delivery: CLASS_TEST_RESULT kind (above) + the class_test.result.* template keys (§8, D-#131/#160)
check("class_test.result.* guardian-message template keys registered (Regular/Excellent/Absent + title, §8 — built on the MT registry, D-#131)",
  ["class_test.result.title","class_test.result.regular.body","class_test.result.excellent.body","class_test.result.absent.body"].every((k) => V.MESSAGE_TEMPLATE_KEYS.includes(k) && V.MESSAGE_TEMPLATE_REGISTRY[k]));
// CT-4 — Office → teacher overdue-report chase wa.me template (§6/J6, D-#131/#167)
check("class_test.overdue_chase.wa template key registered (Office overdue-chase, §6 — built on the MT registry, D-#131)",
  V.MESSAGE_TEMPLATE_KEYS.includes("class_test.overdue_chase.wa") && !!V.MESSAGE_TEMPLATE_REGISTRY["class_test.overdue_chase.wa"]);
check("class test composes existing perms — no class-test:* permission (D-#94/#17)",
  !V.PERMISSIONS.some((p) => p.startsWith("class") || p.startsWith("classtest")));

console.log("=== C.15 Student-Comments / Parents-Meeting vocab (CM-1 — prd-comments-meetings §4, D-#114/#115) ===");
check("comment types exact (§3/§4 — the Form's M-column taxonomy)", eq(V.COMMENT_TYPES, ["GENERAL", "ATTENDANCE", "STUDY_HOMEWORK", "BEHAVIOUR", "SERIOUS_MATTER"]));
check("COMMENT_TYPE_LABELS_BN total", total(V.COMMENT_TYPE_LABELS_BN, V.COMMENT_TYPES));
check("COMMENT_TYPE_LABELS_EN total", total(V.COMMENT_TYPE_LABELS_EN, V.COMMENT_TYPES));
check("comment sentiments exact (§3/§4)", eq(V.COMMENT_SENTIMENTS, ["CONCERN", "POSITIVE"]));
check("COMMENT_SENTIMENT_LABELS_BN total", total(V.COMMENT_SENTIMENT_LABELS_BN, V.COMMENT_SENTIMENTS));
check("COMMENT_SENTIMENT_LABELS_EN total", total(V.COMMENT_SENTIMENT_LABELS_EN, V.COMMENT_SENTIMENTS));
check("comments compose existing perms — no comment:*/meeting:* permission (D-#17/#94)",
  !V.PERMISSIONS.some((p) => p.startsWith("comment") || p.startsWith("meeting")));
// CM-2 — daily delivery: STUDENT_COMMENT kind (extends §C.5) + the student_comment.* MT key (D-#131/#172)
check("STUDENT_COMMENT is a registered NotificationKind (CM-2 §6/J-CM1, extends §C.5)", V.NOTIFICATION_KINDS.includes("STUDENT_COMMENT"));
check("student_comment.* guardian-message template keys registered (title + body, §6 — built on the MT registry, D-#131)",
  ["student_comment.notify.title", "student_comment.notify.body"].every((k) => V.MESSAGE_TEMPLATE_KEYS.includes(k) && V.MESSAGE_TEMPLATE_REGISTRY[k]));

console.log("=== C.16 Classroom-observation vocab + the four new permissions (CO-1 — prd-classroom-observation §4/§5, D-#146/#147/#190/#191) ===");
check("OBSERVATION_FORMS exact (§4)",            eq(V.OBSERVATION_FORMS, ["REF11", "QURAN"]));
check("OBSERVATION_FORM_LABELS_BN total",        total(V.OBSERVATION_FORM_LABELS_BN, V.OBSERVATION_FORMS));
check("OBSERVATION_FORM_LABELS_EN total",        total(V.OBSERVATION_FORM_LABELS_EN, V.OBSERVATION_FORMS));
check("OBSERVATION_DOMAINS exact — 5 REF-11 domains (§4)", eq(V.OBSERVATION_DOMAINS, ["D1", "D2", "D3", "D4", "D5"]));
check("OBSERVATION_DOMAIN_LABELS_BN total",      total(V.OBSERVATION_DOMAIN_LABELS_BN, V.OBSERVATION_DOMAINS));
check("OBSERVATION_DOMAIN_LABELS_EN total",      total(V.OBSERVATION_DOMAIN_LABELS_EN, V.OBSERVATION_DOMAINS));
check("OBSERVATION_LEVELS exact 1..4 — no total/average (§4)", eq(V.OBSERVATION_LEVELS, [1, 2, 3, 4]));
check("OBSERVATION_LEVEL_LABELS_BN total",       total(V.OBSERVATION_LEVEL_LABELS_BN, V.OBSERVATION_LEVELS));
check("OBSERVATION_LEVEL_LABELS_EN total",       total(V.OBSERVATION_LEVEL_LABELS_EN, V.OBSERVATION_LEVELS));
check("OBSERVATION_GATES exact (§4)",            eq(V.OBSERVATION_GATES, ["G1", "G2"]));
check("OBSERVATION_GATE_LABELS_BN total",        total(V.OBSERVATION_GATE_LABELS_BN, V.OBSERVATION_GATES));
check("OBSERVATION_GATE_LABELS_EN total",        total(V.OBSERVATION_GATE_LABELS_EN, V.OBSERVATION_GATES));
check("GATE_RESULTS exact (§4)",                 eq(V.GATE_RESULTS, ["PASS", "BREACH"]));
check("GATE_RESULT_LABELS_BN total",             total(V.GATE_RESULT_LABELS_BN, V.GATE_RESULTS));
check("GATE_RESULT_LABELS_EN total",             total(V.GATE_RESULT_LABELS_EN, V.GATE_RESULTS));
check("OBSERVATION_STATES exact — UPLOADED→ASSIGNED→REVIEWED→TEACHER_RESPONDED, SUPERSEDED (§4)",
  eq(V.OBSERVATION_STATES, ["UPLOADED", "ASSIGNED", "REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"]));
check("OBSERVATION_STATE_LABELS_BN total",       total(V.OBSERVATION_STATE_LABELS_BN, V.OBSERVATION_STATES));
check("OBSERVATION_STATE_LABELS_EN total",       total(V.OBSERVATION_STATE_LABELS_EN, V.OBSERVATION_STATES));
check("GROWTH_PROGRESS exact (§4)",              eq(V.GROWTH_PROGRESS, ["YES", "PARTLY", "NOT_YET"]));
check("GROWTH_PROGRESS_LABELS_BN total",         total(V.GROWTH_PROGRESS_LABELS_BN, V.GROWTH_PROGRESS));
check("GROWTH_PROGRESS_LABELS_EN total",         total(V.GROWTH_PROGRESS_LABELS_EN, V.GROWTH_PROGRESS));
// the four NEW permissions — the sensitive part (the template:manage/performance:* verifier-proven precedent, D-#147/#191)
check("the 4 observation perms are declared + all BUILD (no pipeline residue)",
  ["observation:upload", "observation:review", "observation:read", "observation:manage"].every(
    (p) => V.PERMISSIONS.includes(p) && V.PERMISSION_BUILD_STATUS[p] === "build"));
check("observation:upload = PRINCIPAL+OFFICE only (upload+assign; D-#147)",
  V.roleHasPermission("PRINCIPAL", "observation:upload") && V.roleHasPermission("OFFICE", "observation:upload") &&
  !["TEACHER", "GUARDIAN"].some((r) => V.roleHasPermission(r, "observation:upload")));
check("observation:review = TEACHER ONLY — the assigned senior-teacher observer (resolver gates to observerId; Principal/Office/Guardian never review, D-#147)",
  V.roleHasPermission("TEACHER", "observation:review") &&
  !["PRINCIPAL", "OFFICE", "GUARDIAN"].some((r) => V.roleHasPermission(r, "observation:review")));
check("observation:read = PRINCIPAL+TEACHER+OFFICE (row-scoped in the resolver), GUARDIAN none — staff-internal (§7)",
  ["PRINCIPAL", "TEACHER", "OFFICE"].every((r) => V.roleHasPermission(r, "observation:read")) &&
  !V.roleHasPermission("GUARDIAN", "observation:read"));
check("observation:manage = PRINCIPAL+OFFICE only (designations/config/dashboards, D-#147)",
  V.roleHasPermission("PRINCIPAL", "observation:manage") && V.roleHasPermission("OFFICE", "observation:manage") &&
  !["TEACHER", "GUARDIAN"].some((r) => V.roleHasPermission(r, "observation:manage")));
check("GUARDIAN holds NO observation:* permission (staff-internal, §7)",
  !V.PERMISSIONS.filter((p) => p.startsWith("observation")).some((p) => V.roleHasPermission("GUARDIAN", p)));

console.log("=== C.16b Quran (ClassEcho) form payload enums (CO-5 — prd-classroom-observation §CO-5, D-#56; app-native, NO wire twin D-#46) ===");
// the 8 rating criteria — exact set + label maps TOTAL (BN + EN) with NO extra keys
check("QURAN_REVIEW_CRITERIA exact — the 8 ClassEcho rating items (§CO-5)",
  eq(V.QURAN_REVIEW_CRITERIA, ["SUBJECT_KNOWLEDGE", "ENGAGEMENT_WITH_STUDENTS", "USE_OF_TEACHING_AIDS",
    "INTERACTION_AND_QUESTION_HANDLING", "STUDENT_DISCIPLINE", "TEACHERS_CONTROL_OVER_CLASS",
    "PARTICIPATION_LEVEL_OF_STUDENTS", "COMPLETION_OF_PLANNED_SYLLABUS"]));
check("QURAN_REVIEW_CRITERIA is non-empty (8 items)", V.QURAN_REVIEW_CRITERIA.length === 8);
check("QURAN_REVIEW_CRITERIA_LABELS_BN total",   total(V.QURAN_REVIEW_CRITERIA_LABELS_BN, V.QURAN_REVIEW_CRITERIA));
check("QURAN_REVIEW_CRITERIA_LABELS_EN total",   total(V.QURAN_REVIEW_CRITERIA_LABELS_EN, V.QURAN_REVIEW_CRITERIA));
check("QURAN_REVIEW_CRITERIA labels have NO extra keys (BN + EN exact over the enum)",
  Object.keys(V.QURAN_REVIEW_CRITERIA_LABELS_BN).every((k) => V.QURAN_REVIEW_CRITERIA.includes(k)) &&
  Object.keys(V.QURAN_REVIEW_CRITERIA_LABELS_EN).every((k) => V.QURAN_REVIEW_CRITERIA.includes(k)));
// the 7 yes/no compliance items — exact set + label maps TOTAL (BN + EN) with NO extra keys
check("QURAN_COMPLIANCE_ITEMS exact — the 7 PRD-final yes/no items (§CO-5)",
  eq(V.QURAN_COMPLIANCE_ITEMS, ["CLASS_STARTED_ON_TIME", "CLASS_PERFORMED_AS_TRAINED", "MAINTAINS_DISCIPLINE",
    "STUDENTS_UNDERSTAND_LESSON", "CLASS_IS_INTERACTIVE", "SIGNS_HOMEWORK_DIARY", "CHECKS_HOMEWORK_DIARY"]));
check("QURAN_COMPLIANCE_ITEMS is non-empty (7 items)", V.QURAN_COMPLIANCE_ITEMS.length === 7);
check("QURAN_COMPLIANCE_ITEM_LABELS_BN total",   total(V.QURAN_COMPLIANCE_ITEM_LABELS_BN, V.QURAN_COMPLIANCE_ITEMS));
check("QURAN_COMPLIANCE_ITEM_LABELS_EN total",   total(V.QURAN_COMPLIANCE_ITEM_LABELS_EN, V.QURAN_COMPLIANCE_ITEMS));
check("QURAN_COMPLIANCE_ITEM labels have NO extra keys (BN + EN exact over the enum)",
  Object.keys(V.QURAN_COMPLIANCE_ITEM_LABELS_BN).every((k) => V.QURAN_COMPLIANCE_ITEMS.includes(k)) &&
  Object.keys(V.QURAN_COMPLIANCE_ITEM_LABELS_EN).every((k) => V.QURAN_COMPLIANCE_ITEMS.includes(k)));
check("Quran review scale is 1..5 (no total/average)", V.QURAN_REVIEW_SCORE_MIN === 1 && V.QURAN_REVIEW_SCORE_MAX === 5);

console.log("=== C.16c Review-scheduler support tiers (CO-6 — prd-classroom-observation §CO-6; app-native, NO wire twin D-#46) ===");
check("SUPPORT_TIERS exact — STRONG / DEVELOPING / NEEDS_SUPPORT (§CO-6)",
  eq(V.SUPPORT_TIERS, ["STRONG", "DEVELOPING", "NEEDS_SUPPORT"]));
check("SUPPORT_TIER_LABELS_BN total",            total(V.SUPPORT_TIER_LABELS_BN, V.SUPPORT_TIERS));
check("SUPPORT_TIER_LABELS_EN total",            total(V.SUPPORT_TIER_LABELS_EN, V.SUPPORT_TIERS));
check("SUPPORT_TIER labels have NO extra keys (BN + EN exact over the enum)",
  Object.keys(V.SUPPORT_TIER_LABELS_BN).every((k) => V.SUPPORT_TIERS.includes(k)) &&
  Object.keys(V.SUPPORT_TIER_LABELS_EN).every((k) => V.SUPPORT_TIERS.includes(k)));
check("CO-6 adds NO new permission (reuses observation:read / observation:manage)",
  !V.PERMISSIONS.includes("observation:schedule"));

console.log("=== C.17 Per-user access control: access:manage + RESERVED_PERMISSIONS + ASSIGNABLE_TEMPLATES + permission labels (AC-1 — prd-access-control §7/§8, D-#193/#210–#212) ===");
// access:manage — the per-user editor gate: declared, BUILD, PRINCIPAL-exact-holder (the template:manage/payroll:approve posture)
check("access:manage is declared + BUILD",
  V.PERMISSIONS.includes("access:manage") && V.PERMISSION_BUILD_STATUS["access:manage"] === "build");
check("access:manage = PRINCIPAL ONLY (verifier-proven exact-holder set — Office/Teacher/Guardian never, §7)",
  V.roleHasPermission("PRINCIPAL", "access:manage") &&
  !["TEACHER", "OFFICE", "GUARDIAN"].some((r) => V.roleHasPermission(r, "access:manage")));
// user:view_as — "View as" (VA-1, D-#638) made GRANTABLE by D-#639. The reversal is kept narrow by
// three invariants, all of which must hold together or the grant surface widens silently.
check("user:view_as is declared + BUILD (VA-1, D-#638/#639)",
  V.PERMISSIONS.includes("user:view_as") && V.PERMISSION_BUILD_STATUS["user:view_as"] === "build");
check("user:view_as is on the PRINCIPAL template and NO other role template (only an explicit AC-1 grant reaches a non-Principal, D-#639)",
  V.roleHasPermission("PRINCIPAL", "user:view_as") &&
  !["TEACHER", "OFFICE", "GUARDIAN"].some((r) => V.roleHasPermission(r, "user:view_as")));
check("user:view_as is NOT reserved — reserving it would make the D-#639 grant inert (it is subtracted for every non-Principal login)",
  !V.RESERVED_PERMISSIONS.includes("user:view_as"));
check("no ASSIGNABLE_TEMPLATE carries user:view_as (an added OFFICE/TEACHER hat must not hand over everyone else's account, D-#468/#639)",
  !V.ASSIGNABLE_TEMPLATES.some((r) => V.roleHasPermission(r, "user:view_as")));
// RESERVED_PERMISSIONS — exactly the five, all real perms, none reachable by a non-Principal template (the structural backstop, §5)
check("RESERVED_PERMISSIONS is exactly the five (§5/§8)",
  eq(V.RESERVED_PERMISSIONS, ["payroll:approve", "performance:signoff", "chat:oversee", "template:manage", "access:manage"]));
check("every RESERVED_PERMISSION is a declared PERMISSION",
  V.RESERVED_PERMISSIONS.every((p) => V.PERMISSIONS.includes(p)));
check("no RESERVED_PERMISSION appears in ROLE_PERMISSIONS.TEACHER or .OFFICE (reserved perms reach only PRINCIPAL, §8)",
  !V.RESERVED_PERMISSIONS.some((p) => V.roleHasPermission("TEACHER", p) || V.roleHasPermission("OFFICE", p)));
check("every RESERVED_PERMISSION IS held by PRINCIPAL (reserved = Principal-only, not Principal-never)",
  V.RESERVED_PERMISSIONS.every((p) => V.roleHasPermission("PRINCIPAL", p)));
// ASSIGNABLE_TEMPLATES — the only roles a Principal may add as an additional template (excludes PRINCIPAL + GUARDIAN, §8/J-AC4)
check("ASSIGNABLE_TEMPLATES is exactly TEACHER+OFFICE (excludes PRINCIPAL + GUARDIAN, §8)",
  eq(V.ASSIGNABLE_TEMPLATES, ["TEACHER", "OFFICE"]));
check("every ASSIGNABLE_TEMPLATE is a real Role",
  V.ASSIGNABLE_TEMPLATES.every((r) => V.ROLES.includes(r)));
// effectivePermissions — BYTE-IDENTICAL default: empty arrays ⇒ the old role set exactly, for EVERY role (J-AC5)
check("BYTE-IDENTICAL: effectivePermissions({role}) === permissionsForRole(role) for every role with empty arrays (J-AC5)",
  V.ROLES.every((r) => eq([...V.effectivePermissions({ role: r })], V.permissionsForRole(r))));
// PERMISSION_LABELS_BN/_EN — total over PERMISSIONS, each a non-empty {name, desc} (the AC-2 editor, §7)
const totalLabelObj = (labels, keys) =>
  keys.every((k) => labels[k] && typeof labels[k].name === "string" && labels[k].name.length > 0 &&
    typeof labels[k].desc === "string" && labels[k].desc.length > 0);
check("PERMISSION_LABELS_BN total over PERMISSIONS (name + desc)", totalLabelObj(V.PERMISSION_LABELS_BN, V.PERMISSIONS));
check("PERMISSION_LABELS_EN total over PERMISSIONS (name + desc)", totalLabelObj(V.PERMISSION_LABELS_EN, V.PERMISSIONS));
check("PERMISSION_LABELS have no key outside PERMISSIONS (BN + EN)",
  Object.keys(V.PERMISSION_LABELS_BN).every((k) => V.PERMISSIONS.includes(k)) &&
  Object.keys(V.PERMISSION_LABELS_EN).every((k) => V.PERMISSIONS.includes(k)));

console.log("=== C.17b Delegated scope actions — the EXTENT axis (ACS-1 — prd-access-control-scope §4.1/§11, D-#484–#489) ===");
// The action vocabulary exists and is non-empty; the status map + both label maps are TOTAL over it.
check("DELEGATED_ACTIONS is declared + non-empty (§4.1)",
  Array.isArray(V.DELEGATED_ACTIONS) && V.DELEGATED_ACTIONS.length > 0);
check("DELEGATED_ACTION_BUILD_STATUS covers every DELEGATED_ACTION",
  V.DELEGATED_ACTIONS.every((a) => a in V.DELEGATED_ACTION_BUILD_STATUS));
check("DELEGATED_ACTION_BUILD_STATUS has no key outside DELEGATED_ACTIONS",
  Object.keys(V.DELEGATED_ACTION_BUILD_STATUS).every((k) => V.DELEGATED_ACTIONS.includes(k)));
check("every status is exactly build|pipeline",
  V.DELEGATED_ACTIONS.every((a) => ["build", "pipeline"].includes(V.DELEGATED_ACTION_BUILD_STATUS[a])));
check("DELEGATED_ACTION_LABELS_BN total over DELEGATED_ACTIONS (name + desc)",
  totalLabelObj(V.DELEGATED_ACTION_LABELS_BN, V.DELEGATED_ACTIONS));
check("DELEGATED_ACTION_LABELS_EN total over DELEGATED_ACTIONS (name + desc)",
  totalLabelObj(V.DELEGATED_ACTION_LABELS_EN, V.DELEGATED_ACTIONS));
check("DELEGATED_ACTION_LABELS have no key outside DELEGATED_ACTIONS (BN + EN)",
  Object.keys(V.DELEGATED_ACTION_LABELS_BN).every((k) => V.DELEGATED_ACTIONS.includes(k)) &&
  Object.keys(V.DELEGATED_ACTION_LABELS_EN).every((k) => V.DELEGATED_ACTIONS.includes(k)));
// The two axes must never be confusable: a delegated action is NOT a permission and
// never grants one — the holder needs the Permission too (D-#484).
check("NO DELEGATED_ACTION collides with a PERMISSION string (the two axes stay distinct, §11)",
  !V.DELEGATED_ACTIONS.some((a) => V.PERMISSIONS.includes(a)));
check("NO PERMISSION collides with a DELEGATED_ACTION string (converse)",
  !V.PERMISSIONS.some((p) => V.DELEGATED_ACTIONS.includes(p)));
// isDelegatedActionActive mirrors the status map exactly (the editor's offer filter, D-#486)
check("isDelegatedActionActive === (status === build) for every action",
  V.DELEGATED_ACTIONS.every((a) =>
    V.isDelegatedActionActive(a) === (V.DELEGATED_ACTION_BUILD_STATUS[a] === "build")));
check("NO pipeline delegated actions remain after ACS-3 — every action's gate is tagged (§4.1: flipping one to build tags its call site in the SAME PR)",
  eq(V.DELEGATED_ACTIONS.filter((a) => V.DELEGATED_ACTION_BUILD_STATUS[a] !== "build"), []));
check("the ACS-3 duty action exists — the fold that retires the ad-hoc school-wide booleans (D-#489)",
  V.DELEGATED_ACTIONS.includes("confirm_homework_day"));

console.log("=== C.18 Finance/accounting vocab freeze + finance:manage RBAC (FIN-1 — prd-finance-fin1 §4/§5, D-#221–#223/#247; app-native, NO wire twin REQ §9) ===");
// ledgers — exactly the 5 (REQ §3); CASH/BANK/ONLINE + the 2 control ledgers
check("LEDGER_KINDS exact — the 5 ledgers (§4)", eq(V.LEDGER_KINDS, ["CASH","BANK","ONLINE","QARD_CONTROL","IOU_CONTROL"]));
check("LEDGER_KIND_LABELS_BN total", total(V.LEDGER_KIND_LABELS_BN, V.LEDGER_KINDS));
check("LEDGER_KIND_LABELS_EN total", total(V.LEDGER_KIND_LABELS_EN, V.LEDGER_KINDS));
// payment modes — the 3 finance movement modes, distinct from HR PAYMENT_METHODS
check("FINANCE_PAYMENT_MODES exact — CASH/BANK/ONLINE (§4)", eq(V.FINANCE_PAYMENT_MODES, ["CASH","BANK","ONLINE"]));
check("FINANCE_PAYMENT_MODE_LABELS_BN total", total(V.FINANCE_PAYMENT_MODE_LABELS_BN, V.FINANCE_PAYMENT_MODES));
check("FINANCE_PAYMENT_MODE_LABELS_EN total", total(V.FINANCE_PAYMENT_MODE_LABELS_EN, V.FINANCE_PAYMENT_MODES));
check("FINANCE_PAYMENT_MODES distinct from HR PAYMENT_METHODS (no namespace clash, §4)",
  !eq(V.FINANCE_PAYMENT_MODES, V.PAYMENT_METHODS) && V.PAYMENT_METHODS.includes("bkash") && !V.FINANCE_PAYMENT_MODES.includes("bkash"));
// income heads — the 11 ratified (D-#247)
check("FINANCE_INCOME_HEADS exact — the 11 ratified heads (§4, D-#247)",
  eq(V.FINANCE_INCOME_HEADS, ["ADMISSION_FEE","SESSION_FEE","TUITION_FEE","BOOKS_STATIONERIES","REVISION_FEE","TRANSPORT_FEE","APPLICATION_FORM_PROSPECTUS","SADAKA","SUBSIDY","OTHER_FEE","OTHER"]));
check("FINANCE_INCOME_HEADS is 11", V.FINANCE_INCOME_HEADS.length === 11);
check("FINANCE_INCOME_HEAD_LABELS_BN total", total(V.FINANCE_INCOME_HEAD_LABELS_BN, V.FINANCE_INCOME_HEADS));
check("FINANCE_INCOME_HEAD_LABELS_EN total", total(V.FINANCE_INCOME_HEAD_LABELS_EN, V.FINANCE_INCOME_HEADS));
// student-fee heads — the 7 ratified (D-#247)
check("FINANCE_STUDENT_FEE_HEADS exact — the 7 ratified heads (§4, D-#247)",
  eq(V.FINANCE_STUDENT_FEE_HEADS, ["ADMISSION","SESSION","TUITION","BOOKS_STATIONERIES","REVISION","TRANSPORT","OTHER"]));
check("FINANCE_STUDENT_FEE_HEADS is 7", V.FINANCE_STUDENT_FEE_HEADS.length === 7);
check("FINANCE_STUDENT_FEE_HEAD_LABELS_BN total", total(V.FINANCE_STUDENT_FEE_HEAD_LABELS_BN, V.FINANCE_STUDENT_FEE_HEADS));
check("FINANCE_STUDENT_FEE_HEAD_LABELS_EN total", total(V.FINANCE_STUDENT_FEE_HEAD_LABELS_EN, V.FINANCE_STUDENT_FEE_HEADS));
// ledger-movement heads — the 3, DISJOINT from income (FIN-5 never counts them as revenue)
check("FINANCE_LEDGER_MOVEMENT_HEADS exact — BANK_DEPOSIT/QARD_REPAYMENT/IOU_REPAYMENT (§4)",
  eq(V.FINANCE_LEDGER_MOVEMENT_HEADS, ["BANK_DEPOSIT","QARD_REPAYMENT","IOU_REPAYMENT"]));
check("FINANCE_LEDGER_MOVEMENT_HEADS disjoint from FINANCE_INCOME_HEADS (movements are NOT income, §4)",
  !V.FINANCE_LEDGER_MOVEMENT_HEADS.some((h) => V.FINANCE_INCOME_HEADS.includes(h)));
check("FINANCE_LEDGER_MOVEMENT_HEAD_LABELS_BN total", total(V.FINANCE_LEDGER_MOVEMENT_HEAD_LABELS_BN, V.FINANCE_LEDGER_MOVEMENT_HEADS));
check("FINANCE_LEDGER_MOVEMENT_HEAD_LABELS_EN total", total(V.FINANCE_LEDGER_MOVEMENT_HEAD_LABELS_EN, V.FINANCE_LEDGER_MOVEMENT_HEADS));
// expense heads — the 22 ratified (D-#247); SALARY present (HR feed)
check("FINANCE_EXPENSE_HEADS is the 22 ratified heads incl. SALARY (§4, D-#247)",
  V.FINANCE_EXPENSE_HEADS.length === 22 && V.FINANCE_EXPENSE_HEADS.includes("SALARY") && V.FINANCE_EXPENSE_HEADS.includes("OTHER"));
check("FINANCE_EXPENSE_HEAD_LABELS_BN total", total(V.FINANCE_EXPENSE_HEAD_LABELS_BN, V.FINANCE_EXPENSE_HEADS));
check("FINANCE_EXPENSE_HEAD_LABELS_EN total", total(V.FINANCE_EXPENSE_HEAD_LABELS_EN, V.FINANCE_EXPENSE_HEADS));
// Qard/IOU dir+type enums (frozen now; register is FIN-3)
check("QARD_IOU_DIRECTIONS exact (§4)", eq(V.QARD_IOU_DIRECTIONS, ["NEW_DISBURSEMENT","REPAYMENT_RECEIVED","ADJUSTMENT"]));
check("QARD_IOU_DIRECTION_LABELS_BN total", total(V.QARD_IOU_DIRECTION_LABELS_BN, V.QARD_IOU_DIRECTIONS));
check("QARD_IOU_DIRECTION_LABELS_EN total", total(V.QARD_IOU_DIRECTION_LABELS_EN, V.QARD_IOU_DIRECTIONS));
check("QARD_IOU_TYPES exact (§4)", eq(V.QARD_IOU_TYPES, ["QARD_E_HASANA","IOU"]));
check("QARD_IOU_TYPE_LABELS_BN total", total(V.QARD_IOU_TYPE_LABELS_BN, V.QARD_IOU_TYPES));
check("QARD_IOU_TYPE_LABELS_EN total", total(V.QARD_IOU_TYPE_LABELS_EN, V.QARD_IOU_TYPES));
// finance:manage — declared, BUILD, Principal+Office exact-holder; NOT reserved; TEACHER/GUARDIAN never
check("finance:manage is declared + BUILD (§5)",
  V.PERMISSIONS.includes("finance:manage") && V.PERMISSION_BUILD_STATUS["finance:manage"] === "build");
check("finance:manage = PRINCIPAL+OFFICE only; TEACHER/GUARDIAN never (§5, D-#221)",
  V.roleHasPermission("PRINCIPAL","finance:manage") && V.roleHasPermission("OFFICE","finance:manage") &&
  !["TEACHER","GUARDIAN"].some((r) => V.roleHasPermission(r, "finance:manage")));
check("finance:manage is NOT reserved (Office holds it — it is a delegable books perm, not Principal-only, D-#221)",
  !V.RESERVED_PERMISSIONS.includes("finance:manage"));
check("no finance:approve in FIN-1 (period-lock deferred to the slice that needs it, §5)",
  !V.PERMISSIONS.includes("finance:approve"));
// FIN-2A — posting kinds (additive; prd-finance-fin2 §3.A/§4, D-#224)
check("FINANCE_POSTING_KINDS exact — FEE_COLLECTION/OTHER_INCOME/EXPENSE/TRANSFER (FIN-2A §4)",
  eq(V.FINANCE_POSTING_KINDS, ["FEE_COLLECTION","OTHER_INCOME","EXPENSE","TRANSFER"]));
check("FINANCE_POSTING_KIND_LABELS_BN total", total(V.FINANCE_POSTING_KIND_LABELS_BN, V.FINANCE_POSTING_KINDS));
check("FINANCE_POSTING_KIND_LABELS_EN total", total(V.FINANCE_POSTING_KIND_LABELS_EN, V.FINANCE_POSTING_KINDS));
// FIN-2B — zakat/3rd-party fee-support (coverage types + allocation status + chase, D-#226/#227)
check("FEE_COVERAGE_TYPES exact — FULL/AMOUNT (FIN-2B §4, D-#226; PERCENT deferred)", eq(V.FEE_COVERAGE_TYPES, ["FULL","AMOUNT"]));
check("FEE_COVERAGE_TYPE_LABELS_BN total", total(V.FEE_COVERAGE_TYPE_LABELS_BN, V.FEE_COVERAGE_TYPES));
check("FEE_COVERAGE_TYPE_LABELS_EN total", total(V.FEE_COVERAGE_TYPE_LABELS_EN, V.FEE_COVERAGE_TYPES));
check("FEE_SUPPORT_ALLOCATION_STATUSES exact — ACTIVE/ENDED (FIN-2B §4)", eq(V.FEE_SUPPORT_ALLOCATION_STATUSES, ["ACTIVE","ENDED"]));
check("FEE_SUPPORT_ALLOCATION_STATUS_LABELS_BN total", total(V.FEE_SUPPORT_ALLOCATION_STATUS_LABELS_BN, V.FEE_SUPPORT_ALLOCATION_STATUSES));
check("FEE_SUPPORT_ALLOCATION_STATUS_LABELS_EN total", total(V.FEE_SUPPORT_ALLOCATION_STATUS_LABELS_EN, V.FEE_SUPPORT_ALLOCATION_STATUSES));
check("FINANCE_FEE_DUE is a registered NotificationKind (FIN-2B §6/J-FIN2-7, extends §C.5)", V.NOTIFICATION_KINDS.includes("FINANCE_FEE_DUE"));
check("finance.fee_due.chase.* guardian-message template keys registered (title + body + wa, §6 — MT registry, D-#131)",
  ["finance.fee_due.chase.title","finance.fee_due.chase.body","finance.fee_due.chase.wa"].every((k) => V.MESSAGE_TEMPLATE_KEYS.includes(k) && V.MESSAGE_TEMPLATE_REGISTRY[k]));
// FIN-3 — Qard/IOU party kinds (additive; prd-finance-fin3 §4, D-#232)
check("FINANCE_PARTY_KINDS exact — COMMUNITY/INDIVIDUAL/ORG (FIN-3 §4)", eq(V.FINANCE_PARTY_KINDS, ["COMMUNITY","INDIVIDUAL","ORG"]));
check("FINANCE_PARTY_KIND_LABELS_BN total", total(V.FINANCE_PARTY_KIND_LABELS_BN, V.FINANCE_PARTY_KINDS));
check("FINANCE_PARTY_KIND_LABELS_EN total", total(V.FINANCE_PARTY_KIND_LABELS_EN, V.FINANCE_PARTY_KINDS));
// FIN-4 — reconciliation sources (additive; prd-finance-fin4 §4, D-#235/#236)
check("RECON_SOURCES exact — BANK/EXIMUS (FIN-4 §4)", eq(V.RECON_SOURCES, ["BANK","EXIMUS"]));
check("RECON_SOURCE_LABELS_BN total", total(V.RECON_SOURCE_LABELS_BN, V.RECON_SOURCES));
check("RECON_SOURCE_LABELS_EN total", total(V.RECON_SOURCE_LABELS_EN, V.RECON_SOURCES));
// FIN-5 — budget line kinds (additive; prd-finance-fin5 §4, D-#237)
check("BUDGET_LINE_KINDS exact — EXPENSE/INCOME (FIN-5 §4)", eq(V.BUDGET_LINE_KINDS, ["EXPENSE","INCOME"]));
check("BUDGET_LINE_KIND_LABELS_BN total", total(V.BUDGET_LINE_KIND_LABELS_BN, V.BUDGET_LINE_KINDS));
check("BUDGET_LINE_KIND_LABELS_EN total", total(V.BUDGET_LINE_KIND_LABELS_EN, V.BUDGET_LINE_KINDS));

console.log("=== C.19 Saturday-Revision entry vocab (SR-1 — prd-sr1 §4, D-#241–#243; app-native, NO wire twin) ===");
// revision categories — exactly the 3 Hifz categories (§4)
check("REVISION_CATEGORIES exact — SABAQ/SABQI/MANZIL (§4)", eq(V.REVISION_CATEGORIES, ["SABAQ","SABQI","MANZIL"]));
check("REVISION_CATEGORY_LABELS_BN total", total(V.REVISION_CATEGORY_LABELS_BN, V.REVISION_CATEGORIES));
check("REVISION_CATEGORY_LABELS_EN total", total(V.REVISION_CATEGORY_LABELS_EN, V.REVISION_CATEGORIES));
// mistake categories — the 4 structured tajweed-mistake buckets (§4)
check("REVISION_MISTAKE_CATEGORIES exact — HARF/GHUNNAH/MADD/OTHER (§4)", eq(V.REVISION_MISTAKE_CATEGORIES, ["HARF","GHUNNAH","MADD","OTHER"]));
check("REVISION_MISTAKE_CATEGORY_LABELS_BN total", total(V.REVISION_MISTAKE_CATEGORY_LABELS_BN, V.REVISION_MISTAKE_CATEGORIES));
check("REVISION_MISTAKE_CATEGORY_LABELS_EN total", total(V.REVISION_MISTAKE_CATEGORY_LABELS_EN, V.REVISION_MISTAKE_CATEGORIES));
// SR-1 does NOT touch NOTIFICATION_KINDS / MT keys (those are SR-2 — keeps the footprint to the 2 entry enums)
// SR-2 — guardian delivery: SR_ABSENT/SR_DIGEST kinds (extends §C.5) + the sr.{absent,digest}.* MT keys (D-#244/#131)
check("SR_ABSENT + SR_DIGEST are registered NotificationKinds (SR-2 §4, extends §C.5)",
  V.NOTIFICATION_KINDS.includes("SR_ABSENT") && V.NOTIFICATION_KINDS.includes("SR_DIGEST"));
check("sr.absent.* + sr.digest.* guardian-message template keys registered (title + body + wa each — MT registry, D-#131)",
  ["sr.absent.title","sr.absent.body","sr.absent.wa","sr.digest.title","sr.digest.body","sr.digest.wa"].every((k) => V.MESSAGE_TEMPLATE_KEYS.includes(k) && V.MESSAGE_TEMPLATE_REGISTRY[k]));
// SR-3 — the stateless completeness-chase wa.me key (D-#246/#131)
check("sr.completeness_chase.wa template key registered (SR-3 §4 — Office nudge to the group's teacher)",
  V.MESSAGE_TEMPLATE_KEYS.includes("sr.completeness_chase.wa") && !!V.MESSAGE_TEMPLATE_REGISTRY["sr.completeness_chase.wa"]);

console.log("=== AR. Answer-script archive (prd-script-archive §4, D-#443–#447) ===");
check("ARCHIVE_SOURCE_KINDS exact — CLASS_TEST wired, EXAM reserved (D-#443)", eq(V.ARCHIVE_SOURCE_KINDS, ["CLASS_TEST","EXAM"]));
check("SCRIPT_BUNDLE_STATUSES exact — FILED/CHECKED_OUT/DISPOSED/VOID (D-#444)", eq(V.SCRIPT_BUNDLE_STATUSES, ["FILED","CHECKED_OUT","DISPOSED","VOID"]));
check("STORAGE_BOX_STATUSES exact — ACTIVE/RETIRED, never deleted (D-#445)", eq(V.STORAGE_BOX_STATUSES, ["ACTIVE","RETIRED"]));
check("ARCHIVE_SOURCE_KIND_LABELS_BN total",   total(V.ARCHIVE_SOURCE_KIND_LABELS_BN, V.ARCHIVE_SOURCE_KINDS));
check("ARCHIVE_SOURCE_KIND_LABELS_EN total",   total(V.ARCHIVE_SOURCE_KIND_LABELS_EN, V.ARCHIVE_SOURCE_KINDS));
check("SCRIPT_BUNDLE_STATUS_LABELS_BN total",  total(V.SCRIPT_BUNDLE_STATUS_LABELS_BN, V.SCRIPT_BUNDLE_STATUSES));
check("SCRIPT_BUNDLE_STATUS_LABELS_EN total",  total(V.SCRIPT_BUNDLE_STATUS_LABELS_EN, V.SCRIPT_BUNDLE_STATUSES));
check("STORAGE_BOX_STATUS_LABELS_BN total",    total(V.STORAGE_BOX_STATUS_LABELS_BN, V.STORAGE_BOX_STATUSES));
check("STORAGE_BOX_STATUS_LABELS_EN total",    total(V.STORAGE_BOX_STATUS_LABELS_EN, V.STORAGE_BOX_STATUSES));
check("no archive:* permission declared — composed perms only (D-#447)", !V.PERMISSIONS.some((p) => p.startsWith("archive:")));

console.log("=== SY. Exam syllabus (docs/prd-exam-syllabus.md §4, D-#530–#532; APP-NATIVE, NO wire twin) ===");
check("EXAM_TERMS exact — HALF_YEARLY/ANNUAL (§4)", eq(V.EXAM_TERMS, ["HALF_YEARLY","ANNUAL"]));
check("EXAM_TERM_LABELS_BN total", total(V.EXAM_TERM_LABELS_BN, V.EXAM_TERMS));
check("EXAM_TERM_LABELS_EN total", total(V.EXAM_TERM_LABELS_EN, V.EXAM_TERMS));
check("EXAM_COMPONENTS exact — CT/ADAB/FINAL (§5.2, D-#531)", eq(V.EXAM_COMPONENTS, ["CT","ADAB","FINAL"]));
check("EXAM_COMPONENT_LABELS_BN total", total(V.EXAM_COMPONENT_LABELS_BN, V.EXAM_COMPONENTS));
check("EXAM_COMPONENT_LABELS_EN total", total(V.EXAM_COMPONENT_LABELS_EN, V.EXAM_COMPONENTS));
check("SYLLABUS_STATUSES exact — DRAFT/TEACHER_REVIEW/PRINCIPAL_REVIEW/PUBLISHED (D-#533)",
  eq(V.SYLLABUS_STATUSES, ["DRAFT","TEACHER_REVIEW","PRINCIPAL_REVIEW","PUBLISHED"]));
check("SYLLABUS_STATUS_LABELS_BN total", total(V.SYLLABUS_STATUS_LABELS_BN, V.SYLLABUS_STATUSES));
check("SYLLABUS_STATUS_LABELS_EN total", total(V.SYLLABUS_STATUS_LABELS_EN, V.SYLLABUS_STATUSES));
check("SYLLABUS_ITEM_TYPES exact — 6 QUESTION_TYPES codes + creative/oral/practical/other (D-#530)",
  eq(V.SYLLABUS_ITEM_TYPES, ["mcq","short_answer","true_false","fill_blank","matching","descriptive","creative","oral","practical","other"]));
check("SYLLABUS_ITEM_TYPE_LABELS_BN total", total(V.SYLLABUS_ITEM_TYPE_LABELS_BN, V.SYLLABUS_ITEM_TYPES));
check("SYLLABUS_ITEM_TYPE_LABELS_EN total", total(V.SYLLABUS_ITEM_TYPE_LABELS_EN, V.SYLLABUS_ITEM_TYPES));
// D-#530 — the load-bearing check: the syllabus enum must NEVER be fused into the
// mirrored, wire-contract QUESTION_TYPES. Section A already pins QUESTION_TYPES to the
// envelope schema; this pins the two apart, so a "tidy-up" that merges them fails here.
check("QUESTION_TYPES is UNCHANGED by SY-1 — still exactly the 6 mirrored codes (D-#530)",
  eq(V.QUESTION_TYPES, ["mcq","short_answer","true_false","fill_blank","matching","descriptive"]));
check("SYLLABUS_ITEM_TYPES is a SUPERSET of QUESTION_TYPES, sharing code strings (D-#530)",
  V.QUESTION_TYPES.every((t) => V.SYLLABUS_ITEM_TYPES.includes(t)) && V.SYLLABUS_ITEM_TYPES.length > V.QUESTION_TYPES.length);
check("SYLLABUS_FULL_MARKS === 100 — one universal guard, every class (D-#532)", V.SYLLABUS_FULL_MARKS === 100);
// D-#533 — the sign-off is routine-derived, NOT a permission. A future exam:approve
// string would let AC-1 hand sign-off to someone who does not teach the subject.
check("no exam:approve / exam:publish permission — sign-off is routine-derived, publish rides the ROLE (D-#533/#397)",
  !V.PERMISSIONS.some((p) => p === "exam:approve" || p === "exam:publish"));
check("exam:manage held by PRINCIPAL + OFFICE only; TEACHER read-only; GUARDIAN none (§4)",
  V.roleHasPermission("PRINCIPAL","exam:manage") && V.roleHasPermission("OFFICE","exam:manage")
  && !V.roleHasPermission("TEACHER","exam:manage") && V.roleHasPermission("TEACHER","exam:read")
  && !V.roleHasPermission("GUARDIAN","exam:read") && !V.roleHasPermission("GUARDIAN","exam:manage"));

// --- Guardian work claim + return-from-leave (GC-1/RL-2, D-#551..#557) ------
// App-native vocabulary: no envelope twin, no import-contract sync (D-#46/#52).
check("WORK_CLAIM_TRACKER_LABELS_BN total", total(V.WORK_CLAIM_TRACKER_LABELS_BN, V.WORK_CLAIM_TRACKERS));
check("WORK_CLAIM_TRACKER_LABELS_EN total", total(V.WORK_CLAIM_TRACKER_LABELS_EN, V.WORK_CLAIM_TRACKERS));
check("WORK_CLAIM_STATUS_LABELS_BN total", total(V.WORK_CLAIM_STATUS_LABELS_BN, V.WORK_CLAIM_STATUSES));
check("WORK_CLAIM_STATUS_LABELS_EN total", total(V.WORK_CLAIM_STATUS_LABELS_EN, V.WORK_CLAIM_STATUSES));
check("WORK_CLAIM_REJECT_REASON_LABELS_BN total", total(V.WORK_CLAIM_REJECT_REASON_LABELS_BN, V.WORK_CLAIM_REJECT_REASONS));
check("WORK_CLAIM_REJECT_REASON_LABELS_EN total", total(V.WORK_CLAIM_REJECT_REASON_LABELS_EN, V.WORK_CLAIM_REJECT_REASONS));
check("work-claim statuses are exactly PENDING/ACCEPTED/REJECTED/EXPIRED (D-#552)",
  eq(V.WORK_CLAIM_STATUSES, ["PENDING", "ACCEPTED", "REJECTED", "EXPIRED"]));
check("a claim is only ever filable against DUE or CHASE — GIVEN is not late yet and ABSENT_REDELIVER means the child never received the work (D-#553)",
  eq(V.WORK_CLAIM_ELIGIBLE_STATES, ["DUE", "CHASE"]));
check("every eligible state is a real LifecycleState (D-#37 mirror)",
  V.WORK_CLAIM_ELIGIBLE_STATES.every((st) => V.LIFECYCLE_STATES.includes(st)));
check("the same-day rungs are 11:30 (Office) then 13:00 (Principal), in that order — owner ruling 2026-08-25, D-#554",
  V.WORK_CLAIM_OFFICE_RUNG_MIN === 690 && V.WORK_CLAIM_PRINCIPAL_RUNG_MIN === 780 &&
  V.WORK_CLAIM_OFFICE_RUNG_MIN < V.WORK_CLAIM_PRINCIPAL_RUNG_MIN);
check("one re-claim only, and a 7-school-day window (D-#553)",
  V.WORK_CLAIM_MAX_ATTEMPTS === 2 && V.WORK_CLAIM_WINDOW_SCHOOL_DAYS === 7);
check("NO work-claim permission is added — guardians file under guardian:read_child, teachers resolve under tracker:write, Office reads under tracker:read (D-#551/#554)",
  !V.PERMISSIONS.some((p) => p.startsWith("claim") || p.startsWith("workclaim") || p.startsWith("work_claim")));
check("OFFICE still holds NO tracker permission — the Office nudges and can never resolve a claim (D-#554)",
  !V.ROLE_PERMISSIONS.OFFICE.some((p) => p.startsWith("tracker:")));
check("GUARDIAN gains no new permission for filing a claim (D-#551)",
  eq(V.ROLE_PERMISSIONS.GUARDIAN, ["guardian:read_child"]));

console.log(`\nRESULT: ${fails === 0 ? "PASS — all checks green" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
