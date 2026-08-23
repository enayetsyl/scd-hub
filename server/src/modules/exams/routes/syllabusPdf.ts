/**
 * Exam-syllabus PDF route (SY-6):
 *
 *   GET /pdf/syllabus/:examId?classId=…   — one class's syllabus bundle.
 *
 * This is the sheet the school photocopies today, so it is not a nicety: the
 * habit it has to fit is "print it and hand it out at the gate".
 *
 * Scoping is NOT re-implemented here. The route calls the same read services the
 * screens call, so a guardian gets exactly the published rows their linked child's
 * class has and nothing else — the single most likely way a PDF route leaks is by
 * growing its own second copy of the visibility rule.
 *
 * Mounted under the existing `/pdf` prefix, which is already in the VM Caddyfile's
 * @api matcher — no Caddy change, and therefore no silent SPA-index 200.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { buildContext } from "../../../context";
import { markdownToPdf } from "../../../routes/pdfRenderer";
import {
  classSyllabus,
  guardianChildSyllabus,
  type ClassSyllabusView,
} from "../services/ExamSyllabusReadService";
import { Exam } from "../models/Exam";
import {
  SYLLABUS_ITEM_TYPE_LABELS_BN,
  ROUTINE_SUBJECT_LABELS_BN,
  EXAM_COMPONENT_LABELS_BN,
} from "@scd/shared";
import type { SyllabusItemType, RoutineSubject, ExamComponent } from "@scd/shared";

export const syllabusPdfRouter: Router = createRouter();

const subjectBn = (s: string): string =>
  ROUTINE_SUBJECT_LABELS_BN[s as RoutineSubject] ?? s;
const itemTypeBn = (s: string): string =>
  SYLLABUS_ITEM_TYPE_LABELS_BN[s as SyllabusItemType] ?? s;
const componentBn = (s: string): string =>
  EXAM_COMPONENT_LABELS_BN[s as ExamComponent] ?? s;

/**
 * The class bundle as markdown, rendered by the existing A4 engine.
 *
 * PUBLISHED rows only — `pending` placeholders exist to tell a teacher on screen
 * that something is not ready, which is meaningless on a sheet handed to a parent.
 */
function bundleMarkdown(view: ClassSyllabusView, examName: string): string {
  const out: string[] = [];
  out.push(`# ${examName}`);
  out.push(`## ${view.classLabel}`);

  if (view.noteMd) out.push("", view.noteMd);
  if (view.questionTypes.length) {
    out.push("", `**প্রশ্নের ধরন:** ${view.questionTypes.map(itemTypeBn).join(" · ")}`);
  }

  for (const s of view.subjects) {
    if (s.pending) continue;
    out.push("", "---", "", `### ${subjectBn(s.subject)}`);

    const head: string[] = [];
    if (s.examDateKey) head.push(s.examDateKey);
    head.push(`পূর্ণমান ${s.totalMarks}`);
    if (s.oralMarks > 0) head.push(`লিখিত ${s.writtenMarks} · মৌখিক ${s.oralMarks}`);
    out.push(head.join(" · "));

    if (s.bodyMd) out.push("", s.bodyMd);

    if (s.marks.length) {
      out.push("", "**মানবন্টন**", "");
      out.push("| # | প্রশ্ন | সংখ্যা | নম্বর | মোট |");
      out.push("|---|---|---|---|---|");
      for (const r of s.marks) {
        const label = r.component ? `${r.label} (${componentBn(r.component)})` : r.label;
        out.push(
          `| ${r.seq} | ${label} | ${r.count ?? "—"} | ${r.marksEach ?? "—"} | ${r.total} |`,
        );
      }
      out.push(`| | **মোট** | | | **${s.totalMarks}** |`);
    }
  }

  return out.join("\n");
}

syllabusPdfRouter.get("/:examId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  const examId = req.params.examId;
  const classId = typeof req.query.classId === "string" ? req.query.classId : null;
  const studentId = typeof req.query.studentId === "string" ? req.query.studentId : null;

  let view: ClassSyllabusView;
  try {
    // A guardian reaches the bundle through their CHILD, never through a raw
    // classId — otherwise the class parameter is a way to read any class.
    if (ctx.auth.role === "GUARDIAN") {
      if (!studentId) {
        res.status(400).json({ error: "studentId প্রয়োজন" });
        return;
      }
      view = await guardianChildSyllabus(ctx, examId, studentId);
    } else {
      if (!classId) {
        res.status(400).json({ error: "classId প্রয়োজন" });
        return;
      }
      view = await classSyllabus(ctx, examId, classId);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Forbidden";
    const status = err instanceof Error && err.name === "ForbiddenError" ? 403 : 404;
    res.status(status).json({ error: msg });
    return;
  }

  const exam = await Exam.findById(examId).select("name").lean();
  const examName = (exam as unknown as { name?: string } | null)?.name ?? "পরীক্ষার সিলেবাস";

  // Render is isolated: a renderer/font failure must return 500, never reject out
  // of the async handler and take the Node process down (Express 4 does not catch
  // async errors).
  try {
    const md = bundleMarkdown(view, examName);
    const pdfBuffer = await markdownToPdf(md, { title: `${examName} — ${view.classLabel}` });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="syllabus_${view.classId}_${examId}.pdf"`,
    );
    res.setHeader("Content-Length", pdfBuffer.byteLength);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(`PDF render failed for syllabus ${examId}/${view.classId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
