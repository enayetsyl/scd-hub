/**
 * Exam operations (SY-1). Thin on purpose — `docs/prd-exams.md` EX-1 extends the
 * exam row with the grade scale, status and CT aggregation; none of that exists yet.
 */
import { gql } from "urql";

export interface ExamT {
  id: string;
  academicYearId: string;
  /** HALF_YEARLY | ANNUAL */
  term: string;
  name: string;
  startDateKey: string | null;
  endDateKey: string | null;
}

const EXAM_FIELDS = `id academicYearId term name startDateKey endDateKey`;

export const EXAMS = gql<{ exams: ExamT[] }, { academicYearId?: string | null }>`
  query Exams($academicYearId: String) {
    exams(academicYearId: $academicYearId) { ${EXAM_FIELDS} }
  }
`;

export const CREATE_EXAM = gql<
  { createExam: ExamT },
  {
    academicYearId: string;
    term: string;
    name: string;
    startDateKey?: string | null;
    endDateKey?: string | null;
  }
>`
  mutation CreateExam(
    $academicYearId: String!
    $term: String!
    $name: String!
    $startDateKey: String
    $endDateKey: String
  ) {
    createExam(
      academicYearId: $academicYearId
      term: $term
      name: $name
      startDateKey: $startDateKey
      endDateKey: $endDateKey
    ) { ${EXAM_FIELDS} }
  }
`;
