/**
 * The all-rounder card (SB-7, D-#987): a 0–100 score per area + an overall, beside the
 * progress card. Guardian: childAllRounder; staff profile: studentAllRounder.
 */
import { gql } from "urql";

export interface AllRounderAreaT {
  /** ATTENDANCE | CLASS_TEST | HOMEWORK | ASSIGNMENT | READING | ACTIVITY */
  area: string;
  score: number | null;
  /** STRONG | OK | ATTENTION | NONE | SOON */
  band: string;
  value: number | null;
}

export interface AllRounderT {
  studentId: string;
  score: number | null;
  band: string;
  strongCount: number;
  countedAreas: number;
  areas: AllRounderAreaT[];
}

const FIELDS = `studentId score band strongCount countedAreas areas { area score band value }`;

export const CHILD_ALL_ROUNDER = gql<{ childAllRounder: AllRounderT }, { studentId: string }>`
  query ChildAllRounder($studentId: String!) { childAllRounder(studentId: $studentId) { ${FIELDS} } }
`;

export const STUDENT_ALL_ROUNDER = gql<{ studentAllRounder: AllRounderT }, { studentId: string }>`
  query StudentAllRounder($studentId: String!) { studentAllRounder(studentId: $studentId) { ${FIELDS} } }
`;
