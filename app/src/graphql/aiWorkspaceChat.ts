/**
 * AI Workspace W-2 (docs/prd-ai-workspace.md §4) — mirror
 * server/src/modules/ai-workspace/resolvers/aiWorkspaceChat.ts. A sent answer streams into its
 * message row: the web watches GET /events/ai-chat/:messageId (lib/aiChatStream.ts), the phone
 * polls AI_PROJECT_CHAT_MESSAGE.
 */
import { gql } from "urql";
import { FILE_FIELDS, type AiProjectFileT } from "./aiWorkspace";

export interface AiProjectChatT {
  id: string;
  projectId: string;
  title: string;
  startedByName: string | null;
  turns: number;
  lastAt: string;
  model: string;
  thinking: "off" | "low" | "high";
  runAt: "now" | "offpeak" | null;
  contextTokens: number;
  windowTokens: number;
  contextUsed: number;
  suggestNewChat: boolean;
}

export interface AiChatMessageT {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  status: "queued" | "running" | "done" | "failed" | "stopped";
  modelName: string | null;
  thinking: string | null;
  runAt: string | null;
  runAfter: string | null;
  error: string | null;
  warning: string | null;
  authorName: string | null;
  tokens: number | null;
  costUsd: number | null;
}

export interface AiPriceClockT {
  peak: boolean;
  changesAt: string;
  factor: number;
  flashPerMillion: { hit: number; miss: number; output: number };
  proPerMillion: { hit: number; miss: number; output: number };
  /** Claude models: the same price at any hour. */
  claudePerMillion: Array<{ model: string; hit: number; miss: number; output: number }>;
}

interface PageT<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

const CHAT_FIELDS = "id projectId title startedByName turns lastAt model thinking runAt contextTokens windowTokens contextUsed suggestNewChat";
export const MESSAGE_FIELDS = "id sessionId role text at status modelName thinking runAt runAfter error warning authorName tokens costUsd";
export const CLOCK_FIELDS = "peak changesAt factor flashPerMillion { hit miss output } proPerMillion { hit miss output } claudePerMillion { model hit miss output }";

export const AI_PROJECT_CHATS_PAGE = gql<{ aiProjectChatsPage: PageT<AiProjectChatT> }, { projectId: string; page: number; pageSize: number }>`
  query AiProjectChatsPage($projectId: String!, $page: Int, $pageSize: Int) {
    aiProjectChatsPage(projectId: $projectId, page: $page, pageSize: $pageSize) { rows { ${CHAT_FIELDS} } total page pageSize }
  }
`;

export const AI_PROJECT_CHAT = gql<
  { aiProjectChat: AiProjectChatT; aiPriceClock: AiPriceClockT; aiProjectChatFiles: AiProjectFileT[] },
  { id: string }
>`
  query AiProjectChat($id: String!) {
    aiProjectChat(id: $id) { ${CHAT_FIELDS} }
    aiPriceClock { ${CLOCK_FIELDS} }
    aiProjectChatFiles(sessionId: $id) { ${FILE_FIELDS} }
  }
`;

export const AI_PROJECT_CHAT_MESSAGES_PAGE = gql<{ aiProjectChatMessagesPage: PageT<AiChatMessageT> }, { sessionId: string; page?: number | null; pageSize: number }>`
  query AiProjectChatMessagesPage($sessionId: String!, $page: Int, $pageSize: Int) {
    aiProjectChatMessagesPage(sessionId: $sessionId, page: $page, pageSize: $pageSize) { rows { ${MESSAGE_FIELDS} } total page pageSize }
  }
`;

export const AI_PROJECT_CHAT_MESSAGE = gql<{ aiProjectChatMessage: AiChatMessageT }, { id: string }>`
  query AiProjectChatMessage($id: String!) { aiProjectChatMessage(id: $id) { ${MESSAGE_FIELDS} } }
`;

export const AI_PRICE_CLOCK = gql<{ aiPriceClock: AiPriceClockT }, Record<string, never>>`
  query AiPriceClock { aiPriceClock { ${CLOCK_FIELDS} } }
`;

export const START_AI_PROJECT_CHAT = gql<{ startAiProjectChat: AiProjectChatT }, { projectId: string; title?: string | null }>`
  mutation StartAiProjectChat($projectId: String!, $title: String) { startAiProjectChat(projectId: $projectId, title: $title) { ${CHAT_FIELDS} } }
`;

export const SEND_AI_PROJECT_MESSAGE = gql<
  { sendAiProjectMessage: { user: AiChatMessageT; assistant: AiChatMessageT } },
  { sessionId: string; text: string; model: string; thinking: string; runAt: string }
>`
  mutation SendAiProjectMessage($sessionId: String!, $text: String!, $model: String!, $thinking: String!, $runAt: String!) {
    sendAiProjectMessage(sessionId: $sessionId, text: $text, model: $model, thinking: $thinking, runAt: $runAt) {
      user { ${MESSAGE_FIELDS} }
      assistant { ${MESSAGE_FIELDS} }
    }
  }
`;

export const STOP_AI_PROJECT_MESSAGE = gql<{ stopAiProjectMessage: AiChatMessageT }, { messageId: string }>`
  mutation StopAiProjectMessage($messageId: String!) { stopAiProjectMessage(messageId: $messageId) { ${MESSAGE_FIELDS} } }
`;
