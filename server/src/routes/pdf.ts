/**
 * PDF export route — GET /pdf/artifact/:id (ADR-003, ADR-009, J1.8).
 *
 * Server-side Markdown→PDF via pdfkit + NotoSansBengali font.
 * Requires content:read permission (JWT in Authorization header or query param).
 * Returns application/pdf binary.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { markdownToPdf } from "./pdfRenderer";
import { buildContext } from "../context";
import { roleHasPermission } from "@scd/shared";
import type { Role } from "@scd/shared";

export const pdfRouter: Router = createRouter();

pdfRouter.get("/artifact/:id", async (req: Request, res: Response) => {
  // Auth check: require content:read
  const ctx = buildContext(req, res);
  if (!ctx.auth || !roleHasPermission(ctx.auth.role as Role, "content:read")) {
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

  const pdfBuffer = await markdownToPdf(artifact.renderedMarkdown, { title });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="artifact_${req.params.id}.pdf"`);
  res.setHeader("Content-Length", pdfBuffer.byteLength);
  res.send(pdfBuffer);
});
