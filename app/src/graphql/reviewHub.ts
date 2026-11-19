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

// ---------------------------------------------------------------------------
// The ordered path + "আরও কাজ দিন" (.claude/plans/review-next-chunk.md)
// ---------------------------------------------------------------------------

export interface ReviewPathItemT {
  key: string;
  /** CHAPTER_PLAN | SESSION_PLAN | PLAN | QUESTIONS */
  kind: string;
  titleBn: string;
  left: number;
  total: number;
  decided: boolean;
  /** A screen of the ReviewTab stack. */
  screen: string;
  paramsJson: string;
}

export interface ReviewPathChapterT {
  key: string;
  chapter: string;
  chapterNo: number | null;
  /** "অধ্যায় ৩" - always the plan's word. */
  labelBn: string;
  left: number;
  total: number;
  decided: boolean;
  dueKey: string | null;
  items: ReviewPathItemT[];
}

export interface ReviewPathBookT {
  key: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  titleBn: string;
  left: number;
  total: number;
  chapters: ReviewPathChapterT[];
}

export interface ReviewPathT {
  books: ReviewPathBookT[];
  next: { bookTitleBn: string; chapterLabelBn: string; item: ReviewPathItemT } | null;
  totalLeft: number;
}

const PATH_FIELDS = `
  totalLeft
  next { bookTitleBn chapterLabelBn item { key kind titleBn left total decided screen paramsJson } }
  books {
    key subject classLevel anchorWord titleBn left total
    chapters {
      key chapter chapterNo labelBn left total decided dueKey
      items { key kind titleBn left total decided screen paramsJson }
    }
  }
`;

export const MY_REVIEW_PATH = gql<{ myReviewPath: ReviewPathT }, Record<string, never>>`
  query MyReviewPath {
    myReviewPath { ${PATH_FIELDS} }
  }
`;

export interface ReviewMoreStatusT {
  canRequest: boolean;
  /** STILL_OPEN | DAILY_CAP | NOT_ENABLED, or null when canRequest. */
  reason: string | null;
  leftPlans: number;
  leftQuestions: number;
  requestsToday: number;
  maxRequestsPerDay: number;
  chunkChapters: number;
}

const MORE_STATUS_FIELDS = "canRequest reason leftPlans leftQuestions requestsToday maxRequestsPerDay chunkChapters";

export const MY_REVIEW_MORE_STATUS = gql<{ myReviewMoreStatus: ReviewMoreStatusT }, Record<string, never>>`
  query MyReviewMoreStatus {
    myReviewMoreStatus { ${MORE_STATUS_FIELDS} }
  }
`;

export interface ReviewMoreResultT {
  /** ADDED | STILL_OPEN | DAILY_CAP | NOTHING_LEFT | NOT_ENABLED */
  outcome: string;
  bookTitleBn: string | null;
  anchorWord: string | null;
  chapters: string[];
  addedPlans: number;
  addedQuestions: number;
  status: ReviewMoreStatusT;
}

export const REQUEST_MORE_REVIEW = gql<{ requestMoreReview: ReviewMoreResultT }, Record<string, never>>`
  mutation RequestMoreReview {
    requestMoreReview {
      outcome bookTitleBn anchorWord chapters addedPlans addedQuestions
      status { ${MORE_STATUS_FIELDS} }
    }
  }
`;

// --- The Principal's side: settings + ladders ------------------------------

export interface ReviewLadderBookT {
  subject: string;
  classLevel: number;
  anchorWord: string;
  labelBn: string;
}

export interface ReviewSelfServeT {
  programId: string;
  settings: {
    enabled: boolean;
    chunkChapters: number;
    releasePlansLeft: number;
    releaseQuestionsPct: number;
    maxRequestsPerDay: number;
  };
  ladders: { reviewerId: string; reviewerName: string | null; custom: boolean; books: ReviewLadderBookT[] }[];
  availableBooks: ReviewLadderBookT[];
}

const SELF_SERVE_FIELDS = `
  programId
  settings { enabled chunkChapters releasePlansLeft releaseQuestionsPct maxRequestsPerDay }
  ladders { reviewerId reviewerName custom books { subject classLevel anchorWord labelBn } }
  availableBooks { subject classLevel anchorWord labelBn }
`;

export const REVIEW_SELF_SERVE_QUERY = gql<{ reviewSelfServe: ReviewSelfServeT }, { programId: string }>`
  query ReviewSelfServe($programId: String!) {
    reviewSelfServe(programId: $programId) { ${SELF_SERVE_FIELDS} }
  }
`;

export const UPDATE_REVIEW_SELF_SERVE = gql<
  { updateReviewSelfServe: ReviewSelfServeT },
  {
    programId: string;
    enabled?: boolean | null;
    chunkChapters?: number | null;
    releasePlansLeft?: number | null;
    releaseQuestionsPct?: number | null;
    maxRequestsPerDay?: number | null;
  }
>`
  mutation UpdateReviewSelfServe(
    $programId: String!
    $enabled: Boolean
    $chunkChapters: Int
    $releasePlansLeft: Int
    $releaseQuestionsPct: Int
    $maxRequestsPerDay: Int
  ) {
    updateReviewSelfServe(
      programId: $programId
      enabled: $enabled
      chunkChapters: $chunkChapters
      releasePlansLeft: $releasePlansLeft
      releaseQuestionsPct: $releaseQuestionsPct
      maxRequestsPerDay: $maxRequestsPerDay
    ) { ${SELF_SERVE_FIELDS} }
  }
`;

export const SET_REVIEW_LADDER = gql<
  { setReviewLadder: ReviewSelfServeT },
  { programId: string; reviewerId: string; books: { subject: string; classLevel: number; anchorWord: string }[] | null }
>`
  mutation SetReviewLadder($programId: String!, $reviewerId: String!, $books: [ReviewLadderBookInput!]) {
    setReviewLadder(programId: $programId, reviewerId: $reviewerId, books: $books) { ${SELF_SERVE_FIELDS} }
  }
`;
