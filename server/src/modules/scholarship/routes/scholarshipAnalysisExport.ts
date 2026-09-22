/**
 * Scholarship analysis export (SC-8, D-#695):
 *
 *   GET /export/scholarship-analysis?sectionId=…&classLevel=5&studentId=…&subject=ENG
 *
 * Streams one student × one subject as Markdown, for handing to a language model with
 * "write practice questions for this child". Streamed, never stored — the document of
 * record is the marks, and a file on disk would be a second copy going stale.
 *
 * THE SAME GATE AS THE QUERY, RE-ASSERTED HERE. A route is a second front door, and a
 * permission that lives only in the GraphQL layer is not a permission — the
 * monthly-comment export's posture, and the reason it is repeated rather than trusted.
 *
 * ONE SUBJECT AT A TIME, deliberately. The owner's ask was per-subject, and it is also
 * the honest shape: `studentAnalysis` narrows a combined Science + BGS paper to the
 * asked-for subject (D-#664), so an "all subjects" file would either lose that
 * narrowing or silently pool two subjects' topics into one ranking.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { Types } from "mongoose";
import { callerHasPermission, HW_SUBJECTS, type HwSubject } from "@scd/shared";
import { buildContext } from "../../../context";
import { Student } from "../../foundation/models/Student";
import { studentAnalysis } from "../services/ScholarshipAnalysisService";
import { listTopics } from "../services/ScholarshipService";
import { buildAnalysisMarkdown } from "../services/ScholarshipExportService";
import { writeAudit } from "../../platform/services/AuditService";

export const scholarshipAnalysisExportRouter: Router = createRouter();

/** Filename-safe and ASCII-only. A Bangla name in a Content-Disposition header is a
 *  portability problem on Windows, and the name is inside the file anyway. */
function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 48);
}

scholarshipAnalysisExportRouter.get("/", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  if (!callerHasPermission(ctx.auth, "scholarship:read")) {
    res.status(403).json({ error: "বৃত্তি অনুশীলনের বিশ্লেষণ দেখার অনুমতি নেই।" });
    return;
  }

  const sectionId = String(req.query.sectionId ?? "");
  const studentId = String(req.query.studentId ?? "");
  const subject = String(req.query.subject ?? "") as HwSubject;
  const classLevel = Number(req.query.classLevel);

  // Validate BEFORE the service: `studentAnalysis` casts sectionId with
  // `new Types.ObjectId(...)`, which throws a 500-shaped BSONError on a bad string.
  // A malformed query is the caller's mistake and deserves to be told so.
  if (!Types.ObjectId.isValid(sectionId) || !Types.ObjectId.isValid(studentId)) {
    res.status(400).json({ error: "sectionId and studentId must be ids" });
    return;
  }
  if (!HW_SUBJECTS.includes(subject)) {
    res.status(400).json({ error: `subject must be one of ${HW_SUBJECTS.join(", ")}` });
    return;
  }
  if (!Number.isInteger(classLevel)) {
    res.status(400).json({ error: "classLevel must be an integer" });
    return;
  }

  const student = (await Student.findById(studentId)
    .select("_id name nameBn sectionId")
    .lean()) as { _id: Types.ObjectId; name?: string; nameBn?: string; sectionId?: Types.ObjectId } | null;
  if (!student) {
    res.status(404).json({ error: "শিক্ষার্থী পাওয়া যায়নি।" });
    return;
  }
  // The section is not decoration — it is what scopes the class comparison. A student
  // exported against someone else's section would be ranked against children she never
  // sat with, and every "position" in the file would be a fiction.
  if (String(student.sectionId ?? "") !== sectionId) {
    res.status(400).json({ error: "এই শিক্ষার্থী এই শাখার নয়।" });
    return;
  }

  const analysis = await studentAnalysis({ sectionId, classLevel, subject }, studentId);
  if (analysis.papersSat === 0) {
    res.status(404).json({ error: "এই বিষয়ে এখনো কোনো প্রশ্নপত্রের নম্বর নেই।" });
    return;
  }

  const catalogue = await listTopics(classLevel, subject);
  // `nameBn` is sparse in the source roster, so `name` is the fallback exactly as the
  // paper roster and the heat-map do.
  const studentName = student.nameBn?.trim() || student.name || "—";

  const body = buildAnalysisMarkdown({
    studentName,
    classLevel,
    subject,
    analysis,
    catalogue,
    today: new Date().toISOString().slice(0, 10),
  });

  await writeAudit({
    eventKind: "SCHOLARSHIP_ANALYSIS_EXPORTED",
    actorId: ctx.auth.userId as string,
    targetKind: "Student",
    targetId: studentId,
    meta: {
      subject,
      classLevel,
      sectionId,
      papersSat: analysis.papersSat,
      topics: analysis.topics.length,
    },
  });

  const name = `${slug(student.name || "student") || "student"}-${subject.toLowerCase()}.md`;
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(body);
});
