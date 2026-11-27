/**
 * RF-1 / RF-2 (owner 25 Nov 2026) — the four folds of a reviewer's list, and change-after-final.
 * Mirrors server/src/modules/content/resolvers/{review,goldChange}.ts and
 * server/src/modules/questions/resolvers/questionReview.ts.
 */
import { gql } from "urql";
import { REVIEW_ASSIGNMENT_FIELDS, type ReviewAssignmentT } from "./operations";

/** undecided = no verdict yet; approved / changes = decided, waiting for the Principal; final = finalised. */
export type ReviewBucketKey = "undecided" | "approved" | "changes" | "final";

export interface ReviewBucketCountsT {
  undecided: number;
  approved: number;
  changes: number;
  final: number;
}

export const MY_QUESTION_REVIEW_BUCKETS = gql<
  { myQuestionReviewBuckets: ReviewBucketCountsT },
  {
    subject?: string | null;
    classLevel?: number | null;
    chapter?: number | null;
    anchorWord?: string | null;
    questionType?: string | null;
    qtCode?: string | null;
    search?: string | null;
    important?: boolean | null;
  }
>`
  query MyQuestionReviewBuckets($subject: String, $classLevel: Int, $chapter: Int, $anchorWord: String,
    $questionType: String, $qtCode: String, $search: String, $important: Boolean) {
    myQuestionReviewBuckets(subject: $subject, classLevel: $classLevel, chapter: $chapter, anchorWord: $anchorWord,
      questionType: $questionType, qtCode: $qtCode, search: $search, important: $important) {
      undecided approved changes final
    }
  }
`;

export interface PlanBucketVars {
  subject?: string | null;
  classLevel?: number | null;
  chapter?: string | null;
  docType?: string | null;
  search?: string | null;
}

export const MY_PLAN_REVIEW_BUCKETS = gql<{ myPlanReviewBuckets: ReviewBucketCountsT }, PlanBucketVars>`
  query MyPlanReviewBuckets($subject: String, $classLevel: Int, $chapter: String, $docType: String, $search: String) {
    myPlanReviewBuckets(subject: $subject, classLevel: $classLevel, chapter: $chapter, docType: $docType, search: $search) {
      undecided approved changes final
    }
  }
`;

export const MY_REVIEW_ASSIGNMENTS_BUCKET = gql<
  { myReviewAssignmentsBucket: ReviewAssignmentT[] },
  PlanBucketVars & { bucket: string; limit?: number | null; offset?: number | null }
>`
  query MyReviewAssignmentsBucket($bucket: String!, $subject: String, $classLevel: Int, $chapter: String,
    $docType: String, $search: String, $limit: Int, $offset: Int) {
    myReviewAssignmentsBucket(bucket: $bucket, subject: $subject, classLevel: $classLevel, chapter: $chapter,
      docType: $docType, search: $search, limit: $limit, offset: $offset) {
      ${REVIEW_ASSIGNMENT_FIELDS} title artifactReviewStatus
    }
  }
`;

// ---- RF-2: change after final ------------------------------------------------------------

export interface GoldChangeRequestT {
  id: string;
  artifactId: string;
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  qid: string | null;
  sessionIndex: number | null;
  reviewerId: string;
  reviewerName: string | null;
  comment: string;
  proposalJson: string | null;
  /** OPEN | APPROVED | REJECTED */
  status: string;
  decidedByName: string | null;
  decidedAt: string | null;
  note: string | null;
  createdAt: string;
  title: string | null;
  questionText: string | null;
  payloadJson: string | null;
  artifactReviewStatus: string | null;
}

const GOLD_CHANGE_FIELDS = `
  id artifactId docType subject classLevel anchorWord addressNumber qid sessionIndex
  reviewerId reviewerName comment proposalJson status decidedByName decidedAt note createdAt
  title questionText payloadJson artifactReviewStatus
`;

export const GOLD_CHANGE_REQUESTS = gql<{ goldChangeRequests: GoldChangeRequestT[] }, { status?: string | null }>`
  query GoldChangeRequests($status: String) {
    goldChangeRequests(status: $status) { ${GOLD_CHANGE_FIELDS} }
  }
`;

export const MY_GOLD_CHANGE_REQUESTS = gql<{ myGoldChangeRequests: GoldChangeRequestT[] }, Record<string, never>>`
  query MyGoldChangeRequests {
    myGoldChangeRequests { ${GOLD_CHANGE_FIELDS} }
  }
`;

export const REQUEST_GOLD_CHANGE = gql<
  { requestGoldChange: GoldChangeRequestT },
  { artifactId: string; comment: string; proposal?: string | null }
>`
  mutation RequestGoldChange($artifactId: String!, $comment: String!, $proposal: String) {
    requestGoldChange(artifactId: $artifactId, comment: $comment, proposal: $proposal) { ${GOLD_CHANGE_FIELDS} }
  }
`;

export const DECIDE_GOLD_CHANGE = gql<
  { decideGoldChange: GoldChangeRequestT },
  { requestId: string; approve: boolean; note?: string | null }
>`
  mutation DecideGoldChange($requestId: String!, $approve: Boolean!, $note: String) {
    decideGoldChange(requestId: $requestId, approve: $approve, note: $note) { ${GOLD_CHANGE_FIELDS} }
  }
`;
