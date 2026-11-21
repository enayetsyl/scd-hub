/**
 * reportDraft — Gemini writes the bug report (TB-1, D-#1666).
 *
 * Input: the reporter's voice note(s) (inline audio), up to 3 screenshots (inline), any typed text,
 * and — for a correction — the previous draft plus what they said is wrong. Output: strict JSON
 * {title, screen, whatHappened, expected, steps[], severity, transcript} in plain Bangla.
 * The model chain is BOT_GEMINI_MODEL then BOT_GEMINI_FALLBACK_MODEL (429 / 503 / 404 / 5xx → next).
 * Bad JSON gets one local repair, then one "rewrite as valid JSON" re-ask, then a clear Bangla error.
 * Every call is metered (feature `telegram_bot`) by the Gemini seam; the monthly cap is checked first.
 */
import type { ReportDraft } from "../models/TelegramReport";
import { TelegramBotError, TelegramHttpError, env, telegramDeps, type GeminiPart } from "./telegramDeps";

export const MAX_PHOTOS = 5;
export const PHOTOS_TO_MODEL = 3;
const RETRY_STATUSES = new Set([404, 429, 500, 502, 503, 504]);

export const REPORT_SYSTEM_PROMPT =
  "You help a school's staff report a problem with the school-management app. You get a voice note and/or text " +
  "and sometimes screenshots. Write the report in simple, plain Bangla (Bangla script). Do not invent facts; " +
  "if something is unknown write an empty string. Reply with ONE JSON object and nothing else, keys exactly: " +
  '"title" (short, one line), "screen" (which app screen/page, if said or visible), "whatHappened", "expected" ' +
  '(what they expected instead), "steps" (array of short strings: how to reproduce), "severity" ("low" | "medium" | ' +
  '"high"), "transcript" (the voice note word for word, in the language spoken; empty if there was no voice). ' +
  "If a previous draft and a correction are given, apply the correction to the draft and return the full new report.";

export interface DraftInput {
  voices: Array<{ mime: string; data: string }>;
  photos: Array<{ mime: string; data: string }>;
  texts: string[];
  previous?: ReportDraft | null;
  correctionText?: string;
  refId?: string;
}

export interface DraftResult {
  draft: ReportDraft;
  transcript: string;
}

const SEVERITIES = ["low", "medium", "high"] as const;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Parse + normalise model output. Null when it is not a usable report. Exported for tests. */
export function parseDraft(raw: string): DraftResult | null {
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  s = s.slice(a, b + 1);
  let obj: Record<string, unknown> | null = null;
  for (const candidate of [s, s.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        obj = v as Record<string, unknown>;
        break;
      }
    } catch {
      /* try the repaired text next */
    }
  }
  if (!obj) return null;
  const title = str(obj.title, 140);
  const whatHappened = str(obj.whatHappened ?? obj.what_happened, 3000);
  if (!title || !whatHappened) return null;
  const sev = str(obj.severity, 12).toLowerCase();
  const steps = Array.isArray(obj.steps) ? obj.steps.map((x) => str(x, 300)).filter(Boolean).slice(0, 12) : [];
  return {
    draft: {
      title,
      screen: str(obj.screen, 200),
      whatHappened,
      expected: str(obj.expected, 2000),
      steps,
      severity: (SEVERITIES as readonly string[]).includes(sev) ? (sev as ReportDraft["severity"]) : "medium",
    },
    transcript: str(obj.transcript, 8000),
  };
}

function buildParts(input: DraftInput): GeminiPart[] {
  const parts: GeminiPart[] = [];
  const lines: string[] = [];
  if (input.previous) {
    lines.push("Previous draft (JSON): " + JSON.stringify(input.previous));
    lines.push("Correction from the reporter: " + (input.correctionText ?? "(see the voice note)"));
  } else if (input.texts.length) {
    lines.push("Reporter's text:\n" + input.texts.join("\n"));
  }
  if (!lines.length && !input.voices.length) lines.push("(no text)");
  if (lines.length) parts.push({ text: lines.join("\n\n") });
  for (const v of input.voices) parts.push({ mime: v.mime, data: v.data });
  for (const p of input.photos.slice(0, PHOTOS_TO_MODEL)) parts.push({ mime: p.mime, data: p.data });
  return parts;
}

/** Checked before EACH Gemini call: the owner's switch, the bot's cap, the school budget. */
async function assertAllowed(): Promise<void> {
  const a = await telegramDeps().gemini.allowance();
  if (a === "off") throw new TelegramBotError("রিপোর্ট লেখার সুবিধাটি এখন বন্ধ আছে।");
  if (a === "cap") throw new TelegramBotError("এ মাসের এআই সীমা শেষ — প্রধান শিক্ষককে জানান বা পরে চেষ্টা করুন।");
}

/** One model attempt with a single re-ask for bad JSON. Throws TelegramHttpError on a refusal status. */
async function tryModel(model: string, input: DraftInput): Promise<DraftResult | null> {
  const { gemini } = telegramDeps();
  await assertAllowed();
  const raw = await gemini.generate({ model, system: REPORT_SYSTEM_PROMPT, parts: buildParts(input), refId: input.refId });
  const first = parseDraft(raw);
  if (first) return first;
  await assertAllowed();
  const again = await gemini.generate({
    model,
    system: REPORT_SYSTEM_PROMPT,
    parts: [{ text: "Your last answer was not valid JSON for the report. Rewrite it as ONE valid JSON object with the exact keys. Last answer:\n" + raw.slice(0, 6000) }],
    refId: input.refId,
  });
  return parseDraft(again);
}

export async function draftReport(input: DraftInput): Promise<DraftResult> {
  if (!env.geminiKey()) throw new TelegramBotError("রিপোর্ট লেখার সুবিধাটি এখনো চালু হয়নি।");
  await assertAllowed(); // fail early with the right sentence; each call below checks again
  const models = [env.geminiModel(), env.geminiFallback()].filter((m, i, a) => m && a.indexOf(m) === i);
  let sawBadJson = false;
  for (const model of models) {
    try {
      const out = await tryModel(model, input);
      if (out) return out;
      sawBadJson = true;
    } catch (err) {
      if (err instanceof TelegramHttpError && RETRY_STATUSES.has(err.status)) continue;
      throw err;
    }
  }
  throw new TelegramBotError(
    sawBadJson ? "রিপোর্টটি ঠিকমতো লিখতে পারিনি। আবার ভয়েস নোট বা লেখা পাঠান।" : "এখন রিপোর্ট লিখতে পারছি না (এআই ব্যস্ত)। একটু পরে আবার পাঠান।",
  );
}
