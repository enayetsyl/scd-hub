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
  /** D-#507: null on a group-anchored exam — an Arabic group spans classes. */
  classLevel: number | null;
  classId: string | null;
  /** EXACTLY ONE of sectionId / subjectGroupId is non-null (D-#507). */
  sectionId: string | null;
  subjectGroupId: string | null;
  /** D-#507: the Arabic group's Bangla name on a group-anchored exam, else null. */
  groupNameBn: string | null;
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
  /** Accountable subject teacher (null on rows predating the field). */
  teacherId: string | null;
  requestedBy: string;
  requestedAt: string;
  printedBy: string | null;
  printedAt: string | null;
  notes: string | null;
}

const CLASS_TEST_FIELDS = `id ctId academicYearId classLevel classId sectionId subjectGroupId groupNameBn subject testNumber examDate totalMarks passMark source setId questionFileId status deadlineDays teacherId requestedBy requestedAt printedBy printedAt notes`;

/** The exam's own roster (D-#507) — the section's students, or the Arabic group's
 *  members with the class·section each comes from. Replaces `studentsInSection` on
 *  the marks screen, which a group exam has no answer for. */
export interface ClassTestRosterStudentT {
  id: string;
  schoolId: string;
  name: string;
  nameBn: string | null;
  sectionNameBn: string | null;
}

export const CLASS_TEST_ROSTER_QUERY = gql<
  { classTestRoster: ClassTestRosterStudentT[] },
  { testId: string }
>`
  query ClassTestRoster($testId: String!) {
    classTestRoster(testId: $testId) { id schoolId name nameBn sectionNameBn }
  }
`;

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


/** CT retire/restore (owner ask 2026-08-03) — the Principal's own route out of a
 *  PRINTED exam, replacing the hand-run scripts. Retire needs a reason; restore
 *  puts it back, so a mistake is never a dead end. */
export const RETIRE_CLASS_TEST = gql<{ retireClassTest: ClassTestT }, { id: string; reason: string }>`
  mutation RetireClassTest($id: String!, $reason: String!) {
    retireClassTest(id: $id, reason: $reason) { ${CLASS_TEST_FIELDS} }
  }
`;

export const UPDATE_CLASS_TEST_DETAILS = gql<
  { updateClassTestDetails: ClassTestT },
  { id: string; totalMarks?: number | null; passMark?: number | null; examDate?: string | null }
>`
  mutation UpdateClassTestDetails($id: String!, $totalMarks: Int, $passMark: Int, $examDate: String) {
    updateClassTestDetails(id: $id, totalMarks: $totalMarks, passMark: $passMark, examDate: $examDate) { ${CLASS_TEST_FIELDS} }
  }
`;

export const RESTORE_CLASS_TEST = gql<{ restoreClassTest: ClassTestT }, { id: string }>`
  mutation RestoreClassTest($id: String!) {
    restoreClassTest(id: $id) { ${CLASS_TEST_FIELDS} }
  }
`;

export const SUGGEST_CLASS_TEST_NUMBER_QUERY = gql<
  { suggestClassTestNumber: number },
  { sectionId?: string | null; subjectGroupId?: string | null; subject: string }
>`
  query SuggestClassTestNumber($sectionId: String, $subjectGroupId: String, $subject: String!) {
    suggestClassTestNumber(sectionId: $sectionId, subjectGroupId: $subjectGroupId, subject: $subject)
  }
`;

export const CREATE_CLASS_TEST_REQUEST = gql<
  { createClassTestRequest: ClassTestT },
  {
    /** EXACTLY ONE of sectionId / subjectGroupId (D-#507). */
    sectionId?: string | null;
    subjectGroupId?: string | null;
    subject: string;
    examDate: string;
    totalMarks: number;
    passMark?: number | null;
    source: string;
    setId?: string | null;
    questionFileId?: string | null;
    colour?: string | null;
    sides?: string | null;
    copies?: number | null;
    copiesMode?: string | null;
    testNumber?: number | null;
    deadlineDays?: number | null;
    notes?: string | null;
    /** Accountable subject teacher; omit → the routine decides. */
    teacherId?: string | null;
  }
>`
  mutation CreateClassTestRequest(
    $sectionId: String, $subjectGroupId: String, $subject: String!, $examDate: String!, $totalMarks: Int!,
    $passMark: Int, $source: String!, $setId: String, $questionFileId: String,
    $colour: String, $sides: String, $copies: Int, $copiesMode: String,
    $testNumber: Int, $deadlineDays: Int, $notes: String, $teacherId: String
  ) {
    createClassTestRequest(
      sectionId: $sectionId, subjectGroupId: $subjectGroupId, subject: $subject, examDate: $examDate, totalMarks: $totalMarks,
      passMark: $passMark, source: $source, setId: $setId, questionFileId: $questionFileId,
      colour: $colour, sides: $sides, copies: $copies, copiesMode: $copiesMode,
      testNumber: $testNumber, deadlineDays: $deadlineDays, notes: $notes, teacherId: $teacherId
    ) { ${CLASS_TEST_FIELDS} }
  }
`;

// D-#339: register as ALREADY official — born PRINTED, no print-queue row.
export const REGISTER_CLASS_TEST_OFFICIAL = gql<
  { registerClassTestOfficial: ClassTestT },
  {
    /** EXACTLY ONE of sectionId / subjectGroupId (D-#507). */
    sectionId?: string | null;
    subjectGroupId?: string | null;
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
    /** Accountable subject teacher; omit → the routine decides. */
    teacherId?: string | null;
  }
>`
  mutation RegisterClassTestOfficial(
    $sectionId: String, $subjectGroupId: String, $subject: String!, $examDate: String!, $totalMarks: Int!,
    $passMark: Int, $source: String!, $setId: String, $questionFileId: String,
    $testNumber: Int, $deadlineDays: Int, $notes: String, $teacherId: String
  ) {
    registerClassTestOfficial(
      sectionId: $sectionId, subjectGroupId: $subjectGroupId, subject: $subject, examDate: $examDate, totalMarks: $totalMarks,
      passMark: $passMark, source: $source, setId: $setId, questionFileId: $questionFileId,
      testNumber: $testNumber, deadlineDays: $deadlineDays, notes: $notes, teacherId: $teacherId
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
  /** D-#507: both null on a group-anchored exam; `subjectGroupId` is set instead. */
  classLevel: number | null;
  sectionId: string | null;
  subjectGroupId: string | null;
  teacherId: string;
  /** D-#339: report author's name + newest result submittedAt (null until proposed). */
  teacherName: string;
  submittedAt: string | null;
  /** Newest result publishedAt — null until ≥1 result of the exam is published. */
  publishedAt: string | null;
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

/** Reports-status ONLY. `retired` exists on no other summary field, so it lives in its
 *  own vars type — the shared one must stay exactly what all three queries accept. */
export interface ClassTestReportsVars extends ClassTestSummaryVars {
  /** true → list RETIRED exams instead of live ones (so a retirement can be undone). */
  retired?: boolean | null;
}

const SUMMARY_ARG_DEFS = `$academicYearId: String, $classLevel: Int, $sectionId: String, $subject: String, $teacherId: String, $asOf: String`;
const SUMMARY_ARG_USE = `academicYearId: $academicYearId, classLevel: $classLevel, sectionId: $sectionId, subject: $subject, teacherId: $teacherId, asOf: $asOf`;
// `retired` exists ONLY on classTestReportsStatus (the per-test list). It must not ride
// the SHARED constants: classTestPrincipalDashboard and classTestOverdueChase do not
// declare it, and sending it there fails the whole document with
// "Unknown argument retired" — which is exactly what broke the Class-test dashboard
// in prod on 2026-08-03.
const REPORTS_ARG_DEFS = `${SUMMARY_ARG_DEFS}, $retired: Boolean`;
const REPORTS_ARG_USE = `${SUMMARY_ARG_USE}, retired: $retired`;

export const CLASS_TEST_REPORTS_STATUS_QUERY = gql<
  { classTestReportsStatus: ClassTestReportStatusRowT[] },
  ClassTestReportsVars
>`
  query ClassTestReportsStatus(${REPORTS_ARG_DEFS}) {
    classTestReportsStatus(${REPORTS_ARG_USE}) {
      testId ctId subject testNumber classLevel sectionId subjectGroupId teacherId teacherName submittedAt publishedAt examDate deadline deadlineDays
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
  /** D-#507: null when the exam was held for an Arabic GROUP — see groupNameBn. */
  classLevel: number | null;
  groupNameBn: string | null;
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
      testId ctId subject testNumber examDate classLevel groupNameBn status marks totalMarks percent pass weakness guardianAction publishedAt
    }
  }
`;

// ---------------------------------------------------------------------------
// CT question-request loop (owner ask 2026-07-20): teacher asks the office for
// a question paper; office uploads rounds; teacher approves (locks) or asks for
// changes; a CONFIRMED paper goes to print via the standard class-test path.
// ---------------------------------------------------------------------------

export interface CtQuestionRoundT {
  fileId: string;
  note: string | null;
  sentBy: string;
  sentAt: string;
  teacherComment: string | null;
  respondedAt: string | null;
}

export interface CtQuestionRequestT {
  id: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  chapter: string;
  testNumber: number;
  totalMarks: number;
  durationMinutes: number;
  examDate: string;
  status: string;
  rounds: CtQuestionRoundT[];
  currentFileId: string | null;
  requestedBy: string;
  requesterName: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  classTestId: string | null;
}

const CT_QUESTION_FIELDS = `
  id classLevel sectionId subject chapter testNumber totalMarks durationMinutes examDate status
  rounds { fileId note sentBy sentAt teacherComment respondedAt }
  currentFileId requestedBy requesterName requestedAt confirmedAt classTestId
`;

export const MY_CT_QUESTION_REQUESTS = gql<{ myCtQuestionRequests: CtQuestionRequestT[] }, Record<string, never>>`
  query MyCtQuestionRequests {
    myCtQuestionRequests { ${CT_QUESTION_FIELDS} }
  }
`;

export const CT_QUESTION_QUEUE = gql<{ ctQuestionQueue: CtQuestionRequestT[] }, Record<string, never>>`
  query CtQuestionQueue {
    ctQuestionQueue { ${CT_QUESTION_FIELDS} }
  }
`;

/** Sidebar badge counts for the Class Test drawer item (owner 2026-07-25). */
export const CT_QUESTION_COUNTS = gql<
  { ctQuestionCounts: { pending: number; inReview: number } },
  Record<string, never>
>`
  query CtQuestionCounts {
    ctQuestionCounts { pending inReview }
  }
`;

export const CREATE_CT_QUESTION_REQUEST = gql<
  { createCtQuestionRequest: CtQuestionRequestT },
  { sectionId: string; subject: string; chapter: string; totalMarks: number; durationMinutes: number; examDate: string }
>`
  mutation CreateCtQuestionRequest(
    $sectionId: String!
    $subject: String!
    $chapter: String!
    $totalMarks: Int!
    $durationMinutes: Int!
    $examDate: String!
  ) {
    createCtQuestionRequest(
      sectionId: $sectionId
      subject: $subject
      chapter: $chapter
      totalMarks: $totalMarks
      durationMinutes: $durationMinutes
      examDate: $examDate
    ) {
      ${CT_QUESTION_FIELDS}
    }
  }
`;

export const SEND_CT_QUESTION_FOR_REVIEW = gql<
  { sendCtQuestionForReview: CtQuestionRequestT },
  { id: string; fileId: string; note?: string | null }
>`
  mutation SendCtQuestionForReview($id: String!, $fileId: String!, $note: String) {
    sendCtQuestionForReview(id: $id, fileId: $fileId, note: $note) { ${CT_QUESTION_FIELDS} }
  }
`;

export const REVIEW_CT_QUESTION = gql<
  { reviewCtQuestion: CtQuestionRequestT },
  { id: string; approve: boolean; comment?: string | null }
>`
  mutation ReviewCtQuestion($id: String!, $approve: Boolean!, $comment: String) {
    reviewCtQuestion(id: $id, approve: $approve, comment: $comment) { ${CT_QUESTION_FIELDS} }
  }
`;

export const REQUEST_CT_QUESTION_PRINT = gql<
  { requestCtQuestionPrint: { request: CtQuestionRequestT; ctId: string } },
  { id: string; colour?: string | null; sides?: string | null; copies?: number | null; copiesMode?: string | null }
>`
  mutation RequestCtQuestionPrint($id: String!, $colour: String, $sides: String, $copies: Int, $copiesMode: String) {
    requestCtQuestionPrint(id: $id, colour: $colour, sides: $sides, copies: $copies, copiesMode: $copiesMode) {
      request { ${CT_QUESTION_FIELDS} }
      ctId
    }
  }
`;
