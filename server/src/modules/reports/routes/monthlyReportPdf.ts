/**
 * Monthly-report PDF route (MR-7, prd-monthly-report §8):
 *
 *   GET /pdf/monthly-report/:reportId
 *
 * THE SAME §4 GATE AS THE RESOLVER, RE-ASSERTED HERE — a route is a second front
 * door, and a read gate that lives only in the GraphQL layer is not a gate. A
 * narrowed subject teacher gets a narrowed sheet that says so and carries no
 * paragraph and no fee block; a guardian may print only a RELEASED revision of their
 * own child.
 *
 * Streamed, never stored (like /pdf/set and the student-profile sheet) — the document
 * of record is the revision, not a file on disk.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { HW_SUBJECT_LABELS_BN, type Role } from "@scd/shared";
import { buildContext } from "../../../context";
import { markdownToPdf } from "../../../routes/pdfRenderer";
import { allowedSubjectCodesForSection, assertGuardianOfStudent } from "../../../middleware/authz";
import { assertReportRead } from "../../trackers/resolvers/classTestSummary";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { MonthlyReport } from "../models/MonthlyReport";
import { narrowSnapshot } from "../resolvers/monthlyReport";
import { buildMonthlyReportMarkdown } from "../services/MonthlyReportSheetService";
import type { MonthlySnapshot } from "../services/MonthlyReportService";

export const monthlyReportPdfRouter: Router = createRouter();

monthlyReportPdfRouter.get("/:reportId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  const report = await MonthlyReport.findById(req.params.reportId);
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  const role = ctx.auth.role as Role;
  let subjects: string[] | null = null;
  let isTeacher = false;

  try {
    if (role === "GUARDIAN") {
      // A guardian's path is narrower than any staff path: their own child, and only
      // a revision that has actually been released.
      await assertGuardianOfStudent(ctx, report.studentId.toString());
      if (report.status !== "RELEASED") {
        res.status(403).json({ error: "This report has not been released" });
        return;
      }
    } else {
      await assertReportRead(ctx, report.sectionId.toString());
      const allowed = await allowedSubjectCodesForSection(
        ctx,
        report.sectionId.toString(),
        report.classId.toString(),
        { classTeacherOversight: true },
      );
      subjects = allowed === null ? null : [...allowed];
      isTeacher = role === "TEACHER";
    }
  } catch (err) {
    res.status(403).json({ error: err instanceof Error ? err.message : "Forbidden" });
    return;
  }

  try {
    const [student, section, klass, actor] = await Promise.all([
      Student.findById(report.studentId).select("name nameBn rollNumber").lean() as Promise<
        { name: string; nameBn?: string; rollNumber?: string } | null
      >,
      Section.findById(report.sectionId).select("nameBn code").lean() as Promise<
        { nameBn?: string; code?: string } | null
      >,
      Class.findById(report.classId).select("nameBn").lean() as Promise<{ nameBn?: string } | null>,
      User.findById(ctx.auth.userId as string).select("name").lean() as Promise<{ name: string } | null>,
    ]);

    const snapshot = narrowSnapshot(report.snapshot, subjects, {
      hideFees: isTeacher,
    }) as unknown as MonthlySnapshot;

    const markdown = buildMonthlyReportMarkdown({
      snapshot,
      status: report.status,
      revision: report.revision,
      periodKey: report.periodKey,
      dataAsOf: report.dataAsOf,
      provisional: report.provisional,
      // §4: the paragraph is cross-subject, so a narrowed sheet carries none.
      comment: subjects === null ? report.commentFinal ?? null : null,
      studentName: student?.nameBn || student?.name || "",
      classLabel: klass?.nameBn ?? "",
      sectionLabel: section?.nameBn ?? section?.code ?? "",
      rollNumber: student?.rollNumber ?? null,
      fullView: subjects === null,
      subjectFilter: subjects ?? [],
      printedByName: actor?.name ?? "—",
      printedAt: new Date(),
      changeLog: report.changeLog.map((c) => `${c.field}: ${c.before ?? "—"} → ${c.after ?? "—"}`),
      subjectLabels: HW_SUBJECT_LABELS_BN as unknown as Record<string, string>,
    });

    const pdf = await markdownToPdf(markdown, {
      title: `${student?.nameBn || student?.name || ""} — মাসিক অগ্রগতি রিপোর্ট (${report.periodKey})`,
      fontScale: 0.92,
      margin: 38,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="monthly_report_${report.studentId.toString()}_${report.periodKey}_r${report.revision}.pdf"`,
    );
    res.setHeader("Content-Length", pdf.byteLength);
    res.send(pdf);
  } catch (err) {
    // Isolated: a renderer/font failure must be a 500, never an unhandled async
    // rejection (Express 4 does not catch those).
    console.error(`Monthly-report PDF failed for ${req.params.reportId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
