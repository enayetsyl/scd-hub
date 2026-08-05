/**
 * MonthlyCommentService (MR-4, prd-monthly-report §7.4, D-#399) — the ONE generated
 * paragraph a guardian reads, and the guards that make it safe to send.
 *
 * Four rules, each enforced here rather than trusted to a prompt:
 *
 *   1. THE PROMPT IS DE-IDENTIFIED. The model receives numbers, subject codes, class
 *      level and trend states — never the child's name, school id, guardian name or
 *      phone. The name is spliced in locally at render. So whatever provider or tier
 *      is in use, no identity leaves the building.
 *   2. THE MODEL NEVER AUTHORS A NUMBER. Facts go in as JSON; a validator rejects any
 *      output containing a numeral that is not in those facts. Hallucinated statistics
 *      in a guardian's hand are the reputational failure mode of this whole feature.
 *   3. IT NEVER BLOCKS. One retry, then the MessageTemplate fallback (MT-1, D-#131).
 *      An unreachable API must never stop a month being reported.
 *   4. A HUMAN REVIEWS IT. This service only ever writes `commentDraft`; nothing here
 *      can set `commentFinal` (MR-3 owns that, and release refuses without it).
 *
 * The provider is a one-method seam (architecture.md §14 parks exactly this). v1
 * targets Gemini Flash via GEMINI_API_KEY; swapping providers is a config change.
 */
import { createHash } from "crypto";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import type { MonthlySnapshot } from "./MonthlyReportService";

/** Bumped whenever the prompt's wording or the facts' shape changes — stored on every
 *  draft so a bad batch is traceable to the prompt that produced it. Bumped to mr4-3
 *  (2026-08-05): correct/partial/wrong now reach the model (a low qualityPct alone
 *  cannot distinguish "mostly partial credit" from "mostly wrong"), hifz is dropped
 *  from the whitelist (it was never in the comment's scope — rule 2 named five areas
 *  and hifz was not one of them, yet the model could see it and reported on it
 *  anyway), and three new rules fix real defects in a live draft: mixed Bengali/Latin
 *  numerals, an inconsistent count phrasing ("৭টির সব" vs "২২-এর মধ্যে ১৯"), and the
 *  closed-area list not actually being enforced. Bumped again to mr4-4 (2026-08-05,
 *  same day): the attendance benchmark is now the section's BEST rate, not its
 *  average (`classAvgPct` renamed `classBestPct`, sourced from `.best` not `.avg`);
 *  a zero count inside the correct/partial/wrong breakdown is no longer spelled out
 *  ("০টি আংশিক সঠিক" reads as noise, not information — only the non-zero ones are
 *  worth a sentence); and the uncovered-absence wording is pinned to "X দিনের ছুটির
 *  দরখাস্ত জমা দেওয়া হয়নি" (a leave application wasn't filed) rather than the
 *  vaguer "কভার তথ্য নেই" ("no cover info") a live draft used — the fixed wording
 *  tells a guardian what to actually DO, not just that a system field is empty. */
export const MONTHLY_COMMENT_PROMPT_VERSION = "mr4-4";

// ---------------------------------------------------------------------------
// The facts — de-identified by construction
// ---------------------------------------------------------------------------

/** One subject's row in a tracker — subject CODE only, never a label a teacher wrote,
 *  so `assertDeidentified`'s all-caps-code rule keeps holding it to account.
 *  `correct`/`partial`/`wrong` added 2026-08-05: `qualityPct` alone is
 *  `correct / (correct + partial + wrong)`, so a child who scored mostly PARTIAL
 *  credit reads identically to one who scored mostly WRONG — a live draft reported a
 *  flat "১১%" for a subject where most checked work was actually partial credit. */
export interface SubjectQualityFact {
  subject: string;
  submittedOf: number;
  expected: number;
  checked: number;
  correct: number;
  partial: number;
  wrong: number;
  qualityPct: number | null;
}

export interface CommentFacts {
  periodKey: string;
  classLevel: number | null;
  attendance: {
    present: number;
    schoolDays: number;
    ratePct: number | null;
    trend: string;
    /** The section's BEST attendance rate, not its average (owner ask, 2026-08-05:
     *  a highest is a more legible benchmark than a mean). Null when the section is
     *  too small to hide who it is (D-#396, `bestWithheld`) — the rules never ask for
     *  a number that isn't there. */
    classBestPct: number | null;
    /** Absences NOT covered by an approved leave (the ABSENT_UNCOVERED flag's own
     *  count). Added 2026-08-05: previously only the flag's NAME reached the model,
     *  never this number, so a comment could gesture at it but never cite it. */
    absentUncovered: number;
  };
  homework: {
    submittedOf: number;
    expected: number;
    ratePct: number | null;
    qualityPct: number | null;
    checked: number;
    correct: number;
    partial: number;
    wrong: number;
    trend: string;
    /** Added 2026-08-05 so a full summary can name each subject's own numbers, not
     *  just which one ranks strongest/weakest. */
    bySubject: SubjectQualityFact[];
  };
  assignment: {
    submittedOf: number;
    expected: number;
    ratePct: number | null;
    checked: number;
    correct: number;
    partial: number;
    wrong: number;
    trend: string;
    bySubject: SubjectQualityFact[];
  };
  classTest: { attended: number; held: number; ratePct: number | null; trend: string };
  concerns: { count: number; trend: string };
  /** Subject codes only — never a teacher's or a peer's name. */
  strongestSubjects: string[];
  weakestSubjects: string[];
  flags: string[];
  /** True when a stream is below the coverage gate: the model must hedge, not report. */
  provisional: boolean;
}

/**
 * PURE. Snapshot → the facts the model is allowed to see.
 *
 * This function is the privacy boundary. It is deliberately a WHITELIST — it builds a
 * fresh object rather than deleting fields from the snapshot, so a field added to the
 * snapshot later cannot leak by default.
 */
/** PURE. Split ranked subjects into strongest / weakest so that NO SUBJECT IS IN BOTH.
 *
 *  The first version took `slice(0,2)` and `slice(-2)`, which overlap whenever there
 *  are three subjects or fewer — and three is what Nursery and KG have. The model was
 *  handed MATH as a strength and a weakness at once and faithfully wrote both, so a
 *  live report told a family their child was improving in maths and needed to
 *  concentrate on maths in the same sentence.
 *
 *  With three subjects or fewer it names ONE of each: ranking three items into 2+2
 *  says almost nothing anyway. */
export function splitSubjects(ranked: readonly string[]): { strongest: string[]; weakest: string[] } {
  if (ranked.length < 2) return { strongest: [...ranked], weakest: [] };
  const take = ranked.length <= 3 ? 1 : 2;
  const strongest = ranked.slice(0, take);
  // The weakest are drawn from what is LEFT, so the two lists are disjoint by
  // construction rather than by luck.
  const rest = ranked.slice(take);
  const weakest = rest.slice(-take).reverse();
  return { strongest, weakest };
}

/** PURE. A tracker's `bySubject` rows → the shape the model may see — subject code,
 *  submitted/expected, the correct/partial/wrong breakdown, and the blended quality
 *  rate. Unfiltered (unlike the ranking below): a subject nothing has been checked in
 *  yet still deserves a mention. */
function subjectFactsOf(
  rows: readonly {
    subject: string;
    submitted: number;
    expectedWhilePresent: number;
    checked: number;
    correct: number;
    partial: number;
    wrong: number;
    qualityRate: number | null;
  }[],
): SubjectQualityFact[] {
  return rows.map((r) => ({
    subject: r.subject,
    submittedOf: r.submitted,
    expected: r.expectedWhilePresent,
    checked: r.checked,
    correct: r.correct,
    partial: r.partial,
    wrong: r.wrong,
    qualityPct: r.qualityRate,
  }));
}

export function commentFactsOf(snapshot: MonthlySnapshot, classLevel: number | null): CommentFacts {
  const m = snapshot.metrics;
  const bySubject = [...m.homework.bySubject].filter((s) => s.qualityRate != null);
  const ranked = bySubject.sort((a, b) => (b.qualityRate ?? 0) - (a.qualityRate ?? 0));
  const split = splitSubjects(ranked.map((s) => s.subject));

  return {
    periodKey: m.periodKey,
    classLevel,
    attendance: {
      present: m.attendance.present,
      schoolDays: m.attendance.schoolDays,
      ratePct: m.attendance.rate,
      trend: snapshot.trends.attendance.state,
      classBestPct: snapshot.cohort?.attendanceRate.best ?? null,
      absentUncovered: m.attendance.absentUncovered,
    },
    homework: {
      submittedOf: m.homework.submitted,
      expected: m.homework.expectedWhilePresent,
      ratePct: m.homework.submissionRate,
      qualityPct: m.homework.qualityRate,
      checked: m.homework.checked,
      correct: m.homework.correct,
      partial: m.homework.partial,
      wrong: m.homework.wrong,
      trend: snapshot.trends.homeworkSubmission.state,
      bySubject: subjectFactsOf(m.homework.bySubject),
    },
    assignment: {
      submittedOf: m.assignment.submitted,
      expected: m.assignment.expectedWhilePresent,
      ratePct: m.assignment.submissionRate,
      checked: m.assignment.checked,
      correct: m.assignment.correct,
      partial: m.assignment.partial,
      wrong: m.assignment.wrong,
      trend: snapshot.trends.assignmentSubmission.state,
      bySubject: subjectFactsOf(m.assignment.bySubject),
    },
    classTest: {
      attended: m.classTest.attended,
      held: m.classTest.testsHeld,
      ratePct: m.classTest.rate,
      trend: snapshot.trends.classTest.state,
    },
    concerns: { count: m.concerns.concern, trend: snapshot.trends.concerns.state },
    strongestSubjects: split.strongest,
    weakestSubjects: split.weakest,
    flags: snapshot.flags.map((f) => f.flag),
    provisional:
      [m.homework.coverage.pct, m.assignment.coverage.pct, m.classTest.coverage.pct].some(
        (p) => p != null && p < snapshot.config.coverageGatePct,
      ),
  };
}

/** PURE. Belt-and-braces on the whitelist: no facts object may carry a value that
 *  looks like a name, an id or a phone number. Called before every send. */
export function assertDeidentified(facts: CommentFacts): void {
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") {
      // Subject codes and enum states are ALL-CAPS ASCII; anything else in a string
      // slot (a Bangla name, a phone, a school id) is not something we send out.
      if (!/^[A-Z0-9_]+$/.test(v) && !/^\d{4}-\d{2}$/.test(v)) {
        throw new MonthlyCommentError(`Refusing to send a non-code string to the model at ${path}: ${v}`);
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    }
  };
  walk(facts, "facts");
}

export class MonthlyCommentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonthlyCommentError";
  }
}

// ---------------------------------------------------------------------------
// The numeral guard
// ---------------------------------------------------------------------------

const BN_DIGIT_MAP: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

/** PURE. Bangla numerals normalised to ASCII so the check works on either script. */
export function asciiDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => BN_DIGIT_MAP[d] ?? d);
}

/** PURE. Every number that appears anywhere in the facts, as strings. Percentages
 *  are also admitted rounded, because "৮২%" is a fair rendering of 82.4. */
export function allowedNumbers(facts: CommentFacts): Set<string> {
  const out = new Set<string>();
  const add = (n: number): void => {
    out.add(String(n));
    out.add(String(Math.round(n)));
    out.add(String(Math.trunc(n)));
  };
  const walk = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v)) add(v);
    else if (Array.isArray(v)) {
      // "তিনটি বিষয়ে" when three subject codes were supplied is TRUE — it counts what
      // the model was given. Rejecting it made the guard fire on honest prose, which
      // is how a real draft was thrown away for the number 3.
      add(v.length);
      v.forEach(walk);
    }
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
    else if (typeof v === "string") {
      for (const m of v.matchAll(/\d+/g)) out.add(m[0]);
    }
  };
  walk(facts);
  return out;
}

/** PURE. Does this read like a finished Bangla paragraph, or like debris?
 *
 *  The first live drafts came back as `4, \`expected\`: 8, \`ratePct\`: 50` — the tail of
 *  the model's own reasoning over the facts JSON, truncated. The numeral guard passed
 *  it (every figure WAS in the facts), which is exactly why a second, structural check
 *  is needed: the numbers being real does not make the text a sentence. */
export function looksLikeProse(text: string): { ok: boolean; reason: string | null } {
  const t = text.trim();
  if (t.length < 40) return { ok: false, reason: "the draft is too short to be a paragraph" };
  // JSON debris: quoted keys, backticked identifiers, brace/bracket noise.
  if (/["\`][a-zA-Z_]+["\`]\s*:/.test(t) || /[{}[\]]/.test(t)) {
    return { ok: false, reason: "the draft contains JSON fragments, not prose" };
  }
  // A finished Bangla sentence ends in a danda (or a full stop / question mark).
  if (!/[।.?!]\s*$/.test(t)) return { ok: false, reason: "the draft ends mid-sentence" };
  return { ok: true, reason: null };
}

export interface NumeralVerdict {
  ok: boolean;
  /** The numbers the model produced that are in no fact — the reason for rejection. */
  invented: string[];
}

/**
 * PURE. THE GUARD (D-#399): the model may only restate numbers it was given.
 *
 * A draft that invents "১৫টি বাড়ির কাজ" out of nothing is rejected and regenerated;
 * two failures fall back to the template. This is cheap, total, and catches the one
 * class of error a guardian would never be able to detect.
 */
export function validateNumerals(text: string, facts: CommentFacts): NumeralVerdict {
  const allowed = allowedNumbers(facts);
  const invented = [...new Set([...asciiDigits(text).matchAll(/\d+/g)].map((m) => m[0]))].filter(
    (n) => !allowed.has(n) && !allowed.has(String(Number(n))),
  );
  return { ok: invented.length === 0, invented };
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/** PURE. What to send on a RETRY after a draft was refused.
 *
 *  Re-sending the identical prompt was not a retry at all: same input, same settings,
 *  so the model reproduced the same violation and the second failure was near
 *  guaranteed — every rejection became a template fallback. Naming the offending
 *  numbers gives it something to correct. */
export function correctivePrompt(base: string, invented: readonly string[], shapeProblem: string | null): string {
  const notes: string[] = ["পূর্বের খসড়াটি গ্রহণ করা হয়নি। আবার লেখো, এই সংশোধনসহ:"];
  if (invented.length > 0) {
    notes.push(
      `- এই সংখ্যাগুলো JSON-এ নেই, তাই লিখবে না: ${invented.join(", ")}। সংখ্যা ছাড়া বাক্যটি লেখো অথবা JSON-এর সংখ্যা ব্যবহার করো।`,
    );
  }
  if (shapeProblem) notes.push("- সম্পূর্ণ অনুচ্ছেদ লেখো, দাঁড়ি দিয়ে শেষ করো। কোনো JSON বা কোড লিখবে না।");
  return `${base}\n\n${notes.join("\n")}`;
}

const BN_MONTHS = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

/** PURE. `2026-07` → `জুলাই ২০২৬`. Lives in the PROMPT, never in the facts: the facts
 *  are a code-only whitelist and a Bangla month name would (rightly) trip the
 *  de-identification assertion. */
export function monthLabelBn(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  const name = BN_MONTHS[(m ?? 1) - 1] ?? periodKey;
  const year = String(y ?? "").replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
  return `${name} ${year}`;
}

/**
 * PURE. The rules half, on its own — because MR-8's Desktop export must carry the
 * SAME instructions as the in-app prompt (§8b.1). Two copies of these rules would
 * drift within a month and the two lanes would quietly start writing different
 * paragraphs; there is therefore exactly one copy, and both lanes read it.
 */
export function commentRules(periodKey: string): string {
  return [
    "তুমি একটি স্কুলের মাসিক অগ্রগতি রিপোর্টের জন্য অভিভাবকের উদ্দেশ্যে একটি পূর্ণাঙ্গ সারসংক্ষেপ লিখবে।",
    "নিয়ম:",
    "১. শুধু নিচের JSON তথ্য ব্যবহার করো। কোনো নতুন সংখ্যা লিখবে না।",
    "২. তথ্যে ঠিক এই বিষয়গুলো আছে — উপস্থিতি, বাড়ির কাজ, অ্যাসাইনমেন্ট, ক্লাস টেস্ট, অভিযোগ। প্রতিটি ছুঁয়ে যাও, যেন শুধু এই লেখাটি পড়েই অভিভাবক প্রতিটি বিষয়ের পূর্ণ চিত্র বুঝতে পারেন — আলাদা টেবিল না দেখেও। কোনো বিষয়ে করার মতো কিছু না থাকলে (যেমন কোনো ক্লাস টেস্ট হয়নি) সেটাও সংক্ষেপে বলো, বাদ দিয়ো না। এই পাঁচটি ছাড়া অন্য কিছু (JSON-এ থাকলেও) উল্লেখ করবে না — এই সারসংক্ষেপের আওতায় শুধু এগুলোই।",
    "৩. প্রতিটি বিষয় ১–২ বাক্যে বলো। সম্মানজনক, সহজ বাংলা।",
    "৪. ঠিক একটি করণীয় পরামর্শ দাও, যা বাড়িতে করা সম্ভব — যে বিষয়টি সবচেয়ে দুর্বল, তার সঙ্গে সম্পর্কিত।",
    "৫. অন্য কোনো শিক্ষার্থীর সঙ্গে তুলনা করবে না, কারও নাম লিখবে না। শ্রেণির সর্বোচ্চ উপস্থিতির হার (classBestPct) উল্লেখ করা যাবে — এটি নাম ছাড়া একটি সংখ্যামাত্র। classBestPct না থাকলে (null) সেটা নিয়ে কিছু লিখবে না।",
    "৬. কোনো রোগ/সমস্যা নির্ণয় করবে না, পরিবার নিয়ে অনুমান করবে না।",
    "৭. flags-এ SERIOUS_MATTER থাকলে বিষয়টি বর্ণনা করবে না — শুধু লিখবে যে শ্রেণি শিক্ষক যোগাযোগ করবেন।",
    "৮. অভিযোগের (concerns) কথা লিখলে 'উদ্বেগ' শব্দটি ব্যবহার করবে না — 'অভিযোগ' লেখো (যেমন, সংখ্যা ০ হলে: \"এই মাসে কোনো অভিযোগ লেখা হয়নি\")।",
    "৯. ছুটি ছাড়া অনুপস্থিতি (absentUncovered) নিয়ে লিখলে এভাবে লেখো: \"X দিনের ছুটির দরখাস্ত জমা দেওয়া হয়নি\" — \"কভার তথ্য নেই\" বা এই ধরনের অস্পষ্ট/প্রযুক্তিগত কথা লিখবে না, কারণ এটি অভিভাবকের করণীয়কে স্পষ্ট করে না।",
    "১০. কোনো সংখ্যা (কতটি/কতজন) বললে সবসময় \"X-এর মধ্যে Y\" এই প্যাটার্নে লেখো (যেমন: \"২৭টির মধ্যে ২৫টি জমা হয়েছে\"), এমনকি সবগুলো হলেও (যেমন: \"৭টির মধ্যে ৭টি\")। কখনো \"৭টির সব\"-এর মতো এলোমেলো বাক্যগঠন লিখবে না।",
    "১১. মান (quality) নিয়ে লিখলে শুধু একটা % বলে থেমো না — correct, partial ও wrong সংখ্যাগুলো দেখে লেখো। partial (আংশিক সঠিক) থাকলে সেগুলোকে সম্পূর্ণ ভুল হিসেবে দেখিও না — যেমন: \"৯টি যাচাই হওয়া কাজের মধ্যে ১টি সম্পূর্ণ সঠিক ও ৩টি আংশিক সঠিক হয়েছে, বাকিগুলো ভুল\"। শুধু \"মান ১১%\" লিখলে বোঝা যায় না যে কিছু আংশিক সঠিক ছিল। এই তিনটির (correct/partial/wrong) মধ্যে যেটির সংখ্যা ০, সেটি আলাদা করে উল্লেখ করবে না — শুধু যেগুলোতে সংখ্যা আছে সেগুলো বলো (যেমন partial ০ হলে \"০টি আংশিক সঠিক\" লিখবে না, শুধু correct ও wrong বলো)।",
    "১২. সব সংখ্যা বাংলা অঙ্কে লেখো (০, ১, ২, ৩...) — ইংরেজি সংখ্যা (0, 1, 2, 3...) কখনো ব্যবহার করবে না। % সবসময় পূর্ণ সংখ্যায় রাউন্ড করে লেখো (যেমন ৯৩%) — দশমিক (৯২.৬%) লিখবে না।",
    "১৩. provisional true হলে বোঝাবে যে কিছু তথ্য এখনো আসেনি।",
    "১৪. শিক্ষার্থীর নাম নেই — নাম ছাড়াই লেখো (\"আপনার সন্তান\")।",
    `১৫. এই রিপোর্টটি ${monthLabelBn(periodKey)} মাসের। মাসের নাম উল্লেখ করো — "গত মাস" বা "বিগত মাস" লিখবে না।`,
  ].join("\n");
}

/** PURE. The instruction half — pinned here so `promptVersion` means something. */
export function buildPrompt(facts: CommentFacts): string {
  return `${commentRules(facts.periodKey)}\n\nJSON:\n${JSON.stringify(facts)}`;
}

export function promptHashOf(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// The provider seam
// ---------------------------------------------------------------------------

export interface CommentProvider {
  /** Model identifier stored on the draft. */
  readonly model: string;
  generate(prompt: string): Promise<string>;
}

/**
 * Gemini Flash over the public REST endpoint. No SDK dependency — one fetch, so the
 * seam stays swappable and the server gains no vendor package.
 *
 * The key lives in `.env` (never committed). With no key configured this constructor
 * is never reached: `providerFromEnv()` returns null and the caller uses the template.
 */
export class GeminiCommentProvider implements CommentProvider {
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model = "gemini-flash-latest") {
    this.apiKey = apiKey;
    this.model = model;
  }

  /** Set from the response: the alias resolves to a dated model, and THAT is what
   *  a bad batch has to be traceable to. */
  resolvedModel: string | null = null;

  async generate(prompt: string): Promise<string> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // maxOutputTokens has to cover the model's REASONING as well as its answer.
          // At 400 the live gemini-3.6-flash spent 382 tokens thinking and emitted 14,
          // so every draft came back cut off mid-sentence and the console showed a
          // fragment. Thinking cannot be switched off on this model (thinkingBudget: 0
          // is refused), so the budget is simply big enough for both.
          generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
        }),
      },
    );
    if (!res.ok) throw new MonthlyCommentError(`Gemini returned ${res.status}`);
    const body = (await res.json()) as {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }>;
      modelVersion?: string;
    };
    if (body.modelVersion) this.resolvedModel = body.modelVersion;

    const candidate = body.candidates?.[0];
    // Only STOP means the model finished its sentence. MAX_TOKENS (and SAFETY, and
    // the rest) leave a fragment, and a fragment must never reach a guardian — it is
    // rejected here so the retry-then-template path handles it like any other failure.
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      throw new MonthlyCommentError(`Gemini stopped early (${candidate.finishReason}) — the reply was cut off`);
    }
    // A thinking model returns its reasoning as parts flagged `thought`; those are
    // NOT the answer and must never be shown to anyone.
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) throw new MonthlyCommentError("Gemini returned no text");
    return text;
  }
}

/** Null when no key is configured — the caller falls back, it does not fail. */
export function providerFromEnv(): CommentProvider | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GeminiCommentProvider(key, process.env.GEMINI_MODEL || undefined);
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export interface GeneratedComment {
  text: string;
  model: string;
  promptVersion: string;
  promptHash: string;
  generatedAt: Date;
  fallback: boolean;
  /** Why the fallback was used, when it was — surfaced to the reviewer. */
  fallbackReason: string | null;
}

/** The deterministic paragraph, rendered from the MT-1 registry (D-#131) — never an
 *  inline string, so the Principal can reword it without a deploy. */
export async function fallbackComment(facts: CommentFacts, reason: string): Promise<GeneratedComment> {
  const text = await renderTemplate("monthly_report.comment.fallback", {
    month: facts.periodKey,
    attendanceRate: facts.attendance.ratePct == null ? "—" : String(Math.round(facts.attendance.ratePct)),
    homeworkRate: facts.homework.ratePct == null ? "—" : String(Math.round(facts.homework.ratePct)),
  });
  return {
    text,
    model: "template",
    promptVersion: MONTHLY_COMMENT_PROMPT_VERSION,
    promptHash: "-",
    generatedAt: new Date(),
    fallback: true,
    fallbackReason: reason,
  };
}

/**
 * One paragraph, with the retry and the fallback wired in.
 *
 * Order matters: de-identification is asserted BEFORE the first call, so a leak can
 * never reach the provider even once.
 */
export async function generateGuardianComment(
  facts: CommentFacts,
  provider: CommentProvider | null,
  opts: { attempts?: number } = {},
): Promise<GeneratedComment> {
  assertDeidentified(facts);
  if (!provider) return fallbackComment(facts, "No AI provider configured");

  const prompt = buildPrompt(facts);
  const promptHash = promptHashOf(prompt);
  // Three, because the first correction is the one most likely to land.
  const attempts = opts.attempts ?? 3;
  let lastReason = "Generation failed";
  let invented: string[] = [];
  let shapeProblem: string | null = null;

  for (let i = 0; i < attempts; i++) {
    try {
      const ask = i === 0 ? prompt : correctivePrompt(prompt, invented, shapeProblem);
      const text = (await provider.generate(ask)).trim();
      const verdict = validateNumerals(text, facts);
      if (!verdict.ok) {
        invented = verdict.invented;
        shapeProblem = null;
        lastReason = `The draft invented numbers not in the report: ${verdict.invented.join(", ")}`;
        continue;
      }
      const shape = looksLikeProse(text);
      if (!shape.ok) {
        invented = [];
        shapeProblem = shape.reason;
        lastReason = shape.reason ?? "The draft did not read as a paragraph";
        continue;
      }
      return {
        text,
        model: (provider as { resolvedModel?: string | null }).resolvedModel || provider.model,
        promptVersion: MONTHLY_COMMENT_PROMPT_VERSION,
        promptHash,
        generatedAt: new Date(),
        fallback: false,
        fallbackReason: null,
      };
    } catch (err) {
      lastReason = err instanceof Error ? err.message : "Generation failed";
    }
  }

  // A silent fallback is undiagnosable from the outside — this feature fell back in
  // prod for a retired model id and left NOTHING in the log to say so.
  console.error(`[MonthlyComment] falling back to the template: ${lastReason}`);
  return fallbackComment(facts, lastReason);
}
