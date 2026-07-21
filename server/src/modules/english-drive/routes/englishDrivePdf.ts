/**
 * English Drive PDF route — GET /pdf/english-drive/:id (D-#344, PRD §6 ED-1).
 *
 * Renders the doc's stored markdown through the EXISTING A4 engine
 * (routes/pdfRenderer.ts — pdfkit + NotoSansBengali), owner decision #8: the
 * app's existing PDF style, no Word pixel-matching.
 *
 * GATE — same read scope as the GraphQL library: Principal/Office, or a
 * teacher with an English involvement in the doc's class. Guardians 403.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { buildContext } from "../../../context";
import { markdownToPdf } from "../../../routes/pdfRenderer";
import { englishDriveDocById } from "../services/EnglishDriveService";

export const englishDrivePdfRouter: Router = createRouter();

englishDrivePdfRouter.get("/:id", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  let doc;
  try {
    doc = await englishDriveDocById(ctx, req.params.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Forbidden";
    const status = err instanceof Error && err.name === "ForbiddenError" ? 403 : 404;
    res.status(status).json({ error: msg });
    return;
  }

  // Render is isolated in try/catch: a renderer/font failure must return 500, never
  // reject out of the async handler and crash the Node process (Express 4 does not
  // catch async errors).
  try {
    const blockPart = doc.blockNumber === null ? "" : ` · Block ${doc.blockNumber}`;
    const title = `English Drive — Class ${doc.classLevel}${blockPart} · ${doc.kind}: ${doc.title}`;
    const pdfBuffer = await markdownToPdf(doc.contentMd ?? "", { title });
    const blockTag = doc.blockNumber === null ? "" : `_B${doc.blockNumber}`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="english_drive_C${doc.classLevel}${blockTag}_${doc.kind}_v${doc.version}.pdf"`,
    );
    res.setHeader("Content-Length", pdfBuffer.byteLength);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(`PDF render failed for English Drive doc ${req.params.id}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
