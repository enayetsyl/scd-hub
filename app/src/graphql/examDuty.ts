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

export const EXAM_DUTY_ROSTER = gql<{ examDutyRoster: ExamDutyRosterT }, { examId: string }>`
  query ExamDutyRoster($examId: String!) {
    examDutyRoster(examId: $examId) {
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

export const EXAM_DUTY_CANDIDATES = gql<{ examDutyCandidates: { userId: string; name: string }[] }>`
  query ExamDutyCandidates { examDutyCandidates { userId name } }
`;

export const MY_EXAM_DUTIES = gql<{ myExamDuties: MyExamDutyT[] }>`
  query MyExamDuties { myExamDuties { id examId examName dateKey subject kind classLabelBn start end room } }
`;

export const ASSIGN_EXAM_DUTY = gql<
  { assignExamDuty: ExamDutyT },
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
  mutation AssignExamDuty(
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
    assignExamDuty(
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

export const CLEAR_EXAM_DUTY = gql<{ clearExamDuty: boolean }, { dutyId: string; reason: string }>`
  mutation ClearExamDuty($dutyId: String!, $reason: String!) { clearExamDuty(dutyId: $dutyId, reason: $reason) }
`;
