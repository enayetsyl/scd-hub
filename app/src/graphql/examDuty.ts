/**
 * Exam duty roster operations (D-#1660): who invigilates each sitting of the exam routine.
 */
import { gql } from "urql";

export type DutyConflictT = "OVERLAP" | "LEAVE" | "NO_SITTING";

export interface ExamDutyT {
  id: string;
  seat: number;
  teacherId: string;
  teacherName: string;
  room: string;
  conflicts: string[];
}

export interface ExamDutySittingT {
  classId: string;
  classLabelBn: string;
  level: number;
  dateKey: string;
  subject: string;
  kind: string;
  start: string;
  end: string;
  orphan: boolean;
  duties: ExamDutyT[];
}

export interface ExamDutyRosterT {
  examId: string;
  examName: string;
  sittings: ExamDutySittingT[];
  counts: { teacherId: string; teacherName: string; count: number }[];
  conflictCount: number;
  emptyCount: number;
}

export interface MyExamDutyT {
  id: string;
  examId: string;
  examName: string;
  dateKey: string;
  subject: string;
  kind: string;
  classLabelBn: string;
  start: string;
  end: string;
  room: string;
}

export const EXAM_DUTY_ROSTER = gql<{ sittingDutyRoster: ExamDutyRosterT }, { examId: string }>`
  query SittingDutyRoster($examId: String!) {
    sittingDutyRoster(examId: $examId) {
      examId
      examName
      conflictCount
      emptyCount
      counts { teacherId teacherName count }
      sittings {
        classId classLabelBn level dateKey subject kind start end orphan
        duties { id seat teacherId teacherName room conflicts }
      }
    }
  }
`;

export const EXAM_DUTY_CANDIDATES = gql<{ sittingDutyCandidates: { userId: string; name: string }[] }>`
  query SittingDutyCandidates { sittingDutyCandidates { userId name } }
`;

export const MY_EXAM_DUTIES = gql<{ mySittingDuties: MyExamDutyT[] }>`
  query MySittingDuties { mySittingDuties { id examId examName dateKey subject kind classLabelBn start end room } }
`;

export const ASSIGN_EXAM_DUTY = gql<
  { assignSittingDuty: ExamDutyT },
  {
    examId: string;
    classId: string;
    dateKey: string;
    subject: string;
    kind: string;
    seat?: number | null;
    teacherId: string;
    room?: string | null;
    reason?: string | null;
  }
>`
  mutation AssignSittingDuty(
    $examId: String!
    $classId: String!
    $dateKey: String!
    $subject: String!
    $kind: String!
    $seat: Int
    $teacherId: String!
    $room: String
    $reason: String
  ) {
    assignSittingDuty(
      examId: $examId
      classId: $classId
      dateKey: $dateKey
      subject: $subject
      kind: $kind
      seat: $seat
      teacherId: $teacherId
      room: $room
      reason: $reason
    ) { id seat teacherId teacherName room conflicts }
  }
`;

export const CLEAR_EXAM_DUTY = gql<{ clearSittingDuty: boolean }, { dutyId: string; reason: string }>`
  mutation ClearSittingDuty($dutyId: String!, $reason: String!) { clearSittingDuty(dutyId: $dutyId, reason: $reason) }
`;
