/**
 * GET /pdf/worksheet/:id[?answers=1] — a stored worksheet (D-#747), as printed or as
 * the teacher's answer key.
 *
 * Mounted under the existing `/pdf` prefix, which the VM Caddyfile's @api matcher
 * already routes to the API — a new top-level prefix would silently 200 the SPA's
 * index.html instead (the D-#… Caddy allowlist lesson).
 *
 * Read gate lives in the service (`worksheetForRead`): the creator, the teacher it
 * was made for, or roster:manage.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { buildContext } from "../../../context";
import { renderStoredWorksheet } from "../services/WorksheetService";

export const worksheetPdfRouter: Router = createRouter();

worksheetPdfRouter.get("/:id", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  const answers = req.query.answers === "1" || req.query.answers === "true";
  let pdf: Buffer;
  try {
    pdf = await renderStoredWorksheet(ctx, req.params.id, answers);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const msg = err instanceof Error ? err.message : "Not found";
    if (name === "ForbiddenError") {
      res.status(403).json({ error: msg });
    } else if (name === "WorksheetError") {
      res.status(404).json({ error: msg });
    } else {
      console.error(`Worksheet PDF render failed for ${req.params.id}:`, err);
      res.status(500).json({ error: "Could not generate the PDF" });
    }
    return;
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="worksheet_${req.params.id}${answers ? "_answers" : ""}.pdf"`);
  res.setHeader("Content-Length", pdf.byteLength);
  res.send(pdf);
});
