/**
 * Reviewer hub (H-1, .claude/plans/review-hub-and-quality.md) — `myReviewHub`: every review the
 * caller still owes, in one read. The server shows each section only when the caller holds that
 * review's permission, so the query is safe to ask for any signed-in staff member.
 */
import { gql } from "urql";

export interface ReviewHubRowT {
  key: string;
  /** PLAN | QUESTION | EXAM_PAPER | SYLLABUS | MASTERY | OBSERVATION | VIDEO | CT_QUESTION | BOOK | WINTER | TASK */
  kind: string;
  titleBn: string;
  left: number;
  total: number;
  /** YYYY-MM-DD, or null. */
  dueKey: string | null;
  /** Tab + screen of the existing review screen the row opens. */
  tab: string;
  screen: string;
  /** JSON of the screen's params, or null. */
  paramsJson: string | null;
}

export interface ReviewHubT {
  rows: ReviewHubRowT[];
  totalLeft: number;
}

export const MY_REVIEW_HUB = gql<{ myReviewHub: ReviewHubT }, Record<string, never>>`
  query MyReviewHub {
    myReviewHub {
      totalLeft
      rows { key kind titleBn left total dueKey tab screen paramsJson }
    }
  }
`;
