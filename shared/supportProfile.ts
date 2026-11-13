// =============================================================================
// শিক্ষার্থী সহায়তা প্রোফাইল — student support profile (docs/prd-child-support-profile.md, R3)
// =============================================================================
// Enums, word lists, thresholds and the pure function `evidenceLevel()` (PRD §5, §16.3–§16.7).
// Lives here, not in vocab.ts (the shared/staffMistakes.ts precedent): no import-envelope sync.
// Server and app read the same lists, so the chip a teacher taps and the code the server stores
// never drift apart. §16 is NORMATIVE: change a value here only with a D-# row.

// ---------------------------------------------------------------------------------------------
// Profile shape
// ---------------------------------------------------------------------------------------------

/** The eight sections of a profile version, in fixed display order (strengths first, S-2). */
export const SUPPORT_SECTIONS = [
  "strengths",
  "motivators",
  "triggers",
  "feelings",
  "works",
  "avoid",
  "learning",
  "goals",
] as const;
export type SupportSection = (typeof SUPPORT_SECTIONS)[number];

export const SUPPORT_SECTION_LABELS_BN: Record<SupportSection, string> = {
  strengths: "শক্তির দিক",
  motivators: "আগ্রহ ও যা উৎসাহ দেয়",
  triggers: "যে পরিস্থিতিতে কঠিন হয়",
  feelings: "অনুভূতি ও তা প্রকাশের ধরন",
  works: "ক্লাসে যা কাজ করে",
  avoid: "যা এড়িয়ে চলবেন",
  learning: "যেভাবে ভালো শেখে",
  goals: "এখনকার লক্ষ্য",
};

/** Concern side vs positive side (E-8 windows, E-5 minimums). Goals belong to neither. */
export const SUPPORT_CONCERN_SECTIONS: readonly SupportSection[] = ["triggers", "feelings", "avoid"];
export const SUPPORT_POSITIVE_SECTIONS: readonly SupportSection[] = ["strengths", "motivators", "learning", "works"];
export type SupportSide = "POSITIVE" | "CONCERN";
export const sideOfSection = (s: SupportSection): SupportSide | null =>
  SUPPORT_CONCERN_SECTIONS.includes(s) ? "CONCERN" : SUPPORT_POSITIVE_SECTIONS.includes(s) ? "POSITIVE" : null;

/** Evidence levels (§16.4 E-3), weakest first. The server computes them; a model never does. */
export const SUPPORT_LEVELS = ["SINGLE", "EMERGING", "ESTABLISHED", "STRONG"] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];
export const SUPPORT_LEVEL_LABELS_BN: Record<SupportLevel, string> = {
  SINGLE: "একবার দেখা গেছে",
  EMERGING: "কয়েকবার দেখা গেছে",
  ESTABLISHED: "নিয়মিত দেখা যায়",
  STRONG: "বিভিন্ন ক্লাসে দেখা যায়",
};
export const levelRank = (l: SupportLevel | null | undefined): number => (l ? SUPPORT_LEVELS.indexOf(l) : -1);

/** E-5: the level an item needs to enter the full profile (null = set by the Principal, goals). */
export const SUPPORT_SECTION_MIN_LEVEL: Record<SupportSection, SupportLevel | null> = {
  strengths: "SINGLE",
  motivators: "SINGLE",
  learning: "EMERGING",
  works: "SINGLE",
  triggers: "EMERGING",
  feelings: "EMERGING",
  avoid: "EMERGING",
  goals: null,
};

export const SUPPORT_STRATEGY_KINDS = ["PREVENT", "TEACH", "RESPOND", "STRENGTHEN"] as const;
export type SupportStrategyKind = (typeof SUPPORT_STRATEGY_KINDS)[number];
export const SUPPORT_STRATEGY_KIND_LABELS_BN: Record<SupportStrategyKind, string> = {
  PREVENT: "আগে থেকে",
  TEACH: "শেখান",
  RESPOND: "ঘটলে",
  STRENGTHEN: "ভালো কাজ বাড়ান",
};

export const SUPPORT_NEEDS = ["AUTONOMY", "COMPETENCE", "RELATEDNESS"] as const;
export type SupportNeed = (typeof SUPPORT_NEEDS)[number];

/** "এতে শিক্ষার্থী কী পেল বা কী এড়াল বলে মনে হয়?" — a clue, never a fact (§5.3, E-12). */
export const SUPPORT_FUNCTIONS = ["ADULT_ATTENTION", "PEER_ATTENTION", "ESCAPE_TASK", "GET_ITEM", "SENSORY", "UNSURE"] as const;
export type SupportFunction = (typeof SUPPORT_FUNCTIONS)[number];
export const SUPPORT_FUNCTION_LABELS_BN: Record<SupportFunction, string> = {
  ADULT_ATTENTION: "আপনার মনোযোগ",
  PEER_ATTENTION: "সহপাঠীদের মনোযোগ",
  ESCAPE_TASK: "কাজটি করতে হলো না বা দেরি হলো",
  GET_ITEM: "পছন্দের জিনিস/কাজ পেল",
  SENSORY: "নড়াচড়া বা শব্দ নিজেই ভালো লাগছিল",
  UNSURE: "বুঝতে পারিনি",
};

/** "ঠিক আগে কী চলছিল?" chips (§9.3), 1–3 per report. */
export const SUPPORT_ANTECEDENTS = [
  "WRITING_TASK",
  "ORAL_RECITE",
  "GROUP_WORK",
  "SOLO_WORK",
  "NEW_OR_HARD_TASK",
  "WAITING",
  "TRANSITION",
  "CORRECTED",
  "PEER_EVENT",
  "PLAY_TIFFIN_PRAYER",
  "OTHER",
] as const;
export type SupportAntecedent = (typeof SUPPORT_ANTECEDENTS)[number];
export const SUPPORT_ANTECEDENT_LABELS_BN: Record<SupportAntecedent, string> = {
  WRITING_TASK: "লেখার কাজ",
  ORAL_RECITE: "পড়া বলা/মুখস্থ",
  GROUP_WORK: "দলে কাজ",
  SOLO_WORK: "একা কাজ",
  NEW_OR_HARD_TASK: "নতুন বা কঠিন কাজ",
  WAITING: "অপেক্ষা/ফাঁকা সময়",
  TRANSITION: "এক কাজ থেকে অন্য কাজে যাওয়া",
  CORRECTED: "ভুল ধরিয়ে দেওয়া/বকা",
  PEER_EVENT: "সহপাঠীর সাথে কিছু",
  PLAY_TIFFIN_PRAYER: "খেলা/টিফিন/নামাজ",
  OTHER: "অন্য",
};

/** Skills not yet built (Greene 2014): goals and `skillKey` (§16.2 B, E-11). */
export const SUPPORT_SKILLS = [
  "WAIT_TURN",
  "SHIFT_TASK",
  "ASK_HELP",
  "HANDLE_NO",
  "HANDLE_LOSING",
  "START_TASK",
  "STAY_WITH_TASK",
  "CALM_DOWN",
  "JOIN_GROUP",
  "SPEAK_UP",
] as const;
export type SupportSkill = (typeof SUPPORT_SKILLS)[number];
export const SUPPORT_SKILL_LABELS_BN: Record<SupportSkill, string> = {
  WAIT_TURN: "নিজের পালা পর্যন্ত অপেক্ষা করা",
  SHIFT_TASK: "এক কাজ থেকে অন্য কাজে যাওয়া",
  ASK_HELP: "সাহায্য চাওয়া",
  HANDLE_NO: "'না' শুনে মেনে নেওয়া",
  HANDLE_LOSING: "হারলে মেনে নেওয়া",
  START_TASK: "নিজে কাজ শুরু করা",
  STAY_WITH_TASK: "কাজে লেগে থাকা",
  CALM_DOWN: "রাগ বা কষ্টে শান্ত হওয়া",
  JOIN_GROUP: "দলের কাজে যোগ দেওয়া",
  SPEAK_UP: "নিজের কথা বলা",
};

/** §16.7.3 starter strategies — a name only; it enters a profile only through the child's evidence. */
export const SUPPORT_STARTER_STRATEGIES = [
  { key: "GREET_BY_NAME", bn: "ক্লাসের শুরুতে নাম ধরে সালাম ও কুশল", kind: "PREVENT", needs: ["RELATEDNESS"] },
  { key: "REMIND_BEFORE", bn: "কাজ শুরুর আগে আলাদা করে এক লাইনে মনে করিয়ে দিন", kind: "PREVENT", needs: ["COMPETENCE"] },
  { key: "TWO_CHOICES", bn: "দুটি বিকল্প দিন — কোনটা আগে, কোথায় বসে", kind: "PREVENT", needs: ["AUTONOMY"] },
  { key: "SMALL_STEPS", bn: "কাজ ছোট ধাপে ভাগ করুন; প্রথম ধাপ একসাথে", kind: "PREVENT", needs: ["COMPETENCE"] },
  { key: "MORE_TURNS", bn: "ছোট ছোট প্রশ্নে বারবার উত্তর দেওয়ার সুযোগ দিন", kind: "PREVENT", needs: ["COMPETENCE"] },
  { key: "SMALL_DUTY", bn: "ছোট দায়িত্ব দিন — বোর্ড মোছা, খাতা বিতরণ", kind: "PREVENT", needs: ["COMPETENCE", "RELATEDNESS"] },
  { key: "SIT_NEAR", bn: "শিক্ষকের কাছাকাছি বসান (শাস্তি হিসেবে নয়)", kind: "PREVENT", needs: ["RELATEDNESS"] },
  { key: "TELL_WHAT_NEXT", bn: "কাজ বদলের ২ মিনিট আগে জানিয়ে দিন", kind: "PREVENT", needs: [] },
  { key: "MOVE_BREAK", bn: "নড়াচড়ার ছোট বিরতি বা কাজ দিন", kind: "PREVENT", needs: [] },
  { key: "FIRST_THEN", bn: "\"আগে এটা, তারপর ওটা\" — পছন্দের কাজ পরে", kind: "PREVENT", needs: [] },
  { key: "HELP_SIGNAL", bn: "সাহায্য চাওয়ার সহজ সংকেত শেখান", kind: "TEACH", needs: ["COMPETENCE"] },
  { key: "TALK_LATER", bn: "পরে আলাদা করে শুনুন: \"আমি খেয়াল করেছি… কী হয়েছিল?\"", kind: "TEACH", needs: ["AUTONOMY", "RELATEDNESS"] },
  { key: "QUIET_WORD", bn: "কাছে গিয়ে আস্তে নাম ধরে বলুন, সবার সামনে নয়", kind: "RESPOND", needs: ["RELATEDNESS"] },
  { key: "CALM_PLACE", bn: "শান্ত হওয়ার জন্য একটু সময় ও জায়গা দিন (শাস্তি নয়)", kind: "RESPOND", needs: [] },
  { key: "NAME_THE_GOOD", bn: "কী ভালো করল তা নির্দিষ্ট করে বলুন", kind: "STRENGTHEN", needs: ["COMPETENCE"] },
  { key: "NOTICE_GOOD_MOMENT", bn: "ছোট বিষয় ছেড়ে দিন; ভালো মুহূর্তে মনোযোগ দিন", kind: "STRENGTHEN", needs: ["RELATEDNESS"] },
] as const satisfies readonly { key: string; bn: string; kind: SupportStrategyKind; needs: readonly SupportNeed[] }[];
export type SupportStarterKey = (typeof SUPPORT_STARTER_STRATEGIES)[number]["key"];
export const SUPPORT_STARTER_KEYS: readonly SupportStarterKey[] = SUPPORT_STARTER_STRATEGIES.map((s) => s.key);

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------

export const SUPPORT_REPORT_STATUSES = [
  "DRAFT",
  "TO_PROCESS",
  "IN_BATCH",
  "NEEDS_REWRITE",
  "PROCESSED",
  "RETURNED",
  "APPROVED",
  "NOT_USED",
  "WITHDRAWN",
  "SAFEGUARDING_ROUTED",
] as const;
export type SupportReportStatus = (typeof SUPPORT_REPORT_STATUSES)[number];
export const SUPPORT_REPORT_STATUS_LABELS_BN: Record<SupportReportStatus, string> = {
  DRAFT: "খসড়া",
  TO_PROCESS: "প্রক্রিয়ার অপেক্ষায়",
  IN_BATCH: "প্রক্রিয়া চলছে",
  NEEDS_REWRITE: "কয়েকটি প্রশ্ন আছে",
  PROCESSED: "অনুমোদনের অপেক্ষায়",
  RETURNED: "ফেরত এসেছে",
  APPROVED: "অনুমোদিত",
  NOT_USED: "প্রোফাইলে যায়নি",
  WITHDRAWN: "তুলে নেওয়া হয়েছে",
  SAFEGUARDING_ROUTED: "প্রধান শিক্ষকের কাছে পাঠানো হয়েছে",
};
/** Statuses the author may still edit or withdraw (§6.9: until a batch takes it). */
export const SUPPORT_EDITABLE_STATUSES: readonly SupportReportStatus[] = ["DRAFT", "TO_PROCESS", "NEEDS_REWRITE", "RETURNED"];
/** Statuses waiting for a Principal decision. Direct decision (§6.7) is allowed on these. */
export const SUPPORT_DECIDABLE_STATUSES: readonly SupportReportStatus[] = ["TO_PROCESS", "PROCESSED"];

export const SUPPORT_REPORT_SOURCES = ["TEACHER", "COMMENT_SEED", "GUARDIAN_INFO"] as const;
export type SupportReportSource = (typeof SUPPORT_REPORT_SOURCES)[number];
export const SUPPORT_AUTHOR_VIA = ["TEACHING", "CLASS_TEACHER", "COVER", "PRINCIPAL"] as const;
export type SupportAuthorVia = (typeof SUPPORT_AUTHOR_VIA)[number];
export const SUPPORT_TONES = ["POSITIVE", "CONCERN", "MIXED"] as const;
export type SupportTone = (typeof SUPPORT_TONES)[number];
export const SUPPORT_RESULTS = ["WORKED", "PARTLY", "DID_NOT_WORK", "UNCLEAR"] as const;
export type SupportResult = (typeof SUPPORT_RESULTS)[number];
export const SUPPORT_HOW_OFTEN = ["ONCE", "TWO_THREE", "MORE"] as const;
export type SupportHowOften = (typeof SUPPORT_HOW_OFTEN)[number];
export const SUPPORT_CONTEXTS = ["ASSEMBLY", "BREAK", "PRAYER", "OTHER"] as const;
export type SupportContext = (typeof SUPPORT_CONTEXTS)[number];
export const SUPPORT_CHECK_SKIPPED = ["NONE", "AI_OFF", "CAPPED", "AI_ERROR", "DECIDED_DIRECTLY"] as const;
export type SupportCheckSkipped = (typeof SUPPORT_CHECK_SKIPPED)[number];
export const SUPPORT_DECISIONS = ["APPROVED", "APPROVED_EDITED", "RETURNED", "NOT_USED"] as const;
export type SupportDecision = (typeof SUPPORT_DECISIONS)[number];

/** OA-2: "—" on the good thing needs one of these reasons (D-#1583). */
export const SUPPORT_GOOD_NONE_REASONS = ["ALREADY_ABOVE", "SAW_BRIEFLY", "NOTHING_NOTICED", "OTHER"] as const;
export type SupportGoodNoneReason = (typeof SUPPORT_GOOD_NONE_REASONS)[number];
export const SUPPORT_GOOD_NONE_REASON_LABELS_BN: Record<SupportGoodNoneReason, string> = {
  ALREADY_ABOVE: "উপরেই লেখা আছে",
  SAW_BRIEFLY: "আজ অল্প সময় দেখেছি",
  NOTHING_NOTICED: "আজ তেমন কিছু চোখে পড়েনি",
  OTHER: "অন্য",
};

/** Field limits (§5.3). */
export const SUPPORT_FIELD_LIMITS = {
  situation: 400,
  settingNote: 200,
  behaviour: 600,
  tried: 400,
  resultNote: 300,
  exception: 300,
  whatWorked: 300,
  goodThing: 200,
  goodNoneReason: 120,
} as const;
/** The text fields a report holds — the ones the word lists and the safeguarding list read. */
export const SUPPORT_TEXT_FIELDS = ["situation", "settingNote", "behaviour", "tried", "resultNote", "exception", "whatWorked", "goodThing"] as const;
export type SupportTextField = (typeof SUPPORT_TEXT_FIELDS)[number];

// ---------------------------------------------------------------------------------------------
// The bias rubric (§16.3, NORMATIVE)
// ---------------------------------------------------------------------------------------------

export const SUPPORT_CATEGORIES = [
  "LABEL",
  "DIAGNOSIS",
  "STEREOTYPE",
  "PREDICTION",
  "HARSH",
  "MIND_READING",
  "NO_EVIDENCE",
  "PRIVATE_FAMILY",
  "SPILLOVER",
  "PRIOR_BELIEF",
  "POSITIVE_BIAS",
  "AGE_TYPICAL",
  "OVERGENERAL",
  "MISSING_PART",
  "OTHER_CHILD",
  "COMPARISON",
  "PUNITIVE",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUPPORT_SEVERITIES = ["BLOCK", "ASK", "NOTE"] as const;
export type SupportSeverity = (typeof SUPPORT_SEVERITIES)[number];

/** Family → the one question a teacher sees (never a category code, never "bias"; RB-6). */
export const SUPPORT_FAMILIES = ["WORDS", "OBSERVED", "COUNTS", "OTHER_CHILDREN", "SUPPORT_NOT_PUNISHMENT"] as const;
export type SupportFamily = (typeof SUPPORT_FAMILIES)[number];
export const SUPPORT_FAMILY_LABELS_BN: Record<SupportFamily, string> = {
  WORDS: "শব্দ",
  OBSERVED: "যা দেখেছেন",
  COUNTS: "কতবার, কখন",
  OTHER_CHILDREN: "অন্য শিশু",
  SUPPORT_NOT_PUNISHMENT: "সহায়তা, শাস্তি নয়",
};

/** Default severity per category. PUNITIVE is BLOCK in `whatWorked`, ASK in `tried` (see severityFor). */
export const SUPPORT_CATEGORY_RULES: Record<SupportCategory, { family: SupportFamily; severity: SupportSeverity }> = {
  LABEL: { family: "WORDS", severity: "BLOCK" },
  DIAGNOSIS: { family: "WORDS", severity: "BLOCK" },
  STEREOTYPE: { family: "WORDS", severity: "BLOCK" },
  PREDICTION: { family: "WORDS", severity: "BLOCK" },
  HARSH: { family: "WORDS", severity: "ASK" },
  MIND_READING: { family: "OBSERVED", severity: "ASK" },
  NO_EVIDENCE: { family: "OBSERVED", severity: "ASK" },
  PRIVATE_FAMILY: { family: "OBSERVED", severity: "ASK" },
  SPILLOVER: { family: "OBSERVED", severity: "ASK" },
  PRIOR_BELIEF: { family: "OBSERVED", severity: "ASK" },
  POSITIVE_BIAS: { family: "OBSERVED", severity: "ASK" },
  AGE_TYPICAL: { family: "OBSERVED", severity: "NOTE" },
  OVERGENERAL: { family: "COUNTS", severity: "ASK" },
  MISSING_PART: { family: "COUNTS", severity: "ASK" },
  OTHER_CHILD: { family: "OTHER_CHILDREN", severity: "BLOCK" },
  COMPARISON: { family: "OTHER_CHILDREN", severity: "ASK" },
  PUNITIVE: { family: "SUPPORT_NOT_PUNISHMENT", severity: "BLOCK" },
};

/** The severity a flag must carry: the rubric's, except PUNITIVE in `tried` (ASK + note) and an
 *  ask-list LABEL (ASK). The server never lets a model lower a BLOCK. */
export function severityFor(category: SupportCategory, field: string, askListLabel = false): SupportSeverity {
  if (category === "PUNITIVE") return field === "whatWorked" ? "BLOCK" : "ASK";
  if (category === "LABEL" && askListLabel) return "ASK";
  return SUPPORT_CATEGORY_RULES[category].severity;
}

/** RB-6: all BLOCK flags + at most this many ASK/NOTE flags shown per round. */
export const SUPPORT_MAX_SOFT_FLAGS_PER_ROUND = 3;
/** §6.12 step 7: at most 3 checks per report (instant + batch alike). */
export const SUPPORT_MAX_CHECKS = 3;
const SEVERITY_ORDER: Record<SupportSeverity, number> = { BLOCK: 0, ASK: 1, NOTE: 2 };
/** The flags a teacher sees this round: every BLOCK, then the most serious ≤ 3 others. */
export function flagsForRound<T extends { severity: SupportSeverity }>(flags: readonly T[]): T[] {
  const sorted = [...flags].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const blocks = sorted.filter((f) => f.severity === "BLOCK");
  const soft = sorted.filter((f) => f.severity !== "BLOCK").slice(0, SUPPORT_MAX_SOFT_FLAGS_PER_ROUND);
  return [...blocks, ...soft];
}

// ---------------------------------------------------------------------------------------------
// Word lists (§2.3 S-1, §16.6.1) — deterministic, run with or without AI (D-#1550)
// ---------------------------------------------------------------------------------------------

export interface SupportTerm {
  term: string;
  category: "LABEL" | "DIAGNOSIS";
}

/** BLOCK list: a report holding one cannot be saved (the child's quoted words excepted). */
export const SUPPORT_BLOCKED_TERMS: readonly SupportTerm[] = [
  // character / moral labels
  ...["দুষ্ট", "বেয়াদব", "বেয়াদপ", "বেআদব", "অভদ্র", "অলস", "ফাঁকিবাজ", "বোকা", "গাধা", "মাথামোটা", "শয়তান", "বখাটে",
    "নষ্ট ছেলে", "নষ্ট মেয়ে", "মিথ্যাবাদী", "মিথ্যুক", "চোর", "গুনাহগার", "বেনামাজি", "দুর্বল ছাত্র", "পাগল",
    "naughty", "rude", "lazy", "stupid", "idiot", "liar", "thief", "slow learner", "problem child", "bad boy", "bad girl"]
    .map((term) => ({ term, category: "LABEL" as const })),
  // diagnoses — not ours to make
  ...["হাইপার", "ADHD", "এডিএইচডি", "অটিস্টিক", "অটিজম", "স্পেশাল চাইল্ড", "ডিপ্রেশন", "মানসিক সমস্যা", "মানসিক রোগ",
    "মাথায় সমস্যা", "প্রতিবন্ধী", "hyper", "hyperactive", "autism", "autistic", "special child", "depression", "depressed",
    "dyslexia", "dyslexic", "retarded", "mental problem"]
    .map((term) => ({ term, category: "DIAGNOSIS" as const })),
];

/** ASK list: the save goes on; the question is shown (§16.6.1 `A`). Added as LABEL at ASK. */
export const SUPPORT_ASK_TERMS: readonly SupportTerm[] = [
  "অমনোযোগী", "চঞ্চল", "অস্থির", "জেদি", "একগুঁয়ে", "অবাধ্য", "রাগী", "বদমেজাজি", "ঝগড়াটে", "লাজুক", "ভীতু",
  "ছিঁচকাঁদুনে", "মনোযোগ কাড়তে চায়", "আদরে নষ্ট", "বাসায় শাসন নেই", "লক্ষ্মী", "ভালো ছেলে", "ভালো মেয়ে", "সেরা",
  "inattentive", "restless", "stubborn", "disobedient", "short-tempered", "shy", "attention seeking", "attention-seeking",
  "spoiled", "good boy", "good girl", "the best",
].map((term) => ({ term, category: "LABEL" as const }));

/** Frequency words never allowed in a profile sentence (§6.6 rule 8, E-4). */
export const SUPPORT_BANNED_PROFILE_WORDS: readonly string[] = [
  "সবসময়", "সব সময়", "কখনোই", "কখনও না", "প্রতিদিন", "প্রায়ই", "সারাক্ষণ", "always", "never", "every day", "everyday", "often",
];

// ---------------------------------------------------------------------------------------------
// Safeguarding (§16.5, NORMATIVE) — leaves the feature
// ---------------------------------------------------------------------------------------------

export const SAFEGUARDING_SIGNS = [
  "DISCLOSURE",
  "INJURY",
  "SELF_HARM",
  "SEXUALISED",
  "NEGLECT",
  "FEAR",
  "ADULT_HARM",
  "SERIOUS_PEER_HARM",
  "SUDDEN_CHANGE",
] as const;
export type SafeguardingSign = (typeof SAFEGUARDING_SIGNS)[number];
export const SAFEGUARDING_SIGN_LABELS_BN: Record<SafeguardingSign, string> = {
  DISCLOSURE: "শিশু নিজে বলেছে কেউ আঘাত বা ভয় দেখায়",
  INJURY: "অজানা কারণে আঘাতের চিহ্ন",
  SELF_HARM: "নিজের ক্ষতি বা মরে যাওয়ার কথা",
  SEXUALISED: "বয়সের সাথে মেলে না এমন যৌন আচরণ বা কথা",
  NEGLECT: "অবহেলার চিহ্ন",
  FEAR: "বাসায় যেতে বা কারও কাছে যেতে ভয়",
  ADULT_HARM: "স্কুলের কোনো বড় মানুষ আঘাত বা অপমান করেছে",
  SERIOUS_PEER_HARM: "গুরুতর আঘাত বা অস্ত্র",
  SUDDEN_CHANGE: "হঠাৎ বড় পরিবর্তন",
};

export interface SafeguardingTerm {
  term: string;
  sign: SafeguardingSign;
}

/**
 * The deterministic sign list (SG-2 detector 1). Phrases, not single words, so the ordinary
 * controls stay quiet: a child hitting a classmate (F-36), a scraped knee at play (F-37), the
 * idiom "লজ্জায় মরে যাচ্ছিল" (F-38), a bleeding nose stated plainly (F-21). SUDDEN_CHANGE has no
 * term: alone it is LOW confidence and is left to the batch (SG-1). A hit opens the teacher's
 * question (SG-4) and, on "না", a same-day notice to the Principal.
 */
export const SUPPORT_SAFEGUARDING_TERMS: readonly SafeguardingTerm[] = [
  ...["বাসায় মারে", "বাড়িতে মারে", "বাসায় মারধর", "বাড়িতে মারধর", "আব্বু মারে", "আম্মু মারে", "বাবা মারে", "মা মারে",
    "মারধর করে", "পেটায়", "গায়ে হাত দেয়", "খারাপভাবে ছোঁয়", "খারাপ জায়গায় হাত", "beaten at home", "beats me", "hits me at home",
    "touches me", "hurts me at home"].map((term) => ({ term, sign: "DISCLOSURE" as const })),
  ...["পোড়া দাগ", "পোড়ার দাগ", "ছ্যাঁকা", "কালশিটে", "কালসিটে", "কালশিরা", "কালসিরা", "মারের দাগ", "আঘাতের দাগ", "বেল্টের দাগ", "burn mark", "bruise", "bruis", "belt mark"]
    .map((term) => ({ term, sign: "INJURY" as const })),
  ...["মরে যেতে চাই", "মরে যেতে চায়", "মরে যাব", "আত্মহত্যা", "নিজেকে কেটে", "নিজের হাত কেটে", "নিজেকে আঘাত", "নিজের ক্ষতি",
    "want to die", "wants to die", "kill myself", "suicide", "suicid", "self-harm", "self harm", "hurt myself"]
    .map((term) => ({ term, sign: "SELF_HARM" as const })),
  ...["যৌন", "গোপন অঙ্গ", "sexual", "private parts"].map((term) => ({ term, sign: "SEXUALISED" as const })),
  ...["না খেয়ে আসে", "না খেয়ে এসেছে", "খেতে পায় না", "খাবার পায় না", "অপরিচ্ছন্ন", "গোসল করে না", "কেউ নিতে আসে না",
    "not fed", "unwashed", "neglected", "nobody collects"].map((term) => ({ term, sign: "NEGLECT" as const })),
  ...["বাসায় যেতে ভয়", "বাড়ি যেতে ভয়", "বাসায় যেতে চায় না", "বাড়ি যেতে চায় না", "afraid to go home", "scared to go home"]
    .map((term) => ({ term, sign: "FEAR" as const })),
  ...["স্যার মেরেছে", "ম্যাডাম মেরেছে", "শিক্ষক মেরেছে", "হুজুর মেরেছে", "আপা মেরেছে", "teacher hit", "a teacher beat"]
    .map((term) => ({ term, sign: "ADULT_HARM" as const })),
  ...["ছুরি", "অস্ত্র", "knife", "knives", "weapon"].map((term) => ({ term, sign: "SERIOUS_PEER_HARM" as const })),
];

/**
 * Variant forms a plain phrase cannot hold (past tense, a word in between: "আব্বু ওকে মারে",
 * "স্যার ওকে পিটিয়ে…"). A pattern fires when a WHO word is followed, within `gap` words in between,
 * by a DOING stem (any ending after it). A peer ("বন্ধু ওকে মেরেছে") has no WHO word, so it stays
 * quiet (F-36). English signs also match with the endings s / es / ed / ing / al.
 */
export interface SafeguardingPattern {
  who: readonly string[];
  doing: readonly string[];
  sign: SafeguardingSign;
  gap: number;
}
const HIT_STEMS = ["মারে", "মারছে", "মেরে", "মারধো", "মারধর", "পিটিয়ে", "পিটায়", "পেটায়"];
const PARENT_WHO = ["আব্বু", "আম্মু", "আব্বা", "আম্মা", "বাবা", "মা", "বাবা-মা", "বাপ", "চাচা", "মামা"];
const STAFF_WHO = ["স্যার", "ম্যাডাম", "শিক্ষক", "শিক্ষিকা", "হুজুর", "আপা", "টিচার", "মাওলানা"];
export const SUPPORT_SAFEGUARDING_PATTERNS: readonly SafeguardingPattern[] = [
  { who: PARENT_WHO, doing: HIT_STEMS, sign: "DISCLOSURE", gap: 2 },
  { who: PARENT_WHO, doing: ["ভয় দেখা", "ভয় দেখি", "হুমকি"], sign: "FEAR", gap: 2 },
  { who: STAFF_WHO, doing: [...HIT_STEMS, "ভয় দেখা", "ভয় দেখি", "হুমকি"], sign: "ADULT_HARM", gap: 2 },
];
const WHO_ENDINGS = ["", "র", "কে", "ও", "ই", "রা", "েরা"];
const tokensOf = (norm: string): string[] => norm.split(/[^ঀ-৿a-z0-9-]+/).filter(Boolean);
/** Pattern hits in already-normalised text. */
function patternHits(norm: string): { term: string; sign: SafeguardingSign }[] {
  const tk = tokensOf(norm);
  const out: { term: string; sign: SafeguardingSign }[] = [];
  for (const p of SUPPORT_SAFEGUARDING_PATTERNS) {
    const who = p.who.map(normaliseSupportText);
    const doing = p.doing.map((d) => normaliseSupportText(d).split(" "));
    for (let i = 0; i < tk.length; i++) {
      if (!who.some((w) => WHO_ENDINGS.some((e) => tk[i] === w + e))) continue;
      for (let j = i + 1; j < tk.length && j <= i + 1 + p.gap; j++) {
        const d = doing.find((words) => words.every((w, k) => tk[j + k]?.startsWith(w)));
        if (d) {
          out.push({ term: `${tk[i]} … ${d.join(" ")}`, sign: p.sign });
          break;
        }
      }
    }
  }
  return out;
}

/** SG-5: the five steps the teacher sees (screen + guide). */
export const SAFEGUARDING_STEPS_BN: readonly string[] = [
  "শান্তভাবে শুনুন; বিশ্বাস করুন।",
  "জেরা করবেন না; \"কে করেছে?\"-র মতো প্রশ্ন চাপিয়ে দেবেন না।",
  "গোপন রাখার কথা দেবেন না — বলুন, \"তোমাকে নিরাপদ রাখতে আমাকে প্রধান শিক্ষককে জানাতে হবে।\"",
  "শিশুর নিজের কথাগুলো হুবহু লিখে রাখুন; নিজে তদন্ত করবেন না, পরিবারকে নিজে থেকে কিছু বলবেন না।",
  "আজই প্রধান শিক্ষককে সরাসরি জানান; আর কাউকে নয়। জরুরি হলে শিশু সহায়তা হেল্পলাইন ১০৯৮।",
];
export const SAFEGUARDING_QUESTION_BN = "এটি কি শিশুর নিরাপত্তার বিষয় হতে পারে?";
export const SAFEGUARDING_FORM_LINE_BN = "শিশুর নিরাপত্তা নিয়ে উদ্বেগ? এই ফর্ম নয় — প্রধান শিক্ষককে এখনই জানান";

// ---------------------------------------------------------------------------------------------
// Matching — spelling-tolerant, Bangla + English
// ---------------------------------------------------------------------------------------------

/**
 * Normalise for matching: NFC, the nukta forms of য় ড় ঢ় folded, ZWJ/ZWNJ dropped, long vowel
 * signs folded to short (ী→ি, ূ→ু — the commonest misspelling), lower case, whitespace collapsed.
 * Index-stable is NOT promised; only use the result for "does it occur".
 */
export function normaliseSupportText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/য়/g, "য়")
    .replace(/ড়/g, "ড়")
    .replace(/ঢ়/g, "ঢ়")
    .replace(/[‌‍]/g, "")
    .replace(/ী/g, "ি")
    .replace(/ূ/g, "ু")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const WORD_CHAR = /[ঀ-৿a-z0-9]/;
const isLatinTerm = (t: string): boolean => /^[a-z0-9 \-']+$/i.test(t);

/** Where does `term` occur in normalised `text`? Bangla: a left word boundary, any suffix after
 *  (inflections: -কে, -টা, -মি…). English: a word boundary on both sides. */
export function termOccurs(normText: string, rawTerm: string, latinEndings = false): boolean {
  const term = normaliseSupportText(rawTerm);
  if (!term) return false;
  let from = 0;
  for (;;) {
    const at = normText.indexOf(term, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : normText[at - 1];
    const after = normText[at + term.length] ?? "";
    const leftOk = !before || !WORD_CHAR.test(before);
    const rightOk =
      !isLatinTerm(term) ||
      !after ||
      !/[a-z0-9]/.test(after) ||
      (latinEndings && /^(s|es|ed|ing|al)(?![a-z0-9])/.test(normText.slice(at + term.length)));
    if (leftOk && rightOk) return true;
    from = at + 1;
  }
}

/** S-1 exemption: text inside quotation marks is the child's own words. Returns the text with
 *  quoted spans blanked (only used for the `behaviour` field). English apostrophes are kept. */
export function stripQuoted(text: string): string {
  return text
    .replace(/“[^”]*”/g, " ")
    .replace(/‘[^’]*’/g, " ")
    .replace(/«[^»]*»/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/(^|[\s(\[:,—–\-।])'([^'\n]+)'(?![a-zA-Z])/g, "$1 ");
}

export interface SupportTermHit {
  field: SupportTextField;
  term: string;
  category: "LABEL" | "DIAGNOSIS";
  severity: "BLOCK" | "ASK";
}
export interface SafeguardingHit {
  field: SupportTextField;
  term: string;
  sign: SafeguardingSign;
}

export type SupportReportTexts = Partial<Record<SupportTextField, string | null | undefined>>;

/** Run both word lists over a report's fields (the behaviour field's quoted words exempt). */
export function scanSupportTerms(texts: SupportReportTexts): SupportTermHit[] {
  const hits: SupportTermHit[] = [];
  for (const field of SUPPORT_TEXT_FIELDS) {
    const raw = texts[field];
    if (!raw) continue;
    const norm = normaliseSupportText(field === "behaviour" ? stripQuoted(raw) : raw);
    for (const t of SUPPORT_BLOCKED_TERMS) if (termOccurs(norm, t.term)) hits.push({ field, term: t.term, category: t.category, severity: "BLOCK" });
    for (const t of SUPPORT_ASK_TERMS) if (termOccurs(norm, t.term)) hits.push({ field, term: t.term, category: t.category, severity: "ASK" });
  }
  return hits;
}

/** Run the safeguarding list over every field (quoted words included: a disclosure is quoted). */
export function scanSafeguarding(texts: SupportReportTexts): SafeguardingHit[] {
  const hits: SafeguardingHit[] = [];
  for (const field of SUPPORT_TEXT_FIELDS) {
    const raw = texts[field];
    if (!raw) continue;
    const norm = normaliseSupportText(raw);
    for (const t of SUPPORT_SAFEGUARDING_TERMS) if (termOccurs(norm, t.term, true)) hits.push({ field, term: t.term, sign: t.sign });
    for (const h of patternHits(norm)) hits.push({ field, ...h });
  }
  return hits;
}

/** Any blocked term in one free sentence (profile items, model text — V-10). */
export const blockedTermIn = (text: string): string | null => {
  const norm = normaliseSupportText(text);
  return SUPPORT_BLOCKED_TERMS.find((t) => termOccurs(norm, t.term))?.term ?? null;
};
/** Any safeguarding term in one free sentence (V-9). */
export const safeguardingTermIn = (text: string): string | null => {
  const norm = normaliseSupportText(text);
  return SUPPORT_SAFEGUARDING_TERMS.find((t) => termOccurs(norm, t.term, true))?.term ?? patternHits(norm)[0]?.term ?? null;
};
/** Any frequency word in one profile sentence (§6.6 rule 8). */
export const bannedProfileWordIn = (text: string): string | null => {
  const norm = normaliseSupportText(text);
  return SUPPORT_BANNED_PROFILE_WORDS.find((w) => termOccurs(norm, w)) ?? null;
};

// ---------------------------------------------------------------------------------------------
// Evidence standards (§16.4, NORMATIVE) — D-#1562, D-#1563
// ---------------------------------------------------------------------------------------------

export const SUPPORT_THRESHOLDS = {
  /** E-8: a concern-side report counts for 12 months, a positive-side one for 24 (in days). */
  concernWindowDays: 365,
  positiveWindowDays: 730,
  /** E-8: a card item needs an observation inside this many days. */
  concernCardDays: 120,
  positiveCardDays: 180,
  /** E-3 (b): one teacher — 3 observations on 3 days, first to last ≥ 14 days. */
  singleTeacherObs: 3,
  singleTeacherSpanDays: 14,
  /** E-3 (a): ≥ 2 observations from ≥ 2 teachers. */
  establishedObs: 2,
  establishedTeachers: 2,
  /** E-3: STRONG — ≥ 4 observations, ≥ 3 teachers, ≥ 2 settings. */
  strongObs: 4,
  strongTeachers: 3,
  strongSettings: 2,
  /** E-6: supporting share must be ≥ 2/3; at ≤ 1/3 with ≥ 3 tries from ≥ 2 teachers → "যা কাজ করেনি". */
  consistencyShare: 2 / 3,
  failedShare: 1 / 3,
  /** E-12: a possible reason needs ≥ 3 observations from ≥ 2 teachers. */
  functionObs: 3,
  functionTeachers: 2,
  /** E-11 */
  maxActiveGoals: 2,
  /** §5.3 / R-14: a report may be dated at most 7 days back. */
  reportBackDays: 7,
  /** §5.9: at most 3 open drafts per child per author. */
  maxOpenDrafts: 3,
  /** §2.4: NOT_USED text deleted after 30 days. */
  notUsedTextDays: 30,
  /** §16.7: card limits. */
  cardDo: 5,
  cardAvoid: 5,
  cardStrengths: 2,
  cardLeads: 2,
  cardTextChars: 90,
  /** §6.10 B-1 / §9.7: batch reminder. */
  batchReminderOldestDays: 7,
  batchReminderWaiting: 25,
} as const;

/** One cited report, as the server sees it (never what a model claims). */
export interface EvidenceReport {
  id: string;
  authorId: string;
  /** YYYY-MM-DD, Dhaka day of the event. */
  occurredOn: string;
  /** The period number or context of the event — E-1's "(date, period or context)". */
  slot: string;
  /** Subject code or context (Maths, Quran, ASSEMBLY…) — E-1 settings. */
  setting: string;
  source: SupportReportSource;
  result?: SupportResult | null;
  /** The observation comes from the report's good-thing line only (E-2, OA-2). */
  viaGoodThing?: boolean;
}

export interface EvidenceInput {
  side: SupportSide;
  /** APPROVED (or provisional) reports that support the item. */
  evidence: readonly EvidenceReport[];
  /** Reports pointing the other way in the same setting (E-6). */
  counter?: readonly EvidenceReport[];
  /** Strategy items: WORKED/PARTLY support, DID_NOT_WORK contradicts, ≥ 1 WORKED needed (E-6). */
  isStrategy?: boolean;
  todayKey: string;
}

export interface EvidenceSummary {
  level: SupportLevel | null;
  obsCount: number;
  teachersCount: number;
  settings: string[];
  firstEvidenceKey: string | null;
  lastEvidenceKey: string | null;
  hasGuardianInfo: boolean;
  /** Supporting share under 2/3 — worded "mixed", never on the card (E-6). */
  mixed: boolean;
  /** Strategy at ≤ 1/3 with ≥ 3 tries from ≥ 2 teachers → "যা কাজ করেনি" (E-6). */
  failed: boolean;
  /** The ids that counted (inside the window, not UNCLEAR, not guardian). */
  countedIds: string[];
}

/** Whole days from a to b (YYYY-MM-DD), b − a. */
export function daysBetweenKeys(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86_400_000);
}

export const windowDaysFor = (side: SupportSide): number =>
  side === "CONCERN" ? SUPPORT_THRESHOLDS.concernWindowDays : SUPPORT_THRESHOLDS.positiveWindowDays;
export const cardDaysFor = (side: SupportSide): number =>
  side === "CONCERN" ? SUPPORT_THRESHOLDS.concernCardDays : SUPPORT_THRESHOLDS.positiveCardDays;

/** E-8: does this report still count on this side today? */
export const insideWindow = (side: SupportSide, occurredOn: string, todayKey: string): boolean =>
  daysBetweenKeys(occurredOn, todayKey) <= windowDaysFor(side);

interface Obs {
  key: string;
  day: string;
  authors: Set<string>;
  setting: string;
}

function observationsOf(reports: readonly EvidenceReport[]): Obs[] {
  const byKey = new Map<string, Obs>();
  for (const r of reports) {
    const key = `${r.occurredOn}|${r.slot}`;
    const o = byKey.get(key) ?? { key, day: r.occurredOn, authors: new Set<string>(), setting: r.setting };
    o.authors.add(r.authorId);
    byKey.set(key, o);
  }
  return [...byKey.values()];
}

/** E-3 (b): some one teacher has ≥ 3 observations on ≥ 3 different days, first to last ≥ 14 days. */
function singleTeacherEstablished(obs: Obs[]): boolean {
  const days = new Map<string, Set<string>>();
  for (const o of obs) for (const a of o.authors) (days.get(a) ?? days.set(a, new Set()).get(a)!).add(o.day);
  for (const set of days.values()) {
    if (set.size < SUPPORT_THRESHOLDS.singleTeacherObs) continue;
    const sorted = [...set].sort();
    if (daysBetweenKeys(sorted[0], sorted[sorted.length - 1]) >= SUPPORT_THRESHOLDS.singleTeacherSpanDays) return true;
  }
  return false;
}

/**
 * The level of one profile item from the reports it cites (§16.4 E-1…E-10). Pure; the server
 * calls it at import, at publishing (frozen) and the card reads freshness at read time.
 */
export function evidenceLevel(input: EvidenceInput): EvidenceSummary {
  const { side, todayKey, isStrategy } = input;
  const usable = (r: EvidenceReport): boolean =>
    insideWindow(side, r.occurredOn, todayKey) && (r.viaGoodThing || r.result !== "UNCLEAR");
  const all = input.evidence.filter(usable);
  const hasGuardianInfo = all.some((r) => r.source === "GUARDIAN_INFO");
  const teacherReports = all.filter((r) => r.source !== "GUARDIAN_INFO");

  // Strategy items: support = WORKED/PARTLY; DID_NOT_WORK in the cited set is contradicting.
  let supporting = teacherReports;
  let contradicting = (input.counter ?? []).filter(usable).filter((r) => r.source !== "GUARDIAN_INFO");
  if (isStrategy) {
    supporting = teacherReports.filter((r) => r.result === "WORKED" || r.result === "PARTLY");
    contradicting = [...contradicting, ...teacherReports.filter((r) => r.result === "DID_NOT_WORK")];
  }

  const obs = observationsOf(supporting);
  const counterObs = observationsOf(contradicting);
  const teachers = new Set(supporting.map((r) => r.authorId));
  const settings = [...new Set(supporting.map((r) => r.setting))].sort();
  const days = supporting.map((r) => r.occurredOn).sort();
  const share = obs.length + counterObs.length === 0 ? 1 : obs.length / (obs.length + counterObs.length);
  const mixed = share < SUPPORT_THRESHOLDS.consistencyShare;
  const allTriers = new Set([...supporting, ...contradicting].map((r) => r.authorId));
  const failed =
    !!isStrategy &&
    share <= SUPPORT_THRESHOLDS.failedShare &&
    obs.length + counterObs.length >= 3 &&
    allTriers.size >= 2;

  let level: SupportLevel | null = null;
  if (obs.length >= 1) level = "SINGLE";
  if (obs.length >= 2) level = "EMERGING";
  const consistentEnough = !mixed && (!isStrategy || supporting.some((r) => r.result === "WORKED"));
  if (consistentEnough) {
    const est =
      (obs.length >= SUPPORT_THRESHOLDS.establishedObs && teachers.size >= SUPPORT_THRESHOLDS.establishedTeachers) ||
      singleTeacherEstablished(obs);
    if (est) level = "ESTABLISHED";
    if (
      obs.length >= SUPPORT_THRESHOLDS.strongObs &&
      teachers.size >= SUPPORT_THRESHOLDS.strongTeachers &&
      settings.length >= SUPPORT_THRESHOLDS.strongSettings
    )
      level = "STRONG";
  }
  // E-10: guardian information alone can make only a SINGLE positive item; it never raises a level.
  if (!level && hasGuardianInfo && side === "POSITIVE") level = "SINGLE";

  return {
    level,
    obsCount: obs.length,
    teachersCount: teachers.size,
    settings,
    firstEvidenceKey: days[0] ?? null,
    lastEvidenceKey: days[days.length - 1] ?? null,
    hasGuardianInfo,
    mixed,
    failed,
    countedIds: supporting.map((r) => r.id),
  };
}

/** E-8: is a card item fresh enough today? */
export const isCardFresh = (side: SupportSide, lastEvidenceKey: string | null, todayKey: string): boolean =>
  !!lastEvidenceKey && daysBetweenKeys(lastEvidenceKey, todayKey) <= cardDaysFor(side);

/** E-9: a concern-side item with no evidence on or after the year cut-over is dormant. */
export const isDormant = (side: SupportSide | null, lastEvidenceKey: string | null, cutoverKey: string | null): boolean =>
  side === "CONCERN" && !!cutoverKey && (!lastEvidenceKey || lastEvidenceKey < cutoverKey);

/** E-12: may a possible reason be shown with this support? */
export const functionTagAllowed = (obsSharing: number, teachersSharing: number): boolean =>
  obsSharing >= SUPPORT_THRESHOLDS.functionObs && teachersSharing >= SUPPORT_THRESHOLDS.functionTeachers;

/** E-2 / G-04: a good thing counts only when it names something done or said — not "—", not a
 *  bare label. A bare label = after removing ask/block terms and fillers almost nothing is left. */
export function goodThingCounts(goodThing: { textBn?: string | null; none?: boolean | null } | null | undefined): boolean {
  if (!goodThing || goodThing.none || !goodThing.textBn) return false;
  let norm = normaliseSupportText(goodThing.textBn);
  for (const t of [...SUPPORT_ASK_TERMS, ...SUPPORT_BLOCKED_TERMS]) norm = norm.split(normaliseSupportText(t.term)).join(" ");
  for (const filler of ["খুব", "অনেক", "মাশাআল্লাহ", "আলহামদুলিল্লাহ", "সে", "ও", "very", "a", "is", "he", "she"]) {
    norm = norm.replace(new RegExp(`(^|\\s)${filler}(?=\\s|$)`, "g"), " ");
  }
  const words = norm.replace(/[।,.!?—\-"'“”]/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length >= 2;
}

// ---------------------------------------------------------------------------------------------
// Import reasons (§6.11) — used from CSP-2; the plain reason the preview shows
// ---------------------------------------------------------------------------------------------

export const SUPPORT_IMPORT_REASONS = {
  NOT_JSON: "ফাইলটি পড়া যায়নি (JSON নয়)",
  TOO_LARGE: "ফাইল খুব বড়",
  WRONG_BATCH: "এই ব্যাচের ফলাফল নয়",
  BATCH_CLOSED: "ব্যাচটি বন্ধ হয়ে গেছে",
  WRONG_METHOD: "পদ্ধতি-নথির সংস্করণ মেলেনি",
  UNKNOWN_FIELD: "অজানা ঘর",
  BAD_VALUE: "ভুল মান",
  UNKNOWN_CODE: "অজানা কোড",
  NOT_NEW: "এই ব্যাচে নতুন রিপোর্ট নয়",
  DUPLICATE: "একই রিপোর্টের দুটি ফলাফল",
  NO_EVIDENCE: "প্রমাণ ছাড়া বাক্য",
  OVERCLAIM: "প্রমাণের চেয়ে জোরালো দাবি",
  BELOW_MIN: "এই অংশে ঢোকার মতো প্রমাণ নেই",
  SAFEGUARDING_TERM: "সুরক্ষা-শব্দ আছে",
  LABEL_TERM: "লেবেল বা রোগের নাম আছে",
  TOKEN_OR_NAME: "বাক্যে কোড বা নাম আছে",
  FREQUENCY_WORD: "'সবসময়'-এর মতো শব্দ আছে",
  LINK_OR_HTML: "লিংক বা কোড আছে",
  TOO_BIG: "আকার বেশি",
  NO_WORKED: "কাজ করেছে এমন রিপোর্ট নেই",
  NO_SETTING: "কোথায় দেখা গেছে লেখা নেই",
  PUNITIVE: "শাস্তিমূলক কৌশল",
  NOT_ACTIONABLE: "কার্ডের নিয়ম মানে না",
  SAFEGUARDING_REPORT: "সুরক্ষা-প্রশ্ন খোলা আছে",
} as const;
export type SupportImportReason = keyof typeof SUPPORT_IMPORT_REASONS;

/** The card footer (S-4, §9.1). */
export const SUPPORT_CARD_FOOTER_BN = "রোগ নির্ণয় নয় · শাস্তির জন্য নয় · গোপনীয় — শুধু এই শিক্ষার্থীর বর্তমান শিক্ষকদের জন্য";
/** The push preview of every support/safeguarding notice: no name, no detail (§9.7). */
export const SUPPORT_PUSH_PREVIEW_BN = "শিক্ষার্থী সহায়তা: নতুন বার্তা";

