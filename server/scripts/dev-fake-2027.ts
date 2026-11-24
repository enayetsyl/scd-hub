/**
 * AL-2 (prd-academic-loop-2027 section 9.3): the fake-2027 activity generator. DEV ONLY, lead-run.
 * Dry run by default.
 *
 *   npx tsx server/scripts/dev-fake-2027.ts                       # dry run: prints the manifest
 *   npx tsx server/scripts/dev-fake-2027.ts --apply               # generate (removes the previous run first)
 *   npx tsx server/scripts/dev-fake-2027.ts --apply --allow-2026  # scenario 0 on the 2026 year (before the YC rehearsal)
 *   npx tsx server/scripts/dev-fake-2027.ts --remove fake-20261201-1030 --apply
 *   npx tsx server/scripts/dev-fake-2027.ts --remove <runId> --remove-calendar --apply   # also drops the dev calendar rows
 *   options: --year <academicYearId>  --seed <n>  --scenario <id> (repeatable)
 *            --until <YYYY-MM-DD>   last day of the realistic term (default 2027-06-30; the default run = calendar + scenario 9 + 8)
 *            --weeks <n>            the old fixed window (N school weeks from 3 Jan) instead of --until
 *   a bare `--scenario <id>` (no --until) keeps the 8-week window for the older phases 0..7.
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/db";
import { runFake } from "../src/lib/devData/devFake2027";

const argv = process.argv.slice(2);
const val = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const vals = (flag: string): string[] => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : []));

async function main(): Promise<void> {
  const ri = argv.indexOf("--remove");
  if (ri >= 0 && (!argv[ri + 1] || argv[ri + 1].startsWith("--"))) {
    throw new Error("--remove needs a run id (e.g. --remove fake-20261201-1030); refusing to generate");
  }
  await connectDb();
  console.log(`databaseName: ${mongoose.connection.db?.databaseName ?? "(unknown)"}`);
  try {
    const scenarioIds = vals("--scenario").map(Number);
    const r = await runFake({
      apply: argv.includes("--apply"),
      remove: val("--remove"),
      year: val("--year"),
      allow2026: argv.includes("--allow-2026"),
      seed: val("--seed") ? Number(val("--seed")) : undefined,
      until: val("--until"),
      weeks: val("--weeks") ? Number(val("--weeks")) : undefined,
      removeCalendar: argv.includes("--remove-calendar"),
      scenarioIds: scenarioIds.length ? scenarioIds : undefined,
      log: console.log,
    });
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(String((err as Error)?.message ?? err));
  process.exit(1);
});
