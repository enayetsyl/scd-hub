/**
 * The covering letter's wording as editable data (D-#624).
 *
 * The owner asked to edit the letter before sending it. The alternative he floated —
 * also emit a .docx — would have put a SECOND renderer of the same letter in the repo,
 * and these tests are the reason that mattered: what they pin is that ONE renderer
 * produces the letter, that the school controls the WORDS and the run controls the
 * FIGURES, and that a typo in a placeholder can never reach a bank.
 */
import {
  ADVICE_LETTER_PLACEHOLDERS,
  DEFAULT_ADVICE_LETTER_BODY,
  letterPlaceholdersIn,
  renderAdviceLetterBody,
  unknownLetterPlaceholders,
  type AdviceLetterVars,
} from "@scd/shared";

const VARS: AdviceLetterVars = {
  school: "এস সি ডি",
  account: "20503210201210503",
  bank: "Islami Bank Bangladesh PLC",
  branch: "Dakshin Surma, Sylhet",
  amount: "240,500",
  amountWords: "Two Lac Forty Thousand Five Hundred Only",
  month: "August 2026",
  staffCount: "25",
};

describe("the default wording is what the letter has always printed", () => {
  test("it renders the exact sentence the hard-coded literal produced", () => {
    const [first, second] = renderAdviceLetterBody(DEFAULT_ADVICE_LETTER_BODY, VARS);
    // Byte-for-byte the old literal, smart quotes included: landing this feature must
    // not change a letter until somebody chooses to edit it.
    expect(first).toBe(
      "We “এস সি ডি” are clients of your bank. Our bearing account number 20503210201210503. " +
        "Requesting you to arrange payment Tk. 240,500/- (Two Lac Forty Thousand Five Hundred " +
        "Only) for our payable Teachers salary payment online transfer as per attached " +
        "Salary Advice Sheet - August 2026.",
    );
    expect(second).toBe("We anticipate your full cooperation in this regard.");
  });

  test("every placeholder the default uses is one that can actually be filled", () => {
    expect(unknownLetterPlaceholders(DEFAULT_ADVICE_LETTER_BODY)).toEqual([]);
  });
});

describe("the school controls the words", () => {
  test("wording is replaced wholesale, and the figures still come from the run", () => {
    const paras = renderAdviceLetterBody(
      "Dear Sir,\n\nKindly transfer Tk. {{amount}} to the {{staffCount}} staff listed for {{month}}.",
      VARS,
    );
    expect(paras).toEqual([
      "Dear Sir,",
      "Kindly transfer Tk. 240,500 to the 25 staff listed for August 2026.",
    ]);
  });

  test("a blank line is a paragraph break; a single newline is not", () => {
    // The renderer spaces paragraphs itself, so a soft wrap the typist happened to put
    // in the box must not become a gap in the printed letter.
    expect(renderAdviceLetterBody("one\ntwo\n\nthree", VARS)).toEqual(["one two", "three"]);
  });

  test("the same placeholder may be used more than once", () => {
    expect(renderAdviceLetterBody("{{month}} — {{month}}", VARS)).toEqual(["August 2026 — August 2026"]);
  });

  test("inner spaces are tolerated, because a person is typing these", () => {
    expect(renderAdviceLetterBody("Tk. {{ amount }}", VARS)).toEqual(["Tk. 240,500"]);
  });
});

describe("a placeholder nobody can fill never reaches a bank", () => {
  test("a typo is reported by name", () => {
    expect(unknownLetterPlaceholders("Tk. {{amont}}/- for {{month}}")).toEqual(["amont"]);
  });

  test("it is listed once however many times it appears", () => {
    expect(unknownLetterPlaceholders("{{oops}} {{oops}}")).toEqual(["oops"]);
    expect(letterPlaceholdersIn("{{month}} {{month}} {{amount}}")).toEqual(["month", "amount"]);
  });

  test("an unknown token is left VERBATIM rather than silently deleted", () => {
    // If the save guard is ever bypassed, the letter must show the mistake rather than
    // print a sentence with a hole where an amount should be.
    expect(renderAdviceLetterBody("Tk. {{amont}}/-", VARS)).toEqual(["Tk. {{amont}}/-"]);
  });

  test("every advertised placeholder is accepted", () => {
    const all = ADVICE_LETTER_PLACEHOLDERS.map((p) => `{{${p}}}`).join(" ");
    expect(unknownLetterPlaceholders(all)).toEqual([]);
    expect(renderAdviceLetterBody(all, VARS)).toEqual([
      ADVICE_LETTER_PLACEHOLDERS.map((p) => VARS[p]).join(" "),
    ]);
  });
});

describe("substitution is literal", () => {
  test("a value containing $& is not re-interpreted by String.replace", () => {
    // A bank name or a note plausibly contains one of these. Left to the default
    // string replacement, `$&` would print the token back and `$1` would print nothing
    // — text nobody typed, on the school's letterhead.
    const paras = renderAdviceLetterBody("Bank: {{bank}}", { ...VARS, bank: "A$&B $1 C$$D" });
    expect(paras).toEqual(["Bank: A$&B $1 C$$D"]);
  });
});
