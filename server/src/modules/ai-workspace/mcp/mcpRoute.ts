/**
 * POST /mcp — the MCP bridge (AI Workspace W-5, D-#1214): Streamable HTTP, STATELESS (a new
 * server + transport per request; nothing kept between calls), JSON responses.
 *
 * Bearer token from the Hub's own OAuth (oauth.ts). No or a bad token → 401 with
 * `WWW-Authenticate: Bearer resource_metadata=...`, which is how Claude's connector and
 * Claude Code discover where to sign in. GET / DELETE are not used in stateless mode (405).
 *
 *   claude mcp add --transport http scd-hub https://<host>/mcp
 */
import express, { type Request, type Response, type Router } from "express";
import { McpServer, StreamableHTTPServerTransport, type McpServerLike } from "./sdk";
import { baseUrlOf, verifyAccessToken } from "./oauth";
import { registerWorkspaceTools } from "./tools";

export const MCP_INSTRUCTIONS = `SCD Hub AI Workspace (a Bangladeshi school's own AI workspace on DeepSeek).
- The Hub holds the MASTER copy of each project's instructions: call read_project before working on a project and apply its instructions.
- Change instructions with update_instructions ONLY after the Principal approves the exact change.
- ds_draft, run_batch and revise_draft need model, thinking and run_at. Ask the Principal which to use — "now" or "offpeak" (half price) — and state the estimated cost of each before starting anything long.
- Replies are small summaries with ids; read long text with read_file / read_draft by range.`;

export function buildMcpServer(auth: Parameters<typeof registerWorkspaceTools>[1], clientName: string): McpServerLike {
  const server = new McpServer({ name: "scd-hub-ai-workspace", version: "1.0.0" }, { instructions: MCP_INSTRUCTIONS });
  registerWorkspaceTools(server, auth, clientName);
  return server;
}

export const mcpRouter: Router = express.Router();

mcpRouter.post("/", express.json({ limit: "4mb" }), async (req: Request, res: Response) => {
  const header = req.header("authorization") ?? "";
  const raw = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? null;
  const who = await verifyAccessToken(raw, "workspace");
  if (!who) {
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${baseUrlOf(req)}/.well-known/oauth-protected-resource"`);
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  const server = buildMcpServer(who.auth, who.clientName);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.warn("[mcp] request failed:", (e as Error)?.message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
});

const notAllowed = (_req: Request, res: Response) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });
};
mcpRouter.get("/", notAllowed);
mcpRouter.delete("/", notAllowed);
