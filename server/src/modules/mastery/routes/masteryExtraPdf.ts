/**
 * GET /pdf/mastery-extra/:paperId — the extra-homework sheet as printed: one A4 page per child on it
 * (PR-J, D-#1420). Same auth pattern as the weekly assignment PDF: `mastery:view`, then the service's
 * row rule (routine holder or `mastery:edit_all`). Under the existing `/pdf` prefix (Caddy @api).
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { callerHasPermission } from "@scd/shared";
import { buildContext } from "../../../context";
import { renderExtraHomeworkPdf } from "../services/MasteryExtraPdf";
import type { Auth } from "../services/MasteryWorkService";

export const masteryExtraPdfRouter: Router = createRouter();

masteryExtraPdfRouter.get("/:paperId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  if (!callerHasPermission(ctx.auth, "mastery:view")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const out = await renderExtraHomeworkPdf(req.params.paperId, ctx.auth as Auth);
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
    console.error(`Mastery extra-homework PDF failed for ${req.params.paperId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
