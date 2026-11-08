/**
 * AI comment checker (AI-5, D-#1095) — mirror server/src/modules/platform/resolvers/commentCheck.ts.
 */
import { gql } from "urql";

export type CheckKindT = "DAILY" | "CT";

export interface CommentCheckIssueT {
  field: string;
  type: string;
  quote: string;
  suggestion: string;
}

export interface CommentCheckResultT {
  status: "CHECKED" | "NOT_CHECKED";
  reason: string | null;
  message: string | null;
  policyHash: string | null;
  model: string | null;
  issues: CommentCheckIssueT[];
  corrected: Array<{ field: string; text: string }>;
  token: string | null;
}

export const COMMENT_CHECK_AVAILABILITY = gql<{ commentCheckAvailability: { daily: boolean; ct: boolean } }, Record<string, never>>`
  query CommentCheckAvailability { commentCheckAvailability { daily ct } }
`;

export const CHECK_COMMENT = gql<
  { checkComment: CommentCheckResultT },
  {
    kind: CheckKindT;
    studentId: string;
    fields: Array<{ field: string; text: string }>;
    markPct?: number | null;
    commentType?: string | null;
    sentiment?: string | null;
  }
>`
  mutation CheckComment(
    $kind: String!, $studentId: String!, $fields: [CommentCheckFieldInput!]!,
    $markPct: Float, $commentType: String, $sentiment: String
  ) {
    checkComment(kind: $kind, studentId: $studentId, fields: $fields, markPct: $markPct, commentType: $commentType, sentiment: $sentiment) {
      status reason message policyHash model token
      issues { field type quote suggestion }
      corrected { field text }
    }
  }
`;

/** What the save mutations accept (all optional). */
export interface AiCheckClaimT {
  aiCheckToken?: string | null;
  aiIssuesAccepted?: number | null;
  aiTeacherOverrode?: boolean | null;
}
