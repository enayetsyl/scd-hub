/**
 * Cross-tracker whole picture (staff) + the guardian trajectory summary.
 * The guardian shape deliberately carries no rank and no peer comparison.
 */
import { gql } from "urql";

export interface HomeworkPictureT {
  total: number;
  open: number;
  done: number;
  chased: number;
  completionPct: number | null;
}
export interface AssignmentPictureT {
  total: number;
  pending: number;
  late: number;
  avgMarksPct: number | null;
}
export interface AttendancePictureT {
  markedDays: number;
  absentDays: number;
  presentPct: number;
  recentPresentPct: number | null;
  earlierPresentPct: number | null;
  trajectory: string;
}
export interface WholePictureT {
  studentId: string;
  studentName: string;
  fromKey: string;
  toKey: string;
  classTest: {
    examsPresent: number;
    avgPercent: number | null;
    trajectory: string;
    atRisk: boolean;
    weakestSubject: string | null;
  };
  homework: HomeworkPictureT;
  assignment: AssignmentPictureT;
  attendance: AttendancePictureT;
  signals: string[];
  overall: string;
}

export const STUDENT_WHOLE_PICTURE_QUERY = gql<
  { studentWholePicture: WholePictureT },
  { studentId: string }
>`
  query StudentWholePicture($studentId: String!) {
    studentWholePicture(studentId: $studentId) {
      studentId studentName fromKey toKey
      classTest { examsPresent avgPercent trajectory atRisk weakestSubject }
      homework { total open done chased completionPct }
      assignment { total pending late avgMarksPct }
      attendance { markedDays absentDays presentPct recentPresentPct earlierPresentPct trajectory }
      signals
      overall
    }
  }
`;

export interface GuardianTrajectoryT {
  studentId: string;
  overall: string;
  linesBn: string[];
  linesEn: string[];
  presentPct: number;
  avgPercent: number | null;
}

export const CHILD_TRAJECTORY_QUERY = gql<
  { childTrajectory: GuardianTrajectoryT },
  { studentId: string }
>`
  query ChildTrajectory($studentId: String!) {
    childTrajectory(studentId: $studentId) {
      studentId overall linesBn linesEn presentPct avgPercent
    }
  }
`;
