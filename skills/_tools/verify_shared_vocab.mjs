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
check("OFFICE = roster/staff/leave/payroll/performance/guardian/message/import/assign_review/routine/attendance/library/chat", eq(V.permissionsForRole("OFFICE"), ["roster:manage","staff:manage","leave:manage","payroll:manage","performance:manage","guardian:link","message:dispatch","content:import","content:assign_review","routine:read","routine:manage","attendance:manage","library:read","library:manage","chat:read","chat:write","chat:manage"]));
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
check("HW locked figures (240/120/40/20)", V.HW_DAILY_CEILING_MIN === 240 && V.HW_DAILY_FLOOR_MIN === 120 && V.HW_SUBJECT_BAND_MAX_MIN === 40 && V.HW_DEFAULT_TIME_DECL_MIN === 20);

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
check("kinds are exactly the 8 phase-1 kinds + 2 library kinds + 1 class-test kind + 1 vocab kind (D-#72/#74/#84/#122; VC-4 += VOCAB_RESULT, D-#154)", eq(V.NOTIFICATION_KINDS, ["BELL_REMINDER","ATTENDANCE_REMINDER","CLASS_NOTE_PROMPT","CLASS_NOTE_ESCALATION","CLASS_NOTE_PUBLISHED","HW_PARENT_COMMS","REVIEW_ASSIGNED","COVER_ASSIGNED","LIBRARY_DUE_SOON","LIBRARY_OVERDUE","CLASS_TEST_RESULT","VOCAB_RESULT"]));
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

console.log(`\nRESULT: ${fails === 0 ? "PASS — all checks green" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
