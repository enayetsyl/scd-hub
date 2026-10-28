/**
 * Quran oral exam operations (D-#873–#877, docs/prd-quran-exam.md).
 * Item marks travel FLAT in paper order (section by section); the server reshapes them.
 */
import { gql } from "urql";

export interface QxPaperT {
  id: string;
  level: string;
  scheme: "ITEMS" | "HIFZ_DEDUCTION";
  fullMarks: number;
  durationMin: number;
  sections: { title: string; items: { label: string; marks: number }[] }[];
  paras: number[];
  tanbihPerMark: number | null;
  fathCost: number | null;
  frozen: boolean;
}

export interface QxSittingT {
  id: string;
  studentId: string;
  studentName: string;
  classLabelBn: string;
  level: string;
  dateKey: string;
  start: string;
  end: string;
  examinerId: string;
  examinerName: string;
  paras: number[];
  portionLabel: string;
  status: "SCHEDULED" | "DONE" | "ABSENT";
  itemMarks: number[] | null;
  hifzCounts: { para: number; tanbih: number; fath: number }[];
  comment: string | null;
  absenceReason: string | null;
  total: number | null;
  enteredAt: string | null;
  madeUp: boolean;
}

export interface QxDaySummaryT {
  dateKey: string;
  sittings: number;
  done: number;
  absent: number;
  pending: number;
  examiners: number;
}

export interface QxOverviewT {
  examId: string;
  examName: string;
  status: "DRAFT" | "PUBLISHED";
  publishedAt: string | null;
  marksLockedAt: string | null;
  makeUpDateKey: string | null;
  papers: QxPaperT[];
  days: QxDaySummaryT[];
}

export interface QxDayT {
  examId: string;
  dateKey: string;
  examiners: { userId: string; name: string; sittings: QxSittingT[] }[];
}

export interface QxDetailT {
  sitting: QxSittingT;
  paper: QxPaperT;
  otherSittings: QxSittingT[];
  hifzSoFar: { tanbih: number; fath: number; tanbihCut: number; fathCut: number; mark: number } | null;
  locked: boolean;
  canEdit: boolean;
}

export interface QxResultT {
  studentId: string;
  studentName: string;
  classLabelBn: string;
  level: string;
  fullMarks: number;
  mark: number | null;
  done: number;
  sittings: number;
  absent: boolean;
  tanbih: number | null;
  fath: number | null;
}

export interface QxGuardianChildT {
  examId: string;
  studentId: string;
  studentName: string;
  level: string;
  notice: "NONE" | "SCHEDULE" | "CHANGED";
  version: number;
  sittings: {
    dateKey: string;
    start: string;
    end: string;
    portionLabel: string;
    status: string;
    changed: boolean;
    fromDateKey: string | null;
    fromStart: string | null;
    fromEnd: string | null;
  }[];
}

const PAPER = `id level scheme fullMarks durationMin sections { title items { label marks } } paras tanbihPerMark fathCost frozen`;
const SITTING = `id studentId studentName classLabelBn level dateKey start end examinerId examinerName paras portionLabel status
  itemMarks hifzCounts { para tanbih fath } comment absenceReason total enteredAt madeUp`;
const OVERVIEW = `examId examName status publishedAt marksLockedAt makeUpDateKey papers { ${PAPER} }
  days { dateKey sittings done absent pending examiners }`;
const DETAIL = `sitting { ${SITTING} } paper { ${PAPER} } otherSittings { ${SITTING} }
  hifzSoFar { tanbih fath tanbihCut fathCut mark } locked canEdit`;

export const QX_EXAMS = gql<{ quranExams: QxOverviewT[] }>`
  query QuranExams { quranExams { ${OVERVIEW} } }
`;

export const QX_DAY = gql<{ quranExamDay: QxDayT }, { examId: string; dateKey: string }>`
  query QuranExamDay($examId: String!, $dateKey: String!) {
    quranExamDay(examId: $examId, dateKey: $dateKey) { examId dateKey examiners { userId name sittings { ${SITTING} } } }
  }
`;

export const QX_CANDIDATES = gql<{ quranExamExaminerCandidates: { userId: string; name: string }[] }>`
  query QuranExamExaminerCandidates { quranExamExaminerCandidates { userId name } }
`;

export const QX_RESULTS = gql<{ quranExamResults: QxResultT[] }, { examId: string }>`
  query QuranExamResults($examId: String!) {
    quranExamResults(examId: $examId) { studentId studentName classLabelBn level fullMarks mark done sittings absent tanbih fath }
  }
`;

export const QX_SITTING = gql<{ quranExamSitting: QxDetailT }, { id: string }>`
  query QuranExamSitting($id: String!) { quranExamSitting(id: $id) { ${DETAIL} } }
`;

export const QX_MY_SITTINGS = gql<{ myQuranExamSittings: QxSittingT[] }, { fromDateKey?: string | null }>`
  query MyQuranExamSittings($fromDateKey: String) { myQuranExamSittings(fromDateKey: $fromDateKey) { ${SITTING} } }
`;

export const QX_MY_SCHEDULE = gql<{ myQuranExamSchedule: QxGuardianChildT[] }>`
  query MyQuranExamSchedule {
    myQuranExamSchedule {
      examId studentId studentName level notice version
      sittings { dateKey start end portionLabel status changed fromDateKey fromStart fromEnd }
    }
  }
`;

export const QX_MOVE = gql<{ moveQuranExamSitting: QxSittingT }, { id: string; toExaminerId: string }>`
  mutation MoveQuranExamSitting($id: String!, $toExaminerId: String!) {
    moveQuranExamSitting(id: $id, toExaminerId: $toExaminerId) { ${SITTING} }
  }
`;

export const QX_ADD_EXAMINER = gql<{ addQuranExamExaminer: boolean }, { examId: string; dateKey: string; userId: string }>`
  mutation AddQuranExamExaminer($examId: String!, $dateKey: String!, $userId: String!) {
    addQuranExamExaminer(examId: $examId, dateKey: $dateKey, userId: $userId)
  }
`;

export const QX_REMOVE_EXAMINER = gql<{ removeQuranExamExaminer: number }, { examId: string; dateKey: string; userId: string }>`
  mutation RemoveQuranExamExaminer($examId: String!, $dateKey: String!, $userId: String!) {
    removeQuranExamExaminer(examId: $examId, dateKey: $dateKey, userId: $userId)
  }
`;

export const QX_MAKE_UP = gql<
  { scheduleQuranExamMakeUp: QxSittingT },
  { id: string; dateKey: string; start: string; examinerId: string }
>`
  mutation ScheduleQuranExamMakeUp($id: String!, $dateKey: String!, $start: String!, $examinerId: String!) {
    scheduleQuranExamMakeUp(id: $id, dateKey: $dateKey, start: $start, examinerId: $examinerId) { ${SITTING} }
  }
`;

export const QX_SAVE_RESULT = gql<
  { saveQuranExamResult: QxDetailT },
  {
    id: string;
    present: boolean;
    itemMarks?: number[] | null;
    hifzCounts?: { para: number; tanbih: number; fath: number }[] | null;
    absenceReason?: string | null;
    comment?: string | null;
  }
>`
  mutation SaveQuranExamResult(
    $id: String!, $present: Boolean!, $itemMarks: [Int!], $hifzCounts: [QuranExamHifzCountInput!],
    $absenceReason: String, $comment: String
  ) {
    saveQuranExamResult(
      id: $id, present: $present, itemMarks: $itemMarks, hifzCounts: $hifzCounts,
      absenceReason: $absenceReason, comment: $comment
    ) { ${DETAIL} }
  }
`;

export const QX_PUBLISH = gql<{ publishQuranExam: QxOverviewT }, { examId: string; publish: boolean }>`
  mutation PublishQuranExam($examId: String!, $publish: Boolean!) {
    publishQuranExam(examId: $examId, publish: $publish) { ${OVERVIEW} }
  }
`;

export const QX_LOCK = gql<{ lockQuranExamMarks: QxOverviewT }, { examId: string; lock: boolean }>`
  mutation LockQuranExamMarks($examId: String!, $lock: Boolean!) {
    lockQuranExamMarks(examId: $examId, lock: $lock) { ${OVERVIEW} }
  }
`;

export const QX_ACKNOWLEDGE = gql<{ acknowledgeQuranExamNotice: boolean }, { examId: string; studentId: string; version: number }>`
  mutation AcknowledgeQuranExamNotice($examId: String!, $studentId: String!, $version: Int!) {
    acknowledgeQuranExamNotice(examId: $examId, studentId: $studentId, version: $version)
  }
`;
