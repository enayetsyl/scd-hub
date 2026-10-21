/**
 * Meeting-brief PDF route (MC-2, docs/prd-meeting-comments.md §4, D-#755):
 *
 *   GET /pdf/meeting-brief/:meetingId?students=<id,id>&subjects=1&details=0
 *
 * One child, or every child of a family slot, on A4: the numbers, the Principal's/Office's
 * final word and the class teacher's summary always; the subject teachers' table and the
 * detail lists when asked. The brief gate (parents_meeting:view_brief + parents_meeting:view, or the child's class teacher)
 * is re-asserted here for EVERY child — a route is a second front door. The footer stamps
 * who printed it (a sheet handed to a guardian must be traceable, the D-#360 rule).
 * Streamed, never stored.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import { buildContext } from "../../../context";
import { markdownToPdf } from "../../../routes/pdfRenderer";
import { User } from "../../foundation/models/User";
import { assertBriefRead } from "../services/MeetingChainService";
import { meetingBrief, buildBriefMarkdown } from "../services/MeetingBriefService";

export const meetingBriefPdfRouter: Router = createRouter();

/** Most children one sheet prints (a family slot is 1–4; a guard against a runaway list). */
const MAX_STUDENTS = 8;

meetingBriefPdfRouter.get("/:meetingId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  const meetingId = req.params.meetingId;
  const ids = String(req.query.students ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!Types.ObjectId.isValid(meetingId) || !ids.length || ids.length > MAX_STUDENTS || !ids.every((id) => Types.ObjectId.isValid(id))) {
    res.status(400).json({ error: "meetingId and 1–8 student ids are required" });
    return;
  }
  // PM: the brief needs parents_meeting:view_brief; parents_meeting:view lifts the
  // class-teacher designation (was roster:manage).
  if (!callerHasPermission(ctx.auth, "parents_meeting:view_brief")) {
    res.status(403).json({ error: "Requires parents_meeting:view_brief" });
    return;
  }
  const actor = { userId: ctx.auth.userId as string, isAdmin: callerHasPermission(ctx.auth, "parents_meeting:view") };
  try {
    for (const id of ids) await assertBriefRead(actor, id);
  } catch (err) {
    res.status(403).json({ error: err instanceof Error ? err.message : "Forbidden" });
    return;
  }

  try {
    const now = new Date();
    const briefs = [];
    for (const id of ids) briefs.push(await meetingBrief(meetingId, id, now));
    const me = (await User.findById(actor.userId).select("name").lean()) as { name: string } | null;
    const markdown = buildBriefMarkdown(briefs, {
      subjects: req.query.subjects !== "0",
      details: req.query.details === "1",
      printedByName: me?.name ?? "—",
      printedAt: now,
    });
    const pdf = await markdownToPdf(markdown, { title: `অভিভাবক সভা — ${briefs.map((b) => b.studentName).join(", ")}` });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="meeting_brief_${meetingId}_${ids.join("_")}.pdf"`);
    res.setHeader("Content-Length", pdf.byteLength);
    res.send(pdf);
  } catch (err) {
    // A renderer/font failure must be a 500, never an unhandled rejection (Express 4).
    console.error(`Meeting-brief PDF failed for ${meetingId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
