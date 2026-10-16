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
}

/** What the engine needs to know about a bank picture — never its bytes. */
export interface PictureRef {
  id: string;
  book: WorksheetPictureBook;
  word?: string | null;
  letter?: string | null;
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

export type SectionLayout = "grid" | "jumble" | "rows" | "pictures" | "match" | "oral" | "manual";

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
  sets?: Array<{ shown: string[]; answer: string[] }>;
  rows?: Cell[][];
  pictures?: Array<{ pictureId: string; repeat: number; a: string }>;
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
}

export interface WorksheetDoc {
  sections: Section[];
  /** Σ marks actually printed (a short picture pool can lower a row — see warnings). */
  total: number;
  pictureIds: string[];
  /** Bangla, shown above the preview — e.g. a row printed fewer items than asked. */
  warnings: string[];
}
