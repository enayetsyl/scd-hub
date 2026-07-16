/**
 * Teacher class-load report (D-#327) — typed ops over the routine `teacherClassLoad`
 * query. Own module (mirrors observation.ts) to keep operations.ts lean.
 */
import { gql } from "urql";

export interface ClassLoadWeekdayT {
  dayOfWeek: string;
  count: number;
}
export interface ClassLoadSlotT {
  dayOfWeek: string;
  periodNumber: number;
  subject: string;
  track: string;
  groupName: string | null;
  startTime: string | null;
  endTime: string | null;
}
export interface TeacherClassLoadT {
  teacherId: string;
  teacherName: string;
  perWeekday: ClassLoadWeekdayT[];
  weekTotal: number;
  monthKey: string;
  monthTotal: number;
  monthTeachingDays: number;
  slots: ClassLoadSlotT[];
}

export const TEACHER_CLASS_LOAD = gql<
  { teacherClassLoad: TeacherClassLoadT[] },
  { month: string; teacherId?: string | null }
>`
  query TeacherClassLoad($month: String!, $teacherId: String) {
    teacherClassLoad(month: $month, teacherId: $teacherId) {
      teacherId
      teacherName
      weekTotal
      monthKey
      monthTotal
      monthTeachingDays
      perWeekday {
        dayOfWeek
        count
      }
      slots {
        dayOfWeek
        periodNumber
        subject
        track
        groupName
        startTime
        endTime
      }
    }
  }
`;
