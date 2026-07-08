/**
 * Set PDF renderer — GET /pdf/set/:id (J3.4, ADR-003, ADR-009).
 *
 * Renders an assembled AssessmentSet to PDF using pdfkit + NotoSansBengali.
 * Questions do NOT have rendered_markdown (ADR-006: no re-render from JSON for
 * plans; questions have no markdown surface). Instead we render structured fields
 * from each question's envelopeJson.payload directly.
 *
 * Rendered per question: number, marks, question_text, answer-carrier
 * (options for MCQ, tf_answer for T/F, blanks, pairs, answer_key/rubric
 *  rendered as meta lines for the teacher's answer sheet).
 *
 * Requires set:read permission (JWT in Authorization header or query param).
 */
import PDFDocument from "pdfkit";
import * as path from "path";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { mixedText } from "../../../routes/pdfRenderer";
import { AssessmentSet } from "../models/AssessmentSet";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { buildContext } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import type { IAssessmentSet, BasketItem } from "../models/AssessmentSet";
import type { FlattenMaps, Types } from "mongoose";

type LeanSet = FlattenMaps<IAssessmentSet> & { _id: Types.ObjectId };

const FONT_PATH = path.resolve(__dirname, "../../../../assets/fonts/NotoSansBengali-Regular.ttf");

export const setPdfRouter: Router = createRouter();

setPdfRouter.get("/:id", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth || !callerHasPermission(ctx.auth, "set:read")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const set = await AssessmentSet.findById(req.params.id).lean() as LeanSet | null;
  if (!set) {
    res.status(404).json({ error: "Assessment set not found" });
    return;
  }
  if (set.status !== "assembled") {
    res.status(422).json({ error: "Set is not yet assembled" });
    return;
  }

  const items = (set.basketItems ?? []) as unknown as BasketItem[];

  // Fetch all question artifacts in basket order
  const artifactIds = items.map((item) => item.artifactId);
  const artifactsMap = new Map<string, Record<string, unknown>>();
  const artifacts = await ContentArtifact.find({ _id: { $in: artifactIds } }).lean();
  for (const a of artifacts) {
    artifactsMap.set(a._id.toString(), a.envelopeJson as Record<string, unknown>);
  }

  // Answer-key vs student-copy toggles (J3.4, default OFF = student copy). The client
  // sends answers=1 / marks=1 from the Set-detail switches; absent params → student paper.
  const truthy = (v: unknown): boolean => v === "1" || v === "true";
  const opts: RenderOptions = {
    showAnswers: truthy(req.query.answers),
    showMarks: truthy(req.query.marks),
  };

  // Isolate the render: a renderer/font failure returns 500 instead of rejecting
  // out of the async handler and crashing the Node process (Express 4 quirk).
  try {
    const pdfBuffer = await renderSetToPdf(set, items, artifactsMap, opts);
    const filename = `set_${req.params.id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.byteLength);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(`PDF render failed for set ${req.params.id}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});

// ---------------------------------------------------------------------------
// PDF renderer
// ---------------------------------------------------------------------------

interface RenderOptions {
  /** Render answer carriers (MCQ ✓, T/F answer, accepted blanks, matched pairs, keys). */
  showAnswers: boolean;
  /** Render per-question [marks] and the total-marks meta line. */
  showMarks: boolean;
}

async function renderSetToPdf(
  set: LeanSet,
  items: BasketItem[],
  artifactsMap: Map<string, Record<string, unknown>>,
  opts: RenderOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const setTypeName = set.setType === "CT" ? "শ্রেণি পরীক্ষা" :
                        set.setType === "HW" ? "বাড়ির কাজ" : "অ্যাসাইনমেন্ট";
    const totalMarks = typeof set.totalMarks === "number" ? set.totalMarks :
      items.reduce((s, i) => s + i.marks, 0);

    const doc = new PDFDocument({
      margin: 50,
      size: "A4",
      info: {
        Title: opts.showMarks ? `${setTypeName} — ${totalMarks} marks` : setTypeName,
        Creator: "SCD Hub",
      },
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("NotoSansBengali", FONT_PATH);
    doc.font("NotoSansBengali");

    // Title block
    doc.fontSize(16);
    mixedText(doc, setTypeName, { align: "center" });
    doc.moveDown(0.2);

    const metaLine: string[] = [];
    if (set.setType === "CT") {
      if (totalMarks && opts.showMarks) metaLine.push(`মোট নম্বর: ${totalMarks}`);
      if (set.durationMinutes) metaLine.push(`সময়: ${set.durationMinutes} মিনিট`);
    } else {
      if (set.dueDate) {
        const due = (set.dueDate as unknown as Date);
        metaLine.push(`জমার তারিখ: ${due instanceof Date ? due.toLocaleDateString("bn-BD") : String(due)}`);
      }
    }
    if (metaLine.length > 0) {
      doc.fontSize(10);
      mixedText(doc, metaLine.join("   |   "), { align: "center" });
      doc.moveDown(0.3);
    }

    // Separator
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke().moveDown(0.5);

    // Questions
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const env = artifactsMap.get(item.artifactId.toString());
      if (!env) continue;
      const payload = (env.payload ?? {}) as Record<string, unknown>;
      renderQuestion(doc, i + 1, item.marks, payload, opts);
    }

    doc.end();
  });
}

function renderQuestion(
  doc: PDFKit.PDFDocument,
  num: number,
  marks: number,
  payload: Record<string, unknown>,
  opts: RenderOptions,
): void {
  const questionText = String(payload.question_text ?? "");
  const questionType = String(payload.question_type ?? "");

  // Question stem line (mixed Bengali/Latin via the shared fallback renderer)
  doc.fontSize(11);
  const marksSuffix = opts.showMarks ? `   [${marks} marks]` : "";
  mixedText(doc, `${num}. ${questionText}${marksSuffix}`, { lineGap: 2 });
  doc.moveDown(0.2);

  // MCQ options are part of the QUESTION (students need them), so they always render;
  // the ✓ on the correct option is the ANSWER, gated by showAnswers. Every other
  // carrier IS the answer, so the whole block is gated.
  if (questionType === "mcq") {
    const options = (payload.options as Array<Record<string, unknown>>) ?? [];
    for (const opt of options) {
      const isCorrect = opts.showAnswers && opt.is_correct ? " ✓" : "";
      doc.fontSize(10);
      mixedText(doc, `    ${String(opt.option_id ?? "")}. ${String(opt.text ?? "")}${isCorrect}`, { lineGap: 1 });
    }
  } else if (opts.showAnswers && questionType === "true_false") {
    const answer = payload.tf_answer === true ? "সত্য (True)" : "মিথ্যা (False)";
    doc.fontSize(10);
    mixedText(doc, `    উত্তর: ${answer}`, { lineGap: 1 });
  } else if (opts.showAnswers && questionType === "fill_blank") {
    const blanks = (payload.blanks as Array<Record<string, unknown>>) ?? [];
    for (const b of blanks) {
      const accepted = Array.isArray(b.accepted) ? (b.accepted as string[]).join(" / ") : "";
      doc.fontSize(10);
      mixedText(doc, `    শূন্যস্থান ${String(b.blank_no ?? "")}: ${accepted}`, { lineGap: 1 });
    }
  } else if (opts.showAnswers && questionType === "matching") {
    const pairs = (payload.pairs as Array<Record<string, unknown>>) ?? [];
    for (const p of pairs) {
      doc.fontSize(10);
      mixedText(doc, `    ${String(p.left ?? "")}  →  ${String(p.right ?? "")}`, { lineGap: 1 });
    }
  } else if (opts.showAnswers && questionType === "short_answer") {
    const ak = (payload.answer_key ?? {}) as Record<string, unknown>;
    const accepted = Array.isArray(ak.accepted) ? (ak.accepted as string[]).join(" / ") : "";
    doc.fontSize(10);
    mixedText(doc, `    উত্তর: ${accepted}`, { lineGap: 1 });
    if (ak.model_note) {
      doc.fontSize(9).fillColor("#444444");
      mixedText(doc, `    নোট: ${String(ak.model_note)}`, { lineGap: 1 });
      doc.fillColor("#000000");
    }
  } else if (opts.showAnswers && questionType === "descriptive") {
    doc.fontSize(10).fillColor("#444444");
    mixedText(doc, "    [বর্ণনামূলক — রুব্রিক দেখুন]", { lineGap: 1 });
    doc.fillColor("#000000");
  }

  doc.moveDown(0.5);
}
