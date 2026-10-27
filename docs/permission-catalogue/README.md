# Permission catalogue — every feature × every action

**Serves:** [`docs/prd-permission-matrix.md`](../prd-permission-matrix.md) (PM, D-#790–#801). **Source of truth:** `FEATURE_CATALOGUE` in [`shared/permissionCatalogue.ts`](../../shared/permissionCatalogue.ts) (BUILT 2026-10-21, D-#805) — this README and the area files describe it and must change in the same commit. Originally consolidated from seven read-only inventories of `origin/dev` (2026-10-20).

## Purpose
This catalogue is the build checklist for the permission matrix. It names every feature and every action a person can take in it, as a `feature:action` permission, with the Teacher and Office default that reproduces today's access exactly, so ship day changes nobody's access. The per-area files list every resolver, REST route, hidden role gate and app gate that must be re-pointed at these actions. [`legacy-expansion.md`](legacy-expansion.md) is the source for `LEGACY_PERMISSION_EXPANSION`, `LEGACY_PERMISSION_ALIASES` and `DELEGATED_ACTION_PERMISSIONS`. [`findings.md`](findings.md) lists gaps in today's gates that the inventory found. This plan did not cause them.

## How to read
- **Overview** (below): one row per feature, grouped the way the role editor groups them.
- **Per-feature tables** (further below): one row per action. `T` / `O` = the TEACHER / OFFICE template default (`on` or `—`). PRINCIPAL holds every action implicitly and is never listed (R3). GUARDIAN holds only `guardian:read_child` (see the end of this file).
- **Area files** (the build checklists):

| area file | covers |
|---|---|
| [`trackers-homework-assignment.md`](trackers-homework-assignment.md) | homework, assignment, assignment_gift, work_claim (+ reconciliation report) |
| [`trackers-classtest.md`](trackers-classtest.md) | class_test, class_test_question, class_test_script, set_tracker, student_profile (+ cross-refs to work_claim, question_sets, printing) |
| [`foundation-platform.md`](foundation-platform.md) | students, guardians, classes_sections, teaching_assignments, staff_logins, view_as, access_control, audit_log, system_health, guardian_engagement, message_templates, admin_dashboard, archive, notifications, my_account |
| [`hr-finance.md`](hr-finance.md) | staff_records, hr_policy, leave, cover, payroll, salary_advance, appraisal, conduct, grievance, staff_letters, offboarding, finance_*, budget, fee_support, qard, reconciliation, work_board, printing |
| [`attendance-routine-library.md`](attendance-routine-library.md) | attendance, staff_attendance, routine, class_note, library, chat, saturday_revision, vocab_test |
| [`observation-comments-reports.md`](observation-comments-reports.md) | classroom_observation, free_mixing_review, student_comments, parents_meeting, monthly_report, improvement_plan, teaching_notes, english_drive, worksheets |
| [`content-questions-exams.md`](content-questions-exams.md) | lesson_plans, plan_review, question_bank, question_review, question_sets, exam_syllabus, scholarship_practice, mastery, book_production |

## Flag legend
| flag | meaning |
|---|---|
| `LOCKED` | Reserved, Principal-only, never switchable. Shown with a lock and no switch. Write-time Bangla 422 plus the read-time backstop. The set is exactly the 11 actions that ride a `RESERVED_PERMISSIONS` entry today. |
| `PRINCIPAL-DEFAULT` | Today it rides the PRINCIPAL **role** inside a resolver or service (`role === "PRINCIPAL"`, `isPrincipalStaff`, the PRINCIPAL bypass in `assertCanWrite` / `assertAnchorWrite` / `vocabGate`). It becomes a switchable action, default Principal only. |
| `DESIGNATION:<name>` | Today the holder is a teacher only when designated. The action means "may do this **when designated**". The designation stays the row gate, and both must pass (PRD §5.2). **Waiver:** a holder of the feature's `view_all` (for reads) or `edit_all` (for writes) passes without the designation, which is how Office passes today. Where a row names a different waiver (`waived by …`), that action is the lever. |
| `SELF` | Everyone, for themselves. Not switchable. Shown read-only ("everyone, for themselves"). |
| `ESCALATION` | Mints logins, roles or scope. Default off. Server-side target guards (see F-3, F-4) must land before it may be switched on for T or O. |
| `†` | `view_all` / `edit_all` that is **inert for a pure-Office login** (Office lacks the base action). It is on for O only so that a teacher holding the OFFICE template keeps what `isAdminStaff` gives them today. |
| `F-n` | A today-gap. The default reproduces today anyway (R4). See [`findings.md`](findings.md). |
| `2H` | A two-hat delta. See "OFFICE-template teachers" below. |

## Harmonised action vocabulary
| verb | meaning |
|---|---|
| `view` | Read within own scope (teaching/proxy/supervisory grant, delegation, designation, or own rows). |
| `view_all` | Read beyond own scope: school-wide lists, dashboards, any row. Replaces `isAdminStaff` / `actsAsRole(P\|O)` "see everything" bypasses. Where a read is scoped, `view` opens it and `view_all` lifts the row limit. Dashboard-only reads gate on `view_all` alone. |
| `view_reports` | Oversight reports about other people's work (per-teacher lifecycle, effectiveness). Kept distinct because the holders differ from `view_all`. |
| `view_own` | SELF read of your own records. |
| `edit_all` | Act on rows beyond own scope, or on other people's work. Replaces the admin write bypasses (`isAdminStaff`, `roster:manage` "any row", `isAdmin` cell bypass), the PRINCIPAL scope bypass and the blanket OFFICE refusal in `assertCanWrite` / `assertCanWriteAny` / `assertAnchorWrite` / `vocabGate`. |
| `create` | File a new record (incl. a request, a draft, a set). |
| `edit` | Change an existing record you own or that sits in your scope. |
| `delete` | Remove, retire or soft-delete (and restore). |
| `declare` | Declare homework or deliver an assignment. Fixing or deleting your own declaration is part of it (D-#592). |
| `issue` | Give something out: homework or an assignment to an absent student later, a gift, a letter, an advance, a certificate. |
| `mark_submitted` | Take submission (submit pass, chase, re-chase). |
| `check` | Check homework or an assignment: result, outcome, answer file. BN for homework: যাচাই করা. |
| `return` | Return checked work or scripts. |
| `resubmit` | Explicitly open a resubmission. |
| `confirm_day` / `confirm_week` | Reconcile, trim (কমানো) and confirm the homework day / assignment week. |
| `undo` / `undo_any` | Undo your own same-day step / anyone's step on any day. |
| `enter_results` | Enter marks or results (class test, set tracker, revision, vocab, scholarship). |
| `publish` | Release to the next audience (guardians, the teacher, the shelf), incl. withhold/withdraw where the same desk does it. |
| `release` | Release a monthly report to the family. |
| `revoke` | Withdraw something already released, or disable access. |
| `approve` | Decide or sign off at a desk level (leave, cover, filing ack, gold, senior review). |
| `reject` | Close a guardian claim with a reason. |
| `assign` | Give a duty or a reviewer/observer/tester/cover to someone (বরাদ্দ). `assign_*` names the duty where one feature assigns several. |
| `send` | Send to guardians, families or the print queue. |
| `remind` | Send a রিমাইন্ডার or chase (teacher or guardian). |
| `export` / `import` | Download/upload a file or envelope. |
| `settings` | Configuration for the feature (thresholds, schedules, policies, catalogues). |
| `sign_off` | The Principal's final judgement (appraisal, conduct). |
| `prepare` | Office prepares something for someone else to act on (paper draft, payroll run, appraisal draft, final dues). |
| `override` | Act past a block with a reason (monthly coverage block, book build gate). |
| Kept distinct (meaning differs) | `register`, `scan`, `hand_back`, `observe`, `log_cpd`, `record_hearing`, `resolve`, `reverse`, `cancel`, `void`, `lend`, `process`, `schedule`, `set_quota`, `review`, `upload`, `author`, `illustrate`, `assemble`, `select_candidates`, `merge_split`, `link`, `reset_password`, `record_leave`, `edit_calendar`, `send_notice` / `send_notice_all`, `write_notes`, `view_brief`, `mark_attendance`, `cover_desk`, `assign_proxy`, `open`, `apply`, `propose`, `raise`, `use`, `tick`, `delegate`, `confirm`, `mark` |

### Renames and merges applied to the inventories
| inventory key | catalogue key | why |
|---|---|---|
| `work_claim:nudge` (A1) | `work_claim:remind` | remind |
| `homework:follow_up`, `assignment:follow_up` | `homework:remind`, `assignment:remind` | guardian chase = remind |
| `homework:delete_unissued` (= `homework:void`) | `homework:delete` | delete |
| `assignment:edit_any` | `assignment:edit_all` | other people's work = edit_all |
| `assignment_gift:hand_over` | `assignment_gift:issue` | giving the gift out = issue |
| `class_test:undo` (unpublish) | `class_test:revoke` | withdraw released results (same verb as monthly_report) |
| `class_test:print` | merged into `printing:view_all` / `printing:process` | one home for the print desk (PQ-5: a class test is a print job) |
| `question_set` (A2) + `question_sets` (F) | `question_sets` (owner: content area) | same resolvers inventoried twice |
| `question_sets:assemble` (F) / `question_set:create` (A2) | `question_sets:create` | create |
| `plan_review:assign_review`, `question_review:assign_review`, `book_production:assign_review` | `…:assign` | assign |
| `question_bank:retire` | `question_bank:delete` | soft-delete + restore = delete |
| `scholarship_practice:enter_marks` | `scholarship_practice:enter_results` | enter_results |
| `saturday_revision:deliver` / `:send` (chase teachers) | `saturday_revision:send` / `:remind` | send to guardians / remind teachers |
| `attendance:send`, `library:send` | `attendance:remind`, `library:remind` | chase = remind |
| `finance_ledger:chase` | `finance_ledger:remind` | fee-due reminder |
| `offboarding:revoke_access` | `offboarding:revoke` | revoke |
| `printing:request` | `printing:create` | create |
| `archive:checkout`, `archive:manage_boxes` | `archive:lend`, `archive:settings` | lend (as library), settings |
| `improvement_plan:override` (mark on a teacher's behalf) | `improvement_plan:edit_all` | other people's work = edit_all |
| `worksheets:create_for_teacher` | `worksheets:edit_all` | other people's work = edit_all |
| `conduct:finalize` (PRD §4.4) | `conduct:sign_off` | sign_off |
| `chat:oversee` (PRD §4.4) | `chat:view_all` (LOCKED) | view_all |
| `staff_records` (B) + `staff_records` (C) | one `staff_records` | merged; `staff_records:view_attendance` (C) moved to `staff_attendance:view_all` (D) |
| `teaching_assignments:assign_cover` (B), `cover` (C), `routine:assign` (D) | one `cover` feature: `view_all`, `approve`, `assign`, `assign_proxy`, `propose` | merged, one owner (hr-finance) |
| `reconciliationReport` | gate = any-of `homework:view_reports`, `assignment:view_reports` | no feature of its own |
| `studentProfileHomework` / `studentProfileAssignment` | `student_profile:view` | profile panels belong to the profile |
| new | `set_tracker:view_all`, `question_sets:view_all`, `lesson_plans:view_all` (homes for the isAdminStaff / contentScope read lifts), `library:edit_all` (Office's desk without a librarian duty), `homework:edit_all`, `set_tracker:edit_all`, `question_sets:edit_all`, `class_test:edit_all`, `scholarship_practice:edit_all`, `scholarship_practice:delete`, `class_test_script` "any" via `scan` | R1: replaces the PRINCIPAL scope bypass / role bypasses; scholarship topic retire split from save because the holders differ |

## OFFICE-template teachers (two-hat) — the one place R4 is not exact
Several of today's bypasses are template-aware (`isAdminStaff`, `actsAsRole`), while others check the **primary** role (`assertCanWrite`, `assertAnchorWrite`, `vocabGate`, `assertMayManage`, `contentScope`). A teacher who also holds the OFFICE template therefore has a mixed set of powers today. The defaults below reproduce **pure TEACHER and pure OFFICE logins exactly**. For two-hat teachers:
- **Reads stay exact.** Every `isAdminStaff` read bypass becomes `view_all`, and O is `on` (`†` where it is inert for pure Office).
- **Writes can shift** where one `edit_all` replaces both a template-aware bypass and a primary-role bypass:
  - `class_test:edit_all` (O on): a two-hat teacher today edits any test but enters results only in scope. After the change, `edit_all` also lifts the anchor-write scope for `enter_results`.
  - `scholarship_practice:edit_all` (O on): today the routine check is lifted only for primary P/O.
  - `assignment:edit_all` (O off): today a two-hat teacher may edit another teacher's cell inside their scope. After the change they cannot unless granted.
- These rows carry `2H`. The ship-day verifier compares permission sets, so it will pass. The `/verify` drive should include one two-hat login.

---

## Overview
| editor group | feature key | EN | BN | #actions | area file |
|---|---|---|---|---|---|
| Teaching & trackers | `homework` | Homework | বাড়ির কাজ | 14 | trackers-homework-assignment |
| Teaching & trackers | `assignment` | Weekly assignment | সাপ্তাহিক অ্যাসাইনমেন্ট | 15 | trackers-homework-assignment |
| Teaching & trackers | `assignment_gift` | Weekly gift | সাপ্তাহিক উপহার | 3 | trackers-homework-assignment |
| Teaching & trackers | `work_claim` | Guardian "done at home" claims | অভিভাবকের জানানো | 5 | trackers-homework-assignment |
| Teaching & trackers | `set_tracker` | Set tracker (legacy) | সেট ট্র্যাকার | 5 | trackers-classtest |
| Teaching & trackers | `class_note` | Class notes | ক্লাস নোট | 6 | attendance-routine-library |
| Teaching & trackers | `saturday_revision` | Saturday revision (Hifz) | শনিবারের রিভিশন | 7 | attendance-routine-library |
| Teaching & trackers | `vocab_test` | Vocabulary test | ভোকাবুলারি টেস্ট | 7 | attendance-routine-library |
| Assessment & exams | `class_test` | Class test | ক্লাস টেস্ট | 12 | trackers-classtest |
| Assessment & exams | `class_test_question` | Class-test paper requests | ক্লাস টেস্টের প্রশ্নপত্র অনুরোধ | 3 | trackers-classtest |
| Assessment & exams | `class_test_script` | Answer scripts (scan & return) | খাতা স্ক্যান ও ফেরত | 5 | trackers-classtest |
| Assessment & exams | `question_sets` | Question sets | প্রশ্ন সেট | 5 | content-questions-exams |
| Assessment & exams | `exam_syllabus` | Exam syllabus | পরীক্ষার সিলেবাস | 5 | content-questions-exams |
| Assessment & exams | `scholarship_practice` | Scholarship practice | বৃত্তি অনুশীলন | 7 | content-questions-exams |
| Assessment & exams | `mastery` | Learning mastery | শিখন-দক্ষতা | 7 | content-questions-exams |
| Students & families | `students` | Students | শিক্ষার্থী | 3 | foundation-platform |
| Students & families | `guardians` | Guardians | অভিভাবক | 4 | foundation-platform |
| Students & families | `student_profile` | Student profile | শিক্ষার্থী প্রোফাইল | 3 | trackers-classtest |
| Students & families | `student_comments` | Daily comments | দৈনিক মন্তব্য | 5 | observation-comments-reports |
| Students & families | `parents_meeting` | Parents' meeting | অভিভাবক সভা | 9 | observation-comments-reports |
| Students & families | `monthly_report` | Monthly progress report | মাসিক অগ্রগতি রিপোর্ট | 9 | observation-comments-reports |
| Students & families | `improvement_plan` | Student progress & improvement | শিক্ষার্থীর অগ্রগতি ও উন্নতির কাজ | 6 | observation-comments-reports |
| Attendance & routine | `attendance` | Student attendance | শিক্ষার্থীর উপস্থিতি | 7 | attendance-routine-library |
| Attendance & routine | `staff_attendance` | Staff attendance | শিক্ষক-কর্মীর উপস্থিতি | 3 | attendance-routine-library |
| Attendance & routine | `routine` | Routine & calendar | রুটিন ও ক্যালেন্ডার | 5 | attendance-routine-library |
| Attendance & routine | `cover` | Cover classes | বদলি ক্লাস | 5 | hr-finance |
| Staff & HR | `staff_records` | Staff records | কর্মীর তথ্য | 4 | hr-finance |
| Staff & HR | `hr_policy` | HR policy | এইচআর নিয়মকানুন | 2 | hr-finance |
| Staff & HR | `leave` | Staff leave | কর্মীর ছুটি | 5 | hr-finance |
| Staff & HR | `appraisal` | Appraisal & CPD | কাজের মূল্যায়ন ও প্রশিক্ষণ | 6 | hr-finance |
| Staff & HR | `conduct` | Conduct | শৃঙ্খলা | 5 | hr-finance |
| Staff & HR | `grievance` | Grievances | অভিযোগ | 3 | hr-finance |
| Staff & HR | `staff_letters` | Letters & contracts | চিঠি ও চুক্তিপত্র | 3 | hr-finance |
| Staff & HR | `offboarding` | Leaving the school | চাকরি ছাড়া | 8 | hr-finance |
| Staff & HR | `classroom_observation` | Classroom observation | ক্লাসরুম পর্যবেক্ষণ | 11 | observation-comments-reports |
| Staff & HR | `free_mixing_review` | Free-mixing video review | ফ্রি মিক্সিং পর্যবেক্ষণ | 3 | observation-comments-reports |
| Finance | `payroll` | Payroll | বেতন | 6 | hr-finance |
| Finance | `salary_advance` | Salary advances | অগ্রিম বেতন | 3 | hr-finance |
| Finance | `finance_ledger` | Daily books | হিসাবের খাতা | 5 | hr-finance |
| Finance | `finance_reports` | Finance reports | আর্থিক রিপোর্ট | 1 | hr-finance |
| Finance | `budget` | Budget | বাজেট | 2 | hr-finance |
| Finance | `fee_support` | Zakat & fee support | যাকাত ও ফি সহায়তা | 3 | hr-finance |
| Finance | `qard` | Qard-hasan / IOU | কর্জে হাসানা | 3 | hr-finance |
| Finance | `reconciliation` | Bank reconciliation | হিসাব মেলানো | 2 | hr-finance |
| Content & books | `lesson_plans` | Lesson plans | পাঠ পরিকল্পনা | 3 | content-questions-exams |
| Content & books | `plan_review` | Plan review | পরিকল্পনা রিভিউ | 3 | content-questions-exams |
| Content & books | `question_bank` | Question bank | প্রশ্নব্যাংক | 5 | content-questions-exams |
| Content & books | `question_review` | Question review & publishing | প্রশ্ন রিভিউ | 4 | content-questions-exams |
| Content & books | `book_production` | Book production | বই তৈরি | 10 | content-questions-exams |
| Content & books | `teaching_notes` | Notes & guides | নোট ও গাইড | 5 | observation-comments-reports |
| Content & books | `english_drive` | English drive | ইংরেজি ড্রাইভ | 4 | observation-comments-reports |
| Content & books | `worksheets` | Worksheet generator | প্রশ্ন ও অ্যাসাইনমেন্ট তৈরি | 5 | observation-comments-reports |
| Communication | `chat` | Staff chat & notices | বার্তা | 8 | attendance-routine-library |
| Communication | `popup_notice` | Pop-up notices | পপ-আপ বার্তা | 4 | attendance-routine-library |
| Communication | `message_templates` | Message templates | বার্তার টেমপ্লেট | 2 | foundation-platform |
| Communication | `notifications` | My notifications | আমার নোটিফিকেশন | 1 | foundation-platform |
| School operations | `library` | Library | লাইব্রেরি | 8 | attendance-routine-library |
| School operations | `printing` | Printing | প্রিন্ট | 3 | hr-finance |
| School operations | `archive` | Script archive | খাতার আর্কাইভ | 7 | foundation-platform |
| School operations | `work_board` | Work board | কাজের বোর্ড | 4 | hr-finance |
| School operations | `admin_dashboard` | Admin Today dashboard | অ্যাডমিন ড্যাশবোর্ড | 1 | foundation-platform |
| School operations | `classes_sections` | Classes & sections | শ্রেণি ও শাখা | 3 | foundation-platform |
| School operations | `teaching_assignments` | Teaching assignments | শিক্ষক বরাদ্দ | 4 | foundation-platform |
| Reports | `reports` | Reports | রিপোর্ট | 26 | trackers-homework-assignment |
| Admin & access | `access_control` | Access control | অনুমতি নিয়ন্ত্রণ | 2 | foundation-platform |
| Admin & access | `view_as` | View as another account | অন্যের অ্যাকাউন্ট দেখা | 1 | foundation-platform |
| Admin & access | `staff_logins` | Staff logins | কর্মীদের লগইন | 3 | foundation-platform |
| Admin & access | `audit_log` | Audit log | অডিট লগ | 2 | foundation-platform |
| Admin & access | `system_health` | System health | সিস্টেমের অবস্থা | 1 | foundation-platform |
| Admin & access | `guardian_engagement` | Guardian app usage | অভিভাবকদের অ্যাপ ব্যবহার | 1 | foundation-platform |
| Admin & access | `my_account` | My account | আমার অ্যাকাউন্ট | 1 | foundation-platform |

**Totals: 71 features, 357 actions** (`class_books` added 2026-10-26, D-#870: +2 actions, unflagged, TEACHER on +1, OFFICE on +2) (`reports` +13 switches 2026-10-26, D-#861: the reports that sat in the Admin hub and module homes, unflagged, OFFICE on +12 — all but `guardian_engagement`; `reports:lesson_progress` arrives with lesson progress) (`reports` added 2026-10-25, D-#846: +13 report switches, −3 retired report-only actions) (`parents_meeting:approve_change` added with meeting RSVP, 2026-10-24: +1 action, PRINCIPAL-DEFAULT, D-#842) (`mastery` added with M-0, 2026-10-20: +6 actions, all unflagged, TEACHER on +3, OFFICE on +1; M-2, 2026-10-21: +`mastery:edit_all`, PRINCIPAL-DEFAULT). By flag: LOCKED 11 · PRINCIPAL-DEFAULT 15 · DESIGNATION 24 · ESCALATION 5 · SELF 12 · unflagged 280. Defaults: TEACHER on 102 · OFFICE on 252. A row may carry a `†`/`F-n`/`2H` note in addition to its flag. Those notes are not counted as flags. Not counted: `guardian:read_child` (GUARDIAN plane), and the future `scholarship_practice:release` (SC-5, not built) and `announcements:publish` (no staff surface yet).

---

## Per-feature action tables

### Teaching & trackers

#### `homework` — বাড়ির কাজ
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `homework:view` | View homework | বাড়ির কাজ দেখা | Workspace, day tally, records, roll-ups, own lifecycle card | on | — | | tracker:read |
| `homework:view_all` | View every শাখা's homework | সব শাখার বাড়ির কাজ দেখা | Any শাখা without a grant; class-wide numbers | — | on | † | isAdminStaff in assertCanRead / allowedSubjectCodesForSection / homeworkSummary / homeworkClassOverview |
| `homework:declare` | Declare homework | বাড়ির কাজ ঘোষণা করা | Declare, fix or delete own item before confirm; question file; "no homework today" | on | — | | tracker:write + declare_homework |
| `homework:issue` | Give to an absent student later | অনুপস্থিত শিক্ষার্থীকে পরে দেওয়া | ABSENT_REDELIVER → GIVEN; issue one item outside the day confirm | on | — | | tracker:write |
| `homework:mark_submitted` | Take submission | জমা নেওয়া | Submit pass, mark submitted, chase / re-chase, open collection | on | — | | tracker:write + submit_homework |
| `homework:check` | Check homework | বাড়ির কাজ যাচাই করা | Result, one-tap outcome, checked-answer file | on | — | | tracker:write + check_homework |
| `homework:return` | Return checked homework | খাতা ফেরত দেওয়া | Return pass (CHECKED/RESUBMIT → RETURNED) | on | — | | tracker:write + check_homework (D-#592) |
| `homework:confirm_day` | Confirm the homework day | দিনের বাড়ির কাজ চূড়ান্ত করা | Reconcile against 120 min, trim (কমানো) an item, confirm and issue the day | on | — | DESIGNATION:class_teacher/homework_confirmer/homework_supervisor | tracker:write + assertCanConfirmHomework |
| `homework:undo` | Undo my own step | নিজের ধাপ ফিরিয়ে নেওয়া | Undo own last step, same Dhaka day | on | — | | authenticated + assertCanWriteAny(declare/submit/check) |
| `homework:undo_any` | Undo anyone's step | যেকোনো ধাপ ফিরিয়ে নেওয়া | Undo another teacher's step or an earlier day's | — | on | F-7 | isAdminStaff `admin` flag in revertHomeworkRecord |
| `homework:edit_all` | Work in any শাখা | যেকোনো শাখার বাড়ির কাজে কাজ করা | Declare/submit/check/return outside own grants | — | — | PRINCIPAL-DEFAULT | PRINCIPAL bypass in assertCanWrite / assertCanWriteAny |
| `homework:delete` | Delete never-issued homework | না-দেওয়া বাড়ির কাজ মুছে ফেলা | List never-issued items school-wide and remove one, even on a closed day | — | on | | homework:void |
| ~~`homework:view_reports`~~ | RETIRED (D-#846) | — | Replaced by one switch per report: `reports:hw_declare_pending`, `reports:hw_issue_pending`, `reports:hw_lifecycle`, `reports:reconciliation` | — | — | | stored grants / role edits translate |
| ~~`homework:remind`~~ | RETIRED (D-#846) | — | Replaced by one switch per report: `reports:hw_weekly_unsubmitted` | — | — | | stored grants / role edits translate |

#### `assignment` — সাপ্তাহিক অ্যাসাইনমেন্ট
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `assignment:view` | View assignments | অ্যাসাইনমেন্ট দেখা | Workspace, records, counts, weekly grid, handout board, own cards and prompts | on | — | | tracker:read; assertStaffScheduleRead |
| `assignment:view_all` | View every শাখা's assignments | সব শাখার অ্যাসাইনমেন্ট দেখা | Any শাখা without a grant; whole-school summary | — | on | † | isAdminStaff in assertCanRead; `role === "TEACHER"` self-scope in assignmentSummary |
| `assignment:declare` | Deliver assignment | অ্যাসাইনমেন্ট দেওয়া | Deliver the week's item, fix/delete own draft, "no assignment this week" | on | — | | tracker:write + declare_assignment |
| `assignment:edit_all` | Work on others' assignments | অন্যের অ্যাসাইনমেন্ট সংশোধন | Edit/delete another teacher's cell; act outside own grants | — | — | PRINCIPAL-DEFAULT, 2H | isAdmin=isAdminStaff cell bypass; PRINCIPAL bypass in assertCanWrite |
| `assignment:issue` | Give to an absent student later | অনুপস্থিত শিক্ষার্থীকে পরে দেওয়া | ABSENT_REDELIVER → GIVEN | on | — | | tracker:write + declare_assignment |
| `assignment:mark_submitted` | Take submission | জমা নেওয়া | Submit pass, mark submitted, chase | on | — | | tracker:write + submit_assignment |
| `assignment:check` | Check assignment | অ্যাসাইনমেন্ট যাচাই করা | Result, marks, feedback, one-tap outcome | on | — | | tracker:write + check_assignment |
| `assignment:resubmit` | Ask to redo | আবার জমা দিতে বলা | CHECKED → RESUBMIT plus a new record | on | — | | tracker:write + check_assignment |
| `assignment:return` | Return checked assignment | অ্যাসাইনমেন্ট ফেরত দেওয়া | Return pass | on | — | | tracker:write + check_assignment |
| `assignment:confirm_week` | Confirm the assignment week | সপ্তাহের অ্যাসাইনমেন্ট চূড়ান্ত করা | Reconcile against 360 min, trim (কমানো) minutes, confirm | on | on | DESIGNATION:class_teacher (waived by `assignment:settings`), F-8 | assertCanConfirmAssignmentWeek (roster:manage OR class teacher) |
| `assignment:undo` | Undo my own step | নিজের ধাপ ফিরিয়ে নেওয়া | Undo own same-day step | on | — | | authenticated + assertCanWriteAny |
| `assignment:undo_any` | Undo anyone's step | যেকোনো ধাপ ফিরিয়ে নেওয়া | Admin revert, any actor, any day | — | on | F-7 | isAdminStaff `admin` flag |
| `assignment:remind` | Guardian chase ladder | অভিভাবককে রিমাইন্ডার | Chase list, ladder step, outcome, history, bulk sweep | — | on | | message:dispatch + assertFollowUpAdmin (isAdminStaff) |
| `assignment:settings` | Rotation schedule | রোটেশন সূচি ঠিক করা | Term anchor, cadence, rotation cells; read schedule / grid / handout board | — | on | | roster:manage |
| ~~`assignment:view_reports`~~ | RETIRED (D-#846) | — | Replaced by one switch per report: `reports:assignment_load`, `reports:as_declare_pending`, `reports:as_deliver_pending`, `reports:as_print_pending`, `reports:reconciliation` | — | — | | stored grants / role edits translate |

#### `assignment_gift` — সাপ্তাহিক উপহার
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `assignment_gift:view` | View gift report | উপহারের তালিকা দেখা | Weekly winners and streaks for a শাখা in scope | on | on | | tracker:read OR gift:manage |
| `assignment_gift:view_all` | Whole-school gift report | সব শাখার উপহারের তালিকা দেখা | Report with no শাখা | — | on | | gift:manage; isAdminStaff |
| `assignment_gift:issue` | Mark gift given | উপহার দেওয়া হয়েছে চিহ্নিত করা | Tick a handover, undo a mis-tick | on | on | DESIGNATION:class_teacher | gift:manage; assertCanHandOverGift |

#### `work_claim` — অভিভাবকের জানানো
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `work_claim:view_all` | See the claim queue | সব অভিভাবকের জানানো দেখা | School-wide unresolved queue; digest recipient list | on | on | DESIGNATION:digest_recipient (waived by `admin_dashboard:view`) | canWatchClaims (isAdminStaff OR digest list) |
| `work_claim:reject` | Reject a claim | জানানো নাকচ করা | Close a claim with a reason the family sees | on | — | F-5 | tracker:write |
| `work_claim:remind` | Remind the teacher | শিক্ষককে রিমাইন্ডার পাঠানো | Re-send the teacher's notification, once a day | on | on | DESIGNATION:digest_recipient (waived by `admin_dashboard:view`) | canWatchClaims |
| `work_claim:settings` | Choose digest recipients | দৈনিক সারসংক্ষেপ কারা পাবেন ঠিক করা | Replace the 10:30 digest's extra recipients | — | — | PRINCIPAL-DEFAULT | `role === "PRINCIPAL"` |
| `work_claim:view_own` | My claims | আমার কাজের জানানো | Claims on my own work; never refuses (D-#535) | on | on | SELF | authenticated, own rows |

#### `set_tracker` — সেট ট্র্যাকার (legacy J4)
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `set_tracker:view` | View tracker sessions | ট্র্যাকার দেখা | Session list, a record, summary | on | — | | tracker:read |
| `set_tracker:view_all` | Any শাখা's sessions | সব শাখার ট্র্যাকার দেখা | Read without a grant | — | on | † | isAdminStaff in assertCanRead |
| `set_tracker:enter_results` | Run a tracker session | ট্র্যাকার চালানো ও এন্ট্রি | Open, record entries, close | on | — | | tracker:write |
| `set_tracker:remind` | Build a wa.me nudge | অভিভাবককে wa.me রিমাইন্ডার | wa.me link for a non-submitter | on | on | | message:dispatch |
| `set_tracker:edit_all` | Run any শাখা's tracker | যেকোনো শাখার ট্র্যাকার চালানো | Act outside own grants | — | — | PRINCIPAL-DEFAULT | PRINCIPAL bypass in assertCanWrite |

#### `class_note` — ক্লাস নোট
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `class_note:view` | See class notes | ক্লাস নোট দেখা | A শাখা's notes (row-scoped), own archive, filters, attachments | on | on | | routine:read |
| `class_note:create` | Write my class note | নিজের ক্লাসের নোট লেখা | Publish the note for a period you teach or cover; prompts; upload | on | on | DESIGNATION:slot_teacher_or_cover | routine:read + resolveNoteAuthorization |
| `class_note:edit` | Correct my class note | নিজের ক্লাস নোট সংশোধন | Edit a note you published | on | on | | routine:read + publishedBy |
| `class_note:view_all` | All teachers' notes | সব শিক্ষকের ক্লাস নোট দেখা | Admin list, submission report, school-wide archive | — | on | | routine:manage |
| `class_note:edit_all` | Write/correct any note | যেকোনো ক্লাস নোট লেখা/সংশোধন | Publish on any slot; edit any note | — | on | | isAdminStaff (publish); routine:manage (update) |
| `class_note:delete` | Delete a class note | ক্লাস নোট মুছে ফেলা | Remove a note | — | on | | routine:manage |

#### `saturday_revision` — শনিবারের রিভিশন
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `saturday_revision:view` | See my groups' revision | নিজের গ্রুপের রিভিশন দেখা | Group grid, history, heatmap, coverage, trend, dashboards | on | on | DESIGNATION:group_lead | tracker:read + teacherTeachesGroup; isAdminStaff |
| `saturday_revision:view_all` | See all groups | সব গ্রুপের রিভিশন দেখা | Unscoped reads; Saturday completeness status | — | on | | isAdminStaff |
| `saturday_revision:enter_results` | Record revision results | রিভিশনের ফল লেখা | Record or edit a Saturday entry | on | on | DESIGNATION:group_lead | tracker:write + group lead; isAdminStaff |
| `saturday_revision:edit_all` | Any group | যেকোনো গ্রুপের রিভিশন লেখা ও পাঠানো | Write/send outside own groups | — | on | | isAdminStaff |
| `saturday_revision:send` | Send to guardians | অভিভাবককে রিভিশন পাঠানো | Send one entry or a group's Saturday (seals it, runs escalation) | on | on | DESIGNATION:group_lead | tracker:write + group lead; isAdminStaff |
| `saturday_revision:remind` | Remind teachers | বাকি থাকা শিক্ষককে রিমাইন্ডার | wa.me nudge per teacher of an un-entered group | — | on | | isAdminStaff ∧ message:dispatch |
| `saturday_revision:settings` | Absence escalation limit | টানা অনুপস্থিতির সীমা ঠিক করা | Read/set the threshold | — | on | | isAdminStaff |

#### `vocab_test` — ভোকাবুলারি টেস্ট
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `vocab_test:view` | See vocab tests & reports | ভোকাবুলারি টেস্ট ও রিপোর্ট দেখা | Word bank, tests, results, dashboards, own tester duties | on | — | F-12 | tracker:read |
| `vocab_test:edit` | Edit the word bank | শব্দভাণ্ডার সংশোধন | Add, edit, deactivate words for a class level you teach | on | — | | tracker:write + assertCanManageClassLevel |
| `vocab_test:create` | Build a test | টেস্ট তৈরি | Create/update a test, lay positions | on | — | DESIGNATION:vocab_tester | tracker:write + assertCanOperateVocab |
| `vocab_test:enter_results` | Mark a test | টেস্টের ফল লেখা | Present/absent and mistakes per student | on | — | DESIGNATION:vocab_tester | tracker:write + assertCanOperateVocab |
| `vocab_test:edit_all` | Run any শাখা's vocab | যেকোনো শাখার ভোকাবুলারি চালানো | Bypass tester/class-level scope | — | — | PRINCIPAL-DEFAULT | `role === "PRINCIPAL"` in vocabGate (OFFICE hard-denied today) |
| `vocab_test:assign` | Assign weekly tester | সাপ্তাহিক টেস্টের দায়িত্ব বরাদ্দ | Set a tester; history | — | on | | roster:manage |
| `vocab_test:send` | Send results to guardians | অভিভাবককে ফল পাঠানো | Per-test / cumulative guardian messages | on | on | F-12 | message:dispatch (unscoped) |

### Assessment & exams

#### `class_test` — ক্লাস টেস্ট
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `class_test:view` | View class tests & marks | ক্লাস টেস্ট ও নম্বর দেখা | Tests, roster, marks, report status, analysis, own lists | on | — | F-18 | tracker:read; tracker:write (own lists) |
| `class_test:view_all` | All class tests | সব ক্লাস টেস্ট দেখা | Dashboard, school-wide overdue counts, any test unscoped | — | on | | isAdminStaff |
| `class_test:create` | Request a class test | ক্লাস টেস্টের প্রিন্ট অনুরোধ | File a test and its paper into the print queue; number suggestion | on | — | | tracker:write + assertAnchorWrite |
| `class_test:register` | Register a test held without printing | প্রিন্ট ছাড়া ক্লাস টেস্ট নথিভুক্ত করা | Create an official test directly | on | on | | tracker:write + anchor; isAdminStaff unscoped |
| `class_test:edit` | Correct my test's details | নিজের পরীক্ষার তথ্য সংশোধন | Total, pass mark, date of own test | on | — | | tracker:write + own (ClassTestService) |
| `class_test:edit_all` | Act on any test | যেকোনো ক্লাস টেস্টে কাজ করা | Edit any test; register unscoped / on behalf (D-#366); outside own grants | — | on | 2H | roster:manage "any"; isAdminStaff register; PRINCIPAL anchor bypass |
| `class_test:delete` | Retire / restore a test | ক্লাস টেস্ট বাতিল ও ফিরিয়ে আনা | Retire a PRINTED test with a reason; restore | — | on | | roster:manage |
| `class_test:enter_results` | Enter marks & submit | নম্বর এন্ট্রি ও অনুমোদনের জন্য পাঠানো | Enter/edit marks, submit, recall | on | — | | tracker:write + enter_classtest_result |
| `class_test:publish` | Approve & publish results | ফলাফল অনুমোদন করে প্রকাশ / ফেরত পাঠানো | Release to guardians (test or student); send back with a reason | — | on | F-18 | roster:manage |
| `class_test:revoke` | Withdraw published results | প্রকাশিত ফলাফল ফিরিয়ে নেওয়া | Unpublish a test or one student | — | on | | roster:manage |
| `class_test:remind` | Chase overdue results | দেরি হওয়া ফলাফলের জন্য রিমাইন্ডার | Overdue chase list with wa.me | — | on | | isAdminStaff ∧ message:dispatch |
| `class_test:settings` | Result-entry targets | নম্বর এন্ট্রির লক্ষ্য ঠিক করা | Set/change/switch off a teacher's backlog target | — | — | PRINCIPAL-DEFAULT | `role === "PRINCIPAL"` |

#### `class_test_question` — ক্লাস টেস্টের প্রশ্নপত্র অনুরোধ
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `class_test_question:create` | Request a question paper | অফিসের কাছে প্রশ্নপত্র চাওয়া | File/edit/cancel own request, review the draft, send to print | on | — | | tracker:write + anchor + requester-only |
| `class_test_question:prepare` | Prepare papers | প্রশ্নপত্র তৈরি করে শিক্ষকের কাছে পাঠানো | Whole queue; upload a draft to the requester | — | on | | roster:manage (assertOffice) |
| `class_test_question:delete` | Delete a request | প্রশ্নপত্র অনুরোধ মুছে ফেলা | Soft-delete a request | — | on | | roster:manage |

#### `class_test_script` — খাতা স্ক্যান ও ফেরত
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `class_test_script:view` | See script stage | খাতার অবস্থা দেখা | One test's script stage; open a tagged scan | on | on | F-16 | tracker:read OR roster:manage |
| `class_test_script:scan` | Receive, scan & tag | খাতা গ্রহণ, স্ক্যান ও শিক্ষার্থী অনুযায়ী যুক্ত করা | Desk: receive/undo, pages, missing, waive; acts on any test's scripts | — | on | | roster:manage |
| `class_test_script:publish` | Publish scans to guardians | খাতার ছবি অভিভাবকদের কাছে প্রকাশ | Release or withdraw scans | — | on | | roster:manage |
| `class_test_script:hand_back` | Hand scripts back | খাতা শিক্ষকের হাতে ফেরত দেওয়া | Office gives papers back for return in class | — | on | | roster:manage |
| `class_test_script:return` | Mark returned to students | শিক্ষার্থীদের খাতা ফেরত দেওয়া হয়েছে | Own script tasks; mark returned (own test; `scan` holders any) | on | — | | tracker:write + accountable teacher |

#### `question_sets` — প্রশ্ন সেট
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `question_sets:view` | View sets | প্রশ্ন সেট দেখা | Sets, recent sets, where a question was used | on | — | F-17 | set:read |
| `question_sets:view_all` | Any শাখা's sets | সব শাখার প্রশ্ন সেট দেখা | Read without a grant | — | on | † | isAdminStaff in assertCanRead |
| `question_sets:create` | Build sets | প্রশ্ন সেট তৈরি করা | Create, add/remove questions, rename, finalise | on | — | | set:assemble + question:select |
| `question_sets:export` | Set PDF | সেটের পিডিএফ নামানো | Student copy or answer key (Office: print-queued sets via printing) | on | — | F-19 | set:read (set:export never checked) |
| `question_sets:edit_all` | Build in any শাখা | যেকোনো শাখার সেট তৈরি | Act outside own grants | — | — | PRINCIPAL-DEFAULT | PRINCIPAL bypass in assertCanWrite |

#### `exam_syllabus` — পরীক্ষার সিলেবাস
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `exam_syllabus:view` | View syllabus | সিলেবাস দেখা | Published syllabuses, exam list, class PDF | on | on | F-10 | exam:read (never enforced; authenticated today) |
| `exam_syllabus:view_all` | Syllabus board & drafts | সব শ্রেণির সিলেবাস বোর্ড ও খসড়া দেখা | Coverage board, level board, unpublished rows | — | on | | exam:manage ∧ isAdminStaff |
| `exam_syllabus:settings` | Set up exams | পরীক্ষা তৈরি ও তারিখ ঠিক করা | Create an exam, edit name and dates | — | on | | exam:manage |
| `exam_syllabus:edit` | Write syllabus | সিলেবাস লেখা ও অনুমোদনে পাঠানো | Write/edit, class footer, approver, submit, reassign, send back at PRINCIPAL_REVIEW | — | on | | exam:manage |
| `exam_syllabus:publish` | Publish syllabus | সিলেবাস প্রকাশ করা | PRINCIPAL_REVIEW → PUBLISHED; approve when the routine names nobody | — | — | PRINCIPAL-DEFAULT | isPrincipalStaff |

#### `scholarship_practice` — বৃত্তি অনুশীলন
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `scholarship_practice:view` | Results & weak topics | অনুশীলনের ফল ও দুর্বলতা দেখা | Papers, analysis, topics, candidates, Excel export | on | on | F-11 | scholarship:read |
| `scholarship_practice:create` | Declare a practice paper | অনুশীলন প্রশ্নপত্র ঘোষণা করা | Declare a paper and items; live item check | on | on | | scholarship:manage (T: routine-held class × subject) |
| `scholarship_practice:enter_results` | Enter marks | নম্বর তোলা | Per-item marks and absent status | on | on | | scholarship:manage |
| `scholarship_practice:settings` | Topic catalogue | টপিক তালিকা ঠিক করা | Add or edit topics | on | on | | scholarship:manage (role ∈ P/O/T) |
| `scholarship_practice:delete` | Retire a topic | টপিক বাদ দেওয়া | Retire a topic | — | on | | scholarship:manage + role ∈ {P,O} |
| `scholarship_practice:select_candidates` | Choose exam candidates | বৃত্তি পরীক্ষার্থী বাছাই করা | Enter or withdraw a child | — | on | F-32 | scholarship:manage + role ∈ {P,O} |
| `scholarship_practice:edit_all` | Work on every শাখা | যেকোনো শাখার অনুশীলন সামলানো | Skip the routine class × subject check | — | on | 2H | assertMayManage primary-role P/O bypass |

#### `mastery` — শিখন-দক্ষতা
Learning-outcome mastery tracker (`docs/prd-mastery.md`, D-#775–#787). Registered with M-0; `enter_results`, `create` and `approve` gate slices M-2..M-5 and are declared now so the role map is settled once. Today's permissions are already one-to-one (`mastery:read/enter/manage/approve`).
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `mastery:view` | View catalogue, marks, tags, policy | শিখনফল তালিকা, নম্বর, ট্যাগ ও পলিসি দেখা | Read the outcome catalogue, question-type marks, tags, policy and the switch (later: diagnosis views, row-scoped for teachers) | on | on | | mastery:read |
| `mastery:settings` | Manage the catalogue & policy | শিখনফল তালিকা ও পলিসি ঠিক করা | Import (preview/apply) and lock a catalogue, edit outcomes, question-type marks, tags, policy, the year × class × subject switch | — | — | | mastery:manage |
| `mastery:delete` | Retire an outcome | শিখনফল অবসরে দেওয়া | LOCKED → RETIRED; a draft is removed | — | — | | mastery:manage |
| `mastery:enter_results` | Enter per-question results | প্রশ্নভিত্তিক নম্বর তোলা | Exceptions-only entry, re-work, tags, rubric (M-2), routine-held class × subject | on | — | | mastery:enter |
| `mastery:create` | Build homework sheets & assignments | বাড়ির কাজ ও অ্যাসাইনমেন্ট তৈরি | Work sheets, the weekly tailored assignment and its layout (M-2/M-4), routine-held class × subject | on | — | | mastery:enter |
| `mastery:approve` | Approve extra classes | অতিরিক্ত ক্লাস অনুমোদন | Approve a section-trigger proposal, pick slot/teacher, close the action (M-5). Principal by role; selected Office holders by per-user grant (D-#786) | — | — | | mastery:approve |
| `mastery:edit_all` | Work in any শাখা | যেকোনো শাখার শিখন-দক্ষতার কাজ | Build sheets, enter and read results for a class × subject the routine does not give you (M-2, D-#807) | — | — | PRINCIPAL-DEFAULT | (new) |

### Students & families

#### `students` — শিক্ষার্থী
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `students:view_all` | Whole-school student list | সব শিক্ষার্থীর তালিকা দেখা | Student directory (class, শাখা, groups, guardian phones) | — | on | F-1 | roster:manage |
| `students:create` | Add a student | নতুন শিক্ষার্থী যোগ করা | Add to a class/শাখা | — | on | | roster:manage |
| `students:edit` | Edit student details | শিক্ষার্থীর তথ্য ঠিক করা | Set/clear roll number | — | on | | roster:manage |

#### `guardians` — অভিভাবক
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `guardians:view_all` | See all guardians | সব অভিভাবকের তালিকা দেখা | Guardian directory | — | on | | guardian:link |
| `guardians:create` | Add a guardian | নতুন অভিভাবক যোগ করা | Create a guardian account | — | on | | guardian:link |
| `guardians:link` | Link/unlink a child | শিক্ষার্থীর সাথে অভিভাবক যুক্ত/বিচ্ছিন্ন করা | Add/deactivate a guardian↔শিক্ষার্থী link | — | on | | guardian:link |
| `guardians:reset_password` | Guardian logins | অভিভাবকের লগইন তৈরি ও পাসওয়ার্ড রিসেট | Provision or reset a family's phone login | — | on | | guardian:link |

#### `student_profile` — শিক্ষার্থী প্রোফাইল
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `student_profile:view` | Open a profile | শিক্ষার্থীর প্রোফাইল দেখা | Header, homework, assignment, class test, উপস্থিতি, comments panels; whole picture | on | on | | authenticated + assertStudentProfileRead |
| `student_profile:view_all` | Any শিক্ষার্থী's profile | সব শিক্ষার্থীর প্রোফাইল দেখা | Profile with no row limit | — | on | | isAdminStaff |
| `student_profile:export` | Profile PDF | প্রোফাইল PDF ডাউনলোড | Print the profile sheet | on | on | | assertStudentProfileRead |

#### `student_comments` — দৈনিক মন্তব্য
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `student_comments:create` | Write a daily comment | দৈনিক মন্তব্য লেখা | Comment on any শিক্ষার্থী; edit own undelivered; own list | on | — | | tracker:write |
| `student_comments:view` | See a শাখা's comments | শাখার মন্তব্য দেখা | শাখা list, a শিক্ষার্থী's timeline, within read scope | on | on | | authenticated + assertCanRead |
| `student_comments:view_all` | Every শাখা's comments | সব শাখার মন্তব্য দেখা | Unscoped read | — | on | | isAdminStaff |
| `student_comments:review` | Review before sending | পাঠানোর আগে মন্তব্য পর্যালোচনা | Inbox + badge, edit any undelivered, remove files, discard | — | on | | roster:manage; isAdminStaff (isReviewer) |
| `student_comments:send` | Send to the guardian | অভিভাবকের কাছে পাঠানো | Deliver (seal, wa.me, notification) | — | on | | roster:manage |

#### `parents_meeting` — অভিভাবক সভা
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `parents_meeting:view` | See meetings | অভিভাবক সভা দেখা | Meetings, slots, attendance totals, comment progress, any note screen | — | on | | roster:manage |
| `parents_meeting:create` | Set up a meeting | সভা তৈরি ও সময়সূচি সাজানো | Create, generate slots, reorder, On-Call, breaks | — | on | | roster:manage |
| `parents_meeting:send` | Send the timetable | পরিবারকে সময়সূচি পাঠানো | Dispatch per-family timing notices | — | on | | roster:manage |
| `parents_meeting:mark_attendance` | Mark meeting attendance | সভায় উপস্থিতি দেওয়া | Present/absent + remark per slot | — | on | | roster:manage |
| `parents_meeting:assign` | Run comment collection | মন্তব্য সংগ্রহ চালানো | Open collection, rebuild roster, skip a subject, remind a teacher | — | on | | roster:manage |
| `parents_meeting:review` | Write the final comment | চূড়ান্ত মন্তব্য লেখা | Final word per child; final queue | — | on | | roster:manage |
| `parents_meeting:write_notes` | Write my meeting notes | সভার মন্তব্য লেখা (শিক্ষক) | Subject note; শ্রেণি শিক্ষক summary; Today cards | on | — | DESIGNATION:row_teacher/class_teacher | tracker:write |
| `parents_meeting:view_brief` | Brief & comparison | সভার সারসংক্ষেপ ও তুলনা দেখা | Per-child brief + PDF, timeline, comparison | on | on | DESIGNATION:class_teacher (brief; waived by `parents_meeting:view`), F-13 | roster:manage OR class teacher; repsScope |
| `parents_meeting:approve_change` | Approve a time change | সময় পরিবর্তনের অনুরোধ অনুমোদন | Approve (swap two families) or decline a guardian's slot-change request (D-#842) | — | — | PRINCIPAL-DEFAULT | new (D-#842) |

#### `monthly_report` — মাসিক অগ্রগতি রিপোর্ট
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `monthly_report:view` | See monthly reports | মাসিক রিপোর্ট দেখা | A শাখা's reports and PDF in scope (narrowed to own subjects) | on | on | | authenticated + assertReportRead (tracker:read + scope; isAdminStaff) |
| `monthly_report:view_all` | Whole school's month | সব শাখার মাসিক অবস্থা দেখা | Any শাখা; roll-ups; pending work; chase messages; fee block | — | on | | isAdminStaff; assertRelease (report:release ∧ isAdminStaff) |
| `monthly_report:create` | Build reports & drafts | রিপোর্ট তৈরি ও খসড়া মন্তব্য | Compute a শাখা's month; draft the guardian paragraph | — | on | | assertRelease |
| `monthly_report:export` | Export / import comment work | মন্তব্যের ফাইল নামানো ও ফেরত দেওয়া | Comment-writing file; paste the envelope back | — | on | F-22 | assertRelease; primary-role P/O on the export route |
| `monthly_report:review` | Approve the paragraph | মন্তব্য অনুমোদন | Accept or edit the guardian paragraph | on | on | DESIGNATION:class_teacher/whole_section_supervisor | assertStaffReportRead + full view |
| `monthly_report:release` | Release to the family | পরিবারের কাছে প্রকাশ | Release one or a batch | — | on | | assertRelease |
| `monthly_report:override` | Override a block | বাধা উপেক্ষা করে প্রকাশ | Release a coverage-blocked or hard-locked report with a reason | — | — | PRINCIPAL-DEFAULT | primary role PRINCIPAL (D-#397) |
| `monthly_report:revoke` | Withdraw a released report | প্রকাশিত রিপোর্ট প্রত্যাহার | Revoke one report or a bulk batch | — | — | PRINCIPAL-DEFAULT | assertPrincipal |
| `monthly_report:settings` | Report thresholds | রিপোর্টের সীমা ও নিয়ম | Change thresholds, coverage gate, calendar, fee/class-best display | — | — | PRINCIPAL-DEFAULT | assertPrincipal (read stays with view_all) |

#### `improvement_plan` — শিক্ষার্থীর অগ্রগতি ও উন্নতির কাজ
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `improvement_plan:view_all` | Progress board | শিক্ষার্থীর অগ্রগতি বোর্ড দেখা | School tiles, শাখা board, one শিক্ষার্থী, actions, day tasks, a leave's tasks | — | on | | roster:manage |
| `improvement_plan:create` | Start an action | নতুন উন্নতির কাজ শুরু | Create for a শিক্ষার্থী or a শাখা; prefill | — | on | | roster:manage |
| `improvement_plan:edit` | Stop or extend | উন্নতির কাজ বন্ধ / বাড়ানো | Stop with a reason; extend | — | on | | roster:manage |
| `improvement_plan:assign` | Assign a day's task | দিনের কাজ বরাদ্দ | Who does the teacher task on a leave day | — | on | | roster:manage |
| `improvement_plan:edit_all` | Mark for a teacher | শিক্ষকের পক্ষে চিহ্ন দেওয়া | Tick/untick a teacher task for a past day with a reason | — | on | | roster:manage (`isAdmin`) |
| `improvement_plan:tick` | Tick my task | নিজের কাজ সম্পন্ন চিহ্নিত | Own/cover task today; own tasks list | on | on | SELF (+ responsible-today designation) | tracker:write OR roster:manage + responsible |

### Attendance & routine

#### `attendance` — শিক্ষার্থীর উপস্থিতি
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `attendance:mark` | Take উপস্থিতি | উপস্থিতি নেওয়া (দায়িত্ব পেলে) | Mark today's absentees for a unit you mark today | on | — | DESIGNATION:marker_of_the_day | attendance:mark + assertMayMarkUnit |
| `attendance:view` | My শাখা's উপস্থিতি | নিজের শাখার উপস্থিতি দেখা | Day, absentees, history, without-leave, leave list, own brief | on | on | DESIGNATION:class_teacher | authenticated + assertSectionReportAccess; attendance:manage |
| `attendance:view_all` | Whole-school উপস্থিতি | সব শাখার উপস্থিতি ও প্রতিবেদন দেখা | Absentee report, unmarked, rankings, class presence | — | on | | attendance:manage |
| `attendance:edit` | Fix a past day | আগের দিনের উপস্থিতি সংশোধন | Mark/amend any unit on any date | — | on | | attendance:manage |
| `attendance:assign` | Assign উপস্থিতি duty | উপস্থিতির দায়িত্ব বরাদ্দ | Override the marker for a date range; revoke | — | on | | attendance:manage |
| `attendance:record_leave` | Record a শিক্ষার্থী's leave | শিক্ষার্থীর ছুটির আবেদন লেখা | Record on the guardian's behalf | — | on | | attendance:manage |
| `attendance:remind` | Remind guardian | অনুপস্থিতির জন্য অভিভাবককে রিমাইন্ডার | wa.me chase link | — | on | | attendance:manage |

#### `staff_attendance` — শিক্ষক-কর্মীর উপস্থিতি
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `staff_attendance:upload` | Upload the Excel | শিক্ষক-কর্মীদের উপস্থিতির এক্সেল আপলোড | Preview and commit; past uploads | — | on | | attendance:manage |
| `staff_attendance:view_all` | All staff উপস্থিতি | সব শিক্ষক-কর্মীর উপস্থিতি দেখা | Day roster, summary, ranking; staff hub tab + lateness preview | — | on | | attendance:manage |
| `staff_attendance:view_own` | My উপস্থিতি | আমার উপস্থিতি | Own biometric days | on | on | SELF | authenticated, own row |

#### `routine` — রুটিন ও ক্যালেন্ডার
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `routine:view` | See the routine | রুটিন দেখা | Routines, groups, rooms, grids, holidays, covers, bell, own load, free/busy | on | on | F-20 | routine:read |
| `routine:view_all` | Board, master grid, all loads | আজকের ক্লাস বোর্ড, সম্পূর্ণ গ্রিড ও সব শিক্ষকের লোড দেখা | Live board, master grid, every teacher's load | — | on | | routine:manage; isAdminStaff (load) |
| `routine:edit` | Build the routine | রুটিন তৈরি ও পরিবর্তন | Create/update/retire slots; reassign a subject's routine teacher | — | on | | routine:manage |
| `routine:edit_calendar` | Holidays & windows | ছুটির দিন ও সময়সূচি ঠিক করা | Holiday exceptions; schedule windows | — | on | | routine:manage |
| `routine:settings` | Rooms, periods, groups, bell | রুম, পিরিয়ড, গ্রুপ ও ঘণ্টার দায়িত্ব ঠিক করা | Rooms, period grids, subject groups and members, bell duty | — | on | | routine:manage |

#### `cover` — বদলি ক্লাস
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `cover:view_all` | Uncovered classes | কভার লাগবে এমন ক্লাস দেখা | Needs-cover inbox; any leave's cover slots | — | on | | leave:manage |
| `cover:approve` | Approve leave cover | বদলি শিক্ষক ঠিক করা | Approve/reject/direct-assign leave cover (mints a 1-day proxy); propose on another's leave | — | on | | leave:manage |
| `cover:assign` | Assign a slot cover | কভার শিক্ষক বরাদ্দ | Assign or cancel a routine slot cover | — | on | | routine:manage |
| `cover:assign_proxy` | Grant a proxy (cover) scope | বদলি শিক্ষককে (প্রক্সি) দায়িত্ব দেওয়া | Assign/extend/revoke a proxy write ScopeGrant; list them | — | — | ESCALATION | user:manage |
| `cover:propose` | Propose my cover | নিজের ছুটিতে বদলি প্রস্তাব | Propose a cover teacher on own leave; own leave's slots | on | on | SELF | authenticated, own leave |

### Staff & HR

#### `staff_records` — কর্মীর তথ্য
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `staff_records:view` | See staff records | কর্মীদের তথ্য দেখা | Staff list and hub profile (without NID, bank and salary) | — | on | | staff:manage |
| `staff_records:view_sensitive` | See NID and bank details | কর্মীর এনআইডি ও ব্যাংকের তথ্য দেখা | NID and bank-account fields on the staff record (field gate) | — | on | | staff:manage (owner 2026-10-20, Q6) |
| `staff_records:create` | Add staff | নতুন কর্মী যোগ করা | Create a record (pay excluded) | — | on | | staff:manage |
| `staff_records:edit` | Edit a record | কর্মীর তথ্য সংশোধন | Bio, contact, bank account | — | on | F-23 | staff:manage |
| `staff_records:confirm` | Confirm employment | চাকরি স্থায়ী করা | Confirm a probationer; settle held leave debt; preview | — | on | | staff:manage |

#### `hr_policy` — এইচআর নিয়মকানুন
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `hr_policy:view` | View HR policy | নিয়মকানুন দেখা | Leave pool, probation, lateness rule, signatory, school bank | — | on | | payroll:manage |
| `hr_policy:settings` | Edit HR policy | নিয়মকানুন বদলানো | Change those switches | — | on | | payroll:manage |

#### `leave` — কর্মীর ছুটি
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `leave:view_all` | Everyone's leave | সবার ছুটি দেখা | Lists, balances, pool, probation debt | — | on | | leave:manage |
| `leave:approve` | Approve / reject leave | ছুটি মঞ্জুর বা নামঞ্জুর করা | Decide; cancel another person's leave; pending badge | — | on | | leave:manage |
| `leave:create` | Record leave for someone | অন্যের হয়ে ছুটি লেখা | Apply on another staff member's behalf | — | on | | leave:manage |
| `leave:settings` | Leave allowance | ছুটির বরাদ্দ ঠিক করা | Per-year entitlement and carry-over | — | on | | leave:manage |
| `leave:apply` | Apply for my leave | নিজের ছুটির আবেদন | Apply, cancel own, own leave and balances | on | on | SELF | authenticated, own StaffProfile |

#### `appraisal` — কাজের মূল্যায়ন ও প্রশিক্ষণ
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `appraisal:view_all` | View appraisals | সবার মূল্যায়ন দেখা | Everyone's observations, appraisals, CPD log | — | on | | performance:manage |
| `appraisal:observe` | Observe any staff | যেকোনো শিক্ষকের কাজ পর্যবেক্ষণ লেখা | Submit an observation on anyone (supervisor scope path stays) | — | on | | performance:manage |
| `appraisal:prepare` | Prepare appraisal | মূল্যায়ন তৈরি করা | Draft goals and needs | — | on | | performance:manage |
| `appraisal:sign_off` | Sign off appraisal | মূল্যায়নে চূড়ান্ত সই | Set outcome and lock | — | — | LOCKED | performance:signoff |
| `appraisal:log_cpd` | Log training | প্রশিক্ষণের তথ্য লেখা | Add a CPD entry | — | on | | performance:manage |
| `appraisal:view_own` | My appraisals | আমার মূল্যায়ন | Own appraisals, CPD, observations I wrote | on | on | SELF | authenticated, own |

#### `conduct` — শৃঙ্খলা
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `conduct:view_all` | Conduct records | শৃঙ্খলার রেকর্ড দেখা | Anyone's conduct ladder (confidential) | — | on | | performance:manage |
| `conduct:create` | Raise a step | সতর্কতার ধাপ লেখা | Draft a verbal/written/final/termination step | — | on | | performance:manage |
| `conduct:record_hearing` | Record hearing | শুনানির কথা লেখা | The person's response before finalising | — | on | | performance:manage |
| `conduct:sign_off` | Finalise a step | শৃঙ্খলার সিদ্ধান্ত চূড়ান্ত করা | Finalise; termination sets employmentStatus | — | — | LOCKED | performance:signoff |
| `conduct:view_own` | My conduct records | আমার শৃঙ্খলার রেকর্ড | Own records | on | on | SELF | authenticated, own |

#### `grievance` — অভিযোগ
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `grievance:view_all` | Grievance inbox | সব অভিযোগ দেখা | The inbox | — | on | | performance:manage |
| `grievance:resolve` | Handle a grievance | অভিযোগের ব্যবস্থা নেওয়া | Under review / resolved / closed with a note | — | on | | performance:manage |
| `grievance:raise` | Raise a grievance | অভিযোগ জানানো | Raise one, read own (never revocable) | on | on | SELF | authenticated, own |

#### `staff_letters` — চিঠি ও চুক্তিপত্র
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `staff_letters:view` | View / print letters | চিঠি দেখা ও ছাপানো | Letter list, count, PDF | — | on | | staff:manage |
| `staff_letters:issue` | Issue a letter | চিঠি দেওয়া | Appointment, confirmation, certificate, support contract | — | on | | staff:manage |
| `staff_letters:void` | Void a letter | চিঠি বাতিল করা | Mark VOID (kept) | — | on | | staff:manage |

#### `offboarding` — চাকরি ছাড়া
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `offboarding:view` | View exit cases | চাকরি ছাড়ার ফাইল দেখা | Cases, one case, per-staff history | — | on | | staff:manage |
| `offboarding:create` | Start exit | চাকরি ছাড়ার প্রক্রিয়া শুরু | Open a case | — | on | | staff:manage |
| `offboarding:edit` | Work the clearance | ছাড়পত্র ও বিদায় সাক্ষাৎকার | Clearance items, exit interview | — | on | | staff:manage |
| `offboarding:revoke` | Disable login | লগইন বন্ধ করা | Disable the login and revoke all ScopeGrants | — | on | | staff:manage |
| `offboarding:issue` | Experience certificate | অভিজ্ঞতা সনদ দেওয়া | Service certificate | — | on | | staff:manage |
| `offboarding:cancel` | Withdraw exit | প্রক্রিয়া বাতিল | Cancel before access is revoked | — | on | | staff:manage |
| `offboarding:prepare` | Compute final dues | শেষ পাওনা হিসাব করা | Held final settlement | — | on | | payroll:manage |
| `offboarding:settle` | Release final dues | শেষ পাওনা ছাড় করা | Release after clearance; commits advance recovery | — | — | LOCKED | payroll:approve |

#### `classroom_observation` — ক্লাসরুম পর্যবেক্ষণ
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `classroom_observation:view` | My observations | নিজের পর্যবেক্ষণ দেখা | As observer or observed (after publish); trend; respond and rate | on | on | | observation:read |
| `classroom_observation:view_all` | All observations | সব পর্যবেক্ষণ দেখা | Oversight list, any teacher's rows/trend/footage, compare | — | on | | isAdminStaff; observation:upload (lists) |
| `classroom_observation:upload` | Upload a class video | ক্লাসের ভিডিও আপলোড | Upload a session; link footage | — | on | | observation:upload |
| `classroom_observation:assign` | Assign an observer | পর্যবেক্ষক বরাদ্দ | Assign/reassign, re-review, co-review, cancel/restore | — | on | | observation:upload; observation:manage |
| `classroom_observation:review` | Review as observer | পর্যবেক্ষক হিসেবে রিভিউ | Score + comment, reject an unusable video, queue, history | on | — | DESIGNATION:assigned_observer | observation:review |
| `classroom_observation:edit` | Edit a review | প্রকাশের আগে রিভিউ সংশোধন | Change before publishing | — | on | | observation:manage |
| `classroom_observation:publish` | Publish / withhold | শিক্ষকের কাছে প্রকাশ / স্থগিত | Publish, withhold, lift the hold; toPublish badge | — | on | F-21 | observation:manage |
| `classroom_observation:schedule` | Due list & review rota | রিভিউ-প্রয়োজন তালিকা ও রুটিন | Due list; generate/save/read the rota | — | on | | observation:manage |
| `classroom_observation:view_reports` | Reviewer effectiveness | রিভিউয়ার কার্যকারিতা ও স্কুলের প্রবণতা | Effectiveness, school patterns, fairness/usefulness ratings | — | on | | observation:manage; primary role P/O (rating fields) |
| `classroom_observation:settings` | Observation settings | পর্যবেক্ষণ সেটিংস | Escalation and scheduler cadence | — | on | | observation:manage |
| `classroom_observation:set_quota` | Observer daily target | পর্যবেক্ষকের দৈনিক লক্ষ্য ঠিক করা | Set/change/switch off a review quota | — | — | PRINCIPAL-DEFAULT | `role === "PRINCIPAL"` |

#### `free_mixing_review` — ফ্রি মিক্সিং পর্যবেক্ষণ
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `free_mixing_review:assign` | Log & assign a video | ভিডিও যোগ ও রিভিউয়ার বরাদ্দ | Log a class link, assign a reviewer | — | on | | observation:upload |
| `free_mixing_review:review` | Review an assigned video | বরাদ্দ ভিডিও রিভিউ | My videos; OK / not-OK with a comment | on | — | DESIGNATION:assigned_reviewer | observation:review |
| `free_mixing_review:view_all` | Video board | সব ভিডিও রিভিউ দেখা | Every review with per-teacher counts | — | on | | observation:manage |

### Finance

#### `payroll` — বেতন
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `payroll:view` | View payroll | বেতনের হিসাব দেখা | Runs, payslips, pay history, lateness charge | — | on | | payroll:manage |
| `payroll:edit` | Set salary | বেতন ঠিক করা | Monthly salary and payment method | — | on | | payroll:manage |
| `payroll:prepare` | Prepare payroll | মাসের বেতন তৈরি করা | Compute/recompute, cancel a prepared run | — | on | | payroll:manage |
| `payroll:approve` | Approve & lock payroll | বেতন অনুমোদন ও লক করা | Lock a run; commit advance recovery | — | — | LOCKED | payroll:approve |
| `payroll:export` | Payment files | ব্যাংক অ্যাডভাইস ও ফাইল নামানো | Advice pack, CSV, register XLSX | — | on | | payroll:manage |
| `payroll:view_own` | My payslips | আমার বেতনের স্লিপ | Own payslips (locked runs) | on | on | SELF | authenticated, own |

#### `salary_advance` — অগ্রিম বেতন
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `salary_advance:view` | View advances | অগ্রিম দেখা | A staff member's advances | — | on | | payroll:manage |
| `salary_advance:issue` | Give an advance | অগ্রিম দেওয়া | Issue an advance or loan | — | — | LOCKED | payroll:approve |
| `salary_advance:settle` | Settle / write off | অগ্রিম মিটিয়ে দেওয়া বা মাফ করা | Early payoff or write-off | — | — | LOCKED | payroll:approve |

#### `finance_ledger` — হিসাবের খাতা
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `finance_ledger:view` | Daily books | দৈনিক হিসাব দেখা | Snapshot, month-to-date, balances, fee history, net-pay aggregate | — | on | | finance:manage |
| `finance_ledger:create` | Record income / expense | আয়-ব্যয় লেখা | Append a posting | — | on | | finance:manage |
| `finance_ledger:reverse` | Reverse an entry | ভুল এন্ট্রি উল্টানো | Append a negating posting | — | on | | finance:manage |
| `finance_ledger:settings` | Opening balance | শুরুর ব্যালান্স ঠিক করা | Effective-dated opening per ledger | — | on | | finance:manage |
| `finance_ledger:remind` | Fee-due reminder | বকেয়া ফির রিমাইন্ডার | wa.me + push to the guardian | — | on | | finance:manage |

#### `finance_reports`, `budget`, `fee_support`, `qard`, `reconciliation`
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `finance_reports:view` | Finance reports | আয়-ব্যয়ের রিপোর্ট দেখা | Monthly report, year KPIs, YTD statement, trends | — | on | | finance:manage |
| `budget:view` | View budget | বাজেট দেখা | Lines, budget vs actual, surplus/deficit | — | on | | finance:manage |
| `budget:edit` | Set budget | বাজেট ঠিক করা | Upsert a year × head line | — | on | | finance:manage |
| `fee_support:view` | View fee support | সহায়তার হিসাব দেখা | Providers; provider statement | — | on | | finance:manage |
| `fee_support:edit` | Providers & allocations | দাতা ও সহায়তা ঠিক করা | Create a provider; set a শিক্ষার্থী's allocation | — | on | | finance:manage |
| `fee_support:create` | Record provider payment | দাতার টাকা জমা লেখা | Record a receipt | — | on | | finance:manage |
| `qard:view` | Qard register | কর্জের হিসাব দেখা | Parties, outstanding, overdue, entries | — | on | | finance:manage |
| `qard:create` | Record qard movement | কর্জ দেওয়া বা ফেরত লেখা | Disbursement, repayment, adjustment | — | on | | finance:manage |
| `qard:edit` | Add counterparty | কর্জগ্রহীতা যোগ করা | Create or set a party | — | on | | finance:manage |
| `reconciliation:view` | View reconciliations | মেলানোর ইতিহাস দেখা | Latest, history, unreconciled days | — | on | | finance:manage |
| `reconciliation:create` | Reconcile with bank | ব্যাংকের সাথে হিসাব মেলানো | Record a reconciliation | — | on | | finance:manage |

### Content & books

#### `lesson_plans`, `plan_review`
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `lesson_plans:view` | View lesson plans | পাঠ পরিকল্পনা দেখা | Plan tree, a plan, its PDF | on | — | | content:read |
| `lesson_plans:view_all` | Every plan | সব পাঠ পরিকল্পনা দেখা | Plans beyond own routine/supervisory scope | — | on | †, 2H, F-27 | contentScope primary-role P/O = all |
| `lesson_plans:import` | Import lesson plans | পাঠ পরিকল্পনা ইম্পোর্ট করা | Upload a plan pair or envelope | — | on | | content:import |
| `plan_review:assign` | Assign plan reviewers | রিভিউয়ার বরাদ্দ করা | Assign/move/cancel rounds; board, inbox, load; any thread | — | on | F-26 | content:assign_review; isAdminStaff (thread) |
| `plan_review:review` | Review plans | পরিকল্পনা রিভিউ করা | Verdict on an assigned plan | on | — | DESIGNATION:assigned_reviewer | content:review |
| `plan_review:approve` | Sign off plans (gold) | চূড়ান্ত অনুমোদন (গোল্ড) দেওয়া | Promote to gold, single or bulk | — | — | | content:promote_gold |

#### `question_bank`, `question_review`
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `question_bank:view` | View question bank | প্রশ্নব্যাংক দেখা | Published questions, stimuli, filters | on | on | | question:read |
| `question_bank:view_all` | Unpublished questions | অপ্রকাশিত প্রশ্নসহ সব দেখা | Draft and reviewed questions | — | on | | isAdminStaff (publishGate) |
| `question_bank:import` | Import question bank | প্রশ্নব্যাংক ইম্পোর্ট করা | Upload a Project-04 collection | — | on | | content:import |
| `question_bank:edit` | Correct questions | প্রশ্ন ও উত্তর সংশোধন করা | Text, answer, marks; IMPORTANT on any question | — | on | | question:manage |
| `question_bank:delete` | Retire / restore | প্রশ্ন বাদ দেওয়া ও ফেরত আনা | Soft-delete, restore, retired view | — | on | | question:manage |
| `question_review:assign` | Assign question reviewers | প্রশ্ন রিভিউ বরাদ্দ করা | Assign by question/chapter, move, clear a condition, picker | — | on | | content:assign_review |
| `question_review:view_all` | Review progress | রিভিউয়ের অগ্রগতি দেখা | Inbox, progress, drill-downs, coverage, slices, any thread | — | on | | content:assign_review; isAdminStaff (thread) |
| `question_review:review` | Review questions | প্রশ্ন রিভিউ করা | Verdict (single/bulk); IMPORTANT on own rounds | on | — | DESIGNATION:assigned_reviewer | content:review |
| `question_review:publish` | Publish questions | প্রশ্ন প্রকাশ করা | Gold: single with override, bulk, publish-all | — | — | | content:promote_gold |

#### `book_production` — বই তৈরি
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `book_production:view` | View books | বই দেখা | Books, lessons, content, slots, rationale, rounds, comments, builds, files | — | — | | book:read |
| `book_production:create` | Create a book | নতুন বই খোলা | Create a book (either line) | — | — | | book:manage |
| `book_production:settings` | Upload policy | নীতিমালা আপলোড করা | Activate a governance document version | — | — | | book:manage |
| `book_production:assign` | Assign book reviewer | বই রিভিউয়ার বরাদ্দ করা | Open a review round on a lesson | — | — | | book:manage |
| `book_production:author` | Submit content | বইয়ের লেখা জমা দেওয়া | Upload a patch; resolve own comment fixes | — | — | | book:author |
| `book_production:illustrate` | Upload artwork | বইয়ের ছবি আপলোড করা | Slot images | — | — | | book:illustrate |
| `book_production:review` | Review a book | বই রিভিউ করা | Verdict, comment, raise/reply escalation | — | — | | book:review |
| `book_production:approve` | Senior review & sign-off | সিনিয়র রিভিউ ও চূড়ান্ত সাইন-অফ | Rule on an escalation; sign off a lesson | — | — | | book:review_senior |
| `book_production:assemble` | Build and release | বই বিল্ড ও সংস্করণ প্রকাশ | Queue a render, export book.json, file an edition | — | — | | book:assemble |
| `book_production:override` | Force a build | গেট উপেক্ষা করে বিল্ড | `force` past the assembly gate | — | — | PRINCIPAL-DEFAULT | `role === "PRINCIPAL"` (D-#424) |

#### `teaching_notes`, `english_drive`, `worksheets`
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `teaching_notes:view` | Notes for my classes | আমার শ্রেণির নোট পড়া | Library for taught pairs, versions, thread, comment | on | on | | authenticated + role TEACHER scope; isAdminStaff |
| `teaching_notes:view_all` | Every note | সব নোট পড়া | Every class × subject | — | on | | isAdminStaff |
| `teaching_notes:upload` | Upload a note | নোট আপলোড | Upload/replace a version | — | on | | roster:manage |
| `teaching_notes:send` | Send to print | নোট প্রিন্টে পাঠানো | File a readable note to the print queue | on | on | | authenticated + read gate |
| `teaching_notes:review` | Manage feedback | নোটের মন্তব্য সামলানো | Open list, address/reopen, delete any comment | — | on | | roster:manage |
| `english_drive:view` | My English classes' drive | আমার শ্রেণির ইংরেজি ড্রাইভ দেখা | Docs for my English classes; PDF | on | on | | authenticated + role TEACHER scope; isAdminStaff |
| `english_drive:view_all` | Whole drive | পুরো ইংরেজি ড্রাইভ দেখা | All five class levels | — | on | | isAdminStaff |
| `english_drive:upload` | Upload a document | ডকুমেন্ট আপলোড | Upload/replace | — | on | | roster:manage |
| `english_drive:send` | Edit & send to print | এডিট করে প্রিন্টে পাঠানো | Edit-before-print render; file to queue | on | on | F-14 | authenticated + read gate |
| `worksheets:create` | Make a worksheet | প্রশ্ন / অ্যাসাইনমেন্ট তৈরি | Plan, preview, PDF, picture bank, my worksheets | on | on | F-15 | tracker:write OR roster:manage |
| `worksheets:send` | Send to print | প্রিন্টে পাঠানো | Regenerate from the seed; file to queue | on | on | | tracker:write OR roster:manage |
| `worksheets:edit_all` | Make one for a teacher | শিক্ষকের পক্ষে তৈরি | Pick a routine teacher; open any stored paper | — | on | | roster:manage (isManager) |
| `worksheets:edit` | Edit the picture bank | ছবির ভাণ্ডার সম্পাদনা | Tag, reserve, hide pictures; see hidden | — | on | | roster:manage |
| `worksheets:settings` | Worksheet plan | প্রশ্ন-পরিকল্পনা | Save generation plan and presets | — | on | | roster:manage |

#### `class_books` — শ্রেণির বই (D-#870, docs/prd-class-books.md)
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `class_books:view` | Read class books | শ্রেণির বই পড়া | Every class's books, page by page (view only, no download) | on | on | | new |
| `class_books:manage` | Upload and manage class books | শ্রেণির বই আপলোড ও সম্পাদনা | Upload a book PDF (turned into page images), rename, move class, hide, delete | — | on | | new |

Guardians read the books of their own children's classes through `guardian:read_child` (the GUARDIAN plane), not through these switches.

### Communication

#### `chat` — বার্তা
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `chat:view` | Read messages | বার্তা পড়া | Own conversations, messages, mute, mark seen | on | on | | chat:read (markSeen was chat:write) |
| `chat:send` | Send messages | বার্তা পাঠানো | Open 1:1, send, forward, react, edit/delete own, attach | on | on | | chat:write |
| `chat:create` | Create a group | নতুন গ্রুপ খোলা | Create a group conversation | — | on | | chat:manage |
| `chat:edit` | Manage groups | গ্রুপের সদস্য ও নিয়ম ঠিক করা | Members, posting policy, archive, resync | — | on | | chat:manage |
| `chat:publish` | Post in announcement groups | ঘোষণা-গ্রুপে লেখা | Bypass the ANNOUNCEMENT posting lock | — | on | | chat:manage (canManage) |
| `chat:send_notice` | Notice to my শাখা's guardians | নিজের শাখার অভিভাবকদের নোটিশ পাঠানো | SECTION notice for a শাখা you class-teach | on | on | DESIGNATION:class_teacher (waived by `chat:send_notice_all`) | chat:write + assertIsClassTeacher |
| `chat:send_notice_all` | School-wide notice | পুরো স্কুল বা যেকোনো শাখায় নোটিশ | SCHOOL scope; any শাখা | — | on | | chat:manage |
| `chat:view_all` | Oversee all conversations | সব কথোপকথনের তত্ত্বাবধান | Read any conversation incl. 1:1; audited open | — | — | LOCKED | chat:oversee |

#### `popup_notice` — পপ-আপ বার্তা (D-#852..#858, docs/prd-popup-notice.md)
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `popup_notice:view` | See pop-up notices | পপ-আপ বার্তা ও রিপোর্ট দেখা | List, report, who saw / read / answered, audience preview, people search, saved lists | — | on | | new (D-#857) |
| `popup_notice:send_staff` | Send pop-ups to staff | কর্মীদের পপ-আপ পাঠানো | Compose, edit, send, withdraw, copy, test a notice whose audience includes staff; save staff lists | — | on | | new |
| `popup_notice:send_guardian` | Send pop-ups to guardians | অভিভাবকদের পপ-আপ পাঠানো | Same, for a notice whose audience includes guardians; save family lists | — | on | | new |
| `popup_notice:follow_up` | Follow up a pop-up | বাকিদের আবার দেখানো ও নতুন প্রাপক যোগ | Show again to everyone not done; add people who match the audience now | — | on | | new |

#### `message_templates`, `notifications`
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `message_templates:view` | See templates | বার্তার টেমপ্লেট দেখা | List, read, history | — | — | LOCKED | template:manage |
| `message_templates:edit` | Edit / reset template | টেমপ্লেট সম্পাদনা ও আগের অবস্থায় ফেরানো | Save an override; reset | — | — | LOCKED | template:manage |
| `notifications:view` | My notifications | আমার নোটিফিকেশন | Inbox, mark read, web push, push devices | on | on | SELF | authenticated, own rows |

### School operations

#### `library` — লাইব্রেরি
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `library:view` | Browse & my loans | বই খোঁজা, নিজের ধার করা বই ও সংরক্ষণ দেখা | Catalog, policies, librarians, own loans/reservations, self-reserve | on | on | | library:read |
| `library:lend` | Issue / renew (desk) | বই ধার দেওয়া ও নবায়ন (ডেস্ক) | Issue, renew, reserve for others, borrower search, desk lists | on | on | DESIGNATION:librarian | library:manage OR assertIsLibrarian |
| `library:return` | Take returns / mark lost | বই ফেরত নেওয়া / হারানো হিসেবে লেখা | Return a loan; settle as lost | on | on | DESIGNATION:librarian | library:manage OR assertIsLibrarian |
| `library:remind` | Remind overdue borrowers | বই ফেরতের রিমাইন্ডার পাঠানো | Overdue chase list with wa.me | on | on | DESIGNATION:librarian | library:read + assertIsLibrarian |
| `library:edit_all` | Run the desk without a duty | লাইব্রেরিয়ানের দায়িত্ব ছাড়াই ডেস্ক চালানো | Waives the librarian designation for lend/return/remind | — | on | | library:manage branch of assertIsLibrarian |
| `library:edit` | Manage the catalog | ক্যাটালগে বই যোগ ও সংশোধন | Titles, copies, copy status | — | on | | library:manage |
| `library:settings` | Loan rules | ধারের নিয়ম ঠিক করা | Loan days, limits, renewals, hold days | — | on | | library:manage |
| `library:assign` | Assign librarian duty | লাইব্রেরিয়ানের দায়িত্ব বরাদ্দ | Give or revoke desk duty | — | on | | library:manage |

#### `printing` — প্রিন্ট
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `printing:create` | Request printing | প্রিন্টের অনুরোধ করা | File, reprint, tag, cancel own requests; own history | on | — | | tracker:write |
| `printing:view_all` | Print queue | সব প্রিন্টের তালিকা দেখা | Queue, badge counts, everyone's history, any request; class-test print queue | — | on | | roster:manage |
| `printing:process` | Print & deliver | প্রিন্ট ও বিতরণ সম্পন্ন করা | Mark printed/delivered; cancel/tag/reprint any job; class-test printed/cancel | — | on | | roster:manage (incl. class_test print) |

#### `archive` — খাতার আর্কাইভ
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `archive:view` | Find scripts | খাতা কোথায় আছে দেখা | Boxes, bundles, lookup, checkouts, acks, cover PDF, photos | on | on | | isAdminStaff OR tracker:read |
| `archive:create` | File scripts | খাতা জমা (ফাইল) করা | Record N scripts of test X in box Y; photos (desk path follows `approve`) | on | on | | tracker:write OR roster:manage |
| `archive:approve` | Acknowledge filing | জমা খাতা গ্রহণ নিশ্চিত করা | Office ack; any-test filing with auto-ack | — | on | | roster:manage |
| `archive:lend` | Lend / take back | খাতা ধার দেওয়া ও ফেরত নেওয়া | Check a bundle out to staff; check it in | — | on | | roster:manage |
| `archive:void` | Cancel a wrong filing | ভুল জমা বাতিল করা | Void (record kept) | — | on | | roster:manage |
| `archive:delete` | Dispose after retention | মেয়াদ শেষে খাতা নষ্ট করা | Retention list; dispose | — | on | | roster:manage |
| `archive:settings` | Storage boxes | বাক্স যোগ / সংশোধন / বন্ধ করা | Register, edit, retire boxes | — | on | | roster:manage |

#### `work_board`, `admin_dashboard`
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `work_board:view_all` | Others' boards | সবার কাজের বোর্ড দেখা | Anyone's board, load grid, all templates, any task | — | on | | tasks:assign |
| `work_board:assign` | Assign work to others | অন্যকে কাজ দেওয়া | Tasks/recurring tasks for others; edit/move/cancel/reassign any | — | on | F-6 | tasks:assign |
| `work_board:cover_desk` | Cover the office desk | অফিসের কাজ নিজের বোর্ডে নেওয়া | Pull print or leave-approval cards onto own board | — | on | | role/template P\|O OR tasks:assign (OfficeCoverService) |
| `work_board:use` | My board & tasks | নিজের কাজ | Own board, self-tasks, tasks I assigned | on | on | SELF | authenticated, own |
| `admin_dashboard:view` | Admin Today dashboard | আজকের অ্যাডমিন ড্যাশবোর্ড দেখা | School-wide day-at-a-glance cards | — | on | F-28 | actsAsRole(P\|O) |

#### `classes_sections`, `teaching_assignments`
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `classes_sections:create` | Open a class | নতুন শ্রেণি খোলা | Create a class (+ default শাখা) | — | on | | roster:manage |
| `classes_sections:merge_split` | Merge / split শাখা | শাখা একত্র করা / আলাদা করা | Combine or reverse; active merges | — | on | | roster:manage |
| `classes_sections:settings` | Academic years | শিক্ষাবর্ষ যোগ ও চালু বছর বদলানো | Add a year; set the current year | — | on | | roster:manage |
| `teaching_assignments:assign_class_teacher` | Assign শ্রেণি শিক্ষক | শ্রেণি শিক্ষক ও সহকারী শিক্ষক বরাদ্দ | Set/clear a শাখা's শ্রেণি শিক্ষক; support teachers; history | — | on | | roster:manage |
| `teaching_assignments:assign_homework_checker` | Assign homework confirmers | বাড়ির কাজ চূড়ান্ত করার দায়িত্ব বরাদ্দ | Confirm delegate per শাখা; school-wide supervisor flag | — | on | | roster:manage |
| `teaching_assignments:assign_subject_teacher` | Assign subject teacher | বিষয় শিক্ষক বরাদ্দ | Grant/revoke teaching scope; routine teacher read | — | — | ESCALATION | user:manage |
| `teaching_assignments:assign_supervisor` | Assign oversight | তদারকি (দেখার) দায়িত্ব বরাদ্দ | Grant/revoke supervisory read scope | — | — | ESCALATION | user:manage |

### Reports

#### `reports` — রিপোর্ট
One switch per Reports-hub report (owner 2026-10-25, D-#846). Each shows that ONE report for the WHOLE school, so the Principal can hand a teacher exactly the reports she needs (e.g. Shahida: homework not declared / not issued, assignment not delivered, class note pending, homework not submitted). The shared reconciliation payload returns only the parts the caller was given. A holder of the feature's own whole-school read (`routine:view_all`, `class_test:view_all`, `attendance:view_all`, `class_note:view_all`) keeps that report too.
| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `reports:hw_declare_pending` | Homework declare pending | বাড়ির কাজ ঘোষণা বাকি | Classes/subjects with no homework declared | — | on | | the report's old gate (P/O) |
| `reports:hw_issue_pending` | Homework issue pending | বাড়ির কাজ ইস্যু বাকি | Declared but not confirmed/issued homework | — | on | | the report's old gate (P/O) |
| `reports:hw_lifecycle` | Homework lifecycle report | বাড়ির কাজ লাইফসাইকেল রিপোর্ট | Per-teacher submitted / checked / returned + pending drill | — | on | | the report's old gate (P/O) |
| `reports:hw_weekly_unsubmitted` | Weekly unsubmitted homework | সাপ্তাহিক বাড়ির কাজ জমা-বাকি রিপোর্ট | Weekly unsubmitted list with guardian messages + wa.me | — | on | | the report's old gate (P/O) |
| `reports:as_declare_pending` | Assignment declare pending | অ্যাসাইনমেন্ট ঘোষণা বাকি | Rotation cells with no assignment declared | — | on | | the report's old gate (P/O) |
| `reports:as_deliver_pending` | Assignment deliver pending | অ্যাসাইনমেন্ট ডেলিভারি বাকি | Declared but not delivered/issued | — | on | | the report's old gate (P/O) |
| `reports:as_print_pending` | Assignment print pending | অ্যাসাইনমেন্ট প্রিন্ট বাকি | Waiting for printing (the print desk's `printing:view_all` also reads this part) | — | on | | the report's old gate (P/O) |
| `reports:reconciliation` | Reconciliation report | সমন্বয় রিপোর্ট | Both trackers' misses in one view (every part) | — | on | | the report's old gate (P/O) |
| `reports:assignment_load` | Assignment load | অ্যাসাইনমেন্ট লোড | Planned vs given load | — | on | | assignment:view_reports (roster:manage) |
| `reports:class_note` | Class note submissions | ক্লাস নোট জমা | Who has / has not written today's class notes | — | on | | the report's old gate (P/O) |
| `reports:class_test` | Class-test report | ক্লাস টেস্ট রিপোর্ট | Class-test status, school-wide (no section needed) | — | on | | the report's old gate (P/O) |
| `reports:attendance` | Absentee report | অনুপস্থিতির প্রতিবেদন | Absentees, unmarked sections, absent without application (staff attendance keeps `staff_attendance:view_all`) | — | on | | the report's old gate (P/O) |
| `reports:class_load` | Teacher class load | শিক্ষকের ক্লাস লোড | Every teacher's periods for a month | — | on | | the report's old gate (P/O) |

D-#861 (owner 2026-10-26: "all reports seen from one place, all report permissions given from one place"): the reports that sat in the Admin hub or on a module home joined the hub, one switch each. Admin-hub cards (ranking, guardian claims, guardian usage) left Admin; module reports stay on their module home too, opened there by the module read. In the Reports copy a drill-down into a module work screen (someone's board, cover form, test results, lesson tracker, reviewer rounds, a teaching note) stays read-only (`app/src/lib/hasRoute.ts`); Student progress → one student opens in Reports.

| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `reports:attendance_ranking` | Attendance ranking | উপস্থিতির ক্রম | Student and staff rankings (both registers) | — | on | | attendance:view_all / staff_attendance:view_all (Admin card) |
| `reports:guardian_claims` | Guardian reports — unresolved | অভিভাবকের জানানো — অনিষ্পন্ন | The open-claim queue, no digest designation needed; reminding stays `work_claim:remind` + designation/waiver | — | on | | work_claim:view_all + admin_dashboard:view (Admin card) |
| `reports:workload` | Workload | কাজের চাপ | Every staff member's task load by day (cells open a board only from Work board) | — | on | | work_board:view_all |
| `reports:live_classes` | Today's class board | আজকের ক্লাস বোর্ড | Which class runs where, today | — | on | | routine:view_all |
| `reports:class_test_dashboard` | Class-test dashboard | ক্লাস টেস্ট ড্যাশবোর্ড | Every class test's stage; the chase card still needs `class_test:remind`, script locations `archive:view` | — | on | | class_test:view_all |
| `reports:student_progress` | Student progress | শিক্ষার্থীর অগ্রগতি | School overview, section board, one student (improvement actions stay `improvement_plan:*`) | — | on | | improvement_plan:view_all |
| `reports:revision_dashboard` | Revision dashboard | রিভিশন ড্যাশবোর্ড | Completeness + every revision read in revisionSummary; the chase list stays `saturday_revision:remind` | — | on | | saturday_revision:view_all |
| `reports:review_progress` | Reviewer progress | পর্যালোচনার অগ্রগতি | Question reviewers' progress, coverage, slices | — | on | | question_review:view_all |
| `reports:reviewer_effectiveness` | Reviewer effectiveness | রিভিউয়ার কার্যকারিতা | Classroom-observation reviewer effectiveness | — | on | | classroom_observation:view_reports |
| `reports:teaching_note_comments` | Outstanding suggestions | বাকি পরামর্শ | Open teaching-note suggestions | — | on | | teaching_notes:review |
| `reports:finance_dashboard` | Finance dashboard | অর্থ ড্যাশবোর্ড | Year overview, YTD statement, trends | — | on | | finance_reports:view |
| `reports:daily_snapshot` | Daily snapshot | দৈনিক স্ন্যাপশট | One day's income/expense/cash | — | on | | finance_ledger:view |
| `reports:guardian_engagement` | Guardian engagement | অভিভাবকদের ব্যবহার | Family app usage (names families — Principal by default) | — | — | | guardian_engagement:view (Admin card) |

### Admin & access

| permission | EN | BN | what it allows | T | O | flags | replaces |
|---|---|---|---|---|---|---|---|
| `access_control:edit` | Role & per-person permissions | ভূমিকা ও জনপ্রতি অনুমতি সাজানো | Roles tab, templates, per-user grant/revoke, effective access | — | — | LOCKED | access:manage |
| `access_control:delegate` | Delegated duties | বাড়তি দায়িত্ব (ডেলিগেশন) দেওয়া | Grant/revoke a delegation; list them | — | — | LOCKED | access:manage |
| `view_as:open` | View as another account | অন্যের অ্যাকাউন্ট তার চোখে দেখা | Short-lived borrowed session (never the Principal) | — | — | | user:view_as |
| `staff_logins:view` | See staff logins | কর্মীদের লগইন তালিকা দেখা | All staff accounts; credential candidates | — | — | F-25 | user:manage |
| `staff_logins:create` | Create a staff login | কর্মীর লগইন তৈরি | Provision from a staff record; email account | — | — | ESCALATION, F-3 | user:manage |
| `staff_logins:reset_password` | Reset staff password | কর্মীর পাসওয়ার্ড রিসেট | New password, re-activate, clear lockout | — | — | ESCALATION, F-4 | user:manage |
| `audit_log:view` | Audit log | অডিট লগ দেখা | The school-wide event log | — | — | | audit:read |
| `audit_log:view_activity` | One person's activity | একজনের কাজের ইতিহাস দেখা | A person's timeline | — | — | | audit:read |
| `system_health:view` | System health | সার্ভার ও স্টোরেজের অবস্থা দেখা | Storage, disk, egress, ticker, backups | — | — | | audit:read |
| `guardian_engagement:view` | Guardian app usage | অভিভাবকদের অ্যাপ ব্যবহারের রিপোর্ট দেখা | Logins, views, inbox reads per family | — | — | | audit:read |
| `my_account:view` | My account | আমার অ্যাকাউন্ট | me, my permissions/templates/scopes, my শ্রেণি শিক্ষক শাখা, session refresh, end View-as | on | on | SELF | authenticated, own token |

---

## Guardian plane (not in the editor)
`guardian:read_child` stays the GUARDIAN template's single permission. Every guardian-facing resolver (`child*`, `myChildren`, `submitChildLeaveApplication`, `fileChildWorkClaim`, `recordGuardianView`, `tickChildImprovementTask`, the guardian branches of the PDF/file routes) keeps `guardian:read_child` + `assertGuardianOfStudent`. Each area file lists them under (e) as **GUARDIAN**.

## Public / system (no action)
`staffLogin`, `guardianLogin` (public, throttled); `POST /triggers/*` (scheduler shared secret).

## Not yet built
- `scholarship_practice:release` (SC-5): release an analysis to a guardian. Planned to ride the PRINCIPAL role → PRINCIPAL-DEFAULT when built.
- `announcements:publish`: there is no staff write path. `GuardianAnnouncement` rows are written by script. Add it when a screen exists.
