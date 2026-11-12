/**
 * YC-1 backfill: one ACTIVE enrolment per active student of the current year (from the year's
 * first day), plus best-effort merge / split history from SectionMerge. See
 * server/src/modules/foundation/services/EnrolmentBackfillService.ts for the rules.
 *
 * Idempotent: a student who already has an enrolment in the year is skipped, so a re-run writes 0.
 * Prints what it could NOT rebuild instead of guessing. DRY-RUN by default; pass --apply to write.
 * Uses MONGODB_URI from env (never printed) - check `databaseName` first; the repo `.env` points
 * at a TEST copy whose ObjectIds match prod. Never run this against a real database without the
 * owner's go-ahead.
 *
 *   npx tsx server/scripts/backfill-enrolments.ts            # dry-run
 *   npx tsx server/scripts/backfill-enrolments.ts --apply    # apply
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/db";
import { Enrolment } from "../src/modules/foundation/models/Enrolment";
import { backfillEnrolments } from "../src/modules/foundation/services/EnrolmentBackfillService";
import { checkInvariant } from "../src/modules/foundation/services/EnrolmentService";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  await connectDb();
  console.log(`databaseName: ${mongoose.connection.db?.databaseName ?? "(unknown)"}`);
  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: dry-run (no writes)");
  if (APPLY) await Enrolment.init();

  const r = await backfillEnrolments({ apply: APPLY });
  console.log("");
  console.log(`current year id            : ${r.academicYearId ?? "(none)"}`);
  console.log(`active students considered : ${r.students}`);
  console.log(`already had an enrolment   : ${r.alreadyDone} (skipped)`);
  console.log(`rows ${APPLY ? "written" : "that would be written"}${APPLY ? "          " : ""}: ${APPLY ? r.rowsWritten : r.rowsPlanned}`);
  console.log(`could NOT rebuild          : ${r.couldNot.length}`);
  for (const line of r.couldNot) console.log(`  - ${line}`);

  if (APPLY) {
    const bad = await checkInvariant();
    console.log(`\ninvariant violations after apply: ${bad.length}`);
    for (const v of bad.slice(0, 50)) console.log(`  - ${v.schoolId}: ${v.kind} (${v.detail})`);
  } else {
    console.log("\nDry run - nothing written. Re-run with --apply to write.");
  }
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb();
  process.exit(1);
});
