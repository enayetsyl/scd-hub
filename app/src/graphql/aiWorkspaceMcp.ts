/**
 * AI Workspace W-5 (D-#1214) — the Principal's view of Claude's MCP connections.
 * Mirror of the aiMcpConnections / revokeAiMcpConnection fields in
 * server/src/modules/ai-workspace/resolvers/aiWorkspace.ts.
 */
import { gql } from "urql";

export interface McpConnectionT {
  clientId: string;
  clientName: string;
  connectedAt: string;
  lastUsedAt: string | null;
  calls30d: number;
  replyKb30d: number;
}

export const AI_MCP_CONNECTIONS = gql<{ aiMcpConnections: McpConnectionT[] }, Record<string, never>>`
  query AiMcpConnections { aiMcpConnections { clientId clientName connectedAt lastUsedAt calls30d replyKb30d } }
`;

export const REVOKE_AI_MCP_CONNECTION = gql<{ revokeAiMcpConnection: boolean }, { clientId: string }>`
  mutation RevokeAiMcpConnection($clientId: String!) { revokeAiMcpConnection(clientId: $clientId) }
`;
