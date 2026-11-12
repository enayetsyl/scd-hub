/**
 * YC-3 Class 6 onboarding data (D-#1483). Adds what prod is missing for a Class 6 section:
 * Subject rows (ICT, BAN2, ENG2), Class 6 in the class_1_5 period grid, and the generic Class 6
 * homework topics. Rules: server/src/modules/foundation/services/Class6OnboardingDataService.ts.
 *
 * Additive + idempotent: only missing rows are written, nothing is changed or removed, so a
 * second run writes 0. DRY-RUN by default (prints every row it would write); --apply writes.
 * Uses MONGODB_URI from env (never printed) - check `databaseName` first. The lead runs it on
 * prod after promotion; never without the owner's go-ahead.
 *
 *   npx tsx server/scripts/class6-onboarding-data.ts            # dry-run
 *   npx tsx server/scripts/class6-onboarding-data.ts --apply    # apply
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/db";
import { class6OnboardingData } from "../src/modules/foundation/services/Class6OnboardingDataService";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  await connectDb();
  console.log(`databaseName: ${mongoose.connection.db?.databaseName ?? "(unknown)"}`);
  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: dry-run (no writes)");

  const r = await class6OnboardingData({ apply: APPLY });
  console.log("");
  console.log(`rows ${APPLY ? "planned" : "that would be written"}: ${r.planned.length}`);
  for (const p of r.planned) console.log(`  + ${p.line}`);
  if (r.notes.length) {
    console.log("notes:");
    for (const n of r.notes) console.log(`  - ${n}`);
  }
  if (APPLY) console.log(`\nwritten: ${r.written}`);
  else console.log("\nDry run - nothing written. Re-run with --apply to write.");
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb();
  process.exit(1);
});
