/**
 * Monthly-comment export route (MR-8, prd-monthly-report §8b.1, D-#415):
 *
 *   GET /export/monthly-comments?sectionId=…&periodKey=YYYY-MM
 *   GET /export/monthly-comments?all=1&periodKey=YYYY-MM&format=single|zip
 *
 * Streams the de-identified Markdown a person opens in Claude Desktop. Streamed,
 * never stored — like the PDF routes, the document of record is the revision.
 *
 * THE SAME GATE AS THE MUTATION, RE-ASSERTED HERE. A route is a second front door,
 * and a permission that lives only in the GraphQL layer is not a permission. Export
 * is gated exactly as drafting is (`report:release`, Principal/Office), because a
 * comment pack IS the drafting input; each section is then re-checked with the
 * per-report staff read gate, so `all=1` cannot become a way past it.
 *
 * WHOLE-SCHOOL COMES IN BOTH SHAPES (owner ruling 2026-08-04, closing the PRD §11
 * open question): `format=zip` gives one `.md` per section, which is what you want
 * when sections go to different people or a chat window has a length limit;
 * `format=single` gives one long file, which is what you want when one person is
 * doing the lot in a single sitting. Neither is right for every month, so the
 * operator picks per export rather than living with a default someone chose once.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import JSZip from "jszip";
import { callerHasPermission, type Role } from "@scd/shared";
import { buildContext } from "../../../context";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { MonthlyReport, type IMonthlyReport } from "../models/MonthlyReport";
import { assertStaffReportRead } from "../resolvers/monthlyReport";
import { writeAudit } from "../../platform/services/AuditService";
import {
  buildCommentExportMarkdown,
  classLevelsFor,
  exportBlocksOf,
} from "../services/MonthlyCommentExchangeService";

export const monthlyCommentExportRouter: Router = createRouter();

const PERIOD_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Filename-safe, ASCII-only. A Bangla section name in a Content-Disposition header
 *  is a portability problem on Windows, and the label is inside the file anyway. */
function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "section";
}

/**
 * A zip entry name that is UNIQUE and still tells you which class it is.
 *
 * Class names are Bangla, so `slug()` strips them to nothing and every section fell
 * back to its code — and every section here is coded "Main". JSZip treats a repeated
 * name as an overwrite, so a four-section export silently produced a one-file zip:
 * three classes gone, no error, and nothing to notice until someone went looking for
 * a class that was never in there. Found by driving it, not by a test.
 *
 * The class LEVEL is the ASCII part of a Bangla class name, so it carries the meaning
 * the slug loses. The `used` set is belt-and-braces for anything the level cannot
 * separate — an overwrite must never be reachable by naming alone.
 */
export function entryName(
  used: Set<string>,
  parts: { level?: number | null; code?: string | null; periodKey: string },
): string {
  // Nursery is level -1 and KG is 0, so a bare `class-${level}` yields "class--1".
  // `n1` reads as a name rather than a typo, and still sorts before class-1.
  const lvl =
    parts.level == null ? null : `class-${parts.level < 0 ? `n${Math.abs(parts.level)}` : parts.level}`;
  const base = slug([lvl, parts.code].filter(Boolean).join("-"));
  let name = `${base}-${parts.periodKey}.md`;
  for (let i = 2; used.has(name); i++) name = `${base}-${i}-${parts.periodKey}.md`;
  used.add(name);
  return name;
}

/**
 * The reports a comment is still WANTED for: the newest revision per child, not yet
 * accepted, and still writable. An already-reviewed paragraph is excluded because
 * re-importing over an accept would silently replace words a person has owned;
 * a report that already has a model draft IS included, since rewriting a poor
 * generated paragraph in Desktop is half the reason this lane exists.
 */
async function exportableReports(sectionId: string, periodKey: string): Promise<IMonthlyReport[]> {
  const rows = await MonthlyReport.find({ sectionId, periodKey }).sort({ revision: -1 }).exec();
  const newest = new Map<string, IMonthlyReport>();
  for (const r of rows) {
    const key = r.studentId.toString();
    if (!newest.has(key)) newest.set(key, r);
  }
  return [...newest.values()].filter(
    (r) => !r.reviewedAt && r.status !== "RELEASED" && r.status !== "SUPERSEDED",
  );
}

monthlyCommentExportRouter.get("/", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  const role = ctx.auth.role as Role;
  if (!callerHasPermission(ctx.auth, "report:release") || (role !== "PRINCIPAL" && role !== "OFFICE")) {
    res.status(403).json({ error: "মাসিক রিপোর্ট প্রকাশ অফিস/অধ্যক্ষের কাজ" });
    return;
  }

  const periodKey = String(req.query.periodKey ?? "");
  if (!PERIOD_KEY.test(periodKey)) {
    res.status(400).json({ error: "periodKey must be YYYY-MM" });
    return;
  }
  const all = req.query.all === "1" || req.query.all === "true";
  const sectionId = typeof req.query.sectionId === "string" ? req.query.sectionId : "";
  if (!all && !sectionId) {
    res.status(400).json({ error: "sectionId or all=1 is required" });
    return;
  }
  const format = String(req.query.format ?? "single") === "zip" ? "zip" : "single";

  // Which sections are in play. For all=1 this is every section that actually HAS a
  // report this month — an empty section would otherwise produce an empty file.
  const sectionIds = all
    ? (await MonthlyReport.distinct("sectionId", { periodKey })).map((s) => String(s))
    : [sectionId];

  const sections = await Section.find({ _id: { $in: sectionIds } })
    .select("nameBn code classId")
    .lean();
  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } })
    .select("nameBn level")
    .lean();
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));

  const files: { name: string; label: string; body: string }[] = [];
  const usedNames = new Set<string>();
  let totalBlocks = 0;

  for (const sid of sectionIds) {
    const reports = await exportableReports(sid, periodKey);
    if (reports.length === 0) continue;
    // Per-section read gate — all=1 must not widen what this caller may see.
    await assertStaffReportRead(ctx, reports[0]);

    const s = sectionById.get(sid);
    const c = s ? classById.get(s.classId.toString()) : null;
    const label = [c?.nameBn, s?.nameBn].filter(Boolean).join(" — ") || sid;

    // Same resolution the in-app lane uses, so both lanes send the model the same facts.
    const blocks = exportBlocksOf(reports, await classLevelsFor(reports));
    totalBlocks += blocks.length;
    files.push({
      name: entryName(usedNames, { level: c?.level, code: s?.code, periodKey }),
      label,
      body: buildCommentExportMarkdown(blocks, { periodKey, sectionLabel: label, sectionId: sid }),
    });
  }

  if (files.length === 0) {
    res.status(404).json({ error: "এই মাসে মন্তব্য লেখার মতো কোনো রিপোর্ট নেই।" });
    return;
  }

  await writeAudit({
    eventKind: "MONTHLY_COMMENTS_EXPORTED",
    actorId: ctx.auth.userId as string,
    targetKind: "MonthlyReport",
    // `targetId` is an ObjectId column. Passing a period key put a non-castable string
    // in it and `writeAudit` — which never throws, by design — swallowed the failure,
    // so a whole-school export of every child's facts recorded NOTHING while the route
    // still answered 200. The month is in `meta` either way; a school-wide export has
    // no single target, and omitting the field is the honest way to say so.
    targetId: all ? undefined : sectionId,
    meta: { periodKey, all, format, sections: files.length, reports: totalBlocks },
  });

  if (format === "zip" && files.length > 1) {
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.body);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="monthly-comments-${periodKey}.zip"`);
    res.send(buf);
    return;
  }

  // One long file: every section concatenated, each keeping its own heading and
  // instruction block so a reader who scrolls to the middle still knows the rules.
  const body = files.map((f) => f.body).join("\n\n---\n\n");
  const name = files.length === 1 ? files[0].name : `monthly-comments-${periodKey}.md`;
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(body);
});
