/**
 * PR-J (docs/prd-mastery-homework-from-lesson.md, D-#1420) — the printed extra-homework sheet:
 * one A4 page per child who has questions on the paper (a child not on it gets no page), with the
 * school header, the child's name and student ID (no roll numbers), class, subject, date, each
 * question with an answer box and a marks box, and the same code line the weekly assignment prints.
 *
 * The weekly assignment renderer (`renderPdfOf` in MasteryAssignmentService) is left untouched so its
 * output stays byte-for-byte what it was; this file only reuses its exported pieces (`pdfCodeLine`,
 * `stemsFor`) and the same drawing constants.
 */
import path from "path";
import PDFDocument from "pdfkit";
import { Types } from "mongoose";
import { HW_SUBJECT_LABELS_BN } from "@scd/shared";
import { Student } from "../../foundation/models/Student";
import { personName } from "../../../lib/personName";
import { BENGALI_FONT, mixedText } from "../../../routes/pdfRenderer";
import { SCHOOL_PROFILE } from "../../exams/services/ReportCardService";
import { MasteryWorkError, loadPaperFor, type Auth } from "./MasteryWorkService";
import { sectionLabel } from "./MasteryDiagnosisService";
import { masteryLevelLabels } from "./MasteryReviewService";
import { pdfCodeLine, stemsFor } from "./MasteryAssignmentService";
import { groupStimulusParts, printLabel, printPlan } from "../parts";

const FONT_PATH = path.resolve(__dirname, "../../../../assets/fonts/NotoSansBengali-Regular.ttf");
const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

export async function renderExtraHomeworkPdf(paperId: string, auth: Auth): Promise<{ pdf: Buffer; filename: string }> {
  const paper = await loadPaperFor(paperId, auth);
  if (!paper.extra) throw new MasteryWorkError("এটি বাড়তি বাড়ির কাজ নয়।");
  const onSheet = new Map(paper.perStudentItems.filter((p) => p.itemNos.length > 0).map((p) => [String(p.studentId), p.itemNos]));
  const [students, label, words, stems] = await Promise.all([
    Student.find({ _id: { $in: [...onSheet.keys()].map((i) => new Types.ObjectId(i)) } })
      .select("name nameBn schoolId")
      .sort({ name: 1 })
      .lean() as Promise<{ _id: Types.ObjectId; name?: string; nameBn?: string; schoolId?: string }[]>, // bounded: one sheet's children
    sectionLabel(paper.sectionId),
    masteryLevelLabels(),
    stemsFor(paper.items),
  ]);
  const subjectBn = (HW_SUBJECT_LABELS_BN as Record<string, string>)[paper.subject] ?? paper.subject;
  const date = paper.date.toISOString().slice(0, 10);
  const itemByNo = new Map(paper.items.map((i) => [i.itemNo, i]));

  const pdf = await new Promise<Buffer>((resolve, reject) => {
    const M = 44;
    const doc = new PDFDocument({ size: "A4", margins: { top: M, bottom: M, left: M, right: M }, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont(BENGALI_FONT, FONT_PATH);
    const W = 595.28 - 2 * M;
    let pages = 0;

    type Q = { textBn?: string; qid?: string; marks: number };
    const question = (lbl: string, q: Q, indent = 24) => {
      const y0 = doc.y;
      doc.fontSize(12).fillColor("#111111");
      if (lbl) doc.font(BENGALI_FONT).text(lbl, M, y0, { width: indent });
      doc.x = M + indent;
      doc.y = y0;
      mixedText(doc, q.textBn ?? q.qid ?? "", { width: W - indent - 60 } as PDFKit.Mixins.TextOptions);
      const after = Math.max(doc.y, y0 + 16);
      doc.rect(M + W - 52, y0, 52, 22).strokeColor("#9AA59F").lineWidth(0.8).stroke();
      doc.fontSize(9).fillColor("#46554E").font(BENGALI_FONT).text(`/${bn(q.marks)}`, M + W - 52, y0 + 6, { width: 52, align: "center" });
      const boxH = q.marks <= 1 ? 26 : 48;
      doc.rect(M + indent, after + 4, W - indent - 60, boxH).strokeColor("#9AA59F").lineWidth(0.8).stroke();
      doc.x = M;
      doc.y = after + boxH + 12;
    };
    const stem = (n: number, ref: string) => {
      const s = stems.get(ref);
      const y0 = doc.y;
      doc.fontSize(12).fillColor("#111111");
      doc.font(BENGALI_FONT).text(`${bn(n)}.`, M, y0, { width: 24 });
      doc.x = M + 24;
      doc.y = y0;
      mixedText(doc, s ? [s.title, s.content].filter(Boolean).join("\n") : ref, { width: W - 24 - 60 } as PDFKit.Mixins.TextOptions);
      doc.x = M;
      doc.y = Math.max(doc.y, y0 + 16) + 6;
    };

    for (const st of students) {
      const mine = groupStimulusParts(
        (onSheet.get(String(st._id)) ?? []).flatMap((no) => (itemByNo.has(no) ? [itemByNo.get(no)!] : [])),
      );
      if (mine.length === 0) continue;
      pages += 1;
      doc.addPage();
      doc.x = M;
      doc.y = M;
      doc.fontSize(11).fillColor("#46554E");
      mixedText(doc, `${SCHOOL_PROFILE.schoolName} · ${SCHOOL_PROFILE.branch}`, { width: W } as PDFKit.Mixins.TextOptions);
      doc.fontSize(17).fillColor("#111111");
      mixedText(doc, `${paper.title ?? "বাড়তি বাড়ির কাজ"} · ${subjectBn}`, { width: W - 190 } as PDFKit.Mixins.TextOptions);
      doc.fontSize(11);
      mixedText(doc, `${label.className} ${label.sectionName} · তারিখ: ${bn(date)}`, { width: W - 190 } as PDFKit.Mixins.TextOptions);
      const total = mine.reduce((s, q) => s + q.marks, 0);
      doc.fontSize(11).text(`নাম: ${personName(st)}`, M + W - 185, M + 14, { width: 185, align: "right" });
      doc.text(`আইডি: ${st.schoolId ?? "—"}`, { width: 185, align: "right" });
      doc.text(`পূর্ণমান: ${bn(total)}`, { width: 185, align: "right" });
      doc.y = Math.max(doc.y, M + 64);
      doc.moveTo(M, doc.y + 4).lineTo(M + W, doc.y + 4).strokeColor("#111111").lineWidth(2).stroke();
      doc.y += 14;
      for (const line of printPlan(mine, 0)) {
        if (line.stimulusRef && line.startsGroup) stem(line.no, line.stimulusRef);
        if (line.partLabel) question(printLabel(bn(line.no), line.partLabel), line.item, 44);
        else if (line.stimulusRef) question("", line.item);
        else question(`${bn(line.no)}.`, line.item);
      }
      const footY = 841.89 - M - 30;
      doc.moveTo(M, footY).lineTo(M + W, footY).strokeColor("#9AA59F").lineWidth(0.6).stroke();
      doc.fontSize(9).fillColor("#46554E").font(BENGALI_FONT).text("অভিভাবকের স্বাক্ষর: ____________________", M, footY + 6, { width: W / 2 });
      doc.font("Helvetica").fontSize(8).text(paper.paperId, M + W / 2, footY + 6, { width: W / 2, align: "right" });
      const los = pdfCodeLine(mine.map((q) => q.loCodes[0]), words, "STAFF", () => null);
      if (los) {
        doc.x = M + W / 2;
        doc.y = footY + 16;
        doc.fontSize(8);
        mixedText(doc, los, { width: W / 2, align: "right" } as PDFKit.Mixins.TextOptions);
      }
    }
    if (pages === 0) {
      doc.addPage();
      doc.font(BENGALI_FONT).fontSize(12).text("কোনো শিট নেই।");
    }
    doc.end();
  });
  return { pdf, filename: `extra_homework_${paper.paperId}` };
}
