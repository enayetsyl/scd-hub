/**
 * Backfill teacher attendance from a year-to-date Employee Attendance Report (D-#610).
 *
 *   npx tsx server/scripts/backfill-attendance-range.ts <file.xlsx> --from 2026-01-01 --to 2026-06-03
 *   ... --write            actually import (otherwise it is a dry run)
 *   ... --ignore "Name"    drop a sheet name that has no staff profile (repeatable)
 *
 * WHY THIS EXISTS. Attendance in the app began on 4 June 2026 — not because the school
 * opened then, but because that is when someone started uploading the daily export.
 * January to May sat in the biometric system only, so payroll, leave balances and the
 * staff hub all started their year in June. The school also exports a year-to-date
 * report in the identical layout, one column per day; this walks it.
 *
 * It is also the correction path for D-#611: a day already imported gets REPLACED
 * (AT1.5), so re-running it over June–August rewrites the days whose ✘ was later
 * reclassified as ℞ leave in the biometric system, which the daily upload could never
 * have known about.
 *
 * DRY RUN BY DEFAULT. It prints the day count, the status split, which days would be
 * overwritten and any unmatched names — a commit aborts on an unmatched name rather
 * than dropping the person, so that list has to be empty (or explicitly ignored) first.
 */
import "dotenv/config";
import * as fs from "fs";
import { connectDb, disconnectDb } from "../src/db";
import {
  previewRangeImport,
  commitRangeImport,
} from "../src/modules/attendance/services/TeacherAttendanceService";
import { User } from "../src/modules/foundation/models/User";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}
function args(flag: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => { if (a === flag && process.argv[i + 1]) out.push(process.argv[i + 1]); });
  return out;
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("usage: backfill-attendance-range.ts <file.xlsx> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--write]");
  const from = arg("--from");
  const to = arg("--to");
  const ignore = args("--ignore");
  const write = process.argv.includes("--write");

  const base64 = fs.readFileSync(file).toString("base64");
  await connectDb();
  console.log(`file: ${file}`);
  console.log(`range: ${from ?? "(start)"} .. ${to ?? "(end)"}`);
  console.log(write ? "*** WRITING ***\n" : "*** DRY RUN — no writes ***\n");

  const preview = await previewRangeImport(base64, { from, to });
  console.log(`days in range: ${preview.days}   (${preview.fromDateKey} .. ${preview.toDateKey})`);
  console.log(`rows to write: ${Object.entries(preview.byStatus).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`cells with no symbol (no school): ${preview.skipped}`);
  console.log(`days already imported (would be REPLACED): ${preview.alreadyImported.length}`);
  if (preview.alreadyImported.length) {
    console.log(`   ${preview.alreadyImported[0]} .. ${preview.alreadyImported[preview.alreadyImported.length - 1]}`);
  }
  console.log(`unmatched names: ${preview.unmatched.length ? preview.unmatched.join(", ") : "none"}`);

  if (!write) {
    if (preview.unmatched.length) console.log("\n!! resolve or --ignore the unmatched names before writing");
    await disconnectDb();
    return;
  }
  if (preview.unmatched.length) throw new Error(`unmatched names would abort the commit: ${preview.unmatched.join(", ")}`);

  // The import is attributed to a real actor — every day writes its own audit row.
  const actor = await User.findOne({ role: "PRINCIPAL" }).lean();
  if (!actor) throw new Error("no PRINCIPAL user to attribute the import to");

  const res = await commitRangeImport(base64, [], ignore, actor._id.toString(), { from, to });
  console.log(`\nwritten: ${res.imported} rows across ${res.days.length} days (${res.fromDateKey} .. ${res.toDateKey})`);
  console.log(`days that replaced existing rows: ${res.replaced}`);
  await disconnectDb();
}

main().catch(async (e) => {
  console.error("ABORTED: " + (e as Error).message);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
