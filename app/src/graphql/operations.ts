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
  email: string | null;
  phone: string | null;
  role: Role;
  name: string;
  active: boolean;
}

export const ME_QUERY = gql<{ me: MeUser | null }, NoVars>`
  query Me {
    me { id email phone role name active }
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

/** Guardian family login (J5.2/D-#59) — the app falls back to this when
 *  staffLogin does not match (guardians log in with the family phone). */
export const GUARDIAN_LOGIN = gql<
  { guardianLogin: AuthResult | null },
  { identifier: string; identifierKind: string; password: string }
>`
  mutation GuardianLogin($identifier: String!, $identifierKind: String!, $password: String!) {
    guardianLogin(identifier: $identifier, identifierKind: $identifierKind, password: $password) {
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
  supportTeacherIds?: string[];
  studentCount?: number;
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
      sections { id code nameBn active classTeacherId supportTeacherIds studentCount }
    }
  }
`;

export interface SectionMergeT {
  id: string;
  classId: string;
  combinedSectionId: string;
  sourceSectionIds: string[];
}

export const ACTIVE_SECTION_MERGES_QUERY = gql<{ activeSectionMerges: SectionMergeT[] }, NoVars>`
  query ActiveSectionMerges {
    activeSectionMerges { id classId combinedSectionId sourceSectionIds }
  }
`;

export const MERGE_SECTIONS = gql<
  { mergeSections: { combinedSectionId: string; movedStudents: number; sourceSectionIds: string[] } },
  { classId: string; combinedNameBn?: string | null }
>`
  mutation MergeSections($classId: String!, $combinedNameBn: String) {
    mergeSections(classId: $classId, combinedNameBn: $combinedNameBn) {
      combinedSectionId
      movedStudents
      sourceSectionIds
    }
  }
`;

export const SPLIT_SECTIONS = gql<
  { splitSections: { restoredSections: number; movedStudents: number } },
  { classId: string }
>`
  mutation SplitSections($classId: String!) {
    splitSections(classId: $classId) {
      restoredSections
      movedStudents
    }
  }
`;

export interface AcademicYearT {
  id: string;
  label: string;
  current: boolean;
}

export const ACADEMIC_YEARS_QUERY = gql<{ academicYears: AcademicYearT[] }, NoVars>`
  query AcademicYears {
    academicYears { id label current }
  }
`;

/** Add a new academic year (roster:manage); makeCurrent rolls the school over. */
export const CREATE_ACADEMIC_YEAR = gql<
  { createAcademicYear: AcademicYearT },
  { label: string; makeCurrent?: boolean | null }
>`
  mutation CreateAcademicYear($label: String!, $makeCurrent: Boolean) {
    createAcademicYear(label: $label, makeCurrent: $makeCurrent) { id label current }
  }
`;

/** Set the active academic year (roster:manage). */
export const SET_CURRENT_ACADEMIC_YEAR = gql<
  { setCurrentAcademicYear: AcademicYearT },
  { academicYearId: string }
>`
  mutation SetCurrentAcademicYear($academicYearId: String!) {
    setCurrentAcademicYear(academicYearId: $academicYearId) { id label current }
  }
`;

export interface RoomT {
  id: string;
  code: string;
  nameBn: string;
}

export const ROOMS_QUERY = gql<{ rooms: RoomT[] }, NoVars>`
  query Rooms {
    rooms { id code nameBn }
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
  teacherId: string | null;
  classId: string | null;
  sectionId: string | null;
  subjectId: string | null;
  coveringTeacherId: string | null;
  absentTeacherId: string | null;
  startDate: string | null;
  durationDays: number | null;
  proxyStatus: string | null;
}

const SCOPE_GRANT_FIELDS = `id kind active teacherId classId sectionId subjectId coveringTeacherId absentTeacherId startDate durationDays proxyStatus`;

export const MY_SCOPES_QUERY = gql<{ myScopes: ScopeGrantT[] }, NoVars>`
  query MyScopes {
    myScopes { ${SCOPE_GRANT_FIELDS} }
  }
`;

/** Admin proxy-grant list (user:manage) — extend/revoke without pasting ids. */
export const PROXY_GRANTS_QUERY = gql<{ proxyGrants: ScopeGrantT[] }, { activeOnly?: boolean | null }>`
  query ProxyGrants($activeOnly: Boolean) {
    proxyGrants(activeOnly: $activeOnly) { ${SCOPE_GRANT_FIELDS} }
  }
`;

/** Subject-teacher (teaching) grants for a section (user:manage). */
export const TEACHING_GRANTS_QUERY = gql<{ teachingGrants: ScopeGrantT[] }, { sectionId: string }>`
  query TeachingGrants($sectionId: String!) {
    teachingGrants(sectionId: $sectionId) { ${SCOPE_GRANT_FIELDS} }
  }
`;

export const GRANT_TEACHING = gql<
  { grantTeaching: { grantId: string } },
  { teacherId: string; sectionId: string; subjectId: string }
>`
  mutation GrantTeaching($teacherId: String!, $sectionId: String!, $subjectId: String!) {
    grantTeaching(teacherId: $teacherId, sectionId: $sectionId, subjectId: $subjectId) { grantId }
  }
`;

export const REVOKE_TEACHING = gql<{ revokeTeaching: boolean }, { grantId: string }>`
  mutation RevokeTeaching($grantId: String!) {
    revokeTeaching(grantId: $grantId)
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

/** Teacher options for the reviewer-assignment picker (content:assign_review). */
export interface TeacherOptionT {
  id: string;
  name: string;
  phone: string | null;
}

export const TEACHERS_QUERY = gql<{ teachers: TeacherOptionT[] }, NoVars>`
  query Teachers {
    teachers { id name phone }
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

// --- Bulk reviewer-assignment + Principal overview (content:assign_review) ---

export interface AssignablePlanT {
  artifactId: string;
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  title: string | null;
  reviewStatus: string;
  currentReviewerId: string | null;
  currentReviewerName: string | null;
  roundStatus: string | null;
}

/** Current plans + their open-round assignment state, for the multi-select picker. */
export const ASSIGNABLE_PLANS = gql<{ assignablePlans: AssignablePlanT[] }, NoVars>`
  query AssignablePlans {
    assignablePlans {
      artifactId docType subject classLevel anchorWord addressNumber title
      reviewStatus currentReviewerId currentReviewerName roundStatus
    }
  }
`;

export interface ReviewerLoadT {
  reviewerId: string;
  reviewerName: string;
  assignedCount: number;
  submittedCount: number;
  openCount: number;
}

/** Per-reviewer open-round counts (Principal overview — who has how many). */
export const REVIEWER_ASSIGNMENT_LOAD = gql<{ reviewerAssignmentLoad: ReviewerLoadT[] }, NoVars>`
  query ReviewerAssignmentLoad {
    reviewerAssignmentLoad { reviewerId reviewerName assignedCount submittedCount openCount }
  }
`;

export interface BulkAssignResultT {
  assignedCount: number;
  failedCount: number;
  failures: string[];
}

/** Assign many plans to one reviewer in one call. */
export const ASSIGN_PLAN_REVIEW_BULK = gql<
  { assignPlanReviewBulk: BulkAssignResultT },
  { artifactIds: string[]; reviewerId: string }
>`
  mutation AssignPlanReviewBulk($artifactIds: [String!]!, $reviewerId: String!) {
    assignPlanReviewBulk(artifactIds: $artifactIds, reviewerId: $reviewerId) {
      assignedCount failedCount failures
    }
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
  email: string | null;
  phone: string | null;
  role: string;
  name: string;
  active: boolean;
}

/** Full staff-account list (user:manage / Principal) — the UserList screen. */
export const USERS_QUERY = gql<{ users: UserT[] }, NoVars>`
  query Users {
    users { id email phone role name active }
  }
`;

export const CREATE_USER = gql<
  { createUser: UserT },
  { email: string; password: string; role: string; name: string }
>`
  mutation CreateUser($email: String!, $password: String!, $role: String!, $name: String!) {
    createUser(email: $email, password: $password, role: $role, name: $name) {
      id
      email
      phone
      role
      name
      active
    }
  }
`;

// ===========================================================================
// Credential provisioning (D-#59 guardians, D-#60 staff)
// ===========================================================================

export interface ProvisionedCredentialT {
  identifier: string;
  identifierKind: string;
  password: string;
  name: string;
  contextLabel: string;
  studentCount: number;
  waLink: string;
  alreadyExisted: boolean;
}

const PROVISIONED_FIELDS = `
  identifier
  identifierKind
  password
  name
  contextLabel
  studentCount
  waLink
  alreadyExisted
`;

export interface GuardianCandidateT {
  phone: string;
  suggestedName: string;
  students: Array<{ id: string; name: string; className: string }>;
  loginExists: boolean;
  loginEnabled: boolean;
  guardianId: string | null;
}

export const GUARDIAN_CREDENTIAL_CANDIDATES = gql<
  { guardianCredentialCandidates: GuardianCandidateT[] },
  NoVars
>`
  query GuardianCredentialCandidates {
    guardianCredentialCandidates {
      phone
      suggestedName
      students { id name className }
      loginExists
      loginEnabled
      guardianId
    }
  }
`;

export const PROVISION_GUARDIAN_LOGIN = gql<
  { provisionGuardianLogin: ProvisionedCredentialT },
  { phone: string }
>`
  mutation ProvisionGuardianLogin($phone: String!) {
    provisionGuardianLogin(phone: $phone) {${PROVISIONED_FIELDS}}
  }
`;

export const RESET_GUARDIAN_PASSWORD = gql<
  { resetGuardianPassword: ProvisionedCredentialT },
  { guardianId: string }
>`
  mutation ResetGuardianPassword($guardianId: String!) {
    resetGuardianPassword(guardianId: $guardianId) {${PROVISIONED_FIELDS}}
  }
`;

export interface StaffCandidateT {
  staffId: string;
  name: string;
  category: string;
  phone: string | null;
  mappedRole: string | null;
  provisionable: boolean;
  reason: string | null;
  loginExists: boolean;
  userId: string | null;
}

export const STAFF_CREDENTIAL_CANDIDATES = gql<
  { staffCredentialCandidates: StaffCandidateT[] },
  NoVars
>`
  query StaffCredentialCandidates {
    staffCredentialCandidates {
      staffId
      name
      category
      phone
      mappedRole
      provisionable
      reason
      loginExists
      userId
    }
  }
`;

export const PROVISION_STAFF_LOGIN = gql<
  { provisionStaffLogin: ProvisionedCredentialT },
  { staffProfileId: string }
>`
  mutation ProvisionStaffLogin($staffProfileId: String!) {
    provisionStaffLogin(staffProfileId: $staffProfileId) {${PROVISIONED_FIELDS}}
  }
`;

export const RESET_STAFF_PASSWORD = gql<
  { resetStaffPassword: ProvisionedCredentialT },
  { userId: string }
>`
  mutation ResetStaffPassword($userId: String!) {
    resetStaffPassword(userId: $userId) {${PROVISIONED_FIELDS}}
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
  /** StoredFile id of the attached checked-answer file (GP-A) — null when none. */
  answerFileId: string | null;
}

export const HOMEWORK_STUDENT_RECORDS = gql<
  { homeworkStudentRecords: HwStudentRecordT[] },
  { sectionId: string; classId: string; itemId: string }
>`
  query HomeworkStudentRecords($sectionId: String!, $classId: String!, $itemId: String!) {
    homeworkStudentRecords(sectionId: $sectionId, classId: $classId, itemId: $itemId) {
      id hwId studentId state stateDates { state at } dueDate chaseCount result answerFileId
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
  /** StoredFile id of the attached question file (GP-A) — null when none. */
  questionFileId: string | null;
}

export const HOMEWORK_ITEMS = gql<
  { homeworkItems: HwItemT[] },
  { sectionId: string; classId: string; dateGiven?: string | null }
>`
  query HomeworkItems($sectionId: String!, $classId: String!, $dateGiven: String) {
    homeworkItems(sectionId: $sectionId, classId: $classId, dateGiven: $dateGiven) {
      id hwId classLevel subject dateGiven topTags timeDecl qCount revItem status questionFileId
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
      id hwId classLevel subject dateGiven topTags timeDecl qCount revItem status questionFileId
    }
  }
`;

// --- GP-A homework file attachments (D-#70) ---------------------------------
// Upload itself is REST (POST /files/hw, see lib/files.ts); these bind the
// uploaded StoredFile to its homework doc. Teachers attach; guardians only view.

export interface HwFileAttachResultT {
  id: string;
  hwId: string;
  fileId: string;
}

export const ATTACH_HW_QUESTION_FILE = gql<
  { attachHomeworkQuestionFile: HwFileAttachResultT },
  { hwItemId: string; fileId: string }
>`
  mutation AttachHomeworkQuestionFile($hwItemId: String!, $fileId: String!) {
    attachHomeworkQuestionFile(hwItemId: $hwItemId, fileId: $fileId) {
      id hwId fileId
    }
  }
`;

export const ATTACH_HW_ANSWER_FILE = gql<
  { attachHomeworkAnswerFile: HwFileAttachResultT },
  { recordId: string; fileId: string }
>`
  mutation AttachHomeworkAnswerFile($recordId: String!, $fileId: String!) {
    attachHomeworkAnswerFile(recordId: $recordId, fileId: $fileId) {
      id hwId fileId
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

export interface HwTransitionResultT {
  recordId: string;
  hwId: string;
  state: string;
  chaseCount: number;
  result: string | null;
  dueDate: string | null;
}

/** Apply one legal lifecycle transition to a per-student record (GIVEN→DUE→SUBMITTED…). */
export const TRANSITION_HOMEWORK_RECORD = gql<
  { transitionHomeworkRecord: HwTransitionResultT },
  { sectionId: string; recordId: string; toState: string; result?: string | null }
>`
  mutation TransitionHomeworkRecord($sectionId: String!, $recordId: String!, $toState: String!, $result: String) {
    transitionHomeworkRecord(sectionId: $sectionId, recordId: $recordId, toState: $toState, result: $result) {
      recordId hwId state chaseCount result dueDate
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

// ===========================================================================
// Routine / Timetable (R-1..R-3) — routine:read / routine:manage
// ===========================================================================

export interface RoutineSlotT {
  id: string;
  groupType: string;
  groupId: string;
  classId: string | null;
  dayOfWeek: string;
  periodNumber: number;
  subject: string;
  track: string;
  isBreak: boolean;
  teacherId: string | null;
  roomId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  coverTeacherId: string | null;
  teacherName: string | null;
  coverTeacherName: string | null;
  startTime: string | null;
  endTime: string | null;
}

const ROUTINE_SLOT_FIELDS = `
  id groupType groupId classId dayOfWeek periodNumber subject track
  isBreak teacherId roomId effectiveFrom effectiveTo active coverTeacherId
  teacherName coverTeacherName startTime endTime
`;

export const ROUTINE_SLOTS_QUERY = gql<
  { routineSlots: RoutineSlotT[] },
  { groupType: string; groupId: string }
>`
  query RoutineSlots($groupType: String!, $groupId: String!) {
    routineSlots(groupType: $groupType, groupId: $groupId) { ${ROUTINE_SLOT_FIELDS} }
  }
`;

export const MY_ROUTINE_QUERY = gql<{ myRoutineSlots: RoutineSlotT[] }, NoVars>`
  query MyRoutine {
    myRoutineSlots { ${ROUTINE_SLOT_FIELDS} }
  }
`;

// Master grid (admin overview): all groups × periods for one day + conflicts.
export interface RoutineMasterColumnT { periodNumber: number; startTime: string | null; endTime: string | null; isBreak: boolean; }
export interface RoutineMasterRowT { groupType: string; groupId: string; label: string; sublabel: string | null; }
export interface RoutineMasterSlotT { id: string; groupType: string; groupId: string; periodNumber: number; subject: string; isBreak: boolean; teacherId: string | null; teacherName: string | null; }
export interface RoutineMasterConflictT { periodNumber: number; teacherId: string; teacherName: string | null; labels: string[]; }
export interface RoutineMasterT {
  day: string;
  columns: RoutineMasterColumnT[];
  rows: RoutineMasterRowT[];
  slots: RoutineMasterSlotT[];
  conflicts: RoutineMasterConflictT[];
}
const ROUTINE_MASTER_FIELDS = `
  day
  columns { periodNumber startTime endTime isBreak }
  rows { groupType groupId label sublabel }
  slots { id groupType groupId periodNumber subject isBreak teacherId teacherName }
  conflicts { periodNumber teacherId teacherName labels }
`;
export const ROUTINE_MASTER_QUERY = gql<{ routineMaster: RoutineMasterT }, { day: string }>`
  query RoutineMaster($day: String!) { routineMaster(day: $day) { ${ROUTINE_MASTER_FIELDS} } }
`;
export const ROUTINE_MASTER_WEEK_QUERY = gql<{ routineMasterWeek: RoutineMasterT[] }, NoVars>`
  query RoutineMasterWeek { routineMasterWeek { ${ROUTINE_MASTER_FIELDS} } }
`;

export interface SubjectGroupT {
  id: string;
  track: string;
  level: string;
  gender: string;
  code: string;
  nameBn: string;
  active: boolean;
}

export const SUBJECT_GROUPS_QUERY = gql<
  { subjectGroups: SubjectGroupT[] },
  { track?: string | null }
>`
  query SubjectGroups($track: String) {
    subjectGroups(track: $track) { id track level gender code nameBn active }
  }
`;

export interface CreateSlotResultT {
  warnings: string[];
  slot: RoutineSlotT;
}

export const CREATE_ROUTINE_SLOT = gql<
  { createRoutineSlot: CreateSlotResultT },
  {
    groupType: string;
    groupId: string;
    dayOfWeek: string;
    periodNumber: number;
    subject: string;
    track: string;
    isBreak: boolean;
    teacherId?: string | null;
    roomId?: string | null;
    effectiveFrom: string;
    effectiveTo?: string | null;
  }
>`
  mutation CreateRoutineSlot(
    $groupType: String!, $groupId: String!, $dayOfWeek: String!, $periodNumber: Int!,
    $subject: String!, $track: String!, $isBreak: Boolean!, $teacherId: String,
    $roomId: String, $effectiveFrom: String!, $effectiveTo: String
  ) {
    createRoutineSlot(
      groupType: $groupType, groupId: $groupId, dayOfWeek: $dayOfWeek, periodNumber: $periodNumber,
      subject: $subject, track: $track, isBreak: $isBreak, teacherId: $teacherId,
      roomId: $roomId, effectiveFrom: $effectiveFrom, effectiveTo: $effectiveTo
    ) {
      warnings
      slot { ${ROUTINE_SLOT_FIELDS} }
    }
  }
`;

export const DELETE_ROUTINE_SLOT = gql<
  { deleteRoutineSlot: boolean },
  { id: string }
>`
  mutation DeleteRoutineSlot($id: String!) {
    deleteRoutineSlot(id: $id)
  }
`;

// --- Routine cover / proxy-manage (R-4) ------------------------------------

export const ROUTINE_FOR_DATE_QUERY = gql<
  { routineForDate: RoutineSlotT[] },
  { groupType: string; groupId: string; date: string }
>`
  query RoutineForDate($groupType: String!, $groupId: String!, $date: String!) {
    routineForDate(groupType: $groupType, groupId: $groupId, date: $date) { ${ROUTINE_SLOT_FIELDS} }
  }
`;

export interface AvailabilityRowT {
  teacherId: string;
  name: string;
  classCount: number;
  free: boolean;
}

export const TEACHER_AVAILABILITY_QUERY = gql<
  { teacherAvailability: AvailabilityRowT[] },
  { date: string; periodNumber: number }
>`
  query TeacherAvailability($date: String!, $periodNumber: Int!) {
    teacherAvailability(date: $date, periodNumber: $periodNumber) {
      teacherId name classCount free
    }
  }
`;

// ===========================================================================
// Guardian portal (GP-1/GP-2, D-#68/#69) — guardian:read_child, link-scoped.
// The slot shape is the NARROW guardian type: subject + period + time ONLY.
// ===========================================================================

export interface GuardianChildGroupT {
  id: string;
  name: string;
}

export interface GuardianChildT {
  studentId: string;
  nameBn: string;
  gender: string | null;
  rosterClassLabel: string;
  sectionId: string;
  sectionName: string;
  quranGroup: GuardianChildGroupT | null;
  arabicGroup: GuardianChildGroupT | null;
}

export const MY_CHILDREN_QUERY = gql<{ myChildren: GuardianChildT[] }, NoVars>`
  query MyChildren {
    myChildren {
      studentId nameBn gender rosterClassLabel sectionId sectionName
      quranGroup { id name }
      arabicGroup { id name }
    }
  }
`;

export interface GuardianSlotT {
  subject: string;
  subjectLabelBn: string;
  periodNumber: number;
  startHHMM: string | null;
  endHHMM: string | null;
}

export interface GuardianDayT {
  dayType: string;
  dayTypeLabelBn: string;
  holidayNameBn: string | null;
  slots: GuardianSlotT[];
}

export const CHILD_ROUTINE_QUERY = gql<
  { childRoutine: GuardianDayT },
  { studentId: string; date: string }
>`
  query ChildRoutine($studentId: String!, $date: String!) {
    childRoutine(studentId: $studentId, date: $date) {
      dayType dayTypeLabelBn holidayNameBn
      slots { subject subjectLabelBn periodNumber startHHMM endHHMM }
    }
  }
`;

export interface GuardianClassNoteT {
  subject: string;
  subjectLabelBn: string;
  periodNumber: number | null;
  taughtSummaryBn: string;
  homework: {
    hwId: string;
    subject: string;
    subjectLabelBn: string;
    qCount: number;
    timeDecl: number;
  } | null;
}

export const CHILD_CLASS_NOTES_QUERY = gql<
  { childClassNotes: GuardianClassNoteT[] },
  { studentId: string; date: string }
>`
  query ChildClassNotes($studentId: String!, $date: String!) {
    childClassNotes(studentId: $studentId, date: $date) {
      subject subjectLabelBn periodNumber taughtSummaryBn
      homework { hwId subject subjectLabelBn qCount timeDecl }
    }
  }
`;

export interface GuardianHwRecordT {
  recordId: string;
  hwId: string;
  subject: string;
  subjectLabelBn: string;
  dateGiven: string;
  state: string;
  stateLabelBn: string;
  givenAt: string | null;
  dueDate: string | null;
  submittedAt: string | null;
  checkedAt: string | null;
  returnedAt: string | null;
  chaseCount: number;
  result: string | null;
  resultLabelBn: string | null;
  resubOf: string | null;
  topupFlag: boolean;
  topupQCount: number;
  topupTimeMin: number | null;
  questionFileId: string | null;
  answerFileId: string | null;
}

export const CHILD_HOMEWORK_QUERY = gql<
  { childHomework: GuardianHwRecordT[] },
  { studentId: string; from: string; to: string }
>`
  query ChildHomework($studentId: String!, $from: String!, $to: String!) {
    childHomework(studentId: $studentId, from: $from, to: $to) {
      recordId hwId subject subjectLabelBn dateGiven state stateLabelBn
      givenAt dueDate submittedAt checkedAt returnedAt
      chaseCount result resultLabelBn resubOf
      topupFlag topupQCount topupTimeMin
      questionFileId answerFileId
    }
  }
`;

export interface GuardianDayLoadT {
  studentId: string;
  baseMinutes: number;
  topupMinutes: number;
  totalMinutes: number;
  ceiling: number;
  overCeiling: boolean;
}

export const CHILD_DAY_LOAD_QUERY = gql<
  { childDayLoad: GuardianDayLoadT },
  { studentId: string; date: string }
>`
  query ChildDayLoad($studentId: String!, $date: String!) {
    childDayLoad(studentId: $studentId, date: $date) {
      studentId baseMinutes topupMinutes totalMinutes ceiling overCeiling
    }
  }
`;

export interface SubstitutionT {
  id: string;
  slotId: string;
  date: string;
  coverTeacherId: string;
  absentTeacherId: string | null;
  reason: string | null;
  active: boolean;
}

export const COVERS_FOR_DATE_QUERY = gql<
  { coversForDate: SubstitutionT[] },
  { date: string }
>`
  query CoversForDate($date: String!) {
    coversForDate(date: $date) {
      id slotId date coverTeacherId absentTeacherId reason active
    }
  }
`;

export const ASSIGN_COVER = gql<
  { assignCover: SubstitutionT },
  { slotId: string; date: string; coverTeacherId: string; reason?: string | null; durationDays?: number | null }
>`
  mutation AssignCover($slotId: String!, $date: String!, $coverTeacherId: String!, $reason: String, $durationDays: Int) {
    assignCover(slotId: $slotId, date: $date, coverTeacherId: $coverTeacherId, reason: $reason, durationDays: $durationDays) {
      id slotId coverTeacherId active
    }
  }
`;

export const CANCEL_COVER = gql<{ cancelCover: boolean }, { id: string }>`
  mutation CancelCover($id: String!) {
    cancelCover(id: $id)
  }
`;

// --- Routine triggers + class-note / daily-diary (R-5) ---------------------

export interface ClassNoteT {
  id: string;
  slotId: string;
  groupType: string;
  groupId: string;
  date: string;
  subject: string;
  taughtSummaryBn: string;
  homeworkItemId: string | null;
  publishedBy: string;
  publishedAt: string;
}

const CLASS_NOTE_FIELDS = `
  id slotId groupType groupId date subject taughtSummaryBn homeworkItemId publishedBy publishedAt
`;

export const CLASS_NOTES_FOR_DATE_QUERY = gql<
  { classNotesForDate: ClassNoteT[] },
  { groupType: string; groupId: string; date: string }
>`
  query ClassNotesForDate($groupType: String!, $groupId: String!, $date: String!) {
    classNotesForDate(groupType: $groupType, groupId: $groupId, date: $date) { ${CLASS_NOTE_FIELDS} }
  }
`;

export const MY_CLASS_NOTE_PROMPTS_QUERY = gql<
  { myClassNotePrompts: RoutineSlotT[] },
  { date: string }
>`
  query MyClassNotePrompts($date: String!) {
    myClassNotePrompts(date: $date) { ${ROUTINE_SLOT_FIELDS} }
  }
`;

export const PUBLISH_CLASS_NOTE = gql<
  { publishClassNote: ClassNoteT },
  { slotId: string; date: string; taughtSummaryBn: string; homeworkItemId?: string | null }
>`
  mutation PublishClassNote($slotId: String!, $date: String!, $taughtSummaryBn: String!, $homeworkItemId: String) {
    publishClassNote(slotId: $slotId, date: $date, taughtSummaryBn: $taughtSummaryBn, homeworkItemId: $homeworkItemId) {
      ${CLASS_NOTE_FIELDS}
    }
  }
`;

export interface BellTriggerT {
  periodNumber: number;
  endHHMM: string;
  isBreak: boolean;
  bellAdminId: string | null;
}

export const BELL_SCHEDULE_QUERY = gql<
  { bellSchedule: BellTriggerT[] },
  { date: string; audienceKey: string }
>`
  query BellSchedule($date: String!, $audienceKey: String!) {
    bellSchedule(date: $date, audienceKey: $audienceKey) {
      periodNumber endHHMM isBreak bellAdminId
    }
  }
`;

export interface BellDutyT {
  id: string;
  date: string;
  periodNumber: number | null;
  adminId: string;
  active: boolean;
}

export const ASSIGN_BELL_DUTY = gql<
  { assignBellDuty: BellDutyT },
  { date: string; periodNumber?: number | null; adminId: string }
>`
  mutation AssignBellDuty($date: String!, $periodNumber: Int, $adminId: String!) {
    assignBellDuty(date: $date, periodNumber: $periodNumber, adminId: $adminId) {
      id date periodNumber adminId active
    }
  }
`;

// --- Class-teacher generalization: support + history + my-sections (CT-1) ---

export const SET_SUPPORT_TEACHER = gql<
  { setSupportTeacher: { id: string; classTeacherId: string | null; supportTeacherIds: string[] } },
  { sectionId: string; userId: string; add: boolean }
>`
  mutation SetSupportTeacher($sectionId: String!, $userId: String!, $add: Boolean!) {
    setSupportTeacher(sectionId: $sectionId, userId: $userId, add: $add) {
      id
      classTeacherId
      supportTeacherIds
    }
  }
`;

export interface ClassTeacherAssignmentT {
  id: string;
  sectionId: string;
  role: string;
  teacherId: string | null;
  op: string;
  actorId: string;
  at: string;
}

export const CLASS_TEACHER_HISTORY_QUERY = gql<
  { classTeacherHistory: ClassTeacherAssignmentT[] },
  { sectionId: string }
>`
  query ClassTeacherHistory($sectionId: String!) {
    classTeacherHistory(sectionId: $sectionId) {
      id sectionId role teacherId op actorId at
    }
  }
`;

export const MY_SECTIONS_AS_CLASS_TEACHER_QUERY = gql<
  { mySectionsAsClassTeacher: SectionT[] },
  NoVars
>`
  query MySectionsAsClassTeacher {
    mySectionsAsClassTeacher { id code nameBn active classTeacherId supportTeacherIds }
  }
`;

// ===========================================================================
// Attendance (AT-1..AT-3 + AT-5, D-#63..#67)
// ===========================================================================

export interface AttPreviewRowT {
  name: string;
  shift: string | null;
  status: string | null;
  punchIn: string | null;
  punchOut: string | null;
  staffProfileId: string | null;
  staffName: string | null;
  skipped: boolean;
}

export interface AttImportPreviewT {
  dateKey: string;
  rows: AttPreviewRowT[];
  matched: number;
  unmatched: number;
  skipped: number;
  alreadyImported: boolean;
}

export const PREVIEW_TEACHER_ATTENDANCE = gql<
  { previewTeacherAttendanceImport: AttImportPreviewT },
  { fileBase64: string }
>`
  mutation PreviewTeacherAttendance($fileBase64: String!) {
    previewTeacherAttendanceImport(fileBase64: $fileBase64) {
      dateKey
      rows { name shift status punchIn punchOut staffProfileId staffName skipped }
      matched unmatched skipped alreadyImported
    }
  }
`;

export interface AttImportResultT {
  dateKey: string;
  imported: number;
  skipped: number;
  ignored: number;
  replaced: boolean;
}

export const COMMIT_TEACHER_ATTENDANCE = gql<
  { commitTeacherAttendanceImport: AttImportResultT },
  { fileBase64: string; mappings?: { name: string; staffProfileId: string }[] | null; ignoreNames?: string[] | null }
>`
  mutation CommitTeacherAttendance($fileBase64: String!, $mappings: [StaffAliasMappingInput!], $ignoreNames: [String!]) {
    commitTeacherAttendanceImport(fileBase64: $fileBase64, mappings: $mappings, ignoreNames: $ignoreNames) {
      dateKey imported skipped ignored replaced
    }
  }
`;

export interface TeacherAttendanceRecordT {
  id: string;
  staffProfileId: string;
  staffName: string;
  category: string;
  status: string;
  punchIn: string | null;
  punchOut: string | null;
  shift: string | null;
}

export const TEACHER_ATTENDANCE_FOR_DATE = gql<
  { teacherAttendanceForDate: TeacherAttendanceRecordT[] },
  { dateKey: string }
>`
  query TeacherAttendanceForDate($dateKey: String!) {
    teacherAttendanceForDate(dateKey: $dateKey) {
      id staffProfileId staffName category status punchIn punchOut shift
    }
  }
`;

export const TEACHER_ATTENDANCE_IMPORTS = gql<
  { teacherAttendanceImports: { dateKey: string; records: number }[] },
  NoVars
>`
  query TeacherAttendanceImports {
    teacherAttendanceImports { dateKey records }
  }
`;

export interface StaffAttendanceSummaryT {
  staffProfileId: string;
  staffName: string;
  category: string;
  days: number;
  present: number;
  late: number;
  leave: number;
  absent: number;
  presentPct: number;
}

export const TEACHER_ATTENDANCE_SUMMARY = gql<
  { teacherAttendanceSummary: StaffAttendanceSummaryT[] },
  { fromKey: string; toKey: string }
>`
  query TeacherAttendanceSummary($fromKey: String!, $toKey: String!) {
    teacherAttendanceSummary(fromKey: $fromKey, toKey: $toKey) {
      staffProfileId staffName category days present late leave absent presentPct
    }
  }
`;

export interface MarkingSectionT {
  sectionId: string;
  sectionCode: string;
  sectionNameBn: string;
  classLevel: number;
  classNameBn: string;
  marked: boolean;
  viaAssignment: boolean;
  studentCount: number;
}

export const MY_MARKING_SECTIONS = gql<
  { myMarkingSections: MarkingSectionT[] },
  { dateKey: string }
>`
  query MyMarkingSections($dateKey: String!) {
    myMarkingSections(dateKey: $dateKey) {
      sectionId sectionCode sectionNameBn classLevel classNameBn marked viaAssignment studentCount
    }
  }
`;

export interface StudentAttendanceDayT {
  id: string;
  sectionId: string;
  dateKey: string;
  absentStudentIds: string[];
  markedBy: string;
  markedAt: string;
  amendedBy: string | null;
  amendedAt: string | null;
}

export const SECTION_ATTENDANCE = gql<
  { sectionAttendance: StudentAttendanceDayT | null },
  { sectionId: string; dateKey: string }
>`
  query SectionAttendance($sectionId: String!, $dateKey: String!) {
    sectionAttendance(sectionId: $sectionId, dateKey: $dateKey) {
      id sectionId dateKey absentStudentIds markedBy markedAt amendedBy amendedAt
    }
  }
`;

export const MARK_SECTION_ATTENDANCE = gql<
  { markSectionAttendance: StudentAttendanceDayT },
  { sectionId: string; dateKey: string; absentStudentIds: string[] }
>`
  mutation MarkSectionAttendance($sectionId: String!, $dateKey: String!, $absentStudentIds: [String!]!) {
    markSectionAttendance(sectionId: $sectionId, dateKey: $dateKey, absentStudentIds: $absentStudentIds) {
      id sectionId dateKey absentStudentIds markedBy markedAt amendedBy amendedAt
    }
  }
`;

export interface MarkerAssignmentT {
  id: string;
  sectionId: string;
  teacherId: string;
  teacherName: string | null;
  sectionCode: string | null;
  sectionNameBn: string | null;
  classNameBn: string | null;
  fromKey: string;
  toKey: string;
  active: boolean;
}

const MARKER_ASSIGNMENT_FIELDS =
  "id sectionId teacherId teacherName sectionCode sectionNameBn classNameBn fromKey toKey active";

export const ASSIGN_SECTION_MARKER = gql<
  { assignSectionMarker: MarkerAssignmentT },
  { sectionId: string; teacherId: string; fromKey: string; toKey: string }
>`
  mutation AssignSectionMarker($sectionId: String!, $teacherId: String!, $fromKey: String!, $toKey: String!) {
    assignSectionMarker(sectionId: $sectionId, teacherId: $teacherId, fromKey: $fromKey, toKey: $toKey) {
      ${MARKER_ASSIGNMENT_FIELDS}
    }
  }
`;

export const REVOKE_SECTION_MARKER = gql<
  { revokeSectionMarker: MarkerAssignmentT },
  { assignmentId: string }
>`
  mutation RevokeSectionMarker($assignmentId: String!) {
    revokeSectionMarker(assignmentId: $assignmentId) { ${MARKER_ASSIGNMENT_FIELDS} }
  }
`;

export const SECTION_MARKER_ASSIGNMENTS = gql<
  { sectionMarkerAssignments: MarkerAssignmentT[] },
  { dateKey: string }
>`
  query SectionMarkerAssignments($dateKey: String!) {
    sectionMarkerAssignments(dateKey: $dateKey) { ${MARKER_ASSIGNMENT_FIELDS} }
  }
`;

export interface AbsenteeEntryT {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  schoolId: string;
  leaveCovered: boolean;
}

export interface SectionAbsenteesT {
  sectionId: string;
  sectionCode: string;
  sectionNameBn: string;
  absentCount: number;
  absentees: AbsenteeEntryT[];
}

export interface ClassAbsenteesT {
  classId: string;
  classLevel: number;
  classNameBn: string;
  absentCount: number;
  sections: SectionAbsenteesT[];
}

export const ABSENTEE_REPORT = gql<{ absenteeReport: ClassAbsenteesT[] }, { dateKey: string }>`
  query AbsenteeReport($dateKey: String!) {
    absenteeReport(dateKey: $dateKey) {
      classId classLevel classNameBn absentCount
      sections {
        sectionId sectionCode sectionNameBn absentCount
        absentees { studentId name nameBn rollNumber schoolId leaveCovered }
      }
    }
  }
`;

export interface UnmarkedSectionT {
  sectionId: string;
  sectionCode: string;
  sectionNameBn: string;
  classLevel: number;
  classNameBn: string;
  markerTeacherId: string | null;
  markerName: string | null;
}

export const UNMARKED_SECTIONS = gql<{ unmarkedSections: UnmarkedSectionT[] }, { dateKey: string }>`
  query UnmarkedSections($dateKey: String!) {
    unmarkedSections(dateKey: $dateKey) {
      sectionId sectionCode sectionNameBn classLevel classNameBn markerTeacherId markerName
    }
  }
`;

export interface AbsentNoApplicationT {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  schoolId: string;
  sectionId: string;
  dateKeys: string[];
}

export const ABSENT_NO_APPLICATION = gql<
  { absentNoApplication: AbsentNoApplicationT[] },
  { sectionId?: string | null; fromKey: string; toKey: string }
>`
  query AbsentNoApplication($sectionId: String, $fromKey: String!, $toKey: String!) {
    absentNoApplication(sectionId: $sectionId, fromKey: $fromKey, toKey: $toKey) {
      studentId name nameBn rollNumber schoolId sectionId dateKeys
    }
  }
`;

export interface LeaveApplicationT {
  id: string;
  studentId: string;
  fromKey: string;
  toKey: string;
  reason: string;
  submittedBy: string;
  submittedAt: string;
}

export const SUBMIT_LEAVE_APPLICATION = gql<
  { submitLeaveApplication: LeaveApplicationT },
  { studentId: string; fromKey: string; toKey: string; reason: string }
>`
  mutation SubmitLeaveApplication($studentId: String!, $fromKey: String!, $toKey: String!, $reason: String!) {
    submitLeaveApplication(studentId: $studentId, fromKey: $fromKey, toKey: $toKey, reason: $reason) {
      id studentId fromKey toKey reason submittedBy submittedAt
    }
  }
`;

// AT-4 (D-#65): register this device's Expo push token (own-row; any authed user).
export const REGISTER_PUSH_DEVICE = gql<
  { registerPushDevice: boolean },
  { token: string; platform?: string | null }
>`
  mutation RegisterPushDevice($token: String!, $platform: String) {
    registerPushDevice(token: $token, platform: $platform)
  }
`;

// AT4.7: Office-only wa.me chase link for an absent-no-application student.
export const GUARDIAN_CHASE_LINK = gql<
  { guardianChaseLink: string | null },
  { studentId: string }
>`
  query GuardianChaseLink($studentId: String!) {
    guardianChaseLink(studentId: $studentId)
  }
`;

// ===========================================================================
// Assignment Tracker (AS-T1..AS-T5, D-#85–#89)
// ===========================================================================

export interface AsScheduleEntryT {
  id: string;
  cycleWeek: number;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  teacherId: string;
}

export interface AsScheduleT {
  id: string;
  academicYearId: string;
  termStartDate: string;
  deliveryDayOfWeek: number;
  dueDayOfWeek: number;
  entries: AsScheduleEntryT[];
}

const AS_SCHEDULE_FIELDS = `
  id academicYearId termStartDate deliveryDayOfWeek dueDayOfWeek
  entries { id cycleWeek classId classLevel sectionId subject teacherId }
`;

export const AS_SCHEDULE_QUERY = gql<
  { assignmentSchedule: AsScheduleT | null },
  { academicYearId: string }
>`
  query AssignmentSchedule($academicYearId: String!) {
    assignmentSchedule(academicYearId: $academicYearId) { ${AS_SCHEDULE_FIELDS} }
  }
`;

export const UPSERT_AS_SCHEDULE = gql<
  { upsertAssignmentSchedule: AsScheduleT },
  { academicYearId: string; termStartDate: string; deliveryDayOfWeek?: number | null; dueDayOfWeek?: number | null }
>`
  mutation UpsertAssignmentSchedule($academicYearId: String!, $termStartDate: String!, $deliveryDayOfWeek: Int, $dueDayOfWeek: Int) {
    upsertAssignmentSchedule(academicYearId: $academicYearId, termStartDate: $termStartDate, deliveryDayOfWeek: $deliveryDayOfWeek, dueDayOfWeek: $dueDayOfWeek) { ${AS_SCHEDULE_FIELDS} }
  }
`;

export const ADD_AS_SCHEDULE_ENTRY = gql<
  { addAssignmentScheduleEntry: AsScheduleT },
  { academicYearId: string; cycleWeek: number; classId: string; classLevel: number; sectionId: string; subject: string; teacherId: string }
>`
  mutation AddAssignmentScheduleEntry($academicYearId: String!, $cycleWeek: Int!, $classId: String!, $classLevel: Int!, $sectionId: String!, $subject: String!, $teacherId: String!) {
    addAssignmentScheduleEntry(academicYearId: $academicYearId, cycleWeek: $cycleWeek, classId: $classId, classLevel: $classLevel, sectionId: $sectionId, subject: $subject, teacherId: $teacherId) { ${AS_SCHEDULE_FIELDS} }
  }
`;

export const REMOVE_AS_SCHEDULE_ENTRY = gql<
  { removeAssignmentScheduleEntry: AsScheduleT },
  { academicYearId: string; entryId: string }
>`
  mutation RemoveAssignmentScheduleEntry($academicYearId: String!, $entryId: String!) {
    removeAssignmentScheduleEntry(academicYearId: $academicYearId, entryId: $entryId) { ${AS_SCHEDULE_FIELDS} }
  }
`;

export interface ExpectedAsItemT {
  entryId: string;
  cycleWeek: number;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  teacherId: string;
  delivered: boolean;
  asItemId: string | null;
  asId: string | null;
}

export interface ExpectedAsWeekT {
  academicYearId: string;
  weekNumber: number;
  cycleWeek: number;
  weekStart: string;
  suspended: boolean;
  deliveryDate: string | null;
  dueDate: string | null;
  items: ExpectedAsItemT[];
}

export const EXPECTED_AS_WEEK = gql<
  { expectedAssignmentsForWeek: ExpectedAsWeekT },
  { academicYearId: string; weekNumber: number }
>`
  query ExpectedAssignmentsForWeek($academicYearId: String!, $weekNumber: Int!) {
    expectedAssignmentsForWeek(academicYearId: $academicYearId, weekNumber: $weekNumber) {
      academicYearId weekNumber cycleWeek weekStart suspended deliveryDate dueDate
      items { entryId cycleWeek classId classLevel sectionId subject teacherId delivered asItemId asId }
    }
  }
`;

export interface AsPrepPromptT {
  entryId: string;
  weekNumber: number;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  deliveryDate: string;
  dueDate: string;
}

export const MY_AS_PREP_PROMPTS = gql<
  { myAssignmentPrepPrompts: AsPrepPromptT[] },
  { academicYearId: string }
>`
  query MyAssignmentPrepPrompts($academicYearId: String!) {
    myAssignmentPrepPrompts(academicYearId: $academicYearId) {
      entryId weekNumber classId classLevel sectionId subject deliveryDate dueDate
    }
  }
`;

export interface AsRosterEntryIn {
  studentId: string;
  present: boolean;
}

export const DELIVER_ASSIGNMENT = gql<
  { deliverAssignment: { itemId: string; asId: string; deliveryDate: string; dueDate: string; deliveredCount: number; absentCount: number } },
  { academicYearId: string; weekNumber: number; entryId: string; sectionId: string; roster: AsRosterEntryIn[]; setId?: string | null; totalMarks?: number | null }
>`
  mutation DeliverAssignment($academicYearId: String!, $weekNumber: Int!, $entryId: String!, $sectionId: String!, $roster: [AssignmentRosterEntryInput!]!, $setId: String, $totalMarks: Int) {
    deliverAssignment(academicYearId: $academicYearId, weekNumber: $weekNumber, entryId: $entryId, sectionId: $sectionId, roster: $roster, setId: $setId, totalMarks: $totalMarks) {
      itemId asId deliveryDate dueDate deliveredCount absentCount
    }
  }
`;

export interface AsItemT {
  id: string;
  asId: string;
  weekNumber: number;
  subject: string;
  classId: string;
  sectionId: string;
  deliveryDate: string;
  dueDate: string;
  totalMarks: number | null;
}

export const AS_ITEMS = gql<
  { assignmentItems: AsItemT[] },
  { sectionId: string; classId: string; weekNumber?: number | null }
>`
  query AssignmentItems($sectionId: String!, $classId: String!, $weekNumber: Int) {
    assignmentItems(sectionId: $sectionId, classId: $classId, weekNumber: $weekNumber) {
      id asId weekNumber subject classId sectionId deliveryDate dueDate totalMarks
    }
  }
`;

export interface AsRecordT {
  id: string;
  asId: string;
  studentId: string;
  state: string;
  dueDate: string | null;
  chaseCount: number;
  result: string | null;
  marks: number | null;
  feedback: string | null;
  resubOf: string | null;
}

export const AS_RECORDS = gql<
  { assignmentRecords: AsRecordT[] },
  { sectionId: string; classId: string; itemId: string }
>`
  query AssignmentRecords($sectionId: String!, $classId: String!, $itemId: String!) {
    assignmentRecords(sectionId: $sectionId, classId: $classId, itemId: $itemId) {
      id asId studentId state dueDate chaseCount result marks feedback resubOf
    }
  }
`;

export interface AsCollectionEntryIn {
  recordId: string;
  submitted: boolean;
}

export const COLLECT_ASSIGNMENT = gql<
  { collectAssignment: { itemId: string; asId: string; submittedCount: number; chaseCount: number; pendingCount: number } },
  { sectionId: string; itemId: string; entries: AsCollectionEntryIn[] }
>`
  mutation CollectAssignment($sectionId: String!, $itemId: String!, $entries: [AssignmentCollectionEntryInput!]!) {
    collectAssignment(sectionId: $sectionId, itemId: $itemId, entries: $entries) {
      itemId asId submittedCount chaseCount pendingCount
    }
  }
`;

export const REDELIVER_AS_RECORD = gql<
  { redeliverAssignmentRecord: { recordId: string; state: string; dueDate: string | null } },
  { sectionId: string; recordId: string }
>`
  mutation RedeliverAssignmentRecord($sectionId: String!, $recordId: String!) {
    redeliverAssignmentRecord(sectionId: $sectionId, recordId: $recordId) { recordId state dueDate }
  }
`;

export const TRANSITION_AS_RECORD = gql<
  { transitionAssignmentRecord: { recordId: string; state: string } },
  { sectionId: string; recordId: string; toState: string }
>`
  mutation TransitionAssignmentRecord($sectionId: String!, $recordId: String!, $toState: String!) {
    transitionAssignmentRecord(sectionId: $sectionId, recordId: $recordId, toState: $toState) { recordId state }
  }
`;

export const CHECK_AS_RECORD = gql<
  { checkAssignmentRecord: { recordId: string; state: string; result: string; marks: number | null } },
  { sectionId: string; recordId: string; result: string; marks?: number | null; feedback?: string | null }
>`
  mutation CheckAssignmentRecord($sectionId: String!, $recordId: String!, $result: String!, $marks: Int, $feedback: String) {
    checkAssignmentRecord(sectionId: $sectionId, recordId: $recordId, result: $result, marks: $marks, feedback: $feedback) {
      recordId state result marks
    }
  }
`;

export const ISSUE_AS_RESUBMISSION = gql<
  { issueAssignmentResubmission: { recordId: string; originalRecordId: string; state: string } },
  { sectionId: string; recordId: string }
>`
  mutation IssueAssignmentResubmission($sectionId: String!, $recordId: String!) {
    issueAssignmentResubmission(sectionId: $sectionId, recordId: $recordId) { recordId originalRecordId state }
  }
`;

export interface AsChaseEntryT {
  recordId: string;
  asId: string;
  subject: string;
  weekNumber: number;
  studentId: string;
  studentName: string;
  guardianPhone: string | null;
  dueDate: string | null;
  daysOverdue: number;
  chaseCount: number;
  followUpCount: number;
  nextStepNumber: number;
}

export const AS_CHASE_LIST = gql<{ assignmentChaseList: AsChaseEntryT[] }, NoVars>`
  query AssignmentChaseList {
    assignmentChaseList {
      recordId asId subject weekNumber studentId studentName guardianPhone
      dueDate daysOverdue chaseCount followUpCount nextStepNumber
    }
  }
`;

export interface AsEscalateResultT {
  followUpId: string;
  recordId: string;
  stepNumber: number;
  step: string;
  sentStatus: string;
  messageBn: string;
  waLink: string | null;
}

export const ESCALATE_AS_CHASE = gql<
  { escalateAssignmentChase: AsEscalateResultT },
  { recordId: string; skipInApp?: boolean | null; manualStep?: string | null }
>`
  mutation EscalateAssignmentChase($recordId: String!, $skipInApp: Boolean, $manualStep: String) {
    escalateAssignmentChase(recordId: $recordId, skipInApp: $skipInApp, manualStep: $manualStep) {
      followUpId recordId stepNumber step sentStatus messageBn waLink
    }
  }
`;

// ===========================================================================
// Library (LB-1..LB-4, D-#81–#84)
// ===========================================================================

export interface BookTitleRowT {
  id: string;
  titleBn: string;
  titleEn: string | null;
  author: string | null;
  language: string;
  category: string | null;
  shelf: string | null;
  active: boolean;
  totalCopies: number;
  availableCopies: number;
}

export interface BookCopyT {
  id: string;
  titleId: string;
  accessionNo: string;
  status: string;
  conditionNote: string | null;
}

export interface BookTitleDetailT extends BookTitleRowT {
  isbn: string | null;
  copies: BookCopyT[];
}

export interface BookLoanT {
  id: string;
  copyId: string;
  titleId: string;
  titleBn: string | null;
  accessionNo: string | null;
  borrowerType: string;
  borrowerId: string;
  borrowerName: string | null;
  issuedAt: string;
  dueDate: string;
  renewCount: number;
  status: string;
  returnedAt: string | null;
  lostNote: string | null;
  overdue: boolean;
}

export interface BookReservationT {
  id: string;
  titleId: string;
  titleBn: string | null;
  borrowerType: string;
  borrowerId: string;
  borrowerName: string | null;
  status: string;
  createdAt: string;
  readyAt: string | null;
  heldCopyId: string | null;
  heldAccessionNo: string | null;
  expiresAt: string | null;
}

export interface LibraryPolicyT {
  borrowerType: string;
  loanDays: number;
  maxConcurrent: number;
  maxRenewals: number;
  holdDays: number;
  isDefault: boolean;
}

export interface LibrarianAssignmentT {
  id: string;
  userId: string;
  userName: string | null;
  action: string;
  at: string;
}

const LOAN_FIELDS = `
  id copyId titleId titleBn accessionNo borrowerType borrowerId borrowerName
  issuedAt dueDate renewCount status returnedAt lostNote overdue
`;

const RESERVATION_FIELDS = `
  id titleId titleBn borrowerType borrowerId borrowerName status createdAt
  readyAt heldCopyId heldAccessionNo expiresAt
`;

/** Does the caller pass the desk gate (library:manage OR LibrarianAssignment)? */
export const AM_I_LIBRARIAN_QUERY = gql<{ amILibrarian: boolean }, NoVars>`
  query AmILibrarian {
    amILibrarian
  }
`;

export const BOOK_TITLES_QUERY = gql<
  { bookTitles: BookTitleRowT[] },
  { search?: string | null; language?: string | null; includeInactive?: boolean | null }
>`
  query BookTitles($search: String, $language: String, $includeInactive: Boolean) {
    bookTitles(search: $search, language: $language, includeInactive: $includeInactive) {
      id titleBn titleEn author language category shelf active totalCopies availableCopies
    }
  }
`;

export const BOOK_TITLE_QUERY = gql<
  { bookTitle: BookTitleDetailT | null },
  { titleId: string }
>`
  query BookTitle($titleId: String!) {
    bookTitle(titleId: $titleId) {
      id titleBn titleEn author language category isbn shelf active totalCopies availableCopies
      copies { id titleId accessionNo status conditionNote }
    }
  }
`;

export const LIBRARY_POLICIES_QUERY = gql<{ libraryPolicies: LibraryPolicyT[] }, NoVars>`
  query LibraryPolicies {
    libraryPolicies { borrowerType loanDays maxConcurrent maxRenewals holdDays isDefault }
  }
`;

export const LIBRARIAN_HISTORY_QUERY = gql<{ librarianHistory: LibrarianAssignmentT[] }, NoVars>`
  query LibrarianHistory {
    librarianHistory { id userId userName action at }
  }
`;

export const CURRENT_LIBRARIANS_QUERY = gql<{ currentLibrarians: LibrarianAssignmentT[] }, NoVars>`
  query CurrentLibrarians {
    currentLibrarians { id userId userName action at }
  }
`;

export const CREATE_BOOK_TITLE = gql<
  { createBookTitle: BookTitleRowT },
  {
    titleBn: string;
    titleEn?: string | null;
    author?: string | null;
    language: string;
    category?: string | null;
    isbn?: string | null;
    shelf?: string | null;
  }
>`
  mutation CreateBookTitle(
    $titleBn: String!
    $titleEn: String
    $author: String
    $language: String!
    $category: String
    $isbn: String
    $shelf: String
  ) {
    createBookTitle(
      titleBn: $titleBn
      titleEn: $titleEn
      author: $author
      language: $language
      category: $category
      isbn: $isbn
      shelf: $shelf
    ) {
      id titleBn titleEn author language category shelf active totalCopies availableCopies
    }
  }
`;

export const UPDATE_BOOK_TITLE = gql<
  { updateBookTitle: BookTitleRowT },
  { titleId: string; active?: boolean | null }
>`
  mutation UpdateBookTitle($titleId: String!, $active: Boolean) {
    updateBookTitle(titleId: $titleId, active: $active) {
      id titleBn titleEn author language category shelf active totalCopies availableCopies
    }
  }
`;

export const ADD_BOOK_COPY = gql<
  { addBookCopy: BookCopyT },
  { titleId: string; accessionNo: string; conditionNote?: string | null }
>`
  mutation AddBookCopy($titleId: String!, $accessionNo: String!, $conditionNote: String) {
    addBookCopy(titleId: $titleId, accessionNo: $accessionNo, conditionNote: $conditionNote) {
      id titleId accessionNo status conditionNote
    }
  }
`;

export const SET_COPY_STATUS = gql<
  { setCopyStatus: BookCopyT },
  { copyId: string; status: string; conditionNote?: string | null }
>`
  mutation SetCopyStatus($copyId: String!, $status: String!, $conditionNote: String) {
    setCopyStatus(copyId: $copyId, status: $status, conditionNote: $conditionNote) {
      id titleId accessionNo status conditionNote
    }
  }
`;

export const UPSERT_LIBRARY_POLICY = gql<
  { upsertLibraryPolicy: LibraryPolicyT },
  { borrowerType: string; loanDays: number; maxConcurrent: number; maxRenewals: number; holdDays: number }
>`
  mutation UpsertLibraryPolicy(
    $borrowerType: String!
    $loanDays: Int!
    $maxConcurrent: Int!
    $maxRenewals: Int!
    $holdDays: Int!
  ) {
    upsertLibraryPolicy(
      borrowerType: $borrowerType
      loanDays: $loanDays
      maxConcurrent: $maxConcurrent
      maxRenewals: $maxRenewals
      holdDays: $holdDays
    ) {
      borrowerType loanDays maxConcurrent maxRenewals holdDays isDefault
    }
  }
`;

export const ASSIGN_LIBRARIAN = gql<
  { assignLibrarian: LibrarianAssignmentT },
  { teacherUserId: string }
>`
  mutation AssignLibrarian($teacherUserId: String!) {
    assignLibrarian(teacherUserId: $teacherUserId) { id userId userName action at }
  }
`;

export const REVOKE_LIBRARIAN = gql<
  { revokeLibrarian: LibrarianAssignmentT },
  { teacherUserId: string }
>`
  mutation RevokeLibrarian($teacherUserId: String!) {
    revokeLibrarian(teacherUserId: $teacherUserId) { id userId userName action at }
  }
`;

export interface LibraryBorrowerHitT {
  id: string;
  name: string;
  detail: string | null;
}

export const LIBRARY_BORROWER_SEARCH = gql<
  { libraryBorrowerSearch: LibraryBorrowerHitT[] },
  { borrowerType: string; search: string }
>`
  query LibraryBorrowerSearch($borrowerType: String!, $search: String!) {
    libraryBorrowerSearch(borrowerType: $borrowerType, search: $search) { id name detail }
  }
`;

export const ISSUE_BOOK = gql<
  { issueBook: BookLoanT },
  { accessionNo: string; borrowerType: string; borrowerId: string }
>`
  mutation IssueBook($accessionNo: String!, $borrowerType: String!, $borrowerId: String!) {
    issueBook(accessionNo: $accessionNo, borrowerType: $borrowerType, borrowerId: $borrowerId) {
      ${LOAN_FIELDS}
    }
  }
`;

export const RETURN_BOOK = gql<{ returnBook: BookLoanT }, { loanId: string }>`
  mutation ReturnBook($loanId: String!) {
    returnBook(loanId: $loanId) { ${LOAN_FIELDS} }
  }
`;

export const RENEW_LOAN = gql<{ renewLoan: BookLoanT }, { loanId: string }>`
  mutation RenewLoan($loanId: String!) {
    renewLoan(loanId: $loanId) { ${LOAN_FIELDS} }
  }
`;

export const MARK_BOOK_LOST = gql<
  { markBookLost: BookLoanT },
  { loanId: string; note: string }
>`
  mutation MarkBookLost($loanId: String!, $note: String!) {
    markBookLost(loanId: $loanId, note: $note) { ${LOAN_FIELDS} }
  }
`;

export const LOANS_QUERY = gql<
  { loans: BookLoanT[] },
  { status?: string | null; borrowerType?: string | null; overdueOnly?: boolean | null }
>`
  query Loans($status: String, $borrowerType: String, $overdueOnly: Boolean) {
    loans(status: $status, borrowerType: $borrowerType, overdueOnly: $overdueOnly) {
      ${LOAN_FIELDS}
    }
  }
`;

export const BORROWER_LOANS_QUERY = gql<
  { borrowerLoans: BookLoanT[] },
  { borrowerType: string; borrowerId: string }
>`
  query BorrowerLoans($borrowerType: String!, $borrowerId: String!) {
    borrowerLoans(borrowerType: $borrowerType, borrowerId: $borrowerId) { ${LOAN_FIELDS} }
  }
`;

export const MY_LOANS_QUERY = gql<{ myLoans: BookLoanT[] }, NoVars>`
  query MyLoans {
    myLoans { ${LOAN_FIELDS} }
  }
`;

export const RESERVE_TITLE = gql<
  { reserveTitle: BookReservationT },
  { titleId: string; borrowerType?: string | null; borrowerId?: string | null }
>`
  mutation ReserveTitle($titleId: String!, $borrowerType: String, $borrowerId: String) {
    reserveTitle(titleId: $titleId, borrowerType: $borrowerType, borrowerId: $borrowerId) {
      ${RESERVATION_FIELDS}
    }
  }
`;

export const CANCEL_RESERVATION = gql<
  { cancelReservation: BookReservationT },
  { reservationId: string }
>`
  mutation CancelReservation($reservationId: String!) {
    cancelReservation(reservationId: $reservationId) { ${RESERVATION_FIELDS} }
  }
`;

export const RESERVATIONS_FOR_TITLE_QUERY = gql<
  { reservationsForTitle: BookReservationT[] },
  { titleId: string }
>`
  query ReservationsForTitle($titleId: String!) {
    reservationsForTitle(titleId: $titleId) { ${RESERVATION_FIELDS} }
  }
`;

export const MY_RESERVATIONS_QUERY = gql<{ myReservations: BookReservationT[] }, NoVars>`
  query MyReservations {
    myReservations { ${RESERVATION_FIELDS} }
  }
`;

export const BORROWER_RESERVATIONS_QUERY = gql<
  { borrowerReservations: BookReservationT[] },
  { borrowerType: string; borrowerId: string }
>`
  query BorrowerReservations($borrowerType: String!, $borrowerId: String!) {
    borrowerReservations(borrowerType: $borrowerType, borrowerId: $borrowerId) {
      ${RESERVATION_FIELDS}
    }
  }
`;

// --- LB-5: overdue chase list (librarian) + guardian child-loans rider --------

export interface LibraryChaseRowT {
  loanId: string;
  borrowerType: string;
  borrowerId: string;
  borrowerName: string | null;
  phone: string | null;
  titleBn: string | null;
  accessionNo: string | null;
  dueDate: string;
  daysOverdue: number;
  waLink: string | null;
}

export const LIBRARY_CHASE_LIST_QUERY = gql<{ libraryChaseList: LibraryChaseRowT[] }, NoVars>`
  query LibraryChaseList {
    libraryChaseList {
      loanId borrowerType borrowerId borrowerName phone titleBn accessionNo dueDate daysOverdue waLink
    }
  }
`;

export interface AsFollowUpT {
  id: string;
  stepNumber: number;
  step: string;
  messageBn: string;
  waLink: string | null;
  sentStatus: string;
  outcome: string | null;
  followUpDate: string;
}

export const AS_FOLLOWUPS = gql<{ assignmentFollowUps: AsFollowUpT[] }, { recordId: string }>`
  query AssignmentFollowUps($recordId: String!) {
    assignmentFollowUps(recordId: $recordId) {
      id stepNumber step messageBn waLink sentStatus outcome followUpDate
    }
  }
`;

export const RECORD_AS_FOLLOWUP_OUTCOME = gql<
  { recordAssignmentFollowUpOutcome: AsFollowUpT },
  { followUpId: string; sentStatus: string; outcome?: string | null }
>`
  mutation RecordAssignmentFollowUpOutcome($followUpId: String!, $sentStatus: String!, $outcome: String) {
    recordAssignmentFollowUpOutcome(followUpId: $followUpId, sentStatus: $sentStatus, outcome: $outcome) {
      id stepNumber step messageBn waLink sentStatus outcome followUpDate
    }
  }
`;

export interface AsRateRowT {
  key: string;
  scheduled: number;
  delivered: number;
  deliveryRatePct: number | null;
}

export interface AsSummaryT {
  academicYearId: string;
  weekFrom: number;
  weekTo: number;
  scheduledTotal: number;
  deliveredTotal: number;
  suspendedWeeks: number[];
  byTeacher: AsRateRowT[];
  byClass: AsRateRowT[];
  byWeek: AsRateRowT[];
  submissionRatePct: number | null;
  chaseVolume: number;
  attentionStudentIds: string[];
  commsPromptStudentIds: string[];
  openResubmissions: number;
  avgCheckingLatencyDays: number | null;
}

export const AS_SUMMARY = gql<
  { assignmentSummary: AsSummaryT },
  { academicYearId: string; weekFrom?: number | null; weekTo?: number | null }
>`
  query AssignmentSummary($academicYearId: String!, $weekFrom: Int, $weekTo: Int) {
    assignmentSummary(academicYearId: $academicYearId, weekFrom: $weekFrom, weekTo: $weekTo) {
      academicYearId weekFrom weekTo scheduledTotal deliveredTotal suspendedWeeks
      byTeacher { key scheduled delivered deliveryRatePct }
      byClass { key scheduled delivered deliveryRatePct }
      byWeek { key scheduled delivered deliveryRatePct }
      submissionRatePct chaseVolume attentionStudentIds commsPromptStudentIds
      openResubmissions avgCheckingLatencyDays
    }
  }
`;

export interface ChildAssignmentT {
  recordId: string;
  asId: string;
  subject: string;
  weekNumber: number;
  state: string;
  pending: boolean;
  daysLate: number;
  deliveryDate: string;
  dueDate: string | null;
  marks: number | null;
  totalMarks: number | null;
  result: string | null;
  feedback: string | null;
  isResubmission: boolean;
}

export const CHILD_ASSIGNMENTS = gql<{ childAssignments: ChildAssignmentT[] }, { studentId: string }>`
  query ChildAssignments($studentId: String!) {
    childAssignments(studentId: $studentId) {
      recordId asId subject weekNumber state pending daysLate deliveryDate dueDate
      marks totalMarks result feedback isResubmission
    }
  }
`;

export interface ChildLibraryLoanT {
  id: string;
  titleBn: string | null;
  accessionNo: string | null;
  issuedAt: string;
  dueDate: string;
  status: string;
  returnedAt: string | null;
  overdue: boolean;
}

export const CHILD_LIBRARY_LOANS_QUERY = gql<
  { childLibraryLoans: ChildLibraryLoanT[] },
  { studentId: string }
>`
  query ChildLibraryLoans($studentId: String!) {
    childLibraryLoans(studentId: $studentId) {
      id titleBn accessionNo issuedAt dueDate status returnedAt overdue
    }
  }
`;

// ===========================================================================
// Notifications (N-3/N-4, D-#72–#75) — the own-row inbox + device tokens
// ===========================================================================

export interface NotificationRefsT {
  classNoteId: string | null;
  slotId: string | null;
  date: string | null;
  groupType: string | null;
  groupId: string | null;
  hwItemId: string | null;
  studentId: string | null;
  sectionId: string | null;
  reviewAssignmentId: string | null;
  artifactId: string | null;
  substitutionId: string | null;
  loanId: string | null;
  rung: number | null;
  audienceKey: string | null;
  periodNumber: number | null;
  tier: string | null;
  hour: number | null;
}

export interface NotificationT {
  id: string;
  kind: string;
  titleBn: string;
  bodyBn: string;
  refs: NotificationRefsT;
  readAt: string | null;
  createdAt: string;
}

const NOTIFICATION_FIELDS = `
  id kind titleBn bodyBn readAt createdAt
  refs {
    classNoteId slotId date groupType groupId hwItemId studentId sectionId
    reviewAssignmentId artifactId substitutionId loanId rung
    audienceKey periodNumber tier hour
  }
`;

export const MY_NOTIFICATIONS_QUERY = gql<
  { myNotifications: NotificationT[] },
  { unreadOnly?: boolean | null; limit?: number | null }
>`
  query MyNotifications($unreadOnly: Boolean, $limit: Int) {
    myNotifications(unreadOnly: $unreadOnly, limit: $limit) {
      ${NOTIFICATION_FIELDS}
    }
  }
`;

export const MY_UNREAD_NOTIFICATION_COUNT = gql<
  { myUnreadNotificationCount: number },
  NoVars
>`
  query MyUnreadNotificationCount {
    myUnreadNotificationCount
  }
`;

export const MARK_NOTIFICATION_READ = gql<
  { markNotificationRead: { id: string; readAt: string | null } },
  { id: string }
>`
  mutation MarkNotificationRead($id: String!) {
    markNotificationRead(id: $id) {
      id readAt
    }
  }
`;

export const MARK_ALL_NOTIFICATIONS_READ = gql<
  { markAllNotificationsRead: number },
  NoVars
>`
  mutation MarkAllNotificationsRead {
    markAllNotificationsRead
  }
`;

// N-4 (D-#75): deactivate this device's token at logout (own-row).
export const UNREGISTER_PUSH_DEVICE = gql<
  { unregisterPushDevice: boolean },
  { token: string }
>`
  mutation UnregisterPushDevice($token: String!) {
    unregisterPushDevice(token: $token)
  }
`;

// ===========================================================================
// Messaging M-5 (prd-messaging §5; consumes the M-1..M-4 server APIs as-is)
// ===========================================================================

export interface ChatMemberT {
  userId: string;
  name: string;
  source: string;
  muted: boolean; // M-7: the caller reads its OWN row's mute state
  joinedAt: string;
}
export interface ConversationT {
  id: string;
  kind: string; // DIRECT | SECTION | SUBJECT | SCHOOL | CUSTOM
  refId: string | null;
  title: string | null;
  postingPolicy: string; // OPEN | ANNOUNCEMENT
  active: boolean;
  lastMessageAt: string | null;
  members: ChatMemberT[];
  createdAt: string;
}
export interface SeenByT {
  userId: string;
  seenAt: string;
}
export interface ReactionT {
  userId: string;
  emoji: string;
}
export interface ChatAttachmentT {
  fileId: string;
  kind: string; // IMAGE | PDF | VIDEO | AUDIO
  mime: string;
  sizeBytes: number;
  originalName: string;
}
export interface ChatMessageT {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  replyToId: string | null;
  forwardOfId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  seenBy: SeenByT[];
  seenCount: number;
  reactions: ReactionT[];
  attachments: ChatAttachmentT[];
  createdAt: string;
}

const CONVERSATION_FIELDS = `
  id
  kind
  refId
  title
  postingPolicy
  active
  lastMessageAt
  createdAt
  members { userId name source muted joinedAt }
`;

const MESSAGE_FIELDS = `
  id
  conversationId
  senderId
  body
  replyToId
  forwardOfId
  editedAt
  deletedAt
  seenCount
  seenBy { userId seenAt }
  reactions { userId emoji }
  attachments { fileId kind mime sizeBytes originalName }
  createdAt
`;

export const MY_CONVERSATIONS_QUERY = gql<{ myConversations: ConversationT[] }, NoVars>`
  query MyConversations {
    myConversations { ${CONVERSATION_FIELDS} }
  }
`;

export const CONVERSATION_QUERY = gql<{ conversation: ConversationT | null }, { id: string }>`
  query Conversation($id: String!) {
    conversation(id: $id) { ${CONVERSATION_FIELDS} }
  }
`;

export const MESSAGES_QUERY = gql<
  { messages: ChatMessageT[] },
  { conversationId: string; beforeId?: string | null; limit?: number | null }
>`
  query Messages($conversationId: String!, $beforeId: String, $limit: Int) {
    messages(conversationId: $conversationId, beforeId: $beforeId, limit: $limit) { ${MESSAGE_FIELDS} }
  }
`;

export const OPEN_DIRECT_CONVERSATION = gql<
  { openDirectConversation: ConversationT },
  { otherUserId: string }
>`
  mutation OpenDirect($otherUserId: String!) {
    openDirectConversation(otherUserId: $otherUserId) { ${CONVERSATION_FIELDS} }
  }
`;

export const SEND_MESSAGE = gql<
  { sendMessage: ChatMessageT },
  { conversationId: string; body?: string | null; replyToId?: string | null; attachmentIds?: string[] | null }
>`
  mutation SendMessage($conversationId: String!, $body: String, $replyToId: String, $attachmentIds: [String!]) {
    sendMessage(conversationId: $conversationId, body: $body, replyToId: $replyToId, attachmentIds: $attachmentIds) { ${MESSAGE_FIELDS} }
  }
`;

export const MARK_SEEN = gql<{ markSeen: number }, { conversationId: string }>`
  mutation MarkSeen($conversationId: String!) {
    markSeen(conversationId: $conversationId)
  }
`;

export const FORWARD_MESSAGE = gql<
  { forwardMessage: ChatMessageT },
  { messageId: string; toConversationId: string }
>`
  mutation ForwardMessage($messageId: String!, $toConversationId: String!) {
    forwardMessage(messageId: $messageId, toConversationId: $toConversationId) { ${MESSAGE_FIELDS} }
  }
`;

export const EDIT_MESSAGE = gql<{ editMessage: ChatMessageT }, { messageId: string; body: string }>`
  mutation EditMessage($messageId: String!, $body: String!) {
    editMessage(messageId: $messageId, body: $body) { ${MESSAGE_FIELDS} }
  }
`;

export const DELETE_MESSAGE = gql<{ deleteMessage: ChatMessageT }, { messageId: string }>`
  mutation DeleteMessage($messageId: String!) {
    deleteMessage(messageId: $messageId) { ${MESSAGE_FIELDS} }
  }
`;

export const TOGGLE_REACTION = gql<
  { toggleReaction: ChatMessageT },
  { messageId: string; emoji: string }
>`
  mutation ToggleReaction($messageId: String!, $emoji: String!) {
    toggleReaction(messageId: $messageId, emoji: $emoji) { ${MESSAGE_FIELDS} }
  }
`;

export const CREATE_GROUP_CONVERSATION = gql<
  { createGroupConversation: ConversationT },
  { title: string; memberIds?: string[] | null; postingPolicy?: string | null }
>`
  mutation CreateGroup($title: String!, $memberIds: [String!], $postingPolicy: String) {
    createGroupConversation(title: $title, memberIds: $memberIds, postingPolicy: $postingPolicy) { ${CONVERSATION_FIELDS} }
  }
`;

export const ADD_CONVERSATION_MEMBER = gql<
  { addConversationMember: boolean },
  { conversationId: string; userId: string }
>`
  mutation AddMember($conversationId: String!, $userId: String!) {
    addConversationMember(conversationId: $conversationId, userId: $userId)
  }
`;

export const REMOVE_CONVERSATION_MEMBER = gql<
  { removeConversationMember: boolean },
  { conversationId: string; userId: string }
>`
  mutation RemoveMember($conversationId: String!, $userId: String!) {
    removeConversationMember(conversationId: $conversationId, userId: $userId)
  }
`;

export const ARCHIVE_CONVERSATION = gql<
  { archiveConversation: ConversationT },
  { conversationId: string }
>`
  mutation ArchiveConversation($conversationId: String!) {
    archiveConversation(conversationId: $conversationId) { ${CONVERSATION_FIELDS} }
  }
`;

export const SET_POSTING_POLICY = gql<
  { setPostingPolicy: ConversationT },
  { conversationId: string; policy: string }
>`
  mutation SetPostingPolicy($conversationId: String!, $policy: String!) {
    setPostingPolicy(conversationId: $conversationId, policy: $policy) { ${CONVERSATION_FIELDS} }
  }
`;

// ===========================================================================
// Messaging M-6 + M-7 app pass (prd-messaging §5/§6) — consumes the EXISTING
// M-6/M-7 server resolvers as-is; no server/vocab change.
// ===========================================================================

// --- M-7: per-user mute toggle (own-row; the `muted` field rides the member
//     selection in CONVERSATION_FIELDS above). ------------------------------
export const SET_CONVERSATION_MUTED = gql<
  { setConversationMuted: boolean },
  { conversationId: string; muted: boolean }
>`
  mutation SetConversationMuted($conversationId: String!, $muted: Boolean!) {
    setConversationMuted(conversationId: $conversationId, muted: $muted)
  }
`;

// --- M-6: Principal oversight (chat:oversee) — read-only over ANY conversation;
//     the OPEN mutation is the audited entry (CHAT_OVERSIGHT_OPENED), so it is
//     called when a thread is opened, not just read. oversightMessages returns
//     deleted originals UN-masked (server renders them normally). --------------
export const OVERSIGHT_CONVERSATIONS_QUERY = gql<
  { oversightConversations: ConversationT[] },
  NoVars
>`
  query OversightConversations {
    oversightConversations { ${CONVERSATION_FIELDS} }
  }
`;

export const OPEN_CONVERSATION_OVERSIGHT = gql<
  { openConversationOversight: ConversationT },
  { conversationId: string }
>`
  mutation OpenConversationOversight($conversationId: String!) {
    openConversationOversight(conversationId: $conversationId) { ${CONVERSATION_FIELDS} }
  }
`;

export const OVERSIGHT_MESSAGES_QUERY = gql<
  { oversightMessages: ChatMessageT[] },
  { conversationId: string; beforeId?: string | null; limit?: number | null }
>`
  query OversightMessages($conversationId: String!, $beforeId: String, $limit: Int) {
    oversightMessages(conversationId: $conversationId, beforeId: $beforeId, limit: $limit) { ${MESSAGE_FIELDS} }
  }
`;

// --- M-6: guardian-notice composer (chat:write + per-scope server check) —
//     produces one ADR-003 wa.me link per reachable guardian + the reach counts.
export interface GuardianNoticeRecipientT {
  studentId: string;
  studentName: string;
  phone: string;
  waLink: string;
}
export interface GuardianNoticeResultT {
  noticeId: string;
  scope: string;
  title: string;
  body: string;
  recipientCount: number;
  unreachableCount: number;
  recipients: GuardianNoticeRecipientT[];
}

export const COMPOSE_GUARDIAN_NOTICE = gql<
  { composeGuardianNotice: GuardianNoticeResultT },
  { scope: string; title: string; body: string; sectionId?: string | null }
>`
  mutation ComposeGuardianNotice($scope: String!, $title: String!, $body: String!, $sectionId: String) {
    composeGuardianNotice(scope: $scope, title: $title, body: $body, sectionId: $sectionId) {
      noticeId
      scope
      title
      body
      recipientCount
      unreachableCount
      recipients { studentId studentName phone waLink }
    }
  }
`;

// ===========================================================================
// HR app surfaces — Leave + staff self-service (PR-1; prd-hr §3/§5, H2/H5)
// All consume EXISTING resolvers (server/src/modules/hr/**); APP-ONLY, no
// server/vocab change. Self-service my* queries need only authentication; the
// admin surfaces are gated leave:manage server-side and deny in-band.
// ===========================================================================

export interface StaffLeaveT {
  id: string;
  staffProfileId: string;
  leaveType: string;
  fromKey: string;
  toKey: string;
  days: number;
  reason: string;
  status: string;
  paidDays: number | null;
  unpaidDays: number | null;
  exceedWarning: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

const STAFF_LEAVE_FIELDS = `
  id staffProfileId leaveType fromKey toKey days reason status
  paidDays unpaidDays exceedWarning decisionNote decidedAt createdAt
`;

export const MY_STAFF_LEAVE_QUERY = gql<{ myStaffLeave: StaffLeaveT[] }, NoVars>`
  query MyStaffLeave {
    myStaffLeave { ${STAFF_LEAVE_FIELDS} }
  }
`;

export interface StaffLeaveBalanceT {
  leaveType: string;
  paid: boolean;
  balanceTracked: boolean;
  allowanceDays: number;
  carriedOverDays: number;
  takenDays: number;
  remainingDays: number;
  encashableDays: number;
}

const STAFF_LEAVE_BALANCE_FIELDS = `
  leaveType paid balanceTracked allowanceDays carriedOverDays
  takenDays remainingDays encashableDays
`;

export const MY_STAFF_LEAVE_BALANCES_QUERY = gql<
  { myStaffLeaveBalances: StaffLeaveBalanceT[] },
  { academicYearId: string }
>`
  query MyStaffLeaveBalances($academicYearId: String!) {
    myStaffLeaveBalances(academicYearId: $academicYearId) { ${STAFF_LEAVE_BALANCE_FIELDS} }
  }
`;

export const APPLY_FOR_STAFF_LEAVE = gql<
  { applyForStaffLeave: StaffLeaveT },
  { leaveType: string; fromKey: string; toKey: string; reason: string; staffProfileId?: string | null }
>`
  mutation ApplyForStaffLeave($leaveType: String!, $fromKey: String!, $toKey: String!, $reason: String!, $staffProfileId: String) {
    applyForStaffLeave(leaveType: $leaveType, fromKey: $fromKey, toKey: $toKey, reason: $reason, staffProfileId: $staffProfileId) {
      ${STAFF_LEAVE_FIELDS}
    }
  }
`;

export const DECIDE_STAFF_LEAVE = gql<
  { decideStaffLeave: StaffLeaveT },
  { applicationId: string; decision: string; note?: string | null }
>`
  mutation DecideStaffLeave($applicationId: String!, $decision: String!, $note: String) {
    decideStaffLeave(applicationId: $applicationId, decision: $decision, note: $note) {
      ${STAFF_LEAVE_FIELDS}
    }
  }
`;

export interface StaffCoverSlotT {
  id: string;
  leaveApplicationId: string;
  classId: string;
  sectionId: string;
  subjectId: string | null;
  absentTeacherUserId: string | null;
  proposedCoverTeacherId: string | null;
  status: string;
  proxyGrantId: string | null;
}

const STAFF_COVER_SLOT_FIELDS = `
  id leaveApplicationId classId sectionId subjectId
  absentTeacherUserId proposedCoverTeacherId status proxyGrantId
`;

export const STAFF_COVER_SLOTS_QUERY = gql<
  { staffCoverSlots: StaffCoverSlotT[] },
  { leaveApplicationId: string }
>`
  query StaffCoverSlots($leaveApplicationId: String!) {
    staffCoverSlots(leaveApplicationId: $leaveApplicationId) { ${STAFF_COVER_SLOT_FIELDS} }
  }
`;

export const PROPOSE_STAFF_COVER = gql<
  { proposeStaffCover: StaffCoverSlotT },
  { slotId: string; coverTeacherUserId: string }
>`
  mutation ProposeStaffCover($slotId: String!, $coverTeacherUserId: String!) {
    proposeStaffCover(slotId: $slotId, coverTeacherUserId: $coverTeacherUserId) { ${STAFF_COVER_SLOT_FIELDS} }
  }
`;

export const DECIDE_STAFF_COVER_SLOT = gql<
  { decideStaffCoverSlot: StaffCoverSlotT },
  { slotId: string; approve: boolean }
>`
  mutation DecideStaffCoverSlot($slotId: String!, $approve: Boolean!) {
    decideStaffCoverSlot(slotId: $slotId, approve: $approve) { ${STAFF_COVER_SLOT_FIELDS} }
  }
`;

// --- Admin leave surface (leave:manage) --------------------------------------

export const STAFF_LEAVE_APPLICATIONS_QUERY = gql<
  { staffLeaveApplications: StaffLeaveT[] },
  { status?: string | null; fromKey?: string | null; toKey?: string | null }
>`
  query StaffLeaveApplications($status: String, $fromKey: String, $toKey: String) {
    staffLeaveApplications(status: $status, fromKey: $fromKey, toKey: $toKey) { ${STAFF_LEAVE_FIELDS} }
  }
`;

export const UPSERT_STAFF_LEAVE_ENTITLEMENT = gql<
  { upsertStaffLeaveEntitlement: StaffLeaveBalanceT },
  { staffProfileId: string; academicYearId: string; leaveType: string; allowanceDays: number; carriedOverDays?: number | null; note?: string | null }
>`
  mutation UpsertStaffLeaveEntitlement($staffProfileId: String!, $academicYearId: String!, $leaveType: String!, $allowanceDays: Int!, $carriedOverDays: Int, $note: String) {
    upsertStaffLeaveEntitlement(staffProfileId: $staffProfileId, academicYearId: $academicYearId, leaveType: $leaveType, allowanceDays: $allowanceDays, carriedOverDays: $carriedOverDays, note: $note) {
      ${STAFF_LEAVE_BALANCE_FIELDS}
    }
  }
`;

export const STAFF_LEAVE_BALANCES_QUERY = gql<
  { staffLeaveBalances: StaffLeaveBalanceT[] },
  { staffProfileId: string; academicYearId: string }
>`
  query StaffLeaveBalances($staffProfileId: String!, $academicYearId: String!) {
    staffLeaveBalances(staffProfileId: $staffProfileId, academicYearId: $academicYearId) { ${STAFF_LEAVE_BALANCE_FIELDS} }
  }
`;

// --- Own employment record (read-only self-view; prd-hr H5.5 own-row) --------

export interface ConductRecordT {
  id: string;
  staffProfileId: string;
  stage: string;
  status: string;
  grossMisconduct: boolean;
  issue: string;
  category: string | null;
  evidence: string | null;
  hearingNote: string | null;
  hearingHeldAt: string | null;
  liveUntil: string | null;
  outcome: string | null;
  finalizedAt: string | null;
  createdAt: string;
}

const CONDUCT_RECORD_FIELDS = `
  id staffProfileId stage status grossMisconduct issue category evidence
  hearingNote hearingHeldAt liveUntil outcome finalizedAt createdAt
`;

export const MY_CONDUCT_RECORDS_QUERY = gql<{ myConductRecords: ConductRecordT[] }, NoVars>`
  query MyConductRecords {
    myConductRecords { ${CONDUCT_RECORD_FIELDS} }
  }
`;

export interface AppraisalT {
  id: string;
  staffProfileId: string;
  academicYearId: string;
  status: string;
  goals: string[];
  developmentNeeds: string[];
  overallOutcome: string | null;
  outcomeNote: string | null;
  signedOffAt: string | null;
  createdAt: string;
}

const APPRAISAL_FIELDS = `
  id staffProfileId academicYearId status goals developmentNeeds
  overallOutcome outcomeNote signedOffAt createdAt
`;

export const MY_APPRAISALS_QUERY = gql<{ myAppraisals: AppraisalT[] }, NoVars>`
  query MyAppraisals {
    myAppraisals { ${APPRAISAL_FIELDS} }
  }
`;

export interface GrievanceT {
  id: string;
  raisedByStaffProfileId: string;
  subject: string;
  detail: string;
  status: string;
  resolutionNote: string | null;
  handledAt: string | null;
  createdAt: string;
}

const GRIEVANCE_FIELDS = `
  id raisedByStaffProfileId subject detail status resolutionNote handledAt createdAt
`;

export const MY_GRIEVANCES_QUERY = gql<{ myGrievances: GrievanceT[] }, NoVars>`
  query MyGrievances {
    myGrievances { ${GRIEVANCE_FIELDS} }
  }
`;

export const RAISE_GRIEVANCE = gql<
  { raiseGrievance: GrievanceT },
  { subject: string; detail: string }
>`
  mutation RaiseGrievance($subject: String!, $detail: String!) {
    raiseGrievance(subject: $subject, detail: $detail) { ${GRIEVANCE_FIELDS} }
  }
`;

export interface DevelopmentLogT {
  id: string;
  staffProfileId: string;
  activity: string;
  dateKey: string;
  outcome: string | null;
  sourceAppraisalId: string | null;
  createdAt: string;
}

const DEVELOPMENT_LOG_FIELDS = `
  id staffProfileId activity dateKey outcome sourceAppraisalId createdAt
`;

export const MY_DEVELOPMENT_LOG_QUERY = gql<{ myDevelopmentLog: DevelopmentLogT[] }, NoVars>`
  query MyDevelopmentLog {
    myDevelopmentLog { ${DEVELOPMENT_LOG_FIELDS} }
  }
`;

export interface ObservationT {
  id: string;
  staffProfileId: string;
  observerId: string;
  dateKey: string;
  classId: string | null;
  subjectId: string | null;
  notes: string;
  followUp: string | null;
  createdAt: string;
}

const OBSERVATION_FIELDS = `
  id staffProfileId observerId dateKey classId subjectId notes followUp createdAt
`;

export const MY_OBSERVATIONS_QUERY = gql<{ myObservations: ObservationT[] }, NoVars>`
  query MyObservations {
    myObservations { ${OBSERVATION_FIELDS} }
  }
`;

// ===========================================================================
// HR app surfaces — Payroll (PR-2; prd-hr §4, H4, D-#26/#27/#109/#110)
// payroll:manage prepares/reads; payroll:approve (PRINCIPAL only) locks +
// issues/settles advances. APP-ONLY; consumes existing resolvers.
// ===========================================================================

export interface StaffPayT {
  id: string;
  monthlySalary: number | null;
  paymentMethod: string | null;
}

export const SET_STAFF_PAY = gql<
  { setStaffPay: StaffPayT },
  { staffProfileId: string; monthlySalary?: number | null; paymentMethod?: string | null }
>`
  mutation SetStaffPay($staffProfileId: String!, $monthlySalary: Float, $paymentMethod: String) {
    setStaffPay(staffProfileId: $staffProfileId, monthlySalary: $monthlySalary, paymentMethod: $paymentMethod) {
      id monthlySalary paymentMethod
    }
  }
`;

export interface PayrollRunT {
  id: string;
  monthKey: string;
  status: string;
  workingDays: number;
  preparedAt: string;
  approvedAt: string | null;
  note: string | null;
}

const PAYROLL_RUN_FIELDS = `id monthKey status workingDays preparedAt approvedAt note`;

export const PAYROLL_RUNS_QUERY = gql<{ payrollRuns: PayrollRunT[] }, NoVars>`
  query PayrollRuns {
    payrollRuns { ${PAYROLL_RUN_FIELDS} }
  }
`;

export const PREPARE_PAYROLL_RUN = gql<
  { preparePayrollRun: PayrollRunT },
  { monthKey: string; workingDays: number; note?: string | null }
>`
  mutation PreparePayrollRun($monthKey: String!, $workingDays: Int!, $note: String) {
    preparePayrollRun(monthKey: $monthKey, workingDays: $workingDays, note: $note) { ${PAYROLL_RUN_FIELDS} }
  }
`;

export const APPROVE_PAYROLL_RUN = gql<{ approvePayrollRun: PayrollRunT }, { runId: string }>`
  mutation ApprovePayrollRun($runId: String!) {
    approvePayrollRun(runId: $runId) { ${PAYROLL_RUN_FIELDS} }
  }
`;

export const CANCEL_PAYROLL_RUN = gql<{ cancelPayrollRun: PayrollRunT }, { runId: string }>`
  mutation CancelPayrollRun($runId: String!) {
    cancelPayrollRun(runId: $runId) { ${PAYROLL_RUN_FIELDS} }
  }
`;

export interface PayLineT {
  type: string;
  amount: number;
  days: number | null;
  note: string | null;
}

export interface PayslipT {
  id: string;
  payrollRunId: string;
  staffProfileId: string;
  monthKey: string;
  snapshotName: string;
  category: string;
  paymentMethod: string | null;
  grossSalary: number;
  dayRate: number;
  unpaidLeaveDays: number;
  deductions: PayLineT[];
  additions: PayLineT[];
  totalDeductions: number;
  totalAdditions: number;
  netPay: number;
  advanceRepaid: number;
}

export const PAYSLIPS_FOR_RUN_QUERY = gql<{ payslipsForRun: PayslipT[] }, { runId: string }>`
  query PayslipsForRun($runId: String!) {
    payslipsForRun(runId: $runId) {
      id payrollRunId staffProfileId monthKey snapshotName category paymentMethod
      grossSalary dayRate unpaidLeaveDays
      deductions { type amount days note }
      additions { type amount days note }
      totalDeductions totalAdditions netPay advanceRepaid
    }
  }
`;

export interface PaymentExportRowT {
  staffProfileId: string;
  name: string;
  paymentMethod: string;
  account: string | null;
  netPay: number;
}

export const PAYROLL_PAYMENT_EXPORT_QUERY = gql<
  { payrollPaymentExport: PaymentExportRowT[] },
  { runId: string }
>`
  query PayrollPaymentExport($runId: String!) {
    payrollPaymentExport(runId: $runId) { staffProfileId name paymentMethod account netPay }
  }
`;

export interface AdvanceLoanT {
  id: string;
  staffProfileId: string;
  principal: number;
  balance: number;
  recoveryMode: string;
  installmentAmount: number | null;
  status: string;
  issueDate: string;
  note: string | null;
}

const ADVANCE_FIELDS = `id staffProfileId principal balance recoveryMode installmentAmount status issueDate note`;

export const STAFF_ADVANCES_QUERY = gql<{ staffAdvances: AdvanceLoanT[] }, { staffProfileId: string }>`
  query StaffAdvances($staffProfileId: String!) {
    staffAdvances(staffProfileId: $staffProfileId) { ${ADVANCE_FIELDS} }
  }
`;

export const ISSUE_STAFF_ADVANCE = gql<
  { issueStaffAdvance: AdvanceLoanT },
  { staffProfileId: string; principal: number; issueDate: string; recoveryMode: string; installmentAmount?: number | null; note?: string | null }
>`
  mutation IssueStaffAdvance($staffProfileId: String!, $principal: Float!, $issueDate: String!, $recoveryMode: String!, $installmentAmount: Float, $note: String) {
    issueStaffAdvance(staffProfileId: $staffProfileId, principal: $principal, issueDate: $issueDate, recoveryMode: $recoveryMode, installmentAmount: $installmentAmount, note: $note) {
      ${ADVANCE_FIELDS}
    }
  }
`;

export const SETTLE_STAFF_ADVANCE = gql<
  { settleStaffAdvance: AdvanceLoanT },
  { advanceId: string; writeOff?: boolean | null }
>`
  mutation SettleStaffAdvance($advanceId: String!, $writeOff: Boolean) {
    settleStaffAdvance(advanceId: $advanceId, writeOff: $writeOff) { ${ADVANCE_FIELDS} }
  }
`;

// ===========================================================================
// HR app surfaces — Performance / conduct / development (PR-3; prd-hr §5, H5)
// performance:manage (P/O) reads+manages all; performance:signoff (PRINCIPAL)
// signs off appraisals + finalizes conduct. Reuses the ObservationT/AppraisalT/
// ConductRecordT/GrievanceT/DevelopmentLogT types + field fragments from PR-1.
// APP-ONLY; consumes existing resolvers.
// ===========================================================================

// --- Observations ---
export const STAFF_OBSERVATIONS_QUERY = gql<{ staffObservations: ObservationT[] }, { staffProfileId: string }>`
  query StaffObservations($staffProfileId: String!) {
    staffObservations(staffProfileId: $staffProfileId) { ${OBSERVATION_FIELDS} }
  }
`;

export const SUBMIT_OBSERVATION = gql<
  { submitObservation: ObservationT },
  { staffProfileId: string; dateKey: string; notes: string; classId?: string | null; subjectId?: string | null; followUp?: string | null }
>`
  mutation SubmitObservation($staffProfileId: String!, $dateKey: String!, $notes: String!, $classId: String, $subjectId: String, $followUp: String) {
    submitObservation(staffProfileId: $staffProfileId, dateKey: $dateKey, notes: $notes, classId: $classId, subjectId: $subjectId, followUp: $followUp) {
      ${OBSERVATION_FIELDS}
    }
  }
`;

// --- Appraisals ---
export const STAFF_APPRAISALS_QUERY = gql<{ staffAppraisals: AppraisalT[] }, { staffProfileId: string }>`
  query StaffAppraisals($staffProfileId: String!) {
    staffAppraisals(staffProfileId: $staffProfileId) { ${APPRAISAL_FIELDS} }
  }
`;

export const UPSERT_APPRAISAL = gql<
  { upsertAppraisal: AppraisalT },
  { staffProfileId: string; academicYearId: string; goals?: string[] | null; developmentNeeds?: string[] | null }
>`
  mutation UpsertAppraisal($staffProfileId: String!, $academicYearId: String!, $goals: [String!], $developmentNeeds: [String!]) {
    upsertAppraisal(staffProfileId: $staffProfileId, academicYearId: $academicYearId, goals: $goals, developmentNeeds: $developmentNeeds) {
      ${APPRAISAL_FIELDS}
    }
  }
`;

export const SIGN_OFF_APPRAISAL = gql<
  { signOffAppraisal: AppraisalT },
  { appraisalId: string; outcome: string; outcomeNote?: string | null }
>`
  mutation SignOffAppraisal($appraisalId: String!, $outcome: String!, $outcomeNote: String) {
    signOffAppraisal(appraisalId: $appraisalId, outcome: $outcome, outcomeNote: $outcomeNote) { ${APPRAISAL_FIELDS} }
  }
`;

// --- Conduct ladder ---
export const STAFF_CONDUCT_RECORDS_QUERY = gql<{ staffConductRecords: ConductRecordT[] }, { staffProfileId: string }>`
  query StaffConductRecords($staffProfileId: String!) {
    staffConductRecords(staffProfileId: $staffProfileId) { ${CONDUCT_RECORD_FIELDS} }
  }
`;

export const RECORD_CONDUCT_STEP = gql<
  { recordConductStep: ConductRecordT },
  { staffProfileId: string; stage: string; issue: string; category?: string | null; evidence?: string | null; grossMisconduct?: boolean | null }
>`
  mutation RecordConductStep($staffProfileId: String!, $stage: String!, $issue: String!, $category: String, $evidence: String, $grossMisconduct: Boolean) {
    recordConductStep(staffProfileId: $staffProfileId, stage: $stage, issue: $issue, category: $category, evidence: $evidence, grossMisconduct: $grossMisconduct) {
      ${CONDUCT_RECORD_FIELDS}
    }
  }
`;

export const RECORD_CONDUCT_HEARING = gql<
  { recordConductHearing: ConductRecordT },
  { recordId: string; hearingNote: string }
>`
  mutation RecordConductHearing($recordId: String!, $hearingNote: String!) {
    recordConductHearing(recordId: $recordId, hearingNote: $hearingNote) { ${CONDUCT_RECORD_FIELDS} }
  }
`;

export const FINALIZE_CONDUCT_STEP = gql<
  { finalizeConductStep: ConductRecordT },
  { recordId: string; liveUntilKey?: string | null; outcome?: string | null }
>`
  mutation FinalizeConductStep($recordId: String!, $liveUntilKey: String, $outcome: String) {
    finalizeConductStep(recordId: $recordId, liveUntilKey: $liveUntilKey, outcome: $outcome) { ${CONDUCT_RECORD_FIELDS} }
  }
`;

// --- Grievances (admin inbox) ---
export const GRIEVANCES_QUERY = gql<{ grievances: GrievanceT[] }, { status?: string | null }>`
  query Grievances($status: String) {
    grievances(status: $status) { ${GRIEVANCE_FIELDS} }
  }
`;

export const UPDATE_GRIEVANCE = gql<
  { updateGrievance: GrievanceT },
  { grievanceId: string; status: string; resolutionNote?: string | null }
>`
  mutation UpdateGrievance($grievanceId: String!, $status: String!, $resolutionNote: String) {
    updateGrievance(grievanceId: $grievanceId, status: $status, resolutionNote: $resolutionNote) { ${GRIEVANCE_FIELDS} }
  }
`;

// --- Development (CPD) ---
export const STAFF_DEVELOPMENT_LOG_QUERY = gql<{ staffDevelopmentLog: DevelopmentLogT[] }, { staffProfileId: string }>`
  query StaffDevelopmentLog($staffProfileId: String!) {
    staffDevelopmentLog(staffProfileId: $staffProfileId) { ${DEVELOPMENT_LOG_FIELDS} }
  }
`;

export const ADD_DEVELOPMENT_LOG = gql<
  { addDevelopmentLog: DevelopmentLogT },
  { staffProfileId: string; activity: string; dateKey?: string | null; outcome?: string | null }
>`
  mutation AddDevelopmentLog($staffProfileId: String!, $activity: String!, $dateKey: String, $outcome: String) {
    addDevelopmentLog(staffProfileId: $staffProfileId, activity: $activity, dateKey: $dateKey, outcome: $outcome) { ${DEVELOPMENT_LOG_FIELDS} }
  }
`;

// ===========================================================================
// HR app surfaces — Offboarding (PR-4; prd-hr §6, H6, D-#29/#117)
// staff:manage = initiate / clearance / access revoke / exit interview / cert /
// cancel; payroll:manage = compute settlement; payroll:approve (PRINCIPAL) =
// release. APP-ONLY; consumes existing resolvers.
// ===========================================================================

export interface ClearanceItemT {
  key: string;
  label: string;
  status: string;
  note: string | null;
  updatedAt: string | null;
}

export interface SettlementLineT {
  type: string;
  amount: number;
  days: number | null;
  note: string | null;
}

export interface FinalSettlementT {
  workingDays: number;
  payableDays: number | null;
  dayRate: number;
  grossSalary: number;
  leaveEncashmentDays: number;
  deductions: SettlementLineT[];
  additions: SettlementLineT[];
  totalDeductions: number;
  totalAdditions: number;
  netPay: number;
  advanceRecovered: number;
  held: boolean;
  computedAt: string;
  releasedAt: string | null;
}

export interface OffboardingCaseT {
  id: string;
  staffProfileId: string;
  trigger: string;
  status: string;
  noticeDateKey: string | null;
  lastWorkingDayKey: string;
  clearanceItems: ClearanceItemT[];
  accessRevoked: boolean;
  accessRevokedAt: string | null;
  grantsRevokedCount: number | null;
  loginDisabled: boolean | null;
  settlement: FinalSettlementT | null;
  exitInterviewReason: string | null;
  exitInterviewFeedback: string | null;
  serviceCertificateIssuedAt: string | null;
  createdAt: string;
}

const OFFBOARDING_CASE_FIELDS = `
  id staffProfileId trigger status noticeDateKey lastWorkingDayKey
  clearanceItems { key label status note updatedAt }
  accessRevoked accessRevokedAt grantsRevokedCount loginDisabled
  settlement {
    workingDays payableDays dayRate grossSalary leaveEncashmentDays
    deductions { type amount days note }
    additions { type amount days note }
    totalDeductions totalAdditions netPay advanceRecovered held computedAt releasedAt
  }
  exitInterviewReason exitInterviewFeedback serviceCertificateIssuedAt createdAt
`;

export const OFFBOARDING_CASES_QUERY = gql<{ offboardingCases: OffboardingCaseT[] }, { status?: string | null }>`
  query OffboardingCases($status: String) {
    offboardingCases(status: $status) { ${OFFBOARDING_CASE_FIELDS} }
  }
`;

export const OFFBOARDING_CASE_QUERY = gql<{ offboardingCase: OffboardingCaseT | null }, { caseId: string }>`
  query OffboardingCase($caseId: String!) {
    offboardingCase(caseId: $caseId) { ${OFFBOARDING_CASE_FIELDS} }
  }
`;

export const INITIATE_OFFBOARDING = gql<
  { initiateOffboarding: OffboardingCaseT },
  { staffProfileId: string; trigger: string; lastWorkingDayKey: string; noticeDateKey?: string | null }
>`
  mutation InitiateOffboarding($staffProfileId: String!, $trigger: String!, $lastWorkingDayKey: String!, $noticeDateKey: String) {
    initiateOffboarding(staffProfileId: $staffProfileId, trigger: $trigger, lastWorkingDayKey: $lastWorkingDayKey, noticeDateKey: $noticeDateKey) {
      ${OFFBOARDING_CASE_FIELDS}
    }
  }
`;

export const ADD_OFFBOARDING_CLEARANCE_ITEM = gql<
  { addOffboardingClearanceItem: OffboardingCaseT },
  { caseId: string; key: string; label: string }
>`
  mutation AddOffboardingClearanceItem($caseId: String!, $key: String!, $label: String!) {
    addOffboardingClearanceItem(caseId: $caseId, key: $key, label: $label) { ${OFFBOARDING_CASE_FIELDS} }
  }
`;

export const UPDATE_OFFBOARDING_CLEARANCE_ITEM = gql<
  { updateOffboardingClearanceItem: OffboardingCaseT },
  { caseId: string; key: string; status: string; note?: string | null }
>`
  mutation UpdateOffboardingClearanceItem($caseId: String!, $key: String!, $status: String!, $note: String) {
    updateOffboardingClearanceItem(caseId: $caseId, key: $key, status: $status, note: $note) { ${OFFBOARDING_CASE_FIELDS} }
  }
`;

export const REVOKE_OFFBOARDING_ACCESS = gql<{ revokeOffboardingAccess: OffboardingCaseT }, { caseId: string }>`
  mutation RevokeOffboardingAccess($caseId: String!) {
    revokeOffboardingAccess(caseId: $caseId) { ${OFFBOARDING_CASE_FIELDS} }
  }
`;

export const COMPUTE_FINAL_SETTLEMENT = gql<
  { computeFinalSettlement: OffboardingCaseT },
  { caseId: string; workingDays: number; academicYearId?: string | null; payableDays?: number | null; arrearsAmount?: number | null; arrearsNote?: string | null }
>`
  mutation ComputeFinalSettlement($caseId: String!, $workingDays: Int!, $academicYearId: String, $payableDays: Int, $arrearsAmount: Int, $arrearsNote: String) {
    computeFinalSettlement(caseId: $caseId, workingDays: $workingDays, academicYearId: $academicYearId, payableDays: $payableDays, arrearsAmount: $arrearsAmount, arrearsNote: $arrearsNote) {
      ${OFFBOARDING_CASE_FIELDS}
    }
  }
`;

export const RELEASE_FINAL_SETTLEMENT = gql<{ releaseFinalSettlement: OffboardingCaseT }, { caseId: string }>`
  mutation ReleaseFinalSettlement($caseId: String!) {
    releaseFinalSettlement(caseId: $caseId) { ${OFFBOARDING_CASE_FIELDS} }
  }
`;

export const RECORD_EXIT_INTERVIEW = gql<
  { recordExitInterview: OffboardingCaseT },
  { caseId: string; reason?: string | null; feedback?: string | null }
>`
  mutation RecordExitInterview($caseId: String!, $reason: String, $feedback: String) {
    recordExitInterview(caseId: $caseId, reason: $reason, feedback: $feedback) { ${OFFBOARDING_CASE_FIELDS} }
  }
`;

export const ISSUE_SERVICE_CERTIFICATE = gql<{ issueServiceCertificate: OffboardingCaseT }, { caseId: string }>`
  mutation IssueServiceCertificate($caseId: String!) {
    issueServiceCertificate(caseId: $caseId) { ${OFFBOARDING_CASE_FIELDS} }
  }
`;

export const CANCEL_OFFBOARDING = gql<{ cancelOffboarding: OffboardingCaseT }, { caseId: string }>`
  mutation CancelOffboarding($caseId: String!) {
    cancelOffboarding(caseId: $caseId) { ${OFFBOARDING_CASE_FIELDS} }
  }
`;

// ===========================================================================
// Message templates (MT-1..MT-3, D-#128–#131) — Principal-only (template:manage)
// ===========================================================================

export interface MessageTemplateRow {
  key: string;
  group: string;
  labelBn: string;
  placeholders: string[];
  bnBody: string;
  enBody: string | null;
  langMode: string;
  isDefault: boolean;
  defaultBnBody: string;
  defaultEnBody: string | null;
  defaultLangMode: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

const MESSAGE_TEMPLATE_FIELDS = `
  key group labelBn placeholders bnBody enBody langMode isDefault
  defaultBnBody defaultEnBody defaultLangMode updatedAt updatedBy
`;

export const MESSAGE_TEMPLATES_QUERY = gql<{ messageTemplates: MessageTemplateRow[] }, NoVars>`
  query MessageTemplates {
    messageTemplates { ${MESSAGE_TEMPLATE_FIELDS} }
  }
`;

export const MESSAGE_TEMPLATE_QUERY = gql<
  { messageTemplate: MessageTemplateRow | null },
  { key: string }
>`
  query MessageTemplate($key: String!) {
    messageTemplate(key: $key) { ${MESSAGE_TEMPLATE_FIELDS} }
  }
`;

export interface MessageTemplateHistoryRow {
  at: string;
  actorId: string | null;
  action: string;
  priorBnBody: string | null;
  priorEnBody: string | null;
  priorLangMode: string | null;
  wasDefault: boolean;
}

export const MESSAGE_TEMPLATE_HISTORY_QUERY = gql<
  { messageTemplateHistory: MessageTemplateHistoryRow[] },
  { key: string }
>`
  query MessageTemplateHistory($key: String!) {
    messageTemplateHistory(key: $key) {
      at actorId action priorBnBody priorEnBody priorLangMode wasDefault
    }
  }
`;

export const EDIT_MESSAGE_TEMPLATE = gql<
  { editMessageTemplate: MessageTemplateRow | null },
  { key: string; bnBody: string; enBody?: string | null; langMode: string }
>`
  mutation EditMessageTemplate($key: String!, $bnBody: String!, $enBody: String, $langMode: String!) {
    editMessageTemplate(key: $key, bnBody: $bnBody, enBody: $enBody, langMode: $langMode) {
      ${MESSAGE_TEMPLATE_FIELDS}
    }
  }
`;

export const RESET_MESSAGE_TEMPLATE = gql<
  { resetMessageTemplate: { key: string; reset: boolean } },
  { key: string }
>`
  mutation ResetMessageTemplate($key: String!) {
    resetMessageTemplate(key: $key) { key reset }
  }
`;

// ===========================================================================
// Vocabulary Tracker (VC-5 app surfaces over the merged VC-1..VC-4 resolvers)
// ===========================================================================

// --- VC-1 word bank --------------------------------------------------------

export interface VocabWordT {
  id: string;
  program: string;
  classLevel: number;
  headword: string;
  banglaMeaning: string;
  active: boolean;
}

const VOCAB_WORD_FIELDS = `id program classLevel headword banglaMeaning active`;

export const VOCAB_WORDS_QUERY = gql<
  { vocabWords: VocabWordT[] },
  { program: string; classLevel: number; includeInactive?: boolean | null }
>`
  query VocabWords($program: String!, $classLevel: Int!, $includeInactive: Boolean) {
    vocabWords(program: $program, classLevel: $classLevel, includeInactive: $includeInactive) { ${VOCAB_WORD_FIELDS} }
  }
`;

export const ADD_VOCAB_WORD = gql<
  { addVocabWord: VocabWordT },
  { program: string; classLevel: number; headword: string; banglaMeaning: string }
>`
  mutation AddVocabWord($program: String!, $classLevel: Int!, $headword: String!, $banglaMeaning: String!) {
    addVocabWord(program: $program, classLevel: $classLevel, headword: $headword, banglaMeaning: $banglaMeaning) { ${VOCAB_WORD_FIELDS} }
  }
`;

export const EDIT_VOCAB_WORD = gql<
  { editVocabWord: VocabWordT },
  { wordId: string; headword?: string | null; banglaMeaning?: string | null }
>`
  mutation EditVocabWord($wordId: String!, $headword: String, $banglaMeaning: String) {
    editVocabWord(wordId: $wordId, headword: $headword, banglaMeaning: $banglaMeaning) { ${VOCAB_WORD_FIELDS} }
  }
`;

export const SET_VOCAB_WORD_ACTIVE = gql<
  { setVocabWordActive: VocabWordT },
  { wordId: string; active: boolean }
>`
  mutation SetVocabWordActive($wordId: String!, $active: Boolean!) {
    setVocabWordActive(wordId: $wordId, active: $active) { ${VOCAB_WORD_FIELDS} }
  }
`;

// --- VC-2 tests + positions + weekly assignment ----------------------------

export interface VocabTestT {
  id: string;
  program: string;
  sectionId: string;
  classLevel: number;
  testDate: string;
  weekOf: string;
  label: string;
  totalMarks: number;
  dictationHalfMissCounts: boolean;
  status: string;
}

const VOCAB_TEST_FIELDS = `id program sectionId classLevel testDate weekOf label totalMarks dictationHalfMissCounts status`;

export const VOCAB_TESTS_QUERY = gql<
  { vocabTests: VocabTestT[] },
  { sectionId?: string | null; program?: string | null; weekOf?: string | null }
>`
  query VocabTests($sectionId: String, $program: String, $weekOf: String) {
    vocabTests(sectionId: $sectionId, program: $program, weekOf: $weekOf) { ${VOCAB_TEST_FIELDS} }
  }
`;

export const VOCAB_TEST_QUERY = gql<{ vocabTest: VocabTestT | null }, { testId: string }>`
  query VocabTest($testId: String!) {
    vocabTest(testId: $testId) { ${VOCAB_TEST_FIELDS} }
  }
`;

export const CREATE_VOCAB_TEST = gql<
  { createVocabTest: VocabTestT },
  { program: string; sectionId: string; classLevel: number; label: string; totalMarks: number; dictationHalfMissCounts?: boolean | null; testDate?: string | null }
>`
  mutation CreateVocabTest($program: String!, $sectionId: String!, $classLevel: Int!, $label: String!, $totalMarks: Int!, $dictationHalfMissCounts: Boolean, $testDate: String) {
    createVocabTest(program: $program, sectionId: $sectionId, classLevel: $classLevel, label: $label, totalMarks: $totalMarks, dictationHalfMissCounts: $dictationHalfMissCounts, testDate: $testDate) { ${VOCAB_TEST_FIELDS} }
  }
`;

export const UPDATE_VOCAB_TEST = gql<
  { updateVocabTest: VocabTestT },
  { testId: string; label?: string | null; totalMarks?: number | null; dictationHalfMissCounts?: boolean | null; testDate?: string | null }
>`
  mutation UpdateVocabTest($testId: String!, $label: String, $totalMarks: Int, $dictationHalfMissCounts: Boolean, $testDate: String) {
    updateVocabTest(testId: $testId, label: $label, totalMarks: $totalMarks, dictationHalfMissCounts: $dictationHalfMissCounts, testDate: $testDate) { ${VOCAB_TEST_FIELDS} }
  }
`;

export interface VocabPositionT {
  id: string;
  testId: string;
  direction: string;
  qNumber: number;
  wordId: string;
}

const VOCAB_POSITION_FIELDS = `id testId direction qNumber wordId`;

export const VOCAB_TEST_POSITIONS_QUERY = gql<
  { vocabTestPositions: VocabPositionT[] },
  { testId: string }
>`
  query VocabTestPositions($testId: String!) {
    vocabTestPositions(testId: $testId) { ${VOCAB_POSITION_FIELDS} }
  }
`;

export interface VocabPositionSelectionIn {
  direction: string;
  wordIds: string[];
}

export const SET_VOCAB_TEST_POSITIONS = gql<
  { setVocabTestPositions: VocabPositionT[] },
  { testId: string; selections: VocabPositionSelectionIn[] }
>`
  mutation SetVocabTestPositions($testId: String!, $selections: [VocabPositionSelectionInput!]!) {
    setVocabTestPositions(testId: $testId, selections: $selections) { ${VOCAB_POSITION_FIELDS} }
  }
`;

export interface VocabAssignmentT {
  id: string;
  sectionId: string;
  program: string;
  weekOf: string;
  assignedTeacherId: string;
  assignedBy: string;
  source: string;
  proxyGrantId: string | null;
  createdAt: string;
}

const VOCAB_ASSIGNMENT_FIELDS = `id sectionId program weekOf assignedTeacherId assignedBy source proxyGrantId createdAt`;

export const ASSIGN_VOCAB_TESTER = gql<
  { assignVocabTester: VocabAssignmentT },
  { sectionId: string; program: string; weekOf: string; teacherId: string }
>`
  mutation AssignVocabTester($sectionId: String!, $program: String!, $weekOf: String!, $teacherId: String!) {
    assignVocabTester(sectionId: $sectionId, program: $program, weekOf: $weekOf, teacherId: $teacherId) { ${VOCAB_ASSIGNMENT_FIELDS} }
  }
`;

export const VOCAB_TESTER_ASSIGNMENT_QUERY = gql<
  { vocabTesterAssignment: VocabAssignmentT | null },
  { sectionId: string; program: string; weekOf: string }
>`
  query VocabTesterAssignment($sectionId: String!, $program: String!, $weekOf: String!) {
    vocabTesterAssignment(sectionId: $sectionId, program: $program, weekOf: $weekOf) { ${VOCAB_ASSIGNMENT_FIELDS} }
  }
`;

export const VOCAB_ASSIGNMENT_HISTORY_QUERY = gql<
  { vocabAssignmentHistory: VocabAssignmentT[] },
  { sectionId: string; program: string }
>`
  query VocabAssignmentHistory($sectionId: String!, $program: String!) {
    vocabAssignmentHistory(sectionId: $sectionId, program: $program) { ${VOCAB_ASSIGNMENT_FIELDS} }
  }
`;

export const MY_VOCAB_ASSIGNMENTS_QUERY = gql<
  { myVocabAssignments: VocabAssignmentT[] },
  { fromWeek?: string | null }
>`
  query MyVocabAssignments($fromWeek: String) {
    myVocabAssignments(fromWeek: $fromWeek) { ${VOCAB_ASSIGNMENT_FIELDS} }
  }
`;

// --- VC-3 marking + derived per-student result -----------------------------

export interface VocabWrongWordT {
  positionId: string;
  wordId: string;
  direction: string;
  headword: string;
  banglaMeaning: string;
  wrongFields: number[];
}

export interface VocabStudentResultT {
  testId: string;
  studentId: string;
  status: string;
  score: number | null;
  totalMarks: number;
  marksLost: number | null;
  wrongCount: number | null;
  wrongWords: VocabWrongWordT[];
}

const VOCAB_RESULT_FIELDS = `
  testId studentId status score totalMarks marksLost wrongCount
  wrongWords { positionId wordId direction headword banglaMeaning wrongFields }
`;

export const VOCAB_TEST_RESULTS_QUERY = gql<
  { vocabTestResults: VocabStudentResultT[] },
  { testId: string }
>`
  query VocabTestResults($testId: String!) {
    vocabTestResults(testId: $testId) { ${VOCAB_RESULT_FIELDS} }
  }
`;

export interface VocabMistakeIn {
  positionId: string;
  wrongFields: number[];
}

export const SUBMIT_VOCAB_STUDENT_RESULT = gql<
  { submitVocabStudentResult: VocabStudentResultT },
  { testId: string; studentId: string; status: string; mistakes?: VocabMistakeIn[] | null }
>`
  mutation SubmitVocabStudentResult($testId: String!, $studentId: String!, $status: String!, $mistakes: [VocabMistakeInput!]) {
    submitVocabStudentResult(testId: $testId, studentId: $studentId, status: $status, mistakes: $mistakes) { ${VOCAB_RESULT_FIELDS} }
  }
`;

// --- VC-4 reports / dashboards / cumulative --------------------------------

export interface VocabTestMetaT {
  testId: string;
  program: string;
  sectionId: string;
  classLevel: number;
  label: string;
  testDate: string;
  totalMarks: number;
  status: string;
}

export interface VocabScoreRollupT {
  presentCount: number;
  absentCount: number;
  totalScore: number;
  totalPossible: number;
  averageScore: number;
  averageTotal: number;
}

export interface VocabMissedWordT {
  wordId: string;
  headword: string;
  banglaMeaning: string;
  missedBy: number;
  missedPct: number;
  flagged: boolean;
  directions: string[];
}

export interface VocabPersistentWordT {
  wordId: string;
  headword: string;
  banglaMeaning: string;
  missCount: number;
  directions: string[];
}

const VOCAB_TEST_META_FIELDS = `testId program sectionId classLevel label testDate totalMarks status`;
const VOCAB_ROLLUP_FIELDS = `presentCount absentCount totalScore totalPossible averageScore averageTotal`;
const VOCAB_MISSED_FIELDS = `wordId headword banglaMeaning missedBy missedPct flagged directions`;
const VOCAB_PERSISTENT_FIELDS = `wordId headword banglaMeaning missCount directions`;

export interface VocabTestReportT {
  test: VocabTestMetaT;
  rollup: VocabScoreRollupT;
  students: VocabStudentResultT[];
  mostMissed: VocabMissedWordT[];
}

export const VOCAB_TEST_REPORT_QUERY = gql<
  { vocabTestReport: VocabTestReportT | null },
  { testId: string; classPersistentPct?: number | null }
>`
  query VocabTestReport($testId: String!, $classPersistentPct: Float) {
    vocabTestReport(testId: $testId, classPersistentPct: $classPersistentPct) {
      test { ${VOCAB_TEST_META_FIELDS} }
      rollup { ${VOCAB_ROLLUP_FIELDS} }
      students { ${VOCAB_RESULT_FIELDS} }
      mostMissed { ${VOCAB_MISSED_FIELDS} }
    }
  }
`;

export interface VocabStudentTestEntryT {
  test: VocabTestMetaT;
  result: VocabStudentResultT;
}

export interface VocabStudentDashboardT {
  studentId: string;
  perTest: VocabStudentTestEntryT[];
  rollup: VocabScoreRollupT;
  persistentWords: VocabPersistentWordT[];
}

export const VOCAB_STUDENT_DASHBOARD_QUERY = gql<
  { vocabStudentDashboard: VocabStudentDashboardT },
  { studentId: string; program?: string | null; persistentMinTests?: number | null }
>`
  query VocabStudentDashboard($studentId: String!, $program: String, $persistentMinTests: Int) {
    vocabStudentDashboard(studentId: $studentId, program: $program, persistentMinTests: $persistentMinTests) {
      studentId
      perTest { test { ${VOCAB_TEST_META_FIELDS} } result { ${VOCAB_RESULT_FIELDS} } }
      rollup { ${VOCAB_ROLLUP_FIELDS} }
      persistentWords { ${VOCAB_PERSISTENT_FIELDS} }
    }
  }
`;

export interface VocabClassTestEntryT {
  test: VocabTestMetaT;
  rollup: VocabScoreRollupT;
}

export interface VocabClassDashboardT {
  sectionId: string;
  program: string | null;
  tests: VocabClassTestEntryT[];
  rollup: VocabScoreRollupT;
  mostMissed: VocabMissedWordT[];
}

export const VOCAB_CLASS_DASHBOARD_QUERY = gql<
  { vocabClassDashboard: VocabClassDashboardT },
  { sectionId: string; program?: string | null; classPersistentPct?: number | null }
>`
  query VocabClassDashboard($sectionId: String!, $program: String, $classPersistentPct: Float) {
    vocabClassDashboard(sectionId: $sectionId, program: $program, classPersistentPct: $classPersistentPct) {
      sectionId program
      tests { test { ${VOCAB_TEST_META_FIELDS} } rollup { ${VOCAB_ROLLUP_FIELDS} } }
      rollup { ${VOCAB_ROLLUP_FIELDS} }
      mostMissed { ${VOCAB_MISSED_FIELDS} }
    }
  }
`;

export interface VocabCumulativeT {
  studentId: string;
  program: string | null;
  mode: string;
  periodLabel: string;
  numTests: number;
  rollup: VocabScoreRollupT;
  persistentWords: VocabPersistentWordT[];
  testIds: string[];
}

export const VOCAB_STUDENT_CUMULATIVE_QUERY = gql<
  { vocabStudentCumulative: VocabCumulativeT },
  { studentId: string; program?: string | null; mode?: string | null; asOf?: string | null; n?: number | null; persistentMinTests?: number | null }
>`
  query VocabStudentCumulative($studentId: String!, $program: String, $mode: String, $asOf: String, $n: Int, $persistentMinTests: Int) {
    vocabStudentCumulative(studentId: $studentId, program: $program, mode: $mode, asOf: $asOf, n: $n, persistentMinTests: $persistentMinTests) {
      studentId program mode periodLabel numTests
      rollup { ${VOCAB_ROLLUP_FIELDS} }
      persistentWords { ${VOCAB_PERSISTENT_FIELDS} }
      testIds
    }
  }
`;

// --- VC-4 guardian message generation --------------------------------------

export interface VocabMessageRecipientT {
  studentId: string;
  studentName: string;
  kind: string;
  messageBn: string;
  waLink: string | null;
  unreachableByWa: boolean;
  notifiedGuardianIds: string[];
}

const VOCAB_RECIPIENT_FIELDS = `studentId studentName kind messageBn waLink unreachableByWa notifiedGuardianIds`;

export interface GenerateVocabMessagesResultT {
  testId: string;
  recipients: VocabMessageRecipientT[];
  unreachableCount: number;
}

export const GENERATE_VOCAB_TEST_MESSAGES = gql<
  { generateVocabTestMessages: GenerateVocabMessagesResultT },
  { testId: string }
>`
  mutation GenerateVocabTestMessages($testId: String!) {
    generateVocabTestMessages(testId: $testId) {
      testId unreachableCount
      recipients { ${VOCAB_RECIPIENT_FIELDS} }
    }
  }
`;

export interface GenerateVocabCumulativeResultT {
  sectionId: string;
  program: string | null;
  recipients: VocabMessageRecipientT[];
  unreachableCount: number;
}

export const GENERATE_VOCAB_CUMULATIVE_MESSAGES = gql<
  { generateVocabCumulativeMessages: GenerateVocabCumulativeResultT },
  { sectionId: string; program?: string | null; mode?: string | null; asOf?: string | null; n?: number | null }
>`
  mutation GenerateVocabCumulativeMessages($sectionId: String!, $program: String, $mode: String, $asOf: String, $n: Int) {
    generateVocabCumulativeMessages(sectionId: $sectionId, program: $program, mode: $mode, asOf: $asOf, n: $n) {
      sectionId program unreachableCount
      recipients { ${VOCAB_RECIPIENT_FIELDS} }
    }
  }
`;

// --- VC-4 guardian child read (read-only, marked-only) ---------------------

export interface ChildVocabResultT {
  testId: string;
  program: string;
  label: string;
  testDate: string;
  classLevel: number;
  result: VocabStudentResultT;
}

export const CHILD_VOCAB_QUERY = gql<
  { childVocab: ChildVocabResultT[] },
  { studentId: string; program?: string | null }
>`
  query ChildVocab($studentId: String!, $program: String) {
    childVocab(studentId: $studentId, program: $program) {
      testId program label testDate classLevel
      result { ${VOCAB_RESULT_FIELDS} }
    }
  }
`;
