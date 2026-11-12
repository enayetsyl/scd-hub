/**
 * Load a plan pack's session home guides (GH-4, docs/prd-guardian-help.md §5; D-#1528).
 *
 *   npx tsx server/scripts/import-session-home-guides.ts <file.json>             # dry run: checks + counts, no writes
 *   npx tsx server/scripts/import-session-home-guides.ts <file.json> --commit    # upsert into the database
 *   (optional) --actor <userId>   # who is recorded as updatedBy; default is the all-zero id (script)
 *
 * File: { "guides": [ { "classToken": "C1", "subject": "BAN", "chapter": 13, "sessionIndex": 1,
 *   "steps": ["... 5-7 lines ..."], "classworkItems": [ { "label": "...", "textBn": "..." } ],
 *   "homeTimeMin": 15 } ] }
 *
 * Idempotent: upserts by (classToken, subject, chapter, sessionIndex); a changed guide bumps its
 * version, an identical one is left alone. A file with any problem writes nothing. Loads the
 * repo-root .env (MONGODB_URI) - point it at the database you mean to change.
 */
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb } from "../src/db";
import { importSessionHomeGuides } from "../src/modules/lesson-progress/services/HomeGuideService";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--actor");
  const commit = args.includes("--commit");
  const actorAt = args.indexOf("--actor");
  const actor = actorAt >= 0 ? args[actorAt + 1] : "000000000000000000000000";
  if (!file) {
    console.error("usage: import-session-home-guides.ts <file.json> [--commit] [--actor <userId>]");
    process.exit(2);
  }
  const json = fs.readFileSync(path.resolve(file), "utf8");
  await connectDb();
  try {
    const res = await importSessionHomeGuides(json, actor, { dryRun: !commit });
    console.log(JSON.stringify(res, null, 2));
    console.log(res.errors.length ? "REFUSED - nothing written" : res.dryRun ? "DRY RUN - nothing written (add --commit)" : "COMMITTED");
    if (res.errors.length) process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
