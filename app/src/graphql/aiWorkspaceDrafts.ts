/**
 * AI Workspace W-3 (docs/prd-ai-workspace.md §5) — mirror
 * server/src/modules/ai-workspace/resolvers/aiWorkspaceDrafts.ts. Export is a REST download:
 * GET /files/ai-draft/:draftId/export?format=docx|pdf (lib/files.ts `downloadAiDraft`).
 */
import { gql } from "urql";

export type AiDraftKindT = "free" | "lesson_plan" | "question_bank" | "book_chapter" | "storybook" | "paper";

export interface AiDraftT {
  id: string;
  projectId: string;
  title: string;
  kind: AiDraftKindT;
  status: "draft" | "approved";
  currentVersion: number;
  approvedVersion: number | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdByName: string | null;
  origin: "app" | "claude";
  revise: { status: string; runAfter: string | null; error: string | null; notes: string } | null;
  sends: Array<{ pipeline: string; version: number; ok: boolean; summary: string; at: string }>;
  canSend: boolean;
  review: { score: "usable" | "minor" | "rewrite"; note: string | null; byName: string | null; at: string; version: number } | null;
  updatedAt: string;
  /** Save-as-draft from an answer with several lesson plans: how many drafts were made. */
  savedTogether: number;
}

/** validate_plan.py on a lesson-plan version (P09 plan tools). */
export interface AiPlanCheckT {
  verdict: "PASS" | "FAIL" | "ERROR";
  fails: string[];
  warns: string[];
  chapterDraftId: string | null;
  chapterVersion: number | null;
  at: string;
}

export interface AiDraftVersionT {
  id: string;
  version: number;
  body: string;
  planJson: string | null;
  note: string | null;
  source: "manual" | "chat" | "revise" | "job";
  policyHash: string | null;
  costUsd: number | null;
  createdByName: string | null;
  origin: "app" | "claude";
  planCheck: AiPlanCheckT | null;
  at: string;
}

interface PageT<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

const DRAFT_FIELDS =
  "id projectId title kind status currentVersion approvedVersion approvedByName approvedAt createdByName origin revise { status runAfter error notes } sends { pipeline version ok summary at } canSend review { score note byName at version } updatedAt savedTogether";
const VERSION_FIELDS = "id version body planJson note source policyHash costUsd createdByName origin planCheck { verdict fails warns chapterDraftId chapterVersion at } at";

export const AI_DRAFTS_PAGE = gql<{ aiDraftsPage: PageT<AiDraftT> }, { projectId: string; archived?: boolean; page: number; pageSize: number }>`
  query AiDraftsPage($projectId: String!, $archived: Boolean, $page: Int, $pageSize: Int) {
    aiDraftsPage(projectId: $projectId, archived: $archived, page: $page, pageSize: $pageSize) { rows { ${DRAFT_FIELDS} } total page pageSize }
  }
`;

export const AI_DRAFT = gql<{ aiDraft: { draft: AiDraftT; version: AiDraftVersionT } }, { id: string }>`
  query AiDraft($id: String!) { aiDraft(id: $id) { draft { ${DRAFT_FIELDS} } version { ${VERSION_FIELDS} } } }
`;

export const AI_DRAFT_VERSIONS_PAGE = gql<{ aiDraftVersionsPage: PageT<AiDraftVersionT> }, { draftId: string; page: number; pageSize: number }>`
  query AiDraftVersionsPage($draftId: String!, $page: Int, $pageSize: Int) {
    aiDraftVersionsPage(draftId: $draftId, page: $page, pageSize: $pageSize) { rows { ${VERSION_FIELDS} } total page pageSize }
  }
`;

export const AI_DRAFT_SEND_PREVIEW = gql<
  { aiDraftSendPreview: { pipeline: string; verdict: string | null; failChecks: string[]; replaces: string | null; adds: string } },
  { draftId: string }
>`
  query AiDraftSendPreview($draftId: String!) { aiDraftSendPreview(draftId: $draftId) { pipeline verdict failChecks replaces adds } }
`;

export const CREATE_AI_DRAFT = gql<{ createAiDraft: AiDraftT }, { projectId: string; title: string; kind: string; body: string; planJson?: string | null; note?: string | null }>`
  mutation CreateAiDraft($projectId: String!, $title: String!, $kind: String!, $body: String!, $planJson: String, $note: String) {
    createAiDraft(projectId: $projectId, title: $title, kind: $kind, body: $body, planJson: $planJson, note: $note) { ${DRAFT_FIELDS} }
  }
`;

export const SAVE_AI_DRAFT_FROM_MESSAGE = gql<{ saveAiDraftFromMessage: AiDraftT }, { messageId: string; title: string; kind: string }>`
  mutation SaveAiDraftFromMessage($messageId: String!, $title: String!, $kind: String!) {
    saveAiDraftFromMessage(messageId: $messageId, title: $title, kind: $kind) { ${DRAFT_FIELDS} }
  }
`;

export const SAVE_AI_DRAFT_VERSION = gql<{ saveAiDraftVersion: AiDraftT }, { draftId: string; body: string; planJson?: string | null; note?: string | null }>`
  mutation SaveAiDraftVersion($draftId: String!, $body: String!, $planJson: String, $note: String) {
    saveAiDraftVersion(draftId: $draftId, body: $body, planJson: $planJson, note: $note) { ${DRAFT_FIELDS} }
  }
`;

export const APPROVE_AI_DRAFT = gql<{ approveAiDraft: AiDraftT }, { draftId: string }>`
  mutation ApproveAiDraft($draftId: String!) { approveAiDraft(draftId: $draftId) { ${DRAFT_FIELDS} } }
`;

export const SCORE_AI_DRAFT = gql<{ scoreAiDraft: AiDraftT }, { draftId: string; score: string; note?: string | null }>`
  mutation ScoreAiDraft($draftId: String!, $score: String!, $note: String) { scoreAiDraft(draftId: $draftId, score: $score, note: $note) { ${DRAFT_FIELDS} } }
`;

export const SET_AI_DRAFT_ARCHIVED = gql<{ setAiDraftArchived: AiDraftT }, { draftId: string; archived: boolean }>`
  mutation SetAiDraftArchived($draftId: String!, $archived: Boolean!) { setAiDraftArchived(draftId: $draftId, archived: $archived) { ${DRAFT_FIELDS} } }
`;

export const REVISE_AI_DRAFT = gql<{ reviseAiDraft: AiDraftT }, { draftId: string; notes: string; model: string; thinking: string; runAt: string }>`
  mutation ReviseAiDraft($draftId: String!, $notes: String!, $model: String!, $thinking: String!, $runAt: String!) {
    reviseAiDraft(draftId: $draftId, notes: $notes, model: $model, thinking: $thinking, runAt: $runAt) { ${DRAFT_FIELDS} }
  }
`;

export const CANCEL_AI_DRAFT_REVISION = gql<{ cancelAiDraftRevision: AiDraftT }, { draftId: string }>`
  mutation CancelAiDraftRevision($draftId: String!) { cancelAiDraftRevision(draftId: $draftId) { ${DRAFT_FIELDS} } }
`;

export const SEND_AI_DRAFT_TO_PIPELINE = gql<
  { sendAiDraftToPipeline: { ok: boolean; summary: string; failChecks: string[] } },
  { draftId: string; confirm: boolean; curationTag?: string | null; unitTitle?: string | null }
>`
  mutation SendAiDraftToPipeline($draftId: String!, $confirm: Boolean!, $curationTag: String, $unitTitle: String) {
    sendAiDraftToPipeline(draftId: $draftId, confirm: $confirm, curationTag: $curationTag, unitTitle: $unitTitle) { ok summary failChecks }
  }
`;
