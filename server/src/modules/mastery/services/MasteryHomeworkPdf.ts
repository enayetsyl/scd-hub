/**
 * AL-4 (docs/prd-academic-loop-2027.md §3.1, AC-B3): the class homework sheet as printed — ONE sheet for the whole
 * শাখা (the Office prints it CLASS_PRESENT copies): the school header, class / শাখা / subject / date, a name + student
 * ID line to fill in, each question with its marks and an answer box, then the free lines (R22) the teacher added.
 *
 * Questions are read from the PAPER, not re-picked: bank items print the bank question's own text, teacher items their
 * own text. The class-homework twin of `renderExtraHomeworkPdf` (one page per child) — that renderer is untouched.
 */
import path from "path";
import { Types } from "mongoose";
import PDFDocument from "pdfkit";

import { HW_SUBJECT_LABELS_BN, HOMEWORK_FREE_LINE_KIND_LABELS_BN, callerHasPermission } from "@scd/shared";
import type { HomeworkFreeLineKind } from "@scd/shared";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { HomeworkItem } from "../../trackers/models/HomeworkItem";
import { PrintRequest } from "../../printing/models/PrintRequest";
import { BENGALI_FONT, mixedText } from "../../../routes/pdfRenderer";
import { SCHOOL_PROFILE } from "../../exams/services/ReportCardService";
import { MasteryPaper, type IMasteryPaper } from "../models/MasteryPaper";
import { MasteryWorkError, assertMayWork, type Auth } from "./MasteryWorkService";
import { sectionLabel } from "./MasteryDiagnosisService";
import { stemsFor } from "./MasteryAssignmentService";
import { printLabel, printPlan } from "../parts";

const FONT_PATH = path.resolve(__dirname, "../../../../assets/fonts/NotoSansBengali-Regular.ttf");
const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

/**
 * Who may render the sheet: a `mastery:view` holder with the row rule (the subject teacher, today's substitute, or
 * `mastery:edit_all`) — or the Office (`printing:view_all`) while a live print request references the paper, the
 * narrowest widening (the `/pdf/set` rule): cancelling the job withdraws it again.
 */
export async function loadPaperForPdf(paperId: string, auth: Auth): Promise<IMasteryPaper> {
  // The Office's print row carries the Mongo id; the teacher's screens use the paperId code — accept both.
  const paper = Types.ObjectId.isValid(paperId) ? await MasteryPaper.findById(paperId) : await MasteryPaper.findOne({ paperId });
  if (!paper) throw new MasteryWorkError("এই কাজটি পাওয়া যায়নি।");
  if (callerHasPermission(auth, "printing:view_all")) {
    if (await PrintRequest.exists({ masteryPaperId: paper._id, status: { $ne: "CANCELLED" } })) return paper;
  }
  await assertMayWork(auth, paper.sectionId, paper.subject, paper.date);
  return paper;
}

export async function renderHomeworkPaperPdf(paperId: string, auth: Auth): Promise<{ pdf: Buffer; filename: string }> {
  const paper = await loadPaperForPdf(paperId, auth);
  if (paper.extra || (paper.source !== "HW" && paper.source !== "AS")) throw new MasteryWorkError("এটি বাড়ির কাজ বা অ্যাসাইনমেন্টের শিট নয়।");
  const item = paper.links?.hwItemId ? await HomeworkItem.findById(paper.links.hwItemId).select("freeLines description").lean() : null;
  const bankIds = paper.items.flatMap((i) => (i.artifactId ? [i.artifactId] : []));
  const [label, stems, arts] = await Promise.all([
    sectionLabel(paper.sectionId),
    stemsFor(paper.items),
    bankIds.length ? ContentArtifact.find({ _id: { $in: bankIds } }).select("envelopeJson.payload.question_text").lean() : Promise.resolve([]),
  ]);
  const textOf = new Map(arts.map((a) => [String(a._id), String(((a.envelopeJson as Record<string, unknown>)?.payload as Record<string, unknown> | undefined)?.question_text ?? "")]));
  const subjectBn = (HW_SUBJECT_LABELS_BN as Record<string, string>)[paper.subject] ?? paper.subject;
  const date = paper.date.toISOString().slice(0, 10);
  const total = paper.items.reduce((s, i) => s + i.marks, 0);

  const pdf = await new Promise<Buffer>((resolve, reject) => {
    const M = 44;
    const doc = new PDFDocument({ size: "A4", margins: { top: M, bottom: M, left: M, right: M } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont(BENGALI_FONT, FONT_PATH);
    const W = 595.28 - 2 * M;

    doc.fontSize(11).fillColor("#46554E");
    mixedText(doc, `${SCHOOL_PROFILE.schoolName} · ${SCHOOL_PROFILE.branch}`, { width: W } as PDFKit.Mixins.TextOptions);
    doc.fontSize(17).fillColor("#111111");
    mixedText(doc, `${paper.title ?? (paper.source === "AS" ? "অ্যাসাইনমেন্ট" : "বাড়ির কাজ")} · ${subjectBn}`, { width: W } as PDFKit.Mixins.TextOptions);
    doc.fontSize(11);
    mixedText(doc, `${label.className} ${label.sectionName} · তারিখ: ${bn(date)} · পূর্ণমান: ${bn(total)}`, { width: W } as PDFKit.Mixins.TextOptions);
    doc.fontSize(11).text("নাম: ______________________   আইডি: ____________", M, doc.y + 4, { width: W });
    doc.moveTo(M, doc.y + 4).lineTo(M + W, doc.y + 4).strokeColor("#111111").lineWidth(2).stroke();
    doc.x = M;
    doc.y += 14;

    const needs = (h: number) => {
      if (doc.y + h > 841.89 - M - 20) {
        doc.addPage();
        doc.x = M;
        doc.y = M;
      }
    };
    const question = (lbl: string, text: string, marks: number, indent = 24) => {
      needs(70);
      const y0 = doc.y;
      doc.fontSize(12).fillColor("#111111");
      if (lbl) doc.font(BENGALI_FONT).text(lbl, M, y0, { width: indent });
      doc.x = M + indent;
      doc.y = y0;
      mixedText(doc, text, { width: W - indent - 60 } as PDFKit.Mixins.TextOptions);
      const after = Math.max(doc.y, y0 + 16);
      doc.rect(M + W - 52, y0, 52, 22).strokeColor("#9AA59F").lineWidth(0.8).stroke();
      doc.fontSize(9).fillColor("#46554E").font(BENGALI_FONT).text(`/${bn(marks)}`, M + W - 52, y0 + 6, { width: 52, align: "center" });
      const boxH = marks <= 1 ? 26 : 48;
      doc.rect(M + indent, after + 4, W - indent - 60, boxH).strokeColor("#9AA59F").lineWidth(0.8).stroke();
      doc.x = M;
      doc.y = after + boxH + 12;
    };
    const stem = (n: number, ref: string) => {
      const s = stems.get(ref);
      needs(60);
      const y0 = doc.y;
      doc.fontSize(12).fillColor("#111111");
      doc.font(BENGALI_FONT).text(`${bn(n)}.`, M, y0, { width: 24 });
      doc.x = M + 24;
      doc.y = y0;
      mixedText(doc, s ? [s.title, s.content].filter(Boolean).join("\n") : ref, { width: W - 24 - 60 } as PDFKit.Mixins.TextOptions);
      doc.x = M;
      doc.y = Math.max(doc.y, y0 + 16) + 6;
    };

    for (const line of printPlan(paper.items, 0)) {
      const text = line.item.textBn ?? (line.item.artifactId ? textOf.get(String(line.item.artifactId)) : "") ?? "";
      if (line.stimulusRef && line.startsGroup) stem(line.no, line.stimulusRef);
      if (line.partLabel) question(printLabel(bn(line.no), line.partLabel), text, line.item.marks, 44);
      else if (line.stimulusRef) question("", text, line.item.marks);
      else question(`${bn(line.no)}.`, text, line.item.marks);
    }
    const lines = item?.freeLines ?? [];
    if (lines.length > 0) {
      needs(40);
      doc.fontSize(12).fillColor("#111111").font(BENGALI_FONT).text("অন্যান্য কাজ", M, doc.y, { width: W });
      doc.y += 4;
      lines.forEach((l, i) => {
        needs(24);
        mixedText(doc, `${bn(i + 1)}. [${HOMEWORK_FREE_LINE_KIND_LABELS_BN[l.kind as HomeworkFreeLineKind] ?? l.kind}] ${l.textBn}`, { width: W } as PDFKit.Mixins.TextOptions);
        doc.y += 4;
      });
    }
    doc.font("Helvetica").fontSize(8).fillColor("#46554E").text(paper.paperId, M, 841.89 - M - 12, { width: W, align: "right" });
    doc.end();
  });
  return { pdf, filename: `homework_${paper.paperId}` };
}

