/**
 * Voice tasks (VT-1, D-#960–#965) — the PURE half: the prompt, the JSON schema the model
 * must answer in, and `buildDraft`, which turns the model's reply into cards the app shows.
 * No database, no network: every rule here is tested without either.
 *
 * The model proposes; this file decides. It never trusts the model's assignee on its own
 * (D-#962 name guard), never invents a due date (D-#963: an unsaid date stays empty and
 * the card asks), and only lets a recurring pattern through when it is complete (D-#964).
 */
import { DAY_SLOTS, TASK_PRIORITIES, TASK_RECURRENCES } from "@scd/shared";
import type { DaySlot, TaskPriority, TaskRecurrence } from "@scd/shared";
import { isValidDateKey, parseDateKey } from "../../attendance/dates";

/** One person the speaker may give a task to (the caller alone without work_board:assign). */
export interface VoiceStaff {
  userId: string;
  name: string;
  nameBn: string | null;
  designation: string | null;
}

export type VoiceRecurrence = "ONCE" | TaskRecurrence;

/** The model's answer, before any check. Every field may be missing or wrong. */
export interface RawVoiceTask {
  assigneeUserId?: string | null;
  assigneeSaid?: string | null;
  assigneeSaidLatin?: string | null;
  titleBn?: string | null;
  notes?: string | null;
  dueKey?: string | null;
  slot?: string | null;
  priority?: string | null;
  effortMin?: number | null;
  recurrence?: string | null;
  weekdays?: number[] | null;
  monthDay?: number | null;
  weekOfMonth?: number | null;
  endKey?: string | null;
}

export interface RawVoiceReply {
  transcript?: string | null;
  transcriptLatin?: string | null;
  tasks?: RawVoiceTask[] | null;
  warnings?: string[] | null;
}

/** Fields the server filled because the speaker did not say them (shown with ⚠️). */
export type DefaultedField = "assignee" | "slot" | "priority" | "effortMin";

export interface VoiceTaskCard {
  assigneeUserId: string | null;
  assigneeSaid: string | null;
  titleBn: string;
  notes: string | null;
  dueKey: string | null;
  slot: DaySlot;
  priority: TaskPriority;
  effortMin: number;
  recurrence: VoiceRecurrence;
  weekdays: number[];
  monthDay: number | null;
  weekOfMonth: number | null;
  endKey: string | null;
  defaulted: DefaultedField[];
  warnings: string[];
}

export interface VoiceTaskDraft {
  transcript: string;
  tasks: VoiceTaskCard[];
  warnings: string[];
}

export const DEFAULT_EFFORT_MIN = 30;
const TITLE_MAX = 200;
const NOTES_MAX = 2000;

// ---------------------------------------------------------------------------
// Name guard (D-#962)
// ---------------------------------------------------------------------------

/** Bangla-safe comparison form: decomposed, no hasanta / nukta / ZWJ / ZWNJ, no
 *  punctuation or spaces, lower-case. "আকমল" and "আক্‌মল" compare equal. */
export function normaliseForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[়্‌‍]/g, "")
    .replace(/[\p{P}\p{S}\s]/gu, "")
    .toLowerCase();
}

/** Latin consonant skeleton, so the spellings of one name agree: Akmol / Akmal → "kml",
 *  Tazkir / Taskir → "tskr". Vowels and doubled letters carry no identity here. */
export function latinSkeleton(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/ph/g, "f")
    .replace(/[zj]/g, "j")
    .replace(/[sz]h/g, "s")
    .replace(/kh/g, "k")
    .replace(/q/g, "k")
    .replace(/v/g, "b")
    .replace(/[aeiouyw]/g, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/j/g, "s");
}

/** Name parts that identify nobody: honorifics and the commonest family names. */
const FILLER = new Set(
  ["md", "mohammad", "mohammed", "muhammad", "mohd", "mst", "mosammat", "most", "sheikh", "sk", "hafez", "hafiz", "maulana", "mawlana", "mufti", "ustad", "ustaz", "sir", "madam", "apa", "bhai"].map(latinSkeleton),
);
const FILLER_BN = new Set(["মোঃ", "মোহাম্মদ", "মুহাম্মদ", "মোসাম্মৎ", "মোসাঃ", "হাফেজ", "মাওলানা", "মুফতি", "উস্তাদ", "স্যার", "ম্যাডাম", "আপা", "ভাই"].map(normaliseForMatch));

interface NameKey {
  key: string;
  script: "bn" | "latin";
}

function keysOf(p: VoiceStaff): NameKey[] {
  const out: NameKey[] = [];
  for (const w of p.name.split(/[\s.\-]+/)) {
    const k = latinSkeleton(w);
    if (k.length >= 3 && !FILLER.has(k)) out.push({ key: k, script: "latin" });
  }
  for (const w of (p.nameBn ?? "").split(/[\s.\-]+/)) {
    const k = normaliseForMatch(w);
    if (k.length >= 3 && !FILLER_BN.has(k)) out.push({ key: k, script: "bn" });
  }
  return out;
}

/**
 * The people whose name is HEARD in the given words. A name part counts only when it
 * belongs to exactly one person on the list — "Rahman" heard proves nothing when three
 * staff carry it. A heard word matches when it STARTS with the part, so case endings
 * (আকমলকে, Akmol-ke) still match.
 */
export function heardPeople(staff: VoiceStaff[], bnWords: string, latinWords: string): Set<string> {
  const owners = new Map<string, Set<string>>();
  const keyed = staff.map((p) => ({ p, keys: keysOf(p) }));
  for (const { p, keys } of keyed) {
    for (const k of keys) {
      const id = `${k.script}:${k.key}`;
      owners.set(id, (owners.get(id) ?? new Set()).add(p.userId));
    }
  }
  const bn = bnWords.split(/\s+/).map(normaliseForMatch).filter(Boolean);
  const la = latinWords.split(/\s+/).map(latinSkeleton).filter(Boolean);
  const heard = new Set<string>();
  for (const { p, keys } of keyed) {
    for (const k of keys) {
      if (owners.get(`${k.script}:${k.key}`)!.size !== 1) continue;
      const words = k.script === "bn" ? bn : la;
      if (words.some((w) => w.startsWith(k.key))) {
        heard.add(p.userId);
        break;
      }
    }
  }
  return heard;
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

const clip = (s: string | null | undefined, max: number): string => (s ?? "").trim().slice(0, max);

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

function futureKey(key: string | null | undefined, todayKey: string): { key: string | null; past: boolean } {
  if (!key || !isValidDateKey(key)) return { key: null, past: false };
  if (key < todayKey) return { key: null, past: true };
  return { key, past: false };
}

function nameOfId(staff: VoiceStaff[], id: string): string {
  const p = staff.find((s) => s.userId === id);
  return p ? p.nameBn || p.name : id;
}

function buildCard(raw: RawVoiceTask, ctx: { staff: VoiceStaff[]; selfId: string; selfOnly: boolean; todayKey: string; transcript: string; transcriptLatin: string }): VoiceTaskCard | null {
  const warnings: string[] = [];
  const defaulted: DefaultedField[] = [];
  const titleBn = clip(raw.titleBn, TITLE_MAX);
  if (!titleBn) return null;

  // --- Assignee (D-#962) ---
  const allowed = new Set(ctx.staff.map((s) => s.userId));
  let pick: string | null = raw.assigneeUserId && allowed.has(raw.assigneeUserId) ? raw.assigneeUserId : null;
  if (raw.assigneeUserId && !pick) {
    warnings.push(ctx.selfOnly ? "অন্যকে কাজ দেওয়ার অনুমতি নেই — কাজটি আপনার নিজের বোর্ডে রাখা হলো" : "যাঁর নাম বলা হয়েছে তাঁকে তালিকায় পাওয়া যায়নি — বাছুন");
  }
  const said = clip(raw.assigneeSaid, 120);
  // Only trust the words the model says it heard if they really are in the transcript.
  const saidInTranscript = said.length > 0 && normaliseForMatch(ctx.transcript).includes(normaliseForMatch(said));
  const heard = heardPeople(
    ctx.staff,
    saidInTranscript ? said : ctx.transcript,
    clip(raw.assigneeSaidLatin, 120) || ctx.transcriptLatin,
  );
  if (pick && !heard.has(pick)) {
    const other = [...heard].filter((id) => id !== pick);
    if (other.length === 1 && heard.size === 1) {
      warnings.push(`শোনা গেছে "${nameOfId(ctx.staff, other[0])}" — "${nameOfId(ctx.staff, pick)}" নয়; বদলে দেওয়া হলো, মিলিয়ে দেখুন`);
      pick = other[0];
    } else if (!ctx.selfOnly) {
      warnings.push(`"${nameOfId(ctx.staff, pick)}" — নামটি ঠিক শোনা গেছে কি না মিলিয়ে দেখুন`);
    }
  } else if (!pick) {
    if (heard.size === 1) {
      pick = [...heard][0];
      warnings.push(`"${nameOfId(ctx.staff, pick)}" বসানো হলো — মিলিয়ে দেখুন`);
    } else if (ctx.selfOnly) {
      pick = ctx.selfId;
      defaulted.push("assignee");
    } else {
      warnings.push("কাকে দেবেন বোঝা যায়নি — বাছুন");
    }
  }

  // --- Recurrence (D-#964) ---
  let recurrence: VoiceRecurrence = "ONCE";
  let weekdays: number[] = [];
  let monthDay: number | null = null;
  let weekOfMonth: number | null = null;
  const r = raw.recurrence ?? "ONCE";
  if (r !== "ONCE" && (TASK_RECURRENCES as readonly string[]).includes(r)) {
    const days = [...new Set((raw.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    const md = intOrNull(raw.monthDay);
    const wom = intOrNull(raw.weekOfMonth);
    let complete = true;
    if (r === "WEEKLY") complete = days.length > 0;
    if (r === "MONTHLY") complete = md !== null && md >= 1 && md <= 31;
    if (r === "MONTHLY_WEEKDAY") complete = days.length >= 1 && wom !== null && wom >= 1 && wom <= 5;
    if (complete) {
      recurrence = r as TaskRecurrence;
      if (r === "WEEKLY") weekdays = days;
      if (r === "MONTHLY") monthDay = md;
      if (r === "MONTHLY_WEEKDAY") {
        weekdays = [days[0]];
        weekOfMonth = wom;
      }
    } else {
      warnings.push("কবে কবে হবে তা পুরো বোঝা যায়নি — একবারের কাজ হিসেবে রাখা হলো");
    }
  }

  // --- Dates (D-#963) ---
  let dueKey: string | null = null;
  let endKey: string | null = null;
  if (recurrence === "ONCE") {
    const due = futureKey(raw.dueKey, ctx.todayKey);
    dueKey = due.key;
    if (due.past) warnings.push("বলা তারিখটি পেরিয়ে গেছে — তারিখ বাছুন");
    else if (!dueKey) warnings.push("তারিখ বলা হয়নি — বেছে নিন");
  } else {
    const end = futureKey(raw.endKey, ctx.todayKey);
    endKey = end.key;
    if (end.past) warnings.push("শেষ তারিখটি পেরিয়ে গেছে — শেষ তারিখ ছাড়া রাখা হলো");
  }

  // --- The rest: defaults are marked, never hidden ---
  const slot = (DAY_SLOTS as readonly string[]).includes(raw.slot ?? "") ? (raw.slot as DaySlot) : (defaulted.push("slot"), "ANY" as DaySlot);
  const priority = (TASK_PRIORITIES as readonly string[]).includes(raw.priority ?? "")
    ? (raw.priority as TaskPriority)
    : (defaulted.push("priority"), "NORMAL" as TaskPriority);
  let effortMin = intOrNull(raw.effortMin);
  if (effortMin === null || effortMin <= 0) {
    effortMin = DEFAULT_EFFORT_MIN;
    defaulted.push("effortMin");
  } else {
    effortMin = Math.min(480, Math.max(5, effortMin));
  }

  return {
    assigneeUserId: pick,
    assigneeSaid: said || null,
    titleBn,
    notes: clip(raw.notes, NOTES_MAX) || null,
    dueKey,
    slot,
    priority,
    effortMin,
    recurrence,
    weekdays,
    monthDay,
    weekOfMonth,
    endKey,
    defaulted,
    warnings,
  };
}

/**
 * The model's reply → the cards the app shows. `staff` is the list the caller may assign
 * to (already narrowed to the caller alone when `selfOnly`). Pure: same input, same draft.
 */
export function buildDraft(raw: RawVoiceReply, opts: { staff: VoiceStaff[]; selfId: string; selfOnly: boolean; todayKey: string }): VoiceTaskDraft {
  const transcript = clip(raw.transcript, 4000);
  const transcriptLatin = clip(raw.transcriptLatin, 4000);
  const warnings = (raw.warnings ?? []).filter((w): w is string => typeof w === "string" && w.trim().length > 0).map((w) => w.trim().slice(0, 300));
  const tasks: VoiceTaskCard[] = [];
  let dropped = 0;
  for (const t of raw.tasks ?? []) {
    const card = t && typeof t === "object" ? buildCard(t, { ...opts, transcript, transcriptLatin }) : null;
    if (card) tasks.push(card);
    else dropped += 1;
  }
  if (dropped > 0) warnings.push(`${dropped}টি কাজের শিরোনাম বোঝা যায়নি — বাদ দেওয়া হলো`);
  if (tasks.length === 0) warnings.push("কোনো কাজ বোঝা যায়নি — আবার বলুন");
  return { transcript, tasks, warnings };
}

// ---------------------------------------------------------------------------
// Prompt + response schema
// ---------------------------------------------------------------------------

const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function buildVoicePrompt(opts: { todayKey: string; staff: VoiceStaff[]; selfId: string; priorDraftJson?: string | null; typedText?: string | null }): string {
  const weekday = WEEKDAYS_EN[parseDateKey(opts.todayKey).getDay()];
  const lines = opts.staff.map((s) => `${s.userId} | ${s.name} | ${s.nameBn ?? "-"} | ${s.designation ?? "-"}${s.userId === opts.selfId ? " | (the speaker)" : ""}`);
  return [
    "You turn a school principal's (or staff member's) spoken note into work-board TASKS for staff of a school in Sylhet, Bangladesh.",
    "The note may be Bangla, English or mixed. One note may hold several tasks for several people.",
    `Today is ${opts.todayKey} (${weekday}). The school week is Sunday–Thursday; Friday is off.`,
    "",
    "STAFF YOU MAY ASSIGN TO (id | English name | Bangla name | designation):",
    ...lines,
    "",
    "RULES:",
    "- assigneeUserId: choose ONLY from the ids above, and ONLY for a person whose name the speaker actually said. NEVER pick someone who was not mentioned. If two people fit, pick one and add a Bangla warning. If nobody fits, use null.",
    "- If the speaker says the task is for themselves (আমার, নিজের, 'remind me'), use the id marked (the speaker).",
    "- assigneeSaid: the exact words used for the person, copied from `transcript`. assigneeSaidLatin: the same words romanised.",
    "- titleBn: a short Bangla task title (what to do), max 200 characters. notes: any extra detail in Bangla, else null.",
    "- dueKey: YYYY-MM-DD ONLY when a day or deadline was said (আজ, কাল, পরশু, বৃহস্পতিবার, 'by Thursday', 'next week Sunday', a date). Resolve relative days from today. If no day was said, use null — never guess.",
    "- slot: MORNING (সকাল), MIDDAY (দুপুর), AFTERNOON (বিকাল), ANY; null if not said.",
    "- priority: URGENT (জরুরি, এখনই, আজকেই অবশ্যই), LATER (পরে করলেও চলবে, সময় পেলে), NORMAL if said plainly as normal; null if nothing about urgency was said.",
    "- effortMin: minutes the work takes ONLY if said (আধা ঘণ্টা = 30, এক ঘণ্টা = 60, দুই ঘণ্টা = 120); else null.",
    "- recurrence: ONCE unless repetition was said. SCHOOL_DAYS (প্রতিদিন), WEEKLY with weekdays (0=Sunday … 6=Saturday; প্রতি শনিবার = [6]), MONTHLY with monthDay (প্রতি মাসের ৫ তারিখ = 5; মাসের শেষ দিন = 31), MONTHLY_WEEKDAY with weekdays=[one day] and weekOfMonth 1–4 or 5 = last (মাসের প্রথম শনিবার = [6], 1). endKey: YYYY-MM-DD when an end was said ('until December'), else null. dueKey is null for a repeating task.",
    "- transcript: exactly what was said, in the script spoken (Bangla in Bangla script). transcriptLatin: the whole transcript romanised, names spelled as in the staff list.",
    "- warnings: short Bangla notes about anything unclear. Do not use clapping or applause words.",
    opts.priorDraftJson
      ? `\nPENDING DRAFT (the speaker is CORRECTING it — apply the correction and return the FULL corrected list of tasks, keeping everything not corrected):\n${opts.priorDraftJson}`
      : "",
    opts.typedText ? `\nTYPED TEXT FROM THE SPEAKER:\n${opts.typedText}` : "",
  ].join("\n");
}

const nullable = <T extends object>(s: T) => ({ ...s, nullable: true });

/** Gemini `responseSchema` (OpenAPI subset). */
export const VOICE_TASK_SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING" },
    transcriptLatin: { type: "STRING" },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
    tasks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          assigneeUserId: nullable({ type: "STRING" }),
          assigneeSaid: nullable({ type: "STRING" }),
          assigneeSaidLatin: nullable({ type: "STRING" }),
          titleBn: { type: "STRING" },
          notes: nullable({ type: "STRING" }),
          dueKey: nullable({ type: "STRING" }),
          slot: nullable({ type: "STRING", enum: [...DAY_SLOTS] }),
          priority: nullable({ type: "STRING", enum: [...TASK_PRIORITIES] }),
          effortMin: nullable({ type: "INTEGER" }),
          recurrence: { type: "STRING", enum: ["ONCE", ...TASK_RECURRENCES] },
          weekdays: { type: "ARRAY", items: { type: "INTEGER" } },
          monthDay: nullable({ type: "INTEGER" }),
          weekOfMonth: nullable({ type: "INTEGER" }),
          endKey: nullable({ type: "STRING" }),
        },
        required: ["titleBn", "recurrence"],
      },
    },
  },
  required: ["transcript", "tasks"],
} as const;
