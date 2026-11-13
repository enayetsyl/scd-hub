/**
 * De-identification (AI-4, D-#1094) — nothing about a real person leaves the VM in a prompt.
 *
 *   deidentify(text, scope) → { text, map }   names, phones, long numbers, roll/ID numbers
 *                                            and tracker ids become tokens:
 *                                            [S] = the child the record is about,
 *                                            [S1].. other children, [G1].. guardians,
 *                                            [T1].. staff, [PHONE], [NUM], [ID]
 *   reidentify(text, map)                    puts the people back (phones/ids stay tokens)
 *   assertDeidentified(text, scope)          FAIL-CLOSED: throws if any in-scope name is
 *                                            still there — the call must not be sent
 *
 * Matching is variant-tolerant for Bangla spelling (ি/ী, ু/ূ, ব/ভ, স/শ/ষ, ন/ণ, জ/য, র/ড়)
 * and allows Bangla case endings (আয়েশার, আয়েশাকে …), but a name INSIDE a longer word is
 * left alone (a Latin name needs a word edge; a Bangla one may only be followed by an
 * ending from the list). Common words that are also name parts (ইসলাম, নূর, Islam, Md …)
 * are never matched on their own — only inside a full name.
 *
 * LOOSE match for the child the text is about (D-#1151): every Bangla word is also compared
 * by its "skeleton" — vowel length, a/o, aspiration, hasant, doubled letters and য় ignored —
 * against that child's Bangla spellings (typed by the Office, or guessed from the English
 * name by `banglaGuess.ts`). So রাফি / রাফী / রাফিকে all hide even when nobody typed
 * the Bangla name. Only the own child: a wrongly hidden word costs a placeholder, not a name.
 *
 * The map NEVER leaves the server and is never logged with the prompt (D-#1094).
 * Pure: no database. `DeidScopeService` builds a scope from the roster.
 */

export type DeidKind = "S" | "G" | "T";

export interface DeidPerson {
  kind: DeidKind;
  /** Stable id (ObjectId string) — the same person gets the same token in a scope. */
  id: string;
  /** Every spelling we know: English name, Bangla name, nicknames. */
  names: string[];
  /** The child the text is about → token `[S]`. */
  own?: boolean;
}

export interface DeidScope {
  people: DeidPerson[];
}

export interface DeidResult {
  text: string;
  /** token → the original text it replaced (first spelling seen). Server-only. */
  map: Record<string, string>;
  /**
   * The phones / numbers / ids in the order they were hidden (D-#1176). Server-only. The
   * comment checker puts them back into a suggestion (`restoreNumbers`), so accepting one
   * never pastes "[PHONE]" into a comment; the assistant leaves them hidden.
   */
  seq?: { PHONE: string[]; NUM: string[]; ID: string[] };
}

export class DeidentifyError extends Error {
  constructor(readonly found: number) {
    super("লেখায় এখনো কারও নাম রয়ে গেছে — এআই-তে পাঠানো হয়নি");
    this.name = "DeidentifyError";
  }
}

/** Name parts that are also ordinary words or near-universal — never matched alone. */
const STOP = new Set([
  "md", "mohammad", "muhammad", "mohammed", "mst", "mosammat", "most", "sk", "sheikh", "abdul", "abu", "al", "binte", "bint", "bin", "ibn",
  "islam", "noor", "nur", "hasan", "hossain", "ahmed", "akter", "akhter", "khatun", "begum", "rahman", "uddin", "ali", "miah", "khan",
  "mia", "das", "roy", "sultana", "jahan", "chowdhury", "haque", "hoque", "alam", "kabir", "karim",
  "মোঃ", "মো", "মোছাঃ", "মোসাঃ", "মুহাম্মদ", "মোহাম্মদ", "মুহাম্মাদ", "আব্দুল", "আবদুল", "আবু", "বিনতে", "ইসলাম", "নূর", "নুর", "আশা", "আলো",
  "হাসান", "হোসেন", "হোসাইন", "আহমেদ", "আহমদ", "আক্তার", "আখতার", "খাতুন", "বেগম", "রহমান", "উদ্দিন", "আলী", "মিয়া", "খান", "সোনা",
  "মনি", "মণি", "সুলতানা", "জাহান", "চৌধুরী", "হক", "আলম", "কবির", "করিম", "উস্তায", "উস্তাদ", "উস্তাযা", "আপা", "স্যার", "ম্যাম",
  // Everyday words that are rarely a child's own first name (Kader → কাদের "whose") — D-#1151.
  // Real first names (সীমা, সারা, জারা ≈ যারা …) stay matchable: a hidden word costs less than a name.
  "কাদের", "অংশ", "মেনু", "যেদিন", "দেন", "সুর", "সূরা", "সুদ", "অক্ষর", "আজকে", "জানতে",
]);

// Bangla spelling-variant classes.
const VARIANTS: string[][] = [["ি", "ী"], ["ু", "ূ"], ["ব", "ভ"], ["স", "শ", "ষ"], ["ন", "ণ"], ["জ", "য"], ["র", "ড়"]];
const VCLASS: Record<string, string> = {};
for (const g of VARIANTS) for (const ch of g) VCLASS[ch] = `[${g.join("")}]`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nfc = (s: string) => (s ?? "").normalize("NFC");
const isBangla = (s: string) => /[ঀ-৿]/.test(s);
/** Bangla case endings a name may carry. */
const BN_ENDINGS = "(?:এর|য়ের|ের|র|কে|ও|ই|রা|দের)?";

function pattern(name: string): RegExp {
  const body = [...nfc(name)].map((ch) => VCLASS[ch] ?? esc(ch)).join("").replace(/\s+/g, "\\s+");
  // Group 1 = the character before the name (kept); the name; an optional Bangla ending.
  return isBangla(name)
    ? new RegExp(`(^|[^\\p{L}\\p{M}])${body}(?=${BN_ENDINGS}(?:[^\\p{L}\\p{M}]|$))`, "gu")
    : new RegExp(`(^|[^\\p{L}\\p{M}])${body}(?=[^\\p{L}\\p{M}]|$)`, "giu");
}

interface Entry {
  person: DeidPerson;
  text: string;
  /** A full name (all its parts), not one part. */
  full: boolean;
  re: RegExp;
}

function entriesOf(scope: DeidScope): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  const add = (person: DeidPerson, text: string, full: boolean) => {
    const k = `${text.toLowerCase()}|${person.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ person, text, full, re: pattern(text) });
  };
  for (const p of scope.people) {
    for (const raw of p.names) {
      const full = nfc(raw).replace(/\s+/g, " ").trim();
      if ([...full].length < 2) continue;
      add(p, full, true);
      for (const part of full.split(/[\s.\-]+/)) {
        const w = part.replace(/[ঃ:]$/, "");
        if ([...w].length >= 3 && !STOP.has(w.toLowerCase())) add(p, w, false);
      }
    }
  }
  // Longest first, so a full name wins over its own first name.
  return out.sort((a, b) => [...b.text].length - [...a.text].length);
}

// Loose (skeleton) match — own child only -------------------------------------------------

const SKEL: Record<string, string> = {
  "ি": "i", "ী": "i", "ই": "i", "ঈ": "i", "ু": "u", "ূ": "u", "উ": "u", "ঊ": "u", "ে": "e", "ৈ": "e", "এ": "e", "ঐ": "e",
  "ৃ": "ri", "ঋ": "ri",
  "খ": "ক", "ঘ": "গ", "ছ": "চ", "ঝ": "জ", "য": "জ", "ঠ": "ত", "থ": "ত", "ট": "ত", "ৎ": "ত", "ঢ": "দ", "ড": "দ", "ধ": "দ",
  "ভ": "ব", "শ": "স", "ষ": "স", "ণ": "ন", "ং": "ন", "ঙ": "ন",
};
/** Dropped: া ো ৌ ্ ঁ ঃ ় and joiners; অ আ ও ঔ count as a vowel only at the start. */
const SKEL_DROP = new Set(["া", "ো", "ৌ", "্", "ঁ", "ঃ", "়", "‌", "‍"]);
const SKEL_START = new Set(["অ", "আ", "ও", "ঔ"]);

/** The spelling-blind shape of one Bangla word (exported for tests). */
export function skeleton(word: string): string {
  // NFC keeps য় ড় ঢ় decomposed (letter + nukta): য় is a glide (dropped), ড় / ঢ় sound as র.
  // য-ফলা (রাইয়্যান) adds no sound of its own in a name: dropped too.
  const flat = nfc(word)
    .replace(/্য(?!়)/g, "")
    .replace(/[য়]|য়/g, "")
    .replace(/[ড়ঢ়]|[ডঢ]়/g, "র");
  const chars = [...flat];
  let out = "";
  chars.forEach((ch, i) => {
    if (SKEL_DROP.has(ch)) return;
    if (SKEL_START.has(ch)) {
      if (i === 0) out += "A";
      return;
    }
    const m = SKEL[ch] ?? ch;
    if (!out.endsWith(m)) out += m; // doubled letters (ব্ব) count once
  });
  return out;
}

const BN_WORD = /[ঀ-৿‌‍]+/gu;
const LOOSE_ENDINGS = ["দের", "য়ের", "এর", "ের", "কে", "রা", "র", "ও", "ই"];
/**
 * Skeletons shorter than this match ordinary words (অংশ ≈ আনাস, সীমা ≈ সিমা); the exact,
 * variant-tolerant match above still covers short names. Measured 2026-11-08 on 2,396
 * distinct words of the help guides: 3 → 14 ordinary words hit, 4 → none.
 */
const LOOSE_MIN = 4;

function within1(a: string, b: string): boolean {
  const x = [...a];
  const y = [...b];
  if (Math.abs(x.length - y.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (++edits > 1) return false;
    if (x.length > y.length) i += 1;
    else if (y.length > x.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (x.length - i) + (y.length - j) <= 1;
}

interface LooseTargets {
  /** Vowel-aware skeletons (≥ LOOSE_MIN symbols). */
  skel: Set<string>;
  /** Long skeletons (≥ 6) also match one edit away (মুবতাসিম / মোবতাসীম). */
  long: string[];
}

function isLooseHit(word: string, t: LooseTargets): boolean {
  const k = skeleton(word);
  if ([...k].length < LOOSE_MIN) return false;
  if (t.skel.has(k)) return true;
  return [...k].length >= 5 && t.long.some((l) => within1(k, l));
}

/** The own child's Bangla name parts as loose targets (STOP words left out). */
function ownTargets(scope: DeidScope): LooseTargets {
  const skel = ownSkeletons(scope);
  // ≥ 5 hid an ordinary word (মেনুর) for a 5-letter name; ≥ 6 hid none (2026-11-08 measurement).
  return { skel, long: [...skel].filter((k) => [...k].length >= 6) };
}

/** The own child's Bangla name parts as skeletons (STOP words left out). */
function ownSkeletons(scope: DeidScope): Set<string> {
  const out = new Set<string>();
  const stop = new Set([...STOP].filter(isBangla).map(skeleton));
  for (const p of scope.people) {
    if (!p.own) continue;
    for (const raw of p.names) {
      if (!isBangla(raw)) continue;
      for (const part of nfc(raw).split(/[\s.\-]+/)) {
        const w = part.replace(/[ঃ:]$/, "");
        if (!w || STOP.has(w)) continue;
        const k = skeleton(w);
        if ([...k].length >= LOOSE_MIN && !stop.has(k)) out.add(k);
      }
    }
  }
  return out;
}

/** Each Bangla word whose stem (an ending allowed) has an own-child skeleton → callback. */
function looseReplace(text: string, scope: DeidScope, onHit: (stem: string) => string): string {
  const targets = ownTargets(scope);
  if (targets.skel.size === 0) return text;
  return text.replace(BN_WORD, (word) => {
    if (isLooseHit(word, targets)) return onHit(word);
    for (const end of LOOSE_ENDINGS) {
      if (word.length > end.length && word.endsWith(end)) {
        const stem = word.slice(0, -end.length);
        if (isLooseHit(stem, targets)) return onHit(stem) + end;
      }
    }
    return word;
  });
}

function tokenFor(scope: DeidScope): (p: DeidPerson) => string {
  const counters: Record<DeidKind, number> = { S: 0, G: 0, T: 0 };
  const tokens = new Map<string, string>();
  for (const p of scope.people) {
    if (p.own) tokens.set(`S:${p.id}`, "[S]");
  }
  return (p) => {
    const k = `${p.kind}:${p.id}`;
    if (!tokens.has(k)) tokens.set(k, `[${p.kind}${++counters[p.kind]}]`);
    return tokens.get(k)!;
  };
}

export const PHONE_PATTERN = /(?:\+?(?:88|৮৮)[\s-]?)?[0০][1১][3-9৩-৯][0-9০-৯]{2}[\s-]?[0-9০-৯]{3}[\s-]?[0-9০-৯]{3}/g;
const LONG_NUMBER = /[0-9০-৯]{7,}/g;
const ROLL_OR_ID = /(roll|রোল|id|আইডি)(\s*(?:নং|নম্বর|no\.?))?[\s:.\-]*[0-9০-৯]+/gi;
/** Tracker / record ids: HW-C3-BAN-0007, CT-CK-ENG-0002, AS-000231 … */
const TRACKER_ID = /\b[A-Z]{2,4}-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g;

export function deidentify(textIn: string, scope: DeidScope): DeidResult {
  const original = nfc(textIn);
  let text = original;
  const seen: Record<string, string[]> = {};
  const token = tokenFor(scope);
  for (const e of entriesOf(scope)) {
    e.re.lastIndex = 0;
    text = text.replace(e.re, (whole: string, pre: string) => {
      const t = token(e.person);
      (seen[t] ??= []).push(whole.slice(pre.length));
      return `${pre}${t}`;
    });
  }
  // Loose pass for the own child — whatever the exact pass missed.
  const own = scope.people.find((p) => p.own);
  if (own) {
    text = looseReplace(text, scope, (stem) => {
      const t = token(own);
      (seen[t] ??= []).push(stem);
      return t;
    });
  }
  // A token restores the spelling the writer used FIRST in the text.
  const map: Record<string, string> = {};
  for (const [t, spellings] of Object.entries(seen)) {
    map[t] = spellings.reduce((best, s) => (original.indexOf(s) < original.indexOf(best) ? s : best));
  }
  const seq = { PHONE: [] as string[], NUM: [] as string[], ID: [] as string[] };
  text = text
    .replace(PHONE_PATTERN, (m: string) => (seq.PHONE.push(m), "[PHONE]"))
    .replace(LONG_NUMBER, (m: string) => (seq.NUM.push(m), "[NUM]"))
    .replace(ROLL_OR_ID, (m: string, label: string) => (seq.NUM.push(m.slice(label.length).trim()), `${label} [NUM]`))
    .replace(TRACKER_ID, (m: string) => (seq.ID.push(m), "[ID]"));
  return { text, map, seq };
}

/** Puts hidden phones / numbers / ids back, in order (the nth [PHONE] gets the nth phone). */
export function restoreNumbers(text: string, seq: DeidResult["seq"]): string {
  if (!seq) return text;
  const next = { PHONE: 0, NUM: 0, ID: 0 };
  return text.replace(/\[(PHONE|NUM|ID)\]/g, (tok, kind: "PHONE" | "NUM" | "ID") => seq[kind][next[kind]++] ?? tok);
}

/** Puts the people back. Tokens the model invented or mangled are left as they are. */
export function reidentify(text: string, map: Record<string, string>): string {
  return text.replace(/\[(S|S\d+|G\d+|T\d+)\]/g, (tok) => map[tok] ?? tok);
}

/** Counts in-scope FULL names still in `text`. */
export function remainingNames(text: string, scope: DeidScope): number {
  let n = 0;
  for (const e of entriesOf(scope)) {
    if (!e.full) continue;
    e.re.lastIndex = 0;
    if (e.re.test(nfc(text))) n += 1;
  }
  return n;
}

/**
 * FAIL-CLOSED gate before anything is sent: any in-scope full name OR the own child's
 * first name (exact or loose) still present → DeidentifyError. Use on the text that is about to leave.
 */
export function assertDeidentified(text: string, scope: DeidScope): void {
  let found = remainingNames(text, scope);
  const own = scope.people.filter((p) => p.own);
  for (const e of entriesOf({ people: own })) {
    e.re.lastIndex = 0;
    if (!e.full && e.re.test(nfc(text))) found += 1;
  }
  looseReplace(nfc(text), scope, (stem) => {
    found += 1;
    return stem;
  });
  if (found > 0) throw new DeidentifyError(found);
}
