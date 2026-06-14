/**
 * Typed GraphQL operations for the Student-Comments + Parents-Meeting module (CM-6
 * app surfaces over the merged CM-1..CM-5 resolvers). Hand-authored to mirror the
 * server resolvers (server/src/modules/comments/resolvers/*.ts) exactly — no server
 * change. Kept in its own module to avoid bloating the 4.7k-line operations.ts.
 *
 * Server convention: ISO timestamps/dates are String; minutes are Int.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

// ---------------------------------------------------------------------------
// Daily student comments (CM-1)
// ---------------------------------------------------------------------------

export interface StudentCommentT {
  id: string;
  studentId: string;
  sectionId: string;
  authorUserId: string;
  type: string;
  sentiment: string;
  text: string;
  attachmentIds: string[];
  deliveredAt: string | null;
  deliveryChannels: string[];
  createdAt: string;
  updatedAt: string;
}

const STUDENT_COMMENT_FIELDS = `id studentId sectionId authorUserId type sentiment text attachmentIds deliveredAt deliveryChannels createdAt updatedAt`;

export const SECTION_STUDENT_COMMENTS_QUERY = gql<
  { sectionStudentComments: StudentCommentT[] },
  { sectionId: string }
>`
  query SectionStudentComments($sectionId: String!) {
    sectionStudentComments(sectionId: $sectionId) { ${STUDENT_COMMENT_FIELDS} }
  }
`;

export const STUDENT_COMMENTS_QUERY = gql<
  { studentComments: StudentCommentT[] },
  { studentId: string }
>`
  query StudentComments($studentId: String!) {
    studentComments(studentId: $studentId) { ${STUDENT_COMMENT_FIELDS} }
  }
`;

export const RECORD_STUDENT_COMMENT = gql<
  { recordStudentComment: StudentCommentT },
  {
    studentId: string;
    type: string;
    sentiment: string;
    text: string;
    attachmentIds?: string[] | null;
  }
>`
  mutation RecordStudentComment(
    $studentId: String!, $type: String!, $sentiment: String!, $text: String!, $attachmentIds: [String!]
  ) {
    recordStudentComment(
      studentId: $studentId, type: $type, sentiment: $sentiment, text: $text, attachmentIds: $attachmentIds
    ) { ${STUDENT_COMMENT_FIELDS} }
  }
`;

export const EDIT_STUDENT_COMMENT = gql<
  { editStudentComment: StudentCommentT },
  {
    commentId: string;
    type?: string | null;
    sentiment?: string | null;
    text?: string | null;
    attachmentIds?: string[] | null;
  }
>`
  mutation EditStudentComment(
    $commentId: String!, $type: String, $sentiment: String, $text: String, $attachmentIds: [String!]
  ) {
    editStudentComment(
      commentId: $commentId, type: $type, sentiment: $sentiment, text: $text, attachmentIds: $attachmentIds
    ) { ${STUDENT_COMMENT_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// Comment delivery (CM-2)
// ---------------------------------------------------------------------------

export interface CommentDeliveryOutcomeT {
  commentId: string;
  studentId: string;
  studentName: string;
  messageBn: string;
  waLink: string | null;
  unreachableByWa: boolean;
  notifiedGuardianIds: string[];
  deliveryChannels: string[];
  deliveredAt: string;
}

export const DELIVER_STUDENT_COMMENT = gql<
  { deliverStudentComment: CommentDeliveryOutcomeT },
  { commentId: string }
>`
  mutation DeliverStudentComment($commentId: String!) {
    deliverStudentComment(commentId: $commentId) {
      commentId studentId studentName messageBn waLink unreachableByWa notifiedGuardianIds deliveryChannels deliveredAt
    }
  }
`;

// ---------------------------------------------------------------------------
// Parent meeting + per-family slots (CM-3)
// ---------------------------------------------------------------------------

export interface ParentMeetingT {
  id: string;
  academicYearId: string;
  instanceLabel: string;
  meetingDate: string;
  slotMinutes: number;
  dayStartMinutes: number;
  status: string;
  includeClassIds: string[];
  includeSectionIds: string[];
  createdAt: string;
  updatedAt: string;
}

const PARENT_MEETING_FIELDS = `id academicYearId instanceLabel meetingDate slotMinutes dayStartMinutes status includeClassIds includeSectionIds createdAt updatedAt`;

export interface ParentMeetingSlotT {
  id: string;
  meetingId: string;
  familyKey: string;
  studentIds: string[];
  classLabels: string[];
  order: number;
  slotTime: number | null;
  onCall: boolean;
  dispatchedAt: string | null;
  attended: boolean | null;
  attendanceRemark: string | null;
  createdAt: string;
  updatedAt: string;
}

const PARENT_MEETING_SLOT_FIELDS = `id meetingId familyKey studentIds classLabels order slotTime onCall dispatchedAt attended attendanceRemark createdAt updatedAt`;

export const PARENT_MEETINGS_QUERY = gql<
  { parentMeetings: ParentMeetingT[] },
  { academicYearId?: string | null }
>`
  query ParentMeetings($academicYearId: String) {
    parentMeetings(academicYearId: $academicYearId) { ${PARENT_MEETING_FIELDS} }
  }
`;

export const PARENT_MEETING_QUERY = gql<
  { parentMeeting: ParentMeetingT | null },
  { meetingId: string }
>`
  query ParentMeeting($meetingId: String!) {
    parentMeeting(meetingId: $meetingId) { ${PARENT_MEETING_FIELDS} }
  }
`;

export const PARENT_MEETING_SLOTS_QUERY = gql<
  { parentMeetingSlots: ParentMeetingSlotT[] },
  { meetingId: string }
>`
  query ParentMeetingSlots($meetingId: String!) {
    parentMeetingSlots(meetingId: $meetingId) { ${PARENT_MEETING_SLOT_FIELDS} }
  }
`;

export const CREATE_PARENT_MEETING = gql<
  { createParentMeeting: ParentMeetingT },
  {
    instanceLabel: string;
    meetingDate: string;
    slotMinutes: number;
    dayStartMinutes: number;
    academicYearId?: string | null;
    includeClassIds?: string[] | null;
    includeSectionIds?: string[] | null;
  }
>`
  mutation CreateParentMeeting(
    $instanceLabel: String!, $meetingDate: String!, $slotMinutes: Int!, $dayStartMinutes: Int!,
    $academicYearId: String, $includeClassIds: [String!], $includeSectionIds: [String!]
  ) {
    createParentMeeting(
      instanceLabel: $instanceLabel, meetingDate: $meetingDate, slotMinutes: $slotMinutes,
      dayStartMinutes: $dayStartMinutes, academicYearId: $academicYearId,
      includeClassIds: $includeClassIds, includeSectionIds: $includeSectionIds
    ) { ${PARENT_MEETING_FIELDS} }
  }
`;

export interface GenerateSlotsResultT {
  meetingId: string;
  slots: ParentMeetingSlotT[];
  familyCount: number;
  reachableCount: number;
  unreachableCount: number;
}

export const GENERATE_MEETING_SLOTS = gql<
  { generateMeetingSlots: GenerateSlotsResultT },
  { meetingId: string }
>`
  mutation GenerateMeetingSlots($meetingId: String!) {
    generateMeetingSlots(meetingId: $meetingId) {
      meetingId familyCount reachableCount unreachableCount
      slots { ${PARENT_MEETING_SLOT_FIELDS} }
    }
  }
`;

export const SET_MEETING_SLOT_ON_CALL = gql<
  { setMeetingSlotOnCall: ParentMeetingSlotT[] },
  { slotId: string; onCall: boolean }
>`
  mutation SetMeetingSlotOnCall($slotId: String!, $onCall: Boolean!) {
    setMeetingSlotOnCall(slotId: $slotId, onCall: $onCall) { ${PARENT_MEETING_SLOT_FIELDS} }
  }
`;

export const REORDER_MEETING_SLOTS = gql<
  { reorderMeetingSlots: ParentMeetingSlotT[] },
  { meetingId: string; slotIds: string[] }
>`
  mutation ReorderMeetingSlots($meetingId: String!, $slotIds: [String!]!) {
    reorderMeetingSlots(meetingId: $meetingId, slotIds: $slotIds) { ${PARENT_MEETING_SLOT_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// Meeting dispatch + attendance (CM-4)
// ---------------------------------------------------------------------------

export interface MeetingDispatchOutcomeT {
  slotId: string;
  familyKey: string;
  slotTime: number | null;
  onCall: boolean;
  messageBn: string;
  waLink: string | null;
  unreachableByWa: boolean;
  notifiedGuardianIds: string[];
  dispatchedAt: string;
}

export interface MeetingDispatchResultT {
  meetingId: string;
  status: string;
  slotCount: number;
  reachableCount: number;
  unreachableCount: number;
  notifiedCount: number;
  outcomes: MeetingDispatchOutcomeT[];
}

export const DISPATCH_MEETING_SCHEDULE = gql<
  { dispatchMeetingSchedule: MeetingDispatchResultT },
  { meetingId: string }
>`
  mutation DispatchMeetingSchedule($meetingId: String!) {
    dispatchMeetingSchedule(meetingId: $meetingId) {
      meetingId status slotCount reachableCount unreachableCount notifiedCount
      outcomes {
        slotId familyKey slotTime onCall messageBn waLink unreachableByWa notifiedGuardianIds dispatchedAt
      }
    }
  }
`;

export interface MeetingSlotAttendanceT {
  id: string;
  meetingId: string;
  familyKey: string;
  onCall: boolean;
  slotTime: number | null;
  dispatchedAt: string | null;
  attended: boolean | null;
  attendanceRemark: string | null;
}

export const SET_MEETING_SLOT_ATTENDANCE = gql<
  { setMeetingSlotAttendance: MeetingSlotAttendanceT },
  { slotId: string; attended: boolean; remark?: string | null }
>`
  mutation SetMeetingSlotAttendance($slotId: String!, $attended: Boolean!, $remark: String) {
    setMeetingSlotAttendance(slotId: $slotId, attended: $attended, remark: $remark) {
      id meetingId familyKey onCall slotTime dispatchedAt attended attendanceRemark
    }
  }
`;

export interface MeetingAttendanceSummaryT {
  meetingId: string;
  total: number;
  present: number;
  absent: number;
  pending: number;
  onCall: number;
  dispatched: number;
  reachable: number;
  unreachable: number;
}

export const MEETING_ATTENDANCE_SUMMARY_QUERY = gql<
  { meetingAttendanceSummary: MeetingAttendanceSummaryT },
  { meetingId: string }
>`
  query MeetingAttendanceSummary($meetingId: String!) {
    meetingAttendanceSummary(meetingId: $meetingId) {
      meetingId total present absent pending onCall dispatched reachable unreachable
    }
  }
`;

// ---------------------------------------------------------------------------
// Meeting comment + comparison timeline (CM-5)
// ---------------------------------------------------------------------------

export interface MeetingCommentEntryT {
  id: string;
  meetingId: string;
  instanceLabel: string;
  meetingDate: string;
  studentId: string;
  authorUserId: string;
  positiveText: string;
  concernText: string;
  createdAt: string;
  updatedAt: string;
}

const MEETING_COMMENT_FIELDS = `id meetingId instanceLabel meetingDate studentId authorUserId positiveText concernText createdAt updatedAt`;

export interface CommentTypeCountT {
  type: string;
  count: number;
}

export const SAVE_MEETING_COMMENT = gql<
  { saveMeetingComment: MeetingCommentEntryT },
  { meetingId: string; studentId: string; positiveText?: string | null; concernText?: string | null }
>`
  mutation SaveMeetingComment(
    $meetingId: String!, $studentId: String!, $positiveText: String, $concernText: String
  ) {
    saveMeetingComment(
      meetingId: $meetingId, studentId: $studentId, positiveText: $positiveText, concernText: $concernText
    ) { ${MEETING_COMMENT_FIELDS} }
  }
`;

export interface StudentCommentTimelineT {
  studentId: string;
  meetingComments: MeetingCommentEntryT[];
  rollupSinceLastMeeting: CommentTypeCountT[];
  sinceMeetingId: string | null;
  sinceMeetingDate: string | null;
}

export const STUDENT_COMMENT_TIMELINE_QUERY = gql<
  { studentCommentTimeline: StudentCommentTimelineT },
  { studentId: string }
>`
  query StudentCommentTimeline($studentId: String!) {
    studentCommentTimeline(studentId: $studentId) {
      studentId sinceMeetingId sinceMeetingDate
      meetingComments { ${MEETING_COMMENT_FIELDS} }
      rollupSinceLastMeeting { type count }
    }
  }
`;

export interface MeetingComparisonT {
  meetingId: string;
  instanceLabel: string;
  meetingDate: string;
  studentId: string;
  current: MeetingCommentEntryT | null;
  prior: MeetingCommentEntryT[];
  rollupSincePrevious: CommentTypeCountT[];
  previousMeetingId: string | null;
  previousMeetingDate: string | null;
}

export const MEETING_COMPARISON_QUERY = gql<
  { meetingComparison: MeetingComparisonT },
  { meetingId: string; studentId: string }
>`
  query MeetingComparison($meetingId: String!, $studentId: String!) {
    meetingComparison(meetingId: $meetingId, studentId: $studentId) {
      meetingId instanceLabel meetingDate studentId previousMeetingId previousMeetingDate
      current { ${MEETING_COMMENT_FIELDS} }
      prior { ${MEETING_COMMENT_FIELDS} }
      rollupSincePrevious { type count }
    }
  }
`;

// ---------------------------------------------------------------------------
// Guardian child read (CM-5) — delivered daily comments only
// ---------------------------------------------------------------------------

export interface GuardianStudentCommentT {
  id: string;
  type: string;
  sentiment: string;
  text: string;
  attachmentIds: string[];
  deliveredAt: string | null;
  createdAt: string;
}

export const CHILD_COMMENTS_QUERY = gql<
  { childComments: GuardianStudentCommentT[] },
  { studentId: string }
>`
  query ChildComments($studentId: String!) {
    childComments(studentId: $studentId) {
      id type sentiment text attachmentIds deliveredAt createdAt
    }
  }
`;
