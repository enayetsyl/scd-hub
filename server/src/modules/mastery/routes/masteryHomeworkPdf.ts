/**
 * GET /pdf/mastery-homework/:paperId — the class homework / assignment sheet as printed: one sheet for the whole শাখা
 * (AL-4, AC-B3). Under the existing `/pdf` prefix (Caddy @api). Auth: `mastery:view` + the paper's row rule, or the
 * Office (`printing:view_all`) while a live print request references the paper (see `loadPaperForPdf`).
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { callerHasPermission } from "@scd/shared";
import { buildContext } from "../../../context";
import { renderHomeworkPaperPdf } from "../services/MasteryHomeworkPdf";
import type { Auth } from "../services/MasteryWorkService";

export const masteryHomeworkPdfRouter: Router = createRouter();

masteryHomeworkPdfRouter.get("/:paperId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  if (!callerHasPermission(ctx.auth, "mastery:view") && !callerHasPermission(ctx.auth, "printing:view_all")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const out = await renderHomeworkPaperPdf(req.params.paperId, ctx.auth as Auth);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${out.filename}.pdf"`);
    res.setHeader("Content-Length", out.pdf.byteLength);
    res.send(out.pdf);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "ForbiddenError") {
      res.status(403).json({ error: (err as Error).message });
      return;
    }
    if (name === "MasteryWorkError") {
      res.status(404).json({ error: (err as Error).message });
      return;
    }
    console.error(`Mastery homework PDF failed for ${req.params.paperId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
