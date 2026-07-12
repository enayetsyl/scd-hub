/**
 * Typed GraphQL operations for the Class Test Tracker (CT-5 app surfaces over the
 * merged CT-1..CT-4 resolvers). Hand-authored to mirror the server resolvers
 * (server/src/modules/trackers/resolvers/classTest*.ts) exactly — no server change.
 * Kept in its own module to avoid bloating the 4.7k-line operations.ts.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

// ---------------------------------------------------------------------------
// ClassTest header / print request (CT-1)
// ---------------------------------------------------------------------------

export interface ClassTestT {
  id: string;
  ctId: string;
  academicYearId: string;
  classLevel: number;
  classId: string;
  sectionId: string;
  subject: string;
  testNumber: number;
  examDate: string;
  totalMarks: number;
  passMark: number;
  source: string;
  setId: string | null;
  questionFileId: string | null;
  status: string;
  deadlineDays: number;
  requestedBy: string;
  requestedAt: string;
  printedBy: string | null;
  printedAt: string | null;
  notes: string | null;
}

const CLASS_TEST_FIELDS = `id ctId academicYearId classLevel classId sectionId subject testNumber examDate totalMarks passMark source setId questionFileId status deadlineDays requestedBy requestedAt printedBy printedAt notes`;

// PQ-5 (D-#281): the class-test print queue was absorbed into the unified PrintRequest
// queue (`app/src/graphql/printing.ts`). The server resolvers remain for back-compat and
// mirror onto the queue row, but the app drives everything through the one queue.

export const MY_CLASS_TESTS_QUERY = gql<{ myClassTests: ClassTestT[] }, NoVars>`
  query MyClassTests { myClassTests { ${CLASS_TEST_FIELDS} } }
`;

export const CLASS_TESTS_FOR_SECTION_QUERY = gql<
  { classTestsForSection: ClassTestT[] },
  { sectionId: string; classId: string }
>`
  query ClassTestsForSection($sectionId: String!, $classId: String!) {
    classTestsForSection(sectionId: $sectionId, classId: $classId) { ${CLASS_TEST_FIELDS} }
  }
`;

export const CLASS_TEST_QUERY = gql<{ classTest: ClassTestT | null }, { id: string }>`
  query ClassTest($id: String!) { classTest(id: $id) { ${CLASS_TEST_FIELDS} } }
`;

export const SUGGEST_CLASS_TEST_NUMBER_QUERY = gql<
  { suggestClassTestNumber: number },
  { sectionId: string; subject: string }
>`
  query SuggestClassTestNumber($sectionId: String!, $subject: String!) {
    suggestClassTestNumber(sectionId: $sectionId, subject: $subject)
  }
`;

export const CREATE_CLASS_TEST_REQUEST = gql<
  { createClassTestRequest: ClassTestT },
  {
    sectionId: string;
    subject: string;
    examDate: string;
    totalMarks: number;
    passMark?: number | null;
    source: string;
    setId?: string | null;
    questionFileId?: string | null;
    testNumber?: number | null;
    deadlineDays?: number | null;
    notes?: string | null;
  }
>`
  mutation CreateClassTestRequest(
    $sectionId: String!, $subject: String!, $examDate: String!, $totalMarks: Int!,
    $passMark: Int, $source: String!, $setId: String, $questionFileId: String,
    $testNumber: Int, $deadlineDays: Int, $notes: String
  ) {
    createClassTestRequest(
      sectionId: $sectionId, subject: $subject, examDate: $examDate, totalMarks: $totalMarks,
      passMark: $passMark, source: $source, setId: $setId, questionFileId: $questionFileId,
      testNumber: $testNumber, deadlineDays: $deadlineDays, notes: $notes
    ) { ${CLASS_TEST_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// Per-student results (CT-2)
// ---------------------------------------------------------------------------

export interface ClassTestResultT {
  id: string;
  testId: string;
  studentId: string;
  status: string;
  marks: number | null;
  totalMarks: number;
  percent: number | null;
  pass: boolean | null;
  weakness: string | null;
  teacherAction: string | null;
  guardianAction: string | null;
  submittedAt: string | null;
  sendBackReason: string | null;
  publishedAt: string | null;
  publishedVersion: number;
}

const CLASS_TEST_RESULT_FIELDS = `id testId studentId status marks totalMarks percent pass weakness teacherAction guardianAction submittedAt sendBackReason publishedAt publishedVersion`;

export const CLASS_TEST_RESULTS_QUERY = gql<{ classTestResults: ClassTestResultT[] }, { testId: string }>`
  query ClassTestResults($testId: String!) { classTestResults(testId: $testId) { ${CLASS_TEST_RESULT_FIELDS} } }
`;

export const ENTER_CLASS_TEST_RESULT = gql<
  { enterClassTestResult: ClassTestResultT },
  {
    testId: string;
    studentId: string;
    status: string;
    marks?: number | null;
    weakness?: string | null;
    teacherAction?: string | null;
    guardianAction?: string | null;
  }
>`
  mutation EnterClassTestResult(
    $testId: String!, $studentId: String!, $status: String!, $marks: Float,
    $weakness: String, $teacherAction: String, $guardianAction: String
  ) {
    enterClassTestResult(
      testId: $testId, studentId: $studentId, status: $status, marks: $marks,
      weakness: $weakness, teacherAction: $teacherAction, guardianAction: $guardianAction
    ) { ${CLASS_TEST_RESULT_FIELDS} }
  }
`;

export interface ClassTestReportStatusT {
  testId: string;
  ctId: string;
  examDate: string;
  deadline: string;
  deadlineDays: number;
  rosterCount: number;
  enteredCount: number;
  presentCount: number;
  absentCount: number;
  pendingCount: number;
  complete: boolean;
  overdue: boolean;
  schoolDaysLate: number;
}

export const CLASS_TEST_REPORT_STATUS_QUERY = gql<
  { classTestReportStatus: ClassTestReportStatusT },
  { testId: string; asOf?: string | null }
>`
  query ClassTestReportStatus($testId: String!, $asOf: String) {
    classTestReportStatus(testId: $testId, asOf: $asOf) {
      testId ctId examDate deadline deadlineDays rosterCount enteredCount presentCount
      absentCount pendingCount complete overdue schoolDaysLate
    }
  }
`;

// ---------------------------------------------------------------------------
// Publish / unpublish (CT-3)
// ---------------------------------------------------------------------------

export interface ClassTestPublishRecipientT {
  studentId: string;
  studentName: string;
  kind: string;
  messageBn: string;
  waLink: string | null;
  unreachableByWa: boolean;
  notifiedGuardianIds: string[];
  publishedVersion: number;
}
export interface ClassTestPublishOutcomeT {
  testId: string;
  recipients: ClassTestPublishRecipientT[];
  unreachableCount: number;
}
export interface ClassTestUnpublishOutcomeT {
  testId: string;
  unpublishedCount: number;
}

const PUBLISH_OUTCOME_FIELDS = `testId unreachableCount recipients { studentId studentName kind messageBn waLink unreachableByWa notifiedGuardianIds publishedVersion }`;

export const PUBLISH_CLASS_TEST_RESULT = gql<
  { publishClassTestResult: ClassTestPublishOutcomeT },
  { testId: string; studentId: string }
>`
  mutation PublishClassTestResult($testId: String!, $studentId: String!) {
    publishClassTestResult(testId: $testId, studentId: $studentId) { ${PUBLISH_OUTCOME_FIELDS} }
  }
`;
export const PUBLISH_CLASS_TEST_EXAM = gql<{ publishClassTestExam: ClassTestPublishOutcomeT }, { testId: string }>`
  mutation PublishClassTestExam($testId: String!) { publishClassTestExam(testId: $testId) { ${PUBLISH_OUTCOME_FIELDS} } }
`;
export const UNPUBLISH_CLASS_TEST_RESULT = gql<
  { unpublishClassTestResult: ClassTestUnpublishOutcomeT },
  { testId: string; studentId: string }
>`
  mutation UnpublishClassTestResult($testId: String!, $studentId: String!) {
    unpublishClassTestResult(testId: $testId, studentId: $studentId) { testId unpublishedCount }
  }
`;
export const UNPUBLISH_CLASS_TEST_EXAM = gql<{ unpublishClassTestExam: ClassTestUnpublishOutcomeT }, { testId: string }>`
  mutation UnpublishClassTestExam($testId: String!) { unpublishClassTestExam(testId: $testId) { testId unpublishedCount } }
`;

// CT-8 approval gate
export interface ClassTestSubmitOutcomeT {
  testId: string;
  count: number;
}
export const SUBMIT_CLASS_TEST_EXAM = gql<{ submitClassTestExam: ClassTestSubmitOutcomeT }, { testId: string }>`
  mutation SubmitClassTestExam($testId: String!) { submitClassTestExam(testId: $testId) { testId count } }
`;
export const RECALL_CLASS_TEST_EXAM = gql<{ recallClassTestExam: ClassTestSubmitOutcomeT }, { testId: string }>`
  mutation RecallClassTestExam($testId: String!) { recallClassTestExam(testId: $testId) { testId count } }
`;
export const SEND_BACK_CLASS_TEST_EXAM = gql<
  { sendBackClassTestExam: ClassTestSubmitOutcomeT },
  { testId: string; reason: string }
>`
  mutation SendBackClassTestExam($testId: String!, $reason: String!) {
    sendBackClassTestExam(testId: $testId, reason: $reason) { testId count }
  }
`;

// ---------------------------------------------------------------------------
// Read aggregates (CT-4)
// ---------------------------------------------------------------------------

export interface ClassTestReportStatusRowT {
  testId: string;
  ctId: string;
  subject: string;
  testNumber: number;
  classLevel: number;
  sectionId: string;
  teacherId: string;
  examDate: string;
  deadline: string;
  deadlineDays: number;
  rosterCount: number;
  enteredCount: number;
  presentCount: number;
  absentCount: number;
  pendingCount: number;
  complete: boolean;
  overdue: boolean;
  schoolDaysLate: number;
  state: string;
}

export interface ClassTestSummaryVars {
  academicYearId?: string | null;
  classLevel?: number | null;
  sectionId?: string | null;
  subject?: string | null;
  teacherId?: string | null;
  asOf?: string | null;
}

const SUMMARY_ARG_DEFS = `$academicYearId: String, $classLevel: Int, $sectionId: String, $subject: String, $teacherId: String, $asOf: String`;
const SUMMARY_ARG_USE = `academicYearId: $academicYearId, classLevel: $classLevel, sectionId: $sectionId, subject: $subject, teacherId: $teacherId, asOf: $asOf`;

export const CLASS_TEST_REPORTS_STATUS_QUERY = gql<
  { classTestReportsStatus: ClassTestReportStatusRowT[] },
  ClassTestSummaryVars
>`
  query ClassTestReportsStatus(${SUMMARY_ARG_DEFS}) {
    classTestReportsStatus(${SUMMARY_ARG_USE}) {
      testId ctId subject testNumber classLevel sectionId teacherId examDate deadline deadlineDays
      rosterCount enteredCount presentCount absentCount pendingCount complete overdue schoolDaysLate state
    }
  }
`;

export interface ClassTestOverdueByTeacherT {
  teacherId: string;
  teacherName: string;
  overdueCount: number;
}
export interface ClassTestDashboardT {
  logged: number;
  complete: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
  completionRatePct: number | null;
  overdueByTeacher: ClassTestOverdueByTeacherT[];
}

export const CLASS_TEST_DASHBOARD_QUERY = gql<
  { classTestPrincipalDashboard: ClassTestDashboardT },
  ClassTestSummaryVars
>`
  query ClassTestDashboard(${SUMMARY_ARG_DEFS}) {
    classTestPrincipalDashboard(${SUMMARY_ARG_USE}) {
      logged complete inProgress notStarted overdue completionRatePct
      overdueByTeacher { teacherId teacherName overdueCount }
    }
  }
`;

export interface ClassSubjectStudentT {
  studentId: string;
  studentName: string;
  percents: number[];
  latestPercent: number | null;
  previousPercent: number | null;
  trend: string;
  examsTaken: number;
}
export interface ClassTestClassSubjectAnalysisT {
  sectionId: string;
  subject: string;
  examCount: number;
  students: ClassSubjectStudentT[];
}

export const CLASS_TEST_CLASS_SUBJECT_QUERY = gql<
  { classTestClassSubjectAnalysis: ClassTestClassSubjectAnalysisT },
  { sectionId: string; subject: string }
>`
  query ClassTestClassSubject($sectionId: String!, $subject: String!) {
    classTestClassSubjectAnalysis(sectionId: $sectionId, subject: $subject) {
      sectionId subject examCount
      students { studentId studentName percents latestPercent previousPercent trend examsTaken }
    }
  }
`;

export interface ClassTestProfileResultT {
  testId: string;
  ctId: string;
  subject: string;
  testNumber: number;
  examDate: string;
  status: string;
  marks: number | null;
  totalMarks: number;
  percent: number | null;
  pass: boolean | null;
  weakness: string | null;
  teacherAction: string | null;
  guardianAction: string | null;
}
export interface ClassTestProfileSubjectT {
  subject: string;
  examsTaken: number;
  avgPercent: number | null;
  latestPercent: number | null;
  previousPercent: number | null;
  trend: string;
}
export interface ClassTestWeaknessTallyT {
  tag: string;
  count: number;
}
export interface ClassTestStudentAnalyticsT {
  examsPresent: number;
  avgPercent: number | null;
  consistency: number | null;
  slope: number | null;
  trajectory: string;
  atRisk: boolean;
  streakKind: string | null;
  streakLength: number;
  bestSubject: string | null;
  weakestSubject: string | null;
  recurringWeaknesses: ClassTestWeaknessTallyT[];
  latestRank: number | null;
  latestRankOf: number | null;
}
export interface ClassTestStudentProfileT {
  studentId: string;
  studentName: string;
  results: ClassTestProfileResultT[];
  bySubject: ClassTestProfileSubjectT[];
  analytics: ClassTestStudentAnalyticsT;
}

export const CLASS_TEST_STUDENT_PROFILE_QUERY = gql<
  { classTestStudentProfile: ClassTestStudentProfileT },
  { studentId: string }
>`
  query ClassTestStudentProfile($studentId: String!) {
    classTestStudentProfile(studentId: $studentId) {
      studentId studentName
      results { testId ctId subject testNumber examDate status marks totalMarks percent pass weakness teacherAction guardianAction }
      analytics {
        examsPresent avgPercent consistency slope trajectory atRisk streakKind streakLength
        bestSubject weakestSubject latestRank latestRankOf
        recurringWeaknesses { tag count }
      }
      bySubject { subject examsTaken avgPercent latestPercent previousPercent trend }
    }
  }
`;

export interface ClassTestOverdueChaseExamT {
  testId: string;
  ctId: string;
  subject: string;
  testNumber: number;
  examDate: string;
  schoolDaysLate: number;
  pendingCount: number;
}
export interface ClassTestOverdueChaseEntryT {
  teacherId: string;
  teacherName: string;
  unreachableByWa: boolean;
  overdueCount: number;
  exams: ClassTestOverdueChaseExamT[];
  messageBn: string;
  waLink: string | null;
}
export interface ClassTestOverdueChaseT {
  entries: ClassTestOverdueChaseEntryT[];
  unreachableCount: number;
}

export const CLASS_TEST_OVERDUE_CHASE_QUERY = gql<
  { classTestOverdueChase: ClassTestOverdueChaseT },
  ClassTestSummaryVars
>`
  query ClassTestOverdueChase(${SUMMARY_ARG_DEFS}) {
    classTestOverdueChase(${SUMMARY_ARG_USE}) {
      unreachableCount
      entries {
        teacherId teacherName unreachableByWa overdueCount messageBn waLink
        exams { testId ctId subject testNumber examDate schoolDaysLate pendingCount }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Guardian child read (CT-3 — published-only, NEVER teacherAction)
// ---------------------------------------------------------------------------

export interface GuardianClassTestResultT {
  testId: string;
  ctId: string;
  subject: string;
  testNumber: number;
  examDate: string;
  classLevel: number;
  status: string;
  marks: number | null;
  totalMarks: number;
  percent: number | null;
  pass: boolean | null;
  weakness: string | null;
  guardianAction: string | null;
  publishedAt: string | null;
}

export const CHILD_TEST_RESULTS_QUERY = gql<
  { childTestResults: GuardianClassTestResultT[] },
  { studentId: string }
>`
  query ChildTestResults($studentId: String!) {
    childTestResults(studentId: $studentId) {
      testId ctId subject testNumber examDate classLevel status marks totalMarks percent pass weakness guardianAction publishedAt
    }
  }
`;
