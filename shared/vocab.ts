// =============================================================================
// SCHOOLSW — /shared controlled-vocabulary enums + role→permission map
// -----------------------------------------------------------------------------
// Doc ID : SCHOOLSW-SHARED-VOCAB
// Version: v1.0 (LOCKED 2026-06-09, D-PROJ04-005) — Project-04 ratification of the question payload (R-IMP5):
//          QuestionType confirmed; PaperRole added (MIRRORED); DocType += "stimulus".
// Owner  : Principal
// Path   : monorepo `/shared/vocab.ts`  (REQ §8, ARCH §2)
// Sources: REQ §5 (R-AC1 RBAC, R-AC2 PoLP, R-AC3 row-scope), §4 R-IMP1 outer
//          contract; ARCH ADR-004 (resolver authz), ADR-005 (two planes/firewall);
//          docs/import-contract.schema.json (the wire-contract enums).
//
// WHAT THIS FILE IS
//   The single TypeScript source of truth for (A) the app's controlled vocabulary
//   and (B) the action-level RBAC map. `/app` UI, `/server` resolvers, and the
//   codegen layer all import from here. `as const` arrays give both runtime values
//   (dropdowns, validation, label lookup) and compile-time union types, so a change
//   here is a compile-time break across all three clients (R-API1), not a runtime
//   crash on a teacher's phone.
//
// WHAT THIS FILE IS NOT
//   - Not the enforcement layer. RBAC here is *grants only*; row-scope and the
//     plane boundary are enforced in resolvers (ADR-004). SCOPE_RULES below is the
//     coordination reference the resolver layer reads, not a runtime guard.
//   - Not the wire contract. The envelope JSON Schema is a SEPARATE source of truth
//     for what arrives at import. The two MUST agree — see "TWO-PLACE SYNC" below.
//
// TWO-PLACE SYNC (do not skip)
//   Any add/rename to a MIRRORED enum (Subject, DocType, CurationTag, BloomLevel,
//   Difficulty, QuestionType, PaperRole, ReviewStatus, SourceProject, AnchorWord) is a
//   two-place edit: this file AND docs/import-contract.schema.json (and the
//   harness consistency() gate). The shipped verifier (verify_shared_vocab.mjs)
//   fails CI if they drift. App-native vocab (SetType, TrackerKind, Role,
//   Permission, Section default) lives ONLY here — it has no wire-contract twin.
//
// HOW TO EXTEND (stepwise)
//   1. Add the value to the relevant `as const` array below.
//   2. If it is a MIRRORED enum, make the matching edit in the envelope schema +
//      harness, then re-run the verifier.
//   3. If it is a new Permission, add it to PERMISSIONS, grant it to roles in
//      ROLE_PERMISSIONS, and set PERMISSION_BUILD_STATUS (build | pipeline).
//   4. Add a Bangla label in the relevant LABELS_BN map if the value is surfaced
//      in the UI (NFR-5: Bangla labels, English codes).
//   5. Re-run `tsc --noEmit` + the verifier; both must be green before commit.
//
// THE FIREWALL (ADR-005) — read once
//   NONE of the permissions below grant corpus/analytics-plane access to identity.
//   The analytics/export resolvers are wired to the corpus plane and have no
//   resolver path to students/guardians/users. That isolation is structural, not a
//   permission; the fail-closed firewall test (NFR-11) asserts it. Do not add an
//   "analytics:*" permission that reaches identity — it would defeat R-X8/R-AC4.
// =============================================================================


// =============================================================================
// SECTION A — CONTROLLED VOCABULARY
// =============================================================================

// --- A.1 MIRRORED ENUMS (must match the envelope JSON Schema) ----------------

/** Subject codes. MIRROR of envelope `subject`. */
export const SUBJECTS = ["BAN", "ENG", "MATH", "SCI", "BGS"] as const;
export type Subject = (typeof SUBJECTS)[number];

/** Class levels C1–C5 (one evolving plan schema spans all, R-IMP2). Range, not enum.
 *  CONTENT axis: curriculum content is authored for C1–C5 only. MIRROR of the LOCKED
 *  envelope `class_level` (1..5) — do NOT widen these to fit roster pre-primary classes
 *  (Nursery/KG); the roster uses its own range below (ROSTER_CLASS_LEVELS). */
export const CLASS_LEVELS = [1, 2, 3, 4, 5] as const;
export type ClassLevel = (typeof CLASS_LEVELS)[number];
export const CLASS_LEVEL_MIN = 1;
export const CLASS_LEVEL_MAX = 5;

/** ROSTER axis: the school enrolls pre-primary classes (Nursery, KG) that carry NO
 *  curriculum content. A SUPERSET of the content range — One..Five keep 1..5 so content
 *  class_level stays meaningful; KG=0 and Nursery=-1 sit below. Identity-plane only;
 *  never mirrored into the envelope contract (see DECISIONS roster-vs-content note). */
export const ROSTER_CLASS_LEVELS = [-1, 0, 1, 2, 3, 4, 5] as const;
export type RosterClassLevel = (typeof ROSTER_CLASS_LEVELS)[number];
export const ROSTER_CLASS_LEVEL_MIN = -1;
export const ROSTER_CLASS_LEVEL_MAX = 5;

/** Bangla display labels for every roster class level. */
export const ROSTER_CLASS_LABELS_BN: Record<RosterClassLevel, string> = {
  [-1]: "নার্সারি",
  [0]: "কেজি",
  [1]: "প্রথম শ্রেণি",
  [2]: "দ্বিতীয় শ্রেণি",
  [3]: "তৃতীয় শ্রেণি",
  [4]: "চতুর্থ শ্রেণি",
  [5]: "পঞ্চম শ্রেণি",
};

/** Import doc types. MIRROR of envelope `doc_type`. `question_set` is reserved
 *  (sets are app-generated by REQ-ASSEMBLE; here only for possible bulk import).
 *  `stimulus` is a shared passage/poem/audio-script/image-set referenced by questions (QDN-09). */
export const DOC_TYPES = ["chapter_plan", "session_plan", "question", "question_set", "stimulus"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const PLAN_DOC_TYPES = ["chapter_plan", "session_plan"] as const;
export type PlanDocType = (typeof PLAN_DOC_TYPES)[number];

/** Curation tag. MIRROR of envelope `curation_tag`. Authored upstream; advisory at import (D-#4). */
export const CURATION_TAGS = ["KEEP_AS_IS", "NEEDS_REPLACEMENT", "FLEXIBLE"] as const;
export type CurationTag = (typeof CURATION_TAGS)[number];

/** Canonical English Bloom levels for app indexing. MIRROR of envelope `bloomLevelEN`.
 *  Bangla Bloom display wording is owned by the curriculum reference (REF-17/18),
 *  NOT redefined here — see note under LABELS_BN. */
export const BLOOM_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"] as const;
export type BloomLevel = (typeof BLOOM_LEVELS)[number];

/** Difficulty. MIRROR of envelope `tags.difficulty` / `questionPayload.difficulty`. */
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Question types. MIRROR of envelope `questionPayload.question_type`.
 *  RATIFIED by Project 04 (R-IMP5): the six values are confirmed unchanged and the
 *  question payload is now closed (QuestionPayload_v1.json, additionalProperties:false). */
export const QUESTION_TYPES = ["mcq", "short_answer", "true_false", "fill_blank", "matching", "descriptive"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Paper-section family (REF-09 §4/§5.3) — a SEPARATE axis from QuestionType (a true_false
 *  item may serve paper_role 'mcq'). The app filter for set assembly. MIRRORED — matches
 *  envelope `tags.paper_role` / `questionPayload.paper_role` (two-place sync). Values overlap
 *  QuestionType only incidentally ('mcq'); the two enums are distinct. */
export const PAPER_ROLES = ["mcq", "short", "structured", "creative"] as const;
export type PaperRole = (typeof PAPER_ROLES)[number];

/** Quality gate. MIRROR of envelope `review_status`. Export/analytics filter on this (D-#3). */
export const REVIEW_STATUSES = ["draft", "reviewed", "gold"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Originating curriculum Project. MIRROR of envelope `provenance.source_project`. */
export const SOURCE_PROJECTS = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "other"] as const;
export type SourceProject = (typeof SOURCE_PROJECTS)[number];

/** Address anchor words. MIRROR of envelope `addressBlock.anchor_word`.
 *  The authoritative subject↔anchor mapping lives in the Project-03 plan schema +
 *  the import harness; SUBJECT_ANCHORS below mirrors only what the envelope schema
 *  states and is a display/UI convenience, not the authority. */
export const ANCHOR_WORDS = ["পাঠ", "অধ্যায়", "Unit", "Lesson"] as const;
export type AnchorWord = (typeof ANCHOR_WORDS)[number];

// --- A.2 APP-NATIVE ENUMS (canonical here; no wire-contract twin) ------------

/** Assessment set types (REQ-ASSEMBLE R-A2): Homework / Assignment / Class-Test. */
export const SET_TYPES = ["HW", "AS", "CT"] as const;
export type SetType = (typeof SET_TYPES)[number];

/** Tracker kinds (ARCH §4; REQ-TRACK). `generic` is the extensible pattern (R-T4). */
export const TRACKER_KINDS = ["classtest", "assignment", "homework", "generic"] as const;
export type TrackerKind = (typeof TRACKER_KINDS)[number];

/** Plan-review verdicts (D-#38/#39) — a teacher reviewer's call on an assigned plan.
 *  APPROVE drives the artifact `draft → reviewed`; CHANGES_REQUESTED leaves it `draft`
 *  (the admin re-imports a revision and reassigns). App-native — no wire-contract twin. */
export const REVIEW_VERDICTS = ["APPROVE", "CHANGES_REQUESTED"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/** Default section auto-created per class (D-#1). Code stays "Main"; UI shows the label. */
export const DEFAULT_SECTION_CODE = "Main" as const;

// --- A.3 DERIVED CONVENIENCE MAPS --------------------------------------------

/** A CT set feeds the class-test tracker, AS→assignment, HW→homework (R-T1..3 / R-A2). */
export const SET_TYPE_TO_TRACKER: Record<SetType, Extract<TrackerKind, "classtest" | "assignment" | "homework">> = {
  CT: "classtest",
  AS: "assignment",
  HW: "homework",
};

/** Subject→anchor convenience mirror of the envelope-schema note (BAN→পাঠ, MATH/SCI→অধ্যায়,
 *  ENG→Unit|Lesson). NOTE: BGS is NOT specified in the loaded wire contract or plan schema;
 *  left out deliberately until confirmed upstream rather than guessed. The harness remains
 *  the authority for the full check. */
export const SUBJECT_ANCHORS: Partial<Record<Subject, readonly AnchorWord[]>> = {
  BAN: ["পাঠ"],
  MATH: ["অধ্যায়"],
  SCI: ["অধ্যায়"],
  ENG: ["Unit", "Lesson"],
  // BGS: UNCONFIRMED — do not invent; confirm against the Project-03 plan schema.
};

// --- A.4 BANGLA DISPLAY LABELS (NFR-5: Bangla labels, English codes) ----------
// Operational vocabulary the UI surfaces. Bloom Bangla wording is intentionally
// absent: it is a curriculum-governed string (REF-17/18), and duplicating it here
// would create a second source of truth that could drift. The app indexes Bloom by
// the English code; if a Bangla Bloom label is needed on screen, source it from the
// curriculum reference, do not hardcode it here.

export const SUBJECT_LABELS_BN: Record<Subject, string> = {
  BAN: "বাংলা",
  ENG: "ইংরেজি",
  MATH: "গণিত",
  SCI: "বিজ্ঞান",
  BGS: "বাংলাদেশ ও বিশ্বপরিচয়",
};

export const DOC_TYPE_LABELS_BN: Record<DocType, string> = {
  chapter_plan: "অধ্যায় পরিকল্পনা",
  session_plan: "সেশন পরিকল্পনা",
  question: "প্রশ্ন",
  question_set: "প্রশ্নসেট",
  stimulus: "উদ্দীপক",
};

export const CURATION_TAG_LABELS_BN: Record<CurationTag, string> = {
  KEEP_AS_IS: "অপরিবর্তিত রাখুন",
  NEEDS_REPLACEMENT: "প্রতিস্থাপন প্রয়োজন",
  FLEXIBLE: "নমনীয়",
};

export const DIFFICULTY_LABELS_BN: Record<Difficulty, string> = {
  easy: "সহজ",
  medium: "মাঝারি",
  hard: "কঠিন",
};

export const PAPER_ROLE_LABELS_BN: Record<PaperRole, string> = {
  mcq: "বহুনির্বাচনি",
  short: "সংক্ষিপ্ত",
  structured: "কাঠামোবদ্ধ",
  creative: "সৃজনশীল",
};

export const REVIEW_STATUS_LABELS_BN: Record<ReviewStatus, string> = {
  draft: "খসড়া",
  reviewed: "পর্যালোচিত",
  gold: "চূড়ান্ত", // Principal-locked
};

export const REVIEW_VERDICT_LABELS_BN: Record<ReviewVerdict, string> = {
  APPROVE: "অনুমোদন",
  CHANGES_REQUESTED: "পরিবর্তন প্রয়োজন",
};

export const SET_TYPE_LABELS_BN: Record<SetType, string> = {
  HW: "বাড়ির কাজ",
  AS: "অ্যাসাইনমেন্ট",
  CT: "শ্রেণি পরীক্ষা",
};

export const TRACKER_KIND_LABELS_BN: Record<TrackerKind, string> = {
  classtest: "শ্রেণি পরীক্ষা",
  assignment: "অ্যাসাইনমেন্ট",
  homework: "বাড়ির কাজ",
  generic: "সাধারণ",
};

export const DEFAULT_SECTION_LABEL_BN = "মূল" as const;

// --- A.5 HR / STAFF-LIFECYCLE ENUMS (app-native; HR module — prd-hr §9, HR-1) -
// These have NO wire-contract twin (identity/operational plane only, behind the
// ADR-005 firewall), so they live ONLY here — no envelope-schema mirror, no
// two-place sync. HR_CATEGORY is a StaffProfile field that drives defaults/
// reporting; it is NOT an auth role (roles stay PRINCIPAL/TEACHER/OFFICE, D-#17).

/** HR category — extensible StaffProfile field (prd-hr §2.2). */
export const HR_CATEGORIES = ["teacher", "assistant_hifz", "office_accounts", "support"] as const;
export type HrCategory = (typeof HR_CATEGORIES)[number];

export const HR_CATEGORY_LABELS_BN: Record<HrCategory, string> = {
  teacher: "শিক্ষক",
  assistant_hifz: "সহকারী / হিফজ",
  office_accounts: "অফিস ও হিসাব",
  support: "সহায়ক কর্মী",
};

/** Employment type — scales leave/pay defaults (prd-hr §2.4). */
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "fixed_term"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS_BN: Record<EmploymentType, string> = {
  full_time: "পূর্ণকালীন",
  part_time: "খণ্ডকালীন",
  fixed_term: "নির্দিষ্ট মেয়াদি",
};

/** Employment status — lifecycle gate; feeds offboarding (prd-hr §2.4/§6). Independent
 *  of type. The first four are the §2.4 lifecycle; `retired` + `contract_ended` are the
 *  two exit states HR-5 needs so each H6.1 trigger maps to a status (resignation→resigned,
 *  termination→terminated, retirement→retired, fixed_term_end→contract_ended, D-#117). */
export const EMPLOYMENT_STATUSES = ["probation", "confirmed", "resigned", "terminated", "retired", "contract_ended"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const EMPLOYMENT_STATUS_LABELS_BN: Record<EmploymentStatus, string> = {
  probation: "শিক্ষানবিশ",
  confirmed: "স্থায়ী",
  resigned: "পদত্যাগী",
  terminated: "অব্যাহতিপ্রাপ্ত",
  retired: "অবসরপ্রাপ্ত",
  contract_ended: "চুক্তি সমাপ্ত",
};

// --- A.5b HR LEAVE ENUMS (app-native; HR module step 2 — prd-hr §3/H2, D-#22/#23) ----
// Staff LEAVE is the source AT-1 left missing (the ✘→LEAVE-vs-ABSENT split needs it).
// Identity/operational plane, behind the ADR-005 firewall — NO wire-contract twin,
// NO envelope-schema mirror, NO two-place sync; only /shared + the vocab verifier run.

/** Staff leave types (prd-hr §3.2). Maternity is UNPAID by Principal ruling
 *  (D-#23, legal check pending H7.5); Hajj unpaid/event-capped; unpaid_lwp is the
 *  overflow bucket (the exceed-rule lands here, §3.3). */
export const LEAVE_TYPES = ["casual", "sick", "bereavement", "maternity", "hajj", "unpaid_lwp"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_TYPE_LABELS_BN: Record<LeaveType, string> = {
  casual: "নৈমিত্তিক", sick: "অসুস্থতাজনিত", bereavement: "শোক", maternity: "মাতৃত্বকালীন",
  hajj: "হজ", unpaid_lwp: "বিনা বেতনে (LWP)",
};
export const LEAVE_TYPE_LABELS_EN: Record<LeaveType, string> = {
  casual: "Casual", sick: "Sick", bereavement: "Bereavement", maternity: "Maternity",
  hajj: "Hajj", unpaid_lwp: "Unpaid (LWP)",
};

/** The SETTLED §3.2 per-type behaviour table (the numbers are parked, the rules are
 *  not). `paid` drives the day-rate deduction (HR-3); `balanceTracked` types draw a
 *  per-year entitlement (allowance/taken/remaining); `carryover`/`encashable` feed
 *  the §3.4 paths; `eventCapped` types (maternity/hajj) are per-event, not annual. */
export const LEAVE_TYPE_RULES: Record<
  LeaveType,
  { paid: boolean; balanceTracked: boolean; carryover: boolean; encashable: boolean; eventCapped: boolean }
> = {
  casual:      { paid: true,  balanceTracked: true,  carryover: true,  encashable: true,  eventCapped: false },
  sick:        { paid: true,  balanceTracked: true,  carryover: true,  encashable: true,  eventCapped: false },
  bereavement: { paid: true,  balanceTracked: true,  carryover: true,  encashable: true,  eventCapped: false },
  maternity:   { paid: false, balanceTracked: false, carryover: false, encashable: false, eventCapped: true  }, // D-#23
  hajj:        { paid: false, balanceTracked: false, carryover: false, encashable: false, eventCapped: true  },
  unpaid_lwp:  { paid: false, balanceTracked: false, carryover: false, encashable: false, eventCapped: false },
};

/** Leave application lifecycle (prd-hr §9). Recorded → Principal/Office decide;
 *  the exceed rule WARNS, never blocks (§3.3) — approval can still proceed with the
 *  excess as unpaid. */
export const LEAVE_STATUSES = ["applied", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LEAVE_STATUS_LABELS_BN: Record<LeaveStatus, string> = {
  applied: "আবেদিত", approved: "অনুমোদিত", rejected: "প্রত্যাখ্যাত", cancelled: "বাতিল",
};
export const LEAVE_STATUS_LABELS_EN: Record<LeaveStatus, string> = {
  applied: "Applied", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled",
};

/** Cover-slot status (prd-hr §3.5, D-#22). A leave fans out one slot per class the
 *  absent teacher teaches; each is `needs_cover` until a teacher is `proposed`, and
 *  becomes `approved` only on Principal/Office approval — that approval is what mints
 *  the D-#20 proxy grant (write access begins). */
export const COVER_SLOT_STATUSES = ["needs_cover", "proposed", "approved"] as const;
export type CoverSlotStatus = (typeof COVER_SLOT_STATUSES)[number];

export const COVER_SLOT_STATUS_LABELS_BN: Record<CoverSlotStatus, string> = {
  needs_cover: "কভার প্রয়োজন", proposed: "প্রস্তাবিত", approved: "অনুমোদিত",
};
export const COVER_SLOT_STATUS_LABELS_EN: Record<CoverSlotStatus, string> = {
  needs_cover: "Needs cover", proposed: "Proposed", approved: "Approved",
};

// --- A.5c HR PAYROLL ENUMS (app-native; HR module step 3 — prd-hr §4/H4, D-#26/#27) -
// Identity/operational plane, behind the ADR-005 firewall — NO wire-contract twin,
// NO envelope-schema mirror, NO two-place sync; only /shared + the vocab verifier run.

/** How a staff member is paid (prd-hr §4.6). Cash-paid staff are flagged + EXCLUDED
 *  from the bank/bKash payment-export file. */
export const PAYMENT_METHODS = ["bank", "bkash", "cash"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS_BN: Record<PaymentMethod, string> = {
  bank: "ব্যাংক", bkash: "বিকাশ", cash: "নগদ",
};
export const PAYMENT_METHOD_LABELS_EN: Record<PaymentMethod, string> = {
  bank: "Bank", bkash: "bKash", cash: "Cash",
};

/** Monthly run lifecycle (prd-hr §4.2). Office PREPARES → Principal APPROVES → the
 *  run is `approved_locked` (immutable; payslips + payment export issue only from it).
 *  A prepared run may be recomputed or `cancelled` before approval; a locked run is
 *  NEVER retro-edited — post-lock corrections ride arrears lines on the NEXT run (D-#110). */
export const PAYROLL_RUN_STATUSES = ["prepared", "approved_locked", "cancelled"] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const PAYROLL_RUN_STATUS_LABELS_BN: Record<PayrollRunStatus, string> = {
  prepared: "প্রস্তুত", approved_locked: "অনুমোদিত ও লকড", cancelled: "বাতিল",
};
export const PAYROLL_RUN_STATUS_LABELS_EN: Record<PayrollRunStatus, string> = {
  prepared: "Prepared", approved_locked: "Approved & locked", cancelled: "Cancelled",
};

/** Deduction lines (prd-hr §4.3, D-#26). `unpaid_leave` (day-rate × LWP days) is the
 *  ONLY always-on attendance-driven deduction; `lateness` is the optional
 *  Principal-configurable rule (off by default, parameters parked); `statutory` is a
 *  confirm-with-accountant placeholder (no rates baked in); `advance_repayment` ties to
 *  the qard-hasan ledger; `other` carries arrears clawbacks / manual corrections. */
export const PAY_DEDUCTION_TYPES = ["unpaid_leave", "advance_repayment", "lateness", "statutory", "other"] as const;
export type PayDeductionType = (typeof PAY_DEDUCTION_TYPES)[number];

export const PAY_DEDUCTION_TYPE_LABELS_BN: Record<PayDeductionType, string> = {
  unpaid_leave: "বিনা বেতনে ছুটি", advance_repayment: "অগ্রিম কর্তন", lateness: "বিলম্ব কর্তন",
  statutory: "সরকারি কর্তন", other: "অন্যান্য কর্তন",
};
export const PAY_DEDUCTION_TYPE_LABELS_EN: Record<PayDeductionType, string> = {
  unpaid_leave: "Unpaid leave", advance_repayment: "Advance repayment", lateness: "Lateness",
  statutory: "Statutory", other: "Other",
};

/** Addition lines (prd-hr §4.4). `leave_encashment` surfaces the §3.4 cash-out + exit
 *  settlement; `arrears` carries back-pay + post-lock corrections (D-#110). */
export const PAY_ADDITION_TYPES = ["bonus", "arrears", "leave_encashment", "other"] as const;
export type PayAdditionType = (typeof PAY_ADDITION_TYPES)[number];

export const PAY_ADDITION_TYPE_LABELS_BN: Record<PayAdditionType, string> = {
  bonus: "বোনাস", arrears: "বকেয়া", leave_encashment: "ছুটি নগদায়ন", other: "অন্যান্য সংযোজন",
};
export const PAY_ADDITION_TYPE_LABELS_EN: Record<PayAdditionType, string> = {
  bonus: "Bonus", arrears: "Arrears", leave_encashment: "Leave encashment", other: "Other",
};

/** Advance / loan lifecycle (prd-hr §4.5, D-#27 — qard hasan, interest- & fee-free).
 *  `active` = outstanding balance; `settled` = fully recovered / early-settled / exit-netted;
 *  `written_off` = Principal forgave the remaining balance. */
export const ADVANCE_STATUSES = ["active", "settled", "written_off"] as const;
export type AdvanceStatus = (typeof ADVANCE_STATUSES)[number];

export const ADVANCE_STATUS_LABELS_BN: Record<AdvanceStatus, string> = {
  active: "চলমান", settled: "পরিশোধিত", written_off: "মওকুফ",
};
export const ADVANCE_STATUS_LABELS_EN: Record<AdvanceStatus, string> = {
  active: "Active", settled: "Settled", written_off: "Written off",
};

// --- A.5d HR PERFORMANCE / CONDUCT / DEVELOPMENT ENUMS (app-native; HR step 4 --
// — prd-hr §5/H5, D-#28/#112/#113). Identity/operational plane, behind the
// ADR-005 firewall — NO wire-contract twin, NO envelope-schema mirror, NO
// two-place sync; only /shared + the vocab verifier run. NO new auth role: the
// supervisor observation-write is a bounded write inside the EXISTING supervisory
// ScopeGrant extent (D-#28/#17), composed in the resolver — not a permission.

/** The conduct ladder's escalating stages (prd-hr §5.2/H5.3). Order IS the ladder:
 *  verbal → written → final → termination; the index in this array is the rung, so
 *  normal escalation may not skip a rung (a gross-misconduct fast-track may jump to
 *  final/termination). The `termination` step writes employmentStatus → terminated
 *  and triggers offboarding (HR-5/H6). Stages are "configurable" in the PRD; this is
 *  the LOCKED default set (lapse period per stage is parked, §10). */
export const CONDUCT_STAGES = ["verbal", "written", "final", "termination"] as const;
export type ConductStage = (typeof CONDUCT_STAGES)[number];

export const CONDUCT_STAGE_LABELS_BN: Record<ConductStage, string> = {
  verbal: "মৌখিক সতর্কতা", written: "লিখিত সতর্কতা", final: "চূড়ান্ত সতর্কতা", termination: "চাকরিচ্যুতি",
};
export const CONDUCT_STAGE_LABELS_EN: Record<ConductStage, string> = {
  verbal: "Verbal warning", written: "Written warning", final: "Final warning", termination: "Termination",
};

/** Conduct-record lifecycle (prd-hr §5.2/H5.3). A step is `draft` when raised; the
 *  person's response/hearing is captured BEFORE finalisation (*'adl*, not optional) →
 *  `hearing_held`; the issuer then `finalized` it (the disciplinary judgement, a
 *  Principal-only sign-off, D-#112). A finalised warning `lapsed` once past its
 *  `liveUntil` date — it stops counting toward escalation but stays on file as history
 *  (never deleted); lapse is LAZY at read time (D-#21/library posture, D-#113). */
export const CONDUCT_RECORD_STATUSES = ["draft", "hearing_held", "finalized", "lapsed"] as const;
export type ConductRecordStatus = (typeof CONDUCT_RECORD_STATUSES)[number];

export const CONDUCT_RECORD_STATUS_LABELS_BN: Record<ConductRecordStatus, string> = {
  draft: "খসড়া", hearing_held: "শুনানি সম্পন্ন", finalized: "চূড়ান্ত", lapsed: "মেয়াদোত্তীর্ণ",
};
export const CONDUCT_RECORD_STATUS_LABELS_EN: Record<ConductRecordStatus, string> = {
  draft: "Draft", hearing_held: "Hearing held", finalized: "Finalized", lapsed: "Lapsed",
};

/** Appraisal lifecycle (prd-hr §5.1/H5.1). One per staff per cycle (= annual, aligned
 *  to the academic year). Office/Principal PREPARE the `draft` (gather observations +
 *  goals); the overall outcome + sign-off is PRINCIPAL-only (D-#28/H5.2) →
 *  `signed_off`, which emits development needs into the CPD log (H5.4). */
export const APPRAISAL_STATUSES = ["draft", "signed_off"] as const;
export type AppraisalStatus = (typeof APPRAISAL_STATUSES)[number];

export const APPRAISAL_STATUS_LABELS_BN: Record<AppraisalStatus, string> = {
  draft: "খসড়া", signed_off: "চূড়ান্ত অনুমোদিত",
};
export const APPRAISAL_STATUS_LABELS_EN: Record<AppraisalStatus, string> = {
  draft: "Draft", signed_off: "Signed off",
};

/** The overall appraisal outcome scale (prd-hr §5.1/H5.1 — the "OBSERVATION/
 *  APPRAISAL_OUTCOME vocab", §9). Recorded ONLY at Principal sign-off; the
 *  REF-11 per-observation rubric is curriculum-owned + parked (§6/§10). */
export const APPRAISAL_OUTCOMES = ["exceeds", "meets", "needs_improvement", "unsatisfactory"] as const;
export type AppraisalOutcome = (typeof APPRAISAL_OUTCOMES)[number];

export const APPRAISAL_OUTCOME_LABELS_BN: Record<AppraisalOutcome, string> = {
  exceeds: "প্রত্যাশা ছাড়িয়েছে", meets: "প্রত্যাশা পূরণ", needs_improvement: "উন্নতি প্রয়োজন", unsatisfactory: "অসন্তোষজনক",
};
export const APPRAISAL_OUTCOME_LABELS_EN: Record<AppraisalOutcome, string> = {
  exceeds: "Exceeds expectations", meets: "Meets expectations", needs_improvement: "Needs improvement", unsatisfactory: "Unsatisfactory",
};

/** Grievance lifecycle (prd-hr §5.2/H5.4). A staff-raised CONFIDENTIAL channel routed
 *  to the Principal (same confidentiality as conduct, opposite direction). `open` on
 *  raise → `under_review` when an admin picks it up → `resolved`/`closed` with a note. */
export const GRIEVANCE_STATUSES = ["open", "under_review", "resolved", "closed"] as const;
export type GrievanceStatus = (typeof GRIEVANCE_STATUSES)[number];

export const GRIEVANCE_STATUS_LABELS_BN: Record<GrievanceStatus, string> = {
  open: "উত্থাপিত", under_review: "পর্যালোচনাধীন", resolved: "নিষ্পন্ন", closed: "বন্ধ",
};
export const GRIEVANCE_STATUS_LABELS_EN: Record<GrievanceStatus, string> = {
  open: "Open", under_review: "Under review", resolved: "Resolved", closed: "Closed",
};

// --- A.5e HR OFFBOARDING ENUMS (app-native; HR module step 5 — prd-hr §6/H6, ---
// D-#29/#117). Identity/operational plane, behind the ADR-005 firewall — NO
// wire-contract twin, NO envelope-schema mirror, NO two-place sync; only /shared
// + the vocab verifier run. NO new permission: offboarding/clearance/access-revoke
// ride `staff:manage` (Office HR admin), final-settlement compute rides
// `payroll:manage`, and the final-settlement RELEASE/lock rides `payroll:approve`
// (PRINCIPAL only — the D-#29 hard-hold authority); the compose-don't-add posture.

/** Exit trigger (prd-hr §6/H6.1). Each maps to an EMPLOYMENT_STATUS:
 *  resignation→resigned, termination→terminated (already wired from HR-4 H5.3),
 *  fixed_term_end→contract_ended, retirement→retired (D-#117). */
export const OFFBOARDING_TRIGGERS = ["resignation", "termination", "fixed_term_end", "retirement"] as const;
export type OffboardingTrigger = (typeof OFFBOARDING_TRIGGERS)[number];

export const OFFBOARDING_TRIGGER_LABELS_BN: Record<OffboardingTrigger, string> = {
  resignation: "পদত্যাগ", termination: "চাকরিচ্যুতি", fixed_term_end: "চুক্তির মেয়াদ শেষ", retirement: "অবসর",
};
export const OFFBOARDING_TRIGGER_LABELS_EN: Record<OffboardingTrigger, string> = {
  resignation: "Resignation", termination: "Termination", fixed_term_end: "Fixed-term end", retirement: "Retirement",
};

/** Offboarding case lifecycle (prd-hr §6). `initiated` on open → `access_revoked`
 *  once the system disables the login + revokes all scope grants on the last working
 *  day (H6.3) → `completed` once clearance is done AND the hard-held final settlement
 *  is released (H6.4). `cancelled` = the exit was withdrawn (e.g. resignation pulled).
 *  The StaffProfile is NEVER deleted — the case + history are retained (H6.5). */
export const OFFBOARDING_STATUSES = ["initiated", "access_revoked", "completed", "cancelled"] as const;
export type OffboardingStatus = (typeof OFFBOARDING_STATUSES)[number];

export const OFFBOARDING_STATUS_LABELS_BN: Record<OffboardingStatus, string> = {
  initiated: "শুরু হয়েছে", access_revoked: "প্রবেশাধিকার বাতিল", completed: "সম্পন্ন", cancelled: "বাতিল",
};
export const OFFBOARDING_STATUS_LABELS_EN: Record<OffboardingStatus, string> = {
  initiated: "Initiated", access_revoked: "Access revoked", completed: "Completed", cancelled: "Cancelled",
};

/** Clearance checklist item status (prd-hr §6/H6.2). The specific items (asset return /
 *  handover / no-dues) are admin DATA with read-time defaults (numbers/list PARKED, §10,
 *  the D-#97 no-seed posture); `waived` = not applicable / explicitly excused.
 *  Settlement is hard-held until EVERY item is `done` or `waived` (H6.4/D-#29). */
export const CLEARANCE_ITEM_STATUSES = ["pending", "done", "waived"] as const;
export type ClearanceItemStatus = (typeof CLEARANCE_ITEM_STATUSES)[number];

export const CLEARANCE_ITEM_STATUS_LABELS_BN: Record<ClearanceItemStatus, string> = {
  pending: "অপেক্ষমাণ", done: "সম্পন্ন", waived: "অব্যাহতি",
};
export const CLEARANCE_ITEM_STATUS_LABELS_EN: Record<ClearanceItemStatus, string> = {
  pending: "Pending", done: "Done", waived: "Waived",
};

// --- A.6 HOMEWORK-TRACKER ENUMS (app-native; Project-06 handoff — HW-T1) ------
// Daily HW-… channel. NO wire-contract twin: trackers are a feature, not import
// content (no `doc_type: tracker`), and Layer-B records live on the operational/
// identity plane behind the ADR-005 firewall. So these live ONLY here — no
// envelope-schema mirror, no two-/three-place sync (D-#33). See
// docs/prd-tracker-homework.md + docs/tracker-homework-handoff.md.

/** Homework SUBJECT axis (handoff §2.1/§6.2) — a SUPERSET of the LOCKED content
 *  `SUBJECTS` (which mirrors the envelope and is NOT widened here, D-#19/D-#30).
 *  Adds the roster-only religious subjects that carry homework but no authored
 *  content: Arabic + Islam. **Quran is EXCLUDED** by Principal ruling (D-#36) —
 *  Quran homework is handled by the Quran Tracker, not this channel (a deliberate
 *  deviation from handoff §6.3, routed to Project 06). Separate operational axis,
 *  never mirrored into the envelope (D-#36, mirroring D-#30's roster-vs-content split). */
export const HW_SUBJECTS = ["BAN", "ENG", "MATH", "SCI", "BGS", "ARABIC", "ISLAM"] as const;
export type HwSubject = (typeof HW_SUBJECTS)[number];

export const HW_SUBJECT_LABELS_BN: Record<HwSubject, string> = {
  BAN: "বাংলা",
  ENG: "ইংরেজি",
  MATH: "গণিত",
  SCI: "বিজ্ঞান",
  BGS: "বাংলাদেশ ও বিশ্বপরিচয়",
  ARABIC: "আরবি",
  ISLAM: "ইসলাম শিক্ষা",
};

/** The ratified 6-stage lifecycle (handoff §3, FIRM) as 8 ATOMIC states — two
 *  stages are compound (4 = Submitted/Chase, 5 = Checked/Resubmit), so the wire
 *  state set splits them (D-#37). Built ONCE here and SHARED by the homework and
 *  (future) assignment trackers (handoff §1/§3). The legal transition graph + the
 *  stage grouping live in `server/.../trackers/lifecycle.ts` (logic, not vocab). */
export const LIFECYCLE_STATES = [
  "GIVEN",
  "ABSENT_REDELIVER",
  "DUE",
  "SUBMITTED",
  "CHASE",
  "CHECKED",
  "RESUBMIT",
  "RETURNED",
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const LIFECYCLE_STATE_LABELS_BN: Record<LifecycleState, string> = {
  GIVEN: "প্রদান করা হয়েছে",
  ABSENT_REDELIVER: "অনুপস্থিত / পুনঃপ্রদান",
  DUE: "জমার দিন",
  SUBMITTED: "জমা হয়েছে",
  CHASE: "তাগাদা",
  CHECKED: "যাচাই হয়েছে",
  RESUBMIT: "পুনঃজমা",
  RETURNED: "ফেরত দেওয়া হয়েছে",
};

/** RESULT scale recorded at Checked (handoff §2.2; 3-value, confirmed A-01 /
 *  D-#34). Only WRONG auto-spawns a resubmission; PARTIAL is teacher's judgment. */
export const HW_RESULTS = ["CORRECT", "PARTIAL", "WRONG"] as const;
export type HwResult = (typeof HW_RESULTS)[number];

export const HW_RESULT_LABELS_BN: Record<HwResult, string> = {
  CORRECT: "সঠিক",
  PARTIAL: "আংশিক",
  WRONG: "ভুল",
};

// Daily-budget LOCKED figures (handoff §0/§2.3/§4, D-024/D-030; restated verbatim,
// NOT open — see handoff §11). The day-SUM ceiling is law; the per-subject band is
// advisory (warn, never block). Floor is informational only (not enforced).
export const HW_DAILY_CEILING_MIN = 240; // uniform C1–5 day-sum ceiling — the §4 gate
export const HW_DAILY_FLOOR_MIN = 120; // informational only
export const HW_SUBJECT_BAND_MAX_MIN = 40; // single-subject band; >40 WARNS, never blocks (§4 close / T2.5)
export const HW_DEFAULT_TIME_DECL_MIN = 20; // Class-1 working default for TIME_DECL

/** Daily reconciliation state (handoff §2.3 RECON_STATE). within/over are derived
 *  live from DAY_TOTAL vs the ceiling; `reconciled` is the persisted terminal state
 *  once the class teacher confirms + issues (HW-T2). */
export const RECON_STATES = ["within_ceiling", "over_ceiling", "reconciled"] as const;
export type ReconState = (typeof RECON_STATES)[number];

export const RECON_STATE_LABELS_BN: Record<ReconState, string> = {
  within_ceiling: "সীমার মধ্যে",
  over_ceiling: "সীমা অতিক্রম — হ্রাস প্রয়োজন",
  reconciled: "সমন্বিত",
};

/** Trim priority rank (handoff §4.4 / §2.3 TRIM_RANK). English codes a/b/c; the
 *  trim log + UI render the Bangla letters ক/খ/গ. Order is the cut priority:
 *  a = pure-revision items first, b = lightest-subject Q_COUNT cut, c = zero a subject. */
export const TRIM_RANKS = ["a", "b", "c"] as const;
export type TrimRank = (typeof TRIM_RANKS)[number];

export const TRIM_RANK_LABELS_BN: Record<TrimRank, string> = {
  a: "ক",
  b: "খ",
  c: "গ",
};

// --- A.7 ENGLISH DISPLAY LABELS (bilingual UI — app shows BN or EN per the -----
// user's chosen language; NFR-5 keeps Bangla the default + English codes on
// forms). Same keys as every *_LABELS_BN map above; the app's label lookup picks
// the map by the active language. App-native, no wire-contract twin. Bloom stays
// English-coded (curriculum-governed), so it has no label map in either language.

export const ROSTER_CLASS_LABELS_EN: Record<RosterClassLevel, string> = {
  [-1]: "Nursery",
  [0]: "KG",
  [1]: "Class 1",
  [2]: "Class 2",
  [3]: "Class 3",
  [4]: "Class 4",
  [5]: "Class 5",
};

export const SUBJECT_LABELS_EN: Record<Subject, string> = {
  BAN: "Bangla",
  ENG: "English",
  MATH: "Mathematics",
  SCI: "Science",
  BGS: "Bangladesh & Global Studies",
};

export const DOC_TYPE_LABELS_EN: Record<DocType, string> = {
  chapter_plan: "Chapter plan",
  session_plan: "Session plan",
  question: "Question",
  question_set: "Question set",
  stimulus: "Stimulus",
};

export const CURATION_TAG_LABELS_EN: Record<CurationTag, string> = {
  KEEP_AS_IS: "Keep as is",
  NEEDS_REPLACEMENT: "Needs replacement",
  FLEXIBLE: "Flexible",
};

export const DIFFICULTY_LABELS_EN: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export const PAPER_ROLE_LABELS_EN: Record<PaperRole, string> = {
  mcq: "MCQ",
  short: "Short",
  structured: "Structured",
  creative: "Creative",
};

export const REVIEW_STATUS_LABELS_EN: Record<ReviewStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  gold: "Final", // Principal-locked
};

export const REVIEW_VERDICT_LABELS_EN: Record<ReviewVerdict, string> = {
  APPROVE: "Approve",
  CHANGES_REQUESTED: "Changes requested",
};

export const SET_TYPE_LABELS_EN: Record<SetType, string> = {
  HW: "Homework",
  AS: "Assignment",
  CT: "Class test",
};

export const TRACKER_KIND_LABELS_EN: Record<TrackerKind, string> = {
  classtest: "Class test",
  assignment: "Assignment",
  homework: "Homework",
  generic: "Generic",
};

export const DEFAULT_SECTION_LABEL_EN = "Main" as const;

export const HR_CATEGORY_LABELS_EN: Record<HrCategory, string> = {
  teacher: "Teacher",
  assistant_hifz: "Assistant / Hifz",
  office_accounts: "Office & Accounts",
  support: "Support staff",
};

export const EMPLOYMENT_TYPE_LABELS_EN: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  fixed_term: "Fixed-term",
};

export const EMPLOYMENT_STATUS_LABELS_EN: Record<EmploymentStatus, string> = {
  probation: "Probation",
  confirmed: "Confirmed",
  resigned: "Resigned",
  terminated: "Terminated",
  retired: "Retired",
  contract_ended: "Contract ended",
};

export const HW_SUBJECT_LABELS_EN: Record<HwSubject, string> = {
  BAN: "Bangla",
  ENG: "English",
  MATH: "Mathematics",
  SCI: "Science",
  BGS: "Bangladesh & Global Studies",
  ARABIC: "Arabic",
  ISLAM: "Islamic Studies",
};

export const LIFECYCLE_STATE_LABELS_EN: Record<LifecycleState, string> = {
  GIVEN: "Given",
  ABSENT_REDELIVER: "Absent / redeliver",
  DUE: "Due",
  SUBMITTED: "Submitted",
  CHASE: "Chase",
  CHECKED: "Checked",
  RESUBMIT: "Resubmit",
  RETURNED: "Returned",
};

export const HW_RESULT_LABELS_EN: Record<HwResult, string> = {
  CORRECT: "Correct",
  PARTIAL: "Partial",
  WRONG: "Wrong",
};

export const RECON_STATE_LABELS_EN: Record<ReconState, string> = {
  within_ceiling: "Within limit",
  over_ceiling: "Over limit — trim needed",
  reconciled: "Reconciled",
};

export const TRIM_RANK_LABELS_EN: Record<TrimRank, string> = {
  a: "a",
  b: "b",
  c: "c",
};

// --- A.8 ROUTINE / TIMETABLE ENUMS (app-native; Routine module — prd-routine, --
// D-#46–#57). NO wire-contract twin: a routine is a feature, not import content,
// and every row is operational/identity-plane behind the ADR-005 firewall. So
// these live ONLY here — no envelope-schema mirror, no two-place sync; only
// /shared + the vocab verifier run. BN + EN labels are kept together here
// (self-contained) rather than split into the A.7 EN block above.

/** Days of the week, index-aligned to JS `Date#getDay` (0=Sun … 6=Sat) so the
 *  calendar resolver can index directly. SUN–THU teach; FRI off; SAT Quran-only. */
export const DAYS_OF_WEEK = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export const DAY_OF_WEEK_LABELS_BN: Record<DayOfWeek, string> = {
  SUN: "রবিবার", MON: "সোমবার", TUE: "মঙ্গলবার", WED: "বুধবার",
  THU: "বৃহস্পতিবার", FRI: "শুক্রবার", SAT: "শনিবার",
};
export const DAY_OF_WEEK_LABELS_EN: Record<DayOfWeek, string> = {
  SUN: "Sunday", MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
  THU: "Thursday", FRI: "Friday", SAT: "Saturday",
};

/** Day-type the calendar resolves for a date (D-#50). FULL = Sun–Thu (all tracks);
 *  OFF = Fri; QURAN_ONLY = Sat (only Quran-track for Quran groups); HOLIDAY = a
 *  HolidayException override (no routine, attendance not expected). */
export const DAY_TYPES = ["FULL", "OFF", "QURAN_ONLY", "HOLIDAY"] as const;
export type DayType = (typeof DAY_TYPES)[number];

export const DAY_TYPE_LABELS_BN: Record<DayType, string> = {
  FULL: "পূর্ণ দিবস", OFF: "ছুটি", QURAN_ONLY: "শুধু কুরআন", HOLIDAY: "বিশেষ ছুটি",
};
export const DAY_TYPE_LABELS_EN: Record<DayType, string> = {
  FULL: "Full day", OFF: "Off", QURAN_ONLY: "Quran only", HOLIDAY: "Holiday",
};

/** Period track — period grids + slots are keyed by this (D-#51). general =
 *  35-min single periods; quran = the first-two-period double (Class 1–5);
 *  arabic = the ~40-min P3 slot. */
export const PERIOD_TRACKS = ["general", "quran", "arabic"] as const;
export type PeriodTrack = (typeof PERIOD_TRACKS)[number];

export const PERIOD_TRACK_LABELS_BN: Record<PeriodTrack, string> = {
  general: "সাধারণ", quran: "কুরআন", arabic: "আরবি",
};
export const PERIOD_TRACK_LABELS_EN: Record<PeriodTrack, string> = {
  general: "General", quran: "Quran", arabic: "Arabic",
};

/** Schedule season (D-#55) — drives the duration profile + day-start window.
 *  Winter compresses only P1/P2 (45→30) and starts later (07:15 → 07:30). */
export const SEASONS = ["regular", "winter"] as const;
export type Season = (typeof SEASONS)[number];

export const SEASON_LABELS_BN: Record<Season, string> = {
  regular: "নিয়মিত", winter: "শীতকাল",
};
export const SEASON_LABELS_EN: Record<Season, string> = {
  regular: "Regular", winter: "Winter",
};

/** Holiday-exception type (D-#50) — overrides a day to no-school. */
export const HOLIDAY_TYPES = ["eid", "govt", "special"] as const;
export type HolidayType = (typeof HOLIDAY_TYPES)[number];

export const HOLIDAY_TYPE_LABELS_BN: Record<HolidayType, string> = {
  eid: "ঈদ", govt: "সরকারি ছুটি", special: "বিশেষ ছুটি",
};
export const HOLIDAY_TYPE_LABELS_EN: Record<HolidayType, string> = {
  eid: "Eid", govt: "Govt holiday", special: "Special",
};

/** Group gender — general Sections + Quran/Arabic SubjectGroups are gender-split
 *  from ~Class 2/3 (D-#56); `mixed` covers the un-split lower classes. */
export const GROUP_GENDERS = ["boys", "girls", "mixed"] as const;
export type GroupGender = (typeof GROUP_GENDERS)[number];

export const GROUP_GENDER_LABELS_BN: Record<GroupGender, string> = {
  boys: "ছেলে", girls: "মেয়ে", mixed: "মিশ্র",
};
export const GROUP_GENDER_LABELS_EN: Record<GroupGender, string> = {
  boys: "Boys", girls: "Girls", mixed: "Mixed",
};

/** Routine SUBJECT axis (D-#54) — a SUPERSET of HW_SUBJECTS, adding QURAN (the
 *  routine carries Quran; homework excludes it, D-#36). ISLAM is labeled "Deen"
 *  on the source routine (D-#56). Availability by class is a data rule
 *  (`ROUTINE_SUBJECTS_CLASS3_PLUS`), enforced in the resolver, not the enum.
 *  Never mirrored into the envelope (mirrors D-#30/#36's operational superset). */
export const ROUTINE_SUBJECTS = ["BAN", "ENG", "MATH", "SCI", "BGS", "ARABIC", "ISLAM", "QURAN"] as const;
export type RoutineSubject = (typeof ROUTINE_SUBJECTS)[number];

export const ROUTINE_SUBJECT_LABELS_BN: Record<RoutineSubject, string> = {
  BAN: "বাংলা", ENG: "ইংরেজি", MATH: "গণিত", SCI: "বিজ্ঞান",
  BGS: "বাংলাদেশ ও বিশ্বপরিচয়", ARABIC: "আরবি", ISLAM: "ইসলাম শিক্ষা", QURAN: "কুরআন",
};
export const ROUTINE_SUBJECT_LABELS_EN: Record<RoutineSubject, string> = {
  BAN: "Bangla", ENG: "English", MATH: "Mathematics", SCI: "Science",
  BGS: "Bangladesh & Global Studies", ARABIC: "Arabic", ISLAM: "Islamic Studies", QURAN: "Quran",
};

/** Subjects taught only from Class 3 upward (D-#54) — BGS + Science. Every other
 *  ROUTINE_SUBJECT runs for all roster classes (incl. Nursery/KG). A data rule the
 *  routine resolver enforces per class level. */
export const ROUTINE_SUBJECTS_CLASS3_PLUS = ["BGS", "SCI"] as const;

// --- A.9 ATTENDANCE ENUMS (app-native; Attendance module — prd-attendance, ------
// D-#63–#67). NO wire-contract twin: attendance is a feature, not import content,
// and every row is operational/identity-plane behind the ADR-005 firewall — no
// envelope-schema mirror, no two-place sync; only /shared + the vocab verifier run.

/** Teacher per-day status, mapped from the biometric export's legend (§4, D-#63):
 *  ✔ → PRESENT, 𝓛 → LATE (read the symbol — no grace computation), ✘ → LEAVE iff a
 *  staff leave record covers that date else ABSENT, ℞ → ignored (never stored). */
export const TEACHER_ATTENDANCE_STATUSES = ["PRESENT", "LATE", "LEAVE", "ABSENT"] as const;
export type TeacherAttendanceStatus = (typeof TEACHER_ATTENDANCE_STATUSES)[number];

export const TEACHER_ATTENDANCE_STATUS_LABELS_BN: Record<TeacherAttendanceStatus, string> = {
  PRESENT: "উপস্থিত", LATE: "বিলম্বে", LEAVE: "ছুটিতে", ABSENT: "অনুপস্থিত",
};
export const TEACHER_ATTENDANCE_STATUS_LABELS_EN: Record<TeacherAttendanceStatus, string> = {
  PRESENT: "Present", LATE: "Late", LEAVE: "On leave", ABSENT: "Absent",
};

/** Reminder/escalation tiers (D-#65): the external scheduler calls the idempotent
 *  endpoint with one of these — 12:10 marker → 12:45 Office → 2:00 Principal,
 *  FULL days only. Declared with the module's vocab; the engine itself is AT-4. */
export const ATTENDANCE_REMINDER_TIERS = ["T1210", "T1245", "T1400"] as const;
export type AttendanceReminderTier = (typeof ATTENDANCE_REMINDER_TIERS)[number];

export const ATTENDANCE_REMINDER_TIER_LABELS_BN: Record<AttendanceReminderTier, string> = {
  T1210: "১২:১০ — শিক্ষককে স্মরণ", T1245: "১২:৪৫ — অফিসে প্রেরণ", T1400: "২:০০ — অধ্যক্ষকে প্রেরণ",
};
export const ATTENDANCE_REMINDER_TIER_LABELS_EN: Record<AttendanceReminderTier, string> = {
  T1210: "12:10 — remind marker", T1245: "12:45 — escalate to Office", T1400: "2:00 — escalate to Principal",
};

// --- A.10 NOTIFICATION ENUMS (app-native; Notifications phase 1 — ------------
// prd-notifications, D-#72–#75). NO wire-contract twin: a notification is a
// feature, not import content, and every row is operational/identity-plane
// behind the ADR-005 firewall — no envelope-schema mirror, no two-place sync;
// only /shared + the vocab verifier run. NO new permissions either: inbox reads/
// markRead and device registration are own-row only; emission is server-internal
// (D-#72, keeps the small permission set D-#17).

/** Notification kinds (D-#72/#74) — every row `NotificationService.emit()`
 *  writes carries exactly one. The event-driven kinds (CLASS_NOTE_PUBLISHED,
 *  HW_PARENT_COMMS, REVIEW_ASSIGNED, COVER_ASSIGNED) ship in slice N-1; the
 *  scheduler-fired kinds (BELL_REMINDER, ATTENDANCE_REMINDER, CLASS_NOTE_PROMPT,
 *  CLASS_NOTE_ESCALATION) fire from the D-#73 in-process ticker in N-2. The
 *  library kinds (LIBRARY_DUE_SOON, LIBRARY_OVERDUE — prd-library LB-5, D-#84)
 *  ride the same seam, dispatched by the library reminder service. */
export const NOTIFICATION_KINDS = [
  "BELL_REMINDER",
  "ATTENDANCE_REMINDER",
  "CLASS_NOTE_PROMPT",
  "CLASS_NOTE_ESCALATION",
  "CLASS_NOTE_PUBLISHED",
  "HW_PARENT_COMMS",
  "REVIEW_ASSIGNED",
  "COVER_ASSIGNED",
  "LIBRARY_DUE_SOON",
  "LIBRARY_OVERDUE",
  "CLASS_TEST_RESULT",
  "VOCAB_RESULT",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABELS_BN: Record<NotificationKind, string> = {
  BELL_REMINDER: "ঘণ্টার স্মরণিকা",
  ATTENDANCE_REMINDER: "হাজিরা জমার স্মরণিকা",
  CLASS_NOTE_PROMPT: "পাঠ নোট লেখার তাগিদ",
  CLASS_NOTE_ESCALATION: "পাঠ নোট অনিষ্পন্ন",
  CLASS_NOTE_PUBLISHED: "পাঠ নোট প্রকাশিত",
  HW_PARENT_COMMS: "অভিভাবক যোগাযোগের তাগিদ",
  REVIEW_ASSIGNED: "পর্যালোচনার দায়িত্ব",
  COVER_ASSIGNED: "কাভার ক্লাসের দায়িত্ব",
  LIBRARY_DUE_SOON: "বই ফেরতের স্মরণিকা",
  LIBRARY_OVERDUE: "বই ফেরত বকেয়া",
  CLASS_TEST_RESULT: "ক্লাস টেস্টের ফলাফল",
  VOCAB_RESULT: "ভোকাবুলারি টেস্টের ফলাফল",
};
export const NOTIFICATION_KIND_LABELS_EN: Record<NotificationKind, string> = {
  BELL_REMINDER: "Bell reminder",
  ATTENDANCE_REMINDER: "Attendance reminder",
  CLASS_NOTE_PROMPT: "Class-note prompt",
  CLASS_NOTE_ESCALATION: "Class-note escalation",
  CLASS_NOTE_PUBLISHED: "Class note published",
  HW_PARENT_COMMS: "Parent-contact prompt",
  REVIEW_ASSIGNED: "Review assigned",
  COVER_ASSIGNED: "Cover assigned",
  LIBRARY_DUE_SOON: "Book due soon",
  LIBRARY_OVERDUE: "Book overdue",
  CLASS_TEST_RESULT: "Class-test result",
  VOCAB_RESULT: "Vocabulary-test result",
};


// --- A.x CLASS-TEST TRACKER ENUMS (app-native; Class Test module — ----------
// prd-tracker-class-test §3.1, D-#119–#122 + build rulings D-#142–#144). NO
// wire-contract twin: a class test is a FEATURE, not import `doc_type` content
// — no envelope-schema mirror, no two-/three-place sync; only /shared + the
// vocab verifier run. Every row is operational/identity-plane behind the
// ADR-005 firewall. RBAC composes existing permissions (teacher request =
// tracker:write, Office mark-printed/cancel = roster:manage) — NO new
// role/permission (D-#94/#17). The uploaded-paper file kind (`classtest_question`)
// lives on the StoredFile model enum (the M-4 pattern), not here.

/** Print-request → official-exam lifecycle (§3.1). The record is BORN as the
 *  print request (REQUESTED), becomes the official exam on Office mark-printed
 *  (PRINTED); CANCELLED for a withdrawn request. "Complete / overdue" is
 *  DERIVED (CT-2), never a stored status. */
export const CLASS_TEST_STATUSES = ["REQUESTED", "PRINTED", "CANCELLED"] as const;
export type ClassTestStatus = (typeof CLASS_TEST_STATUSES)[number];

export const CLASS_TEST_STATUS_LABELS_BN: Record<ClassTestStatus, string> = {
  REQUESTED: "অনুরোধ করা হয়েছে",
  PRINTED: "ছাপা হয়েছে",
  CANCELLED: "বাতিল",
};
export const CLASS_TEST_STATUS_LABELS_EN: Record<ClassTestStatus, string> = {
  REQUESTED: "Requested",
  PRINTED: "Printed",
  CANCELLED: "Cancelled",
};

/** Where the exam paper comes from (§3.1): an assembled CT-kind question-pool
 *  set, or the teacher's own uploaded paper. */
export const CLASS_TEST_SOURCES = ["POOL_SET", "UPLOADED_PAPER"] as const;
export type ClassTestSource = (typeof CLASS_TEST_SOURCES)[number];

export const CLASS_TEST_SOURCE_LABELS_BN: Record<ClassTestSource, string> = {
  POOL_SET: "প্রশ্নব্যাংক সেট",
  UPLOADED_PAPER: "আপলোড করা প্রশ্নপত্র",
};
export const CLASS_TEST_SOURCE_LABELS_EN: Record<ClassTestSource, string> = {
  POOL_SET: "Question-pool set",
  UPLOADED_PAPER: "Uploaded paper",
};

/** Per-(student × class test) attendance status (CT-2, §3.3/§4). PRESENT carries
 *  marks + is scored; ABSENT carries NO marks, is excluded from class denominators,
 *  and feeds the Absent guardian template (CT-3). One flag per student per exam.
 *  Class-test-namespaced (NOT the vocab/teacher attendance enums) — a class test is
 *  a distinct feature, kept disjoint and additive (AGENTS rule 5). */
export const CLASS_TEST_ATTENDANCE_STATUSES = ["PRESENT", "ABSENT"] as const;
export type ClassTestAttendanceStatus = (typeof CLASS_TEST_ATTENDANCE_STATUSES)[number];

export const CLASS_TEST_ATTENDANCE_STATUS_LABELS_BN: Record<ClassTestAttendanceStatus, string> = {
  PRESENT: "উপস্থিত",
  ABSENT: "অনুপস্থিত",
};
export const CLASS_TEST_ATTENDANCE_STATUS_LABELS_EN: Record<ClassTestAttendanceStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
};


// --- A.11 LIBRARY ENUMS (app-native; Library module — prd-library, ----------
// D-#81–#84). NO wire-contract twin: the library is a feature, not import
// content, and every row (a child's reading record included) is operational/
// identity-plane behind the ADR-005 firewall — no envelope-schema mirror, no
// two-place sync; only /shared + the vocab verifier run. NO new role: desk
// duty rides `library:manage` OR the append-only `LibrarianAssignment`
// duty-gate (D-#42/#64 pattern).

/** Who borrows (D-#81). Students + guardians are desk-mediated (no student
 *  logins; guardian portal read-only, D-#68); staff also self-serve in-app. */
export const BORROWER_TYPES = ["STUDENT", "STAFF", "GUARDIAN"] as const;
export type BorrowerType = (typeof BORROWER_TYPES)[number];

export const BORROWER_TYPE_LABELS_BN: Record<BorrowerType, string> = {
  STUDENT: "শিক্ষার্থী", STAFF: "শিক্ষক/কর্মী", GUARDIAN: "অভিভাবক",
};
export const BORROWER_TYPE_LABELS_EN: Record<BorrowerType, string> = {
  STUDENT: "Student", STAFF: "Staff", GUARDIAN: "Guardian",
};

/** Per-copy status (D-#82). WITHDRAWN = removed from circulation but never
 *  deleted (loan history keeps pointing at the accession number). */
export const COPY_STATUSES = ["AVAILABLE", "ON_LOAN", "ON_HOLD", "LOST", "DAMAGED", "WITHDRAWN"] as const;
export type CopyStatus = (typeof COPY_STATUSES)[number];

export const COPY_STATUS_LABELS_BN: Record<CopyStatus, string> = {
  AVAILABLE: "উপলব্ধ", ON_LOAN: "ইস্যুকৃত", ON_HOLD: "সংরক্ষিত (হোল্ড)",
  LOST: "হারানো", DAMAGED: "ক্ষতিগ্রস্ত", WITHDRAWN: "প্রত্যাহৃত",
};
export const COPY_STATUS_LABELS_EN: Record<CopyStatus, string> = {
  AVAILABLE: "Available", ON_LOAN: "On loan", ON_HOLD: "On hold",
  LOST: "Lost", DAMAGED: "Damaged", WITHDRAWN: "Withdrawn",
};

/** Loan lifecycle (D-#82). OVERDUE is deliberately NOT a status — it is
 *  COMPUTED from `dueDate` at read time, never stored (it would go stale). */
export const LOAN_STATUSES = ["ACTIVE", "RETURNED", "LOST"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const LOAN_STATUS_LABELS_BN: Record<LoanStatus, string> = {
  ACTIVE: "চলমান", RETURNED: "ফেরত হয়েছে", LOST: "হারানো",
};
export const LOAN_STATUS_LABELS_EN: Record<LoanStatus, string> = {
  ACTIVE: "Active", RETURNED: "Returned", LOST: "Lost",
};

/** Title-level FIFO reservation states (D-#83). READY = a returned copy is
 *  held for this borrower until `expiresAt`; expiry is LAZY at request time
 *  (D-#21 posture — no scheduler dependency). */
export const RESERVATION_STATUSES = ["QUEUED", "READY", "FULFILLED", "CANCELLED", "EXPIRED"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_STATUS_LABELS_BN: Record<ReservationStatus, string> = {
  QUEUED: "অপেক্ষমাণ", READY: "সংগ্রহের জন্য প্রস্তুত", FULFILLED: "সম্পন্ন",
  CANCELLED: "বাতিল", EXPIRED: "মেয়াদোত্তীর্ণ",
};
export const RESERVATION_STATUS_LABELS_EN: Record<ReservationStatus, string> = {
  QUEUED: "Queued", READY: "Ready for pickup", FULFILLED: "Fulfilled",
  CANCELLED: "Cancelled", EXPIRED: "Expired",
};

/** Catalog language facet (browse filter). */
export const BOOK_LANGUAGES = ["BANGLA", "ARABIC", "ENGLISH", "OTHER"] as const;
export type BookLanguage = (typeof BOOK_LANGUAGES)[number];

export const BOOK_LANGUAGE_LABELS_BN: Record<BookLanguage, string> = {
  BANGLA: "বাংলা", ARABIC: "আরবি", ENGLISH: "ইংরেজি", OTHER: "অন্যান্য",
};
export const BOOK_LANGUAGE_LABELS_EN: Record<BookLanguage, string> = {
  BANGLA: "Bangla", ARABIC: "Arabic", ENGLISH: "English", OTHER: "Other",
};


// --- A.12 CHAT / MESSAGING ENUMS (app-native; Messaging module — ------------
// prd-messaging, D-#76–#79). NO wire-contract twin: a chat is a feature, not
// import content, and every row (conversations, messages, receipts) names
// staff Users — strictly operational/identity-plane behind the ADR-005
// firewall. No envelope-schema mirror, no two-place sync; only /shared + the
// vocab verifier run. Guardians are notice RECIPIENTS (wa.me fan-out, ADR-003
// permanent), NEVER chat participants (D-#76) — no guardian chat permission.

/** Conversation kinds (D-#76/#78). DIRECT = 1:1 between any two staff (one per
 *  pair, idempotent). SECTION/SUBJECT/SCHOOL are AUTO-PROVISIONED from roster +
 *  routine with source-tagged idempotent membership sync (D-#49 pattern, M-2).
 *  CUSTOM = ad-hoc/regular groups, Principal/Office only (`chat:manage`). */
export const CONVERSATION_KINDS = ["DIRECT", "SECTION", "SUBJECT", "SCHOOL", "CUSTOM"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export const CONVERSATION_KIND_LABELS_BN: Record<ConversationKind, string> = {
  DIRECT: "সরাসরি বার্তা", SECTION: "শাখা গ্রুপ", SUBJECT: "বিষয় গ্রুপ",
  SCHOOL: "স্কুল-ব্যাপী", CUSTOM: "নিজস্ব গ্রুপ",
};
export const CONVERSATION_KIND_LABELS_EN: Record<ConversationKind, string> = {
  DIRECT: "Direct message", SECTION: "Section group", SUBJECT: "Subject group",
  SCHOOL: "School-wide", CUSTOM: "Custom group",
};

/** Posting policy (D-#78). Every group defaults OPEN; ANNOUNCEMENT blocks
 *  posting for members without `chat:manage` (reactions still allowed, M-2). */
export const POSTING_POLICIES = ["OPEN", "ANNOUNCEMENT"] as const;
export type PostingPolicy = (typeof POSTING_POLICIES)[number];

export const POSTING_POLICY_LABELS_BN: Record<PostingPolicy, string> = {
  OPEN: "উন্মুক্ত আলোচনা", ANNOUNCEMENT: "শুধু ঘোষণা",
};
export const POSTING_POLICY_LABELS_EN: Record<PostingPolicy, string> = {
  OPEN: "Open discussion", ANNOUNCEMENT: "Announcement only",
};

/** Attachment kinds (D-#79) — photo / PDF / video / voice note, hard limit
 *  10 MB per file, MIME-whitelisted at the upload path (M-4). */
export const ATTACHMENT_KINDS = ["IMAGE", "PDF", "VIDEO", "AUDIO"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABELS_BN: Record<AttachmentKind, string> = {
  IMAGE: "ছবি", PDF: "পিডিএফ", VIDEO: "ভিডিও", AUDIO: "ভয়েস বার্তা",
};
export const ATTACHMENT_KIND_LABELS_EN: Record<AttachmentKind, string> = {
  IMAGE: "Photo", PDF: "PDF", VIDEO: "Video", AUDIO: "Voice note",
};

/** Guardian-notice scope (D-#79, M-6). SECTION gates on the section's class
 *  teacher (`assertIsClassTeacher` — the D-#45 parent-comms duty) or
 *  Principal/Office; SCHOOL gates on `chat:manage`. Delivery = per-guardian
 *  wa.me fan-out (ADR-003 permanent); no guardian login involved. */
export const NOTICE_SCOPES = ["SCHOOL", "SECTION"] as const;
export type NoticeScope = (typeof NOTICE_SCOPES)[number];

export const NOTICE_SCOPE_LABELS_BN: Record<NoticeScope, string> = {
  SCHOOL: "সারা স্কুল", SECTION: "শাখা",
};
export const NOTICE_SCOPE_LABELS_EN: Record<NoticeScope, string> = {
  SCHOOL: "School-wide", SECTION: "Section",
};


// --- A.13 VOCABULARY-TRACKER ENUMS (app-native; Vocabulary Tracker module — --
// prd-vocabulary-tracker, D-#104–#107). NO wire-contract twin: a vocab test is a
// feature, not import content (no `doc_type` for it), and every row is
// operational/identity-plane behind the ADR-005 firewall — no envelope-schema
// mirror, no two-/three-place sync; only /shared + the vocab verifier run (D-#104).
// NO new role / permission: the word bank rides `tracker:write` (manage) +
// `tracker:read` (read), weekly assignment rides `roster:manage` at VC-2 — the
// D-#94/#106 compose-don't-add pattern (D-#17 small role set).
//
// The trilingual model is DATA-DRIVEN (D-#105): one engine serves English, Bangla
// and Arabic by declaring, in code, which directions each program uses and how many
// markable fields its DICTATION has. A new language later = a new VOCAB_PROGRAMS
// value + two map rows, not a rebuild. There is NO Old/New axis (D-#104).

/** Vocab program (D-#104/#105). Three independent programs share one engine; a new
 *  language later is a new value here + a row in the two maps below. */
export const VOCAB_PROGRAMS = ["ENGLISH", "BANGLA", "ARABIC"] as const;
export type VocabProgram = (typeof VOCAB_PROGRAMS)[number];

export const VOCAB_PROGRAM_LABELS_BN: Record<VocabProgram, string> = {
  ENGLISH: "ইংরেজি", BANGLA: "বাংলা", ARABIC: "আরবি",
};
export const VOCAB_PROGRAM_LABELS_EN: Record<VocabProgram, string> = {
  ENGLISH: "English", BANGLA: "Bangla", ARABIC: "Arabic",
};

/** Test directions (D-#105). DICTATION is the multi-field spelling direction (field
 *  count per program below). HEADWORD_TO_BANGLA / BANGLA_TO_HEADWORD are MEANING
 *  directions (the program-language word ↔ its Bangla meaning), NOT transliteration. */
export const VOCAB_DIRECTIONS = ["DICTATION", "HEADWORD_TO_BANGLA", "BANGLA_TO_HEADWORD"] as const;
export type VocabDirection = (typeof VOCAB_DIRECTIONS)[number];

export const VOCAB_DIRECTION_LABELS_BN: Record<VocabDirection, string> = {
  DICTATION: "শ্রুতিলিখন", HEADWORD_TO_BANGLA: "শব্দ → বাংলা অর্থ", BANGLA_TO_HEADWORD: "বাংলা অর্থ → শব্দ",
};
export const VOCAB_DIRECTION_LABELS_EN: Record<VocabDirection, string> = {
  DICTATION: "Dictation", HEADWORD_TO_BANGLA: "Headword → Bangla", BANGLA_TO_HEADWORD: "Bangla → headword",
};

/** Which directions each program uses (D-#105, §3.1) — the program→directions map AS
 *  DATA. ENGLISH & ARABIC run all three; BANGLA omits the reverse meaning direction.
 *  Every program includes DICTATION. VC-2 lays out positions from a program's list. */
export const VOCAB_PROGRAM_DIRECTIONS: Record<VocabProgram, readonly VocabDirection[]> = {
  ENGLISH: ["DICTATION", "HEADWORD_TO_BANGLA", "BANGLA_TO_HEADWORD"],
  BANGLA: ["DICTATION", "HEADWORD_TO_BANGLA"],
  ARABIC: ["DICTATION", "HEADWORD_TO_BANGLA", "BANGLA_TO_HEADWORD"],
};

/** How many independently-markable fields a DICTATION position has per program
 *  (D-#105, §3.1): ENGLISH & ARABIC = 2 (headword spelling + Bangla meaning),
 *  BANGLA = 1 (spelling only). VC-3 marks each field independently; whether a
 *  half-miss costs 1 or 2 marks is configured PER TEST (VC-2), not here. */
export const VOCAB_DICTATION_FIELDS: Record<VocabProgram, number> = {
  ENGLISH: 2,
  BANGLA: 1,
  ARABIC: 2,
};

/** Vocab test lifecycle (VC-2/VC-3, §3.3). `draft` = created, positions still being
 *  laid out; `ready` = positions laid + totalMarks/half-miss set, ready to mark;
 *  `marked` = results recorded (VC-3). A test is never hard-deleted. */
export const VOCAB_TEST_STATUSES = ["draft", "ready", "marked"] as const;
export type VocabTestStatus = (typeof VOCAB_TEST_STATUSES)[number];

export const VOCAB_TEST_STATUS_LABELS_BN: Record<VocabTestStatus, string> = {
  draft: "খসড়া", ready: "প্রস্তুত", marked: "মূল্যায়িত",
};
export const VOCAB_TEST_STATUS_LABELS_EN: Record<VocabTestStatus, string> = {
  draft: "Draft", ready: "Ready", marked: "Marked",
};

/** Source of a weekly tester assignment (VC-2, §3.5). `direct` = the admin assigned
 *  the tester (roster:manage); `proxy` = recorded as riding a D-#20 cover grant. The
 *  resolver also composes an active proxy grant at request time (D-#21/#22) so a
 *  covering teacher can build/mark even without a stored `proxy` row. */
export const VOCAB_ASSIGNMENT_SOURCES = ["direct", "proxy"] as const;
export type VocabAssignmentSource = (typeof VOCAB_ASSIGNMENT_SOURCES)[number];

export const VOCAB_ASSIGNMENT_SOURCE_LABELS_BN: Record<VocabAssignmentSource, string> = {
  direct: "সরাসরি", proxy: "প্রক্সি (কভার)",
};
export const VOCAB_ASSIGNMENT_SOURCE_LABELS_EN: Record<VocabAssignmentSource, string> = {
  direct: "Direct", proxy: "Proxy (cover)",
};

/** Per-(student × test) attendance status (VC-3, §3.6/§4). PRESENT is marked +
 *  scored; ABSENT is the whole-test absence (one flag per student per test, sheet
 *  parity) — excluded from score denominators, feeds the Absent guardian template. */
export const VOCAB_ATTENDANCE_STATUSES = ["PRESENT", "ABSENT"] as const;
export type VocabAttendanceStatus = (typeof VOCAB_ATTENDANCE_STATUSES)[number];

export const VOCAB_ATTENDANCE_STATUS_LABELS_BN: Record<VocabAttendanceStatus, string> = {
  PRESENT: "উপস্থিত", ABSENT: "অনুপস্থিত",
};
export const VOCAB_ATTENDANCE_STATUS_LABELS_EN: Record<VocabAttendanceStatus, string> = {
  PRESENT: "Present", ABSENT: "Absent",
};


// --- A.14 MESSAGE-TEMPLATE VOCAB (app-native; Message Templates module — -------
// prd-message-templates, D-#128–#131). NO wire-contract twin: a generated-message
// template is a feature, not import content, and every body is operational/
// identity-plane behind the ADR-005 firewall — no envelope-schema mirror, no
// two-place sync; only /shared + the vocab verifier run.
//
// THE CODE-DEFAULT REGISTRY (D-#128, §3.2): MESSAGE_TEMPLATE_REGISTRY is the
// "printed page" — one entry per controlled key (MESSAGE_TEMPLATE_KEYS), declaring
// AS DATA its allowed placeholder set, its default Bangla body, an optional default
// English body, and its default language mode. The defaults are the CURRENT inline
// strings lifted VERBATIM during MT-2, so adoption is byte-identical (D-#131). The
// admin override (a MessageTemplate DB row) wins at read-time; absent ⇒ this default
// is used (no seed write ever runs — D-#97/#103). Placeholder tokens are `{curly}`;
// the renderer replaces `{name}` with `params[name]` (a missing declared placeholder
// renders BLANK, never throws — D-#129). A title and a body are SEPARATE keys (each
// independently editable); wa.me messages are body-only (`*.wa`). The ONE new
// permission `template:manage` is PRINCIPAL-only (verifier-proven exact-holder set,
// the payroll:approve / performance:signoff posture — D-#129).

/** Per-template language mode (D-#130). Default BN; BOTH renders Bangla then English
 *  in one body. A template cannot be set to EN/BOTH while its English body is empty
 *  (the empty-English-send guard) — enforced at edit time + asserted in the verifier. */
export const TEMPLATE_LANGUAGE_MODES = ["BN", "EN", "BOTH"] as const;
export type TemplateLanguageMode = (typeof TEMPLATE_LANGUAGE_MODES)[number];

export const TEMPLATE_LANGUAGE_MODE_LABELS_BN: Record<TemplateLanguageMode, string> = {
  BN: "বাংলা", EN: "ইংরেজি", BOTH: "বাংলা ও ইংরেজি",
};
export const TEMPLATE_LANGUAGE_MODE_LABELS_EN: Record<TemplateLanguageMode, string> = {
  BN: "Bangla", EN: "English", BOTH: "Bangla & English",
};

/** A code-default template declaration (the §3.2 "printed page" entry). */
export interface MessageTemplateDef {
  /** Feature group for the MT-3 list (English code; the app supplies the Bangla group label). */
  group: string;
  /** Bangla human label of what this message is (the MT-3 list row). */
  labelBn: string;
  /** The blanks this message provides — a body may use ONLY these placeholders (D-#129). */
  placeholders: readonly string[];
  /** Default Bangla body — the current inline string, lifted VERBATIM (D-#131). */
  bnDefault: string;
  /** Optional default English body (hand-written; none today — every live string is BN). */
  enDefault?: string;
  /** Default language mode (D-#130; BN for every migrated default → byte-identical). */
  defaultLangMode: TemplateLanguageMode;
}

/** Controlled key set — one per generated-message variant (D-#128). */
export const MESSAGE_TEMPLATE_KEYS = [
  "classNote.published.title",
  "classNote.published.body",
  "classNote.prompt.title",
  "classNote.prompt.body",
  "classNote.escalation.title",
  "classNote.escalation.body",
  "homework.parentComms.title",
  "homework.parentComms.body",
  "review.assigned.title",
  "review.assigned.body",
  "cover.assigned.title",
  "cover.assigned.body",
  "bell.reminder.title",
  "bell.reminder.body",
  "attendance.reminder.marker.title",
  "attendance.reminder.marker.body",
  "attendance.reminder.office.title",
  "attendance.reminder.office.body",
  "attendance.reminder.principal.title",
  "attendance.reminder.principal.body",
  "library.dueSoon.title",
  "library.dueSoon.body",
  "library.overdue.title",
  "library.overdue.body",
  "library.overdue.wa",
  "assignment.chase.title",
  "assignment.chase.body",
  "credential.share.guardian.wa",
  "credential.share.staff.wa",
  "tracker.nonSubmitter.wa",
  "vocab.result.title",
  "vocab.result.regular.body",
  "vocab.result.perfect.body",
  "vocab.result.absent.body",
  "vocab.result.cumulative.body",
  "class_test.result.title",
  "class_test.result.regular.body",
  "class_test.result.excellent.body",
  "class_test.result.absent.body",
] as const;
export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];

/** The code-default registry (D-#128/#131). `Record<MessageTemplateKey, …>` makes
 *  tsc enforce one entry per key (the verifier double-checks totality + that every
 *  `{token}` in a default is a declared placeholder). EVERY bnDefault is the current
 *  inline string, lifted verbatim — DO NOT reword (it would break byte-identical). */
export const MESSAGE_TEMPLATE_REGISTRY: Record<MessageTemplateKey, MessageTemplateDef> = {
  // --- Class notes (N1.3 / N2.3 / N2.4) ---
  "classNote.published.title": {
    group: "classNote", labelBn: "পাঠ নোট প্রকাশিত — শিরোনাম", placeholders: [],
    bnDefault: "পাঠ নোট প্রকাশিত হয়েছে", defaultLangMode: "BN",
  },
  "classNote.published.body": {
    group: "classNote", labelBn: "পাঠ নোট প্রকাশিত — বার্তা", placeholders: ["subject"],
    bnDefault: "{subject} — আজ ক্লাসে যা পড়ানো হয়েছে তার নোট প্রকাশিত হয়েছে।", defaultLangMode: "BN",
  },
  "classNote.prompt.title": {
    group: "classNote", labelBn: "পাঠ নোট লেখার তাগিদ — শিরোনাম", placeholders: [],
    bnDefault: "পাঠ নোট লেখা বাকি", defaultLangMode: "BN",
  },
  "classNote.prompt.body": {
    group: "classNote", labelBn: "পাঠ নোট লেখার তাগিদ — বার্তা", placeholders: ["count", "lines"],
    bnDefault: "আজকের {count}টি পাঠ নোট এখনও লেখা হয়নি: {lines}। ডেইলি নোট স্ক্রিনে লিখুন।", defaultLangMode: "BN",
  },
  "classNote.escalation.title": {
    group: "classNote", labelBn: "পাঠ নোট অনিষ্পন্ন (এসকেলেশন) — শিরোনাম", placeholders: [],
    bnDefault: "পাঠ নোট অনিষ্পন্ন", defaultLangMode: "BN",
  },
  "classNote.escalation.body": {
    group: "classNote", labelBn: "পাঠ নোট অনিষ্পন্ন (এসকেলেশন) — বার্তা", placeholders: ["count", "lines"],
    bnDefault: "আজ {count}টি পাঠ নোট এখনও লেখা হয়নি: {lines}", defaultLangMode: "BN",
  },
  // --- Homework parent-comms (N1.4) ---
  "homework.parentComms.title": {
    group: "homework", labelBn: "অভিভাবক যোগাযোগের তাগিদ — শিরোনাম", placeholders: [],
    bnDefault: "অভিভাবকের সাথে যোগাযোগ প্রয়োজন", defaultLangMode: "BN",
  },
  "homework.parentComms.body": {
    group: "homework", labelBn: "অভিভাবক যোগাযোগের তাগিদ — বার্তা", placeholders: ["hwId", "chaseCount"],
    bnDefault: "বাড়ির কাজ {hwId}: একজন শিক্ষার্থীর তাগাদা {chaseCount} বার হয়েছে — অভিভাবককে জানান।", defaultLangMode: "BN",
  },
  // --- Plan review assigned (N1.5) ---
  "review.assigned.title": {
    group: "review", labelBn: "পর্যালোচনার দায়িত্ব — শিরোনাম", placeholders: [],
    bnDefault: "পরিকল্পনা পর্যালোচনার দায়িত্ব", defaultLangMode: "BN",
  },
  "review.assigned.body": {
    group: "review", labelBn: "পর্যালোচনার দায়িত্ব — বার্তা",
    placeholders: ["subject", "classLevel", "anchorWord", "addressNumber", "roundNumber"],
    bnDefault: "{subject} · শ্রেণি {classLevel} · {anchorWord} {addressNumber} — পরিকল্পনাটি আপনার পর্যালোচনার জন্য নির্ধারিত হয়েছে (রাউন্ড {roundNumber})।", defaultLangMode: "BN",
  },
  // --- Cover assigned (N1.6) ---
  "cover.assigned.title": {
    group: "cover", labelBn: "কাভার ক্লাসের দায়িত্ব — শিরোনাম", placeholders: [],
    bnDefault: "কাভার ক্লাসের দায়িত্ব", defaultLangMode: "BN",
  },
  "cover.assigned.body": {
    group: "cover", labelBn: "কাভার ক্লাসের দায়িত্ব — বার্তা", placeholders: ["dateKey"],
    bnDefault: "{dateKey} তারিখে একটি ক্লাস কাভারের দায়িত্ব আপনাকে দেওয়া হয়েছে — আমার রুটিন দেখুন।", defaultLangMode: "BN",
  },
  // --- Bell reminder (N2.1) ---
  "bell.reminder.title": {
    group: "bell", labelBn: "ঘণ্টার স্মরণিকা — শিরোনাম", placeholders: [],
    bnDefault: "ঘণ্টা বাজানোর স্মরণিকা", defaultLangMode: "BN",
  },
  "bell.reminder.body": {
    group: "bell", labelBn: "ঘণ্টার স্মরণিকা — বার্তা", placeholders: ["periodNumber", "endHHMM"],
    bnDefault: "পিরিয়ড {periodNumber} শেষ হবে {endHHMM}-এ — ঘণ্টা বাজানোর প্রস্তুতি নিন।", defaultLangMode: "BN",
  },
  // --- Attendance reminders, per tier (AT-4 / N-2, D-#99) ---
  "attendance.reminder.marker.title": {
    group: "attendance", labelBn: "উপস্থিতি স্মরণিকা (শিক্ষক) — শিরোনাম", placeholders: [],
    bnDefault: "উপস্থিতি চিহ্নিত করুন", defaultLangMode: "BN",
  },
  "attendance.reminder.marker.body": {
    group: "attendance", labelBn: "উপস্থিতি স্মরণিকা (শিক্ষক) — বার্তা", placeholders: ["section"],
    bnDefault: "{section} সেকশনের আজকের উপস্থিতি এখনও চিহ্নিত হয়নি — অনুগ্রহ করে এখনই চিহ্নিত করুন।", defaultLangMode: "BN",
  },
  "attendance.reminder.office.title": {
    group: "attendance", labelBn: "উপস্থিতি স্মরণিকা (অফিস) — শিরোনাম", placeholders: [],
    bnDefault: "উপস্থিতি চিহ্নিত হয়নি", defaultLangMode: "BN",
  },
  "attendance.reminder.office.body": {
    group: "attendance", labelBn: "উপস্থিতি স্মরণিকা (অফিস) — বার্তা", placeholders: ["section"],
    bnDefault: "{section} সেকশনের আজকের উপস্থিতি এখনও চিহ্নিত হয়নি (অফিসে প্রেরিত)।", defaultLangMode: "BN",
  },
  "attendance.reminder.principal.title": {
    group: "attendance", labelBn: "উপস্থিতি স্মরণিকা (অধ্যক্ষ) — শিরোনাম", placeholders: [],
    bnDefault: "উপস্থিতি চিহ্নিত হয়নি", defaultLangMode: "BN",
  },
  "attendance.reminder.principal.body": {
    group: "attendance", labelBn: "উপস্থিতি স্মরণিকা (অধ্যক্ষ) — বার্তা", placeholders: ["section"],
    bnDefault: "{section} সেকশনের আজকের উপস্থিতি এখনও চিহ্নিত হয়নি (অধ্যক্ষকে প্রেরিত)।", defaultLangMode: "BN",
  },
  // --- Library reminders (LB-5, D-#84) ---
  "library.dueSoon.title": {
    group: "library", labelBn: "বই ফেরতের স্মরণিকা — শিরোনাম", placeholders: [],
    bnDefault: "বই ফেরতের স্মরণিকা", defaultLangMode: "BN",
  },
  "library.dueSoon.body": {
    group: "library", labelBn: "বই ফেরতের স্মরণিকা — বার্তা", placeholders: ["title", "dueKey"],
    bnDefault: "“{title}” বইটির ফেরতের তারিখ আগামীকাল ({dueKey})। অনুগ্রহ করে সময়মতো ফেরত দিন।", defaultLangMode: "BN",
  },
  "library.overdue.title": {
    group: "library", labelBn: "বই ফেরত বকেয়া (ইনবক্স) — শিরোনাম", placeholders: [],
    bnDefault: "বই ফেরত বকেয়া", defaultLangMode: "BN",
  },
  "library.overdue.body": {
    group: "library", labelBn: "বই ফেরত বকেয়া (ইনবক্স) — বার্তা", placeholders: ["title", "dueKey"],
    bnDefault: "“{title}” বইটির ফেরতের তারিখ ({dueKey}) পেরিয়ে গেছে। অনুগ্রহ করে বইটি লাইব্রেরিতে ফেরত দিন।", defaultLangMode: "BN",
  },
  "library.overdue.wa": {
    group: "library", labelBn: "বই ফেরত বকেয়া (হোয়াটসঅ্যাপ)",
    placeholders: ["borrowerName", "title", "accessionNo", "dueDateKey"],
    bnDefault:
      "আসসালামু আলাইকুম {borrowerName}। SCD লাইব্রেরি থেকে নেওয়া বইটির ফেরতের তারিখ পেরিয়ে গেছে:\n" +
      "বই: {title} ({accessionNo})\n" +
      "ফেরতের তারিখ ছিল: {dueDateKey}\n" +
      "অনুগ্রহ করে বইটি লাইব্রেরিতে ফেরত দিন। জাযাকাল্লাহু খাইরান।",
    defaultLangMode: "BN",
  },
  // --- Assignment guardian chase (AS-T4, D-#88): the body is shared by the in-app
  //     inbox row (steps 1–2) AND the wa.me link (step 3+) — one source. ---
  "assignment.chase.title": {
    group: "assignment", labelBn: "অ্যাসাইনমেন্ট চেজ — শিরোনাম", placeholders: [],
    bnDefault: "অ্যাসাইনমেন্ট জমা হয়নি", defaultLangMode: "BN",
  },
  "assignment.chase.body": {
    group: "assignment", labelBn: "অ্যাসাইনমেন্ট চেজ — বার্তা (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["studentName", "subject", "asId", "deliveryDate", "dueDate"],
    bnDefault:
      "আসসালামু আলাইকুম। সম্মানিত অভিভাবক, " +
      "আপনার সন্তান {studentName}-এর {subject} অ্যাসাইনমেন্টটি ({asId}) এখনও জমা হয়নি। " +
      "অ্যাসাইনমেন্টটি {deliveryDate} তারিখে দেওয়া হয়েছিল এবং " +
      "{dueDate} তারিখে জমা দেওয়ার কথা ছিল। " +
      "অনুগ্রহ করে আপনার সন্তানকে অ্যাসাইনমেন্টটি দ্রুত জমা দিতে সহায়তা করুন। " +
      "মা'আসসালামাহ — SCD Admin",
    defaultLangMode: "BN",
  },
  // --- Credential share (D-#59/#60) — one variant per audience (the (who) is baked in). ---
  "credential.share.guardian.wa": {
    group: "credential", labelBn: "লগইন তথ্য শেয়ার (অভিভাবক)",
    placeholders: ["name", "identifier", "password"],
    bnDefault:
      "আসসালামু আলাইকুম {name}। SCD Hub অ্যাপে আপনার (অভিভাবক) লগইন তথ্য:\n" +
      "আইডি: {identifier}\n" +
      "পাসওয়ার্ড: {password}\n" +
      "অনুগ্রহ করে তথ্যগুলো গোপন রাখুন এবং প্রথমবার লগইনের পর সংরক্ষণ করুন।",
    defaultLangMode: "BN",
  },
  "credential.share.staff.wa": {
    group: "credential", labelBn: "লগইন তথ্য শেয়ার (শিক্ষক/স্টাফ)",
    placeholders: ["name", "identifier", "password"],
    bnDefault:
      "আসসালামু আলাইকুম {name}। SCD Hub অ্যাপে আপনার (শিক্ষক/স্টাফ) লগইন তথ্য:\n" +
      "আইডি: {identifier}\n" +
      "পাসওয়ার্ড: {password}\n" +
      "অনুগ্রহ করে তথ্যগুলো গোপন রাখুন এবং প্রথমবার লগইনের পর সংরক্ষণ করুন।",
    defaultLangMode: "BN",
  },
  // --- Tracker non-submitter wa.me (J4.2, R-T2) ---
  "tracker.nonSubmitter.wa": {
    group: "tracker", labelBn: "জমা দেয়নি — অভিভাবক (হোয়াটসঅ্যাপ)",
    placeholders: ["studentName", "setTitle"],
    bnDefault: "প্রিয় অভিভাবক, আপনার সন্তান {studentName} \"{setTitle}\" জমা দেননি। অনুগ্রহ করে শিক্ষকের সাথে যোগাযোগ করুন।", defaultLangMode: "BN",
  },
  // --- Vocabulary-tracker guardian messages (VC-4, §8 — the legacy Setup-tab
  //     Regular / Perfect / Absent / Cumulative templates, ported as editable
  //     admin data with the Islamic salutation + du'a preserved; one body shared
  //     by the in-app inbox AND the wa.me link). {WrongWords}/{PersistentWords}
  //     are server-rendered per-direction lists (generalising the legacy
  //     SecB/SecC/SecD lists). {School} is filled from the school name. ---
  "vocab.result.title": {
    group: "vocab", labelBn: "ভোকাবুলারি ফলাফল — শিরোনাম", placeholders: [],
    bnDefault: "ভোকাবুলারি টেস্টের ফলাফল", defaultLangMode: "BN",
  },
  "vocab.result.regular.body": {
    group: "vocab", labelBn: "ভোকাবুলারি ফলাফল — সাধারণ (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["StudentName", "TestDate", "Score", "TotalMarks", "WrongCount", "WrongWords", "School"],
    bnDefault:
      "আসসালামু আলাইকুম। সম্মানিত অভিভাবক, " +
      "আপনার সন্তান {StudentName} {TestDate} তারিখের ভোকাবুলারি টেস্টে " +
      "{TotalMarks} নম্বরের মধ্যে {Score} পেয়েছে (ভুল: {WrongCount}টি)।\n" +
      "যেসব শব্দ ভুল হয়েছে:\n{WrongWords}\n" +
      "অনুগ্রহ করে শব্দগুলো বাড়িতে অনুশীলন করান। জাযাকাল্লাহু খাইরান — {School}",
    defaultLangMode: "BN",
  },
  "vocab.result.perfect.body": {
    group: "vocab", labelBn: "ভোকাবুলারি ফলাফল — পূর্ণ নম্বর (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["StudentName", "TestDate", "Score", "TotalMarks", "School"],
    bnDefault:
      "আসসালামু আলাইকুম। সম্মানিত অভিভাবক, আলহামদুলিল্লাহ! " +
      "আপনার সন্তান {StudentName} {TestDate} তারিখের ভোকাবুলারি টেস্টে " +
      "{TotalMarks} নম্বরের মধ্যে {Score} পেয়ে সম্পূর্ণ সঠিক করেছে। " +
      "আল্লাহ তাকে আরও উন্নতি দান করুন। জাযাকাল্লাহু খাইরান — {School}",
    defaultLangMode: "BN",
  },
  "vocab.result.absent.body": {
    group: "vocab", labelBn: "ভোকাবুলারি ফলাফল — অনুপস্থিত (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["StudentName", "TestDate", "School"],
    bnDefault:
      "আসসালামু আলাইকুম। সম্মানিত অভিভাবক, " +
      "আপনার সন্তান {StudentName} {TestDate} তারিখের ভোকাবুলারি টেস্টে অনুপস্থিত ছিল। " +
      "পরবর্তী টেস্টে অংশগ্রহণ নিশ্চিত করুন। জাযাকাল্লাহু খাইরান — {School}",
    defaultLangMode: "BN",
  },
  "vocab.result.cumulative.body": {
    group: "vocab", labelBn: "ভোকাবুলারি ফলাফল — ক্রমপুঞ্জিত (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["StudentName", "PeriodLabel", "NumTests", "Score", "TotalMarks", "PersistentWords", "School"],
    bnDefault:
      "আসসালামু আলাইকুম। সম্মানিত অভিভাবক, " +
      "{PeriodLabel} সময়কালে আপনার সন্তান {StudentName} {NumTests}টি ভোকাবুলারি টেস্টে অংশ নিয়েছে, " +
      "গড়ে {TotalMarks} নম্বরের মধ্যে {Score} পেয়েছে।\n" +
      "বারবার ভুল হওয়া শব্দ:\n{PersistentWords}\n" +
      "অনুগ্রহ করে এই শব্দগুলোতে বিশেষ মনোযোগ দিন। জাযাকাল্লাহু খাইরান — {School}",
    defaultLangMode: "BN",
  },

  // --- Class-test results (CT-3, prd-tracker-class-test §8 — the three Bangla
  // templates ship VERBATIM on the registry per D-#131 [no inline-then-migrate];
  // Islamic salutation + du'a preserved; a weak score is NEVER framed as "fail".
  // Regular = a result WITH a teacher-entered weakness; Excellent = no weakness. ---
  "class_test.result.title": {
    group: "classTest", labelBn: "ক্লাস টেস্ট ফলাফল — শিরোনাম", placeholders: [],
    bnDefault: "ক্লাস টেস্টের ফলাফল", defaultLangMode: "BN",
  },
  "class_test.result.regular.body": {
    group: "classTest", labelBn: "ক্লাস টেস্ট ফলাফল — সাধারণ (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["StudentName", "Subject", "TestNumber", "Marks", "TotalMarks", "Weakness", "GuardianAction"],
    bnDefault:
      "আসসালামু আলাইকুম। {StudentName}-এর {Subject} ক্লাস টেস্ট ({TestNumber}) ফলাফল — প্রাপ্ত নম্বর: {Marks}/{TotalMarks}।\n" +
      "লক্ষণীয় দিক: {Weakness}\n" +
      "অভিভাবকের করণীয়: {GuardianAction}\n" +
      "আল্লাহ তাকে উত্তরোত্তর উন্নতি দান করুন, আমীন। কোনো জিজ্ঞাসা থাকলে জানাবেন। জাযাকাল্লাহু খাইরান।",
    defaultLangMode: "BN",
  },
  "class_test.result.excellent.body": {
    group: "classTest", labelBn: "ক্লাস টেস্ট ফলাফল — চমৎকার / লক্ষণীয় দিক নেই (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["StudentName", "Subject", "TestNumber", "Marks", "TotalMarks"],
    bnDefault:
      "আসসালামু আলাইকুম। আলহামদুলিল্লাহ! {StudentName} {Subject} ক্লাস টেস্ট ({TestNumber})-এ চমৎকার করেছে — {Marks}/{TotalMarks}। " +
      "আল্লাহুম্মা বারিক। এই ধারাবাহিকতা ধরে রাখতে তাকে উৎসাহ দিন। জাযাকাল্লাহু খাইরান।",
    defaultLangMode: "BN",
  },
  "class_test.result.absent.body": {
    group: "classTest", labelBn: "ক্লাস টেস্ট ফলাফল — অনুপস্থিত (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["StudentName", "TestDate", "Subject", "TestNumber"],
    bnDefault:
      "আসসালামু আলাইকুম। {StudentName} {TestDate}-এর {Subject} ক্লাস টেস্টে ({TestNumber}) অনুপস্থিত ছিল। " +
      "নিয়মিত উপস্থিতি তার জন্য জরুরি — অনুগ্রহ করে উপস্থিতি নিশ্চিত করুন। জাযাকাল্লাহু খাইরান।",
    defaultLangMode: "BN",
  },
};


// =============================================================================
// SECTION B — RBAC: ROLES, PERMISSIONS, ROLE→PERMISSION MAP
// =============================================================================
// Model: action-level RBAC, DEFAULT-DENY (R-AC1), PoLP (R-AC2). Enforced in
// resolvers (ADR-004), where row-scope (R-AC3) and the plane boundary (ADR-005)
// are layered on top of the grant check below. Hardcoded now, data-drivable later
// (no permission-admin UI in the build).

/** Authenticated roles. Student is DATA-ONLY (no login, minor-safety posture,
 *  REQ §2) and therefore is not a role here. */
export const ROLES = ["PRINCIPAL", "TEACHER", "OFFICE", "GUARDIAN"] as const;
export type Role = (typeof ROLES)[number];

/** Action-level permissions, `resource:action`. Default-deny: a permission not
 *  listed for a role is denied. */
export const PERMISSIONS = [
  // content (publisher seam + lifecycle)
  "content:read",
  "content:import",        // the import gate; granted to Principal + Office
  "content:assign_review", // assign/cancel a plan-review round + read the inbox (Principal/Office, D-#39)
  "content:review",        // draft → reviewed — a reviewer's APPROVE verdict (D-#38; now also TEACHER)
  "content:promote_gold",  // reviewed → gold (Principal-locked sign-off, D-#38)
  // questions + assembly
  "question:read",
  "question:select",
  "set:read",
  "set:assemble",
  "set:export",            // server-side PDF (R-A4/R-C6)
  // trackers
  "tracker:read",
  "tracker:write",
  "tracker:export",
  // routine / timetable (app-native; D-#46)
  "routine:read",          // read the routine (Principal/Teacher/Office; guardian read rides guardian:read_child — narrow slot, D-#69)
  "routine:manage",        // build/edit calendar, rooms, groups, grids, slots (Principal/Office)
  // attendance (app-native; D-#63–#67)
  "attendance:mark",       // mark a section's absentees — gated to the section's marker-of-the-day (CT-2, D-#64)
  "attendance:manage",     // upload teacher Excel, resolve names, assign markers, full reports (Principal/Office)
  // library (app-native; D-#81–#84)
  "library:read",          // browse the catalog + own loans/reservations (Principal/Teacher/Office)
  "library:manage",        // desk ops, catalog, policy, librarian assignment (Principal/Office); a TEACHER
                           // passes DESK-OP gates only via assertIsLibrarian (LibrarianAssignment) — the
                           // TEACHER permission set is NOT widened (D-#17, D-#42 pattern)
  // messaging / staff chat (app-native; D-#76–#79)
  "chat:read",             // read own conversations + messages (Principal/Teacher/Office; every row membership-gated in the resolver)
  "chat:write",            // open 1:1, send messages, mark seen (same roles; membership-gated)
  "chat:manage",           // group create/edit, membership, posting policy, resync (Principal/Office; ACTIVE since M-2, D-#98)
  "chat:oversee",          // PRINCIPAL ONLY — read-override on ANY conversation incl. 1:1; each open itself audited (D-#77; ACTIVE since M-6, D-#111)
  // foundation / ops
  "roster:manage",
  "staff:manage",          // HR staff-record read/manage (Principal/Office; prd-hr H1.4 row-scope)
  "leave:manage",          // HR staff-LEAVE admin: entitlements, approve/reject, cover approval, all balances (Principal/Office; prd-hr H2, D-#22). Teacher own-row self-apply needs NO permission.
  "payroll:manage",        // HR PAYROLL: set pay, prepare/recompute a monthly run, read payslips/export/advances (Principal/Office; prd-hr H4, D-#109)
  "payroll:approve",       // PRINCIPAL ONLY — approve+LOCK a payroll run + issue/settle advances (prd-hr H4.2/H4.5/H4.7; Office cannot approve, D-#109)
  "performance:manage",    // HR PERFORMANCE/CONDUCT/DEVELOPMENT: read+manage observations(all)/appraisals(prepare)/conduct ladder/grievances/CPD (Principal/Office; prd-hr H5, D-#112). Supervisor observation-WRITE is NOT this — it rides the existing supervisory scope (D-#28).
  "performance:signoff",   // PRINCIPAL ONLY — sign off an appraisal outcome + finalize a conduct step (the central judgement; Office cannot sign off, prd-hr §2/H5.2, D-#112)
  "guardian:link",
  "message:dispatch",      // wa.me / notices manual send (R-T2)
  "user:manage",
  "audit:read",            // Principal reads; audit is system-appended, never user-written
  "template:manage",       // PRINCIPAL ONLY — edit/reset the generated-message templates (Message Templates, D-#129; verifier-proven exact-holder set, the payroll:approve posture)
  // guardian portal (ACTIVE since GP-1, D-#68)
  "guardian:read_child",   // reads linked children's permitted operational slices
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Which permissions are active in the first-priority build vs. land with a later
 *  module. The feature-flag/resolver layer gates "pipeline" perms off until shipped. */
export const PERMISSION_BUILD_STATUS: Record<Permission, "build" | "pipeline"> = {
  "content:read": "build",
  "content:import": "build",
  "content:assign_review": "build",
  "content:review": "build",
  "content:promote_gold": "build",
  "question:read": "build",
  "question:select": "build",
  "set:read": "build",
  "set:assemble": "build",
  "set:export": "build",
  "tracker:read": "build",
  "tracker:write": "build",
  "tracker:export": "build",
  "routine:read": "build",
  "routine:manage": "build",
  "attendance:mark": "build",
  "attendance:manage": "build",
  "library:read": "build",
  "library:manage": "build",
  "chat:read": "build",     // M-1 (1:1 chat + receipts)
  "chat:write": "build",    // M-1
  "chat:manage": "build",   // ACTIVATED by M-2 (groups + posting policy + resync, D-#98 flip)
  "chat:oversee": "build",  // ACTIVATED by M-6 (Principal read-oversight + audited open, D-#77/#111)
  "roster:manage": "build",
  "staff:manage": "build",
  "leave:manage": "build",  // HR step 2 (staff leave admin surface)
  "payroll:manage": "build", // HR step 3 (payroll prepare + pay records + reads)
  "payroll:approve": "build", // HR step 3 (Principal lock + advances)
  "performance:manage": "build", // HR step 4 (performance/conduct/development admin surface)
  "performance:signoff": "build", // HR step 4 (Principal appraisal sign-off + conduct finalize)
  "guardian:link": "build",
  "message:dispatch": "build",
  "user:manage": "build",
  "audit:read": "build",
  "template:manage": "build", // Message Templates MT-1 (Principal-only edit/reset, D-#129)
  "guardian:read_child": "build", // ACTIVATED by Guardian Portal GP-1 (D-#68; was pipeline since Slice 0)
};

/** ROLE → granted permissions. DEFAULT-DENY: anything not listed is denied. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Super-admin: full operational visibility + user/role management. Reads (never
  // edits) the audit log. No guardian:read_child — Principal sees children via
  // unscoped staff views (tracker:read), not the guardian-scoped resolver path.
  PRINCIPAL: [
    "content:read", "content:import", "content:assign_review", "content:review", "content:promote_gold",
    "question:read", "question:select",
    "set:read", "set:assemble", "set:export",
    "tracker:read", "tracker:write", "tracker:export",
    "routine:read", "routine:manage",
    "attendance:manage", // NOT attendance:mark — Principal assigns markers, doesn't mark (D-#64)
    "library:read", "library:manage",
    "chat:read", "chat:write", "chat:manage",
    "chat:oversee",          // PRINCIPAL ONLY (D-#77) — every oversight open is audited (M-6)
    "roster:manage", "staff:manage", "leave:manage", "payroll:manage", "payroll:approve",
    "performance:manage", "performance:signoff", "guardian:link", "message:dispatch",
    "user:manage", "audit:read",
    "template:manage",       // PRINCIPAL ONLY (D-#129) — Office/Teacher/Guardian never get it
  ],
  // Row-scoped to own sections (SCOPE_RULES). Consumes content, assembles sets,
  // fills trackers; authors nothing in-app (no content:import). message:dispatch
  // granted for the tracker→non-submitter wa.me flow (R-T2).
  TEACHER: [
    "content:read",
    "content:review",        // a teacher reviewer's APPROVE verdict drives draft→reviewed (D-#38)
    "question:read", "question:select",
    "set:read", "set:assemble", "set:export",
    "tracker:read", "tracker:write", "tracker:export",
    "routine:read",          // a teacher reads their own + their sections' routine (D-#46)
    "attendance:mark",       // row-scoped further to "the section's marker today" (CT-2, D-#64)
    "library:read",          // browse the catalog + own loans/reservations; desk ops only via LibrarianAssignment (D-#81)
    "chat:read", "chat:write", // staff chat (D-#76) — 1:1 + group membership; NO chat:manage (teachers cannot create groups, D-#78)
    "message:dispatch",
  ],
  // Roster, guardian linkage, messaging dispatch (REQ §2), plus content import (the
  // publisher seam), plan-review assignment (D-#39), and routine authoring (D-#46).
  // No tracker/user surface under PoLP.
  OFFICE: [
    "roster:manage", "staff:manage", "leave:manage", "payroll:manage", "performance:manage", "guardian:link", "message:dispatch",
    "content:import", "content:assign_review",
    "routine:read", "routine:manage",
    "attendance:manage",     // upload teacher Excel, assign markers, chase guardians (D-#64/#65; no mark)
    "library:read", "library:manage", // the default library desk (D-#81)
    "chat:read", "chat:write", "chat:manage", // staff chat + group/posting-policy admin (D-#76/#78); NO chat:oversee (Principal only, D-#77)
  ],
  // Guardian portal v1 (GP-1, D-#68): the single grant is ACTIVE — guardian-scoped
  // resolvers read linked children only (assertGuardianOfStudent, link-scoped).
  // Row-scoped to linked children (uniform access, D-#8); corpus plane unreachable.
  GUARDIAN: [
    "guardian:read_child",
  ],
};

/** Row-scope coordination reference for the resolver layer (ADR-004). Prose, not a
 *  runtime guard — the resolver middleware implements these predicates. */
export const SCOPE_RULES: Record<Role, string> = {
  PRINCIPAL:
    "Unscoped (full visibility). audit:read is read-only; audit is never user-writable.",
  TEACHER:
    "Scope = UNION of scope grants (D-#17/#18, ADR-017), not just own sections: " +
    "(a) TEACHING — own sections via class→section assignment: content:read, set:*, tracker:*, message:dispatch apply there; " +
    "(b) SUPERVISORY (Class Teacher / Coordinator / Subject Lead) — READ-ONLY oversight (*:read only) over a configurable extent: whole-school, grade/class (all subjects), subject/department (all classes), or an explicit assigned set; no assemble/tracker-write; " +
    "(c) PROXY/cover — for the covered class only: read chapter+lesson plans, set:assemble (assign HW), tracker:write — a bounded write overlay. " +
    "Resolvers compose the union; the corpus-plane boundary still overrides (no overlay reaches identity from the corpus side).",
  OFFICE:
    "Unscoped on roster/guardian-linkage/messaging/content-import; holds no tracker/user permissions. content:import is not row-scoped (publisher seam).",
  GUARDIAN:
    "Row-scoped to linked children via guardian_links (uniform access, D-#8); never sees staff-internal views or the audit log; has no resolver path into the corpus plane.",
};

// --- B.1 HELPERS (pure; resolver middleware composes row-scope on top) --------

const ROLE_PERMISSION_SETS: Record<Role, ReadonlySet<Permission>> = ROLES.reduce(
  (acc, r) => {
    acc[r] = new Set<Permission>(ROLE_PERMISSIONS[r]);
    return acc;
  },
  {} as Record<Role, ReadonlySet<Permission>>,
);

/** Default-deny grant check. Row-scope and plane boundary are enforced separately
 *  in the resolver (ADR-004); a true here means "the role may attempt the action",
 *  not "for this row". */
export function roleHasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSION_SETS[role]?.has(perm) ?? false;
}

/** All permissions a role holds (read-only copy). */
export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** True if the permission is active in the current build (not a deferred/pipeline grant). */
export function isPermissionActive(perm: Permission): boolean {
  return PERMISSION_BUILD_STATUS[perm] === "build";
}
