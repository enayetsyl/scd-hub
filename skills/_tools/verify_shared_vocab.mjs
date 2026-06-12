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
check("OFFICE = roster/staff/guardian/message/import/assign_review/routine/attendance/library", eq(V.permissionsForRole("OFFICE"), ["roster:manage","staff:manage","guardian:link","message:dispatch","content:import","content:assign_review","routine:read","routine:manage","attendance:manage","library:read","library:manage"]));
check("routine: PRINCIPAL+OFFICE manage, TEACHER read-only, GUARDIAN none", V.roleHasPermission("PRINCIPAL","routine:manage") && V.roleHasPermission("OFFICE","routine:manage") && V.roleHasPermission("TEACHER","routine:read") && !V.roleHasPermission("TEACHER","routine:manage") && !V.roleHasPermission("GUARDIAN","routine:read"));
check("TEACHER has content:review (reviewer APPROVE), lacks assign/promote", V.roleHasPermission("TEACHER","content:review") && !["content:assign_review","content:promote_gold"].some((p) => V.roleHasPermission("TEACHER", p)));
check("GUARDIAN only has guardian:read_child", eq(V.permissionsForRole("GUARDIAN"), ["guardian:read_child"]));
check("no role can write audit (audit:write undeclared)", !V.PERMISSIONS.includes("audit:write"));
check("all permissions active (guardian:read_child flipped to build by GP-1, D-#68)", V.PERMISSIONS.every((p) => V.PERMISSION_BUILD_STATUS[p] === "build"));

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
check("kinds are exactly the 8 phase-1 kinds + 2 library kinds (D-#72/#74/#84)", eq(V.NOTIFICATION_KINDS, ["BELL_REMINDER","ATTENDANCE_REMINDER","CLASS_NOTE_PROMPT","CLASS_NOTE_ESCALATION","CLASS_NOTE_PUBLISHED","HW_PARENT_COMMS","REVIEW_ASSIGNED","COVER_ASSIGNED","LIBRARY_DUE_SOON","LIBRARY_OVERDUE"]));
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

console.log(`\nRESULT: ${fails === 0 ? "PASS — all checks green" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
