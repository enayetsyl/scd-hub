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
        pendingCount
      }
      totals {
        rows
        zeroRows
        gold
        rubricRows
      }
      brief
    }
  }
`;

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
  goldCount: number;
  pendingCount: number;
};

export type BankCoverage = {
  pairs: { classToken: string; subject: string; locked: boolean }[];
  classToken: string | null;
  subject: string | null;
  locked: boolean;
  chapters: { number: number; titleBn: string }[];
  rows: BankCoverageRow[];
  totals: { rows: number; zeroRows: number; gold: number; rubricRows: number };
  brief: string;
};
