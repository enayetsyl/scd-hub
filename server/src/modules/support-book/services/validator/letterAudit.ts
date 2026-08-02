/**
 * Letter audit — the ONE subject-specific validator check (SB-1, D-#432).
 *
 * Ported from `SB-Governance/validator_letter_audit.py`, which is where the real
 * implementation lives — NOT from `SCHEMA_support-book_v1.md` §6, whose documented
 * shape (`cumulative_after_lesson` / `kar_after_lesson` / `conjunct_whitelist_by_lesson`
 * maps) does not match the actual data file. The real inventory is per-lesson:
 *
 *   lessons: { "26": { introduced_borno, introduced_kar,
 *                      cumulative_borno[], cumulative_kar[],
 *                      conjunct_whitelist: { glyphs: string[] | null, needs_review } } }
 *
 * A port written from the schema would compile, run, and audit nothing. That is the
 * whole reason D-#432 exists.
 *
 * WHAT IT ENFORCES (README §4.2 / D-009): decodable text for পাঠ N may use only the
 * বর্ণ and কারচিহ্ন taught up to N, and only the whole-unit conjuncts that N's own
 * whitelist names (rule B-1 — no systematic conjunct construction at Class 1).
 *
 * SCOPE — deliberately narrow, and the narrowness is load-bearing:
 *   - `oral: true` blocks are EXEMPT (শুনি-ও-বলি is teacher-read, not decoded).
 *   - `source: "nctb"` blocks are EXEMPT (NCTB's own text is protected, not ours to
 *     re-grade — auditing it would red-fail the textbook itself).
 *
 * `conjunct_whitelist.glyphs: null` means B-1's default of NONE, not "unknown, allow".
 * Three পাঠ in C1-BAN carry null with `needs_review` because the TG flags যুক্তবর্ণ
 * outcomes without enumerating the glyphs, and D-009/D-011 forbid inventing them.
 * Defaulting to "none" is what makes an unresolved পাঠ fail loudly instead of
 * silently permitting any conjunct.
 */

/** কারচিহ্ন — the combining vowel signs. */
const KAR_SET = new Set("ািীুূৃেৈোৌ");
/** Attach like marks but are taught as বর্ণ-level signs (পাঠ 34 in C1-BAN). */
const SPECIAL_MARKS = new Set("ংঃঁ");
/** ্ — the conjunct former. */
const HASANTA = "্";
const ZW = new Set(["‌", "‍"]);
/** Punctuation, whitespace and digits are always allowed in decodable text. */
const ALLOWED_PUNCT = new Set([
  ..." \n\t।,.?!-—…‘’“”()৷॥",
  ..."০১২৩৪৫৬৭৮৯0123456789",
]);

export interface LetterInventoryLesson {
  cumulative_borno: string[];
  cumulative_kar: string[];
  conjunct_whitelist?: { glyphs: string[] | null; needs_review?: boolean };
}

export interface LetterInventory {
  book_id?: string;
  lessons: Record<string, LetterInventoryLesson>;
  open_items?: string[];
}

export type LetterViolationType =
  | "conjunct_not_whitelisted"
  | "kar_not_taught"
  | "borno_not_taught"
  | "out_of_script";

export interface LetterViolation {
  type: LetterViolationType;
  /** The offending unit — a cluster for conjuncts, a single char otherwise. */
  unit: string;
  detail: string;
}

/** The sets a পাঠ may draw on. Throws if the lesson is absent — an audit that
 *  silently passes because the inventory has no row for পাঠ 40 is worse than one
 *  that stops and says so. */
export function cumulativeAllowed(
  inv: LetterInventory,
  lessonNo: number,
): { borno: Set<string>; kar: Set<string>; conj: Set<string> } {
  const L = inv.lessons[String(lessonNo)];
  if (!L) throw new Error(`letter inventory has no পাঠ ${lessonNo}`);
  const glyphs = L.conjunct_whitelist?.glyphs ?? []; // null -> [] : B-1 default is NONE
  return {
    borno: expandNuktaForms(L.cumulative_borno),
    kar: new Set(L.cumulative_kar),
    conj: new Set(glyphs),
  };
}

/**
 * DELIBERATE DIVERGENCE from `validator_letter_audit.py` (D-#433).
 *
 * ড় ঢ় য় are single letters in the inventory (U+09DC/09DD/09DF), but real Bengali
 * text carries them DECOMPOSED as base + nukta (ড + ়). The reference audit compares
 * character by character, so it sees a bare ় that is in no taught set and red-fails
 * it — **29 of the 37 letter-audit hits on the real C1-BAN book are exactly this**.
 *
 * It cannot be fixed by "fixing the text", the usual rule: these three letters sit on
 * Unicode's **composition-exclusion list**, so NFC does NOT recompose ড + ় back into
 * ড়. Both spellings circulate permanently and the reference can only ever pass on
 * one of them — an audit that fails valid text is not a net, it is noise that gets
 * muted.
 *
 * So the taught set carries BOTH spellings of every entry. Nothing else changes: a
 * nukta is accepted only where its composed letter is genuinely taught, and a bare
 * nukta on an untaught base still fails.
 */
function expandNuktaForms(entries: string[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    out.add(e);
    const nfd = e.normalize("NFD");
    out.add(nfd);
    // Add each code point of any multi-codepoint entry. NOT guarded on
    // `nfd !== e`: the C1-BAN inventory already stores ড়/ঢ়/য় DECOMPOSED, so NFD is
    // a no-op there and a guard would skip exactly the letters this exists for.
    // The audit walks single characters, so the bare nukta must be in the set on
    // its own — and it is admitted ONLY because its composed letter is taught.
    for (const ch of nfd) out.add(ch);
  }
  return out;
}

/** Audit one string as decodable text for পাঠ `lessonNo`. Empty array = pass. */
export function auditText(text: string, lessonNo: number, inv: LetterInventory): LetterViolation[] {
  const { borno, kar, conj } = cumulativeAllowed(inv, lessonNo);
  const allowed = new Set<string>([
    ...borno, ...kar, ...SPECIAL_MARKS, ...ZW, ...ALLOWED_PUNCT, HASANTA,
  ]);
  const violations: LetterViolation[] = [];
  const chars = [...text];

  // 1) Conjuncts: every hasanta-joined cluster must be on this পাঠ's whitelist.
  for (let idx = 0; idx < chars.length; idx++) {
    if (chars[idx] !== HASANTA) continue;
    const left = idx > 0 ? chars[idx - 1] : "";
    const right = idx + 1 < chars.length ? chars[idx + 1] : "";
    const cluster = `${left}${HASANTA}${right}`;
    if (!conj.has(cluster)) {
      violations.push({
        type: "conjunct_not_whitelisted",
        unit: cluster,
        detail: `যুক্তবর্ণ not on পাঠ ${lessonNo} whitelist (B-1)`,
      });
    }
  }

  // 2) Per-character: বর্ণ / কারচিহ্ন not yet taught.
  for (const ch of chars) {
    if (ZW.has(ch) || ch === HASANTA) continue;
    if (allowed.has(ch)) continue;
    if (ch >= "ঀ" && ch <= "৿") {
      if (KAR_SET.has(ch)) {
        violations.push({ type: "kar_not_taught", unit: ch, detail: `কারচিহ্ন not taught up to পাঠ ${lessonNo}` });
      } else {
        violations.push({ type: "borno_not_taught", unit: ch, detail: `বর্ণ not taught up to পাঠ ${lessonNo}` });
      }
    } else {
      // Non-Bengali and not allowed — script-guard territory; flagged here too so a
      // letter-audit run is self-contained.
      violations.push({ type: "out_of_script", unit: ch, detail: "character outside Bengali + allowed set" });
    }
  }
  return violations;
}

/** Audit one block. Returns [] for the two exempt classes (see the header). */
export function auditBlock(
  block: Record<string, unknown>,
  lessonNo: number,
  inv: LetterInventory,
): LetterViolation[] {
  if (block.oral === true) return [];          // শুনি-ও-বলি: teacher-read, not decoded
  if (block.source === "nctb") return [];      // NCTB's own text is protected
  const text = typeof block.text_bn === "string" ? block.text_bn : "";
  return auditText(text, lessonNo, inv);
}

/** The audit runs ONLY for Class 1–2 বাংলা (README §3.3) and is skipped otherwise. */
export function letterAuditApplies(classLevel: number, subject: string): boolean {
  return (classLevel === 1 || classLevel === 2) && subject.toUpperCase() === "BAN";
}
