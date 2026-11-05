/**
 * Activity-sheet file routes (AS-1.., docs/prd-activity-sheets.md), registered on the files
 * router BEFORE `/:id` so the id route never sees these paths.
 *
 *  POST /files/activity-bank   — activity_sheets:manage. multipart: csv (index CSV, required for a
 *      new bank), sheets (the bank PDF), answers (the answer PDF), nameBn, nameEn, skillArea,
 *      bankNo, code (which bank of a combined CSV). With bankId → attach PDFs to that bank.
 *  POST /files/activity-sheets — activity_sheets:manage. multipart: file (PDF) + bankId + levels
 *      ("E" for all pages, or "E,E,M" one per page) + details ("a|b|c") → new sheets; or
 *      file + sheetId → replace that sheet's page.
 */
import type { Request, Response, Router } from "express";
import type express from "express";
import multer from "multer";
import { callerHasPermission, type ActivityLevel } from "@scd/shared";
import { buildContext } from "../context";
import {
  ActivityError,
  ACTIVITY_ERRORS_BN,
  addSheets,
  attachBankPdfs,
  importBank,
  replaceSheet,
} from "../modules/activity-sheets/services/ActivityBankService";
import { printRunPdf } from "../modules/activity-sheets/services/ActivityCornerService";
import { batchPdf } from "../modules/activity-sheets/services/ActivityGuardianService";

/** A stock run prints plain; a morning batch (AS-3) adds names + cover slips. */
async function printRunPdfFor(runId: string): Promise<Buffer> {
  return runId.startsWith("batch-") ? batchPdf(runId) : printRunPdf(runId);
}

export const ACTIVITY_MAX_PDF_BYTES = 60 * 1024 * 1024;

const uploadActivity = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ACTIVITY_MAX_PDF_BYTES + 1 },
});

const parseBankUpload: express.RequestHandler = (req, res, next) => {
  uploadActivity.fields([
    { name: "csv", maxCount: 1 },
    { name: "sheets", maxCount: 1 },
    { name: "answers", maxCount: 1 },
  ])(req, res, (err: unknown) => {
    if (err) {
      res.status(422).json({ error: "ফাইল খুব বড় (সর্বোচ্চ 60 MB)" });
      return;
    }
    next();
  });
};

const parseSheetUpload: express.RequestHandler = (req, res, next) => {
  uploadActivity.single("file")(req, res, (err: unknown) => {
    if (err) {
      res.status(422).json({ error: "ফাইল খুব বড় (সর্বোচ্চ 60 MB)" });
      return;
    }
    next();
  });
};

type Files = Record<string, Express.Multer.File[] | undefined>;

function pdfOf(f: Express.Multer.File | undefined): Buffer | null {
  if (!f) return null;
  if (f.mimetype !== "application/pdf" && !/\.pdf$/i.test(f.originalname)) throw new ActivityError(ACTIVITY_ERRORS_BN.pdfNeeded);
  return f.buffer;
}

function canManage(req: Request, res: Response): string | null {
  const ctx = buildContext(req, res);
  if (!ctx.auth || !callerHasPermission(ctx.auth, "activity_sheets:manage")) {
    res.status(403).json({ error: ACTIVITY_ERRORS_BN.forbidden });
    return null;
  }
  return ctx.auth.userId;
}

async function answer(res: Response, fn: () => Promise<unknown>): Promise<void> {
  try {
    res.json(await fn());
  } catch (e) {
    if (e instanceof ActivityError) {
      res.status(422).json({ error: e.message });
      return;
    }
    throw e;
  }
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v !== undefined && v !== null && String(v).trim() !== "" && Number.isFinite(n) ? n : null;
};

export function registerActivityFileRoutes(router: Router): void {
  // GET /files/activity-print?runId=… — one print run as a PDF (tray stock: AS-2; a morning
  // batch with names: AS-3). activity_sheets:manage. Built on demand from the run's copies.
  router.get("/activity-print", async (req: Request, res: Response) => {
    const actorId = canManage(req, res);
    if (!actorId) return;
    const runId = typeof req.query.runId === "string" ? req.query.runId : "";
    try {
      const pdf = await printRunPdfFor(runId);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="activity-${runId.slice(0, 20)}.pdf"`);
      res.send(pdf);
    } catch (e) {
      if (e instanceof ActivityError) {
        res.status(422).json({ error: e.message });
        return;
      }
      throw e;
    }
  });

  router.post("/activity-bank", parseBankUpload, async (req: Request, res: Response) => {
    const actorId = canManage(req, res);
    if (!actorId) return;
    const files = (req.files ?? {}) as Files;
    await answer(res, async () => {
      const sheets = pdfOf(files.sheets?.[0]);
      const answers = pdfOf(files.answers?.[0]);
      if (req.body?.bankId) {
        const bank = await attachBankPdfs(String(req.body.bankId), sheets, answers, actorId);
        return { bankId: bank._id.toString(), code: bank.code };
      }
      const csv = files.csv?.[0];
      if (!csv) throw new ActivityError(ACTIVITY_ERRORS_BN.noRows);
      const r = await importBank({
        actorId,
        nameBn: String(req.body?.nameBn ?? ""),
        nameEn: req.body?.nameEn ? String(req.body.nameEn) : null,
        skillArea: String(req.body?.skillArea ?? ""),
        bankNo: num(req.body?.bankNo),
        sortOrder: num(req.body?.sortOrder),
        code: req.body?.code ? String(req.body.code) : null,
        csvText: csv.buffer.toString("utf8"),
        sheetPdf: sheets,
        answerPdf: answers,
      });
      return { bankId: r.bank._id.toString(), code: r.bank.code, sheets: r.sheets, answersFound: r.answersFound, warnings: r.warnings };
    });
  });

  router.post("/activity-sheets", parseSheetUpload, async (req: Request, res: Response) => {
    const actorId = canManage(req, res);
    if (!actorId) return;
    await answer(res, async () => {
      const pdf = pdfOf(req.file);
      if (!pdf) throw new ActivityError(ACTIVITY_ERRORS_BN.pdfNeeded);
      if (req.body?.sheetId) {
        const s = await replaceSheet(String(req.body.sheetId), pdf, actorId);
        return { sheetId: s._id.toString(), itemId: s.itemId, replaced: true };
      }
      const levels = String(req.body?.levels ?? "")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((l) => l.toUpperCase()) as ActivityLevel[];
      const details = req.body?.details ? String(req.body.details).split("|") : null;
      const made = await addSheets(String(req.body?.bankId ?? ""), pdf, levels, details, actorId);
      return { added: made.length, itemIds: made.map((m) => m.itemId) };
    });
  });
}
