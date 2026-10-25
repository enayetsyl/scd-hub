// =============================================================================
// PERMISSION CATALOGUE — every feature × every action (PM, D-#790–#801)
// =============================================================================
// THE registry of what a staff member can do, one `feature:action` permission per
// thing a person does on screen. `PERMISSIONS` / `ROLE_PERMISSIONS` in vocab.ts are
// derived from it, the Access-control role editor renders it, and the verifier
// (§C.PM) checks it. A new feature adds ALL its actions here (D-#799) — see
// docs/prd-permission-matrix.md §9 and docs/permission-catalogue/.
//
// Generated once from docs/permission-catalogue/README.md (2026-10-20); from now on
// THIS file is the source and the docs are kept in step with it.
//
// Per action:
//   teacher / office — the TEACHER / OFFICE template default. PRINCIPAL holds every
//                      action implicitly (never listed); GUARDIAN holds none of these.
//   flags            — LOCKED (reserved, Principal-only, never switchable),
//                      PRINCIPAL_DEFAULT (rode the PRINCIPAL role; switchable, default off),
//                      ESCALATION (mints logins/roles/scope; locked off until its target
//                      guard ships), SELF (everyone for themselves; not switchable).
//   designation      — the action means "may do this WHEN designated" (PRD §5.2); a holder
//                      of the feature's view_all/edit_all (or `waiver`) passes without it.

export const FEATURE_GROUPS = ["teaching_and_trackers","assessment_and_exams","students_and_families","attendance_and_routine","staff_and_hr","finance","content_and_books","communication","school_operations","admin_and_access"] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

export const FEATURE_GROUP_LABELS: Record<FeatureGroup, string> = {
  teaching_and_trackers: "Teaching & trackers",
  assessment_and_exams: "Assessment & exams",
  students_and_families: "Students & families",
  attendance_and_routine: "Attendance & routine",
  staff_and_hr: "Staff & HR",
  finance: "Finance",
  content_and_books: "Content & books",
  communication: "Communication",
  school_operations: "School operations",
  admin_and_access: "Admin & access",
};

export type CatalogueFlag = "LOCKED" | "PRINCIPAL_DEFAULT" | "ESCALATION" | "SELF";

export interface CatalogueAction {
  /** English name (the editor's second line). */
  en: string;
  /** Bangla name (the editor's first line; owner vocabulary). */
  bn: string;
  /** One line: what the switch lets the holder do. */
  desc: string;
  teacher: boolean;
  office: boolean;
  flags: readonly CatalogueFlag[];
  designation?: string;
  waiver?: string;
}

export interface CatalogueFeature {
  group: FeatureGroup;
  en: string;
  bn: string;
  actions: Record<string, CatalogueAction>;
}

export const FEATURE_CATALOGUE = {
  homework: {
    group: "teaching_and_trackers",
    en: "Homework",
    bn: "বাড়ির কাজ",
    actions: {
      view: { en: "View homework", bn: "বাড়ির কাজ দেখা", desc: "Workspace, day tally, records, roll-ups, own lifecycle card", teacher: true, office: false, flags: [] },
      view_all: { en: "View every section's homework", bn: "সব শাখার বাড়ির কাজ দেখা", desc: "Any section without a grant; class-wide numbers", teacher: false, office: true, flags: [] },
      declare: { en: "Declare homework", bn: "বাড়ির কাজ ঘোষণা করা", desc: "Declare, fix or delete own item before confirm; question file; \"no homework today\"", teacher: true, office: false, flags: [] },
      issue: { en: "Give to an absent student later", bn: "অনুপস্থিত শিক্ষার্থীকে পরে দেওয়া", desc: "ABSENT_REDELIVER → GIVEN; issue one item outside the day confirm", teacher: true, office: false, flags: [] },
      mark_submitted: { en: "Take submission", bn: "জমা নেওয়া", desc: "Submit pass, mark submitted, chase / re-chase, open collection", teacher: true, office: false, flags: [] },
      check: { en: "Check homework", bn: "বাড়ির কাজ যাচাই করা", desc: "Result, one-tap outcome, checked-answer file", teacher: true, office: false, flags: [] },
      return: { en: "Return checked homework", bn: "খাতা ফেরত দেওয়া", desc: "Return pass (CHECKED/RESUBMIT → RETURNED)", teacher: true, office: false, flags: [] },
      confirm_day: { en: "Confirm the homework day", bn: "দিনের বাড়ির কাজ চূড়ান্ত করা", desc: "Reconcile against 120 min, trim (trim) an item, confirm and issue the day", teacher: true, office: false, flags: [], designation: "class_teacher/homework_confirmer/homework_supervisor" },
      undo: { en: "Undo my own step", bn: "নিজের ধাপ ফিরিয়ে নেওয়া", desc: "Undo own last step, same Dhaka day", teacher: true, office: false, flags: [] },
      undo_any: { en: "Undo anyone's step", bn: "যেকোনো ধাপ ফিরিয়ে নেওয়া", desc: "Undo another teacher's step or an earlier day's", teacher: false, office: true, flags: [] },
      edit_all: { en: "Work in any section", bn: "যেকোনো শাখার বাড়ির কাজে কাজ করা", desc: "Declare/submit/check/return outside own grants", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
      delete: { en: "Delete never-issued homework", bn: "না-দেওয়া বাড়ির কাজ মুছে ফেলা", desc: "List never-issued items school-wide and remove one, even on a closed day", teacher: false, office: true, flags: [] },
      view_reports: { en: "Homework oversight reports", bn: "বাড়ির কাজের রিপোর্ট দেখা", desc: "Per-teacher lifecycle report and pending drill; reconciliation report", teacher: false, office: true, flags: [] },
      remind: { en: "Weekly guardian follow-up", bn: "অভিভাবককে সাপ্তাহিক রিমাইন্ডার", desc: "Weekly unsubmitted list with guardian messages and wa.me links", teacher: false, office: true, flags: [] },
    },
  },
  assignment: {
    group: "teaching_and_trackers",
    en: "Weekly assignment",
    bn: "সাপ্তাহিক অ্যাসাইনমেন্ট",
    actions: {
      view: { en: "View assignments", bn: "অ্যাসাইনমেন্ট দেখা", desc: "Workspace, records, counts, weekly grid, handout board, own cards and prompts", teacher: true, office: false, flags: [] },
      view_all: { en: "View every section's assignments", bn: "সব শাখার অ্যাসাইনমেন্ট দেখা", desc: "Any section without a grant; whole-school summary", teacher: false, office: true, flags: [] },
      declare: { en: "Deliver assignment", bn: "অ্যাসাইনমেন্ট দেওয়া", desc: "Deliver the week's item, fix/delete own draft, \"no assignment this week\"", teacher: true, office: false, flags: [] },
      edit_all: { en: "Work on others' assignments", bn: "অন্যের অ্যাসাইনমেন্ট সংশোধন", desc: "Edit/delete another teacher's cell; act outside own grants", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
      issue: { en: "Give to an absent student later", bn: "অনুপস্থিত শিক্ষার্থীকে পরে দেওয়া", desc: "ABSENT_REDELIVER → GIVEN", teacher: true, office: false, flags: [] },
      mark_submitted: { en: "Take submission", bn: "জমা নেওয়া", desc: "Submit pass, mark submitted, chase", teacher: true, office: false, flags: [] },
      check: { en: "Check assignment", bn: "অ্যাসাইনমেন্ট যাচাই করা", desc: "Result, marks, feedback, one-tap outcome", teacher: true, office: false, flags: [] },
      resubmit: { en: "Ask to redo", bn: "আবার জমা দিতে বলা", desc: "CHECKED → RESUBMIT plus a new record", teacher: true, office: false, flags: [] },
      return: { en: "Return checked assignment", bn: "অ্যাসাইনমেন্ট ফেরত দেওয়া", desc: "Return pass", teacher: true, office: false, flags: [] },
      confirm_week: { en: "Confirm the assignment week", bn: "সপ্তাহের অ্যাসাইনমেন্ট চূড়ান্ত করা", desc: "Reconcile against 360 min, trim (trim) minutes, confirm", teacher: true, office: true, flags: [], designation: "class_teacher", waiver: "assignment:settings" },
      undo: { en: "Undo my own step", bn: "নিজের ধাপ ফিরিয়ে নেওয়া", desc: "Undo own same-day step", teacher: true, office: false, flags: [] },
      undo_any: { en: "Undo anyone's step", bn: "যেকোনো ধাপ ফিরিয়ে নেওয়া", desc: "Admin revert, any actor, any day", teacher: false, office: true, flags: [] },
      remind: { en: "Guardian chase ladder", bn: "অভিভাবককে রিমাইন্ডার", desc: "Chase list, ladder step, outcome, history, bulk sweep", teacher: false, office: true, flags: [] },
      settings: { en: "Rotation schedule", bn: "রোটেশন সূচি ঠিক করা", desc: "Term anchor, cadence, rotation cells; read schedule / grid / handout board", teacher: false, office: true, flags: [] },
      view_reports: { en: "Assignment oversight reports", bn: "অ্যাসাইনমেন্টের রিপোর্ট দেখা", desc: "Planned-vs-given load report; reconciliation report", teacher: false, office: true, flags: [] },
    },
  },
  assignment_gift: {
    group: "teaching_and_trackers",
    en: "Weekly gift",
    bn: "সাপ্তাহিক উপহার",
    actions: {
      view: { en: "View gift report", bn: "উপহারের তালিকা দেখা", desc: "Weekly winners and streaks for a section in scope", teacher: true, office: true, flags: [] },
      view_all: { en: "Whole-school gift report", bn: "সব শাখার উপহারের তালিকা দেখা", desc: "Report with no section", teacher: false, office: true, flags: [] },
      issue: { en: "Mark gift given", bn: "উপহার দেওয়া হয়েছে চিহ্নিত করা", desc: "Tick a handover, undo a mis-tick", teacher: true, office: true, flags: [], designation: "class_teacher" },
    },
  },
  work_claim: {
    group: "teaching_and_trackers",
    en: "Guardian \"done at home\" claims",
    bn: "অভিভাবকের জানানো",
    actions: {
      view_all: { en: "See the claim queue", bn: "সব অভিভাবকের জানানো দেখা", desc: "School-wide unresolved queue; digest recipient list", teacher: true, office: true, flags: [], designation: "digest_recipient", waiver: "admin_dashboard:view" },
      reject: { en: "Reject a claim", bn: "জানানো নাকচ করা", desc: "Close a claim with a reason the family sees", teacher: true, office: false, flags: [] },
      remind: { en: "Remind the teacher", bn: "শিক্ষককে রিমাইন্ডার পাঠানো", desc: "Re-send the teacher's notification, once a day", teacher: true, office: true, flags: [], designation: "digest_recipient", waiver: "admin_dashboard:view" },
      settings: { en: "Choose digest recipients", bn: "দৈনিক সারসংক্ষেপ কারা পাবেন ঠিক করা", desc: "Replace the 10:30 digest's extra recipients", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
      view_own: { en: "My claims", bn: "আমার কাজের জানানো", desc: "Claims on my own work; never refuses (D-#535)", teacher: true, office: true, flags: ["SELF"] },
    },
  },
  set_tracker: {
    group: "teaching_and_trackers",
    en: "Set tracker (legacy)",
    bn: "সেট ট্র্যাকার",
    actions: {
      view: { en: "View tracker sessions", bn: "ট্র্যাকার দেখা", desc: "Session list, a record, summary", teacher: true, office: false, flags: [] },
      view_all: { en: "Any section's sessions", bn: "সব শাখার ট্র্যাকার দেখা", desc: "Read without a grant", teacher: false, office: true, flags: [] },
      enter_results: { en: "Run a tracker session", bn: "ট্র্যাকার চালানো ও এন্ট্রি", desc: "Open, record entries, close", teacher: true, office: false, flags: [] },
      remind: { en: "Build a wa.me nudge", bn: "অভিভাবককে wa.me রিমাইন্ডার", desc: "wa.me link for a non-submitter", teacher: true, office: true, flags: [] },
      edit_all: { en: "Run any section's tracker", bn: "যেকোনো শাখার ট্র্যাকার চালানো", desc: "Act outside own grants", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
    },
  },
  class_note: {
    group: "teaching_and_trackers",
    en: "Class notes",
    bn: "ক্লাস নোট",
    actions: {
      view: { en: "See class notes", bn: "ক্লাস নোট দেখা", desc: "A section's notes (row-scoped), own archive, filters, attachments", teacher: true, office: true, flags: [] },
      create: { en: "Write my class note", bn: "নিজের ক্লাসের নোট লেখা", desc: "Publish the note for a period you teach or cover; prompts; upload", teacher: true, office: true, flags: [], designation: "slot_teacher_or_cover" },
      edit: { en: "Correct my class note", bn: "নিজের ক্লাস নোট সংশোধন", desc: "Edit a note you published", teacher: true, office: true, flags: [] },
      view_all: { en: "All teachers' notes", bn: "সব শিক্ষকের ক্লাস নোট দেখা", desc: "Admin list, submission report, school-wide archive", teacher: false, office: true, flags: [] },
      edit_all: { en: "Write/correct any note", bn: "যেকোনো ক্লাস নোট লেখা/সংশোধন", desc: "Publish on any slot; edit any note", teacher: false, office: true, flags: [] },
      delete: { en: "Delete a class note", bn: "ক্লাস নোট মুছে ফেলা", desc: "Remove a note", teacher: false, office: true, flags: [] },
    },
  },
  saturday_revision: {
    group: "teaching_and_trackers",
    en: "Saturday revision (Hifz)",
    bn: "শনিবারের রিভিশন",
    actions: {
      view: { en: "See my groups' revision", bn: "নিজের গ্রুপের রিভিশন দেখা", desc: "Group grid, history, heatmap, coverage, trend, dashboards", teacher: true, office: true, flags: [], designation: "group_lead" },
      view_all: { en: "See all groups", bn: "সব গ্রুপের রিভিশন দেখা", desc: "Unscoped reads; Saturday completeness status", teacher: false, office: true, flags: [] },
      enter_results: { en: "Record revision results", bn: "রিভিশনের ফল লেখা", desc: "Record or edit a Saturday entry", teacher: true, office: true, flags: [], designation: "group_lead" },
      edit_all: { en: "Any group", bn: "যেকোনো গ্রুপের রিভিশন লেখা ও পাঠানো", desc: "Write/send outside own groups", teacher: false, office: true, flags: [] },
      send: { en: "Send to guardians", bn: "অভিভাবককে রিভিশন পাঠানো", desc: "Send one entry or a group's Saturday (seals it, runs escalation)", teacher: true, office: true, flags: [], designation: "group_lead" },
      remind: { en: "Remind teachers", bn: "বাকি থাকা শিক্ষককে রিমাইন্ডার", desc: "wa.me nudge per teacher of an un-entered group", teacher: false, office: true, flags: [] },
      settings: { en: "Absence escalation limit", bn: "টানা অনুপস্থিতির সীমা ঠিক করা", desc: "Read/set the threshold", teacher: false, office: true, flags: [] },
    },
  },
  vocab_test: {
    group: "teaching_and_trackers",
    en: "Vocabulary test",
    bn: "ভোকাবুলারি টেস্ট",
    actions: {
      view: { en: "See vocab tests & reports", bn: "ভোকাবুলারি টেস্ট ও রিপোর্ট দেখা", desc: "Word bank, tests, results, dashboards, own tester duties", teacher: true, office: false, flags: [] },
      edit: { en: "Edit the word bank", bn: "শব্দভাণ্ডার সংশোধন", desc: "Add, edit, deactivate words for a class level you teach", teacher: true, office: false, flags: [] },
      create: { en: "Build a test", bn: "টেস্ট তৈরি", desc: "Create/update a test, lay positions", teacher: true, office: false, flags: [], designation: "vocab_tester" },
      enter_results: { en: "Mark a test", bn: "টেস্টের ফল লেখা", desc: "Present/absent and mistakes per student", teacher: true, office: false, flags: [], designation: "vocab_tester" },
      edit_all: { en: "Run any section's vocab", bn: "যেকোনো শাখার ভোকাবুলারি চালানো", desc: "Bypass tester/class-level scope", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
      assign: { en: "Assign weekly tester", bn: "সাপ্তাহিক টেস্টের দায়িত্ব বরাদ্দ", desc: "Set a tester; history", teacher: false, office: true, flags: [] },
      send: { en: "Send results to guardians", bn: "অভিভাবককে ফল পাঠানো", desc: "Per-test / cumulative guardian messages", teacher: true, office: true, flags: [] },
    },
  },
  class_test: {
    group: "assessment_and_exams",
    en: "Class test",
    bn: "ক্লাস টেস্ট",
    actions: {
      view: { en: "View class tests & marks", bn: "ক্লাস টেস্ট ও নম্বর দেখা", desc: "Tests, roster, marks, report status, analysis, own lists", teacher: true, office: false, flags: [] },
      view_all: { en: "All class tests", bn: "সব ক্লাস টেস্ট দেখা", desc: "Dashboard, school-wide overdue counts, any test unscoped", teacher: false, office: true, flags: [] },
      create: { en: "Request a class test", bn: "ক্লাস টেস্টের প্রিন্ট অনুরোধ", desc: "File a test and its paper into the print queue; number suggestion", teacher: true, office: false, flags: [] },
      register: { en: "Register a test held without printing", bn: "প্রিন্ট ছাড়া ক্লাস টেস্ট নথিভুক্ত করা", desc: "Create an official test directly", teacher: true, office: true, flags: [] },
      edit: { en: "Correct my test's details", bn: "নিজের পরীক্ষার তথ্য সংশোধন", desc: "Total, pass mark, date of own test", teacher: true, office: false, flags: [] },
      edit_all: { en: "Act on any test", bn: "যেকোনো ক্লাস টেস্টে কাজ করা", desc: "Edit any test; register unscoped / on behalf (D-#366); outside own grants", teacher: false, office: true, flags: [] },
      delete: { en: "Retire / restore a test", bn: "ক্লাস টেস্ট বাতিল ও ফিরিয়ে আনা", desc: "Retire a PRINTED test with a reason; restore", teacher: false, office: true, flags: [] },
      enter_results: { en: "Enter marks & submit", bn: "নম্বর এন্ট্রি ও অনুমোদনের জন্য পাঠানো", desc: "Enter/edit marks, submit, recall", teacher: true, office: false, flags: [] },
      publish: { en: "Approve & publish results", bn: "ফলাফল অনুমোদন করে প্রকাশ / ফেরত পাঠানো", desc: "Release to guardians (test or student); send back with a reason", teacher: false, office: true, flags: [] },
      revoke: { en: "Withdraw published results", bn: "প্রকাশিত ফলাফল ফিরিয়ে নেওয়া", desc: "Unpublish a test or one student", teacher: false, office: true, flags: [] },
      remind: { en: "Chase overdue results", bn: "দেরি হওয়া ফলাফলের জন্য রিমাইন্ডার", desc: "Overdue chase list with wa.me", teacher: false, office: true, flags: [] },
      settings: { en: "Result-entry targets", bn: "নম্বর এন্ট্রির লক্ষ্য ঠিক করা", desc: "Set/change/switch off a teacher's backlog target", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
    },
  },
  class_test_question: {
    group: "assessment_and_exams",
    en: "Class-test paper requests",
    bn: "ক্লাস টেস্টের প্রশ্নপত্র অনুরোধ",
    actions: {
      create: { en: "Request a question paper", bn: "অফিসের কাছে প্রশ্নপত্র চাওয়া", desc: "File/edit/cancel own request, review the draft, send to print", teacher: true, office: false, flags: [] },
      prepare: { en: "Prepare papers", bn: "প্রশ্নপত্র তৈরি করে শিক্ষকের কাছে পাঠানো", desc: "Whole queue; upload a draft to the requester", teacher: false, office: true, flags: [] },
      delete: { en: "Delete a request", bn: "প্রশ্নপত্র অনুরোধ মুছে ফেলা", desc: "Soft-delete a request", teacher: false, office: true, flags: [] },
    },
  },
  class_test_script: {
    group: "assessment_and_exams",
    en: "Answer scripts (scan & return)",
    bn: "খাতা স্ক্যান ও ফেরত",
    actions: {
      view: { en: "See script stage", bn: "খাতার অবস্থা দেখা", desc: "One test's script stage; open a tagged scan", teacher: true, office: true, flags: [] },
      scan: { en: "Receive, scan & tag", bn: "খাতা গ্রহণ, স্ক্যান ও শিক্ষার্থী অনুযায়ী যুক্ত করা", desc: "Desk: receive/undo, pages, missing, waive; acts on any test's scripts", teacher: false, office: true, flags: [] },
      publish: { en: "Publish scans to guardians", bn: "খাতার ছবি অভিভাবকদের কাছে প্রকাশ", desc: "Release or withdraw scans", teacher: false, office: true, flags: [] },
      hand_back: { en: "Hand scripts back", bn: "খাতা শিক্ষকের হাতে ফেরত দেওয়া", desc: "Office gives papers back for return in class", teacher: false, office: true, flags: [] },
      return: { en: "Mark returned to students", bn: "শিক্ষার্থীদের খাতা ফেরত দেওয়া হয়েছে", desc: "Own script tasks; mark returned (own test; `scan` holders any)", teacher: true, office: false, flags: [] },
    },
  },
  question_sets: {
    group: "assessment_and_exams",
    en: "Question sets",
    bn: "প্রশ্ন সেট",
    actions: {
      view: { en: "View sets", bn: "প্রশ্ন সেট দেখা", desc: "Sets, recent sets, where a question was used", teacher: true, office: false, flags: [] },
      view_all: { en: "Any section's sets", bn: "সব শাখার প্রশ্ন সেট দেখা", desc: "Read without a grant", teacher: false, office: true, flags: [] },
      create: { en: "Build sets", bn: "প্রশ্ন সেট তৈরি করা", desc: "Create, add/remove questions, rename, finalise", teacher: true, office: false, flags: [] },
      export: { en: "Set PDF", bn: "সেটের পিডিএফ নামানো", desc: "Student copy or answer key (Office: print-queued sets via printing)", teacher: true, office: false, flags: [] },
      edit_all: { en: "Build in any section", bn: "যেকোনো শাখার সেট তৈরি", desc: "Act outside own grants", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
    },
  },
  mastery: {
    group: "assessment_and_exams",
    en: "Learning mastery",
    bn: "শিখন-দক্ষতা",
    actions: {
      view: { en: "View catalogue, marks, tags, policy", bn: "শিখনফল তালিকা, নম্বর, ট্যাগ ও পলিসি দেখা", desc: "Read the outcome catalogue, question-type marks, tags, policy and the switch (later: diagnosis views, row-scoped for teachers)", teacher: true, office: true, flags: [] },
      settings: { en: "Manage the catalogue & policy", bn: "শিখনফল তালিকা ও পলিসি ঠিক করা", desc: "Import (preview/apply) and lock a catalogue, edit outcomes, question-type marks, tags, policy, the year × class × subject switch", teacher: false, office: false, flags: [] },
      delete: { en: "Retire an outcome", bn: "শিখনফল অবসরে দেওয়া", desc: "LOCKED → RETIRED; a draft is removed", teacher: false, office: false, flags: [] },
      enter_results: { en: "Enter per-question results", bn: "প্রশ্নভিত্তিক নম্বর তোলা", desc: "Exceptions-only entry, re-work, tags, rubric (M-2), routine-held class × subject", teacher: true, office: false, flags: [] },
      create: { en: "Build homework sheets & assignments", bn: "বাড়ির কাজ ও অ্যাসাইনমেন্ট তৈরি", desc: "Work sheets, the weekly tailored assignment and its layout (M-2/M-4), routine-held class × subject", teacher: true, office: false, flags: [] },
      approve: { en: "Approve extra classes", bn: "অতিরিক্ত ক্লাস অনুমোদন", desc: "Approve a section-trigger proposal, pick slot/teacher, close the action (M-5). Selected Office staff by per-person grant (D-#786)", teacher: false, office: false, flags: [] },
      edit_all: { en: "Work in any শাখা", bn: "যেকোনো শাখার শিখন-দক্ষতার কাজ", desc: "Build sheets, enter and read results for a class × subject the routine does not give you (M-2)", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
    },
  },
  exam_syllabus: {
    group: "assessment_and_exams",
    en: "Exam syllabus",
    bn: "পরীক্ষার সিলেবাস",
    actions: {
      view: { en: "View syllabus", bn: "সিলেবাস দেখা", desc: "Published syllabuses, exam list, class PDF", teacher: true, office: true, flags: [] },
      view_all: { en: "Syllabus board & drafts", bn: "সব শ্রেণির সিলেবাস বোর্ড ও খসড়া দেখা", desc: "Coverage board, level board, unpublished rows", teacher: false, office: true, flags: [] },
      settings: { en: "Set up exams", bn: "পরীক্ষা তৈরি ও তারিখ ঠিক করা", desc: "Create an exam, edit name and dates", teacher: false, office: true, flags: [] },
      edit: { en: "Write syllabus", bn: "সিলেবাস লেখা ও অনুমোদনে পাঠানো", desc: "Write/edit, class footer, approver, submit, reassign, send back at PRINCIPAL_REVIEW", teacher: false, office: true, flags: [] },
      publish: { en: "Publish syllabus", bn: "সিলেবাস প্রকাশ করা", desc: "PRINCIPAL_REVIEW → PUBLISHED; approve when the routine names nobody", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
    },
  },
  scholarship_practice: {
    group: "assessment_and_exams",
    en: "Scholarship practice",
    bn: "বৃত্তি অনুশীলন",
    actions: {
      view: { en: "Results & weak topics", bn: "অনুশীলনের ফল ও দুর্বলতা দেখা", desc: "Papers, analysis, topics, candidates, Excel export", teacher: true, office: true, flags: [] },
      create: { en: "Declare a practice paper", bn: "অনুশীলন প্রশ্নপত্র ঘোষণা করা", desc: "Declare a paper and items; live item check", teacher: true, office: true, flags: [] },
      enter_results: { en: "Enter marks", bn: "নম্বর তোলা", desc: "Per-item marks and absent status", teacher: true, office: true, flags: [] },
      settings: { en: "Topic catalogue", bn: "টপিক তালিকা ঠিক করা", desc: "Add or edit topics", teacher: true, office: true, flags: [] },
      delete: { en: "Retire a topic", bn: "টপিক বাদ দেওয়া", desc: "Retire a topic", teacher: false, office: true, flags: [] },
      select_candidates: { en: "Choose exam candidates", bn: "বৃত্তি পরীক্ষার্থী বাছাই করা", desc: "Enter or withdraw a child", teacher: false, office: true, flags: [] },
      edit_all: { en: "Work on every section", bn: "যেকোনো শাখার অনুশীলন সামলানো", desc: "Skip the routine class × subject check", teacher: false, office: true, flags: [] },
    },
  },
  students: {
    group: "students_and_families",
    en: "Students",
    bn: "শিক্ষার্থী",
    actions: {
      view_all: { en: "Whole-school student list", bn: "সব শিক্ষার্থীর তালিকা দেখা", desc: "Student directory (class, section, groups, guardian phones)", teacher: false, office: true, flags: [] },
      create: { en: "Add a student", bn: "নতুন শিক্ষার্থী যোগ করা", desc: "Add to a class/section", teacher: false, office: true, flags: [] },
      edit: { en: "Edit student details", bn: "শিক্ষার্থীর তথ্য ঠিক করা", desc: "Set/clear roll number", teacher: false, office: true, flags: [] },
    },
  },
  guardians: {
    group: "students_and_families",
    en: "Guardians",
    bn: "অভিভাবক",
    actions: {
      view_all: { en: "See all guardians", bn: "সব অভিভাবকের তালিকা দেখা", desc: "Guardian directory", teacher: false, office: true, flags: [] },
      create: { en: "Add a guardian", bn: "নতুন অভিভাবক যোগ করা", desc: "Create a guardian account", teacher: false, office: true, flags: [] },
      link: { en: "Link/unlink a child", bn: "শিক্ষার্থীর সাথে অভিভাবক যুক্ত/বিচ্ছিন্ন করা", desc: "Add/deactivate a guardian↔student link", teacher: false, office: true, flags: [] },
      reset_password: { en: "Guardian logins", bn: "অভিভাবকের লগইন তৈরি ও পাসওয়ার্ড রিসেট", desc: "Provision or reset a family's phone login", teacher: false, office: true, flags: [] },
    },
  },
  student_profile: {
    group: "students_and_families",
    en: "Student profile",
    bn: "শিক্ষার্থী প্রোফাইল",
    actions: {
      view: { en: "Open a profile", bn: "শিক্ষার্থীর প্রোফাইল দেখা", desc: "Header, homework, assignment, class test, attendance, comments panels; whole picture", teacher: true, office: true, flags: [] },
      view_all: { en: "Any student's profile", bn: "সব শিক্ষার্থীর প্রোফাইল দেখা", desc: "Profile with no row limit", teacher: false, office: true, flags: [] },
      export: { en: "Profile PDF", bn: "প্রোফাইল PDF ডাউনলোড", desc: "Print the profile sheet", teacher: true, office: true, flags: [] },
    },
  },
  student_comments: {
    group: "students_and_families",
    en: "Daily comments",
    bn: "দৈনিক মন্তব্য",
    actions: {
      create: { en: "Write a daily comment", bn: "দৈনিক মন্তব্য লেখা", desc: "Comment on any student; edit own undelivered; own list", teacher: true, office: false, flags: [] },
      view: { en: "See a section's comments", bn: "শাখার মন্তব্য দেখা", desc: "section list, a student's timeline, within read scope", teacher: true, office: true, flags: [] },
      view_all: { en: "Every section's comments", bn: "সব শাখার মন্তব্য দেখা", desc: "Unscoped read", teacher: false, office: true, flags: [] },
      review: { en: "Review before sending", bn: "পাঠানোর আগে মন্তব্য পর্যালোচনা", desc: "Inbox + badge, edit any undelivered, remove files, discard", teacher: false, office: true, flags: [] },
      send: { en: "Send to the guardian", bn: "অভিভাবকের কাছে পাঠানো", desc: "Deliver (seal, wa.me, notification)", teacher: false, office: true, flags: [] },
    },
  },
  parents_meeting: {
    group: "students_and_families",
    en: "Parents' meeting",
    bn: "অভিভাবক সভা",
    actions: {
      view: { en: "See meetings", bn: "অভিভাবক সভা দেখা", desc: "Meetings, slots, attendance totals, comment progress, any note screen", teacher: false, office: true, flags: [] },
      create: { en: "Set up a meeting", bn: "সভা তৈরি ও সময়সূচি সাজানো", desc: "Create, generate slots, reorder, On-Call, breaks", teacher: false, office: true, flags: [] },
      send: { en: "Send the timetable", bn: "পরিবারকে সময়সূচি পাঠানো", desc: "Dispatch per-family timing notices", teacher: false, office: true, flags: [] },
      mark_attendance: { en: "Mark meeting attendance", bn: "সভায় উপস্থিতি দেওয়া", desc: "Present/absent + remark per slot", teacher: false, office: true, flags: [] },
      assign: { en: "Run comment collection", bn: "মন্তব্য সংগ্রহ চালানো", desc: "Open collection, rebuild roster, skip a subject, remind a teacher", teacher: false, office: true, flags: [] },
      review: { en: "Write the final comment", bn: "চূড়ান্ত মন্তব্য লেখা", desc: "Final word per child; final queue", teacher: false, office: true, flags: [] },
      write_notes: { en: "Write my meeting notes", bn: "সভার মন্তব্য লেখা (শিক্ষক)", desc: "Subject note; class teacher summary; Today cards", teacher: true, office: false, flags: [], designation: "row_teacher/class_teacher" },
      view_brief: { en: "Brief & comparison", bn: "সভার সারসংক্ষেপ ও তুলনা দেখা", desc: "Per-child brief + PDF, timeline, comparison", teacher: true, office: true, flags: [], designation: "class_teacher", waiver: "parents_meeting:view" },
      approve_change: { en: "Approve a time change", bn: "সময় পরিবর্তনের অনুরোধ অনুমোদন", desc: "Approve (swap two families) or decline a guardian's slot-change request", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
    },
  },
  monthly_report: {
    group: "students_and_families",
    en: "Monthly progress report",
    bn: "মাসিক অগ্রগতি রিপোর্ট",
    actions: {
      view: { en: "See monthly reports", bn: "মাসিক রিপোর্ট দেখা", desc: "A section's reports and PDF in scope (narrowed to own subjects)", teacher: true, office: true, flags: [] },
      view_all: { en: "Whole school's month", bn: "সব শাখার মাসিক অবস্থা দেখা", desc: "Any section; roll-ups; pending work; chase messages; fee block", teacher: false, office: true, flags: [] },
      create: { en: "Build reports & drafts", bn: "রিপোর্ট তৈরি ও খসড়া মন্তব্য", desc: "Compute a section's month; draft the guardian paragraph", teacher: false, office: true, flags: [] },
      export: { en: "Export / import comment work", bn: "মন্তব্যের ফাইল নামানো ও ফেরত দেওয়া", desc: "Comment-writing file; paste the envelope back", teacher: false, office: true, flags: [] },
      review: { en: "Approve the paragraph", bn: "মন্তব্য অনুমোদন", desc: "Accept or edit the guardian paragraph", teacher: true, office: true, flags: [], designation: "class_teacher/whole_section_supervisor" },
      release: { en: "Release to the family", bn: "পরিবারের কাছে প্রকাশ", desc: "Release one or a batch", teacher: false, office: true, flags: [] },
      override: { en: "Override a block", bn: "বাধা উপেক্ষা করে প্রকাশ", desc: "Release a coverage-blocked or hard-locked report with a reason", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
      revoke: { en: "Withdraw a released report", bn: "প্রকাশিত রিপোর্ট প্রত্যাহার", desc: "Revoke one report or a bulk batch", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
      settings: { en: "Report thresholds", bn: "রিপোর্টের সীমা ও নিয়ম", desc: "Change thresholds, coverage gate, calendar, fee/class-best display", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
    },
  },
  improvement_plan: {
    group: "students_and_families",
    en: "Student progress & improvement",
    bn: "শিক্ষার্থীর অগ্রগতি ও উন্নতির কাজ",
    actions: {
      view_all: { en: "Progress board", bn: "শিক্ষার্থীর অগ্রগতি বোর্ড দেখা", desc: "School tiles, section board, one student, actions, day tasks, a leave's tasks", teacher: false, office: true, flags: [] },
      create: { en: "Start an action", bn: "নতুন উন্নতির কাজ শুরু", desc: "Create for a student or a section; prefill", teacher: false, office: true, flags: [] },
      edit: { en: "Stop or extend", bn: "উন্নতির কাজ বন্ধ / বাড়ানো", desc: "Stop with a reason; extend", teacher: false, office: true, flags: [] },
      assign: { en: "Assign a day's task", bn: "দিনের কাজ বরাদ্দ", desc: "Who does the teacher task on a leave day", teacher: false, office: true, flags: [] },
      edit_all: { en: "Mark for a teacher", bn: "শিক্ষকের পক্ষে চিহ্ন দেওয়া", desc: "Tick/untick a teacher task for a past day with a reason", teacher: false, office: true, flags: [] },
      tick: { en: "Tick my task", bn: "নিজের কাজ সম্পন্ন চিহ্নিত", desc: "Own/cover task today; own tasks list", teacher: true, office: true, flags: ["SELF"] },
    },
  },
  attendance: {
    group: "attendance_and_routine",
    en: "Student attendance",
    bn: "শিক্ষার্থীর উপস্থিতি",
    actions: {
      mark: { en: "Take attendance", bn: "উপস্থিতি নেওয়া (দায়িত্ব পেলে)", desc: "Mark today's absentees for a unit you mark today", teacher: true, office: false, flags: [], designation: "marker_of_the_day" },
      view: { en: "My section's attendance", bn: "নিজের শাখার উপস্থিতি দেখা", desc: "Day, absentees, history, without-leave, leave list, own brief", teacher: true, office: true, flags: [], designation: "class_teacher" },
      view_all: { en: "Whole-school attendance", bn: "সব শাখার উপস্থিতি ও প্রতিবেদন দেখা", desc: "Absentee report, unmarked, rankings, class presence", teacher: false, office: true, flags: [] },
      edit: { en: "Fix a past day", bn: "আগের দিনের উপস্থিতি সংশোধন", desc: "Mark/amend any unit on any date", teacher: false, office: true, flags: [] },
      assign: { en: "Assign attendance duty", bn: "উপস্থিতির দায়িত্ব বরাদ্দ", desc: "Override the marker for a date range; revoke", teacher: false, office: true, flags: [] },
      record_leave: { en: "Record a student's leave", bn: "শিক্ষার্থীর ছুটির আবেদন লেখা", desc: "Record on the guardian's behalf", teacher: false, office: true, flags: [] },
      remind: { en: "Remind guardian", bn: "অনুপস্থিতির জন্য অভিভাবককে রিমাইন্ডার", desc: "wa.me chase link", teacher: false, office: true, flags: [] },
    },
  },
  staff_attendance: {
    group: "attendance_and_routine",
    en: "Staff attendance",
    bn: "শিক্ষক-কর্মীর উপস্থিতি",
    actions: {
      upload: { en: "Upload the Excel", bn: "শিক্ষক-কর্মীদের উপস্থিতির এক্সেল আপলোড", desc: "Preview and commit; past uploads", teacher: false, office: true, flags: [] },
      view_all: { en: "All staff attendance", bn: "সব শিক্ষক-কর্মীর উপস্থিতি দেখা", desc: "Day roster, summary, ranking; staff hub tab + lateness preview", teacher: false, office: true, flags: [] },
      view_own: { en: "My attendance", bn: "আমার উপস্থিতি", desc: "Own biometric days", teacher: true, office: true, flags: ["SELF"] },
    },
  },
  routine: {
    group: "attendance_and_routine",
    en: "Routine & calendar",
    bn: "রুটিন ও ক্যালেন্ডার",
    actions: {
      view: { en: "See the routine", bn: "রুটিন দেখা", desc: "Routines, groups, rooms, grids, holidays, covers, bell, own load, free/busy", teacher: true, office: true, flags: [] },
      view_all: { en: "Board, master grid, all loads", bn: "আজকের ক্লাস বোর্ড, সম্পূর্ণ গ্রিড ও সব শিক্ষকের লোড দেখা", desc: "Live board, master grid, every teacher's load", teacher: false, office: true, flags: [] },
      edit: { en: "Build the routine", bn: "রুটিন তৈরি ও পরিবর্তন", desc: "Create/update/retire slots; reassign a subject's routine teacher", teacher: false, office: true, flags: [] },
      edit_calendar: { en: "Holidays & windows", bn: "ছুটির দিন ও সময়সূচি ঠিক করা", desc: "Holiday exceptions; schedule windows", teacher: false, office: true, flags: [] },
      settings: { en: "Rooms, periods, groups, bell", bn: "রুম, পিরিয়ড, গ্রুপ ও ঘণ্টার দায়িত্ব ঠিক করা", desc: "Rooms, period grids, subject groups and members, bell duty", teacher: false, office: true, flags: [] },
    },
  },
  cover: {
    group: "attendance_and_routine",
    en: "Cover classes",
    bn: "বদলি ক্লাস",
    actions: {
      view_all: { en: "Uncovered classes", bn: "কভার লাগবে এমন ক্লাস দেখা", desc: "Needs-cover inbox; any leave's cover slots", teacher: false, office: true, flags: [] },
      approve: { en: "Approve leave cover", bn: "বদলি শিক্ষক ঠিক করা", desc: "Approve/reject/direct-assign leave cover (mints a 1-day proxy); propose on another's leave", teacher: false, office: true, flags: [] },
      assign: { en: "Assign a slot cover", bn: "কভার শিক্ষক বরাদ্দ", desc: "Assign or cancel a routine slot cover", teacher: false, office: true, flags: [] },
      assign_proxy: { en: "Grant a proxy (cover) scope", bn: "বদলি শিক্ষককে (প্রক্সি) দায়িত্ব দেওয়া", desc: "Assign/extend/revoke a proxy write ScopeGrant; list them", teacher: false, office: false, flags: ["ESCALATION"] },
      propose: { en: "Propose my cover", bn: "নিজের ছুটিতে বদলি প্রস্তাব", desc: "Propose a cover teacher on own leave; own leave's slots", teacher: true, office: true, flags: ["SELF"] },
    },
  },
  staff_records: {
    group: "staff_and_hr",
    en: "Staff records",
    bn: "কর্মীর তথ্য",
    actions: {
      view: { en: "See staff records", bn: "কর্মীদের তথ্য দেখা", desc: "Staff list and hub profile (without NID, bank and salary)", teacher: false, office: true, flags: [] },
      view_sensitive: { en: "See NID and bank details", bn: "কর্মীর এনআইডি ও ব্যাংকের তথ্য দেখা", desc: "NID and bank-account fields on the staff record (field gate)", teacher: false, office: true, flags: [] },
      create: { en: "Add staff", bn: "নতুন কর্মী যোগ করা", desc: "Create a record (pay excluded)", teacher: false, office: true, flags: [] },
      edit: { en: "Edit a record", bn: "কর্মীর তথ্য সংশোধন", desc: "Bio, contact, bank account", teacher: false, office: true, flags: [] },
      confirm: { en: "Confirm employment", bn: "চাকরি স্থায়ী করা", desc: "Confirm a probationer; settle held leave debt; preview", teacher: false, office: true, flags: [] },
    },
  },
  hr_policy: {
    group: "staff_and_hr",
    en: "HR policy",
    bn: "এইচআর নিয়মকানুন",
    actions: {
      view: { en: "View HR policy", bn: "নিয়মকানুন দেখা", desc: "Leave pool, probation, lateness rule, signatory, school bank", teacher: false, office: true, flags: [] },
      settings: { en: "Edit HR policy", bn: "নিয়মকানুন বদলানো", desc: "Change those switches", teacher: false, office: true, flags: [] },
    },
  },
  leave: {
    group: "staff_and_hr",
    en: "Staff leave",
    bn: "কর্মীর ছুটি",
    actions: {
      view_all: { en: "Everyone's leave", bn: "সবার ছুটি দেখা", desc: "Lists, balances, pool, probation debt", teacher: false, office: true, flags: [] },
      approve: { en: "Approve / reject leave", bn: "ছুটি মঞ্জুর বা নামঞ্জুর করা", desc: "Decide; cancel another person's leave; pending badge", teacher: false, office: true, flags: [] },
      create: { en: "Record leave for someone", bn: "অন্যের হয়ে ছুটি লেখা", desc: "Apply on another staff member's behalf", teacher: false, office: true, flags: [] },
      settings: { en: "Leave allowance", bn: "ছুটির বরাদ্দ ঠিক করা", desc: "Per-year entitlement and carry-over", teacher: false, office: true, flags: [] },
      apply: { en: "Apply for my leave", bn: "নিজের ছুটির আবেদন", desc: "Apply, cancel own, own leave and balances", teacher: true, office: true, flags: ["SELF"] },
    },
  },
  appraisal: {
    group: "staff_and_hr",
    en: "Appraisal & CPD",
    bn: "কাজের মূল্যায়ন ও প্রশিক্ষণ",
    actions: {
      view_all: { en: "View appraisals", bn: "সবার মূল্যায়ন দেখা", desc: "Everyone's observations, appraisals, CPD log", teacher: false, office: true, flags: [] },
      observe: { en: "Observe any staff", bn: "যেকোনো শিক্ষকের কাজ পর্যবেক্ষণ লেখা", desc: "Submit an observation on anyone (supervisor scope path stays)", teacher: false, office: true, flags: [] },
      prepare: { en: "Prepare appraisal", bn: "মূল্যায়ন তৈরি করা", desc: "Draft goals and needs", teacher: false, office: true, flags: [] },
      sign_off: { en: "Sign off appraisal", bn: "মূল্যায়নে চূড়ান্ত সই", desc: "Set outcome and lock", teacher: false, office: false, flags: ["LOCKED"] },
      log_cpd: { en: "Log training", bn: "প্রশিক্ষণের তথ্য লেখা", desc: "Add a CPD entry", teacher: false, office: true, flags: [] },
      view_own: { en: "My appraisals", bn: "আমার মূল্যায়ন", desc: "Own appraisals, CPD, observations I wrote", teacher: true, office: true, flags: ["SELF"] },
    },
  },
  conduct: {
    group: "staff_and_hr",
    en: "Conduct",
    bn: "শৃঙ্খলা",
    actions: {
      view_all: { en: "Conduct records", bn: "শৃঙ্খলার রেকর্ড দেখা", desc: "Anyone's conduct ladder (confidential)", teacher: false, office: true, flags: [] },
      create: { en: "Raise a step", bn: "সতর্কতার ধাপ লেখা", desc: "Draft a verbal/written/final/termination step", teacher: false, office: true, flags: [] },
      record_hearing: { en: "Record hearing", bn: "শুনানির কথা লেখা", desc: "The person's response before finalising", teacher: false, office: true, flags: [] },
      sign_off: { en: "Finalise a step", bn: "শৃঙ্খলার সিদ্ধান্ত চূড়ান্ত করা", desc: "Finalise; termination sets employmentStatus", teacher: false, office: false, flags: ["LOCKED"] },
      view_own: { en: "My conduct records", bn: "আমার শৃঙ্খলার রেকর্ড", desc: "Own records", teacher: true, office: true, flags: ["SELF"] },
    },
  },
  grievance: {
    group: "staff_and_hr",
    en: "Grievances",
    bn: "অভিযোগ",
    actions: {
      view_all: { en: "Grievance inbox", bn: "সব অভিযোগ দেখা", desc: "The inbox", teacher: false, office: true, flags: [] },
      resolve: { en: "Handle a grievance", bn: "অভিযোগের ব্যবস্থা নেওয়া", desc: "Under review / resolved / closed with a note", teacher: false, office: true, flags: [] },
      raise: { en: "Raise a grievance", bn: "অভিযোগ জানানো", desc: "Raise one, read own (never revocable)", teacher: true, office: true, flags: ["SELF"] },
    },
  },
  staff_letters: {
    group: "staff_and_hr",
    en: "Letters & contracts",
    bn: "চিঠি ও চুক্তিপত্র",
    actions: {
      view: { en: "View / print letters", bn: "চিঠি দেখা ও ছাপানো", desc: "Letter list, count, PDF", teacher: false, office: true, flags: [] },
      issue: { en: "Issue a letter", bn: "চিঠি দেওয়া", desc: "Appointment, confirmation, certificate, support contract", teacher: false, office: true, flags: [] },
      void: { en: "Void a letter", bn: "চিঠি বাতিল করা", desc: "Mark VOID (kept)", teacher: false, office: true, flags: [] },
    },
  },
  offboarding: {
    group: "staff_and_hr",
    en: "Leaving the school",
    bn: "চাকরি ছাড়া",
    actions: {
      view: { en: "View exit cases", bn: "চাকরি ছাড়ার ফাইল দেখা", desc: "Cases, one case, per-staff history", teacher: false, office: true, flags: [] },
      create: { en: "Start exit", bn: "চাকরি ছাড়ার প্রক্রিয়া শুরু", desc: "Open a case", teacher: false, office: true, flags: [] },
      edit: { en: "Work the clearance", bn: "ছাড়পত্র ও বিদায় সাক্ষাৎকার", desc: "Clearance items, exit interview", teacher: false, office: true, flags: [] },
      revoke: { en: "Disable login", bn: "লগইন বন্ধ করা", desc: "Disable the login and revoke all ScopeGrants", teacher: false, office: true, flags: [] },
      issue: { en: "Experience certificate", bn: "অভিজ্ঞতা সনদ দেওয়া", desc: "Service certificate", teacher: false, office: true, flags: [] },
      cancel: { en: "Withdraw exit", bn: "প্রক্রিয়া বাতিল", desc: "Cancel before access is revoked", teacher: false, office: true, flags: [] },
      prepare: { en: "Compute final dues", bn: "শেষ পাওনা হিসাব করা", desc: "Held final settlement", teacher: false, office: true, flags: [] },
      settle: { en: "Release final dues", bn: "শেষ পাওনা ছাড় করা", desc: "Release after clearance; commits advance recovery", teacher: false, office: false, flags: ["LOCKED"] },
    },
  },
  classroom_observation: {
    group: "staff_and_hr",
    en: "Classroom observation",
    bn: "ক্লাসরুম পর্যবেক্ষণ",
    actions: {
      view: { en: "My observations", bn: "নিজের পর্যবেক্ষণ দেখা", desc: "As observer or observed (after publish); trend; respond and rate", teacher: true, office: true, flags: [] },
      view_all: { en: "All observations", bn: "সব পর্যবেক্ষণ দেখা", desc: "Oversight list, any teacher's rows/trend/footage, compare", teacher: false, office: true, flags: [] },
      upload: { en: "Upload a class video", bn: "ক্লাসের ভিডিও আপলোড", desc: "Upload a session; link footage", teacher: false, office: true, flags: [] },
      assign: { en: "Assign an observer", bn: "পর্যবেক্ষক বরাদ্দ", desc: "Assign/reassign, re-review, co-review, cancel/restore", teacher: false, office: true, flags: [] },
      review: { en: "Review as observer", bn: "পর্যবেক্ষক হিসেবে রিভিউ", desc: "Score + comment, reject an unusable video, queue, history", teacher: true, office: false, flags: [], designation: "assigned_observer" },
      edit: { en: "Edit a review", bn: "প্রকাশের আগে রিভিউ সংশোধন", desc: "Change before publishing", teacher: false, office: true, flags: [] },
      publish: { en: "Publish / withhold", bn: "শিক্ষকের কাছে প্রকাশ / স্থগিত", desc: "Publish, withhold, lift the hold; toPublish badge", teacher: false, office: true, flags: [] },
      schedule: { en: "Due list & review rota", bn: "রিভিউ-প্রয়োজন তালিকা ও রুটিন", desc: "Due list; generate/save/read the rota", teacher: false, office: true, flags: [] },
      view_reports: { en: "Reviewer effectiveness", bn: "রিভিউয়ার কার্যকারিতা ও স্কুলের প্রবণতা", desc: "Effectiveness, school patterns, fairness/usefulness ratings", teacher: false, office: true, flags: [] },
      settings: { en: "Observation settings", bn: "পর্যবেক্ষণ সেটিংস", desc: "Escalation and scheduler cadence", teacher: false, office: true, flags: [] },
      set_quota: { en: "Observer daily target", bn: "পর্যবেক্ষকের দৈনিক লক্ষ্য ঠিক করা", desc: "Set/change/switch off a review quota", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
    },
  },
  free_mixing_review: {
    group: "staff_and_hr",
    en: "Free-mixing video review",
    bn: "ফ্রি মিক্সিং পর্যবেক্ষণ",
    actions: {
      assign: { en: "Log & assign a video", bn: "ভিডিও যোগ ও রিভিউয়ার বরাদ্দ", desc: "Log a class link, assign a reviewer", teacher: false, office: true, flags: [] },
      review: { en: "Review an assigned video", bn: "বরাদ্দ ভিডিও রিভিউ", desc: "My videos; OK / not-OK with a comment", teacher: true, office: false, flags: [], designation: "assigned_reviewer" },
      view_all: { en: "Video board", bn: "সব ভিডিও রিভিউ দেখা", desc: "Every review with per-teacher counts", teacher: false, office: true, flags: [] },
    },
  },
  payroll: {
    group: "finance",
    en: "Payroll",
    bn: "বেতন",
    actions: {
      view: { en: "View payroll", bn: "বেতনের হিসাব দেখা", desc: "Runs, payslips, pay history, lateness charge", teacher: false, office: true, flags: [] },
      edit: { en: "Set salary", bn: "বেতন ঠিক করা", desc: "Monthly salary and payment method", teacher: false, office: true, flags: [] },
      prepare: { en: "Prepare payroll", bn: "মাসের বেতন তৈরি করা", desc: "Compute/recompute, cancel a prepared run", teacher: false, office: true, flags: [] },
      approve: { en: "Approve & lock payroll", bn: "বেতন অনুমোদন ও লক করা", desc: "Lock a run; commit advance recovery", teacher: false, office: false, flags: ["LOCKED"] },
      export: { en: "Payment files", bn: "ব্যাংক অ্যাডভাইস ও ফাইল নামানো", desc: "Advice pack, CSV, register XLSX", teacher: false, office: true, flags: [] },
      view_own: { en: "My payslips", bn: "আমার বেতনের স্লিপ", desc: "Own payslips (locked runs)", teacher: true, office: true, flags: ["SELF"] },
    },
  },
  salary_advance: {
    group: "finance",
    en: "Salary advances",
    bn: "অগ্রিম বেতন",
    actions: {
      view: { en: "View advances", bn: "অগ্রিম দেখা", desc: "A staff member's advances", teacher: false, office: true, flags: [] },
      issue: { en: "Give an advance", bn: "অগ্রিম দেওয়া", desc: "Issue an advance or loan", teacher: false, office: false, flags: ["LOCKED"] },
      settle: { en: "Settle / write off", bn: "অগ্রিম মিটিয়ে দেওয়া বা মাফ করা", desc: "Early payoff or write-off", teacher: false, office: false, flags: ["LOCKED"] },
    },
  },
  finance_ledger: {
    group: "finance",
    en: "Daily books",
    bn: "হিসাবের খাতা",
    actions: {
      view: { en: "Daily books", bn: "দৈনিক হিসাব দেখা", desc: "Snapshot, month-to-date, balances, fee history, net-pay aggregate", teacher: false, office: true, flags: [] },
      create: { en: "Record income / expense", bn: "আয়-ব্যয় লেখা", desc: "Append a posting", teacher: false, office: true, flags: [] },
      reverse: { en: "Reverse an entry", bn: "ভুল এন্ট্রি উল্টানো", desc: "Append a negating posting", teacher: false, office: true, flags: [] },
      settings: { en: "Opening balance", bn: "শুরুর ব্যালান্স ঠিক করা", desc: "Effective-dated opening per ledger", teacher: false, office: true, flags: [] },
      remind: { en: "Fee-due reminder", bn: "বকেয়া ফির রিমাইন্ডার", desc: "wa.me + push to the guardian", teacher: false, office: true, flags: [] },
    },
  },
  finance_reports: {
    group: "finance",
    en: "Finance reports",
    bn: "আর্থিক রিপোর্ট",
    actions: {
      view: { en: "Finance reports", bn: "আয়-ব্যয়ের রিপোর্ট দেখা", desc: "Monthly report, year KPIs, YTD statement, trends", teacher: false, office: true, flags: [] },
    },
  },
  budget: {
    group: "finance",
    en: "Budget",
    bn: "বাজেট",
    actions: {
      view: { en: "View budget", bn: "বাজেট দেখা", desc: "Lines, budget vs actual, surplus/deficit", teacher: false, office: true, flags: [] },
      edit: { en: "Set budget", bn: "বাজেট ঠিক করা", desc: "Upsert a year × head line", teacher: false, office: true, flags: [] },
    },
  },
  fee_support: {
    group: "finance",
    en: "Zakat & fee support",
    bn: "যাকাত ও ফি সহায়তা",
    actions: {
      view: { en: "View fee support", bn: "সহায়তার হিসাব দেখা", desc: "Providers; provider statement", teacher: false, office: true, flags: [] },
      edit: { en: "Providers & allocations", bn: "দাতা ও সহায়তা ঠিক করা", desc: "Create a provider; set a student's allocation", teacher: false, office: true, flags: [] },
      create: { en: "Record provider payment", bn: "দাতার টাকা জমা লেখা", desc: "Record a receipt", teacher: false, office: true, flags: [] },
    },
  },
  qard: {
    group: "finance",
    en: "Qard-hasan / IOU",
    bn: "কর্জে হাসানা",
    actions: {
      view: { en: "Qard register", bn: "কর্জের হিসাব দেখা", desc: "Parties, outstanding, overdue, entries", teacher: false, office: true, flags: [] },
      create: { en: "Record qard movement", bn: "কর্জ দেওয়া বা ফেরত লেখা", desc: "Disbursement, repayment, adjustment", teacher: false, office: true, flags: [] },
      edit: { en: "Add counterparty", bn: "কর্জগ্রহীতা যোগ করা", desc: "Create or set a party", teacher: false, office: true, flags: [] },
    },
  },
  reconciliation: {
    group: "finance",
    en: "Bank reconciliation",
    bn: "হিসাব মেলানো",
    actions: {
      view: { en: "View reconciliations", bn: "মেলানোর ইতিহাস দেখা", desc: "Latest, history, unreconciled days", teacher: false, office: true, flags: [] },
      create: { en: "Reconcile with bank", bn: "ব্যাংকের সাথে হিসাব মেলানো", desc: "Record a reconciliation", teacher: false, office: true, flags: [] },
    },
  },
  lesson_plans: {
    group: "content_and_books",
    en: "Lesson plans",
    bn: "পাঠ পরিকল্পনা",
    actions: {
      view: { en: "View lesson plans", bn: "পাঠ পরিকল্পনা দেখা", desc: "Plan tree, a plan, its PDF", teacher: true, office: false, flags: [] },
      view_all: { en: "Every plan", bn: "সব পাঠ পরিকল্পনা দেখা", desc: "Plans beyond own routine/supervisory scope", teacher: false, office: true, flags: [] },
      import: { en: "Import lesson plans", bn: "পাঠ পরিকল্পনা ইম্পোর্ট করা", desc: "Upload a plan pair or envelope", teacher: false, office: true, flags: [] },
    },
  },
  plan_review: {
    group: "content_and_books",
    en: "Plan review",
    bn: "পরিকল্পনা রিভিউ",
    actions: {
      assign: { en: "Assign plan reviewers", bn: "রিভিউয়ার বরাদ্দ করা", desc: "Assign/move/cancel rounds; board, inbox, load; any thread", teacher: false, office: true, flags: [] },
      review: { en: "Review plans", bn: "পরিকল্পনা রিভিউ করা", desc: "Verdict on an assigned plan", teacher: true, office: false, flags: [], designation: "assigned_reviewer" },
      approve: { en: "Sign off plans (gold)", bn: "চূড়ান্ত অনুমোদন (গোল্ড) দেওয়া", desc: "Promote to gold, single or bulk", teacher: false, office: false, flags: [] },
    },
  },
  question_bank: {
    group: "content_and_books",
    en: "Question bank",
    bn: "প্রশ্নব্যাংক",
    actions: {
      view: { en: "View question bank", bn: "প্রশ্নব্যাংক দেখা", desc: "Published questions, stimuli, filters", teacher: true, office: true, flags: [] },
      view_all: { en: "Unpublished questions", bn: "অপ্রকাশিত প্রশ্নসহ সব দেখা", desc: "Draft and reviewed questions", teacher: false, office: true, flags: [] },
      import: { en: "Import question bank", bn: "প্রশ্নব্যাংক ইম্পোর্ট করা", desc: "Upload a Project-04 collection", teacher: false, office: true, flags: [] },
      edit: { en: "Correct questions", bn: "প্রশ্ন ও উত্তর সংশোধন করা", desc: "Text, answer, marks; IMPORTANT on any question", teacher: false, office: true, flags: [] },
      delete: { en: "Retire / restore", bn: "প্রশ্ন বাদ দেওয়া ও ফেরত আনা", desc: "Soft-delete, restore, retired view", teacher: false, office: true, flags: [] },
    },
  },
  question_review: {
    group: "content_and_books",
    en: "Question review & publishing",
    bn: "প্রশ্ন রিভিউ",
    actions: {
      assign: { en: "Assign question reviewers", bn: "প্রশ্ন রিভিউ বরাদ্দ করা", desc: "Assign by question/chapter, move, clear a condition, picker", teacher: false, office: true, flags: [] },
      view_all: { en: "Review progress", bn: "রিভিউয়ের অগ্রগতি দেখা", desc: "Inbox, progress, drill-downs, coverage, slices, any thread", teacher: false, office: true, flags: [] },
      review: { en: "Review questions", bn: "প্রশ্ন রিভিউ করা", desc: "Verdict (single/bulk); IMPORTANT on own rounds", teacher: true, office: false, flags: [], designation: "assigned_reviewer" },
      publish: { en: "Publish questions", bn: "প্রশ্ন প্রকাশ করা", desc: "Gold: single with override, bulk, publish-all", teacher: false, office: false, flags: [] },
    },
  },
  book_production: {
    group: "content_and_books",
    en: "Book production",
    bn: "বই তৈরি",
    actions: {
      view: { en: "View books", bn: "বই দেখা", desc: "Books, lessons, content, slots, rationale, rounds, comments, builds, files", teacher: false, office: false, flags: [] },
      create: { en: "Create a book", bn: "নতুন বই খোলা", desc: "Create a book (either line)", teacher: false, office: false, flags: [] },
      settings: { en: "Upload policy", bn: "নীতিমালা আপলোড করা", desc: "Activate a governance document version", teacher: false, office: false, flags: [] },
      assign: { en: "Assign book reviewer", bn: "বই রিভিউয়ার বরাদ্দ করা", desc: "Open a review round on a lesson", teacher: false, office: false, flags: [] },
      author: { en: "Submit content", bn: "বইয়ের লেখা জমা দেওয়া", desc: "Upload a patch; resolve own comment fixes", teacher: false, office: false, flags: [] },
      illustrate: { en: "Upload artwork", bn: "বইয়ের ছবি আপলোড করা", desc: "Slot images", teacher: false, office: false, flags: [] },
      review: { en: "Review a book", bn: "বই রিভিউ করা", desc: "Verdict, comment, raise/reply escalation", teacher: false, office: false, flags: [] },
      approve: { en: "Senior review & sign-off", bn: "সিনিয়র রিভিউ ও চূড়ান্ত সাইন-অফ", desc: "Rule on an escalation; sign off a lesson", teacher: false, office: false, flags: [] },
      assemble: { en: "Build and release", bn: "বই বিল্ড ও সংস্করণ প্রকাশ", desc: "Queue a render, export book.json, file an edition", teacher: false, office: false, flags: [] },
      override: { en: "Force a build", bn: "গেট উপেক্ষা করে বিল্ড", desc: "`force` past the assembly gate", teacher: false, office: false, flags: ["PRINCIPAL_DEFAULT"] },
    },
  },
  teaching_notes: {
    group: "content_and_books",
    en: "Notes & guides",
    bn: "নোট ও গাইড",
    actions: {
      view: { en: "Notes for my classes", bn: "আমার শ্রেণির নোট পড়া", desc: "Library for taught pairs, versions, thread, comment", teacher: true, office: true, flags: [] },
      view_all: { en: "Every note", bn: "সব নোট পড়া", desc: "Every class × subject", teacher: false, office: true, flags: [] },
      upload: { en: "Upload a note", bn: "নোট আপলোড", desc: "Upload/replace a version", teacher: false, office: true, flags: [] },
      send: { en: "Send to print", bn: "নোট প্রিন্টে পাঠানো", desc: "File a readable note to the print queue", teacher: true, office: true, flags: [] },
      review: { en: "Manage feedback", bn: "নোটের মন্তব্য সামলানো", desc: "Open list, address/reopen, delete any comment", teacher: false, office: true, flags: [] },
    },
  },
  english_drive: {
    group: "content_and_books",
    en: "English drive",
    bn: "ইংরেজি ড্রাইভ",
    actions: {
      view: { en: "My English classes' drive", bn: "আমার শ্রেণির ইংরেজি ড্রাইভ দেখা", desc: "Docs for my English classes; PDF", teacher: true, office: true, flags: [] },
      view_all: { en: "Whole drive", bn: "পুরো ইংরেজি ড্রাইভ দেখা", desc: "All five class levels", teacher: false, office: true, flags: [] },
      upload: { en: "Upload a document", bn: "ডকুমেন্ট আপলোড", desc: "Upload/replace", teacher: false, office: true, flags: [] },
      send: { en: "Edit & send to print", bn: "এডিট করে প্রিন্টে পাঠানো", desc: "Edit-before-print render; file to queue", teacher: true, office: true, flags: [] },
    },
  },
  worksheets: {
    group: "content_and_books",
    en: "Worksheet generator",
    bn: "প্রশ্ন ও অ্যাসাইনমেন্ট তৈরি",
    actions: {
      create: { en: "Make a worksheet", bn: "প্রশ্ন / অ্যাসাইনমেন্ট তৈরি", desc: "Plan, preview, PDF, picture bank, my worksheets", teacher: true, office: true, flags: [] },
      send: { en: "Send to print", bn: "প্রিন্টে পাঠানো", desc: "Regenerate from the seed; file to queue", teacher: true, office: true, flags: [] },
      edit_all: { en: "Make one for a teacher", bn: "শিক্ষকের পক্ষে তৈরি", desc: "Pick a routine teacher; open any stored paper", teacher: false, office: true, flags: [] },
      edit: { en: "Edit the picture bank", bn: "ছবির ভাণ্ডার সম্পাদনা", desc: "Tag, reserve, hide pictures; see hidden", teacher: false, office: true, flags: [] },
      settings: { en: "Worksheet plan", bn: "প্রশ্ন-পরিকল্পনা", desc: "Save generation plan and presets", teacher: false, office: true, flags: [] },
    },
  },
  chat: {
    group: "communication",
    en: "Staff chat & notices",
    bn: "বার্তা",
    actions: {
      view: { en: "Read messages", bn: "বার্তা পড়া", desc: "Own conversations, messages, mute, mark seen", teacher: true, office: true, flags: [] },
      send: { en: "Send messages", bn: "বার্তা পাঠানো", desc: "Open 1:1, send, forward, react, edit/delete own, attach", teacher: true, office: true, flags: [] },
      create: { en: "Create a group", bn: "নতুন গ্রুপ খোলা", desc: "Create a group conversation", teacher: false, office: true, flags: [] },
      edit: { en: "Manage groups", bn: "গ্রুপের সদস্য ও নিয়ম ঠিক করা", desc: "Members, posting policy, archive, resync", teacher: false, office: true, flags: [] },
      publish: { en: "Post in announcement groups", bn: "ঘোষণা-গ্রুপে লেখা", desc: "Bypass the ANNOUNCEMENT posting lock", teacher: false, office: true, flags: [] },
      send_notice: { en: "Notice to my section's guardians", bn: "নিজের শাখার অভিভাবকদের নোটিশ পাঠানো", desc: "SECTION notice for a section you class-teach", teacher: true, office: true, flags: [], designation: "class_teacher", waiver: "chat:send_notice_all" },
      send_notice_all: { en: "School-wide notice", bn: "পুরো স্কুল বা যেকোনো শাখায় নোটিশ", desc: "SCHOOL scope; any section", teacher: false, office: true, flags: [] },
      view_all: { en: "Oversee all conversations", bn: "সব কথোপকথনের তত্ত্বাবধান", desc: "Read any conversation incl. 1:1; audited open", teacher: false, office: false, flags: ["LOCKED"] },
    },
  },
  message_templates: {
    group: "communication",
    en: "Message templates",
    bn: "বার্তার টেমপ্লেট",
    actions: {
      view: { en: "See templates", bn: "বার্তার টেমপ্লেট দেখা", desc: "List, read, history", teacher: false, office: false, flags: ["LOCKED"] },
      edit: { en: "Edit / reset template", bn: "টেমপ্লেট সম্পাদনা ও আগের অবস্থায় ফেরানো", desc: "Save an override; reset", teacher: false, office: false, flags: ["LOCKED"] },
    },
  },
  notifications: {
    group: "communication",
    en: "My notifications",
    bn: "আমার নোটিফিকেশন",
    actions: {
      view: { en: "My notifications", bn: "আমার নোটিফিকেশন", desc: "Inbox, mark read, web push, push devices", teacher: true, office: true, flags: ["SELF"] },
    },
  },
  library: {
    group: "school_operations",
    en: "Library",
    bn: "লাইব্রেরি",
    actions: {
      view: { en: "Browse & my loans", bn: "বই খোঁজা, নিজের ধার করা বই ও সংরক্ষণ দেখা", desc: "Catalog, policies, librarians, own loans/reservations, self-reserve", teacher: true, office: true, flags: [] },
      lend: { en: "Issue / renew (desk)", bn: "বই ধার দেওয়া ও নবায়ন (ডেস্ক)", desc: "Issue, renew, reserve for others, borrower search, desk lists", teacher: true, office: true, flags: [], designation: "librarian" },
      return: { en: "Take returns / mark lost", bn: "বই ফেরত নেওয়া / হারানো হিসেবে লেখা", desc: "Return a loan; settle as lost", teacher: true, office: true, flags: [], designation: "librarian" },
      remind: { en: "Remind overdue borrowers", bn: "বই ফেরতের রিমাইন্ডার পাঠানো", desc: "Overdue chase list with wa.me", teacher: true, office: true, flags: [], designation: "librarian" },
      edit_all: { en: "Run the desk without a duty", bn: "লাইব্রেরিয়ানের দায়িত্ব ছাড়াই ডেস্ক চালানো", desc: "Waives the librarian designation for lend/return/remind", teacher: false, office: true, flags: [] },
      edit: { en: "Manage the catalog", bn: "ক্যাটালগে বই যোগ ও সংশোধন", desc: "Titles, copies, copy status", teacher: false, office: true, flags: [] },
      settings: { en: "Loan rules", bn: "ধারের নিয়ম ঠিক করা", desc: "Loan days, limits, renewals, hold days", teacher: false, office: true, flags: [] },
      assign: { en: "Assign librarian duty", bn: "লাইব্রেরিয়ানের দায়িত্ব বরাদ্দ", desc: "Give or revoke desk duty", teacher: false, office: true, flags: [] },
    },
  },
  printing: {
    group: "school_operations",
    en: "Printing",
    bn: "প্রিন্ট",
    actions: {
      create: { en: "Request printing", bn: "প্রিন্টের অনুরোধ করা", desc: "File, reprint, tag, cancel own requests; own history", teacher: true, office: false, flags: [] },
      view_all: { en: "Print queue", bn: "সব প্রিন্টের তালিকা দেখা", desc: "Queue, badge counts, everyone's history, any request; class-test print queue", teacher: false, office: true, flags: [] },
      process: { en: "Print & deliver", bn: "প্রিন্ট ও বিতরণ সম্পন্ন করা", desc: "Mark printed/delivered; cancel/tag/reprint any job; class-test printed/cancel", teacher: false, office: true, flags: [] },
    },
  },
  archive: {
    group: "school_operations",
    en: "Script archive",
    bn: "খাতার আর্কাইভ",
    actions: {
      view: { en: "Find scripts", bn: "খাতা কোথায় আছে দেখা", desc: "Boxes, bundles, lookup, checkouts, acks, cover PDF, photos", teacher: true, office: true, flags: [] },
      create: { en: "File scripts", bn: "খাতা জমা (ফাইল) করা", desc: "Record N scripts of test X in box Y; photos (desk path follows `approve`)", teacher: true, office: true, flags: [] },
      approve: { en: "Acknowledge filing", bn: "জমা খাতা গ্রহণ নিশ্চিত করা", desc: "Office ack; any-test filing with auto-ack", teacher: false, office: true, flags: [] },
      lend: { en: "Lend / take back", bn: "খাতা ধার দেওয়া ও ফেরত নেওয়া", desc: "Check a bundle out to staff; check it in", teacher: false, office: true, flags: [] },
      void: { en: "Cancel a wrong filing", bn: "ভুল জমা বাতিল করা", desc: "Void (record kept)", teacher: false, office: true, flags: [] },
      delete: { en: "Dispose after retention", bn: "মেয়াদ শেষে খাতা নষ্ট করা", desc: "Retention list; dispose", teacher: false, office: true, flags: [] },
      settings: { en: "Storage boxes", bn: "বাক্স যোগ / সংশোধন / বন্ধ করা", desc: "Register, edit, retire boxes", teacher: false, office: true, flags: [] },
    },
  },
  work_board: {
    group: "school_operations",
    en: "Work board",
    bn: "কাজের বোর্ড",
    actions: {
      view_all: { en: "Others' boards", bn: "সবার কাজের বোর্ড দেখা", desc: "Anyone's board, load grid, all templates, any task", teacher: false, office: true, flags: [] },
      assign: { en: "Assign work to others", bn: "অন্যকে কাজ দেওয়া", desc: "Tasks/recurring tasks for others; edit/move/cancel/reassign any", teacher: false, office: true, flags: [] },
      cover_desk: { en: "Cover the office desk", bn: "অফিসের কাজ নিজের বোর্ডে নেওয়া", desc: "Pull print or leave-approval cards onto own board", teacher: false, office: true, flags: [] },
      use: { en: "My board & tasks", bn: "নিজের কাজ", desc: "Own board, self-tasks, tasks I assigned", teacher: true, office: true, flags: ["SELF"] },
    },
  },
  admin_dashboard: {
    group: "school_operations",
    en: "Admin Today dashboard",
    bn: "অ্যাডমিন ড্যাশবোর্ড",
    actions: {
      view: { en: "Admin Today dashboard", bn: "আজকের অ্যাডমিন ড্যাশবোর্ড দেখা", desc: "School-wide day-at-a-glance cards", teacher: false, office: true, flags: [] },
    },
  },
  classes_sections: {
    group: "school_operations",
    en: "Classes & sections",
    bn: "শ্রেণি ও শাখা",
    actions: {
      create: { en: "Open a class", bn: "নতুন শ্রেণি খোলা", desc: "Create a class (+ default section)", teacher: false, office: true, flags: [] },
      merge_split: { en: "Merge / split section", bn: "শাখা একত্র করা / আলাদা করা", desc: "Combine or reverse; active merges", teacher: false, office: true, flags: [] },
      settings: { en: "Academic years", bn: "শিক্ষাবর্ষ যোগ ও চালু বছর বদলানো", desc: "Add a year; set the current year", teacher: false, office: true, flags: [] },
    },
  },
  teaching_assignments: {
    group: "school_operations",
    en: "Teaching assignments",
    bn: "শিক্ষক বরাদ্দ",
    actions: {
      assign_class_teacher: { en: "Assign class teacher", bn: "শ্রেণি শিক্ষক ও সহকারী শিক্ষক বরাদ্দ", desc: "Set/clear a section's class teacher; support teachers; history", teacher: false, office: true, flags: [] },
      assign_homework_checker: { en: "Assign homework confirmers", bn: "বাড়ির কাজ চূড়ান্ত করার দায়িত্ব বরাদ্দ", desc: "Confirm delegate per section; school-wide supervisor flag", teacher: false, office: true, flags: [] },
      assign_subject_teacher: { en: "Assign subject teacher", bn: "বিষয় শিক্ষক বরাদ্দ", desc: "Grant/revoke teaching scope; routine teacher read", teacher: false, office: false, flags: ["ESCALATION"] },
      assign_supervisor: { en: "Assign oversight", bn: "তদারকি (দেখার) দায়িত্ব বরাদ্দ", desc: "Grant/revoke supervisory read scope", teacher: false, office: false, flags: ["ESCALATION"] },
    },
  },
  access_control: {
    group: "admin_and_access",
    en: "Access control",
    bn: "অনুমতি নিয়ন্ত্রণ",
    actions: {
      edit: { en: "Role & per-person permissions", bn: "ভূমিকা ও জনপ্রতি অনুমতি সাজানো", desc: "Roles tab, templates, per-user grant/revoke, effective access", teacher: false, office: false, flags: ["LOCKED"] },
      delegate: { en: "Delegated duties", bn: "বাড়তি দায়িত্ব (ডেলিগেশন) দেওয়া", desc: "Grant/revoke a delegation; list them", teacher: false, office: false, flags: ["LOCKED"] },
    },
  },
  view_as: {
    group: "admin_and_access",
    en: "View as another account",
    bn: "অন্যের অ্যাকাউন্ট দেখা",
    actions: {
      open: { en: "View as another account", bn: "অন্যের অ্যাকাউন্ট তার চোখে দেখা", desc: "Short-lived borrowed session (never the Principal)", teacher: false, office: false, flags: [] },
    },
  },
  staff_logins: {
    group: "admin_and_access",
    en: "Staff logins",
    bn: "কর্মীদের লগইন",
    actions: {
      view: { en: "See staff logins", bn: "কর্মীদের লগইন তালিকা দেখা", desc: "All staff accounts; credential candidates", teacher: false, office: false, flags: [] },
      create: { en: "Create a staff login", bn: "কর্মীর লগইন তৈরি", desc: "Provision from a staff record; email account", teacher: false, office: false, flags: ["ESCALATION"] },
      reset_password: { en: "Reset staff password", bn: "কর্মীর পাসওয়ার্ড রিসেট", desc: "New password, re-activate, clear lockout", teacher: false, office: false, flags: ["ESCALATION"] },
    },
  },
  audit_log: {
    group: "admin_and_access",
    en: "Audit log",
    bn: "অডিট লগ",
    actions: {
      view: { en: "Audit log", bn: "অডিট লগ দেখা", desc: "The school-wide event log", teacher: false, office: false, flags: [] },
      view_activity: { en: "One person's activity", bn: "একজনের কাজের ইতিহাস দেখা", desc: "A person's timeline", teacher: false, office: false, flags: [] },
    },
  },
  system_health: {
    group: "admin_and_access",
    en: "System health",
    bn: "সিস্টেমের অবস্থা",
    actions: {
      view: { en: "System health", bn: "সার্ভার ও স্টোরেজের অবস্থা দেখা", desc: "Storage, disk, egress, ticker, backups", teacher: false, office: false, flags: [] },
    },
  },
  guardian_engagement: {
    group: "admin_and_access",
    en: "Guardian app usage",
    bn: "অভিভাবকদের অ্যাপ ব্যবহার",
    actions: {
      view: { en: "Guardian app usage", bn: "অভিভাবকদের অ্যাপ ব্যবহারের রিপোর্ট দেখা", desc: "Logins, views, inbox reads per family", teacher: false, office: false, flags: [] },
    },
  },
  my_account: {
    group: "admin_and_access",
    en: "My account",
    bn: "আমার অ্যাকাউন্ট",
    actions: {
      view: { en: "My account", bn: "আমার অ্যাকাউন্ট", desc: "me, my permissions/templates/scopes, my class teacher section, session refresh, end View-as", teacher: true, office: true, flags: ["SELF"] },
    },
  },
} as const satisfies Record<string, CatalogueFeature>;

export type FeatureKey = keyof typeof FEATURE_CATALOGUE;
type Cat = typeof FEATURE_CATALOGUE;
/** Every catalogued permission, `feature:action`. */
export type CataloguePermission = {
  [F in FeatureKey]: `${F}:${keyof Cat[F]["actions"] & string}`;
}[FeatureKey];

/** The catalogued permissions in catalogue order. */
export const CATALOGUE_PERMISSIONS: readonly CataloguePermission[] = (Object.keys(FEATURE_CATALOGUE) as FeatureKey[]).flatMap(
  (f) => Object.keys(FEATURE_CATALOGUE[f].actions).map((a) => `${f}:${a}` as CataloguePermission),
);

/** Look up one action's definition. */
export function catalogueAction(perm: CataloguePermission): CatalogueAction {
  const [f, a] = perm.split(":") as [FeatureKey, string];
  return (FEATURE_CATALOGUE[f].actions as Record<string, CatalogueAction>)[a];
}

/** Old (pre-PM) permission → the catalogue actions it covered (docs/permission-catalogue/
 *  legacy-expansion.md table 1). `any` applies wherever the old permission is held;
 *  `adminTemplate` only when the holder also acts as PRINCIPAL or OFFICE (it covered that
 *  part only together with an isAdminStaff check). Used to expand per-user grants/revokes
 *  still stored under old names (read-time, D-#795) and by the ship-day equality check. */
export const LEGACY_PERMISSION_EXPANSION: Record<string, { any: readonly CataloguePermission[]; adminTemplate?: readonly CataloguePermission[] }> = {
  "mastery:read": { any: ["mastery:view"] },
  "mastery:enter": { any: ["mastery:enter_results", "mastery:create"] },
  "mastery:manage": { any: ["mastery:settings", "mastery:delete"] },
  "mastery:approve": { any: ["mastery:approve"] },
  "content:read": { any: ["lesson_plans:view"] },
  "content:import": { any: ["lesson_plans:import","question_bank:import"] },
  "content:assign_review": { any: ["plan_review:assign","question_review:assign","question_review:view_all"] },
  "content:review": { any: ["plan_review:review","question_review:review"] },
  "content:promote_gold": { any: ["plan_review:approve","question_review:publish"] },
  "question:read": { any: ["question_bank:view"] },
  "question:select": { any: ["question_sets:create"] },
  "question:manage": { any: ["question_bank:edit","question_bank:delete"] },
  "set:read": { any: ["question_sets:view","question_sets:export"] },
  "set:assemble": { any: ["question_sets:create"] },
  "set:export": { any: [] },
  "tracker:read": { any: ["homework:view","assignment:view","assignment_gift:view","class_test:view","class_test_script:view","set_tracker:view","student_profile:view","student_profile:export","saturday_revision:view","vocab_test:view","monthly_report:view","archive:view"] },
  "tracker:write": { any: ["homework:declare","homework:issue","homework:mark_submitted","homework:check","homework:return","homework:confirm_day","homework:undo","assignment:declare","assignment:issue","assignment:mark_submitted","assignment:check","assignment:resubmit","assignment:return","assignment:undo","work_claim:reject","class_test:view","class_test:create","class_test:register","class_test:edit","class_test:enter_results","class_test_question:create","class_test_script:return","set_tracker:enter_results","saturday_revision:enter_results","saturday_revision:send","vocab_test:edit","vocab_test:create","vocab_test:enter_results","student_comments:create","parents_meeting:write_notes","printing:create","archive:create","worksheets:create","worksheets:send"] },
  "tracker:export": { any: [] },
  "gift:manage": { any: ["assignment_gift:view","assignment_gift:view_all","assignment_gift:issue"] },
  "homework:void": { any: ["homework:delete"] },
  "routine:read": { any: ["routine:view","class_note:view","class_note:create","class_note:edit"] },
  "routine:manage": { any: ["routine:view_all","routine:edit","routine:edit_calendar","routine:settings","cover:assign","class_note:view_all","class_note:edit_all","class_note:delete"] },
  "attendance:mark": { any: ["attendance:mark"] },
  "attendance:manage": { any: ["attendance:view","attendance:view_all","attendance:edit","attendance:assign","attendance:record_leave","attendance:remind","staff_attendance:upload","staff_attendance:view_all"] },
  "library:read": { any: ["library:view"] },
  "library:manage": { any: ["library:lend","library:return","library:remind","library:edit_all","library:edit","library:settings","library:assign"] },
  "chat:read": { any: ["chat:view"] },
  "chat:write": { any: ["chat:send","chat:send_notice"] },
  "chat:manage": { any: ["chat:create","chat:edit","chat:publish","chat:send_notice_all"] },
  "chat:oversee": { any: ["chat:view_all"] },
  "roster:manage": { any: ["students:view_all","students:create","students:edit","classes_sections:create","classes_sections:merge_split","classes_sections:settings","teaching_assignments:assign_class_teacher","teaching_assignments:assign_homework_checker","assignment:settings","assignment:view_reports","assignment:confirm_week","class_test:edit_all","class_test:delete","class_test:publish","class_test:revoke","class_test_question:prepare","class_test_question:delete","class_test_script:view","class_test_script:scan","class_test_script:publish","class_test_script:hand_back","printing:view_all","printing:process","archive:view","archive:create","archive:approve","archive:lend","archive:void","archive:delete","archive:settings","vocab_test:assign","student_comments:review","student_comments:send","parents_meeting:view","parents_meeting:create","parents_meeting:send","parents_meeting:mark_attendance","parents_meeting:assign","parents_meeting:review","parents_meeting:view_brief","improvement_plan:view_all","improvement_plan:create","improvement_plan:edit","improvement_plan:assign","improvement_plan:edit_all","teaching_notes:upload","teaching_notes:review","english_drive:upload","worksheets:create","worksheets:send","worksheets:edit_all","worksheets:edit","worksheets:settings"] },
  "staff:manage": { any: ["staff_records:view","staff_records:create","staff_records:edit","staff_records:confirm","staff_letters:view","staff_letters:issue","staff_letters:void","offboarding:view","offboarding:create","offboarding:edit","offboarding:revoke","offboarding:issue","offboarding:cancel"] },
  "leave:manage": { any: ["leave:view_all","leave:approve","leave:create","leave:settings","cover:view_all","cover:approve"] },
  "payroll:manage": { any: ["payroll:view","payroll:edit","payroll:prepare","payroll:export","salary_advance:view","hr_policy:view","hr_policy:settings","offboarding:prepare"] },
  "payroll:approve": { any: ["payroll:approve","salary_advance:issue","salary_advance:settle","offboarding:settle"] },
  "performance:manage": { any: ["appraisal:view_all","appraisal:observe","appraisal:prepare","appraisal:log_cpd","conduct:view_all","conduct:create","conduct:record_hearing","grievance:view_all","grievance:resolve"] },
  "performance:signoff": { any: ["appraisal:sign_off","conduct:sign_off"] },
  "guardian:link": { any: ["guardians:view_all","guardians:create","guardians:link","guardians:reset_password"] },
  "message:dispatch": { any: ["set_tracker:remind","vocab_test:send"], adminTemplate: ["assignment:remind","class_test:remind","saturday_revision:remind"] },
  "user:manage": { any: ["staff_logins:view","staff_logins:create","staff_logins:reset_password","teaching_assignments:assign_subject_teacher","teaching_assignments:assign_supervisor","cover:assign_proxy"] },
  "user:view_as": { any: ["view_as:open"] },
  "audit:read": { any: ["audit_log:view","audit_log:view_activity","system_health:view","guardian_engagement:view"] },
  "template:manage": { any: ["message_templates:view","message_templates:edit"] },
  "access:manage": { any: ["access_control:edit","access_control:delegate"] },
  "observation:upload": { any: ["classroom_observation:upload","classroom_observation:assign","free_mixing_review:assign"], adminTemplate: ["classroom_observation:view_all"] },
  "observation:review": { any: ["classroom_observation:review","free_mixing_review:review"] },
  "observation:read": { any: ["classroom_observation:view"] },
  "observation:manage": { any: ["classroom_observation:assign","classroom_observation:edit","classroom_observation:publish","classroom_observation:schedule","classroom_observation:settings","classroom_observation:view_reports","free_mixing_review:view_all"] },
  "finance:manage": { any: ["finance_ledger:view","finance_ledger:create","finance_ledger:reverse","finance_ledger:settings","finance_ledger:remind","finance_reports:view","budget:view","budget:edit","fee_support:view","fee_support:edit","fee_support:create","qard:view","qard:create","qard:edit","reconciliation:view","reconciliation:create"] },
  "report:release": { any: [], adminTemplate: ["monthly_report:view_all","monthly_report:create","monthly_report:export","monthly_report:release"] },
  "book:read": { any: ["book_production:view"] },
  "book:author": { any: ["book_production:author"] },
  "book:illustrate": { any: ["book_production:illustrate"] },
  "book:review": { any: ["book_production:review"] },
  "book:review_senior": { any: ["book_production:approve"] },
  "book:assemble": { any: ["book_production:assemble"] },
  "book:manage": { any: ["book_production:create","book_production:settings","book_production:assign"] },
  "exam:manage": { any: ["exam_syllabus:settings","exam_syllabus:edit"], adminTemplate: ["exam_syllabus:view_all"] },
  "exam:read": { any: ["exam_syllabus:view"] },
  "scholarship:manage": { any: ["scholarship_practice:create","scholarship_practice:enter_results","scholarship_practice:settings"], adminTemplate: ["scholarship_practice:delete","scholarship_practice:select_candidates","scholarship_practice:edit_all"] },
  "scholarship:read": { any: ["scholarship_practice:view"] },
  "tasks:assign": { any: ["work_board:view_all","work_board:assign","work_board:cover_desk"] },
};

/** Delegated duty → the catalogue actions it covers today (D-#592 "a duty covers its whole
 *  tail"). The delegate must ALSO hold each of these to act (D-#484/#794): a delegation
 *  widens WHERE, never WHAT. */
export const DELEGATED_ACTION_PERMISSIONS: Record<string, readonly CataloguePermission[]> = {
  declare_homework: ["homework:declare","homework:undo"],
  submit_homework: ["homework:mark_submitted","homework:undo"],
  check_homework: ["homework:check","homework:return","homework:undo"],
  declare_assignment: ["assignment:declare","assignment:issue","assignment:undo"],
  submit_assignment: ["assignment:mark_submitted","assignment:undo"],
  check_assignment: ["assignment:check","assignment:resubmit","assignment:return","assignment:declare","assignment:undo"],
  enter_classtest_result: ["class_test:enter_results"],
  confirm_homework_day: ["homework:confirm_day"],
};
