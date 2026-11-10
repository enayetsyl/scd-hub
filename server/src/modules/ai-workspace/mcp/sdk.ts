/**
 * The MCP SDK, loaded WITHOUT its TypeScript types (W-5 CI fix).
 *
 * `@modelcontextprotocol/sdk` ships very large zod v3/v4-compatible type definitions; with
 * them in the program, `tsc --noEmit` for the whole server peaked at ~3.5 GB (7.9 M type
 * instantiations) and ran out of memory on CI's 4 GB heap. Only these three calls are
 * used, so the SDK is required at runtime and described here by small local interfaces.
 * The runtime behaviour (and the zod validation of tool arguments) is unchanged; the W-5
 * tests drive the real SDK over HTTP.
 */
export interface McpServerLike {
  registerTool(name: string, config: { description: string; inputSchema: Record<string, unknown> }, cb: (args: never) => Promise<unknown>): unknown;
  connect(transport: McpTransportLike): Promise<void>;
  close(): Promise<void>;
}

export interface McpTransportLike {
  handleRequest(req: unknown, res: unknown, body?: unknown): Promise<void>;
  close(): Promise<void>;
}

type McpServerCtor = new (info: { name: string; version: string }, options?: { instructions?: string }) => McpServerLike;
type TransportCtor = new (options: { sessionIdGenerator: undefined; enableJsonResponse?: boolean }) => McpTransportLike;

/* eslint-disable @typescript-eslint/no-require-imports */
export const McpServer: McpServerCtor = require("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
export const StreamableHTTPServerTransport: TransportCtor = require("@modelcontextprotocol/sdk/server/streamableHttp.js").StreamableHTTPServerTransport;
/* eslint-enable @typescript-eslint/no-require-imports */
