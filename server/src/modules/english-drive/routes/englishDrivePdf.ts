/**
 * English Drive PDF routes (D-#344 ED-1; D-#348 edit-before-print):
 *
 *   GET  /pdf/english-drive/:id        — render the STORED doc. Read-scoped like
 *        the library. Optional layout query params ?fontScale=&lineSpacing=&margin=
 *        let a teacher tweak spacing/size without editing the content.
 *   POST /pdf/english-drive/render     — render SUPPLIED (edited) markdown + layout
 *        to PDF, for "edit before print". No storage; the content is the caller's
 *        own edit, so auth (non-guardian) is the only gate — nothing stored is read.
 *
 * Both render through the EXISTING A4 engine (routes/pdfRenderer.ts — pdfkit +
 * NotoSansBengali). Layout knobs are clamped in the renderer (resolveLayout).
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter, json } from "express";
import { buildContext } from "../../../context";
import { markdownToPdf } from "../../../routes/pdfRenderer";
import { ENGLISH_DRIVE_MD_MAX_BYTES } from "../models/EnglishDriveDoc";
import { englishDriveDocById, formatBlockTag } from "../services/EnglishDriveService";

export const englishDrivePdfRouter: Router = createRouter();

/** Pull the optional layout knobs off a query string / JSON body (NaN → undefined,
 *  so the renderer applies its defaults and clamps the rest). */
function layoutFrom(src: Record<string, unknown>): {
  fontScale?: number;
  lineSpacing?: number;
  margin?: number;
} {
  const num = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  return { fontScale: num(src.fontScale), lineSpacing: num(src.lineSpacing), margin: num(src.margin) };
}

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
    const blockTag = formatBlockTag(doc); // "B3-5" / "B3" / "" (D-#347: PT covers many)
    const blockPart = blockTag ? ` · ${blockTag.replace(/^B/, "Block ")}` : "";
    const title = `English Drive — Class ${doc.classLevel}${blockPart} · ${doc.kind}: ${doc.title}`;
    const pdfBuffer = await markdownToPdf(doc.contentMd ?? "", { title, ...layoutFrom(req.query) });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="english_drive_C${doc.classLevel}${blockTag ? `_${blockTag}` : ""}_${doc.kind}_v${doc.version}.pdf"`,
    );
    res.setHeader("Content-Length", pdfBuffer.byteLength);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(`PDF render failed for English Drive doc ${req.params.id}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});

// Edit-before-print: render the caller's edited markdown with their layout knobs.
englishDrivePdfRouter.post("/render", json({ limit: "2mb" }), async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth || ctx.auth.role === "GUARDIAN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  if (markdown.trim() === "") {
    res.status(400).json({ error: "No content to render" });
    return;
  }
  if (Buffer.byteLength(markdown, "utf8") > ENGLISH_DRIVE_MD_MAX_BYTES) {
    res.status(413).json({ error: "Content too large" });
    return;
  }
  const title = typeof body.title === "string" && body.title.trim() ? body.title : "English Drive";

  try {
    const pdfBuffer = await markdownToPdf(markdown, { title, ...layoutFrom(body) });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="english_drive_edited.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.byteLength);
    res.send(pdfBuffer);
  } catch (err) {
    console.error("PDF render failed for edited English Drive content:", err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
