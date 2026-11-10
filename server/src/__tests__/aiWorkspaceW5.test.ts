/**
 * AI Workspace W-5 — the MCP bridge for Claude (docs/prd-ai-workspace.md §7; D-#1214), on an
 * in-memory MongoDB through the real Express routers (supertest).
 *   • discovery: protected-resource + authorization-server metadata; /mcp without a token →
 *     401 with WWW-Authenticate pointing at the metadata
 *   • dynamic client registration: https (or loopback http) redirect URIs only
 *   • authorize: PKCE S256 required; the Hub login; ONLY the Principal may allow
 *   • token: PKCE verified, codes single use, refresh tokens rotate
 *   • /mcp: the ten tools; ds_draft refuses without run_at; work started is origin "claude";
 *     every reply's size is logged; disconnect revokes the tokens
 * Every name here is invented.
 */
import { createHash, randomBytes } from "crypto";
import express from "express";
import request from "supertest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { hashPassword } from "../modules/foundation/services/AuthService";
import { oauthRouter } from "../modules/ai-workspace/mcp/oauth";
import { mcpRouter } from "../modules/ai-workspace/mcp/mcpRoute";
import { mcpConnections, revokeMcpConnection } from "../modules/ai-workspace/mcp/connections";
import { AiMcpCall } from "../modules/ai-workspace/models/AiOAuth";
import { AiJob } from "../modules/ai-workspace/models/AiJob";
import { createAiProject, saveAiProjectInstructions } from "../modules/ai-workspace/services/AiProjectService";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const app = express();
app.use(oauthRouter);
app.use("/mcp", mcpRouter);

const principalId = new Types.ObjectId();
const principal: AuthPayload = { userId: principalId.toString(), role: "PRINCIPAL" };
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
let clientId = "";
let projectId = "";
let accessToken = "";
let refreshToken = "";

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await User.create([
    { _id: principalId, role: "PRINCIPAL", name: "Head Teacher", email: "head@school.test", phone: "01700000001", passwordHash: await hashPassword("Secret@123"), active: true },
    { role: "TEACHER", name: "Plain Teacher", email: "teacher@school.test", phone: "01700000002", passwordHash: await hashPassword("Secret@123"), active: true, grantedPermissions: ["ai_workspace:use"] },
  ]);
  projectId = (await createAiProject(principal, { name: "Storybooks", nameProtection: false })).id;
  await saveAiProjectInstructions(principal, projectId, "## নিয়ম\nছোট গল্প।");
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const authorizeQuery = () => ({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", scope: "mcp" });
const rpc = (body: unknown, token = accessToken) =>
  request(app).post("/mcp").set("Authorization", `Bearer ${token}`).set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").send(body as object);
const toolCall = (name: string, args: Record<string, unknown>, id = 9) => rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const toolJson = (res: request.Response) => JSON.parse(res.body.result.content[0].text);

describe("discovery and sign-in", () => {
  it("publishes the metadata and challenges /mcp without a token", async () => {
    const pr = await request(app).get("/.well-known/oauth-protected-resource").set("Host", "hub.test").set("X-Forwarded-Proto", "https");
    expect(pr.body).toMatchObject({ resource: "https://hub.test/mcp", authorization_servers: ["https://hub.test"] });
    const as = await request(app).get("/.well-known/oauth-authorization-server").set("Host", "hub.test").set("X-Forwarded-Proto", "https");
    expect(as.body).toMatchObject({ authorization_endpoint: "https://hub.test/oauth/authorize", token_endpoint: "https://hub.test/oauth/token", registration_endpoint: "https://hub.test/oauth/register", code_challenge_methods_supported: ["S256"] });
    const r = await request(app).post("/mcp").set("Host", "hub.test").set("X-Forwarded-Proto", "https").send({});
    expect(r.status).toBe(401);
    expect(r.headers["www-authenticate"]).toBe('Bearer resource_metadata="https://hub.test/.well-known/oauth-protected-resource"');
  });

  it("registers a public client; plain-http redirects outside localhost are refused", async () => {
    expect((await request(app).post("/oauth/register").send({ redirect_uris: ["http://evil.example/cb"] })).status).toBe(400);
    const ok = await request(app).post("/oauth/register").send({ client_name: "Claude", redirect_uris: [REDIRECT] });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ client_name: "Claude", token_endpoint_auth_method: "none" });
    clientId = ok.body.client_id;
    expect((await request(app).post("/oauth/register").send({ redirect_uris: ["http://localhost:33418/callback"] })).status).toBe(201);
  });

  it("the login page needs PKCE S256 and a registered redirect", async () => {
    expect((await request(app).get("/oauth/authorize").query({ ...authorizeQuery(), code_challenge_method: "plain" })).status).toBe(400);
    expect((await request(app).get("/oauth/authorize").query({ ...authorizeQuery(), redirect_uri: "https://other.example/cb" })).status).toBe(400);
    const page = await request(app).get("/oauth/authorize").query(authorizeQuery());
    expect(page.status).toBe(200);
    expect(page.text).toContain("Claude");
    expect(page.text).toContain('name="code_challenge"');
  });

  it("only the Principal can allow; the code comes back with the state", async () => {
    const wrong = await request(app).post("/oauth/authorize").type("form").send({ ...authorizeQuery(), email: "head@school.test", password: "nope" });
    expect(wrong.status).toBe(401);
    const teacher = await request(app).post("/oauth/authorize").type("form").send({ ...authorizeQuery(), email: "teacher@school.test", password: "Secret@123" });
    expect(teacher.status).toBe(403);
    expect(teacher.text).toContain("Only the Principal");
    const ok = await request(app).post("/oauth/authorize").type("form").send({ ...authorizeQuery(), email: "head@school.test", password: "Secret@123" });
    expect(ok.status).toBe(302);
    const loc = new URL(ok.headers.location);
    expect(`${loc.origin}${loc.pathname}`).toBe(REDIRECT);
    expect(loc.searchParams.get("state")).toBe("xyz");
    const code = loc.searchParams.get("code")!;

    const badVerifier = await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: "x".repeat(43) });
    expect(badVerifier.body).toEqual({ error: "invalid_grant" });
    // The failed attempt used the code up: single use, even when the verifier was wrong.
    const reuse = await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(reuse.body).toEqual({ error: "invalid_grant" });

    const again = await request(app).post("/oauth/authorize").type("form").send({ ...authorizeQuery(), email: "head@school.test", password: "Secret@123" });
    const code2 = new URL(again.headers.location).searchParams.get("code")!;
    const tok = await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", code: code2, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(tok.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "mcp" });
    accessToken = tok.body.access_token;
    refreshToken = tok.body.refresh_token;
  });

  it("refresh tokens rotate: the old one stops working", async () => {
    const r1 = await request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
    expect(r1.body.access_token).toBeTruthy();
    const r2 = await request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
    expect(r2.body).toEqual({ error: "invalid_grant" });
    accessToken = r1.body.access_token;
    refreshToken = r1.body.refresh_token;
  });
});

describe("the tools", () => {
  it("initialize + tools/list: the ten tools, with the instructions for Claude", async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(init.status).toBe(200);
    expect(init.body.result.instructions).toContain("read_project");
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(list.body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      ["ds_draft", "job_status", "list_projects", "read_draft", "read_file", "read_project", "revise_draft", "run_batch", "update_instructions", "usage_report"].sort(),
    );
    const ds = list.body.result.tools.find((t: { name: string }) => t.name === "ds_draft");
    expect(ds.inputSchema.required).toEqual(expect.arrayContaining(["run_at", "model", "thinking"]));
  });

  it("list_projects / read_project give the master instructions and small replies", async () => {
    const lp = toolJson(await toolCall("list_projects", {}));
    expect(lp.projects).toEqual([expect.objectContaining({ id: projectId, name: "Storybooks" })]);
    const rp = toolJson(await toolCall("read_project", { project_id: projectId }));
    expect(rp.instructions).toMatchObject({ version: 1, text: "## নিয়ম\nছোট গল্প।" });
  });

  it("ds_draft without run_at is refused; with it, a job starts marked as Claude's", async () => {
    const bad = await toolCall("ds_draft", { project_id: projectId, title: "গল্প", kind: "storybook", prompt: "একটি গল্প", model: "deepseek-flash", thinking: "low" });
    expect(bad.body.result?.isError ?? !!bad.body.error).toBe(true);
    const ok = toolJson(await toolCall("ds_draft", { project_id: projectId, title: "গল্প", kind: "storybook", prompt: "একটি গল্প", model: "deepseek-flash", thinking: "low", run_at: "offpeak" }));
    expect(ok).toMatchObject({ status: "queued", run_at: "offpeak" });
    expect(ok.estimate_usd.offpeak).toBeGreaterThan(0);
    expect(await AiJob.findById(ok.job_id).lean()).toMatchObject({ origin: "claude", runAt: "offpeak" });
    const st = toolJson(await toolCall("job_status", { job_id: ok.job_id }));
    expect(st).toMatchObject({ status: "queued", queued: 1 });
  });

  it("update_instructions writes the next version; usage_report answers", async () => {
    expect(toolJson(await toolCall("update_instructions", { project_id: projectId, body: "## নিয়ম\nছোট গল্প। সহজ শব্দ।" }))).toMatchObject({ version: 2 });
    expect(toolJson(await toolCall("usage_report", {}))).toHaveProperty("by_feature");
  });

  it("every reply's size is logged; disconnect revokes the tokens", async () => {
    const calls = await AiMcpCall.find({ userId: principalId }).lean();
    expect(calls.length).toBeGreaterThanOrEqual(6);
    expect(calls.every((c) => c.replyBytes > 0 && c.clientName === "Claude")).toBe(true);
    const conns = await mcpConnections(principal);
    expect(conns).toEqual([expect.objectContaining({ clientId, clientName: "Claude" })]);
    expect(await revokeMcpConnection(principal, clientId)).toBe(true);
    expect((await toolCall("list_projects", {})).status).toBe(401);
  });
});
