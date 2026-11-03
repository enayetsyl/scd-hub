/**
 * Typed GraphQL operation for "What moves the marks" (D-#905). Hand-authored to mirror
 * `server/src/modules/reports/resolvers/marksDrivers.ts` exactly. Gated
 * `reports:marks_drivers` server-side (Principal by default).
 *
 * Fractions (attendance, submission) are 0–1; results and marks are percentage points.
 */
import { gql } from "urql";

export type MarksDriversWindowT = "d30" | "d90" | "year";
export type MeasureKeyT = "hwQual" | "asQual" | "hwDone" | "asDone" | "att";

export interface MarksDriversT {
  window: MarksDriversWindowT;
  fromKey: string;
  toKey: string;
  computedAt: string;
  students: number;
  withResult: number;
  testsPrinted: number;
  papersMarked: number;
  homeworkRecords: number;
  assignmentRecords: number;
  medianMarkedDays: number;
  attMedian: number | null;
  /** Attendance × homework absent-redeliver share: about −0.95 when attendance was read right. */
  sanityR: number | null;
  longAbsent: number;
  absenceDays: number;
  correlations: Array<{ key: MeasureKeyT; n: number; r: number | null; p: number | null; significant: boolean }>;
  tertiles: Array<{ key: "hwDone" | "asDone" | "att"; bottom: number | null; middle: number | null; top: number | null; n: number }>;
  bands: Array<{ lo: number; hi: number; n: number; meanResult: number | null }>;
  below85: {
    nBelow: number;
    nAbove: number;
    below: number | null;
    above: number | null;
    p: number | null;
    hwBelow: number | null;
    hwAbove: number | null;
    controlledGap: number | null;
  };
  levels: Array<{
    level: number;
    n: number;
    att: number | null;
    hwDone: number | null;
    asDone: number | null;
    result: number | null;
    rAtt: number | null;
    rHw: number | null;
  }>;
  senior: { n: number; r: number | null; p: number | null };
  effects: Array<{ key: MeasureKeyT; marks: number }>;
  points: Array<{ level: number; att: number | null; hwDone: number | null; result: number }>;
  /** D-#910: the headline figures again without long-absent children and extreme values. */
  withoutOutliers: {
    longAbsent: number;
    extreme: number;
    withResult: number;
    correlations: MarksDriversT["correlations"];
    tertiles: MarksDriversT["tertiles"];
    below85: MarksDriversT["below85"];
    senior: MarksDriversT["senior"];
  };
}

export const MARKS_DRIVERS_QUERY = gql<
  { marksDrivers: MarksDriversT },
  { window: MarksDriversWindowT; refresh?: boolean | null }
>`
  query MarksDrivers($window: String!, $refresh: Boolean) {
    marksDrivers(window: $window, refresh: $refresh) {
      window fromKey toKey computedAt
      students withResult testsPrinted papersMarked homeworkRecords assignmentRecords medianMarkedDays
      attMedian sanityR longAbsent absenceDays
      correlations { key n r p significant }
      tertiles { key bottom middle top n }
      bands { lo hi n meanResult }
      below85 { nBelow nAbove below above p hwBelow hwAbove controlledGap }
      levels { level n att hwDone asDone result rAtt rHw }
      senior { n r p }
      effects { key marks }
      points { level att hwDone result }
      withoutOutliers {
        longAbsent extreme withResult
        correlations { key n r p significant }
        tertiles { key bottom middle top n }
        below85 { nBelow nAbove below above p hwBelow hwAbove controlledGap }
        senior { n r p }
      }
    }
  }
`;
