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
 *  draft so a bad batch is traceable to the prompt that produced it. */
export const MONTHLY_COMMENT_PROMPT_VERSION = "mr4-1";

// ---------------------------------------------------------------------------
// The facts — de-identified by construction
// ---------------------------------------------------------------------------

export interface CommentFacts {
  periodKey: string;
  classLevel: number | null;
  attendance: { present: number; schoolDays: number; ratePct: number | null; trend: string; classAvgPct: number | null };
  homework: { submittedOf: number; expected: number; ratePct: number | null; qualityPct: number | null; trend: string };
  assignment: { submittedOf: number; expected: number; ratePct: number | null; trend: string };
  classTest: { attended: number; held: number; ratePct: number | null; trend: string };
  hifz: { attended: number; sessions: number };
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
export function commentFactsOf(snapshot: MonthlySnapshot, classLevel: number | null): CommentFacts {
  const m = snapshot.metrics;
  const bySubject = [...m.homework.bySubject].filter((s) => s.qualityRate != null);
  const ranked = bySubject.sort((a, b) => (b.qualityRate ?? 0) - (a.qualityRate ?? 0));

  return {
    periodKey: m.periodKey,
    classLevel,
    attendance: {
      present: m.attendance.present,
      schoolDays: m.attendance.schoolDays,
      ratePct: m.attendance.rate,
      trend: snapshot.trends.attendance.state,
      classAvgPct: snapshot.cohort?.attendanceRate.avg ?? null,
    },
    homework: {
      submittedOf: m.homework.submitted,
      expected: m.homework.expectedWhilePresent,
      ratePct: m.homework.submissionRate,
      qualityPct: m.homework.qualityRate,
      trend: snapshot.trends.homeworkSubmission.state,
    },
    assignment: {
      submittedOf: m.assignment.submitted,
      expected: m.assignment.expectedWhilePresent,
      ratePct: m.assignment.submissionRate,
      trend: snapshot.trends.assignmentSubmission.state,
    },
    classTest: {
      attended: m.classTest.attended,
      held: m.classTest.testsHeld,
      ratePct: m.classTest.rate,
      trend: snapshot.trends.classTest.state,
    },
    hifz: { attended: m.hifz.present, sessions: m.hifz.sessions },
    concerns: { count: m.concerns.concern, trend: snapshot.trends.concerns.state },
    strongestSubjects: ranked.slice(0, 2).map((s) => s.subject),
    weakestSubjects: ranked.slice(-2).reverse().map((s) => s.subject),
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
    else if (Array.isArray(v)) v.forEach(walk);
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

/** PURE. The instruction half — pinned here so `promptVersion` means something. */
export function buildPrompt(facts: CommentFacts): string {
  const rules = [
    "তুমি একটি স্কুলের মাসিক অগ্রগতি রিপোর্টের জন্য অভিভাবকের উদ্দেশ্যে একটি অনুচ্ছেদ লিখবে।",
    "নিয়ম:",
    "১. শুধু নিচের JSON তথ্য ব্যবহার করো। কোনো নতুন সংখ্যা লিখবে না।",
    "২. ২–৪ বাক্য। সম্মানজনক বাংলা।",
    "৩. ঠিক একটি করণীয় পরামর্শ দাও, যা বাড়িতে করা সম্ভব।",
    "৪. অন্য কোনো শিক্ষার্থীর সঙ্গে তুলনা করবে না, কারও নাম লিখবে না।",
    "৫. কোনো রোগ/সমস্যা নির্ণয় করবে না, পরিবার নিয়ে অনুমান করবে না।",
    "৬. flags-এ SERIOUS_MATTER থাকলে বিষয়টি বর্ণনা করবে না — শুধু লিখবে যে শ্রেণি শিক্ষক যোগাযোগ করবেন।",
    "৭. provisional true হলে বোঝাবে যে কিছু তথ্য এখনো আসেনি।",
    "৮. শিক্ষার্থীর নাম নেই — নাম ছাড়াই লেখো (\"আপনার সন্তান\")।",
  ].join("\n");
  return `${rules}\n\nJSON:\n${JSON.stringify(facts)}`;
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
  const attempts = opts.attempts ?? 2;
  let lastReason = "Generation failed";

  for (let i = 0; i < attempts; i++) {
    try {
      const text = (await provider.generate(prompt)).trim();
      const verdict = validateNumerals(text, facts);
      if (!verdict.ok) {
        lastReason = `The draft invented numbers not in the report: ${verdict.invented.join(", ")}`;
        continue;
      }
      const shape = looksLikeProse(text);
      if (!shape.ok) {
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
