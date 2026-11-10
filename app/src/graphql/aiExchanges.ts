/**
 * The AI request & reply log (D-#1179) — mirror server/src/modules/platform/resolvers/aiExchanges.ts.
 * `ai_assist:read_ai_log` / `ai_assist:delete_ai_log` (both LOCKED, Principal).
 */
import { gql } from "urql";

export interface AiExchangeRowT {
  id: string;
  at: string;
  feature: string;
  userId: string | null;
  userName: string | null;
  role: string | null;
  modelName: string | null;
  ok: boolean;
  errorKind: string | null;
  latencyMs: number;
  costUsd: number;
  fellBack: boolean;
  policyHash: string | null;
  issuesShown: number | null;
  issuesAccepted: number | null;
  teacherOverrode: boolean | null;
  saved: boolean;
  preview: string;
}

export interface AiExchangeDetailT {
  row: AiExchangeRowT;
  refType: string | null;
  refId: string | null;
  attempts: Array<{ provider: string; modelName: string; outcome: string; errorKind: string | null; fallback: boolean; latencyMs: number; costUsd: number }>;
  prefix: string;
  context: string | null;
  history: Array<{ role: string; text: string }>;
  request: string;
  reply: string;
  issueTypes: Array<{ type: string; count: number }>;
}

const ROW = "id at feature userId userName role modelName ok errorKind latencyMs costUsd fellBack policyHash issuesShown issuesAccepted teacherOverrode saved preview";

export const AI_EXCHANGES_PAGE = gql<
  { aiExchangesPage: { rows: AiExchangeRowT[]; total: number; page: number; pageSize: number } },
  { page: number; pageSize: number; feature: string | null; month: string | null }
>`
  query AiExchangesPage($page: Int, $pageSize: Int, $feature: String, $month: String) {
    aiExchangesPage(page: $page, pageSize: $pageSize, feature: $feature, month: $month) { rows { ${ROW} } total page pageSize }
  }
`;

export const AI_EXCHANGE = gql<{ aiExchange: AiExchangeDetailT }, { id: string }>`
  query AiExchange($id: String!) {
    aiExchange(id: $id) {
      row { ${ROW} }
      refType refId
      attempts { provider modelName outcome errorKind fallback latencyMs costUsd }
      prefix context
      history { role text }
      request reply
      issueTypes { type count }
    }
  }
`;

export const AI_EXCHANGES_EXPORT = gql<
  { aiExchangesExport: Array<{ row: AiExchangeRowT; request: string; reply: string }> },
  { feature: string | null; month: string | null }
>`
  query AiExchangesExport($feature: String, $month: String) {
    aiExchangesExport(feature: $feature, month: $month) { row { ${ROW} } request reply }
  }
`;

export const DELETE_AI_EXCHANGE = gql<{ deleteAiExchange: boolean }, { id: string }>`
  mutation DeleteAiExchange($id: String!) { deleteAiExchange(id: $id) }
`;

export const DELETE_AI_EXCHANGES = gql<{ deleteAiExchanges: number }, { feature: string | null; month: string | null }>`
  mutation DeleteAiExchanges($feature: String, $month: String) { deleteAiExchanges(feature: $feature, month: $month) }
`;
