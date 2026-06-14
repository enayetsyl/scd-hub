import type { Request, Response } from "express";
import type { Role, Permission, AccessProfile } from "@scd/shared";

/** The per-request caller identity. Carries the per-user access-control overrides
 *  (AC-1, D-#193/#211) so it satisfies the shared `AccessProfile` shape — every gate
 *  resolves authority via `callerHasPermission(ctx.auth, perm)`. The three arrays ride
 *  the JWT (baked at login, AuthService); absent ⇒ undefined ⇒ treated as empty, which is
 *  exactly the identical-to-today (zero-migration) behaviour for any pre-AC token. */
export interface AuthPayload extends AccessProfile {
  userId: string;
  role: Role;
  additionalTemplates?: Role[];
  grantedPermissions?: Permission[];
  revokedPermissions?: Permission[];
}

export interface AppContext {
  req: Request;
  res: Response;
  /** Populated after JWT verification. Null = unauthenticated. */
  auth: AuthPayload | null;
}

export function buildContext(req: Request, res: Response): AppContext {
  return { req, res, auth: verifyTokenFromRequest(req) };
}

function verifyTokenFromRequest(req: Request): AuthPayload | null {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  try {
    const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");
    const secret = process.env.JWT_SECRET ?? "dev-secret";
    const payload = jwt.verify(token, secret) as AuthPayload;
    if (!payload.userId || !payload.role) return null;
    // Per-user access overrides ride the JWT (AC-1, D-#211); absent on a pre-AC token ⇒
    // undefined ⇒ the seam treats them as empty (identical-to-today). GUARDIAN tokens
    // never carry them (the guardian wall, J-AC4).
    return {
      userId: payload.userId,
      role: payload.role,
      additionalTemplates: payload.additionalTemplates,
      grantedPermissions: payload.grantedPermissions,
      revokedPermissions: payload.revokedPermissions,
    };
  } catch {
    return null;
  }
}
