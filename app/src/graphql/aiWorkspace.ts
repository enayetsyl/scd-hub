/**
 * AI Workspace (W-1, docs/prd-ai-workspace.md §3) — mirror
 * server/src/modules/ai-workspace/resolvers/aiWorkspace.ts. Files are uploaded through
 * POST /files/ai-workspace (lib/files.ts `pickAndUploadAiWorkspaceFile`).
 */
import { gql } from "urql";

export type AiProjectRoleT = "owner" | "editor" | "viewer";
export type AiThinkingT = "off" | "low" | "high";

export interface AiProjectMemberT {
  userId: string;
  name: string;
  role: AiProjectRoleT;
}

export interface AiProjectT {
  id: string;
  name: string;
  description: string | null;
  ownerName: string | null;
  myRole: AiProjectRoleT;
  members: AiProjectMemberT[];
  defaultModel: string;
  defaultThinking: AiThinkingT;
  nameProtection: boolean;
  monthlyCapUsd: number | null;
  archived: boolean;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiProjectFileT {
  id: string;
  projectId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  storedFileId: string | null;
  status: "processing" | "ready" | "failed";
  error: string | null;
  textSource: "text" | "tesseract" | "gemini" | null;
  pages: number | null;
  chars: number;
  tokenCount: number;
  tokenMethod: "tokenizer" | "estimate" | "measured" | null;
  pinned: boolean;
  order: number;
  at: string;
}

export interface AiProjectBudgetT {
  model: string;
  instructionTokens: number;
  fileTokens: number;
  pinnedFiles: number;
  totalTokens: number;
  windowTokens: number;
  warnTokens: number;
  maxTokens: number;
  warn: boolean;
  over: boolean;
  costPerMessageCacheHitUsd: number;
  costPerMessageCacheMissUsd: number;
  spentThisMonthUsd: number;
  monthlyCapUsd: number | null;
}

export interface AiProjectInstructionsT {
  id: string;
  version: number;
  body: string;
  hash: string;
  note: string | null;
  createdAt: string;
}

export interface AiProjectInstructionVersionT extends AiProjectInstructionsT {
  active: boolean;
  createdByName: string | null;
}

interface PageT<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const PROJECT_FIELDS =
  "id name description ownerName myRole members { userId name role } defaultModel defaultThinking nameProtection monthlyCapUsd archived fileCount createdAt updatedAt";
export const FILE_FIELDS = "id projectId name mime sizeBytes storedFileId status error textSource pages chars tokenCount tokenMethod pinned order at";
const BUDGET_FIELDS =
  "model instructionTokens fileTokens pinnedFiles totalTokens windowTokens warnTokens maxTokens warn over costPerMessageCacheHitUsd costPerMessageCacheMissUsd spentThisMonthUsd monthlyCapUsd";
const INSTRUCTION_FIELDS = "id version body hash note createdAt";

export const AI_PROJECTS_PAGE = gql<{ aiProjectsPage: PageT<AiProjectT> }, { archived?: boolean; page: number; pageSize: number }>`
  query AiProjectsPage($archived: Boolean, $page: Int, $pageSize: Int) {
    aiProjectsPage(archived: $archived, page: $page, pageSize: $pageSize) { rows { ${PROJECT_FIELDS} } total page pageSize }
  }
`;

export const AI_PROJECT = gql<{ aiProject: AiProjectT; aiProjectContextBudget: AiProjectBudgetT }, { id: string }>`
  query AiProject($id: String!) {
    aiProject(id: $id) { ${PROJECT_FIELDS} }
    aiProjectContextBudget(projectId: $id) { ${BUDGET_FIELDS} }
  }
`;

export const AI_PROJECT_FILES_PAGE = gql<{ aiProjectFilesPage: PageT<AiProjectFileT> }, { projectId: string; page: number; pageSize: number }>`
  query AiProjectFilesPage($projectId: String!, $page: Int, $pageSize: Int) {
    aiProjectFilesPage(projectId: $projectId, page: $page, pageSize: $pageSize) { rows { ${FILE_FIELDS} } total page pageSize }
  }
`;

export const AI_PROJECT_FILE_TEXT = gql<
  { aiProjectFileText: { fileId: string; name: string; offset: number; text: string; totalChars: number } },
  { fileId: string; offset: number; limit: number }
>`
  query AiProjectFileText($fileId: String!, $offset: Int, $limit: Int) {
    aiProjectFileText(fileId: $fileId, offset: $offset, limit: $limit) { fileId name offset text totalChars }
  }
`;

export const AI_PROJECT_INSTRUCTIONS = gql<
  { aiProjectInstructions: AiProjectInstructionsT | null; aiProjectInstructionVersionsPage: PageT<AiProjectInstructionVersionT> },
  { projectId: string; page: number; pageSize: number }
>`
  query AiProjectInstructions($projectId: String!, $page: Int, $pageSize: Int) {
    aiProjectInstructions(projectId: $projectId) { ${INSTRUCTION_FIELDS} }
    aiProjectInstructionVersionsPage(projectId: $projectId, page: $page, pageSize: $pageSize) {
      rows { ${INSTRUCTION_FIELDS} active createdByName } total page pageSize
    }
  }
`;

export const AI_WORKSPACE_MEMBER_CANDIDATES = gql<{ aiWorkspaceMemberCandidates: Array<{ userId: string; name: string }> }, Record<string, never>>`
  query AiWorkspaceMemberCandidates { aiWorkspaceMemberCandidates { userId name } }
`;

export const CREATE_AI_PROJECT = gql<
  { createAiProject: AiProjectT },
  { name: string; description?: string | null; nameProtection: boolean; defaultModel?: string | null; defaultThinking?: string | null; monthlyCapUsd?: number | null }
>`
  mutation CreateAiProject($name: String!, $description: String, $nameProtection: Boolean!, $defaultModel: String, $defaultThinking: String, $monthlyCapUsd: Float) {
    createAiProject(name: $name, description: $description, nameProtection: $nameProtection, defaultModel: $defaultModel, defaultThinking: $defaultThinking, monthlyCapUsd: $monthlyCapUsd) { ${PROJECT_FIELDS} }
  }
`;

export const UPDATE_AI_PROJECT = gql<
  { updateAiProject: AiProjectT },
  {
    id: string;
    name?: string | null;
    description?: string | null;
    defaultModel?: string | null;
    defaultThinking?: string | null;
    nameProtection?: boolean | null;
    monthlyCapUsd?: number | null;
    clearMonthlyCap?: boolean | null;
    archived?: boolean | null;
  }
>`
  mutation UpdateAiProject(
    $id: String!, $name: String, $description: String, $defaultModel: String, $defaultThinking: String,
    $nameProtection: Boolean, $monthlyCapUsd: Float, $clearMonthlyCap: Boolean, $archived: Boolean
  ) {
    updateAiProject(
      id: $id, name: $name, description: $description, defaultModel: $defaultModel, defaultThinking: $defaultThinking,
      nameProtection: $nameProtection, monthlyCapUsd: $monthlyCapUsd, clearMonthlyCap: $clearMonthlyCap, archived: $archived
    ) { ${PROJECT_FIELDS} }
  }
`;

export const SET_AI_PROJECT_MEMBERS = gql<{ setAiProjectMembers: AiProjectT }, { id: string; members: Array<{ userId: string; role: string }> }>`
  mutation SetAiProjectMembers($id: String!, $members: [AiProjectMemberInput!]!) {
    setAiProjectMembers(id: $id, members: $members) { ${PROJECT_FIELDS} }
  }
`;

export const SAVE_AI_PROJECT_INSTRUCTIONS = gql<{ saveAiProjectInstructions: AiProjectInstructionsT }, { projectId: string; body: string; note?: string | null }>`
  mutation SaveAiProjectInstructions($projectId: String!, $body: String!, $note: String) {
    saveAiProjectInstructions(projectId: $projectId, body: $body, note: $note) { ${INSTRUCTION_FIELDS} }
  }
`;

export const UPDATE_AI_PROJECT_FILE = gql<{ updateAiProjectFile: AiProjectFileT }, { fileId: string; pinned?: boolean | null; order?: number | null; name?: string | null }>`
  mutation UpdateAiProjectFile($fileId: String!, $pinned: Boolean, $order: Int, $name: String) {
    updateAiProjectFile(fileId: $fileId, pinned: $pinned, order: $order, name: $name) { ${FILE_FIELDS} }
  }
`;

export const REREAD_AI_PROJECT_FILE = gql<{ rereadAiProjectFile: AiProjectFileT }, { fileId: string; mode: "auto" | "tesseract" | "gemini" }>`
  mutation RereadAiProjectFile($fileId: String!, $mode: String!) {
    rereadAiProjectFile(fileId: $fileId, mode: $mode) { ${FILE_FIELDS} }
  }
`;

export const DELETE_AI_PROJECT_FILE = gql<{ deleteAiProjectFile: boolean }, { fileId: string }>`
  mutation DeleteAiProjectFile($fileId: String!) { deleteAiProjectFile(fileId: $fileId) }
`;
