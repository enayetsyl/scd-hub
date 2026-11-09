/**
 * Students' Bangla names (AI-4, D-#1131) — mirror server/src/modules/foundation/resolvers/studentBanglaName.ts.
 */
import { gql } from "urql";

export interface BanglaNameRowT {
  studentId: string;
  schoolId: string;
  name: string;
  nameBn: string | null;
  /** Guessed from the English name (D-#1151); "" when none. */
  guessBn: string;
  placeBn: string;
}

export interface BanglaNameReadinessT {
  activeStudents: number;
  withBanglaName: number;
  missingBanglaName: number;
}

const ROW = "studentId schoolId name nameBn guessBn placeBn";

export const STUDENT_BANGLA_NAMES_PAGE = gql<
  { studentBanglaNamesPage: { rows: BanglaNameRowT[]; total: number; page: number; pageSize: number } },
  { page: number; pageSize: number; missingOnly: boolean }
>`
  query StudentBanglaNamesPage($page: Int, $pageSize: Int, $missingOnly: Boolean) {
    studentBanglaNamesPage(page: $page, pageSize: $pageSize, missingOnly: $missingOnly) { rows { ${ROW} } total page pageSize }
  }
`;

export const BANGLA_NAME_READINESS = gql<{ banglaNameReadiness: BanglaNameReadinessT }, Record<string, never>>`
  query BanglaNameReadiness { banglaNameReadiness { activeStudents withBanglaName missingBanglaName } }
`;

export const SET_STUDENT_BANGLA_NAME = gql<{ setStudentBanglaName: BanglaNameRowT }, { studentId: string; nameBn: string }>`
  mutation SetStudentBanglaName($studentId: String!, $nameBn: String!) {
    setStudentBanglaName(studentId: $studentId, nameBn: $nameBn) { ${ROW} }
  }
`;
