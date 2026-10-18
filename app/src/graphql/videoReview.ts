/**
 * Video-review operations (owner ask 2026-07-20) — the class-video self-review
 * loop: office logs a YouTube link + session context and assigns a teacher; the
 * teacher answers OK / NOT_OK-with-comment; Principal/Office watch the counts.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

export interface VideoReviewT {
  id: string;
  youtubeUrl: string;
  classDate: string;
  timeLabel: string;
  classLabel: string;
  room: string;
  teacherId: string;
  teacherName: string | null;
  status: string;
  comment: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface VideoReviewTeacherSummaryT {
  teacherId: string;
  teacherName: string | null;
  pending: number;
  ok: number;
  notOk: number;
}

const VIDEO_REVIEW_FIELDS = `
  id youtubeUrl classDate timeLabel classLabel room
  teacherId teacherName status comment reviewedAt createdAt
`;

export const MY_VIDEO_REVIEWS = gql<{ myVideoReviews: VideoReviewT[] }, NoVars>`
  query MyVideoReviews {
    myVideoReviews { ${VIDEO_REVIEW_FIELDS} }
  }
`;

export const VIDEO_REVIEW_OVERVIEW = gql<
  { videoReviewOverview: { rows: VideoReviewT[]; summary: VideoReviewTeacherSummaryT[] } },
  NoVars
>`
  query VideoReviewOverview {
    videoReviewOverview {
      rows { ${VIDEO_REVIEW_FIELDS} }
      summary { teacherId teacherName pending ok notOk }
    }
  }
`;

// D-#761: the board's per-teacher counts alone (no rows) + the rows one page at a time,
// with the status filter applied on the server.
export const VIDEO_REVIEW_SUMMARY = gql<
  { videoReviewOverview: { summary: VideoReviewTeacherSummaryT[] } },
  NoVars
>`
  query VideoReviewSummary {
    videoReviewOverview {
      summary { teacherId teacherName pending ok notOk }
    }
  }
`;

export const VIDEO_REVIEW_ROWS_PAGE = gql<
  { videoReviewRowsPage: { rows: VideoReviewT[]; total: number; page: number; pageSize: number } },
  { status?: string | null; page?: number | null; pageSize?: number | null }
>`
  query VideoReviewRowsPage($status: String, $page: Int, $pageSize: Int) {
    videoReviewRowsPage(status: $status, page: $page, pageSize: $pageSize) {
      rows { ${VIDEO_REVIEW_FIELDS} }
      total page pageSize
    }
  }
`;

export const CREATE_VIDEO_REVIEW = gql<
  { createVideoReview: VideoReviewT },
  {
    youtubeUrl: string;
    classDate: string;
    timeLabel: string;
    classLabel: string;
    room: string;
    teacherId: string;
  }
>`
  mutation CreateVideoReview(
    $youtubeUrl: String!
    $classDate: String!
    $timeLabel: String!
    $classLabel: String!
    $room: String!
    $teacherId: String!
  ) {
    createVideoReview(
      youtubeUrl: $youtubeUrl
      classDate: $classDate
      timeLabel: $timeLabel
      classLabel: $classLabel
      room: $room
      teacherId: $teacherId
    ) {
      ${VIDEO_REVIEW_FIELDS}
    }
  }
`;

export const REVIEW_VIDEO = gql<
  { reviewVideo: VideoReviewT },
  { id: string; ok: boolean; comment?: string | null }
>`
  mutation ReviewVideo($id: String!, $ok: Boolean!, $comment: String) {
    reviewVideo(id: $id, ok: $ok, comment: $comment) {
      ${VIDEO_REVIEW_FIELDS}
    }
  }
`;
