/**
 * CT-RC — unusual-mark recheck operations (server: trackers/resolvers/classTestRecheck.ts).
 * Every percent is percentage points of the test's total (a 20-mark test: 1 mark = 5%).
 */
import { gql } from "urql";
import type { ClassTestPublishOutcomeT } from "./classTest";

export interface CtRecheckRulesT {
  enabled: boolean;
  highPct: number;
  lowPct: number;
  fullMarksBelowPct: number;
  classHighPct: number;
  minPriorTests: number;
  isDefault: boolean;
}

export type CtFlagKindT = "HIGH" | "LOW" | "FULL";

export interface CtRecheckRowT {
  studentId: string;
  studentName: string;
  marks: number;
  totalMarks: number;
  percent: number;
  averagePct: number | null;
  basis: "SUBJECT" | "ALL" | "NONE";
  priorCount: number;
  kinds: CtFlagKindT[];
  confirmed: boolean;
  confirmedAt: string | null;
  confirmedByName: string | null;
  note: string | null;
  submitted: boolean;
  published: boolean;
  held: boolean;
  heldAt: string | null;
}

export interface CtRecheckClassT {
  classPct: number;
  usualPct: number;
  usualTests: number;
  confirmed: boolean;
  confirmedAt: string | null;
  confirmedByName: string | null;
  note: string | null;
}

export interface CtRecheckT {
  testId: string;
  rules: CtRecheckRulesT;
  rows: CtRecheckRowT[];
  classFlag: CtRecheckClassT | null;
  unconfirmedCount: number;
  awaitingApprovalCount: number;
}

export interface CtHeldResultT extends CtRecheckRowT {
  testId: string;
  ctId: string;
  subject: string;
  classLevel: number | null;
  examDate: string;
}

const RULES = `enabled highPct lowPct fullMarksBelowPct classHighPct minPriorTests isDefault`;
const ROW = `studentId studentName marks totalMarks percent averagePct basis priorCount kinds confirmed confirmedAt confirmedByName note submitted published held heldAt`;
const VIEW = `testId rules { ${RULES} } rows { ${ROW} } classFlag { classPct usualPct usualTests confirmed confirmedAt confirmedByName note } unconfirmedCount awaitingApprovalCount`;
const PUBLISH_OUTCOME = `testId unreachableCount recipients { studentId studentName kind messageBn waLink unreachableByWa notifiedGuardianIds publishedVersion }`;

export const CT_RECHECK_QUERY = gql<{ classTestRecheck: CtRecheckT }, { testId: string }>`
  query ClassTestRecheck($testId: String!) { classTestRecheck(testId: $testId) { ${VIEW} } }
`;

export const CONFIRM_CT_RECHECK = gql<
  { confirmClassTestRecheck: CtRecheckT },
  { testId: string; studentId?: string | null; confirmed: boolean; note?: string | null }
>`
  mutation ConfirmClassTestRecheck($testId: String!, $studentId: String, $confirmed: Boolean!, $note: String) {
    confirmClassTestRecheck(testId: $testId, studentId: $studentId, confirmed: $confirmed, note: $note) { ${VIEW} }
  }
`;

export const HOLD_CT_RESULT = gql<
  { holdClassTestResult: CtRecheckT },
  { testId: string; studentId: string; hold: boolean }
>`
  mutation HoldClassTestResult($testId: String!, $studentId: String!, $hold: Boolean!) {
    holdClassTestResult(testId: $testId, studentId: $studentId, hold: $hold) { ${VIEW} }
  }
`;

export const CT_HELD_RESULTS_QUERY = gql<{ classTestHeldResults: CtHeldResultT[] }, Record<string, never>>`
  query ClassTestHeldResults { classTestHeldResults { ${ROW} testId ctId subject classLevel examDate } }
`;

export const RELEASE_HELD_CT_RESULT = gql<
  { releaseHeldClassTestResult: ClassTestPublishOutcomeT },
  { testId: string; studentId: string }
>`
  mutation ReleaseHeldClassTestResult($testId: String!, $studentId: String!) {
    releaseHeldClassTestResult(testId: $testId, studentId: $studentId) { ${PUBLISH_OUTCOME} }
  }
`;

export const CORRECT_HELD_CT_RESULT = gql<
  { correctHeldClassTestResult: ClassTestPublishOutcomeT },
  { testId: string; studentId: string; marks: number }
>`
  mutation CorrectHeldClassTestResult($testId: String!, $studentId: String!, $marks: Float!) {
    correctHeldClassTestResult(testId: $testId, studentId: $studentId, marks: $marks) { ${PUBLISH_OUTCOME} }
  }
`;

export const CT_RECHECK_RULES_QUERY = gql<{ classTestRecheckRules: CtRecheckRulesT }, Record<string, never>>`
  query ClassTestRecheckRules { classTestRecheckRules { ${RULES} } }
`;

export const SAVE_CT_RECHECK_RULES = gql<
  { saveClassTestRecheckRules: CtRecheckRulesT },
  Partial<Omit<CtRecheckRulesT, "isDefault">>
>`
  mutation SaveClassTestRecheckRules(
    $enabled: Boolean, $highPct: Int, $lowPct: Int, $fullMarksBelowPct: Int, $classHighPct: Int, $minPriorTests: Int
  ) {
    saveClassTestRecheckRules(
      enabled: $enabled, highPct: $highPct, lowPct: $lowPct, fullMarksBelowPct: $fullMarksBelowPct,
      classHighPct: $classHighPct, minPriorTests: $minPriorTests
    ) { ${RULES} }
  }
`;
