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

/** Foundation-only subject codes. These live on the operational plane (Subject
 *  collection) and may exceed the locked content-envelope subject enum. */
type FoundationSubjectCode = Subject | "ISLAM";

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
 *  `stimulus` is a shared passage/poem/audio-script/image-set referenced by questions (QDN-09).
 *  `question_batch` (contract v1.1) is a WRAPPER doc-type: one upload carrying N standard
 *  question envelopes. It is never persisted as a ContentArtifact — the wrapper is unwrapped
 *  and each element imports through the unchanged single-envelope path. */
export const DOC_TYPES = ["chapter_plan", "session_plan", "question", "question_set", "stimulus", "question_batch"] as const;
export type DocType = (typeof DOC_TYPES)[number];
/** The v1.1 batch wrapper — carried separately because it is a transport shape, not a content kind. */
export const BATCH_DOC_TYPE = "question_batch" as const;
/** Importer size guard: a question_batch larger than this is rejected whole (contract v1.1). */
export const BATCH_MAX_ITEMS = 500;
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

/** Question CATEGORY — the exercise family an item belongs to inside its chapter
 *  (শব্দার্থ vs বিপরীত শব্দ vs এক কথায় প্রকাশ …). A THIRD axis, distinct from both
 *  QuestionType (the answer carrier) and PaperRole (the paper section): শব্দার্থ,
 *  বিপরীত শব্দ and এক কথায় প্রকাশ are all `short_answer` + `short` + 1 mark and are
 *  otherwise indistinguishable, so a teacher assembling a vocabulary section had no
 *  way to ask for one and not the others (D-#511).
 *
 *  APP-NATIVE, no wire twin — the same shape as the routine/HR vocab (D-#46/#52), so
 *  there is NO two-place contract sync. The import contract carries the value in the
 *  question payload's OPTIONAL free-text `lesson_ref`; it is not an envelope enum, and
 *  the LOCKED question payload is closed (additionalProperties:false) so no new payload
 *  key could be added for it. A question that carries no category simply never matches
 *  a category filter — the axis is additive and absent on every pre-existing import.
 *
 *  The list is Bangla-subject-shaped today because that is the bank that exists; it is a
 *  plain string on the wire, so another subject's categories extend this array and its
 *  label map together, and nothing else. */
export const QUESTION_CATEGORIES = [
  "QCAT-SHORT",
  "QCAT-MCQ",
  "QCAT-FILL",
  "QCAT-SOBDARTH",
  "QCAT-BIPORIT",
  "QCAT-SOMARTHOK",
  "QCAT-EKKOTHAY",
  "QCAT-BHASHARITI",
  "QCAT-POD",
  "QCAT-KAL",
  "QCAT-BAKKO",
  "QCAT-JUKTOBORNO",
  "QCAT-LONG",
  "QCAT-MULBHAV",
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

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

// ---------------------------------------------------------------------------
// A.5e QUESTION TIME (QT-1, D-#593) — app-native, NO wire twin
// ---------------------------------------------------------------------------

/**
 * Minutes per MARK, by (subject × question type).
 *
 * Seeded from the Class-5 scholarship time-allocation sheet. Time is NOT proportional to
 * marks alone and NOT uniform across subjects, which is why this is a grid rather than one
 * number: a maths MCQ needs working out where a Bangla one is recall (1.3 vs 1.0), and a
 * maths problem earns its marks FASTER than a composition does (1.25 vs 2.0) because it
 * pays per step.
 *
 * Lives in `shared` so the APP computes a basket total with the identical numbers the
 * SERVER snapshots onto the set. Two implementations of the same arithmetic would drift,
 * and the first symptom would be a homework whose stated duration changed when it was saved.
 *
 * App-native: no envelope field mirrors this, so /skills/contract-sync does not apply.
 */
export const QUESTION_TIME_RATES: Record<Subject, Record<QuestionType, number>> = {
  BAN:  { mcq: 1.0, short_answer: 1.5, true_false: 1.0, fill_blank: 1.0, matching: 1.0, descriptive: 2.0 },
  ENG:  { mcq: 1.0, short_answer: 1.2, true_false: 0.8, fill_blank: 0.8, matching: 0.8, descriptive: 2.0 },
  MATH: { mcq: 1.3, short_answer: 2.0, true_false: 1.0, fill_blank: 1.2, matching: 1.0, descriptive: 1.25 },
  SCI:  { mcq: 1.0, short_answer: 1.2, true_false: 1.0, fill_blank: 1.0, matching: 1.0, descriptive: 1.67 },
  BGS:  { mcq: 1.0, short_answer: 1.2, true_false: 1.0, fill_blank: 1.0, matching: 1.0, descriptive: 1.67 },
};

/** Fallback when a question carries a subject or type the grid does not know. */
export const QUESTION_TIME_DEFAULT_RATE = 1.25;

/**
 * How long the same questions take by what you are BUILDING (owner ruling 2026-08-27).
 *
 * A class test IS an exam, so it takes exam time. Homework and assignments are done without
 * a teacher, a clock, or the pressure that makes exam pace possible — the ruling is DOUBLE,
 * and the source sheet's own homework column ranges 1.9–2.5×, so 2 sits inside it.
 */
export const SET_TYPE_TIME_MULTIPLIER: Record<SetType, number> = {
  HW: 2,
  AS: 2,
  CT: 1,
};

/** One question's minutes per mark, with the documented fallback. */
export function questionTimeRate(subject: string, questionType: string | null | undefined): number {
  const row = (QUESTION_TIME_RATES as Record<string, Record<string, number> | undefined>)[subject];
  const rate = row && questionType ? row[questionType] : undefined;
  return typeof rate === "number" ? rate : QUESTION_TIME_DEFAULT_RATE;
}

export interface TimedQuestion {
  subject: string;
  questionType?: string | null;
  marks?: number | null;
}

/**
 * Exam minutes for a WHOLE set: ceil the SUM, never the parts (owner ruling 2026-08-27).
 *
 * Rounding each question up first inflates badly on objective work — five 1-mark Bangla
 * short answers at 1.5 would be ceil(1.5)×5 = 10 against a true 8, and the error compounds
 * with every row. The per-question figure on a card is a display convenience; the number
 * that goes on a real homework is the honest sum.
 */
export function setExamMinutes(items: readonly TimedQuestion[]): number {
  const raw = items.reduce(
    (sum, it) =>
      sum + (typeof it.marks === "number" ? it.marks : 0) * questionTimeRate(it.subject, it.questionType),
    0,
  );
  return Math.ceil(raw);
}

/** What the SET says it takes: exam minutes scaled by what is being built. */
export function setDurationMinutes(setType: string, items: readonly TimedQuestion[]): number {
  const mult = (SET_TYPE_TIME_MULTIPLIER as Record<string, number | undefined>)[setType] ?? 1;
  return setExamMinutes(items) * mult;
}

/** Tracker kinds (ARCH §4; REQ-TRACK). `generic` is the extensible pattern (R-T4). */
export const TRACKER_KINDS = ["classtest", "assignment", "homework", "generic"] as const;
export type TrackerKind = (typeof TRACKER_KINDS)[number];

/** Plan-review verdicts (D-#38/#39) — a teacher reviewer's call on an assigned plan.
 *  APPROVE drives the artifact `draft → reviewed`; CHANGES_REQUESTED leaves it `draft`
 *  (the admin re-imports a revision and reassigns). App-native — no wire-contract twin. */
/** Reviewer verdicts. `APPROVE_WITH_CONDITION` is QUESTIONS-ONLY (D-#525): the plan
 *  loop still offers the original two, and `submitPlanReview` refuses the third.
 *  It is an APPROVAL WITH A HOLD — the question does NOT advance to `reviewed` and so
 *  cannot be published; the condition text is mandatory, and clearing it sends the
 *  question back to the reviewer for another round. */
export const REVIEW_VERDICTS = ["APPROVE", "APPROVE_WITH_CONDITION", "CHANGES_REQUESTED"] as const;
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

export const SUBJECT_LABELS_BN: Record<FoundationSubjectCode, string> = {
  BAN: "বাংলা",
  ENG: "ইংরেজি",
  MATH: "গণিত",
  SCI: "বিজ্ঞান",
  BGS: "বাংলাদেশ ও বিশ্বপরিচয়",
  ISLAM: "ইসলাম শিক্ষা",
};

export const DOC_TYPE_LABELS_BN: Record<DocType, string> = {
  chapter_plan: "অধ্যায় পরিকল্পনা",
  session_plan: "সেশন পরিকল্পনা",
  question: "প্রশ্ন",
  question_set: "প্রশ্নসেট",
  stimulus: "উদ্দীপক",
  question_batch: "প্রশ্নের ব্যাচ",
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

export const QUESTION_CATEGORY_LABELS_BN: Record<QuestionCategory, string> = {
  "QCAT-SHORT": "সংক্ষিপ্ত উত্তর",
  "QCAT-MCQ": "বহুনির্বাচনি",
  "QCAT-FILL": "শূন্যস্থান পূরণ",
  "QCAT-SOBDARTH": "শব্দার্থ",
  "QCAT-BIPORIT": "বিপরীত শব্দ",
  "QCAT-SOMARTHOK": "সমার্থক শব্দ",
  "QCAT-EKKOTHAY": "এক কথায় প্রকাশ",
  "QCAT-BHASHARITI": "ভাষারীতি পরিবর্তন",
  "QCAT-POD": "পদ নির্ণয়",
  "QCAT-KAL": "ক্রিয়ার কাল",
  "QCAT-BAKKO": "বাক্য গঠন",
  "QCAT-JUKTOBORNO": "যুক্তবর্ণ বিভাজন",
  "QCAT-LONG": "বিস্তৃত উত্তর",
  "QCAT-MULBHAV": "মূলভাব",
};

export const REVIEW_STATUS_LABELS_BN: Record<ReviewStatus, string> = {
  draft: "খসড়া",
  reviewed: "পর্যালোচিত",
  gold: "চূড়ান্ত", // Principal-locked
};

export const REVIEW_VERDICT_LABELS_BN: Record<ReviewVerdict, string> = {
  APPROVE: "অনুমোদন",
  APPROVE_WITH_CONDITION: "শর্তসাপেক্ষ অনুমোদন",
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
  probation: "প্রবেশন",
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

/** Which PART of a day a leave covers (D-#361 — owner ask: a teacher often misses only
 *  the first few or the last few periods, not the whole day). `full` is the pre-existing
 *  whole-day leave and stays the default for every existing row; `late_entry` = away for
 *  the FIRST n periods (joins mid-day), `early_leave` = away for the LAST n periods
 *  (leaves before the day ends). A partial day is SINGLE-DATE only (fromKey === toKey). */
export const LEAVE_DAY_PARTS = ["full", "late_entry", "early_leave"] as const;
export type LeaveDayPart = (typeof LEAVE_DAY_PARTS)[number];

export const LEAVE_DAY_PART_LABELS_BN: Record<LeaveDayPart, string> = {
  full: "পূর্ণ দিন", late_entry: "দেরিতে আসা", early_leave: "আগে চলে যাওয়া",
};
export const LEAVE_DAY_PART_LABELS_EN: Record<LeaveDayPart, string> = {
  full: "Full day", late_entry: "Late entry", early_leave: "Early leave",
};

/** Owner ruling (D-#361): THREE partial-day leaves cost ONE day of balance — so one
 *  partial day draws exactly 1/3 of a day, whatever its period count. Kept as an exact
 *  JS fraction (never a pre-rounded 0.33) so three of them still sum back to one day;
 *  round only at the display/serialization edge (`roundLeaveDays`). */
export const PARTIAL_DAY_FRACTION = 1 / 3;

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

// --- A.5d STAFF-HUB ENUMS (app-native; docs/prd-staff-hub.md, D-#539–#545) ----
// Identity/operational plane, behind the ADR-005 firewall — NO wire-contract twin,
// NO envelope-schema mirror, NO two-place sync; only /shared + the vocab verifier.

/** The letters the app issues for a staff member (SH-1, D-#542). `appointment` and
 *  `confirmation` are the two the owner asked for; `service_certificate` is the exit
 *  document prd-hr §6.5 already promises on retention, issued from the same machinery. */
/**
 * The letters the school issues (D-#586 adds the fourth).
 *
 *  is the Bangla নিয়োগ চুক্তিপত্র the খালা and দারোয়ান sign — a different
 * DOCUMENT, not a translation of the appointment letter: it is a two-party contract with a
 * duties schedule, both signatures, and no probation-then-regularize arc. Making it a kind of
 * its own is what lets one renderer stay faithful to each without either drifting.
 */
/**
 * How a month's pay actually leaves the school (D-#591).
 *
 * The bank needs THREE different documents, and the split is not the same as
 * `paymentMethod`: a bank transfer to the school's OWN bank is an internal transfer
 * listed on one advice sheet, while a transfer to any other bank goes by BEFTN and
 * needs a routing number the internal sheet has no column for. Cash is handed over by
 * the office and appears on neither.
 */
export const PAYMENT_CHANNELS = ["internal", "beftn", "bkash", "cash"] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export const PAYMENT_CHANNEL_LABELS_BN: Record<PaymentChannel, string> = {
  internal: "নিজ ব্যাংক (অভ্যন্তরীণ)", beftn: "অন্য ব্যাংক (BEFTN)", bkash: "বিকাশ", cash: "নগদ",
};
export const PAYMENT_CHANNEL_LABELS_EN: Record<PaymentChannel, string> = {
  internal: "Own bank (internal)", beftn: "Other bank (BEFTN)", bkash: "bKash", cash: "Cash",
};

export const STAFF_LETTER_KINDS = ["appointment", "confirmation", "service_certificate", "support_contract"] as const;
export type StaffLetterKind = (typeof STAFF_LETTER_KINDS)[number];

export const STAFF_LETTER_KIND_LABELS_BN: Record<StaffLetterKind, string> = {
  appointment: "নিয়োগপত্র", confirmation: "স্থায়ীকরণ পত্র", service_certificate: "প্রত্যয়নপত্র",
  support_contract: "নিয়োগ চুক্তিপত্র",
};
export const STAFF_LETTER_KIND_LABELS_EN: Record<StaffLetterKind, string> = {
  appointment: "Appointment letter", confirmation: "Confirmation letter",
  service_certificate: "Service certificate",
  support_contract: "Support-staff contract",
};

/** A letter is NEVER edited (D-#542): its snapshot is what was handed over and signed.
 *  A wrong letter is `void`ed — kept, marked, still renderable so the paper copy in
 *  someone's file can still be matched — and a fresh one issued with a new ref no. */
export const STAFF_LETTER_STATUSES = ["issued", "void"] as const;
export type StaffLetterStatus = (typeof STAFF_LETTER_STATUSES)[number];

export const STAFF_LETTER_STATUS_LABELS_BN: Record<StaffLetterStatus, string> = {
  issued: "ইস্যুকৃত", void: "বাতিল",
};
export const STAFF_LETTER_STATUS_LABELS_EN: Record<StaffLetterStatus, string> = {
  issued: "Issued", void: "Void",
};

/** The appointment letter's clause 1 (salary) and clause 2 (honorary) are MUTUALLY
 *  EXCLUSIVE — the Word template carries both, which is a copy-paste artefact, not a
 *  document that can be signed. The issuer picks one and only that clause prints. */
export const SALARY_MODES = ["paid", "honorary"] as const;
export type SalaryMode = (typeof SALARY_MODES)[number];

export const SALARY_MODE_LABELS_BN: Record<SalaryMode, string> = {
  paid: "বেতনসহ", honorary: "সম্মানী (অবৈতনিক)",
};
export const SALARY_MODE_LABELS_EN: Record<SalaryMode, string> = {
  paid: "Paid", honorary: "Honorary (unpaid)",
};

/**
 * HR policy DEFAULTS (SH-3, D-#539/#541) — the read-time fallback for the `HrPolicy`
 * singleton, the D-#97 / LibraryPolicy posture: admin DATA with defaults read at
 * request time, so NO seed or startup write ever runs against the shared live Atlas
 * and an absent row simply reads as these values.
 *
 * `annualLeaveDays` is the ONE pool `casual` + `sick` + `bereavement` draw from — the
 * appointment letter's clause 7 ("Total 20 days including sick leave and casual leave").
 *
 * `latenessRuleEnabled` is deliberately FALSE: prd-hr H4.3 made the lateness deduction
 * an opt-in Principal-configurable rule, so shipping this code changes no existing
 * payroll figure until the Principal switches it on.
 */
export const HR_POLICY_DEFAULTS = {
  annualLeaveDays: 20,
  lateDaysPerCharge: 3,
  latenessRuleEnabled: false,
  probationDebtEnabled: true,
  /**
   * How long probation runs, in months (D-#586).
   *
   * SIX, not the three the Dhaka branch uses — the owner's ruling. It is a POLICY number
   * rather than a constant precisely because it differs by branch, and a per-staff override
   * exists on top for anyone whose letter says something else. It never decides whether
   * someone IS on probation — `confirmationDate` alone does that (D-#540) — it only says when
   * the probation was due to end, which is what makes an overdue confirmation visible.
   */
  probationMonths: 6,
  /** Letter defaults (SH-1). The signatory is DATA, never a literal in the renderer —
   *  the convener changes without a deploy, and a letter already issued keeps the
   *  name it was signed with because the snapshot froze it (D-#542). */
  signatoryName: "Md. Enamul Haque",
  signatoryTitle: "Convener, Managing Committee",
  /** Clause 4's printed working-hours text. */
  weeklyHoursText: "25 (5*5)",
  /**
   * The Bangla support-staff contract block (D-#586), EMPTY by default.
   *
   * Deliberately not seeded with the Mohammadpur branch text that appears in the
   * sample contracts: this deployment is a different branch, and a plausible-looking
   * wrong address on a signed contract is worse than a refusal. The contract will not
   * issue until these are set once in HR নীতিমালা.
   */
  /**
   * The salary-advice letterhead and the school's own bank (D-#591), EMPTY by default.
   *
   * Every one of these is printed on a letter that goes to a bank over the school's
   * name, and none of them can be guessed from another deployment's paperwork. The
   * advice pack refuses until they are set once, for the same reason the Bangla
   * contract does.
   */
  orgRegistrationNo: "",
  orgAddress: "",
  orgPhone: "",
  orgEmail: "",
  /** The bank the school banks with — the letters are addressed to its manager. */
  schoolBankName: "",
  schoolBankBranch: "",
  /** The school's own bearing account, quoted in the letter as the source of funds. */
  schoolAccountNo: "",
  employerNameBn: "",
  employerAddressBn: "",
  /** The Bangla contract is signed by the Principal, not the English letters' Convener. */
  signatoryNameBn: "",
  signatoryTitleBn: "",
  /** Ref-no prefix: `${prefix}/${year}/${seq}` → "SCD/HR/2026/0052". */
  letterRefPrefix: "SCD/HR",
} as const;

/** The leave types that draw the ONE shared annual pool (D-#539). Everything else is
 *  either unpaid by type (maternity/hajj/unpaid_lwp) or has no balance at all. */
export const POOLED_LEAVE_TYPES = ["casual", "sick", "bereavement"] as const satisfies readonly LeaveType[];

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

/** The HW subjects EXPECTED to declare daily whenever the routine gives them
 *  periods — the axis the recon-report / lifecycle "never declared" red lists
 *  check against. **ARABIC is excluded** by owner ruling (D-#308): the Arabic
 *  teacher declares homework when there is any — declaring stays fully possible
 *  (HW_SUBJECTS is unchanged), only the red not-declared expectation goes. One
 *  step softer than the D-#36 Quran posture (out of the channel entirely).
 *  Operational axis only — never mirrored into the envelope. */
export const HW_DECLARATION_EXPECTED_SUBJECTS: readonly HwSubject[] = HW_SUBJECTS.filter(
  (s) => s !== "ARABIC",
);

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
  DUE: "জমা দেওয়া হয়নি",
  SUBMITTED: "জমা হয়েছে",
  CHASE: "স্মরণ করানো হয়েছে",
  CHECKED: "দেখা হয়েছে",
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
export const HW_DAILY_CEILING_MIN = 120; // uniform C1–5 day-sum ceiling — the §4 gate
export const HW_DAILY_FLOOR_MIN = 120; // informational only
export const HW_SUBJECT_BAND_MAX_MIN = 40; // single-subject band; >40 WARNS, never blocks (§4 close / T2.5)
export const HW_DEFAULT_TIME_DECL_MIN = 20; // Class-1 working default for TIME_DECL

// Assignment weekly load ceiling (AS-T6, D-#274; raised to 6h D-#323). School
// policy: ≤ 6 hours of assignment work per section per week. The WEEK-SUM of the
// delivered items' estMinutes is law — confirmAssignmentWeek hard-blocks over
// this (the homework day-sum gate's weekly analog). No per-subject advisory band.
export const AS_WEEKLY_CEILING_MIN = 360; // 6-hour per-section weekly cap — the AS-T6 gate
export const AS_DEFAULT_EST_MIN = 20; // per-assignment working default for estMinutes

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

export const SUBJECT_LABELS_EN: Record<FoundationSubjectCode, string> = {
  BAN: "Bangla",
  ENG: "English",
  MATH: "Mathematics",
  SCI: "Science",
  BGS: "Bangladesh & Global Studies",
  ISLAM: "Islamic Studies",
};

export const DOC_TYPE_LABELS_EN: Record<DocType, string> = {
  chapter_plan: "Chapter plan",
  session_plan: "Session plan",
  question: "Question",
  question_set: "Question set",
  stimulus: "Stimulus",
  question_batch: "Question batch",
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

export const QUESTION_CATEGORY_LABELS_EN: Record<QuestionCategory, string> = {
  "QCAT-SHORT": "Short answer",
  "QCAT-MCQ": "MCQ",
  "QCAT-FILL": "Fill in the blanks",
  "QCAT-SOBDARTH": "Word meaning",
  "QCAT-BIPORIT": "Antonym",
  "QCAT-SOMARTHOK": "Synonym",
  "QCAT-EKKOTHAY": "One-word expression",
  "QCAT-BHASHARITI": "Register change",
  "QCAT-POD": "Parts of speech",
  "QCAT-KAL": "Verb tense",
  "QCAT-BAKKO": "Sentence making",
  "QCAT-JUKTOBORNO": "Conjunct letters",
  "QCAT-LONG": "Long answer",
  "QCAT-MULBHAV": "Central idea",
};

export const REVIEW_STATUS_LABELS_EN: Record<ReviewStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  gold: "Final", // Principal-locked
};

export const REVIEW_VERDICT_LABELS_EN: Record<ReviewVerdict, string> = {
  APPROVE: "Approve",
  APPROVE_WITH_CONDITION: "Approve with condition",
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
  confirmed: "Permanent",
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
  // HW per-chase guardian notify (app-native, NO wire twin — D-#46/#260): EVERY
  // chase pushes the student's login-enabled guardians an in-app reminder (the push
  // channel rides emit()), deduped once per student+item per day. Distinct from
  // HW_PARENT_COMMS, which nudges the CLASS TEACHER at the 3rd chase.
  "HW_CHASE",
  // Assignment-tracker per-chase guardian notify (app-native, NO wire twin — the
  // AS-T4 twin of HW_CHASE, D-#88/#94). Ladder steps 1–2 push the student's
  // login-enabled guardians an in-app reminder (via emit()); contact-only
  // guardians are reached at step 3 by the manual wa.me path.
  "ASSIGNMENT_CHASE",
  "REVIEW_ASSIGNED",
  "COVER_ASSIGNED",
  "LIBRARY_DUE_SOON",
  "LIBRARY_OVERDUE",
  "CLASS_TEST_RESULT",
  // D-#472: the class test is CONFIRMED and gone to print — tell the family what is
  // coming (subject, chapter, date, marks, minutes) while there is still time to revise.
  // App-native, NO wire twin: it is a delivery notice, not import-contract vocabulary.
  "CLASS_TEST_UPCOMING",
  // D-#597: the 08:00 school-day DIGEST of class-test reports past their deadline,
  // to OFFICE + PRINCIPAL only. Deliberately ONE rolled-up row per recipient per
  // day, not one per pending exam — a per-item fan-out would put 20+ rows in the
  // office inbox every morning, which is how a channel stops being read at all.
  // App-native, NO wire twin.
  "CLASS_TEST_OVERDUE_DIGEST",
  "VOCAB_RESULT",
  "STUDENT_COMMENT",
  // MR-6: the monthly progress report reached the family. Fired on RELEASE and again
  // on a RE-RELEASE, with different wording each time (§9) — a family must never be
  // handed different numbers under the same message.
  "MONTHLY_REPORT",
  // CO-3 classroom-observation kinds (app-native, NO wire twin — D-#46/#72). The
  // release notify, the escalation reminders (1st + 2nd), the Principal flag at the
  // final threshold, and the teacher-responded notice. See the CO-3 build.
  "OBSERVATION_RELEASED",
  "OBSERVATION_RESPONSE_REMINDER",
  "OBSERVATION_ESCALATED",
  "OBSERVATION_RESPONDED",
  // CO-8 publish gate (D-#271): the manager nudge fired at REVIEWED — a review is
  // waiting for Principal/Office to publish it to the observed teacher. App-native.
  "OBSERVATION_READY_TO_PUBLISH",
  // FIN-2B finance fee-due chase (app-native, NO wire twin — D-#46/#227). The
  // guardian login-enabled inbox row for an outstanding fee due (wa.me for all).
  "FINANCE_FEE_DUE",
  // SR-2 Saturday-Revision guardian delivery (app-native, NO wire twin — D-#46/#244).
  // The weekly absent alert (also reused for the consecutive-absence escalation,
  // D-#245) and the present-student revision digest (wa.me for all).
  "SR_ABSENT",
  "SR_DIGEST",
  // PQ-5 (D-#281): the Office handed a finished print job back to the teacher who
  // requested it. Staff-facing (recipientUserId), app-native, NO wire twin.
  "PRINT_DELIVERED",
  // D-#296: a teacher filed a print request — nudges every Office/Principal user
  // (the queue's operators). Staff-facing (recipientUserId), app-native, NO wire twin.
  "PRINT_REQUESTED",
  // Homework daily-confirm pending ladder (app-native, NO wire twin). A section's
  // homework is declared but not yet confirmed/issued: REMINDER nudges the confirmer
  // (class teacher / delegate) at 13:00/13:30/14:00; ESCALATION alerts Office at 14:00
  // and the Principal at 16:00 (one row per pending section).
  "HW_PENDING_REMINDER",
  "HW_PENDING_ESCALATION",
  // D-#314: the auto-issue sweep confirmed+issued a within-ceiling, fully-covered
  // day (attendance-backed roster) — the confirmer is informed, not asked.
  "HW_AUTO_ISSUED",
  // D-#342 CT question-request loop (app-native, NO wire twin): REVIEW → the
  // requesting teacher (an office paper round awaits their verdict); OFFICE →
  // the queue operators (new request / changes requested / confirmed).
  "CT_QUESTION_REVIEW",
  "CT_QUESTION_OFFICE",
  // CT-8 submit/approve loop (app-native, NO wire twin): SUBMITTED → every active
  // Principal/Office user (a teacher's results await their approval); PUBLISHED →
  // the exam's requesting teacher (approve/publish released the results to guardians).
  "CT_RESULT_SUBMITTED",
  "CT_RESULT_PUBLISHED",
  // Staff leave (owner 2026-07-26): a teacher submitted a leave application →
  // every approver (active Principal/Office). App-native, no wire twin.
  "STAFF_LEAVE_SUBMITTED",
  // Weekly guardian homework digest (owner 2026-08-04, D-#452; app-native, NO
  // wire twin). Fired at 17:00 on the LAST OPEN day of the Sun–Thu school week
  // (normally Thursday), one row per guardian × child: the week's still-
  // unsubmitted homework subject-wise + the digest day's fresh homework as a
  // weekend heads-up. Contact-only guardians are reached manually via the
  // staff weekly report's wa.me lines.
  "HW_WEEKLY_DIGEST",
  // Teaching-notes library (TN-3, D-#519–#523; app-native, NO wire twin). All three
  // are STAFF-only — this library has no guardian path at all (D-#521).
  //   PUBLISHED → the (class × subject)'s teachers, when a note or a new version lands
  //   COMMENT   → the note's uploader + the Principal, when a teacher leaves a suggestion
  //   ADDRESSED → the comment's author, when their suggestion is marked addressed
  "TEACHING_NOTE_PUBLISHED",
  "TEACHING_NOTE_COMMENT",
  "TEACHING_NOTE_COMMENT_ADDRESSED",
  // Guardian work claim (GC-1, D-#551..#554; app-native, NO wire twin).
  //   FILED     → the item's issuedBy teacher, the instant a parent taps
  //   ESCALATED → Office at 11:30, Principal at 13:00 on the claim's ACTION DAY,
  //               as ONE digest row per user per day — never one row per claim
  //   RESOLVED  → the guardian who filed it: accepted, or rejected with the reason
  "WORK_CLAIM_FILED",
  "WORK_CLAIM_ESCALATED",
  "WORK_CLAIM_RESOLVED",
  // RL-2 (D-#556): a student is back after an absence — to the CLASS TEACHER only,
  // fired when attendance CONFIRMS the return (owner ruling 2026-08-25). The leave
  // register records an intention; only attendance records what happened.
  "STUDENT_RETURNED",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABELS_BN: Record<NotificationKind, string> = {
  BELL_REMINDER: "ঘণ্টার স্মরণিকা",
  ATTENDANCE_REMINDER: "হাজিরা জমার স্মরণিকা",
  CLASS_NOTE_PROMPT: "পাঠ নোট লেখার তাগিদ",
  CLASS_NOTE_ESCALATION: "পাঠ নোট অনিষ্পন্ন",
  CLASS_NOTE_PUBLISHED: "পাঠ নোট প্রকাশিত",
  HW_PARENT_COMMS: "অভিভাবক যোগাযোগের স্মরণিকা",
  HW_CHASE: "বাড়ির কাজ জমার স্মরণিকা",
  ASSIGNMENT_CHASE: "অ্যাসাইনমেন্ট জমার স্মরণিকা",
  REVIEW_ASSIGNED: "পর্যালোচনার দায়িত্ব",
  COVER_ASSIGNED: "কাভার ক্লাসের দায়িত্ব",
  LIBRARY_DUE_SOON: "বই ফেরতের স্মরণিকা",
  LIBRARY_OVERDUE: "বই ফেরত বকেয়া",
  CLASS_TEST_RESULT: "ক্লাস টেস্টের ফলাফল",
  CLASS_TEST_UPCOMING: "আসন্ন ক্লাস টেস্ট",
  CLASS_TEST_OVERDUE_DIGEST: "বিলম্বিত ক্লাস টেস্ট রিপোর্ট",
  VOCAB_RESULT: "ভোকাবুলারি টেস্টের ফলাফল",
  MONTHLY_REPORT: "মাসিক অগ্রগতি রিপোর্ট",
  STUDENT_COMMENT: "শিক্ষকের পর্যবেক্ষণ",
  OBSERVATION_RELEASED: "শ্রেণি পর্যবেক্ষণ প্রকাশিত",
  OBSERVATION_RESPONSE_REMINDER: "পর্যবেক্ষণে সাড়া দেওয়ার তাগিদ",
  OBSERVATION_ESCALATED: "পর্যবেক্ষণে সাড়া বকেয়া",
  OBSERVATION_RESPONDED: "পর্যবেক্ষণে শিক্ষকের সাড়া",
  OBSERVATION_READY_TO_PUBLISH: "পর্যবেক্ষণ প্রকাশের অপেক্ষায়",
  FINANCE_FEE_DUE: "ফি বকেয়ার তাগিদ",
  SR_ABSENT: "শনিবার রিভিশনে অনুপস্থিত",
  SR_DIGEST: "সাপ্তাহিক রিভিশন রিপোর্ট",
  HW_PENDING_REMINDER: "বাড়ির কাজ নিশ্চিত করা বাকি",
  HW_PENDING_ESCALATION: "বাড়ির কাজ নিশ্চিত হয়নি (এসকেলেশন)",
  HW_AUTO_ISSUED: "বাড়ির কাজ স্বয়ংক্রিয়ভাবে ইস্যু হয়েছে",
  CT_QUESTION_REVIEW: "প্রশ্নপত্র রিভিউর অপেক্ষায়",
  CT_QUESTION_OFFICE: "প্রশ্ন তৈরির অনুরোধ",
  CT_RESULT_SUBMITTED: "ফলাফল অনুমোদনের অপেক্ষায়",
  CT_RESULT_PUBLISHED: "ক্লাস টেস্টের ফলাফল প্রকাশিত",
  STAFF_LEAVE_SUBMITTED: "ছুটির আবেদন অনুমোদনের অপেক্ষায়",
  PRINT_DELIVERED: "প্রিন্ট ডেলিভারি হয়েছে",
  PRINT_REQUESTED: "নতুন প্রিন্ট অনুরোধ",
  HW_WEEKLY_DIGEST: "সাপ্তাহিক বাড়ির কাজ রিপোর্ট",
  TEACHING_NOTE_PUBLISHED: "নতুন নোট ও গাইড",
  TEACHING_NOTE_COMMENT: "নোটে নতুন পরামর্শ",
  TEACHING_NOTE_COMMENT_ADDRESSED: "পরামর্শ সমাধান হয়েছে",
  WORK_CLAIM_FILED: "অভিভাবক জানিয়েছেন কাজ হয়েছে",
  WORK_CLAIM_ESCALATED: "অভিভাবকের জানানো নিষ্পন্ন হয়নি",
  WORK_CLAIM_RESOLVED: "আপনার জানানোর উত্তর এসেছে",
  STUDENT_RETURNED: "ছুটি শেষে ফিরেছে",
};
export const NOTIFICATION_KIND_LABELS_EN: Record<NotificationKind, string> = {
  BELL_REMINDER: "Bell reminder",
  ATTENDANCE_REMINDER: "Attendance reminder",
  CLASS_NOTE_PROMPT: "Class-note prompt",
  CLASS_NOTE_ESCALATION: "Class-note escalation",
  CLASS_NOTE_PUBLISHED: "Class note published",
  HW_PARENT_COMMS: "Parent-contact prompt",
  HW_CHASE: "Homework reminder",
  ASSIGNMENT_CHASE: "Assignment reminder",
  REVIEW_ASSIGNED: "Review assigned",
  COVER_ASSIGNED: "Cover assigned",
  LIBRARY_DUE_SOON: "Book due soon",
  LIBRARY_OVERDUE: "Book overdue",
  CLASS_TEST_RESULT: "Class-test result",
  CLASS_TEST_UPCOMING: "Upcoming class test",
  CLASS_TEST_OVERDUE_DIGEST: "Overdue class-test reports",
  VOCAB_RESULT: "Vocabulary-test result",
  MONTHLY_REPORT: "Monthly progress report",
  STUDENT_COMMENT: "Teacher's comment",
  OBSERVATION_RELEASED: "Observation released",
  OBSERVATION_RESPONSE_REMINDER: "Observation response reminder",
  OBSERVATION_ESCALATED: "Observation escalated",
  OBSERVATION_RESPONDED: "Observation responded",
  OBSERVATION_READY_TO_PUBLISH: "Observation ready to publish",
  FINANCE_FEE_DUE: "Fee due reminder",
  SR_ABSENT: "Saturday revision — absent",
  SR_DIGEST: "Weekly revision digest",
  HW_PENDING_REMINDER: "Homework confirm pending",
  HW_PENDING_ESCALATION: "Homework not confirmed (escalation)",
  HW_AUTO_ISSUED: "Homework auto-issued",
  CT_QUESTION_REVIEW: "Question paper awaiting review",
  CT_QUESTION_OFFICE: "Question request update",
  CT_RESULT_SUBMITTED: "Class-test results submitted",
  CT_RESULT_PUBLISHED: "Class-test results published",
  STAFF_LEAVE_SUBMITTED: "Leave application awaiting approval",
  PRINT_DELIVERED: "Print job delivered",
  PRINT_REQUESTED: "New print request",
  HW_WEEKLY_DIGEST: "Weekly homework digest",
  TEACHING_NOTE_PUBLISHED: "New note / guide",
  TEACHING_NOTE_COMMENT: "New suggestion on a note",
  TEACHING_NOTE_COMMENT_ADDRESSED: "Suggestion addressed",
  WORK_CLAIM_FILED: "Guardian says the work is done",
  WORK_CLAIM_ESCALATED: "Guardian claim unresolved",
  WORK_CLAIM_RESOLVED: "Your report has an answer",
  STUDENT_RETURNED: "Back after an absence",
};

/**
 * Guardian-portal view surfaces (GE-2, D-#465) — what a family actually opened.
 *
 * The guardian read path is otherwise INVISIBLE: every portal query is a pure read,
 * so a guardian could use the app daily and leave the database byte-identical. These
 * are the named surfaces the app reports back so "which screens get used" and "which
 * items were never opened" become answerable.
 *
 * NOT an import-contract enum — it mirrors nothing in the wire schema (the
 * NOTIFICATION_KINDS precedent). Add a surface here AND in the app's recordView call
 * sites; an unknown surface is rejected server-side rather than silently stored, so
 * the popularity counts can never be polluted by a typo'd string.
 */
export const GUARDIAN_VIEW_SURFACES = [
  "HOME",            // GuardianHomeScreen — the child dashboard
  "CLASS_NOTES",     // ChildClassNotesScreen
  "HOMEWORK",        // ChildHomeworkScreen
  "ASSIGNMENTS",     // ChildAssignmentsScreen
  "ROUTINE",         // ChildRoutineScreen
  "ATTENDANCE",      // ChildAttendanceScreen
  "FEES",            // ChildFeesScreen
  "LEAVE",           // ChildLeaveScreen
  "NOTIFICATIONS",   // NotificationCenterScreen opened from the guardian header bell
] as const;
export type GuardianViewSurface = (typeof GUARDIAN_VIEW_SURFACES)[number];

export const GUARDIAN_VIEW_SURFACE_LABELS_BN: Record<GuardianViewSurface, string> = {
  HOME: "হোম",
  CLASS_NOTES: "পাঠ নোট",
  HOMEWORK: "বাড়ির কাজ",
  ASSIGNMENTS: "অ্যাসাইনমেন্ট",
  ROUTINE: "রুটিন",
  ATTENDANCE: "উপস্থিতি",
  FEES: "ফি",
  LEAVE: "ছুটি",
  NOTIFICATIONS: "বিজ্ঞপ্তি",
};

/**
 * Guardian engagement bands (GE-1, D-#464; NO_LOGIN added D-#474) — how regularly a
 * family actually uses the portal, measured in DISTINCT ACTIVE DAYS inside the report
 * window, not raw login count (five logins in one afternoon is one engaged day).
 *
 * Every band names a DIFFERENT action, which is the whole reason they are separate:
 *   NO_LOGIN    → issue credentials. Nobody has been given a password for this family.
 *   NEVER       → chase. They HAVE a password and have never used it.
 *   LAPSED      → re-engage. They used it once and stopped.
 *   OCCASIONAL  → fine.
 *   REGULAR     → fine.
 *
 * NO_LOGIN was split out of NEVER (D-#474) after the owner pointed out the report's
 * chase list was unusable: a contact-only guardian reads as "never logged in", but
 * chasing them is meaningless — they were never given the portal. An onboarding gap
 * and an ignored password need opposite responses, so they cannot share a band.
 */
export const GUARDIAN_ENGAGEMENT_BANDS = [
  "REGULAR",
  "OCCASIONAL",
  "LAPSED",
  "NEVER",
  "NO_LOGIN",
] as const;
export type GuardianEngagementBand = (typeof GUARDIAN_ENGAGEMENT_BANDS)[number];

export const GUARDIAN_ENGAGEMENT_BAND_LABELS_BN: Record<GuardianEngagementBand, string> = {
  REGULAR: "নিয়মিত",
  OCCASIONAL: "মাঝেমধ্যে",
  LAPSED: "নিষ্ক্রিয়",
  NEVER: "লগইন আছে, ব্যবহার করেননি",
  NO_LOGIN: "লগইন দেওয়া হয়নি",
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

// --- Print request queue (PQ-1, D-#281) ------------------------------------
/** The Office's print lifecycle. Three live statuses matching the three buckets
 *  the Office actually tracks — "yet to print", "printing done", "delivered to the
 *  teacher" — with NO separate in-progress state. `CANCELLED` is a withdrawn
 *  request (by the requester while still REQUESTED, or by the Office).
 *  Generalizes CLASS_TEST_STATUSES, which stops at PRINTED. */
export const PRINT_REQUEST_STATUSES = ["REQUESTED", "PRINTED", "DELIVERED", "CANCELLED"] as const;
export type PrintRequestStatus = (typeof PRINT_REQUEST_STATUSES)[number];

export const PRINT_REQUEST_STATUS_LABELS_BN: Record<PrintRequestStatus, string> = {
  REQUESTED: "ছাপার অপেক্ষায়",
  PRINTED: "ছাপা হয়েছে",
  DELIVERED: "শিক্ষককে দেওয়া হয়েছে",
  CANCELLED: "বাতিল",
};
export const PRINT_REQUEST_STATUS_LABELS_EN: Record<PrintRequestStatus, string> = {
  REQUESTED: "Yet to print",
  PRINTED: "Printing done",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

/** What the print job is FOR — the Office sorts and batches by this. */
export const PRINT_PURPOSES = [
  "CLASSWORK",
  "HOMEWORK",
  "ASSIGNMENT",
  "CLASS_TEST",
  "LESSON_PLAN",
  "OTHER",
] as const;
export type PrintPurpose = (typeof PRINT_PURPOSES)[number];

export const PRINT_PURPOSE_LABELS_BN: Record<PrintPurpose, string> = {
  CLASSWORK: "শ্রেণিকর্ম",
  HOMEWORK: "বাড়ির কাজ",
  ASSIGNMENT: "অ্যাসাইনমেন্ট",
  CLASS_TEST: "ক্লাস টেস্ট",
  LESSON_PLAN: "পাঠ পরিকল্পনা",
  OTHER: "অন্যান্য",
};
export const PRINT_PURPOSE_LABELS_EN: Record<PrintPurpose, string> = {
  CLASSWORK: "Classwork",
  HOMEWORK: "Homework",
  ASSIGNMENT: "Assignment",
  CLASS_TEST: "Class test",
  LESSON_PLAN: "Lesson plan",
  OTHER: "Other",
};

/** Where the document comes from. EXACTLY ONE source field is set on a request
 *  (the `StudentAttendanceDay` XOR pattern). No PDF snapshot is taken: an
 *  assembled `AssessmentSet` is LOCKED, so `SET` is already immutable in content;
 *  an `UPLOAD` is self-snapshotting; a `LINK` is external by nature (D-#281). */
export const PRINT_SOURCES = ["SET", "CONTENT_ARTIFACT", "UPLOAD", "LINK"] as const;
export type PrintSource = (typeof PRINT_SOURCES)[number];

export const PRINT_SOURCE_LABELS_BN: Record<PrintSource, string> = {
  SET: "প্রশ্ন সেট",
  CONTENT_ARTIFACT: "পাঠ/অধ্যায় পরিকল্পনা",
  UPLOAD: "আপলোড করা ফাইল",
  LINK: "লিংক",
};
export const PRINT_SOURCE_LABELS_EN: Record<PrintSource, string> = {
  SET: "Question set",
  CONTENT_ARTIFACT: "Chapter / session plan",
  UPLOAD: "Uploaded file",
  LINK: "Link",
};

/** How the job is printed (live-testing requirement): both are MANDATORY on a request —
 *  the Office cannot start a job without knowing them. */
export const PRINT_COLOURS = ["BW", "COLOR"] as const;
export type PrintColour = (typeof PRINT_COLOURS)[number];
export const PRINT_COLOUR_LABELS_BN: Record<PrintColour, string> = {
  BW: "সাদা-কালো",
  COLOR: "রঙিন",
};
export const PRINT_COLOUR_LABELS_EN: Record<PrintColour, string> = {
  BW: "Black & white",
  COLOR: "Colour",
};

export const PRINT_SIDES = ["SINGLE", "DOUBLE"] as const;
export type PrintSides = (typeof PRINT_SIDES)[number];
export const PRINT_SIDES_LABELS_BN: Record<PrintSides, string> = {
  SINGLE: "এক পৃষ্ঠায়",
  DOUBLE: "দুই পৃষ্ঠায়",
};
export const PRINT_SIDES_LABELS_EN: Record<PrintSides, string> = {
  SINGLE: "Single side",
  DOUBLE: "Both sides",
};

/** Uploads per print request (PQ-2) — the class-note attachment ceiling. */
export const MAX_PRINT_UPLOADS = 5;

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
  "homework.chase.title",
  "homework.chase.body",
  "homework.autoIssued.title",
  "homework.autoIssued.body",
  "review.assigned.title",
  "review.assigned.body",
  "question.review.assigned.title",
  "question.review.assigned.body",
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
  "class_test.overdue_chase.wa",
  "class_test.overdue_digest.title",
  "class_test.overdue_digest.body",
  "student_comment.notify.title",
  "student_comment.notify.body",
  "finance.fee_due.chase.title",
  "finance.fee_due.chase.body",
  "finance.fee_due.chase.wa",
  "sr.absent.title",
  "sr.absent.body",
  "sr.absent.wa",
  "sr.digest.title",
  "sr.digest.body",
  "sr.digest.wa",
  "sr.completeness_chase.wa",
  "print.delivered.title",
  "print.delivered.body",
  "print.requested.title",
  "print.requested.body",
  // Monthly progress report (MR-4/MR-6, D-#399): the fallback paragraph the report
  // falls back to when the model fails or its output is rejected — the report must
  // never block on an external API — plus the release / re-release notifications.
  "monthly_report.comment.fallback",
  "monthly_report.released.title",
  "monthly_report.released.body",
  "monthly_report.released.wa",
  "monthly_report.revised.title",
  "monthly_report.revised.body",
  "monthly_report.revised.wa",
  "monthly_report.teacher_chase.wa",
  // Weekly guardian homework digest (D-#452): last-open-day 17:00, one message
  // per guardian × child. {Unsubmitted}/{HeadsUp} are pre-built multi-line
  // sections (the sr.digest list-through-one-placeholder pattern).
  "homework.weeklyDigest.title",
  "homework.weeklyDigest.body",
  "homework.weeklyDigest.wa",
  // Teaching-notes library (TN-3). Staff-facing only — no `.wa` variants, because
  // this library never reaches a guardian and wa.me is the guardian channel.
  "teachingNote.published.title",
  "teachingNote.published.body",
  "teachingNote.comment.title",
  "teachingNote.comment.body",
  "teachingNote.commentAddressed.title",
  "teachingNote.commentAddressed.body",
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
    group: "homework", labelBn: "অভিভাবক যোগাযোগের স্মরণিকা — শিরোনাম", placeholders: [],
    bnDefault: "অভিভাবকের সাথে যোগাযোগ প্রয়োজন", defaultLangMode: "BN",
  },
  "homework.parentComms.body": {
    group: "homework", labelBn: "অভিভাবক যোগাযোগের স্মরণিকা — বার্তা", placeholders: ["hwId", "chaseCount"],
    bnDefault: "বাড়ির কাজ {hwId}: একজন শিক্ষার্থীকে {chaseCount} বার মনে করিয়ে দেওয়া হয়েছে — অভিভাবককে জানান।", defaultLangMode: "BN",
  },
  // --- Homework per-chase guardian notify (D-#260) ---
  "homework.chase.title": {
    group: "homework", labelBn: "বাড়ির কাজ জমার স্মরণিকা — শিরোনাম", placeholders: [],
    bnDefault: "বাড়ির কাজ জমা হয়নি", defaultLangMode: "BN",
  },
  "homework.chase.body": {
    group: "homework", labelBn: "বাড়ির কাজ জমার স্মরণিকা — বার্তা", placeholders: ["hwId", "chaseCount"],
    bnDefault: "আপনার সন্তানের বাড়ির কাজ {hwId} এখনও জমা হয়নি — অনুগ্রহ করে আজই জমা দিতে উৎসাহিত করুন। (স্মরণ {chaseCount} বার)", defaultLangMode: "BN",
  },
  // --- Homework auto-issue (D-#314) ---
  "homework.autoIssued.title": {
    group: "homework", labelBn: "স্বয়ংক্রিয় ইস্যু — শিরোনাম", placeholders: [],
    bnDefault: "বাড়ির কাজ স্বয়ংক্রিয়ভাবে ইস্যু হয়েছে", defaultLangMode: "BN",
  },
  "homework.autoIssued.body": {
    group: "homework", labelBn: "স্বয়ংক্রিয় ইস্যু — বার্তা", placeholders: ["issuedItems", "dayTotal"],
    bnDefault: "আজকের সব বিষয় ঘোষিত ও সীমার মধ্যে থাকায় দিনটি স্বয়ংক্রিয়ভাবে নিশ্চিত হয়েছে — {issuedItems}টি আইটেম, মোট {dayTotal} মিনিট। ট্রিম দরকার হলে আগের মতোই আপনি করবেন।", defaultLangMode: "BN",
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
  // --- Question review assigned (D-#508) ---
  // Separate from review.assigned.* because that copy names a PLAN and quotes an address;
  // a question shares its unit address with dozens of others, so the plan wording would
  // point the reviewer at the wrong thing entirely.
  "question.review.assigned.title": {
    group: "review", labelBn: "প্রশ্ন পর্যালোচনার দায়িত্ব — শিরোনাম", placeholders: [],
    bnDefault: "প্রশ্ন পর্যালোচনার দায়িত্ব", defaultLangMode: "BN",
  },
  "question.review.assigned.body": {
    group: "review", labelBn: "প্রশ্ন পর্যালোচনার দায়িত্ব — বার্তা",
    placeholders: ["subject", "classLevel", "count"],
    bnDefault: "{subject} · শ্রেণি {classLevel} — {count}টি প্রশ্ন আপনার পর্যালোচনার জন্য নির্ধারিত হয়েছে।", defaultLangMode: "BN",
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
  // --- Print job delivered (PQ-5, D-#281) ---
  "print.delivered.title": {
    group: "print", labelBn: "প্রিন্ট ডেলিভারি — শিরোনাম", placeholders: [],
    bnDefault: "আপনার প্রিন্ট প্রস্তুত", defaultLangMode: "BN",
  },
  "print.delivered.body": {
    group: "print", labelBn: "প্রিন্ট ডেলিভারি — বার্তা", placeholders: ["title"],
    bnDefault: "“{title}” ছাপা হয়ে আপনাকে দেওয়া হয়েছে।", defaultLangMode: "BN",
  },
  // --- New print request → the queue's operators (D-#296) ---
  "print.requested.title": {
    group: "print", labelBn: "নতুন প্রিন্ট অনুরোধ — শিরোনাম", placeholders: [],
    bnDefault: "নতুন প্রিন্ট অনুরোধ", defaultLangMode: "BN",
  },
  "print.requested.body": {
    group: "print", labelBn: "নতুন প্রিন্ট অনুরোধ — বার্তা", placeholders: ["title", "requesterName"],
    bnDefault: "{requesterName} “{title}” ছাপানোর অনুরোধ করেছেন — প্রিন্ট কিউ দেখুন।", defaultLangMode: "BN",
  },
  // --- Monthly progress report (MR-4/MR-6, D-#399) ---
  // The fallback paragraph is deliberately PLAIN: it states the two numbers the
  // month turns on and nothing else. It is what a family reads when the model is
  // unreachable or its draft was rejected, so it must never need a person to fix it.
  "monthly_report.comment.fallback": {
    group: "monthlyReport", labelBn: "মাসিক রিপোর্ট — বিকল্প মন্তব্য", placeholders: ["month", "attendanceRate", "homeworkRate"],
    bnDefault:
      "{month} মাসে উপস্থিতি ছিল {attendanceRate}% এবং বাড়ির কাজ জমার হার {homeworkRate}%। বিস্তারিত রিপোর্টে দেখুন; কোনো প্রশ্ন থাকলে শ্রেণি শিক্ষকের সঙ্গে যোগাযোগ করুন।",
    defaultLangMode: "BN",
  },
  "monthly_report.released.title": {
    group: "monthlyReport", labelBn: "মাসিক রিপোর্ট প্রকাশিত — শিরোনাম", placeholders: [],
    bnDefault: "মাসিক অগ্রগতি রিপোর্ট", defaultLangMode: "BN",
  },
  "monthly_report.released.body": {
    group: "monthlyReport", labelBn: "মাসিক রিপোর্ট প্রকাশিত — বার্তা", placeholders: ["studentName", "month"],
    bnDefault: "{studentName}-এর {month} মাসের অগ্রগতি রিপোর্ট প্রকাশিত হয়েছে।", defaultLangMode: "BN",
  },
  "monthly_report.released.wa": {
    group: "monthlyReport", labelBn: "মাসিক রিপোর্ট প্রকাশিত — হোয়াটসঅ্যাপ", placeholders: ["studentName", "month"],
    bnDefault: "আসসালামু আলাইকুম। {studentName}-এর {month} মাসের অগ্রগতি রিপোর্ট প্রকাশিত হয়েছে। অ্যাপে দেখুন।", defaultLangMode: "BN",
  },
  // A REVISED report gets its own wording (§9) — a family must never be handed
  // different numbers under the same message.
  "monthly_report.revised.title": {
    group: "monthlyReport", labelBn: "মাসিক রিপোর্ট সংশোধিত — শিরোনাম", placeholders: [],
    bnDefault: "মাসিক রিপোর্ট সংশোধিত", defaultLangMode: "BN",
  },
  "monthly_report.revised.body": {
    group: "monthlyReport", labelBn: "মাসিক রিপোর্ট সংশোধিত — বার্তা", placeholders: ["studentName", "month"],
    bnDefault: "{studentName}-এর {month} মাসের রিপোর্টে নতুন তথ্য যুক্ত হয়েছে — সংশোধিত সংস্করণ প্রকাশিত হয়েছে।", defaultLangMode: "BN",
  },
  "monthly_report.revised.wa": {
    group: "monthlyReport", labelBn: "মাসিক রিপোর্ট সংশোধিত — হোয়াটসঅ্যাপ", placeholders: ["studentName", "month"],
    bnDefault: "আসসালামু আলাইকুম। {studentName}-এর {month} মাসের রিপোর্ট সংশোধিত হয়েছে — অ্যাপে নতুন সংস্করণ দেখুন।", defaultLangMode: "BN",
  },
  // The Office's nudge to a teacher whose entries are holding a month open. The ITEM
  // LIST is composed server-side and arrives as {items}, so the Principal can reword
  // the wrapper without a deploy while the list itself stays generated.
  "monthly_report.teacher_chase.wa": {
    group: "monthlyReport", labelBn: "শিক্ষককে বাকি কাজের তাগিদ — হোয়াটসঅ্যাপ", placeholders: ["teacherName", "month", "items"],
    bnDefault:
      "আসসালামু আলাইকুম {teacherName}।\n{month} মাসের রিপোর্ট তৈরি করতে নিচের কাজগুলো বাকি আছে:\n{items}\nঅনুগ্রহ করে অ্যাপে এন্ট্রি সম্পন্ন করুন। ধন্যবাদ।",
    defaultLangMode: "BN",
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
      "অনুগ্রহ করে বইটি লাইব্রেরিতে ফেরত দিন। মাআসসালামাহ।",
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
      "লগইন লিংক: https://scdhub.shafayet.me\n" +
      "অনুগ্রহ করে তথ্যগুলো গোপন রাখুন এবং প্রথমবার লগইনের পর সংরক্ষণ করুন।\n" +
      "\n" +
      "আমরা Eximus থেকে ধাপে ধাপে SCD Hub অ্যাপে স্থানান্তরিত হচ্ছি। " +
      "আপাতত দুটি অ্যাপেই একই ধরনের তথ্য দেখা যাবে, তবে শীঘ্রই আমরা সম্পূর্ণভাবে এই অ্যাপে চলে যাব ইনশাআল্লাহ। " +
      "তাই আপনাকে নিয়মিত এই অ্যাপটি ব্যবহার করার জন্য অনুরোধ করা হচ্ছে। " +
      "অ্যাপ ব্যবহারে কোনো সমস্যা হলে তাজকির উস্তাজকে হোয়াটসঅ্যাপে জানান: +880 1717-793162",
    defaultLangMode: "BN",
  },
  "credential.share.staff.wa": {
    group: "credential", labelBn: "লগইন তথ্য শেয়ার (শিক্ষক/স্টাফ)",
    placeholders: ["name", "identifier", "password"],
    bnDefault:
      "আসসালামু আলাইকুম {name}। SCD Hub অ্যাপে আপনার (শিক্ষক/স্টাফ) লগইন তথ্য:\n" +
      "আইডি: {identifier}\n" +
      "পাসওয়ার্ড: {password}\n" +
      "লগইন লিংক: https://scdhub.shafayet.me\n" +
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
      "অনুগ্রহ করে শব্দগুলো বাড়িতে অনুশীলন করান। মাআসসালামাহ — {School}",
    defaultLangMode: "BN",
  },
  "vocab.result.perfect.body": {
    group: "vocab", labelBn: "ভোকাবুলারি ফলাফল — পূর্ণ নম্বর (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["StudentName", "TestDate", "Score", "TotalMarks", "School"],
    bnDefault:
      "আসসালামু আলাইকুম। সম্মানিত অভিভাবক, আলহামদুলিল্লাহ! " +
      "আপনার সন্তান {StudentName} {TestDate} তারিখের ভোকাবুলারি টেস্টে " +
      "{TotalMarks} নম্বরের মধ্যে {Score} পেয়ে সম্পূর্ণ সঠিক করেছে। " +
      "আল্লাহ তাকে আরও উন্নতি দান করুন। মাআসসালামাহ — {School}",
    defaultLangMode: "BN",
  },
  "vocab.result.absent.body": {
    group: "vocab", labelBn: "ভোকাবুলারি ফলাফল — অনুপস্থিত (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["StudentName", "TestDate", "School"],
    bnDefault:
      "আসসালামু আলাইকুম। সম্মানিত অভিভাবক, " +
      "আপনার সন্তান {StudentName} {TestDate} তারিখের ভোকাবুলারি টেস্টে অনুপস্থিত ছিল। " +
      "পরবর্তী টেস্টে অংশগ্রহণ নিশ্চিত করুন। মাআসসালামাহ — {School}",
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
      "অনুগ্রহ করে এই শব্দগুলোতে বিশেষ মনোযোগ দিন। মাআসসালামাহ — {School}",
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
      "আল্লাহ তাকে উত্তরোত্তর উন্নতি দান করুন, আমীন। কোনো জিজ্ঞাসা থাকলে জানাবেন। মাআসসালামাহ।",
    defaultLangMode: "BN",
  },
  "class_test.result.excellent.body": {
    group: "classTest", labelBn: "ক্লাস টেস্ট ফলাফল — চমৎকার / লক্ষণীয় দিক নেই (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["StudentName", "Subject", "TestNumber", "Marks", "TotalMarks"],
    bnDefault:
      "আসসালামু আলাইকুম। আলহামদুলিল্লাহ! {StudentName} {Subject} ক্লাস টেস্ট ({TestNumber})-এ চমৎকার করেছে — {Marks}/{TotalMarks}। " +
      "আল্লাহুম্মা বারিক। এই ধারাবাহিকতা ধরে রাখতে তাকে উৎসাহ দিন। মাআসসালামাহ।",
    defaultLangMode: "BN",
  },
  "class_test.result.absent.body": {
    group: "classTest", labelBn: "ক্লাস টেস্ট ফলাফল — অনুপস্থিত (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["StudentName", "TestDate", "Subject", "TestNumber"],
    bnDefault:
      "আসসালামু আলাইকুম। {StudentName} {TestDate}-এর {Subject} ক্লাস টেস্টে ({TestNumber}) অনুপস্থিত ছিল। " +
      "নিয়মিত উপস্থিতি তার জন্য জরুরি — অনুগ্রহ করে উপস্থিতি নিশ্চিত করুন। মাআসসালামাহ।",
    defaultLangMode: "BN",
  },
  // --- Office → teacher overdue-report chase (CT-4, §6/J6 — the AS-T4 chase
  // posture; the Office nudges the teacher whose reports are overdue, never the
  // teacher chasing themselves. wa.me body only, ADR-003 manual send. D-#167. ---
  "class_test.overdue_chase.wa": {
    group: "classTest", labelBn: "ক্লাস টেস্ট — শিক্ষককে অসম্পূর্ণ ফলাফলের তাগিদ (হোয়াটসঅ্যাপ)",
    placeholders: ["TeacherName", "Count", "ExamList"],
    // D-#373: {ExamList} is now a MULTI-LINE numbered list (class+section · subject ·
    // test · date · pending/roster · days late · CT id) — the old single-line
    // "subject টেস্ট n (dd/mm)" join rendered two same-subject same-date exams in
    // different sections as the identical string twice. Hence the newlines around it
    // instead of an inline ": {ExamList}।".
    bnDefault:
      "আসসালামু আলাইকুম {TeacherName}। আপনার {Count}টি ক্লাস টেস্টের ফলাফল নির্ধারিত সময়ের মধ্যে জমা পড়েনি:\n\n{ExamList}\n\n" +
      "অনুগ্রহ করে দ্রুত ফলাফল এন্ট্রি ও প্রকাশ করুন। মাআসসালামাহ — অফিস।",
    defaultLangMode: "BN",
  },
  // --- D-#597: the 08:00 school-day digest to OFFICE + PRINCIPAL. ONE row per
  //     recipient per day carrying the two counts; the per-exam detail lives on the
  //     dashboard the row deep-links to, never in the inbox. ---
  "class_test.overdue_digest.title": {
    group: "classTest", labelBn: "ক্লাস টেস্ট — বিলম্বিত রিপোর্ট ডাইজেস্ট (শিরোনাম)", placeholders: [],
    bnDefault: "বিলম্বিত ক্লাস টেস্ট রিপোর্ট", defaultLangMode: "BN",
  },
  "class_test.overdue_digest.body": {
    group: "classTest", labelBn: "ক্লাস টেস্ট — বিলম্বিত রিপোর্ট ডাইজেস্ট (ইনবক্স)",
    placeholders: ["Count", "AwaitingSubmit", "AwaitingPublish"],
    bnDefault:
      "{Count}টি ক্লাস টেস্ট রিপোর্ট নির্ধারিত সময় পেরিয়ে গেছে — " +
      "{AwaitingSubmit}টি শিক্ষকের জমার অপেক্ষায়, {AwaitingPublish}টি প্রকাশের অপেক্ষায়। " +
      "বিস্তারিত দেখতে ক্লাস টেস্ট ড্যাশবোর্ডে যান।",
    defaultLangMode: "BN",
  },
  // --- Daily student-comment guardian delivery (CM-2, §6/J-CM1 — the per-comment
  // Bangla body sent to the family, mirroring the Form's per-row WhatsApp message;
  // rendered once per comment, NEVER inside the per-guardian fan-out. D-#172. ------
  "student_comment.notify.title": {
    group: "comment", labelBn: "শিক্ষকের পর্যবেক্ষণ — শিরোনাম", placeholders: [],
    bnDefault: "শিক্ষকের পর্যবেক্ষণ",
    defaultLangMode: "BN",
  },
  "student_comment.notify.body": {
    group: "comment", labelBn: "শিক্ষকের পর্যবেক্ষণ — বার্তা (ইনবক্স + হোয়াটসঅ্যাপ)",
    placeholders: ["StudentName", "CommentType", "CommentText"],
    bnDefault:
      "আসসালামু আলাইকুম। {StudentName} সম্পর্কে শিক্ষকের একটি পর্যবেক্ষণ ({CommentType}): {CommentText} — মাআসসালামাহ।",
    defaultLangMode: "BN",
  },
  // --- Finance fee-due chase (FIN-2B, §6/J-FIN2-7 — the guardian fee-due reminder:
  // an inbox row + wa.me for the family with an outstanding due, rendered once per
  // family, never inline. D-#131/#227. ------------------------------------------
  "finance.fee_due.chase.title": {
    group: "finance", labelBn: "ফি বকেয়ার তাগিদ — শিরোনাম", placeholders: [],
    bnDefault: "ফি বকেয়া",
    defaultLangMode: "BN",
  },
  "finance.fee_due.chase.body": {
    group: "finance", labelBn: "ফি বকেয়ার তাগিদ — বার্তা (ইনবক্স)",
    placeholders: ["StudentName", "AmountDue"],
    bnDefault: "আসসালামু আলাইকুম। {StudentName}-এর ফি বাবদ {AmountDue} টাকা বকেয়া রয়েছে — অনুগ্রহ করে পরিশোধ করুন।",
    defaultLangMode: "BN",
  },
  "finance.fee_due.chase.wa": {
    group: "finance", labelBn: "ফি বকেয়ার তাগিদ — হোয়াটসঅ্যাপ",
    placeholders: ["StudentName", "AmountDue"],
    bnDefault: "আসসালামু আলাইকুম। {StudentName}-এর ফি বাবদ {AmountDue} টাকা বকেয়া রয়েছে — অনুগ্রহ করে পরিশোধ করুন। মাআসসালামাহ।",
    defaultLangMode: "BN",
  },
  // --- Saturday Revision guardian delivery (SR-2, D-#244/#131) ---
  "sr.absent.title": {
    group: "saturdayRevision", labelBn: "শনিবার রিভিশনে অনুপস্থিত — শিরোনাম", placeholders: [],
    bnDefault: "শনিবারের রিভিশনে অনুপস্থিত", defaultLangMode: "BN",
  },
  "sr.absent.body": {
    group: "saturdayRevision", labelBn: "শনিবার রিভিশনে অনুপস্থিত — বার্তা (ইনবক্স)",
    placeholders: ["StudentName", "Date"],
    bnDefault: "আসসালামু আলাইকুম। {StudentName} {Date} তারিখের শনিবারের কুরআন রিভিশনে অনুপস্থিত ছিল।",
    defaultLangMode: "BN",
  },
  "sr.absent.wa": {
    group: "saturdayRevision", labelBn: "শনিবার রিভিশনে অনুপস্থিত — হোয়াটসঅ্যাপ",
    placeholders: ["StudentName", "Date"],
    bnDefault: "আসসালামু আলাইকুম। {StudentName} {Date} তারিখের শনিবারের কুরআন রিভিশনে অনুপস্থিত ছিল। মাআসসালামাহ।",
    defaultLangMode: "BN",
  },
  "sr.digest.title": {
    group: "saturdayRevision", labelBn: "সাপ্তাহিক রিভিশন রিপোর্ট — শিরোনাম", placeholders: [],
    bnDefault: "সাপ্তাহিক কুরআন রিভিশন রিপোর্ট", defaultLangMode: "BN",
  },
  "sr.digest.body": {
    group: "saturdayRevision", labelBn: "সাপ্তাহিক রিভিশন রিপোর্ট — বার্তা (ইনবক্স)",
    placeholders: ["StudentName", "Date", "Summary"],
    bnDefault: "আসসালামু আলাইকুম। {StudentName}-এর {Date} তারিখের কুরআন রিভিশন:\n{Summary}",
    defaultLangMode: "BN",
  },
  "sr.digest.wa": {
    group: "saturdayRevision", labelBn: "সাপ্তাহিক রিভিশন রিপোর্ট — হোয়াটসঅ্যাপ",
    placeholders: ["StudentName", "Date", "Summary"],
    bnDefault: "আসসালামু আলাইকুম। {StudentName}-এর {Date} তারিখের কুরআন রিভিশন:\n{Summary}\nমাআসসালামাহ।",
    defaultLangMode: "BN",
  },
  // --- Saturday Revision completeness chase (SR-3, D-#246/#131; stateless Office nudge) ---
  "sr.completeness_chase.wa": {
    group: "saturdayRevision", labelBn: "রিভিশন এন্ট্রি বাকি — হোয়াটসঅ্যাপ (শিক্ষককে)",
    placeholders: ["TeacherName", "GroupName", "Date"],
    bnDefault: "আসসালামু আলাইকুম {TeacherName}। {GroupName} গ্রুপের {Date} তারিখের শনিবারের রিভিশন এখনও এন্ট্রি করা হয়নি — অনুগ্রহ করে সম্পন্ন করুন। মাআসসালামাহ।",
    defaultLangMode: "BN",
  },
  // --- Weekly guardian homework digest (D-#452): {Unsubmitted}/{HeadsUp} are
  // pre-built multi-line sections (sr.digest posture — lists flow through ONE
  // placeholder; renderTemplate does flat interpolation only). ---
  "homework.weeklyDigest.title": {
    group: "homework", labelBn: "সাপ্তাহিক বাড়ির কাজ রিপোর্ট — শিরোনাম", placeholders: [],
    bnDefault: "সাপ্তাহিক বাড়ির কাজ রিপোর্ট", defaultLangMode: "BN",
  },
  "homework.weeklyDigest.body": {
    group: "homework", labelBn: "সাপ্তাহিক বাড়ির কাজ রিপোর্ট — বার্তা (ইনবক্স)",
    placeholders: ["StudentName", "WeekRange", "Unsubmitted", "HeadsUp"],
    bnDefault: "আসসালামু আলাইকুম। {StudentName}-এর এই সপ্তাহের ({WeekRange}) বাড়ির কাজ:\n{Unsubmitted}\n{HeadsUp}",
    defaultLangMode: "BN",
  },
  "homework.weeklyDigest.wa": {
    group: "homework", labelBn: "সাপ্তাহিক বাড়ির কাজ রিপোর্ট — হোয়াটসঅ্যাপ",
    placeholders: ["StudentName", "WeekRange", "Unsubmitted", "HeadsUp"],
    bnDefault: "আসসালামু আলাইকুম। {StudentName}-এর এই সপ্তাহের ({WeekRange}) বাড়ির কাজ:\n{Unsubmitted}\n{HeadsUp}\nমাআসসালামাহ।",
    defaultLangMode: "BN",
  },
  // --- Teaching notes / নোট ও গাইড (TN-3, D-#519–#523). Staff-facing only. ---
  "teachingNote.published.title": {
    group: "teachingNote", labelBn: "নতুন নোট ও গাইড — শিরোনাম", placeholders: [],
    bnDefault: "নতুন নোট ও গাইড", defaultLangMode: "BN",
  },
  "teachingNote.published.body": {
    group: "teachingNote", labelBn: "নতুন নোট ও গাইড — বার্তা",
    placeholders: ["className", "subject", "title"],
    bnDefault: "{className} · {subject} — “{title}” যোগ করা হয়েছে।", defaultLangMode: "BN",
  },
  "teachingNote.comment.title": {
    group: "teachingNote", labelBn: "নোটে নতুন পরামর্শ — শিরোনাম", placeholders: [],
    bnDefault: "নোটে নতুন পরামর্শ", defaultLangMode: "BN",
  },
  "teachingNote.comment.body": {
    group: "teachingNote", labelBn: "নোটে নতুন পরামর্শ — বার্তা",
    placeholders: ["teacherName", "className", "subject", "title"],
    bnDefault: "{teacherName} “{title}” ({className} · {subject}) নোটে একটি পরামর্শ দিয়েছেন।",
    defaultLangMode: "BN",
  },
  "teachingNote.commentAddressed.title": {
    group: "teachingNote", labelBn: "পরামর্শ সমাধান হয়েছে — শিরোনাম", placeholders: [],
    bnDefault: "আপনার পরামর্শ সমাধান হয়েছে", defaultLangMode: "BN",
  },
  "teachingNote.commentAddressed.body": {
    group: "teachingNote", labelBn: "পরামর্শ সমাধান হয়েছে — বার্তা",
    placeholders: ["title", "className", "subject"],
    bnDefault: "“{title}” ({className} · {subject}) নোটে আপনার দেওয়া পরামর্শটি সমাধান হয়েছে বলে চিহ্নিত করা হয়েছে।",
    defaultLangMode: "BN",
  },
};


// --- A.15 STUDENT-COMMENTS / PARENTS-MEETING ENUMS (app-native; Comments & ----
// Parents-Meeting module — prd-comments-meetings §4, D-#114/#115). NO wire-contract
// twin: a daily comment is a feature, not import content, and every row names a
// studentId — operational/identity-plane behind the ADR-005 firewall. Additive +
// disjoint from every other enum (AGENTS rule 5). CM-1 ships the two enums; the
// NOTIFICATION_KINDS += STUDENT_COMMENT/MEETING_SCHEDULE values belong to the
// delivery slice (CM-2), not here.

/** Daily-comment type (CM-1, §3/§4, D-#115). Carried VERBATIM from the live
 *  Student-Complain Form's M-column taxonomy. Subject-free — about the whole child,
 *  not a subject's content (no HW_SUBJECTS axis). Required (the Form's optional,
 *  often-blank column becomes a required enum). */
export const COMMENT_TYPES = [
  "GENERAL",
  "ATTENDANCE",
  "STUDY_HOMEWORK",
  "BEHAVIOUR",
  "SERIOUS_MATTER",
] as const;
export type CommentType = (typeof COMMENT_TYPES)[number];

export const COMMENT_TYPE_LABELS_BN: Record<CommentType, string> = {
  GENERAL: "সাধারণ",
  ATTENDANCE: "উপস্থিতি",
  STUDY_HOMEWORK: "পড়াশোনা / বাড়ির কাজ",
  BEHAVIOUR: "আচরণ",
  SERIOUS_MATTER: "গুরুতর বিষয়",
};
export const COMMENT_TYPE_LABELS_EN: Record<CommentType, string> = {
  GENERAL: "General",
  ATTENDANCE: "Attendance",
  STUDY_HOMEWORK: "Study / Homework",
  BEHAVIOUR: "Behaviour",
  SERIOUS_MATTER: "Serious matter",
};

/** Daily-comment sentiment (CM-1, §3/§4, D-#115). A comment frames a CONCERN to
 *  act on, or a POSITIVE note to share — the Form's two-tone split. */
export const COMMENT_SENTIMENTS = ["CONCERN", "POSITIVE"] as const;
export type CommentSentiment = (typeof COMMENT_SENTIMENTS)[number];

export const COMMENT_SENTIMENT_LABELS_BN: Record<CommentSentiment, string> = {
  CONCERN: "উদ্বেগ",
  POSITIVE: "ইতিবাচক",
};
export const COMMENT_SENTIMENT_LABELS_EN: Record<CommentSentiment, string> = {
  CONCERN: "Concern",
  POSITIVE: "Positive",
};


// --- A.x SATURDAY-REVISION ENUMS (app-native; Saturday-Revision module — ---------
// prd-sr1 §4, D-#241–#243; source REQ docs/saturday-revision-requirements.md).
// The per-juz Qur'an Hifz revision record (replaces the paper শিক্ষার্থীর পাঠ
// সম্পাদন রিপোর্ট). NO wire-contract twin (D-#46, AGENTS rule 5): a revision entry
// is a FEATURE, not import `doc_type` content — every row names a studentId, so it
// is operational/identity plane behind the ADR-005 firewall. SR-1 freezes ONLY the
// two entry enums; the delivery NOTIFICATION_KINDS + MT keys are SR-2's (kept out of
// SR-1's footprint). Additive + disjoint from every other enum.

/** The three Hifz revision categories recorded per juz (SR-1, §3/§4). SABAQ = new
 *  memorisation, SABQI = the most-recent lesson, MANZIL = older revision. */
export const REVISION_CATEGORIES = ["SABAQ", "SABQI", "MANZIL"] as const;
export type RevisionCategory = (typeof REVISION_CATEGORIES)[number];
export const REVISION_CATEGORY_LABELS_BN: Record<RevisionCategory, string> = {
  SABAQ: "নতুন মুখস্ত",
  SABQI: "সর্বসাম্প্রতিক পাঠ",
  MANZIL: "পুরনো রিভিশন",
};
export const REVISION_CATEGORY_LABELS_EN: Record<RevisionCategory, string> = {
  SABAQ: "Sabaq (new)",
  SABQI: "Sabqi (recent)",
  MANZIL: "Manzil (old revision)",
};

/** The structured tajweed-mistake categories counted per juz record (SR-1, §3/§4).
 *  Counts feed the SR-3 per-juz weakness analytics. */
export const REVISION_MISTAKE_CATEGORIES = ["HARF", "GHUNNAH", "MADD", "OTHER"] as const;
export type RevisionMistakeCategory = (typeof REVISION_MISTAKE_CATEGORIES)[number];
export const REVISION_MISTAKE_CATEGORY_LABELS_BN: Record<RevisionMistakeCategory, string> = {
  HARF: "হরফে সমস্যা",
  GHUNNAH: "গুন্নাহ",
  MADD: "মাদ",
  OTHER: "অন্যান্য",
};
export const REVISION_MISTAKE_CATEGORY_LABELS_EN: Record<RevisionMistakeCategory, string> = {
  HARF: "Harf (letter)",
  GHUNNAH: "Ghunnah",
  MADD: "Madd",
  OTHER: "Other",
};


// --- A.16 CLASSROOM-OBSERVATION ENUMS (app-native; Classroom-Observation module --
// — prd-classroom-observation §4, D-#146/#147, build rulings D-#194/#191). NO
// wire-contract twin (D-#46/#52): an observation is a staff feature, not import
// content, and every row names a teacherId/observerId — operational/identity plane
// behind the ADR-005 firewall. Additive + disjoint from every other enum (AGENTS
// rule 5). CO-1 ships the REF-11 FORM enums + the pipeline state + the four new
// permissions; CO-5 adds the Quran (ClassEcho) payload enums (QURAN_REVIEW_CRITERIA /
// QURAN_COMPLIANCE_ITEMS — below, after GROWTH_PROGRESS); CO-6 adds the scheduler
// SUPPORT_TIERS (after the Quran block).
//
// The REF-11 rubric is curriculum-owned + LOCKED (Project 00/07, D-#146); the labels
// below are the NON-AUTHORITATIVE §3 echo the app carries for operational structure +
// BN/EN UI — the authoritative anchors stay in REF-11 (admin-editable later, MT-1).

/** Which review form a classroom observation uses (CO-1, §4). REF-11 for
 *  general+Arabic+Islam (`HW_SUBJECTS`); the ported ClassEcho form for QURAN
 *  (the Quran payload itself is CO-5). The form is chosen by subject. */
export const OBSERVATION_FORMS = ["REF11", "QURAN"] as const;
export type ObservationForm = (typeof OBSERVATION_FORMS)[number];
export const OBSERVATION_FORM_LABELS_BN: Record<ObservationForm, string> = {
  REF11: "REF-11 ফর্ম",
  QURAN: "কুরআন ফর্ম",
};
export const OBSERVATION_FORM_LABELS_EN: Record<ObservationForm, string> = {
  REF11: "REF-11 form",
  QURAN: "Quran form",
};

/** The five REF-11 teaching domains, scored 1–4 each (CO-1, §4). Non-authoritative
 *  §3 echo — the canonical domain wording lives in REF-11 v1.1 (D-#146). */
export const OBSERVATION_DOMAINS = ["D1", "D2", "D3", "D4", "D5"] as const;
export type ObservationDomain = (typeof OBSERVATION_DOMAINS)[number];
export const OBSERVATION_DOMAIN_LABELS_BN: Record<ObservationDomain, string> = {
  D1: "পরিকল্পনা ও স্পষ্টতা",
  D2: "প্রশ্ন ও চিন্তন (ব্লুম)",
  D3: "সম্পৃক্ততা ও অংশগ্রহণ",
  D4: "মূল্যায়ন ও ফিডব্যাক",
  D5: "শ্রেণিকক্ষের পরিবেশ ও ব্যবস্থাপনা",
};
export const OBSERVATION_DOMAIN_LABELS_EN: Record<ObservationDomain, string> = {
  D1: "Planning & clarity",
  D2: "Questioning & thinking (Bloom, REF-18 §4)",
  D3: "Engagement & participation",
  D4: "Assessment & feedback",
  D5: "Classroom climate & management",
};

/** REF-11 domain levels 1–4 (CO-1, §4). Level 3 = the working standard; there is
 *  NO total/average — a level is recorded per domain and never summed. */
export const OBSERVATION_LEVELS = [1, 2, 3, 4] as const;
export type ObservationLevel = (typeof OBSERVATION_LEVELS)[number];
export const OBSERVATION_LEVEL_LABELS_BN: Record<ObservationLevel, string> = {
  1: "সহায়তা প্রয়োজন",
  2: "বিকাশমান",
  3: "কার্যকর মান",
  4: "শক্তিশালী",
};
export const OBSERVATION_LEVEL_LABELS_EN: Record<ObservationLevel, string> = {
  1: "Needs support",
  2: "Developing",
  3: "Working standard",
  4: "Strong",
};

/** The two REF-11 gates (CO-1, §4/§2.1). A gate is PASS/BREACH and stands on its
 *  own regardless of the domain levels. Non-authoritative §3 echo. */
export const OBSERVATION_GATES = ["G1", "G2"] as const;
export type ObservationGate = (typeof OBSERVATION_GATES)[number];
export const OBSERVATION_GATE_LABELS_BN: Record<ObservationGate, string> = {
  G1: "নিরাপদ ও সম্মানজনক পরিবেশ",
  G2: "অন্তর্ভুক্তি ও ন্যায্য আচরণ",
};
export const OBSERVATION_GATE_LABELS_EN: Record<ObservationGate, string> = {
  G1: "Safe & respectful environment",
  G2: "Inclusion & fair treatment",
};

/** A gate's outcome (CO-1, §4). A BREACH is recorded independently of the levels. */
export const GATE_RESULTS = ["PASS", "BREACH"] as const;
export type GateResult = (typeof GATE_RESULTS)[number];
export const GATE_RESULT_LABELS_BN: Record<GateResult, string> = {
  PASS: "উত্তীর্ণ",
  BREACH: "লঙ্ঘন",
};
export const GATE_RESULT_LABELS_EN: Record<GateResult, string> = {
  PASS: "Pass",
  BREACH: "Breach",
};

/** The observation pipeline state (CO-1, §4). UPLOADED → ASSIGNED → REVIEWED
 *  (releases to the observed teacher; no Principal sign-off) → TEACHER_RESPONDED
 *  (CO-3). A re-review SUPERSEDES the prior observation. */
export const OBSERVATION_STATES = [
  "UPLOADED",
  "ASSIGNED",
  "REVIEWED",
  "TEACHER_RESPONDED",
  "SUPERSEDED",
] as const;
export type ObservationState = (typeof OBSERVATION_STATES)[number];
export const OBSERVATION_STATE_LABELS_BN: Record<ObservationState, string> = {
  UPLOADED: "আপলোডকৃত",
  ASSIGNED: "বরাদ্দকৃত",
  REVIEWED: "পর্যালোচিত",
  TEACHER_RESPONDED: "শিক্ষকের জবাব",
  SUPERSEDED: "প্রতিস্থাপিত",
};
export const OBSERVATION_STATE_LABELS_EN: Record<ObservationState, string> = {
  UPLOADED: "Uploaded",
  ASSIGNED: "Assigned",
  REVIEWED: "Reviewed",
  TEACHER_RESPONDED: "Teacher responded",
  SUPERSEDED: "Superseded",
};

/** REF-11 carry-forward: on a re-review, did the prior growth-focus progress?
 *  (CO-1, §4 — `priorFocusProgress`). */
export const GROWTH_PROGRESS = ["YES", "PARTLY", "NOT_YET"] as const;
export type GrowthProgress = (typeof GROWTH_PROGRESS)[number];
export const GROWTH_PROGRESS_LABELS_BN: Record<GrowthProgress, string> = {
  YES: "হ্যাঁ",
  PARTLY: "আংশিক",
  NOT_YET: "এখনও নয়",
};
export const GROWTH_PROGRESS_LABELS_EN: Record<GrowthProgress, string> = {
  YES: "Yes",
  PARTLY: "Partly",
  NOT_YET: "Not yet",
};

// --- A.16b QURAN (ClassEcho) FORM PAYLOAD ENUMS (CO-5, prd-classroom-observation
// §CO-5, D-#56) ----------------------------------------------------------------
// The Quran observation uses its OWN form (NEVER REF-11): a ClassEcho-ported set of
// rating items (1–5 each) + yes/no compliance items. App-native, NO wire twin
// (D-#46) — same identity/operational plane behind the ADR-005 firewall. The
// QURAN_REVIEW_CRITERIA labels echo the LIVE ClassEcho `video.model.ts` review keys
// (pinned, not re-fetched); the QURAN_COMPLIANCE_ITEMS are FINAL per the PRD (not
// from ClassEcho). Like the REF-11 echo above, NON-AUTHORITATIVE UI structure.

/** The 8 ClassEcho rating criteria, each scored 1–5 (CO-5, §CO-5). Mirrors the
 *  LIVE ClassEcho `video.model.ts` review keys; there is NO total/average. */
export const QURAN_REVIEW_CRITERIA = [
  "SUBJECT_KNOWLEDGE",
  "ENGAGEMENT_WITH_STUDENTS",
  "USE_OF_TEACHING_AIDS",
  "INTERACTION_AND_QUESTION_HANDLING",
  "STUDENT_DISCIPLINE",
  "TEACHERS_CONTROL_OVER_CLASS",
  "PARTICIPATION_LEVEL_OF_STUDENTS",
  "COMPLETION_OF_PLANNED_SYLLABUS",
] as const;
export type QuranReviewCriterion = (typeof QURAN_REVIEW_CRITERIA)[number];
export const QURAN_REVIEW_CRITERIA_LABELS_BN: Record<QuranReviewCriterion, string> = {
  SUBJECT_KNOWLEDGE: "বিষয়জ্ঞান",
  ENGAGEMENT_WITH_STUDENTS: "শিক্ষার্থীদের সাথে সম্পৃক্ততা",
  USE_OF_TEACHING_AIDS: "শিক্ষা উপকরণের ব্যবহার",
  INTERACTION_AND_QUESTION_HANDLING: "মিথস্ক্রিয়া ও প্রশ্ন সামলানো",
  STUDENT_DISCIPLINE: "শিক্ষার্থী শৃঙ্খলা",
  TEACHERS_CONTROL_OVER_CLASS: "শ্রেণির উপর শিক্ষকের নিয়ন্ত্রণ",
  PARTICIPATION_LEVEL_OF_STUDENTS: "শিক্ষার্থীদের অংশগ্রহণের মাত্রা",
  COMPLETION_OF_PLANNED_SYLLABUS: "পরিকল্পিত সিলেবাস সম্পন্নকরণ",
};
export const QURAN_REVIEW_CRITERIA_LABELS_EN: Record<QuranReviewCriterion, string> = {
  SUBJECT_KNOWLEDGE: "Subject knowledge",
  ENGAGEMENT_WITH_STUDENTS: "Engagement with students",
  USE_OF_TEACHING_AIDS: "Use of teaching aids",
  INTERACTION_AND_QUESTION_HANDLING: "Interaction & question handling",
  STUDENT_DISCIPLINE: "Student discipline",
  TEACHERS_CONTROL_OVER_CLASS: "Teacher's control over class",
  PARTICIPATION_LEVEL_OF_STUDENTS: "Participation level of students",
  COMPLETION_OF_PLANNED_SYLLABUS: "Completion of planned syllabus",
};

/** The 7 Quran-form yes/no compliance items (CO-5, §CO-5 — FINAL per the PRD, NOT
 *  from ClassEcho). Each is answered yes/no. */
export const QURAN_COMPLIANCE_ITEMS = [
  "CLASS_STARTED_ON_TIME",
  "CLASS_PERFORMED_AS_TRAINED",
  "MAINTAINS_DISCIPLINE",
  "STUDENTS_UNDERSTAND_LESSON",
  "CLASS_IS_INTERACTIVE",
  "SIGNS_HOMEWORK_DIARY",
  "CHECKS_HOMEWORK_DIARY",
] as const;
export type QuranComplianceItem = (typeof QURAN_COMPLIANCE_ITEMS)[number];
export const QURAN_COMPLIANCE_ITEM_LABELS_BN: Record<QuranComplianceItem, string> = {
  CLASS_STARTED_ON_TIME: "ক্লাস সময়মতো শুরু হয়েছে",
  CLASS_PERFORMED_AS_TRAINED: "প্রশিক্ষণ অনুযায়ী ক্লাস পরিচালিত হয়েছে",
  MAINTAINS_DISCIPLINE: "শৃঙ্খলা বজায় রাখে",
  STUDENTS_UNDERSTAND_LESSON: "শিক্ষার্থীরা পাঠ বুঝতে পারে",
  CLASS_IS_INTERACTIVE: "ক্লাসটি মিথস্ক্রিয়ামূলক",
  SIGNS_HOMEWORK_DIARY: "বাড়ির কাজের ডায়েরিতে স্বাক্ষর করে",
  CHECKS_HOMEWORK_DIARY: "বাড়ির কাজের ডায়েরি পরীক্ষা করে",
};
export const QURAN_COMPLIANCE_ITEM_LABELS_EN: Record<QuranComplianceItem, string> = {
  CLASS_STARTED_ON_TIME: "Class started on time",
  CLASS_PERFORMED_AS_TRAINED: "Class performed as trained",
  MAINTAINS_DISCIPLINE: "Maintains discipline",
  STUDENTS_UNDERSTAND_LESSON: "Students understand the lesson",
  CLASS_IS_INTERACTIVE: "Class is interactive",
  SIGNS_HOMEWORK_DIARY: "Signs homework diary",
  CHECKS_HOMEWORK_DIARY: "Checks homework diary",
};

/** Quran-form rating scale 1–5 (CO-5, §CO-5). Echoes the ClassEcho 1–5 score range;
 *  there is NO total/average (the REF-11 posture). */
export const QURAN_REVIEW_SCORE_MIN = 1;
export const QURAN_REVIEW_SCORE_MAX = 5;


// --- A.16c REVIEW-SCHEDULER SUPPORT TIERS (CO-6, prd-classroom-observation §CO-6) --
// App-native, NO wire twin (D-#46) — same identity/operational plane behind the
// ADR-005 firewall. A teacher's tier is DERIVED at read time from their most recent
// released review (NEVER stored): REF-11 → domain levels (≥3 vs 1/2) + a recent gate
// breach; Quran → average rating + compliance. The tier sets the review INTERVAL
// (STRONG = longest, DEVELOPING = base, NEEDS_SUPPORT = shortest), with the base + the
// per-tier multipliers admin-tunable (observation:manage). Framed as support, never a
// public label (§CO-6 guardrails).

/** The three review-cadence support tiers (CO-6, §CO-6). STRONG → longest interval,
 *  DEVELOPING → the base interval, NEEDS_SUPPORT → the shortest. Derived from review
 *  data only; developmental framing. */
export const SUPPORT_TIERS = ["STRONG", "DEVELOPING", "NEEDS_SUPPORT"] as const;
export type SupportTier = (typeof SUPPORT_TIERS)[number];
export const SUPPORT_TIER_LABELS_BN: Record<SupportTier, string> = {
  STRONG: "শক্তিশালী",
  DEVELOPING: "বিকাশমান",
  NEEDS_SUPPORT: "সহায়তা প্রয়োজন",
};
export const SUPPORT_TIER_LABELS_EN: Record<SupportTier, string> = {
  STRONG: "Strong",
  DEVELOPING: "Developing",
  NEEDS_SUPPORT: "Needs support",
};


// --- A.17 FINANCE / ACCOUNTING VOCAB FREEZE (FIN-1, prd-finance-fin1.md §4,
// D-#221–#223/#247; module REQ finance-requirements.md §3) ---------------------
// App-native, NO wire/envelope twin (REQ §9, D-#46) — finance is an operational/
// identity-plane FEATURE (every posting names a ledger/student/party), NOT import
// corpus content, behind the ADR-005 firewall. FIN-1 owns the WHOLE-module vocab
// freeze in one edit (the "one vocab owner at a time" rule): ledgers, payment modes,
// the income/student-fee/movement/expense heads, and the Qard/IOU directions+types.
// The models that CONSUME the heads (postings) are FIN-2/FIN-3. Codes are English
// UPPER_SNAKE; every enum gets total BN+EN label maps and a verifier section (§C.18).
//
// NAMESPACING: `FINANCE_*` / `LEDGER_*` / `QARD_IOU_*` deliberately dodge the HR
// `PAYMENT_METHODS`/`PaymentMethod` enum (salary disbursement: bank/bkash/cash) —
// finance's modes are CASH/BANK/ONLINE and must never collide with it.
//
// Head lists RATIFIED 2026-06-15 (D-#247): 22 expense / 11 income / 7 student-fee,
// confirmed final. Heads are a CODE-CONTROLLED list (not an Office registry) — a new
// head is an additive vocab edit (one line + BN/EN + verifier; NO migration; existing
// postings keep their head); the OTHER head + a free-text note is the runtime valve.

/** The 5 finance ledgers (FIN-1 §4; REQ §3). CASH/BANK/ONLINE are the movement-mode
 *  ledgers; QARD_CONTROL/IOU_CONTROL are the control ledgers whose opening may be
 *  negative. Exactly these five — the snapshot/dashboard always reads the 5-vector. */
export const LEDGER_KINDS = ["CASH", "BANK", "ONLINE", "QARD_CONTROL", "IOU_CONTROL"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const LEDGER_KIND_LABELS_BN: Record<LedgerKind, string> = {
  CASH: "নগদ",
  BANK: "ব্যাংক",
  ONLINE: "অনলাইন পেমেন্ট",
  QARD_CONTROL: "কর্জে হাসানা (নিয়ন্ত্রণ)",
  IOU_CONTROL: "আইওইউ (নিয়ন্ত্রণ)",
};
export const LEDGER_KIND_LABELS_EN: Record<LedgerKind, string> = {
  CASH: "Cash",
  BANK: "Bank",
  ONLINE: "Online Payment",
  QARD_CONTROL: "Qard-e-Hasana (control)",
  IOU_CONTROL: "IOU (control)",
};

/** The 3 finance movement modes (FIN-1 §4; REQ §3). DISTINCT from the HR
 *  PAYMENT_METHODS enum (salary disbursement) — finance uses its own namespaced set. */
export const FINANCE_PAYMENT_MODES = ["CASH", "BANK", "ONLINE"] as const;
export type FinancePaymentMode = (typeof FINANCE_PAYMENT_MODES)[number];
export const FINANCE_PAYMENT_MODE_LABELS_BN: Record<FinancePaymentMode, string> = {
  CASH: "নগদ",
  BANK: "ব্যাংক",
  ONLINE: "অনলাইন",
};
export const FINANCE_PAYMENT_MODE_LABELS_EN: Record<FinancePaymentMode, string> = {
  CASH: "Cash",
  BANK: "Bank",
  ONLINE: "Online",
};

/** The 11 true-income heads (FIN-1 §4; REQ §3 — RATIFIED D-#247). These are real
 *  revenue (FIN-5 budget/actual counts them); the ledger-movement heads below are NOT. */
export const FINANCE_INCOME_HEADS = [
  "ADMISSION_FEE",
  "SESSION_FEE",
  "TUITION_FEE",
  "BOOKS_STATIONERIES",
  "REVISION_FEE",
  "TRANSPORT_FEE",
  "APPLICATION_FORM_PROSPECTUS",
  "SADAKA",
  "SUBSIDY",
  "OTHER_FEE",
  "OTHER",
] as const;
export type FinanceIncomeHead = (typeof FINANCE_INCOME_HEADS)[number];
export const FINANCE_INCOME_HEAD_LABELS_BN: Record<FinanceIncomeHead, string> = {
  ADMISSION_FEE: "ভর্তি ফি",
  SESSION_FEE: "সেশন ফি",
  TUITION_FEE: "টিউশন ফি",
  BOOKS_STATIONERIES: "বই ও স্টেশনারি",
  REVISION_FEE: "রিভিশন ফি",
  TRANSPORT_FEE: "পরিবহন ফি",
  APPLICATION_FORM_PROSPECTUS: "আবেদন ফরম ও প্রসপেক্টাস",
  SADAKA: "সাদাকা",
  SUBSIDY: "ভর্তুকি",
  OTHER_FEE: "অন্যান্য ফি",
  OTHER: "অন্যান্য",
};
export const FINANCE_INCOME_HEAD_LABELS_EN: Record<FinanceIncomeHead, string> = {
  ADMISSION_FEE: "Admission Fee",
  SESSION_FEE: "Session Fee",
  TUITION_FEE: "Tuition Fee",
  BOOKS_STATIONERIES: "Books & Stationeries",
  REVISION_FEE: "Revision Fee",
  TRANSPORT_FEE: "Transport Fee",
  APPLICATION_FORM_PROSPECTUS: "Application Form & Prospectus",
  SADAKA: "Sadaka",
  SUBSIDY: "Subsidy",
  OTHER_FEE: "Other Fee",
  OTHER: "Other",
};

/** The 7 per-child student-fee heads (FIN-1 §4; REQ §3 — RATIFIED D-#247). The
 *  per-child split at fee posting (FIN-2); OTHER carries a free-text label then. */
export const FINANCE_STUDENT_FEE_HEADS = [
  "ADMISSION",
  "SESSION",
  "TUITION",
  "BOOKS_STATIONERIES",
  "REVISION",
  "TRANSPORT",
  "OTHER",
] as const;
export type FinanceStudentFeeHead = (typeof FINANCE_STUDENT_FEE_HEADS)[number];
export const FINANCE_STUDENT_FEE_HEAD_LABELS_BN: Record<FinanceStudentFeeHead, string> = {
  ADMISSION: "ভর্তি",
  SESSION: "সেশন",
  TUITION: "টিউশন",
  BOOKS_STATIONERIES: "বই ও স্টেশনারি",
  REVISION: "রিভিশন",
  TRANSPORT: "পরিবহন",
  OTHER: "অন্যান্য",
};
export const FINANCE_STUDENT_FEE_HEAD_LABELS_EN: Record<FinanceStudentFeeHead, string> = {
  ADMISSION: "Admission",
  SESSION: "Session",
  TUITION: "Tuition",
  BOOKS_STATIONERIES: "Books & Stationeries",
  REVISION: "Revision",
  TRANSPORT: "Transport",
  OTHER: "Other",
};

/** The 3 ledger-movement heads (FIN-1 §4; REQ §3). NOT income — kept a separate enum
 *  so FIN-5 budget/actual never counts a deposit/repayment as revenue. Disjoint from
 *  FINANCE_INCOME_HEADS (verifier-checked). */
export const FINANCE_LEDGER_MOVEMENT_HEADS = ["BANK_DEPOSIT", "QARD_REPAYMENT", "IOU_REPAYMENT"] as const;
export type FinanceLedgerMovementHead = (typeof FINANCE_LEDGER_MOVEMENT_HEADS)[number];
export const FINANCE_LEDGER_MOVEMENT_HEAD_LABELS_BN: Record<FinanceLedgerMovementHead, string> = {
  BANK_DEPOSIT: "ব্যাংক জমা",
  QARD_REPAYMENT: "কর্জ ফেরত",
  IOU_REPAYMENT: "আইওইউ ফেরত",
};
export const FINANCE_LEDGER_MOVEMENT_HEAD_LABELS_EN: Record<FinanceLedgerMovementHead, string> = {
  BANK_DEPOSIT: "Bank Deposit",
  QARD_REPAYMENT: "Qard Repayment",
  IOU_REPAYMENT: "IOU Repayment",
};

/** The 22 unified expense heads (FIN-1 §4; REQ §3 — RATIFIED D-#247). SALARY is the
 *  line HR payroll feeds (the monthly net-payable total — REQ §7); OTHER + a free-text
 *  note is the one-off valve. */
export const FINANCE_EXPENSE_HEADS = [
  "SALARY",
  "RENT",
  "UTILITIES",
  "GAS_BILL",
  "MOBILE_BILLS",
  "REPAIRING_MAINTENANCE",
  "TRANSPORT",
  "CONVEYANCE",
  "CLASS_MATERIAL",
  "OFFICE_STATIONARY",
  "STUDENT_STATIONARY",
  "KITCHEN_MATERIALS",
  "CLEANING",
  "BREAKFAST",
  "LUNCH",
  "AFTERNOON_MEAL",
  "FOOD_REWARD",
  "HALAQA",
  "PICNIC",
  "COMMUNITY",
  "TRAINING",
  "OTHER",
] as const;
export type FinanceExpenseHead = (typeof FINANCE_EXPENSE_HEADS)[number];
export const FINANCE_EXPENSE_HEAD_LABELS_BN: Record<FinanceExpenseHead, string> = {
  SALARY: "বেতন",
  RENT: "ভাড়া",
  UTILITIES: "ইউটিলিটি",
  GAS_BILL: "গ্যাস বিল",
  MOBILE_BILLS: "মোবাইল বিল",
  REPAIRING_MAINTENANCE: "মেরামত ও রক্ষণাবেক্ষণ",
  TRANSPORT: "পরিবহন",
  CONVEYANCE: "যাতায়াত",
  CLASS_MATERIAL: "ক্লাস উপকরণ",
  OFFICE_STATIONARY: "অফিস স্টেশনারি",
  STUDENT_STATIONARY: "শিক্ষার্থী স্টেশনারি",
  KITCHEN_MATERIALS: "রান্নাঘরের উপকরণ",
  CLEANING: "পরিচ্ছন্নতা",
  BREAKFAST: "নাশতা",
  LUNCH: "দুপুরের খাবার",
  AFTERNOON_MEAL: "বিকেলের খাবার",
  FOOD_REWARD: "খাদ্য পুরস্কার",
  HALAQA: "হালাকা",
  PICNIC: "পিকনিক",
  COMMUNITY: "কমিউনিটি",
  TRAINING: "প্রশিক্ষণ",
  OTHER: "অন্যান্য",
};
export const FINANCE_EXPENSE_HEAD_LABELS_EN: Record<FinanceExpenseHead, string> = {
  SALARY: "Salary",
  RENT: "Rent",
  UTILITIES: "Utilities",
  GAS_BILL: "Gas Bill",
  MOBILE_BILLS: "Mobile Bills",
  REPAIRING_MAINTENANCE: "Repairing & Maintenance",
  TRANSPORT: "Transport",
  CONVEYANCE: "Conveyance",
  CLASS_MATERIAL: "Class Material",
  OFFICE_STATIONARY: "Office Stationary",
  STUDENT_STATIONARY: "Student Stationary",
  KITCHEN_MATERIALS: "Kitchen Materials",
  CLEANING: "Cleaning",
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  AFTERNOON_MEAL: "Afternoon Meal",
  FOOD_REWARD: "Food Reward",
  HALAQA: "Halaqa",
  PICNIC: "Picnic",
  COMMUNITY: "Community",
  TRAINING: "Training",
  OTHER: "Other",
};

/** Qard/IOU register directions (FIN-1 §4; REQ §3). ADJUSTMENT = opening balance.
 *  The register itself is FIN-3; FIN-1 only freezes the dir/type enums. */
export const QARD_IOU_DIRECTIONS = ["NEW_DISBURSEMENT", "REPAYMENT_RECEIVED", "ADJUSTMENT"] as const;
export type QardIouDirection = (typeof QARD_IOU_DIRECTIONS)[number];
export const QARD_IOU_DIRECTION_LABELS_BN: Record<QardIouDirection, string> = {
  NEW_DISBURSEMENT: "নতুন প্রদান",
  REPAYMENT_RECEIVED: "ফেরত গৃহীত",
  ADJUSTMENT: "সমন্বয় (প্রারম্ভিক ব্যালেন্স)",
};
export const QARD_IOU_DIRECTION_LABELS_EN: Record<QardIouDirection, string> = {
  NEW_DISBURSEMENT: "New Disbursement",
  REPAYMENT_RECEIVED: "Repayment Received",
  ADJUSTMENT: "Adjustment (opening balance)",
};

/** Qard/IOU register types (FIN-1 §4; REQ §3). QARD_E_HASANA = benevolent loan; IOU
 *  = a non-salary office advance. Staff salary advances are HR's, not here (REQ §7). */
export const QARD_IOU_TYPES = ["QARD_E_HASANA", "IOU"] as const;
export type QardIouType = (typeof QARD_IOU_TYPES)[number];
export const QARD_IOU_TYPE_LABELS_BN: Record<QardIouType, string> = {
  QARD_E_HASANA: "কর্জে হাসানা",
  IOU: "আইওইউ",
};
export const QARD_IOU_TYPE_LABELS_EN: Record<QardIouType, string> = {
  QARD_E_HASANA: "Qard-e-Hasana",
  IOU: "IOU",
};

// --- A.17b FINANCE POSTING KINDS (FIN-2A, prd-finance-fin2.md §3.A/§4, D-#224) --
// The kind discriminates which block a FinancePosting carries (fee=feeLines+studentId,
// other-income=incomeHead, expense=expenseHead, transfer=mode→toLedger). Additive,
// app-native, NO wire twin. (FEE_COVERAGE_TYPES / FEE_SUPPORT_ALLOCATION_STATUSES +
// the FINANCE_FEE_DUE notification kind + finance.fee_due.chase.* MT keys land with
// FIN-2B.)

/** The 4 finance posting kinds (FIN-2A §3.A). Each discriminates the required block. */
export const FINANCE_POSTING_KINDS = ["FEE_COLLECTION", "OTHER_INCOME", "EXPENSE", "TRANSFER"] as const;
export type FinancePostingKind = (typeof FINANCE_POSTING_KINDS)[number];
export const FINANCE_POSTING_KIND_LABELS_BN: Record<FinancePostingKind, string> = {
  FEE_COLLECTION: "ফি আদায়",
  OTHER_INCOME: "অন্যান্য আয়",
  EXPENSE: "ব্যয়",
  TRANSFER: "স্থানান্তর",
};
export const FINANCE_POSTING_KIND_LABELS_EN: Record<FinancePostingKind, string> = {
  FEE_COLLECTION: "Fee Collection",
  OTHER_INCOME: "Other Income",
  EXPENSE: "Expense",
  TRANSFER: "Transfer",
};

// --- A.17c ZAKAT / 3RD-PARTY FEE-SUPPORT ENUMS (FIN-2B, prd-finance-fin2.md §3.B/§4,
// D-#226) ----------------------------------------------------------------------
// The per-head coverage TYPE on a FeeSupportAllocation + the allocation lifecycle
// status. Additive, app-native, NO wire twin. (PERCENT coverage is deferred — all
// current SCD usage is FULL or a ৳-AMOUNT cap.)

/** Per-head coverage type on a fee-support allocation (FIN-2B §3.B). FULL = the
 *  provider pays the head's whole posted amount; AMOUNT = up to a ৳ cap per posting. */
export const FEE_COVERAGE_TYPES = ["FULL", "AMOUNT"] as const;
export type FeeCoverageType = (typeof FEE_COVERAGE_TYPES)[number];
export const FEE_COVERAGE_TYPE_LABELS_BN: Record<FeeCoverageType, string> = {
  FULL: "সম্পূর্ণ",
  AMOUNT: "নির্দিষ্ট পরিমাণ",
};
export const FEE_COVERAGE_TYPE_LABELS_EN: Record<FeeCoverageType, string> = {
  FULL: "Full",
  AMOUNT: "Fixed amount",
};

/** Fee-support allocation lifecycle (FIN-2B §3.B). Append-only effective-dated rows;
 *  ENDED = superseded / closed (the latest active by createdAt wins). */
export const FEE_SUPPORT_ALLOCATION_STATUSES = ["ACTIVE", "ENDED"] as const;
export type FeeSupportAllocationStatus = (typeof FEE_SUPPORT_ALLOCATION_STATUSES)[number];
export const FEE_SUPPORT_ALLOCATION_STATUS_LABELS_BN: Record<FeeSupportAllocationStatus, string> = {
  ACTIVE: "সক্রিয়",
  ENDED: "সমাপ্ত",
};
export const FEE_SUPPORT_ALLOCATION_STATUS_LABELS_EN: Record<FeeSupportAllocationStatus, string> = {
  ACTIVE: "Active",
  ENDED: "Ended",
};

// --- A.17d QARD/IOU PARTY KINDS (FIN-3, prd-finance-fin3.md §3/§4, D-#232) ------
// The non-staff counterparty kind on a FinanceParty (the Qard-e-Hasana / IOU register).
// Additive, app-native, NO wire twin. (QARD_IOU_TYPES / QARD_IOU_DIRECTIONS were frozen
// in FIN-1 — D-#223; FIN-3 consumes them and adds only the party kind.)

/** The Qard/IOU counterparty kind (FIN-3 §3). A staff salary advance is NOT a party —
 *  HR owns those (D-#188). */
export const FINANCE_PARTY_KINDS = ["COMMUNITY", "INDIVIDUAL", "ORG"] as const;
export type FinancePartyKind = (typeof FINANCE_PARTY_KINDS)[number];
export const FINANCE_PARTY_KIND_LABELS_BN: Record<FinancePartyKind, string> = {
  COMMUNITY: "কমিউনিটি",
  INDIVIDUAL: "ব্যক্তি",
  ORG: "সংস্থা",
};
export const FINANCE_PARTY_KIND_LABELS_EN: Record<FinancePartyKind, string> = {
  COMMUNITY: "Community",
  INDIVIDUAL: "Individual",
  ORG: "Organization",
};

// --- A.17e RECONCILIATION SOURCES (FIN-4, prd-finance-fin4.md §4, D-#235/#236) --
// The two figures the app's DERIVED balance is reconciled against (the bank statement
// and the entered Eximus control figure). Additive, app-native, NO wire twin. DISTINCT
// from the homework-tracker `RECON_STATES` enum (different domain). Drives the diff-source
// label only. (NB: Eximus stays parallel — manual figure, no live link, D-#186.)

/** The two reconciliation sources (FIN-4 §4). BANK = the bank statement balance; EXIMUS
 *  = the entered per-ledger Eximus control figure (D-#236). */
export const RECON_SOURCES = ["BANK", "EXIMUS"] as const;
export type ReconSource = (typeof RECON_SOURCES)[number];
export const RECON_SOURCE_LABELS_BN: Record<ReconSource, string> = {
  BANK: "ব্যাংক স্টেটমেন্ট",
  EXIMUS: "এক্সিমাস কন্ট্রোল",
};
export const RECON_SOURCE_LABELS_EN: Record<ReconSource, string> = {
  BANK: "Bank statement",
  EXIMUS: "Eximus control",
};

// --- A.17f BUDGET LINE KINDS (FIN-5, prd-finance-fin5.md §4, D-#237) ------------
// Whether a budget line targets an expense head or an income head. Additive, app-native,
// NO wire twin. Drives the expense-vs-income split on the variance reads.

/** A budget line's side (FIN-5 §4). EXPENSE = a spend budget per FINANCE_EXPENSE_HEADS;
 *  INCOME = a revenue target per FINANCE_INCOME_HEADS. */
export const BUDGET_LINE_KINDS = ["EXPENSE", "INCOME"] as const;
export type BudgetLineKind = (typeof BUDGET_LINE_KINDS)[number];
export const BUDGET_LINE_KIND_LABELS_BN: Record<BudgetLineKind, string> = {
  EXPENSE: "ব্যয়",
  INCOME: "আয়",
};
export const BUDGET_LINE_KIND_LABELS_EN: Record<BudgetLineKind, string> = {
  EXPENSE: "Expense",
  INCOME: "Income",
};


// --- A.18 BOOK PRODUCTION (SB-1, prd-support-book.md §4, D-#403–#427) ----------
// App-native, NO wire twin, NO harness sync (D-#405): a book's subject rides
// ROUTINE_SUBJECTS and its class rides ROSTER_CLASS_LEVELS, so ISLAM and Nursery are
// expressible without widening the LOCKED content enums.
//
// The values that mirror `SCHEMA_support-book_v1.md` are VERBATIM — they are written
// into and read out of book.json, so renaming one silently breaks the render pipeline.
// The workflow enums below them are ours.

/** Which production line a book belongs to. The engine is type-agnostic (D-#420);
 *  only the per-type adapter (schema, validator set, render profiles, policy set)
 *  may branch on this. */
export const BOOK_TYPES = ["SUPPORT_BOOK", "STORYBOOK"] as const;
export type BookType = (typeof BOOK_TYPES)[number];
export const BOOK_TYPE_LABELS_BN: Record<BookType, string> = {
  SUPPORT_BOOK: "সহায়িকা",
  STORYBOOK: "গল্পের বই",
};
export const BOOK_TYPE_LABELS_EN: Record<BookType, string> = {
  SUPPORT_BOOK: "Support book",
  STORYBOOK: "Storybook",
};

// -- Schema mirrors (VERBATIM from SCHEMA_support-book_v1; do not rename) --------

/** Mode-R = selective genre-matched replacement; Mode-C = exam fidelity, no `replace`. */
export const BOOK_MODES = ["R", "C"] as const;
export type BookMode = (typeof BOOK_MODES)[number];

/** Per-পাঠ action flag. Mode-C books never carry `replace` (validator-enforced). */
export const LESSON_ACTIONS = ["retain", "retain-curated", "replace"] as const;
export type LessonAction = (typeof LESSON_ACTIONS)[number];

/** Severity when action ≠ retain. S4 is the "fits no C-code" ESCALATION flag
 *  (README §3.2), not a band — it routes to the Principal rather than grading. */
export const LESSON_SEVERITIES = ["S1", "S2", "S3", "S4"] as const;
export type LessonSeverity = (typeof LESSON_SEVERITIES)[number];

/** How a পাঠ renders in the always-on bw-photocopy edition (D-016 upstream). */
export const BW_TREATMENTS = ["native_safe", "redesigned", "print_only_omit"] as const;
export type BwTreatment = (typeof BW_TREATMENTS)[number];

/** Text block types the composer lays out by `type` + `layout_hint`. */
export const BLOCK_TYPES = [
  "heading", "instruction", "oral_text", "decodable_text", "poem", "rhyme", "story",
  "dialogue", "word_list", "exercise", "fill_blank", "matching", "writing_line",
  "tracing_ref", "table",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Provenance. The letter audit keys off exactly this (+ `edited`, `oral`). */
export const BLOCK_SOURCES = ["nctb", "school"] as const;
export type BlockSource = (typeof BLOCK_SOURCES)[number];

/** Image doctrine rows (README §5). */
export const IMAGE_CLASSES = [
  "object", "narrative_figure", "animal_story", "diagram", "photo_replace", "tracing_asset",
] as const;
export type ImageClass = (typeof IMAGE_CLASSES)[number];

export const IMAGE_SLOT_ACTIONS = [
  "substitute_objects", "generate_stripe", "redraw_schematic", "keep_nctb", "omit", "vector_asset",
] as const;
export type ImageSlotAction = (typeof IMAGE_SLOT_ACTIONS)[number];

/** Support-book editions — BOTH always rendered; a single-edition pass is not a pass. */
export const RENDER_PROFILES = ["print-colour", "bw-photocopy"] as const;
export type RenderProfile = (typeof RENDER_PROFILES)[number];

// -- Workflow (ours) ------------------------------------------------------------

/** Per-পাঠ status flow (README §7). */
export const LESSON_STATES = [
  "COMPLIANCE_MAP", "RULED", "CONTENT_DRAFT", "CONTENT_APPROVED",
  "IMAGES_APPROVED", "COMPLIANCE_DONE", "ASSEMBLED", "QA_PASSED",
] as const;
export type LessonState = (typeof LESSON_STATES)[number];
export const LESSON_STATE_LABELS_BN: Record<LessonState, string> = {
  COMPLIANCE_MAP: "কমপ্লায়েন্স ম্যাপ",
  RULED: "সিদ্ধান্ত হয়েছে",
  CONTENT_DRAFT: "খসড়া লেখা",
  CONTENT_APPROVED: "লেখা অনুমোদিত",
  IMAGES_APPROVED: "ছবি অনুমোদিত",
  COMPLIANCE_DONE: "কমপ্লায়েন্স সম্পন্ন",
  ASSEMBLED: "বই তৈরি",
  QA_PASSED: "যাচাই সম্পন্ন",
};
export const LESSON_STATE_LABELS_EN: Record<LessonState, string> = {
  COMPLIANCE_MAP: "Compliance map",
  RULED: "Ruled",
  CONTENT_DRAFT: "Content draft",
  CONTENT_APPROVED: "Content approved",
  IMAGES_APPROVED: "Images approved",
  COMPLIANCE_DONE: "Compliance done",
  ASSEMBLED: "Assembled",
  QA_PASSED: "QA passed",
};

export const IMAGE_SLOT_STATES = [
  "DRAFT", "PROMPT_READY", "GENERATED", "APPROVED", "COMPLIANT", "REJECTED",
] as const;
export type ImageSlotState = (typeof IMAGE_SLOT_STATES)[number];
export const IMAGE_SLOT_STATE_LABELS_BN: Record<ImageSlotState, string> = {
  DRAFT: "খসড়া",
  PROMPT_READY: "প্রম্পট প্রস্তুত",
  GENERATED: "ছবি তৈরি",
  APPROVED: "অনুমোদিত",
  COMPLIANT: "কমপ্লায়েন্ট",
  REJECTED: "বাতিল",
};
export const IMAGE_SLOT_STATE_LABELS_EN: Record<ImageSlotState, string> = {
  DRAFT: "Draft",
  PROMPT_READY: "Prompt ready",
  GENERATED: "Generated",
  APPROVED: "Approved",
  COMPLIANT: "Compliant",
  REJECTED: "Rejected",
};

/** How a lesson patch reached the merge gate. Recorded for the rationale timeline
 *  and branched on NOWHERE else — both paths pass the same validator (D-#408). */
export const PATCH_SOURCES = ["DESKTOP_UPLOAD", "IN_APP_CHAT"] as const;
export type PatchSource = (typeof PATCH_SOURCES)[number];

/** How an image reached the app. Both permanent; neither retires the other (D-#419). */
export const IMAGE_SOURCES = ["EXTERNAL_UPLOAD", "IN_APP_API"] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];

/** The per-slot lineage chain. Each stage fingerprints its input and output so a
 *  re-approval upstream marks everything downstream stale (D-#417). */
export const ARTIFACT_STAGES = ["APPROVED", "CROPPED", "UPSCALED", "COMPLIANT"] as const;
export type ArtifactStage = (typeof ARTIFACT_STAGES)[number];

/** Any STALE artifact anywhere locks assembly (D-#417). */
export const LINEAGE_STATES = ["FRESH", "STALE", "MISSING"] as const;
export type LineageState = (typeof LINEAGE_STATES)[number];

/** Human eyeball gates. The system may NEVER satisfy one on a person's behalf, and
 *  never infers a human judgement from a green exit code (D-#418). */
export const REVIEW_GATES = [
  "IMAGE_GRID_REVIEWED", "CROP_GRID_REVIEWED", "UPSCALE_TEXTURE_REVIEWED",
  "STRIP_GRID_REVIEWED", "RENDER_SPOT_CHECKED",
] as const;
export type ReviewGate = (typeof REVIEW_GATES)[number];

/** A reviewer↔senior-reviewer thread. A senior's reply ANSWERS; a further reply
 *  re-OPENS. Resolution never mutates content — it produces a citing patch (D-#410). */
export const ESCALATION_STATES = ["OPEN", "ANSWERED", "RESOLVED", "WITHDRAWN"] as const;
export type EscalationState = (typeof ESCALATION_STATES)[number];
export const ESCALATION_STATE_LABELS_BN: Record<EscalationState, string> = {
  OPEN: "খোলা",
  ANSWERED: "উত্তর দেওয়া",
  RESOLVED: "নিষ্পত্তি",
  WITHDRAWN: "প্রত্যাহার",
};
export const ESCALATION_STATE_LABELS_EN: Record<EscalationState, string> = {
  OPEN: "Open",
  ANSWERED: "Answered",
  RESOLVED: "Resolved",
  WITHDRAWN: "Withdrawn",
};

/** What an escalation is ABOUT — it is anchored to an item, not to a book (D-#410). */
export const ESCALATION_TARGETS = ["LESSON", "BLOCK", "IMAGE_SLOT"] as const;
export type EscalationTarget = (typeof ESCALATION_TARGETS)[number];

export const BUILD_STATES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type BuildState = (typeof BUILD_STATES)[number];
export const BUILD_STATE_LABELS_BN: Record<BuildState, string> = {
  QUEUED: "সারিতে",
  RUNNING: "চলছে",
  SUCCEEDED: "সফল",
  FAILED: "ব্যর্থ",
  CANCELLED: "বাতিল",
};
export const BUILD_STATE_LABELS_EN: Record<BuildState, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const BUILD_SCOPES = ["LESSON", "RANGE", "FULL"] as const;
export type BuildScope = (typeof BUILD_SCOPES)[number];

/** Programme governance stored as DATA, never as repo files (D-#403). Every
 *  generation stamps the active set's hash so a decision stays reproducible. */
export const POLICY_DOC_KEYS = [
  "README", "DECISIONS", "SCHEMA", "REF1_CURATION", "REF2_REGISTER",
  "ASSEMBLY", "PROJECT_INSTRUCTIONS", "LETTER_INVENTORY",
] as const;
export type PolicyDocKey = (typeof POLICY_DOC_KEYS)[number];
/** LETTER_INVENTORY is per-book; every other key is programme-wide. */
export const PER_BOOK_POLICY_DOC_KEYS: readonly PolicyDocKey[] = ["LETTER_INVENTORY"];

/** The validator's check set (README §6 + the layout check the shipped CLI adds).
 *  C4 is the ONLY subject-specific one — it runs for C1–C2 বাংলা and is skipped
 *  otherwise (D-#427: port it from validator_letter_audit.py, not from the schema doc). */
export const VALIDATOR_CHECKS = [
  "C1_JSON_VERSION", "C2_INVENTORY_FLAGS", "C3_CODES", "C4_LETTER_AUDIT", "C5_GENRE",
  "C6_SLOT_BOOLEANS", "C7_SOURCE_NOTE", "C8_SCRIPT_GUARD", "C9_NO_STRIPE_LANGUAGE",
  "C10_MAP_DERIVABLE", "C11_BW_COMPLETE", "C12_LAYOUT",
] as const;
export type ValidatorCheck = (typeof VALIDATOR_CHECKS)[number];

/** RED refuses the merge; GREY merges with a warning; INFO is reported only. */
export const VALIDATOR_SEVERITIES = ["RED", "GREY", "INFO"] as const;
export type ValidatorSeverity = (typeof VALIDATOR_SEVERITIES)[number];

/** The teacher-reviewer's per-পাঠ checklist, README §7 VERBATIM (SB-3). Every item
 *  must be ticked before `reviewer_signoff.checklist_passed` can go true — the list
 *  is the sign-off, not a suggestion attached to one. */
export const BOOK_REVIEW_CHECKLIST = [
  "GENRE",             // genre matches the corrected TG tag
  "LETTER_AUDIT",      // the executed letter audit passed
  "OUTCOME_COVERAGE",  // শিখনফল coverage
  "SOURCE_NOTE",       // Islamic-narrative source note checked
  "REGISTER_VS_NCTB",  // replacement read side-by-side with the NCTB original
  "IMAGES_MATCH",      // images match the manifest
  "PHOTOCOPY",         // the bw-photocopy edition survives the school's copier
] as const;
export type BookReviewChecklistItem = (typeof BOOK_REVIEW_CHECKLIST)[number];
export const BOOK_REVIEW_CHECKLIST_LABELS_BN: Record<BookReviewChecklistItem, string> = {
  GENRE: "ধরন মিলেছে",
  LETTER_AUDIT: "বর্ণ-অডিট পাস",
  OUTCOME_COVERAGE: "শিখনফল কভারেজ",
  SOURCE_NOTE: "সূত্র-নোট যাচাই",
  REGISTER_VS_NCTB: "এনসিটিবির সাথে মিলিয়ে পড়া",
  IMAGES_MATCH: "ছবি ম্যানিফেস্ট অনুযায়ী",
  PHOTOCOPY: "ফটোকপি যাচাই",
};
export const BOOK_REVIEW_CHECKLIST_LABELS_EN: Record<BookReviewChecklistItem, string> = {
  GENRE: "Genre matches",
  LETTER_AUDIT: "Letter audit passed",
  OUTCOME_COVERAGE: "Outcome coverage",
  SOURCE_NOTE: "Source note checked",
  REGISTER_VS_NCTB: "Register vs NCTB",
  IMAGES_MATCH: "Images match manifest",
  PHOTOCOPY: "Photocopy check",
};

/** A review round's lifecycle. Mirrors `ReviewAssignment`'s shape (D-#40) — one OPEN
 *  round per পাঠ at a time, so two reviewers can never both be "the" reviewer. */
export const BOOK_REVIEW_ROUND_STATUSES = ["ASSIGNED", "SUBMITTED", "SUPERSEDED", "CANCELLED"] as const;
export type BookReviewRoundStatus = (typeof BOOK_REVIEW_ROUND_STATUSES)[number];


// --- A.19 ANSWER-SCRIPT ARCHIVE ENUMS (app-native; archive module — ---------
// prd-script-archive.md §4, D-#443–#447). NO wire-contract twin (the
// CLASS_TEST_STATUSES precedent): physical script storage is a feature, not
// import content — only /shared + the vocab verifier run. NO new permission
// (D-#447): teachers file under `tracker:write`, the Office operates under
// `roster:manage`, reads ride `tracker:read`.

/** What a ScriptBundle archives (D-#443). EXAM is RESERVED vocabulary for the
 *  term-exam module (prd-exams.md EX-7 stage 13 files into this archive when it
 *  builds) — v1 wires CLASS_TEST only. */
export const ARCHIVE_SOURCE_KINDS = ["CLASS_TEST", "EXAM"] as const;
export type ArchiveSourceKind = (typeof ARCHIVE_SOURCE_KINDS)[number];

export const ARCHIVE_SOURCE_KIND_LABELS_BN: Record<ArchiveSourceKind, string> = {
  CLASS_TEST: "ক্লাস টেস্ট", EXAM: "পরীক্ষা (সাময়িক/বার্ষিক)",
};
export const ARCHIVE_SOURCE_KIND_LABELS_EN: Record<ArchiveSourceKind, string> = {
  CLASS_TEST: "Class test", EXAM: "Term exam",
};

/** Bundle lifecycle (D-#444): FILED → (CHECKED_OUT ↔ FILED) → DISPOSED.
 *  VOID = filed-in-error, terminal, record kept (the BookCopy WITHDRAWN
 *  posture). OVERDUE is COMPUTED from the open checkout's expected return,
 *  never stored (D-#85). */
export const SCRIPT_BUNDLE_STATUSES = ["FILED", "CHECKED_OUT", "DISPOSED", "VOID"] as const;
export type ScriptBundleStatus = (typeof SCRIPT_BUNDLE_STATUSES)[number];

export const SCRIPT_BUNDLE_STATUS_LABELS_BN: Record<ScriptBundleStatus, string> = {
  FILED: "সংরক্ষিত", CHECKED_OUT: "বের করা হয়েছে",
  DISPOSED: "নিষ্পত্তি হয়েছে", VOID: "ভুলবশত — বাতিল",
};
export const SCRIPT_BUNDLE_STATUS_LABELS_EN: Record<ScriptBundleStatus, string> = {
  FILED: "Filed", CHECKED_OUT: "Checked out",
  DISPOSED: "Disposed", VOID: "Void",
};

/** Box lifecycle (D-#445). RETIRED = closed to NEW filings; contents stay
 *  findable forever; never deleted. */
export const STORAGE_BOX_STATUSES = ["ACTIVE", "RETIRED"] as const;
export type StorageBoxStatus = (typeof STORAGE_BOX_STATUSES)[number];

export const STORAGE_BOX_STATUS_LABELS_BN: Record<StorageBoxStatus, string> = {
  ACTIVE: "চালু", RETIRED: "বন্ধ (সংরক্ষিত)",
};
export const STORAGE_BOX_STATUS_LABELS_EN: Record<StorageBoxStatus, string> = {
  ACTIVE: "Active", RETIRED: "Retired",
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
  "question:manage",       // correct a question's content/answer, or retire it (Principal + Office, D-#548)
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
  "access:manage",         // PRINCIPAL ONLY — the per-user permission editor: tune additional templates / per-user grants / revokes (Access Control AC-1, D-#193/#212; RESERVED-locked, verifier-proven exact-holder set, the template:manage posture)
  // classroom observation (app-native; Classroom-Observation module, D-#147/#191)
  "observation:upload",    // upload a recorded session + ASSIGN a senior-teacher observer (Principal/Office; CO-1)
  "observation:review",    // TEACHER base perm — the assigned senior-teacher observer scores+comments; the RESOLVER gates it to the assigned observerId (CO-1, D-#147)
  "observation:read",      // read an observation, ROW-SCOPED in the resolver (observer own; observed teacher own at/after REVIEWED; Principal/Office all). Staff-internal — GUARDIAN none (§7)
  "observation:manage",    // designations, cadence config, dashboards, override reads (Principal/Office; CO-1)
  // finance / accounting (app-native; Finance module, D-#221 — Principal+Office)
  "finance:manage",        // ledgers, opening balances, postings, reconciliation, budgets, dashboard (Principal/Office; FIN-1). Distinct from roster:manage so AC-1 can grant the books to the accountant alone (D-#221)
  // monthly progress report (app-native; Monthly-Report module, D-#397)
  "report:release",        // release / re-release a monthly progress report to the family, individually or in a
                           // batch, and edit the MR-2 thresholds (Principal/Office). The Principal-ONLY powers —
                           // overriding the coverage block, revoking a released report, reopening a hard-locked
                           // month — ride the ROLE inside the resolver, not a second permission (D-#397), so
                           // AC-1 can hand the Office release without handing it the overrides.
  // book production — সহায়িকা + storybooks (SB-1, D-#405/#421/#424). ONE set for BOTH
  // book types: they differ in content rules, not process shape. All seven sit on the
  // PRINCIPAL template (D-#424); everyone else is granted per user via AC-1.
  "book:read",             // read books, lessons, prompts, images, threads (every production role holds it)
  "book:author",           // upload a patch, run the authoring chat, merge on a green validator
  "book:illustrate",       // read prompts, upload/generate images, mark a slot GENERATED
  "book:review",           // reviewer verdicts + raise an escalation
  "book:review_senior",    // answer escalations, content sign-off, anchor HUMAN_VERIFIED
  "book:assemble",         // queue a build, release an edition
  "book:manage",           // create books, upload policy versions, assign people, read everything
  // exams — syllabus first (SY-1, D-#530/#530); prd-exams EX-1.. reuses BOTH
  "exam:manage",           // create an exam, write + submit a syllabus, send one back (Principal/Office). PUBLISH rides
                           // the ROLE inside the resolver (PRINCIPAL only, D-#397's posture), not a second permission —
                           // so AC-1 can hand syllabus authoring to a senior teacher without handing them the release.
                           // The SUBJECT-TEACHER sign-off is likewise NOT a permission: it is routine-derived in the
                           // resolver (D-#533), the CO-1 assigned-observer posture.
  "exam:read",             // read a syllabus, ROW-SCOPED in the resolver (published rows for staff; Office/Principal see drafts). Staff-internal — GUARDIAN reads via guardian:read_child (§4)
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
  "question:manage": "build",
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
  "access:manage": "build",   // Access Control AC-1 (Principal-only per-user permission editor, D-#193/#212)
  "observation:upload": "build",  // Classroom-Observation CO-1 (upload + assign, D-#195)
  "observation:review": "build",  // Classroom-Observation CO-1 (assigned-observer scoring, D-#195)
  "observation:read": "build",    // Classroom-Observation CO-1 (row-scoped read, D-#195)
  "observation:manage": "build",  // Classroom-Observation CO-1 (config/dashboards, D-#195)
  "finance:manage": "build",      // Finance FIN-1 (ledgers + opening balances, D-#221)
  "report:release": "build",      // Monthly Report MR-3 (release/re-release + threshold config, D-#397)
  "book:read": "build",           // Book production SB-1 (D-#405/#421/#424)
  "book:author": "build",         // SB-1
  "book:illustrate": "build",     // SB-2
  "book:review": "build",         // SB-3
  "book:review_senior": "build",  // SB-3
  "book:assemble": "build",       // SB-4
  "book:manage": "build",         // SB-1
  "exam:manage": "build",         // SY-1 (exam row + syllabus authoring/publish)
  "exam:read": "build",           // SY-1 (row-scoped syllabus read)
  "guardian:read_child": "build", // ACTIVATED by Guardian Portal GP-1 (D-#68; was pipeline since Slice 0)
};

/** ROLE → granted permissions. DEFAULT-DENY: anything not listed is denied. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Super-admin: full operational visibility + user/role management. Reads (never
  // edits) the audit log. No guardian:read_child — Principal sees children via
  // unscoped staff views (tracker:read), not the guardian-scoped resolver path.
  PRINCIPAL: [
    "content:read", "content:import", "content:assign_review", "content:review", "content:promote_gold",
    "question:read", "question:select", "question:manage",
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
    "access:manage",         // PRINCIPAL ONLY (Access Control AC-1, D-#193/#212) — RESERVED-locked; Office/Teacher/Guardian never get it
    "observation:upload", "observation:read", "observation:manage", // classroom observation (CO-1, D-#195) — NOT observation:review (the observer is an assigned TEACHER, D-#147)
    "finance:manage",        // finance/accounting (FIN-1, D-#221) — Principal+Office
    "report:release",        // monthly progress report: release/re-release + the MR-2 thresholds. The Principal
                             // ALSO holds the three override powers by role (D-#397) — see the permission's note.
    // Book production — ALL SEVEN (D-#424, owner ruling). The Principal can author,
    // illustrate, review, sign off and assemble. Permissions were never the constraint:
    // the row-level separations (reviewer ≠ author of THAT lesson, verifier ≠ author of
    // THAT book) survive, and for the Principal they resolve to a `selfReviewed` /
    // `selfVerified` STAMP rather than a refusal — recorded, never silently allowed.
    "book:read", "book:author", "book:illustrate", "book:review",
    "book:review_senior", "book:assemble", "book:manage",
    "exam:manage", "exam:read", // exam syllabus (SY-1, D-#533) — the Principal is the publish gate
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
    "observation:review",    // the assigned senior-teacher observer scores+comments — gated to observerId in the resolver (CO-1, D-#147)
    "observation:read",      // read own observations as observer + own (observed) at/after REVIEWED — row-scoped in the resolver (CO-1)
    "exam:read",             // read PUBLISHED syllabuses for the classes they teach (SY-6, D-#533). NOT exam:manage — the subject-teacher SIGN-OFF is routine-derived in the resolver, not a permission
  ],
  // Roster, guardian linkage, messaging dispatch (REQ §2), plus content import (the
  // publisher seam), plan-review assignment (D-#39), and routine authoring (D-#46).
  // No tracker/user surface under PoLP.
  OFFICE: [
    "roster:manage", "staff:manage", "leave:manage", "payroll:manage", "performance:manage", "guardian:link", "message:dispatch",
    "content:import", "content:assign_review",
    // Office corrects question content and retires a bad question (D-#548); read comes with
    // it because you cannot edit what you cannot open. NOT question:select — assembling a
    // set is a teaching decision, not a desk one.
    "question:read", "question:manage",
    "routine:read", "routine:manage",
    "attendance:manage",     // upload teacher Excel, assign markers, chase guardians (D-#64/#65; no mark)
    "library:read", "library:manage", // the default library desk (D-#81)
    "chat:read", "chat:write", "chat:manage", // staff chat + group/posting-policy admin (D-#76/#78); NO chat:oversee (Principal only, D-#77)
    "observation:upload", "observation:read", "observation:manage", // classroom observation: upload+assign, row-scoped read, config (CO-1, D-#195); NOT observation:review (the observer is an assigned TEACHER)
    "finance:manage",        // finance/accounting (FIN-1, D-#221) — the accountant's books (Principal+Office)
    "report:release",        // monthly progress report: release/re-release, individually or in a batch (D-#397).
                             // NOT the overrides — a coverage-block override, a revoke and a hard-lock reopen are
                             // Principal-only by role, so a bulk mistake has exactly one owner.
    "exam:manage", "exam:read", // exam syllabus: create the exam, write and submit a syllabus (SY-1/SY-4). PUBLISH
                             // is refused to Office BY STATE, not by permission — the row must reach
                             // PRINCIPAL_REVIEW and only the Principal moves it on (D-#533, §7.4).
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

// --- B.2 PER-USER ACCESS CONTROL (role-as-template + grant/revoke, AC-1) -------
// Role stops being the final word on permissions → it becomes the PRIMARY TEMPLATE.
// A staff login resolves to: effective = (∪ templates ∪ granted) − revoked, with the
// RESERVED-locked set subtracted for every non-Principal login (the structural backstop).
// Fully additive: with all three arrays empty, effectivePermissions(profile) equals the
// old role set byte-for-byte (the reserved subtraction is a no-op — no non-Principal
// template holds a reserved perm). See docs/prd-access-control.md (D-#193, D-#210–#212).

/** PRINCIPAL-only, ungrantable permissions. They reach ONLY a PRINCIPAL login — a
 *  write-time rejection is the first gate, this set's subtraction the structural backstop
 *  (Fork-2 ruling, D-#193). Adding/removing one here is a deliberate, verifier-checked act. */
export const RESERVED_PERMISSIONS = [
  "payroll:approve",
  "performance:signoff",
  "chat:oversee",
  "template:manage",
  "access:manage",
] as const satisfies readonly Permission[];

/** Roles a Principal may add to a staff User as an ADDITIONAL template (the deputy /
 *  acting-office config). PRINCIPAL is provisioned, not template-assigned; GUARDIAN is a
 *  walled-off login plane and is never assignable to a staff User (D-#193, J-AC4). */
export const ASSIGNABLE_TEMPLATES = ["TEACHER", "OFFICE"] as const satisfies readonly Role[];

/** The per-caller access profile: the primary role template + the per-user overrides.
 *  The server's AuthPayload satisfies this shape; absent arrays ⇒ treated as empty (the
 *  zero-migration default = identical-to-today behaviour). */
export interface AccessProfile {
  role: Role;
  additionalTemplates?: readonly Role[];
  grantedPermissions?: readonly Permission[];
  revokedPermissions?: readonly Permission[];
}

/** The single resolution seam (the only behavioural change AC-1 introduces). Pure:
 *    base = ⋃ permissionsForRole(t) for t in [role, ...additionalTemplates]
 *    eff  = (base ∪ granted) − revoked        // a revoke always wins
 *    if role !== PRINCIPAL: eff = eff − RESERVED_PERMISSIONS   // structural backstop
 *  `roleHasPermission` / `permissionsForRole` are RETAINED — templates still consume them;
 *  they are simply no longer the per-caller authority. */
export function effectivePermissions(profile: AccessProfile): Set<Permission> {
  const eff = new Set<Permission>();
  for (const t of [profile.role, ...(profile.additionalTemplates ?? [])]) {
    for (const p of permissionsForRole(t)) eff.add(p);
  }
  for (const p of profile.grantedPermissions ?? []) eff.add(p);
  for (const p of profile.revokedPermissions ?? []) eff.delete(p); // revoke wins over template + grant
  if (profile.role !== "PRINCIPAL") {
    for (const p of RESERVED_PERMISSIONS) eff.delete(p); // reserved perms reach ONLY a PRINCIPAL login
  }
  return eff;
}

/** Per-caller grant check (the `roleHasPermission` replacement at every gate). True =
 *  the caller's effective set holds the permission AND it is active in this build. */
export function callerHasPermission(profile: AccessProfile, perm: Permission): boolean {
  return effectivePermissions(profile).has(perm) && isPermissionActive(perm);
}

/** The templates a login holds: its primary role first, then any additional ones, deduped.
 *  Length > 1 is exactly the "wears two hats" case the view switcher exists for. */
export function templatesOf(profile: AccessProfile): Role[] {
  const seen: Role[] = [];
  for (const t of [profile.role, ...(profile.additionalTemplates ?? [])]) {
    if (!seen.includes(t)) seen.push(t);
  }
  return seen;
}

/** "Does this login act as role R?" — TEMPLATE-aware, so an OFFICE template a Principal
 *  added to a teacher counts, not just the primary role. The replacement for a bare
 *  `ctx.auth.role === "OFFICE"` in a gate that means "is this person the office desk".
 *  A bare comparison contradicts the AC-1 model: `effectivePermissions` already hands the
 *  added template's whole permission set to this caller, so a role-equality gate is the
 *  one place that silently ignores what the Principal granted (D-#474). */
export function actsAsRole(profile: AccessProfile, role: Role): boolean {
  return templatesOf(profile).includes(role);
}

/** VIEW MODE — a PRESENTATION filter for the dual-template login (a teacher who is also
 *  the office desk, D-#474). It narrows what the app OFFERS to one hat at a time; it is
 *  NOT an authorization switch. Two invariants make that safe:
 *    1. The result is always a SUBSET of `effective` — a mode can never add authority,
 *       so the server's `callerHasPermission` (which never sees a mode) stays the gate.
 *    2. It fails OPEN to today's behaviour: an absent mode, a single-template login, or a
 *       mode the caller does not actually hold all return `effective` untouched.
 *  Per-user GRANTS survive every mode on purpose: a granted permission belongs to no
 *  template (that is what a grant is), so intersecting with one template would hide the
 *  book-production screens from exactly the people who reach them by grant (D-#405). */
export function viewModePermissions(
  effective: Iterable<Permission>,
  templates: readonly Role[],
  mode: Role | null | undefined,
): Set<Permission> {
  const all = new Set(effective);
  if (!mode || templates.length < 2 || !templates.includes(mode)) return all;
  const inMode = new Set<Permission>(permissionsForRole(mode));
  const fromAnyTemplate = new Set<Permission>();
  for (const t of templates) for (const p of permissionsForRole(t)) fromAnyTemplate.add(p);
  const out = new Set<Permission>();
  for (const p of all) {
    // Keep it if THIS hat carries it, or if no hat does (⇒ it is a per-user grant).
    if (inMode.has(p) || !fromAnyTemplate.has(p)) out.add(p);
  }
  return out;
}

// --- B.3 PERMISSION LABELS (Bangla-first name + short description; the AC-2 editor) ---
// Total over the live PERMISSIONS array (verifier-checked). name = the chip; desc = the
// one-line "what this lets the holder do". RESERVED perms are tagged (সংরক্ষিত / reserved).

export interface PermissionLabel {
  name: string;
  desc: string;
}

export const PERMISSION_LABELS_BN: Record<Permission, PermissionLabel> = {
  "content:read": { name: "কনটেন্ট দেখা", desc: "প্রকাশিত পাঠ ও কনটেন্ট পড়া" },
  "content:import": { name: "কনটেন্ট ইম্পোর্ট", desc: "নতুন কনটেন্ট আমদানি ও প্রকাশ" },
  "content:assign_review": { name: "রিভিউ বরাদ্দ", desc: "প্ল্যান-রিভিউ রাউন্ড বরাদ্দ ও ইনবক্স" },
  "content:review": { name: "রিভিউ-অনুমোদন", desc: "রিভিউয়ারের অনুমোদন: ড্রাফট→রিভিউড" },
  "content:promote_gold": { name: "গোল্ড চিহ্নিত", desc: "রিভিউড→গোল্ড চূড়ান্ত সাইন-অফ" },
  "question:read": { name: "প্রশ্ন দেখা", desc: "প্রশ্নব্যাংক পড়া" },
  "question:select": { name: "প্রশ্ন নির্বাচন", desc: "সেটের জন্য প্রশ্ন বাছাই" },
  "question:manage": { name: "প্রশ্ন সম্পাদনা", desc: "প্রশ্নের বিষয়বস্তু ও উত্তর সংশোধন, প্রশ্ন বাতিল" },
  "set:read": { name: "সেট দেখা", desc: "অ্যাসেসমেন্ট সেট পড়া" },
  "set:assemble": { name: "সেট তৈরি", desc: "প্রশ্ন সেট সংকলন" },
  "set:export": { name: "সেট এক্সপোর্ট", desc: "সেট পিডিএফ এক্সপোর্ট" },
  "tracker:read": { name: "ট্র্যাকার দেখা", desc: "ট্র্যাকার রিপোর্ট পড়া" },
  "tracker:write": { name: "ট্র্যাকার এন্ট্রি", desc: "ট্র্যাকারে এন্ট্রি ও আপডেট" },
  "tracker:export": { name: "ট্র্যাকার এক্সপোর্ট", desc: "ট্র্যাকার রিপোর্ট রপ্তানি" },
  "routine:read": { name: "রুটিন দেখা", desc: "ক্লাস রুটিন ও টাইমটেবিল পড়া" },
  "routine:manage": { name: "রুটিন পরিচালনা", desc: "ক্যালেন্ডার, রুম, গ্রিড ও স্লট সম্পাদনা" },
  "attendance:mark": { name: "হাজিরা মার্ক", desc: "সেকশনের অনুপস্থিতি মার্ক করা" },
  "attendance:manage": { name: "হাজিরা পরিচালনা", desc: "এক্সেল আপলোড, মার্কার বরাদ্দ ও রিপোর্ট" },
  "library:read": { name: "লাইব্রেরি ব্রাউজ", desc: "ক্যাটালগ ও নিজের লোন দেখা" },
  "library:manage": { name: "লাইব্রেরি ডেস্ক ও ক্যাটালগ", desc: "ডেস্ক অপস, ক্যাটালগ ও নীতি" },
  "chat:read": { name: "চ্যাট পড়া", desc: "নিজের কথোপকথন ও বার্তা পড়া" },
  "chat:write": { name: "চ্যাট পাঠানো", desc: "বার্তা পাঠানো ও সিন মার্ক" },
  "chat:manage": { name: "গ্রুপ পরিচালনা", desc: "গ্রুপ তৈরি, সদস্য ও পোস্টিং নীতি" },
  "chat:oversee": { name: "চ্যাট তদারকি (সংরক্ষিত)", desc: "যেকোনো কথোপকথন রিড-ওভাররাইড (অডিটেড)" },
  "roster:manage": { name: "রোস্টার ও ক্লাস-টিচার বরাদ্দ", desc: "রোস্টার, সেকশন ও ক্লাস-টিচার পরিচালনা" },
  "staff:manage": { name: "স্টাফ রেকর্ড", desc: "এইচআর স্টাফ-রেকর্ড পরিচালনা" },
  "leave:manage": { name: "স্টাফ ছুটি পরিচালনা", desc: "এনটাইটেলমেন্ট, অনুমোদন ও ব্যালেন্স" },
  "payroll:manage": { name: "বেতন প্রস্তুত", desc: "বেতন সেট, রান ও পে-স্লিপ" },
  "payroll:approve": { name: "বেতন অনুমোদন ও লক (সংরক্ষিত)", desc: "বেতন রান অনুমোদন ও লক, অগ্রিম" },
  "performance:manage": { name: "পারফরম্যান্স পরিচালনা", desc: "পর্যবেক্ষণ, অ্যাপ্রাইজাল, কন্ডাক্ট ও সিপিডি" },
  "performance:signoff": { name: "মূল্যায়ন চূড়ান্ত অনুমোদন (সংরক্ষিত)", desc: "অ্যাপ্রাইজাল সাইন-অফ ও কন্ডাক্ট চূড়ান্ত" },
  "guardian:link": { name: "অভিভাবক লগইন সংযুক্ত", desc: "অভিভাবক অ্যাকাউন্ট লিংক করা" },
  "message:dispatch": { name: "বার্তা পাঠানো", desc: "wa.me ও নোটিশ ম্যানুয়াল প্রেরণ" },
  "user:manage": { name: "ইউজার লগইন পরিচালনা", desc: "স্টাফ অ্যাকাউন্ট তৈরি ও পরিচালনা" },
  "audit:read": { name: "অডিট লগ পড়া", desc: "নিরাপত্তা ও অডিট লগ পড়া" },
  "template:manage": { name: "বার্তা টেমপ্লেট সম্পাদনা (সংরক্ষিত)", desc: "জেনারেটেড-বার্তা টেমপ্লেট সম্পাদনা ও রিসেট" },
  "access:manage": { name: "অনুমতি পরিচালনা (সংরক্ষিত)", desc: "প্রতি-ইউজার অনুমতি সম্পাদনা" },
  "observation:upload": { name: "অবজারভেশন আপলোড ও বরাদ্দ", desc: "রেকর্ডেড সেশন আপলোড ও পর্যবেক্ষক বরাদ্দ" },
  "observation:review": { name: "অবজারভেশন রিভিউ", desc: "বরাদ্দকৃত পর্যবেক্ষকের স্কোরিং ও মন্তব্য" },
  "observation:read": { name: "অবজারভেশন পড়া", desc: "রো-স্কোপড অবজারভেশন পড়া" },
  "observation:manage": { name: "অবজারভেশন পরিচালনা", desc: "ডেজিগনেশন, কনফিগ ও ড্যাশবোর্ড" },
  "finance:manage": { name: "অর্থ ব্যবস্থাপনা", desc: "লেজার, ব্যালেন্স, পোস্টিং ও হিসাব" },
  "report:release": { name: "মাসিক রিপোর্ট প্রকাশ", desc: "মাসিক অগ্রগতি রিপোর্ট প্রকাশ ও পুনঃপ্রকাশ" },
  "book:read": { name: "বই দেখা", desc: "বই, অধ্যায়, প্রম্পট ও ছবি পড়া" },
  "book:author": { name: "বই লেখা", desc: "প্যাচ আপলোড ও অধ্যায় মার্জ করা" },
  "book:illustrate": { name: "বইয়ের ছবি", desc: "প্রম্পট দেখা ও ছবি আপলোড করা" },
  "book:review": { name: "বই রিভিউ", desc: "অধ্যায় যাচাই ও এসকালেশন তোলা" },
  "book:review_senior": { name: "বই সিনিয়র রিভিউ", desc: "এসকালেশনের উত্তর ও চূড়ান্ত সাইন-অফ" },
  "book:assemble": { name: "বই তৈরি", desc: "বিল্ড চালানো ও সংস্করণ প্রকাশ" },
  "book:manage": { name: "বই পরিচালনা", desc: "বই তৈরি, নীতিমালা ও দায়িত্ব বণ্টন" },
  "exam:manage": { name: "পরীক্ষার সিলেবাস ব্যবস্থাপনা", desc: "পরীক্ষা তৈরি, সিলেবাস ও মানবন্টন লেখা এবং অনুমোদনে পাঠানো — প্রকাশ কেবল প্রধান শিক্ষক" },
  "exam:read": { name: "পরীক্ষার সিলেবাস দেখা", desc: "প্রকাশিত সিলেবাস ও মানবন্টন দেখা" },
  "guardian:read_child": { name: "সন্তানের তথ্য দেখা (অভিভাবক প্লেন)", desc: "অভিভাবক প্লেন — স্টাফকে দেওয়া যায় না" },
};

export const PERMISSION_LABELS_EN: Record<Permission, PermissionLabel> = {
  "content:read": { name: "Read content", desc: "View published lessons and content" },
  "content:import": { name: "Import content", desc: "Import and publish new content" },
  "content:assign_review": { name: "Assign review", desc: "Assign plan-review rounds + inbox" },
  "content:review": { name: "Review content", desc: "Reviewer APPROVE: draft→reviewed" },
  "content:promote_gold": { name: "Promote to gold", desc: "Reviewed→gold final sign-off" },
  "question:read": { name: "Read questions", desc: "Browse the question bank" },
  "question:select": { name: "Select questions", desc: "Pick questions for a set" },
  "question:manage": { name: "Manage questions", desc: "Correct question content and answers, retire a question" },
  "set:read": { name: "Read sets", desc: "View assessment sets" },
  "set:assemble": { name: "Assemble sets", desc: "Compose question sets" },
  "set:export": { name: "Export sets", desc: "Server-side set PDF" },
  "tracker:read": { name: "Read trackers", desc: "View tracker reports" },
  "tracker:write": { name: "Write trackers", desc: "Enter and update tracker rows" },
  "tracker:export": { name: "Export trackers", desc: "Export tracker reports" },
  "routine:read": { name: "Read routine", desc: "View the class routine/timetable" },
  "routine:manage": { name: "Manage routine", desc: "Edit calendar, rooms, grids, slots" },
  "attendance:mark": { name: "Mark attendance", desc: "Mark a section's absentees" },
  "attendance:manage": { name: "Manage attendance", desc: "Upload Excel, assign markers, reports" },
  "library:read": { name: "Browse library", desc: "Catalog and own loans" },
  "library:manage": { name: "Library desk & catalog", desc: "Desk ops, catalog, policy" },
  "chat:read": { name: "Read chat", desc: "Read own conversations and messages" },
  "chat:write": { name: "Send chat", desc: "Send messages and mark seen" },
  "chat:manage": { name: "Manage chat", desc: "Group create, members, posting policy" },
  "chat:oversee": { name: "Oversee chat (reserved)", desc: "Read-override any conversation (audited)" },
  "roster:manage": { name: "Roster & class-teacher", desc: "Roster, sections, class-teacher assignment" },
  "staff:manage": { name: "Manage staff", desc: "HR staff-record management" },
  "leave:manage": { name: "Manage staff leave", desc: "Entitlements, approvals, balances" },
  "payroll:manage": { name: "Prepare payroll", desc: "Set pay, runs, payslips" },
  "payroll:approve": { name: "Approve payroll (reserved)", desc: "Approve + lock a run, advances" },
  "performance:manage": { name: "Manage performance", desc: "Observations, appraisals, conduct, CPD" },
  "performance:signoff": { name: "Sign off performance (reserved)", desc: "Appraisal sign-off, conduct finalize" },
  "guardian:link": { name: "Link guardian", desc: "Link guardian logins" },
  "message:dispatch": { name: "Dispatch messages", desc: "wa.me and notice manual send" },
  "user:manage": { name: "Manage users", desc: "Create and manage staff accounts" },
  "audit:read": { name: "Read audit log", desc: "Read the security/audit log" },
  "template:manage": { name: "Manage templates (reserved)", desc: "Edit and reset message templates" },
  "access:manage": { name: "Manage access (reserved)", desc: "The per-user permission editor" },
  "observation:upload": { name: "Upload observation", desc: "Upload a session + assign an observer" },
  "observation:review": { name: "Review observation", desc: "Assigned observer scoring and comments" },
  "observation:read": { name: "Read observation", desc: "Row-scoped observation read" },
  "observation:manage": { name: "Manage observation", desc: "Designations, config, dashboards" },
  "finance:manage": { name: "Manage finance", desc: "Ledgers, balances, postings, accounts" },
  "report:release": { name: "Release monthly reports", desc: "Release and re-release monthly progress reports" },
  "book:read": { name: "Read books", desc: "Books, lessons, prompts, images, threads" },
  "book:author": { name: "Author books", desc: "Upload a patch and merge a lesson" },
  "book:illustrate": { name: "Illustrate books", desc: "Read prompts, upload images" },
  "book:review": { name: "Review books", desc: "Reviewer verdicts and escalations" },
  "book:review_senior": { name: "Senior book review", desc: "Answer escalations, content sign-off" },
  "book:assemble": { name: "Assemble books", desc: "Queue a build, release an edition" },
  "book:manage": { name: "Manage book production", desc: "Create books, policy versions, assignments" },
  "exam:manage": { name: "Manage exam syllabus", desc: "Create an exam, write the syllabus and mark distribution, send for approval — publish is Principal-only" },
  "exam:read": { name: "Read exam syllabus", desc: "Read published syllabuses and mark distributions" },
  "guardian:read_child": { name: "Read child (guardian plane)", desc: "Guardian plane — not grantable to staff" },
};

// --- B.4 DELEGATED SCOPE ACTIONS (the EXTENT axis, ACS-1 — D-#484..#489) ------
// A Permission answers WHAT a login may do; a `ScopeGrant` answers WHERE. AC-1
// (§B.2) made the *what* per-person and deliberately left the *where* alone. These
// values are the grain of the fourth grant kind, `delegation`: "you may do THIS ONE
// THING across a wider slice of the school than you teach" (D-#484).
//
// NOT permissions, and never interchangeable with them — a delegation widens reach,
// it never confers a capability. The holder must ALSO hold the matching Permission
// (`tracker:write`) from a template or an AC-1 grant; the two axes compose and both
// must pass. The verifier asserts no value here collides with a Permission string.
//
// App-native — identity/operational plane behind the ADR-005 firewall. NO
// wire-contract twin, NO envelope-schema mirror, NO two-place sync; only /shared +
// the vocab verifier run.

/** The duties a `delegation` grant can carry. A grant lists a non-empty subset. */
export const DELEGATED_ACTIONS = [
  "declare_homework",
  "submit_homework",
  "check_homework",
  "declare_assignment",
  "submit_assignment",
  "check_assignment",
  "enter_classtest_result",
  // ACS-3: the DUTY gate, not a tracker-row write. This is the one that lets the
  // ad-hoc school-wide booleans (`User.homeworkSupervisor`, `Section.homeworkConfirmerId`)
  // be expressed as ordinary delegations instead of schema fields (D-#489). Those two
  // keep working untouched — the gate reads old flag OR new grant.
  "confirm_homework_day",
] as const;
export type DelegatedAction = (typeof DELEGATED_ACTIONS)[number];

/** Which actions have their resolver gate TAGGED in this build. An untagged action
 *  would be a silent no-op — the Principal ticks it, believes he granted something,
 *  and nothing changes — so the editor offers `build` actions ONLY, and flipping one
 *  to `build` and tagging its call site happen in the SAME PR (D-#486). Mirrors the
 *  `PERMISSION_BUILD_STATUS` idiom above. */
export const DELEGATED_ACTION_BUILD_STATUS: Record<DelegatedAction, "build" | "pipeline"> = {
  declare_homework: "build",    // ACS-1: declareHomeworkItem + declareNoHomework
  submit_homework: "build",     // ACS-1: homeworkSubmitPass + transition →SUBMITTED
  declare_assignment: "build",  // ACS-1: deliverAssignment + declareNoAssignment
  submit_assignment: "build",   // ACS-1: assignmentSubmitPass + transition →SUBMITTED
  check_homework: "build",      // ACS-3: checkHomeworkRecord + recordHomeworkOutcome
  check_assignment: "build",    // ACS-3: checkAssignmentRecord + recordAssignmentOutcome
  enter_classtest_result: "build", // ACS-3: enterClassTestResult (+ the publish/unpublish write gate)
  confirm_homework_day: "build",   // ACS-3: assertCanConfirmHomework (the duty gate, D-#489)
};

/** True if the delegated action's gate is tagged in this build (editor filter). */
export function isDelegatedActionActive(action: DelegatedAction): boolean {
  return DELEGATED_ACTION_BUILD_STATUS[action] === "build";
}

export const DELEGATED_ACTION_LABELS_BN: Record<DelegatedAction, PermissionLabel> = {
  declare_homework: { name: "বাড়ির কাজ দেওয়া", desc: "যেকোনো বিষয়ের বাড়ির কাজ ঘোষণা বা 'নেই' চিহ্নিত করা" },
  submit_homework: { name: "বাড়ির কাজ জমা নেওয়া", desc: "জমা রোস্টার পাস — জমা হয়েছে চিহ্নিত করা" },
  check_homework: { name: "বাড়ির কাজ দেখা", desc: "জমা দেওয়া কাজ যাচাই ও ফলাফল লেখা" },
  declare_assignment: { name: "অ্যাসাইনমেন্ট দেওয়া", desc: "যেকোনো বিষয়ের সাপ্তাহিক অ্যাসাইনমেন্ট প্রদান বা 'নেই' চিহ্নিত করা" },
  submit_assignment: { name: "অ্যাসাইনমেন্ট জমা নেওয়া", desc: "জমা রোস্টার পাস — জমা হয়েছে চিহ্নিত করা" },
  check_assignment: { name: "অ্যাসাইনমেন্ট দেখা", desc: "জমা দেওয়া অ্যাসাইনমেন্ট যাচাই ও ফলাফল লেখা" },
  enter_classtest_result: { name: "শ্রেণি পরীক্ষার ফল", desc: "শ্রেণি পরীক্ষার নম্বর ও ফলাফল এন্ট্রি" },
  confirm_homework_day: { name: "দিনের বাড়ির কাজ চূড়ান্ত", desc: "যেকোনো শাখার দিনের বাড়ির কাজ সমন্বয় ও চূড়ান্ত করা" },
};

export const DELEGATED_ACTION_LABELS_EN: Record<DelegatedAction, PermissionLabel> = {
  declare_homework: { name: "Declare homework", desc: "Declare homework, or mark 'none', for any subject" },
  submit_homework: { name: "Take homework submission", desc: "The submission roster pass — mark work submitted" },
  check_homework: { name: "Check homework", desc: "Check submitted work and record the result" },
  declare_assignment: { name: "Deliver assignment", desc: "Deliver the weekly assignment, or mark 'none', for any subject" },
  submit_assignment: { name: "Take assignment submission", desc: "The submission roster pass — mark work submitted" },
  check_assignment: { name: "Check assignment", desc: "Check submitted assignments and record the result" },
  enter_classtest_result: { name: "Enter class-test results", desc: "Enter class-test marks and results" },
  confirm_homework_day: { name: "Confirm the homework day", desc: "Reconcile and issue any section's daily homework" },
};

/* ===========================================================================
 * Exam syllabus — SY-1  (docs/prd-exam-syllabus.md §4, D-#530–#532)
 *
 * APP-NATIVE, no wire twin, no three-place sync — the routine/HR shape
 * (D-#46/#52). The import envelope and docs/import-contract.schema.json are
 * UNTOUCHED by everything in this block.
 *
 * `EXAM_TERMS` and `EXAM_COMPONENTS` are ALSO specified by docs/prd-exams.md §4.
 * They land HERE first, unchanged, because the syllabus ships before EX-1;
 * EX-1 reuses them rather than declaring a second copy.
 * ======================================================================== */

/** The two term exams in an academic year. Each stands alone (prd-exams §9.7). */
export const EXAM_TERMS = ["HALF_YEARLY", "ANNUAL"] as const;
export type ExamTerm = (typeof EXAM_TERMS)[number];

export const EXAM_TERM_LABELS_BN: Record<ExamTerm, string> = {
  HALF_YEARLY: "অর্ধ-বার্ষিক",
  ANNUAL: "বার্ষিক",
};

export const EXAM_TERM_LABELS_EN: Record<ExamTerm, string> = {
  HALF_YEARLY: "Half Yearly",
  ANNUAL: "Annual",
};

/** The report card's three mark columns. A SYLLABUS MARK ROW may BE one of these
 *  (D-#531): the source sheet writes "ক্লাস টেস্ট 10" and "আখলাক 10" as rows 7-8 of
 *  Nursery Arabic's মানবন্টন, which are not question items but the CT and Adab
 *  components. Tagging the row ties the syllabus handed to a parent to the report
 *  card issued to the same parent — Σ rows = 100 = Σ ExamPaper.components. */
export const EXAM_COMPONENTS = ["CT", "ADAB", "FINAL"] as const;
export type ExamComponent = (typeof EXAM_COMPONENTS)[number];

export const EXAM_COMPONENT_LABELS_BN: Record<ExamComponent, string> = {
  CT: "শ্রেণি পরীক্ষা",
  ADAB: "আদব",
  FINAL: "সেমিস্টার ফাইনাল",
};

export const EXAM_COMPONENT_LABELS_EN: Record<ExamComponent, string> = {
  CT: "Class Test",
  ADAB: "Adab",
  FINAL: "Semester Final",
};

/** The syllabus approval chain (D-#533). Office writes → the SUBJECT TEACHER signs
 *  off → the Principal publishes. `PUBLISHED` is the only state a guardian can
 *  reach, and it is carried by an additive `publishedAt` (the CO-8 / D-#271 shape),
 *  never by a second predicate. Send-back from either review stage returns to
 *  DRAFT with a mandatory reason. */
export const SYLLABUS_STATUSES = ["DRAFT", "TEACHER_REVIEW", "PRINCIPAL_REVIEW", "PUBLISHED"] as const;
export type SyllabusStatus = (typeof SYLLABUS_STATUSES)[number];

export const SYLLABUS_STATUS_LABELS_BN: Record<SyllabusStatus, string> = {
  DRAFT: "খসড়া",
  TEACHER_REVIEW: "শিক্ষকের অনুমোদনে",
  PRINCIPAL_REVIEW: "প্রধান শিক্ষকের অনুমোদনে",
  PUBLISHED: "প্রকাশিত",
};

export const SYLLABUS_STATUS_LABELS_EN: Record<SyllabusStatus, string> = {
  DRAFT: "Draft",
  TEACHER_REVIEW: "With the subject teacher",
  PRINCIPAL_REVIEW: "With the Principal",
  PUBLISHED: "Published",
};

/** The exercise family a mark-distribution row belongs to.
 *
 *  D-#530 — this is a SEPARATE, APP-NATIVE enum and NOT an extension of
 *  `QUESTION_TYPES`. That enum (line ~130) is MIRRORED against the envelope
 *  schema's `questionPayload.question_type`, so adding `creative`/`oral`/
 *  `practical` there would trigger the two-place contract sync and change the
 *  import contract for a reason that has nothing to do with importing.
 *
 *  The first six codes are DELIBERATELY the same strings as `QUESTION_TYPES`, so
 *  a later "assemble this paper from the bank" join stays a straight string match
 *  without either enum depending on the other. */
export const SYLLABUS_ITEM_TYPES = [
  "mcq",
  "short_answer",
  "true_false",
  "fill_blank",
  "matching",
  "descriptive",
  "creative",
  "oral",
  "practical",
  "other",
] as const;
export type SyllabusItemType = (typeof SYLLABUS_ITEM_TYPES)[number];

export const SYLLABUS_ITEM_TYPE_LABELS_BN: Record<SyllabusItemType, string> = {
  mcq: "বহুনির্বাচনী",
  short_answer: "ছোট প্রশ্ন",
  true_false: "সত্য-মিথ্যা",
  fill_blank: "শূন্যস্থান পূরণ",
  matching: "মিলকরণ",
  descriptive: "বড় প্রশ্ন",
  creative: "সৃজনশীল",
  oral: "মৌখিক",
  practical: "ব্যবহারিক",
  other: "অন্যান্য",
};

export const SYLLABUS_ITEM_TYPE_LABELS_EN: Record<SyllabusItemType, string> = {
  mcq: "MCQ",
  short_answer: "Short answer",
  true_false: "True / false",
  fill_blank: "Fill in the blanks",
  matching: "Matching",
  descriptive: "Descriptive",
  creative: "Creative",
  oral: "Oral",
  practical: "Practical",
  other: "Other",
};

/** Every subject totals 100, in EVERY class (owner ruling 2026-08-23, D-#532).
 *  One universal guard rather than a per-class-band lookup; what FILLS the 100
 *  stays per subject, exactly as the source sheet writes it. */
export const SYLLABUS_FULL_MARKS = 100;

// =============================================================================
// GUARDIAN WORK CLAIM — "বাড়িতে সম্পন্ন হয়েছে" (GC-1, D-#551..#554/#557)
//
// A parent asserts that homework/assignment sitting at DUE or CHASE was actually
// done at home. The claim is a PARALLEL row and NEVER writes a lifecycle state
// (D-#551) — only a teacher moves a record to SUBMITTED. App-native vocabulary:
// no envelope twin, no import-contract sync (the D-#46/#52 pattern).
// =============================================================================

/** Which tracker a claim points at. The two record models are symmetric, so ONE
 *  claim type spans both (owner ruling 2026-08-25). */
export const WORK_CLAIM_TRACKERS = ["HOMEWORK", "ASSIGNMENT"] as const;
export type WorkClaimTracker = (typeof WORK_CLAIM_TRACKERS)[number];

export const WORK_CLAIM_TRACKER_LABELS_BN: Record<WorkClaimTracker, string> = {
  HOMEWORK: "বাড়ির কাজ",
  ASSIGNMENT: "অ্যাসাইনমেন্ট",
};
export const WORK_CLAIM_TRACKER_LABELS_EN: Record<WorkClaimTracker, string> = {
  HOMEWORK: "Homework",
  ASSIGNMENT: "Assignment",
};

/** PENDING → ACCEPTED | REJECTED | EXPIRED. ACCEPTED is reached AUTOMATICALLY by
 *  the teacher's ordinary submit pass (D-#552); EXPIRED by the 7-school-day sweep. */
export const WORK_CLAIM_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "EXPIRED"] as const;
export type WorkClaimStatus = (typeof WORK_CLAIM_STATUSES)[number];

export const WORK_CLAIM_STATUS_LABELS_BN: Record<WorkClaimStatus, string> = {
  PENDING: "অপেক্ষমাণ",
  ACCEPTED: "গৃহীত",
  REJECTED: "নাকচ",
  EXPIRED: "মেয়াদোত্তীর্ণ",
};
export const WORK_CLAIM_STATUS_LABELS_EN: Record<WorkClaimStatus, string> = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

/** A PICKER, never free text (D-#552). Without a recorded reason, "the teacher
 *  hasn't answered yet" and "the child genuinely didn't bring it" look identical
 *  to the Office — which would then chase a teacher who did nothing wrong. */
export const WORK_CLAIM_REJECT_REASONS = [
  "NOT_BROUGHT",
  "NOT_FOUND",
  "INCOMPLETE",
  "ALREADY_RECORDED",
  "OTHER",
] as const;
export type WorkClaimRejectReason = (typeof WORK_CLAIM_REJECT_REASONS)[number];

export const WORK_CLAIM_REJECT_REASON_LABELS_BN: Record<WorkClaimRejectReason, string> = {
  NOT_BROUGHT: "খাতা আনেনি",
  NOT_FOUND: "খাতা পাইনি",
  INCOMPLETE: "অসম্পূর্ণ",
  ALREADY_RECORDED: "আগেই জমা লেখা হয়েছে",
  OTHER: "অন্যান্য",
};
export const WORK_CLAIM_REJECT_REASON_LABELS_EN: Record<WorkClaimRejectReason, string> = {
  NOT_BROUGHT: "Did not bring the notebook",
  NOT_FOUND: "Notebook not received",
  INCOMPLETE: "Incomplete",
  ALREADY_RECORDED: "Already recorded as submitted",
  OTHER: "Other",
};

/** Lifecycle states a guardian may file a claim against (D-#553). GIVEN is not
 *  late yet; ABSENT_REDELIVER means the child never RECEIVED the work, so the
 *  answer there is redelivery — which the return-from-leave card surfaces —
 *  and a claim would be answering a question nobody asked. */
export const WORK_CLAIM_ELIGIBLE_STATES: readonly LifecycleState[] = ["DUE", "CHASE"];

/** The claim window, in SCHOOL days, measured from the record's due date
 *  (D-#553). Matches the D-#279 Today-dashboard look-back so "recent" means one
 *  thing across the app. Older than this, the term's reconciliation owns it. */
export const WORK_CLAIM_WINDOW_SCHOOL_DAYS = 7;

/** At most one re-claim after a rejection (D-#553): attempt 1 is the original,
 *  attempt 2 the single retry. A parent who still disagrees is a conversation. */
export const WORK_CLAIM_MAX_ATTEMPTS = 2;

/** Same-day escalation fire points, minutes-from-midnight (D-#554, owner ruling
 *  2026-08-25). The Office is told at 11:30 and the Principal at 13:00 on the
 *  claim's ACTION DAY if the teacher still has not marked the work. Both ride
 *  the existing 60s ticker, which already fires at arbitrary HH:MM. */
export const WORK_CLAIM_OFFICE_RUNG_MIN = 11 * 60 + 30;
export const WORK_CLAIM_PRINCIPAL_RUNG_MIN = 13 * 60;
