/**
 * Book lifecycle, BL-5 (docs/prd-book-lifecycle.md §14; S10): the AI edit job — estimate (nothing
 * written), start, stop, progress, a book's jobs (paged). A job only ever fills a draft (S11).
 */
import { gql } from "urql";

export interface BlJobInputT {
  feedback?: string[] | null;
  instructions?: { text: string; needsReview?: boolean | null }[] | null;
  scopeChapterKeys?: string[] | null;
  model?: string | null;
  reasoning?: string | null;
  capUsd?: number | null;
  confirmLarge?: boolean | null;
}
export interface BlJobEstimateT {
  model: string;
  capUsd: number;
  chapters: number;
  units: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  large: boolean;
  leftOut: { code: string; reasonBn: string }[];
}
export interface BlJobT {
  id: string;
  bookId: string;
  draftId: string;
  provider: string;
  model: string;
  reasoning: string;
  status: string;
  capUsd: number;
  estimateUsd: number;
  spentUsd: number;
  note: string | null;
  createdAt: string;
  finishedAt: string | null;
  chapters: { key: string; status: string; attempts: number; fixes: number; costUsd: number; cacheHitTokens: number; cacheMissTokens: number; outputTokens: number; errorBn: string | null }[];
  leftOut: { code: string; reasonBn: string }[];
}
const JOB_FIELDS = `id bookId draftId provider model reasoning status capUsd estimateUsd spentUsd note createdAt finishedAt
  chapters { key status attempts fixes costUsd cacheHitTokens cacheMissTokens outputTokens errorBn } leftOut { code reasonBn }`;

export const BL_JOB_ESTIMATE = gql<{ bookLcEditJobEstimate: BlJobEstimateT }, { bookId: string; input: BlJobInputT }>`
  query BookLcEditJobEstimate($bookId: String!, $input: BookLcEditJobInput!) {
    bookLcEditJobEstimate(bookId: $bookId, input: $input) { model capUsd chapters units inputTokens outputTokens usd large leftOut { code reasonBn } }
  }
`;
export const BL_START_JOB = gql<{ startBookLcEditJob: BlJobT }, { bookId: string; input: BlJobInputT }>`
  mutation StartBookLcEditJob($bookId: String!, $input: BookLcEditJobInput!) { startBookLcEditJob(bookId: $bookId, input: $input) { ${JOB_FIELDS} } }
`;
export const BL_STOP_JOB = gql<{ stopBookLcEditJob: BlJobT }, { jobId: string }>`
  mutation StopBookLcEditJob($jobId: String!) { stopBookLcEditJob(jobId: $jobId) { ${JOB_FIELDS} } }
`;
export const BL_JOB = gql<{ bookLcEditJob: BlJobT }, { jobId: string }>`
  query BookLcEditJob($jobId: String!) { bookLcEditJob(jobId: $jobId) { ${JOB_FIELDS} } }
`;
export const BL_JOBS = gql<{ bookLcEditJobsPage: { rows: BlJobT[]; total: number; page: number; pageSize: number } }, { bookId: string; page?: number | null; pageSize?: number | null }>`
  query BookLcEditJobsPage($bookId: String!, $page: Int, $pageSize: Int) { bookLcEditJobsPage(bookId: $bookId, page: $page, pageSize: $pageSize) { rows { ${JOB_FIELDS} } total page pageSize } }
`;
export const BL_RERUN_FAILED = gql<{ rerunBookLcEditJobFailed: BlJobT }, { jobId: string; capUsd?: number | null; confirmLarge?: boolean | null }>`
  mutation RerunBookLcEditJobFailed($jobId: String!, $capUsd: Float, $confirmLarge: Boolean) { rerunBookLcEditJobFailed(jobId: $jobId, capUsd: $capUsd, confirmLarge: $confirmLarge) { ${JOB_FIELDS} } }
`;
