import type { Request, Response } from "express";
import type { Role } from "@scd/shared";

export interface AuthPayload {
  userId: string;
  role: Role;
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
    return { userId: payload.userId, role: payload.role };
  } catch {
    return null;
  }
}
