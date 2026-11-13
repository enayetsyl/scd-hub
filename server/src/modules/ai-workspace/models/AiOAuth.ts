import { Schema, model, Document, Types } from "mongoose";

/**
 * The MCP bridge's OAuth 2.1 store (AI Workspace W-5, docs/prd-ai-workspace.md §7; D-#1214).
 * The Hub is its own authorization server for ONE resource, `/mcp`, and the Hub login is the
 * identity. Only the Principal (`ai_workspace:admin`) can authorise a client.
 *
 *   AiOAuthClient  a dynamically registered public client (RFC 7591) — Claude's connector,
 *                  Claude Code. No secret (PKCE instead).
 *   AiOAuthCode    one authorization code: single use, 10 minutes, bound to the client, the
 *                  redirect URI and the PKCE S256 challenge.
 *   AiOAuthToken   an access token (1 hour) + refresh token (30 days, rotated on use). Only
 *                  SHA-256 hashes are stored — a database copy cannot be replayed.
 *   AiMcpCall      one tool call: which tool, the reply size sent to Claude (PRD §7 "log the
 *                  size of every reply"), ok or not. No arguments, no text.
 *
 * Data assistant DA-3 (docs/prd-data-assistant-mcp.md §4.4, D-#1536): codes and tokens are bound
 * to ONE resource — "workspace" (`/mcp`, the default, so existing rows keep working with no
 * migration) or "data" (`/mcp/data`). A token of one resource is refused at the other. Data
 * tokens also carry `grantedAt` (the first sign-in, kept across refresh rotations) for the
 * 90-day absolute limit.
 */
export const OAUTH_RESOURCES = ["workspace", "data"] as const;
export type OAuthResource = (typeof OAUTH_RESOURCES)[number];
export interface IAiOAuthClient extends Document {
  _id: Types.ObjectId;
  clientId: string;
  name: string;
  redirectUris: string[];
  createdAt: Date;
}

const AiOAuthClientSchema = new Schema<IAiOAuthClient>(
  {
    clientId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    redirectUris: { type: [String], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
export const AiOAuthClient = model<IAiOAuthClient>("AiOAuthClient", AiOAuthClientSchema);

export interface IAiOAuthCode extends Document {
  _id: Types.ObjectId;
  codeHash: string;
  clientId: string;
  userId: Types.ObjectId;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource?: OAuthResource;
  expiresAt: Date;
  usedAt?: Date | null;
}

const AiOAuthCodeSchema = new Schema<IAiOAuthCode>(
  {
    codeHash: { type: String, required: true, unique: true },
    clientId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    redirectUri: { type: String, required: true },
    codeChallenge: { type: String, required: true },
    scope: { type: String, default: "mcp" },
    resource: { type: String, enum: OAUTH_RESOURCES, default: "workspace" },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { versionKey: false },
);
// Codes clean themselves up an hour after they expire.
AiOAuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
export const AiOAuthCode = model<IAiOAuthCode>("AiOAuthCode", AiOAuthCodeSchema);

export interface IAiOAuthToken extends Document {
  _id: Types.ObjectId;
  accessHash: string;
  refreshHash: string;
  clientId: string;
  clientName: string;
  userId: Types.ObjectId;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  revokedAt?: Date | null;
  lastUsedAt?: Date | null;
  resource?: OAuthResource;
  /** The first authorisation of this connection, carried across rotations (90-day limit). */
  grantedAt?: Date | null;
  createdAt: Date;
}

const AiOAuthTokenSchema = new Schema<IAiOAuthToken>(
  {
    accessHash: { type: String, required: true, unique: true },
    refreshHash: { type: String, required: true, unique: true },
    clientId: { type: String, required: true },
    clientName: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    accessExpiresAt: { type: Date, required: true },
    refreshExpiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    resource: { type: String, enum: OAUTH_RESOURCES, default: "workspace" },
    grantedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
AiOAuthTokenSchema.index({ refreshExpiresAt: 1 }, { expireAfterSeconds: 7 * 86400 });
AiOAuthTokenSchema.index({ userId: 1, revokedAt: 1 });
export const AiOAuthToken = model<IAiOAuthToken>("AiOAuthToken", AiOAuthTokenSchema);

export interface IAiMcpCall extends Document {
  _id: Types.ObjectId;
  at: Date;
  userId: Types.ObjectId;
  clientName: string;
  tool: string;
  ok: boolean;
  /** UTF-8 bytes of the reply sent to Claude. */
  replyBytes: number;
  ms: number;
}

const AiMcpCallSchema = new Schema<IAiMcpCall>(
  {
    at: { type: Date, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientName: { type: String, required: true },
    tool: { type: String, required: true },
    ok: { type: Boolean, required: true },
    replyBytes: { type: Number, required: true },
    ms: { type: Number, required: true },
  },
  { versionKey: false },
);
AiMcpCallSchema.index({ at: -1 });
export const AiMcpCall = model<IAiMcpCall>("AiMcpCall", AiMcpCallSchema);
