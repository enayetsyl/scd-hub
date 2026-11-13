#!/usr/bin/env node
/**
 * Import the winter-holiday booklets (D-#1620) from the JSON files the booklet build exports
 * (`_build/export_json.py` -> `<CLASS>_booklet.json`). The files are children's booklet text:
 * keep them OUT of the repo.
 *
 *   npx tsx scripts/import-winter-booklets.ts <file.json> [<file.json> …]           (dry run)
 *   APPLY=1 npx tsx scripts/import-winter-booklets.ts <file.json> [<file.json> …]   (writes)
 *
 * The dry run reads the database and prints, per file, what an apply would do (create or
 * replace, pages, blocks, and how many open / accepted suggestions would stay or turn stale).
 * It prints the database name first. A re-run is safe: the same code replaces the pages, and a
 * suggestion whose block id and `before` text still match is kept. Run it where the server's
 * .env points at the right database (the VM for prod).
 */
import "dotenv/config";
import { promises as fs } from "fs";
import { connectDb, disconnectDb, mongoose } from "../src/db";
import { importWinterBooklet, validateWinterImport } from "../src/modules/winter-task/services/WinterBookletService";

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: [APPLY=1] npx tsx scripts/import-winter-booklets.ts <file.json> [<file.json> …]");
    process.exit(2);
  }
  const apply = process.env.APPLY === "1";
  const payloads = [];
  for (const f of files) {
    const v = validateWinterImport(JSON.parse(await fs.readFile(f, "utf8")));
    if (!v.ok) {
      console.error(`${f}: invalid`);
      for (const e of v.errors.slice(0, 20)) console.error("  - " + e);
      process.exit(1);
    }
    payloads.push({ f, payload: v.payload });
  }
  await connectDb();
  console.log(`database: ${mongoose.connection.name}  mode: ${apply ? "APPLY" : "dry run"}`);
  for (const { f, payload } of payloads) {
    const r = await importWinterBooklet(payload, { apply });
    console.log(
      `${f}: ${r.code} ${r.mode} v${r.version} — ${r.pages} pages, ${r.blocks} blocks; ` +
        `suggestions kept ${r.keptChanges}, stale ${r.staleChanges}${apply ? " (written)" : " (not written)"}`,
    );
  }
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
