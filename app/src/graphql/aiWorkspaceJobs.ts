/**
 * AI Workspace W-4 (docs/prd-ai-workspace.md §6) — mirror
 * server/src/modules/ai-workspace/resolvers/aiWorkspaceJobs.ts.
 */
import { gql } from "urql";

export interface AiJobItemT {
  id: string;
  value: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  attempts: number;
  fixes: number;
  draftId: string | null;
  error: string | null;
  costUsd: number;
}

export interface AiJobT {
  id: string;
  projectId: string;
  title: string;
  kind: string;
  template: string;
  model: string;
  thinking: string;
  runAt: "now" | "offpeak";
  status: "queued" | "running" | "done" | "partial" | "failed" | "cancelled";
  total: number;
  done: number;
  failed: number;
  queued: number;
  running: number;
  costUsd: number;
  estimateNowUsd: number;
  estimateOffpeakUsd: number;
  cacheHitRate: number | null;
  createdByName: string | null;
  origin: "app" | "claude";
  createdAt: string;
  finishedAt: string | null;
  items: AiJobItemT[];
}

export interface AiJobEstimateT {
  items: number;
  inputTokens: number;
  outputTokens: number;
  nowUsd: number;
  offpeakUsd: number;
  peakNow: boolean;
  offpeakStartsAt: string;
}

interface PageT<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

const JOB_FIELDS =
  "id projectId title kind template model thinking runAt status total done failed queued running costUsd estimateNowUsd estimateOffpeakUsd cacheHitRate createdByName origin createdAt finishedAt";
const ITEM_FIELDS = "items { id value status attempts fixes draftId error costUsd }";

type JobVars = { projectId: string; title: string; kind: string; template: string; items: string[]; model: string; thinking: string };

export const AI_JOBS_PAGE = gql<{ aiJobsPage: PageT<AiJobT> }, { projectId: string; page: number; pageSize: number }>`
  query AiJobsPage($projectId: String!, $page: Int, $pageSize: Int) {
    aiJobsPage(projectId: $projectId, page: $page, pageSize: $pageSize) { rows { ${JOB_FIELDS} } total page pageSize }
  }
`;

export const AI_JOB = gql<{ aiJob: AiJobT }, { id: string }>`
  query AiJob($id: String!) { aiJob(id: $id) { ${JOB_FIELDS} ${ITEM_FIELDS} } }
`;

export const AI_JOB_ESTIMATE = gql<{ aiJobEstimate: AiJobEstimateT }, JobVars>`
  query AiJobEstimate($projectId: String!, $title: String!, $kind: String!, $template: String!, $items: [String!]!, $model: String!, $thinking: String!) {
    aiJobEstimate(projectId: $projectId, title: $title, kind: $kind, template: $template, items: $items, model: $model, thinking: $thinking) {
      items inputTokens outputTokens nowUsd offpeakUsd peakNow offpeakStartsAt
    }
  }
`;

export const CREATE_AI_JOB = gql<{ createAiJob: AiJobT }, JobVars & { runAt: string }>`
  mutation CreateAiJob($projectId: String!, $title: String!, $kind: String!, $template: String!, $items: [String!]!, $model: String!, $thinking: String!, $runAt: String!) {
    createAiJob(projectId: $projectId, title: $title, kind: $kind, template: $template, items: $items, model: $model, thinking: $thinking, runAt: $runAt) { ${JOB_FIELDS} }
  }
`;

export const CANCEL_AI_JOB = gql<{ cancelAiJob: AiJobT }, { id: string }>`
  mutation CancelAiJob($id: String!) { cancelAiJob(id: $id) { ${JOB_FIELDS} ${ITEM_FIELDS} } }
`;
