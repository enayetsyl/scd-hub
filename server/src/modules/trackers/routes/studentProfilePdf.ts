/**
 * Student-profile PDF route (SP-4, prd-student-profile §9, D-#360):
 *
 *   GET /pdf/student-profile/:studentId?from=&to=
 *
 * The SAME §4 gate as the hub, re-asserted here — a route is a second front door, and
 * a read gate that lives only in the GraphQL resolver is not a gate. A narrowed
 * subject teacher gets a narrowed sheet that SAYS SO on the page; the footer stamps
 * who printed it and when (a sheet handed to a guardian must be traceable).
 *
 * Streamed, never stored (like /pdf/set) — no new collection, no analytics snapshot.
 * Rendered by the existing pdfkit + NotoSansBengali A4 engine.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { HW_SUBJECT_LABELS_BN } from "@scd/shared";
import { buildContext } from "../../../context";
import { markdownToPdf } from "../../../routes/pdfRenderer";
import { isValidDateKey } from "../../attendance/dates";
import { User } from "../../foundation/models/User";
import { assertStudentProfileRead } from "../resolvers/studentProfile";
import { studentHomeworkPanel, studentAssignmentPanel } from "../services/StudentProfileService";
import {
  defaultProfileWindow,
  studentProfileAttendance,
  studentProfileComments,
  studentProfileHeader,
} from "../services/StudentProfileContextService";
import { studentProfile as classTestProfile } from "../services/ClassTestSummaryService";
import { buildProfileSheetMarkdown } from "../services/StudentProfileSheetService";

export const studentProfilePdfRouter: Router = createRouter();

studentProfilePdfRouter.get("/:studentId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  // Tier 1 + tier 2, exactly as the GraphQL panels do it.
  let subjects: string[] | null;
  try {
    ({ subjects } = await assertStudentProfileRead(ctx, req.params.studentId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Forbidden";
    res.status(403).json({ error: msg });
    return;
  }

  const studentId = req.params.studentId;
  const now = new Date();
  const fallback = await defaultProfileWindow(now);
  const from = typeof req.query.from === "string" && isValidDateKey(req.query.from) ? req.query.from : null;
  const to = typeof req.query.to === "string" && isValidDateKey(req.query.to) ? req.query.to : null;
  const fromKey = from ?? fallback?.fromKey ?? "2000-01-01";
  const toKey = to ?? fallback?.toKey ?? now.toISOString().slice(0, 10);
  if (fromKey > toKey) {
    res.status(400).json({ error: "from must not be after to" });
    return;
  }

  try {
    const [header, attendance, homework, assignment, classTest, comments, actor] = await Promise.all([
      studentProfileHeader(studentId, now),
      studentProfileAttendance(studentId, fromKey, toKey),
      studentHomeworkPanel(studentId, { fromKey, toKey, subjects, now }),
      studentAssignmentPanel(studentId, { fromKey, toKey, subjects, now }),
      classTestProfile(studentId, subjects),
      studentProfileComments(studentId, fromKey, toKey),
      User.findById(ctx.auth.userId as string).select("name").lean() as Promise<{ name: string } | null>,
    ]);

    const markdown = buildProfileSheetMarkdown({
      header,
      attendance,
      homework,
      assignment,
      classTest,
      comments,
      subjectLabels: HW_SUBJECT_LABELS_BN as unknown as Record<string, string>,
      printedByName: actor?.name ?? "—",
      printedAt: now,
      fullView: subjects === null,
      subjectFilter: subjects ?? [],
    });

    const pdfBuffer = await markdownToPdf(markdown, {
      title: `${header.nameBn || header.name} — শিক্ষার্থী প্রোফাইল`,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="student_profile_${studentId}_${fromKey}_${toKey}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.byteLength);
    res.send(pdfBuffer);
  } catch (err) {
    // Isolated: a renderer/font failure must be a 500, never an unhandled async
    // rejection (Express 4 does not catch those).
    console.error(`Student-profile PDF failed for ${studentId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
