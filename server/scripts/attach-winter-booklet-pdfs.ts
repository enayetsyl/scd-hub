#!/usr/bin/env node
/**
 * Attach the printed PDF to each winter booklet (D-#1620) so teachers and the reviewer can open
 * the page as the child gets it. One file per booklet, named `<code>.pdf` (e.g. `C2-2026.pdf`).
 * The PDFs are children's booklet pages: keep them OUT of the repo.
 *
 *   npx tsx scripts/attach-winter-booklet-pdfs.ts <pdf-dir>            (dry run)
 *   APPLY=1 npx tsx scripts/attach-winter-booklet-pdfs.ts <pdf-dir>    (writes: Drive + StoredFile + booklet)
 *
 * The dry run prints the database name and, per booklet, whether `<code>.pdf` exists and would be
 * attached or would replace an earlier PDF. Booklet text and suggestions are never touched; an
 * earlier PDF stays in storage, only the booklet's pointer moves. Run it where the server's .env
 * points at the right database and Drive credentials (the VM for prod). The upload is recorded
 * as the Principal (first active PRINCIPAL user), or the user id in ATTACH_AS.
 */
import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { connectDb, disconnectDb, mongoose } from "../src/db";
import { User } from "../src/modules/foundation/models/User";
import { WinterBooklet } from "../src/modules/winter-task/models/WinterBooklet";
import { attachWinterBookletPdf } from "../src/modules/winter-task/services/WinterBookletService";

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: [APPLY=1] npx tsx scripts/attach-winter-booklet-pdfs.ts <pdf-dir>");
    process.exit(2);
  }
  const apply = process.env.APPLY === "1";
  await connectDb();
  console.log(`database: ${mongoose.connection.name}  mode: ${apply ? "APPLY" : "dry run"}`);
  let actor = process.env.ATTACH_AS ?? "";
  if (!actor) {
    const p = await User.findOne({ role: "PRINCIPAL" }).select("_id").lean();
    if (!p) {
      console.error("no PRINCIPAL user found; set ATTACH_AS=<userId>");
      process.exit(1);
    }
    actor = p._id.toString();
  }
  const books = await WinterBooklet.find({}).sort({ classLevel: 1 }).lean();
  for (const b of books) {
    const file = path.join(dir, `${b.code}.pdf`);
    let data: Buffer;
    try {
      data = await fs.readFile(file);
    } catch {
      console.log(`${b.code}: no ${b.code}.pdf in ${dir} — skipped`);
      continue;
    }
    const what = b.pdfFileId ? "would REPLACE the earlier PDF" : "would attach";
    if (!apply) {
      console.log(`${b.code}: ${data.length} bytes — ${what} (not written)`);
      continue;
    }
    const r = await attachWinterBookletPdf(actor, b.code, { name: `${b.code}.pdf`, data });
    console.log(`${b.code}: attached ${r.bytes} bytes, file ${r.fileId}${r.previousFileId ? ` (replaced ${r.previousFileId})` : ""}`);
  }
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
