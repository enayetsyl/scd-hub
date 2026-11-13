/**
 * Data assistant DA-3/DA-4 (docs/prd-data-assistant-mcp.md §11) — connections and the tool-call
 * log. Mirror server/src/modules/data-assistant/resolvers/dataAssistant.ts.
 */
import { gql } from "urql";

export interface DataConnectionT {
  userId: string;
  userName: string | null;
  clientId: string;
  clientName: string;
  connectedAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  calls30d: number;
}

export interface DataToolCallT {
  id: string;
  at: string;
  userId: string;
  userName: string | null;
  role: string;
  impersonatorName: string | null;
  surface: string;
  clientName: string | null;
  tool: string;
  args: string;
  outcome: string;
  deniedNeeds: string[];
  rowCount: number;
  truncated: boolean;
  replyBytes: number;
  ms: number;
}

const CONNECTION_FIELDS = `userId userName clientId clientName connectedAt lastUsedAt expiresAt calls30d`;

export const MY_DATA_CONNECTIONS = gql<{ myDataConnections: DataConnectionT[] }>`
  query MyDataConnections {
    myDataConnections { ${CONNECTION_FIELDS} }
  }
`;

export const ALL_DATA_CONNECTIONS_PAGE = gql<
  { allDataConnectionsPage: { rows: DataConnectionT[]; total: number; page: number; pageSize: number } },
  { page?: number | null; pageSize?: number }
>`
  query AllDataConnectionsPage($page: Int, $pageSize: Int) {
    allDataConnectionsPage(page: $page, pageSize: $pageSize) { rows { ${CONNECTION_FIELDS} } total page pageSize }
  }
`;

export const REVOKE_DATA_CONNECTION = gql<{ revokeDataConnection: boolean }, { clientId: string; userId?: string | null }>`
  mutation RevokeDataConnection($clientId: String!, $userId: String) {
    revokeDataConnection(clientId: $clientId, userId: $userId)
  }
`;

export const DATA_TOOL_CALLS_PAGE = gql<
  { dataToolCallsPage: { rows: DataToolCallT[]; total: number; page: number; pageSize: number } },
  { tool?: string | null; outcome?: string | null; surface?: string | null; fromKey?: string | null; toKey?: string | null; page?: number | null; pageSize?: number }
>`
  query DataToolCallsPage($tool: String, $outcome: String, $surface: String, $fromKey: String, $toKey: String, $page: Int, $pageSize: Int) {
    dataToolCallsPage(tool: $tool, outcome: $outcome, surface: $surface, fromKey: $fromKey, toKey: $toKey, page: $page, pageSize: $pageSize) {
      rows { id at userId userName role impersonatorName surface clientName tool args outcome deniedNeeds rowCount truncated replyBytes ms }
      total page pageSize
    }
  }
`;
