/**
 * Backfill the QuestionUse ledger (AL-3, D-#1667, docs/prd-academic-loop-2027.md §3.2) from the existing sets,
 * issued homework, top-ups and mastery papers. The work lives in
 * `server/src/modules/assessment/services/QuestionUseBackfill.ts` (so the tests run it too).
 *
 * IDEMPOTENT (every row is keyed by `useKey`; written with $setOnInsert; a row withdrawn on purpose is never revived).
 * DRY RUN by default — counts what it would add per source and writes nothing. Pass --apply to persist.
 *
 *   npx tsx server/scripts/backfill-question-use.ts            # preview
 *   npx tsx server/scripts/backfill-question-use.ts --apply    # persist
 *
 * NOTE: the repo .env points at the LOCAL test copy. Run against production only on the VM (/opt/scdhub/prod),
 * after a dry run, by the lead.
 */
import { connectDb } from "../src/db";
import { backfillQuestionUse } from "../src/modules/assessment/services/QuestionUseBackfill";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await connectDb();
  const totals = await backfillQuestionUse({ apply });
  console.log(apply ? "APPLIED" : "DRY RUN");
  for (const [source, t] of Object.entries(totals)) {
    console.log(`${source.padEnd(16)} rows found ${t.found}, ${apply ? "added" : "would add"} ${t.added}`);
  }
  if (!apply) console.log("Re-run with --apply to persist.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
