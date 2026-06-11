/**
 * Typed GraphQL operations — hand-authored TypedDocumentNodes that mirror the
 * server resolvers exactly (server/src/modules/**). urql's generic `gql` gives
 * full type inference at every useQuery/useMutation call site with no codegen
 * step. graphql-codegen (client-preset) is the planned replacement (Slice 4
 * step 8); when it lands these documents/types swap out mechanically.
 *
 * Field selections are kept to what each screen renders. List/detail variants
 * use distinct result types so the TS shape never over-claims selected fields.
 */
import { gql } from "urql";
import type { Role } from "@scd/shared";

type NoVars = Record<string, never>;

// ===========================================================================
// Auth + identity
// ===========================================================================

export interface MeUser {
  id: string;
  email: string;
  role: Role;
  name: string;
  active: boolean;
}

export const ME_QUERY = gql<{ me: MeUser | null }, NoVars>`
  query Me {
    me { id email role name active }
  }
`;

export interface AuthResult {
  token: string;
  userId: string;
  role: Role;
  name: string;
}

export const STAFF_LOGIN = gql<
  { staffLogin: AuthResult | null },
  { email: string; password: string }
>`
  mutation StaffLogin($email: String!, $password: String!) {
    staffLogin(email: $email, password: $password) {
      token
      userId
      role
      name
    }
  }
`;

// ===========================================================================
// Foundation: subjects / classes / sections / students / scopes
// ===========================================================================

export interface SubjectT {
  id: string;
  code: string;
  nameBn: string;
}

export const SUBJECTS_QUERY = gql<{ subjects: SubjectT[] }, NoVars>`
  query Subjects {
    subjects { id code nameBn }
  }
`;

export interface SectionT {
  id: string;
  code: string;
  nameBn: string;
  active: boolean;
  classTeacherId?: string | null;
}

export interface ClassT {
  id: string;
  level: number;
  nameBn: string;
  active: boolean;
  sections: SectionT[];
}

export const CLASSES_QUERY = gql<{ classes: ClassT[] }, { academicYearId: string }>`
  query Classes($academicYearId: String!) {
    classes(academicYearId: $academicYearId) {
      id
      level
      nameBn
      active
      sections { id code nameBn active classTeacherId }
    }
  }
`;

export interface GuardianContactT {
  id: string;
  name: string;
  phone: string | null;
  relation: string;
  loginEnabled: boolean;
}

export interface StudentT {
  id: string;
  schoolId: string;
  name: string;
  active: boolean;
}

export const STUDENTS_QUERY = gql<
  { studentsInSection: StudentT[] },
  { sectionId: string }
>`
  query Students($sectionId: String!) {
    studentsInSection(sectionId: $sectionId) {
      id
      schoolId
      name
      active
    }
  }
`;

/** Full roster view — the operational fields + linked guardians (read-only). */
export interface RosterStudentT extends StudentT {
  nameBn: string | null;
  gender: string | null;
  dob: string | null;
  phone: string | null;
  address: string | null;
  bloodGroup: string | null;
  guardians: GuardianContactT[];
}

export const ROSTER_QUERY = gql<
  { studentsInSection: RosterStudentT[] },
  { sectionId: string }
>`
  query Roster($sectionId: String!) {
    studentsInSection(sectionId: $sectionId) {
      id
      schoolId
      name
      nameBn
      gender
      dob
      phone
      address
      bloodGroup
      active
      guardians {
        id
        name
        phone
        relation
        loginEnabled
      }
    }
  }
`;

// ===========================================================================
// Staff (read-only HR roster — Principal/Office only, staff:manage)
// ===========================================================================

export interface StaffT {
  id: string;
  schoolId: string;
  name: string;
  nameBn: string | null;
  category: string;
  designation: string | null;
  employmentType: string;
  employmentStatus: string;
  joiningDate: string | null;
  gender: string | null;
  dob: string | null;
  bloodGroup: string | null;
  maritalStatus: string | null;
  qualification: string | null;
  fatherName: string | null;
  motherName: string | null;
  spouseName: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  presentAddress: string | null;
  permanentAddress: string | null;
  biometricId: string | null;
  nid: string | null;
  bankAccount: string | null;
  active: boolean;
}

export const STAFF_QUERY = gql<{ staff: StaffT[] }, { category?: string | null }>`
  query Staff($category: String) {
    staff(category: $category) {
      id
      schoolId
      name
      nameBn
      category
      designation
      employmentType
      employmentStatus
      joiningDate
      gender
      dob
      bloodGroup
      maritalStatus
      qualification
      fatherName
      motherName
      spouseName
      phone
      whatsapp
      email
      presentAddress
      permanentAddress
      biometricId
      nid
      bankAccount
      active
    }
  }
`;

export interface ScopeGrantT {
  id: string;
  kind: string;
  active: boolean;
}

export const MY_SCOPES_QUERY = gql<{ myScopes: ScopeGrantT[] }, NoVars>`
  query MyScopes {
    myScopes { id kind active }
  }
`;

// ===========================================================================
// Content (J1)
// ===========================================================================

export interface ArtifactAddress {
  anchorWord: string;
  number: string;
  title: string | null;
}

/** Light artifact shape for tree/list rows. */
export interface ArtifactListItem {
  id: string;
  docType: string;
  subject: string;
  classLevel: number;
  address: ArtifactAddress;
  curationTag: string;
  reviewStatus: string;
  current: boolean;
  importedAt: string;
}

export interface ContentTreeChapter {
  anchorWord: string;
  number: string;
  title: string | null;
  artifacts: ArtifactListItem[];
}

export interface ContentTreeNode {
  subject: string;
  classLevel: number;
  chapters: ContentTreeChapter[];
}

export const CONTENT_TREE_QUERY = gql<
  { contentTree: ContentTreeNode[] },
  { subject?: string | null; classLevel?: number | null }
>`
  query ContentTree($subject: String, $classLevel: Int) {
    contentTree(subject: $subject, classLevel: $classLevel) {
      subject
      classLevel
      chapters {
        anchorWord
        number
        title
        artifacts {
          id
          docType
          subject
          classLevel
          address { anchorWord number title }
          curationTag
          reviewStatus
          current
          importedAt
        }
      }
    }
  }
`;

/** Full artifact incl. renderedMarkdown for the plan view (ADR-006: shown as-is). */
export interface ContentArtifactT extends ArtifactListItem {
  renderedMarkdown: string | null;
  priorVersionId: string | null;
}

export const ARTIFACT_QUERY = gql<{ artifact: ContentArtifactT | null }, { id: string }>`
  query Artifact($id: String!) {
    artifact(id: $id) {
      id
      docType
      subject
      classLevel
      address { anchorWord number title }
      curationTag
      reviewStatus
      renderedMarkdown
      current
      priorVersionId
      importedAt
    }
  }
`;

// ===========================================================================
// Plan review / approval loop (PR-1/PR-2 — D-#38/#39/#40)
// ===========================================================================

/** One review round (mirrors the server ReviewAssignment GraphQL type). */
export interface ReviewAssignmentT {
  id: string;
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  artifactId: string;
  reviewerId: string;
  assignedBy: string;
  assignedAt: string;
  roundNumber: number;
  status: string;
  verdict: string | null;
  feedback: string | null;
  submittedAt: string | null;
}

const REVIEW_ASSIGNMENT_FIELDS = `
  id docType subject classLevel anchorWord addressNumber
  artifactId reviewerId assignedBy assignedAt roundNumber status
  verdict feedback submittedAt
`;

/** Teacher's open review queue. */
export const MY_REVIEW_ASSIGNMENTS = gql<{ myReviewAssignments: ReviewAssignmentT[] }, NoVars>`
  query MyReviewAssignments {
    myReviewAssignments { ${REVIEW_ASSIGNMENT_FIELDS} }
  }
`;

/** Principal/Office inbox — submitted rounds awaiting action. */
export const PLAN_REVIEW_INBOX = gql<{ planReviewInbox: ReviewAssignmentT[] }, NoVars>`
  query PlanReviewInbox {
    planReviewInbox { ${REVIEW_ASSIGNMENT_FIELDS} }
  }
`;

/** Full round history for a plan's address (by any artifact version). */
export const PLAN_REVIEW_THREAD = gql<{ planReviewThread: ReviewAssignmentT[] }, { artifactId: string }>`
  query PlanReviewThread($artifactId: String!) {
    planReviewThread(artifactId: $artifactId) { ${REVIEW_ASSIGNMENT_FIELDS} }
  }
`;

export const ASSIGN_PLAN_REVIEW = gql<
  { assignPlanReview: ReviewAssignmentT },
  { artifactId: string; reviewerId: string }
>`
  mutation AssignPlanReview($artifactId: String!, $reviewerId: String!) {
    assignPlanReview(artifactId: $artifactId, reviewerId: $reviewerId) { ${REVIEW_ASSIGNMENT_FIELDS} }
  }
`;

export const SUBMIT_PLAN_REVIEW = gql<
  { submitPlanReview: ReviewAssignmentT },
  { assignmentId: string; verdict: string; feedback?: string | null }
>`
  mutation SubmitPlanReview($assignmentId: String!, $verdict: String!, $feedback: String) {
    submitPlanReview(assignmentId: $assignmentId, verdict: $verdict, feedback: $feedback) { ${REVIEW_ASSIGNMENT_FIELDS} }
  }
`;

export const CANCEL_PLAN_REVIEW = gql<
  { cancelPlanReview: ReviewAssignmentT },
  { assignmentId: string }
>`
  mutation CancelPlanReview($assignmentId: String!) {
    cancelPlanReview(assignmentId: $assignmentId) { id status }
  }
`;

export interface ApprovePlanResultT {
  artifactId: string;
  reviewStatus: string;
}

export const APPROVE_PLAN = gql<{ approvePlan: ApprovePlanResultT }, { artifactId: string }>`
  mutation ApprovePlan($artifactId: String!) {
    approvePlan(artifactId: $artifactId) { artifactId reviewStatus }
  }
`;

// ===========================================================================
// Questions (J2)
// ===========================================================================

export interface QuestionListItem {
  id: string;
  subject: string;
  classLevel: number;
  qid: string | null;
  questionType: string | null;
  paperRole: string | null;
  bloomLevel: string | null;
  difficulty: string | null;
  marks: number | null;
  curationTag: string;
  reviewStatus: string;
  /** Full payload JSON — list rows read question_text from it. */
  payloadJson: string;
}

export interface QuestionsVars {
  subject?: string | null;
  classLevel?: number | null;
  topicTag?: string | null;
  questionType?: string | null;
  bloomLevel?: string | null;
  difficulty?: string | null;
  paperRole?: string | null;
  marksMin?: number | null;
  marksMax?: number | null;
  reviewStatus?: string | null;
}

export const QUESTIONS_QUERY = gql<{ questions: QuestionListItem[] }, QuestionsVars>`
  query Questions(
    $subject: String
    $classLevel: Int
    $topicTag: String
    $questionType: String
    $bloomLevel: String
    $difficulty: String
    $paperRole: String
    $marksMin: Float
    $marksMax: Float
    $reviewStatus: String
  ) {
    questions(
      subject: $subject
      classLevel: $classLevel
      topicTag: $topicTag
      questionType: $questionType
      bloomLevel: $bloomLevel
      difficulty: $difficulty
      paperRole: $paperRole
      marksMin: $marksMin
      marksMax: $marksMax
      reviewStatus: $reviewStatus
    ) {
      id
      subject
      classLevel
      qid
      questionType
      paperRole
      bloomLevel
      difficulty
      marks
      curationTag
      reviewStatus
      payloadJson
    }
  }
`;

export interface QuestionDetail extends QuestionListItem {
  docType: string;
  topicTag: string | null;
  current: boolean;
  importedAt: string;
}

export const QUESTION_QUERY = gql<{ question: QuestionDetail | null }, { id: string }>`
  query Question($id: String!) {
    question(id: $id) {
      id
      docType
      subject
      classLevel
      payloadJson
      qid
      topicTag
      questionType
      paperRole
      bloomLevel
      difficulty
      marks
      curationTag
      reviewStatus
      current
      importedAt
    }
  }
`;

// ===========================================================================
// Assessment sets (J3)
// ===========================================================================

export interface BasketItemT {
  artifactId: string;
  qid: string;
  marks: number;
}

export interface AssessmentSetT {
  id: string;
  setType: string;
  sectionId: string;
  classId: string;
  subjectId: string | null;
  status: string;
  basketItems: BasketItemT[];
  totalMarks: number | null;
  durationMinutes: number | null;
  dueDate: string | null;
  createdBy: string;
  assembledBy: string | null;
  assembledAt: string | null;
  createdAt: string;
}

export const CREATE_SET = gql<
  { createSet: AssessmentSetT },
  { setType: string; sectionId: string; classId: string; subjectId?: string | null }
>`
  mutation CreateSet($setType: String!, $sectionId: String!, $classId: String!, $subjectId: String) {
    createSet(setType: $setType, sectionId: $sectionId, classId: $classId, subjectId: $subjectId) {
      id
      setType
      sectionId
      classId
      subjectId
      status
      basketItems { artifactId qid marks }
      totalMarks
      durationMinutes
      dueDate
      createdBy
      assembledBy
      assembledAt
      createdAt
    }
  }
`;

export const ADD_QUESTION_TO_SET = gql<
  { addQuestionToSet: AssessmentSetT },
  { setId: string; artifactId: string }
>`
  mutation AddQuestionToSet($setId: String!, $artifactId: String!) {
    addQuestionToSet(setId: $setId, artifactId: $artifactId) {
      id
      setType
      sectionId
      classId
      subjectId
      status
      basketItems { artifactId qid marks }
      totalMarks
      durationMinutes
      dueDate
      createdBy
      assembledBy
      assembledAt
      createdAt
    }
  }
`;

export interface AssembleResultT {
  setId: string;
  status: string;
  itemCount: number;
  totalMarks: number;
  assembledAt: string;
}

export const ASSEMBLE_SET = gql<
  { assembleSet: AssembleResultT },
  { setId: string; durationMinutes?: number | null; dueDate?: string | null }
>`
  mutation AssembleSet($setId: String!, $durationMinutes: Int, $dueDate: String) {
    assembleSet(setId: $setId, durationMinutes: $durationMinutes, dueDate: $dueDate) {
      setId
      status
      itemCount
      totalMarks
      assembledAt
    }
  }
`;

export const ASSESSMENT_SET_QUERY = gql<{ assessmentSet: AssessmentSetT | null }, { id: string }>`
  query AssessmentSet($id: String!) {
    assessmentSet(id: $id) {
      id
      setType
      sectionId
      classId
      subjectId
      status
      basketItems { artifactId qid marks }
      totalMarks
      durationMinutes
      dueDate
      createdBy
      assembledBy
      assembledAt
      createdAt
    }
  }
`;

export const ASSESSMENT_SETS_QUERY = gql<
  { assessmentSets: AssessmentSetT[] },
  { sectionId: string; classId: string; status?: string | null }
>`
  query AssessmentSets($sectionId: String!, $classId: String!, $status: String) {
    assessmentSets(sectionId: $sectionId, classId: $classId, status: $status) {
      id
      setType
      sectionId
      classId
      subjectId
      status
      basketItems { artifactId qid marks }
      totalMarks
      durationMinutes
      dueDate
      createdBy
      assembledBy
      assembledAt
      createdAt
    }
  }
`;

// ===========================================================================
// Trackers (J4)
// ===========================================================================

export interface TrackerEntryT {
  pseudoStudentId: string;
  score: number | null;
  submitted: boolean | null;
  complete: boolean | null;
}

export interface TrackerRecordT {
  id: string;
  trackerKind: string;
  setId: string;
  sectionId: string;
  classId: string;
  entries: TrackerEntryT[];
  status: string;
  createdBy: string;
  closedAt: string | null;
  createdAt: string;
}

export const TRACKER_QUERY = gql<{ tracker: TrackerRecordT | null }, { id: string }>`
  query Tracker($id: String!) {
    tracker(id: $id) {
      id
      trackerKind
      setId
      sectionId
      classId
      entries { pseudoStudentId score submitted complete }
      status
      createdBy
      closedAt
      createdAt
    }
  }
`;

export const TRACKERS_QUERY = gql<
  { trackers: TrackerRecordT[] },
  { sectionId: string; classId: string; trackerKind?: string | null; setId?: string | null; status?: string | null }
>`
  query Trackers($sectionId: String!, $classId: String!, $trackerKind: String, $setId: String, $status: String) {
    trackers(sectionId: $sectionId, classId: $classId, trackerKind: $trackerKind, setId: $setId, status: $status) {
      id
      trackerKind
      setId
      sectionId
      classId
      entries { pseudoStudentId score submitted complete }
      status
      createdBy
      closedAt
      createdAt
    }
  }
`;

export interface OpenTrackerResultT {
  trackerId: string;
  trackerKind: string;
  setId: string;
  sectionId: string;
  classId: string;
  status: string;
}

export const OPEN_TRACKER = gql<
  { openTracker: OpenTrackerResultT },
  { setId: string; sectionId: string }
>`
  mutation OpenTracker($setId: String!, $sectionId: String!) {
    openTracker(setId: $setId, sectionId: $sectionId) {
      trackerId
      trackerKind
      setId
      sectionId
      classId
      status
    }
  }
`;

export interface RecordEntryResultT {
  trackerId: string;
  pseudoStudentId: string;
  entryCount: number;
}

export const RECORD_ENTRY = gql<
  { recordEntry: RecordEntryResultT },
  { trackerId: string; studentId: string; score?: number | null; submitted?: boolean | null; complete?: boolean | null }
>`
  mutation RecordEntry($trackerId: String!, $studentId: String!, $score: Float, $submitted: Boolean, $complete: Boolean) {
    recordEntry(trackerId: $trackerId, studentId: $studentId, score: $score, submitted: $submitted, complete: $complete) {
      trackerId
      pseudoStudentId
      entryCount
    }
  }
`;

export interface CloseTrackerResultT {
  trackerId: string;
  status: string;
  closedAt: string;
}

export const CLOSE_TRACKER = gql<{ closeTracker: CloseTrackerResultT }, { trackerId: string }>`
  mutation CloseTracker($trackerId: String!) {
    closeTracker(trackerId: $trackerId) {
      trackerId
      status
      closedAt
    }
  }
`;

export interface TrackerSummaryT {
  trackerId: string;
  trackerKind: string;
  totalEntries: number;
  submittedCount: number;
  completeCount: number;
  averageScore: number | null;
}

export const TRACKER_SUMMARY_QUERY = gql<
  { trackerSummary: TrackerSummaryT | null },
  { trackerId: string }
>`
  query TrackerSummary($trackerId: String!) {
    trackerSummary(trackerId: $trackerId) {
      trackerId
      trackerKind
      totalEntries
      submittedCount
      completeCount
      averageScore
    }
  }
`;

export const WA_LINK_QUERY = gql<
  { waLink: string },
  { guardianPhone: string; studentName: string; setTitle: string }
>`
  query WaLink($guardianPhone: String!, $studentName: String!, $setTitle: String!) {
    waLink(guardianPhone: $guardianPhone, studentName: $studentName, setTitle: $setTitle)
  }
`;

// ===========================================================================
// Admin (J1 import, J5 users + scope grants)
// ===========================================================================

export interface ImportResultT {
  verdict: string;
  failChecks: string[];
  warnings: string[];
  advisories: string[];
  artifactId: string | null;
  batchId: string;
  /** Set when the app auto-built the envelope from a plan + Markdown pair. */
  envelopeJson: string | null;
  /** Question-bank fan-out tallies (null outside the bank path). */
  itemsTotal: number | null;
  itemsPassed: number | null;
  itemsFailed: number | null;
}

export const IMPORT_ENVELOPE = gql<{ importEnvelope: ImportResultT }, { envelopeJson: string }>`
  mutation ImportEnvelope($envelopeJson: String!) {
    importEnvelope(envelopeJson: $envelopeJson) {
      verdict
      failChecks
      warnings
      advisories
      artifactId
      batchId
      envelopeJson
    }
  }
`;

export interface ImportFileT {
  filename: string;
  content: string;
}

/**
 * Import one logical item: a built envelope (single .json), a Project-03 plan as a
 * .json + .md pair (the server auto-wraps it), or a Project-04 question bank
 * ({stimuli,questions} collection — fanned out into N envelopes; pass curationTag).
 * Pairs by filename stem; a bank's companion .md/.tsv is ignored.
 */
export const IMPORT_FILES = gql<
  { importFiles: ImportResultT },
  { files: ImportFileT[]; curationTag?: string; unitTitle?: string }
>`
  mutation ImportFiles($files: [ImportFileInput!]!, $curationTag: String, $unitTitle: String) {
    importFiles(files: $files, curationTag: $curationTag, unitTitle: $unitTitle) {
      verdict
      failChecks
      warnings
      advisories
      artifactId
      batchId
      envelopeJson
      itemsTotal
      itemsPassed
      itemsFailed
    }
  }
`;

export interface UserT {
  id: string;
  email: string;
  role: string;
  name: string;
  active: boolean;
}

export const CREATE_USER = gql<
  { createUser: UserT },
  { email: string; password: string; role: string; name: string }
>`
  mutation CreateUser($email: String!, $password: String!, $role: String!, $name: String!) {
    createUser(email: $email, password: $password, role: $role, name: $name) {
      id
      email
      role
      name
      active
    }
  }
`;

export const ASSIGN_PROXY = gql<
  { assignProxy: { grantId: string } },
  {
    coveringTeacherId: string;
    absentTeacherId?: string | null;
    classId: string;
    sectionId: string;
    startDate: string;
    durationDays: number;
  }
>`
  mutation AssignProxy(
    $coveringTeacherId: String!
    $absentTeacherId: String
    $classId: String!
    $sectionId: String!
    $startDate: String!
    $durationDays: Int!
  ) {
    assignProxy(
      coveringTeacherId: $coveringTeacherId
      absentTeacherId: $absentTeacherId
      classId: $classId
      sectionId: $sectionId
      startDate: $startDate
      durationDays: $durationDays
    ) {
      grantId
    }
  }
`;

export const REVOKE_PROXY = gql<{ revokeProxy: boolean }, { grantId: string }>`
  mutation RevokeProxy($grantId: String!) {
    revokeProxy(grantId: $grantId)
  }
`;

export const EXTEND_PROXY = gql<
  { extendProxy: boolean },
  { grantId: string; additionalDays: number }
>`
  mutation ExtendProxy($grantId: String!, $additionalDays: Int!) {
    extendProxy(grantId: $grantId, additionalDays: $additionalDays)
  }
`;

// ===========================================================================
// Homework Tracker (HW-T1..T4 — server/src/modules/trackers/*)
// ===========================================================================

export interface HwDayItemT {
  itemId: string;
  hwId: string;
  subject: string;
  timeDecl: number;
  qCount: number;
  revItem: boolean;
  status: string;
  bandWarning: boolean;
}

export interface HwDayTallyT {
  classId: string;
  dayTotal: number;
  ceiling: number;
  overBy: number;
  withinCeiling: boolean;
  state: string;
  items: HwDayItemT[];
  bandWarnings: string[];
}

export const HOMEWORK_DAY_TALLY = gql<
  { homeworkDayTally: HwDayTallyT },
  { sectionId: string; classId: string; date: string }
>`
  query HomeworkDayTally($sectionId: String!, $classId: String!, $date: String!) {
    homeworkDayTally(sectionId: $sectionId, classId: $classId, date: $date) {
      classId
      dayTotal
      ceiling
      overBy
      withinCeiling
      state
      items { itemId hwId subject timeDecl qCount revItem status bandWarning }
      bandWarnings
    }
  }
`;

export interface HwTrimCandidatesT {
  rankA: HwDayItemT[];
  rankB: HwDayItemT[];
  rankC: HwDayItemT[];
}

export const HOMEWORK_TRIM_CANDIDATES = gql<
  { homeworkTrimCandidates: HwTrimCandidatesT },
  { sectionId: string; classId: string; date: string }
>`
  query HomeworkTrimCandidates($sectionId: String!, $classId: String!, $date: String!) {
    homeworkTrimCandidates(sectionId: $sectionId, classId: $classId, date: $date) {
      rankA { itemId hwId subject timeDecl qCount revItem status bandWarning }
      rankB { itemId hwId subject timeDecl qCount revItem status bandWarning }
      rankC { itemId hwId subject timeDecl qCount revItem status bandWarning }
    }
  }
`;

export interface HwChaseEntryT {
  recordId: string;
  hwId: string;
  studentId: string;
  chaseCount: number;
  attention: boolean;
  commsPrompt: boolean;
}
export interface HwTopicTouchT {
  topTag: string;
  count: number;
}
export interface HwSummaryT {
  classId: string;
  chaseList: HwChaseEntryT[];
  attentionCount: number;
  commsPromptCount: number;
  openResubmissions: number;
  submittedOnTimePct: number | null;
  chaseVolume: number;
  avgReturnLatencyDays: number | null;
  topicTouches: HwTopicTouchT[];
}

export const HOMEWORK_SUMMARY = gql<
  { homeworkSummary: HwSummaryT },
  { sectionId: string; classId: string }
>`
  query HomeworkSummary($sectionId: String!, $classId: String!) {
    homeworkSummary(sectionId: $sectionId, classId: $classId) {
      classId
      chaseList { recordId hwId studentId chaseCount attention commsPrompt }
      attentionCount
      commsPromptCount
      openResubmissions
      submittedOnTimePct
      chaseVolume
      avgReturnLatencyDays
      topicTouches { topTag count }
    }
  }
`;

export interface HwStateStampT {
  state: string;
  at: string;
}
export interface HwStudentRecordT {
  id: string;
  hwId: string;
  studentId: string;
  state: string;
  stateDates: HwStateStampT[];
  dueDate: string | null;
  chaseCount: number;
  result: string | null;
}

export const HOMEWORK_STUDENT_RECORDS = gql<
  { homeworkStudentRecords: HwStudentRecordT[] },
  { sectionId: string; classId: string; itemId: string }
>`
  query HomeworkStudentRecords($sectionId: String!, $classId: String!, $itemId: String!) {
    homeworkStudentRecords(sectionId: $sectionId, classId: $classId, itemId: $itemId) {
      id hwId studentId state stateDates { state at } dueDate chaseCount result
    }
  }
`;

export interface HwItemT {
  id: string;
  hwId: string;
  classLevel: number;
  subject: string;
  dateGiven: string;
  topTags: string[];
  timeDecl: number;
  qCount: number;
  revItem: boolean;
  status: string;
}

export const HOMEWORK_ITEMS = gql<
  { homeworkItems: HwItemT[] },
  { sectionId: string; classId: string; dateGiven?: string | null }
>`
  query HomeworkItems($sectionId: String!, $classId: String!, $dateGiven: String) {
    homeworkItems(sectionId: $sectionId, classId: $classId, dateGiven: $dateGiven) {
      id hwId classLevel subject dateGiven topTags timeDecl qCount revItem status
    }
  }
`;

export const DECLARE_HOMEWORK_ITEM = gql<
  { declareHomeworkItem: HwItemT },
  {
    academicYearId: string;
    classId: string;
    classLevel: number;
    sectionId: string;
    subject: string;
    dateGiven: string;
    topTags: string[];
    timeDecl?: number | null;
    qCount: number;
    poolRef?: string | null;
    revItem?: boolean | null;
  }
>`
  mutation DeclareHomeworkItem(
    $academicYearId: String!, $classId: String!, $classLevel: Int!, $sectionId: String!,
    $subject: String!, $dateGiven: String!, $topTags: [String!]!, $timeDecl: Int,
    $qCount: Int!, $poolRef: String, $revItem: Boolean
  ) {
    declareHomeworkItem(
      academicYearId: $academicYearId, classId: $classId, classLevel: $classLevel, sectionId: $sectionId,
      subject: $subject, dateGiven: $dateGiven, topTags: $topTags, timeDecl: $timeDecl,
      qCount: $qCount, poolRef: $poolRef, revItem: $revItem
    ) {
      id hwId classLevel subject dateGiven topTags timeDecl qCount revItem status
    }
  }
`;

export interface HwTrimResultT {
  hwId: string;
  rank: string;
  trimFrom: number;
  trimTo: number;
  trimMin: number;
  tally: HwDayTallyT;
}

export const TRIM_HOMEWORK_ITEM = gql<
  { trimHomeworkItem: HwTrimResultT },
  { sectionId: string; classId: string; date: string; itemId: string; newQCount: number; rank: string }
>`
  mutation TrimHomeworkItem(
    $sectionId: String!, $classId: String!, $date: String!, $itemId: String!, $newQCount: Int!, $rank: String!
  ) {
    trimHomeworkItem(
      sectionId: $sectionId, classId: $classId, date: $date, itemId: $itemId, newQCount: $newQCount, rank: $rank
    ) {
      hwId rank trimFrom trimTo trimMin
      tally {
        classId dayTotal ceiling overBy withinCeiling state
        items { itemId hwId subject timeDecl qCount revItem status bandWarning }
        bandWarnings
      }
    }
  }
`;

export interface HwConfirmResultT {
  classId: string;
  reconDate: string;
  dayTotal: number;
  ceiling: number;
  reconState: string;
  issuedItems: number;
  issuedRecords: number;
}

export const CONFIRM_HOMEWORK_DAY = gql<
  { confirmHomeworkDay: HwConfirmResultT },
  { sectionId: string; classId: string; date: string; roster: { studentId: string; present: boolean }[] }
>`
  mutation ConfirmHomeworkDay(
    $sectionId: String!, $classId: String!, $date: String!, $roster: [IssueRosterEntryInput!]!
  ) {
    confirmHomeworkDay(sectionId: $sectionId, classId: $classId, date: $date, roster: $roster) {
      classId reconDate dayTotal ceiling reconState issuedItems issuedRecords
    }
  }
`;

export interface HwCheckResultT {
  recordId: string;
  hwId: string;
  state: string;
  result: string;
  resubmission: {
    recordId: string;
    hwId: string;
    state: string;
    topupFlag: boolean;
    topupQids: string[];
    topupTime: number | null;
    dueDate: string | null;
  } | null;
}

export const CHECK_HOMEWORK_RECORD = gql<
  { checkHomeworkRecord: HwCheckResultT },
  { sectionId: string; recordId: string; result: string; resubmit?: boolean | null; topupQids?: string[] | null; topupTime?: number | null }
>`
  mutation CheckHomeworkRecord(
    $sectionId: String!, $recordId: String!, $result: String!, $resubmit: Boolean, $topupQids: [String!], $topupTime: Int
  ) {
    checkHomeworkRecord(
      sectionId: $sectionId, recordId: $recordId, result: $result, resubmit: $resubmit, topupQids: $topupQids, topupTime: $topupTime
    ) {
      recordId hwId state result
      resubmission { recordId hwId state topupFlag topupQids topupTime dueDate }
    }
  }
`;

// --- HW-T4 roll-ups: watch-list / trim-pattern / question-usage (§7.3/§7.4/§8.4) ---

export interface HwWatchEntryT {
  studentId: string;
  resubmissionCount: number;
}
export interface HwWatchListT {
  classId: string;
  threshold: number;
  windowDays: number;
  watchList: HwWatchEntryT[];
}

export const HOMEWORK_WATCHLIST = gql<
  { homeworkWatchList: HwWatchListT },
  { sectionId: string; classId: string }
>`
  query HomeworkWatchList($sectionId: String!, $classId: String!) {
    homeworkWatchList(sectionId: $sectionId, classId: $classId) {
      classId
      threshold
      windowDays
      watchList { studentId resubmissionCount }
    }
  }
`;

export interface HwTrimFlagT {
  subject: string;
  trimmedDays: number;
  schoolDays: number;
  ratio: number;
  flagged: boolean;
}
export interface HwTrimPatternT {
  classId: string;
  schoolDays: number;
  threshold: number;
  flags: HwTrimFlagT[];
}

export const HOMEWORK_TRIM_PATTERN = gql<
  { homeworkTrimPattern: HwTrimPatternT },
  { sectionId: string; classId: string; from: string; to: string }
>`
  query HomeworkTrimPattern($sectionId: String!, $classId: String!, $from: String!, $to: String!) {
    homeworkTrimPattern(sectionId: $sectionId, classId: $classId, from: $from, to: $to) {
      classId
      schoolDays
      threshold
      flags { subject trimmedDays schoolDays ratio flagged }
    }
  }
`;

export interface HwUsageEntryT {
  qid: string;
  count: number;
}
export interface HwQuestionUsageT {
  classId: string;
  feed: HwUsageEntryT[];
}

export const QUESTION_USAGE_FEED = gql<
  { questionUsageFeed: HwQuestionUsageT },
  { sectionId: string; classId: string }
>`
  query QuestionUsageFeed($sectionId: String!, $classId: String!) {
    questionUsageFeed(sectionId: $sectionId, classId: $classId) {
      classId
      feed { qid count }
    }
  }
`;

// --- Class-teacher assignment (D-#42; roster:manage) -----------------------

export interface AssignClassTeacherResultT {
  id: string;
  classTeacherId: string | null;
}

export const ASSIGN_CLASS_TEACHER = gql<
  { assignClassTeacher: AssignClassTeacherResultT },
  { sectionId: string; userId?: string | null }
>`
  mutation AssignClassTeacher($sectionId: String!, $userId: String) {
    assignClassTeacher(sectionId: $sectionId, userId: $userId) {
      id
      classTeacherId
    }
  }
`;
