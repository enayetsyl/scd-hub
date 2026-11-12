/**
 * Delete a stray AcademicYear (default label 2029) — YC-0, docs/prd-year-change.md Q4.
 *
 * The stray year is the fallback in the attendance ranking and in the app (`years[0]`),
 * so it must go before the year change. It is deleted ONLY when nothing references it.
 *
 *   npx tsx server/scripts/delete-stray-year.ts                 # dry run for 2029: counts only
 *   npx tsx server/scripts/delete-stray-year.ts 2028            # dry run for another label
 *   npx tsx server/scripts/delete-stray-year.ts 2029 --apply    # delete (only if every count is 0)
 *
 * Dry run is the default and never writes. The report lists every collection whose schema
 * has an `academicYearId` (or `academicYear`) path — classes, exams, budget lines, leave
 * entitlements, schedule windows, assignment schedules, mastery enablements, id sequences and
 * the rest — so a model added later is covered without editing this file: the service require()s every
 * file under server/src/modules/*/models before it enumerates mongoose.modelNames().
 *
 * REFUSES (exit 1) to delete when: the year is missing, is the CURRENT year, or any
 * collection still references it. Uses MONGODB_URI from the repo .env (never printed) — the
 * repo `.env` points at a TEST copy; check the database name in the output before --apply.
 * NOT run by CI or on deploy.
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/db";
import { deleteStrayYear } from "../src/modules/foundation/services/StrayYearService";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const label = args.find((a) => !a.startsWith("--")) ?? "2029";
  await connectDb();
  console.log(`database: ${mongoose.connection.db?.databaseName ?? "(unknown)"}`);
  console.log(apply ? `Mode: APPLY (will delete "${label}" if unreferenced)` : `Mode: DRY RUN for "${label}" (pass --apply to delete)`);
  const { refused, report } = await deleteStrayYear(label, apply);
  if (report) {
    for (const c of report.counts) console.log(`  ${c.model}.${c.field}: ${c.count}`);
    console.log(`  total references: ${report.total}`);
  }
  await disconnectDb();
  if (refused) {
    console.error(`REFUSED: ${refused}`);
    process.exit(1);
  }
  console.log(apply ? `Deleted academic year "${label}".` : `Dry run clean: "${label}" holds nothing and can be deleted with --apply.`);
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb();
  process.exit(1);
});
