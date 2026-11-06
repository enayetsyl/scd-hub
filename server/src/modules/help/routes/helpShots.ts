/**
 * GET /files/help/:guideId/:file — one help-guide screenshot (prd-help-centre HC-1).
 *
 * Under the existing /files prefix, so the VM Caddyfile's @api matcher already routes it.
 * Login required. The picture is served only when it belongs to a guide the caller may
 * see (the same filter as myHelpGuides); anything else is a 404, so the route never
 * confirms that a guide exists for someone it is not meant for.
 */
import { Router, type Request, type Response } from "express";
import { buildContext } from "../../../context";
import { shotPathFor } from "../services/HelpGuideService";

export const helpShotsRouter = Router();

helpShotsRouter.get("/:guideId/:file", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(403).json({ error: "লগইন করা নেই" });
    return;
  }
  let abs: string | null;
  try {
    // Async since D-#1011: a guardian's guides depend on the features switched on for them.
    abs = await shotPathFor(ctx.auth, String(req.params.guideId), String(req.params.file));
  } catch {
    res.status(500).json({ error: "ছবিটি খোলা যায়নি" });
    return;
  }
  if (!abs) {
    res.status(404).json({ error: "ছবিটি পাওয়া যায়নি" });
    return;
  }
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(abs);
});
