/**
 * Exam-syllabus operations (SY-4..SY-6, docs/prd-exam-syllabus.md).
 *
 * Office writes one syllabus per (exam × class × subject); the subject teacher
 * signs it off; the Principal publishes it; teachers and guardians read it.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

export interface SyllabusMarkRowT {
  seq: number;
  label: string;
  /** SYLLABUS_ITEM_TYPES code — `oral` is what derives the written/oral split. */
  itemType: string | null;
  /** CT | ADAB | FINAL — set when this row IS a report-card component (D-#531). */
  component: string | null;
  count: number | null;
  marksEach: number | null;
  total: number;
}

export interface SyllabusT {
  /** Null on a `pending` placeholder — nothing is stored for it yet. */
  id: string | null;
  examId: string;
  /** Null on a LEVEL row — Quran/Arabic from class one up are keyed by track+level. */
  classId: string | null;
  /** The class's Bangla name. Carried per ROW because `mySyllabusApprovals` spans classes. */
  classLabel: string;
  subjectTrack: string | null;
  subjectLevel: string | null;
  /** What a level row shows in place of `classLabel` — "বুক ২ (বালক) + বুক ২ (বালিকা)". */
  levelLabel: string;
  /** The teacher this row was sent to, once sent. Null while it is still a draft. */
  approverUserId: string | null;
  /** Who signed it off and when — NOT the same question as who it was sent to. */
  teacherApprovedBy: string | null;
  teacherApprovedAt: string | null;
  teacherBypass: boolean;
  subject: string;
  bodyMd: string;
  marks: SyllabusMarkRowT[];
  questionTypes: string[];
  examDateKey: string | null;
  status: string;
  /** The last send-back reason — what Office has to fix. */
  sendBackReason: string | null;
  isMine: boolean;
  writtenMarks: number;
  oralMarks: number;
  totalMarks: number;
  /** A subject the caller teaches that has no published row yet. */
  pending: boolean;
}

export interface ClassSyllabusT {
  examId: string;
  classId: string;
  classLabel: string;
  classLevel: number;
  questionTypes: string[];
  noteMd: string;
  subjects: SyllabusT[];
}

export interface SyllabusApproverT {
  userId: string;
  periods: number;
}

const SYLLABUS_FIELDS = `
  id examId classId classLabel subjectTrack subjectLevel levelLabel approverUserId teacherApprovedBy teacherApprovedAt teacherBypass subject bodyMd questionTypes examDateKey status sendBackReason
  isMine writtenMarks oralMarks totalMarks pending
  marks { seq label itemType component count marksEach total }
`;

const CLASS_SYLLABUS_FIELDS = `
  examId classId classLabel classLevel questionTypes noteMd
  subjects { ${SYLLABUS_FIELDS} }
`;

export const EXAM_SYLLABUS_CLASS = gql<
  { examSyllabusClass: ClassSyllabusT },
  { examId: string; classId: string }
>`
  query ExamSyllabusClass($examId: String!, $classId: String!) {
    examSyllabusClass(examId: $examId, classId: $classId) { ${CLASS_SYLLABUS_FIELDS} }
  }
`;

/** The Principal's coverage board — every class of one exam, in ONE query. */
export const EXAM_SYLLABUS_BOARD = gql<
  { examSyllabusBoard: ClassSyllabusT[] },
  { examId: string }
>`
  query ExamSyllabusBoard($examId: String!) {
    examSyllabusBoard(examId: $examId) { ${CLASS_SYLLABUS_FIELDS} }
  }
`;

export const EXAM_SYLLABUS_DETAIL = gql<
  { examSyllabusDetail: SyllabusT | null },
  { examId: string; classId: string; subject: string }
>`
  query ExamSyllabusDetail($examId: String!, $classId: String!, $subject: String!) {
    examSyllabusDetail(examId: $examId, classId: $classId, subject: $subject) { ${SYLLABUS_FIELDS} }
  }
`;

/**
 * One LEVEL syllabus — the (exam × track × level) address that replaces
 * (exam × class × subject) for Quran and Arabic from class one up.
 */
export const EXAM_SYLLABUS_LEVEL_DETAIL = gql<
  { examSyllabusLevelDetail: SyllabusT | null },
  { examId: string; track: string; level: string }
>`
  query ExamSyllabusLevelDetail($examId: String!, $track: String!, $level: String!) {
    examSyllabusLevelDetail(examId: $examId, track: $track, level: $level) { ${SYLLABUS_FIELDS} }
  }
`;

export interface SyllabusLevelRowT {
  track: string;
  level: string;
  /** Both gender groups of the level, joined — they sit the same paper. */
  label: string;
  groupNames: string[];
  memberCount: number;
  subject: string;
  row: SyllabusT | null;
}

/**
 * The level counterpart of the class board. Driven by the GROUPS, so a level
 * nobody has written yet shows as a gap instead of being invisible.
 */
export const EXAM_SYLLABUS_LEVELS = gql<
  { examSyllabusLevels: SyllabusLevelRowT[] },
  { examId: string }
>`
  query ExamSyllabusLevels($examId: String!) {
    examSyllabusLevels(examId: $examId) {
      track level label groupNames memberCount subject
      row { ${SYLLABUS_FIELDS} }
    }
  }
`;

export const GUARDIAN_CHILD_SYLLABUS = gql<
  { guardianChildSyllabus: ClassSyllabusT },
  { examId: string; studentId: string }
>`
  query GuardianChildSyllabus($examId: String!, $studentId: String!) {
    guardianChildSyllabus(examId: $examId, studentId: $studentId) { ${CLASS_SYLLABUS_FIELDS} }
  }
`;

/**
 * The teacher's "waiting on you" list — and the drawer badge's source.
 * Server-side it returns `[]` rather than throwing for a caller with none, so a
 * drawer render can never be taken down by it (the 791e5fe rule).
 */
export const MY_SYLLABUS_APPROVALS = gql<{ mySyllabusApprovals: SyllabusT[] }, NoVars>`
  query MySyllabusApprovals {
    mySyllabusApprovals { ${SYLLABUS_FIELDS} }
  }
`;

export const EXAM_SYLLABUS_APPROVER = gql<
  {
    examSyllabusApprover: { holders: SyllabusApproverT[]; defaultUserId: string | null };
  },
  { classId?: string | null; subject: string; track?: string | null; level?: string | null }
>`
  query ExamSyllabusApprover($classId: String, $subject: String!, $track: String, $level: String) {
    examSyllabusApprover(classId: $classId, subject: $subject, track: $track, level: $level) {
      holders { userId periods }
      defaultUserId
    }
  }
`;

export interface SaveSyllabusVars {
  examId: string;
  /** Exactly one of `classId` or `subjectLevel` — the server refuses both and neither. */
  classId?: string | null;
  subjectTrack?: string | null;
  subjectLevel?: string | null;
  subject: string;
  bodyMd: string;
  marks: Array<{
    seq: number;
    label: string;
    itemType?: string | null;
    component?: string | null;
    count?: number | null;
    marksEach?: number | null;
    total: number;
  }>;
  questionTypes: string[];
  examDateKey?: string | null;
}

export const SAVE_EXAM_SYLLABUS = gql<{ saveExamSyllabus: SyllabusT }, SaveSyllabusVars>`
  mutation SaveExamSyllabus(
    $examId: String!
    $classId: String
    $subjectTrack: String
    $subjectLevel: String
    $subject: String!
    $bodyMd: String!
    $marks: [SyllabusMarkRowInput!]!
    $questionTypes: [String!]!
    $examDateKey: String
  ) {
    saveExamSyllabus(
      examId: $examId
      classId: $classId
      subjectTrack: $subjectTrack
      subjectLevel: $subjectLevel
      subject: $subject
      bodyMd: $bodyMd
      marks: $marks
      questionTypes: $questionTypes
      examDateKey: $examDateKey
    ) { ${SYLLABUS_FIELDS} }
  }
`;

export const SUBMIT_EXAM_SYLLABUS = gql<
  { submitExamSyllabus: SyllabusT },
  { id: string; approverUserId?: string | null }
>`
  mutation SubmitExamSyllabus($id: String!, $approverUserId: String) {
    submitExamSyllabus(id: $id, approverUserId: $approverUserId) { ${SYLLABUS_FIELDS} }
  }
`;

export const APPROVE_EXAM_SYLLABUS = gql<{ approveExamSyllabus: SyllabusT }, { id: string }>`
  mutation ApproveExamSyllabus($id: String!) {
    approveExamSyllabus(id: $id) { ${SYLLABUS_FIELDS} }
  }
`;

export const SEND_BACK_EXAM_SYLLABUS = gql<
  { sendBackExamSyllabus: SyllabusT },
  { id: string; reason: string }
>`
  mutation SendBackExamSyllabus($id: String!, $reason: String!) {
    sendBackExamSyllabus(id: $id, reason: $reason) { ${SYLLABUS_FIELDS} }
  }
`;

export const REASSIGN_EXAM_SYLLABUS = gql<
  { reassignExamSyllabus: SyllabusT },
  { id: string; approverUserId: string }
>`
  mutation ReassignExamSyllabus($id: String!, $approverUserId: String!) {
    reassignExamSyllabus(id: $id, approverUserId: $approverUserId) { ${SYLLABUS_FIELDS} }
  }
`;

export const PUBLISH_EXAM_SYLLABUS = gql<{ publishExamSyllabus: SyllabusT }, { id: string }>`
  mutation PublishExamSyllabus($id: String!) {
    publishExamSyllabus(id: $id) { ${SYLLABUS_FIELDS} }
  }
`;

/** The drawer badge's source — a count, not the rows (see the server comment). */
export const MY_SYLLABUS_APPROVAL_COUNT = gql<{ mySyllabusApprovalCount: number }, NoVars>`
  query MySyllabusApprovalCount {
    mySyllabusApprovalCount
  }
`;

/** The per-CLASS question-type footer (§5.5) — one line under the class's table. */
export const SAVE_EXAM_CLASS_NOTE = gql<
  { saveExamClassNote: ClassSyllabusT },
  { examId: string; classId: string; questionTypes: string[]; noteMd: string }
>`
  mutation SaveExamClassNote(
    $examId: String!
    $classId: String!
    $questionTypes: [String!]!
    $noteMd: String!
  ) {
    saveExamClassNote(
      examId: $examId
      classId: $classId
      questionTypes: $questionTypes
      noteMd: $noteMd
    ) { ${CLASS_SYLLABUS_FIELDS} }
  }
`;
