/**
 * GET /pdf/mastery-assignment/:assignmentId[?studentId=…] — the weekly tailored assignment as
 * printed: one A4 page per student, or one student's page (M-4, mock T8).
 *
 * Mounted under the existing `/pdf` prefix, which the VM Caddyfile's @api matcher already
 * routes to the API (a new top-level prefix would silently serve the SPA instead).
 *
 * Gate: `mastery:view` here, then the service's row rule (routine holder or `mastery:edit_all`).
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { callerHasPermission } from "@scd/shared";
import { buildContext } from "../../../context";
import { renderAssignmentPdf } from "../services/MasteryAssignmentService";
import type { Auth } from "../services/MasteryWorkService";

export const masteryAssignmentPdfRouter: Router = createRouter();

masteryAssignmentPdfRouter.get("/:assignmentId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  if (!callerHasPermission(ctx.auth, "mastery:view")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const studentId = typeof req.query.studentId === "string" ? req.query.studentId : null;
  try {
    const { pdf, filename } = await renderAssignmentPdf(req.params.assignmentId, studentId, ctx.auth as Auth);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`);
    res.setHeader("Content-Length", pdf.byteLength);
    res.send(pdf);
  } catch (err) {
    if (err instanceof Error && err.name === "MasteryWorkError") {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error(`Mastery assignment PDF failed for ${req.params.assignmentId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
