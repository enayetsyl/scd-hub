/**
 * GET /pdf/mastery-assignment/:assignmentId[?studentId=…] — the weekly tailored assignment as
 * printed: one A4 page per student, or one student's page (M-4, mock T8).
 *
 * Mounted under the existing `/pdf` prefix, which the VM Caddyfile's @api matcher already
 * routes to the API (a new top-level prefix would silently serve the SPA instead).
 *
 * Gates:
 *  - staff: `mastery:view`, then the service's row rule (routine holder or `mastery:edit_all`);
 *  - guardian (M-4b): `guardian:read_child` + the guardian link to `studentId` (required), and
 *    only that child's page of a SENT assignment while the add-on is on.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { callerHasPermission } from "@scd/shared";
import { buildContext } from "../../../context";
import { assertGuardianOfStudent } from "../../../middleware/authz";
import { renderAssignmentPdf, renderAssignmentPdfForChild } from "../services/MasteryAssignmentService";
import type { Auth } from "../services/MasteryWorkService";

export const masteryAssignmentPdfRouter: Router = createRouter();

masteryAssignmentPdfRouter.get("/:assignmentId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  const studentId = typeof req.query.studentId === "string" ? req.query.studentId : null;
  try {
    let out: { pdf: Buffer; filename: string };
    if (callerHasPermission(ctx.auth, "mastery:view")) {
      out = await renderAssignmentPdf(req.params.assignmentId, studentId, ctx.auth as Auth);
    } else if (callerHasPermission(ctx.auth, "guardian:read_child") && studentId) {
      await assertGuardianOfStudent(ctx, studentId);
      out = await renderAssignmentPdfForChild(req.params.assignmentId, studentId);
    } else {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
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
    console.error(`Mastery assignment PDF failed for ${req.params.assignmentId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
