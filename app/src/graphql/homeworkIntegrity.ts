/**
 * Homework-honesty check (GH-3, D-#1522). Office / Principal only - `homework_integrity:view` / `:record`.
 * Nothing here is guardian-facing. `childHintSteps` is the teacher's read-only hint count (mastery:view).
 */
import { gql } from "urql";

const ROW = `
  id studentId studentName studentSchoolId classToken classNameBn sectionId sectionNameBn subject loCode loLabelBn
  hwPct ctPct gap status outcome note openedAt closedAt recurring
`;

export type IntegrityRowT = {
  id: string;
  studentId: string;
  studentName: string;
  studentSchoolId: string;
  classToken: string;
  classNameBn: string;
  sectionId: string;
  sectionNameBn: string;
  subject: string;
  loCode: string;
  loLabelBn: string;
  hwPct: number;
  ctPct: number;
  gap: number;
  status: "OPEN" | "CLOSED";
  outcome: string | null;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
  recurring: boolean;
};

export type IntegrityItemT = {
  paperId: string;
  qid: string | null;
  itemNo: number | null;
  earned: number;
  available: number;
  date: string;
  hintStep: number;
};

export type IntegrityDetailT = {
  row: IntegrityRowT;
  hwItems: IntegrityItemT[];
  ctItems: IntegrityItemT[];
  history: { at: string; hwPct: number; ctPct: number }[];
};

export const HOMEWORK_INTEGRITY_CASES = gql`
  query HomeworkIntegrityCases($status: String, $classToken: String, $sectionId: String, $subject: String) {
    homeworkIntegrityCases(status: $status, classToken: $classToken, sectionId: $sectionId, subject: $subject) { ${ROW} }
  }
`;

export const HOMEWORK_INTEGRITY_CASE = gql`
  query HomeworkIntegrityCase($id: String!) {
    homeworkIntegrityCase(id: $id) {
      row { ${ROW} }
      hwItems { paperId qid itemNo earned available date hintStep }
      ctItems { paperId qid itemNo earned available date hintStep }
      history { at hwPct ctPct }
    }
  }
`;

export const RECORD_HOMEWORK_INTEGRITY_OUTCOME = gql`
  mutation RecordHomeworkIntegrityOutcome($id: String!, $outcome: String!, $note: String) {
    recordHomeworkIntegrityOutcome(id: $id, outcome: $outcome, note: $note) { ${ROW} }
  }
`;

export const RECOMPUTE_HOMEWORK_INTEGRITY = gql`
  mutation RecomputeHomeworkIntegrity {
    recomputeHomeworkIntegrity { checked opened updated reopened }
  }
`;

export const CHILD_HINT_STEPS = gql`
  query ChildHintSteps($studentId: String!, $assignmentId: String!, $qids: [String!]!) {
    childHintSteps(studentId: $studentId, assignmentId: $assignmentId, qids: $qids) { qid step }
  }
`;
