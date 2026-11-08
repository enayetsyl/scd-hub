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
  items { key label marks ref }
  examiners { userId name studentIds children done absent }
  frozen lockedAt
  progress { children done absent started }
`;
const ROW = `studentId name roll examinerId examinerName absent marks { key value } total done canEdit`;

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
  { paperId: string; items: { key?: string | null; label: string; marks: number; ref?: string | null }[] }
>`
  mutation SaveVivaPaper($paperId: String!, $items: [VivaItemInput!]!) { saveVivaPaper(paperId: $paperId, items: $items) { ${PAPER} } }
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
