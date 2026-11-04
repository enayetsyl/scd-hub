/**
 * Objective-tree review operations — OT-2 (docs/prd-objective-tree.md §7, mocks 2–4).
 *
 * Kept apart from graphql/mastery.ts so the sibling OT slices can edit that file without
 * colliding. Every mutation answers with the refreshed MasteryReviewQueue, so a screen redraws
 * from the one answer (and urql's document cache drops the stale queue by typename).
 *
 * Every field a screen reads is selected here (the QR-10 rule).
 */
import { gql } from "urql";

export interface ReviewPerson {
  id: string;
  name: string;
}

export interface ReviewRoundItem {
  id: string;
  classToken: string;
  subject: string;
  round: number;
  state: string;
  reviewers: ReviewPerson[];
  assignedToMe: boolean;
  seen: number;
  total: number;
  openComments: number;
  unresolvedUnmapped: number;
  importedAt: string;
  submittedAt: string | null;
  lockedAt: string | null;
}

export interface ReviewRow {
  code: string;
  level: string;
  parentCode: string | null;
  domainCode: string | null;
  chapterNumber: number | null;
  strand: string | null;
  tagged: boolean;
  labelBn: string;
  labelEn: string | null;
  sourceText: string;
  assess: string;
  questionTypeCodes: string[];
  homeTipBn: string | null;
  prereqCodes: string[];
  bookRef: { version: string | null; chapter: number | null; lesson: string | null; exercises: string[] };
  claudeNote: string | null;
  legacyCodes: string[];
  status: string;
  reviewState: string | null;
  rejectReason: string | null;
  mergedInto: string | null;
  addReason: string | null;
  order: number;
  openComments: number;
}

export interface ReviewMessage {
  id: string;
  action: string;
  text: string | null;
  byName: string;
  at: string;
}

export interface ReviewThread {
  id: string;
  code: string | null;
  text: string;
  byName: string;
  at: string;
  open: boolean;
  replies: ReviewMessage[];
}

export interface ReviewUnmapped {
  ref: string;
  text: string;
  reason: string;
  resolution: string | null;
  resolvedCode: string | null;
}

export interface ReviewDecisions {
  proposed: number;
  accepted: number;
  edited: number;
  added: number;
  rejected: number;
  merged: number;
  moved: number;
  splits: number;
  merges: number;
}

export interface ReviewQueue {
  id: string;
  classToken: string;
  subject: string;
  round: number;
  state: string;
  book: string | null;
  reviewers: ReviewPerson[];
  assignedAt: string | null;
  submittedAt: string | null;
  lockedAt: string | null;
  chapters: { number: number; titleBn: string }[];
  domains: { code: string; labelBn: string }[];
  questionTypes: { code: string; labelBn: string }[];
  rows: ReviewRow[];
  threads: ReviewThread[];
  unmapped: ReviewUnmapped[];
  flags: { code: string | null; kind: string; text: string; ownerRuling: string | null }[];
  seen: number;
  total: number;
  openComments: number;
  unresolvedUnmapped: number;
  violations: string[];
  decisions: ReviewDecisions;
  assignedToMe: boolean;
  canWrite: boolean;
  canComment: boolean;
  canSubmit: boolean;
  canReopen: boolean;
  canAssign: boolean;
  canLock: boolean;
  eventCount: number;
}

/** What masteryReviewDecide takes (prd-objective-tree §7); unused fields stay undefined. */
export interface ReviewDecisionInput {
  action: "ACCEPT" | "BULK_ACCEPT" | "EDIT" | "SPLIT" | "MERGE" | "MOVE" | "REJECT" | "ADD";
  code?: string | null;
  labelBn?: string | null;
  labelEn?: string | null;
  assess?: string | null;
  questionTypeCodes?: string[] | null;
  prereqCodes?: string[] | null;
  homeTipBn?: string | null;
  domainCode?: string | null;
  exercises?: string[] | null;
  reason?: string | null;
  intoCode?: string | null;
  toParentCode?: string | null;
  toDomainCode?: string | null;
  children?: { labelBn: string; exercises: string[]; assess?: string | null; questionTypeCodes?: string[] | null }[] | null;
  level?: string | null;
  parentCode?: string | null;
  chapterNumber?: number | null;
  strand?: string | null;
}

const QUEUE_FIELDS = `
  id classToken subject round state book
  reviewers { id name }
  assignedAt submittedAt lockedAt
  chapters { number titleBn }
  domains { code labelBn }
  questionTypes { code labelBn }
  rows {
    code level parentCode domainCode chapterNumber strand tagged labelBn labelEn sourceText assess
    questionTypeCodes homeTipBn prereqCodes
    bookRef { version chapter lesson exercises }
    claudeNote legacyCodes status reviewState rejectReason mergedInto addReason order openComments
  }
  threads { id code text byName at open replies { id action text byName at } }
  unmapped { ref text reason resolution resolvedCode }
  flags { code kind text ownerRuling }
  seen total openComments unresolvedUnmapped violations
  decisions { proposed accepted edited added rejected merged moved splits merges }
  assignedToMe canWrite canComment canSubmit canReopen canAssign canLock eventCount
`;

export const MASTERY_REVIEW_ROUNDS_QUERY = gql`
  query MasteryReviewRounds {
    masteryReviewRounds {
      id
      classToken
      subject
      round
      state
      reviewers {
        id
        name
      }
      assignedToMe
      seen
      total
      openComments
      unresolvedUnmapped
      importedAt
      submittedAt
      lockedAt
    }
  }
`;

export const MASTERY_REVIEW_QUEUE_QUERY = gql`
  query MasteryReviewQueue($reviewId: String!) {
    masteryReviewQueue(reviewId: $reviewId) { ${QUEUE_FIELDS} }
  }
`;

export const MASTERY_REVIEWER_CANDIDATES_QUERY = gql`
  query MasteryReviewerCandidates {
    masteryReviewerCandidates {
      id
      name
    }
  }
`;

export const MASTERY_REVIEW_EXPORT_QUERY = gql`
  query MasteryReviewExport($classToken: String!, $subject: String!, $round: Int!) {
    masteryReviewExport(classToken: $classToken, subject: $subject, round: $round)
  }
`;

export const ASSIGN_MASTERY_REVIEWERS = gql`
  mutation AssignMasteryReviewers($reviewId: String!, $reviewerIds: [String!]!) {
    assignMasteryReviewers(reviewId: $reviewId, reviewerIds: $reviewerIds) { ${QUEUE_FIELDS} }
  }
`;

export const MASTERY_REVIEW_DECIDE = gql`
  mutation MasteryReviewDecide($reviewId: String!, $input: MasteryReviewDecisionInput!) {
    masteryReviewDecide(reviewId: $reviewId, input: $input) { ${QUEUE_FIELDS} }
  }
`;

export const MASTERY_REVIEW_COMMENT = gql`
  mutation MasteryReviewComment($reviewId: String!, $action: String!, $code: String, $parentEventId: String, $text: String) {
    masteryReviewComment(reviewId: $reviewId, action: $action, code: $code, parentEventId: $parentEventId, text: $text) { ${QUEUE_FIELDS} }
  }
`;

export const MASTERY_REVIEW_RESOLVE_UNMAPPED = gql`
  mutation MasteryReviewResolveUnmapped($reviewId: String!, $ref: String!, $mapToCode: String, $notAssessedReason: String, $reopen: Boolean) {
    masteryReviewResolveUnmapped(reviewId: $reviewId, ref: $ref, mapToCode: $mapToCode, notAssessedReason: $notAssessedReason, reopen: $reopen) { ${QUEUE_FIELDS} }
  }
`;

export const SUBMIT_MASTERY_REVIEW = gql`
  mutation SubmitMasteryReview($reviewId: String!) {
    submitMasteryReview(reviewId: $reviewId) { ${QUEUE_FIELDS} }
  }
`;

export const REOPEN_MASTERY_REVIEW = gql`
  mutation ReopenMasteryReview($reviewId: String!, $reason: String) {
    reopenMasteryReview(reviewId: $reviewId, reason: $reason) { ${QUEUE_FIELDS} }
  }
`;

export const LOCK_MASTERY_REVIEW = gql`
  mutation LockMasteryReview($reviewId: String!) {
    lockMasteryReview(reviewId: $reviewId) { ${QUEUE_FIELDS} }
  }
`;
