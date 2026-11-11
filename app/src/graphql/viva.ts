/**
 * Nursery & KG oral exam (viva) operations — D-#1080–#1084, docs/prd-viva.md.
 * Marks are saved one tap at a time (setVivaMark / setVivaAbsent); halves are allowed.
 */
import { gql } from "urql";

export interface VivaItemT {
  key: string;
  label: string;
  marks: number;
  ref: string;
  /** Letter question (D-#1277): each letter marked 0 … partMarks, stored as `<key>:<i>`. */
  parts: string[];
  partMarks: number;
  /** Picture question (D-#1282): one bank picture per part (parts = the answer words). */
  pictureIds: string[];
}

/** A picture shown in a picture question (data: URI) — full size on the sheet, a thumbnail in the bank. */
export interface VivaPictureT {
  id: string;
  word: string;
  wordEn: string;
  letter: string;
  book: string;
  page: number;
  active: boolean;
  uri: string;
}

/** One question set (D-#1275). `drawn` = present children given this set so far. */
export interface VivaSetT {
  key: string;
  label: string;
  items: VivaItemT[];
  drawn: number;
}

export interface VivaExaminerT {
  userId: string;
  name: string;
  studentIds: string[];
  children: number;
  done: number;
  absent: number;
}

export interface VivaPaperT {
  id: string;
  examId: string;
  examName: string;
  classId: string;
  classLevel: number;
  classLabelBn: string;
  subject: string;
  subjectLabelBn: string;
  dateKey: string;
  fullMarks: number;
  syllabusMarks: number | null;
  items: VivaItemT[];
  sets: VivaSetT[];
  examiners: VivaExaminerT[];
  frozen: boolean;
  lockedAt: string | null;
  progress: { children: number; done: number; absent: number; started: number };
}

export interface VivaRowT {
  studentId: string;
  name: string;
  roll: string;
  examinerId: string | null;
  examinerName: string;
  absent: boolean;
  /** The child's set; null until the examiner taps the name (D-#1276). */
  setKey: string | null;
  needsDraw: boolean;
  marks: { key: string; value: number }[];
  total: number;
  done: boolean;
  canEdit: boolean;
}

export interface VivaSheetT {
  paper: VivaPaperT;
  rows: VivaRowT[];
  seesAll: boolean;
}

export interface VivaOverviewT {
  examId: string;
  examName: string;
  papers: VivaPaperT[];
}

const PAPER = `
  id examId examName classId classLevel classLabelBn subject subjectLabelBn dateKey fullMarks syllabusMarks
  items { key label marks ref parts partMarks pictureIds }
  sets { key label drawn items { key label marks ref parts partMarks pictureIds } }
  examiners { userId name studentIds children done absent }
  frozen lockedAt
  progress { children done absent started }
`;
const ROW = `studentId name roll examinerId examinerName absent setKey needsDraw marks { key value } total done canEdit`;

export const VIVA_OVERVIEW = gql<{ vivaOverview: VivaOverviewT[] }>`
  query VivaOverview { vivaOverview { examId examName papers { ${PAPER} } } }
`;

export const MY_VIVA_PAPERS = gql<{ myVivaPapers: VivaPaperT[] }>`
  query MyVivaPapers { myVivaPapers { ${PAPER} } }
`;

export const VIVA_SHEET = gql<{ vivaSheet: VivaSheetT }, { paperId: string }>`
  query VivaSheet($paperId: String!) { vivaSheet(paperId: $paperId) { paper { ${PAPER} } rows { ${ROW} } seesAll } }
`;

export const VIVA_CANDIDATES = gql<{ vivaExaminerCandidates: { userId: string; name: string }[] }>`
  query VivaExaminerCandidates { vivaExaminerCandidates { userId name } }
`;

export const VIVA_SAVE_PAPER = gql<
  { saveVivaPaper: VivaPaperT },
  { paperId: string; sets: { key?: string | null; label?: string | null; items: VivaItemInputT[] }[] }
>`
  mutation SaveVivaPaper($paperId: String!, $sets: [VivaSetInput!]!) { saveVivaPaper(paperId: $paperId, sets: $sets) { ${PAPER} } }
`;

export interface VivaItemInputT {
  key?: string | null;
  label: string;
  marks: number;
  ref?: string | null;
  parts?: string[] | null;
  partMarks?: number | null;
  pictureIds?: string[] | null;
}

/** The pictures a paper's picture questions show (full size), fetched once per sheet (D-#1282). */
export const VIVA_PICTURES = gql<{ vivaPictures: VivaPictureT[] }, { paperId: string }>`
  query VivaPictures($paperId: String!) { vivaPictures(paperId: $paperId) { id word wordEn letter book page active uri } }
`;

/** Office: one book's worksheet pictures (thumbnails) to build a picture question from. */
export const VIVA_PICTURE_BANK = gql<{ vivaPictureBank: VivaPictureT[] }, { book: string }>`
  query VivaPictureBank($book: String!) { vivaPictureBank(book: $book) { id word wordEn letter book page active uri } }
`;

/** The examiner's tap on a child's name: draws their set (evenly, final — D-#1276). */
export const VIVA_DRAW_SET = gql<{ drawVivaSet: VivaRowT }, { paperId: string; studentId: string }>`
  mutation DrawVivaSet($paperId: String!, $studentId: String!) { drawVivaSet(paperId: $paperId, studentId: $studentId) { ${ROW} } }
`;

export const VIVA_SAVE_EXAMINERS = gql<
  { saveVivaExaminers: VivaPaperT },
  { paperId: string; examiners: { userId: string; studentIds: string[] }[] }
>`
  mutation SaveVivaExaminers($paperId: String!, $examiners: [VivaExaminerInput!]!) {
    saveVivaExaminers(paperId: $paperId, examiners: $examiners) { ${PAPER} }
  }
`;

export const VIVA_SET_MARK = gql<
  { setVivaMark: VivaRowT },
  { paperId: string; studentId: string; key: string; value?: number | null }
>`
  mutation SetVivaMark($paperId: String!, $studentId: String!, $key: String!, $value: Float) {
    setVivaMark(paperId: $paperId, studentId: $studentId, key: $key, value: $value) { ${ROW} }
  }
`;

export const VIVA_SET_ABSENT = gql<{ setVivaAbsent: VivaRowT }, { paperId: string; studentId: string; absent: boolean }>`
  mutation SetVivaAbsent($paperId: String!, $studentId: String!, $absent: Boolean!) {
    setVivaAbsent(paperId: $paperId, studentId: $studentId, absent: $absent) { ${ROW} }
  }
`;

export const VIVA_LOCK = gql<{ lockVivaPaper: VivaPaperT }, { paperId: string; lock: boolean }>`
  mutation LockVivaPaper($paperId: String!, $lock: Boolean!) { lockVivaPaper(paperId: $paperId, lock: $lock) { ${PAPER} } }
`;

/** 2.5 → "২½", 0.5 → "½", 0 → "০". */
export function vivaNum(n: number): string {
  const d = (x: number) => String(x).replace(/[0-9]/g, (c) => "০১২৩৪৫৬৭৮৯"[Number(c)]!);
  const whole = Math.floor(n + 1e-9);
  const half = n - whole >= 0.5 - 1e-9;
  if (half && whole === 0) return "½";
  return d(whole) + (half ? "½" : "");
}

/** The mark buttons of a question: 0, ½, 1 … max (halves allowed, D-#1082). */
export function vivaSteps(max: number): number[] {
  const out: number[] = [];
  for (let x = 0; x <= max + 1e-9; x += 0.5) out.push(Math.round(x * 2) / 2);
  return out;
}

/** The questions a row is marked on: its set's, or [] before the draw. */
export function vivaItemsOf(paper: VivaPaperT, row: Pick<VivaRowT, "setKey">): VivaItemT[] {
  if (paper.sets.length <= 1) return paper.sets[0]?.items ?? paper.items;
  return paper.sets.find((s) => s.key === row.setKey)?.items ?? [];
}

/** "সেট ২" for a row on a paper with sets; "" on a one-set paper or before the draw. */
export function vivaSetLabel(paper: VivaPaperT, setKey: string | null): string {
  if (paper.sets.length <= 1 || !setKey) return "";
  return paper.sets.find((s) => s.key === setKey)?.label ?? "";
}

/** A question's mark from the row's taps (letter questions sum their letters); null until
 *  fully marked. */
export function vivaItemValue(it: VivaItemT, byKey: Map<string, number>): number | null {
  if (!it.parts.length) return byKey.has(it.key) ? byKey.get(it.key)! : null;
  let sum = 0;
  for (let i = 0; i < it.parts.length; i++) {
    const v = byKey.get(`${it.key}:${i}`);
    if (v == null) return null;
    sum += v;
  }
  return sum;
}
