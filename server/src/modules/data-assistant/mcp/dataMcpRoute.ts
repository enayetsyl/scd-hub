/**
 * POST /mcp/data — the data assistant's MCP endpoint for Claude (docs/prd-data-assistant-mcp.md
 * §4.6; D-#1535/#1536). The pattern of the W-5 `/mcp` route: Streamable HTTP, STATELESS (a new
 * server + transport per request), JSON replies, GET/DELETE → 405. A data-bound Bearer token
 * from the Hub's own OAuth; none or a bad one → 401 with `WWW-Authenticate` naming
 * `/.well-known/oauth-protected-resource/mcp/data`. Only the tools the person may use are
 * listed; each is read-only (`readOnlyHint`) and runs through `runTool` (surface "claude").
 * Mounted BEFORE `/mcp` in index.ts. Caddy's `/mcp*` already covers it (P12).
 */
import express, { type Request, type Response, type Router } from "express";
import type { z } from "zod";
import { McpServer, StreamableHTTPServerTransport, type McpServerLike } from "../../ai-workspace/mcp/sdk";
import { baseUrlOf, verifyAccessToken } from "../../ai-workspace/mcp/oauth";
import type { AuthPayload } from "../../../context";
import { DATA_MCP_INSTRUCTIONS } from "../prompt";
import { runTool } from "../runTool";
import { toolVisible } from "../gates";
import { TOOL_REGISTRY } from "../tools/registry";
// Side effect: registers the automatic revocation of a person's data tokens (D-#1536).
import "../services/DataConnectionService";

type Reply = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
/** Registration WITHOUT the SDK's generics (the W-5 tsc-heap fix, P3). */
type PlainRegister = (
  name: string,
  config: { description: string; inputSchema: Record<string, z.ZodTypeAny>; annotations?: Record<string, unknown> },
  cb: (args: never) => Promise<Reply>,
) => unknown;

export function buildDataMcpServer(auth: AuthPayload, client: { name: string; id: string | null }): McpServerLike {
  const server = new McpServer({ name: "scd-hub-data", version: "1.0.0" }, { instructions: DATA_MCP_INSTRUCTIONS });
  const register = (server.registerTool as unknown as PlainRegister).bind(server);
  for (const tool of TOOL_REGISTRY) {
    if (!toolVisible(tool, auth)) continue;
    const view = tool.trimmed?.when(auth) ? tool.trimmed : tool;
    register(
      tool.name,
      { description: view.description, inputSchema: view.input, annotations: { title: tool.label_en, readOnlyHint: true, openWorldHint: false } },
      async (args: never): Promise<Reply> => {
        try {
          const r = await runTool(auth, tool.name, args ?? {}, { surface: "claude", clientName: client.name, clientId: client.id });
          return { content: [{ type: "text", text: JSON.stringify(r.reply) }], ...(r.reply.ok ? {} : { isError: true }) };
        } catch (e) {
          // Never put e.message in the reply: it can carry a host:port or a driver detail.
          console.warn("[mcp/data] tool failed:", tool.name, (e as Error)?.message);
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "internal_error", message: "তথ্য আনা যায়নি, একটু পরে আবার চেষ্টা করুন / Could not fetch the data, please try again shortly." }) }], isError: true };
        }
      },
    );
  }
  return server;
}

export const dataMcpRouter: Router = express.Router();

dataMcpRouter.post("/", express.json({ limit: "64kb" }), async (req: Request, res: Response) => {
  const header = req.header("authorization") ?? "";
  const raw = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? null;
  let who: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    who = await verifyAccessToken(raw, "data");
  } catch (e) {
    console.warn("[mcp/data] token check failed:", (e as Error)?.message);
    res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    return;
  }
  if (!who) {
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${baseUrlOf(req)}/.well-known/oauth-protected-resource/mcp/data"`);
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  const server = buildDataMcpServer(who.auth, { name: who.clientName, id: who.clientId });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.warn("[mcp/data] request failed:", (e as Error)?.message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
});

const notAllowed = (_req: Request, res: Response) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });
};
dataMcpRouter.get("/", notAllowed);
dataMcpRouter.delete("/", notAllowed);
