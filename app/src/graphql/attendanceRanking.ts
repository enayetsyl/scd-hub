/**
 * Typed GraphQL operations for the attendance ranking (AR-2 over the AR-1
 * resolvers). Hand-authored to mirror
 * `server/src/modules/attendance/resolvers/attendanceRanking.ts` exactly.
 * Both queries are `attendance:manage`-gated server-side (Principal + Office).
 */
import { gql } from "urql";

export interface RankRowT {
  rank: number;
  id: string;
  name: string;
  unitLabel: string;
  heldDays: number;
  absentDays: number;
  presentPct: number;
  lateDays: number | null;
  leaveDays: number | null;
  belowFloor: boolean;
}

export interface RankingT {
  fromKey: string;
  toKey: string;
  unitCount: number;
  minHeldDays: number;
  /** The register's most recent marked day, window-independent — lets an empty
   *  ranking explain itself instead of reading as "nobody attended". */
  lastMarkedKey: string | null;
  rows: RankRowT[];
}

const RANKING_FIELDS = `
  fromKey toKey unitCount minHeldDays lastMarkedKey
  rows { rank id name unitLabel heldDays absentDays presentPct lateDays leaveDays belowFloor }
`;

export const STUDENT_ATTENDANCE_RANKING_QUERY = gql<
  { studentAttendanceRanking: RankingT },
  { window: string; anchorKey: string; axis: string; axisValue?: string | null }
>`
  query StudentAttendanceRanking($window: String!, $anchorKey: String!, $axis: String!, $axisValue: String) {
    studentAttendanceRanking(window: $window, anchorKey: $anchorKey, axis: $axis, axisValue: $axisValue) {
      ${RANKING_FIELDS}
    }
  }
`;

export const STAFF_ATTENDANCE_RANKING_QUERY = gql<
  { staffAttendanceRanking: RankingT },
  { window: string; anchorKey: string }
>`
  query StaffAttendanceRanking($window: String!, $anchorKey: String!) {
    staffAttendanceRanking(window: $window, anchorKey: $anchorKey) {
      ${RANKING_FIELDS}
    }
  }
`;
