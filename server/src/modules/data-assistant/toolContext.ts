/**
 * AuthPayload → the AppContext the existing gates take (assertCanRead, assertReportRead …).
 * Those gates read `ctx.auth` only; `req`/`res` are empty placeholders and are never used.
 */
import type { Request, Response } from "express";
import type { AppContext, AuthPayload } from "../../context";

export function toolContext(auth: AuthPayload): AppContext {
  return { req: {} as Request, res: {} as Response, auth, clientIp: null };
}
