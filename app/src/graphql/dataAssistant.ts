/**
 * Data assistant (docs/prd-data-assistant-mcp.md §11) — mirror
 * server/src/modules/data-assistant/resolvers/dataAssistant.ts. An answer is written to its
 * message row when it is ready; the screen polls DATA_CHAT_MESSAGE while it runs.
 */
import { gql } from "urql";

export interface DataChatT {
  id: string;
  title: string;
  turns: number;
  lastAt: string;
  chatModel: string;
  deepseekWarning: boolean;
  viewAs: boolean;
}

export interface DataToolChipT {
  tool: string;
  labelBn: string;
  outcome: string;
}

export interface DataChatMessageT {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  status: "running" | "done" | "failed" | "stopped";
  error: string | null;
  modelName: string | null;
  tools: DataToolChipT[];
  denied: boolean;
  costUsd: number | null;
}

export interface DataChatModelT {
  id: string;
  deepseek: boolean;
  isDefault: boolean;
}

const CHAT_FIELDS = `id title turns lastAt chatModel deepseekWarning viewAs`;
const MESSAGE_FIELDS = `id sessionId role text at status error modelName denied costUsd tools { tool labelBn outcome }`;

export const DATA_CHATS_PAGE = gql<{ dataChatsPage: { rows: DataChatT[]; total: number; page: number; pageSize: number } }, { page?: number | null; pageSize?: number }>`
  query DataChatsPage($page: Int, $pageSize: Int) {
    dataChatsPage(page: $page, pageSize: $pageSize) { rows { ${CHAT_FIELDS} } total page pageSize }
  }
`;

export const DATA_CHAT_SETUP = gql<{ dataChat: DataChatT; dataChatModels: DataChatModelT[]; dataChatDeepseekWarning: string }, { id: string }>`
  query DataChatSetup($id: String!) {
    dataChat(id: $id) { ${CHAT_FIELDS} }
    dataChatModels { id deepseek isDefault }
    dataChatDeepseekWarning
  }
`;

export const DATA_CHAT_MESSAGES_PAGE = gql<
  { dataChatMessagesPage: { rows: DataChatMessageT[]; total: number; page: number; pageSize: number } },
  { sessionId: string; page?: number | null; pageSize?: number }
>`
  query DataChatMessagesPage($sessionId: String!, $page: Int, $pageSize: Int) {
    dataChatMessagesPage(sessionId: $sessionId, page: $page, pageSize: $pageSize) { rows { ${MESSAGE_FIELDS} } total page pageSize }
  }
`;

export const DATA_CHAT_MESSAGE = gql<{ dataChatMessage: DataChatMessageT }, { id: string }>`
  query DataChatMessage($id: String!) {
    dataChatMessage(id: $id) { ${MESSAGE_FIELDS} }
  }
`;

export const START_DATA_CHAT = gql<{ startDataChat: DataChatT }, { title?: string | null; model?: string | null }>`
  mutation StartDataChat($title: String, $model: String) {
    startDataChat(title: $title, model: $model) { ${CHAT_FIELDS} }
  }
`;

export const SET_DATA_CHAT_MODEL = gql<{ setDataChatModel: DataChatT }, { sessionId: string; model: string }>`
  mutation SetDataChatModel($sessionId: String!, $model: String!) {
    setDataChatModel(sessionId: $sessionId, model: $model) { ${CHAT_FIELDS} }
  }
`;

export const ASK_DATA_ASSISTANT = gql<
  { askDataAssistant: { user: DataChatMessageT; assistant: DataChatMessageT; session: DataChatT } },
  { sessionId: string; text: string; model?: string | null }
>`
  mutation AskDataAssistant($sessionId: String!, $text: String!, $model: String) {
    askDataAssistant(sessionId: $sessionId, text: $text, model: $model) {
      user { ${MESSAGE_FIELDS} }
      assistant { ${MESSAGE_FIELDS} }
      session { ${CHAT_FIELDS} }
    }
  }
`;

export const STOP_DATA_ANSWER = gql<{ stopDataAnswer: DataChatMessageT }, { messageId: string }>`
  mutation StopDataAnswer($messageId: String!) {
    stopDataAnswer(messageId: $messageId) { ${MESSAGE_FIELDS} }
  }
`;
