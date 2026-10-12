/**
 * Launch backfill for the class-test script flow (CS-1, docs/prd-ct-scripts.md §9,
 * D-#718). Owner ruling 2026-10-12: every class test published in the CURRENT
 * academic year enters the flow — not only tests published after launch.
 *
 * For each PRINTED test of the current year with ≥1 published result and no
 * `scripts` field, sets `scripts = { dueDateKey, backfilled: true }`, where the due
 * day is LAUNCH day + 1 school day (not the old publish date) — so nothing lands on a
 * teacher's Today already overdue. A test whose paper already went home is closed by
 * the Office with "বাদ দিন" (waiveClassTestScripts) afterwards.
 *
 * DRY RUN by default — prints per-teacher counts (the size of each teacher's day-one
 * Today backlog) and writes nothing. Pass --apply to persist. Idempotent: a test that
 * already has `scripts` is never touched.
 *
 *   npx tsx server/scripts/backfill-ct-scripts.ts            # preview
 *   npx tsx server/scripts/backfill-ct-scripts.ts --apply    # persist
 *
 * NOTE: the repo .env points at the LOCAL test copy. Run against production on the
 * VM (/opt/scdhub/prod, TZ=Asia/Dhaka) so MONGODB_URI/databaseName resolve to prod.
 */
import { connectDb } from "../src/db";
import { AcademicYear } from "../src/modules/foundation/models/AcademicYear";
import { User } from "../src/modules/foundation/models/User";
import {
  applyBackfill,
  backfillCandidates,
  schoolDaysAfterKey,
  todayKeyOf,
} from "../src/modules/trackers/services/ClassTestScriptService";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectDb();

  const year = await AcademicYear.findOne({ current: true }).select("_id").lean();
  if (!year) {
    console.log("No current academic year — nothing to backfill.");
    process.exit(0);
  }

  const candidates = await backfillCandidates(year._id);
  console.log(`Published class tests this year not yet in the script flow: ${candidates.length}`);
  if (candidates.length === 0) process.exit(0);

  const launchKey = todayKeyOf();
  const dueDateKey = await schoolDaysAfterKey(launchKey);
  console.log(`Launch day ${launchKey} → scripts due ${dueDateKey} (1 school day).`);

  const byTeacher = new Map<string, string[]>();
  for (const c of candidates) byTeacher.set(c.teacherId, [...(byTeacher.get(c.teacherId) ?? []), c.ctId]);
  const users = await User.find({ _id: { $in: [...byTeacher.keys()] } }).select("name").lean();
  const nameOf = (id: string): string => users.find((u) => u._id.toString() === id)?.name ?? id;

  console.log("\nPer-teacher day-one backlog (খাতা জমা দিন reminders):");
  for (const [teacherId, ctIds] of [...byTeacher.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(ctIds.length).padStart(3)}  ${nameOf(teacherId)}  — ${ctIds.join(", ")}`);
  }

  if (apply) {
    const n = await applyBackfill(
      candidates.map((c) => c.testId),
      dueDateKey,
    );
    console.log(`\nAPPLIED — ${n} test(s) entered the script flow, due ${dueDateKey}.`);
  } else {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to persist.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
