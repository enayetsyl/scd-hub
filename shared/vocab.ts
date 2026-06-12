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

/** Employment status — lifecycle gate; feeds offboarding (prd-hr §2.4). Independent of type. */
export const EMPLOYMENT_STATUSES = ["probation", "confirmed", "resigned", "terminated"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const EMPLOYMENT_STATUS_LABELS_BN: Record<EmploymentStatus, string> = {
  probation: "শিক্ষানবিশ",
  confirmed: "স্থায়ী",
  resigned: "পদত্যাগী",
  terminated: "অব্যাহতিপ্রাপ্ত",
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
  "routine:read",          // read the routine (Principal/Teacher/Office; guardian read is pipeline)
  "routine:manage",        // build/edit calendar, rooms, groups, grids, slots (Principal/Office)
  // attendance (app-native; D-#63–#67)
  "attendance:mark",       // mark a section's absentees — gated to the section's marker-of-the-day (CT-2, D-#64)
  "attendance:manage",     // upload teacher Excel, resolve names, assign markers, full reports (Principal/Office)
  // foundation / ops
  "roster:manage",
  "staff:manage",          // HR staff-record read/manage (Principal/Office; prd-hr H1.4 row-scope)
  "guardian:link",
  "message:dispatch",      // wa.me / notices manual send (R-T2)
  "user:manage",
  "audit:read",            // Principal reads; audit is system-appended, never user-written
  // guardian portal (DEFERRED — see PERMISSION_BUILD_STATUS)
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
  "roster:manage": "build",
  "staff:manage": "build",
  "guardian:link": "build",
  "message:dispatch": "build",
  "user:manage": "build",
  "audit:read": "build",
  "guardian:read_child": "pipeline", // guardian portal screens deferred (REQ §2/§9)
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
    "roster:manage", "staff:manage", "guardian:link", "message:dispatch",
    "user:manage", "audit:read",
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
    "message:dispatch",
  ],
  // Roster, guardian linkage, messaging dispatch (REQ §2), plus content import (the
  // publisher seam), plan-review assignment (D-#39), and routine authoring (D-#46).
  // No tracker/user surface under PoLP.
  OFFICE: [
    "roster:manage", "staff:manage", "guardian:link", "message:dispatch",
    "content:import", "content:assign_review",
    "routine:read", "routine:manage",
    "attendance:manage",     // upload teacher Excel, assign markers, chase guardians (D-#64/#65; no mark)
  ],
  // First-priority build = account + linkage only; portal reads are pipeline. The
  // single grant is gated off by PERMISSION_BUILD_STATUS until the portal ships.
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
