/**
 * AI teacher assistant (AI-6, D-#1096) — mirror server/src/modules/ai-assist/resolvers/aiAssist.ts.
 */
import { gql } from "urql";

export interface AiAssistSessionT {
  id: string;
  teacherId: string;
  teacherName: string | null;
  classLevel: number;
  subject: string;
  chapter: string | null;
  sessionIndex: number | null;
  title: string;
  turns: number;
  lastAt: string;
  createdAt: string;
}

export interface AiAssistMessageT {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
}

export interface AiAssistTopicT {
  classLevel: number;
  subject: string;
  chapters: Array<{ chapter: string; title: string | null; sessions: Array<{ sessionIndex: number; titleBn: string }> }>;
}

const SESSION = "id teacherId teacherName classLevel subject chapter sessionIndex title turns lastAt createdAt";
type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };

export const AI_ASSISTANT_AVAILABLE = gql<{ aiAssistantAvailable: boolean }, Record<string, never>>`
  query AiAssistantAvailable { aiAssistantAvailable }
`;

export const AI_ASSIST_TOPICS = gql<{ aiAssistTopics: AiAssistTopicT[] }, Record<string, never>>`
  query AiAssistTopics { aiAssistTopics { classLevel subject chapters { chapter title sessions { sessionIndex titleBn } } } }
`;

export const MY_AI_ASSIST_SESSIONS_PAGE = gql<{ myAiAssistSessionsPage: Page<AiAssistSessionT> }, { page: number; pageSize: number }>`
  query MyAiAssistSessionsPage($page: Int, $pageSize: Int) {
    myAiAssistSessionsPage(page: $page, pageSize: $pageSize) { rows { ${SESSION} } total page pageSize }
  }
`;

export const ALL_AI_ASSIST_SESSIONS_PAGE = gql<{ allAiAssistSessionsPage: Page<AiAssistSessionT> }, { page: number; pageSize: number }>`
  query AllAiAssistSessionsPage($page: Int, $pageSize: Int) {
    allAiAssistSessionsPage(page: $page, pageSize: $pageSize) { rows { ${SESSION} } total page pageSize }
  }
`;

export const AI_ASSIST_MESSAGES_PAGE = gql<
  { aiAssistMessagesPage: Page<AiAssistMessageT> & { session: AiAssistSessionT } },
  { sessionId: string; page: number; pageSize: number }
>`
  query AiAssistMessagesPage($sessionId: String!, $page: Int, $pageSize: Int) {
    aiAssistMessagesPage(sessionId: $sessionId, page: $page, pageSize: $pageSize) {
      rows { id role text at } total page pageSize session { ${SESSION} }
    }
  }
`;

export const START_AI_ASSIST_SESSION = gql<
  { startAiAssistSession: AiAssistSessionT },
  { classLevel: number; subject: string; chapter?: string | null; sessionIndex?: number | null }
>`
  mutation StartAiAssistSession($classLevel: Int!, $subject: String!, $chapter: String, $sessionIndex: Int) {
    startAiAssistSession(classLevel: $classLevel, subject: $subject, chapter: $chapter, sessionIndex: $sessionIndex) { ${SESSION} }
  }
`;

export const ASK_AI_ASSISTANT = gql<{ askAiAssistant: AiAssistMessageT[] }, { sessionId: string; question: string }>`
  mutation AskAiAssistant($sessionId: String!, $question: String!) {
    askAiAssistant(sessionId: $sessionId, question: $question) { id role text at }
  }
`;
