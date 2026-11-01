/**
 * Exam routine operations (D-#883): the date-by-date routine per class, read in the
 * syllabus section beside the Quran exam's days.
 */
import { gql } from "urql";

export interface ExamRoutineSlotT {
  dateKey: string;
  subject: string;
  kind: "WRITTEN" | "ORAL";
  start: string;
  end: string;
  note: string;
}

export interface ExamRoutineClassT {
  classId: string;
  level: number;
  labelBn: string;
  slots: ExamRoutineSlotT[];
}

export interface ExamRoutineQuranDayT {
  dateKey: string;
  levels: string[];
  start: string;
  end: string;
  makeUp: boolean;
}

export interface ExamRoutineT {
  examId: string;
  examName: string;
  published: boolean;
  publishedAt: string | null;
  noteBn: string;
  classes: ExamRoutineClassT[];
  quranDays: ExamRoutineQuranDayT[];
}

export interface GuardianExamRoutineT {
  examId: string;
  examName: string;
  published: boolean;
  noteBn: string;
  classLabelBn: string;
  slots: ExamRoutineSlotT[];
  quranSittings: { dateKey: string; start: string; end: string; level: string; portionLabel: string }[];
}

const ROUTINE = `
  examId examName published publishedAt noteBn
  classes { classId level labelBn slots { dateKey subject kind start end note } }
  quranDays { dateKey levels start end makeUp }
`;

export const EXAM_ROUTINE = gql<{ examRoutine: ExamRoutineT }, { examId: string }>`
  query ExamRoutine($examId: String!) {
    examRoutine(examId: $examId) { ${ROUTINE} }
  }
`;

export const GUARDIAN_EXAM_ROUTINE = gql<{ guardianExamRoutine: GuardianExamRoutineT }, { examId: string; studentId: string }>`
  query GuardianExamRoutine($examId: String!, $studentId: String!) {
    guardianExamRoutine(examId: $examId, studentId: $studentId) {
      examId examName published noteBn classLabelBn
      slots { dateKey subject kind start end note }
      quranSittings { dateKey start end level portionLabel }
    }
  }
`;

export const SAVE_EXAM_ROUTINE_CLASS = gql<
  { saveExamRoutineClass: ExamRoutineT },
  { examId: string; classId: string; slots: Omit<ExamRoutineSlotT, never>[]; noteBn?: string | null }
>`
  mutation SaveExamRoutineClass($examId: String!, $classId: String!, $slots: [ExamRoutineSlotInput!]!, $noteBn: String) {
    saveExamRoutineClass(examId: $examId, classId: $classId, slots: $slots, noteBn: $noteBn) { ${ROUTINE} }
  }
`;

export const PUBLISH_EXAM_ROUTINE = gql<{ publishExamRoutine: ExamRoutineT }, { examId: string; publish: boolean }>`
  mutation PublishExamRoutine($examId: String!, $publish: Boolean!) {
    publishExamRoutine(examId: $examId, publish: $publish) { ${ROUTINE} }
  }
`;
