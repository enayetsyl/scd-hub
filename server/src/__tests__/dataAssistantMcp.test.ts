/**
 * Data assistant DA-3 — `/mcp/data` over the Hub's own OAuth (docs/prd-data-assistant-mcp.md §4.4,
 * §4.6; D-#1535/#1536), on an in-memory MongoDB through the real Express routers and the real MCP
 * SDK (supertest), like aiWorkspaceW5.test.ts. Every name, phone and e-mail here is invented.
 */
import { createHash, randomBytes } from "crypto";
import express from "express";
import request from "supertest";
import { User } from "../modules/foundation/models/User";
import { hashPassword, staffLogin } from "../modules/foundation/services/AuthService";
import { resetStaffPassword } from "../modules/foundation/services/ProvisioningService";
import { oauthRouter } from "../modules/ai-workspace/mcp/oauth";
import { mcpRouter } from "../modules/ai-workspace/mcp/mcpRoute";
import { AiOAuthToken } from "../modules/ai-workspace/models/AiOAuth";
import { Audit } from "../modules/platform/models/Audit";
import { dataMcpRouter } from "../modules/data-assistant/mcp/dataMcpRoute";
import { AiDataCall } from "../modules/data-assistant/models/AiDataCall";
import { resetLimits } from "../modules/data-assistant/limits";
import { myDataConnections, revokeDataConnection } from "../modules/data-assistant/services/DataConnectionService";
import { CONTACT_MARKERS, setupFixtures, teardownFixtures, type Fx } from "./dataAssistantFixtures";

jest.setTimeout(180_000);

const app = express();
app.use(oauthRouter);
app.use("/mcp/data", dataMcpRouter);
app.use("/mcp", mcpRouter);

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const PW = "Secret@123";
let fx: Fx;
let clientId = "";

beforeAll(async () => {
  fx = await setupFixtures();
  // Sign-in fixtures: passwords for the Principal and three Office logins.
  const hash = await hashPassword(PW);
  await User.updateMany({}, { $set: { passwordHash: hash } });
  await User.create([
    { role: "OFFICE", name: "Office Connect", email: "connect@school.test", phone: "01711000111", passwordHash: hash, active: true, grantedPermissions: ["data_assistant:connect"] },
    { role: "TEACHER", name: "Teacher Connect", email: "tconnect@school.test", passwordHash: hash, active: true },
  ]);
  const reg = await request(app).post("/oauth/register").send({ client_name: "Claude", redirect_uris: [REDIRECT] });
  clientId = reg.body.client_id;
});
afterAll(async () => teardownFixtures(fx));
beforeEach(() => resetLimits());

const authorizeQuery = (extra: Record<string, string> = {}) => ({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s1", resource: "https://hub.test/mcp/data", ...extra });

async function signIn(email: string, extra: Record<string, string> = {}): Promise<request.Response> {
  return request(app).post("/oauth/authorize").type("form").send({ ...authorizeQuery(extra), email, password: PW });
}
async function tokenFor(email: string, extra: Record<string, string> = {}): Promise<{ access_token: string; refresh_token: string; scope: string }> {
  const ok = await signIn(email, extra);
  expect(ok.status).toBe(302);
  const code = new URL(ok.headers.location).searchParams.get("code")!;
  const tok = await request(app).post("/oauth/token").type("form").send({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier });
  return tok.body;
}
const rpc = (path: string, token: string, body: unknown) =>
  request(app).post(path).set("Authorization", `Bearer ${token}`).set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").send(body as object);
const init = (path: string, token: string) => rpc(path, token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
const list = (token: string) => rpc("/mcp/data", token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
const call = (token: string, name: string, args: Record<string, unknown> = {}) => rpc("/mcp/data", token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } });
const json = (res: request.Response) => JSON.parse(res.body.result.content[0].text);

describe("discovery", () => {
  it("/mcp/data without a token → 401 naming its own metadata; both metadata documents answer", async () => {
    const r = await request(app).post("/mcp/data").set("Host", "hub.test").set("X-Forwarded-Proto", "https").send({});
    expect(r.status).toBe(401);
    expect(r.headers["www-authenticate"]).toBe('Bearer resource_metadata="https://hub.test/.well-known/oauth-protected-resource/mcp/data"');
    const pr = await request(app).get("/.well-known/oauth-protected-resource/mcp/data").set("Host", "hub.test").set("X-Forwarded-Proto", "https");
    expect(pr.body).toEqual({ resource: "https://hub.test/mcp/data", authorization_servers: ["https://hub.test"], scopes_supported: ["data.read"], bearer_methods_supported: ["header"], resource_name: "SCD Hub data" });
    const as = await request(app).get("/.well-known/oauth-authorization-server").set("Host", "hub.test").set("X-Forwarded-Proto", "https");
    expect(as.body.scopes_supported).toEqual(["mcp", "data.read"]);
    expect((await request(app).get("/mcp/data")).status).toBe(405);
  });
  it("the sign-in page explains the data connection", async () => {
    const page = await request(app).get("/oauth/authorize").query(authorizeQuery());
    expect(page.text).toContain("ফোন নম্বর ও ঠিকানা কখনো পাঠানো হয় না");
    expect(page.text).toContain("Phone numbers and addresses are never shared");
  });
});

describe("who may connect (Q2: the Principal in v1; the code checks the permission)", () => {
  it("Office by default, Teacher and Guardian are refused; Office with a connect grant is allowed", async () => {
    for (const email of ["office4@school.test", "tconnect@school.test", "g@school.test"]) {
      const r = await signIn(email);
      expect([email, r.status]).toEqual([email, 403]);
      expect(r.text).toContain("এই সংযোগের অনুমতি আপনার নেই");
    }
    expect((await signIn("connect@school.test")).status).toBe(302);
    expect((await signIn("old@school.test")).status).toBe(401); // deactivated: the login itself fails
  });
  it("a wrong password is refused by the Hub sign-in (staffLogin, which keeps its lockout)", async () => {
    const wrong = await request(app).post("/oauth/authorize").type("form").send({ ...authorizeQuery(), email: "connect@school.test", password: "nope" });
    expect(wrong.status).toBe(401);
    expect(await staffLogin({ email: "connect@school.test", password: PW, ip: "1.1.1.1" })).toBeTruthy();
  });
  it("the scope alone (no resource) also asks for data; tokens say data.read; the audit names it", async () => {
    const t = await tokenFor("marker.user@example.test", { resource: "", scope: "data.read" });
    expect(t.scope).toBe("data.read");
    expect(await Audit.countDocuments({ eventKind: "DATA_MCP_AUTHORIZED" })).toBeGreaterThan(0);
  });
});

describe("tokens are bound to one endpoint", () => {
  it("a data token on /mcp → 401; a workspace token on /mcp/data → 401", async () => {
    const data = await tokenFor("marker.user@example.test");
    expect((await init("/mcp", data.access_token)).status).toBe(401);
    const ws = await tokenFor("marker.user@example.test", { resource: "", scope: "mcp" });
    expect(ws.scope).toBe("mcp");
    expect((await init("/mcp/data", ws.access_token)).status).toBe(401);
    expect((await init("/mcp", ws.access_token)).status).toBe(200);
  });
});

describe("the tools", () => {
  it("the Principal: instructions, read-only tools, redacted JSON, logged as claude", async () => {
    const t = await tokenFor("marker.user@example.test");
    const i = await init("/mcp/data", t.access_token);
    expect(i.body.result.instructions).toContain("untrusted_text");
    const tools = (await list(t.access_token)).body.result.tools as Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>;
    expect(tools).toHaveLength(24);
    expect(tools.every((x) => x.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.some((x) => /support/i.test(x.name))).toBe(false);
    const r = await call(t.access_token, "student_overview", { student_id: fx.ids.studentA, include_comments: true });
    const text = r.body.result.content[0].text as string;
    for (const m of CONTACT_MARKERS) expect(text).not.toContain(m);
    expect(json(r).ok).toBe(true);
    const row = await AiDataCall.findOne({ tool: "student_overview", surface: "claude" }).lean();
    expect(row).toMatchObject({ clientName: "Claude", clientId, outcome: "ok" });
  });
  it("Office with a connect grant: no mastery, attendance yes, payroll person needs payroll:view", async () => {
    const t = await tokenFor("connect@school.test");
    const names = ((await list(t.access_token)).body.result.tools as Array<{ name: string }>).map((x) => x.name);
    expect(names).not.toContain("mastery_overview");
    expect(names).toContain("attendance_day");
    expect(json(await call(t.access_token, "payroll_summary", { mode: "person", staff_id: fx.ids.staff })).ok).toBe(true);
    // Without payroll:view the tool is not even listed (§5.4) and a call to it is an error.
    await User.updateOne({ email: "connect@school.test" }, { $set: { revokedPermissions: ["payroll:view"] } });
    const after = ((await list(t.access_token)).body.result.tools as Array<{ name: string }>).map((x) => x.name);
    expect(after).not.toContain("payroll_summary");
    const denied = await call(t.access_token, "payroll_summary", { mode: "person", staff_id: fx.ids.staff });
    expect(denied.body.result.isError).toBe(true);
    await User.updateOne({ email: "connect@school.test" }, { $set: { revokedPermissions: [] } });
  });
  it("losing data_assistant:connect cuts the token on the next call; deactivation too", async () => {
    const t = await tokenFor("connect@school.test");
    expect((await init("/mcp/data", t.access_token)).status).toBe(200);
    await User.updateOne({ email: "connect@school.test" }, { $set: { grantedPermissions: [] } });
    expect((await init("/mcp/data", t.access_token)).status).toBe(401);
    const u = await User.findOne({ email: "connect@school.test" }).lean();
    expect(await AiOAuthToken.countDocuments({ userId: u!._id, resource: "data", revokedAt: null })).toBe(0);
    expect(await Audit.countDocuments({ eventKind: "DATA_MCP_REVOKED", "meta.reason": "permission_removed" })).toBe(1);
    await User.updateOne({ email: "connect@school.test" }, { $set: { grantedPermissions: ["data_assistant:connect"] } });
    // Deactivation: the next call is refused and the tokens are cut with that reason.
    const t2 = await tokenFor("connect@school.test");
    await User.updateOne({ email: "connect@school.test" }, { $set: { active: false } });
    expect((await init("/mcp/data", t2.access_token)).status).toBe(401);
    expect(await Audit.countDocuments({ eventKind: "DATA_MCP_REVOKED", "meta.reason": "deactivated" })).toBe(1);
    await User.updateOne({ email: "connect@school.test" }, { $set: { active: true } });
  });
});

describe("lifetimes and revocation", () => {
  it("refresh rotates and keeps the first sign-in; past 90 days the person signs in again", async () => {
    const t = await tokenFor("marker.user@example.test");
    const r1 = await request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId });
    expect(r1.body.scope).toBe("data.read");
    expect((await request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId })).body).toEqual({ error: "invalid_grant" });
    const first = await AiOAuthToken.findOne({ accessHash: createHash("sha256").update(t.access_token).digest("hex") }).lean();
    const next = await AiOAuthToken.findOne({ accessHash: createHash("sha256").update(r1.body.access_token).digest("hex") }).lean();
    expect(next!.grantedAt!.getTime()).toBe(first!.grantedAt!.getTime());
    // 91 days later: the access token is refused and the refresh is invalid.
    await AiOAuthToken.updateOne({ _id: next!._id }, { $set: { grantedAt: new Date(Date.now() - 91 * 86_400_000) } });
    expect((await init("/mcp/data", r1.body.access_token)).status).toBe(401);
    expect((await request(app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", refresh_token: r1.body.refresh_token, client_id: clientId })).body).toEqual({ error: "invalid_grant" });
  });
  it("a fresh data token never outlives 90 days (refresh expiry capped)", async () => {
    const t = await tokenFor("marker.user@example.test");
    const row = await AiOAuthToken.findOne({ accessHash: createHash("sha256").update(t.access_token).digest("hex") }).lean();
    expect(row!.refreshExpiresAt.getTime()).toBeLessThanOrEqual(row!.grantedAt!.getTime() + 90 * 86_400_000);
  });
  it("disconnect revokes the person's tokens of that client, with an audit row", async () => {
    const t = await tokenFor("marker.user@example.test");
    const mine = await myDataConnections(fx.auth.principal);
    expect(mine.map((c) => c.clientId)).toContain(clientId);
    expect(await revokeDataConnection(fx.auth.principal, clientId)).toBe(true);
    expect((await init("/mcp/data", t.access_token)).status).toBe(401);
    expect(await Audit.countDocuments({ eventKind: "DATA_MCP_REVOKED", "meta.reason": "disconnect" })).toBeGreaterThan(0);
  });
  it("a password reset by the Office/Principal revokes the person's data tokens", async () => {
    const t = await tokenFor("connect@school.test");
    const u = await User.findOne({ email: "connect@school.test" }).lean();
    await resetStaffPassword(String(u!._id), { userId: fx.auth.principal.userId, role: "PRINCIPAL" } as never).catch(() => undefined);
    expect(await AiOAuthToken.countDocuments({ userId: u!._id, resource: "data", revokedAt: null })).toBe(0);
    expect((await init("/mcp/data", t.access_token)).status).toBe(401);
  });
});
