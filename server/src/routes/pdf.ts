/**
 * PDF export route — GET /pdf/artifact/:id (ADR-003, ADR-009, J1.8).
 *
 * Server-side Markdown→PDF via pdfkit + NotoSansBengali font.
 * Returns application/pdf binary. JWT in Authorization header or query param.
 *
 * GATE — `content:read`, PLUS one print-scoped exception (D-#281): the Office holds
 * `roster:manage` but NOT `content:read`, yet it must open the plan a teacher sent to
 * the print queue. So a `roster:manage` caller may render an artifact **iff a live
 * PrintRequest references it**. That is the narrowest possible widening — it opens
 * exactly the plans submitted for printing and nothing else in the content plane.
 * Mirrors the `print_upload` branch of `GET /files/:id`.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { PrintRequest } from "../modules/printing/models/PrintRequest";
import { markdownToPdf } from "./pdfRenderer";
import { buildContext, type AppContext } from "../context";
import { callerHasPermission } from "@scd/shared";

/** True when the caller may render this artifact (see the gate note above). */
export async function mayRenderArtifact(ctx: AppContext, artifactId: string): Promise<boolean> {
  if (!ctx.auth) return false;
  if (callerHasPermission(ctx.auth, "content:read")) return true;
  if (!callerHasPermission(ctx.auth, "roster:manage")) return false;
  // Print operator: ONLY artifacts actually queued for printing. Cancelling the job
  // withdraws the access again.
  const queued = await PrintRequest.exists({
    contentArtifactId: artifactId,
    status: { $ne: "CANCELLED" },
  });
  return queued !== null;
}

export const pdfRouter: Router = createRouter();

pdfRouter.get("/artifact/:id", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!(await mayRenderArtifact(ctx, req.params.id))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const artifact = await ContentArtifact.findById(req.params.id).lean();
  if (!artifact) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }

  if (!artifact.renderedMarkdown) {
    res.status(422).json({ error: "Artifact has no rendered_markdown (question/stimulus types have no PDF)" });
    return;
  }

  const title = artifact.address?.title
    ? `${artifact.subject} — ${artifact.address.anchorWord} ${artifact.address.number}: ${artifact.address.title}`
    : `${artifact.subject} — ${artifact.address?.anchorWord} ${artifact.address?.number}`;

  // Render is isolated in try/catch: a renderer/font failure must return 500, never
  // reject out of the async handler and crash the Node process (Express 4 does not
  // catch async errors). Headers aren't sent until the buffer is ready, so 500 is safe.
  try {
    const pdfBuffer = await markdownToPdf(artifact.renderedMarkdown, { title });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="artifact_${req.params.id}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.byteLength);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(`PDF render failed for artifact ${req.params.id}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
