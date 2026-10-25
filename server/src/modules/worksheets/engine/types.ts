/**
 * The generated paper's shape (D-#744). One JSON document drives BOTH the in-app
 * preview (native, so a teacher on a phone sees it) and the pdfkit render the
 * Office prints — two renderers, one source, so preview and print cannot disagree.
 */
import type {
  WorksheetAxis,
  WorksheetItemKind,
  WorksheetKind,
  WorksheetPictureBook,
  WorksheetPictureUse,
} from "@scd/shared";
import type { Scope } from "./sequences";

/** One row of the paper plan — a মানবন্টন row plus how it is generated. */
export interface RowSpec {
  seq: number;
  label: string;
  kind: WorksheetItemKind;
  axis?: WorksheetAxis | null;
  /** REARRANGE run length (5 letters, 10 numbers by default). */
  setSize?: number | null;
  count: number;
  marksEach: number;
  /**
   * Teacher-chosen first/last letter (or number) per PART of the question, in the
   * part's own display form ('ক', 'ঞ', 'A', '১২'). Parts: FILL_MISSING = 1 (the cells shown);
   * WRITE_SEQUENCE = 2 for স্বর+ব্যঞ্জন (vowels, consonants) else 1; REARRANGE = one per
   * line; BEFORE/AFTER/BEFORE_AFTER = one per column (2). A missing or unresolvable
   * part falls back to the automatic choice.
   */
  ranges?: Array<LetterRange | null> | null;
}

export interface LetterRange {
  from: string;
  to: string;
}

/** What the engine needs to know about a bank picture — never its bytes. */
export interface PictureRef {
  id: string;
  book: WorksheetPictureBook;
  word?: string | null;
  letter?: string | null;
  /** The book page's letter (ব্যাঙ → ঙ); MATCH uses it, null = `letter`. */
  pageLetter?: string | null;
  uses: WorksheetPictureUse[];
  /** Printed within the recent window — used only when the pool runs short. */
  recent: boolean;
  /** Kept for the final: an assignment/class test never draws it. */
  reserved: boolean;
}

/** A grid cell: `t` is printed; a blank cell has `t === ""` and its answer in `a`. */
export interface Cell {
  t: string;
  a?: string | null;
}

export type SectionLayout =
  | "grid"
  | "groups"
  | "jumble"
  | "rows"
  | "columns"
  | "pictures"
  | "choice"
  | "prompts"
  | "vertical"
  | "match"
  | "oral"
  | "manual";

/** One line of answer boxes under (or beside) a prompt — e.g. "জোড় | _ | _ | _". */
export interface PromptLine {
  /** Caption before the boxes ("জোড়", "ভেঙে লেখ"). */
  label?: string | null;
  blanks: number;
  /** The key, one per box. */
  answers?: string[] | null;
  /** One wide box for a word or a sentence instead of letter-sized boxes. */
  wide?: boolean;
}

/** A KG prompt question (D-#846): what is given, then the child's boxes. */
export interface PromptItem {
  /** What is given ("২২ =", "বিপরীত শব্দ: ভালো", a sentence with "____"); "" = none. */
  prompt: string;
  /** `prompt` is a sentence with a "____" gap the child writes in (a/an, আমার পরিচয়). */
  sentence?: boolean;
  /** Leave room under the prompt to draw (দাগ টেনে যোগ — tally sticks). */
  tall?: boolean;
  lines: PromptLine[];
  /** The key for a sentence gap. */
  gapAnswer?: string | null;
}

/** উপরে-নিচে যোগ/বিয়োগ: a over b with the operator, an answer box below. */
export interface VerticalSum {
  a: string;
  b: string;
  op: "+" | "−";
  answer: string;
}

/** A picture with printed options; the child circles (or ticks) one. `answer` indexes `options`. */
export interface Choice {
  pictureId: string | null;
  options: string[];
  answer: number;
}

export interface Section {
  /** 1-based question number. */
  n: number;
  /** The মানবন্টন row's own wording — the paper speaks the syllabus's language. */
  label: string;
  /** A short scope note under the label ("১১ থেকে ২৫ পর্যন্ত"). */
  note?: string | null;
  marks: number;
  kind: WorksheetItemKind;
  layout: SectionLayout;
  cols?: number;
  cells?: Cell[];
  /** jumble: one line per set; `label` names the direction of an ordering set ("ছোট থেকে বড়"). */
  sets?: Array<{ shown: string[]; answer: string[]; label?: string | null }>;
  rows?: Cell[][];
  /** groups: sub-questions under one number (ক) স্বরবর্ণ, খ) ব্যঞ্জনবর্ণ). */
  groups?: Array<{ label: string; note?: string | null; cols: number; cells: Cell[] }>;
  /** columns: before/after items laid out column by column, top to bottom. */
  columns?: Cell[][][];
  pictures?: Array<{ pictureId: string; repeat: number; a: string }>;
  choices?: Choice[];
  items?: PromptItem[];
  sums?: VerticalSum[];
  /** rows / pictures: the answer is a word, so one wide box per item, not a letter box. */
  wide?: boolean;
  left?: Array<{ pictureId: string | null; repeat: number; t: string | null }>;
  right?: string[];
  /** match: `answer[i]` is the index in `right` that belongs to `left[i]`. */
  answer?: number[];
  lines?: number;
}

export interface GenerateInput {
  kind: WorksheetKind;
  subject: string;
  rows: RowSpec[];
  scope: Scope;
  seed: number;
  pictures: PictureRef[];
  /** The book a picture/word question draws on, when the subject alone does not say: a KG
   *  আরবি paper uses রওযাতুল আতফাল ২ (ARABIC_KG, D-#806). Absent = the subject's book. */
  pictureBook?: WorksheetPictureBook | null;
}

export interface WorksheetDoc {
  sections: Section[];
  /** Σ marks actually printed (a short picture pool can lower a row — see warnings). */
  total: number;
  pictureIds: string[];
  /** Bangla, shown above the preview — e.g. a row printed fewer items than asked. */
  warnings: string[];
  /** Handwriting guide lines inside every writing box (owner 2026-10-16). */
  ruled?: boolean;
  /** Which copybook: BAN = two blue lines (মাত্রা + base); ENG = the four-line English
   *  khata, red / blue / blue / red. Absent on papers stored before it = BAN. */
  ruling?: "BAN" | "ENG";
  /** Arabic is written right to left: grids, item cells and options run from the right
   *  (as the 2025 Nursery paper prints ا in the right-hand box). Absent = left to right. */
  dir?: "rtl";
}
