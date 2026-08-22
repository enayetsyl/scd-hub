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
  homeworkSupervisor: boolean;
}

/** `myPermissions` rides the SAME round-trip as `me` — it is needed at exactly the
 *  moment `me` is (boot, and again after login), and a second request for it would just
 *  be a second chance to be out of sync. Navigation has historically gated on the role
 *  TEMPLATE; that misses per-user grants (AC-1), which is how everyone but the Principal
 *  reaches the book-production screens (D-#405). */
/** `myTemplates` rides the same round-trip for the same reason: the app cannot tell a
 *  template-derived permission from a per-user grant without knowing which templates the
 *  caller holds, and that distinction is what keeps the D-#467 view switcher from hiding
 *  grant-only screens (see viewModePermissions). Length > 1 ⇒ offer the switcher. */
export const ME_QUERY = gql<
  { me: MeUser | null; myPermissions: string[]; myTemplates: string[] },
  NoVars
>`
  query Me {
    me { id email phone role name active homeworkSupervisor }
    myPermissions
    myTemplates
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
  homeworkConfirmerId?: string | null;
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
      sections { id code nameBn active classTeacherId supportTeacherIds homeworkConfirmerId studentCount }
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
  extent: string | null;
  explicitSet: Array<{ classId: string; subjectId: string }> | null;
}

const SCOPE_GRANT_FIELDS = `id kind active teacherId classId sectionId subjectId coveringTeacherId absentTeacherId startDate durationDays proxyStatus extent explicitSet { classId subjectId }`;

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

/** Supervisory (read-oversight) grants for a teacher (user:manage) — D-#262. */
export const SUPERVISORY_GRANTS_QUERY = gql<{ supervisoryGrants: ScopeGrantT[] }, { teacherId?: string | null }>`
  query SupervisoryGrants($teacherId: String) {
    supervisoryGrants(teacherId: $teacherId) { ${SCOPE_GRANT_FIELDS} }
  }
`;

export const GRANT_SUPERVISORY = gql<
  { grantSupervisory: { grantId: string } },
  {
    teacherId: string;
    extent: string;
    subjectId?: string | null;
    classId?: string | null;
    explicitSet?: Array<{ classId: string; subjectId: string }> | null;
  }
>`
  mutation GrantSupervisory(
    $teacherId: String!
    $extent: String!
    $subjectId: String
    $classId: String
    $explicitSet: [SupervisoryPairInput!]
  ) {
    grantSupervisory(
      teacherId: $teacherId
      extent: $extent
      subjectId: $subjectId
      classId: $classId
      explicitSet: $explicitSet
    ) {
      grantId
    }
  }
`;

export const REVOKE_SUPERVISORY = gql<{ revokeSupervisory: boolean }, { grantId: string }>`
  mutation RevokeSupervisory($grantId: String!) {
    revokeSupervisory(grantId: $grantId)
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
  sessionIndex: number | null;
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
  { subject?: string | null; classLevel?: number | null; currentOnly?: boolean | null }
>`
  query ContentTree($subject: String, $classLevel: Int, $currentOnly: Boolean) {
    contentTree(subject: $subject, classLevel: $classLevel, currentOnly: $currentOnly) {
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
          sessionIndex
        }
      }
    }
  }
`;

/** Full artifact incl. renderedMarkdown for the plan view (ADR-006: shown as-is). */
export interface ContentArtifactT extends ArtifactListItem {
  renderedMarkdown: string | null;
  priorVersionId: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  approvalOverride: boolean | null;
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
      approvedAt
      approvalNote
      approvalOverride
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
  override: boolean;
}

export const APPROVE_PLAN = gql<
  { approvePlan: ApprovePlanResultT },
  { artifactId: string; overrideReason?: string | null }
>`
  mutation ApprovePlan($artifactId: String!, $overrideReason: String) {
    approvePlan(artifactId: $artifactId, overrideReason: $overrideReason) {
      artifactId
      reviewStatus
      override
    }
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
  currentAssignmentId: string | null;
  roundStatus: string | null;
}

/** Current plans + their open-round assignment state, for the multi-select picker. */
export const ASSIGNABLE_PLANS = gql<{ assignablePlans: AssignablePlanT[] }, NoVars>`
  query AssignablePlans {
    assignablePlans {
      artifactId docType subject classLevel anchorWord addressNumber title
      reviewStatus currentReviewerId currentReviewerName currentAssignmentId roundStatus
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
// Question review & publish loop (QR-2/QR-4, D-#508)
// ===========================================================================

export interface QuestionReviewRoundT {
  id: string;
  artifactId: string;
  qid: string | null;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  reviewerId: string;
  reviewerName: string | null;
  assignedAt: string;
  roundNumber: number;
  status: string;
  verdict: string | null;
  /** The reviewer's rejection reason — OPTIONAL for questions, so often null. */
  reason: string | null;
  submittedAt: string | null;
  questionText: string | null;
  questionType: string | null;
  marks: number | null;
  topicTag: string | null;
  payloadJson: string | null;
  artifactReviewStatus: string | null;
  artifactSuperseded: boolean;
}

const QUESTION_ROUND_FIELDS = `
  id artifactId qid subject classLevel anchorWord addressNumber
  reviewerId reviewerName assignedAt roundNumber status
  verdict reason submittedAt
  questionText questionType marks topicTag payloadJson
  artifactReviewStatus artifactSuperseded
`;

/** The reviewer's own queue: assigned first, then already-decided rounds. */
export const MY_QUESTION_REVIEWS = gql<{ myQuestionReviews: QuestionReviewRoundT[] }, NoVars>`
  query MyQuestionReviews {
    myQuestionReviews { ${QUESTION_ROUND_FIELDS} }
  }
`;

/** Principal lists: verdict=APPROVE is the publish queue, CHANGES_REQUESTED the rejected list. */
export const QUESTION_REVIEW_INBOX = gql<
  { questionReviewInbox: QuestionReviewRoundT[] },
  { verdict?: string | null }
>`
  query QuestionReviewInbox($verdict: String) {
    questionReviewInbox(verdict: $verdict) { ${QUESTION_ROUND_FIELDS} }
  }
`;

export const QUESTION_REVIEW_THREAD = gql<
  { questionReviewThread: QuestionReviewRoundT[] },
  { artifactId: string }
>`
  query QuestionReviewThread($artifactId: String!) {
    questionReviewThread(artifactId: $artifactId) { ${QUESTION_ROUND_FIELDS} }
  }
`;

export interface AssignableQuestionT {
  artifactId: string;
  qid: string | null;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  questionText: string | null;
  questionType: string | null;
  marks: number | null;
  topicTag: string | null;
  reviewStatus: string;
  currentReviewerId: string | null;
  currentReviewerName: string | null;
  currentAssignmentId: string | null;
  roundStatus: string | null;
}

export const ASSIGNABLE_QUESTIONS = gql<
  { assignableQuestions: AssignableQuestionT[] },
  { subject?: string | null; classLevel?: number | null; search?: string | null; limit?: number | null }
>`
  query AssignableQuestions($subject: String, $classLevel: Int, $search: String, $limit: Int) {
    assignableQuestions(subject: $subject, classLevel: $classLevel, search: $search, limit: $limit) {
      artifactId qid subject classLevel anchorWord addressNumber
      questionText questionType marks topicTag reviewStatus
      currentReviewerId currentReviewerName currentAssignmentId roundStatus
    }
  }
`;

export interface QuestionBulkResultT {
  okCount: number;
  failedCount: number;
  failures: string[];
}

export const ASSIGN_QUESTION_REVIEW_BULK = gql<
  { assignQuestionReviewBulk: QuestionBulkResultT },
  { artifactIds: string[]; reviewerId: string }
>`
  mutation AssignQuestionReviewBulk($artifactIds: [String!]!, $reviewerId: String!) {
    assignQuestionReviewBulk(artifactIds: $artifactIds, reviewerId: $reviewerId) {
      okCount failedCount failures
    }
  }
`;

/** Accept or reject. `reason` is optional even on CHANGES_REQUESTED (Q2.4). */
export const SUBMIT_QUESTION_REVIEW = gql<
  { submitQuestionReview: QuestionReviewRoundT },
  { assignmentId: string; verdict: string; reason?: string | null }
>`
  mutation SubmitQuestionReview($assignmentId: String!, $verdict: String!, $reason: String) {
    submitQuestionReview(assignmentId: $assignmentId, verdict: $verdict, reason: $reason) {
      ${QUESTION_ROUND_FIELDS}
    }
  }
`;

export interface PublishQuestionResultT {
  artifactId: string;
  reviewStatus: string;
  override: boolean;
}

/** Publish one question. `overrideReason` is REQUIRED to publish a rejected/draft one. */
export const PUBLISH_QUESTION = gql<
  { publishQuestion: PublishQuestionResultT },
  { artifactId: string; overrideReason?: string | null }
>`
  mutation PublishQuestion($artifactId: String!, $overrideReason: String) {
    publishQuestion(artifactId: $artifactId, overrideReason: $overrideReason) {
      artifactId reviewStatus override
    }
  }
`;

export const PUBLISH_QUESTION_BULK = gql<
  { publishQuestionBulk: QuestionBulkResultT },
  { artifactIds: string[] }
>`
  mutation PublishQuestionBulk($artifactIds: [String!]!) {
    publishQuestionBulk(artifactIds: $artifactIds) { okCount failedCount failures }
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
  topicTag: string | null;
  questionType: string | null;
  /** Exercise family code (D-#511), e.g. QCAT-SOBDARTH. Null on older imports. */
  category: string | null;
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
  topicTags?: string[] | null;
  questionTypes?: string[] | null;
  chapters?: number[] | null;
  category?: string | null;
  bloomLevel?: string | null;
  difficulty?: string | null;
  paperRole?: string | null;
  marksMin?: number | null;
  marksMax?: number | null;
  reviewStatus?: string | null;
  /** Free-text over question_text + qid; Bangla digits match Latin qids. */
  search?: string | null;
  limit?: number | null;
  offset?: number | null;
  /** Cursor: id of the previous page's last item (ux-audit F16). */
  after?: string | null;
}

export const QUESTIONS_QUERY = gql<{ questions: QuestionListItem[] }, QuestionsVars>`
  query Questions(
    $subject: String
    $classLevel: Int
    $topicTags: [String!]
    $questionTypes: [String!]
    $chapters: [Int!]
    $category: String
    $bloomLevel: String
    $difficulty: String
    $paperRole: String
    $marksMin: Float
    $marksMax: Float
    $reviewStatus: String
    $search: String
    $limit: Int
    $offset: Int
    $after: String
  ) {
    questions(
      subject: $subject
      classLevel: $classLevel
      topicTags: $topicTags
      questionTypes: $questionTypes
      chapters: $chapters
      category: $category
      bloomLevel: $bloomLevel
      difficulty: $difficulty
      paperRole: $paperRole
      marksMin: $marksMin
      marksMax: $marksMax
      reviewStatus: $reviewStatus
      search: $search
      limit: $limit
      offset: $offset
      after: $after
    ) {
      id
      subject
      classLevel
      qid
      topicTag
      questionType
      category
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

export const QUESTION_TOPIC_TAGS_QUERY = gql<
  { questionTopicTags: string[] },
  { subject?: string | null; classLevel?: number | null }
>`
  query QuestionTopicTags($subject: String, $classLevel: Int) {
    questionTopicTags(subject: $subject, classLevel: $classLevel)
  }
`;

export const QUESTION_CHAPTERS_QUERY = gql<
  { questionChapters: number[] },
  { subject?: string | null; classLevel?: number | null }
>`
  query QuestionChapters($subject: String, $classLevel: Int) {
    questionChapters(subject: $subject, classLevel: $classLevel)
  }
`;

export const QUESTION_CATEGORIES_QUERY = gql<
  { questionCategories: string[] },
  { subject?: string | null; classLevel?: number | null }
>`
  query QuestionCategories($subject: String, $classLevel: Int) {
    questionCategories(subject: $subject, classLevel: $classLevel)
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
  /** Full question payload JSON — present on the single-set detail query only. */
  payloadJson?: string | null;
}

export interface AssessmentSetT {
  id: string;
  setType: string;
  name: string | null;
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
  { setType: string; sectionId: string; classId: string; subjectId?: string | null; name?: string | null }
>`
  mutation CreateSet($setType: String!, $sectionId: String!, $classId: String!, $subjectId: String, $name: String) {
    createSet(setType: $setType, sectionId: $sectionId, classId: $classId, subjectId: $subjectId, name: $name) {
      id
      setType
      name
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

/** One-step transactional create (ux-audit F6/F10): create + attach in order +
 *  assemble in a single mutation. Returns the full AssessmentSet so the urql
 *  document cache invalidates set-list queries. */
export const CREATE_SET_WITH_QUESTIONS = gql<
  { createSetWithQuestions: AssessmentSetT },
  {
    setType: string;
    sectionId: string;
    classId: string;
    subjectId?: string | null;
    name?: string | null;
    artifactIds: string[];
    dueDate?: string | null;
    durationMinutes?: number | null;
  }
>`
  mutation CreateSetWithQuestions(
    $setType: String!
    $sectionId: String!
    $classId: String!
    $subjectId: String
    $name: String
    $artifactIds: [String!]!
    $dueDate: String
    $durationMinutes: Int
  ) {
    createSetWithQuestions(
      setType: $setType
      sectionId: $sectionId
      classId: $classId
      subjectId: $subjectId
      name: $name
      artifactIds: $artifactIds
      dueDate: $dueDate
      durationMinutes: $durationMinutes
    ) {
      id
      setType
      name
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
      name
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

export const RENAME_SET = gql<
  { renameSet: AssessmentSetT },
  { setId: string; name: string }
>`
  mutation RenameSet($setId: String!, $name: String!) {
    renameSet(setId: $setId, name: $name) {
      id
      setType
      name
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

export const REMOVE_QUESTION_FROM_SET = gql<
  { removeQuestionFromSet: AssessmentSetT },
  { setId: string; artifactId: string }
>`
  mutation RemoveQuestionFromSet($setId: String!, $artifactId: String!) {
    removeQuestionFromSet(setId: $setId, artifactId: $artifactId) {
      id
      setType
      name
      sectionId
      classId
      subjectId
      status
      basketItems { artifactId qid marks payloadJson }
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
      name
      sectionId
      classId
      subjectId
      status
      basketItems { artifactId qid marks payloadJson }
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
      name
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

/** ux-audit F7 — Today's "সাম্প্রতিক সেট": the caller's newest sets across ALL
 *  their sections, each with the id of a still-open tracker (if any) so the
 *  shortcut can route straight to TrackerEntry instead of re-firing the
 *  non-idempotent openTracker mutation. */
export interface RecentSetT {
  id: string;
  setType: string;
  name: string | null;
  sectionId: string;
  classId: string;
  subjectId: string | null;
  status: string;
  itemCount: number;
  totalMarks: number | null;
  dueDate: string | null;
  createdAt: string;
  openTrackerId: string | null;
}

export const MY_RECENT_SETS = gql<{ myRecentSets: RecentSetT[] }, { limit?: number | null }>`
  query MyRecentSets($limit: Int) {
    myRecentSets(limit: $limit) {
      id
      setType
      name
      sectionId
      classId
      subjectId
      status
      itemCount
      totalMarks
      dueDate
      createdAt
      openTrackerId
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

/** One row of the recordEntries batch (ux-audit F1). `clear` removes the entry (undo). */
export interface TrackerEntryInputT {
  studentId: string;
  score?: number | null;
  submitted?: boolean | null;
  complete?: boolean | null;
  clear?: boolean | null;
}

export interface RecordEntriesResultT {
  trackerId: string;
  entryCount: number;
}

export const RECORD_ENTRIES = gql<
  { recordEntries: RecordEntriesResultT },
  { trackerId: string; entries: TrackerEntryInputT[] }
>`
  mutation RecordEntries($trackerId: String!, $entries: [TrackerEntryInput!]!) {
    recordEntries(trackerId: $trackerId, entries: $entries) {
      trackerId
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

/** One element's outcome inside a question_batch upload (import contract v1.1). */
export interface BatchItemVerdictT {
  qid: string;
  /** imported | skipped | failed */
  status: string;
  reason: string | null;
  artifactId: string | null;
  /** True when a re-imported qid superseded a prior version (not a duplicate row). */
  superseded: boolean | null;
}

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
  /** question_batch (v1.1): per-element verdicts (null on every other path). */
  batchItems: BatchItemVerdictT[] | null;
  bankId: string | null;
  bankVersion: string | null;
}

/** The v1.1 batch fields, shared by both import mutations. */
const BATCH_RESULT_FIELDS = `
      itemsTotal
      itemsPassed
      itemsFailed
      bankId
      bankVersion
      batchItems { qid status reason artifactId superseded }`;

export const IMPORT_ENVELOPE = gql<{ importEnvelope: ImportResultT }, { envelopeJson: string }>`
  mutation ImportEnvelope($envelopeJson: String!) {
    importEnvelope(envelopeJson: $envelopeJson) {
      verdict
      failChecks
      warnings
      advisories
      artifactId
      batchId
      envelopeJson${BATCH_RESULT_FIELDS}
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
      envelopeJson${BATCH_RESULT_FIELDS}
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
  students: Array<{ id: string; name: string; className: string; classLevel: number | null }>;
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
      students { id name className classLevel }
      loginExists
      loginEnabled
      guardianId
    }
  }
`;

export interface GuardianDirectoryT {
  id: string;
  name: string;
  phone: string | null;
  identifierKind: string;
  loginEnabled: boolean;
  active: boolean;
}

export const GUARDIANS_QUERY = gql<{ guardians: GuardianDirectoryT[] }, NoVars>`
  query Guardians {
    guardians {
      id
      name
      phone
      identifierKind
      loginEnabled
      active
    }
  }
`;

export const LINK_GUARDIAN_TO_STUDENT = gql<
  { linkGuardianToStudent: boolean },
  { guardianId: string; studentId: string; relation: string }
>`
  mutation LinkGuardianToStudent($guardianId: String!, $studentId: String!, $relation: String!) {
    linkGuardianToStudent(guardianId: $guardianId, studentId: $studentId, relation: $relation)
  }
`;

export const UNLINK_GUARDIAN_FROM_STUDENT = gql<
  { unlinkGuardianFromStudent: boolean },
  { guardianId: string; studentId: string }
>`
  mutation UnlinkGuardianFromStudent($guardianId: String!, $studentId: String!) {
    unlinkGuardianFromStudent(guardianId: $guardianId, studentId: $studentId)
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
    subjectId: string;
    startDate: string;
    durationDays: number;
  }
>`
  mutation AssignProxy(
    $coveringTeacherId: String!
    $absentTeacherId: String
    $classId: String!
    $sectionId: String!
    $subjectId: String!
    $startDate: String!
    $durationDays: Int!
  ) {
    assignProxy(
      coveringTeacherId: $coveringTeacherId
      absentTeacherId: $absentTeacherId
      classId: $classId
      sectionId: $sectionId
      subjectId: $subjectId
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
  /** Who declared it — Edit/Delete are gated on this (owner report 2026-08-04). */
  declaredBy: string;
  hwId: string;
  subject: string;
  topicLabelBn: string;
  /** D-#317: the teacher's brief "what is the homework" (null pre-D-#317). */
  description: string | null;
  timeDecl: number;
  qCount: number;
  revItem: boolean;
  status: string;
  bandWarning: boolean;
  /** D-#336: raw codes + refs so the edit form can prefill. Optional — only the
   *  day-tally selection fetches them (trim-candidate selections do not). */
  topTags?: string[];
  poolRef?: string | null;
  attachmentIds?: string[];
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

/** D-#320: attendance-backed present/absent prefill for the reconcile screen. */
export interface HwIssueRosterT {
  complete: boolean;
  entries: Array<{ studentId: string; present: boolean }>;
}
export const HOMEWORK_ISSUE_ROSTER = gql<
  { homeworkIssueRoster: HwIssueRosterT },
  { sectionId: string; classId: string; date: string }
>`
  query HomeworkIssueRoster($sectionId: String!, $classId: String!, $date: String!) {
    homeworkIssueRoster(sectionId: $sectionId, classId: $classId, date: $date) {
      complete
      entries { studentId present }
    }
  }
`;


/** DE-5 (D-#477): the assignment a routine period can hand out on this date — null
 *  unless the cell is genuinely deliverable today. Resolves the whole term-anchor →
 *  week → cell chain server-side, so the period card needs none of those axes. */
export interface AssignmentCellForSlotT {
  entryId: string;
  academicYearId: string;
  weekNumber: number;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  deliveryDate: string;
  dueDate: string;
}

export const ASSIGNMENT_CELL_FOR_SLOT = gql<
  { assignmentCellForSlot: AssignmentCellForSlotT | null },
  { sectionId: string; classId: string; subject: string; date: string }
>`
  query AssignmentCellForSlot($sectionId: String!, $classId: String!, $subject: String!, $date: String!) {
    assignmentCellForSlot(sectionId: $sectionId, classId: $classId, subject: $subject, date: $date) {
      entryId academicYearId weekNumber classId classLevel sectionId subject deliveryDate dueDate
    }
  }
`;

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
      items { itemId hwId subject topicLabelBn description timeDecl qCount revItem status bandWarning topTags poolRef attachmentIds declaredBy }
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
      rankA { itemId hwId subject topicLabelBn timeDecl qCount revItem status bandWarning }
      rankB { itemId hwId subject topicLabelBn timeDecl qCount revItem status bandWarning }
      rankC { itemId hwId subject topicLabelBn timeDecl qCount revItem status bandWarning }
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
  pendingChecking: number;
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
      pendingChecking
      submittedOnTimePct
      chaseVolume
      avgReturnLatencyDays
      topicTouches { topTag count }
    }
  }
`;

// Per-class cumulative dashboard counts (badges on the class buttons).
export interface HwClassOverviewT {
  classId: string;
  pendingChecking: number;
  openResubmissions: number;
  activeChases: number;
  onTimePct: number | null;
  overCeilingDaysThisWeek: number;
}
export interface HwClassRefInput {
  classId: string;
  sectionId: string;
}

export const HOMEWORK_CLASS_OVERVIEW = gql<
  { homeworkClassOverview: HwClassOverviewT[] },
  { refs: HwClassRefInput[] }
>`
  query HomeworkClassOverview($refs: [HomeworkClassRefInput!]!) {
    homeworkClassOverview(refs: $refs) {
      classId
      pendingChecking
      openResubmissions
      activeChases
      onTimePct
      overCeilingDaysThisWeek
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

// All open records across dates (no item drill-in) → the date-grouped Checking queue /
// Records screens. `states` selects which lifecycle states count as "pending".
export interface HwOpenRecordT {
  id: string;
  hwId: string;
  /** The item's Mongo _id — the roster-pass mutations' `itemId` arg (RP-1, D-#355). */
  hwItemId: string;
  /** D-#317: the teacher's brief "what is the homework" (null pre-D-#317). */
  description: string | null;
  subject: string;
  topicLabelBn: string;
  dateGiven: string;
  studentId: string;
  studentName: string;
  state: string;
  chaseCount: number;
  hasAnswerFile: boolean;
  /** The attached answer file — the checking queue OPENS it (web) rather than
   *  only badging that a submission exists. Null when nothing is attached. */
  answerFileId: string | null;
  dueDate: string | null;
  result: string | null;
  /** D-#338: stamps on the record — আনডু is only offered when > 1 (entry never pops). */
  stampCount: number;
  /** D-#338: ISO `at` of the newest stamp — same-Dhaka-day undo hint. */
  lastStateAt: string;
  /** Set when this record is a RESUBMISSION (owner 2026-07-26) — badged in the workspace. */
  resubOf: string | null;
}

export const HOMEWORK_OPEN_RECORDS = gql<
  { homeworkOpenRecords: HwOpenRecordT[] },
  { sectionId: string; classId: string; states: string[] }
>`
  query HomeworkOpenRecords($sectionId: String!, $classId: String!, $states: [String!]!) {
    homeworkOpenRecords(sectionId: $sectionId, classId: $classId, states: $states) {
      id hwId hwItemId subject topicLabelBn description dateGiven studentId studentName state chaseCount hasAnswerFile answerFileId dueDate result stampCount lastStateAt resubOf
    }
  }
`;

/** D-#383 — per-item pipeline counts for the workspace card headers. The card
 *  cannot derive these: the workspace fetches only OPEN rows and drops RETURNED
 *  ones older than today, so a finished item's students are simply absent from
 *  `homeworkOpenRecords`. submitted/checked/returned are cumulative. */
export interface HwItemTallyT {
  hwItemId: string;
  total: number;
  submitted: number;
  checked: number;
  returned: number;
  pendingSubmission: number;
  absent: number;
}

export const HOMEWORK_ITEM_TALLIES = gql<
  { homeworkItemTallies: HwItemTallyT[] },
  { sectionId: string; classId: string }
>`
  query HomeworkItemTallies($sectionId: String!, $classId: String!) {
    homeworkItemTallies(sectionId: $sectionId, classId: $classId) {
      hwItemId total submitted checked returned pendingSubmission absent
    }
  }
`;

// D-#338 — undo the last lifecycle action on one record (server is the gate:
// own-action + same-Dhaka-day for teachers, anytime for Principal/Office).
export const REVERT_HW_RECORD = gql<
  { revertHomeworkRecord: { recordId: string; hwId: string; state: string; poppedStates: string[]; deletedResubmissionId: string | null } },
  { sectionId: string; recordId: string }
>`
  mutation RevertHomeworkRecord($sectionId: String!, $recordId: String!) {
    revertHomeworkRecord(sectionId: $sectionId, recordId: $recordId) {
      recordId hwId state poppedStates deletedResubmissionId
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
  /** Declare-form multi-attachments (≤5) — empty when none. */
  attachmentIds: string[];
}

export const HOMEWORK_ITEMS = gql<
  { homeworkItems: HwItemT[] },
  { sectionId: string; classId: string; dateGiven?: string | null }
>`
  query HomeworkItems($sectionId: String!, $classId: String!, $dateGiven: String) {
    homeworkItems(sectionId: $sectionId, classId: $classId, dateGiven: $dateGiven) {
      id hwId classLevel subject dateGiven topTags timeDecl qCount revItem status questionFileId attachmentIds
    }
  }
`;

// Topic picker — the per-(subject, class) catalog a teacher chooses topTags from.
export interface HwTopicT {
  id: string;
  code: string;
  labelBn: string;
  classLevel: number;
  subject: string;
  chapters: { num: number; titleBn: string }[];
  order: number;
}
export const HOMEWORK_TOPICS_QUERY = gql<
  { homeworkTopics: HwTopicT[] },
  { subject: string; classLevel: number }
>`
  query HomeworkTopics($subject: String!, $classLevel: Int!) {
    homeworkTopics(subject: $subject, classLevel: $classLevel) {
      id code labelBn classLevel subject order chapters { num titleBn }
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
    description: string;
    attachmentIds?: string[] | null;
  }
>`
  mutation DeclareHomeworkItem(
    $academicYearId: String!, $classId: String!, $classLevel: Int!, $sectionId: String!,
    $subject: String!, $dateGiven: String!, $topTags: [String!]!, $timeDecl: Int,
    $qCount: Int!, $poolRef: String, $revItem: Boolean, $description: String!, $attachmentIds: [String!]
  ) {
    declareHomeworkItem(
      academicYearId: $academicYearId, classId: $classId, classLevel: $classLevel, sectionId: $sectionId,
      subject: $subject, dateGiven: $dateGiven, topTags: $topTags, timeDecl: $timeDecl,
      qCount: $qCount, poolRef: $poolRef, revItem: $revItem, description: $description, attachmentIds: $attachmentIds
    ) {
      id hwId classLevel subject dateGiven topTags timeDecl qCount revItem status questionFileId attachmentIds
    }
  }
`;

// --- "No homework today" nil declarations (D-#299) ---------------------------

export interface HwNilDeclT {
  id: string;
  classId: string;
  sectionId: string;
  subject: string;
  dateKey: string;
  reason: string;
}

/** D-#336: tiered edit — declared: every declare field; issued: description/topics/
 *  attachments only (server enforces). clearPoolRef=true removes the pool ref. */
export const UPDATE_HOMEWORK_ITEM = gql<
  { updateHomeworkItem: HwItemT },
  {
    itemId: string;
    description?: string | null;
    topTags?: string[] | null;
    timeDecl?: number | null;
    qCount?: number | null;
    poolRef?: string | null;
    clearPoolRef?: boolean | null;
    revItem?: boolean | null;
    attachmentIds?: string[] | null;
  }
>`
  mutation UpdateHomeworkItem(
    $itemId: String!, $description: String, $topTags: [String!], $timeDecl: Int,
    $qCount: Int, $poolRef: String, $clearPoolRef: Boolean, $revItem: Boolean, $attachmentIds: [String!]
  ) {
    updateHomeworkItem(
      itemId: $itemId, description: $description, topTags: $topTags, timeDecl: $timeDecl,
      qCount: $qCount, poolRef: $poolRef, clearPoolRef: $clearPoolRef, revItem: $revItem, attachmentIds: $attachmentIds
    ) {
      id hwId classLevel subject dateGiven topTags timeDecl qCount revItem status questionFileId attachmentIds
    }
  }
`;

/** D-#336: delete a mis-declared item (declared-only + day unreconciled). */
export const DELETE_HOMEWORK_ITEM = gql<
  { deleteHomeworkItem: { itemId: string; hwId: string } },
  { itemId: string }
>`
  mutation DeleteHomeworkItem($itemId: String!) {
    deleteHomeworkItem(itemId: $itemId) {
      itemId
      hwId
    }
  }
`;

export const HW_NIL_DECLARATIONS = gql<
  { homeworkNilDeclarations: HwNilDeclT[] },
  { sectionId: string; classId: string; date: string }
>`
  query HomeworkNilDeclarations($sectionId: String!, $classId: String!, $date: String!) {
    homeworkNilDeclarations(sectionId: $sectionId, classId: $classId, date: $date) {
      id classId sectionId subject dateKey reason
    }
  }
`;

export const DECLARE_NO_HOMEWORK = gql<
  { declareNoHomework: HwNilDeclT },
  { classId: string; sectionId: string; subject: string; date: string; reason: string }
>`
  mutation DeclareNoHomework($classId: String!, $sectionId: String!, $subject: String!, $date: String!, $reason: String!) {
    declareNoHomework(classId: $classId, sectionId: $sectionId, subject: $subject, date: $date, reason: $reason) {
      id classId sectionId subject dateKey reason
    }
  }
`;

export const REMOVE_NO_HOMEWORK = gql<
  { removeNoHomework: boolean },
  { classId: string; sectionId: string; subject: string; date: string }
>`
  mutation RemoveNoHomework($classId: String!, $sectionId: String!, $subject: String!, $date: String!) {
    removeNoHomework(classId: $classId, sectionId: $sectionId, subject: $subject, date: $date)
  }
`;

export interface GuardianHwNilDayT {
  dateKey: string;
  subject: string;
  subjectLabelBn: string;
  reason: string;
}

export const CHILD_HW_NIL_DAYS = gql<
  { childHomeworkNilDays: GuardianHwNilDayT[] },
  { studentId: string; from: string; to: string }
>`
  query ChildHomeworkNilDays($studentId: String!, $from: String!, $to: String!) {
    childHomeworkNilDays(studentId: $studentId, from: $from, to: $to) {
      dateKey subject subjectLabelBn reason
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
        items { itemId hwId subject topicLabelBn timeDecl qCount revItem status bandWarning }
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

export interface HwOutcomeResultT {
  recordId: string;
  hwId: string;
  state: string;
  result: string | null;
  chaseCount: number;
  dueDate: string | null;
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

/** One-tap outcome recording (HWG-1, D-#267) — fast-forwards the lifecycle then applies
 *  the check logic (CORRECT/PARTIAL/WRONG) or the chase logic (NOT_SUBMITTED). */
export const RECORD_HOMEWORK_OUTCOME = gql<
  { recordHomeworkOutcome: HwOutcomeResultT },
  {
    sectionId: string;
    recordId: string;
    outcome: string;
    resubmit?: boolean | null;
    topupQids?: string[] | null;
    topupTime?: number | null;
  }
>`
  mutation RecordHomeworkOutcome(
    $sectionId: String!, $recordId: String!, $outcome: String!, $resubmit: Boolean, $topupQids: [String!], $topupTime: Int
  ) {
    recordHomeworkOutcome(
      sectionId: $sectionId, recordId: $recordId, outcome: $outcome, resubmit: $resubmit, topupQids: $topupQids, topupTime: $topupTime
    ) {
      recordId hwId state result chaseCount dueDate
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

/** D-#313: bulk early GIVEN → DUE for a picked set of the section's records. */
export const MARK_HOMEWORK_RECORDS_DUE = gql<
  { markHomeworkRecordsDue: number },
  { sectionId: string; recordIds: string[] }
>`
  mutation MarkHomeworkRecordsDue($sectionId: String!, $recordIds: [String!]!) {
    markHomeworkRecordsDue(sectionId: $sectionId, recordIds: $recordIds)
  }
`;

// RP-1 (D-#355): the two roster passes. The submit pass fast-forwards the
// uncrossed to SUBMITTED and chases the crossed FIRST-CROSS-ONLY; the return
// pass hands back the uncrossed checked khatas.
export interface HwSubmitPassEntry {
  recordId: string;
  submitted: boolean;
}
export const HOMEWORK_SUBMIT_PASS = gql<
  { homeworkSubmitPass: { submittedCount: number; chasedCount: number; unchangedCount: number } },
  { sectionId: string; itemId: string; entries: HwSubmitPassEntry[] }
>`
  mutation HomeworkSubmitPass($sectionId: String!, $itemId: String!, $entries: [HwSubmitPassEntryInput!]!) {
    homeworkSubmitPass(sectionId: $sectionId, itemId: $itemId, entries: $entries) {
      submittedCount chasedCount unchangedCount
    }
  }
`;

export interface HwReturnPassEntry {
  recordId: string;
  returned: boolean;
}
export const HOMEWORK_RETURN_PASS = gql<
  { homeworkReturnPass: { returnedCount: number; unchangedCount: number } },
  { sectionId: string; itemId: string; entries: HwReturnPassEntry[] }
>`
  mutation HomeworkReturnPass($sectionId: String!, $itemId: String!, $entries: [HwReturnPassEntryInput!]!) {
    homeworkReturnPass(sectionId: $sectionId, itemId: $itemId, entries: $entries) {
      returnedCount unchangedCount
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

export const ASSIGN_HOMEWORK_CONFIRMER = gql<
  { assignHomeworkConfirmer: { id: string; homeworkConfirmerId: string | null } },
  { sectionId: string; userId?: string | null }
>`
  mutation AssignHomeworkConfirmer($sectionId: String!, $userId: String) {
    assignHomeworkConfirmer(sectionId: $sectionId, userId: $userId) {
      id
      homeworkConfirmerId
    }
  }
`;

// School-wide homework supervisors — may reconcile ANY section's daily homework.
export interface HwSupervisorT {
  id: string;
  name: string;
}
export const HOMEWORK_SUPERVISORS_QUERY = gql<{ homeworkSupervisors: HwSupervisorT[] }, NoVars>`
  query HomeworkSupervisors {
    homeworkSupervisors { id name }
  }
`;
export const SET_HOMEWORK_SUPERVISOR = gql<
  { setHomeworkSupervisor: HwSupervisorT[] },
  { userId: string; on: boolean }
>`
  mutation SetHomeworkSupervisor($userId: String!, $on: Boolean!) {
    setHomeworkSupervisor(userId: $userId, on: $on) { id name }
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
  groupName: string | null;
  /** DE-4: the period's roster class level — keys the inline homework topic picker. */
  classLevel: number | null;
  /** True only on myDay's synthesized rows (PXG-1 gap fix, D-#268): this period
   *  belongs to another (absent) teacher and the caller is covering it under an
   *  approved HR leave-cover slot — teacherName is the ABSENT teacher's name. */
  isCovering: boolean;
}

const ROUTINE_SLOT_FIELDS = `
  id groupType groupId classId dayOfWeek periodNumber subject track
  isBreak teacherId roomId effectiveFrom effectiveTo active coverTeacherId
  teacherName coverTeacherName startTime endTime groupName classLevel isCovering
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

// UX-4 (D-#265): the staff Today dashboard — ONE read composing the caller's own
// periods for the date, summed homework work counts, and the attendance-pending flag.
export interface MyDayHomeworkT {
  pendingChecking: number;
  openResubmissions: number;
  activeChases: number;
}
/** A red backlog alert (D-#279): work owed today OR on a previous school day.
 *  `count` = pending DAYS for attendance/class_note, pending ITEMS for assignment_entry. */
export interface PendingAlertT {
  kind: string;
  count: number;
  oldestDateKey: string | null;
}
/** Principal/Office: per-class presence snapshot, rolled up from every attendance unit. */
export interface ClassPresenceT {
  classId: string;
  classLevel: number;
  classNameBn: string;
  markedCount: number;
  presentCount: number;
  absentCount: number;
  totalCount: number;
  complete: boolean;
}
/** Countdown to having the assignment question ready (D-#280). `dueAt` is the school
 *  day's start on the resolved delivery date; null once delivered or once overdue. */
export interface AssignmentPrepCellT {
  classLevel: number;
  subject: string;
  sectionId: string;
}
export interface AssignmentPrepT {
  dueAt: string;
  deliveryDateKey: string;
  weekNumber: number;
  items: number;
  /** Which (class × subject) still need preparing for the delivery week. */
  cells: AssignmentPrepCellT[];
}
export interface ClassTeacherSectionT {
  sectionId: string;
  nameBn: string;
  classLevel: number;
}
export interface MyDayT {
  date: string;
  dayType: string;
  slots: RoutineSlotT[];
  homework: MyDayHomeworkT;
  attendancePending: boolean;
  alerts: PendingAlertT[];
  assignmentPrep: AssignmentPrepT | null;
  classPresence: ClassPresenceT[];
  classTeacherOf: ClassTeacherSectionT[];
}
// D-#316 — the Principal/Office Today dashboard (generic cards).
export interface AdminCardBadgeT {
  key: string;
  value: number;
  tone: string;
}
export interface AdminCardRowT {
  title: string;
  subtitle: string | null;
  value: string | null;
  tone: string;
}
export interface AdminTodayCardT {
  key: string;
  badges: AdminCardBadgeT[];
  rows: AdminCardRowT[];
  moreCount: number;
}
export const ADMIN_TODAY_QUERY = gql<{ adminToday: AdminTodayCardT[] }, { date: string }>`
  query AdminToday($date: String!) {
    adminToday(date: $date) {
      key
      badges { key value tone }
      rows { title subtitle value tone }
      moreCount
    }
  }
`;

// D-#318 — the teacher's OWN sections' attendance for a date (counts + absentees).
export interface SectionAttendanceAbsenteeT {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  schoolId: string;
  leaveCovered: boolean;
}
export interface SectionAttendanceT {
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  presentCount: number;
  absentCount: number;
  totalCount: number;
  complete: boolean;
  absentees: SectionAttendanceAbsenteeT[];
}
export const MY_SECTION_ATTENDANCE = gql<
  { mySectionAttendance: SectionAttendanceT[] },
  { dateKey: string }
>`
  query MySectionAttendance($dateKey: String!) {
    mySectionAttendance(dateKey: $dateKey) {
      sectionId sectionNameBn classLevel presentCount absentCount totalCount complete
      absentees { studentId name nameBn rollNumber schoolId leaveCovered }
    }
  }
`;

export const MY_DAY_QUERY = gql<{ myDay: MyDayT }, { date: string }>`
  query MyDay($date: String!) {
    myDay(date: $date) {
      date
      dayType
      slots { ${ROUTINE_SLOT_FIELDS} }
      homework { pendingChecking openResubmissions activeChases }
      attendancePending
      alerts { kind count oldestDateKey }
      assignmentPrep { dueAt deliveryDateKey weekNumber items cells { classLevel subject sectionId } }
      classPresence {
        classId classLevel classNameBn markedCount presentCount absentCount totalCount complete
      }
      classTeacherOf { sectionId nameBn classLevel }
    }
  }
`;

/** D-#290 — the Principal/Office "who didn't reconcile?" report. */
export interface HwReconMissT {
  dateKey: string;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  confirmerName: string | null;
  declaredItems: number;
  declaredMinutes: number;
}
export interface AsReconMissT {
  weekNumber: number;
  deliveryDateKey: string;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  confirmerName: string | null;
  draftItems: number;
  draftMinutes: number;
}
export interface HwNotDeclaredT {
  dateKey: string;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  teacherName: string | null;
}
export interface HwNilDeclaredT {
  dateKey: string;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  teacherName: string | null;
  reason: string;
}
export interface AsNilDeclaredT {
  weekNumber: number;
  weekStartKey: string;
  deliveryDateKey: string;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  teacherName: string | null;
  reason: string;
}
/** D-#309: rotation-expected assignment nobody declared — per section × subject × week. */
export interface AsNotDeclaredT {
  weekNumber: number;
  weekStartKey: string;
  deliveryDateKey: string | null;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  teacherName: string | null;
}
/** D-#459: rotation-expected assignment with no matching ASSIGNMENT print request. */
export interface AsNotPrintedT {
  weekNumber: number;
  weekStartKey: string;
  deliveryDateKey: string | null;
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  teacherName: string | null;
}
export interface ReconReportT {
  fromKey: string;
  toKey: string;
  hwMisses: HwReconMissT[];
  asMisses: AsReconMissT[];
  hwNotDeclared: HwNotDeclaredT[];
  hwNilDeclared: HwNilDeclaredT[];
  asNilDeclared: AsNilDeclaredT[];
  asNotDeclared: AsNotDeclaredT[];
  asNotPrinted: AsNotPrintedT[];
}
// D-#350 — homework lifecycle report, teacher-first (Principal/Office).
export interface HwTeacherLifecycleRowT {
  teacherId: string;
  teacherName: string;
  declaredItems: number;
  issuedItems: number;
  given: number;
  submitted: number;
  checked: number;
  returned: number;
  pendingSubmission: number;
  pendingChecking: number;
  pendingReturn: number;
  chasedPending: number;
}
export interface HwBacklogRowT {
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  teacherName: string | null;
  count: number;
  oldestDays: number;
}
export interface HwLifecycleReportT {
  fromKey: string;
  toKey: string;
  backlogThresholdDays: number;
  teachers: HwTeacherLifecycleRowT[];
  backlog: HwBacklogRowT[];
}
/** The drill-down behind a pending number: a named stuck student. */
export type HwPendingStage = "SUBMISSION" | "CHECK" | "RETURN" | "CHASE";
export interface HwPendingStudentT {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  sectionNameBn: string | null;
  classLevel: number;
  subject: string;
  guardianPhone: string | null;
  state: string;
  daysWaiting: number;
  chaseCount: number;
  /** Grouping + navigation for the drill sheet (owner ask 2026-08-04). */
  hwItemId: string;
  dateGiven: string;
  sectionId: string;
  classId: string;
}
export const HW_LIFECYCLE_REPORT_QUERY = gql<
  { homeworkLifecycleReport: HwLifecycleReportT },
  { from: string; to: string; classLevel?: number | null; subject?: string | null }
>`
  query HomeworkLifecycleReport($from: String!, $to: String!, $classLevel: Int, $subject: String) {
    homeworkLifecycleReport(from: $from, to: $to, classLevel: $classLevel, subject: $subject) {
      fromKey
      toKey
      backlogThresholdDays
      teachers { teacherId teacherName declaredItems issuedItems given submitted checked returned pendingSubmission pendingChecking pendingReturn chasedPending }
      backlog { sectionId sectionNameBn classLevel subject teacherName count oldestDays }
    }
  }
`;

/** The caller's OWN homework lifecycle row — the teacher-dashboard card (owner 2026-07-25). */
export const MY_HW_LIFECYCLE_QUERY = gql<
  { myHomeworkLifecycle: HwTeacherLifecycleRowT },
  { from: string; to: string }
>`
  query MyHomeworkLifecycle($from: String!, $to: String!) {
    myHomeworkLifecycle(from: $from, to: $to) {
      teacherId teacherName declaredItems issuedItems given submitted checked returned pendingSubmission pendingChecking pendingReturn chasedPending
    }
  }
`;

export const HW_LIFECYCLE_PENDING_QUERY = gql<
  { homeworkLifecyclePending: HwPendingStudentT[] },
  { from: string; to: string; teacherId: string; stage: HwPendingStage; classLevel?: number | null; subject?: string | null }
>`
  query HomeworkLifecyclePending(
    $from: String!
    $to: String!
    $teacherId: String!
    $stage: String!
    $classLevel: Int
    $subject: String
  ) {
    homeworkLifecyclePending(from: $from, to: $to, teacherId: $teacherId, stage: $stage, classLevel: $classLevel, subject: $subject) {
      studentId
      name
      nameBn
      rollNumber
      sectionNameBn
      classLevel
      subject
      guardianPhone
      state
      daysWaiting
      chaseCount
      hwItemId
      dateGiven
      sectionId
      classId
    }
  }
`;

export const RECON_REPORT_QUERY = gql<
  { reconciliationReport: ReconReportT },
  { from: string; to: string }
>`
  query ReconciliationReport($from: String!, $to: String!) {
    reconciliationReport(from: $from, to: $to) {
      fromKey
      toKey
      hwMisses { dateKey sectionId sectionNameBn classLevel confirmerName declaredItems declaredMinutes }
      asMisses { weekNumber deliveryDateKey sectionId sectionNameBn classLevel confirmerName draftItems draftMinutes }
      hwNotDeclared { dateKey sectionId sectionNameBn classLevel subject teacherName }
      hwNilDeclared { dateKey sectionId sectionNameBn classLevel subject teacherName reason }
      asNilDeclared { weekNumber weekStartKey deliveryDateKey sectionId sectionNameBn classLevel subject teacherName reason }
      asNotDeclared { weekNumber weekStartKey deliveryDateKey sectionId sectionNameBn classLevel subject teacherName }
      asNotPrinted { weekNumber weekStartKey deliveryDateKey sectionId sectionNameBn classLevel subject teacherName }
    }
  }
`;

// Master grid (admin overview): all groups × periods for one day + conflicts.
export interface RoutineMasterColumnT { periodNumber: number; startTime: string | null; endTime: string | null; isBreak: boolean; }
export interface RoutineMasterRowT { groupType: string; groupId: string; label: string; sublabel: string | null; }
export interface RoutineMasterSlotT { id: string; groupType: string; groupId: string; periodNumber: number; subject: string; track: string; isBreak: boolean; teacherId: string | null; teacherName: string | null; roomId: string | null; }
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
  slots { id groupType groupId periodNumber subject track isBreak teacherId teacherName roomId }
  conflicts { periodNumber teacherId teacherName labels }
`;
export const ROUTINE_MASTER_QUERY = gql<{ routineMaster: RoutineMasterT }, { day: string }>`
  query RoutineMaster($day: String!) { routineMaster(day: $day) { ${ROUTINE_MASTER_FIELDS} } }
`;

/** D-#291 — the routine's teacher(s) per subject in a section (grant/timetable mismatch view). */
export interface SubjectRoutineTeachersT {
  subject: string;
  teacherIds: string[];
  teacherNames: string[];
}
export const SECTION_SUBJECT_ROUTINE_TEACHERS = gql<
  { sectionSubjectRoutineTeachers: SubjectRoutineTeachersT[] },
  { sectionId: string }
>`
  query SectionSubjectRoutineTeachers($sectionId: String!) {
    sectionSubjectRoutineTeachers(sectionId: $sectionId) { subject teacherIds teacherNames }
  }
`;
export const REASSIGN_ROUTINE_SUBJECT_TEACHER = gql<
  { reassignRoutineSubjectTeacher: { updatedSlots: number; warnings: string[] } },
  { sectionId: string; subject: string; teacherId: string }
>`
  mutation ReassignRoutineSubjectTeacher($sectionId: String!, $subject: String!, $teacherId: String!) {
    reassignRoutineSubjectTeacher(sectionId: $sectionId, subject: $subject, teacherId: $teacherId) {
      updatedSlots
      warnings
    }
  }
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
  { track?: string | null; includeInactive?: boolean | null }
>`
  query SubjectGroups($track: String, $includeInactive: Boolean) {
    subjectGroups(track: $track, includeInactive: $includeInactive) {
      id track level gender code nameBn active
    }
  }
`;

export const CREATE_SUBJECT_GROUP = gql<
  { createSubjectGroup: SubjectGroupT },
  { track: string; level: string; gender: string; code: string; nameBn: string }
>`
  mutation CreateSubjectGroup(
    $track: String!
    $level: String!
    $gender: String!
    $code: String!
    $nameBn: String!
  ) {
    createSubjectGroup(
      track: $track
      level: $level
      gender: $gender
      code: $code
      nameBn: $nameBn
    ) {
      id track level gender code nameBn active
    }
  }
`;

export const SET_SUBJECT_GROUP_ACTIVE = gql<
  { setSubjectGroupActive: SubjectGroupT },
  { groupId: string; active: boolean }
>`
  mutation SetSubjectGroupActive($groupId: String!, $active: Boolean!) {
    setSubjectGroupActive(groupId: $groupId, active: $active) {
      id track level gender code nameBn active
    }
  }
`;

export interface GroupMemberT {
  id: string;
  name: string;
  schoolId: string;
}

export const SUBJECT_GROUP_MEMBER_PROFILES = gql<
  { subjectGroupMemberProfiles: GroupMemberT[] },
  { groupId: string }
>`
  query SubjectGroupMemberProfiles($groupId: String!) {
    subjectGroupMemberProfiles(groupId: $groupId) { id name schoolId }
  }
`;

export const ADD_GROUP_MEMBER = gql<
  { addGroupMember: boolean },
  { groupId: string; studentId: string }
>`
  mutation AddGroupMember($groupId: String!, $studentId: String!) {
    addGroupMember(groupId: $groupId, studentId: $studentId)
  }
`;

export const REMOVE_GROUP_MEMBER = gql<
  { removeGroupMember: boolean },
  { groupId: string; studentId: string }
>`
  mutation RemoveGroupMember($groupId: String!, $studentId: String!) {
    removeGroupMember(groupId: $groupId, studentId: $studentId)
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

export const UPDATE_ROUTINE_SLOT = gql<
  { updateRoutineSlot: CreateSlotResultT },
  { id: string; subject: string; track: string; teacherId?: string | null; roomId?: string | null }
>`
  mutation UpdateRoutineSlot($id: String!, $subject: String!, $track: String!, $teacherId: String, $roomId: String) {
    updateRoutineSlot(id: $id, subject: $subject, track: $track, teacherId: $teacherId, roomId: $roomId) {
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
  name: string;
  nameBn: string;
  gender: string | null;
  classLevel: number;
  rosterClassLabel: string;
  sectionId: string;
  sectionCode: string;
  sectionName: string;
  quranGroup: GuardianChildGroupT | null;
  arabicGroup: GuardianChildGroupT | null;
}

export const MY_CHILDREN_QUERY = gql<{ myChildren: GuardianChildT[] }, NoVars>`
  query MyChildren {
    myChildren {
      studentId name nameBn gender classLevel rosterClassLabel sectionId sectionCode sectionName
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

/** GP-9 (D-#506): one day of the child's routine, with its date. */
export interface GuardianRoutineDayT extends GuardianDayT {
  dateKey: string;
}

/** The child's routine for a WHOLE window in one round-trip — what makes it
 *  possible to say "this subject had a period and declared nothing". */
export const CHILD_ROUTINE_RANGE_QUERY = gql<
  { childRoutineRange: GuardianRoutineDayT[] },
  { studentId: string; from: string; to: string }
>`
  query ChildRoutineRange($studentId: String!, $from: String!, $to: String!) {
    childRoutineRange(studentId: $studentId, from: $from, to: $to) {
      dateKey dayType dayTypeLabelBn holidayNameBn
      slots { subject subjectLabelBn periodNumber startHHMM endHHMM }
    }
  }
`;

/** A worksheet/handout the teacher attached to the note. Bytes stream through
 *  GET /files/:id; the gate checks the guardian has a child in the note's group. */
export interface GuardianClassNoteAttachmentT {
  id: string;
  name: string;
  mime: string;
}

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
    /** DE-6 (D-#478): what the homework is. Null on pre-D-#317 items. */
    description: string | null;
  } | null;
  attachments: GuardianClassNoteAttachmentT[];
}

export const CHILD_CLASS_NOTES_QUERY = gql<
  { childClassNotes: GuardianClassNoteT[] },
  { studentId: string; date: string }
>`
  query ChildClassNotes($studentId: String!, $date: String!) {
    childClassNotes(studentId: $studentId, date: $date) {
      subject subjectLabelBn periodNumber taughtSummaryBn
      homework { hwId subject subjectLabelBn qCount timeDecl description }
      attachments { id name mime }
    }
  }
`;

/** One day of the class-notes history (D-#476). */
export interface GuardianClassNoteDayT {
  dateKey: string;
  notes: GuardianClassNoteT[];
}

/** D-#476: the whole history window in ONE request. The history screen used to
 *  fire CHILD_CLASS_NOTES_QUERY once per day, which is what capped it at a week. */
export const CHILD_CLASS_NOTES_RANGE_QUERY = gql<
  { childClassNotesRange: GuardianClassNoteDayT[] },
  { studentId: string; from: string; to: string }
>`
  query ChildClassNotesRange($studentId: String!, $from: String!, $to: String!) {
    childClassNotesRange(studentId: $studentId, from: $from, to: $to) {
      dateKey
      notes {
        subject subjectLabelBn periodNumber taughtSummaryBn
        homework { hwId subject subjectLabelBn qCount timeDecl description }
        attachments { id name mime }
      }
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
  description: string | null;
  qCount: number;
  timeDecl: number;
  resubOf: string | null;
  topupFlag: boolean;
  topupQCount: number;
  topupTimeMin: number | null;
  questionFileId: string | null;
  answerFileId: string | null;
  attachmentIds: string[];
}

export const CHILD_HOMEWORK_QUERY = gql<
  { childHomework: GuardianHwRecordT[] },
  { studentId: string; from: string; to: string }
>`
  query ChildHomework($studentId: String!, $from: String!, $to: String!) {
    childHomework(studentId: $studentId, from: $from, to: $to) {
      recordId hwId subject subjectLabelBn dateGiven state stateLabelBn
      givenAt dueDate submittedAt checkedAt returnedAt
      chaseCount result resultLabelBn description qCount timeDecl resubOf
      topupFlag topupQCount topupTimeMin
      questionFileId answerFileId attachmentIds
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
  coverTeacherName: string | null;
  absentTeacherName: string | null;
  subject: string | null;
  periodNumber: number | null;
  dayOfWeek: string | null;
  groupName: string | null;
}

export const COVERS_FOR_DATE_QUERY = gql<
  { coversForDate: SubstitutionT[] },
  { date: string }
>`
  query CoversForDate($date: String!) {
    coversForDate(date: $date) {
      id slotId date coverTeacherId absentTeacherId reason active
      coverTeacherName absentTeacherName subject periodNumber dayOfWeek groupName
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
  attachmentIds: string[];
  publishedBy: string;
  publishedAt: string;
}

const CLASS_NOTE_FIELDS = `
  id slotId groupType groupId date subject taughtSummaryBn homeworkItemId attachmentIds publishedBy publishedAt
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

/** DE-3 (D-#477): the homework half of a class-note publish. `mode` is a
 *  server-validated String (house pattern — no GraphQL enum, no contract sync). */
export interface ClassNoteHomeworkIn {
  mode: "DECLARE" | "NIL";
  topTags?: string[];
  description?: string;
  qCount?: number;
  timeDecl?: number;
  poolRef?: string;
  revItem?: boolean;
  attachmentIds?: string[];
  reason?: string;
}

export const PUBLISH_CLASS_NOTE = gql<
  { publishClassNote: ClassNoteT },
  {
    slotId: string;
    date: string;
    taughtSummaryBn: string;
    homeworkItemId?: string | null;
    attachmentIds?: string[] | null;
    /** DE-3 (D-#477): declare the day's homework in the SAME call. */
    homework?: ClassNoteHomeworkIn | null;
  }
>`
  mutation PublishClassNote($slotId: String!, $date: String!, $taughtSummaryBn: String!, $homeworkItemId: String, $attachmentIds: [String!], $homework: ClassNoteHomeworkInput) {
    publishClassNote(slotId: $slotId, date: $date, taughtSummaryBn: $taughtSummaryBn, homeworkItemId: $homeworkItemId, attachmentIds: $attachmentIds, homework: $homework) {
      ${CLASS_NOTE_FIELDS}
    }
  }
`;

// Class-note admin (Principal/Office): list-all-for-date + edit + delete
export interface ClassNoteAttachmentT {
  id: string;
  name: string;
  mime: string;
}
export interface ClassNoteAdminRowT {
  id: string;
  date: string;
  subject: string;
  taughtSummaryBn: string;
  classLevel: number | null;
  classNameBn: string | null;
  sectionCode: string | null;
  sectionNameBn: string | null;
  subjectGroupNameBn: string | null;
  sectionId?: string | null;
  classId?: string | null;
  authorId?: string | null;
  authorName: string | null;
  publishedAt: string;
  attachments: ClassNoteAttachmentT[];
}
export const CLASS_NOTES_ADMIN_QUERY = gql<
  { classNotesAdmin: ClassNoteAdminRowT[] },
  { date: string; dateTo?: string | null }
>`
  query ClassNotesAdmin($date: String!, $dateTo: String) {
    classNotesAdmin(date: $date, dateTo: $dateTo) {
      id date subject taughtSummaryBn classLevel classNameBn sectionCode sectionNameBn
      subjectGroupNameBn authorName publishedAt
      attachments { id name mime }
    }
  }
`;
export const UPDATE_CLASS_NOTE = gql<
  { updateClassNote: ClassNoteT },
  { id: string; taughtSummaryBn?: string | null; attachmentIds?: string[] | null }
>`
  mutation UpdateClassNote($id: String!, $taughtSummaryBn: String, $attachmentIds: [String!]) {
    updateClassNote(id: $id, taughtSummaryBn: $taughtSummaryBn, attachmentIds: $attachmentIds) {
      ${CLASS_NOTE_FIELDS}
    }
  }
`;
export const DELETE_CLASS_NOTE = gql<{ deleteClassNote: { id: string } }, { id: string }>`
  mutation DeleteClassNote($id: String!) { deleteClassNote(id: $id) { id } }
`;

/**
 * The class-note ARCHIVE (owner ask 2026-08-17): every note behind
 * class/section/subject/teacher/date filters, 50 to a page. The server scopes it —
 * routine:manage gets the school, everyone else their own notes — so the same
 * query serves both roles.
 */
export interface ClassNotePageT {
  rows: ClassNoteAdminRowT[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ClassNotesPageVars {
  from?: string | null;
  to?: string | null;
  classId?: string | null;
  sectionId?: string | null;
  subject?: string | null;
  teacherId?: string | null;
  page?: number | null;
  pageSize?: number | null;
}
export const CLASS_NOTES_PAGE_QUERY = gql<{ classNotesPage: ClassNotePageT }, ClassNotesPageVars>`
  query ClassNotesPage(
    $from: String, $to: String, $classId: String, $sectionId: String,
    $subject: String, $teacherId: String, $page: Int, $pageSize: Int
  ) {
    classNotesPage(
      from: $from, to: $to, classId: $classId, sectionId: $sectionId,
      subject: $subject, teacherId: $teacherId, page: $page, pageSize: $pageSize
    ) {
      total page pageSize
      rows {
        id date subject taughtSummaryBn classLevel classNameBn sectionCode sectionNameBn
        subjectGroupNameBn sectionId classId authorId authorName publishedAt
        attachments { id name mime }
      }
    }
  }
`;

export interface ClassNoteFilterOptionT {
  id: string;
  label: string;
  /** Sections carry their owning class id, so the section select narrows with the class. */
  parentId: string | null;
}
export interface ClassNoteFilterOptionsT {
  classes: ClassNoteFilterOptionT[];
  sections: ClassNoteFilterOptionT[];
  subjects: string[];
  teachers: ClassNoteFilterOptionT[];
  canManage: boolean;
}
export const CLASS_NOTE_FILTER_OPTIONS_QUERY = gql<
  { classNoteFilterOptions: ClassNoteFilterOptionsT },
  NoVars
>`
  query ClassNoteFilterOptions {
    classNoteFilterOptions {
      classes { id label parentId }
      sections { id label parentId }
      subjects
      teachers { id label parentId }
      canManage
    }
  }
`;

export interface GuardianAttendanceDayT {
  dateKey: string;
  absent: boolean;
  leaveCovered: boolean;
}

export interface GuardianAttendanceHistoryT {
  studentId: string;
  sectionId: string;
  days: GuardianAttendanceDayT[];
  markedDays: number;
  absentDays: number;
  presentPct: number;
}

export const CHILD_ATTENDANCE_HISTORY_QUERY = gql<
  { childAttendanceHistory: GuardianAttendanceHistoryT },
  { studentId: string; fromKey: string; toKey: string }
>`
  query ChildAttendanceHistory($studentId: String!, $fromKey: String!, $toKey: String!) {
    childAttendanceHistory(studentId: $studentId, fromKey: $fromKey, toKey: $toKey) {
      studentId sectionId markedDays absentDays presentPct
      days { dateKey absent leaveCovered }
    }
  }
`;

export interface GuardianFeeDueT {
  studentId: string;
  studentName: string;
  guardianDue: number;
}

export const CHILD_FEE_DUE_QUERY = gql<
  { childFeeDue: GuardianFeeDueT },
  { studentId: string }
>`
  query ChildFeeDue($studentId: String!) {
    childFeeDue(studentId: $studentId) {
      studentId studentName guardianDue
    }
  }
`;

export interface GuardianLeaveApplicationT {
  id: string;
  studentId: string;
  fromKey: string;
  toKey: string;
  reason: string;
  submittedAt: string;
}

export const CHILD_LEAVE_APPLICATIONS_QUERY = gql<
  { childLeaveApplications: GuardianLeaveApplicationT[] },
  { studentId: string; fromKey: string; toKey: string }
>`
  query ChildLeaveApplications($studentId: String!, $fromKey: String!, $toKey: String!) {
    childLeaveApplications(studentId: $studentId, fromKey: $fromKey, toKey: $toKey) {
      id studentId fromKey toKey reason submittedAt
    }
  }
`;

export const SUBMIT_CHILD_LEAVE_APPLICATION = gql<
  { submitChildLeaveApplication: GuardianLeaveApplicationT },
  { studentId: string; fromKey: string; toKey: string; reason: string }
>`
  mutation SubmitChildLeaveApplication($studentId: String!, $fromKey: String!, $toKey: String!, $reason: String!) {
    submitChildLeaveApplication(studentId: $studentId, fromKey: $fromKey, toKey: $toKey, reason: $reason) {
      id studentId fromKey toKey reason submittedAt
    }
  }
`;

export interface ClassNoteSubmissionRowT {
  groupType: string;
  groupId: string;
  classLevel: number | null;
  classNameBn: string | null;
  sectionCode: string | null;
  sectionNameBn: string | null;
  subjectGroupNameBn: string | null;
  teacherId: string | null;
  teacherName: string | null;
  teacherPhone: string | null;
  teacherSchoolId: string | null;
  publishedSubjects: string[];
  pendingSubjects: string[];
  publishedCount: number;
  pendingCount: number;
}

export const CLASS_NOTE_SUBMISSION_REPORT_QUERY = gql<
  { classNoteSubmissionReport: ClassNoteSubmissionRowT[] },
  { date: string }
>`
  query ClassNoteSubmissionReport($date: String!) {
    classNoteSubmissionReport(date: $date) {
      groupType groupId classLevel classNameBn sectionCode sectionNameBn subjectGroupNameBn teacherId teacherName teacherPhone teacherSchoolId
      publishedSubjects pendingSubjects publishedCount pendingCount
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

// --- Holidays (D-#50) — ad-hoc closures that OVERRIDE the day type ---

export interface HolidayT {
  id: string;
  fromDate: string;
  toDate: string;
  type: string;
  nameBn: string;
  note: string | null;
  active: boolean;
}

const HOLIDAY_FIELDS = `id fromDate toDate type nameBn note active`;

export const HOLIDAYS_QUERY = gql<{ holidays: HolidayT[] }, Record<string, never>>`
  query Holidays {
    holidays { ${HOLIDAY_FIELDS} }
  }
`;

export const CREATE_HOLIDAY = gql<
  { createHolidayException: HolidayT },
  { fromDate: string; toDate: string; type: string; nameBn: string; note?: string | null }
>`
  mutation CreateHoliday(
    $fromDate: String!
    $toDate: String!
    $type: String!
    $nameBn: String!
    $note: String
  ) {
    createHolidayException(
      fromDate: $fromDate
      toDate: $toDate
      type: $type
      nameBn: $nameBn
      note: $note
    ) { ${HOLIDAY_FIELDS} }
  }
`;

export const RETIRE_HOLIDAY = gql<{ retireHolidayException: HolidayT }, { id: string }>`
  mutation RetireHoliday($id: String!) {
    retireHolidayException(id: $id) { ${HOLIDAY_FIELDS} }
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

/** An attendance UNIT the caller must mark (D-#278): their Quran group (Class 1–5)
 *  or their Nursery/KG section. The label already reads class/section-style. */
export interface MarkingUnitT {
  unitType: string;
  unitId: string;
  label: string;
  marked: boolean;
  viaAssignment: boolean;
  source: string | null;
  studentCount: number;
  classLevel: number;
}

export const MY_MARKING_UNITS = gql<
  { myMarkingUnits: MarkingUnitT[] },
  { dateKey: string }
>`
  query MyMarkingUnits($dateKey: String!) {
    myMarkingUnits(dateKey: $dateKey) {
      unitType unitId label marked viaAssignment source studentCount classLevel
    }
  }
`;

export interface RosterStudentT {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  schoolId: string;
}

/** The unit's roster, bucketed under each student's own class/section — display
 *  stays class/section even for a cross-section Quran group (D-#278). */
export interface RosterSectionT {
  sectionId: string;
  sectionCode: string;
  sectionNameBn: string;
  classLevel: number;
  classNameBn: string;
  students: RosterStudentT[];
}

export const ATTENDANCE_UNIT_ROSTER = gql<
  { attendanceUnitRoster: RosterSectionT[] },
  { unitType: string; unitId: string; dateKey: string }
>`
  query AttendanceUnitRoster($unitType: String!, $unitId: String!, $dateKey: String!) {
    attendanceUnitRoster(unitType: $unitType, unitId: $unitId, dateKey: $dateKey) {
      sectionId sectionCode sectionNameBn classLevel classNameBn
      students { studentId name nameBn rollNumber schoolId }
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

export const ATTENDANCE_UNIT_DAY = gql<
  { attendanceUnitDay: StudentAttendanceDayT | null },
  { unitType: string; unitId: string; dateKey: string }
>`
  query AttendanceUnitDay($unitType: String!, $unitId: String!, $dateKey: String!) {
    attendanceUnitDay(unitType: $unitType, unitId: $unitId, dateKey: $dateKey) {
      id sectionId dateKey absentStudentIds markedBy markedAt amendedBy amendedAt
    }
  }
`;

export const MARK_ATTENDANCE_UNIT = gql<
  { markAttendanceUnit: StudentAttendanceDayT },
  { unitType: string; unitId: string; dateKey: string; absentStudentIds: string[] }
>`
  mutation MarkAttendanceUnit($unitType: String!, $unitId: String!, $dateKey: String!, $absentStudentIds: [String!]!) {
    markAttendanceUnit(unitType: $unitType, unitId: $unitId, dateKey: $dateKey, absentStudentIds: $absentStudentIds) {
      id sectionId dateKey absentStudentIds markedBy markedAt amendedBy amendedAt
    }
  }
`;

/** D-#292: Principal/Office unlock-amend of any unit's day (past or today) — audited. */
export const AMEND_ATTENDANCE_UNIT = gql<
  { amendAttendanceUnit: StudentAttendanceDayT },
  { unitType: string; unitId: string; dateKey: string; absentStudentIds: string[] }
>`
  mutation AmendAttendanceUnit($unitType: String!, $unitId: String!, $dateKey: String!, $absentStudentIds: [String!]!) {
    amendAttendanceUnit(unitType: $unitType, unitId: $unitId, dateKey: $dateKey, absentStudentIds: $absentStudentIds) {
      id sectionId dateKey absentStudentIds markedBy markedAt amendedBy amendedAt
    }
  }
`;

/** D-#292: every populated unit for a date + marked state (the admin mark/amend list). */
export interface AdminUnitDayT {
  unitType: string;
  unitId: string;
  label: string;
  sublabel: string | null;
  marked: boolean;
  markerTeacherId: string | null;
  markerName: string | null;
  studentCount: number;
}
export const ATTENDANCE_UNITS_FOR_DATE = gql<
  { attendanceUnitsForDate: AdminUnitDayT[] },
  { dateKey: string }
>`
  query AttendanceUnitsForDate($dateKey: String!) {
    attendanceUnitsForDate(dateKey: $dateKey) {
      unitType unitId label sublabel marked markerTeacherId markerName studentCount
    }
  }
`;

export interface MarkerAssignmentT {
  id: string;
  /** Null when the override targets a Quran group instead of a section (D-#278). */
  sectionId: string | null;
  subjectGroupId: string | null;
  subjectGroupNameBn: string | null;
  teacherId: string;
  teacherName: string | null;
  classLevel: number | null;
  sectionCode: string | null;
  sectionNameBn: string | null;
  classNameBn: string | null;
  fromKey: string;
  toKey: string;
  active: boolean;
}

const MARKER_ASSIGNMENT_FIELDS =
  "id sectionId subjectGroupId subjectGroupNameBn teacherId teacherName classLevel sectionCode sectionNameBn classNameBn fromKey toKey active";

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
  /** D-#318: covered-and-present count beside the absent badge. */
  presentCount: number;
  sections: SectionAbsenteesT[];
}

export const ABSENTEE_REPORT = gql<{ absenteeReport: ClassAbsenteesT[] }, { dateKey: string }>`
  query AbsenteeReport($dateKey: String!) {
    absenteeReport(dateKey: $dateKey) {
      classId classLevel classNameBn absentCount presentCount
      sections {
        sectionId sectionCode sectionNameBn absentCount
        absentees { studentId name nameBn rollNumber schoolId leaveCovered }
      }
    }
  }
`;

/** A still-unmarked unit — for a Class 1–5 section these are its Quran GROUPS. */
export interface PendingAttendanceUnitT {
  unitType: string;
  unitId: string;
  label: string;
  markerTeacherId: string | null;
  markerName: string | null;
}

export interface UnmarkedSectionT {
  sectionId: string;
  sectionCode: string;
  sectionNameBn: string;
  classLevel: number;
  classNameBn: string;
  markerTeacherId: string | null;
  markerName: string | null;
  pendingUnits: PendingAttendanceUnitT[];
}

export const UNMARKED_SECTIONS = gql<{ unmarkedSections: UnmarkedSectionT[] }, { dateKey: string }>`
  query UnmarkedSections($dateKey: String!) {
    unmarkedSections(dateKey: $dateKey) {
      sectionId sectionCode sectionNameBn classLevel classNameBn markerTeacherId markerName
      pendingUnits { unitType unitId label markerTeacherId markerName }
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

export const UPDATE_AS_SCHEDULE_ENTRY_TEACHER = gql<
  { updateAssignmentScheduleEntryTeacher: AsScheduleT },
  { academicYearId: string; entryId: string; teacherId: string }
>`
  mutation UpdateAssignmentScheduleEntryTeacher($academicYearId: String!, $entryId: String!, $teacherId: String!) {
    updateAssignmentScheduleEntryTeacher(academicYearId: $academicYearId, entryId: $entryId, teacherId: $teacherId) { ${AS_SCHEDULE_FIELDS} }
  }
`;

export interface AssignmentLoadRowT {
  key: string;
  label: string;
  planned: number;
  delivered: number;
  issued: number;
}
export interface AssignmentLoadReportT {
  bySubject: AssignmentLoadRowT[];
  byTeacher: AssignmentLoadRowT[];
}
export const ASSIGNMENT_LOAD_REPORT = gql<
  { assignmentLoadReport: AssignmentLoadReportT },
  { academicYearId: string }
>`
  query AssignmentLoadReport($academicYearId: String!) {
    assignmentLoadReport(academicYearId: $academicYearId) {
      bySubject { key label planned delivered issued }
      byTeacher { key label planned delivered issued }
    }
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
  status: string | null;
  asItemId: string | null;
  asId: string | null;
  estMinutes: number | null;
  totalMarks: number | null;
  /** D-#478: current value, so the edit sheet prefills without a second read. */
  description: string | null;
  nilDeclared: boolean;
  nilReason: string | null;
  nilDeclarationId: string | null;
}

export interface ExpectedAsWeekT {
  academicYearId: string;
  weekNumber: number;
  cycleWeek: number;
  weekStart: string;
  year: number;
  month: number;
  weekOfMonth: number;
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
      academicYearId weekNumber cycleWeek weekStart year month weekOfMonth suspended deliveryDate dueDate
      items { entryId cycleWeek classId classLevel sectionId subject teacherId delivered status asItemId asId estMinutes totalMarks description nilDeclared nilReason nilDeclarationId }
    }
  }
`;

export interface AsNilDeclT {
  id: string;
  academicYearId: string;
  weekNumber: number;
  cycleWeek: number;
  weekStartKey: string;
  deliveryDateKey: string;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  teacherId: string;
  reason: string;
  declaredBy: string;
}

export const DECLARE_NO_ASSIGNMENT = gql<
  { declareNoAssignment: AsNilDeclT },
  { academicYearId: string; weekNumber: number; entryId: string; sectionId: string; reason: string }
>`
  mutation DeclareNoAssignment($academicYearId: String!, $weekNumber: Int!, $entryId: String!, $sectionId: String!, $reason: String!) {
    declareNoAssignment(academicYearId: $academicYearId, weekNumber: $weekNumber, entryId: $entryId, sectionId: $sectionId, reason: $reason) {
      id academicYearId weekNumber cycleWeek weekStartKey deliveryDateKey classId classLevel sectionId subject teacherId reason declaredBy
    }
  }
`;

export const REMOVE_NO_ASSIGNMENT = gql<
  { removeNoAssignment: boolean },
  { academicYearId: string; weekNumber: number; entryId: string; sectionId: string }
>`
  mutation RemoveNoAssignment($academicYearId: String!, $weekNumber: Int!, $entryId: String!, $sectionId: String!) {
    removeNoAssignment(academicYearId: $academicYearId, weekNumber: $weekNumber, entryId: $entryId, sectionId: $sectionId)
  }
`;

/** D-#353 — tiered edit of a delivered assignment. DRAFT: time + marks + set.
 *  ISSUED: descriptive only (the time is frozen with the confirmed weekly load). */
export const UPDATE_ASSIGNMENT_ITEM = gql<
  { updateAssignmentItem: { itemId: string; asId: string; status: string; estMinutes: number; totalMarks: number | null } },
  { itemId: string; estMinutes?: number | null; totalMarks?: number | null; setId?: string | null; description?: string | null }
>`
  mutation UpdateAssignmentItem($itemId: String!, $estMinutes: Int, $totalMarks: Int, $setId: String, $description: String) {
    updateAssignmentItem(itemId: $itemId, estMinutes: $estMinutes, totalMarks: $totalMarks, setId: $setId, description: $description) {
      itemId asId status estMinutes totalMarks
    }
  }
`;

/** D-#353 — delete a still-DRAFT delivery (the mistaken-delivery fix path). */
export const DELETE_ASSIGNMENT_ITEM = gql<{ deleteAssignmentItem: boolean }, { itemId: string }>`
  mutation DeleteAssignmentItem($itemId: String!) {
    deleteAssignmentItem(itemId: $itemId)
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
  { deliverAssignment: { itemId: string; asId: string; deliveryDate: string; dueDate: string; status: string; estMinutes: number; presentCount: number; absentCount: number } },
  { academicYearId: string; weekNumber: number; entryId: string; sectionId: string; roster: AsRosterEntryIn[]; description: string; setId?: string | null; totalMarks?: number | null; estMinutes?: number | null; attachmentIds?: string[] | null }
>`
  mutation DeliverAssignment($academicYearId: String!, $weekNumber: Int!, $entryId: String!, $sectionId: String!, $roster: [AssignmentRosterEntryInput!]!, $description: String!, $setId: String, $totalMarks: Int, $estMinutes: Int, $attachmentIds: [String!]) {
    deliverAssignment(academicYearId: $academicYearId, weekNumber: $weekNumber, entryId: $entryId, sectionId: $sectionId, roster: $roster, description: $description, setId: $setId, totalMarks: $totalMarks, estMinutes: $estMinutes, attachmentIds: $attachmentIds) {
      itemId asId deliveryDate dueDate status estMinutes presentCount absentCount
    }
  }
`;

// AS-T6 — weekly load ceiling (reconcile + confirm + trim, D-#274)
export interface AsWeekLoadItemT {
  itemId: string;
  asId: string;
  subject: string;
  estMinutes: number;
  status: string;
}
export interface AsWeekLoadT {
  academicYearId: string;
  sectionId: string;
  weekNumber: number;
  ceiling: number;
  totalMinutes: number;
  draftMinutes: number;
  overBy: number;
  withinCeiling: boolean;
  hasDrafts: boolean;
  items: AsWeekLoadItemT[];
}

export const AS_WEEK_LOAD = gql<
  { assignmentWeekLoad: AsWeekLoadT },
  { academicYearId: string; sectionId: string; weekNumber: number }
>`
  query AssignmentWeekLoad($academicYearId: String!, $sectionId: String!, $weekNumber: Int!) {
    assignmentWeekLoad(academicYearId: $academicYearId, sectionId: $sectionId, weekNumber: $weekNumber) {
      academicYearId sectionId weekNumber ceiling totalMinutes draftMinutes overBy withinCeiling hasDrafts
      items { itemId asId subject estMinutes status }
    }
  }
`;

export const SET_AS_ITEM_MINUTES = gql<
  { setAssignmentItemMinutes: { itemId: string; estMinutes: number } },
  { itemId: string; estMinutes: number }
>`
  mutation SetAssignmentItemMinutes($itemId: String!, $estMinutes: Int!) {
    setAssignmentItemMinutes(itemId: $itemId, estMinutes: $estMinutes) { itemId estMinutes }
  }
`;

export const CONFIRM_AS_WEEK = gql<
  { confirmAssignmentWeek: { weekNumber: number; ceiling: number; totalMinutes: number; itemsIssued: number; recordsIssued: number } },
  { academicYearId: string; sectionId: string; weekNumber: number }
>`
  mutation ConfirmAssignmentWeek($academicYearId: String!, $sectionId: String!, $weekNumber: Int!) {
    confirmAssignmentWeek(academicYearId: $academicYearId, sectionId: $sectionId, weekNumber: $weekNumber) {
      weekNumber ceiling totalMinutes itemsIssued recordsIssued
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

// D-#338 — undo the last lifecycle action on one assignment record.
export const REVERT_AS_RECORD = gql<
  { revertAssignmentRecord: { recordId: string; asId: string; state: string; poppedStates: string[]; deletedResubmissionId: string | null } },
  { sectionId: string; recordId: string }
>`
  mutation RevertAssignmentRecord($sectionId: String!, $recordId: String!) {
    revertAssignmentRecord(sectionId: $sectionId, recordId: $recordId) {
      recordId asId state poppedStates deletedResubmissionId
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


export const ISSUE_AS_RESUBMISSION = gql<
  { issueAssignmentResubmission: { recordId: string; originalRecordId: string; state: string } },
  { sectionId: string; recordId: string }
>`
  mutation IssueAssignmentResubmission($sectionId: String!, $recordId: String!) {
    issueAssignmentResubmission(sectionId: $sectionId, recordId: $recordId) { recordId originalRecordId state }
  }
`;

// RP-3 (D-#356): the section-wide roster-pass read + the two passes + the outcome.
export interface AsOpenRecordT {
  id: string;
  asItemId: string;
  asId: string;
  subject: string;
  classLevel: number;
  deliveryDate: string | null;
  dueDate: string | null;
  studentId: string;
  studentName: string;
  state: string;
  chaseCount: number;
  result: string | null;
  marks: number | null;
  totalMarks: number | null;
  feedback: string | null;
  resubOf: string | null;
  stampCount: number;
  lastStateAt: string;
}
export const AS_OPEN_RECORDS = gql<
  { assignmentOpenRecords: AsOpenRecordT[] },
  { sectionId: string; classId: string; states: string[] }
>`
  query AssignmentOpenRecords($sectionId: String!, $classId: String!, $states: [String!]!) {
    assignmentOpenRecords(sectionId: $sectionId, classId: $classId, states: $states) {
      id asItemId asId subject classLevel deliveryDate dueDate studentId studentName state chaseCount result marks totalMarks feedback resubOf stampCount lastStateAt
    }
  }
`;

/** D-#383 — twin of HOMEWORK_ITEM_TALLIES for the assignment workspace cards. */
export interface AsItemTallyT {
  asItemId: string;
  total: number;
  submitted: number;
  checked: number;
  returned: number;
  pendingSubmission: number;
  absent: number;
}

export const ASSIGNMENT_ITEM_TALLIES = gql<
  { assignmentItemTallies: AsItemTallyT[] },
  { sectionId: string; classId: string }
>`
  query AssignmentItemTallies($sectionId: String!, $classId: String!) {
    assignmentItemTallies(sectionId: $sectionId, classId: $classId) {
      asItemId total submitted checked returned pendingSubmission absent
    }
  }
`;

export interface AsSubmitPassEntry {
  recordId: string;
  submitted: boolean;
}
export const ASSIGNMENT_SUBMIT_PASS = gql<
  { assignmentSubmitPass: { submittedCount: number; chasedCount: number; unchangedCount: number } },
  { sectionId: string; itemId: string; entries: AsSubmitPassEntry[] }
>`
  mutation AssignmentSubmitPass($sectionId: String!, $itemId: String!, $entries: [AsSubmitPassEntryInput!]!) {
    assignmentSubmitPass(sectionId: $sectionId, itemId: $itemId, entries: $entries) {
      submittedCount chasedCount unchangedCount
    }
  }
`;

export interface AsReturnPassEntry {
  recordId: string;
  returned: boolean;
}
export const ASSIGNMENT_RETURN_PASS = gql<
  { assignmentReturnPass: { returnedCount: number; unchangedCount: number } },
  { sectionId: string; itemId: string; entries: AsReturnPassEntry[] }
>`
  mutation AssignmentReturnPass($sectionId: String!, $itemId: String!, $entries: [AsReturnPassEntryInput!]!) {
    assignmentReturnPass(sectionId: $sectionId, itemId: $itemId, entries: $entries) {
      returnedCount unchangedCount
    }
  }
`;

export const RECORD_AS_OUTCOME = gql<
  { recordAssignmentOutcome: { recordId: string; state: string; result: string; marks: number | null } },
  { sectionId: string; recordId: string; result: string; marks?: number | null; feedback?: string | null }
>`
  mutation RecordAssignmentOutcome($sectionId: String!, $recordId: String!, $result: String!, $marks: Int, $feedback: String) {
    recordAssignmentOutcome(sectionId: $sectionId, recordId: $recordId, result: $result, marks: $marks, feedback: $feedback) {
      recordId state result marks
    }
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
  /** D-#478: WHAT the assignment is. Null only for pre-D-#478 items. */
  description: string | null;
  attachmentIds: string[];
}

/** D-#476: limit/offset are optional server-side, so omitting them still returns
 *  the whole history — the guardian list passes them to page instead. */
export const CHILD_ASSIGNMENTS = gql<
  { childAssignments: ChildAssignmentT[] },
  { studentId: string; limit?: number; offset?: number }
>`
  query ChildAssignments($studentId: String!, $limit: Int, $offset: Int) {
    childAssignments(studentId: $studentId, limit: $limit, offset: $offset) {
      recordId asId subject weekNumber state pending daysLate deliveryDate dueDate
      marks totalMarks result feedback isResubmission description attachmentIds
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
  /** D-#301: CO-3 observation kinds carry the id for the detail deep-link. */
  observationId: string | null;
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
    audienceKey periodNumber tier hour observationId
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

/** D-#307: inbox multi-select — mark a picked set of own rows read. */
export const MARK_NOTIFICATIONS_READ = gql<
  { markNotificationsRead: number },
  { ids: string[] }
>`
  mutation MarkNotificationsRead($ids: [String!]!) {
    markNotificationsRead(ids: $ids)
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
  /** D-#361 — "full" | "late_entry" | "early_leave". */
  dayPart: string;
  /** D-#361 — how many periods a partial day covers (null for a full day). */
  partialPeriodCount: number | null;
  /** D-#361 — the period numbers actually missed (empty for a full day). */
  partialPeriods: number[];
  /** Fractional since D-#361: a partial day is 1/3, shown rounded to 2dp. */
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
  dayPart partialPeriodCount partialPeriods
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
  {
    leaveType: string;
    fromKey: string;
    toKey: string;
    reason: string;
    staffProfileId?: string | null;
    /** D-#361 — omit for a whole-day leave. */
    dayPart?: string | null;
    partialPeriodCount?: number | null;
  }
>`
  mutation ApplyForStaffLeave($leaveType: String!, $fromKey: String!, $toKey: String!, $reason: String!, $staffProfileId: String, $dayPart: String, $partialPeriodCount: Int) {
    applyForStaffLeave(leaveType: $leaveType, fromKey: $fromKey, toKey: $toKey, reason: $reason, staffProfileId: $staffProfileId, dayPart: $dayPart, partialPeriodCount: $partialPeriodCount) {
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

/** Pending leave applications awaiting approval — the Staff drawer badge (owner 2026-07-26). */
export const STAFF_LEAVE_PENDING_COUNT = gql<{ staffLeavePendingCount: number }, Record<string, never>>`
  query StaffLeavePendingCount {
    staffLeavePendingCount
  }
`;

/** Undelivered comments awaiting review — the Comments drawer badge (owner 2026-07-26). */
export const COMMENT_REVIEW_COUNT = gql<{ commentReviewCount: number }, Record<string, never>>`
  query CommentReviewCount {
    commentReviewCount
  }
`;

/** Observations awaiting my review / awaiting publish — the Observation drawer badge (owner 2026-07-26). */
export const OBSERVATION_COUNTS = gql<
  { observationCounts: { toReview: number; toPublish: number } },
  Record<string, never>
>`
  query ObservationCounts {
    observationCounts {
      toReview
      toPublish
    }
  }
`;

export interface StaffCoverSlotT {
  id: string;
  leaveApplicationId: string;
  /** "section" | "subjectgroup" — subjectgroup (Quran/Arabic) has no class/section/subject. */
  groupType: string;
  classId: string | null;
  sectionId: string | null;
  subjectId: string | null;
  subjectGroupId: string | null;
  absentTeacherUserId: string | null;
  dateKey: string;
  periodNumber: number;
  proposedCoverTeacherId: string | null;
  finalCoverTeacherUserId: string | null;
  status: string;
  proxyGrantId: string | null;
}

const STAFF_COVER_SLOT_FIELDS = `
  id leaveApplicationId groupType classId sectionId subjectId subjectGroupId
  absentTeacherUserId dateKey periodNumber
  proposedCoverTeacherId finalCoverTeacherUserId status proxyGrantId
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

/** overrideCoverTeacherUserId (PXG-1, D-#268) is optional — omitted, behavior is
 *  unchanged; supplied, mints for the override teacher (proposed slot) or
 *  direct-assigns (needs_cover slot, no proposal required). */
export const DECIDE_STAFF_COVER_SLOT = gql<
  { decideStaffCoverSlot: StaffCoverSlotT },
  { slotId: string; approve: boolean; overrideCoverTeacherUserId?: string | null }
>`
  mutation DecideStaffCoverSlot($slotId: String!, $approve: Boolean!, $overrideCoverTeacherUserId: String) {
    decideStaffCoverSlot(slotId: $slotId, approve: $approve, overrideCoverTeacherUserId: $overrideCoverTeacherUserId) { ${STAFF_COVER_SLOT_FIELDS} }
  }
`;

export interface NeedsCoverRowT {
  slotId: string;
  leaveApplicationId: string;
  groupType: string;
  absentTeacherUserId: string | null;
  absentTeacherName: string | null;
  classId: string | null;
  className: string | null;
  sectionId: string | null;
  sectionName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  subjectGroupId: string | null;
  subjectGroupName: string | null;
  dateKey: string;
  periodNumber: number;
}

/** Cross-leave needs-cover inbox (PXG-1, D-#268) — every uncovered class meeting
 *  across every approved leave overlapping [from, to]. */
export const NEEDS_COVER_SLOTS_QUERY = gql<
  { needsCoverSlots: NeedsCoverRowT[] },
  { from: string; to: string }
>`
  query NeedsCoverSlots($from: String!, $to: String!) {
    needsCoverSlots(from: $from, to: $to) {
      slotId leaveApplicationId groupType absentTeacherUserId absentTeacherName
      classId className sectionId sectionName subjectId subjectName
      subjectGroupId subjectGroupName dateKey periodNumber
    }
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

/** D-#471 — the assignment twin of MY_HW_LIFECYCLE_QUERY. Same field names (minus the
 *  homework-only declared/issued split), so the Today card renders from one shape. */
export interface AsTeacherLifecycleRowT {
  teacherId: string;
  deliveredItems: number;
  given: number;
  submitted: number;
  checked: number;
  returned: number;
  pendingSubmission: number;
  pendingChecking: number;
  pendingReturn: number;
  chasedPending: number;
}

export const MY_AS_LIFECYCLE_QUERY = gql<
  { myAssignmentLifecycle: AsTeacherLifecycleRowT },
  { from: string; to: string }
>`
  query MyAssignmentLifecycle($from: String!, $to: String!) {
    myAssignmentLifecycle(from: $from, to: $to) {
      teacherId deliveredItems given submitted checked returned pendingSubmission pendingChecking pendingReturn chasedPending
    }
  }
`;

/** D-#472 — the child's upcoming class tests: the guardian-home card that clears
 *  itself the day after the exam (no cleanup job, no stale notice). */
export interface ChildUpcomingClassTestT {
  id: string;
  subject: string;
  subjectLabelBn: string;
  chapter: string | null;
  testNumber: number | null;
  examDate: string;
  totalMarks: number | null;
  durationMinutes: number | null;
  daysAway: number;
}

export const CHILD_UPCOMING_CLASS_TESTS_QUERY = gql<
  { childUpcomingClassTests: ChildUpcomingClassTestT[] },
  { studentId: string }
>`
  query ChildUpcomingClassTests($studentId: String!) {
    childUpcomingClassTests(studentId: $studentId) {
      id subject subjectLabelBn chapter testNumber examDate totalMarks durationMinutes daysAway
    }
  }
`;
