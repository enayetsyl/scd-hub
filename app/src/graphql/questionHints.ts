/**
 * Guardian question hints (GH-1, docs/prd-guardian-help.md §2, D-#1520/#1521).
 * guardian:read_child + the guardian link; question text only - the API has no answer field.
 */
import { gql } from "urql";

export const CHILD_ASSIGNED_QUESTIONS = gql`
  query ChildAssignedQuestions($studentId: String!, $sources: [String!]) {
    childAssignedQuestions(studentId: $studentId, sources: $sources) {
      qid
      textBn
      source
      subject
      date
      hintCount
      opened {
        step
        textBn
      }
    }
  }
`;

export const OPEN_QUESTION_HINT = gql`
  mutation OpenQuestionHint($studentId: String!, $qid: String!, $step: Int!) {
    openQuestionHint(studentId: $studentId, qid: $qid, step: $step) {
      qid
      step
      textBn
      hasNext
    }
  }
`;

export type ChildAssignedQuestion = {
  qid: string;
  textBn: string;
  source: "ASSIGNMENT" | "EXTRA_HOMEWORK" | "HOMEWORK";
  subject: string;
  date: string;
  hintCount: number;
  opened: { step: number; textBn: string }[];
};

export type OpenedQuestionHint = { qid: string; step: number; textBn: string; hasNext: boolean };
