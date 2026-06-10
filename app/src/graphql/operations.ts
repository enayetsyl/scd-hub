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
      sections { id code nameBn active }
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
 * Import one logical item: a built envelope (single .json) or a Project-03 plan
 * as a .json + .md pair (the server auto-wraps it). Pairs by filename stem.
 */
export const IMPORT_FILES = gql<{ importFiles: ImportResultT }, { files: ImportFileT[] }>`
  mutation ImportFiles($files: [ImportFileInput!]!) {
    importFiles(files: $files) {
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
