/**
 * Report-card PDF routes — EX-9 (docs/prd-exams.md §6):
 *
 *   GET /pdf/report-card/:examId/:studentId     one card
 *   GET /pdf/report-card/:examId?classId=…      the class bundle (what Report_Cards_*.pdf is)
 *
 * A route is a SECOND FRONT DOOR, so every gate the resolver applies is re-asserted here.
 * In particular the guardian rule: a guardian may fetch a card ONLY for a linked child and
 * ONLY once the exam is published. Staff need `exam:read`. Streamed, never stored.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { callerHasPermission } from "@scd/shared";
import { buildContext } from "../../../context";
import { markdownToPdf } from "../../../routes/pdfRenderer";
import { buildReportCard, buildClassReportCards } from "../services/ReportCardService";
import { buildReportCardMarkdown, buildClassBundleMarkdown } from "../services/ReportCardSheetService";
import { isGuardianVisible } from "../services/ExamPublishService";
import { Exam } from "../models/Exam";
import { assertGuardianOfStudent } from "../../../middleware/authz";

export const reportCardPdfRouter: Router = createRouter();

/** Staff read, or a guardian of THIS child once the exam is published. */
async function assertCanReadCard(
  ctx: ReturnType<typeof buildContext>,
  examId: string,
  studentId: string | null,
): Promise<string | null> {
  if (!ctx.auth) return "Unauthenticated";

  const exam = await Exam.findById(examId);
  if (!exam) return "পরীক্ষা পাওয়া যায়নি";

  if (callerHasPermission(ctx.auth, "exam:read")) return null;

  // Guardian path — narrow and explicit. Reuses the SAME link check the portal uses
  // (`assertGuardianOfStudent`, D-#8), which also requires the link to be ACTIVE; a
  // hand-rolled GuardianLink lookup here would quietly miss that.
  if (callerHasPermission(ctx.auth, "guardian:read_child")) {
    if (!studentId) return "অভিভাবক শ্রেণির বান্ডিল দেখতে পারবেন না";
    // Publication first: an unpublished card must not even confirm a linkage.
    if (!isGuardianVisible(exam)) return "এই পরীক্ষার ফল এখনও প্রকাশিত হয়নি";
    try {
      await assertGuardianOfStudent(ctx, studentId);
    } catch (err) {
      return err instanceof Error ? err.message : "এই শিক্ষার্থীর তথ্য দেখার অনুমতি নেই";
    }
    return null;
  }
  return "পরীক্ষার তথ্য দেখার অনুমতি নেই";
}

reportCardPdfRouter.get("/:examId/:studentId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  const { examId, studentId } = req.params;

  const denial = await assertCanReadCard(ctx, examId, studentId);
  if (denial) {
    res.status(denial === "Unauthenticated" ? 401 : 403).json({ error: denial });
    return;
  }

  try {
    const card = await buildReportCard(examId, studentId);
    const pdf = await markdownToPdf(buildReportCardMarkdown(card), {
      title: `${card.student.name} — ${card.examName}`,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="report_card_${card.student.schoolId}.pdf"`);
    res.setHeader("Content-Length", pdf.byteLength);
    res.send(pdf);
  } catch (err) {
    console.error(`Report-card PDF failed for ${examId}/${studentId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});

reportCardPdfRouter.get("/:examId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  const { examId } = req.params;
  const classId = typeof req.query.classId === "string" ? req.query.classId : null;
  if (!classId) {
    res.status(400).json({ error: "classId is required for a class bundle" });
    return;
  }

  const denial = await assertCanReadCard(ctx, examId, null);
  if (denial) {
    res.status(denial === "Unauthenticated" ? 401 : 403).json({ error: denial });
    return;
  }

  try {
    const cards = await buildClassReportCards(examId, classId);
    if (!cards.length) {
      res.status(404).json({ error: "এই শ্রেণিতে কোনো শিক্ষার্থী নেই" });
      return;
    }
    const pdf = await markdownToPdf(buildClassBundleMarkdown(cards), {
      title: `${cards[0].examName} — class bundle`,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="report_cards_${classId}.pdf"`);
    res.setHeader("Content-Length", pdf.byteLength);
    res.send(pdf);
  } catch (err) {
    console.error(`Report-card bundle failed for ${examId}/${classId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
