/**
 * Assignment gift & streak operations (AG-3, D-#479–#483).
 * - ASSIGNMENT_GIFT_REPORT: derived weekly winners + rolling streaks (tracker:read).
 * - RECORD_GIFT_HANDOVER / UNDO_GIFT_HANDOVER: the physical handover ledger —
 *   the server re-derives entitlement, so a tick can never mint a gift.
 */
import { gql } from "urql";

export interface GiftMissedItemT {
  asId: string;
  subject: string;
  state: string;
  lateSubmission: boolean;
}

export type GiftWeekStatusT = "WON" | "QUALIFIED" | "PENDING" | "LOST";

export interface GiftWeekT {
  weekNumber: number;
  dueDate: string | null;
  settled: boolean;
  status: GiftWeekStatusT;
  issued: number;
  onTime: number;
  outstanding: number;
  won: boolean;
  provisional: boolean;
  missed: GiftMissedItemT[];
}

export interface GiftAwardT {
  id: string;
  kind: string;
  weekNumber: number;
  streakLength: number | null;
  handedOverAt: string;
  handedOverBy: string;
  handedOverByName: string | null;
  note: string | null;
  entitlementHolds: boolean;
}

export interface GiftStudentRowT {
  studentId: string;
  studentName: string;
  schoolId: string;
  rollNumber: string | null;
  classId: string;
  sectionId: string;
  weeks: GiftWeekT[];
  wonWeeks: number[];
  pendingWeeks: number[];
  currentStreak: number;
  bestStreak: number;
  streakMilestoneWeeks: number[];
  awards: GiftAwardT[];
}

export interface AssignmentGiftReportT {
  academicYearId: string;
  weekFrom: number;
  weekTo: number;
  streakBlock: number;
  weekDueDates: Array<{ weekNumber: number; dueDate: string | null; settled: boolean }>;
  students: GiftStudentRowT[];
}

export const ASSIGNMENT_GIFT_REPORT = gql<
  { assignmentGiftReport: AssignmentGiftReportT },
  {
    academicYearId: string;
    weekFrom?: number | null;
    weekTo?: number | null;
    classId?: string | null;
    sectionId?: string | null;
  }
>`
  query AssignmentGiftReport(
    $academicYearId: String!
    $weekFrom: Int
    $weekTo: Int
    $classId: String
    $sectionId: String
  ) {
    assignmentGiftReport(
      academicYearId: $academicYearId
      weekFrom: $weekFrom
      weekTo: $weekTo
      classId: $classId
      sectionId: $sectionId
    ) {
      academicYearId
      weekFrom
      weekTo
      streakBlock
      weekDueDates {
        weekNumber
        dueDate
        settled
      }
      students {
        studentId
        studentName
        schoolId
        rollNumber
        classId
        sectionId
        weeks {
          weekNumber
          dueDate
          settled
          status
          issued
          onTime
          outstanding
          won
          provisional
          missed {
            asId
            subject
            state
            lateSubmission
          }
        }
        wonWeeks
        pendingWeeks
        currentStreak
        bestStreak
        streakMilestoneWeeks
        awards {
          id
          kind
          weekNumber
          streakLength
          handedOverAt
          handedOverBy
          handedOverByName
          note
          entitlementHolds
        }
      }
    }
  }
`;

export const RECORD_GIFT_HANDOVER = gql<
  { recordGiftHandover: GiftAwardT },
  {
    academicYearId: string;
    studentId: string;
    kind: string;
    weekNumber: number;
    note?: string | null;
  }
>`
  mutation RecordGiftHandover(
    $academicYearId: String!
    $studentId: String!
    $kind: String!
    $weekNumber: Int!
    $note: String
  ) {
    recordGiftHandover(
      academicYearId: $academicYearId
      studentId: $studentId
      kind: $kind
      weekNumber: $weekNumber
      note: $note
    ) {
      id
      kind
      weekNumber
      streakLength
      handedOverAt
      handedOverBy
      handedOverByName
      note
      entitlementHolds
    }
  }
`;

export const UNDO_GIFT_HANDOVER = gql<
  { undoGiftHandover: boolean },
  { academicYearId: string; studentId: string; kind: string; weekNumber: number }
>`
  mutation UndoGiftHandover(
    $academicYearId: String!
    $studentId: String!
    $kind: String!
    $weekNumber: Int!
  ) {
    undoGiftHandover(
      academicYearId: $academicYearId
      studentId: $studentId
      kind: $kind
      weekNumber: $weekNumber
    )
  }
`;
