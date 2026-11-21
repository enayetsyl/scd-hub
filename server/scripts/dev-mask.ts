/**
 * AL-2 (prd-academic-loop-2027 section 9.2 step 7): mask the dev database right after the prod copy.
 * LEAD-ONLY, on the dev VM, with the dev API stopped. Dry run by default; `--apply` writes.
 * Refuses unless the DB name ends in `_dev`, the outgoing guard is closed and MONGODB_URI is not PROD_MONGODB_URI.
 * Needs DEV_TEST_PASSWORD in the environment for --apply (never printed). See server/scripts/dev-copy-runbook.md.
 *
 *   npx tsx server/scripts/dev-mask.ts            # dry run
 *   npx tsx server/scripts/dev-mask.ts --apply
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/db";
import { runMask } from "../src/lib/devData/devMask";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectDb();
  console.log(`databaseName: ${mongoose.connection.db?.databaseName ?? "(unknown)"}`);
  try {
    const r = await runMask({ apply, log: console.log });
    console.log(JSON.stringify(r, null, 2));
    if (apply && r.residueTotal !== 0) {
      console.error(`RESIDUE ${r.residueTotal} - the copy is NOT safe to start`);
      process.exitCode = 1;
    }
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(String((err as Error)?.message ?? err));
  process.exit(1);
});
