/**
 * Guess how a মানবন্টন row is generated from its own wording (D-#745).
 *
 * The syllabus stores a row as free Bangla/English text plus a coarse `itemType`
 * (mostly `other` for Nursery), so the text is the only real signal. The guess is a
 * STARTING POINT: the Office corrects any row once in the plan editor and the
 * correction sticks to that row (by seq + label). Order matters — the combined
 * "আগের ও পরের" must win over the plain "আগের".
 */
import type { WorksheetAxis, WorksheetItemKind } from "@scd/shared";

export interface RowMapping {
  kind: WorksheetItemKind;
  axis: WorksheetAxis | null;
  setSize: number | null;
}

/** The subject's default sequence when the label names none. */
export function defaultAxis(subject: string, label = ""): WorksheetAxis | null {
  if (subject === "ENG") return /small|lower/i.test(label) ? "ENG_LOWER" : "ENG_UPPER";
  if (subject === "MATH") return /English|Rearrange|Write the numbers|\d/.test(label) ? "NUM_EN" : "NUM_BN";
  if (subject === "ARABIC") return "ARABIC";
  if (subject === "BAN") {
    if (/স্বরবর্ণ/.test(label) && !/ব্যঞ্জন/.test(label)) return "BAN_VOWEL";
    if (/ব্যঞ্জনবর্ণ/.test(label) && !/স্বর/.test(label)) return "BAN_CONSONANT";
    return "BAN_ALL";
  }
  return null;
}

/**
 * The 2026 KG BAN/ENG/MATH rows (D-#847). Each pattern is narrow enough that no Nursery or Arabic
 * row matches it (the published rows are pinned in the tests).
 */
function kgRule(l: string, axis: WorksheetAxis | null): RowMapping | null {
  const m = (kind: WorksheetItemKind, ax: WorksheetAxis | null = axis, setSize: number | null = null): RowMapping => ({
    kind,
    axis: ax,
    setSize,
  });
  // Maths
  if (/মিলকরণ|match the (sums|answers)/i.test(l) && /যোগ|বিয়োগ|sum|differ/i.test(l)) return m("MATCH_SUMS");
  if (/দাগ টেনে যোগ/.test(l)) return m("LINE_ADD");
  if (/দাগ টেনে বিয়োগ/.test(l)) return m("LINE_SUB");
  if (/উপরে[-\s]*নিচে যোগ/.test(l)) return m("VERTICAL_ADD");
  if (/উপরে[-\s]*নিচে বিয়োগ/.test(l)) return m("VERTICAL_SUB");
  if (/নামতা|times table|multiplication table/i.test(l)) return m("TIMES_TABLE");
  if (/মাঝের সংখ্যা|number between/i.test(l)) return m("NEIGHBOURS");
  if (/জোড়.*বিজোড়|odd.*even|even.*odd/i.test(l)) return m("ODD_EVEN");
  if (/বড় থেকে ছোট/.test(l)) return m("ORDER_NUMBERS", axis, 8);
  if (/কথায় লেখ|write in words/i.test(l)) return m("NUMBER_WORDS", /English|ইংরেজি/i.test(l) ? "NUM_EN" : "NUM_BN");
  if (/অঙ্কে লেখ|write in numbers/i.test(l)) return m("WRITE_SEQUENCE");
  // Bangla / English
  if (/হারিয়ে যাওয়া/.test(l)) return m("FILL_MISSING");
  if (/কার চিহ্ন/.test(l)) return m("KAR_WORDS", null);
  if (/যুক্তবর্ণ ভে/.test(l)) return m("CONJUNCT_BREAK", null);
  if (/বর্ণ দিয়ে.*শব্দ|words with the given letter/i.test(l)) return m("LETTER_WORDS");
  if (/এলোমেলো শব্দ|jumbled letters to make words/i.test(l)) return m("JUMBLED_WORD", null);
  if (/বিপরীত|opposite/i.test(l)) return m("OPPOSITES", null);
  if (/English meaning/i.test(l)) return m("MEANING_TO_EN", null);
  if (/Bangla meaning|বাংলা অর্থ/i.test(l)) return m("MEANING_TO_BN", null);
  if (/\ba\s*\/\s*an\b/i.test(l)) return m("ARTICLE_A_AN", null);
  if (/বাক্য গঠন/.test(l)) return m("MAKE_SENTENCE", null);
  if (/আমার পরিচয়|myself/i.test(l)) return m("FRAMED_SENTENCES", null);
  if (/দিকের নাম|দিনের নাম|মাসের নাম|days of the week|months of the year/i.test(l)) return m("WRITE_LIST", null);
  if (/নাম লেখ.*\(|name five/i.test(l)) return m("NAME_FIVE", null);
  return null;
}

export function autoMapRow(label: string, itemType: string | null | undefined, subject: string): RowMapping {
  const l = label.trim();
  const axis = defaultAxis(subject, l);
  const m = (kind: WorksheetItemKind, ax: WorksheetAxis | null = axis, setSize: number | null = null): RowMapping => ({
    kind,
    axis: ax,
    setSize,
  });

  if (itemType === "oral" || /মৌখিক|oral|শ্রুতলিপি|dictation|পরিচ্ছন্নতা|neat/i.test(l)) return m("ORAL", null);
  const kg = kgRule(l, axis);
  if (kg) return kg;
  // The 2026 আরবি rows (D-#802). Circling: a row that names a letter (প্রথম অক্ষরে বৃত্ত,
  // হরফে বৃত্ত) circles a letter; otherwise it circles a word (ছবির শব্দে বৃত্ত).
  if (/বৃত্ত|circle/i.test(l)) {
    return /হরফ|অক্ষর|বর্ণ|letter/i.test(l) ? m("PICTURE_CIRCLE_LETTER") : m("PICTURE_CHOOSE_WORD", null);
  }
  if (/টিক|tick/i.test(l)) return m("PICTURE_CHOOSE_WORD", null);
  if (/মাঝের হরফ|হরফের রূপ/.test(l)) return m("MATCH_LETTER_FORM");
  if (/পূর্ণ হরফ/.test(l)) return m("LETTER_FROM_FORM");
  if (/(হরফ|বর্ণ) দিয়ে শব্দ/.test(l)) return m("MATCH_LETTER_WORD");
  if (/শব্দ\s*ভে(ঙ্গে|ঙে)/.test(l)) return m("SPLIT_WORD", null);
  if (/জোড়া লাগিয়ে|জুড়ে/.test(l)) return m("JOIN_LETTERS", null);
  if (/ছবি দেখে (আরবি|শব্দ) লিখ/.test(l)) return m("PICTURE_WRITE_WORD", null);
  // তারতিব = order: the letters are given jumbled, the child writes them in order.
  if (/তারতিব/.test(l)) return m("REARRANGE", axis, 5);
  if (/আগের?\s*(ও|এবং|Number ও)\s*পরের|before\s*(and|&)\s*after|after\s*(and|&)\s*before|আগের Number ও পরের/i.test(l)) {
    return m("BEFORE_AFTER");
  }
  if (/ছবি\s*গণনা|গুনে|count/i.test(l)) return m("COUNT_PICTURES", subject === "MATH" ? axis : "NUM_BN");
  if (/ছবির সাথে সংখ্যা/.test(l)) return m("MATCH_COUNT", subject === "MATH" ? axis : "NUM_BN");
  if (/Number\s*ও\s*সংখ্যা|সংখ্যা\s*মিলিয়ে/i.test(l)) return m("MATCH_NUMERAL", "NUM_EN");
  if (/শব্দ\s*মিল|ছবির সাথে শব্দ|picture.*word|word.*picture/i.test(l)) return m("MATCH_PICTURE_WORD");
  if (/ছবির সাথে বর্ণ|ছবির সাথে অক্ষর|letters? with pictures|match.*letter.*picture|match.*picture.*letter/i.test(l)) {
    return m("MATCH_PICTURE_LETTER");
  }
  if (/ছবি দেখে.*(বর্ণ|অক্ষর)|first letter/i.test(l)) return m("PICTURE_FIRST_LETTER");
  if (/capital.*small|small.*capital/i.test(l)) return m("MATCH_CASE", "ENG_UPPER");
  if (/ছোট থেকে বড়|বড় থেকে ছোট/.test(l)) return m("REARRANGE", axis, 10);
  if (/এলোমেলো|সাজিয়ে|সাজাও|rearrange|jumbled/i.test(l)) {
    return m("REARRANGE", axis, axis === "NUM_BN" || axis === "NUM_EN" ? 10 : 5);
  }
  if (/খালি ঘর|খালি জায়গা|শূন্যস্থান|missing|fill in|gaps|বাদ পড়া/i.test(l)) return m("FILL_MISSING");
  if (/আগের|before/i.test(l)) return m("BEFORE");
  if (/পরের|after/i.test(l)) return m("AFTER");
  if (/বর্ণমালা|ক্রমে|সংখ্যা লেখ|সংখ্যাগুলো লেখ|write the (capital|small)? ?letters|write the numbers|A\s*[–-]\s*Z/i.test(l)) {
    return m("WRITE_SEQUENCE");
  }
  return m("MANUAL", null);
}
