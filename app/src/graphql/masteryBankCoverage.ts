/**
 * Question-bank coverage (prd-objective-tree §8.2, mock 5; OT-4). Gated server-side on the
 * Reports-hub switch `reports:bank_coverage`, or `mastery:settings` / `mastery:review`.
 */
import { gql } from "urql";

export const MASTERY_BANK_COVERAGE_QUERY = gql`
  query MasteryBankCoverage($classToken: String, $subject: String) {
    masteryBankCoverage(classToken: $classToken, subject: $subject) {
      pairs {
        classToken
        subject
        locked
      }
      classToken
      subject
      locked
      chapters {
        number
        titleBn
      }
      rows {
        code
        labelBn
        level
        parentCode
        parentLabelBn
        chapterNumber
        strand
        status
        questionTypeCodes
        exercises
        goldCount
        heldCount
        pendingCount
        cells {
          typeCode
          goldCount
          pendingCount
          heldCount
          zero
          noMarks
        }
      }
      totals {
        rows
        zeroRows
        gold
        held
        rubricRows
      }
      brief
      typeCsv
      noMarksTypes
    }
  }
`;

/** PR-G: one objective × school-question-type cell; typeCode null = questions carrying no type. */
export type BankCoverageCell = { typeCode: string | null; goldCount: number; pendingCount: number; heldCount: number; zero: boolean; noMarks: boolean };

export type BankCoverageRow = {
  code: string;
  labelBn: string;
  level: string;
  parentCode: string | null;
  parentLabelBn: string | null;
  chapterNumber: number | null;
  strand: string | null;
  status: string;
  questionTypeCodes: string[];
  exercises: string[];
  /** Usable gold (not held for the exam papers). */
  goldCount: number;
  /** Gold held for the exam papers (PR-I). */
  heldCount: number;
  pendingCount: number;
  cells: BankCoverageCell[];
};

export type BankCoverage = {
  pairs: { classToken: string; subject: string; locked: boolean }[];
  classToken: string | null;
  subject: string | null;
  locked: boolean;
  chapters: { number: number; titleBn: string }[];
  rows: BankCoverageRow[];
  totals: { rows: number; zeroRows: number; gold: number; held: number; rubricRows: number };
  brief: string;
  /** PR-G: objective,type,gold,pending,held per cell, as CSV ("-" = no type). */
  typeCsv: string;
  /** PR-G: active types with no marks in the table. */
  noMarksTypes: string[];
};
