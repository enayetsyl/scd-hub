/**
 * GET /pdf/worksheet/:id[?answers=1] — a stored worksheet (D-#747), as printed or as
 * the teacher's answer key.
 * POST /pdf/worksheet/preview[?answers=1] — the paper on screen (the preview's own
 * arguments as JSON), rendered without saving or printing it (owner 2026-10-17).
 *
 * Mounted under the existing `/pdf` prefix, which the VM Caddyfile's @api matcher
 * already routes to the API — a new top-level prefix would silently 200 the SPA's
 * index.html instead (the D-#… Caddy allowlist lesson).
 *
 * Read gate lives in the service (`worksheetForRead`): the creator, the teacher it
 * was made for, or roster:manage. The preview gate is the generator's own.
 */
import type { Router, Request, Response } from "express";
import express, { Router as createRouter } from "express";
import { buildContext } from "../../../context";
import { renderPreviewWorksheet, renderStoredWorksheet, type GenerateArgs } from "../services/WorksheetService";

export const worksheetPdfRouter: Router = createRouter();

function sendPdf(res: Response, pdf: Buffer, filename: string): void {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`);
  res.setHeader("Content-Length", pdf.byteLength);
  res.send(pdf);
}

function sendError(res: Response, err: unknown, what: string): void {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : "Not found";
  if (name === "ForbiddenError") {
    res.status(403).json({ error: msg });
  } else if (name === "WorksheetError") {
    res.status(404).json({ error: msg });
  } else {
    console.error(`Worksheet PDF render failed for ${what}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** The preview's GraphQL arguments, re-checked here since a REST body has no schema. */
function previewArgs(body: unknown): GenerateArgs | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const classId = str(b.classId);
  const subject = str(b.subject);
  const kind = str(b.kind);
  const seed = int(b.seed);
  if (!classId || !subject || !kind || seed == null) return null;
  const rows = Array.isArray(b.rows)
    ? b.rows.flatMap((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        const seq = int(o.seq);
        const count = int(o.count);
        if (seq == null || count == null) return [];
        const ranges = Array.isArray(o.ranges)
          ? o.ranges.map((x) => {
              const q = (x ?? {}) as Record<string, unknown>;
              return { from: str(q.from) ?? "", to: str(q.to) ?? "" };
            })
          : undefined;
        return [{ seq, count, ...(ranges ? { ranges } : {}) }];
      })
    : null;
  return {
    classId,
    subject,
    kind,
    seed,
    rows,
    letterUpTo: int(b.letterUpTo),
    numberUpTo: int(b.numberUpTo),
    letters: Array.isArray(b.letters) ? b.letters.filter((x): x is string => typeof x === "string") : null,
    title: str(b.title),
    subtitle: str(b.subtitle),
    meta: str(b.meta),
  };
}

worksheetPdfRouter.post("/preview", express.json({ limit: "64kb" }), async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  const args = previewArgs(req.body);
  if (!args) {
    res.status(400).json({ error: "Invalid worksheet" });
    return;
  }
  const answers = req.query.answers === "1" || req.query.answers === "true";
  let pdf: Buffer;
  try {
    pdf = await renderPreviewWorksheet(ctx, args, answers);
  } catch (err) {
    sendError(res, err, "preview");
    return;
  }
  sendPdf(res, pdf, `worksheet_${args.subject}_${args.seed}${answers ? "_answers" : ""}`);
});

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
    sendError(res, err, req.params.id);
    return;
  }
  sendPdf(res, pdf, `worksheet_${req.params.id}${answers ? "_answers" : ""}`);
});
