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

const PHONE = /(?:\+?(?:88|৮৮)[\s-]?)?[0০][1১][3-9৩-৯][0-9০-৯]{2}[\s-]?[0-9০-৯]{3}[\s-]?[0-9০-৯]{3}/g;
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
  // A token restores the spelling the writer used FIRST in the text.
  const map: Record<string, string> = {};
  for (const [t, spellings] of Object.entries(seen)) {
    map[t] = spellings.reduce((best, s) => (original.indexOf(s) < original.indexOf(best) ? s : best));
  }
  text = text.replace(PHONE, "[PHONE]").replace(LONG_NUMBER, "[NUM]").replace(ROLL_OR_ID, "$1 [NUM]").replace(TRACKER_ID, "[ID]");
  return { text, map };
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
 * first name still present → DeidentifyError. Use on the text that is about to leave.
 */
export function assertDeidentified(text: string, scope: DeidScope): void {
  let found = remainingNames(text, scope);
  const own = scope.people.filter((p) => p.own);
  for (const e of entriesOf({ people: own })) {
    e.re.lastIndex = 0;
    if (!e.full && e.re.test(nfc(text))) found += 1;
  }
  if (found > 0) throw new DeidentifyError(found);
}
