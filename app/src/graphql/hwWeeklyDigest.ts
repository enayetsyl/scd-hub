/**
 * Weekly unsubmitted-homework report documents (D-#453) — the staff twin of the
 * Thursday guardian digest. Validated against the real schema by the
 * graphqlDocuments gate (the app has no codegen).
 */

export interface HwWeeklyUnsubmittedItemT {
  hwItemId: string;
  hwId: string;
  subject: string;
  subjectLabelBn: string;
  dateKey: string;
  description: string | null;
  state: string;
  stateLabelBn: string;
  chaseCount: number;
  dueDateKey: string | null;
}

export interface HwWeeklyHeadsUpItemT {
  hwItemId: string;
  hwId: string;
  subject: string;
  subjectLabelBn: string;
  description: string | null;
  qCount: number;
  timeDecl: number;
  dueDateKey: string | null;
}

export interface HwWeeklyStudentRowT {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  sectionId: string;
  sectionNameBn: string | null;
  classLevel: number;
  guardianPhone: string | null;
  waLink: string | null;
  messageBn: string;
  unsubmitted: HwWeeklyUnsubmittedItemT[];
  headsUp: HwWeeklyHeadsUpItemT[];
}

export interface HwWeeklyUnsubmittedReportT {
  weekStartKey: string;
  unsubFromKey: string;
  unsubToKey: string;
  headsUpKey: string;
  students: HwWeeklyStudentRowT[];
}

export const HOMEWORK_WEEKLY_UNSUBMITTED_QUERY = /* GraphQL */ `
  query HomeworkWeeklyUnsubmitted($weekStart: String, $sectionId: String, $classLevel: Int) {
    homeworkWeeklyUnsubmitted(weekStart: $weekStart, sectionId: $sectionId, classLevel: $classLevel) {
      weekStartKey
      unsubFromKey
      unsubToKey
      headsUpKey
      students {
        studentId
        name
        nameBn
        rollNumber
        sectionId
        sectionNameBn
        classLevel
        guardianPhone
        waLink
        messageBn
        unsubmitted {
          hwItemId
          hwId
          subject
          subjectLabelBn
          dateKey
          description
          state
          stateLabelBn
          chaseCount
          dueDateKey
        }
        headsUp {
          hwItemId
          hwId
          subject
          subjectLabelBn
          description
          qCount
          timeDecl
          dueDateKey
        }
      }
    }
  }
`;
