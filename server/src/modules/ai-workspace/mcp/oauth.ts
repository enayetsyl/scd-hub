/**
 * OAuth 2.1 for the MCP bridge (AI Workspace W-5, docs/prd-ai-workspace.md §7; D-#1214).
 *
 * The Hub is the authorization server for one protected resource, `<base>/mcp`:
 *   GET  /.well-known/oauth-protected-resource      RFC 9728 — which server protects /mcp
 *   GET  /.well-known/oauth-authorization-server    RFC 8414 — the endpoints below
 *   POST /oauth/register                            RFC 7591 dynamic client registration (public clients)
 *   GET  /oauth/authorize                           the Hub login page (authorization code + PKCE S256)
 *   POST /oauth/authorize                           checks the Hub login; ONLY the Principal
 *                                                   (`ai_workspace:admin`) may authorise; redirects with a code
 *   POST /oauth/token                               code → tokens (PKCE checked); refresh → rotated tokens
 *
 * Tokens are opaque random strings; only their SHA-256 is stored. Access 1 hour, refresh 30
 * days. A revoked or expired token, or a user who lost `ai_workspace:admin`, is refused.
 * Claude never sees the DeepSeek key: it only ever holds these tokens.
 *
 * Caddy: `/oauth*`, `/mcp*` and `/.well-known/oauth-*` must be in the `@api` matcher.
 */
import { createHash, randomBytes, randomUUID } from "crypto";
import express, { type Request, type Response, type Router } from "express";
import { callerHasPermission } from "@scd/shared";
import { Types } from "mongoose";
import { staffLogin } from "../../foundation/services/AuthService";
import { User } from "../../foundation/models/User";
import { clientIpFrom } from "../../../clientIp";
import { writeAudit } from "../../platform/services/AuditService";
import type { AuthPayload } from "../../../context";
import { AiOAuthClient, AiOAuthCode, AiOAuthToken } from "../models/AiOAuth";

export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 30 * 86400;
const CODE_TTL_MS = 10 * 60 * 1000;
export const MCP_SCOPE = "mcp";

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const token = (): string => randomBytes(32).toString("base64url");

/** The public origin, e.g. https://hub.example.org — env first, else the proxy headers. */
export function baseUrlOf(req: Request): string {
  const env = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (env) return env;
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}

export function protectedResourceMetadata(base: string): Record<string, unknown> {
  return { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: [MCP_SCOPE], bearer_methods_supported: ["header"], resource_name: "SCD Hub AI Workspace" };
}

export function authorizationServerMetadata(base: string): Record<string, unknown> {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE],
  };
}

/** https anywhere, or http only on the loopback (Claude Code's local callback). */
export function redirectUriAllowed(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function loginPage(params: Record<string, string>, clientName: string, error: string | null): string {
  const hidden = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SCD Hub — Claude connection</title>
<style>body{font-family:system-ui,"Noto Sans Bengali",sans-serif;background:#f4f6f8;margin:0;padding:24px}main{max-width:420px;margin:40px auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 4px #0002}
label{display:block;margin-top:12px;font-size:14px}input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:10px;margin-top:4px;border:1px solid #bbb;border-radius:8px;font-size:16px}
button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:8px;background:#0b6e4f;color:#fff;font-size:16px}.err{background:#fde8e8;color:#8a1c1c;padding:10px;border-radius:8px;margin-top:12px}.muted{color:#555;font-size:14px}</style></head>
<body><main><h2>SCD Hub — এআই কর্মক্ষেত্র</h2>
<p><b>${esc(clientName)}</b> এআই কর্মক্ষেত্রে ঢোকার অনুমতি চাইছে।</p>
<p class="muted">${esc(clientName)} is asking to use the SCD Hub AI Workspace. Only the Principal can allow this.</p>
${error ? `<div class="err">${esc(error)}</div>` : ""}
<form method="post" action="/oauth/authorize">${hidden}
<label>ইমেইল বা ফোন / Email or phone<input type="text" name="email" autocomplete="username" required></label>
<label>পাসওয়ার্ড / Password<input type="password" name="password" autocomplete="current-password" required></label>
<button type="submit">অনুমতি দিন / Allow</button></form></main></body></html>`;
}

const AUTH_PARAMS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

async function checkAuthorizeParams(q: Record<string, unknown>): Promise<{ ok: true; params: Record<string, string>; clientName: string } | { ok: false; status: number; error: string }> {
  const params: Record<string, string> = {};
  for (const k of AUTH_PARAMS) if (typeof q[k] === "string") params[k] = q[k] as string;
  if (params.response_type !== "code") return { ok: false, status: 400, error: "unsupported_response_type" };
  const client = params.client_id ? await AiOAuthClient.findOne({ clientId: params.client_id }).lean() : null;
  if (!client) return { ok: false, status: 400, error: "invalid_client" };
  if (!params.redirect_uri || !client.redirectUris.includes(params.redirect_uri)) return { ok: false, status: 400, error: "invalid_redirect_uri" };
  if (params.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(params.code_challenge ?? "")) return { ok: false, status: 400, error: "invalid_request: PKCE S256 required" };
  return { ok: true, params, clientName: client.name };
}

function redirectWith(res: Response, uri: string, q: Record<string, string>): void {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  res.redirect(302, u.toString());
}

/** Issues a fresh access + refresh token pair (only hashes are stored). */
async function issueTokens(clientId: string, clientName: string, userId: Types.ObjectId): Promise<Record<string, unknown>> {
  const access = token();
  const refresh = token();
  const now = Date.now();
  await AiOAuthToken.create({
    accessHash: sha256(access),
    refreshHash: sha256(refresh),
    clientId,
    clientName,
    userId,
    accessExpiresAt: new Date(now + ACCESS_TTL_S * 1000),
    refreshExpiresAt: new Date(now + REFRESH_TTL_S * 1000),
  });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: MCP_SCOPE };
}

/** The Principal check every token use repeats: an active login still holding ai_workspace:admin. */
export async function workspaceAdminAuth(userId: Types.ObjectId | string): Promise<AuthPayload | null> {
  const u = await User.findOne({ _id: userId, active: true }).select("role additionalTemplates grantedPermissions revokedPermissions").lean();
  if (!u) return null;
  const auth = { userId: String(userId), role: u.role, additionalTemplates: u.additionalTemplates ?? [], grantedPermissions: u.grantedPermissions ?? [], revokedPermissions: u.revokedPermissions ?? [] } as AuthPayload;
  return callerHasPermission(auth, "ai_workspace:admin") ? auth : null;
}

/** Bearer token → the Principal's auth (and the client), or null. Touches lastUsedAt. */
export async function verifyAccessToken(raw: string | null | undefined): Promise<{ auth: AuthPayload; clientName: string } | null> {
  if (!raw) return null;
  const t = await AiOAuthToken.findOne({ accessHash: sha256(raw), revokedAt: null, accessExpiresAt: { $gt: new Date() } }).lean();
  if (!t) return null;
  const auth = await workspaceAdminAuth(t.userId);
  if (!auth) return null;
  void AiOAuthToken.updateOne({ _id: t._id }, { $set: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { auth, clientName: t.clientName };
}

export const oauthRouter: Router = express.Router();
const form = express.urlencoded({ extended: false, limit: "64kb" });
const json = express.json({ limit: "64kb" });

oauthRouter.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json(protectedResourceMetadata(baseUrlOf(req)));
});
oauthRouter.get("/.well-known/oauth-protected-resource/mcp", (req, res) => {
  res.json(protectedResourceMetadata(baseUrlOf(req)));
});
oauthRouter.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json(authorizationServerMetadata(baseUrlOf(req)));
});

oauthRouter.post("/oauth/register", json, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown };
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (uris.length === 0 || uris.length > 10 || !uris.every(redirectUriAllowed)) {
    res.status(400).json({ error: "invalid_redirect_uri", error_description: "https redirect URIs (or http on localhost) are required" });
    return;
  }
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 200) : "MCP client";
  const clientId = randomUUID();
  await AiOAuthClient.create({ clientId, name, redirectUris: uris });
  res.status(201).json({ client_id: clientId, client_name: name, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" });
});

oauthRouter.get("/oauth/authorize", async (req: Request, res: Response) => {
  const c = await checkAuthorizeParams(req.query as Record<string, unknown>);
  if (!c.ok) {
    res.status(c.status).type("text/plain").send(c.error);
    return;
  }
  res.type("html").send(loginPage(c.params, c.clientName, null));
});

oauthRouter.post("/oauth/authorize", form, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const c = await checkAuthorizeParams(body);
  if (!c.ok) {
    res.status(c.status).type("text/plain").send(c.error);
    return;
  }
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  let login: Awaited<ReturnType<typeof staffLogin>> = null;
  try {
    login = await staffLogin({ email, password, ip: clientIpFrom((n) => req.header(n)) });
  } catch (e) {
    res.status(429).type("html").send(loginPage(c.params, c.clientName, (e as Error).message || "অনেকবার ভুল হয়েছে — পরে চেষ্টা করুন"));
    return;
  }
  if (!login) {
    res.status(401).type("html").send(loginPage(c.params, c.clientName, "ইমেইল/ফোন বা পাসওয়ার্ড মেলেনি / Wrong login"));
    return;
  }
  const auth = await workspaceAdminAuth(login.userId);
  if (!auth) {
    res.status(403).type("html").send(loginPage(c.params, c.clientName, "শুধু প্রধান শিক্ষক এই সংযোগের অনুমতি দিতে পারেন / Only the Principal can allow this"));
    return;
  }
  const code = token();
  await AiOAuthCode.create({
    codeHash: sha256(code),
    clientId: c.params.client_id,
    userId: new Types.ObjectId(login.userId),
    redirectUri: c.params.redirect_uri,
    codeChallenge: c.params.code_challenge,
    scope: MCP_SCOPE,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  await writeAudit({ eventKind: "AI_MCP_AUTHORIZED", actorId: login.userId, actorRole: login.role, targetKind: "AiOAuthClient", meta: { client: c.clientName, clientId: c.params.client_id } });
  redirectWith(res, c.params.redirect_uri, { code, ...(c.params.state ? { state: c.params.state } : {}) });
});

oauthRouter.post("/oauth/token", form, json, async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, string | undefined>;
  const bad = (error: string, status = 400) => res.status(status).json({ error });
  res.setHeader("Cache-Control", "no-store");
  if (b.grant_type === "authorization_code") {
    if (!b.code || !b.client_id || !b.redirect_uri || !b.code_verifier) return void bad("invalid_request");
    // Single use: claim the code atomically.
    const code = await AiOAuthCode.findOneAndUpdate({ codeHash: sha256(b.code), usedAt: null, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } }, { new: true }).lean();
    if (!code || code.clientId !== b.client_id || code.redirectUri !== b.redirect_uri) return void bad("invalid_grant");
    if (pkceS256(b.code_verifier) !== code.codeChallenge) return void bad("invalid_grant");
    if (!(await workspaceAdminAuth(code.userId))) return void bad("invalid_grant");
    const client = await AiOAuthClient.findOne({ clientId: code.clientId }).lean();
    res.json(await issueTokens(code.clientId, client?.name ?? "MCP client", code.userId));
    return;
  }
  if (b.grant_type === "refresh_token") {
    if (!b.refresh_token) return void bad("invalid_request");
    // Rotation: the old pair is revoked as the new one is issued.
    const old = await AiOAuthToken.findOneAndUpdate(
      { refreshHash: sha256(b.refresh_token), revokedAt: null, refreshExpiresAt: { $gt: new Date() }, ...(b.client_id ? { clientId: b.client_id } : {}) },
      { $set: { revokedAt: new Date() } },
      { new: true },
    ).lean();
    if (!old || !(await workspaceAdminAuth(old.userId))) return void bad("invalid_grant");
    res.json(await issueTokens(old.clientId, old.clientName, old.userId));
    return;
  }
  bad("unsupported_grant_type");
});
