/**
 * The salary-advice covering letter's WORDING, as editable policy data (D-#624).
 *
 * The letter to the bank was a string literal in the PDF renderer, so changing a word
 * of it meant a deploy. The owner asked to edit it before sending. The obvious answer
 * — also emit a .docx he can open in Word — would have created a SECOND renderer of the
 * same letter, free to drift from the PDF the bank actually receives; this repo has
 * spent real money on exactly that failure (a workbook disagreeing with a sheet, a
 * signed letter disagreeing with the ledger). So the wording is data and there stays
 * one renderer.
 *
 * The FIGURES are not editable. Amount, amount-in-words, month and account number are
 * substituted from the run at render time, because a letter whose typed total disagrees
 * with the attached sheet is worse than one whose wording is fixed. Everything a human
 * should choose is text; everything a machine should know is a placeholder.
 */

/** The names `{{...}}` may take. Anything else is a typo, and refused at save. */
export const ADVICE_LETTER_PLACEHOLDERS = [
  "school",
  "account",
  "bank",
  "branch",
  "amount",
  "amountWords",
  "month",
  "staffCount",
] as const;

export type AdviceLetterPlaceholder = (typeof ADVICE_LETTER_PLACEHOLDERS)[number];

export type AdviceLetterVars = Record<AdviceLetterPlaceholder, string>;

/**
 * The wording as it has always printed — byte-for-byte what the literal produced, so
 * landing this changes no letter until someone edits the box. A blank field reads as
 * this default (the `signatoryName` posture), which also makes "clear it" the way back
 * from an edit gone wrong.
 */
export const DEFAULT_ADVICE_LETTER_BODY =
  "We \u201C{{school}}\u201D are clients of your bank. Our bearing account number {{account}}. " +
  "Requesting you to arrange payment Tk. {{amount}}/- ({{amountWords}}) for our payable " +
  "Teachers salary payment online transfer as per attached Salary Advice Sheet - {{month}}." +
  "\n\n" +
  "We anticipate your full cooperation in this regard.";

/** `{{ name }}` — tolerant of inner spaces, because a person is typing these. */
const TOKEN_RE = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/** Every placeholder name the template mentions, in order, deduplicated. */
export function letterPlaceholdersIn(template: string): string[] {
  const found: string[] = [];
  for (const m of template.matchAll(TOKEN_RE)) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

/**
 * The names that are NOT substitutable.
 *
 * This is the whole reason the token list is closed. An unknown placeholder cannot be
 * filled, so it would print to a bank verbatim — "Tk. {{amont}}/-" on the school's own
 * letterhead. Cheap to catch while it is still in a text box.
 */
export function unknownLetterPlaceholders(template: string): string[] {
  return letterPlaceholdersIn(template).filter(
    (n) => !(ADVICE_LETTER_PLACEHOLDERS as readonly string[]).includes(n),
  );
}

/**
 * Substitute, then split into paragraphs on blank lines.
 *
 * Paragraphs rather than one blob because the renderer spaces them itself; a literal
 * "\n" pushed through pdfkit would not give the gap the letter has always had.
 *
 * The replacement is a FUNCTION, not a string: a value containing `$&` or `$1` — which
 * a bank name or a note plausibly could — would otherwise be re-interpreted by
 * `String.replace` and print something nobody typed.
 */
export function renderAdviceLetterBody(template: string, vars: AdviceLetterVars): string[] {
  const filled = template.replace(TOKEN_RE, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? vars[name as AdviceLetterPlaceholder]
      : whole,
  );
  return filled
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter((p) => p.length > 0);
}
