/**
 * AL-13 (docs/prd-academic-loop-2027.md journey L): the loop-health page + the January readiness list.
 * Both reads are gated server-side on `reports:loop_health`; nothing here writes.
 */
import { gql } from "urql";

export type LoopRateT = { done: number; total: number; pct: number | null };

export type LoopHealthRowT = {
  key: string;
  kind: string;
  teacherId: string | null;
  teacherName: string | null;
  sectionId: string | null;
  className: string | null;
  sectionName: string | null;
  subject: string | null;
  periods: LoopRateT;
  papers: LoopRateT;
  ticks: LoopRateT;
  zeroNotJudged: boolean;
  classTests: LoopRateT;
  weakToImproving: number;
  weakToMastered: number;
  reteachOpened: number;
  reteachClosed: number;
  reteachBeforePct: number | null;
  reteachAfterPct: number | null;
};

export type LoopHealthPageT = {
  from: string;
  to: string;
  page: { total: number; page: number; pageSize: number; rows: LoopHealthRowT[] };
};

export type LoopCheckT = {
  key: string;
  state: string;
  have: number;
  need: number | null;
  hwWeeks: number | null;
  asctWeeks: number | null;
  usingDefault: boolean;
  emptyObjectives: { code: string; labelBn: string; share: string }[];
  hwEmptyCount: number;
  asctEmptyCount: number;
  hwUnderWeekCount: number;
  asctUnderWeekCount: number;
};

export type LoopReadinessRowT = { classToken: string; subject: string; ready: boolean; checks: LoopCheckT[] };

export type LoopReadinessT = {
  yearId: string | null;
  yearLabel: string | null;
  yearCurrent: boolean;
  switchOn: boolean;
  totalPairs: number;
  readyPairs: number;
  lowStock: { classToken: string; subject: string; hwWeeks: number | null; asctWeeks: number | null; gold: number }[];
  rows: { total: number; page: number; pageSize: number; rows: LoopReadinessRowT[] };
};

export const LOOP_HEALTH_YEARS = gql`
  query LoopHealthYears {
    loopHealthYears {
      id
      label
      current
    }
  }
`;

const RATE = "done total pct";

export const LOOP_HEALTH_PAGE = gql`
  query LoopHealthPage($kind: String!, $from: String, $to: String, $page: Int, $pageSize: Int) {
    loopHealthPage(kind: $kind, from: $from, to: $to, page: $page, pageSize: $pageSize) {
      from
      to
      page {
        total
        page
        pageSize
        rows {
          key
          kind
          teacherId
          teacherName
          sectionId
          className
          sectionName
          subject
          periods { ${RATE} }
          papers { ${RATE} }
          ticks { ${RATE} }
          zeroNotJudged
          classTests { ${RATE} }
          weakToImproving
          weakToMastered
          reteachOpened
          reteachClosed
          reteachBeforePct
          reteachAfterPct
        }
      }
    }
  }
`;

export const LOOP_READINESS = gql`
  query LoopReadiness($academicYearId: String, $onlyRed: Boolean, $page: Int, $pageSize: Int) {
    loopReadiness(academicYearId: $academicYearId, onlyRed: $onlyRed, page: $page, pageSize: $pageSize) {
      yearId
      yearLabel
      yearCurrent
      switchOn
      totalPairs
      readyPairs
      lowStock {
        classToken
        subject
        hwWeeks
        asctWeeks
        gold
      }
      rows {
        total
        page
        pageSize
        rows {
          classToken
          subject
          ready
          checks {
            key
            state
            have
            need
            hwWeeks
            asctWeeks
            usingDefault
            emptyObjectives {
              code
              labelBn
              share
            }
            hwEmptyCount
            asctEmptyCount
            hwUnderWeekCount
            asctUnderWeekCount
          }
        }
      }
    }
  }
`;
