/**
 * Backfill the converted PDF for English Drive DOCX documents uploaded BEFORE the
 * DOCX→PDF conversion feature (owner 2026-07-25). Those rows have `format: "DOCX"`
 * but no `pdfFileId`, so they can't preview/print as a PDF. This downloads each
 * original .docx from Drive, converts it with LibreOffice, stores the PDF as a
 * second `english_drive` StoredFile, and sets `pdfFileId`.
 *
 * DRY RUN by default — lists what would convert and writes nothing.
 * Pass --apply to persist. Idempotent: only DOCX docs missing pdfFileId are touched.
 *
 *   npx tsx server/scripts/backfill-english-drive-pdf.ts            # preview
 *   npx tsx server/scripts/backfill-english-drive-pdf.ts --apply    # convert + persist
 *
 * REQUIRES LibreOffice (soffice) on the host — run on the VM (/opt/scdhub/prod),
 * where soffice is installed and MONGODB_URI/databaseName resolve to prod.
 */
import { connectDb } from "../src/db";
import { EnglishDriveDoc } from "../src/modules/english-drive/models/EnglishDriveDoc";
import { StoredFile } from "../src/modules/platform/models/StoredFile";
import { uploadToDrive, downloadFromDrive } from "../src/modules/platform/services/DriveStore";
import { docxToPdf } from "../src/modules/platform/services/docxConvert";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectDb();

  const docs = await EnglishDriveDoc.find({
    format: "DOCX",
    $or: [{ pdfFileId: null }, { pdfFileId: { $exists: false } }],
    fileId: { $ne: null },
  }).select("classLevel kind title fileId fileName uploadedBy");

  console.log(`DOCX docs missing a converted PDF: ${docs.length}${apply ? " (APPLY)" : " (dry run)"}`);
  if (docs.length === 0) {
    console.log("Nothing to backfill.");
    process.exit(0);
  }

  let ok = 0;
  let failed = 0;
  for (const doc of docs) {
    const label = `C${doc.classLevel} ${doc.kind} — ${doc.title}`;
    const src = await StoredFile.findById(doc.fileId).select("driveFileId originalName mime").lean();
    if (!src) {
      console.log(`  SKIP  ${label} — original StoredFile ${doc.fileId} not found`);
      failed++;
      continue;
    }
    if (!apply) {
      console.log(`  would convert  ${label}  (${src.originalName})`);
      continue;
    }
    try {
      const docxBytes = await downloadFromDrive(src.driveFileId);
      const pdf = await docxToPdf(Buffer.from(docxBytes), src.originalName ?? "document.docx");
      const baseName = (src.originalName ?? "document").replace(/\.[^.]+$/, "");
      const driveFileId = await uploadToDrive({
        name: `${Date.now()}_${baseName}.pdf`,
        mime: "application/pdf",
        data: pdf,
        year: String(new Date().getFullYear()),
        subfolder: "english-drive",
      });
      const pdfStored = await StoredFile.create({
        kind: "english_drive",
        mime: "application/pdf",
        sizeBytes: pdf.byteLength,
        originalName: `${baseName}.pdf`,
        driveFileId,
        uploadedBy: doc.uploadedBy,
      });
      doc.pdfFileId = pdfStored._id;
      await doc.save();
      ok++;
      console.log(`  converted  ${label}  → pdfFileId ${pdfStored._id.toString()}`);
    } catch (e) {
      failed++;
      console.log(`  FAILED  ${label} — ${(e as Error)?.message ?? String(e)}`);
    }
  }

  console.log(`\nDone. converted=${ok} failed=${failed} total=${docs.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
