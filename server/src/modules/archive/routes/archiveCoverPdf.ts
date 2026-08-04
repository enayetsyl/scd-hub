/**
 * GET /pdf/archive-cover/:bundleId (AR-4, prd-script-archive §9) — the printable
 * cover sheet that sits on top of a physical bundle: ctId, class/section,
 * subject, Test #, exam date, script count, filed-by, box code. Rendered
 * on-demand through the existing markdown→PDF renderer (the /pdf/artifact
 * pattern); refused for VOID bundles (a voided record must not produce fresh
 * paper). Staff read: tracker:read or roster:manage.
 */
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import { buildContext } from "../../../context";
import { callerHasPermission, HW_SUBJECT_LABELS_BN } from "@scd/shared";
import type { HwSubject } from "@scd/shared";
import { ScriptBundle } from "../models/ScriptBundle";
import { StorageBox } from "../models/StorageBox";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { markdownToPdf } from "../../../routes/pdfRenderer";

export const archiveCoverPdfRouter: Router = createRouter();

archiveCoverPdfRouter.get("/:bundleId", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (
    !ctx.auth ||
    (!callerHasPermission(ctx.auth, "tracker:read") &&
      !callerHasPermission(ctx.auth, "roster:manage"))
  ) {
    res.status(403).json({ error: "অনুমতি নেই" });
    return;
  }

  const bundle = await ScriptBundle.findById(req.params.bundleId).lean();
  if (!bundle) {
    res.status(404).json({ error: "বান্ডিল পাওয়া যায়নি" });
    return;
  }
  if (bundle.status === "VOID") {
    res.status(422).json({ error: "বাতিল (VOID) বান্ডিলের কভার শিট ছাপা যায় না" });
    return;
  }

  const [box, section, filer] = await Promise.all([
    StorageBox.findById(bundle.boxId).select("boxCode locationNote").lean(),
    Section.findById(bundle.sectionId).select("nameBn").lean(),
    User.findById(bundle.filedBy).select("name").lean(),
  ]);

  const subjectBn = HW_SUBJECT_LABELS_BN[bundle.subject as HwSubject] ?? bundle.subject;
  const examDateKey = bundle.examDate.toISOString().slice(0, 10);
  const filedDateKey = bundle.filedAt.toISOString().slice(0, 10);
  const md = [
    `# ${bundle.sourceLabel}`,
    "",
    `**শ্রেণি:** Class ${bundle.classLevel}${section?.nameBn ? ` · **শাখা:** ${section.nameBn}` : ""}`,
    "",
    `**বিষয়:** ${subjectBn} · **Test #${bundle.testNumber}**`,
    "",
    `**পরীক্ষার তারিখ:** ${examDateKey}`,
    "",
    `**স্ক্রিপ্ট সংখ্যা:** ${bundle.scriptCount}`,
    "",
    `**ফাইল করেছেন:** ${filer?.name ?? "—"} · ${filedDateKey}`,
    "",
    `**বাক্স:** ${box?.boxCode ?? "—"}${box?.locationNote ? ` (${box.locationNote})` : ""}`,
    "",
    "---",
    "",
    "খাতাগুলো রোল নম্বর অনুযায়ী সাজানো — এই শিটটি বান্ডিলের উপরে থাকবে।",
  ].join("\n");

  try {
    const pdfBuffer = await markdownToPdf(md, { title: `কভার শিট — ${bundle.sourceLabel}` });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="cover_${bundle.sourceLabel}.pdf"`,
    );
    res.setHeader("Content-Length", pdfBuffer.byteLength);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(`Archive cover PDF failed for ${req.params.bundleId}:`, err);
    res.status(500).json({ error: "Could not generate the PDF" });
  }
});
